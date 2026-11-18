---
schema_version: 1
name: Unify the news publish trigger and prepare social promotion
status: todo
template: feature-impl
created_at: 2026-11-18T04:03:43.217Z
updated_at: "2026-11-18T04:50:04.157Z"
feature_id: L3
priority: P1

estimate_hours: 8
dependencies: ["0386", "0387"]
---

## 0388. Unify the news publish trigger and prepare social promotion

### Background

L3 · 发布预设和现有发布核心。现行发布入口按窗口变更默认期次，迁移时必须固定节目日期。 证据 `apps/cli/src/commands/content-launch.ts:525`。覆盖 R9。

### Requirements

- [ ] R1. 依赖满足的目标按既有权限执行，微信保留草稿和扫码边界，未就绪的引流可按目标重试且提供逐渠道实机测试材料（L3 R9）

### Acceptance Criteria

- [ ] R9 — 各渠道由一次发布触发并保留授权矩阵

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.156Z

**Ready decisions.** Consume generated assets from 0386/0387. Keep kk news publish as the entry point and the existing preset as the authority on modes. Dispatch the dependency graph once per frozen date, resolve successful owner URLs from same-bundle receipts, and use existing per-target retry without repeating completed effects. Keep compatibility for legacy windows. Leave operator clock and live authorization unchanged during rehearsal. Target-specific WeChat article binding belongs to 0395 and correction evidence to 0396.

**Source premise.** `apps/cli/src/commands/content-launch.ts:525` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Rehearse dry and fake sends with cross-midnight run date, DST, RSS miss, partial success, retry and unchanged approvals. Preserve full target and operation receipt evidence.

### Design

**Decision** — 发布预设和现有发布核心由现有边界承载。扩展单次新闻发布选择与目标依赖，保留授权模式、旧目标重放及微信人工步骤。通过预检、RSS 超时、部分失败、幂等和 DST 的 dry-run，按渠道留社媒预演材料与排程切换方案。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `apps/cli/src/commands/content-launch.ts:525`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 8 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 扩展单次新闻发布选择与目标依赖，保留授权模式、旧目标重放及微信人工步骤。通过预检、RSS 超时、部分失败、幂等和 DST 的 dry-run，按渠道留社媒预演材料与排程切换方案。
- [ ] 保留 E2E 回放证据与相应文档更新。

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
