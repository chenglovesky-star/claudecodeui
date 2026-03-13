/**
 * PROCESS REGISTRY
 * ================
 * Team-aware Claude Code session management with per-user and per-team limits.
 * Singleton service that manages node-pty processes for team collaboration.
 */

import pty from 'node-pty';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const MAX_INSTANCES_PER_USER = 1;
const MAX_INSTANCES_PER_TEAM = 5;
const SESSION_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const SESSION_MAX_DURATION = 2 * 60 * 60 * 1000; // 2 hours
const BUFFER_MAX_SIZE = 5000;

let instance = null;

export default class ProcessRegistry {
    constructor() {
        if (instance) return instance;
        /** @type {Map<string, SessionEntry>} */
        this.sessions = new Map();
        /** @type {Map<string, Function>} listener callbacks for broadcasting */
        this._listeners = new Map();
        instance = this;
    }

    static getInstance() {
        if (!instance) {
            new ProcessRegistry();
        }
        return instance;
    }

    /**
     * Create a new Claude Code session.
     * @returns {{ sessionId: string, error?: never } | { sessionId?: never, error: { code: string, message: string } }}
     */
    createSession(userId, teamId, projectPath, options = {}) {
        // Per-user limit
        const userSession = this.getUserSession(userId);
        if (userSession) {
            return { error: { code: 'SESSION_EXISTS', message: '每用户仅允许 1 个并发实例' } };
        }

        // Per-team limit
        const teamSessions = this.getTeamSessions(teamId);
        if (teamSessions.length >= MAX_INSTANCES_PER_TEAM) {
            return { error: { code: 'TEAM_LIMIT', message: `团队并发实例已达上限（${MAX_INSTANCES_PER_TEAM}个）` } };
        }

        const sessionId = `inst_${crypto.randomBytes(8).toString('hex')}`;
        const cols = options.cols || 80;
        const rows = options.rows || 24;

        // Sanitize projectPath: resolve to absolute, reject path traversal
        const resolvedPath = path.resolve(projectPath);
        if (resolvedPath !== projectPath && !path.isAbsolute(projectPath)) {
            return { error: { code: 'INVALID_PATH', message: '无效的项目路径' } };
        }

        // Launch claude directly with cwd set to project directory (avoids shell injection)
        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
        const shellArgs = os.platform() === 'win32' ? ['-Command', 'claude'] : ['-c', 'claude'];

        let process;
        try {
            process = pty.spawn(shell, shellArgs, {
                name: 'xterm-256color',
                cols,
                rows,
                cwd: resolvedPath,
                env: {
                    ...globalThis.process.env,
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor',
                    FORCE_COLOR: '3'
                }
            });
        } catch (err) {
            return { error: { code: 'SPAWN_FAILED', message: err.message } };
        }

        const entry = {
            sessionId,
            process,
            userId,
            teamId,
            projectPath,
            status: 'active',
            startedAt: Date.now(),
            lastActivity: Date.now(),
            buffer: [],
            idleTimer: null,
            maxTimer: null,
        };

        // Set up output forwarding
        process.onData((data) => {
            entry.lastActivity = Date.now();
            entry.status = 'active';

            // Buffer management — batch trim to avoid O(n) shift on every write
            if (entry.buffer.length >= BUFFER_MAX_SIZE) {
                entry.buffer = entry.buffer.slice(Math.floor(BUFFER_MAX_SIZE / 4));
            }
            entry.buffer.push(data);

            // Emit to listeners
            this._emit(sessionId, 'instance:output', { sessionId, data });

            // Reset idle timer
            this._resetIdleTimer(sessionId);
        });

        process.onExit((exitInfo) => {
            console.log(`[ProcessRegistry] Session ${sessionId} exited: code=${exitInfo.exitCode}`);
            this._emit(sessionId, 'instance:status', {
                sessionId,
                status: 'terminated',
                exitCode: exitInfo.exitCode
            });
            this._cleanup(sessionId);
        });

        this.sessions.set(sessionId, entry);

        // Start idle timer
        this._resetIdleTimer(sessionId);

        // Start max duration timer
        entry.maxTimer = setTimeout(() => {
            console.log(`[ProcessRegistry] Session ${sessionId} exceeded max duration`);
            this.killSession(sessionId);
        }, SESSION_MAX_DURATION);

        console.log(`[ProcessRegistry] Session created: ${sessionId} for user=${userId} team=${teamId}`);
        return { sessionId };
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    getUserSession(userId) {
        for (const [, entry] of this.sessions) {
            if (entry.userId === userId) return entry;
        }
        return null;
    }

    getTeamSessions(teamId) {
        const result = [];
        for (const [, entry] of this.sessions) {
            if (entry.teamId === teamId) result.push(entry);
        }
        return result;
    }

    /**
     * Write input to a session's pty process.
     * @returns {boolean} true if written successfully
     */
    writeToSession(sessionId, data, callerUserId) {
        const entry = this.sessions.get(sessionId);
        if (!entry) return false;
        if (entry.userId !== callerUserId) return false;
        try {
            entry.process.write(data);
            entry.lastActivity = Date.now();
            entry.status = 'active';
            this._resetIdleTimer(sessionId);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Resize a session's terminal.
     */
    resizeSession(sessionId, cols, rows, callerUserId) {
        const entry = this.sessions.get(sessionId);
        if (!entry || entry.userId !== callerUserId) return false;
        try {
            entry.process.resize(cols, rows);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Kill a session and clean up resources.
     */
    killSession(sessionId) {
        const entry = this.sessions.get(sessionId);
        if (!entry) return false;
        try {
            entry.process.kill();
        } catch {
            // Process may already be dead
        }
        this._cleanup(sessionId);
        return true;
    }

    /**
     * Get session buffer for reconnection.
     */
    getSessionBuffer(sessionId) {
        const entry = this.sessions.get(sessionId);
        return entry ? entry.buffer : [];
    }

    /**
     * Register a listener for session events.
     */
    onSessionEvent(sessionId, callback) {
        if (!this._listeners.has(sessionId)) {
            this._listeners.set(sessionId, new Set());
        }
        this._listeners.get(sessionId).add(callback);
        return () => {
            const set = this._listeners.get(sessionId);
            if (set) {
                set.delete(callback);
                if (set.size === 0) this._listeners.delete(sessionId);
            }
        };
    }

    _emit(sessionId, type, payload) {
        const listeners = this._listeners.get(sessionId);
        if (listeners) {
            for (const cb of listeners) {
                try { cb(type, payload); } catch (e) {
                    console.error('[ProcessRegistry] Listener error:', e);
                }
            }
        }
    }

    _resetIdleTimer(sessionId) {
        const entry = this.sessions.get(sessionId);
        if (!entry) return;
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        entry.idleTimer = setTimeout(() => {
            entry.status = 'idle';
            this._emit(sessionId, 'instance:status', { sessionId, status: 'idle' });
            // Auto-kill after idle timeout
            console.log(`[ProcessRegistry] Session ${sessionId} idle timeout, killing`);
            this.killSession(sessionId);
        }, SESSION_IDLE_TIMEOUT);
    }

    _cleanup(sessionId) {
        const entry = this.sessions.get(sessionId);
        if (!entry) return;
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        if (entry.maxTimer) clearTimeout(entry.maxTimer);
        // Defensively kill the pty process if still alive
        try { entry.process.kill(); } catch { /* already dead */ }
        entry.buffer.length = 0;
        this._listeners.delete(sessionId);
        this.sessions.delete(sessionId);
        console.log(`[ProcessRegistry] Session cleaned up: ${sessionId}`);
    }
}
