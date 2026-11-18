---
schema_version: 1
name: Restore concise podcast notes and reuse episode cards
status: todo
template: feature-impl
created_at: 2026-11-18T04:03:43.216Z
updated_at: "2026-11-18T04:50:03.764Z"
feature_id: L3
priority: P1

estimate_hours: 7
dependencies: ["0385"]
---

## 0386. Restore concise podcast notes and reuse episode cards

### Background

L3 · podcast-pub 备注与卡片适配。旧备注读取 SurfDash 结果及音频产物，需要针对现行冻结产物重新接线。 证据 `plugins/kk/scripts/daily-stages.ts:4839`。覆盖 R7。

### Requirements

- [ ] R1. 站点呈现简短要点、来源、实测时间线与有序卡片，文章链接随真实回执出现，卡片缺失时仍可读且备注区别于正文（L3 R7）

### Acceptance Criteria

- [ ] R7 — 节目备注恢复时间线并展示卡片

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:03.763Z

**Ready decisions.** Consume the final selected IDs, headline and 0394 citation provenance carried through 0385. Use the final audio offset evidence and existing card order. Render without a SurfDash URL, then enrich using an actual receipt. Record optional card-upload errors separately. Reuse podcast-pub’s renderer/transport, preserve old inputs and keep RSS text available when HTML or card assets are absent. 0388 consumes the resulting podcast payload.

**Source premise.** `plugins/kk/scripts/daily-stages.ts:4839` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay the 2026-10-19 notes structure plus a current case with excluded item, missing offset, missing card and unavailable article URL. Compare rendered station page and RSS payload.

### Design

**Decision** — podcast-pub 备注与卡片适配由现有边界承载。固定历史与当期样本，验证站点接受的 HTML，复用发布插件上传图片与出具回执。按实测时间和已讲条目渲染，链接随真实回执生成，提供文本和无卡片降级。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/scripts/daily-stages.ts:4839`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 7 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 固定历史与当期样本，验证站点接受的 HTML，复用发布插件上传图片与出具回执。按实测时间和已讲条目渲染，链接随真实回执生成，提供文本和无卡片降级。
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
