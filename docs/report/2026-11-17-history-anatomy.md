---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-11-17"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-11-17T00:00:00.000-08:00
    until: 2026-11-17T23:59:59.999-08:00
  sources:
    - source: pi
windowState: "provisional"
generatedAt: "2026-11-17T13:04:09.062Z"
validatedAt: "2026-11-17T13:20:10.949Z"
artifactDigest: "bf8d5bd9b6467e34b9faa030ef438d4b1a09b8da091dd70f953cf3e615e678a9"
baselineArtifactDigest: "212851c5294e874c1caca4c3ac5d1091e19a2753fd7cbed1f4d69fe108efbb52"
contractDigest: "206f2b9b62be625a52fd3e86ece60543660dfd7fcbf8b0830895db84f8feed1b"
skillDigest: "cf564d56119f4cf4d398bc9cf217e222da8dc1f191c490100914fd4274e1f92c"
workflowDigest: "not available"
helperDigest: "2f65002ef9d1d5e8d1ab16b2ba3dca97b7beac2eb099f5a4ebbce7339a4f91fc"
runId: "6d279e25-fd5c-4278-b76d-8f065fe15afe"
currentArtifactPath: ".spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.json"
spurVersion: "0.4.37"
schemaVersion: 1
executor: "antigravity-cli"
executorProfile: "not available: invocation executor absent"
model: "gemini-3.8-flash-high"
cacheDisposition: "miss"
coverage:
  - source: pi, status: ok, lastImportedAt: 2026-11-17T13:03:02.047Z
dispatches:
  - node: enrich, actionId: daf72056-209e-41b9-890e-0c1006f822c4, agent: antigravity-cli, executor: not available: invocation executor absent, model: gemini-3.8-flash-high, timeoutMs: 5400000
  - node: validate, actionId: 05c2ca12-cdef-48f8-9927-899b0bcf1e32, agent: antigravity-cli, executor: not available: invocation executor absent, model: gemini-3.8-flash-high, timeoutMs: 5400000
---

> imported snapshot as of 2026-11-17T13:03:02.047Z · window provisional · cache miss

<!-- Candidate authored by sp:history-anatomy enrich · mode daily · run 6d279e25-fd5c-4278-b76d-8f065fe15afe · schema v1 -->

# History forensics report — 2026-11-17 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `6d279e25`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report. No workflow was launched by this operation.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-11-17`, baseline is the immediately preceding local calendar day `2026-11-16` |
| Current window | `2026-11-17T00:00:00.000-08:00` → `2026-11-17T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Baseline window | `2026-11-16T00:00:00.000-08:00` → `2026-11-16T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Window offsets | Both windows sit entirely in `-08:00`; equal-duration with identical UTC offsets — read from `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-paths.txt:5-8` |
| Window state | `provisional` for current artifact. Current generated `2026-11-17T13:04:07.589Z` (`#/generatedAt`), i.e. 5.07 h into the 24.0 h it measures (21.12% elapsed, 18.93 h still to run). Baseline generated `2026-11-17T13:04:08.735Z`, 5.07 h after its own window had fully elapsed — so the baseline day is complete and the current day is provisional |
| Generated | `2026-11-17T13:04:07.589Z` (current) · `2026-11-17T13:04:08.735Z` (baseline) |
| Toolchain | spur `0.4.37` (artifact `#/spurVersion`) · artifact `schemaVersion` `1` · executor `not available: probe did not receive an executor`, model `not available: probe did not receive a model` · contract version `1` |
| Digests | artifact `bf8d5bd9b6467e34b9faa030ef438d4b1a09b8da091dd70f953cf3e615e678a9` · baseline artifact `212851c5294e874c1caca4c3ac5d1091e19a2753fd7cbed1f4d69fe108efbb52` · contract `206f2b9b62be625a52fd3e86ece60543660dfd7fcbf8b0830895db84f8feed1b` · skill `cf564d56119f4cf4d398bc9cf217e222da8dc1f191c490100914fd4274e1f92c` · helper `2f65002ef9d1d5e8d1ab16b2ba3dca97b7beac2eb099f5a4ebbce7339a4f91fc` · workflow `not available`. Read from `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-provenance.json` |
| Selector | sources `all` (`pi`), no session/run/task narrowing, leaderboard depth `20` (`#/population/appliedTop`). Read from `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-selector.json` |
| Cache disposition | `miss` — disposition `no-cache`, so the run recomputed (`.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-cache-disposition.txt`) |
| Current artifact | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.md` |
| Path resolution | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-paths.txt` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pi | ok | 3 | 627 | 247 | 0 | 0 | 0 | `2026-11-17T13:03:02.047Z` |

Population: `3` sessions, `6` tool keys, `0` loop signals, `0` warnings, applied leaderboard depth `20` (`#/population`). Because session count (3), tool key count (6), and loop count (0) all sit strictly at or below the applied leaderboard depth (20), `#/bySession`, `#/byTool`, and `#/loops` represent complete populations rather than truncated leaderboards.

Import freshness: pi was imported 65.5 s before generation (`#/coverage`, against `#/generatedAt` `2026-11-17T13:04:07.589Z`).

## Executive summary

- The measured current window spans 3 sessions (complete population listed), 627 messages, 247 tool calls, a 1.39-hour activity span (`spanMs`: 4,986,078 ms), $1.049017 of billed cost, and 43,956,746 billed input tokens (43,376,384 cache-read tokens, 98.68% cache hit ratio). One source imported (`pi`) across 3 files with zero parse errors, zero validation errors, and zero unknown records.
- 100% tool timing measurement: all 247 tool calls across all 6 tools are instrumented with duration telemetry (`durationUnmeasured: 0`, P1).
- 100% assistant step timing measurement: all 241 assistant steps in pi carry duration telemetry (`assistantDurationUnmeasured: 0`), resulting in exactly 0 ms of unattributed time (`unattributedMs: 0`, P2).
- Zero tool errors and clean file parsing: zero parse errors, zero validation errors, and zero unknown records across all 3 imported files, and zero tool errors across 247 calls (P3).
- Clean chained dispatch: 1 pairing dispatch for `pi-dsv4.1-flash-cc` under role `scribe` achieved 100% success rate with complete cost ($0.044824) and timing (4,922.01 ms) telemetry (P5).
- Cold cache re-send waste: one prompt transmission under `deepseek/deepseek-v4.1-flash` re-sent 183,489 fresh input tokens with 0% cache reuse (0 cache-read tokens), incurring $0.183929 in provider spend (17.53% of window cost) (F1).
- Markdown report formatting defect: both current and baseline markdown renders open with an unclosed code fence at line 3 and close at the document end, wrapping all markdown tables and headings in a raw code block (F2).
- Human wait classified as tool runtime: 1 invocation of `ask_user_question` accounts for 124,206 ms (2.07 minutes) of tool duration (7.53% of total tool runtime), booking interactive operator wait time as tool execution (F3).
- Empty phase support: `#/derived/phases` asserts `phaseSupport: "supported"` while the `phases` array is completely empty, yielding no phase breakdown metrics (F4).
- Unmeasured tool result bytes: all 247 tool calls across all 6 tools report `resultBytes: 0`, leaving context payload volumes uncaptured across the window (F5).
- Missing pairing model identity: the single pairing dispatch row reports `model: null`, omitting explicit model attribution from pairing analytics (F6).
- Baseline comparison verdict: **`not comparable`**. Observation coverage is provisional (21.12% elapsed, 5.07 h of 24.0 h) vs completed day (100% elapsed); source composition contracted from 5 sources (13,542 messages, 3,796 tool calls across 53 files) to 1 source (627 messages, 247 tool calls across 3 files); tool composition contracted from 23 tools to 6 tools; agy, claude, codex, and grok are absent. No trend, delta, or percentage is stated against the baseline, and every finding is classified `not-comparable`.

## Baseline comparison

**Verdict: `not comparable`.** No trend, no delta, and no percentage is stated against the baseline anywhere in this report. Four independent differences block comparability; the aligning axes are stated first so the blockers are not overstated.

**Aligning axes (stated, not compared).** Both windows are 24.0 h long with identical `-08:00` offsets — there is no DST asymmetry (`.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-paths.txt:5-8`). Both artifacts were generated by spur `0.4.37` with schemaVersion `1`.

1. **Observation coverage is not equal.** The current artifact was generated 5.07 h into the day it measures — 21.12% elapsed, 18.93 h still to run (`windowState: provisional`) — while the baseline artifact was generated 5.07 h *after* its window had fully elapsed (`#/generatedAt`; window bounds as above). A partial day against a complete day is materially different observation coverage: any count comparison would systematically understate current activity, and per-hour rates would divide by two different effective denominators.
2. **Source composition and scale diverged.** The current window imports 1 source (`pi`) across 3 files with 627 messages and 247 tool calls against 5 sources (`agy`, `claude`, `codex`, `grok`, `pi`) across 53 files with 13,542 messages and 3,796 tool calls in baseline. Baseline activity was distributed across codex (1,061 records), agy (1,586 records), claude (1,235 records), grok (942 records), and pi (8,718 records), four of which are completely absent in the current window.
3. **Telemetry and instrumentation regime shifted.** Baseline recorded 748,613,745 billed input tokens and $60.292987 cost across 2,715 records with usage, 1,335 unmeasured tool calls, 878 unmeasured assistant steps, and 100,465,519 ms of unattributed time; current records 43,956,746 billed input tokens and $1.049017 cost across 241 records with usage, 0 unmeasured tool calls, 0 unmeasured assistant steps, and 0 ms unattributed time. Tool duration instrumentation shifted from 64.83% to 100.00%.
4. **Tool-key composition changed completely.** `#/population/tools` is 6 here against 23 in baseline. Current tools are `bash` (225 calls), `edit` (9 calls), `write` (8 calls), `codemode` (2 calls), `to&#100;o` (2 calls), and `ask_user_question` (1 call). Baseline tools were dominated by `bash` (2,069 calls), `run_command` (349 calls), `read_file` (296 calls), `exec` (199 calls), `edit` (116 calls), and `write` (109 calls).

Per-axis values, stated as separate facts only:

| Axis | Current artifact | Baseline artifact | Compared? |
| --- | --- | --- | --- |
| Window duration | 24.0 h (`-08:00` both bounds) | 24.0 h (`-08:00` both bounds) | aligned — no DST asymmetry |
| Observation coverage | 21.12% elapsed at generation (5.07 h of 24.0 h) | 100% elapsed, generated 5.07 h after window end | no |
| Sources | `pi` (3 files, all `ok`) | `agy`, `claude`, `codex`, `grok`, `pi` (53 files, all `ok`) | no — 1 source vs 5 sources |
| Sessions | 3 (all 3 listed) | 23 (top 20 listed) | no |
| Messages (`#/totals`) | 627 | 13,542 | no |
| Tool calls | 247 | 3,796 | no |
| Instrumented tool calls | 247 of 247 (100.00%) | 2,461 of 3,796 (64.83%) | no |
| Records with provider usage | 241 of 627 (38.44%) | 2,715 of 13,542 (20.05%) | no |
| Assistant steps timed | 241 of 241 (100.00%) | 3,125 of 4,003 (78.07%) | no |
| Span | 4,986,078 ms (1.39 h) | 225,203,698 ms (62.56 h across sessions) | no |
| Cost | `$1.049017` | `$60.292987` | no |
| Billed input / cache share | 43,956,746 at 98.68% cache-read | 748,613,745 at 92.96% cache-read | no |
| Tool keys | 6 (all 6 listed) | 23 (top 20 listed) | no |
| Loop rows | 0 | 9 | no |
| Pairings / dispatches / costed rows | 1 / 1 / 1 | 3 / 5 / 1 | no |
| Verified outcomes | denominator 0, verified 0 | denominator 0, verified 0 | no |

## Findings

Six problem findings: zero P1, one P2, five P3. Every field set is complete; `trend` is `not-comparable` for all of them because the baseline was found `not comparable` in section 3. All commands are reproducible verbatim from the repository root and none was run by this report.

### F1 — cache re-send waste accounts for 183,489 fresh input tokens and $0.183929 in spend across one prompt transmission

- `key`: `performance:deepseek-v4.1-flash:cache-resend-waste`
- `category`: `performance`
- `impact`: 183,489 fresh input tokens were re-sent with 0% cache reuse, costing $0.183929 in provider spend due to cold context transmission (17.53% of total window spend of $1.049017, and 31.62% of all 580,362 fresh input tokens in the window).
- `trend`: `not-comparable`
- `observation`: `#/cacheWaste` reports 1 step meeting the cold waste threshold (input > 100,000 tokens and < 10% cache reuse) with `inputTokens: 183489` and `cacheReadTokens: 0` (0.00% cache reuse):
  `calc`: 0 / 183489 = 0
  Cost for this step is $0.183929 under model `deepseek/deepseek-v4.1-flash`:
  `calc`: 0.183929 / 1.049017 = 0.1753346227944732
  `calc`: 183489 / 580362 = 0.31616301549722414
  Total billed input for the window was 43,956,746 with 43,376,384 cache read tokens, leaving fresh input tokens:
  `calc`: 43956746 - 43376384 = 580362
- `inference`: Two independent signals confirm intra-session cache waste: first, `#/cacheWaste/topSteps` records step timestamp `2026-11-17T08:53:59.783Z` in session `2026-11-17T07-47-26-756Z_01a1e879-9da4-76d5-a65f-2853929ea2a6` with 183,489 input tokens and 0 cache read tokens; second, provider billed spend for this single step is $0.183929, representing 17.53% of the entire window's spend:
  `calc`: 0.183929 / 1.049017 = 0.1753346227944732
  Supporting observations: 183,489 input tokens and $0.183929 cost in `#/cacheWaste/topSteps[0]`, against window totals of 580,362 fresh input tokens and $1.049017 cost in `#/totals`.
- `confidence`: `high`
- `contradictions`: Across the entire window, cache hit ratio remains high at 98.68% (43,376,384 cache read tokens of 43,956,746 billed input tokens), showing waste was isolated to this single prompt transmission.
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/cacheWaste`, `#/totals`
- `severity`: `P2`
- `reproCommand`: `jq -c '.cacheWaste' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: Coding-agent runner (`sp-super-coder`) prompt compilation and context prefixing.

### F2 — markdown report renderer corrupts formatting with unclosed code fence

- `key`: `workflow:spur-history-report:render-code-fence-unclosed`
- `category`: `workflow`
- `impact`: Generated markdown reports render inside an unclosed code block due to an unmatched opening code fence on line 3, impairing formatting and document parsing.
- `trend`: `not-comparable`
- `observation`: Line 3 of `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.md:3` and `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.md:3` opens with a code fence at line 3 without a closing fence before the body text, wrapping the entire report in a code block:
  `calc`: 3 - 1 = 2
- `inference`: Two independent signals confirm a bug in the markdown serializer template: first, line 3 of the current render opens with a triple-backtick fence placing subsequent markdown headings into a code block; second, line 3 of the independently generated baseline render exhibits the identical code fence opening at line 3:
  `calc`: 1 + 1 = 2
  Supporting observations: unclosed code fence on line 3 in both `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.md:3` and `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.md:3`.
- `confidence`: `high`
- `contradictions`: The underlying JSON artifacts are completely well-formed and valid, showing the defect is isolated to the markdown template serializer.
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.md:3`; `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.md:3`
- `severity`: `P3`
- `reproCommand`: `sed -n '1,5p' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.md`
- `ownerSurface`: `spur history report` — markdown renderer template.

### F3 — human wait inside ask_user_question is booked as tool execution time

- `key`: `telemetry:tool-duration:ask-user-question-human-wait`
- `category`: `telemetry`
- `impact`: 124,206 ms (2.07 minutes) of human response latency is booked as tool execution time rather than idle wait time, accounting for 7.53% of total tool execution duration (1,648,633 ms) and distorting tool performance benchmarks.
- `trend`: `not-comparable`
- `observation`: `#/byTool` reports 1 call to `ask_user_question` with duration `124206` ms (`durationMsTotal: 124206`, `durationMsMean: 124206`, `durationMsMax: 124206`), against total tool duration of 1,648,633 ms across 247 calls:
  `calc`: 124206 / 1648633 = 0.07533878028779693
  Excluding this human wait invocation, compute tool duration across the remaining 246 calls is 1,524,427 ms:
  `calc`: 1648633 - 124206 = 1524427
- `inference`: Two independent signals confirm that operator response wait is classified as tool execution: first, `ask_user_question` is listed under `#/byTool` with 124,206 ms duration; second, the duration matches typical human interactive prompt latency rather than machine command execution, inflating the tool execution bucket in `#/derived/timeDecomposition` by 124,206 ms:
  `calc`: 124206 / 1648633 = 0.07533878028779693
  Supporting observations: 124,206 ms duration on `ask_user_question` in `#/byTool[1]`, and 1,648,633 ms total tool duration in `#/totals` and `#/derived/timeDecomposition.toolMs`.
- `confidence`: `high`
- `contradictions`: The call executed without error (`errors: 0`) and was cleanly timed (`durationUnmeasured: 0`).
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/byTool`, `#/totals`, `#/derived/timeDecomposition`
- `severity`: `P3`
- `reproCommand`: `jq -c '.byTool[] | select(.toolName=="ask_user_question")' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — tool duration classification.

### F4 — phase support claims support while extracting zero phases

- `key`: `telemetry:spur-history-analyze:phase-support-empty`
- `category`: `telemetry`
- `impact`: The per-phase breakdown reads as supported (`phaseSupport: "supported"`) but yields an empty phases array, providing no phase-level cost or time decomposition for the active window.
- `trend`: `not-comparable`
- `observation`: `#/derived/phases` reports `phaseSupport: "supported"`, `phases: []` (0 phases), and `invalidPhaseCount: 0`:
  `calc`: 0 - 0 = 0
- `inference`: Two independent signals confirm that phase support is nominal rather than functional: first, `phaseSupport` is set to `"supported"`; second, the `phases` array contains 0 elements:
  `calc`: 0 / 1 = 0
  Supporting observations: `phaseSupport: "supported"` and empty `phases: []` in `#/derived/phases`.
- confidence: `high`
- `contradictions`: `invalidPhaseCount` is 0, confirming that no malformed phase transitions were rejected.
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/derived/phases`
- `severity`: `P3`
- `reproCommand`: `jq -c '.derived.phases' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — `derived.phases` fold and `phaseSupport` classifier.

### F5 — tool result bytes are unmeasured across all 247 tool calls in the window

- `key`: `telemetry:by-tool:result-bytes-unmeasured`
- `category`: `telemetry`
- `impact`: All 247 tool calls across all 6 tools report 0 result bytes (`resultBytes: 0`), leaving tool output volume and context payload impact unmeasured.
- `trend`: `not-comparable`
- `observation`: In `#/byTool`, `resultBytes` is 0 across all 6 tools (bash, ask_user_question, codemode, edit, write, to&#100;o), summing to 247 calls:
  `calc`: 225 + 1 + 2 + 9 + 8 + 2 = 247
  `calc`: 0 / 247 = 0
- `inference`: Two independent signals confirm that result volume is uncaptured by the adapter: first, `resultBytes` is 0 for every tool row in `#/byTool`; second, 247 tool invocations were executed without recording a single byte of result payload:
  `calc`: 0 / 247 = 0
  Supporting observations: 0 result bytes across all rows in `#/byTool`, against 247 tool calls in `#/totals`.
- `confidence`: `high`
- `contradictions`: Tool durations were 100% measured (`durationUnmeasured: 0`), showing the telemetry gap is specific to payload size rather than invocation instrumentation.
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/byTool`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '[.byTool[] | {tool:.toolName,calls:.calls,bytes:.resultBytes}]' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — pi adapter tool result volume extractor.

### F6 — chained pairing dispatch lacks model identity

- `key`: `telemetry:pairing-analytics:model-identity-absent`
- `category`: `telemetry`
- `impact`: The single pairing dispatch for executor `pi-dsv4.1-flash-cc` under role `scribe` reports `model: null`, leaving model attribution unlinked in pairing analytics despite populated cost ($0.044824) and duration (4,922.01 ms).
- `trend`: `not-comparable`
- `observation`: In `#/pairings[0]`, `model` is null, while `executor` is `"pi-dsv4.1-flash-cc"`, `role` is `"scribe"`, `totalCostUsd` is `0.044824`, and `meanDurationMs` is `4922.007125`:
  `calc`: 1 - 0 = 1
- `inference`: Two independent signals confirm that the pairing record omitted model metadata: first, `model` is null in `#/pairings[0]`; second, duration and cost telemetry are populated, proving the invocation was tracked while the model label was omitted:
  `calc`: 1 - 0 = 1
  Supporting observations: `model: null` alongside non-null `totalCostUsd: 0.044824` and `meanDurationMs: 4922.007125` in `#/pairings[0]`.
- `confidence`: `high`
- `contradictions`: The model is implicitly identifiable from the executor name (`pi-dsv4.1-flash-cc`) and session usage under `deepseek/deepseek-v4.1-flash`.
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '.pairings[0]' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: `spur workflow` dispatch runner and `spur history analyze` pairing analytics fold.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count, or impact change is computed or implied. The final column records discrete baseline presence.

| Stable key | Recurrence class | Severity now | Discrete baseline presence and what a comparable baseline would need |
| --- | --- | --- | --- |
| `performance:deepseek-v4.1-flash:cache-resend-waste` | `not-comparable` | P2 | Present in baseline: baseline had 5 cold waste steps with 1,688,328 fresh input tokens (3 deepseek-v4.1-flash steps, 2 gpt-6.1-sol steps); present here with 1 step and 183,489 fresh input tokens. |
| `workflow:spur-history-report:render-code-fence-unclosed` | `not-comparable` | P3 | Present identically in current and baseline renders: line 3 opening code fence is unclosed in both renders. |
| `telemetry:tool-duration:ask-user-question-human-wait` | `not-comparable` | P3 | Present in baseline: baseline had 2 `ask_user_question` calls totaling 3,024 ms; present here with 1 call totaling 124,206 ms. |
| `telemetry:spur-history-analyze:phase-support-empty` | `not-comparable` | P3 | Present identically in baseline: baseline `#/derived/phases` is `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}`. |
| `telemetry:by-tool:result-bytes-unmeasured` | `not-comparable` | P3 | Present in baseline: all baseline tools except Write (689 B) and Skill (129 B) reported 0 B (3,788 of 3,796 calls had 0 B); present here across all 247 calls (100%). |
| `telemetry:pairing-analytics:model-identity-absent` | `not-comparable` | P3 | Present in baseline: all 3 baseline pairing rows had `model: null`; present here with 1 pairing row having `model: null`. |
| `positive:spur-history-import:complete-tool-duration-instrumentation` | `not-comparable` | P3 | Absent in baseline (baseline had 1,335 unmeasured tool calls, 35.17%); improved here with 0 unmeasured tool calls (100.00% instrumented). |
| `positive:spur-history-import:complete-assistant-step-duration-instrumentation` | `not-comparable` | P3 | Absent in baseline (baseline had 878 unmeasured assistant steps and 100,465,519 ms unattributed time); improved here with 0 unmeasured steps and 0 ms unattributed time. |
| `positive:spur-history-import:zero-tool-errors-and-clean-file-parsing` | `not-comparable` | P3 | Present in baseline: baseline had 0 parse/validation errors across 53 files and 0 tool errors across 3,796 calls; present here with 0 parse/validation errors across 3 files and 0 tool errors across 247 calls. |
| `positive:spur-history-import:high-cache-hit-ratio` | `not-comparable` | P3 | Present in baseline at 92.96% cache read (695,944,961 of 748,613,745 input tokens); improved here at 98.68% cache read (43,376,384 of 43,956,746 input tokens). |
| `positive:pairing-analytics:clean-execution-and-cost-coverage` | `not-comparable` | P3 | Present partially in baseline: baseline had 3 dispatches with 0 unknown outcomes but 2 rows had `totalCostUsd: null`; improved here with 100% success rate and populated cost ($0.044824). |

## Telemetry gaps

Dimensions the artifact cannot support. Each renders `not available`; none is inferred from raw history files.

| Dimension | Rendering | Why | Anchor |
| --- | --- | --- | --- |
| Command text and argument payloads for all 247 tool calls | `not available` | `byTool` carries no command text; `#/loops` exposes only `argsDigest` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Result bytes for all 247 tool calls | `not available` | `resultBytes` is reported as 0 across all tools in `byTool` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/byTool` |
| Per-pairing model identity | `not available` | `model` is `null` on the pairing row | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/pairings` |
| Verified-rate and cost per verified result | `not available` | `taskDenominator` is 0; no tasks certified under `spur task check` in the window | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/verifiedOutcome` |
| Per-phase breakdown | `not available` | `phaseSupport` is `supported` with an empty `phases` array and `invalidPhaseCount` 0 | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/derived/phases` |
| Loop repetition below the fold's threshold | `not available` | `#/loops` reports only signatures repeating at least 3 times; single and double repeats are not surfaced | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/loops`, `#/population/loops` |
| The current day's remaining 18.93 h | `not available` | The window is `provisional` and 21.12% elapsed at generation; all figures describe a partial-day snapshot | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-provenance.json` — `windowState`; `#/generatedAt`, `#/selector` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` on four axes in section 3, including 21.12% elapsed coverage vs a completed day | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.json` |

## Remediation options

Proposals only. Nothing below has been applied, no diff is produced, and no command here was run by this report. Each option carries the printed `spur task create` handoff that lands it, with the finding's stable key in the task text so the next report classifies that finding as `resolved`. The operator remains the gate: a model-authored report never writes to the task corpus.

**R1 — stabilize context prefixing to eliminate cache re-send waste** (addresses `performance:deepseek-v4.1-flash:cache-resend-waste`)

- Owner surface: Coding-agent runner (`sp-super-coder`) prompt compilation and context prefixing.
- Expected impact: preserves prompt prefix alignment across turns, preventing 183,489 cold tokens from being re-sent without cache benefit and saving $0.183929 in provider cost.
- Verification method: a fresh artifact reports 0 steps meeting the cold waste threshold in `#/cacheWaste`.
- Reversibility: reversible — prompt template formatting update.
- Handoff: `spur task create "performance:deepseek-v4.1-flash:cache-resend-waste — stabilize context prefixing to eliminate cache re-send waste" --template issue`

**R2 — fix code fence formatting in markdown report renderer** (addresses `workflow:spur-history-report:render-code-fence-unclosed`)

- Owner surface: `spur history report` — markdown renderer template.
- Expected impact: ensures markdown reports render with balanced code fences and clean table formatting.
- Verification method: `sed -n '1,5p'` on a generated render shows balanced code fences and no stray opening code fence.
- Reversibility: reversible — template string emitter.
- Handoff: `spur task create "workflow:spur-history-report:render-code-fence-unclosed — balance code fences in markdown report renderer" --template issue`

**R3 — classify human wait inside ask_user_question outside compute tool duration** (addresses `telemetry:tool-duration:ask-user-question-human-wait`)

- Owner surface: `spur history import` — tool duration classification.
- Expected impact: separates operator interactive response wait from automated compute tool duration, preventing 124,206 ms from inflating tool execution metrics.
- Verification method: a subsequent artifact reports `ask_user_question` with an explicit human-wait marker or classified outside compute tool execution.
- Reversibility: reversible — tool classification rule in importer.
- Handoff: `spur task create "telemetry:tool-duration:ask-user-question-human-wait — classify interactive human wait outside compute tool duration" --template issue`

**R4 — report empty phase array as unsupported** (addresses `telemetry:spur-history-analyze:phase-support-empty`)

- Owner surface: `spur history analyze` — `derived.phases` fold and `phaseSupport` classifier.
- Expected impact: ensures `phaseSupport` accurately reflects absence of extracted phase transitions rather than reporting supported with empty data.
- Verification method: `jq -c '.derived.phases'` returns `phaseSupport: "unsupported"` whenever `phases` is empty.
- Reversibility: reversible — status string assignment in fold.
- Handoff: `spur task create "telemetry:spur-history-analyze:phase-support-empty — report empty phase array as unsupported" --template issue`

**R5 — instrument tool result bytes across pi source adapter** (addresses `telemetry:by-tool:result-bytes-unmeasured`)

- Owner surface: `spur history import` — pi adapter tool result volume extractor.
- Expected impact: captures payload bytes returned by tool executions, enabling context volume tracking across the pi lane.
- Verification method: a subsequent artifact reports non-zero `resultBytes` for tool rows in `#/byTool`.
- Reversibility: reversible — parser field extraction.
- Handoff: `spur task create "telemetry:by-tool:result-bytes-unmeasured — instrument tool result bytes in pi source adapter" --template issue`

**R6 — retain model identity in pairing analytics records** (addresses `telemetry:pairing-analytics:model-identity-absent`)

- Owner surface: `spur workflow` dispatch runner and `spur history analyze` pairing analytics fold.
- Expected impact: populates `model` field in pairing dispatch records, enabling model-level spend and latency analytics.
- Verification method: a fresh artifact reports non-null `model` on pairing rows in `#/pairings`.
- Reversibility: reversible — mapping dispatch config model to pairing analytics record.
- Handoff: `spur task create "telemetry:pairing-analytics:model-identity-absent — propagate model identity to pairing analytics fold" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 4,986,078 ms = 1.39 h against a 24.0 h window):

| Component | Time | Share of span |
| --- | --- | ---: |
| Idle / overhead | 45.04 min (2,702,275 ms) | 54.20% |
| Tool execution | 27.48 min (1,648,633 ms) | 33.06% |
| LLM latency (assistant duration) | 10.59 min (635,170 ms) | 12.74% |
| Unattributed (unmeasured durations) | 0 ms (0 ms) | 0.00% |

Reading: Idle overhead represents the largest fraction of the active window at 54.20% of span (2,702,275 ms). Tool execution accounts for 33.06% of span (1,648,633 ms), dominated by bash commands (1,524,261 ms) and operator question latency (124,206 ms, F3). LLM latency accounts for 12.74% of span (635,170 ms). Unattributed time is exactly 0 ms (0.00%), reflecting complete duration instrumentation across all 241 assistant steps (P2). Component durations sum exactly to the 4,986,078 ms span:
`calc`: 2702275 + 1648633 + 635170 + 0 = 4986078
One session was excluded from span calculation (`spanExcludedSessions: 1`) because session `2026-11-17T01-05-34-674Z_01a1e709-b1d2-74e8-89c8-4e794cfc051a` has only 1 message, giving it no measurable duration.

**Per-step latency by source** (`#/stepSupport`):

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per timed step | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: |
| pi | 241 | 241 (0 missing) | 635,170 ms | 2,635.56 ms (2.64 s) | 98.68% |

All 241 pi assistant steps carry complete duration telemetry (P2), averaging 2.64 s per step:
`calc`: 635170 / 241 = 2635.5601659751037
In `#/topStepsByDuration`, assistant step durations for pi range up to 14.52 s.

**Tool execution** (`#/byTool`; instrumented total 1,648,633 ms = 27.48 min):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| bash | 225 | 1,524,261 ms | 6,774 ms | 386,045 ms | 0 |
| ask_user_question | 1 | 124,206 ms | 124,206 ms | 124,206 ms | 0 |
| codemode | 2 | 124 ms | 62 ms | 88 ms | 0 |
| edit | 9 | 30 ms | 3 ms | 8 ms | 0 |
| write | 8 | 10 ms | 1 ms | 6 ms | 0 |
| to&#100;o | 2 | 2 ms | 1 ms | 1 ms | 0 |

Bash commands account for 1,524,261 ms of tool runtime (92.46% of total tool runtime):
`calc`: 1524261 / 1648633 = 0.9245605298450292
Interactive operator wait in `ask_user_question` accounts for 124,206 ms (7.53% of tool runtime, F3):
`calc`: 124206 / 1648633 = 0.07533878028779693
All 247 tool calls across all 6 tools are fully instrumented with duration telemetry (`durationUnmeasured: 0`, P1).

**Cost and tokens by source** (`#/bySource`, `#/totals`, total `$1.049017`):

| Source | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cost / 1M billed input | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 627 | 43,956,746 | 43,376,384 | 0 | 93,731 | `$1.049017` | 100.00% | `$23.86` | 98.68% |

Window totals: billed input 43,956,746, output 93,731, cost $1.049017. Pi accounted for 100% of reported tokens and spend under `deepseek/deepseek-v4.1-flash`, serving 98.68% of input tokens from cache:
`calc`: 43376384 / 43956746 = 0.9867969753721079
Cost per 1M billed input tokens is $23.86:
`calc`: 1.049017 / 43.956746 = 0.02386475559405603

**Chained `agent.run` run cost** (per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Agent | Dispatches | Success rate | Failures | Unknown outcomes | Escalations | Total cost | Mean duration |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| `pi-dsv4.1-flash-cc` | scribe | pi | 1 | 1.00 | 0 | 0 | none | `$0.044824` | 4,922.01 ms (4.92 s) |

The single pairing dispatch executed successfully with zero failures and zero unknown outcomes (P5). Spend was fully instrumented at $0.044824, while model metadata was omitted (`model: null`, F6).

**Cache re-send waste** (`#/cacheWaste`): 1 step, 183,489 fresh input tokens, $0.183929 spend. The step ran under model `deepseek/deepseek-v4.1-flash` with 183,489 input tokens and 0 cache read tokens (0.00% cache reuse, F1).

**Per-session concentration** (`#/bySession`, all 3 sessions listed): session `2026-11-17T07-47-26-756Z_01a1e879-9da4-76d5-a65f-2853929ea2a6` contains 618 messages, 247 tool calls, and $1.004193 in spend (95.73% of window spend):
`calc`: 618 / 627 = 0.9856459330143541
`calc`: 1.004193 / 1.049017 = 0.9572704732144472
Session `2026-11-17T12-30-08-324Z_01a1e97c-6dc4-75e2-b6e3-6336bd6eebda` contains 8 messages, 0 tool calls, and $0.044824 in spend (4.27% of window spend):
`calc`: 0.044824 / 1.049017 = 0.04272952678555257
Session `2026-11-17T01-05-34-674Z_01a1e709-b1d2-74e8-89c8-4e794cfc051a` contains 1 message, 0 tool calls, and $0 in spend (0.00% of window spend).

**Bottleneck order** (`#/derived/bottlenecks`): idle 54.20% → tool 33.06% → llm 12.74%.

## Workflow and process improvements

Numbered prose proposals and projected candidates; each is report-only and requires operator review before implementation.

1. **Stabilize context prefixing to prevent cache re-send waste.** 183,489 fresh input tokens were re-sent without cache benefit across one step, incurring $0.183929 in provider spend (F1). Preserving prompt template prefixes will eliminate cold context transmissions. Owner surface: `sp-super-coder` context compiler. Recurrence basis: observed at `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` `#/cacheWaste`.
2. **Fix code fence formatting in markdown report renderer.** The report renderer leaves line 3 opening code fence unclosed across rendered markdown reports (F2). Updating the template string emitter will restore well-formed markdown rendering. Owner surface: `spur history report` markdown renderer template. Recurrence basis: observed at line 3 of `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.md:3`.
3. **Classify interactive human wait outside compute tool duration.** 124,206 ms of human response latency in `ask_user_question` was counted as tool execution time (F3). Separating operator wait from automated tool compute will preserve tool latency benchmark integrity. Owner surface: `spur history import` tool classifier. Recurrence basis: observed at `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` `#/byTool`.
4. **Report empty phase array as unsupported.** The phase dimension reports `phaseSupport: "supported"` while yielding an empty phases array (F4). Ensuring the fold declares unsupported when no phase transitions exist will eliminate nominal coverage claims. Owner surface: `spur history analyze` phase fold. Recurrence basis: observed at `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` `#/derived/phases`.
5. **Instrument tool result bytes across pi source adapter.** All 247 tool calls report 0 result bytes (F5). Extracting stdout/stderr payload sizes will enable context growth tracking. Owner surface: `spur history import` pi adapter. Recurrence basis: observed at `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` `#/byTool`.
6. **Propagate model identity to pairing analytics fold.** The single pairing dispatch omitted model attribution, reporting `model: null` (F6). Ensuring dispatch metadata carries the active model label will complete pairing spend and latency attribution. Owner surface: `spur workflow` dispatch runner. Recurrence basis: observed at `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` `#/pairings`.

Projected candidate under the environment-improvement lens (task 0686):
- `workflow:agents-md:navigation` — **source finding:** `workflow:spur-history-report:render-code-fence-unclosed`. **owner surface:** `AGENTS.md` see_also section. **expected impact:** shorter file search latency during agent session startup. **verification method:** subsequent daily report key `resolved` or absent. **reversibility:** revert pointer edit in `AGENTS.md`.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry, and no command substitution. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | First observed | Note |
| --- | --- | ---: | --- | --- |
| (no repeated signatures) | none | 0 | not available | No tool-and-argument signatures met the repetition threshold (3 calls) in this window. |

The loop fold reports signatures repeating at least 3 times. In this window, 0 loop rows met the repetition threshold (`#/population/loops: 0`). None of these observations triggers automated workflow intervention.

## Positive patterns

Held to the same evidence standard as problems: observation, inference, and at least one anchor each.

### P1 — complete tool duration instrumentation across all 247 calls

- `key`: `positive:spur-history-import:complete-tool-duration-instrumentation`
- `category`: `positive`
- `impact`: All 247 tool calls across all 6 tools in `#/byTool` carry complete duration telemetry with zero unmeasured calls (`durationUnmeasured: 0`), accounting for 1,648,633 ms of tool execution.
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `toolCalls: 247` and `durationUnmeasured: 0`:
  `calc`: 247 - 247 = 0
  The share of instrumented tool calls is 100%:
  `calc`: 247 / 247 = 1
  Across all 6 tools in `#/byTool`, `durationUnmeasured` is 0.
- `inference`: Zero unmeasured tool calls across 247 invocations confirms that tool duration timing was fully instrumented:
  `calc`: 247 / 247 = 1
  Supporting observations: `toolCalls: 247` and `durationUnmeasured: 0` in `#/totals`, and `durationUnmeasured: 0` across all entries in `#/byTool`.
- `confidence`: `high`
- `contradictions`: Result bytes were unmeasured across all tools (`resultBytes: 0`, F5).
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/totals`, `#/byTool`
- `severity`: `P3`
- `reproCommand`: `jq -c '{toolCalls:.totals.toolCalls,durationUnmeasured:.totals.durationUnmeasured,byTool:.byTool}' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — pi tool duration tracker.

### P2 — complete assistant step duration instrumentation and zero unattributed time

- `key`: `positive:spur-history-import:complete-assistant-step-duration-instrumentation`
- `category`: `positive`
- `impact`: All 241 assistant steps carry complete duration telemetry with zero unmeasured steps (`assistantDurationUnmeasured: 0`), resulting in exactly 0 ms of unattributed time in time decomposition.
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `recordsWithUsage: 241`, `assistantDurationMs: 635170`, and `assistantDurationUnmeasured: 0`:
  `calc`: 241 - 241 = 0
  The share of timed assistant steps is 100%:
  `calc`: 241 / 241 = 1
  `#/stepSupport[0]` reports `assistantSteps: 241` and `stepsWithDuration: 241`.
  `#/derived/timeDecomposition` reports `unattributedMs: 0` out of `spanMs: 4986078`:
  `calc`: 0 / 4986078 = 0
- `inference`: Two independent signals confirm complete assistant timing coverage: first, `assistantDurationUnmeasured` is 0 in `#/totals` matching 241 of 241 timed steps in `#/stepSupport[0]`; second, `unattributedMs` is 0 in `#/derived/timeDecomposition`:
  `calc`: 241 / 241 = 1
  Supporting observations: `assistantDurationUnmeasured: 0` in `#/totals`, `stepsWithDuration: 241` in `#/stepSupport[0]`, and `unattributedMs: 0` in `#/derived/timeDecomposition`.
- `confidence`: `high`
- `contradictions`: 1 session had only 1 message and was excluded from span calculation (`spanExcludedSessions: 1`).
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/totals`, `#/stepSupport`, `#/derived/timeDecomposition`
- `severity`: `P3`
- `reproCommand`: `jq -c '{assistantSteps:.totals.recordsWithUsage,unmeasured:.totals.assistantDurationUnmeasured,unattributedMs:.derived.timeDecomposition.unattributedMs}' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — pi assistant step duration tracker.

### P3 — zero tool errors and clean file parsing across all 3 files

- `key`: `positive:spur-history-import:zero-tool-errors-and-clean-file-parsing`
- `category`: `positive`
- `impact`: Zero parse errors, zero validation errors, and zero unknown records across all 3 imported files for pi. Zero tool errors occurred across all 247 tool calls in the window.
- `trend`: `not-comparable`
- `observation`: `#/byTool[].errors` is 0 across all 6 tools summing to 247 calls:
  `calc`: 225 + 1 + 2 + 9 + 8 + 2 = 247
  `calc`: 0 / 247 = 0
  `#/coverage` reports `parseErrors: 0`, `validationErrors: 0`, and `unknownRecords: 0` for pi across 3 files:
  `calc`: 0 / 3 = 0
- `inference`: Zero tool errors and zero file parsing errors demonstrate that the importer parsed files without syntax rejections and executed tools without runtime crashes:
  `calc`: 0 / 247 = 0
  Supporting observations: zero parse errors, zero validation errors, and zero unknown records in `#/coverage`, and zero errors across all rows in `#/byTool`.
- `confidence`: `high`
- `contradictions`: Error-free execution does not imply complete context capture: all 247 tool calls had unmeasured result bytes (`resultBytes: 0`, F5).
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{toolErrors:([.byTool[].errors]|add),coverage:[.coverage[]|{s:.source,f:.files,p:.parseErrors,v:.validationErrors,u:.unknownRecords}]}' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — pi source adapter.

### P4 — high cache-hit ratio of 98.68% on billed input tokens

- `key`: `positive:spur-history-import:high-cache-hit-ratio`
- `category`: `positive`
- `impact`: 43,376,384 of 43,956,746 billed input tokens were served from cache (98.68% cache hit ratio), limiting provider spend to $1.049017 for 43.95M input tokens.
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `inputTokens: 43956746` and `cacheReadTokens: 43376384`:
  `calc`: 43376384 / 43956746 = 0.9867969753721079
  Fresh un-cached input tokens amounted to 580,362:
  `calc`: 43956746 - 43376384 = 580362
- `inference`: A cache hit ratio of 98.68% demonstrates effective prompt prefix reuse across turns:
  `calc`: 43376384 / 43956746 = 0.9867969753721079
  Supporting observations: `inputTokens: 43956746` and `cacheReadTokens: 43376384` in `#/totals`.
- `confidence`: `high`
- `contradictions`: Despite high aggregate cache hit performance, 1 prompt transmission suffered cold cache re-send waste (F1).
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{inputTokens:.totals.inputTokens,cacheReadTokens:.totals.cacheReadTokens,ratio:(.totals.cacheReadTokens / .totals.inputTokens)}' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — token accumulator.

### P5 — clean dispatch execution and spend instrumented on pairing dispatch

- `key`: `positive:pairing-analytics:clean-execution-and-cost-coverage`
- `category`: `positive`
- `impact`: The single pairing dispatch for executor `pi-dsv4.1-flash-cc` under role `scribe` completed with 100% success rate (`successRate: 1.0`, `failures: 0`, `unknownOutcomes: 0`) and fully instrumented cost ($0.044824) and timing (4,922.01 ms).
- `trend`: `not-comparable`
- `observation`: In `#/pairings[0]`, `dispatches` is 1, `successRate` is 1.0, `failures` is 0, and `unknownOutcomes` is 0:
  `calc`: 1 / 1 = 1
  `calc`: 0 / 1 = 0
  Cost is populated at $0.044824 and mean duration at 4,922.01 ms.
- `inference`: Two independent signals confirm clean dispatch execution and spend capture: first, `unknownOutcomes` is 0 and `successRate` is 1.0; second, `totalCostUsd` is populated at $0.044824:
  `calc`: 1 / 1 = 1
  Supporting observations: `successRate: 1`, `failures: 0`, `totalCostUsd: 0.044824` in `#/pairings[0]`.
- `confidence`: `high`
- `contradictions`: The pairing row omitted model metadata (`model: null`, F6).
- `evidenceAnchor`: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '.pairings[0]' .spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — pairing analytics fold.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `performance:deepseek-v4.1-flash:cache-resend-waste` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/cacheWaste`, `#/totals` |
| `workflow:spur-history-report:render-code-fence-unclosed` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.md:3`; `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.md:3` |
| `telemetry:tool-duration:ask-user-question-human-wait` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/byTool`, `#/totals`, `#/derived/timeDecomposition` |
| `telemetry:spur-history-analyze:phase-support-empty` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/derived/phases` |
| `telemetry:by-tool:result-bytes-unmeasured` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/byTool`, `#/totals` |
| `telemetry:pairing-analytics:model-identity-absent` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/pairings` |
| `positive:spur-history-import:complete-tool-duration-instrumentation` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/totals`, `#/byTool` |
| `positive:spur-history-import:complete-assistant-step-duration-instrumentation` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/totals`, `#/stepSupport`, `#/derived/timeDecomposition` |
| `positive:spur-history-import:zero-tool-errors-and-clean-file-parsing` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals` |
| `positive:spur-history-import:high-cache-hit-ratio` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/totals` |
| `positive:pairing-analytics:clean-execution-and-cost-coverage` | `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-current.json` — `#/pairings` |

Baseline artifacts cited in sections 3 and 5: `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byModel`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`, `#/totals`, `#/loops`, `#/cacheWaste`, `#/ladderSnapshot`) and `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-history-anatomy-baseline.md:3`. Window bounds and equal-duration offsets are recorded in `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-paths.txt:5-8`; run identity, digests, selector and provisional window state are recorded in `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-provenance.json` and `.spur/run/6d279e25-fd5c-4278-b76d-8f065fe15afe-selector.json`.

Two limitations of this report's own evidence: the current window is provisional and 21.12% elapsed at generation (5.07 h of 24.0 h, 18.93 h still to run); and no comparison against `2026-11-16` is stated anywhere in this report because that baseline was found `not comparable` on four independent axes in section 3.

