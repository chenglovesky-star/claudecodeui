import { EventEmitter } from 'events';
import {
  KEY_COOLDOWN_MS,
  KEY_ERROR_COOLDOWN_MS,
  KEY_MAX_CONSECUTIVE_ERRORS,
  KEY_RPM_WINDOW_MS,
} from '../config/constants.js';

export class KeyPoolManager extends EventEmitter {
  #keys = new Map();
  #cooldownTimers = new Map();

  loadKeys(rows) {
    this.#keys.clear();
    for (const row of rows) {
      if (!row.enabled) continue;
      this.#keys.set(row.id, {
        id: row.id, name: row.name, apiKey: row.api_key,
        rpmLimit: row.rpm_limit, status: 'active',
        requestTimestamps: [], consecutiveErrors: 0, coolingUntil: null,
      });
    }
  }

  addKey(row) {
    this.#keys.set(row.id, {
      id: row.id, name: row.name, apiKey: row.api_key,
      rpmLimit: row.rpm_limit, status: row.enabled ? 'active' : 'disabled',
      requestTimestamps: [], consecutiveErrors: 0, coolingUntil: null,
    });
  }

  removeKey(id) {
    this.#keys.delete(id);
    const timer = this.#cooldownTimers.get(id);
    if (timer) { clearTimeout(timer); this.#cooldownTimers.delete(id); }
  }

  acquire() {
    const now = Date.now();
    let bestKey = null;
    let bestLoad = Infinity;
    for (const [, key] of this.#keys) {
      if (key.status !== 'active') continue;
      key.requestTimestamps = key.requestTimestamps.filter(ts => now - ts < KEY_RPM_WINDOW_MS);
      const currentRpm = key.requestTimestamps.length;
      if (currentRpm >= key.rpmLimit) continue;
      const load = currentRpm / key.rpmLimit;
      if (load < bestLoad) { bestLoad = load; bestKey = key; }
    }
    if (!bestKey) return null;
    bestKey.requestTimestamps.push(now);
    return { id: bestKey.id, name: bestKey.name, apiKey: bestKey.apiKey };
  }

  release(keyId) {
    const key = this.#keys.get(keyId);
    if (key) key.consecutiveErrors = 0;
    this.emit('key:released', { keyId });
  }

  markCooling(keyId, cooldownMs = KEY_COOLDOWN_MS) {
    const key = this.#keys.get(keyId);
    if (!key) return;
    key.status = 'cooling';
    key.coolingUntil = Date.now() + cooldownMs;
    const existing = this.#cooldownTimers.get(keyId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      key.status = 'active'; key.coolingUntil = null;
      this.#cooldownTimers.delete(keyId);
      this.emit('key:available', { keyId });
    }, cooldownMs);
    this.#cooldownTimers.set(keyId, timer);
  }

  markError(keyId) {
    const key = this.#keys.get(keyId);
    if (!key) return;
    key.consecutiveErrors++;
    if (key.consecutiveErrors >= KEY_MAX_CONSECUTIVE_ERRORS) {
      key.status = 'error';
      const existing = this.#cooldownTimers.get(keyId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        key.status = 'active'; key.consecutiveErrors = 0;
        this.#cooldownTimers.delete(keyId);
        this.emit('key:available', { keyId });
      }, KEY_ERROR_COOLDOWN_MS);
      this.#cooldownTimers.set(keyId, timer);
    }
  }

  disableKey(keyId) {
    const key = this.#keys.get(keyId);
    if (key) key.status = 'disabled';
  }

  enableKey(keyId) {
    const key = this.#keys.get(keyId);
    if (key) { key.status = 'active'; key.consecutiveErrors = 0; this.emit('key:available', { keyId }); }
  }

  updateKeyRpmLimit(keyId, rpmLimit) {
    const key = this.#keys.get(keyId);
    if (key) key.rpmLimit = rpmLimit;
  }

  hasAvailable() {
    const now = Date.now();
    for (const [, key] of this.#keys) {
      if (key.status !== 'active') continue;
      const currentRpm = key.requestTimestamps.filter(ts => now - ts < KEY_RPM_WINDOW_MS).length;
      if (currentRpm < key.rpmLimit) return true;
    }
    return false;
  }

  getStats() {
    const now = Date.now();
    const keys = [];
    for (const [, key] of this.#keys) {
      const currentRpm = key.requestTimestamps.filter(ts => now - ts < KEY_RPM_WINDOW_MS).length;
      keys.push({
        id: key.id, name: key.name,
        apiKey: key.apiKey.length > 12 ? key.apiKey.slice(0, 8) + '...' + key.apiKey.slice(-4) : '***',
        status: key.status, rpmLimit: key.rpmLimit, currentRpm,
        consecutiveErrors: key.consecutiveErrors,
      });
    }
    return { totalKeys: this.#keys.size, activeKeys: keys.filter(k => k.status === 'active').length, keys };
  }

  dispose() {
    for (const timer of this.#cooldownTimers.values()) clearTimeout(timer);
    this.#cooldownTimers.clear();
    this.#keys.clear();
  }
}
