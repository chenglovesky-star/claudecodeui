import express from 'express';
import { conflictDb, kanbanDb, teamDb, notificationsDb } from '../database/db.js';
import { broadcastToTeam } from '../utils/team-websocket.js';

const router = express.Router();

function getConnectedClients(req) {
  return req.app.locals.connectedClients;
}

function broadcastConflictEvent(req, teamId, eventType, payload) {
  const clients = getConnectedClients(req);
  if (!clients) return;
  broadcastToTeam(clients, teamId, { type: eventType, teamId, ...payload });
}

// Detect and create conflicts from file scope overlaps
function detectFileScopeConflicts(teamId, sprintId) {
  const overlaps = kanbanDb.findFileScopeOverlaps(teamId, sprintId);
  const created = [];
  for (const overlap of overlaps) {
    const existing = conflictDb.findExisting(teamId, overlap.storyIds, overlap.files);
    if (!existing) {
      const conflict = conflictDb.create(
        teamId, sprintId, 'yellow', 'file_overlap',
        overlap.storyIds, overlap.members, overlap.files,
        `Story "${overlap.storyTitles[0]}" 与 "${overlap.storyTitles[1]}" 存在文件范围重叠: ${overlap.files.join(', ')}`
      );
      created.push(conflict);
    }
  }
  return created;
}

// Scan for conflicts in a sprint
router.post('/:teamId/conflicts/scan', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const { sprintId } = req.body;
    if (!sprintId) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '需要 sprintId' } });
    }
    const created = detectFileScopeConflicts(teamId, sprintId);
    // Notify involved members
    for (const conflict of created) {
      const memberIds = JSON.parse(conflict.member_ids || '[]');
      for (const memberId of memberIds) {
        notificationsDb.create(memberId, teamId, 'conflict_detected',
          `检测到文件范围冲突: ${conflict.description}`, null, null);
      }
      broadcastConflictEvent(req, teamId, 'conflict:detected', { conflict });
    }
    res.json({ data: { created, total: created.length } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get conflicts for a team
router.get('/:teamId/conflicts', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.sprintId) filters.sprintId = parseInt(req.query.sprintId);
    if (req.query.level) filters.level = req.query.level;
    const conflicts = conflictDb.getByTeam(teamId, filters);
    const stats = conflictDb.getStats(teamId);
    res.json({ data: { conflicts, stats } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get conflict detail
router.get('/:teamId/conflicts/:conflictId', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const conflictId = parseInt(req.params.conflictId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const conflict = conflictDb.getById(conflictId, teamId);
    if (!conflict) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '冲突未找到' } });

    // Enrich with story and member details
    const storyIds = JSON.parse(conflict.story_ids || '[]');
    const stories = storyIds.map(id => kanbanDb.getStoryById(teamId, id)).filter(Boolean);
    res.json({ data: { conflict, stories } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Assign conflict to a member
router.put('/:teamId/conflicts/:conflictId/assign', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const conflictId = parseInt(req.params.conflictId);
    const { userId } = req.body;
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    if (!teamDb.isMember(teamId, userId)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '被指派用户不是团队成员' } });
    }
    const conflict = conflictDb.assign(conflictId, teamId, userId);
    if (!conflict) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '冲突未找到' } });

    if (userId !== req.user.id) {
      notificationsDb.create(userId, teamId, 'conflict_assigned',
        `你被指派处理冲突: ${conflict.description}`, null, null);
    }
    broadcastConflictEvent(req, teamId, 'conflict:assigned', { conflict });
    res.json({ data: { conflict } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Resolve conflict
router.put('/:teamId/conflicts/:conflictId/resolve', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const conflictId = parseInt(req.params.conflictId);
    const { resolutionNote } = req.body;
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const conflict = conflictDb.resolve(conflictId, teamId, req.user.id, resolutionNote);
    if (!conflict) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '冲突未找到' } });

    // Notify involved members
    const memberIds = JSON.parse(conflict.member_ids || '[]');
    for (const memberId of memberIds) {
      if (memberId !== req.user.id) {
        notificationsDb.create(memberId, teamId, 'conflict_resolved',
          `冲突已解决: ${conflict.description}`, null, null);
      }
    }
    broadcastConflictEvent(req, teamId, 'conflict:resolved', { conflict });
    res.json({ data: { conflict } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Confirm conflict resolution
router.put('/:teamId/conflicts/:conflictId/confirm', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const conflictId = parseInt(req.params.conflictId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const conflict = conflictDb.confirm(conflictId, teamId);
    if (!conflict) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '冲突未找到' } });
    broadcastConflictEvent(req, teamId, 'conflict:confirmed', { conflict });
    res.json({ data: { conflict } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Report realtime file conflict (from file tracking)
router.post('/:teamId/conflicts/realtime', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const { filePath, memberIds, storyIds, level, type } = req.body;
    if (!filePath || !memberIds || memberIds.length < 2) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '参数不完整' } });
    }
    // Check for existing open conflict on same file/members
    const existing = conflictDb.findExisting(teamId, storyIds || [], [filePath]);
    if (existing) {
      // Upgrade level if needed
      const levelOrder = { yellow: 0, orange: 1, red: 2 };
      if (levelOrder[level] > levelOrder[existing.level]) {
        const updated = conflictDb.updateLevel(existing.id, teamId, level);
        broadcastConflictEvent(req, teamId, 'conflict:updated', { conflict: updated });
        return res.json({ data: { conflict: updated, upgraded: true } });
      }
      return res.json({ data: { conflict: existing, existing: true } });
    }

    const description = type === 'same_region'
      ? `多人同时修改文件同一区域: ${filePath}`
      : `多人同时修改同一文件: ${filePath}`;
    const conflict = conflictDb.create(
      teamId, null, level || 'orange', type || 'same_file',
      storyIds || [], memberIds, [filePath], description
    );

    for (const memberId of memberIds) {
      notificationsDb.create(memberId, teamId, 'conflict_realtime',
        description, null, null);
    }
    broadcastConflictEvent(req, teamId, 'conflict:detected', { conflict });
    res.status(201).json({ data: { conflict } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

export default router;
