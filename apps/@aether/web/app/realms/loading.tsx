// @aether/web · /realms 流式加载骨架
import { PageHeaderSkeleton, CardGridSkeleton } from '@/components/ui/skeleton'

export default function RealmsLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 md:px-8">
      <div className="flex items-start justify-between gap-4">
        <PageHeaderSkeleton />
        <div className="pt-8">
          <div className="enter h-9 w-28 rounded-md bg-neutral-2" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-12">
        <CardGridSkeleton />
      </div>
    </div>
  )
}
