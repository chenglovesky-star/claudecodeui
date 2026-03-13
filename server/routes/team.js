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

        res.status(201).json(team);
    } catch (error) {
        console.error('[TEAM] Error creating team:', error);
        res.status(500).json({ error: error.message });
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

// Get team members
router.get('/:teamId/members', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: 'Not a team member' });
        }

        const members = teamDb.getTeamMembers(teamId);
        res.json(members);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
            return res.status(403).json({ error: 'Only PM or SM can change roles' });
        }

        if (!VALID_ROLES.includes(role)) {
            return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
        }

        const success = teamDb.updateMemberRole(teamId, targetUserId, role);
        if (!success) return res.status(404).json({ error: 'Member not found' });

        const clients = getConnectedClients(req);
        broadcastTeamMemberChange(clients, teamId, 'role-changed', {
            userId: targetUserId,
            newRole: role,
            changedBy: req.user.id
        });

        activityDb.log(teamId, req.user.id, 'role_changed', 'member', String(targetUserId), JSON.stringify({ newRole: role }));

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
            return res.status(403).json({ error: 'Only PM or SM can remove other members' });
        }

        const success = teamDb.removeMember(teamId, targetUserId);
        if (!success) return res.status(404).json({ error: 'Member not found' });

        const clients = getConnectedClients(req);
        broadcastTeamMemberChange(clients, teamId, 'left', {
            userId: targetUserId,
            removedBy: req.user.id
        });

        activityDb.log(teamId, req.user.id, 'member_removed', 'member', String(targetUserId));

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
        const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3600000).toISOString() : null;

        const inviteCode = teamDb.createInvite(teamId, req.user.id, expiresAt, maxUses || 0);

        res.status(201).json({ inviteCode, expiresAt, maxUses: maxUses || 0 });
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
            return res.status(400).json({ error: result.error });
        }

        // Broadcast member joined
        const clients = getConnectedClients(req);
        broadcastTeamMemberChange(clients, result.teamId, 'joined', {
            userId: req.user.id,
            username: req.user.username
        });

        activityDb.log(result.teamId, req.user.id, 'member_joined', 'member', String(req.user.id));

        const team = teamDb.getTeamById(result.teamId);
        res.json({ success: true, team });
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

// Add project to team
router.post('/:teamId/projects', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const { projectPath } = req.body;

        if (!projectPath) return res.status(400).json({ error: 'Project path is required' });

        const callerRole = teamDb.getMemberRole(teamId, req.user.id);
        if (!callerRole) return res.status(403).json({ error: 'Not a team member' });

        const success = teamDb.addProject(teamId, projectPath, req.user.id);

        if (success) {
            activityDb.log(teamId, req.user.id, 'project_added', 'project', projectPath);
        }

        res.json({ success: true, alreadyExists: !success });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get team projects
router.get('/:teamId/projects', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        if (!teamDb.isMember(teamId, req.user.id)) {
            return res.status(403).json({ error: 'Not a team member' });
        }

        const projects = teamDb.getProjects(teamId);
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remove project from team
router.delete('/:teamId/projects', (req, res) => {
    try {
        const teamId = parseInt(req.params.teamId);
        const { projectPath } = req.body;

        const callerRole = teamDb.getMemberRole(teamId, req.user.id);
        if (!callerRole || !['pm', 'sm', 'architect'].includes(callerRole)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        teamDb.removeProject(teamId, projectPath);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
            return res.status(403).json({ error: 'Not a team member' });
        }

        const clients = getConnectedClients(req);
        const onlineMembers = getOnlineTeamMembers(clients, teamId);
        res.json(onlineMembers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
