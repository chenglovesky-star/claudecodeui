import { useState, useEffect } from 'react';
import { Copy, Link, Settings, Trash2, Users, X } from 'lucide-react';
import { useTeam, useTeamPermission } from '../../../contexts/TeamContext';
import { api } from '../../../utils/api';
import { Button, Input } from '../../../shared/view/ui';
import TeamMembersList from './TeamMembersList';
import { ROLE_LABELS } from '../types';

type TeamManagementPanelProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function TeamManagementPanel({ isOpen, onClose }: TeamManagementPanelProps) {
  const { currentTeam, refreshTeams } = useTeam();
  const { canManageTeam, canCreateInvites } = useTeamPermission();
  const [activeTab, setActiveTab] = useState<'members' | 'invites' | 'settings'>('members');
  const [invites, setInvites] = useState<any[]>([]);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && currentTeam && canCreateInvites) {
      loadInvites();
    }
  }, [isOpen, currentTeam]);

  const loadInvites = async () => {
    if (!currentTeam) return;
    try {
      const res = await api.team.getInvites(currentTeam.id);
      if (res.ok) setInvites(await res.json());
    } catch (error) {
      console.error('Failed to load invites:', error);
    }
  };

  const handleCreateInvite = async () => {
    if (!currentTeam) return;
    setIsCreatingInvite(true);
    try {
      const res = await api.team.createInvite(currentTeam.id, 72, 0); // 72 hours, unlimited uses
      if (res.ok) {
        await loadInvites();
      }
    } catch (error) {
      console.error('Failed to create invite:', error);
    }
    setIsCreatingInvite(false);
  };

  const handleCopyInvite = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleDeleteInvite = async (inviteId: number) => {
    if (!currentTeam) return;
    try {
      await api.team.deleteInvite(currentTeam.id, inviteId);
      await loadInvites();
    } catch (error) {
      console.error('Failed to delete invite:', error);
    }
  };

  if (!isOpen || !currentTeam) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{currentTeam.name}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-4">
          {(['members', 'invites', 'settings'] as const).map(tab => {
            if (tab === 'invites' && !canCreateInvites) return null;
            if (tab === 'settings' && !canManageTeam) return null;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-sm capitalize transition-colors ${
                  activeTab === tab
                    ? 'border-b-2 border-primary font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="max-h-96 overflow-y-auto p-4">
          {activeTab === 'members' && <TeamMembersList />}

          {activeTab === 'invites' && (
            <div className="space-y-3">
              <Button
                size="sm"
                onClick={handleCreateInvite}
                disabled={isCreatingInvite}
              >
                <Link className="h-3.5 w-3.5 mr-1.5" />
                {isCreatingInvite ? 'Creating...' : 'New Invite Link'}
              </Button>

              {invites.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active invites</p>
              ) : (
                <div className="space-y-2">
                  {invites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2"
                    >
                      <code className="truncate text-xs">{invite.invite_code}</code>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">
                          {invite.use_count} used
                        </span>
                        <button
                          onClick={() => handleCopyInvite(invite.invite_code)}
                          className="rounded p-1 hover:bg-accent"
                          title="Copy invite code"
                        >
                          <Copy className={`h-3 w-3 ${copiedCode === invite.invite_code ? 'text-green-500' : ''}`} />
                        </button>
                        <button
                          onClick={() => handleDeleteInvite(invite.id)}
                          className="rounded p-1 hover:bg-destructive/10 hover:text-destructive"
                          title="Delete invite"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Team Name</label>
                <p className="text-sm text-muted-foreground">{currentTeam.name}</p>
              </div>
              {currentTeam.description && (
                <div>
                  <label className="mb-1 block text-sm font-medium">Description</label>
                  <p className="text-sm text-muted-foreground">{currentTeam.description}</p>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">Your Role</label>
                <p className="text-sm text-muted-foreground">
                  {ROLE_LABELS[currentTeam.user_role]}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
