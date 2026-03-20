#!/usr/bin/env node
// Load environment variables before other imports execute
import './load-env.js';
import { validateConfig } from './config/validateConfig.js';
validateConfig();


import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const installMode = fs.existsSync(path.join(__dirname, '..', '.git')) ? 'git' : 'npm';

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

console.log('PORT from env:', process.env.PORT);

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import http from 'http';
import cors from 'cors';
import { promises as fsPromises } from 'fs';

import { getProjects, clearProjectDirectoryCache } from './projects.js';
import legacySessionManager from './sessionManager.js';
import gitRoutes from './routes/git.js';
import authRoutes from './routes/auth.js';
import mcpRoutes from './routes/mcp.js';
import cursorRoutes from './routes/cursor.js';
import taskmasterRoutes from './routes/taskmaster.js';
import mcpUtilsRoutes from './routes/mcp-utils.js';
import commandsRoutes from './routes/commands.js';
import settingsRoutes from './routes/settings.js';
import agentRoutes from './routes/agent.js';
import projectsRoutes from './routes/projects.js';
import cliAuthRoutes from './routes/cli-auth.js';
import userRoutes from './routes/user.js';
import codexRoutes from './routes/codex.js';
import geminiRoutes from './routes/gemini.js';
import claudeCliRoutes from './routes/claude-cli.js';
import systemRoutes from './routes/system.js';
import sessionsRoutes from './routes/sessions.js';
import filesystemRoutes from './routes/filesystem.js';
import projectFilesRoutes from './routes/project-files.js';
import transcribeRoutes from './routes/transcribe.js';
import { initializeDatabase, userProjectsDb, userDb } from './database/db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';
import { authLimiter, apiLimiter } from './middleware/rateLimiter.js';
import { errorHandler, setupGlobalErrorHandlers } from './middleware/errorHandler.js';
import { IS_PLATFORM } from './constants/config.js';
import { ConnectionRegistry } from './websocket/ConnectionRegistry.js';
import { TransportLayer } from './websocket/TransportLayer.js';
import { ShellHandler } from './websocket/ShellHandler.js';
import { ChatHandler, WebSocketWriter } from './websocket/ChatHandler.js';
import { resolveToolApproval, getPendingApprovalsForSession, isClaudeSDKSessionActive, getActiveClaudeSDKSessions, reconnectSessionWriter } from './claude-sdk.js';
import { getActiveCursorSessions } from './cursor-cli.js';
import { getActiveCodexSessions } from './openai-codex.js';
import { getActiveGeminiSessions } from './gemini-cli.js';
import { SessionManager } from './session/SessionManager.js';
import { ProcessManager } from './session/ProcessManager.js';
import { MessageBuffer } from './message/MessageBuffer.js';
import { MessageRouter } from './message/MessageRouter.js';
import { ClaudeSDKProvider } from './providers/claude-sdk.js';
import { ClaudeCLIProvider } from './providers/claude-cli.js';
import { CursorCLIProvider } from './providers/cursor-cli.js';
import { GeminiCLIProvider } from './providers/gemini-cli.js';
import { OpenAICodexProvider } from './providers/openai-codex.js';

// Set up global error handlers early (after all imports)
setupGlobalErrorHandlers();

// File system watchers for provider project/session folders
const PROVIDER_WATCH_PATHS = [
    { provider: 'claude', rootPath: path.join(os.homedir(), '.claude', 'projects') },
    { provider: 'cursor', rootPath: path.join(os.homedir(), '.cursor', 'chats') },
    { provider: 'codex', rootPath: path.join(os.homedir(), '.codex', 'sessions') },
    { provider: 'gemini', rootPath: path.join(os.homedir(), '.gemini', 'projects') },
    { provider: 'gemini_sessions', rootPath: path.join(os.homedir(), '.gemini', 'sessions') }
];
const WATCHER_IGNORED_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/*.tmp',
    '**/*.swp',
    '**/.DS_Store'
];
const WATCHER_DEBOUNCE_MS = 300;
let projectsWatchers = [];
let projectsWatcherDebounceTimer = null;
let isGetProjectsRunning = false; // Flag to prevent reentrant calls

// Broadcast progress to all connected WebSocket clients
function broadcastProgress(progress) {
    const message = JSON.stringify({
        type: 'loading_progress',
        ...progress
    });
    registry.getAllByType('chat').forEach((conn) => {
        if (conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(message);
        }
    });
}

// Setup file system watchers for Claude, Cursor, and Codex project/session folders
async function setupProjectsWatcher() {
    const chokidar = (await import('chokidar')).default;

    if (projectsWatcherDebounceTimer) {
        clearTimeout(projectsWatcherDebounceTimer);
        projectsWatcherDebounceTimer = null;
    }

    await Promise.all(
        projectsWatchers.map(async (watcher) => {
            try {
                await watcher.close();
            } catch (error) {
                console.error('[WARN] Failed to close watcher:', error);
            }
        })
    );
    projectsWatchers = [];

    const debouncedUpdate = (eventType, filePath, provider, rootPath) => {
        if (projectsWatcherDebounceTimer) {
            clearTimeout(projectsWatcherDebounceTimer);
        }

        projectsWatcherDebounceTimer = setTimeout(async () => {
            // Prevent reentrant calls
            if (isGetProjectsRunning) {
                return;
            }

            try {
                isGetProjectsRunning = true;

                // Clear project directory cache when files change
                clearProjectDirectoryCache();

                // Get updated projects list
                const updatedProjects = await getProjects(broadcastProgress);

                // Notify all connected clients about the project changes (per-user filtering)
                registry.getAllByType('chat').forEach((conn) => {
                    const client = conn.ws;
                    if (client.readyState === WebSocket.OPEN) {
                        let projectsForClient = updatedProjects;
                        if (conn.userId) {
                            const ownedNames = userProjectsDb.getProjectNames(conn.userId);
                            projectsForClient = updatedProjects.filter(p => ownedNames.has(p.name));
                        }
                        const updateMessage = JSON.stringify({
                            type: 'projects_updated',
                            projects: projectsForClient,
                            timestamp: new Date().toISOString(),
                            changeType: eventType,
                            changedFile: path.relative(rootPath, filePath),
                            watchProvider: provider
                        });
                        client.send(updateMessage);
                    }
                });

            } catch (error) {
                console.error('[ERROR] Error handling project changes:', error);
            } finally {
                isGetProjectsRunning = false;
            }
        }, WATCHER_DEBOUNCE_MS);
    };

    for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
        try {
            // chokidar v4 emits ENOENT via the "error" event for missing roots and will not auto-recover.
            // Ensure provider folders exist before creating the watcher so watching stays active.
            await fsPromises.mkdir(rootPath, { recursive: true });

            // Initialize chokidar watcher with optimized settings
            const watcher = chokidar.watch(rootPath, {
                ignored: WATCHER_IGNORED_PATTERNS,
                persistent: true,
                ignoreInitial: true, // Don't fire events for existing files on startup
                followSymlinks: false,
                depth: 10, // Reasonable depth limit
                awaitWriteFinish: {
                    stabilityThreshold: 100, // Wait 100ms for file to stabilize
                    pollInterval: 50
                }
            });

            // Set up event listeners
            watcher
                .on('add', (filePath) => debouncedUpdate('add', filePath, provider, rootPath))
                .on('change', (filePath) => debouncedUpdate('change', filePath, provider, rootPath))
                .on('unlink', (filePath) => debouncedUpdate('unlink', filePath, provider, rootPath))
                .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath, provider, rootPath))
                .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath, provider, rootPath))
                .on('error', (error) => {
                    console.error(`[ERROR] ${provider} watcher error:`, error);
                })
                .on('ready', () => {
                });

            projectsWatchers.push(watcher);
        } catch (error) {
            console.error(`[ERROR] Failed to setup ${provider} watcher for ${rootPath}:`, error);
        }
    }

    if (projectsWatchers.length === 0) {
        console.error('[ERROR] Failed to setup any provider watchers');
    }
}


const app = express();
const server = http.createServer(app);

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({
    server,
    verifyClient: (info) => {
        console.log('WebSocket connection attempt to:', info.req.url);

        // Platform mode: always allow connection
        if (IS_PLATFORM) {
            const user = authenticateWebSocket(null); // Will return first user
            if (!user) {
                console.log('[WARN] Platform mode: No user found in database');
                return false;
            }
            info.req.user = user;
            console.log('[OK] Platform mode WebSocket authenticated for user:', user.username);
            return true;
        }

        // Normal mode: verify token
        // Extract token from query parameters or headers
        const url = new URL(info.req.url, 'http://localhost');
        const token = url.searchParams.get('token') ||
            info.req.headers.authorization?.split(' ')[1];

        // Verify token
        const user = authenticateWebSocket(token);
        if (!user) {
            console.log('[WARN] WebSocket authentication failed');
            return false;
        }

        // Store user info in the request for later use
        info.req.user = user;
        console.log('[OK] WebSocket authenticated for user:', user.username);
        return true;
    }
});

const registry = new ConnectionRegistry();
const transport = new TransportLayer(registry);
registry.startZombieScan();
transport.start();
const shellHandler = new ShellHandler(registry, transport);
const sessionManager = new SessionManager();
const processManager = new ProcessManager();
const messageBuffer = new MessageBuffer();

// Register Provider adapters
processManager.registerProvider('claude', ClaudeSDKProvider);
processManager.registerProvider('claude-cli', ClaudeCLIProvider);
processManager.registerProvider('cursor', CursorCLIProvider);
processManager.registerProvider('gemini', GeminiCLIProvider);
processManager.registerProvider('codex', OpenAICodexProvider);

// Create MessageRouter and bind events (P3: application layer)
const router = new MessageRouter({ transport, sessionManager, processManager, messageBuffer, registry });
router.bindEvents();

// ─── Single pipeline: router → ProcessManager → Provider adapters ────────────
// No bridge, no dual paths. Provider adapters emit events → ProcessManager →
// SessionManager transitions + MessageBuffer + transport.send() (via bindEvents)

router.on('router:startSession', ({ sessionId, providerType, connectionId, message }) => {
  const conn = registry.get(connectionId);
  if (!conn) return;

  const writer = new WebSocketWriter(conn.ws);
  writer.setSessionId(sessionId);

  processManager.startSession(sessionId, providerType, {
    command: message.command,
    options: message.options || {},
    writer,
    transport,
    connectionId,
  });
});

// Permission responses: forward to Claude SDK (only Claude SDK uses permissions)
router.on('router:permissionResponse', ({ connectionId, message }) => {
  if (message.requestId) {
    resolveToolApproval(message.requestId, {
      allow: Boolean(message.allow),
      updatedInput: message.updatedInput,
      message: message.message,
      rememberEntry: message.rememberEntry
    });
  }
});

// Session status: use ProcessManager for active check, fall back to old providers for reconnect
router.on('router:checkStatus', ({ connectionId, message }) => {
  const sessionId = message.sessionId;
  const isActive = processManager.isActive(sessionId);

  // Claude SDK reconnect: swap writer to new WebSocket on page refresh
  if (isActive && (message.provider === 'claude' || !message.provider)) {
    const conn = registry.get(connectionId);
    if (conn) reconnectSessionWriter(sessionId, conn.ws);
  }

  transport.send(connectionId, {
    type: 'session-status',
    sessionId,
    provider: message.provider || 'claude',
    isProcessing: isActive
  });
});

// Pending permissions: query Claude SDK
router.on('router:getPendingPermissions', ({ connectionId, message }) => {
  const sessionId = message.sessionId;
  if (sessionId && isClaudeSDKSessionActive(sessionId)) {
    const pending = getPendingApprovalsForSession(sessionId);
    transport.send(connectionId, {
      type: 'pending-permissions-response',
      sessionId,
      data: pending
    });
  }
});

// Active sessions: aggregate from ProcessManager + old provider tracking
router.on('router:getActiveSessions', ({ connectionId }) => {
  transport.send(connectionId, {
    type: 'active-sessions',
    sessions: {
      claude: getActiveClaudeSDKSessions(),
      cursor: getActiveCursorSessions(),
      codex: getActiveCodexSessions(),
      gemini: getActiveGeminiSessions()
    }
  });
});

const chatHandler = new ChatHandler({ registry, transport, router });

sessionManager.on('session:stateChanged', ({ sessionId, from, to, event }) => {
  console.log(`[Index] Session ${sessionId}: ${from} → ${to} (event: ${event})`);
});

// Make WebSocket server and shared helpers available to routes
app.locals.wss = wss;
app.locals.broadcastProgress = broadcastProgress;

app.use(cors());
app.use(express.json({
    limit: '50mb',
    type: (req) => {
        // Skip multipart/form-data requests (for file uploads like images)
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return false;
        }
        return contentType.includes('json');
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        installMode
    });
});

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// General API rate limiter (applied after health check, before authenticated routes)
app.use('/api', apiLimiter);

// Authentication routes (public) — stricter rate limit
app.use('/api/auth', authLimiter, authRoutes);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectsRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);

// Cursor API Routes (protected)
app.use('/api/cursor', authenticateToken, cursorRoutes);

// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);

// MCP utilities
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Codex API Routes (protected)
app.use('/api/codex', authenticateToken, codexRoutes);

// Gemini API Routes (protected)
app.use('/api/gemini', authenticateToken, geminiRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

// Claude CLI API Routes (protected)
app.use('/api/claude-cli', authenticateToken, claudeCliRoutes);

// System API Routes (protected)
app.use('/api/system', authenticateToken, systemRoutes);

// Sessions API Routes (protected)
app.use('/api/sessions', authenticateToken, sessionsRoutes);

// Filesystem browse/create Routes (protected)
app.use('/api', authenticateToken, filesystemRoutes);

// Project files + CRUD routes (protected) — replaces inline /api/projects routes
app.use('/api/projects', authenticateToken, projectFilesRoutes);

// Audio transcription Routes (protected)
app.use('/api', authenticateToken, transcribeRoutes);

// Serve public files (like api-docs.html)
app.use(express.static(path.join(__dirname, '../public')));

// Static files served after API routes
// Add cache control: HTML files should not be cached, but assets can be cached
app.use(express.static(path.join(__dirname, '../dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            // Prevent HTML caching to avoid service worker issues after builds
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
            // Cache static assets for 1 year (they have hashed names)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
    const url = request.url;
    console.log('[INFO] Client connected to:', url);

    const urlObj = new URL(url, 'http://localhost');
    const pathname = urlObj.pathname;

    const userId = request.user?.userId || request.user?.id || 0;
    const username = request.user?.username || 'anonymous';

    if (pathname === '/shell') {
        const connectionId = registry.register(ws, 'shell', userId, username);
        ws._connectionId = connectionId;
        shellHandler.handleConnection(ws, connectionId);
    } else if (pathname === '/ws') {
        const connectionId = registry.register(ws, 'chat', userId, username);
        ws._connectionId = connectionId;
        chatHandler.handleConnection(ws, request, connectionId);
    } else {
        console.log('[WARN] Unknown WebSocket path:', pathname);
        ws.close();
    }
});

// (handleChatConnection moved to server/websocket/ChatHandler.js)
// (handleShellConnection moved to server/websocket/ShellHandler.js)

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
    // Skip requests for static assets (files with extensions)
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }

    // Only serve index.html for HTML routes, not for static assets
    // Static assets should already be handled by express.static middleware above
    const indexPath = path.join(__dirname, '../dist/index.html');

    // Check if dist/index.html exists (production build available)
    if (fs.existsSync(indexPath)) {
        // Set no-cache headers for HTML to prevent service worker issues
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    } else {
        // In development, redirect to Vite dev server only if dist doesn't exist
        res.redirect(`http://localhost:${process.env.VITE_PORT || 5173}`);
    }
});

// 404 handler (after all routes, before error handler)
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
// Show localhost in URL when binding to all interfaces (0.0.0.0 isn't a connectable address)
const DISPLAY_HOST = HOST === '0.0.0.0' ? 'localhost' : HOST;

// Initialize database and start server
async function startServer() {
    try {
        // Initialize authentication database
        await initializeDatabase();

        // One-time fix: reassign wrongly-assigned projects to the first user
        const firstUser = userDb.getFirstUser();
        if (firstUser) {
            userProjectsDb.reassignAllToFirstUser(firstUser.id);
        }

        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(__dirname, '../dist/index.html');
        const isProduction = fs.existsSync(distIndexPath);

        // Log Claude implementation mode
        console.log(`${c.info('[INFO]')} Using Claude Agents SDK for Claude integration`);
        console.log(`${c.info('[INFO]')} Running in ${c.bright(isProduction ? 'PRODUCTION' : 'DEVELOPMENT')} mode`);

        if (!isProduction) {
            console.log(`${c.warn('[WARN]')} Note: Requests will be proxied to Vite dev server at ${c.dim('http://localhost:' + (process.env.VITE_PORT || 5173))}`);
        }

        server.listen(PORT, HOST, async () => {
            const appInstallPath = path.join(__dirname, '..');

            console.log('');
            console.log(c.dim('═'.repeat(63)));
            console.log(`  ${c.bright('Claude Code UI Server - Ready')}`);
            console.log(c.dim('═'.repeat(63)));
            console.log('');
            console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://' + DISPLAY_HOST + ':' + PORT)}`);
            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "cloudcli status" for full configuration details`);
            console.log('');

            // Start watching the projects folder for changes
            await setupProjectsWatcher();
        });
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown: clean up transport and registry
process.on('SIGTERM', () => {
    transport.stop();
    registry.dispose();
    shellHandler.dispose();
    sessionManager.dispose();
    processManager.dispose();
    process.exit(0);
});
process.on('SIGINT', () => {
    transport.stop();
    registry.dispose();
    shellHandler.dispose();
    sessionManager.dispose();
    processManager.dispose();
    process.exit(0);
});

startServer();
