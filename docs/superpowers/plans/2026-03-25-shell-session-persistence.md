# Shell 会话持久化与自动重连 实现计划 (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 浏览器关闭/刷新后自动恢复 shell 会话，利用后端已有的 PTY 保活和缓冲回放机制。

**Architecture:** 前端改动，后端零改动。Shell 连接成功时将会话信息持久化到 localStorage，断连时在 onclose 内直接启动指数退避自动重连（参考 WebSocketContext.tsx 的模式，避免 useCallback 循环依赖），页面加载时读取 localStorage 自动恢复上次会话。

**Tech Stack:** React hooks, localStorage, WebSocket, xterm.js, i18next

**Spec:** `docs/superpowers/specs/2026-03-25-shell-session-persistence-design.md`

---

### Task 1: useShellConnection — 自动重连机制

**Files:**
- Modify: `src/components/shell/hooks/useShellConnection.ts`

核心设计决策：重连逻辑直接内联在 `connectWebSocket` 的 `onclose` 回调中（与 `WebSocketContext.tsx:273-311` 一致），避免 `scheduleReconnect` ↔ `connectWebSocket` 的 useCallback 循环依赖。

- [ ] **Step 1: 更新类型定义和添加新的 refs/state**

更新 `UseShellConnectionResult`（第 30-36 行）：

```typescript
type UseShellConnectionResult = {
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  closeSocket: () => void;
  connectToShell: () => void;
  disconnectFromShell: () => void;
};
```

在函数体开头（第 54-56 行之后）添加：

```typescript
const [isReconnecting, setIsReconnecting] = useState(false);
const [reconnectAttempt, setReconnectAttempt] = useState(0);
const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const intentionalDisconnectRef = useRef(false);
const unmountedRef = useRef(false);

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;
```

- [ ] **Step 2: 添加 unmounted 生命周期管理**

在 autoConnect useEffect（第 223-235 行）之后添加：

```typescript
useEffect(() => {
  unmountedRef.current = false;
  return () => {
    unmountedRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };
}, []);
```

- [ ] **Step 3: 修改 socket.onopen — 重连成功时清屏并重置状态**

将 `socket.onopen`（第 135-163 行）修改为：

```typescript
socket.onopen = () => {
  if (unmountedRef.current) return;

  // 如果是重连，清屏以准备接收后端完整回放
  const wasReconnecting = reconnectTimerRef.current !== null || isReconnecting;
  if (wasReconnecting) {
    terminalRef.current?.clear();
  }

  setIsConnected(true);
  setIsConnecting(false);
  setIsReconnecting(false);
  setReconnectAttempt(0);
  connectingRef.current = false;
  setAuthUrl('');

  // 后续 setTimeout + sendSocketMessage 部分不变
  window.setTimeout(() => {
    // ... 现有代码不变
  }, TERMINAL_INIT_DELAY_MS);
};
```

- [ ] **Step 4: 修改 socket.onclose — 内联重连逻辑**

将第 170-175 行的 `socket.onclose` 替换为（参考 WebSocketContext.tsx:273-311 模式）：

```typescript
socket.onclose = () => {
  if (unmountedRef.current) return;

  setIsConnected(false);
  setIsConnecting(false);
  connectingRef.current = false;
  // 不再调用 clearTerminalScreen()，保留终端内容

  // 主动断开时不重连
  if (intentionalDisconnectRef.current) {
    return;
  }

  // 获取当前重试次数（从 state 读可能不准，用闭包变量）
  setReconnectAttempt((prev) => {
    const attempt = prev;

    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      setIsReconnecting(false);
      return 0; // 重置
    }

    setIsReconnecting(true);

    const baseDelay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
      RECONNECT_MAX_DELAY_MS,
    );
    const jitter = baseDelay * (0.7 + Math.random() * 0.6);

    // 去重：清除已有定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!unmountedRef.current && !intentionalDisconnectRef.current) {
        connectWebSocket(true);
      }
    }, jitter);

    return attempt + 1;
  });
};
```

**关键**：使用 `setReconnectAttempt((prev) => ...)` 的函数式更新，避免 stale closure 读到旧的 attempt 值。同时 `connectWebSocket(true)` 通过 `isConnectionLocked` 参数绕过 guard 条件。

- [ ] **Step 5: 修改 socket.onerror**

将第 177-181 行替换为：

```typescript
socket.onerror = () => {
  // onclose 会在 onerror 之后触发，重连逻辑在 onclose 中处理
  if (unmountedRef.current) return;
  setIsConnected(false);
  setIsConnecting(false);
  connectingRef.current = false;
};
```

- [ ] **Step 6: 修改 connectToShell — 重置主动断开标记 + 清除重连定时器**

将第 204-212 行替换为：

```typescript
const connectToShell = useCallback(() => {
  if (!isInitialized || isConnected || isConnecting || connectingRef.current) {
    return;
  }

  intentionalDisconnectRef.current = false;

  // 清除可能挂起的重连定时器，防止竞态
  if (reconnectTimerRef.current) {
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }
  setReconnectAttempt(0);
  setIsReconnecting(false);

  connectingRef.current = true;
  setIsConnecting(true);
  connectWebSocket(true);
}, [connectWebSocket, isConnected, isConnecting, isInitialized]);
```

- [ ] **Step 7: 修改 disconnectFromShell — 标记主动断开 + 清除定时器**

将第 214-221 行替换为：

```typescript
const disconnectFromShell = useCallback(() => {
  intentionalDisconnectRef.current = true;

  // 清除挂起的重连定时器
  if (reconnectTimerRef.current) {
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }
  setReconnectAttempt(0);
  setIsReconnecting(false);

  closeSocket();
  clearTerminalScreen();
  setIsConnected(false);
  setIsConnecting(false);
  connectingRef.current = false;
  setAuthUrl('');
}, [clearTerminalScreen, closeSocket, setAuthUrl]);
```

- [ ] **Step 8: 添加 visibilitychange 和 online 事件监听**

在 unmounted effect 之后添加：

```typescript
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    if (intentionalDisconnectRef.current) return;
    if (!isInitialized) return;

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // 重置重试计数，发起新一轮重连
      setReconnectAttempt(0);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      connectingRef.current = false;
      setIsConnecting(false);
      connectWebSocket(true);
    }
  };

  const handleOnline = () => {
    if (intentionalDisconnectRef.current) return;
    if (!isInitialized) return;

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setReconnectAttempt(0);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      connectingRef.current = false;
      setIsConnecting(false);
      connectWebSocket(true);
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('online', handleOnline);
  };
}, [connectWebSocket, isInitialized, wsRef]);
```

- [ ] **Step 9: 从 connectWebSocket 依赖数组中移除 clearTerminalScreen**

`clearTerminalScreen` 不再在 `onclose` 中调用，从依赖数组（第 188-201 行）中移除。保留的依赖：

```typescript
[
  fitAddonRef,
  handleSocketMessage,
  initialCommandRef,
  isConnected,
  isConnecting,
  isPlainShellRef,
  isReconnecting,
  selectedProjectRef,
  selectedSessionRef,
  setAuthUrl,
  terminalRef,
  wsRef,
],
```

- [ ] **Step 10: 更新返回值**

```typescript
return {
  isConnected,
  isConnecting,
  isReconnecting,
  reconnectAttempt,
  closeSocket,
  connectToShell,
  disconnectFromShell,
};
```

- [ ] **Step 11: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 12: 提交**

```bash
git add src/components/shell/hooks/useShellConnection.ts
git commit -m "feat: add shell auto-reconnect with exponential backoff"
```

---

### Task 2: 类型定义更新

**Files:**
- Modify: `src/components/shell/types/types.ts:81-94`

- [ ] **Step 1: 更新 UseShellRuntimeResult 类型**

在 `UseShellRuntimeResult`（第 81-94 行）中添加两个字段：

```typescript
export type UseShellRuntimeResult = {
  terminalContainerRef: RefObject<HTMLDivElement>;
  terminalRef: MutableRefObject<Terminal | null>;
  wsRef: MutableRefObject<WebSocket | null>;
  isConnected: boolean;
  isInitialized: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  authUrl: string;
  authUrlVersion: number;
  connectToShell: () => void;
  disconnectFromShell: () => void;
  openAuthUrlInBrowser: (url?: string) => boolean;
  copyAuthUrlToClipboard: (url?: string) => Promise<boolean>;
};
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/components/shell/types/types.ts
git commit -m "feat: add reconnection fields to UseShellRuntimeResult type"
```

---

### Task 3: useShellRuntime — 透传重连状态 + 会话持久化 + 会话恢复

**Files:**
- Modify: `src/components/shell/hooks/useShellRuntime.ts`

- [ ] **Step 1: 添加 simpleHash 工具函数**

在文件顶部 import 之后添加：

```typescript
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

const PTY_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes，与后端一致
```

- [ ] **Step 2: 透传 isReconnecting 和 reconnectAttempt**

从 `useShellConnection` 解构中（第 108 行）增加字段：

```typescript
const { isConnected, isConnecting, isReconnecting, reconnectAttempt, connectToShell, disconnectFromShell } = useShellConnection({
  // ... 参数不变
});
```

返回对象（第 152 行）中添加：

```typescript
return {
  // ... 现有字段
  isReconnecting,
  reconnectAttempt,
};
```

- [ ] **Step 3: 添加会话持久化逻辑（写入）**

在 `useShellConnection` 调用之后添加：

```typescript
// 连接成功时持久化 shell 会话信息
useEffect(() => {
  if (!isConnected || !selectedProject) {
    return;
  }

  const projectPath = selectedProject.fullPath || selectedProject.path || '';
  const key = `shell-active-session-${simpleHash(projectPath)}`;
  const value = JSON.stringify({
    sessionId: selectedSession?.id || null,
    provider: selectedSession?.__provider || localStorage.getItem('selected-provider') || 'claude',
    projectPath,
    connectedAt: Date.now(),
  });

  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable or full
  }
}, [isConnected, selectedProject, selectedSession]);
```

- [ ] **Step 4: 添加会话恢复逻辑（读取）— 核心功能**

在持久化 effect 之后添加。此逻辑在终端初始化完成后、没有活跃连接时，读取 localStorage 自动恢复：

```typescript
// 页面加载时自动恢复上次的 shell 会话
useEffect(() => {
  if (!isInitialized || isConnected || isConnecting || !selectedProject || !autoConnect) {
    return;
  }

  const projectPath = selectedProject.fullPath || selectedProject.path || '';
  const key = `shell-active-session-${simpleHash(projectPath)}`;

  try {
    const stored = localStorage.getItem(key);
    if (!stored) return;

    const { connectedAt } = JSON.parse(stored);
    const elapsed = Date.now() - connectedAt;

    if (elapsed > PTY_SESSION_TIMEOUT_MS) {
      // 超过 30 分钟，PTY 已销毁，清除旧记录
      localStorage.removeItem(key);
      return;
    }

    // 在 30 分钟内，自动重连（connectToShell 会通过 refs 读取当前 project/session）
    connectToShell();
  } catch {
    // JSON parse error or localStorage unavailable
  }
}, [isInitialized, isConnected, isConnecting, selectedProject, autoConnect, connectToShell]);
```

**注意**：此 effect 依赖 `autoConnect`。`Shell.tsx` 中默认 `autoConnect={false}`，但 `StandaloneShell` 传 `autoConnect={true}`。需要确保恢复逻辑只在 `autoConnect=true` 时触发，否则非自动连接模式也会自动恢复。

- [ ] **Step 5: 清理持久化记录（重启和项目切换时）**

修改 isRestarting effect（第 125-132 行），添加 localStorage 清理：

```typescript
useEffect(() => {
  if (!isRestarting) {
    return;
  }

  if (selectedProject) {
    const projectPath = selectedProject.fullPath || selectedProject.path || '';
    try {
      localStorage.removeItem(`shell-active-session-${simpleHash(projectPath)}`);
    } catch {}
  }

  disconnectFromShell();
  disposeTerminal();
}, [disconnectFromShell, disposeTerminal, isRestarting, selectedProject]);
```

修改 selectedProject 为空的 effect（第 134-141 行），添加清理：

```typescript
useEffect(() => {
  if (selectedProject) {
    return;
  }

  // project 被取消选择，无法精确清除 key，交给 connectToShell 时重写
  disconnectFromShell();
  disposeTerminal();
}, [disconnectFromShell, disposeTerminal, selectedProject]);
```

修改会话切换 effect（第 143-150 行），会话变化时更新持久化记录：

```typescript
useEffect(() => {
  const currentSessionId = selectedSession?.id ?? null;
  if (lastSessionIdRef.current !== currentSessionId && isInitialized) {
    // 会话切换，断开旧连接（新连接建立后会自动更新 localStorage）
    disconnectFromShell();
  }

  lastSessionIdRef.current = currentSessionId;
}, [disconnectFromShell, isInitialized, selectedSession?.id]);
```

- [ ] **Step 6: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add src/components/shell/hooks/useShellRuntime.ts
git commit -m "feat: persist and restore shell session from localStorage"
```

---

### Task 4: ShellConnectionOverlay — 重连状态 UI

**Files:**
- Modify: `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx`

- [ ] **Step 1: 更新类型和添加 reconnecting 模式**

完整替换文件内容：

```typescript
type ShellConnectionOverlayProps = {
  mode: 'loading' | 'connect' | 'connecting' | 'reconnecting';
  description: string;
  loadingLabel: string;
  connectLabel: string;
  connectTitle: string;
  connectingLabel: string;
  reconnectingLabel: string;
  onConnect: () => void;
};

export default function ShellConnectionOverlay({
  mode,
  description,
  loadingLabel,
  connectLabel,
  connectTitle,
  connectingLabel,
  reconnectingLabel,
  onConnect,
}: ShellConnectionOverlayProps) {
  if (mode === 'loading') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90">
        <div className="text-white">{loadingLabel}</div>
      </div>
    );
  }

  if (mode === 'connect') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
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

  if (mode === 'reconnecting') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="flex items-center justify-center space-x-3 text-blue-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
            <span className="text-base font-medium">{reconnectingLabel}</span>
          </div>
          <p className="mt-3 px-2 text-sm text-gray-400">{description}</p>
        </div>
      </div>
    );
  }

  // mode === 'connecting'
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center space-x-3 text-yellow-400">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent"></div>
          <span className="text-base font-medium">{connectingLabel}</span>
        </div>
        <p className="mt-3 px-2 text-sm text-gray-400">{description}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx
git commit -m "feat: add reconnecting state to shell connection overlay"
```

---

### Task 5: Shell.tsx — 集成重连状态到 UI

**Files:**
- Modify: `src/components/shell/view/Shell.tsx`

- [ ] **Step 1: 从 useShellRuntime 解构新字段**

在第 56-79 行的解构中添加：

```typescript
const {
  terminalContainerRef,
  terminalRef,
  wsRef,
  isConnected,
  isInitialized,
  isConnecting,
  isReconnecting,
  reconnectAttempt,
  authUrl,
  authUrlVersion,
  connectToShell,
  disconnectFromShell,
  openAuthUrlInBrowser,
  copyAuthUrlToClipboard,
} = useShellRuntime({ /* ... 参数不变 */ });
```

- [ ] **Step 2: 更新 overlayMode 逻辑**

将第 229 行替换为：

```typescript
const overlayMode = !isInitialized
  ? 'loading'
  : isReconnecting
    ? 'reconnecting'
    : isConnecting
      ? 'connecting'
      : !isConnected
        ? 'connect'
        : null;
```

- [ ] **Step 3: 添加重连描述文案并更新 overlayDescription**

在 `connectingDescription` 之后添加：

```typescript
const reconnectingDescription = t('shell.reconnecting', {
  attempt: reconnectAttempt,
  max: 5,
  defaultValue: 'Reconnecting... ({{attempt}}/{{max}})',
});
```

更新 `overlayDescription`：

```typescript
const overlayDescription = overlayMode === 'reconnecting'
  ? reconnectingDescription
  : overlayMode === 'connecting'
    ? connectingDescription
    : readyDescription;
```

- [ ] **Step 4: 传递 reconnectingLabel 到 ShellConnectionOverlay**

更新 `<ShellConnectionOverlay>` 调用（第 260-268 行）：

```typescript
<ShellConnectionOverlay
  mode={overlayMode}
  description={overlayDescription}
  loadingLabel={t('shell.loading')}
  connectLabel={t('shell.actions.connect')}
  connectTitle={t('shell.actions.connectTitle')}
  connectingLabel={t('shell.connecting')}
  reconnectingLabel={t('shell.reconnectingLabel', { defaultValue: 'Reconnecting...' })}
  onConnect={connectToShell}
/>
```

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/components/shell/view/Shell.tsx
git commit -m "feat: integrate reconnecting state into shell UI"
```

---

### Task 6: i18n 翻译

**Files:**
- Modify: `src/i18n/locales/en/chat.json`
- Modify: `src/i18n/locales/zh-CN/chat.json`
- Modify: `src/i18n/locales/ja/chat.json`
- Modify: `src/i18n/locales/ko/chat.json`

- [ ] **Step 1: 英文翻译**

在 `shell` 对象（第 244 行 `"defaultCommand": "command"` 之后）添加：

```json
"reconnecting": "Reconnecting... ({{attempt}}/{{max}})",
"reconnectingLabel": "Reconnecting..."
```

- [ ] **Step 2: 中文翻译**

```json
"reconnecting": "重连中... ({{attempt}}/{{max}})",
"reconnectingLabel": "重连中..."
```

- [ ] **Step 3: 日文翻译**

```json
"reconnecting": "再接続中... ({{attempt}}/{{max}})",
"reconnectingLabel": "再接続中..."
```

- [ ] **Step 4: 韩文翻译**

```json
"reconnecting": "재연결 중... ({{attempt}}/{{max}})",
"reconnectingLabel": "재연결 중..."
```

- [ ] **Step 5: 提交**

```bash
git add src/i18n/locales/
git commit -m "feat: add shell reconnection i18n translations"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 2: ESLint 检查**

Run: `npx eslint src/components/shell/ --ext .ts,.tsx`
Expected: 无错误

- [ ] **Step 3: 手动测试场景清单**

1. 打开项目，连接 shell，执行命令
2. 刷新浏览器 → 应自动重连并看到之前的输出
3. 断开网络 → 应看到"重连中 (1/5)"提示
4. 恢复网络 → 应自动重连
5. 点击"断开" → 不应自动重连
6. 关闭浏览器，30 分钟内重新打开 → 应自动恢复会话
7. 等待超过 30 分钟后打开 → 应创建新会话，不尝试恢复
8. 重连 5 次都失败 → 应降级显示"连接"按钮
9. 切换会话 → 旧连接断开，新连接建立，localStorage 更新
