import { useState, useEffect } from 'react';
import { UserMinus } from 'lucide-react';
import { useTeam, useTeamPermission, type TeamMember, type TeamRole } from '../../../contexts/TeamContext';
import { useAuth } from '../../auth/context/AuthContext';
import { ROLE_LABELS, ROLE_COLORS } from '../types';
import { api } from '../../../utils/api';

export default function TeamMembersList() {
  const { currentTeam, currentTeamMembers, refreshMembers } = useTeam();
  const { canManageTeam } = useTeamPermission();
  const { user } = useAuth();
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'role-change' | 'remove';
    member: TeamMember;
    newRole?: TeamRole;
  } | null>(null);

  // Escape key closes confirm dialog
  useEffect(() => {
    if (!confirmDialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDialog(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmDialog]);

  if (!currentTeam || currentTeamMembers.length === 0) {
    return null;
  }

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 3000);
  };

  const handleRoleSelect = (member: TeamMember, newRole: TeamRole) => {
    if (newRole === member.role) {
      setEditingMemberId(null);
      return;
    }
    setEditingMemberId(null);
    setConfirmDialog({ type: 'role-change', member, newRole });
  };

  const handleConfirmRoleChange = async () => {
    if (!confirmDialog || confirmDialog.type !== 'role-change' || !confirmDialog.newRole) return;
    const { member, newRole } = confirmDialog;
    setConfirmDialog(null);
    try {
      const res = await api.team.updateMemberRole(currentTeam.id, member.user_id, newRole);
      if (!res.ok) {
        const payload = await res.json();
        const msg = payload?.error?.message || payload?.error || '角色修改失败';
        showError(typeof msg === 'string' ? msg : '角色修改失败');
        return;
      }
      await refreshMembers();
    } catch (error) {
      showError('网络错误');
    }
  };

  const handleRemoveClick = (member: TeamMember) => {
    setConfirmDialog({ type: 'remove', member });
  };

  const handleConfirmRemove = async () => {
    if (!confirmDialog || confirmDialog.type !== 'remove') return;
    const { member } = confirmDialog;
    setConfirmDialog(null);
    try {
      const res = await api.team.removeMember(currentTeam.id, member.user_id);
      if (!res.ok) {
        const payload = await res.json();
        const msg = payload?.error?.message || payload?.error || '移除失败';
        showError(typeof msg === 'string' ? msg : '移除失败');
        return;
      }
      await refreshMembers();
    } catch (error) {
      showError('网络错误');
    }
  };

  return (
    <div className="space-y-1">
      {/* Error toast */}
      {errorMessage && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      {currentTeamMembers.map((member) => (
        <div
          key={member.id}
          className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/50"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {(member.nickname || member.username).charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="truncate text-sm">{member.nickname || member.username}</span>
              {member.nickname && member.nickname !== member.username && (
                <span className="truncate text-[10px] text-muted-foreground">@{member.username}</span>
              )}
            </div>
            {member.user_id === user?.id && (
              <span className="text-[10px] text-muted-foreground">(我)</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {editingMemberId === member.id && canManageTeam ? (
              <select
                value={member.role}
                onChange={(e) => handleRoleSelect(member, e.target.value as TeamRole)}
                onBlur={() => setEditingMemberId(null)}
                className="rounded border bg-background px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              >
                {Object.entries(ROLE_LABELS).map(([role, label]) => (
                  <option key={role} value={role}>{label}</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => canManageTeam && member.user_id !== user?.id && setEditingMemberId(member.id)}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ROLE_COLORS[member.role]} ${
                  canManageTeam && member.user_id !== user?.id ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
                }`}
                title={canManageTeam && member.user_id !== user?.id ? '点击更改角色' : undefined}
              >
                {ROLE_LABELS[member.role]}
              </button>
            )}

            {canManageTeam && member.user_id !== user?.id && (
              <button
                onClick={() => handleRemoveClick(member)}
                className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="移除成员"
              >
                <UserMinus className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl border bg-background p-4 shadow-lg">
            {confirmDialog.type === 'role-change' ? (
              <>
                <h3 className="mb-2 text-sm font-semibold">确认修改角色</h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  将 <span className="font-medium text-foreground">{confirmDialog.member.nickname || confirmDialog.member.username}</span> 的角色从{' '}
                  <span className="font-medium text-foreground">{ROLE_LABELS[confirmDialog.member.role]}</span> 修改为{' '}
                  <span className="font-medium text-foreground">{ROLE_LABELS[confirmDialog.newRole!]}</span>？
                </p>
              </>
            ) : (
              <>
                <h3 className="mb-2 text-sm font-semibold">确认移除成员</h3>
                <p className="mb-1 text-sm text-muted-foreground">
                  确定要将 <span className="font-medium text-foreground">{confirmDialog.member.nickname || confirmDialog.member.username}</span> 移出团队吗？
                </p>
                <p className="mb-4 text-xs text-destructive">此操作不可撤销</p>
              </>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={confirmDialog.type === 'role-change' ? handleConfirmRoleChange : handleConfirmRemove}
                className={`rounded-md px-3 py-1.5 text-sm text-white ${
                  confirmDialog.type === 'remove'
                    ? 'bg-destructive hover:bg-destructive/90'
                    : 'bg-primary hover:bg-primary/90'
                }`}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
