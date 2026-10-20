---
schema_version: 1
name: "Decision-maker effectiveness for item labeling: fm-local score collapse, laya restore, outcome-driven pruning, safety verdict"
status: done
template: issue
created_at: 2026-10-19T18:02:15.261Z
updated_at: "2026-10-20T05:33:17.843Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0317-verdict.json
feature_id: G33
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

- [x] R1. Verify the score-scale mapping between model labels (0-indexed rubric) and heuristic labels (1–5) in `apps/cli/src/commands/store.ts`, and fix it if the scales differ, so model and heuristic scores are comparable before any tuning.
- [x] R2. Decide, and record in the task Q&A, whether model scores drive selection ranking. If yes, wire the accepted model score into ranking with the heuristic as fallback. If no, stop calling fm-local for dimensions that do not feed selection.
- [x] R3. Run a per-dimension maker A/B with `kk store label --replay --maker <m>` on a fixed replay set of at least 100 items (fm-local vs typesafe vs clef, and `llm-agent` once ts-libs 0115 ships). Record the value distribution, accept rate, latency and agreement with editor outcomes; pick a maker per dimension from that data.
- [x] R4. Run an outcome-driven pruning analysis: join `labels` to `selections` (`selected`/`published`/`dropped`) and report, for each dimension, how well its value predicts selection. Drop or demote dimensions with no predictive signal to cut per-item subprocess cost.
- [x] R5. Restore `kk-item-quality: laya-local` in `.spur/config.yaml` once spur-new task 1262 ships the bundled laya worker, and verify it with a live `spur decision run kk-item-quality`.
- [x] R6. Add a `kk-safety-verdict` catalog decision (choice `pass`/`escalate`/`exclude`, fallback `escalate`) and replace the self-reported-confidence verdict read in `kk-daily-safety.yaml` with a `kind: decide` step over the safety report as evidence.
- [x] R7. Give `kk-solo-podcast` outline-select (`:93`) an evidence-mode decide binding that pre-answers the gate under an auto profile, falling back to the HITL pause on low confidence (same pattern as kk-itc via `itc-decision.ts`).
- [x] R8. Replace the 8+ `spur decision run` subprocesses per item with an in-process `@gobing-ai/ts-ai-decision` hub in the batch labelling path (new dependency accepted by Robin 2026-10-19, see Q&A). Load the same catalogs and `.spur/config.yaml` maker routing so results match the subprocess path. Keep one warm maker per batch and `dispose()` it at the end (laya holds a Python worker). Keep the subprocess path for one-off CLI calls.

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

#### Q&A entry — 2026-10-20T01:10:00.000Z

- **Implementation (R2):** model scores do **not** drive selection ranking. `planEpisode`'s `planScore` reads source base + relevance + engagement only; 0 of 72 selected items carried a model label at audit time; and the outcome join over 245 items shows no graded dimension separating published from dropped (AUC 0.43–0.53). Consequence: the default `kk store label` pass no longer consults `kk-item-quality|importance|urgency|impact` (8 → 4 consults per item, then 1–4 in-process calls); `--mode decision` still routes all eight as the A/B surface, and `decisions.makers` stays populated for that use.

- **Implementation (R3/R4):** per-dimension evidence is in `.works/test-artifacts/0317/decision-effectiveness-report.md` (replay set 105 items, `since:4d`). `fm-local` accepts ~70 % at ~5 s/call; `typesafe` accepts ~98 % at ~0.27 s/call; `clef` is unavailable here (consumer-registered maker with no Cloudflare token). Maker of record if a graded dimension ever gains a consumer: **typesafe** (probability-native confidence, ~18× faster, 98 % accept) — today no graded dimension is wired, so the choice is documented, not applied. One small-sample exception is flagged for a follow-up A/B: `kk-item-quality` under `fm-local` separates published from dropped at AUC 0.833 on 25 outcome-bearing items (7 dropped) — directional only.

- **Implementation (R5):** the laya restore stays blocked. On spur 0.4.15, `spur decision run kk-item-quality --maker laya-local --json` answers `{"source":"default","reason":"error","durationMs":23}`, and the installed package ships no `worker/` directory. `kk-item-quality` remains `fm-local`; `.spur/config.yaml` carries the re-check date and the flip instruction for when spur-new 1262 ships.

- **Implementation (R8):** the in-process hub is live for makers that construct outside spur's bundle (`fm-local`) and falls back to `spur decision run` for those that do not (`typesafe`: `@opentelemetry/api`, a `@gobing-ai/ts-infra` peer, resolves only inside spur's bundle). AC7 measured 20/20 items agreeing on value and reason between the two transports, with no subprocess spawned in the hub path (run with `spur` absent from `PATH`).

#### Q&A entry — 2026-10-20T05:27:13.009Z

- **Re-verify (R5, supersedes the 2026-10-20T01:10 R5 entry):** spur 0.4.17 ships `worker/laya_worker.py` (spur-new 1262 delivered). The `--force` re-verify restored `kk-item-quality: laya-local` at `.spur/config.yaml:257`. A live `spur decision run kk-item-quality` with no `--maker` flag returns `maker: laya-local`, `makerSource: config-decision`, `reason: accepted` (~1.4 s), so AC4 is now MET, not N/A. The re-verify also re-anchored stale Testing citations: `store.ts:587` → `decisionValue` at `:532`, and the truncated AC5 cell.

#### Q&A entry — 2026-10-20T05:33:17.842Z

- **Re-verify (review F2/F4 closed, feature link):** the `## Review` P4s marked "follow-up" are closed in this change rather than deferred. F2: `kk store label --replay` now prints `{replayed, labeled, consults, consultMs, refused, run}` (`apps/cli/src/commands/store.ts:1011`), pinned by `apps/cli/tests/store-label.test.ts:929`. F4: a 403-item `--replay since:14d --maker laya-local --decisions kk-item-quality` (0 refused, ~21 ms/item warm) followed by the outcome join gives laya-local AUC 0.423 on n=156, verdict `none`. The fm-local AUC 0.833 (n=25) does not replicate, so quality stays out of ranking (see report §5). The task is now linked to feature **G33**, which was created for it because the closest existing owner, G32, is closed and its 13 scenarios do not cover 0317.

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

| File | Change | Why |
|---|---|---|
| `apps/cli/src/decision-hub.ts` (new, 1–300) | `createItemDecisionAsker`: lazily imports `@gobing-ai/ts-ai-decision`, loads `plugins/kk/decisions/kk-items.yaml`, resolves the maker from `.spur/config.yaml` (`decisions.makers[id]` → `decisions.maker` → catalog), bounds the body to `EVIDENCE_MAX_CHARS` (2000, spur's `DECIDE_EVIDENCE_MAX_CHARS`), and disposes the registry once per batch. A hub answer that failed *as a backend* falls through to `spur decision run` (latched after two failures). | R8: one warm maker per batch instead of 8+ subprocesses per item, with the same catalog, same maker precedence and same evidence bound as the subprocess path. The latch exists because the TypeSafe driver cannot construct outside spur's bundle (`@opentelemetry/api`, a `@gobing-ai/ts-infra` peer) — correctness first, performance where available. |
| `apps/cli/src/commands/store.ts:25,95–112,700–790,886–920,960–1000,1075–1110` | Label/replay paths take the asker (async `ask`), the evidence temp file and `NodeSyncProcessExecutor` call are gone, `asker.dispose()` runs in the `labelAction` `finally`. New `GRADED_DECISION_IDS` prunes the four graded dimensions from every non-`--mode decision` pass. | R8 (transport) + R2 (a collect run stops paying for scores nothing ranks on) + R2/AC2: the heuristic rows and the three judgment consults are unchanged. |
| `scripts/decision-signal-report.ts` (new) + `scripts/tests/decision-signal-report.test.ts` | Labels × selections join per decision × maker: counts, means per outcome, Mann–Whitney AUC (ties at half), `signal`/`none`/`insufficient` against `MIN_ITEMS=20` / `AUC_MARGIN=0.15`. | R4: makes "does this dimension predict anything" a repeatable, testable measurement instead of a one-off SQL session. Its docblock states the limit honestly: `selections` only holds planned items, so the join measures published-vs-dropped survival, never ranking rejection. |
| `plugins/kk/decisions/kk-safety.yaml` (new) | `kk-safety-verdict`: choice `pass|escalate|exclude`, fallback `escalate`, `minConfidence: 0`. | R6: the daily publish verdict becomes a calibrated, ledgered catalog decision whose fail-safe is `escalate`, not `pass`. |
| `plugins/kk/workflows/kk-daily-safety.yaml` (judge state, `judge -> clean`) | `kind: decide` over the report, the judge verdict and the gate status (`onError: continue`), then `kk stage daily-safety-verdict`, then a single-predicate accept guard over `09_safety-verdict.status`. | R6/AC5: replaces the shell `jq` re-parse of the judge's self-reported `confidence`; the gate keeps sole authority on `block`/`revise`, and a missing decision row refuses the edge. |
| `plugins/kk/scripts/daily-stages.ts:1984–2030`, `plugins/kk/scripts/kk-workflow-stages.ts:1651` | `dailySafetyVerdict`: folds gate status + stamp + decision row into `accept`/`refuse`, naming the refusal on stderr. | ADR-115 caps the guard at 5 logical commands; the fold is the one predicate the engine evaluates. |
| `plugins/kk/decisions/kk-podcast.yaml` (new), `plugins/kk/workflows/kk-solo-podcast.yaml` (new `outline-autopick` state, `auto` var, 5 edges) | Auto profile: one evidence file from the written option files → `kk-podcast-outline` decide → project `.auto-pick` only when the row is not `degraded`; otherwise the existing `outline-select` pause decides. | R7/AC6: the kk-itc outline pattern, without a new stage runner and without guessing on a fallback. |
| `.spur/config.yaml:252–262` | `kk-item-quality` comment now carries the 2026-10-19 R5 re-check (spur 0.4.15 still answers `reason: error` in 23 ms, no `worker/` dir) and the flip instruction. | R5/AC4: the restore is blocked upstream (spur-new 1262), recorded where the value lives. |
| `apps/cli/package.json` + root `package.json` + `bun.lock` | `@gobing-ai/ts-ai-decision` at the workspace's `^0.5.32` lockstep, `catalog:` in `apps/cli`; the CLI build externalizes it (lazy import, heavy graph). | R8: the dependency Robin approved in the Q&A, pinned lockstep, and not bundled into a 2 MB CLI entry for one command. |
| Tests: `apps/cli/tests/store-label.test.ts` (hub stub seam), `store-label-scale.test.ts` (scale pinning), `decision-hub.test.ts` (routing/evidence/latch/dispose), `kk-solo-podcast-workflow.test.ts` (autopick projection), `voice2-dag.test.ts` + `plugins/kk/tests/safety-reviewer-failure.test.ts` (decision-bound accept edge), `commands/stage.test.ts` (fixture build matches the production externals) | New behavior assertions; the old `KK_SPUR_BIN` stub became `KK_DECISION_HUB` (in-process double) so no test calls a model. | R1/R6/R7/R8 coverage, including the failure-first lists each file documents. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/store.ts:532-540` (decisionValue stores the rubric level 0..levels-1 unchanged, no index shift) + `apps/cli/tests/store-label-scale.test.ts:64` (6 rubric levels per graded decision) + `apps/cli/tests/store-label-scale.test.ts:80` (model level stored as the same integer the heuristic writes) |
| R2 | MET | Task Q&A 2026-10-20T01:10 (decision: no ranking consumer; AUC 0.43-0.53 over 245 items) + `apps/cli/src/commands/store.ts:112` (GRADED_DECISION_IDS) + `apps/cli/src/commands/store.ts:731` (graded dimensions skipped unless --mode decision) + `apps/cli/tests/store-label.test.ts:498` |
| R3 | MET | `.works/test-artifacts/0317/decision-effectiveness-report.md` (gitignored run artifact) §1 + ab-fm-local.log / ab-typesafe.log: 105-item replay set, fm-local ~70% accept at ~5 s, typesafe ~98% at ~0.27 s, clef unavailable (no Cloudflare token) |
| R4 | MET | `scripts/decision-signal-report.ts:87` (labels x selections join, Mann-Whitney AUC) + `scripts/tests/decision-signal-report.test.ts:48` + `.works/test-artifacts/0317/r4-signal-report.json` (gitignored run artifact); re-run this run after a 403-item laya-local replay (`.works/test-artifacts/0317/r4-signal-report-laya.json`): kk-item-quality/laya-local n=156 AUC 0.423 verdict none, so the fm-local AUC 0.833 (n=25) does not replicate |
| R5 | MET | Fix pass this run: spur 0.4.17 now ships worker/laya_worker.py (spur-new 1262 delivered); `.spur/config.yaml:257` flipped to `kk-item-quality: laya-local`; live `spur decision run kk-item-quality --param title=… --param source=… --evidence ev.txt --json` returned maker laya-local, makerSource config-decision, reason accepted, value 1, 1448 ms |
| R6 | MET | `plugins/kk/decisions/kk-safety.yaml:23` (choice pass/escalate/exclude) + `plugins/kk/decisions/kk-safety.yaml:46` (fallback escalate) + `plugins/kk/workflows/kk-daily-safety.yaml:100` (kind: decide) + `plugins/kk/scripts/daily-stages.ts:1997` (dailySafetyVerdict fold) + `plugins/kk/workflows/kk-daily-safety.yaml:182` (single-predicate accept guard) |
| R7 | MET | `plugins/kk/decisions/kk-podcast.yaml:23` + `plugins/kk/workflows/kk-solo-podcast.yaml:118` (kind: decide in outline-autopick) + `apps/cli/tests/kk-solo-podcast-workflow.test.ts:245` |
| R8 | MET | `apps/cli/src/decision-hub.ts:182` (createItemDecisionAsker) + `apps/cli/src/decision-hub.ts:92` (subprocess fallback latch) + `apps/cli/src/commands/store.ts:1088` (asker created per batch) + `apps/cli/src/commands/store.ts:1117` (dispose in finally) + `apps/cli/tests/decision-hub.test.ts:153`; in-process laya-local probe this run with no spur on PATH and the fallback stubbed: 3/3 model/accepted value 1 (1107 ms cold, 16-17 ms warm), dispose returned, exit 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — model and heuristic scores share one scale (req: R1) | MET | test | `apps/cli/tests/store-label-scale.test.ts:80`; bun test of the 7 scoped files this run: 122 pass / 0 fail |
| AC2 — selection ranking either uses model scores or stops paying for them (req: R2) | MET | test | `apps/cli/tests/store-label.test.ts:498` (unrouted item consults only the three judgment decisions) + `apps/cli/tests/store-label.test.ts:529`; 122 pass / 0 fail this run |
| AC3 — a maker is chosen per dimension from replay evidence (req: R3, R4) | MET | command | `scripts/decision-signal-report.ts:87` run output `.works/test-artifacts/0317/r4-signal-report.json` + decision-effectiveness-report.md §1/§3 (drop decision for all four graded dimensions; typesafe named maker of record) |
| AC4 — quality is back on laya-local (req: R5) | MET | command | `.spur/config.yaml:257`; live `spur decision run kk-item-quality` with no --maker flag this run: maker laya-local, makerSource config-decision, reason accepted (3 further --maker laya-local probes: accepted, 883-1561 ms, never error) |
| AC5 — the daily safety verdict is a ledgered decision (req: R6) | MET | command | live `spur decision run kk-safety-verdict` this run: value pass, reason accepted, invocation d1cd0b25; `.spur/spur.db` decision_logs holds kk-safety-verdict rows; escalate fallback pinned at `apps/cli/tests/voice2-dag.test.ts:802`; missing decision refuses the edge at `apps/cli/tests/voice2-dag.test.ts:822` |
| AC6 — podcast outline selection can be pre-answered (req: R7) | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:233` (binding before operator gate, defers on fallback) + `apps/cli/tests/kk-solo-podcast-workflow.test.ts:245` (confident writes .auto-pick; degraded/absent leaves it empty) |
| AC7 — batch labelling runs in-process with identical results (req: R8) | MET | command | `.works/test-artifacts/0317/ac7-in-process.jsonl` vs ac7-subprocess.jsonl re-diffed this run: 20/20 rows identical on id, value, reason (13 model/accepted, 7 default/error from identical fm model refusals on both transports); in-process run had no spur on PATH; laya-local in-process probe this run matched the subprocess answer (value 1, accepted) with no fallback spawned |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed against the requirements and ACs (evidence in `.spur/run/0b57553f-…-review-answer.txt`).

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | P4 | The TypeSafe driver cannot construct outside spur's bundle in a plain install (`@opentelemetry/api`, a `@gobing-ai/ts-infra` peer), so the in-process hub falls back to `spur decision run` for the three `typesafe` judgment decisions: correctness holds, the cost win does not apply to them. | Documented at `apps/cli/src/decision-hub.ts:88` and in `.works/test-artifacts/0317/decision-effectiveness-report.md` §1; the upstream packaging fix belongs to ts-infra / `@gobing-ai/ts-ai-decision`. Working fallback — no user-visible defect. |
| F2 | P4 | `kk store label --replay` prints no `refused` counter, so an out-of-range model answer is silently not written (21 of 27 asks in one AC7 attempt produced no row). | Pre-existing replay reporting gap, not introduced here; recorded in the report §2 caveat and left for a follow-up task. |
| F3 | P4 | `runDecisionSubprocess` assumes a synchronous `FileSystem` (evidence write and spawn in one tick). | Intentional and documented at `apps/cli/src/decision-hub.ts:275`; the production seam is sync and the transport is sync by contract. |
| F4 | P4 | `kk-item-quality` under `fm-local` separates published from dropped at AUC 0.833 (n=25, 7 dropped). | Directional only — recorded as a follow-up A/B candidate (report §2/§3), deliberately not wired into ranking on seven samples. |

Residual risk: the safety machine's accept edge now depends on the `kk-safety-verdict` catalog being servable in the project (`decisions.paths`); where it is not, the decide action is tolerated and the fold refuses the edge, so a run blocks instead of publishing — fail-closed, and the refusal names the missing decision on stderr. The podcast autopick state is additive: an unconfident or absent decision takes the pre-existing operator pause.

No open P1–P3 findings; no carried residual beyond the four P4 observations above (all closed, not deferred), which is why ADR-141 derives **HIGH** here. The verify answer states **MEDIUM** because AC4 is N/A on an unmet upstream precondition (spur-new 1262) and therefore carries no executable evidence; that row-level rule and this finding-level one answer different questions, and neither is a pass signal on its own.

Verdict: PASS
Confidence: HIGH

### References

- `.works/kk.db` tables `labels`, `selections`; `apps/cli/src/commands/store.ts` (label pipeline, `--replay --maker`), `apps/cli/src/itc-decision.ts:172-215`.
- `plugins/kk/decisions/kk-items.yaml`, `plugins/kk/workflows/kk-daily-safety.yaml:60-146`, `plugins/kk/workflows/kk-solo-podcast.yaml:93,158`, `docs/design/kk-solo-podcast.md` (D4).
- `.spur/config.yaml` (`decisions.paths`, `decisions.makers`): changes made 2026-10-19.
- spur-new task 1262 (laya bundling, decide ledger gap, task-pipeline decision rework).
- ts-libs `docs/design/llm-agent-decision-backend.md` § Confidence granularity; `packages/ai-decision/README.md`; ts-libs tasks 0114–0116 (feature O1, `llm-agent`).

### History

- 2026-10-20T01:44:14.948Z todo → wip (system)
- 2026-10-20T02:47:20.890Z wip → testing (system)
- 2026-10-20T02:47:21.998Z testing → done (system)

