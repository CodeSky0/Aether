// @aether/web · Toast 系统（Yohaku 复杂组件 2/4）
// 规则（Phase Shift Step 2 契约）：
//   位置：右下角 fixed；样式：bg-neutral-1 ring-1 ring-border text-neutral-9
//   text-copy-14 px-4 py-3 rounded-lg + 左侧 border-l-2 语义色
//   （info=縹 hanada / success=若竹 wakatake / error=蘇芳 suoh）
// 用法：在根布局挂 <ToastProvider>，任意 Client 组件内 useToast()。
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ToastVariant = 'info' | 'success' | 'error'

export interface ToastOptions {
  /** 自动消失时长（ms）；默认 4000，Infinity 表示常驻 */
  duration?: number
}

interface ToastItem {
  id: number
  variant: ToastVariant
  message: string
}

interface ToastApi {
  notify: (message: string, variant?: ToastVariant, options?: ToastOptions) => void
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const TOAST_DURATION_DEFAULT = 4000

const VARIANT_ACCENT_CLASS: Record<ToastVariant, string> = {
  info: 'border-l-info',
  success: 'border-l-success',
  error: 'border-l-error',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextIdRef = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (
      message: string,
      variant: ToastVariant = 'info',
      options?: ToastOptions,
    ) => {
      const id = nextIdRef.current++
      setToasts((prev) => [...prev, { id, variant, message }])
      const duration = options?.duration ?? TOAST_DURATION_DEFAULT
      if (Number.isFinite(duration)) {
        setTimeout(() => dismiss(id), duration)
      }
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      notify,
      success: (message, options) => notify(message, 'success', options),
      error: (message, options) => notify(message, 'error', options),
      info: (message, options) => notify(message, 'info', options),
    }),
    [notify],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) {
    throw new Error('useToast 必须在 <ToastProvider> 内使用')
  }
  return api
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: (id: number) => void
}) {
  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border-l-2 bg-neutral-1 px-4 py-3 text-copy-14 text-neutral-9 shadow-whisper ring-1 ring-border ${VARIANT_ACCENT_CLASS[toast.variant]}`}
      style={{ animation: 'yohaku-toast-in 0.2s ease-out both' }}
    >
      <p className="flex-1 break-words leading-relaxed">{toast.message}</p>
      <button
        type="button"
        aria-label="关闭通知"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 -mt-0.5 rounded px-1 text-label-12 text-neutral-5 transition hover:text-neutral-8"
      >
        ×
      </button>
    </div>
  )
}
