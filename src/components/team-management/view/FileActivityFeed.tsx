import { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, FileCode, FilePlus, Trash2, AlertTriangle } from 'lucide-react';
import { useTeam } from '../../../contexts/TeamContext';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { api } from '../../../utils/api';

const FILE_CHANGES_MAX_ENTRIES = 200;
const LOAD_DEBOUNCE_MS = 3000;

type FileActivity = {
  userId: number;
  files: { path: string; action: string; projectPath: string }[];
};

type RecentActivity = {
  id: number;
  user_id: number;
  username: string;
  nickname: string | null;
  file_path: string;
  action: string;
  project_path: string;
  created_at: string;
};

function ActionIcon({ action }: { action: string }) {
  switch (action) {
    case 'created': return <FilePlus className="h-3 w-3 text-green-500" />;
    case 'deleted': return <Trash2 className="h-3 w-3 text-red-500" />;
    default: return <FileCode className="h-3 w-3 text-blue-500" />;
  }
}

export default function FileActivityFeed() {
  const { currentTeam } = useTeam();
  const { latestMessage } = useWebSocket();
  const [liveActivities, setLiveActivities] = useState<FileActivity[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [fileChanges, setFileChanges] = useState<Map<string, Set<number>>>(new Map());
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    if (!currentTeam) return;
    try {
      const res = await api.team.getFileActivities(currentTeam.id);
      if (res.ok) {
        const payload = await res.json();
        const data = payload?.data || payload;
        setLiveActivities(data.live || []);
        setRecentActivities(data.recent || []);
      }
    } catch (error) {
      console.error('Failed to load file activities:', error);
    }
  }, [currentTeam]);

  useEffect(() => {
    if (currentTeam) loadData();
  }, [currentTeam, loadData]);

  // Handle real-time file:change events (debounced to prevent API storm)
  useEffect(() => {
    if (!latestMessage || latestMessage.type !== 'file:change') return;

    const { userId, filePath } = latestMessage;

    // Track which users are editing which files (for conflict detection)
    setFileChanges(prev => {
      const next = new Map(prev);
      const users = next.get(filePath) || new Set();
      users.add(userId);
      next.set(filePath, users);
      // Cap entries to prevent memory leak
      if (next.size > FILE_CHANGES_MAX_ENTRIES) {
        const keys = Array.from(next.keys());
        for (let i = 0; i < keys.length - FILE_CHANGES_MAX_ENTRIES; i++) {
          next.delete(keys[i]);
        }
      }
      return next;
    });

    // Debounced refresh — avoid API request storm on rapid file changes
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      loadData();
    }, LOAD_DEBOUNCE_MS);
  }, [latestMessage, loadData]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, []);

  // Detect conflicts: files being edited by multiple users
  const conflictFiles = new Set<string>();
  for (const [fp, users] of fileChanges) {
    if (users.size > 1) conflictFiles.add(fp);
  }

  if (!currentTeam) return null;

  return (
    <div className="space-y-3">
      {/* Live activities by user */}
      {liveActivities.length > 0 && (
        <div>
          <h5 className="text-[10px] font-medium text-muted-foreground mb-1">当前修改文件</h5>
          <div className="space-y-2">
            {liveActivities.map((activity) => (
              <div key={activity.userId} className="space-y-0.5">
                {activity.files.map((file) => {
                  const isConflict = conflictFiles.has(file.path);
                  return (
                    <div
                      key={`${activity.userId}-${file.path}`}
                      className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${
                        isConflict ? 'border border-yellow-400 bg-yellow-50 dark:bg-yellow-900/10' : 'hover:bg-accent/50'
                      }`}
                    >
                      <ActionIcon action={file.action} />
                      <span className="truncate font-mono text-[11px]">{file.path}</span>
                      {isConflict && (
                        <span title="多人同时修改">
                          <AlertTriangle className="h-3 w-3 flex-shrink-0 text-yellow-500" />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent activity log */}
      {recentActivities.length > 0 && (
        <div>
          <h5 className="text-[10px] font-medium text-muted-foreground mb-1">最近文件变更</h5>
          <div className="max-h-[200px] overflow-y-auto space-y-0.5">
            {recentActivities.slice(0, 20).map((activity) => (
              <div key={activity.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ActionIcon action={activity.action} />
                <span className="truncate font-mono">{activity.file_path}</span>
                <span className="flex-shrink-0">· {activity.nickname || activity.username}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {liveActivities.length === 0 && recentActivities.length === 0 && (
        <p className="text-xs text-muted-foreground">暂无文件活动</p>
      )}
    </div>
  );
}
