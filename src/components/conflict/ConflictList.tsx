import type { Conflict } from './ConflictPanel';

const LEVEL_STYLES: Record<string, string> = {
  yellow: 'border-l-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10',
  orange: 'border-l-orange-400 bg-orange-50/50 dark:bg-orange-900/10',
  red: 'border-l-red-400 bg-red-50/50 dark:bg-red-900/10',
};

const LEVEL_BADGE: Record<string, string> = {
  yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  confirmed: '已确认',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  resolved: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
};

type ConflictListProps = {
  conflicts: Conflict[];
  selectedId: number | undefined;
  onSelect: (conflict: Conflict) => void;
  teamId: number | undefined;
};

export default function ConflictList({ conflicts, selectedId, onSelect }: ConflictListProps) {
  if (conflicts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">暂无冲突</p>
          <p className="mt-1 text-xs text-muted-foreground">点击"扫描冲突"检测文件范围重叠</p>
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {conflicts.map(conflict => {
        const files = JSON.parse(conflict.files || '[]') as string[];
        return (
          <div
            key={conflict.id}
            onClick={() => onSelect(conflict)}
            className={`cursor-pointer border-l-4 px-4 py-3 transition-colors hover:bg-accent/50 ${LEVEL_STYLES[conflict.level] || ''} ${selectedId === conflict.id ? 'bg-accent' : ''}`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${LEVEL_BADGE[conflict.level] || ''}`}>
                  {conflict.level === 'yellow' ? '黄色' : conflict.level === 'orange' ? '橙色' : '红色'}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLES[conflict.status] || ''}`}>
                  {STATUS_LABELS[conflict.status] || conflict.status}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {new Date(conflict.detected_at).toLocaleDateString()}
              </span>
            </div>
            <p className="text-xs leading-relaxed">{conflict.description}</p>
            {files.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {files.slice(0, 3).map((f, i) => (
                  <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{f}</span>
                ))}
                {files.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{files.length - 3}</span>
                )}
              </div>
            )}
            {conflict.assigned_nickname || conflict.assigned_username ? (
              <div className="mt-1 text-[10px] text-muted-foreground">
                指派给: {conflict.assigned_nickname || conflict.assigned_username}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
