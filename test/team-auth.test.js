/**
 * 团队认证中间件单元测试
 *
 * 测试 checkTeamRole 中间件的权限控制逻辑。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline checkTeamRole logic (same as auth.js) ──

const checkTeamRole = (requiredRoles) => {
  return (req, res, next) => {
    const teamId = parseInt(req.params?.teamId || req.body?.teamId);
    if (!teamId || isNaN(teamId)) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    const userRole = req.teamRoles?.[teamId];
    if (!userRole) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(userRole)) {
      return res.status(403).json({ error: `Requires one of roles: ${requiredRoles.join(', ')}` });
    }

    req.currentTeamRole = userRole;
    next();
  };
};

// ── Mock Express req/res/next ──

function createMocks(teamId, teamRoles, paramsOrBody = 'params') {
  const req = {
    params: paramsOrBody === 'params' ? { teamId: String(teamId) } : {},
    body: paramsOrBody === 'body' ? { teamId } : {},
    teamRoles: teamRoles || {}
  };

  let statusCode = null;
  let jsonBody = null;
  let nextCalled = false;

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (body) => {
      jsonBody = body;
    }
  };

  const next = () => { nextCalled = true; };

  return { req, res, next, getStatus: () => statusCode, getJson: () => jsonBody, wasNextCalled: () => nextCalled };
}

// =============================================
// Tests
// =============================================

describe('checkTeamRole - 权限中间件', () => {
  it('PM 角色通过 PM/SM 权限检查', () => {
    const { req, res, next, wasNextCalled } = createMocks(10, { 10: 'pm' });
    checkTeamRole(['pm', 'sm'])(req, res, next);
    assert.ok(wasNextCalled());
    assert.equal(req.currentTeamRole, 'pm');
  });

  it('Developer 角色不能通过 PM/SM 权限检查', () => {
    const { req, res, next, getStatus, getJson, wasNextCalled } = createMocks(10, { 10: 'developer' });
    checkTeamRole(['pm', 'sm'])(req, res, next);
    assert.ok(!wasNextCalled());
    assert.equal(getStatus(), 403);
    assert.ok(getJson().error.includes('Requires one of roles'));
  });

  it('非团队成员返回 403', () => {
    const { req, res, next, getStatus, wasNextCalled } = createMocks(10, { 20: 'pm' }); // member of team 20, not 10
    checkTeamRole(['pm'])(req, res, next);
    assert.ok(!wasNextCalled());
    assert.equal(getStatus(), 403);
  });

  it('空 requiredRoles 只检查是否为成员', () => {
    const { req, res, next, wasNextCalled } = createMocks(10, { 10: 'ux' });
    checkTeamRole([])(req, res, next);
    assert.ok(wasNextCalled());
  });

  it('无 teamId 返回 400', () => {
    const req = { params: {}, body: {}, teamRoles: {} };
    const { res, next, getStatus, wasNextCalled } = createMocks(null, {});
    // Override req
    checkTeamRole(['pm'])({ params: {}, body: {}, teamRoles: {} }, res, next);
    assert.ok(!wasNextCalled());
    assert.equal(getStatus(), 400);
  });

  it('从 body 中读取 teamId', () => {
    const { req, res, next, wasNextCalled } = createMocks(10, { 10: 'sm' }, 'body');
    checkTeamRole(['sm'])(req, res, next);
    assert.ok(wasNextCalled());
  });

  it('所有 BMAD 角色都能作为有效角色通过', () => {
    const roles = ['pm', 'architect', 'developer', 'sm', 'qa', 'ux', 'analyst'];
    for (const role of roles) {
      const { req, res, next, wasNextCalled } = createMocks(10, { 10: role });
      checkTeamRole([role])(req, res, next);
      assert.ok(wasNextCalled(), `Role '${role}' should pass when it's in required list`);
    }
  });

  it('null teamRoles 返回 403', () => {
    const req = { params: { teamId: '10' }, body: {}, teamRoles: null };
    let statusCode = null;
    let nextCalled = false;
    const res = { status: (c) => { statusCode = c; return res; }, json: () => {} };
    checkTeamRole(['pm'])(req, res, () => { nextCalled = true; });
    assert.ok(!nextCalled);
    assert.equal(statusCode, 403);
  });
});
