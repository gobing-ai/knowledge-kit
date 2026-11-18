---
schema_version: 1
name: Refine daily audience, spoken script and canonical episode title
status: todo
template: feature-impl
created_at: 2026-11-18T04:03:43.216Z
updated_at: "2026-11-18T04:50:03.564Z"
feature_id: L3
priority: P1

estimate_hours: 8
dependencies: ["0384", "0392", "0394"]
---

## 0385. Refine daily audience, spoken script and canonical episode title

### Background

L3 · 受众、证据、节奏与节目元数据。现行风格契约定义为技术分享，选题和文案有现成模式可扩展。 证据 `plugins/kk/skills/news-editorial/references/style-contract.zh.md:9`。覆盖 R2, R3, R5, R6。

### Requirements

- [ ] R1. 按时效和对白领听众的影响筛选，以白话解释必要术语并把深度专题留到周更（L3 R2）
- [ ] R2. 在文案中区分可归因事实、评论和待证推断，证据不足时归因或省略（L3 R3）
- [ ] R3. 开场仅简短问候及一到两句要点，逐条评论可省略且至多一句，跨条目综评按价值和时长调整或省略（L3 R5）
- [ ] R4. 中文发布标题采用第261120期 · 当日要点，封面复用同一要点，重试和历史重放保留节目身份（L3 R6）

### Acceptance Criteria

- [ ] R2 — 按受众影响选择和解释新闻
- [ ] R3 — 核查商业声明与评论证据
- [ ] R5 — 短开场和可选评论符合口播节奏
- [ ] R6 — 各发布目标共用冻结的节目标题

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:03.564Z

**Ready decisions.** Consume the 0384 snapshot, 0392 boundary decision and 0394 citation fields. Freeze one episode date and a headline with selected source IDs, and regenerate or withhold title and derived copy if admission removes its supporting sources. Only the existing script/Content seams change. Preserve historical bundle decoding and GUID/slug identity. 0386/0387 consume the frozen title and IDs; 0396 owns public correction delivery receipts.

**Source premise.** `plugins/kk/skills/news-editorial/references/style-contract.zh.md:9` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay a dense and a thin issue, a false claim, removed headline support and an old bundle. Verify all title consumers and the optional short-comment limits.

### Design

**Decision** — 受众、证据、节奏与节目元数据由现有边界承载。在 news-editorial 和现有稿件校验、渲染分支内更新受众与口播，保留安全边界和裁剪引用校验。以节目日期和已确认 headline 固定标题，补齐旧历史与渠道标题检查。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/skills/news-editorial/references/style-contract.zh.md:9`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 8 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 在 news-editorial 和现有稿件校验、渲染分支内更新受众与口播，保留安全边界和裁剪引用校验。以节目日期和已确认 headline 固定标题，补齐旧历史与渠道标题检查。
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
