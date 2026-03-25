import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { Project, ProjectSession } from '../../../types/app';
import { TERMINAL_INIT_DELAY_MS } from '../constants/constants';
import { getShellWebSocketUrl, parseShellMessage, sendSocketMessage } from '../utils/socket';

// ── Output throttling: batch terminal.write() via rAF to keep main thread responsive ──
const OUTPUT_BUFFER_MAX_BYTES = 65536; // 64KB per frame cap

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
  closeSocket: () => void;
  connectToShell: () => void;
  disconnectFromShell: () => void;
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
  const connectingRef = useRef(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalDisconnectRef = useRef(false);

  // ── Output batching refs ──
  const outputBufferRef = useRef<string[]>([]);
  const outputBufferSizeRef = useRef(0);
  const rafHandleRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_BASE_DELAY_MS = 1000;
  const RECONNECT_MAX_DELAY_MS = 10000;

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

  // Flush buffered output to terminal in a single write per animation frame.
  // This keeps the main thread responsive for user input during high-frequency output.
  const flushOutputBuffer = useCallback(() => {
    rafHandleRef.current = null;

    const chunks = outputBufferRef.current;
    if (chunks.length === 0) return;

    const joined = chunks.join('');
    outputBufferRef.current = [];
    outputBufferSizeRef.current = 0;

    terminalRef.current?.write(joined);
    onOutputRef?.current?.();
  }, [onOutputRef, terminalRef]);

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

        // Append to buffer instead of writing immediately
        outputBufferRef.current.push(output);
        outputBufferSizeRef.current += output.length;

        // If buffer exceeds cap, flush immediately to avoid memory buildup
        if (outputBufferSizeRef.current >= OUTPUT_BUFFER_MAX_BYTES) {
          if (rafHandleRef.current !== null) {
            cancelAnimationFrame(rafHandleRef.current);
          }
          flushOutputBuffer();
          return;
        }

        // Schedule flush on next animation frame (batches ~16ms of output)
        if (rafHandleRef.current === null) {
          rafHandleRef.current = requestAnimationFrame(flushOutputBuffer);
        }
        return;
      }

      if (message.type === 'auth_url' || message.type === 'url_open') {
        const nextAuthUrl = typeof message.url === 'string' ? message.url : '';
        if (nextAuthUrl) {
          setAuthUrl(nextAuthUrl);
        }
      }
    },
    [flushOutputBuffer, handleProcessCompletion, setAuthUrl],
  );

  const connectWebSocket = useCallback(
    (isConnectionLocked = false) => {
      if ((connectingRef.current && !isConnectionLocked) || isConnecting || isConnected) {
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
          setIsConnecting(false);
          return;
        }

        connectingRef.current = true;

        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
          if (unmountedRef.current) return;

          // 如果是重连，清屏以准备接收后端完整回放
          if (reconnectTimerRef.current !== null || isReconnecting) {
            terminalRef.current?.clear();
          }

          setIsConnected(true);
          setIsConnecting(false);
          setIsReconnecting(false);
          setReconnectAttempt(0);
          connectingRef.current = false;
          setAuthUrl('');

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
          if (unmountedRef.current) return;

          setIsConnected(false);
          setIsConnecting(false);
          connectingRef.current = false;
          // 注意：不再调用 clearTerminalScreen()，保留终端内容

          if (intentionalDisconnectRef.current) {
            return;
          }

          setReconnectAttempt((prev) => {
            const attempt = prev;

            if (attempt >= MAX_RECONNECT_ATTEMPTS) {
              setIsReconnecting(false);
              return 0;
            }

            setIsReconnecting(true);

            const baseDelay = Math.min(
              RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
              RECONNECT_MAX_DELAY_MS,
            );
            const jitter = baseDelay * (0.7 + Math.random() * 0.6);

            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current);
            }

            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null;
              if (!unmountedRef.current && !intentionalDisconnectRef.current) {
                connectWebSocket(true);
              }
            }, jitter);

            return attempt + 1;
          });
        };

        socket.onerror = () => {
          if (unmountedRef.current) return;
          setIsConnected(false);
          setIsConnecting(false);
          connectingRef.current = false;
        };
      } catch {
        setIsConnected(false);
        setIsConnecting(false);
        connectingRef.current = false;
      }
    },
    [
      fitAddonRef,
      handleSocketMessage,
      initialCommandRef,
      isConnected,
      isConnecting,
      isPlainShellRef,
      isReconnecting,
      selectedProjectRef,
      selectedSessionRef,
      setAuthUrl,
      terminalRef,
      wsRef,
    ],
  );

  const connectToShell = useCallback(() => {
    if (!isInitialized || isConnected || isConnecting || connectingRef.current) {
      return;
    }

    intentionalDisconnectRef.current = false;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setReconnectAttempt(0);
    setIsReconnecting(false);

    connectingRef.current = true;
    setIsConnecting(true);
    connectWebSocket(true);
  }, [connectWebSocket, isConnected, isConnecting, isInitialized]);

  const disconnectFromShell = useCallback(() => {
    intentionalDisconnectRef.current = true;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Cancel pending output flush
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    outputBufferRef.current = [];
    outputBufferSizeRef.current = 0;

    setReconnectAttempt(0);
    setIsReconnecting(false);

    closeSocket();
    clearTerminalScreen();
    setIsConnected(false);
    setIsConnecting(false);
    connectingRef.current = false;
    setAuthUrl('');
  }, [clearTerminalScreen, closeSocket, setAuthUrl]);

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

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (intentionalDisconnectRef.current) return;
      if (!isInitialized) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setReconnectAttempt(0);
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        connectingRef.current = false;
        setIsConnecting(false);
        connectWebSocket(true);
      }
    };

    const handleOnline = () => {
      if (intentionalDisconnectRef.current) return;
      if (!isInitialized) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setReconnectAttempt(0);
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        connectingRef.current = false;
        setIsConnecting(false);
        connectWebSocket(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [connectWebSocket, isInitialized, wsRef]);

  return {
    isConnected,
    isConnecting,
    isReconnecting,
    reconnectAttempt,
    closeSocket,
    connectToShell,
    disconnectFromShell,
  };
}
