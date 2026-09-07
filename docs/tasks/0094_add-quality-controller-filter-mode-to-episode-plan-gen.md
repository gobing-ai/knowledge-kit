---
schema_version: 1
name: "Add quality-controller filter mode to episode-plan-gen"
status: done
template: feature-impl
created_at: 2026-09-06T14:35:05.202Z
updated_at: "2026-09-07T01:58:40.355Z"
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

```gherkin
Feature: Add quality-controller filter mode to episode-plan-gen

  Scenario: Quality-controller filters candidates by category allowlist and score thresholds
    Given the r6 annotated fixture set from 0093
    When episode-plan-gen runs with --mode filter under QC_CATEGORIES and QC_MIN_QUALITY/IMPORTANCE/URGENCY/IMPACT thresholds
    Then candidates outside the allowlist or below any dimension minimum are rejected with per-doc reasons in fixed order
    And the rejection audit is written to <out>.rejected.json with config and total
    And kept docs keep sourceUri and metadata.urls byte-identical
    And a score exactly at a minimum passes the inclusive boundary
    And zero survivors exits 0 with an empty candidates Content for done-no-content routing
```

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

## Change map (all in plugins/generations/episode-plan-gen unless noted)

- src/index.ts:446-477 — extracted `planContent` + `resolvePlanDate` as the shared render seam; `docsToContent` now delegates to it, so plan mode and filter mode render identical Content wrappers (no divergence).
- src/index.ts:485-518 — QC surface types + single source of defaults: `GeneratorMode`, `MECE_CATEGORIES`, `QC_DIMENSIONS`, `FilterConfig` (`{ categories: string[]; minimums: Record<QCDimension, number> }`), `RejectedDoc` (`{ doc, reasons: string[] }`), `DEFAULT_FILTER_CONFIG` (`ai-news,ai-industry`, min quality/importance 3, urgency/impact 2).
- src/index.ts:520-541 — `parseFilterThreshold` (integer 0-5 or absent; anything else throws — fail loud, never clamp) and `parseFilterCategories` (comma list validated against the closed MECE set).
- src/index.ts:544-556 — `filterConfigFromEnv(env = process.env)`: parses QC_CATEGORIES + QC_MIN_QUALITY/IMPORTANCE/URGENCY/IMPACT into one FilterConfig.
- src/index.ts:559-577 — `requireAnnotation`: per-doc validation of `metadata.category` (string) + `metadata.scores` (all four dims present, numeric) — throws naming the first offending doc id.
- src/index.ts:585-605 — `filterAnnotated(docs, config)`: exported pure filter; survivor iff category in allowlist AND every dim score >= its minimum (inclusive, score == min passes); rejection reasons accumulate every failed check in fixed order `category:not-in-allowlist`, `quality:2<3`, `importance:…`, `urgency:…`, `impact:…`. Docs are returned by reference — no mutation, so sourceUri/metadata.urls stay byte-identical (R2).
- src/index.ts:608-621 — `rejectedOutPath` (`<out>.json` -> `<out>.rejected.json`) + `atomicWrite` (tmp file + rename, same seam as the existing Content write).
- src/index.ts:622-653 — `processGeneratorIO(input, out, mode = 'plan')` dispatch: `processPlanIO` is the extracted, behavior-identical old path; `processFilterIO` reads the annotated DocList, filters, writes kept Content then the audit `{ rejected, config, total }` (total = input count). Never branches on kept.length — zero survivors is a valid exit-0 with `metadata.docs: []` (R4).
- src/index.ts:654-674 — `main()` parseArgs gains `mode: { type: 'string', default: 'plan' }`; unknown mode exits 1 naming valid modes; dispatch passes the mode through.
- tests/episode-plan-gen.test.ts:574-843 — 14 new unit/integration tests (boundary score == min, per-dim min-1, category deny, multi-reason accumulation + order, artifact shape `{ rejected, config, total }`, byte-identity of kept docs incl. metadata.urls/sourceUri, missing-annotation exit 1 via main, invalid-env exit 1 via main, unknown mode exit 1, zero-survivors exit 0 with empty docs, explicit `--mode plan` byte-identical to default with no rejected artifact written).
- tests/episode-plan-gen.test.ts:845-895 — 2 r6 replay tests: permissive thresholds on the real annotated r6 output keep all 4 survivors byte-identical to the gated plan; default QC config rejects all 4 and every recorded reason matches the annotations.
- docs/04_DESIGN.md:292,396,399 — QC_* env rows + filterAnnotated surface row + main() `--mode plan|filter` row and the 0097 workflow-wiring handoff sentence.
- docs/design/episode-plan-gen.md:23,38,80-104,137 — 3 surface rows, 2 env rows, new "## Filter (quality controller) — `--mode filter`" section (rule, audit contract, r6 invariant locked in tests), workflow-wiring bullet.

## Rationale

Filtering is the executor for L1's visible quality-control node (ADR-019 D3): same plugin as annotate (one cohesive candidate-understanding module), defaults in one constant (no standalone/workflow divergence), thresholds read-only over 0093's annotations (no recomputation), and the audit artifact makes every rejection reviewable. QC_REJECTED_OUT (Requirements R3 prose) was superseded by the frozen Design WHERE: the audit path is the deterministic sibling `<out>.rejected.json` and the env surface stays QC_CATEGORIES + the four QC_MIN_* knobs.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `--mode filter` per frozen WHERE: parseArgs extended with `mode: { type: 'string', default: 'plan' }` (`plugins/generations/episode-plan-gen/src/index.ts:656-659`); unknown mode fails loud naming valid modes (`:667-669`); dispatch in `processGeneratorIO` (`:622-630`, plan default unchanged). Config in one place: `filterConfigFromEnv()` (`:544-556`) parses `QC_CATEGORIES` (MECE-validated comma list, `:530-541`) + `QC_MIN_QUALITY/IMPORTANCE/URGENCY/IMPACT` (integer 0–5 or absent, `:520-527` — non-integer/out-of-range throws, never clamped); defaults in one constant `DEFAULT_FILTER_CONFIG` (`:511-518`: `ai-news,ai-industry`, 3/3/2/2). Tests: defaults `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:614-620`, invalid env `:622-636`, unknown mode `:816-818` |
| R2 | MET | `filterAnnotated` is pure pass-through — kept docs are the input references returned as-is, no re-annotation/mutation (`plugins/generations/episode-plan-gen/src/index.ts:585-605`); byte-identity test `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:683-698` (`JSON.stringify(kept[0])` equals the input snapshot incl. `sourceUri` + `metadata.urls`, input untouched after the call); r6 replay locks whole-plan byte equality `:848-862` |
| R3 | MET | `RejectedDoc = { doc, reasons[] }` (`plugins/generations/episode-plan-gen/src/index.ts:505-509`); every failed check accumulated in fixed order category → quality → importance → urgency → impact (`:594-600`, exact-order test `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:667-681`); sibling path `<out>.json` → `<out>.rejected.json` via `rejectedOutPath` (`plugins/generations/episode-plan-gen/src/index.ts:608-613`); audit `{ rejected, config, total }` written through the plugin's atomic write seam (`:615-621`, `:650`) — artifact-shape test `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:716-752` (keys config/rejected/total, total = input count, per-doc reasons); real-data reason accuracy `:864-895` |
| R4 | MET | Zero survivors is a valid exit-0: `processFilterIO` never branches on `kept.length` (`plugins/generations/episode-plan-gen/src/index.ts:644-653`); `planContent` keeps the same ContentSchema wrapper as plan mode with `metadata.docs: []` valid (`:452-464`); test `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:754-779` — `main --mode filter` returns 0, Content `metadata.docs: []` / `doc_count: 0`, audit still written (1 rejected) |
| R5 | MET | Threshold boundary score == min passes on all four dims, min-1 fails with the exact `dim:score<min` reason (`plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:638-650`); category deny with reasons (`:652-665`); reasons accuracy + multi-reason accumulation (`:667-681`); missing-annotation exit 1 (`:700-709` pure + `:781-798` main); invalid env exit 1 (`:622-636` + `:800-814`); empty-survivors exit 0 (`:754-779`); plan-mode regression byte-identical, no rejected artifact (`:820-843`); the 33 pre-existing tests are unmodified (suite 33 → 49, +16 new) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R4 — Quality-controller filters candidates by category allowlist and score thresholds | MET | test | `plugins/generations/episode-plan-gen/src/index.ts:585-605` (`filterAnnotated`: allowlist + inclusive per-dim minimums) proven by `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:638-681` (boundary/deny/reasons) and the real-r6 replay `:845-895` |
| QC_CATEGORIES='ai-news' drops non-ai categories with reasons recorded | MET | test | `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:652-665` — ai-news kept; ai-industry + non-ai rejected with exactly `['category:not-in-allowlist']` each |
| score exactly at threshold passes (boundary test) | MET | test | `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:638-650` — doc at 3/3/2/2 (all four minimums) kept; each dim at min-1 rejected with the single exact reason |
| sourceUri/metadata.urls survive unchanged in kept docs | MET | test | `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:683-698` — kept doc byte-identical (`JSON.stringify` equality incl. `metadata.urls` array + `sourceUri`), input non-mutation asserted; whole-plan byte equality on r6 `:848-862` |
| zero survivors → exit 0, empty candidates array | MET | test | `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:754-779` — `main --mode filter` exit 0, `metadata.docs: []`, `doc_count: 0`, audit records the rejection |
| rejected artifact lists every dropped doc with its failed dimension(s) | MET | test | `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:716-752` — `candidates.rejected.json` shape `{ rejected, config, total }`, total 2, dropped doc id + reasons; every r6 rejection reason matches its annotation `:864-895` |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

## Findings and dispositions

| # | Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 | scope | docs/tasks/0094 Requirements R3 vs Design WHERE | Requirements R3 prose offers an optional `QC_REJECTED_OUT` env override; the frozen Design WHERE supersedes it — env surface frozen to `QC_CATEGORIES` + `QC_MIN_*`, audit path is the deterministic sibling `<out>.rejected.json` | Recorded for 0097 wiring: do not expect `QC_REJECTED_OUT`. Implemented per WHERE. |
| 2 | P4 | reliability | src/index.ts:649-650 | `--out` Content + rejected audit are two individually-atomic writes, not one cross-file transaction; a crash between them leaves Content without its audit | Residual risk accepted — same per-artifact atomicity semantics as the rest of the pipeline; 0097's state routing reads `--out`. |
| 3 | P3 | code-quality | tests/episode-plan-gen.test.ts:614-620,734-735,884 | bun:test `toEqual` overload typing on `FilterConfig`, unsafe optional chaining in the artifact test, `noUncheckedIndexedAccess` indexing of annotation `scores` | Fixed during the test stage; gates re-run green after fixes. |
| 4 | P4 | code-quality | src/index.ts planEpisode seam | pi-lens complexity/fan-out advisories on the pre-existing planEpisode area (unchanged this task) | Informational — 0093's review disposition stands; refactoring is out of scope here. |
| 5 | P4 | docs-quality | docs/tasks/0094 (rendered Testing/Review sections) | MD036 (bold text as pseudo-heading) fires on the `spur task record` renderer's own section layout | Informational — renderer convention shared with 0096; not hand-edited. |

**SECUA review:** no P1-P3 findings. Env thresholds validated as integers 0-5 and categories against the closed MECE set before use (src/index.ts:520-541); annotations validated per doc with fail-loud errors (src/index.ts:559-577); no shell/exec/network/LLM/secrets; error strings echo env/doc values to stderr only; read-only fixed-key access (no prototype-pollution surface).

## Residual risk

Finding 2 above (crash window between the two atomic writes) is the only behavioral residual; no data-integrity risk beyond the pipeline's existing per-artifact semantics.

## Disposition

**Approve** - 0 P1, 0 P2 findings; all P3s fixed; gates green at review close (`bun run lint` exit 0; `NODE_ENV=test bun run test` 627 pass / 0 fail across 44 files; narrow suite 49 pass / 0 fail, src 100% funcs / 99.32% lines).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-07T01:20:55.851Z todo → wip (system)
- 2026-09-07T01:55Z implement/test/review/verify stages (sp-super-coder run 0376d3a1): filter mode landed per frozen WHERE; gates bun run lint exit 0, NODE_ENV=test 627 pass/0 fail, narrow suite 49 pass (+16 new, src 100% funcs/99.32% lines); review disposition approve 0 P1/0 P2 (3× P3 fixed in-test-stage, 4× P4 recorded); verdict PASS re-emitted after evidence anchors normalized to plugin-prefixed paths; r6 replay: permissive=4 kept byte-identical to gated plan, default QC=0 kept/4 rejected reasons accurate.
- 2026-09-07T01:55:33.339Z wip → testing (system)
- 2026-09-07T01:58:40.355Z testing → done (system)
