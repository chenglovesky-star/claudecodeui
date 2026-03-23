import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`;
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
};

// ─── Constants (MUST match server/config/constants.js) ───
const HEARTBEAT_INTERVAL_MS = 20000;       // Aligned with server
const HEARTBEAT_ACK_TIMEOUT_MS = 8000;     // Ack timeout
const HEARTBEAT_MAX_MISSED = 2;            // Disconnect after 2 consecutive misses
const RECONNECT_BASE_MS = 1000;      // Initial reconnect delay
const RECONNECT_MAX_MS = 30000;      // Max reconnect delay
const MESSAGE_QUEUE_MAX = 50;        // Max queued messages to prevent memory issues
const AUTH_FAILURE_MAX = 3;          // Auto-logout after N consecutive auth failures

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const messageQueueRef = useRef<any[]>([]);
  const isConnectingRef = useRef(false); // Prevent duplicate connect() calls
  const missedCountRef = useRef(0);
  const lastSeqIdRef = useRef<number>(0);
  const activeSessionIdRef = useRef<string | null>(null);
  const authFailureCountRef = useRef(0);
  const { token, logout } = useAuth();

  // ─── Heartbeat ───
  const clearPongTimeout = useCallback(() => {
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    clearPongTimeout();
  }, [clearPongTimeout]);

  const startHeartbeat = useCallback((ws: WebSocket) => {
    stopHeartbeat();
    missedCountRef.current = 0;
    heartbeatTimerRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));

        clearPongTimeout();
        pongTimeoutRef.current = setTimeout(() => {
          missedCountRef.current++;
          console.warn(`[WS] Heartbeat ack timeout (${missedCountRef.current}/${HEARTBEAT_MAX_MISSED})`);
          if (missedCountRef.current >= HEARTBEAT_MAX_MISSED) {
            console.warn('[WS] Connection appears dead, forcing reconnect');
            ws.close();
          }
        }, HEARTBEAT_ACK_TIMEOUT_MS);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, [stopHeartbeat, clearPongTimeout]);

  // ─── Message Queue ───
  const flushMessageQueue = useCallback((ws: WebSocket) => {
    while (messageQueueRef.current.length > 0) {
      const msg = messageQueueRef.current.shift();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    }
  }, []);

  // ─── Connect ───
  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (isConnectingRef.current) return; // Prevent duplicate connections

    isConnectingRef.current = true;

    // Clean up any pending reconnect timer
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }

    try {
      const wsUrl = buildWebSocketUrl(token);
      if (!wsUrl) {
        isConnectingRef.current = false;
        return console.warn('No authentication token found for WebSocket connection');
      }

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        isConnectingRef.current = false;
        setIsConnected(true);
        wsRef.current = websocket;
        reconnectAttemptRef.current = 0;
        authFailureCountRef.current = 0; // Connection succeeded, reset auth failure count
        startHeartbeat(websocket);
        flushMessageQueue(websocket);

        // Resume active session if reconnecting
        if (activeSessionIdRef.current && lastSeqIdRef.current > 0) {
          console.log(`[WS] Resuming session ${activeSessionIdRef.current} from seqId ${lastSeqIdRef.current}`);
          websocket.send(JSON.stringify({
            type: 'resume',
            sessionId: activeSessionIdRef.current,
            lastSeqId: lastSeqIdRef.current,
          }));
        }
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle heartbeat-ack — clear timeout, connection is alive
          if (data.type === 'heartbeat-ack') {
            clearPongTimeout();
            missedCountRef.current = 0;
            return;
          }

          if (data.type === 'resume-response') {
            console.log(`[WS] Resume response received, state: ${data.currentState}`);
            lastSeqIdRef.current = data.lastSeqId || lastSeqIdRef.current;
            setLatestMessage(data);
            return;
          }

          // Track seqId for gap detection
          if (data.seqId !== undefined) {
            if (data.seqId > lastSeqIdRef.current + 1 && lastSeqIdRef.current > 0) {
              console.warn(`[WS] SeqId gap: expected ${lastSeqIdRef.current + 1}, got ${data.seqId}`);
            }
            lastSeqIdRef.current = data.seqId;
          }

          // Track active session
          if (data.sessionId) {
            activeSessionIdRef.current = data.sessionId;
          }

          // Debug flow logging
          const elapsed = (window as any).__msgSentAt
            ? `+${((performance.now() - (window as any).__msgSentAt) / 1000).toFixed(2)}s`
            : '';
          if (data.type === 'claude-phase') {
            console.log(`[FLOW] 📡 ${elapsed} phase: ${data.phase}`);
          } else if (data.type === 'session-created') {
            console.log(`[FLOW] 🆔 ${elapsed} session-created: ${data.sessionId}`);
          } else if (data.type === 'claude-response') {
            const inner = data.data;
            if (inner?.type === 'content_block_start') {
              console.log(`[FLOW] 🔵 ${elapsed} content_block_start: ${inner.content_block?.type || 'unknown'}`);
            } else if (inner?.type === 'content_block_delta') {
              const deltaType = inner.delta?.type || '';
              const deltaText = inner.delta?.text || inner.delta?.thinking || '';
              console.log(`[FLOW] ✏️ ${elapsed} content_block_delta [${deltaType}]: "${deltaText.slice(0, 60)}"`);
            } else if (inner?.type === 'content_block_stop') {
              console.log(`[FLOW] ⏹️ ${elapsed} content_block_stop`);
            } else if (inner?.type === 'result') {
              console.log(`[FLOW] ✅ ${elapsed} result (complete)`, JSON.stringify(inner).slice(0, 200));
            } else if (inner?.type === 'assistant' || (inner?.content && Array.isArray(inner.content))) {
              const parts = inner.content || [];
              const partTypes = parts.map((p: any) => `${p.type}${p.type === 'text' ? `(${(p.text || '').length}ch)` : p.type === 'tool_use' ? `(${p.name})` : ''}`);
              console.log(`[FLOW] 📦 ${elapsed} assistant message parts: [${partTypes.join(', ')}]`);
              console.log(`[FLOW] 📦 raw content:`, JSON.stringify(parts).slice(0, 300));
            } else {
              console.log(`[FLOW] 📨 ${elapsed} claude-response:`, inner?.type || 'unknown', JSON.stringify(inner).slice(0, 200));
            }
          } else if (data.type === 'claude-complete') {
            console.log(`[FLOW] 🏁 ${elapsed} claude-complete`);
            (window as any).__msgSentAt = null;
          } else if (data.type === 'claude-error') {
            console.log(`[FLOW] ❌ ${elapsed} claude-error:`, data.error);
          }

          setLatestMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = (event) => {
        isConnectingRef.current = false;
        setIsConnected(false);
        wsRef.current = null;
        stopHeartbeat();

        if (unmountedRef.current) return;

        // WebSocket upgrade rejected (auth failure) → code is typically 1006
        // If connection never opened (onopen never fired), it's likely an auth rejection
        if (reconnectAttemptRef.current > 0 && !event.wasClean) {
          authFailureCountRef.current += 1;
          if (authFailureCountRef.current >= AUTH_FAILURE_MAX) {
            console.warn('[WS] Too many consecutive auth failures, clearing session');
            logout();
            return;
          }
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current),
          RECONNECT_MAX_MS,
        );
        reconnectAttemptRef.current += 1;

        console.log(`[WS] Connection closed (code: ${event.code}), reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          if (!unmountedRef.current) connect();
        }, delay);
      };

      websocket.onerror = () => {
        // onclose will fire after onerror, so reconnect logic is handled there
      };

    } catch (error) {
      isConnectingRef.current = false;
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token, startHeartbeat, stopHeartbeat, flushMessageQueue, clearPongTimeout, logout]);

  // ─── Lifecycle ───
  useEffect(() => {
    unmountedRef.current = false;
    connect();

    // Reconnect when tab becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reconnectAttemptRef.current = 0;
          connect();
        }
      }
    };

    // Reconnect when network comes back online
    const handleOnline = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reconnectAttemptRef.current = 0;
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      unmountedRef.current = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      stopHeartbeat();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]);

  // ─── Send with queue ───
  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      // Queue message with size limit
      if (messageQueueRef.current.length < MESSAGE_QUEUE_MAX) {
        messageQueueRef.current.push(message);
        console.warn(`[WS] Not connected, message queued (${messageQueueRef.current.length}/${MESSAGE_QUEUE_MAX})`);
      } else {
        console.error('[WS] Message queue full, dropping message');
      }
      // Trigger immediate reconnect if not already in progress
      if (!isConnectingRef.current && !reconnectTimeoutRef.current) {
        reconnectAttemptRef.current = 0;
        connect();
      }
    }
  }, [connect]);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected
  }), [sendMessage, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
