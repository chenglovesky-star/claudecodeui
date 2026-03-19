# WebSocket 消息管道重构 — Plan 2：会话层 + Provider 适配

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现会话生命周期管理（状态机、超时、配额）、进程管理（强制清理）、消息缓冲（关键事件 + snapshot），并将 5 个 Provider 适配为统一 IProvider 接口。

**Architecture:** SessionManager 通过状态机管理会话生命周期，ProcessManager 负责进程启停和强制清理，MessageBuffer 维护关键事件缓冲和 snapshot。所有 Provider（claude-sdk、claude-cli、cursor-cli、gemini-cli、openai-codex）实现统一的 IProvider 接口，由 ProcessManager 统一调度。模块间通过 EventEmitter 解耦。

**Tech Stack:** Node.js, EventEmitter, AbortController, child_process

**Spec:** `docs/superpowers/specs/2026-03-19-websocket-message-pipeline-design.md`

**依赖:** Plan 1 完成（constants.js、interfaces/、ConnectionRegistry、TransportLayer 已就位）

---

## 文件结构

| 操作 | 文件路径 | 职责 | 行数限制 |
|------|---------|------|---------|
| 新增 | `server/session/SessionManager.js` | 会话状态机、超时控制、资源配额 | ≤300 |
| 新增 | `server/session/ProcessManager.js` | 进程启停、SIGTERM→SIGKILL 清理、Provider 调度 | ≤250 |
| 新增 | `server/message/MessageBuffer.js` | 关键事件 FIFO 缓冲、snapshot 维护 | ≤200 |
| 新增 | `server/providers/base-provider.js` | IProvider 基类，公共逻辑 | ≤80 |
| 重构 | `server/providers/claude-sdk.js` | 从 `server/claude-sdk.js` 重构，实现 IProvider | ≤300 |
| 重构 | `server/providers/claude-cli.js` | 从 `server/claude-cli.js` 重构，实现 IProvider | ≤250 |
| 重构 | `server/providers/cursor-cli.js` | 从 `server/cursor-cli.js` 重构，实现 IProvider | ≤200 |
| 重构 | `server/providers/gemini-cli.js` | 从 `server/gemini-cli.js` 重构，实现 IProvider | ≤250 |
| 重构 | `server/providers/openai-codex.js` | 从 `server/openai-codex.js` 重构，实现 IProvider | ≤250 |
| 修改 | `server/index.js` | 集成 SessionManager，替换直接 Provider 调用 | — |

---

### Task 1: 创建 MessageBuffer

**Files:**
- Create: `server/message/MessageBuffer.js`

消息缓冲和 snapshot 维护，为断线恢复提供数据。

- [ ] **Step 1: 实现 MessageBuffer**

功能要求：
- `constructor()` — 初始化空缓冲
- `addCriticalEvent(sessionId, event)` — 添加关键事件（session-started、tool_use、session-completed、session-timeout、session-error），FIFO 淘汰超过 `BUFFER_CRITICAL_EVENTS_MAX`（500）的旧事件，但钉住 session-started 和最后一条状态变更
- `appendContent(sessionId, text)` — 追加流式内容到 `currentContent`
- `markBlockComplete(sessionId, blockId)` — 标记 content block 完成
- `addPendingToolUse(sessionId, toolUseId, toolName)` — 记录待处理工具调用
- `resolvePendingToolUse(sessionId, toolUseId)` — 工具调用完成
- `getSnapshot(sessionId)` — 返回 `{ currentContent, completedBlocks, pendingToolUses }`
- `getEventsSince(sessionId, sinceSeqId)` — 返回指定 seqId 之后的关键事件
- `getResumeData(sessionId, lastSeqId)` — 返回完整的恢复数据 `{ missedCriticalEvents, snapshot, currentState, lastSeqId }`
- `clearSession(sessionId)` — 清理会话缓冲
- 继承 EventEmitter，emit `buffer:overflow` 事件
- 带 `[Buffer]` 日志前缀
- 从 `constants.js` 导入所有阈值

- [ ] **Step 2: 验证导入**

```bash
node -e "import('./server/message/MessageBuffer.js').then(m => console.log('OK'))"
```

- [ ] **Step 3: Commit**

```bash
git add server/message/MessageBuffer.js
git commit -m "feat: add MessageBuffer with critical event FIFO and snapshot (P1,P4)"
```

---

### Task 2: 创建 SessionManager

**Files:**
- Create: `server/session/SessionManager.js`

会话状态机、超时控制、资源配额。

- [ ] **Step 1: 实现 SessionManager**

**状态机**：
```
idle → running → streaming → completed / timeout / error / aborted
                → tool_executing → streaming / timeout
```

纯函数转换（P6 可测试）：
```javascript
function nextState(currentState, event) {
  const transitions = {
    'idle':            { 'start': 'running' },
    'running':         { 'output': 'streaming', 'timeout': 'timeout', 'error': 'error', 'abort': 'aborted' },
    'streaming':       { 'tool_use': 'tool_executing', 'complete': 'completed', 'timeout': 'timeout', 'error': 'error', 'abort': 'aborted' },
    'tool_executing':  { 'tool_result': 'streaming', 'output': 'streaming', 'timeout': 'timeout', 'error': 'error', 'abort': 'aborted' },
  };
  return transitions[currentState]?.[event] || currentState;
}
```

**功能要求**：
- `create(userId, connectionId, config)` → sessionId — 创建会话，检查配额
- `transition(sessionId, event)` — 状态转换，启动/重置对应超时计时器
- `abort(sessionId)` — 中止会话
- `getState(sessionId)` — 获取当前状态
- `getSession(sessionId)` — 获取完整会话信息
- `getActiveByUser(userId)` → 返回该用户活跃会话数
- `getActiveCount()` → 返回全局活跃会话数
- `cleanup(sessionId)` — 清理会话（停止计时器、从 Map 删除）

**超时管理**（从 constants.js 导入阈值）：
- `running` 状态 → 启动首响应超时（60s）
- `streaming` 状态 → 启动活动超时（120s），每次 `transition('output')` 重置
- `tool_executing` 状态 → 启动工具超时（10min）
- 全局超时（30min）在 `create()` 时启动
- 超时触发时 emit `session:timeout` 事件 + 自动 `transition(sessionId, 'timeout')`

**资源配额**：
- `create()` 时检查：用户并发 ≤ 3、全局并发 ≤ 30
- 超限时 throw `QuotaExceededError`（含 reason）

**事件**（P3）：
- `session:created`、`session:stateChanged`、`session:timeout`、`session:completed`、`session:error`

**定时器可注入**（P6）：
- 构造函数接受可选的 `{ setTimeout, clearTimeout }` 参数，默认用全局的

- [ ] **Step 2: 验证导入**

```bash
node -e "import('./server/session/SessionManager.js').then(m => console.log('OK'))"
```

- [ ] **Step 3: Commit**

```bash
git add server/session/SessionManager.js
git commit -m "feat: add SessionManager with state machine, timeouts, quotas (P1,P3,P4,P6)"
```

---

### Task 3: 创建 Provider 基类

**Files:**
- Create: `server/providers/base-provider.js`

所有 Provider 的公共基类，实现 IProvider 接口框架。

- [ ] **Step 1: 实现 base-provider.js**

```javascript
// server/providers/base-provider.js
import { EventEmitter } from 'events';

export class BaseProvider extends EventEmitter {
  constructor(providerType) {
    super();
    this.providerType = providerType;
    this.isRunning = false;
    this.sessionId = null;
  }

  // IProvider 接口 — 子类必须实现
  start(config) { throw new Error('start() not implemented'); }
  abort() { throw new Error('abort() not implemented'); }
  dispose() {
    this.removeAllListeners();
    this.isRunning = false;
  }

  // 便捷方法：emit 标准事件
  emitOutput(data) { this.emit('output', data); }
  emitComplete(result) { this.emit('complete', result); this.isRunning = false; }
  emitError(error) { this.emit('error', error); this.isRunning = false; }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/providers/base-provider.js
git commit -m "feat: add BaseProvider class implementing IProvider interface (P2)"
```

---

### Task 4: 重构 claude-sdk.js 为 Provider 适配器

**Files:**
- Create: `server/providers/claude-sdk.js`（从 `server/claude-sdk.js` 重构）

- [ ] **Step 1: 创建新的 claude-sdk Provider**

从现有 `server/claude-sdk.js`（795 行）重构为实现 IProvider 接口的类：

```javascript
import { BaseProvider } from './base-provider.js';

export class ClaudeSDKProvider extends BaseProvider {
  constructor() { super('claude-sdk'); }

  async start(config) {
    // 从现有 queryClaudeSDK() 提取核心逻辑
    // config 包含: command, options (sessionId, cwd, model, etc.), writer
    // for await 循环中：每次输出调用 this.emitOutput(data)
    // 完成时调用 this.emitComplete(result)
    // 错误时调用 this.emitError(error)
  }

  async abort() {
    // 从现有 abortClaudeSDKSession() 提取
    // 调用 instance.interrupt()
  }

  dispose() {
    // 清理临时文件、移除监听器
    super.dispose();
  }
}
```

关键重构点：
- `queryClaudeSDK()` 的 `ws.send()` 调用改为 `this.emitOutput()`
- 完成通知改为 `this.emitComplete()`
- 错误处理改为 `this.emitError()`
- `activeSessions` Map 移到 ProcessManager 管理
- `AbortController` 集成：超时时通过 `controller.abort()` 中断 `for await` 循环
- 保留 `mapCliOptionsToSDK()`、`transformMessage()`、`handleImages()`、`loadMcpConfig()` 等辅助函数
- 权限系统 `canUseTool` 回调保持不变，但通过事件而非直接 ws.send 通信

- [ ] **Step 2: 验证导入**

```bash
node -e "import('./server/providers/claude-sdk.js').then(m => console.log('OK'))"
```

- [ ] **Step 3: Commit**

```bash
git add server/providers/claude-sdk.js
git commit -m "feat: refactor claude-sdk as IProvider adapter (P2)"
```

---

### Task 5: 重构 claude-cli.js 为 Provider 适配器

**Files:**
- Create: `server/providers/claude-cli.js`（从 `server/claude-cli.js` 重构）

- [ ] **Step 1: 创建新的 claude-cli Provider**

从现有 `server/claude-cli.js`（575 行）重构：

```javascript
import { BaseProvider } from './base-provider.js';

export class ClaudeCLIProvider extends BaseProvider {
  constructor() { super('claude-cli'); }

  async start(config) {
    // 从现有 spawnClaudeCLI() 提取
    // spawn 子进程
    // stdout 解析 JSON 行
    // 每行输出: this.emitOutput(parsed)
    // process exit: this.emitComplete({ exitCode })
  }

  abort() {
    // SIGTERM → 由 ProcessManager 管理 SIGKILL 升级
    if (this.process) this.process.kill('SIGTERM');
  }

  dispose() {
    if (this.process && !this.process.killed) this.process.kill('SIGKILL');
    super.dispose();
  }
}
```

关键重构点：
- `ws.send()` 改为 `this.emitOutput()`
- `claude-complete` 消息改为 `this.emitComplete()`
- `activeClaudeCliProcesses` Map 移到 ProcessManager
- 保留 `lineBuffer` JSON 行解析逻辑
- 保留 `cleanupTempFiles()` 在 `dispose()` 中调用

- [ ] **Step 2: Commit**

```bash
git add server/providers/claude-cli.js
git commit -m "feat: refactor claude-cli as IProvider adapter (P2)"
```

---

### Task 6: 重构 cursor-cli、gemini-cli、openai-codex 为 Provider 适配器

**Files:**
- Create: `server/providers/cursor-cli.js`（从 `server/cursor-cli.js` 重构）
- Create: `server/providers/gemini-cli.js`（从 `server/gemini-cli.js` 重构）
- Create: `server/providers/openai-codex.js`（从 `server/openai-codex.js` 重构）

- [ ] **Step 1: 重构 cursor-cli（275 行 → ≤200 行）**

模式与 claude-cli 相同：继承 BaseProvider，`ws.send()` → `this.emitOutput()`，`activeCursorProcesses` → ProcessManager。

- [ ] **Step 2: 重构 gemini-cli（455 行 → ≤250 行）**

额外注意：
- 保留 `GeminiResponseHandler` NDJSON 缓冲逻辑
- 保留 120 秒超时重启逻辑（但改为通过事件触发）
- `sessionManager.js`（225 行）的会话持久化逻辑合并到 Provider 内部或保留独立

- [ ] **Step 3: 重构 openai-codex（403 行 → ≤250 行）**

额外注意：
- 保留 `AbortController` 机制
- Thread API 不变
- `activeCodexSessions` Map → ProcessManager
- 自动清理定时器保留

- [ ] **Step 4: 验证所有 Provider 可导入**

```bash
for f in server/providers/*.js; do node -e "import('./$f').then(() => console.log('OK: $f'))"; done
```

- [ ] **Step 5: Commit**

```bash
git add server/providers/
git commit -m "feat: refactor cursor, gemini, codex as IProvider adapters (P2)"
```

---

### Task 7: 创建 ProcessManager

**Files:**
- Create: `server/session/ProcessManager.js`

进程启停、强制清理、Provider 调度。

- [ ] **Step 1: 实现 ProcessManager**

功能要求：

**Provider 注册与调度**：
- `registerProvider(type, ProviderClass)` — 注册 Provider 工厂
- `startSession(sessionId, providerType, config)` — 创建 Provider 实例并启动
  - 实例化对应 Provider
  - 绑定 `output`、`complete`、`error` 事件监听
  - output → emit `process:output` + 转发给 SessionManager
  - complete → emit `process:complete` + 清理
  - error → emit `process:error` + 清理

**进程强制清理**：
- `abortSession(sessionId)` —
  1. 调用 `provider.abort()`（SIGTERM）
  2. 监听 `complete`/`error` 事件，等待 `PROCESS_SIGTERM_TIMEOUT_MS`（5s）
  3. 超时未退出 → 调用 `provider.dispose()`（SIGKILL）
  4. 再等 `PROCESS_SIGKILL_TIMEOUT_MS`（2s）
  5. 强制从 Map 中删除

**活跃会话追踪**：
- `activeProviders` Map: sessionId → { provider, providerType, startedAt }
- `getActiveByProvider(type)` → 返回指定类型的活跃会话
- `isActive(sessionId)` → 是否活跃

**资源清理**：
- `dispose()` → 强制清理所有活跃 Provider

**事件**（P3）：
- `process:output`、`process:complete`、`process:error`、`process:killed`

- [ ] **Step 2: Commit**

```bash
git add server/session/ProcessManager.js
git commit -m "feat: add ProcessManager with provider dispatch and force cleanup (P1,P3,P4)"
```

---

### Task 8: 集成到 server/index.js

**Files:**
- Modify: `server/index.js`

将 SessionManager、ProcessManager、MessageBuffer 接入现有消息处理流程。

- [ ] **Step 1: 导入新模块并初始化**

```javascript
import { SessionManager } from './session/SessionManager.js';
import { ProcessManager } from './session/ProcessManager.js';
import { MessageBuffer } from './message/MessageBuffer.js';
import { ClaudeSDKProvider } from './providers/claude-sdk.js';
import { ClaudeCLIProvider } from './providers/claude-cli.js';
import { CursorCLIProvider } from './providers/cursor-cli.js';
import { GeminiCLIProvider } from './providers/gemini-cli.js';
import { CodexProvider } from './providers/openai-codex.js';

const sessionManager = new SessionManager();
const processManager = new ProcessManager();
const messageBuffer = new MessageBuffer();

// 注册 Provider
processManager.registerProvider('claude', ClaudeSDKProvider);
processManager.registerProvider('claude-cli', ClaudeCLIProvider);
processManager.registerProvider('cursor', CursorCLIProvider);
processManager.registerProvider('gemini', GeminiCLIProvider);
processManager.registerProvider('codex', CodexProvider);
```

- [ ] **Step 2: 重写消息处理中的 Provider 调用**

替换 `handleChatConnection` 中的直接 Provider 调用（第1513-1609行）：

旧代码（5 个 if 分支直接调用各 Provider 函数）→ 新代码（统一通过 SessionManager + ProcessManager）：

```javascript
if (['claude-command', 'cursor-command', 'codex-command', 'gemini-command', 'claude-cli-command'].includes(data.type)) {
  const providerMap = {
    'claude-command': 'claude',
    'cursor-command': 'cursor',
    'codex-command': 'codex',
    'gemini-command': 'gemini',
    'claude-cli-command': 'claude-cli',
  };
  const providerType = providerMap[data.type];

  try {
    const sessionId = sessionManager.create(ws.userId, connectionId, { providerType });
    processManager.startSession(sessionId, providerType, { command, options, writer });
    sessionManager.transition(sessionId, 'start');
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      transport.send(connectionId, { type: 'quota-exceeded', reason: err.message });
    }
  }
}
```

- [ ] **Step 3: 连接事件监听**

```javascript
// ProcessManager 输出 → TransportLayer 发送 + MessageBuffer 缓存
processManager.on('process:output', ({ sessionId, data }) => {
  const session = sessionManager.getSession(sessionId);
  if (!session) return;

  sessionManager.transition(sessionId, 'output');
  messageBuffer.appendContent(sessionId, data.delta?.text || '');
  transport.send(session.connectionId, { type: 'claude-response', data, sessionId });
});

processManager.on('process:complete', ({ sessionId, result }) => {
  sessionManager.transition(sessionId, 'complete');
  messageBuffer.addCriticalEvent(sessionId, { type: 'session-completed', sessionId, result });
  const session = sessionManager.getSession(sessionId);
  if (session) {
    transport.send(session.connectionId, { type: 'session-completed', sessionId });
  }
  sessionManager.cleanup(sessionId);
});

sessionManager.on('session:timeout', ({ sessionId, timeoutType }) => {
  messageBuffer.addCriticalEvent(sessionId, { type: 'session-timeout', sessionId, timeoutType });
  const session = sessionManager.getSession(sessionId);
  if (session) {
    transport.send(session.connectionId, { type: 'session-timeout', sessionId, timeoutType });
  }
  processManager.abortSession(sessionId);
});
```

- [ ] **Step 4: 重写 abort 处理**

替换第1618-1641行的 abort 路由（5 个 if 分支）为统一调用：

```javascript
if (data.type === 'abort-session') {
  sessionManager.transition(data.sessionId, 'abort');
  processManager.abortSession(data.sessionId);
}
```

- [ ] **Step 5: 删除旧 Provider 直接导入**

删除 `server/index.js` 顶部对旧 Provider 文件的 import（`claude-sdk.js`、`claude-cli.js` 等）。

- [ ] **Step 6: 验证构建**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add server/index.js
git commit -m "feat: integrate SessionManager and ProcessManager, unify provider dispatch"
```

---

### Task 9: 删除旧 Provider 文件

**Files:**
- Delete: `server/claude-sdk.js`（已迁移到 `server/providers/claude-sdk.js`）
- Delete: `server/claude-cli.js`（已迁移到 `server/providers/claude-cli.js`）
- Delete: `server/cursor-cli.js`（已迁移到 `server/providers/cursor-cli.js`）
- Delete: `server/gemini-cli.js`（已迁移到 `server/providers/gemini-cli.js`）
- Delete: `server/openai-codex.js`（已迁移到 `server/providers/openai-codex.js`）

- [ ] **Step 1: 确认无其他文件引用旧路径**

```bash
grep -rn "from.*['\"]\.\/claude-sdk\|from.*['\"]\.\/claude-cli\|from.*['\"]\.\/cursor-cli\|from.*['\"]\.\/gemini-cli\|from.*['\"]\.\/openai-codex" server/ --include="*.js"
```
Expected: 无匹配（所有引用已指向 `./providers/` 下的新文件）

- [ ] **Step 2: 删除旧文件**

```bash
git rm server/claude-sdk.js server/claude-cli.js server/cursor-cli.js server/gemini-cli.js server/openai-codex.js
```

- [ ] **Step 3: 构建验证**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove legacy provider files, migrated to server/providers/"
```

---

### Task 10: 端到端验证

**Files:** 无新增

- [ ] **Step 1: 完整构建和 lint**

```bash
npm run build && npm run lint 2>&1 | grep "error" | head -10
```

- [ ] **Step 2: 启动服务验证**

```bash
lsof -ti:3001 | xargs kill -9 2>/dev/null; npm run dev &
sleep 5
```

- [ ] **Step 3: 手动测试各 Provider**

验证项：
- [ ] Claude SDK: 发送消息，收到流式响应，正常完成
- [ ] 中止会话: 发送 abort，会话正常终止
- [ ] 超时测试: 观察服务端日志中的超时计时器启停
- [ ] 配额检查: 日志中显示会话创建和配额信息

- [ ] **Step 4: 架构合规检查**

- [ ] 所有新文件 ≤300 行
- [ ] 日志带 `[Session]`/`[Process]`/`[Buffer]` 前缀
- [ ] 模块间通过 EventEmitter 通信
- [ ] 状态机为纯函数
- [ ] 所有超时值来自 constants.js
- [ ] 无旧 Provider 文件残留

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete Plan 2 - session layer and provider adapters"
```
