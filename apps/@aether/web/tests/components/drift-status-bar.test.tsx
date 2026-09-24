// @aether/web · DriftStatusBar 组件测试（Wave A：drift-status-bar.tsx）
// 守护：离线提示 / editor disconnected / connecting / connected 不显示 /
//       postMessage 状态切换 / online-offline 事件切换。
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import DriftStatusBar from '@/components/drift-status-bar'

beforeEach(() => {
  // jsdom 默认 navigator.onLine = true；每个用例前重置
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  })
})

afterEach(() => {
  cleanup()
})

describe('DriftStatusBar · 在线状态', () => {
  it('在线且 editor unknown（初始态）→ 不显示', () => {
    const { container } = render(<DriftStatusBar />)
    expect(container).toBeEmptyDOMElement()
  })

  it('离线 → 显示"离线模式"提示且不显示 editor 状态', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(<DriftStatusBar />)
    expect(screen.getByText(/离线模式/)).toBeInTheDocument()
    expect(screen.getByText(/IndexedDB 持久化/)).toBeInTheDocument()
    // 离线时不渲染 editor 状态分支
    expect(screen.queryByText(/未连接到 Converge/)).not.toBeInTheDocument()
  })

  it('online 事件触发后从离线恢复 → 状态条消失', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const { container } = render(<DriftStatusBar />)
    expect(screen.getByText(/离线模式/)).toBeInTheDocument()

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('offline 事件触发后 → 显示离线提示', () => {
    const { container } = render(<DriftStatusBar />)
    expect(container).toBeEmptyDOMElement()

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText(/离线模式/)).toBeInTheDocument()
  })
})

describe('DriftStatusBar · editor 连接状态（postMessage）', () => {
  function sendEditorMessage(state: string) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'aether:editor-connection', state },
        }),
      )
    })
  }

  it('disconnected → 显示"未连接到 Converge Server — 正在重试"', () => {
    render(<DriftStatusBar />)
    sendEditorMessage('disconnected')
    expect(screen.getByText(/未连接到 Converge Server/)).toBeInTheDocument()
    expect(screen.getByText(/正在重试/)).toBeInTheDocument()
  })

  it('connecting → 显示"正在 Converge..."', () => {
    render(<DriftStatusBar />)
    sendEditorMessage('connecting')
    expect(screen.getByText(/正在 Converge\.\.\./)).toBeInTheDocument()
  })

  it('connected → 不显示状态条', () => {
    const { container } = render(<DriftStatusBar />)
    sendEditorMessage('connected')
    expect(container).toBeEmptyDOMElement()
  })

  it('unknown → 不显示状态条', () => {
    const { container } = render(<DriftStatusBar />)
    sendEditorMessage('unknown')
    expect(container).toBeEmptyDOMElement()
  })

  it('状态切换 disconnected → connecting → connected 依次反映', () => {
    render(<DriftStatusBar />)
    sendEditorMessage('disconnected')
    expect(screen.getByText(/未连接到 Converge/)).toBeInTheDocument()

    sendEditorMessage('connecting')
    expect(screen.queryByText(/未连接到 Converge/)).not.toBeInTheDocument()
    expect(screen.getByText(/正在 Converge/)).toBeInTheDocument()

    sendEditorMessage('connected')
    expect(screen.queryByText(/正在 Converge/)).not.toBeInTheDocument()
  })
})

describe('DriftStatusBar · postMessage 类型守卫', () => {
  it('非 aether:editor-connection 消息被忽略，状态保持 unknown', () => {
    const { container } = render(<DriftStatusBar />)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'other-event', state: 'disconnected' },
        }),
      )
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('state 非 string 的消息被忽略', () => {
    const { container } = render(<DriftStatusBar />)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'aether:editor-connection', state: 123 },
        }),
      )
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('null data 被忽略', () => {
    const { container } = render(<DriftStatusBar />)
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: null }))
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('非对象 data 被忽略', () => {
    const { container } = render(<DriftStatusBar />)
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: 'string' }))
    })
    expect(container).toBeEmptyDOMElement()
  })
})

describe('DriftStatusBar · 离线优先级', () => {
  it('离线时即使 editor disconnected 也只显示离线提示', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(<DriftStatusBar />)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'aether:editor-connection', state: 'disconnected' },
        }),
      )
    })
    expect(screen.getByText(/离线模式/)).toBeInTheDocument()
    expect(screen.queryByText(/未连接到 Converge/)).not.toBeInTheDocument()
  })
})

describe('DriftStatusBar · 卸载清理', () => {
  it('卸载后移除事件监听（不抛错）', () => {
    const { unmount } = render(<DriftStatusBar />)
    expect(() => unmount()).not.toThrow()
    // 卸载后派发事件不应有副作用
    expect(() => {
      act(() => {
        window.dispatchEvent(new Event('offline'))
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'aether:editor-connection', state: 'disconnected' },
          }),
        )
      })
    }).not.toThrow()
  })
})

// 抑制未使用 vi import 警告（保留以备扩展）
void vi
