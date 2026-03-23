import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { KeyPoolManager } from '../KeyPoolManager.js';
import { RequestQueue } from '../RequestQueue.js';

describe('KeyPool + RequestQueue Integration', () => {
  let keyPool;
  let queue;

  beforeEach(() => {
    keyPool = new KeyPoolManager();
    keyPool.loadKeys([
      { id: 1, name: 'key-1', api_key: 'sk-1', rpm_limit: 2, enabled: 1 },
      { id: 2, name: 'key-2', api_key: 'sk-2', rpm_limit: 2, enabled: 1 },
    ]);
    queue = new RequestQueue(keyPool);
  });

  afterEach(() => {
    queue.dispose();
    keyPool.dispose();
  });

  it('should fast-path first requests', () => {
    const r = queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
    expect(r.queued).toBe(false);
    expect(r.assignedKey).toBeTruthy();
  });

  it('should queue when all keys at capacity', () => {
    // Exhaust all keys (2 keys * 2 rpm = 4 requests)
    for (let i = 0; i < 4; i++) {
      queue.enqueue({ userId: i, username: `u${i}`, connectionId: `c${i}`, command: '', options: {} });
    }
    // 5th should queue
    const r = queue.enqueue({ userId: 5, username: 'u5', connectionId: 'c5', command: '', options: {} });
    expect(r.queued).toBe(true);
  });

  it('should dispatch queued request when key is released via sliding window', () => {
    vi.useFakeTimers();

    // Exhaust keys
    for (let i = 0; i < 4; i++) {
      queue.enqueue({ userId: i, username: `u${i}`, connectionId: `c${i}`, command: '', options: {} });
    }

    const onDispatched = vi.fn();
    queue.enqueue({ userId: 5, username: 'u5', connectionId: 'c5', command: '', options: {}, onDispatched });
    expect(queue.getStats().queueLength).toBe(1);

    // Advance past sliding window so RPM resets
    vi.advanceTimersByTime(61000);

    // Release triggers dispatch via event
    keyPool.release(1);

    expect(onDispatched).toHaveBeenCalled();
    expect(queue.getStats().queueLength).toBe(0);
    vi.useRealTimers();
  });

  it('should handle 429 cooling and recovery', () => {
    vi.useFakeTimers();
    const r1 = queue.enqueue({ userId: 1, username: 'a', connectionId: 'c1', command: '', options: {} });
    expect(r1.queued).toBe(false);

    // Mark key as cooling
    keyPool.markCooling(r1.assignedKey.id, 100);

    // After cooldown, key:available fires and should dispatch any queued items
    // But we have no queued items yet, so just verify key is available again
    vi.advanceTimersByTime(150);

    const r2 = queue.enqueue({ userId: 2, username: 'b', connectionId: 'c2', command: '', options: {} });
    expect(r2.queued).toBe(false); // should get a key
    vi.useRealTimers();
  });

  it('should handle cancelByConnection', () => {
    // Exhaust keys first
    for (let i = 0; i < 4; i++) {
      queue.enqueue({ userId: i, username: `u${i}`, connectionId: `c${i}`, command: '', options: {} });
    }
    // Queue two more from same connection
    queue.enqueue({ userId: 5, username: 'u5', connectionId: 'conn-x', command: '', options: {} });
    queue.enqueue({ userId: 5, username: 'u5', connectionId: 'conn-x', command: '', options: {} });
    expect(queue.getStats().queueLength).toBe(2);

    queue.cancelByConnection('conn-x');
    expect(queue.getStats().queueLength).toBe(0);
  });
});
