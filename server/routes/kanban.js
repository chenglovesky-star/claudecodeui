import express from 'express';
import { kanbanDb, teamDb, notificationsDb } from '../database/db.js';
import { broadcastToTeam } from '../utils/team-websocket.js';

const router = express.Router();

function getConnectedClients(req) {
  return req.app.locals.connectedClients;
}

// Helper: broadcast kanban event via WebSocket
function broadcastKanbanEvent(req, teamId, eventType, payload) {
  const clients = getConnectedClients(req);
  if (!clients) return;
  broadcastToTeam(clients, teamId, { type: eventType, teamId, ...payload });
}

// ========== Sprint endpoints ==========

// Create Sprint
router.post('/:teamId/sprints', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const { name, description, startDate, endDate } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Sprint 名称不能为空' } });
    }

    // Check active sprint
    const activeSprint = kanbanDb.getActiveSprint(teamId);
    if (activeSprint) {
      return res.status(200).json({ data: { hasActiveSprint: true, activeSprint } });
    }

    const sprint = kanbanDb.createSprint(teamId, name.trim(), description, startDate, endDate, req.user.id);
    res.status(201).json({ data: { sprint } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get all sprints
router.get('/:teamId/sprints', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const sprints = kanbanDb.getSprints(teamId, limit, offset);
    res.json({ data: { sprints } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get active sprint
router.get('/:teamId/sprints/active', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const sprint = kanbanDb.getActiveSprint(teamId);
    res.json({ data: { sprint } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Activate Sprint
router.post('/:teamId/sprints/:sprintId/activate', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const sprintId = parseInt(req.params.sprintId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const sprint = kanbanDb.activateSprint(sprintId, teamId);
    if (!sprint) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sprint 未找到' } });
    broadcastKanbanEvent(req, teamId, 'kanban:sprint-activated', { sprint });
    res.json({ data: { sprint } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Update Sprint
router.put('/:teamId/sprints/:sprintId', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const sprintId = parseInt(req.params.sprintId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const success = kanbanDb.updateSprint(sprintId, teamId, req.body);
    if (!success) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sprint 未找到或无更新' } });
    const sprint = kanbanDb.getSprintById(teamId, sprintId);
    res.json({ data: { sprint } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Complete Sprint
router.post('/:teamId/sprints/:sprintId/complete', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const sprintId = parseInt(req.params.sprintId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const success = kanbanDb.completeSprint(sprintId, teamId);
    if (!success) return res.status(400).json({ error: { code: 'INVALID_STATE', message: '该 Sprint 不是活跃状态' } });
    broadcastKanbanEvent(req, teamId, 'kanban:sprint-completed', { sprintId });
    res.json({ data: { success: true } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// ========== Story endpoints ==========

// Create Story
router.post('/:teamId/sprints/:sprintId/stories', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const sprintId = parseInt(req.params.sprintId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const { title, description, fileScope, priority } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Story 标题不能为空' } });
    }
    // Validate file_scope format
    if (fileScope && !Array.isArray(fileScope)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'fileScope 必须为数组' } });
    }
    if (fileScope && !fileScope.every(f => typeof f === 'string')) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'fileScope 每个元素必须为字符串路径' } });
    }
    const story = kanbanDb.createStory(teamId, sprintId, title.trim(), description, fileScope, priority, req.user.id);
    broadcastKanbanEvent(req, teamId, 'kanban:story-created', { story });
    res.status(201).json({ data: { story } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get stories by sprint
router.get('/:teamId/sprints/:sprintId/stories', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const sprintId = parseInt(req.params.sprintId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const stories = kanbanDb.getStoriesBySprint(teamId, sprintId);
    res.json({ data: { stories } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Reorder stories (must be before /:storyId routes to avoid param capture)
router.put('/:teamId/stories/reorder', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const { storyIds, status } = req.body;
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    if (!Array.isArray(storyIds) || !status) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '参数错误' } });
    }
    kanbanDb.reorderStories(teamId, storyIds, status);
    broadcastKanbanEvent(req, teamId, 'kanban:reorder', { storyIds, status });
    res.json({ data: { success: true } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get story detail
router.get('/:teamId/stories/:storyId', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const storyId = parseInt(req.params.storyId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const story = kanbanDb.getStoryById(teamId, storyId);
    if (!story) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Story 未找到' } });
    res.json({ data: { story } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Update story
router.put('/:teamId/stories/:storyId', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const storyId = parseInt(req.params.storyId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const story = kanbanDb.updateStory(storyId, teamId, req.body);
    if (!story) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Story 未找到' } });
    broadcastKanbanEvent(req, teamId, 'kanban:story-updated', { story });
    res.json({ data: { story } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Delete story
router.delete('/:teamId/stories/:storyId', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const storyId = parseInt(req.params.storyId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const success = kanbanDb.deleteStory(storyId, teamId);
    if (!success) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Story 未找到' } });
    broadcastKanbanEvent(req, teamId, 'kanban:story-deleted', { storyId });
    res.json({ data: { success: true } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Assign story
router.put('/:teamId/stories/:storyId/assign', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const storyId = parseInt(req.params.storyId);
    const { userId } = req.body;
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    if (userId !== null && !teamDb.isMember(teamId, userId)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '被分配用户不是团队成员' } });
    }
    const story = kanbanDb.assignStory(storyId, teamId, userId);
    if (!story) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Story 未找到' } });

    // Send notification to assigned user
    if (userId && userId !== req.user.id) {
      notificationsDb.create(userId, teamId, 'story_assigned', `你被分配了 Story: ${story.title}`, null, null);
    }

    broadcastKanbanEvent(req, teamId, 'kanban:assign', { story, assignedBy: req.user.id });
    res.json({ data: { story } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Update story status (for drag & drop)
router.put('/:teamId/stories/:storyId/status', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const storyId = parseInt(req.params.storyId);
    const { status, position } = req.body;
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    if (!['todo', 'in_progress', 'done'].includes(status)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的状态值' } });
    }
    const oldStory = kanbanDb.getStoryById(teamId, storyId);
    if (!oldStory) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Story 未找到' } });
    const story = kanbanDb.updateStoryStatus(storyId, teamId, status, position);
    broadcastKanbanEvent(req, teamId, 'kanban:move', { story, oldStatus: oldStory.status, newStatus: status, movedBy: req.user.id });
    res.json({ data: { story } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get member work scope
router.get('/:teamId/work-scope', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const rawData = kanbanDb.getMemberWorkScope(teamId);

    // Group by member
    const memberMap = new Map();
    for (const row of rawData) {
      if (!memberMap.has(row.user_id)) {
        memberMap.set(row.user_id, {
          userId: row.user_id,
          username: row.username,
          nickname: row.nickname,
          avatarUrl: row.avatar_url,
          stories: []
        });
      }
      memberMap.get(row.user_id).stories.push({
        storyId: row.story_id,
        title: row.title,
        status: row.status,
        fileScope: JSON.parse(row.file_scope || '[]'),
        priority: row.priority
      });
    }

    const members = Array.from(memberMap.values()).map(m => ({
      ...m,
      totalFiles: m.stories.reduce((sum, s) => sum + s.fileScope.length, 0)
    }));

    // Calculate overlaps if sprintId provided
    const sprintId = req.query.sprintId ? parseInt(req.query.sprintId) : null;
    const overlaps = sprintId ? kanbanDb.findFileScopeOverlaps(teamId, sprintId) : [];

    res.json({ data: { members, overlaps } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

export default router;
