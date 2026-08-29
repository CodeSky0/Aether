// @aether/web · DataTable 原语（Yohaku 复杂组件 4/4）
// 规则（Phase Shift Step 2 契约）：
//   行 hover：bg-neutral-2（无重高亮）；行分隔：border-b border-border
//   ID / 时间戳列由调用方给 font-mono；Realm 名等由调用方给 font-serif
// 纯渲染组件（可在 RSC 中使用）；空态由调用方在传入前自行分支。
import type { ReactNode } from 'react'

export interface DataTableColumn<Row> {
  key: string
  header: ReactNode
  /** td / th 的附加类（如 pr-4、font-mono） */
  className?: string
  render: (row: Row) => ReactNode
}

interface DataTableProps<Row> {
  columns: Array<DataTableColumn<Row>>
  rows: Row[]
  rowKey: (row: Row) => string
  /** 表格最小宽度（可横向滚动容器） */
  minWidth?: string
}

export default function DataTable<Row>({
  columns,
  rows,
  rowKey,
  minWidth = '40rem',
}: DataTableProps<Row>) {
  return (
    <div className="overflow-x-auto">
      {/* minWidth 走 inline style：Tailwind 无法在构建期编译动态类名 */}
      <table
        className="w-full text-left text-copy-13"
        style={{ minWidth }}
      >
        <thead className="text-label-12 text-neutral-6">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={`pb-2 pr-4 font-normal last:pr-0 ${column.className ?? ''}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-border transition-colors last:border-b-0 hover:bg-neutral-2"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`py-3 pr-4 align-middle last:pr-0 ${column.className ?? ''}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
