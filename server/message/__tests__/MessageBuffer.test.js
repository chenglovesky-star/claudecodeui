import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { MessageBuffer } from '../MessageBuffer.js';

describe('MessageBuffer', () => {
  let buf;

  beforeEach(() => {
    buf = new MessageBuffer();
  });

  it('stores and retrieves critical events', () => {
    buf.addCriticalEvent('s1', { type: 'session-started', seqId: 1 });
    const events = buf.getEventsSince('s1', 0);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'session-started');
  });

  it('pins session-started event across eviction', () => {
    // BUFFER_CRITICAL_EVENTS_MAX = 500, add session-started then 501 tool_use events
    // to force eviction of non-pinned entries
    buf.addCriticalEvent('s1', { type: 'session-started' });
    for (let i = 0; i < 501; i++) {
      buf.addCriticalEvent('s1', { type: 'tool_use', name: `tool_${i}` });
    }
    const events = buf.getEventsSince('s1', 0);
    // session-started must still be present (pinned)
    assert.ok(events.some(e => e.type === 'session-started'), 'session-started should be pinned');
  });

  it('tracks snapshot content', () => {
    buf.appendContent('s1', 'Hello ');
    buf.appendContent('s1', 'World');
    const snap = buf.getSnapshot('s1');
    assert.strictEqual(snap.currentContent, 'Hello World');
  });

  it('clears session data', () => {
    buf.appendContent('s1', 'test');
    buf.addCriticalEvent('s1', { type: 'session-started' });
    buf.clearSession('s1');
    const snap = buf.getSnapshot('s1');
    assert.strictEqual(snap.currentContent, '');
  });

  it('getResumeData returns complete structure', () => {
    buf.addCriticalEvent('s1', { type: 'session-started', seqId: 1 });
    buf.appendContent('s1', 'content');
    const data = buf.getResumeData('s1', 0, 'streaming');
    assert.ok(Array.isArray(data.missedCriticalEvents), 'missedCriticalEvents should be an array');
    assert.ok(data.snapshot, 'snapshot should be present');
    assert.strictEqual(data.currentState, 'streaming');
  });
});
