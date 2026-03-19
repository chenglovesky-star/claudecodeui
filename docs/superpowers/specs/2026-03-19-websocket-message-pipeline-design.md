# WebSocket 消息管道重构设计

## 概述

重构 claudecodeui 的 WebSocket 通信架构，将散落在 `server/index.js`（2686 行）、`claude-sdk.js`、`claude-cli.js` 中的消息处理逻辑，重构为三层可靠消息管道，解决 UI 长时间卡在"思考中"、连接断开未检测、消息丢失等问题。

## 问题背景

当前架构存在以下导致 UI 卡死的根因：

1. **SDK 查询无超时**：`queryClaudeSDK()` 的 `for await` 循环可能无限期挂起
2. **心跳机制混乱**：协议级 ping 和应用级 JSON ping 并存，非对称间隔（30s/25s）
3. **消息静默丢失**：客户端队列满（50 条）时丢弃消息，包括关键的完成事件
4. **WebSocket 无背压**：`ws.send()` 缓冲溢满时消息丢失
5. **进程清理不完整**：只 `stdin.end()` 不强制 kill，僵尸进程残留
6. **无资源配额**：单用户可启动无限会话，耗尽服务器资源

## 目标环境

- Docker 单实例部署
- 5-20 人中等团队并发使用
- 无向后兼容约束，前后端一起改

## 架构原则

本次重构遵循以下架构原则，所有设计决策必须与之对齐：

### P1：单一职责（Single Responsibility）

每个模块只做一件事。当前 `server/index.js` 同时负责 HTTP 路由、WebSocket 连接管理、心跳、Claude 查询调度、消息分发、Shell 处理——违反了这一原则。重构后：

| 模块 | 唯一职责 | 不关心 |
|------|---------|--------|
| TransportLayer | 连接存活性和数据传输能力 | 消息语义、会话状态 |
| ConnectionRegistry | 连接注册与生命周期追踪 | 消息内容、心跳策略 |
| SessionManager | 会话状态机和超时控制 | 连接细节、进程实现 |
| ProcessManager | 进程启停和资源回收 | 会话逻辑、消息协议 |
| MessageRouter | 消息协议解析和路由分发 | 连接管理、进程管理 |
| MessageBuffer | 消息缓冲和断线恢复数据 | 消息路由、会话超时 |
| ShellHandler | Shell WebSocket 和 PTY 管理 | 聊天消息、Claude 查询 |
| Provider 适配器 | 特定 AI 后端的通信协议 | 其他 Provider 的实现 |

**检验标准**：如果修改一个模块需要同时改另一个模块的内部实现（而非接口），说明耦合过紧。

### P2：依赖倒置（Dependency Inversion）

高层模块不依赖低层模块的具体实现，都依赖抽象接口。

```
MessageRouter ──→ ISession（接口）←── SessionManager
SessionManager ──→ IProvider（接口）←── claude-sdk / claude-cli / cursor / ...
SessionManager ──→ ITransport（接口）←── TransportLayer
```

**IProvider 统一接口**：
```typescript
interface IProvider {
  start(config: QueryConfig): void;
  abort(): void;
  onOutput(callback: (data: ProviderOutput) => void): void;
  onComplete(callback: (result: CompletionResult) => void): void;
  onError(callback: (error: ProviderError) => void): void;
  dispose(): void;
}
```

**ITransport 统一接口**：
```typescript
interface ITransport {
  send(connectionId: string, message: object): SendResult;
  onMessage(connectionId: string, callback: (msg: object) => void): void;
  isAlive(connectionId: string): boolean;
  getBackpressureState(connectionId: string): 'normal' | 'congested' | 'blocked';
}
```

**ISession 统一接口**：
```typescript
interface ISession {
  create(userId: number, connectionId: string, config: SessionConfig): string;
  abort(sessionId: string): void;
  getState(sessionId: string): SessionState;
  resume(sessionId: string, lastSeqId: number): ResumeData;
}
```

新增 Provider 只需实现 `IProvider`，无需改动 SessionManager 或 MessageRouter。

### P3：事件驱动解耦（Event-Driven Decoupling）

模块间通过事件通信，不直接调用彼此方法。使用 Node.js `EventEmitter` 实现：

```
TransportLayer ──emit('connection:dead')──→ SessionManager 监听并清理会话
SessionManager ──emit('session:timeout')──→ MessageRouter 监听并发送前端事件
ProcessManager ──emit('process:exit')──→ SessionManager 监听并更新状态
MessageBuffer ──emit('buffer:overflow')──→ MessageRouter 监听并发送截断通知
```

**好处**：
- TransportLayer 不知道 SessionManager 的存在，只发布事件
- 新增监听者不需要修改发布者的代码
- 便于单元测试（mock EventEmitter 即可）

### P4：防御性编程（Defensive Programming）

所有边界都假设对方可能失败：
- 每个异步操作都有超时，**没有永远等待的代码路径**
- 每个资源分配都有对应的释放路径（进程、连接、定时器、缓冲区）
- 每个错误都向上传播到用户可见的 UI 反馈，**不静默吞掉错误**
- 队列/缓冲区都有上限，超限时明确的降级策略而非 OOM

### P5：代码整洁（Clean Code）

- **文件大小**：单文件不超过 300 行。超过时必须拆分
- **函数长度**：单函数不超过 40 行。超过时提取子函数
- **命名一致性**：事件名 `domain:action` 格式（如 `session:timeout`、`connection:dead`）；消息类型 `kebab-case`（如 `claude-response`、`session-completed`）
- **无魔法数字**：所有阈值（超时时间、队列大小、缓冲上限）提取为命名常量，集中定义在 `server/config/constants.js`
- **日志规范**：每个模块使用带前缀的日志（`[Transport]`、`[Session]`、`[Router]`），便于问题定位
- **无死代码**：重构过程中移除所有未使用的变量、函数、导入

### P6：可测试性（Testability）

- 模块间通过接口交互，可独立 mock 测试
- 状态机逻辑纯函数化，输入状态+事件 → 输出新状态，无副作用
- 定时器通过注入（传入 `setTimeout` 函数引用）而非直接调用，测试时可用 fake timer
- 关键路径需有测试覆盖：超时触发、进程清理、断线恢复、背压降级

---

## 架构设计

### 三层消息管道

```
传输层 (TransportLayer)     → 心跳、背压、断线检测、连接注册
会话层 (SessionManager)     → 查询超时、进程生命周期、资源配额、消息缓冲
应用层 (MessageRouter)      → 消息协议、路由分发、状态恢复
```

---

## 第一层：传输层

> **原则对齐**：TransportLayer 只关心"连接是否活着、能否发数据"（P1）。通过 `ITransport` 接口暴露能力（P2）。连接死亡时 emit `connection:dead` 事件，不直接调用 SessionManager（P3）。所有心跳和背压阈值提取为常量（P5）。

### 心跳协议

**服务端 → 客户端**：协议级 `ws.ping()`
- 间隔 20 秒
- pong 超时 8 秒
- 连续 2 次 pong 超时才断开（容忍单次网络抖动）
- 最迟 48 秒检测到死连接

**客户端 → 服务端**：应用级 heartbeat
- 客户端每 20 秒发 `{ type: 'heartbeat', ts: Date.now() }`
- 服务端回复 `{ type: 'heartbeat-ack', ts }`
- 客户端 8 秒未收到 ack → 标记可疑，再等一轮 → 确认断开，触发重连
- 浏览器 WebSocket API 不暴露协议级 ping/pong，因此客户端必须用应用级心跳

**清理项**：删除现有的应用级 JSON ping/pong 逻辑、pongTimeout 逻辑。心跳和死连接检测各只有一条路径。

### 背压处理

每次 `ws.send()` 前检查 `ws.bufferedAmount`：

| 阈值 | 状态 | 动作 |
|------|------|------|
| < 64KB | 正常 | 直接发送 |
| 64KB - 256KB | 拥塞 | 发送但通知会话层降速 |
| > 256KB | 阻塞 | 暂停发送，排队等待 drain 事件 |

drain 事件触发后恢复发送队列。

### 连接管理

- `ConnectionRegistry` 跟踪所有活跃连接（chat + shell 两种类型）
- 每个连接有唯一 `connectionId`
- 定时扫描（60 秒），清理超过心跳周期无响应的僵尸连接
- 连接关闭时通知会话层清理关联资源
- Shell 连接和 Chat 连接统一由传输层管理心跳和生命周期，通过 `connectionType` 区分

### 客户端重连

- 指数退避：1s → 2s → 4s → ... → 30s（保持现有策略）
- 重连成功后发送 `{ type: 'resume', sessionId, lastSeqId }` 请求恢复
- 页面可见性 + 网络状态双重触发重连

---

## 第二层：会话层

> **原则对齐**：SessionManager 只管会话生命周期（P1）。通过 `ISession` 接口暴露能力，通过 `IProvider` 接口调用后端（P2）。超时/abort 时 emit `session:timeout`、`session:error` 事件（P3）。每个异步路径都有超时兜底（P4）。状态机为纯函数 `(state, event) → newState`（P6）。

### 会话状态机

```
idle → running → streaming → completed
                           → timeout
                           → error
                           → aborted
              → tool_executing → streaming（工具返回后继续）
                               → timeout
```

每个会话对象：

```javascript
{
  sessionId: string,
  userId: number,
  connectionId: string,
  state: 'idle' | 'running' | 'streaming' | 'tool_executing' | 'completed' | 'timeout' | 'error' | 'aborted',
  process: ChildProcess | null,
  sdkInstance: object | null,
  createdAt: number,
  lastActivityAt: number,       // 每次收到输出时更新
  seqId: 0,                     // 消息序号递增
  criticalEventBuffer: [],      // 关键事件缓冲
  streamBuffer: [],             // 流式 delta 环形缓冲
  currentContent: '',           // 当前完整内容（用于 snapshot）
}
```

### 超时机制

| 超时类型 | 时间 | 触发条件 | 动作 |
|---------|------|---------|------|
| 首响应超时 | 60 秒 | `running` 状态下无任何输出 | 发送 `session-timeout` → 强制 abort |
| 流式活动超时 | 120 秒 | `streaming` 状态下无新输出 | 发送 `session-timeout` → 强制 abort |
| 工具执行超时 | 10 分钟 | `tool_executing` 状态下无结果返回 | 发送 `session-timeout` → 强制 abort |
| 全局超时 | 30 分钟 | 会话总时长超限 | 发送 `session-timeout` → 强制 abort |

每次收到 Claude 输出时重置对应的活动超时计时器。超时**一定会向前端发送 `session-timeout` 事件**，前端据此退出"思考中"状态。

状态切换时机：
- 收到 `content_block_start`（type=tool_use）→ 进入 `tool_executing`
- 收到 `tool_result` 或下一个非 tool_use 的 `content_block_start` → 回到 `streaming`

### SDK 查询超时中断机制

`for await (const message of queryInstance)` 循环无法被外部超时直接打断。采用以下方案：

**Claude Agent SDK**：使用 `AbortController` 传入 SDK 的 `query()` 方法。超时触发时调用 `controller.abort()`，SDK 内部抛出 `AbortError`，`for await` 循环自然退出。如果 SDK 不支持 AbortSignal，使用 `Promise.race` 包装：

```javascript
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('SESSION_TIMEOUT')), timeoutMs)
);

try {
  for await (const message of queryInstance) {
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => controller.abort(), activityTimeoutMs);
    // 处理消息...
  }
} catch (err) {
  if (err.name === 'AbortError' || err.message === 'SESSION_TIMEOUT') {
    // 超时处理：通知前端，清理资源
  }
}
```

**Claude CLI 子进程**：超时直接走进程强制清理流程（SIGTERM → SIGKILL），stdout 流自然关闭，解析循环退出。

### 多 Provider 支持策略

当前项目支持多个 Provider（Claude SDK、Claude CLI、Cursor、Codex、Gemini）。本次重构策略：

- **SessionManager 和 ProcessManager 为所有 Provider 提供统一接口**：超时、状态机、进程清理适用于所有 Provider
- ProcessManager 通过 `providerType` 字段区分不同后端，调用对应的适配器
- 各 Provider 适配器（`claude-sdk.js`、`claude-cli.js`、`cursor-cli.js`、`openai-codex.js`、`gemini-cli.js`）实现统一的接口：`start()`、`abort()`、`onOutput(callback)`、`onComplete(callback)`、`onError(callback)`
- 未来新增 Provider 只需实现这个接口即可接入

### 进程强制清理

```
abort 请求
  → SIGTERM
  → 监听 exit 事件，等待 5 秒
  → 如果 5 秒内收到 exit → 确认退出，从 Map 中删除
  → 如果 5 秒超时未 exit → SIGKILL → 再等 2 秒 → 强制从 Map 中删除
```

**关键**：只有在确认进程退出（exit 事件）或 SIGKILL 超时后才从 Map 中删除引用，避免发完信号就丢失进程引用的问题。

### 资源配额

| 维度 | 限制 | 超限行为 |
|------|------|---------|
| 每用户并发会话 | 3 | 拒绝，前端提示"请等待当前任务完成" |
| 全局并发会话 | 30 | 拒绝，前端提示"服务器繁忙，请稍后重试" |
| 单会话最大输出 | 10MB | 截断并通知 |

### 双缓冲策略

**关键事件缓冲**（上限 500 条）：
- 缓存所有状态变更事件：`session-started`、`tool_use`、`session-completed`、`session-timeout`、`session-error`
- FIFO 淘汰（先进先出），但 `session-started` 和最后一条状态变更事件永远钉住
- 会话结束后清理

**流式恢复策略**：
- 不使用环形缓冲存储流式 delta（delta 粒度太小，缓冲区几秒就被覆盖，实用价值低）
- 直接依赖 snapshot 恢复：断线重连时发送完整的 currentContent，前端替换而非追加

**Snapshot 维护**：
- `MessageBuffer` 在每次收到 `content_block_delta` 时追加到 `currentContent`
- `content_block_stop` 时标记该 block 完成
- Snapshot 结构：`{ currentContent, completedBlocks, pendingToolUses }`

---

## 第三层：应用层

> **原则对齐**：MessageRouter 只负责消息解析和路由（P1）。不直接操作连接或进程，通过 `ISession` 和 `ITransport` 接口交互（P2）。监听 `session:*` 事件转发给前端（P3）。消息类型 kebab-case、事件名 domain:action（P5）。

### 消息协议

**客户端 → 服务端**：

| type | 说明 | 载荷 |
|------|------|------|
| `claude-command` | 发起查询 | `{ message, projectPath, sessionId?, ... }` |
| `claude-abort` | 中止会话 | `{ sessionId }` |
| `resume` | 断线重连恢复 | `{ sessionId, lastSeqId }` |
| `heartbeat` | 心跳 | `{ ts }` |

**服务端 → 客户端**：

| type | 说明 | 载荷 |
|------|------|------|
| `session-started` | 会话创建 | `{ sessionId, seqId }` |
| `claude-response` | Claude 输出 | `{ data, sessionId, seqId }` |
| `session-completed` | 正常结束 | `{ sessionId, seqId }` |
| `session-timeout` | 超时终止 | `{ sessionId, seqId, reason, timeoutType }` |
| `session-error` | 异常 | `{ sessionId, seqId, error }` |
| `session-aborted` | 用户中止确认 | `{ sessionId, seqId }` |
| `resume-response` | 重连恢复数据 | `{ missedCriticalEvents, snapshot?, currentState, lastSeqId }` |
| `heartbeat-ack` | 心跳回复 | `{ ts }` |
| `quota-exceeded` | 配额超限 | `{ reason }` |
| `backpressure` | 拥塞通知 | `{ sessionId }` |

**seqId 作用域**：以 connection 为作用域递增，与 sessionId 无关。每个 WebSocket 连接维护自己的 seqId 计数器。`heartbeat-ack`、`quota-exceeded` 等不绑定 session 的消息同样携带 seqId，确保客户端可以检测任何消息缺失。

### 断线恢复流程

```
重连成功
  → 客户端发送 { type: 'resume', sessionId, lastSeqId }
  → 服务端从双缓冲中查找 lastSeqId 之后的消息
  → 回复 resume-response:
      {
        missedCriticalEvents: [...],      // 缺失的关键事件
        snapshot: { currentContent, ... }, // 如果流式 delta 有缺口
        currentState: "streaming"          // 会话当前状态
      }
  → 前端根据 currentState 恢复 UI:
      - streaming / tool_executing → 继续显示流式状态
      - completed → 退出思考状态，显示完整结果
      - timeout / error → 显示对应提示
```

### 前端防卡死兜底

即使所有服务端机制都失效，前端自身兜底：
- 发送 `claude-command` 后启动本地计时器
- 收到任何 `claude-response` 时重置计时器
- 根据会话状态动态调整超时：
  - `running` / `streaming` → 90 秒
  - `tool_executing` → 10 分钟 + 30 秒余量（与服务端工具执行超时对齐）
- 超时后显示"响应超时，是否重试？"按钮
- 不再无限等待

---

## 服务端文件拆分

将 `server/index.js`（2686 行）拆分为：

```
server/
├── index.js                      ← 入口，启动和模块组装（~200行）
├── config/
│   └── constants.js              ← 所有阈值常量集中定义（P5：无魔法数字）
├── websocket/
│   ├── TransportLayer.js         ← 连接管理、心跳、背压（实现 ITransport）
│   ├── ConnectionRegistry.js     ← 连接注册表、僵尸清理
│   └── ShellHandler.js           ← Shell WebSocket 连接处理（PTY 管理）
├── session/
│   ├── SessionManager.js         ← 会话生命周期、超时、配额（实现 ISession）
│   └── ProcessManager.js         ← CLI/SDK 进程管理、强制清理
├── message/
│   ├── MessageRouter.js          ← 消息协议、路由分发
│   └── MessageBuffer.js          ← 关键事件缓冲 + snapshot 维护
├── providers/                    ← Provider 适配器（均实现 IProvider）
│   ├── claude-sdk.js             ← Claude Agent SDK 适配
│   ├── claude-cli.js             ← Claude CLI 适配
│   ├── cursor-cli.js             ← Cursor 适配
│   ├── openai-codex.js           ← Codex 适配
│   └── gemini-cli.js             ← Gemini 适配
├── routes/                       ← 现有 HTTP routes（不变）
└── middleware/                   ← 现有中间件（不变）
```

### 死代码清理

重构过程中清理以下死代码：
- `WebSocketContext.tsx` 中的 JSON ping/pong 逻辑
- `server/index.js` 中与新模块重复的连接管理代码
- 未使用的变量、过时的注释
- 确保不破坏现有功能

---

## 改动范围

| 层面 | 文件 | 类型 |
|------|------|------|
| 服务端 | `server/index.js` | 拆分为多个模块 |
| 服务端 | `server/websocket/TransportLayer.js` | 新增 |
| 服务端 | `server/websocket/ConnectionRegistry.js` | 新增 |
| 服务端 | `server/session/SessionManager.js` | 新增 |
| 服务端 | `server/session/ProcessManager.js` | 新增 |
| 服务端 | `server/message/MessageRouter.js` | 新增 |
| 服务端 | `server/message/MessageBuffer.js` | 新增 |
| 服务端 | `server/websocket/ShellHandler.js` | 新增：Shell 连接处理 |
| 服务端 | `server/providers/claude-sdk.js` | 重构：统一 Provider 接口 |
| 服务端 | `server/providers/claude-cli.js` | 重构：统一 Provider 接口 |
| 服务端 | `server/providers/cursor-cli.js` | 重构：统一 Provider 接口 |
| 服务端 | `server/providers/openai-codex.js` | 重构：统一 Provider 接口 |
| 服务端 | `server/providers/gemini-cli.js` | 重构：统一 Provider 接口 |
| 客户端 | `src/contexts/WebSocketContext.tsx` | 重写：适配新协议 |
| 客户端 | `src/components/chat/hooks/useChatRealtimeHandlers.ts` | 重写：适配新消息类型 |
| 客户端 | `src/components/chat/hooks/useChatSessionState.ts` | 修改：新增超时/恢复状态 |
| 服务端 | `server/config/constants.js` | 新增：集中定义阈值常量 |

---

## 架构合规检查清单

每个模块实现完成后，必须通过以下检查：

| 检查项 | 对应原则 | 标准 |
|--------|---------|------|
| 单一职责 | P1 | 能否用一句话描述模块做什么？改这个模块是否不需要改其他模块的内部实现？ |
| 接口依赖 | P2 | 是否只通过 ITransport/ISession/IProvider 接口交互？有无直接 import 具体实现？ |
| 事件解耦 | P3 | 模块间是否通过 EventEmitter 通信？有无跨模块直接方法调用？ |
| 无永久等待 | P4 | 每个异步操作是否都有超时？每个资源分配是否有释放路径？ |
| 文件大小 | P5 | 单文件是否 ≤ 300 行？单函数是否 ≤ 40 行？ |
| 命名规范 | P5 | 事件名是否 `domain:action`？消息类型是否 `kebab-case`？有无魔法数字？ |
| 日志前缀 | P5 | 日志是否带 `[ModuleName]` 前缀？ |
| 可测试 | P6 | 能否独立 mock 测试？状态机是否纯函数？定时器是否可注入？ |
| 无死代码 | P5 | 有无未使用的变量、函数、导入？ |
