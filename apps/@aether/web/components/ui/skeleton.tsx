// @aether/web · RSC 流式加载骨架（Step 6）
// Yohaku：安静的中性色块（bg-neutral-2），带 enter 呼吸感；不转圈、不闪动。

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      className={`enter rounded-md bg-neutral-2 ${className}`}
      aria-hidden="true"
    />
  )
}

/** 页头骨架：eyebrow + serif 标题 + 描述行 */
export function PageHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <SkeletonBlock className="h-3 w-24" />
      <SkeletonBlock className="h-8 w-56" />
      <SkeletonBlock className="h-4 w-full max-w-md" />
    </div>
  )
}

/** 卡片网格骨架（Realm 列表 / Dashboard） */
export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-lg bg-neutral-1 p-5 ring-1 ring-border"
        >
          <SkeletonBlock className="h-5 w-2/3" />
          <SkeletonBlock className="h-3 w-1/2" />
          <SkeletonBlock className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}

/** 三栏工作区骨架（Current：Files / Editor / Entities） */
export function WorkspaceSkeleton() {
  return (
    <div className="flex h-full min-h-[60vh] gap-0">
      <div className="flex w-48 shrink-0 flex-col gap-2 border-r border-border p-4">
        <SkeletonBlock className="h-4 w-24" />
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-4 w-full" />
        ))}
      </div>
      <div className="flex-1 p-6">
        <SkeletonBlock className="h-full w-full" />
      </div>
      <div className="hidden w-52 shrink-0 flex-col gap-2 border-l border-border p-4 lg:flex">
        <SkeletonBlock className="h-4 w-20" />
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-8 w-full" />
        ))}
      </div>
    </div>
  )
}
