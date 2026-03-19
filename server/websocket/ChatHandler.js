// server/websocket/ChatHandler.js
// Handles /ws chat WebSocket connections (extracted from index.js, P3-T3)

import { EventEmitter } from 'events';
import path from 'path';
import { createLogger } from '../config/logger.js';

const log = createLogger('Chat');
import { queryClaudeSDK, abortClaudeSDKSession, isClaudeSDKSessionActive, getActiveClaudeSDKSessions, resolveToolApproval, getPendingApprovalsForSession, reconnectSessionWriter } from '../claude-sdk.js';
import { spawnCursor, abortCursorSession, isCursorSessionActive, getActiveCursorSessions } from '../cursor-cli.js';
import { queryCodex, abortCodexSession, isCodexSessionActive, getActiveCodexSessions } from '../openai-codex.js';
import { spawnGemini, abortGeminiSession, isGeminiSessionActive, getActiveGeminiSessions } from '../gemini-cli.js';
import { spawnClaudeCLI, abortClaudeCLISession, isClaudeCLISessionActive } from '../claude-cli.js';
import { WORKSPACES_ROOT } from '../routes/projects.js';

/**
 * WebSocket Writer - Wrapper for WebSocket to match SSEStreamWriter interface
 */
class WebSocketWriter {
    constructor(ws) {
        this.ws = ws;
        this.sessionId = null;
        this.isWebSocketWriter = true;  // Marker for transport detection
    }

    send(data) {
        if (this.ws.readyState === 1) { // WebSocket.OPEN
            // Providers send raw objects, we stringify for WebSocket
            this.ws.send(JSON.stringify(data));
        }
    }

    updateWebSocket(newRawWs) {
        this.ws = newRawWs;
    }

    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }

    getSessionId() {
        return this.sessionId;
    }
}

export class ChatHandler extends EventEmitter {
    constructor({ registry, transport, router }) {
        super();
        this.registry = registry;
        this.transport = transport;
        this.router = router;  // MessageRouter - will handle message routing in future
    }

    handleConnection(ws, request, connectionId) {
        // Bind userId and username to ws object for per-user broadcast filtering and workspace isolation
        // Note: authenticateWebSocket returns JWT payload { userId, username }, not a DB object { id, username }
        if (request && request.user) {
            ws.userId = request.user.userId || request.user.id;
            ws.username = request.user.username;
        }
        log.info(`Chat WebSocket connected, userId: ${ws.userId} username: ${ws.username}`);

        // Wrap WebSocket with writer for consistent interface with SSEStreamWriter
        const writer = new WebSocketWriter(ws);
        const transport = this.transport;
        const registry = this.registry;

        ws.on('message', async (message) => {
            let data;
            try {
                data = JSON.parse(message);

                // Heartbeat: handle application-level heartbeat
                if (data.type === 'heartbeat') {
                    transport.handleHeartbeat(connectionId, data);
                    return;
                }

                if (data.type === 'claude-command') {
                    log.debug(`User message: ${data.command || '[Continue/Resume]'}`);
                    log.debug(`Project: ${data.options?.projectPath || 'Unknown'}`);
                    log.debug(`Session: ${data.options?.sessionId ? 'Resume' : 'New'}`);

                    // Validate projectPath/cwd within user workspace
                    if (ws.username) {
                        const userRoot = path.join(WORKSPACES_ROOT, ws.username);
                        const projectPath = data.options?.projectPath || data.options?.cwd;
                        if (projectPath) {
                            const resolvedProject = path.resolve(projectPath);
                            if (!resolvedProject.startsWith(userRoot + path.sep) && resolvedProject !== userRoot) {
                                writer.send({ type: 'error', error: `Access denied: project path must be within your workspace (${userRoot})` });
                                return;
                            }
                        }
                    }

                    // Use Claude Agents SDK
                    await queryClaudeSDK(data.command, data.options, writer);
                } else if (data.type === 'cursor-command') {
                    log.debug(`Cursor message: ${data.command || '[Continue/Resume]'}`);
                    log.debug(`Project: ${data.options?.cwd || 'Unknown'}`);
                    log.debug(`Session: ${data.options?.sessionId ? 'Resume' : 'New'}`);
                    log.debug(`Model: ${data.options?.model || 'default'}`);

                    // Validate cwd within user workspace
                    if (ws.username && data.options?.cwd) {
                        const userRoot = path.join(WORKSPACES_ROOT, ws.username);
                        const resolvedCwd = path.resolve(data.options.cwd);
                        if (!resolvedCwd.startsWith(userRoot + path.sep) && resolvedCwd !== userRoot) {
                            writer.send({ type: 'error', error: `Access denied: project path must be within your workspace (${userRoot})` });
                            return;
                        }
                    }

                    await spawnCursor(data.command, data.options, writer);
                } else if (data.type === 'codex-command') {
                    log.debug(`Codex message: ${data.command || '[Continue/Resume]'}`);
                    log.debug(`Project: ${data.options?.projectPath || data.options?.cwd || 'Unknown'}`);
                    log.debug(`Session: ${data.options?.sessionId ? 'Resume' : 'New'}`);
                    log.debug(`Model: ${data.options?.model || 'default'}`);

                    // Validate projectPath/cwd within user workspace
                    if (ws.username) {
                        const userRoot = path.join(WORKSPACES_ROOT, ws.username);
                        const projectPath = data.options?.projectPath || data.options?.cwd;
                        if (projectPath) {
                            const resolvedProject = path.resolve(projectPath);
                            if (!resolvedProject.startsWith(userRoot + path.sep) && resolvedProject !== userRoot) {
                                writer.send({ type: 'error', error: `Access denied: project path must be within your workspace (${userRoot})` });
                                return;
                            }
                        }
                    }

                    await queryCodex(data.command, data.options, writer);
                } else if (data.type === 'gemini-command') {
                    log.debug(`Gemini message: ${data.command || '[Continue/Resume]'}`);
                    log.debug(`Project: ${data.options?.projectPath || data.options?.cwd || 'Unknown'}`);
                    log.debug(`Session: ${data.options?.sessionId ? 'Resume' : 'New'}`);
                    log.debug(`Model: ${data.options?.model || 'default'}`);

                    // Validate projectPath/cwd within user workspace
                    if (ws.username) {
                        const userRoot = path.join(WORKSPACES_ROOT, ws.username);
                        const projectPath = data.options?.projectPath || data.options?.cwd;
                        if (projectPath) {
                            const resolvedProject = path.resolve(projectPath);
                            if (!resolvedProject.startsWith(userRoot + path.sep) && resolvedProject !== userRoot) {
                                writer.send({ type: 'error', error: `Access denied: project path must be within your workspace (${userRoot})` });
                                return;
                            }
                        }
                    }

                    await spawnGemini(data.command, data.options, writer);
                } else if (data.type === 'claude-cli-command') {
                    log.debug(`Claude CLI message: ${data.command || '[Continue/Resume]'}`);
                    log.debug(`Project: ${data.options?.projectPath || data.options?.cwd || 'Unknown'}`);
                    log.debug(`Session: ${data.options?.sessionId ? 'Resume' : 'New'}`);
                    log.debug(`Model: ${data.options?.model || 'default'}`);

                    // Validate projectPath/cwd within user workspace
                    if (ws.username) {
                        const userRoot = path.join(WORKSPACES_ROOT, ws.username);
                        const projectPath = data.options?.projectPath || data.options?.cwd;
                        if (projectPath) {
                            const resolvedProject = path.resolve(projectPath);
                            if (!resolvedProject.startsWith(userRoot + path.sep) && resolvedProject !== userRoot) {
                                writer.send({ type: 'error', error: `Access denied: project path must be within your workspace (${userRoot})` });
                                return;
                            }
                        }
                    }

                    await spawnClaudeCLI(data.command, data.options, writer);
                } else if (data.type === 'cursor-resume') {
                    // Backward compatibility: treat as cursor-command with resume and no prompt
                    log.debug(`Cursor resume session (compat): ${data.sessionId}`);
                    await spawnCursor('', {
                        sessionId: data.sessionId,
                        resume: true,
                        cwd: data.options?.cwd
                    }, writer);
                } else if (data.type === 'abort-session') {
                    log.debug(`Abort session request: ${data.sessionId}`);
                    const provider = data.provider || 'claude';
                    let success;

                    if (provider === 'cursor') {
                        success = abortCursorSession(data.sessionId);
                    } else if (provider === 'codex') {
                        success = abortCodexSession(data.sessionId);
                    } else if (provider === 'gemini') {
                        success = abortGeminiSession(data.sessionId);
                    } else if (provider === 'claude-cli') {
                        success = abortClaudeCLISession(data.sessionId);
                    } else {
                        // Use Claude Agents SDK
                        success = await abortClaudeSDKSession(data.sessionId);
                    }

                    writer.send({
                        type: 'session-aborted',
                        sessionId: data.sessionId,
                        provider,
                        success
                    });
                } else if (data.type === 'claude-permission-response') {
                    // Relay UI approval decisions back into the SDK control flow.
                    // This does not persist permissions; it only resolves the in-flight request,
                    // introduced so the SDK can resume once the user clicks Allow/Deny.
                    if (data.requestId) {
                        resolveToolApproval(data.requestId, {
                            allow: Boolean(data.allow),
                            updatedInput: data.updatedInput,
                            message: data.message,
                            rememberEntry: data.rememberEntry
                        });
                    }
                } else if (data.type === 'cursor-abort') {
                    log.debug(`Abort Cursor session: ${data.sessionId}`);
                    const success = abortCursorSession(data.sessionId);
                    writer.send({
                        type: 'session-aborted',
                        sessionId: data.sessionId,
                        provider: 'cursor',
                        success
                    });
                } else if (data.type === 'check-session-status') {
                    // Check if a specific session is currently processing
                    const provider = data.provider || 'claude';
                    const sessionId = data.sessionId;
                    let isActive;

                    if (provider === 'cursor') {
                        isActive = isCursorSessionActive(sessionId);
                    } else if (provider === 'codex') {
                        isActive = isCodexSessionActive(sessionId);
                    } else if (provider === 'gemini') {
                        isActive = isGeminiSessionActive(sessionId);
                    } else if (provider === 'claude-cli') {
                        isActive = isClaudeCLISessionActive(sessionId);
                    } else {
                        // Use Claude Agents SDK
                        isActive = isClaudeSDKSessionActive(sessionId);
                        if (isActive) {
                            // Reconnect the session's writer to the new WebSocket so
                            // subsequent SDK output flows to the refreshed client.
                            reconnectSessionWriter(sessionId, ws);
                        }
                    }

                    writer.send({
                        type: 'session-status',
                        sessionId,
                        provider,
                        isProcessing: isActive
                    });
                } else if (data.type === 'get-pending-permissions') {
                    // Return pending permission requests for a session
                    const sessionId = data.sessionId;
                    if (sessionId && isClaudeSDKSessionActive(sessionId)) {
                        const pending = getPendingApprovalsForSession(sessionId);
                        writer.send({
                            type: 'pending-permissions-response',
                            sessionId,
                            data: pending
                        });
                    }
                } else if (data.type === 'get-active-sessions') {
                    // Get all currently active sessions
                    const activeSessions = {
                        claude: getActiveClaudeSDKSessions(),
                        cursor: getActiveCursorSessions(),
                        codex: getActiveCodexSessions(),
                        gemini: getActiveGeminiSessions()
                    };
                    writer.send({
                        type: 'active-sessions',
                        sessions: activeSessions
                    });
                }
            } catch (error) {
                log.error({ err: error }, 'Chat WebSocket error');
                // Include sessionId so the frontend session filter doesn't discard this event,
                // which would leave the UI stuck in "Processing" forever.
                const errorSessionId = data?.options?.sessionId || data?.sessionId || writer.getSessionId() || null;
                writer.send({
                    type: 'error',
                    error: error.message,
                    sessionId: errorSessionId
                });
            }
        });

        ws.on('close', () => {
            log.info('Chat client disconnected');
            registry.unregister(connectionId);
        });

        ws.on('error', (error) => {
            log.error({ err: error }, 'WebSocket error');
        });
    }
}
