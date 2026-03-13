import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestUser, createTestUser2 } from '../setup.js';

let app, user1, token1, user2, token2;

beforeAll(async () => {
  app = await createTestApp();
  const u1 = createTestUser('teamuser1');
  user1 = u1.user; token1 = u1.token;
  const u2 = createTestUser2('teamuser2');
  user2 = u2.user; token2 = u2.token;
});

describe('Team API', () => {
  let teamId;

  describe('POST /api/team', () => {
    it('should create a team', async () => {
      const res = await request(app)
        .post('/api/team')
        .set('Authorization', `Bearer ${token1}`)
        .send({ name: 'My Team', description: 'A test team' });
      expect(res.status).toBe(201);
      expect(res.body.data.team).toHaveProperty('name', 'My Team');
      teamId = res.body.data.team.id;
    });

    it('should reject empty team name', async () => {
      const res = await request(app)
        .post('/api/team')
        .set('Authorization', `Bearer ${token1}`)
        .send({ name: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/team', () => {
    it('should return user teams', async () => {
      const res = await request(app)
        .get('/api/team')
        .set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/team/:teamId', () => {
    it('should return team info', async () => {
      const res = await request(app)
        .get(`/api/team/${teamId}`)
        .set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', teamId);
    });
  });

  describe('GET /api/team/:teamId/members', () => {
    it('should return team members', async () => {
      const res = await request(app)
        .get(`/api/team/${teamId}/members`)
        .set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/team/:teamId/invites', () => {
    it('should create an invite', async () => {
      const res = await request(app)
        .post(`/api/team/${teamId}/invites`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ expiresInHours: 24 });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('inviteCode');
    });
  });

  describe('PUT /api/team/:teamId', () => {
    it('should update team settings', async () => {
      const res = await request(app)
        .put(`/api/team/${teamId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ name: 'Updated Team', description: 'Updated' });
      expect(res.status).toBe(200);
    });
  });

  describe('Notifications', () => {
    it('GET /api/team/notifications/list should return notifications', async () => {
      const res = await request(app)
        .get('/api/team/notifications/list')
        .set('Authorization', `Bearer ${token1}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('notifications');
    });
  });
});
