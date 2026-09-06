// @aether/web · Drift 状态条
// 显示 Current 连接状态：离线模式 / 未连接 / 收敛中
// 离线时提示变更本地保存（IndexedDB Drift），重连后自动 Converge
// 在线且已连接时不显示（保持界面克制）
'use client'

import { useEffect, useState } from 'react'

/** 浏览器层在线状态（navigator.onLine + online/offline 事件） */
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    setOnline(navigator.onLine)
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])
  return online
}

/** editor-host iframe 通过 postMessage 传递的连接状态 */
export type EditorConnectionState =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'unknown'

/** postMessage 消息体类型守卫 */
interface EditorConnectionMessage {
  type: 'aether:editor-connection'
  state: string
}

function isEditorConnectionMessage(
  data: unknown,
): data is EditorConnectionMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).type === 'aether:editor-connection' &&
    typeof (data as Record<string, unknown>).state === 'string'
  )
}

function useEditorConnection(): EditorConnectionState {
  const [state, setState] = useState<EditorConnectionState>('unknown')
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (isEditorConnectionMessage(e.data)) {
        setState(e.data.state as EditorConnectionState)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])
  return state
}

/** Drift 状态条：仅在非理想状态时显示 */
export default function DriftStatusBar() {
  const online = useOnlineStatus()
  const editorConnection = useEditorConnection()

  // 离线：梅红提示，变更本地保存
  if (!online) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-error/5 px-4 py-1.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-error" />
        <span className="font-mono text-caption-10 text-error">
          离线模式 — 变更由 IndexedDB 持久化，重连后自动 Converge
        </span>
      </div>
    )
  }

  // 在线但 editor 未连接：警告色，正在重试
  if (editorConnection === 'disconnected') {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/5 px-4 py-1.5">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warning" />
        <span className="font-mono text-caption-10 text-warning">
          未连接到 Converge Server — 正在重试
        </span>
      </div>
    )
  }

  // 收敛中：中性色，短暂状态
  if (editorConnection === 'connecting') {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-neutral-2 px-4 py-1.5">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-neutral-5" />
        <span className="font-mono text-caption-10 text-neutral-7">
          正在 Converge...
        </span>
      </div>
    )
  }

  // 在线且已连接（或未知初始态）：不显示
  return null
}
