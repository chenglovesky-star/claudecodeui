# ECharts 数据可视化集成设计

## 概述

在 claudecodeui 的聊天界面中集成 Apache ECharts，实现 AI 对话中结构化数据的自动图表渲染。支持 SQL 查询结果和 AI 生成的结构化数据两种数据来源。

## 需求

- **数据来源**：SQL 工具执行结果（文本返回）+ AI 对话中的结构化数据
- **图表类型**：全面覆盖——基础（柱/线/饼）、中级（散点/热力图）、高级（仪表盘/雷达/漏斗/地图/桑基/树图）
- **触发方式**：AI 自动判断数据特征，选择最合适的图表类型，用户零干预
- **视觉风格**：跟随应用深色/浅色主题，融入对话界面

## 技术选型

**Apache ECharts**（按需引入）

选择理由：
- 图表类型最全面，满足高级可视化需求
- 中文社区和文档友好
- 支持主题定制，容易融入深色/浅色模式
- Claude 对 ECharts option 结构非常熟悉，AI 生成配置成熟可靠
- 按需引入后体积约 300-400KB gzip，通过 lazy load 不影响首屏

## 架构设计

### 数据流

```
1. 数据来源
   ├─ SQL 工具执行结果（文本表格/JSON）
   └─ AI 对话中的结构化数据

2. AI 处理层（Claude）
   └─ 分析数据特征 → 生成 ECharts option JSON
   └─ 输出为 ```echarts 代码块

3. 前端渲染层
   └─ Markdown.tsx 识别 ```echarts 语言标记
   └─ 解析 JSON → 传入 EChartsRenderer 组件
   └─ ECharts 渲染为交互式图表
```

### AI 输出格式

AI 在对话中输出 `echarts` 语言标记的代码块，内容为标准 ECharts option JSON：

````markdown
根据查询结果，销售数据如下：

```echarts
{
  "title": { "text": "月度销售趋势" },
  "xAxis": { "type": "category", "data": ["1月","2月","3月","4月"] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "line", "data": [820, 932, 901, 1290] }]
}
```

从图表可以看出，4月销售额显著增长...
````

## 组件设计

### 文件结构

```
src/components/chat/view/subcomponents/
├── Markdown.tsx          ← 修改：code 组件识别 echarts 语言标记
└── EChartsRenderer.tsx   ← 新增：图表渲染组件
```

### EChartsRenderer 组件

```typescript
interface EChartsRendererProps {
  option: string;  // ECharts option JSON 字符串
}
```

```typescript
interface EChartsRendererProps {
  option: string;       // ECharts option JSON 字符串
  isStreaming?: boolean; // 消息是否仍在流式输出中
}
```

核心职责：
- **JSON 解析与安全校验**：仅使用 `JSON.parse` 解析 option 字符串。**安全红线：绝对不能使用 `eval` 或 `new Function` 解析 option**，只接受纯 JSON，不支持 JavaScript 函数表达式
- **自适应尺寸**：宽度跟随消息气泡，高度根据图表类型智能计算（混合图取最大高度值，默认 400px）
- **主题适配**：读取当前深色/浅色主题，应用对应 ECharts 主题色
- **懒加载**：`React.lazy` 加载整个 `EChartsRenderer.tsx` 文件（内部静态 import echarts），Vite 自动拆分 chunk，只一层异步
- **resize 响应**：监听容器宽度变化，自动 `chart.resize()`
- **销毁清理**：组件卸载时调用 `chart.dispose()` 防止内存泄漏
- **内置 Error Boundary**：组件内部自包含 `react-error-boundary`，单个图表崩溃不影响整条消息渲染
- **多实例安全**：同一条消息中可包含多个 `echarts` 代码块，每个独立实例化和销毁
- **option 体积上限**：JSON 字符串超过 100KB 时降级为代码块并提示
- **国际化**：降级提示文案通过 i18next 处理

### Markdown.tsx 修改

在 `code` 组件渲染逻辑中增加条件分支：

```typescript
if (language === 'echarts') {
  return (
    <Suspense fallback={<div>图表加载中...</div>}>
      <EChartsRenderer option={children} isStreaming={isStreaming} />
    </Suspense>
  )
}
// 否则走原有的 react-syntax-highlighter 逻辑
```

## ECharts 按需引入

```typescript
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

// 图表类型
import {
  BarChart, LineChart, PieChart,
  ScatterChart, HeatmapChart,
  GaugeChart, RadarChart, FunnelChart,
  MapChart, SankeyChart, TreemapChart
} from 'echarts/charts';

// 组件
import {
  TitleComponent, TooltipComponent,
  LegendComponent, GridComponent,
  DataZoomComponent, ToolboxComponent,
  VisualMapComponent, GeoComponent
} from 'echarts/components';

echarts.use([
  CanvasRenderer,
  BarChart, LineChart, PieChart, ScatterChart, HeatmapChart,
  GaugeChart, RadarChart, FunnelChart, MapChart, SankeyChart, TreemapChart,
  TitleComponent, TooltipComponent, LegendComponent, GridComponent,
  DataZoomComponent, ToolboxComponent, VisualMapComponent, GeoComponent
]);
```

体积预估：按需引入后约 180-250KB gzip，通过 React.lazy 动态加载（Vite 自动 chunk 拆分）。注意：MapChart 不含地图 GeoJSON 数据，如需中国地图等需额外引入。

## 容错与降级策略

三层降级机制：

| 层级 | 触发条件 | 降级行为 |
|------|---------|---------|
| 1 | JSON 解析失败 | 降级为语法高亮代码块 + 提示"图表渲染失败" |
| 2 | ECharts 渲染失败 | Error Boundary 捕获，降级为代码块 + 错误提示 |
| 3 | ECharts 库加载失败 | Suspense fallback 显示加载中，超时后降级为代码块 |

## 流式渲染处理

流式场景下依赖两层机制：

1. **react-markdown 解析行为**：未闭合的代码块不会生成 code 节点，因此天然不会触发 EChartsRenderer。流式期间用户看到的是原始文本逐步输出，闭合后 react-markdown 重新解析才会生成图表组件。

2. **组件内容错处理**：如果 react-markdown 在某些情况下将未闭合的代码块也输出为 code 节点，EChartsRenderer 内部处理：
   - `JSON.parse` 失败 + `isStreaming === true` → 显示 "图表生成中..." 加载占位符
   - `JSON.parse` 失败 + `isStreaming === false` → 降级为代码块 + 错误提示
   - `JSON.parse` 成功 → 正常渲染图表

## 尺寸策略

| 图表类型 | 默认高度 | 说明 |
|---------|---------|------|
| 折线图/柱状图 | 400px | 标准宽高比 |
| 饼图/雷达图 | 350px | 正方形更美观 |
| 仪表盘 | 300px | 紧凑型 |
| 热力图/地图 | 500px | 需要更大空间 |
| 桑基图/树图 | 450px | 复杂数据需要空间 |

## 改动范围

- **安装依赖**：`echarts`（按需引入）
- **新增 1 个文件**：`EChartsRenderer.tsx`
- **修改 1 个文件**：`Markdown.tsx`（加一个 if 分支）
- **AI 端**：输出 ` ```echarts ` 代码块即可触发渲染

对现有代码侵入性低，改动面小。
