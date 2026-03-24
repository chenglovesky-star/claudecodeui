import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { Project, ProjectSession } from '../../../types/app';
import {
  TERMINAL_INIT_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_JITTER_FACTOR,
  OUTPUT_FRAME_MAX_BYTES,
} from '../constants/constants';
import { getShellWebSocketUrl, parseShellMessage, sendSocketMessage } from '../utils/socket';

const ANSI_ESCAPE_REGEX =
  /(?:\u001B\[[0-?]*[ -/]*[@-~]|\u009B[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u009D[^\u0007\u009C]*(?:\u0007|\u009C)|\u001B[PX^_][^\u001B]*\u001B\\|[\u0090\u0098\u009E\u009F][^\u009C]*\u009C|\u001B[@-Z\\-_])/g;
const PROCESS_EXIT_REGEX = /Process exited with code (\d+)/;

type UseShellConnectionOptions = {
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  selectedProjectRef: MutableRefObject<Project | null | undefined>;
  selectedSessionRef: MutableRefObject<ProjectSession | null | undefined>;
  initialCommandRef: MutableRefObject<string | null | undefined>;
  isPlainShellRef: MutableRefObject<boolean>;
  onProcessCompleteRef: MutableRefObject<((exitCode: number) => void) | null | undefined>;
  isInitialized: boolean;
  autoConnect: boolean;
  closeSocket: () => void;
  clearTerminalScreen: () => void;
  setAuthUrl: (nextAuthUrl: string) => void;
  onOutputRef?: MutableRefObject<(() => void) | null>;
};

type UseShellConnectionResult = {
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  reconnectCountdown: number;
  connectionError: string | null;
  closeSocket: () => void;
  connectToShell: () => void;
  disconnectFromShell: () => void;
  cancelReconnect: () => void;
};

export function useShellConnection({
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
  setAuthUrl,
  onOutputRef,
}: UseShellConnectionOptions): UseShellConnectionResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const isConnectedRef = useRef(false);
  const isConnectingRef = useRef(false);
  const connectingRef = useRef(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [reconnectCountdown, setReconnectCountdown] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 用 ref 跟踪当前重连次数，避免 onclose 闭包中读到 stale state
  const reconnectAttemptRef = useRef(0);
  // 用 ref 持有 scheduleReconnect，打破 connectWebSocket <-> scheduleReconnect 循环依赖
  const scheduleReconnectRef = useRef<(attempt: number) => void>(() => {});

  // rAF output write buffer
  const pendingBufferRef = useRef<string[]>([]);
  const rafHandleRef = useRef<number | null>(null);
  const pendingBytesRef = useRef(0);

  const flushBuffer = useCallback(() => {
    rafHandleRef.current = null;
    const terminal = terminalRef.current;
    if (!terminal || pendingBufferRef.current.length === 0) return;

    let totalBytes = 0;
    const toWrite: string[] = [];
    const remaining: string[] = [];
    let exceededLimit = false;

    for (const chunk of pendingBufferRef.current) {
      if (exceededLimit) {
        remaining.push(chunk);
        continue;
      }
      totalBytes += chunk.length;
      if (totalBytes > OUTPUT_FRAME_MAX_BYTES) {
        exceededLimit = true;
        remaining.push(chunk);
      } else {
        toWrite.push(chunk);
      }
    }

    if (toWrite.length > 0) {
      terminal.write(toWrite.join(''));
    }

    pendingBufferRef.current = remaining;
    pendingBytesRef.current = remaining.reduce((sum, c) => sum + c.length, 0);

    // If there's remaining data, schedule next frame
    if (remaining.length > 0) {
      rafHandleRef.current = requestAnimationFrame(flushBuffer);
    }
  }, [terminalRef]);

  const handleProcessCompletion = useCallback(
    (output: string) => {
      if (!isPlainShellRef.current || !onProcessCompleteRef.current) {
        return;
      }

      const sanitizedOutput = output.replace(ANSI_ESCAPE_REGEX, '');
      const cleanOutput = sanitizedOutput;
      if (cleanOutput.includes('Process exited with code 0')) {
        onProcessCompleteRef.current(0);
        return;
      }

      const match = cleanOutput.match(PROCESS_EXIT_REGEX);
      if (!match) {
        return;
      }

      const exitCode = Number.parseInt(match[1], 10);
      if (!Number.isNaN(exitCode) && exitCode !== 0) {
        onProcessCompleteRef.current(exitCode);
      }
    },
    [isPlainShellRef, onProcessCompleteRef],
  );

  const handleSocketMessage = useCallback(
    (rawPayload: string) => {
      const message = parseShellMessage(rawPayload);
      if (!message) {
        console.error('[Shell] Error handling WebSocket message:', rawPayload);
        return;
      }

      if (message.type === 'output') {
        const output = typeof message.data === 'string' ? message.data : '';
        handleProcessCompletion(output);
        pendingBufferRef.current.push(output);
        pendingBytesRef.current += output.length;
        if (rafHandleRef.current === null) {
          rafHandleRef.current = requestAnimationFrame(flushBuffer);
        }
        onOutputRef?.current?.();
        return;
      }

      if (message.type === 'auth_url' || message.type === 'url_open') {
        const nextAuthUrl = typeof message.url === 'string' ? message.url : '';
        if (nextAuthUrl) {
          setAuthUrl(nextAuthUrl);
        }
      }
    },
    [flushBuffer, handleProcessCompletion, onOutputRef, setAuthUrl, terminalRef],
  );

  const clearReconnectTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const connectWebSocket = useCallback(
    (isConnectionLocked = false) => {
      if ((connectingRef.current && !isConnectionLocked) || isConnectingRef.current || isConnectedRef.current) {
        return;
      }

      // Prevent duplicate connections: if a WebSocket already exists and is active, skip
      const existingSocket = wsRef.current;
      if (existingSocket && (existingSocket.readyState === WebSocket.OPEN || existingSocket.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        const wsUrl = getShellWebSocketUrl();
        if (!wsUrl) {
          connectingRef.current = false;
          isConnectingRef.current = false;
          setIsConnecting(false);
          return;
        }

        connectingRef.current = true;

        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
          isConnectedRef.current = true;
          isConnectingRef.current = false;
          setIsConnected(true);
          setIsConnecting(false);
          connectingRef.current = false;
          setAuthUrl('');
          clearReconnectTimers();
          setReconnectAttempt(0);
          setReconnectCountdown(0);
          setConnectionError(null);
          reconnectAttemptRef.current = 0;

          window.setTimeout(() => {
            const currentTerminal = terminalRef.current;
            const currentFitAddon = fitAddonRef.current;
            const currentProject = selectedProjectRef.current;
            if (!currentTerminal || !currentFitAddon || !currentProject) {
              return;
            }

            currentFitAddon.fit();

            sendSocketMessage(socket, {
              type: 'init',
              projectPath: currentProject.fullPath || currentProject.path || '',
              sessionId: isPlainShellRef.current ? null : selectedSessionRef.current?.id || null,
              hasSession: isPlainShellRef.current ? false : Boolean(selectedSessionRef.current),
              provider: isPlainShellRef.current ? 'plain-shell' : (selectedSessionRef.current?.__provider || localStorage.getItem('selected-provider') || 'claude'),
              cols: currentTerminal.cols,
              rows: currentTerminal.rows,
              initialCommand: initialCommandRef.current,
              isPlainShell: isPlainShellRef.current,
            });
          }, TERMINAL_INIT_DELAY_MS);
        };

        socket.onmessage = (event) => {
          const rawPayload = typeof event.data === 'string' ? event.data : String(event.data ?? '');
          handleSocketMessage(rawPayload);
        };

        socket.onclose = () => {
          isConnectedRef.current = false;
          isConnectingRef.current = false;
          setIsConnected(false);
          setIsConnecting(false);
          connectingRef.current = false;

          if (intentionalDisconnectRef.current) {
            // User-initiated disconnect: clear screen, no reconnect
            clearTerminalScreen();
            intentionalDisconnectRef.current = false;
          } else {
            // Passive disconnect: preserve terminal content, trigger auto-reconnect
            // Use ref to avoid stale closure
            scheduleReconnectRef.current(reconnectAttemptRef.current);
          }
        };

        socket.onerror = () => {
          isConnectedRef.current = false;
          isConnectingRef.current = false;
          setIsConnected(false);
          setIsConnecting(false);
          connectingRef.current = false;
          if (!intentionalDisconnectRef.current) {
            scheduleReconnectRef.current(reconnectAttemptRef.current);
          }
        };
      } catch {
        isConnectedRef.current = false;
        isConnectingRef.current = false;
        setIsConnected(false);
        setIsConnecting(false);
        connectingRef.current = false;
      }
    },
    [
      clearReconnectTimers,
      clearTerminalScreen,
      fitAddonRef,
      handleSocketMessage,
      initialCommandRef,
      isPlainShellRef,
      selectedProjectRef,
      selectedSessionRef,
      setAuthUrl,
      terminalRef,
      wsRef,
    ],
  );

  const scheduleReconnect = useCallback(
    (attempt: number) => {
      if (attempt >= RECONNECT_MAX_ATTEMPTS) {
        setConnectionError('已达最大重连次数');
        setReconnectAttempt(0);
        setReconnectCountdown(0);
        reconnectAttemptRef.current = 0;
        return;
      }

      const baseDelay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = baseDelay * RECONNECT_JITTER_FACTOR * (Math.random() * 2 - 1);
      const delay = Math.round(baseDelay + jitter);
      const delaySec = Math.ceil(delay / 1000);

      reconnectAttemptRef.current = attempt + 1;
      setReconnectAttempt(attempt + 1);
      setReconnectCountdown(delaySec);
      setConnectionError(null);

      countdownTimerRef.current = setInterval(() => {
        setReconnectCountdown((prev) => {
          if (prev <= 1) {
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      reconnectTimerRef.current = setTimeout(() => {
        connectWebSocket(true);
      }, delay);
    },
    [connectWebSocket],
  );

  // 保持 ref 与最新 scheduleReconnect 同步，供 connectWebSocket 闭包内使用
  scheduleReconnectRef.current = scheduleReconnect;

  const cancelReconnect = useCallback(() => {
    clearReconnectTimers();
    setReconnectAttempt(0);
    setReconnectCountdown(0);
    setConnectionError(null);
    reconnectAttemptRef.current = 0;
  }, [clearReconnectTimers]);

  const connectToShell = useCallback(() => {
    if (!isInitialized || isConnectedRef.current || isConnectingRef.current || connectingRef.current) {
      return;
    }

    connectingRef.current = true;
    isConnectingRef.current = true;
    setIsConnecting(true);
    connectWebSocket(true);
  }, [connectWebSocket, isInitialized]);

  const disconnectFromShell = useCallback(() => {
    intentionalDisconnectRef.current = true;
    clearReconnectTimers();
    closeSocket();
    clearTerminalScreen();
    isConnectedRef.current = false;
    isConnectingRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);
    connectingRef.current = false;
    setAuthUrl('');
    setReconnectAttempt(0);
    setReconnectCountdown(0);
    setConnectionError(null);
    reconnectAttemptRef.current = 0;
  }, [clearReconnectTimers, clearTerminalScreen, closeSocket, setAuthUrl]);

  useEffect(() => {
    if (!autoConnect || !isInitialized || isConnecting || isConnected) {
      return;
    }

    connectToShell();

    return () => {
      // Cleanup: prevent stale effect from leaving orphan connections
      // (e.g., React 18 Strict Mode double-mount or rapid re-renders)
      connectingRef.current = false;
    };
  }, [autoConnect, connectToShell, isConnected, isConnecting, isInitialized]);

  // Cleanup reconnect timers and rAF on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
      }
    };
  }, []);

  return {
    isConnected,
    isConnecting,
    isReconnecting: reconnectAttempt > 0 && !isConnected,
    reconnectAttempt,
    reconnectCountdown,
    connectionError,
    closeSocket,
    connectToShell,
    disconnectFromShell,
    cancelReconnect,
  };
}
