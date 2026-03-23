# Memory Index（内置默认）
> 这是开箱即用的默认记忆索引。用户工作区如存在 ./memory/MEMORY.md，将优先使用。

## 场景索引

| 场景关键词 | 文件 | 包含内容 |
|-----------|------|---------|
| 画像、标签、bxlabel、性别、年龄、分层、屏蔽 | scene_portrait.md | bxlabel表结构、标签key对照、分片策略、查询模板 |
| 埋点、opcode、FT码、tags、PV、UV、入口、帖子、社区、创作者、粉丝 | scene_opcode.md | operation_log表对比、tags提取、PV/UV分析模板、社区内容生态表关联 |
| 工具限制、SQL注释、通用 | general.md | executeQuery限制、跨场景通用经验 |

## 通用速查（每次SQL执行前检查）

- executeQuery **禁用** `--` 注释，必须去掉
- 亿级大表 join 会被 kill，按 uid 前缀分片（单片≤300万）
- tags 提取用 `ifly_map_get(tags, 'key')`，tags_json 不可靠

## 读取策略

1. 收到需求 → 读本文件 → 按关键词匹配场景
2. 命中场景 → 读对应 scene_*.md 获取表+陷阱+模板
3. 未命中 → 读 general.md 检查通用限制 → MCP 搜索
4. 新场景积累足够知识后 → 创建新的 scene_*.md
