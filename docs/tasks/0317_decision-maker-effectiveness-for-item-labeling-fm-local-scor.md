---
schema_version: 1
name: "Decision-maker effectiveness for item labeling: fm-local score collapse, laya restore, outcome-driven pruning, safety verdict"
status: todo
template: issue
created_at: 2026-10-19T18:02:15.261Z
updated_at: "2026-10-19T18:26:22.194Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
---

## 0317. Decision-maker effectiveness for item labeling: fm-local score collapse, laya restore, outcome-driven pruning, safety verdict

### Background

Evidence-led audit (2026-10-19, ts-libs session) of how knowledge-kit uses decision makers through
`spur decision run` subprocesses (`apps/cli/src/commands/store.ts`, `apps/cli/src/itc-decision.ts`)
and the catalogs under `plugins/kk/decisions/` (`kk-items.yaml`, `kk-itc.yaml`, `kk-seo-*.yaml`,
`extract/ai-news.yaml`). Data: `.works/kk.db`. Note that `~/.config/kk/store.db` is an empty
decoy. Table `labels` holds 384 labelled items (2026-10-08 → 10-19). Table `selections` holds 72
selected items, topic `ai-news`, 2026-10-09 → 10-18.

**Already fixed on 2026-10-19 (uncommitted, `.spur/config.yaml`):**
- Removed the absolute `/Users/robin/node_modules/@gobing-ai/spur/config/decisions/` entry from
  `decisions.paths`. As a registered layer it shadowed spur's auto-loaded shared catalogs.
  `spur decision status` is ok: 6 registered, 5 shared, no load errors.
- Switched `kk-item-quality` from `laya-local` to `fm-local`. laya fails 100% under the bundled spur
  CLI: 147 `error` + 11 `no-backend`, 0 accepted. The cause is upstream (spur bundling loses
  `worker/laya_worker.py`) and is tracked in spur-new task 1262. A live `spur decision run
  kk-item-quality` now returns `accepted`, value 5, confidence 0.62.

**Findings:**

1. **Model scores never reached a selected item.** Labels by `(decision, maker, reason)`, with
   coverage of the 72 selected items:

   | Decision | Model maker → accepted / on selected | Heuristic rows on selected |
   |---|---|---|
   | importance / impact / urgency / category | fm-local → ~151 / **0** | 103 + 6 |
   | quality | laya-local → 0 / 0 | 103 + 6 |
   | audience / china-politics / sensitivity | typesafe → ~640 / ~105 | — |

   Every selection was ranked on **heuristic** scores. The fm-local labels (2.7–3.9 s per call, 4
   dimensions per item) have had no measurable effect on selection so far. Before investing more,
   decide whether model scores should drive ranking at all and for which dimensions.
2. **fm-local score collapse plus a possible scale mismatch.**
   - importance = 2 in 116/152 accepted cases. impact is 0 or 2 in 148/151. urgency is 0 or 3 in
     152/152.
   - Value domains: fm-local emits 0–5, heuristic emits 1–5 (impact {1,3,4,5}, importance {2,3,4},
     urgency {3,4,5}). Heuristic agreement is impact 0%, category 25%, urgency 35%,
     importance 73%. The pair counts are inflated by repeated heuristic runs, so treat these as
     directional.
   - The 0 values suggest a 0-indexed rubric score (ts-libs neutral `score` is 0-indexed over the
     rubric legend) compared against a 1-based heuristic scale. Verify the mapping in `store.ts`
     before tuning prompts.
   - Collapse is expected for a sampled maker: fm-local confidence is
     `1 − H(p)/ln(n)` over k samples, so accepts mean "all samples agreed" and a low-temperature
     model agrees on a safe middle value. See ts-libs `docs/design/llm-agent-decision-backend.md`
     § Confidence granularity.
3. **The typesafe safety dimensions look saturated.** china-politics = 0 in 572 of ~640 at
   confidence 1.0. sensitivity sits around 0.58 confidence with values 0.82–0.92. These could
   be cheaper as a deterministic prefilter (the keyword maker already exists) plus a model only for
   residual cases.
4. **Cost.** Each item costs 8+ `spur decision run` subprocesses (spawn + catalog load each).
   `kk store label --replay --maker` exists and makes per-dimension A/B runs cheap.
5. **Safety review uses self-reported confidence.** `plugins/kk/workflows/kk-daily-safety.yaml:60,79,104`
   run `agent.run` steps whose JSON carries a self-reported `confidence` HIGH|MEDIUM|LOW (line 70,
   88). The pass/escalate/exclude verdict is read with a jq filter (lines 142-146). A catalog
   `decide` step would give a calibrated, ledgered verdict with a declared fallback.
6. **HITL gates could be pre-answered by evidence.** `kk-solo-podcast.yaml:93` (`hitl.select`
   outline a|b|c) and `:158` (`hitl.confirm` script review) always pause. kk-itc already routes
   outline/preset choices through `itc-decision.ts` (lines 172-215), which is the house pattern.
7. The 27 launchd `no-backend` rows predate the 2026-10-12 fix (`schedule.ts:50-66`). No action.

### Requirements

- [ ] R1. Verify the score-scale mapping between model labels (0-indexed rubric) and heuristic labels (1–5) in `apps/cli/src/commands/store.ts`, and fix it if the scales differ, so model and heuristic scores are comparable before any tuning.
- [ ] R2. Decide, and record in the task Q&A, whether model scores drive selection ranking. If yes, wire the accepted model score into ranking with the heuristic as fallback. If no, stop calling fm-local for dimensions that do not feed selection.
- [ ] R3. Run a per-dimension maker A/B with `kk store label --replay --maker <m>` on a fixed replay set of at least 100 items (fm-local vs typesafe vs clef, and `llm-agent` once ts-libs 0115 ships). Record the value distribution, accept rate, latency and agreement with editor outcomes; pick a maker per dimension from that data.
- [ ] R4. Run an outcome-driven pruning analysis: join `labels` to `selections` (`selected`/`published`/`dropped`) and report, for each dimension, how well its value predicts selection. Drop or demote dimensions with no predictive signal to cut per-item subprocess cost.
- [ ] R5. Restore `kk-item-quality: laya-local` in `.spur/config.yaml` once spur-new task 1262 ships the bundled laya worker, and verify it with a live `spur decision run kk-item-quality`.
- [ ] R6. Add a `kk-safety-verdict` catalog decision (choice `pass`/`escalate`/`exclude`, fallback `escalate`) and replace the self-reported-confidence verdict read in `kk-daily-safety.yaml` with a `kind: decide` step over the safety report as evidence.
- [ ] R7. Give `kk-solo-podcast` outline-select (`:93`) an evidence-mode decide binding that pre-answers the gate under an auto profile, falling back to the HITL pause on low confidence (same pattern as kk-itc via `itc-decision.ts`).
- [ ] R8. Replace the 8+ `spur decision run` subprocesses per item with an in-process `@gobing-ai/ts-ai-decision` hub in the batch labelling path (new dependency accepted by Robin 2026-10-19, see Q&A). Load the same catalogs and `.spur/config.yaml` maker routing so results match the subprocess path. Keep one warm maker per batch and `dispose()` it at the end (laya holds a Python worker). Keep the subprocess path for one-off CLI calls.

### Acceptance Criteria

```gherkin
Scenario: AC1 — model and heuristic scores share one scale (req: R1)
  Given an item labelled by both fm-local and the heuristic
  When both `kk-item-importance` labels are read from `labels`
  Then both values are on the same 1–5 scale and a test pins the mapping

Scenario: AC2 — selection ranking either uses model scores or stops paying for them (req: R2)
  Given the next `ai-news` selection run
  When items are ranked
  Then the run either reads accepted model scores (falling back to heuristic) or makes no fm-local scoring calls

Scenario: AC3 — a maker is chosen per dimension from replay evidence (req: R3, R4)
  Given a fixed replay set of at least 100 items
  When the A/B and selection-join reports run
  Then each dimension has a recorded maker choice or a drop decision backed by the report numbers

Scenario: AC4 — quality is back on laya-local (req: R5)
  Given spur with the bundled laya worker installed
  When `spur decision run kk-item-quality` runs
  Then the result has `maker: laya-local` and `reason: accepted` or `low-confidence`, never `error`

Scenario: AC5 — the daily safety verdict is a ledgered decision (req: R6)
  Given a daily safety run
  When the verdict state completes
  Then a `kk-safety-verdict` decision row exists in the spur ledger and a missing report yields `escalate`

Scenario: AC6 — podcast outline selection can be pre-answered (req: R7)
  Given `kk-solo-podcast` under an auto profile with outline evidence
  When the outline-select state runs
  Then a confident decision selects the outline without pausing, and a low-confidence one pauses for HITL

Scenario: AC7 — batch labelling runs in-process with identical results (req: R8)
  Given a replay set of 20 items
  When it is labelled through the in-process hub and through `spur decision run`
  Then values and reasons match per item, no `spur decision run` subprocess is spawned for the batch, and the process exits after the last item
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-19T18:26:11.323Z

- **2026-10-19, Robin:** adding `@gobing-ai/ts-ai-decision` as a knowledge-kit dependency is approved if necessary (R8). Pin it with the same lockstep version spur uses, so catalogs and maker semantics stay aligned.

### Design

**Principle: measure against outcomes, not acceptance.** The `selections` table
(`selected`/`published`/`dropped`) is the ground truth already sitting next to `labels`. Every maker
or prompt change is justified by a report over that join, not by accept rate or confidence alone.

**Maker choice by question type:**

| Need | Maker |
|---|---|
| Graded score whose confidence must discriminate (importance, quality) | probability-native: `typesafe`, `clef`, `laya-local` after R5 |
| Cheap local yes/no or coarse class | `fm-local`; read accept as "all samples agreed" |
| Deterministic signal available (keywords, source, recency) | heuristic / keyword maker; no model call |
| Nothing above fits | `llm-agent` (ts-libs 0115), the slowest option |

**Order matters.** R1 (scale) and R4 (does the dimension even matter) come before R3 (which maker),
because tuning a maker for a dimension that never reaches ranking is wasted work.

**Cost lever.** Per item: up to 8 subprocesses × (spawn + catalog load + maker). Pruning in R4 is
the cheapest saving. R8 (in-process hub, one warm laya worker shared across items) is the
structural one but adds a dependency, so it is evaluation-only until approved.

**Safety verdict (R6).** Keep the `agent.run` review that produces the report. Make only the final
pass/escalate/exclude a decide step with the report file as evidence and fallback `escalate`
(fail-safe), so a missing or garbled report never passes.

### Plan

1. R1: read the score mapping in `store.ts` (the `spur decision run` payload → `labels.value`), write a failing test for the scale, then fix it.
2. R4: write the labels × selections join report (SQL in a script under the project's scripts dir) and record per-dimension signal.
3. R2: decide on ranking use (Q&A), then wire or prune.
4. R3: run the replay A/B on the remaining dimensions and record the maker choice per dimension in `.spur/config.yaml` `decisions.makers`.
5. R6: add the `kk-safety-verdict` catalog entry and decide step; E2E on a fixture report, including the missing-report → `escalate` case.
6. R7: add the outline-select decide binding; E2E for both the confident and low-confidence paths.
7. R5: when spur-new 1262 ships, flip quality back to laya-local and run AC4.
8. R8: measure subprocess cost; write the proposal; ask Robin.
9. Gates: the project's full check suite.

### Root Cause

- **laya quality failures (verified, upstream):** the bundled spur CLI resolves ts-laya-mlx's worker script outside the package (`spur.js:70395`, `join(import.meta.dir,'..')`). Fixed upstream in ts-libs (`workerScript` / `LAYA_WORKER_SCRIPT`); delivery is tracked in spur-new task 1262.
- **Model scores absent from selection (verified by data):** 0 of 72 selected items carry an fm-local label; all 72 carry heuristic labels (`labels` × `selections` join, 2026-10-19).
- **Score collapse / scale (hypothesis):** fm-local emits 0 where the heuristic minimum is 1; a 0-indexed rubric vs a 1-based scale needs verification in `store.ts`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `.works/kk.db` tables `labels`, `selections`; `apps/cli/src/commands/store.ts` (label pipeline, `--replay --maker`), `apps/cli/src/itc-decision.ts:172-215`.
- `plugins/kk/decisions/kk-items.yaml`, `plugins/kk/workflows/kk-daily-safety.yaml:60-146`, `plugins/kk/workflows/kk-solo-podcast.yaml:93,158`, `docs/design/kk-solo-podcast.md` (D4).
- `.spur/config.yaml` (`decisions.paths`, `decisions.makers`): changes made 2026-10-19.
- spur-new task 1262 (laya bundling, decide ledger gap, task-pipeline decision rework).
- ts-libs `docs/design/llm-agent-decision-backend.md` § Confidence granularity; `packages/ai-decision/README.md`; ts-libs tasks 0114–0116 (feature O1, `llm-agent`).

### History
