// server/message/MessageBuffer.js
// Per-session message buffering for disconnect recovery (P2-T1)

import { EventEmitter } from 'events';
import { BUFFER_CRITICAL_EVENTS_MAX, BUFFER_SEQ_ID_START } from '../config/constants.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Buffer');

// Critical event types
const CRITICAL_TYPES = new Set([
  'session-started',
  'tool_use',
  'session-completed',
  'session-timeout',
  'session-error',
  'session-aborted',
]);

// Terminal event types (pinned as pinnedLast)
const TERMINAL_TYPES = new Set([
  'session-completed',
  'session-timeout',
  'session-error',
  'session-aborted',
]);

export class MessageBuffer extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, object>} */
    this._sessions = new Map();
    /** @type {Map<string, number>} seqId counter per session */
    this._seqCounters = new Map();
  }

  // ── internal ────────────────────────────────────────────────────────────────

  /**
   * Create session data if not exists.
   * @param {string} sessionId
   */
  ensureSession(sessionId) {
    if (!this._sessions.has(sessionId)) {
      this._sessions.set(sessionId, {
        criticalEvents: [],
        currentContent: '',
        completedBlocks: [],
        pendingToolUses: [],
        pinnedStart: null,
        pinnedLast: null,
      });
      this._seqCounters.set(sessionId, BUFFER_SEQ_ID_START - 1);
    }
  }

  /** Get next seqId for session. */
  _nextSeq(sessionId) {
    const next = (this._seqCounters.get(sessionId) ?? BUFFER_SEQ_ID_START - 1) + 1;
    this._seqCounters.set(sessionId, next);
    return next;
  }

  // ── public API ───────────────────────────────────────────────────────────────

  /**
   * Add a critical event to the FIFO buffer.
   * @param {string} sessionId
   * @param {object} event  - must have a `type` property
   */
  addCriticalEvent(sessionId, event) {
    this.ensureSession(sessionId);
    const session = this._sessions.get(sessionId);

    if (!CRITICAL_TYPES.has(event.type)) {
      // Non-critical events are not buffered
      return;
    }

    const stamped = { ...event, seqId: this._nextSeq(sessionId) };

    // Pin session-started
    if (stamped.type === 'session-started') {
      session.pinnedStart = stamped;
    }

    // Pin terminal events
    if (TERMINAL_TYPES.has(stamped.type)) {
      session.pinnedLast = stamped;
    }

    session.criticalEvents.push(stamped);

    // FIFO eviction if over limit
    if (session.criticalEvents.length > BUFFER_CRITICAL_EVENTS_MAX) {
      let evicted = false;
      for (let i = 0; i < session.criticalEvents.length; i++) {
        const e = session.criticalEvents[i];
        const isPinned =
          (session.pinnedStart && e.seqId === session.pinnedStart.seqId) ||
          (session.pinnedLast && e.seqId === session.pinnedLast.seqId);
        if (!isPinned) {
          session.criticalEvents.splice(i, 1);
          evicted = true;
          log.info(`session=${sessionId} evicted seqId=${e.seqId} type=${e.type}`);
          break;
        }
      }
      if (evicted) {
        this.emit('buffer:overflow', { sessionId });
      }
    }
  }

  /**
   * Append streaming text to currentContent.
   * @param {string} sessionId
   * @param {string} text
   */
  appendContent(sessionId, text) {
    this.ensureSession(sessionId);
    this._sessions.get(sessionId).currentContent += text;
  }

  /**
   * Mark a content block as completed.
   * @param {string} sessionId
   * @param {string} blockId
   */
  markBlockComplete(sessionId, blockId) {
    this.ensureSession(sessionId);
    this._sessions.get(sessionId).completedBlocks.push(blockId);
  }

  /**
   * Record a pending tool use.
   * @param {string} sessionId
   * @param {string} toolUseId
   * @param {string} toolName
   */
  addPendingToolUse(sessionId, toolUseId, toolName) {
    this.ensureSession(sessionId);
    this._sessions.get(sessionId).pendingToolUses.push({ toolUseId, toolName });
  }

  /**
   * Remove a resolved tool use.
   * @param {string} sessionId
   * @param {string} toolUseId
   */
  resolvePendingToolUse(sessionId, toolUseId) {
    this.ensureSession(sessionId);
    const session = this._sessions.get(sessionId);
    session.pendingToolUses = session.pendingToolUses.filter(
      (t) => t.toolUseId !== toolUseId
    );
  }

  /**
   * Get a content/block snapshot for a session.
   * @param {string} sessionId
   * @returns {{ currentContent: string, completedBlocks: string[], pendingToolUses: object[] }}
   */
  getSnapshot(sessionId) {
    this.ensureSession(sessionId);
    const { currentContent, completedBlocks, pendingToolUses } =
      this._sessions.get(sessionId);
    return {
      currentContent,
      completedBlocks: [...completedBlocks],
      pendingToolUses: [...pendingToolUses],
    };
  }

  /**
   * Return critical events with seqId > sinceSeqId.
   * @param {string} sessionId
   * @param {number} sinceSeqId
   * @returns {object[]}
   */
  getEventsSince(sessionId, sinceSeqId) {
    this.ensureSession(sessionId);
    return this._sessions
      .get(sessionId)
      .criticalEvents.filter((e) => e.seqId > sinceSeqId);
  }

  /**
   * Build complete resume payload for a reconnecting client.
   * @param {string} sessionId
   * @param {number} lastSeqId
   * @param {string} currentState
   * @returns {object}
   */
  getResumeData(sessionId, lastSeqId, currentState) {
    return {
      missedCriticalEvents: this.getEventsSince(sessionId, lastSeqId),
      snapshot: this.getSnapshot(sessionId),
      currentState,
      lastSeqId,
    };
  }

  /**
   * Delete all buffered data for a session.
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    this._sessions.delete(sessionId);
    this._seqCounters.delete(sessionId);
    log.info(`session=${sessionId} cleared`);
  }
}

export default MessageBuffer;
