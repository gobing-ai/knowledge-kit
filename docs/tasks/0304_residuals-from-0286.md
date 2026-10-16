---
schema_version: 1
name: Residuals from 0286
status: cancelled
template: standard
created_at: 2026-10-16T16:55:00.112Z
updated_at: "2026-10-16T18:30:08.662Z"

---

## 0304. Residuals from 0286

### Background

Source task: 0286 (feature G9) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:39618d88 — plugins/kk/skills/smart-seo/references/seo-geo-sources.md:15 vs plugins/kk/scripts/seo-report.ts:452, plugins/kk/scripts/seo-rules.ts:486, plugins/kk/scripts/seo-rules.ts:1543: One shipped fact carries two dates: the new skill reference states FAQ rich results stopped appearing 2026-05-07 (Google Search updates changelog), while the shipped report/rules prose still says Aug/Sep 2023 — a reader of the skill and of `report.md` sees different retirement dates.

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

Cancelled, not deferred: the single residual finding was fixed in the same step it was filed for.

**Finding (review-finding:39618d88) — one FAQ rich-result fact carried two dates.** The shipped
skill reference named 2026-05-07 while the rule description and the report limits block still named
Aug/Sep 2023 as the retirement, so a reader of the skill and of `report.md` saw different dates.

**Every shipped surface now states one dated fact** — retired 2026-05-07; the Aug/Sep 2023 change
only restricted eligibility to authoritative government/health sites, per the dated change log at
`https://developers.google.com/search/updates` (primary source re-read this step, not from memory):

| Surface | Change |
| --- | --- |
| `plugins/kk/scripts/seo-rules.ts:487` | dropped the unsupported "for general websites" scope; one dated claim |
| `plugins/kk/scripts/seo-rules.ts:1544` | check reason: "general rich results" → "FAQ rich results", same 2026-05-07 date |
| `plugins/kk/scripts/seo-report.ts:452` | "general" dropped; states the retirement applied to every site |
| `plugins/kk/skills/smart-seo/references/seo-geo-sources.md:15` | unchanged — already the source-of-truth wording |

**Regression lock:** `plugins/kk/tests/smart-seo-analysis.test.ts` gains a test asserting every
`retir…` claim in the three shipped files resolves to `2026-05-07` and that the FAQ-present check
reason carries that date. Falsified against the pre-fix strings: the 2023 description and report
prose yield `['2023']` and the pre-fix skill reference yields `[]`, so the check fails on exactly
the divergence this task recorded.

No follow-up task is filed for this finding.

**Provenance:** the date divergence itself was already resolved in `5bcc77cf` ("fix(kk): correct the
FAQ rich-result retirement date", 17:48Z) — after this task was filed at 16:55Z and before this
step. What remained open here was the unsupported scope wording left in `plugins/kk/scripts/seo-rules.ts:487`
and `plugins/kk/scripts/seo-report.ts:452`, and the absence of any check holding the three surfaces
on one date; both are closed above, so the task carries no deferred work.

### Testing

- `bun test` (full suite, `NODE_ENV=test`, coverage) — exit 0; 3766 pass / 2 skip / 0 fail; zero non-dot lines in the reporter output.
- `plugins/kk/tests/smart-seo-analysis.test.ts` — 15 pass / 0 fail, including the new one-date lock; the invariant was falsified against the pre-fix strings (2023 / absent → fail) before being accepted.
- `bun run lint` — exit 0 (Biome 2.5.15, 594 files; typecheck across all workspaces).
- `spur rule run --preset recommended-pre-check` — 56 rules, 0 violations; `--preset recommended-post-check` — 2 rules, 0 violations.
- Date verified from the primary source `https://developers.google.com/search/updates` ("no longer appear in Google Search starting May 7, 2026"; the September 2023 entry is the eligibility restriction).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-16T18:19:32.643Z backlog → cancelled (system)

