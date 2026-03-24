# Shell Preset Switcher 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Shell 终端上方添加 Preset 切换工具栏，支持一键切换 API 配置（Base URL + Key + Model 环境变量），重启 CLI 进程。

**Architecture:** 服务端读取项目根目录 `shell-presets.json` 配置文件，通过 HTTP API 返回安全列表（不含 Key），通过 WebSocket `switch-preset` 消息触发 PTY 进程重启并注入新环境变量。前端在 Shell 组件中集成紧凑工具栏。

**Tech Stack:** React, TypeScript, Node.js, node-pty, WebSocket

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `shell-presets.example.json` | 新增：示例配置文件 |
| `src/components/shell/types/types.ts` | 修改：新增 `ShellSwitchPresetMessage` 和 `ShellPresetInfo` 类型 |
| `server/routes/projects.js` | 修改：新增 `GET /api/projects/:projectName/shell-presets` 端点 |
| `server/websocket/ShellHandler.js` | 修改：新增 `switch-preset` 消息处理 + `init` 时注入 preset 环境变量 |
| `src/components/standalone-shell/hooks/useShellPresets.ts` | 新增：preset 数据加载 hook |
| `src/components/standalone-shell/view/ShellPresetBar.tsx` | 新增：工具栏 UI 组件 |
| `src/components/standalone-shell/view/StandaloneShell.tsx` | 修改：集成 ShellPresetBar |

---

### Task 1: 示例配置文件 + TypeScript 类型

**Files:**
- Create: `shell-presets.example.json`
- Modify: `src/components/shell/types/types.ts`

- [ ] **Step 1: 创建示例配置文件**

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
    "baseUrl": "https://your-proxy.com/v1",
    "apiKey": "your-key",
    "model": "MiniMax-M2.5",
    "smallFastModel": "MiniMax-M2.5",
    "defaultSonnetModel": "MiniMax-M2.5",
    "defaultOpusModel": "MiniMax-M2.5"
  }
]
```

- [ ] **Step 2: 新增 TypeScript 类型**

在 `src/components/shell/types/types.ts` 中添加：

```typescript
export type ShellPresetInfo = {
  id: string;
  label: string;
};

export type ShellSwitchPresetMessage = {
  type: 'switch-preset';
  presetId: string;
};
```

并把 `ShellSwitchPresetMessage` 加入 `ShellOutgoingMessage` 联合类型。

- [ ] **Step 3: 提交**

```bash
git add shell-presets.example.json src/components/shell/types/types.ts
git commit -m "feat: add shell preset types and example config"
```

---

### Task 2: 服务端 API 端点

**Files:**
- Modify: `server/routes/projects.js`

- [ ] **Step 1: 新增 GET 端点**

在 `server/routes/projects.js` 中添加：

```javascript
router.get('/:projectName/shell-presets', authorizeProject, async (req, res) => {
  try {
    const project = req.authorizedProject;
    const presetsPath = path.join(project.path, 'shell-presets.json');

    try {
      const raw = await fs.readFile(presetsPath, 'utf-8');
      const presets = JSON.parse(raw);
      // 只返回 id 和 label，不暴露 apiKey
      const safePresets = Array.isArray(presets)
        ? presets.map(p => ({ id: p.id, label: p.label }))
        : [];
      res.json({ presets: safePresets });
    } catch (readErr) {
      // 文件不存在或解析失败 → 返回空数组
      res.json({ presets: [] });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to read shell presets' });
  }
});
```

- [ ] **Step 2: 确认 fs 和 path 已 import**

检查文件顶部是否已有 `import fs` 和 `import path`，没有则添加。

- [ ] **Step 3: 提交**

```bash
git add server/routes/projects.js
git commit -m "feat: add GET /api/projects/:name/shell-presets endpoint"
```

---

### Task 3: 服务端 WebSocket switch-preset 处理

**Files:**
- Modify: `server/websocket/ShellHandler.js`

- [ ] **Step 1: 添加读取 preset 的辅助函数**

在 ShellHandler 类中添加：

```javascript
async #readPreset(projectPath, presetId) {
    const presetsPath = path.join(projectPath, 'shell-presets.json');
    const raw = await fs.readFile(presetsPath, 'utf-8');
    const presets = JSON.parse(raw);
    return presets.find(p => p.id === presetId) || null;
}

#buildPresetEnv(preset) {
    const env = {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
    };
    if (preset) {
        env.ANTHROPIC_BASE_URL = preset.baseUrl;
        env.ANTHROPIC_API_KEY = preset.apiKey;
        env.ANTHROPIC_MODEL = preset.model;
        env.ANTHROPIC_SMALL_FAST_MODEL = preset.smallFastModel;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = preset.defaultSonnetModel;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = preset.defaultOpusModel;
    }
    return env;
}
```

- [ ] **Step 2: 添加 switch-preset 消息处理**

在 `ws.on('message')` 的消息类型分支中，在 `paste-image` 之后添加：

```javascript
} else if (data.type === 'switch-preset') {
    try {
        const session = this.ptySessionsMap.get(ptySessionKey);
        const projectPath = session?.projectPath;
        if (!projectPath) {
            ws.send(JSON.stringify({
                type: 'output',
                data: '\r\n\x1b[31m[切换失败：无活跃会话]\x1b[0m\r\n'
            }));
            return;
        }

        const preset = await this.#readPreset(projectPath, data.presetId);
        if (!preset) {
            ws.send(JSON.stringify({
                type: 'output',
                data: `\r\n\x1b[31m[切换失败：未找到配置 ${data.presetId}]\x1b[0m\r\n`
            }));
            return;
        }

        // 杀掉当前 PTY 进程
        const oldSessionId = session.sessionId;
        const oldBaseUrl = session.presetBaseUrl || '';
        if (shellProcess && shellProcess.kill) {
            shellProcess.kill();
        }
        if (session.timeoutId) clearTimeout(session.timeoutId);
        this.ptySessionsMap.delete(ptySessionKey);

        // 判断是否同平台（可 resume）
        const samePlatform = oldBaseUrl === preset.baseUrl && oldSessionId;
        const shellCommand = samePlatform
            ? `cd "${projectPath}" && claude --resume ${oldSessionId} || claude`
            : `cd "${projectPath}" && claude`;

        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
        const shellArgs = os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];

        const termCols = terminalRef?.cols || 80;
        const termRows = terminalRef?.rows || 24;

        ws.send(JSON.stringify({
            type: 'output',
            data: `\r\n\x1b[36m[正在切换到 ${preset.label} (${preset.model})...]\x1b[0m\r\n`
        }));

        shellProcess = pty.spawn(shell, shellArgs, {
            name: 'xterm-256color',
            cols: termCols,
            rows: termRows,
            cwd: os.homedir(),
            env: this.#buildPresetEnv(preset),
        });

        ptySessionKey = `${projectPath}_preset_${preset.id}`;
        this.ptySessionsMap.set(ptySessionKey, {
            pty: shellProcess,
            ws: ws,
            buffer: [],
            timeoutId: null,
            projectPath,
            sessionId: oldSessionId,
            presetBaseUrl: preset.baseUrl,
        });

        // 绑定输出和退出事件（复用现有逻辑）
        shellProcess.onData((outputData) => {
            const s = this.ptySessionsMap.get(ptySessionKey);
            if (!s) return;
            if (s.buffer.length < 5000) {
                s.buffer.push(outputData);
            } else {
                s.buffer.shift();
                s.buffer.push(outputData);
            }
            if (s.ws && s.ws.readyState === WebSocket.OPEN) {
                s.ws.send(JSON.stringify({ type: 'output', data: outputData }));
            }
        });

        shellProcess.onExit((exitCode) => {
            log.info(`Switched shell exited: ${exitCode.exitCode}`);
            const s = this.ptySessionsMap.get(ptySessionKey);
            if (s?.ws?.readyState === WebSocket.OPEN) {
                s.ws.send(JSON.stringify({
                    type: 'output',
                    data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}\x1b[0m\r\n`
                }));
            }
            this.ptySessionsMap.delete(ptySessionKey);
            shellProcess = null;
        });

        ws.send(JSON.stringify({
            type: 'preset-switched',
            presetId: preset.id,
            label: preset.label,
        }));

        log.info(`Switched to preset: ${preset.label} (${preset.model})`);
    } catch (switchErr) {
        log.error({ err: switchErr }, 'Error switching preset');
        ws.send(JSON.stringify({
            type: 'output',
            data: `\r\n\x1b[31m[切换失败: ${switchErr.message}]\x1b[0m\r\n`
        }));
    }
}
```

- [ ] **Step 3: 修改 init 处理，记录 presetBaseUrl**

在现有 `init` 处理的 `this.ptySessionsMap.set(ptySessionKey, {...})` 中，添加 `presetBaseUrl: ''` 字段。

- [ ] **Step 4: 保存终端尺寸供 switch-preset 使用**

在 `init` 处理中，将 `termCols` 和 `termRows` 保存到闭包变量（或 session 对象）中，供 `switch-preset` 读取。在 `resize` 处理中同步更新。

```javascript
// 在 handleConnection 闭包顶部添加
let currentCols = 80;
let currentRows = 24;

// 在 init 中 spawn 之后
currentCols = termCols;
currentRows = termRows;

// 在 resize 中
currentCols = data.cols;
currentRows = data.rows;

// switch-preset 中使用 currentCols / currentRows 替代 terminalRef
```

- [ ] **Step 5: 添加 preset-switched 到 ShellIncomingMessage 类型**

在 `src/components/shell/types/types.ts` 的 `ShellIncomingMessage` 中：

```typescript
export type ShellIncomingMessage =
  | { type: 'output'; data: string }
  | { type: 'auth_url'; url?: string }
  | { type: 'url_open'; url?: string }
  | { type: 'preset-switched'; presetId: string; label: string }
  | { type: string; [key: string]: unknown };
```

- [ ] **Step 6: 提交**

```bash
git add server/websocket/ShellHandler.js src/components/shell/types/types.ts
git commit -m "feat: add switch-preset WebSocket handler in ShellHandler"
```

---

### Task 4: 前端 useShellPresets Hook

**Files:**
- Create: `src/components/standalone-shell/hooks/useShellPresets.ts`

- [ ] **Step 1: 创建 hook**

```typescript
import { useCallback, useEffect, useState } from 'react';
import type { Project } from '../../../types/app';
import type { ShellPresetInfo } from '../../shell/types/types';
import { authenticatedFetch } from '../../../utils/api';

export function useShellPresets(project: Project | null | undefined) {
  const [presets, setPresets] = useState<ShellPresetInfo[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  useEffect(() => {
    if (!project) {
      setPresets([]);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const res = await authenticatedFetch(
          `/api/projects/${encodeURIComponent(project!.name)}/shell-presets`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setPresets(data.presets || []);
      } catch {
        setPresets([]);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [project]);

  const switchPreset = useCallback(
    (ws: WebSocket | null, presetId: string) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'switch-preset', presetId }));
      setActivePresetId(presetId);
    },
    [],
  );

  return { presets, activePresetId, setActivePresetId, switchPreset };
}
```

- [ ] **Step 2: 提交**

```bash
git add src/components/standalone-shell/hooks/useShellPresets.ts
git commit -m "feat: add useShellPresets hook for loading preset list"
```

---

### Task 5: ShellPresetBar UI 组件

**Files:**
- Create: `src/components/standalone-shell/view/ShellPresetBar.tsx`

- [ ] **Step 1: 创建工具栏组件**

```tsx
import { useState } from 'react';
import type { ShellPresetInfo } from '../../shell/types/types';

type ShellPresetBarProps = {
  presets: ShellPresetInfo[];
  activePresetId: string | null;
  onSwitch: (presetId: string) => void;
};

export default function ShellPresetBar({
  presets,
  activePresetId,
  onSwitch,
}: ShellPresetBarProps) {
  const [selectedId, setSelectedId] = useState<string>(
    activePresetId || presets[0]?.id || '',
  );
  const [confirming, setConfirming] = useState(false);

  if (presets.length === 0) return null;

  const handleSwitch = () => {
    if (!selectedId || selectedId === activePresetId) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onSwitch(selectedId);
    setConfirming(false);
  };

  const handleCancel = () => {
    setConfirming(false);
  };

  const selectedLabel = presets.find((p) => p.id === selectedId)?.label || '';

  return (
    <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5">
      <select
        value={selectedId}
        onChange={(e) => {
          setSelectedId(e.target.value);
          setConfirming(false);
        }}
        className="rounded border border-border/60 bg-background px-2 py-1 text-xs text-foreground"
      >
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id === activePresetId ? `● ${p.label}` : p.label}
          </option>
        ))}
      </select>

      {confirming ? (
        <>
          <span className="text-xs text-amber-500">
            切换到 {selectedLabel}？会话将重启
          </span>
          <button
            onClick={handleSwitch}
            className="rounded bg-amber-600 px-2 py-0.5 text-xs text-white hover:bg-amber-700"
          >
            确认
          </button>
          <button
            onClick={handleCancel}
            className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/80"
          >
            取消
          </button>
        </>
      ) : (
        <button
          onClick={handleSwitch}
          disabled={!selectedId || selectedId === activePresetId}
          className="rounded bg-primary/90 px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary disabled:opacity-40"
        >
          切换
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/components/standalone-shell/view/ShellPresetBar.tsx
git commit -m "feat: add ShellPresetBar UI component"
```

---

### Task 6: 集成到 StandaloneShell

**Files:**
- Modify: `src/components/standalone-shell/view/StandaloneShell.tsx`

- [ ] **Step 1: 集成 ShellPresetBar**

```typescript
// 新增 import
import ShellPresetBar from './ShellPresetBar';
import { useShellPresets } from '../hooks/useShellPresets';

// 在 StandaloneShell 组件内部，Shell 组件需要暴露 wsRef
// 方案：通过 Shell 的 ref 或者直接在 StandaloneShell 中使用 useShellPresets
```

由于 Shell 组件内部管理 wsRef，需要将 wsRef 暴露出来。修改方案：

在 `StandaloneShell` 中添加：

```tsx
import { useRef } from 'react';
import ShellPresetBar from './ShellPresetBar';
import { useShellPresets } from '../hooks/useShellPresets';

// 在组件内部：
const shellWsRef = useRef<WebSocket | null>(null);
const { presets, activePresetId, switchPreset } = useShellPresets(project);

// Shell 组件需要接受 onWsReady 回调来暴露 ws
// 更简单的方案：通过 sendSocketMessage 直接用 wsRef
```

实际实现：给 Shell 组件添加 `wsRef` 外部传入的 prop，或者在 ShellPresetBar 中通过新的 WebSocket 消息直接发送。

最简方案：**让 ShellPresetBar 通过 Shell 的 wsRef 发送消息**。修改 Shell 组件暴露 wsRef：

在 `Shell.tsx` 中添加 prop：
```typescript
onWsRef?: (ws: MutableRefObject<WebSocket | null>) => void;
```

在 `useShellRuntime` 返回后调用：
```typescript
useEffect(() => {
  onWsRef?.(wsRef);
}, [wsRef, onWsRef]);
```

在 `StandaloneShell.tsx` 中：
```tsx
const wsRefFromShell = useRef<MutableRefObject<WebSocket | null> | null>(null);
const { presets, activePresetId, switchPreset } = useShellPresets(project);

const handleWsRef = useCallback((ref: MutableRefObject<WebSocket | null>) => {
  wsRefFromShell.current = ref;
}, []);

const handlePresetSwitch = useCallback((presetId: string) => {
  switchPreset(wsRefFromShell.current?.current ?? null, presetId);
}, [switchPreset]);

// 在 JSX 中：
return (
  <div className={`flex h-full w-full flex-col ${className}`}>
    {!minimal && showHeader && title && (
      <StandaloneShellHeader ... />
    )}

    {presets.length > 0 && (
      <ShellPresetBar
        presets={presets}
        activePresetId={activePresetId}
        onSwitch={handlePresetSwitch}
      />
    )}

    <div className="min-h-0 w-full flex-1">
      <Shell
        ...
        onWsRef={handleWsRef}
      />
    </div>
  </div>
);
```

- [ ] **Step 2: 修改 Shell.tsx 添加 onWsRef prop**

在 `ShellProps` 中添加：
```typescript
onWsRef?: (ws: MutableRefObject<WebSocket | null>) => void;
```

在组件中，`useShellRuntime` 返回 `wsRef` 后：
```typescript
useEffect(() => {
  onWsRef?.(wsRef);
}, [wsRef, onWsRef]);
```

- [ ] **Step 3: 处理 preset-switched 响应**

在 `useShellConnection.ts` 的 WebSocket `onmessage` 中，检测 `preset-switched` 消息并更新 activePresetId。通过在 Shell 中传递回调实现。

或更简单：在 `useShellPresets` 中监听 — 但 hook 没有 ws 引用。

最简方案：`switchPreset` 已经在调用时 `setActivePresetId(presetId)`，这足够了。服务端的 `preset-switched` 消息会被 `ShellIncomingMessage` 的兜底类型 catch，不会报错。

- [ ] **Step 4: 提交**

```bash
git add src/components/standalone-shell/view/StandaloneShell.tsx src/components/shell/view/Shell.tsx
git commit -m "feat: integrate ShellPresetBar into StandaloneShell"
```

---

### Task 7: 验证 & 清理

- [ ] **Step 1: TypeScript 编译检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: 手动验证**

1. 在项目根目录创建 `shell-presets.json`（从 example 复制并填入真实 Key）
2. 打开 Shell 页面，确认工具栏显示
3. 选择不同 preset，点击切换，确认终端重启并使用新配置
4. 不放置配置文件时，确认工具栏不显示

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat: shell preset switcher - complete implementation"
```
