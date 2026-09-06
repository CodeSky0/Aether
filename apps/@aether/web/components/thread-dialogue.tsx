// @aether/web · Thread 对话视图
// 展示 dialogue 历史 + 输入框 + Entity 流式回复。
// 用户消息经 /api/threads/[threadId]/chat 流式端点触发 Entity 回复，逐 token 渲染。
// Entity 气泡用 EntityAvatar（梅红状态点），人类气泡用 neutral 底色。
// Yohaku：serif 标题、mono 时间戳、border-border 分隔，梅红仅出现在 Entity 状态点与发送按钮。
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

import { listDialogues, type DialogueRow } from '@/app/actions/threads'
import { EntityAvatar, toEntityStatus } from '@/components/ui/entity-avatar'

interface ThreadDialogueProps {
  threadId: string
  realmId: string
  threadTitle: string
  /** 可选：指定 Entity id；缺省由后端取 Realm 第一个 active Entity */
  entityId?: string
  /** Entity 显示名（用于头像）；缺省用 "Entity" */
  entityName?: string
  entityStatus?: string
  /** Thread 绑定的 Manifestation URL；存在时显示「查看预览」按钮 */
  manifestationUrl?: string
  onShowManifestation?: () => void
  onClose?: () => void
}

interface Message {
  id: string
  role: string
  content: string
  actorType: string
  createdAt: Date
  streaming?: boolean
}

export default function ThreadDialogue({
  threadId,
  realmId,
  threadTitle,
  entityId,
  entityName = 'Entity',
  entityStatus = 'idle',
  manifestationUrl,
  onShowManifestation,
  onClose,
}: ThreadDialogueProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadDialogues = useCallback(async () => {
    const result = await listDialogues(realmId, threadId)
    if (!result.success) {
      setError(result.error)
      setLoading(false)
      return
    }
    setMessages(
      result.data.map((r: DialogueRow) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        actorType: r.actor_type,
        createdAt: r.created_at,
      })),
    )
    setLoading(false)
  }, [realmId, threadId])

  useEffect(() => {
    void loadDialogues()
  }, [loadDialogues])

  // 自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const content = input.trim()
    if (!content || sending) return
    setSending(true)
    setError(null)
    setInput('')

    // 乐观追加用户消息
    const userMsg: Message = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      content,
      actorType: 'human',
      createdAt: new Date(),
    }
    // 占位 Entity 流式消息
    const entityMsgId = `temp-entity-${Date.now()}`
    const entityMsg: Message = {
      id: entityMsgId,
      role: 'assistant',
      content: '',
      actorType: 'entity',
      createdAt: new Date(),
      streaming: true,
    }
    setMessages((prev) => [...prev, userMsg, entityMsg])

    try {
      const response = await fetch(`/api/threads/${threadId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ realmId, content, ...(entityId ? { entityId } : {}) }),
      })

      if (!response.ok) {
        const err = (await response.json().catch(() => ({
          error: { message: '请求失败' },
        }))) as { error?: { message?: string } }
        setError(err.error?.message ?? `HTTP ${response.status}`)
        setMessages((prev) => prev.filter((m) => m.id !== entityMsgId))
        return
      }

      // 逐 token 读取流
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      if (reader) {
        let accumulated = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          accumulated += decoder.decode(value, { stream: true })
          setMessages((prev) =>
            prev.map((m) =>
              m.id === entityMsgId ? { ...m, content: accumulated } : m,
            ),
          )
        }
      }

      // 流完成：标记非流式 + 刷新真实历史（获取最终 id/seq）
      setMessages((prev) =>
        prev.map((m) =>
          m.id === entityMsgId ? { ...m, streaming: false } : m,
        ),
      )
      void loadDialogues()
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
      setMessages((prev) => prev.filter((m) => m.id !== entityMsgId))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-1">
      {/* 标题栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <p className="min-w-0 truncate font-serif text-copy-14 font-medium text-neutral-9">
          {threadTitle}
        </p>
        <span className="ml-auto shrink-0 font-mono text-caption-10 uppercase tracking-wider text-neutral-5">
          Thread
        </span>
        {manifestationUrl && onShowManifestation && (
          <button
            type="button"
            onClick={onShowManifestation}
            className="shrink-0 rounded-md bg-neutral-2 px-2.5 py-1 text-label-12 text-neutral-7 transition hover:text-neutral-9"
          >
            查看预览
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-label-12 text-neutral-6 hover:bg-neutral-2 hover:text-neutral-9"
            aria-label="关闭对话"
          >
            Esc
          </button>
        )}
      </header>

      {/* 消息列表 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-copy-13 text-neutral-6">加载对话…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-copy-13 text-neutral-7">向 Entity 发起第一段对话</p>
            <p className="mt-1 text-label-12 text-neutral-6">
              这个 Thread 已绑定代码上下文，Entity 会基于它回复。
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {messages.map((msg) => (
              <li key={msg.id} className="flex gap-3">
                {msg.role === 'assistant' ? (
                  <EntityAvatar
                    name={entityName}
                    status={toEntityStatus(entityStatus)}
                    working={msg.streaming ?? false}
                    size="md"
                  />
                ) : (
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-3 text-copy-13 font-medium text-neutral-8">
                    You
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 text-caption-10 text-neutral-5">
                    {msg.role === 'assistant' ? entityName : 'You'}
                    <span className="ml-2">
                      {msg.createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {msg.streaming && (
                      <span className="ml-2 text-accent">正在收敛…</span>
                    )}
                  </p>
                  <div
                    className={`rounded-md px-3 py-2 text-copy-13 ${
                      msg.role === 'assistant'
                        ? 'bg-neutral-2 text-neutral-9'
                        : 'bg-neutral-1 text-neutral-9 ring-1 ring-border'
                    }`}
                  >
                    {msg.role === 'assistant'
                      ? parseDiffBlocks(
                          msg.content || (msg.streaming ? '…' : ''),
                        ).map((part, i) =>
                          part.type === 'diff' ? (
                            <DiffBlock key={i} diff={part.content} />
                          ) : (
                            <span key={i} className="whitespace-pre-wrap">
                              {part.content}
                            </span>
                          ),
                        )
                      : (msg.content || '')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-border p-3">
        {error && <p className="mb-2 text-label-12 text-error">{error}</p>}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder="发送消息…（Enter 发送，Shift+Enter 换行）"
            disabled={sending}
            className="field flex-1"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !input.trim()}
            className="btn-primary shrink-0"
          >
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 从 Entity 回复文本中提取 ```diff 代码块，分离普通文本与 diff。 */
function parseDiffBlocks(
  text: string,
): Array<{ type: 'text' | 'diff'; content: string }> {
  if (!text) return [{ type: 'text', content: '' }]
  const parts: Array<{ type: 'text' | 'diff'; content: string }> = []
  const regex = /```diff\n([\s\S]*?)```/g
  let lastIdx = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: 'text', content: text.slice(lastIdx, match.index) })
    }
    parts.push({ type: 'diff', content: match[1] ?? '' })
    lastIdx = regex.lastIndex
  }
  if (lastIdx < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIdx) })
  }
  return parts
}

/** Diff 高亮块 + Accept 按钮（Accept 后标记已接受，视觉反馈）。 */
function DiffBlock({ diff }: { diff: string }) {
  const [accepted, setAccepted] = useState(false)
  const lines = diff.split('\n')
  return (
    <div className="mt-2 overflow-hidden rounded-md ring-1 ring-border">
      <div className="flex items-center justify-between bg-neutral-2 px-3 py-1">
        <span className="font-mono text-caption-10 uppercase tracking-wider text-neutral-6">
          suggested edit
        </span>
        <button
          type="button"
          onClick={() => setAccepted(true)}
          disabled={accepted}
          className="btn-primary text-label-12"
        >
          {accepted ? '已接受' : 'Accept'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-neutral-1 px-3 py-2 font-mono text-label-12">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.startsWith('+')
                ? 'text-success'
                : line.startsWith('-')
                  ? 'text-error'
                  : 'text-neutral-7'
            }
          >
            {line ?? ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}
