---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-10-20"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-10-20T00:00:00.000-07:00
    until: 2026-10-20T23:59:59.999-07:00
  sources:
    - source: claude
    - source: pi
windowState: "provisional"
generatedAt: "2026-10-20T12:04:32.130Z"
validatedAt: "2026-10-20T12:04:32.130Z"
artifactDigest: "bfe348c504ae5a71212f4817140a4e8fdc5603f9e3ff84d55849a404d38f348d"
baselineArtifactDigest: "3666ddd9930d0602d3e6e8df627a7d1631f2be9f157a9e472d39cf5c9a32fdb5"
contractDigest: "34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5"
skillDigest: "bcd34064fb82e1d397715b1b6dcca8b68bd410f0761ddc3c529a9d49b2e1c5c1"
workflowDigest: "not available"
helperDigest: "23563e0958b5d7ac377b93d78c3d5891baf5626f98befaf0bfa73385432a82c3"
runId: "d274d5d2-bb0a-4769-9c89-72390579edd9"
currentArtifactPath: ".spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json"
spurVersion: "not available"
schemaVersion: 1
executor: "coder"
model: "not available"
cacheDisposition: "miss"
coverage:
  - source: claude, status: ok, lastImportedAt: 2026-10-20T12:03:59.489Z
  - source: pi, status: ok, lastImportedAt: 2026-10-20T12:03:02.299Z
---

> imported snapshot as of 2026-10-20T12:03:02.299Z · window provisional · cache miss

# History forensics report — 2026-10-20 (daily, America/Los_Angeles)

## Scope and provenance

Artifact-rendered facts (no model interpretation in this section).

| Field | Value |
| --- | --- |
| Mode | `daily` (no focus string) |
| Local calendar day | `2026-10-20`, timezone `America/Los_Angeles` |
| Normalized bounds (inclusive) | `2026-10-20T00:00:00.000-07:00` → `2026-10-20T23:59:59.999-07:00` (24.00 h; no DST transition) |
| Baseline bounds | `2026-10-19T00:00:00.000-07:00` → `2026-10-19T23:59:59.999-07:00` (immediately preceding local calendar day) |
| Window state | `provisional` — artifact `generatedAt` `2026-10-20T12:04:24.935Z` (05:04:24 PDT), 5.074 h of 24 h elapsed (21.14 %) |
| Sources in window | `claude` (ok), `pi` (ok) — baseline also carries `codex` |
| Run id | `d274d5d2-bb0a-4769-9c89-72390579edd9` |
| Cache disposition | `miss` (reason `no-cache`) |
| Current artifact | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` (semantic digest `bfe348c504ae5a71212f4817140a4e8fdc5603f9e3ff84d55849a404d38f348d`) |
| Baseline artifact | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json` (semantic digest `3666ddd9930d0602d3e6e8df627a7d1631f2be9f157a9e472d39cf5c9a32fdb5`) |
| Executor / model | `coder` / `not available` |
| Population | top 20 of 26 sessions · 15 tools · 2 loops · 1 warning (baseline: top 20 of 47 · 16 tools · 1 loop · 1 warning) |
| Coverage breadth | `claude` 8 files / 5,997 messages / 787 tool calls · `pi` 18 files / 3,399 messages / 1,301 tool calls · 0 parse errors · 0 validation errors · 0 unknown records |

## Executive summary

The in-window pipeline is healthy: both imported sources report `ok`, zero parse and validation errors, and the model-routing ladder paired 6 dispatches with no failure. The report's *time* model, however, is not trustworthy at the source level, and that is what to fix first.

Two independent measurement defects sit underneath every number in Performance analysis. First, tool durations are recorded for exactly one adapter family: `pi`'s 1,301 tool calls carry 21,695,497 ms of measured duration plus 1 unmeasured call, while all 787 `claude` calls carry 0 ms and 787 unmeasured calls (37.74 % of the window's 2,088 calls are unmeasured). Second, the wall-clock denominator is not window-bounded: a 24 h selector window that had only 5.074 h elapsed at generation is divided up against a 35.99 h span. The headline "idle 19.23 h = 53.42 % / tool 6.03 h = 16.75 %" therefore mixes a pi-only tool numerator with a session-lifetime denominator.

Layered on top: tool result byte volume is recorded only for the same `claude` side that has no durations (1,301 calls report 0 B, 787 report bytes), the per-phase breakdown claims support while extracting zero phases, and the verified-outcome dimension has an empty denominator, so its zeros must be read as `not available`, not as a clean record. Interactive human wait is folded into tool execution time (visible at baseline scale: `ask_user_question` mean 711.8 s, max 65.8 min, 17.17 % of baseline tool time).

Positives worth keeping: 98.57 % of billed input is served from cache, `pi` instrumentation is complete (1,283 of 1,283 steps with usage, duration and cache-read), imports are error-free, and no tool errors are recorded anywhere in the window.

Baseline comparison is `not comparable` for every quantity (a provisional partial day against a complete day, plus a changed source mix). Recurrence below is key-presence only — no delta or percentage is claimed across the two windows.

## Baseline comparison

**Comparability verdict: `not comparable` for all quantitative dimensions. `comparable` for presence/structural dimensions only.**

Three independent facts force the verdict:

1. **Partial day against a complete day.** `windowState` is `provisional`; the artifact was generated 5.074 h into a 24 h window (21.14 % elapsed), while the baseline covers a complete prior day. Volume, cost, duration and count comparisons would be measuring elapsed time, not work.
2. **Materially changed source mix.** The baseline carries `codex` (1,255 messages, 158 tool calls, `$35.945091`, i.e. 60.8 % of the baseline's `$59.115361` total); the current window has no `codex` coverage row at all. Any aggregate delta would be dominated by the mix, not by behavior.
3. **Different overlap profiles.** Both denominators exceed their own windows and by different multiples: 35.99 h against a 24 h window here, 131.82 h against a 24 h window in the baseline (see finding `telemetry:history-analyze:span-exceeds-window`).

Consequently this report states **no** trend, delta or percentage across windows for: messages, tool calls, tokens, cost, session counts, tool means/maxima, time-decomposition shares, cache-waste totals, pairing dispatch counts, success rates, model mix, or per-source cost shares. Baseline figures appear below only as baseline-side observations (subject of a finding), never as a comparison numerator.

**Rule applied to the recurrence classification.** `new` / `recurring` / `resolved` below denote *stable-key presence* across the two artifacts (a categorical match, not a magnitude). `not-comparable` would be used for any magnitude comparison; this report performs none. In-window quantities cited in Findings are computed within the current artifact only and are labelled as such.

## Findings

### F1 — Tool durations are measured for one adapter family only

`key`: `telemetry:history-importer:per-source-tool-duration-unmeasured`
`category`: `telemetry`
`impact`: 37.74 % of the window's tool calls (788 of 2,088) contribute no measured time; the `tool` 6.03 h figure and the `unattributed` 7.99 h bucket are therefore a pi-only numerator against a mixed denominator, and the bottleneck ranking (rank 2 unattributed 22.20 %, rank 3 tool 16.75 %) cannot be read as a work profile.
`trend`: `recurring`
`observation`: `#/bySource/claude` reports `durationMs` 0 with `durationUnmeasured` 787, equal to claude's `toolCalls` 787; `#/bySource/pi` reports `durationMs` 21,695,497 with `durationUnmeasured` 1 of 1,301 calls. Independently, in `#/byTool` every capitalized tool name (`Bash` 734, `Read` 12, `Edit` 28, `Write` 3, `Skill` 7, `ToolSearch` 1, `TaskStop` 1, `ListAgents` 1) reads `n/a` with `durationUnmeasured` equal to its call count, and their 787 calls sum exactly to the claude total, while every lowercase name carries a measured mean.
`inference`: the duration fold records tool timing per source family, and it records nothing at all for the claude adapter. Two independent signals support this: the per-source partition (`#/bySource/*` durationMs/durationUnmeasured) and the per-tool-name partition (`#/byTool/*` n/a vs measured, whose call counts sum to the same 787/1,301 split). The `tool` and `unattributed` shares named in `#/derived/timeDecomposition` are downstream of this fold, which is why they are described as pi-only.
`contradictions`: `#/warnings/0` (`derived-unattributed-time`) attributes the shortfall to durations that "were unmeasured", which reads as sporadic loss; the by-source split shows a complete 100 % loss for one family. Conversely `#/bySource/pi` has only 1 unmeasured call out of 1,301, so the loss is not uniform and cannot be explained by "some calls lack duration".
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/bySource/claude`, `#/bySource/pi`, `#/byTool`, `#/totals/durationUnmeasured`, `#/derived/timeDecomposition`
`severity`: `P1`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.bySource | to_entries[] | {source: .key, calls: .value.toolCalls, durationMs: .value.durationMs, durationUnmeasured: .value.durationUnmeasured}'`
`ownerSurface`: the tool-duration fold behind `spur history analyze` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`); the fix belongs in the spur source repo's history analyze query set, not in this repo

### F2 — The wall-clock denominator is not bounded by the reporting window

`key`: `telemetry:history-analyze:span-exceeds-window`
`category`: `telemetry`
`impact`: every time share in the report (idle 53.42 %, unattributed 22.20 %, tool 16.75 %, llm 7.63 %) divides by 35.99 h of session-lifetime rather than by work inside the 24 h window, so no per-day time trend is meaningful and the "53 % idle" reading overstates non-work time.
`trend`: `recurring`
`observation`: `#/selector/since`/`#/selector/until` describe a 24.00 h window; the run's provenance records `windowState` `provisional` and the artifact's `generatedAt` is `2026-10-20T12:04:24.935Z`, i.e. 5.074 h of the 24 h window had elapsed (21.14 %); yet `#/derived/timeDecomposition/spanMs` is 129,553,717 ms (35.99 h). Independently, the latest session start in `#/bySession` is `2026-10-20T11:54:06.587Z` and the earliest is `2026-10-20T00:00:42.814Z` — an 11.89 h start range, which cannot produce a 35.99 h range.
`inference`: *Hypothesis, not causation* — the span is accumulated over session lifetimes (a 36 h sum across 20 listed sessions averages 1.80 h per session) rather than computed as the range of in-window message timestamps. Confirmation path: recompute the span as the difference between the first and last in-window message timestamp from `spur history analyze`, and compare it against the sum of per-session (last − first) lifetimes; whichever reproduces 129,553,717 ms identifies the fold.
`contradictions`: `#/derived/bottlenecks` shares sum to 1.00 against this denominator, so the report is internally consistent — the inconsistency is between the denominator and `#/selector`. `#/derived/timeDecomposition/spanExcludedSessions` is 0, so no session was excluded from the span on the artifact's own accounting.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/selector`, `#/derived/timeDecomposition/spanMs`, `#/bySession`, `#/derived/bottlenecks`
`severity`: `P1`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '{since: .selector.since, until: .selector.until, spanMs: .derived.timeDecomposition.spanMs, firstStart: (.bySession | map(.startedAt) | min), lastStart: (.bySession | map(.startedAt) | max)}'`
`ownerSurface`: the span/denominator derivation in `spur history analyze` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`)

### F3 — Tool result bytes and tool durations are measured on disjoint halves of the window

`key`: `telemetry:history-importer:tool-result-bytes-unmeasured`
`category`: `telemetry`
`impact`: output volume for the pi side is invisible — 1,301 calls report 0 result bytes — so the report can rank tools by call count but never by payload, and any "context bloat" or "expensive tool" judgement is unsupported for 62.3 % of the window's calls.
`trend`: `recurring`
`observation`: in `#/byTool` the 1,301 calls whose `resultBytes` is 0 are exactly the lowercase tool names (`bash` 1,176, `edit` 43, `read` 40, the task-list tool 24, `write` 14, `ask_user_question` 2, `google_search` 2), while the 787 calls with nonzero bytes are exactly the capitalized names (`Bash` 1.9 MB, `Read` 60,703 B, `Edit` 3,518 B, `Write` 529 B, plus `Skill`, `ToolSearch`, `TaskStop`, `ListAgents`). Those totals equal `#/bySource/pi.toolCalls` 1,301 and `#/bySource/claude.toolCalls` 787 exactly.
`inference`: result-byte capture is implemented on the claude side and absent on the pi side — the mirror image of F1's duration gap. Two independent signals: the byte partition's exact correspondence to the per-source call counts, and the implausibility of 1,176 `bash` calls returning zero output while 734 `Bash` calls return 1.9 MB.
`contradictions`: `#/byTool` reports `resultBytes` 0 rather than a null/`not available` marker, so a reader can mistake "unmeasured" for "empty output" — the artifact does not distinguish the two.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byTool`, `#/bySource/pi/toolCalls`, `#/bySource/claude/toolCalls`
`severity`: `P2`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.byTool | map({toolName, calls, resultBytes, durationUnmeasured})'`
`ownerSurface`: the pi adapter's tool-result capture feeding `spur history import` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`)

### F4 — The phase dimension reports support while extracting zero phases

`key`: `telemetry:history-analyze:phase-extraction-empty`
`category`: `telemetry`
`impact`: the per-phase breakdown reads as available but yields nothing, so the pipeline gains no phase-level cost or time attribution — the one dimension that would separate outline/draft/publish work from incidental tooling.
`trend`: `recurring`
`observation`: `#/derived/phases/phaseSupport` is `"supported"` and `#/derived/phases/invalidPhaseCount` is 0, while `#/derived/phases/phases` is an empty array (length 0), and the rendered report's per-phase table carries only a note that a task signal was present while no phases were extracted. Independently, the task-list tool was invoked 24 times in this window (`#/byTool`), so the phase signal the extractor looks for was present and non-trivial.
`inference`: the extractor's support flag is computed independently of its yield, so `supported` states that the *input* exists and says nothing about whether any phase was recovered. Two independent signals: the flag/value contradiction inside `#/derived/phases`, and the nonzero task-list tool count that should have produced candidates.
`contradictions`: `phaseSupport` `"supported"` contradicts an empty `phases` array in the same object; a consumer reading only the flag would report the breakdown as healthy.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/derived/phases`, `#/byTool`
`severity`: `P2`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.derived.phases'`
`ownerSurface`: the phase extractor in `spur history analyze` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`)

### F5 — The verified-outcome dimension has an empty denominator and must be read as `not available`

`key`: `telemetry:task-corpus:verified-outcome-empty`
`category`: `telemetry`
`impact`: the window yields no verified-task outcome signal at all, so success, correction, retry-exhaustion and tokens-per-verified-result cannot be reported — and the zeroed counters look like a clean record when they are an absence of records.
`trend`: `recurring`
`observation`: `#/verifiedOutcome/taskDenominator` 0, `#/verifiedOutcome/verifiedResults` 0, all seven `#/verifiedOutcome/excludedReasons` counters 0, `#/verifiedOutcome/costCoverage` `{covered: 0, total: 0}`, and every derived rate null (`verifiedRate`, `verifiedWithoutCorrectionRate`, `correctionRate`, `timeToVerified.meanMs`).
`inference`: no task reached the verified-result fold inside this window, so all rates are undefined rather than perfect. Two independent signals: the zero denominator paired with zero-side counters (a real evaluation of failures would populate `excludedReasons`), and `costCoverage` 0 of 0, which cannot describe any evaluated population.
`contradictions`: `retryExhaustedCount` 0 and `excludedReasons` all 0 read as "nothing went wrong" while `taskDenominator` 0 says "nothing was measured" — the artifact does not label the block `not available` on its own.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/verifiedOutcome`
`severity`: `P2`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.verifiedOutcome'`
`ownerSurface`: the verified-outcome fold and its task-corpus join in `spur history analyze` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`)

### F6 — A quarter of the wall clock is unattributed and only flagged once

`key`: `telemetry:history-analyze:unattributed-time-warning`
`category`: `telemetry`
`impact`: 7.99 h (22.20 % of the denominator) is neither llm, tool nor idle, so the bottleneck ranking's second place is a measurement hole rather than a bottleneck; the warning that says so is a single free-text string with no per-source breakdown.
`trend`: `recurring`
`observation`: `#/derived/timeDecomposition/unattributedMs` is 28,761,840 (7.99 h, share 0.2220) and `#/warnings/0` is `derived-unattributed-time` with detail "28761840ms could not be attributed to llm/tool/idle because some durations were unmeasured". `#/population/warnings` is 1.
`inference`: the unattributed bucket is the residual of the same unmeasured-duration defect described in F1 and F2 — its magnitude is a function of the measurement gaps, not of workload. Two independent signals: the residual's size in `#/derived/timeDecomposition`, and `#/totals/durationUnmeasured` 788 / `#/totals/assistantDurationUnmeasured` 173, which name the missing inputs directly.
`contradictions`: `#/derived/bottlenecks` ranks `unattributed` as the #2 bottleneck with a 22.20 % share, which presents a telemetry residual as a performance finding.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/derived/timeDecomposition/unattributedMs`, `#/warnings/0`, `#/totals/durationUnmeasured`, `#/derived/bottlenecks`
`severity`: `P2`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '{unattributedMs: .derived.timeDecomposition.unattributedMs, warnings: .warnings}'`
`ownerSurface`: the time-attribution residual fold and its warning emission in `spur history analyze` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`)

### F7 — Three steps re-sent ~1.2 M fresh input tokens at near-zero cache reuse

`key`: `performance:agent-adapters:cache-resend-waste`
`category`: `performance`
`impact`: `$1.207246` of the window's `$13.418189` (9.00 %) is spent on three near-full context re-sends with 2.2 – 2.9 % reuse; each of the three costs `$0.35` – `$0.44`, i.e. 54 – 68× the window's mean cost per usage-bearing record (`#/totals/costUsd` / `#/totals/recordsWithUsage` ≈ `$0.0065`), and it is avoidable context churn rather than necessary work.
`trend`: `recurring`
`observation`: `#/cacheWaste/steps` is 3 and `#/cacheWaste/inputTokens` is 1,202,776. The three rows in `#/cacheWaste/topSteps` are all `pi` / `deepseek-v4.1-flash`: 437,823 input tokens with 12,288 cache-read (2.8 %, `$0.438188`), 413,665 with 8,960 (2.2 %, `$0.41682`), 351,288 with 10,240 (2.9 %, `$0.352238`). They span two sessions: `…_01a1564f-…` at `2026-10-20T01:03:25.997Z`, and `…_01a1565c-…` at `2026-10-20T02:44:15.979Z` and `2026-10-20T01:06:42.120Z`.
`inference`: these three calls rebuilt their prompt from scratch instead of extending the cached prefix — a prompt-prefix instability, not a provider cache miss. Two independent signals: the per-step `inputTokens` are of the same order as the session's whole-context size (comparable to the 400–570 k cache-read sizes in `#/topStepsByTokens`), and the reuse percentages sit below 3 % while `#/totals/cacheReadTokens` shows 98.57 % overall reuse.
`contradictions`: the window's aggregate cache-hit ratio is 98.57 % (`#/totals/cacheReadTokens` 434,752,537 of `#/totals/inputTokens` 441,079,372), so the healthy aggregate hides the tail — a report that quotes only the ratio would miss this finding entirely.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/cacheWaste`, `#/totals/cacheReadTokens`, `#/topStepsByTokens`
`severity`: `P2`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.cacheWaste'`
`ownerSurface`: the pi session prompt-prefix assembly for `deepseek-v4.1-flash` sessions (agent-session configuration, not product code in this repo)

### F8 — A recurring ~300 s step carries zero usage

`key`: `telemetry:agent-adapters:300s-zero-usage-step`
`category`: `telemetry`
`impact`: the longest step in the window (300,049 ms ≈ 5.0 min, 16× the pi `bash` mean of 18,419 ms) carries no tokens, no cost and no output, so five minutes of real time is booked as free work and inflates the deepest-latency tail.
`trend`: `recurring`
`observation`: `#/topStepsByDuration/0` is `{inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 300049}` for `deepseek-v4.1-flash` in session `…_01a1564f-…` at `2026-10-20T02:14:29.400Z`. The baseline artifact carries the same shape at 300,020 ms on a different session (`…_01a1540c-…`, `2026-10-19T12:55:20.437Z`).
`inference`: *Hypothesis, not causation* — a ~300 s ceiling (timeout, stall, or a capped synthetic duration) produces a usage-less step rather than a measured turn. Confirmation path: inspect the pi adapter's step-duration derivation for a 300 s cap or timeout branch and check whether such steps coincide with an unanswered tool call or an aborted turn.
`contradictions`: the next-longest steps in `#/topStepsByDuration` (110,194 ms, 86,778 ms) all carry tokens and cost, so the anomaly is specific to the ~300 s rows and not a general property of long steps.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/topStepsByDuration/0`; `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json` — `#/topStepsByDuration/1`
`severity`: `P3`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.topStepsByDuration[0:3]'`
`ownerSurface`: the pi adapter's per-step duration derivation feeding `spur history import` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`)

### F9 — 91.5 % of tool calls are shell invocations

`key`: `workflow:agent-sessions:shell-call-dominance`
`category`: `workflow`
`impact`: 1,910 of 2,088 calls are `bash`/`Bash` (91.48 %), while file operations account for 140 calls (6.70 %) and the task-list tool for 24 (1.15 %) — so nearly all agent-to-environment traffic travels through one opaque, partially unmeasured channel, and per-call cost/attribution granularity is lost with it.
`trend`: `recurring`
`observation`: `#/byTool` shows `bash` 1,176 (56 %) with mean 18,419 ms and max 1,046,045 ms (17.4 min), `Bash` 734 (35 %), against `read` 40, `Read` 12, `edit` 43, `Edit` 28, `write` 14, `Write` 3, task-list 24. `#/bySession` lists `bash` or `Bash` as `topTool` in 19 of 20 sessions. Per source: pi 1,176 of 1,301 calls (90.39 %), claude 734 of 787 (93.27 %).
`inference`: both agent surfaces route work through the shell rather than through native tool calls, so the dominance is a session-level habit rather than one adapter's quirk. Two independent signals: the two sources' independently computed ratios (90.39 % and 93.27 %) and the `topTool` distribution across sessions.
`contradictions`: F3 shows pi-side result bytes are unmeasured, so the byte share of shell traffic is unknown — shell may dominate calls while contributing an unknown share of context. Shell dominance may also be legitimate for this repo (git, test and gate loops), which is why this is P3 rather than higher.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byTool`, `#/bySession`, `#/bySource`
`severity`: `P3`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '[.byTool[] | {toolName, calls}] | sort_by(-.calls)'`
`ownerSurface`: session-level tool-routing guidance in `AGENTS.md` (tool-and-harness section) and the pi agent defaults

### F10 — Human wait inside `ask_user_question` is booked as tool execution time

`key`: `telemetry:history-analyze:interactive-wait-counted-as-tool-time`
`category`: `telemetry`
`impact`: the one interactive tool measures the operator's think time as tool latency, so `tool` time and any "tool is slow" reading are inflated by human deliberation — at baseline scale this single tool accounted for 5,694,591 ms, 17.17 % of all tool time.
`trend`: `recurring`
`observation`: in the current window `#/byTool` `ask_user_question` is 2 calls, 39,315 ms total, mean 19,657 ms, max 39,296 ms. In the baseline artifact the same row is 8 calls, 5,694,591 ms total, mean 711,823 ms, max 3,947,407 ms — while `bash` averages 10,406 ms there. The in-window sample is small, but the tool is classified as tool execution in both artifacts.
`inference`: the tool-duration fold does not distinguish machine time from a blocking wait on a human, so the classification defect is structural even where the in-window magnitude is small. Two independent signals: the baseline row's mean is ~68× the baseline `bash` mean in the same artifact, and its 3,947,407 ms maximum exceeds any plausible non-interactive tool call.
`contradictions`: the current window only spent 39,315 ms in this tool (0.18 % of measured tool time), so in *this* window the distortion is negligible — the finding is about the classification rule, not about today's cost.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byTool`; `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json` — `#/byTool`
`severity`: `P3`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json --json | jq '.byTool[] | select(.toolName == "ask_user_question")'`
`ownerSurface`: the per-tool duration classification in `spur history analyze` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`)

### F11 — One model family appears under several names, splitting attribution

`key`: `telemetry:history-analyze:model-identity-variants`
`category`: `telemetry`
`impact`: per-model cost and token attribution is split across spellings, so no per-model figure is complete: `deepseek-v4.1-flash` carries `$7.093447` over 3,218 messages while `deepseek-v4-1-flash-261017` carries a further `$0.461299` over 181 messages in the same window.
`trend`: `recurring`
`observation`: `#/byModel` keys in this window are `claude-opus-5-5` (5,197 messages, `$5.863443`), `deepseek-v4.1-flash` (3,218, `$7.093447`), `deepseek-v4-1-flash-261017` (181, `$0.461299`), `unknown` (31, `$0`) and `<synthetic>` (1, `$0`). The baseline artifact shows ten keys including `deepseek-flash`, `deepseek-v4.1-flash-free`, `k3`, `gpt-6.1-sol` and `gpt-6-astra`, with `deepseek-v4.1-flash` (6,302 messages) and `deepseek-v4-1-flash-261017` (686) again split. `#/pairings/*/model` is null for both pairings even though the executor is `pi-dsv4.1-flash-volc`.
`inference`: *Hypothesis, not causation* — the model id is taken from the session's declared string rather than normalised against the routing ladder, so one family fans out into variant keys. Confirmation path: compare `#/ladderSnapshot` names (`pi-dsv4.1-flash-volc` …) against `#/byModel` keys and the executor's own model id, and check whether the dated suffix tracks a provider snapshot rotation.
`contradictions`: the two deepseek keys have visibly different usage profiles (`deepseek-v4.1-flash` 3,218 messages at ~107 k input each versus 181 at ~21 k), which is consistent with either one family across two snapshots or two genuinely different configurations — the artifact cannot settle it, which is itself the gap.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byModel`, `#/pairings`, `#/ladderSnapshot`
`severity`: `P3`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.byModel | to_entries[] | {model: .key, messages: .value.messages, costUsd: .value.costUsd}'`
`ownerSurface`: model-id normalisation between the importer and the routing ladder (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`; ladder config)

### F12 — `codex` is absent from the window and its last import stamp is stale

`key`: `coverage:history-import:codex-source-absent`
`category`: `coverage`
`impact`: if codex import has silently stopped rather than codex simply being unused, the pipeline is currently blind to a source that dominated the prior day's cost (1,255 messages, `$35.945091`, 60.8 % of baseline spend) — and no report would say so.
`trend`: `new`
`observation`: the current artifact's `#/coverage` lists only `claude` (8 files, last imported `2026-10-20T12:03:59.489Z`) and `pi` (18 files, `2026-10-20T12:03:02.299Z`). The baseline artifact's `#/coverage` carries a third row, `codex` (1 file, 1,255 messages, 158 tool calls, `lastImportedAt` `2026-10-19T12:03:57.263Z`), and `#/byModel/gpt-6.1-sol` is absent from the current window. The provenance `identity.sources` for this run is `["claude","pi"]`.
`inference`: *Hypothesis, not causation* — either codex saw no activity inside the window (a legitimate absence) or its importer stopped at `2026-10-19T12:03:57Z`. The stale stamp is suggestive: it is 24 h older than the other two sources' stamps in the same run and older than the baseline window it appears in. Confirmation path: run the importer for `codex` alone and check its checkpoint/ledger state, or inspect whether a codex transcript file exists with a post-`2026-10-19T12:03:57Z` modification time.
`contradictions`: the baseline row's own `lastImportedAt` sits inside the baseline window's generation cycle, so the stamp was fresh for that run — staleness is only visible relative to this run, not as an error the artifact reports.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/coverage`, `#/byModel`; `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json` — `#/coverage`, `#/byModel/gpt-6.1-sol`
`severity`: `P2`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json --json | jq '.coverage[] | select(.source == "codex")'`
`ownerSurface`: the per-source importer and its checkpoint/ledger under `spur history import` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`)

## Recurrence ledger

Matching is on the stable key only. `recurring` means the same key is present in the baseline artifact; no magnitude is compared (see Baseline comparison's comparability verdict). Baseline anchors cited in the basis column are presence evidence, not comparison numerators.

| Stable key | Class | Presence basis in baseline artifact |
| --- | --- | --- |
| `telemetry:history-importer:per-source-tool-duration-unmeasured` | `recurring` | `#/bySource/claude.durationUnmeasured` 622 of 622 calls and `#/bySource/codex.durationUnmeasured` 158 of 158, `durationMs` 0 for both |
| `telemetry:history-analyze:span-exceeds-window` | `recurring` | `#/derived/timeDecomposition/spanMs` 474,555,142 ms (131.82 h) against a 24 h `#/selector` window |
| `telemetry:history-importer:tool-result-bytes-unmeasured` | `recurring` | `#/byTool` zero-byte calls 3,292 = baseline pi 3,134 + codex 158; the 622 byte-bearing calls equal claude's 622 |
| `telemetry:history-analyze:phase-extraction-empty` | `recurring` | `#/derived/phases/phaseSupport` `"supported"` with an empty `phases` array and 126 task-list calls |
| `telemetry:task-corpus:verified-outcome-empty` | `recurring` | `#/verifiedOutcome/taskDenominator` 0 with all counters 0 and every rate null |
| `telemetry:history-analyze:unattributed-time-warning` | `recurring` | `#/warnings/0` `derived-unattributed-time` present with 190,073,055 ms residual |
| `performance:agent-adapters:cache-resend-waste` | `recurring` | `#/cacheWaste` present with 15 steps and 3,722,226 input tokens |
| `telemetry:agent-adapters:300s-zero-usage-step` | `recurring` | `#/topStepsByDuration/1` 300,020 ms with zero input/cache/output/cost |
| `workflow:agent-sessions:shell-call-dominance` | `recurring` | `#/byTool` `bash` 2,641 + `Bash` 593 dominate 3,914 calls; dominated `topTool` across sessions |
| `telemetry:history-analyze:interactive-wait-counted-as-tool-time` | `recurring` | `#/byTool` `ask_user_question` present, 5,694,591 ms booked as tool time |
| `telemetry:history-analyze:model-identity-variants` | `recurring` | `#/byModel` carries both `deepseek-v4.1-flash` and `deepseek-v4-1-flash-261017`, plus `deepseek-flash` and `deepseek-v4.1-flash-free` |
| `coverage:history-import:codex-source-absent` | `new` | key absent from the baseline: baseline `#/coverage` carries the `codex` row (1 file, 1,255 messages, 158 tool calls) and `#/byModel/gpt-6.1-sol` is populated |
| `positive:history-importer:pi-adapter-full-instrumentation` | `recurring` | `#/stepSupport` pi rows saturate at 2,853 steps with usage and 2,845 with duration |
| `positive:history-import:clean-import` | `recurring` | `#/coverage` all statuses `ok` with 0 parse and 0 validation errors across 3 sources |
| `positive:agent-sessions:cache-hit-ratio` | `recurring` | `#/totals/cacheReadTokens` present at 804,366,196 (95.0 % of billed input) |
| `positive:agent-pipeline:pairing-completion` | `new` | key absent: the baseline records 1 reviewer failure of 7 dispatches (`#/pairings[0].failures` 1, `successRate` 0.857) |
| `positive:tooling:zero-recorded-tool-errors` | `recurring` | `#/byTool` reports 0 errors on every one of 16 rows |

No finding is classified `resolved` in this window, because every key present in the baseline is also present now (except the two keys recorded as `new`, which are key-presence changes rather than fixes).

## Telemetry gaps

Every dimension below is rendered `not available` in this report rather than estimated or back-filled from raw history files.

| Dimension | Rendering | Why it is not available |
| --- | --- | --- |
| `claude` tool execution time | `not available` | `#/bySource/claude.durationMs` 0 with 787 of 787 calls unmeasured (F1) |
| `codex` tool execution time (baseline) | `not available` | `#/bySource/codex.durationMs` 0 with 158 of 158 calls unmeasured |
| `pi` tool result payload size | `not available` | `#/byTool` reports 0 bytes for all 1,301 pi calls (F3) |
| Per-phase time and cost breakdown | `not available` | `#/derived/phases/phases` empty despite `phaseSupport` `"supported"` (F4) |
| Verified-task outcome, correction and retry rates | `not available` | `#/verifiedOutcome/taskDenominator` 0; every rate null (F5) |
| Tokens and cost per verified result | `not available` | `#/verifiedOutcome/measuredTokensPerVerifiedResult` null; `costCoverage` 0 of 0 |
| Token/cost coverage of records | `not available` for 76.0 % of records | `#/totals/recordsWithUsage` 2,071 of `#/totals/records` 8,628, so token and cost totals describe the 24.0 % that carry provider usage |
| Pairing model identity | `not available` | `#/pairings/*/model` null for both pairings (F11) |
| Per-step cost for the `codex` source (baseline) | `not available` | `#/topStepsByTokens/*/costUsd` null on codex rows, while `#/bySource/codex.costUsd` is populated |
| Workflow and helper version provenance | `not available` | provenance `workflowDigest`, `spurVersion`, `model` all `not available` |
| Window-bounded wall clock | `not available` | the only wall-clock figure is the 35.99 h session-lifetime span (F2); no window-bounded denominator exists in the artifact |
| Tool error counts as a reliability signal | `not available` as a discriminating signal | every tool row in both artifacts reports 0 errors across 6,002 calls combined; see `positive:tooling:zero-recorded-tool-errors` |

## Remediation options

Proposals only. Nothing in this report was applied, and no command below was executed.

### `telemetry:history-importer:per-source-tool-duration-unmeasured`

- **owner surface:** the `spur history analyze` tool-duration fold (spur source repo; installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`).
- **expected impact:** the `tool` and `unattributed` shares become source-complete; the bottleneck ranking stops mixing a pi-only numerator with a mixed denominator; next report should show `#/bySource/claude.durationUnmeasured` far below `toolCalls`.
- **verification method:** re-run this report for a day with claude activity and confirm `#/bySource/claude.durationMs` is nonzero and `#/totals/durationUnmeasured` / `#/totals/toolCalls` drops well below the current 37.74 %; the finding key then classifies as `resolved` or disappears.
- **reversibility:** fully reversible — a pure read-path fold change with no stored data migration; revert the commit and the prior numbers return exactly.
- **handoff (printed, not run):** `spur task create "P1 telemetry:history-importer:per-source-tool-duration-unmeasured — record tool durations for the claude adapter" --template issue --skip-ready`

### `telemetry:history-analyze:span-exceeds-window`

- **owner surface:** the span/denominator derivation in `spur history analyze`.
- **expected impact:** time shares become share-of-window; the "idle 53 %" reading can be compared across days or dropped entirely.
- **verification method:** confirm `#/derived/timeDecomposition/spanMs` never exceeds the elapsed `until − since` for a window, and that a mid-day run reports a span no larger than the elapsed portion; the key then classifies as `resolved`.
- **reversibility:** fully reversible — derivation-only change; the artifact schema is unchanged.
- **handoff (printed, not run):** `spur task create "P1 telemetry:history-analyze:span-exceeds-window — bound the wall-clock denominator to the window" --template issue --skip-ready`

### `telemetry:history-importer:tool-result-bytes-unmeasured`

- **owner surface:** the pi adapter's tool-result capture feeding `spur history import`.
- **expected impact:** payload-size ranking for 62.3 % of the window's calls; enables a real context-bloat signal instead of call-count proxies.
- **verification method:** `#/byTool` should stop reporting 0 bytes for `bash`/`read`/`edit` rows across a full day, and the pi byte total should be of plausible order against the claude side's 1.9 MB for 734 calls.
- **reversibility:** fully reversible; backfilling historical bytes is optional and can be skipped without affecting the forward path.
- **handoff (printed, not run):** `spur task create "P2 telemetry:history-importer:tool-result-bytes-unmeasured — capture pi tool result payload sizes" --template issue --skip-ready`

### `telemetry:history-analyze:phase-extraction-empty`

- **owner surface:** the phase extractor in `spur history analyze`.
- **expected impact:** either a working per-phase breakdown, or an honest `not available` instead of a `supported` flag over an empty array.
- **verification method:** for a day with task-list activity, either `#/derived/phases/phases` is non-empty or `#/derived/phases/phaseSupport` reads unsupported; both outcomes retire the key.
- **reversibility:** fully reversible — derivation-only.
- **handoff (printed, not run):** `spur task create "P2 telemetry:history-analyze:phase-extraction-empty — make phase support flag match extraction yield" --template issue --skip-ready`

### `telemetry:task-corpus:verified-outcome-empty`

- **owner surface:** the verified-outcome fold and its task-corpus join in `spur history analyze`.
- **expected impact:** the dimension either carries a real denominator or renders `not available`, ending the misleading zeroed block.
- **verification method:** a window that ran at least one verifying task should show `#/verifiedOutcome/taskDenominator` > 0 and `costCoverage.covered` ≤ `costCoverage.total`; the key then classifies as `resolved`.
- **reversibility:** fully reversible — read-path join only.
- **handoff (printed, not run):** `spur task create "P2 telemetry:task-corpus:verified-outcome-empty — surface not-available when the verified-outcome denominator is zero" --template issue --skip-ready`

### `telemetry:history-analyze:unattributed-time-warning`

- **owner surface:** the time-attribution residual fold and warning emission in `spur history analyze`.
- **expected impact:** the residual shrinks once F1 lands, and the warning gains the per-source breakdown that tells a reader where the hole is instead of one aggregate string.
- **verification method:** confirm `#/warnings/0.detail` (or its successor field) names the contributing sources, and that `unattributedMs` falls in a window where every source has measured durations.
- **reversibility:** fully reversible — warning copy and payload only.
- **handoff (printed, not run):** `spur task create "P2 telemetry:history-analyze:unattributed-time-warning — break the unattributed residual down per source" --template issue --skip-ready`

### `performance:agent-adapters:cache-resend-waste`

- **owner surface:** the pi session prompt-prefix assembly for `deepseek-v4.1-flash` sessions (agent-session configuration).
- **expected impact:** fewer than 3 near-zero-reuse steps per day; the ~9 % of window cost currently spent on context rebuilds drops.
- **verification method:** watch `#/cacheWaste/steps` and `#/cacheWaste/inputTokens` in subsequent reports; the key classifies as `improved` or `resolved` when the count falls to 0 without a matching rise in average step cost.
- **reversibility:** fully reversible — a prompt-assembly or session-configuration change with no data migration.
- **handoff (printed, not run):** `spur task create "P2 performance:agent-adapters:cache-resend-waste — stabilise the pi prompt prefix between steps" --template issue --skip-ready`

### `telemetry:agent-adapters:300s-zero-usage-step`

- **owner surface:** the pi adapter's per-step duration derivation feeding `spur history import` (installed helper `/Users/robin/node_modules/@gobing-ai/spur/spur.js`).
- **expected impact:** the ~300 s usage-less rows either gain their real token and cost figures or leave the latency tail, so the longest-step list stops presenting unbooked time as work.
- **verification method:** a subsequent report shows no `#/topStepsByDuration` row carrying a ~300 s duration with zero input, cache-read, output and cost; the key then classifies as `resolved`.
- **reversibility:** fully reversible — classification at import time only, no stored-data migration.
- **handoff (printed, not run):** `spur task create "P3 telemetry:agent-adapters:300s-zero-usage-step — explain the 300 s usage-less step" --template issue --skip-ready`

### `coverage:history-import:codex-source-absent`

- **owner surface:** the per-source importer and its checkpoint/ledger under `spur history import`.
- **expected impact:** either codex coverage returns, or the report can state that codex is unused rather than silent — ending the 60.8 %-of-spend blind spot risk.
- **verification method:** inspect the codex importer checkpoint; a subsequent report either lists a `codex` `#/coverage` row with a fresh `lastImportedAt`, or the report explicitly records the source as unused.
- **reversibility:** fully reversible — inspection first, no destructive operation required.
- **handoff (printed, not run):** `spur task create "P2 coverage:history-import:codex-source-absent — confirm codex import is idle rather than stalled" --template issue --skip-ready`

### `workflow:agent-sessions:shell-call-dominance`

- **owner surface:** session-level tool routing in `AGENTS.md` (tool-and-harness section) and the pi agent defaults.
- **expected impact:** a measurable shift of routine file reads and edits from shell to native tools, improving attribution and payload visibility; paired with F3 it makes shell traffic legible.
- **verification method:** recompute the shell share from `#/byTool` in the next report; treat it as improved only if the shell share falls while tool errors stay at 0 and no cost increase appears.
- **reversibility:** fully reversible — guidance text plus session configuration.
- **handoff (printed, not run):** `spur task create "P3 workflow:agent-sessions:shell-call-dominance — measure native-vs-shell routing for routine file work" --template issue --skip-ready`

### `telemetry:history-analyze:interactive-wait-counted-as-tool-time`

- **owner surface:** the per-tool duration classification in `spur history analyze`.
- **expected impact:** blocking human wait is reported separately from machine tool time, so `tool` shares stop absorbing operator deliberation (baseline: 5,694,591 ms, 17.17 % of baseline tool time).
- **verification method:** a subsequent report renders `ask_user_question` outside the `tool` bucket, or its row carries an explicit wait marker; the key then classifies as `resolved`.
- **reversibility:** fully reversible — classification-only change on a read path.
- **handoff (printed, not run):** `spur task create "P3 telemetry:history-analyze:interactive-wait-counted-as-tool-time — classify interactive wait outside tool time" --template issue --skip-ready`

### `telemetry:history-analyze:model-identity-variants`

- **owner surface:** model-id normalisation between the importer and the routing ladder (`spur history import` and the ladder config).
- **expected impact:** one model family resolves to one `#/byModel` key, so per-model cost and token totals become complete instead of split across `deepseek-v4.1-flash` (`$7.093447`) and `deepseek-v4-1-flash-261017` (`$0.461299`).
- **verification method:** the next report's `#/byModel` carries a single deepseek key whose `costUsd` equals the sum of today's two rows.
- **reversibility:** fully reversible — normalisation on a read path, no historical rewrite required.
- **handoff (printed, not run):** `spur task create "P3 telemetry:history-analyze:model-identity-variants — normalise model ids against the routing ladder" --template issue --skip-ready`

Each accepted proposal lands through the operator's own CLI call, and each printed invocation carries its finding's stable key in its title so a later report classifies it as `resolved`; this report writes nothing to the task corpus.

## Performance analysis

All figures are within-window (2026-10-20 artifact only). Cross-window comparison is `not comparable` per the Baseline comparison verdict.

**Wall clock and composition** (`#/derived/timeDecomposition`, `#/derived/bottlenecks`): span 35.99 h, which is not a window-bounded denominator (F2). Against it: idle 19.23 h (53.42 %), unattributed 7.99 h (22.20 %), tool 6.03 h (16.75 %), llm 2.75 h (7.63 %); the four shares sum to 1.00. Read as a rank order only — the ordering itself rests on a pi-only tool numerator and a session-lifetime denominator, so "idle dominates" is not a supported claim about the day's work.

**Measured tool time** (`#/byTool`, pi side only): `bash` 21,642.8 s total, mean 18.4 s, max 1,046.0 s (17.4 min), 1 call unmeasured; `ask_user_question` 39.3 s total, mean 19.7 s; `google_search` 13.1 s total, mean 6.6 s; `edit` 164 ms, `read` 89 ms, `write` 14 ms, task-list 0 ms. The 17.4-minute `bash` call is the single largest machine-side outlier and is consistent with a long gate or build run; it is not separable from F1's blind spot on the claude side.

**Tokens and cost** (`#/totals`): billed input 441,079,372 (fresh 4,393,647 · cache-read 434,752,537 · cache-write 1,933,188), output 1,023,116, cost `$13.418189`. Cache-hit ratio 98.57 % of billed input. Per-source: `pi` `$7.554746` (56.3 %) with 348,559,485 input, `claude` `$5.863443` (43.7 %) with 92,519,887 input. Per model: `deepseek-v4.1-flash` `$7.093447`, `claude-opus-5-5` `$5.863443`, `deepseek-v4-1-flash-261017` `$0.461299` — split across spellings per F11. Coverage caveat: only 2,071 of 8,628 records (24.0 %) carry provider usage, so these totals price the measured quarter of the traffic.

**Cache re-send waste** (`#/cacheWaste`): 3 steps, 1,202,776 fresh input tokens, `$1.207246` (9.00 % of window cost), reuse 2.2 – 2.9 % (F7).

**Chained `agent.run` run-cost** (0680 R6, `#/pairings`): executor `pi-dsv4.1-flash-volc`, 6 dispatches total.

| Pairing | Dispatches | Success rate | Failures | Total cost USD | Mean duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| `reviewer` | 2 | 1.0 | 0 | 0.320938 | 336,394.86 ms (5.61 min) |
| `scribe` | 4 | 1.0 | 0 | 1.20332 | 314,614.46 ms (5.24 min) |

Pairing spend `$1.524258` accounts for 11.36 % of the window's `$13.418189`; the remaining 88.64 % is direct session work, not chained stages. Pairing model identity is `not available` (`#/pairings/*/model` null). No pairing lacks a cost signal in this window; the `not available` rule would apply to any pairing whose `totalCostUsd` is absent, and it is not substituted with zero here.

**Steps** (`#/stepSupport`, `#/topStepsByDuration`): 2,839 assistant steps, 2,182 with measured duration (76.86 %). `claude` 899 of 1,556 (57.78 %) versus `pi` 1,283 of 1,283 (100 %). Longest steps: 300,049 ms (zero usage, F8), 110,194 ms, 86,778 ms, 82,473 ms, 75,835 ms, 75,750 ms.

**Deepest tails** (`#/topStepsByTokens`): the top step is 569,216 cache-read tokens against 627 fresh input and 900 output (37.4 s) — a long-context read, not a generation-heavy step. The single largest fresh-input step in the top-20 list is 50,104 tokens with 510,208 cache-read.

## Workflow and process improvements

1. **Trust-boundary first.** Until F1 and F2 land, treat any "share of wall clock" figure — in this report or any dashboard built on it — as a rank order, not a proportion. A one-line caveat in the rendered report would prevent the misreading cheaper than fixing the fold.
2. **Report the denominator with the metric.** The rendered report prints shares and hours but never the denominator's provenance; printing `span` next to its source (window vs session lifetimes) is a small renderer change with disproportionate clarity gain.
3. **Make "unmeasured" a first-class value.** F3 shows a 0 that means "unknown"; F5 shows zeros that mean "no data". Both cost a reader a wrong inference. A `not available` marker in the artifact removes the ambiguity for every downstream consumer at once.
4. **Keep the provisional window visible to reviewers.** `windowState: provisional` is recorded in provenance but does not reach the rendered body; a mid-day run otherwise reads as a bad day.
5. **Batch the telemetry fixes.** F1, F3, F4, F5, F6, F8, F10 and F11 all live in the same analyze/import path; sequencing them as one campaign avoids eight overlapping verification cycles over the same fold.

Projected candidates (environment-improvement lens; proposals only, each names the section-4 finding it would retire):

- `workflow:agents-md:shell-native-routing` — **owner surface:** `AGENTS.md` tool-and-harness guidance plus the pi session defaults. **expected impact:** routine file reads and edits move from `bash` to native tools, improving attribution and payload visibility for the 91.48 % shell share (finding `workflow:agent-sessions:shell-call-dominance`). **verification method:** next report's `#/byTool` shell share falls while recorded tool errors stay at 0. **reversibility:** revert the guidance text and session setting.
- `workflow:history-report:denominator-provenance` — **owner surface:** the `spur history report` renderer. **expected impact:** every time-share sentence carries its denominator's source, retiring the misreading that finding `telemetry:history-analyze:span-exceeds-window` describes. **verification method:** subsequent rendered reports print the denominator provenance line. **reversibility:** revert the renderer change.

## Report-only advisories

Observations that inform hygiene and must never trigger automated interruption. Each is a repeated identical tool-and-argument signature recorded in `#/loops`.

| Signature | Repetition count | Source / session | Window span |
| --- | ---: | --- | --- |
| `bash` · args digest `e93bd9c0cc69ea4fe93b749f04eccc4a6680d88fe557651fdc785874a7b36beb` | 3 | `pi` / `deepseek-v4.1-flash` / session `…_01a1564f-…`, started `2026-10-20T02:26:48.950Z` | seq 1457 → 1544 |
| `bash` · args digest `5d27fd44eb45bb5745b5bdc38b11c8ea72f632bf6c7aaf9f13bcef5fab8ad6b1` | 3 | `pi` / `deepseek-v4.1-flash` / session `…_01a1572c-…`, started `2026-10-20T04:07:51.732Z` | seq 243 → 263 |

`#/population/loops` is 2, and both are three-repeat shell retries — consistent with a gate or build being re-run after an edit, which is normal work. No automated interruption, retry cap or alerting is proposed on the basis of this section; if an operator wants to act, the only sanctioned lever is a human-decided process change (for example, a note in session guidance about re-running gates after edits). The baseline artifact's single loop was a different shape entirely (`codex` / `sleep`, 6 repeats), so no signature in this window is a repeat of a baseline signature.

## Positive patterns

### `positive:history-importer:pi-adapter-full-instrumentation`

`key`: `positive:history-importer:pi-adapter-full-instrumentation`
`category`: `positive`
`impact`: complete per-step instrumentation on one adapter makes every pi-side claim in this report verifiable rather than inferred, and it is the model the claude side should be brought up to (F1).
`trend`: `recurring`
`observation`: `#/stepSupport` pi row reports `assistantSteps` 1,283 with `stepsWithUsage` 1,283, `stepsWithDuration` 1,283, `stepsWithDerivedDuration` 1,283 and `stepsWithCacheRead` 1,283 — 100 % on all four dimensions in this window. `#/bySource/pi/durationUnmeasured` is 1 of 1,301 tool calls.
`inference`: the pi import path captures usage, duration and cache-read on every assistant step, so its coverage is a deliberate implementation rather than an accident of a quiet day; the same instrument exists and should be extended to claude (F1). Supported by the two saturating matrix rows in `#/stepSupport` and the single unmeasured call in `#/bySource/pi`.
`contradictions`: `pi` still contributes nothing to result-byte coverage (`#/byTool` 0 B for all 1,301 calls, F3), so its completeness is step-metadata only.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/pi/durationUnmeasured`
`severity`: `P3`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.stepSupport[] | select(.source == "pi")'`
`ownerSurface`: the pi adapter in `spur history import` (reference implementation for the claude fix in F1)

### `positive:history-import:clean-import`

`key`: `positive:history-import:clean-import`
`category`: `positive`
`impact`: every claim drawn from the window rests on a clean ingest — no fabricated or dropped rows, so the only defects worth chasing are in the folds, not in the parse layer.
`trend`: `recurring`
`observation`: `#/coverage` reports `status` `ok` for `claude` (8 files, 5,997 messages, 787 tool calls) and `pi` (18 files, 3,399 messages, 1,301 tool calls), each with `unknownRecords` 0, `parseErrors` 0, `validationErrors` 0 and empty error samples; both were imported within the hour of generation (`2026-10-20T12:03:59.489Z`, `2026-10-20T12:03:02.299Z`).
`inference`: the importer handles both active source formats correctly on this day, and the absence of unknown records means the schema adapters cover the observed record shapes. Supported by the two independent coverage rows and their matching zero error counters.
`contradictions`: only 2 sources were exercised, so a third format (F12's `codex`) has no coverage evidence in this window; a clean report on two sources does not certify the third.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/coverage`
`severity`: `P3`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.coverage'`
`ownerSurface`: the source adapters under `spur history import` (keep as the regression baseline)

### `positive:agent-sessions:cache-hit-ratio`

`key`: `positive:agent-sessions:cache-hit-ratio`
`category`: `positive`
`impact`: 98.57 % cache reuse keeps the billed input bill near the fresh-input floor: fresh input is only 4,393,647 tokens against 441,079,372 billed, so the window's `$13.418189` is dominated by cache-read pricing rather than full-price tokens.
`trend`: `recurring`
`observation`: `#/totals/cacheReadTokens` 434,752,537 of `#/totals/inputTokens` 441,079,372 (98.57 %), with `cacheWriteTokens` 1,933,188 and fresh input 4,393,647; `#/totals/costUsd` 13.418189.
`inference`: prefix reuse is working across both sources in this window, and it is the main reason the cost figure stays small relative to a 441 M-token billed total. Supported by the three independent token components and the derived fresh-input remainder, which reconcile exactly to the billed total.
`contradictions`: the aggregate ratio hides the F7 tail — 3 steps at 2.2 – 2.9 % reuse — so a healthy headline coexists with a real 9.00 % cost leak.
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/totals`, `#/cacheWaste`
`severity`: `P3`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.totals | {inputTokens, cacheReadTokens, cacheWriteTokens, costUsd}'`
`ownerSurface`: session prompt-prefix assembly for both adapters (keep; watch the F7 tail)

### `positive:agent-pipeline:pairing-completion`

`key`: `positive:agent-pipeline:pairing-completion`
`category`: `positive`
`impact`: both chained stages completed every dispatch with known outcomes, so review and scribe work is predictable and its cost is attributable per pairing rather than lost in session totals.
`trend`: `new`
`observation`: `#/pairings` shows `reviewer` 2 dispatches with `successRate` 1, `failures` 0, `unknownOutcomes` 0, `escalations` `{}`, `totalCostUsd` 0.320938, `meanDurationMs` 336,394.857; and `scribe` 4 dispatches with `successRate` 1, `failures` 0, `totalCostUsd` 1.20332, `meanDurationMs` 314,614.463.
`inference`: the pairing fold reports complete outcomes (no `unknownOutcomes`, no escalations) for both roles in this window, which is what makes the run-cost reporting in Performance analysis possible. Supported by the two pairing rows' independent counters.
`contradictions`: the denominator is 6 dispatches in a partial day — small enough that a 1.0 rate is not evidence of stability; and the pairing's model is null, so the cost cannot be attributed to a model (F11).
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/pairings`
`severity`: `P3`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '.pairings'`
`ownerSurface`: the pairing dispatch path and its outcome fold (keep; supply the model field)

### `positive:tooling:zero-recorded-tool-errors`

`key`: `positive:tooling:zero-recorded-tool-errors`
`category`: `positive`
`impact`: 2,088 tool calls produced no recorded failure, so the window's cost and time figures are not polluted by retry storms or crash loops — the shell-dominant workflow is at least running cleanly.
`trend`: `recurring`
`observation`: `#/byTool` reports `errors` 0 on all 15 rows — including `bash` 1,176, `Bash` 734, `edit` 43, `read` 40 — summing to 0 across 2,088 calls, while `#/loops` contains only two 3-repeat signatures rather than escalating retries.
`inference`: whatever failed in this window did not fail at the tool boundary, and the low loop count corroborates that no run was stuck. Supported by the fully zeroed error column and the small loop population (`#/population/loops` 2, each 3 repeats).
`contradictions`: the same column reads 0 across all 16 baseline rows over 3,914 further calls, which is more consistent with the error counter being unpopulated than with 6,002 consecutive error-free calls; the positive is therefore weak as a reliability signal (mirrored in Telemetry gaps).
`evidenceAnchor`: `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byTool`, `#/loops`, `#/population/loops`
`severity`: `P3`
`reproCommand`: `spur history report .spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json --json | jq '[.byTool[].errors] | add'`
`ownerSurface`: the tool-error counter in `spur history analyze` (confirm it is populated before trusting the zero)

## Evidence ledger

| Finding key | Artifact anchor |
| --- | --- |
| `telemetry:history-importer:per-source-tool-duration-unmeasured` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/bySource`, `#/byTool`, `#/totals/durationUnmeasured` |
| `telemetry:history-analyze:span-exceeds-window` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/selector`, `#/derived/timeDecomposition/spanMs`, `#/bySession` |
| `telemetry:history-importer:tool-result-bytes-unmeasured` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byTool`, `#/bySource` |
| `telemetry:history-analyze:phase-extraction-empty` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/derived/phases` |
| `telemetry:task-corpus:verified-outcome-empty` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/verifiedOutcome` |
| `telemetry:history-analyze:unattributed-time-warning` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/warnings/0`, `#/derived/timeDecomposition` |
| `performance:agent-adapters:cache-resend-waste` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/cacheWaste`, `#/totals` |
| `telemetry:agent-adapters:300s-zero-usage-step` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/topStepsByDuration/0`; `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json` — `#/topStepsByDuration/1` |
| `workflow:agent-sessions:shell-call-dominance` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byTool`, `#/bySession` |
| `telemetry:history-analyze:interactive-wait-counted-as-tool-time` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byTool`; `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json` — `#/byTool` |
| `telemetry:history-analyze:model-identity-variants` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byModel`, `#/pairings`, `#/ladderSnapshot` |
| `coverage:history-import:codex-source-absent` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/coverage`; `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json` — `#/coverage`, `#/byModel` |
| `positive:history-importer:pi-adapter-full-instrumentation` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/pi` |
| `positive:history-import:clean-import` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/coverage` |
| `positive:agent-sessions:cache-hit-ratio` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/totals`, `#/cacheWaste` |
| `positive:agent-pipeline:pairing-completion` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/pairings` |
| `positive:tooling:zero-recorded-tool-errors` | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Recurrence basis (12 problem keys) | `.spur/run/d274d5d2-bb0a-4769-9c89-72390579edd9-history-anatomy-baseline.json` — `#/bySource`, `#/byTool`, `#/derived/phases`, `#/verifiedOutcome`, `#/warnings/0`, `#/cacheWaste`, `#/byModel`, `#/coverage` |

