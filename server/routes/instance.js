/**
 * INSTANCE API ROUTES
 * ===================
 * REST endpoints for team Claude Code session management.
 */

import express from 'express';
import { teamDb } from '../database/db.js';
import ProcessRegistry from '../services/ProcessRegistry.js';
import { validateGitRepo } from '../services/GitService.js';

const router = express.Router();

// Start a new Claude Code session
router.post('/:teamId/instances', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (isNaN(teamId)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的参数' } });
        }

        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const { projectPath } = req.body;
        if (!projectPath) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '项目路径不能为空' } });
        }

        // Validate git repo
        const validation = validateGitRepo(projectPath);
        if (!validation.valid) {
            return res.status(400).json({ error: { code: 'INVALID_PATH', message: validation.error } });
        }

        const registry = ProcessRegistry.getInstance();
        const cols = parseInt(req.body.cols) || 80;
        const rows = parseInt(req.body.rows) || 24;

        const result = registry.createSession(req.user.id, teamId, projectPath, { cols, rows });

        if (result.error) {
            const status = result.error.code === 'SESSION_EXISTS' ? 409 : 429;
            return res.status(status).json({ error: result.error });
        }

        const session = registry.getSession(result.sessionId);
        res.status(201).json({
            data: {
                sessionId: result.sessionId,
                status: session.status,
                projectPath: session.projectPath,
                startedAt: session.startedAt,
            }
        });
    } catch (error) {
        console.error('[Instance] Error creating session:', error);
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Get current user's active session
router.get('/:teamId/instances/mine', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (isNaN(teamId)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的参数' } });
        }

        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const registry = ProcessRegistry.getInstance();
        const session = registry.getUserSession(req.user.id);

        if (!session || session.teamId !== teamId) {
            return res.json({ data: { session: null } });
        }

        res.json({
            data: {
                session: {
                    sessionId: session.sessionId,
                    status: registry.getComputedStatus(session),
                    projectPath: session.projectPath,
                    startedAt: session.startedAt,
                    lastActivity: session.lastActivity,
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Get all team sessions (for collaboration panel)
router.get('/:teamId/instances', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (isNaN(teamId)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的参数' } });
        }

        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const registry = ProcessRegistry.getInstance();
        const members = teamDb.getTeamMembers(teamId);
        const memberMap = new Map(members.map(m => [m.user_id, m]));

        const sessions = registry.getTeamSessions(teamId).map(s => {
            const member = memberMap.get(s.userId);
            return {
                sessionId: s.sessionId,
                userId: s.userId,
                username: member?.username || '',
                nickname: member?.nickname || null,
                status: registry.getComputedStatus(s),
                projectPath: s.projectPath,
                startedAt: s.startedAt,
                lastActivity: s.lastActivity,
            };
        });

        res.json({ data: { sessions } });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Get team instance stats
router.get('/:teamId/instances/stats', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (isNaN(teamId)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的参数' } });
        }

        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const registry = ProcessRegistry.getInstance();
        const stats = registry.getTeamStats(teamId);
        res.json({ data: stats });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Kill a session
router.delete('/:teamId/instances/:sessionId', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const { sessionId } = req.params;

        if (isNaN(teamId)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的参数' } });
        }

        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const registry = ProcessRegistry.getInstance();
        const session = registry.getSession(sessionId);

        if (!session) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: '会话不存在' } });
        }

        // Verify session belongs to the requested team
        if (session.teamId !== teamId) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: '会话不存在' } });
        }

        // Only session owner or PM/SM can kill
        if (session.userId !== req.user.id) {
            const callerRole = teamDb.getMemberRole(teamId, req.user.id);
            if (!callerRole || !['pm', 'sm'].includes(callerRole)) {
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: '无权终止他人会话' } });
            }
        }

        registry.killSession(sessionId);
        res.json({ data: { success: true } });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

export default router;
