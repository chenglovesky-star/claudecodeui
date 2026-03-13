import { useState, useEffect, useCallback } from 'react';
import { useTeam } from '../../contexts/TeamContext';
import { api } from '../../utils/api';
import ConflictList from './ConflictList';
import ConflictDetail from './ConflictDetail';

type Conflict = {
  id: number;
  team_id: number;
  sprint_id: number | null;
  level: 'yellow' | 'orange' | 'red';
  status: 'open' | 'in_progress' | 'resolved' | 'confirmed';
  type: string;
  story_ids: string;
  member_ids: string;
  files: string;
  description: string;
  resolution_note: string | null;
  assigned_to: number | null;
  assigned_username: string | null;
  assigned_nickname: string | null;
  resolved_by: number | null;
  resolved_username: string | null;
  resolved_nickname: string | null;
  detected_at: string;
  resolved_at: string | null;
};

type ConflictStats = {
  open_count: number;
  in_progress_count: number;
  resolved_count: number;
  yellow_count: number;
  orange_count: number;
  red_count: number;
};

export type { Conflict, ConflictStats };

export default function ConflictPanel() {
  const { currentTeam } = useTeam();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [stats, setStats] = useState<ConflictStats | null>(null);
  const [selectedConflict, setSelectedConflict] = useState<Conflict | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const teamId = currentTeam?.id;

  const loadConflicts = useCallback(async () => {
    if (!teamId) return;
    try {
      const filters: Record<string, string> = {};
      if (statusFilter) filters.status = statusFilter;
      const res = await api.team.getConflicts(teamId, filters);
      if (res.ok) {
        const data = await res.json();
        setConflicts(data.data?.conflicts || []);
        setStats(data.data?.stats || null);
      }
    } catch (e) {
      console.error('Failed to load conflicts:', e);
    }
  }, [teamId, statusFilter]);

  useEffect(() => {
    setLoading(true);
    loadConflicts().finally(() => setLoading(false));
  }, [loadConflicts]);

  const handleScan = async () => {
    if (!teamId) return;
    // Get active sprint first
    try {
      const sprintRes = await api.team.getActiveSprint(teamId);
      if (!sprintRes.ok) return;
      const sprintData = await sprintRes.json();
      const sprint = sprintData.data?.sprint;
      if (!sprint) return;

      await api.team.scanConflicts(teamId, sprint.id);
      loadConflicts();
    } catch (e) {
      console.error('Failed to scan:', e);
    }
  };

  const handleAssign = async (conflictId: number, userId: number) => {
    if (!teamId) return;
    try {
      const res = await api.team.assignConflict(teamId, conflictId, userId);
      if (res.ok) {
        loadConflicts();
        if (selectedConflict?.id === conflictId) {
          const data = await res.json();
          setSelectedConflict(data.data?.conflict || null);
        }
      }
    } catch (e) {
      console.error('Failed to assign:', e);
    }
  };

  const handleResolve = async (conflictId: number, note: string) => {
    if (!teamId) return;
    try {
      const res = await api.team.resolveConflict(teamId, conflictId, note);
      if (res.ok) {
        loadConflicts();
        setSelectedConflict(null);
      }
    } catch (e) {
      console.error('Failed to resolve:', e);
    }
  };

  const handleConfirm = async (conflictId: number) => {
    if (!teamId) return;
    try {
      const res = await api.team.confirmConflict(teamId, conflictId);
      if (res.ok) {
        loadConflicts();
        setSelectedConflict(null);
      }
    } catch (e) {
      console.error('Failed to confirm:', e);
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
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">冲突预警</h2>
          {stats && (
            <div className="flex items-center gap-2 text-xs">
              {stats.red_count > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-900/40 dark:text-red-400">
                  红 {stats.red_count}
                </span>
              )}
              {stats.orange_count > 0 && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
                  橙 {stats.orange_count}
                </span>
              )}
              {stats.yellow_count > 0 && (
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">
                  黄 {stats.yellow_count}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs"
          >
            <option value="">全部状态</option>
            <option value="open">待处理</option>
            <option value="in_progress">处理中</option>
            <option value="resolved">已解决</option>
            <option value="confirmed">已确认</option>
          </select>
          <button
            onClick={handleScan}
            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          >
            扫描冲突
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className={`${selectedConflict ? 'w-1/2 border-r' : 'w-full'} overflow-auto`}>
          <ConflictList
            conflicts={conflicts}
            selectedId={selectedConflict?.id}
            onSelect={setSelectedConflict}
            teamId={teamId}
          />
        </div>
        {selectedConflict && teamId && (
          <div className="w-1/2 overflow-auto">
            <ConflictDetail
              conflict={selectedConflict}
              teamId={teamId}
              onAssign={handleAssign}
              onResolve={handleResolve}
              onConfirm={handleConfirm}
              onClose={() => setSelectedConflict(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
