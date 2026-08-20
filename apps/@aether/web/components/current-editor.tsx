// @aether/web · Yjs Current 编辑器组件（轮询通道 + Server Actions 落库 + Entity Presence 光标）
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import {
  applyDocUpdate,
  deserializeUpdate,
  serializeUpdate,
  subscribeDocUpdates,
} from '@aether/current-sync'
import type { ActorType } from '@aether/types'
import {
  appendCurrentUpdate,
  getCurrentCursor,
  replayCurrentUpdates,
} from '@/app/actions/current'
import {
  deletePresence,
  getPresence,
  setPresence,
  type PresenceEntry,
} from '@/lib/presence'
interface CurrentEditorProps {
  realmId: string
  threadId: string
  /** 显式 doc_ref（如 file:{realmId}:{path}）；缺省为 thread:{threadId} */
  docRef?: string
  /** 选区变化回调；选区为空时回传 null（供 Thread 面板联动） */
  onSelectionChange?: (selection: { start: number; end: number; text: string } | null) => void
  /** 操作者身份；M1 阶段默认 entity */
  actorType?: ActorType
  actorId?: string
  actorName?: string
}
interface RemoteCursor {
  sessionId: string
  actorName: string
  cursorOffset: number
  selectionStart: number | null
  selectionEnd: number | null
  color: string
}
const REMOTE_ORIGIN = Symbol('channel-remote')
const CONTENT_MAP_KEY = 'content'
const CONTENT_TEXT_KEY = 'text'
const PRESENCE_POLL_MS = 2000
const PRESENCE_HEARTBEAT_MS = 3000
const CONNECT_RETRY_MS = 3000
const CONNECT_MAX_RETRIES = 10
const CURSOR_PALETTE = [
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#eab308', // yellow
]
/** 会话 ID → 稳定配色（同一实体多次进入颜色一致） */
function colorForSession(sessionId: string): string {
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) | 0
  }
  return CURSOR_PALETTE[Math.abs(hash) % CURSOR_PALETTE.length]!
}
/** 确保 Y.Doc 内有 content Map + content Text，不存在则初始化。 */
function ensureContentText(doc: Y.Doc): Y.Text {
  const map = doc.getMap(CONTENT_MAP_KEY)
  const existing = map.get(CONTENT_TEXT_KEY)
  if (existing instanceof Y.Text) return existing
  const text = new Y.Text('')
  map.set(CONTENT_TEXT_KEY, text)
  return text
}
function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  if (offset <= 0) return { line: 0, col: 0 }
  const truncated = text.slice(0, offset)
  const lines = truncated.split('\n')
  return { line: lines.length - 1, col: lines[lines.length - 1]!.length }
}
/**
 * 计算两段文本的最小编辑：公共前缀 + 公共后缀，中间部分做 delete+insert。
 * 避免每次 input 都全量 delete(0,len)+insert(0,newText) 产生巨大 Yjs update。
 */
function applyTextDiff(yText: Y.Text, oldText: string, newText: string): void {
  if (oldText === newText) return
  // 公共前缀长度
  let prefixLen = 0
  const minLen = Math.min(oldText.length, newText.length)
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++
  }
  // 公共后缀长度（从末尾比较）
  let suffixLen = 0
  while (
    suffixLen < minLen - prefixLen &&
    oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) {
    suffixLen++
  }
  const deleteStart = prefixLen
  const deleteCount = oldText.length - prefixLen - suffixLen
  const insertText = newText.slice(prefixLen, newText.length - suffixLen)
  if (deleteCount > 0) {
    yText.delete(deleteStart, deleteCount)
  }
  if (insertText.length > 0) {
    yText.insert(deleteStart, insertText)
  }
}
export default function CurrentEditor({
  realmId,
  threadId,
  docRef: docRefProp,
  onSelectionChange,
  actorType = 'entity',
  actorId = 'web-client',
  actorName = actorId,
}: CurrentEditorProps) {
  const resolvedDocRef = docRefProp ?? `thread:${threadId}`
  const docRefRef = useRef(resolvedDocRef)
  docRefRef.current = resolvedDocRef
  const doc = useRef(new Y.Doc()).current
  const clientRef = useRef<{
    localSeq: number | null
    remoteCursor: number | null
    polling: boolean
  }>({
    localSeq: null,
    remoteCursor: null,
    polling: false,
  })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [connected, setConnected] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([])
  const [textValue, setTextValue] = useState('')
  // 每次挂载生成稳定会话 ID（同页多开可互相看到光标）
  const sessionIdRef = useRef(`session-${actorId}-${Math.random().toString(36).slice(2, 8)}`)
  // 初始化 Y.Doc：确保 content 分区存在
  useEffect(() => {
    ensureContentText(doc)
    // 监听本地 update → 落库
    // P2-24 修复：过滤远端 origin，避免把轮询收到的远端 update 再写回服务端，
    // 形成回声放大（每次轮询都会重新落库一条重复增量）。
    const stopSubscribe = subscribeDocUpdates(doc, (update, origin) => {
      if (origin === REMOTE_ORIGIN) return
      const serialized = serializeUpdate(update)
      setSaving(true)
      appendCurrentUpdate({
        realmId,
        docRef: docRefRef.current,
        serializedPayload: serialized,
        idempotencyKey: `${sessionIdRef.current}:${Date.now()}-${Math.random()}`,
      })
        .then(() => setSaving(false))
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err))
          setSaving(false)
        })
    })
    // 轮询远端更新
    let pollTimer: ReturnType<typeof setInterval> | null = null
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }
    const pollOnce = async () => {
      const state = clientRef.current
      if (state.polling) return
      state.polling = true
      try {
        let hasMore = true
        while (hasMore) {
          const result = await replayCurrentUpdates(
            realmId,
            docRefRef.current,
            state.remoteCursor,
            100,
          )
          for (const item of result.updates) {
            // P0-1 修复：不再按 actorId 前缀跳过自己的更新。
            // Yjs applyUpdate 对已包含内容幂等，服务端 (doc_ref, idempotency_key) 唯一约束已保证幂等。
            // 按 actorId 跳过会导致同默认 actorId 的多客户端互相看不到更新。
            const payload = (() => {
              try {
                return deserializeUpdate(item.serializedPayload)
              } catch {
                return null
              }
            })()
            if (payload) {
              applyDocUpdate(doc, payload, REMOTE_ORIGIN)
            }
            state.remoteCursor = item.seq
          }
          if (result.nextCursor !== null) {
            state.remoteCursor = result.nextCursor
          }
          hasMore = result.hasMore
        }
      } finally {
        state.polling = false
      }
    }
    pollTimer = setInterval(() => {
      void pollOnce()
    }, 2000)
    // 首次连接：获取当前游标 + 重放，失败时自动重试
    let connectRetries = 0
    let connectTimer: ReturnType<typeof setTimeout> | null = null
    const tryConnect = () => {
      getCurrentCursor(realmId, docRefRef.current)
        .then(({ cursor }) => {
          clientRef.current.remoteCursor = cursor
          clientRef.current.localSeq = cursor
          setConnected(true)
        })
        .catch(() => {
          connectRetries++
          if (connectRetries < CONNECT_MAX_RETRIES) {
            setError(`连接中断，正在重试…（${connectRetries}/${CONNECT_MAX_RETRIES}）`)
            connectTimer = setTimeout(tryConnect, CONNECT_RETRY_MS)
          } else {
            setConnected(false)
            setError('连接失败。请检查网络后刷新重试。')
          }
        })
    }
    tryConnect()
    void pollOnce()
    return () => {
      stopSubscribe()
      stopPolling()
      if (connectTimer) clearTimeout(connectTimer)
    }
  }, [realmId, threadId, actorType, actorId, doc])
  // Presence：心跳上报 + 轮询远端光标
  useEffect(() => {
    let stopped = false
    const reportPresence = async () => {
      const textarea = textareaRef.current
      const offset = textarea?.selectionStart ?? 0
      try {
        await setPresence(realmId, resolvedDocRef, sessionIdRef.current, {
          actor_id: actorId,
          actor_type: actorType,
          actor_name: actorName,
          cursor_offset: offset,
          selection_start: textarea?.selectionDirection === 'backward'
            ? textarea.selectionEnd
            : (textarea?.selectionStart ?? null),
          selection_end: textarea?.selectionEnd ?? null,
        })
      } catch {
        // 心跳失败静默重试；断网时远端靠 TTL 自动清理
      }
    }
    const pollPresence = async () => {
      try {
        const entries = await getPresence(realmId, resolvedDocRef, sessionIdRef.current)
        if (stopped) return
        setRemoteCursors(
          entries.map((e: PresenceEntry) => ({
            sessionId: e.actor_id + ':' + e.last_active_at,
            actorName: e.actor_name || e.actor_id,
            cursorOffset: e.cursor_offset,
            selectionStart: e.selection_start,
            selectionEnd: e.selection_end,
            color: colorForSession(e.actor_id),
          })),
        )
      } catch {
        // 轮询失败忽略，下轮重试
      }
    }
    void reportPresence()
    void pollPresence()
    const heartbeat = setInterval(() => {
      void reportPresence()
    }, PRESENCE_HEARTBEAT_MS)
    const poller = setInterval(() => {
      void pollPresence()
    }, PRESENCE_POLL_MS)
    return () => {
      stopped = true
      clearInterval(heartbeat)
      clearInterval(poller)
      void deletePresence(realmId, resolvedDocRef, sessionIdRef.current)
    }
  }, [realmId, resolvedDocRef, actorId, actorType, actorName])
  // 光标/选区变化 → 立即上报（节流：只在 selection 实际变化时）
  const lastSelectionRef = useRef('')
  const handleSelectionChange = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const key = `${textarea.selectionStart}:${textarea.selectionEnd}`
    if (key === lastSelectionRef.current) return
    lastSelectionRef.current = key
    void setPresence(realmId, resolvedDocRef, sessionIdRef.current, {
      actor_id: actorId,
      actor_type: actorType,
      actor_name: actorName,
      cursor_offset: textarea.selectionStart ?? 0,
      selection_start: textarea.selectionStart,
      selection_end: textarea.selectionEnd,
    }).catch(() => {
      // 上报失败静默
    })
    // 通知外部（Thread 面板）：非空选区 → 选中文本；空选区 → null
    if (onSelectionChange) {
      const start = textarea.selectionStart ?? 0
      const end = textarea.selectionEnd ?? 0
      onSelectionChange(
        start < end ? { start, end, text: textValue.slice(start, end) } : null,
      )
    }
  }
  // 同步 Y.Text ↔ textarea
  useEffect(() => {
    const yText = ensureContentText(doc)
    const textarea = textareaRef.current
    if (!textarea) return
    const sync = () => {
      const newText = yText.toJSON()
      setTextValue(newText)
      if (document.activeElement !== textarea && textarea.value !== newText) {
        textarea.value = newText
      }
    }
    yText.observe(sync)
    sync()
    const onInput = () => {
      const newText = textarea.value
      const currentText = yText.toJSON()
      if (newText !== currentText) {
        // P2-21 修复：使用差量同步而非全量替换
        applyTextDiff(yText, currentText, newText)
      }
    }
    textarea.addEventListener('input', onInput)
    return () => {
      yText.unobserve(sync)
      textarea.removeEventListener('input', onInput)
    }
  }, [doc])
  // 光标行/列（叠加层与 textarea 行高对齐用）
  const cursorPositions = useMemo(
    () =>
      remoteCursors.map((c) => ({
        ...c,
        ...offsetToLineCol(textValue, c.cursorOffset),
      })),
    [remoteCursors, textValue],
  )
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={`inline-flex h-2 w-2 rounded-full transition-colors ${
            connected ? 'bg-success' : 'animate-pulse bg-neutral-4'
          }`}
        />
        <span className="text-label-12 text-neutral-7">
          {connected ? '已连接（轮询中）' : '连接中…'}
        </span>
        {saving && <span className="text-label-12 text-accent">保存中…</span>}
        {remoteCursors.length > 0 && (
          <span className="text-label-12 text-neutral-6">
            {remoteCursors.length} 位实体在线
          </span>
        )}
      </div>
      {error && (
        <p className="rounded-md bg-error/10 px-3 py-2 text-label-12 text-error">{error}</p>
      )}
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="field min-h-64 w-full resize-y bg-paper p-4 font-mono leading-relaxed"
          placeholder="编辑 Current…（变更经 Server Actions 落库，2s 轮询同步远端与实体光标）"
          spellCheck={false}
          onSelect={handleSelectionChange}
          onKeyUp={handleSelectionChange}
          onMouseUp={handleSelectionChange}
        />
        {/* 远端实体光标叠加层（pointer-events 关闭，不挡输入） */}
        {cursorPositions.map((cursor) => (
          <div
            key={cursor.sessionId}
            className="pointer-events-none absolute flex items-start"
            style={{ left: '0.75rem', top: '0.75rem' }}
          >
            <div
              className="relative"
              style={{
                // P1-6 修复：使用合法 CSS，移除无效的 "ch * 0.6" 写法
                transform: `translateY(${cursor.line * 1.625}rem) translateX(${Math.min(cursor.col * 0.6, 90)}ch)`,
              }}
            >
              <span
                className="absolute inline-block h-4 w-0.5 animate-pulse rounded-sm"
                style={{ backgroundColor: cursor.color }}
              />
              <span
                className="absolute top-4 left-0 whitespace-nowrap rounded px-1 py-0.5 text-label-12 text-white"
                style={{ backgroundColor: cursor.color }}
              >
                {cursor.actorName}
              </span>
            </div>
          </div>
        ))}
      </div>
      {/* 在线实体图例 */}
      {remoteCursors.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-1">
          {remoteCursors.map((cursor) => (
            <div key={cursor.sessionId} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: cursor.color }}
              />
              <span className="text-label-12 text-neutral-6">{cursor.actorName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
