/**
 * 团队 WebSocket 广播工具单元测试
 *
 * 测试 team-websocket.js 的广播过滤逻辑。
 * 使用模拟的 WebSocket 客户端 Map。
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  broadcastToTeam,
  broadcastToUser,
  broadcastTeamMemberChange,
  broadcastTeamActivity,
  broadcastNotification,
  getOnlineTeamMembers
} from '../server/utils/team-websocket.js';

// ── Mock WebSocket ──

class MockWebSocket {
  constructor(readyState = 1) { // 1 = OPEN
    this.readyState = readyState;
    this.sent = [];
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
}

function createClients() {
  const ws1 = new MockWebSocket();
  const ws2 = new MockWebSocket();
  const ws3 = new MockWebSocket();
  const ws4 = new MockWebSocket(3); // CLOSED

  const clients = new Map();
  clients.set(ws1, { userId: 1, username: 'alice', teamIds: [10, 20], currentProject: '/proj/a' });
  clients.set(ws2, { userId: 2, username: 'bob', teamIds: [10], currentProject: '/proj/b' });
  clients.set(ws3, { userId: 3, username: 'charlie', teamIds: [20], currentProject: null });
  clients.set(ws4, { userId: 4, username: 'dave', teamIds: [10], currentProject: null }); // closed

  return { clients, ws1, ws2, ws3, ws4 };
}

// =============================================
// Tests
// =============================================

describe('broadcastToTeam - 团队广播', () => {
  it('只向指定团队成员发送消息', () => {
    const { clients, ws1, ws2, ws3, ws4 } = createClients();
    const msg = { type: 'test', data: 'hello' };

    broadcastToTeam(clients, 10, msg);

    // alice(team 10,20) and bob(team 10) should receive
    assert.equal(ws1.sent.length, 1);
    assert.deepEqual(ws1.sent[0], msg);
    assert.equal(ws2.sent.length, 1);

    // charlie(team 20) should NOT
    assert.equal(ws3.sent.length, 0);

    // dave(team 10 but CLOSED) should NOT
    assert.equal(ws4.sent.length, 0);
  });

  it('可排除指定用户', () => {
    const { clients, ws1, ws2 } = createClients();
    const msg = { type: 'test' };

    broadcastToTeam(clients, 10, msg, 1); // exclude alice

    assert.equal(ws1.sent.length, 0);
    assert.equal(ws2.sent.length, 1);
  });

  it('空 clients 不报错', () => {
    assert.doesNotThrow(() => broadcastToTeam(null, 10, {}));
    assert.doesNotThrow(() => broadcastToTeam(new Map(), 10, {}));
  });

  it('无 teamId 不报错', () => {
    const { clients } = createClients();
    assert.doesNotThrow(() => broadcastToTeam(clients, null, {}));
  });
});

describe('broadcastToUser - 用户定向广播', () => {
  it('只向指定用户发送消息', () => {
    const { clients, ws1, ws2, ws3 } = createClients();
    const msg = { type: 'dm', text: 'for bob' };

    broadcastToUser(clients, 2, msg);

    assert.equal(ws1.sent.length, 0);
    assert.equal(ws2.sent.length, 1);
    assert.equal(ws3.sent.length, 0);
  });

  it('用户多个连接都收到消息', () => {
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    const clients = new Map();
    clients.set(ws1, { userId: 1, username: 'alice', teamIds: [] });
    clients.set(ws2, { userId: 1, username: 'alice', teamIds: [] }); // 同一用户的第二个连接

    broadcastToUser(clients, 1, { type: 'test' });

    assert.equal(ws1.sent.length, 1);
    assert.equal(ws2.sent.length, 1);
  });
});

describe('broadcastTeamMemberChange - 成员变更广播', () => {
  it('广播包含正确的消息结构', () => {
    const { clients, ws1 } = createClients();

    broadcastTeamMemberChange(clients, 10, 'joined', { userId: 5, username: 'eve' });

    assert.equal(ws1.sent.length, 1);
    const msg = ws1.sent[0];
    assert.equal(msg.type, 'team-member-changed');
    assert.equal(msg.teamId, 10);
    assert.equal(msg.changeType, 'joined');
    assert.deepEqual(msg.member, { userId: 5, username: 'eve' });
    assert.ok(msg.timestamp);
  });
});

describe('broadcastTeamActivity - 活动广播', () => {
  it('广播活动到团队', () => {
    const { clients, ws2 } = createClients();
    const activity = { action: 'story_claimed', storyId: '1-2-auth' };

    broadcastTeamActivity(clients, 10, activity);

    assert.equal(ws2.sent.length, 1);
    assert.equal(ws2.sent[0].type, 'team-activity');
    assert.deepEqual(ws2.sent[0].activity, activity);
  });
});

describe('broadcastNotification - 通知广播', () => {
  it('向指定用户广播通知', () => {
    const { clients, ws1, ws2 } = createClients();
    const notification = { id: 1, title: 'You were mentioned', type: 'mention' };

    broadcastNotification(clients, 2, notification);

    assert.equal(ws1.sent.length, 0);
    assert.equal(ws2.sent.length, 1);
    assert.equal(ws2.sent[0].type, 'notification-new');
    assert.deepEqual(ws2.sent[0].notification, notification);
  });
});

describe('getOnlineTeamMembers - 在线成员查询', () => {
  it('返回团队在线成员列表', () => {
    const { clients } = createClients();

    const online10 = getOnlineTeamMembers(clients, 10);
    // alice(open), bob(open), dave(closed - still in Map but ws is closed)
    // dave should still show since we check teamIds not readyState here
    const usernames = online10.map(m => m.username);
    assert.ok(usernames.includes('alice'));
    assert.ok(usernames.includes('bob'));
    assert.ok(usernames.includes('dave')); // still tracked in Map
    assert.ok(!usernames.includes('charlie')); // not in team 10
  });

  it('返回成员当前位置信息', () => {
    const { clients } = createClients();
    const online = getOnlineTeamMembers(clients, 10);

    const alice = online.find(m => m.username === 'alice');
    assert.equal(alice.currentProject, '/proj/a');
    assert.equal(alice.status, 'online');
  });

  it('同一用户多连接只返回一条', () => {
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    const clients = new Map();
    clients.set(ws1, { userId: 1, username: 'alice', teamIds: [10], currentProject: '/a' });
    clients.set(ws2, { userId: 1, username: 'alice', teamIds: [10], currentProject: '/b' });

    const online = getOnlineTeamMembers(clients, 10);
    assert.equal(online.length, 1);
  });
});
