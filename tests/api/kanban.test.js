import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestUser, createTestTeam } from '../setup.js';

let app, token, teamId;

beforeAll(async () => {
  app = await createTestApp();
  const u = createTestUser('kanbanuser');
  token = u.token;
  const team = createTestTeam(u.user.id, 'Kanban Team');
  teamId = team.id;
});

describe('Kanban API', () => {
  let sprintId, storyId;

  // Sprint CRUD
  describe('Sprint endpoints', () => {
    it('POST /:teamId/sprints should create sprint', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/sprints`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Sprint 1', description: 'First sprint' });
      expect(res.status).toBe(201);
      expect(res.body.data.sprint).toHaveProperty('name', 'Sprint 1');
      sprintId = res.body.data.sprint.id;
    });

    it('GET /:teamId/sprints should list sprints', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/sprints`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.sprints.length).toBeGreaterThan(0);
    });

    it('POST /:teamId/sprints/:sprintId/activate should activate sprint', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/sprints/${sprintId}/activate`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.sprint.status).toBe('active');
    });

    it('GET /:teamId/sprints/active should return active sprint', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/sprints/active`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.sprint).not.toBeNull();
    });
  });

  // Story CRUD
  describe('Story endpoints', () => {
    it('POST should create story', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/sprints/${sprintId}/stories`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Test Story', description: 'Desc', priority: 'high', fileScope: ['src/app.js'] });
      expect(res.status).toBe(201);
      expect(res.body.data.story).toHaveProperty('title', 'Test Story');
      storyId = res.body.data.story.id;
    });

    it('GET should list stories', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/sprints/${sprintId}/stories`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.stories.length).toBe(1);
    });

    it('GET /:storyId should return story detail', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/stories/${storyId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.story.id).toBe(storyId);
    });

    it('PUT /:storyId should update story', async () => {
      const res = await request(app)
        .put(`/api/teams/${teamId}/stories/${storyId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Story', priority: 'critical' });
      expect(res.status).toBe(200);
      expect(res.body.data.story.title).toBe('Updated Story');
    });

    it('PUT /:storyId/status should update status (drag)', async () => {
      const res = await request(app)
        .put(`/api/teams/${teamId}/stories/${storyId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'in_progress', position: 0 });
      expect(res.status).toBe(200);
      expect(res.body.data.story.status).toBe('in_progress');
    });

    it('PUT /:storyId/assign should assign story', async () => {
      const res = await request(app)
        .put(`/api/teams/${teamId}/stories/${storyId}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: null });
      expect(res.status).toBe(200);
    });

    it('PUT /reorder should reorder stories', async () => {
      const res = await request(app)
        .put(`/api/teams/${teamId}/stories/reorder`)
        .set('Authorization', `Bearer ${token}`)
        .send({ storyIds: [storyId], status: 'in_progress' });
      expect(res.status).toBe(200);
    });

    it('should reject invalid status', async () => {
      const res = await request(app)
        .put(`/api/teams/${teamId}/stories/${storyId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'invalid' });
      expect(res.status).toBe(400);
    });
  });

  // Work scope
  describe('Work scope', () => {
    it('GET /:teamId/work-scope should return work scope', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/work-scope?sprintId=${sprintId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('members');
      expect(res.body.data).toHaveProperty('overlaps');
    });
  });

  // Sprint complete
  describe('Sprint lifecycle', () => {
    it('POST complete should complete active sprint', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/sprints/${sprintId}/complete`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });

  // Story delete
  describe('Story delete', () => {
    it('DELETE /:storyId should delete story', async () => {
      // Create new story first
      const createRes = await request(app)
        .post(`/api/teams/${teamId}/sprints/${sprintId}/stories`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'To Delete' });
      const delId = createRes.body.data.story.id;

      const res = await request(app)
        .delete(`/api/teams/${teamId}/stories/${delId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });

  // Auth guard
  describe('Auth guard', () => {
    it('should reject unauthorized requests', async () => {
      const res = await request(app).get(`/api/teams/${teamId}/sprints`);
      expect(res.status).toBe(401);
    });
  });
});
