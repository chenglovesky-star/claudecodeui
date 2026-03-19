// server/websocket/TransportLayer.js
// 统一传输层：管理所有 WebSocket 连接的心跳与背压 (P1, P2, P3, P4)

import { EventEmitter } from 'events';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_MISSED,
  BACKPRESSURE_WARN_BYTES,
  BACKPRESSURE_BLOCK_BYTES,
} from '../config/constants.js';

/**
 * TransportLayer — 统一传输层
 *
 * 事件：
 *   transport:dead       { connectionId }
 *   transport:congested  { connectionId }
 *   transport:blocked    { connectionId }
 */
export class TransportLayer extends EventEmitter {
  #registry;
  #heartbeatTimer = null;
  /** @type {Map<string, Function>} */
  #pongListeners = new Map();
  /** @type {Map<string, string[]>} */
  #sendQueues = new Map();
  /** @type {Map<string, Function>} */
  #drainListeners = new Map();

  constructor(registry) {
    super();
    this.#registry = registry;

    registry.on('connection:registered', ({ connectionId }) => this.setupConnection(connectionId));
    registry.on('connection:unregistered', ({ connectionId, ws }) => this.teardownConnection(connectionId, ws));

    console.log('[Transport] TransportLayer initialized');
  }

  // ─── 心跳管理 ────────────────────────────────────────────────────────────

  start() {
    if (this.#heartbeatTimer) return;
    this.#heartbeatTimer = setInterval(() => this.#runHeartbeatCycle(), HEARTBEAT_INTERVAL_MS);
    console.log(`[Transport] heartbeat started (interval=${HEARTBEAT_INTERVAL_MS}ms, maxMissed=${HEARTBEAT_MAX_MISSED})`);
  }

  stop() {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    for (const [connectionId, listener] of this.#drainListeners) {
      const record = this.#registry.get(connectionId);
      if (record?.ws) record.ws.removeListener('drain', listener);
    }
    this.#drainListeners.clear();
    this.#sendQueues.clear();
    console.log('[Transport] heartbeat stopped');
  }

  #runHeartbeatCycle() {
    for (const record of this.#registry.getAll()) {
      const { connectionId, ws, missedHeartbeats } = record;
      if (missedHeartbeats >= HEARTBEAT_MAX_MISSED) {
        console.log(`[Transport] terminating dead connection ${connectionId} (missed=${missedHeartbeats})`);
        ws.terminate();
        this.emit('transport:dead', { connectionId });
        this.#registry.unregister(connectionId);
      } else {
        this.#registry.markMissed(connectionId);
        try { ws.ping(); } catch (err) {
          console.warn(`[Transport] ping failed for ${connectionId}:`, err.message);
        }
      }
    }
  }

  // ─── 协议级 pong 处理 ─────────────────────────────────────────────────────

  setupConnection(connectionId) {
    const record = this.#registry.get(connectionId);
    if (!record?.ws) {
      console.warn(`[Transport] setupConnection: record not found for ${connectionId}`);
      return;
    }
    const pongHandler = () => this.#registry.markAlive(connectionId);
    record.ws.on('pong', pongHandler);
    this.#pongListeners.set(connectionId, pongHandler);
    this.#sendQueues.set(connectionId, []);
    console.log(`[Transport] setup done: ${connectionId}`);
  }

  teardownConnection(connectionId, ws) {
    // ws is passed from the event payload (emitted BEFORE registry delete)
    const pongHandler = this.#pongListeners.get(connectionId);
    if (pongHandler) {
      if (ws) ws.removeListener('pong', pongHandler);
      this.#pongListeners.delete(connectionId);
    }

    const drainHandler = this.#drainListeners.get(connectionId);
    if (drainHandler) {
      if (ws) ws.removeListener('drain', drainHandler);
      this.#drainListeners.delete(connectionId);
    }

    const queue = this.#sendQueues.get(connectionId);
    if (queue?.length > 0) {
      console.warn(`[Transport] teardown ${connectionId}: discarding ${queue.length} queued message(s)`);
    }
    this.#sendQueues.delete(connectionId);
    console.log(`[Transport] teardown done: ${connectionId}`);
  }

  // ─── 应用级心跳 ──────────────────────────────────────────────────────────

  handleHeartbeat(connectionId, message) {
    this.#registry.markAlive(connectionId);
    this.send(connectionId, { type: 'heartbeat-ack', ts: message.ts });
  }

  // ─── 背压感知发送 ─────────────────────────────────────────────────────────

  /**
   * 背压感知发送，自动附加 seqId。
   * @param {string} connectionId
   * @param {object} message
   * @returns {{ success: boolean, backpressure: 'normal'|'congested'|'blocked' }}
   */
  send(connectionId, message) {
    const record = this.#registry.get(connectionId);
    if (!record || record.ws.readyState !== 1 /* OPEN */) {
      console.warn(`[Transport] send: connection unavailable (${connectionId})`);
      return { success: false, backpressure: 'blocked' };
    }

    const { ws } = record;
    const seqId = this.#registry.nextSeqId(connectionId);
    const payload = JSON.stringify({ ...message, seqId });
    const buffered = ws.bufferedAmount ?? 0;

    if (buffered < BACKPRESSURE_WARN_BYTES) {
      try {
        ws.send(payload);
        return { success: true, backpressure: 'normal' };
      } catch (err) {
        console.warn(`[Transport] send error (${connectionId}):`, err.message);
        return { success: false, backpressure: 'blocked' };
      }
    }

    if (buffered < BACKPRESSURE_BLOCK_BYTES) {
      try {
        ws.send(payload);
        this.emit('transport:congested', { connectionId });
        console.warn(`[Transport] congested ${connectionId} (buffered=${buffered}B)`);
        return { success: true, backpressure: 'congested' };
      } catch (err) {
        console.warn(`[Transport] send error congested (${connectionId}):`, err.message);
        return { success: false, backpressure: 'blocked' };
      }
    }

    // 阻塞：入队等待 drain
    this.#enqueue(connectionId, ws, payload);
    this.emit('transport:blocked', { connectionId });
    console.warn(`[Transport] blocked ${connectionId} (buffered=${buffered}B), queued`);
    return { success: true, backpressure: 'blocked' };
  }

  #enqueue(connectionId, ws, payload) {
    let queue = this.#sendQueues.get(connectionId);
    if (!queue) { queue = []; this.#sendQueues.set(connectionId, queue); }
    queue.push(payload);

    if (!this.#drainListeners.has(connectionId)) {
      const drainHandler = () => this.#flushQueue(connectionId);
      this.#drainListeners.set(connectionId, drainHandler);
      ws.on('drain', drainHandler);
    }
  }

  #flushQueue(connectionId) {
    const record = this.#registry.get(connectionId);
    const queue = this.#sendQueues.get(connectionId);
    if (!queue || queue.length === 0) return;

    if (!record || record.ws.readyState !== 1 /* OPEN */) {
      console.warn(`[Transport] flushQueue: connection closed, discarding queue for ${connectionId}`);
      this.#sendQueues.set(connectionId, []);
      return;
    }

    const { ws } = record;
    while (queue.length > 0) {
      if ((ws.bufferedAmount ?? 0) >= BACKPRESSURE_BLOCK_BYTES) break;
      const payload = queue.shift();
      try { ws.send(payload); } catch (err) {
        console.warn(`[Transport] flushQueue error (${connectionId}):`, err.message);
        break;
      }
    }

    if (queue.length === 0) {
      const drainHandler = this.#drainListeners.get(connectionId);
      if (drainHandler) {
        ws.removeListener('drain', drainHandler);
        this.#drainListeners.delete(connectionId);
      }
    }
  }
}

export default TransportLayer;
