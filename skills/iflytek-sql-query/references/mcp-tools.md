# MCP 工具详细指南

## 数据仓库环境

- **Catalogs**：`default_catalog`、`paimon`、`hive`
- **日期分区字段**：通常为 `dt` 或 `proc_date`，格式 `yyyymmdd`
- **执行引擎**：Flink SQL 语法兼容

## 核心工具

### searchSqlGuides(keyword)
搜索 SQL 知识库，查看是否有现成参考 SQL。**优先调用**，避免重复造轮子。

### searchTables(keyword, catalog?, database?)
按业务关键词搜索表。支持 catalog/database 过滤缩小范围。

### searchTablesByColumn(keyword)
按字段关键词搜索表。适用于知道字段名但不确定在哪张表的场景。

### searchTablesByEnum(keyword)
按枚举含义反查表和字段。适用于知道业务含义但不确定字段名的场景。

### describeTable(tableName, database, catalog)
查看表结构（字段名、类型、注释）。**表结构不存本地**，每次实时查询。

### searchEnumByColumn(tableName, database, catalog, columnName)
查看字段枚举值及业务含义。注意：画像标签枚举查询时 columnName 传标签 key（如 `191624`），不是 `content`。

### executeQuery(sql, maxRows)
执行 SQL。仅支持 SELECT，最大 5000 行。
**重要**：SQL 中禁止使用 `--` 注释，否则报"不允许执行修改数据的操作"错误。

## 操作码工具（涉及 opcode 查询时必须使用）

### searchOpcodes(keyword)
按关键词搜索操作码。适用于不确定 opcode 编号、需要探索某业务场景对应哪个 opcode 时。

### describeOpcode(opcode)
查看单个操作码的详情：是否有效、关联业务场景、常用 tags 字段。
**重要：凡需求涉及操作码，必须先调用此工具验证 opcode 当前是否仍然有效（约每半年迭代一次）。**

### searchOpcodesByColumn(columnName)
按字段名反查关联该字段的操作码列表。适用于知道 tags 字段名但不知对应哪个 opcode 时。

### searchOpcodesByEnum(keyword)
按枚举含义反查操作码。适用于知道业务行为描述但不知 opcode 编号时。

## 辅助工具

### showPartitions(tableName, database, catalog)
查看表分区列表，确认最新分区日期。

### listCatalogs / listDatabases
浏览 catalog 和数据库列表。

### saveSqlGuide(keyword, description, sql)
将验证通过的 SQL 保存到知识库中心。参数：
- **keyword**：搜索关键词（方便他人搜到）
- **description**：用户原始需求
- **sql**：验证通过的完整 SQL

### updateTableComment / updateColumnComment
维护表/字段注释（管理员操作）。

## 工具使用建议

1. **先搜后查** — searchSqlGuides → searchTables → describeTable，逐步缩小范围
2. **灵活组合** — 不要求严格顺序，按需调用
3. **确认分区** — 不确定分区字段时先 describeTable 或 showPartitions
4. **枚举验证** — 不确定字段取值时用 searchEnumByColumn 确认
5. **操作码验证** — 需求涉及 opcode 时，先 searchOpcodes 探索，再 describeOpcode 验证有效性，最后才查数据
