import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../setup.js';

let app;

beforeAll(async () => {
  app = await createTestApp();
});

describe('Auth API', () => {
  const testUser = { email: 'authuser@test.com', password: 'AuthPass123!', username: 'authuser' };

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app).post('/api/auth/register').send(testUser);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.user).toHaveProperty('username');
    });

    it('should reject duplicate email', async () => {
      const res = await request(app).post('/api/auth/register').send(testUser);
      expect(res.status).toBe(409);
    });

    it('should reject missing email', async () => {
      const res = await request(app).post('/api/auth/register').send({ password: 'Test123!' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: testUser.email, password: testUser.password });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('token');
    });

    it('should reject wrong password', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: testUser.email, password: 'wrong' });
      expect(res.status).toBe(401);
    });

    it('should reject non-existent user', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'nope' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/status', () => {
    it('should return auth status', async () => {
      const res = await request(app).get('/api/auth/status');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/auth/user (protected)', () => {
    it('should reject without token', async () => {
      const res = await request(app).get('/api/auth/user');
      expect(res.status).toBe(401);
    });

    it('should return user with valid token', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({ email: testUser.email, password: testUser.password });
      const token = loginRes.body.data.token;
      const res = await request(app).get('/api/auth/user').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user).toHaveProperty('username');
    });
  });
});
