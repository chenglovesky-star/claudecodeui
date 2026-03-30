# 代理配置植入安装脚本 设计文档

**日期**：2026-03-30
**状态**：已批准，待实施

---

## 目标

在现有的 Skill Pack 安装脚本（Mac `.command` / Windows `.bat`）里，**在安装 skills/MCP 之前**，强制引导用户完成 Claude Code 代理配置，写入 `~/.claude/settings.json`。

支持两种使用模式：
- **登录号 / 拼车**：配置 HTTP 代理（`HTTP_PROXY` + `HTTPS_PROXY`）
- **中转站**：配置 HTTP 代理 + `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`

---

## 用户体验

用户双击脚本后，终端按以下顺序执行：

```
1. 打印标题
2. ── 代理配置（必填）──
   2a. 询问模式：1) 登录号/拼车  2) 中转站
   2b. 根据模式收集参数（见下）
   2c. 验证 URL 格式（必须以 http:// 开头）
   2d. 合并写入 ~/.claude/settings.json
3. ── 原有安装逻辑 ──
   3a. 安装 commands / skills（add-only）
   3b. 合并 MCP servers
4. 打印安装摘要（含代理信息）+ 提示重启 Claude CLI
```

### 登录号 / 拼车模式

收集：
- 代理地址（必填，格式：`http://ip:port`）

写入 settings.json：
```json
{
  "env": {
    "HTTP_PROXY": "<代理地址>",
    "HTTPS_PROXY": "<代理地址>"
  },
  "language": "中文"
}
```

### 中转站模式

收集：
- Base URL（必填，格式：`https://...`，默认提示 `https://api.wow3.top`）
- API Key（必填）
- 代理地址（必填，格式：`http://ip:port`）

写入 settings.json：
```json
{
  "env": {
    "HTTP_PROXY": "<代理地址>",
    "HTTPS_PROXY": "<代理地址>",
    "ANTHROPIC_BASE_URL": "<base_url>",
    "ANTHROPIC_API_KEY": "<api_key>"
  },
  "language": "中文"
}
```

---

## settings.json 合并策略

- 文件存在时：**合并**，只更新 `env` 内的代理相关字段，其余字段保留
- 文件不存在时：新建，写入完整内容
- 合并逻辑：
  - Mac：使用 `python3` 读取 → 更新 `env` 字段 → 写回
  - Windows：使用 PowerShell `ConvertFrom-Json` → 更新 → `ConvertTo-Json` 写回
- `language` 字段：仅在键不存在时写入 `"中文"`，已有时不覆盖

---

## 输入验证

| 字段 | 验证规则 | 失败行为 |
|------|---------|---------|
| 代理地址 | 必须以 `http://` 开头 | 打印错误，重新提问（最多 3 次，超限退出） |
| Base URL | 必须以 `http://` 或 `https://` 开头 | 同上 |
| API Key | 非空即可 | 打印错误，重新提问 |

---

## 涉及文件

| 类型 | 文件 |
|------|------|
| 修改 | `server/routes/skill-pack.js` |

具体改动：
- `generateMacScript(commands, skills, mcpServers)` — 在 lines 数组开头插入 bash 交互逻辑（模式选择 + 参数收集 + python3 写入 settings.json）
- `generateWindowsScript(commands, skills, mcpServers)` — 在 psLines 数组开头插入 PowerShell 交互逻辑
- 摘要输出增加代理模式和地址信息

---

## 不在本次范围内

- UI 变更（SkillPackDownload.tsx 不改）
- 代理连通性测试（不验证代理是否可用）
- Linux 支持（现有脚本已不支持）
- 代理配置的"跳过"选项
