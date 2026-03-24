import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Project, ProjectSession } from '../../../types/app';
import Shell from '../../shell/view/Shell';
import StandaloneShellEmptyState from './subcomponents/StandaloneShellEmptyState';
import StandaloneShellHeader from './subcomponents/StandaloneShellHeader';
import ShellPresetBar from './ShellPresetBar';
import { useShellPresets } from '../hooks/useShellPresets';

type StandaloneShellProps = {
  project?: Project | null;
  session?: ProjectSession | null;
  command?: string | null;
  isPlainShell?: boolean | null;
  autoConnect?: boolean;
  onComplete?: ((exitCode: number) => void) | null;
  onClose?: (() => void) | null;
  title?: string | null;
  className?: string;
  showHeader?: boolean;
  compact?: boolean;
  minimal?: boolean;
};

export default function StandaloneShell({
  project = null,
  session = null,
  command = null,
  isPlainShell = null,
  autoConnect = true,
  onComplete = null,
  onClose = null,
  title = null,
  className = '',
  showHeader = true,
  compact = false,
  minimal = false,
}: StandaloneShellProps) {
  const [isCompleted, setIsCompleted] = useState(false);
  const wsRefFromShell = useRef<MutableRefObject<WebSocket | null> | null>(null);
  const { presets, activePresetId, switchPreset } = useShellPresets(project);

  const handleWsRef = useCallback((ref: MutableRefObject<WebSocket | null>) => {
    wsRefFromShell.current = ref;
  }, []);

  const handlePresetSwitch = useCallback((presetId: string) => {
    switchPreset(wsRefFromShell.current?.current ?? null, presetId);
  }, [switchPreset]);

  // Keep `compact` in the public API for compatibility with existing callers.
  void compact;

  const shouldUsePlainShell = isPlainShell !== null ? isPlainShell : command !== null;

  const handleProcessComplete = useCallback(
    (exitCode: number) => {
      setIsCompleted(true);
      onComplete?.(exitCode);
    },
    [onComplete],
  );

  if (!project) {
    return <StandaloneShellEmptyState className={className} />;
  }

  return (
    <div className={`flex h-full w-full flex-col ${className}`}>
      {!minimal && showHeader && title && (
        <StandaloneShellHeader title={title} isCompleted={isCompleted} onClose={onClose} />
      )}

      {presets.length > 0 && (
        <ShellPresetBar
          presets={presets}
          activePresetId={activePresetId}
          onSwitch={handlePresetSwitch}
        />
      )}

      <div className="min-h-0 w-full flex-1">
        <Shell
          selectedProject={project}
          selectedSession={session}
          initialCommand={command}
          isPlainShell={shouldUsePlainShell}
          onProcessComplete={handleProcessComplete}
          minimal={minimal}
          autoConnect={minimal ? true : autoConnect}
          onWsRef={handleWsRef}
        />
      </div>
    </div>
  );
}
