# API Key 池 + 请求队列 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现多 API Key 轮询 + 请求队列 + 前端排队感知，解决多用户并发时的 429 限速问题。

**Architecture:** 在 MessageRouter 和 SessionManager 之间插入请求队列层。KeyPoolManager 管理多个 Anthropic API Key（滑动窗口限速 + 熔断），RequestQueue 提供 FIFO 排队 + 事件驱动调度。前端通过 WebSocket 接收排队状态推送。

**Tech Stack:** Node.js, Express, SQLite (better-sqlite3), WebSocket (ws), EventEmitter

**Spec:** `docs/superpowers/specs/2026-03-23-rate-limit-queue-design.md`

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/queue/KeyPoolManager.js` | Key 池管理：滑动窗口限速、最低负载选择、熔断/恢复、事件驱动 |
| `server/queue/RequestQueue.js` | 请求队列：FIFO 排队、事件驱动调度、超时淘汰、断连清理 |
| `server/database/anthropicKeyPoolDb.js` | `api_key_pool` 表 CRUD |
| `server/queue/__tests__/KeyPoolManager.test.js` | KeyPoolManager 单元测试 |
| `server/queue/__tests__/RequestQueue.test.js` | RequestQueue 单元测试 |
| `server/queue/__tests__/integration.test.js` | 队列 + Key 池集成测试 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `server/config/constants.js` | 新增队列和 Key 池常量 |
| `server/database/db.js` | 新增 `api_key_pool` 建表（不再导出 anthropicKeyPoolDb，使用方直接 import） |
| `server/claude-sdk.js:150-244` | `mapCliOptionsToSDK()` 支持 `_assignedApiKey` 覆盖环境变量 |
| `server/claude-sdk.js:489-720` | `queryClaudeSDK()` 捕获 429 错误，区分 pre-stream/mid-stream |
| `server/message/MessageRouter.js:11-25` | 构造函数注入 `requestQueue` |
| `server/message/MessageRouter.js:86-106` | `#handleProviderCommand()` 在 `sessionManager.create()` 前插入队列 |
| `server/routes/settings.js` | 新增 `/key-pool` 子路由 |
| `server/index.js:564-607` | 在 `startServer()` 异步函数内初始化 KeyPoolManager、RequestQueue，通过 setter 注入 MessageRouter |
| `server/index.js:308-379` | `router:startSession` 监听器传入 assignedKey；新增 `process:complete/error` 的 key release 监听（与现有监听器并存，仅负责 release） |
| `server/providers/claude-sdk.js` | ClaudeSDKProvider 中捕获 429 错误，pre-stream 重试 / mid-stream 报错 |
| `src/contexts/WebSocketContext.tsx` | 处理 `queue-status` 消息 |
| `src/components/chat/view/subcomponents/AssistantThinkingIndicator.tsx` | 排队状态 UI |

---

### Task 1: 新增常量

**Files:**
- Modify: `server/config/constants.js:28-30`

- [ ] **Step 1: 在 constants.js 末尾添加队列和 Key 池常量**

在 `// ========== Shell ==========` 之前添加：

```javascript
// ========== 请求队列 ==========
export const QUEUE_MAX_SIZE = 50;                  // 队列最大长度
export const QUEUE_TIMEOUT_MS = 120000;            // 排队超时 120 秒
export const QUEUE_POLL_INTERVAL_MS = 1000;        // 兜底轮询间隔 1 秒
export const QUOTA_MAX_QUEUE_PER_USER = 3;         // 每用户最大排队数

// ========== API Key 池 ==========
export const KEY_COOLDOWN_MS = 60000;              // Key 熔断冷却 60 秒
export const KEY_ERROR_COOLDOWN_MS = 300000;       // Key 错误冷却 5 分钟
export const KEY_MAX_CONSECUTIVE_ERRORS = 3;       // 连续错误阈值
export const KEY_RPM_WINDOW_MS = 60000;            // RPM 滑动窗口 60 秒
export const KEY_DEFAULT_RPM_LIMIT = 50;           // 默认 RPM 上限
export const MAX_429_RETRIES = 3;                  // 429 最大重试次数
```

- [ ] **Step 2: 验证无语法错误**

Run: `node -e "import('./server/config/constants.js').then(m => console.log(Object.keys(m).length, 'constants loaded'))"`
Expected: 输出常量数量，无报错

- [ ] **Step 3: Commit**

```bash
git add server/config/constants.js
git commit -m "feat: add queue and key pool constants"
```

---

### Task 2: 数据库层 — api_key_pool 表

**Files:**
- Modify: `server/database/db.js`
- Create: `server/database/anthropicKeyPoolDb.js`

- [ ] **Step 1: 在 db.js 的 `runMigrations()` 中添加建表语句**

在 `server/database/db.js` 的 `runMigrations()` 方法末尾添加：

```javascript
// Migration: api_key_pool table for multi-key rotation
db.exec(`
  CREATE TABLE IF NOT EXISTS api_key_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    rpm_limit INTEGER DEFAULT 50,
    total_requests INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
```

注意：`CREATE TABLE IF NOT EXISTS` 在表已存在时不会报错，无需 try-catch 包裹（与现有 `session_names` 表建表风格一致）。

- [ ] **Step 2: 创建 `server/database/anthropicKeyPoolDb.js`**

```javascript
import { db } from './db.js';

const anthropicKeyPoolDb = {
  getAll() {
    return db.prepare('SELECT id, name, api_key, enabled, rpm_limit, total_requests, created_at FROM api_key_pool ORDER BY id').all();
  },

  getEnabled() {
    return db.prepare('SELECT id, name, api_key, enabled, rpm_limit, total_requests, created_at FROM api_key_pool WHERE enabled = 1 ORDER BY id').all();
  },

  add(name, apiKey, rpmLimit = 50) {
    const stmt = db.prepare('INSERT INTO api_key_pool (name, api_key, rpm_limit) VALUES (?, ?, ?)');
    const result = stmt.run(name, apiKey, rpmLimit);
    return { id: result.lastInsertRowid, name, enabled: 1, rpm_limit: rpmLimit };
  },

  remove(id) {
    return db.prepare('DELETE FROM api_key_pool WHERE id = ?').run(id);
  },

  update(id, fields) {
    const allowed = ['name', 'enabled', 'rpm_limit'];
    const updates = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (updates.length === 0) return null;
    values.push(id);
    return db.prepare(`UPDATE api_key_pool SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  },

  incrementTotalRequests(id) {
    return db.prepare('UPDATE api_key_pool SET total_requests = total_requests + 1 WHERE id = ?').run(id);
  },

  count() {
    return db.prepare('SELECT COUNT(*) as count FROM api_key_pool').get().count;
  },

  getMasked() {
    const rows = this.getAll();
    return rows.map(row => ({
      ...row,
      api_key: row.api_key.slice(0, 8) + '...' + row.api_key.slice(-4)
    }));
  }
};

export { anthropicKeyPoolDb };
```

- [ ] **Step 3: 不修改 db.js 的导出**

`anthropicKeyPoolDb` 不需要在 db.js 中导出。使用方直接 import：
```javascript
import { anthropicKeyPoolDb } from './database/anthropicKeyPoolDb.js';
```

- [ ] **Step 4: 验证建表和 CRUD**

Run: `node -e "import('./server/database/db.js').then(({initializeDatabase}) => { initializeDatabase(); console.log('DB init OK'); })"`
Expected: 无报错

- [ ] **Step 5: Commit**

```bash
git add server/database/db.js server/database/anthropicKeyPoolDb.js
git commit -m "feat: add api_key_pool table and CRUD operations"
```

---

### Task 3: KeyPoolManager

**Files:**
- Create: `server/queue/KeyPoolManager.js`
- Create: `server/queue/__tests__/KeyPoolManager.test.js`

- [ ] **Step 1: 编写 KeyPoolManager 测试**

创建 `server/queue/__tests__/KeyPoolManager.test.js`：

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyPoolManager } from '../KeyPoolManager.js';

describe('KeyPoolManager', () => {
  let manager;

  beforeEach(() => {
    manager = new KeyPoolManager();
  });

  describe('loadKeys', () => {
    it('should load keys from DB rows', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
        { id: 2, name: 'key-2', api_key: 'sk-ant-2', rpm_limit: 30, enabled: 1 },
      ]);
      expect(manager.getStats().totalKeys).toBe(2);
    });
  });

  describe('acquire', () => {
    it('should return the least loaded key', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
        { id: 2, name: 'key-2', api_key: 'sk-ant-2', rpm_limit: 50, enabled: 1 },
      ]);
      // Acquire from key-1 twice
      const k1 = manager.acquire();
      const k2 = manager.acquire();
      // Both should succeed
      expect(k1).not.toBeNull();
      expect(k2).not.toBeNull();
    });

    it('should return null when all keys are at capacity', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 1, enabled: 1 },
      ]);
      manager.acquire(); // use the 1 rpm
      const result = manager.acquire();
      expect(result).toBeNull();
    });

    it('should skip cooling keys', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
      ]);
      manager.markCooling(1);
      const result = manager.acquire();
      expect(result).toBeNull();
    });
  });

  describe('markCooling', () => {
    it('should emit key:available after cooldown', async () => {
      vi.useFakeTimers();
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
      ]);
      manager.markCooling(1, 100); // 100ms cooldown
      expect(manager.acquire()).toBeNull();

      const availablePromise = new Promise(resolve => {
        manager.on('key:available', resolve);
      });
      vi.advanceTimersByTime(150);
      await availablePromise;

      expect(manager.acquire()).not.toBeNull();
      vi.useRealTimers();
    });
  });

  describe('sliding window', () => {
    it('should allow requests after window expires', () => {
      vi.useFakeTimers();
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 1, enabled: 1 },
      ]);
      manager.acquire(); // use the 1 rpm
      expect(manager.acquire()).toBeNull();

      vi.advanceTimersByTime(61000); // past 60s window
      expect(manager.acquire()).not.toBeNull();
      vi.useRealTimers();
    });
  });

  describe('release', () => {
    it('should emit key:released event', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
      ]);
      const spy = vi.fn();
      manager.on('key:released', spy);
      manager.release(1);
      expect(spy).toHaveBeenCalledWith({ keyId: 1 });
    });
  });

  describe('getStats', () => {
    it('should return masked stats', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-api03-abcdef1234567890', rpm_limit: 50, enabled: 1 },
      ]);
      const stats = manager.getStats();
      expect(stats.keys[0].apiKey).toContain('...');
      expect(stats.keys[0].status).toBe('active');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run server/queue/__tests__/KeyPoolManager.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 KeyPoolManager**

创建 `server/queue/KeyPoolManager.js`：

```javascript
import { EventEmitter } from 'events';
import {
  KEY_COOLDOWN_MS,
  KEY_ERROR_COOLDOWN_MS,
  KEY_MAX_CONSECUTIVE_ERRORS,
  KEY_RPM_WINDOW_MS,
} from '../config/constants.js';

export class KeyPoolManager extends EventEmitter {
  /** @type {Map<number, KeyState>} */
  #keys = new Map();
  #cooldownTimers = new Map();

  /**
   * Load keys from DB rows into memory state.
   * @param {Array<{id: number, name: string, api_key: string, rpm_limit: number, enabled: number}>} rows
   */
  loadKeys(rows) {
    this.#keys.clear();
    for (const row of rows) {
      if (!row.enabled) continue;
      this.#keys.set(row.id, {
        id: row.id,
        name: row.name,
        apiKey: row.api_key,
        rpmLimit: row.rpm_limit,
        status: 'active',
        requestTimestamps: [],
        consecutiveErrors: 0,
        coolingUntil: null,
      });
    }
  }

  /**
   * Add a single key to the pool (for runtime additions).
   */
  addKey(row) {
    this.#keys.set(row.id, {
      id: row.id,
      name: row.name,
      apiKey: row.api_key,
      rpmLimit: row.rpm_limit,
      status: row.enabled ? 'active' : 'disabled',
      requestTimestamps: [],
      consecutiveErrors: 0,
      coolingUntil: null,
    });
  }

  /**
   * Remove a key from the pool.
   */
  removeKey(id) {
    this.#keys.delete(id);
    const timer = this.#cooldownTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.#cooldownTimers.delete(id);
    }
  }

  /**
   * Acquire the least-loaded available key.
   * @returns {{ id: number, name: string, apiKey: string } | null}
   */
  acquire() {
    const now = Date.now();
    let bestKey = null;
    let bestLoad = Infinity;

    for (const [, key] of this.#keys) {
      if (key.status !== 'active') continue;

      // Clean expired timestamps (sliding window)
      key.requestTimestamps = key.requestTimestamps.filter(
        ts => now - ts < KEY_RPM_WINDOW_MS
      );

      const currentRpm = key.requestTimestamps.length;
      if (currentRpm >= key.rpmLimit) continue;

      const load = currentRpm / key.rpmLimit;
      if (load < bestLoad) {
        bestLoad = load;
        bestKey = key;
      }
    }

    if (!bestKey) return null;

    // Record this request
    bestKey.requestTimestamps.push(now);
    // Note: do NOT reset consecutiveErrors here. acquire() only means a key was
    // assigned, not that the request succeeded. Reset happens in release().

    return { id: bestKey.id, name: bestKey.name, apiKey: bestKey.apiKey };
  }

  /**
   * Called when a request using this key completes successfully.
   */
  release(keyId) {
    const key = this.#keys.get(keyId);
    if (key) key.consecutiveErrors = 0; // Reset on successful completion
    this.emit('key:released', { keyId });
  }

  /**
   * Mark a key as cooling (got 429).
   * @param {number} keyId
   * @param {number} [cooldownMs]
   */
  markCooling(keyId, cooldownMs = KEY_COOLDOWN_MS) {
    const key = this.#keys.get(keyId);
    if (!key) return;

    key.status = 'cooling';
    key.coolingUntil = Date.now() + cooldownMs;

    // Clear any existing timer
    const existing = this.#cooldownTimers.get(keyId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      key.status = 'active';
      key.coolingUntil = null;
      this.#cooldownTimers.delete(keyId);
      this.emit('key:available', { keyId });
    }, cooldownMs);

    this.#cooldownTimers.set(keyId, timer);
  }

  /**
   * Mark a non-429 error. After KEY_MAX_CONSECUTIVE_ERRORS, enters error cooldown.
   */
  markError(keyId) {
    const key = this.#keys.get(keyId);
    if (!key) return;

    key.consecutiveErrors++;
    if (key.consecutiveErrors >= KEY_MAX_CONSECUTIVE_ERRORS) {
      key.status = 'error';

      const existing = this.#cooldownTimers.get(keyId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        key.status = 'active';
        key.consecutiveErrors = 0;
        this.#cooldownTimers.delete(keyId);
        this.emit('key:available', { keyId });
      }, KEY_ERROR_COOLDOWN_MS);

      this.#cooldownTimers.set(keyId, timer);
    }
  }

  /**
   * Disable a key (admin action).
   */
  disableKey(keyId) {
    const key = this.#keys.get(keyId);
    if (key) key.status = 'disabled';
  }

  /**
   * Enable a key (admin action).
   */
  enableKey(keyId) {
    const key = this.#keys.get(keyId);
    if (key) {
      key.status = 'active';
      key.consecutiveErrors = 0;
      this.emit('key:available', { keyId });
    }
  }

  /**
   * Update RPM limit for a key at runtime.
   */
  updateKeyRpmLimit(keyId, rpmLimit) {
    const key = this.#keys.get(keyId);
    if (key) key.rpmLimit = rpmLimit;
  }

  /**
   * Check if any key is available for acquisition.
   */
  hasAvailable() {
    const now = Date.now();
    for (const [, key] of this.#keys) {
      if (key.status !== 'active') continue;
      const currentRpm = key.requestTimestamps.filter(
        ts => now - ts < KEY_RPM_WINDOW_MS
      ).length;
      if (currentRpm < key.rpmLimit) return true;
    }
    return false;
  }

  /**
   * Get pool statistics (with masked API keys).
   */
  getStats() {
    const now = Date.now();
    const keys = [];
    for (const [, key] of this.#keys) {
      const currentRpm = key.requestTimestamps.filter(
        ts => now - ts < KEY_RPM_WINDOW_MS
      ).length;
      keys.push({
        id: key.id,
        name: key.name,
        apiKey: key.apiKey.length > 12
          ? key.apiKey.slice(0, 8) + '...' + key.apiKey.slice(-4)
          : '***',
        status: key.status,
        rpmLimit: key.rpmLimit,
        currentRpm,
        consecutiveErrors: key.consecutiveErrors,
      });
    }
    return {
      totalKeys: this.#keys.size,
      activeKeys: keys.filter(k => k.status === 'active').length,
      keys,
    };
  }

  /**
   * Clean up all timers.
   */
  dispose() {
    for (const timer of this.#cooldownTimers.values()) {
      clearTimeout(timer);
    }
    this.#cooldownTimers.clear();
    this.#keys.clear();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run server/queue/__tests__/KeyPoolManager.test.js`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/queue/KeyPoolManager.js server/queue/__tests__/KeyPoolManager.test.js
git commit -m "feat: implement KeyPoolManager with sliding window and circuit breaker"
```

---

### Task 4: RequestQueue

**Files:**
- Create: `server/queue/RequestQueue.js`
- Create: `server/queue/__tests__/RequestQueue.test.js`

- [ ] **Step 1: 编写 RequestQueue 测试**

创建 `server/queue/__tests__/RequestQueue.test.js`：

```javascript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RequestQueue } from '../RequestQueue.js';

describe('RequestQueue', () => {
  let queue;
  let mockKeyPool;

  beforeEach(() => {
    mockKeyPool = {
      acquire: vi.fn().mockReturnValue(null),
      hasAvailable: vi.fn().mockReturnValue(false),
      on: vi.fn(),
      release: vi.fn(),
    };
    queue = new RequestQueue(mockKeyPool);
  });

  afterEach(() => {
    queue.dispose();
  });

  describe('enqueue', () => {
    it('should fast-path when queue is empty and key available', () => {
      mockKeyPool.acquire.mockReturnValue({ id: 1, name: 'key-1', apiKey: 'sk-1' });
      const result = queue.enqueue({
        userId: 1, username: 'alice', connectionId: 'conn-1',
        command: 'hello', options: {},
      });
      expect(result.queued).toBe(false);
      expect(result.assignedKey).toBeTruthy();
    });

    it('should queue when no key available', () => {
      const result = queue.enqueue({
        userId: 1, username: 'alice', connectionId: 'conn-1',
        command: 'hello', options: {},
      });
      expect(result.queued).toBe(true);
      expect(result.position).toBe(1);
    });

    it('should queue when queue is not empty even if key available', () => {
      // First request queued (no key)
      queue.enqueue({
        userId: 1, username: 'alice', connectionId: 'conn-1',
        command: 'hello', options: {},
      });
      // Now key becomes available but queue not empty
      mockKeyPool.acquire.mockReturnValue({ id: 1, name: 'key-1', apiKey: 'sk-1' });
      const result = queue.enqueue({
        userId: 2, username: 'bob', connectionId: 'conn-2',
        command: 'world', options: {},
      });
      expect(result.queued).toBe(true); // no fast path, queue not empty
    });

    it('should reject when queue is full', () => {
      // Fill queue (use small max for test)
      queue._maxSize = 2;
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
      queue.enqueue({ userId: 2, username: 'b', connectionId: 'c2', command: '', options: {} });
      const result = queue.enqueue({ userId: 3, username: 'c', connectionId: 'c3', command: '', options: {} });
      expect(result.rejected).toBe(true);
    });

    it('should enforce per-user queue limit', () => {
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'c2', command: '', options: {} });
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'c3', command: '', options: {} });
      const result = queue.enqueue({ userId: 1, username: 'a', connectionId: 'c4', command: '', options: {} });
      expect(result.rejected).toBe(true);
      expect(result.reason).toContain('排队');
    });
  });

  describe('cancel', () => {
    it('should remove item from queue', () => {
      const result = queue.enqueue({
        userId: 1, username: 'alice', connectionId: 'conn-1',
        command: 'hello', options: {},
      });
      queue.cancel(result.requestId);
      expect(queue.getStats().queueLength).toBe(0);
    });
  });

  describe('cancelByConnection', () => {
    it('should remove all items for a connection', () => {
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'conn-1', command: '', options: {} });
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'conn-1', command: '', options: {} });
      queue.enqueue({ userId: 2, username: 'b', connectionId: 'conn-2', command: '', options: {} });
      queue.cancelByConnection('conn-1');
      expect(queue.getStats().queueLength).toBe(1);
    });
  });

  describe('dispatch', () => {
    it('should dispatch head of queue when key becomes available', () => {
      const onDispatched = vi.fn();
      queue.enqueue({
        userId: 1, username: 'alice', connectionId: 'conn-1',
        command: 'hello', options: {}, onDispatched,
      });
      expect(queue.getStats().queueLength).toBe(1);

      // Simulate key available
      mockKeyPool.acquire.mockReturnValue({ id: 1, name: 'key-1', apiKey: 'sk-1' });
      queue._tryDispatchNext();

      expect(onDispatched).toHaveBeenCalled();
      expect(queue.getStats().queueLength).toBe(0);
    });
  });

  describe('getPosition', () => {
    it('should return correct position', () => {
      const r1 = queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
      const r2 = queue.enqueue({ userId: 2, username: 'b', connectionId: 'c2', command: '', options: {} });
      expect(queue.getPosition(r1.requestId)).toBe(1);
      expect(queue.getPosition(r2.requestId)).toBe(2);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run server/queue/__tests__/RequestQueue.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 RequestQueue**

创建 `server/queue/RequestQueue.js`：

```javascript
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  QUEUE_MAX_SIZE,
  QUEUE_TIMEOUT_MS,
  QUEUE_POLL_INTERVAL_MS,
  QUOTA_MAX_QUEUE_PER_USER,
} from '../config/constants.js';

export class RequestQueue extends EventEmitter {
  /** @type {Array<QueueItem>} */
  #queue = [];
  #keyPool;
  #pollTimer = null;
  #timeoutTimers = new Map();
  _maxSize = QUEUE_MAX_SIZE; // exposed for testing

  /**
   * @param {import('./KeyPoolManager.js').KeyPoolManager} keyPool
   */
  constructor(keyPool) {
    super();
    this.#keyPool = keyPool;

    // Event-driven dispatch: when a key becomes available
    keyPool.on('key:available', () => this._tryDispatchNext());
    keyPool.on('key:released', () => this._tryDispatchNext());

    // Fallback polling
    this.#pollTimer = setInterval(() => this._tryDispatchNext(), QUEUE_POLL_INTERVAL_MS);
  }

  /**
   * Enqueue a request or fast-path if queue empty and key available.
   * @returns {{ queued: boolean, requestId?: string, position?: number, assignedKey?: object, rejected?: boolean, reason?: string }}
   */
  enqueue({ userId, username, connectionId, command, options, onDispatched }) {
    // Check per-user limit
    const userCount = this.#queue.filter(item => item.userId === userId && item.status === 'waiting').length;
    if (userCount >= QUOTA_MAX_QUEUE_PER_USER) {
      return { rejected: true, reason: `每用户最多排队 ${QUOTA_MAX_QUEUE_PER_USER} 个请求` };
    }

    // Check total queue size
    if (this.#queue.length >= this._maxSize) {
      return { rejected: true, reason: '系统繁忙，请稍后重试' };
    }

    // Fast path: queue empty and key available
    if (this.#queue.length === 0) {
      const key = this.#keyPool.acquire();
      if (key) {
        return { queued: false, requestId: randomUUID(), assignedKey: key };
      }
    }

    // Enqueue
    const requestId = randomUUID();
    const item = {
      id: requestId,
      userId,
      username,
      connectionId,
      command,
      options,
      priority: 0,
      enqueuedAt: Date.now(),
      status: 'waiting',
      onDispatched: onDispatched || null,
    };
    this.#queue.push(item);

    // Set timeout
    const timer = setTimeout(() => {
      this.#removeItem(requestId);
      this.#timeoutTimers.delete(requestId);
      this.emit('queue:timeout', { requestId, userId, connectionId });
    }, QUEUE_TIMEOUT_MS);
    this.#timeoutTimers.set(requestId, timer);

    const position = this.#queue.filter(i => i.status === 'waiting').indexOf(item) + 1;
    return { queued: true, requestId, position };
  }

  /**
   * Re-enqueue a request (for 429 retry), inserted at front.
   */
  requeue({ userId, username, connectionId, command, options, onDispatched }) {
    const requestId = randomUUID();
    const item = {
      id: requestId,
      userId,
      username,
      connectionId,
      command,
      options,
      priority: -1, // higher priority
      enqueuedAt: Date.now(),
      status: 'waiting',
      onDispatched: onDispatched || null,
    };
    // Insert at front
    this.#queue.unshift(item);

    const timer = setTimeout(() => {
      this.#removeItem(requestId);
      this.#timeoutTimers.delete(requestId);
      this.emit('queue:timeout', { requestId, userId, connectionId });
    }, QUEUE_TIMEOUT_MS);
    this.#timeoutTimers.set(requestId, timer);

    // Try dispatch immediately
    this._tryDispatchNext();

    return { queued: true, requestId, position: 1 };
  }

  /**
   * Cancel a specific queued request.
   */
  cancel(requestId) {
    this.#removeItem(requestId);
    const timer = this.#timeoutTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.#timeoutTimers.delete(requestId);
    }
  }

  /**
   * Cancel all queued requests for a connection.
   */
  cancelByConnection(connectionId) {
    const toRemove = this.#queue.filter(i => i.connectionId === connectionId && i.status === 'waiting');
    for (const item of toRemove) {
      this.cancel(item.id);
    }
  }

  /**
   * Get queue position for a request (1-based).
   * @returns {number | null}
   */
  getPosition(requestId) {
    const waiting = this.#queue.filter(i => i.status === 'waiting');
    const idx = waiting.findIndex(i => i.id === requestId);
    return idx === -1 ? null : idx + 1;
  }

  /**
   * Try to dispatch the next waiting request.
   */
  _tryDispatchNext() {
    const next = this.#queue.find(i => i.status === 'waiting');
    if (!next) return;

    const key = this.#keyPool.acquire();
    if (!key) return;

    // Dispatch
    next.status = 'dispatched';
    this.#removeItem(next.id);

    const timer = this.#timeoutTimers.get(next.id);
    if (timer) {
      clearTimeout(timer);
      this.#timeoutTimers.delete(next.id);
    }

    if (next.onDispatched) {
      next.onDispatched({ assignedKey: key, request: next });
    }
    this.emit('queue:dispatched', { requestId: next.id, keyId: key.id, userId: next.userId });

    // Try dispatching more
    this._tryDispatchNext();
  }

  /**
   * Get all queue positions and estimated wait times.
   * @param {number} avgCompletionTimeMs - Average request completion time
   */
  getQueueStatusForAll(avgCompletionTimeMs = 10000) {
    const activeKeyCount = this.#keyPool.getStats().activeKeys || 1;
    const waiting = this.#queue.filter(i => i.status === 'waiting');
    return waiting.map((item, index) => ({
      requestId: item.id,
      connectionId: item.connectionId,
      userId: item.userId,
      position: index + 1,
      estimatedWaitSec: Math.ceil(((index + 1) * avgCompletionTimeMs) / (activeKeyCount * 1000)),
    }));
  }

  getStats() {
    return {
      queueLength: this.#queue.filter(i => i.status === 'waiting').length,
      totalItems: this.#queue.length,
    };
  }

  #removeItem(requestId) {
    const idx = this.#queue.findIndex(i => i.id === requestId);
    if (idx !== -1) this.#queue.splice(idx, 1);
  }

  dispose() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    for (const timer of this.#timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.#timeoutTimers.clear();
    this.#queue = [];
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run server/queue/__tests__/RequestQueue.test.js`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/queue/RequestQueue.js server/queue/__tests__/RequestQueue.test.js
git commit -m "feat: implement RequestQueue with FIFO dispatch and timeout"
```

---

### Task 5: claude-sdk.js 改造 — Key 注入 + 429 处理

**Files:**
- Modify: `server/claude-sdk.js:150-244` (mapCliOptionsToSDK)
- Modify: `server/claude-sdk.js:489-720` (queryClaudeSDK)

- [ ] **Step 1: mapCliOptionsToSDK() 支持 _assignedApiKey**

在 `server/claude-sdk.js` 的 `mapCliOptionsToSDK()` 函数中，行 221（`const cleanEnv = { ...process.env };`）之后，行 222 之前，添加：

```javascript
  // Override API key if one was assigned by the key pool
  if (options._assignedApiKey) {
    cleanEnv.ANTHROPIC_AUTH_TOKEN = options._assignedApiKey;
  }
```

- [ ] **Step 2: queryClaudeSDK() 返回 429 错误类型信息**

在 `server/claude-sdk.js` 的 `queryClaudeSDK()` 函数中，找到 `for await (const message of queryInstance)` 循环的 catch 块。在现有的 error 处理中增加 429 判断。

找到 catch 块（大约在 700+ 行），在 `catch (error)` 中添加：

```javascript
    // Detect 429 rate limit errors
    const is429 = error?.status === 429
      || error?.message?.includes('rate_limit')
      || error?.message?.includes('429');

    if (is429) {
      // Determine phase: pre-stream if no messages sent yet
      const phase = sessionCreatedSent ? 'mid-stream' : 'pre-stream';
      error._rateLimitPhase = phase;
      error._isRateLimit = true;
    }
```

将错误继续抛出，由上层（ClaudeSDKProvider）处理。

- [ ] **Step 3: 验证修改不破坏现有功能**

Run: `node -e "import('./server/claude-sdk.js').then(() => console.log('import OK'))"`
Expected: import OK

- [ ] **Step 4: Commit**

```bash
git add server/claude-sdk.js
git commit -m "feat: support key pool injection and 429 error detection in claude-sdk"
```

---

### Task 5b: ClaudeSDKProvider 429 重试逻辑

**Files:**
- Modify: `server/providers/claude-sdk.js`

这是设计文档第四部分的核心功能。Task 5 在 `queryClaudeSDK()` 中标记了 `_isRateLimit` 和 `_rateLimitPhase`，本 Task 在 `ClaudeSDKProvider` 中消费这些标记实现重试。

- [ ] **Step 1: 在 ClaudeSDKProvider.start() 中添加 429 捕获和重试**

修改 `server/providers/claude-sdk.js` 的 `start(config)` 方法。在 `await queryClaudeSDK(command, options, writer)` 调用处包裹 try-catch：

```javascript
async start(config) {
  const { command, options, writer, transport, connectionId } = config;
  this.isRunning = true;
  this.#writer = writer;

  // Proxy writer.send()（现有代码不变）...

  let retryCount = 0;
  const maxRetries = 3; // MAX_429_RETRIES from constants

  while (retryCount <= maxRetries) {
    try {
      await queryClaudeSDK(command, options, writer);
      break; // 成功，退出循环
    } catch (error) {
      if (error._isRateLimit && error._rateLimitPhase === 'pre-stream' && retryCount < maxRetries) {
        // Pre-stream 429: 可以安全重试
        retryCount++;
        console.log(`[Provider] 429 pre-stream, retry ${retryCount}/${maxRetries}, key=${options._assignedKeyId}`);

        // 通知 KeyPoolManager 标记当前 Key 为 cooling
        // 通过事件通知（provider 不直接依赖 keyPoolManager）
        this.emit('rate-limited', { keyId: options._assignedKeyId });

        // 等待短暂延迟后重试（使用相同 key，因为 provider 层无法切换 key）
        // 实际的 Key 切换由上层（index.js 的 rate-limited 事件监听）处理
        await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
        continue;
      }

      if (error._isRateLimit && error._rateLimitPhase === 'mid-stream') {
        // Mid-stream 429: 不能透明重试，已有部分输出
        writer.send({
          type: 'claude-error',
          error: '请求被限速中断，请点击继续恢复对话',
          code: 'RATE_LIMIT_MID_STREAM',
          resumable: true,
        });
        this.emit('rate-limited', { keyId: options._assignedKeyId });
        break;
      }

      // 非 429 错误，直接抛出
      throw error;
    }
  }

  if (retryCount > maxRetries) {
    writer.send({
      type: 'claude-error',
      error: '当前使用人数较多，所有通道繁忙，请稍后重试',
      code: 'RATE_LIMIT_EXHAUSTED',
    });
  }
}
```

- [ ] **Step 2: 在 index.js 中监听 rate-limited 事件**

在 `startServer()` 内部，`processManager.startSession()` 之后的事件绑定区域添加：

```javascript
// 监听 provider 的 rate-limited 事件，标记 Key 冷却
processManager.on('process:output', ({ sessionId, data }) => {
  // 如果 provider 发出了 rate-limited 事件，会通过 processManager 传播
  // 但更直接的方式是在 router:startSession 中绑定：
});

// 更简洁：在 startSession 回调中为每个 provider 绑定
// 修改现有的 router:startSession 监听器，在 processManager.startSession() 后添加：
const provider = processManager.getProviderForSession(sessionId);
if (provider) {
  provider.on('rate-limited', ({ keyId }) => {
    keyPoolManager.markCooling(keyId);
  });
}
```

- [ ] **Step 3: 验证 import 无报错**

Run: `node -e "import('./server/providers/claude-sdk.js').then(() => console.log('import OK'))"`
Expected: import OK

- [ ] **Step 4: Commit**

```bash
git add server/providers/claude-sdk.js
git commit -m "feat: add 429 retry logic in ClaudeSDKProvider (pre-stream/mid-stream)"
```

---

### Task 6: MessageRouter 集成队列

**Files:**
- Modify: `server/message/MessageRouter.js:11-25` (构造函数)
- Modify: `server/message/MessageRouter.js:86-106` (#handleProviderCommand)

- [ ] **Step 1: 构造函数注入 requestQueue**

在 `MessageRouter` 构造函数中添加 `#requestQueue` 私有字段和注入：

```javascript
// 在行 16 后添加
  #requestQueue;

// 在构造函数中添加（行 24 后）
    this.#requestQueue = requestQueue || null;
```

更新构造函数参数解构：
```javascript
  constructor({ transport, sessionManager, processManager, messageBuffer, registry, requestQueue }) {
```

- [ ] **Step 2: 改造 #handleProviderCommand()**

替换 `server/message/MessageRouter.js` 行 86-106 的 `#handleProviderCommand()` 方法：

```javascript
  #handleProviderCommand(connectionId, message) {
    const providerType = PROVIDER_MAP[message.type];
    const conn = this.#registry.get(connectionId);
    console.log(`[Router] handleProviderCommand: provider=${providerType} conn=${!!conn} userId=${conn?.userId}`);
    if (!conn) return;

    // If no queue configured, use original flow
    if (!this.#requestQueue) {
      return this.#startSessionDirect(connectionId, message, providerType, conn);
    }

    // Enqueue request
    const result = this.#requestQueue.enqueue({
      userId: conn.userId,
      username: conn.username,
      connectionId,
      command: message.command,
      options: message.options || {},
      onDispatched: ({ assignedKey }) => {
        // Merge assigned key into options
        const enrichedMessage = {
          ...message,
          options: { ...(message.options || {}), _assignedApiKey: assignedKey.apiKey, _assignedKeyId: assignedKey.id },
        };
        this.#startSessionDirect(connectionId, enrichedMessage, providerType, conn);
      },
    });

    if (result.rejected) {
      this.#transport.send(connectionId, {
        type: 'queue-status',
        data: { status: 'rejected', message: result.reason },
      });
      return;
    }

    if (!result.queued) {
      // Fast path: key immediately available
      const enrichedMessage = {
        ...message,
        options: { ...(message.options || {}), _assignedApiKey: result.assignedKey.apiKey, _assignedKeyId: result.assignedKey.id },
      };
      this.#startSessionDirect(connectionId, enrichedMessage, providerType, conn);
      return;
    }

    // Queued: notify frontend
    this.#transport.send(connectionId, {
      type: 'queue-status',
      data: { status: 'queued', position: result.position, estimatedWaitSec: result.position * 10, queuedAt: Date.now() },
    });
  }

  #startSessionDirect(connectionId, message, providerType, conn) {
    try {
      const sessionId = this.#sessionManager.create(conn.userId, connectionId, { providerType });
      console.log(`[Router] session created: ${sessionId}, transitioning to start`);
      this.#sessionManager.transition(sessionId, 'start');
      this.emit('router:startSession', { sessionId, providerType, connectionId, message });
    } catch (err) {
      console.error(`[Router] handleProviderCommand error:`, err.message);
      if (err.name === 'QuotaExceededError') {
        this.#transport.send(connectionId, { type: 'quota-exceeded', reason: err.message });
      } else {
        this.#transport.send(connectionId, { type: 'session-error', error: err.message });
      }
    }
  }
```

- [ ] **Step 3: 验证 import 无报错**

Run: `node -e "import('./server/message/MessageRouter.js').then(() => console.log('import OK'))"`
Expected: import OK

- [ ] **Step 4: Commit**

```bash
git add server/message/MessageRouter.js
git commit -m "feat: integrate request queue into MessageRouter"
```

---

### Task 7: 管理 API — /api/settings/key-pool

**Files:**
- Modify: `server/routes/settings.js`

- [ ] **Step 1: 在 settings.js 顶部添加 import**

在 `server/routes/settings.js` 文件顶部（其他 import 语句旁）添加：

```javascript
import { anthropicKeyPoolDb } from '../database/anthropicKeyPoolDb.js';
```

- [ ] **Step 2: 在 settings.js 文件末尾添加 key-pool 路由**

在 `export default router` 之前添加：

```javascript
// ========== Anthropic Key Pool Management ==========

// GET /key-pool — list all keys (masked) + runtime stats
router.get('/key-pool', (req, res) => {
  try {
    const dbKeys = anthropicKeyPoolDb.getMasked();
    const runtimeStats = req.app.locals.keyPoolManager?.getStats() || null;
    res.json({ success: true, data: { keys: dbKeys, runtime: runtimeStats } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /key-pool — add a new key
router.post('/key-pool', (req, res) => {
  try {
    const { name, apiKey, rpmLimit } = req.body;
    if (!name || !apiKey) {
      return res.status(400).json({ success: false, error: 'name and apiKey are required' });
    }
    const result = anthropicKeyPoolDb.add(name, apiKey, rpmLimit || 50);

    // Add to runtime pool
    if (req.app.locals.keyPoolManager) {
      req.app.locals.keyPoolManager.addKey({
        id: result.id, name, api_key: apiKey, rpm_limit: rpmLimit || 50, enabled: 1,
      });
    }

    res.json({ success: true, data: { id: result.id, name, rpm_limit: rpmLimit || 50 } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /key-pool/:id — remove a key
router.delete('/key-pool/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    anthropicKeyPoolDb.remove(id);
    if (req.app.locals.keyPoolManager) {
      req.app.locals.keyPoolManager.removeKey(id);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /key-pool/:id — update key settings
router.patch('/key-pool/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { enabled, rpmLimit, name } = req.body;
    const fields = {};
    if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;
    if (rpmLimit !== undefined) fields.rpm_limit = rpmLimit;
    if (name !== undefined) fields.name = name;

    anthropicKeyPoolDb.update(id, fields);

    // Sync runtime pool state
    const kpm = req.app.locals.keyPoolManager;
    if (kpm) {
      if (enabled === false) kpm.disableKey(id);
      else if (enabled === true) kpm.enableKey(id);
      if (rpmLimit !== undefined) kpm.updateKeyRpmLimit(id, rpmLimit);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

- [ ] **Step 2: 验证路由无语法错误**

Run: `node -e "import('./server/routes/settings.js').then(() => console.log('import OK'))"`
Expected: import OK

- [ ] **Step 3: Commit**

```bash
git add server/routes/settings.js
git commit -m "feat: add /key-pool CRUD routes to settings"
```

---

### Task 8: index.js 初始化集成

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 在 index.js 中导入新模块**

在文件顶部的 import 区域添加：

```javascript
import { KeyPoolManager } from './queue/KeyPoolManager.js';
import { RequestQueue } from './queue/RequestQueue.js';
import { anthropicKeyPoolDb } from './database/anthropicKeyPoolDb.js';
```

- [ ] **Step 2: 在 MessageRouter 中添加 setter 方法**

由于 `MessageRouter` 在模块顶层创建（行 301），而数据库在 `startServer()` 异步函数中初始化（行 567），Key 池依赖数据库，因此不能在构造函数中注入。改用 setter：

在 `MessageRouter` 构造函数注入 `requestQueue` 的基础上（Task 6 已完成），确保 `requestQueue` 参数是可选的（默认 `null`），并添加 setter 方法：

```javascript
// 在 MessageRouter 类中添加
setRequestQueue(queue) {
  this.#requestQueue = queue;
}
```

- [ ] **Step 3: 在 startServer() 内初始化 KeyPoolManager 和 RequestQueue**

在 `server/index.js` 的 `startServer()` 函数中，`await initializeDatabase()` 之后（约行 567 后）添加：

```javascript
// Initialize Key Pool (must be after DB init)
const keyPoolManager = new KeyPoolManager();
const dbKeys = anthropicKeyPoolDb.getEnabled();
if (dbKeys.length === 0 && process.env.ANTHROPIC_AUTH_TOKEN) {
  const defaultKey = anthropicKeyPoolDb.add('default', process.env.ANTHROPIC_AUTH_TOKEN, 50);
  keyPoolManager.loadKeys([{ ...defaultKey, api_key: process.env.ANTHROPIC_AUTH_TOKEN, enabled: 1 }]);
  console.log('[KeyPool] Imported default key from ANTHROPIC_AUTH_TOKEN');
} else {
  keyPoolManager.loadKeys(dbKeys);
  console.log(`[KeyPool] Loaded ${dbKeys.length} keys from database`);
}

// Initialize Request Queue
const requestQueue = new RequestQueue(keyPoolManager);

// Inject into router (created at module top level, line 301)
router.setRequestQueue(requestQueue);

// Expose to Express app for route handlers (settings.js uses app.locals)
app.locals.keyPoolManager = keyPoolManager;
app.locals.requestQueue = requestQueue;
```

注意：`router` 在模块顶层创建时 `requestQueue` 为 `null`，队列行为在 `startServer()` 完成后才激活。这确保了数据库先初始化。

- [ ] **Step 4: 监听 ConnectionRegistry 断连事件清理队列**

在事件绑定区域添加：

```javascript
registry.on('connection:unregistered', ({ connectionId }) => {
  requestQueue.cancelByConnection(connectionId);
});
```

- [ ] **Step 5: 添加排队状态定时推送**

```javascript
// Push queue status to waiting clients every second
setInterval(() => {
  const statuses = requestQueue.getQueueStatusForAll();
  for (const status of statuses) {
    transport.send(status.connectionId, {
      type: 'queue-status',
      data: {
        status: 'queued',
        position: status.position,
        estimatedWaitSec: status.estimatedWaitSec,
        queuedAt: Date.now(),
      },
    });
  }
}, 1000);
```

- [ ] **Step 6: 在 router:startSession 监听器中传入 assignedKeyId 用于 release**

在 `router.on('router:startSession', ...)` 回调中，从 `message.options` 中提取 `_assignedKeyId`，并在 `process:complete` 和 `process:error` 事件中调用 `keyPoolManager.release()`：

注意：`process:complete` 和 `process:error` 事件在 `router.bindEvents()` 中已有监听器（负责 SessionManager 状态转换和消息缓冲清理）。下面新增的监听器是 **额外的**，仅负责 Key 释放，与现有监听器并存不冲突（EventEmitter 允许多个监听器）。这些监听器也应放在 `startServer()` 内部（`keyPoolManager` 的作用域内）。

```javascript
// 在 startServer() 内，requestQueue 初始化之后添加：

const sessionKeyMap = new Map();

// 扩展 router:startSession 监听：记录 sessionId → keyId 映射
// 注意：这是额外监听器，原有的 router:startSession 监听器（行 308）仍然有效
router.on('router:startSession', ({ sessionId, message }) => {
  const assignedKeyId = message.options?._assignedKeyId;
  if (assignedKeyId) {
    sessionKeyMap.set(sessionId, assignedKeyId);
  }
});

// Key release 监听器（仅负责释放 Key，不影响现有 session 管理逻辑）
processManager.on('process:complete', ({ sessionId }) => {
  const keyId = sessionKeyMap.get(sessionId);
  if (keyId) {
    keyPoolManager.release(keyId);
    sessionKeyMap.delete(sessionId);
  }
});
processManager.on('process:error', ({ sessionId }) => {
  const keyId = sessionKeyMap.get(sessionId);
  if (keyId) {
    keyPoolManager.release(keyId);
    sessionKeyMap.delete(sessionId);
  }
});
```

- [ ] **Step 7: 验证服务器能正常启动**

Run: `node server/index.js`（手动检查控制台日志，确认 KeyPool 和 RequestQueue 初始化成功）
Expected: `[KeyPool] Imported default key from ANTHROPIC_AUTH_TOKEN` 或 `[KeyPool] Loaded N keys from database`

- [ ] **Step 8: Commit**

```bash
git add server/index.js
git commit -m "feat: initialize key pool and request queue in server startup"
```

---

### Task 9: 前端 — queue-status 消息处理

**Files:**
- Modify: `src/contexts/WebSocketContext.tsx`

- [ ] **Step 1: 在 WebSocketContext 中添加 queue-status 状态**

在 WebSocketContext 的 state 或 ref 中添加排队状态：

```typescript
// 新增 state
const [queueStatus, setQueueStatus] = useState<{
  status: 'queued' | 'dispatched' | 'timeout' | 'rejected' | null;
  position?: number;
  estimatedWaitSec?: number;
  message?: string;
} | null>(null);
```

- [ ] **Step 2: 在 WebSocket onmessage 处理中添加 queue-status 分支**

在现有的消息类型 switch/if 中添加：

```typescript
if (parsed.type === 'queue-status') {
  const data = parsed.data;
  if (data.status === 'dispatched') {
    setQueueStatus(null); // 清除排队状态
  } else {
    setQueueStatus(data);
  }
  return;
}
```

- [ ] **Step 3: 通过 Context 暴露 queueStatus**

在 Context Provider 的 value 中添加 `queueStatus`，使子组件可以消费。

- [ ] **Step 4: Commit**

```bash
git add src/contexts/WebSocketContext.tsx
git commit -m "feat: handle queue-status messages in WebSocketContext"
```

---

### Task 10: 前端 — 排队状态 UI 展示

**Files:**
- Modify: `src/components/chat/view/subcomponents/AssistantThinkingIndicator.tsx`（行 59 显示"正在思考中"）

- [ ] **Step 1: 从 WebSocketContext 消费 queueStatus**

在 `AssistantThinkingIndicator.tsx` 中导入 `useWebSocket` 并获取 `queueStatus`。

- [ ] **Step 2: 添加排队状态展示**

在思考状态展示的位置前，添加排队状态判断：

```tsx
// 如果在排队中，显示排队信息
if (queueStatus && queueStatus.status === 'queued') {
  return (
    <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 text-sm py-2">
      <span className="animate-pulse">⏳</span>
      <span>当前排队第 {queueStatus.position} 位，预计等待约 {queueStatus.estimatedWaitSec} 秒</span>
    </div>
  );
}

if (queueStatus && queueStatus.status === 'timeout') {
  return (
    <div className="text-red-500 text-sm py-2">
      {queueStatus.message || '排队超时，请稍后重试'}
    </div>
  );
}

if (queueStatus && queueStatus.status === 'rejected') {
  return (
    <div className="text-red-500 text-sm py-2">
      {queueStatus.message || '系统繁忙，请稍后重试'}
    </div>
  );
}
```

- [ ] **Step 3: 验证 UI 构建无错误**

Run: `npm run build`
Expected: Build 成功，无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: display queue status in chat UI"
```

---

### Task 11: 集成测试

**Files:**
- Create: `server/queue/__tests__/integration.test.js`

- [ ] **Step 1: 编写集成测试**

创建 `server/queue/__tests__/integration.test.js`：

```javascript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { KeyPoolManager } from '../KeyPoolManager.js';
import { RequestQueue } from '../RequestQueue.js';

describe('KeyPool + RequestQueue Integration', () => {
  let keyPool;
  let queue;

  beforeEach(() => {
    keyPool = new KeyPoolManager();
    keyPool.loadKeys([
      { id: 1, name: 'key-1', api_key: 'sk-1', rpm_limit: 2, enabled: 1 },
      { id: 2, name: 'key-2', api_key: 'sk-2', rpm_limit: 2, enabled: 1 },
    ]);
    queue = new RequestQueue(keyPool);
  });

  afterEach(() => {
    queue.dispose();
    keyPool.dispose();
  });

  it('should fast-path first requests', () => {
    const r = queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
    expect(r.queued).toBe(false);
    expect(r.assignedKey).toBeTruthy();
  });

  it('should queue when all keys at capacity', () => {
    // Exhaust all keys (2 keys * 2 rpm = 4 requests)
    for (let i = 0; i < 4; i++) {
      queue.enqueue({ userId: i, username: `u${i}`, connectionId: `c${i}`, command: '', options: {} });
    }
    // 5th should queue
    const r = queue.enqueue({ userId: 5, username: 'u5', connectionId: 'c5', command: '', options: {} });
    expect(r.queued).toBe(true);
  });

  it('should dispatch queued request when key is released', () => {
    // Exhaust keys
    for (let i = 0; i < 4; i++) {
      queue.enqueue({ userId: i, username: `u${i}`, connectionId: `c${i}`, command: '', options: {} });
    }

    const onDispatched = vi.fn();
    queue.enqueue({ userId: 5, username: 'u5', connectionId: 'c5', command: '', options: {}, onDispatched });

    // Wait for sliding window to expire
    vi.useFakeTimers();
    vi.advanceTimersByTime(61000);

    // Release should trigger dispatch
    keyPool.release(1);
    expect(onDispatched).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('should handle 429 cooling and recovery', () => {
    vi.useFakeTimers();
    const r1 = queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
    expect(r1.queued).toBe(false);

    // Mark key as cooling
    keyPool.markCooling(r1.assignedKey.id, 100);

    // After cooldown, should be available again
    vi.advanceTimersByTime(150);
    const r2 = queue.enqueue({ userId: 2, username: 'b', connectionId: 'c2', command: '', options: {} });
    expect(r2.queued).toBe(false);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npx vitest run server/queue/__tests__/integration.test.js`
Expected: ALL PASS

- [ ] **Step 3: 运行所有队列相关测试**

Run: `npx vitest run server/queue/`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add server/queue/__tests__/integration.test.js
git commit -m "test: add key pool + request queue integration tests"
```

---

### Task 12: 端到端验证

- [ ] **Step 1: 启动服务器验证初始化**

Run: `npm run dev`（或 `node server/index.js`）
Expected: 日志中显示 KeyPool 和 RequestQueue 初始化成功

- [ ] **Step 2: 通过 API 添加测试 Key**

```bash
curl -X POST http://localhost:3001/api/settings/key-pool \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name": "test-key", "apiKey": "sk-ant-test-123", "rpmLimit": 10}'
```

Expected: `{"success": true, "data": {"id": ...}}`

- [ ] **Step 3: 查看 Key 池状态**

```bash
curl http://localhost:3001/api/settings/key-pool \
  -H "Authorization: Bearer <token>"
```

Expected: 返回脱敏的 Key 列表

- [ ] **Step 4: 发送正常消息验证队列透明（无排队）**

在 UI 中发送一条消息，确认：
- 无排队提示，正常显示"思考中..."
- AI 正常回复

- [ ] **Step 5: 全量测试运行**

Run: `npx vitest run`
Expected: 所有测试通过

- [ ] **Step 6: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete API key pool + request queue implementation"
```
