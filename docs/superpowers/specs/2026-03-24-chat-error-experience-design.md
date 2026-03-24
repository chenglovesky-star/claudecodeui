# Chat 聊天模式异常体验优化设计

> 目标：团队多人共享场景下，让每个用户在等待、出错、恢复的全过程中始终清楚系统状态，能快速采取正确行动。

## 1. 分阶段进度指示器

替换当前静态的 "正在思考中(15s)"，改为按 phase 动态切换的状态流。

### 阶段定义

| 阶段 | phase 值 | 图标 | 显示文案 | 附加信息 |
|------|---------|------|---------|---------|
| 排队 | `queue-status` | ⏳ | 排队中 | 第 N 位，预计等待约 Xs |
| 准备 | `acknowledged` / `configuring` | ⚙️ | 正在准备 / 正在加载配置 | 已等待 Ns |
| 通道切换 | `auth-fallback` (新增) | 🔄 | 正在切换备用通道 | 第 N/M 次尝试 |
| 限速重试 | `rate-limit-retry` (新增) | ⚠️ | API 繁忙，自动重试中 | N 秒后重试 |
| 思考 | `querying` | 🧠 | 正在思考 | 已等待 Ns |
| 输出 | `streaming` (新增) | ✍️ | 正在输出 | 已生成 N tokens |

### 后端改动

- `ClaudeSDKProvider`：auth 回退时发送 `{ type: 'claude-phase', phase: 'auth-fallback', attempt, maxAttempts }`
- `ClaudeSDKProvider`：429 重试时发送 `{ type: 'claude-phase', phase: 'rate-limit-retry', retryAfterSec }`
- `claude-sdk.js`：在 `for await` 循环内检测 `message.type === 'content_block_start'` 时（仅首次）发送 `{ type: 'claude-phase', phase: 'streaming' }`
- 回退成功后重新发送 `{ type: 'claude-phase', phase: 'querying' }`
- `auth-fallback` phase 替代（而非叠加）当前回退时发送的 `configuring` phase，避免 UI 闪烁

### 前端改动

- `AssistantThinkingIndicator`：改为根据当前 phase 渲染不同状态（图标 + 文案 + 计时器）
- 所有阶段始终显示已等待秒数（已实现计时器逻辑，需扩展到所有 phase）
- `streaming` 阶段额外显示已生成 token 数（从 `claude-response` 消息累计）

### 涉及文件

- `server/providers/claude-sdk.js` — 新增 phase 事件发送
- `server/claude-sdk.js` — streaming phase 事件（在 `for await` 循环内检测 `content_block_start`）
- `src/components/chat/view/subcomponents/AssistantThinkingIndicator.tsx` — 重构渲染逻辑
- `src/components/chat/hooks/handlers/claudeHandler.ts` — 处理新 phase 类型
- `src/components/chat/hooks/useChatRealtimeHandlers.ts` — 注册新 phase 类型的消息分发

---

## 2. 错误分级显示系统

所有错误分为 3 级，每级不同 UI 和交互。

### Level 1 — 自动恢复中（黄色提示）

- 不打断用户等待流程
- 在 ThinkingIndicator 区域显示黄色提示条
- 自动恢复成功 → 提示消失，继续正常流程
- 自动恢复失败 → 升级为 Level 2

适用场景：Key 切换、OAuth 回退、WebSocket 重连、429 pre-stream 重试

### Level 2 — 需要用户操作（红色错误卡片 + 按钮）

- 显示为独立的 ErrorCard 消息
- 包含：标题、原因描述、1-2 个操作按钮
- 停止加载状态，保留已输出的部分内容

适用场景：所有超时、认证全部失败、流中 429、队列超时、工具超时

### Level 3 — 不可恢复（深红错误卡片 + 引导）

- 无法通过重试解决
- 引导用户新建会话或等待

适用场景：全局超时、会话配额耗尽、队列满

### 错误分级映射表

| 错误场景 | 等级 | 操作按钮 |
|---------|------|---------|
| Key 切换 / OAuth 回退 | L1 | 无 |
| WebSocket 重连 | L1 | 无 |
| 429 pre-stream 重试 | L1 | 无 |
| firstResponse 超时 | L2 | 重新发送 / 新建会话 |
| activity 超时 | L2 | 重新发送 |
| 客户端兜底超时 | L2 | 重新发送 |
| 认证全部失败 | L2 | 重新发送 / 打开设置 |
| 429 mid-stream | L2 | 继续生成 / 重新发送 |
| 队列超时 | L2 | 重新发送 |
| 工具执行超时 | L2 | 重新发送 |
| SDK 进程崩溃 | L2 | 重新发送 / 新建会话 |
| 全局超时 | L3 | 新建会话 |
| 配额耗尽 | L3 | 无 |
| 队列已满 | L3 | 无 |

### 涉及文件

- `src/components/chat/hooks/handlers/claudeHandler.ts` — 错误分级逻辑
- `src/components/chat/hooks/handlers/pipelineHandler.ts` — 超时分级逻辑
- `src/components/chat/view/subcomponents/MessageComponent.tsx` — ErrorCard 渲染

---

## 3. WebSocket 连接状态横幅

在聊天界面顶部添加固定横幅，实时反映连接状态。

### 状态枚举

```typescript
type ConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'failed';
```

### 显示规则

| 状态 | 横幅样式 | 内容 | 输入框状态 |
|------|---------|------|----------|
| `connected` | 不显示 | — | 正常 |
| `reconnecting` | 黄色固定 | "连接已断开，正在重连...（第 N 次）" + [手动重连] | disabled |
| `disconnected` | 黄色固定 | 同上 | disabled |
| `failed` | 红色固定 | "无法连接到服务器" + [刷新页面] + [手动重连] | disabled |

重连成功时显示绿色横幅 "连接已恢复"，3 秒后自动消失。

### 涉及文件

- `src/contexts/WebSocketContext.tsx` — 新增 `connectionState` 枚举，同时保留 `isConnected` 作为派生值（`connectionState === 'connected'`）确保向后兼容
- `src/components/chat/view/subcomponents/ConnectionStatusBanner.tsx` — 新组件
- `src/components/chat/view/ChatInterface.tsx` — 集成横幅组件，断线时禁止发送
- `src/components/chat/view/subcomponents/ChatComposer.tsx` — 断线时 disabled 状态

---

## 4. 自动恢复透明化

所有后台自动重试对用户可见但不打断，成功则无缝衔接，失败则升级为 Level 2。

### 4.1 Key Pool 回退透明化

流程：Key-1 失败 → L1 提示"切换备用通道(1/3)" → Key-2 失败 → L1 提示(2/3) → OAuth 成功 → 恢复正常思考状态。

后端改动：
- `ClaudeSDKProvider.start()` — auth 回退时通过 `transport.send()` 发送 `phase: 'auth-fallback'`
- 回退期间 `#suppressError = true` 阻止 error 事件和消息（已实现）
- 回退成功后发送 `phase: 'querying'` 重置前端状态

### 4.2 429 Pre-stream 重试透明化

后端发送 `phase: 'rate-limit-retry'`，前端显示 L1 提示 + 倒计时。

### 4.3 WebSocket 重连期间流恢复

- 重连成功 + 有活跃 streaming 会话 → 自动发送 `resume`
- `resume-response` 回填已有内容 + "连接已恢复" 分隔标记
- resume 失败 → 显示 Level 2 错误

### 4.4 超时计时器协调

- `BaseProvider` 新增两个便捷方法：
  - `emitRecoveryStart()` — 发出 `this.emit('recovery-start')`
  - `emitRecoveryEnd(success: boolean)` — 发出 `this.emit('recovery-end', { success })`
- `ProcessManager.startSession()` 中新增事件绑定：
  ```javascript
  provider.on('recovery-start', () => {
    this.emit('process:recovery-start', { sessionId });
  });
  provider.on('recovery-end', ({ success }) => {
    this.emit('process:recovery-end', { sessionId, success });
  });
  ```
- `MessageRouter.bindEvents()` 中新增：
  ```javascript
  this.#processManager.on('process:recovery-start', ({ sessionId }) => {
    this.#sessionManager.pauseTimers(sessionId);
  });
  this.#processManager.on('process:recovery-end', ({ sessionId }) => {
    this.#sessionManager.resumeTimers(sessionId);
  });
  ```
- `SessionManager` 新增 `pauseTimers(sessionId)` / `resumeTimers(sessionId)` 方法：暂停时记录剩余时间，恢复时重新启动计时器

### 4.5 断线期间错误消息持久化

如果 WebSocket 断线期间后端产生了标准化错误（`claude-error` with `errorCode`），`MessageRouter` 已有的 `messageBuffer.addCriticalEvent()` 机制会缓存这些事件。需确保新增的标准化 `claude-error` 也通过 `addCriticalEvent` 写入 buffer，使得重连后 `resume-response` 能回补这些错误。

### L1 提示消失时机

自动恢复成功时，L1 黄色提示延迟 1 秒后渐隐消失（`opacity transition 300ms`），让用户能看到恢复成功的状态变化，而不是突然跳变。

### 涉及文件

- `server/providers/claude-sdk.js` — 调用 `emitRecoveryStart()` / `emitRecoveryEnd()`
- `server/providers/base-provider.js` — 新增 `emitRecoveryStart()` / `emitRecoveryEnd()` 方法
- `server/session/ProcessManager.js` — 新增 `recovery-start` / `recovery-end` 事件监听和转发
- `server/session/SessionManager.js` — 新增 `pauseTimers()` / `resumeTimers()` 方法
- `server/message/MessageRouter.js` — 绑定 recovery 事件、确保标准化错误写入 messageBuffer
- `src/components/chat/hooks/handlers/claudeHandler.ts` — 处理 recovery phase

---

## 5. ErrorCard 组件

替换当前纯文本错误显示，统一为结构化错误卡片。

### 组件接口

```typescript
interface ErrorCardProps {
  level: 1 | 2 | 3;
  title: string;
  description: string;
  actions: ErrorAction[];
  timestamp: Date;
}

interface ErrorAction {
  label: string;
  icon: string;    // "refresh" | "plus" | "settings" | "play"
  onClick: () => void;
  variant: 'primary' | 'secondary';
}
```

### 样式

- L1：黄色背景，黄色边框（仅在 ThinkingIndicator 中使用，非独立组件）
- L2：红色背景 `bg-red-50`，红色边框，操作按钮区
- L3：深红背景 `bg-red-100`，红色边框，引导文案

### Action 按钮行为

| 按钮 | 行为 |
|------|------|
| 重新发送 | 将上次用户消息填入输入框并 focus |
| 新建会话 | 调用 `onNewSession()`，导航到空白会话 |
| 打开设置 | 调用 `onShowSettings()` |
| 继续生成 | 发送 resume 命令恢复当前会话 |

### ChatMessage 类型扩展

```typescript
interface ChatMessage {
  // ...existing fields
  errorLevel?: 1 | 2 | 3;
  errorCode?: string;
  errorActions?: string[];
}
```

### 错误消息集中映射

新建 `src/components/chat/utils/errorMessages.ts`，集中管理所有错误码到展示信息的映射。各 handler 不再硬编码错误文案，统一查表。

### 涉及文件

- `src/components/chat/view/subcomponents/ErrorCard.tsx` — 新组件
- `src/components/chat/view/subcomponents/MessageComponent.tsx` — 检测 errorLevel 时渲染 ErrorCard
- `src/components/chat/utils/errorMessages.ts` — 新文件，ERROR_MAP 映射表
- `src/components/chat/types/types.ts` — ChatMessage 类型扩展
- `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` — 新增传递回调：`onRetry`（已有）、`onNewSession`（新增）、`onContinueGeneration`（新增），从 ChatInterface 透传到 ErrorCard

---

## 6. 后端错误事件标准化

统一所有错误事件格式，前端一处查表。

### 标准格式

```javascript
{
  type: 'claude-error',
  errorCode: 'auth-failed',
  error: 'All API keys failed authentication',
  sessionId: '...',
  meta: {
    attempt: 2,
    maxAttempts: 3,
    retryAfterSec: 5,
    partialContent: true,
  }
}
```

### errorCode 分配

| 模块 | errorCode | meta 字段 |
|------|-----------|----------|
| ClaudeSDKProvider auth 回退中 | `auth-fallback` | `{ attempt, maxAttempts }` |
| ClaudeSDKProvider auth 全部失败 | `auth-failed` | `{ triedKeys, triedOAuth }` |
| ClaudeSDKProvider 429 pre-stream | `rate-limit-retry` | `{ retryAfterSec }` |
| ClaudeSDKProvider 429 mid-stream | `rate-limit-mid` | `{ partialContent }` |
| SessionManager firstResponse 超时 | `firstResponse` | `{ timeoutMs }` |
| SessionManager activity 超时 | `activity` | `{ timeoutMs }` |
| SessionManager tool 超时 | `tool-timeout` | `{ timeoutMs }` |
| SessionManager global 超时 | `global-timeout` | `{ timeoutMs }` |
| RequestQueue 超时 | `queue-timeout` | `{ waitedSec }` |
| RequestQueue 满 | `queue-full` | `{ queueSize }` |
| SessionManager 配额超限 | `quota-exceeded` | `{ userSessions, maxSessions }` |
| claude-sdk.js 进程崩溃 | `sdk-crash` | `{ exitCode }` |

### session-timeout 合并

SessionManager 发出的 timeout 事件统一附带 `errorCode`，由 MessageRouter 转换为标准格式。前端不再需要 `handleSessionTimeout` 单独处理，所有错误统一走 `ERROR_MAP` 查找。

### queue-status / quota-exceeded 消息类型统一

当前 `queue-status`（rejected/timeout）和 `quota-exceeded` 使用独立的消息类型。统一为：
- **L3 终态错误**（`queue-full`、`quota-exceeded`）：改为发送 `type: 'claude-error'` + 对应 `errorCode`，前端统一走 ErrorCard 渲染
- **L1 过程状态**（`queue-status` 的 `queued` 状态）：保留 `type: 'queue-status'`，仅用于 ThinkingIndicator 显示排队位置
- **队列超时**（`queue-status` 的 `timeout`）：改为发送 `type: 'claude-error'` + `errorCode: 'queue-timeout'`

这样前端只需处理两种消息类型：`queue-status`（进度信息，非错误）和 `claude-error`（所有错误，统一查 ERROR_MAP）。

### ERROR_MAP 完整类型定义

```typescript
interface ErrorMapping {
  level: 1 | 2 | 3;
  title: string;
  description: string | ((meta: Record<string, unknown>) => string);
  actions: Array<'retry' | 'newSession' | 'settings' | 'continue'>;
}

type ErrorMap = Record<string, ErrorMapping>;
```

### 涉及文件

- `server/claude-sdk.js` — ws.send 时附带 errorCode + meta
- `server/providers/claude-sdk.js` — emitError 时附带 errorCode
- `server/session/SessionManager.js` — timeout 事件附带 errorCode
- `server/message/MessageRouter.js` — 统一转换格式、queue/quota 消息类型迁移
- `server/queue/RequestQueue.js` — rejected/timeout 事件附带 errorCode
- `src/components/chat/hooks/handlers/claudeHandler.ts` — 简化为查表逻辑，删除硬编码错误文案映射
- `src/components/chat/hooks/handlers/pipelineHandler.ts` — 合并进统一处理
- `src/components/chat/hooks/useChatRealtimeHandlers.ts` — 统一错误消息类型分发
