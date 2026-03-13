import { useState } from 'react';
import { UserMinus, Shield } from 'lucide-react';
import { useTeam, useTeamPermission, type TeamMember, type TeamRole } from '../../../contexts/TeamContext';
import { useAuth } from '../../auth/context/AuthContext';
import { ROLE_LABELS, ROLE_COLORS } from '../types';
import { api } from '../../../utils/api';
import { Button } from '../../../shared/view/ui';

export default function TeamMembersList() {
  const { currentTeam, currentTeamMembers, refreshMembers } = useTeam();
  const { canManageTeam } = useTeamPermission();
  const { user } = useAuth();
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);

  if (!currentTeam || currentTeamMembers.length === 0) {
    return null;
  }

  const handleRoleChange = async (member: TeamMember, newRole: TeamRole) => {
    try {
      await api.team.updateMemberRole(currentTeam.id, member.user_id, newRole);
      await refreshMembers();
      setEditingMemberId(null);
    } catch (error) {
      console.error('Failed to update role:', error);
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!confirm(`Remove ${member.username} from the team?`)) return;
    try {
      await api.team.removeMember(currentTeam.id, member.user_id);
      await refreshMembers();
    } catch (error) {
      console.error('Failed to remove member:', error);
    }
  };

  return (
    <div className="space-y-1">
      {currentTeamMembers.map((member) => (
        <div
          key={member.id}
          className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/50"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {member.username.charAt(0).toUpperCase()}
            </div>
            <span className="truncate text-sm">{member.username}</span>
            {member.user_id === user?.id && (
              <span className="text-[10px] text-muted-foreground">(you)</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {editingMemberId === member.id && canManageTeam ? (
              <select
                value={member.role}
                onChange={(e) => handleRoleChange(member, e.target.value as TeamRole)}
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
                title={canManageTeam && member.user_id !== user?.id ? 'Click to change role' : undefined}
              >
                {ROLE_LABELS[member.role]}
              </button>
            )}

            {canManageTeam && member.user_id !== user?.id && (
              <button
                onClick={() => handleRemoveMember(member)}
                className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Remove member"
              >
                <UserMinus className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
