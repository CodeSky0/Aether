# --- Stage 1: Base & Dependencies ---
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

# 复制整个 monorepo。
# 注意：必须复制完整 workspace（而非仅复制部分 package.json），
# 因为 pnpm install --frozen-lockfile 会按 pnpm-lock.yaml 校验所有 importer，
# 仅复制依赖链上的包会导致 lockfile 校验失败。
# .dockerignore 已排除 node_modules / dist / .git 等，复制开销可控。
COPY . .

# 安装依赖（与本地环境一致）
RUN pnpm install --frozen-lockfile

# --- Stage 2: Build ---
FROM base AS builder
# 仅构建 converge-server 及其 workspace 依赖（@aether/db）
# @aether/types 为纯源码 type-only 包，无 build 脚本，被 turbo 自动跳过
RUN pnpm turbo run build --filter=@aether/converge-server...

# --- Stage 3: Production Runner ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# 构建产物（tsconfig.build.json 输出到 dist/）
COPY --from=builder /app/apps/@aether/converge-server/dist ./dist
COPY --from=builder /app/apps/@aether/converge-server/package.json ./package.json

# node_modules：pnpm 虚拟 store（node_modules/.pnpm），包含全部外部依赖
COPY --from=builder /app/node_modules ./node_modules

# workspace 包 symlink 目标：
#   node_modules/@aether/db -> packages/@aether/db（运行时依赖，需其 dist）
#   @aether/types 仅 type-only import，编译期已擦除，无需复制
COPY --from=builder /app/packages/@aether/db ./packages/@aether/db

# Render 会注入 PORT 覆盖此默认值；index.ts 使用 process.env.PORT ?? 1234
ENV PORT=8080
EXPOSE 8080

# start 脚本：node dist/index.js（ESM，package.json 声明 "type": "module"）
CMD ["node", "dist/index.js"]
