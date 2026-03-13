/**
 * TEAM WEBSOCKET UTILITIES
 * ========================
 *
 * Utilities for broadcasting team-aware messages via WebSocket.
 * Unlike taskmaster-websocket.js which broadcasts to all clients,
 * these utilities filter by team membership.
 */

import { WebSocket } from 'ws';

/**
 * Broadcast message to all members of a specific team
 * @param {Map} connectedClients - Map<WebSocket, clientInfo>
 * @param {number} teamId - Team ID to broadcast to
 * @param {Object} message - Message object to send
 * @param {number|null} excludeUserId - Optional user ID to exclude from broadcast
 */
export function broadcastToTeam(connectedClients, teamId, message, excludeUserId = null) {
    if (!connectedClients || !teamId) return;

    const messageStr = JSON.stringify(message);

    connectedClients.forEach((clientInfo, client) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (excludeUserId && clientInfo.userId === excludeUserId) return;
        if (!clientInfo.teamIds || !clientInfo.teamIds.includes(teamId)) return;

        try {
            client.send(messageStr);
        } catch (error) {
            console.error('[TEAM-WS] Error sending to client:', error.message);
        }
    });
}

/**
 * Broadcast message to a specific user (all their connections)
 * @param {Map} connectedClients - Map<WebSocket, clientInfo>
 * @param {number} userId - Target user ID
 * @param {Object} message - Message object to send
 */
export function broadcastToUser(connectedClients, userId, message) {
    if (!connectedClients || !userId) return;

    const messageStr = JSON.stringify(message);

    connectedClients.forEach((clientInfo, client) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (clientInfo.userId !== userId) return;

        try {
            client.send(messageStr);
        } catch (error) {
            console.error('[TEAM-WS] Error sending to user:', error.message);
        }
    });
}

/**
 * Broadcast team member joined/left event
 */
export function broadcastTeamMemberChange(connectedClients, teamId, changeType, memberData) {
    broadcastToTeam(connectedClients, teamId, {
        type: 'team-member-changed',
        teamId,
        changeType, // 'joined', 'left', 'role-changed'
        member: memberData,
        timestamp: new Date().toISOString()
    });
}

/**
 * Broadcast activity log event to team
 */
export function broadcastTeamActivity(connectedClients, teamId, activity) {
    broadcastToTeam(connectedClients, teamId, {
        type: 'team-activity',
        teamId,
        activity,
        timestamp: new Date().toISOString()
    });
}

/**
 * Broadcast notification to a specific user
 */
export function broadcastNotification(connectedClients, userId, notification) {
    broadcastToUser(connectedClients, userId, {
        type: 'notification-new',
        notification,
        timestamp: new Date().toISOString()
    });
}

/**
 * Get online team members for a given team
 * @param {Map} connectedClients - Map<WebSocket, clientInfo>
 * @param {number} teamId - Team ID
 * @returns {Array} Array of online member info objects
 */
export function getOnlineTeamMembers(connectedClients, teamId) {
    const members = new Map(); // userId -> latest info

    connectedClients.forEach((clientInfo) => {
        if (!clientInfo.teamIds || !clientInfo.teamIds.includes(teamId)) return;
        if (!clientInfo.userId) return;

        // Keep latest connection info per user
        members.set(clientInfo.userId, {
            userId: clientInfo.userId,
            username: clientInfo.username,
            currentProject: clientInfo.currentProject || null,
            currentFile: clientInfo.currentFile || null,
            status: clientInfo.status || 'online'
        });
    });

    return Array.from(members.values());
}
