import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  QUEUE_MAX_SIZE,
  QUEUE_TIMEOUT_MS,
  QUEUE_POLL_INTERVAL_MS,
  QUOTA_MAX_QUEUE_PER_USER,
} from '../config/constants.js';

export class RequestQueue extends EventEmitter {
  #queue = [];
  #keyPool;
  #pollTimer = null;
  #timeoutTimers = new Map();
  _maxSize = QUEUE_MAX_SIZE;

  constructor(keyPool) {
    super();
    this.#keyPool = keyPool;
    keyPool.on('key:available', () => this._tryDispatchNext());
    keyPool.on('key:released', () => this._tryDispatchNext());
    this.#pollTimer = setInterval(() => this._tryDispatchNext(), QUEUE_POLL_INTERVAL_MS);
  }

  enqueue({ userId, username, connectionId, command, options, onDispatched }) {
    const userCount = this.#queue.filter(item => item.userId === userId && item.status === 'waiting').length;
    if (userCount >= QUOTA_MAX_QUEUE_PER_USER) {
      return { rejected: true, reason: `每用户最多排队 ${QUOTA_MAX_QUEUE_PER_USER} 个请求` };
    }
    if (this.#queue.length >= this._maxSize) {
      return { rejected: true, reason: '系统繁忙，请稍后重试' };
    }
    if (this.#queue.length === 0) {
      const key = this.#keyPool.acquire();
      if (key) {
        return { queued: false, requestId: randomUUID(), assignedKey: key };
      }
    }
    const requestId = randomUUID();
    const item = {
      id: requestId, userId, username, connectionId, command, options,
      priority: 0, enqueuedAt: Date.now(), status: 'waiting',
      onDispatched: onDispatched || null,
    };
    this.#queue.push(item);
    const timer = setTimeout(() => {
      this.#removeItem(requestId);
      this.#timeoutTimers.delete(requestId);
      this.emit('queue:timeout', { requestId, userId, connectionId });
    }, QUEUE_TIMEOUT_MS);
    this.#timeoutTimers.set(requestId, timer);
    const position = this.#queue.filter(i => i.status === 'waiting').indexOf(item) + 1;
    return { queued: true, requestId, position };
  }

  requeue({ userId, username, connectionId, command, options, onDispatched }) {
    const requestId = randomUUID();
    const item = {
      id: requestId, userId, username, connectionId, command, options,
      priority: -1, enqueuedAt: Date.now(), status: 'waiting',
      onDispatched: onDispatched || null,
    };
    this.#queue.unshift(item);
    const timer = setTimeout(() => {
      this.#removeItem(requestId);
      this.#timeoutTimers.delete(requestId);
      this.emit('queue:timeout', { requestId, userId, connectionId });
    }, QUEUE_TIMEOUT_MS);
    this.#timeoutTimers.set(requestId, timer);
    this._tryDispatchNext();
    return { queued: true, requestId, position: 1 };
  }

  cancel(requestId) {
    this.#removeItem(requestId);
    const timer = this.#timeoutTimers.get(requestId);
    if (timer) { clearTimeout(timer); this.#timeoutTimers.delete(requestId); }
  }

  cancelByConnection(connectionId) {
    const toRemove = this.#queue.filter(i => i.connectionId === connectionId && i.status === 'waiting');
    for (const item of toRemove) { this.cancel(item.id); }
  }

  getPosition(requestId) {
    const waiting = this.#queue.filter(i => i.status === 'waiting');
    const idx = waiting.findIndex(i => i.id === requestId);
    return idx === -1 ? null : idx + 1;
  }

  _tryDispatchNext() {
    while (true) {
      const next = this.#queue.find(i => i.status === 'waiting');
      if (!next) return;
      const key = this.#keyPool.acquire();
      if (!key) return;
      next.status = 'dispatched';
      this.#removeItem(next.id);
      const timer = this.#timeoutTimers.get(next.id);
      if (timer) { clearTimeout(timer); this.#timeoutTimers.delete(next.id); }
      if (next.onDispatched) { next.onDispatched({ assignedKey: key, request: next }); }
      this.emit('queue:dispatched', { requestId: next.id, keyId: key.id, userId: next.userId });
    }
  }

  getQueueStatusForAll(avgCompletionTimeMs = 10000) {
    const activeKeyCount = this.#keyPool.getStats().activeKeys || 1;
    const waiting = this.#queue.filter(i => i.status === 'waiting');
    return waiting.map((item, index) => ({
      requestId: item.id, connectionId: item.connectionId, userId: item.userId,
      position: index + 1,
      estimatedWaitSec: Math.ceil(((index + 1) * avgCompletionTimeMs) / (activeKeyCount * 1000)),
    }));
  }

  getStats() {
    return {
      queueLength: this.#queue.filter(i => i.status === 'waiting').length,
      totalItems: this.#queue.length,
    };
  }

  #removeItem(requestId) {
    const idx = this.#queue.findIndex(i => i.id === requestId);
    if (idx !== -1) this.#queue.splice(idx, 1);
  }

  dispose() {
    if (this.#pollTimer) { clearInterval(this.#pollTimer); this.#pollTimer = null; }
    for (const timer of this.#timeoutTimers.values()) clearTimeout(timer);
    this.#timeoutTimers.clear();
    this.#queue = [];
  }
}
