import { type MutableRefObject, useCallback } from 'react';
import type { Terminal } from '@xterm/xterm';
import { sendSocketMessage } from '../../utils/socket';

const SHORTCUTS = [
  { id: 'escape', label: 'Esc', sequence: '\x1b' },
  { id: 'tab', label: 'Tab', sequence: '\t' },
  { id: 'shift-tab', label: '\u21e7Tab', sequence: '\x1b[Z' },
  { id: 'arrow-up', label: '\u2191', sequence: '\x1b[A' },
  { id: 'arrow-down', label: '\u2193', sequence: '\x1b[B' },
] as const;

type TerminalShortcutsPanelProps = {
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  isConnected: boolean;
};

const preventFocusSteal = (e: React.PointerEvent) => e.preventDefault();

export default function TerminalShortcutsPanel({
  wsRef,
  terminalRef,
  isConnected,
}: TerminalShortcutsPanelProps) {
  const sendInput = useCallback(
    (data: string) => {
      sendSocketMessage(wsRef.current, { type: 'input', data });
    },
    [wsRef],
  );

  const scrollToBottom = useCallback(() => {
    terminalRef.current?.scrollToBottom();
  }, [terminalRef]);

  if (!isConnected) return null;

  return (
    <div
      className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-gray-700/50 bg-gray-800/90 px-2 py-1 backdrop-blur-sm"
      onPointerDown={preventFocusSteal}
    >
      {SHORTCUTS.map((shortcut) => (
        <button
          type="button"
          key={shortcut.id}
          onClick={() => sendInput(shortcut.sequence)}
          className="rounded px-2 py-0.5 text-xs text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
          title={shortcut.label}
        >
          {shortcut.label}
        </button>
      ))}
      <div className="mx-0.5 h-4 w-px bg-gray-700/50" />
      <button
        type="button"
        onClick={scrollToBottom}
        className="rounded px-2 py-0.5 text-xs text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
        title="Scroll to bottom"
      >
        ⤓
      </button>
    </div>
  );
}
