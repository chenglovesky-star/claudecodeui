import { useCallback, useEffect, useState } from 'react';
import type { ShellPresetInfo } from '../../shell/types/types';
import { authenticatedFetch } from '../../../utils/api';

export function useShellPresets() {
  const [presets, setPresets] = useState<ShellPresetInfo[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await authenticatedFetch('/api/system/shell-presets');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setPresets(data.presets || []);
      } catch {
        setPresets([]);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const switchPreset = useCallback(
    (ws: WebSocket | null, presetId: string) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'switch-preset', presetId }));
      setActivePresetId(presetId);
    },
    [],
  );

  return { presets, activePresetId, setActivePresetId, switchPreset };
}
