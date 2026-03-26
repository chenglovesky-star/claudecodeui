// server/websocket/ShellHandler.js
// 处理 /shell WebSocket 连接，封装 PTY 会话生命周期 (P3)

import os from 'os';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import pty from 'node-pty';
import { WebSocket } from 'ws';
import legacySessionManager from '../sessionManager.js';
import { userMcpDb } from '../database/db.js';
import { PTY_SESSION_TIMEOUT_MS, SHELL_URL_PARSE_BUFFER_LIMIT } from '../config/constants.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Shell');

// ─── URL detection helpers ───────────────────────────────────────────────────

const ANSI_ESCAPE_SEQUENCE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const TRAILING_URL_PUNCTUATION_REGEX = /[)\]}>.,;:!?]+$/;

function stripAnsiSequences(value = '') {
    return value.replace(ANSI_ESCAPE_SEQUENCE_REGEX, '');
}

function normalizeDetectedUrl(url) {
    if (!url || typeof url !== 'string') return null;

    const cleaned = url.trim().replace(TRAILING_URL_PUNCTUATION_REGEX, '');
    if (!cleaned) return null;

    try {
        const parsed = new URL(cleaned);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

function extractUrlsFromText(value = '') {
    const directMatches = value.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/gi) || [];

    // Handle wrapped terminal URLs split across lines by terminal width.
    const wrappedMatches = [];
    const continuationRegex = /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/;
    const lines = value.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const startMatch = line.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/i);
        if (!startMatch) continue;

        let combined = startMatch[0];
        let j = i + 1;
        while (j < lines.length) {
            const continuation = lines[j].trim();
            if (!continuation) break;
            if (!continuationRegex.test(continuation)) break;
            combined += continuation;
            j++;
        }

        wrappedMatches.push(combined.replace(/\r?\n\s*/g, ''));
    }

    return Array.from(new Set([...directMatches, ...wrappedMatches]));
}

function shouldAutoOpenUrlFromOutput(value = '') {
    const normalized = value.toLowerCase();
    return (
        normalized.includes('browser didn\'t open') ||
        normalized.includes('open this url') ||
        normalized.includes('continue in your browser') ||
        normalized.includes('press enter to open') ||
        normalized.includes('open_url:')
    );
}

// ─── Per-user MCP injection ──────────────────────────────────────────────────

/**
 * Write user's MCP servers from DB into the project-level settings.local.json
 * so Claude CLI picks them up when spawned in shell mode.
 */
function injectUserMcpConfig(projectPath, userId) {
    try {
        const rows = userMcpDb.getAll(userId);
        if (!rows || rows.length === 0) return;

        const mcpServers = userMcpDb.toSdkFormat(rows);
        if (Object.keys(mcpServers).length === 0) return;

        // Write to project-level .claude/settings.local.json (per-folder isolation).
        // Each user works in their own project directory, so MCP configs don't conflict.
        // This also avoids the OAuth fallback bug caused by headerless entries in ~/.claude.json.
        const claudeDir = path.join(projectPath, '.claude');
        if (!fsSync.existsSync(claudeDir)) {
            fsSync.mkdirSync(claudeDir, { recursive: true });
        }

        const settingsPath = path.join(claudeDir, 'settings.local.json');
        let settings = {};
        if (fsSync.existsSync(settingsPath)) {
            try {
                settings = JSON.parse(fsSync.readFileSync(settingsPath, 'utf8'));
            } catch {
                settings = {};
            }
        }

        // Merge MCP servers (preserve existing non-MCP settings like permissions)
        settings.mcpServers = { ...(settings.mcpServers || {}), ...mcpServers };
        fsSync.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        log.info(`[MCP] Injected ${Object.keys(mcpServers).length} MCP server(s) for user ${userId} into ${settingsPath}`);
    } catch (err) {
        log.error({ err }, `[MCP] Failed to inject MCP config for user ${userId}`);
    }
}

// ─── ShellHandler ────────────────────────────────────────────────────────────

export class ShellHandler {
    /**
     * @param {import('./ConnectionRegistry.js').ConnectionRegistry} registry
     * @param {import('./TransportLayer.js').TransportLayer} transport
     */
    constructor(registry, transport) {
        this.registry = registry;
        this.transport = transport;
        this.ptySessionsMap = new Map();
    }

    /**
     * Handle a new /shell WebSocket connection.
     * @param {import('ws').WebSocket} ws
     * @param {string} connectionId
     */
    handleConnection(ws, connectionId) {
        const connRecord = this.registry.get(connectionId);
        const userId = connRecord?.userId || 0;
        log.info(`Client connected (user=${userId})`);
        let shellProcess = null;
        let ptySessionKey = null;
        let urlDetectionBuffer = '';
        const announcedAuthUrls = new Set();
        let currentCols = 80;
        let currentRows = 24;

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                log.info(`Message received: ${data.type}`);

                if (data.type === 'init') {
                    const projectPath = data.projectPath || process.cwd();
                    const sessionId = data.sessionId;
                    const hasSession = data.hasSession;
                    const provider = data.provider || 'claude';
                    const initialCommand = data.initialCommand;
                    const isPlainShell = data.isPlainShell || (!!initialCommand && !hasSession) || provider === 'plain-shell';
                    urlDetectionBuffer = '';
                    announcedAuthUrls.clear();

                    // Login commands (Claude/Cursor auth) should never reuse cached sessions
                    const isLoginCommand = initialCommand && (
                        initialCommand.includes('setup-token') ||
                        initialCommand.includes('cursor-agent login') ||
                        initialCommand.includes('auth login')
                    );

                    // Include command hash in session key so different commands get separate sessions
                    const commandSuffix = isPlainShell && initialCommand
                        ? `_cmd_${Buffer.from(initialCommand).toString('base64').slice(0, 16)}`
                        : '';
                    ptySessionKey = `${projectPath}_${sessionId || 'default'}${commandSuffix}`;

                    // Kill any existing login session before starting fresh
                    if (isLoginCommand) {
                        const oldSession = this.ptySessionsMap.get(ptySessionKey);
                        if (oldSession) {
                            log.info(`Cleaning up existing login session: ${ptySessionKey}`);
                            if (oldSession.timeoutId) clearTimeout(oldSession.timeoutId);
                            if (oldSession.pty && oldSession.pty.kill) oldSession.pty.kill();
                            this.ptySessionsMap.delete(ptySessionKey);
                        }
                    }

                    const existingSession = isLoginCommand ? null : this.ptySessionsMap.get(ptySessionKey);
                    if (existingSession) {
                        log.info(`Reconnecting to existing PTY session: ${ptySessionKey}`);
                        shellProcess = existingSession.pty;

                        clearTimeout(existingSession.timeoutId);

                        ws.send(JSON.stringify({
                            type: 'output',
                            data: `\x1b[36m[Reconnected to existing session]\x1b[0m\r\n`
                        }));

                        if (existingSession.buffer && existingSession.buffer.length > 0) {
                            log.info(`Sending ${existingSession.buffer.length} buffered messages`);
                            existingSession.buffer.forEach(bufferedData => {
                                ws.send(JSON.stringify({
                                    type: 'output',
                                    data: bufferedData
                                }));
                            });
                        }

                        existingSession.ws = ws;

                        return;
                    }

                    log.info(`Starting shell in: ${projectPath}`);
                    log.info(`Session info: ${hasSession ? `Resume session ${sessionId}` : (isPlainShell ? 'Plain shell mode' : 'New session')}`);
                    log.info(`Provider: ${isPlainShell ? 'plain-shell' : provider}`);
                    if (initialCommand) {
                        log.info(`Initial command: ${initialCommand}`);
                    }

                    // First send a welcome message
                    let welcomeMsg;
                    if (isPlainShell) {
                        welcomeMsg = `\x1b[36mStarting terminal in: ${projectPath}\x1b[0m\r\n`;
                    } else {
                        const providerName = provider === 'cursor' ? 'Cursor' : (provider === 'codex' ? 'Codex' : (provider === 'gemini' ? 'Gemini' : 'Claude'));
                        welcomeMsg = hasSession ?
                            `\x1b[36mResuming ${providerName} session ${sessionId} in: ${projectPath}\x1b[0m\r\n` :
                            `\x1b[36mStarting new ${providerName} session in: ${projectPath}\x1b[0m\r\n`;
                    }

                    ws.send(JSON.stringify({
                        type: 'output',
                        data: welcomeMsg
                    }));

                    try {
                        // Prepare the shell command adapted to the platform and provider
                        let shellCommand;
                        if (isPlainShell) {
                            // Plain shell mode - just run the initial command in the project directory
                            if (os.platform() === 'win32') {
                                shellCommand = `Set-Location -Path "${projectPath}"; ${initialCommand}`;
                            } else {
                                shellCommand = `cd "${projectPath}" && ${initialCommand}`;
                            }
                        } else if (provider === 'cursor') {
                            // Use cursor-agent command
                            if (os.platform() === 'win32') {
                                if (hasSession && sessionId) {
                                    shellCommand = `Set-Location -Path "${projectPath}"; cursor-agent --resume="${sessionId}"`;
                                } else {
                                    shellCommand = `Set-Location -Path "${projectPath}"; cursor-agent`;
                                }
                            } else {
                                if (hasSession && sessionId) {
                                    shellCommand = `cd "${projectPath}" && cursor-agent --resume="${sessionId}"`;
                                } else {
                                    shellCommand = `cd "${projectPath}" && cursor-agent`;
                                }
                            }

                        } else if (provider === 'codex') {
                            // Use codex command
                            if (os.platform() === 'win32') {
                                if (hasSession && sessionId) {
                                    // Try to resume session, but with fallback to a new session if it fails
                                    shellCommand = `Set-Location -Path "${projectPath}"; codex resume "${sessionId}"; if ($LASTEXITCODE -ne 0) { codex }`;
                                } else {
                                    shellCommand = `Set-Location -Path "${projectPath}"; codex`;
                                }
                            } else {
                                if (hasSession && sessionId) {
                                    // Try to resume session, but with fallback to a new session if it fails
                                    shellCommand = `cd "${projectPath}" && codex resume "${sessionId}" || codex`;
                                } else {
                                    shellCommand = `cd "${projectPath}" && codex`;
                                }
                            }
                        } else if (provider === 'gemini') {
                            // Use gemini command
                            const command = initialCommand || 'gemini';
                            let resumeId = sessionId;
                            if (hasSession && sessionId) {
                                try {
                                    // Gemini CLI enforces its own native session IDs, unlike other agents that accept arbitrary string names.
                                    // The UI only knows about its internal generated `sessionId` (e.g. gemini_1234).
                                    // We must fetch the mapping from the backend session manager to pass the native `cliSessionId` to the shell.
                                    const sess = legacySessionManager.getSession(sessionId);
                                    if (sess && sess.cliSessionId) {
                                        resumeId = sess.cliSessionId;
                                    }
                                } catch (err) {
                                    log.error({ err }, 'Failed to get Gemini CLI session ID');
                                }
                            }

                            if (os.platform() === 'win32') {
                                if (hasSession && resumeId) {
                                    shellCommand = `Set-Location -Path "${projectPath}"; ${command} --resume "${resumeId}"`;
                                } else {
                                    shellCommand = `Set-Location -Path "${projectPath}"; ${command}`;
                                }
                            } else {
                                if (hasSession && resumeId) {
                                    shellCommand = `cd "${projectPath}" && ${command} --resume "${resumeId}"`;
                                } else {
                                    shellCommand = `cd "${projectPath}" && ${command}`;
                                }
                            }
                        } else {
                            // Use claude command (default) or initialCommand if provided
                            const command = initialCommand || 'claude';
                            if (os.platform() === 'win32') {
                                if (hasSession && sessionId) {
                                    // Try to resume session, but with fallback to new session if it fails
                                    shellCommand = `Set-Location -Path "${projectPath}"; claude --resume ${sessionId}; if ($LASTEXITCODE -ne 0) { claude }`;
                                } else {
                                    shellCommand = `Set-Location -Path "${projectPath}"; ${command}`;
                                }
                            } else {
                                if (hasSession && sessionId) {
                                    shellCommand = `cd "${projectPath}" && claude --resume ${sessionId} || claude`;
                                } else {
                                    shellCommand = `cd "${projectPath}" && ${command}`;
                                }
                            }
                        }

                        log.info(`Executing shell command: ${shellCommand}`);

                        // Inject per-user MCP config into project before spawning CLI
                        if (userId && !isPlainShell) {
                            injectUserMcpConfig(projectPath, userId);
                        }

                        // Use appropriate shell based on platform
                        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                        const shellArgs = os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];

                        // Use terminal dimensions from client if provided, otherwise use defaults
                        const termCols = data.cols || 80;
                        const termRows = data.rows || 24;
                        log.info(`Using terminal dimensions: ${termCols} x ${termRows}`);

                        shellProcess = pty.spawn(shell, shellArgs, {
                            name: 'xterm-256color',
                            cols: termCols,
                            rows: termRows,
                            cwd: os.homedir(),
                            env: {
                                ...process.env,
                                TERM: 'xterm-256color',
                                COLORTERM: 'truecolor',
                                FORCE_COLOR: '3'
                            }
                        });

                        log.info(`Shell process started with PTY, PID: ${shellProcess.pid}`);

                        currentCols = termCols;
                        currentRows = termRows;

                        this.ptySessionsMap.set(ptySessionKey, {
                            pty: shellProcess,
                            ws: ws,
                            buffer: [],
                            timeoutId: null,
                            projectPath,
                            sessionId,
                            presetBaseUrl: ''
                        });

                        // Handle data output
                        shellProcess.onData((data) => {
                            const session = this.ptySessionsMap.get(ptySessionKey);
                            if (!session) return;

                            if (session.buffer.length < 5000) {
                                session.buffer.push(data);
                            } else {
                                session.buffer.shift();
                                session.buffer.push(data);
                            }

                            if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                                let outputData = data;

                                const cleanChunk = stripAnsiSequences(data);
                                urlDetectionBuffer = `${urlDetectionBuffer}${cleanChunk}`.slice(-SHELL_URL_PARSE_BUFFER_LIMIT);

                                outputData = outputData.replace(
                                    /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                                    '[INFO] Opening in browser: $1'
                                );

                                const emitAuthUrl = (detectedUrl, autoOpen = false) => {
                                    const normalizedUrl = normalizeDetectedUrl(detectedUrl);
                                    if (!normalizedUrl) return;

                                    const isNewUrl = !announcedAuthUrls.has(normalizedUrl);
                                    if (isNewUrl) {
                                        announcedAuthUrls.add(normalizedUrl);
                                        session.ws.send(JSON.stringify({
                                            type: 'auth_url',
                                            url: normalizedUrl,
                                            autoOpen
                                        }));
                                    }
                                };

                                const normalizedDetectedUrls = extractUrlsFromText(urlDetectionBuffer)
                                    .map((url) => normalizeDetectedUrl(url))
                                    .filter(Boolean);

                                // Prefer the most complete URL if shorter prefix variants are also present.
                                const dedupedDetectedUrls = Array.from(new Set(normalizedDetectedUrls)).filter((url, _, urls) =>
                                    !urls.some((otherUrl) => otherUrl !== url && otherUrl.startsWith(url))
                                );

                                dedupedDetectedUrls.forEach((url) => emitAuthUrl(url, false));

                                if (shouldAutoOpenUrlFromOutput(cleanChunk) && dedupedDetectedUrls.length > 0) {
                                    const bestUrl = dedupedDetectedUrls.reduce((longest, current) =>
                                        current.length > longest.length ? current : longest
                                    );
                                    emitAuthUrl(bestUrl, true);
                                }

                                // Send regular output
                                session.ws.send(JSON.stringify({
                                    type: 'output',
                                    data: outputData
                                }));
                            }
                        });

                        // Handle process exit
                        shellProcess.onExit((exitCode) => {
                            log.info(`Shell process exited with code: ${exitCode.exitCode} signal: ${exitCode.signal}`);
                            const session = this.ptySessionsMap.get(ptySessionKey);
                            if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                                session.ws.send(JSON.stringify({
                                    type: 'output',
                                    data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
                                }));
                            }
                            if (session && session.timeoutId) {
                                clearTimeout(session.timeoutId);
                            }
                            this.ptySessionsMap.delete(ptySessionKey);
                            shellProcess = null;
                        });

                    } catch (spawnError) {
                        log.error({ err: spawnError }, 'Error spawning process');
                        ws.send(JSON.stringify({
                            type: 'output',
                            data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
                        }));
                    }

                } else if (data.type === 'input') {
                    // Send input to shell process
                    if (shellProcess && shellProcess.write) {
                        try {
                            shellProcess.write(data.data);
                        } catch (error) {
                            log.error({ err: error }, 'Error writing to shell');
                        }
                    } else {
                        log.warn('No active shell process to send input to');
                    }
                } else if (data.type === 'resize') {
                    // Handle terminal resize
                    if (shellProcess && shellProcess.resize) {
                        log.info(`Terminal resize requested: ${data.cols} x ${data.rows}`);
                        shellProcess.resize(data.cols, data.rows);
                        currentCols = data.cols;
                        currentRows = data.rows;
                    }
                } else if (data.type === 'paste-image') {
                    // Handle image paste: save to temp file, copy to system clipboard,
                    // and write the file path into the PTY stdin so Claude Code can reference it.
                    try {
                        const base64Data = data.data;
                        const mimeType = data.mimeType || 'image/png';
                        const ext = mimeType === 'image/jpeg' ? '.jpg'
                            : mimeType === 'image/gif' ? '.gif'
                            : mimeType === 'image/webp' ? '.webp'
                            : '.png';

                        const tmpDir = path.join(os.tmpdir(), 'claude-ui-paste');
                        await fs.mkdir(tmpDir, { recursive: true });
                        const tmpFile = path.join(tmpDir, `paste-${Date.now()}${ext}`);
                        await fs.writeFile(tmpFile, Buffer.from(base64Data, 'base64'));
                        log.info(`Image saved to temp file: ${tmpFile}`);

                        // Also copy to system clipboard (best-effort) so CLI can detect it
                        try {
                            if (os.platform() === 'darwin') {
                                const appleClass = mimeType === 'image/jpeg' ? '«class JPEG»'
                                    : mimeType === 'image/gif' ? '«class GIFf»'
                                    : '«class PNGf»';
                                const script = `set the clipboard to (read (POSIX file "${tmpFile}") as ${appleClass})`;
                                await new Promise((resolve, reject) => {
                                    execFile('osascript', ['-e', script], (err) => {
                                        if (err) reject(err); else resolve();
                                    });
                                });
                                log.info('Image copied to system clipboard (macOS)');
                            } else if (os.platform() === 'linux') {
                                await new Promise((resolve, reject) => {
                                    execFile('xclip', ['-selection', 'clipboard', '-t', mimeType, '-i', tmpFile], (err) => {
                                        if (err) reject(err); else resolve();
                                    });
                                });
                                log.info('Image copied to system clipboard (Linux)');
                            }
                        } catch (clipErr) {
                            log.warn({ err: clipErr }, 'Failed to copy image to system clipboard (non-fatal)');
                        }

                        // Write the image file path into the PTY stdin so the user can
                        // reference it in their Claude Code prompt (e.g. "analyze this image: /tmp/...")
                        if (shellProcess && shellProcess.write) {
                            shellProcess.write(tmpFile);
                            log.info(`Image path written to PTY stdin: ${tmpFile}`);
                        }
                    } catch (imgErr) {
                        log.error({ err: imgErr }, 'Error handling paste-image');
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[31m[Image paste failed: ${imgErr.message}]\x1b[0m\r\n`
                            }));
                        }
                    }
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

                        const oldSessionId = session.sessionId;
                        const oldBaseUrl = session.presetBaseUrl || '';
                        if (shellProcess && shellProcess.kill) {
                            shellProcess.kill();
                        }
                        if (session.timeoutId) clearTimeout(session.timeoutId);
                        this.ptySessionsMap.delete(ptySessionKey);

                        // Update ~/.claude/settings.json with preset env vars
                        await this.#updateSettingsJson(preset);

                        const samePlatform = oldBaseUrl === preset.baseUrl && oldSessionId;
                        const shellCmd = samePlatform
                            ? `cd "${projectPath}" && claude --resume ${oldSessionId} || claude`
                            : `cd "${projectPath}" && claude`;

                        const shellBin = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                        const shellArgs = os.platform() === 'win32' ? ['-Command', shellCmd] : ['-c', shellCmd];

                        ws.send(JSON.stringify({
                            type: 'output',
                            data: `\r\n\x1b[36m[正在切换到 ${preset.label} (${preset.model})...]\x1b[0m\r\n`
                        }));

                        shellProcess = pty.spawn(shellBin, shellArgs, {
                            name: 'xterm-256color',
                            cols: currentCols,
                            rows: currentRows,
                            cwd: os.homedir(),
                            env: this.#buildPresetEnv(preset),
                        });

                        ptySessionKey = `${projectPath}_preset_${preset.id}`;
                        urlDetectionBuffer = '';
                        announcedAuthUrls.clear();

                        this.ptySessionsMap.set(ptySessionKey, {
                            pty: shellProcess,
                            ws: ws,
                            buffer: [],
                            timeoutId: null,
                            projectPath,
                            sessionId: oldSessionId,
                            presetBaseUrl: preset.baseUrl,
                        });

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
                            if (s?.timeoutId) clearTimeout(s.timeoutId);
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
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[31m[切换失败: ${switchErr.message}]\x1b[0m\r\n`
                            }));
                        }
                    }
                }
            } catch (error) {
                log.error({ err: error }, 'WebSocket message error');
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                    }));
                }
            }
        });

        ws.on('close', () => {
            log.info('Client disconnected');
            if (connectionId) this.registry.unregister(connectionId);

            if (ptySessionKey) {
                const session = this.ptySessionsMap.get(ptySessionKey);
                if (session) {
                    log.info(`PTY session kept alive, will timeout in 30 minutes: ${ptySessionKey}`);
                    session.ws = null;

                    session.timeoutId = setTimeout(() => {
                        log.info(`PTY session timeout, killing process: ${ptySessionKey}`);
                        if (session.pty && session.pty.kill) {
                            session.pty.kill();
                        }
                        this.ptySessionsMap.delete(ptySessionKey);
                    }, PTY_SESSION_TIMEOUT_MS);
                }
            }
        });

        ws.on('error', (error) => {
            log.error({ err: error }, 'WebSocket error');
        });
    }

    async #readPreset(_projectPath, presetId) {
        // Read from app root, not workspace directory
        const { fileURLToPath } = await import('url');
        const { dirname } = await import('path');
        const appRoot = path.join(dirname(fileURLToPath(import.meta.url)), '..', '..');
        const presetsPath = path.join(appRoot, 'shell-presets.json');
        const raw = await fs.readFile(presetsPath, 'utf-8');
        const presets = JSON.parse(raw);
        return presets.find(p => p.id === presetId) || null;
    }

    async #updateSettingsJson(preset) {
        const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        try {
            let settings = {};
            try {
                const raw = await fs.readFile(settingsPath, 'utf-8');
                settings = JSON.parse(raw);
            } catch {
                // File doesn't exist or invalid — start fresh
            }

            if (!settings.env) settings.env = {};
            settings.env.ANTHROPIC_BASE_URL = preset.baseUrl || '';
            settings.env.ANTHROPIC_AUTH_TOKEN = preset.apiKey || '';
            settings.env.ANTHROPIC_MODEL = preset.model || '';
            settings.env.ANTHROPIC_SMALL_FAST_MODEL = preset.smallFastModel || '';
            settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = preset.defaultSonnetModel || '';
            settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = preset.defaultOpusModel || '';

            await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
            log.info(`Updated settings.json for preset: ${preset.label}`);
        } catch (err) {
            log.error({ err }, 'Failed to update settings.json');
        }
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

    /**
     * Kill all active PTY sessions and clear the map.
     * Called during server shutdown.
     */
    dispose() {
        for (const [key, session] of this.ptySessionsMap) {
            if (session.timeoutId) clearTimeout(session.timeoutId);
            if (session.pty?.kill) session.pty.kill();
        }
        this.ptySessionsMap.clear();
        log.info('All PTY sessions disposed');
    }
}
