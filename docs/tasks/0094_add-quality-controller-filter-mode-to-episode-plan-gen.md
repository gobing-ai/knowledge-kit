---
schema_version: 1
name: "Add quality-controller filter mode to episode-plan-gen"
status: todo
template: feature-impl
created_at: 2026-09-06T14:35:05.202Z
updated_at: "2026-09-06T17:58:53.470Z"
feature_id: L1
priority: P1
tags: ["generator", "episode-plan-gen", "feature-K"]
dependencies: ["0093"]
---

## 0094. Add quality-controller filter mode to episode-plan-gen

### Background

Feature L1 D3/R4/R5: filtering must be a visible, threshold-driven, auditable node — not implicit selection inside plan. The workflow gains an explicit quality-control-content state; this task builds its executor. r4 pollution showed implicit filtering is unreviewable.

### Requirements

R1. episode-plan-gen gains `--mode filter`: reads annotated Doc[], applies category allowlist (QC_CATEGORIES, default 'ai-news,ai-industry') + per-dimension minimums (QC_MIN_QUALITY/IMPORTANCE/URGENCY/IMPACT, defaults 3/3/2/2).
R2. Surviving docs retain sourceUri and metadata.urls byte-identical.
R3. Rejected docs + per-doc rejection reasons (which category/threshold failed) written to a sibling rejected artifact (path via QC_REJECTED_OUT or <out>.rejected.json).
R4. Zero survivors is a valid exit-0 outcome with empty candidates — the workflow maps it to done-no-content, not failed.
R5. Unit tests: threshold boundary (score == min passes), category deny, reasons accuracy, empty-survivors exit 0.

### Acceptance Criteria

- [ ] QC_CATEGORIES='ai-news' drops non-ai categories with reasons recorded
- [ ] score exactly at threshold passes (boundary test)
- [ ] sourceUri/metadata.urls survive unchanged in kept docs
- [ ] zero survivors → exit 0, empty candidates array
- [ ] rejected artifact lists every dropped doc with its failed dimension(s)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
WHAT: episode-plan-gen gains a second run mode: `--mode filter` reads an annotated Doc[] (from 0093's annotate pass), applies a category allowlist + per-dimension score minimums, and writes surviving docs to `--out` plus a rejection audit to `<out>.rejected.json`. Default mode (`--mode plan` or flag absent) is today's behavior — unchanged.

WHY: ADR-019 D3 — content QC must be a visible, threshold-driven, auditable node (r4's implicit filtering let 10 stale archives through unreviewed). Thresholds live as workflow vars so operators tune per run without code edits. Same plugin as annotate: one cohesive candidate-understanding module.

WHERE (frozen):
- `plugins/generations/episode-plan-gen/src/index.ts` — new exported pure function `filterAnnotated(docs: Doc[], config: FilterConfig): { kept: Doc[]; rejected: RejectedDoc[] }` where `RejectedDoc = { doc: Doc; reasons: string[] }`. Entry: extend parseArgs (index.ts:311) with `mode: { type: 'string', default: 'plan' }`; dispatch in processGeneratorIO.
- Env (parsed in one function `filterConfigFromEnv()`, defaults in one constant `DEFAULT_FILTER_CONFIG`): `QC_CATEGORIES` (comma list, default `ai-news,ai-industry`), `QC_MIN_QUALITY` (3), `QC_MIN_IMPORTANCE` (3), `QC_MIN_URGENCY` (2), `QC_MIN_IMPACT` (2). Values outside 0–5 or unknown categories → exit 1 with a named error (fail loud, not clamp).
- Rejected artifact path: `<out>` with `.json` → `.rejected.json` (e.g. candidates.json → candidates.rejected.json). Content: `{ rejected: RejectedDoc[], config: FilterConfig, total: number }`.

Filter rule: a doc survives iff `category ∈ allowlist` AND every dimension score ≥ its minimum (inclusive — score == min passes). Rejection reasons list each failed check as `category:not-in-allowlist` | `quality:2<3` etc.

Zero survivors is a valid exit-0 outcome: `--out` gets `{ "docs": [] }`-shaped Content (same ContentSchema wrapper as plan mode, `metadata.docs: []`); the workflow's transition reads `metadata.docs | length == 0` → routes to `done-no-content`. Filter mode never exits non-zero for "nothing passed".

Assumes from 0093: every input doc carries `metadata.category` + `metadata.scores` — filter validates this and fails loud (exit 1, naming the first doc id) if annotations are missing; never silently passes unannotated docs.

Anti-patterns: no separate plugin; no divergence between standalone and workflow defaults (single DEFAULT_FILTER_CONFIG); no score recomputation here (read-only over 0093's annotations); no threshold clamping.

Handoff: 0097 wires `quality-control-content` state + `done-no-content` terminal + QC_* vars.
### Plan
1. Define FilterConfig / RejectedDoc types + DEFAULT_FILTER_CONFIG + filterConfigFromEnv() with fail-loud validation.
2. Implement `filterAnnotated` pure function (inclusive thresholds, reason strings).
3. Extend parseArgs with `--mode`; dispatch plan (existing path, untouched) vs filter in processGeneratorIO.
4. Filter mode: validate annotations present (fail loud naming doc id), write kept Content + rejected artifact via atomicWriteJson.
5. Tests: boundary (score == min passes), category deny, multi-reason accumulation, missing-annotation exit 1, invalid env exit 1, empty-survivors exit 0 with docs: [], rejected artifact shape, plan-mode regression (16 existing tests unmodified).
6. Sync docs/04_DESIGN.md (--mode, QC_* env) + docs/design/episode-plan-gen.md filter section.
7. Verify: bun run lint && bun run test clean; replay r6 annotated fixture, confirm 4 survivors match the gated plan.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
