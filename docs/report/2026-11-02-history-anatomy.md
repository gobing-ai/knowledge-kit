---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-11-02"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-11-02T00:00:00.000-08:00
    until: 2026-11-02T23:59:59.999-08:00
  sources:
    - source: codex
    - source: pi
windowState: "provisional"
generatedAt: "2026-11-02T15:35:10.815Z"
validatedAt: "2026-11-02T15:35:10.815Z"
artifactDigest: "896f46c673ee1ab18bf2d0897417eab7da44d0f65cc205eb77080d81d9467033"
baselineArtifactDigest: "54ff48fa2e0f7335354038633cc6b06c3042112ea7527ecce204f083c8d38897"
contractDigest: "34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5"
skillDigest: "bcd34064fb82e1d397715b1b6dcca8b68bd410f0761ddc3c529a9d49b2e1c5c1"
workflowDigest: "not available"
helperDigest: "aaa943a65b9f2462adc06f4f7e80bf1a505cab698f3195bb4326f1314a3f34e7"
runId: "688106fd-5d88-4505-ad30-f535b69fff9d"
currentArtifactPath: ".spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json"
spurVersion: "not available"
schemaVersion: 1
executor: "coder"
model: "not available"
cacheDisposition: "miss"
coverage:
  - source: codex, status: ok, lastImportedAt: 2026-11-02T15:35:07.014Z
  - source: pi, status: ok, lastImportedAt: 2026-11-02T05:00:01.098Z
---

> imported snapshot as of 2026-11-02T05:00:01.098Z · window provisional · cache miss

<!-- Candidate authored by sp:history-anatomy enrich · mode daily · run 688106fd-5d88-4505-ad30-f535b69fff9d · schema v1 -->

# History forensics report — 2026-11-02 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `688106fd`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-11-02`, baseline is the immediately preceding local calendar day `2026-11-01` |
| Current window | `2026-11-02T00:00:00.000-08:00` → `2026-11-02T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Baseline window | `2026-11-01T00:00:00.000-07:00` → `2026-11-01T23:59:59.999-08:00` (America/Los_Angeles, 25.0 h — the DST fall-back day) |
| Window state | `provisional` for both artifacts — generation happened `2026-11-02T15:35:09.876Z` (07:35:09 local), 7.59 h into the local day it measures, with bounds running to `23:59:59.999`; no artifact was marked closed. Read from `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-provenance.json` |
| Generated | `2026-11-02T15:35:09.876Z` (current) · `2026-11-02T15:35:10.256Z` (baseline) |
| Toolchain | spur `0.4.21` (artifact `#/spurVersion`) · artifact `schemaVersion` `1` · executor `coder`, model `not available` · contract version `1` |
| Digests | artifact `896f46c673ee1ab18bf2d0897417eab7da44d0f65cc205eb77080d81d9467033` · baseline artifact `54ff48fa2e0f7335354038633cc6b06c3042112ea7527ecce204f083c8d38897` · contract `34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5` · skill `bcd34064fb82e1d397715b1b6dcca8b68bd410f0761ddc3c529a9d49b2e1c5c1` · helper `aaa943a65b9f2462adc06f4f7e80bf1a505cab698f3195bb4326f1314a3f34e7` · workflow `not available`. Read from `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-provenance.json` |
| Selector | sources `all`, no session/run/task narrowing, leaderboard depth `20` (`#/population/appliedTop`) |
| Cache disposition | `miss` — disposition `no-cache`, so the run recomputed |
| Current artifact | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.md` |
| Path resolution | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-paths.txt` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| codex | ok | 27 | 10,993 | 1,451 | 0 | 0 | 0 | `2026-11-02T15:35:07.014Z` |
| pi | ok | 2 | 81 | 21 | 0 | 0 | 0 | `2026-11-02T05:00:01.098Z` |

Population: `29` sessions, `13` tool keys, `3` loop signals, `1` warning, leaderboard depth applied `20` (`#/population`). The session count exceeds the applied depth, so `#/bySession` is a bounded slice of 20 of 29 — the rendered summary states exactly that (`Sessions | top 20 of 29`). Those 20 rows hold 10,711 of the 11,074 messages (96.72%) and `$204.056329` of `$205.655846` (99.22%) of window cost, leaving 9 unlisted sessions carrying `$1.599517` and 363 messages that are inside `#/totals` but outside `#/bySession`. The tool and loop enumerations are complete (`13` and `3`, both below 20). The step leaderboards (`#/topStepsByTokens`, `#/topStepsByDuration`) hold 20 rows each and are slices of the `1,911` assistant steps in `#/stepSupport` (codex 1,888 + pi 23), not population totals.

Import freshness differs by lane: codex was imported 2.86 s before generation while pi's recorded import precedes generation by 10.59 h (`#/coverage`). The pi lane carries 81 of 11,074 messages (0.73%), so the staleness is small in magnitude but it means pi activity between `2026-11-02T05:00:01.098Z` and generation is only present if a later import ran without updating the checkpoint field.

## Executive summary

- The measured current window is 29 sessions (top 20 listed), 11,074 messages, 1,472 tool calls, a 5.26 h activity span, `$205.655846` of provider-billed cost, and 376,185,532 billed input tokens with a 49.58% cache-read share. Two sources imported (`codex`, `pi`) with zero parse and zero validation errors.
- The dominant defect is measurement, not workload: 1,451 of 1,472 tool calls (98.57%) carry no duration — every codex call is untimed and every pi call is timed — so the tool axis covers 21 calls (1.43%) and `17,962,970` ms (4.99 h, 94.93% of the span) lands in the unattributed bucket, exactly as `#/warnings/0` states. The 5.26 h span is therefore mostly unmeasured time, and no tool-latency claim about the dominant lane is supportable.
- The second telemetry defect sits underneath it: codex's 1,888 assistant steps total 14,398 ms of assistant duration — 7.63 ms per step, with 420k-input-token steps recorded at 2–5 ms — while the pi lane in the same artifact shows 2,690 ms per step. The `llmMs` bucket (76,267 ms) is arithmetically correct and reconciles to its source rows, but it is not a usable latency measure for the lane that produced 99.53% of billed input.
- Cost and volume are concentrated in one lane and one session: codex carries `$205.313291` of `$205.655846` (99.83%) and 99.53% of billed input at 49.39% cache reuse, against pi's 88.98% reuse and `$0.1937` per 1M billed input versus codex's `$0.5484`. The single largest session (`01a199f9-94e0-7eb0-95d5-7ad22ce637a6`) holds `$75.697571` (36.81%); the top two hold 61.25%.
- Chained delegation is clean on the axis it records: 19 `agent.run` dispatches across 2 pairings, `successRate` 1.0 on both, 0 failures, 0 unknown outcomes, 0 escalations — but per-pairing cost is `not available` on both rows, so no stage cost is reportable this window.
- The outcome axis is empty again: `taskDenominator` 0, `verifiedResults` 0, every `excludedReasons` bucket 0, `costCoverage` `{covered: 0, total: 0}`. Cost per verified result cannot be computed for a window that cost `$205.655846`.
- Three further defects are recorded below: the phase fold reports `supported` with an empty phase list (F6), the pairing fold prices 0 of 19 dispatches while the baseline fold priced 2 of 3 (F5), and both rendered artifacts open with a duplicated title inside an unclosed code fence (F7).
- Baseline comparison verdict: **not comparable**. Five independent differences block it, including a 25-hour baseline window against a 24-hour current window (the `2026-11-01` DST fall-back day) and entirely different source sets. No trend, delta, or percentage is stated against the baseline anywhere in this report, and every finding is classified `not-comparable`.
- The workflow half is healthy where it is measured: zero tool errors across 1,472 calls, zero parse/validation/unknown records across 29 files, `llmMs` reconciling exactly to per-source rows, the four time buckets summing exactly to the span, and `#/coverage` totals matching `#/totals` to the record.

## Baseline comparison

**Verdict: `not comparable`.** No trend, no delta, and no percentage is stated against the baseline anywhere in this report. Five independent differences block comparability; each is stated as its own artifact's value rather than as a computed change.

1. **Window duration is not equal.** The current window spans `86,400,000` ms (24.0 h) from `00:00:00.000-08:00`. The baseline window spans `90,000,000` ms (25.0 h) because `2026-11-01` is the local DST fall-back day: its bounds run from `00:00:00.000-07:00` to `23:59:59.999-08:00` (`HA_BASELINE_SINCE`/`HA_BASELINE_UNTIL` in `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-paths.txt:7-8`). Two windows of 24 h and 25 h are not equal-duration, so a per-hour rate computed across the pair would divide by different denominators. The daily rule pairs adjacent calendar days; on a DST transition those days are not equal-duration, and neither artifact records the asymmetry.
2. **Window symmetry.** Both provenance records carry `windowState: provisional`. The current window was generated 7.59 h into the 24 h it measures (31.6% elapsed, 68.4% still to run). The baseline's window had fully elapsed in wall-clock terms by generation time, yet its artifact was never marked closed, so "closed day" cannot be asserted from the artifact — only from arithmetic on its bounds.
3. **Source-set coverage.** The current window covers `codex` (27 files, 10,993 messages) and `pi` (2 files, 81 messages). The baseline covers `claude` (2 files, 42 messages, 0 tool calls) and `pi` (5 files, 230 messages, 98 tool calls). No codex figure has a baseline counterpart; the baseline's claude lane has no tool-call counterpart. The only overlapping source is pi (81 messages here, 230 in the baseline), so the source-set blocker alone rules out any aggregate-level pairing.
4. **Instrumentation regime.** The current artifact leaves 1,451 of 1,472 tool calls without a duration (98.57%), so its tool axis is measured over 1.43% of calls. The baseline artifact leaves 0 of 98 unmeasured (`#/totals/durationUnmeasured` 0), so its tool axis is complete. The same statistic therefore describes 21 calls in one artifact and 98 in the other, and any tool-time or unattributed-share comparison would compare a partial measurement to a complete one.
5. **Import regime and leaderboard composition.** The baseline's recorded imports precede its own generation by 24.67 h (claude) and 23.67 h (pi), and precede the end of the window it measures by 16.08 h; the current imports precede generation by 2.86 s (codex) and 10.59 h (pi). The current `#/bySession` is a truncated 20 of 29 sessions; the baseline lists all 7 (7 ≤ the applied depth of 20). Two per-session distributions with different truncation and different composition are not the same statistic. The dominant model also differs (`gpt-6.1-sol` here, `deepseek-v4-1-flash-261017` there), so cost-per-token is not a like-for-like comparison either.

Per-axis current values, stated as separate facts only:

| Axis | Current artifact | Baseline artifact | Compared? |
| --- | --- | --- | --- |
| Window duration | 24.0 h (`-08:00` both bounds) | 25.0 h (`-07:00` → `-08:00`, DST fall-back) | no |
| Window state | `provisional`, 31.6% elapsed | `provisional`, window elapsed | no |
| Sources | `codex`, `pi` | `claude`, `pi` | no — different source sets |
| Sessions | 29 (top 20 listed, 96.72% of messages) | 7 (all listed) | no |
| Messages (`#/totals`) | 11,074 | 272 | no |
| Tool calls | 1,472 | 98 | no |
| Instrumented tool calls | 21 of 1,472 (1.43%) | 98 of 98 (100%) | no |
| Assistant duration | 76,267 ms over 1,551 timed codex steps + 23 pi steps of 1,911 | 8,478,039 ms over 99 timed steps of 99 | no |
| Span | 18,922,469 ms (5.26 h) | 8,531,669 ms (2.37 h) | no |
| Cost | `$205.655846` | `$0.973498` | no |
| Cache-read tokens | 186,495,552 of 376,185,532 billed input (49.58%) | 8,255,232 of 8,552,205 (96.53%) | no |
| Loop signals | 3 (repeats 5, 4, 3) | 0 | no |
| Pairing cost coverage | 0 of 2 rows costed (19 dispatches) | 2 of 3 rows costed (9 dispatches) | no |
| Verified outcomes | denominator 0, all rates `null` | denominator 0, all rates `null` | no |

The one same-shape observation both artifacts support — reported as "present in both", never as a change — is the class of structural gaps: the phase fold is `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}` in both, the outcome fold is all-zero in both, the render header is corrupted in both, and per-pairing cost is `not available` on at least one row in both. Those are recorded per finding in section 5 as `not-comparable` with a discrete-presence note, not as trends.

## Findings

Seven problem findings, ordered P1 first, then P2, then P3. Every field set is complete; `trend` is `not-comparable` for all of them because the baseline was found `not comparable` in section 3. All commands are reproducible verbatim from the repository root and none was run by this report.

### F1 — 98.57% of tool calls carry no duration, and the unattributed bucket is 94.93% of the span

- `key`: `telemetry:spur-history-import:codex-tool-duration-unmeasured`
- `category`: `telemetry`
- `impact`: The tool axis is measured for 21 of 1,472 calls (1.43%). Every codex call — 1,451 of them, 98.57% of the window — contributes no duration, so `#/derived/timeDecomposition/toolMs` (`54,774` ms) describes pi's 21 calls while presenting itself as a window total, and `17,962,970` ms (4.99 h, 94.93% of the 5.26 h span) falls into `unattributedMs`. Tool-time regressions in the lane that produced 99.83% of window cost are invisible to this report, and the bottleneck ranking's first row is an instrumentation residual rather than a workload term.
- `trend`: `not-comparable`
- `observation`: `#/totals/durationUnmeasured` is `1,451` against `#/totals/toolCalls` `1,472`; the instrumented remainder is exactly pi's `21` calls (`ask_user_question` 1, `bash` 14, `read` 5, `edit` 1), and `#/bySource/codex` reports `toolCalls` 1,451 with `durationMs` 0 and `durationUnmeasured` 1,451. `#/byTool` `exec` reports `calls` 1,338 with `durationMsTotal` 0 and `durationUnmeasured` 1,338; the other eight codex keys (`send_message` 40, `followup_task` 24, `spawn_agent` 20, `wait_agent` 10, `request_user_input_async` 10, `list_agents` 6, `sleep` 2, `wait` 1) sum to the rest. `#/warnings/0` states `17962970ms` could not be attributed to llm/tool/idle because some durations were unmeasured, and the render prints that residual as `Unattributed (unmeasured durations) | 5.0h | 95%` (`.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:57`).
- `inference`: Two independent signals agree that the gap is field emission in the codex adapter rather than missing import volume. First, the per-call counter closes arithmetically: 1,451 unmeasured = 1,472 total − 21 timed, and the 21 timed calls are exactly the pi lane. Second, the artifact's own warning attributes 17,962,970 ms to unmeasured durations, and that figure equals `spanMs` minus the three measured buckets. Named observations: the 1,451-of-1,472 counter, the exact pi-only set of timed calls, the all-zero `durationMsTotal` on every codex `#/byTool` row, and the warning's 17,962,970 ms residual.
- `contradictions`: `#/coverage[0]` reports codex `status` `ok` with 27 files, 10,993 messages and 0 parse/validation errors, so the import surface declares clean success while the lane emits no per-call timing. The lane is not wholly untimed: `#/bySource/codex/assistantDurationMs` is non-zero (14,398 ms), so some duration field is populated. Some of the untimed keys are inherently wait-shaped rather than work-shaped (`wait`, `sleep`, `wait_agent`, `send_message`), so a zero may be semantically defensible for them — but `exec`'s 1,338 calls are not in that category, and they are the bulk of the gap.
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/totals`, `#/bySource/codex`, `#/byTool`, `#/warnings/0`, `#/derived/timeDecomposition`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:57`
- `severity`: `P1`
- `reproCommand`: `jq -c '{calls:.totals.toolCalls,unmeasured:.totals.durationUnmeasured,timed:([.byTool[]|select(.durationUnmeasured==0)|.calls]|add),unmeasuredByTool:([.byTool[].durationUnmeasured]|add),codex:{calls:.bySource.codex.toolCalls,ms:.bySource.codex.durationMs,u:.bySource.codex.durationUnmeasured},unattributed:.derived.timeDecomposition.unattributedMs,span:.derived.timeDecomposition.spanMs}' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the codex source lane's per-tool-call duration emission, consumed by the `byTool` and `timeDecomposition` folds in `spur history analyze`.

### F2 — codex assistant durations are millisecond-scale on 420k-token steps, so the llm bucket is not a latency measure

- `key`: `telemetry:spur-history-import:codex-assistant-duration-implausible`
- `category`: `telemetry`
- `impact`: The `llmMs` bucket (`76,267` ms, 0.40% of span) is presented as LLM latency, but the lane that produced 99.53% of billed input contributes only `14,398` ms across 1,888 assistant steps — 7.63 ms per step. A per-turn round trip on 400k+ input tokens does not complete in single-digit milliseconds, so latency, tokens-per-second and per-step throughput cannot be stated for the dominant lane, and the residual time is absorbed by the same 94.93% unattributed bucket that F1 measures.
- `trend`: `not-comparable`
- `observation`: `#/bySource/codex` reports `assistantDurationMs` `14,398` with `assistantDurationUnmeasured` `337`; `#/stepSupport[0]` reports codex `assistantSteps` 1,888, `stepsWithUsage` 1,178, `stepsWithDuration` 1,551, `stepsWithDerivedDuration` 1,551, `stepsWithCacheRead` 1,178. `#/topStepsByTokens` codex rows include `425,058` input / `424,832` cache read / `323` output at `3` ms, `424,961` / `424,704` / `40` at `3` ms, and `422,977` / `422,528` / `822` at `4` ms. In the same artifact, `#/bySource/pi` reports `assistantDurationMs` `61,869` over 23 steps, i.e. `2,690.0` ms per step. The render excludes `337` assistant steps from its duration leaderboard for missing measurement (`.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:122`).
- `inference`: Two independent signals say the codex duration series is derived on a scale that cannot represent provider latency. First, the concrete step rows: 400k-token prompts recorded at 2–5 ms, which is below any plausible round trip and consistent with a timestamp-delta derivation between adjacent records rather than a request/response measurement. Second, the cross-lane comparison within one artifact: 7.63 ms per codex step against 2,690.0 ms per pi step — a 352× difference recorded by the same analyzer in the same window. Named observations: the three cited step rows, the 7.63-versus-2,690 ms per-step gap, and the 337 steps with no duration at all.
- `contradictions`: Both lanes are flagged `stepsWithDerivedDuration` equal to `stepsWithDuration` (codex 1,551 of 1,551, pi 23 of 23), so the derivation flag does not itself distinguish the two scales — the difference is in the input timestamp semantics per adapter, not in whether derivation was used. Durations are also genuinely absent for 337 codex steps, so part of the series is missing rather than merely wrong. A fast lane is not impossible in principle (cached prefixes, small outputs), which is why the causal claim is held to the two-scale observation plus the implausible absolute values, and the confirmation path is to compare one codex step's recorded duration against the request/response timestamps in the raw session record for that step.
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/bySource/codex`, `#/bySource/pi`, `#/stepSupport`, `#/topStepsByTokens`, `#/derived/timeDecomposition`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:122`
- `severity`: `P2`
- `reproCommand`: `jq -c '{codex:{steps:.stepSupport[0].assistantSteps,timed:.stepSupport[0].stepsWithDuration,ms:.bySource.codex.assistantDurationMs,perStep:(.bySource.codex.assistantDurationMs/.stepSupport[0].assistantSteps)},pi:{steps:.stepSupport[1].assistantSteps,ms:.bySource.pi.assistantDurationMs,perStep:(.bySource.pi.assistantDurationMs/.stepSupport[1].assistantSteps)},topCodex:[.topStepsByTokens[]|select(.source=="codex")|{it:.inputTokens,cr:.cacheReadTokens,ot:.outputTokens,ms:.durationMs}][0:3]}' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the codex assistant-step duration derivation, consumed by the `stepSupport` and `timeDecomposition` folds in `spur history analyze`.

### F3 — the dominant lane bills 374M input tokens at 49.39% cache reuse

- `key`: `performance:codex-sol-executor:cache-reuse-under-half`
- `category`: `performance`
- `impact`: codex bills `374,416,896` input tokens — 99.53% of the window's billed input — at 49.39% cache reuse, so roughly 189.5M tokens are fresh input at `$1.0842` per 1M fresh input. Its `$205.313291` is 99.83% of the `$205.655846` window cost, at `$0.5484` per 1M billed input against pi's `$0.1937` (2.83×). Each percentage point of codex cache reuse corresponds to about 3.74M fewer fresh input tokens, so reuse is the one input-cost lever with material size in this window.
- `trend`: `not-comparable`
- `observation`: `#/bySource/codex` reports `inputTokens` `374,416,896`, `cacheReadTokens` `184,921,856` (49.39%), `cacheWriteTokens` 0, `outputTokens` `566,434`, `costUsd` `205.313291`. `#/bySource/pi` reports `inputTokens` `1,768,636`, `cacheReadTokens` `1,573,696` (88.98%), `outputTokens` `29,523`, `costUsd` `0.342555`. `#/totals` reports billed input `376,185,532` (fresh `189,689,980`, cache-read `186,495,552`, cache-write 0) and cache-hit ratio 49.58%. `#/cacheWaste` reports `steps` 1, `inputTokens` `281,869`, one `topSteps` row (session `01a199f9-94e0-7eb0-95d5-7ad22ce637a6`, `inputTokens` 281,869, `cacheReadTokens` 0, 0.0% reuse, `costUsd` `null`, `durationMs` 5).
- `inference`: Two independent signals point at prefix reuse rather than at volume alone. First, the per-source reuse differential is large and consistent: 49.39% on the lane carrying 99.53% of input against 88.98% on the small lane. Second, the waste detector independently found a single step with 281,869 fresh input tokens at 0% reuse, which is the signature of a cold prefix. Named observations: the per-source reuse ratios, the fresh-input total of 189,689,980, and the one 0%-reuse 281,869-token step. That session churn or prompt-prefix instability causes it is a hypothesis; the confirmation path is to inspect the cache-read trajectory within session `01a199f9` and compare the prompt prefix of the flagged step with its predecessor.
- `contradictions`: Cost per token is not a pure reuse function — the two lanes run different models (`gpt-6.1-sol` against `glm-5.3-flash`), so the 2.83× unit-cost gap cannot be attributed to reuse alone. Low reuse is also plausible for structural reasons in this window: 20 `spawn_agent` and 40 `send_message` calls mean many fresh sub-agent contexts, and a new context starts cold by construction, which competes with the prefix-instability explanation. `cacheWriteTokens` is 0 on every row of both artifacts, so whether cache writes are genuinely absent or simply unreported cannot be determined here, which weakens any precise reuse-efficiency arithmetic.
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/bySource`, `#/totals`, `#/cacheWaste`, `#/byTool`
- `severity`: `P2`
- `reproCommand`: `jq -c '{totals:{in:.totals.inputTokens,cache:.totals.cacheReadTokens,fresh:(.totals.inputTokens-.totals.cacheReadTokens),cost:.totals.costUsd},bySource:(.bySource|to_entries|map({s:.key,reuse:(.value.cacheReadTokens/.value.inputTokens),costPerM:(.value.costUsd/(.value.inputTokens/1000000))})),waste:.cacheWaste}' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: the executor ladder entry `codex-sol` (`#/ladderSnapshot`, order 20, tier `capable-2`) and the prompt-cache behaviour of its dispatch path.

### F4 — no task entered the verified-outcome fold, so the value axis is empty

- `key`: `coverage:spur-task-check:verified-outcome-absent`
- `category`: `coverage`
- `impact`: The only dimension that ties agent activity to verified work contributes nothing: `taskDenominator` 0, so `verifiedRate`, `correctionRate`, `timeToVerified` and `measuredTokensPerVerifiedResult` are all `null` and `costCoverage` is `{covered: 0, total: 0}`. The report can describe 5.26 h and `$205.655846` of effort but cannot state that any of it produced a verified result, so cost per verified result — the metric that would rank every other finding by value — is not computable for this window.
- `trend`: `not-comparable`
- `observation`: `#/verifiedOutcome` reports `taskDenominator` 0, `verifiedResults` 0, `verifiedRate` `null`, `verifiedWithoutCorrection` 0, `verifiedWithoutCorrectionRate` `null`, `correctionCount` 0, `correctionRate` `null`, `retryExhaustedCount` 0, `measuredTokensPerVerifiedResult` `null`, `timeToVerified` `{count: 0, meanMs: null, maxMs: null}`, `costCoverage` `{covered: 0, total: 0}`, and every `excludedReasons` bucket 0 (`notDone`, `forcedDone`, `missingVerdict`, `syntheticVerdict`, `verdictNotPass`, `proofAbsent`, `certifyingRunFailed`).
- `inference`: A zero denominator with every exclusion bucket at zero means no task was in scope for the fold at all — a scope gap, not a proof failure, which would instead name a bucket and a reason. Named observations: the zero `taskDenominator`, the all-zero `excludedReasons`, and the zeroed `costCoverage` that follows from both.
- `contradictions`: The window plainly contains task-shaped work — 1,472 tool calls including 1,338 `exec` calls and 11,074 messages — so activity exists that the outcome fold does not see. The artifact records no field explaining why the denominator is 0, so whether tasks were created after the fold's snapshot or are simply not linked to a verdict cannot be determined here. The baseline artifact reports the identical all-zero shape, so this is not a one-off measurement failure in this window.
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`, `#/totals`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` — `#/verifiedOutcome`
- `severity`: `P2`
- `reproCommand`: `jq -c '.verifiedOutcome|{den:.taskDenominator,verified:.verifiedResults,rate:.verifiedRate,excluded:.excludedReasons,cost:.costCoverage,ttv:.timeToVerified}' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: `spur task check` — the verification gate whose PASS proof the `verifiedOutcome` fold reads — together with the fold's task-window join in `spur history analyze`.

### F5 — the pairing fold prices none of this window's 19 dispatches

- `key`: `coverage:pairing-analytics:cost-coverage-absent`
- `category`: `coverage`
- `impact`: The pairing fold is the only place a chained `agent.run` stage is named next to its cost. It records 19 dispatches across 2 pairings with complete duration but `totalCostUsd` `null` on both rows, so per-stage cost is `not available` for every stage — while the baseline artifact's fold priced 2 of its 3 rows. The run-cost rule expects per-pairing cost so chained stages are reportable rather than unknown; here the coverage is zero, which is contract-compliant rendering of an absent signal but still leaves `$205.655846` unattributed to any stage.
- `trend`: `not-comparable`
- `observation`: `#/pairings[0]` (`executor` `codex-sol`, `role` `reviewer`, `agent` `codex`) reports `dispatches` 12, `successRate` 1, `failures` 0, `unknownOutcomes` 0, `escalations` `{}`, `totalCostUsd` `null`, `meanDurationMs` `91,626.78`. `#/pairings[1]` (`codex-sol`, `scribe`) reports `dispatches` 7, `successRate` 1, `failures` 0, `unknownOutcomes` 0, `escalations` `{}`, `totalCostUsd` `null`, `meanDurationMs` `102,499.69`. `model` is `null` on both. Summing non-null `totalCostUsd` gives 0 against `#/totals/costUsd` `205.655846`. The baseline `#/pairings` prices 2 of 3 rows (`pi-dsv4.1-flash-volc` reviewer `$0.510395`, scribe `$1.852412`), leaves `claude` reviewer `null`, and those costed rows sum to `$2.362807` against its own `#/totals/costUsd` of `$0.973498` — exceeding it by `$1.389309` (142.7%).
- `inference`: Duration is present on 19 of 19 dispatches while cost is present on 0 of 19, so the absence is specific to the cost join rather than to the pairing rows themselves. Named observations: the 2-of-2 null `totalCostUsd` with 2-of-2 populated `dispatches`/`meanDurationMs`, the zero sum against a `$205.655846` window total, and the baseline fold's own 2-of-3 coverage which proves the join can populate. That the join keys on a pairing identity the codex lane does not emit is a hypothesis; the confirmation path is to compare the identifying fields of a costed baseline row against a null codex row — both carry `model` `null`, so the join cannot be keyed on model.
- `contradictions`: Both rows are otherwise healthy — `successRate` 1, `failures` 0, `unknownOutcomes` 0, `escalations` `{}` — so nothing here says dispatch accounting is broken. The fold is not fabricating values; `null` renders `not available` per the truthfulness invariant, which is the correct treatment. But the baseline's costed rows exceed its own window total, so the fold has no reconciliation invariant in either artifact: one window has no cost coverage, the other has cost coverage that overshoots its total. Neither direction supports a share-of-window statement.
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` — `#/pairings`, `#/totals/costUsd`
- `severity`: `P3`
- `reproCommand`: `jq -c '{rows:[.pairings[]|{e:.executor,r:.role,d:.dispatches,s:.successRate,f:.failures,c:.totalCostUsd,ms:.meanDurationMs,m:.model}],dispatches:([.pairings[].dispatches]|add),costed:([.pairings[]|select(.totalCostUsd!=null)]|length),costSum:([.pairings[].totalCostUsd|select(.!=null)]|add),dayTotal:.totals.costUsd}' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: the pairing analytics fold's cost and model joins in `spur history analyze`.

### F6 — phase support claims support with zero phases

- `key`: `telemetry:spur-history-analyze:phase-support-empty`
- `category`: `telemetry`
- `impact`: The per-phase breakdown is the only view that would show where a run stalls between planning, implementation and verification. It renders an extraction-empty row under a flag asserting the dimension is available, so a reader is told the data exists and then shown none. That is worse than an explicit gap, because it can be mistaken for "no stalls occurred" — and this window contains a stall worth seeing: 4.99 h of unattributed time in a 5.26 h span.
- `trend`: `not-comparable`
- `observation`: `#/derived/phases` is `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}`. The rendered report's Per-Phase Breakdown table (`.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:62`) contains one row whose first cell states that a task-tracking signal is present while no phases were extracted, and whose three metric cells are empty (`.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:66`).
- `inference`: `phaseSupport: "supported"` describes the presence of a task-tracking signal rather than the successful extraction of phase transitions, and `invalidPhaseCount` 0 is consistent with no extraction having been attempted. Named observations: the `supported` flag, the empty `phases` array, and the renderer's own extraction-empty row.
- `contradictions`: The flag is not false in the narrow sense — a task-tracking signal does exist in the session corpus, and 1,338 `exec` calls plus 11,074 messages are consistent with implementation-phase activity — so the label may be a naming defect in the fold rather than a wrong computation. The baseline artifact reports the identical `{supported, [], 0}` triple, so the label is stable across two artifacts rather than an intermittent glitch.
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/derived/phases`, `#/byTool`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:66`
- `severity`: `P3`
- `reproCommand`: `jq -c '.derived.phases' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `derived.phases` fold and its `phaseSupport` label.

### F7 — both renders open with a duplicated title inside an unclosed code fence

- `key`: `workflow:spur-history-report:render-title-corrupted`
- `category`: `workflow`
- `impact`: Both rendered artifacts open with a broken header — a stray opening fence followed by a self-overlapping title — and the fence is never closed, so all 177 lines of the current render sit inside a code block. Any consumer that parses the markdown header, links the first line, renders the file, or diffs renders across days sees a corrupted and unstable document. Low blast radius, deterministic, and it degrades the artifact operators read directly.
- `trend`: `not-comparable`
- `observation`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:3` is a bare opening fence and `:4` reads `# History forensics report — generated 2026-11-02T15:3# History forensics report — generated 2026-11-02T15:35:09.876Z`; the file contains exactly one fence marker across its 177 lines, so that fence never closes. `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.md:3-4` is corrupted identically with its own timestamp `2026-11-02T15:35:10.256Z`, and holds one fence across 149 lines.
- `inference`: The shared prefix `…T15:3` before the full title indicates the header writer emits the timestamp plus a truncated title and then the complete title — one renderer path, not per-artifact damage, since the same malformation appears in two independently rendered files with only the timestamp differing. Named observations: the identical malformation at line 3–4 of two separately rendered files, the truncated-prefix-then-full-title shape, and the single unclosed fence in each.
- `contradictions`: The artifact JSON is unaffected — `#/generatedAt` is well formed in both — so the defect is confined to the markdown renderer and does not contaminate any computed value in this report. The fence defect and the title defect are two symptoms in one file; whether they share a cause is a hypothesis resting on one signal (their co-location), with the confirmation path being to inspect the renderer's header and footer writers for the fence it emits around the body.
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:4`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.md:4`
- `severity`: `P3`
- `reproCommand`: `sed -n '1,5p' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md; grep -c '^```' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md`
- `ownerSurface`: `spur history report` — the markdown header and fence writer used by `--mode forensics`.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count or impact change is computed or implied. The final column records only whether the same signal class is discretely present in the baseline artifact (an observation about two artifacts, not a measured change) and what a comparable baseline would need.

| Stable key | Recurrence class | Severity now | Discrete baseline presence and what a comparable baseline would need |
| --- | --- | --- | --- |
| `telemetry:spur-history-import:codex-tool-duration-unmeasured` | `not-comparable` | P1 | Absent by construction: the baseline artifact has no `codex` source row at all (`#/coverage` lists `claude` and `pi`), and its tool axis is complete where it exists — `#/totals/durationUnmeasured` 0 over 98 calls, with `durationUnmeasured` 0 on all four of its `#/byTool` rows. The class cannot exist in a window with no codex lane; calling it new would be a classification the baseline cannot support. A comparable baseline needs the same source set and the same instrumentation regime. |
| `telemetry:spur-history-import:codex-assistant-duration-implausible` | `not-comparable` | P2 | The codex lane has no counterpart, but the same signal class is present and plausible at a different scale: the baseline `#/bySource/pi` reports `assistantDurationMs` `8,477,982` over `#/stepSupport/1` `assistantSteps` 97 (`87,402` ms per step), with `stepsWithDerivedDuration` 97 of 97. So derived durations exist in both artifacts, at `9.28` ms per timed codex step here against 87,402 ms per pi step there. A comparable baseline would have to cover the codex lane so the same lane's derivation could be read twice. |
| `performance:codex-sol-executor:cache-reuse-under-half` | `not-comparable` | P2 | Present in kind, not per lane: the baseline `#/bySource/pi` reuse is 96.53% of 8,552,205 billed input and its `#/cacheWaste` is 0 steps, 0 tokens, so no low-reuse lane exists there to compare against. Its `claude` row bills 0 input tokens over 42 messages, so it contributes no reuse figure. Each value is its own artifact's. A comparable baseline needs codex dispatches with cache fields populated. |
| `coverage:spur-task-check:verified-outcome-absent` | `not-comparable` | P2 | Same class present: the baseline `#/verifiedOutcome` also reports `taskDenominator` 0 with every `excludedReasons` bucket 0, `costCoverage` `{covered: 0, total: 0}` and all rates `null`. Present in two artifacts of the same series, not a measured change. |
| `coverage:pairing-analytics:cost-coverage-absent` | `not-comparable` | P3 | Present with the opposite partiality: the baseline `#/pairings` costs 2 of 3 rows (`pi-dsv4.1-flash-volc` reviewer `$0.510395`, scribe `$1.852412`) and leaves `claude` reviewer `null`; those costed rows sum to `$2.362807` against its own `#/totals/costUsd` `$0.973498`. The current fold costs 2 of 2 rows as `null`. Both artifacts therefore have partial or zero coverage, but in different directions, so no coverage change can be stated. A comparable baseline would need the same pairing set and a reconciling cost invariant. |
| `telemetry:spur-history-analyze:phase-support-empty` | `not-comparable` | P3 | Same class present: the baseline `#/derived/phases` is also `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}`, and its render carries the same extraction-empty row at `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.md:56`. Two artifacts of the same series carry the identical triple, which satisfies the recurrence basis section 9 uses. |
| `workflow:spur-history-report:render-title-corrupted` | `not-comparable` | P3 | Same class present: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.md:4` is corrupted identically and carries its own single unclosed fence across 149 lines. Two independently rendered files, each with a `file:line` anchor — the recurrence rule for a process improvement is satisfied without a third window. |
| `positive:spur-history-import:clean-import-and-tool-runs` | `not-comparable` | P3 | Same class present: both baseline `#/coverage` rows report `parseErrors` 0, `validationErrors` 0 and `unknownRecords` 0, and every baseline `#/byTool[].errors` is 0 over 98 calls. Presence in two artifacts, not a counted change. |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `not-comparable` | P3 | Same class present on a smaller and less clean population: the baseline `#/pairings` covers 9 dispatches with 2 failures (`claude` reviewer `successRate` 0 over 2 dispatches) and `unknownOutcomes` 0 on all three rows, against 19 dispatches with 0 failures here. Each figure is its own artifact's value and is not subtracted. |
| `positive:spur-history-import:pi-complete-measurement-axis` | `not-comparable` | P3 | Same class present: the baseline `#/stepSupport/1` reports pi `assistantSteps` 97 with `stepsWithUsage`, `stepsWithDuration`, `stepsWithDerivedDuration` and `stepsWithCacheRead` all 97, and all four baseline `#/byTool` rows report `durationUnmeasured` 0. Present in both artifacts; the current pi lane is smaller (23 steps) but equally complete. |
| `positive:spur-history-analyze:folds-reconcile` | `not-comparable` | P3 | Same class present on the axes both artifacts expose: the baseline `#/coverage` sums to 272 messages and 98 tool calls, matching its `#/totals` (`272`, `98`) to the record, and its four `#/derived/timeDecomposition` buckets sum to its `spanMs` `8,531,669`. Its `llmMs` also equals its per-source assistant-duration sum (`8,477,982` + `57`). Present in both artifacts, not a change. |

## Telemetry gaps

Dimensions the artifact cannot support. Each renders `not available`; none is inferred from a raw history file.

| Dimension | Rendering | Why | Anchor |
| --- | --- | --- | --- |
| Codex per-call tool duration | `not available` | 1,451 of 1,472 tool calls unmeasured; `durationMs` 0 with `durationUnmeasured` 1,451 on the codex row, and `durationMsTotal` 0 on every codex `#/byTool` key including `exec` (1,338 calls) | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/byTool`, `#/bySource/codex`, `#/totals` |
| Codex per-step assistant latency | `not available` | 1,888 steps carry 14,398 ms total (7.63 ms per step) with 420k-token prompts recorded at 2–5 ms; the series cannot represent provider round trips | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/stepSupport/0`, `#/topStepsByTokens`, `#/bySource/codex` |
| Duration for 337 assistant steps | `not available` | `#/stepSupport/0` `stepsWithDuration` 1,551 of `assistantSteps` 1,888; the render excludes them from the duration leaderboard | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/stepSupport/0`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:122` |
| Provider usage on 9,873 of 11,074 records | `not available` | `#/totals/recordsWithUsage` 1,201 of 11,074 (10.85%); codex 1,178 of 10,993, pi 23 of 81. Per-record token attribution — and therefore any per-message cost — has no denominator | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/totals`, `#/bySource` |
| Per-pairing cost | `not available` | `totalCostUsd` `null` on both `#/pairings` rows while both report `dispatches` and `meanDurationMs` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/pairings` |
| Pairing model identity | `not available` | `model` is `null` on every `#/pairings` row, so no pairing cost or duration is attributable to a model through this fold | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/pairings` |
| Verified-rate, correction-rate, time-to-verified, tokens per verified result | `not available` | `taskDenominator` 0; every rate field `null` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/verifiedOutcome` |
| Per-phase breakdown | `not available` | `phaseSupport` `supported` with an empty `phases` array | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/derived/phases` |
| Tool command and argument text | `not available` | `byTool` carries no command or argument field; `#/loops` exposes only an `argsDigest`, with `model` `unknown` and `firstSeq`/`lastSeq` both 0 | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Per-session detail beyond the top 20 | `not available` | `#/population/sessions` 29 against `appliedTop` 20, so 9 sessions and their `$1.599517` have no per-session row | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/population`, `#/bySession`, `#/totals` |
| Cache-write volume | `not available` | `cacheWriteTokens` is 0 on every row of both artifacts while cache reads are in the hundreds of millions, so "no writes" and "writes unreported" cannot be distinguished | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/totals`, `#/bySource`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` — `#/totals` |
| Pi lane currency between `05:00:01Z` and generation | `not available` | The pi checkpoint's `lastImportedAt` precedes generation by 10.59 h, so pi activity in that interval is invisible unless a later import ran without advancing the field | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/coverage/1`, `#/generatedAt` |
| Loop repetition below the fold's threshold | `not available` | `#/loops` reports only signatures repeating at least 3 times (5, 4, 3 here); single or double repeats of an identical command are not surfaced | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/loops`, `#/population/loops` |
| Workflow digest and provenance model | `not available` | Provenance records `workflowDigest` and `model` as `not available`, and `spurVersion` as `not available` while the artifact reports `0.4.21` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-provenance.json` — `workflowDigest`, `model`, `spurVersion` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` on five axes in section 3, including a 25 h against 24 h window | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` — `#/coverage`, `#/totals`, `#/pairings` |

Attribution note for the 94.93% unattributed bucket: the artifact's own warning `derived-unattributed-time` states that `17962970ms` could not be attributed to llm/tool/idle because some durations were unmeasured, and points at the per-source step-support matrix (`#/warnings/0`, restated at `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:169`). That is a gap, not workload; combined with F1 and F2 it is the arithmetic shadow of 1,451 untimed codex calls plus millisecond-scale codex step durations, not idle agent time.

## Remediation options

Proposals only. Nothing below has been applied, no diff is produced, and no command here was run by this report. Each option carries the printed `spur task create` handoff that lands it, with the finding's stable key in the task text so the next report classifies that finding as `resolved`. The operator remains the gate: a model-authored report never writes to the task corpus.

**R1 — emit per-call tool timing on the codex lane** (addresses `telemetry:spur-history-import:codex-tool-duration-unmeasured`)

- Owner surface: `spur history import` — the codex source lane's per-tool-call duration record, consumed by the `byTool` and `timeDecomposition` folds.
- Expected impact: `toolMs` becomes a window total covering 1,472 calls instead of pi's 21, the 17,962,970 ms unattributed bucket shrinks by the codex share, and the bottleneck ranking stops leading with an instrumentation residual.
- Verification method: a fresh artifact reports `#/totals/durationUnmeasured` near 0 against `#/totals/toolCalls`, `#/bySource/codex/durationMs` above 0, `#/byTool` `exec` with a non-zero `durationMsTotal`, and `#/warnings` free of `derived-unattributed-time`.
- Reversibility: reversible — an importer field mapping; a re-import rebuilds the affected rows and reverting the mapping restores today's behaviour.
- Handoff: `spur task create "telemetry:spur-history-import:codex-tool-duration-unmeasured — emit per-call tool timing on the codex lane" --template issue`

**R2 — fix or explicitly invalidate codex per-step duration derivation** (addresses `telemetry:spur-history-import:codex-assistant-duration-implausible`)

- Owner surface: `spur history import` — the codex assistant-step duration derivation, consumed by `stepSupport` and `timeDecomposition`.
- Expected impact: `llmMs` becomes a latency figure an operator can act on for the lane carrying 99.53% of billed input, or the lane's latency renders `not available` instead of a millisecond-scale value; either outcome stops the 94.93% unattributed bucket from being read as idle time.
- Verification method: a fresh artifact reports codex per-step duration in a plausible range for 400k-token prompts (and `stepsWithDuration` either complete or explicitly partial), or `#/bySource/codex/assistantDurationMs` renders `not available` with a named reason.
- Reversibility: reversible — a derivation rule; raw session records are untouched, so a corrected derivation can be recomputed.
- Handoff: `spur task create "telemetry:spur-history-import:codex-assistant-duration-implausible — fix or invalidate codex per-step duration derivation" --template issue`

**R3 — investigate codex prompt-cache reuse before any cost optimization** (addresses `performance:codex-sol-executor:cache-reuse-under-half`)

- Owner surface: the `codex-sol` executor ladder entry (`#/ladderSnapshot`, order 20) and the prompt-cache behaviour of its dispatch path.
- Expected impact: identifies whether the 49.39% reuse is structural (20 sub-agent spawns starting cold) or a prefix-instability defect; a 10-point reuse gain on this lane corresponds to about 37.4M fewer fresh input tokens, and either finding removes the ambiguity between "priced higher" and "wasting input".
- Verification method: a subsequent artifact reports either codex reuse at or above a stated target, or a written attribution of the gap to cold sub-agent contexts with the spawn and message counts cited; `#/cacheWaste` either empties or the remaining 0%-reuse steps are explained.
- Reversibility: reversible — routing and prefix configuration; no history is rewritten.
- Handoff: `spur task create "performance:codex-sol-executor:cache-reuse-under-half — investigate codex prompt-cache reuse" --template issue`

**R4 — populate the outcome fold's task denominator** (addresses `coverage:spur-task-check:verified-outcome-absent`)

- Owner surface: `spur task check` (the proof-producing gate) together with the `verifiedOutcome` fold's task-window join.
- Expected impact: `verifiedRate`, `timeToVerified` and `costCoverage` become computable, so cost per verified result — the metric that would rank the other findings by value — stops rendering `not available` for the whole day.
- Verification method: a subsequent artifact reports a non-zero `#/verifiedOutcome/taskDenominator` and either a non-zero `verifiedResults` or a named non-zero `excludedReasons` bucket identifying why an in-scope task was excluded.
- Reversibility: reversible — a scope/join change in the fold; no verdict data is deleted.
- Handoff: `spur task create "coverage:spur-task-check:verified-outcome-absent — populate the outcome fold task denominator" --template issue`

**R5 — reconcile the pairing cost join and state its coverage** (addresses `coverage:pairing-analytics:cost-coverage-absent`)

- Owner surface: the pairing analytics fold's cost and model joins in `spur history analyze`.
- Expected impact: each chained `agent.run` stage becomes costable, or the fold states how many dispatches its cost covers, so a share-of-window figure is either computable or explicitly `not available` rather than absent in one window and overshooting the total in another.
- Verification method: for a fresh artifact, `#/pairings` rows either carry a non-null `totalCostUsd` whose sum is at most `#/totals/costUsd`, or each row carries an explicit coverage marker; `model` is populated or explicitly `not available` per row.
- Reversibility: reversible — a join predicate and a provenance field; no dispatch record is deleted.
- Handoff: `spur task create "coverage:pairing-analytics:cost-coverage-absent — reconcile the pairing cost join and state its coverage" --template issue`

**R6 — report an empty phase list as unsupported** (addresses `telemetry:spur-history-analyze:phase-support-empty`)

- Owner surface: `spur history analyze` — the `derived.phases` fold and its `phaseSupport` label.
- Expected impact: the per-phase view either shows extracted phases or declares the gap, and the renderer stops emitting a row that reads like extracted content.
- Verification method: `jq -c '.derived.phases'` on a fresh artifact returns a non-empty `phases` array when transitions exist, or `phaseSupport` names the absence rather than `supported` whenever `phases` is empty.
- Reversibility: reversible — a label and a render branch.
- Handoff: `spur task create "telemetry:spur-history-analyze:phase-support-empty — report an empty phase list as unsupported" --template issue`

**R7 — emit the render title once and close the body fence** (addresses `workflow:spur-history-report:render-title-corrupted`)

- Owner surface: `spur history report` — the markdown header and fence writer for `--mode forensics`.
- Expected impact: the rendered artifact's first readable line stops contradicting itself, the fence count becomes balanced, and header parsing, markdown rendering and cross-day render diffs become safe.
- Verification method: `sed -n '1,5p'` on a fresh render shows the title exactly once with no truncated prefix, and the file's count of `^``` marker lines is even.
- Reversibility: reversible — a renderer-only change; no artifact is rewritten.
- Handoff: `spur task create "workflow:spur-history-report:render-title-corrupted — emit the render title once and close the body fence" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 18,922,469 ms = 5.26 h):

| Component | Time | Share of span |
| --- | ---: | ---: |
| Unattributed (unmeasured durations) | 4.99 h (17,962,970 ms) | 94.93% |
| Idle / overhead | 13.81 min (828,458 ms) | 4.38% |
| LLM latency (assistant duration, summed) | 1.27 min (76,267 ms) | 0.40% |
| Tool execution | 54.8 s (54,774 ms) | 0.29% |

Reading: the four buckets sum exactly to `spanMs` and `llmMs` equals the sum of the per-source rows (`14,398` codex + `61,869` pi = `76,267`), so this fold reconciles internally — there is no residual between the aggregate and its components. The problem is what the reconciled components measure. The 94.93% unattributed share is an instrumentation residual, explicitly not workload (`#/warnings/0`): it is the arithmetic shadow of 1,451 untimed codex tool calls (F1) and millisecond-scale codex step durations (F2). Tool time (0.29%) covers 21 calls, so it is both tiny and partial. Idle is the one fully measured non-trivial bucket at 4.38%, which is the only term in this table that can be read as agent-side overhead without a caveat. Per the run-cost rule, the ordering below is reported as the fold produces it, not as a workload ranking.

**Per-step latency by source** (`#/bySource`, `#/stepSupport`) — the axis that explains the decomposition:

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per timed step | Mean over all steps |
| --- | ---: | ---: | ---: | ---: | ---: |
| codex | 1,888 | 1,551 (337 missing) | 14,398 ms | 9.28 ms | 7.63 ms |
| pi | 23 | 23 (complete) | 61,869 ms | 2,690.0 ms | 2,690.0 ms |

The 352× per-step gap between the two lanes in one artifact (290× on the timed-step denominator alone) is the reason the codex duration series is treated as unusable rather than fast (F2): 420k-token prompts appear in `#/topStepsByTokens` at 2–5 ms. The pi column is complete on every axis — 23 of 23 steps carry usage, duration and cache-read — so it is the only lane whose latency can be read. It is also 0.73% of window messages, so it cannot stand in for the window.

**Tool execution** (`#/byTool`; instrumented total 54,774 ms):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| ask_user_question | 1 | 32,665 ms | 32,665 ms | 32,665 ms | 0 |
| bash | 14 | 22,039 ms | 1,574 ms | 13,742 ms | 0 |
| read | 5 | 66 ms | 13 ms | 20 ms | 0 |
| edit | 1 | 4 ms | 4 ms | 4 ms | 0 |
| exec | 1,338 | `not available` | `not available` | `not available` | 1,338 |
| send_message | 40 | `not available` | `not available` | `not available` | 40 |
| followup_task | 24 | `not available` | `not available` | `not available` | 24 |
| spawn_agent | 20 | `not available` | `not available` | `not available` | 20 |
| wait_agent | 10 | `not available` | `not available` | `not available` | 10 |
| request_user_input_async | 10 | `not available` | `not available` | `not available` | 10 |
| list_agents | 6 | `not available` | `not available` | `not available` | 6 |
| sleep | 2 | `not available` | `not available` | `not available` | 2 |
| wait | 1 | `not available` | `not available` | `not available` | 1 |

One lane is instrumented and one is not: 21 timed calls (1.43% of the window) against 1,451 untimed. Within the measured set, a single `ask_user_question` call holds 32,665 ms — 59.64% of all measured tool time — and it is a human-wait call, not compute; excluding it, the remaining 20 calls averaged 1,105 ms. The slowest compute call is a 13,742 ms `bash`. These are the only tool-latency facts this window supports, and none of them describes the codex lane (F1). Tool-name distribution is not fragmented here the way it has been in earlier windows: `#/population/tools` reports 13 keys and `exec` alone accounts for 1,338 of 1,472 calls (90.90%), with no lowercase/capitalized alias pair for the same tool on the same lane.

**Cost and tokens by source** (`#/bySource`, `#/totals`, total `$205.655846`):

| Source | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cost / 1M billed input | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| codex | 10,993 | 374,416,896 | 184,921,856 | 0 | 566,434 | `$205.313291` | 99.83% | $0.5484 | 49.39% |
| pi | 81 | 1,768,636 | 1,573,696 | 0 | 29,523 | `$0.342555` | 0.17% | $0.1937 | 88.98% |

Window totals: billed input 376,185,532 (fresh 189,689,980 · cache-read 186,495,552 · cache-write 0), output 595,957, overall cache-hit ratio 49.58%, provider usage present on 1,201 of 11,074 records (10.85%). Both cost cells are measured, so neither reads `not available`. The window's unit economics are dominated by one lane at `$0.5467` per 1M billed input and `$1.0842` per 1M fresh input; output is expensive per token at `$345.09` per 1M output because output volume (595,957) is small relative to billed input. Read together: this window is codex-weighted on spend, volume and price, and pi-weighted on cache hygiene — two different conclusions from two different axes, and F3 carries the reuse diagnosis.

**Chained `agent.run` run cost** (per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Dispatches | Success rate | Failures | Unknown outcomes | Escalations | Total cost | Mean duration |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| `codex-sol` | reviewer | 12 | 1.00 | 0 | 0 | none | `not available` | 91,626.78 ms (1.53 min) |
| `codex-sol` | scribe | 7 | 1.00 | 0 | 0 | none | `not available` | 102,499.69 ms (1.71 min) |

The two pairings cover 19 dispatches with 0 failures, 0 unknown outcomes and 0 escalations, so the orchestration path is not a source of unaccounted work. Cost is `not available` on both rows, which is the correct rendering under the run-cost rule but means 0 of 19 dispatches are costed and no stage cost is reportable this window (F5). The scribe mean (1.71 min) sits 11.9% above the reviewer mean (1.53 min), an intra-artifact ratio. The baseline's own pairing means are `2,612,377.98` ms (reviewer) and `1,254,891.35` ms (scribe) on a different executor; that figure pair is recorded in section 3 as one artifact's value beside another's, not as a comparison, because the baseline ran a different source set in a different-length window.

**Cache re-send waste** (`#/cacheWaste`): 1 step, 281,869 input tokens, in session `01a199f9-94e0-7eb0-95d5-7ad22ce637a6` at `2026-11-02T03:20:19.435Z`, with `cacheReadTokens` 0 (0.0% reuse), `outputTokens` 115, `costUsd` `null` and `durationMs` 5. The filter targets assistant steps with input above 100,000 tokens and cache reuse below 10%; exactly one step met it. That is a genuine one-step observation, corroborated by the lane's 49.39% aggregate reuse, not a masked gap — but the filter cannot see the broader reuse differential, because a lane at 49% reuse has most of its cold prefixes diluted across many partially-cached steps.

**Per-session concentration** (`#/bySession`, top 20 of 29): the largest session (`01a199f9-94e0-7eb0-95d5-7ad22ce637a6`, codex, started `2026-11-02T02:03:19.896Z`) holds 2,135 messages, 264 tool calls and `$75.697571` — 36.81% of window cost — with `assistantDurationMs` 1,909 and 18 steps without duration. The top two sessions hold 61.25% of cost; the top six hold 95.84%. Because `#/bySession` is truncated at 20 of 29, these shares are computed against the window total and are upper bounds on the listed set, not a complete per-session decomposition (section 1).

**Bottleneck order** (`#/derived/bottlenecks`): unattributed 94.93% → idle 4.38% → llm 0.40% → tool 0.29%. The first row is an instrumentation artifact, not a workload statement (section 6, attribution note).

## Workflow and process improvements

Numbered prose proposals; each is report-only and requires operator acceptance before any surface changes. None is projected through the environment-improvement lens — no candidate here carries a retro-category projection, and each is valid unprojected report grammar.

1. **Separate "imported" from "measurable" in the per-source status row.** Both sources report `ok` with zero parse and zero validation errors while the codex lane contributes no tool timing at all (F1); the baseline's `claude` row likewise reports `ok` over 42 messages, 0 tool calls and 0 billed input tokens. A status field that cannot be non-`ok` for a source with no measurable content carries no information. Owner surface: the per-source coverage contract in `spur history import` and `spur history analyze`. Recurrence basis: the all-clear-status shape appears in both artifacts of this run, with the baseline's empty claude lane at `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` `#/coverage/0` and the current codex lane at `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` `#/coverage/0`.
2. **Print the coverage denominator next to every aggregate the render shows.** The current render prints `Tool execution | 54.8s | 0%` (`.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:55`) without stating that the figure covers 21 of 1,472 calls, so a 1.43% sample is presented as a window total — the bounded-leaderboard truthfulness invariant applied to a time column rather than a table. Owner surface: `spur history report`'s time-decomposition writer. Recurrence basis: single-window, high-impact contract violation cited at `file:line` (report-contract truthfulness invariants: no bounded set presented as a population total).
3. **Treat a 25-hour DST day as a comparability blocker in the runner, not in the reader.** `2026-11-01` spans 90,000,000 ms against `2026-11-02`'s 86,400,000 ms, so the daily rule's adjacent-day pairing compared a 25-hour window to a 24-hour one, and this report had to discover that from the bounds to avoid stating a fabricated per-hour delta. Owner surface: the history-anatomy workflow's baseline selection and the mode contract's DST rule. Recurrence basis: single-window by nature (one fall-back day per year), cited at `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-paths.txt:7-8`; the confirmation path is the next DST transition, where the same asymmetry would recur.
4. **Emit loop rows with command identity and sequence numbers.** The three loop rows carry `argsDigest`, `model` `unknown` and `firstSeq`/`lastSeq` 0, so an operator cannot tell which command repeated or where in the session it occurred, and cannot act on the advisory in section 10. Owner surface: the loop fold in `spur history analyze`. Recurrence basis: single-window — the baseline's `#/loops` is empty, so no comparable repetition class exists there; recorded as a single-window observation with an evidentiary anchor.
5. **Make the phase fold's label follow its data.** `phaseSupport: "supported"` with `phases: []` is present in both artifacts of this run (F6), so the label has been wrong for at least two independent windows while the render has emitted an extraction-empty row in each. Owner surface: `spur history analyze`, the `derived.phases` fold. Recurrence basis: two artifacts, at `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` `#/derived/phases` and the same path in the baseline artifact.
6. **Keep the outcome fold in scope of every report, even when empty.** The denominator is 0 in both artifacts, so the one axis that would rank the others by value is absent for a second consecutive window (F4). A fold that renders all-zero without a reason field cannot distinguish "no tasks in scope" from "tasks not joined". Owner surface: `spur task check` plus the `verifiedOutcome` join. Recurrence basis: two artifacts of this run report the identical all-zero shape.
7. **Fix the render header once, in one place.** Both renders of this run open with a duplicated title inside an unclosed fence (F7), each with its own `file:line` anchor, which is a single shared writer defect rather than per-artifact damage. Owner surface: `spur history report`, `--mode forensics` header and fence writer. Recurrence basis: two independently rendered files with the identical malformation.
8. **State the pairing fold's cost coverage on the row.** One artifact of this run prices none of its pairings and the other prices two of three while exceeding its own window total (F5); in both cases the reader must derive coverage by hand. Owner surface: the pairing analytics fold. Recurrence basis: two artifacts with partial or zero coverage in opposite directions.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry and no command substitution. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | First observed | Note |
| --- | --- | ---: | --- | --- |
| `exec` + `argsDigest` `064b141c89a7c200…` (first 16 hex of the recorded digest) | codex · `01a19a1d-5b71-76a3-9453-b4c257fc6c11` | 5 | `2026-11-02T02:37:42.247Z` | The same command line was issued five times in one session. `firstSeq` and `lastSeq` are both 0, so position and separation within the session are `not available`, and `model` is `unknown` on the row. |
| `exec` + `argsDigest` `fc1f96bd0f3af010…` | codex · `01a19a00-ea36-78e1-82d6-4e1d8f205652` | 4 | `2026-11-02T03:00:20.659Z` | Four repeats in one session; sequence positions unavailable for the same reason. |
| `exec` + `argsDigest` `44544f7964ce612b…` | codex · `01a19a00-ea36-78e1-82d6-4e1d8f205652` | 3 | `2026-11-02T02:44:08.876Z` | Three repeats in the same session as the signature above, on a different command. |

The artifact exposes repetition only through the loop fold, which reports signatures repeating at least 3 times; two of the three rows are in the same session, so at least 7 of that session's 328 tool calls belong to repeated identical commands. Repeat counts of one or two are `not available` from this evidence plane, and the 1,472 tool calls are not individually inspectable for repetition because `byTool` carries no command text. A separate distribution observation, recorded here rather than as a repetition class: `exec` accounts for 1,338 of 1,472 calls (90.90%) and one `ask_user_question` call holds 59.64% of all measured tool time — both are human-decided workload facts, not signatures the fold classifies, and neither is proposed as a trigger for any automated behaviour.

## Positive patterns

Held to the same evidence standard as the problems above: observation, inference, and at least one anchor each.

### P1 — 1,472 tool calls and 29 imported files produced no errors

- `key`: `positive:spur-history-import:clean-import-and-tool-runs`
- `category`: `positive`
- `impact`: The evidence plane is trustworthy on its error axis: no tool call failed and no record was rejected, so the gaps found in this report are measurement-coverage gaps rather than import corruption. Nothing in the report needs a caveat about lost or malformed data, which is what makes the F1/F2 diagnosis about field emission rather than about ingestion failure.
- `trend`: `not-comparable`
- `observation`: `#/byTool[].errors` is 0 for all 13 tool keys, summing over 1,472 calls. `#/coverage` reports `parseErrors` 0, `validationErrors` 0, `unknownRecords` 0, `parseErrorSamples` `[]` and `validationErrorSamples` `[]` for both sources — 27 codex files and 2 pi files, 11,074 messages in total.
- `inference`: Zero errors across every tool key plus zero parse, validation and unknown counts across all 29 files means the importers read this window's corpus without loss or rejection, so the artifact's content is complete relative to what the sources recorded. Named observations: the all-zero `errors` column, the all-zero error counters in `#/coverage`, and the agreement between `#/coverage` message/tool totals and `#/totals` (11,074 and 1,472).
- `contradictions`: A clean error axis says nothing about coverage: the same `#/coverage` rows report `ok` while the codex lane carries 1,451 untimed tool calls (F1) and 9,873 of the window's 11,074 records carry no provider usage, so "no errors" must not be read as "fully measured".
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{toolErrors:([.byTool[].errors]|add),calls:([.byTool[].calls]|add),coverage:[.coverage[]|{s:.source,f:.files,m:.messages,p:.parseErrors,v:.validationErrors,u:.unknownRecords}],totals:{m:.totals.messages,c:.totals.toolCalls}}' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — both source lanes and their validation path.

### P2 — all 19 chained agent.run dispatches succeeded with no unknown outcomes

- `key`: `positive:spur-history-analyze:pairing-dispatch-reliability`
- `category`: `positive`
- `impact`: Chained delegation worked this window: 19 dispatches across 2 pairings, 19 successes, 0 failures, 0 unknown outcomes and 0 escalations — so the orchestration path itself is not a source of unaccounted work. Combined with P1 it means the window has no unexplained failures on either the tool or the dispatch axis.
- `trend`: `not-comparable`
- `observation`: `#/pairings` reports `codex-sol`/`reviewer` 12 dispatches with `successRate` 1, `failures` 0, `unknownOutcomes` 0, `escalations` `{}`; `codex-sol`/`scribe` 7 dispatches with `successRate` 1, `failures` 0, `unknownOutcomes` 0, `escalations` `{}`.
- `inference`: Dispatches total 19 with 0 recorded failures and 0 unknown outcomes, which means every dispatch reached a terminal and classified state — a success rate computed on this fold is measured rather than assumed. Named observations: the two per-pairing dispatch counts, both `successRate` values at 1, and the zero `unknownOutcomes` and empty `escalations` maps.
- `contradictions`: The pairings also carry `totalCostUsd` `null` and `model` `null`, so "no unaccounted failures" does not extend to "no unaccounted cost" (F5). The mean durations (1.53 min reviewer, 1.71 min scribe) cannot be cross-checked against a baseline because the baseline ran a different executor on a different source set in a 25-hour window (section 3).
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '{dispatches:([.pairings[].dispatches]|add),failures:([.pairings[].failures]|add),unknown:([.pairings[].unknownOutcomes]|add),rows:[.pairings[]|{e:.executor,r:.role,d:.dispatches,s:.successRate,f:.failures,esc:.escalations,ms:.meanDurationMs}]}' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: the `agent.run` dispatch path and the pairing analytics fold in `spur history analyze`.

### P3 — the pi lane is fully instrumented on every axis

- `key`: `positive:spur-history-import:pi-complete-measurement-axis`
- `category`: `positive`
- `impact`: Every quantitative claim about pi latency, tokens and tool time in this window can be made against a lane with a complete denominator: 21 of 21 tool calls timed, 23 of 23 steps with usage, duration and cache-read. That is what makes F2's 352× per-step comparison defensible rather than a guess, and it is the pattern the codex lane should be brought up to (F1, F2).
- `trend`: `not-comparable`
- `observation`: `#/stepSupport[1]` reports pi `assistantSteps` 23, `stepsWithUsage` 23, `stepsWithDuration` 23, `stepsWithDerivedDuration` 23, `stepsWithCacheRead` 23. `#/bySource/pi` reports `toolCalls` 21 with `durationMs` 54,774 and `durationUnmeasured` 0, and every pi-lane `#/byTool` row (`ask_user_question`, `bash`, `read`, `edit`) reports `durationUnmeasured` 0. `#/bySource/pi` cache reuse is 88.98%.
- `inference`: A source whose step count, usage count, duration count and cache-read count are all identical is emitting a complete measurement record per step, so pi's aggregates are measured rather than inferred. Named observations: the five equal counts in `#/stepSupport[1]`, the 0 unmeasured calls across the four pi tool rows, and the 88.98% reuse that agrees with the lane's populated cache fields.
- `contradictions`: pi's completeness is not matched by weight — it is 81 of 11,074 messages (0.73%) and 0.17% of cost, so a complete lane describes a tiny share of the window. Its recorded import also predates generation by 10.59 h (`#/coverage/1`), so the lane is complete per imported record but may be missing the last 10.59 h of activity.
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/stepSupport/1`, `#/bySource/pi`, `#/byTool`, `#/coverage/1`
- `severity`: `P3`
- `reproCommand`: `jq -c '{steps:.stepSupport[1],toolCalls:.bySource.pi.toolCalls,toolMs:.bySource.pi.durationMs,unmeasured:.bySource.pi.durationUnmeasured,reuse:(.bySource.pi.cacheReadTokens/.bySource.pi.inputTokens),src:.coverage[1]}' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pi source lane, as the reference implementation the codex lane should match.

### P4 — the folds reconcile: coverage matches totals, and the time decomposition balances

- `key`: `positive:spur-history-analyze:folds-reconcile`
- `category`: `positive`
- `impact`: Three independent reconciliation checks pass in this artifact, which means the numbers in this report are internally tied rather than separately produced: per-source coverage agrees with the window totals to the record, the `llmMs` bucket equals the sum of its per-source rows, and the four time buckets equal the span exactly. A reader can therefore trust the arithmetic and attribute every gap to a specific measured dimension (F1, F2) instead of to a reconciliation defect.
- `trend`: `not-comparable`
- `observation`: `#/coverage` messages sum to 11,074 (`10,993` + `81`) and tool calls to 1,472 (`1,451` + `21`), both equal to `#/totals/messages` and `#/totals/toolCalls`. `#/derived/timeDecomposition/llmMs` `76,267` equals `#/bySource/codex/assistantDurationMs` `14,398` plus `#/bySource/pi/assistantDurationMs` `61,869`. The four buckets `76,267` + `54,774` + `828,458` + `17,962,970` sum to `18,922,469`, equal to `spanMs`. The same checks pass in the baseline artifact: its `#/coverage` sums to 272 messages and 98 tool calls matching its `#/totals`, and its buckets (`8,478,039` + `5,211` + `48,419` + 0) sum to its `spanMs` `8,531,669`.
- `inference`: Because the three checks hold on both artifacts of this run, the folds are computing from one shared record base rather than from divergent counts, so a discrepancy elsewhere in the report can be localized to the dimension that owns it. Named observations: the two coverage-to-totals equalities, the `llmMs` equality with the per-source sum, the bucket-to-span equality, and the same three properties in the baseline artifact.
- `contradictions`: Reconciliation is not measurement: the buckets balance because the residual is explicitly assigned to `unattributedMs`, so a balanced decomposition can still be 94.93% unmeasured (F1). The record base is also only partly attributed — 1,201 of 11,074 records carry provider usage — so "the folds agree" does not imply "the totals are complete".
- `evidenceAnchor`: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/coverage`, `#/totals`, `#/bySource`, `#/derived/timeDecomposition`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` — `#/coverage`, `#/totals`, `#/derived/timeDecomposition`
- `severity`: `P3`
- `reproCommand`: `jq -c '{covMsgs:([.coverage[].messages]|add),totMsgs:.totals.messages,covTools:([.coverage[].toolCalls]|add),totTools:.totals.toolCalls,llm:.derived.timeDecomposition.llmMs,srcSum:([.bySource[].assistantDurationMs]|add),bucketSum:([.derived.timeDecomposition.llmMs,.derived.timeDecomposition.toolMs,.derived.timeDecomposition.idleMs,.derived.timeDecomposition.unattributedMs]|add),span:.derived.timeDecomposition.spanMs}' .spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json`
- `ownerSurface`: the `coverage`, `bySource`, `totals` and `derived.timeDecomposition` folds in `spur history analyze`.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `telemetry:spur-history-import:codex-tool-duration-unmeasured` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/totals`, `#/bySource/codex`, `#/byTool`, `#/warnings/0`, `#/derived/timeDecomposition`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:57` |
| `telemetry:spur-history-import:codex-assistant-duration-implausible` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/stepSupport/0`, `#/topStepsByTokens`, `#/bySource/codex`, `#/bySource/pi`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:122` |
| `performance:codex-sol-executor:cache-reuse-under-half` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/bySource`, `#/totals`, `#/cacheWaste`, `#/ladderSnapshot` |
| `coverage:spur-task-check:verified-outcome-absent` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` — `#/verifiedOutcome` |
| `coverage:pairing-analytics:cost-coverage-absent` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` — `#/pairings`, `#/totals/costUsd` |
| `telemetry:spur-history-analyze:phase-support-empty` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/derived/phases`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:66`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.md:56` |
| `workflow:spur-history-report:render-title-corrupted` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.md:4`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.md:4` |
| `positive:spur-history-import:clean-import-and-tool-runs` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals` |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/pairings` |
| `positive:spur-history-import:pi-complete-measurement-axis` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/stepSupport/1`, `#/bySource/pi`, `#/byTool`, `#/coverage/1` |
| `positive:spur-history-analyze:folds-reconcile` | `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-current.json` — `#/coverage`, `#/totals`, `#/bySource`, `#/derived/timeDecomposition`; `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` — `#/coverage`, `#/totals`, `#/derived/timeDecomposition` |

Baseline artifacts cited in sections 3 and 5: `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`, `#/totals`, `#/loops`, `#/cacheWaste`) and `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-history-anatomy-baseline.md:4`. Window bounds and the 25-hour DST baseline interval are recorded in `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-paths.txt:5-8`; run identity, digests and the provisional window state are recorded in `.spur/run/688106fd-5d88-4505-ad30-f535b69fff9d-provenance.json`.

Two limitations of this report's own evidence, stated rather than masked: the current window is provisional and only 31.6% elapsed, so every current-window figure is a partial-day fact; and no comparison against `2026-11-01` is stated anywhere, because that baseline was found `not comparable` on five independent axes in section 3 — including a baseline window one hour longer than the current one.

