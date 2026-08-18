// @aether/web · Realm Aether membership 列表
// members 表是 entitlement 真源，Better-Auth member 表不参与展示。

import type { RealmMemberRow } from '@/app/actions/membership'

interface RealmMemberListProps {
  members: RealmMemberRow[]
}

export default function RealmMemberList({ members }: RealmMemberListProps) {
  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        Aether 成员
      </p>
      {members.length === 0 ? (
        <p className="mt-4 text-copy-14 text-neutral-6">暂无成员。</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-copy-13">
            <thead className="text-label-12 text-neutral-6">
              <tr>
                <th className="pb-2 pr-4 font-normal">主体</th>
                <th className="pb-2 pr-4 font-normal">角色</th>
                <th className="pb-2 pr-4 font-normal">状态</th>
                <th className="pb-2 font-normal">作用域</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="py-3 pr-4">
                    <span className="mr-2 rounded bg-neutral-2 px-1.5 py-0.5 text-label-12 text-neutral-7">
                      {member.actor_type}
                    </span>
                    <span className="font-mono text-label-12 text-neutral-7">
                      {member.actor_id}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-neutral-8">{member.role}</td>
                  <td className="py-3 pr-4 text-neutral-7">{member.status}</td>
                  <td className="py-3 text-neutral-7">
                    {member.project_id ? `项目级 · ${member.project_id}` : 'Realm 级'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
