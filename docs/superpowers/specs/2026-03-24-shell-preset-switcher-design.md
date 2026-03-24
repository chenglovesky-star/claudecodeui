# Shell Preset Switcher — 设计文档

## 背景

使用 Claude Code CLI 时，API 可能遇到限流、额度用尽、宕机等问题。同时用户可能通过 API 代理接入不同厂商模型（GLM5、MiniMax 等）。需要在 Shell 界面提供手动快捷切换 Preset 的能力，一键更换 API 配置和模型。

## 核心概念

每个 **Preset** 是一组完整的 CLI 环境变量配置，包含 API 地址、密钥和模型映射。切换 Preset = 杀掉当前 PTY 进程 + 用新环境变量重启 CLI。

## 数据模型

```typescript
type ShellPreset = {
  id: string;                // 唯一标识
  label: string;             // 显示名称，如 'Claude Opus', 'MiniMax'
  baseUrl: string;           // ANTHROPIC_BASE_URL
  apiKey: string;            // ANTHROPIC_API_KEY
  model: string;             // ANTHROPIC_MODEL
  smallFastModel: string;    // ANTHROPIC_SMALL_FAST_MODEL
  defaultSonnetModel: string;// ANTHROPIC_DEFAULT_SONNET_MODEL
  defaultOpusModel: string;  // ANTHROPIC_DEFAULT_OPUS_MODEL
};
```

### 配置文件

路径：`项目根目录/shell-presets.json`

```json
[
  {
    "id": "claude-opus",
    "label": "Claude Opus",
    "baseUrl": "https://api.anthropic.com",
    "apiKey": "sk-ant-xxx",
    "model": "claude-opus-4-0520",
    "smallFastModel": "claude-haiku-4-5-20251001",
    "defaultSonnetModel": "claude-sonnet-4-6-20260320",
    "defaultOpusModel": "claude-opus-4-0520"
  },
  {
    "id": "minimax",
    "label": "MiniMax",
    "baseUrl": "https://proxy.com/v1",
    "apiKey": "key-xxx",
    "model": "MiniMax-M2.5",
    "smallFastModel": "MiniMax-M2.5",
    "defaultSonnetModel": "MiniMax-M2.5",
    "defaultOpusModel": "MiniMax-M2.5"
  }
]
```

安全要求：API Key 只存在服务端配置文件中，前端 API 不返回 Key。

## 架构

### 后端

1. **API 端点** `GET /api/shell-presets`
   - 读取 `shell-presets.json`
   - 返回 `[{ id, label }]`（不含 apiKey）
   - 文件不存在时返回空数组

2. **WebSocket 消息** `switch-preset`
   - ShellHandler 收到 `{ type: 'switch-preset', presetId: string }`
   - 读取配置文件，查找对应 preset
   - 杀掉当前 PTY 进程
   - 用新环境变量 spawn 新 CLI 进程：
     ```javascript
     env: {
       ...process.env,
       ANTHROPIC_BASE_URL: preset.baseUrl,
       ANTHROPIC_API_KEY: preset.apiKey,
       ANTHROPIC_MODEL: preset.model,
       ANTHROPIC_SMALL_FAST_MODEL: preset.smallFastModel,
       ANTHROPIC_DEFAULT_SONNET_MODEL: preset.defaultSonnetModel,
       ANTHROPIC_DEFAULT_OPUS_MODEL: preset.defaultOpusModel,
     }
     ```
   - 同平台（baseUrl 相同）且有 sessionId 时加 `--resume`

### 前端

1. **Shell 工具栏组件** `ShellPresetBar`
   - 位置：Shell 终端正上方，紧凑单行
   - 内容：Preset 下拉选择 + 切换按钮
   - 配置文件不存在或为空时，工具栏不显示

2. **布局**
   ```
   ┌──────────────────────────────────────┐
   │ [● Claude Opus ▾]  [切换]            │
   ├──────────────────────────────────────┤
   │            Terminal                   │
   └──────────────────────────────────────┘
   ```

### 切换流程

```
用户选择 preset → 点击"切换"
  → 确认提示："切换到 [MiniMax]？当前会话将重启"
  → 前端发送 WS: { type: 'switch-preset', presetId: 'minimax' }
  → 服务端读取配置，杀 PTY，spawn 新进程
  → 终端显示 "[已切换到 MiniMax (MiniMax-M2.5)]"
  → 同平台时尝试 --resume 恢复会话
```

### 异常处理

| 情况 | 行为 |
|------|------|
| 配置文件不存在 | 工具栏不显示，正常启动 CLI |
| preset ID 无效 | 终端显示错误，不杀原进程 |
| 新 CLI 启动失败 | 终端显示错误信息 |
| 切换中断（网络断开）| PTY 已杀但重连后可手动重启 |

## 涉及文件

| 文件 | 改动 |
|------|------|
| `shell-presets.json` | 新增：配置文件 |
| `server/websocket/ShellHandler.js` | 新增：`switch-preset` 消息处理 |
| `server/routes/projects.js` | 新增：`GET /api/shell-presets` 端点 |
| `src/components/shell/types/types.ts` | 新增：`ShellSwitchPresetMessage` 类型 |
| `src/components/standalone-shell/view/StandaloneShell.tsx` | 新增：ShellPresetBar 组件集成 |
| `src/components/standalone-shell/view/ShellPresetBar.tsx` | 新增：工具栏组件 |
| `src/components/standalone-shell/hooks/useShellPresets.ts` | 新增：preset 数据加载 hook |
