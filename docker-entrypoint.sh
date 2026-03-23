#!/bin/bash
set -e

# 修复 volume 挂载后的目录权限（volume 挂载默认归 root）
chown -R claude:claude /home/claude/.claude /data /workspace 2>/dev/null || true

# 确保 Claude CLI 所需子目录存在
su claude -c "mkdir -p /home/claude/.claude/debug /home/claude/.claude/statsig /home/claude/.claude/projects"

# 持久化 ~/.claude.json（MCP 配置文件）
# ~/.claude.json 不在 volume 挂载范围内，容器重启后会丢失。
# 将其符号链接到 ~/.claude/claude.json（在持久卷中），确保 MCP 配置不丢失。
CLAUDE_JSON_PERSIST="/home/claude/.claude/claude.json"
CLAUDE_JSON_HOME="/home/claude/.claude.json"
if [ ! -f "$CLAUDE_JSON_PERSIST" ]; then
    # 如果持久文件不存在，从当前 ~/.claude.json 迁移（如果有）或创建空配置
    if [ -f "$CLAUDE_JSON_HOME" ] && [ ! -L "$CLAUDE_JSON_HOME" ]; then
        cp "$CLAUDE_JSON_HOME" "$CLAUDE_JSON_PERSIST"
    else
        echo '{}' > "$CLAUDE_JSON_PERSIST"
    fi
    chown claude:claude "$CLAUDE_JSON_PERSIST"
fi
# 创建符号链接（覆盖已有文件或旧链接）
ln -sf "$CLAUDE_JSON_PERSIST" "$CLAUDE_JSON_HOME"
chown -h claude:claude "$CLAUDE_JSON_HOME"
echo "~/.claude.json -> $CLAUDE_JSON_PERSIST (MCP 配置已持久化)"

# 每次启动都从镜像内置模板恢复 settings.json（确保模板更新生效，不被 volume 中的旧文件覆盖）
if [ -f /home/claude/.claude-settings-default.json ]; then
    cp /home/claude/.claude-settings-default.json /home/claude/.claude/settings.json
    chown claude:claude /home/claude/.claude/settings.json
fi

# 同步内置技能到 .claude/skills（每次启动都更新，确保镜像内新技能生效）
if [ -d /home/claude/.claude-skills-default ] && [ "$(ls -A /home/claude/.claude-skills-default 2>/dev/null)" ]; then
    mkdir -p /home/claude/.claude/skills
    cp -r /home/claude/.claude-skills-default/* /home/claude/.claude/skills/
    chown -R claude:claude /home/claude/.claude/skills
    echo "Built-in skills synced to /home/claude/.claude/skills"
fi

# 清理 settings.json 中的空值和注释占位符（以 # 开头的值）
SETTINGS_FILE="/home/claude/.claude/settings.json"
if [ -f "$SETTINGS_FILE" ] && command -v node >/dev/null 2>&1; then
    node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));
if (settings.env) {
    for (const [key, val] of Object.entries(settings.env)) {
        if (!val || val.startsWith('#')) delete settings.env[key];
    }
}
fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
"
    chown claude:claude "$SETTINGS_FILE"
    echo "Settings.json 已从模板生成（空值已清理）"
fi

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

# 导出完整 PATH，确保 claude 用户的子进程能找到 node、claude 等全局命令
export PATH

# 以 claude 用户身份启动应用（通过 -w PATH 保留 PATH 环境变量）
exec su -w PATH claude -c "exec node server/index.js"
