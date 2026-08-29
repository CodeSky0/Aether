// @aether/web · 根路由错误边界（Step 6）
// 捕获 app/ 下所有未被子级 error.tsx 消化的渲染/数据错误；
// Yohaku 风格：可行动文案 + 重试 + Return to Realm。
'use client'

import YohakuError from '@/components/ui/yohaku-error'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <YohakuError
      title="Something went wrong"
      detail={error.message || '服务暂时不可用。'}
      hint="通常是网络波动或数据库连接失败；重试通常可以恢复。"
      digest={error.digest}
      onRetry={reset}
    />
  )
}
