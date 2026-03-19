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

## 架构设计

### 三层消息管道

```
传输层 (TransportLayer)     → 心跳、背压、断线检测、连接注册
会话层 (SessionManager)     → 查询超时、进程生命周期、资源配额、消息缓冲
应用层 (MessageRouter)      → 消息协议、路由分发、状态恢复
```

---

## 第一层：传输层

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

### 进程强制清理

```
abort 请求 → SIGTERM → 等待 5 秒 → SIGKILL → 从 Map 中删除
```

### 资源配额

| 维度 | 限制 | 超限行为 |
|------|------|---------|
| 每用户并发会话 | 3 | 拒绝，前端提示"请等待当前任务完成" |
| 全局并发会话 | 30 | 拒绝，前端提示"服务器繁忙，请稍后重试" |
| 单会话最大输出 | 10MB | 截断并通知 |

### 双缓冲策略

**关键事件缓冲**（上限 500 条）：
- 缓存所有状态变更事件：`session-started`、`tool_use`、`session-completed`、`session-timeout`、`session-error`
- LRU 淘汰，但 `session-started` 和最后一条状态变更事件永远钉住
- 会话结束后清理

**流式缓冲**（环形，200 条）：
- 缓存最近的 `content_block_delta` 消息
- 环形覆盖

**Snapshot 维护**：
- `MessageBuffer` 在每次收到 `content_block_delta` 时追加到 `currentContent`
- `content_block_stop` 时标记该 block 完成
- Snapshot 结构：`{ currentContent, completedBlocks, pendingToolUses }`

---

## 第三层：应用层

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
| `resume-response` | 重连恢复数据 | `{ missedCriticalEvents, snapshot?, currentState }` |
| `heartbeat-ack` | 心跳回复 | `{ ts }` |
| `quota-exceeded` | 配额超限 | `{ reason }` |
| `backpressure` | 拥塞通知 | `{ sessionId }` |

所有服务端消息携带递增 `seqId`，客户端据此判断是否有缺失。

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
- 发送 `claude-command` 后启动 90 秒本地计时器
- 收到任何 `claude-response` 时重置计时器
- 超时后显示"响应超时，是否重试？"按钮
- 不再无限等待

---

## 服务端文件拆分

将 `server/index.js`（2686 行）拆分为：

```
server/
├── index.js                      ← 入口，启动和模块组装（~200行）
├── websocket/
│   ├── TransportLayer.js         ← 连接管理、心跳、背压
│   └── ConnectionRegistry.js     ← 连接注册表、僵尸清理
├── session/
│   ├── SessionManager.js         ← 会话生命周期、超时、配额
│   └── ProcessManager.js         ← CLI/SDK 进程管理、强制清理
├── message/
│   ├── MessageRouter.js          ← 消息协议、路由分发
│   └── MessageBuffer.js          ← 双缓冲（关键事件 + 流式）+ snapshot 维护
├── routes/                       ← 现有 HTTP routes（不变）
├── middleware/                   ← 现有中间件（不变）
└── claude-sdk.js / claude-cli.js ← 适配为被 ProcessManager 调用
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
| 服务端 | `server/claude-sdk.js` | 修改：适配 ProcessManager |
| 服务端 | `server/claude-cli.js` | 修改：适配 ProcessManager |
| 客户端 | `src/contexts/WebSocketContext.tsx` | 重写：适配新协议 |
| 客户端 | `src/components/chat/hooks/useChatRealtimeHandlers.ts` | 重写：适配新消息类型 |
| 客户端 | `src/components/chat/hooks/useChatSessionState.ts` | 修改：新增超时/恢复状态 |
