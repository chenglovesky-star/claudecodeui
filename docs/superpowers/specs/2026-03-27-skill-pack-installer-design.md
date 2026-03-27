# 技能包一键安装到本地 Claude Code 设计

## 背景

团队成员本地都有 Claude Code CLI，但 claudecodeui 服务端上配置了大量自定义 skills（如 `/commit`、`/collect`、`/data-analyst`、`/iflytek-sql-query` 等）和 MCP 服务器。用户在 web 上能用这些能力，但本地 CLI 没有。手动逐个配置 skill 和 MCP 非常繁琐。

## 目标

用户在 claudecodeui 的 MCP 配置页面点击下载按钮 → 获得平台对应的安装程序（Mac / Windows）→ 双击运行 → 本地 Claude Code 立即获得所有自定义 skills 和 MCP 配置。

## 安装内容

### Skills
服务端扫描以下目录的所有自定义 skill：
- `~/.claude/commands/*.md`（用户级 commands）
- `~/.claude/skills/*/SKILL.md`（用户级 skills）

打包为安装脚本中的嵌入式文件，安装时写入用户本地对应目录。

### MCP Servers
从服务端 `~/.claude.json` 读取 `mcpServers` 配置，安装时合并到用户本地的 `~/.claude.json`（不覆盖已有配置）。

## 架构

```
┌──────────────────────────────┐
│  claudecodeui 服务端          │
│                              │
│  GET /api/skill-pack/download│
│  ?platform=mac|windows       │
│                              │
│  1. 扫描 skills + commands   │
│  2. 读取 MCP 配置            │
│  3. 生成自解压安装脚本        │
│  4. 返回文件下载              │
└──────────────┬───────────────┘
               │ 下载
               ▼
┌──────────────────────────────┐
│  用户本地                     │
│                              │
│  Mac: install-claude-skills  │
│       .command               │
│  Win: install-claude-skills  │
│       .bat                   │
│                              │
│  双击运行 →                  │
│  1. 创建 ~/.claude/commands/ │
│  2. 写入 skill .md 文件      │
│  3. 创建 ~/.claude/skills/   │
│  4. 写入 SKILL.md 文件       │
│  5. 合并 MCP 到 ~/.claude.json│
│  6. 显示安装汇总              │
└──────────────────────────────┘
```

## 后端 API

### `GET /api/skill-pack/download?platform=mac|windows`

**响应**：文件下载（`Content-Disposition: attachment`）

**生成逻辑**：

1. 扫描 skills 和 commands（复用 `commands.js` 中现有的扫描逻辑）
2. 读取 `~/.claude.json` 的 `mcpServers` 字段
3. 根据 platform 参数生成对应的安装脚本
4. 将 skill 文件内容和 MCP 配置以 heredoc（Mac）或内联字符串（Windows）嵌入脚本

**路由文件**：`server/routes/skill-pack.js`（新建）

```javascript
// 核心流程伪代码
router.get('/download', async (req, res) => {
    const platform = req.query.platform; // 'mac' | 'windows'

    // 1. 收集 commands
    const commandsDir = path.join(os.homedir(), '.claude', 'commands');
    const commands = await scanCommandFiles(commandsDir);

    // 2. 收集 skills
    const skillsDir = path.join(os.homedir(), '.claude', 'skills');
    const skills = await scanSkillFiles(skillsDir);

    // 3. 读取 MCP 配置
    const claudeJson = JSON.parse(await fs.readFile(
        path.join(os.homedir(), '.claude.json'), 'utf8'
    ));
    const mcpServers = claudeJson.mcpServers || {};
    // 过滤掉含敏感信息的字段（如 API key 类的 headers）
    const safeMcpServers = sanitizeMcpConfig(mcpServers);

    // 4. 生成安装脚本
    const script = platform === 'mac'
        ? generateMacScript(commands, skills, safeMcpServers)
        : generateWindowsScript(commands, skills, safeMcpServers);

    const filename = platform === 'mac'
        ? 'install-claude-skills.command'
        : 'install-claude-skills.bat';

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(script);
});
```

### `GET /api/skill-pack/info`

返回当前可打包的 skill 和 MCP 数量，供前端展示。

```json
{
    "commands": 5,
    "skills": 12,
    "mcpServers": 3,
    "lastUpdated": "2026-03-27T10:00:00Z"
}
```

## 安装脚本设计

### Mac（`.command` 文件）

`.command` 文件是 macOS 上双击可执行的 shell 脚本。

```bash
#!/bin/bash
# Claude Code 技能包安装程序
# 生成时间: {timestamp}

set -e

CLAUDE_DIR="$HOME/.claude"
COMMANDS_DIR="$CLAUDE_DIR/commands"
SKILLS_DIR="$CLAUDE_DIR/skills"
CLAUDE_JSON="$HOME/.claude.json"

echo "╔══════════════════════════════════════╗"
echo "║  Claude Code 技能包安装程序          ║"
echo "╚══════════════════════════════════════╝"
echo ""

# 创建目录
mkdir -p "$COMMANDS_DIR"
mkdir -p "$SKILLS_DIR"

# ── 安装 Commands ──
INSTALLED_COMMANDS=0

# {此处动态生成每个 command 的 heredoc 写入}
# 示例：
# cat > "$COMMANDS_DIR/commit.md" << 'SKILL_EOF'
# ---
# name: commit
# description: 快速提交代码
# ---
# 提交代码的指令内容...
# SKILL_EOF
# INSTALLED_COMMANDS=$((INSTALLED_COMMANDS + 1))

# ── 安装 Skills ──
INSTALLED_SKILLS=0

# {此处动态生成每个 skill 目录和 SKILL.md 的写入}
# 示例：
# mkdir -p "$SKILLS_DIR/data-analyst"
# cat > "$SKILLS_DIR/data-analyst/SKILL.md" << 'SKILL_EOF'
# ---
# name: data-analyst
# description: ...
# ---
# ...
# SKILL_EOF
# INSTALLED_SKILLS=$((INSTALLED_SKILLS + 1))

# ── 合并 MCP 配置 ──
INSTALLED_MCP=0

if [ -f "$CLAUDE_JSON" ]; then
    # 读取现有配置，合并 MCP（不覆盖已有的）
    python3 -c "
import json, sys

existing = {}
try:
    with open('$CLAUDE_JSON', 'r') as f:
        existing = json.load(f)
except:
    pass

new_mcp = json.loads(sys.stdin.read())
if 'mcpServers' not in existing:
    existing['mcpServers'] = {}

added = 0
for name, config in new_mcp.items():
    if name not in existing['mcpServers']:
        existing['mcpServers'][name] = config
        added += 1

with open('$CLAUDE_JSON', 'w') as f:
    json.dump(existing, f, indent=2)

print(added)
" << 'MCP_JSON'
{mcpServersJson}
MCP_JSON
    INSTALLED_MCP=$?
else
    # 新建配置文件
    cat > "$CLAUDE_JSON" << 'MCP_FULL_JSON'
{fullClaudeJson}
MCP_FULL_JSON
    INSTALLED_MCP={mcpCount}
fi

echo ""
echo "✅ 安装完成！"
echo "   Commands: $INSTALLED_COMMANDS 个"
echo "   Skills:   $INSTALLED_SKILLS 个"
echo "   MCP:      已合并"
echo ""
echo "现在可以在本地 Claude Code 中使用 / 查看所有技能。"
echo ""
read -p "按回车键关闭..."
```

### Windows（`.bat` 文件）

```batch
@echo off
chcp 65001 >nul 2>&1
echo ╔══════════════════════════════════════╗
echo ║  Claude Code 技能包安装程序          ║
echo ╚══════════════════════════════════════╝
echo.

set "CLAUDE_DIR=%USERPROFILE%\.claude"
set "COMMANDS_DIR=%CLAUDE_DIR%\commands"
set "SKILLS_DIR=%CLAUDE_DIR%\skills"
set "CLAUDE_JSON=%USERPROFILE%\.claude.json"

if not exist "%COMMANDS_DIR%" mkdir "%COMMANDS_DIR%"
if not exist "%SKILLS_DIR%" mkdir "%SKILLS_DIR%"

REM ── 安装 Commands 和 Skills ──
REM 使用 PowerShell 写入文件（支持 UTF-8）
powershell -ExecutionPolicy Bypass -Command ^
  "& { ... 动态生成的 PowerShell 脚本 ... }"

REM ── 合并 MCP 配置 ──
powershell -ExecutionPolicy Bypass -Command ^
  "& { ... JSON 合并逻辑 ... }"

echo.
echo ✅ 安装完成！
echo.
pause
```

## 前端 UI

### 入口位置

在 `McpServersContent.tsx` 的顶部，现有 MCP 列表之前，添加一个下载区域。

### UI 设计

```
┌─────────────────────────────────────────────────┐
│  📦 一键安装到本地 Claude Code                    │
│                                                   │
│  将服务端的 12 个技能和 3 个 MCP 配置             │
│  安装到你本地的 Claude Code CLI                   │
│                                                   │
│  [🍎 Mac 下载]    [🪟 Windows 下载]              │
│                                                   │
│  下载后双击运行即可完成安装                        │
└─────────────────────────────────────────────────┘
```

### 组件

**新建文件**：`src/components/settings/view/tabs/agents-settings/sections/content/SkillPackDownload.tsx`

```typescript
// 核心逻辑
const SkillPackDownload: React.FC = () => {
    const [info, setInfo] = useState<SkillPackInfo | null>(null);

    useEffect(() => {
        fetch('/api/skill-pack/info')
            .then(res => res.json())
            .then(setInfo);
    }, []);

    const handleDownload = (platform: 'mac' | 'windows') => {
        window.location.href = `/api/skill-pack/download?platform=${platform}`;
    };

    return (
        <div className="skill-pack-download">
            <h3>📦 一键安装到本地 Claude Code</h3>
            <p>将服务端的 {info?.skills + info?.commands} 个技能和
               {info?.mcpServers} 个 MCP 配置安装到本地</p>
            <div className="download-buttons">
                <button onClick={() => handleDownload('mac')}>
                    🍎 Mac 下载
                </button>
                <button onClick={() => handleDownload('windows')}>
                    🪟 Windows 下载
                </button>
            </div>
            <p className="hint">下载后双击运行即可完成安装</p>
        </div>
    );
};
```

## 涉及文件

| 文件 | 改动类型 | 内容 |
|------|---------|------|
| `server/routes/skill-pack.js` | 新建 | 打包下载 API |
| `server/cli.js` | 修改 | 注册新路由 |
| `src/components/settings/view/tabs/agents-settings/sections/content/SkillPackDownload.tsx` | 新建 | 下载区域组件 |
| `src/components/settings/view/tabs/agents-settings/sections/content/McpServersContent.tsx` | 修改 | 集成下载组件 |

## 安全考虑

- MCP 配置中的敏感字段（如 `headers` 中的 API key）需要过滤或脱敏后再打包
- 安装脚本只写入 `~/.claude/` 目录，不修改系统文件
- MCP 合并采用「不覆盖」策略，保护用户已有配置
- `.command` 文件下载后可能需要用户手动 `chmod +x`（macOS 安全策略）

## 边界情况

| 场景 | 处理 |
|------|------|
| 服务端没有自定义 skill | info API 返回 0，前端提示"暂无可安装的技能" |
| 用户本地已有同名 skill | 安装脚本覆盖写入（skill 内容以服务端为准） |
| 用户本地已有同名 MCP | 跳过，不覆盖（MCP 配置可能含本地路径等差异） |
| MCP 中的 stdio 命令本地不存在 | 安装脚本提示哪些 MCP 需要额外安装依赖 |
| 文件内容含特殊字符 | heredoc 使用单引号界定符（`'SKILL_EOF'`）避免变量展开 |
| Windows 路径中有空格 | 所有路径用双引号包裹 |
| macOS Gatekeeper 阻止运行 | 安装说明中提示右键→打开，或终端中 `chmod +x && ./` |
