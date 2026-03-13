import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from '../../../shared/view/ui';
import { useTeam } from '../../../contexts/TeamContext';

type CreateTeamModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function CreateTeamModal({ isOpen, onClose }: CreateTeamModalProps) {
  const { createTeam } = useTeam();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请输入团队名称');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const team = await createTeam(name.trim(), description.trim() || undefined);
    setIsSubmitting(false);

    if (team) {
      setName('');
      setDescription('');
      onClose();
    } else {
      setError('创建团队失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">创建团队</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">团队名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：前端团队"
              maxLength={100}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个团队负责什么工作？"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? '创建中...' : '创建团队'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
