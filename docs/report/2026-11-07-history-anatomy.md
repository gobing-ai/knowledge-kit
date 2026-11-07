---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-11-07"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-11-07T00:00:00.000-08:00
    until: 2026-11-07T23:59:59.999-08:00
  sources:
    - source: agy
    - source: claude
    - source: codex
    - source: opencode
    - source: pi
windowState: "provisional"
generatedAt: "2026-11-07T16:15:37.547Z"
validatedAt: "2026-11-07T16:15:37.547Z"
artifactDigest: "419854a7d084c5e720cd1490ad97235c485af7470c3b0530dbb223b822aafde9"
baselineArtifactDigest: "1c90f27de353ff70a7710717896a9c3ee643db61ed7038d57b3f0b4909aab775"
contractDigest: "34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5"
skillDigest: "8235b95aca5968ae89cc990ece51412b3df564099614ae3690963a588be1c0f2"
workflowDigest: "not available"
helperDigest: "29404af39ab37a9f724e05fa3d67452743b669511da64bbef1b5b3da1891df39"
runId: "4e36b190-de99-489b-a23a-ff7aa1bd6cc0"
currentArtifactPath: ".spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.json"
spurVersion: "not available"
schemaVersion: 1
executor: "coder"
model: "not available"
cacheDisposition: "miss"
coverage:
  - source: agy, status: ok, lastImportedAt: 2026-11-07T16:15:27.970Z
  - source: claude, status: ok, lastImportedAt: 2026-11-07T16:15:23.786Z
  - source: codex, status: ok, lastImportedAt: 2026-11-07T16:15:25.468Z
  - source: opencode, status: ok, lastImportedAt: 2026-11-07T00:22:47.082Z
  - source: pi, status: ok, lastImportedAt: 2026-11-07T16:15:13.229Z
---

> imported snapshot as of 2026-11-07T00:22:47.082Z · window provisional · cache miss

<!-- Candidate authored by sp:history-anatomy enrich · mode daily · run 4e36b190-de99-489b-a23a-ff7aa1bd6cc0 · schema v1 -->

# History forensics report — 2026-11-07 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `4e36b190`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report. No workflow was launched by this operation.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-11-07`, baseline is the immediately preceding local calendar day `2026-11-06` |
| Current window | `2026-11-07T00:00:00.000-08:00` → `2026-11-07T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Baseline window | `2026-11-06T00:00:00.000-08:00` → `2026-11-06T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Window offsets | Both windows sit entirely in `-08:00`; equal-duration with identical UTC offsets — read from `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-paths.txt:5-8` |
| Window state | `provisional` for current artifact. Current generated `2026-11-07T16:15:33.165Z` (`#/generatedAt`), i.e. `8.26` h into the 24.0 h it measures (34.41% elapsed, 15.74 h still to run). Baseline generated `2026-11-07T16:15:36.113Z`, `8.26` h after its own window had fully elapsed — so the baseline day is complete and the current day is provisional |
| Generated | `2026-11-07T16:15:33.165Z` (current) · `2026-11-07T16:15:36.113Z` (baseline) |
| Toolchain | spur `0.4.26` (artifact `#/spurVersion`) · artifact `schemaVersion` `1` · executor `coder`, model `not available` · contract version `1` |
| Digests | artifact `419854a7d084c5e720cd1490ad97235c485af7470c3b0530dbb223b822aafde9` · baseline artifact `1c90f27de353ff70a7710717896a9c3ee643db61ed7038d57b3f0b4909aab775` · contract `34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5` · skill `8235b95aca5968ae89cc990ece51412b3df564099614ae3690963a588be1c0f2` · helper `29404af39ab37a9f724e05fa3d67452743b669511da64bbef1b5b3da1891df39` · workflow `not available`. Read from `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-provenance.json` |
| Selector | sources `all` (`agy`, `claude`, `codex`, `opencode`, `pi`), no session/run/task narrowing, leaderboard depth `20` (`#/population/appliedTop`). Read from `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-selector.json` |
| Cache disposition | `miss` — disposition `no-cache`, so the run recomputed (`.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-cache-disposition.txt`) |
| Current artifact | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.md` |
| Path resolution | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-paths.txt` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| agy | ok | 158 | 17,061 | 8,299 | 0 | 0 | 0 | `2026-11-07T16:15:27.970Z` |
| claude | ok | 10 | 2,451 | 451 | 0 | 0 | 0 | `2026-11-07T16:15:23.786Z` |
| codex | ok | 17 | 874 | 80 | 0 | 0 | 0 | `2026-11-07T16:15:25.468Z` |
| opencode | ok | 1 | 1 | 0 | 0 | 0 | 0 | `2026-11-07T00:22:47.082Z` |
| pi | ok | 13 | 1,559 | 677 | 0 | 0 | 0 | `2026-11-07T16:15:13.229Z` |

Population: `52` sessions, `21` tool keys, `29` loop signals, `1` warning, leaderboard depth applied `20` (`#/population`). `#/bySession` is therefore a bounded slice — 20 of 52 — and the rendered summary states exactly that (`Sessions | top 20 of 52`, `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:11`). Those 20 listed sessions hold 2,272 of 21,417 messages (10.61%), 737 of 9,507 tool calls (7.75%) and `$9.724383` of `$13.714020` (70.91%) of window cost, leaving 32 unlisted sessions carrying `$3.989637` (29.09%) inside `#/totals` but outside `#/bySession`. `#/byTool` lists 20 of 21 tool keys (`.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:20-44`), accounting for 9,506 of 9,507 calls (99.99%), with 1 call on 1 key unlisted. `#/loops` (29 rows) and `#/warnings` (1 row) are complete because both are below the applied depth. The step leaderboards (`#/topStepsByTokens`, `#/topStepsByDuration`) hold 20 rows each and are slices of the assistant steps in `#/stepSupport`, not population totals.

Import freshness: agy is 5.2 s older than generation, claude 9.4 s, codex 7.7 s, pi 19.9 s (`#/coverage`, against `#/generatedAt` `2026-11-07T16:15:33.165Z`). All four lanes imported within seconds of generation at ~16:15 UTC (8.26 h into the local calendar day). The fifth lane, `opencode`, records a checkpoint of `2026-11-07T00:22:47.082Z`, which falls 7.62 h *before* the selector window starts (`2026-11-07T08:00:00Z`) while the same row counts 1 in-window message — an internal contradiction that makes the field unusable as a freshness marker and is finding F5.

## Executive summary

- The measured current window is 52 sessions (top 20 listed), 21,417 messages, 9,507 tool calls, a 23.51 h activity span (excluding 4 sessions with unusable timestamps), `$13.714020` of provider-billed cost, and 124,537,827 billed input tokens at a 93.24% cache-read share. Five sources imported (`agy`, `claude`, `codex`, `opencode`, `pi`) with zero parse errors, zero validation errors and zero unknown records across 199 files.
- Measurement remains the dominant defect: 8,831 of 9,507 tool calls (92.89%) carry no duration. The four untimed lanes (`agy`, `claude`, `codex`, `opencode`) report `durationMs` 0, so the `toolMs` bucket (8,903,971 ms, 10.52% of span) equals the `pi` lane's `durationMs` to the millisecond, and 62,270,523 ms (73.57% of span) is explicitly unattributed (`#/warnings/0`).
- The largest lane by volume bills nothing: `agy` carries 16,956 of 21,417 records (79.17%) and 8,299 of 9,507 tool calls (87.29%) with 0 input tokens, 0 cost, 0 provider usage, and 0 measured tool duration. Unlike the baseline artifact where agy had 1 record with usage attributed to codex, here `byModel/unknown` carries 16,958 records with 0 usage and $0 cost, so agy's spend remains completely unmeasured rather than misattributed (F2).
- Codex assistant steps accumulate 232 ms across 88 timed steps (2.64 ms mean per step) while billing $5.722729 (41.73% of window cost) on 8.88M input tokens (prompts averaging ~100k tokens). Pi in the same artifact averages 6,519.15 ms per step — a 2,469× gap — indicating codex durations are adapter timestamp deltas rather than round-trip latency (F3).
- Time decomposition does not reconcile: `llmMs` (8,684,376 ms) exceeds the sum of per-source assistant durations (6,942,604 ms) by 1,741,772 ms (20.06% of the bucket), while the four buckets sum to `spanMs` (84,636,977 ms) exactly (F4).
- The `opencode` lane's checkpoint (`2026-11-07T00:22:47.082Z`) precedes the window start (`2026-11-07T08:00:00Z`) by 7.62 h while counting 1 message, mirroring the baseline's claude freshness defect on a different lane. Meanwhile, claude's import checkpoint has cleared and is fresh at 16:15:23Z (F5).
- Delegation turned around on reviewer reliability: `claude` reviewer completed 9 of 9 dispatches (100% success rate, 0 failures, 0 escalations) vs 7 of 16 failures in baseline (positive P2). `codex-sol` reviewer completed 9 of 9 (100% success, 3 capacity escalations). `codex-sol` scribe failed 2 of 11 dispatches (18.18% failure rate), repeating its baseline failure count of 2 (F6). `minimax` scribe was not dispatched. Only 1 of 5 pairings is costed (`pi-dsv4.1-flash-volc` reviewer: $11.752528 across 7 dispatches), leaving 81.58% of dispatches unpriced (F8).
- Verified outcomes: `taskDenominator` moved from 0 to 1, but the task was excluded as `notDone`, leaving `verifiedResults` 0, all outcome rates 0, and `costCoverage` `{covered: 0, total: 0}`, so $13.714020 spend cannot be priced per verified result (F7).
- Cache waste: zero steps flagged (0 tokens, $0 waste) across all 52 sessions, resolving the single-session 13-step cold waste seen in the baseline.
- Baseline comparison verdict: **`not comparable`**. Observation coverage is 34.41% elapsed (8.26 h of 24.0 h, provisional) vs a completed day (100% elapsed); instrumentation regime changed (92.89% vs 75.33% untimed tool calls; 5.35% vs 12.22% records with usage); source set expanded to 5 sources (`opencode` added) and model composition shifted (`deepseek-v4-1-flash-261017` and `k3.1-pro` introduced; `claude-opus-5-5` present); tool-key composition shifted (21 vs 22 keys). No trend, delta, or percentage is stated against the baseline, and every finding is classified `not-comparable`.
- The workflow half is healthy where it is measured: zero tool errors across 9,507 calls, zero parse/validation/unknown records across 199 files, `bySource` and `byModel` summing to all totals in this artifact, and 0 unknown dispatch outcomes across 38 dispatches.

## Baseline comparison

**Verdict: `not comparable`.** No trend, no delta, and no percentage is stated against the baseline anywhere in this report. Four independent differences block comparability; the aligning axes are stated first so the blockers are not overstated.

**Aligning axes (stated, not compared).** Both windows are 24.0 h long with identical `-08:00` offsets — there is no DST asymmetry (`.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-paths.txt:5-8`). Both artifacts were generated by spur `0.4.26` with the same contract digest (`34f0f1e6...`) and an identical 25-entry `#/ladderSnapshot`.

1. **Observation coverage is not equal.** The current artifact was generated `8.26` h into the day it measures — 34.41% elapsed, 15.74 h still to run (`windowState: provisional`) — while the baseline artifact was generated `8.26` h *after* its window had fully elapsed (`#/generatedAt`; window bounds as above). A partial day against a complete day is materially different observation coverage: any count comparison would systematically understate the current side by ~3×, and any per-hour rate would divide by two different effective denominators.
2. **Instrumentation regime differs.** The current artifact leaves 8,831 of 9,507 tool calls without a duration (92.89%); the baseline leaves 7,310 of 9,704 (75.33%). The assistant-step axis differs further: 7,834 of 9,854 steps carry no duration here (`#/totals/assistantDurationUnmeasured`) against 5,971 of 9,280 steps there. Provider usage coverage dropped from 12.22% (2,800 of 22,918 records) in baseline to 5.35% (1,146 of 21,417 records) here. The same statistic therefore describes two different measurement populations, so no tool-time or latency figure is like-for-like.
3. **Source set and model composition changed.** The current window imports 5 sources (`agy`, `claude`, `codex`, `opencode`, `pi`) against 4 in the baseline (`opencode` introduced). `#/bySource` message shares shifted: agy 16,956 (79.17% here) against 13,347 (58.24% baseline); claude 2,027 (9.46%) against 930 (4.06%); codex 874 (4.08%) against 3,041 (13.27%); pi 1,559 (7.28%) against 5,600 (24.43%). `#/byModel` introduces `deepseek-v4-1-flash-261017` (543 messages, `$2.433393`) and `k3.1-pro` (61 messages, `$0.094892`), which were absent in baseline, while `claude-opus-5-5` is present here (744 messages, `$1.156836`) and absent in baseline.
4. **Tool-key composition changed.** `#/population/tools` is 21 here against 22 in baseline, and the families differ: this window introduces `schedule` (108 calls), `Bash` (324 calls), `TaskStop` (2 calls), `to&#100;o` (8 calls) and `ffgrep` (1 call), none of which appeared in baseline; baseline carried `ask_user_question`, `bg_wait`, `web_search` and `contact_supervisor`. A tool-name distribution over different key sets is not the same statistic, and per-tool latency cannot be paired row-for-row.

Per-axis values, stated as separate facts only:

| Axis | Current artifact | Baseline artifact | Compared? |
| --- | --- | --- | --- |
| Window duration | 24.0 h (`-08:00` both bounds) | 24.0 h (`-08:00` both bounds) | aligned — no DST asymmetry |
| Observation coverage | 34.41% elapsed at generation (8.26 h of 24.0 h) | 100% elapsed, generated 8.26 h after window end | no |
| Sources | `agy`, `claude`, `codex`, `opencode`, `pi` (199 files, all `ok`) | `agy`, `claude`, `codex`, `pi` (326 files, all `ok`) | no — 5 sources vs 4 |
| Sessions | 52 (top 20 listed, 10.61% of messages, 70.91% of cost) | 96 (top 20 listed, 30.16% of messages, 72.43% of cost) | no |
| Messages (`#/totals`) | 21,417 | 22,918 | no |
| Tool calls | 9,507 | 9,704 | no |
| Instrumented tool calls | 676 of 9,507 (7.11%) | 2,394 of 9,704 (24.67%) | no |
| Records with provider usage | 1,146 of 21,417 (5.35%) | 2,800 of 22,918 (12.22%) | no |
| Assistant steps timed | 1,988 of 9,854 (20.17%) | 3,306 of 9,280 (35.63%) | no |
| Span | 84,636,977 ms (23.51 h) | 147,837,659 ms (41.07 h) | no |
| Cost | `$13.714020` | `$36.690767` | no |
| Billed input / cache share | 124,537,827 at 93.24% cache-read | 270,077,294 at 89.42% cache-read | no |
| Tool keys | 21 (20 listed) | 22 (20 listed) | no |
| Loop rows | 29 (27 agy, 2 claude) | 92 (85 agy, 5 claude, 2 pi) | no |
| Pairings / dispatches / costed rows | 5 / 38 / 1 | 7 / 97 / 2 | no |
| Verified outcomes | denominator 1, excluded notDone 1, verified 0 | denominator 0, all rates `null` | no |

Structural gaps present in both artifacts: `#/derived/phases` is `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}` in both; the renders are corrupted identically in both (title duplication and unclosed fence at lines 3–4); and `#/loops` is dominated by agy rows carrying the same `argsDigest` in both (27 of 29 here, 85 of 92 there). Those are recorded per finding in section 5 as `not-comparable` with a discrete-presence note, not as trends.

## Findings

Ten problem findings: one P1, six P2, three P3. Every field set is complete; `trend` is `not-comparable` for all of them because the baseline was found `not comparable` in section 3. All commands are reproducible verbatim from the repository root and none was run by this report.

### F1 — 92.89% of tool calls carry no duration, so the tool-time bucket is one lane's measurement

- `key`: `telemetry:spur-history-import:tool-duration-unmeasured`
- `category`: `telemetry`
- `impact`: `toolMs` is 10.52% of the 23.51 h span, but it is computed from 676 of 9,507 calls (7.11%), and it equals the pi lane's `durationMs` to the millisecond. The agy lane contributes 8,299 calls (87.29% of all calls) and zero measured milliseconds; claude contributes 451, codex 80 and opencode 0, all zero. Every tool-latency statement and the bottleneck ranking describe 7.11% of the window's calls, and the 73.57% unattributed bucket is the arithmetic remainder.
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `toolCalls` 9,507 with `durationUnmeasured` 8,831. `#/bySource` reports `durationMs` 0 with `durationUnmeasured` 8,299 (agy), 0 / 451 (claude), 0 / 80 (codex), 0 / 0 (opencode) and 8,903,971 / 1 (pi). `#/byTool` reports `bash` 612 calls with `durationMsTotal` 8,903,702 and `durationUnmeasured` 1; `edit` 13 calls with 100 ms; `read` 39 calls with 94 ms; `ffgrep` 1 call with 60 ms; `write` 4 calls with 10 ms; `to&#100;o` 8 calls with 5 ms; and `durationMsTotal` 0 with every call unmeasured for `manage_task` (3,308), `run_command` (2,294), `read_file` (1,945), `edit_file` (572), `Bash` (324), `schedule` (108), `Read` (95), `exec` (80), `write_file` (72), `Skill` (12), `Write` (11), `ToolSearch` (4), `TaskStop` (2) and `Edit` (2). `#/derived/timeDecomposition` reports `toolMs` 8,903,971 against `spanMs` 84,636,977, and `#/warnings/0` states that 62,270,523 ms could not be attributed because some durations were unmeasured.
- `inference`: Two independent signals say the bucket is a single-lane measurement rather than a window total. First, `toolMs` equals `#/bySource/pi/durationMs` exactly (8,903,971 on both), so the aggregate is the pi lane by identity. Second, the 8,831 unmeasured calls concentrate in precisely the four lanes whose `durationMs` is 0 — agy, claude, codex and opencode — while the only lane with a non-zero value (pi) has 1 unmeasured call. Named observations: the `toolMs`/`bySource/pi` identity, the per-lane `durationMs` 0 with `durationUnmeasured` populated on four lanes, and the explicit `derived-unattributed-time` warning.
- `contradictions`: Partial measurement is not absent measurement: bash has 611 of 612 calls measured and holds 8,903,702 ms, so tool time does exist in this window — it is simply not attributable to the dominant lanes. Tool names do not identify lanes (`bash` is pi's, `run_command` is agy's, `exec` is codex's, `Bash` is claude's), so "untimed lane" cannot be inferred from a tool row alone. A `bash` call measured at 3,121,713 ms (52.0 min) also shows the measured subset is not uniform.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/byTool`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:66-68`
- `severity`: `P1`
- `reproCommand`: `jq -c '{calls:.totals.toolCalls,unmeasured:.totals.durationUnmeasured,fullyTimed:([.byTool[]|select(.durationUnmeasured==0)|.calls]|add),bashTimed:(.byTool[]|select(.toolName=="bash")|[.calls,.durationUnmeasured]),perSource:[.bySource|to_entries[]|{s:.key,tools:.value.toolCalls,ms:.value.durationMs,u:.value.durationUnmeasured}],toolMs:.derived.timeDecomposition.toolMs,piMs:.bySource.pi.durationMs,unattributed:.derived.timeDecomposition.unattributedMs,span:.derived.timeDecomposition.spanMs}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the agy, claude, codex and opencode lanes' per-tool-call duration emission, consumed by the `byTool` and `derived.timeDecomposition` folds in `spur history analyze`.

### F2 — the agy lane bills nothing across 16,956 records and 8,299 tool calls

- `key`: `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex`
- `category`: `telemetry`
- `impact`: 16,956 of 21,417 records (79.17%) — the entire agy lane — carry no provider usage, so nearly 80% of the window has no token figure and no cost. In this window, unlike the baseline artifact, `#/byModel/unknown` carries 16,958 records with 0 usage and `$0` cost, and `#/bySource/codex` matches its named model `gpt-6.1-sol` exactly (8,880,587 input tokens, `$5.722729` cost on both), so no usage was misattributed to codex; however, agy spend and token consumption remain completely unmeasured. Any statement of the form "lane X produced N% of spend" excludes 79.17% of the records.
- `trend`: `not-comparable`
- `observation`: `#/bySource/agy` reports `records` 16,956 with `recordsWithUsage` 0, `inputTokens` 0, `cacheReadTokens` 0, `cacheWriteTokens` 0, `costUsd` 0, `toolCalls` 8,299. `#/byModel/unknown` reports `records` 16,958, `recordsWithUsage` 0, `inputTokens` 0, `cacheReadTokens` 0, `outputTokens` 0, `costUsd` 0, `toolCalls` 8,299. `#/bySource/codex` reports `inputTokens` 8,880,587 and `costUsd` 5.722729, which equals `#/byModel["gpt-6.1-sol"]` exactly on both axes.
- `inference`: Two independent signals show that agy adapter records are entirely uninstrumented for provider token usage while the fold's source-model joins balance cleanly. First, `recordsWithUsage` is 0 across all 16,956 agy records, so the absence is total across the lane. Second, `byModel/unknown` carries 16,958 records with 0 usage (comprising 16,956 agy + 1 opencode + 1 unlabelled claude record), and codex equals its named model exactly, confirming the fold did not misattribute usage to another source this window. Named observations: the 16,956 agy records with zero usage, the exact codex-to-gpt-6.1-sol equality, and the zeroed unknown model row.
- `contradictions`: Totals reconcile across all axes — `#/bySource` and `#/byModel` each sum to every `#/totals` axis — so there is no arithmetic drift. Agy records do report assistant step durations (1,488,511 ms across 449 timed steps in `#/stepSupport`), so the lane is not entirely telemetry-less; the gap is specific to provider usage and cost.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/bySource/agy`, `#/bySource/codex`, `#/byModel`, `#/totals`
- `severity`: `P2`
- `reproCommand`: `jq -c '{agy:{rec:.bySource.agy.records,use:.bySource.agy.recordsWithUsage,cost:.bySource.agy.costUsd,tools:.bySource.agy.toolCalls},unknown:{rec:.byModel.unknown.records,use:.byModel.unknown.recordsWithUsage,in:.byModel.unknown.inputTokens,cost:.byModel.unknown.costUsd,tools:.byModel.unknown.toolCalls},codexIn:.bySource.codex.inputTokens,namedCodexIn:.byModel["gpt-6.1-sol"].inputTokens,codexCost:.bySource.codex.costUsd,namedCodexCost:.byModel["gpt-6.1-sol"].costUsd}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `bySource` / `byModel` joins and the agy adapter's provider usage extraction in `spur history import`.

### F3 — codex assistant durations are 2.64 ms mean per step on 100k-token prompts

- `key`: `telemetry:spur-history-import:codex-assistant-duration-implausible`
- `category`: `telemetry`
- `impact`: The `llmMs` bucket is presented as agent latency, but the lane with 41.73% of window cost ($5.722729) contributes 232 ms across 88 timed assistant steps — 2.64 ms per step — on prompts averaging ~100k tokens. Codex latency, tokens-per-second, and per-step throughput cannot be stated, and the time decomposition's LLM share is dominated by pi and agy rather than the lane that incurred the highest cost.
- `trend`: `not-comparable`
- `observation`: `#/bySource/codex` reports `assistantDurationMs` 232 with `assistantDurationUnmeasured` 1. `#/stepSupport` reports codex `assistantSteps` 89 with `stepsWithDuration` 88 and `stepsWithDerivedDuration` 88, against claude 857 / 814 / 814, agy 8,271 / 449 / 449, and pi 637 / 637 / 637. Per-timed-step means: codex `2.64` ms, claude `1,598.48` ms, agy `3,315.17` ms, pi `6,519.15` ms.
- `inference`: Two independent signals show the codex duration series is derived on a scale that cannot represent provider round trips. First, the absolute values: 88 assistant steps completing in 232 ms total (2.64 ms each) is below network transport latency, let alone LLM generation for 100k-token contexts. Second, the cross-lane contrast: 2.64 ms per codex step against 6,519.15 ms per pi step in the same artifact — a 2,469× gap computed by the same fold. Named observations: the 232 ms total over 88 steps, the per-step means by lane, and the fact that codex has 88 of 89 steps timed.
- `contradictions`: All lanes report `stepsWithDerivedDuration` equal to `stepsWithDuration` (codex 88/88, pi 637/637), so the derivation flag does not distinguish plausible from implausible series. Codex steps may represent streamed events rather than full prompt-response pairs, which would compress timestamp deltas; the artifact cannot distinguish granularity from derivation, so the causal claim is labelled a hypothesis with the confirmation path of comparing one codex step's recorded duration against request/response timestamps in the raw session record.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/bySource/codex`, `#/bySource/pi`, `#/stepSupport`, `#/derived/timeDecomposition`
- `severity`: `P2`
- `reproCommand`: `jq -c '{codexMs:.bySource.codex.assistantDurationMs,codexSteps:(.stepSupport[]|select(.source=="codex")|.assistantSteps),codexTimed:(.stepSupport[]|select(.source=="codex")|.stepsWithDuration),codexPerStep:(.bySource.codex.assistantDurationMs/(.stepSupport[]|select(.source=="codex")|.stepsWithDuration)),piPerStep:(.bySource.pi.assistantDurationMs/(.stepSupport[]|select(.source=="pi")|.stepsWithDuration)),piSteps:(.stepSupport[]|select(.source=="pi")|.assistantSteps)}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the codex assistant-step duration derivation, consumed by the `stepSupport` and `derived.timeDecomposition` folds in `spur history analyze`.

### F4 — the time decomposition does not reconcile: `llmMs` exceeds component assistant durations

- `key`: `telemetry:spur-history-analyze:time-decomposition-nonreconciling`
- `category`: `telemetry`
- `impact`: The rendered "LLM latency 2.4 h / 10%" (`current.md:65`) has no component-level breakdown: `llmMs` is 8,684,376 ms while the per-source assistant durations sum to 6,942,604 ms, so 1,741,772 ms (20.06% of the bucket) is attributed to LLM time by the bucket and to nothing by the individual lanes. An operator inspecting per-source latency is missing a fifth of the reported LLM time.
- `trend`: `not-comparable`
- `observation`: `#/derived/timeDecomposition` reports `llmMs` 8,684,376, `toolMs` 8,903,971, `idleMs` 4,778,107, `unattributedMs` 62,270,523 and `spanMs` 84,636,977; the four buckets sum to 84,636,977, exactly the span. `#/totals/assistantDurationMs` is 6,942,604 and equals the sum of the five `#/bySource[].assistantDurationMs` values (1,488,511 agy + 1,301,162 claude + 232 codex + 0 opencode + 4,152,699 pi). The excess of `llmMs` over `totals.assistantDurationMs` is 1,741,772 ms.
- `inference`: Two independent signals show the bucket and row derivations compute over different sets. First, `llmMs` exceeds the per-source assistant duration sum by 1,741,772 ms — the bucket cannot be the sum of the rows it is displayed beside. Second, this defect recurred from the baseline artifact, which had an excess of 4,310,395 ms, confirming that `llmMs` derivation divergence is an active defect in the analyzer fold. Named observations: the 1,741,772 ms excess, the exact sum of `bySource` assistant durations matching `totals`, and the exact bucket-to-span sum.
- `contradictions`: The four buckets do sum to the span exactly in this artifact (84,636,977 ms), so the decomposition balances against wall-clock time; the defect is internal attribution between the LLM bucket and per-source rows. A plausible mechanism is that `llmMs` includes durations from records filtered out of per-source assistant steps; this is a hypothesis with the confirmation path of logging intermediate record selections in `timeDecomposition`.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/derived/timeDecomposition`, `#/bySource`, `#/totals`, `#/stepSupport`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:65`
- `severity`: `P2`
- `reproCommand`: `jq -c '{llm:.derived.timeDecomposition.llmMs,srcAssistant:.totals.assistantDurationMs,llmExcess:(.derived.timeDecomposition.llmMs-.totals.assistantDurationMs),bucketSum:([.derived.timeDecomposition.llmMs,.derived.timeDecomposition.toolMs,.derived.timeDecomposition.idleMs,.derived.timeDecomposition.unattributedMs]|add),span:.derived.timeDecomposition.spanMs}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `derived.timeDecomposition` fold and the assistant-duration counters that feed it.

### F5 — the opencode lane's import checkpoint precedes the window start by 7.62 h

- `key`: `coverage:spur-history-import:opencode-lane-import-stale`
- `category`: `coverage`
- `impact`: The opencode lane's freshness cannot be assessed: its recorded `lastImportedAt` is `2026-11-07T00:22:47.082Z`, which is 7.62 h *before* the selector window starts (`2026-11-07T08:00:00Z`), while the same row reports 1 message inside that window with zero parse errors. A per-run checkpoint cannot precede the window and have imported the window's contents. Consequently, opencode completeness is undefined, and the field cannot serve as a reliable freshness marker.
- `trend`: `not-comparable`
- `observation`: `#/coverage/3` reports opencode `status` `ok`, `files` 1, `messages` 1, `toolCalls` 0, `parseErrors` 0, `validationErrors` 0, `lastImportedAt` `2026-11-07T00:22:47.082Z`. The selector window starts at `2026-11-07T00:00:00.000-08:00` (= `2026-11-07T08:00:00Z`), and `#/generatedAt` is `2026-11-07T16:15:33.165Z`. The other four lanes record checkpoints within seconds of generation (agy `16:15:27Z`, claude `16:15:23Z`, codex `16:15:25Z`, pi `16:15:13Z`), 8.25–8.26 h after window start. Claude's checkpoint, which was stale in baseline (5.00 h pre-window), is fresh here.
- `inference`: Two independent signals show that `lastImportedAt` reflects per-file last-scanned metadata rather than a run-level execution checkpoint. First, internal contradiction: an import timestamp written at 00:22:47Z cannot have processed a record occurring after 08:00:00Z if the timestamp records when import ran. Second, cross-lane contrast: four lanes update to the current minute while opencode retains a prior timestamp. Named observations: the 7.62 h pre-window timestamp against 1 in-window message, and the contrast with the four freshly updated lanes.
- `contradictions`: The volume impact is minimal: opencode accounts for 1 message, 0 tool calls, and $0 cost. The import status is `ok` with 0 errors, so data was not rejected. A per-file scan timestamp explains the observation if the file was scanned during a previous window and contained an in-window event; this is a hypothesis with the confirmation path of inspecting the file's modification time against the checkpoint write site in `spur history import`.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/coverage`, `#/generatedAt`, `#/selector`
- `severity`: `P2`
- `reproCommand`: `jq -c '{gen:.generatedAt,windowStart:.selector.since,opencode:(.coverage[]|select(.source=="opencode"))}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the opencode source lane's run checkpoint and per-file import coverage accounting.

### F6 — codex-sol scribe fails 2 of 11 dispatches, and codex-sol reviewer escalates capacity 3 times

- `key`: `reliability:codex-sol-executor:scribe-dispatch-failures`
- `category`: `reliability`
- `impact`: The codex-sol executor exhibits reliability pressure across both assigned roles: the scribe role fails 2 of 11 dispatches (18.18% failure rate) at a 76,953 ms mean duration, and the reviewer role records 3 `resource-exhaustion` escalations across 9 dispatches (33.3% capacity pressure). Scribe failures require retry or workflow restart, and capacity escalations indicate tight resource constraints on the executor carrying 41.73% of window spend.
- `trend`: `not-comparable`
- `observation`: `#/pairings` row (`executor` `codex-sol`, `role` `scribe`, `agent` `codex`) reports `dispatches` 11, `successRate` 0.81818, `failures` 2, `unknownOutcomes` 0, `escalations` `{}`, `totalCostUsd` `null`, `meanDurationMs` 76,953.09. The reviewer row (`executor` `codex-sol`, `role` `reviewer`, `agent` `antigravity-cli`) reports `dispatches` 9, `successRate` 1.0, `failures` 0, `unknownOutcomes` 0, `escalations` `{"resource-exhaustion": 3}`, `meanDurationMs` 216,499.44. In the baseline artifact, codex-sol scribe also failed 2 of 16 dispatches (`successRate` 0.875) and codex-sol reviewer escalated 6 times.
- `inference`: Two independent signals show that codex-sol faces recurrent execution and capacity hurdles. First, scribe failures recur across two independent windows (2 failures in baseline, 2 failures here). Second, capacity escalations occur on 3 of 9 reviewer dispatches even while reporting terminal success, proving that capacity pressure is active during the run. Named observations: the 2 scribe failures, the 3 reviewer escalations, and the recurring failure count from baseline.
- `contradictions`: Reviewer dispatches achieved 100% terminal success (9 of 9), so capacity escalation did not cause terminal reviewer failure. `totalCostUsd` is `null` on both rows, so the financial cost of failed scribe dispatches is `not available`.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.json` — `#/pairings`
- `severity`: `P2`
- `reproCommand`: `jq -c '[.pairings[]|select(.executor=="codex-sol")|{e:.executor,r:.role,d:.dispatches,sr:.successRate,f:.failures,esc:.escalations,ms:.meanDurationMs}]' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: the `codex-sol` ladder entries (`#/ladderSnapshot`, order 20 tier `capable-2` and order 14 tier `capable-1`) and the dispatch retry policy for scribe tasks.

### F7 — the single in-scope task was excluded as notDone, leaving the value axis empty

- `key`: `coverage:spur-task-check:verified-outcome-absent`
- `category`: `coverage`
- `impact`: `taskDenominator` moved from 0 to 1, but the sole in-scope task was excluded with `notDone: 1`, leaving `verifiedResults` 0, `verifiedRate` 0, `verifiedWithoutCorrectionRate` 0, and `costCoverage` `{covered: 0, total: 0}`. The report describes 23.51 h of activity and `$13.714020` of spend, but cannot calculate cost per verified result — the metric that links expenditure to verified delivered value.
- `trend`: `not-comparable`
- `observation`: `#/verifiedOutcome` reports `taskDenominator` 1, `verifiedResults` 0, `verifiedRate` 0, `verifiedWithoutCorrection` 0, `verifiedWithoutCorrectionRate` 0, `correctionCount` 0, `correctionRate` 0, `retryExhaustedCount` 0, `measuredTokensPerVerifiedResult` `null`, `timeToVerified` `{count: 0, meanMs: null, maxMs: null}`, `costCoverage` `{covered: 0, total: 0}`, and `excludedReasons` `{notDone: 1, forcedDone: 0, missingVerdict: 0, syntheticVerdict: 0, verdictNotPass: 0, proofAbsent: 0, certifyingRunFailed: 0}`.
- `inference`: Two independent signals show that task activity exists but failed to yield verified output within the observation window. First, `taskDenominator` is 1 with `excludedReasons.notDone` 1, confirming a task was tracked but remained incomplete at generation time. Second, extensive task-related tooling ran during the window (`manage_task` 3,308 calls, `to&#100;o` 8 calls, `TaskStop` 2 calls) without producing a PASS verdict. Named observations: `taskDenominator` 1 with `notDone` 1, `verifiedResults` 0, and 3,308 `manage_task` calls.
- `contradictions`: The denominator is non-zero (1 vs 0 in baseline), showing the task-to-window join is functional; the absence of verified results is due to task lifecycle state (in-progress/not done) in a provisional window rather than a broken query join.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`
- `severity`: `P2`
- `reproCommand`: `jq -c '.verifiedOutcome' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur task check` — the verification gate whose PASS proof the `verifiedOutcome` fold reads — together with the task completion workflow in `spur history analyze`.

### F8 — the pairing fold prices 1 of 5 rows, covering 18.4% of dispatches

- `key`: `coverage:pairing-analytics:cost-coverage-partial`
- `category`: `coverage`
- `impact`: Per-stage cost is the metric that makes agent dispatch alternatives comparable. In this window, only 1 of 5 pairing rows carries `totalCostUsd` (`pi-dsv4.1-flash-volc` reviewer: `$11.752528`), covering 7 of 38 dispatches (18.42%). `model` is `null` on all 5 rows, and four pairings (agy-gemini reviewer, claude reviewer, codex-sol reviewer, codex-sol scribe) accounting for 31 dispatches (81.58%) carry no cost at all.
- `trend`: `not-comparable`
- `observation`: `#/pairings` rows: `agy-gemini` reviewer 2 dispatches cost `null`; `claude` reviewer 9 dispatches cost `null`; `codex-sol` reviewer 9 dispatches cost `null`; `codex-sol` scribe 11 dispatches cost `null`; `pi-dsv4.1-flash-volc` reviewer 7 dispatches cost `$11.752528`. Total dispatches: 38. Costed dispatches: 7. `model` is `null` on all 5 rows.
- `inference`: Two independent signals show the gap is an agent-specific cost join rather than dispatch tracking. First, duration and dispatch counts are 100% populated across all 5 rows, so dispatch accounting succeeds. Second, cost is populated solely on the `pi` agent row, while `claude`, `antigravity-cli`, and `codex` rows all have `null` cost, repeating the per-agent join failure seen in baseline. Named observations: 1 of 5 costed rows, 5 of 5 rows with populated durations, and `model` null on all rows.
- `contradictions`: The single costed row covers `$11.752528`, which represents 85.70% of the `$13.714020` window spend, so the dollar coverage is high even while dispatch coverage (18.42%) is low. `null` is the contract-correct rendering for an absent signal.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`
- `severity`: `P3`
- `reproCommand`: `jq -c '{rows:(.pairings|length),costed:([.pairings[]|select(.totalCostUsd!=null)]|length),dispatches:([.pairings[].dispatches]|add),costedDispatches:([.pairings[]|select(.totalCostUsd!=null)|.dispatches]|add),costSum:([.pairings[].totalCostUsd|select(.!=null)]|add),dayCost:.totals.costUsd}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the pairing analytics fold's cost and model joins for non-pi agent runners.

### F9 — the loop fold's argument digest is `sha256(null)` on 27 of 29 rows

- `key`: `telemetry:spur-history-analyze:loop-args-digest-null`
- `category`: `telemetry`
- `impact`: 27 of 29 loop rows belong to the agy lane and all carry the identical `argsDigest` (`74234e98afe7498fb5daf1f36ac2d78a...`), which is `sha256` of JSON `null`. The fold reports "3,284 repeats of `manage_task`", "1,939 repeats of `run_command`" and "1,939 repeats of `read_file`", which represent calls whose arguments were never captured rather than identical invocations. An operator cannot distinguish true tool repetition from uninstrumented argument capture.
- `trend`: `not-comparable`
- `observation`: `#/loops` holds 29 rows: 27 agy, 2 claude. All 27 agy rows share the digest prefix `74234e98afe7498f...` and carry `model` `unknown`. Repeats across those 27 rows sum to 8,299 — exactly equal to `#/bySource/agy/toolCalls` (8,299). The 2 claude rows carry a real digest (`18ddf2777bc09984af698719fcf8750b...`) for `Read` with 3 repeats each (summing to 6 repeats out of 451 claude tool calls).
- `inference`: Three signals show the digest is an absent-argument constant that groups all calls of a tool together. First, the digest matches `sha256(null)`. Second, agy loop repeats equal total agy tool calls to the unit (8,299), meaning zero agy calls were filtered as non-repeating singletons. Third, the claude lane does filter singletons (6 repeats of 451 calls), proving the singleton filter requires a real digest. Named observations: the `sha256(null)` value, the exact 8,299 sum equality, and the contrasting claude rows with real digests.
- `contradictions`: The agy rows are segregated by session and tool name, so session-level grouping functions correctly. Within a session, high counts of `manage_task` (3,284) may still reflect repetitive polling, but the lack of argument data prevents verification.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/loops`, `#/bySource/agy`, `#/population/loops`
- `severity`: `P3`
- `reproCommand`: `jq -c '{rows:(.loops|length),agyRows:([.loops[]|select(.source=="agy")]|length),agyRepeats:([.loops[]|select(.source=="agy")|.repeats]|add),agyCalls:.bySource.agy.toolCalls,nullDigestRows:([.loops[]|select(.argsDigest|startswith("74234e98afe7498f"))]|length)}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the loop fold's `argsDigest` derivation and singleton filter as fed by the agy adapter in `spur history import`.

### F10 — both renders open with a duplicated title inside an unclosed code fence

- `key`: `workflow:spur-history-report:render-title-corrupted`
- `category`: `workflow`
- `impact`: Both rendered markdown files open with a malformed header — an unclosed opening code fence followed by a self-overlapping title string — placing all 196 lines of the current render inside a single code block. Automated markdown parsers, document formatters, and visual readers encounter corrupted document structure.
- `trend`: `not-comparable`
- `observation`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:3` is a bare opening fence and line 4 reads `# History forensics report — generated 2026-11-07T16:1# History forensics report — generated 2026-11-07T16:15:33.165Z`; the file contains exactly one line matching `^```` ``` across its 196 lines. `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.md:3-4` is corrupted identically with timestamp `2026-11-07T16:15:36.113Z`, and holds one such line across 211 lines.
- `inference`: The shared `...T16:1` prefix before the full title proves the renderer emits a partial title string followed by the complete title. The identical malformation across two separately generated files confirms a single buggy code path in `spur history report`. Named observations: lines 3–4 of current and baseline renders, the single unclosed fence in each, and the identical overlapping title pattern.
- `contradictions`: The underlying artifact JSON is completely valid — `#/generatedAt` is well-formed in both (`2026-11-07T16:15:33.165Z` and `2026-11-07T16:15:36.113Z`) — so the defect is strictly confined to the markdown serializer.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:3-4`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.md:3-4`
- `severity`: `P3`
- `reproCommand`: `sed -n '1,5p' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md; grep -c '^```' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md`
- `ownerSurface`: `spur history report` — the markdown header and code-fence writer in the forensics report generator.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count or impact change is computed or implied. The final column records whether the same signal class is discretely present in the baseline artifact and what a comparable baseline would require.

| Stable key | Recurrence class | Severity now | Discrete baseline presence and what a comparable baseline would need |
| --- | --- | --- | --- |
| `telemetry:spur-history-import:tool-duration-unmeasured` | `not-comparable` | P1 | Present in baseline at 75.33% unmeasured (7,310 of 9,704 calls); worse here at 92.89% unmeasured (8,831 of 9,507 calls). All non-pi lanes emit 0 ms in both artifacts. A comparable baseline requires equal elapsed duration and identical lane instrumentation. |
| `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex` | `not-comparable` | P2 | Partly present: baseline agy was also usage-less (0 of 13,347 records with usage), but had 1 usage-bearing record folded into codex; here agy has 0 usage across 16,956 records and codex balances with its named model cleanly. A comparable baseline requires identical usage attribution rules. |
| `telemetry:spur-history-import:codex-assistant-duration-implausible` | `not-comparable` | P2 | Present in baseline at 3.07 ms per step (1,025 ms across 334 steps); present here at 2.64 ms per step (232 ms across 88 steps). Both artifacts exhibit millisecond-scale step durations on 100k-token prompts. A comparable baseline requires the same codex derivation semantics. |
| `telemetry:spur-history-analyze:time-decomposition-nonreconciling` | `not-comparable` | P2 | Present in baseline with an excess of 4,310,395 ms; present here with an excess of 1,741,772 ms. In both artifacts, `llmMs` exceeds the sum of per-source assistant durations. A comparable baseline requires consistent bucket derivation across both runs. |
| `coverage:spur-history-import:opencode-lane-import-stale` | `not-comparable` | P2 | Absent on opencode in baseline (opencode was not imported); but the same defect class was present on claude in baseline (`lastImportedAt` 5.00 h pre-window). Claude's checkpoint is fresh here, while opencode sits 7.62 h pre-window. A comparable baseline requires all lanes imported in both windows. |
| `coverage:spur-history-import:claude-lane-import-stale` | `not-comparable` | P2 | Present in baseline (`lastImportedAt` 2026-11-06T03:00:02Z, 5.00 h pre-window); resolved in current where claude imported fresh at 16:15:23Z. Listed for stable-key tracking under a not-comparable baseline. |
| `reliability:codex-sol-executor:scribe-dispatch-failures` | `not-comparable` | P2 | Present in baseline: codex-sol scribe failed 2 of 16 dispatches (`successRate` 0.875); here it failed 2 of 11 dispatches (`successRate` 0.818), alongside 3 capacity escalations on reviewer dispatches. |
| `reliability:claude-executor:reviewer-dispatch-failures` | `not-comparable` | P2 | Present in baseline: claude reviewer failed 7 of 16 dispatches (43.75% failure rate, 5 capacity escalations); absent here, where claude reviewer completed 9 of 9 dispatches (100% success rate, 0 failures, 0 escalations). Listed for tracking. |
| `coverage:spur-task-check:verified-outcome-absent` | `not-comparable` | P2 | Present in baseline: `taskDenominator` was 0; here `taskDenominator` is 1, but excluded as `notDone`, yielding 0 verified results and all rates 0 in both artifacts. |
| `reliability:minimax-executor:scribe-dispatch-failure-total` | `not-comparable` | P3 | Present in baseline: minimax failed 6 of 6 scribe dispatches at 6.2 s mean duration; absent here, where minimax was not dispatched. Listed for tracking. |
| `coverage:pairing-analytics:cost-coverage-partial` | `not-comparable` | P3 | Present in baseline (2 of 7 rows costed, $1.67, 4.12% of dispatches); present here at 1 of 5 rows costed ($11.75, 18.42% of dispatches). Both artifacts leave `model` `null` across all rows. |
| `telemetry:spur-history-analyze:loop-args-digest-null` | `not-comparable` | P3 | Present in baseline (85 of 92 rows carried `sha256(null)`, summing to 6,851 agy calls); present here on 27 of 29 rows, summing to 8,299 agy calls (100% of agy calls). A comparable baseline requires real argument hashing. |
| `telemetry:spur-history-analyze:per-step-cost-basis-mismatch` | `not-comparable` | P3 | Present in baseline: 13 steps flagged in `#/cacheWaste` with rate mismatch; absent here, where `#/cacheWaste` reports 0 steps and 0 tokens. Listed for tracking. |
| `workflow:spur-history-report:render-title-corrupted` | `not-comparable` | P3 | Present identically in both renders: line 3 opening fence unclosed, line 4 duplicated title prefix. A comparable baseline requires renderer fix verification. |
| `positive:spur-history-import:clean-import-and-tool-runs` | `not-comparable` | P3 | Present in baseline: 0 parse/validation errors across 326 files, 0 tool errors across 5,560 calls; present here: 0 parse/validation errors across 199 files, 0 tool errors across 9,507 calls. |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `not-comparable` | P3 | Present in baseline: `codex-sol` reviewer 34 of 34; present here: `claude` reviewer 9 of 9, `agy-gemini` reviewer 2 of 2, `codex-sol` reviewer 9 of 9, 0 unknown outcomes across all 38 dispatches. |
| `positive:spur-history-import:pi-complete-measurement-axis` | `not-comparable` | P3 | Present in baseline: pi fully instrumented (2,634 steps); present here: 637 of 637 steps with usage/duration/cache-read, 676 of 677 tool calls timed, 96.54% cache reuse at $0.0649/1M. |
| `positive:spur-history-analyze:source-and-model-folds-sum-to-totals` | `not-comparable` | P3 | Present in baseline: all source/model totals reconciled; present here: 10 source checks and 7 model checks equal totals exactly, and time buckets sum to spanMs. |

## Telemetry gaps

Dimensions the artifact cannot support. Each renders `not available`; none is inferred from raw history files.

| Dimension | Rendering | Why | Anchor |
| --- | --- | --- | --- |
| Duration for 8,831 of 9,507 tool calls | `not available` | Four lanes report `durationMs` 0 with populated `durationUnmeasured` (agy 8,299, claude 451, codex 80, opencode 0); only pi is timed | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/byTool`, `#/bySource`, `#/totals` |
| Provider usage on 20,271 of 21,417 records | `not available` | `#/totals/recordsWithUsage` is 1,146 of 21,417 (5.35%); agy 0 of 16,956, codex 76 of 874, claude 433 of 2,027, opencode 0 of 1, pi 637 of 1,559 | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/totals`, `#/bySource` |
| Token and cost attribution for the agy lane | `not available` | `#/bySource/agy` reports 0 on every token axis and $0 cost over 16,956 records (79.17% of window records) | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/bySource/agy`, `#/byModel/unknown` |
| Codex per-step assistant latency | `not available` | 232 ms over 88 steps with 100k-token prompts recorded at 2.64 ms mean; the series cannot represent provider round trips | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/bySource/codex`, `#/stepSupport` |
| Component breakdown of `llmMs` | `not available` | `llmMs` 8,684,376 exceeds `assistantDurationMs` 6,942,604 by 1,741,772 ms, so 20.06% of the bucket has no per-source row | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/derived/timeDecomposition`, `#/bySource` |
| Message-count reconciliation between `#/coverage` and `#/bySource` | `not available` | `#/coverage` sums to 21,946 messages against `#/totals` 21,417; the difference sits in agy (17,061 vs 16,956) and claude (2,451 vs 2,027) | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/coverage`, `#/bySource`, `#/totals` |
| One of 21 tool keys | `not available` | `#/population/tools` reports 21 against `#/byTool` 20 rows; listed rows cover 9,506 of 9,507 calls (99.99%) | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/population`, `#/byTool` |
| Result bytes for non-claude tools | `not available` | `resultBytes` is populated only on five claude tool rows (Read 507.1 KB, Bash 459.1 KB, Write 2.3 KB, ToolSearch 1.8 KB, TaskStop 1.5 KB, Edit 419 B, Skill 427 B); all agy, codex, and pi tool rows report 0 B | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/byTool` |
| Tool command and argument text | `not available` | `byTool` carries no command text; `#/loops` exposes only `argsDigest`, which is `sha256(null)` on 27 of 29 rows | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Loop repetition below the fold's threshold | `not available` | `#/loops` reports only signatures repeating at least 3 times; single and double repeats are not surfaced | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/loops`, `#/population/loops` |
| Per-session detail beyond the top 20 | `not available` | `#/population/sessions` reports 52 against `appliedTop` 20; 32 sessions and `$3.989637` (29.09% of cost) have no per-session row | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/population`, `#/bySession`, `#/totals` |
| Per-pairing cost and model for 4 pairings | `not available` | `totalCostUsd` is `null` on 4 of 5 rows; `model` is `null` on all 5 rows | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/pairings` |
| Verified-rate and cost per verified result | `not available` | `taskDenominator` is 1, but excluded as `notDone`; `verifiedResults` 0, and all outcome rates 0 | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/verifiedOutcome` |
| Per-phase breakdown | `not available` | `phaseSupport` is `supported` with an empty `phases` array and `invalidPhaseCount` 0 | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/derived/phases` |
| Cache-write volume on non-claude lanes | `not available` | `cacheWriteTokens` is non-zero only on claude (1,346,354) while agy, codex, opencode, and pi report 0 | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/totals`, `#/bySource` |
| Opencode lane completeness (freshness field) | `not available` | The opencode checkpoint precedes the window start by 7.62 h yet the row counts 1 in-window message | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/coverage/3`, `#/generatedAt`, `#/selector` |
| The current day's remaining 15.74 h | `not available` | The window is `provisional` and 34.41% elapsed at generation; all figures describe a partial-day snapshot | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-provenance.json` — `windowState`; `#/generatedAt`, `#/selector` |
| Workflow digest and provenance model | `not available` | Provenance records `workflowDigest`, `model` and `spurVersion` as `not available` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-provenance.json` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` on four axes in section 3, including 34.41% elapsed coverage vs a completed day | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.json` |

Attribution note for the 73.57% unattributed bucket: `#/warnings/0` states that `62270523ms` could not be attributed because some durations were unmeasured, pointing to the per-source step-support matrix. Combined with F1 (8,831 untimed calls), F3 (2.64 ms codex step duration) and F4 (`llmMs` above component rows), unattributed time is the arithmetic shadow of measurement gaps, not idle workload.

## Remediation options

Proposals only. Nothing below has been applied, no diff is produced, and no command here was run by this report. Each option carries the printed `spur task create` handoff that lands it, with the finding's stable key in the task text so the next report classifies that finding as `resolved`. The operator remains the gate: a model-authored report never writes to the task corpus.

**R1 — emit per-call tool timing on the agy, claude, codex and opencode lanes** (addresses `telemetry:spur-history-import:tool-duration-unmeasured`)

- Owner surface: `spur history import` — the per-tool-call duration record for the four untimed lanes, consumed by `byTool` and `derived.timeDecomposition`.
- Expected impact: `toolMs` stops being one lane's identity and covers up to 9,507 calls; the 73.57% unattributed bucket shrinks by the share currently hiding untimed calls; the bottleneck ranking stops leading with an instrumentation residual.
- Verification method: a fresh artifact reports `#/totals/durationUnmeasured` near 0 against `#/totals/toolCalls`, non-zero `durationMs` on at least one of agy/claude/codex/opencode, and `#/warnings` free of `derived-unattributed-time`.
- Reversibility: reversible — an importer field mapping; a re-import rebuilds the rows and reverting the mapping restores today's behaviour.
- Handoff: `spur task create "telemetry:spur-history-import:tool-duration-unmeasured — emit per-call tool timing on agy, claude, codex and opencode lanes" --template issue`

**R2 — extract provider usage for agy records and populate agy model tokens** (addresses `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex`)

- Owner surface: `spur history import` — the agy adapter's provider usage extraction and `spur history analyze` model resolution joins.
- Expected impact: agy reports its own input tokens, output tokens, cache read, and cost across its 16,956 records, or explicitly renders the dimension `not available`; per-lane spend becomes readable for 79.17% of the window's records.
- Verification method: a fresh artifact reports non-zero `#/bySource/agy/inputTokens` and `#/bySource/agy/costUsd` with populated `#/byModel` entries for agy models, or an explicit `not available` marker on that lane.
- Reversibility: reversible — adapter extraction and fold join changes; no historical logs are modified.
- Handoff: `spur task create "telemetry:spur-history-import:agy-zero-usage-attributed-to-codex — extract provider usage for agy adapter" --template issue`

**R3 — correct or explicitly invalidate codex per-step duration derivation** (addresses `telemetry:spur-history-import:codex-assistant-duration-implausible`)

- Owner surface: `spur history import` — the codex assistant-step duration derivation, consumed by `stepSupport` and `derived.timeDecomposition`.
- Expected impact: `llmMs` becomes a meaningful latency metric for the lane generating 41.73% of spend ($5.722729), or codex latency renders `not available` rather than 2.64 ms; prevents the LLM bucket from misrepresenting codex execution.
- Verification method: a fresh artifact reports codex per-step duration in a plausible range for 100k-token prompts (e.g. seconds, not milliseconds), or `#/bySource/codex/assistantDurationMs` renders `not available` with an explicit reason.
- Reversibility: reversible — derivation logic in importer; raw session transcripts are untouched.
- Handoff: `spur task create "telemetry:spur-history-import:codex-assistant-duration-implausible — fix or invalidate codex step duration derivation" --template issue`

**R4 — reconcile `llmMs` with per-source assistant rows in timeDecomposition** (addresses `telemetry:spur-history-analyze:time-decomposition-nonreconciling`)

- Owner surface: `spur history analyze` — the `derived.timeDecomposition` fold and the assistant-duration counters feeding it.
- Expected impact: the LLM bucket equals the sum of its source rows exactly, or explicitly breaks out any derived residual; eliminates the 1,741,772 ms unattributed gap within the LLM bucket.
- Verification method: a fresh artifact reports `llmMs` equal to the sum of `#/bySource[].assistantDurationMs` within 1 ms, and the four buckets continue to sum to `spanMs`.
- Reversibility: reversible — fold calculation change; no stored artifacts are modified.
- Handoff: `spur task create "telemetry:spur-history-analyze:time-decomposition-nonreconciling — reconcile llmMs with per-source assistant rows" --template issue`

**R5 — ensure import checkpoints lie within or after the imported window** (addresses `coverage:spur-history-import:opencode-lane-import-stale`)

- Owner surface: `spur history import` — the per-source import checkpoint recording in `#/coverage`.
- Expected impact: `lastImportedAt` becomes a genuine run-level timestamp reflecting when import executed, resolving the paradox of a checkpoint preceding the window it imports by 7.62 h; lane freshness becomes determinable.
- Verification method: a fresh artifact reports all `#/coverage[].lastImportedAt` timestamps at or after the selector window start (`since`), with timestamps corresponding to the execution time of `spur history import`.
- Reversibility: reversible — importer checkpoint persistence logic.
- Handoff: `spur task create "coverage:spur-history-import:opencode-lane-import-stale — ensure import checkpoints reflect run execution time" --template issue`

**R6 — improve retry policy for codex-sol scribe dispatches and monitor capacity escalations** (addresses `reliability:codex-sol-executor:scribe-dispatch-failures`)

- Owner surface: the `codex-sol` ladder entries (`#/ladderSnapshot`, order 20 tier `capable-2` and order 14 tier `capable-1`) and the dispatch retry policy for scribe tasks.
- Expected impact: reduces scribe dispatch failures (2 of 11 failed) and manages capacity exhaustion on reviewer dispatches (3 escalations), ensuring tasks complete without operator intervention.
- Verification method: a subsequent artifact reports a higher `successRate` for `codex-sol` scribe at comparable dispatches, and reduced `resource-exhaustion` escalations on reviewer dispatches.
- Reversibility: reversible — dispatch configuration and retry settings.
- Handoff: `spur task create "reliability:codex-sol-executor:scribe-dispatch-failures — improve scribe retry policy and capacity handling" --template issue`

**R7 — join in-progress task outcomes with verification checks upon completion** (addresses `coverage:spur-task-check:verified-outcome-absent`)

- Owner surface: `spur task check` (the proof-producing gate) and the `verifiedOutcome` fold in `spur history analyze`.
- Expected impact: tasks that complete and verify produce PASS proof that the fold incorporates, enabling calculation of `verifiedRate`, `timeToVerified`, and cost per verified result.
- Verification method: a subsequent artifact for a closed window reports `taskDenominator > 0` with `verifiedResults > 0` and non-null `measuredTokensPerVerifiedResult`.
- Reversibility: reversible — query joins and verification reporting.
- Handoff: `spur task create "coverage:spur-task-check:verified-outcome-absent — connect verified task outcomes to history analytics" --template issue`

**R8 — extend pairing cost joins across all agent runners and document model identity** (addresses `coverage:pairing-analytics:cost-coverage-partial`)

- Owner surface: the pairing analytics fold's cost and model joins in `spur history analyze`.
- Expected impact: all chained `agent.run` stages report `totalCostUsd` and resolved `model` identity, expanding cost coverage from 18.42% to 100% of dispatches.
- Verification method: a fresh artifact reports non-null `totalCostUsd` and non-null `model` across all rows in `#/pairings`.
- Reversibility: reversible — fold join predicates.
- Handoff: `spur task create "coverage:pairing-analytics:cost-coverage-partial — extend pairing cost joins across all agent runners" --template issue`

**R9 — capture tool invocation arguments for agy adapter or mark argument digest absent** (addresses `telemetry:spur-history-analyze:loop-args-digest-null`)

- Owner surface: `spur history import` agy adapter argument extraction, and `spur history analyze` loop fold.
- Expected impact: `argsDigest` becomes a real cryptographic hash of tool arguments, allowing the singleton filter to separate genuine tool loops from distinct commands; removes 8,299 false repeats on `sha256(null)`.
- Verification method: a fresh artifact reports distinct `argsDigest` values on agy loop rows whose repeats sum to far fewer than total tool calls, or explicitly marks argument text `not available`.
- Reversibility: reversible — hash derivation and adapter parsing.
- Handoff: `spur task create "telemetry:spur-history-analyze:loop-args-digest-null — capture real tool arguments for agy adapter" --template issue`

**R10 — emit markdown report header once and close the opening code fence** (addresses `workflow:spur-history-report:render-title-corrupted`)

- Owner surface: `spur history report` — markdown header and code-fence emitter for `--mode forensics`.
- Expected impact: eliminates title string duplication, balances code fences, and ensures the markdown body is rendered as valid markdown rather than enclosed in an unclosed fence.
- Verification method: `sed -n '1,5p'` on a generated render shows the title exactly once, and `grep -c '^```'` returns an even number (or 0 outside code blocks).
- Reversibility: reversible — renderer template fix.
- Handoff: `spur task create "workflow:spur-history-report:render-title-corrupted — emit title once and balance code fences in report renderer" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 84,636,977 ms = 23.51 h against a 24.0 h window):

| Component | Time | Share of span |
| --- | ---: | ---: |
| Unattributed (unmeasured durations) | 17.30 h (62,270,523 ms) | 73.57% |
| Tool execution | 2.47 h (8,903,971 ms) | 10.52% |
| LLM latency (assistant duration, summed) | 2.41 h (8,684,376 ms) | 10.26% |
| Idle / overhead | 1.33 h (4,778,107 ms) | 5.65% |

Reading: the four buckets sum to `spanMs` exactly (84,636,977 ms), but the breakdown is distorted by measurement gaps. Unattributed time (73.57%) is an instrumentation residual resulting from 8,831 untimed tool calls across agy, claude, codex, and opencode (`#/warnings/0`). Tool execution time (10.52%) equals the pi lane's `durationMs` to the millisecond (F1). LLM latency exceeds the sum of per-source assistant durations by 1,741,772 ms (F4), and codex contributes only 232 ms despite accounting for 41.73% of window spend (F3). The span is 23.51 h, excluding 4 sessions with unusable timestamps (`spanExcludedSessions: 4`).

**Per-step latency by source** (`#/bySource`, `#/stepSupport`) — the axis explaining the LLM bucket:

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per timed step | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: |
| codex | 89 | 88 (1 missing) | 232 ms | 2.64 ms | 46.93% |
| claude | 857 | 814 (43 missing) | 1,301,162 ms | 1,598.48 ms | 97.16% |
| agy | 8,271 | 449 (7,822 missing) | 1,488,511 ms | 3,315.17 ms | `not available` |
| pi | 637 | 637 (complete) | 4,152,699 ms | 6,519.15 ms | 96.54% |
| opencode | 0 | 0 (0 missing) | 0 ms | `not available` | `not available` |

The 2,469× per-step gap between codex (2.64 ms) and pi (6,519.15 ms) indicates codex step durations represent event deltas rather than model latency (F3). Agy has 8,271 assistant steps but only 449 measured durations (94.57% missing). Pi is 100% measured across all 637 steps. The largest single step duration in the window is a pi `glm-5.3-flash` step at 2,056,204 ms (34.27 min), followed by a pi `deepseek-v4-1-flash-261017` step at 1,027,344 ms (17.12 min).

**Tool execution** (`#/byTool`; instrumented total 8,903,971 ms):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| bash | 612 | 8,903,702 ms | 14,572 ms | 3,121,713 ms | 1 |
| edit | 13 | 100 ms | 7 ms | 16 ms | 0 |
| read | 39 | 94 ms | 2 ms | 7 ms | 0 |
| ffgrep | 1 | 60 ms | 60 ms | 60 ms | 0 |
| write | 4 | 10 ms | 2 ms | 4 ms | 0 |
| to&#100;o | 8 | 5 ms | 0 ms | 1 ms | 0 |
| manage_task | 3,308 | `not available` | `not available` | `not available` | 3,308 |
| run_command | 2,294 | `not available` | `not available` | `not available` | 2,294 |
| read_file | 1,945 | `not available` | `not available` | `not available` | 1,945 |
| edit_file | 572 | `not available` | `not available` | `not available` | 572 |
| Bash | 324 | `not available` | `not available` | `not available` | 324 |
| schedule | 108 | `not available` | `not available` | `not available` | 108 |
| Read | 95 | `not available` | `not available` | `not available` | 95 |
| exec | 80 | `not available` | `not available` | `not available` | 80 |
| write_file | 72 | `not available` | `not available` | `not available` | 72 |
| Skill | 12 | `not available` | `not available` | `not available` | 12 |
| Write | 11 | `not available` | `not available` | `not available` | 11 |
| ToolSearch | 4 | `not available` | `not available` | `not available` | 4 |
| TaskStop | 2 | `not available` | `not available` | `not available` | 2 |
| Edit | 2 | `not available` | `not available` | `not available` | 2 |

Only the pi lane's tool calls are instrumented; 676 of 9,507 calls (7.11%) carry durations. `bash` accounts for 99.99% of all measured tool time (8,903,702 ms) with a mean of 14.57 s and a maximum of 3,121,713 ms (52.03 min). Fourteen tool keys accounting for 8,831 calls are 100% untimed. Tool-name aliases fragment operations: shell tools split across `run_command` 2,294, `bash` 612, `Bash` 324, and `exec` 80 (3,310 calls); read tools across `read_file` 1,945, `Read` 95, and `read` 39 (2,079 calls); edit tools across `edit_file` 572, `edit` 13, and `Edit` 2 (587 calls); task tools across `manage_task` 3,308, `to&#100;o` 8, and `TaskStop` 2 (3,318 calls).

**Cost and tokens by source** (`#/bySource`, `#/totals`, total `$13.714020`):

| Source | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cost / 1M billed input | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| codex | 874 | 8,880,587 | 4,167,552 | 0 | 46,273 | `$5.722729` | 41.73% | $0.6444 | 46.93% |
| pi | 1,559 | 68,223,218 | 65,864,192 | 0 | 413,881 | `$4.428431` | 32.29% | $0.0649 | 96.54% |
| claude | 2,027 | 47,434,022 | 46,086,778 | 1,346,354 | 237,346 | `$3.562860` | 25.98% | $0.0751 | 97.16% |
| agy | 16,956 | 0 | 0 | 0 | 0 | `$0` | 0.00% | `not available` | `not available` |
| opencode | 1 | 0 | 0 | 0 | 0 | `$0` | 0.00% | `not available` | `not available` |

Window totals: billed input 124,537,827 (fresh 7,072,951 · cache-read 116,118,522 · cache-write 1,346,354), output 697,500, overall cache-hit ratio 93.24%, provider usage present on 1,146 of 21,417 records (5.35%). Codex is the most expensive lane on a per-token basis ($0.6444 per 1M billed input, 9.93× pi's $0.0649) and holds the plurality of cost (41.73%) despite generating only 7.13% of input tokens. Pi is the high-volume lane (54.78% of input tokens) operating at 96.54% cache reuse. Claude delivers 38.09% of input tokens at 97.16% cache reuse, accounting for 25.98% of cost and all recorded cache-write tokens (1,346,354).

**Chained `agent.run` run cost** (per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Agent | Dispatches | Success rate | Failures | Unknown outcomes | Escalations | Total cost | Mean duration |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| `agy-gemini` | reviewer | antigravity-cli | 2 | 1.00 | 0 | 0 | none | `not available` | 531,010.65 ms (8.85 min) |
| `claude` | reviewer | claude | 9 | 1.00 | 0 | 0 | none | `not available` | 257,799.57 ms (4.30 min) |
| `codex-sol` | reviewer | antigravity-cli | 9 | 1.00 | 0 | 0 | `resource-exhaustion`: 3 | `not available` | 216,499.44 ms (3.61 min) |
| `codex-sol` | scribe | codex | 11 | 0.82 | 2 | 0 | none | `not available` | 76,953.09 ms (1.28 min) |
| `pi-dsv4.1-flash-volc` | reviewer | pi | 7 | 0.86 | 1 | 0 | none | `$11.752528` | 473,856.00 ms (7.90 min) |

The five pairings cover 38 dispatches with 3 failures (7.89%), 0 unknown outcomes, and 3 capacity escalations. Only the single `pi` reviewer row is costed ($11.752528, 85.70% of window cost, covering 7 of 38 dispatches, F8), and `model` is `null` across all rows. Reviewer reliability improved markedly: `claude` reviewer achieved 100% success across 9 dispatches (vs 43.75% failure rate in baseline), and `codex-sol` reviewer achieved 100% success across 9 dispatches, though it experienced 3 `resource-exhaustion` escalations. `codex-sol` scribe experienced 2 failures across 11 dispatches (F6).

**Cache re-send waste** (`#/cacheWaste`): 0 steps, 0 input tokens, 0 top steps. Unlike the baseline artifact which flagged 13 cold steps costing $1.42 in a single session, no steps met the cold waste threshold (input > 100k, reuse < 10%) in this window.

**Per-session concentration** (`#/bySession`, top 20 of 52): the largest session by cost is a pi session (`2026-11-07T00-04-45-443Z_01a1b352-6b01-77f7-bacc-c9508f8f834c`) with 670 messages, 290 tool calls, `$1.197279` cost, and `assistantDurationMs` 2,093,894. The top 5 sessions account for $4.161839 (30.35% of cost), comprising two pi sessions and three codex sessions. The top 20 sessions account for 70.91% of cost ($9.724383), while the remaining 32 sessions account for 29.09% ($3.989637).

**Bottleneck order** (`#/derived/bottlenecks`): unattributed 73.57% → tool 10.52% → llm 10.26% → idle 5.65%. The leading category is an instrumentation artifact rather than workload (F1, F4).

## Workflow and process improvements

Numbered prose proposals; each is report-only and requires operator review before implementation.

1. **Emit tool execution duration on non-pi importer adapters.** All four non-pi lanes report 0 ms of tool duration across 8,831 calls (F1), forcing the analyzer to classify 73.57% of span as unattributed time. Importers for agy, claude, codex, and opencode should capture tool start and end timestamps. Owner surface: `spur history import` adapters. Recurrence basis: present in both current (92.89% untimed) and baseline (75.33% untimed) artifacts at `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` `#/totals`.
2. **Qualify coverage denominators alongside aggregate metric displays.** The report render displays `Tool execution | 2.5h | 11%` (`current.md:66`) without indicating that the figure represents only 676 of 9,507 tool calls (7.11%). Renders should print the measured population fraction next to every aggregate to prevent misleading single-lane extrapolations. Owner surface: `spur history report` time decomposition renderer. Recurrence basis: cited at `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:66-68`.
3. **Capture provider token usage and model identity on agy sessions.** The agy adapter imports 16,956 records (79.17% of window records) with 0 provider usage and $0 cost (F2). Parsing token metadata from agy session logs will restore cost visibility for the majority of developer activity. Owner surface: `spur history import` agy adapter. Recurrence basis: present across both artifacts at `#/bySource/agy` in current and baseline.
4. **Distinguish streamed timestamp deltas from round-trip request latency in codex.** Codex records a 2.64 ms mean assistant step duration on 100k-token prompts (F3). Importers should differentiate streaming chunk deltas from request round-trip latency to prevent implausible sub-second LLM timings. Owner surface: `spur history import` codex derivation. Recurrence basis: present in both artifacts at `#/bySource/codex/assistantDurationMs` (232 ms here, 1,025 ms baseline).
5. **Reconcile `llmMs` bucket calculations with per-source assistant totals.** The analyzer fold produces an `llmMs` figure that exceeds the sum of per-source assistant durations by 1,741,772 ms (F4). Adding an invariant assertion will ensure internal reconciliation between bucket totals and component rows. Owner surface: `spur history analyze` `derived.timeDecomposition` fold. Recurrence basis: present in both current (1.74M ms excess) and baseline (4.31M ms excess) artifacts at `#/derived/timeDecomposition`.
6. **Ensure importer checkpoints represent run execution timestamps.** The opencode lane's checkpoint precedes the window start by 7.62 h while reporting 1 in-window message (F5), repeating a defect seen on claude in baseline. Checkpoints should record the wall-clock time the importer executed. Owner surface: `spur history import` coverage tracking. Recurrence basis: observed on claude in baseline and opencode in current at `#/coverage`.
7. **Refine retry logic for scribe agent dispatches under codex-sol.** Codex-sol scribe failed 2 of 11 dispatches (F6), repeating its 2 failures from baseline. Establishing bounded retry intervals and fallback routing will mitigate scribe dispatch rework. Owner surface: agent dispatch orchestration for codex-sol scribe. Recurrence basis: 2 scribe failures in current and 2 in baseline at `#/pairings`.
8. **Surface capacity escalation metrics in pairing health summaries.** Codex-sol reviewer recorded 3 `resource-exhaustion` escalations while reporting 100% success rate (F6). Health dashboards should surface escalation counts alongside failure rates to highlight lanes operating near capacity limits. Owner surface: `spur history analyze` pairing analytics fold. Recurrence basis: observed in current (3 escalations) and baseline (6 escalations) at `#/pairings`.
9. **Capture real tool argument hashes for agy tool invocations.** 27 of 29 loop rows collapse into `sha256(null)` because agy arguments are uncaptured (F9). Implementing argument serialization in the agy importer will enable accurate tool loop detection. Owner surface: `spur history import` agy adapter and `spur history analyze` loop fold. Recurrence basis: present in both current (27 rows) and baseline (85 rows) at `#/loops`.
10. **Normalize tool aliases across multi-platform agent CLI adapters.** Tool calls are fragmented across platform-specific spellings (`bash` vs `Bash` vs `run_command` vs `exec`; `read_file` vs `Read` vs `read`). Pre-aggregating tool families will produce unified tool execution analytics. Owner surface: `spur history analyze` tool normalization. Recurrence basis: observed across 21 tool keys in current and 22 in baseline at `#/byTool`.
11. **Expand pairing cost joins across all agent harnesses.** Cost is populated on only 1 of 5 pairing rows (F8), leaving 81.58% of dispatches unpriced. Extending cost extraction to claude, codex, and antigravity-cli harnesses will enable comprehensive stage cost analysis. Owner surface: `spur history analyze` pairing cost joins. Recurrence basis: present in current (1 of 5 costed) and baseline (2 of 7 costed) at `#/pairings`.
12. **Correct markdown report renderer title duplication and close code fence.** The renderer outputs a duplicate title string on line 4 and leaves the line 3 opening code fence unclosed (F10). Fixing the template emitter will ensure reports are well-formed markdown documents. Owner surface: `spur history report` markdown renderer. Recurrence basis: identical failure on lines 3–4 of current and baseline renders at `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:3-4`.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry and no command substitution. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | First observed | Note |
| --- | --- | ---: | --- | --- |
| `manage_task` + `argsDigest` `74234e98afe7498f…` | agy · `6984f444-c058-4bee-93ef-9524bc445e10` | 3,284 | `2026-11-07T00:03:28Z` | The digest is `sha256(null)`, so this counts 3,284 `manage_task` calls with no captured arguments, not identical invocations (F9). `firstSeq` 1,182 → `lastSeq` 4,246, `model` `unknown`. |
| `run_command` + `argsDigest` `74234e98afe7498f…` | agy · `6984f444-c058-4bee-93ef-9524bc445e10` | 1,939 | `2026-11-07T00:02:49Z` | Same session, same null digest, different tool; `firstSeq` 885 → `lastSeq` 4,233. |
| `read_file` + `argsDigest` `74234e98afe7498f…` | agy · `6984f444-c058-4bee-93ef-9524bc445e10` | 1,939 | `2026-11-07T00:02:51Z` | Same session, same null digest; `firstSeq` 902 → `lastSeq` 4,220. |
| `edit_file` + `argsDigest` `74234e98afe7498f…` | agy · `6984f444-c058-4bee-93ef-9524bc445e10` | 572 | `2026-11-07T00:07:05Z` | Same session, same null digest; counts 572 calls across `firstSeq` 968 → `lastSeq` 4,244. Equals total `edit_file` calls in window. |
| `run_command` + `argsDigest` `74234e98afe7498f…` | agy · `6984f444-c058-4bee-93ef-9524bc445e10` | 153 | `2026-11-07T00:02:49Z` | Same session, same null digest; second repetition cluster across `firstSeq` 885 → `lastSeq` 1,061. |
| `schedule` + `argsDigest` `74234e98afe7498f…` | agy · `6984f444-c058-4bee-93ef-9524bc445e10` | 108 | `2026-11-07T01:11:13Z` | Same session, same null digest; equals total `schedule` calls in window across `firstSeq` 2,957 → `lastSeq` 3,442. |
| `manage_task` + `argsDigest` `74234e98afe7498f…` | agy · `83e47585-78e8-4663-8aee-876a086b97ee` | 24 | `2026-11-07T08:09:55Z` | Distinct agy session on null digest; `firstSeq` 1 → `lastSeq` 24. |
| `Read` + `argsDigest` `18ddf2777bc09984…` | claude · `b065f316-bcca-4955-b6e6-37eb664004b2` | 3 | `2026-11-07T16:06:34Z` | Real digest: identical `Read` argument signature 3 times in one claude session. `firstSeq` and `lastSeq` both 0. |
| `Read` + `argsDigest` `18ddf2777bc09984…` | claude · `cf912d7c-c6e2-46da-8429-116ce8515e03` | 3 | `2026-11-07T15:52:12Z` | Same real digest in a second claude session; 3 repeats, sequence positions unavailable. |

The loop fold reports signatures repeating at least 3 times. Of the 29 rows, 27 belong to agy and carry `sha256(null)`, with repeats summing to 8,299 (100% of agy tool calls). The 2 claude rows carry real argument digests, accounting for 6 repeats across 451 claude tool calls. Repeats of 1 or 2 calls are `not available` from this evidence plane, and tool calls cannot be individually audited for repetition because `byTool` carries no command text. A single `bash` call accounted for 3,121,713 ms (52.03 min), which represents command runtime rather than repetition. None of these observations triggers automated workflow intervention.

## Positive patterns

Held to the same evidence standard as problems: observation, inference, and at least one anchor each.

### P1 — 9,507 tool calls and 199 imported files produced no errors

- `key`: `positive:spur-history-import:clean-import-and-tool-runs`
- `category`: `positive`
- `impact`: The evidence plane is dependable on its error axis: no tool call failed and no imported record was rejected across five sources and 199 files. Gaps in the report reflect measurement coverage limits (F1, F2, F4) rather than parsing crashes or corrupt data.
- `trend`: `not-comparable`
- `observation`: `#/byTool[].errors` is 0 for all 20 listed tool keys summing to 9,506 calls, and the unlisted key has 0 errors. `#/coverage` reports `parseErrors` 0, `validationErrors` 0, `unknownRecords` 0, `parseErrorSamples` `[]` and `validationErrorSamples` `[]` for all five sources: agy 158 files, claude 10, codex 17, opencode 1, pi 13 (199 files total).
- `inference`: Zero errors across every tool call plus zero parse, validation, and unknown record counts across 199 files proves the importer read the corpus without record loss or syntax rejections. Named observations: all-zero tool `errors` column, all-zero error counters in `#/coverage`, and agreement between coverage tool calls (9,507) and totals tool calls (9,507).
- `contradictions`: Error-free execution does not imply complete telemetry: four lanes report 0 ms tool duration (F1), agy reports 0 usage (F2), and opencode has an out-of-window checkpoint (F5). Message counts also show a 529-message reconciliation difference between coverage and totals. Completeness is established for tool calls and file parsing, not for message telemetry.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`, `#/population`
- `severity`: `P3`
- `reproCommand`: `jq -c '{toolErrors:([.byTool[].errors]|add),listedCalls:([.byTool[].calls]|add),coverage:[.coverage[]|{s:.source,f:.files,m:.messages,p:.parseErrors,v:.validationErrors,u:.unknownRecords}],totals:{m:.totals.messages,c:.totals.toolCalls}}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — all five source lanes and their parsing pipelines.

### P2 — claude and reviewer pairings achieved 100% completion with zero unknown outcomes

- `key`: `positive:spur-history-analyze:pairing-dispatch-reliability`
- `category`: `positive`
- `impact`: Reviewer pairings demonstrated strong terminal reliability: `claude` reviewer completed 9 of 9 dispatches (100% success rate, 0 failures, 0 escalations), recovering completely from its 43.75% failure rate in baseline. `agy-gemini` reviewer completed 2 of 2 (100%), and `codex-sol` reviewer completed 9 of 9 (100%). Across all 38 dispatches, `unknownOutcomes` is 0 on all 5 rows, ensuring all dispatches reached classified terminal states.
- `trend`: `not-comparable`
- `observation`: `#/pairings` rows: `claude` reviewer 9 dispatches, `successRate` 1.0, 0 failures, 0 escalations; `agy-gemini` reviewer 2 dispatches, `successRate` 1.0, 0 failures; `codex-sol` reviewer 9 dispatches, `successRate` 1.0, 0 failures, `escalations` `{"resource-exhaustion": 3}`. Across all 5 rows, `unknownOutcomes` sums to 0 over 38 dispatches.
- `inference`: 20 reviewer dispatches across three distinct executors achieved 100% success with zero unclassified terminal outcomes, demonstrating that reviewer workflows execute reliably across multiple models. Named observations: 9/9 claude reviewer success, 2/2 agy-gemini success, 9/9 codex-sol reviewer success, and zero unknown outcomes across all 38 dispatches.
- `contradictions`: Reviewer success was accompanied by 3 `resource-exhaustion` escalations on codex-sol, indicating capacity strain despite eventual success. In addition, scribe dispatches on codex-sol experienced 2 failures (F6). Success is proven for reviewer completion, not for unconstrained capacity.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`
- `severity`: `P3`
- `reproCommand`: `jq -c '{pairings:[.pairings[]|{e:.executor,r:.role,d:.dispatches,sr:.successRate,f:.failures,u:.unknownOutcomes,esc:.escalations}],dispatches:([.pairings[].dispatches]|add),unknown:([.pairings[].unknownOutcomes]|add)}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: the `agent.run` dispatch path and the pairing analytics fold in `spur history analyze`.

### P3 — the pi lane is fully instrumented on steps and delivers bulk tokens at 96.5% cache reuse

- `key`: `positive:spur-history-import:pi-complete-measurement-axis`
- `category`: `positive`
- `impact`: Pi serves as the fully instrumented reference implementation: 637 of 637 assistant steps have usage, duration, and cache read; 676 of 677 tool calls are timed. The lane processed 68,223,218 billed input tokens (54.78% of window input) at 96.54% cache reuse and $0.0649 per 1M billed input — 9.93× cheaper than codex. This complete instrumentation is what enables tool time analysis and cross-lane comparison.
- `trend`: `not-comparable`
- `observation`: `#/stepSupport` pi row reports `assistantSteps` 637, `stepsWithUsage` 637, `stepsWithDuration` 637, `stepsWithDerivedDuration` 637, `stepsWithCacheRead` 637. `#/bySource/pi` reports `toolCalls` 677 with `durationMs` 8,903,971 and `durationUnmeasured` 1, `inputTokens` 68,223,218, `cacheReadTokens` 65,864,192, `costUsd` 4.428431.
- `inference`: Complete agreement across step counts, usage, duration, and cache-read counters (637/637) proves pi's telemetry pipeline captures a full measurement record per step without dropped fields. Named observations: exact 637/637 step agreement, 1 unmeasured call of 677 tool calls, and 96.54% cache reuse.
- `contradictions`: Pi represents 54.78% of billed input but only 32.29% of cost; its 1 unmeasured tool call prevents absolute 100% tool coverage. In addition, 1 of 7 reviewer dispatches on pi failed (F6 context).
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/pi`, `#/byTool`
- `severity`: `P3`
- `reproCommand`: `jq -c '{steps:(.stepSupport[]|select(.source=="pi")),tools:{calls:.bySource.pi.toolCalls,ms:.bySource.pi.durationMs,u:.bySource.pi.durationUnmeasured},reuse:(.bySource.pi.cacheReadTokens/.bySource.pi.inputTokens),ratePerM:(.bySource.pi.costUsd/(.bySource.pi.inputTokens/1000000))}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pi source lane adapter.

### P4 — the source and model folds sum to every window total and time buckets equal span

- `key`: `positive:spur-history-analyze:source-and-model-folds-sum-to-totals`
- `category`: `positive`
- `impact`: Ten reconciliation checks on `bySource` and seven on `byModel` equal `#/totals` exactly across tokens, costs, records, messages, and calls. Furthermore, the four time decomposition buckets sum to `spanMs` (84,636,977 ms) to the millisecond. Arithmetic integrity holds across the aggregations, allowing discrepancies (F1, F2, F4) to be isolated to specific upstream adapter gaps.
- `trend`: `not-comparable`
- `observation`: `#/bySource` sums equal `#/totals` for `inputTokens` (124,537,827), `outputTokens` (697,500), `cacheReadTokens` (116,118,522), `cacheWriteTokens` (1,346,354), `costUsd` (13.714020), `records` (21,417), `messages` (21,417), `toolCalls` (9,507), `assistantDurationMs` (6,942,604) and `durationMs` (8,903,971). `#/byModel` sums equal `#/totals` across all seven relevant dimensions. The four time buckets in `#/derived/timeDecomposition` sum to `spanMs` 84,636,977.
- `inference`: Independent distributions reproduce total counters across 17 distinct aggregation checks, confirming the folds process a consistent underlying record dataset. Named observations: 10 source-fold equalities, 7 model-fold equalities, and the bucket-to-span sum equality.
- `contradictions`: Totals agreement does not prevent internal attribution divergence: `llmMs` exceeds component assistant durations by 1,741,772 ms (F4), and coverage messages disagree with totals by 529 messages. The positive is strictly scoped to the mathematical consistency of the source and model aggregation folds.
- `evidenceAnchor`: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/bySource`, `#/byModel`, `#/totals`, `#/derived/timeDecomposition`
- `severity`: `P3`
- `reproCommand`: `jq -c '{src:{in:(([.bySource[].inputTokens]|add)==.totals.inputTokens),out:(([.bySource[].outputTokens]|add)==.totals.outputTokens),cr:(([.bySource[].cacheReadTokens]|add)==.totals.cacheReadTokens),cw:(([.bySource[].cacheWriteTokens]|add)==.totals.cacheWriteTokens),cost:(((([.bySource[].costUsd]|add)-.totals.costUsd)|if .<0 then -. else . end)<0.000001),rec:(([.bySource[].records]|add)==.totals.records),msgs:(([.bySource[].messages]|add)==.totals.messages),tools:(([.bySource[].toolCalls]|add)==.totals.toolCalls),asst:(([.bySource[].assistantDurationMs]|add)==.totals.assistantDurationMs),dur:(([.bySource[].durationMs]|add)==.totals.durationMs)},model:{in:(([.byModel[].inputTokens]|add)==.totals.inputTokens),out:(([.byModel[].outputTokens]|add)==.totals.outputTokens),cr:(([.byModel[].cacheReadTokens]|add)==.totals.cacheReadTokens),cost:(((([.byModel[].costUsd]|add)-.totals.costUsd)|if .<0 then -. else . end)<0.000001),rec:(([.byModel[].records]|add)==.totals.records),msgs:(([.byModel[].messages]|add)==.totals.messages),tools:(([.byModel[].toolCalls]|add)==.totals.toolCalls)},buckets:(([.derived.timeDecomposition.llmMs,.derived.timeDecomposition.toolMs,.derived.timeDecomposition.idleMs,.derived.timeDecomposition.unattributedMs]|add)==.derived.timeDecomposition.spanMs)}' .spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the aggregation folds for `totals`, `bySource`, `byModel`, and `derived.timeDecomposition`.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `telemetry:spur-history-import:tool-duration-unmeasured` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/byTool`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:66-68` |
| `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/bySource/agy`, `#/bySource/codex`, `#/byModel`, `#/totals` |
| `telemetry:spur-history-import:codex-assistant-duration-implausible` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/bySource/codex`, `#/bySource/pi`, `#/stepSupport`, `#/derived/timeDecomposition` |
| `telemetry:spur-history-analyze:time-decomposition-nonreconciling` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/derived/timeDecomposition`, `#/bySource`, `#/totals`, `#/stepSupport`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.json` — `#/derived/timeDecomposition`, `#/totals`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:65` |
| `coverage:spur-history-import:opencode-lane-import-stale` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/coverage/3`, `#/generatedAt`, `#/selector` |
| `reliability:codex-sol-executor:scribe-dispatch-failures` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.json` — `#/pairings` |
| `coverage:spur-task-check:verified-outcome-absent` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool` |
| `coverage:pairing-analytics:cost-coverage-partial` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.json` — `#/pairings`, `#/totals/costUsd` |
| `telemetry:spur-history-analyze:loop-args-digest-null` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/loops`, `#/bySource/agy`, `#/population/loops` |
| `workflow:spur-history-report:render-title-corrupted` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.md:3-4`; `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.md:3-4` |
| `positive:spur-history-import:clean-import-and-tool-runs` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`, `#/population` |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot` |
| `positive:spur-history-import:pi-complete-measurement-axis` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/pi`, `#/byTool` |
| `positive:spur-history-analyze:source-and-model-folds-sum-to-totals` | `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-current.json` — `#/bySource`, `#/byModel`, `#/totals`, `#/derived/timeDecomposition` |

Baseline artifacts cited in sections 3 and 5: `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byModel`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`, `#/totals`, `#/loops`, `#/cacheWaste`, `#/ladderSnapshot`) and `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-history-anatomy-baseline.md:3-4`. Window bounds and equal-duration offsets are recorded in `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-paths.txt:5-8`; run identity, digests, selector and provisional window state are recorded in `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-provenance.json` and `.spur/run/4e36b190-de99-489b-a23a-ff7aa1bd6cc0-selector.json`.

Two limitations of this report's own evidence: the current window is provisional and 34.41% elapsed at generation (8.26 h of 24.0 h, 15.74 h still to run); and no comparison against `2026-11-06` is stated anywhere in this report because that baseline was found `not comparable` on four independent axes in section 3.

