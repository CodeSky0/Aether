// @aether/observability · 可观测性层
// 提供结构化日志、遥测采集、Converge Telemetry 指标。
// 纯内存指标原语（Counter / Histogram / MetricsRegistry）+ Prometheus 文本导出，
// 无外部依赖，serverless 每实例独立采集，跨实例聚合由 Prometheus scrape 或
// Log Drains 外部完成。
export interface CounterOptions {
  name: string
  help: string
  labelNames?: readonly string[]
}

export interface HistogramOptions {
  name: string
  help: string
  buckets?: readonly number[]
  labelNames?: readonly string[]
}

export interface MetricsRegistryOptions {
  enabled?: boolean
}

export const DEFAULT_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const

function labelKey(
  labelNames: readonly string[],
  labels?: Record<string, string>,
): string {
  if (labelNames.length === 0) return ''
  const parts: string[] = []
  for (const name of labelNames) {
    parts.push(`${name}=${labels?.[name] ?? ''}`)
  }
  return parts.join(',')
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function formatLabels(labels: Array<[string, string]>): string {
  if (labels.length === 0) return ''
  const parts = labels.map(
    ([k, v]) => `${k}="${escapeLabelValue(v)}"`,
  )
  return `{${parts.join(',')}}`
}

export class Counter {
  public readonly name: string
  public readonly help: string
  private readonly labelNames: readonly string[]
  private readonly values = new Map<string, number>()
  private readonly enabled: boolean

  public constructor(
    options: CounterOptions,
    enabled: boolean,
  ) {
    this.name = options.name
    this.help = options.help
    this.labelNames = options.labelNames ?? []
    this.enabled = enabled
  }

  public inc(
    value = 1,
    labels?: Record<string, string>,
  ): void {
    if (!this.enabled) return
    if (value < 0) throw new Error(`Counter.inc requires non-negative value: ${value}`)
    const key = labelKey(this.labelNames, labels)
    this.values.set(key, (this.values.get(key) ?? 0) + value)
  }

  public get(
    labels?: Record<string, string>,
  ): number {
    return this.values.get(labelKey(this.labelNames, labels)) ?? 0
  }

  public *entries(): IterableIterator<{
    labels: Record<string, string>
    value: number
  }> {
    for (const [key, value] of this.values) {
      const labels: Record<string, string> = {}
      if (key !== '') {
        for (const part of key.split(',')) {
          const eq = part.indexOf('=')
          if (eq > 0) labels[part.slice(0, eq)] = part.slice(eq + 1)
        }
      }
      yield { labels, value }
    }
  }

  public render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ]
    for (const { labels, value } of this.entries()) {
      const labelPairs = this.labelNames.map((n) => [n, labels[n] ?? ''] as [string, string])
      lines.push(`${this.name}${formatLabels(labelPairs)} ${value}`)
    }
    return lines.join('\n')
  }
}

interface HistogramSeries {
  buckets: readonly number[]
  counts: number[]
  sum: number
  count: number
}

export class Histogram {
  public readonly name: string
  public readonly help: string
  private readonly labelNames: readonly string[]
  private readonly buckets: readonly number[]
  private readonly series = new Map<string, HistogramSeries>()
  private readonly enabled: boolean

  public constructor(
    options: HistogramOptions,
    enabled: boolean,
  ) {
    this.name = options.name
    this.help = options.help
    this.labelNames = options.labelNames ?? []
    this.buckets = options.buckets ?? DEFAULT_HISTOGRAM_BUCKETS
    this.enabled = enabled
  }

  public observe(
    value: number,
    labels?: Record<string, string>,
  ): void {
    if (!this.enabled) return
    const key = labelKey(this.labelNames, labels)
    let s = this.series.get(key)
    if (s === undefined) {
      s = {
        buckets: this.buckets,
        counts: new Array<number>(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      }
      this.series.set(key, s)
    }
    for (let i = 0; i < this.buckets.length; i++) {
      const bucket = this.buckets[i]
      if (bucket !== undefined && value <= bucket) {
        s.counts[i] = (s.counts[i] ?? 0) + 1
      }
    }
    s.sum += value
    s.count += 1
  }

  public get(
    labels?: Record<string, string>,
  ): { sum: number; count: number; buckets: readonly number[]; counts: number[] } | undefined {
    const s = this.series.get(labelKey(this.labelNames, labels))
    if (s === undefined) return undefined
    return { sum: s.sum, count: s.count, buckets: s.buckets, counts: [...s.counts] }
  }

  public render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ]
    for (const [key, s] of this.series) {
      const labels: Record<string, string> = {}
      if (key !== '') {
        for (const part of key.split(',')) {
          const eq = part.indexOf('=')
          if (eq > 0) labels[part.slice(0, eq)] = part.slice(eq + 1)
        }
      }
      const labelPairs = this.labelNames.map((n) => [n, labels[n] ?? ''] as [string, string])
      for (let i = 0; i < this.buckets.length; i++) {
        const bucketLabels: Array<[string, string]> = [
          ...labelPairs,
          ['le', String(this.buckets[i] ?? 0)],
        ]
        lines.push(`${this.name}_bucket${formatLabels(bucketLabels)} ${s.counts[i] ?? 0}`)
      }
      const infLabels: Array<[string, string]> = [...labelPairs, ['le', '+Inf']]
      lines.push(`${this.name}_bucket${formatLabels(infLabels)} ${s.count}`)
      lines.push(`${this.name}_sum${formatLabels(labelPairs)} ${s.sum}`)
      lines.push(`${this.name}_count${formatLabels(labelPairs)} ${s.count}`)
    }
    return lines.join('\n')
  }
}

export class MetricsRegistry {
  private readonly enabled: boolean
  private readonly counters = new Map<string, Counter>()
  private readonly histograms = new Map<string, Histogram>()

  public constructor(options: MetricsRegistryOptions = {}) {
    this.enabled = options.enabled ?? true
  }

  public get isEnabled(): boolean {
    return this.enabled
  }

  public counter(options: CounterOptions): Counter {
    const existing = this.counters.get(options.name)
    if (existing) return existing
    const c = new Counter(options, this.enabled)
    this.counters.set(options.name, c)
    return c
  }

  public histogram(options: HistogramOptions): Histogram {
    const existing = this.histograms.get(options.name)
    if (existing) return existing
    const h = new Histogram(options, this.enabled)
    this.histograms.set(options.name, h)
    return h
  }

  public render(): string {
    const blocks: string[] = []
    for (const c of this.counters.values()) blocks.push(c.render())
    for (const h of this.histograms.values()) blocks.push(h.render())
    return blocks.join('\n') + (blocks.length > 0 ? '\n' : '')
  }
}

export function createMetricsRegistry(
  options?: MetricsRegistryOptions,
): MetricsRegistry {
  return new MetricsRegistry(options)
}
