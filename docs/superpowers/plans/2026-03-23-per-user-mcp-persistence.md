# 按用户持久化 MCP 服务器配置 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MCP 服务器配置从共享的 `~/.claude.json` 文件改为按用户存储到 SQLite 数据库，实现多用户 MCP 配置隔离和长期持久化。

**Architecture:** 新增 `user_mcp_servers` 数据库表存储每个用户的 MCP 服务器配置。后端 MCP 路由改为读写数据库（基于 `req.user`）。SDK 查询时从数据库加载当前用户的 MCP 配置，与系统级配置合并后传给 SDK。前端无需改动（API 接口保持不变）。

**Tech Stack:** SQLite (better-sqlite3), Express.js, existing auth middleware

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `server/database/init.sql` | 修改 | 添加 `user_mcp_servers` 表定义 |
| `server/database/db.js` | 修改 | 添加 `userMcpDb` 操作（CRUD），导出 |
| `server/routes/mcp.js` | 修改 | 所有路由改为用户隔离：读写 DB 而非 CLI/文件 |
| `server/claude-sdk.js` | 修改 | `loadMcpConfig` 接受 userId，合并系统+用户配置 |
| `server/routes/auth.js` | 修改 | 登录时将 `iflytek-sql-gateway` 写入用户 DB 记录 |
| `docker-entrypoint.sh` | 修改 | 启动时迁移 `~/.claude.json` 中已有 MCP 配置到 DB |

---

### Task 1: 数据库 — 添加 `user_mcp_servers` 表和 DB 操作

**Files:**
- Modify: `server/database/init.sql`
- Modify: `server/database/db.js`

- [ ] **Step 1: 在 init.sql 末尾添加表定义**

在 `server/database/init.sql` 文件末尾添加：

```sql
-- Per-user MCP server configurations
CREATE TABLE IF NOT EXISTS user_mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'stdio',
    config_json TEXT NOT NULL DEFAULT '{}',
    scope TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_user_mcp_servers_user_id ON user_mcp_servers(user_id);
```

- [ ] **Step 2: 在 db.js 的 `runMigrations` 函数中添加迁移**

在 `server/database/db.js` 的 `runMigrations()` 函数末尾（`console.log('Database migrations completed successfully')` 之前）添加：

```javascript
    // Create user_mcp_servers table if it doesn't exist (per-user MCP persistence)
    db.exec(`CREATE TABLE IF NOT EXISTS user_mcp_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'stdio',
      config_json TEXT NOT NULL DEFAULT '{}',
      scope TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_mcp_servers_user_id ON user_mcp_servers(user_id)');
```

- [ ] **Step 3: 在 db.js 中添加 `userMcpDb` 操作对象**

在 `server/database/db.js` 中，在 `userProjectsDb` 对象之后、`githubTokensDb` 之前添加：

```javascript
// Per-user MCP server configuration operations
const userMcpDb = {
  // Upsert (add or update) an MCP server for a user
  upsert: (userId, name, type, configJson, scope = 'user') => {
    const configStr = typeof configJson === 'string' ? configJson : JSON.stringify(configJson);
    db.prepare(`
      INSERT INTO user_mcp_servers (user_id, name, type, config_json, scope)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, name)
      DO UPDATE SET type = excluded.type, config_json = excluded.config_json,
                    scope = excluded.scope, updated_at = CURRENT_TIMESTAMP
    `).run(userId, name, type, configStr, scope);
  },

  // Get all MCP servers for a user
  getAll: (userId) => {
    return db.prepare(
      'SELECT id, name, type, config_json, scope, created_at, updated_at FROM user_mcp_servers WHERE user_id = ?'
    ).all(userId);
  },

  // Get a single MCP server by name for a user
  getByName: (userId, name) => {
    return db.prepare(
      'SELECT id, name, type, config_json, scope FROM user_mcp_servers WHERE user_id = ? AND name = ?'
    ).get(userId, name);
  },

  // Delete an MCP server by name for a user
  remove: (userId, name) => {
    const result = db.prepare(
      'DELETE FROM user_mcp_servers WHERE user_id = ? AND name = ?'
    ).run(userId, name);
    return result.changes > 0;
  },

  // Build SDK-compatible mcpServers object from DB rows
  toSdkFormat: (rows) => {
    const servers = {};
    for (const row of rows) {
      try {
        const config = JSON.parse(row.config_json);
        servers[row.name] = { type: row.type, ...config };
      } catch {
        console.warn(`[MCP-DB] Invalid config JSON for server "${row.name}", skipping`);
      }
    }
    return servers;
  },
};
```

- [ ] **Step 4: 导出 `userMcpDb`**

在 `server/database/db.js` 的 export 语句中添加 `userMcpDb`：

```javascript
export {
  db,
  initializeDatabase,
  userDb,
  apiKeysDb,
  credentialsDb,
  sessionNamesDb,
  applyCustomSessionNames,
  userProjectsDb,
  userMcpDb,        // <-- 新增
  githubTokensDb
};
```

- [ ] **Step 5: 验证服务启动无报错**

Run: `cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui && node -e "import('./server/database/db.js').then(m => { console.log('userMcpDb keys:', Object.keys(m.userMcpDb)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"`
Expected: 输出 `userMcpDb keys: [ 'upsert', 'getAll', 'getByName', 'remove', 'toSdkFormat' ]`

- [ ] **Step 6: Commit**

```bash
git add server/database/init.sql server/database/db.js
git commit -m "feat: add user_mcp_servers table for per-user MCP persistence"
```

---

### Task 2: MCP 路由 — 改为读写数据库（用户隔离）

**Files:**
- Modify: `server/routes/mcp.js`

当前的 MCP 路由通过 `claude` CLI 操作共享的 `~/.claude.json`。改为直接读写数据库，按 `req.user.id` 隔离。

- [ ] **Step 1: 在 mcp.js 顶部导入 userMcpDb**

在 `server/routes/mcp.js` 顶部的 import 区域添加：

```javascript
import { userMcpDb } from '../database/db.js';
```

- [ ] **Step 2: 改造 `GET /api/mcp/config/read` 路由**

将 `server/routes/mcp.js` 中 `router.get('/config/read', ...)` 路由（第354-471行）的处理函数**整体替换**为：

```javascript
router.get('/config/read', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`📖 Reading MCP servers from DB for user ${req.user.username} (id=${userId})`);

    const rows = userMcpDb.getAll(userId);
    const servers = rows.map(row => {
      let config = {};
      try { config = JSON.parse(row.config_json); } catch {}

      const server = {
        id: row.name,
        name: row.name,
        type: row.type,
        scope: row.scope,
        config: {},
        raw: { type: row.type, ...config },
      };

      if (config.command) {
        server.config.command = config.command;
        server.config.args = config.args || [];
        server.config.env = config.env || {};
      } else if (config.url) {
        server.config.url = config.url;
        server.config.headers = config.headers || {};
      }

      return server;
    });

    console.log(`📋 Found ${servers.length} MCP servers for user ${req.user.username}`);
    res.json({ success: true, configPath: 'database', servers });
  } catch (error) {
    console.error('Error reading MCP servers from DB:', error);
    res.status(500).json({ error: 'Failed to read MCP configuration', details: error.message });
  }
});
```

- [ ] **Step 3: 改造 `POST /api/mcp/cli/add` 路由**

将 `server/routes/mcp.js` 中 `router.post('/cli/add', ...)` 路由（第59-142行）的处理函数**整体替换**为：

```javascript
router.post('/cli/add', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, type = 'stdio', command, args = [], url, headers = {}, env = {}, scope = 'user' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Server name is required' });
    }

    console.log(`➕ Adding MCP server "${name}" for user ${req.user.username} (id=${userId})`);

    // Build config object based on type
    let config = {};
    if (type === 'stdio') {
      config = { command, args, env };
    } else {
      config = { url, headers };
    }

    userMcpDb.upsert(userId, name, type, config, scope);

    res.json({ success: true, message: `MCP server "${name}" added successfully` });
  } catch (error) {
    console.error('Error adding MCP server:', error);
    res.status(500).json({ error: 'Failed to add MCP server', details: error.message });
  }
});
```

- [ ] **Step 4: 改造 `POST /api/mcp/cli/add-json` 路由**

将 `server/routes/mcp.js` 中 `router.post('/cli/add-json', ...)` 路由（第145-238行）的处理函数**整体替换**为：

```javascript
router.post('/cli/add-json', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, jsonConfig, scope = 'user' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Server name is required' });
    }

    let parsedConfig;
    try {
      parsedConfig = typeof jsonConfig === 'string' ? JSON.parse(jsonConfig) : jsonConfig;
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON configuration', details: parseError.message });
    }

    if (!parsedConfig.type) {
      return res.status(400).json({ error: 'Invalid configuration', details: 'Missing required field: type' });
    }

    console.log(`➕ Adding MCP server "${name}" (JSON) for user ${req.user.username}`);

    const { type, ...configWithoutType } = parsedConfig;
    userMcpDb.upsert(userId, name, type, configWithoutType, scope);

    res.json({ success: true, message: `MCP server "${name}" added successfully via JSON` });
  } catch (error) {
    console.error('Error adding MCP server via JSON:', error);
    res.status(500).json({ error: 'Failed to add MCP server', details: error.message });
  }
});
```

- [ ] **Step 5: 改造 `DELETE /api/mcp/cli/remove/:name` 路由**

将 `server/routes/mcp.js` 中 `router.delete('/cli/remove/:name', ...)` 路由（第241-308行）的处理函数**整体替换**为：

```javascript
router.delete('/cli/remove/:name', async (req, res) => {
  try {
    const userId = req.user.id;
    let { name } = req.params;

    // Handle the ID format (remove scope prefix if present, e.g. "local:test")
    if (name.includes(':')) {
      name = name.split(':')[1];
    }

    console.log(`🗑️ Removing MCP server "${name}" for user ${req.user.username}`);

    const removed = userMcpDb.remove(userId, name);
    if (!removed) {
      return res.status(404).json({ error: `MCP server "${name}" not found` });
    }

    res.json({ success: true, message: `MCP server "${name}" removed successfully` });
  } catch (error) {
    console.error('Error removing MCP server:', error);
    res.status(500).json({ error: 'Failed to remove MCP server', details: error.message });
  }
});
```

- [ ] **Step 6: 改造 `GET /api/mcp/cli/list` 路由**

将 `server/routes/mcp.js` 中 `router.get('/cli/list', ...)` 路由（第16-56行）的处理函数**整体替换**为：

```javascript
router.get('/cli/list', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`📋 Listing MCP servers for user ${req.user.username}`);

    const rows = userMcpDb.getAll(userId);
    const servers = rows.map(row => {
      let config = {};
      try { config = JSON.parse(row.config_json); } catch {}
      return {
        name: row.name,
        type: row.type,
        status: 'active',
        description: config.url || config.command || '',
      };
    });

    res.json({ success: true, output: '', servers });
  } catch (error) {
    console.error('Error listing MCP servers:', error);
    res.status(500).json({ error: 'Failed to list MCP servers', details: error.message });
  }
});
```

- [ ] **Step 7: 改造 `GET /api/mcp/cli/get/:name` 路由**

将 `server/routes/mcp.js` 中 `router.get('/cli/get/:name', ...)` 路由（第311-351行）的处理函数**整体替换**为：

```javascript
router.get('/cli/get/:name', async (req, res) => {
  try {
    const userId = req.user.id;
    let { name } = req.params;

    // Handle the ID format (remove scope prefix if present, e.g. "local:test")
    if (name.includes(':')) {
      name = name.split(':')[1];
    }

    const row = userMcpDb.getByName(userId, name);
    if (!row) {
      return res.status(404).json({ error: `MCP server "${name}" not found` });
    }

    let config = {};
    try { config = JSON.parse(row.config_json); } catch {}

    res.json({ success: true, output: '', server: { name: row.name, type: row.type, ...config } });
  } catch (error) {
    console.error('Error getting MCP server:', error);
    res.status(500).json({ error: 'Failed to get MCP server details', details: error.message });
  }
});
```

- [ ] **Step 8: 移除不再需要的 `parseClaudeListOutput` 和 `parseClaudeGetOutput` 辅助函数**

删除 `server/routes/mcp.js` 底部的 `parseClaudeListOutput` 和 `parseClaudeGetOutput` 函数（第474-556行）。这些函数用于解析 Claude CLI 输出，改用 DB 后不再需要。

- [ ] **Step 9: Commit**

```bash
git add server/routes/mcp.js
git commit -m "feat: MCP routes now read/write per-user DB instead of shared ~/.claude.json"
```

---

### Task 3: Claude SDK — 从数据库加载用户 MCP 配置

**Files:**
- Modify: `server/claude-sdk.js`

`queryClaudeSDK` 已经通过 `options._userId` 拿到当前用户 ID。改造 `loadMcpConfig` 让它从数据库加载用户的 MCP 服务器配置。

- [ ] **Step 1: 在 claude-sdk.js 顶部导入 userMcpDb**

在 `server/claude-sdk.js` 的 import 区域添加：

```javascript
import { userMcpDb } from './database/db.js';
```

- [ ] **Step 2: 修改 `loadMcpConfig` 函数签名，添加 userId 参数**

将 `server/claude-sdk.js` 中的 `loadMcpConfig` 函数（第437-490行）**整体替换**为：

```javascript
async function loadMcpConfig(cwd, userId) {
  try {
    let mcpServers = {};

    // 1. Load system-level MCP servers from ~/.claude.json (iflytek-sql-gateway etc.)
    try {
      const claudeConfigPath = path.join(os.homedir(), '.claude.json');
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      const claudeConfig = JSON.parse(configContent);

      if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
        mcpServers = { ...claudeConfig.mcpServers };
        console.log(`Loaded ${Object.keys(mcpServers).length} system MCP servers from ~/.claude.json`);
      }
    } catch {
      // No system config or parse error — proceed with DB-only
    }

    // 2. Load per-user MCP servers from database (overrides system servers on name conflict)
    if (userId) {
      try {
        const rows = userMcpDb.getAll(userId);
        const userServers = userMcpDb.toSdkFormat(rows);
        mcpServers = { ...mcpServers, ...userServers };
        console.log(`Loaded ${Object.keys(userServers).length} user MCP servers from DB (userId=${userId})`);
      } catch (err) {
        console.error('Failed to load user MCP servers from DB:', err.message);
      }
    }

    if (Object.keys(mcpServers).length === 0) {
      console.log('No MCP servers configured');
      return null;
    }

    console.log(`Total MCP servers loaded: ${Object.keys(mcpServers).length}`);
    return mcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}
```

- [ ] **Step 3: 修改 `queryClaudeSDK` 中调用 `loadMcpConfig` 的位置**

在 `server/claude-sdk.js` 的 `queryClaudeSDK` 函数中，找到调用 `loadMcpConfig` 的那行（约第525行）：

```javascript
    const [mcpServers, imageResult] = await Promise.all([
      loadMcpConfig(options.cwd),
      handleImages(command, options.images, options.cwd),
    ]);
```

替换为：

```javascript
    const [mcpServers, imageResult] = await Promise.all([
      loadMcpConfig(options.cwd, options._userId),
      handleImages(command, options.images, options.cwd),
    ]);
```

- [ ] **Step 4: Commit**

```bash
git add server/claude-sdk.js
git commit -m "feat: loadMcpConfig merges system + per-user MCP servers from DB"
```

---

### Task 4: 登录自动注入 — 将 iflytek-sql-gateway 写入用户 DB

**Files:**
- Modify: `server/routes/auth.js`

登录时除了写 `~/.claude.json`（系统级），还要把 `iflytek-sql-gateway` 写入当前用户的数据库记录，这样 SDK 查询时能从 DB 加载到正确的用户凭证。

- [ ] **Step 1: 在 auth.js 顶部导入 userMcpDb**

在 `server/routes/auth.js` 的 import 区域添加：

```javascript
import { userMcpDb } from '../database/db.js';
```

注意：`userDb` 和 `userProjectsDb` 已经从 `'../database/db.js'` 导入了，需要将 `userMcpDb` 加入同一行：

```javascript
import { userDb, userProjectsDb, userMcpDb } from '../database/db.js';
```

- [ ] **Step 2: 在 `syncMcpSqlGateway` 函数中添加 DB 写入**

将 `server/routes/auth.js` 中的 `syncMcpSqlGateway` 函数（第20-23行）替换为：

```javascript
function syncMcpSqlGateway(username, password, userId) {
  // Write to ~/.claude.json for system-level compatibility
  syncMcpSqlGatewayDirect(username, password);

  // Write to per-user DB for user-isolated MCP loading
  if (userId) {
    try {
      userMcpDb.upsert(userId, MCP_SQL_GATEWAY_NAME, 'http', {
        url: MCP_SQL_GATEWAY_URL,
        headers: { username, password },
      });
      console.log(`[MCP] DB: saved ${MCP_SQL_GATEWAY_NAME} for user ${username} (id=${userId})`);
    } catch (err) {
      console.error(`[MCP] DB: failed to save ${MCP_SQL_GATEWAY_NAME}:`, err.message);
    }
  }
}
```

- [ ] **Step 3: 在登录路由中传入 userId**

在 `server/routes/auth.js` 的 `POST /login` 路由中，找到调用 `syncMcpSqlGateway` 的那行（第115行）：

```javascript
    syncMcpSqlGateway(username, password);
```

替换为：

```javascript
    syncMcpSqlGateway(username, password, localUser.id);
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/auth.js
git commit -m "feat: login writes iflytek-sql-gateway to per-user DB"
```

---

### Task 5: 启动迁移 — 已有 MCP 配置自动迁移到 DB

**Files:**
- Modify: `docker-entrypoint.sh`

对于已部署的实例，`~/.claude.json` 中可能已有用户通过 CLI 添加的 MCP 服务器。在容器启动时做一次性迁移：将 `~/.claude.json` 中的全局 MCP 配置导入到所有已注册用户的 DB 记录中。

- [ ] **Step 1: 在 docker-entrypoint.sh 中添加迁移脚本**

在 `docker-entrypoint.sh` 中，在启动应用（`exec su ...`）之前添加：

```bash
# 一次性迁移：将 ~/.claude.json 中的 MCP 配置导入到每个用户的数据库记录中
MCP_MIGRATION_MARKER="/home/claude/.claude/.mcp_migrated"
CLAUDE_JSON="/home/claude/.claude.json"
if [ ! -f "$MCP_MIGRATION_MARKER" ] && [ -f "$CLAUDE_JSON" ]; then
    echo "Running one-time MCP config migration from ~/.claude.json to DB..."
    node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const dbPath = process.env.DATABASE_PATH || '/data/db/auth.db';
if (!fs.existsSync(dbPath)) { console.log('DB not found, skip migration'); process.exit(0); }
const db = new Database(dbPath);

// Ensure table exists
db.exec(\`CREATE TABLE IF NOT EXISTS user_mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'stdio',
  config_json TEXT NOT NULL DEFAULT '{}',
  scope TEXT NOT NULL DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
)\`);

let config;
try { config = JSON.parse(fs.readFileSync('$CLAUDE_JSON', 'utf8')); } catch { process.exit(0); }
const mcpServers = config.mcpServers || {};
const serverNames = Object.keys(mcpServers);
if (serverNames.length === 0) { console.log('No MCP servers to migrate'); process.exit(0); }

const users = db.prepare('SELECT id, username FROM users WHERE is_active = 1').all();
if (users.length === 0) { console.log('No users, skip'); process.exit(0); }

const upsert = db.prepare(\`
  INSERT INTO user_mcp_servers (user_id, name, type, config_json, scope)
  VALUES (?, ?, ?, ?, 'user')
  ON CONFLICT(user_id, name) DO NOTHING
\`);

const userCreds = config._mcpUserCredentials || {};

const migrate = db.transaction(() => {
  for (const user of users) {
    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      let finalConfig = { ...serverConfig };
      // For iflytek-sql-gateway, use per-user credentials if available
      if (name === 'iflytek-sql-gateway' && userCreds[user.username]) {
        finalConfig.headers = {
          username: userCreds[user.username].username,
          password: userCreds[user.username].password,
        };
      }
      const type = finalConfig.type || 'stdio';
      delete finalConfig.type;
      upsert.run(user.id, name, type, JSON.stringify(finalConfig));
    }
  }
});
migrate();
console.log('Migrated ' + serverNames.length + ' MCP servers to ' + users.length + ' users');
db.close();
" 2>&1 && touch "$MCP_MIGRATION_MARKER" || echo "MCP migration failed (non-fatal, will retry next start)"
fi
```

- [ ] **Step 2: Commit**

```bash
git add docker-entrypoint.sh
git commit -m "feat: one-time migration of MCP config from ~/.claude.json to per-user DB"
```

---

### Task 6: 清理 — 移除 claude-sdk.js 中不再需要的用户凭证注入逻辑

**Files:**
- Modify: `server/claude-sdk.js`

既然 `loadMcpConfig` 现在从 DB 加载用户专属的 MCP 配置（含正确凭证），就不再需要在 `queryClaudeSDK` 中手动读取 `_mcpUserCredentials` 来注入凭证了。

- [ ] **Step 1: 删除凭证注入代码块**

在 `server/claude-sdk.js` 的 `queryClaudeSDK` 函数中，找到用户凭证注入的代码块（约第529-552行，从 `// Inject current user's credentials` 注释开始到 `sdkOptions.mcpServers = mcpServers;` 之前）：

```javascript
    if (mcpServers) {
      // Inject current user's credentials into iflytek-sql-gateway MCP headers.
      // ...
      const currentUsername = options._username;
      if (currentUsername && mcpServers['iflytek-sql-gateway']) {
        try {
          const configContent = await fs.readFile(path.join(os.homedir(), '.claude.json'), 'utf8');
          const claudeConfig = JSON.parse(configContent);
          const userCreds = claudeConfig._mcpUserCredentials?.[currentUsername];
          if (userCreds) {
            mcpServers['iflytek-sql-gateway'] = {
              ...mcpServers['iflytek-sql-gateway'],
              headers: {
                username: userCreds.username,
                password: userCreds.password,
              },
            };
            console.log(`[SDK] MCP iflytek-sql-gateway: injected credentials for user ${currentUsername}`);
          }
        } catch {
          // Config read failed, use existing headers
        }
      }
      sdkOptions.mcpServers = mcpServers;
    }
```

替换为：

```javascript
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }
```

- [ ] **Step 2: 清理 auth.js 中 `_mcpUserCredentials` 的写入**

在 `server/routes/auth.js` 的 `syncMcpSqlGatewayDirect` 函数中，删除 `_mcpUserCredentials` 相关代码块（第46-49行）：

```javascript
    // 删除以下代码（不再需要，凭证已存在 DB 中）：
    // if (!config._mcpUserCredentials) {
    //   config._mcpUserCredentials = {};
    // }
    // config._mcpUserCredentials[username] = { username, password };
```

即将 `syncMcpSqlGatewayDirect` 函数改为：

```javascript
function syncMcpSqlGatewayDirect(username, password) {
  try {
    const configPath = path.join(process.env.HOME || '', '.claude.json');
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    // Store global MCP server config (system-level fallback)
    config.mcpServers[MCP_SQL_GATEWAY_NAME] = {
      type: 'http',
      url: MCP_SQL_GATEWAY_URL,
      headers: { username, password }
    };
    // _mcpUserCredentials removed — per-user credentials now stored in DB

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`[MCP] Direct-wrote ${MCP_SQL_GATEWAY_NAME} for user ${username}`);
  } catch (err) {
    console.error(`[MCP] Failed to sync ${MCP_SQL_GATEWAY_NAME}:`, err.message);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/claude-sdk.js server/routes/auth.js
git commit -m "refactor: remove _mcpUserCredentials dead code, credentials now in per-user DB"
```
