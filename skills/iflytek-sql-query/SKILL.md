---
name: iflytek-sql-query
description: "讯飞数据仓库 SQL 查询全流程。收到任何数据查询需求时使用（如'查一下UV'、'统计xxx'、'帮我跑个数'）。核心机制：双 Agent 交叉验证（两个 subagent 独立搜索表、查结构、写 SQL、执行，主 Agent 比对结果一致才展示）。内置 SQL 编码规范、MCP 工具指南、本地记忆管理。适用：埋点分析、用户画像、业务指标统计等讯飞数据仓库查询场景。替代 dual-sql skill。"
---

# 讯飞数据仓库 SQL 查询

## 核心原则

**双 Agent 交叉验证**：两个 subagent 完全独立工作，各自调用 MCP 工具搜索表、查结构、写 SQL、执行。主 Agent 不预查表结构，不提供具体表名或字段，只提供原始需求、记忆中的通用知识和 SQL 规范。

## 工作流程

### 第一阶段：准备轻量上下文（主 Agent）

主 Agent **不调用任何 MCP 搜索/查表工具**，只做：

1. **初始化记忆目录** — 检查当前项目根目录是否存在 `./memory/MEMORY.md`，不存在则按 [memory-guide.md](references/memory-guide.md) 中的模板自动创建
2. **读取记忆** — 读 `./memory/MEMORY.md` 和 `./memory/general.md`，提取通用知识（工具限制、性能陷阱）
3. **读取场景记忆（可选）** — 关键词命中业务文件时，读对应 `biz_*.md` 获取**通用注意事项**，但**不提供具体表名和字段**
4. **组装 subagent prompt** — 参见下方模板

### 第二阶段：并行派发（两个 subagent）

使用 Agent 工具在**同一条消息**中并行派发两个 subagent（subagent_type: "general-purpose"）。

**subagent prompt 模板：**

```
你是一个数据分析 SQL 专家。根据需求，自主使用 MCP 工具完成从表搜索到 SQL 执行的完整流程。

【需求】
{用户原始需求，原文粘贴}

【MCP 工具】
按需自主调用：
1. mcp__iflytek-sql-gateway__searchSqlGuides(keyword) — 搜索 SQL 知识库，优先调用
2. mcp__iflytek-sql-gateway__searchTables(keyword, catalog?, database?) — 按关键词搜索表
3. mcp__iflytek-sql-gateway__searchTablesByColumn(keyword) — 按字段关键词搜索表
4. mcp__iflytek-sql-gateway__searchTablesByEnum(keyword) — 按枚举含义反查表和字段
5. mcp__iflytek-sql-gateway__describeTable(tableName, database, catalog) — 查看表结构
6. mcp__iflytek-sql-gateway__searchEnumByColumn(tableName, database, catalog, columnName) — 查看字段枚举值
7. mcp__iflytek-sql-gateway__executeQuery(sql, maxRows) — 执行 SQL（仅 SELECT，最大 5000 行）

【数据仓库环境】
- Catalogs：default_catalog、paimon、hive
- 日期分区字段：通常为 dt 或 proc_date，格式 yyyymmdd
- 执行引擎：Flink SQL 语法兼容

【通用注意事项】
{从记忆中提取的通用知识，例如：}
- executeQuery 禁止使用 -- 注释，会报错
- tags 提取用 ifly_map_get(tags, 'key_name')，tags_json 不可靠
- 亿级大表 join 注意性能，需按 uid 前缀分片

【SQL 编码规范（强制）】
- 必须使用 CTE（WITH ... AS）结构，禁止嵌套子查询
- UV 口径：先按 uid 分组聚合，再汇总计数，禁止顶层直接 COUNT(DISTINCT uid)
- 分区裁剪：必须显式过滤分区字段
- 数值精度：ROUND(x, 2)
- 最终结果必须 ORDER BY
- PV 计算：GROUP BY 聚合配合 COUNT(1)
- SQL 中禁止使用 -- 注释

【工作步骤】
1. 分析需求，识别需要哪些数据
2. 使用 searchSqlGuides 搜索是否有参考 SQL
3. 使用 searchTables / searchTablesByColumn 搜索相关表
4. 使用 describeTable 查看表结构，确认字段和分区
5. 如需要，使用 searchEnumByColumn 确认枚举值
6. 编写 SQL（严格遵循编码规范）
7. 使用 executeQuery 执行（maxRows 按需设置）
8. 执行失败则分析错误并修正重试（最多 2 次）

【输出格式】
严格按以下格式输出：

--- SQL ---
{最终执行成功的完整 SQL}
--- RESULT ---
{执行结果的完整 JSON，包含 columns 和 rows}
--- COLUMNS ---
{列名列表，逗号分隔}
--- ROW_COUNT ---
{结果行数}
```

**关键：subagent 只收到原始需求和通用规范，不收到任何预查的表结构或字段信息。**

### 第三阶段：结果比对（主 Agent）

从两个 subagent 返回中提取 SQL 和结果，严格比对：

1. **列名一致** — 列名集合相同（忽略中英文别名差异，按位置对应比对值）
2. **行数一致** — 行数完全相同
3. **数据一致** — 按第一列排序对齐后，每行每列值完全相同

- **一致** → 进入第五阶段（展示）
- **不一致** → 进入第四阶段（仲裁）

### 第四阶段：仲裁重试（最多 3 轮）

1. **差异分析** — 对比两份 SQL，找出差异点（表选择、过滤条件、聚合口径、JOIN 逻辑）
2. **口径纠正** — 根据记忆和业务逻辑判断正确口径，必要时调用 MCP 验证
3. **重新派发** — 追加口径纠正说明后重新并行派发
4. 回到第三阶段比对
5. **超过 3 轮** — 展示两份 SQL + 结果 + 差异分析，让用户决定

### 第五阶段：展示结果

1. **验证状态** — "双 Agent 验证通过（第 N 轮一致）"
2. **两份 SQL 对比** — 展示两个 Agent 各自的 SQL
3. **执行结果** — 格式化表格
4. **查询口径说明** — 关键筛选条件和业务逻辑

### 第六阶段：记忆评估

查询完成后评估是否有可复用经验。详见 [memory-guide.md](references/memory-guide.md)。

- **无需记录** — 回复末尾简要说明原因
- **需要记录** — 使用 AskUserQuestion 弹出选项：
  1. 写入本地记忆 + 同步到中心（saveSqlGuide）
  2. 仅写入本地记忆
  3. 跳过
  4. 修改后写入

## 注意事项

- subagent 使用 `subagent_type: "general-purpose"` 获得 MCP 工具访问权限
- 两个 subagent 必须在**同一条消息**中并行派发
- **主 Agent 在第一阶段禁止调用 MCP 搜索/查表工具**
- subagent prompt 中**不包含任何具体表名、字段名、表结构**
- 仲裁阶段主 Agent 可调用 MCP 验证口径，但纠正说明只描述业务口径，不直接给 SQL

## 详细参考

- [SQL 编码规范 + 常用模板](references/sql-standards.md)
- [MCP 工具详细指南](references/mcp-tools.md)
- [记忆管理规范](references/memory-guide.md) — 记忆目录初始化、文件分类、读写规则
