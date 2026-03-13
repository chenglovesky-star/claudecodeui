import { useState, useCallback, memo } from 'react';
import StoryCard from './StoryCard';
import type { Story } from './KanbanPanel';

type KanbanBoardProps = {
  stories: Story[];
  onStatusChange: (storyId: number, newStatus: string, position: number) => void;
  onStoryClick: (story: Story) => void;
  onAssign: (storyId: number, userId: number | null) => void;
  teamId: number | undefined;
};

const COLUMNS = [
  { id: 'todo' as const, title: '待办', color: 'border-slate-300 dark:border-slate-600' },
  { id: 'in_progress' as const, title: '进行中', color: 'border-blue-400 dark:border-blue-500' },
  { id: 'done' as const, title: '完成', color: 'border-green-400 dark:border-green-500' },
];

function KanbanBoard({ stories, onStatusChange, onStoryClick, onAssign, teamId }: KanbanBoardProps) {
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const getColumnStories = useCallback((status: string) =>
    stories.filter(s => s.status === status).sort((a, b) => a.position - b.position),
    [stories]
  );

  const handleDragStart = (e: React.DragEvent, story: Story) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: story.id, status: story.status }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.status !== targetStatus) {
        const columnStories = getColumnStories(targetStatus);
        onStatusChange(data.id, targetStatus, columnStories.length);
      }
    } catch (err) { /* ignore invalid drag data */ }
  };

  return (
    <div className="grid h-full grid-cols-3 gap-4">
      {COLUMNS.map(col => {
        const colStories = getColumnStories(col.id);
        return (
          <div
            key={col.id}
            className={`flex flex-col rounded-xl border-t-2 bg-muted/30 ${col.color} ${dragOverColumn === col.id ? 'ring-2 ring-primary/30' : ''}`}
            onDragOver={e => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, col.id)}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <h3 className="text-sm font-medium">{col.title}</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{colStories.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-auto px-2 pb-2">
              {colStories.map(story => (
                <StoryCard
                  key={story.id}
                  story={story}
                  onDragStart={handleDragStart}
                  onClick={() => onStoryClick(story)}
                  onAssign={onAssign}
                  teamId={teamId}
                />
              ))}
              {colStories.length === 0 && (
                <div className="flex items-center justify-center rounded-lg border border-dashed py-8 text-xs text-muted-foreground">
                  拖拽 Story 到此处
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default memo(KanbanBoard);
