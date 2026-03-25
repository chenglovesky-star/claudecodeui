# Shell 会话持久化与自动重连设计

## 背景

团队 10-20 人使用 shell 模式，最大痛点是**浏览器关闭/刷新后任务丢失**。后端 PTY 进程已具备 30 分钟保活和 5000 条消息缓冲回放能力，但前端缺失会话持久化和自动重连，导致用户必须手动重新选择会话。

## 目标

浏览器关闭再打开 → 自动恢复到原来的 shell 会话，看到完整输出，用户无感知。

## 现有机制

### 后端已有（无需改动）

| 能力 | 实现位置 |
|------|---------|
| PTY 进程断连后存活 30 分钟 | `ShellHandler.js` 第 617-635 行 |
| 5000 条消息 FIFO 缓冲区 | `ShellHandler.js` 第 334-339 行 |
| 相同 sessionKey 重连时回放缓冲区 | `ShellHandler.js` 第 147-172 行 |

### 前端缺失

1. **Shell 会话信息未持久化** — 刷新后 `selectedSession` 为 null，不知道该连哪个 PTY
2. **Shell WebSocket 无自动重连** — 断开后需手动点"连接"按钮（主 WebSocket 有自动重连，shell 没有）
3. **断连时清屏** — `onclose` 调用 `clearTerminalScreen()`，丢失终端内容

## 设计方案

### 改动 1：Shell 会话信息持久化

**文件**: `src/components/shell/hooks/useShellRuntime.ts`

Shell 连接成功时，保存当前会话信息到 localStorage：

```
key: `shell-active-session-{projectPath}`
value: JSON.stringify({ sessionId, provider, projectPath, connectedAt })
```

页面加载时，如果当前项目有持久化的 shell 会话记录，自动使用该记录中的 sessionId 和 provider 发起重连。

**清理时机**：
- 用户主动切换会话时更新
- PTY 进程超时（30 分钟无重连）后，下次连接失败时清除

### 改动 2：Shell WebSocket 自动重连

**文件**: `src/components/shell/hooks/useShellConnection.ts`

参考主 WebSocket（`WebSocketContext.tsx`）已有的重连逻辑，在 shell WebSocket 中增加：

- `onclose` 触发自动重连（非用户主动断开时）
- 指数退避策略：1s → 2s → 4s → 8s → 10s（最大 10s）
- 最多尝试 5 次
- 重连成功后后端自动回放缓冲区
- 添加 `reconnecting` 状态，区别于首次连接

**不自动重连的情况**：
- 用户主动断开（切换会话、切换项目）
- 已超过最大重试次数

### 改动 3：去掉断连时清屏

**文件**: `src/components/shell/hooks/useShellConnection.ts`

`socket.onclose` 中移除 `clearTerminalScreen()` 调用。保留最后的终端内容，重连成功后后端回放的输出追加到终端末尾。

### 改动 4：重连状态 UI

**文件**: `src/components/shell/view/ShellConnectionOverlay.tsx`

新增 `'reconnecting'` 模式：
- 显示旋转动画 + "重连中..."文案
- 显示当前重试次数（如"重连中 2/5"）
- 重连失败后降级显示"连接"按钮

## 涉及文件

| 文件 | 改动内容 |
|------|---------|
| `src/components/shell/hooks/useShellConnection.ts` | 自动重连逻辑 + 移除断连清屏 |
| `src/components/shell/hooks/useShellRuntime.ts` | 会话信息持久化与恢复 |
| `src/components/shell/view/ShellConnectionOverlay.tsx` | 新增 reconnecting 状态 |
| `src/components/shell/view/Shell.tsx` | 传递 reconnecting 状态到 overlay |

## 用户体验流程

```
浏览器关闭
  → 后端 PTY 继续运行，缓冲输出

浏览器重新打开（30 分钟内）
  → 页面加载，读取 localStorage 中的会话信息
  → 自动建立 Shell WebSocket
  → 发送 init 消息（含原 sessionId）
  → 后端匹配到已有 PTY，回放缓冲区
  → 用户看到完整历史输出，就像没离开过

网络临时波动
  → WebSocket 断开，终端内容保留
  → 自动重连（指数退避，最多 5 次）
  → 重连成功，输出无缝衔接
```

## 边界情况

| 场景 | 处理 |
|------|------|
| 超过 30 分钟后重连 | 后端 PTY 已销毁，创建新会话，清除旧持久化记录 |
| 输出超过 5000 条 | 中间部分丢失，只回放最近 5000 条（已有限制） |
| 用户在另一个标签页打开同一项目 | 共用同一 PTY 会话（与现有行为一致） |
| 多用户连同一个项目 | sessionId 不同，PTY 隔离（与现有行为一致） |

## 后端改动

无。完全利用现有 PTY 保活和缓冲回放机制。
