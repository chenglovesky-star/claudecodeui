import { useState } from 'react';
import type { ShellPresetInfo } from '../../shell/types/types';

type ShellPresetBarProps = {
  presets: ShellPresetInfo[];
  activePresetId: string | null;
  onSwitch: (presetId: string) => void;
};

export default function ShellPresetBar({
  presets,
  activePresetId,
  onSwitch,
}: ShellPresetBarProps) {
  const [selectedId, setSelectedId] = useState<string>(
    activePresetId || presets[0]?.id || '',
  );
  const [confirming, setConfirming] = useState(false);

  if (presets.length === 0) return null;

  const handleSwitch = () => {
    if (!selectedId || selectedId === activePresetId) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onSwitch(selectedId);
    setConfirming(false);
  };

  const handleCancel = () => {
    setConfirming(false);
  };

  const selectedLabel = presets.find((p) => p.id === selectedId)?.label || '';

  return (
    <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5">
      <select
        value={selectedId}
        onChange={(e) => {
          setSelectedId(e.target.value);
          setConfirming(false);
        }}
        className="rounded border border-border/60 bg-background px-2 py-1 text-xs text-foreground"
      >
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id === activePresetId ? `● ${p.label}` : p.label}
          </option>
        ))}
      </select>

      {confirming ? (
        <>
          <span className="text-xs text-amber-500">
            切换到 {selectedLabel}？会话将重启
          </span>
          <button
            onClick={handleSwitch}
            className="rounded bg-amber-600 px-2 py-0.5 text-xs text-white hover:bg-amber-700"
          >
            确认
          </button>
          <button
            onClick={handleCancel}
            className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/80"
          >
            取消
          </button>
        </>
      ) : (
        <button
          onClick={handleSwitch}
          disabled={!selectedId || selectedId === activePresetId}
          className="rounded bg-primary/90 px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary disabled:opacity-40"
        >
          切换
        </button>
      )}
    </div>
  );
}
