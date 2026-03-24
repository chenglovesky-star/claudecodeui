// server/session/SessionManager.js
// Session lifecycle management: state machine, timeouts, resource quotas (P2)

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  SESSION_FIRST_RESPONSE_TIMEOUT_MS,
  SESSION_ACTIVITY_TIMEOUT_MS,
  SESSION_TOOL_TIMEOUT_MS,
  SESSION_GLOBAL_TIMEOUT_MS,
  QUOTA_MAX_SESSIONS_PER_USER,
  QUOTA_MAX_SESSIONS_GLOBAL,
} from '../config/constants.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Session');

// ── Terminal states ──────────────────────────────────────────────────────────
const TERMINAL_STATES = new Set(['completed', 'timeout', 'error', 'aborted']);

// ── Pure state machine (exported for testability P6) ────────────────────────
export function nextState(currentState, event) {
  const transitions = {
    'idle':           { 'start': 'running' },
    'running':        { 'output': 'streaming', 'complete': 'completed', 'timeout': 'timeout', 'error': 'error', 'abort': 'aborted' },
    'streaming':      { 'output': 'streaming', 'tool_use': 'tool_executing', 'complete': 'completed', 'timeout': 'timeout', 'error': 'error', 'abort': 'aborted' },
    'tool_executing': { 'tool_result': 'streaming', 'output': 'streaming', 'complete': 'completed', 'timeout': 'timeout', 'error': 'error', 'abort': 'aborted' },
  };
  return transitions[currentState]?.[event] || currentState;
}

// ── SessionManager ────────────────────────────────────────────────────────────
export class SessionManager extends EventEmitter {
  /** @param {{ setTimeout?: Function, clearTimeout?: Function }} [timerImpl] */
  constructor(timerImpl = {}) {
    super();
    this._setTimeout = timerImpl.setTimeout ?? setTimeout;
    this._clearTimeout = timerImpl.clearTimeout ?? clearTimeout;
    /** @type {Map<string, object>} */
    this._sessions = new Map();
  }

  // ── Quota helpers ──────────────────────────────────────────────────────────

  getActiveByUser(userId) {
    let count = 0;
    for (const s of this._sessions.values()) {
      if (s.userId === userId && !TERMINAL_STATES.has(s.state)) count++;
    }
    return count;
  }

  getActiveCount() {
    let count = 0;
    for (const s of this._sessions.values()) {
      if (!TERMINAL_STATES.has(s.state)) count++;
    }
    return count;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Create a new session.
   * @param {number} userId
   * @param {string} connectionId
   * @param {{ providerType: string }} config
   * @returns {string} sessionId
   */
  create(userId, connectionId, config) {
    const { providerType } = config;

    const userCount = this.getActiveByUser(userId);
    if (userCount >= QUOTA_MAX_SESSIONS_PER_USER) {
      const err = new Error(
        `[Session] User ${userId} exceeded max concurrent sessions (${QUOTA_MAX_SESSIONS_PER_USER})`
      );
      err.name = 'QuotaExceededError';
      throw err;
    }

    const globalCount = this.getActiveCount();
    if (globalCount >= QUOTA_MAX_SESSIONS_GLOBAL) {
      const err = new Error(
        `[Session] Global session limit reached (${QUOTA_MAX_SESSIONS_GLOBAL})`
      );
      err.name = 'QuotaExceededError';
      throw err;
    }

    const sessionId = randomUUID();
    const now = Date.now();

    /** @type {object} */
    const session = {
      sessionId,
      userId,
      connectionId,
      providerType,
      state: 'idle',
      createdAt: now,
      lastActivityAt: now,
      timers: {
        firstResponse: null,
        activity: null,
        toolExecution: null,
        global: null,
      },
    };

    this._sessions.set(sessionId, session);
    log.info(`Created ${sessionId} user=${userId} provider=${providerType}`);
    this.emit('session:created', { sessionId, userId, providerType });
    return sessionId;
  }

  /**
   * Transition a session via an event.
   * @param {string} sessionId
   * @param {string} event
   * @returns {string} new state
   */
  transition(sessionId, event) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      log.warn(`transition: unknown session ${sessionId}`);
      return undefined;
    }

    const from = session.state;
    const to = nextState(from, event);

    // Self-loop: streaming + output should still refresh activity timeout
    if (from === to) {
      if (from === 'streaming' && event === 'output') {
        session.lastActivityAt = Date.now();
        this._refreshActivityTimeout(session);
      }
      return from;
    }

    session.state = to;
    session.lastActivityAt = Date.now();

    log.info(`${sessionId} ${from} --${event}--> ${to}`);
    this._manageTimers(session, from, to);
    this.emit('session:stateChanged', { sessionId, from, to, event });
    return to;
  }

  /**
   * Abort a session.
   * @param {string} sessionId
   */
  abort(sessionId) {
    return this.transition(sessionId, 'abort');
  }

  /**
   * Rebind a session to a new connection (after WebSocket reconnect).
   * @param {string} sessionId
   * @param {string} newConnectionId
   * @returns {boolean} true if session was found and rebound
   */
  rebindConnection(sessionId, newConnectionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return false;
    const oldConnectionId = session.connectionId;
    session.connectionId = newConnectionId;
    log.info(`Rebound ${sessionId} from ${oldConnectionId} to ${newConnectionId}`);
    return true;
  }

  /**
   * @param {string} sessionId
   * @returns {string|undefined}
   */
  getState(sessionId) {
    return this._sessions.get(sessionId)?.state;
  }

  /**
   * @param {string} sessionId
   * @returns {object|undefined}
   */
  getSession(sessionId) {
    return this._sessions.get(sessionId);
  }

  /**
   * Clear all timers and remove session from map.
   * @param {string} sessionId
   */
  cleanup(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    this._clearAllTimers(session);
    this._sessions.delete(sessionId);
    log.info(`Cleaned up ${sessionId}`);
  }

  /**
   * Dispose all sessions.
   */
  dispose() {
    for (const sessionId of this._sessions.keys()) {
      this.cleanup(sessionId);
    }
  }

  // ── Timer management ───────────────────────────────────────────────────────

  _clearAllTimers(session) {
    for (const key of Object.keys(session.timers)) {
      if (session.timers[key] !== null) {
        this._clearTimeout(session.timers[key]);
        session.timers[key] = null;
      }
    }
  }

  _startTimer(session, timerKey, ms, timeoutType) {
    if (session.timers[timerKey] !== null) {
      this._clearTimeout(session.timers[timerKey]);
      session.timers[timerKey] = null;
    }
    // Record timer metadata for pause/resume
    if (!session._timerMeta) session._timerMeta = {};
    session._timerMeta[timerKey] = { startedAt: Date.now(), duration: ms, timeoutType };

    session.timers[timerKey] = this._setTimeout(() => {
      session.timers[timerKey] = null;
      delete session._timerMeta?.[timerKey];
      log.warn(`${session.sessionId} timeout: ${timeoutType}`);
      this.transition(session.sessionId, 'timeout');
      const errorCodeMap = {
        firstResponse: 'firstResponse',
        activity: 'activity',
        toolExecution: 'tool-timeout',
        global: 'global-timeout',
      };
      this.emit('session:timeout', {
        sessionId: session.sessionId,
        timeoutType,
        errorCode: errorCodeMap[timerKey] || timeoutType,
        meta: { timeoutMs: ms },
      });
    }, ms);
  }

  _clearTimer(session, timerKey) {
    if (session.timers[timerKey] !== null) {
      this._clearTimeout(session.timers[timerKey]);
      session.timers[timerKey] = null;
    }
  }

  /**
   * Manage timers based on state transition.
   * @param {object} session
   * @param {string} from
   * @param {string} to
   */
  _manageTimers(session, from, to) {
    // Terminal states: clear everything
    if (TERMINAL_STATES.has(to)) {
      this._clearAllTimers(session);
      return;
    }

    switch (to) {
      case 'running':
        this._startTimer(session, 'firstResponse', SESSION_FIRST_RESPONSE_TIMEOUT_MS, 'firstResponse');
        // Start global timer once per session lifecycle
        if (session.timers.global === null) {
          this._startTimer(session, 'global', SESSION_GLOBAL_TIMEOUT_MS, 'global');
        }
        break;

      case 'streaming':
        this._clearTimer(session, 'firstResponse');
        this._startTimer(session, 'activity', SESSION_ACTIVITY_TIMEOUT_MS, 'activity');
        break;

      case 'tool_executing':
        this._clearTimer(session, 'activity');
        this._startTimer(session, 'toolExecution', SESSION_TOOL_TIMEOUT_MS, 'toolExecution');
        break;

      default:
        break;
    }
  }

  pauseTimers(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    const now = Date.now();
    session._pausedTimers = {};
    for (const key of Object.keys(session.timers)) {
      if (session.timers[key] !== null) {
        const meta = session._timerMeta?.[key];
        if (meta) {
          const elapsed = now - meta.startedAt;
          const remaining = Math.max(meta.duration - elapsed, 1000); // at least 1s
          session._pausedTimers[key] = { remaining, timeoutType: meta.timeoutType };
        } else {
          session._pausedTimers[key] = { remaining: null };
        }
        this._clearTimeout(session.timers[key]);
        session.timers[key] = null;
      }
    }
    session._pausedAt = now;
    log.info(`Paused timers for ${sessionId}`);
  }

  resumeTimers(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session || !session._pausedTimers) return;
    const state = session.state;
    if (!['running', 'streaming', 'tool_executing'].includes(state)) {
      delete session._pausedTimers;
      delete session._pausedAt;
      return;
    }
    // Re-start each paused timer with remaining time
    for (const [key, info] of Object.entries(session._pausedTimers)) {
      if (info.remaining && info.timeoutType) {
        this._startTimer(session, key, info.remaining, info.timeoutType);
      }
    }
    delete session._pausedTimers;
    delete session._pausedAt;
    log.info(`Resumed timers for ${sessionId} with remaining durations`);
  }

  /** Refresh activity timeout without full state transition (for streaming self-loop). */
  _refreshActivityTimeout(session) {
    this._clearTimer(session, 'activity');
    this._startTimer(session, 'activity', SESSION_ACTIVITY_TIMEOUT_MS, 'activity');
  }
}

export default SessionManager;
