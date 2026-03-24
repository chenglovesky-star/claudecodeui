import { useCallback, useRef } from 'react';

export type SplitLayout =
  | { type: 'single'; sessionId: string }
  | { type: 'horizontal-2'; left: string; right: string; ratio: number }
  | { type: 'vertical-2'; top: string; bottom: string; ratio: number }
  | {
      type: 'grid-4';
      topLeft: string;
      topRight: string;
      bottomLeft: string;
      bottomRight: string;
      hRatio: number;
      vRatio: number;
    };

type SplitPaneManagerProps = {
  layout: SplitLayout;
  onLayoutChange: (layout: SplitLayout) => void;
  renderPane: (sessionId: string, isActive: boolean) => React.ReactNode;
  activeSessionId: string | null;
  onPaneClick: (sessionId: string) => void;
};

function updateRatio(
  layout: SplitLayout,
  axis: 'horizontal' | 'vertical',
  ratio: number,
): SplitLayout {
  if (layout.type === 'horizontal-2' && axis === 'horizontal') {
    return { ...layout, ratio };
  }
  if (layout.type === 'vertical-2' && axis === 'vertical') {
    return { ...layout, ratio };
  }
  if (layout.type === 'grid-4') {
    if (axis === 'horizontal') return { ...layout, hRatio: ratio };
    return { ...layout, vRatio: ratio };
  }
  return layout;
}

export default function SplitPaneManager({
  layout,
  onLayoutChange,
  renderPane,
  activeSessionId,
  onPaneClick,
}: SplitPaneManagerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDrag = useCallback(
    (axis: 'horizontal' | 'vertical', e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();

      const onMouseMove = (moveEvent: MouseEvent) => {
        const currentPos =
          axis === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
        const startEdge = axis === 'horizontal' ? rect.left : rect.top;
        const totalSize = axis === 'horizontal' ? rect.width : rect.height;
        let ratio = (currentPos - startEdge) / totalSize;
        ratio = Math.max(0.2, Math.min(0.8, ratio));

        onLayoutChange(updateRatio(layout, axis, ratio));
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor =
        axis === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [layout, onLayoutChange],
  );

  // Helper to render a single pane with click handler and active border
  const pane = (sessionId: string) => (
    <div
      key={sessionId}
      className={`relative overflow-hidden ${
        sessionId === activeSessionId ? 'ring-1 ring-indigo-500/50' : ''
      }`}
      style={{ flex: 1 }}
      onClick={() => onPaneClick(sessionId)}
    >
      {renderPane(sessionId, sessionId === activeSessionId)}
    </div>
  );

  // Divider component
  const divider = (axis: 'horizontal' | 'vertical', key?: string) => (
    <div
      key={key}
      className={`flex-shrink-0 ${
        axis === 'horizontal'
          ? 'w-1 cursor-col-resize hover:bg-indigo-500/50'
          : 'h-1 cursor-row-resize hover:bg-indigo-500/50'
      } bg-gray-700 transition-colors`}
      onMouseDown={(e) => handleDrag(axis, e)}
    />
  );

  return (
    <div ref={containerRef} className="flex h-full w-full">
      {layout.type === 'single' && pane(layout.sessionId)}

      {layout.type === 'horizontal-2' && (
        <div className="flex h-full w-full">
          <div style={{ flex: layout.ratio }}>{pane(layout.left)}</div>
          {divider('horizontal')}
          <div style={{ flex: 1 - layout.ratio }}>{pane(layout.right)}</div>
        </div>
      )}

      {layout.type === 'vertical-2' && (
        <div className="flex h-full w-full flex-col">
          <div style={{ flex: layout.ratio }}>{pane(layout.top)}</div>
          {divider('vertical')}
          <div style={{ flex: 1 - layout.ratio }}>{pane(layout.bottom)}</div>
        </div>
      )}

      {layout.type === 'grid-4' && (
        <div className="flex h-full w-full flex-col">
          <div className="flex" style={{ flex: layout.vRatio }}>
            <div style={{ flex: layout.hRatio }}>
              {pane(layout.topLeft)}
            </div>
            {divider('horizontal', 'h-top')}
            <div style={{ flex: 1 - layout.hRatio }}>
              {pane(layout.topRight)}
            </div>
          </div>
          {divider('vertical', 'v-mid')}
          <div className="flex" style={{ flex: 1 - layout.vRatio }}>
            <div style={{ flex: layout.hRatio }}>
              {pane(layout.bottomLeft)}
            </div>
            {divider('horizontal', 'h-bottom')}
            <div style={{ flex: 1 - layout.hRatio }}>
              {pane(layout.bottomRight)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
