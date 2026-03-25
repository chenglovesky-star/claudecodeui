# Shell 会话持久化与自动重连设计

> 本文档替代 `2026-03-24-shell-experience-optimization-design.md` 中 P1.3 会话持久化部分，采用 localStorage 方案以支持浏览器完全关闭后的恢复。

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
key: `shell-active-session-{hashedProjectPath}`
value: JSON.stringify({ sessionId, provider, projectPath, connectedAt })
```

- `hashedProjectPath`: 对 projectPath 做简单哈希处理，避免路径特殊字符问题
- `connectedAt`: 用于判断是否可能超过 30 分钟 PTY 超时窗口，超过则跳过自动重连，直接创建新会话

页面加载时，如果当前项目有持久化的 shell 会话记录：
1. 检查 `connectedAt` 是否在 30 分钟内
2. 是 → 自动用记录中的 sessionId 和 provider 发起重连
3. 否 → 清除记录，走正常新建流程

**清理时机**：
- 用户主动切换会话时更新
- PTY 超时（connectedAt > 30 分钟）时清除
- 重连失败（后端返回新会话而非恢复）时清除

### 改动 2：Shell WebSocket 自动重连

**文件**: `src/components/shell/hooks/useShellConnection.ts`

参考主 WebSocket（`WebSocketContext.tsx`）已有的重连逻辑，在 shell WebSocket 中增加：

- `onclose` 触发自动重连（非用户主动断开时）
- 指数退避策略：1s → 2s → 4s → 8s → 10s（最大 10s），加 ±30% 随机抖动防止重连风暴
- 最多尝试 5 次
- 重连成功后后端自动回放缓冲区
- 添加 `reconnecting` 状态，区别于首次连接
- 监听 `visibilitychange` 和 `online` 事件，标签页重新可见或网络恢复时重置重试计数并触发重连

**使用 ref 防止 stale closure**：用 `reconnectAttemptRef` + `isReconnectingRef` 管理重连状态，避免 `connectWebSocket` 闭包中状态过期。

**不自动重连的情况**：
- 用户主动断开（切换会话、切换项目）— 通过 `intentionalDisconnectRef` 标记
- 主动断开时清除挂起的重连定时器
- 已超过最大重试次数

### 改动 3：重连时先清屏再回放

**文件**: `src/components/shell/hooks/useShellConnection.ts`

- `onclose` 中移除 `clearTerminalScreen()` 调用，保留终端内容供用户查看
- 重连成功后、后端回放缓冲区前，调用 `terminal.clear()` 清屏，然后接收完整回放，避免输出重复

### 改动 4：重连状态 UI

**文件**: `src/components/shell/view/ShellConnectionOverlay.tsx`

新增 `'reconnecting'` 模式：
- 显示旋转动画 + "重连中..."文案
- 显示当前重试次数（如"重连中 2/5"）
- 重连失败后降级显示"连接"按钮

## 涉及文件

| 文件 | 改动内容 |
|------|---------|
| `src/components/shell/hooks/useShellConnection.ts` | 自动重连逻辑 + 调整清屏时机 + visibilitychange/online 监听 |
| `src/components/shell/hooks/useShellRuntime.ts` | 会话信息持久化与恢复 |
| `src/components/shell/view/ShellConnectionOverlay.tsx` | 新增 reconnecting 状态 |
| `src/components/shell/view/Shell.tsx` | 传递 reconnecting 状态到 overlay |

## 用户体验流程

```
浏览器关闭
  → 后端 PTY 继续运行，缓冲输出

浏览器重新打开（30 分钟内）
  → 页面加载，读取 localStorage 中的会话信息
  → 检查 connectedAt 未超时
  → 自动建立 Shell WebSocket
  → 发送 init 消息（含原 sessionId）
  → 后端匹配到已有 PTY，回放缓冲区
  → 用户看到完整历史输出，就像没离开过

网络临时波动
  → WebSocket 断开，终端内容保留
  → 自动重连（指数退避 + 抖动，最多 5 次）
  → 重连成功，清屏后接收完整回放

笔记本合盖再打开
  → visibilitychange 事件触发
  → 重置重试计数，发起新一轮重连
  → 恢复会话
```

## 边界情况

| 场景 | 处理 |
|------|------|
| 超过 30 分钟后重连 | connectedAt 超时检查跳过自动重连，清除旧记录，创建新会话 |
| 输出超过 5000 条 | 中间部分丢失，只回放最近 5000 条（已有限制） |
| 多标签页同项目 | 各标签页共用同一 PTY（与现有行为一致），localStorage 记录的 sessionId 相同不会冲突 |
| 多用户连同一个项目 | sessionId 不同，PTY 隔离（与现有行为一致） |
| PTY 进程已退出但未超时 | 后端创建新会话，前端更新 localStorage 记录 |
| 服务端重启 | ptySessionsMap 清空，后端创建新 PTY，AI CLI 的 `--resume` 仍可恢复 CLI 上下文；plain-shell 模式下旧进程丢失 |
| 短暂断连重连后输出 | 重连成功时先清屏再接收回放，避免重复 |

## 后端改动

无。完全利用现有 PTY 保活和缓冲回放机制。
