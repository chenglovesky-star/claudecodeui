import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { TERMINAL_THEMES, DEFAULT_THEME_ID } from '../../constants/themes';

export interface TerminalSettingsValues {
  fontSize: number;
  fontFamily: string;
  themeId: string;
  scrollback: number;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
}

const DEFAULTS: TerminalSettingsValues = {
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  themeId: DEFAULT_THEME_ID,
  scrollback: 10000,
  cursorStyle: 'block',
  cursorBlink: true,
};

const FONT_FAMILIES = [
  { label: 'Menlo', value: 'Menlo, Monaco, "Courier New", monospace' },
  { label: 'Monaco', value: 'Monaco, Menlo, "Courier New", monospace' },
  { label: 'Fira Code', value: '"Fira Code", Menlo, monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", Menlo, monospace' },
  { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
];

const SCROLLBACK_OPTIONS = [1000, 5000, 10000, 50000, 100000];

const STORAGE_KEY = 'shell-terminal-settings';

export function loadTerminalSettings(): TerminalSettingsValues {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function saveTerminalSettings(settings: TerminalSettingsValues): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

type TerminalSettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange: (settings: TerminalSettingsValues) => void;
};

export default function TerminalSettings({ isOpen, onClose, onSettingsChange }: TerminalSettingsProps) {
  const [settings, setSettings] = useState<TerminalSettingsValues>(loadTerminalSettings);

  const update = useCallback(<K extends keyof TerminalSettingsValues>(key: K, value: TerminalSettingsValues[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveTerminalSettings(next);
      onSettingsChange(next);
      return next;
    });
  }, [onSettingsChange]);

  if (!isOpen) return null;

  return (
    <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">终端设置</h3>
        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        {/* Font Size */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-400">字体大小</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={24}
              value={settings.fontSize}
              onChange={(e) => update('fontSize', Number(e.target.value))}
              className="h-1 w-20 cursor-pointer"
            />
            <span className="min-w-[32px] text-right text-xs text-gray-300">{settings.fontSize}px</span>
          </div>
        </div>

        {/* Font Family */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-400">字体</label>
          <select
            value={settings.fontFamily}
            onChange={(e) => update('fontFamily', e.target.value)}
            className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.label} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        {/* Theme */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-400">主题</label>
          <select
            value={settings.themeId}
            onChange={(e) => update('themeId', e.target.value)}
            className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          >
            {TERMINAL_THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Scrollback */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-400">滚动历史</label>
          <select
            value={settings.scrollback}
            onChange={(e) => update('scrollback', Number(e.target.value))}
            className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          >
            {SCROLLBACK_OPTIONS.map((n) => (
              <option key={n} value={n}>{n.toLocaleString()} 行</option>
            ))}
          </select>
        </div>

        {/* Cursor Style */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-400">光标</label>
          <div className="flex items-center gap-2">
            <select
              value={settings.cursorStyle}
              onChange={(e) => update('cursorStyle', e.target.value as 'block' | 'underline' | 'bar')}
              className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-300"
            >
              <option value="block">Block</option>
              <option value="underline">Underline</option>
              <option value="bar">Bar</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={settings.cursorBlink}
                onChange={(e) => update('cursorBlink', e.target.checked)}
                className="h-3 w-3"
              />
              闪烁
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
