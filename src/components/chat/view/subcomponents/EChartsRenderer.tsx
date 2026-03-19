import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import {
  BarChart, LineChart, PieChart,
  ScatterChart, HeatmapChart,
  GaugeChart, RadarChart, FunnelChart,
  MapChart, SankeyChart, TreemapChart,
} from 'echarts/charts';
import {
  TitleComponent, TooltipComponent,
  LegendComponent, GridComponent,
  DataZoomComponent, ToolboxComponent,
  VisualMapComponent, GeoComponent,
} from 'echarts/components';

echarts.use([
  CanvasRenderer,
  BarChart, LineChart, PieChart, ScatterChart, HeatmapChart,
  GaugeChart, RadarChart, FunnelChart, MapChart, SankeyChart, TreemapChart,
  TitleComponent, TooltipComponent, LegendComponent, GridComponent,
  DataZoomComponent, ToolboxComponent, VisualMapComponent, GeoComponent,
]);

const MAX_OPTION_SIZE = 100 * 1024; // 100KB

const CHART_HEIGHTS: Record<string, number> = {
  line: 400,
  bar: 400,
  pie: 350,
  radar: 350,
  gauge: 300,
  heatmap: 500,
  map: 500,
  sankey: 450,
  treemap: 450,
  scatter: 400,
  funnel: 400,
};

function getChartHeight(option: Record<string, unknown>): number {
  const series = option.series;
  if (!Array.isArray(series) || series.length === 0) return 400;
  const types = series.map((s: Record<string, unknown>) => String(s.type || ''));
  const heights = types.map((t: string) => CHART_HEIGHTS[t] || 400);
  return Math.max(...heights);
}

function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

const darkTheme = {
  backgroundColor: 'transparent',
  textStyle: { color: '#e5e7eb' },
  title: { textStyle: { color: '#f3f4f6' }, subtextStyle: { color: '#9ca3af' } },
  legend: { textStyle: { color: '#d1d5db' } },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#4b5563' } },
    axisTick: { lineStyle: { color: '#4b5563' } },
    axisLabel: { color: '#9ca3af' },
    splitLine: { lineStyle: { color: '#374151' } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: '#4b5563' } },
    axisTick: { lineStyle: { color: '#4b5563' } },
    axisLabel: { color: '#9ca3af' },
    splitLine: { lineStyle: { color: '#374151' } },
  },
};

echarts.registerTheme('claudeDark', darkTheme);

interface EChartsRendererProps {
  option: string;
  isStreaming?: boolean;
}

function FallbackCodeBlock({ raw, message }: { raw: string; message: string }) {
  return (
    <div className="my-2">
      <div className="mb-1 text-xs text-amber-600 dark:text-amber-400">{message}</div>
      <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100">
        <code>{raw}</code>
      </pre>
    </div>
  );
}

function EChartsInner({ option, isStreaming }: EChartsRendererProps) {
  const { t } = useTranslation('chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isDark = useDarkMode();

  const raw = option.replace(/\n$/, '');
  const tooLarge = raw.length > MAX_OPTION_SIZE;

  // All hooks MUST be called before any conditional return (React rules of hooks)
  const parsed = useMemo(() => {
    if (tooLarge) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }, [raw, tooLarge]);

  const height = useMemo(() => (parsed ? getChartHeight(parsed) : 400), [parsed]);

  useEffect(() => {
    if (!parsed || !containerRef.current) return;

    const chart = echarts.init(
      containerRef.current,
      isDark ? 'claudeDark' : undefined,
      { renderer: 'canvas' },
    );
    chartRef.current = chart;
    chart.setOption(parsed);

    let resizeTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => chart.resize(), 100);
    });
    observer.observe(containerRef.current);

    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [parsed, isDark]);

  // Conditional returns AFTER all hooks
  if (tooLarge) {
    return <FallbackCodeBlock raw={raw} message={t('chart.tooLarge')} />;
  }

  if (!parsed) {
    if (isStreaming) {
      return (
        <div className="my-2 flex h-[200px] items-center justify-center rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t('chart.generating')}
          </div>
        </div>
      );
    }
    return <FallbackCodeBlock raw={raw} message={t('chart.renderFailed')} />;
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div ref={containerRef} style={{ width: '100%', height: `${height}px` }} />
    </div>
  );
}

export default function EChartsRenderer(props: EChartsRendererProps) {
  const { t } = useTranslation('chat');
  const raw = props.option.replace(/\n$/, '');

  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <div className="my-2">
          <div className="mb-1 text-xs text-red-600 dark:text-red-400">
            {t('chart.renderFailed')}: {error.message}
          </div>
          <pre className="mb-2 overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100">
            <code>{raw}</code>
          </pre>
          <button
            onClick={resetErrorBoundary}
            className="text-xs text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
          >
            {t('chart.retry')}
          </button>
        </div>
      )}
    >
      <EChartsInner {...props} />
    </ErrorBoundary>
  );
}
