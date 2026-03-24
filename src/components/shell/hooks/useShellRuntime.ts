import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { UseShellRuntimeOptions, UseShellRuntimeResult } from '../types/types';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { useShellConnection } from './useShellConnection';
import { useShellTerminal } from './useShellTerminal';

interface PersistedShellState {
  activeId: string;
  sessions: string[]; // Reserved for P2 multi-session
}

function getPersistedState(projectPath: string): PersistedShellState | null {
  try {
    const raw = sessionStorage.getItem(`shell-sessions-${projectPath}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setPersistedState(projectPath: string, state: PersistedShellState): void {
  try {
    sessionStorage.setItem(`shell-sessions-${projectPath}`, JSON.stringify(state));
  } catch {
    // sessionStorage full or disabled — silently ignore
  }
}

export function useShellRuntime({
  selectedProject,
  selectedSession,
  initialCommand,
  isPlainShell,
  minimal,
  autoConnect,
  isRestarting,
  onProcessComplete,
  onOutputRef,
}: UseShellRuntimeOptions): UseShellRuntimeResult {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [authUrl, setAuthUrl] = useState('');
  const [authUrlVersion, setAuthUrlVersion] = useState(0);

  const selectedProjectRef = useRef(selectedProject);
  const selectedSessionRef = useRef(selectedSession);
  const initialCommandRef = useRef(initialCommand);
  const isPlainShellRef = useRef(isPlainShell);
  const onProcessCompleteRef = useRef(onProcessComplete);
  const authUrlRef = useRef('');
  const lastSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);

  // Keep mutable values in refs so websocket handlers always read current data.
  useEffect(() => {
    selectedProjectRef.current = selectedProject;
    selectedSessionRef.current = selectedSession;
    initialCommandRef.current = initialCommand;
    isPlainShellRef.current = isPlainShell;
    onProcessCompleteRef.current = onProcessComplete;
  }, [selectedProject, selectedSession, initialCommand, isPlainShell, onProcessComplete]);

  const setCurrentAuthUrl = useCallback((nextAuthUrl: string) => {
    authUrlRef.current = nextAuthUrl;
    setAuthUrl(nextAuthUrl);
    setAuthUrlVersion((previous) => previous + 1);
  }, []);

  const closeSocket = useCallback(() => {
    const activeSocket = wsRef.current;
    if (!activeSocket) {
      return;
    }

    if (
      activeSocket.readyState === WebSocket.OPEN ||
      activeSocket.readyState === WebSocket.CONNECTING
    ) {
      activeSocket.close();
    }

    wsRef.current = null;
  }, []);

  const openAuthUrlInBrowser = useCallback((url = authUrlRef.current) => {
    if (!url) {
      return false;
    }

    const popup = window.open(url, '_blank');
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        // Ignore cross-origin restrictions when trying to null opener.
      }
      return true;
    }

    return false;
  }, []);

  const copyAuthUrlToClipboard = useCallback(async (url = authUrlRef.current) => {
    if (!url) {
      return false;
    }

    return copyTextToClipboard(url);
  }, []);

  const { isInitialized, clearTerminalScreen, disposeTerminal, searchAddonRef } = useShellTerminal({
    terminalContainerRef,
    terminalRef,
    fitAddonRef,
    wsRef,
    selectedProject,
    minimal,
    isRestarting,
    initialCommandRef,
    isPlainShellRef,
    authUrlRef,
    copyAuthUrlToClipboard,
    closeSocket,
  });

  const {
    isConnected,
    isConnecting,
    connectToShell,
    disconnectFromShell,
    isReconnecting,
    reconnectAttempt,
    reconnectCountdown,
    connectionError,
    cancelReconnect,
  } = useShellConnection({
    wsRef,
    terminalRef,
    fitAddonRef,
    selectedProjectRef,
    selectedSessionRef,
    initialCommandRef,
    isPlainShellRef,
    onProcessCompleteRef,
    isInitialized,
    autoConnect,
    closeSocket,
    clearTerminalScreen,
    setAuthUrl: setCurrentAuthUrl,
    onOutputRef,
  });

  useEffect(() => {
    const projectPath = selectedProject?.fullPath || selectedProject?.path || '';
    const sessionId = selectedSession?.id;
    if (isConnected && projectPath && sessionId) {
      setPersistedState(projectPath, { activeId: sessionId, sessions: [sessionId] });
    }
  }, [isConnected, selectedProject, selectedSession]);

  useEffect(() => {
    if (!isRestarting) {
      return;
    }

    disconnectFromShell();
    disposeTerminal();
  }, [disconnectFromShell, disposeTerminal, isRestarting]);

  useEffect(() => {
    if (selectedProject) {
      return;
    }

    disconnectFromShell();
    disposeTerminal();
  }, [disconnectFromShell, disposeTerminal, selectedProject]);

  useEffect(() => {
    const currentSessionId = selectedSession?.id ?? null;
    if (lastSessionIdRef.current !== currentSessionId && isInitialized) {
      disconnectFromShell();
    }

    lastSessionIdRef.current = currentSessionId;
  }, [disconnectFromShell, isInitialized, selectedSession?.id]);

  return {
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
  };
}

export { getPersistedState };
