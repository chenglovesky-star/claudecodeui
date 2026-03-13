# 自动化测试总结

## 概览

| 指标 | 值 |
|------|-----|
| 测试文件 | 5 |
| 测试用例 | 60 |
| 通过 | 60 |
| 失败 | 0 |
| 覆盖模块 | Auth, Team, Kanban, Conflict, Workflow |
| 框架 | Vitest + Supertest |
| 执行时间 | ~2.9s |

## 模块覆盖

### 1. Auth API (`tests/api/auth.test.js`) — 9 tests
- 用户注册（成功、重复邮箱、缺少邮箱）
- 用户登录（成功、错误密码、不存在用户）
- 认证状态检查
- Token 保护路由（无 Token 拒绝、有效 Token 返回用户）

### 2. Team API (`tests/api/team.test.js`) — 8 tests
- 团队 CRUD（创建、列表、详情、更新）
- 团队成员查询
- 邀请链接生成
- 通知列表
- 空名称拒绝

### 3. Kanban API (`tests/api/kanban.test.js`) — 15 tests
- Sprint CRUD（创建、列表、激活、获取活跃、完成）
- Story CRUD（创建、列表、详情、更新、删除）
- 状态拖拽更新、分配、重新排序
- 工作范围查询
- 无效状态拒绝
- 未授权请求拒绝

### 4. Conflict API (`tests/api/conflict.test.js`) — 12 tests
- 文件范围冲突扫描与检测
- 重复扫描去重
- 冲突列表（含统计、状态过滤）
- 冲突详情（成功、404）
- 冲突分配、解决、确认生命周期
- 实时冲突上报
- 参数校验（少于 2 人拒绝）

### 5. Workflow API (`tests/api/workflow.test.js`) — 16 tests
- 工作流创建（product_brief、prd、architecture）
- 重复活跃工作流拒绝、无效类型拒绝
- 工作流列表、活跃查询、详情
- 消息发送与 AI 回复
- 步骤推进（next choice）
- 消息历史
- 空消息拒绝
- 工作流取消与重复取消拒绝
- 完整生命周期（全步骤推进至完成）
- 文档列表与内容查询
- 未授权请求拒绝

## 测试基础设施

- **`tests/setup.js`**: 测试工厂，包含数据库初始化/清理、Express 应用构建、JWT 认证中间件、用户/团队快捷创建函数
- **`vitest.config.js`**: 顺序执行（`fileParallelism: false`）避免共享数据库冲突
- 每次运行前自动清理数据库，确保测试幂等性

## 运行方式

```bash
cd claudecodeui_agenteam
npx vitest run        # 运行全部测试
npx vitest run --reporter=verbose  # 详细输出
```
