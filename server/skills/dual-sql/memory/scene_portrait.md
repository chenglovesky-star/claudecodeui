---
name: 画像分析场景
description: 用户画像、标签查询相关的表、字段、陷阱和SQL模板
type: reference
---

## 核心表：hive.ossp.bxlabel

- 分区：`dt`（yyyymmdd），通常只保留最新一个分区
- 主要字段：`uid`、`osid`、`content`（JSON，存所有画像标签）
- 每行一个 uid，`count(*)` 即 UV，无需 COUNT(DISTINCT uid)
- 数据量：~2.1亿行

## 已确认标签 key 对照表

| key | 含义 | 取值 |
|-----|------|------|
| 100100 | 性别 | "男"/"女"，null=未知 |
| 100200 | 年龄段 | "70后"~"10后"，null=未知 |
| 191624 | 严格屏蔽 | "1"=屏蔽 |
| 191628 | 严格屏蔽20251230 | 时间点快照 |
| 190623 | 重点分层 | "分层0"≈1.21亿用户(2026-03-17) |

标签提取：`get_json_object(content, '$.key')`
枚举查询：searchEnumByColumn 传 columnName 用标签 key（如 `191624`），非 `content`

## 活跃用户表

- 表名：`hive.ossp.dw_d_ime_activeuserdetail`
- 分区字段：`proc_date`（yyyymmdd）——**注意不是 `dt`**
- 用法：`WHERE proc_date = '20260310'`，约 9900 万行/天
- 与 bxlabel 关联：`LEFT JOIN bxlabel ON a.uid = p.uid`（活跃用户 left join 画像）
- 陷阱：不存在时 Agent 容易误用 bxlabel 全量代替（错误口径），必须明确指定此表

### 活跃用户 × 画像联查模板
```sql
WITH active_users AS (
  SELECT uid FROM hive.ossp.dw_d_ime_activeuserdetail
  WHERE proc_date = 'yyyymmdd'
),
portrait AS (
  SELECT uid,
    get_json_object(content, '$.100100') AS gender_raw,
    get_json_object(content, '$.100200') AS age_raw
  FROM hive.ossp.bxlabel
  WHERE dt = '最新分区'
),
joined AS (
  SELECT a.uid,
    CASE WHEN p.gender_raw IS NULL OR p.gender_raw = '' THEN '未知' ELSE p.gender_raw END AS gender,
    CASE WHEN p.age_raw IS NULL OR p.age_raw = '' THEN '未知' ELSE p.age_raw END AS age_group
  FROM active_users a LEFT JOIN portrait p ON a.uid = p.uid
)
```

## 陷阱

### 大表 join 被 kill
bxlabel（~2.1亿）与活跃用户表（~1亿）join 会被 Kyuubi 自动终止。

**规避方法：**
1. `substr(uid, 1, N)` 查看 UID 前缀分布，确定分片大小
2. 单片≤300万用户（iPhone 740万勉强可过，Android 需拆到4位前缀）
3. 串行执行，每次只跑一个分片（并行触发频率限制）
4. UID 为18位数字，主要以 '2' 开头，按 `uid >= 'XXXX' AND uid < 'YYYY'` 切分
5. 本地 Python 脚本汇总各分片结果

## 查询模板

### 标签统计模板
```sql
SELECT
  get_json_object(content, '$.标签key') AS label_value,
  count(*) AS user_count
FROM hive.ossp.bxlabel
WHERE dt = '最新分区'
  AND get_json_object(content, '$.标签key') IS NOT NULL
GROUP BY get_json_object(content, '$.标签key')
ORDER BY user_count DESC
```
