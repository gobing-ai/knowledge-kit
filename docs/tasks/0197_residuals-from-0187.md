---
schema_version: 1
name: Residuals from 0187
status: cancelled
template: feature-impl
created_at: 2026-10-05T15:37:26.236Z
updated_at: "2026-10-05T22:13:39.707Z"
feature_id: E91

---

## 0197. Residuals from 0187

### Background

Source task: 0187 (feature E91) — deferred residuals filed by residual-scan settle.

- review-finding:e8d42afb — plugins/publishings/substack-pub/src/index.ts:70,85-104,154-174: The publication-URL pre-validation accepts shapes `editorUrl` then mangles, so a bad input is reported as an expired session. `resolvePublicationUrl` validates with `new URL` but returns the **raw string** (`:91-104`), and `editorUrl` re-derives the base by string surgery — `trim()`, one trailing-`/` strip, one `/publish` strip (`:71-76`). Reproduced in this stage: `resolvePublicationUrl('https://robin.substack.com/publish/posts')` → accepted, `editorUrl` → `https://robin.substack.com/publish/posts/publish/post/new`; `…/publish?utm=x` → `…/publish?utm=x/publish/post/new`; `…/publish/` → correct (`/publish/post/new`). `…/publish/posts` is the Substack **posts dashboard** — a plausible copy-paste for "publication URL" — and nothing rejects it, so instead of the promised pre-browser refusal the run opens one headless preflight on a nonsense URL and fails as `substack session preflight refused: headless substack readiness refused: … — run: <login command>` (`:164-174`), sending the operator to re-login. Fail-safe (no click, no live control, at most one headless launch) and the env row documents the expected shape, which is why this is minor rather than major. Fix shape: keep the parsed `URL` (or normalize inside `resolvePublicationUrl`) and derive from `url.origin` + pathname so validation and derivation cannot disagree.

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

- 2026-10-05T22:13:39.707Z backlog → cancelled (system)

