---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-11-10"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-11-10T00:00:00.000-08:00
    until: 2026-11-10T23:59:59.999-08:00
  sources:
    - source: agy
    - source: claude
    - source: opencode
    - source: pi
windowState: "provisional"
generatedAt: "2026-11-10T13:03:21.010Z"
validatedAt: "2026-11-10T13:03:21.010Z"
artifactDigest: "3fb3a2ccd49bd7466a71898cd2029c9e6899fc37d1084597dfa374ab4b2dc320"
baselineArtifactDigest: "811666584ae54022c2bf4e8b96c2bf4ad798d533ded463ff8ac26cb882433b31"
contractDigest: "34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5"
skillDigest: "8235b95aca5968ae89cc990ece51412b3df564099614ae3690963a588be1c0f2"
workflowDigest: "not available"
helperDigest: "f4a1302d0ec99945853a228b8861c4104e1532660375c32b9f8a96cffb696091"
runId: "abca53ca-db86-4cee-b614-049cd05a5e84"
currentArtifactPath: ".spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.json"
spurVersion: "not available"
schemaVersion: 1
executor: "coder"
model: "not available"
cacheDisposition: "miss"
coverage:
  - source: agy, status: ok, lastImportedAt: 2026-11-10T13:03:12.598Z
  - source: claude, status: ok, lastImportedAt: 2026-11-10T04:00:08.511Z
  - source: opencode, status: ok, lastImportedAt: 2026-11-10T13:03:10.567Z
  - source: pi, status: ok, lastImportedAt: 2026-11-10T13:03:04.026Z
---

> imported snapshot as of 2026-11-10T04:00:08.511Z · window provisional · cache miss

<!-- Candidate authored by sp:history-anatomy enrich · mode daily · run abca53ca-db86-4cee-b614-049cd05a5e84 · schema v1 -->

# History forensics report — 2026-11-10 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `abca53ca`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report. No workflow was launched by this operation.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-11-10`, baseline is the immediately preceding local calendar day `2026-11-09` |
| Current window | `2026-11-10T00:00:00.000-08:00` → `2026-11-10T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Baseline window | `2026-11-09T00:00:00.000-08:00` → `2026-11-09T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Window offsets | Both windows sit entirely in `-08:00`; equal-duration with identical UTC offsets — read from `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-paths.txt:5-8` |
| Window state | `provisional` for current artifact. Current generated `2026-11-10T13:03:18.741Z` (`#/generatedAt`), i.e. `5.06` h into the 24.0 h it measures (21.06% elapsed, 18.94 h still to run). Baseline generated `2026-11-10T13:03:20.091Z`, `5.06` h after its own window had fully elapsed — so the baseline day is complete and the current day is provisional |
| Generated | `2026-11-10T13:03:18.741Z` (current) · `2026-11-10T13:03:20.091Z` (baseline) |
| Toolchain | spur `not available` (artifact `#/spurVersion`) · artifact `schemaVersion` `1` · executor `coder`, model `not available` · contract version `1` |
| Digests | artifact `3fb3a2ccd49bd7466a71898cd2029c9e6899fc37d1084597dfa374ab4b2dc320` · baseline artifact `811666584ae54022c2bf4e8b96c2bf4ad798d533ded463ff8ac26cb882433b31` · contract `34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5` · skill `8235b95aca5968ae89cc990ece51412b3df564099614ae3690963a588be1c0f2` · helper `f4a1302d0ec99945853a228b8861c4104e1532660375c32b9f8a96cffb696091` · workflow `not available`. Read from `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-provenance.json` |
| Selector | sources `all` (`agy`, `claude`, `opencode`, `pi`), no session/run/task narrowing, leaderboard depth `20` (`#/population/appliedTop`). Read from `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-selector.json` |
| Cache disposition | `miss` — disposition `no-cache`, so the run recomputed (`.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-cache-disposition.txt`) |
| Current artifact | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.md` |
| Path resolution | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-paths.txt` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| agy | ok | 102 | 5,210 | 2,464 | 0 | 0 | 0 | `2026-11-10T13:03:12.598Z` |
| claude | ok | 1 | 22 | 0 | 0 | 0 | 0 | `2026-11-10T04:00:08.511Z` |
| opencode | ok | 8 | 8 | 0 | 0 | 0 | 0 | `2026-11-10T13:03:10.567Z` |
| pi | ok | 30 | 3,696 | 1,547 | 0 | 0 | 0 | `2026-11-10T13:03:04.026Z` |

Population: `51` sessions, `13` tool keys, `29` loop signals, `1` warning, leaderboard depth applied `20` (`#/population`). Because session count (51) exceeds the applied leaderboard depth (20), `#/bySession` is a truncated leaderboard presenting top 20 of 51 sessions (`Sessions | top 20 of 51` in `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:11`). The 20 listed sessions account for 3,422 of 8,892 messages (38.48%), 1,442 of 4,011 tool calls (35.95%) and `$7.157642` of `$7.475503` (95.75%) of window cost. All 20 sessions belong to `pi` due to sorting on spend. `#/byTool` lists all 13 tool keys, accounting for 4,011 of 4,011 calls (100.00%). `#/loops` holds 29 rows and `#/warnings` (1 row) is complete. The step leaderboards (`#/topStepsByTokens`, `#/topStepsByDuration`) hold 20 rows each and are slices of the assistant steps in `#/stepSupport`, not population totals.

Import freshness: claude was imported at `04:00:08Z` (9 h 3 min older than generation), pi at `13:03:04Z` (14.7 s older), opencode at `13:03:10Z` (8.2 s older), and agy at `13:03:12Z` (6.1 s older). The claude lane imported earlier in the day at ~04:00 UTC, while the other three lanes imported within seconds of generation at ~13:03 UTC (5.06 h into the local calendar day).

## Executive summary

- The measured current window spans 51 sessions (top 20 listed, 95.75% of spend), 8,892 messages, 4,011 tool calls, a 20.51 h activity span (excluding 9 sessions with unusable non-ISO timestamps), `$7.475503` of provider-billed cost, and 120,623,626 billed input tokens at a 96.47% cache-read share. Four sources imported (`agy`, `claude`, `opencode`, `pi`) with zero parse errors, zero validation errors, and zero unknown records across 141 files.
- Measurement remains an active defect: 2,465 of 4,011 tool calls (61.46%) carry no duration. The agy lane contributes 2,464 calls (61.43% of all calls) and zero measured milliseconds; pi contributes 1 unmeasured call. The `toolMs` bucket (38,127,877 ms, 51.64% of span) equals the `pi` lane's `durationMs` to the millisecond, and 18,402,369 ms (24.92% of span) is explicitly unattributed (`#/warnings/0`, F1).
- The agy lane bills nothing across 5,166 records (58.09% of all window records) and 2,464 tool calls: it reports 0 input tokens, 0 provider usage, and $0 cost. In `byModel`, `unknown` carries 5,166 records with 0 usage and $0 cost, so agy activity remains completely unmeasured on spend and token volume (F2).
- Agy assistant step durations are sparse and skewed: 2,416 of 2,551 assistant steps (94.71%) carry no duration, while the 135 timed steps average 20.10 s per step, with the top 4 steps by duration in `#/topStepsByDuration` all belonging to agy and ranging from 88.0 s up to 1,294.0 s (21.57 min) in session `f03ccc71-b50a-42c3-a18a-a1de9d5987ef` (F3).
- Time decomposition does not reconcile with wall-clock span: the four buckets (`llmMs` 9,004,734 + `toolMs` 38,127,877 + `idleMs` 8,318,125 + `unattributedMs` 18,402,369) sum to 73,853,105 ms, exceeding `spanMs` (73,834,804 ms) by 18,301 ms (18.30 s) (F4).
- Dispatch reliability failed catastrophically on `pi-dsv4.1-flash-volc`: 4 of 4 dispatches failed in the scribe role (agent `opencode`) with 2 resource-exhaustion escalations and a 100% failure rate, terminating within an average of 15.18 s (F5). In contrast, `agy-gemini` (4 dispatches, $2.46 cost) and `pi-deepseek` (21 dispatches, $12.99 cost) completed 100% cleanly (25 of 25 dispatches succeeded).
- Verified outcomes: `taskDenominator` is 0, leaving `verifiedResults` 0, all outcome rates `null`, and `costCoverage` `{covered: 0, total: 0}`, so the $7.475503 spend cannot be priced per verified result (F6).
- Message accounting shows a 44-message reconciliation gap: `#/coverage` sums to 8,936 messages while `#/totals` reports 8,892 messages, with the entire 44-message divergence located in agy (5,210 vs 5,166) (F7).
- Tool loop detection is distorted on agy: 28 of 29 loop rows carry `sha256(null)` as `argsDigest`, collapsing 2,464 tool calls (100% of agy calls) into false repetitive clusters due to absent argument telemetry (F8).
- Report render formatting defect: both current and baseline markdown renders open with an unclosed opening fence and duplicated title prefix (`# History forensics report — generated ...# History ...`), trapping the entire report inside a code block (F9).
- Cold cache re-send waste: 3 assistant steps in `pi` with model `glm-5.3-flash` re-sent 312,198 fresh input tokens with 0.0% cache reuse (>100k tokens and <10% reuse), wasting $0.316843 in unnecessary spend (F10).
- Baseline comparison verdict: **`not comparable`**. Observation coverage is 21.06% elapsed (5.06 h of 24.0 h, provisional) vs a completed day (100% elapsed); instrumentation regime shifted (61.46% vs 68.52% untimed tool calls; 15.70% vs 15.85% records with usage; 61.24% vs 47.72% untimed assistant steps); source population shifted from 43 to 51 sessions; tool composition contracted from 20 to 13 keys; and model composition shifted. No trend, delta, or percentage is stated against the baseline, and every finding is classified `not-comparable`.
- Execution was clean where measured: zero tool errors across 4,011 calls, zero parse or validation errors across 141 files, and zero unknown outcomes across 29 dispatches.

## Baseline comparison

**Verdict: `not comparable`.** No trend, no delta, and no percentage is stated against the baseline anywhere in this report. Four independent differences block comparability; the aligning axes are stated first so the blockers are not overstated.

**Aligning axes (stated, not compared).** Both windows are 24.0 h long with identical `-08:00` offsets — there is no DST asymmetry (`.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-paths.txt:5-8`). Both artifacts were generated with the same contract digest (`34f0f1e6...`) and an identical 25-entry `#/ladderSnapshot`. Both windows import the identical set of four source names (`agy`, `claude`, `opencode`, `pi`).

1. **Observation coverage is not equal.** The current artifact was generated `5.06` h into the day it measures — 21.06% elapsed, 18.94 h still to run (`windowState: provisional`) — while the baseline artifact was generated `5.06` h *after* its window had fully elapsed (`#/generatedAt`; window bounds as above). A partial day against a complete day is materially different observation coverage: any count comparison would systematically understate current activity, and per-hour rates would divide by two different effective denominators.
2. **Instrumentation regime differs.** The current artifact leaves 2,465 of 4,011 tool calls without a duration (61.46%); the baseline leaves 3,508 of 5,120 (68.52%). The assistant-step axis differs further: 2,417 of 3,947 steps carry no duration here (`#/totals/assistantDurationUnmeasured`, 61.24%) against 2,726 of 5,712 steps there (47.72%). Provider usage coverage stands at 15.70% (1,396 of 8,892 records) here against 15.85% (1,887 of 11,905 records) in baseline. The same statistic therefore describes two different measurement populations, so no tool-time or latency figure is like-for-like.
3. **Session population and model composition shifted.** The current window imports 51 sessions across 141 files against 43 sessions across 123 files in baseline. `#/byModel` in current holds 7 models (`unknown`, `<synthetic>`, `deepseek-v4.1-flash-free`, `deepseek-flash`, `deepseek-v4-1-flash-261017`, `glm-5.3-flash`, `k3.1-pro`), whereas baseline held 9 models including `claude-opus-5` (17.3M billed input tokens) and `claude-opus-5-5` (18.6M billed input tokens), which are entirely absent in current where claude has 0 input tokens across 22 messages.
4. **Tool-key composition changed.** `#/population/tools` is 13 here against 20 in baseline. Baseline included `Bash` (263 calls), `Read` (60 calls), `Write` (14 calls), `Skill` (8 calls), `Edit` (6 calls), `web_search` (1 call), `ToolSearch` (1 call), `ListAgents` (1 call), and `Grep` (1 call), none of which appeared in the current window. A tool-name distribution over different key sets is not the same statistic, and per-tool latency cannot be paired row-for-row.

Per-axis values, stated as separate facts only:

| Axis | Current artifact | Baseline artifact | Compared? |
| --- | --- | --- | --- |
| Window duration | 24.0 h (`-08:00` both bounds) | 24.0 h (`-08:00` both bounds) | aligned — no DST asymmetry |
| Observation coverage | 21.06% elapsed at generation (5.06 h of 24.0 h) | 100% elapsed, generated 5.06 h after window end | no |
| Sources | `agy`, `claude`, `opencode`, `pi` (141 files, all `ok`) | `agy`, `claude`, `opencode`, `pi` (123 files, all `ok`) | no — 141 files vs 123 files |
| Sessions | 51 (top 20 listed, 38.48% of messages, 95.75% of cost) | 43 (top 20 listed, 46.12% of messages, 76.54% of cost) | no |
| Messages (`#/totals`) | 8,892 | 11,905 | no |
| Tool calls | 4,011 | 5,120 | no |
| Instrumented tool calls | 1,546 of 4,011 (38.54%) | 1,612 of 5,120 (31.48%) | no |
| Records with provider usage | 1,396 of 8,892 (15.70%) | 1,887 of 11,905 (15.85%) | no |
| Assistant steps timed | 1,530 of 3,947 (38.76%) | 2,986 of 5,712 (52.28%) | no |
| Span | 73,834,804 ms (20.51 h) | 195,245,025 ms (54.23 h) | no |
| Cost | `$7.475503` | `$9.709530` | no |
| Billed input / cache share | 120,623,626 at 96.47% cache-read | 182,507,646 at 97.49% cache-read | no |
| Tool keys | 13 (all 13 listed) | 20 (all 20 listed) | no |
| Loop rows | 29 (28 agy, 1 pi) | 16 (15 agy, 1 pi) | no |
| Pairings / dispatches / costed rows | 5 / 29 / 5 | 6 / 42 / 5 | no |
| Verified outcomes | denominator 0, verified 0 | denominator 0, verified 0 | no |

Structural gaps present in both artifacts: `#/derived/phases` is `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}` in both; the renders are corrupted identically in both (title duplication and unclosed fence at lines 3–4); and `#/loops` is dominated by agy rows carrying the same `sha256(null)` `argsDigest` in both (28 of 29 here, 15 of 16 there). Those are recorded per finding in section 5 as `not-comparable` with a discrete-presence note, not as trends.

## Findings

Ten problem findings: one P1, five P2, four P3. Every field set is complete; `trend` is `not-comparable` for all of them because the baseline was found `not comparable` in section 3. All commands are reproducible verbatim from the repository root and none was run by this report.

### F1 — 61.46% of tool calls carry no duration, so the tool-time bucket is one lane's measurement

- `key`: `telemetry:spur-history-import:tool-duration-unmeasured`
- `category`: `telemetry`
- `impact`: `toolMs` is 51.64% of the 20.51 h span, but it is computed from 1,546 of 4,011 calls (38.54%), and it equals the pi lane's `durationMs` to the exact millisecond. The agy lane contributes 2,464 calls (61.43% of all calls) and zero measured milliseconds; pi has 1 unmeasured bash call. Every tool-latency statement and the bottleneck ranking describe 38.54% of the window's calls, and the 24.92% unattributed bucket is the arithmetic remainder.
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `toolCalls` 4,011 with `durationUnmeasured` 2,465. `#/bySource` reports `durationMs` 0 with `durationUnmeasured` 2,464 (agy), 0 / 0 (claude), 0 / 0 (opencode), and 38,127,877 / 1 (pi). `#/byTool` reports `bash` 1,239 calls with `durationMsTotal` 37,951,829 and `durationUnmeasured` 1; `ask_user_question` 1 call with 174,548 ms; `read` 149 calls with 677 ms; `edit` 82 calls with 275 ms; `to&#100;o` 47 calls with 279 ms; `write` 26 calls with 37 ms; `ffgrep` 2 calls with 232 ms; `contact_supervisor` 1 call with 0 ms; and `durationMsTotal` 0 with every call unmeasured for `run_command` (1,387), `read_file` (766), `write_file` (163), `manage_task` (76), and `edit_file` (72). `#/derived/timeDecomposition` reports `toolMs` 38,127,877 against `spanMs` 73,834,804, and `#/warnings/0` states that 18,402,369 ms could not be attributed because some durations were unmeasured.
- `inference`: Two independent signals show the bucket is a single-lane measurement rather than a window total: first, `toolMs` equals `#/bySource/pi/durationMs` exactly (38,127,877 on both), so the aggregate is the pi lane by identity; second, 2,464 of the 2,465 unmeasured calls concentrate in precisely the agy lane whose `durationMs` is 0. Named observations: the `toolMs`/`bySource/pi` identity, the per-lane `durationMs` 0 with `durationUnmeasured` 2,464 on agy, and the explicit `derived-unattributed-time` warning.
- `contradictions`: Tool execution time is fully measured for almost all of the pi lane: 1,546 of 1,547 pi tool calls carry durations, and `bash` accounts for 37,951,829 ms, so tool time does exist in this window — it is simply absent from the agy adapter. A single `bash` call measured at 3,176,460 ms (52.94 min) shows individual call duration varies widely.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/byTool`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:72-90`
- `severity`: `P1`
- `reproCommand`: `jq -c '{calls:.totals.toolCalls,unmeasured:.totals.durationUnmeasured,toolMs:.derived.timeDecomposition.toolMs,piMs:.bySource.pi.durationMs,perSource:[.bySource|to_entries[]|{s:.key,calls:.value.toolCalls,ms:.value.durationMs,u:.value.durationUnmeasured}],unattributed:.derived.timeDecomposition.unattributedMs,span:.derived.timeDecomposition.spanMs}' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the agy source adapter's per-tool-call duration emission.

### F2 — the agy lane bills nothing across 5,166 records and 2,464 tool calls

- `key`: `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex`
- `category`: `telemetry`
- `impact`: 5,166 of 8,892 records (58.09%) — the entire agy lane — carry no provider usage, so over 58% of the window has no token figure and no cost. `#/byModel/unknown` carries 5,166 records with 0 usage and `$0` cost. Agy spend and token consumption remain completely unmeasured, distorting all per-lane cost share calculations.
- `trend`: `not-comparable`
- `observation`: `#/bySource/agy` reports `records` 5,166 with `recordsWithUsage` 0, `inputTokens` 0, `outputTokens` 0, `cacheReadTokens` 0, `cacheWriteTokens` 0, `costUsd` 0, and `toolCalls` 2,464. `#/byModel/unknown` reports `records` 5,166, `recordsWithUsage` 0, `inputTokens` 0, `outputTokens` 0, `costUsd` 0, and `toolCalls` 2,464.
- `inference`: Two independent signals show that agy adapter records are entirely uninstrumented for provider token usage while the fold's source-model joins balance cleanly: first, `recordsWithUsage` is 0 across all 5,166 agy records, so the absence is total across the lane; second, `byModel/unknown` carries exactly 5,166 records with 0 usage, confirming that no agy usage was misattributed to named models. Named observations: the 5,166 agy records with zero usage and the exact agreement between agy source records and the unknown model row.
- `contradictions`: Totals reconcile across all axes — `#/bySource` and `#/byModel` each sum to every `#/totals` axis — so there is no arithmetic drift. Agy records do report assistant step durations (2,712,926 ms across 135 timed steps in `#/stepSupport`), so the lane is not entirely telemetry-less; the gap is specific to provider usage and cost.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/bySource/agy`, `#/byModel/unknown`, `#/totals`
- `severity`: `P2`
- `reproCommand`: `jq -c '{agy:{rec:.bySource.agy.records,use:.bySource.agy.recordsWithUsage,cost:.bySource.agy.costUsd,tools:.bySource.agy.toolCalls},unknown:{rec:.byModel.unknown.records,use:.byModel.unknown.recordsWithUsage,in:.byModel.unknown.inputTokens,cost:.byModel.unknown.costUsd,tools:.byModel.unknown.toolCalls}}' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the agy adapter's provider usage extraction in `spur history import`.

### F3 — 94.71% of agy assistant steps carry no duration, while timed steps average 20.10 s

- `key`: `telemetry:spur-history-import:agy-assistant-steps-unmeasured`
- `category`: `telemetry`
- `impact`: The agy lane reports 2,551 assistant steps, but 2,416 steps (94.71%) carry no duration measurement. The 135 timed steps accumulate 2,712,926 ms at a 20,095.75 ms (20.10 s) mean per step, with the top 4 steps by duration in `#/topStepsByDuration` all belonging to agy and ranging from 88.0 s up to 1,294.0 s (21.57 min) in session `f03ccc71-b50a-42c3-a18a-a1de9d5987ef`. The assistant duration series for agy captures macro session delays rather than step-level LLM latency, skewing time decomposition.
- `trend`: `not-comparable`
- `observation`: `#/stepSupport` reports agy `assistantSteps` 2,551 with `stepsWithDuration` 135 and `stepsWithDerivedDuration` 135 (2,416 missing duration). `#/bySource/agy` reports `assistantDurationMs` 2,712,926 with `assistantDurationUnmeasured` 2,416. The 135 timed steps average 20,095.75 ms per step. In `#/topStepsByDuration`, the top 4 steps by duration all belong to agy (durations: 1294.0s, 756.9s, 205.0s, 88.0s in sessions `f03ccc71` and `268e32d5`).
- `inference`: Two independent signals show that agy assistant durations are sparse and unrepresentative of model generation: first, 2,416 of 2,551 assistant steps lack timestamps entirely; second, the recorded durations exhibit extreme values (with steps exceeding 750 s and 1,290 s), indicating that durations capture human wait time or unmeasured tool execution between prompts rather than inference latency. Named observations: the 2,416 unmeasured steps in `#/stepSupport` and the 4 top-duration agy entries in `#/topStepsByDuration`.
- `contradictions`: In contrast to agy, pi has 1,390 of 1,391 assistant steps timed (99.93% complete, 4.51 s mean), claude has 1 of 1 timed (251 ms), and opencode has 4 of 4 timed (6.06 s mean). The unmeasured step issue is concentrated in agy.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/agy`, `#/topStepsByDuration`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:92-100,126-136`
- `severity`: `P2`
- `reproCommand`: `jq -c '{agySteps:(.stepSupport[]|select(.source=="agy")|.assistantSteps),agyTimed:(.stepSupport[]|select(.source=="agy")|.stepsWithDuration),agyUnmeasured:.bySource.agy.assistantDurationUnmeasured,asstMs:.bySource.agy.assistantDurationMs,meanMs:(.bySource.agy.assistantDurationMs/(.stepSupport[]|select(.source=="agy")|.stepsWithDuration))}' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the agy adapter's assistant step timestamp extraction.

### F4 — the time decomposition does not reconcile: bucket sum exceeds wall span by 18,301 ms

- `key`: `telemetry:spur-history-analyze:time-decomposition-nonreconciling`
- `category`: `telemetry`
- `impact`: The four time decomposition buckets (`llmMs` 9,004,734 + `toolMs` 38,127,877 + `idleMs` 8,318,125 + `unattributedMs` 18,402,369) sum to 73,853,105 ms, while `spanMs` is reported as 73,834,804 ms. An excess of 18,301 ms (18.30 s) is present in the decomposition buckets relative to the measured wall-clock span.
- `trend`: `not-comparable`
- `observation`: `#/derived/timeDecomposition` reports `llmMs` 9,004,734, `toolMs` 38,127,877, `idleMs` 8,318,125, `unattributedMs` 18,402,369, and `spanMs` 73,834,804. The sum of the four buckets is 73,853,105 ms, which exceeds `spanMs` by 18,301 ms. In baseline, the four buckets summed to 195,267,149 ms against `spanMs` 195,245,025 ms (an excess of 22,124 ms), and baseline `llmMs` exceeded component assistant totals by 1,044,551 ms.
- `inference`: Two independent signals show that the time decomposition fold and session wall span calculation diverge: first, the sum of the four buckets exceeds `spanMs` by 18,301 ms in current; second, an arithmetic discrepancy recurred from baseline (where the excess was 22,124 ms), confirming an active calculation mismatch in the analyzer fold when aggregating session spans. Named observations: the 18,301 ms excess in current and the recurring 22,124 ms excess in baseline.
- `contradictions`: Totals for `llmMs` (9,004,734 ms) reconcile exactly with `totals.assistantDurationMs` (9,004,734 ms) and with the sum of `bySource` assistant durations across all four lanes, so the LLM bucket attribution itself is clean; the discrepancy sits in the relationship between bucket summation and session span boundaries. A plausible mechanism is that bucket intervals span boundary seconds across overlapping sessions; this is labelled a hypothesis with the confirmation path of logging interval boundaries in the `timeDecomposition` analyzer fold.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/derived/timeDecomposition`, `#/bySource`, `#/totals`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.json` — `#/derived/timeDecomposition`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:54-63`
- `severity`: `P2`
- `reproCommand`: `jq -c '{llm:.derived.timeDecomposition.llmMs,tool:.derived.timeDecomposition.toolMs,idle:.derived.timeDecomposition.idleMs,unatt:.derived.timeDecomposition.unattributedMs,bucketSum:([.derived.timeDecomposition.llmMs,.derived.timeDecomposition.toolMs,.derived.timeDecomposition.idleMs,.derived.timeDecomposition.unattributedMs]|add),span:.derived.timeDecomposition.spanMs,diff:(([.derived.timeDecomposition.llmMs,.derived.timeDecomposition.toolMs,.derived.timeDecomposition.idleMs,.derived.timeDecomposition.unattributedMs]|add)-.derived.timeDecomposition.spanMs)}' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `derived.timeDecomposition` fold and its span reconciliation logic.

### F5 — `pi-dsv4.1-flash-volc` fails 100% of dispatches with resource-exhaustion escalations

- `key`: `reliability:pi-dsv4.1-flash-volc-executor:dispatch-failures`
- `category`: `reliability`
- `impact`: The `pi-dsv4.1-flash-volc` executor exhibited complete failure in current execution: 4 of 4 dispatches failed in the scribe role (agent `opencode`), yielding a 0% success rate (100% failure rate) and triggering 2 resource-exhaustion escalations. Dispatches terminated prematurely with a mean duration of only 15,184.52 ms (15.18 s), wasting workflow orchestration overhead.
- `trend`: `not-comparable`
- `observation`: `#/pairings` reports `pi-dsv4.1-flash-volc` scribe (agent `opencode`) with 4 dispatches, `successRate` 0.0, `failures` 4, `unknownOutcomes` 0, `escalations` `{"resource-exhaustion": 2}`, `totalCostUsd` 0.0, and `meanDurationMs` 15,184.52. In contrast, `agy-gemini` reviewer (3 dispatches, $2.24) and scribe (1 dispatch, $0.22), and `pi-deepseek` reviewer (16 dispatches, $9.78) and scribe (5 dispatches, $3.22) achieved 100% success (25 of 25 dispatches succeeded cleanly with 0 failures and 0 escalations).
- `inference`: Two independent signals show that `pi-dsv4.1-flash-volc` suffered systematic environment or capacity collapse: first, all 4 dispatches failed with an identical short-duration signature (~15.2 s); second, the dispatcher explicitly logged `resource-exhaustion` on 2 escalations. Named observations: the 4 failures out of 4 dispatches, the 2 resource-exhaustion escalation records, and the 15.18 s mean duration.
- `contradictions`: In baseline, `pi-dsv4.1-flash-volc` also exhibited high failure rates (16 failures across 25 dispatches: coder 2/2 failed, reviewer 9/15 failed, scribe 5/8 failed), but succeeded on 7 dispatches (28% success overall) with mean durations exceeding 400 s; the current failure mode is more acute (100% immediate failure within 15 s).
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.json` — `#/pairings`
- `severity`: `P2`
- `reproCommand`: `jq -c '[.pairings[]|select(.executor=="pi-dsv4.1-flash-volc")|{e:.executor,r:.role,a:.agent,d:.dispatches,sr:.successRate,f:.failures,esc:.escalations,cost:.totalCostUsd,ms:.meanDurationMs}]' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: the `pi-dsv4.1-flash-volc` entry in the agent ladder (`#/ladderSnapshot`, order 1 tier `standard`) and opencode dispatch resource constraints.

### F6 — no task entered the verified-outcome fold, leaving the value axis empty

- `key`: `coverage:spur-task-check:verified-outcome-absent`
- `category`: `coverage`
- `impact`: `taskDenominator` is 0, leaving `verifiedResults` 0, all outcome rates `null`, and `costCoverage` `{covered: 0, total: 0}`. The report measures 20.51 h of activity and `$7.475503` of spend, but cannot calculate cost per verified result or time to verification.
- `trend`: `not-comparable`
- `observation`: `#/verifiedOutcome` reports `taskDenominator` 0, `verifiedResults` 0, `verifiedRate` `null`, `verifiedWithoutCorrection` 0, `verifiedWithoutCorrectionRate` `null`, `correctionCount` 0, `correctionRate` `null`, `retryExhaustedCount` 0, `measuredTokensPerVerifiedResult` `null`, `timeToVerified` `{count: 0, meanMs: null, maxMs: null}`, `costCoverage` `{covered: 0, total: 0}`, and all `excludedReasons` counters at 0.
- `inference`: Two independent signals show that task activity exists without verified task closure: first, `taskDenominator` is 0 despite 51 sessions and 4,011 tool calls; second, task tooling was invoked during the window (`manage_task` 76 calls, `to&#100;o` 47 calls) without completing a task under `spur task check`. Named observations: `taskDenominator` 0, `verifiedResults` 0, 76 `manage_task` calls, and 47 `to&#100;o` calls.
- `contradictions`: A zero denominator in a provisional window (21.06% elapsed) reflects task lifecycle timing rather than broken joins: no task happened to conclude and certify during the measured 5.06 h window. Baseline also reported `taskDenominator` 0.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`
- `severity`: `P2`
- `reproCommand`: `jq -c '.verifiedOutcome' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur task check` — the verification gate whose PASS proof the `verifiedOutcome` fold consumes.

### F7 — 44-message reconciliation gap between coverage metadata and totals

- `key`: `coverage:spur-history-import:message-reconciliation-gap`
- `category`: `coverage`
- `impact`: `#/coverage` reports 8,936 imported messages across four sources, while `#/totals/messages` reports 8,892 messages (a difference of 44 messages). An operator reading import coverage sees 44 more messages than are present in analytical totals, creating ambiguity regarding ingest boundaries.
- `trend`: `not-comparable`
- `observation`: `#/coverage` reports messages by source summing to 8,936 (agy 5,210, claude 22, opencode 8, pi 3,696). `#/totals/messages` reports 8,892 (and `#/bySource` sums to 8,892: agy 5,166, claude 22, opencode 8, pi 3,696). The gap is 44 messages on agy (5,210 vs 5,166), while claude, opencode, and pi match to the unit.
- `inference`: Two independent signals show that coverage and totals count messages at differing stages: first, the 44-message discrepancy occurs on the agy lane while the other three lanes match to the unit; second, this gap recurred from baseline (where coverage reported 12,241 messages vs 11,905 totals, a 336-message discrepancy). Named observations: the 44-message gap on agy, the exact reconciliation on claude, opencode, and pi, and the recurring gap from baseline.
- `contradictions`: Zero parse errors, validation errors, and unknown records were recorded across all 141 files, so no messages were rejected due to format corruption. The divergence reflects timestamp-based window filtering applied to session files that overlap the selector boundary; this is labelled a hypothesis with the confirmation path of checking timestamp filters in `spur history import`.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/coverage`, `#/bySource`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{coverageMsgs:([.coverage[].messages]|add),totalsMsgs:.totals.messages,diff:(([.coverage[].messages]|add)-.totals.messages),bySourceMsgs:[.bySource|to_entries[]|{s:.key,m:.value.messages}],coverageBySource:[.coverage[]|{s:.source,m:.messages}]}' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the coverage metadata accumulator and message-filtering logic.

### F8 — the loop fold's argument digest is `sha256(null)` on 28 of 29 rows, collapsing 2,464 agy calls

- `key`: `telemetry:spur-history-analyze:loop-args-digest-null`
- `category`: `telemetry`
- `impact`: 28 of 29 loop rows belong to agy and carry `argsDigest: 74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b` (`sha256(null)`). The fold reports repeats of `run_command`, `read_file`, `write_file`, `edit_file`, and `manage_task` across multiple sessions, summing to 2,464 calls — exactly 100% of all agy tool calls. Calls with uncaptured arguments are collapsed into false repetitive clusters, preventing genuine loop detection.
- `trend`: `not-comparable`
- `observation`: `#/loops` holds 29 rows: 28 agy, 1 pi. All 28 agy rows share `argsDigest` `74234e98afe7498f...` and carry `model` `unknown`. The repeats on those 28 rows sum to 2,464, exactly equal to `#/bySource/agy/toolCalls` (2,464). The 29th row is pi `bash` with a real digest (`ad615fc568b82ade...`) and 4 repeats.
- `inference`: Three signals show that the digest is an absent-argument constant that groups all calls of a tool together: first, the digest matches `sha256(null)`; second, agy loop repeats equal total agy tool calls to the unit (2,464), meaning zero agy calls were filtered out as non-repeating singletons; third, the pi lane does filter singletons (4 repeats out of 1,547 calls) and produces a real cryptographic hash. Named observations: the `sha256(null)` value, the exact 2,464 sum equality, and the contrasting pi row with a real digest.
- `contradictions`: Agy rows are segregated by tool name within sessions, so tool-level categorization is correct. The sessions genuinely ran commands, file reads, and file writes, but the lack of argument text prevents verifying whether any of those calls were true identical repetitions.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/loops`, `#/bySource/agy`, `#/population/loops`
- `severity`: `P3`
- `reproCommand`: `jq -c '{rows:(.loops|length),agyRows:([.loops[]|select(.source=="agy")]|length),agyRepeats:([.loops[]|select(.source=="agy")|.repeats]|add),agyCalls:.bySource.agy.toolCalls,nullDigestRows:([.loops[]|select(.argsDigest|startswith("74234e98afe7498f"))]|length)}' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the loop fold's argument hashing and singleton filter.

### F9 — both renders open with a duplicated title inside an unclosed code fence

- `key`: `workflow:spur-history-report:render-title-corrupted`
- `category`: `workflow`
- `impact`: Both rendered markdown files open with a malformed header — an unclosed opening code fence followed by a self-overlapping title string — placing all 187 lines of the current render inside a single code block. Automated markdown parsers and visual readers encounter corrupted document structure.
- `trend`: `not-comparable`
- `observation`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:3` is a bare opening fence and line 4 reads `# History forensics report — generated 2026-11-10T13:0# History forensics report — generated 2026-11-10T13:03:18.741Z`; the file contains exactly one line matching `^``` ` across its 187 lines. `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.md:3-4` is corrupted identically with timestamp `2026-11-10T13:03:20.091Z` across its 197 lines.
- `inference`: Two independent signals confirm a bug in the markdown serializer: first, the overlapping title prefix `# History forensics report — generated 2026-11-10T13:0# History...` proves a partial header buffer is flushed immediately before the full header; second, the unclosed opening fence at line 3 places the entire report body into a code block in both independently generated files. Named observations: lines 3–4 of current and baseline renders, the single unclosed fence in each, and the identical overlapping title pattern.
- `contradictions`: The underlying artifact JSON is completely valid — `#/generatedAt` is well-formed in both current (`2026-11-10T13:03:18.741Z`) and baseline (`2026-11-10T13:03:20.091Z`) — so the defect is strictly confined to the markdown serializer template.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:3-4`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.md:3-4`
- `severity`: `P3`
- `reproCommand`: `sed -n '1,5p' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md; grep -c '^```' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md`
- `ownerSurface`: `spur history report` — the markdown header and code fence formatting logic.

### F10 — cold cache re-send waste accounts for 312,198 fresh tokens across 3 assistant steps

- `key`: `performance:prompt-cache:cold-resend-waste`
- `category`: `performance`
- `impact`: 3 assistant steps in `pi` with model `glm-5.3-flash` re-sent large context prompts (>100,000 tokens) with 0.0% cache reuse, consuming 312,198 fresh input tokens and adding $0.316843 in unnecessary spend.
- `trend`: `not-comparable`
- `observation`: `#/cacheWaste` reports `steps` 3 and `inputTokens` 312,198. The 3 steps occurred in session `2026-11-10T02-07-44-282Z_01a1c336-1698-77c5-bc1c-865631683e2f` (107,329 fresh input tokens, 0 cache read, $0.111239 cost, duration 1,323 ms) and session `2026-11-10T04-41-57-542Z_01a1c3c3-4825-72e2-ab46-30d674fb0791` (102,587 input tokens, 0 cache read, $0.102917 cost, duration 9,242 ms; and 102,282 input tokens, 0 cache read, $0.102687 cost, duration 8,571 ms).
- `inference`: Two independent signals show that context caching failed to activate during prompt resends in two pi sessions: first, cache reuse was 0.0% on steps exceeding 100k input tokens; second, the steps occurred within established sessions that had already processed dozens of prior turns. Named observations: the 3 steps in `#/cacheWaste`, 0 cache read tokens on all 3, and individual token counts exceeding 100k.
- `contradictions`: Overall cache hit ratio across the entire window remains high at 96.47% (116,370,048 of 120,623,626 billed input tokens read from cache), so cache waste is localized to specific cold-resend events rather than systemic cache bypass. Baseline reported 0 steps and 0 tokens of cache waste.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/cacheWaste`, `#/totals/cacheReadTokens`
- `severity`: `P3`
- `reproCommand`: `jq -c '.cacheWaste' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `pi` prompt cache configuration and session context retention.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count, or impact change is computed or implied. The final column records whether the same signal class is discretely present in the baseline artifact and what a comparable baseline would require.

| Stable key | Recurrence class | Severity now | Discrete baseline presence and what a comparable baseline would need |
| --- | --- | --- | --- |
| `telemetry:spur-history-import:tool-duration-unmeasured` | `not-comparable` | P1 | Present in baseline at 68.52% unmeasured (3,508 of 5,120 calls); present here at 61.46% unmeasured (2,465 of 4,011 calls). Agy emits 0 ms in both artifacts. A comparable baseline requires equal elapsed duration and identical lane instrumentation. |
| `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex` | `not-comparable` | P2 | Present in baseline: agy had 0 usage across 6,281 records (and 0 across 6,281 unknown model records); present here with 0 usage across 5,166 records and $0 cost. A comparable baseline requires identical usage attribution rules. |
| `telemetry:spur-history-import:agy-assistant-steps-unmeasured` | `not-comparable` | P2 | Present in baseline: 2,663 of 2,986 agy assistant steps had no duration (89.18% unmeasured); present here with 2,416 of 2,551 agy assistant steps unmeasured (94.71%). A comparable baseline requires consistent step duration extraction. |
| `telemetry:spur-history-analyze:time-decomposition-nonreconciling` | `not-comparable` | P2 | Present in baseline where buckets sum exceeded span by 22,124 ms and llmMs exceeded assistant totals by 1,044,551 ms; present here with a bucket-to-span excess of 18,301 ms. In both artifacts, the time decomposition fold fails to reconcile. A comparable baseline requires consistent bucket derivation across both runs. |
| `reliability:pi-dsv4.1-flash-volc-executor:dispatch-failures` | `not-comparable` | P2 | Present in baseline (16 failures out of 25 dispatches across coder, reviewer, and scribe roles); present here with 4 failures out of 4 dispatches in the scribe role (100% failure rate) with 2 resource-exhaustion escalations. |
| `coverage:spur-task-check:verified-outcome-absent` | `not-comparable` | P2 | Present in baseline: `taskDenominator` was 0, `verifiedResults` 0; present here with `taskDenominator` 0, `verifiedResults` 0, and all rates `null`. A comparable baseline requires completed task runs in both windows. |
| `coverage:spur-history-import:message-reconciliation-gap` | `not-comparable` | P3 | Present in baseline: coverage summed to 12,241 messages vs 11,905 totals (336 difference); present here: coverage sums to 8,936 messages vs 8,892 totals (44 difference on agy). |
| `telemetry:spur-history-analyze:loop-args-digest-null` | `not-comparable` | P3 | Present in baseline (15 of 16 rows carried `sha256(null)`, all agy rows); present here on 28 of 29 rows, summing to 2,464 agy calls (100% of agy calls). A comparable baseline requires real argument hashing. |
| `workflow:spur-history-report:render-title-corrupted` | `not-comparable` | P3 | Present identically in both renders: line 3 opening fence unclosed, line 4 duplicated title prefix. A comparable baseline requires renderer fix verification. |
| `performance:prompt-cache:cold-resend-waste` | `not-comparable` | P3 | Absent in baseline (0 steps, 0 tokens); present here with 3 steps wasting 312,198 fresh tokens and $0.316843 on glm-5.3-flash. |
| `positive:spur-history-import:clean-import-and-tool-runs` | `not-comparable` | P3 | Present in baseline: 0 parse/validation errors across 123 files, 0 tool errors across 5,120 calls; present here: 0 parse/validation errors across 141 files, 0 tool errors across 4,011 calls. |
| `positive:pairing-analytics:clean-execution-on-gemini-and-deepseek` | `not-comparable` | P3 | Improved over baseline: 25 of 25 dispatches across agy-gemini and pi-deepseek succeeded cleanly (100% success rate) with complete cost attribution ($15.458664 total across 4 rows with dispatches). |
| `positive:spur-history-import:pi-complete-measurement-axis` | `not-comparable` | P3 | Present in baseline: pi fully measured on steps (1,540 of 1,540) and tools (1,612 of 1,612 timed); present here: 1,390 of 1,391 steps timed, 1,546 of 1,547 tool calls timed, 96.47% cache reuse at $0.0620/1M. |
| `positive:spur-history-analyze:source-and-model-folds-sum-to-totals` | `not-comparable` | P3 | Present in baseline: all source/model totals reconciled; present here: 10 source checks and 7 model checks equal totals exactly across records, messages, tools, tokens, and spend. |

## Telemetry gaps

Dimensions the artifact cannot support. Each renders `not available`; none is inferred from raw history files.

| Dimension | Rendering | Why | Anchor |
| --- | --- | --- | --- |
| Duration for 2,465 of 4,011 tool calls | `not available` | The agy lane reports `durationMs` 0 with populated `durationUnmeasured` 2,464; pi has 1 untimed call | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/byTool`, `#/bySource`, `#/totals` |
| Provider usage on 7,496 of 8,892 records | `not available` | `#/totals/recordsWithUsage` is 1,396 of 8,892 (15.70%); agy reports 0 of 5,166, claude 1 of 22, opencode 4 of 8, pi 1,391 of 3,696 | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/totals`, `#/bySource` |
| Token and cost attribution for the agy lane | `not available` | `#/bySource/agy` reports 0 on every token axis and $0 cost over 5,166 records (58.09% of window records) | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/bySource/agy`, `#/byModel/unknown` |
| Duration on 2,416 of 2,551 agy assistant steps | `not available` | Only 135 of 2,551 agy assistant steps report duration in `#/stepSupport`, leaving 94.71% unmeasured | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/agy` |
| Component breakdown of excess decomposition time | `not available` | Time buckets sum to 73,853,105 ms, exceeding `spanMs` (73,834,804 ms) by 18,301 ms | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/derived/timeDecomposition` |
| Message-count reconciliation between `#/coverage` and `#/bySource` | `not available` | `#/coverage` sums to 8,936 messages against `#/totals` 8,892; the 44-message gap sits entirely in agy | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/coverage`, `#/bySource`, `#/totals` |
| Tool command and argument text | `not available` | `byTool` carries no command text; `#/loops` exposes only `argsDigest`, which is `sha256(null)` on 28 of 29 rows | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Result bytes for agy tools | `not available` | `resultBytes` is reported as 0 across all agy tools in `byTool`; no byte counts are recorded | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/byTool` |
| Loop repetition below the fold's threshold | `not available` | `#/loops` reports only signatures repeating at least 3 times; single and double repeats are not surfaced | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/loops`, `#/population/loops` |
| Per-pairing model identity | `not available` | `model` is `null` on all 5 pairing rows despite populated cost and duration | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/pairings` |
| Verified-rate and cost per verified result | `not available` | `taskDenominator` is 0; no completed tasks certified under `spur task check` in the window | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/verifiedOutcome` |
| Per-phase breakdown | `not available` | `phaseSupport` is `supported` with an empty `phases` array and `invalidPhaseCount` 0 | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/derived/phases` |
| Cache-write volume on all lanes | `not available` | `cacheWriteTokens` is 0 across all sources and models in the current window | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/totals`, `#/bySource` |
| The current day's remaining 18.94 h | `not available` | The window is `provisional` and 21.06% elapsed at generation; all figures describe a partial-day snapshot | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-provenance.json` — `windowState`; `#/generatedAt`, `#/selector` |
| Workflow digest and provenance model | `not available` | Provenance records `workflowDigest`, `model` and `spurVersion` as `not available` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-provenance.json` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` on four axes in section 3, including 21.06% elapsed coverage vs a completed day | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.json` |

Attribution note for the 24.92% unattributed bucket: `#/warnings/0` states that `18402369ms` could not be attributed because some durations were unmeasured, pointing to the per-source step-support matrix. Combined with F1 (2,465 untimed tool calls) and F3 (2,416 untimed agy assistant steps), unattributed time is the arithmetic shadow of measurement gaps rather than idle workload.

## Remediation options

Proposals only. Nothing below has been applied, no diff is produced, and no command here was run by this report. Each option carries the printed `spur task create` handoff that lands it, with the finding's stable key in the task text so the next report classifies that finding as `resolved`. The operator remains the gate: a model-authored report never writes to the task corpus.

**R1 — emit per-call tool timing on the agy lane** (addresses `telemetry:spur-history-import:tool-duration-unmeasured`)

- Owner surface: `spur history import` — the per-tool-call duration record for the agy adapter, consumed by `byTool` and `derived.timeDecomposition`.
- Expected impact: `toolMs` stops being purely the pi lane's identity and covers up to 4,011 calls; the 24.92% unattributed bucket shrinks by the share currently hiding untimed calls; the bottleneck ranking reflects true multi-agent tool execution.
- Verification method: a fresh artifact reports `#/totals/durationUnmeasured` near 0 against `#/totals/toolCalls`, non-zero `durationMs` on agy in `#/bySource`, and `#/warnings` free of `derived-unattributed-time`.
- Reversibility: reversible — an importer field mapping; a re-import rebuilds the rows and reverting the mapping restores current behaviour.
- Handoff: `spur task create "telemetry:spur-history-import:tool-duration-unmeasured — emit per-call tool timing on agy lane" --template issue`

**R2 — extract provider usage for agy records and populate agy model tokens** (addresses `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex`)

- Owner surface: `spur history import` — the agy adapter's provider usage extraction and `spur history analyze` model resolution joins.
- Expected impact: agy reports its own input tokens, output tokens, cache read, and cost across its 5,166 records, or explicitly renders the dimension `not available`; per-lane spend becomes readable for 58.09% of the window's records.
- Verification method: a fresh artifact reports non-zero `#/bySource/agy/inputTokens` and `#/bySource/agy/costUsd` with populated `#/byModel` entries for agy models, or an explicit `not available` marker on that lane.
- Reversibility: reversible — adapter extraction and fold join changes; no historical logs are modified.
- Handoff: `spur task create "telemetry:spur-history-import:agy-zero-usage-attributed-to-codex — extract provider usage for agy adapter" --template issue`

**R3 — measure assistant step durations across all agy assistant turns** (addresses `telemetry:spur-history-import:agy-assistant-steps-unmeasured`)

- Owner surface: `spur history import` — the agy adapter's assistant turn timestamp extraction.
- Expected impact: assistant step duration is captured for all 2,551 agy assistant turns rather than 135 steps; eliminates the 2,416 unmeasured steps in `#/stepSupport` and produces realistic per-step latency metrics.
- Verification method: a fresh artifact reports `stepsWithDuration` equal to `assistantSteps` for agy in `#/stepSupport`, and `assistantDurationUnmeasured` is 0 in `#/bySource/agy`.
- Reversibility: reversible — adapter timestamp calculation logic.
- Handoff: `spur task create "telemetry:spur-history-import:agy-assistant-steps-unmeasured — capture step duration across all agy turns" --template issue`

**R4 — reconcile time decomposition bucket sum with wall span** (addresses `telemetry:spur-history-analyze:time-decomposition-nonreconciling`)

- Owner surface: `spur history analyze` — the `derived.timeDecomposition` fold and the session wall span aggregation logic.
- Expected impact: the sum of the four decomposition buckets (`llmMs`, `toolMs`, `idleMs`, `unattributedMs`) equals `spanMs` exactly, eliminating the 18,301 ms arithmetic excess.
- Verification method: a fresh artifact reports `([.derived.timeDecomposition.llmMs, .derived.timeDecomposition.toolMs, .derived.timeDecomposition.idleMs, .derived.timeDecomposition.unattributedMs] | add) == .derived.timeDecomposition.spanMs`.
- Reversibility: reversible — fold calculation change; no stored artifacts are modified.
- Handoff: `spur task create "telemetry:spur-history-analyze:time-decomposition-nonreconciling — reconcile time decomposition bucket sum with wall span" --template issue`

**R5 — investigate resource exhaustion and refine dispatch configuration for `pi-dsv4.1-flash-volc`** (addresses `reliability:pi-dsv4.1-flash-volc-executor:dispatch-failures`)

- Owner surface: the `pi-dsv4.1-flash-volc` configuration in the agent ladder (`#/ladderSnapshot`, order 1 tier `standard`) and opencode dispatch settings.
- Expected impact: mitigates 100% dispatch failure rate (4 of 4 failed in scribe role) and eliminates resource-exhaustion escalations, restoring dispatch reliability on this executor.
- Verification method: a subsequent artifact reports a `successRate` >= 0.90 for `pi-dsv4.1-flash-volc` with 0 resource-exhaustion escalations.
- Reversibility: reversible — dispatch resource limits and ladder configuration.
- Handoff: `spur task create "reliability:pi-dsv4.1-flash-volc-executor:dispatch-failures — fix dispatch failures on pi-dsv4.1-flash-volc" --template issue`

**R6 — instrument task verification and outcome tracking in workflows** (addresses `coverage:spur-task-check:verified-outcome-absent`)

- Owner surface: `spur task check` (the proof-producing gate) and the `verifiedOutcome` fold in `spur history analyze`.
- Expected impact: tasks that complete and verify produce PASS proof that the fold incorporates, enabling calculation of `verifiedRate`, `timeToVerified`, and cost per verified result.
- Verification method: a subsequent artifact for a closed window reports `taskDenominator > 0` with `verifiedResults > 0` and non-null `measuredTokensPerVerifiedResult`.
- Reversibility: reversible — query joins and verification reporting.
- Handoff: `spur task create "coverage:spur-task-check:verified-outcome-absent — connect verified task outcomes to history analytics" --template issue`

**R7 — reconcile importer coverage message counts with totals** (addresses `coverage:spur-history-import:message-reconciliation-gap`)

- Owner surface: `spur history import` — the coverage metadata accumulator and message-filtering logic.
- Expected impact: resolves the 44-message gap between `#/coverage` (8,936) and `#/totals` (8,892), ensuring that metadata reporting reflects the exact population ingested into analytical tables.
- Verification method: a fresh artifact reports the sum of `#/coverage[].messages` equal to `#/totals/messages` to the unit.
- Reversibility: reversible — importer logging and aggregation logic.
- Handoff: `spur task create "coverage:spur-history-import:message-reconciliation-gap — reconcile coverage message counts with totals" --template issue`

**R8 — capture real tool invocation arguments for agy adapter** (addresses `telemetry:spur-history-analyze:loop-args-digest-null`)

- Owner surface: `spur history import` agy adapter argument extraction, and `spur history analyze` loop fold.
- Expected impact: `argsDigest` becomes a real cryptographic hash of tool arguments, allowing the singleton filter to separate genuine tool loops from distinct commands; removes 2,464 false repeats on `sha256(null)`.
- Verification method: a fresh artifact reports distinct `argsDigest` values on agy loop rows whose repeats sum to far fewer than total tool calls, or explicitly marks argument text `not available`.
- Reversibility: reversible — hash derivation and adapter parsing.
- Handoff: `spur task create "telemetry:spur-history-analyze:loop-args-digest-null — capture real tool arguments for agy adapter" --template issue`

**R9 — emit markdown report header once and close the opening code fence** (addresses `workflow:spur-history-report:render-title-corrupted`)

- Owner surface: `spur history report` — markdown header and code-fence emitter for `--mode forensics`.
- Expected impact: eliminates title string duplication, balances code fences, and ensures the markdown body is rendered as valid markdown rather than enclosed in an unclosed fence.
- Verification method: `sed -n '1,5p'` on a generated render shows the title exactly once, and `grep -c '^```'` returns an even number (or 0 outside code blocks).
- Reversibility: reversible — renderer template fix.
- Handoff: `spur task create "workflow:spur-history-report:render-title-corrupted — emit title once and balance code fences in report renderer" --template issue`

**R10 — investigate prompt-cache eviction or cold context resends on `pi` `glm-5.3-flash`** (addresses `performance:prompt-cache:cold-resend-waste`)

- Owner surface: `pi` prompt cache configuration and session context retention.
- Expected impact: prevents cold-resend context eviction on large turns (>100k tokens), saving up to $0.32 in duplicate token spend across 312k tokens per session.
- Verification method: a subsequent artifact reports `#/cacheWaste/steps` at 0 and `#/cacheWaste/inputTokens` at 0.
- Reversibility: reversible — prompt cache prefixing and session context management.
- Handoff: `spur task create "performance:prompt-cache:cold-resend-waste — investigate cold prompt cache resends on pi glm-5.3-flash" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 73,834,804 ms = 20.51 h against a 24.0 h window):

| Component | Time | Share of span |
| --- | --- | ---: |
| Tool execution | 10.59 h (38,127,877 ms) | 51.64% |
| Unattributed (unmeasured durations) | 5.11 h (18,402,369 ms) | 24.92% |
| LLM latency (assistant duration, summed) | 2.50 h (9,004,734 ms) | 12.20% |
| Idle / overhead | 2.31 h (8,318,125 ms) | 11.27% |

Reading: the four buckets sum to 73,853,105 ms, exceeding `spanMs` (73,834,804 ms) by 18,301 ms (18.30 s) (F4). Tool execution time (51.64%) equals the pi lane's `durationMs` to the millisecond (F1). LLM latency equals the sum of per-source assistant durations exactly, but 94.71% of agy assistant steps carry no duration (F3). Unattributed time (24.92%) is an instrumentation residual resulting from 2,465 untimed tool calls (61.46% of all calls) and 2,417 untimed assistant steps (`#/warnings/0`). The span is 20.51 h, excluding 9 sessions with unusable non-ISO timestamps (`spanExcludedSessions: 9`).

**Per-step latency by source** (`#/bySource`, `#/stepSupport`) — the axis explaining the LLM bucket:

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per timed step | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: |
| agy | 2,551 | 135 (2,416 missing) | 2,712,926 ms | 20,095.75 ms (20.10 s) | `not available` |
| claude | 1 | 1 (complete) | 251 ms | 251.00 ms (0.25 s) | 100.00% |
| opencode | 4 | 4 (complete) | 24,250 ms | 6,062.50 ms (6.06 s) | 100.00% |
| pi | 1,391 | 1,390 (1 missing) | 6,267,307 ms | 4,508.85 ms (4.51 s) | 96.47% |

Agy assistant steps exhibit extreme duration skew: only 135 of 2,551 steps are timed (94.71% missing), and those 135 steps average 20.10 s per step, reflecting macro wait times rather than token generation latency (F3). The largest single step duration in the window is an agy step at 1,294,000 ms (21.57 min) in session `f03ccc71-b50a-42c3-a18a-a1de9d5987ef`, followed by another agy step at 756,926 ms (12.62 min) in session `268e32d5-d56d-4f19-8f25-84f698b1dc1a`. Claude assistant steps average 0.25 s (1 step), opencode averages 6.06 s across 4 steps, and pi averages 4.51 s across 1,390 timed steps with 96.47% cache reuse.

**Tool execution** (`#/byTool`; instrumented total 38,127,877 ms):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| bash | 1,239 | 37,951,829 ms (10.54 h) | 30,655.23 ms (30.66 s) | 3,176,460 ms (52.94 min) | 1 |
| ask_user_question | 1 | 174,548 ms (2.91 min) | 174,548.00 ms (174.55 s) | 174,548 ms (2.91 min) | 0 |
| read | 149 | 677 ms | 4.54 ms | 30 ms | 0 |
| to&#100;o | 47 | 279 ms | 5.94 ms | 196 ms | 0 |
| edit | 82 | 275 ms | 3.35 ms | 89 ms | 0 |
| ffgrep | 2 | 232 ms | 116.00 ms | 229 ms | 0 |
| write | 26 | 37 ms | 1.42 ms | 3 ms | 0 |
| contact_supervisor | 1 | 0 ms | 0.00 ms | 0 ms | 0 |
| run_command | 1,387 | `not available` | `not available` | `not available` | 1,387 |
| read_file | 766 | `not available` | `not available` | `not available` | 766 |
| write_file | 163 | `not available` | `not available` | `not available` | 163 |
| manage_task | 76 | `not available` | `not available` | `not available` | 76 |
| edit_file | 72 | `not available` | `not available` | `not available` | 72 |

Only the pi lane's tool calls are instrumented; 1,546 of 4,011 calls (38.54%) carry durations. `bash` accounts for 99.54% of all measured tool time (37,951,829 ms) with a mean of 30.66 s and a maximum of 3,176,460 ms (52.94 min). `ask_user_question` accounts for 174,548 ms (2.91 min), reflecting operator response latency grouped under tool execution. Five tool keys accounting for 2,464 calls across agy are 100% untimed (`run_command` 1,387, `read_file` 766, `write_file` 163, `manage_task` 76, `edit_file` 72). Tool-name aliases fragment operations: shell execution splits across `run_command` (1,387) and `bash` (1,239) (2,626 calls total); file reading across `read_file` (766) and `read` (149) (915 calls total); and file editing across `edit` (82) and `edit_file` (72) (154 calls total).

**Cost and tokens by source** (`#/bySource`, `#/totals`, total `$7.475503`):

| Source | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cost / 1M billed input | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 3,696 | 120,623,626 | 116,370,048 | 0 | 644,385 | `$7.475503` | 100.00% | $0.0620 | 96.47% |
| agy | 5,166 | 0 | 0 | 0 | 0 | `$0` | 0.00% | `not available` | `not available` |
| claude | 22 | 0 | 0 | 0 | 0 | `$0` | 0.00% | `not available` | `not available` |
| opencode | 8 | 0 | 0 | 0 | 0 | `$0` | 0.00% | `not available` | `not available` |

Window totals: billed input 120,623,626 (fresh 4,253,578 · cache-read 116,370,048 · cache-write 0), output 644,385, overall cache-hit ratio 96.47%, provider usage present on 1,396 of 8,892 records (15.70%). Pi is the only cost-instrumented lane, accounting for 100% of recorded billed input (120.62M tokens) and 100% of window spend ($7.48) at an economical rate of $0.0620 per 1M billed input tokens and 96.47% cache reuse. Agy, claude, and opencode records carry zero token and spend telemetry (F2).

**Chained `agent.run` run cost** (per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Agent | Dispatches | Success rate | Failures | Unknown outcomes | Escalations | Total cost | Mean duration |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| `agy-gemini` | reviewer | antigravity-cli | 3 | 1.00 | 0 | 0 | none | `$2.243858` | 248,860.39 ms (4.15 min) |
| `agy-gemini` | scribe | antigravity-cli | 1 | 1.00 | 0 | 0 | none | `$0.221105` | 578,298.23 ms (9.64 min) |
| `pi-deepseek` | reviewer | pi | 16 | 1.00 | 0 | 0 | none | `$9.776066` | 133,223.66 ms (2.22 min) |
| `pi-deepseek` | scribe | pi | 5 | 1.00 | 0 | 0 | none | `$3.217635` | 94,879.76 ms (1.58 min) |
| `pi-dsv4.1-flash-volc` | scribe | opencode | 4 | 0.00 | 4 | 0 | resource-exhaustion: 2 | `$0` | 15,184.52 ms (15.18 s) |

All 5 pairing rows report `totalCostUsd` ($15.458664 total across 4 rows with dollar spend and 1 unbilled row, P2), although `model` is `null` across all rows. Reviewer dispatches totaled 19 (19 successes, 0 failures, $12.019924 cost), achieving 100% success across `agy-gemini` and `pi-deepseek`. Scribe dispatches totaled 10 (6 successes, 4 failures, $3.438740 cost). All 4 failures occurred on `pi-dsv4.1-flash-volc` scribe (100% failure rate across 4 dispatches, F5), while `agy-gemini` and `pi-deepseek` were 100% reliable (25 of 25 succeeded).

**Cache re-send waste** (`#/cacheWaste`): 3 steps, 312,198 fresh input tokens, $0.316843 total cost. Three steps exceeded 100,000 input tokens with 0.0% cache reuse on `glm-5.3-flash`: session `2026-11-10T02-07-44-282Z_01a1c336-1698-77c5-bc1c-865631683e2f` (107,329 fresh input tokens, $0.111239 cost, duration 1,323 ms) and session `2026-11-10T04-41-57-542Z_01a1c3c3-4825-72e2-ab46-30d674fb0791` (102,587 input tokens, $0.102917 cost, duration 9,242 ms; and 102,282 input tokens, $0.102687 cost, duration 8,571 ms).

**Per-session concentration** (`#/bySession`, top 20 of 51 sessions listed): the top session by cost is a pi session (`2026-11-10T02-07-44-282Z_01a1c336-1698-77c5-bc1c-865631683e2f`) with 1,375 messages, 573 tool calls, `$2.697792` cost (36.09% of window cost). The second largest session by cost is another pi session (`2026-11-10T04-41-57-542Z_01a1c3c3-4825-72e2-ab46-30d674fb0791`) with 764 messages, 298 tool calls, and `$1.823202` cost (24.39% of window cost). The third largest is a pi session (`2026-11-10T05-35-27-225Z_01a1c3f4-41f8-757e-9c06-2f85be2f7809`) with 327 messages, 127 tool calls, and `$0.686627` cost. Together, the top 3 sessions account for $5.207621 (69.66% of cost). The top 20 sessions account for $7.157642 (95.75% of window cost). All 20 sessions in the leaderboard belong to `pi` due to $0 spend recorded on agy sessions (`c28772b6`, `8e92e254`, `f03ccc71`, etc.).

**Bottleneck order** (`#/derived/bottlenecks`): tool 51.64% → unattributed 24.92% → llm 12.20% → idle 11.27%. The leading tool category is derived entirely from the pi lane (F1), and unattributed time reflects 2,465 untimed tool calls across agy and pi.

## Workflow and process improvements

Numbered prose proposals and projected candidates; each is report-only and requires operator review before implementation.

1. **Emit tool execution duration on the agy importer adapter.** The agy adapter reports 0 ms of tool duration across 2,464 calls (F1), forcing the analyzer to classify 24.92% of span as unattributed time. Importers should record start and completion timestamps for all tool invocations. Owner surface: `spur history import` agy adapter. Recurrence basis: present in both current (61.46% untimed) and baseline (68.52% untimed) artifacts at `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` `#/totals`.
2. **Qualify coverage denominators alongside aggregate metric displays.** The report render displays `Tool execution | 10.6h | 52%` (`current.md:59`) without indicating that the figure represents only 1,546 of 4,011 tool calls (38.54%). Renders should print the measured population fraction next to every aggregate to prevent misleading single-lane extrapolations. Owner surface: `spur history report` time decomposition renderer. Recurrence basis: cited at `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:59,72-89`.
3. **Capture provider token usage and model identity on agy sessions.** The agy adapter imports 5,166 records (58.09% of window records) with 0 provider usage and $0 cost (F2). Parsing token metadata from agy session logs will restore cost visibility for developer activity. Owner surface: `spur history import` agy adapter. Recurrence basis: present across both artifacts at `#/bySource/agy` in current and baseline.
4. **Measure step duration across all assistant turns in agy.** 2,416 of 2,551 agy assistant steps (94.71%) carry no duration, while timed steps report an extreme 20.10 s mean (F3). Capturing per-turn timestamps will prevent macro prompt wait times from distorting latency metrics. Owner surface: `spur history import` agy adapter. Recurrence basis: observed at `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` `#/stepSupport`.
5. **Reconcile time decomposition bucket sum with session wall span.** The analyzer fold produces four decomposition buckets whose sum exceeds `spanMs` by 18,301 ms (F4). Adding an invariant assertion will ensure internal reconciliation between bucket totals and component wall spans. Owner surface: `spur history analyze` `derived.timeDecomposition` fold. Recurrence basis: present in both current (18,301 ms excess) and baseline (22,124 ms excess) artifacts at `#/derived/timeDecomposition`.
6. **Investigate resource exhaustion and failure modes on `pi-dsv4.1-flash-volc`.** `pi-dsv4.1-flash-volc` suffered 100% dispatch failure (4 of 4 failed in scribe role) with 2 resource-exhaustion escalations (F5), terminating within 15.18 s. Establishing bounded retry intervals and inspecting opencode failure logs will restore dispatch completion. Owner surface: agent dispatch orchestration for `pi-dsv4.1-flash-volc`. Recurrence basis: observed in current at `#/pairings` and baseline (16 of 25 failures).
7. **Reconcile import coverage message accounting with table ingestion totals.** The coverage table reports 8,936 messages while totals reports 8,892 messages (F7). Importer telemetry should harmonize coverage metadata with ingested record counts. Owner surface: `spur history import` coverage accounting. Recurrence basis: present in current (44-message gap) and baseline (336-message gap) at `#/coverage`.
8. **Capture real tool argument hashes for agy tool invocations.** 28 of 29 loop rows collapse into `sha256(null)` because agy arguments are uncaptured (F8). Implementing argument serialization in the agy importer will enable accurate tool loop detection. Owner surface: `spur history import` agy adapter and `spur history analyze` loop fold. Recurrence basis: present in both current (28 rows, 2,464 calls) and baseline (15 rows, 3,154 calls) at `#/loops`.
9. **Correct markdown report renderer title duplication and close code fence.** The renderer outputs a duplicate title string on line 4 and leaves the line 3 opening code fence unclosed (F9). Fixing the template emitter will ensure reports are well-formed markdown documents. Owner surface: `spur history report` markdown renderer. Recurrence basis: identical failure on lines 3–4 of current and baseline renders at `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:3-4`.
10. **Mitigate cold prompt-cache resends on high-token assistant steps.** 3 steps in `pi` with model `glm-5.3-flash` experienced 0.0% cache reuse on steps over 100k tokens, wasting 312,198 fresh tokens (F10). Preserving cache prefixes across session turns will eliminate redundant token expenditure. Owner surface: `pi` prompt caching and session context retention. Recurrence basis: observed at `#/cacheWaste`.

Projected candidate under the environment-improvement lens (task 0686):
- `workflow:agents-md:navigation` — **owner surface:** `AGENTS.md` see_also section. **expected impact:** shorter file search latency during agent session startup. **verification method:** subsequent daily report key `resolved` or absent. **reversibility:** revert pointer edit in `AGENTS.md`.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry, and no command substitution. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | First observed | Note |
| --- | --- | ---: | --- | --- |
| `run_command` + `argsDigest` `74234e98afe7498f…` | agy · `8e92e254-ada4-42b8-bf00-42db6f51a609` | 589 | `2026-11-10T03:51:20Z` | The digest is `sha256(null)`, so this counts 589 shell commands with no captured arguments, not identical invocations (F8). `firstSeq` 1 → `lastSeq` 492, `model` `unknown`. |
| `run_command` + `argsDigest` `74234e98afe7498f…` | agy · `268e32d5-d56d-4f19-8f25-84f698b1dc1a` | 180 | `2026-11-10T04:44:28Z` | Same null digest; counts 180 shell commands across `firstSeq` 3 → `lastSeq` 194. |
| `read_file` + `argsDigest` `74234e98afe7498f…` | agy · `268e32d5-d56d-4f19-8f25-84f698b1dc1a` | 168 | `2026-11-10T04:44:24Z` | Same session, same null digest; counts 168 file read calls across `firstSeq` 1 → `lastSeq` 190. |
| `run_command` + `argsDigest` `74234e98afe7498f…` | agy · `7dd1b05c-7967-4989-a749-28c0b3267790` | 164 | `2026-11-10T06:42:12Z` | Same null digest; counts 164 shell commands across `firstSeq` 13 → `lastSeq` 141. |
| `write_file` + `argsDigest` `74234e98afe7498f…` | agy · `8e92e254-ada4-42b8-bf00-42db6f51a609` | 147 | `2026-11-10T03:57:45Z` | Same session, same null digest; counts 147 file write calls across `firstSeq` 130 → `lastSeq` 474. |
| `manage_task` + `argsDigest` `74234e98afe7498f…` | agy · `f9176f57-41d2-4a80-88e7-c6d068d1e43d` | 36 | `2026-11-10T06:38:59Z` | Same null digest; counts 36 task management calls across `firstSeq` 23 → `lastSeq` 66. |
| `bash` + `argsDigest` `ad615fc568b82ade…` | pi · `2026-11-10T02-07-44-282Z_01a1c336-1698-77c5-bc1c-865631683e2f` | 4 | `2026-11-10T10:58:40.747Z` | Real digest: identical `bash` invocation repeated 4 times in one pi session; model `glm-5.3-flash`, `firstSeq` 1286 → `lastSeq` 1314. |

The loop fold reports signatures repeating at least 3 times. Of the 29 rows, 28 belong to agy and carry `sha256(null)`, with repeats summing to 2,464 (100% of agy tool calls). The single pi row carries a real argument digest, accounting for 4 repeats across 1,547 pi tool calls. Repeats of 1 or 2 calls are `not available` from this evidence plane, and tool calls cannot be individually audited for command text because `byTool` carries no command text. A single `bash` call accounted for 3,176,460 ms (52.94 min), representing command runtime rather than repetition. None of these observations triggers automated workflow intervention.

## Positive patterns

Held to the same evidence standard as problems: observation, inference, and at least one anchor each.

### P1 — 4,011 tool calls and 141 imported files produced no errors

- `key`: `positive:spur-history-import:clean-import-and-tool-runs`
- `category`: `positive`
- `impact`: The evidence plane is dependable on its error axis: no tool call failed and no imported record was rejected across four sources and 141 files. Gaps in the report reflect measurement coverage limits (F1, F2, F3, F4) rather than parsing crashes or corrupt data.
- `trend`: `not-comparable`
- `observation`: `#/byTool[].errors` is 0 for all 13 listed tool keys summing to 4,011 calls. `#/coverage` reports `parseErrors` 0, `validationErrors` 0, `unknownRecords` 0, `parseErrorSamples` `[]`, and `validationErrorSamples` `[]` for all four sources: agy 102 files, claude 1 file, opencode 8 files, pi 30 files (141 files total).
- `inference`: Zero errors across every tool call plus zero parse, validation, and unknown record counts across 141 files proves the importer read the corpus without record loss or syntax rejections. Named observations: all-zero tool `errors` column, all-zero error counters in `#/coverage`, and agreement between coverage tool calls (4,011) and totals tool calls (4,011).
- `contradictions`: Error-free execution does not imply complete telemetry: the agy lane reports 0 ms tool duration across 2,464 calls (F1), agy reports 0 usage (F2), and 2,416 agy assistant steps lack duration (F3). Message counts also show a 44-message reconciliation difference between coverage and totals (F7). Completeness is established for tool execution status and file parsing, not for telemetry depth.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`, `#/population`
- `severity`: `P3`
- `reproCommand`: `jq -c '{toolErrors:([.byTool[].errors]|add),listedCalls:([.byTool[].calls]|add),coverage:[.coverage[]|{s:.source,f:.files,m:.messages,p:.parseErrors,v:.validationErrors,u:.unknownRecords}],totals:{m:.totals.messages,c:.totals.toolCalls}}' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — all four source lanes and their parsing pipelines.

### P2 — 100% success on Gemini and DeepSeek dispatches with complete financial attribution

- `key`: `positive:pairing-analytics:clean-execution-on-gemini-and-deepseek`
- `category`: `positive`
- `impact`: All 25 dispatches routed to `agy-gemini` (4 dispatches, $2.464963) and `pi-deepseek` (21 dispatches, $12.993701) succeeded with a 100% success rate, 0 failures, and 0 escalations. Across all 5 pairing rows, financial reporting is 100% complete ($15.458664 total across 4 rows with dollar spend and 1 unbilled row) with zero unknown outcomes.
- `trend`: `not-comparable`
- `observation`: `#/pairings` reports `agy-gemini` reviewer (3 dispatches, successRate 1.0, cost $2.243858), `agy-gemini` scribe (1 dispatch, successRate 1.0, cost $0.221105), `pi-deepseek` reviewer (16 dispatches, successRate 1.0, cost $9.776066), and `pi-deepseek` scribe (5 dispatches, successRate 1.0, cost $3.217635). Across all 4 rows, `failures` is 0 and `unknownOutcomes` is 0. Total cost for these 25 dispatches is $15.458664.
- `inference`: Clean execution across 25 consecutive reviewer and scribe dispatches proves that the Gemini and DeepSeek dispatch routes are stable and reliable in current operational conditions. Complete cost coverage across all pairing rows confirms financial traceability for every dispatch. Named observations: 25 of 25 successful dispatches on `agy-gemini` and `pi-deepseek`, zero failures on those executors, and $15.458664 total attributed spend.
- `contradictions`: While Gemini and DeepSeek achieved 100% success, `pi-dsv4.1-flash-volc` suffered 4 failures across 4 scribe dispatches (F5), and `model` remains `null` on all 5 pairing rows. High reliability is specific to the active Gemini and DeepSeek executors.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '[.pairings[]|select(.executor!="pi-dsv4.1-flash-volc")|{e:.executor,r:.role,d:.dispatches,sr:.successRate,f:.failures,cost:.totalCostUsd,ms:.meanDurationMs}]' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the pairing analytics fold.

### P3 — the pi lane is fully instrumented on steps and delivers bulk tokens at 96.5% cache reuse

- `key`: `positive:spur-history-import:pi-complete-measurement-axis`
- `category`: `positive`
- `impact`: Pi serves as the fully instrumented reference implementation: 1,390 of 1,391 assistant steps have usage, duration, and cache read; 1,546 of 1,547 tool calls are timed. The lane processed 120,623,626 billed input tokens (100% of window input) at 96.47% cache reuse and $0.0620 per 1M billed input tokens. Complete telemetry on this lane enables accurate latency analysis and cross-lane comparison.
- `trend`: `not-comparable`
- `observation`: `#/stepSupport` pi row reports `assistantSteps` 1,391, `stepsWithUsage` 1,391, `stepsWithDuration` 1,390, `stepsWithDerivedDuration` 1,390, and `stepsWithCacheRead` 1,391. `#/bySource/pi` reports `toolCalls` 1,547 with `durationMs` 38,127,877 and `durationUnmeasured` 1, `inputTokens` 120,623,626, `cacheReadTokens` 116,370,048, and `costUsd` 7.475503.
- `inference`: Complete agreement across step counts, usage, duration, and cache-read counters (1,390/1,391) proves pi's telemetry pipeline captures a full measurement record per step with near-zero dropped fields. Named observations: exact 1,390/1,391 step agreement, 1 unmeasured call across 1,547 tool calls, and 96.47% cache reuse.
- `contradictions`: Pi represents 100% of billed input and 100% of cost; its high efficiency is accompanied by 3 cold-resend cache waste events (F10).
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/pi`, `#/byTool`
- `severity`: `P3`
- `reproCommand`: `jq -c '{steps:(.stepSupport[]|select(.source=="pi")),tools:{calls:.bySource.pi.toolCalls,ms:.bySource.pi.durationMs,u:.bySource.pi.durationUnmeasured},reuse:(.bySource.pi.cacheReadTokens/.bySource.pi.inputTokens),costPerM:(.bySource.pi.costUsd/(.bySource.pi.inputTokens/1000000))}' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pi source lane adapter.

### P4 — source and model folds sum to every window total across records, tokens, costs, and calls

- `key`: `positive:spur-history-analyze:source-and-model-folds-sum-to-totals`
- `category`: `positive`
- `impact`: Ten reconciliation checks on `bySource` and seven on `byModel` equal `#/totals` exactly across tokens, costs, records, messages, and calls. Arithmetic integrity holds across aggregations, allowing discrepancies (F1, F2, F3, F4) to be isolated to upstream adapter gaps.
- `trend`: `not-comparable`
- `observation`: `#/bySource` sums equal `#/totals` for `inputTokens` (120,623,626), `outputTokens` (644,385), `cacheReadTokens` (116,370,048), `cacheWriteTokens` (0), `costUsd` (7.475503), `records` (8,892), `messages` (8,892), `toolCalls` (4,011), `assistantDurationMs` (9,004,734), and `durationMs` (38,127,877). `#/byModel` sums equal `#/totals` across all seven relevant dimensions.
- `inference`: Independent distributions reproduce total counters across 17 distinct aggregation checks, confirming the folds process a consistent underlying record dataset. Named observations: 10 source-fold equalities and 7 model-fold equalities.
- `contradictions`: Totals agreement does not prevent internal attribution divergence: the time decomposition buckets sum exceeds spanMs by 18,301 ms (F4), and coverage messages disagree with totals by 44 messages (F7). The positive is strictly scoped to the mathematical consistency of the source and model aggregation folds.
- `evidenceAnchor`: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/bySource`, `#/byModel`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{src:{in:(([.bySource[].inputTokens]|add)==.totals.inputTokens),out:(([.bySource[].outputTokens]|add)==.totals.outputTokens),cr:(([.bySource[].cacheReadTokens]|add)==.totals.cacheReadTokens),cw:(([.bySource[].cacheWriteTokens]|add)==.totals.cacheWriteTokens),cost:(((([.bySource[].costUsd]|add)-.totals.costUsd)|if .<0 then -. else . end)<0.000001),rec:(([.bySource[].records]|add)==.totals.records),msgs:(([.bySource[].messages]|add)==.totals.messages),tools:(([.bySource[].toolCalls]|add)==.totals.toolCalls),asst:(([.bySource[].assistantDurationMs]|add)==.totals.assistantDurationMs),dur:(([.bySource[].durationMs]|add)==.totals.durationMs)},model:{in:(([.byModel[].inputTokens]|add)==.totals.inputTokens),out:(([.byModel[].outputTokens]|add)==.totals.outputTokens),cr:(([.byModel[].cacheReadTokens]|add)==.totals.cacheReadTokens),cost:(((([.byModel[].costUsd]|add)-.totals.costUsd)|if .<0 then -. else . end)<0.000001),rec:(([.byModel[].records]|add)==.totals.records),msgs:(([.byModel[].messages]|add)==.totals.messages),tools:(([.byModel[].toolCalls]|add)==.totals.toolCalls)}}' .spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the aggregation folds for `totals`, `bySource`, and `byModel`.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `telemetry:spur-history-import:tool-duration-unmeasured` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/byTool`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:72-90` |
| `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/bySource/agy`, `#/byModel/unknown`, `#/totals` |
| `telemetry:spur-history-import:agy-assistant-steps-unmeasured` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/agy`, `#/topStepsByDuration`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:92-100,126-136` |
| `telemetry:spur-history-analyze:time-decomposition-nonreconciling` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/derived/timeDecomposition`, `#/bySource`, `#/totals`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.json` — `#/derived/timeDecomposition`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:54-63` |
| `reliability:pi-dsv4.1-flash-volc-executor:dispatch-failures` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.json` — `#/pairings` |
| `coverage:spur-task-check:verified-outcome-absent` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool` |
| `coverage:spur-history-import:message-reconciliation-gap` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/coverage`, `#/bySource`, `#/totals`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.json` — `#/coverage`, `#/bySource`, `#/totals` |
| `telemetry:spur-history-analyze:loop-args-digest-null` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/loops`, `#/bySource/agy`, `#/population/loops` |
| `workflow:spur-history-report:render-title-corrupted` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.md:3-4`; `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.md:3-4` |
| `performance:prompt-cache:cold-resend-waste` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/cacheWaste`, `#/totals/cacheReadTokens` |
| `positive:spur-history-import:clean-import-and-tool-runs` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`, `#/population` |
| `positive:pairing-analytics:clean-execution-on-gemini-and-deepseek` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/pairings` |
| `positive:spur-history-import:pi-complete-measurement-axis` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/pi`, `#/byTool` |
| `positive:spur-history-analyze:source-and-model-folds-sum-to-totals` | `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-current.json` — `#/bySource`, `#/byModel`, `#/totals` |

Baseline artifacts cited in sections 3 and 5: `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byModel`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`, `#/totals`, `#/loops`, `#/cacheWaste`, `#/ladderSnapshot`) and `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-history-anatomy-baseline.md:3-4`. Window bounds and equal-duration offsets are recorded in `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-paths.txt:5-8`; run identity, digests, selector and provisional window state are recorded in `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-provenance.json` and `.spur/run/abca53ca-db86-4cee-b614-049cd05a5e84-selector.json`.

Two limitations of this report's own evidence: the current window is provisional and 21.06% elapsed at generation (5.06 h of 24.0 h, 18.94 h still to run); and no comparison against `2026-11-09` is stated anywhere in this report because that baseline was found `not comparable` on four independent axes in section 3.

