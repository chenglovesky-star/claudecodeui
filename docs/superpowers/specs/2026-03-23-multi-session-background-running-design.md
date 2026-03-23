# Multi-Session Background Running Design

## Problem

When a user submits a question in Session A, then switches to Session B and submits another question, Session A's streaming response is silently dropped by the frontend message filter. Switching back to Session A shows no result. The server-side session continues running, but the client never receives or displays the output.

Three root causes:

1. **Frontend message discard**: `useChatRealtimeHandlers` filters messages by `activeViewSessionId`. Non-matching streaming content is dropped (only lifecycle events are kept).
2. **Single-session resume**: `activeSessionIdRef` tracks only the last session. WebSocket reconnect only resumes that one session.
3. **No user awareness**: No indication that background sessions are still running when switching pages.

## Solution Overview

Frontend-only changes (no server modifications needed):

1. Buffer background session messages in memory instead of discarding them
2. Show a Toast notification when switching away from an active session
3. Display a pulse indicator on running sessions in the sidebar
4. Support multi-session resume on WebSocket reconnect

## Detailed Design

### 1. Background Session Message Buffer

**File**: `src/components/chat/hooks/useChatRealtimeHandlers.ts`

**Current behavior** (line ~285):
```typescript
if (latestMessage.sessionId !== activeViewSessionId) {
  if (isLifecycleMessage) handleBackgroundLifecycle(latestMessage.sessionId);
  return; // discard non-lifecycle messages
}
```

**New behavior**:
```typescript
if (latestMessage.sessionId !== activeViewSessionId) {
  // Buffer instead of discard
  bufferBackgroundMessage(latestMessage.sessionId, latestMessage);

  if (isLifecycleMessage) handleBackgroundLifecycle(latestMessage.sessionId);
  return;
}
```

**Buffer data structure** (new ref in the hook):
```typescript
const backgroundBuffersRef = useRef<Map<string, {
  messages: any[];
  status: 'processing' | 'completed' | 'error' | 'timeout';
}>>(new Map());
```

**Memory protection**:
- Max 500 messages per session buffer
- Oldest messages dropped when limit exceeded
- Buffer auto-cleared 5 minutes after session completes/errors

**Replay on switch**: When `activeViewSessionId` changes and a buffer exists for the new session, batch-replay all buffered messages through the existing message handlers, then clear the buffer.

### 2. Active Session Switch Notification

**Trigger**: User switches Session or Project while `processingSessions.size > 0`.

**Implementation**: Non-blocking Toast notification.

**Message**: "有 N 个任务正在后台运行，切回可查看结果"

**Location**: Add check in the session/project switch handler (likely in `AppContent.tsx` or sidebar click handlers). Use the existing toast/notification system if available, otherwise a minimal floating notification.

### 3. Sidebar Running Indicator

**File**: Sidebar session list component (under `src/components/sidebar/`)

**Design**: A small animated pulse dot next to sessions that are in `processingSessions` set.

**Data flow**: `useSessionProtection` already tracks `processingSessions` as a `Set<string>`. Expose this to the sidebar component via props or context. The sidebar renders the indicator when a session's ID is in the set.

### 4. Multi-Session Resume

**File**: `src/contexts/WebSocketContext.tsx`

**Change 1** — Track all active sessions:
```typescript
// Before
const activeSessionIdRef = useRef<string | null>(null);

// After
const activeSessionIdsRef = useRef<Set<string>>(new Set());
```

Add to set when a session-created or streaming message arrives. Remove on session-completed, session-error, session-timeout, session-aborted.

**Change 2** — Per-session seqId tracking:
```typescript
// Before
const lastSeqIdRef = useRef<number>(0);

// After
const lastSeqIdMapRef = useRef<Map<string, number>>(new Map());
```

Update the correct entry when `data.seqId` arrives (keyed by `data.sessionId`).

**Change 3** — Resume all active sessions on reconnect:
```typescript
// In onopen callback
activeSessionIdsRef.current.forEach(sessionId => {
  const lastSeqId = lastSeqIdMapRef.current.get(sessionId) || 0;
  if (lastSeqId > 0) {
    websocket.send(JSON.stringify({
      type: 'resume',
      sessionId,
      lastSeqId,
    }));
  }
});
```

**Cleanup**: When a session ends (completed/error/timeout/aborted), remove from both `activeSessionIdsRef` and `lastSeqIdMapRef`.

## Files Changed

| File | Change |
|------|--------|
| `src/components/chat/hooks/useChatRealtimeHandlers.ts` | Background message buffering + replay on view switch |
| `src/contexts/WebSocketContext.tsx` | Multi-session activeSessionIds Set + per-session seqId Map + multi-resume |
| `src/hooks/useSessionProtection.ts` | Expose processingSessions for sidebar/toast consumption |
| `src/components/sidebar/` (session list component) | Pulse indicator for running sessions |
| `src/components/app/AppContent.tsx` or session switch handler | Toast notification on switch |

## Files NOT Changed

Server-side code requires no modifications. The existing architecture already supports:
- Per-session provider instances (`ProcessManager`)
- Session-scoped message routing (`MessageRouter` + `sessionId`)
- Connection rebinding on resume (`SessionManager.rebindConnection`)

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Memory usage from buffering | 500-message cap per session + auto-cleanup after 5 min |
| Replay ordering issues | Messages are buffered in arrival order; replay sequentially |
| seqId Map growing unbounded | Cleanup entries when sessions end |
| Toast fatigue | Only show once per switch, not repeatedly |

## Success Criteria

1. User submits in Session A, switches to Session B, submits there — both sessions complete independently
2. Switching back to Session A shows the complete response
3. Toast appears when switching away from a running session
4. Sidebar shows which sessions are still running
5. WebSocket reconnect resumes all active sessions, not just the last one
