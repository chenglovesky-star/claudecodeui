---
name: dual-sql
description: "双 Agent SQL 交叉验证。收到数据查询需求时使用：两个 subagent 从零开始独立搜索表、查结构、写 SQL、执行，主 Agent 比对结果，一致才展示给用户。适用于需要高可信度的数据查询场景。"
---

# 双 Agent SQL 交叉验证

## 触发方式

- 用户输入 `/dual-sql <需求描述>`
- CLAUDE.md 规则自动提示调用

## 核心原则

**两个 subagent 必须完全独立工作**：各自调用 MCP 工具搜索表、查看表结构、查枚举、写 SQL、执行 SQL。主 Agent 不预查表结构，不提供具体表名或字段信息，只提供原始需求、记忆中的通用知识和 SQL 规范。

## 工作流程

### 第一阶段：准备轻量上下文（主 Agent 执行）

主 Agent 只做以下事情，**不调用任何 MCP 搜索/查表工具**：

1. **读取记忆（三级降级）**：
   - **优先级 1：用户工作区记忆** — 尝试读 `./memory/MEMORY.md` 和 `./memory/general.md`
   - **优先级 2：内置默认记忆** — 如果用户工作区无记忆文件，读取本技能同目录下的 `memory/MEMORY.md` 和 `memory/general.md`（内置开箱即用知识）
   - **优先级 3：无记忆降级** — 如果两者都不存在，跳过记忆注入，仅使用下方的通用注意事项和 SQL 规范

2. **读取场景记忆（可选）** — 如果关键词命中了场景文件（scene_*.md），按同样的三级优先级读取，提取**通用注意事项**（如 tags 提取方式），但**不提供具体表名和字段**

3. **组装 subagent prompt** — 只包含：
   - 用户原始需求（原文）
   - 通用注意事项（来自记忆）
   - SQL 编码规范
   - MCP 工具使用指南
   - 输出格式要求

### 内置通用注意事项（无记忆时的最低保障）

以下知识在没有任何记忆文件时也会注入 subagent：

- executeQuery **禁止使用** `--` 注释，会报错，必须去掉所有 SQL 注释
- tags 提取用 `ifly_map_get(tags, 'key_name')`，tags_json 不可靠
- 亿级大表 join 会被 Kyuubi kill，需按 uid 前缀分片（单片≤300万）
- Catalogs：`default_catalog`、`paimon`、`hive`
- 日期分区字段通常为 `dt` 或 `proc_date`，格式 yyyymmdd

### 第二阶段：并行派发（两个 subagent）

使用 Agent 工具在**同一条消息**中并行派发两个 subagent（subagent_type: "general-purpose"），prompt 模板如下：

```
你是一个数据分析 SQL 专家。你需要根据需求，自主使用 MCP 工具完成从表搜索到 SQL 执行的完整流程。

【需求】
{用户原始需求，原文粘贴}

【MCP 工具使用指南】
你可以使用以下 MCP 工具，请按需自主调用：
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
{从记忆中提取的通用知识，若无记忆则使用内置通用注意事项}

【SQL 编码规范】
- 必须使用 CTE（WITH ... AS）结构，禁止嵌套子查询
- UV 口径：先按 uid 分组聚合，再汇总计数，禁止顶层直接 COUNT(DISTINCT uid)
- 分区裁剪：必须显式过滤分区字段
- 数值精度：ROUND(x, 2)
- 最终结果必须 ORDER BY
- PV 计算：GROUP BY 聚合配合 COUNT(1)

【你的工作步骤】
1. 分析需求，识别需要哪些数据
2. 使用 searchSqlGuides 搜索是否有参考 SQL
3. 使用 searchTables / searchTablesByColumn 搜索相关表
4. 使用 describeTable 查看表结构，确认字段和分区
5. 如需要，使用 searchEnumByColumn 确认枚举值
6. 编写 SQL
7. 使用 executeQuery 执行（maxRows 按需设置）
8. 如果执行失败，分析错误并修正 SQL 重试（最多 2 次）

【输出格式】
最终返回时，严格按以下格式输出：

--- SQL ---
{最终执行成功的完整 SQL}
--- RESULT ---
{执行结果的完整 JSON，包含 columns 和 rows}
--- COLUMNS ---
{列名列表，逗号分隔}
--- ROW_COUNT ---
{结果行数}
```

**关键：两个 subagent 只收到原始需求和通用规范，不收到任何预查的表结构或字段信息，必须各自独立完成全部 MCP 搜索和探索工作。**

### 第三阶段：结果比对（主 Agent 执行）

从两个 subagent 返回中提取 SQL 和结果，执行严格比对：

1. **列名一致** — 两份结果的列名集合必须相同（忽略中英文别名差异，按位置对应比对值）
2. **行数一致** — 行数必须完全相同
3. **数据一致** — 按第一列排序对齐后，每行每列的值必须完全相同

**比对结果处理：**

- **一致** → 进入第五阶段（展示）
- **不一致** → 进入第四阶段（仲裁）

### 第四阶段：仲裁重试（最多 3 轮）

当结果不一致时：

1. **差异分析** — 主 Agent 对比两份 SQL，找出差异点：
   - 表选择不同？
   - 过滤条件不同？
   - 聚合口径不同？
   - JOIN 逻辑不同？

2. **口径纠正** — 主 Agent 根据记忆、业务逻辑判断正确口径，必要时自己调用 MCP 验证

3. **重新派发** — 在原 prompt 基础上追加口径纠正说明，重新并行派发两个 subagent：
   ```
   【口径纠正 - 第 N 轮】
   上一轮两个 Agent 的 SQL 存在以下差异：
   {差异描述}

   正确口径应为：
   {纠正说明}

   请严格按照以上口径，重新自主搜索表结构并生成 SQL。
   ```

4. **重复比对** — 回到第三阶段

5. **超过 3 轮仍不一致** — 展示两份 SQL + 结果 + 差异分析，让用户决定：
   ```
   经过 3 轮验证，两个 Agent 的结果仍存在差异：

   【差异点】{差异描述}

   【Agent A 的 SQL】{sql_a}
   【Agent A 的结果】{result_a}

   【Agent B 的 SQL】{sql_b}
   【Agent B 的结果】{result_b}

   请选择采用哪份结果，或提供进一步说明。
   ```

### 第五阶段：展示结果

向用户展示：

1. **验证状态** — "双 Agent 验证通过（第 N 轮一致）"
2. **两份 SQL 对比** — 展示两个 Agent 各自的 SQL，让用户看到独立探索的路径差异
3. **执行结果** — 格式化表格展示
4. **查询口径说明** — 关键筛选条件和业务逻辑说明

### 第六阶段：记忆评估

按 CLAUDE.md 中的记忆管理规范执行记忆评估。

## 注意事项

- subagent 必须使用 `subagent_type: "general-purpose"` 以获得 MCP 工具访问权限
- 两个 subagent 必须在**同一条消息**中并行派发（不是顺序执行）
- **主 Agent 在第一阶段禁止调用 MCP 搜索/查表工具**，这是为了确保两个 subagent 的独立性
- subagent prompt 中**不包含任何具体表名、字段名、表结构**，只有原始需求和通用规范
- 仲裁阶段主 Agent 可以调用 MCP 工具验证口径，但纠正说明只描述业务口径，不直接给出 SQL
