import { useState, useEffect } from 'react';
import { api } from '../../utils/api';

type WorkScopeMember = {
  userId: number;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  stories: Array<{
    storyId: number;
    title: string;
    status: string;
    fileScope: string[];
    priority: string;
  }>;
  totalFiles: number;
};

type Overlap = {
  files: string[];
  members: number[];
  storyIds: number[];
  storyTitles: string[];
};

type WorkScopeViewProps = {
  teamId: number | undefined;
  sprintId: number;
};

const STATUS_LABELS: Record<string, string> = { todo: '待办', in_progress: '进行中', done: '完成' };
const STATUS_COLORS: Record<string, string> = {
  todo: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
};

export default function WorkScopeView({ teamId, sprintId }: WorkScopeViewProps) {
  const [members, setMembers] = useState<WorkScopeMember[]>([]);
  const [overlaps, setOverlaps] = useState<Overlap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.team.getWorkScope(teamId, sprintId);
        if (res.ok) {
          const data = await res.json();
          setMembers(data.data?.members || []);
          setOverlaps(data.data?.overlaps || []);
        }
      } catch (e) {
        console.error('Failed to load work scope:', e);
      }
      setLoading(false);
    };
    load();
  }, [teamId, sprintId]);

  // Build a set of overlapping file paths for highlighting
  const overlapFiles = new Set<string>();
  overlaps.forEach(o => o.files.forEach(f => overlapFiles.add(f)));

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">加载中...</div>;
  }

  if (members.length === 0) {
    return <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">暂无已分配的 Story</div>;
  }

  return (
    <div className="space-y-4">
      {overlaps.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-800/50 dark:bg-red-900/10">
          <h4 className="mb-2 text-sm font-medium text-red-700 dark:text-red-400">文件范围重叠警告</h4>
          {overlaps.map((o, i) => (
            <div key={i} className="mb-1 text-xs text-red-600 dark:text-red-400">
              {o.storyTitles.join(' 与 ')} 共享文件: {o.files.join(', ')}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {members.map(m => (
          <div key={m.userId} className="rounded-xl border p-4">
            <div className="mb-3 flex items-center gap-2">
              {m.avatarUrl ? (
                <img src={m.avatarUrl} className="h-8 w-8 rounded-full object-cover" alt="" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                  <span className="text-sm font-medium text-primary">{(m.nickname || m.username)[0]}</span>
                </div>
              )}
              <div>
                <div className="text-sm font-medium">{m.nickname || m.username}</div>
                <div className="text-[10px] text-muted-foreground">{m.stories.length} 个 Story · {m.totalFiles} 个文件</div>
              </div>
            </div>

            <div className="space-y-2">
              {m.stories.map(s => (
                <div key={s.storyId} className="rounded-lg bg-muted/50 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium">{s.title}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLORS[s.status] || ''}`}>
                      {STATUS_LABELS[s.status] || s.status}
                    </span>
                  </div>
                  {s.fileScope.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {s.fileScope.map(f => (
                        <span
                          key={f}
                          className={`rounded px-1 py-0.5 text-[10px] ${overlapFiles.has(f) ? 'border border-red-300 bg-red-50 text-red-600 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400' : 'bg-muted text-muted-foreground'}`}
                          title={overlapFiles.has(f) ? '与其他成员的 Story 重叠' : undefined}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
