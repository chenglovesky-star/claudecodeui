# Shell Session 持久化设计文档

**日期**：2026-03-30
**状态**：已批准，待实施

---

## 目标

让 Shell 模式的聊天记录与 Chat 模式保持一致：永久保存、侧边栏展示、支持恢复。

具体包含两条并行链路：
1. **链路 A**：Shell 里运行的 Claude CLI 对话，正确出现在侧边栏并支持 `--resume` 恢复
2. **链路 B**：Shell 里的终端原始输出，以文本日志形式持久化，侧边栏可查看历史

---

## 现状分析

### Chat 模式（已工作）

- Claude CLI 自动将对话写入 `~/.claude/projects/{project}/{uuid}.jsonl`
- chokidar 监听该目录，文件变化触发 `projects_updated` 广播
- 前端更新侧边栏 session 列表

### Shell 模式（当前问题）

| 问题 | 原因 |
|------|------|
| Session 不出现在侧边栏 | ShellHandler 不写 JSONL，侧边栏 API 只读 JSONL |
| PTY 连接被意外断开 | `projects_updated` 触发 `setSelectedSession(null)` → `disconnectFromShell()`（已有 hotfix） |
| `selectedSession` 不更新为真实 UUID | Shell 没有 `session-created` 通知机制 |
| 终端输出不持久化 | 仅内存缓冲 5000 行，进程退出后消失 |

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     两条并行持久化链路                          │
├──────────────────────┬──────────────────────────────────────┤
│  链路 A               │  链路 B                              │
│  Claude CLI 对话       │  纯终端输出                          │
├──────────────────────┼──────────────────────────────────────┤
│ PTY 启动 `claude`      │ PTY 启动（任意命令）                  │
│   ↓                   │   ↓                                  │
│ Claude CLI 写 JSONL   │ ShellHandler.onData()               │
│ ~/.claude/projects/   │   → strip-ansi                      │
│   ↓                   │   → appendFileSync                  │
│ chokidar 检测新文件    │ ~/.claude/shell-logs/               │
│   → shell-session-    │   {projectHash}/{sessionId}.txt     │
│     created 发给前端   │   ↓                                  │
│   ↓                   │ chokidar 监听 shell-logs/            │
│ 前端更新               │   → projects_updated                │
│ selectedSession → UUID│   ↓                                  │
│   ↓                   │ 侧边栏出现 Shell Log 条目             │
│ 侧边栏展示 ✓           │   ↓                                  │
│ --resume 恢复 ✓        │ 点击 → ShellLogViewer 展示文本       │
└──────────────────────┴──────────────────────────────────────┘
```

---

## 详细设计

### 后端 — 链路 A：Claude CLI Session ID 跟踪

**文件**：`server/websocket/ShellHandler.js`

当 provider 为 `claude` 时，在 PTY 启动后监听 `~/.claude/projects/{projectHash}/` 目录。当检测到新 JSONL 文件被创建时（`chokidar add` 事件），提取文件名作为真实 sessionId，通过 WebSocket 向前端发送：

```javascript
{
  type: 'shell-session-created',
  sessionId: 'real-uuid-from-claude-cli',
  provider: 'claude'
}
```

监听仅在本次 PTY 会话生命周期内有效，PTY 退出后移除监听器。

**前端**：`src/components/shell/hooks/useShellConnection.ts`

收到 `shell-session-created` 消息后，调用上层回调通知 `useProjectsState` 更新 `selectedSession`：

```typescript
// useShellConnection.ts 新增回调 prop
onShellSessionCreated?: (sessionId: string) => void;
```

`useProjectsState.ts` 中的 `handleNewSession` 注册该回调，收到后调用 `setSelectedSession` 更新为真实 UUID。

---

### 后端 — 链路 B：Shell 输出持久化

**新增文件**：`server/shell-log-manager.js`

```javascript
class ShellLogManager {
  // 日志根目录
  logsDir = path.join(os.homedir(), '.claude', 'shell-logs')

  // 为 PTY 会话创建日志文件，返回 logId
  createLog(projectPath, sessionId) → logId

  // 追加一行输出（已剥离 ANSI）
  appendLine(logId, text)

  // 关闭日志（PTY 退出时调用）
  closeLog(logId)

  // 列举某项目的所有 shell log session
  getProjectLogs(projectName) → LogSession[]

  // 读取日志内容（分页）
  getLogContent(logId, offset, limit) → { lines, hasMore }
}
```

**文件路径规则**：
```
~/.claude/shell-logs/
  {md5(projectPath)}/
    {sessionId}_{yyyyMMdd-HHmmss}.txt    # 日志文件
    {sessionId}_{yyyyMMdd-HHmmss}.meta.json  # 元数据（项目路径、开始时间、命令等）
```

**元数据格式**：
```json
{
  "id": "sessionId_timestamp",
  "projectPath": "/workspace/mlzhao",
  "projectName": "mlzhao",
  "startedAt": "2026-03-30T10:00:00Z",
  "endedAt": "2026-03-30T11:00:00Z",
  "provider": "claude" | "plain-shell",
  "lineCount": 1234
}
```

**ANSI 剥离**：使用 `strip-ansi` npm 包（项目已有依赖，或新增），在 `appendLine` 中调用。

**ShellHandler.js 集成**：
```javascript
// PTY 启动时
const logId = shellLogManager.createLog(projectPath, sessionId);

// 输出时
shellProcess.onData((data) => {
  shellLogManager.appendLine(logId, data);  // 新增这一行
  // ... 原有逻辑不变
});

// PTY 退出时
shellProcess.onExit(() => {
  shellLogManager.closeLog(logId);
  // ... 原有逻辑不变
});
```

**新增 API 路由**（`server/routes/project-files.js`）：
```
GET  /api/projects/:name/shell-sessions
     → { sessions: LogSession[], hasMore, total }

GET  /api/projects/:name/shell-sessions/:id/content?offset=0&limit=500
     → { lines: string[], hasMore, total }

DELETE /api/projects/:name/shell-sessions/:id
     → 204
```

**chokidar 监听**（`server/index.js`）：
```javascript
const PROVIDER_WATCH_PATHS = [
  { provider: 'claude', rootPath: path.join(os.homedir(), '.claude', 'projects') },
  { provider: 'shell-log', rootPath: path.join(os.homedir(), '.claude', 'shell-logs') }, // 新增
];
```

`projects_updated` 消息的 `watchProvider` 字段已有，前端可据此判断是否需要刷新 shell log 列表。

---

### 前端设计

#### 1. `useShellConnection.ts`

新增 `onShellSessionCreated` 回调 prop，在 `socket.onmessage` 中处理 `shell-session-created` 消息类型。

#### 2. `useProjectsState.ts`

`handleNewSession` 向 Shell 组件传入 `onShellSessionCreated` 回调：

```typescript
const handleShellSessionCreated = useCallback((realSessionId: string) => {
  setSelectedSession(prev => prev ? { ...prev, id: realSessionId } : prev);
}, []);
```

#### 3. 侧边栏 — Shell Log Session 展示

`SidebarProjectSessions.tsx` 在项目展开时，除现有 `sessions` 外，额外渲染 `shellLogSessions`，使用终端图标（`Terminal` from lucide-react）区分，其余样式与现有 session 条目一致。

`useSidebarController.ts` 新增 `loadShellSessions(project)` 方法，调用 `GET /api/projects/{name}/shell-sessions`。

#### 4. `ShellLogViewer` 组件（新增）

```
src/components/shell-log/
  view/
    ShellLogViewer.tsx      # 主容器，加载并展示日志内容
  hooks/
    useShellLogContent.ts   # 数据获取，支持分页加载
```

UI：`<pre>` + 虚拟滚动（日志行数可能很多），顶部显示元数据（项目路径、时间、行数），底部"加载更多"按钮。

`MainContent.tsx` 根据 `selectedSession.__provider === 'shell-log'` 渲染 `ShellLogViewer` 替代 `ChatInterface`。

---

## 数据流汇总

```
用户点击 New Session
  → handleNewSession → selectedSession = { id: 'new-{ts}' }
  → Shell 连接 → PTY 启动 claude
  → ShellHandler 开始监听 ~/.claude/projects/{hash}/
  → Claude CLI 创建 {uuid}.jsonl
  → chokidar add → ShellHandler 发送 shell-session-created { sessionId: uuid }
  → 前端 handleShellSessionCreated → selectedSession = { id: uuid }
  → projects_updated → 侧边栏出现 Claude CLI session ✓

  同时：
  → ShellLogManager.createLog()
  → 每条输出 → appendLine() → strip-ansi → 追加到 .txt
  → 退出时 closeLog()
  → chokidar change/add → projects_updated
  → 侧边栏出现 Shell Log session ✓
```

---

## 不在本次范围内

- 终端录屏回放（ANSI 状态还原）
- Shell Log 的搜索功能
- Shell Log 的导出功能
- Shell Log 的自动清理策略（文件过大时）

---

## 涉及文件清单

| 类型 | 文件 |
|------|------|
| 新增 | `server/shell-log-manager.js` |
| 新增 | `src/components/shell-log/view/ShellLogViewer.tsx` |
| 新增 | `src/components/shell-log/hooks/useShellLogContent.ts` |
| 修改 | `server/websocket/ShellHandler.js` |
| 修改 | `server/index.js`（PROVIDER_WATCH_PATHS） |
| 修改 | `server/routes/project-files.js`（新增 shell-sessions 路由） |
| 修改 | `src/components/shell/hooks/useShellConnection.ts` |
| 修改 | `src/hooks/useProjectsState.ts` |
| 修改 | `src/components/sidebar/hooks/useSidebarController.ts` |
| 修改 | `src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx` |
| 修改 | `src/components/main-content/view/MainContent.tsx` |
