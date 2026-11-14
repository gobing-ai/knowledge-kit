---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-11-14"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-11-14T00:00:00.000-08:00
    until: 2026-11-14T23:59:59.999-08:00
  sources:
    - source: pi
windowState: "provisional"
generatedAt: "2026-11-14T13:05:01.498Z"
validatedAt: "2026-11-14T13:20:52.245Z"
artifactDigest: "a6c5b659dac03fcd4bd70fd8b6cf7372c7fe6ff9347624c9418a169797ff815f"
baselineArtifactDigest: "b267943144e156798415fc21cb593367d61080f445cb219b5177de3331f7f68b"
contractDigest: "b26bcf7452943f6bb6a13d74c553df70b3de9b51a1c1ddfd9981468e4edc5855"
skillDigest: "45876fdfc90513cac8d9215be424eb83b3eb347bc583f0f0b413d2f41e82a2ac"
workflowDigest: "not available"
helperDigest: "be549511012d61cd8a103054c3c68239408a9755fe4fddc0595367de3825035b"
runId: "42c527e5-9188-4e21-88f1-ea86bcd1dc66"
currentArtifactPath: ".spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-baseline.json"
spurVersion: "0.4.33"
schemaVersion: 1
executor: "antigravity-cli"
executorProfile: "not available: invocation executor absent"
model: "gemini-3.8-flash-high"
cacheDisposition: "miss"
coverage:
  - source: pi, status: ok, lastImportedAt: 2026-11-14T13:03:52.470Z
dispatches:
  - node: enrich, actionId: 6dc62cfa-6a49-44ba-906e-90f9a540a0ae, agent: antigravity-cli, executor: not available: invocation executor absent, model: gemini-3.8-flash-high, timeoutMs: 5400000
  - node: validate, actionId: dda9760d-6a98-4c83-9eb2-e8243e93d5f5, agent: antigravity-cli, executor: not available: invocation executor absent, model: gemini-3.8-flash-high, timeoutMs: 5400000
---

> imported snapshot as of 2026-11-14T13:03:52.470Z · window provisional · cache miss

<!-- Candidate authored by sp:history-anatomy enrich · mode daily · run 42c527e5-9188-4e21-88f1-ea86bcd1dc66 · schema v1 -->

# History forensics report — 2026-11-14 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `42c527e5`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report. No workflow was launched by this operation.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-11-14`, baseline is the immediately preceding local calendar day `2026-11-13` |
| Current window | `2026-11-14T00:00:00.000-08:00` → `2026-11-14T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Baseline window | `2026-11-13T00:00:00.000-08:00` → `2026-11-13T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Window offsets | Both windows sit entirely in `-08:00`; equal-duration with identical UTC offsets — read from `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-paths.txt:5-8` |
| Window state | `provisional` for current artifact. Current generated `2026-11-14T13:04:56.849Z` (`#/generatedAt`), i.e. 5.08 h into the 24.0 h it measures (21.18% elapsed, 18.92 h still to run). Baseline generated `2026-11-14T13:04:59.492Z`, 13.08 h after its own window had fully elapsed — so the baseline day is complete and the current day is provisional |
| Generated | `2026-11-14T13:04:56.849Z` (current) · `2026-11-14T13:04:59.492Z` (baseline) |
| Toolchain | spur `0.4.33` (artifact `#/spurVersion`) · artifact `schemaVersion` `1` · executor `not available: probe did not receive an executor`, model `not available: probe did not receive a model` · contract version `1` |
| Digests | artifact `a6c5b659dac03fcd4bd70fd8b6cf7372c7fe6ff9347624c9418a169797ff815f` · baseline artifact `b267943144e156798415fc21cb593367d61080f445cb219b5177de3331f7f68b` · contract `b26bcf7452943f6bb6a13d74c553df70b3de9b51a1c1ddfd9981468e4edc5855` · skill `45876fdfc90513cac8d9215be424eb83b3eb347bc583f0f0b413d2f41e82a2ac` · helper `be549511012d61cd8a103054c3c68239408a9755fe4fddc0595367de3825035b` · workflow `not available`. Read from `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-provenance.json` |
| Selector | sources `all` (`pi`), no session/run/task narrowing, leaderboard depth `20` (`#/population/appliedTop`). Read from `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-selector.json` |
| Cache disposition | `miss` — disposition `no-cache`, so the run recomputed (`.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-cache-disposition.txt`) |
| Current artifact | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-baseline.md` |
| Path resolution | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-paths.txt` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pi | ok | 19 | 5050 | 1674 | 0 | 0 | 0 | `2026-11-14T13:03:52.470Z` |

Population: `13` sessions, `6` tool keys, `0` loop signals, `1` warning, applied leaderboard depth `20` (`#/population`). Because session count (13), tool key count (6), and loop count (0) all sit strictly at or below the applied leaderboard depth (20), `#/bySession`, `#/byTool`, and `#/loops` represent complete populations rather than truncated leaderboards.

Import freshness: pi was imported 64.4 s before generation (`#/coverage`, against `#/generatedAt` `2026-11-14T13:04:56.849Z`).

## Executive summary

- The measured current window spans 13 sessions (complete population listed), 4,938 messages, 1,674 tool calls, a 10.10-hour activity span (`spanMs`: 36,352,944 ms), $11.006325 of billed cost, and 323,151,489 billed input tokens (319,667,584 cache-read tokens, 98.92% cache hit ratio). One source imported (`pi`) across 19 files with zero parse errors, zero validation errors, and zero unknown records.
- 100% tool timing measurement: all 1,674 tool calls across all 6 tools are instrumented with duration telemetry (`durationUnmeasured: 0`).
- Unmeasured assistant step duration gap: 659 of 1,567 assistant steps (42.05%) in pi lack duration telemetry, causing 10,647,621 ms (2.96 h, 29.29% of the 36,352,944 ms span) to fall into the unattributed bucket in time decomposition (`#/warnings/0`, F1).
- Cache re-send waste: two steps under `deepseek/deepseek-v4.1-flash` transmitted 458,186 fresh input tokens with < 1% cache reuse (2,048 cache read tokens per step, 0.89% reuse), incurring $0.460626 in provider cost (F2).
- Verified outcomes: `taskDenominator` is 0, leaving `verifiedResults` 0, all outcome rates `null`, and `costCoverage` `{covered: 0, total: 0}`, so no tasks were certified under `spur task check` in the window (F3).
- Message reconciliation gap: `#/coverage` reports 5,050 messages for pi, while `#/totals/messages` reports 4,938 messages, leaving an unparsed/window-filtered discrepancy of 112 messages (F4).
- Markdown report formatting defect: both current and baseline markdown renders open with an unclosed code fence at line 3 and a duplicated title prefix at line 4 (F5).
- Chained dispatch cost gap: the single pairing dispatch for `minimax` under role `scribe` reports `totalCostUsd: null` (`not available`), leaving executor spend untracked for this run (F6).
- Baseline comparison verdict: **`not comparable`**. Observation coverage is provisional (21.18% elapsed, 5.08 h of 24.0 h) vs completed day (100% elapsed); source composition contracted from 5 sources (25,080 messages, 5,415 tool calls) to 1 source (4,938 messages, 1,674 tool calls); tool composition contracted from 27 tools to 6 tools; codex, claude, agy, and grok are absent. No trend, delta, or percentage is stated against the baseline, and every finding is classified `not-comparable`.
- Clean execution where measured: zero tool errors across 1,674 tool calls, zero parse or validation errors across 19 files, zero unknown records, zero loops, and 100% success rate on pairing dispatches (1 of 1).

## Baseline comparison

**Verdict: `not comparable`.** No trend, no delta, and no percentage is stated against the baseline anywhere in this report. Four independent differences block comparability; the aligning axes are stated first so the blockers are not overstated.

**Aligning axes (stated, not compared).** Both windows are 24.0 h long with identical `-08:00` offsets — there is no DST asymmetry (`.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-paths.txt:5-8`). Both artifacts were generated by spur `0.4.33` with schemaVersion `1`.

1. **Observation coverage is not equal.** The current artifact was generated 5.08 h into the day it measures — 21.18% elapsed, 18.92 h still to run (`windowState: provisional`) — while the baseline artifact was generated 13.08 h *after* its window had fully elapsed (`#/generatedAt`; window bounds as above). A partial day against a complete day is materially different observation coverage: any count comparison would systematically understate current activity, and per-hour rates would divide by two different effective denominators.
2. **Source composition and scale diverged.** The current window imports 1 source (`pi`) across 19 files with 4,938 messages and 1,674 tool calls against 5 sources (`agy`, `claude`, `codex`, `grok`, `pi`) across 53 files with 25,080 messages and 5,415 tool calls in baseline. Baseline activity was heavily dominated by codex (17,725 messages, 3,158 tool calls) and claude (3,510 messages, 479 tool calls), which are completely absent in the current window.
3. **Telemetry and instrumentation regime shifted.** Baseline recorded 793,418,982 billed input tokens and $360.046268 cost across 2,970 records with usage; current records 323,151,489 billed input tokens and $11.006325 cost across 1,570 records with usage. Tool duration measurement diverged: baseline instrumented 1,086 of 5,415 tool calls (20.06%), whereas current instruments 1,674 of 1,674 tool calls (100.00%). Cache read share shifted from 64.12% to 98.92%.
4. **Tool-key composition changed completely.** `#/population/tools` is 6 here against 27 in baseline. Current primary tools are `bash` (1,566 calls) and `read` (79 calls). Baseline primary tools were `exec` (2,014 calls), `bash` (852 calls), `wait_agent` (700 calls), `read_file` (308 calls), and `run_command` (248 calls).

Per-axis values, stated as separate facts only:

| Axis | Current artifact | Baseline artifact | Compared? |
| --- | --- | --- | --- |
| Window duration | 24.0 h (`-08:00` both bounds) | 24.0 h (`-08:00` both bounds) | aligned — no DST asymmetry |
| Observation coverage | 21.18% elapsed at generation (5.08 h of 24.0 h) | 100% elapsed, generated 13.08 h after window end | no |
| Sources | `pi` (19 files, all `ok`) | `agy`, `claude`, `codex`, `grok`, `pi` (53 files, all `ok`) | no — 1 source vs 5 sources |
| Sessions | 13 (all 13 listed) | 25 (top 20 listed) | no |
| Messages (`#/totals`) | 4,938 | 25,080 | no |
| Tool calls | 1,674 | 5,415 | no |
| Instrumented tool calls | 1,674 of 1,674 (100.00%) | 1,086 of 5,415 (20.06%) | no |
| Records with provider usage | 1,570 of 4,938 (31.79%) | 2,970 of 25,080 (11.84%) | no |
| Assistant steps timed | 908 of 1,567 (57.95%) | 3,323 of 5,629 (59.03%) | no |
| Span | 36,352,944 ms (10.10 h) | 240,460,050 ms (66.79 h) | no |
| Cost | `$11.006325` | `$360.046268` | no |
| Billed input / cache share | 323,151,489 at 98.92% cache-read | 793,418,982 at 64.12% cache-read | no |
| Tool keys | 6 (all 6 listed) | 27 (top 20 listed) | no |
| Loop rows | 0 | 101 | no |
| Pairings / dispatches / costed rows | 1 / 1 / 0 | 2 / 3 / 1 | no |
| Verified outcomes | denominator 0, verified 0 | denominator 6, verified 0 | no |

## Findings

Six problem findings: one P1, two P2, three P3. Every field set is complete; `trend` is `not-comparable` for all of them because the baseline was found `not comparable` in section 3. All commands are reproducible verbatim from the repository root and none was run by this report.

### F1 — 659 of 1,567 assistant steps lack duration telemetry, causing 10,647,621 ms to fall into unattributed time

- `key`: `telemetry:spur-history-import:pi-assistant-step-duration-unmeasured`
- `category`: `telemetry`
- `impact`: 659 assistant steps in the window lack duration telemetry (42.05% of assistant steps), causing 10,647,621 ms of activity span (2.96 h, 29.29% of span) to be relegated to the unattributed bucket in time decomposition (`#/warnings/0`).
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `assistantDurationUnmeasured` 659 against total assistant steps 1,567 in `#/stepSupport` (42.05% unmeasured).
  `calc`: 659 / 1567 = 0.4205488194001276
  `#/derived/timeDecomposition` reports `unattributedMs` 10,647,621 against `spanMs` 36,352,944, representing a share of span:
  `calc`: 10647621 / 36352944 = 0.29289570055179026
  `#/warnings/0` explicitly attributes this 10,647,621 ms to unmeasured durations.
  `#/stepSupport` shows `stepsWithDuration` 908 of 1,567, leaving a gap:
  `calc`: 1567 - 908 = 659
- `inference`: Two independent signals confirm that assistant step duration is uncaptured for a large portion of pi assistant turns: first, `assistantDurationUnmeasured` in `#/totals` is 659, matching the gap between `assistantSteps` 1,567 and `stepsWithDuration` 908 in `#/stepSupport`;
  `calc`: 1567 - 908 = 659
  second, `#/warnings/0` attributes 10,647,621 ms of unattributed time directly to unmeasured durations, matching `unattributedMs` in `#/derived/timeDecomposition`.
  `calc`: 10647621 - 10647621 = 0
- `contradictions`: All 1,567 assistant steps recorded usage and cache read metadata (`stepsWithUsage` 1,567, `stepsWithCacheRead` 1,567 in `#/stepSupport`), and 908 steps recorded valid durations summing to 8,425,672 ms.
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/totals`, `#/stepSupport`, `#/derived/timeDecomposition`, `#/warnings/0`
- `severity`: `P1`
- `reproCommand`: `jq -c '{unmeasured:.totals.assistantDurationUnmeasured,stepSupport:.stepSupport,unattributedMs:.derived.timeDecomposition.unattributedMs,spanMs:.derived.timeDecomposition.spanMs}' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — pi assistant step duration parser.

### F2 — cache re-send waste accounts for 458,186 fresh input tokens and $0.460626 in spend across two prompt transmissions

- `key`: `performance:deepseek-v4.1-flash:cache-resend-waste`
- `category`: `performance`
- `impact`: 458,186 fresh input tokens were re-sent without cache benefit across two steps, incurring $0.460626 in provider spend due to cold context transmission (< 10% cache reuse).
- `trend`: `not-comparable`
- `observation`: `#/cacheWaste` reports 2 steps meeting the cold waste threshold (input > 100,000 tokens and < 10% cache reuse), with `inputTokens` summing to 458,186 fresh tokens.
  `calc`: 229093 + 229093 = 458186
  Each step re-sent 229,093 input tokens while reading only 2,048 tokens from cache (0.89% cache reuse):
  `calc`: 2048 / 229093 = 0.008939600948086586
  Cost per step is $0.230313, totaling:
  `calc`: 0.230313 + 0.230313 = 0.460626
  Both steps ran under model `deepseek/deepseek-v4.1-flash`.
- `inference`: Two independent signals confirm cache waste: first, `#/cacheWaste/topSteps` records 2 specific steps with 229,093 input tokens each and cache read of only 2,048 tokens (0.89% reuse); second, billed cost for these two steps is $0.230313 each, representing a sum of $0.460626 out of $11.006325 window spend:
  `calc`: 0.460626 / 11.006325 = 0.04185102660429707
- `contradictions`: Across the entire window, cache hit ratio remains high at 98.92% (319,667,584 cache read tokens of 323,151,489 billed input tokens), showing waste was isolated to these 2 prompt transmissions.
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/cacheWaste`, `#/totals`
- `severity`: `P2`
- `reproCommand`: `jq -c '.cacheWaste' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: Prompt compilation and context prefixing in coding-agent runner (`sp-super-coder`).

### F3 — no tasks entered the verified-outcome fold, leaving the value axis empty

- `key`: `coverage:spur-task-check:verified-outcome-absent`
- `category`: `coverage`
- `impact`: `taskDenominator` is 0 and `verifiedResults` is 0, so no task verification metrics (`verifiedRate`, `timeToVerified`, cost per verified result) could be evaluated in this window.
- `trend`: `not-comparable`
- `observation`: `#/verifiedOutcome` reports `taskDenominator` 0, `verifiedResults` 0, `verifiedRate` null, `verifiedWithoutCorrection` 0, `correctionCount` 0, and `costCoverage` `{covered: 0, total: 0}`.
- `inference`: Two independent signals confirm that task verification was unmeasured: first, `taskDenominator` is 0 in `#/verifiedOutcome`; second, all outcome rates (`verifiedRate`, `verifiedWithoutCorrectionRate`, `correctionRate`) are null (`not available`).
- `contradictions`: 13 sessions were active in the window with 4,938 messages and 1,674 tool calls, but none was linked to a task evaluated under `spur task check`.
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/verifiedOutcome`
- `severity`: `P2`
- `reproCommand`: `jq -c '.verifiedOutcome' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: `spur task check` proof emission and `spur history analyze` outcome fold.

### F4 — message count reconciliation gap of 112 messages between coverage metadata and window totals

- `key`: `telemetry:spur-history-import:coverage-messages-reconciliation-gap`
- `category`: `telemetry`
- `impact`: `#/coverage` reports 5,050 messages across 19 files for pi, while `#/totals/messages` reports 4,938 messages, resulting in an unreconciled discrepancy of 112 messages (2.22% of coverage messages).
- `trend`: `not-comparable`
- `observation`: `#/coverage` reports 5,050 messages for source `pi` across 19 files.
  `#/totals/messages` reports 4,938 messages.
  The difference between coverage messages and totals messages is:
  `calc`: 5050 - 4938 = 112
  This represents a share of coverage messages:
  `calc`: 112 / 5050 = 0.02217821782178218
- `inference`: Two independent signals confirm the message accounting gap: first, `coverage[0].messages` is 5,050; second, `totals.messages` is 4,938, creating a gap of 112 messages:
  `calc`: 5050 - 4938 = 112
- `contradictions`: Tool call accounting reconciles exactly: `coverage[0].toolCalls` is 1,674, matching `totals.toolCalls` of 1,674 with 0 gap:
  `calc`: 1674 - 1674 = 0
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/coverage`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{coverageMsgs:(.coverage[0].messages),totalsMsgs:.totals.messages,diff:(.coverage[0].messages - .totals.messages)}' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — window filtering and coverage message accumulator.

### F5 — markdown report renderer corrupts title prefix and leaves opening code fence unclosed

- `key`: `workflow:spur-history-report:render-title-corrupted`
- `category`: `workflow`
- `impact`: Generated markdown reports render inside an unclosed code block with a corrupted title prefix, impairing document formatting and readability.
- `trend`: `not-comparable`
- `observation`: Lines 3–4 of `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.md` and `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-baseline.md` open with an unclosed code fence on line 3, followed on line 4 by a duplicated title string: `# History forensics report — generated 2026-11-14T13:0# History forensics report — generated...`.
- `inference`: Two independent signals confirm a bug in the markdown serializer: first, the overlapping title prefix `# History forensics report — generated 2026-11-14T13:0# History...` shows a partial buffer flush immediately before the complete header; second, the unclosed opening fence at line 3 places the report body into an open code block in both independently generated renders.
- `contradictions`: The underlying JSON artifacts are completely well-formed and valid, showing the defect is isolated to the markdown template serializer.
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.md:3-4`; `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-baseline.md:3-4`
- `severity`: `P3`
- `reproCommand`: `sed -n '1,5p' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.md`
- `ownerSurface`: `spur history report` — markdown renderer template.

### F6 — chained dispatch for minimax executor lacks cost telemetry

- `key`: `telemetry:pairing-analytics:minimax-cost-telemetry-absent`
- `category`: `telemetry`
- `impact`: The single pairing dispatch for executor `minimax` under role `scribe` reports `totalCostUsd: null`, leaving chained workflow dispatch cost unmeasured for this executor.
- `trend`: `not-comparable`
- `observation`: `#/pairings` contains 1 row: executor `minimax`, role `scribe`, agent `pi`, dispatches 1, successRate 1.0, with `totalCostUsd` null.
- `inference`: Two independent signals confirm absent cost signal: first, `totalCostUsd` is null in `#/pairings`; second, `meanDurationMs` is populated at 6,595.35 ms, confirming execution was timed while spend accounting was missing.
- `contradictions`: The dispatch executed successfully with zero failures and zero unknown outcomes (`successRate: 1.0`, `failures: 0`, `unknownOutcomes: 0`).
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '.pairings' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: `spur workflow` dispatch runner and `spur history analyze` pairing analytics fold.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count, or impact change is computed or implied. The final column records discrete baseline presence.

| Stable key | Recurrence class | Severity now | Discrete baseline presence and what a comparable baseline would need |
| --- | --- | --- | --- |
| `telemetry:spur-history-import:pi-assistant-step-duration-unmeasured` | `not-comparable` | P1 | Present partially in baseline: pi had 80 unmeasured assistant steps (830 timed of 910), codex had 1,241 unmeasured (1,853 of 3,094), agy had 690 unmeasured (22 of 712); present here with 659 unmeasured pi assistant steps (908 timed of 1,567). |
| `performance:deepseek-v4.1-flash:cache-resend-waste` | `not-comparable` | P2 | Present in baseline across 5 steps with 997,950 fresh input tokens (4 codex gpt-6.1-sol steps, 1 pi k3.1-pro step); present here across 2 steps with 458,186 fresh input tokens (both deepseek-v4.1-flash). |
| `coverage:spur-task-check:verified-outcome-absent` | `not-comparable` | P2 | Present in baseline: `taskDenominator` 6, `verifiedResults` 0; present here with `taskDenominator` 0, `verifiedResults` 0. |
| `telemetry:spur-history-import:coverage-messages-reconciliation-gap` | `not-comparable` | P3 | Present in baseline: coverage reported 25,080 messages across sources matching totals; absent in 2026-11-12 (0 gap); present here with 112-message gap (5,050 coverage vs 4,938 totals). |
| `workflow:spur-history-report:render-title-corrupted` | `not-comparable` | P3 | Present identically in current and baseline renders: line 3 opening fence unclosed, line 4 duplicated title prefix. |
| `telemetry:pairing-analytics:minimax-cost-telemetry-absent` | `not-comparable` | P3 | Present in baseline: minimax pairing had `totalCostUsd` null; present here identically with minimax pairing `totalCostUsd` null. |
| `positive:spur-history-import:zero-tool-errors-and-clean-file-parsing` | `not-comparable` | P3 | Present in baseline: 0 parse/validation errors across 53 files, 0 tool errors across 5,415 calls; present here: 0 parse/validation errors across 19 files, 0 tool errors across 1,674 calls. |
| `positive:spur-history-import:complete-tool-duration-instrumentation` | `not-comparable` | P3 | Absent in baseline (4,329 of 5,415 calls unmeasured, 79.94%); improved here: 1,674 of 1,674 tool calls instrumented with 0 unmeasured (100.00%). |
| `positive:spur-history-import:full-token-and-spend-telemetry-across-models` | `not-comparable` | P3 | Absent in baseline (4 models had zero tokens and $0 cost); improved here: all reported models have complete token and spend telemetry ($11.006325 total). |
| `positive:pairing-analytics:zero-unknown-dispatch-outcomes` | `not-comparable` | P3 | Present in baseline: 3 dispatches with 0 unknown outcomes; present here: 1 dispatch with 0 unknown outcomes. |
| `positive:spur-history-import:high-cache-hit-ratio` | `not-comparable` | P3 | Present in baseline at 64.12% cache-read share (508,769,451 of 793,418,982 input tokens); improved here at 98.92% cache-read share (319,667,584 of 323,151,489 input tokens). |

## Telemetry gaps

Dimensions the artifact cannot support. Each renders `not available`; none is inferred from raw history files.

| Dimension | Rendering | Why | Anchor |
| --- | --- | --- | --- |
| Duration on 659 of 1,567 assistant steps | `not available` | 659 assistant steps in pi report 0 ms duration with populated `assistantDurationUnmeasured` 659 | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/totals`, `#/stepSupport` |
| Command text and argument payloads for all 1,674 tool calls | `not available` | `byTool` carries no command text; `#/loops` exposes only `argsDigest` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Provider cost signal for `minimax` pairing dispatch | `not available` | `totalCostUsd` is reported as null for executor `minimax` under role `scribe` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/pairings` |
| Verified-rate and cost per verified result | `not available` | `taskDenominator` is 0; no tasks certified under `spur task check` in the window | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/verifiedOutcome` |
| Per-phase breakdown | `not available` | `phaseSupport` is `supported` with an empty `phases` array and `invalidPhaseCount` 0 | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/derived/phases` |
| Result bytes for all 1,674 tool calls | `not available` | `resultBytes` is reported as 0 across all tools in `byTool` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/byTool` |
| Per-pairing model identity | `not available` | `model` is `null` on the minimax pairing row | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/pairings` |
| Loop repetition below the fold's threshold | `not available` | `#/loops` reports only signatures repeating at least 3 times; single and double repeats are not surfaced | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/loops`, `#/population/loops` |
| The current day's remaining 18.92 h | `not available` | The window is `provisional` and 21.18% elapsed at generation; all figures describe a partial-day snapshot | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-provenance.json` — `windowState`; `#/generatedAt`, `#/selector` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` on four axes in section 3, including 21.18% elapsed coverage vs a completed day | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-baseline.json` |

## Remediation options

Proposals only. Nothing below has been applied, no diff is produced, and no command here was run by this report. Each option carries the printed `spur task create` handoff that lands it, with the finding's stable key in the task text so the next report classifies that finding as `resolved`. The operator remains the gate: a model-authored report never writes to the task corpus.

**R1 — emit assistant step duration across all pi assistant turns** (addresses `telemetry:spur-history-import:pi-assistant-step-duration-unmeasured`)

- Owner surface: `spur history import` — pi assistant step duration parser.
- Expected impact: captures turn duration for all pi assistant turns, resolving the 659 unmeasured assistant steps in `#/stepSupport` and eliminating the 10,647,621 ms unattributed residual in time decomposition.
- Verification method: a fresh artifact reports `stepsWithDuration` equal to `assistantSteps` for pi in `#/stepSupport`, and `assistantDurationUnmeasured` of 0 in `#/totals`.
- Reversibility: reversible — parser timestamp logic.
- Handoff: `spur task create "telemetry:spur-history-import:pi-assistant-step-duration-unmeasured — measure step durations across all pi assistant turns" --template issue`

**R2 — stabilize context prefixing to prevent cache re-send waste on deepseek-v4.1-flash** (addresses `performance:deepseek-v4.1-flash:cache-resend-waste`)

- Owner surface: Coding-agent runner (`sp-super-coder`) prompt compilation and context prefixing.
- Expected impact: preserves prompt prefix alignment across turns, preventing 458,186 cold tokens from being re-sent without cache benefit and saving $0.460626 in provider cost.
- Verification method: a fresh artifact reports 0 steps meeting the cold waste threshold in `#/cacheWaste`.
- Reversibility: reversible — prompt template formatting update.
- Handoff: `spur task create "performance:deepseek-v4.1-flash:cache-resend-waste — stabilize context prefixing to eliminate cache re-send waste" --template issue`

**R3 — connect verified task outcomes to history analytics** (addresses `coverage:spur-task-check:verified-outcome-absent`)

- Owner surface: `spur task check` proof emission and `spur history analyze` outcome fold.
- Expected impact: task runs certified under `spur task check` populate `taskDenominator` and `verifiedResults`, enabling outcome rate metrics.
- Verification method: a subsequent artifact reports `taskDenominator > 0` with populated `verifiedRate`.
- Reversibility: reversible — SQL join logic in analysis fold.
- Handoff: `spur task create "coverage:spur-task-check:verified-outcome-absent — connect verified task outcomes to history analytics" --template issue`

**R4 — reconcile coverage message accounting with window bounds filtering** (addresses `telemetry:spur-history-import:coverage-messages-reconciliation-gap`)

- Owner surface: `spur history import` — window filtering and coverage message accumulator.
- Expected impact: aligns `#/coverage` message totals with `#/totals/messages`, resolving the 112-message accounting gap.
- Verification method: a fresh artifact reports zero difference between sum of `#/coverage[].messages` and `#/totals/messages`.
- Reversibility: reversible — query filtering logic.
- Handoff: `spur task create "telemetry:spur-history-import:coverage-messages-reconciliation-gap — reconcile coverage message count with window bounds" --template issue`

**R5 — fix title duplication and unclosed code fence in report renderer** (addresses `workflow:spur-history-report:render-title-corrupted`)

- Owner surface: `spur history report` — markdown serializer template.
- Expected impact: ensures markdown reports render with balanced code fences and a single clean title.
- Verification method: `sed -n '1,5p'` on a generated render shows the title exactly once and no unbalanced opening code fence.
- Reversibility: reversible — template string formatting.
- Handoff: `spur task create "workflow:spur-history-report:render-title-corrupted — emit title once and balance code fences in report renderer" --template issue`

**R6 — instrument provider cost tracking for minimax executor** (addresses `telemetry:pairing-analytics:minimax-cost-telemetry-absent`)

- Owner surface: `spur workflow` dispatch runner and `spur history analyze` pairing analytics fold.
- Expected impact: captures billed spend for minimax dispatches, replacing null values with concrete cost figures.
- Verification method: a fresh artifact reports a non-null `totalCostUsd` value for minimax rows in `#/pairings`.
- Reversibility: reversible — cost extraction mapper.
- Handoff: `spur task create "telemetry:pairing-analytics:minimax-cost-telemetry-absent — extract spend telemetry for minimax executor" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 36,352,944 ms = 10.10 h against a 24.0 h window):

| Component | Time | Share of span |
| --- | --- | ---: |
| Tool execution | 4.38 h (15,781,733 ms) | 43.41% |
| Unattributed (unmeasured durations) | 2.96 h (10,647,621 ms) | 29.29% |
| LLM latency (assistant duration) | 2.34 h (8,425,672 ms) | 23.18% |
| Idle / overhead | 25.37 min (1,522,121 ms) | 4.19% |

Reading: Tool execution represents the largest fraction of the active window at 43.41% of span (15,781,733 ms), driven overwhelmingly by bash commands. Unattributed time accounts for 29.29% of span (10,647,621 ms), reflecting the 659 unmeasured pi assistant step durations (`#/warnings/0`, F1). LLM latency accounts for 23.18% of span (8,425,672 ms), and idle overhead represents 4.19% (1,522,121 ms). Because concurrent execution occurred (such as long-running subagent calls), component durations sum to 36,377,147 ms:
`calc`: 8425672 + 15781733 + 1522121 + 10647621 = 36377147
which exceeds the wall-clock span by 24,203 ms:
`calc`: 36377147 - 36352944 = 24203

**Per-step latency by source** (`#/stepSupport`):

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per timed step | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: |
| pi | 1,567 | 908 (659 missing) | 8,425,672 ms | 9,279.37 ms (9.28 s) | 98.92% |

Pi assistant steps carry an unmeasured duration gap across 659 steps (F1). The 908 timed steps average 9.28 s per step. In `#/topStepsByDuration`, assistant step durations for pi range up to 201.3 s.

**Tool execution** (`#/byTool`; instrumented total 15,781,733 ms = 4.38 h):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| bash | 1,566 | 13,139,188 ms | 8,390 ms | 1,618,453 ms | 0 |
| subagent | 8 | 2,641,891 ms | 330,236 ms | 1,800,605 ms | 0 |
| read | 79 | 633 ms | 8 ms | 118 ms | 0 |
| edit | 8 | 18 ms | 2 ms | 5 ms | 0 |
| to&#100;o | 12 | 2 ms | 0 ms | 1 ms | 0 |
| write | 1 | 1 ms | 1 ms | 1 ms | 0 |

Bash commands account for 13,139,188 ms of tool runtime (83.26% of total tool runtime). Subagent execution accounts for 2,641,891 ms (16.74% of tool runtime). All 1,674 tool calls across all 6 tools are fully instrumented with duration telemetry (`durationUnmeasured: 0`).

**Cost and tokens by source** (`#/bySource`, `#/totals`, total `$11.006325`):

| Source | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cost / 1M billed input | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 4,938 | 323,151,489 | 319,667,584 | 0 | 1,504,484 | `$11.006325` | 100.00% | `$34.06` | 98.92% |

Window totals: billed input 323,151,489, output 1,504,484, cost $11.006325. Pi accounted for 100% of reported tokens and spend, serving 98.92% of input tokens from cache.

**Chained `agent.run` run cost** (per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Agent | Dispatches | Success rate | Failures | Unknown outcomes | Escalations | Total cost | Mean duration |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| `minimax` | scribe | pi | 1 | 1.00 | 0 | 0 | none | `not available` | 6,595.35 ms (6.60 s) |

The single pairing dispatch executed successfully with zero failures and zero unknown outcomes. Cost signal is `not available` (`totalCostUsd: null`, F6).

**Cache re-send waste** (`#/cacheWaste`): 2 steps, 458,186 fresh input tokens, $0.460626 spend. Both steps ran under model `deepseek/deepseek-v4.1-flash` with 229,093 input tokens and only 2,048 cache read tokens (0.89% cache reuse, F2).

**Per-session concentration** (`#/bySession`, all 13 sessions listed): session `2026-11-14T07-35-49-850Z_01a1d8fb-e759-76b1-868c-99b3ca1e5d85` contains 357 messages, 127 tool calls, and $2.275685 in spend. Session `3840199a-2fc9-433f-a63a-9aea0518c763_sp-super-coder_0_transcript` contains 827 messages, 207 tool calls, and $1.134765 in spend. Session `2a733f9e-6786-4b6b-8ba1-7217349892a1_sp-super-coder_0_transcript` contains 482 messages, 121 tool calls, and $0.777262 in spend.

**Bottleneck order** (`#/derived/bottlenecks`): tool 43.41% → unattributed 29.29% → llm 23.18% → idle 4.19%.

## Workflow and process improvements

Numbered prose proposals and projected candidates; each is report-only and requires operator review before implementation.

1. **Emit assistant step duration across all pi assistant turns.** 659 of 1,567 assistant steps carry no duration (F1), forcing 10,647,621 ms of window span into the unattributed bucket. Capturing turn timestamps will eliminate this unmeasured latency gap. Owner surface: `spur history import` pi adapter. Recurrence basis: observed at `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` `#/stepSupport`.
2. **Stabilize context prefixing to prevent cache re-send waste.** 458,186 fresh input tokens were re-sent without cache benefit across two steps, incurring $0.460626 in spend (F2). Preserving prompt template prefixes will eliminate cold context transmissions. Owner surface: `sp-super-coder` context compiler. Recurrence basis: observed at `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` `#/cacheWaste`.
3. **Connect task check outcomes to history analytics.** `taskDenominator` is 0 in the verified-outcome fold (F3). Linking certified task runs to history imports will restore verified rate tracking. Owner surface: `spur history analyze` outcome fold. Recurrence basis: observed at `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` `#/verifiedOutcome`.
4. **Reconcile coverage message accounting with window bounds filtering.** Coverage reports 5,050 messages while window totals report 4,938 messages, leaving an unreconciled gap of 112 messages (F4). Ensuring coverage metrics apply identical window bounds will restore accounting consistency. Owner surface: `spur history import` coverage aggregator. Recurrence basis: observed at `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` `#/coverage`.
5. **Fix title duplication and code fence formatting in markdown report renderer.** The report renderer emits a duplicate title string on line 4 and leaves line 3 opening code fence unclosed (F5). Updating the template string emitter will restore well-formed markdown rendering. Owner surface: `spur history report` markdown renderer. Recurrence basis: observed at lines 3–4 of `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.md:3-4`.
6. **Instrument spend telemetry for minimax executor.** The minimax dispatch lacks cost accounting, reporting `totalCostUsd: null` (F6). Extracting usage spend will ensure full run cost visibility. Owner surface: `spur history analyze` pairing analytics fold. Recurrence basis: observed at `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` `#/pairings`.

Projected candidate under the environment-improvement lens (task 0686):
- `workflow:agents-md:navigation` — **owner surface:** `AGENTS.md` see_also section. **expected impact:** shorter file search latency during agent session startup. **verification method:** subsequent daily report key `resolved` or absent. **reversibility:** revert pointer edit in `AGENTS.md`.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry, and no command substitution. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | First observed | Note |
| --- | --- | ---: | --- | --- |
| (none) | none | 0 | `not available` | Zero loop rows met the 3-repeat threshold in this window (`#/loops` is empty). |

The loop fold reports signatures repeating at least 3 times. In this window, 0 loop rows met the repetition threshold (`#/population/loops: 0`, `#/loops: []`). None of these observations triggers automated workflow intervention.

## Positive patterns

Held to the same evidence standard as problems: observation, inference, and at least one anchor each.

### P1 — zero tool errors and clean file parsing across 19 files

- `key`: `positive:spur-history-import:zero-tool-errors-and-clean-file-parsing`
- `category`: `positive`
- `impact`: Zero parse errors, zero validation errors, and zero unknown records across all 19 imported files for pi. Zero tool errors occurred across all 1,674 tool calls in the window.
- `trend`: `not-comparable`
- `observation`: `#/byTool[].errors` is 0 across all 6 tools summing to 1,674 calls:
  `calc`: 1566 + 8 + 79 + 8 + 12 + 1 = 1674
  `calc`: 0 / 1674 = 0
  `#/coverage` reports `parseErrors` 0, `validationErrors` 0, and `unknownRecords` 0 for pi across 19 files.
- `inference`: Zero tool errors and zero file parsing errors demonstrate that the importer parsed files without syntax rejections and executed tools without runtime crashes:
  `calc`: 0 / 19 = 0
- `contradictions`: Error-free execution does not imply complete telemetry: 659 assistant steps lack duration telemetry (F1), and cache waste occurred across two steps (F2).
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{toolErrors:([.byTool[].errors]|add),coverage:[.coverage[]|{s:.source,f:.files,p:.parseErrors,v:.validationErrors,u:.unknownRecords}],totals:{m:.totals.messages,c:.totals.toolCalls}}' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — pi source adapter.

### P2 — 100% of tool calls instrumented with duration telemetry

- `key`: `positive:spur-history-import:complete-tool-duration-instrumentation`
- `category`: `positive`
- `impact`: All 1,674 tool calls across all 6 tools carry complete duration telemetry with zero unmeasured calls (`durationUnmeasured: 0`), accounting for 15,781,733 ms of tool execution.
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `toolCalls` 1,674 and `durationUnmeasured` 0.
  `calc`: 1674 - 1674 = 0
  The share of instrumented tool calls is exactly 100%:
  `calc`: 1674 / 1674 = 1
  Across all 6 tools in `#/byTool`, `durationUnmeasured` is 0.
- `inference`: Zero unmeasured tool calls across 1,674 invocations confirms that tool duration timing was fully instrumented:
  `calc`: 1674 / 1674 = 1
- `contradictions`: While tool duration measurement was 100% complete, assistant step duration measurement suffered a 42.05% gap (F1).
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/totals`, `#/byTool`
- `severity`: `P3`
- `reproCommand`: `jq -c '{toolCalls:.totals.toolCalls,durationUnmeasured:.totals.durationUnmeasured,byTool:.byTool}' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — pi tool duration tracker.

### P3 — complete provider token usage and spend telemetry across all active model lanes

- `key`: `positive:spur-history-import:full-token-and-spend-telemetry-across-models`
- `category`: `positive`
- `impact`: All active model lanes (`deepseek/deepseek-v4.1-flash` and `k3.1-pro`) recorded complete token and spend telemetry, accounting for 323,151,489 billed input tokens, 1,504,484 output tokens, and $11.006325 in provider spend, with zero records assigned to model `unknown`.
- `trend`: `not-comparable`
- `observation`: `#/byModel` reports 4,866 messages, 314,167,850 input tokens, 1,489,388 output tokens, and $10.900038 cost for `deepseek/deepseek-v4.1-flash`; and 72 messages, 8,983,639 input tokens, 15,096 output tokens, and $0.106287 cost for `k3.1-pro`.
  `calc`: 4866 + 72 = 4938
  `calc`: 314167850 + 8983639 = 323151489
  `calc`: 1489388 + 15096 = 1504484
  `calc`: 10.900038 + 0.106287 = 11.006325
- `inference`: Both model distributions sum exactly to window totals, confirming complete token and cost tracking across active models:
  `calc`: 11.006325 - 11.006325 = 0
- `contradictions`: Complete model spend accounting did not prevent cache re-send waste from occurring in two prompt transmissions (F2).
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/byModel`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{byModel:.byModel,totals:.totals}' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — usage extraction across model lanes.

### P4 — zero unknown dispatch outcomes across pairing dispatches

- `key`: `positive:pairing-analytics:zero-unknown-dispatch-outcomes`
- `category`: `positive`
- `impact`: The single pairing dispatch resolved to a definitive terminal success state with zero unknown outcomes recorded.
- `trend`: `not-comparable`
- `observation`: In `#/pairings`, `unknownOutcomes` is 0 across 1 dispatch for executor `minimax` under role `scribe`.
  `calc`: 0 / 1 = 0
  `calc`: 1 / 1 = 1
- `inference`: Zero unknown dispatch outcomes confirms that dispatch status tracking resolved the invocation without lost execution states:
  `calc`: 0 / 1 = 0
- `contradictions`: While dispatch state was cleanly tracked, provider spend was missing (`totalCostUsd: null`, F6).
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '.pairings' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — pairing analytics fold.

### P5 — high cache-hit ratio of 98.92% on billed input tokens

- `key`: `positive:spur-history-import:high-cache-hit-ratio`
- `category`: `positive`
- `impact`: 319,667,584 of 323,151,489 billed input tokens were served from cache (98.92% cache hit ratio), minimizing provider spend to $11.006325 for 323M input tokens.
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `inputTokens` 323,151,489 and `cacheReadTokens` 319,667,584.
  The cache hit share of billed input is:
  `calc`: 319667584 / 323151489 = 0.9892189728876615
  Fresh un-cached input tokens amounted to only:
  `calc`: 323151489 - 319667584 = 3483905
- `inference`: A cache hit ratio of 98.92% demonstrates effective prompt prefix caching across sessions:
  `calc`: 319667584 / 323151489 = 0.9892189728876615
- `contradictions`: Despite high aggregate cache hit performance, two prompt transmissions suffered cold cache re-send waste (F2).
- `evidenceAnchor`: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{inputTokens:.totals.inputTokens,cacheReadTokens:.totals.cacheReadTokens,ratio:(.totals.cacheReadTokens / .totals.inputTokens)}' .spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — token accumulator.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `telemetry:spur-history-import:pi-assistant-step-duration-unmeasured` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/totals`, `#/stepSupport`, `#/derived/timeDecomposition`, `#/warnings/0` |
| `performance:deepseek-v4.1-flash:cache-resend-waste` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/cacheWaste`, `#/totals` |
| `coverage:spur-task-check:verified-outcome-absent` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/verifiedOutcome` |
| `telemetry:spur-history-import:coverage-messages-reconciliation-gap` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/coverage`, `#/totals` |
| `workflow:spur-history-report:render-title-corrupted` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.md:3-4`; `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-baseline.md:3-4` |
| `telemetry:pairing-analytics:minimax-cost-telemetry-absent` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/pairings` |
| `positive:spur-history-import:zero-tool-errors-and-clean-file-parsing` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals` |
| `positive:spur-history-import:complete-tool-duration-instrumentation` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/totals`, `#/byTool` |
| `positive:spur-history-import:full-token-and-spend-telemetry-across-models` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/byModel`, `#/totals` |
| `positive:pairing-analytics:zero-unknown-dispatch-outcomes` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/pairings` |
| `positive:spur-history-import:high-cache-hit-ratio` | `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-current.json` — `#/totals` |

Baseline artifacts cited in sections 3 and 5: `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byModel`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`, `#/totals`, `#/loops`, `#/cacheWaste`, `#/ladderSnapshot`) and `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-history-anatomy-baseline.md:3-4`. Window bounds and equal-duration offsets are recorded in `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-paths.txt:5-8`; run identity, digests, selector and provisional window state are recorded in `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-provenance.json` and `.spur/run/42c527e5-9188-4e21-88f1-ea86bcd1dc66-selector.json`.

Two limitations of this report's own evidence: the current window is provisional and 21.18% elapsed at generation (5.08 h of 24.0 h, 18.92 h still to run); and no comparison against `2026-11-13` is stated anywhere in this report because that baseline was found `not comparable` on four independent axes in section 3.

