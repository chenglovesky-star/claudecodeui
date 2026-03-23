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

---

## 架构总览

```
用户请求 (WebSocket)
    ↓
ChatHandler / MessageRouter
    ↓
RequestQueue.enqueue()
    ↓ （调度循环，每秒轮询）
KeyPoolManager.acquire()
    ↓ 有可用 Key         ↓ 无可用 Key
queryClaudeSDK(key)     排队等待，推送 queue-status
    ↓                        ↓
流式响应 → 前端          下一轮调度重试
```

---

## 第一部分：API Key 池管理

### 数据存储

在 SQLite 数据库新增 `api_key_pool` 表：

```sql
CREATE TABLE IF NOT EXISTS api_key_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  rpm_limit INTEGER DEFAULT 50,
  current_rpm INTEGER DEFAULT 0,
  last_reset_at INTEGER,
  total_requests INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### KeyPoolManager 类

文件：`/server/queue/KeyPoolManager.js`

**职责**：管理 Key 池，选择最优 Key，处理熔断与恢复。

**Key 选择策略**：最低负载优先 — 选择 `current_rpm / rpm_limit` 比率最低的 Key。

**Key 状态**：

| 状态 | 含义 | 行为 |
|------|------|------|
| `active` | 正常 | 正常分配 |
| `cooling` | 收到 429，冷却中 | 跳过，冷却结束自动恢复为 active |
| `disabled` | 管理员手动禁用 | 跳过 |
| `error` | 连续 3 次非 429 错误 | 跳过，5 分钟后自动重试 |

**核心方法**：

- `acquire()` — 返回最优 Key，或 `null`（全部满载）
- `release(keyId)` — 请求完成后释放（减少计数）
- `markCooling(keyId)` — 收到 429 时标记冷却 60 秒
- `markError(keyId)` — 非 429 错误计数
- `resetRpm()` — 每分钟重置所有 Key 的 current_rpm
- `getStats()` — 返回所有 Key 的状态摘要（脱敏）

**自动重置**：通过 `setInterval` 每 60 秒重置 `current_rpm` 计数器。

**兼容性**：启动时检查 `ANTHROPIC_AUTH_TOKEN` 环境变量，若 `api_key_pool` 表为空，自动插入为默认 Key。

### 管理 API

文件：`/server/routes/apiKeys.js`

路由前缀：`/api/settings/api-keys`（管理员权限）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/` | 列出所有 Key（api_key 脱敏显示） |
| POST | `/` | 添加 Key |
| DELETE | `/:id` | 删除 Key |
| PATCH | `/:id` | 启用/禁用、修改 rpm_limit |

### 数据库操作层

文件：`/server/database/apiKeyPoolDb.js`

提供 `api_key_pool` 表的 CRUD 封装。

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
  status: 'waiting' | 'dispatched' | 'cancelled'
}
```

**调度规则**：

1. FIFO — 先来先服务
2. 公平性 — 同一用户最多占队列 3 个位置（复用 `QUOTA_MAX_SESSIONS_PER_USER`）
3. 超时淘汰 — 排队超过 120 秒自动移除，通知用户
4. 断连清理 — 用户 WebSocket 断开时自动移除其队列项

**调度循环**（每秒执行）：

1. 遍历队列头部
2. 向 `KeyPoolManager.acquire()` 请求可用 Key
3. 有 Key → 出队执行，推送 `queue-status: dispatched`
4. 无 Key → 跳过，等待下一轮

**核心方法**：

- `enqueue(request)` — 入队，返回队列位置；若 Key 立即可用则直接分配不入队
- `cancel(requestId)` — 取消排队
- `cancelByConnection(connectionId)` — 按连接 ID 批量取消
- `getPosition(requestId)` — 获取当前位置
- `getStats()` — 队列长度、平均等待时间

### 集成点

修改消息处理流程，在 WebSocket 收到 `claude-command` 时：

```
原流程：消息 → queryClaudeSDK()
新流程：消息 → RequestQueue.enqueue() → [排队或直接分配] → queryClaudeSDK(assignedKey)
```

### 新增常量

文件：`/server/config/constants.js`

```javascript
export const QUEUE_MAX_SIZE = 50;
export const QUEUE_TIMEOUT_MS = 120000;
export const QUEUE_POLL_INTERVAL_MS = 1000;
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
```

### 预估等待时间算法

```
estimatedWaitSec = position * (avgFirstTokenTime / activeKeyCount)
```

- `avgFirstTokenTime`：最近 20 次请求首 token 响应时间的滑动平均
- `activeKeyCount`：当前 active 状态的 Key 数
- 兜底值：无历史数据时默认 10 秒/位

### 前端 UI

修改 `WebSocketContext.tsx`，新增 `queue-status` 消息处理。

消息展示组件中：
- 无排队：显示"思考中..."（不变）
- 有排队：显示"当前排队第 X 位，预计等待约 X 秒"
- 出队：切回"思考中..."

---

## 第四部分：错误处理与容错

### 429 重试机制

在 `queryClaudeSDK()` 调用层捕获 429 错误：

1. 将当前 Key 标记熔断（`markCooling`）
2. 请求重新入队（保留原始优先级）
3. 尝试分配另一个 Key
4. 所有 Key 熔断 → 排队等待
5. 最多重试 3 次，超过返回友好错误

### 用户可见错误

替换原始 429 JSON，改为：

```javascript
{ type: 'error', data: { code: 'RATE_LIMIT_EXHAUSTED', message: '当前使用人数较多，所有通道繁忙，请稍后重试' } }
```

### 日志

关键事件写入 pino：
- Key 分配/释放
- Key 熔断/恢复
- 排队/出队/超时
- 重试事件

---

## 第五部分：文件结构与改动范围

### 新增文件

| 文件 | 职责 |
|------|------|
| `/server/queue/RequestQueue.js` | 请求队列 |
| `/server/queue/KeyPoolManager.js` | Key 池管理 |
| `/server/routes/apiKeys.js` | Key 管理 API |
| `/server/database/apiKeyPoolDb.js` | Key 池数据库操作 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `server/claude-sdk.js` | 接收外部 Key 参数；429 重试 |
| `server/index.js` | 注册路由；初始化队列和 Key 池 |
| `server/database/db.js` | 新增 api_key_pool 建表 |
| `server/config/constants.js` | 新增队列/Key 池常量 |
| WebSocket 消息处理（ChatHandler 或 MessageRouter） | 请求走队列 |
| `src/contexts/WebSocketContext.tsx` | 处理 queue-status |
| 前端消息展示组件 | 排队状态 UI |

### 不改动

- TransportLayer.js（WebSocket 传输层）
- auth.js（认证）
- rateLimiter.js（HTTP 速率限制，与队列独立）
- MCP 配置
- 前端路由和项目管理

### 启动初始化顺序

1. 数据库建表（api_key_pool）
2. 环境变量默认 Key 导入（池为空时）
3. 初始化 KeyPoolManager
4. 初始化 RequestQueue（注入 KeyPoolManager）
5. 启动调度循环
