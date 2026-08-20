// @aether/web · /dashboard 加载态（Yohaku 骨架，禁用 spinner）
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 md:px-8">
      <div className="mb-10 space-y-3">
        <div className="h-3 w-24 animate-pulse rounded-md bg-neutral-2" />
        <div className="h-7 w-40 animate-pulse rounded-md bg-neutral-2" />
        <div className="h-4 w-72 animate-pulse rounded-md bg-neutral-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-44 animate-pulse rounded-xl bg-neutral-2" />
        <div className="h-44 animate-pulse rounded-xl bg-neutral-2" />
      </div>
    </div>
  )
}
