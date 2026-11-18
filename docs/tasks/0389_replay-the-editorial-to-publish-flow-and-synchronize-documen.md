---
schema_version: 1
name: Replay the editorial-to-publish flow and synchronize documentation
status: todo
template: feature-impl
created_at: 2026-11-18T04:03:43.217Z
updated_at: "2026-11-18T04:50:04.354Z"
feature_id: L3
priority: P1

estimate_hours: 5
dependencies: ["0388", "0390", "0395", "0396"]
---

## 0389. Replay the editorial-to-publish flow and synchronize documentation

### Background

L3 · 跨插件回放与文档一致性。现行发布 DAG 和生成 DAG 可用冻结产物做串联回放。 证据 `plugins/kk/workflows/kk-publish.yaml:50`。覆盖 R1。

### Requirements

- [ ] R1. 由可重放基线验证流程校验归代码、编辑判断归 Agent、目标适配归插件（L3 R1）

### Acceptance Criteria

- [ ] R1 — 验证现有边界与节目基线

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.354Z

**Ready decisions.** Close the batch after 0388, 0390, 0395 and 0396. Consume read-only fixture receipts from their providers and cover the three observation tasks through the integrated current pipeline. Keep release operations outside acceptance: installed-package and offline transport rehearsals prove behavior, and the report identifies any actual account, asset or live confirmation still needed.

**Source premise.** `plugins/kk/workflows/kk-publish.yaml:50` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Save one repeatable end-to-end command and its artifact paths. Compare normal and no-content outputs, cue timing, duplicate prevention, source links, failure drill-down, correction delivery and exact publish retry. Run lint, build, test and configured rule gates.

### Design

**Decision** — 跨插件回放与文档一致性由现有边界承载。用 10 月 19 日与两个相异新闻密度的冻结输入重放主链及故障分支，归档差异、截图与发布收据，核对 00/03/04/05 文档及工具安装漂移。记录需要运营实机批准的校验。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/workflows/kk-publish.yaml:50`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 5 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 用 10 月 19 日与两个相异新闻密度的冻结输入重放主链及故障分支，归档差异、截图与发布收据，核对 00/03/04/05 文档及工具安装漂移。记录需要运营实机批准的校验。
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
