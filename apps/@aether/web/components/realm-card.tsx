// @aether/web · Realm 卡片组件（Yohaku V0.1）
// serif 名称承担层级；ID 为 mono 指纹；Entity 活跃时以梅红脉冲点示意；
// 深度只用 ring；「进入 Current →」是唯一动作出口，hover 才触碰梅红。
'use client'

import Link from 'next/link'
import { type RealmCardRow } from '@/lib/realms'

interface RealmCardProps {
  realm: RealmCardRow
}

/** 长 ID 截断为可读指纹（完整值挂 title 提示） */
function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`
}

export default function RealmCard({ realm }: RealmCardProps) {
  const entitiesActive = realm.activeEntityCount > 0

  return (
    <article className="flex h-full flex-col rounded-xl bg-neutral-1 p-6 ring-1 ring-border transition hover:bg-neutral-2 hover:ring-accent/30">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="min-w-0 truncate font-serif text-title-20 font-medium text-neutral-10">
          {realm.name}
        </h3>
        {entitiesActive && (
          <span
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
            title={`${realm.activeEntityCount} 个 Entity 活跃中`}
          />
        )}
      </div>
      <p className="mt-1 font-mono text-label-12 text-neutral-6" title={realm.id}>
        {shortId(realm.id)}
      </p>

      <p className="mt-6 min-w-0 truncate text-copy-14 text-neutral-7">
        <span className="font-mono text-label-12 uppercase tracking-wider text-neutral-6">
          THREAD
        </span>{' '}
        {realm.lastThreadTitle ?? '暂无 Thread'}
      </p>

      <div className="mt-auto pt-6">
        <Link
          href={`/realms/${realm.id}`}
          className="text-copy-14 text-neutral-9 transition hover:text-accent"
        >
          进入 Current →
        </Link>
      </div>
    </article>
  )
}
