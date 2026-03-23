#!/bin/bash
set -e

# 修复 volume 挂载后的目录权限（volume 挂载默认归 root）
chown -R claude:claude /home/claude/.claude /data /workspace 2>/dev/null || true

# 确保 Claude CLI 所需子目录存在
su claude -c "mkdir -p /home/claude/.claude/debug /home/claude/.claude/statsig /home/claude/.claude/projects"

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

# 导出完整 PATH，确保 claude 用户的子进程能找到 node、claude 等全局命令
export PATH

# 以 claude 用户身份启动应用（通过 -w PATH 保留 PATH 环境变量）
exec su -w PATH claude -c "exec node server/index.js"
