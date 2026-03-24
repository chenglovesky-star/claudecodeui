import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_CACHED_SESSIONS = 5;

export interface SessionEntry {
  sessionId: string;
  lastActiveTime: number;
  status: 'running' | 'idle' | 'disconnected';
}

export function useSessionManager() {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [tabOrder, setTabOrder] = useState<string[]>([]);

  // Refs kept in sync for synchronous reads inside updaters
  const sessionsRef = useRef<SessionEntry[]>([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const tabOrderRef = useRef<string[]>([]);
  useEffect(() => { tabOrderRef.current = tabOrder; }, [tabOrder]);

  const getOrCreateSession = useCallback((sessionId: string): { isNew: boolean; evictedId: string | null } => {
    const currentSessions = sessionsRef.current;
    const existing = currentSessions.find((s) => s.sessionId === sessionId);
    const isNew = !existing;
    let evictedId: string | null = null;

    // Compute eviction synchronously
    if (isNew && currentSessions.length >= MAX_CACHED_SESSIONS) {
      const sorted = [...currentSessions].sort((a, b) => a.lastActiveTime - b.lastActiveTime);
      evictedId = sorted[0].sessionId;
    }

    setSessions((prev) => {
      if (!isNew) {
        return prev.map((s) =>
          s.sessionId === sessionId ? { ...s, lastActiveTime: Date.now() } : s,
        );
      }
      let next = [...prev, { sessionId, lastActiveTime: Date.now(), status: 'disconnected' as const }];
      if (evictedId) {
        next = next.filter((s) => s.sessionId !== evictedId);
      }
      return next;
    });

    setTabOrder((prev) => {
      let next = prev.includes(sessionId) ? prev : [...prev, sessionId];
      if (evictedId) next = next.filter((id) => id !== evictedId);
      return next;
    });

    return { isNew, evictedId };
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    getOrCreateSession(sessionId);
    setActiveSessionId(sessionId);
  }, [getOrCreateSession]);

  const closeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    setTabOrder((prev) => prev.filter((id) => id !== sessionId));

    setActiveSessionId((prev) => {
      if (prev !== sessionId) return prev;
      const remaining = tabOrderRef.current.filter((id) => id !== sessionId);
      return remaining.length > 0 ? remaining[remaining.length - 1] : null;
    });
  }, []);

  const updateStatus = useCallback((sessionId: string, status: SessionEntry['status']) => {
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, status } : s)),
    );
  }, []);

  const reorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    setTabOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  return {
    sessions,
    activeSessionId,
    tabOrder,
    switchSession,
    closeSession,
    updateStatus,
    reorderSessions,
  };
}
