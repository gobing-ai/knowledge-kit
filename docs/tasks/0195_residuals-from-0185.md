---
schema_version: 1
name: Residuals from 0185
status: backlog
template: feature-impl
created_at: 2026-10-05T14:15:08.633Z
updated_at: "2026-10-05T14:15:08.823Z"
feature_id: E91

---

## 0195. Residuals from 0185

### Background

Source task: 0185 (feature E91) — deferred residuals filed by residual-scan settle.

- review-finding:f54e350f — plugins/publishings/infoq-pub/src/index.ts:61,120-129,267-279: `readToast` searches the **whole document** with no scope (`page.locator(':text("…")')`, `:122`), and both probes call it (`probeDraft` `:270`, `probeLive` `:275`), so the article body this flow itself pasted (`pasteHtml` `:215`, which runs **before** the draft click `:219` and both probes) participates in the search. An article whose body contains `保存成功` or `已保存` makes the draft probe report success immediately after the click whether or not InfoQ saved anything; a body containing `提交成功` or `审核` does the same for the live probe, whose Result then reads `infoq submitted for InfoQ editorial review` (`:255`) for an article that was never submitted — a false `ok: true` on the E91-D6 rail. The candidate lists themselves are design-frozen (`:61-62` mirror the Design's draft/live signal definitions), so this is not a frozen-name divergence: the **search scope** is the implementation's own choice (the Design says a visible `:text(…)` *toast*, and the pasted editor is not one). Fix shape: exclude the editor container, or scope the read to the toast/notification container — a localized change whose validation needs the live DOM.

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
