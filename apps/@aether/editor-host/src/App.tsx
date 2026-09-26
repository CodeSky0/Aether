// @aether/editor-host · App 壳。
// 支持从 URL 参数接收上下文：?realmId=xxx&filePath=/src/App.tsx&actorId=yyy&convergeUrl=wss://...
// 独立部署时由 Web 项目通过 iframe 嵌入；开发模式下也可独立访问。
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorPane, PresenceBar } from './components/EditorPane'
import { useEditorHost } from './hooks/useEditorHost'
import type { ProviderConnectionState } from '@aether/current-sync'

/**
 * 从 URL 查询参数解析编辑器上下文
 * 支持的参数：
 * - realmId / realmSlug: Realm 标识
 * - filePath: 默认打开的文件路径
 * - actorId: 当前用户标识
 * - actorName: 当前用户显示名
 * - convergeUrl: converge-server 地址（CF Worker 基址 wss://aether-converge.xxx.workers.dev，
 *   或旧版完整端点 wss://sync.cosky.top/api/ws）
 */
function getEditorContext() {
  const params = new URLSearchParams(window.location.search)
  
  return {
    realmId: params.get('realmId') || params.get('realmSlug') || `demo-${Math.random().toString(36).slice(2, 8)}`,
    filePath: params.get('filePath') || '/README.md',
    actorId: params.get('actorId') || `actor-${Math.random().toString(36).slice(2, 8)}`,
    actorName: params.get('actorName') || 'Anonymous',
    convergeUrl: params.get('convergeUrl') || undefined,
  }
}

export default function App() {
  const context = useMemo(() => getEditorContext(), [])
  const [connectionState, setConnectionState] = useState<ProviderConnectionState>('disconnected')

  const editorInit: Parameters<typeof useEditorHost>[0] = {
    realmSlug: context.realmId,
    actorId: context.actorId,
    filePath: context.filePath,
  }
  if (context.convergeUrl) {
    editorInit.convergeUrl = context.convergeUrl
  }
  const editor = useEditorHost(editorInit)

  // 订阅连接状态
  useEffect(() => {
    const unsubscribe = editor.host.provider.subscribeConnectionState?.(setConnectionState)
    return () => {
      unsubscribe?.()
    }
  }, [editor.host.provider])

  // 向父窗口（web 端 iframe 宿主）传递连接状态，供 DriftStatusBar 消费
  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage(
        { type: 'aether:editor-connection', state: connectionState },
        '*',
      )
    }
  }, [connectionState])

  // 种子机制：converge 重放后若文本仍空，向 parent（web）请求 GitHub 文件内容
  const seedRequestedRef = useRef(false)
  const editorTextRef = useRef(editor.text)
  editorTextRef.current = editor.text
  const editorSetTextRef = useRef((text: string) => editor.setText(text))
  editorSetTextRef.current = (text: string) => editor.setText(text)

  useEffect(() => {
    if (window.parent === window) return
    if (connectionState !== 'connected') return
    if (seedRequestedRef.current) return

    const timer = setTimeout(() => {
      if (editorTextRef.current.length === 0) {
        seedRequestedRef.current = true
        window.parent.postMessage(
          { type: 'aether:editor-request-content', path: context.filePath },
          '*',
        )
      }
    }, 1500)

    return () => clearTimeout(timer)
  }, [connectionState, context.filePath])

  // 监听 parent 消息：种子内容注入 + 保存请求回传
  useEffect(() => {
    if (window.parent === window) return

    const handler = (e: MessageEvent) => {
      const data: unknown = e.data
      if (typeof data !== 'object' || data === null) return
      const msg = data as Record<string, unknown>

      // 种子内容注入
      if (msg.type === 'aether:editor-content') {
        if (msg.path !== context.filePath) return
        if (typeof msg.content !== 'string') return
        if (editorTextRef.current.length === 0) {
          editorSetTextRef.current(msg.content)
        }
        return
      }

      // 保存请求：回传当前文本内容供 web 端提交到 GitHub
      if (msg.type === 'aether:editor-request-save') {
        if (window.parent !== window) {
          window.parent.postMessage(
            { type: 'aether:editor-save', path: context.filePath, content: editorTextRef.current },
            '*',
          )
        }
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [context.filePath])

  const connectionStatusText = useMemo(() => {
    switch (connectionState) {
      case 'connected':
        return '已连接'
      case 'connecting':
        return '连接中...'
      case 'disconnected':
        return context.convergeUrl ? '未连接' : '离线模式'
      default:
        return '未知'
    }
  }, [connectionState, context.convergeUrl])

  return (
    <div className="flex h-full flex-col bg-neutral-1">
      <header className="flex items-center justify-between border-b border-border px-4 py-2 bg-neutral-1">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-copy-14 font-medium text-neutral-9">Aether Editor</h1>
          <span className="font-mono text-label-12 text-neutral-6">
            {context.filePath}
          </span>
        </div>
        <PresenceBar
          presence={editor.presence}
          selfClientId={editor.selfClientId}
        />
      </header>
      <main className="min-h-0 flex-1">
        <EditorPane editor={editor} />
      </main>
      {/* 底部状态栏：显示协同服务状态 */}
      <footer className="border-t border-border px-4 py-1.5 font-mono text-caption-10 text-neutral-6 flex justify-between items-center">
        <span>Realm: {context.realmId}</span>
        <span className={connectionState === 'connected' ? 'text-green-6' : connectionState === 'connecting' ? 'text-yellow-6' : 'text-neutral-6'}>
          {connectionStatusText}
        </span>
      </footer>
    </div>
  )
}
