---
schema_version: 1
name: Residuals from 0227
status: backlog
template: standard
created_at: 2026-10-09T05:25:23.178Z
updated_at: "2026-10-09T05:25:23.386Z"

---

## 0234. Residuals from 0227

### Background

Source task: 0227 (feature G32) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:ca5d010f — packages/kk-store/src/story.ts:44 (TOKEN_RUN), packages/kk-store/src/story.ts:81: `TOKEN_RUN`'s word alternative (`[\p{L}\p{N}]+`) also matches Han/kana, so a CJK run immediately after a Latin/digit character is absorbed into ONE fused word token instead of being bigrammed — R2's "CJK runs → character bigrams" does not hold on that boundary. Measured with the shipped function: `storyTokens("OpenAI发布新模型")` = `{"openai发布新模型"}`, `storyTokens("GPT5震撼发布")` = `{"gpt5震撼发布"}`, `storyTokens("Meta裁员1000人")` = `{"meta裁员1000人"}` (1 token each); `storyTokens("OpenAI 发布新模型")` = `{"openai","发布","布新","新模","模型"}`. Consequence: `jaccard("OpenAI发布新模型","OpenAI 发布新模型") = 0.00`, so a whitespace-only near-duplicate of a mixed-script headline never shares a story at any threshold (AC2 for that input class); longer mixed titles still merge because the shared CJK prefix carries the score (`华为发布新一代AI芯片` vs the same with spaces = 0.67). Live impact is nil today — 0 of the 78 live-store titles are mixed-script (all English, `aihot` included) — so this is a latent defect on a path exercised only by fixtures. Fix: stop the word alternative before Han/Hiragana/Katakana (or split the normalized title into script runs before tokenizing).

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
