import React from 'react';
import { Terminal } from 'lucide-react';
import type { Project, ShellLogSession } from '../../../types/app';
import { useShellLogContent } from '../hooks/useShellLogContent';

type ShellLogViewerProps = {
  project: Project;
  session: ShellLogSession;
};

export default function ShellLogViewer({ project, session }: ShellLogViewerProps) {
  const { content, lineCount, isLoading, error, reload } = useShellLogContent(session, project.name);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
        <Terminal className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">
          {session.provider === 'plain-shell' ? 'Shell Log' : 'Claude Shell Log'}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">
          {new Date(session.startedAt).toLocaleString()}
        </span>
        {session.endedAt && (
          <>
            <span className="text-muted-foreground">→</span>
            <span className="text-xs text-muted-foreground">
              {new Date(session.endedAt).toLocaleString()}
            </span>
          </>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{lineCount} 行</span>
        <button
          onClick={reload}
          className="ml-2 rounded px-2 py-0.5 text-xs hover:bg-accent"
        >
          刷新
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading && (
          <div className="text-sm text-muted-foreground">加载中...</div>
        )}
        {error && (
          <div className="text-sm text-destructive">加载失败：{error}</div>
        )}
        {!isLoading && !error && (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
            {content || '（日志为空）'}
          </pre>
        )}
      </div>
    </div>
  );
}
