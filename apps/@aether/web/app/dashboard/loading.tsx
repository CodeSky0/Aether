// @aether/web · /dashboard 流式加载骨架
import { PageHeaderSkeleton, CardGridSkeleton } from '@/components/ui/skeleton'

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 md:px-8">
      <PageHeaderSkeleton />
      <div className="mt-12">
        <CardGridSkeleton count={2} />
      </div>
    </div>
  )
}
