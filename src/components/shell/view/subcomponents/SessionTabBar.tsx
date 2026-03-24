import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Settings, X } from 'lucide-react';
import type { SessionEntry } from '../../hooks/useSessionManager';

type SessionTabBarProps = {
  sessions: SessionEntry[];
  activeSessionId: string | null;
  tabOrder: string[];
  onSwitch: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onNewSession: () => void;
  onReorder: (from: number, to: number) => void;
  showSettings?: boolean;
  onToggleSettings?: () => void;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  canSplit?: boolean;
};

const STATUS_DOT_CLASS: Record<SessionEntry['status'], string> = {
  running: 'bg-green-400',
  idle: 'bg-yellow-400',
  disconnected: 'bg-gray-500',
};

export default function SessionTabBar({
  sessions,
  activeSessionId,
  tabOrder,
  onSwitch,
  onClose,
  onNewSession,
  onReorder,
  showSettings,
  onToggleSettings,
  onSplitHorizontal,
  onSplitVertical,
  canSplit = true,
}: SessionTabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Compute ordered sessions from tabOrder
  const orderedSessions = tabOrder
    .map((id) => sessions.find((s) => s.sessionId === id))
    .filter((s): s is SessionEntry => s !== undefined);

  // Keyboard shortcuts
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Left/Right arrow navigation within tabs
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const currentIdx = orderedSessions.findIndex((s) => s.sessionId === activeSessionId);
        if (currentIdx === -1) return;
        const nextIdx = e.key === 'ArrowLeft'
          ? (currentIdx - 1 + orderedSessions.length) % orderedSessions.length
          : (currentIdx + 1) % orderedSessions.length;
        onSwitch(orderedSessions[nextIdx].sessionId);
        return;
      }

      const isMac = navigator.platform.includes('Mac');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      // Cmd+1-9: switch to tab by index
      const digitMatch = e.key.match(/^(\d)$/);
      if (digitMatch) {
        const idx = parseInt(digitMatch[1], 10) - 1;
        if (idx >= 0 && idx < orderedSessions.length) {
          e.preventDefault();
          onSwitch(orderedSessions[idx].sessionId);
        }
        return;
      }

      if (e.shiftKey) {
        switch (e.key) {
          case '[': {
            // Prev tab
            e.preventDefault();
            const currentIdx = orderedSessions.findIndex(
              (s) => s.sessionId === activeSessionId,
            );
            if (currentIdx > 0) {
              onSwitch(orderedSessions[currentIdx - 1].sessionId);
            }
            break;
          }
          case ']': {
            // Next tab
            e.preventDefault();
            const currentIdx = orderedSessions.findIndex(
              (s) => s.sessionId === activeSessionId,
            );
            if (currentIdx < orderedSessions.length - 1) {
              onSwitch(orderedSessions[currentIdx + 1].sessionId);
            }
            break;
          }
          case 'T': {
            // New session
            e.preventDefault();
            onNewSession();
            break;
          }
          case 'W': {
            // Close current session
            e.preventDefault();
            if (activeSessionId) {
              onClose(activeSessionId);
            }
            break;
          }
        }
      }
    },
    [orderedSessions, activeSessionId, onSwitch, onClose, onNewSession],
  );

  // Drag handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = 'move';
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropIndex(index);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== index) {
        onReorder(dragIndex, index);
      }
      setDragIndex(null);
      setDropIndex(null);
    },
    [dragIndex, onReorder],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  return (
    <div
      ref={containerRef}
      role="tablist"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex h-[36px] items-center gap-0.5 overflow-x-auto border-b border-gray-700 bg-[#252526] px-2"
    >
      {orderedSessions.map((session, index) => {
        const isActive = session.sessionId === activeSessionId;
        const truncatedName =
          session.sessionId.length > 12
            ? session.sessionId.slice(0, 12) + '\u2026'
            : session.sessionId;

        return (
          <div
            key={session.sessionId}
            role="tab"
            aria-selected={isActive}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => onSwitch(session.sessionId)}
            className={`group flex cursor-pointer items-center gap-1.5 rounded-t px-2 md:px-3 py-1.5 text-xs select-none ${
              isActive
                ? 'border-l border-r border-t border-gray-600 bg-[#1e1e1e] text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            } ${dropIndex === index && dragIndex !== null ? 'ring-1 ring-blue-400' : ''}`}
          >
            {/* Status dot */}
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[session.status]}`}
            />

            {/* Session name */}
            <span className="truncate">{truncatedName}</span>

            {/* Keyboard shortcut hint */}
            {index < 9 && (
              <span className="ml-1 hidden text-[10px] text-gray-600 md:inline">
                {'\u2318'}
                {index + 1}
              </span>
            )}

            {/* Close button */}
            <button
              className="ml-1 hidden shrink-0 rounded p-0.5 hover:bg-gray-600 group-hover:block"
              onClick={(e) => {
                e.stopPropagation();
                onClose(session.sessionId);
              }}
              aria-label={`Close ${session.sessionId}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      {/* New session button */}
      <button
        className="ml-1 flex shrink-0 items-center justify-center rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
        onClick={onNewSession}
        aria-label="New session"
      >
        <Plus className="h-4 w-4" />
      </button>

      {/* Split pane buttons (hidden on mobile) */}
      <div className="hidden md:flex items-center gap-0.5">
        {canSplit && onSplitHorizontal && (
          <button
            className="flex shrink-0 items-center justify-center rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
            onClick={onSplitHorizontal}
            aria-label="Split horizontal"
            title="横分"
          >
            <span className="text-xs">⊟</span>
          </button>
        )}
        {canSplit && onSplitVertical && (
          <button
            className="flex shrink-0 items-center justify-center rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
            onClick={onSplitVertical}
            aria-label="Split vertical"
            title="竖分"
          >
            <span className="text-xs">⊞</span>
          </button>
        )}
      </div>

      {/* Settings gear icon */}
      <div className="relative ml-auto flex-shrink-0">
        <button
          onClick={onToggleSettings}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-white/10 hover:text-gray-300"
          aria-label="Terminal settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
