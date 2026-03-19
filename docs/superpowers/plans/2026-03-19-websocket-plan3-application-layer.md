# WebSocket 消息管道重构 — Plan 3：应用层 + 文件重构 + 客户端适配

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现消息路由层（MessageRouter）、统一消息协议（seqId、resume）、重写客户端消息处理以适配新协议、拆分 server/index.js、清理死代码、添加前端防卡死兜底。

**Architecture:** MessageRouter 作为消息入口，解析协议并分发到 SessionManager/TransportLayer。客户端重写消息处理以支持 seqId 校验和 resume 恢复。server/index.js 从 2686 行拆分为 ~200 行入口文件，所有业务逻辑已移到独立模块。

**Tech Stack:** Node.js, React 18, TypeScript, EventEmitter

**Spec:** `docs/superpowers/specs/2026-03-19-websocket-message-pipeline-design.md`

**依赖:** Plan 1 + Plan 2 完成

---

## 文件结构

| 操作 | 文件路径 | 职责 | 行数限制 |
|------|---------|------|---------|
| 新增 | `server/message/MessageRouter.js` | 消息协议解析、路由分发、resume 处理 | ≤250 |
| 新增 | `server/websocket/ShellHandler.js` | Shell WebSocket + PTY 逻辑（从 index.js 提取） | ≤300 |
| 新增 | `server/websocket/ChatHandler.js` | Chat WebSocket 消息处理（从 index.js 提取） | ≤200 |
| 重写 | `server/index.js` | 精简为入口 + 模块组装 | ≤200 |
| 修改 | `src/contexts/WebSocketContext.tsx` | 添加 seqId 追踪、resume 逻辑 | — |
| 修改 | `src/components/chat/hooks/useChatRealtimeHandlers.ts` | 适配新消息类型、添加防卡死计时器 | — |
| 修改 | `src/components/chat/hooks/useChatSessionState.ts` | 添加 timeout/resume 状态 | — |
| 修改 | `src/components/chat/types/types.ts` | 添加新消息类型定义 | — |

---

### Task 1: 创建 MessageRouter

**Files:**
- Create: `server/message/MessageRouter.js`

消息协议入口。接收传输层的原始消息，解析 type，路由到对应处理器。

- [ ] **Step 1: 实现 MessageRouter**

功能要求：

**消息路由**：
- `handleMessage(connectionId, message)` — 主入口
- 根据 `message.type` 分发：
  - `heartbeat` → 直接回复 `heartbeat-ack`（通过 transport）
  - `claude-command` / `cursor-command` / `codex-command` / `gemini-command` / `claude-cli-command` → 调用 sessionManager.create() + processManager.startSession()
  - `abort-session` → 调用 sessionManager.abort()
  - `resume` → 调用 messageBuffer.getResumeData()，通过 transport 发送 `resume-response`
  - `claude-permission-response` → 转发到对应 Provider
  - `check-session-status` → 查询 sessionManager.getState()
  - 其他 → 日志警告 unknown type

**事件监听绑定**：
- `bindEvents()` — 监听 SessionManager、ProcessManager、MessageBuffer 事件，转发到 TransportLayer
  - `session:timeout` → 发送 `session-timeout` 消息
  - `session:error` → 发送 `session-error` 消息
  - `process:output` → 发送 `claude-response` 消息 + buffer 追加
  - `process:complete` → 发送 `session-completed` 消息
  - `buffer:overflow` → 发送 `session-error` + 截断通知

**构造函数**：
```javascript
constructor({ transport, sessionManager, processManager, messageBuffer, registry })
```
只通过接口交互（P2），不直接 import 具体实现。

**日志**：`[Router]` 前缀

- [ ] **Step 2: Commit**

```bash
git add server/message/MessageRouter.js
git commit -m "feat: add MessageRouter with protocol parsing and event-driven routing (P1,P2,P3)"
```

---

### Task 2: 提取 ShellHandler 从 index.js

**Files:**
- Create: `server/websocket/ShellHandler.js`
- Modify: `server/index.js`

将 `handleShellConnection`（index.js 第1738-2104行，约 366 行）提取为独立模块。

- [ ] **Step 1: 创建 ShellHandler.js**

从 `server/index.js` 的 `handleShellConnection` 函数提取：
- PTY 会话初始化（init 消息处理）
- 输入转发（input 消息）
- 终端 resize
- URL 检测逻辑
- PTY 会话超时和断开后保活
- `ptySessionsMap` 移到 ShellHandler 内部管理

接口：
```javascript
export class ShellHandler {
  constructor(registry, transport) { ... }
  handleConnection(connectionId) { ... }
  handleDisconnect(connectionId) { ... }
  handleMessage(connectionId, message) { ... }
  dispose() { ... }
}
```

使用 constants.js 中的 `PTY_SESSION_TIMEOUT_MS` 和 `SHELL_URL_PARSE_BUFFER_LIMIT`。

- [ ] **Step 2: 从 index.js 中删除 handleShellConnection**

替换为调用 `shellHandler.handleConnection(connectionId)`。

- [ ] **Step 3: Commit**

```bash
git add server/websocket/ShellHandler.js server/index.js
git commit -m "refactor: extract ShellHandler from index.js (P1)"
```

---

### Task 3: 提取 ChatHandler 从 index.js

**Files:**
- Create: `server/websocket/ChatHandler.js`
- Modify: `server/index.js`

将 `handleChatConnection` 中剩余的非路由逻辑提取（工作区验证、writer 管理等）。

- [ ] **Step 1: 创建 ChatHandler.js**

```javascript
export class ChatHandler {
  constructor({ registry, transport, router }) { ... }
  handleConnection(connectionId, request) {
    // 绑定 userId/username
    // 工作区沙盒验证
    // 设置消息监听 → 转发给 router.handleMessage()
  }
  handleDisconnect(connectionId) { ... }
}
```

- [ ] **Step 2: 从 index.js 中删除 handleChatConnection**

- [ ] **Step 3: Commit**

```bash
git add server/websocket/ChatHandler.js server/index.js
git commit -m "refactor: extract ChatHandler from index.js (P1)"
```

---

### Task 4: 精简 server/index.js 为入口文件

**Files:**
- Modify: `server/index.js`

目标：≤200 行，只做模块组装和 HTTP 服务启动。

- [ ] **Step 1: 重写 index.js**

保留：
- Express app 创建和中间件挂载
- HTTP 路由挂载（`routes/` 目录下的路由文件不变）
- WebSocket server 创建和 `verifyClient`
- 模块实例化和组装
- 服务启动和关闭逻辑

删除：
- 所有 handleChatConnection / handleShellConnection 逻辑（已提取）
- 所有 Provider 直接导入和调用
- 所有 connectedClients 相关代码
- 所有旧心跳代码
- 广播相关逻辑（移到使用 registry 的方式）

结构：
```javascript
// 1. 导入模块
// 2. 创建 Express app + 中间件
// 3. 挂载 HTTP 路由
// 4. 创建 HTTP server + WebSocket server
// 5. 实例化基础设施
const registry = new ConnectionRegistry();
const transport = new TransportLayer(registry);
const sessionManager = new SessionManager();
const processManager = new ProcessManager();
const messageBuffer = new MessageBuffer();
const router = new MessageRouter({ transport, sessionManager, processManager, messageBuffer, registry });
const chatHandler = new ChatHandler({ registry, transport, router });
const shellHandler = new ShellHandler(registry, transport);
// 6. 注册 Provider
// 7. WebSocket connection 路由
// 8. 启动服务
// 9. 优雅关闭
```

- [ ] **Step 2: 验证行数**

```bash
wc -l server/index.js
```
Expected: ≤200 行

- [ ] **Step 3: 构建验证**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "refactor: slim down index.js to ~200 lines entry point (P1,P5)"
```

---

### Task 5: 客户端类型定义更新

**Files:**
- Modify: `src/components/chat/types/types.ts`

- [ ] **Step 1: 添加新消息类型**

```typescript
// 新增服务端消息类型
export type ServerMessageType =
  | 'session-started'
  | 'claude-response'
  | 'session-completed'
  | 'session-timeout'
  | 'session-error'
  | 'session-aborted'
  | 'resume-response'
  | 'heartbeat-ack'
  | 'quota-exceeded'
  | 'backpressure';

export interface ServerMessage {
  type: ServerMessageType | string;
  seqId?: number;
  sessionId?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface ResumeResponse {
  type: 'resume-response';
  missedCriticalEvents: ServerMessage[];
  snapshot?: {
    currentContent: string;
    completedBlocks: string[];
    pendingToolUses: string[];
  };
  currentState: string;
  lastSeqId: number;
}

// ChatMessage 新增字段
interface ChatMessage {
  // ... 现有字段保持不变
  isTimeout?: boolean;        // 超时标记
  timeoutType?: string;       // 超时类型
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/types/types.ts
git commit -m "feat: add new message types for WebSocket pipeline protocol"
```

---

### Task 6: 客户端 WebSocketContext 添加 seqId 和 resume

**Files:**
- Modify: `src/contexts/WebSocketContext.tsx`

- [ ] **Step 1: 添加 seqId 追踪**

```typescript
const lastSeqIdRef = useRef<number>(0);
const activeSessionIdRef = useRef<string | null>(null);
```

在 `onmessage` 中：
```typescript
if (data.seqId !== undefined) {
  if (data.seqId > lastSeqIdRef.current + 1 && lastSeqIdRef.current > 0) {
    console.warn(`[WS] SeqId gap detected: expected ${lastSeqIdRef.current + 1}, got ${data.seqId}`);
    // 可能的消息丢失，触发 resume
  }
  lastSeqIdRef.current = data.seqId;
}
```

- [ ] **Step 2: 添加 resume 逻辑**

在 `onopen` 回调中，如果有活跃会话，发送 resume：
```typescript
websocket.onopen = () => {
  // ... 现有逻辑
  if (activeSessionIdRef.current && lastSeqIdRef.current > 0) {
    websocket.send(JSON.stringify({
      type: 'resume',
      sessionId: activeSessionIdRef.current,
      lastSeqId: lastSeqIdRef.current,
    }));
  }
};
```

- [ ] **Step 3: 处理 resume-response**

在 `onmessage` 中添加：
```typescript
if (data.type === 'resume-response') {
  lastSeqIdRef.current = data.lastSeqId;
  setLatestMessage(data); // 让 useChatRealtimeHandlers 处理恢复
  return;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/contexts/WebSocketContext.tsx
git commit -m "feat: add seqId tracking and resume protocol to WebSocket client"
```

---

### Task 7: 客户端 useChatRealtimeHandlers 适配新消息类型

**Files:**
- Modify: `src/components/chat/hooks/useChatRealtimeHandlers.ts`

- [ ] **Step 1: 添加 session-timeout 处理**

在消息类型处理 switch 中添加：
```typescript
case 'session-timeout': {
  flushStreamingState();
  setChatMessages(prev => [...prev, {
    type: 'error',
    content: `会话超时 (${messageData.timeoutType})`,
    timestamp: new Date(),
    isTimeout: true,
    timeoutType: messageData.timeoutType,
  }]);
  setIsLoading(false);
  setCanAbortSession(false);
  break;
}

case 'session-error': {
  flushStreamingState();
  setChatMessages(prev => [...prev, {
    type: 'error',
    content: messageData.error || '会话异常',
    timestamp: new Date(),
  }]);
  setIsLoading(false);
  setCanAbortSession(false);
  break;
}

case 'quota-exceeded': {
  setChatMessages(prev => [...prev, {
    type: 'error',
    content: messageData.reason || '服务器繁忙，请稍后重试',
    timestamp: new Date(),
  }]);
  setIsLoading(false);
  break;
}

case 'resume-response': {
  // 处理断线恢复
  if (messageData.snapshot) {
    // 有 snapshot，替换当前流式内容
    setChatMessages(prev => {
      const updated = [...prev];
      const lastAssistant = updated.findLastIndex(m => m.type === 'assistant' && m.isStreaming);
      if (lastAssistant >= 0) {
        updated[lastAssistant] = { ...updated[lastAssistant], content: messageData.snapshot.currentContent, isStreaming: messageData.currentState === 'streaming' };
      }
      return updated;
    });
  }
  // 处理缺失的关键事件
  for (const event of messageData.missedCriticalEvents || []) {
    // 递归调用处理每个事件
  }
  break;
}
```

- [ ] **Step 2: 添加前端防卡死兜底计时器**

```typescript
const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const currentSessionStateRef = useRef<string>('idle');

function startFallbackTimer() {
  clearFallbackTimer();
  const timeout = currentSessionStateRef.current === 'tool_executing'
    ? CLIENT_TOOL_FALLBACK_TIMEOUT_MS   // 10.5 分钟
    : CLIENT_FALLBACK_TIMEOUT_MS;        // 90 秒

  fallbackTimerRef.current = setTimeout(() => {
    console.warn('[Chat] Fallback timeout triggered');
    setChatMessages(prev => [...prev, {
      type: 'error',
      content: '响应超时，请重试或中止当前会话',
      timestamp: new Date(),
      isTimeout: true,
    }]);
    setIsLoading(false);
  }, timeout);
}

function resetFallbackTimer() {
  if (fallbackTimerRef.current) startFallbackTimer();
}

function clearFallbackTimer() {
  if (fallbackTimerRef.current) {
    clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
  }
}
```

在发送 command 时启动计时器，收到 `claude-response` 时重置，收到 completion/error/timeout 时清除。

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/hooks/useChatRealtimeHandlers.ts
git commit -m "feat: add session-timeout, resume handling, and fallback timer to client"
```

---

### Task 8: 死代码清理

**Files:**
- Multiple files

- [ ] **Step 1: 搜索并清理所有旧代码引用**

```bash
# 搜索旧 Provider 路径引用
grep -rn "claude-sdk\|claude-cli\|cursor-cli\|gemini-cli\|openai-codex" server/ --include="*.js" | grep -v "providers/" | grep -v "node_modules"

# 搜索旧 ping/pong 引用
grep -rn "type.*['\"]ping['\"]\\|type.*['\"]pong['\"]" server/ src/ --include="*.js" --include="*.ts" --include="*.tsx"

# 搜索 connectedClients
grep -rn "connectedClients" server/ --include="*.js"

# 搜索旧心跳常量
grep -rn "WS_PING_INTERVAL\|WS_PONG_TIMEOUT\|wsHeartbeatInterval" server/ --include="*.js"
```

Expected: 所有搜索结果为空或仅在注释中

- [ ] **Step 2: 清理找到的残留代码**

- [ ] **Step 3: 验证无未使用的导入**

```bash
npm run lint 2>&1 | grep "unused" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove dead code - legacy providers, ping/pong, connectedClients"
```

---

### Task 9: 端到端验证

**Files:** 无新增

- [ ] **Step 1: 完整构建和 lint**

```bash
npm run build && npm run lint 2>&1 | grep "error" | head -10
```

- [ ] **Step 2: 验证 server/index.js 行数**

```bash
wc -l server/index.js
```
Expected: ≤200 行

- [ ] **Step 3: 验证所有新文件行数**

```bash
wc -l server/config/constants.js server/websocket/*.js server/session/*.js server/message/*.js server/providers/*.js
```
Expected: 每个文件 ≤300 行

- [ ] **Step 4: 启动服务和手动测试**

```bash
lsof -ti:3001 | xargs kill -9 2>/dev/null; npm run dev &
sleep 5
```

验证项：
- [ ] 发送消息正常收到响应
- [ ] 中止会话正常工作
- [ ] 断线重连后不丢消息（打开开发者工具观察 seqId）
- [ ] 长时间无响应时前端显示超时提示（不再永远卡住）
- [ ] 控制台无旧的 ping/pong 日志，只有 heartbeat/heartbeat-ack
- [ ] 服务端日志带 `[Transport]`/`[Registry]`/`[Session]`/`[Process]`/`[Router]`/`[Buffer]` 前缀

- [ ] **Step 5: 最终架构合规检查**

| 检查项 | 通过？ |
|--------|-------|
| 单文件 ≤300 行 | |
| 单函数 ≤40 行 | |
| 模块间通过 EventEmitter 通信 | |
| 通过接口交互（ITransport/ISession/IProvider） | |
| 所有阈值来自 constants.js | |
| 日志带模块前缀 | |
| 无死代码 | |
| 状态机为纯函数 | |
| 定时器可注入 | |

- [ ] **Step 6: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete WebSocket message pipeline refactor - all 3 plans done"
```
