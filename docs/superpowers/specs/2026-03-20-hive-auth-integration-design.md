# 接入 Hive meta_user 账户体系

## 概述

将 Claude Code UI 的用户认证从本地 SQLite 注册/登录改为讯飞 Hive `meta_user` 表验证。去掉注册功能，只保留登录，内部使用明文密码比对。

## 背景

- 当前系统使用本地 SQLite `users` 表 + bcrypt 哈希做认证
- 讯飞内部已有统一用户表 `default_catalog.dw_meta.meta_user`，存储在 Hive/Kyuubi 中
- 需要统一账户体系，避免用户重复注册

## 技术验证

Node.js `hive-driver` 包已验证可直连 HiveServer2 (Kyuubi)：
- 连接方式：`PlainTcpAuthentication`，用户 `sr`，密码 `iflytek`
- 会话配置：`kyuubi.session.domain=claudeweb`，`use:database=ossp`
- 查询方式：`executeStatement` + `nextFetch`，数据以列式返回

## meta_user 表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| username | string | 用户名（唯一标识） |
| password | string | 密码（明文） |
| role | string | 角色（admin/user，本项目不使用） |
| status | int | 状态（1=启用） |
| create_time | string | 创建时间 |
| update_time | string | 更新时间 |

## 登录流程

```
用户输入用户名+密码
       ↓
后端连接 Hive，查询 meta_user (WHERE username=? AND status=1)
       ↓
明文密码比对
       ↓
   验证失败 → 返回 401
   验证成功 ↓
       ↓
本地 SQLite 查找用户
  不存在 → 自动创建本地用户记录（username, 无密码哈希）
  已存在 → 更新 last_login
       ↓
生成 JWT Token (7天有效期)
       ↓
返回登录成功 + token + 用户信息
```

## 改动清单

### 1. 新增：server/database/hive.js

Hive 连接管理和用户查询模块。

**职责：**
- 建立/复用 HiveServer2 连接和会话
- 提供 `verifyUser(username, password)` 方法
- 连接异常时自动重连

**核心逻辑：**
```javascript
async function verifyUser(username, password) {
  // 1. 查询 meta_user: SELECT * FROM {HIVE_USER_TABLE} WHERE username='{username}' AND status=1 LIMIT 1
  // 2. 解析列式结果，提取用户记录
  // 3. 明文比对密码
  // 4. 匹配返回 { username, role, status }，不匹配返回 null
}
```

**连接配置从环境变量读取：**
```
HIVE_HOST=10.100.108.90
HIVE_PORT=10010
HIVE_USER=sr
HIVE_PASSWORD=iflytek
HIVE_DATABASE=ossp
HIVE_DOMAIN=claudeweb
HIVE_USER_TABLE=default_catalog.dw_meta.meta_user
```

### 2. 修改：server/database/db.js

新增方法 `findOrCreateUserFromHive(username)`：
- 在 SQLite `users` 表中查找 username
- 不存在则 INSERT（password_hash 设为空或占位符，因为验证走 Hive）
- 存在则更新 `last_login`
- 返回本地用户记录（含 id）

### 3. 修改：server/routes/auth.js

**POST /api/auth/login：**
- 改为调用 `hive.verifyUser(username, password)`
- 验证成功后调用 `db.findOrCreateUserFromHive(username)`
- 用本地用户 id 生成 JWT
- 创建用户工作区目录（如首次登录）

**POST /api/auth/register：**
- 移除或返回 403（注册功能已禁用）

**GET /api/auth/status：**
- 去掉 `needsSetup` 逻辑，始终返回 `{ needsSetup: false }`
- 因为不再需要首次注册引导

### 4. 修改：前端 auth 组件

**AuthContext.tsx：**
- 去掉 `needsSetup` 状态和注册流程分支
- 认证状态简化为：未登录 → 登录页 → 已登录

**去掉的组件/入口：**
- RegisterForm（注册表单）
- SetupForm（首次设置表单）
- 相关路由和跳转逻辑

**LoginForm：**
- 保持现有登录表单不变
- 去掉"注册"链接/按钮

### 5. 修改：.env

新增 Hive 连接配置变量（见上方）。

## 不变的部分

- JWT 认证机制（token 生成、中间件验证）不变
- WebSocket 认证不变
- 本地 SQLite 的 session_names、user_projects、api_keys 等表不变
- 用户工作区隔离机制不变
- 前端 ProtectedRoute 和 token 存储不变

## 边界情况

- **Hive 连接失败**：登录返回 503，提示服务暂不可用
- **用户在 meta_user 中被禁用（status!=1）**：登录返回 401
- **已登录用户的 JWT 仍然有效**：不受 Hive 连接状态影响（token 验证仍走本地）
- **并发登录**：Hive 查询是只读的，无并发冲突风险
