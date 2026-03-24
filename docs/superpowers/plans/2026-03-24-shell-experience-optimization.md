# Shell 模式体验全面优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Shell 模式的 15 个体验问题，从连接层到高级功能分 5 层递进交付。

**Architecture:** 分层递进（P1→P5），每层是一个独立可交付的 PR。底层（连接）先行，上层（UI/高级功能）依赖底层。每个 CachedSession 对应一个隐藏的 React 组件实例，保持现有 hook 的生命周期管理。

**Tech Stack:** React 18 + TypeScript, xterm.js 5.5.0 (WebGL), node-pty, WebSocket (ws), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-24-shell-experience-optimization-design.md`

---

## File Structure

### P1 连接层
| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `src/components/shell/hooks/useShellConnection.ts` | 自动重连状态机 + intentionalDisconnect |
| Modify | `src/components/shell/hooks/useShellRuntime.ts` | sessionStorage 持久化 |
| Modify | `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx` | reconnecting + error 模式 |
| Modify | `src/components/shell/view/Shell.tsx` | 新 overlay 模式接线 |
| Modify | `src/components/shell/constants/constants.ts` | 重连常量 |

### P2 会话管理
| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `src/components/shell/hooks/useSessionManager.ts` | 多会话池化管理（LRU） |
| Create | `src/components/shell/view/subcomponents/ShellSessionInstance.tsx` | 单会话 React 实例 |
| Create | `src/components/shell/view/subcomponents/SessionTabBar.tsx` | 标签栏 UI |
| Modify | `src/components/shell/view/Shell.tsx` | 集成 SessionManager + TabBar |
| Modify | `server/websocket/ShellHandler.js` | 全局 PTY 上限 |
| Modify | `server/config/constants.js` | PTY 上限常量 |

### P3 终端性能
| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `src/components/shell/hooks/useShellConnection.ts` | rAF 写入节流 |
| Modify | `src/components/shell/hooks/useShellTerminal.ts` | SearchAddon + 剪贴板 |
| Create | `src/components/shell/view/subcomponents/TerminalSearchBar.tsx` | 搜索栏 UI |
| Create | `src/components/shell/view/subcomponents/PasteConfirmDialog.tsx` | 多行粘贴确认 |
| Modify | `src/components/shell/view/Shell.tsx` | 搜索栏集成 |

### P4 UI 打磨
| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `src/components/shell/view/subcomponents/TerminalShortcutsPanel.tsx` | 浮动条重构 |
| Modify | `src/components/shell/hooks/useShellTerminal.ts` | 快捷键冲突修复 + resize 优化 |
| Modify | `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx` | 加载动画升级 |
| Create | `src/components/shell/view/subcomponents/TerminalSettings.tsx` | 终端设置面板 |
| Create | `src/components/shell/constants/themes.ts` | 主题预设定义 |
| Modify | `src/components/shell/constants/constants.ts` | resize 防抖调整 |

### P5 高级功能
| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `src/components/shell/view/subcomponents/SplitPaneManager.tsx` | 分割窗格管理 |
| Create | `src/components/shell/view/subcomponents/MobileToolbar.tsx` | 移动端底部工具栏 |
| Modify | `src/components/shell/view/Shell.tsx` | 分割窗格 + 移动端 + a11y 集成 |
| Modify | `src/components/shell/view/subcomponents/SessionTabBar.tsx` | a11y + 移动端水平滚动 |

---

## P1: 连接层

### Task 1: 重连常量 + intentionalDisconnect 基础设施

**Files:**
- Modify: `src/components/shell/constants/constants.ts`
- Modify: `src/components/shell/hooks/useShellConnection.ts:38-56`

- [ ] **Step 1: 在 constants.ts 中添加重连常量**

在文件末尾追加：

```typescript
// Auto-reconnect
export const RECONNECT_MAX_ATTEMPTS = 5;
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_JITTER_FACTOR = 0.3;

// Output throttling (P3)
export const OUTPUT_FRAME_MAX_BYTES = 64 * 1024;
```

- [ ] **Step 2: 在 useShellConnection 中添加重连状态和 intentionalDisconnectRef**

在 `useShellConnection` 函数体顶部（现有 `useState` 声明之后，约第 56 行后）添加：

```typescript
const [reconnectAttempt, setReconnectAttempt] = useState(0);
const [reconnectCountdown, setReconnectCountdown] = useState(0);
const [connectionError, setConnectionError] = useState<string | null>(null);
const intentionalDisconnectRef = useRef(false);
const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
// 用 ref 跟踪当前重连次数，避免 onclose 闭包中读到 stale state
const reconnectAttemptRef = useRef(0);
```

- [ ] **Step 3: 更新 UseShellConnectionResult 类型导出新状态**

```typescript
type UseShellConnectionResult = {
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  reconnectCountdown: number;
  connectionError: string | null;
  closeSocket: () => void;
  connectToShell: () => void;
  disconnectFromShell: () => void;
  cancelReconnect: () => void;
};
```

- [ ] **Step 4: 验证项目编译通过**

Run: `cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui && npx tsc --noEmit 2>&1 | head -30`
Expected: 类型错误（因为 return 还没更新），确认新增代码语法正确

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/constants/constants.ts src/components/shell/hooks/useShellConnection.ts
git commit -m "feat(shell): add reconnect constants and state infrastructure"
```

---

### Task 2: 自动重连状态机核心逻辑

**Files:**
- Modify: `src/components/shell/hooks/useShellConnection.ts:170-187`

- [ ] **Step 1: 实现 clearReconnectTimers 清理函数**

在 `handleSocketMessage` 之后添加：

```typescript
const clearReconnectTimers = useCallback(() => {
  if (reconnectTimerRef.current) {
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }
  if (countdownTimerRef.current) {
    clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = null;
  }
}, []);
```

- [ ] **Step 2: 实现 scheduleReconnect 重连调度函数**

```typescript
const scheduleReconnect = useCallback(
  (attempt: number) => {
    if (attempt >= RECONNECT_MAX_ATTEMPTS) {
      setConnectionError('已达最大重连次数');
      setReconnectAttempt(0);
      setReconnectCountdown(0);
      return;
    }

    const baseDelay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = baseDelay * RECONNECT_JITTER_FACTOR * (Math.random() * 2 - 1);
    const delay = Math.round(baseDelay + jitter);
    const delaySec = Math.ceil(delay / 1000);

    reconnectAttemptRef.current = attempt + 1;
    setReconnectAttempt(attempt + 1);
    setReconnectCountdown(delaySec);
    setConnectionError(null);

    countdownTimerRef.current = setInterval(() => {
      setReconnectCountdown((prev) => {
        if (prev <= 1) {
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    reconnectTimerRef.current = setTimeout(() => {
      connectWebSocket(true);
    }, delay);
  },
  [connectWebSocket],
);
```

- [ ] **Step 3: 实现 cancelReconnect 取消重连**

```typescript
const cancelReconnect = useCallback(() => {
  clearReconnectTimers();
  setReconnectAttempt(0);
  setReconnectCountdown(0);
  setConnectionError(null);
}, [clearReconnectTimers]);
```

- [ ] **Step 4: 修改 socket.onclose 逻辑——被动断连时不清屏 + 触发重连**

将现有 `socket.onclose`（第 170-175 行）替换为：

```typescript
socket.onclose = () => {
  setIsConnected(false);
  setIsConnecting(false);
  connectingRef.current = false;

  if (intentionalDisconnectRef.current) {
    // 用户主动断开：清屏，不重连
    clearTerminalScreen();
    intentionalDisconnectRef.current = false;
  } else {
    // 被动断连：保留终端内容，触发自动重连
    // 使用 ref 而非 state 避免 stale closure
    scheduleReconnect(reconnectAttemptRef.current);
  }
};
```

- [ ] **Step 5: 修改 socket.onerror 同理**

```typescript
socket.onerror = () => {
  setIsConnected(false);
  setIsConnecting(false);
  connectingRef.current = false;
  if (!intentionalDisconnectRef.current) {
    scheduleReconnect(reconnectAttempt);
  }
};
```

- [ ] **Step 6: 修改 socket.onopen 重置重连状态**

在现有 `socket.onopen` 回调头部（第 136 行之后）追加：

```typescript
clearReconnectTimers();
setReconnectAttempt(0);
setReconnectCountdown(0);
setConnectionError(null);
```

- [ ] **Step 7: 修改 disconnectFromShell 设置 intentional 标记**

将现有 `disconnectFromShell`（第 214-221 行）改为：

```typescript
const disconnectFromShell = useCallback(() => {
  intentionalDisconnectRef.current = true;
  clearReconnectTimers();
  closeSocket();
  clearTerminalScreen();
  setIsConnected(false);
  setIsConnecting(false);
  connectingRef.current = false;
  setAuthUrl('');
  setReconnectAttempt(0);
  setReconnectCountdown(0);
  setConnectionError(null);
}, [clearReconnectTimers, clearTerminalScreen, closeSocket, setAuthUrl]);
```

- [ ] **Step 8: 添加组件卸载清理 useEffect**

```typescript
useEffect(() => {
  return () => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  };
}, []);
```

- [ ] **Step 9: 更新 return 语句**

```typescript
return {
  isConnected,
  isConnecting,
  isReconnecting: reconnectAttempt > 0 && !isConnected,
  reconnectAttempt,
  reconnectCountdown,
  connectionError,
  closeSocket,
  connectToShell,
  disconnectFromShell,
  cancelReconnect,
};
```

- [ ] **Step 10: 验证编译通过**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 11: Commit**

```bash
git add src/components/shell/hooks/useShellConnection.ts
git commit -m "feat(shell): implement auto-reconnect state machine with exponential backoff"
```

---

### Task 3: 扩展 ShellConnectionOverlay — reconnecting + error 模式

**Files:**
- Modify: `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx`

- [ ] **Step 1: 扩展组件 props 类型和新增模式**

将整个文件替换为：

```typescript
type ShellConnectionOverlayProps = {
  mode: 'loading' | 'connect' | 'connecting' | 'reconnecting' | 'error';
  description: string;
  loadingLabel: string;
  connectLabel: string;
  connectTitle: string;
  connectingLabel: string;
  onConnect: () => void;
  // 新增 props
  reconnectAttempt?: number;
  reconnectMaxAttempts?: number;
  reconnectCountdown?: number;
  connectionError?: string | null;
  onCancelReconnect?: () => void;
  onRetry?: () => void;
};

export default function ShellConnectionOverlay({
  mode,
  description,
  loadingLabel,
  connectLabel,
  connectTitle,
  connectingLabel,
  onConnect,
  reconnectAttempt = 0,
  reconnectMaxAttempts = 5,
  reconnectCountdown = 0,
  connectionError = null,
  onCancelReconnect,
  onRetry,
}: ShellConnectionOverlayProps) {
  if (mode === 'loading') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <StepDot status="done" />
            <span className="text-xs text-green-400">初始化</span>
            <StepDot status="active" />
            <span className="text-xs text-gray-400">连接中</span>
            <StepDot status="pending" />
            <span className="text-xs text-gray-500">就绪</span>
          </div>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <div className="text-sm text-white">{loadingLabel}</div>
        </div>
      </div>
    );
  }

  if (mode === 'reconnecting') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm">
        <div className="w-full max-w-xs text-center">
          <div className="flex items-center justify-center gap-3 text-yellow-400">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
            <span className="text-sm font-medium">
              正在重连... ({reconnectAttempt}/{reconnectMaxAttempts})
            </span>
          </div>
          {reconnectCountdown > 0 && (
            <p className="mt-2 text-xs text-gray-400">
              {reconnectCountdown} 秒后重试
            </p>
          )}
          <button
            onClick={onCancelReconnect}
            className="mt-3 rounded bg-gray-700 px-4 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'error') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-3 flex items-center justify-center gap-2 text-red-400">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-sm font-medium">连接失败</span>
          </div>
          {connectionError && (
            <p className="mb-3 text-xs text-gray-400">{connectionError}</p>
          )}
          <button
            onClick={onRetry || onConnect}
            className="rounded bg-green-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'connect') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 p-4">
        <div className="w-full max-w-sm text-center">
          <button
            onClick={onConnect}
            className="flex w-full items-center justify-center space-x-2 rounded-lg bg-green-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-green-700 sm:w-auto"
            title={connectTitle}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>{connectLabel}</span>
          </button>
          <p className="mt-3 px-2 text-sm text-gray-400">{description}</p>
        </div>
      </div>
    );
  }

  // mode === 'connecting'
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 p-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center space-x-3 text-yellow-400">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
          <span className="text-base font-medium">{connectingLabel}</span>
        </div>
        <p className="mt-3 px-2 text-sm text-gray-400">{description}</p>
      </div>
    </div>
  );
}

function StepDot({ status }: { status: 'done' | 'active' | 'pending' }) {
  if (status === 'done') return <span className="h-2 w-2 rounded-full bg-green-400" />;
  if (status === 'active') return <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />;
  return <span className="h-2 w-2 rounded-full bg-gray-600" />;
}
```

- [ ] **Step 2: 更新 Shell.tsx 中的 overlay 模式计算 + 传入新 props**

在 Shell.tsx 中，修改 `overlayMode` 计算（约第 229 行）：

```typescript
const overlayMode = !isInitialized
  ? 'loading'
  : isConnecting
    ? 'connecting'
    : isReconnecting
      ? 'reconnecting'
      : connectionError
        ? 'error'
        : !isConnected
          ? 'connect'
          : null;
```

更新 `<ShellConnectionOverlay>` 调用，添加新 props：

```tsx
{overlayMode && (
  <ShellConnectionOverlay
    mode={overlayMode}
    description={overlayDescription}
    loadingLabel={t('shell.loading')}
    connectLabel={t('shell.actions.connect')}
    connectTitle={t('shell.actions.connectTitle')}
    connectingLabel={t('shell.connecting')}
    onConnect={connectToShell}
    reconnectAttempt={reconnectAttempt}
    reconnectMaxAttempts={5}
    reconnectCountdown={reconnectCountdown}
    connectionError={connectionError}
    onCancelReconnect={cancelReconnect}
    onRetry={connectToShell}
  />
)}
```

- [ ] **Step 3: 更新 types.ts 中的 UseShellRuntimeResult 类型**

在 `src/components/shell/types/types.ts` 中，找到 `UseShellRuntimeResult` 类型定义（约第 81 行），添加新字段：

```typescript
// 在 UseShellRuntimeResult 中追加：
isReconnecting: boolean;
reconnectAttempt: number;
reconnectCountdown: number;
connectionError: string | null;
cancelReconnect: () => void;
```

- [ ] **Step 4: 更新 useShellRuntime 透传新状态**

在 `useShellRuntime.ts` 中，从 `useShellConnection` 解构新字段并在 return 中透传：

```typescript
const {
  isConnected, isConnecting, connectToShell, disconnectFromShell,
  isReconnecting, reconnectAttempt, reconnectCountdown, connectionError, cancelReconnect,
} = useShellConnection({ ... });

// return 中添加：
return {
  ...existingFields,
  isReconnecting,
  reconnectAttempt,
  reconnectCountdown,
  connectionError,
  cancelReconnect,
};
```

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx src/components/shell/view/Shell.tsx src/components/shell/hooks/useShellRuntime.ts
git commit -m "feat(shell): add reconnecting and error overlay modes with progress UI"
```

---

### Task 4: 会话持久化 (sessionStorage)

**Files:**
- Modify: `src/components/shell/hooks/useShellRuntime.ts`

- [ ] **Step 1: 添加 sessionStorage 读写工具函数**

在 `useShellRuntime.ts` 文件顶部（import 之后）添加：

```typescript
interface PersistedShellState {
  activeId: string;
  sessions: string[]; // 预留给 P2
}

function getPersistedState(projectPath: string): PersistedShellState | null {
  try {
    const raw = sessionStorage.getItem(`shell-sessions-${projectPath}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setPersistedState(projectPath: string, state: PersistedShellState): void {
  try {
    sessionStorage.setItem(`shell-sessions-${projectPath}`, JSON.stringify(state));
  } catch {
    // sessionStorage full or disabled — silently ignore
  }
}
```

- [ ] **Step 2: 在连接成功时写入 sessionStorage**

在 `useShellRuntime` 中，添加 effect 监听 `isConnected` 和 `selectedSession`：

```typescript
useEffect(() => {
  const projectPath = selectedProject?.fullPath || selectedProject?.path || '';
  const sessionId = selectedSession?.id;
  if (isConnected && projectPath && sessionId) {
    setPersistedState(projectPath, { activeId: sessionId, sessions: [sessionId] });
  }
}, [isConnected, selectedProject, selectedSession]);
```

- [ ] **Step 3: 导出 getPersistedState 供外部使用（如 MainContent.tsx 恢复会话）**

在文件末尾添加：

```typescript
export { getPersistedState };
```

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/hooks/useShellRuntime.ts
git commit -m "feat(shell): persist active session to sessionStorage for refresh recovery"
```

---

## P2: 会话管理

### Task 5: ShellSessionInstance 组件

**Files:**
- Create: `src/components/shell/view/subcomponents/ShellSessionInstance.tsx`

- [ ] **Step 1: 创建 ShellSessionInstance 组件**

这个组件封装单个会话的 xterm + WebSocket 生命周期，从现有 `Shell.tsx` 中提取核心逻辑：

```typescript
import { useRef, useCallback, useEffect, useState } from 'react';
import type { Project, ProjectSession } from '../../../../types/app';
import { useShellRuntime } from '../../hooks/useShellRuntime';
import { sendSocketMessage } from '../../utils/socket';
import ShellConnectionOverlay from './ShellConnectionOverlay';
import {
  PROMPT_BUFFER_SCAN_LINES,
  PROMPT_DEBOUNCE_MS,
  PROMPT_MAX_OPTIONS,
  PROMPT_MIN_OPTIONS,
  PROMPT_OPTION_SCAN_LINES,
} from '../../constants/constants';

type CliPromptOption = { number: string; label: string };

type ShellSessionInstanceProps = {
  sessionId: string;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  isVisible: boolean;
  isPlainShell?: boolean;
  initialCommand?: string | null;
  onStatusChange?: (sessionId: string, status: 'running' | 'idle' | 'disconnected') => void;
  onRuntimeReady?: (wsRef: React.MutableRefObject<WebSocket | null>, terminalRef: React.MutableRefObject<import('@xterm/xterm').Terminal | null>) => void;
};

export default function ShellSessionInstance({
  sessionId,
  selectedProject,
  selectedSession,
  isVisible,
  isPlainShell = false,
  initialCommand = null,
  onStatusChange,
  onRuntimeReady,
}: ShellSessionInstanceProps) {
  const [cliPromptOptions, setCliPromptOptions] = useState<CliPromptOption[] | null>(null);
  const promptCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onOutputRef = useRef<(() => void) | null>(null);

  const {
    terminalContainerRef,
    terminalRef,
    wsRef,
    isConnected,
    isInitialized,
    isConnecting,
    isReconnecting,
    reconnectAttempt,
    reconnectCountdown,
    connectionError,
    connectToShell,
    disconnectFromShell,
    cancelReconnect,
  } = useShellRuntime({
    selectedProject,
    selectedSession,
    initialCommand,
    isPlainShell,
    minimal: false,
    autoConnect: isVisible, // 只在可见时自动连接
    isRestarting: false,
    onProcessComplete: null,
    onOutputRef,
  });

  // 通知父组件状态变化
  useEffect(() => {
    const status = isConnected ? 'running' : isReconnecting ? 'idle' : 'disconnected';
    onStatusChange?.(sessionId, status);
  }, [isConnected, isReconnecting, sessionId, onStatusChange]);

  // fit terminal when becoming visible
  useEffect(() => {
    if (isVisible && terminalRef.current) {
      // trigger resize to fit container
      window.dispatchEvent(new Event('resize'));
    }
  }, [isVisible, terminalRef]);

  // CLI prompt detection (从 Shell.tsx 复用)
  const checkBufferForPrompt = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    const buf = term.buffer.active;
    const lastContentRow = buf.baseY + buf.cursorY;
    const scanEnd = Math.min(buf.baseY + buf.length - 1, lastContentRow + 10);
    const scanStart = Math.max(0, lastContentRow - PROMPT_BUFFER_SCAN_LINES);
    const lines: string[] = [];
    for (let i = scanStart; i <= scanEnd; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString().trimEnd());
    }

    let footerIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/esc to cancel/i.test(lines[i]) || /enter to select/i.test(lines[i])) {
        footerIdx = i;
        break;
      }
    }

    if (footerIdx === -1) { setCliPromptOptions(null); return; }

    const optMap = new Map<string, string>();
    const optScanStart = Math.max(0, footerIdx - PROMPT_OPTION_SCAN_LINES);
    for (let i = footerIdx - 1; i >= optScanStart; i--) {
      const match = lines[i].match(/^\s*[❯›>]?\s*(\d+)\.\s+(.+)/);
      if (match) {
        const num = match[1];
        const label = match[2].trim();
        if (parseInt(num, 10) <= PROMPT_MAX_OPTIONS && label.length > 0 && !optMap.has(num)) {
          optMap.set(num, label);
        }
      }
    }

    const valid: CliPromptOption[] = [];
    for (let i = 1; i <= optMap.size; i++) {
      if (optMap.has(String(i))) valid.push({ number: String(i), label: optMap.get(String(i))! });
      else break;
    }
    setCliPromptOptions(valid.length >= PROMPT_MIN_OPTIONS ? valid : null);
  }, [terminalRef]);

  useEffect(() => {
    onOutputRef.current = () => {
      if (promptCheckTimer.current) clearTimeout(promptCheckTimer.current);
      promptCheckTimer.current = setTimeout(checkBufferForPrompt, PROMPT_DEBOUNCE_MS);
    };
  }, [checkBufferForPrompt]);

  useEffect(() => () => {
    if (promptCheckTimer.current) clearTimeout(promptCheckTimer.current);
  }, []);

  const sendInput = useCallback((data: string) => {
    sendSocketMessage(wsRef.current, { type: 'input', data });
  }, [wsRef]);

  const overlayMode = !isInitialized
    ? 'loading'
    : isConnecting
      ? 'connecting'
      : isReconnecting
        ? 'reconnecting'
        : connectionError
          ? 'error'
          : !isConnected
            ? 'connect'
            : null;

  return (
    <div
      className={`h-full w-full ${isVisible ? '' : 'hidden'}`}
      data-session-id={sessionId}
    >
      <div className="relative h-full w-full overflow-hidden p-2">
        <div
          ref={terminalContainerRef}
          className="h-full w-full focus:outline-none"
          style={{ outline: 'none' }}
        />

        {overlayMode && (
          <ShellConnectionOverlay
            mode={overlayMode}
            description=""
            loadingLabel="Loading..."
            connectLabel="Connect"
            connectTitle="Connect to shell"
            connectingLabel="Connecting..."
            onConnect={connectToShell}
            reconnectAttempt={reconnectAttempt}
            reconnectCountdown={reconnectCountdown}
            connectionError={connectionError}
            onCancelReconnect={cancelReconnect}
            onRetry={connectToShell}
          />
        )}

        {cliPromptOptions && isConnected && isVisible && (
          <div className="absolute inset-x-0 bottom-0 z-10 border-t border-gray-700/80 bg-gray-800/95 px-3 py-2 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2">
              {cliPromptOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.number}
                  onClick={() => { sendInput(opt.number); setCliPromptOptions(null); }}
                  className="max-w-36 truncate rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                >
                  {opt.number}. {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { sendInput('\x1b'); setCliPromptOptions(null); }}
                className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600"
              >
                Esc
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/view/subcomponents/ShellSessionInstance.tsx
git commit -m "feat(shell): create ShellSessionInstance component for multi-session pooling"
```

---

### Task 6: useSessionManager hook

**Files:**
- Create: `src/components/shell/hooks/useSessionManager.ts`

- [ ] **Step 1: 实现 SessionManager hook**

```typescript
import { useCallback, useRef, useState } from 'react';

const MAX_CACHED_SESSIONS = 5;

export interface SessionEntry {
  sessionId: string;
  lastActiveTime: number;
  status: 'running' | 'idle' | 'disconnected';
}

export function useSessionManager() {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const orderRef = useRef<string[]>([]);

  const getOrCreateSession = useCallback((sessionId: string): { isNew: boolean; evictedId: string | null } => {
    let evictedId: string | null = null;
    let isNew = false;

    setSessions((prev) => {
      const existing = prev.find((s) => s.sessionId === sessionId);
      if (existing) {
        return prev.map((s) =>
          s.sessionId === sessionId ? { ...s, lastActiveTime: Date.now() } : s,
        );
      }

      // 标记为新会话（在 updater 内部设置，避免 stale state 读取）
      isNew = true;

      // Need to create new session
      let next = [...prev, { sessionId, lastActiveTime: Date.now(), status: 'disconnected' as const }];

      // LRU eviction if over limit
      if (next.length > MAX_CACHED_SESSIONS) {
        const sorted = [...next].sort((a, b) => a.lastActiveTime - b.lastActiveTime);
        evictedId = sorted[0].sessionId;
        next = next.filter((s) => s.sessionId !== evictedId);
      }

      return next;
    });

    // Update tab order
    if (!orderRef.current.includes(sessionId)) {
      orderRef.current = [...orderRef.current, sessionId];
    }

    return { isNew, evictedId };
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    getOrCreateSession(sessionId);
    setActiveSessionId(sessionId);
  }, [getOrCreateSession]);

  const closeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    orderRef.current = orderRef.current.filter((id) => id !== sessionId);

    setActiveSessionId((prev) => {
      if (prev !== sessionId) return prev;
      // Switch to the next available session
      const remaining = orderRef.current;
      return remaining.length > 0 ? remaining[remaining.length - 1] : null;
    });
  }, []);

  const updateStatus = useCallback((sessionId: string, status: SessionEntry['status']) => {
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, status } : s)),
    );
  }, []);

  const reorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    const next = [...orderRef.current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    orderRef.current = next;
    setSessions((prev) => [...prev]); // trigger re-render
  }, []);

  return {
    sessions,
    activeSessionId,
    tabOrder: orderRef.current,
    switchSession,
    closeSession,
    updateStatus,
    reorderSessions,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/shell/hooks/useSessionManager.ts
git commit -m "feat(shell): implement useSessionManager with LRU eviction"
```

---

### Task 7: SessionTabBar 组件

**Files:**
- Create: `src/components/shell/view/subcomponents/SessionTabBar.tsx`

- [ ] **Step 1: 创建标签栏组件**

```typescript
import { useCallback, useState, useRef } from 'react';
import { Plus } from 'lucide-react';
import type { SessionEntry } from '../../hooks/useSessionManager';

type SessionTabBarProps = {
  sessions: SessionEntry[];
  activeSessionId: string | null;
  tabOrder: string[];
  onSwitch: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onNewSession: () => void;
  onReorder: (from: number, to: number) => void;
};

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-400',
  idle: 'bg-yellow-400',
  disconnected: 'bg-gray-500',
};

export default function SessionTabBar({
  sessions,
  activeSessionId,
  tabOrder,
  onSwitch,
  onClose,
  onNewSession,
  onReorder,
}: SessionTabBarProps) {
  const dragIndexRef = useRef<number | null>(null);

  const orderedSessions = tabOrder
    .map((id) => sessions.find((s) => s.sessionId === id))
    .filter(Boolean) as SessionEntry[];

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
      onReorder(dragIndexRef.current, index);
      dragIndexRef.current = index;
    }
  }, [onReorder]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const isMac = navigator.platform.includes('Mac');
    const mod = isMac ? e.metaKey : e.ctrlKey;

    // ⌘1-9 switch tabs
    if (mod && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key, 10) - 1;
      if (idx < orderedSessions.length) {
        onSwitch(orderedSessions[idx].sessionId);
      }
      return;
    }

    // ⌘⇧[ / ⌘⇧] prev/next
    if (mod && e.shiftKey && (e.key === '[' || e.key === ']')) {
      e.preventDefault();
      const currentIdx = orderedSessions.findIndex((s) => s.sessionId === activeSessionId);
      if (currentIdx === -1) return;
      const nextIdx = e.key === '['
        ? (currentIdx - 1 + orderedSessions.length) % orderedSessions.length
        : (currentIdx + 1) % orderedSessions.length;
      onSwitch(orderedSessions[nextIdx].sessionId);
      return;
    }

    // ⌘⇧T new session
    if (mod && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      onNewSession();
      return;
    }

    // ⌘⇧W close session
    if (mod && e.shiftKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (activeSessionId) onClose(activeSessionId);
    }
  }, [activeSessionId, onClose, onNewSession, onSwitch, orderedSessions]);

  return (
    <div
      className="flex items-center gap-0.5 overflow-x-auto border-b border-gray-700 bg-[#252526] px-2"
      style={{ height: 36 }}
      role="tablist"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {orderedSessions.map((session, index) => {
        const isActive = session.sessionId === activeSessionId;
        return (
          <div
            key={session.sessionId}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onClick={() => onSwitch(session.sessionId)}
            className={`group flex cursor-pointer items-center gap-1.5 rounded-t px-3 py-1.5 text-xs transition-colors ${
              isActive
                ? 'border border-b-0 border-gray-600 bg-[#1e1e1e] text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${STATUS_COLORS[session.status] || 'bg-gray-500'}`} />
            <span className="max-w-[120px] truncate">
              {session.sessionId.slice(0, 12)}
            </span>
            <span className="ml-1 text-[10px] text-gray-600">
              ⌘{index + 1 <= 9 ? index + 1 : ''}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(session.sessionId); }}
              className="ml-0.5 hidden rounded p-0.5 text-gray-600 hover:bg-white/10 hover:text-gray-300 group-hover:block"
              aria-label={`Close ${session.sessionId}`}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        onClick={onNewSession}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-gray-600 hover:bg-white/10 hover:text-gray-300"
        aria-label="New session"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/shell/view/subcomponents/SessionTabBar.tsx
git commit -m "feat(shell): create SessionTabBar with drag-and-drop and keyboard shortcuts"
```

---

### Task 8: 集成 SessionManager 到 Shell.tsx + 全局 PTY 上限

**Files:**
- Modify: `src/components/shell/view/Shell.tsx`
- Modify: `server/websocket/ShellHandler.js`
- Modify: `server/config/constants.js`

- [ ] **Step 1: 在 server/config/constants.js 添加 PTY 上限常量**

```javascript
// ========== Shell PTY 资源限制 ==========
export const PTY_MAX_GLOBAL_SESSIONS = 10;      // 全局最大 PTY 会话数
```

- [ ] **Step 2: 在 ShellHandler.js 添加连接数检查**

在 ShellHandler 的 WebSocket `message` 事件处理器中，`case 'init'` 分支的开头（`const existingSession = ...` 行之前，约第 147 行），添加 PTY 数量检查：

```javascript
// 在文件顶部 import 中添加：
import { PTY_MAX_GLOBAL_SESSIONS } from '../config/constants.js';

// 在 case 'init' 分支开头：
if (this.ptySessionsMap.size >= PTY_MAX_GLOBAL_SESSIONS) {
  ws.send(JSON.stringify({ type: 'error', message: '已达最大会话数限制，请关闭不需要的会话' }));
  return;
}
```

- [ ] **Step 3a: Shell.tsx — 移除直接的 useShellRuntime 调用**

在 Shell.tsx 中，将 `useShellRuntime` 调用（第 69-79 行）替换为 `useSessionManager`。注意：当 `isPlainShell` 或 `minimal` 为 true 时，保留原有的单会话代码路径（直接使用 `useShellRuntime`），不走 SessionManager。

```typescript
import { useSessionManager } from '../hooks/useSessionManager';
import ShellSessionInstance from './subcomponents/ShellSessionInstance';
import SessionTabBar from './subcomponents/SessionTabBar';

// 在 Shell 组件内部：
const isMultiSessionMode = !isPlainShell && !minimal;
const sessionManager = isMultiSessionMode ? useSessionManager() : null;
```

- [ ] **Step 3b: Shell.tsx — 替换终端容器为 ShellSessionInstance 映射渲染**

替换原来的 `<div ref={terminalContainerRef}>` 和相关 overlay 代码为：

```tsx
{isMultiSessionMode && sessionManager && (
  <>
    <SessionTabBar
      sessions={sessionManager.sessions}
      activeSessionId={sessionManager.activeSessionId}
      tabOrder={sessionManager.tabOrder}
      onSwitch={sessionManager.switchSession}
      onClose={sessionManager.closeSession}
      onNewSession={() => { /* 通过侧边栏创建新会话后调用 switchSession */ }}
      onReorder={sessionManager.reorderSessions}
    />
    <div className="relative flex-1 overflow-hidden">
      {sessionManager.tabOrder.map((sid) => (
        <ShellSessionInstance
          key={sid}
          sessionId={sid}
          selectedProject={selectedProject!}
          selectedSession={selectedSession}
          isVisible={sid === sessionManager.activeSessionId}
          onStatusChange={sessionManager.updateStatus}
        />
      ))}
    </div>
  </>
)}
```

- [ ] **Step 3c: Shell.tsx — 保留 isPlainShell/minimal 的单会话回退路径**

在 `isMultiSessionMode` 为 false 时，保留原有的完整渲染逻辑（useShellRuntime + 单个 terminalContainerRef + overlay + TerminalShortcutsPanel）。

- [ ] **Step 3d: Shell.tsx — 将 TerminalShortcutsPanel 连接到活跃会话**

在多会话模式下，TerminalShortcutsPanel 需要接收活跃会话的 `wsRef` 和 `terminalRef`。通过在 `ShellSessionInstance` 中暴露 ref 回调来获取。在 `ShellSessionInstance` props 中新增 `onRuntimeReady?: (wsRef, terminalRef) => void`，当 `isVisible` 为 true 时回调通知 Shell.tsx。

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/view/Shell.tsx server/websocket/ShellHandler.js server/config/constants.js
git commit -m "feat(shell): integrate SessionManager with tab bar and global PTY limit"
```

---

## P3: 终端性能

### Task 9: rAF 输出写入节流

**Files:**
- Modify: `src/components/shell/hooks/useShellConnection.ts:84-108`

- [ ] **Step 1: 在 useShellConnection 中添加写入缓冲基础设施**

在 `connectingRef` 声明之后添加：

```typescript
const pendingBufferRef = useRef<string[]>([]);
const rafHandleRef = useRef<number | null>(null);
const pendingBytesRef = useRef(0);
```

- [ ] **Step 2: 实现 flushBuffer 函数**

```typescript
const flushBuffer = useCallback(() => {
  rafHandleRef.current = null;
  const terminal = terminalRef.current;
  if (!terminal || pendingBufferRef.current.length === 0) return;

  let totalBytes = 0;
  const toWrite: string[] = [];
  const remaining: string[] = [];
  let exceededLimit = false;

  for (const chunk of pendingBufferRef.current) {
    if (exceededLimit) {
      remaining.push(chunk);
      continue;
    }
    totalBytes += chunk.length;
    if (totalBytes > OUTPUT_FRAME_MAX_BYTES) {
      exceededLimit = true;
      remaining.push(chunk);
    } else {
      toWrite.push(chunk);
    }
  }

  if (toWrite.length > 0) {
    terminal.write(toWrite.join(''));
  }

  pendingBufferRef.current = remaining;
  pendingBytesRef.current = remaining.reduce((sum, c) => sum + c.length, 0);

  // 如果还有剩余，安排下一帧继续
  if (remaining.length > 0) {
    rafHandleRef.current = requestAnimationFrame(flushBuffer);
  }
}, [terminalRef]);
```

- [ ] **Step 3: 修改 handleSocketMessage 中的 output 处理**

将第 94-96 行：

```typescript
terminalRef.current?.write(output);
```

替换为：

```typescript
pendingBufferRef.current.push(output);
pendingBytesRef.current += output.length;
if (rafHandleRef.current === null) {
  rafHandleRef.current = requestAnimationFrame(flushBuffer);
}
```

- [ ] **Step 4: 在组件卸载清理中取消 rAF**

在现有的清理 useEffect 中添加：

```typescript
if (rafHandleRef.current !== null) {
  cancelAnimationFrame(rafHandleRef.current);
}
```

- [ ] **Step 5: 验证编译通过**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/hooks/useShellConnection.ts
git commit -m "feat(shell): add rAF output throttling with 64KB per-frame limit"
```

---

### Task 10: 终端搜索功能 (SearchAddon)

**Files:**
- Modify: `src/components/shell/hooks/useShellTerminal.ts`
- Create: `src/components/shell/view/subcomponents/TerminalSearchBar.tsx`
- Modify: `src/components/shell/view/Shell.tsx`

- [ ] **Step 1: 安装 @xterm/addon-search**

Run: `npm install @xterm/addon-search`

- [ ] **Step 2: 在 useShellTerminal.ts 中加载 SearchAddon**

在 Terminal 初始化代码（约第 86-102 行）中，WebGL addon 加载之后添加：

```typescript
import { SearchAddon } from '@xterm/addon-search';

// 在 Terminal 初始化 useEffect 中：
const nextSearchAddon = new SearchAddon();
nextTerminal.loadAddon(nextSearchAddon);
```

在 hook 中添加 `searchAddonRef` 并通过 return 暴露。

- [ ] **Step 3: 创建 TerminalSearchBar.tsx**

浮动在终端顶部右侧的搜索栏组件，接收 `searchAddon` ref，实现搜索/导航/计数/正则/大小写开关。

- [ ] **Step 4: 在 Shell.tsx 中集成搜索栏**

添加 `showSearch` 状态，`⌘F` 打开，`Escape` 关闭。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shell): integrate xterm SearchAddon with floating search bar"
```

---

### Task 11: 剪贴板现代化 + 粘贴保护

**Files:**
- Modify: `src/components/shell/hooks/useShellTerminal.ts:127-137`
- Create: `src/components/shell/view/subcomponents/PasteConfirmDialog.tsx`

- [ ] **Step 1: 替换 document.execCommand('copy')**

将 `useShellTerminal.ts` 第 133-136 行：

```typescript
event.preventDefault();
event.stopPropagation();
document.execCommand('copy');
return false;
```

替换为：

```typescript
event.preventDefault();
event.stopPropagation();
const selection = nextTerminal.getSelection();
if (navigator.clipboard?.writeText) {
  void navigator.clipboard.writeText(selection);
} else {
  document.execCommand('copy');
}
nextTerminal.clearSelection();
return false;
```

- [ ] **Step 2: 创建 PasteConfirmDialog.tsx**

多行粘贴确认弹窗组件。

- [ ] **Step 3: 修改 handlePaste 添加多行粘贴保护**

在 `useShellTerminal.ts` 的 `handlePaste` 函数中，文本粘贴部分添加多行检测逻辑，通过回调通知 Shell.tsx 显示确认弹窗。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(shell): modernize clipboard API and add multi-line paste confirmation"
```

---

## P4: UI 打磨

### Task 12: TerminalShortcutsPanel 浮动条重构

**Files:**
- Modify: `src/components/shell/view/subcomponents/TerminalShortcutsPanel.tsx`

- [ ] **Step 1: 重写为浮动悬停条**

将整个 `TerminalShortcutsPanel.tsx` 从 fixed 侧栏改为右下角半透明浮动条。只保留快捷键按钮，去掉全屏侧栏和 backdrop。

关键样式变化：
- 从 `fixed right-0 top-0 h-full w-64` → `absolute right-2 bottom-2 rounded-lg bg-gray-800/90 backdrop-blur-sm`
- 按钮横排显示，紧凑布局
- 去掉 toggle 展开/收起逻辑，始终显示

- [ ] **Step 2: Commit**

```bash
git add src/components/shell/view/subcomponents/TerminalShortcutsPanel.tsx
git commit -m "refactor(shell): convert TerminalShortcutsPanel from sidebar to floating bar"
```

---

### Task 13: Resize 防抖优化 + 快捷键冲突修复

**Files:**
- Modify: `src/components/shell/hooks/useShellTerminal.ts`
- Modify: `src/components/shell/constants/constants.ts`

- [ ] **Step 1: 将 TERMINAL_RESIZE_DELAY_MS 从 50 改为 100**

```typescript
export const TERMINAL_RESIZE_DELAY_MS = 100;
```

- [ ] **Step 2: 在 ResizeObserver 回调中包装 rAF**

```typescript
resizeTimeoutRef.current = window.setTimeout(() => {
  requestAnimationFrame(() => {
    const currentFitAddon = fitAddonRef.current;
    const currentTerminal = terminalRef.current;
    if (!currentFitAddon || !currentTerminal) return;
    currentFitAddon.fit();
    sendSocketMessage(wsRef.current, {
      type: 'resize',
      cols: currentTerminal.cols,
      rows: currentTerminal.rows,
    });
  });
}, TERMINAL_RESIZE_DELAY_MS);
```

- [ ] **Step 3: 修复 Ctrl+C 行为**

在 `attachCustomKeyEventHandler` 中，Ctrl+C 复制逻辑之后添加清除选区：

```typescript
if (nextTerminal.hasSelection()) {
  // 复制并清除选区
  ...
  nextTerminal.clearSelection();
  return false;
}
// 无选中时正常发送 Ctrl+C (SIGINT) — return true 让 xterm 处理
return true;
```

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/hooks/useShellTerminal.ts src/components/shell/constants/constants.ts
git commit -m "fix(shell): optimize resize debounce and resolve Ctrl+C keyboard conflict"
```

---

### Task 14: 终端设置面板 + 主题预设

**Files:**
- Create: `src/components/shell/constants/themes.ts`
- Create: `src/components/shell/view/subcomponents/TerminalSettings.tsx`

- [ ] **Step 1: 创建 themes.ts 主题预设**

定义 6 套主题（One Dark, Dracula, Solarized Dark, Nord, Monokai, High Contrast），每套包含完整的 xterm ITheme 对象。

- [ ] **Step 2: 创建 TerminalSettings.tsx**

设置面板组件：字体大小滑块、字体族下拉、配色主题下拉、滚动历史下拉、光标样式下拉。读写 localStorage `shell-terminal-settings`。

- [ ] **Step 3: 在 SessionTabBar 右侧添加齿轮图标入口**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(shell): add terminal settings panel with theme presets and font customization"
```

---

### Task 15: 加载动画升级

**Files:**
- Modify: `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx`

已在 Task 3 中完成（loading 模式已包含三步进度指示器）。如果 Task 3 未包含，在此补充。

- [ ] **Step 1: 验证 loading 模式包含 StepDot 进度指示**
- [ ] **Step 2: Commit（如有改动）**

---

## P5: 高级功能

### Task 16: 分割窗格

**Files:**
- Create: `src/components/shell/view/subcomponents/SplitPaneManager.tsx`

- [ ] **Step 1: 实现 SplitLayout 类型和 SplitPaneManager 组件**

使用 spec 中定义的扁平枚举 `SplitLayout` 类型。组件管理窗格分割/合并/拖拽分隔条。

- [ ] **Step 2: 在 Shell.tsx 中集成分割窗格**

标签栏右侧添加横分/竖分按钮，小屏（<768px）自动禁用。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(shell): add split pane support with draggable dividers"
```

---

### Task 17: 移动端适配

**Files:**
- Create: `src/components/shell/view/subcomponents/MobileToolbar.tsx`
- Modify: `src/components/shell/view/subcomponents/SessionTabBar.tsx`

- [ ] **Step 1: 创建 MobileToolbar 底部工具栏**

小屏专用组件：Tab / Esc / ↑ / ↓ / Ctrl 按钮 + 命令输入框。

- [ ] **Step 2: SessionTabBar 添加移动端水平滚动**

小屏下隐藏快捷键提示，标签栏 `overflow-x-auto` + `scrollbar-hide`。

- [ ] **Step 3: 在 Shell.tsx 中按屏幕宽度条件渲染**

使用 `window.matchMedia('(max-width: 768px)')` 切换浮动条/底部工具栏。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(shell): add mobile toolbar and responsive layout adaptation"
```

---

### Task 18: 可访问性增强

**Files:**
- Modify: `src/components/shell/view/Shell.tsx`
- Modify: `src/components/shell/view/subcomponents/SessionTabBar.tsx`
- Modify: `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx`

- [ ] **Step 1: xterm 容器添加 ARIA 属性**

```tsx
<div
  ref={terminalContainerRef}
  className="h-full w-full focus:outline-none"
  role="application"
  aria-label="终端"
/>
```

- [ ] **Step 2: SessionTabBar 添加完整 ARIA 支持**

已在 Task 7 中添加 `role="tablist"` 和 `role="tab"` + `aria-selected`。补充方向键导航。

- [ ] **Step 3: 添加 aria-live region 用于状态通知**

在 Shell.tsx 中添加隐藏的 aria-live region：

```tsx
<div aria-live="assertive" className="sr-only">
  {isReconnecting && `正在重连，第 ${reconnectAttempt} 次`}
  {connectionError && `连接失败: ${connectionError}`}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(shell): enhance accessibility with ARIA roles and live regions"
```

---

## Summary

| Task | Phase | Description | Estimated Steps |
|------|-------|-------------|-----------------|
| 1 | P1 | 重连常量 + 基础设施 | 5 |
| 2 | P1 | 自动重连状态机 | 11 |
| 3 | P1 | 错误/重连 Overlay + Shell 接线 | 5 |
| 4 | P1 | 会话持久化 | 5 |
| 5 | P2 | ShellSessionInstance | 3 |
| 6 | P2 | useSessionManager | 2 |
| 7 | P2 | SessionTabBar | 2 |
| 8 | P2 | Shell.tsx 集成 + PTY 上限 | 5 |
| 9 | P3 | rAF 输出节流 | 6 |
| 10 | P3 | 终端搜索 (SearchAddon) | 5 |
| 11 | P3 | 剪贴板 + 粘贴保护 | 4 |
| 12 | P4 | 浮动快捷键条 | 2 |
| 13 | P4 | Resize + Ctrl+C 修复 | 4 |
| 14 | P4 | 终端设置 + 主题 | 4 |
| 15 | P4 | 加载动画 | 2 |
| 16 | P5 | 分割窗格 | 3 |
| 17 | P5 | 移动端适配 | 4 |
| 18 | P5 | 可访问性 | 4 |
