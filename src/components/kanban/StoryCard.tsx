import { memo, useState } from 'react';
import { User } from 'lucide-react';
import MemberPicker from './MemberPicker';
import type { Story } from './KanbanPanel';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: '低', medium: '中', high: '高', critical: '紧急',
};

type StoryCardProps = {
  story: Story;
  onDragStart: (e: React.DragEvent, story: Story) => void;
  onClick: () => void;
  onAssign: (storyId: number, userId: number | null) => void;
  teamId: number | undefined;
};

function StoryCard({ story, onDragStart, onClick, onAssign, teamId }: StoryCardProps) {
  const [showPicker, setShowPicker] = useState(false);
  const fileScope = JSON.parse(story.file_scope || '[]') as string[];

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, story)}
      onClick={onClick}
      className="cursor-pointer rounded-lg border bg-background p-3 shadow-sm transition-shadow hover:shadow-md active:shadow-lg"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-snug">{story.title}</h4>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_COLORS[story.priority] || ''}`}>
          {PRIORITY_LABELS[story.priority] || story.priority}
        </span>
      </div>

      {fileScope.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {fileScope.slice(0, 3).map((f, i) => (
            <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{f}</span>
          ))}
          {fileScope.length > 3 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{fileScope.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div
          className="relative"
          onClick={e => { e.stopPropagation(); setShowPicker(!showPicker); }}
        >
          {story.assigned_to ? (
            <div className="flex items-center gap-1" title={story.assigned_nickname || story.assigned_username || ''}>
              {story.assigned_avatar ? (
                <img src={story.assigned_avatar} className="h-5 w-5 rounded-full object-cover" alt="" />
              ) : (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                  <span className="text-[10px] font-medium text-primary">{(story.assigned_nickname || story.assigned_username || '?')[0]}</span>
                </div>
              )}
              <span className="text-xs text-muted-foreground">{story.assigned_nickname || story.assigned_username}</span>
            </div>
          ) : (
            <button className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent">
              <User className="h-3 w-3" />
              分配
            </button>
          )}
          {showPicker && teamId && (
            <MemberPicker
              teamId={teamId}
              currentUserId={story.assigned_to}
              onSelect={userId => { onAssign(story.id, userId); setShowPicker(false); }}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(StoryCard);
