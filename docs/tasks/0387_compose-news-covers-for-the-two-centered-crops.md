---
schema_version: 1
name: Compose news covers for the two centered crops
status: todo
template: feature-impl
created_at: 2026-11-18T04:03:43.217Z
updated_at: "2026-11-18T04:50:03.961Z"
feature_id: L3
priority: P1

estimate_hours: 6
dependencies: ["0385"]
---

## 0387. Compose news covers for the two centered crops

### Background

L3 · 新闻封面预设和排版。现有排版器固定了左上标识位置，可复用分层合成。 证据 `plugins/kk/scripts/cover-compositor.ts:121`。覆盖 R8。

### Requirements

- [ ] R1. 两个目标平台的中心裁切都保留标题要点，完整封面右上角显示缩小后的透明标识，验证产物包含参考融合及平台裁切预览（L3 R8）

### Acceptance Criteria

- [ ] R8 — 新闻封面兼容中心裁切

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:03.960Z

**Ready decisions.** Consume the headline from 0385 and reuse the L2 preset/compositor. Keep alpha and preserve text contrast, glyph wrapping and the safe area shared by both crops. The operator banner is absent locally. Use a checked-in alpha-logo fixture for deterministic verification and report actual reference comparison as a separate operator check. Hand 0388 the same normalized cover artifact as today.

**Source premise.** `plugins/kk/scripts/cover-compositor.ts:121` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Run the existing daily-cover mock with short and long CJK titles and export both crop previews. Keep the existing compositor test command and add the measured capture to evidence when available.

### Design

**Decision** — 新闻封面预设和排版由现有边界承载。复用 L2、image-gen 与 compositor。核对操作员参考和两个平台裁切，使用透明右上标识及安全区域标题，留下长短标题裁切预览。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/scripts/cover-compositor.ts:121`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 6 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 复用 L2、image-gen 与 compositor。核对操作员参考和两个平台裁切，使用透明右上标识及安全区域标题，留下长短标题裁切预览。
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
