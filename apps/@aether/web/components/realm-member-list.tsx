// @aether/web · Realm Aether membership 列表
// members 表是 entitlement 真源，Better-Auth member 表不参与展示。
// Step 2：表格结构交给 DataTable 原语（hover n-2 / border-b / mono ID）。

import type { RealmMemberRow } from '@/app/actions/membership'
import DataTable, { type DataTableColumn } from '@/components/ui/data-table'

interface RealmMemberListProps {
  members: RealmMemberRow[]
}

const columns: Array<DataTableColumn<RealmMemberRow>> = [
  {
    key: 'actor',
    header: '主体',
    render: (member) => (
      <>
        <span className="mr-2 rounded bg-neutral-2 px-1.5 py-0.5 text-label-12 text-neutral-7">
          {member.actor_type}
        </span>
        <span className="font-mono text-label-12 text-neutral-7">
          {member.actor_id}
        </span>
      </>
    ),
  },
  {
    key: 'role',
    header: '角色',
    render: (member) => <span className="text-neutral-8">{member.role}</span>,
  },
  {
    key: 'status',
    header: '状态',
    render: (member) => <span className="text-neutral-7">{member.status}</span>,
  },
  {
    key: 'scope',
    header: '作用域',
    render: (member) => (
      <span className="text-neutral-7">
        {member.project_id ? `项目级 · ${member.project_id}` : 'Realm 级'}
      </span>
    ),
  },
]

export default function RealmMemberList({ members }: RealmMemberListProps) {
  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        Aether 成员
      </p>
      {members.length === 0 ? (
        <p className="mt-4 text-copy-14 text-neutral-6">暂无成员。</p>
      ) : (
        <div className="mt-4">
          <DataTable
            columns={columns}
            rows={members}
            rowKey={(member) => member.id}
          />
        </div>
      )}
    </section>
  )
}
