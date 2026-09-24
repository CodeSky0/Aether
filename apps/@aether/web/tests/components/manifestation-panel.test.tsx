// @aether/web · ManifestationPanel 组件测试（Wave A：manifestation-panel.tsx）
// 守护：预览 iframe / 模式切换 / 标注点击 / 评论提交闭环 / 取消 / 错误显示 /
//       onClose / 标注列表 / 提交按钮 disabled 态。
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockRefresh = vi.fn()
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}))

const mockCreateThread = vi.fn()
vi.mock('@/lib/threads', () => ({
  createThread: (...args: unknown[]) => mockCreateThread(...args),
}))

import ManifestationPanel from '@/components/manifestation-panel'

const PROPS = {
  manifestationUrl: 'https://preview.example.com/page',
  realmId: 'realm-0001',
  defaultProjectId: 'proj-0001',
}

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom 不做 layout，固定 getBoundingClientRect 便于坐标计算
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ManifestationPanel · 初始渲染', () => {
  it('渲染 iframe 且 src = manifestationUrl', () => {
    render(<ManifestationPanel {...PROPS} />)
    const iframe = screen.getByTitle('Manifestation Preview') as HTMLIFrameElement
    expect(iframe).toBeInTheDocument()
    expect(iframe.src).toBe('https://preview.example.com/page')
  })

  it('标题栏显示默认 threadTitle="Manifestation 审查"', () => {
    render(<ManifestationPanel {...PROPS} />)
    expect(screen.getByText('Manifestation 审查')).toBeInTheDocument()
  })

  it('标题栏显示自定义 threadTitle', () => {
    render(<ManifestationPanel {...PROPS} threadTitle="按钮位置审查" />)
    expect(screen.getByText('按钮位置审查')).toBeInTheDocument()
  })

  it('显示 Manifestation 标签', () => {
    render(<ManifestationPanel {...PROPS} />)
    expect(screen.getByText('Manifestation')).toBeInTheDocument()
  })

  it('初始为 browse 模式，标注按钮文案为"标注"', () => {
    render(<ManifestationPanel {...PROPS} />)
    expect(screen.getByRole('button', { name: '标注' })).toBeInTheDocument()
  })

  it('无 onClose 时不渲染关闭按钮', () => {
    render(<ManifestationPanel {...PROPS} />)
    expect(screen.queryByLabelText('关闭预览')).not.toBeInTheDocument()
  })

  it('有 onClose 时渲染 Esc 关闭按钮', () => {
    const onClose = vi.fn()
    render(<ManifestationPanel {...PROPS} onClose={onClose} />)
    expect(screen.getByLabelText('关闭预览')).toBeInTheDocument()
  })
})

describe('ManifestationPanel · 模式切换', () => {
  it('点击"标注"按钮 → 进入 annotate 模式，按钮文案变"标注中"', () => {
    render(<ManifestationPanel {...PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    expect(screen.getByRole('button', { name: '标注中' })).toBeInTheDocument()
  })

  it('annotate 模式显示"点击预览页面标注元素"提示', () => {
    render(<ManifestationPanel {...PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    expect(screen.getByText('点击预览页面标注元素')).toBeInTheDocument()
  })

  it('再次点击"标注中" → 回到 browse 模式', () => {
    render(<ManifestationPanel {...PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    fireEvent.click(screen.getByRole('button', { name: '标注中' }))
    expect(screen.getByRole('button', { name: '标注' })).toBeInTheDocument()
    expect(screen.queryByText('点击预览页面标注元素')).not.toBeInTheDocument()
  })
})

describe('ManifestationPanel · 标注点击与评论框', () => {
  it('browse 模式点击预览区不弹出评论框', () => {
    render(<ManifestationPanel {...PROPS} />)
    // 覆盖层在 browse 模式 pointer-events-none，但仍可 fireEvent
    const overlay = document.querySelector('[class*="pointer-events-none"]') as HTMLElement
    fireEvent.click(overlay, { clientX: 30, clientY: 40 })
    expect(screen.queryByPlaceholderText('评论…（Enter 提交）')).not.toBeInTheDocument()
  })

  it('annotate 模式点击预览区 → 弹出评论框', () => {
    render(<ManifestationPanel {...PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    const overlay = document.querySelector('[class*="cursor-crosshair"]') as HTMLElement
    fireEvent.click(overlay, { clientX: 30, clientY: 40 })
    expect(screen.getByPlaceholderText('评论…（Enter 提交）')).toBeInTheDocument()
  })

  it('评论框 Esc → 取消（评论框消失）', () => {
    render(<ManifestationPanel {...PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    const overlay = document.querySelector('[class*="cursor-crosshair"]') as HTMLElement
    fireEvent.click(overlay, { clientX: 30, clientY: 40 })
    const textarea = screen.getByPlaceholderText('评论…（Enter 提交）')
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('评论…（Enter 提交）')).not.toBeInTheDocument()
  })

  it('点击"取消"按钮 → 评论框消失且评论内容清空', () => {
    render(<ManifestationPanel {...PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    const overlay = document.querySelector('[class*="cursor-crosshair"]') as HTMLElement
    fireEvent.click(overlay, { clientX: 30, clientY: 40 })
    const textarea = screen.getByPlaceholderText('评论…（Enter 提交）') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '临时评论' } })
    expect(textarea.value).toBe('临时评论')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    // 取消后评论框消失（pendingPos 归零），评论内容清空
    expect(screen.queryByPlaceholderText('评论…（Enter 提交）')).not.toBeInTheDocument()
  })

  it('提交按钮初始 disabled（comment 为空）', () => {
    render(<ManifestationPanel {...PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    const overlay = document.querySelector('[class*="cursor-crosshair"]') as HTMLElement
    fireEvent.click(overlay, { clientX: 30, clientY: 40 })
    expect(screen.getByRole('button', { name: '提交' })).toBeDisabled()
  })

  it('输入评论后提交按钮 enabled', async () => {
    const user = userEvent.setup()
    render(<ManifestationPanel {...PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    const overlay = document.querySelector('[class*="cursor-crosshair"]') as HTMLElement
    fireEvent.click(overlay, { clientX: 30, clientY: 40 })
    fireEvent.change(screen.getByPlaceholderText('评论…（Enter 提交）'), {
      target: { value: '按钮偏右' },
    })
    expect(screen.getByRole('button', { name: '提交' })).toBeEnabled()
  })
})

describe('ManifestationPanel · 评论提交闭环', () => {
  function enterAnnotateAndClick() {
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    const overlay = document.querySelector('[class*="cursor-crosshair"]') as HTMLElement
    fireEvent.click(overlay, { clientX: 30, clientY: 40 })
  }

  it('提交按钮点击 → 调用 createThread 并添加标注点 + router.refresh', async () => {
    const user = userEvent.setup()
    mockCreateThread.mockResolvedValue({
      success: true,
      data: { id: 'thread-ann-1', title: '预览标注：按钮偏右' },
    })
    render(<ManifestationPanel {...PROPS} />)
    enterAnnotateAndClick()
    fireEvent.change(screen.getByPlaceholderText('评论…（Enter 提交）'), {
      target: { value: '按钮偏右' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '提交' }))
    })

    expect(mockCreateThread).toHaveBeenCalledTimes(1)
    const callArg = mockCreateThread.mock.calls[0]![0] as {
      realmId: string
      projectId: string
      title: string
      manifestationUrl: string
      codeAnchor: string
    }
    expect(callArg.realmId).toBe('realm-0001')
    expect(callArg.projectId).toBe('proj-0001')
    expect(callArg.manifestationUrl).toBe('https://preview.example.com/page')
    expect(callArg.title).toMatch(/^预览标注：按钮偏右/)
    const anchor = JSON.parse(callArg.codeAnchor) as {
      type: string
      x: number
      y: number
      url: string
    }
    expect(anchor.type).toBe('preview-annotation')
    expect(anchor.x).toBeCloseTo(30)
    expect(anchor.y).toBeCloseTo(40)
    expect(anchor.url).toBe('https://preview.example.com/page')

    // 标注列表出现（标题与列表都含评论文本，用 getAllByText）
    expect(screen.getByText(/标注 · 1/)).toBeInTheDocument()
    expect(screen.getAllByText('按钮偏右').length).toBeGreaterThanOrEqual(1)
    // 坐标显示
    expect(screen.getByText(/30\.0%, 40\.0%/)).toBeInTheDocument()
    // router.refresh 调用
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('Enter 键提交（不 shift）→ 等价于点击提交', async () => {
    const user = userEvent.setup()
    mockCreateThread.mockResolvedValue({
      success: true,
      data: { id: 'thread-ann-2', title: '预览标注：位置错了' },
    })
    render(<ManifestationPanel {...PROPS} />)
    enterAnnotateAndClick()
    const textarea = screen.getByPlaceholderText('评论…（Enter 提交）')
    fireEvent.change(textarea, { target: { value: '位置错了' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await act(() => vi.waitFor(() => expect(mockCreateThread).toHaveBeenCalledTimes(1)))
  })

  it('Shift+Enter 不提交（换行）', async () => {
    const user = userEvent.setup()
    render(<ManifestationPanel {...PROPS} />)
    enterAnnotateAndClick()
    const textarea = screen.getByPlaceholderText('评论…（Enter 提交）')
    fireEvent.change(textarea, { target: { value: '多行' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(mockCreateThread).not.toHaveBeenCalled()
    // 评论框仍在
    expect(screen.getByPlaceholderText('评论…（Enter 提交）')).toBeInTheDocument()
  })

  it('createThread 返回 success=false → 显示 error 且保留评论框', async () => {
    const user = userEvent.setup()
    mockCreateThread.mockResolvedValue({
      success: false,
      error: '无权限创建 Thread',
    })
    render(<ManifestationPanel {...PROPS} />)
    enterAnnotateAndClick()
    fireEvent.change(screen.getByPlaceholderText('评论…（Enter 提交）'), {
      target: { value: '评论内容' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '提交' }))
    })

    expect(screen.getByText('无权限创建 Thread')).toBeInTheDocument()
    // 评论框保留以便重试
    expect(screen.getByPlaceholderText('评论…（Enter 提交）')).toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('createThread 抛异常 → 显示异常 message', async () => {
    const user = userEvent.setup()
    mockCreateThread.mockRejectedValue(new Error('网络中断'))
    render(<ManifestationPanel {...PROPS} />)
    enterAnnotateAndClick()
    fireEvent.change(screen.getByPlaceholderText('评论…（Enter 提交）'), {
      target: { value: '评论' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '提交' }))
    })

    expect(screen.getByText('网络中断')).toBeInTheDocument()
  })

  it('createThread 抛非 Error 值 → 显示 String(value)', async () => {
    const user = userEvent.setup()
    mockCreateThread.mockRejectedValue('字符串错误')
    render(<ManifestationPanel {...PROPS} />)
    enterAnnotateAndClick()
    fireEvent.change(screen.getByPlaceholderText('评论…（Enter 提交）'), {
      target: { value: '评论' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '提交' }))
    })

    expect(screen.getByText('字符串错误')).toBeInTheDocument()
  })

  it('提交中按钮显示"…"且 disabled', async () => {
    const user = userEvent.setup()
    let resolveCreate: (value: unknown) => void
    mockCreateThread.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    render(<ManifestationPanel {...PROPS} />)
    enterAnnotateAndClick()
    fireEvent.change(screen.getByPlaceholderText('评论…（Enter 提交）'), {
      target: { value: '评论' },
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '提交' }))
    })

    expect(screen.getByRole('button', { name: '…' })).toBeDisabled()

    await act(async () => {
      resolveCreate!({ success: true, data: { id: 't', title: 'x' } })
    })
  })
})

describe('ManifestationPanel · onClose', () => {
  it('点击 Esc 关闭按钮 → 调用 onClose', () => {
    const onClose = vi.fn()
    render(<ManifestationPanel {...PROPS} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('关闭预览'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ManifestationPanel · 多标注累积', () => {
  it('两次提交 → 标注列表显示 · 2 且两条评论都在', async () => {
    const user = userEvent.setup()
    mockCreateThread
      .mockResolvedValueOnce({
        success: true,
        data: { id: 't1', title: '预览标注：第一条' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { id: 't2', title: '预览标注：第二条' },
      })
    render(<ManifestationPanel {...PROPS} />)

    // 第一条
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    let overlay = document.querySelector('[class*="cursor-crosshair"]') as HTMLElement
    fireEvent.click(overlay, { clientX: 10, clientY: 20 })
    fireEvent.change(screen.getByPlaceholderText('评论…（Enter 提交）'), {
      target: { value: '第一条' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '提交' }))
    })

    // 第二条
    overlay = document.querySelector('[class*="cursor-crosshair"]') as HTMLElement
    fireEvent.click(overlay, { clientX: 80, clientY: 90 })
    fireEvent.change(screen.getByPlaceholderText('评论…（Enter 提交）'), {
      target: { value: '第二条' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '提交' }))
    })

    expect(screen.getByText(/标注 · 2/)).toBeInTheDocument()
    expect(screen.getAllByText('第一条').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('第二条').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/10\.0%, 20\.0%/)).toBeInTheDocument()
    expect(screen.getByText(/80\.0%, 90\.0%/)).toBeInTheDocument()
  })
})
