/**
 * TEAM API ROUTES
 * ===============
 *
 * REST API endpoints for team management, member operations,
 * invite links, and team-project associations.
 */

import express from 'express';
import { teamDb, activityDb, notificationsDb } from '../database/db.js';
import { broadcastTeamMemberChange, broadcastTeamActivity, broadcastNotification, getOnlineTeamMembers } from '../utils/team-websocket.js';
import { validateGitRepo, getRepoInfo, getBranches, getPullRequests, getFileTree, getCommitLog } from '../services/GitService.js';

const router = express.Router();

// Helper to get connected clients from app.locals (avoids circular import with index.js)
function getConnectedClients(req) {
    return req.app.locals.connectedClients;
}

// Valid BMAD roles
const VALID_ROLES = ['pm', 'architect', 'developer', 'sm', 'qa', 'ux', 'analyst'];

// ==========================================
// Team CRUD
// ==========================================

// Create a new team
router.post('/', (req, res) => {
    try {
        const { name, description, settings } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Team name is required' });
        }
        if (name.trim().length > 100) {
            return res.status(400).json({ error: 'Team name must not exceed 100 characters' });
        }

        const team = teamDb.createTeam(name.trim(), description?.trim() || null, req.user.id, settings ? JSON.stringify(settings) : '{}');

        activityDb.log(team.id, req.user.id, 'team_created', 'team', String(team.id));

        res.status(201).json({ data: { team } });
    } catch (error) {
        console.error('[TEAM] Error creating team:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
    }
});

// Get all teams for current user
router.get('/', (req, res) => {
    try {
        const teams = teamDb.getTeamsForUser(req.user.id);
        res.json(teams);
    } catch (error) {
        console.error('[TEAM] Error fetching teams:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get team by ID
router.get('/:teamId', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: 'Not a team member' });
        }
        const team = teamDb.getTeamById(teamId);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        res.json(team);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update team
router.put('/:teamId', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const role = teamDb.getMemberRole(teamId, req.user.id);
        if (!role || !['pm', 'sm'].includes(role)) {
            return res.status(403).json({ error: 'Only PM or SM can update team settings' });
        }

        const { name, description, settings } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Team name is required' });
        }

        const success = teamDb.updateTeam(teamId, name.trim(), description?.trim() || null, settings ? JSON.stringify(settings) : undefined);
        if (!success) return res.status(404).json({ error: 'Team not found' });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete team
router.delete('/:teamId', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const team = teamDb.getTeamById(teamId);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        if (team.created_by !== req.user.id) {
            return res.status(403).json({ error: 'Only team creator can delete the team' });
        }

        teamDb.deleteTeam(teamId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// Members
// ==========================================

// Get team members (with online status)
router.get('/:teamId/members', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const members = teamDb.getTeamMembers(teamId);
        const clients = getConnectedClients(req);
        const onlineMembers = clients ? getOnlineTeamMembers(clients, teamId) : [];
        const onlineUserIds = new Set(onlineMembers.map(m => m.userId));

        const membersWithStatus = members.map(m => ({
            ...m,
            is_online: onlineUserIds.has(m.user_id)
        }));

        res.json(membersWithStatus);
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Update member role
router.put('/:teamId/members/:userId/role', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const targetUserId = parseInt(req.params.userId);
        const { role } = req.body;

        // Only PM/SM can change roles
        const callerRole = teamDb.getMemberRole(teamId, req.user.id);
        if (!callerRole || !['pm', 'sm'].includes(callerRole)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '仅 PM 或 SM 可以修改角色' } });
        }

        // Cannot change own role
        if (targetUserId === req.user.id) {
            return res.status(400).json({ error: { code: 'SELF_ROLE_CHANGE', message: '不能修改自己的角色' } });
        }

        if (!VALID_ROLES.includes(role)) {
            return res.status(400).json({ error: { code: 'INVALID_ROLE', message: `无效角色，必须是以下之一：${VALID_ROLES.join(', ')}` } });
        }

        // Protect last PM — cannot change the last PM to another role
        const targetCurrentRole = teamDb.getMemberRole(teamId, targetUserId);
        if (targetCurrentRole === 'pm' && role !== 'pm') {
            const pmCount = teamDb.countMembersByRole(teamId, 'pm');
            if (pmCount <= 1) {
                return res.status(400).json({ error: { code: 'LAST_PM', message: '团队必须保留至少一个 PM 角色' } });
            }
        }

        const success = teamDb.updateMemberRole(teamId, targetUserId, role);
        if (!success) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '成员未找到' } });

        const clients = getConnectedClients(req);
        broadcastTeamMemberChange(clients, teamId, 'role-changed', {
            userId: targetUserId,
            newRole: role,
            changedBy: req.user.id
        });

        activityDb.log(teamId, req.user.id, 'role_changed', 'member', String(targetUserId), JSON.stringify({ newRole: role }));

        res.json({ data: { success: true, member: { userId: targetUserId, role } } });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Remove member
router.delete('/:teamId/members/:userId', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const targetUserId = parseInt(req.params.userId);

        // PM/SM can remove anyone; members can remove themselves
        const callerRole = teamDb.getMemberRole(teamId, req.user.id);
        if (targetUserId !== req.user.id && (!callerRole || !['pm', 'sm'].includes(callerRole))) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '仅 PM 或 SM 可以移除其他成员' } });
        }

        // Protect last PM — cannot remove the last PM
        const targetRole = teamDb.getMemberRole(teamId, targetUserId);
        if (targetRole === 'pm') {
            const pmCount = teamDb.countMembersByRole(teamId, 'pm');
            if (pmCount <= 1) {
                return res.status(400).json({ error: { code: 'LAST_PM', message: '不能移除团队最后一个 PM' } });
            }
        }

        const success = teamDb.removeMember(teamId, targetUserId);
        if (!success) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '成员未找到' } });

        const clients = getConnectedClients(req);
        broadcastTeamMemberChange(clients, teamId, 'left', {
            userId: targetUserId,
            removedBy: req.user.id
        });

        activityDb.log(teamId, req.user.id, 'member_removed', 'member', String(targetUserId));

        res.json({ data: { success: true } });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// ==========================================
// Invites
// ==========================================

// Create invite link
router.post('/:teamId/invites', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const callerRole = teamDb.getMemberRole(teamId, req.user.id);
        if (!callerRole || !['pm', 'sm', 'architect'].includes(callerRole)) {
            return res.status(403).json({ error: 'Insufficient permissions to create invites' });
        }

        const { expiresInHours, maxUses } = req.body;
        // Default to 72 hours if not provided
        const effectiveHours = expiresInHours || 72;
        const expiresAt = new Date(Date.now() + effectiveHours * 3600000).toISOString();

        const inviteCode = teamDb.createInvite(teamId, req.user.id, expiresAt, maxUses || 0);

        // Generate full invite URL using request host
        const protocol = req.get('x-forwarded-proto') || req.protocol;
        const host = req.get('x-forwarded-host') || req.get('host');
        const basePath = req.baseUrl.replace('/api/team', '');
        const inviteUrl = `${protocol}://${host}${basePath}/join/${inviteCode}`;

        res.status(201).json({ data: { inviteCode, inviteUrl, expiresAt, maxUses: maxUses || 0 } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Join team via invite code
router.post('/join', (req, res) => {
    try {
        const { inviteCode } = req.body;
        if (!inviteCode) return res.status(400).json({ error: 'Invite code is required' });

        const result = teamDb.useInvite(inviteCode, req.user.id);
        if (!result.success) {
            // If already a member, return team info instead of error
            if (result.error === 'Already a team member') {
                const team = teamDb.getTeamById(result.teamId || 0);
                if (team) {
                    return res.json({ data: { success: true, team, alreadyMember: true } });
                }
            }
            return res.status(400).json({ error: { code: 'JOIN_FAILED', message: result.error } });
        }

        // Broadcast member joined
        const clients = getConnectedClients(req);
        broadcastTeamMemberChange(clients, result.teamId, 'joined', {
            userId: req.user.id,
            username: req.user.username
        });

        activityDb.log(result.teamId, req.user.id, 'member_joined', 'member', String(req.user.id));

        const team = teamDb.getTeamById(result.teamId);
        res.json({ data: { success: true, team } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get invites for a team
router.get('/:teamId/invites', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const callerRole = teamDb.getMemberRole(teamId, req.user.id);
        if (!callerRole || !['pm', 'sm', 'architect'].includes(callerRole)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        const invites = teamDb.getInvites(teamId);
        res.json(invites);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete invite
router.delete('/:teamId/invites/:inviteId', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const inviteId = parseInt(req.params.inviteId);

        const callerRole = teamDb.getMemberRole(teamId, req.user.id);
        if (!callerRole || !['pm', 'sm'].includes(callerRole)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        teamDb.deleteInvite(inviteId, teamId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// Team Projects
// ==========================================

// Add project to team (with Git validation)
router.post('/:teamId/projects', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const { projectPath, name, description } = req.body;

        if (!projectPath) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '仓库路径不能为空' } });
        if (!name) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '项目名称不能为空' } });

        const callerRole = teamDb.getMemberRole(teamId, req.user.id);
        if (!callerRole) return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });

        // Validate Git repository
        const validation = validateGitRepo(projectPath);
        if (!validation.valid) {
            return res.status(400).json({ error: { code: 'INVALID_GIT_REPO', message: validation.error } });
        }

        // Get repo info
        const repoInfo = getRepoInfo(projectPath);

        const success = teamDb.addProject(teamId, projectPath, req.user.id, {
            name,
            description: description || '',
            defaultBranch: repoInfo.currentBranch,
            remoteUrl: repoInfo.remoteUrl || ''
        });

        if (!success) {
            return res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: '该仓库路径已关联到此团队' } });
        }

        activityDb.log(teamId, req.user.id, 'project_added', 'project', projectPath);

        // Return the created project
        const projects = teamDb.getProjects(teamId);
        const project = projects.find(p => p.project_path === projectPath);
        res.status(201).json({ data: { project } });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Get team projects
router.get('/:teamId/projects', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const projects = teamDb.getProjects(teamId);
        res.json({ data: { projects } });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Remove project from team
router.delete('/:teamId/projects', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const { projectPath } = req.body;

        const callerRole = teamDb.getMemberRole(teamId, req.user.id);
        if (!callerRole || !['pm', 'sm', 'architect'].includes(callerRole)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '权限不足' } });
        }

        teamDb.removeProject(teamId, projectPath);
        res.json({ data: { success: true } });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Get project branches
router.get('/:teamId/projects/:projectId/branches', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const projectId = parseInt(req.params.projectId);

        if (isNaN(teamId) || isNaN(projectId)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的参数' } });
        }

        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const project = teamDb.getProjectById(teamId, projectId);
        if (!project) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: '项目未找到' } });
        }

        const result = getBranches(project.project_path);
        res.json({ data: result });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Get project pull requests
router.get('/:teamId/projects/:projectId/pull-requests', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const projectId = parseInt(req.params.projectId);

        if (isNaN(teamId) || isNaN(projectId)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的参数' } });
        }

        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const project = teamDb.getProjectById(teamId, projectId);
        if (!project) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: '项目未找到' } });
        }

        const result = getPullRequests(project.project_path);
        res.json({ data: result });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Get project file tree
router.get('/:teamId/projects/:projectId/files', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const projectId = parseInt(req.params.projectId);

        if (isNaN(teamId) || isNaN(projectId)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的参数' } });
        }

        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const project = teamDb.getProjectById(teamId, projectId);
        if (!project) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: '项目未找到' } });
        }

        const ref = req.query.ref || 'HEAD';
        const result = getFileTree(project.project_path, ref);
        res.json({ data: result });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Get project commit log
router.get('/:teamId/projects/:projectId/commits', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const projectId = parseInt(req.params.projectId);

        if (isNaN(teamId) || isNaN(projectId)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的参数' } });
        }

        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const project = teamDb.getProjectById(teamId, projectId);
        if (!project) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: '项目未找到' } });
        }

        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        const result = getCommitLog(project.project_path, limit, offset);
        res.json({ data: result });
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// ==========================================
// Activity & Notifications
// ==========================================

// Get team activity log
router.get('/:teamId/activity', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: 'Not a team member' });
        }

        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const activities = activityDb.getForTeam(teamId, limit, offset);
        res.json(activities);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get notifications for current user
router.get('/notifications/list', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const unreadOnly = req.query.unreadOnly === 'true';

        const notifications = notificationsDb.getForUser(req.user.id, limit, offset, unreadOnly);
        const unreadCount = notificationsDb.getUnreadCount(req.user.id);

        res.json({ notifications, unreadCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mark notification as read
router.put('/notifications/:notificationId/read', (req, res) => {
    try {
        const notificationId = parseInt(req.params.notificationId);
        notificationsDb.markAsRead(notificationId, req.user.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mark all notifications as read
router.put('/notifications/read-all', (req, res) => {
    try {
        const { teamId } = req.body;
        notificationsDb.markAllAsRead(req.user.id, teamId || null);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// Online Presence
// ==========================================

// Get online team members
router.get('/:teamId/presence', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
        }

        const clients = getConnectedClients(req);
        const onlineMembers = getOnlineTeamMembers(clients, teamId);
        res.json(onlineMembers);
    } catch (error) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

export default router;
