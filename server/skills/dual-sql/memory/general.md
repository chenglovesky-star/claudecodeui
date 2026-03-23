---
name: 通用知识
description: 跨场景的工具限制、SQL规范陷阱等通用经验
type: reference
---

## 工具限制

### executeQuery 不支持 SQL 注释
传入含 `--` 注释的 SQL 会报"不允许执行修改数据的操作"错误。
**规避**：去掉所有注释，说明写在回复文本中。

## 性能通用经验

### 亿级大表 join 必须分片
任何涉及 bxlabel 等亿级表的 join 都会被 Kyuubi kill。
按 uid 前缀分片，单片≤300万用户，串行执行。

## 数据通用经验

（随使用积累）
