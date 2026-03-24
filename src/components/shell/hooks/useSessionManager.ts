import { useCallback, useRef, useState } from 'react';

const MAX_CACHED_SESSIONS = 5;

export interface SessionEntry {
  sessionId: string;
  lastActiveTime: number;
  status: 'running' | 'idle' | 'disconnected';
}

export function useSessionManager() {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const orderRef = useRef<string[]>([]);

  const getOrCreateSession = useCallback((sessionId: string): { isNew: boolean; evictedId: string | null } => {
    let evictedId: string | null = null;
    let isNew = false;

    setSessions((prev) => {
      const existing = prev.find((s) => s.sessionId === sessionId);
      if (existing) {
        return prev.map((s) =>
          s.sessionId === sessionId ? { ...s, lastActiveTime: Date.now() } : s,
        );
      }

      // Mark as new session (set inside updater to avoid stale state)
      isNew = true;

      let next = [...prev, { sessionId, lastActiveTime: Date.now(), status: 'disconnected' as const }];

      // LRU eviction if over limit
      if (next.length > MAX_CACHED_SESSIONS) {
        const sorted = [...next].sort((a, b) => a.lastActiveTime - b.lastActiveTime);
        evictedId = sorted[0].sessionId;
        next = next.filter((s) => s.sessionId !== evictedId);
      }

      return next;
    });

    // Update tab order
    if (!orderRef.current.includes(sessionId)) {
      orderRef.current = [...orderRef.current, sessionId];
    }

    return { isNew, evictedId };
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    getOrCreateSession(sessionId);
    setActiveSessionId(sessionId);
  }, [getOrCreateSession]);

  const closeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    orderRef.current = orderRef.current.filter((id) => id !== sessionId);

    setActiveSessionId((prev) => {
      if (prev !== sessionId) return prev;
      const remaining = orderRef.current;
      return remaining.length > 0 ? remaining[remaining.length - 1] : null;
    });
  }, []);

  const updateStatus = useCallback((sessionId: string, status: SessionEntry['status']) => {
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, status } : s)),
    );
  }, []);

  const reorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    const next = [...orderRef.current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    orderRef.current = next;
    setSessions((prev) => [...prev]); // trigger re-render
  }, []);

  return {
    sessions,
    activeSessionId,
    tabOrder: orderRef.current,
    switchSession,
    closeSession,
    updateStatus,
    reorderSessions,
  };
}
