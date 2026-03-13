/**
 * 团队数据库操作单元测试
 *
 * 测试 teamDb, activityDb, notificationsDb 的所有 CRUD 操作。
 * 使用内存中的独立 SQLite 数据库，不影响生产数据。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Setup: create in-memory DB with same schema ──

let db;

function setupTestDb() {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load init.sql schema
  const initSQL = fs.readFileSync(path.join(__dirname, '../server/database/init.sql'), 'utf8');
  db.exec(initSQL);

  // Create test users
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('alice', 'hash1');
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('bob', 'hash2');
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('charlie', 'hash3');
}

// ── Inline db operations (mirror db.js logic against test db) ──

const teamDb = {
  createTeam: (name, description, createdBy, settings = '{}') => {
    const stmt = db.prepare('INSERT INTO teams (name, description, created_by, settings) VALUES (?, ?, ?, ?)');
    const result = stmt.run(name, description, createdBy, settings);
    db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(result.lastInsertRowid, createdBy, 'pm');
    return { id: Number(result.lastInsertRowid), name, description };
  },
  getTeamById: (teamId) => db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId),
  getTeamsForUser: (userId) => db.prepare(`
    SELECT t.*, tm.role as user_role
    FROM teams t JOIN team_members tm ON t.id = tm.team_id
    WHERE tm.user_id = ? AND tm.is_active = 1 ORDER BY t.updated_at DESC
  `).all(userId),
  updateTeam: (teamId, name, description, settings) => {
    return db.prepare('UPDATE teams SET name = ?, description = ?, settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name, description, settings || '{}', teamId).changes > 0;
  },
  deleteTeam: (teamId) => db.prepare('DELETE FROM teams WHERE id = ?').run(teamId).changes > 0,
  getTeamMembers: (teamId) => db.prepare(`
    SELECT tm.*, u.username FROM team_members tm
    JOIN users u ON tm.user_id = u.id
    WHERE tm.team_id = ? AND tm.is_active = 1 ORDER BY tm.joined_at ASC
  `).all(teamId),
  addMember: (teamId, userId, role = 'developer') => {
    return db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(teamId, userId, role).changes > 0;
  },
  updateMemberRole: (teamId, userId, role) => {
    return db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(role, teamId, userId).changes > 0;
  },
  removeMember: (teamId, userId) => {
    return db.prepare('UPDATE team_members SET is_active = 0 WHERE team_id = ? AND user_id = ?').run(teamId, userId).changes > 0;
  },
  isMember: (teamId, userId) => {
    return !!db.prepare('SELECT id FROM team_members WHERE team_id = ? AND user_id = ? AND is_active = 1').get(teamId, userId);
  },
  getMemberRole: (teamId, userId) => {
    const row = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ? AND is_active = 1').get(teamId, userId);
    return row?.role || null;
  },
  getUserTeamRoles: (userId) => {
    const rows = db.prepare('SELECT team_id, role FROM team_members WHERE user_id = ? AND is_active = 1').all(userId);
    const map = {};
    for (const row of rows) map[row.team_id] = row.role;
    return map;
  },
  createInvite: (teamId, createdBy, expiresAt = null, maxUses = 1) => {
    const inviteCode = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO team_invites (team_id, invite_code, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)').run(teamId, inviteCode, createdBy, expiresAt, maxUses);
    return inviteCode;
  },
  useInvite: (inviteCode, userId) => {
    const invite = db.prepare('SELECT * FROM team_invites WHERE invite_code = ?').get(inviteCode);
    if (!invite) return { success: false, error: 'Invalid invite code' };
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) return { success: false, error: 'Invite expired' };
    if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) return { success: false, error: 'Invite has been used up' };
    if (teamDb.isMember(invite.team_id, userId)) return { success: false, error: 'Already a team member' };
    const addResult = teamDb.addMember(invite.team_id, userId, 'developer');
    if (addResult) db.prepare('UPDATE team_invites SET use_count = use_count + 1 WHERE id = ?').run(invite.id);
    return { success: true, teamId: invite.team_id };
  },
  getInvites: (teamId) => db.prepare('SELECT * FROM team_invites WHERE team_id = ?').all(teamId),
  deleteInvite: (inviteId, teamId) => db.prepare('DELETE FROM team_invites WHERE id = ? AND team_id = ?').run(inviteId, teamId).changes > 0,
  addProject: (teamId, projectPath, addedBy) => {
    return db.prepare('INSERT OR IGNORE INTO team_projects (team_id, project_path, added_by) VALUES (?, ?, ?)').run(teamId, projectPath, addedBy).changes > 0;
  },
  getProjects: (teamId) => db.prepare('SELECT * FROM team_projects WHERE team_id = ? ORDER BY added_at DESC').all(teamId),
  removeProject: (teamId, projectPath) => db.prepare('DELETE FROM team_projects WHERE team_id = ? AND project_path = ?').run(teamId, projectPath).changes > 0,
  getTeamsForProject: (projectPath) => db.prepare(`
    SELECT t.* FROM teams t JOIN team_projects tp ON t.id = tp.team_id WHERE tp.project_path = ?
  `).all(projectPath),
};

const activityDb = {
  log: (teamId, userId, actionType, entityType = null, entityId = null, metadata = '{}') => {
    return db.prepare('INSERT INTO activity_log (team_id, user_id, action_type, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)').run(teamId, userId, actionType, entityType, entityId, metadata);
  },
  getForTeam: (teamId, limit = 50, offset = 0) => {
    return db.prepare(`
      SELECT al.*, u.username FROM activity_log al
      JOIN users u ON al.user_id = u.id
      WHERE al.team_id = ? ORDER BY al.created_at DESC LIMIT ? OFFSET ?
    `).all(teamId, limit, offset);
  }
};

const notificationsDb = {
  create: (userId, teamId, type, title, body = null, link = null) => {
    const stmt = db.prepare('INSERT INTO notifications (user_id, team_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)');
    return { id: Number(stmt.run(userId, teamId, type, title, body, link).lastInsertRowid) };
  },
  getForUser: (userId, limit = 50, offset = 0, unreadOnly = false) => {
    const where = unreadOnly ? 'AND n.is_read = 0' : '';
    return db.prepare(`
      SELECT n.*, t.name as team_name FROM notifications n
      LEFT JOIN teams t ON n.team_id = t.id
      WHERE n.user_id = ? ${where} ORDER BY n.created_at DESC LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
  },
  getUnreadCount: (userId) => {
    return db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).count;
  },
  markAsRead: (notificationId, userId) => {
    return db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notificationId, userId).changes > 0;
  },
  markAllAsRead: (userId, teamId = null) => {
    if (teamId) return db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND team_id = ?').run(userId, teamId).changes;
    return db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId).changes;
  }
};

// =============================================
// Tests
// =============================================

describe('teamDb - 团队 CRUD', () => {
  before(() => setupTestDb());
  after(() => db.close());

  it('创建团队并自动将创建者设为 PM', () => {
    const team = teamDb.createTeam('Alpha Team', 'Test team', 1);
    assert.equal(team.name, 'Alpha Team');
    assert.ok(team.id > 0);

    // 创建者应该是 PM
    const role = teamDb.getMemberRole(team.id, 1);
    assert.equal(role, 'pm');

    // 应该能查到这个团队
    const fetched = teamDb.getTeamById(team.id);
    assert.equal(fetched.name, 'Alpha Team');
    assert.equal(fetched.description, 'Test team');
  });

  it('更新团队信息', () => {
    const team = teamDb.createTeam('Beta', null, 1);
    const success = teamDb.updateTeam(team.id, 'Beta Updated', 'New desc', '{"sprint": 2}');
    assert.ok(success);

    const updated = teamDb.getTeamById(team.id);
    assert.equal(updated.name, 'Beta Updated');
    assert.equal(updated.description, 'New desc');
    assert.equal(updated.settings, '{"sprint": 2}');
  });

  it('获取用户所属的所有团队', () => {
    const teams = teamDb.getTeamsForUser(1);
    assert.ok(teams.length >= 2); // Alpha + Beta
    assert.ok(teams.every(t => t.user_role === 'pm'));
  });

  it('删除团队（级联删除成员）', () => {
    const team = teamDb.createTeam('ToDelete', null, 1);
    teamDb.addMember(team.id, 2, 'developer');
    assert.ok(teamDb.isMember(team.id, 2));

    const deleted = teamDb.deleteTeam(team.id);
    assert.ok(deleted);
    assert.equal(teamDb.getTeamById(team.id), undefined);
    // 成员也应该被级联删除
    assert.ok(!teamDb.isMember(team.id, 2));
  });
});

describe('teamDb - 成员管理', () => {
  let teamId;

  before(() => {
    setupTestDb();
    const team = teamDb.createTeam('Members Test', null, 1);
    teamId = team.id;
  });
  after(() => db.close());

  it('添加成员', () => {
    const added = teamDb.addMember(teamId, 2, 'developer');
    assert.ok(added);
    assert.ok(teamDb.isMember(teamId, 2));
  });

  it('不能重复添加同一成员', () => {
    const added = teamDb.addMember(teamId, 2, 'architect'); // INSERT OR IGNORE
    assert.ok(!added); // 不应有变更
  });

  it('获取团队成员列表', () => {
    teamDb.addMember(teamId, 3, 'qa');
    const members = teamDb.getTeamMembers(teamId);
    assert.equal(members.length, 3); // alice(pm) + bob(developer) + charlie(qa)
    assert.ok(members.some(m => m.username === 'alice' && m.role === 'pm'));
    assert.ok(members.some(m => m.username === 'bob' && m.role === 'developer'));
    assert.ok(members.some(m => m.username === 'charlie' && m.role === 'qa'));
  });

  it('更新成员角色', () => {
    const success = teamDb.updateMemberRole(teamId, 2, 'architect');
    assert.ok(success);
    assert.equal(teamDb.getMemberRole(teamId, 2), 'architect');
  });

  it('移除成员（软删除）', () => {
    const removed = teamDb.removeMember(teamId, 3);
    assert.ok(removed);
    assert.ok(!teamDb.isMember(teamId, 3));

    // 移除后的成员不应出现在成员列表中
    const members = teamDb.getTeamMembers(teamId);
    assert.ok(!members.some(m => m.user_id === 3));
  });

  it('获取用户全部团队角色', () => {
    const roles = teamDb.getUserTeamRoles(1);
    assert.equal(roles[teamId], 'pm');
  });
});

describe('teamDb - 邀请系统', () => {
  let teamId;

  before(() => {
    setupTestDb();
    const team = teamDb.createTeam('Invite Test', null, 1);
    teamId = team.id;
  });
  after(() => db.close());

  it('创建邀请码', () => {
    const code = teamDb.createInvite(teamId, 1, null, 0);
    assert.ok(code);
    assert.equal(typeof code, 'string');
    assert.equal(code.length, 32); // 16 bytes hex = 32 chars
  });

  it('使用邀请码加入团队', () => {
    const code = teamDb.createInvite(teamId, 1, null, 0);
    const result = teamDb.useInvite(code, 2);
    assert.ok(result.success);
    assert.equal(result.teamId, teamId);
    assert.ok(teamDb.isMember(teamId, 2));
  });

  it('无效邀请码返回错误', () => {
    const result = teamDb.useInvite('nonexistent', 3);
    assert.ok(!result.success);
    assert.equal(result.error, 'Invalid invite code');
  });

  it('已是成员不能重复加入', () => {
    const code = teamDb.createInvite(teamId, 1, null, 0);
    const result = teamDb.useInvite(code, 2); // bob already joined
    assert.ok(!result.success);
    assert.equal(result.error, 'Already a team member');
  });

  it('限次邀请码用尽后失效', () => {
    const code = teamDb.createInvite(teamId, 1, null, 1); // max 1 use
    const result1 = teamDb.useInvite(code, 3); // charlie joins
    assert.ok(result1.success);

    // Create a 4th user for this test
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', 'hash4');
    const result2 = teamDb.useInvite(code, 4); // dave tries
    assert.ok(!result2.success);
    assert.equal(result2.error, 'Invite has been used up');
  });

  it('过期邀请码失效', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
    const code = teamDb.createInvite(teamId, 1, pastDate, 0);

    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('eve', 'hash5');
    const result = teamDb.useInvite(code, 5);
    assert.ok(!result.success);
    assert.equal(result.error, 'Invite expired');
  });

  it('获取团队邀请列表', () => {
    const invites = teamDb.getInvites(teamId);
    assert.ok(invites.length >= 3);
  });

  it('删除邀请', () => {
    const invites = teamDb.getInvites(teamId);
    const inviteToDelete = invites[0];
    const deleted = teamDb.deleteInvite(inviteToDelete.id, teamId);
    assert.ok(deleted);

    const remaining = teamDb.getInvites(teamId);
    assert.equal(remaining.length, invites.length - 1);
  });
});

describe('teamDb - 项目关联', () => {
  let teamId;

  before(() => {
    setupTestDb();
    const team = teamDb.createTeam('Project Test', null, 1);
    teamId = team.id;
  });
  after(() => db.close());

  it('关联项目到团队', () => {
    const added = teamDb.addProject(teamId, '/path/to/project', 1);
    assert.ok(added);
  });

  it('不能重复关联同一项目', () => {
    const added = teamDb.addProject(teamId, '/path/to/project', 1);
    assert.ok(!added);
  });

  it('获取团队项目列表', () => {
    teamDb.addProject(teamId, '/path/to/project2', 1);
    const projects = teamDb.getProjects(teamId);
    assert.equal(projects.length, 2);
  });

  it('通过项目路径反查团队', () => {
    const teams = teamDb.getTeamsForProject('/path/to/project');
    assert.equal(teams.length, 1);
    assert.equal(teams[0].id, teamId);
  });

  it('移除项目关联', () => {
    const removed = teamDb.removeProject(teamId, '/path/to/project');
    assert.ok(removed);

    const projects = teamDb.getProjects(teamId);
    assert.equal(projects.length, 1);
  });
});

describe('activityDb - 活动日志', () => {
  let teamId;

  before(() => {
    setupTestDb();
    const team = teamDb.createTeam('Activity Test', null, 1);
    teamId = team.id;
  });
  after(() => db.close());

  it('记录活动日志', () => {
    activityDb.log(teamId, 1, 'story_claimed', 'story', '1-2-auth', '{"branch": "story/1-2-auth"}');
    activityDb.log(teamId, 1, 'commit', 'story', '1-2-auth', '{"message": "feat: add auth"}');
    activityDb.log(teamId, 1, 'status_changed', 'story', '1-2-auth', '{"from": "in-progress", "to": "review"}');
  });

  it('查询团队活动日志', () => {
    const activities = activityDb.getForTeam(teamId);
    assert.equal(activities.length, 3);
    // All activities belong to alice
    assert.ok(activities.every(a => a.username === 'alice'));
    // All three action types should be present
    const types = activities.map(a => a.action_type).sort();
    assert.deepEqual(types, ['commit', 'status_changed', 'story_claimed']);
  });

  it('支持分页', () => {
    const page1 = activityDb.getForTeam(teamId, 2, 0);
    assert.equal(page1.length, 2);

    const page2 = activityDb.getForTeam(teamId, 2, 2);
    assert.equal(page2.length, 1);
  });
});

describe('notificationsDb - 通知系统', () => {
  let teamId;

  before(() => {
    setupTestDb();
    const team = teamDb.createTeam('Notification Test', null, 1);
    teamId = team.id;
  });
  after(() => db.close());

  it('创建通知', () => {
    const n1 = notificationsDb.create(2, teamId, 'assigned_review', 'Review requested', 'Please review PR #42', '/pr/42');
    const n2 = notificationsDb.create(2, teamId, 'story_claimed', 'Story claimed by alice', null, null);
    const n3 = notificationsDb.create(2, teamId, 'mention', '@bob mentioned you', 'in a comment', null);

    assert.ok(n1.id > 0);
    assert.ok(n2.id > 0);
    assert.ok(n3.id > 0);
  });

  it('获取用户通知', () => {
    const notifications = notificationsDb.getForUser(2);
    assert.equal(notifications.length, 3);
    // All three types should be present
    const types = notifications.map(n => n.type).sort();
    assert.deepEqual(types, ['assigned_review', 'mention', 'story_claimed']);
    // All should have correct team name
    assert.ok(notifications.every(n => n.team_name === 'Notification Test'));
  });

  it('未读计数', () => {
    const count = notificationsDb.getUnreadCount(2);
    assert.equal(count, 3);
  });

  it('标记单条已读', () => {
    const notifications = notificationsDb.getForUser(2);
    const success = notificationsDb.markAsRead(notifications[0].id, 2);
    assert.ok(success);

    const count = notificationsDb.getUnreadCount(2);
    assert.equal(count, 2);
  });

  it('仅获取未读通知', () => {
    const unread = notificationsDb.getForUser(2, 50, 0, true);
    assert.equal(unread.length, 2);
  });

  it('全部标记已读', () => {
    const changed = notificationsDb.markAllAsRead(2);
    assert.ok(changed >= 2);
    assert.equal(notificationsDb.getUnreadCount(2), 0);
  });

  it('按团队标记已读', () => {
    notificationsDb.create(2, teamId, 'test1', 'T1');
    notificationsDb.create(2, null, 'test2', 'T2'); // no team

    const changed = notificationsDb.markAllAsRead(2, teamId);
    assert.ok(changed >= 1);

    // The one without team should still be unread
    const unread = notificationsDb.getForUser(2, 50, 0, true);
    assert.ok(unread.some(n => n.type === 'test2'));
  });
});
