import { useRef, useCallback, useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { Project, ProjectSession } from '../../../../types/app';
import type { PasteConfirmCallback } from '../../types/types';
import { useShellRuntime } from '../../hooks/useShellRuntime';
import { useCliPromptDetection } from '../../hooks/useCliPromptDetection';
import { sendSocketMessage } from '../../utils/socket';
import ShellConnectionOverlay from './ShellConnectionOverlay';
import PasteConfirmDialog from './PasteConfirmDialog';
import CliPromptOverlay from './CliPromptOverlay';
import TerminalSearchBar from './TerminalSearchBar';
import { useTranslation } from 'react-i18next';

type ShellSessionInstanceProps = {
  sessionId: string;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  isVisible: boolean;
  isPlainShell?: boolean;
  initialCommand?: string | null;
  onStatusChange?: (sessionId: string, status: 'running' | 'idle' | 'disconnected') => void;
  onRuntimeReady?: (
    wsRef: MutableRefObject<WebSocket | null>,
    terminalRef: MutableRefObject<Terminal | null>,
  ) => void;
};

export default function ShellSessionInstance({
  sessionId,
  selectedProject,
  selectedSession,
  isVisible,
  isPlainShell = false,
  initialCommand = null,
  onStatusChange,
  onRuntimeReady,
}: ShellSessionInstanceProps) {
  const { t } = useTranslation('chat');
  const onOutputRef = useRef<(() => void) | null>(null);
  const [pendingPaste, setPendingPaste] = useState<{ text: string; onConfirm: () => void } | null>(null);
  const onPasteConfirmNeeded = useRef<PasteConfirmCallback | null>(null);

  useEffect(() => {
    onPasteConfirmNeeded.current = (text: string, onConfirm: () => void) => {
      setPendingPaste({ text, onConfirm });
    };
    return () => {
      onPasteConfirmNeeded.current = null;
    };
  }, []);

  const {
    terminalContainerRef,
    terminalRef,
    wsRef,
    isConnected,
    isInitialized,
    isConnecting,
    connectToShell,
    isReconnecting,
    reconnectAttempt,
    reconnectCountdown,
    connectionError,
    cancelReconnect,
    searchAddonRef,
  } = useShellRuntime({
    selectedProject,
    selectedSession,
    initialCommand,
    isPlainShell,
    minimal: false,
    autoConnect: isVisible,
    isRestarting: false,
    onOutputRef,
    onPasteConfirmNeeded,
  });

  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        if (isVisible) {
          e.preventDefault();
          setShowSearch(true);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible]);

  // --- Notify parent of status changes ---
  useEffect(() => {
    if (!onStatusChange) return;
    if (isConnected) {
      onStatusChange(sessionId, 'running');
    } else if (isReconnecting) {
      onStatusChange(sessionId, 'idle');
    } else {
      onStatusChange(sessionId, 'disconnected');
    }
  }, [sessionId, isConnected, isReconnecting, onStatusChange]);

  // --- Notify parent of runtime refs when visible ---
  useEffect(() => {
    if (isVisible && onRuntimeReady) {
      onRuntimeReady(wsRef, terminalRef);
    }
  }, [isVisible, onRuntimeReady, wsRef, terminalRef]);

  // --- Trigger xterm fit when becoming visible ---
  useEffect(() => {
    if (isVisible) {
      window.dispatchEvent(new Event('resize'));
    }
  }, [isVisible]);

  // --- CLI prompt detection (shared hook) ---
  const { cliPromptOptions, setCliPromptOptions, schedulePromptCheck } =
    useCliPromptDetection(terminalRef, isConnected);

  useEffect(() => {
    onOutputRef.current = schedulePromptCheck;
  }, [schedulePromptCheck]);

  // --- Send input helper ---
  const sendInput = useCallback(
    (data: string) => {
      sendSocketMessage(wsRef.current, { type: 'input', data });
    },
    [wsRef],
  );

  // --- Overlay mode computation ---
  const readyDescription = isPlainShell
    ? t('shell.runCommand', {
        command: initialCommand || t('shell.defaultCommand'),
        projectName: selectedProject.displayName,
      })
    : selectedSession
      ? t('shell.resumeSession', { displayName: selectedSession.name?.slice(0, 50) })
      : t('shell.startSession');

  const connectingDescription = isPlainShell
    ? t('shell.runCommand', {
        command: initialCommand || t('shell.defaultCommand'),
        projectName: selectedProject.displayName,
      })
    : t('shell.startCli', { projectName: selectedProject.displayName });

  const overlayMode = !isInitialized
    ? 'loading'
    : isConnecting
      ? 'connecting'
      : isReconnecting
        ? 'reconnecting'
        : connectionError
          ? 'error'
          : !isConnected
            ? 'connect'
            : null;

  const overlayDescription = overlayMode === 'connecting' ? connectingDescription : readyDescription;

  return (
    <div className={`relative h-full w-full${isVisible ? '' : ' hidden'}`}>
      <div
        ref={terminalContainerRef}
        className="h-full w-full focus:outline-none"
        style={{ outline: 'none' }}
        role="application"
        aria-label="终端"
      />

      {showSearch && (
        <TerminalSearchBar
          searchAddon={searchAddonRef.current}
          onClose={() => setShowSearch(false)}
        />
      )}

      {pendingPaste && (
        <PasteConfirmDialog
          text={pendingPaste.text}
          onConfirm={() => {
            pendingPaste.onConfirm();
            setPendingPaste(null);
          }}
          onCancel={() => setPendingPaste(null)}
        />
      )}

      {overlayMode && (
        <ShellConnectionOverlay
          mode={overlayMode}
          description={overlayDescription}
          loadingLabel={t('shell.loading')}
          connectLabel={t('shell.actions.connect')}
          connectTitle={t('shell.actions.connectTitle')}
          connectingLabel={t('shell.connecting')}
          onConnect={connectToShell}
          reconnectAttempt={reconnectAttempt}
          reconnectMaxAttempts={5}
          reconnectCountdown={reconnectCountdown}
          connectionError={connectionError}
          onCancelReconnect={cancelReconnect}
          onRetry={connectToShell}
        />
      )}

      {cliPromptOptions && isConnected && (
        <CliPromptOverlay
          options={cliPromptOptions}
          onSelect={(num) => {
            sendInput(num);
            setCliPromptOptions(null);
          }}
          onEsc={() => {
            sendInput('\x1b');
            setCliPromptOptions(null);
          }}
        />
      )}
    </div>
  );
}
