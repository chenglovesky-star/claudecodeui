import { useState } from 'react';
import { Users, ChevronDown, Plus, LogIn } from 'lucide-react';
import { useTeam, type Team } from '../../../contexts/TeamContext';
import { ROLE_LABELS } from '../types';

type TeamSelectorProps = {
  onCreateTeam: () => void;
  onJoinTeam: () => void;
};

export default function TeamSelector({ onCreateTeam, onJoinTeam }: TeamSelectorProps) {
  const { teams, currentTeam, setCurrentTeamId } = useTeam();
  const [isOpen, setIsOpen] = useState(false);

  if (teams.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <button
          onClick={onCreateTeam}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Plus className="h-3 w-3" />
          <span>Create Team</span>
        </button>
        <button
          onClick={onJoinTeam}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <LogIn className="h-3 w-3" />
          <span>Join Team</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative px-3 py-1.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Users className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">
            {currentTeam?.name || 'Select Team'}
          </span>
          {currentTeam && (
            <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-primary/10 text-primary">
              {ROLE_LABELS[currentTeam.user_role]}
            </span>
          )}
        </div>
        <ChevronDown className={`h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-3 right-3 top-full z-50 mt-1 rounded-lg border bg-popover shadow-lg">
            <div className="max-h-48 overflow-y-auto p-1">
              {teams.map((team: Team) => (
                <button
                  key={team.id}
                  onClick={() => {
                    setCurrentTeamId(team.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                    team.id === currentTeam?.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  }`}
                >
                  <span className="truncate">{team.name}</span>
                  <span className="ml-auto flex-shrink-0 rounded px-1 py-0.5 text-[10px] bg-muted text-muted-foreground">
                    {ROLE_LABELS[team.user_role]}
                  </span>
                </button>
              ))}
            </div>
            <div className="border-t p-1">
              <button
                onClick={() => { onCreateTeam(); setIsOpen(false); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Create Team
              </button>
              <button
                onClick={() => { onJoinTeam(); setIsOpen(false); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <LogIn className="h-3 w-3" />
                Join Team
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
