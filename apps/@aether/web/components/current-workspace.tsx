// @aether/web · Current 工作区（核心环 Step 5-7 的承载界面）
// 三栏布局：左 Files（文件树）
//           中 Editor（通过 iframe 嵌入独立部署的 editor-host 应用）
//           右 Entities（Human 成员 + AI Entity 同列）
// 底部 Threads：与编辑器选区联动的叙事单元。
// Yohaku：serif 面板标题、mono 代码指纹、border-border 1px 分隔（无阴影），
// 梅红只出现在激活文件、活跃 Entity 脉冲与主 CTA。
'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'

import type { RealmActorRow } from '@/lib/entities'
import { createThread, type ThreadRow } from '@/lib/threads'

/** V0.1 静态文件清单：每个 path 映射独立 doc_ref（file:{realmId}:{path}） */
const WORKSPACE_FILES = [
  { path: 'README.md' },
  { path: 'src/main.ts' },
  { path: 'src/current.ts' },
  { path: 'docs/notes.md' },
] as const

interface SelectionInfo {
  start: number
  end: number
  text: string
}

interface CurrentWorkspaceProps {
  realmId: string
  realmName: string
  threads: ThreadRow[]
  actors: RealmActorRow[]
  defaultProjectId: string
  currentActorId: string
  currentActorName: string
}

/**
 * 从环境变量获取 Editor Host URL
 * - 生产环境：NEXT_PUBLIC_EDITOR_HOST_URL (如 https://editor.aether.example.com)
 * - 开发环境：默认 http://localhost:5173
 */
function getEditorHostUrl(): string {
  return process.env.NEXT_PUBLIC_EDITOR_HOST_URL || 'http://localhost:5173'
}

/**
 * 从环境变量获取 Converge Server 地址
 * - 生产环境：NEXT_PUBLIC_CONVERGE_SERVER_URL（CF Worker 基址，
 *   如 wss://aether-converge.xxx.workers.dev；editor-host 会按文档拼接 /ws/:docName）
 * - 旧版完整端点（wss://sync.cosky.top/api/ws）在迁移期同样兼容
 */
function getConvergeUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_CONVERGE_SERVER_URL || undefined
}

export default function CurrentWorkspace({
  realmId,
  realmName,
  threads,
  actors,
  defaultProjectId,
  currentActorId,
  currentActorName,
}: CurrentWorkspaceProps) {
  const [activePath, setActivePath] = useState<string>(WORKSPACE_FILES[0].path)
  const [selection, setSelection] = useState<SelectionInfo | null>(null)

  // 构建编辑器 iframe URL，包含必要的上下文参数
  const editorUrl = useMemo(() => {
    const url = new URL(getEditorHostUrl())
    url.searchParams.set('realmId', realmId)
    url.searchParams.set('filePath', activePath)
    url.searchParams.set('actorId', currentActorId)
    url.searchParams.set('actorName', currentActorName)
    const convergeUrl = getConvergeUrl()
    if (convergeUrl) {
      url.searchParams.set('convergeUrl', convergeUrl)
    }
    return url.toString()
  }, [realmId, activePath, currentActorId, currentActorName])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* 左：Files */}
        <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-neutral-1 md:w-56">
          <p className="shrink-0 px-4 pb-1 pt-4 text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
            Files
          </p>
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {WORKSPACE_FILES.map((file) => {
              const active = file.path === activePath
              const depth = file.path.split('/').length - 1
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => {
                    setActivePath(file.path)
                    setSelection(null)
                  }}
                  className={`block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-label-12 transition ${
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-neutral-7 hover:bg-neutral-2 hover:text-neutral-9'
                  }`}
                  style={{ paddingLeft: `${0.5 + depth}rem` }}
                >
                  {file.path}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* 中：Editor (iframe 嵌入独立部署的 editor-host) */}
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-neutral-1 px-4">
            <span className="truncate font-mono text-label-12 text-neutral-7">
              {activePath}
            </span>
            <span className="ml-auto shrink-0 font-mono text-caption-10 uppercase tracking-wider text-neutral-6">
              {realmName}
            </span>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden bg-neutral-1">
            {/* iframe 加载独立部署的 editor-host 应用 */}
            <iframe
              key={activePath}
              src={editorUrl}
              className="h-full w-full border-0"
              title={`Aether Editor - ${activePath}`}
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        </section>

        {/* 右：Entities */}
        <aside className="flex w-52 shrink-0 flex-col border-l border-border bg-neutral-1 lg:w-64">
          <EntityPanel actors={actors} />
        </aside>
      </div>

      {/* 底：Threads */}
      <section className="flex h-56 shrink-0 flex-col border-t border-border bg-neutral-1">
        <ThreadPanel
          realmId={realmId}
          defaultProjectId={defaultProjectId}
          threads={threads}
          selection={selection}
        />
      </section>
    </div>
  )
}

/** 右侧面板：Human 成员 + AI Entity 同列呈现 */
function EntityPanel({ actors }: { actors: RealmActorRow[] }) {
  const humans = actors.filter((a) => a.kind === 'human')
  const aiEntities = actors.filter((a) => a.kind === 'entity')
  const noEntity = aiEntities.length === 0

  return (
    <>
      <p className="shrink-0 px-4 pb-1 pt-4 font-serif text-copy-14 font-medium text-neutral-9">
        Entities
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {actors.length === 0 && (
          <div className="mt-6 rounded-md border border-dashed border-border px-3 py-6 text-center">
            <p className="text-copy-13 text-neutral-7">Invite an Entity</p>
            <p className="mt-1 text-label-12 text-neutral-6">
              Realm 中还没有任何主体。
            </p>
          </div>
        )}
        {[...humans, ...aiEntities].map((actor) => (
          <div
            key={`${actor.kind}:${actor.id}`}
            className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-neutral-2"
          >
            {actor.kind === 'entity' && actor.status === 'active' ? (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
            ) : (
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  actor.kind === 'human' ? 'bg-neutral-7' : 'bg-neutral-4'
                }`}
              />
            )}
            <div className="min-w-0">
              <p className="truncate text-copy-13 text-neutral-9">{actor.name}</p>
              <p className="font-mono text-caption-10 uppercase tracking-wider text-neutral-6">
                {actor.kind === 'human' ? 'Human' : 'Entity'} · {actor.status}
              </p>
            </div>
          </div>
        ))}
        {noEntity && actors.length > 0 && (
          <div className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-center">
            <p className="text-copy-13 text-neutral-7">Invite an Entity</p>
            <p className="mt-1 text-label-12 text-neutral-6">
              让 AI 以一等成员身份加入 Current。
            </p>
          </div>
        )}
      </div>
    </>
  )
}

/** 底部面板：Thread 列表 + 与编辑器选区联动的创建入口 */
function ThreadPanel({
  realmId,
  defaultProjectId,
  threads,
  selection,
}: {
  realmId: string
  defaultProjectId: string
  threads: ThreadRow[]
  selection: SelectionInfo | null
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await createThread({
        realmId,
        projectId: defaultProjectId,
        title: title.trim(),
        ...(selection ? { codeAnchor: selection.text } : {}),
      })
      setTitle('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-2 pt-3">
        <p className="font-serif text-copy-14 font-medium text-neutral-9">Threads</p>
        <span className="font-mono text-caption-10 uppercase tracking-wider text-neutral-6">
          {threads.length}
        </span>
        {selection && (
          <span
            className="max-w-72 truncate rounded-md bg-accent/10 px-2 py-0.5 font-mono text-caption-10 text-accent"
            title={selection.text}
          >
            已选中 {selection.text.length} 字符，将锚定到新 Thread
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-4 pb-3">
        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          className="flex w-72 shrink-0 flex-col gap-2"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              selection ? '为选区命名一个 Thread…' : 'Thread 标题…'
            }
            className="field"
            required
          />
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? '创建中…' : selection ? '以选区发起 Thread' : '新建 Thread'}
          </button>
          {error && <p className="text-label-12 text-error">{error}</p>}
        </form>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center rounded-md border border-dashed border-border px-6 text-center">
              <p className="text-copy-13 text-neutral-7">Select code to start a Thread</p>
              <p className="mt-1 text-label-12 text-neutral-6">
                在编辑器中选中一段代码，为它发起第一段上下文绑定的叙事。
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {threads.map((t) => (
                <li
                  key={t.id}
                  className="flex min-w-0 items-baseline gap-3 rounded-md px-2 py-1.5 hover:bg-neutral-2"
                >
                  <span className="min-w-0 truncate text-copy-13 text-neutral-9">
                    {t.title}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-caption-10 uppercase tracking-wider text-neutral-6">
                    {t.status}
                  </span>
                  <span className="shrink-0 font-mono text-caption-10 text-neutral-5">
                    {new Date(t.created_at).toLocaleDateString('zh-CN')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
