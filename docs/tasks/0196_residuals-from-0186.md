---
schema_version: 1
name: Residuals from 0186
status: cancelled
template: feature-impl
created_at: 2026-10-05T14:58:01.664Z
updated_at: "2026-10-05T22:13:39.289Z"
feature_id: E91

---

## 0196. Residuals from 0186

### Background

Source task: 0186 (feature E91) — deferred residuals filed by residual-scan settle.

- review-finding:3aa4a6e7 — plugins/publishings/juejin-pub/src/index.ts:64,134-143,234,327-338: `readToast` searches the **whole document** with no scope (`page.locator(':text("…")')`, `:136`) and both probes fall back to it (`probeDraft` `:330`, `probeLive` `:337`), so the article body this flow writes itself participates in the search: `fillCodeMirror(page, bodySelector, content.body)` (`:234`) puts the markdown into `.bytemd-editor .CodeMirror`, where it renders as DOM text, and Playwright's `:text("…")` matches any element containing that substring — including that editor. An article whose body contains `保存成功` satisfies the draft probe with no site signal, and one containing `发布成功` does the same for the live probe. **Reproduced in this stage** against the real transport with a recording launcher: a page whose only `:text("保存成功")` match is the article body returns `ok: true`, `url: https://juejin.cn/editor/drafts/new?v=2` (the editor URL, never moved), no `id`, and no toast element in the page — the Result asserts a saved draft on evidence that came from the article text, and the 5 s autosave window (`:238-240`) is skipped entirely because the probe fires on its first poll, which also skips the one `Meta+S` retry that would have produced real evidence. The candidate strings are design-frozen (`:64-65` mirror the Design's signal definitions); the **search scope** is not (the Design says a visible `:text(…)` *toast*, and the editor the flow just filled is not one). Fix shape: exclude the editor subtree, or scope the read to the site's notification container — a localized change whose validation needs the live DOM.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Derive from the linked feature or refined task scope. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-05T22:13:39.289Z backlog → cancelled (system)

