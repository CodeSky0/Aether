# @aether/converge-server · Dockerfile（自托管基线）
# node:22-alpine + tsc 构建 → Node 入口运行（非 CF Worker）
# 构建上下文为仓库根（monorepo）

# ── 构建阶段 ──
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /repo
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@aether/converge-server

# ── 运行阶段 ──
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=1234

COPY --from=builder /repo/apps/@aether/converge-server/dist ./dist
COPY --from=builder /repo/apps/@aether/converge-server/package.json ./package.json
# 运行时只需 converge-server 自身依赖（不含 devDependencies）
RUN corepack enable && corepack prepare pnpm@11 --activate \
  && pnpm install --prod --frozen-lockfile --filter=@aether/converge-server...

EXPOSE 1234
CMD ["node", "dist/index.js"]
