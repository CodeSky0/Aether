#!/bin/sh
# Aether · 部署前数据库迁移脚本
# 仅在生产环境或显式指定 RUN_DB_MIGRATION=true 时执行
# 迁移是幂等的，可安全重复运行（drizzle-kit 会跳过已应用的迁移）

set -e

echo "=== Aether Database Migration ==="

# 检查是否需要运行迁移
SHOULD_RUN=false

if [ "$VERCEL_ENV" = "production" ]; then
  echo "环境: Vercel Production — 自动执行迁移"
  SHOULD_RUN=true
elif [ "$RUN_DB_MIGRATION" = "true" ]; then
  echo "环境: 显式指定 RUN_DB_MIGRATION=true — 执行迁移"
  SHOULD_RUN=true
else
  echo "环境: $VERCEL_ENV — 跳过迁移 (仅在 production 或 RUN_DB_MIGRATION=true 时执行)"
  echo "如需手动迁移，请运行: pnpm db:migrate"
  exit 0
fi

# 确保数据库连接可用
if [ -z "$DATABASE_URL" ] && [ -z "$DATABASE_URL_UNPOOLED" ] && [ -z "$POSTGRES_URL_NON_POOLING" ]; then
  echo "警告: 未找到 DATABASE_URL 环境变量"
  echo "检查 drizzle.config.ts 中的 fallback 逻辑..."
fi

# 执行迁移
echo "正在运行 drizzle-kit migrate..."
cd "$(dirname "$0")/.."
pnpm --filter @aether/db db:migrate

echo "=== Migration Complete ==="
