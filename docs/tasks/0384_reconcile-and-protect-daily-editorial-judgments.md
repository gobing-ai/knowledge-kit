---
schema_version: 1
name: Reconcile and protect daily editorial judgments
status: todo
template: feature-impl
created_at: 2026-11-18T04:03:43.213Z
updated_at: "2026-11-18T04:50:03.365Z"
feature_id: L3
priority: P1

estimate_hours: 8
dependencies: ["0393"]
---

## 0384. Reconcile and protect daily editorial judgments

### Background

L3 · 冻结后对齐、提交与快照。现行工作流在最终选题后进入稿件阶段，提供确定的对齐入口。 证据 `plugins/kk/workflows/kk-news-generate.yaml:137`。覆盖 R4, R10。

### Requirements

- [ ] R1. conclusion.md 记录有证据的新判断和被取代记录，稿件采用本期快照并明确承认错误、致歉及更正（L3 R4）
- [ ] R2. 重复操作不重复追加，冲突不会覆盖已确认判断，无新判断时复用合法快照（L3 R10）

### Acceptance Criteria

- [ ] R4 — 起草前对齐判断并公开纠错
- [ ] R10 — 重试和并发保护判断历史

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:03.365Z

**Ready decisions.** Use selected IDs and provenance produced by 0393. Bind proposal → validated commit → immutable run snapshot; 0385 consumes the snapshot and 0396 consumes correction IDs. Reuse the existing kk lock and same-directory atomic replacement. Treat unavailable or corrupt historical state as an explicit stop for judgment-dependent writing; preserve no-op replay and concurrent compare-and-swap. Carry a recovery receipt and backed-up path. Keep full editorial wording and external delivery in 0385/0396.

**Source premise.** `plugins/kk/workflows/kk-news-generate.yaml:137` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay new, superseded, empty, corrupt, concurrent and repeated proposals against disposable works. Prove cleanup protection and restore with the committed snapshot unchanged.

### Design

**Decision** — 冻结后对齐、提交与快照由现有边界承载。扩展 news-editorial 对齐模式与确定性提交步骤，沿用现有锁并采用摘要比较和原子替换。区分初次初始化和异常丢失。验证清理、对齐失败、并发和重放，文档同步到 ADR-054 约定。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/workflows/kk-news-generate.yaml:137`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 8 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 扩展 news-editorial 对齐模式与确定性提交步骤，沿用现有锁并采用摘要比较和原子替换。区分初次初始化和异常丢失。验证清理、对齐失败、并发和重放，文档同步到 ADR-054 约定。
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
