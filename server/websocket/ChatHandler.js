// server/websocket/ChatHandler.js
// Thin shell: validates workspace, delegates to MessageRouter for all routing.

import { EventEmitter } from 'events';
import path from 'path';
import { createLogger } from '../config/logger.js';
import { WORKSPACES_ROOT } from '../routes/projects.js';

const log = createLogger('Chat');

/**
 * WebSocketWriter - Wrapper for WebSocket to match SSEStreamWriter interface.
 * Exported so the bridge in index.js can create writers for old provider calls.
 */
export class WebSocketWriter {
    constructor(ws) {
        this.ws = ws;
        this.sessionId = null;
        this.isWebSocketWriter = true; // Marker for transport detection
    }

    send(data) {
        if (this.ws.readyState === 1) { // WebSocket.OPEN
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

const PROVIDER_COMMAND_TYPES = new Set([
    'claude-command',
    'cursor-command',
    'codex-command',
    'gemini-command',
    'claude-cli-command',
]);

export class ChatHandler extends EventEmitter {
    constructor({ registry, transport, router }) {
        super();
        this.registry = registry;
        this.transport = transport;
        this.router = router;
    }

    #validateWorkspace(username, projectPath) {
        if (!username || !projectPath) return true;
        const userRoot = path.join(WORKSPACES_ROOT, username);
        const resolved = path.resolve(projectPath);
        return resolved.startsWith(userRoot + path.sep) || resolved === userRoot;
    }

    handleConnection(ws, request, connectionId) {
        if (request?.user) {
            ws.userId = request.user.userId || request.user.id;
            ws.username = request.user.username;
        }
        log.info(`Chat WebSocket connected, userId: ${ws.userId} username: ${ws.username}`);

        const transport = this.transport;
        const registry = this.registry;
        const router = this.router;

        ws.on('message', async (message) => {
            let data;
            try {
                data = JSON.parse(message);

                // Heartbeat: handle directly (no routing overhead)
                if (data.type === 'heartbeat') {
                    transport.handleHeartbeat(connectionId, data);
                    return;
                }

                // Workspace validation for provider commands
                if (PROVIDER_COMMAND_TYPES.has(data.type)) {
                    const projectPath = data.options?.projectPath || data.options?.cwd;
                    if (!this.#validateWorkspace(ws.username, projectPath)) {
                        const userRoot = path.join(WORKSPACES_ROOT, ws.username);
                        transport.send(connectionId, {
                            type: 'error',
                            error: `Access denied: project path must be within your workspace (${userRoot})`
                        });
                        return;
                    }
                }

                // Delegate everything to MessageRouter
                if (router) {
                    router.handleMessage(connectionId, data);
                } else {
                    log.warn('No router available, message dropped');
                }
            } catch (error) {
                log.error({ err: error }, 'Chat WebSocket error');
                const errorSessionId = data?.options?.sessionId || data?.sessionId || null;
                transport.send(connectionId, {
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
