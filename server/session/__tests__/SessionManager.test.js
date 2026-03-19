import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { nextState, SessionManager } from '../SessionManager.js';

// ── nextState pure function ──────────────────────────────────────────────────

describe('nextState', () => {
  it('idle + start → running', () => {
    assert.strictEqual(nextState('idle', 'start'), 'running');
  });

  it('running + output → streaming', () => {
    assert.strictEqual(nextState('running', 'output'), 'streaming');
  });

  it('running + complete → completed', () => {
    assert.strictEqual(nextState('running', 'complete'), 'completed');
  });

  it('streaming + tool_use → tool_executing', () => {
    assert.strictEqual(nextState('streaming', 'tool_use'), 'tool_executing');
  });

  it('streaming + complete → completed', () => {
    assert.strictEqual(nextState('streaming', 'complete'), 'completed');
  });

  it('streaming + output → streaming (self-loop)', () => {
    assert.strictEqual(nextState('streaming', 'output'), 'streaming');
  });

  it('tool_executing + tool_result → streaming', () => {
    assert.strictEqual(nextState('tool_executing', 'tool_result'), 'streaming');
  });

  it('any state + abort → aborted', () => {
    for (const state of ['running', 'streaming', 'tool_executing']) {
      assert.strictEqual(nextState(state, 'abort'), 'aborted');
    }
  });

  it('any state + timeout → timeout', () => {
    for (const state of ['running', 'streaming', 'tool_executing']) {
      assert.strictEqual(nextState(state, 'timeout'), 'timeout');
    }
  });

  it('unknown event returns current state', () => {
    assert.strictEqual(nextState('streaming', 'unknown'), 'streaming');
  });

  it('terminal states ignore all events', () => {
    for (const state of ['completed', 'timeout', 'error', 'aborted']) {
      assert.strictEqual(nextState(state, 'output'), state);
    }
  });
});

// ── SessionManager ───────────────────────────────────────────────────────────

describe('SessionManager', () => {
  let sm;
  let timerList;

  beforeEach(() => {
    timerList = [];
    const fakeTimers = {
      setTimeout: (fn, ms) => { timerList.push({ fn, ms }); return timerList.length; },
      clearTimeout: (_id) => { /* no-op */ },
    };
    sm = new SessionManager(fakeTimers);
  });

  it('creates session with idle state', () => {
    const id = sm.create(1, 'conn-1', { providerType: 'claude' });
    assert.strictEqual(sm.getState(id), 'idle');
  });

  it('enforces per-user quota', () => {
    sm.create(1, 'c1', { providerType: 'claude' });
    sm.create(1, 'c2', { providerType: 'claude' });
    sm.create(1, 'c3', { providerType: 'claude' });
    assert.throws(() => sm.create(1, 'c4', { providerType: 'claude' }), /quota/i);
  });

  it('transitions state correctly', () => {
    const id = sm.create(1, 'c1', { providerType: 'claude' });
    sm.transition(id, 'start');
    assert.strictEqual(sm.getState(id), 'running');
    sm.transition(id, 'output');
    assert.strictEqual(sm.getState(id), 'streaming');
    sm.transition(id, 'complete');
    assert.strictEqual(sm.getState(id), 'completed');
  });

  it('cleanup removes session', () => {
    const id = sm.create(1, 'c1', { providerType: 'claude' });
    sm.cleanup(id);
    assert.strictEqual(sm.getState(id), undefined);
  });

  it('emits session:stateChanged', () => {
    const events = [];
    sm.on('session:stateChanged', e => events.push(e));
    const id = sm.create(1, 'c1', { providerType: 'claude' });
    sm.transition(id, 'start');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].from, 'idle');
    assert.strictEqual(events[0].to, 'running');
  });
});
