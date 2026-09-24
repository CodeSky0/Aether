// @aether/web · CommandPalette 组件测试（Wave B：command-palette.tsx）
// 守护 Cmd+K 双模式：导航模式（唤起/过滤/选择/执行/关闭）+ 提问模式（选区锚定/
// Thread 创建/onThreadCreated/错误显示）+ Realm 命令注入 + backdrop 关闭。
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

const mockCreateThread = vi.fn()
vi.mock('@/lib/threads', () => ({
  createThread: (...args: unknown[]) => mockCreateThread(...args),
}))

import CommandPalette from '@/components/ui/command-palette'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

/** 唤起命令面板：⌘K */
function openPalette() {
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
}

/** 关闭：Esc（在 dialog 上触发，冒泡到外层 onKeyDown） */
function closePalette() {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
}

describe('CommandPalette · 唤起与关闭', () => {
  it('初始不渲染 dialog', () => {
    render(<CommandPalette />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('⌘K 唤起 → 显示命令面板 dialog', () => {
    render(<CommandPalette />)
    openPalette()
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument()
  })

  it('Ctrl+K 唤起（非 Mac）', () => {
    render(<CommandPalette />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument()
  })

  it('再次 ⌘K 切换关闭', () => {
    render(<CommandPalette />)
    openPalette()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    openPalette()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Esc 关闭', () => {
    render(<CommandPalette />)
    openPalette()
    closePalette()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('backdrop 点击关闭', () => {
    render(<CommandPalette />)
    openPalette()
    // backdrop 是 dialog 外层的 absolute inset-0 div，aria-hidden
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('非 ⌘K 键不唤起', () => {
    render(<CommandPalette />)
    fireEvent.keyDown(window, { key: 'a', metaKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('CommandPalette · 导航模式命令列表', () => {
  it('默认显示全部命令（首页/Dashboard/所有 Realm/账户设置）', () => {
    render(<CommandPalette />)
    openPalette()
    expect(screen.getByText('首页')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('所有 Realm')).toBeInTheDocument()
    expect(screen.getByText('账户设置')).toBeInTheDocument()
  })

  it('currentRealmId 时追加 Realm 内命令', () => {
    render(
      <CommandPalette currentRealmId="realm-1" currentRealmName="我的 Realm" />,
    )
    openPalette()
    expect(screen.getByText('打开 Current')).toBeInTheDocument()
    expect(screen.getByText('审计记录')).toBeInTheDocument()
    expect(screen.getByText('成员管理')).toBeInTheDocument()
    expect(screen.getByText('Realm 设置')).toBeInTheDocument()
    // 分组标题显示 currentRealmName
    expect(screen.getByText('我的 Realm')).toBeInTheDocument()
  })

  it('currentRealmId 无 name 时分组用"当前 Realm"', () => {
    render(<CommandPalette currentRealmId="realm-1" />)
    openPalette()
    expect(screen.getByText('当前 Realm')).toBeInTheDocument()
  })

  it('输入过滤命令', () => {
    render(<CommandPalette />)
    openPalette()
    const input = screen.getByLabelText('搜索命令')
    fireEvent.change(input, { target: { value: 'dash' } })
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.queryByText('首页')).not.toBeInTheDocument()
    expect(screen.queryByText('所有 Realm')).not.toBeInTheDocument()
  })

  it('无匹配时显示"无匹配命令"', () => {
    render(<CommandPalette />)
    openPalette()
    fireEvent.change(screen.getByLabelText('搜索命令'), {
      target: { value: 'zzz不存在' },
    })
    expect(screen.getByText('无匹配命令')).toBeInTheDocument()
  })

  it('清空输入恢复全部命令', () => {
    render(<CommandPalette />)
    openPalette()
    const input = screen.getByLabelText('搜索命令')
    fireEvent.change(input, { target: { value: 'dash' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('首页')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })
})

describe('CommandPalette · 键盘选择与执行', () => {
  it('↓ 选择下一项', () => {
    render(<CommandPalette />)
    openPalette()
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    const options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('↑ 选择上一项（不越界）', () => {
    render(<CommandPalette />)
    openPalette()
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('Enter 执行选中命令 → router.push + 关闭', () => {
    render(<CommandPalette />)
    openPalette()
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter' })
    // 默认选中第一项"首页"→ push('/')
    expect(mockPush).toHaveBeenCalledWith('/')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('↓ 后 Enter 执行第二项命令', () => {
    render(<CommandPalette />)
    openPalette()
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    // 第二项是 Dashboard → push('/dashboard')
    expect(mockPush).toHaveBeenCalledWith('/dashboard')
  })

  it('点击命令项直接执行', () => {
    render(<CommandPalette />)
    openPalette()
    fireEvent.click(screen.getByText('所有 Realm'))
    expect(mockPush).toHaveBeenCalledWith('/realms')
  })

  it('过滤后 Enter 执行过滤结果首项', () => {
    render(<CommandPalette />)
    openPalette()
    fireEvent.change(screen.getByLabelText('搜索命令'), {
      target: { value: '账户' },
    })
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(mockPush).toHaveBeenCalledWith('/settings/profile')
  })
})

describe('CommandPalette · 提问模式（Cmd+K 双模式）', () => {
  const ASK_PROPS = {
    currentRealmId: 'realm-ask',
    currentRealmName: '提问 Realm',
    defaultProjectId: 'proj-ask',
    selection: { text: 'const x = 42', start: 0, end: 12 },
    onThreadCreated: vi.fn(),
  }

  it('有 selection + realmId + projectId → 唤起进入提问模式', () => {
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    expect(screen.getByRole('dialog', { name: '向 Entity 提问' })).toBeInTheDocument()
    expect(screen.getByText('向 Entity 提问')).toBeInTheDocument()
  })

  it('提问模式显示选区字符数与预览', () => {
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    expect(screen.getByText(/已锚定代码选区 · 12 字符/)).toBeInTheDocument()
    expect(screen.getByText('const x = 42')).toBeInTheDocument()
  })

  it('选区超 120 字符截断显示 …', () => {
    const longText = 'a'.repeat(200)
    render(
      <CommandPalette
        {...ASK_PROPS}
        selection={{ text: longText, start: 0, end: 200 }}
      />,
    )
    openPalette()
    // 预览只显示前 120 字符 + …
    expect(screen.getByText(/…/)).toBeInTheDocument()
  })

  it('提问模式 Esc 关闭', () => {
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    closePalette()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('提问模式 Enter 提交 → createThread + onThreadCreated + 关闭', async () => {
    mockCreateThread.mockResolvedValue({
      success: true,
      data: { id: 'thread-new', title: '为什么用 const' },
    })
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    const input = screen.getByLabelText('提问内容')
    fireEvent.change(input, { target: { value: '为什么用 const' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    expect(mockCreateThread).toHaveBeenCalledTimes(1)
    const callArg = mockCreateThread.mock.calls[0]![0] as {
      realmId: string
      projectId: string
      title: string
      codeAnchor: string
    }
    expect(callArg.realmId).toBe('realm-ask')
    expect(callArg.projectId).toBe('proj-ask')
    expect(callArg.title).toBe('为什么用 const')
    expect(callArg.codeAnchor).toBe('const x = 42')

    expect(ASK_PROPS.onThreadCreated).toHaveBeenCalledWith(
      'thread-new',
      '为什么用 const',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('提问模式空内容 → 提交按钮 disabled', () => {
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    expect(screen.getByRole('button', { name: '发起 Thread' })).toBeDisabled()
  })

  it('提问模式输入后 → 提交按钮 enabled', () => {
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    fireEvent.change(screen.getByLabelText('提问内容'), {
      target: { value: '问题' },
    })
    expect(screen.getByRole('button', { name: '发起 Thread' })).toBeEnabled()
  })

  it('点击"发起 Thread"按钮提交', async () => {
    mockCreateThread.mockResolvedValue({
      success: true,
      data: { id: 't2', title: '问题' },
    })
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    fireEvent.change(screen.getByLabelText('提问内容'), {
      target: { value: '问题' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发起 Thread' }))
    })
    expect(mockCreateThread).toHaveBeenCalledTimes(1)
    expect(ASK_PROPS.onThreadCreated).toHaveBeenCalled()
  })

  it('createThread 返回 success=false → 显示 error 且不关闭', async () => {
    mockCreateThread.mockResolvedValue({
      success: false,
      error: 'Realm 已归档',
    })
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    const input = screen.getByLabelText('提问内容')
    fireEvent.change(input, { target: { value: '问题' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(screen.getByText('Realm 已归档')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(ASK_PROPS.onThreadCreated).not.toHaveBeenCalled()
  })

  it('createThread 抛异常 → 显示异常 message', async () => {
    mockCreateThread.mockRejectedValue(new Error('网络故障'))
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    const input = screen.getByLabelText('提问内容')
    fireEvent.change(input, { target: { value: '问题' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(screen.getByText('网络故障')).toBeInTheDocument()
  })

  it('Shift+Enter 不提交（换行）', async () => {
    render(<CommandPalette {...ASK_PROPS} />)
    openPalette()
    const input = screen.getByLabelText('提问内容')
    fireEvent.change(input, { target: { value: '问题' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(mockCreateThread).not.toHaveBeenCalled()
  })
})

describe('CommandPalette · 提问模式启用条件', () => {
  it('selection 为 null → 导航模式', () => {
    render(
      <CommandPalette
        currentRealmId="r"
        defaultProjectId="p"
        selection={null}
      />,
    )
    openPalette()
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument()
  })

  it('selection.text 为空 → 导航模式', () => {
    render(
      <CommandPalette
        currentRealmId="r"
        defaultProjectId="p"
        selection={{ text: '', start: 0, end: 0 }}
      />,
    )
    openPalette()
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument()
  })

  it('无 currentRealmId → 导航模式', () => {
    render(
      <CommandPalette
        defaultProjectId="p"
        selection={{ text: 'x', start: 0, end: 1 }}
      />,
    )
    openPalette()
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument()
  })

  it('无 defaultProjectId → 导航模式', () => {
    render(
      <CommandPalette
        currentRealmId="r"
        selection={{ text: 'x', start: 0, end: 1 }}
      />,
    )
    openPalette()
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument()
  })
})
