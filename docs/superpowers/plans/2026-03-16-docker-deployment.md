# Docker 团队共享部署 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Claude Code UI 打包为 Docker 镜像，支持团队多人共享部署，单容器运行。

**Architecture:** 使用多阶段 Docker 构建：第一阶段编译前端和原生模块，第二阶段仅保留运行时。生产模式下 Express 直接服务静态文件和 API/WebSocket，通过环境变量注入 ANTHROPIC_API_KEY。容器内安装 Claude CLI 以支持完整功能。

**Tech Stack:** Docker, Node.js 20 LTS (Debian bookworm), npm, Claude CLI

---

## File Structure

| 文件 | 职责 |
|------|------|
| `Dockerfile` | 多阶段构建：build 阶段编译前端+原生模块，prod 阶段运行 |
| `docker-compose.yml` | 编排服务、卷挂载、环境变量、健康检查 |
| `.dockerignore` | 排除 node_modules、.git、dist 等 |
| `docker.env.example` | Docker 部署的环境变量模板 |

---

## Chunk 1: Docker 基础文件

### Task 1: 创建 .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: 创建 .dockerignore 文件**

```
node_modules
dist
.git
.gitignore
*.md
.env
.env.*
.DS_Store
.vscode
.idea
*.log
docs
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore for Docker build"
```

---

### Task 2: 创建 docker.env.example

**Files:**
- Create: `docker.env.example`

- [ ] **Step 1: 创建环境变量模板**

```env
# Claude Code UI Docker 部署配置

# [必填] Anthropic API Key — 团队共用
ANTHROPIC_API_KEY=sk-ant-xxxxx

# 服务端口 (容器内部)
PORT=3001

# 绑定地址
HOST=0.0.0.0

# 数据库路径 (容器内路径，通过 volume 持久化)
DATABASE_PATH=/data/db/auth.db

# Claude 上下文窗口大小
CONTEXT_WINDOW=160000

# 是否允许新用户注册 (首次部署后可关闭)
ALLOW_REGISTRATION=true

# 沙箱配置
SANDBOX_ENABLED=true
```

- [ ] **Step 2: Commit**

```bash
git add docker.env.example
git commit -m "chore: add docker.env.example for Docker deployment"
```

---

### Task 3: 创建 Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: 编写多阶段 Dockerfile**

```dockerfile
# ============================================
# Stage 1: Build — 编译前端 + 原生模块
# ============================================
FROM node:20-bookworm AS builder

WORKDIR /app

# 安装原生模块编译依赖
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖描述文件
COPY package.json package-lock.json ./

# 安装所有依赖（含 devDependencies 用于构建）
RUN npm ci

# 复制源代码
COPY . .

# 构建前端
RUN npm run build

# ============================================
# Stage 2: Production — 仅运行时
# ============================================
FROM node:20-bookworm-slim

WORKDIR /app

# 安装运行时依赖：
# - python3: node-gyp rebuild 可能需要
# - make, g++: 原生模块编译
# - git: Claude CLI 和项目操作需要
# - curl: 健康检查
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 安装 Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# 复制依赖描述文件
COPY package.json package-lock.json ./

# 仅安装生产依赖
RUN npm ci --omit=dev

# 从 builder 复制构建产物
COPY --from=builder /app/dist ./dist

# 复制服务端代码和共享代码
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY scripts ./scripts

# 修复 node-pty spawn-helper 权限
RUN node scripts/fix-node-pty.js

# 创建数据目录
RUN mkdir -p /data/db /workspace

# 环境变量默认值
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/db/auth.db

EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node", "server/index.js"]
```

- [ ] **Step 2: 验证 Dockerfile 语法**

Run: `docker build --check .` 或目视检查 Dockerfile 层级是否正确。

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile for production deployment"
```

---

### Task 4: 创建 docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: 编写 docker-compose 配置**

```yaml
services:
  claude-code-ui:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: claude-code-ui
    restart: unless-stopped
    ports:
      - "3001:3001"
    env_file:
      - docker.env
    volumes:
      # SQLite 数据库持久化
      - claude-data:/data/db
      # 工作空间目录（团队共享的项目文件）
      - claude-workspace:/workspace
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3

volumes:
  claude-data:
    driver: local
  claude-workspace:
    driver: local
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose.yml for team deployment"
```

---

## Chunk 2: 验证与健康检查

### Task 5: 确认健康检查端点存在

**Files:**
- Check: `server/index.js` (搜索 `/api/health` 路由)

- [ ] **Step 1: 检查 /api/health 端点是否存在**

在 `server/index.js` 中搜索 `health`。如果不存在，需要添加：

```javascript
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

此路由应放在 auth middleware 之前，不需要认证。

- [ ] **Step 2: 如有修改则 Commit**

```bash
git add server/index.js
git commit -m "feat: add /api/health endpoint for Docker healthcheck"
```

---

### Task 6: 构建并测试 Docker 镜像

- [ ] **Step 1: 复制环境变量文件**

```bash
cp docker.env.example docker.env
# 编辑 docker.env，填入实际的 ANTHROPIC_API_KEY
```

- [ ] **Step 2: 构建镜像**

Run: `docker compose build`
Expected: 构建成功，无报错

- [ ] **Step 3: 启动容器**

Run: `docker compose up -d`
Expected: 容器启动，状态 healthy

- [ ] **Step 4: 验证服务可用**

Run: `curl http://localhost:3001/api/health`
Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 5: 验证页面可访问**

浏览器打开 `http://localhost:3001`，应看到登录/注册页面。

- [ ] **Step 6: 验证 WebSocket 连接**

注册用户后登录，确认 WebSocket 连接正常（浏览器控制台无 WS 错误）。

- [ ] **Step 7: 测试终端功能**

打开终端，确认 node-pty 终端正常工作。

- [ ] **Step 8: 停止并清理**

Run: `docker compose down`

---

## 部署说明

### 快速启动

```bash
# 1. 复制环境变量
cp docker.env.example docker.env

# 2. 编辑 docker.env，填入 ANTHROPIC_API_KEY
vim docker.env

# 3. 构建并启动
docker compose up -d --build

# 4. 查看日志
docker compose logs -f

# 5. 访问
# http://<服务器IP>:3001
```

### 常用操作

```bash
# 停止
docker compose down

# 重启
docker compose restart

# 更新（拉取最新代码后）
git pull && docker compose up -d --build

# 查看数据卷
docker volume ls | grep claude
```
