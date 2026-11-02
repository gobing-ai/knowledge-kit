---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-10-28"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-10-28T00:00:00.000-07:00
    until: 2026-10-28T23:59:59.999-07:00
  sources:
    - source: claude
    - source: pi
windowState: "provisional"
generatedAt: "2026-10-28T15:30:14.354Z"
validatedAt: "2026-10-28T15:30:14.354Z"
artifactDigest: "e51e8f975ebc484f023466fcb1e4b3155a7188be6a5a3d7288705087bc113dc7"
baselineArtifactDigest: "19c0d4d7e0dfd1e37beb9a43d0b376a3b8c4abbc1c887a9a0dff9d099e4ccab1"
contractDigest: "34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5"
skillDigest: "bcd34064fb82e1d397715b1b6dcca8b68bd410f0761ddc3c529a9d49b2e1c5c1"
workflowDigest: "not available"
helperDigest: "a076bd717c8f320f0b526f357802e9a4f2a26a50205ca81242ec68989d4fb539"
runId: "10c08862-f985-4f19-a00a-d82113facb75"
currentArtifactPath: ".spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json"
spurVersion: "not available"
schemaVersion: 1
executor: "coder"
model: "not available"
cacheDisposition: "miss"
coverage:
  - source: claude, status: ok, lastImportedAt: 2026-10-28T15:30:10.932Z
  - source: pi, status: ok, lastImportedAt: 2026-10-28T15:30:09.075Z
---

> imported snapshot as of 2026-10-28T15:30:09.075Z · window provisional · cache miss

<!-- Candidate authored by sp:history-anatomy enrich · mode daily · run 10c08862-f985-4f19-a00a-d82113facb75 · schema v1 -->

# History forensics report — 2026-10-28 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `10c08862`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-10-28`, baseline is the immediately preceding local calendar day `2026-10-27` |
| Current window | `2026-10-28T00:00:00.000-07:00` → `2026-10-28T23:59:59.999-07:00` (America/Los_Angeles) |
| Baseline window | `2026-10-27T00:00:00.000-07:00` → `2026-10-27T23:59:59.999-07:00` (America/Los_Angeles) |
| Window state | `provisional` — generation happened at `2026-10-28T15:30:14.354Z` (08:30:14 local), 8.5 h into the local day it measures, with bounds running to `23:59:59.999`. Read from the run-level `windowState` in `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-provenance.json`; neither artifact JSON carries a `windowState` field |
| Generated | `2026-10-28T15:30:13.161Z` (current) · `2026-10-28T15:30:13.718Z` (baseline) |
| Toolchain | spur `0.4.20` (artifact `#/spurVersion`; the provenance file records `spurVersion` as `not available`) · artifact `schemaVersion` `1` · executor `coder`, model `not available` · contract version `1` |
| Digests | artifact `e51e8f975ebc484f023466fcb1e4b3155a7188be6a5a3d7288705087bc113dc7` · baseline artifact `19c0d4d7e0dfd1e37beb9a43d0b376a3b8c4abbc1c887a9a0dff9d099e4ccab1` · skill `bcd34064fb82e1d397715b1b6dcca8b68bd410f0761ddc3c529a9d49b2e1c5c1` · helper `a076bd717c8f320f0b526f357802e9a4f2a26a50205ca81242ec68989d4fb539` · workflow `not available`. Read from `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-provenance.json` (`artifactDigest`, `baselineArtifactDigest`, `skillDigest`, `helperDigest`, `workflowDigest`); the two artifact digests match no SHA-256 of either artifact file's current bytes, so they identify the recorded imported payload rather than the file on disk |
| Selector | sources `all`, no session/run/task narrowing, leaderboard depth `20` |
| Cache disposition | `miss` — no cached artifact existed for this date, so the run recomputed |
| Current artifact | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.md` |
| Selector file | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-selector.json` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| claude | ok | 5 | 708 | 105 | 0 | 0 | 0 | `2026-10-28T15:30:10.932Z` |
| pi | ok | 4 | 156 | 61 | 0 | 0 | 0 | `2026-10-28T15:30:09.075Z` |

Population: `9` sessions, `12` tool keys, `1` loop signal, `1` warning, leaderboard depth applied `20` (`#/population`). Both `9` and `12` are below `20`, so the session and tool enumerations are complete rather than bounded — F6 shows the tool count is complete but internally fragmented, and F7 shows the message population is not single-valued even before it is bounded. The step leaderboards (`#/topStepsByTokens`, `#/topStepsByDuration`) hold `20` rows each and are slices of the `263` assistant steps reported by `#/stepSupport` (claude 198 + pi 65), not population totals. The baseline artifact applies the same depth to `484` assistant steps (claude 289 + pi 195), so neither artifact's step leaderboards are population totals.

## Executive summary

- The measured current window is 9 sessions, 771 messages, 166 tool calls, a 1.84 h activity span, and `$2.449029` of provider-billed cost across two sources (`claude`, `pi`). Both sources imported with zero parse and zero validation errors.
- One P1 is a latency concentration, not a defect: pi's 65 assistant steps consume `4,586,483` ms of assistant duration — 86.48% of the window's `5,303,376` ms — at a 70,561 ms mean per step against claude's 4,192 ms over the 171 claude steps that carry a duration. LLM wait is 92.34% of the span, and a single pi session carries 51.77% of the span by itself.
- The second P1 is an instrumentation defect: all 105 claude tool calls carry no duration (`durationUnmeasured` 105 of 105), and all 5 claude sessions remain `in-progress`, so the tool axis exists only for the pi lane and 471,495 ms sits unattributed.
- Three further measurement defects sit underneath the numbers (F2's residual is P1, F4 and F3 are P2; F5 and F6 get their own bullets below): the `llmMs` bucket (`6,106,875` ms) exceeds the sum of the per-source `assistantDurationMs` rows (`5,303,376` ms) by `803,499` ms; six of the 20 largest-by-token steps are three usage-identical claude pairs worth `$0.351156` (14.34% of window cost); and the pairing cost fold covers only 1 of 3 pairings while that one row does tie below the window total this window, at `$2.377296` of `$2.449029`.
- The tool population is reported as `12` keys for at most 8 distinct tools, because both lanes name the same tools differently (shell alone is split `bash` 44 / `Bash` 63) and every pi-lane row records `resultBytes` 0 across 61 calls.
- The outcome axis is `not available` for this window: `taskDenominator` 0, `verifiedResults` 0, every `excludedReasons` bucket 0, `costCoverage` `{covered: 0, total: 0}`. No work in this window is tied to a verified outcome by this artifact, so cost per verified result cannot be computed.
- The workflow half is healthy on the axes it does measure: 0 tool errors across 166 calls, 0 parse and 0 validation errors across 9 files, 95.64% of billed input served from cache, and 13 of 14 chained `agent.run` dispatches succeeded with 0 unknown outcomes.
- Baseline comparison verdict: **not comparable**. The daily rule is satisfied in form, but the current window is a partial day against a closed day, neither artifact carries a single message population, and the two artifacts' leaderboard compositions differ. No trend, delta, or percentage is stated against the baseline anywhere in this report, and every finding is classified `not-comparable`.

## Baseline comparison

**Verdict: `not comparable`.** The daily rule is satisfied in form — the baseline selector is the immediately preceding local calendar day, `2026-10-27T00:00:00.000-07:00` → `2026-10-27T23:59:59.999-07:00` — but coverage differs materially on four independent axes, so no comparison is computed.

1. **Window completeness differs.** The current window is `provisional`: it was generated at `2026-10-28T15:30:14.354Z`, 8.5 h into the local day it measures, with bounds running to `23:59:59.999`. The baseline window is closed in the calendar sense — its last instant, `2026-10-27T23:59:59.999-07:00`, precedes both artifacts' generation at `2026-10-28T15:30:13.161Z` and `2026-10-28T15:30:13.718Z`. A partial day and a complete day are not an equal-coverage pairing, and session, message and cost counts are all functions of how much of the day has elapsed.
2. **Neither artifact carries a single message population.** In the current artifact `#/coverage` sums to `864` messages while `#/totals/messages` is `771`; in the baseline artifact the same two fields are `1,431` and `1,300`. The disagreement is confined to `claude` in both artifacts and the `pi` row agrees exactly with its own totals in both (`156` vs `156`, `463` vs `463`). A message-count delta would therefore be computed against two fields that disagree inside each artifact (F7).
3. **Import freshness regimes differ.** The current artifact's rows were imported `2.23` s and `4.09` s before generation, consistent with `cacheDisposition` `miss` and an import folded into this pipeline invocation. The baseline artifact's rows report `lastImportedAt` `2026-10-27T17:07:37.460Z` (claude) and `2026-10-27T17:07:36.625Z` (pi) — `22.38` h before baseline generation. The two windows are therefore drawn from different import regimes even though both report `status` `ok`.
4. **Leaderboard composition differs.** The current `#/topStepsByTokens` is `10` claude and `10` pi rows with every claude row at `inputTokens` 2 and cache-read between `132,096` and `149,156`; the baseline leaderboard is `0` claude and `20` pi rows with cache-read between `147,072` and `180,480`. Anything derived from a leaderboard — cache-read ranges, duplicate-tuple detection, per-step token concentration — is drawn from differently composed populations in the two artifacts.

Provenance facts for both windows, listed without arithmetic (this is coverage evidence, not a comparison). Each locator names the artifact it resolves in and the pointer within it; the window-state row locates the run-level provenance file instead.

| Fact | Locator (current artifact · baseline artifact) | Current | Baseline |
| --- | --- | --- | --- |
| Sources with imported records | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/coverage` | claude, pi | claude, pi |
| Window state | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-provenance.json` — `windowState` | provisional | closed (derived from the selector bounds) |
| Sessions in population | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/population/sessions` | 9 | 12 |
| Tool keys | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/population/tools` | 12 | 12 |
| Leaderboard depth applied | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/population/appliedTop` | 20 | 20 |
| Assistant steps | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/stepSupport` | 263 (claude 198, pi 65) | 484 (claude 289, pi 195) |
| Messages (totals fold) | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/totals/messages` | 771 | 1,300 |
| Messages (coverage fold) | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/coverage` | 864 (708 + 156) | 1,431 (968 + 463) |
| Tool calls | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/totals/toolCalls` | 166 | 376 |
| Activity span | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/derived/timeDecomposition/spanMs` | 6,613,824 ms | 14,888,029 ms |
| Billed input tokens | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/totals/inputTokens` | 16,008,508 | 34,657,788 |
| Output tokens | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/totals/outputTokens` | 203,769 | 371,770 |
| Total cost | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/totals/costUsd` | `$2.449029` | `$3.871586` |
| Pairing cost sum | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/pairings` | `$2.377296` (1 of 3 rows costed) | `$5.547851` (2 of 3 rows costed) |
| Loop signals | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/population/loops` | 1 | 1 |
| Task denominator | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/verifiedOutcome/taskDenominator` | 0 | 0 |
| Verified results | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` · `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/verifiedOutcome/verifiedResults` | 0 | 0 |

Consequences held throughout this report: section 4 `trend` is `not-comparable` for every finding; section 5 records discrete presence in the baseline (an observation about two artifacts, never a measured change); section 8 analyzes the current window only; no percentage appears anywhere as a change against the baseline.

## Findings

Each finding carries the full field set. `ownerSurface` names the concrete surface that would apply a change; `reproCommand` is one invocation a reader can run verbatim to re-observe the evidence.

### F1 — pi's 65 steps carry 86.48% of assistant duration at a 16.8× per-step mean

- `key`: `performance:pi-dsv4-1-flash-executor:per-step-latency`
- `category`: `performance`
- `impact`: LLM wait is 92.34% of the 1.84 h activity span, and one executor lane owns nearly all of it. Any throughput or cost-per-result programme that targets the pi pairing moves the dominant term; a programme targeting the claude lane, the tool axis, or idle time moves at most 13.52% of assistant duration and 7.66% of the span combined. Because a single pi session carries 51.77% of the span, one long run is currently enough to define the whole day's shape.
- `trend`: `not-comparable`
- `observation`: `#/bySource/pi/assistantDurationMs` is `4,586,483` over `#/stepSupport/1/assistantSteps` `65` — a 70,561 ms mean per step on a complete denominator. `#/bySource/claude/assistantDurationMs` is `716,893` over `#/stepSupport/0/assistantSteps` `198` — a 3,621 ms mean, or 4,192 ms on the 171 steps that carry a duration. Sixteen of the 20 rows of `#/topStepsByDuration` are `pi`, spanning 98.0 s to 138.0 s; the four `claude` rows span 132.7 s to 203.1 s and include the two longest steps in the window. `#/bySession` attributes `3,423,812` ms to the pi session `2026-10-28T11-30-04-779Z_01a18246-4169-774f-8c85-4bfabe0e46d3` (88 messages, 39 tool calls, `sessionState` `complete`), which is 74.65% of the pi lane's assistant duration. `#/derived/bottlenecks` ranks `llm` first at `6,106,875` ms and share `0.92335`, with `tool` last at `2,096` ms and share `0.000317`.
- `inference`: The latency concentration is a property of the pi lane rather than of the workload: pi issues 61 tool calls against claude's 105 and still takes 6.4× the assistant duration, while measured tool time across the whole window is only `2,096` ms, so tool execution cannot account for the difference. Named observations: the two per-step means under the same fold, the `2,096` ms tool total for 166 calls, the 16-of-20 `pi` composition of the duration leaderboard, and the single session holding 51.77% of the span.
- `contradictions`: The lane concentration is not uniform across steps — the two longest single steps in the window are `claude` rows at 203.1 s and 165.8 s, twice the pi maximum of 138.0 s — so "pi is slow" is true of the mean and false of the tail. Separately, the slow lane is the cheap one: `#/byModel/deepseek-v4-1-flash-261017` carries `$0.594324` (24.27% of window cost) against claude's `$1.854705`, at `$0.007414` per 1k output tokens versus `$0.015005`, so the concentration is a latency fact, not a spend fact. The claude mean also rests on 171 of 198 steps (F2), so the two means are not equally well supported.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/bySource/pi`, `#/bySource/claude`, `#/stepSupport`, `#/topStepsByDuration`, `#/bySession`, `#/byModel`, `#/derived/bottlenecks`
- `severity`: P1
- `reproCommand`: `jq -c '{claude:{ms:.bySource.claude.assistantDurationMs,steps:.stepSupport[0].assistantSteps,measured:.stepSupport[0].stepsWithDuration},pi:{ms:.bySource.pi.assistantDurationMs,steps:.stepSupport[1].assistantSteps},llmShare:(.derived.bottlenecks[0].share),topDur:[.topStepsByDuration[:4][]|{s:.source,d:.durationMs}]}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: the `pi-dsv4.1-flash-volc` executor pairing — its model selection, reasoning-effort and dispatch concurrency in the executor routing configuration.

### F2 — every claude tool call is untimed, and no claude session closes

- `key`: `telemetry:spur-history-import:claude-tool-duration-unmeasured`
- `category`: `telemetry`
- `impact`: The tool axis is measured for one lane only. All 105 claude calls — 63.25% of the window's 166 calls — contribute no duration, so `#/derived/timeDecomposition/toolMs` (`2,096` ms) describes pi's 61 calls alone while presenting itself as a window total, and `471,495` ms of the span falls into `unattributedMs`. Tool-time regressions in the claude lane are invisible to this report, and the per-call cost of the 190,918 bytes of `Read` output and 68,900 bytes of `Bash` output the claude lane does record cannot be priced at all.
- `trend`: `not-comparable`
- `observation`: Summing `#/byTool[].durationUnmeasured` over the claude-lane keys (`Bash` 63, `Read` 27, `Skill` 4, `Write` 4, `Edit` 2, `mcp__plugin_context-mode_context-mode__ctx_execute` 3, `ctx_execute_file` 1, `ToolSearch` 1) gives 105 unmeasured calls against 105 total calls, with `durationMsTotal` 0 on every one of those rows. The pi-lane keys carry 0 unmeasured calls out of 61 (`bash` 44, `edit` 7, `read` 5, `write` 5), with `durationMsTotal` 2,049 + 24 + 17 + 6 = `2,096` ms. All 5 claude rows in `#/bySession` carry `sessionState` `in-progress`; all 4 pi rows carry `complete`. `#/warnings/0` states that `471495ms` could not be attributed to llm/tool/idle because some durations were unmeasured, and `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:120` excludes 27 assistant steps from the duration leaderboard for the same reason.
- `inference`: The two observations agree on a single seam — the claude lane never emits a terminal or per-call timing record, so the analyzer has nothing to measure with, and the per-call durations and the session terminal state are missing together. Named observations: the 105-of-105 unmeasured claude calls, the 5-of-5 `in-progress` claude sessions against 4-of-4 `complete` pi sessions, and the warning naming unmeasured durations as the cause of the unattributed bucket.
- `contradictions`: `#/coverage/0/status` is `ok` with 5 files, `0` parse errors and `0` validation errors, so the import surface reports clean success while half its tool calls are untimed. The artifact also carries two different counts for the same quantity: `#/bySource/claude/assistantDurationUnmeasured` is `8`, while `#/stepSupport/0` implies `27` (`198` − `171`) and the render states "Excluding 27 assistant step(s) without measured duration". Separately, `#/derived/timeDecomposition/llmMs` `6,106,875` exceeds the sum of `#/bySource/*/assistantDurationMs` (`716,893` + `4,586,483` = `5,303,376`) by `803,499` ms, so the llm bucket is not reconcilable to its own source rows. Hypothesis for that residual (one signal, arithmetic coincidence): the 27 duration-less claude steps receive synthesized durations inside `llmMs` without appearing in `bySource`. Confirmation path: recompute `llmMs` with duration derivation disabled and diff against `5,303,376` ms.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byTool`, `#/bySession`, `#/stepSupport/0`, `#/bySource/claude`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:120` (Top Steps by Duration exclusion note)
- `severity`: P1
- `reproCommand`: `jq -c '{claudeUnmeasured:([.byTool[]|select(.toolName|test("^[A-Z]|ctx"))|.durationUnmeasured]|add),claudeCalls:([.byTool[]|select(.toolName|test("^[A-Z]|ctx"))|.calls]|add),toolMs:.derived.timeDecomposition.toolMs,llmMs:.derived.timeDecomposition.llmMs,srcAssistMs:([.bySource[].assistantDurationMs]|add),inProgress:[.bySession[]|select(.sessionState=="in-progress")|.source]}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the claude source lane's tool-call and session-terminal record emission, consumed by the `spur history analyze` `byTool` and `stepSupport` folds.

### F3 — the pairing cost fold covers one pairing and does not reconcile in a stated direction

- `key`: `telemetry:spur-history-analyze:pairing-cost-not-reconciled`
- `category`: `telemetry`
- `impact`: The pairing fold is the only place cost is attributable to a named stage, and it prices 5 of this window's 14 dispatches. The one costed row covers `$2.377296` of the window's `$2.449029` — 97.07% — while the two reviewer pairings report duration but no cost, so per-stage cost per minute cannot be computed for the roles that failed or that dispatched most cheaply. A fold whose relationship to the window total changes sign between artifacts gives an operator no invariant to compute a share against.
- `trend`: `not-comparable`
- `observation`: `#/pairings[2]` (`executor` `pi-dsv4.1-flash-volc`, `role` `scribe`) carries `totalCostUsd` `2.377296` with `dispatches` 5, `successRate` 1, `failures` 0 and `meanDurationMs` `1,427,679.46`. `#/pairings[0]` (`claude`, `reviewer`, 5 dispatches) and `#/pairings[1]` (`pi-dsv4.1-flash-volc`, `reviewer`, 4 dispatches) both carry `totalCostUsd` `null` while reporting `meanDurationMs` `399,631.57` and `1,458,293.54`. Summing every non-null `totalCostUsd` gives `2.377296`, which is `0.071733` below `#/totals/costUsd` `2.449029`. The baseline artifact's own `#/pairings` carries the mirror-image shape: two costed rows summing `5.547851` against its `#/totals/costUsd` of `3.871586`, and one `null` row that still reports `meanDurationMs`.
- `inference`: The fold has no reconciliation invariant in either direction — it sits below the window total here and above it in the baseline artifact — while consistently keeping duration for every dispatch and cost for only a subset. Named observations: the 1-of-3 cost coverage with 3-of-3 duration coverage in the current artifact, the `0.071733` shortfall against the window total, and the opposite-direction relationship in the baseline artifact's own rows.
- `contradictions`: `totalCostUsd` `null` on 2 of 3 pairings renders as `not available` under the truthfulness invariant, which is the correct treatment, so the fold is not fabricating values — the defect is reconciliation and coverage, not fabrication. The scribe pairing is also internally consistent (5 dispatches, `successRate` 1, `failures` 0), so nothing here says the dispatch accounting is wrong. The one pairing whose cost is known reports no model (`model` is `null` on all three rows), so cost cannot be attributed to a model through this fold.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`, `#/bySource`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/pairings`, `#/totals/costUsd`
- `severity`: P2
- `reproCommand`: `jq -c '{pairSum:([.pairings[].totalCostUsd|select(.!=null)]|add),dayTotal:.totals.costUsd,nullCost:([.pairings[]|select(.totalCostUsd==null)|{e:.executor,r:.role,d:.dispatches}]|length),pairs:[.pairings[]|{e:.executor,r:.role,d:.dispatches,c:.totalCostUsd,ms:.meanDurationMs}]}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: the pairing analytics fold consumed by `spur history analyze` (the `pairings` projection and its cost and model joins).

### F4 — three pairs of leaderboard steps share identical usage tuples

- `key`: `telemetry:spur-history-import:duplicate-usage-records`
- `category`: `telemetry`
- `impact`: Six of the 20 largest-by-token steps — `$0.351156` of `$2.449029` window cost, 14.34% — are three pairs whose usage and cost are identical to the micro-dollar while their timestamps and durations differ. If one row of each pair is a duplicate record, window cost, token totals and per-step latency are all overstated for the lane that owns 75.73% of spend; if both are real, the provider billed the same response twice and the same overstatement exists with a different cause. Either way the top of the token leaderboard cannot currently be read as 20 distinct steps.
- `trend`: `not-comparable`
- `observation`: Grouping `#/topStepsByTokens` by `(inputTokens, cacheReadTokens, outputTokens, costUsd)` yields three `claude` pairs: `(2, 137894, 6193, 0.092901)` at `2026-10-28T13:51:17.556Z` and `2026-10-28T13:52:51.898Z` with `durationMs` 3,500 and 94,342; `(2, 136456, 4538, 0.068076)` at `13:51:13.143Z` and `13:51:13.569Z` with `durationMs` `null` and 426; `(2, 134856, 973, 0.014601)` at `13:50:01.855Z` and `13:50:03.401Z` with `durationMs` `null` and 1,546. All six rows belong to the claude session `c69390b0-eb92-4c0b-a281-b3c2e0e24eb7`. No `pi` row is duplicated, and grouping the baseline artifact's `#/topStepsByTokens` the same way yields no pair across its 20 rows.
- `inference`: Identical `inputTokens`, `cacheReadTokens`, `outputTokens` and `costUsd` across two records is consistent with one provider response being written twice — a retried request whose first reply was already recorded, or a duplicate import line — rather than with two independent requests that happened to produce identical output-token counts. Named observations: the three exact-tuple pairs, the differing durations within each pair (which rules out a byte-identical copy), the confinement of all six rows to one claude session, and the absence of the pattern in the baseline leaderboard. Bounded to the top 20 of 263 assistant steps; steps outside the leaderboard were not examined, so this is a floor on the pattern, not a window total.
- `contradictions`: `#/stepSupport/0` reports claude `stepsWithUsage` `198` of `198` with no duplicate marker, so nothing in the fold flags a record as a repeat and the artifact carries no field that distinguishes a duplicate from a genuine re-bill. `#/cacheWaste` is empty (0 steps, 0 tokens) because its filter targets large fresh-input re-sends, which this pattern is not, so the existing waste detector can neither corroborate nor refute it. Two of the six rows carry `durationMs` `null` while their twins carry a duration, which is equally consistent with one row being a pre-duration echo as with two distinct records.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/topStepsByTokens`, `#/stepSupport/0`, `#/cacheWaste`, `#/bySource/claude`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/topStepsByTokens`
- `severity`: P2
- `reproCommand`: `jq -c '[.topStepsByTokens[]|{ts,src:.source,sid:.sessionId,u:[.inputTokens,.cacheReadTokens,.outputTokens,.costUsd],ms:.durationMs}]|group_by(.u)|map(select(length>1)|{u:.[0].u,hits:[.[]|{ts,ms,sid}]})' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the claude source lane's record de-duplication key, consumed by the `topStepsByTokens` and totals folds.

### F5 — the outcome axis is empty for the window

- `key`: `coverage:spur-task-check:verified-outcome-absent`
- `category`: `coverage`
- `impact`: The only dimension that ties agent activity to verified work contributes nothing: no task entered the fold, so `verifiedRate`, `correctionRate`, `timeToVerified` and `measuredTokensPerVerifiedResult` are all `null` and `costCoverage` is `{covered: 0, total: 0}`. The report can describe 1.84 h and `$2.449029` of effort but cannot state that any of it produced a verified result, so cost-per-verified-result — the metric that would rank every other finding by value — is not computable for this window.
- `trend`: `not-comparable`
- `observation`: `#/verifiedOutcome` reports `taskDenominator` 0, `verifiedResults` 0, `verifiedRate` `null`, `verifiedWithoutCorrection` 0, `verifiedWithoutCorrectionRate` `null`, `correctionCount` 0, `correctionRate` `null`, `retryExhaustedCount` 0, `measuredTokensPerVerifiedResult` `null`, `timeToVerified` `{count: 0, meanMs: null, maxMs: null}`, `costCoverage` `{covered: 0, total: 0}`, and every `excludedReasons` bucket 0 (`notDone`, `forcedDone`, `missingVerdict`, `syntheticVerdict`, `verdictNotPass`, `proofAbsent`, `certifyingRunFailed`).
- `inference`: A zero denominator with every exclusion bucket at zero means no task was in scope for the fold at all, which is a scope gap rather than a proof failure — in contrast to an exclusion-driven zero, which would name a bucket and a reason. Named observations: the zero `taskDenominator`, the all-zero `excludedReasons`, and the zeroed `costCoverage` that follows from both.
- `contradictions`: The window clearly contains task-shaped work — the 105 claude tool calls include 2 `Edit` and 4 `Write` calls, and 44 `bash` calls run in the pi lane — so activity exists that the outcome fold does not see. The artifact records no field explaining why the denominator is 0, so whether tasks were created after the fold's snapshot or are simply not linked to a verdict cannot be determined here. The baseline artifact reports the identical all-zero shape, so this is not a one-off measurement failure in this window.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/verifiedOutcome`
- `severity`: P2
- `reproCommand`: `jq -c '.verifiedOutcome|{den:.taskDenominator,verified:.verifiedResults,rate:.verifiedRate,excluded:.excludedReasons,cost:.costCoverage,ttv:.timeToVerified}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: `spur task check` — the verification gate whose PASS proof the `verifiedOutcome` fold reads, together with the fold's task-window join.

### F6 — twelve tool keys describe at most eight tools, and the pi rows carry no result volume

- `key`: `telemetry:spur-history-analyze:tool-identity-fragmentation`
- `category`: `telemetry`
- `impact`: `#/population/tools` reports `12` while the window contains at most 8 distinct tools, so the tool population is overstated and the four busiest tools are each split across two rows. Shell activity alone is split 44 / 63 across `bash` / `Bash`, named 64.46% of all calls only when the two rows are added by hand, and `resultBytes` is 0 for every pi-lane row, so context volume is unmeasurable for 61 calls while the claude-lane equivalents record it (`Read` 190,918 B, `Bash` 68,900 B). Ranking or budgeting tool behaviour by name mis-attributes the largest category.
- `trend`: `not-comparable`
- `observation`: `#/byTool` keys are `bash` (44), `Bash` (63), `edit` (7), `Edit` (2), `read` (5), `Read` (27), `write` (5), `Write` (4), `Skill` (4), `ToolSearch` (1), `mcp__plugin_context-mode_context-mode__ctx_execute` (3), `mcp__plugin_context-mode_context-mode__ctx_execute_file` (1) — 12 keys, 166 calls. Four conceptual tools appear under both a lowercase and a capitalized key: shell 44 + 63 = 107 calls (64.46%), edit 7 + 2 = 9, read 5 + 27 = 32, write 5 + 4 = 9. `#/coverage` splits along the same seam: pi contributed exactly the lowercase keys (44 + 7 + 5 + 5 = 61) and claude exactly the capitalized keys plus the two MCP keys and `ToolSearch` (63 + 27 + 4 + 4 + 2 + 3 + 1 + 1 = 105). `resultBytes` is `0` on all four pi keys and non-zero on every claude-lane key that returns content (`Read` 190,918, `Bash` 68,900, `Write` 832, `Edit` 454, `ToolSearch` 635, `ctx_execute` 363, `Skill` 143, `ctx_execute_file` 126).
- `inference`: The split aligns exactly with the source boundary — the pi adapter emits lowercase tool names without a result-size field while the claude adapter emits capitalized names with one — so the fragmentation is an adapter field-mapping difference rather than genuine tool diversity. Named observations: the four alias pairs, the exact per-source partition of lowercase versus capitalized-plus-MCP keys, and the zero `resultBytes` confined to the pi-lane rows.
- `contradictions`: The model label is not similarly fragmented — `#/byModel` holds exactly three keys (`claude-opus-5`, `deepseek-v4-1-flash-261017`, `unknown`), with no build-stamp duplicates — so the normalization gap is specific to tool naming and result volume rather than a general import-label problem. Timing within the instrumented lane is internally consistent (`bash` mean 46 ms, max 108 ms), so the missing pieces are identity and volume, not speed.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/population/tools`, `#/byModel`
- `severity`: P2
- `reproCommand`: `jq -c '{keys:(.byTool|length),shell:([.byTool[]|select(.toolName|ascii_downcase=="bash")|.calls]|add),rows:[.byTool[]|{t:.toolName,c:.calls,b:.resultBytes,u:.durationUnmeasured}]}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: the pi and claude importers' tool-record field mapping, surfaced through `spur history analyze`'s `byTool` fold.

### F7 — the artifact carries two different message populations

- `key`: `telemetry:spur-history-import:coverage-message-count-disagreement`
- `category`: `telemetry`
- `impact`: The same artifact states 708 claude messages in `#/coverage/0/messages` and 615 in `#/bySource/claude/messages`, and `#/totals/messages` (771) is the second number plus pi, not the first. Any per-message rate — messages per session, cost per message, messages per tool call — therefore has a 13.14% ambiguity on the claude side, and the reader cannot tell from the artifact which of the two counts is canonical. The same shape appears in the baseline artifact, so no per-message metric in this series is currently well defined.
- `trend`: `not-comparable`
- `observation`: `#/coverage[0]` (claude) reports `files` 5, `messages` 708, `toolCalls` 105; `#/bySource/claude/messages` is 615 and `#/bySource/claude/toolCalls` is 105, so the two folds agree on tool calls and disagree by 93 on messages. `#/totals/messages` is 771 = 615 (claude) + 156 (pi), so the totals fold follows `bySource`. The sum of `#/coverage` messages is 864 against that 771. The pi row agrees with its own total in both folds (156 vs 156). The baseline artifact repeats the shape with different numbers: `#/coverage/0/messages` 968 against `#/bySource/claude/messages` 837 (a 131 difference), `#/totals/messages` 1,300, and `#/coverage` summing to 1,431, with its pi row again agreeing exactly (463 vs 463).
- `inference`: Because the disagreement is confined to one source in both artifacts while the other source matches to the record, the two folds are counting different record classes on the claude path — most plausibly, `#/coverage` counting every imported claude record while `bySource` counts only records that fall inside the selector window. Named observations: the 93-message gap here, the 131-message gap in the baseline artifact, and the exact agreement of the pi rows in both. This attribution is a hypothesis resting on one comparative signal, so its confirmation path is: run `spur history analyze` over a window whose bounds cover all claude records and check whether the two counts converge.
- `contradictions`: `#/coverage[0]/status` is `ok` with `parseErrors` 0, `validationErrors` 0 and `unknownRecords` 0, so neither fold reports a rejected record — the difference is not corruption. `#/bySource/claude/records` is 615, equal to its `messages`, so within the totals fold the record and message counts coincide; the ambiguity is strictly between folds. The report's other ratios use tokens and cost rather than message counts, so no other finding depends on which count is canonical.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/coverage/0`, `#/bySource/claude`, `#/totals/messages`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/coverage/0`, `#/bySource/claude`, `#/totals/messages`
- `severity`: P3
- `reproCommand`: `jq -c '{coverageSum:([.coverage[].messages]|add),coverageClaude:.coverage[0].messages,bySourceClaude:.bySource.claude.messages,totals:.totals.messages,toolCallsAgree:(.coverage[0].toolCalls==.bySource.claude.toolCalls)}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the `coverage` fold's message accounting versus the `bySource`/`totals` accounting in `spur history analyze`.

### F8 — phase support claims support with zero phases

- `key`: `telemetry:spur-history-analyze:phase-support-empty`
- `category`: `telemetry`
- `impact`: The per-phase breakdown is the only view that would show where a run stalls between planning, implementation and verification. It renders an extraction-empty row under a flag asserting the dimension is available, so a reader is told the data exists and then shown none. That is worse than an explicit gap, because it can be mistaken for "no stalls occurred" — and this window contains a stall worth seeing (F1's single session holding 51.77% of the span).
- `trend`: `not-comparable`
- `observation`: `#/derived/phases` is `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}`. The rendered report's Per-Phase Breakdown table contains one row whose first cell states that a task-tracking signal is present while no phases were extracted, and whose three metric cells are empty (`.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:65`, the extraction-empty row under the Per-Phase Breakdown heading at `:61`).
- `inference`: `phaseSupport: "supported"` describes the presence of a task-tracking signal rather than the extraction of phase transitions, and `invalidPhaseCount` 0 is consistent with no extraction having been attempted. Named observations: the `supported` flag, the empty `phases` array, and the renderer's own extraction-empty row.
- `contradictions`: The flag is not false in the narrow sense — a task-tracking signal does exist in the session corpus, and 18 edit-or-write calls (9 edit, 9 write, counting both naming lanes) plus 44 pi shell calls are consistent with implementation-phase activity — so the label may be a naming defect in the fold rather than a wrong computation. The baseline artifact reports the identical `{supported, [], 0}` triple, so the label is stable across two windows rather than an intermittent glitch.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/derived/phases`, `#/byTool`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:65` (Per-Phase Breakdown extraction-empty row)
- `severity`: P3
- `reproCommand`: `jq -c '.derived.phases' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `derived.phases` fold and its `phaseSupport` label.

### F9 — the rendered report's title is duplicated and the whole file sits inside an unclosed code fence

- `key`: `workflow:spur-history-report:render-title-corrupted`
- `category`: `workflow`
- `impact`: Both rendered artifacts open with a broken header — a stray fence followed by a self-overlapping title — and the fence is never closed, so all 171 lines of the current render sit inside a code block. Any consumer that parses the markdown header, links the first line, renders the file, or diffs renders across days sees a corrupted and unstable document. Low blast radius, deterministic, and it degrades the artifact operators read directly.
- `trend`: `not-comparable`
- `observation`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:4` reads `# History forensics report — generated 2026-10-28T15:3# History forensics report — generated 2026-10-28T15:30:13.161Z`, preceded at line 3 by a bare opening fence; the file contains exactly one fence marker across its 171 lines, so that fence never closes. `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.md:4` is corrupted identically with its own timestamp `2026-10-28T15:30:13.718Z`.
- `inference`: The shared prefix `…T15:3` before the full title indicates the header writer emits the timestamp plus a truncated title, then the complete title — a single renderer path, not per-artifact damage, since the same malformation appears in both renders with only the timestamp differing. Named observations: the identical malformation in two independently rendered files, and the truncated-prefix-then-full-title shape at line 4 of each.
- `contradictions`: The artifact JSON is unaffected — `#/generatedAt` is well formed in both — so the defect is confined to the markdown renderer and does not contaminate any computed value in this report. The fence defect and the title defect are two symptoms in one file; whether they share a cause is a hypothesis with one signal (their co-location), confirmation path: inspect the renderer's header and footer writers for the fence it emits around the body.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:4`, `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.md:4`
- `severity`: P3
- `reproCommand`: `sed -n '1,5p' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md; grep -c '^```' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md`
- `ownerSurface`: `spur history report` — the markdown header and fence writer used by `--mode forensics`.

### F10 — the window contains the session that generated the report

- `key`: `workflow:history-anatomy:window-includes-generating-session`
- `category`: `workflow`
- `impact`: The report measures a window that includes its own generating run, so a slice of the measured activity is the act of measuring: 22 messages began 10.9 s before generation, contribute all 22 records of the `unknown` model bucket, and carry no tokens, no tool calls and no cost. The distortion is negligible in magnitude but it makes the current-day figures non-reproducible — a second run of the same day would measure a different amount of its own overhead — and it is the mechanism by which a self-referential report could in principle amplify its own signals.
- `trend`: `not-comparable`
- `observation`: `#/bySession` includes a claude session `14c92a0b-966f-47a3-921e-45dd755ab99a` with `startedAt` `2026-10-28T15:30:02.212Z`, `messages` 22, `toolCalls` 0, `tokens` 0, `costUsd` 0, `topTool` `null`, `sessionState` `in-progress` — it began 10.9 s before current-artifact generation at `2026-10-28T15:30:13.161Z`. `#/byModel/unknown` holds exactly 22 records with `recordsWithUsage` 0, `inputTokens` 0, `outputTokens` 0, `costUsd` 0 and no duration, matching that session's message count and null usage.
- `inference`: A session that starts seconds before generation, contributes exactly the record count of the artifact's otherwise-unattributable `unknown` model bucket, and carries no usage at all is the report pipeline observing itself rather than independent operator work. Named observations: the 10.9 s gap between `startedAt` and `generatedAt`, the exact 22-for-22 match between that session's messages and the `unknown` model records, and the zero usage on both. Which run it is remains a hypothesis (the evidence identifies a self-observing session, not which operation owns it), with confirmation path: compare this session id against the run's provenance once the publisher records the generating session id — the provenance file does not record it today.
- `contradictions`: The self-observed slice is too small to move any aggregate — 22 of 771 messages, `$0` of `$2.449029`, 0 of 166 tool calls — so it does not threaten the validity of any other finding. It is `in-progress` like every other claude session, so it is not distinguishable from them by state, and unlike the comparable session in the baseline artifact (156 messages, 29 tool calls, `$0.474660`) it carries no spend at all, which is why it lands in the `unknown` model bucket rather than a named one.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/bySession` (sessionId `14c92a0b-966f-47a3-921e-45dd755ab99a`), `#/byModel/unknown`, `#/generatedAt`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-provenance.json` — `generatedAt`
- `severity`: P3
- `reproCommand`: `jq -c '{gen:.generatedAt,self:[.bySession[]|select(.sessionId|startswith("14c92a0b"))],unknown:.byModel.unknown}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: the history-anatomy daily workflow definition (the `kk`/spur workflow that shells `spur history analyze`), which owns window selection at generation time.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count or impact change is computed or implied. The final column records only whether the same signal class is discretely present in the baseline artifact (an observation about two artifacts, not a measured change) and what would have to happen for a future run to classify the finding.

| Stable key | Recurrence class | Severity now | Discrete baseline presence and what a comparable baseline would need |
| --- | --- | --- | --- |
| `performance:pi-dsv4-1-flash-executor:per-step-latency` | `not-comparable` | P1 | Same class present in both artifacts: the baseline `#/bySource/pi/assistantDurationMs` is `12,255,140` over 195 steps (`#/stepSupport/1`) against claude `901,014` over 289 steps (`#/stepSupport/0`), so the pi lane dominates assistant duration there too. Each figure is stated as its own artifact's value and is not subtracted. A comparable baseline needs a closed current window so a per-step mean could be read rather than merely observed. |
| `telemetry:spur-history-import:claude-tool-duration-unmeasured` | `not-comparable` | P1 | Same class present: the baseline `#/byTool` claude-lane rows (`Bash` 112, `Read` 30, `Skill` 5, `Write` 5, `ctx_execute_file` 3, `ctx_execute` 2, `Edit` 1, `ToolSearch` 1) sum to 159 unmeasured calls out of 159, with `durationMsTotal` 0 on each, and all 5 baseline claude sessions (of the baseline `#/bySession`' 12 rows: 7 `pi`, 5 `claude`) are `in-progress`. A comparable baseline needs a closed current window so a duration-coverage change could be read. |
| `telemetry:spur-history-analyze:pairing-cost-not-reconciled` | `not-comparable` | P2 | Same seam present, opposite direction: the baseline `#/pairings` costs 2 of 3 rows (`pi-dsv4.1-flash-volc` reviewer `$2.851083`, scribe `$2.696768`) and leaves `claude` reviewer `null` while still reporting `meanDurationMs` `393,319.57`; its costed rows sum to `5.547851` against its own `#/totals/costUsd` of `3.871586`. The current artifact costs 1 of 3 rows and sits below its total. A comparable baseline is needed before any statement about the direction of the gap could be made. |
| `telemetry:spur-history-import:duplicate-usage-records` | `not-comparable` | P2 | Not observed in the baseline's 20-row leaderboard: grouping its `#/topStepsByTokens` by usage tuple yields no pair. Bounded absence — steps outside either leaderboard were not examined — so this is neither `new` nor `resolved`; a comparable baseline with like leaderboard composition would be needed to classify it. |
| `coverage:spur-task-check:verified-outcome-absent` | `not-comparable` | P2 | Same class present: the baseline `#/verifiedOutcome` also reports `taskDenominator` 0 with every `excludedReasons` bucket 0 and `costCoverage` `{covered: 0, total: 0}`. Present in two artifacts, not a measured change. |
| `telemetry:spur-history-analyze:tool-identity-fragmentation` | `not-comparable` | P2 | Same class present: the baseline `#/byTool` carries the same lowercase/capitalized split across the same 12 keys (`bash` 178 / `Bash` 112, `edit` 19 / `Edit` 1, `read` 14 / `Read` 30, `write` 6 / `Write` 5) with `resultBytes` 0 on every lowercase key. Presence in two artifacts, not a counted change. |
| `telemetry:spur-history-import:coverage-message-count-disagreement` | `not-comparable` | P3 | Same class present with a different magnitude: the baseline `#/coverage/0/messages` is `968` against its `#/bySource/claude/messages` of `837` (a 131-record gap), `#/totals/messages` `1,300`, and `#/coverage` summing to `1,431`; its pi row agrees exactly (`463` vs `463`). This is the second artifact carrying the same shape, which is the recurrence basis section 9 item 4 uses. |
| `telemetry:spur-history-analyze:phase-support-empty` | `not-comparable` | P3 | Same class present: the baseline `#/derived/phases` is also `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}`, and its render carries the same extraction-empty row at `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.md:64`. |
| `workflow:spur-history-report:render-title-corrupted` | `not-comparable` | P3 | Same class present: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.md:4` is corrupted identically, so the defect is deterministic across both renders of this run. Carries a `file:line` anchor, which satisfies the evidence rule for a process improvement without a second closed window. |
| `workflow:history-anatomy:window-includes-generating-session` | `not-comparable` | P3 | Present in the baseline artifact in kind but not in the same window: the baseline window (`2026-10-27`) does hold a session started `2026-10-27T15:30:02.125Z`, seconds before its own generation instant, but that generation instant falls outside the day the baseline window measures. The current window is the one that contains its own generating run. A comparable baseline would require two provisional windows generated the same way. |
| `positive:spur-history-import:pi-complete-measurement-axis` | `not-comparable` | P3 | Same class present on the step and tool axes: the baseline `#/stepSupport/1` reports pi `assistantSteps` 195 with `stepsWithUsage`, `stepsWithDuration`, `stepsWithDerivedDuration` and `stepsWithCacheRead` all 195, and every baseline pi-lane `#/byTool` row reports `durationUnmeasured` 0. The session-terminal axis holds there too (7 of 7 baseline pi sessions `complete`). |
| `positive:spur-history-analyze:cache-reuse-healthy` | `not-comparable` | P3 | Same class present at a higher level: the baseline `#/totals` serves `33,558,546` of `34,657,788` billed input tokens from cache, and its `#/cacheWaste` is likewise 0 steps and 0 input tokens. Each figure is its own artifact's value and is not subtracted; a comparable baseline is needed before any change in reuse could be read. |
| `positive:spur-history-import:clean-import-and-tool-runs` | `not-comparable` | P3 | Same class present: both baseline `#/coverage` rows report `parseErrors` 0, `validationErrors` 0 and `unknownRecords` 0, and the baseline `#/byTool[].errors` sum to 0 over 376 calls. Presence in two artifacts, not a counted change. |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `not-comparable` | P3 | Same class present on a larger population: the baseline `#/pairings` covers 17 dispatches with 1 failure and `unknownOutcomes` 0 on all three rows, against 14 dispatches with 1 failure and 0 unknown here. Each figure is its own artifact's value and is not subtracted. |
| `positive:spur-history-import:import-freshness-at-generation` | `not-comparable` | P3 | Same class present: the baseline `#/coverage` rows were imported `2026-10-27T17:07:37.460Z` and `2026-10-27T17:07:36.625Z`, both on the day they describe, so its import preceded its own analysis windows by hours rather than by days. The freshness regime differs from the current artifact's 2.23 s / 4.09 s and is stated in section 3 axis 3 as a comparability blocker, not as a measured change. |

Two independent artifacts in this run carry the tool-fragmentation, message-population, phase-support and render defects, which satisfies the evidence rule for the corresponding process improvements in section 9; the render defect additionally carries a `file:line` anchor. No finding is downgraded or dropped because its baseline counterpart is absent or differently shaped.

## Telemetry gaps

Dimensions the artifact cannot support. Each renders `not available`; none is inferred from a raw history file.

| Dimension | Rendering | Why | Anchor |
| --- | --- | --- | --- |
| Claude per-call tool duration | `not available` | 105 of 105 claude tool calls unmeasured, `durationMsTotal` 0 on every claude-lane row | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byTool` |
| Claude session end state | `not available` | 5 of 5 claude sessions report `sessionState` `in-progress`; no terminal record | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/bySession` |
| Duration for 27 claude assistant steps | `not available` | `#/stepSupport/0` `stepsWithDuration` 171 of 198; the render excludes them from the duration leaderboard | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/stepSupport/0` |
| Claude token usage on 510 of 615 records | `not available` | `#/bySource/claude/recordsWithUsage` 105 of 615; 601 of the window's 771 records carry no usage at all | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/bySource/claude`, `#/totals/recordsWithUsage` |
| Pi result volume (bash, edit, read, write) | `not available` | `resultBytes` 0 on all four pi-lane rows (61 calls) | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byTool` |
| Tool command identity | `not available` | `byTool` carries no command or argument field; loop rows expose only an `argsDigest` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Per-phase breakdown | `not available` | `phaseSupport` `supported` but `phases` is empty | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/derived/phases` |
| Verified-rate, correction-rate, time-to-verified, tokens per verified result | `not available` | `taskDenominator` 0; every rate field `null` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/verifiedOutcome` |
| Per-pairing cost for 2 of 3 pairings | `not available` | `totalCostUsd` `null` on the `claude` reviewer and `pi-dsv4.1-flash-volc` reviewer rows while both report `meanDurationMs` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/pairings` |
| Pairing model identity | `not available` | `model` is `null` on every `#/pairings` row, so no pairing cost or duration is attributable to a model | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/pairings` |
| Usage attribution for the `unknown` model bucket | `not available` | 22 records with `recordsWithUsage` 0, zero tokens and no duration | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byModel/unknown` |
| Workflow digest and provenance model | `not available` | Provenance records `workflowDigest` and `model` as `not available`, and `spurVersion` as `not available` while the artifact reports `0.4.20` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-provenance.json` — `workflowDigest`, `model`, `spurVersion` |
| Canonical message population | `not available` | `#/coverage` and `#/totals` disagree on the claude count (708 vs 615) and the artifact names no canonical field | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/coverage/0`, `#/totals/messages` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` (section 3) | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/coverage` |

Attribution note for the 7.13% unattributed bucket: the artifact's own warning `derived-unattributed-time` states that `471495ms` could not be attributed to llm/tool/idle because some durations were unmeasured, and points at the step-support matrix (`#/warnings/0`). That is a gap, not workload; combined with F2 it is the arithmetic shadow of the untimed claude lane rather than idle agent time.

## Remediation options

Proposals only. Nothing below has been applied, no diff is produced, and no command here was run by this report.

**R1 — bring the pi lane's per-step latency under a stated budget** (addresses `performance:pi-dsv4-1-flash-executor:per-step-latency`)

- Owner surface: the `pi-dsv4.1-flash-volc` executor pairing — model selection, reasoning effort and dispatch concurrency in the executor routing configuration.
- Expected impact: the 70,561 ms per-step mean and its 86.48% share of assistant duration become a chosen operating point; a reduction of even a fraction of that mean moves the largest single term in the window's 1.84 h span, which today is dominated by one session holding 51.77% of it.
- Verification method: a subsequent artifact reports `#/bySource/pi/assistantDurationMs` divided by `#/stepSupport/1/assistantSteps` at or below the budget the operator sets, with `#/derived/bottlenecks` `llm` share falling below its present `0.92335`.
- Reversibility: reversible — a routing or effort setting; no history is rewritten and the previous configuration can be restored.
- Handoff: `spur task create "performance:pi-dsv4-1-flash-executor:per-step-latency — budget pi per-step latency" --template issue`

**R2 — emit claude tool-call timing and a session terminal record** (addresses `telemetry:spur-history-import:claude-tool-duration-unmeasured`)

- Owner surface: `spur history import` — the claude source lane's per-call and session-end records, consumed by the `byTool` and `stepSupport` folds.
- Expected impact: `toolMs` becomes a window total covering both lanes instead of pi's 61 calls only, the 471,495 ms unattributed bucket shrinks, the 803,499 ms `llmMs`-versus-sources residual becomes reconcilable instead of absorbed, and the `assistantDurationUnmeasured` field stops disagreeing with `stepSupport`.
- Verification method: `#/byTool` claude-lane rows show `durationUnmeasured` below `calls` with a non-zero `durationMsTotal`, `#/stepSupport/0` `stepsWithDuration` equals `assistantSteps`, `#/bySource/claude/assistantDurationUnmeasured` equals the gap implied by `#/stepSupport/0`, and `#/derived/timeDecomposition/llmMs` equals the sum of `#/bySource/*/assistantDurationMs`.
- Reversibility: reversible — importer-only; a re-import rebuilds the affected rows and the previous behaviour returns by reverting the mapping.
- Handoff: `spur task create "telemetry:spur-history-import:claude-tool-duration-unmeasured — emit claude tool timing and session terminal records" --template issue`

**R3 — state the pairing fold's coverage and reconciliation direction** (addresses `telemetry:spur-history-analyze:pairing-cost-not-reconciled`)

- Owner surface: the pairing analytics fold's cost and model joins in `spur history analyze`.
- Expected impact: pairing cost becomes a subset of window cost an operator can divide by, with the uncovered dispatch count stated, so the share-of-window figure is either computable or explicitly `not available` rather than varying in direction between artifacts.
- Verification method: for a fresh artifact, every non-null `#/pairings[].totalCostUsd` sums to at most `#/totals/costUsd`, each pairing row names the dispatch set its cost covers, and a pairing row carries either a `model` or an explicit `not available` marker for it.
- Reversibility: reversible — a join predicate and a provenance field; no history is mutated.
- Handoff: `spur task create "telemetry:spur-history-analyze:pairing-cost-not-reconciled — state pairing fold coverage and reconciliation" --template issue`

**R4 — de-duplicate usage-identical records at import** (addresses `telemetry:spur-history-import:duplicate-usage-records`)

- Owner surface: `spur history import` — the claude source lane's record de-duplication key, feeding the totals and `topStepsByTokens` folds.
- Expected impact: establishes whether `$0.351156` of the window's `$2.449029` is double-counted, and either removes the duplication or proves the six rows are distinct billed calls; either outcome makes window cost and claude token totals trustworthy and the token leaderboard readable as 20 distinct steps.
- Verification method: grouping a fresh artifact's `#/topStepsByTokens` by usage tuple yields no pair, or the artifact carries an explicit repeat marker on rows that legitimately repeat with a stated reason.
- Reversibility: reversible — a de-duplication key; disabling it restores today's rows on re-import, and the raw session files are untouched.
- Handoff: `spur task create "telemetry:spur-history-import:duplicate-usage-records — de-duplicate usage-identical records" --template issue`

**R5 — populate the outcome fold's task denominator** (addresses `coverage:spur-task-check:verified-outcome-absent`)

- Owner surface: `spur task check` (the proof-producing gate) together with the `verifiedOutcome` fold's task-window join.
- Expected impact: `verifiedRate`, `timeToVerified` and `costCoverage` become computable, so cost-per-verified-result — the metric that would rank the other findings by value — stops rendering `not available` for the whole day.
- Verification method: a subsequent artifact reports a non-zero `#/verifiedOutcome/taskDenominator`, and a non-zero `verifiedResults` or a named non-zero `excludedReasons` bucket identifying why an in-scope task was excluded.
- Reversibility: reversible — a scope/join change in the fold; no verdict data is deleted.
- Handoff: `spur task create "coverage:spur-task-check:verified-outcome-absent — populate the outcome fold task denominator" --template issue`

**R6 — normalize tool names and carry result size on the pi lane** (addresses `telemetry:spur-history-analyze:tool-identity-fragmentation`)

- Owner surface: the pi and claude importer field mappings, surfaced through the `byTool` fold.
- Expected impact: one key per tool instead of 12 keys for at most 8 tools, a correct `#/population/tools` count, shell activity reported as 107 calls rather than split 44 / 63, and context volume measurable for 61 pi calls that currently record 0 bytes.
- Verification method: a fresh artifact's `#/byTool` shows one key per tool with no lowercase/capitalized pair, and `resultBytes` is non-zero for `bash`, `edit`, `read` and `write` calls whose output was captured.
- Reversibility: reversible — a normalization map plus an added field; older artifacts keep rendering their original keys, so nothing historical is invalidated.
- Handoff: `spur task create "telemetry:spur-history-analyze:tool-identity-fragmentation — normalize tool names and record result size" --template issue`

**R7 — name one canonical message population** (addresses `telemetry:spur-history-import:coverage-message-count-disagreement`)

- Owner surface: the `coverage` fold's message accounting versus the `bySource`/`totals` accounting in `spur history import` and `spur history analyze`.
- Expected impact: the 93-record ambiguity on the claude side disappears, so per-message rates have a single denominator and a reader does not have to choose between two fields in the same artifact.
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
- Expected impact: current-day figures stop including the measurement act, so a re-run of the same day measures the same operator work and the window becomes reproducible; the self-observed 22 messages and their 22 `unknown`-model records move to an explicitly labelled overhead line.
- Verification method: a subsequent artifact's `#/bySession` contains no session whose `startedAt` falls between the analysis start and `#/generatedAt`, or such a session appears with an explicit self-observation marker and its records excluded from `#/byModel`.
- Reversibility: reversible — a window/exclusion parameter; the excluded session remains in the corpus and is recovered by reverting it.
- Handoff: `spur task create "workflow:history-anatomy:window-includes-generating-session — exclude the generating session from the window" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 6,613,824 ms = 1.84 h):

| Component | Time | Share of span |
| --- | ---: | ---: |
| LLM latency (assistant duration, summed) | 1.70 h (6,106,875 ms) | 92.34% |
| Unattributed (unmeasured durations) | 7.86 min (471,495 ms) | 7.13% |
| Idle / overhead | 33.36 s (33,358 ms) | 0.50% |
| Tool execution | 2.10 s (2,096 ms) | 0.032% |

Reading: this window is almost entirely LLM wait. The four buckets sum exactly to `spanMs`, so the fold balances internally, but `llmMs` `6,106,875` exceeds the sum of the per-source `assistantDurationMs` rows (`716,893` + `4,586,483` = `5,303,376`) by `803,499` ms, so the llm bucket is not reconcilable to its source rows (F2). Tool time is 0.032% of span and covers only the pi lane, so the tool axis is both tiny and partial. The 7.13% unattributed share is an instrumentation residual, explicitly not workload (`#/warnings/0`).

**Per-step latency by source** (`#/bySource`, `#/stepSupport`) — the axis that explains the decomposition:

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per step | Share of assistant duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| pi | 65 | 65 (complete) | 4,586,483 ms | 70,561 ms | 86.48% |
| claude | 198 | 171 (27 missing) | 716,893 ms | 3,621 ms (4,192 ms over 171) | 13.52% |

The pi lane is 16.8× slower per step on measured denominators (19.5× against claude's 198-step denominator), which is the mechanical reason LLM wait dominates. The claude mean is less well supported: it is divided over 27 steps that carry no duration at all (F2), so the 13.52% share is a floor for claude and a ceiling for pi. Within the pi lane the distribution is heavily concentrated: the single session `2026-10-28T11-30-04-779Z_01a18246` contributes `3,423,812` ms — 74.65% of the lane's assistant duration, 51.77% of the whole span.

**Tool execution** (`#/byTool`; instrumented total 2,096 ms, all of it pi):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| bash | 44 | 2,049 ms | 46 ms | 108 ms | 0 |
| edit | 7 | 24 ms | 3 ms | 8 ms | 0 |
| read | 5 | 17 ms | 3 ms | 6 ms | 0 |
| write | 5 | 6 ms | 1 ms | 2 ms | 0 |
| Bash | 63 | `not available` | `not available` | `not available` | 63 |
| Read | 27 | `not available` | `not available` | `not available` | 27 |
| Skill | 4 | `not available` | `not available` | `not available` | 4 |
| Write | 4 | `not available` | `not available` | `not available` | 4 |
| ctx_execute | 3 | `not available` | `not available` | `not available` | 3 |
| Edit | 2 | `not available` | `not available` | `not available` | 2 |
| ctx_execute_file | 1 | `not available` | `not available` | `not available` | 1 |
| ToolSearch | 1 | `not available` | `not available` | `not available` | 1 |

One shell lane is instrumented and the other is not: 46 ms mean over 44 pi `bash` calls, against 63 `Bash` calls with no timing at all. The slowest measured call is 108 ms — 653× below the 70,561 ms per-step LLM mean (nearly three orders of magnitude), consistent with the 0.032% tool share. Tool name aliasing and the missing `resultBytes` on the pi rows are F6.

**Cost and tokens by source** (`#/bySource`, `#/totals`, total `$2.449029`):

| Source | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cost / 1k output | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| claude | 615 | 10,033,116 | 9,529,352 | 503,554 | 123,605 | `$1.854705` | 75.73% | $0.015005 | 94.98% |
| pi | 156 | 5,975,392 | 5,781,888 | 0 | 80,164 | `$0.594324` | 24.27% | $0.007414 | 96.76% |

Window totals: billed input 16,008,508 (fresh 193,714 · cache-read 15,311,240 · cache-write 503,554), output 203,769, overall cache-hit ratio 95.64% of billed input, provider usage present on 170 of 771 records. The two cost cells are complementary and both measured, so no cell reads `not available`. Claude carries 75.73% of cost on 60.66% of output tokens (123,605 of 203,769, on 615 of the totals fold's 771 messages) at a 2.02× higher cost per 1k output tokens, so this window is claude-weighted on spend and pi-weighted on latency — two different conclusions from two different axes, and both are needed before choosing a routing change.

**Chained `agent.run` run cost** (per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Dispatches | Success rate | Failures | Total cost | Mean duration |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `claude` | reviewer | 5 | 1.00 | 0 | `not available` | 399,631.57 ms (6.66 min) |
| `pi-dsv4.1-flash-volc` | reviewer | 4 | 0.75 | 1 | `not available` | 1,458,293.54 ms (24.30 min) |
| `pi-dsv4.1-flash-volc` | scribe | 5 | 1.00 | 0 | `$2.377296` | 1,427,679.46 ms (23.79 min) |

The three pairings cover 14 dispatches with 1 failure and 0 unknown outcomes. Cost is reportable for 1 of 3 pairings; the other two render `not available` rather than zero, per the run-cost rule, so the share-of-window figure is only 97.07% and is not a full attribution (F3). The pi pairings run 3.6× and 3.6× the claude reviewer mean (24.30 min and 23.79 min against 6.66 min), the same lane as the F1 latency concentration, so the pi executor is slow as a reviewer and as a scribe as well as as a primary. The window's only dispatch failure sits in the pi `reviewer` pairing, whose 4 dispatches make that single failure a 25% failure rate on the smallest sample in the fold.

**Cache re-send waste** (`#/cacheWaste`): 0 steps, 0 input tokens, empty `topSteps`. The filter targets assistant steps with input above 100,000 tokens and cache reuse below 10%; no step met it. This is a genuine zero for that filter, corroborated by the 95.64% overall cache-hit ratio, not a masked gap — but the same filter does not cover the duplicate-usage pattern in F4, which is a different shape of repeated cost.

**Per-step token concentration** (`#/topStepsByTokens`, top 20 of 263): every row carries at least 132,096 cache-read tokens, peaking at 149,156, and all 10 claude rows carry `inputTokens` 2 — long cached contexts with almost no fresh input, which is the healthy cache behaviour the 95.64% ratio reflects. Six of those 20 rows are the three duplicate tuples in F4, so the leaderboard's composition should be read with that caveat.

**Bottleneck order** (`#/derived/bottlenecks`): llm 92.34% → unattributed 7.13% → idle 0.50% → tool 0.032%.

## Workflow and process improvements

Numbered prose proposals; each is report-only and requires operator acceptance before any surface changes.

1. **Separate "imported" from "measurable" in the per-source status row.** Both sources report `ok` with zero parse and zero validation errors while one lane contributes no tool timing and no closed session (F2). A status field that cannot be non-`ok` for a partially unmeasurable source carries no information. Owner surface: the per-source coverage contract in `spur history import` and `spur history analyze`. Recurrence basis: the same all-clear-status shape appears in both artifacts of this run.
2. **Declare a window `provisional` inside the report body, not only in provenance.** The current window is provisional by construction — generation happened 8.5 h into the day it measures — yet neither render carries the window state, so a reader of the report alone cannot tell a partial day from a closed one, and this report's own comparability verdict had to rediscover the difference by hand. Owner surface: `spur history report`, the provenance header. Recurrence basis: neither render carries the window state; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:1` and `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.md:1` hold only a generation timestamp and a selector hash.
3. **Give the tool axis an identity dimension before adding any further tool metrics.** The 12 reported keys describe at most 8 tools and the busiest tool is split across two rows (F6); any per-command cost or per-command context analytics needs the label first. Owner surface: `spur history analyze`, the `byTool` fold. Recurrence basis: the baseline `#/byTool` carries the same lowercase/capitalized split across the same 12 keys with `resultBytes` 0 on every lowercase key.
4. **Name one canonical message population before any per-message rate is reported.** Two folds in each artifact disagree on the claude message count (708 vs 615 here, 968 vs 837 in the baseline) while agreeing on tool calls and on the pi count (F7). Owner surface: the `coverage` and `bySource` folds. Recurrence basis: the same shape, confined to the same source, appears in both artifacts of this run.
5. **Treat an unreconcilable aggregate as a gap, not as a number.** Two folds in this artifact fail to tie to their own components: `llmMs` exceeds the sum of per-source assistant durations by 803,499 ms (F2), and pairing cost covers 1 of 3 pairings while relating to the window total in the opposite direction from the baseline artifact (F3). Both are currently presented as values with no reconciliation flag, which is the shape the contract forbids for unsupported dimensions — an unsupported figure must read `not available` rather than carry an unattributable value. Owner surface: `spur history analyze` fold contracts and `spur history report --mode forensics`. Recurrence basis: two independent fold families in the same artifact, plus the contract anchor at `/Users/robin/.agents/skills/sp-history-anatomy/references/report-contract.md` (Evidence rules, item 3).
6. **Keep the pairing fold as the cost-attribution path, and widen it rather than replace it.** Pairings are the only place a stage is named next to its duration, and they already carry duration for 14 of 14 dispatches even where cost and model are missing. Widening the fold to populate `totalCostUsd` and `model` for every pairing and to name each pairing's dispatch set would answer the question this window cannot. Owner surface: the pairing analytics fold. Recurrence basis: the baseline artifact carries the same fold with the same mix of costed and uncosted rows and the same null `model` column.
7. **Exclude the analysis's own session from the window.** Generation began 10.9 s after a session that then contributed the artifact's entire `unknown` model bucket with zero usage (F10). Small in magnitude, but it makes same-day re-runs non-reproducible and it puts 22 unattributable records into a report about attribution. Owner surface: the daily workflow's window selection. Recurrence basis: not observable in the baseline window, whose generating instant falls outside the day it measures; recorded here as a single-window observation with an evidentiary anchor rather than a repeated class.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | Sequence range | Note |
| --- | --- | ---: | --- | --- |
| `bash` · `31758b15241b09aa2c65503fc86fd38179337a995827c88acb1fab46c4422e8e` | pi · `2026-10-28T11-30-04-779Z_01a18246-4169-774f-8c85-4bfabe0e46d3` | 3 | firstSeq 39 → lastSeq 51 | The window's only loop signal (`#/population/loops` 1), first seen at `2026-10-28T11:51:01.782Z` on model `deepseek-v4-1-flash-261017`, inside the session that also holds 74.65% of the pi lane's assistant duration (F1) and whose step at that timestamp is a 104.6 s row in `#/topStepsByDuration`. The identical argument digest repeats three times within 13 sequence steps; the digest does not reveal which command, so the likely intent (a poll or a retry) cannot be confirmed from this evidence plane. |

The artifact exposes repetition only through the loop fold, which reports signatures that repeat at least 3 times (`#/population/loops` = 1 here, 1 in the baseline). Repeat counts below that threshold are `not available` from this evidence plane, and the 61 pi tool calls plus 105 claude tool calls are not individually inspectable for repetition. A repeated identical signature may be a legitimate poll-for-background-work pattern, so the decision — leave it, change the wait strategy, or add a bounded timeout — stays with the operator. No signature here is proposed as a trigger for any automated behaviour.

## Positive patterns

Held to the same evidence standard as the problems above: observation, inference, and at least one anchor each.

### P1 — the pi lane is fully instrumented on every axis

- `key`: `positive:spur-history-import:pi-complete-measurement-axis`
- `category`: `positive`
- `impact`: Every quantitative claim about latency, tokens, cache behaviour and tool time in this window can be made against at least one lane with a complete denominator. That is what makes F1's 16.8× per-step comparison defensible rather than a guess, and it is the pattern the claude lane should be brought up to (F2).
- `trend`: `not-comparable`
- `observation`: `#/stepSupport/1` reports pi `assistantSteps` 65, `stepsWithUsage` 65, `stepsWithDuration` 65, `stepsWithDerivedDuration` 65, `stepsWithCacheRead` 65 — every step carries usage, a duration and a cache-read figure, with no derived-duration substitution and no gaps. All 4 pi sessions in `#/bySession` carry `sessionState` `complete`. All 4 pi-lane `#/byTool` rows (`bash`, `edit`, `read`, `write`) report `durationUnmeasured` 0 with measured totals of 2,049 / 24 / 17 / 6 ms.
- `inference`: A source whose step count, usage count, duration count and cache-read count are all identical is emitting a complete measurement record per step, so pi's aggregates are measurable rather than inferred. Named observations: the five equal counts in `#/stepSupport/1`, the 4-of-4 `complete` session states, and the 0 unmeasured calls across the pi tool rows.
- `contradictions`: pi's completeness is not matched by richness — `resultBytes` is 0 on all four of its tool rows and `model` is `null` on its pairing rows, so complete coverage of the timing axis coexists with missing context-volume and pairing identity (F6, F3). Its usage coverage is also counted on a different denominator from claude's: 65 of 156 `records` but 65 of 65 assistant steps.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/stepSupport/1`, `#/bySession` (source `pi`), `#/byTool`
- `severity`: P3
- `reproCommand`: `jq -c '.stepSupport[1], [.byTool[]|select(.toolName|IN("bash","edit","read","write"))|{t:.toolName,u:.durationUnmeasured,ms:.durationMsTotal}], [.bySession[]|select(.source=="pi")|.sessionState]' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pi source lane, as the reference implementation the claude lane should match.

### P2 — cache reuse is high and no step met the re-send waste filter

- `key`: `positive:spur-history-analyze:cache-reuse-healthy`
- `category`: `positive`
- `impact`: 95.64% of the window's 16,008,508 billed input tokens were served from cache, so the dominant input-cost term is already near its floor for these context sizes. This is the reason the window's spend is only `$2.449029` despite 16.0M billed input tokens, and it means cache work is not a priority relative to the latency finding.
- `trend`: `not-comparable`
- `observation`: `#/totals/cacheReadTokens` `15,311,240` against `#/totals/inputTokens` `16,008,508` — 95.64%, with fresh input of `193,714` and cache-write of `503,554`. By source: claude `9,529,352` of `10,033,116` (94.98%), pi `5,781,888` of `5,975,392` (96.76%). `#/cacheWaste` reports `steps` 0, `inputTokens` 0, `topSteps` `[]` — no assistant step had input above 100,000 tokens with cache reuse below 10%.
- `inference`: Both the aggregate ratio and the waste filter agree that context re-sends wasted nothing measurable this window: a high cache-read share and an empty waste list are two independent signals pointing the same way, and the per-source ratios show the behaviour holds in both lanes rather than in one. Named observations: the per-source and total cache-read ratios, and the empty `#/cacheWaste`.
- `contradictions`: The cache-waste filter is narrow (input > 100,000 with < 10% reuse) and therefore cannot see the duplicate-usage pattern in F4, which is repeated cost without being a cache miss; and cache reuse is a ratio, not a cost statement — the claude lane still carries 75.73% of spend at 94.98% reuse because its absolute input volume and its cache-write volume are larger.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/cacheWaste`
- `severity`: P3
- `reproCommand`: `jq -c '{tot:(.totals.cacheReadTokens/.totals.inputTokens),fresh:(.totals.inputTokens-.totals.cacheReadTokens-.totals.cacheWriteTokens),bySource:(.bySource|to_entries|map({s:.key,r:(.value.cacheReadTokens/.value.inputTokens)})),waste:.cacheWaste}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: the executor pairing configuration — the prompt-cache settings currently in force across both lanes.

### P3 — 166 tool calls and 9 imported files produced no errors

- `key`: `positive:spur-history-import:clean-import-and-tool-runs`
- `category`: `positive`
- `impact`: The evidence plane itself is trustworthy on its error axis: no tool call failed and no record was rejected, so the gaps found in this report are all measurement-coverage gaps rather than import corruption. Nothing in the report needs a caveat about lost or malformed data.
- `trend`: `not-comparable`
- `observation`: `#/byTool[].errors` is 0 for all 12 tool keys, summing over 166 calls. `#/coverage` reports `parseErrors` 0, `validationErrors` 0, `unknownRecords` 0, `parseErrorSamples` `[]` and `validationErrorSamples` `[]` for both sources — 5 claude files and 4 pi files. `#/totals/toolCalls` is 166 and `#/amissing` is absent from the artifact; `#/totals/messages` is 771.
- `inference`: Zero errors across every tool key plus zero parse, validation and unknown counts across all 9 files means the importers read this window's corpus without loss or rejection, so the artifact's content is complete relative to what the sources recorded. Named observations: the all-zero `errors` column and the all-zero error counters in `#/coverage`.
- `contradictions`: A clean error axis says nothing about coverage: the same `#/coverage` rows report `ok` while the claude lane carries 105 untimed tool calls (F2) and 510 of its 615 records carry no usage, and `#/coverage` and `#/totals` disagree on the message count (F7), so "no errors" must not be read as "fully measured".
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`
- `severity`: P3
- `reproCommand`: `jq -c '{toolErrors:([.byTool[].errors]|add),calls:([.byTool[].calls]|add),coverage:[.coverage[]|{s:.source,f:.files,p:.parseErrors,v:.validationErrors,u:.unknownRecords}]}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — both source lanes and their validation path.

### P4 — 13 of 14 chained agent.run dispatches succeeded with no unknown outcomes

- `key`: `positive:spur-history-analyze:pairing-dispatch-reliability`
- `category`: `positive`
- `impact`: Chained delegation worked this window: 14 dispatches across three pairings, 13 successes, 1 failure, and no unknown outcome anywhere — so the orchestration path itself is not a source of unaccounted work. Combined with P3 it means the window has no unexplained failures on either the tool or the dispatch axis.
- `trend`: `not-comparable`
- `observation`: `#/pairings` reports `claude`/`reviewer` 5 dispatches `successRate` 1 with `failures` 0; `pi-dsv4.1-flash-volc`/`reviewer` 4 dispatches `successRate` 0.75 with `failures` 1; `pi-dsv4.1-flash-volc`/`scribe` 5 dispatches `successRate` 1 with `failures` 0. `unknownOutcomes` is 0 on all three rows and `escalations` is `{}` on all three.
- `inference`: Dispatches total 14 with 1 recorded failure and 0 unknown outcomes, which means every dispatch reached a terminal and classified state — a success rate computed on this fold is measured rather than assumed. Named observations: the three per-pairing dispatch and success counts, and the zero `unknownOutcomes`/`escalations` across all rows.
- `contradictions`: The single failure sits in the pairing with the smallest sample (4 dispatches) and the slowest mean (`pi-dsv4.1-flash-volc` reviewer, 1,458,293.54 ms), the same lane as the F1 latency concentration, so reliability and latency are not independent of each other here; and cost is known for only 1 of 3 pairings (F3), so "no unaccounted failures" does not extend to "no unaccounted cost".
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/pairings`
- `severity`: P3
- `reproCommand`: `jq -c '{dispatches:([.pairings[].dispatches]|add),failures:([.pairings[].failures]|add),unknown:([.pairings[].unknownOutcomes]|add),rows:[.pairings[]|{e:.executor,r:.role,d:.dispatches,s:.successRate,f:.failures}]}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: the `agent.run` dispatch path and the pairing analytics fold in `spur history analyze`.

### P5 — both sources were imported within five seconds of artifact generation

- `key`: `positive:spur-history-import:import-freshness-at-generation`
- `category`: `positive`
- `impact`: The current artifact describes the corpus as it stood 2.23 s and 4.09 s before the artifact was built, so nothing in this report is stale relative to the importer. That is what allows the findings above to be attributed to the window rather than to a lagging import, and it is the regime the baseline artifact's own rows do not share.
- `trend`: `not-comparable`
- `observation`: `#/coverage[0]` (claude) `lastImportedAt` `2026-10-28T15:30:10.932Z` and `#/coverage[1]` (pi) `2026-10-28T15:30:09.075Z`, against `#/generatedAt` `2026-10-28T15:30:13.161Z` — 2.23 s and 4.09 s before generation. Both rows report `status` `ok` with 0 parse and 0 validation errors.
- `inference`: Import timestamps that precede generation by single-digit seconds indicate the import ran as part of the same pipeline invocation rather than being reused from an earlier run, which is consistent with `cacheDisposition` `miss`. Named observations: the two sub-five-second gaps and the miss disposition.
- `contradictions`: Freshness is not completeness — the import was current in time while the claude lane still carried 105 untimed tool calls and 510 usage-less records (F2), and it covers only two sources, so a third agent CLI's work today would be invisible to this artifact.
- `evidenceAnchor`: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/coverage`, `#/generatedAt`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-provenance.json` — `cacheDisposition`
- `severity`: P3
- `reproCommand`: `jq -c '{gen:.generatedAt,imports:[.coverage[]|{s:.source,at:.lastImportedAt,st:.status}]}' .spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pipeline's import step and its ordering relative to `spur history analyze`.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `performance:pi-dsv4-1-flash-executor:per-step-latency` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/bySource/pi`, `#/bySource/claude`, `#/stepSupport`, `#/topStepsByDuration`, `#/bySession`, `#/byModel`, `#/derived/bottlenecks` |
| `telemetry:spur-history-import:claude-tool-duration-unmeasured` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byTool`, `#/bySession`, `#/stepSupport/0`, `#/bySource/claude`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:120` |
| `telemetry:spur-history-analyze:pairing-cost-not-reconciled` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`, `#/bySource`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/pairings`, `#/totals/costUsd` |
| `telemetry:spur-history-import:duplicate-usage-records` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/topStepsByTokens`, `#/stepSupport/0`, `#/cacheWaste`, `#/bySource/claude`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/topStepsByTokens` |
| `coverage:spur-task-check:verified-outcome-absent` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/verifiedOutcome` |
| `telemetry:spur-history-analyze:tool-identity-fragmentation` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/population/tools`, `#/byModel` |
| `telemetry:spur-history-import:coverage-message-count-disagreement` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/coverage/0`, `#/bySource/claude`, `#/totals/messages`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` — `#/coverage/0`, `#/bySource/claude`, `#/totals/messages` |
| `telemetry:spur-history-analyze:phase-support-empty` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/derived/phases`, `#/byTool`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:65` |
| `workflow:spur-history-report:render-title-corrupted` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.md:4`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.md:4` |
| `workflow:history-anatomy:window-includes-generating-session` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/bySession` (sessionId `14c92a0b-966f-47a3-921e-45dd755ab99a`), `#/byModel/unknown`, `#/generatedAt`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-provenance.json` — `generatedAt` |
| `positive:spur-history-import:pi-complete-measurement-axis` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/stepSupport/1`, `#/bySession` (source `pi`), `#/byTool` |
| `positive:spur-history-analyze:cache-reuse-healthy` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/cacheWaste` |
| `positive:spur-history-import:clean-import-and-tool-runs` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals` |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/pairings` |
| `positive:spur-history-import:import-freshness-at-generation` | `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-current.json` — `#/coverage`, `#/generatedAt`; `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-provenance.json` — `cacheDisposition` |

Baseline artifacts cited in section 3 and section 5: `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`, `#/totals`) and `.spur/run/10c08862-f985-4f19-a00a-d82113facb75-history-anatomy-baseline.md:4`.

Two limitations of this report's own evidence, stated rather than masked: the current window is provisional, so every current-window figure is a partial-day fact; and no comparison against `2026-10-27` is stated anywhere, because that baseline was found `not comparable` on four independent axes in section 3.

