import { useState, useEffect, useCallback } from 'react';
import { useTeam } from '../../contexts/TeamContext';
import { api } from '../../utils/api';
import SprintHeader from './SprintHeader';
import KanbanBoard from './KanbanBoard';
import WorkScopeView from './WorkScopeView';
import StoryDetailModal from './StoryDetailModal';

type Sprint = {
  id: number;
  team_id: number;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  created_by: number;
};

type Story = {
  id: number;
  team_id: number;
  sprint_id: number;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done';
  assigned_to: number | null;
  assigned_username: string | null;
  assigned_nickname: string | null;
  assigned_avatar: string | null;
  file_scope: string;
  priority: string;
  position: number;
  created_by: number;
};

export type { Sprint, Story };

export default function KanbanPanel() {
  const { currentTeam } = useTeam();
  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [view, setView] = useState<'kanban' | 'scope'>('kanban');
  const [showCreateStory, setShowCreateStory] = useState(false);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);

  const teamId = currentTeam?.id;

  const loadActiveSprint = useCallback(async () => {
    if (!teamId) return;
    try {
      const res = await api.team.getActiveSprint(teamId);
      if (res.ok) {
        const data = await res.json();
        setActiveSprint(data.data?.sprint || null);
      }
    } catch (e) {
      console.error('Failed to load active sprint:', e);
    }
  }, [teamId]);

  const loadStories = useCallback(async () => {
    if (!teamId || !activeSprint) {
      setStories([]);
      return;
    }
    try {
      const res = await api.team.getStories(teamId, activeSprint.id);
      if (res.ok) {
        const data = await res.json();
        setStories(data.data?.stories || []);
      }
    } catch (e) {
      console.error('Failed to load stories:', e);
    }
  }, [teamId, activeSprint]);

  useEffect(() => {
    setLoading(true);
    loadActiveSprint().finally(() => setLoading(false));
  }, [loadActiveSprint]);

  useEffect(() => {
    if (activeSprint) loadStories();
  }, [activeSprint, loadStories]);

  const handleSprintCreated = (sprint: Sprint) => {
    setActiveSprint(sprint);
  };

  const handleSprintCompleted = () => {
    setActiveSprint(null);
    setStories([]);
  };

  const handleStoryCreated = () => {
    loadStories();
    setShowCreateStory(false);
  };

  const handleStoryUpdated = () => {
    loadStories();
    setEditingStory(null);
  };

  const handleStatusChange = async (storyId: number, newStatus: string, position: number) => {
    if (!teamId) return;
    // Optimistic update
    setStories(prev => prev.map(s => s.id === storyId ? { ...s, status: newStatus as Story['status'], position } : s));
    try {
      const res = await api.team.updateStoryStatus(teamId, storyId, newStatus, position);
      if (!res.ok) loadStories(); // Rollback
    } catch {
      loadStories(); // Rollback
    }
  };

  const handleAssign = async (storyId: number, userId: number | null) => {
    if (!teamId) return;
    try {
      const res = await api.team.assignStory(teamId, storyId, userId);
      if (res.ok) loadStories();
    } catch (e) {
      console.error('Failed to assign:', e);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SprintHeader
        sprint={activeSprint}
        teamId={teamId}
        view={view}
        onViewChange={setView}
        onSprintCreated={handleSprintCreated}
        onSprintCompleted={handleSprintCompleted}
        onCreateStory={() => setShowCreateStory(true)}
      />

      <div className="flex-1 overflow-auto p-4">
        {!activeSprint ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-medium text-muted-foreground">暂无活跃 Sprint</p>
              <p className="mt-1 text-sm text-muted-foreground">点击上方"创建 Sprint"开始</p>
            </div>
          </div>
        ) : view === 'kanban' ? (
          <KanbanBoard
            stories={stories}
            onStatusChange={handleStatusChange}
            onStoryClick={setEditingStory}
            onAssign={handleAssign}
            teamId={teamId}
          />
        ) : (
          <WorkScopeView teamId={teamId} sprintId={activeSprint.id} />
        )}
      </div>

      {(showCreateStory || editingStory) && activeSprint && teamId && (
        <StoryDetailModal
          teamId={teamId}
          sprintId={activeSprint.id}
          story={editingStory}
          onClose={() => { setShowCreateStory(false); setEditingStory(null); }}
          onSaved={editingStory ? handleStoryUpdated : handleStoryCreated}
        />
      )}
    </div>
  );
}
