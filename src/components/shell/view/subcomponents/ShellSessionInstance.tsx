import { useRef, useCallback, useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { Project, ProjectSession } from '../../../../types/app';
import { useShellRuntime } from '../../hooks/useShellRuntime';
import { sendSocketMessage } from '../../utils/socket';
import ShellConnectionOverlay from './ShellConnectionOverlay';
import TerminalSearchBar from './TerminalSearchBar';
import {
  PROMPT_BUFFER_SCAN_LINES,
  PROMPT_DEBOUNCE_MS,
  PROMPT_MAX_OPTIONS,
  PROMPT_MIN_OPTIONS,
  PROMPT_OPTION_SCAN_LINES,
} from '../../constants/constants';
import { useTranslation } from 'react-i18next';

type CliPromptOption = { number: string; label: string };

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
  const [cliPromptOptions, setCliPromptOptions] = useState<CliPromptOption[] | null>(null);
  const promptCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onOutputRef = useRef<(() => void) | null>(null);

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

  // --- CLI prompt detection (copied from Shell.tsx) ---
  const checkBufferForPrompt = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    const buf = term.buffer.active;
    const lastContentRow = buf.baseY + buf.cursorY;
    const scanEnd = Math.min(buf.baseY + buf.length - 1, lastContentRow + 10);
    const scanStart = Math.max(0, lastContentRow - PROMPT_BUFFER_SCAN_LINES);
    const lines: string[] = [];
    for (let i = scanStart; i <= scanEnd; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString().trimEnd());
    }

    let footerIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/esc to cancel/i.test(lines[i]) || /enter to select/i.test(lines[i])) {
        footerIdx = i;
        break;
      }
    }

    if (footerIdx === -1) {
      setCliPromptOptions(null);
      return;
    }

    const optMap = new Map<string, string>();
    const optScanStart = Math.max(0, footerIdx - PROMPT_OPTION_SCAN_LINES);
    for (let i = footerIdx - 1; i >= optScanStart; i--) {
      const match = lines[i].match(/^\s*[❯›>]?\s*(\d+)\.\s+(.+)/);
      if (match) {
        const num = match[1];
        const label = match[2].trim();
        if (parseInt(num, 10) <= PROMPT_MAX_OPTIONS && label.length > 0 && !optMap.has(num)) {
          optMap.set(num, label);
        }
      }
    }

    const valid: CliPromptOption[] = [];
    for (let i = 1; i <= optMap.size; i++) {
      if (optMap.has(String(i))) valid.push({ number: String(i), label: optMap.get(String(i))! });
      else break;
    }

    setCliPromptOptions(valid.length >= PROMPT_MIN_OPTIONS ? valid : null);
  }, [terminalRef]);

  const schedulePromptCheck = useCallback(() => {
    if (promptCheckTimer.current) clearTimeout(promptCheckTimer.current);
    promptCheckTimer.current = setTimeout(checkBufferForPrompt, PROMPT_DEBOUNCE_MS);
  }, [checkBufferForPrompt]);

  useEffect(() => {
    onOutputRef.current = schedulePromptCheck;
  }, [schedulePromptCheck]);

  useEffect(() => {
    return () => {
      if (promptCheckTimer.current) clearTimeout(promptCheckTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!isConnected) {
      if (promptCheckTimer.current) {
        clearTimeout(promptCheckTimer.current);
        promptCheckTimer.current = null;
      }
      setCliPromptOptions(null);
    }
  }, [isConnected]);

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
      />

      {showSearch && (
        <TerminalSearchBar
          searchAddon={searchAddonRef.current}
          onClose={() => setShowSearch(false)}
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
        <div
          className="absolute inset-x-0 bottom-0 z-10 border-t border-gray-700/80 bg-gray-800/95 px-3 py-2 backdrop-blur-sm"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-wrap items-center gap-2">
            {cliPromptOptions.map((opt) => (
              <button
                type="button"
                key={opt.number}
                onClick={() => {
                  sendInput(opt.number);
                  setCliPromptOptions(null);
                }}
                className="max-w-36 truncate rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                title={`${opt.number}. ${opt.label}`}
              >
                {opt.number}. {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                sendInput('\x1b');
                setCliPromptOptions(null);
              }}
              className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600"
            >
              Esc
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
