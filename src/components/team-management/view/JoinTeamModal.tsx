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
      setError('Invite code is required');
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
      setError(result.error || 'Failed to join team');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Join Team</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Invite Code</label>
            <Input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Paste invite code here"
              autoFocus
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Ask your team lead for an invite code
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !inviteCode.trim()}>
              {isSubmitting ? 'Joining...' : 'Join Team'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
