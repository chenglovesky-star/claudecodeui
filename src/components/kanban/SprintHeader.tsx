import { useState } from 'react';
import { Plus, CheckCircle2, LayoutDashboard, Users2 } from 'lucide-react';
import { api } from '../../utils/api';
import type { Sprint } from './KanbanPanel';

type SprintHeaderProps = {
  sprint: Sprint | null;
  teamId: number | undefined;
  view: 'kanban' | 'scope';
  onViewChange: (v: 'kanban' | 'scope') => void;
  onSprintCreated: (sprint: Sprint) => void;
  onSprintCompleted: () => void;
  onCreateStory: () => void;
};

export default function SprintHeader({ sprint, teamId, view, onViewChange, onSprintCreated, onSprintCompleted, onCreateStory }: SprintHeaderProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creating, setCreating] = useState(false);

  const daysLeft = sprint?.end_date
    ? Math.max(0, Math.ceil((new Date(sprint.end_date).getTime() - Date.now()) / 86400000))
    : null;

  const handleCreate = async () => {
    if (!teamId || !name.trim()) return;
    setCreating(true);
    try {
      const res = await api.team.createSprint(teamId, { name: name.trim(), startDate, endDate });
      if (res.ok) {
        const data = await res.json();
        if (data.data?.hasActiveSprint) {
          // Has active sprint - need to handle
          alert('已有活跃 Sprint，请先完成当前 Sprint');
        } else if (data.data?.sprint) {
          // Auto-activate
          const activateRes = await api.team.activateSprint(teamId, data.data.sprint.id);
          if (activateRes.ok) {
            const activated = await activateRes.json();
            onSprintCreated(activated.data?.sprint || data.data.sprint);
          }
          setShowCreateDialog(false);
          setName('');
          setStartDate('');
          setEndDate('');
        }
      }
    } catch (e) {
      console.error('Failed to create sprint:', e);
    }
    setCreating(false);
  };

  const handleComplete = async () => {
    if (!teamId || !sprint) return;
    try {
      const res = await api.team.completeSprint(teamId, sprint.id);
      if (res.ok) {
        onSprintCompleted();
        setShowCompleteConfirm(false);
      }
    } catch (e) {
      console.error('Failed to complete sprint:', e);
    }
  };

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-3">
        {sprint ? (
          <>
            <h2 className="text-sm font-semibold">{sprint.name}</h2>
            {sprint.start_date && sprint.end_date && (
              <span className="text-xs text-muted-foreground">
                {sprint.start_date} ~ {sprint.end_date}
              </span>
            )}
            {daysLeft !== null && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${daysLeft <= 2 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                剩余 {daysLeft} 天
              </span>
            )}
          </>
        ) : (
          <h2 className="text-sm font-medium text-muted-foreground">Sprint 看板</h2>
        )}
      </div>

      <div className="flex items-center gap-2">
        {sprint && (
          <>
            {/* View toggle */}
            <div className="flex rounded-lg bg-muted/60 p-0.5">
              <button
                onClick={() => onViewChange('kanban')}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${view === 'kanban' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <LayoutDashboard className="h-3 w-3" />
                看板
              </button>
              <button
                onClick={() => onViewChange('scope')}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${view === 'scope' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Users2 className="h-3 w-3" />
                工作范围
              </button>
            </div>

            <button
              onClick={onCreateStory}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3 w-3" />
              新建 Story
            </button>

            <button
              onClick={() => setShowCompleteConfirm(true)}
              className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <CheckCircle2 className="h-3 w-3" />
              完成 Sprint
            </button>
          </>
        )}

        {!sprint && (
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3 w-3" />
            创建 Sprint
          </button>
        )}
      </div>

      {/* Create Sprint Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreateDialog(false)}>
          <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-base font-semibold">创建 Sprint</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm">名称 *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="Sprint 1"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm">开始日期</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm">结束日期</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowCreateDialog(false)} className="rounded-lg px-4 py-2 text-sm hover:bg-accent">取消</button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || creating}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {creating ? '创建中...' : '创建并激活'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Sprint Confirm */}
      {showCompleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCompleteConfirm(false)}>
          <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 className="mb-2 text-base font-semibold">完成 Sprint</h3>
            <p className="mb-4 text-sm text-muted-foreground">确认要完成当前 Sprint "{sprint?.name}" 吗？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCompleteConfirm(false)} className="rounded-lg px-4 py-2 text-sm hover:bg-accent">取消</button>
              <button onClick={handleComplete} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">确认完成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
