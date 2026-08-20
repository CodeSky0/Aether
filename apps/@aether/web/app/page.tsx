// @aether/web · 首页
// Yohaku 落地页：editorial 排版，以 hairline 分隔代替卡片堆叠，余白承担节奏。
// 视觉约束遵循 docs/design/yohaku.md：role+px 字号、三档暖灰、accent ≤ 5%。
import Link from 'next/link'

const pillars = [
  {
    title: 'The Current',
    desc: '代码、Thread、Entity 操作写入同一 Y.Doc，以 CRDT 作为架构主干。',
  },
  {
    title: 'Entity 一等公民',
    desc: '拥有 Better-Auth 身份、Yjs 光标与审计轨迹，人机同为受管成员。',
  },
  {
    title: 'Context-Bound Threads',
    desc: '绑定文件范围、代码片段与 Manifestation，上下文无需人脑记忆。',
  },
  {
    title: 'Drift 离线优先',
    desc: '断网由 IndexedDB 持久化与本地缓存支撑，重连后自然 Converge。',
  },
] as const

const terms = [
  { term: 'Realm', mapped: 'Better-Auth Organization + Schema 隔离' },
  { term: 'Current', mapped: 'Yjs Provider + Presence 状态流' },
  { term: 'Entity', mapped: 'AI Agent 一等公民' },
  { term: 'Thread', mapped: 'Context-Bound 叙事单元' },
  { term: 'Manifestation', mapped: 'Vercel Preview 协同标注对象' },
  { term: 'Resonance', mapped: '公开 API 扩展' },
] as const

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-28 pt-20 md:pt-28">
      <header className="enter">
        <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
          Collaborative Intelligence Medium
        </p>
        <h1 className="mt-5 font-logo-latin text-display-36 font-medium tracking-tight text-neutral-10">
          Aether
        </h1>
        {/* 引文式主张：4px 梅红左竖条 + serif（Yohaku 引文约定） */}
        <p className="mt-8 max-w-lg border-l-4 border-accent pl-5 font-serif text-copy-16 leading-relaxed text-neutral-8">
          承载人、Entity、代码与上下文共存的原生环境。
          <br />
          协同即架构，AI 是一等成员。
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/dashboard" className="btn-primary">
            进入 Dashboard
          </Link>
          <a
            href="https://github.com/CodeSky0/Aether"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost"
          >
            源码
          </a>
        </div>
      </header>

      <section className="enter mt-28" style={{ animationDelay: '80ms' }}>
        <h2 className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
          差异化主张 · Pillars
        </h2>
        <div className="mt-8 grid gap-x-10 gap-y-10 sm:grid-cols-2">
          {pillars.map((p, i) => (
            <article key={p.title} className="border-t border-border pt-5">
              <p className="font-mono text-caption-10 text-neutral-6">
                {String(i + 1).padStart(2, '0')}
              </p>
              <h3 className="mt-3 font-serif text-copy-15 font-medium text-neutral-9">
                {p.title}
              </h3>
              <p className="mt-2 text-copy-13 leading-relaxed text-neutral-7">
                {p.desc}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="enter mt-28" style={{ animationDelay: '160ms' }}>
        <h2 className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
          术语快表 · Glossary
        </h2>
        <dl className="mt-8">
          {terms.map((t) => (
            <div
              key={t.term}
              className="flex flex-wrap items-baseline justify-between gap-x-10 gap-y-1 border-b border-border py-3.5"
            >
              <dt className="font-serif text-copy-14 font-medium text-neutral-9">
                {t.term}
              </dt>
              <dd className="font-mono text-copy-13 text-neutral-7">
                {t.mapped}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <footer
        className="enter mt-28 border-t border-border pt-6"
        style={{ animationDelay: '240ms' }}
      >
        <p className="text-label-12 text-neutral-6">
          M0–M2 引擎已就绪 · M3.5 Web UI 已完成 · M3 企业级特性推进中
        </p>
      </footer>
    </main>
  )
}
