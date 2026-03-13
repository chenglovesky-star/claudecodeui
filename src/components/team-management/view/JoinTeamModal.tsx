import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from '../../../shared/view/ui';
import { useTeam } from '../../../contexts/TeamContext';

type JoinTeamModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function JoinTeamModal({ isOpen, onClose }: JoinTeamModalProps) {
  const { joinTeam } = useTeam();
  const [inviteCode, setInviteCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) {
      setError('请输入邀请码');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await joinTeam(inviteCode.trim());
    setIsSubmitting(false);

    if (result.success) {
      setInviteCode('');
      onClose();
    } else {
      setError(result.error || '加入团队失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">加入团队</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">邀请码</label>
            <Input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="粘贴邀请码"
              autoFocus
            />
            <p className="mt-1 text-xs text-muted-foreground">
              向团队管理员索取邀请码
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting || !inviteCode.trim()}>
              {isSubmitting ? '加入中...' : '加入团队'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
