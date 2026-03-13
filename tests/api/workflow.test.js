import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestUser, createTestTeam } from '../setup.js';

let app, token, teamId, userId;

beforeAll(async () => {
  app = await createTestApp();
  const u = createTestUser('workflowuser');
  token = u.token; userId = u.user.id;
  const team = createTestTeam(userId, 'Workflow Team');
  teamId = team.id;
});

describe('Workflow API', () => {
  let workflowId;

  describe('POST /:teamId/workflows', () => {
    it('should create a product_brief workflow', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/workflows`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'product_brief' });
      expect(res.status).toBe(201);
      expect(res.body.data.workflow).toHaveProperty('workflow_type', 'product_brief');
      expect(res.body.data.workflow.status).toBe('active');
      expect(res.body.data.steps.length).toBe(5);
      workflowId = res.body.data.workflow.id;
    });

    it('should reject duplicate active workflow', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/workflows`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'prd' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ACTIVE_EXISTS');
    });

    it('should reject invalid workflow type', async () => {
      // Cancel first so we can test
      await request(app)
        .post(`/api/teams/${teamId}/workflows/${workflowId}/cancel`)
        .set('Authorization', `Bearer ${token}`);
      const res = await request(app)
        .post(`/api/teams/${teamId}/workflows`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'invalid_type' });
      expect(res.status).toBe(400);
    });
  });

  describe('Workflow lifecycle', () => {
    beforeAll(async () => {
      // Create a fresh workflow
      const res = await request(app)
        .post(`/api/teams/${teamId}/workflows`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'prd' });
      workflowId = res.body.data.workflow.id;
    });

    it('GET /:teamId/workflows should list workflows', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/workflows`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.workflows.length).toBeGreaterThan(0);
    });

    it('GET /:teamId/workflows/active should return active workflow', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/workflows/active`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.workflow).not.toBeNull();
    });

    it('GET /:teamId/workflows/:id should return workflow detail', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/workflows/${workflowId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.workflow.id).toBe(workflowId);
      expect(res.body.data.steps.length).toBe(5);
    });
  });

  describe('Workflow messages', () => {
    it('POST messages should send user message and get AI reply', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/workflows/${workflowId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '我们要做一个任务管理工具' });
      expect(res.status).toBe(200);
      expect(res.body.data.userMessage).toHaveProperty('role', 'user');
      expect(res.body.data.aiReply).toHaveProperty('role', 'assistant');
    });

    it('POST messages with "next" choice should advance step', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/workflows/${workflowId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'next', type: 'choice' });
      expect(res.status).toBe(200);
      expect(res.body.data.aiReply.content).toContain('下一步');
    });

    it('GET messages should return message history', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/workflows/${workflowId}/messages`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.messages.length).toBeGreaterThan(0);
    });

    it('should reject empty message', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/workflows/${workflowId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('Workflow cancel', () => {
    it('POST cancel should cancel workflow', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/workflows/${workflowId}/cancel`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
    });

    it('should not cancel already cancelled workflow', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/workflows/${workflowId}/cancel`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Workflow complete + documents', () => {
    let completeWfId;

    it('should complete workflow by advancing all steps', async () => {
      // Create new workflow
      const createRes = await request(app)
        .post(`/api/teams/${teamId}/workflows`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'architecture' });
      completeWfId = createRes.body.data.workflow.id;
      const steps = createRes.body.data.steps;

      // Advance through all steps
      for (let i = 0; i < steps.length; i++) {
        // Send some content for each step
        await request(app)
          .post(`/api/teams/${teamId}/workflows/${completeWfId}/messages`)
          .set('Authorization', `Bearer ${token}`)
          .send({ content: `Step ${i} content` });

        // Advance
        await request(app)
          .post(`/api/teams/${teamId}/workflows/${completeWfId}/messages`)
          .set('Authorization', `Bearer ${token}`)
          .send({ content: 'next', type: 'choice' });
      }
    });

    it('GET /:teamId/documents should list completed documents', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/documents`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.documents.length).toBeGreaterThan(0);
    });

    it('GET /:teamId/documents/:workflowId should return document content', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/documents/${completeWfId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.document).toHaveProperty('content');
      expect(res.body.data.document.content.length).toBeGreaterThan(0);
    });
  });

  describe('Auth guard', () => {
    it('should reject without token', async () => {
      const res = await request(app).get(`/api/teams/${teamId}/workflows`);
      expect(res.status).toBe(401);
    });
  });
});
