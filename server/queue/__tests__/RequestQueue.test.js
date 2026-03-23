import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RequestQueue } from '../RequestQueue.js';

describe('RequestQueue', () => {
  let queue;
  let mockKeyPool;

  beforeEach(() => {
    mockKeyPool = {
      acquire: vi.fn().mockReturnValue(null),
      hasAvailable: vi.fn().mockReturnValue(false),
      on: vi.fn(),
      release: vi.fn(),
      getStats: vi.fn().mockReturnValue({ activeKeys: 1 }),
    };
    queue = new RequestQueue(mockKeyPool);
  });

  afterEach(() => {
    queue.dispose();
  });

  describe('enqueue', () => {
    it('should fast-path when queue is empty and key available', () => {
      mockKeyPool.acquire.mockReturnValue({ id: 1, name: 'key-1', apiKey: 'sk-1' });
      const result = queue.enqueue({
        userId: 1, username: 'alice', connectionId: 'conn-1',
        command: 'hello', options: {},
      });
      expect(result.queued).toBe(false);
      expect(result.assignedKey).toBeTruthy();
    });

    it('should queue when no key available', () => {
      const result = queue.enqueue({
        userId: 1, username: 'alice', connectionId: 'conn-1',
        command: 'hello', options: {},
      });
      expect(result.queued).toBe(true);
      expect(result.position).toBe(1);
    });

    it('should queue when queue is not empty even if key available', () => {
      queue.enqueue({ userId: 1, username: 'alice', connectionId: 'conn-1', command: 'hello', options: {} });
      mockKeyPool.acquire.mockReturnValue({ id: 1, name: 'key-1', apiKey: 'sk-1' });
      const result = queue.enqueue({ userId: 2, username: 'bob', connectionId: 'conn-2', command: 'world', options: {} });
      expect(result.queued).toBe(true);
    });

    it('should reject when queue is full', () => {
      queue._maxSize = 2;
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
      queue.enqueue({ userId: 2, username: 'b', connectionId: 'c2', command: '', options: {} });
      const result = queue.enqueue({ userId: 3, username: 'c', connectionId: 'c3', command: '', options: {} });
      expect(result.rejected).toBe(true);
    });

    it('should enforce per-user queue limit', () => {
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'c2', command: '', options: {} });
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'c3', command: '', options: {} });
      const result = queue.enqueue({ userId: 1, username: 'a', connectionId: 'c4', command: '', options: {} });
      expect(result.rejected).toBe(true);
    });
  });

  describe('cancel', () => {
    it('should remove item from queue', () => {
      const result = queue.enqueue({ userId: 1, username: 'alice', connectionId: 'conn-1', command: 'hello', options: {} });
      queue.cancel(result.requestId);
      expect(queue.getStats().queueLength).toBe(0);
    });
  });

  describe('cancelByConnection', () => {
    it('should remove all items for a connection', () => {
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'conn-1', command: '', options: {} });
      queue.enqueue({ userId: 1, username: 'a', connectionId: 'conn-1', command: '', options: {} });
      queue.enqueue({ userId: 2, username: 'b', connectionId: 'conn-2', command: '', options: {} });
      queue.cancelByConnection('conn-1');
      expect(queue.getStats().queueLength).toBe(1);
    });
  });

  describe('dispatch', () => {
    it('should dispatch head of queue when key becomes available', () => {
      const onDispatched = vi.fn();
      queue.enqueue({ userId: 1, username: 'alice', connectionId: 'conn-1', command: 'hello', options: {}, onDispatched });
      expect(queue.getStats().queueLength).toBe(1);
      mockKeyPool.acquire.mockReturnValue({ id: 1, name: 'key-1', apiKey: 'sk-1' });
      queue._tryDispatchNext();
      expect(onDispatched).toHaveBeenCalled();
      expect(queue.getStats().queueLength).toBe(0);
    });
  });

  describe('getPosition', () => {
    it('should return correct position', () => {
      const r1 = queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
      const r2 = queue.enqueue({ userId: 2, username: 'b', connectionId: 'c2', command: '', options: {} });
      expect(queue.getPosition(r1.requestId)).toBe(1);
      expect(queue.getPosition(r2.requestId)).toBe(2);
    });
  });
});
