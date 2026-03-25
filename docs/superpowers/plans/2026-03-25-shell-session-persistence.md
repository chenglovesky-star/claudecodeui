# Shell 会话持久化与自动重连 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 浏览器关闭/刷新后自动恢复 shell 会话，利用后端已有的 PTY 保活和缓冲回放机制。

**Architecture:** 前端 3 个 hook/组件改动 + i18n 翻译。Shell 连接成功时将会话信息持久化到 localStorage，断连时启动指数退避自动重连，页面加载时自动恢复上次会话。后端零改动。

**Tech Stack:** React hooks, localStorage, WebSocket, xterm.js, i18next

**Spec:** `docs/superpowers/specs/2026-03-25-shell-session-persistence-design.md`

---

### Task 1: useShellConnection — 自动重连机制

**Files:**
- Modify: `src/components/shell/hooks/useShellConnection.ts`

- [ ] **Step 1: 添加重连相关的 refs 和状态**

在 `useShellConnection` 函数体开头（第 54 行之后）添加：

```typescript
const [isReconnecting, setIsReconnecting] = useState(false);
const reconnectAttemptRef = useRef(0);
const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const intentionalDisconnectRef = useRef(false);
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;
```

更新返回类型 `UseShellConnectionResult`（第 30-36 行）增加 `isReconnecting: boolean`。

- [ ] **Step 2: 添加重连调度函数**

在 `connectWebSocket` 定义之前添加：

```typescript
const scheduleReconnect = useCallback(() => {
  if (intentionalDisconnectRef.current || reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
    setIsReconnecting(false);
    reconnectAttemptRef.current = 0;
    return;
  }

  const attempt = reconnectAttemptRef.current;
  const baseDelay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt), RECONNECT_MAX_DELAY_MS);
  const jitter = baseDelay * (0.7 + Math.random() * 0.6); // ±30%

  reconnectAttemptRef.current = attempt + 1;
  setIsReconnecting(true);

  reconnectTimerRef.current = setTimeout(() => {
    reconnectTimerRef.current = null;
    connectWebSocket(true);
  }, jitter);
}, [connectWebSocket]);
```

- [ ] **Step 3: 修改 socket.onopen 重置重连状态**

在 `socket.onopen`（第 135-163 行）的回调开头，`setIsConnected(true)` 之后添加：

```typescript
setIsReconnecting(false);
reconnectAttemptRef.current = 0;
```

并在 `sendSocketMessage` 调用前，添加重连时清屏（让后端回放替代旧内容）：

```typescript
if (reconnectAttemptRef.current > 0 || isReconnecting) {
  terminalRef.current?.clear();
}
```

注意：由于 `reconnectAttemptRef.current` 已在上面重置为 0，需要在重置前检查。调整顺序：先检查是否是重连，清屏，再重置计数器。

```typescript
socket.onopen = () => {
  // 如果是重连，先清屏以准备接收完整回放
  if (reconnectAttemptRef.current > 0) {
    terminalRef.current?.clear();
  }

  setIsConnected(true);
  setIsConnecting(false);
  setIsReconnecting(false);
  connectingRef.current = false;
  reconnectAttemptRef.current = 0;
  setAuthUrl('');
  // ... 后续 setTimeout 和 sendSocketMessage 不变
};
```

- [ ] **Step 4: 修改 socket.onclose 触发自动重连**

将第 170-175 行的 `socket.onclose` 替换为：

```typescript
socket.onclose = () => {
  setIsConnected(false);
  setIsConnecting(false);
  connectingRef.current = false;
  // 不再调用 clearTerminalScreen()，保留终端内容

  if (!intentionalDisconnectRef.current) {
    scheduleReconnect();
  }
};
```

- [ ] **Step 5: 修改 disconnectFromShell 标记主动断开**

将第 214-221 行替换为：

```typescript
const disconnectFromShell = useCallback(() => {
  intentionalDisconnectRef.current = true;

  // 清除挂起的重连定时器
  if (reconnectTimerRef.current) {
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }
  reconnectAttemptRef.current = 0;
  setIsReconnecting(false);

  closeSocket();
  clearTerminalScreen();
  setIsConnected(false);
  setIsConnecting(false);
  connectingRef.current = false;
  setAuthUrl('');
}, [clearTerminalScreen, closeSocket, setAuthUrl]);
```

- [ ] **Step 6: 修改 connectToShell 重置主动断开标记**

在 `connectToShell`（第 204-212 行）回调开头添加：

```typescript
intentionalDisconnectRef.current = false;
```

- [ ] **Step 7: 添加 visibilitychange 和 online 事件监听**

在 autoConnect useEffect（第 223-235 行）之后添加：

```typescript
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !isConnected && !isConnecting && !intentionalDisconnectRef.current && isInitialized) {
      reconnectAttemptRef.current = 0;
      scheduleReconnect();
    }
  };

  const handleOnline = () => {
    if (!isConnected && !isConnecting && !intentionalDisconnectRef.current && isInitialized) {
      reconnectAttemptRef.current = 0;
      scheduleReconnect();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('online', handleOnline);
  };
}, [isConnected, isConnecting, isInitialized, scheduleReconnect]);
```

- [ ] **Step 8: 清理重连定时器**

在 visibilitychange effect 之后添加：

```typescript
useEffect(() => {
  return () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
  };
}, []);
```

- [ ] **Step 9: 更新返回值**

在返回对象中添加 `isReconnecting` 和 `reconnectAttempt`:

```typescript
return {
  isConnected,
  isConnecting,
  isReconnecting,
  reconnectAttempt: reconnectAttemptRef.current,
  closeSocket,
  connectToShell,
  disconnectFromShell,
};
```

注意：`reconnectAttempt` 来自 ref，不会触发重渲染。如果需要在 UI 上显示重试次数，改用 state：

```typescript
const [reconnectAttempt, setReconnectAttempt] = useState(0);
```

并在 `scheduleReconnect` 中同步更新。

- [ ] **Step 10: 更新 connectWebSocket 依赖数组**

从依赖数组中移除 `clearTerminalScreen`（不再在 onclose 中使用），添加 `scheduleReconnect` 和 `isReconnecting`。

- [ ] **Step 11: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 12: 提交**

```bash
git add src/components/shell/hooks/useShellConnection.ts
git commit -m "feat: add shell auto-reconnect with exponential backoff"
```

---

### Task 2: useShellRuntime — 传递重连状态 + 会话持久化

**Files:**
- Modify: `src/components/shell/hooks/useShellRuntime.ts`

- [ ] **Step 1: 透传 isReconnecting 和 reconnectAttempt**

从 `useShellConnection` 的解构中增加 `isReconnecting` 和 `reconnectAttempt`（第 108 行）：

```typescript
const { isConnected, isConnecting, isReconnecting, reconnectAttempt, connectToShell, disconnectFromShell } = useShellConnection({
  // ... 不变
});
```

在返回对象（第 152 行）中添加：

```typescript
return {
  // ... 现有字段
  isReconnecting,
  reconnectAttempt,
};
```

同步更新 `UseShellRuntimeResult` 类型（在 `src/components/shell/types/types.ts` 中）。

- [ ] **Step 2: 添加会话持久化逻辑**

在 `useShellConnection` 调用之后添加：

```typescript
// 持久化 shell 会话信息，用于浏览器关闭后恢复
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

在文件顶部添加 hash 工具函数：

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
```

- [ ] **Step 3: 断开时清除持久化记录（主动断开）**

在 `disconnectFromShell` 被调用的地方（第 130、139、146 行的 useEffect），仅在 isRestarting 和 project 为空时清除持久化：

```typescript
// 在 isRestarting effect 中（第 125-132 行）添加清除逻辑
useEffect(() => {
  if (!isRestarting) {
    return;
  }

  // 清除持久化记录
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

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/components/shell/hooks/useShellRuntime.ts src/components/shell/types/types.ts
git commit -m "feat: persist shell session info to localStorage for recovery"
```

---

### Task 3: ShellConnectionOverlay — 重连状态 UI

**Files:**
- Modify: `src/components/shell/view/subcomponents/ShellConnectionOverlay.tsx`

- [ ] **Step 1: 添加 reconnecting 模式**

更新 `mode` 类型和 props：

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
```

在 `connecting` 模式的 return 之前添加 `reconnecting` 分支：

```typescript
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

### Task 4: Shell.tsx — 集成重连状态到 UI

**Files:**
- Modify: `src/components/shell/view/Shell.tsx`

- [ ] **Step 1: 从 useShellRuntime 解构新字段**

在第 56-79 行的解构中添加 `isReconnecting` 和 `reconnectAttempt`：

```typescript
const {
  // ... 现有字段
  isReconnecting,
  reconnectAttempt,
} = useShellRuntime({ /* ... */ });
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

- [ ] **Step 3: 添加重连描述文案**

在 `overlayDescription` 之前添加：

```typescript
const reconnectingDescription = t('shell.reconnecting', {
  attempt: reconnectAttempt,
  max: 5,
  defaultValue: `Reconnecting... ({{attempt}}/{{max}})`,
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

- [ ] **Step 4: 传递 reconnectingLabel 到 overlay**

在 `ShellConnectionOverlay` 组件调用中添加：

```typescript
reconnectingLabel={t('shell.reconnectingLabel', { defaultValue: 'Reconnecting...' })}
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

### Task 5: i18n 翻译

**Files:**
- Modify: `src/i18n/locales/en/chat.json`
- Modify: `src/i18n/locales/zh-CN/chat.json`
- Modify: `src/i18n/locales/ja/chat.json`
- Modify: `src/i18n/locales/ko/chat.json`

- [ ] **Step 1: 添加英文翻译**

在 `chat.json` 的 `shell` 对象中添加：

```json
"reconnecting": "Reconnecting... ({{attempt}}/{{max}})",
"reconnectingLabel": "Reconnecting..."
```

- [ ] **Step 2: 添加中文翻译**

```json
"reconnecting": "重连中... ({{attempt}}/{{max}})",
"reconnectingLabel": "重连中..."
```

- [ ] **Step 3: 添加日文翻译**

```json
"reconnecting": "再接続中... ({{attempt}}/{{max}})",
"reconnectingLabel": "再接続中..."
```

- [ ] **Step 4: 添加韩文翻译**

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

### Task 6: 端到端验证

- [ ] **Step 1: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 2: ESLint 检查**

Run: `npx eslint src/components/shell/ --ext .ts,.tsx`
Expected: 无错误

- [ ] **Step 3: 手动测试场景**

1. 打开项目，连接 shell，执行命令
2. 刷新浏览器 → 应自动重连并看到之前的输出
3. 断开网络 → 应看到"重连中"提示
4. 恢复网络 → 应自动重连
5. 点击"断开" → 不应自动重连
6. 关闭浏览器，30 分钟内重新打开 → 应自动恢复会话
