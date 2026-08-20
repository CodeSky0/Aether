// @aether/web · /realm/[id]/current 错误态
// Yohaku：蘇芳（suoh）承载错误；文案可行动（说明原因 + 重试入口），不止报错。
'use client'

export default function CurrentError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p className="font-serif text-title-20 font-medium text-neutral-9">
        Current 暂时无法进入
      </p>
      <p className="mt-2 max-w-md text-copy-14 text-error">
        {error.message || '连接中断。正在等待恢复…'}
      </p>
      <p className="mt-1 text-label-12 text-neutral-6">
        通常是网络波动或数据库连接失败；重试通常可以恢复。
      </p>
      <button type="button" onClick={reset} className="btn-primary mt-6">
        重试
      </button>
    </div>
  )
}
