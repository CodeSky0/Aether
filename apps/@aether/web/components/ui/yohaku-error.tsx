// @aether/web · Yohaku 错误态共享组件（Step 6 Error Boundaries）
// 契约：蘇芳（suoh）承载错误；文案可行动（原因 + 重试 + Return to Realm）。
// error.tsx / global-error.tsx 复用，保证各层错误体验一致。

'use client'

import Link from 'next/link'

interface YohakuErrorProps {
  title: string
  /** 错误说明（可展示 error.message） */
  detail?: string | undefined
  /** 次要解释（通常恒定：发生了什么/该怎么办） */
  hint?: string | undefined
  /** digest 便于在服务端日志中定位 */
  digest?: string | undefined
  /** 重试回调；不传则隐藏按钮 */
  onRetry?: () => void
  /** 次级出口；默认「回到 Realms」 */
  returnHref?: string
  returnLabel?: string
}

export default function YohakuError({
  title,
  detail,
  hint,
  digest,
  onRetry,
  returnHref = '/realms',
  returnLabel = 'Return to Realm',
}: YohakuErrorProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="font-serif text-title-28 text-neutral-9">{title}</p>
      {detail && (
        <p className="mt-3 max-w-md text-copy-14 text-error">{detail}</p>
      )}
      {hint && <p className="mt-2 max-w-md text-copy-13 text-neutral-6">{hint}</p>}
      {digest && (
        <p className="mt-2 font-mono text-caption-10 text-neutral-5">
          digest: {digest}
        </p>
      )}
      <div className="mt-8 flex items-center gap-3">
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-primary">
            重试
          </button>
        )}
        <Link href={returnHref} className="btn-ghost">
          {returnLabel}
        </Link>
      </div>
    </div>
  )
}
