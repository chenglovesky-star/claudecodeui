# WebSocket 消息管道重构 — Plan 1：基础设施 + 传输层

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立消息管道的基础设施（常量配置、接口定义）和传输层（连接注册、心跳、背压），替换现有混乱的心跳机制。

**Architecture:** 新建 `server/config/constants.js` 集中管理所有阈值常量，定义 `ITransport`/`ISession`/`IProvider` 接口。实现 `ConnectionRegistry` 管理连接生命周期，`TransportLayer` 统一心跳和背压。重写客户端 `WebSocketContext.tsx` 心跳逻辑，从 JSON ping/pong 切换为 heartbeat/heartbeat-ack。

**Tech Stack:** Node.js, ws, React 18, TypeScript, EventEmitter

**Spec:** `docs/superpowers/specs/2026-03-19-websocket-message-pipeline-design.md`

**架构原则:** 参见 spec 中 P1-P6 原则。每个 Task 完成后需通过架构合规检查清单。

---

## 文件结构

| 操作 | 文件路径 | 职责 | 行数限制 |
|------|---------|------|---------|
| 新增 | `server/config/constants.js` | 所有阈值常量集中定义 | ≤100 |
| 新增 | `server/interfaces/ITransport.js` | 传输层接口定义 | ≤30 |
| 新增 | `server/interfaces/IProvider.js` | Provider 适配器接口定义 | ≤30 |
| 新增 | `server/interfaces/ISession.js` | 会话层接口定义 | ≤30 |
| 新增 | `server/websocket/ConnectionRegistry.js` | 连接注册表、僵尸清理 | ≤200 |
| 新增 | `server/websocket/TransportLayer.js` | 心跳、背压、消息发送 | ≤300 |
| 修改 | `server/index.js` | 集成 TransportLayer，移除旧心跳代码 | — |
| 重写 | `src/contexts/WebSocketContext.tsx` | 心跳改为 heartbeat/heartbeat-ack | — |

---

### Task 1: 创建常量配置 `server/config/constants.js`

**Files:**
- Create: `server/config/constants.js`

将所有散落的魔法数字集中到一个文件，满足 P5（无魔法数字）原则。

- [ ] **Step 1: 创建 constants.js**

```javascript
// server/config/constants.js
// 集中定义所有阈值常量，消除魔法数字 (P5)

// ========== 传输层 ==========
export const HEARTBEAT_INTERVAL_MS = 20000;        // 心跳间隔 20 秒
export const HEARTBEAT_PONG_TIMEOUT_MS = 8000;     // pong 超时 8 秒
export const HEARTBEAT_MAX_MISSED = 2;             // 连续 2 次未响应才断开
export const BACKPRESSURE_WARN_BYTES = 64 * 1024;  // 64KB 拥塞警告
export const BACKPRESSURE_BLOCK_BYTES = 256 * 1024; // 256KB 阻塞阈值
export const ZOMBIE_SCAN_INTERVAL_MS = 60000;      // 僵尸连接扫描间隔 60 秒

// ========== 客户端重连 ==========
export const RECONNECT_BASE_MS = 1000;             // 初始重连延迟
export const RECONNECT_MAX_MS = 30000;             // 最大重连延迟

// ========== 客户端消息队列 ==========
export const MESSAGE_QUEUE_MAX = 50;               // 消息队列上限

// ========== 会话层（Plan 2 使用）==========
export const SESSION_FIRST_RESPONSE_TIMEOUT_MS = 60000;   // 首响应超时 60 秒
export const SESSION_ACTIVITY_TIMEOUT_MS = 120000;        // 流式活动超时 120 秒
export const SESSION_TOOL_TIMEOUT_MS = 600000;            // 工具执行超时 10 分钟
export const SESSION_GLOBAL_TIMEOUT_MS = 1800000;         // 全局超时 30 分钟
export const SESSION_MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 单会话最大输出 10MB
export const PROCESS_SIGTERM_TIMEOUT_MS = 5000;           // SIGTERM 等待 5 秒
export const PROCESS_SIGKILL_TIMEOUT_MS = 2000;           // SIGKILL 等待 2 秒

// ========== 资源配额（Plan 2 使用）==========
export const QUOTA_MAX_SESSIONS_PER_USER = 3;      // 每用户并发会话上限
export const QUOTA_MAX_SESSIONS_GLOBAL = 30;        // 全局并发会话上限

// ========== 消息缓冲（Plan 2 使用）==========
export const BUFFER_CRITICAL_EVENTS_MAX = 500;      // 关键事件缓冲上限
export const BUFFER_SEQ_ID_START = 1;               // seqId 起始值

// ========== 前端防卡死（Plan 3 使用）==========
export const CLIENT_FALLBACK_TIMEOUT_MS = 90000;    // 前端兜底超时 90 秒
export const CLIENT_TOOL_FALLBACK_TIMEOUT_MS = 630000; // 工具执行兜底 10.5 分钟

// ========== Shell ==========
export const PTY_SESSION_TIMEOUT_MS = 1800000;      // PTY 会话超时 30 分钟
export const SHELL_URL_PARSE_BUFFER_LIMIT = 32768;  // URL 检测缓冲区限制
```

- [ ] **Step 2: 验证文件可导入**

```bash
cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui
node -e "import('./server/config/constants.js').then(c => console.log('OK, keys:', Object.keys(c).length))"
```
Expected: `OK, keys: 24`

- [ ] **Step 3: Commit**

```bash
git add server/config/constants.js
git commit -m "feat: add centralized constants config for WebSocket pipeline (P5)"
```

---

### Task 2: 创建接口定义 `server/interfaces/`

**Files:**
- Create: `server/interfaces/ITransport.js`
- Create: `server/interfaces/IProvider.js`
- Create: `server/interfaces/ISession.js`

定义模块间通信的接口约定，满足 P2（依赖倒置）原则。使用 JSDoc 注释描述接口契约（项目不用 TypeScript 编译服务端代码）。

- [ ] **Step 1: 创建 ITransport.js**

```javascript
// server/interfaces/ITransport.js
// 传输层接口定义 (P2: 依赖倒置)

/**
 * @typedef {'normal' | 'congested' | 'blocked'} BackpressureState
 *
 * @typedef {Object} SendResult
 * @property {boolean} success
 * @property {BackpressureState} backpressure
 *
 * @typedef {Object} ITransport
 * @property {(connectionId: string, message: object) => SendResult} send
 * @property {(connectionId: string, callback: (msg: object) => void) => void} onMessage
 * @property {(connectionId: string) => boolean} isAlive
 * @property {(connectionId: string) => BackpressureState} getBackpressureState
 */

export default {};
```

- [ ] **Step 2: 创建 IProvider.js**

```javascript
// server/interfaces/IProvider.js
// Provider 适配器接口定义 (P2: 依赖倒置)

/**
 * @typedef {Object} IProvider
 * @property {(config: object) => void} start
 * @property {() => void} abort
 * @property {(callback: (data: object) => void) => void} onOutput
 * @property {(callback: (result: object) => void) => void} onComplete
 * @property {(callback: (error: Error) => void) => void} onError
 * @property {() => void} dispose
 */

export default {};
```

- [ ] **Step 3: 创建 ISession.js**

```javascript
// server/interfaces/ISession.js
// 会话层接口定义 (P2: 依赖倒置)

/**
 * @typedef {'idle'|'running'|'streaming'|'tool_executing'|'completed'|'timeout'|'error'|'aborted'} SessionState
 *
 * @typedef {Object} ResumeData
 * @property {Array} missedCriticalEvents
 * @property {object} [snapshot]
 * @property {SessionState} currentState
 * @property {number} lastSeqId
 *
 * @typedef {Object} ISession
 * @property {(userId: number, connectionId: string, config: object) => string} create
 * @property {(sessionId: string) => void} abort
 * @property {(sessionId: string) => SessionState} getState
 * @property {(sessionId: string, lastSeqId: number) => ResumeData} resume
 */

export default {};
```

- [ ] **Step 4: Commit**

```bash
git add server/interfaces/
git commit -m "feat: add interface definitions for ITransport, IProvider, ISession (P2)"
```

---

### Task 3: 创建 ConnectionRegistry

**Files:**
- Create: `server/websocket/ConnectionRegistry.js`

管理所有 WebSocket 连接的注册、查找、清理。通过 EventEmitter 发布事件（P3）。

- [ ] **Step 1: 创建 ConnectionRegistry.js**

实现以下功能：
- `register(ws, type, userId, username)` → 返回 connectionId（UUID）
- `unregister(connectionId)` → 清理连接
- `get(connectionId)` → 返回连接信息
- `getByUserId(userId)` → 返回该用户所有连接
- `getAllByType(type)` → 返回指定类型的所有连接（'chat' | 'shell'）
- `markAlive(connectionId)` → 标记连接活跃
- `markDead(connectionId)` → 标记连接死亡
- `scanZombies()` → 扫描并清理僵尸连接
- 自动定时扫描（`ZOMBIE_SCAN_INTERVAL_MS`）
- 继承 EventEmitter，emit `connection:registered`、`connection:unregistered`、`connection:dead` 事件
- 带 `[Registry]` 日志前缀（P5）
- `dispose()` 清理所有定时器

连接信息结构：
```javascript
{
  connectionId: string,
  ws: WebSocket,
  type: 'chat' | 'shell',
  userId: number,
  username: string,
  registeredAt: number,
  lastAliveAt: number,
  missedHeartbeats: 0,
  seqId: 0,          // 当前连接的消息序号
}
```

- [ ] **Step 2: 验证编译和导入**

```bash
node -e "import('./server/websocket/ConnectionRegistry.js').then(m => console.log('OK'))"
```

- [ ] **Step 3: Commit**

```bash
git add server/websocket/ConnectionRegistry.js
git commit -m "feat: add ConnectionRegistry with lifecycle tracking and zombie cleanup (P1,P3)"
```

---

### Task 4: 创建 TransportLayer

**Files:**
- Create: `server/websocket/TransportLayer.js`

统一心跳和背压处理。通过接口交互（P2），事件通知（P3）。

- [ ] **Step 1: 创建 TransportLayer.js**

实现以下功能：

**心跳管理**：
- 每 `HEARTBEAT_INTERVAL_MS`（20s）对所有连接发送协议级 `ws.ping()`
- 收到 `pong` 时调用 `registry.markAlive(connectionId)`
- 未收到 `pong` 时累加 `missedHeartbeats`
- `missedHeartbeats >= HEARTBEAT_MAX_MISSED`（2 次）时 terminate 连接
- 处理客户端发来的应用级 `{ type: 'heartbeat', ts }` 消息，回复 `{ type: 'heartbeat-ack', ts }`

**背压处理**：
- `send(connectionId, message)` 方法：
  - 检查 `ws.bufferedAmount`
  - `< BACKPRESSURE_WARN_BYTES` → 正常发送
  - `< BACKPRESSURE_BLOCK_BYTES` → 发送但 emit `transport:congested`
  - `>= BACKPRESSURE_BLOCK_BYTES` → 排入内部发送队列，监听 `drain` 事件
- 返回 `{ success, backpressure }` 对象

**seqId 管理**：
- 每次通过 `send()` 发送消息时自动附加 `seqId`（从连接的 registry 记录中递增）
- `heartbeat-ack` 等所有消息都带 `seqId`

**集成 ConnectionRegistry**：
- 构造函数接收 `registry` 实例
- 监听 `connection:registered` 和 `connection:unregistered` 事件来设置/清理 pong handler

**生命周期**：
- `start()` → 启动心跳定时器
- `stop()` → 停止心跳、清理所有 drain 监听器
- 继承 EventEmitter，emit `transport:congested`、`transport:blocked` 事件
- 带 `[Transport]` 日志前缀

- [ ] **Step 2: 验证编译和导入**

```bash
node -e "import('./server/websocket/TransportLayer.js').then(m => console.log('OK'))"
```

- [ ] **Step 3: Commit**

```bash
git add server/websocket/TransportLayer.js
git commit -m "feat: add TransportLayer with unified heartbeat and backpressure (P1,P2,P3,P4)"
```

---

### Task 5: 集成 TransportLayer 到 server/index.js

**Files:**
- Modify: `server/index.js`

将新的 TransportLayer 和 ConnectionRegistry 接入现有 WebSocket 服务，替换旧心跳代码。

- [ ] **Step 1: 导入新模块，替换旧心跳**

在 `server/index.js` 中：

1. 导入 `ConnectionRegistry` 和 `TransportLayer`
2. 在 WebSocket server 创建后实例化两者：
   ```javascript
   const registry = new ConnectionRegistry();
   const transport = new TransportLayer(registry);
   transport.start();
   ```
3. **删除旧心跳代码**（第1413-1430行）：
   - 删除 `WS_PING_INTERVAL_MS`、`WS_PONG_TIMEOUT_MS` 常量
   - 删除 `wsHeartbeatInterval` 的 `setInterval` 设置
   - 删除 `wss.on('close', () => clearInterval(wsHeartbeatInterval))`
4. **修改连接路由**（第1433-1453行）：
   - 删除 `ws._isAlive = true` 和 `ws.on('pong', ...)` 代码
   - 连接时调用 `registry.register(ws, type, userId, username)`
5. **修改 handleChatConnection**（第1486行起）：
   - 删除 `connectedClients.add(ws)` 和 `connectedClients.delete(ws)`（由 registry 替代）
   - 将消息中的 `{ type: 'ping' }` 处理（第1505-1511行）替换为由 TransportLayer 处理
   - ws.send 调用改为通过 `transport.send(connectionId, message)`
6. **修改 handleShellConnection**（第1738行起）：
   - 同样注册到 registry
7. **修改 wss.on('close')**：
   - 调用 `transport.stop()` 和 `registry.dispose()`
8. **修改广播逻辑**（`connectedClients` 相关）：
   - 替换为 `registry.getAllByType('chat')` 遍历

- [ ] **Step 2: 删除旧的 connectedClients Set**

删除第94行的 `const connectedClients = new Set()` 及所有引用。

- [ ] **Step 3: 更新 taskmaster-websocket.js 中的广播**

`server/utils/taskmaster-websocket.js` 中的 `wss.clients.forEach(...)` 改为使用 registry（或保持 wss.clients 但确保兼容）。

- [ ] **Step 4: 验证服务启动**

```bash
npm run build && timeout 10 npm run server 2>&1 || true
```
Expected: 服务正常启动，无报错

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/utils/taskmaster-websocket.js
git commit -m "feat: integrate TransportLayer into server, remove legacy heartbeat"
```

---

### Task 6: 重写客户端 WebSocketContext.tsx 心跳逻辑

**Files:**
- Modify: `src/contexts/WebSocketContext.tsx`

从 JSON ping/pong 切换为 heartbeat/heartbeat-ack 协议。

- [ ] **Step 1: 替换常量**

```typescript
// 旧 (删除)
const HEARTBEAT_INTERVAL_MS = 25000;
const PONG_TIMEOUT_MS = 10000;

// 新 (替换为)
const HEARTBEAT_INTERVAL_MS = 20000;  // 与服务端对齐
const HEARTBEAT_ACK_TIMEOUT_MS = 8000; // ack 超时
const HEARTBEAT_MAX_MISSED = 2;       // 连续 2 次才断开
```

- [ ] **Step 2: 重写 startHeartbeat 函数**

```typescript
const startHeartbeat = useCallback((ws: WebSocket) => {
  stopHeartbeat();
  let missedCount = 0;

  heartbeatTimerRef.current = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));

      clearPongTimeout();
      pongTimeoutRef.current = setTimeout(() => {
        missedCount++;
        console.warn(`[WS] Heartbeat ack timeout (${missedCount}/${HEARTBEAT_MAX_MISSED})`);
        if (missedCount >= HEARTBEAT_MAX_MISSED) {
          console.warn('[WS] Connection appears dead, forcing reconnect');
          ws.close();
        }
      }, HEARTBEAT_ACK_TIMEOUT_MS);
    }
  }, HEARTBEAT_INTERVAL_MS);
}, [stopHeartbeat, clearPongTimeout]);
```

- [ ] **Step 3: 修改 onmessage 中的 pong 处理**

```typescript
// 旧 (删除)
if (data.type === 'pong') {
  clearPongTimeout();
  return;
}

// 新 (替换为)
if (data.type === 'heartbeat-ack') {
  clearPongTimeout();
  missedCountRef.current = 0; // 重置计数
  return;
}
```

需要新增 `missedCountRef`：
```typescript
const missedCountRef = useRef(0);
```

并在 `startHeartbeat` 中使用 ref 而非闭包变量。

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```
Expected: 无 WebSocketContext 相关错误

- [ ] **Step 5: Commit**

```bash
git add src/contexts/WebSocketContext.tsx
git commit -m "feat: switch client heartbeat from ping/pong to heartbeat/heartbeat-ack"
```

---

### Task 7: 删除服务端旧 ping/pong 应用级处理

**Files:**
- Modify: `server/index.js`

确保服务端不再处理旧的 `{ type: 'ping' }` 消息，也不再回复 `{ type: 'pong' }`。

- [ ] **Step 1: 删除 handleChatConnection 中的 ping/pong 处理**

在 `handleChatConnection` 的消息处理中（约第1505-1511行），删除：
```javascript
if (data.type === 'ping') {
  ws.send(JSON.stringify({ type: 'pong' }));
  return;
}
```

这个逻辑已由 TransportLayer 的 `heartbeat`/`heartbeat-ack` 替代。

- [ ] **Step 2: 搜索并清理所有旧 ping/pong 引用**

```bash
grep -rn "type.*ping\|type.*pong" server/ src/ --include="*.js" --include="*.ts" --include="*.tsx"
```
Expected: 只剩 heartbeat/heartbeat-ack 相关代码，无旧的 ping/pong

- [ ] **Step 3: 完整构建验证**

```bash
npm run build
```
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "fix: remove legacy ping/pong handling, replaced by heartbeat protocol"
```

---

### Task 8: 端到端验证

**Files:** 无新增

- [ ] **Step 1: 完整构建**

```bash
npm run build
```

- [ ] **Step 2: Lint 检查**

```bash
npm run lint 2>&1 | grep -E "error|warning" | head -20
```
Expected: 无新增错误

- [ ] **Step 3: 启动服务验证**

```bash
lsof -ti:3001 | xargs kill -9 2>/dev/null; npm run dev &
sleep 5
# 验证服务正常启动
curl -s http://localhost:5173 | head -5
```
Expected: 返回 HTML 内容

- [ ] **Step 4: 验证 WebSocket 连接**

在浏览器打开 http://localhost:5173，检查：
- 控制台无 WebSocket 错误
- 能正常发送消息
- 心跳日志显示 `heartbeat` / `heartbeat-ack`（而非旧的 `ping` / `pong`）

- [ ] **Step 5: 架构合规检查**

逐项验证：
- [ ] constants.js 中无魔法数字残留（grep 所有新文件中的裸数字）
- [ ] ConnectionRegistry 和 TransportLayer 各 ≤300 行
- [ ] 日志带 `[Registry]` / `[Transport]` 前缀
- [ ] 模块间通过 EventEmitter 通信，无直接方法调用跨模块
- [ ] 无死代码（旧 ping/pong、connectedClients 已清理）

- [ ] **Step 6: Commit 最终状态（如有修复）**

```bash
git add -A
git commit -m "feat: complete Plan 1 - transport layer infrastructure"
```
