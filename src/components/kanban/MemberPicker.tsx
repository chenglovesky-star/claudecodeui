import { useState, useEffect, useRef } from 'react';
import { api } from '../../utils/api';

type Member = {
  user_id: number;
  username: string;
  nickname: string | null;
  avatar_url: string | null;
  role: string;
};

type MemberPickerProps = {
  teamId: number;
  currentUserId: number | null;
  onSelect: (userId: number | null) => void;
  onClose: () => void;
};

export default function MemberPicker({ teamId, currentUserId, onSelect, onClose }: MemberPickerProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.team.getMembers(teamId);
        if (res.ok) setMembers(await res.json());
      } catch (err) { /* ignore */ }
    };
    load();
  }, [teamId]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border bg-background shadow-lg">
      <div className="max-h-48 overflow-auto py-1">
        {currentUserId && (
          <button
            onClick={() => onSelect(null)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            取消分配
          </button>
        )}
        {members.map(m => (
          <button
            key={m.user_id}
            onClick={() => onSelect(m.user_id)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent ${m.user_id === currentUserId ? 'bg-primary/10 font-medium' : ''}`}
          >
            {m.avatar_url ? (
              <img src={m.avatar_url} className="h-4 w-4 rounded-full object-cover" alt="" />
            ) : (
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted">
                <span className="text-[8px]">{(m.nickname || m.username)[0]}</span>
              </div>
            )}
            <span>{m.nickname || m.username}</span>
            <span className="text-muted-foreground">({m.role})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
