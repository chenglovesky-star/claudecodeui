import { useState, useEffect, useCallback } from 'react';
import { Monitor, RefreshCw, User } from 'lucide-react';
import { useTeam } from '../../../contexts/TeamContext';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { api } from '../../../utils/api';

type InstanceInfo = {
  sessionId: string;
  userId: number;
  username: string;
  nickname: string | null;
  status: string;
  projectPath: string;
  startedAt: number;
  lastActivity: number;
};

type Stats = {
  active: number;
  idle: number;
  total: number;
  capacity: number;
};

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟`;
  const hours = Math.floor(mins / 60);
  return `${hours}小时${mins % 60}分钟`;
}

function StatusDot({ status }: { status: string }) {
  const cls = status === 'active'
    ? 'bg-green-500'
    : status === 'idle'
      ? 'bg-yellow-500'
      : 'bg-gray-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

export default function CollaborationPanel() {
  const { currentTeam } = useTeam();
  const { latestMessage } = useWebSocket();
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentTeam) return;
    setIsLoading(true);
    try {
      const [instancesRes, statsRes] = await Promise.all([
        api.team.getInstances(currentTeam.id),
        api.team.getInstanceStats(currentTeam.id),
      ]);

      if (instancesRes.ok) {
        const payload = await instancesRes.json();
        setInstances(payload?.data?.sessions || []);
      }
      if (statsRes.ok) {
        const payload = await statsRes.json();
        setStats(payload?.data || null);
      }
    } catch (error) {
      console.error('Failed to load collaboration data:', error);
    }
    setIsLoading(false);
  }, [currentTeam]);

  useEffect(() => {
    if (currentTeam) loadData();
  }, [currentTeam, loadData]);

  // Auto-refresh when instance events come through WebSocket
  useEffect(() => {
    if (!latestMessage) return;
    if (['instance:created', 'instance:terminated', 'instance:timeout'].includes(latestMessage.type)) {
      loadData();
    }
  }, [latestMessage, loadData]);

  if (!currentTeam) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground">协作状态</h4>
        <button
          onClick={loadData}
          disabled={isLoading}
          className="rounded p-1 hover:bg-accent"
          title="刷新"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Capacity bar */}
      {stats && (
        <div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>实例使用</span>
            <span>{stats.total}/{stats.capacity}</span>
          </div>
          <div className="h-1.5 rounded-full bg-accent overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(stats.total / stats.capacity) * 100}%` }}
            />
          </div>
          <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><StatusDot status="active" /> 活跃 {stats.active}</span>
            <span className="flex items-center gap-1"><StatusDot status="idle" /> 空闲 {stats.idle}</span>
          </div>
        </div>
      )}

      {/* Instance list */}
      {instances.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无活跃会话</p>
      ) : (
        <div className="space-y-1.5">
          {instances.map((inst) => (
            <div key={inst.sessionId} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
              <div className="relative flex-shrink-0">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent">
                  <User className="h-3 w-3" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5">
                  <StatusDot status={inst.status} />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-xs font-medium">
                    {inst.nickname || inst.username}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {inst.status === 'active' ? '编码中' : '空闲'}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Monitor className="h-2.5 w-2.5" />
                  <span className="truncate">{inst.projectPath.split('/').pop()}</span>
                  <span>· {formatDuration(Date.now() - inst.startedAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
