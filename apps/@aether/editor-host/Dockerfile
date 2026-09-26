# @aether/editor-host · Dockerfile（自托管基线）
# 多阶段：node 构建 Vite SPA → nginx 托管静态产物
# 构建上下文为仓库根（monorepo）

# ── 构建阶段 ──
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /repo
COPY . .

RUN pnpm install --frozen-lockfile
RUN AETHER_EDITOR_HOST_BASE=/ pnpm turbo build --filter=@aether/editor-host

# ── 运行阶段 ──
FROM nginx:alpine AS runner

# SPA fallback：未知路由回退到 index.html
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=builder /repo/apps/@aether/editor-host/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
