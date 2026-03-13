import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { api } from '../../utils/api';
import type { Story } from './KanbanPanel';

type StoryDetailModalProps = {
  teamId: number;
  sprintId: number;
  story: Story | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function StoryDetailModal({ teamId, sprintId, story, onClose, onSaved }: StoryDetailModalProps) {
  const [title, setTitle] = useState(story?.title || '');
  const [description, setDescription] = useState(story?.description || '');
  const [priority, setPriority] = useState(story?.priority || 'medium');
  const [fileScope, setFileScope] = useState<string[]>(story ? JSON.parse(story.file_scope || '[]') : []);
  const [newPath, setNewPath] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAddPath = () => {
    const p = newPath.trim();
    if (p && !fileScope.includes(p)) {
      setFileScope([...fileScope, p]);
      setNewPath('');
    }
  };

  const handleRemovePath = (path: string) => {
    setFileScope(fileScope.filter(f => f !== path));
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (story) {
        await api.team.updateStory(teamId, story.id, { title: title.trim(), description, priority, file_scope: fileScope });
      } else {
        await api.team.createStory(teamId, sprintId, { title: title.trim(), description, priority, fileScope });
      }
      onSaved();
    } catch (e) {
      console.error('Failed to save story:', e);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!story || !confirm('确认删除此 Story？')) return;
    try {
      await api.team.deleteStory(teamId, story.id);
      onSaved();
    } catch (e) {
      console.error('Failed to delete:', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border bg-background shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-base font-semibold">{story ? '编辑 Story' : '新建 Story'}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="max-h-[70vh] overflow-auto p-4">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">标题 *</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Story 标题"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">描述</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                rows={3}
                placeholder="Story 描述"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">优先级</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="critical">紧急</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">文件范围</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPath}
                  onChange={e => setNewPath(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddPath())}
                  className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="输入文件/目录路径，回车添加"
                />
                <button onClick={handleAddPath} className="rounded-lg border px-3 py-2 text-sm hover:bg-accent">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {fileScope.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {fileScope.map(f => (
                    <span key={f} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                      {f}
                      <button onClick={() => handleRemovePath(f)} className="text-muted-foreground hover:text-foreground">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <div>
            {story && (
              <button onClick={handleDelete} className="text-xs text-red-500 hover:text-red-600">删除 Story</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm hover:bg-accent">取消</button>
            <button
              onClick={handleSave}
              disabled={!title.trim() || saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? '保存中...' : (story ? '保存' : '创建')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
