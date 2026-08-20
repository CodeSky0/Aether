// @aether/web · /realm/[id]/current 加载态（Yohaku 骨架，禁用 spinner）
// bg-neutral-2 + animate-pulse，结构与三栏工作区同构，加载完成前不跳动。
export default function CurrentLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="w-44 shrink-0 space-y-2 border-r border-border p-4 md:w-56">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 animate-pulse rounded-md bg-neutral-2" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-10 shrink-0 border-b border-border" />
          <div className="flex-1 space-y-3 p-4">
            <div className="h-64 animate-pulse rounded-md bg-neutral-2" />
          </div>
        </div>
        <div className="w-52 shrink-0 space-y-3 border-l border-border p-4 lg:w-64">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-neutral-2" />
          ))}
        </div>
      </div>
      <div className="h-56 shrink-0 border-t border-border p-4">
        <div className="h-24 animate-pulse rounded-md bg-neutral-2" />
      </div>
    </div>
  )
}
