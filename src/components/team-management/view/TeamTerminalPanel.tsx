import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Play, Square, Loader2 } from 'lucide-react';
import { useTeam } from '../../../contexts/TeamContext';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { api } from '../../../utils/api';
import { TERMINAL_OPTIONS } from '../../shell/constants/constants';
import '@xterm/xterm/css/xterm.css';

type TeamTerminalPanelProps = {
  projectPath: string;
};

type SessionInfo = {
  sessionId: string;
  status: string;
  projectPath: string;
  startedAt: number;
};

export default function TeamTerminalPanel({ projectPath }: TeamTerminalPanelProps) {
  const { currentTeam } = useTeam();
  const { ws, sendMessage, latestMessage } = useWebSocket();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terminalRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef(false);

  // Check for existing session on mount
  useEffect(() => {
    if (!currentTeam) return;
    (async () => {
      try {
        const res = await api.team.getMyInstance(currentTeam.id);
        if (res.ok) {
          const payload = await res.json();
          const s = payload?.data?.session;
          if (s && s.projectPath === projectPath) {
            setSession(s);
          }
        }
      } catch {
        // Ignore
      }
    })();
  }, [currentTeam, projectPath]);

  // Initialize xterm when session exists
  useEffect(() => {
    if (!session || !containerRef.current) return;

    const term = new XTerminal({
      ...TERMINAL_OPTIONS,
      fontSize: 13,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    setTimeout(() => fitAddon.fit(), 50);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle user input → send to backend
    term.onData((data) => {
      sendMessage({
        type: 'instance:input',
        sessionId: session.sessionId,
        data,
      });
    });

    // Handle resize
    term.onResize(({ cols, rows }) => {
      sendMessage({
        type: 'instance:resize',
        sessionId: session.sessionId,
        cols,
        rows,
      });
    });

    // Window resize handler
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };
    window.addEventListener('resize', handleResize);

    // Attach to receive output
    if (!attachedRef.current) {
      sendMessage({
        type: 'instance:attach',
        sessionId: session.sessionId,
      });
      attachedRef.current = true;
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      attachedRef.current = false;
    };
  }, [session, sendMessage]);

  // Handle incoming WebSocket messages for this instance
  useEffect(() => {
    if (!latestMessage || !session) return;

    if (latestMessage.type === 'instance:output' && latestMessage.sessionId === session.sessionId) {
      terminalRef.current?.write(latestMessage.data);
    } else if (latestMessage.type === 'instance:status' && latestMessage.sessionId === session.sessionId) {
      if (latestMessage.status === 'terminated') {
        setSession(null);
        attachedRef.current = false;
      }
    }
  }, [latestMessage, session]);

  const handleStart = async () => {
    if (!currentTeam) return;
    setIsStarting(true);
    setError(null);

    try {
      // Use actual terminal dimensions from container if available
      let cols = 80;
      let rows = 24;
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          // Approximate character dimensions (9px wide, 17px tall for 13px font)
          cols = Math.max(40, Math.floor(rect.width / 9));
          rows = Math.max(10, Math.floor(rect.height / 17));
        }
      }
      const res = await api.team.createInstance(currentTeam.id, { projectPath, cols, rows });
      const payload = await res.json();

      if (!res.ok) {
        const msg = payload?.error?.message || '启动失败';
        setError(typeof msg === 'string' ? msg : '启动失败');
      } else {
        setSession(payload.data);
      }
    } catch {
      setError('网络错误');
    }
    setIsStarting(false);
  };

  const handleStop = async () => {
    if (!currentTeam || !session) return;
    try {
      await api.team.deleteInstance(currentTeam.id, session.sessionId);
      setSession(null);
      attachedRef.current = false;
    } catch {
      // Ignore
    }
  };

  if (!currentTeam) return null;

  return (
    <div className="flex flex-col gap-2">
      {/* Controls */}
      <div className="flex items-center gap-2">
        {!session ? (
          <button
            onClick={handleStart}
            disabled={isStarting}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isStarting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isStarting ? '启动中...' : '启动 Claude Code'}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90"
          >
            <Square className="h-3.5 w-3.5" />
            终止会话
          </button>
        )}
        {session && (
          <span className="text-[10px] text-muted-foreground">
            会话 {session.sessionId.slice(0, 12)}...
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Terminal */}
      {session && (
        <div
          ref={containerRef}
          className="h-[400px] w-full rounded-md border overflow-hidden"
        />
      )}
    </div>
  );
}
