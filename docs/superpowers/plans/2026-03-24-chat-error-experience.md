# Chat 异常体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让团队多人共享场景下的 Chat 模式实现分阶段进度指示、错误分级显示、连接状态横幅、自动恢复透明化和标准化错误事件。

**Architecture:** 后端统一 errorCode + meta 格式，前端通过 ERROR_MAP 查表渲染 ErrorCard 组件。自动恢复（Key 回退、429 重试）期间暂停超时计时器，通过 phase 事件让前端实时展示恢复状态。WebSocket 断线通过 ConnectionStatusBanner 横幅显示并禁止发送。

**Tech Stack:** Node.js (server), React + TypeScript + Tailwind CSS (frontend), WebSocket

**Spec:** `docs/superpowers/specs/2026-03-24-chat-error-experience-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `src/components/chat/utils/errorMessages.ts` | ERROR_MAP: errorCode → { level, title, description, actions } |
| `src/components/chat/view/subcomponents/ErrorCard.tsx` | L2/L3 结构化错误卡片组件 |
| `src/components/chat/view/subcomponents/ConnectionStatusBanner.tsx` | WebSocket 连接状态横幅 |

### Modified Files
| File | Changes |
|------|---------|
| `server/providers/base-provider.js` | 新增 `emitRecoveryStart()` / `emitRecoveryEnd()` |
| `server/providers/claude-sdk.js` | auth-fallback phase 发送、recovery 事件、suppressError 改进 |
| `server/claude-sdk.js` | 标准 errorCode+meta 格式、streaming phase 发送 |
| `server/session/SessionManager.js` | `pauseTimers()` / `resumeTimers()`、timeout errorCode |
| `server/session/ProcessManager.js` | recovery 事件绑定转发 |
| `server/message/MessageRouter.js` | recovery 绑定、错误写入 messageBuffer、queue/quota 格式统一 |
| `server/queue/RequestQueue.js` | timeout/rejected 附带 errorCode |
| `src/components/chat/types/types.ts` | ChatMessage 扩展 errorLevel/errorCode/errorActions |
| `src/components/chat/hooks/handlers/claudeHandler.ts` | 查表逻辑、新 phase 处理、删除硬编码映射 |
| `src/components/chat/hooks/handlers/pipelineHandler.ts` | 超时处理统一为 errorCode |
| `src/components/chat/hooks/useChatRealtimeHandlers.ts` | 统一错误分发 |
| `src/components/chat/view/subcomponents/AssistantThinkingIndicator.tsx` | 多 phase 渲染 + L1 黄色提示 |
| `src/components/chat/view/subcomponents/MessageComponent.tsx` | ErrorCard 集成 |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` | 透传 onNewSession / onContinueGeneration |
| `src/components/chat/view/ChatInterface.tsx` | 横幅集成、handleNewSession、handleContinue |
| `src/components/chat/view/subcomponents/ChatComposer.tsx` | 断线 disabled |
| `src/contexts/WebSocketContext.tsx` | connectionState 枚举 |

---

### Task 1: 后端 — BaseProvider + SessionManager 基础设施

**Files:**
- Modify: `server/providers/base-provider.js`
- Modify: `server/session/SessionManager.js`

- [ ] **Step 1: BaseProvider 新增 recovery 方法**

在 `server/providers/base-provider.js` 的便捷方法区域新增：

```javascript
emitRecoveryStart() { this.emit('recovery-start'); }
emitRecoveryEnd(success) { this.emit('recovery-end', { success }); }
```

- [ ] **Step 2: SessionManager 新增 pauseTimers / resumeTimers**

在 `server/session/SessionManager.js` 的 Timer management 区域新增：

```javascript
pauseTimers(sessionId) {
  const session = this._sessions.get(sessionId);
  if (!session) return;
  const now = Date.now();
  // Save remaining time for each active timer
  session._pausedTimers = {};
  for (const key of Object.keys(session.timers)) {
    if (session.timers[key] !== null) {
      // We can't get remaining time from setTimeout, so track start time
      // For simplicity, just clear and re-create with same duration on resume
      session._pausedTimers[key] = true;
      this._clearTimeout(session.timers[key]);
      session.timers[key] = null;
    }
  }
  session._pausedAt = now;
  log.info(`Paused timers for ${sessionId}`);
}

resumeTimers(sessionId) {
  const session = this._sessions.get(sessionId);
  if (!session || !session._pausedTimers) return;
  // Re-apply timers based on current state
  const state = session.state;
  if (!['running', 'streaming', 'tool_executing'].includes(state)) {
    delete session._pausedTimers;
    delete session._pausedAt;
    return;
  }
  this._manageTimers(session, null, state);
  delete session._pausedTimers;
  delete session._pausedAt;
  log.info(`Resumed timers for ${sessionId}`);
}
```

- [ ] **Step 3: SessionManager timeout 事件附带 errorCode**

修改 `_startTimer` 方法，在 emit `session:timeout` 时附带 `errorCode`：

```javascript
_startTimer(session, timerKey, ms, timeoutType) {
  if (session.timers[timerKey] !== null) {
    this._clearTimeout(session.timers[timerKey]);
    session.timers[timerKey] = null;
  }
  session.timers[timerKey] = this._setTimeout(() => {
    session.timers[timerKey] = null;
    log.warn(`${session.sessionId} timeout: ${timeoutType}`);
    this.transition(session.sessionId, 'timeout');
    // Map timerKey to errorCode
    const errorCodeMap = {
      firstResponse: 'firstResponse',
      activity: 'activity',
      toolExecution: 'tool-timeout',
      global: 'global-timeout',
    };
    this.emit('session:timeout', {
      sessionId: session.sessionId,
      timeoutType,
      errorCode: errorCodeMap[timerKey] || timeoutType,
      meta: { timeoutMs: ms },
    });
  }, ms);
}
```

- [ ] **Step 4: 运行验证**

Run: `node -e "const {SessionManager}=await import('./server/session/SessionManager.js'); const sm=new SessionManager(); console.log('OK:', typeof sm.pauseTimers, typeof sm.resumeTimers)"`
Expected: `OK: function function`

- [ ] **Step 5: Commit**

```bash
git add server/providers/base-provider.js server/session/SessionManager.js
git commit -m "feat: add recovery events and pauseTimers/resumeTimers to backend infrastructure"
```

---

### Task 2: 后端 — ProcessManager + MessageRouter 事件管线

**Files:**
- Modify: `server/session/ProcessManager.js`
- Modify: `server/message/MessageRouter.js`

- [ ] **Step 1: ProcessManager 新增 recovery 事件绑定**

在 `server/session/ProcessManager.js` 的 `startSession()` 方法中，在现有 `provider.on('error')` 之后新增：

```javascript
// Recovery events: pause/resume timers during auto-recovery
provider.on('recovery-start', () => {
  this.emit('process:recovery-start', { sessionId });
});
provider.on('recovery-end', ({ success }) => {
  this.emit('process:recovery-end', { sessionId, success });
});
```

- [ ] **Step 2: MessageRouter bindEvents 绑定 recovery 事件**

在 `server/message/MessageRouter.js` 的 `bindEvents()` 方法末尾新增：

```javascript
// Recovery events: coordinate timeout timers
this.#processManager.on('process:recovery-start', ({ sessionId }) => {
  this.#sessionManager.pauseTimers(sessionId);
});

this.#processManager.on('process:recovery-end', ({ sessionId }) => {
  this.#sessionManager.resumeTimers(sessionId);
});
```

- [ ] **Step 3: MessageRouter 统一 timeout 事件格式**

修改 `bindEvents()` 中的 `session:timeout` 处理，将 errorCode 传递给前端：

```javascript
this.#sessionManager.on('session:timeout', ({ sessionId, timeoutType, errorCode, meta }) => {
  const session = this.#sessionManager.getSession(sessionId);
  if (session) {
    this.#transport.send(session.connectionId, {
      type: 'claude-error',
      errorCode: errorCode || timeoutType,
      error: `Session timeout: ${timeoutType}`,
      sessionId,
      meta: meta || { timeoutMs: 0 },
    });
    this.#messageBuffer.addCriticalEvent(sessionId, {
      type: 'claude-error',
      errorCode: errorCode || timeoutType,
      sessionId,
    });
  }
  this.#processManager.abortSession(sessionId);
});
```

- [ ] **Step 4: MessageRouter 统一 quota-exceeded 格式**

修改 `#startSessionDirect` 中的 quota 错误发送：

```javascript
if (err.name === 'QuotaExceededError') {
  this.#transport.send(connectionId, {
    type: 'claude-error',
    errorCode: 'quota-exceeded',
    error: err.message,
    meta: {},
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add server/session/ProcessManager.js server/message/MessageRouter.js
git commit -m "feat: wire recovery events and standardize error format in pipeline"
```

---

### Task 3: 后端 — claude-sdk.js 错误标准化 + streaming phase

**Files:**
- Modify: `server/claude-sdk.js`

- [ ] **Step 1: ws.send 错误时附带 errorCode + meta**

修改 `queryClaudeSDK` 的 catch 块（约第 753-758 行），将 `ws.send` 改为：

```javascript
// Detect error type and assign errorCode
let errorCode = 'sdk-crash';
let meta = { exitCode: error.code };
if (is429) {
  errorCode = phase === 'pre-stream' ? 'rate-limit-retry' : 'rate-limit-mid';
  meta = { partialContent: sessionCreatedSent };
} else if (error.message?.includes('authentication') || error.message?.includes('invalid api key')) {
  errorCode = 'auth-failed';
  meta = {};
}

ws.send({
  type: 'claude-error',
  errorCode,
  error: error.message,
  sessionId: capturedSessionId || sessionId || null,
  meta,
});
```

- [ ] **Step 2: 新增 streaming phase 事件**

在 `queryClaudeSDK` 的 `for await` 循环内（约第 662 行 `ws.send` 之前），新增首次 `content_block_start` 检测：

```javascript
// Track if we've sent the streaming phase
let streamingPhaseSent = false;
```

在循环变量声明区（函数开头）加入此变量。然后在循环内 `ws.send` 之前加入：

```javascript
// Send streaming phase on first content_block_start
if (!streamingPhaseSent && message.type === 'content_block_start') {
  streamingPhaseSent = true;
  ws.send({ type: 'claude-phase', phase: 'streaming', sessionId: capturedSessionId || sessionId || null });
}
```

- [ ] **Step 3: Commit**

```bash
git add server/claude-sdk.js
git commit -m "feat: standardize errorCode+meta format and add streaming phase in claude-sdk"
```

---

### Task 4: 后端 — ClaudeSDKProvider auth-fallback + recovery 事件

**Files:**
- Modify: `server/providers/claude-sdk.js`

- [ ] **Step 1: auth 回退发送 auth-fallback phase + recovery 事件**

修改 `start()` 方法中 auth 回退区块（约第 112-133 行）。在 `console.log` 之后添加 recovery 事件和 phase：

```javascript
if (isAuthError && canRetryAuth) {
  console.log('[Provider:claude-sdk] Key pool key auth failed, retrying with system auth (OAuth)...');

  // Emit recovery events to pause timers
  this.emitRecoveryStart();

  // Send auth-fallback phase (replaces configuring)
  if (transport && connectionId) {
    transport.send(connectionId, {
      type: 'claude-phase',
      phase: 'auth-fallback',
      attempt: 1,
      maxAttempts: 2,
      sessionId: null,
    });
  }

  const fallbackOptions = { ...options };
  delete fallbackOptions._assignedApiKey;
  delete fallbackOptions._assignedKeyId;
  delete fallbackOptions.sessionId;
  fallbackOptions._authRetried = true;

  try {
    await queryClaudeSDK(command, fallbackOptions, writer);
    this.emitRecoveryEnd(true);
    if (this.isRunning) this.isRunning = false;
    return;
  } catch (retryError) {
    this.emitRecoveryEnd(false);
    this.emitError(retryError);
    return;
  }
}
```

- [ ] **Step 2: 429 pre-stream 发送 rate-limit-retry phase**

在 `start()` 的 429 pre-stream 处理块中（约第 67-77 行），在 `emit('rate-limited')` 之前添加：

```javascript
if (transport && connectionId) {
  transport.send(connectionId, {
    type: 'claude-phase',
    phase: 'rate-limit-retry',
    retryAfterSec: 5,
    sessionId: null,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add server/providers/claude-sdk.js
git commit -m "feat: transparent auth-fallback and rate-limit-retry phase events"
```

---

### Task 5: 后端 — RequestQueue errorCode 标准化

**Files:**
- Modify: `server/queue/RequestQueue.js`
- Modify: `server/message/MessageRouter.js`

- [ ] **Step 1: RequestQueue timeout 事件附带 errorCode**

修改 `server/queue/RequestQueue.js` 中 timeout handler 的 emit 调用，添加 errorCode：

```javascript
this.emit('queue:timeout', {
  requestId,
  userId,
  connectionId,
  errorCode: 'queue-timeout',
  meta: { waitedSec: Math.floor((Date.now() - queuedAt) / 1000) },
});
```

- [ ] **Step 2: MessageRouter 中 queue 错误统一为 claude-error 格式**

在 `server/message/MessageRouter.js` 的 `#handleProviderCommand` 中，修改 rejected 的发送：

```javascript
if (result.rejected) {
  this.#transport.send(connectionId, {
    type: 'claude-error',
    errorCode: 'queue-full',
    error: result.reason,
    meta: { queueSize: 50 },
  });
  return;
}
```

在 `bindEvents()` 或 index.js 中处理 `queue:timeout` 事件时，统一发送 `claude-error`。

- [ ] **Step 3: Commit**

```bash
git add server/queue/RequestQueue.js server/message/MessageRouter.js
git commit -m "feat: standardize queue error events with errorCode format"
```

---

### Task 6: 前端 — ERROR_MAP + ChatMessage 类型扩展

**Files:**
- Create: `src/components/chat/utils/errorMessages.ts`
- Modify: `src/components/chat/types/types.ts`

- [ ] **Step 1: 创建 errorMessages.ts**

```typescript
// src/components/chat/utils/errorMessages.ts

export interface ErrorMapping {
  level: 1 | 2 | 3;
  title: string;
  description: string | ((meta: Record<string, unknown>) => string);
  actions: Array<'retry' | 'newSession' | 'settings' | 'continue'>;
}

export type ErrorMap = Record<string, ErrorMapping>;

export const ERROR_MAP: ErrorMap = {
  // L1 — auto-recovery (displayed in ThinkingIndicator, not ErrorCard)
  'auth-fallback': {
    level: 1,
    title: '正在切换备用通道...',
    description: (meta) => `第 ${meta.attempt || 1}/${meta.maxAttempts || 3} 次尝试`,
    actions: [],
  },
  'rate-limit-retry': {
    level: 1,
    title: 'API 繁忙，自动重试中...',
    description: (meta) => `${meta.retryAfterSec || 5} 秒后重试`,
    actions: [],
  },

  // L2 — user action required
  'firstResponse': {
    level: 2,
    title: 'API 未响应',
    description: '60 秒内未收到任何输出，可能是网络不稳定或 API 服务暂时不可用。',
    actions: ['retry', 'newSession'],
  },
  'activity': {
    level: 2,
    title: '输出中断',
    description: '120 秒无新内容，API 连接可能已中断。',
    actions: ['retry'],
  },
  'clientFallback': {
    level: 2,
    title: 'API 响应超时',
    description: '90 秒未收到数据返回，可能是网络问题或 API 服务不可用。',
    actions: ['retry', 'newSession'],
  },
  'auth-failed': {
    level: 2,
    title: '认证失败',
    description: '所有 API Key 均无法使用，请检查 Key 配置。',
    actions: ['retry', 'settings'],
  },
  'rate-limit-mid': {
    level: 2,
    title: '生成被限速中断',
    description: '已输出的内容已保留，可尝试继续生成。',
    actions: ['continue', 'retry'],
  },
  'queue-timeout': {
    level: 2,
    title: '排队超时',
    description: '等待超过 120 秒，当前系统繁忙。',
    actions: ['retry'],
  },
  'tool-timeout': {
    level: 2,
    title: '工具执行超时',
    description: '操作超过 10 分钟未完成。',
    actions: ['retry'],
  },
  'sdk-crash': {
    level: 2,
    title: '服务异常',
    description: '后端服务进程异常退出，请重试。',
    actions: ['retry', 'newSession'],
  },

  // L3 — unrecoverable
  'global-timeout': {
    level: 3,
    title: '会话已到期',
    description: '单次会话上限 30 分钟，请新建会话继续对话。',
    actions: ['newSession'],
  },
  'quota-exceeded': {
    level: 3,
    title: '并发上限',
    description: '已达最大同时会话数，请等待现有会话完成。',
    actions: [],
  },
  'queue-full': {
    level: 3,
    title: '系统繁忙',
    description: '排队已满，请稍后再试。',
    actions: [],
  },

  // Fallback
  'unknown': {
    level: 2,
    title: '发生错误',
    description: '请重试或新建会话。',
    actions: ['retry', 'newSession'],
  },
};

export function getErrorMapping(errorCode: string | undefined): ErrorMapping {
  return ERROR_MAP[errorCode || 'unknown'] || ERROR_MAP['unknown'];
}

export function getErrorDescription(mapping: ErrorMapping, meta?: Record<string, unknown>): string {
  if (typeof mapping.description === 'function') {
    return mapping.description(meta || {});
  }
  return mapping.description;
}
```

- [ ] **Step 2: ChatMessage 类型扩展**

在 `src/components/chat/types/types.ts` 的 `ChatMessage` interface 中新增字段：

```typescript
  errorLevel?: 1 | 2 | 3;
  errorCode?: string;
  errorActions?: string[];
```

添加在 `isTimeout?: boolean;` 和 `timeoutType?: string;` 之后。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: 无错误输出

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/utils/errorMessages.ts src/components/chat/types/types.ts
git commit -m "feat: add ERROR_MAP and extend ChatMessage with errorLevel/errorCode"
```

---

### Task 7: 前端 — ErrorCard 组件

**Files:**
- Create: `src/components/chat/view/subcomponents/ErrorCard.tsx`

- [ ] **Step 1: 创建 ErrorCard 组件**

```tsx
// src/components/chat/view/subcomponents/ErrorCard.tsx
import React from 'react';

export interface ErrorAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant: 'primary' | 'secondary';
}

interface ErrorCardProps {
  level: 2 | 3;
  title: string;
  description: string;
  actions: ErrorAction[];
  timestamp: Date;
}

const RefreshIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const PlusIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const PlayIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export const ACTION_ICONS: Record<string, React.ReactNode> = {
  refresh: <RefreshIcon />,
  plus: <PlusIcon />,
  settings: <SettingsIcon />,
  play: <PlayIcon />,
};

export default function ErrorCard({ level, title, description, actions, timestamp }: ErrorCardProps) {
  const isL3 = level === 3;
  const bgClass = isL3
    ? 'bg-red-100 border-red-300 dark:bg-red-950/30 dark:border-red-800/60'
    : 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800/40';
  const iconBg = isL3 ? 'bg-red-700' : 'bg-red-600';

  const formattedTime = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className={`rounded-lg border p-4 ${bgClass}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${iconBg} text-white`}>
          {isL3 ? '🚫' : '!'}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-red-900 dark:text-red-100">{title}</h4>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{description}</p>

          {actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map((action, index) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    index === 0
                      ? 'border-red-300/70 bg-white/80 text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:bg-gray-900/40 dark:text-red-200 dark:hover:bg-gray-900/70'
                      : 'border-gray-300/70 bg-white/60 text-gray-600 hover:bg-gray-50 dark:border-gray-700/60 dark:bg-gray-900/30 dark:text-gray-300 dark:hover:bg-gray-900/50'
                  }`}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 text-right text-[11px] text-red-400 dark:text-red-500">{formattedTime}</div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/view/subcomponents/ErrorCard.tsx
git commit -m "feat: add ErrorCard component for L2/L3 error display"
```

---

### Task 8: 前端 — ConnectionStatusBanner 组件

**Files:**
- Create: `src/components/chat/view/subcomponents/ConnectionStatusBanner.tsx`
- Modify: `src/contexts/WebSocketContext.tsx`

- [ ] **Step 1: WebSocketContext 新增 connectionState**

在 `src/contexts/WebSocketContext.tsx` 中：

1. 新增类型：
```typescript
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'failed';
```

2. 新增 state：
```typescript
const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
```

3. 在各连接生命周期点设置状态：
- `onopen` 成功时：`setConnectionState('connected')`
- 开始重连时：`setConnectionState('reconnecting')`
- `onclose` 时：`setConnectionState('reconnecting')` (if reconnecting) 或 `setConnectionState('disconnected')`
- 重连耗尽时：`setConnectionState('failed')`

4. 保留 `isConnected` 作为派生值：
```typescript
const isConnected = connectionState === 'connected';
```

5. 在 context value 中暴露 `connectionState` 和 `reconnectAttemptRef.current`。

- [ ] **Step 2: 创建 ConnectionStatusBanner**

```tsx
// src/components/chat/view/subcomponents/ConnectionStatusBanner.tsx
import { useState, useEffect } from 'react';
import { useWebSocket } from '../../../../contexts/WebSocketContext';
import type { ConnectionState } from '../../../../contexts/WebSocketContext';

export default function ConnectionStatusBanner() {
  const { connectionState, reconnect } = useWebSocket();
  const [showRecovered, setShowRecovered] = useState(false);
  const [prevState, setPrevState] = useState<ConnectionState>(connectionState);

  useEffect(() => {
    if (prevState !== 'connected' && connectionState === 'connected') {
      setShowRecovered(true);
      const timer = setTimeout(() => setShowRecovered(false), 3000);
      return () => clearTimeout(timer);
    }
    setPrevState(connectionState);
  }, [connectionState, prevState]);

  if (connectionState === 'connected' && !showRecovered) return null;

  if (showRecovered) {
    return (
      <div className="flex items-center justify-center gap-2 bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300 transition-opacity duration-300">
        <span>&#10003;</span>
        <span>连接已恢复</span>
      </div>
    );
  }

  const isFailed = connectionState === 'failed';

  return (
    <div className={`flex items-center justify-center gap-2 px-4 py-2 text-sm ${
      isFailed
        ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
        : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300'
    }`}>
      <span className={isFailed ? '' : 'animate-pulse'}>
        {isFailed ? '!' : '...'}
      </span>
      <span>
        {isFailed
          ? '无法连接到服务器，请检查网络'
          : '连接已断开，正在重新连接...'}
      </span>
      <button
        type="button"
        onClick={() => reconnect?.()}
        className="ml-2 rounded border border-current px-2 py-0.5 text-xs hover:bg-white/50 dark:hover:bg-black/20"
      >
        手动重连
      </button>
      {isFailed && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-current px-2 py-0.5 text-xs hover:bg-white/50 dark:hover:bg-black/20"
        >
          刷新页面
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`

- [ ] **Step 4: Commit**

```bash
git add src/contexts/WebSocketContext.tsx src/components/chat/view/subcomponents/ConnectionStatusBanner.tsx
git commit -m "feat: add ConnectionStatusBanner with connectionState enum"
```

---

### Task 9: 前端 — AssistantThinkingIndicator 多 phase 重构

**Files:**
- Modify: `src/components/chat/view/subcomponents/AssistantThinkingIndicator.tsx`

- [ ] **Step 1: 重构为多 phase 渲染**

重写 `AssistantThinkingIndicator.tsx`，接收 `currentPhase` prop，根据 phase 显示不同状态：

新增 props:
```typescript
type AssistantThinkingIndicatorProps = {
  selectedProvider: SessionProvider;
  currentPhase?: string;
  phaseMeta?: Record<string, unknown>;
  recoveryStatus?: { code: string; meta?: Record<string, unknown> } | null;
}
```

根据 `currentPhase` 渲染不同图标和文案：
- `undefined` / `acknowledged` / `configuring` → ⚙️ 正在准备...
- `querying` → 🧠 正在思考...
- `streaming` → ✍️ 正在输出...
- `auth-fallback` → 🔄 正在切换备用通道... (黄色 L1 背景)
- `rate-limit-retry` → ⚠️ API 繁忙，自动重试中... (黄色 L1 背景)

当 `recoveryStatus` 存在时，显示 L1 黄色提示条。恢复成功后延迟 1 秒渐隐。

所有 phase 保持已等待秒数显示（复用现有 `elapsed` state）。

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/view/subcomponents/AssistantThinkingIndicator.tsx
git commit -m "feat: multi-phase thinking indicator with L1 recovery display"
```

---

### Task 10: 前端 — Handler 统一 + ErrorCard 集成

**Files:**
- Modify: `src/components/chat/hooks/handlers/claudeHandler.ts`
- Modify: `src/components/chat/hooks/handlers/pipelineHandler.ts`
- Modify: `src/components/chat/hooks/useChatRealtimeHandlers.ts`
- Modify: `src/components/chat/view/subcomponents/MessageComponent.tsx`
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`
- Modify: `src/components/chat/view/ChatInterface.tsx`

- [ ] **Step 1: claudeHandler — 删除硬编码映射，改用 ERROR_MAP**

在 `handleClaudeError` 中，删除第 436-445 行的 `if/else` 错误文案映射，替换为：

```typescript
import { getErrorMapping, getErrorDescription } from '../../utils/errorMessages';

export function handleClaudeError(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.clearFallbackTimer();

  const errorCode = (latestMessage as any).errorCode || 'unknown';
  const meta = (latestMessage as any).meta || {};
  const mapping = getErrorMapping(errorCode);

  // L1: update recovery status, don't show error message
  if (mapping.level === 1) {
    ctx.setRecoveryStatus?.({ code: errorCode, meta });
    return;
  }

  ctx.finalizeLifecycleForCurrentView(latestMessage.sessionId, ctx.currentSessionId, ctx.selectedSession?.id);

  // Clean up streaming state
  if (ctx.streamTimerRef.current) {
    clearTimeout(ctx.streamTimerRef.current);
    ctx.streamTimerRef.current = null;
  }
  ctx.streamBufferRef.current = '';

  // Finalize streaming messages
  ctx.setChatMessages((previous) => {
    const updated = [...previous];
    for (let i = updated.length - 1; i >= 0; i--) {
      if (updated[i].isStreaming) {
        updated[i] = { ...updated[i], isStreaming: false };
      }
    }
    return [
      ...updated,
      {
        type: 'error' as const,
        content: getErrorDescription(mapping, meta),
        errorLevel: mapping.level as 2 | 3,
        errorCode,
        errorActions: mapping.actions,
        timestamp: new Date(),
      },
    ];
  });

  ctx.setIsLoading(false);
  ctx.setCanAbortSession(false);
  ctx.setClaudeStatus(null);
}
```

- [ ] **Step 2: pipelineHandler — handleSessionTimeout 统一**

由于后端现在发送 `claude-error` 而非 `session-timeout`，`handleSessionTimeout` 将不再被调用。保留函数但简化为：

```typescript
export function handleSessionTimeout(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  // Handled by unified handleClaudeError via errorCode
  // This function is kept for backward compatibility
  const errorCode = (latestMessage as any).errorCode || latestMessage.timeoutType || 'unknown';
  handleClaudeError(ctx, { ...latestMessage, errorCode } as any);
}
```

Import `handleClaudeError` from `claudeHandler.ts`.

- [ ] **Step 3: MessageComponent — ErrorCard 集成**

在 `MessageComponent.tsx` 中导入 `ErrorCard` 和 `ACTION_ICONS`，修改 `message.type === 'error'` 的渲染逻辑：

当 `message.errorLevel` 存在时渲染 `ErrorCard`，否则保持旧的文本渲染（向后兼容）。

将 `onRetry` 分拆为具体的 action callbacks：`onRetry`、`onNewSession`、`onContinueGeneration`、`onShowSettings`。

- [ ] **Step 4: ChatMessagesPane — 透传新回调**

新增 props：`onNewSession?: () => void`、`onContinueGeneration?: () => void`。透传给 `MessageComponent`。

- [ ] **Step 5: ChatInterface — 集成横幅 + 新回调**

1. 在 `ChatMessagesPane` 上方添加 `<ConnectionStatusBanner />`
2. 新增 `handleNewSession` 回调
3. 新增 `handleContinueGeneration` 回调
4. 透传给 `ChatMessagesPane`

- [ ] **Step 6: ChatComposer — 断线 disabled**

从 `WebSocketContext` 获取 `connectionState`，当 `connectionState !== 'connected'` 时：
- textarea 和发送按钮 disabled
- placeholder 改为 "连接断开中，请稍候..."

- [ ] **Step 7: useChatRealtimeHandlers — 统一分发**

由于后端现在把 `session-timeout` 和 `quota-exceeded` 都发送为 `claude-error`，需要确保 `claude-error` case 能正确处理所有类型。

现有的 `session-timeout` case 可以保留作为兼容（如果有遗漏的旧格式），但主要逻辑走 `claude-error`。

新增 `setRecoveryStatus` state 和 `currentPhase` state，传递给 `AssistantThinkingIndicator`。

- [ ] **Step 8: 验证 TypeScript 编译**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`

- [ ] **Step 9: Commit**

```bash
git add src/components/chat/hooks/handlers/claudeHandler.ts \
  src/components/chat/hooks/handlers/pipelineHandler.ts \
  src/components/chat/hooks/useChatRealtimeHandlers.ts \
  src/components/chat/view/subcomponents/MessageComponent.tsx \
  src/components/chat/view/subcomponents/ChatMessagesPane.tsx \
  src/components/chat/view/ChatInterface.tsx \
  src/components/chat/view/subcomponents/ChatComposer.tsx
git commit -m "feat: unified error handling with ErrorCard, ConnectionBanner, and L1 recovery"
```

---

### Task 11: 集成验证

- [ ] **Step 1: 重启服务验证**

```bash
lsof -ti:3001,5173 2>/dev/null | xargs kill -9 2>/dev/null
npm run dev
```

Expected: 前后端正常启动，无报错

- [ ] **Step 2: 功能验证清单**

手动测试以下场景：
1. 正常发送消息 — 思考指示器显示 phase 切换
2. Key Pool key 无效 — 显示 L1 "切换备用通道"，然后正常响应
3. 断开网络 — 顶部黄色横幅 + 输入框 disabled
4. 恢复网络 — 绿色横幅闪现 3 秒
5. 超时错误 — ErrorCard 显示 + "重新发送" 按钮可用

- [ ] **Step 3: Final Commit**

```bash
git add -A
git commit -m "feat: complete chat error experience optimization"
```
