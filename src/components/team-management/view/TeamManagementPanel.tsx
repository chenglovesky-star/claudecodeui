import { useState, useEffect } from 'react';
import { Copy, Link, Trash2, Users, X } from 'lucide-react';
import { useTeam, useTeamPermission } from '../../../contexts/TeamContext';
import { api } from '../../../utils/api';
import { Button } from '../../../shared/view/ui';
import TeamMembersList from './TeamMembersList';
import TeamProjectsList from './TeamProjectsList';
import CollaborationPanel from './CollaborationPanel';
import { ROLE_LABELS } from '../types';

type TeamManagementPanelProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function TeamManagementPanel({ isOpen, onClose }: TeamManagementPanelProps) {
  const { currentTeam, refreshTeams } = useTeam();
  const { canManageTeam, canCreateInvites } = useTeamPermission();
  const [activeTab, setActiveTab] = useState<'members' | 'projects' | 'collaboration' | 'invites' | 'settings'>('members');
  const [invites, setInvites] = useState<any[]>([]);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && currentTeam && canCreateInvites) {
      loadInvites();
    }
  }, [isOpen, currentTeam, canCreateInvites]);

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
      const res = await api.team.createInvite(currentTeam.id, 72, 0);
      if (res.ok) {
        await loadInvites();
      }
    } catch (error) {
      console.error('Failed to create invite:', error);
    }
    setIsCreatingInvite(false);
  };

  const getInviteUrl = (code: string) => {
    return `${window.location.origin}/join/${code}`;
  };

  const handleCopyInvite = (code: string) => {
    navigator.clipboard.writeText(getInviteUrl(code));
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
          {([
            { key: 'members' as const, label: '成员' },
            { key: 'projects' as const, label: '项目' },
            { key: 'collaboration' as const, label: '协作' },
            { key: 'invites' as const, label: '邀请' },
            { key: 'settings' as const, label: '设置' },
          ]).map(({ key, label }) => {
            if (key === 'invites' && !canCreateInvites) return null;
            if (key === 'settings' && !canManageTeam) return null;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-3 py-2 text-sm transition-colors ${
                  activeTab === key
                    ? 'border-b-2 border-primary font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="max-h-96 overflow-y-auto p-4">
          {activeTab === 'members' && <TeamMembersList />}

          {activeTab === 'projects' && <TeamProjectsList />}

          {activeTab === 'collaboration' && <CollaborationPanel />}

          {activeTab === 'invites' && (
            <div className="space-y-3">
              <Button
                size="sm"
                onClick={handleCreateInvite}
                disabled={isCreatingInvite}
              >
                <Link className="h-3.5 w-3.5 mr-1.5" />
                {isCreatingInvite ? '生成中...' : '生成邀请链接'}
              </Button>

              {invites.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无有效邀请</p>
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
                          已使用 {invite.use_count} 次
                        </span>
                        <button
                          onClick={() => handleCopyInvite(invite.invite_code)}
                          className="rounded p-1 hover:bg-accent"
                          title="复制邀请链接"
                        >
                          <Copy className={`h-3 w-3 ${copiedCode === invite.invite_code ? 'text-green-500' : ''}`} />
                        </button>
                        <button
                          onClick={() => handleDeleteInvite(invite.id)}
                          className="rounded p-1 hover:bg-destructive/10 hover:text-destructive"
                          title="删除邀请"
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
                <label className="mb-1 block text-sm font-medium">团队名称</label>
                <p className="text-sm text-muted-foreground">{currentTeam.name}</p>
              </div>
              {currentTeam.description && (
                <div>
                  <label className="mb-1 block text-sm font-medium">描述</label>
                  <p className="text-sm text-muted-foreground">{currentTeam.description}</p>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">你的角色</label>
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
