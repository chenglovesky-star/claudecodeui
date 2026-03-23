# SQL 编码规范与常用模板

## 强制规范

### CTE 结构
必须使用 `WITH ... AS` 多阶段处理，禁止嵌套子查询。

### UV 口径
先按 `uid` 分组聚合，再汇总计数。禁止顶层直接 `COUNT(DISTINCT uid)`。

```sql
-- 正确
WITH user_actions AS (
  SELECT uid FROM ... GROUP BY uid
)
SELECT COUNT(1) AS uv FROM user_actions

-- 错误
SELECT COUNT(DISTINCT uid) AS uv FROM ...
```

### 分区裁剪
必须显式过滤分区字段（如 `dt >= '20240101'`）。

### 数值精度
所有数值统一 `ROUND(x, 2)`。

### 排序
最终结果必须对所有查询字段 `ORDER BY`，指标字段放最后。

### PV 计算
`GROUP BY` 聚合配合 `COUNT(1)`。

### 注释
SQL 中禁止使用 `--` 注释（executeQuery 不支持），说明写在回复文本中。

### Tags 提取
使用 `ifly_map_get(tags, 'key_name')`，不要用 `tags_json`（不可靠）。

## 常用 SQL 模板

### opcode PV/UV + tags 枚举分布

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

### 双人群重合分析

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

### 活跃用户 x 画像联查

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
SELECT gender, age_group, COUNT(1) AS user_count
FROM joined
GROUP BY gender, age_group
ORDER BY gender, user_count DESC
```

### 标签统计

```sql
SELECT
  get_json_object(content, '$.标签key') AS label_value,
  COUNT(1) AS user_count
FROM hive.ossp.bxlabel
WHERE dt = '最新分区'
  AND get_json_object(content, '$.标签key') IS NOT NULL
GROUP BY get_json_object(content, '$.标签key')
ORDER BY user_count DESC
```

## 性能注意事项

### 亿级大表 join 必须分片
涉及 bxlabel 等亿级表的 join 会被 Kyuubi kill。按 uid 前缀分片，单片 <= 300 万用户。UID 为 18 位数字，主要以 '2' 开头，按 `uid >= 'XXXX' AND uid < 'YYYY'` 切分，串行执行。
