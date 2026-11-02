---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-10-29"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-10-29T00:00:00.000-07:00
    until: 2026-10-29T23:59:59.999-07:00
  sources:
    - source: claude
    - source: codex
    - source: pi
windowState: "provisional"
generatedAt: "2026-10-29T15:30:14.115Z"
validatedAt: "2026-10-29T15:30:14.115Z"
artifactDigest: "77388808a71a1cae6123aa8dbb48cd2ea9830f786f6771590f04b9e7f4e5a64f"
baselineArtifactDigest: "4d49c0e2614f5f58fe8cafc550ce42ca31939299b13b4f6ee2fd53eb04e0a58b"
contractDigest: "34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5"
skillDigest: "bcd34064fb82e1d397715b1b6dcca8b68bd410f0761ddc3c529a9d49b2e1c5c1"
workflowDigest: "not available"
helperDigest: "a076bd717c8f320f0b526f357802e9a4f2a26a50205ca81242ec68989d4fb539"
runId: "7f00e5ba-a3d9-4d11-a86e-491e04b5b947"
currentArtifactPath: ".spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json"
spurVersion: "not available"
schemaVersion: 1
executor: "coder"
model: "not available"
cacheDisposition: "miss"
coverage:
  - source: claude, status: ok, lastImportedAt: 2026-10-29T15:30:10.478Z
  - source: codex, status: ok, lastImportedAt: 2026-10-29T15:30:10.777Z
  - source: pi, status: ok, lastImportedAt: 2026-10-29T15:30:07.926Z
---

> imported snapshot as of 2026-10-29T15:30:07.926Z · window provisional · cache miss

<!-- Candidate authored by sp:history-anatomy enrich · mode daily · run 7f00e5ba-a3d9-4d11-a86e-491e04b5b947 · schema v1 -->

# History forensics report — 2026-10-29 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `7f00e5ba`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-10-29`, baseline is the immediately preceding local calendar day `2026-10-28` |
| Current window | `2026-10-29T00:00:00.000-07:00` → `2026-10-29T23:59:59.999-07:00` (America/Los_Angeles) |
| Baseline window | `2026-10-28T00:00:00.000-07:00` → `2026-10-28T23:59:59.999-07:00` (America/Los_Angeles) |
| Window state | `provisional` — generation happened at `2026-10-29T15:30:14.115Z` (08:30:14 local), 8.5 h into the local day it measures, with bounds running to `23:59:59.999`. Read from the run-level `windowState` in `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-provenance.json`; neither artifact JSON carries a `windowState` field |
| Generated | `2026-10-29T15:30:13.042Z` (current) · `2026-10-29T15:30:13.612Z` (baseline) |
| Toolchain | spur `0.4.20` (artifact `#/spurVersion`; the provenance file records `spurVersion` as `not available`) · artifact `schemaVersion` `1` · executor `coder`, model `not available` · contract version `1` |
| Digests | artifact `77388808a71a1cae6123aa8dbb48cd2ea9830f786f6771590f04b9e7f4e5a64f` · baseline artifact `4d49c0e2614f5f58fe8cafc550ce42ca31939299b13b4f6ee2fd53eb04e0a58b` · contract `34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5` · skill `bcd34064fb82e1d397715b1b6dcca8b68bd410f0761ddc3c529a9d49b2e1c5c1` · helper `a076bd717c8f320f0b526f357802e9a4f2a26a50205ca81242ec68989d4fb539` · workflow `not available`. Read from `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-provenance.json` |
| Selector | sources `all`, no session/run/task narrowing, leaderboard depth `20` |
| Cache disposition | `miss` — no cached artifact existed for this date, so the run recomputed |
| Current artifact | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.md` |
| Selector file | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-selector.json` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| claude | ok | 8 | 1004 | 148 | 0 | 0 | 0 | `2026-10-29T15:30:10.478Z` |
| codex | ok | 1 | 63 | 6 | 0 | 0 | 0 | `2026-10-29T15:30:10.777Z` |
| pi | ok | 4 | 107 | 37 | 0 | 0 | 0 | `2026-10-29T15:30:07.926Z` |

Population: `13` sessions, `11` tool keys, `0` loop signals, `1` warning, leaderboard depth applied `20` (`#/population`). Both `13` and `11` are below `20`, so the session and tool enumerations are complete rather than bounded — F6 shows the tool count is complete but internally fragmented, and F7 shows the message population is not single-valued even before it is bounded. The step leaderboards (`#/topStepsByTokens`, `#/topStepsByDuration`) hold `20` rows each and are slices of the `324` assistant steps reported by `#/stepSupport` (claude 277 + codex 7 + pi 40), not population totals. The baseline artifact applies the same depth to `441` assistant steps (claude 257 + pi 184), so neither artifact's step leaderboards are population totals.

A third source lane (`codex`) appears in this window and is absent from the baseline artifact, whose `#/coverage` lists only `claude` and `pi`. That asymmetry is one of the comparability blockers recorded in section 3, and the codex lane's own measurement coverage is F11.

## Executive summary

- The measured current window is 13 sessions, 1,044 messages, 191 tool calls, a 1.21 h activity span, and `$2.958762` of provider-billed cost across three sources (`claude`, `codex`, `pi`). All three sources imported with zero parse and zero validation errors.
- One P1 is a latency concentration, not a defect: pi's 40 assistant steps consume `1,818,181` ms of assistant duration — 67.17% of the window's `2,706,952` ms — at a 45,454.5 ms mean per step against claude's 3,444.8 ms over its 258 timed steps (13.2×). LLM wait is 89.05% of the span, and pi is 12.3% of the window's 324 assistant steps.
- The second P1 is an instrumentation defect that got wider, not narrower: all 148 claude tool calls and all 6 codex tool calls carry no duration (`#/totals/durationUnmeasured` 154 of 191 calls), so the tool axis exists only for pi's 37 calls, `toolMs` is `1,143` ms, and `449,317` ms sits unattributed. Six of eight claude sessions remain `in-progress`.
- Three further measurement defects sit underneath the numbers (F3 and F4 are P2, F7 and F8 are P3): the `llmMs` bucket (`3,884,609` ms) exceeds the sum of the per-source `assistantDurationMs` rows (`2,706,952` ms) by `1,177,657` ms; 12 of the 20 largest-by-token steps form six usage-identical claude pairs worth `$0.123252` (4.17% of window cost); and the pairing cost fold covers only 1 of 3 pairings while that one row sits below the window total at `$1.49478` of `$2.958762` — the opposite direction from the baseline artifact's own costed rows.
- The tool population is reported as `11` keys for at most `7` distinct tools, because the three lanes name the same tools differently (shell alone is split `bash` 29 / `Bash` 73 / `exec` 6) and every pi-lane row and the codex `exec` row record `resultBytes` 0 across 43 calls.
- The outcome axis is `not available` for this window: `taskDenominator` 0, `verifiedResults` 0, every `excludedReasons` bucket 0, `costCoverage` `{covered: 0, total: 0}`. No work in this window is tied to a verified outcome by this artifact, so cost per verified result cannot be computed.
- The workflow half is healthy on the axes it does measure: 0 tool errors across 191 calls, 0 parse and 0 validation errors across 13 files, 92.90% of billed input served from cache, and 20 of 21 chained `agent.run` dispatches succeeded with 0 unknown outcomes — though the one recorded escalation (`resource-exhaustion`) sits on a pairing whose cost is `not available` (F12).
- Baseline comparison verdict: **not comparable**. The daily rule is satisfied in form, but the current window is a provisional partial day against a baseline captured from a stale import snapshot of a closed day, the two artifacts cover different source sets (the current window adds `codex`), and neither artifact carries a single message population. No trend, delta, or percentage is stated against the baseline anywhere in this report, and every finding is classified `not-comparable`.

## Baseline comparison

**Verdict: `not comparable`.** No trend, no delta, and no percentage is stated against the baseline anywhere in this report. Five independent differences block comparability, and each is stated as its own artifact's value rather than as a computed change:

1. **Window symmetry.** The current window is `provisional`: generated `2026-10-29T15:30:13.042Z` (08:30 local), 8.5 h into the local day it measures, against bounds ending `23:59:59.999`. The daily rule pairs it with `2026-10-28`, a closed day. A partial day and a closed day are not equal-duration windows.
2. **Stale baseline snapshot.** The baseline artifact's recorded imports are `2026-10-28T17:19:16.375Z` (claude) and `2026-10-28T17:19:15.382Z` (pi), i.e. 10:19 local on the day being measured, while that artifact was generated `2026-10-29T15:30:13.612Z` — 22.2 h later. The current artifact's imports landed 2.27 s (codex), 2.56 s (claude) and 5.12 s (pi) before its own generation. The baseline therefore describes a corpus captured before roughly 13.5 h of its own window had occurred, and the two artifacts were produced under materially different import regimes.
3. **Source-set coverage.** The current window covers three lanes (`claude` 8 files, `codex` 1 file, `pi` 4 files); the baseline covers two (`claude` 5 files, `pi` 8 files). No codex figure has a baseline counterpart at all, so no codex cell in this report can be compared to anything.
4. **Record populations.** The current artifact's `#/coverage` sums to `1,174` messages against `#/totals/messages` `1,044`; the baseline's `#/coverage` sums to `1,328` against `#/totals/messages` `1,209`. Neither artifact's message denominator is single-valued (F7), so per-message comparison has no common denominator.
5. **Leaderboard composition.** The current `#/topStepsByTokens` contains six usage-identical row pairs; the baseline's 20 rows contain none. Two "top step" distributions with different composition and a different duplicate regime are not the same statistic.

Per-axis current values, stated as separate facts only:

| Axis | Current artifact | Baseline artifact | Compared? |
| --- | --- | --- | --- |
| Window state | `provisional`, 8.5 h into the day | closed day, snapshot captured 10.3 h into its day | no |
| Sources | `claude`, `codex`, `pi` | `claude`, `pi` | no — different source sets |
| Sessions | 13 (claude 8, codex 1, pi 4) | 13 (claude 5, pi 8) | no |
| Messages (`#/totals`) | 1,044 | 1,209 | no |
| Tool calls | 191 | 344 | no |
| Instrumented tool calls | 37 of 191 | 207 of 344 | no |
| Assistant duration | 2,706,952 ms over 305 timed steps of 324 | 11,954,992 ms over 414 timed steps of 441 | no |
| Span | 4,362,171 ms (1.21 h) | 13,648,808 ms (3.79 h) | no |
| Cost | `$2.958762` | `$3.955347` | no |
| Cache-read tokens | 15,301,745 of 16,471,828 billed input | 30,851,124 of 32,016,609 billed input | no |
| Loop signals | 0 | 1 (`repeats` 3) | no |
| Verified outcomes | denominator 0, all rates `null` | denominator 0, all rates `null` | no |

The one same-shape observation that both artifacts support — and which is reported as "present in both", never as a change — is the class of measurement defects: the claude lane is fully untimed in both (`148` of `148` calls now, `137` of `137` in the baseline), the `llmMs` bucket exceeds its own per-source rows in both (`1,177,657` ms and `1,117,586` ms), the phase fold is empty in both, the render header is corrupted in both, and the pairing cost fold relates to the window total in the opposite direction in each. Those are recorded per finding in section 5 as `not-comparable` with a discrete-presence note, not as trends.

## Findings

Twelve problem findings, ordered P1 first then by impact. Every field set is complete; `trend` is `not-comparable` for all of them because the baseline was found `not comparable` in section 3. All commands are reproducible verbatim from the repository root and none was run by this report.

### F1 — pi per-step assistant latency is 13.2× claude's and carries two thirds of all measured LLM time

- `key`: `performance:pi-dsv4-1-flash-executor:per-step-latency`
- `category`: `performance`
- `impact`: The window's dominant cost term is LLM wait (89.05% of the 1.21 h span), and it is dominated by one lane on a small step count. pi accounts for 40 of 324 assistant steps (12.3%) but `1,818,181` of `2,706,952` ms of assistant duration (67.17%), at a 45,454.5 ms mean per timed step against claude's 3,444.8 ms — 13.2×. Routing work to this executor multiplies wall-clock latency per step by that factor, and a single pi session (`2026-10-29T11-39-55-583Z_01a18775-a13f-7083-8959-2fb29f776ed1`, `809,013` ms) alone holds 18.55% of the whole span.
- `trend`: `not-comparable`
- `observation`: `#/bySource/pi/assistantDurationMs` is `1,818,181` with `assistantDurationUnmeasured` 0; `#/stepSupport/2` reports pi `assistantSteps` 40 and `stepsWithDuration` 40, giving a `45,454.5` ms mean. `#/bySource/claude/assistantDurationMs` is `888,752` with `#/stepSupport/0` `stepsWithDuration` 258 of 277 assistant steps, giving `3,444.8` ms per timed step (`3,208.5` ms if divided over all 277). `#/bySource/codex/assistantDurationMs` is `19` over 7 steps. `#/derived/timeDecomposition` reports `llmMs` `3,884,609` of `spanMs` `4,362,171` (89.05%), and `#/derived/bottlenecks[0]` is `llm` at share `0.89052`. Of pi's four sessions in `#/bySession`, `809,013` / `580,192` / `361,881` / `67,095` ms sum to the lane total, with the largest at 44.5% of the lane.
- `inference`: Because pi's duration denominator is complete (40 of 40 steps timed, no unmeasured calls, 0 `assistantDurationUnmeasured`), its per-step mean is measured rather than derived, so the 13.2× gap is a property of the executor/model pairing rather than of missing data. Named observations: the complete pi timing denominators, the 67.17% duration share on 12.3% of steps, and the 13.2× mean ratio against claude's 258-step denominator.
- `contradictions`: claude is not fully timed either — 19 of its 277 steps carry no duration — so its 3,444.8 ms mean is computed on 258 steps and its true mean is bounded below, which widens the ratio rather than closing it. codex contributes `19` ms over 7 steps (2.71 ms/step), a figure too small to be a real LLM round-trip for its 65k–73k-token steps and treated as unusable in F11, so the window's assistant-duration total is effectively pi plus claude only. The executor pairing named `pi-dsv4.1-flash-volc` is also the pairing that is slowest as a reviewer in F3's table, which is consistent with a lane-level property; that agreement is a hypothesis with one comparative signal, and its confirmation path is a same-model latency probe outside this evidence plane.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/bySource`, `#/stepSupport`, `#/bySession`, `#/derived/timeDecomposition`, `#/derived/bottlenecks`
- `severity`: P1
- `reproCommand`: `jq -c '{src:[.bySource|to_entries[]|{s:.key,ms:.value.assistantDurationMs}],steps:[.stepSupport[]|{s:.source,steps:.assistantSteps,withDur:.stepsWithDuration}],span:.derived.timeDecomposition.spanMs,llm:.derived.timeDecomposition.llmMs}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `pi-dsv4.1-flash-volc` executor routing — model selection, reasoning effort and dispatch concurrency in the executor routing configuration consumed by `spur history analyze` `#/pairings` and `#/bySource`.

### F2 — the tool axis is instrumented for one lane only, and the additive time fold does not reconcile

- `key`: `telemetry:spur-history-import:claude-tool-duration-unmeasured`
- `category`: `telemetry`
- `impact`: The tool axis is measured for one of three lanes. All 154 non-pi tool calls (148 claude, 6 codex) — 80.63% of the window's 191 calls — contribute no duration, so `#/derived/timeDecomposition/toolMs` (`1,143` ms) describes pi's 37 calls while presenting itself as a window total, and `449,317` ms of the span falls into `unattributedMs`. Tool-time regressions in the claude and codex lanes are invisible to this report. Separately, the LLM bucket does not reconcile to its own source rows: `llmMs` `3,884,609` exceeds the sum of `#/bySource/*/assistantDurationMs` (`2,706,952`) by `1,177,657` ms, so every llm-share statement in section 8 rests on a bucket that is not tied to the rows it claims to aggregate.
- `trend`: `not-comparable`
- `observation`: `#/totals/durationUnmeasured` is `154` against `#/totals/toolCalls` `191`, and instrumented calls sum to `37` (`bash` 29 + `read` 4 + `write` 4), matching `#/bySource/pi/toolCalls` 37. Every claude-lane and codex-lane `#/byTool` row reports `durationMsTotal` 0 with `durationUnmeasured` equal to its `calls` (`Bash` 73, `Read` 51, `Write` 8, `Skill` 7, `ctx_execute` 5, `ctx_execute_file` 2, `ToolSearch` 2, `exec` 6). Six of the eight claude rows in `#/bySession` carry `sessionState` `in-progress` (all four pi and the one codex session are `complete`). `#/warnings/0` states `449317ms` could not be attributed to llm/tool/idle because some durations were unmeasured, and `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:120` excludes 19 assistant steps from the duration leaderboard for the same reason.
- `inference`: The two observations agree on one seam — the claude lane emits no per-call timing and leaves most sessions unterminated, and the analyzer has nothing to measure with, so per-call durations and the session terminal state are missing together. Named observations: the 154-of-191 unmeasured tool calls, the 6-of-8 `in-progress` claude sessions against 5-of-5 `complete` sessions in the other two lanes, and the warning naming unmeasured durations as the cause of the unattributed bucket.
- `contradictions`: `#/coverage/0/status` is `ok` with 8 files, `0` parse errors and `0` validation errors, so the import surface reports clean success while most of its tool calls are untimed. The artifact carries two different counts for the same quantity: `#/bySource/claude/assistantDurationUnmeasured` is `7`, while `#/stepSupport/0` implies `19` (`277` − `258`) and the render excludes 19. The `llmMs` residual over the per-source rows (`1,177,657` ms) is a third, independent manifestation of the same gap; a hypothesis for it (one signal, arithmetic coincidence) is that duration-less claude steps are given synthesized durations inside `llmMs` without appearing in `bySource`, whose confirmation path is recomputing `llmMs` with duration derivation disabled and diffing against `2,706,952` ms.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byTool`, `#/bySession`, `#/totals`, `#/stepSupport/0`, `#/bySource/claude`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:120` (Top Steps by Duration exclusion note)
- `severity`: P1
- `reproCommand`: `jq -c '{toolUnmeasured:([.byTool[].durationUnmeasured]|add),calls:([.byTool[].calls]|add),instrumented:([.byTool[]|select(.durationUnmeasured==0)|.calls]|add),sessions:[.bySession[]|{s:.source,st:.sessionState}],claudeDurGap:(.stepSupport[0].assistantSteps-.stepSupport[0].stepsWithDuration),claudeUnmeasuredField:.bySource.claude.assistantDurationUnmeasured,assistSum:([.bySource[].assistantDurationMs]|add),llm:.derived.timeDecomposition.llmMs}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the claude and codex source lanes' tool-call and session-terminal record emission, consumed by the `spur history analyze` `byTool`, `stepSupport` and `timeDecomposition` folds.

### F3 — the pairing cost fold covers one pairing and again relates to the window total with the opposite sign from the baseline

- `key`: `telemetry:spur-history-analyze:pairing-cost-not-reconciled`
- `category`: `telemetry`
- `impact`: The pairing fold is the only place cost is attributable to a named stage, and it prices 6 of this window's 21 dispatches. The one costed row covers `$1.49478` of `$2.958762` — 50.52% — while both reviewer pairings report duration but no cost, so per-stage cost per minute cannot be computed for the roles that dispatched most. The relationship to the window total also changes sign between artifacts: below the total here, above it in the baseline's own rows, so an operator has no invariant to compute a share against.
- `trend`: `not-comparable`
- `observation`: `#/pairings[2]` (`executor` `pi-dsv4.1-flash-volc`, `role` `scribe`) carries `totalCostUsd` `1.49478` with `dispatches` 6, `successRate` 1, `failures` 0 and `meanDurationMs` `679,628.09`. `#/pairings[0]` (`claude`, `reviewer`, 9 dispatches) and `#/pairings[1]` (`pi-dsv4.1-flash-volc`, `reviewer`, 6 dispatches) both carry `totalCostUsd` `null` while reporting `meanDurationMs` `263,820.45` and `1,362,947.88`. Summing every non-null `totalCostUsd` gives `1.49478`, which is `1.463982` below `#/totals/costUsd` `2.958762`. The baseline artifact's `#/pairings` costs 2 of its 3 rows (`pi-dsv4.1-flash-volc` reviewer `$4.0212`, scribe `$2.377296`), sums to `6.398496` against its own `#/totals/costUsd` of `3.955347`, and leaves the `claude` reviewer `null`.
- `inference`: The fold has no reconciliation invariant in either direction — it sits below the window total here and above it in the baseline artifact — while consistently keeping duration for every dispatch and cost for only a subset. Named observations: the 1-of-3 cost coverage with 3-of-3 duration coverage, the `1.463982` shortfall against this window's total, and the opposite-direction relationship in the baseline artifact's rows.
- `contradictions`: `totalCostUsd` `null` on 2 of 3 pairings renders as `not available` under the truthfulness invariant, which is the correct treatment, so the fold is not fabricating values — the defect is reconciliation and coverage, not fabrication. The scribe pairing is internally consistent (6 dispatches, `successRate` 1, `failures` 0), so nothing here says dispatch accounting is wrong. `model` is `null` on all three rows, so cost cannot be attributed to a model through this fold.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`, `#/bySource`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/pairings`, `#/totals/costUsd`
- `severity`: P2
- `reproCommand`: `jq -c '{pairSum:([.pairings[].totalCostUsd|select(.!=null)]|add),dayTotal:.totals.costUsd,nullCost:([.pairings[]|select(.totalCostUsd==null)|{e:.executor,r:.role,d:.dispatches}]|length),pairs:[.pairings[]|{e:.executor,r:.role,d:.dispatches,c:.totalCostUsd,ms:.meanDurationMs}]}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: the pairing analytics fold consumed by `spur history analyze` — the `pairings` projection and its cost and model joins.

### F4 — twelve of the twenty largest-by-token steps form six usage-identical pairs

- `key`: `telemetry:spur-history-import:duplicate-usage-records`
- `category`: `telemetry`
- `impact`: Twelve of the 20 largest-by-token steps — `$0.123252` of `$2.958762` window cost, 4.17% — are six pairs whose usage and cost are identical to the micro-dollar while their timestamps and durations differ, five pairs separated by 1.06 s or less. If one row of each pair is a duplicate record, window cost, claude token totals and per-step latency are all overstated for the lane that owns 73.38% of spend; if both rows are real, the provider billed the same response twice and the same overstatement exists with a different cause. Either way the top of the token leaderboard cannot be read as 20 distinct steps.
- `trend`: `not-comparable`
- `observation`: Grouping `#/topStepsByTokens` by `(inputTokens, cacheReadTokens, outputTokens, costUsd)` yields six `claude` pairs: `(2, 120273, 1703, 0.025551)` at `2026-10-29T12:19:07.804Z` and `12:19:25.049Z` with `durationMs` 12,061 and 17,245; `(2, 122206, 335, 0.005031)` at `14:17:51.384Z` and `14:17:52.440Z` with 3,456 and 1,056; `(2, 122584, 834, 0.012516)` at `14:18:03.413Z` and `14:18:04.457Z` with `null` and 1,044; `(2, 123051, 105, 0.001581)` at `14:18:06.880Z` and `14:18:07.170Z` with 2,169 and 290; `(2, 123977, 648, 0.009726)` at `14:18:16.184Z` and `14:18:17.016Z` with 8,534 and 832; `(2, 127315, 481, 0.007221)` at `12:57:44.822Z` and `12:57:45.535Z` with 6,275 and 713. The six pairs sit in three claude sessions (`8bdf1fd7` four pairs, `f8d079e7` one, `6561c07e` one). No `pi` or `codex` row is duplicated. Grouping the baseline artifact's 20 rows the same way yields no pair.
- `inference`: Identical `inputTokens`, `cacheReadTokens`, `outputTokens` and `costUsd` across two records is consistent with one provider response being written twice — a retried request whose first reply was already recorded, or a duplicate import line — rather than with two independent requests producing identical output-token counts, and the sub-second separations within five of the pairs fit a retry far better than two deliberate calls. Named observations: the six exact-tuple pairs, the differing durations within each pair (which rules out a byte-identical copy), the confinement of all twelve rows to three claude sessions, and the absence of the pattern in the baseline leaderboard. Bounded to the top 20 of 324 assistant steps; steps outside the leaderboard were not examined, so this is a floor on the pattern, not a window total.
- `contradictions`: `#/stepSupport/0` reports claude `stepsWithUsage` `277` of `277` with no duplicate marker, so nothing in the fold flags a record as a repeat and the artifact carries no field distinguishing a duplicate from a genuine re-bill. `#/cacheWaste` is empty (0 steps, 0 tokens) because its filter targets large fresh-input re-sends, which this pattern is not, so the existing waste detector can neither corroborate nor refute it. One of the twelve rows carries `durationMs` `null` while its twin carries a duration, equally consistent with a pre-duration echo as with two distinct records.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/topStepsByTokens`, `#/stepSupport/0`, `#/cacheWaste`, `#/bySource/claude`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/topStepsByTokens`
- `severity`: P2
- `reproCommand`: `jq -c '[.topStepsByTokens[]|{ts,src:.source,sid:.sessionId,u:[.inputTokens,.cacheReadTokens,.outputTokens,.costUsd],ms:.durationMs}]|group_by(.u)|map(select(length>1)|{u:.[0].u,n:length,hits:[.[]|{ts,ms,sid:.sid[0:8]}]})' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the claude source lane's record de-duplication key, consumed by the `topStepsByTokens` and totals folds.

### F5 — the outcome axis is empty for the window

- `key`: `coverage:spur-task-check:verified-outcome-absent`
- `category`: `coverage`
- `impact`: The only dimension that ties agent activity to verified work contributes nothing: no task entered the fold, so `verifiedRate`, `correctionRate`, `timeToVerified` and `measuredTokensPerVerifiedResult` are all `null` and `costCoverage` is `{covered: 0, total: 0}`. The report can describe 1.21 h and `$2.958762` of effort but cannot state that any of it produced a verified result, so cost-per-verified-result — the metric that would rank every other finding by value — is not computable for this window.
- `trend`: `not-comparable`
- `observation`: `#/verifiedOutcome` reports `taskDenominator` 0, `verifiedResults` 0, `verifiedRate` `null`, `verifiedWithoutCorrection` 0, `verifiedWithoutCorrectionRate` `null`, `correctionCount` 0, `correctionRate` `null`, `retryExhaustedCount` 0, `measuredTokensPerVerifiedResult` `null`, `timeToVerified` `{count: 0, meanMs: null, maxMs: null}`, `costCoverage` `{covered: 0, total: 0}`, and every `excludedReasons` bucket 0 (`notDone`, `forcedDone`, `missingVerdict`, `syntheticVerdict`, `verdictNotPass`, `proofAbsent`, `certifyingRunFailed`).
- `inference`: A zero denominator with every exclusion bucket at zero means no task was in scope for the fold at all, which is a scope gap rather than a proof failure — in contrast to an exclusion-driven zero, which would name a bucket and a reason. Named observations: the zero `taskDenominator`, the all-zero `excludedReasons`, and the zeroed `costCoverage` that follows from both.
- `contradictions`: The window clearly contains task-shaped work — 191 tool calls including 12 `Write`-family calls and 108 shell calls — so activity exists that the outcome fold does not see. The artifact records no field explaining why the denominator is 0, so whether tasks were created after the fold's snapshot or are simply not linked to a verdict cannot be determined here. The baseline artifact reports the identical all-zero shape, so this is not a one-off measurement failure in this window.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/verifiedOutcome`
- `severity`: P2
- `reproCommand`: `jq -c '.verifiedOutcome|{den:.taskDenominator,verified:.verifiedResults,rate:.verifiedRate,excluded:.excludedReasons,cost:.costCoverage,ttv:.timeToVerified}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `spur task check` — the verification gate whose PASS proof the `verifiedOutcome` fold reads, together with the fold's task-window join.

### F6 — eleven tool keys describe at most seven tools, and 43 calls carry no result volume

- `key`: `telemetry:spur-history-analyze:tool-identity-fragmentation`
- `category`: `telemetry`
- `impact`: `#/population/tools` reports `11` while the window contains at most 7 distinct tools, so the tool population is overstated and the busiest tools are each split across rows. Shell activity alone is split `bash` 29 / `Bash` 73 / `exec` 6, naming 56.54% of all calls only when the three rows are added by hand, and `resultBytes` is 0 for all 37 pi-lane calls and the 6 codex calls, so context volume is unmeasurable for 43 of 191 calls (22.51%) while the claude-lane equivalents record it (`Read` 350,937 B, `Bash` 31,557 B). Ranking or budgeting tool behaviour by name mis-attributes the largest category.
- `trend`: `not-comparable`
- `observation`: `#/byTool` keys are `bash` (29), `Bash` (73), `exec` (6), `read` (4), `Read` (51), `write` (4), `Write` (8), `Skill` (7), `ToolSearch` (2), `mcp__plugin_context-mode_context-mode__ctx_execute` (5) and `mcp__plugin_context-mode_context-mode__ctx_execute_file` (2) — 11 keys, 191 calls. Shell appears under three keys summing `108` calls (56.54%); read under two (`4` + `51`); write under two (`4` + `8`); the MCP pair, `Skill` and `ToolSearch` are singletons. `#/coverage` splits along the same seam: pi contributed exactly the lowercase keys (29 + 4 + 4 = 37), codex exactly `exec` (6), and claude exactly the capitalized, MCP and `ToolSearch` keys (73 + 51 + 8 + 7 + 2 + 5 + 2 = 148). `resultBytes` is `0` on all three pi keys and on codex's `exec`, and non-zero on every claude-lane key that returns content (`Read` 350,937, `Bash` 31,557, `Write` 1,616, `ToolSearch` 727, `ctx_execute` 605, `ctx_execute_file` 252, `Skill` 250).
- `inference`: The split aligns exactly with the source boundary — the pi adapter emits lowercase tool names without a result-size field, codex emits `exec` with neither a size nor a duration, and the claude adapter emits capitalized names with both — so the fragmentation is an adapter field-mapping difference rather than genuine tool diversity. Named observations: the three key families, the exact per-source partition of lowercase versus capitalized-plus-MCP keys, and the zero `resultBytes` confined to the pi and codex rows.
- `contradictions`: The model label is less fragmented but not clean — `#/byModel` holds four keys (`claude-opus-5`, `deepseek-v4-1-flash-261017`, `gpt-6-astra`, `<synthetic>`) for three real model families plus an unattributed bucket — so the normalization gap is specific to tool naming and result volume rather than a general import-label problem. Timing within the instrumented lane is internally consistent (`bash` mean 39 ms, max 88 ms), so the missing pieces are identity and volume, not speed.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/population/tools`, `#/byModel`
- `severity`: P2
- `reproCommand`: `jq -c '{keys:(.byTool|length),shell:([.byTool[]|select(.toolName|ascii_downcase|test("^(bash|exec)$"))|.calls]|add),noBytes:([.byTool[]|select(.resultBytes==0)|.calls]|add),rows:[.byTool[]|{t:.toolName,c:.calls,b:.resultBytes,u:.durationUnmeasured}]}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: the claude, codex and pi importers' tool-record field mapping, surfaced through `spur history analyze`'s `byTool` fold.

### F7 — the artifact carries two different message populations

- `key`: `telemetry:spur-history-import:coverage-message-count-disagreement`
- `category`: `telemetry`
- `impact`: The same artifact states 1,004 claude messages in `#/coverage[0]/messages` and 874 in `#/bySource/claude/messages`, and `#/totals/messages` (1,044) is the second number plus codex and pi, not the first. Any per-message rate — messages per session, cost per message, messages per tool call — therefore has a 13.0% ambiguity on the claude side, and a reader cannot tell from the artifact which count is canonical. The same shape appears in the baseline artifact (879 vs 760, a 119-record gap), so no per-message metric in this series is currently well defined.
- `trend`: `not-comparable`
- `observation`: `#/coverage[0]` (claude) reports `files` 8, `messages` 1004, `toolCalls` 148; `#/bySource/claude/messages` is 874 and `#/bySource/claude/toolCalls` is 148, so the two folds agree on tool calls and disagree by 130 on messages. `#/totals/messages` is 1044 = 874 (claude) + 63 (codex) + 107 (pi), so the totals fold follows `bySource`. The sum of `#/coverage` messages is 1,174 against that 1,044. Both non-claude rows agree with their own totals in both folds (codex 63 = 63, pi 107 = 107). The baseline artifact repeats the shape: `#/coverage[0]/messages` 879 against `#/bySource/claude/messages` 760 (a 119-record gap), `#/totals/messages` 1,209, `#/coverage` summing to 1,328, with its pi row agreeing exactly (449 vs 449).
- `inference`: Because the disagreement is confined to one source in both artifacts while the other sources match to the record, the two folds are counting different record classes on the claude path — most plausibly, `#/coverage` counting every imported claude record while `bySource` counts only records inside the selector window. Named observations: the 130-message gap here, the 119-message gap in the baseline artifact, and the exact agreement of the codex and pi rows in both. This attribution is a hypothesis resting on one comparative signal, so its confirmation path is: run `spur history analyze` over a window whose bounds cover all claude records and check whether the two counts converge.
- `contradictions`: `#/coverage[0]/status` is `ok` with `parseErrors` 0, `validationErrors` 0 and `unknownRecords` 0, so neither fold reports a rejected record — the difference is not corruption. `#/bySource/claude/records` is 874, equal to its `messages`, so within the totals fold the record and message counts coincide; the ambiguity is strictly between folds. The report's other ratios use tokens and cost rather than message counts, so no other finding depends on which count is canonical.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/coverage/0`, `#/bySource/claude`, `#/totals/messages`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/coverage/0`, `#/bySource/claude`, `#/totals/messages`
- `severity`: P3
- `reproCommand`: `jq -c '{coverageSum:([.coverage[].messages]|add),perSource:[.coverage[]|{s:.source,m:.messages}],bySource:[.bySource|to_entries[]|{s:.key,m:.value.messages}],totals:.totals.messages,toolCallsAgree:(.coverage[0].toolCalls==.bySource.claude.toolCalls)}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the `coverage` fold's message accounting versus the `bySource`/`totals` accounting in `spur history analyze`.

### F8 — phase support claims support with zero phases

- `key`: `telemetry:spur-history-analyze:phase-support-empty`
- `category`: `telemetry`
- `impact`: The per-phase breakdown is the only view that would show where a run stalls between planning, implementation and verification. It renders an extraction-empty row under a flag asserting the dimension is available, so a reader is told the data exists and then shown none. That is worse than an explicit gap, because it can be mistaken for "no stalls occurred" — and this window contains a stall worth seeing (F1's single pi session holding 18.55% of the span).
- `trend`: `not-comparable`
- `observation`: `#/derived/phases` is `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}`. The rendered report's Per-Phase Breakdown table contains one row whose first cell states that a task-tracking signal is present while no phases were extracted, and whose three metric cells are empty (`.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:65`, under the heading at `:61`).
- `inference`: `phaseSupport: "supported"` describes the presence of a task-tracking signal rather than the extraction of phase transitions, and `invalidPhaseCount` 0 is consistent with no extraction having been attempted. Named observations: the `supported` flag, the empty `phases` array, and the renderer's own extraction-empty row.
- `contradictions`: The flag is not false in the narrow sense — a task-tracking signal does exist in the session corpus, and 12 write-family calls plus 108 shell calls are consistent with implementation-phase activity — so the label may be a naming defect in the fold rather than a wrong computation. The baseline artifact reports the identical `{supported, [], 0}` triple, so the label is stable across two windows rather than an intermittent glitch.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/derived/phases`, `#/byTool`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:65` (Per-Phase Breakdown extraction-empty row)
- `severity`: P3
- `reproCommand`: `jq -c '.derived.phases' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `derived.phases` fold and its `phaseSupport` label.

### F9 — the rendered report's title is duplicated and the whole file sits inside an unclosed code fence

- `key`: `workflow:spur-history-report:render-title-corrupted`
- `category`: `workflow`
- `impact`: Both rendered artifacts open with a broken header — a stray fence followed by a self-overlapping title — and the fence is never closed, so all 172 lines of the current render sit inside a code block. Any consumer that parses the markdown header, links the first line, renders the file, or diffs renders across days sees a corrupted and unstable document. Low blast radius, deterministic, and it degrades the artifact operators read directly.
- `trend`: `not-comparable`
- `observation`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:4` reads `# History forensics report — generated 2026-10-29T15:3# History forensics report — generated 2026-10-29T15:30:13.042Z`, preceded at line 3 by a bare opening fence; the file contains exactly one fence marker across its 172 lines, so that fence never closes. `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.md:4` is corrupted identically with its own timestamp `2026-10-29T15:30:13.612Z`, and holds one fence across 170 lines.
- `inference`: The shared prefix `…T15:3` before the full title indicates the header writer emits the timestamp plus a truncated title, then the complete title — a single renderer path, not per-artifact damage, since the same malformation appears in both renders with only the timestamp differing. Named observations: the identical malformation in two independently rendered files, and the truncated-prefix-then-full-title shape at line 4 of each.
- `contradictions`: The artifact JSON is unaffected — `#/generatedAt` is well formed in both — so the defect is confined to the markdown renderer and does not contaminate any computed value in this report. The fence defect and the title defect are two symptoms in one file; whether they share a cause is a hypothesis with one signal (their co-location), confirmation path: inspect the renderer's header and footer writers for the fence it emits around the body.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:4`, `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.md:4`
- `severity`: P3
- `reproCommand`: `sed -n '1,5p' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md; grep -c '^```' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md`
- `ownerSurface`: `spur history report` — the markdown header and fence writer used by `--mode forensics`.

### F10 — the window contains the session that generated the report

- `key`: `workflow:history-anatomy:window-includes-generating-session`
- `category`: `workflow`
- `impact`: The report measures a window that includes its own generating run, so a slice of the measured activity is the act of measuring: 23 messages began 11.19 s before generation, contribute most of the `24` records in the `<synthetic>` model bucket, and carry no tokens, no tool calls and no cost. The distortion is negligible in magnitude but it makes the current-day figures non-reproducible — a second run of the same day would measure a different amount of its own overhead — and it is the mechanism by which a self-referential report could in principle amplify its own signals.
- `trend`: `not-comparable`
- `observation`: `#/bySession` includes a claude session `70140928-962b-4041-a748-04da5f7618ba` with `startedAt` `2026-10-29T15:30:01.856Z`, `messages` 23, `toolCalls` 0, `tokens` 0, `costUsd` 0, `topTool` `null`, `assistantDurationMs` 307, `sessionState` `complete` — it began 11.19 s before current-artifact generation at `2026-10-29T15:30:13.042Z`. `#/byModel/<synthetic>` holds `24` records, `recordsWithUsage` 2, zero tokens, `costUsd` 0 and `assistantDurationMs` 578, which is one record and 271 ms more than that session reports.
- `inference`: A session that starts seconds before generation and carries no usage at all is the report pipeline observing itself rather than independent operator work. Named observations: the 11.19 s gap between `startedAt` and `generatedAt`, and the near-coincidence of that session's 23 messages with the `<synthetic>` bucket's 24 records (counts that differ by one, so the mapping is not exact). Which operation owns the session remains a hypothesis with one signal, and its confirmation path is to compare this session id against the run's provenance once the publisher records the generating session id — the provenance file does not record it today.
- `contradictions`: The self-observed slice is too small to move any aggregate — 23 of 1,044 messages, `$0` of `$2.958762`, 0 of 191 tool calls — so it does not threaten the validity of any other finding. Unlike the comparable session in the baseline artifact's window it carries no spend, which is why it lands in the `<synthetic>` bucket rather than a named model. The 23-versus-24 record mismatch means the bucket cannot be attributed to this session with certainty.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/bySession` (sessionId `70140928-962b-4041-a748-04da5f7618ba`), `#/byModel`, `#/generatedAt`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-provenance.json` — `generatedAt`
- `severity`: P3
- `reproCommand`: `jq -c '{gen:.generatedAt,self:[.bySession[]|select(.sessionId|startswith("70140928"))],synthetic:.byModel["<synthetic>"]}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: the history-anatomy daily workflow definition (the spur workflow that shells `spur history analyze`), which owns window selection at generation time.

### F11 — the codex lane is imported but only partly measured, and its duration total is not credible

- `key`: `telemetry:spur-history-import:codex-lane-partial-instrumentation`
- `category`: `telemetry`
- `impact`: The new third lane contributes `$0.413862` — 13.99% of window cost — on 3.70% of billed input, but 58 of its 63 records carry no usage, all 6 of its tool calls are untimed and record 0 result bytes, and its `assistantDurationMs` total of `19` ms across 7 steps (2.71 ms/step on 65k–73k-token steps) cannot be a real round-trip. Its 47.21% cache reuse — against 94.62% for claude and 94.81% for pi — means its `$0.680` per 1M billed input tokens is 4.14× claude's `$0.164` and 4.79× pi's `$0.142`. Any cost-per-token or latency conclusion that mixes this lane in is either mispriced or built on a synthesized duration.
- `trend`: `not-comparable`
- `observation`: `#/bySource/codex` reports `records` 63, `recordsWithUsage` 5, `messages` 63, `toolCalls` 6, `durationUnmeasured` 6, `assistantDurationMs` 19, `assistantDurationUnmeasured` 0, `costUsd` 0.413862, `inputTokens` 609,014, `cacheReadTokens` 287,488, `outputTokens` 3,759. `#/stepSupport/1` reports codex `assistantSteps` 7, `stepsWithUsage` 5, `stepsWithDuration` 7, `stepsWithDerivedDuration` 7, `stepsWithCacheRead` 5 — every duration is derived, none measured. `#/byTool` `exec` carries `calls` 6, `durationMsTotal` 0, `durationUnmeasured` 6, `resultBytes` 0. `#/topStepsByTokens` codex rows at `15:08:53.072Z`, `15:06:47.136Z` and `15:06:30.321Z` carry `inputTokens` 73,356 / 70,229 / 65,629 with `durationMs` 3 / 1 / 2. Its session `01a18832-2363-7231-8626-cd4c43e02752` is `complete` with `assistantDurationMs` 19.
- `inference`: Two independent signals say the lane's timing is instrumented-but-wrong rather than merely missing: every codex duration is flagged as derived (`stepsWithDerivedDuration` 7 of 7), and the derived values are two to three orders of magnitude below the per-step latencies measured on the other two lanes for prompts of the same size. Named observations: the all-derived duration flag, the 1–3 ms per-step values against 65k–73k-token prompts, and 58 of 63 records without usage.
- `contradictions`: The codex row is not empty — it records cost, tokens, cache reads and a closed session, and its `#/coverage/1` status is `ok` with 0 parse and 0 validation errors, so the lane is genuinely imported. Its cost is therefore the most trustworthy codex figure in the artifact and its duration the least. Its 47.21% cache reuse may be a property of a short single session rather than a defect, so the reuse figure is reported and not diagnosed here.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/bySource/codex`, `#/stepSupport/1`, `#/byTool`, `#/topStepsByTokens`, `#/coverage/1`
- `severity`: P2
- `reproCommand`: `jq -c '{codex:.bySource.codex,steps:[.stepSupport[]|select(.source=="codex")],tools:[.byTool[]|select(.toolName=="exec")],topCodex:[.topStepsByTokens[]|select(.source=="codex")|{ts,it:.inputTokens,ot:.outputTokens,ms:.durationMs}]}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the codex source lane's usage, tool-duration and duration-derivation records, consumed by the `byTool` and `stepSupport` folds.

### F12 — a reviewer dispatch escalated on resource exhaustion and no field accounts for it

- `key`: `reliability:agent-run-dispatch:reviewer-escalation-unaccounted`
- `category`: `reliability`
- `impact`: One of the 21 chained `agent.run` dispatches exhausted a resource and the pairing still reports `successRate` 1 with `failures` 0, so the only trace of it is an `escalations` map on a row whose cost and model are both `not available`. An operator reading this fold sees a clean reviewer lane, while a dispatch in it escalated — and neither the escalated dispatch's identity, its duration, nor its cost is recoverable from the artifact.
- `trend`: `not-comparable`
- `observation`: `#/pairings[0]` (`executor` `claude`, `role` `reviewer`) carries `dispatches` 9, `successRate` 1, `failures` 0, `unknownOutcomes` 0, `escalations` `{resource-exhaustion: 1}`, `totalCostUsd` `null`, `meanDurationMs` `263,820.45`. `#/pairings[1]` and `#/pairings[2]` carry `escalations` `{}`. The baseline artifact's three pairing rows carry `escalations` `{}` on all rows.
- `inference`: An `escalations` count of 1 with `failures` 0 means the escalation path is recorded separately from the failure path, so a dispatch can exhaust a resource and still settle as a success — which is a workflow fact, not necessarily a defect, but it makes "success rate" an incomplete reliability statement for the reviewer role. Named observations: the non-empty `escalations` map on a row with `failures` 0, and the empty maps on the other two rows. This is a single signal, so it is labelled a hypothesis: the confirmation path is to inspect the `claude` reviewer dispatch records for the escalated dispatch and its terminal reason, which the artifact does not carry.
- `contradictions`: `successRate` 1 and `failures` 0 are internally consistent with 9 dispatches and no failure, so the fold is not obviously wrong — resource exhaustion may have been retried and succeeded, which is the healthy outcome. `unknownOutcomes` is 0 on all rows, so nothing was lost. The escalation is therefore a signal of what to look at, not proof of a reliability regression.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/pairings`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/pairings`
- `severity`: P3
- `reproCommand`: `jq -c '{rows:[.pairings[]|{e:.executor,r:.role,d:.dispatches,s:.successRate,f:.failures,esc:.escalations}],dispatches:([.pairings[].dispatches]|add),failures:([.pairings[].failures]|add),unknown:([.pairings[].unknownOutcomes]|add)}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: the pairing analytics fold's escalation accounting in `spur history analyze`, together with the `agent.run` dispatch path that raises the escalation.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count or impact change is computed or implied. The final column records only whether the same signal class is discretely present in the baseline artifact (an observation about two artifacts, not a measured change) and what would have to happen for a future run to classify the finding.

| Stable key | Recurrence class | Severity now | Discrete baseline presence and what a comparable baseline would need |
| --- | --- | --- | --- |
| `performance:pi-dsv4-1-flash-executor:per-step-latency` | `not-comparable` | P1 | Same class present in both artifacts: the baseline `#/bySource/pi/assistantDurationMs` is `11,047,236` over 184 steps (`#/stepSupport/1`) against claude `907,756` over 257 steps (`#/stepSupport/0`), so the pi lane dominates assistant duration there too. Each figure is stated as its own artifact's value and is not subtracted. A comparable baseline needs a closed current window so a per-step mean could be read rather than merely observed. |
| `telemetry:spur-history-import:claude-tool-duration-unmeasured` | `not-comparable` | P1 | Same class present and wider here: the baseline `#/byTool` claude-lane rows (`Bash` 83, `Read` 35, `Skill` 5, `Write` 5, `Edit` 2, `ctx_execute` 4, `ctx_execute_file` 1, `ToolSearch` 2) sum to 137 unmeasured calls of 137, with `durationMsTotal` 0 on each, and all 5 baseline claude sessions are `in-progress`. Its `llmMs` `13,072,578` likewise exceeds its per-source assistant-duration sum `11,954,992` by `1,117,586` ms, and its `assistantDurationUnmeasured` 8 disagrees with the 27-step gap in `#/stepSupport` the same way. A comparable baseline needs a closed current window so a duration-coverage change could be read. |
| `telemetry:spur-history-analyze:pairing-cost-not-reconciled` | `not-comparable` | P2 | Same seam present, opposite direction: the baseline `#/pairings` costs 2 of 3 rows (`pi-dsv4.1-flash-volc` reviewer `$4.0212`, scribe `$2.377296`) and leaves `claude` reviewer `null` while still reporting `meanDurationMs` `399,631.57`; its costed rows sum to `6.398496` against its own `#/totals/costUsd` of `3.955347`. The current artifact costs 1 of 3 rows and sits below its total. A comparable baseline is needed before any statement about the direction or size of the gap could be made. |
| `telemetry:spur-history-import:duplicate-usage-records` | `not-comparable` | P2 | Not observed in the baseline's 20-row leaderboard: grouping its `#/topStepsByTokens` by usage tuple yields no pair. Bounded absence — steps outside either leaderboard were not examined — so this is neither `new` nor `resolved`; a comparable baseline with like leaderboard composition would be needed to classify it. |
| `coverage:spur-task-check:verified-outcome-absent` | `not-comparable` | P2 | Same class present: the baseline `#/verifiedOutcome` also reports `taskDenominator` 0 with every `excludedReasons` bucket 0 and `costCoverage` `{covered: 0, total: 0}`. Present in two artifacts, not a measured change. |
| `telemetry:spur-history-analyze:tool-identity-fragmentation` | `not-comparable` | P2 | Same class present, now across three lanes: the baseline `#/byTool` splits `bash` 155 / `Bash` 83, `read` 32 / `Read` 35, `edit` 12 / `Edit` 2, `write` 8 / `Write` 5 across `12` keys with `resultBytes` 0 on every lowercase key; the current artifact adds a third shell alias, codex's `exec`. Presence in two artifacts, not a counted change. |
| `telemetry:spur-history-import:coverage-message-count-disagreement` | `not-comparable` | P3 | Same class present with a different magnitude: the baseline `#/coverage/0/messages` is `879` against its `#/bySource/claude/messages` of `760` (a 119-record gap), `#/totals/messages` `1,209`, and `#/coverage` summing to `1,328`; its pi row agrees exactly (`449` vs `449`). This is the second artifact carrying the same shape, which is the recurrence basis section 9 uses. |
| `telemetry:spur-history-analyze:phase-support-empty` | `not-comparable` | P3 | Same class present: the baseline `#/derived/phases` is also `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}`, and its render carries the same extraction-empty row at `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.md:64`. |
| `workflow:spur-history-report:render-title-corrupted` | `not-comparable` | P3 | Same class present: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.md:4` is corrupted identically, so the defect is deterministic across both renders of this run. Carries a `file:line` anchor, which satisfies the evidence rule for a process improvement without a second closed window. |
| `workflow:history-anatomy:window-includes-generating-session` | `not-comparable` | P3 | Present in the baseline artifact in kind but not in the same window: the baseline `#/bySession` holds a session started `2026-10-28T15:30:16.148Z`, seconds after that run's own generation instant, so it does not sit inside the day the baseline window measures. The current window is the one that contains its own generating run. A comparable baseline would require two provisional windows generated the same way. |
| `telemetry:spur-history-import:codex-lane-partial-instrumentation` | `not-comparable` | P2 | Absent by construction: the baseline artifact has no `codex` source row at all (`#/coverage` lists `claude` and `pi` only), so there is no counterpart to classify against. This is neither `new` nor `resolved` under the contract — the class cannot exist in a window with no codex lane. A comparable baseline would have to cover the same three lanes. |
| `reliability:agent-run-dispatch:reviewer-escalation-unaccounted` | `not-comparable` | P3 | Not present in the baseline: its three `#/pairings` rows carry `escalations` `{}` on all rows. Bounded absence over 18 baseline dispatches; a comparable baseline with like lane coverage would be needed to call this `new` rather than unclassifiable. |
| `positive:spur-history-import:pi-complete-measurement-axis` | `not-comparable` | P3 | Same class present on the step and tool axes: the baseline `#/stepSupport/1` reports pi `assistantSteps` 184 with `stepsWithUsage`, `stepsWithDuration`, `stepsWithDerivedDuration` and `stepsWithCacheRead` all 184, and every baseline pi-lane `#/byTool` row reports `durationUnmeasured` 0. The session-terminal axis holds there too (8 of 8 baseline pi sessions `complete`). |
| `positive:spur-history-analyze:cache-reuse-healthy` | `not-comparable` | P3 | Same class present at a higher aggregate level: the baseline `#/totals` serves `30,851,124` of `32,016,609` billed input tokens from cache (96.36%), and its `#/cacheWaste` is likewise 0 steps and 0 input tokens. Each figure is its own artifact's value and is not subtracted; a comparable baseline is needed before any change in reuse could be read. |
| `positive:spur-history-import:clean-import-and-tool-runs` | `not-comparable` | P3 | Same class present: both baseline `#/coverage` rows report `parseErrors` 0, `validationErrors` 0 and `unknownRecords` 0, and the baseline `#/byTool[].errors` sum to 0 over 344 calls. Presence in two artifacts, not a counted change. |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `not-comparable` | P3 | Same class present on a smaller population: the baseline `#/pairings` covers 18 dispatches with 1 failure and `unknownOutcomes` 0 on all three rows, against 21 dispatches with 1 failure and 0 unknown here. Each figure is its own artifact's value and is not subtracted. |
| `positive:spur-history-import:import-freshness-at-generation` | `not-comparable` | P3 | Same class present in kind, materially different in magnitude: the baseline imports were recorded `2026-10-28T17:19:16.375Z` and `2026-10-28T17:19:15.382Z` — 22.2 h before that artifact was generated — while the current imports precede generation by 2.27–5.12 s. That difference is stated in section 3 as a comparability blocker, not as a measured improvement. |

Two independent artifacts in this run carry the tool-fragmentation, message-population, phase-support, `llmMs`-residual and render defects, which satisfies the evidence rule for the corresponding process improvements in section 9; the render defect additionally carries a `file:line` anchor. No finding is downgraded or dropped because its baseline counterpart is absent or differently shaped.

## Telemetry gaps

Dimensions the artifact cannot support. Each renders `not available`; none is inferred from a raw history file.

| Dimension | Rendering | Why | Anchor |
| --- | --- | --- | --- |
| Claude and codex per-call tool duration | `not available` | 154 of 191 tool calls unmeasured, `durationMsTotal` 0 on every claude-lane and codex-lane row | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byTool`, `#/totals` |
| Claude session end state | `not available` | 6 of 8 claude sessions report `sessionState` `in-progress`; no terminal record | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/bySession` |
| Duration for 19 claude assistant steps | `not available` | `#/stepSupport/0` `stepsWithDuration` 258 of 277; the render excludes them from the duration leaderboard | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/stepSupport/0` |
| Codex assistant duration | `not available` | All 7 codex steps are `stepsWithDerivedDuration`; the derived values sum to 19 ms for 65k–73k-token prompts and cannot represent real latency | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/stepSupport/1`, `#/topStepsByTokens` |
| Token usage on 852 of 1,044 records | `not available` | `#/totals/recordsWithUsage` 192 of 1,044; claude 147 of 874, codex 5 of 63, pi 40 of 107 | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/bySource`, `#/totals` |
| Result volume for the pi and codex lanes | `not available` | `resultBytes` 0 on all three pi keys (37 calls) and on codex `exec` (6 calls) | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byTool` |
| Tool command identity | `not available` | `byTool` carries no command or argument field; loop rows expose only an `argsDigest`, and this window has no loop rows at all | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Per-phase breakdown | `not available` | `phaseSupport` `supported` but `phases` is empty | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/derived/phases` |
| Verified-rate, correction-rate, time-to-verified, tokens per verified result | `not available` | `taskDenominator` 0; every rate field `null` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/verifiedOutcome` |
| Per-pairing cost for 2 of 3 pairings | `not available` | `totalCostUsd` `null` on the `claude` reviewer and `pi-dsv4.1-flash-volc` reviewer rows while both report `meanDurationMs` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/pairings` |
| Pairing model identity | `not available` | `model` is `null` on every `#/pairings` row, so no pairing cost or duration is attributable to a model | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/pairings` |
| Usage attribution for the `<synthetic>` bucket | `not available` | 24 records with `recordsWithUsage` 2, zero tokens and 578 ms duration | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byModel` |
| Escalated-dispatch identity, duration and cost | `not available` | `escalations` is a bare count map; no field names the dispatch or its terminal reason | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/pairings` |
| Workflow digest and provenance model | `not available` | Provenance records `workflowDigest` and `model` as `not available`, and `spurVersion` as `not available` while the artifact reports `0.4.20` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-provenance.json` — `workflowDigest`, `model`, `spurVersion` |
| Canonical message population | `not available` | `#/coverage` and `#/totals` disagree on the claude count (1,004 vs 874) and the artifact names no canonical field | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/coverage/0`, `#/totals/messages` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` (section 3) | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/coverage`, `#/totals` |
| Loop and repetition signatures below the fold's threshold | `not available` | `#/loops` is empty and the fold reports only signatures repeating at least 3 times; per-call arguments are not exposed | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/loops`, `#/population/loops` |

Attribution note for the 10.30% unattributed bucket: the artifact's own warning `derived-unattributed-time` states that `449317ms` could not be attributed to llm/tool/idle because some durations were unmeasured, and points at the step-support matrix (`#/warnings/0`). That is a gap, not workload; combined with F2 it is the arithmetic shadow of the untimed claude and codex lanes rather than idle agent time.

## Remediation options

Proposals only. Nothing below has been applied, no diff is produced, and no command here was run by this report.

**R1 — bring the pi lane's per-step latency under a stated budget** (addresses `performance:pi-dsv4-1-flash-executor:per-step-latency`)

- Owner surface: the `pi-dsv4.1-flash-volc` executor pairing — model selection, reasoning effort and dispatch concurrency in the executor routing configuration.
- Expected impact: the 45,454.5 ms per-step mean and its 67.17% share of assistant duration become a chosen operating point; a reduction of a fraction of that mean moves the largest single term in the window's 1.21 h span, which today is dominated by one session holding 18.55% of it.
- Verification method: a subsequent artifact reports `#/bySource/pi/assistantDurationMs` divided by `#/stepSupport/2/assistantSteps` at or below the budget the operator sets, with `#/derived/bottlenecks` `llm` share falling below its present `0.89052`.
- Reversibility: reversible — a routing or effort setting; no history is rewritten and the previous configuration can be restored.
- Handoff: `spur task create "performance:pi-dsv4-1-flash-executor:per-step-latency — budget pi per-step latency" --template issue`

**R2 — emit per-call tool timing and session terminal records for the claude and codex lanes** (addresses `telemetry:spur-history-import:claude-tool-duration-unmeasured`)

- Owner surface: `spur history import` — the claude and codex source lanes' per-call and session-end records, consumed by the `byTool`, `stepSupport` and `timeDecomposition` folds.
- Expected impact: `toolMs` becomes a window total covering 191 calls instead of pi's 37, the 449,317 ms unattributed bucket shrinks, the 1,177,657 ms `llmMs`-versus-sources residual becomes reconcilable instead of absorbed, and the `assistantDurationUnmeasured` field stops disagreeing with `stepSupport`.
- Verification method: `#/byTool` claude-lane and codex-lane rows show `durationUnmeasured` below `calls` with a non-zero `durationMsTotal`, `#/stepSupport/0` `stepsWithDuration` equals `assistantSteps`, `#/bySource/claude/assistantDurationUnmeasured` equals the gap implied by `#/stepSupport/0`, and `#/derived/timeDecomposition/llmMs` equals the sum of `#/bySource/*/assistantDurationMs`.
- Reversibility: reversible — importer-only; a re-import rebuilds the affected rows and the previous behaviour returns by reverting the mapping.
- Handoff: `spur task create "telemetry:spur-history-import:claude-tool-duration-unmeasured — emit tool timing and session terminal records" --template issue`

**R3 — state the pairing fold's coverage and reconciliation direction** (addresses `telemetry:spur-history-analyze:pairing-cost-not-reconciled`)

- Owner surface: the pairing analytics fold's cost and model joins in `spur history analyze`.
- Expected impact: pairing cost becomes a subset of window cost an operator can divide by, with the uncovered dispatch count stated, so the share-of-window figure is either computable or explicitly `not available` rather than varying in direction between artifacts.
- Verification method: for a fresh artifact, every non-null `#/pairings[].totalCostUsd` sums to at most `#/totals/costUsd`, each pairing row names the dispatch set its cost covers, and a pairing row carries either a `model` or an explicit `not available` marker for it.
- Reversibility: reversible — a join predicate and a provenance field; no history is mutated.
- Handoff: `spur task create "telemetry:spur-history-analyze:pairing-cost-not-reconciled — state pairing fold coverage and reconciliation" --template issue`

**R4 — de-duplicate usage-identical records at import** (addresses `telemetry:spur-history-import:duplicate-usage-records`)

- Owner surface: `spur history import` — the claude source lane's record de-duplication key, feeding the totals and `topStepsByTokens` folds.
- Expected impact: establishes whether `$0.123252` of the window's `$2.958762` is double-counted, and either removes the duplication or proves the twelve rows are distinct billed calls; either outcome makes window cost and claude token totals trustworthy and the token leaderboard readable as 20 distinct steps.
- Verification method: grouping a fresh artifact's `#/topStepsByTokens` by usage tuple yields no pair, or the artifact carries an explicit repeat marker on rows that legitimately repeat with a stated reason.
- Reversibility: reversible — a de-duplication key; disabling it restores today's rows on re-import, and the raw session files are untouched.
- Handoff: `spur task create "telemetry:spur-history-import:duplicate-usage-records — de-duplicate usage-identical records" --template issue`

**R5 — populate the outcome fold's task denominator** (addresses `coverage:spur-task-check:verified-outcome-absent`)

- Owner surface: `spur task check` (the proof-producing gate) together with the `verifiedOutcome` fold's task-window join.
- Expected impact: `verifiedRate`, `timeToVerified` and `costCoverage` become computable, so cost-per-verified-result — the metric that would rank the other findings by value — stops rendering `not available` for the whole day.
- Verification method: a subsequent artifact reports a non-zero `#/verifiedOutcome/taskDenominator`, and a non-zero `verifiedResults` or a named non-zero `excludedReasons` bucket identifying why an in-scope task was excluded.
- Reversibility: reversible — a scope/join change in the fold; no verdict data is deleted.
- Handoff: `spur task create "coverage:spur-task-check:verified-outcome-absent — populate the outcome fold task denominator" --template issue`

**R6 — normalize tool names across three lanes and carry result size on the pi and codex lanes** (addresses `telemetry:spur-history-analyze:tool-identity-fragmentation`)

- Owner surface: the claude, codex and pi importer field mappings, surfaced through the `byTool` fold.
- Expected impact: one key per tool instead of 11 keys for at most 7 tools, a correct `#/population/tools` count, shell activity reported as 108 calls rather than split 29 / 73 / 6, and context volume measurable for 43 calls that currently record 0 bytes.
- Verification method: a fresh artifact's `#/byTool` shows one key per tool with no lowercase/capitalized/`exec` alias triple, and `resultBytes` is non-zero for shell, read and write calls whose output was captured.
- Reversibility: reversible — a normalization map plus an added field; older artifacts keep rendering their original keys, so nothing historical is invalidated.
- Handoff: `spur task create "telemetry:spur-history-analyze:tool-identity-fragmentation — normalize tool names and record result size" --template issue`

**R7 — name one canonical message population** (addresses `telemetry:spur-history-import:coverage-message-count-disagreement`)

- Owner surface: the `coverage` fold's message accounting versus the `bySource`/`totals` accounting in `spur history import` and `spur history analyze`.
- Expected impact: the 130-record ambiguity on the claude side disappears, so per-message rates have a single denominator and a reader does not have to choose between two fields in the same artifact.
- Verification method: for a fresh artifact, the sum of `#/coverage[].messages` equals `#/totals/messages`, or `#/coverage` labels its count as window-scoped or corpus-scoped and names the in-window figure.
- Reversibility: reversible — a fold definition and a label; no imported record is deleted.
- Handoff: `spur task create "telemetry:spur-history-import:coverage-message-count-disagreement — name one canonical message population" --template issue`

**R8 — report an empty phase list as unsupported** (addresses `telemetry:spur-history-analyze:phase-support-empty`)

- Owner surface: `spur history analyze` — the `derived.phases` fold and its `phaseSupport` label.
- Expected impact: the per-phase view either shows extracted phases or declares the gap, and the renderer stops emitting a row that reads like extracted content.
- Verification method: `jq -c '.derived.phases'` on a fresh artifact returns a non-empty `phases` array when transitions exist, or `phaseSupport` names the absence rather than `supported` whenever `phases` is empty.
- Reversibility: reversible — a label and a render branch.
- Handoff: `spur task create "telemetry:spur-history-analyze:phase-support-empty — report an empty phase list as unsupported" --template issue`

**R9 — emit the render title once and close the body fence** (addresses `workflow:spur-history-report:render-title-corrupted`)

- Owner surface: `spur history report` — the markdown header and fence writer for `--mode forensics`.
- Expected impact: the rendered artifact's first readable line stops contradicting itself, the fence count becomes balanced, and header parsing, markdown rendering and cross-day render diffs become safe.
- Verification method: `sed -n '1,5p'` on a fresh render shows the title exactly once with no truncated prefix, and the file's count of `^``` marker lines is even.
- Reversibility: reversible — a renderer-only change; no artifact is rewritten.
- Handoff: `spur task create "workflow:spur-history-report:render-title-corrupted — emit the render title once and close the body fence" --template issue`

**R10 — make the report exclude its own generating session** (addresses `workflow:history-anatomy:window-includes-generating-session`)

- Owner surface: the history-anatomy daily workflow definition that selects the analysis window.
- Expected impact: current-day figures stop including the measurement act, so a re-run of the same day measures the same operator work and the window becomes reproducible; the self-observed 23 messages and their `<synthetic>`-bucket records move to an explicitly labelled overhead line.
- Verification method: a subsequent artifact's `#/bySession` contains no session whose `startedAt` falls between the analysis start and `#/generatedAt`, or such a session appears with an explicit self-observation marker and its records excluded from `#/byModel`.
- Reversibility: reversible — a window/exclusion parameter; the excluded session remains in the corpus and is recovered by reverting it.
- Handoff: `spur task create "workflow:history-anatomy:window-includes-generating-session — exclude the generating session from the window" --template issue`

**R11 — instrument the codex lane or mark its duration unusable** (addresses `telemetry:spur-history-import:codex-lane-partial-instrumentation`)

- Owner surface: `spur history import` — the codex source lane's usage, tool-duration and duration-derivation records, consumed by `byTool` and `stepSupport`.
- Expected impact: codex cost and latency become usable in the same statements as the other two lanes; today its 13.99% cost share is trustworthy while its duration total (19 ms over 7 steps) is not, and its 47.21% cache reuse makes it 4.14× claude's cost per 1M billed input.
- Verification method: a fresh artifact reports codex `#/stepSupport` `stepsWithDerivedDuration` below `assistantSteps`, per-step durations in a plausible range for 65k-token prompts, `#/bySource/codex/recordsWithUsage` above 5 of 63, and `#/byTool/exec` with a non-zero `durationMsTotal` — or the codex lane is explicitly rendered `not available` on the timing axis.
- Reversibility: reversible — an importer field mapping; no history is rewritten.
- Handoff: `spur task create "telemetry:spur-history-import:codex-lane-partial-instrumentation — instrument the codex lane or mark its duration unusable" --template issue`

**R12 — account for escalations separately from failures in the pairing fold** (addresses `reliability:agent-run-dispatch:reviewer-escalation-unaccounted`)

- Owner surface: the pairing analytics fold's escalation accounting in `spur history analyze`, together with the `agent.run` dispatch path that raises the escalation.
- Expected impact: an escalated dispatch becomes inspectable — its identity, terminal reason and cost visible next to its pairing — so a `successRate` of 1 with an escalation is read as "recovered" rather than as a clean lane.
- Verification method: a fresh artifact's `#/pairings` names the escalated dispatch (or a count plus reason) and that dispatch also appears in a per-dispatch record with a terminal state; `successRate` and `failures` remain consistent with it.
- Reversibility: reversible — an added accounting field; no dispatch record is deleted.
- Handoff: `spur task create "reliability:agent-run-dispatch:reviewer-escalation-unaccounted — account for escalations separately from failures" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 4,362,171 ms = 1.21 h):

| Component | Time | Share of span |
| --- | ---: | ---: |
| LLM latency (assistant duration, summed) | 1.08 h (3,884,609 ms) | 89.05% |
| Unattributed (unmeasured durations) | 7.49 min (449,317 ms) | 10.30% |
| Idle / overhead | 27.10 s (27,102 ms) | 0.62% |
| Tool execution | 1.14 s (1,143 ms) | 0.026% |

Reading: this window is almost entirely LLM wait. The four buckets sum exactly to `spanMs`, so the fold balances internally, but `llmMs` `3,884,609` exceeds the sum of the per-source `assistantDurationMs` rows (`888,752` + `19` + `1,818,181` = `2,706,952`) by `1,177,657` ms, so the llm bucket is not reconcilable to its source rows (F2). Tool time is 0.026% of span and covers only pi's 37 calls, so the tool axis is both tiny and partial — 154 of 191 calls contribute nothing to it. The 10.30% unattributed share is an instrumentation residual, explicitly not workload (`#/warnings/0`).

**Per-step latency by source** (`#/bySource`, `#/stepSupport`) — the axis that explains the decomposition:

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per timed step | Share of assistant duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| pi | 40 | 40 (all measured) | 1,818,181 ms | 45,454.5 ms | 67.17% |
| claude | 277 | 258 (19 missing) | 888,752 ms | 3,444.8 ms (3,208.5 over 277) | 32.83% |
| codex | 7 | 7 (all derived) | 19 ms | 2.71 ms | 0.0007% |

The pi lane is 13.2× slower per step than claude on measured denominators, which is the mechanical reason LLM wait dominates. It does so on 40 of 324 steps (12.3%), so the window's latency is produced by a small number of very slow steps rather than by uniform slowness. The claude mean is a lower bound: it is divided over 258 steps while 19 more carry no duration at all (F2). The codex column is present for completeness and should not be read as latency — every one of its 7 durations is derived and totals 19 ms for 65k–73k-token prompts (F11). Within the pi lane the distribution is concentrated: the single session `2026-10-29T11-39-55-583Z_01a18775-a13f-7083-8959-2fb29f776ed1` contributes `809,013` ms — 44.5% of the lane's assistant duration, 18.55% of the whole span — and the lane's four sessions are `809,013` / `580,192` / `361,881` / `67,095` ms.

**Tool execution** (`#/byTool`; instrumented total 1,143 ms, all of it pi):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| bash | 29 | 1,122 ms | 39 ms | 88 ms | 0 |
| read | 4 | 16 ms | 4 ms | 7 ms | 0 |
| write | 4 | 5 ms | 1 ms | 2 ms | 0 |
| Bash | 73 | `not available` | `not available` | `not available` | 73 |
| Read | 51 | `not available` | `not available` | `not available` | 51 |
| Write | 8 | `not available` | `not available` | `not available` | 8 |
| Skill | 7 | `not available` | `not available` | `not available` | 7 |
| exec | 6 | `not available` | `not available` | `not available` | 6 |
| ctx_execute | 5 | `not available` | `not available` | `not available` | 5 |
| ctx_execute_file | 2 | `not available` | `not available` | `not available` | 2 |
| ToolSearch | 2 | `not available` | `not available` | `not available` | 2 |

One lane is instrumented and two are not: 39 ms mean over 29 pi `bash` calls, against 73 `Bash` and 6 `exec` calls with no timing at all. The slowest measured call is 88 ms — 517× below the 45,454.5 ms per-step LLM mean, consistent with the 0.026% tool share. Tool name aliasing and the missing `resultBytes` on the pi and codex rows are F6.

**Cost and tokens by source** (`#/bySource`, `#/totals`, total `$2.958762`):

| Source | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cost / 1k output | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| claude | 874 | 13,230,959 | 12,518,897 | 711,772 | 144,689 | `$2.171205` | 73.38% | $0.015011 | 94.62% |
| codex | 63 | 609,014 | 287,488 | 0 | 3,759 | `$0.413862` | 13.99% | $0.110099 | 47.21% |
| pi | 107 | 2,631,855 | 2,495,360 | 0 | 47,440 | `$0.373695` | 12.63% | $0.007877 | 94.81% |

Window totals: billed input 16,471,828 (fresh 458,311 · cache-read 15,301,745 · cache-write 711,772), output 195,888, overall cache-hit ratio 92.90% of billed input, provider usage present on 192 of 1,044 records. All three cost cells are measured, so no cell reads `not available`. Claude carries 73.38% of cost on 73.86% of output tokens at $0.015011 per 1k output; pi is the cheapest per output token at $0.007877; codex is the most expensive at $0.110099 per 1k output because it emits few output tokens (3,759) against 609,014 billed input at only 47.21% cache reuse — $0.680 per 1M billed input against claude's $0.164 and pi's $0.142. Read together: this window is claude-weighted on spend, pi-weighted on latency, and codex-heavy on unit price, three different conclusions from three different axes, all needed before a routing change.

**Chained `agent.run` run cost** (per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Dispatches | Success rate | Failures | Escalations | Total cost | Mean duration |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: |
| `claude` | reviewer | 9 | 1.00 | 0 | `resource-exhaustion` 1 | `not available` | 263,820.45 ms (4.40 min) |
| `pi-dsv4.1-flash-volc` | reviewer | 6 | 0.83 | 1 | — | `not available` | 1,362,947.88 ms (22.72 min) |
| `pi-dsv4.1-flash-volc` | scribe | 6 | 1.00 | 0 | — | `$1.49478` | 679,628.09 ms (11.33 min) |

The three pairings cover 21 dispatches with 1 failure, 1 escalation and 0 unknown outcomes. Cost is reportable for 1 of 3 pairings; the other two render `not available` rather than zero, per the run-cost rule, so the share-of-window figure is only 50.52% and is not a full attribution (F3). The pi reviewer mean is 5.2× the claude reviewer mean (22.72 min against 4.40 min), the same lane as the F1 latency concentration; the pi scribe sits between them at 11.33 min. The window's only dispatch failure sits in the pi `reviewer` pairing, where 1 failure over 6 dispatches is a 16.7% failure rate. The one escalation sits on the claude reviewer, which reports a perfect success rate — the two reliability signals are on different rows (F12).

**Cache re-send waste** (`#/cacheWaste`): 0 steps, 0 input tokens, empty `topSteps`. The filter targets assistant steps with input above 100,000 tokens and cache reuse below 10%; no step met it. This is a genuine zero for that filter, corroborated by the 92.90% overall cache-hit ratio, not a masked gap — but the same filter does not cover the duplicate-usage pattern in F4, which is a different shape of repeated cost.

**Per-step token concentration** (`#/topStepsByTokens`, top 20 of 324): every claude row carries `inputTokens` 2 and between 91,357 and 129,784 cache-read tokens — long cached contexts with almost no fresh input, which is the healthy cache behaviour the 92.90% ratio reflects. The three codex rows carry the opposite shape: 65,629 to 73,356 fresh input tokens with only 60,672 to 70,016 cache-read — a much higher fresh-input share, consistent with F11's 47.21% reuse. Twelve of those 20 rows are the six duplicate claude tuples in F4, so the leaderboard's composition should be read with that caveat.

**Bottleneck order** (`#/derived/bottlenecks`): llm 89.05% → unattributed 10.30% → idle 0.62% → tool 0.026%.

## Workflow and process improvements

Numbered prose proposals; each is report-only and requires operator acceptance before any surface changes.

1. **Separate "imported" from "measurable" in the per-source status row.** All three sources report `ok` with zero parse and zero validation errors while two lanes contribute no tool timing and `codex` reports 5 of 63 records with usage (F2, F11). A status field that cannot be non-`ok` for a partially unmeasurable source carries no information. Owner surface: the per-source coverage contract in `spur history import` and `spur history analyze`. Recurrence basis: the same all-clear-status shape appears in both artifacts of this run (claude fully untimed in each).
2. **Declare a window `provisional` inside the report body, not only in provenance.** The current window is provisional by construction — generation happened 8.5 h into the day it measures — yet neither render carries the window state, so a reader of the report alone cannot tell a partial day from a closed one, and this report's own comparability verdict had to rediscover the difference by hand. Owner surface: `spur history report`, the provenance header. Recurrence basis: neither render carries the window state; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:1` and `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.md:1` hold only a generation timestamp and a selector hash.
3. **Record the baseline snapshot's import time in the provenance block.** The baseline artifact pairs a `2026-10-28` window with imports recorded `2026-10-28T17:19:16.375Z` — 22.2 h before its own generation — so it silently measures a partially imported day. Nothing in the report exposes that condition, and a comparability verdict has to reconstruct it from `#/coverage`. Owner surface: the history-anatomy workflow's baseline selection and the provenance block. Recurrence basis: two artifacts of this run with materially different import-to-generation gaps (22.2 h vs 2.27–5.12 s), cited at `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` `#/coverage` and `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` `#/coverage`.
4. **Treat an unreconcilable aggregate as a gap, not as a number.** Two folds in this artifact fail to tie to their own components: `llmMs` exceeds the sum of per-source assistant durations by 1,177,657 ms (F2), and pairing cost covers 1 of 3 pairings while relating to the window total in the opposite direction from the baseline artifact (F3). Both are presented as values with no reconciliation flag, which is the shape the contract forbids for unsupported dimensions — an unsupported figure must read `not available` rather than carry an unattributable value. Owner surface: `spur history analyze` fold contracts and `spur history report --mode forensics`. Recurrence basis: two independent fold families in the same artifact, plus the contract anchor at `/Users/robin/.agents/skills/sp-history-anatomy/references/report-contract.md` (Evidence rules, item 3).
5. **Give the tool axis an identity dimension before adding any further tool metrics.** The 11 reported keys describe at most 7 tools and the busiest tool is split across three keys (F6); any per-command cost or per-command context analytics needs the label first. Owner surface: `spur history analyze`, the `byTool` fold. Recurrence basis: the baseline `#/byTool` carries the same lowercase/capitalized split across 12 keys with `resultBytes` 0 on every lowercase key.
6. **Name one canonical message population before any per-message rate is reported.** Two folds in each artifact disagree on the claude message count (1,004 vs 874 here, 879 vs 760 in the baseline) while agreeing on tool calls and on the other lanes' counts (F7). Owner surface: the `coverage` and `bySource` folds. Recurrence basis: the same shape, confined to the same source, appears in both artifacts of this run.
7. **Widen the pairing fold rather than replace it.** Pairings are the only place a stage is named next to its duration, and they carry duration for 21 of 21 dispatches even where cost, model and escalation detail are missing (F3, F12). Populating `totalCostUsd` and `model` for every pairing, and naming each escalation's dispatch, would answer two questions this window cannot. Owner surface: the pairing analytics fold. Recurrence basis: the baseline artifact carries the same fold with the same mix of costed and uncosted rows and the same null `model` column.
8. **Keep the outcome fold in scope of every report, even when empty.** The denominator is 0 in both artifacts, so the one axis that would rank the others by value is absent for a second consecutive window (F5). A fold that renders all-zero without a reason field cannot distinguish "no tasks" from "tasks not joined". Owner surface: `spur task check` plus the `verifiedOutcome` join. Recurrence basis: two artifacts of this run report the identical all-zero shape.
9. **Require an escalation reason on the pairing row before reporting a success rate.** The claude reviewer reports `successRate` 1 with `escalations` `{resource-exhaustion: 1}` and no dispatch identity (F12), so a reader cannot tell a recovered retry from an accounting gap. Owner surface: the pairing fold's escalation accounting. Recurrence basis: not observable in the baseline, whose rows carry `escalations` `{}` — recorded as a single-window observation with an evidentiary anchor rather than a repeated class.
10. **Exclude the analysis's own session from the window.** Generation began 11.19 s after a session that then contributed the artifact's entire `<synthetic>` model bucket with zero usage (F10). Small in magnitude, but it makes same-day re-runs non-reproducible and it puts 23 unattributable records into a report about attribution. Owner surface: the daily workflow's window selection. Recurrence basis: not observable in the baseline window, whose self-started session falls outside the day it measures; recorded here as a single-window observation with an evidentiary anchor.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | Separation | Note |
| --- | --- | ---: | --- | --- |
| `#/loops` — no signature met the ≥3-repeat threshold | all 13 sessions | 0 | — | The artifact reports `#/population/loops` 0 and an empty `#/loops` array, so no tool-and-argument signature repeated three times or more anywhere in this window. The fold exposes nothing below that threshold, so single-command repetition such as a re-run of the same test is not observable here. |
| identical usage tuple across two steps, × 6 pairs (see F4) | claude · `8bdf1fd7` (4 pairs), `f8d079e7` (1), `6561c07e` (1) | 2 each | 0.29–1.06 s for five pairs; 17.25 s for one | Each pair repeats an identical `(inputTokens, cacheReadTokens, outputTokens, costUsd)` tuple within seconds, which is a repetition shape the loop fold does not classify because its unit is a tool call, not a usage record. Recorded here with counts only; F4 carries the diagnosis and the cost. Because the pattern is equally consistent with a legitimate retry and with a duplicate write, the decision — treat as expected retry traffic, bound the retry, or de-duplicate at import — stays with the operator. |

The artifact exposes repetition only through the loop fold, which reports signatures repeating at least 3 times (`#/population/loops` = 0 here, 1 in the baseline). Repeat counts below that threshold are `not available` from this evidence plane, and the 191 tool calls are not individually inspectable for repetition. No signature here is proposed as a trigger for any automated behaviour.

## Positive patterns

Held to the same evidence standard as the problems above: observation, inference, and at least one anchor each.

### P1 — the pi lane is fully instrumented on every axis

- `key`: `positive:spur-history-import:pi-complete-measurement-axis`
- `category`: `positive`
- `impact`: Every quantitative claim about latency, tokens, cache behaviour and tool time in this window can be made against at least one lane with a complete denominator. That is what makes F1's 13.2× per-step comparison defensible rather than a guess, and it is the pattern the claude and codex lanes should be brought up to (F2, F11).
- `trend`: `not-comparable`
- `observation`: `#/stepSupport/2` reports pi `assistantSteps` 40, `stepsWithUsage` 40, `stepsWithDuration` 40, `stepsWithDerivedDuration` 40, `stepsWithCacheRead` 40 — every step carries usage, a measured duration and a cache-read figure, with no derived-duration substitution and no gaps. All 4 pi sessions in `#/bySession` carry `sessionState` `complete`. All 3 pi-lane `#/byTool` rows (`bash`, `read`, `write`) report `durationUnmeasured` 0 with measured totals of 1,122 / 16 / 5 ms.
- `inference`: A source whose step count, usage count, duration count and cache-read count are all identical is emitting a complete measurement record per step, so pi's aggregates are measurable rather than inferred. Named observations: the five equal counts in `#/stepSupport/2`, the 4-of-4 `complete` session states, and the 0 unmeasured calls across the pi tool rows.
- `contradictions`: pi's completeness is not matched by richness — `resultBytes` is 0 on all three of its tool rows and `model` is `null` on its pairing rows, so complete coverage of the timing axis coexists with missing context-volume and pairing identity (F6, F3). Its usage coverage is also counted on a different denominator from claude's: 40 of 107 `records` but 40 of 40 assistant steps.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/stepSupport/2`, `#/bySession` (source `pi`), `#/byTool`
- `severity`: P3
- `reproCommand`: `jq -c '.stepSupport[2], [.byTool[]|select(.toolName|IN("bash","read","write"))|{t:.toolName,u:.durationUnmeasured,ms:.durationMsTotal}], [.bySession[]|select(.source=="pi")|.sessionState]' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pi source lane, as the reference implementation the claude and codex lanes should match.

### P2 — cache reuse is high and no step met the re-send waste filter

- `key`: `positive:spur-history-analyze:cache-reuse-healthy`
- `category`: `positive`
- `impact`: 92.90% of the window's 16,471,828 billed input tokens were served from cache, so the dominant input-cost term is already near its floor for these context sizes. This is the reason the window's spend is only `$2.958762` despite 16.47M billed input tokens, and it means cache work is not a priority relative to the latency finding.
- `trend`: `not-comparable`
- `observation`: `#/totals/cacheReadTokens` `15,301,745` against `#/totals/inputTokens` `16,471,828` — 92.90%, with fresh input of `458,311` and cache-write of `711,772`. By source: claude `12,518,897` of `13,230,959` (94.62%), pi `2,495,360` of `2,631,855` (94.81%), codex `287,488` of `609,014` (47.21%). `#/cacheWaste` reports `steps` 0, `inputTokens` 0, `topSteps` `[]` — no assistant step had input above 100,000 tokens with cache reuse below 10%.
- `inference`: Both the aggregate ratio and the waste filter agree that context re-sends wasted nothing measurable this window: a high cache-read share and an empty waste list are two independent signals pointing the same way, and the two long-session lanes show the behaviour holds rather than being a single-lane artifact. Named observations: the per-source and total cache-read ratios, and the empty `#/cacheWaste`.
- `contradictions`: The cache-waste filter is narrow (input > 100,000 with < 10% reuse) and therefore cannot see the duplicate-usage pattern in F4, which is repeated cost without being a cache miss; and cache reuse is a ratio, not a cost statement — the claude lane still carries 73.38% of spend at 94.62% reuse because its absolute input volume and its cache-write volume are larger. The codex lane's 47.21% is far below the other two and is reported without diagnosis in F11.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/cacheWaste`
- `severity`: P3
- `reproCommand`: `jq -c '{tot:(.totals.cacheReadTokens/.totals.inputTokens),fresh:(.totals.inputTokens-.totals.cacheReadTokens-.totals.cacheWriteTokens),bySource:(.bySource|to_entries|map({s:.key,r:(.value.cacheReadTokens/.value.inputTokens)})),waste:.cacheWaste}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: the executor pairing configuration — the prompt-cache settings currently in force across all three lanes.

### P3 — 191 tool calls and 13 imported files produced no errors

- `key`: `positive:spur-history-import:clean-import-and-tool-runs`
- `category`: `positive`
- `impact`: The evidence plane itself is trustworthy on its error axis: no tool call failed and no record was rejected, so the gaps found in this report are all measurement-coverage gaps rather than import corruption. Nothing in the report needs a caveat about lost or malformed data.
- `trend`: `not-comparable`
- `observation`: `#/byTool[].errors` is 0 for all 11 tool keys, summing over 191 calls. `#/coverage` reports `parseErrors` 0, `validationErrors` 0, `unknownRecords` 0, `parseErrorSamples` `[]` and `validationErrorSamples` `[]` for all three sources — 8 claude files, 1 codex file and 4 pi files. `#/totals/toolCalls` is 191 and `#/totals/messages` is 1,044.
- `inference`: Zero errors across every tool key plus zero parse, validation and unknown counts across all 13 files means the importers read this window's corpus without loss or rejection, so the artifact's content is complete relative to what the sources recorded. Named observations: the all-zero `errors` column and the all-zero error counters in `#/coverage`.
- `contradictions`: A clean error axis says nothing about coverage: the same `#/coverage` rows report `ok` while two lanes carry 154 untimed tool calls (F2) and 852 of the window's 1,044 records carry no usage, and `#/coverage` and `#/totals` disagree on the message count (F7), so "no errors" must not be read as "fully measured".
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`
- `severity`: P3
- `reproCommand`: `jq -c '{toolErrors:([.byTool[].errors]|add),calls:([.byTool[].calls]|add),coverage:[.coverage[]|{s:.source,f:.files,p:.parseErrors,v:.validationErrors,u:.unknownRecords}]}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — all three source lanes and their validation path.

### P4 — 20 of 21 chained agent.run dispatches succeeded with no unknown outcomes

- `key`: `positive:spur-history-analyze:pairing-dispatch-reliability`
- `category`: `positive`
- `impact`: Chained delegation worked this window: 21 dispatches across three pairings, 20 successes, 1 failure, and no unknown outcome anywhere — so the orchestration path itself is not a source of unaccounted work. Combined with P3 it means the window has no unexplained failures on either the tool or the dispatch axis.
- `trend`: `not-comparable`
- `observation`: `#/pairings` reports `claude`/`reviewer` 9 dispatches `successRate` 1 with `failures` 0; `pi-dsv4.1-flash-volc`/`reviewer` 6 dispatches `successRate` 0.8333 with `failures` 1; `pi-dsv4.1-flash-volc`/`scribe` 6 dispatches `successRate` 1 with `failures` 0. `unknownOutcomes` is 0 on all three rows.
- `inference`: Dispatches total 21 with 1 recorded failure and 0 unknown outcomes, which means every dispatch reached a terminal and classified state — a success rate computed on this fold is measured rather than assumed. Named observations: the three per-pairing dispatch and success counts, and the zero `unknownOutcomes` across all rows.
- `contradictions`: The single failure sits in the pairing with the slowest mean (`pi-dsv4.1-flash-volc` reviewer, 1,362,947.88 ms), the same lane as the F1 latency concentration, so reliability and latency are not independent of each other here. The `claude` reviewer's `successRate` 1 coexists with a recorded `resource-exhaustion` escalation (F12), so "no failures" is not the same claim as "no escalations"; and cost is known for only 1 of 3 pairings (F3), so "no unaccounted failures" does not extend to "no unaccounted cost".
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/pairings`
- `severity`: P3
- `reproCommand`: `jq -c '{dispatches:([.pairings[].dispatches]|add),failures:([.pairings[].failures]|add),unknown:([.pairings[].unknownOutcomes]|add),rows:[.pairings[]|{e:.executor,r:.role,d:.dispatches,s:.successRate,f:.failures}]}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: the `agent.run` dispatch path and the pairing analytics fold in `spur history analyze`.

### P5 — all three sources were imported within six seconds of artifact generation

- `key`: `positive:spur-history-import:import-freshness-at-generation`
- `category`: `positive`
- `impact`: The current artifact describes the corpus as it stood 2.27 s, 2.56 s and 5.12 s before the artifact was built, so nothing in this report is stale relative to the importer. That is what allows the findings above to be attributed to the window rather than to a lagging import, and it is the regime the baseline artifact's own rows do not share (section 3, blocker 2).
- `trend`: `not-comparable`
- `observation`: `#/coverage[0]` (claude) `lastImportedAt` `2026-10-29T15:30:10.478Z`, `#/coverage[1]` (codex) `2026-10-29T15:30:10.777Z` and `#/coverage[2]` (pi) `2026-10-29T15:30:07.926Z`, against `#/generatedAt` `2026-10-29T15:30:13.042Z` — 2.56 s, 2.27 s and 5.12 s before generation. All three rows report `status` `ok` with 0 parse and 0 validation errors.
- `inference`: Import timestamps that precede generation by single-digit seconds indicate the import ran as part of the same pipeline invocation rather than being reused from an earlier run, which is consistent with `cacheDisposition` `miss`. Named observations: the three sub-six-second gaps and the miss disposition.
- `contradictions`: Freshness is not completeness — the import was current in time while two lanes still carried 154 untimed tool calls and 852 usage-less records (F2, F11), and it covers three agent CLIs, so a fourth source today would still be invisible to this artifact.
- `evidenceAnchor`: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/coverage`, `#/generatedAt`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-provenance.json` — `cacheDisposition`
- `severity`: P3
- `reproCommand`: `jq -c '{gen:.generatedAt,imports:[.coverage[]|{s:.source,at:.lastImportedAt,st:.status}]}' .spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pipeline's import step and its ordering relative to `spur history analyze`.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `performance:pi-dsv4-1-flash-executor:per-step-latency` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/bySource`, `#/stepSupport`, `#/bySession`, `#/derived/timeDecomposition`, `#/derived/bottlenecks` |
| `telemetry:spur-history-import:claude-tool-duration-unmeasured` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byTool`, `#/bySession`, `#/totals`, `#/stepSupport/0`, `#/bySource/claude`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:120` |
| `telemetry:spur-history-analyze:pairing-cost-not-reconciled` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`, `#/bySource`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/pairings`, `#/totals/costUsd` |
| `telemetry:spur-history-import:duplicate-usage-records` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/topStepsByTokens`, `#/stepSupport/0`, `#/cacheWaste`, `#/bySource/claude`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/topStepsByTokens` |
| `coverage:spur-task-check:verified-outcome-absent` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/verifiedOutcome` |
| `telemetry:spur-history-analyze:tool-identity-fragmentation` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/population/tools`, `#/byModel` |
| `telemetry:spur-history-import:coverage-message-count-disagreement` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/coverage/0`, `#/bySource/claude`, `#/totals/messages`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/coverage/0`, `#/bySource/claude`, `#/totals/messages` |
| `telemetry:spur-history-analyze:phase-support-empty` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/derived/phases`, `#/byTool`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:65` |
| `workflow:spur-history-report:render-title-corrupted` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.md:4`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.md:4` |
| `workflow:history-anatomy:window-includes-generating-session` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/bySession` (sessionId `70140928-962b-4041-a748-04da5f7618ba`), `#/byModel`, `#/generatedAt`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-provenance.json` — `generatedAt` |
| `telemetry:spur-history-import:codex-lane-partial-instrumentation` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/bySource/codex`, `#/stepSupport/1`, `#/byTool`, `#/topStepsByTokens`, `#/coverage/1` |
| `reliability:agent-run-dispatch:reviewer-escalation-unaccounted` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/pairings`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` — `#/pairings` |
| `positive:spur-history-import:pi-complete-measurement-axis` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/stepSupport/2`, `#/bySession` (source `pi`), `#/byTool` |
| `positive:spur-history-analyze:cache-reuse-healthy` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/cacheWaste` |
| `positive:spur-history-import:clean-import-and-tool-runs` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals` |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/pairings` |
| `positive:spur-history-import:import-freshness-at-generation` | `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-current.json` — `#/coverage`, `#/generatedAt`; `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-provenance.json` — `cacheDisposition` |

Baseline artifacts cited in section 3 and section 5: `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`, `#/totals`, `#/loops`) and `.spur/run/7f00e5ba-a3d9-4d11-a86e-491e04b5b947-history-anatomy-baseline.md:4`.

Two limitations of this report's own evidence, stated rather than masked: the current window is provisional, so every current-window figure is a partial-day fact; and no comparison against `2026-10-28` is stated anywhere, because that baseline was found `not comparable` on five independent axes in section 3.

