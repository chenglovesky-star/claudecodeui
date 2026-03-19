# ECharts 数据可视化集成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 claudecodeui 聊天界面中集成 ECharts，使 AI 输出的 `echarts` 代码块自动渲染为交互式图表。

**Architecture:** 在 Markdown 渲染管道的 `CodeBlock` 组件中识别 `echarts` 语言标记，将内容传入新建的 `EChartsRenderer` 组件。ECharts 按需引入并通过 `React.lazy` 懒加载，不影响首屏性能。组件自带 Error Boundary，单个图表崩溃不影响整条消息。

**Tech Stack:** React 18, Apache ECharts (按需引入), react-error-boundary, i18next, Tailwind CSS, Vite

**Spec:** `docs/superpowers/specs/2026-03-19-echarts-data-visualization-design.md`

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| 新增 | `src/components/chat/view/subcomponents/EChartsRenderer.tsx` | ECharts 图表渲染组件（含 Error Boundary、主题适配、resize 监听） |
| 修改 | `src/components/chat/view/subcomponents/Markdown.tsx` | CodeBlock 中增加 echarts 语言识别分支 |
| 修改 | `src/components/chat/view/subcomponents/MessageComponent.tsx` | 向 Markdown 组件传递 isStreaming 属性 |
| 修改 | `src/i18n/locales/en/chat.json` | 添加图表相关英文文案 |
| 修改 | `src/i18n/locales/zh-CN/chat.json` | 添加图表相关中文文案 |
| 修改 | `src/i18n/locales/ja/chat.json` | 添加图表相关日文文案 |
| 修改 | `src/i18n/locales/ko/chat.json` | 添加图表相关韩文文案 |
| 修改 | `package.json` | 添加 echarts 依赖 |

---

### Task 1: 安装 ECharts 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 echarts**

```bash
cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui
npm install echarts
```

- [ ] **Step 2: 验证安装成功**

```bash
node -e "import('echarts/core').then(() => console.log('echarts OK'))"
```
Expected: 输出 `echarts OK`（项目使用 ESM，需要用 `import()` 而非 `require()`）

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add echarts dependency for data visualization"
```

---

### Task 2: 添加 i18n 文案

**Files:**
- Modify: `src/i18n/locales/en/chat.json`
- Modify: `src/i18n/locales/zh-CN/chat.json`
- Modify: `src/i18n/locales/ja/chat.json`
- Modify: `src/i18n/locales/ko/chat.json`

- [ ] **Step 1: 在 en/chat.json 中添加图表文案**

在 `codeBlock` 后添加新的 `chart` 对象：

```json
"chart": {
  "loading": "Loading chart...",
  "generating": "Generating chart...",
  "renderFailed": "Chart rendering failed, showing raw config",
  "tooLarge": "Chart data too large, showing raw config",
  "retry": "Retry"
}
```

- [ ] **Step 2: 在 zh-CN/chat.json 中添加图表文案**

```json
"chart": {
  "loading": "图表加载中...",
  "generating": "图表生成中...",
  "renderFailed": "图表渲染失败，显示原始配置",
  "tooLarge": "图表数据过大，显示原始配置",
  "retry": "重试"
}
```

- [ ] **Step 3: 在 ja/chat.json 中添加图表文案**

```json
"chart": {
  "loading": "チャートを読み込み中...",
  "generating": "チャートを生成中...",
  "renderFailed": "チャートのレンダリングに失敗しました。元の設定を表示します",
  "tooLarge": "チャートデータが大きすぎます。元の設定を表示します",
  "retry": "再試行"
}
```

- [ ] **Step 4: 在 ko/chat.json 中添加图表文案**

```json
"chart": {
  "loading": "차트 로딩 중...",
  "generating": "차트 생성 중...",
  "renderFailed": "차트 렌더링 실패, 원본 설정 표시",
  "tooLarge": "차트 데이터가 너무 큽니다. 원본 설정 표시",
  "retry": "다시 시도"
}
```

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/
git commit -m "feat: add chart i18n messages for en, zh-CN, ja, ko"
```

---

### Task 3: 创建 EChartsRenderer 组件

**Files:**
- Create: `src/components/chat/view/subcomponents/EChartsRenderer.tsx`

- [ ] **Step 1: 创建 EChartsRenderer.tsx**

注意以下关键设计决策（来自评审反馈）：
- **C1 修复**: 所有 Hooks 必须在条件返回之前无条件调用，条件判断放在 Hooks 之后
- **C2 修复**: 使用 `MutationObserver` 响应式检测深色/浅色主题切换
- **I2 修复**: ErrorBoundary 使用 `fallbackRender` 以传递原始 option 显示降级代码块
- **S1 修复**: Retry 按钮使用 i18n
- **S3 修复**: ResizeObserver 添加防抖

```typescript
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
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui
npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: 无 EChartsRenderer 相关错误

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/view/subcomponents/EChartsRenderer.tsx
git commit -m "feat: add EChartsRenderer component with lazy loading and error boundary"
```

---

### Task 4: 修改 Markdown.tsx 集成 EChartsRenderer

**Files:**
- Modify: `src/components/chat/view/subcomponents/Markdown.tsx:1-158`

- [ ] **Step 1: 在 Markdown.tsx 中添加 lazy import 和 Suspense**

在文件顶部 import 区域添加：

```typescript
import React, { useMemo, useState, Suspense, lazy } from 'react';
```

（替换原来的 `import React, { useMemo, useState } from 'react';`）

在 import 区域末尾添加懒加载：

```typescript
const EChartsRenderer = lazy(() => import('./EChartsRenderer'));
```

- [ ] **Step 2: 修改 MarkdownProps 增加 isStreaming**

```typescript
type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  isStreaming?: boolean;
};
```

- [ ] **Step 3: 在 CodeBlock 中添加 echarts 识别逻辑**

在 `CodeBlock` 组件中，在 `const language = match ? match[1] : 'text';` 这一行之后，`return (` 之前，添加 echarts 分支：

```typescript
  const language = match ? match[1] : 'text';

  if (language === 'echarts') {
    return (
      <Suspense
        fallback={
          <div className="my-2 flex h-[200px] items-center justify-center rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('chart.loading')}</span>
          </div>
        }
      >
        <EChartsRenderer option={raw} />
      </Suspense>
    );
  }

  return (
```

注意：需要从外部闭包获取 `isStreaming` 属性。由于 `CodeBlock` 目前是独立组件，需要通过 `markdownComponents` 的工厂函数来传递 `isStreaming`。

- [ ] **Step 4: 将 markdownComponents 改为工厂函数以传递 isStreaming**

将 `const markdownComponents = { ... }` 改为：

```typescript
function createMarkdownComponents(isStreaming?: boolean) {
  return {
    code: (props: CodeBlockProps) => <CodeBlock {...props} isStreaming={isStreaming} />,
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="my-2 border-l-4 border-gray-300 pl-4 italic text-gray-600 dark:border-gray-600 dark:text-gray-400">
        {children}
      </blockquote>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} className="text-blue-600 hover:underline dark:text-blue-400" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="my-2 overflow-x-auto">
        <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="border border-gray-200 px-3 py-2 text-left text-sm font-semibold dark:border-gray-700">{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="border border-gray-200 px-3 py-2 align-top text-sm dark:border-gray-700">{children}</td>
    ),
  };
}
```

- [ ] **Step 5: 更新 CodeBlockProps 和 CodeBlock 接受 isStreaming**

```typescript
type CodeBlockProps = {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  isStreaming?: boolean;
};

const CodeBlock = ({ node, inline, className, children, isStreaming, ...props }: CodeBlockProps) => {
```

在 echarts 分支中传递 isStreaming：

```typescript
  if (language === 'echarts') {
    return (
      <Suspense
        fallback={
          <div className="my-2 flex h-[200px] items-center justify-center rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('chart.loading')}</span>
          </div>
        }
      >
        <EChartsRenderer option={raw} isStreaming={isStreaming} />
      </Suspense>
    );
  }
```

- [ ] **Step 6: 更新 Markdown 导出组件使用工厂函数**

```typescript
export function Markdown({ children, className, isStreaming }: MarkdownProps) {
  const content = normalizeInlineCodeFences(String(children ?? ''));
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);
  const components = useMemo(() => createMarkdownComponents(isStreaming), [isStreaming]);

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 7: 验证编译**

```bash
cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui
npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: 无 Markdown.tsx 相关错误

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/view/subcomponents/Markdown.tsx
git commit -m "feat: integrate EChartsRenderer into Markdown code block pipeline"
```

---

### Task 5: 在 MessageComponent 中传递 isStreaming

**Files:**
- Modify: `src/components/chat/view/subcomponents/MessageComponent.tsx`

- [ ] **Step 1: 找到所有 Markdown 组件的使用处并传递 isStreaming**

在 `MessageComponent.tsx` 中，找到所有 `<Markdown>` 标签，为 assistant 类型消息添加 `isStreaming` 属性。

文件中有 4 处 `<Markdown>` 使用，但只有 **1 处**需要传递 `isStreaming`——assistant 消息的主内容渲染（约 line 466），因为只有这里会包含 `echarts` 代码块：

```typescript
<Markdown className="prose prose-sm prose-gray max-w-none dark:prose-invert" isStreaming={message.isStreaming}>
  {content}
</Markdown>
```

其他 3 处（displayText/error/thinking）不会包含 echarts 代码块，无需修改。

- [ ] **Step 2: 验证编译**

```bash
cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui
npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/view/subcomponents/MessageComponent.tsx
git commit -m "feat: pass isStreaming to Markdown for echarts streaming support"
```

---

### Task 6: 构建验证与手动测试

**Files:** 无新增文件

- [ ] **Step 1: 执行完整构建**

```bash
cd /Users/apple/Desktop/iflytek/claudecide/claudecodeui
npm run build
```
Expected: 构建成功，无错误

- [ ] **Step 2: 验证 ECharts chunk 被正确拆分**

```bash
ls -la dist/assets/ | grep -i echart
```
Expected: 看到独立的 echarts chunk 文件

- [ ] **Step 3: 运行 lint 检查**

```bash
npm run lint
```
Expected: 无新的 lint 错误

- [ ] **Step 4: 启动开发服务器手动测试**

```bash
npm run dev
```

在对话中让 AI 输出以下内容来验证图表渲染：

````
```echarts
{
  "title": { "text": "测试图表" },
  "xAxis": { "type": "category", "data": ["A", "B", "C", "D"] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "bar", "data": [10, 20, 30, 40] }]
}
```
````

验证项：
- 图表正常渲染为柱状图
- 深色模式下主题正确
- 窗口缩放时图表自适应
- 无效 JSON 显示降级代码块

- [ ] **Step 5: Commit 最终状态（如有 lint 修复）**

```bash
git add -A
git commit -m "feat: complete echarts data visualization integration"
```
