# Proxy Setup Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed interactive proxy configuration wizard into Skill Pack installer scripts (Mac `.command` and Windows `.bat`), so users configure `~/.claude/settings.json` before skills are installed.

**Architecture:** Both `generateMacScript()` and `generateWindowsScript()` in `server/routes/skill-pack.js` receive new interactive proxy sections inserted before the commands/skills loop. The Mac script uses bash + python3 for JSON merging; Windows uses PowerShell. Both support two modes (登录号/拼车 and 中转站) with input validation and up to 3 retry attempts per field. Config is mandatory (no skip). Summary output is updated to include proxy mode and address.

**Tech Stack:** Node.js (server-side script generation), bash (Mac), PowerShell (Windows), Python3 (Mac JSON merge), no new dependencies.

---

### Task 1: Add proxy config wizard to Mac script

**Files:**
- Modify: `server/routes/skill-pack.js:177` (insert after `lines.push('');` following `skill_skipped=0`)
- Modify: `server/routes/skill-pack.js:268-277` (summary section)

- [ ] **Step 1: Read current file to confirm line numbers**

```bash
grep -n "skill_skipped=0\|Installation Complete\|Restart Claude" server/routes/skill-pack.js
```

Expected output shows lines ~176-177 for `skill_skipped=0` and `''`, and ~270-277 for summary.

- [ ] **Step 2: Insert proxy config bash block after line 177**

In `generateMacScript`, after `lines.push('skill_skipped=0'); lines.push('');` (line 176-177), insert the following proxy wizard block. Find this exact sequence:

```javascript
  lines.push('skill_skipped=0');
  lines.push('');

  // --- Commands ---
```

Replace with:

```javascript
  lines.push('skill_skipped=0');
  lines.push('');

  // --- Proxy Config ---
  lines.push('echo "----- 代理配置 -----"');
  lines.push('echo "请选择使用模式:"');
  lines.push('echo "  1) 登录号 / 拼车"');
  lines.push('echo "  2) 中转站"');
  lines.push('');
  lines.push('PROXY_MODE=""');
  lines.push('for _i in 1 2 3; do');
  lines.push('  read -rp "输入选项 [1/2]: " _mode_input');
  lines.push('  if [ "$_mode_input" = "1" ] || [ "$_mode_input" = "2" ]; then');
  lines.push('    PROXY_MODE="$_mode_input"');
  lines.push('    break');
  lines.push('  fi');
  lines.push('  echo "  错误：请输入 1 或 2"');
  lines.push('done');
  lines.push('if [ -z "$PROXY_MODE" ]; then');
  lines.push('  echo "输入无效，已退出。"');
  lines.push('  exit 1');
  lines.push('fi');
  lines.push('');
  lines.push('# Collect base URL (中转站 only)');
  lines.push('ANTHROPIC_BASE_URL=""');
  lines.push('ANTHROPIC_API_KEY=""');
  lines.push('if [ "$PROXY_MODE" = "2" ]; then');
  lines.push('  for _i in 1 2 3; do');
  lines.push('    read -rp "请输入 Base URL (例: https://api.wow3.top): " _url_input');
  lines.push('    case "$_url_input" in');
  lines.push('      http://*|https://*) ANTHROPIC_BASE_URL="$_url_input"; break ;;');
  lines.push('      *) echo "  错误：Base URL 必须以 http:// 或 https:// 开头" ;;');
  lines.push('    esac');
  lines.push('  done');
  lines.push('  if [ -z "$ANTHROPIC_BASE_URL" ]; then');
  lines.push('    echo "Base URL 无效，已退出。"');
  lines.push('    exit 1');
  lines.push('  fi');
  lines.push('  for _i in 1 2 3; do');
  lines.push('    read -rp "请输入 API Key: " _key_input');
  lines.push('    if [ -n "$_key_input" ]; then');
  lines.push('      ANTHROPIC_API_KEY="$_key_input"');
  lines.push('      break');
  lines.push('    fi');
  lines.push('    echo "  错误：API Key 不能为空"');
  lines.push('  done');
  lines.push('  if [ -z "$ANTHROPIC_API_KEY" ]; then');
  lines.push('    echo "API Key 无效，已退出。"');
  lines.push('    exit 1');
  lines.push('  fi');
  lines.push('fi');
  lines.push('');
  lines.push('# Collect proxy address');
  lines.push('PROXY_URL=""');
  lines.push('for _i in 1 2 3; do');
  lines.push('  read -rp "请输入代理地址 (http://ip:port): " _proxy_input');
  lines.push('  case "$_proxy_input" in');
  lines.push('    http://*) PROXY_URL="$_proxy_input"; break ;;');
  lines.push('    *) echo "  错误：代理地址必须以 http:// 开头" ;;');
  lines.push('  esac');
  lines.push('done');
  lines.push('if [ -z "$PROXY_URL" ]; then');
  lines.push('  echo "代理地址无效，已退出。"');
  lines.push('  exit 1');
  lines.push('fi');
  lines.push('');
  lines.push('# Write to ~/.claude/settings.json via python3');
  lines.push('if ! command -v python3 &>/dev/null; then');
  lines.push('  echo "  ⚠ python3 未找到，跳过 settings.json 写入"');
  lines.push('else');
  lines.push(`python3 -c "
import json, os, sys

proxy_url = sys.argv[1]
mode = sys.argv[2]
base_url = sys.argv[3] if len(sys.argv) > 3 else ''
api_key  = sys.argv[4] if len(sys.argv) > 4 else ''

settings_path = os.path.expanduser('~/.claude/settings.json')
if os.path.exists(settings_path):
    with open(settings_path, 'r') as f:
        settings = json.load(f)
else:
    settings = {}

env = settings.setdefault('env', {})
env['HTTP_PROXY']  = proxy_url
env['HTTPS_PROXY'] = proxy_url
if mode == '2' and base_url:
    env['ANTHROPIC_BASE_URL'] = base_url
if mode == '2' and api_key:
    env['ANTHROPIC_API_KEY'] = api_key
if 'language' not in settings:
    settings['language'] = '中文'

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)

print('  ✓ 代理配置已写入 ~/.claude/settings.json')
" "$PROXY_URL" "$PROXY_MODE" "$ANTHROPIC_BASE_URL" "$ANTHROPIC_API_KEY"`);
  lines.push('fi');
  lines.push('');
  lines.push('echo ""');
  lines.push('echo "----- 安装内容 -----"');
  lines.push('');

  // --- Commands ---
```

- [ ] **Step 3: Update Mac summary section to include proxy info**

Find the existing summary block (starts at `lines.push('echo ""');` before `Installation Complete`):

```javascript
  // --- Summary ---
  lines.push('echo ""');
  lines.push('echo "========================================="');
  lines.push('echo "  Installation Complete!"');
  lines.push('echo "========================================="');
  lines.push('echo "  Commands: ${command_added} added, ${command_skipped} skipped"');
  lines.push('echo "  Skills:   ${skill_added} added, ${skill_skipped} skipped"');
  lines.push(`echo "  MCP:      ${Object.keys(mcpServers).length}"`);
  lines.push('echo ""');
  lines.push('echo "Restart Claude CLI to apply changes."');
  lines.push('');
```

Replace with:

```javascript
  // --- Summary ---
  lines.push('echo ""');
  lines.push('echo "========================================="');
  lines.push('echo "  安装完成!"');
  lines.push('echo "========================================="');
  lines.push('if [ "$PROXY_MODE" = "1" ]; then');
  lines.push('  echo "  模式:     登录号/拼车"');
  lines.push('else');
  lines.push('  echo "  模式:     中转站"');
  lines.push('fi');
  lines.push('echo "  代理:     ${PROXY_URL}"');
  lines.push('echo "  Commands: ${command_added} added, ${command_skipped} skipped"');
  lines.push('echo "  Skills:   ${skill_added} added, ${skill_skipped} skipped"');
  lines.push(`echo "  MCP:      ${Object.keys(mcpServers).length}"`);
  lines.push('echo ""');
  lines.push('echo "请重启 Claude CLI 使配置生效。"');
  lines.push('');
```

- [ ] **Step 4: Manually test Mac script generation**

Start the dev server (or use existing), open the MCP page, click "Mac 下载". Open the `.command` file in a text editor and verify:
1. Lines 15-80 approximately contain the proxy wizard bash block
2. Variables `PROXY_MODE`, `PROXY_URL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` are defined
3. python3 block passes all 4 via `sys.argv`
4. Summary shows `模式:` and `代理:` lines

- [ ] **Step 5: Commit**

```bash
git add server/routes/skill-pack.js
git commit -m "feat(skill-pack): add proxy config wizard to Mac installer script"
```

---

### Task 2: Add proxy config wizard to Windows script

**Files:**
- Modify: `server/routes/skill-pack.js:300` (insert after `psLines.push('');` following `$skillAdded = 0; $skillSkipped = 0`)
- Modify: `server/routes/skill-pack.js:377-385` (Windows summary section)

- [ ] **Step 1: Insert proxy config PowerShell block after line 300**

In `generateWindowsScript`, after `psLines.push('$skillAdded = 0; $skillSkipped = 0'); psLines.push('');` (lines 299-300), find this exact sequence:

```javascript
  psLines.push('$skillAdded = 0; $skillSkipped = 0');
  psLines.push('');

  // --- Commands ---
```

Replace with:

```javascript
  psLines.push('$skillAdded = 0; $skillSkipped = 0');
  psLines.push('');

  // --- Proxy Config ---
  psLines.push('Write-Host "----- 代理配置 -----"');
  psLines.push('Write-Host "请选择使用模式:"');
  psLines.push('Write-Host "  1) 登录号 / 拼车"');
  psLines.push('Write-Host "  2) 中转站"');
  psLines.push('');
  psLines.push('$proxyMode = ""');
  psLines.push('for ($i = 0; $i -lt 3; $i++) {');
  psLines.push('  $modeInput = Read-Host "输入选项 [1/2]"');
  psLines.push('  if ($modeInput -eq "1" -or $modeInput -eq "2") { $proxyMode = $modeInput; break }');
  psLines.push('  Write-Host "  错误：请输入 1 或 2"');
  psLines.push('}');
  psLines.push('if ($proxyMode -eq "") { Write-Host "输入无效，已退出。"; exit 1 }');
  psLines.push('');
  psLines.push('$anthropicBaseUrl = ""');
  psLines.push('$anthropicApiKey = ""');
  psLines.push('if ($proxyMode -eq "2") {');
  psLines.push('  for ($i = 0; $i -lt 3; $i++) {');
  psLines.push('    $urlInput = Read-Host "请输入 Base URL (例: https://api.wow3.top)"');
  psLines.push('    if ($urlInput -match "^https?://") { $anthropicBaseUrl = $urlInput; break }');
  psLines.push('    Write-Host "  错误：Base URL 必须以 http:// 或 https:// 开头"');
  psLines.push('  }');
  psLines.push('  if ($anthropicBaseUrl -eq "") { Write-Host "Base URL 无效，已退出。"; exit 1 }');
  psLines.push('  for ($i = 0; $i -lt 3; $i++) {');
  psLines.push('    $keyInput = Read-Host "请输入 API Key"');
  psLines.push('    if ($keyInput -ne "") { $anthropicApiKey = $keyInput; break }');
  psLines.push('    Write-Host "  错误：API Key 不能为空"');
  psLines.push('  }');
  psLines.push('  if ($anthropicApiKey -eq "") { Write-Host "API Key 无效，已退出。"; exit 1 }');
  psLines.push('}');
  psLines.push('');
  psLines.push('$proxyUrl = ""');
  psLines.push('for ($i = 0; $i -lt 3; $i++) {');
  psLines.push('  $proxyInput = Read-Host "请输入代理地址 (http://ip:port)"');
  psLines.push('  if ($proxyInput -match "^http://") { $proxyUrl = $proxyInput; break }');
  psLines.push('  Write-Host "  错误：代理地址必须以 http:// 开头"');
  psLines.push('}');
  psLines.push('if ($proxyUrl -eq "") { Write-Host "代理地址无效，已退出。"; exit 1 }');
  psLines.push('');
  psLines.push('# Write to %USERPROFILE%\\.claude\\settings.json');
  psLines.push('$settingsPath = Join-Path $env:USERPROFILE ".claude\\settings.json"');
  psLines.push('if (Test-Path $settingsPath) {');
  psLines.push('  $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json');
  psLines.push('} else {');
  psLines.push('  $settings = [PSCustomObject]@{}');
  psLines.push('}');
  psLines.push('if (-not ($settings.PSObject.Properties.Name -contains "env")) {');
  psLines.push('  $settings | Add-Member -NotePropertyName "env" -NotePropertyValue ([PSCustomObject]@{})');
  psLines.push('}');
  psLines.push('$env_obj = $settings.env');
  psLines.push('# Set or update proxy keys');
  psLines.push('foreach ($key in @("HTTP_PROXY","HTTPS_PROXY")) {');
  psLines.push('  if ($env_obj.PSObject.Properties.Name -contains $key) {');
  psLines.push('    $env_obj.$key = $proxyUrl');
  psLines.push('  } else {');
  psLines.push('    $env_obj | Add-Member -NotePropertyName $key -NotePropertyValue $proxyUrl');
  psLines.push('  }');
  psLines.push('}');
  psLines.push('if ($proxyMode -eq "2") {');
  psLines.push('  foreach ($kv in @(@("ANTHROPIC_BASE_URL",$anthropicBaseUrl),@("ANTHROPIC_API_KEY",$anthropicApiKey))) {');
  psLines.push('    $k = $kv[0]; $v = $kv[1]');
  psLines.push('    if ($env_obj.PSObject.Properties.Name -contains $k) {');
  psLines.push('      $env_obj.$k = $v');
  psLines.push('    } else {');
  psLines.push('      $env_obj | Add-Member -NotePropertyName $k -NotePropertyValue $v');
  psLines.push('    }');
  psLines.push('  }');
  psLines.push('}');
  psLines.push('if (-not ($settings.PSObject.Properties.Name -contains "language")) {');
  psLines.push('  $settings | Add-Member -NotePropertyName "language" -NotePropertyValue "中文"');
  psLines.push('}');
  psLines.push('$settingsDir = Split-Path $settingsPath');
  psLines.push('if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null }');
  psLines.push('$settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath -Encoding UTF8');
  psLines.push('Write-Host "  OK 代理配置已写入 %USERPROFILE%\\.claude\\settings.json"');
  psLines.push('');
  psLines.push('Write-Host ""');
  psLines.push('Write-Host "----- 安装内容 -----"');
  psLines.push('');

  // --- Commands ---
```

- [ ] **Step 2: Update Windows summary section**

Find the existing Windows summary block:

```javascript
  // --- Summary ---
  psLines.push('Write-Host ""');
  psLines.push('Write-Host "========================================="');
  psLines.push('Write-Host "  Installation Complete!"');
  psLines.push('Write-Host "========================================="');
  psLines.push('Write-Host "  Commands: $commandAdded added, $commandSkipped skipped"');
  psLines.push('Write-Host "  Skills:   $skillAdded added, $skillSkipped skipped"');
  psLines.push(`Write-Host "  MCP:      ${Object.keys(mcpServers).length}"`);
  psLines.push('Write-Host ""');
  psLines.push('Write-Host "Restart Claude CLI to apply changes."');
```

Replace with:

```javascript
  // --- Summary ---
  psLines.push('Write-Host ""');
  psLines.push('Write-Host "========================================="');
  psLines.push('Write-Host "  安装完成!"');
  psLines.push('Write-Host "========================================="');
  psLines.push('if ($proxyMode -eq "1") {');
  psLines.push('  Write-Host "  模式:     登录号/拼车"');
  psLines.push('} else {');
  psLines.push('  Write-Host "  模式:     中转站"');
  psLines.push('}');
  psLines.push('Write-Host "  代理:     $proxyUrl"');
  psLines.push('Write-Host "  Commands: $commandAdded added, $commandSkipped skipped"');
  psLines.push('Write-Host "  Skills:   $skillAdded added, $skillSkipped skipped"');
  psLines.push(`Write-Host "  MCP:      ${Object.keys(mcpServers).length}"`);
  psLines.push('Write-Host ""');
  psLines.push('Write-Host "请重启 Claude CLI 使配置生效。"');
```

- [ ] **Step 3: Manually verify Windows script generation**

Download the `.bat` file from the MCP page, then decode and inspect the embedded PowerShell:

```powershell
# Extract the EncodedCommand value from the .bat file
# Then decode:
$encoded = "<paste base64 here>"
[System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded))
```

Verify:
1. PowerShell block contains `$proxyMode`, `$proxyUrl`, `$anthropicBaseUrl`, `$anthropicApiKey` variables
2. `settings.json` merge uses `Add-Member` / property assignment for proxy keys
3. Summary shows `模式:` and `代理:` lines

- [ ] **Step 4: Commit**

```bash
git add server/routes/skill-pack.js
git commit -m "feat(skill-pack): add proxy config wizard to Windows installer script"
```

---

### Task 3: End-to-end smoke test

**Files:**
- No code changes — manual verification only

- [ ] **Step 1: Test Mac script — 登录号 mode**

1. Download Mac `.command` from MCP page
2. Run it in Terminal
3. Select mode `1`
4. Enter proxy: `http://127.0.0.1:9999`
5. Verify `~/.claude/settings.json` contains:
   ```json
   { "env": { "HTTP_PROXY": "http://127.0.0.1:9999", "HTTPS_PROXY": "http://127.0.0.1:9999" }, "language": "中文" }
   ```
6. Verify summary shows `模式: 登录号/拼车` and `代理: http://127.0.0.1:9999`

- [ ] **Step 2: Test Mac script — 中转站 mode**

1. Run script again (or reset settings.json)
2. Select mode `2`
3. Enter Base URL: `https://api.example.com`
4. Enter API Key: `sk-test-123`
5. Enter proxy: `http://127.0.0.1:9999`
6. Verify settings.json contains all 4 env fields + `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`

- [ ] **Step 3: Test Mac script — validation (invalid input)**

1. Run script
2. Select mode `1`
3. Enter invalid proxy: `ftp://bad` three times
4. Verify script exits with `代理地址无效，已退出。`

- [ ] **Step 4: Test Mac script — merge (existing settings.json)**

1. Pre-create `~/.claude/settings.json` with `{ "someOtherKey": true }`
2. Run script with mode `1`, proxy `http://127.0.0.1:9999`
3. Verify `someOtherKey` is still present after merge

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add server/routes/skill-pack.js
git commit -m "fix(skill-pack): address proxy wizard edge cases from smoke test"
```
