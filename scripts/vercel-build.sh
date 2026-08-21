#!/bin/sh
# Aether · Vercel 构建前迁移脚本
# 仅在生产环境执行数据库迁移（幂等，可安全重复运行）
set -e

if [ "$VERCEL_ENV" = "production" ]; then
  echo "⏳ Running production migration..."
  pnpm --filter @aether/db db:migrate
  echo "✅ Migration complete"
else
  echo "⏭️  Skipping migration (not production)"
fi
