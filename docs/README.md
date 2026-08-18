# Aether 文档中心

Aether 是协同智能的介质：承载人、Entity、代码与上下文共存的原生环境。本目录承载全部架构规划与开发治理文档。

## 文档索引

| 文档 | 摘要 | 阅读顺序 |
|---|---|---|
| [terminology.md](./terminology.md) | 品牌术语体系与命名守则 | 1 |
| [design/yohaku.md](./design/yohaku.md) | Yohaku 视觉设计约束（十戒律 / 色彩 / 字体 / 尺度 / tokens，与官方源码对齐） | 2 |
| [features/feature-brainstorm.md](./features/feature-brainstorm.md) | Phase 1：42 项功能头脑风暴与优先级矩阵 | 3 |
| [roadmap/monorepo-structure.md](./roadmap/monorepo-structure.md) | Turborepo 目录结构与包职责 | 4 |
| [roadmap/tech-decisions.md](./roadmap/tech-decisions.md) | 技术选型决策表与弃用信号 | 5 |
| [roadmap/data-model.md](./roadmap/data-model.md) | 核心数据模型与隔离策略草案 | 6 |
| [roadmap/milestones.md](./roadmap/milestones.md) | M0–M3 里程碑与任务清单 | 7 |
| [roadmap/risks.md](./roadmap/risks.md) | 关键技术风险、监控指标与降级方案 | 8 |
| [roadmap/probes/yjs-serverless.md](./roadmap/probes/yjs-serverless.md) | Yjs Serverless 持久化与连接管理技术探测报告 | 9 |
| [roadmap/team-norms.md](./roadmap/team-norms.md) | 团队协作规范与检查清单 | 10 |
| [specs/m35-web-ui-foundation.md](./specs/m35-web-ui-foundation.md) | M3.5 Web UI 基础层规范 | 11 |
| [specs/m35-plan.md](./specs/m35-plan.md) | M3.5 实施计划 | 12 |
| [specs/m36-audit-vault.md](./specs/m36-audit-vault.md) | M3.6 Audit Vault 规范 | 13 |
| [specs/m36-plan.md](./specs/m36-plan.md) | M3.6 实施计划 | 14 |
| [specs/m37-manifestation-binding.md](./specs/m37-manifestation-binding.md) | M3.7 Manifestation Binding 规范 | 15 |
| [specs/m38-entitlement-engine.md](./specs/m38-entitlement-engine.md) | M3.8 Entitlement Engine 规范 | 16 |
| [specs/m38-plan.md](./specs/m38-plan.md) | M3.8 Entitlement Engine 实施计划 | 17 |
| [specs/m39-session-actor.md](./specs/m39-session-actor.md) | M3.9 会话主体解析规范 | 18 |
| [specs/m310-membership-provisioning.md](./specs/m310-membership-provisioning.md) | M3.10 Membership 开通规范 | 19 |
| [specs/m311-invitation-mail-backfill.md](./specs/m311-invitation-mail-backfill.md) | M3.11 邀请邮件与 Realm organization 回填规范 | 20 |
| [specs/m312-membership-ui.md](./specs/m312-membership-ui.md) | M3.12 邀请 / 成员管理 UI 与 membership 授权收口 | 21 |
| [specs/m313-audit-export.md](./specs/m313-audit-export.md) | M3.13 Audit Vault 导出规范 | 22 |

## 阅读顺序

1. 先读 [terminology.md](./terminology.md)，建立 Aether 术语心智模型。
2. 再读 [design/yohaku.md](./design/yohaku.md)，掌握全部 UI 输出的视觉约束。
3. 读 [features/feature-brainstorm.md](./features/feature-brainstorm.md)，理解产品边界与差异化主张。
4. 沿 roadmap 章节按序阅读工程落地内容，roadmap 文档之间存在前置依赖，请勿跳读。

## 术语快表

| Aether 术语 | 技术映射 |
|---|---|
| Realm | Better-Auth Organization + Drizzle Schema 隔离边界 |
| Current | Yjs Provider 连接实例 + Presence 状态流 |
| Entity | 拥有 Better-Auth Identity、Yjs Cursor、Drizzle Audit Log 的一等公民 |
| Thread | 绑定文件范围 / 代码片段 / Manifestation URL / 对话历史的叙事单元 |
| Converge | Yjs CRDT 无冲突合并操作，强调自然汇聚 |
| Drift | Yjs IndexedDB 持久化 + Drizzle 本地缓存状态 |
| Manifestation | Vercel Preview Deployment 作为可协同标注的对象 |
| Resonance | 通过公开 API 实现的扩展，与核心共鸣而非外挂 |

## 文档维护约定

- 本目录全部文档使用简体中文，技术标识符遵循术语守则。
- 文档变更随对应代码 PR 一并评审，禁止文档与实现脱节超过一个里程碑周期。
- 术语表以 [terminology.md](./terminology.md) 为唯一事实源，代码 schema 与文档双源校验。