# API Key 池 + 请求队列 + 排队感知 — 架构设计

## 问题

当多用户（10-30人）并发使用时，所有请求共用单个 Anthropic API Key，导致上游返回 429 `rate_limit_error`，用户看到原始错误信息，体验严重受损。

## 目标

1. 支持多 Key 轮询，线性提升吞吐量
2. 超出所有 Key 容量时优雅排队，而非报错
3. 前端实时展示排队位置和预估等待时间
4. 自动捕获 429 并重试，用户无感知
5. 兼容现有单 Key 部署，零配置即可使用

## 非目标

- 持久化队列（重启丢失可接受）
- 优先级调度（当前 FIFO 即可）
- 多节点分布式部署
- API Key 加密存储（已知安全权衡，后续迭代可加 AES-256 对称加密）

---

## 架构总览

```
用户请求 (WebSocket)
    ↓
MessageRouter.#handleProviderCommand()
    ↓ [队列拦截点：在 SessionManager.create() 之前]
RequestQueue.enqueue()
    ↓ 队列为空且有可用 Key    ↓ 需要排队
    ↓ 快速路径（不入队）       入队等待 → 事件驱动调度
    ↓                              ↓
SessionManager.create()        推送 queue-status
    ↓                              ↓ Key 可用时
ProcessManager.startSession()  出队 → SessionManager.create() → ...
    ↓
ClaudeSDKProvider.start()
    ↓
queryClaudeSDK(assignedKey)
    ↓
流式响应 → 前端
```

### 精确集成位置

队列拦截发生在 `MessageRouter.#handleProviderCommand()` 中，**`SessionManager.create()` 之前**。排队期间不创建 session，不占用 `QUOTA_MAX_SESSIONS_PER_USER` 配额。出队后才走正常的 SessionManager → ProcessManager → ClaudeSDKProvider 链路。

修改后的完整调用链：

```
原流程：
  MessageRouter.#handleProviderCommand()
    → SessionManager.create()      // 配额检查
    → emit router:startSession
    → ProcessManager.startSession()
    → ClaudeSDKProvider.start()
    → queryClaudeSDK()

新流程：
  MessageRouter.#handleProviderCommand()
    → RequestQueue.enqueue()        // 队列拦截
      → [快速路径或排队等待]
      → KeyPoolManager.acquire()    // 分配 Key
    → SessionManager.create()       // 出队后才创建 session
    → emit router:startSession
    → ProcessManager.startSession()
    → ClaudeSDKProvider.start()
    → queryClaudeSDK(assignedKey)   // 传入分配的 Key
```

---

## 第一部分：API Key 池管理

### 数据存储

在 SQLite 数据库新增 `api_key_pool` 表（仅存储静态配置）：

```sql
CREATE TABLE IF NOT EXISTS api_key_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  rpm_limit INTEGER DEFAULT 50,
  total_requests INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

注意：`current_rpm`、Key 状态（active/cooling/error）等运行时数据 **纯内存管理**，不写入 DB。这与"非目标：持久化队列（重启丢失可接受）"的设计哲学一致，也避免了 SQLite 同步写入在高频调度中的性能瓶颈。

### KeyPoolManager 类

文件：`/server/queue/KeyPoolManager.js`

**职责**：管理 Key 池，选择最优 Key，处理熔断与恢复。

**内存状态结构**（每个 Key）：

```javascript
{
  id: number,
  name: string,
  apiKey: string,
  rpmLimit: number,
  status: 'active' | 'cooling' | 'disabled' | 'error',
  // 滑动窗口：记录最近 60 秒内的请求时间戳
  requestTimestamps: [],
  consecutiveErrors: 0,
  coolingUntil: null,
  errorCoolingUntil: null
}
```

**Key 选择策略**：最低负载优先 — 选择 `滑动窗口内请求数 / rpm_limit` 比率最低的 Key。

**RPM 计数方式**：使用 **滑动窗口** 而非固定窗口重置。`acquire()` 时先清理超过 60 秒的时间戳，再计算当前窗口内的请求数。这避免了固定窗口边界的突发问题（如在窗口末尾和下一窗口开头各发满额请求）。

**Key 状态**：

| 状态 | 含义 | 行为 |
|------|------|------|
| `active` | 正常 | 正常分配 |
| `cooling` | 收到 429，冷却中 | 跳过，冷却结束自动恢复为 active |
| `disabled` | 管理员手动禁用 | 跳过 |
| `error` | 连续 3 次非 429 错误 | 跳过，5 分钟后自动重试 |

**核心方法**：

- `acquire()` — 返回最优 Key，或 `null`（全部满载）；成功时自动记录时间戳
- `release(keyId)` — 请求完成后的回调（更新统计，触发 `key:released` 事件）。由 `ProcessManager` 监听 `process:complete` 和 `process:error` 事件后调用
- `markCooling(keyId)` — 收到 429 时标记冷却 60 秒，冷却结束触发 `key:available` 事件
- `markError(keyId)` — 非 429 错误计数，连续 3 次进入 error 状态
- `getStats()` — 返回所有 Key 的状态摘要（apiKey 脱敏）
- `on('key:available', callback)` — Key 从不可用变为可用时触发

**兼容性**：启动时检查 `ANTHROPIC_AUTH_TOKEN` 环境变量，若 `api_key_pool` 表为空，自动插入为默认 Key。

### 管理 API

作为现有 `settingsRoutes` 的子路由实现（复用认证中间件链），路径：`/api/settings/key-pool`

注意：现有 `/api/settings/api-keys` 已用于用户个人 API Key（Agent API 认证），此处使用 `/key-pool` 避免冲突。

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/` | 列出所有 Key（api_key 脱敏显示）+ 运行时统计 |
| POST | `/` | 添加 Key |
| DELETE | `/:id` | 删除 Key |
| PATCH | `/:id` | 启用/禁用、修改 rpm_limit |

### 数据库操作层

文件：`/server/database/anthropicKeyPoolDb.js`

提供 `api_key_pool` 表的 CRUD 封装（仅静态配置字段）。

---

## 第二部分：请求队列与调度引擎

### RequestQueue 类

文件：`/server/queue/RequestQueue.js`

**职责**：管理请求排队、调度、超时淘汰。

**队列项结构**：

```javascript
{
  id: 'req-uuid',
  userId: number,
  username: string,
  connectionId: string,
  command: string,
  options: object,
  priority: 0,
  enqueuedAt: number,
  status: 'waiting' | 'dispatched' | 'cancelled',
  assignedKey: null,          // 出队时分配的 Key
  onDispatched: callback      // 出队时的回调，继续执行 SessionManager.create() 后续链路
}
```

**调度规则**：

1. FIFO — 先来先服务
2. 公平性 — 同一用户最多占队列 3 个 **排队** 位置（`QUOTA_MAX_QUEUE_PER_USER`，独立于 `QUOTA_MAX_SESSIONS_PER_USER`）。两个限制语义不同：SessionManager 限制正在执行的并发会话数，RequestQueue 限制排队中的请求数。用户实际上最多同时有 3 个执行中 + 3 个排队中 = 6 个请求。
3. 超时淘汰 — 排队超过 120 秒自动移除，通知用户
4. 断连清理 — 监听 `ConnectionRegistry` 的 `connection:unregistered` 事件，调用 `cancelByConnection(connectionId)` 移除排队项。已出队正在执行的请求（`dispatched` 状态）由现有的 SessionManager/ProcessManager 断连逻辑处理，不在队列层重复处理。
5. 队列满拒绝 — 当队列长度达到 `QUEUE_MAX_SIZE` 时，新请求直接拒绝，返回 `{ type: 'error', data: { code: 'QUEUE_FULL', message: '系统繁忙，请稍后重试' } }`

**调度机制**（事件驱动 + 轮询兜底）：

主要通过事件驱动：
- `KeyPoolManager` 触发 `key:available` 事件时（Key 释放或冷却恢复），立即调用 `_tryDispatchNext()`
- `enqueue()` 时如果队列为空且有可用 Key，走快速路径直接分配

兜底轮询：每秒检查一次，处理可能遗漏的事件（如定时器恢复的 Key）。

**快速路径规则**：`enqueue()` 时仅当 **队列为空** 且有可用 Key 时才走快速路径直接分配，避免后来者插队。

**核心方法**：

- `enqueue(request)` — 入队或快速分配，返回 `{ queued: boolean, position?: number, assignedKey?: object }`
- `cancel(requestId)` — 取消排队
- `cancelByConnection(connectionId)` — 按连接 ID 批量取消排队项
- `getPosition(requestId)` — 获取当前位置
- `getStats()` — 队列长度、平均等待时间

### 新增常量

文件：`/server/config/constants.js`

```javascript
export const QUEUE_MAX_SIZE = 50;
export const QUEUE_TIMEOUT_MS = 120000;
export const QUEUE_POLL_INTERVAL_MS = 1000;
export const QUOTA_MAX_QUEUE_PER_USER = 3;
export const KEY_COOLDOWN_MS = 60000;
export const KEY_ERROR_COOLDOWN_MS = 300000;
export const KEY_MAX_CONSECUTIVE_ERRORS = 3;
```

---

## 第三部分：前端排队状态感知

### WebSocket 新消息类型

```javascript
// 排队中（每秒推送）
{ type: 'queue-status', data: { status: 'queued', position: 3, estimatedWaitSec: 15, queuedAt: timestamp } }

// 出队
{ type: 'queue-status', data: { status: 'dispatched' } }

// 超时
{ type: 'queue-status', data: { status: 'timeout', message: '排队超时，请稍后重试' } }

// 队列满
{ type: 'queue-status', data: { status: 'rejected', message: '系统繁忙，请稍后重试' } }
```

### 预估等待时间算法

```
estimatedWaitSec = position * (avgCompletionTime / activeKeyCount)
```

- `avgCompletionTime`：最近 20 次请求的 **完整请求完成时间** 的滑动平均（因为排队等待的是 Key 释放，而非首 token 到达）
- `activeKeyCount`：当前 active 状态的 Key 数（减去当前正在执行的请求数后的可用并发余量）
- 兜底值：无历史数据时默认 10 秒/位

### 前端 UI

修改 `WebSocketContext.tsx`，新增 `queue-status` 消息处理。

消息展示组件中：
- 无排队：显示"思考中..."（不变）
- 有排队：显示"当前排队第 X 位，预计等待约 X 秒"
- 出队：切回"思考中..."
- 队列满/超时：显示错误提示

---

## 第四部分：错误处理与容错

### 429 重试机制

429 的处理必须区分两种时机：

**Pre-stream 阶段**（SDK 尚未返回首个消息）：
1. 将当前 Key 标记熔断（`markCooling`）
2. 立即尝试 `KeyPoolManager.acquire()` 获取另一个 Key
3. 有可用 Key → 用新 Key 重新调用 `queryClaudeSDK()`，用户无感知
4. 无可用 Key → 请求重新入队排队等待，推送 `queue-status: queued`
5. 最多重试 3 次，超过返回友好错误

**Mid-stream 阶段**（已有部分流式输出）：
1. 将当前 Key 标记熔断（`markCooling`）
2. **不能透明重试**（已有部分输出发送给前端，重试会导致重复/不一致）
3. 向用户报告错误，建议使用 resume 功能继续对话
4. 错误消息：`{ type: 'error', data: { code: 'RATE_LIMIT_MID_STREAM', message: '请求被限速中断，请点击继续恢复对话', resumable: true, sessionId: '...' } }`

### 用户可见错误

| 场景 | 错误码 | 消息 |
|------|--------|------|
| 重试耗尽 | `RATE_LIMIT_EXHAUSTED` | 当前使用人数较多，所有通道繁忙，请稍后重试 |
| 流式中断 | `RATE_LIMIT_MID_STREAM` | 请求被限速中断，请点击继续恢复对话 |
| 队列满 | `QUEUE_FULL` | 系统繁忙，请稍后重试 |

### Key 健康监控

`KeyPoolManager` 维护每个 Key 的状态（纯内存）：

| 状态 | 含义 | 行为 |
|------|------|------|
| `active` | 正常 | 正常分配 |
| `cooling` | 收到 429，冷却中 | 跳过，冷却结束自动恢复为 active，触发 `key:available` |
| `disabled` | 管理员手动禁用 | 跳过 |
| `error` | 连续 3 次非 429 错误 | 跳过，5 分钟后自动重试 |

### 日志与可观测性

关键事件写入 pino：
- Key 分配：`key=${name} userId=${id} action=acquire`
- Key 释放：`key=${name} action=release duration=${ms}`
- Key 熔断：`key=${name} reason=429 cooldownMs=60000`
- Key 恢复：`key=${name} action=recovered`
- 排队事件：`userId=${id} position=${pos} action=enqueue|dequeue|timeout|rejected`
- 重试事件：`userId=${id} retryCount=${n} phase=pre-stream|mid-stream`

管理 API `GET /api/settings/api-keys` 的 `getStats()` 响应中包含：
- 各 Key 的当前状态、滑动窗口内请求数、rpm_limit
- 队列当前长度、平均等待时间
- 供未来管理面板展示使用

---

## 第五部分：文件结构与改动范围

### 新增文件

| 文件 | 职责 |
|------|------|
| `/server/queue/RequestQueue.js` | 请求队列（入队、出队、超时淘汰、事件驱动调度） |
| `/server/queue/KeyPoolManager.js` | Key 池管理（选择、熔断、冷却、滑动窗口计数） |
| `/server/database/anthropicKeyPoolDb.js` | Key 池数据库操作（静态配置 CRUD） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `server/claude-sdk.js` | `queryClaudeSDK()` 通过 `options._assignedApiKey` 接收 Key，在 `mapCliOptionsToSDK()` 中设置 `cleanEnv.ANTHROPIC_AUTH_TOKEN = options._assignedApiKey`（不改变函数签名）；429 重试逻辑区分 pre-stream / mid-stream |
| `server/index.js` | 初始化 KeyPoolManager 和 RequestQueue；注册 Key 管理子路由 |
| `server/routes/settings.js` | 新增 `/key-pool` 子路由（CRUD） |
| `server/database/db.js` | 新增 `api_key_pool` 建表语句 |
| `server/config/constants.js` | 新增队列和 Key 池相关常量 |
| `server/message/MessageRouter.js` | `#handleProviderCommand()` 中在 `SessionManager.create()` 前插入队列逻辑 |
| `server/websocket/ConnectionRegistry.js` | 确保 `unregister` 时触发 `connection:unregistered` 事件 |
| `src/contexts/WebSocketContext.tsx` | 处理 `queue-status` 消息类型 |
| 前端消息展示组件 | 新增排队状态提示 UI、队列满/超时错误展示 |

### 不改动

- TransportLayer.js（WebSocket 传输层）
- auth.js（认证）
- rateLimiter.js（HTTP 速率限制，与队列独立）
- MCP 配置
- 前端路由和项目管理

### 启动初始化顺序

1. 数据库建表（`api_key_pool`）
2. 从环境变量导入默认 Key（`ANTHROPIC_AUTH_TOKEN`，仅池为空时）
3. 初始化 `KeyPoolManager`（从 DB 加载所有启用的 Key，初始化内存状态）
4. 初始化 `RequestQueue`（注入 KeyPoolManager，监听 `key:available` 事件）
5. `RequestQueue` 监听 `ConnectionRegistry` 的 `connection:unregistered` 事件
6. 启动兜底轮询定时器（每秒）

### 已知限制与后续迭代

1. **API Key 明文存储** — 当前 `api_key` 以明文存储在 SQLite 中。后续可加 AES-256 对称加密，运行时解密。
2. **单进程架构** — 队列和 Key 池状态在内存中，不支持多进程/多节点。如需水平扩展，需引入 Redis。
3. **无优先级** — 所有用户 FIFO 平等排队。如需 VIP 优先级，可扩展 `priority` 字段。
