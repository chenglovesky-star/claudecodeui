# ============================================
# Stage 1: Build — 编译前端 + 原生模块
# ============================================
FROM node:20-bookworm-slim AS builder

# 清除代理设置，避免走公司代理导致 apt/npm 请求失败
ENV http_proxy="" https_proxy="" HTTP_PROXY="" HTTPS_PROXY="" no_proxy=""

WORKDIR /app

# 切换为阿里云镜像源
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
    || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list

# 安装原生模块编译依赖
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 配置 npm 国内镜像源
RUN npm config set registry https://registry.npmmirror.com

# 复制依赖描述文件和 postinstall 脚本（npm ci 会触发 postinstall）
COPY package.json package-lock.json ./
COPY scripts ./scripts

# 安装所有依赖（含 devDependencies 用于构建前端）
RUN npm ci

# 复制源代码
COPY . .

# 构建前端静态文件
RUN npm run build

# ============================================
# Stage 2: Production — 仅运行时
# ============================================
FROM node:20-bookworm-slim

# 清除代理设置
ENV http_proxy="" https_proxy="" HTTP_PROXY="" HTTPS_PROXY="" no_proxy=""

WORKDIR /app

# 切换为阿里云镜像源
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
    || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list

# 安装运行时依赖及常用开发工具
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    make \
    g++ \
    git \
    curl \
    wget \
    vim \
    sudo \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

# 配置 npm 国内镜像源
RUN npm config set registry https://registry.npmmirror.com

# 安装 Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# 复制依赖描述文件和 postinstall 脚本
COPY package.json package-lock.json ./
COPY scripts ./scripts

# 仅安装生产依赖（忽略 prepare/husky 脚本，然后重建所有原生模块）
RUN npm ci --omit=dev --ignore-scripts \
    && npm rebuild \
    && node scripts/fix-node-pty.js

# 从 builder 阶段复制前端构建产物
COPY --from=builder /app/dist ./dist

# 复制服务端代码和必要文件
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY index.html ./

# 创建非 root 用户，并赋予 sudo 免密权限
RUN useradd -m -s /bin/bash claude \
    && echo "claude ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/claude

# 创建数据和工作空间目录，并预置 Claude CLI 配置
RUN mkdir -p /data/db /workspace /home/claude/.claude/debug /home/claude/.claude/statsig /home/claude/.claude/projects
COPY claude-settings.json /home/claude/.claude/settings.json
# 备份一份默认配置，防止 volume 挂载覆盖后丢失
RUN cp /home/claude/.claude/settings.json /home/claude/.claude-settings-default.json
RUN chown -R claude:claude /app /data /workspace /home/claude

# 复制启动脚本
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 环境变量默认值
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/db/auth.db \
    WORKSPACES_ROOT=/workspace

EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
