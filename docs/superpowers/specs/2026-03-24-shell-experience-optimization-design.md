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
- 重连期间用户输入排队，连接恢复后自动重放（可选，需评估风险）

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

- 切换/连接 session 时将 `{ projectPath, sessionId }` 写入 `sessionStorage`
- 使用 `sessionStorage`（非 localStorage），实现标签页隔离——不同浏览器标签可以有不同的活跃会话
- 页面刷新后从 `sessionStorage` 恢复，自动重连到上次的 shell 会话
- 后端 ShellHandler 已有 30 分钟 PTY 缓冲机制，前端恢复后无缝对接
- key 格式：`shell-active-session-${projectPath}`

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
- `useShellConnection` 和 `useShellTerminal` 的逻辑下沉到每个 `CachedSession` 内部
- `useShellRuntime` 变为 `SessionManager` 的上层协调器

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
| `⌘[` / `⌘]` | 前/后切换标签 |
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
- 超大输出保护：单帧写入超过 64KB 时截断并追加 `[...output truncated]`
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
- 添加 200ms 防抖，避免快速连续调整时的抖动

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
| 滚动历史 | 下拉 | 10000 行 | 1000 / 5000 / 10000 / 50000 / 无限 |
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

**数据结构**:

```typescript
interface SplitLayout {
  direction: 'horizontal' | 'vertical';
  children: (SplitLayout | { sessionId: string })[];
  ratio: number; // 0-1，第一个子元素的占比
}
```

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

每个阶段交付时需验证：
- P1：模拟网络断开后自动重连恢复、刷新后会话恢复
- P2：快速来回切换 5+ 个会话验证零延迟、LRU 淘汰正确
- P3：运行 `yes` 或 `cat /dev/urandom` 验证节流不卡顿、搜索功能正确
- P4：快速 resize 窗口无黑区、Ctrl+C 复制/中断行为正确
- P5：分割窗格拖拽调整、移动端模拟器验证布局
