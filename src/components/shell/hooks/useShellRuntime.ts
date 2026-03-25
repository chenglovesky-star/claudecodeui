import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { UseShellRuntimeOptions, UseShellRuntimeResult } from '../types/types';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { useShellConnection } from './useShellConnection';
import { useShellTerminal } from './useShellTerminal';

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

const PTY_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes，与后端一致

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

  const { isInitialized, clearTerminalScreen, disposeTerminal } = useShellTerminal({
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

  const { isConnected, isConnecting, isReconnecting, reconnectAttempt, connectToShell, disconnectFromShell } = useShellConnection({
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

  // 连接成功时持久化 shell 会话信息
  useEffect(() => {
    if (!isConnected || !selectedProject) {
      return;
    }

    const projectPath = selectedProject.fullPath || selectedProject.path || '';
    const key = `shell-active-session-${simpleHash(projectPath)}`;
    const value = JSON.stringify({
      sessionId: selectedSession?.id || null,
      provider: selectedSession?.__provider || localStorage.getItem('selected-provider') || 'claude',
      projectPath,
      connectedAt: Date.now(),
    });

    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage unavailable or full
    }
  }, [isConnected, selectedProject, selectedSession]);

  // 页面加载时自动恢复上次的 shell 会话
  useEffect(() => {
    if (!isInitialized || isConnected || isConnecting || !selectedProject || !autoConnect) {
      return;
    }

    const projectPath = selectedProject.fullPath || selectedProject.path || '';
    const key = `shell-active-session-${simpleHash(projectPath)}`;

    try {
      const stored = localStorage.getItem(key);
      if (!stored) return;

      const { connectedAt } = JSON.parse(stored);
      const elapsed = Date.now() - connectedAt;

      if (elapsed > PTY_SESSION_TIMEOUT_MS) {
        // 超过 30 分钟，PTY 已销毁，清除旧记录
        localStorage.removeItem(key);
        return;
      }

      // 在 30 分钟内，自动重连
      connectToShell();
    } catch {
      // JSON parse error or localStorage unavailable
    }
  }, [isInitialized, isConnected, isConnecting, selectedProject, autoConnect, connectToShell]);

  useEffect(() => {
    if (!isRestarting) {
      return;
    }

    if (selectedProject) {
      const projectPath = selectedProject.fullPath || selectedProject.path || '';
      try {
        localStorage.removeItem(`shell-active-session-${simpleHash(projectPath)}`);
      } catch {
        // localStorage unavailable
      }
    }

    disconnectFromShell();
    disposeTerminal();
  }, [disconnectFromShell, disposeTerminal, isRestarting, selectedProject]);

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
    isReconnecting,
    reconnectAttempt,
    authUrl,
    authUrlVersion,
    connectToShell,
    disconnectFromShell,
    openAuthUrlInBrowser,
    copyAuthUrlToClipboard,
  };
}
