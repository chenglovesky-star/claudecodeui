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

# 以 claude 用户身份启动应用
exec su claude -c "node server/index.js"
