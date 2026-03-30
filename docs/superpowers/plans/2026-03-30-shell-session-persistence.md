# Shell Session 持久化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Shell 模式的 Claude CLI 对话和终端输出都能永久保存，并出现在侧边栏 session 列表中。

**Architecture:** 两条链路并行实施。链路 A：ShellHandler 监听用户专属 `.claude/projects/` 目录，JSONL 文件出现时发送 `shell-session-created` 消息给前端，前端更新 `selectedSession` 为真实 UUID。链路 B：每个 PTY 会话的输出实时追加到 `~/.claude/shell-logs/{userId}/` 目录，独立 API 端点提供读取，侧边栏展示为 `shell-log` 类型 session，点击后用 ShellLogViewer 组件展示纯文本。

**Tech Stack:** Node.js (fs, chokidar, node-pty), React, TypeScript, lucide-react

---

## 文件清单

| 操作 | 文件 |
|------|------|
| **新增** | `server/shell-log-manager.js` |
| **新增** | `src/components/shell-log/hooks/useShellLogContent.ts` |
| **新增** | `src/components/shell-log/view/ShellLogViewer.tsx` |
| **修改** | `server/websocket/ShellHandler.js` |
| **修改** | `server/index.js` |
| **修改** | `server/routes/project-files.js` |
| **修改** | `src/types/app.ts` |
| **修改** | `src/utils/api.js` |
| **修改** | `src/components/shell/hooks/useShellConnection.ts` |
| **修改** | `src/components/shell/hooks/useShellRuntime.ts` |
| **修改** | `src/components/shell/view/Shell.tsx` |
| **修改** | `src/components/standalone-shell/view/StandaloneShell.tsx` |
| **修改** | `src/hooks/useProjectsState.ts` |
| **修改** | `src/components/main-content/view/MainContent.tsx` |
| **修改** | `src/components/sidebar/hooks/useSidebarController.ts` |
| **修改** | `src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx` |

---

## Task 1: 创建 ShellLogManager

**Files:**
- Create: `server/shell-log-manager.js`

- [ ] **Step 1: 创建 shell-log-manager.js**

```javascript
// server/shell-log-manager.js
import os from 'os';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import crypto from 'crypto';

const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

function stripAnsi(text) {
  return text.replace(ANSI_ESCAPE_REGEX, '');
}

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

class ShellLogManager {
  constructor() {
    this.logsBaseDir = path.join(os.homedir(), '.claude', 'shell-logs');
    // Map of logId → { txtPath, metaPath, lineCount, projectName }
    this._openLogs = new Map();
  }

  /** 返回 userId 专属日志目录 */
  _userDir(userId) {
    return path.join(this.logsBaseDir, String(userId || 0));
  }

  /** 确保目录存在（同步，仅在 createLog 调用时） */
  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 为新 PTY 会话创建日志文件。
   * @param {string} projectPath  项目绝对路径
   * @param {string} projectName  项目名称（用于 API 过滤）
   * @param {number} userId       用户 ID
   * @param {string} sessionId    PTY session key（'new-{ts}' 或真实 UUID）
   * @param {string} provider     'claude' | 'plain-shell' | 其他
   * @returns {string} logId      唯一标识，后续 appendLine/closeLog 使用
   */
  createLog(projectPath, projectName, userId, sessionId, provider) {
    const userDir = this._userDir(userId);
    this._ensureDir(userDir);

    const ts = formatTimestamp();
    const safeSession = (sessionId || 'unknown').replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 40);
    const logId = `${safeSession}_${ts}`;
    const txtPath = path.join(userDir, `${logId}.txt`);
    const metaPath = path.join(userDir, `${logId}.meta.json`);

    const meta = {
      id: logId,
      projectPath,
      projectName,
      userId,
      provider,
      startedAt: new Date().toISOString(),
      endedAt: null,
      lineCount: 0,
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    fs.writeFileSync(txtPath, '', 'utf8'); // 创建空日志文件

    this._openLogs.set(logId, { txtPath, metaPath, lineCount: 0, projectName });
    return logId;
  }

  /**
   * 追加输出（剥离 ANSI 后写入）。
   * @param {string} logId
   * @param {string} rawText  原始终端输出（含 ANSI 转义）
   */
  appendLine(logId, rawText) {
    const entry = this._openLogs.get(logId);
    if (!entry) return;
    const clean = stripAnsi(rawText);
    if (!clean) return;
    try {
      fs.appendFileSync(entry.txtPath, clean, 'utf8');
      entry.lineCount++;
    } catch {
      // non-fatal
    }
  }

  /**
   * 关闭日志，写入 endedAt 和 lineCount。
   * @param {string} logId
   */
  closeLog(logId) {
    const entry = this._openLogs.get(logId);
    if (!entry) return;
    try {
      const raw = fs.readFileSync(entry.metaPath, 'utf8');
      const meta = JSON.parse(raw);
      meta.endedAt = new Date().toISOString();
      meta.lineCount = entry.lineCount;
      fs.writeFileSync(entry.metaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch {
      // non-fatal
    }
    this._openLogs.delete(logId);
  }

  /**
   * 列出某用户某项目下的所有 shell log session（按时间倒序）。
   * @param {string} projectName
   * @param {number} userId
   * @returns {Promise<Array>}
   */
  async getProjectLogs(projectName, userId) {
    const userDir = this._userDir(userId);
    try {
      await fsPromises.access(userDir);
    } catch {
      return [];
    }

    const files = await fsPromises.readdir(userDir);
    const metaFiles = files.filter(f => f.endsWith('.meta.json'));

    const results = [];
    for (const file of metaFiles) {
      try {
        const raw = await fsPromises.readFile(path.join(userDir, file), 'utf8');
        const meta = JSON.parse(raw);
        if (meta.projectName === projectName) {
          results.push(meta);
        }
      } catch {
        // skip corrupt meta
      }
    }

    results.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    return results;
  }

  /**
   * 读取日志内容（按行分页）。
   * @param {string} logId
   * @param {number} userId
   * @param {number} offset   行偏移
   * @param {number} limit    行数限制
   * @returns {Promise<{ content: string, lineCount: number }>}
   */
  async getLogContent(logId, userId) {
    const userDir = this._userDir(userId);
    const txtPath = path.join(userDir, `${logId}.txt`);
    try {
      const content = await fsPromises.readFile(txtPath, 'utf8');
      return { content, lineCount: content.split('\n').length };
    } catch {
      return { content: '', lineCount: 0 };
    }
  }

  /**
   * 删除日志（txt + meta）。
   * @param {string} logId
   * @param {number} userId
   */
  async deleteLog(logId, userId) {
    const userDir = this._userDir(userId);
    const txtPath = path.join(userDir, `${logId}.txt`);
    const metaPath = path.join(userDir, `${logId}.meta.json`);
    await Promise.allSettled([
      fsPromises.unlink(txtPath),
      fsPromises.unlink(metaPath),
    ]);
    this._openLogs.delete(logId);
  }
}

export default new ShellLogManager();
```

- [ ] **Step 2: 手动验证文件可被 import**

在 `server/` 目录确认 package.json 有 `"type": "module"` 或文件使用 ESM 语法，和 `ShellHandler.js` 保持一致即可。

- [ ] **Step 3: 提交**

```bash
git add server/shell-log-manager.js
git commit -m "feat(shell-log): add ShellLogManager for PTY output persistence"
```

---

## Task 2: 添加 shell-sessions API 路由

**Files:**
- Modify: `server/routes/project-files.js`

- [ ] **Step 1: 在文件顶部导入 shellLogManager**

在 `server/routes/project-files.js` 的 import 区域末尾添加：

```javascript
import shellLogManager from '../shell-log-manager.js';
```

- [ ] **Step 2: 在最后一个已有路由后添加三个新路由**

在 `server/routes/project-files.js` 的 `export default router;` 之前插入：

```javascript
// GET /api/projects/:projectName/shell-sessions
router.get('/:projectName/shell-sessions', authorizeProject, async (req, res) => {
    try {
        const logs = await shellLogManager.getProjectLogs(
            req.params.projectName,
            req.user.id
        );
        res.json({ sessions: logs, total: logs.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/projects/:projectName/shell-sessions/:logId/content
router.get('/:projectName/shell-sessions/:logId/content', authorizeProject, async (req, res) => {
    try {
        const result = await shellLogManager.getLogContent(
            req.params.logId,
            req.user.id
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/projects/:projectName/shell-sessions/:logId
router.delete('/:projectName/shell-sessions/:logId', authorizeProject, async (req, res) => {
    try {
        await shellLogManager.deleteLog(req.params.logId, req.user.id);
        res.status(204).end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

- [ ] **Step 3: 手动测试 API**

启动服务后用 curl 确认路由可访问（需要 auth token）：
```
GET /api/projects/{projectName}/shell-sessions
```
预期返回 `{ sessions: [], total: 0 }`（目前还没日志）。

- [ ] **Step 4: 提交**

```bash
git add server/routes/project-files.js
git commit -m "feat(shell-log): add shell-sessions API routes (list/content/delete)"
```

---

## Task 3: 添加 shell-log 文件监听

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 在 PROVIDER_WATCH_PATHS 中添加 shell-log**

找到 `server/index.js` 中的 `PROVIDER_WATCH_PATHS` 数组（约第 100 行），添加一项：

```javascript
const PROVIDER_WATCH_PATHS = [
    { provider: 'claude', rootPath: path.join(os.homedir(), '.claude', 'projects') },
    { provider: 'cursor', rootPath: path.join(os.homedir(), '.cursor', 'chats') },
    { provider: 'codex', rootPath: path.join(os.homedir(), '.codex', 'sessions') },
    { provider: 'gemini', rootPath: path.join(os.homedir(), '.gemini', 'projects') },
    { provider: 'gemini_sessions', rootPath: path.join(os.homedir(), '.gemini', 'sessions') },
    { provider: 'shell-log', rootPath: path.join(os.homedir(), '.claude', 'shell-logs') }, // 新增
];
```

- [ ] **Step 2: 提交**

```bash
git add server/index.js
git commit -m "feat(shell-log): watch ~/.claude/shell-logs for sidebar updates"
```

---

## Task 4: 在 ShellHandler 中集成 ShellLogManager（链路 B）

**Files:**
- Modify: `server/websocket/ShellHandler.js`

- [ ] **Step 1: 导入 shellLogManager**

在 `server/websocket/ShellHandler.js` 顶部的 import 区域末尾添加：

```javascript
import shellLogManager from '../shell-log-manager.js';
```

- [ ] **Step 2: 在 PTY 启动后（ptySessionsMap.set 之前）创建日志**

找到 `this.ptySessionsMap.set(mySessionKey, { ... })` 那段代码（约第 439-448 行），在 `this.ptySessionsMap.set(...)` 调用之前添加：

```javascript
// 创建持久化日志（链路 B）
const logId = shellLogManager.createLog(
    projectPath,
    path.basename(projectPath),  // projectName 用目录名
    userId,
    sessionId || mySessionKey,
    isPlainShell ? 'plain-shell' : provider
);
```

- [ ] **Step 3: 在 onData 回调中追加日志**

在 `shellProcess.onData((data) => {` 回调内，找到 `const session = this.ptySessionsMap.get(mySessionKey); if (!session) return;` 之后，在缓冲区追加（第 456 行附近）之前添加：

```javascript
// 持久化输出（链路 B）
shellLogManager.appendLine(logId, data);
```

- [ ] **Step 4: 在 onExit 回调中关闭日志**

在 `shellProcess.onExit((exitCode) => {` 回调内，在 `this.ptySessionsMap.delete(mySessionKey)` 之前添加：

```javascript
// 关闭日志（链路 B）
shellLogManager.closeLog(logId);
```

- [ ] **Step 5: 手动验证日志写入**

启动服务，新建一个 Shell session，在终端输入一条命令（如 `ls`）后退出。
检查 `~/.claude/shell-logs/0/` 目录（或 `~/.claude/shell-logs/{userId}/`）是否有 `.txt` 和 `.meta.json` 文件，且 `.txt` 包含命令输出的文本。

- [ ] **Step 6: 提交**

```bash
git add server/websocket/ShellHandler.js
git commit -m "feat(shell-log): integrate ShellLogManager into ShellHandler PTY lifecycle"
```

---

## Task 5: ShellHandler 链路 A — 发送 shell-session-created 事件

**Files:**
- Modify: `server/websocket/ShellHandler.js`

- [ ] **Step 1: 在文件顶部导入 chokidar**

在 `server/websocket/ShellHandler.js` 已有的 import 区域添加：

```javascript
import chokidar from 'chokidar';
```

- [ ] **Step 2: 在 PTY 启动后、provider 为 claude 且新建会话时，启动 JSONL 文件监听**

在 Task 4 Step 2 添加的 `logId` 声明之后，追加以下代码块：

```javascript
// 链路 A：监听 Claude CLI 创建的真实 session JSONL
let sessionWatcher = null;
if (!isPlainShell && (provider === 'claude' || !provider) && !hasSession) {
    // userHome/.claude/projects/ 是 Claude CLI 写 JSONL 的位置
    const claudeProjectsDir = path.join(userHome, '.claude', 'projects');
    try {
        sessionWatcher = chokidar.watch(claudeProjectsDir, {
            persistent: false,
            ignoreInitial: true,
            depth: 2,
            awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        });
        sessionWatcher.on('add', (filePath) => {
            if (!filePath.endsWith('.jsonl')) return;
            const realSessionId = path.basename(filePath, '.jsonl');
            // 过滤 agent- 前缀的子 agent 文件
            if (realSessionId.startsWith('agent-')) return;
            const session = this.ptySessionsMap.get(mySessionKey);
            if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                session.ws.send(JSON.stringify({
                    type: 'shell-session-created',
                    sessionId: realSessionId,
                    provider: 'claude',
                }));
            }
            // 发送一次后停止监听，防止重复触发
            sessionWatcher.close().catch(() => {});
            sessionWatcher = null;
        });
    } catch (err) {
        log.error({ err }, 'Failed to start session watcher');
    }
}
```

- [ ] **Step 3: 在 onExit 中关闭 sessionWatcher**

在 `shellProcess.onExit` 回调里，在 `shellLogManager.closeLog(logId)` 之后添加：

```javascript
if (sessionWatcher) {
    sessionWatcher.close().catch(() => {});
    sessionWatcher = null;
}
```

- [ ] **Step 4: 手动验证事件发送**

启动服务，打开 Shell tab，新建 Session（不是 resume），在 Claude CLI 里发一条消息触发 JSONL 写入。
在浏览器 DevTools Network → WS → Shell 连接，过滤 `shell-session-created`，确认收到事件和真实 UUID。

- [ ] **Step 5: 提交**

```bash
git add server/websocket/ShellHandler.js
git commit -m "feat(shell-log): emit shell-session-created when Claude CLI writes JSONL (Link A)"
```

---

## Task 6: 更新类型定义

**Files:**
- Modify: `src/types/app.ts`

- [ ] **Step 1: 在 SessionProvider 中添加 shell-log**

找到第 1 行：
```typescript
export type SessionProvider = 'claude' | 'cursor' | 'codex' | 'gemini' | 'claude-cli';
```
改为：
```typescript
export type SessionProvider = 'claude' | 'cursor' | 'codex' | 'gemini' | 'claude-cli' | 'shell-log';
```

- [ ] **Step 2: 添加 ShellLogSession 类型**

在 `ProjectSession` 接口定义之后添加：

```typescript
export interface ShellLogSession {
  id: string;
  projectPath: string;
  projectName: string;
  userId: number;
  provider: string;
  startedAt: string;
  endedAt: string | null;
  lineCount: number;
  __provider: 'shell-log';
}
```

- [ ] **Step 3: 在 Project 接口中添加 shellLogSessions 字段**

找到 `Project` 接口，在 `claudeCliSessions` 字段之后添加：
```typescript
shellLogSessions?: ShellLogSession[];
```

- [ ] **Step 4: 提交**

```bash
git add src/types/app.ts
git commit -m "feat(shell-log): add shell-log to SessionProvider type and ShellLogSession interface"
```

---

## Task 7: 添加前端 API 调用

**Files:**
- Modify: `src/utils/api.js`

- [ ] **Step 1: 在 api 对象中添加 shellSessions 方法**

找到 `deleteGeminiSession` 的定义附近，添加：

```javascript
shellSessions: (projectName) =>
  authenticatedFetch(`/api/projects/${projectName}/shell-sessions`),
shellSessionContent: (projectName, logId) =>
  authenticatedFetch(`/api/projects/${projectName}/shell-sessions/${logId}/content`),
deleteShellSession: (projectName, logId) =>
  authenticatedFetch(`/api/projects/${projectName}/shell-sessions/${logId}`, {
    method: 'DELETE',
  }),
```

- [ ] **Step 2: 提交**

```bash
git add src/utils/api.js
git commit -m "feat(shell-log): add shell-sessions API calls to api.js"
```

---

## Task 8: 前端链路 A — 回调链 useShellConnection → Shell

**Files:**
- Modify: `src/components/shell/hooks/useShellConnection.ts`
- Modify: `src/components/shell/hooks/useShellRuntime.ts`
- Modify: `src/components/shell/view/Shell.tsx`

### 8a: useShellConnection.ts

- [ ] **Step 1: 在 UseShellConnectionOptions 类型中添加新回调**

找到 `type UseShellConnectionOptions = {` 定义，在 `onOutputRef` 字段之后添加：

```typescript
onShellSessionCreated?: (sessionId: string) => void;
```

- [ ] **Step 2: 在函数参数中解构新回调**

找到函数定义 `export function useShellConnection({`，在 `onOutputRef,` 之后添加：
```typescript
onShellSessionCreated,
```

- [ ] **Step 3: 在 socket.onmessage 中处理新消息类型**

找到 `socket.onmessage = (event) => {` 内的 `handleSocketMessage` 调用。找到 `parseShellMessage` 的调用位置（约第 225-228 行），在消息处理的 if/else 块中添加对 `shell-session-created` 的处理。

找到处理 `auth_url` 类型消息的位置，在它附近添加：

```typescript
if (parsed && parsed.type === 'shell-session-created' && parsed.sessionId) {
  onShellSessionCreated?.(parsed.sessionId as string);
}
```

注意：需要找到 `handleSocketMessage` 函数或直接在 `socket.onmessage` 的 `rawPayload` 解析处添加，具体看已有的消息解析逻辑位置。

- [ ] **Step 4: 检查 parseShellMessage 的处理范围**

读取 `src/components/shell/utils/socket.ts`（或同目录），确认 `parseShellMessage` 的返回值，确保 `shell-session-created` 消息能被解析到。

### 8b: useShellRuntime.ts

- [ ] **Step 5: 在 UseShellRuntimeOptions 中添加回调（查看 types.ts）**

读取 `src/components/shell/types/types.ts`，找到 `UseShellRuntimeOptions` 类型定义，添加：
```typescript
onShellSessionCreated?: (sessionId: string) => void;
```

- [ ] **Step 6: 在 useShellRuntime 函数中传递回调到 useShellConnection**

在 `useShellRuntime` 函数中，从参数解构 `onShellSessionCreated`，然后在 `useShellConnection({...})` 调用中传入：
```typescript
onShellSessionCreated,
```

### 8c: Shell.tsx

- [ ] **Step 7: 在 ShellProps 类型中添加回调**

找到 `type ShellProps = {`，添加：
```typescript
onShellSessionCreated?: (sessionId: string) => void;
```

- [ ] **Step 8: 在 Shell 函数中解构并传递**

在 Shell 函数参数中解构 `onShellSessionCreated = undefined`，然后在 `useShellRuntime({...})` 调用中添加：
```typescript
onShellSessionCreated,
```

- [ ] **Step 9: 提交**

```bash
git add src/components/shell/hooks/useShellConnection.ts \
        src/components/shell/hooks/useShellRuntime.ts \
        src/components/shell/view/Shell.tsx
git commit -m "feat(shell-log): thread onShellSessionCreated callback through Shell component chain"
```

---

## Task 9: 前端链路 A — StandaloneShell → MainContent → useProjectsState

**Files:**
- Modify: `src/components/standalone-shell/view/StandaloneShell.tsx`
- Modify: `src/components/main-content/view/MainContent.tsx`
- Modify: `src/hooks/useProjectsState.ts`

### 9a: StandaloneShell.tsx

- [ ] **Step 1: 添加 onShellSessionCreated prop**

在 `StandaloneShellProps` 类型中添加：
```typescript
onShellSessionCreated?: (sessionId: string) => void;
```

在函数参数中解构 `onShellSessionCreated = undefined`，并传入 `<Shell>` 组件：
```tsx
<Shell
  selectedProject={project}
  selectedSession={session}
  initialCommand={command}
  isPlainShell={shouldUsePlainShell}
  onProcessComplete={handleProcessComplete}
  minimal={minimal}
  autoConnect={minimal ? true : autoConnect}
  onWsRef={handleWsRef}
  onShellSessionCreated={onShellSessionCreated}
/>
```

### 9b: MainContent.tsx

- [ ] **Step 2: 在 MainContentProps 类型中添加回调**

读取 `src/components/main-content/types/types.ts`，在 `MainContentProps` 中添加：
```typescript
onShellSessionCreated?: (sessionId: string) => void;
```

- [ ] **Step 3: 在 MainContent 函数中解构并传递**

在 `MainContent` 函数中解构 `onShellSessionCreated`，在 `<StandaloneShell>` 调用中添加：
```tsx
<StandaloneShell
  key={shellRestartKey}
  project={selectedProject}
  session={selectedSession}
  showHeader={false}
  onShellSessionCreated={onShellSessionCreated}
/>
```

### 9c: useProjectsState.ts

- [ ] **Step 4: 添加 shellLogVersion 状态和 handleShellSessionCreated**

在 `useProjectsState` 函数内，在已有的 state 定义区域添加：
```typescript
const [shellLogVersion, setShellLogVersion] = useState(0);
```

添加回调函数（放在 `handleNewSession` 附近）：
```typescript
const handleShellSessionCreated = useCallback((realSessionId: string) => {
  setSelectedSession((prev) =>
    prev ? { ...prev, id: realSessionId } : prev
  );
}, []);
```

- [ ] **Step 5: 在 projects_updated 处理中更新 shellLogVersion**

在 `useEffect` 处理 `latestMessage` 的代码中，找到对 `projects_updated` 消息的处理。在 `if (latestMessage.type !== 'projects_updated') { return; }` 之后、主逻辑之前添加：

```typescript
const projectsMessage = latestMessage as ProjectsUpdatedMessage & { watchProvider?: string };
if (projectsMessage.watchProvider === 'shell-log') {
  setShellLogVersion((prev) => prev + 1);
  return;
}
```

- [ ] **Step 6: 在 sidebarSharedProps 和 return 中暴露新值**

在 `sidebarSharedProps` 的 useMemo 中添加：
```typescript
shellLogVersion,
onShellSessionCreated: handleShellSessionCreated,
```

同时更新 useMemo 的依赖数组，加入 `shellLogVersion` 和 `handleShellSessionCreated`。

在 return 对象中添加 `onShellSessionCreated: handleShellSessionCreated`（用于传给 MainContent）。

- [ ] **Step 7: AppContent.tsx — 传递 onShellSessionCreated 到 MainContent**

读取 `src/components/app/AppContent.tsx`，找到 `useProjectsState` 解构处，添加 `onShellSessionCreated`；然后在 `<MainContent>` 调用中传入：
```tsx
onShellSessionCreated={onShellSessionCreated}
```

- [ ] **Step 8: 提交**

```bash
git add src/components/standalone-shell/view/StandaloneShell.tsx \
        src/components/main-content/view/MainContent.tsx \
        src/components/main-content/types/types.ts \
        src/hooks/useProjectsState.ts \
        src/components/app/AppContent.tsx
git commit -m "feat(shell-log): connect onShellSessionCreated to useProjectsState (Link A complete)"
```

---

## Task 10: 更新侧边栏展示 Shell Log Sessions

**Files:**
- Modify: `src/components/sidebar/hooks/useSidebarController.ts`
- Modify: `src/components/sidebar/types/types.ts`（如有需要）
- Modify: `src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx`

### 10a: useSidebarController.ts

- [ ] **Step 1: 添加 shellLogVersion prop 和 shellLogSessions 状态**

在 `UseSidebarControllerArgs` 类型中添加：
```typescript
shellLogVersion?: number;
```

在 `useSidebarController` 函数内添加状态：
```typescript
const [shellLogSessionsByProject, setShellLogSessionsByProject] = useState<
  Record<string, import('../../../types/app').ShellLogSession[]>
>({});
```

- [ ] **Step 2: 添加 loadShellLogSessions 函数**

```typescript
const loadShellLogSessions = useCallback(async (project: Project) => {
  try {
    const response = await api.shellSessions(project.name);
    if (!response.ok) return;
    const result = await response.json() as { sessions: import('../../../types/app').ShellLogSession[] };
    const sessionsWithProvider = (result.sessions || []).map((s) => ({
      ...s,
      __provider: 'shell-log' as const,
    }));
    setShellLogSessionsByProject((prev) => ({
      ...prev,
      [project.name]: sessionsWithProvider,
    }));
  } catch {
    // silent
  }
}, []);
```

- [ ] **Step 3: 在项目展开时加载 shell log sessions**

找到 `handleProjectExpand`（或项目展开的 useCallback）逻辑，在展开时调用：
```typescript
loadShellLogSessions(project);
```

- [ ] **Step 4: 在 shellLogVersion 变化时刷新所有展开项目的 shell sessions**

```typescript
useEffect(() => {
  if (!shellLogVersion) return;
  expandedProjects.forEach((projectName) => {
    const project = projects.find((p) => p.name === projectName);
    if (project) loadShellLogSessions(project);
  });
}, [shellLogVersion, expandedProjects, projects, loadShellLogSessions]);
```

- [ ] **Step 5: 在返回值中暴露 shellLogSessionsByProject**

在 `useSidebarController` 的 return 对象中添加：
```typescript
shellLogSessionsByProject,
```

- [ ] **Step 6: Sidebar.tsx — 传递 shellLogVersion 和 shellLogSessionsByProject**

读取 `src/components/sidebar/view/Sidebar.tsx`，确认它接收 `sidebarSharedProps` 并传给 `useSidebarController`。在 Sidebar 的 props 类型和调用链中传递 `shellLogVersion`，并把 `shellLogSessionsByProject` 传给 `SidebarProjectSessions`。

### 10b: SidebarProjectSessions.tsx

- [ ] **Step 7: 添加 shellLogSessions prop 并渲染**

在 `SidebarProjectSessionsProps` 中添加：
```typescript
shellLogSessions?: import('../../../../types/app').ShellLogSession[];
onShellLogSessionSelect: (session: import('../../../../types/app').ShellLogSession) => void;
onDeleteShellLogSession: (projectName: string, logId: string) => void;
```

在组件末尾、"New Session" 按钮之前，添加 shell log sessions 的渲染：

```tsx
{shellLogSessions && shellLogSessions.length > 0 && (
  <div className="mt-1">
    <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
      <Terminal className="h-3 w-3" />
      <span>{t('sessions.shellLogs', 'Shell Logs')}</span>
    </div>
    {shellLogSessions.map((log) => (
      <button
        key={log.id}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
        onClick={() => onShellLogSessionSelect(log)}
      >
        <Terminal className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">
            {log.provider === 'plain-shell' ? 'Shell' : 'Claude'} — {new Date(log.startedAt).toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground">
            {log.lineCount} 行{log.endedAt ? '' : ' (进行中)'}
          </div>
        </div>
      </button>
    ))}
  </div>
)}
```

在文件顶部导入 `Terminal`：
```typescript
import { ChevronDown, Plus, Terminal } from 'lucide-react';
```

- [ ] **Step 8: 提交**

```bash
git add src/components/sidebar/hooks/useSidebarController.ts \
        src/components/sidebar/view/Sidebar.tsx \
        src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx
git commit -m "feat(shell-log): show shell log sessions in sidebar"
```

---

## Task 11: 创建 ShellLogViewer 组件

**Files:**
- Create: `src/components/shell-log/hooks/useShellLogContent.ts`
- Create: `src/components/shell-log/view/ShellLogViewer.tsx`

### 11a: useShellLogContent.ts

- [ ] **Step 1: 创建目录和 hook 文件**

```typescript
// src/components/shell-log/hooks/useShellLogContent.ts
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import type { ShellLogSession } from '../../../types/app';

export function useShellLogContent(session: ShellLogSession | null, projectName: string | undefined) {
  const [content, setContent] = useState('');
  const [lineCount, setLineCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !projectName) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.shellSessionContent(projectName, session.id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { content: string; lineCount: number };
      setContent(data.content);
      setLineCount(data.lineCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }, [session, projectName]);

  useEffect(() => {
    load();
  }, [load]);

  return { content, lineCount, isLoading, error, reload: load };
}
```

### 11b: ShellLogViewer.tsx

- [ ] **Step 2: 创建 ShellLogViewer 组件**

```tsx
// src/components/shell-log/view/ShellLogViewer.tsx
import React from 'react';
import { Terminal } from 'lucide-react';
import type { Project, ShellLogSession } from '../../../types/app';
import { useShellLogContent } from '../hooks/useShellLogContent';

type ShellLogViewerProps = {
  project: Project;
  session: ShellLogSession;
};

export default function ShellLogViewer({ project, session }: ShellLogViewerProps) {
  const { content, lineCount, isLoading, error, reload } = useShellLogContent(session, project.name);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
        <Terminal className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">
          {session.provider === 'plain-shell' ? 'Shell Log' : 'Claude Shell Log'}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">
          {new Date(session.startedAt).toLocaleString()}
        </span>
        {session.endedAt && (
          <>
            <span className="text-muted-foreground">→</span>
            <span className="text-xs text-muted-foreground">
              {new Date(session.endedAt).toLocaleString()}
            </span>
          </>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{lineCount} 行</span>
        <button
          onClick={reload}
          className="ml-2 rounded px-2 py-0.5 text-xs hover:bg-accent"
        >
          刷新
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading && (
          <div className="text-sm text-muted-foreground">加载中...</div>
        )}
        {error && (
          <div className="text-sm text-destructive">加载失败：{error}</div>
        )}
        {!isLoading && !error && (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
            {content || '（日志为空）'}
          </pre>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add src/components/shell-log/
git commit -m "feat(shell-log): add ShellLogViewer component and useShellLogContent hook"
```

---

## Task 12: MainContent 渲染 ShellLogViewer

**Files:**
- Modify: `src/components/main-content/view/MainContent.tsx`

- [ ] **Step 1: 导入 ShellLogViewer**

在 `MainContent.tsx` 顶部的 import 区域添加：
```typescript
import ShellLogViewer from '../../shell-log/view/ShellLogViewer';
import type { ShellLogSession } from '../../../types/app';
```

- [ ] **Step 2: 添加 shell-log 分支渲染**

找到 `activeTab === 'shell'` 的渲染块（约第 152-156 行）：
```tsx
{shellVisitedRef.current && (
  <div className={`h-full w-full overflow-hidden ${activeTab === 'shell' ? '' : 'hidden'}`}>
    <StandaloneShell ... />
  </div>
)}
```

在这个块之后，添加 shell-log viewer：
```tsx
{selectedSession?.__provider === 'shell-log' && activeTab === 'shell' && (
  <div className="h-full overflow-hidden">
    <ShellLogViewer
      project={selectedProject}
      session={selectedSession as ShellLogSession}
    />
  </div>
)}
```

同时，当 `selectedSession?.__provider === 'shell-log'` 时，应隐藏 Shell terminal（在 `StandaloneShell` 的外层 div 上增加条件）：
```tsx
{shellVisitedRef.current && selectedSession?.__provider !== 'shell-log' && (
  <div className={`h-full w-full overflow-hidden ${activeTab === 'shell' ? '' : 'hidden'}`}>
    <StandaloneShell ... />
  </div>
)}
```

- [ ] **Step 3: 当点击 shell-log session 时切换到 shell tab**

在 `useSidebarController.ts` 中，`onShellLogSessionSelect` 回调应调用 `onSessionSelect` 并把会话转成 `ProjectSession` 格式，同时 `useProjectsState.ts` 的 `handleSessionSelect` 需要在 `shell-log` provider 时把 `activeTab` 切换为 `'shell'`。

检查 `handleSessionSelect`（`useProjectsState.ts` 约第 400-413 行）：
```typescript
const handleSessionSelect = useCallback(
  (session: ProjectSession) => {
    setSelectedSession(session);
    if (session.__provider === 'shell-log') {
      setActiveTab('shell');
    } else if (activeTab !== 'chat') {
      setActiveTab('chat');
    }
    // ...
  },
  [...]
);
```

- [ ] **Step 4: 提交**

```bash
git add src/components/main-content/view/MainContent.tsx \
        src/hooks/useProjectsState.ts
git commit -m "feat(shell-log): render ShellLogViewer in MainContent for shell-log sessions"
```

---

## Task 13: 端到端验证

- [ ] **Step 1: 构建并启动**

```bash
npm run build && npm start
# 或开发模式：
npm run dev
```

- [ ] **Step 2: 验证链路 B（Shell Log）**

1. 打开浏览器，进入某个项目
2. 点击 "New Session"，切换到 Shell tab
3. 在终端里运行几条命令（如 `ls`、`echo hello`）
4. 退出 PTY（`exit` 或关闭）
5. 检查 `~/.claude/shell-logs/{userId}/` 目录，应有 `.txt` 和 `.meta.json` 文件
6. 展开侧边栏项目，应看到 "Shell Logs" 区域和对应的 session 条目
7. 点击条目，右侧展示文本日志内容

- [ ] **Step 3: 验证链路 A（Claude Session ID 跟踪）**

1. 点击 "New Session"，Shell 启动 Claude CLI
2. 在 Claude CLI 里发一条消息（触发 JSONL 写入）
3. 侧边栏应出现新的 Claude session 条目
4. `selectedSession.id` 应已更新为真实 UUID（可在 React DevTools 中检查）
5. 刷新页面后，点击侧边栏的 session 应能用 `--resume` 恢复对话

- [ ] **Step 4: 最终提交（如有剩余未提交改动）**

```bash
git add -A
git commit -m "feat(shell-log): complete shell session persistence (Link A + Link B)"
git push origin main
```
