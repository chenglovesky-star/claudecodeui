---
name: 埋点分析场景
description: opcode埋点查询相关的表选择、tags提取、PV/UV分析模板、社区内容生态表关联
type: reference
---

## 核心表：paimon.ods.ods_ime_operation_log（首选）

- 分区：`proc_date`（yyyymmdd）+ `bizid` + `osid` + `opcode`
- 数据更全、更新更及时（每日早5点）
- FT52059/FT52060 等均有数据到最新

### 备选表对比
| 表 | 问题 |
|---|------|
| paimon.ods.ods_operation_log | 部分opcode数据缺失（如FT52059无数据），出数早4点 |
| hive.ods.ods_opcode_ystd_di | 原始日志仅line字段（未解析），不适合直接查询 |

## tags 提取

- tags 格式：`key*value|key*value`
- 提取方式：`ifly_map_get(tags, 'key_name')`
- **tags_json 不可靠**，在 ods_ime_operation_log 中可能为空
- 示例：`ifly_map_get(tags, 'd_clickarea') = '99'` 过滤下载行为

## 查询模板

### opcode PV/UV + tags枚举分布
```sql
WITH base AS (
  SELECT uid, ifly_map_get(tags, '目标tag_key') AS tag_val
  FROM paimon.ods.ods_ime_operation_log
  WHERE proc_date = 'yyyymmdd'
    AND opcode = 'FTxxxxx'
    AND ifly_map_get(tags, '目标tag_key') IS NOT NULL
    AND ifly_map_get(tags, '目标tag_key') <> ''
),
uv_total AS (
  SELECT COUNT(DISTINCT uid) AS total_uv FROM base
),
pv_stat AS (
  SELECT tag_val, COUNT(1) AS pv FROM base GROUP BY tag_val
),
uv_stat AS (
  SELECT tag_val, COUNT(1) AS uv
  FROM (SELECT tag_val, uid FROM base GROUP BY tag_val, uid) t
  GROUP BY tag_val
)
SELECT p.tag_val, p.pv, u.uv,
  ROUND(u.uv * 100.0 / t.total_uv, 2) AS uv_ratio_pct
FROM pv_stat p
JOIN uv_stat u ON p.tag_val = u.tag_val
CROSS JOIN uv_total t
ORDER BY u.uv DESC
```

### 双人群重合分析（交集/并集/重合率）
```sql
WITH group_a AS (
  SELECT uid
  FROM paimon.ods.ods_ime_operation_log
  WHERE proc_date >= 'yyyymmdd' AND proc_date <= 'yyyymmdd'
    AND opcode = 'FTxxxxx'
  GROUP BY uid
),
group_b AS (
  SELECT uid
  FROM paimon.ods.ods_ime_operation_log
  WHERE proc_date >= 'yyyymmdd' AND proc_date <= 'yyyymmdd'
    AND opcode = 'FTyyyyy'
    AND ifly_map_get(tags, 'tag_key') = 'tag_value'
  GROUP BY uid
),
cnt_a AS (SELECT COUNT(1) AS val FROM group_a),
cnt_b AS (SELECT COUNT(1) AS val FROM group_b),
cnt_overlap AS (
  SELECT COUNT(1) AS val
  FROM group_a a INNER JOIN group_b b ON a.uid = b.uid
)
SELECT
  a.val - o.val AS only_a_uv,
  b.val - o.val AS only_b_uv,
  o.val AS overlap_uv,
  ROUND(o.val * 100.0 / (a.val + b.val - o.val), 2) AS overlap_rate_pct
FROM cnt_a a
CROSS JOIN cnt_b b
CROSS JOIN cnt_overlap o
```

## 社区内容生态表（帖子、创作者、粉丝）

### 帖子维度表：paimon.ods.ods_posting_i_s
- 维度：`id`（帖子id，BIGINT）、`userid`（创作者id）
- 分区：`dt`（yyyymmdd，基于 ctime）；`mt`（yyyymm）非分区字段，可做月份筛选但不裁剪分区
- 关键筛选：`source='1'`（用户自建）、`status=1`（有效）
- opcode 中 `ifly_map_get(tags, 'i_id')` 返回 STRING，关联时需 `CAST(id AS STRING)`

### 粉丝关注表：paimon.ods.ods_user_follow
- `userid` = 被关注人（创作者），`followid` = 粉丝用户id
- 分区：`dt`（关注创建时间）
- 统计粉丝数：`COUNT(1) GROUP BY userid`（累计值，无取关记录）

### opcode 与帖子关联
- FT52059（详情页曝光）：`ifly_map_get(tags, 'i_id')` → 帖子id
- FT52060（下载）：`ifly_map_get(tags, 'i_id')` → 帖子id，`ifly_map_get(tags, 'd_clickarea') = '99'` 过滤下载行为

### 宽表备选：paimon.dws.dws_posting
- 帖子统计宽表，含 `read_num`、`upvote_num`、`comment_hum`、`share_num`
- 适合不需要 opcode 级别精细分析时使用
