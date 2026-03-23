# Multi-Session Background Running Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple Claude sessions to run concurrently in the background without interrupting each other when the user switches between sessions or projects.

**Architecture:** Frontend-only changes. Replace single-session tracking with multi-session tracking in WebSocketContext, buffer background session messages in useChatRealtimeHandlers instead of discarding them, add visual indicators for running sessions in the sidebar, and show a toast when switching away from active sessions.

**Tech Stack:** React, TypeScript, existing component library (lucide-react icons, cn utility)

**Spec:** `docs/superpowers/specs/2026-03-23-multi-session-background-running-design.md`

---

### Task 1: Multi-Session Tracking in WebSocketContext

Convert single-session refs to multi-session data structures so all active sessions are tracked and resumed on reconnect.

**Files:**
- Modify: `src/contexts/WebSocketContext.tsx:50-51` (refs), `:142-150` (resume), `:172-182` (seqId/session tracking)

- [ ] **Step 1: Replace single-session refs with multi-session structures**

In `src/contexts/WebSocketContext.tsx`, replace lines 50-51:

```typescript
// Before:
const lastSeqIdRef = useRef<number>(0);
const activeSessionIdRef = useRef<string | null>(null);

// After:
const lastSeqIdMapRef = useRef<Map<string, number>>(new Map());
const activeSessionIdsRef = useRef<Set<string>>(new Set());
```

- [ ] **Step 2: Update seqId and session tracking in onmessage**

Replace lines 172-182:

```typescript
// Track seqId per session for gap detection
if (data.seqId !== undefined && data.sessionId) {
  const prevSeqId = lastSeqIdMapRef.current.get(data.sessionId) || 0;
  if (data.seqId > prevSeqId + 1 && prevSeqId > 0) {
    console.warn(`[WS] SeqId gap for session ${data.sessionId}: expected ${prevSeqId + 1}, got ${data.seqId}`);
  }
  lastSeqIdMapRef.current.set(data.sessionId, data.seqId);
}

// Track all active sessions
if (data.sessionId) {
  activeSessionIdsRef.current.add(data.sessionId);
}
```

- [ ] **Step 3: Update resume logic in onopen to resume all sessions**

Replace lines 142-150:

```typescript
// Resume all active sessions if reconnecting
if (activeSessionIdsRef.current.size > 0) {
  activeSessionIdsRef.current.forEach(sessionId => {
    const lastSeqId = lastSeqIdMapRef.current.get(sessionId) || 0;
    if (lastSeqId > 0) {
      console.log(`[WS] Resuming session ${sessionId} from seqId ${lastSeqId}`);
      websocket.send(JSON.stringify({
        type: 'resume',
        sessionId,
        lastSeqId,
      }));
    }
  });
}
```

- [ ] **Step 4: Update resume-response handler**

Replace lines 164-169:

```typescript
if (data.type === 'resume-response') {
  console.log(`[WS] Resume response for session ${data.sessionId}, state: ${data.currentState}`);
  if (data.sessionId && data.lastSeqId) {
    lastSeqIdMapRef.current.set(data.sessionId, data.lastSeqId);
  }
  setLatestMessage(data);
  return;
}
```

- [ ] **Step 5: Add cleanup for completed sessions**

Add a new effect or integrate into the existing onmessage handler. After line 219 (after `setLatestMessage(data)`), add:

```typescript
// Clean up completed/errored sessions from tracking
const sessionEndTypes = new Set([
  'session-completed', 'session-aborted', 'session-timeout', 'session-error',
  'claude-complete', 'cursor-complete', 'codex-complete', 'gemini-complete',
]);
if (data.type && sessionEndTypes.has(data.type) && data.sessionId) {
  activeSessionIdsRef.current.delete(data.sessionId);
  // Keep seqId for a minute in case of late messages
  setTimeout(() => {
    lastSeqIdMapRef.current.delete(data.sessionId);
  }, 60000);
}
```

- [ ] **Step 6: Verify no other code references the old ref names**

Run:
```bash
grep -rn 'activeSessionIdRef\|lastSeqIdRef' src/contexts/WebSocketContext.tsx
```

Expected: No matches (all renamed to `activeSessionIdsRef` / `lastSeqIdMapRef`).

- [ ] **Step 7: Commit**

```bash
git add src/contexts/WebSocketContext.tsx
git commit -m "feat: multi-session tracking and resume in WebSocketContext"
```

---

### Task 2: Background Message Buffering

Buffer non-active session messages instead of discarding them. Replay when the user switches back.

**Files:**
- Modify: `src/components/chat/hooks/useChatRealtimeHandlers.ts:270-298` (session filter block)

- [ ] **Step 1: Add background buffer ref and helper functions**

Near the top of the `useEffect` in `useChatRealtimeHandlers` (around line 135), add:

```typescript
// Background session message buffer
const backgroundBuffersRef = useRef<Map<string, {
  messages: any[];
  status: 'processing' | 'completed' | 'error' | 'timeout';
  completedAt?: number;
}>>(new Map());

const BACKGROUND_BUFFER_MAX_MESSAGES = 500;
const BACKGROUND_BUFFER_TTL_MS = 5 * 60 * 1000; // 5 minutes after completion
```

Note: These should be declared at the hook level (outside useEffect), alongside the other refs like `streamBufferRef`.

- [ ] **Step 2: Add bufferBackgroundMessage function**

Add inside the useEffect, near `handleBackgroundLifecycle`:

```typescript
const bufferBackgroundMessage = (sessionId: string, message: any) => {
  if (!sessionId) return;

  let buffer = backgroundBuffersRef.current.get(sessionId);
  if (!buffer) {
    buffer = { messages: [], status: 'processing' };
    backgroundBuffersRef.current.set(sessionId, buffer);
  }

  // Memory protection: drop oldest when exceeding limit
  if (buffer.messages.length >= BACKGROUND_BUFFER_MAX_MESSAGES) {
    buffer.messages.shift();
  }

  buffer.messages.push(message);

  // Update status on lifecycle events
  const lifecycleStatuses: Record<string, 'completed' | 'error' | 'timeout'> = {
    'claude-complete': 'completed',
    'session-completed': 'completed',
    'claude-error': 'error',
    'session-error': 'error',
    'session-timeout': 'timeout',
  };
  const newStatus = lifecycleStatuses[message.type];
  if (newStatus) {
    buffer.status = newStatus;
    buffer.completedAt = Date.now();

    // Auto-cleanup after TTL
    setTimeout(() => {
      backgroundBuffersRef.current.delete(sessionId);
    }, BACKGROUND_BUFFER_TTL_MS);
  }
};
```

- [ ] **Step 3: Modify session filter to buffer instead of discard**

Replace lines 285-297 (the `if (latestMessage.sessionId !== activeViewSessionId)` block):

```typescript
if (latestMessage.sessionId !== activeViewSessionId) {
  const shouldTreatAsPendingViewLifecycle =
    !activeViewSessionId &&
    hasPendingUnboundSession &&
    latestMessage.sessionId &&
    isLifecycleMessage;

  if (!shouldTreatAsPendingViewLifecycle) {
    // Buffer ALL messages from background sessions (not just lifecycle)
    if (latestMessage.sessionId) {
      bufferBackgroundMessage(latestMessage.sessionId, latestMessage);
    }
    if (latestMessage.sessionId && isLifecycleMessage) {
      handleBackgroundLifecycle(latestMessage.sessionId);
    }
    return;
  }
}
```

- [ ] **Step 4: Add replay logic when activeViewSessionId changes**

Add a new `useEffect` in the hook that watches for view session changes:

```typescript
// Replay buffered messages when switching to a session that has background data
useEffect(() => {
  if (!activeViewSessionId) return;

  const buffer = backgroundBuffersRef.current.get(activeViewSessionId);
  if (!buffer || buffer.messages.length === 0) return;

  console.log(`[Chat] Replaying ${buffer.messages.length} buffered messages for session ${activeViewSessionId}`);

  // Replay each message by setting it as latestMessage sequentially
  // Use a microtask queue to avoid batching issues
  const messages = [...buffer.messages];
  backgroundBuffersRef.current.delete(activeViewSessionId);

  // Set each buffered message as latestMessage with a small delay
  let index = 0;
  const replayNext = () => {
    if (index < messages.length) {
      setLatestMessage(messages[index]);
      index++;
      // Use requestAnimationFrame for smooth replay
      requestAnimationFrame(replayNext);
    }
  };
  replayNext();
}, [activeViewSessionId]);
```

Note: The exact replay mechanism may need adjustment based on how `setLatestMessage` triggers the existing effect. If the existing effect processes messages synchronously, this approach works. If batching issues arise, a simpler approach is to replay all messages synchronously in a loop.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/hooks/useChatRealtimeHandlers.ts
git commit -m "feat: buffer background session messages and replay on switch"
```

---

### Task 3: Sidebar Running Session Indicator

Show a pulse dot next to sessions that are currently processing in the sidebar.

**Files:**
- Modify: `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx` (add indicator)
- Modify: `src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx` (pass prop)
- Trace prop threading from `AppContent.tsx` → `Sidebar` → `SidebarContent` → `SidebarProjectList` → `SidebarProjectSessions` → `SidebarSessionItem`

- [ ] **Step 1: Add `isProcessing` prop to SidebarSessionItem**

In `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`, add to the props type:

```typescript
type SidebarSessionItemProps = {
  // ... existing props ...
  isProcessing?: boolean;
};
```

And destructure it in the component:

```typescript
export default function SidebarSessionItem({
  // ... existing props ...
  isProcessing,
}: SidebarSessionItemProps) {
```

- [ ] **Step 2: Render pulse indicator**

Inside the session item's JSX, next to the session name or provider logo, add:

```tsx
{isProcessing && (
  <span className="relative flex h-2 w-2 flex-shrink-0">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
    <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
  </span>
)}
```

Place this right after the provider logo or session name element.

- [ ] **Step 3: Thread `processingSessions` through the component chain**

This requires passing `processingSessions: Set<string>` down from `AppContent` through:
1. `AppContent` → `MainContent` (already has `processingSessions` prop)
2. `MainContent` → `Sidebar` (add prop)
3. `Sidebar` → `SidebarContent` (add prop)
4. `SidebarContent` → `SidebarProjectList` (add prop)
5. `SidebarProjectList` → `SidebarProjectSessions` (add prop)
6. `SidebarProjectSessions` → `SidebarSessionItem` (compute `isProcessing={processingSessions.has(session.id)}`)

For each intermediate component, add `processingSessions?: Set<string>` to its props type and pass it through.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/ src/components/main-content/ src/components/app/
git commit -m "feat: add pulse indicator for running sessions in sidebar"
```

---

### Task 4: Switch-Away Toast Notification

Show a non-blocking notification when the user switches away from a page with running sessions.

**Files:**
- Create: `src/components/shared/BackgroundSessionToast.tsx`
- Modify: `src/components/app/AppContent.tsx` (add toast trigger)

- [ ] **Step 1: Create a minimal toast component**

Since the project has no toast library, create a simple self-dismissing notification:

```tsx
// src/components/shared/BackgroundSessionToast.tsx
import { useEffect, useState } from 'react';

type BackgroundSessionToastProps = {
  count: number;
  visible: boolean;
  onDismiss: () => void;
};

export default function BackgroundSessionToast({ count, visible, onDismiss }: BackgroundSessionToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible && count > 0) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        onDismiss();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [visible, count, onDismiss]);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-center gap-2 rounded-lg border border-blue-200/60 bg-blue-50/95 px-4 py-3 shadow-lg backdrop-blur-sm dark:border-blue-700/40 dark:bg-blue-900/90">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
        </span>
        <span className="text-sm text-blue-700 dark:text-blue-200">
          {count} 个任务正在后台运行，切回可查看结果
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrate toast into AppContent**

In `src/components/app/AppContent.tsx`, add state and trigger:

```typescript
const [toastCount, setToastCount] = useState(0);
const [showToast, setShowToast] = useState(false);
const prevSessionRef = useRef<string | null>(null);

// Detect session switch and trigger toast
useEffect(() => {
  const currentId = selectedSession?.id || null;
  if (prevSessionRef.current && currentId !== prevSessionRef.current && processingSessions.size > 0) {
    setToastCount(processingSessions.size);
    setShowToast(true);
  }
  prevSessionRef.current = currentId;
}, [selectedSession?.id, processingSessions.size]);
```

Add the component to the JSX:

```tsx
<BackgroundSessionToast
  count={toastCount}
  visible={showToast}
  onDismiss={() => setShowToast(false)}
/>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/shared/BackgroundSessionToast.tsx src/components/app/AppContent.tsx
git commit -m "feat: show toast notification when switching from active sessions"
```

---

### Task 5: Integration Testing & Final Verification

- [ ] **Step 1: TypeScript compilation check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Manual test scenario**

1. Open Session A, send a question
2. While A is streaming, switch to Session B
3. Verify: Toast appears saying "1 个任务正在后台运行"
4. Verify: Session A shows pulse indicator in sidebar
5. Send a question in Session B
6. Switch back to Session A
7. Verify: Session A's complete response is displayed (replayed from buffer)
8. Verify: Session B continues processing (check sidebar indicator)

- [ ] **Step 3: Final commit and push**

```bash
git push
```
