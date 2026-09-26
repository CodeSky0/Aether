# @aether/web · Dockerfile（自托管基线）
# node:22-alpine + pnpm + turbo build → Next.js standalone 运行
# 构建上下文为仓库根（monorepo），.dockerignore 已排除 node_modules/.next/dist/.git/.env

# ── 构建阶段 ──
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /repo
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@aether/web

# ── 运行阶段 ──
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone 产物：server.js + 依赖
COPY --from=builder /repo/apps/@aether/web/.next/standalone ./
# 静态资源（standalone 不含 public 和 .next/static）
COPY --from=builder /repo/apps/@aether/web/.next/static ./apps/@aether/web/.next/static
COPY --from=builder /repo/apps/@aether/web/public ./apps/@aether/web/public

EXPOSE 3000
CMD ["node", "apps/@aether/web/server.js"]
