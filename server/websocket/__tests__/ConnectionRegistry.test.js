import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { ConnectionRegistry } from '../ConnectionRegistry.js';

describe('ConnectionRegistry', () => {
  let reg;
  const mockWs = {
    readyState: 1,
    on: () => {},
    removeListener: () => {},
    terminate: () => {},
  };

  beforeEach(() => {
    // Instantiate a fresh registry per test (not the shared singleton default export)
    reg = new ConnectionRegistry();
  });

  afterEach(() => {
    reg.dispose();
  });

  it('registers and retrieves connections', () => {
    const id = reg.register(mockWs, 'chat', 1, 'testuser');
    assert.ok(id, 'should return a connectionId');
    const conn = reg.get(id);
    assert.strictEqual(conn.type, 'chat');
    assert.strictEqual(conn.userId, 1);
  });

  it('unregisters connections', () => {
    const id = reg.register(mockWs, 'chat', 1, 'testuser');
    reg.unregister(id);
    assert.strictEqual(reg.get(id), null);
  });

  it('filters by type', () => {
    reg.register(mockWs, 'chat', 1, 'user1');
    reg.register(mockWs, 'shell', 1, 'user1');
    reg.register(mockWs, 'chat', 2, 'user2');
    assert.strictEqual(reg.getAllByType('chat').length, 2);
    assert.strictEqual(reg.getAllByType('shell').length, 1);
  });

  it('filters by userId', () => {
    reg.register(mockWs, 'chat', 1, 'user1');
    reg.register(mockWs, 'chat', 1, 'user1');
    reg.register(mockWs, 'chat', 2, 'user2');
    assert.strictEqual(reg.getByUserId(1).length, 2);
    assert.strictEqual(reg.getByUserId(2).length, 1);
  });

  it('increments seqId', () => {
    const id = reg.register(mockWs, 'chat', 1, 'user1');
    assert.strictEqual(reg.nextSeqId(id), 1);
    assert.strictEqual(reg.nextSeqId(id), 2);
    assert.strictEqual(reg.nextSeqId(id), 3);
  });

  it('emits events on register/unregister', () => {
    const events = [];
    reg.on('connection:registered', () => events.push('reg'));
    reg.on('connection:unregistered', () => events.push('unreg'));
    const id = reg.register(mockWs, 'chat', 1, 'user1');
    reg.unregister(id);
    assert.deepStrictEqual(events, ['reg', 'unreg']);
  });
});
