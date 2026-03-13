import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { useWebSocket } from './WebSocketContext';
import { api } from '../utils/api';

// Types
export type TeamRole = 'pm' | 'architect' | 'developer' | 'sm' | 'qa' | 'ux' | 'analyst';

export type Team = {
  id: number;
  name: string;
  description: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  settings: string;
  user_role: TeamRole;
};

export type TeamMember = {
  id: number;
  team_id: number;
  user_id: number;
  role: TeamRole;
  joined_at: string;
  is_active: number;
  username: string;
  nickname: string | null;
  avatar_url: string | null;
  git_name: string | null;
  git_email: string | null;
  is_online?: boolean;
};

export type Notification = {
  id: number;
  user_id: number;
  team_id: number | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: number;
  created_at: string;
  team_name: string | null;
};

export type TeamContextType = {
  teams: Team[];
  currentTeam: Team | null;
  currentTeamMembers: TeamMember[];
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  setCurrentTeamId: (teamId: number | null) => void;
  refreshTeams: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  createTeam: (name: string, description?: string) => Promise<Team | null>;
  joinTeam: (inviteCode: string) => Promise<{ success: boolean; error?: string }>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
};

const TeamContext = createContext<TeamContextType | null>(null);

export const useTeam = () => {
  const context = useContext(TeamContext);
  if (!context) {
    throw new Error('useTeam must be used within a TeamProvider');
  }
  return context;
};

// Hook to check team permissions
export const useTeamPermission = () => {
  const { currentTeam } = useTeam();

  return useMemo(() => ({
    role: currentTeam?.user_role || null,
    isPM: currentTeam?.user_role === 'pm',
    isSM: currentTeam?.user_role === 'sm',
    isArchitect: currentTeam?.user_role === 'architect',
    isDeveloper: currentTeam?.user_role === 'developer',
    isQA: currentTeam?.user_role === 'qa',
    isUX: currentTeam?.user_role === 'ux',
    isAnalyst: currentTeam?.user_role === 'analyst',
    canManageTeam: ['pm', 'sm'].includes(currentTeam?.user_role || ''),
    canManageSprint: ['pm', 'sm'].includes(currentTeam?.user_role || ''),
    canEditPRD: ['pm', 'analyst'].includes(currentTeam?.user_role || ''),
    canEditArchitecture: ['architect'].includes(currentTeam?.user_role || ''),
    canClaimStories: ['developer', 'qa', 'ux'].includes(currentTeam?.user_role || ''),
    canCreateInvites: ['pm', 'sm', 'architect'].includes(currentTeam?.user_role || ''),
    hasTeam: !!currentTeam,
  }), [currentTeam]);
};

const TEAM_ID_KEY = 'current-team-id';

export const TeamProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const { latestMessage, sendMessage, isConnected } = useWebSocket();

  const [teams, setTeams] = useState<Team[]>([]);
  const [currentTeamId, setCurrentTeamIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(TEAM_ID_KEY);
    return stored ? parseInt(stored) : null;
  });
  const [currentTeamMembers, setCurrentTeamMembers] = useState<TeamMember[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const currentTeam = useMemo(
    () => teams.find(t => t.id === currentTeamId) || null,
    [teams, currentTeamId]
  );

  const setCurrentTeamId = useCallback((teamId: number | null) => {
    setCurrentTeamIdState(teamId);
    if (teamId) {
      localStorage.setItem(TEAM_ID_KEY, String(teamId));
    } else {
      localStorage.removeItem(TEAM_ID_KEY);
    }
  }, []);

  // Refresh teams list
  const refreshTeams = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await api.team.list();
      if (res.ok) {
        const data = await res.json();
        setTeams(data);

        // If current team no longer exists, clear selection
        if (currentTeamId && !data.find((t: Team) => t.id === currentTeamId)) {
          setCurrentTeamId(data.length > 0 ? data[0].id : null);
        }

        // Update WebSocket team context
        const teamIds = data.map((t: Team) => t.id);
        sendMessage({ type: 'team-context-update', teamIds });
      }
    } catch (error) {
      console.error('[TEAM] Failed to refresh teams:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, currentTeamId, setCurrentTeamId, sendMessage]);

  // Refresh members for current team
  const refreshMembers = useCallback(async () => {
    if (!currentTeamId) {
      setCurrentTeamMembers([]);
      return;
    }
    try {
      const res = await api.team.getMembers(currentTeamId);
      if (res.ok) {
        setCurrentTeamMembers(await res.json());
      }
    } catch (error) {
      console.error('[TEAM] Failed to refresh members:', error);
    }
  }, [currentTeamId]);

  // Refresh notifications
  const refreshNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.team.getNotifications(50, 0, false);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch (error) {
      console.error('[TEAM] Failed to refresh notifications:', error);
    }
  }, [user]);

  // Create team
  const createTeam = useCallback(async (name: string, description?: string): Promise<Team | null> => {
    try {
      const res = await api.team.create(name, description);
      if (res.ok) {
        const payload = await res.json();
        const team = payload?.data?.team || payload;
        await refreshTeams();
        setCurrentTeamId(team.id);
        return team;
      }
      return null;
    } catch (error) {
      console.error('[TEAM] Failed to create team:', error);
      return null;
    }
  }, [refreshTeams, setCurrentTeamId]);

  // Join team
  const joinTeam = useCallback(async (inviteCode: string) => {
    try {
      const res = await api.team.join(inviteCode);
      const payload = await res.json();
      if (res.ok) {
        await refreshTeams();
        const team = payload?.data?.team || payload?.team;
        if (team) setCurrentTeamId(team.id);
        return { success: true };
      }
      const error = payload?.error;
      return { success: false, error: typeof error === 'object' ? error.message : error };
    } catch (error) {
      return { success: false, error: '网络错误' };
    }
  }, [refreshTeams, setCurrentTeamId]);

  // Mark notification read
  const markNotificationRead = useCallback(async (id: number) => {
    try {
      await api.team.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('[TEAM] Failed to mark notification read:', error);
    }
  }, []);

  // Mark all read
  const markAllNotificationsRead = useCallback(async () => {
    try {
      await api.team.markAllNotificationsRead(currentTeamId);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
    } catch (error) {
      console.error('[TEAM] Failed to mark all read:', error);
    }
  }, [currentTeamId]);

  // Initial load
  useEffect(() => {
    if (user) {
      refreshTeams();
      refreshNotifications();
    }
  }, [user]);

  // Refresh members when team changes
  useEffect(() => {
    refreshMembers();
  }, [currentTeamId]);

  // Re-sync team context and presence on WebSocket reconnect
  useEffect(() => {
    if (isConnected && user && teams.length > 0) {
      const teamIds = teams.map((t: Team) => t.id);
      sendMessage({ type: 'team-context-update', teamIds });
      refreshMembers();
    }
  }, [isConnected]);

  // Handle WebSocket team messages
  useEffect(() => {
    if (!latestMessage) return;

    switch (latestMessage.type) {
      case 'team-member-changed':
        if (latestMessage.teamId === currentTeamId) {
          refreshMembers();
        }
        refreshTeams();
        break;
      case 'team-activity':
        // Could update activity feed in real-time
        break;
      case 'presence-update':
        if (latestMessage.teamId === currentTeamId) {
          setCurrentTeamMembers(prev => prev.map(m =>
            m.user_id === latestMessage.userId
              ? { ...m, is_online: latestMessage.status === 'online' }
              : m
          ));
        }
        break;
      case 'notification-new':
        setNotifications(prev => [latestMessage.notification, ...prev]);
        setUnreadCount(prev => prev + 1);
        break;
    }
  }, [latestMessage, currentTeamId, refreshMembers, refreshTeams]);

  const value = useMemo<TeamContextType>(() => ({
    teams,
    currentTeam,
    currentTeamMembers,
    notifications,
    unreadCount,
    isLoading,
    setCurrentTeamId,
    refreshTeams,
    refreshMembers,
    refreshNotifications,
    createTeam,
    joinTeam,
    markNotificationRead,
    markAllNotificationsRead,
  }), [teams, currentTeam, currentTeamMembers, notifications, unreadCount, isLoading,
    setCurrentTeamId, refreshTeams, refreshMembers, refreshNotifications,
    createTeam, joinTeam, markNotificationRead, markAllNotificationsRead]);

  return (
    <TeamContext.Provider value={value}>
      {children}
    </TeamContext.Provider>
  );
};

export default TeamContext;
