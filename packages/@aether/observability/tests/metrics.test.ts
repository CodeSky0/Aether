// @aether/observability · 指标原语单测
// 覆盖 Counter / Histogram / MetricsRegistry 的核心行为与 Prometheus 文本导出合规性。
import { describe, it, expect } from 'vitest'

import {
  Counter,
  Histogram,
  createMetricsRegistry,
  DEFAULT_HISTOGRAM_BUCKETS,
} from '../src/index.js'

describe('Counter', () => {
  it('inc 累加，get 读取', () => {
    const c = new Counter({ name: 'test_total', help: 'test counter' }, true)
    c.inc()
    c.inc(2)
    expect(c.get()).toBe(3)
  })

  it('按 label 分序列', () => {
    const c = new Counter(
      { name: 'conn_total', help: 'connections', labelNames: ['status'] },
      true,
    )
    c.inc(1, { status: 'success' })
    c.inc(1, { status: 'success' })
    c.inc(1, { status: 'failure' })
    expect(c.get({ status: 'success' })).toBe(2)
    expect(c.get({ status: 'failure' })).toBe(1)
    expect(c.get({ status: 'other' })).toBe(0)
  })

  it('负数抛错（单调性）', () => {
    const c = new Counter({ name: 'x', help: 'x' }, true)
    expect(() => c.inc(-1)).toThrow()
  })

  it('render 输出 Prometheus 文本格式', () => {
    const c = new Counter(
      { name: 'requests_total', help: 'total requests', labelNames: ['method'] },
      true,
    )
    c.inc(5, { method: 'GET' })
    c.inc(3, { method: 'POST' })
    const text = c.render()
    expect(text).toContain('# HELP requests_total total requests')
    expect(text).toContain('# TYPE requests_total counter')
    expect(text).toContain('requests_total{method="GET"} 5')
    expect(text).toContain('requests_total{method="POST"} 3')
  })

  it('disabled 模式 no-op', () => {
    const c = new Counter({ name: 'x', help: 'x' }, false)
    c.inc()
    c.inc(10)
    expect(c.get()).toBe(0)
    expect(c.render()).not.toContain('x 1')
  })
})

describe('Histogram', () => {
  it('observe 累加到 bucket，sum/count 正确', () => {
    const h = new Histogram(
      { name: 'latency', help: 'latency', buckets: [0.1, 0.5, 1] },
      true,
    )
    h.observe(0.05)
    h.observe(0.3)
    h.observe(0.7)
    h.observe(2)
    const s = h.get()
    expect(s?.count).toBe(4)
    expect(s?.sum).toBeCloseTo(3.05, 5)
    expect(s?.counts[0]).toBe(1)
    expect(s?.counts[1]).toBe(2)
    expect(s?.counts[2]).toBe(3)
  })

  it('按 label 分序列', () => {
    const h = new Histogram(
      {
        name: 'persist',
        help: 'persist',
        buckets: [0.5],
        labelNames: ['op'],
      },
      true,
    )
    h.observe(0.1, { op: 'write' })
    h.observe(0.6, { op: 'write' })
    h.observe(0.2, { op: 'read' })
    expect(h.get({ op: 'write' })?.count).toBe(2)
    expect(h.get({ op: 'read' })?.count).toBe(1)
    expect(h.get({ op: 'write' })?.counts[0]).toBe(1)
    expect(h.get({ op: 'read' })?.counts[0]).toBe(1)
  })

  it('render 输出 _bucket / _sum / _count + +Inf 桶', () => {
    const h = new Histogram(
      { name: 'cold_start', help: 'cold start', buckets: [0.1, 0.5] },
      true,
    )
    h.observe(0.05)
    h.observe(0.3)
    const text = h.render()
    expect(text).toContain('# HELP cold_start cold start')
    expect(text).toContain('# TYPE cold_start histogram')
    expect(text).toContain('cold_start_bucket{le="0.1"} 1')
    expect(text).toContain('cold_start_bucket{le="0.5"} 2')
    expect(text).toContain('cold_start_bucket{le="+Inf"} 2')
    expect(text).toContain('cold_start_sum')
    expect(text).toContain('cold_start_count 2')
  })

  it('disabled 模式 no-op', () => {
    const h = new Histogram(
      { name: 'x', help: 'x', buckets: [1] },
      false,
    )
    h.observe(0.5)
    expect(h.get()).toBeUndefined()
  })
})

describe('MetricsRegistry', () => {
  it('注册 counter / histogram，render 合并输出', () => {
    const reg = createMetricsRegistry()
    const c = reg.counter({
      name: 'ops_total',
      help: 'operations',
      labelNames: ['kind'],
    })
    const h = reg.histogram({
      name: 'op_seconds',
      help: 'op duration',
      buckets: [0.1, 1],
    })
    c.inc(3, { kind: 'write' })
    h.observe(0.05)
    h.observe(0.5)

    const text = reg.render()
    expect(text).toContain('# TYPE ops_total counter')
    expect(text).toContain('ops_total{kind="write"} 3')
    expect(text).toContain('# TYPE op_seconds histogram')
    expect(text).toContain('op_seconds_bucket{le="0.1"} 1')
    expect(text).toContain('op_seconds_bucket{le="1"} 2')
    expect(text).toContain('op_seconds_count 2')
  })

  it('同名指标返回同一实例（幂等注册）', () => {
    const reg = createMetricsRegistry()
    const c1 = reg.counter({ name: 'x', help: 'x' })
    const c2 = reg.counter({ name: 'x', help: 'x' })
    expect(c1).toBe(c2)
  })

  it('空 registry render 返回空串', () => {
    const reg = createMetricsRegistry()
    expect(reg.render()).toBe('')
  })

  it('disabled 模式：所有 inc/observe no-op', () => {
    const reg = createMetricsRegistry({ enabled: false })
    expect(reg.isEnabled).toBe(false)
    const c = reg.counter({ name: 'x', help: 'x' })
    const h = reg.histogram({ name: 'y', help: 'y', buckets: [1] })
    c.inc(5)
    h.observe(0.5)
    expect(c.get()).toBe(0)
    expect(h.get()).toBeUndefined()
    expect(reg.render()).not.toContain('x 5')
  })

  it('label 值特殊字符转义（反斜杠 / 引号 / 换行）', () => {
    const reg = createMetricsRegistry()
    const c = reg.counter({
      name: 'esc_total',
      help: 'escape test',
      labelNames: ['path'],
    })
    c.inc(1, { path: 'a"b\\c\nd' })
    const text = reg.render()
    expect(text).toContain('esc_total{path="a\\"b\\\\c\\nd"} 1')
  })
})

describe('DEFAULT_HISTOGRAM_BUCKETS', () => {
  it('提供合理默认 bucket', () => {
    expect(DEFAULT_HISTOGRAM_BUCKETS.length).toBeGreaterThan(0)
    expect(DEFAULT_HISTOGRAM_BUCKETS[0]).toBeLessThan(DEFAULT_HISTOGRAM_BUCKETS[1])
  })
})
