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
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

// Heartbeat interval (25s - below common 30s proxy timeout)
const HEARTBEAT_INTERVAL_MS = 25000;
// Reconnect settings
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const messageQueueRef = useRef<any[]>([]);
  const { token } = useAuth();

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback((ws: WebSocket) => {
    stopHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, [stopHeartbeat]);

  const flushMessageQueue = useCallback((ws: WebSocket) => {
    while (messageQueueRef.current.length > 0) {
      const msg = messageQueueRef.current.shift();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const wsUrl = buildWebSocketUrl(token);
      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setIsConnected(true);
        wsRef.current = websocket;
        reconnectAttemptRef.current = 0;
        startHeartbeat(websocket);
        flushMessageQueue(websocket);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Ignore pong responses
          if (data.type === 'pong') return;

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
              // Show first 200 chars of full content for debugging
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

      websocket.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        stopHeartbeat();

        if (unmountedRef.current) return;

        // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current),
          RECONNECT_MAX_MS,
        );
        reconnectAttemptRef.current += 1;

        reconnectTimeoutRef.current = setTimeout(() => {
          if (!unmountedRef.current) connect();
        }, delay);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token, startHeartbeat, stopHeartbeat, flushMessageQueue]);

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
      reconnectAttemptRef.current = 0;
      connect();
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

  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      // Queue message for sending after reconnect
      messageQueueRef.current.push(message);
      console.warn('WebSocket not connected, message queued for retry');
      // Trigger immediate reconnect
      if (!reconnectTimeoutRef.current) {
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
