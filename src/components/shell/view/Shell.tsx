import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '@xterm/xterm/css/xterm.css';
import type { Terminal } from '@xterm/xterm';
import type { Project, ProjectSession } from '../../../types/app';
import type { PasteConfirmCallback } from '../types/types';
import { SHELL_RESTART_DELAY_MS } from '../constants/constants';
import { useShellRuntime } from '../hooks/useShellRuntime';
import { useSessionManager } from '../hooks/useSessionManager';
import { useCliPromptDetection } from '../hooks/useCliPromptDetection';
import { sendSocketMessage } from '../utils/socket';
import { getSessionDisplayName } from '../utils/auth';
import ShellConnectionOverlay from './subcomponents/ShellConnectionOverlay';
import ShellEmptyState from './subcomponents/ShellEmptyState';
import ShellHeader from './subcomponents/ShellHeader';
import ShellMinimalView from './subcomponents/ShellMinimalView';
import ShellSessionInstance from './subcomponents/ShellSessionInstance';
import PasteConfirmDialog from './subcomponents/PasteConfirmDialog';
import CliPromptOverlay from './subcomponents/CliPromptOverlay';
import SessionTabBar from './subcomponents/SessionTabBar';
import TerminalSearchBar from './subcomponents/TerminalSearchBar';
import TerminalSettings from './subcomponents/TerminalSettings';
import type { TerminalSettingsValues } from './subcomponents/TerminalSettings';
import { loadTerminalSettings } from './subcomponents/TerminalSettings';
import { TERMINAL_THEMES } from '../constants/themes';
import TerminalShortcutsPanel from './subcomponents/TerminalShortcutsPanel';
import MobileToolbar from './subcomponents/MobileToolbar';
import SplitPaneManager from './subcomponents/SplitPaneManager';
import type { SplitLayout } from './subcomponents/SplitPaneManager';

type ShellProps = {
  selectedProject?: Project | null;
  selectedSession?: ProjectSession | null;
  initialCommand?: string | null;
  isPlainShell?: boolean;
  onProcessComplete?: ((exitCode: number) => void) | null;
  minimal?: boolean;
  autoConnect?: boolean;
  isActive?: boolean;
  onWsRef?: (ws: import('react').MutableRefObject<WebSocket | null>) => void;
};

export default function Shell({
  selectedProject = null,
  selectedSession = null,
  initialCommand = null,
  isPlainShell = false,
  onProcessComplete = null,
  minimal = false,
  autoConnect = false,
  isActive,
  onWsRef,
}: ShellProps) {
  const { t } = useTranslation('chat');
  const [isRestarting, setIsRestarting] = useState(false);
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

  // Keep the public API stable for existing callers that still pass `isActive`.
  void isActive;

  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const handleToggleSettings = useCallback(() => {
    setShowSettings((prev) => !prev);
  }, []);

  const shellContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = shellContainerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Mode detection ──────────────────────────────────────────────────────────
  const isMultiSessionMode = !isPlainShell && !minimal;

  // ── SessionManager (always called to satisfy hook ordering rules) ───────────
  const {
    sessions,
    activeSessionId,
    tabOrder,
    switchSession,
    closeSession,
    updateStatus,
    reorderSessions,
  } = useSessionManager();

  // ── Single-session runtime (always called to satisfy hook ordering rules) ───
  const {
    terminalContainerRef,
    terminalRef,
    wsRef,
    isConnected,
    isInitialized,
    isConnecting,
    authUrl,
    authUrlVersion,
    connectToShell,
    disconnectFromShell,
    openAuthUrlInBrowser,
    copyAuthUrlToClipboard,
    isReconnecting,
    reconnectAttempt,
    reconnectCountdown,
    connectionError,
    cancelReconnect,
    searchAddonRef,
    fitAddonRef,
  } = useShellRuntime({
    selectedProject,
    selectedSession,
    initialCommand,
    isPlainShell,
    minimal,
    autoConnect,
    isRestarting,
    onProcessComplete,
    onOutputRef,
    onPasteConfirmNeeded,
  });

  // ── CLI prompt detection (shared hook) ──────────────────────────────────────
  const { cliPromptOptions, setCliPromptOptions, schedulePromptCheck } =
    useCliPromptDetection(terminalRef, isConnected);

  // Wire up the onOutput callback
  useEffect(() => {
    onOutputRef.current = schedulePromptCheck;
  }, [schedulePromptCheck]);

  // ── Multi-session: track active session's runtime refs for TerminalShortcutsPanel ─
  const activeWsRef = useRef<WebSocket | null>(null);
  const activeTerminalRef = useRef<Terminal | null>(null);

  const handleRuntimeReady = useCallback(
    (wsRefArg: React.MutableRefObject<WebSocket | null>, termRefArg: React.MutableRefObject<Terminal | null>) => {
      activeWsRef.current = wsRefArg.current;
      activeTerminalRef.current = termRefArg.current;
    },
    [],
  );

  const handleSettingsChange = useCallback((settings: TerminalSettingsValues) => {
    // Apply to whichever terminal is available
    const terminal = activeTerminalRef.current || terminalRef.current;
    if (!terminal) return;

    terminal.options.fontSize = settings.fontSize;
    terminal.options.fontFamily = settings.fontFamily;
    terminal.options.scrollback = settings.scrollback;
    terminal.options.cursorStyle = settings.cursorStyle;
    terminal.options.cursorBlink = settings.cursorBlink;

    // Apply theme
    const themePreset = TERMINAL_THEMES.find((t) => t.id === settings.themeId);
    if (themePreset) {
      terminal.options.theme = themePreset.theme;
    }

    // Re-fit after font change
    fitAddonRef.current?.fit();
  }, [activeTerminalRef, terminalRef, fitAddonRef]);

  // Apply saved settings when terminal initializes
  useEffect(() => {
    if (!isInitialized) return;
    const savedSettings = loadTerminalSettings();
    handleSettingsChange(savedSettings);
  }, [isInitialized, handleSettingsChange]);

  // ── Split pane state ────────────────────────────────────────────────────────
  const [splitLayout, setSplitLayout] = useState<SplitLayout>({
    type: 'single',
    sessionId: activeSessionId ?? '',
  });

  // Keep single layout in sync with active session
  useEffect(() => {
    if (splitLayout.type === 'single' && activeSessionId) {
      setSplitLayout({ type: 'single', sessionId: activeSessionId });
    }
  }, [activeSessionId, splitLayout.type]);

  // Check if we can split (not grid-4 and screen wide enough)
  const canSplit = splitLayout.type !== 'grid-4' && (typeof window !== 'undefined' ? window.innerWidth >= 768 : true);

  // Get next session id that is not the active one
  const getNextSessionId = useCallback(() => {
    const others = tabOrder.filter((id) => id !== activeSessionId);
    return others.length > 0 ? others[0] : null;
  }, [tabOrder, activeSessionId]);

  const handleSplitHorizontal = useCallback(() => {
    if (!activeSessionId) return;
    const other = getNextSessionId();
    if (!other) return;

    if (splitLayout.type === 'single') {
      setSplitLayout({ type: 'horizontal-2', left: activeSessionId, right: other, ratio: 0.5 });
    } else if (splitLayout.type === 'horizontal-2') {
      // Upgrade to grid-4
      const otherIds = tabOrder.filter((id) => id !== splitLayout.left && id !== splitLayout.right);
      const third = otherIds[0] ?? splitLayout.right;
      const fourth = otherIds[1] ?? splitLayout.left;
      setSplitLayout({
        type: 'grid-4',
        topLeft: splitLayout.left,
        topRight: splitLayout.right,
        bottomLeft: third,
        bottomRight: fourth,
        hRatio: splitLayout.ratio,
        vRatio: 0.5,
      });
    } else if (splitLayout.type === 'vertical-2') {
      // Upgrade to grid-4
      const otherIds = tabOrder.filter((id) => id !== splitLayout.top && id !== splitLayout.bottom);
      const third = otherIds[0] ?? splitLayout.bottom;
      const fourth = otherIds[1] ?? splitLayout.top;
      setSplitLayout({
        type: 'grid-4',
        topLeft: splitLayout.top,
        topRight: third,
        bottomLeft: splitLayout.bottom,
        bottomRight: fourth,
        hRatio: 0.5,
        vRatio: splitLayout.ratio,
      });
    }
  }, [activeSessionId, getNextSessionId, splitLayout, tabOrder]);

  const handleSplitVertical = useCallback(() => {
    if (!activeSessionId) return;
    const other = getNextSessionId();
    if (!other) return;

    if (splitLayout.type === 'single') {
      setSplitLayout({ type: 'vertical-2', top: activeSessionId, bottom: other, ratio: 0.5 });
    } else if (splitLayout.type === 'vertical-2') {
      // Upgrade to grid-4
      const otherIds = tabOrder.filter((id) => id !== splitLayout.top && id !== splitLayout.bottom);
      const third = otherIds[0] ?? splitLayout.bottom;
      const fourth = otherIds[1] ?? splitLayout.top;
      setSplitLayout({
        type: 'grid-4',
        topLeft: splitLayout.top,
        topRight: third,
        bottomLeft: splitLayout.bottom,
        bottomRight: fourth,
        hRatio: 0.5,
        vRatio: splitLayout.ratio,
      });
    } else if (splitLayout.type === 'horizontal-2') {
      // Upgrade to grid-4
      const otherIds = tabOrder.filter((id) => id !== splitLayout.left && id !== splitLayout.right);
      const third = otherIds[0] ?? splitLayout.right;
      const fourth = otherIds[1] ?? splitLayout.left;
      setSplitLayout({
        type: 'grid-4',
        topLeft: splitLayout.left,
        topRight: splitLayout.right,
        bottomLeft: third,
        bottomRight: fourth,
        hRatio: splitLayout.ratio,
        vRatio: 0.5,
      });
    }
  }, [activeSessionId, getNextSessionId, splitLayout, tabOrder]);

  // Collect all session IDs referenced by the current split layout
  const splitSessionIds = useMemo(() => {
    switch (splitLayout.type) {
      case 'single':
        return [splitLayout.sessionId];
      case 'horizontal-2':
        return [splitLayout.left, splitLayout.right];
      case 'vertical-2':
        return [splitLayout.top, splitLayout.bottom];
      case 'grid-4':
        return [splitLayout.topLeft, splitLayout.topRight, splitLayout.bottomLeft, splitLayout.bottomRight];
    }
  }, [splitLayout]);

  // ── Multi-session: auto-switch to current session when it changes ──────────
  useEffect(() => {
    if (isMultiSessionMode && selectedSession?.id) {
      switchSession(selectedSession.id);
    }
  }, [isMultiSessionMode, selectedSession?.id, switchSession]);

  // ── Forward wsRef to parent (single-session mode only) ─────────────────────
  useEffect(() => {
    onWsRef?.(wsRef);
  }, [wsRef, onWsRef]);

  const sendInput = useCallback(
    (data: string) => {
      sendSocketMessage(wsRef.current, { type: 'input', data });
    },
    [wsRef],
  );

  const sessionDisplayName = useMemo(() => getSessionDisplayName(selectedSession), [selectedSession]);
  const sessionDisplayNameShort = useMemo(
    () => (sessionDisplayName ? sessionDisplayName.slice(0, 30) : null),
    [sessionDisplayName],
  );
  const sessionDisplayNameLong = useMemo(
    () => (sessionDisplayName ? sessionDisplayName.slice(0, 50) : null),
    [sessionDisplayName],
  );

  const handleRestartShell = useCallback(() => {
    setIsRestarting(true);
    window.setTimeout(() => {
      setIsRestarting(false);
    }, SHELL_RESTART_DELAY_MS);
  }, []);

  // ── Early returns (no hooks below this line) ────────────────────────────────

  if (!selectedProject) {
    return (
      <ShellEmptyState
        title={t('shell.selectProject.title')}
        description={t('shell.selectProject.description')}
      />
    );
  }

  if (minimal) {
    return (
      <ShellMinimalView
        terminalContainerRef={terminalContainerRef}
        authUrl={authUrl}
        authUrlVersion={authUrlVersion}
        initialCommand={initialCommand}
        isConnected={isConnected}
        openAuthUrlInBrowser={openAuthUrlInBrowser}
        copyAuthUrlToClipboard={copyAuthUrlToClipboard}
      />
    );
  }

  // ── Multi-session render path ───────────────────────────────────────────────
  if (isMultiSessionMode) {
    const renderSplitPane = (sessionId: string, _isActive: boolean) => (
      <ShellSessionInstance
        key={sessionId}
        sessionId={sessionId}
        selectedProject={selectedProject!}
        selectedSession={selectedSession}
        isVisible={true}
        onStatusChange={updateStatus}
        onRuntimeReady={sessionId === activeSessionId ? handleRuntimeReady : undefined}
      />
    );

    return (
      <div ref={shellContainerRef} className="flex h-full w-full flex-col bg-gray-900" tabIndex={-1}>
        <SessionTabBar
          sessions={sessions}
          activeSessionId={activeSessionId}
          tabOrder={tabOrder}
          onSwitch={switchSession}
          onClose={closeSession}
          onNewSession={() => {/* TODO: will be wired to sidebar session creation */}}
          onReorder={reorderSessions}
          showSettings={showSettings}
          onToggleSettings={handleToggleSettings}
          onSplitHorizontal={handleSplitHorizontal}
          onSplitVertical={handleSplitVertical}
          canSplit={canSplit}
        />
        <TerminalSettings
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          onSettingsChange={handleSettingsChange}
        />
        <div className="relative flex-1 overflow-hidden">
          {showSearch && (
            <TerminalSearchBar
              searchAddon={searchAddonRef.current}
              onClose={() => setShowSearch(false)}
            />
          )}
          {splitLayout.type === 'single' ? (
            <>
              {tabOrder.map((sid) => (
                <ShellSessionInstance
                  key={sid}
                  sessionId={sid}
                  selectedProject={selectedProject!}
                  selectedSession={selectedSession}
                  isVisible={sid === activeSessionId}
                  onStatusChange={updateStatus}
                  onRuntimeReady={sid === activeSessionId ? handleRuntimeReady : undefined}
                />
              ))}
            </>
          ) : (
            <>
              {/* Render hidden sessions not in split view */}
              {tabOrder
                .filter((sid) => !splitSessionIds.includes(sid))
                .map((sid) => (
                  <ShellSessionInstance
                    key={sid}
                    sessionId={sid}
                    selectedProject={selectedProject!}
                    selectedSession={selectedSession}
                    isVisible={false}
                    onStatusChange={updateStatus}
                  />
                ))}
              <SplitPaneManager
                layout={splitLayout}
                onLayoutChange={setSplitLayout}
                renderPane={renderSplitPane}
                activeSessionId={activeSessionId}
                onPaneClick={switchSession}
              />
            </>
          )}
          <div className="hidden md:flex">
            <TerminalShortcutsPanel
              wsRef={{ current: activeWsRef.current } as React.MutableRefObject<WebSocket | null>}
              terminalRef={{ current: activeTerminalRef.current } as React.MutableRefObject<Terminal | null>}
              isConnected={sessions.some((s) => s.sessionId === activeSessionId && s.status === 'running')}
            />
          </div>
        </div>
        {/* Screen reader announcements */}
        <div aria-live="assertive" className="sr-only">
          {sessions.find(s => s.sessionId === activeSessionId)?.status === 'disconnected' && '终端已断开连接'}
        </div>
        <MobileToolbar
          wsRef={{ current: activeWsRef.current } as React.MutableRefObject<WebSocket | null>}
          terminalRef={{ current: activeTerminalRef.current } as React.MutableRefObject<Terminal | null>}
          isConnected={sessions.some((s) => s.sessionId === activeSessionId && s.status === 'running')}
        />
      </div>
    );
  }

  // ── Single-session render path (isPlainShell) ──────────────────────────────

  const readyDescription = isPlainShell
    ? t('shell.runCommand', {
        command: initialCommand || t('shell.defaultCommand'),
        projectName: selectedProject.displayName,
      })
    : selectedSession
      ? t('shell.resumeSession', { displayName: sessionDisplayNameLong })
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
    <div ref={shellContainerRef} className="flex h-full w-full flex-col bg-gray-900" tabIndex={-1}>
      <ShellHeader
        isConnected={isConnected}
        isInitialized={isInitialized}
        isRestarting={isRestarting}
        hasSession={Boolean(selectedSession)}
        sessionDisplayNameShort={sessionDisplayNameShort}
        onDisconnect={disconnectFromShell}
        onRestart={handleRestartShell}
        statusNewSessionText={t('shell.status.newSession')}
        statusInitializingText={t('shell.status.initializing')}
        statusRestartingText={t('shell.status.restarting')}
        disconnectLabel={t('shell.actions.disconnect')}
        disconnectTitle={t('shell.actions.disconnectTitle')}
        restartLabel={t('shell.actions.restart')}
        restartTitle={t('shell.actions.restartTitle')}
        disableRestart={isRestarting || isConnected}
      />

      <div className="relative flex-1 overflow-hidden p-2">
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

        <div className="hidden md:flex">
          <TerminalShortcutsPanel
            wsRef={wsRef}
            terminalRef={terminalRef}
            isConnected={isConnected}
          />
        </div>
      </div>
      {/* Screen reader announcements */}
      <div aria-live="assertive" className="sr-only">
        {isReconnecting && `正在重连，第 ${reconnectAttempt} 次尝试`}
        {connectionError && `连接失败: ${connectionError}`}
      </div>
      <MobileToolbar
        wsRef={wsRef}
        terminalRef={terminalRef}
        isConnected={isConnected}
      />
    </div>
  );
}
