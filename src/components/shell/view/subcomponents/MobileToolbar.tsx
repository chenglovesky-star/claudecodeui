import { type MutableRefObject, useCallback } from 'react';
import type { Terminal } from '@xterm/xterm';
import { sendSocketMessage } from '../../utils/socket';

type MobileToolbarProps = {
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  isConnected: boolean;
};

const KEYS = [
  { label: 'Tab', sequence: '\t' },
  { label: 'Esc', sequence: '\x1b' },
  { label: '\u2191', sequence: '\x1b[A' },
  { label: '\u2193', sequence: '\x1b[B' },
  { label: 'Ctrl', sequence: null }, // special: toggles ctrl mode
] as const;

export default function MobileToolbar({ wsRef, terminalRef, isConnected }: MobileToolbarProps) {
  const sendInput = useCallback(
    (data: string) => {
      sendSocketMessage(wsRef.current, { type: 'input', data });
      // refocus terminal after button press
      terminalRef.current?.focus();
    },
    [wsRef, terminalRef],
  );

  if (!isConnected) return null;

  return (
    <div className="flex items-center gap-1.5 border-t border-gray-700 bg-[#252526] px-2 py-1.5 md:hidden">
      {KEYS.map((key) => (
        <button
          key={key.label}
          type="button"
          onClick={() => key.sequence && sendInput(key.sequence)}
          className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 active:bg-gray-600"
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
