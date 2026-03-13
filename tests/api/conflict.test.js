import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestUser, createTestUser2, createTestTeam, kanbanDb, teamDb } from '../setup.js';

let app, token1, token2, teamId, sprintId, user1, user2;

beforeAll(async () => {
  app = await createTestApp();
  const u1 = createTestUser('conflictuser1');
  user1 = u1.user; token1 = u1.token;
  const u2 = createTestUser2('conflictuser2');
  user2 = u2.user; token2 = u2.token;
  const team = createTestTeam(user1.id, 'Conflict Team');
  teamId = team.id;
  teamDb.addMember(teamId, user2.id, 'developer');

  // Create sprint and stories with overlapping file scopes
  const sprint = kanbanDb.createSprint(teamId, 'Sprint', null, null, null, user1.id);
  sprintId = sprint.id;
  kanbanDb.activateSprint(sprintId, teamId);
  const s1 = kanbanDb.createStory(teamId, sprintId, 'Story A', null, ['src/services/', 'src/app.js'], 'high', user1.id);
  const s2 = kanbanDb.createStory(teamId, sprintId, 'Story B', null, ['src/services/auth.js', 'src/utils.js'], 'medium', user2.id);
  kanbanDb.assignStory(s1.id, teamId, user1.id);
  kanbanDb.assignStory(s2.id, teamId, user2.id);
});

describe('Conflict API', () => {
  let conflictId;

  describe('POST /:teamId/conflicts/scan', () => {
    it('should scan and detect file scope overlaps', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/conflicts/scan`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ sprintId });
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBeGreaterThan(0);
      conflictId = res.body.data.created[0].id;
    });

    it('should not duplicate on re-scan', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/conflicts/scan`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ sprintId });
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(0);
    });
  });

  describe('GET /:teamId/conflicts', () => {
    it('should list conflicts with stats', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/conflicts`)
        .set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      expect(res.body.data.conflicts.length).toBeGreaterThan(0);
      expect(res.body.data.stats).toHaveProperty('open_count');
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/conflicts?status=open`)
        .set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      res.body.data.conflicts.forEach(c => expect(c.status).toBe('open'));
    });
  });

  describe('GET /:teamId/conflicts/:conflictId', () => {
    it('should return conflict detail with stories', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/conflicts/${conflictId}`)
        .set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      expect(res.body.data.conflict).toHaveProperty('id', conflictId);
      expect(res.body.data.stories.length).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent conflict', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/conflicts/99999`)
        .set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:teamId/conflicts/:conflictId/assign', () => {
    it('should assign conflict to a member', async () => {
      const res = await request(app)
        .put(`/api/teams/${teamId}/conflicts/${conflictId}/assign`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ userId: user1.id });
      expect(res.status).toBe(200);
      expect(res.body.data.conflict.status).toBe('in_progress');
      expect(res.body.data.conflict.assigned_to).toBe(user1.id);
    });
  });

  describe('PUT /:teamId/conflicts/:conflictId/resolve', () => {
    it('should resolve conflict with note', async () => {
      const res = await request(app)
        .put(`/api/teams/${teamId}/conflicts/${conflictId}/resolve`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ resolutionNote: 'Merged manually' });
      expect(res.status).toBe(200);
      expect(res.body.data.conflict.status).toBe('resolved');
      expect(res.body.data.conflict.resolution_note).toBe('Merged manually');
    });
  });

  describe('PUT /:teamId/conflicts/:conflictId/confirm', () => {
    it('should confirm resolution', async () => {
      const res = await request(app)
        .put(`/api/teams/${teamId}/conflicts/${conflictId}/confirm`)
        .set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      expect(res.body.data.conflict.status).toBe('confirmed');
    });
  });

  describe('POST /:teamId/conflicts/realtime', () => {
    it('should report realtime conflict', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/conflicts/realtime`)
        .set('Authorization', `Bearer ${token1}`)
        .send({
          filePath: 'src/index.js',
          memberIds: [user1.id, user2.id],
          storyIds: [],
          level: 'orange',
          type: 'same_file',
        });
      expect(res.status).toBe(201);
      expect(res.body.data.conflict.level).toBe('orange');
    });

    it('should reject if less than 2 members', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/conflicts/realtime`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ filePath: 'x.js', memberIds: [user1.id] });
      expect(res.status).toBe(400);
    });
  });
});
