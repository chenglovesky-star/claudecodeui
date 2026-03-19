// server/websocket/ConnectionRegistry.js
// 管理所有 WebSocket 连接（chat 和 shell）的生命周期 (P1, P3)

import { EventEmitter } from 'events';
import {
  ZOMBIE_SCAN_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PONG_TIMEOUT_MS,
} from '../config/constants.js';

/**
 * ConnectionRegistry — 连接注册表
 *
 * 事件：
 *   connection:registered   { connectionId, type, userId }
 *   connection:unregistered { connectionId, type, userId }
 *   connection:dead         { connectionId, type, userId, lastAliveAt }
 */
export class ConnectionRegistry extends EventEmitter {
  /** @type {Map<string, object>} */
  #connections = new Map();

  /** @type {ReturnType<typeof setInterval> | null} */
  #zombieScanTimer = null;

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * 注册一条新连接，返回分配的 connectionId。
   * @param {import('ws').WebSocket} ws
   * @param {'chat'|'shell'} type
   * @param {number} userId
   * @param {string} username
   * @returns {string} connectionId
   */
  register(ws, type, userId, username) {
    const connectionId = crypto.randomUUID();
    const now = Date.now();

    const record = {
      connectionId,
      ws,
      type,
      userId,
      username,
      registeredAt: now,
      lastAliveAt: now,
      missedHeartbeats: 0,
      seqId: 0,
    };

    this.#connections.set(connectionId, record);
    console.log(`[Registry] registered ${type} connection ${connectionId} (user=${userId})`);
    this.emit('connection:registered', { connectionId, type, userId });

    return connectionId;
  }

  /**
   * 注销连接，释放记录。
   * @param {string} connectionId
   */
  unregister(connectionId) {
    const record = this.#connections.get(connectionId);
    if (!record) return;

    // Emit BEFORE delete so listeners (e.g. TransportLayer.teardownConnection)
    // can still access the ws reference via event payload
    console.log(`[Registry] unregistered ${record.type} connection ${connectionId} (user=${record.userId})`);
    this.emit('connection:unregistered', { connectionId, type: record.type, userId: record.userId, ws: record.ws });
    this.#connections.delete(connectionId);
  }

  /**
   * 按 connectionId 查询记录。
   * @param {string} connectionId
   * @returns {object|null}
   */
  get(connectionId) {
    return this.#connections.get(connectionId) ?? null;
  }

  /**
   * 返回属于指定用户的所有连接记录。
   * @param {number} userId
   * @returns {object[]}
   */
  getByUserId(userId) {
    return [...this.#connections.values()].filter(r => r.userId === userId);
  }

  /**
   * 返回指定类型的所有连接记录。
   * @param {'chat'|'shell'} type
   * @returns {object[]}
   */
  getAllByType(type) {
    return [...this.#connections.values()].filter(r => r.type === type);
  }

  /**
   * 返回全部连接记录。
   * @returns {object[]}
   */
  getAll() {
    return [...this.#connections.values()];
  }

  /**
   * 标记连接存活：更新 lastAliveAt，重置 missedHeartbeats。
   * @param {string} connectionId
   */
  markAlive(connectionId) {
    const record = this.#connections.get(connectionId);
    if (!record) return;
    record.lastAliveAt = Date.now();
    record.missedHeartbeats = 0;
  }

  /**
   * 标记一次心跳未响应：递增 missedHeartbeats。
   * @param {string} connectionId
   */
  markMissed(connectionId) {
    const record = this.#connections.get(connectionId);
    if (!record) return;
    record.missedHeartbeats += 1;
  }

  /**
   * 返回并递增连接的消息序号。
   * @param {string} connectionId
   * @returns {number}
   */
  nextSeqId(connectionId) {
    const record = this.#connections.get(connectionId);
    if (!record) return -1;
    record.seqId += 1;
    return record.seqId;
  }

  // ─── Zombie Scan ─────────────────────────────────────────────────────────

  /**
   * 启动僵尸连接定期扫描。
   * 若 lastAliveAt 超过 2×HEARTBEAT_INTERVAL + PONG_TIMEOUT，则发出 connection:dead。
   */
  startZombieScan() {
    if (this.#zombieScanTimer) return; // 已启动，幂等

    const deadThresholdMs = 2 * HEARTBEAT_INTERVAL_MS + HEARTBEAT_PONG_TIMEOUT_MS;

    this.#zombieScanTimer = setInterval(() => {
      const now = Date.now();
      for (const record of this.#connections.values()) {
        if (now - record.lastAliveAt > deadThresholdMs) {
          console.log(
            `[Registry] zombie detected: ${record.connectionId} (user=${record.userId}, ` +
            `silent=${now - record.lastAliveAt}ms)`
          );
          this.emit('connection:dead', {
            connectionId: record.connectionId,
            type: record.type,
            userId: record.userId,
            lastAliveAt: record.lastAliveAt,
          });
        }
      }
    }, ZOMBIE_SCAN_INTERVAL_MS);

    console.log(`[Registry] zombie scan started (interval=${ZOMBIE_SCAN_INTERVAL_MS}ms, threshold=${deadThresholdMs}ms)`);
  }

  /**
   * 停止僵尸连接扫描。
   */
  stopZombieScan() {
    if (!this.#zombieScanTimer) return;
    clearInterval(this.#zombieScanTimer);
    this.#zombieScanTimer = null;
    console.log('[Registry] zombie scan stopped');
  }

  /**
   * 释放全部资源：停止扫描、清空连接表。
   */
  dispose() {
    this.stopZombieScan();
    this.#connections.clear();
    console.log('[Registry] disposed');
  }
}

// 导出单例，方便全局共享
export default new ConnectionRegistry();
