import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { api } from '../../utils/api';
import type { Conflict } from './ConflictPanel';

type Member = {
  user_id: number;
  username: string;
  nickname: string | null;
  role: string;
};

type ConflictDetailProps = {
  conflict: Conflict;
  teamId: number;
  onAssign: (conflictId: number, userId: number) => void;
  onResolve: (conflictId: number, note: string) => void;
  onConfirm: (conflictId: number) => void;
  onClose: () => void;
};

export default function ConflictDetail({ conflict, teamId, onAssign, onResolve, onConfirm, onClose }: ConflictDetailProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [resolveNote, setResolveNote] = useState('');
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const files = JSON.parse(conflict.files || '[]') as string[];
  const storyIds = JSON.parse(conflict.story_ids || '[]') as number[];
  const memberIds = JSON.parse(conflict.member_ids || '[]') as number[];

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.team.getMembers(teamId);
        if (res.ok) setMembers(await res.json());
      } catch { /* ignore */ }
    };
    load();
  }, [teamId]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowAssignPicker(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const levelLabel = conflict.level === 'yellow' ? '黄色预警' : conflict.level === 'orange' ? '橙色预警' : '红色预警';
  const levelColor = conflict.level === 'yellow' ? 'text-yellow-600' : conflict.level === 'orange' ? 'text-orange-600' : 'text-red-600';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${levelColor}`}>{levelLabel}</span>
          <span className="text-xs text-muted-foreground">#{conflict.id}</span>
        </div>
        <button onClick={onClose} className="rounded p-1 hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {/* Description */}
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">描述</h4>
          <p className="text-sm">{conflict.description}</p>
        </div>

        {/* Files */}
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">涉及文件</h4>
          <div className="space-y-1">
            {files.map((f, i) => (
              <div key={i} className="rounded bg-muted px-2 py-1 font-mono text-xs">{f}</div>
            ))}
          </div>
        </div>

        {/* Stories */}
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">关联 Story</h4>
          <div className="text-xs text-muted-foreground">
            Story ID: {storyIds.join(', ')}
          </div>
        </div>

        {/* Members */}
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">涉及成员</h4>
          <div className="text-xs text-muted-foreground">
            {members.filter(m => memberIds.includes(m.user_id)).map(m => m.nickname || m.username).join(', ')}
          </div>
        </div>

        {/* Assignee */}
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">负责人</h4>
          <div className="relative">
            {conflict.assigned_to ? (
              <span className="text-sm">{conflict.assigned_nickname || conflict.assigned_username}</span>
            ) : (
              <span className="text-xs text-muted-foreground">未指派</span>
            )}
            {conflict.status === 'open' && (
              <button
                onClick={() => setShowAssignPicker(!showAssignPicker)}
                className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary hover:bg-primary/20"
              >
                指派
              </button>
            )}
            {showAssignPicker && (
              <div ref={pickerRef} className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border bg-background shadow-lg">
                <div className="max-h-48 overflow-auto py-1">
                  {members.map(m => (
                    <button
                      key={m.user_id}
                      onClick={() => { onAssign(conflict.id, m.user_id); setShowAssignPicker(false); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                    >
                      {m.nickname || m.username}
                      <span className="text-muted-foreground">({m.role})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Resolution */}
        {conflict.status === 'resolved' && conflict.resolution_note && (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">解决说明</h4>
            <p className="text-sm">{conflict.resolution_note}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              解决者: {conflict.resolved_nickname || conflict.resolved_username}
            </p>
          </div>
        )}

        {/* Actions */}
        {conflict.status === 'in_progress' && (
          <div>
            <h4 className="mb-2 text-xs font-medium text-muted-foreground">解决冲突</h4>
            <textarea
              value={resolveNote}
              onChange={e => setResolveNote(e.target.value)}
              placeholder="解决说明（可选）"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              rows={3}
            />
            <button
              onClick={() => onResolve(conflict.id, resolveNote)}
              className="mt-2 rounded-md bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
            >
              标记为已解决
            </button>
          </div>
        )}

        {conflict.status === 'resolved' && (
          <div>
            <button
              onClick={() => onConfirm(conflict.id)}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700"
            >
              确认解决
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
