# Skill Pack Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 MCP 配置页面提供一键下载按钮，用户下载平台对应的安装脚本（Mac `.command` / Windows `.bat`），双击运行后自动将服务端所有自定义 skills 和 MCP 配置安装到本地 Claude Code。

**Architecture:** 后端新增 `skill-pack.js` 路由，扫描服务端 skills/commands/MCP 配置后动态生成自解压安装脚本。前端在 MCP 页面顶部新增 `SkillPackDownload` 组件，调用 info API 展示统计并触发下载。

**Tech Stack:** Express Router, Node.js fs, React, i18next, heredoc 脚本生成

**Spec:** `docs/superpowers/specs/2026-03-27-skill-pack-installer-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/routes/skill-pack.js` | Create | 后端 API：info + download 端点 |
| `server/index.js` | Modify (~line 60, ~line 460) | 导入并注册新路由 |
| `src/components/settings/view/tabs/agents-settings/sections/content/SkillPackDownload.tsx` | Create | 下载区域 UI 组件 |
| `src/components/settings/view/tabs/agents-settings/sections/content/McpServersContent.tsx` | Modify (~line 374) | 在 McpServersContent 导出组件中集成 SkillPackDownload |
| `src/i18n/locales/en/settings.json` | Modify | 添加 skillPack 翻译键 |
| `src/i18n/locales/zh-CN/settings.json` | Modify | 添加 skillPack 中文翻译 |

---

### Task 1: 后端 skill-pack 路由 — info 端点

**Files:**
- Create: `server/routes/skill-pack.js`

- [ ] **Step 1: 创建路由文件骨架**

```javascript
// server/routes/skill-pack.js
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';

const router = express.Router();

/**
 * Recursively scan a directory for .md files and return their names + content.
 */
async function collectCommandFiles(dir) {
    const results = [];
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const sub = await collectCommandFiles(fullPath);
                results.push(...sub);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                const content = await fs.readFile(fullPath, 'utf8');
                const relativePath = path.relative(dir, fullPath);
                results.push({ relativePath, content });
            }
        }
    } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
            console.error(`Error scanning ${dir}:`, err.message);
        }
    }
    return results;
}

/**
 * Scan ~/.claude/skills/ for SKILL.md files. Returns skill name + content.
 */
async function collectSkillFiles(dir) {
    const results = [];
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
            try {
                const content = await fs.readFile(skillMdPath, 'utf8');
                results.push({ name: entry.name, content });
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    console.error(`Error reading skill ${entry.name}:`, err.message);
                }
            }
        }
    } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
            console.error(`Error scanning skills ${dir}:`, err.message);
        }
    }
    return results;
}

/**
 * Read MCP servers from ~/.claude.json, strip sensitive headers.
 */
async function collectMcpServers() {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    try {
        const raw = await fs.readFile(claudeJsonPath, 'utf8');
        const config = JSON.parse(raw);
        const servers = config.mcpServers || {};
        // Strip potentially sensitive headers
        const safe = {};
        for (const [name, cfg] of Object.entries(servers)) {
            const { headers, ...rest } = cfg;
            safe[name] = rest;
        }
        return safe;
    } catch {
        return {};
    }
}

// GET /api/skill-pack/info
router.get('/info', async (_req, res) => {
    try {
        const commandsDir = path.join(os.homedir(), '.claude', 'commands');
        const skillsDir = path.join(os.homedir(), '.claude', 'skills');

        const commands = await collectCommandFiles(commandsDir);
        const skills = await collectSkillFiles(skillsDir);
        const mcpServers = await collectMcpServers();

        res.json({
            commands: commands.length,
            skills: skills.length,
            mcpServers: Object.keys(mcpServers).length,
        });
    } catch (error) {
        console.error('skill-pack info error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
```

- [ ] **Step 2: 验证路由文件语法**

Run: `node -c server/routes/skill-pack.js`
Expected: 无输出（语法正确）

- [ ] **Step 3: Commit**

```bash
git add server/routes/skill-pack.js
git commit -m "feat(skill-pack): add info endpoint with skill/command/MCP scanning"
```

---

### Task 2: 后端 skill-pack 路由 — download 端点

**Files:**
- Modify: `server/routes/skill-pack.js`

- [ ] **Step 1: 添加 Mac 脚本生成函数**

在 `collectMcpServers` 函数之后、`router.get('/info', ...)` 之前，添加：

```javascript
/**
 * Generate a macOS .command installer script with embedded skill files.
 */
function generateMacScript(commands, skills, mcpServers) {
    const timestamp = new Date().toISOString();
    const mcpJson = JSON.stringify(mcpServers, null, 2);
    const mcpCount = Object.keys(mcpServers).length;

    let commandBlocks = '';
    for (const cmd of commands) {
        // Use a unique delimiter per file to avoid conflicts with content
        const delimiter = `CMDEOF_${Buffer.from(cmd.relativePath).toString('hex')}`;
        commandBlocks += `
cat > "$COMMANDS_DIR/${cmd.relativePath}" << '${delimiter}'
${cmd.content}
${delimiter}
INSTALLED_COMMANDS=$((INSTALLED_COMMANDS + 1))
`;
    }

    let skillBlocks = '';
    for (const skill of skills) {
        const delimiter = `SKILLEOF_${Buffer.from(skill.name).toString('hex')}`;
        skillBlocks += `
mkdir -p "$SKILLS_DIR/${skill.name}"
cat > "$SKILLS_DIR/${skill.name}/SKILL.md" << '${delimiter}'
${skill.content}
${delimiter}
INSTALLED_SKILLS=$((INSTALLED_SKILLS + 1))
`;
    }

    return `#!/bin/bash
# Claude Code Skill Pack Installer
# Generated: ${timestamp}
# Platform: macOS

set -e

CLAUDE_DIR="$HOME/.claude"
COMMANDS_DIR="$CLAUDE_DIR/commands"
SKILLS_DIR="$CLAUDE_DIR/skills"
CLAUDE_JSON="$HOME/.claude.json"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Claude Code 技能包安装程序              ║"
echo "║  Skills: ${String(skills.length).padStart(3)}  Commands: ${String(commands.length).padStart(3)}  MCP: ${String(mcpCount).padStart(3)}    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

mkdir -p "$COMMANDS_DIR"
mkdir -p "$SKILLS_DIR"

# ── Install Commands ──
INSTALLED_COMMANDS=0
${commandBlocks}
echo "  ✓ Commands installed: $INSTALLED_COMMANDS"

# ── Install Skills ──
INSTALLED_SKILLS=0
${skillBlocks}
echo "  ✓ Skills installed: $INSTALLED_SKILLS"

# ── Merge MCP Servers ──
if command -v python3 &>/dev/null; then
    ADDED_MCP=$(python3 -c "
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
    json.dump(existing, f, indent=2, ensure_ascii=False)
print(added)
" << 'MCP_EOF'
${mcpJson}
MCP_EOF
    )
    echo "  ✓ MCP servers added: $ADDED_MCP (existing ones kept)"
else
    echo "  ⚠ python3 not found, skipping MCP config merge"
    echo "    You can manually add MCP servers to ~/.claude.json"
fi

echo ""
echo "══════════════════════════════════════════"
echo "  ✅ Installation complete!"
echo "  Open Claude Code and type / to see your skills."
echo "══════════════════════════════════════════"
echo ""
read -p "Press Enter to close..."
`;
}
```

- [ ] **Step 2: 添加 Windows 脚本生成函数**

在 `generateMacScript` 函数之后添加：

```javascript
/**
 * Generate a Windows .bat installer script with embedded PowerShell logic.
 */
function generateWindowsScript(commands, skills, mcpServers) {
    const timestamp = new Date().toISOString();
    const mcpJson = JSON.stringify(mcpServers);

    // Build PowerShell file-write commands for each command/skill
    const psFileWrites = [];

    for (const cmd of commands) {
        const escaped = cmd.content.replace(/'/g, "''");
        const filePath = cmd.relativePath.replace(/\//g, '\\');
        psFileWrites.push(
            `$cmdContent = '${escaped}'\n` +
            `[System.IO.File]::WriteAllText("$commandsDir\\${filePath}", $cmdContent, [System.Text.Encoding]::UTF8)\n` +
            `$installedCommands++`
        );
    }

    for (const skill of skills) {
        const escaped = skill.content.replace(/'/g, "''");
        psFileWrites.push(
            `New-Item -ItemType Directory -Force -Path "$skillsDir\\${skill.name}" | Out-Null\n` +
            `$skillContent = '${escaped}'\n` +
            `[System.IO.File]::WriteAllText("$skillsDir\\${skill.name}\\SKILL.md", $skillContent, [System.Text.Encoding]::UTF8)\n` +
            `$installedSkills++`
        );
    }

    const psScript = `
$claudeDir = "$env:USERPROFILE\\.claude"
$commandsDir = "$claudeDir\\commands"
$skillsDir = "$claudeDir\\skills"
$claudeJson = "$env:USERPROFILE\\.claude.json"

New-Item -ItemType Directory -Force -Path $commandsDir | Out-Null
New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null

$installedCommands = 0
$installedSkills = 0

${psFileWrites.join('\n\n')}

Write-Host "  Commands installed: $installedCommands"
Write-Host "  Skills installed: $installedSkills"

# Merge MCP servers
$newMcp = '${mcpJson.replace(/'/g, "''")}' | ConvertFrom-Json
$existing = @{}
if (Test-Path $claudeJson) {
    try { $existing = Get-Content $claudeJson -Raw | ConvertFrom-Json } catch {}
}
if (-not $existing.mcpServers) {
    $existing | Add-Member -NotePropertyName mcpServers -NotePropertyValue @{} -Force
}
$added = 0
foreach ($prop in $newMcp.PSObject.Properties) {
    if (-not $existing.mcpServers.PSObject.Properties[$prop.Name]) {
        $existing.mcpServers | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value -Force
        $added++
    }
}
$existing | ConvertTo-Json -Depth 10 | Set-Content $claudeJson -Encoding UTF8
Write-Host "  MCP servers added: $added (existing ones kept)"
Write-Host ""
Write-Host "  Installation complete!"
`.trim();

    // Encode PowerShell script as base64 for safe embedding in bat
    const psBase64 = Buffer.from(psScript, 'utf16le').toString('base64');

    return `@echo off
chcp 65001 >nul 2>&1
echo.
echo ========================================
echo   Claude Code Skill Pack Installer
echo   Generated: ${timestamp}
echo ========================================
echo.

powershell -ExecutionPolicy Bypass -EncodedCommand ${psBase64}

echo.
echo Open Claude Code and type / to see your skills.
echo.
pause
`;
}
```

- [ ] **Step 3: 添加 download 路由**

在 `router.get('/info', ...)` 之后添加：

```javascript
// GET /api/skill-pack/download?platform=mac|windows
router.get('/download', async (req, res) => {
    try {
        const platform = req.query.platform;
        if (platform !== 'mac' && platform !== 'windows') {
            return res.status(400).json({ error: 'platform must be "mac" or "windows"' });
        }

        const commandsDir = path.join(os.homedir(), '.claude', 'commands');
        const skillsDir = path.join(os.homedir(), '.claude', 'skills');

        const commands = await collectCommandFiles(commandsDir);
        const skills = await collectSkillFiles(skillsDir);
        const mcpServers = await collectMcpServers();

        const script = platform === 'mac'
            ? generateMacScript(commands, skills, mcpServers)
            : generateWindowsScript(commands, skills, mcpServers);

        const filename = platform === 'mac'
            ? 'install-claude-skills.command'
            : 'install-claude-skills.bat';

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(script);
    } catch (error) {
        console.error('skill-pack download error:', error);
        res.status(500).json({ error: error.message });
    }
});
```

- [ ] **Step 4: 验证语法**

Run: `node -c server/routes/skill-pack.js`
Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add server/routes/skill-pack.js
git commit -m "feat(skill-pack): add download endpoint with Mac/Windows script generation"
```

---

### Task 3: 注册路由到 Express 应用

**Files:**
- Modify: `server/index.js` (~line 60 导入, ~line 460 注册)

- [ ] **Step 1: 添加导入**

在 `server/index.js` 中，找到其他路由导入的位置（如 `import commandsRoutes from './routes/commands.js';`），在其后添加：

```javascript
import skillPackRoutes from './routes/skill-pack.js';
```

- [ ] **Step 2: 注册路由**

在路由注册区域（如 `app.use('/api/commands', authenticateToken, commandsRoutes);` 附近），添加：

```javascript
app.use('/api/skill-pack', authenticateToken, skillPackRoutes);
```

- [ ] **Step 3: 验证服务器启动**

Run: `cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui && node server/index.js`
Expected: 服务器正常启动，无报错（Ctrl+C 退出）

- [ ] **Step 4: 测试 info API**

Run: `curl -s http://localhost:3000/api/skill-pack/info | python3 -m json.tool`
Expected: 返回 JSON 包含 commands、skills、mcpServers 数量

- [ ] **Step 5: 测试 download API**

Run: `curl -s -o /tmp/test-install.command "http://localhost:3000/api/skill-pack/download?platform=mac" && head -20 /tmp/test-install.command`
Expected: 输出 bash 脚本头部，包含 `#!/bin/bash` 和 `Claude Code Skill Pack Installer`

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "feat(skill-pack): register skill-pack route in Express app"
```

---

### Task 4: 添加 i18n 翻译键

**Files:**
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh-CN/settings.json`

- [ ] **Step 1: 添加英文翻译**

在 `src/i18n/locales/en/settings.json` 中，在 `"mcpServers"` 键之前添加：

```json
"skillPack": {
    "title": "Install to Local Claude Code",
    "description": "Download and install {{total}} skills and {{mcp}} MCP servers to your local Claude Code CLI",
    "downloadMac": "Mac Download",
    "downloadWindows": "Windows Download",
    "hint": "Download and double-click to install",
    "empty": "No skills or MCP servers available for download",
    "loading": "Loading..."
},
```

- [ ] **Step 2: 添加中文翻译**

在 `src/i18n/locales/zh-CN/settings.json` 中，在对应位置添加：

```json
"skillPack": {
    "title": "一键安装到本地 Claude Code",
    "description": "将 {{total}} 个技能和 {{mcp}} 个 MCP 配置安装到你本地的 Claude Code CLI",
    "downloadMac": "Mac 下载",
    "downloadWindows": "Windows 下载",
    "hint": "下载后双击运行即可完成安装",
    "empty": "暂无可安装的技能或 MCP 配置",
    "loading": "加载中..."
},
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/locales/en/settings.json src/i18n/locales/zh-CN/settings.json
git commit -m "feat(skill-pack): add i18n translations for skill pack download"
```

---

### Task 5: 创建 SkillPackDownload 前端组件

**Files:**
- Create: `src/components/settings/view/tabs/agents-settings/sections/content/SkillPackDownload.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useState, useEffect } from 'react';
import { Download, Apple, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../../../../shared/view/ui';

type SkillPackInfo = {
    commands: number;
    skills: number;
    mcpServers: number;
};

export default function SkillPackDownload() {
    const { t } = useTranslation('settings');
    const [info, setInfo] = useState<SkillPackInfo | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/skill-pack/info')
            .then((res) => res.json())
            .then((data) => {
                setInfo(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="mb-4 rounded-lg border border-dashed border-gray-300 p-4 dark:border-gray-600">
                <p className="text-sm text-gray-500">{t('skillPack.loading')}</p>
            </div>
        );
    }

    const total = (info?.commands ?? 0) + (info?.skills ?? 0);
    const mcp = info?.mcpServers ?? 0;

    if (total === 0 && mcp === 0) {
        return null;
    }

    const handleDownload = (platform: 'mac' | 'windows') => {
        window.location.href = `/api/skill-pack/download?platform=${platform}`;
    };

    return (
        <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-950/30">
            <div className="flex items-center gap-2 mb-2">
                <Download className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                    {t('skillPack.title')}
                </h4>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {t('skillPack.description', { total, mcp })}
            </p>
            <div className="flex gap-2 mb-2">
                <Button
                    size="sm"
                    className="bg-purple-600 text-white hover:bg-purple-700"
                    onClick={() => handleDownload('mac')}
                >
                    <Apple className="mr-1 h-4 w-4" />
                    {t('skillPack.downloadMac')}
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownload('windows')}
                >
                    <Monitor className="mr-1 h-4 w-4" />
                    {t('skillPack.downloadWindows')}
                </Button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500">
                {t('skillPack.hint')}
            </p>
        </div>
    );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui && npx tsc --noEmit src/components/settings/view/tabs/agents-settings/sections/content/SkillPackDownload.tsx 2>&1 | head -20`
Expected: 无错误，或仅有与项目配置相关的警告

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/view/tabs/agents-settings/sections/content/SkillPackDownload.tsx
git commit -m "feat(skill-pack): create SkillPackDownload component"
```

---

### Task 6: 集成到 McpServersContent

**Files:**
- Modify: `src/components/settings/view/tabs/agents-settings/sections/content/McpServersContent.tsx`

- [ ] **Step 1: 添加导入**

在 `McpServersContent.tsx` 顶部导入区域添加：

```typescript
import SkillPackDownload from './SkillPackDownload';
```

- [ ] **Step 2: 在 Claude MCP 页面中集成组件**

在 `McpServersContent` 导出组件中，当 agent 为 `claude` 时，在 `ClaudeMcpServers` 之前渲染 `SkillPackDownload`。

找到：
```typescript
export default function McpServersContent(props: McpServersContentProps) {
  if (props.agent === 'claude') {
    return <ClaudeMcpServers {...props} />;
  }
```

替换为：
```typescript
export default function McpServersContent(props: McpServersContentProps) {
  if (props.agent === 'claude') {
    return (
      <>
        <SkillPackDownload />
        <ClaudeMcpServers {...props} />
      </>
    );
  }
```

- [ ] **Step 3: 验证构建**

Run: `cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui && npx vite build 2>&1 | tail -10`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/view/tabs/agents-settings/sections/content/McpServersContent.tsx
git commit -m "feat(skill-pack): integrate SkillPackDownload into MCP settings page"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 启动开发服务器**

Run: `cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui && npm run dev`

- [ ] **Step 2: 验证 info API 返回正确数据**

Run: `curl -s http://localhost:3000/api/skill-pack/info`
Expected: `{"commands":N,"skills":N,"mcpServers":N}` 数量大于 0

- [ ] **Step 3: 验证 Mac 下载脚本有效**

Run:
```bash
curl -s -o /tmp/test-install.command "http://localhost:3000/api/skill-pack/download?platform=mac"
chmod +x /tmp/test-install.command
bash -n /tmp/test-install.command
echo "Syntax check: $?"
```
Expected: `Syntax check: 0`（bash 语法验证通过）

- [ ] **Step 4: 验证 Windows 下载脚本生成**

Run:
```bash
curl -s -o /tmp/test-install.bat "http://localhost:3000/api/skill-pack/download?platform=windows"
head -10 /tmp/test-install.bat
```
Expected: 输出包含 `@echo off` 和 `Claude Code Skill Pack Installer`

- [ ] **Step 5: 浏览器验证 UI**

打开浏览器访问 Settings → Agents → Claude → MCP Servers，确认顶部显示紫色的下载区域，包含 Mac/Windows 下载按钮和统计数字。

- [ ] **Step 6: 点击下载测试**

点击 Mac 下载按钮，确认浏览器下载 `install-claude-skills.command` 文件。

- [ ] **Step 7: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(skill-pack): address e2e issues"
```
