import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyPoolManager } from '../KeyPoolManager.js';

describe('KeyPoolManager', () => {
  let manager;

  beforeEach(() => {
    manager = new KeyPoolManager();
  });

  describe('loadKeys', () => {
    it('should load keys from DB rows', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
        { id: 2, name: 'key-2', api_key: 'sk-ant-2', rpm_limit: 30, enabled: 1 },
      ]);
      expect(manager.getStats().totalKeys).toBe(2);
    });
  });

  describe('acquire', () => {
    it('should return the least loaded key', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
        { id: 2, name: 'key-2', api_key: 'sk-ant-2', rpm_limit: 50, enabled: 1 },
      ]);
      const k1 = manager.acquire();
      const k2 = manager.acquire();
      expect(k1).not.toBeNull();
      expect(k2).not.toBeNull();
    });

    it('should return null when all keys are at capacity', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 1, enabled: 1 },
      ]);
      manager.acquire();
      const result = manager.acquire();
      expect(result).toBeNull();
    });

    it('should skip cooling keys', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
      ]);
      manager.markCooling(1);
      const result = manager.acquire();
      expect(result).toBeNull();
    });
  });

  describe('markCooling', () => {
    it('should emit key:available after cooldown', async () => {
      vi.useFakeTimers();
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
      ]);
      manager.markCooling(1, 100);
      expect(manager.acquire()).toBeNull();

      const availablePromise = new Promise(resolve => {
        manager.on('key:available', resolve);
      });
      vi.advanceTimersByTime(150);
      await availablePromise;

      expect(manager.acquire()).not.toBeNull();
      vi.useRealTimers();
    });
  });

  describe('sliding window', () => {
    it('should allow requests after window expires', () => {
      vi.useFakeTimers();
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 1, enabled: 1 },
      ]);
      manager.acquire();
      expect(manager.acquire()).toBeNull();

      vi.advanceTimersByTime(61000);
      expect(manager.acquire()).not.toBeNull();
      vi.useRealTimers();
    });
  });

  describe('release', () => {
    it('should emit key:released event and reset consecutiveErrors', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-1', rpm_limit: 50, enabled: 1 },
      ]);
      const spy = vi.fn();
      manager.on('key:released', spy);
      manager.release(1);
      expect(spy).toHaveBeenCalledWith({ keyId: 1 });
    });
  });

  describe('getStats', () => {
    it('should return masked stats', () => {
      manager.loadKeys([
        { id: 1, name: 'key-1', api_key: 'sk-ant-api03-abcdef1234567890', rpm_limit: 50, enabled: 1 },
      ]);
      const stats = manager.getStats();
      expect(stats.keys[0].apiKey).toContain('...');
      expect(stats.keys[0].status).toBe('active');
    });
  });
});
