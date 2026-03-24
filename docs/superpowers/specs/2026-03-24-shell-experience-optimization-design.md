# Shell 模式体验全面优化设计

> **日期**: 2026-03-24
> **范围**: 15 个体验问题，分 5 层递进修复
> **涉及文件**: useShellConnection.ts, useShellRuntime.ts, useShellTerminal.ts, Shell.tsx, ShellConnectionOverlay.tsx, ShellHandler.js, constants.ts 及新增组件

## 背景

Shell 模式是 Claude Code UI 的核心交互入口，用户全场景重度使用（Claude CLI 开发、普通终端操作、多会话并行）。通过代码深度分析发现 15 个体验问题，按严重程度分为三档，按架构层分 5 阶段递进修复。

## 问题清单

| # | 问题 | 严重度 | 代码位置 |
|---|------|--------|---------|
| 1 | 会话切换无状态缓存 | 严重 | useShellRuntime.ts:143-150 |
| 2 | 网络断连无自动重连 | 严重 | useShellConnection.ts:170-181 |
| 3 | 高频输出无写入节流 | 中度 | useShellConnection.ts:95 |
| 4 | 缺乏会话标签页/快速切换 | 中度 | 项目架构 |
| 5 | 错误状态 UI 缺失 | 中度 | ShellConnectionOverlay.tsx:20-59 |
| 6 | 终端内无搜索功能 | 中度 | 未集成 SearchAddon |
| 7 | 页面刷新丢失会话上下文 | 中度 | useShellRuntime.ts |
| 8 | UI 布局溢出与适配问题 | 中度 | Shell.tsx:252-257 |
| 9 | 复制功能使用过时 API | 中度 | useShellTerminal.ts:135 |
| 10 | 键盘快捷键冲突 | 中度 | useShellTerminal.ts:106-140 |
| 11 | 不支持分割窗格 | 低度 | 项目架构 |
| 12 | 无字体/主题个性化 | 低度 | constants.ts:15-70 |
| 13 | 初始化加载 UI 简陋 | 低度 | ShellConnectionOverlay.tsx:20-25 |
| 14 | 移动端布局未优化 | 低度 | TerminalShortcutsPanel |
| 15 | 可访问性不足 | 低度 | 整个 Shell 组件 |

## 实施策略：分层递进（方案 A）

按架构层从底向上修复，每层是一个独立可交付的 PR：

| 阶段 | 内容 | 问题编号 |
|------|------|---------|
| P1 连接层 | 自动重连 + 错误状态 UI + 会话持久化 | #2, #5, #7 |
| P2 会话管理 | 多会话缓存 + 会话标签页 + 快速切换 | #1, #4 |
| P3 终端性能 | 输出节流 + 搜索功能 + 剪贴板现代化 | #3, #6, #9 |
| P4 UI 打磨 | 布局适配 + 快捷键 + 加载动画 + 主题设置 | #8, #10, #12, #13 |
| P5 高级功能 | 分割窗格 + 移动端 + 可访问性 | #11, #14, #15 |

---

## P1 连接层

### 1.1 自动重连机制 (#2)

**修改文件**: `src/components/shell/hooks/useShellConnection.ts`

**状态机**:

```
CONNECTED → (ws close/error) → RECONNECTING → (retry success) → CONNECTED
                                     ↓ (max retries exceeded)
                                   FAILED → (user click) → RECONNECTING
```

**策略：指数退避 + 抖动**
- 重连间隔序列：`1s → 2s → 4s → 8s → 16s`（共 5 次尝试）
- 每次间隔加入 ±30% 随机抖动，避免多标签页集中重连
- 超过 5 次后进入 FAILED 状态，用户可手动重试
- 仅在非用户主动断开时触发，用 `intentionalDisconnectRef` 区分主动断开（切换会话）和被动断开（网络波动）

**新增状态字段**:

```typescript
reconnectAttempt: number        // 当前重连尝试次数
reconnectCountdown: number      // 距下次重连倒计时（秒）
connectionError: string | null  // 错误信息描述
```

**实现要点**:
- 重连定时器存入 `reconnectTimerRef`，组件卸载时清理
- 重连成功后重置 attempt 计数器
- **重连期间保留终端内容**：`socket.onclose` 中，当 `intentionalDisconnectRef` 为 false 时（被动断连），跳过 `clearTerminalScreen()`，仅在用户主动断开或重连最终失败（FAILED 状态）时才清屏
- **不重放断连期间的用户输入**：断连期间丢弃用户输入（不排队、不重放）。原因：PTY 断连期间状态可能已变化，盲目重放可能执行非预期命令（如破坏性操作）。更安全的做法是仅恢复连接，让用户自行操作
- **服务端重启场景**：如果重连时后端 PTY session 已不存在（服务端重启/部署），`init` 消息会创建新 PTY。此时前端在 overlay 中提示"服务已更新，会话已重置"，区别于正常恢复

### 1.2 错误状态 UI (#5)

**修改文件**: `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx`

扩展 overlay mode 从 3 种到 5 种：

| mode | 触发条件 | UI 表现 |
|------|---------|--------|
| `loading` | 初始化中 | 纯文字（保持不变） |
| `connecting` | 首次连接中 | 连接动画 |
| `connect` | 未连接，等待用户操作 | Connect 按钮 |
| `reconnecting` | **新增** - 自动重连中 | "正在重连... (第 2/5 次，3 秒后重试)" + 进度指示 + 取消按钮 |
| `error` | **新增** - 重连失败 | 具体错误原因 + 重试按钮 + 查看详情折叠区 |

**error mode 展示信息**:
- 错误类型分类：网络不可达 / WebSocket 被拒绝 / PTY 进程退出 / 认证失效
- 建议操作（如"检查网络连接"、"刷新页面重新认证"）

### 1.3 会话持久化 (#7)

**修改文件**: `src/components/shell/hooks/useShellRuntime.ts`

- 切换/连接 session 时将会话状态写入 `sessionStorage`
- 使用 `sessionStorage`（非 localStorage），实现标签页隔离——不同浏览器标签可以有不同的活跃会话
- **前瞻性 schema 设计**（兼容 P2 多会话）：
  ```typescript
  // key: `shell-sessions-${projectPath}`
  interface PersistedShellState {
    activeId: string;           // 当前激活的会话 ID
    sessions: string[];         // 所有打开的会话 ID 列表（P2 时启用）
  }
  ```
  P1 阶段仅使用 `activeId`，`sessions` 字段预留给 P2，避免 schema 迁移
- 页面刷新后从 `sessionStorage` 恢复，自动重连到上次的 shell 会话
- **后端缓冲机制说明**：ShellHandler 在 WebSocket 断连后保持 PTY 进程存活 30 分钟，并维护 5000 条消息的 FIFO 环形缓冲区。前端恢复后回放的是"最近 5000 条输出"而非完整历史。超出 5000 条的早期内容会丢失——这对大多数场景够用，完整历史恢复可作为后续优化

---

## P2 会话管理

### 2.1 多会话状态缓存 (#1)

**新增文件**: `src/components/shell/hooks/useSessionManager.ts`

核心思路：从「单实例切换」变为「多实例池化」。

**SessionManager 数据结构**:

```typescript
interface CachedSession {
  sessionId: string;
  xterm: Terminal;           // 独立的 xterm 实例
  ws: WebSocket | null;      // 独立的 WebSocket 连接
  container: HTMLDivElement;  // 独立的 DOM 容器
  scrollPosition: number;     // 滚动位置记忆
  lastActiveTime: number;     // 最后活跃时间（LRU 用）
}

sessionPool: Map<string, CachedSession>  // 会话池
maxCached: 5                              // 最多缓存 5 个会话
activeId: string                          // 当前激活的会话
evictionPolicy: LRU                       // 淘汰策略
```

**切换流程（从会话 A → B）**:

1. A 的 xterm container → `display: none`（保留 buffer + WS 连接）
2. B 已在池中？→ `display: block`（零延迟切换，滚动位置保留）
3. B 不在池中？→ 新建 xterm + WS 连接（首次访问才建连）
4. 触发 `xterm.fit()`（适配当前容器尺寸）
5. 如果池已满（>5），淘汰 `lastActiveTime` 最小的会话：断开 WS、销毁 xterm、移除 DOM

**架构变更**:
- `Shell.tsx` 不再直接持有单个 xterm，改为渲染 `SessionManager` 管理的容器
- **实现方式：每个 CachedSession 对应一个隐藏的 React 组件实例**（`<ShellSessionInstance>`），各自内部持有 `useShellConnection` 和 `useShellTerminal` hook，保持现有 hook 的 React 生命周期管理不变。这比改写为命令式 class 更兼容现有架构，也能正确处理 React 18 Strict Mode 的双重挂载/卸载
- `useSessionManager` 作为上层协调器，管理 `<ShellSessionInstance>` 的创建/销毁/可见性切换
- `useShellRuntime` 简化为 `useSessionManager` 的薄包装层

**服务端资源限制**:
- 每个浏览器标签页最多 5 个活跃 WebSocket + PTY 连接
- **ShellHandler 增加全局 PTY 上限（10 个）**，超出时拒绝新连接并返回错误消息"已达最大会话数"
- 前端在 SessionManager 中展示此错误，引导用户关闭不需要的会话

### 2.2 会话标签页 (#4)

**新增文件**: `src/components/shell/view/subcomponents/SessionTabBar.tsx`

标签栏位于 Shell 区域顶部，每个标签显示：
- 状态圆点：🟢 运行中（PTY 有活跃进程）/ 🟡 空闲 / ⚫ 断连
- 会话名称（可重命名）
- 快捷键提示（⌘1 ~ ⌘9）
- 关闭按钮（hover 时显示）
- `+` 按钮新建会话

**标签栏右侧**:
- 齿轮图标 → 终端设置（P4 加入）
- 分割按钮 → 分割窗格（P5 加入）

**右键菜单**: 关闭 / 关闭其他 / 关闭右侧全部 / 复制会话名 / 重命名

**拖拽排序**: 标签可拖拽调整顺序，使用原生 drag-and-drop API

### 2.3 快捷键

| 快捷键 | 功能 |
|--------|------|
| `⌘1` ~ `⌘9` | 切换到第 N 个标签 |
| `⌘⇧[` / `⌘⇧]` | 前/后切换标签（与 VS Code 一致，避免与浏览器前进/后退冲突） |
| `⌘⇧T` | 新建会话 |
| `⌘⇧W` | 关闭当前标签 |

注意：使用 `⌘⇧T/W` 而非 `⌘T/W`，避免与浏览器快捷键冲突。

---

## P3 终端性能

### 3.1 高频输出写入节流 (#3)

**修改文件**: `src/components/shell/hooks/useShellConnection.ts`

当前 PTY 每次 `onData` 直接调用 `terminal.write()`。改为批量合并 + rAF 节流：

**流程**:

```
PTY onData → 追加到 pendingBuffer (string[])
                    ↓
            rAF 回调（每帧最多触发一次，~16ms）
                    ↓
            合并 buffer → 单次 terminal.write(joined)
                    ↓
            清空 pendingBuffer
```

**关键细节**:
- 用 `requestAnimationFrame` 而非 `setInterval`，自动适配显示器刷新率
- 合并写入减少 xterm 的 DOM 重排次数
- 超大输出保护：单帧写入上限 64KB，超出部分**保留在 pendingBuffer 中延迟到下一帧写入**（不截断、不丢数据）。这样既实现了节流，又保证终端输出完整性
- rAF handle 存入 ref，组件卸载时 `cancelAnimationFrame`

### 3.2 终端搜索功能 (#6)

**修改文件**: `src/components/shell/hooks/useShellTerminal.ts`
**新增文件**: `src/components/shell/view/subcomponents/TerminalSearchBar.tsx`

**集成方式**:
- `useShellTerminal.ts` 中加载 `@xterm/addon-search` 的 `SearchAddon`
- 通过 ref 暴露 `searchAddon` 给 Shell.tsx

**TerminalSearchBar 组件**:
- 浮动在终端顶部右侧（类似 VS Code 的搜索栏）
- 输入框 + 上一个/下一个 + 匹配计数（如 "3/17"） + 正则开关 + 大小写开关 + 关闭按钮
- `⌘F` / `Ctrl+F` 打开，`Escape` 关闭
- 匹配项高亮使用 xterm decoration API

### 3.3 剪贴板现代化 (#9)

**修改文件**: `src/components/shell/hooks/useShellTerminal.ts`

替换 `document.execCommand('copy')`:

```typescript
async function copySelection(terminal: Terminal) {
  const text = terminal.getSelection();
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    document.execCommand('copy'); // 降级兜底
  }
}
```

**粘贴保护**:
- 多行粘贴（文本含 `\n`）时弹出确认提示："即将粘贴 N 行内容，确认执行？"
- 超过 8KB 的粘贴内容显示警告
- 确认/取消按钮，按 Enter 确认，Escape 取消

---

## P4 UI 打磨

### 4.1 布局适配修复 (#8)

**修改文件**: `src/components/shell/view/subcomponents/TerminalShortcutsPanel.tsx`, `src/components/shell/hooks/useShellTerminal.ts`

**快捷键面板重构**:
- 从 `position: fixed` 侧栏（占 25% 宽度）→ 浮动悬停条（右下角半透明 + backdrop-filter）
- 终端占满容器全宽，不再被面板挤压
- 面板仅在需要时显示（CLI 检测到选项时）

**Resize 黑区修复**:
- `ResizeObserver` 回调包装 `requestAnimationFrame`，确保 `xterm.fit()` 在布局稳定后执行
- 防抖时间调整为 100ms（当前 50ms 太短易抖动，200ms 太长响应滞后），rAF 本身约 16ms，总延迟约 116ms

### 4.2 快捷键冲突解决 (#10)

**修改文件**: `src/components/shell/hooks/useShellTerminal.ts`

| 快捷键 | 解决方案 |
|--------|---------|
| `Ctrl+C` | 有选中文本 → 复制并清除选区；无选中文本 → 发送 SIGINT 到 PTY |
| `⌘F` | 终端聚焦时拦截浏览器行为，打开终端搜索栏 |
| `⌘⇧T` | 新建 shell 会话（避开 `⌘T` 浏览器新标签） |
| `⌘⇧W` | 关闭 shell 会话（避开 `⌘W` 浏览器关标签） |

### 4.3 终端个性化设置 (#12)

**新增文件**: `src/components/shell/view/subcomponents/TerminalSettings.tsx`

入口：Shell 标签栏右侧齿轮图标，点击弹出设置面板。

| 设置项 | 类型 | 默认值 | 范围 |
|--------|------|--------|------|
| 字体大小 | 滑块 | 14px | 10-24px |
| 字体族 | 下拉 | Menlo | Menlo / Monaco / Fira Code / JetBrains Mono / Consolas |
| 配色主题 | 下拉 | One Dark | One Dark / Dracula / Solarized Dark / Nord / Monokai / High Contrast |
| 滚动历史 | 下拉 | 10000 行 | 1000 / 5000 / 10000 / 50000 / 100000（不提供"无限"选项，避免内存溢出） |
| 光标样式 | 下拉 | Block (闪烁) | Block / Underline / Bar × 闪烁开关 |

**持久化**: 设置写入 `localStorage` key `shell-terminal-settings`，启动时读取并应用到 xterm options。

### 4.4 加载动画升级 (#13)

**修改文件**: `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx`

Loading 模式从纯文字 → 三步进度指示器：

```
● 初始化  →  ◐ 连接中  →  ○ 就绪
```

- 旋转动画 spinner + 当前步骤文字
- 步骤圆点：已完成(绿) / 进行中(紫色脉冲) / 待完成(灰)

---

## P5 高级功能

### 5.1 分割窗格 (#11)

**新增文件**: `src/components/shell/view/subcomponents/SplitPaneManager.tsx`

- 标签栏右侧新增「横分」「竖分」按钮
- 点击后将终端区域一分为二，每个窗格绑定独立的会话（从 SessionManager 的池中选取）
- 分隔条可拖拽调整比例（最小 20%，最大 80%）
- 最多支持 2×2 四格布局
- 小屏幕（宽度 < 768px）自动禁用

**数据结构**（使用枚举而非递归，硬性限制布局复杂度）:

```typescript
type SplitLayout =
  | { type: 'single'; sessionId: string }
  | { type: 'horizontal-2'; left: string; right: string; ratio: number }
  | { type: 'vertical-2'; top: string; bottom: string; ratio: number }
  | { type: 'grid-4'; topLeft: string; topRight: string; bottomLeft: string; bottomRight: string; hRatio: number; vRatio: number };
```

**交互路径**：单格 → 点击「横分/竖分」→ 双格 → 对任一格再点击「横分/竖分」→ 四格（grid-4）。四格状态下分割按钮禁用。

### 5.2 移动端适配 (#14)

**修改文件**: Shell.tsx, TerminalShortcutsPanel.tsx, SessionTabBar.tsx

**适配策略**:

| 组件 | 大屏 (≥1024px) | 中屏 (768-1023px) | 小屏 (<768px) |
|------|---------------|-------------------|--------------|
| 标签栏 | 完整显示 | 完整显示 | 水平滚动 |
| 快捷键面板 | 浮动条 | 浮动条 | 底部工具栏 |
| 分割窗格 | 可用 | 可用（限 2 格） | 禁用 |
| 字体大小 | 14px | 13px | 12px |

**底部工具栏（小屏专用）**:
- 固定在终端底部
- 常用特殊键按钮：Tab / Esc / ↑ / ↓ / Ctrl
- 右侧输入框用于快速输入命令

### 5.3 可访问性增强 (#15)

**修改文件**: Shell.tsx, SessionTabBar.tsx, ShellConnectionOverlay.tsx

| 增强项 | 实现方式 |
|--------|---------|
| ARIA 角色 | xterm 容器 `role="application"` + `aria-label="终端"` |
| 标签栏导航 | `role="tablist"` + 每个标签 `role="tab"` + `aria-selected` + 方向键导航 |
| 状态通知 | 连接/断开/错误 通过 `aria-live="assertive"` region 朗读 |
| 高对比度 | 预置 High Contrast 主题 + 响应 `@media (prefers-contrast: high)` |
| 键盘导航 | 所有交互元素可 Tab 聚焦，Enter/Space 激活 |

---

## 新增/修改文件清单

**新增文件**:
- `src/components/shell/hooks/useSessionManager.ts` — 多会话池化管理
- `src/components/shell/view/subcomponents/SessionTabBar.tsx` — 会话标签栏
- `src/components/shell/view/subcomponents/TerminalSearchBar.tsx` — 终端搜索栏
- `src/components/shell/view/subcomponents/TerminalSettings.tsx` — 终端设置面板
- `src/components/shell/view/subcomponents/SplitPaneManager.tsx` — 分割窗格管理

**修改文件**:
- `src/components/shell/hooks/useShellConnection.ts` — 自动重连 + 输出节流
- `src/components/shell/hooks/useShellRuntime.ts` — 会话持久化 + SessionManager 集成
- `src/components/shell/hooks/useShellTerminal.ts` — SearchAddon + 剪贴板 + 快捷键
- `src/components/shell/view/Shell.tsx` — 整体布局重构 + 搜索栏/设置面板集成
- `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx` — 错误/重连状态
- `src/components/shell/view/subcomponents/TerminalShortcutsPanel.tsx` — 浮动条重构
- `src/components/shell/constants/constants.ts` — 新增常量（重连参数、节流阈值等）

## 测试策略

### P1 连接层

**单元测试**:
- 重连状态机：CONNECTED → RECONNECTING → CONNECTED（成功路径）
- 重连状态机：CONNECTED → RECONNECTING → FAILED（5 次失败路径）
- `intentionalDisconnectRef` 为 true 时不触发重连
- 重连过程中用户切换会话，应取消重连并执行主动断开
- sessionStorage 读写正确性，schema 兼容性

**E2E 测试**:
- 模拟网络断开 → 验证 overlay 显示重连进度 → 网络恢复 → 验证终端内容保留
- 刷新页面 → 验证自动恢复到上次会话
- 服务端重启后重连 → 验证提示"服务已更新"

### P2 会话管理

**单元测试**:
- SessionManager：创建/获取/淘汰会话的正确性
- LRU 淘汰：验证最久未用的会话被正确销毁
- 并发操作：同时创建 + 淘汰不导致状态不一致
- 全局 PTY 上限拒绝：超过 10 个时返回错误

**E2E 测试**:
- 快速来回切换 5+ 个会话验证零延迟切换
- 切换后验证 xterm buffer 和滚动位置保留
- 标签栏拖拽排序、右键菜单、快捷键切换

### P3 终端性能

**单元测试**:
- rAF 节流：验证单帧内多次 onData 合并为一次 write
- 64KB 上限：超出部分延迟到下一帧（不丢数据）
- SearchAddon 集成：搜索/高亮/导航正确性

**E2E 测试**:
- 运行 `yes` 或 `cat /dev/urandom` 验证不卡顿
- 粘贴多行内容验证确认弹窗
- ⌘F 打开搜索栏，输入关键词验证匹配

### P4 UI 打磨

**E2E 测试**:
- 快速 resize 窗口 10 次，无黑区出现
- Ctrl+C 有选中 → 复制；无选中 → 发送 SIGINT
- 修改字体大小/主题后刷新，验证设置持久化

### P5 高级功能

**E2E 测试**:
- 分割窗格：单格 → 双格 → 四格 → 关闭窗格回到单格
- Chrome DevTools 设备模拟（375px 宽度）验证移动端布局
- 键盘 Tab 导航标签栏，方向键切换，Enter 激活
