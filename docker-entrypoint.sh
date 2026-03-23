#!/bin/bash
set -e

# 修复 volume 挂载后的目录权限（volume 挂载默认归 root）
chown -R claude:claude /home/claude/.claude /data /workspace 2>/dev/null || true

# 确保 Claude CLI 所需子目录存在
su claude -c "mkdir -p /home/claude/.claude/debug /home/claude/.claude/statsig /home/claude/.claude/projects"

# 如果 settings.json 不存在（被空 volume 覆盖），从备份恢复
if [ ! -f /home/claude/.claude/settings.json ] && [ -f /home/claude/.claude-settings-default.json ]; then
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

# 从环境变量动态注入敏感配置到 settings.json（避免硬编码密钥）
SETTINGS_FILE="/home/claude/.claude/settings.json"
if [ -f "$SETTINGS_FILE" ] && command -v node >/dev/null 2>&1; then
    node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));
if (!settings.env) settings.env = {};

const envMap = {
    'ANTHROPIC_BASE_URL': process.env.ANTHROPIC_BASE_URL,
    'ANTHROPIC_AUTH_TOKEN': process.env.ANTHROPIC_AUTH_TOKEN,
    'API_TIMEOUT_MS': process.env.API_TIMEOUT_MS,
    'ANTHROPIC_MODEL': process.env.ANTHROPIC_MODEL,
    'ANTHROPIC_SMALL_FAST_MODEL': process.env.ANTHROPIC_MODEL,
    'ANTHROPIC_DEFAULT_SONNET_MODEL': process.env.ANTHROPIC_MODEL,
    'ANTHROPIC_DEFAULT_OPUS_MODEL': process.env.ANTHROPIC_MODEL,
    'ANTHROPIC_DEFAULT_HAIKU_MODEL': process.env.ANTHROPIC_MODEL,
};

for (const [key, val] of Object.entries(envMap)) {
    if (val) settings.env[key] = val;
}

fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
"
    chown claude:claude "$SETTINGS_FILE"
    echo "Settings.json 已从环境变量注入敏感配置"
fi

# 以 claude 用户身份启动应用
exec su claude -c "node server/index.js"
