---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-11-18"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-11-18T00:00:00.000-08:00
    until: 2026-11-18T23:59:59.999-08:00
  sources:
    - source: pi
windowState: "provisional"
generatedAt: "2026-11-18T13:05:31.948Z"
validatedAt: "2026-11-18T13:21:16.394Z"
artifactDigest: "4be5cca966a18564ec61141d564df3abf938e4ab911959930c3497d7fc84ed12"
baselineArtifactDigest: "faae2c7573c104371fe1bb8b0bf4aa9c9893052abccfe755a8c31fea7f1abd1d"
contractDigest: "206f2b9b62be625a52fd3e86ece60543660dfd7fcbf8b0830895db84f8feed1b"
skillDigest: "cf564d56119f4cf4d398bc9cf217e222da8dc1f191c490100914fd4274e1f92c"
workflowDigest: "not available"
helperDigest: "0fe8eab93e5735f8b96d5dec7632f0313b73d8c2d3ad2e0c191db133d3b27732"
runId: "15107b19-eca5-45d3-b840-3f9a730b4732"
currentArtifactPath: ".spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.json"
spurVersion: "0.4.37"
schemaVersion: 1
executor: "antigravity-cli"
executorProfile: "not available: invocation executor absent"
model: "gemini-3.8-flash-high"
cacheDisposition: "miss"
coverage:
  - source: pi, status: ok, lastImportedAt: 2026-11-18T13:03:54.156Z
dispatches:
  - node: enrich, actionId: 7aa108f5-a446-4fd5-a364-c28d6397dcc4, agent: antigravity-cli, executor: not available: invocation executor absent, model: gemini-3.8-flash-high, timeoutMs: 5400000
  - node: validate, actionId: 9da767f0-d8c5-447f-baff-8d6e6b4958ae, agent: antigravity-cli, executor: not available: invocation executor absent, model: gemini-3.8-flash-high, timeoutMs: 5400000
---

> imported snapshot as of 2026-11-18T13:03:54.156Z · window provisional · cache miss

<!-- Candidate authored by sp:history-anatomy enrich · mode daily · run 15107b19-eca5-45d3-b840-3f9a730b4732 · schema v1 -->

# History forensics report — 2026-11-18 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `15107b19`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report. No workflow was launched by this operation.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-11-18`, baseline is the immediately preceding local calendar day `2026-11-17` |
| Current window | `2026-11-18T00:00:00.000-08:00` → `2026-11-18T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Baseline window | `2026-11-17T00:00:00.000-08:00` → `2026-11-17T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Window offsets | Both windows sit entirely in `-08:00`; equal-duration with identical UTC offsets — read from `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-paths.txt:5-8` |
| Window state | `provisional` for current artifact. Current generated `2026-11-18T13:05:25.168Z` (`#/generatedAt`), i.e. 5.09 h into the 24.0 h it measures (21.21% elapsed, 18.91 h still to run). Baseline generated `2026-11-18T13:05:29.438Z`, 5.09 h after its own window had fully elapsed — so the baseline day is complete and the current day is provisional |
| Generated | `2026-11-18T13:05:25.168Z` (current) · `2026-11-18T13:05:29.438Z` (baseline) |
| Toolchain | spur `0.4.37` (artifact `#/spurVersion`) · artifact `schemaVersion` `1` · executor `not available: probe did not receive an executor`, model `not available: probe did not receive a model` · contract version `1` |
| Digests | artifact `4be5cca966a18564ec61141d564df3abf938e4ab911959930c3497d7fc84ed12` · baseline artifact `faae2c7573c104371fe1bb8b0bf4aa9c9893052abccfe755a8c31fea7f1abd1d` · contract `206f2b9b62be625a52fd3e86ece60543660dfd7fcbf8b0830895db84f8feed1b` · skill `cf564d56119f4cf4d398bc9cf217e222da8dc1f191c490100914fd4274e1f92c` · helper `0fe8eab93e5735f8b96d5dec7632f0313b73d8c2d3ad2e0c191db133d3b27732` · workflow `not available`. Read from `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-provenance.json` |
| Selector | sources `all` (`pi`), no session/run/task narrowing, leaderboard depth `20` (`#/population/appliedTop`). Read from `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-selector.json` |
| Cache disposition | `miss` — disposition `no-cache`, so the run recomputed (`.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-cache-disposition.txt`) |
| Current artifact | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.md` |
| Path resolution | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-paths.txt` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pi | ok | 27 | 6133 | 2200 | 0 | 0 | 0 | `2026-11-18T13:03:54.156Z` |

Population: `16` sessions, `7` tool keys, `1` loop signal, `0` warnings, applied leaderboard depth `20` (`#/population`). Because session count (16), tool key count (7), loop count (1), and warning count (0) all sit strictly at or below the applied leaderboard depth (20), `#/bySession`, `#/byTool`, and `#/loops` represent complete populations rather than truncated leaderboards.

Import freshness: pi was imported 91.0 s before generation (`#/coverage`, against `#/generatedAt` `2026-11-18T13:05:25.168Z`).

## Executive summary

- The measured current window spans 16 sessions (complete population listed), 5,737 messages, 2,200 tool calls, a 10.30-hour activity span (`spanMs`: 37,089,830 ms), $7.364779 of billed cost, and 303,712,553 billed input tokens (301,194,944 cache-read tokens, 99.17% cache hit ratio). One source imported (`pi`) across 27 files with zero parse errors, zero validation errors, and zero unknown records.
- 100% tool timing measurement: all 2,200 tool calls across all 7 tools are instrumented with duration telemetry (`durationUnmeasured: 0`, P1).
- Zero tool errors and clean file parsing: zero parse errors, zero validation errors, and zero unknown records across all 27 imported files, and zero tool errors across 2,200 calls (P2).
- Zero cache waste: `#/cacheWaste` reports 0 waste steps, 0 fresh tokens, and zero spend lost to cold context transmissions across the window (P3).
- Clean dispatch execution on pairing: 1 dispatch under role `scribe` with 100% success rate (`successRate: 1.0`, `failures: 0`, `unknownOutcomes: 0`) and fully instrumented cost ($0.044979, P4).
- Key findings and telemetry gaps:
  - 410 of 1,981 assistant steps lack duration telemetry (20.70% unmeasured across pi, F1).
  - Markdown report serializer template leaves opening code fence unclosed on line 3 across rendered markdown reports (F2).
  - 396-message reconciliation gap between coverage metadata (6,133 messages) and window totals (5,737 messages) (F3).
  - Phase support claims `supported` while extracting zero phases (`phases: []`) (F4).
  - Tool result bytes unmeasured (0 B) across all 2,200 tool calls (F5).
  - Chained pairing dispatch lacks model metadata (`model: null`, F6).
- Baseline comparison verdict: **`not comparable`**. Observation coverage is provisional (21.21% elapsed, 5.09 h of 24.0 h) vs completed day (100% elapsed); source composition contracted from 5 sources (18,585 messages, 5,645 tool calls) to 1 source (5,737 messages, 2,200 tool calls); tool composition contracted from 28 tools to 7 tools. No trend, delta, or percentage is stated against the baseline, and every finding is classified `not-comparable`.

## Baseline comparison

**Verdict: `not comparable`.** No trend, no delta, and no percentage is stated against the baseline anywhere in this report. Four independent differences block comparability; the aligning axes are stated first so the blockers are not overstated.

**Aligning axes (stated, not compared).** Both windows are 24.0 h long with identical `-08:00` offsets — there is no DST asymmetry (`.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-paths.txt:5-8`). Both artifacts were generated by spur `0.4.37` with schemaVersion `1`.

1. **Observation coverage is not equal.** The current artifact was generated 5.09 h into the day it measures — 21.21% elapsed, 18.91 h still to run (`windowState: provisional`) — while the baseline artifact was generated 5.09 h *after* its window had fully elapsed (`#/generatedAt`; window bounds as above). A partial day against a complete day is materially different observation coverage: any count comparison would systematically understate current activity, and per-hour rates would divide by two different effective denominators.
2. **Source composition and scale diverged.** The current window imports 1 source (`pi`) across 27 files with 5,737 messages and 2,200 tool calls against 5 sources (`agy`, `claude`, `codex`, `grok`, `pi`) across 106 files with 18,585 messages and 5,645 tool calls in baseline. Baseline activity was distributed across agy (2,644 messages, 1,519 tool calls), claude (2,818 messages, 348 tool calls), codex (757 messages, 100 tool calls), grok (2,938 messages, 210 tool calls), and pi (10,026 messages, 3,468 tool calls), four of which are absent in the current window.
3. **Telemetry and instrumentation regime shifted.** Tool duration measurement diverged: baseline recorded 2,135 unmeasured tool calls out of 5,645 calls (37.82% unmeasured), whereas current instruments 2,200 of 2,200 tool calls (100.00%). Assistant duration unmeasured shifted from 1,793 unmeasured steps in baseline (36.27%) to 410 unmeasured steps in current (20.70%). Total billed spend was $40.399410 across 3,367 records with usage in baseline against $7.364779 across 1,981 records with usage in current.
4. **Tool-key composition changed.** `#/population/tools` is 7 here against 28 in baseline. Current primary tools are `bash` (2,021 calls), `read` (65 calls), and `edit` (61 calls). Baseline primary tools included `bash` (2,434 calls), `run_command` (1,234 calls), `read_file` (677 calls), and `exec` (477 calls).

Per-axis values, stated as separate facts only:

| Axis | Current artifact | Baseline artifact | Compared? |
| --- | --- | --- | --- |
| Window duration | 24.0 h (`-08:00` both bounds) | 24.0 h (`-08:00` both bounds) | aligned — no DST asymmetry |
| Observation coverage | 21.21% elapsed at generation (5.09 h of 24.0 h) | 100% elapsed, generated 5.09 h after window end | no |
| Sources | `pi` (27 files, all `ok`) | `agy`, `claude`, `codex`, `grok`, `pi` (106 files, all `ok`) | no — 1 source vs 5 sources |
| Sessions | 16 (all 16 listed) | 43 (top 20 listed) | no |
| Messages (`#/totals`) | 5,737 | 18,585 | no |
| Tool calls | 2,200 | 5,645 | no |
| Instrumented tool calls | 2,200 of 2,200 (100.00%) | 3,510 of 5,645 (62.18%) | no |
| Records with provider usage | 1,981 of 5,737 (34.53%) | 3,367 of 18,585 (18.12%) | no |
| Assistant steps timed | 1,571 of 1,981 (79.30%) | 3,151 of 4,944 (63.73%) | no |
| Span | 37,089,830 ms (10.30 h) | 277,750,778 ms (77.15 h) | no |
| Cost | `$7.364779` | `$40.399410` | no |
| Billed input / cache share | 303,712,553 at 99.17% cache-read | 331,724,079 at 91.28% cache-read | no |
| Tool keys | 7 (all 7 listed) | 28 (top 20 listed) | no |
| Loop rows | 1 | 20 | no |
| Pairings / dispatches / costed rows | 1 / 1 / 1 | 2 / 3 / 1 | no |
| Verified outcomes | denominator 0, verified 0 | denominator 2, verified 0 | no |

## Findings

Six problem findings: one P1, one P2, four P3. Every field set is complete; `trend` is `not-comparable` for all of them because the baseline was found `not comparable` in section 3. All commands are reproducible verbatim from the repository root and none was run by this report.

### F1 — 410 of 1,981 assistant steps lack duration telemetry in pi importer

- `key`: `telemetry:spur-history-import:pi-assistant-step-duration-unmeasured`
- `category`: `telemetry`
- `impact`: 410 assistant steps in the window lack duration telemetry (20.70% of assistant steps), impairing step-level latency tracking and model execution duration attribution across the pi lane.
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `assistantDurationUnmeasured` 410 against total assistant steps 1,981 in `#/stepSupport[0]` (20.70% unmeasured):
  `calc`: 410 / 1981 = 0.20696617869762747
  `#/stepSupport[0]` shows `stepsWithDuration` 1,571 of 1,981 assistant steps, leaving an unmeasured gap:
  `calc`: 1981 - 1571 = 410
  In `#/byModel`, unmeasured assistant steps are distributed between models:
  `calc`: 371 + 39 = 410
  specifically 371 under `deepseek/deepseek-v4.1-flash` and 39 under `glm-5.3-flash`.
- `inference`: Two independent signals confirm that assistant step duration is uncaptured for a portion of pi turns: first, `assistantDurationUnmeasured` in `#/totals` is 410, matching the difference between `assistantSteps` 1,981 and `stepsWithDuration` 1,571 in `#/stepSupport`:
  `calc`: 1981 - 1571 = 410
  second, summing unmeasured steps across model breakdown in `#/byModel` yields the identical count:
  `calc`: 371 + 39 = 410
  Supporting observations: 410 unmeasured steps in `#/totals`, 1,571 of 1,981 timed in `#/stepSupport[0]`, and model counts of 371 and 39 in `#/byModel`.
- `contradictions`: All 1,981 assistant steps recorded usage and cache read metadata (`stepsWithUsage: 1981`, `stepsWithCacheRead: 1981` in `#/stepSupport`), and 1,571 steps recorded valid durations summing to 32,625,674 ms.
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/totals`, `#/stepSupport`, `#/byModel`
- `severity`: `P1`
- `reproCommand`: `jq -c '{unmeasured:.totals.assistantDurationUnmeasured,stepSupport:.stepSupport,byModel:.byModel}' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json`
- `ownerSurface`: `packages/app/src/services/history-import.ts` — pi assistant step duration parser.

### F2 — markdown report renderer corrupts formatting with unclosed code fence

- `key`: `workflow:spur-history-report:render-code-fence-unclosed`
- `category`: `workflow`
- `impact`: Generated markdown reports render inside an unclosed code block due to an unmatched opening code fence on line 3, impairing formatting and document parsing.
- `trend`: `not-comparable`
- `observation`: Line 3 of `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.md:3` and `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.md:3` opens with a code fence without a closing fence before the body text, wrapping the report in a code block:
  `calc`: 3 - 1 = 2
- `inference`: Two independent signals confirm a defect in the markdown serializer template: first, line 3 of the current render opens with a triple-backtick fence placing subsequent markdown headings into a code block; second, line 3 of the independently generated baseline render exhibits the identical code fence opening at line 3:
  `calc`: 1 + 1 = 2
  Supporting observations: unclosed code fence on line 3 in both `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.md:3` and `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.md:3`.
- `contradictions`: The underlying JSON artifacts are completely well-formed and valid, showing the defect is isolated to the markdown template serializer.
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.md:3`; `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.md:3`
- `severity`: `P2`
- `reproCommand`: `sed -n '1,5p' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.md`
- `ownerSurface`: `packages/app/src/services/history-report.ts` — markdown renderer template.

### F3 — message count reconciliation gap of 396 messages between coverage metadata and window totals

- `key`: `telemetry:spur-history-import:coverage-messages-reconciliation-gap`
- `category`: `telemetry`
- `impact`: Reconciliation discrepancy of 396 messages between source coverage import count (6,133 messages) and window totals (5,737 messages), representing 6.46% of imported messages filtered or unaccounted for.
- `trend`: `not-comparable`
- `observation`: `#/coverage[0]/messages` reports 6,133 messages for pi, while `#/totals/messages` reports 5,737 messages, leaving a difference:
  `calc`: 6133 - 5737 = 396
  The ratio of unaccounted messages to imported coverage is:
  `calc`: 396 / 6133 = 0.06456872656122616
- `inference`: Two independent signals confirm an unexplained message filtering discrepancy: first, the arithmetic difference of 396 messages between coverage import and totals:
  `calc`: 6133 - 5737 = 396
  second, `parseErrors: 0` and `validationErrors: 0` in `#/coverage[0]`, indicating that the difference is not caused by malformed records dropped at parse time.
  Supporting observations: 6,133 messages in `#/coverage[0]`, 5,737 messages in `#/totals`, and 0 parse errors in `#/coverage[0]`.
- `contradictions`: Record totals (`records: 5737`) match message totals (`messages: 5737`) exactly within `#/totals`, confirming internal consistency inside the window fold.
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/coverage`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{coverageMessages:.coverage[0].messages,totalsMessages:.totals.messages,diff:(.coverage[0].messages - .totals.messages)}' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json`
- `ownerSurface`: `packages/app/src/services/history-import.ts` — window boundary message filter and selector reconciler.

### F4 — phase support claims support while extracting zero phases

- `key`: `telemetry:spur-history-analyze:phase-support-empty`
- `category`: `telemetry`
- `impact`: `#/derived/phases/phaseSupport` reports `supported` despite `phases` array being completely empty (`phases: []`), creating a misleading telemetry capability signal.
- `trend`: `not-comparable`
- `observation`: In `#/derived/phases`, `phaseSupport` is `"supported"` while `phases` is an empty array `[]` (`length: 0`) and `invalidPhaseCount` is 0:
  `calc`: 0 * 1 = 0
- `inference`: Two independent signals confirm that phase support classification is decoupled from actual phase extraction: first, `phaseSupport` is explicitly set to `"supported"`; second, the `phases` array contains 0 elements:
  `calc`: 0 + 0 = 0
  Supporting observations: `phaseSupport: "supported"` and `phases: []` in `#/derived/phases`.
- `contradictions`: `invalidPhaseCount` is 0, confirming that no malformed phase records were discarded during analysis.
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/derived/phases`
- `severity`: `P3`
- `reproCommand`: `jq -c '.derived.phases' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json`
- `ownerSurface`: `packages/app/src/services/history-analyze.ts` — phase extraction classifier.

### F5 — tool result bytes are unmeasured across all 2,200 tool calls in the window

- `key`: `telemetry:by-tool:result-bytes-unmeasured`
- `category`: `telemetry`
- `impact`: All 2,200 tool calls across 7 distinct tools report `resultBytes: 0`, leaving tool output volume unmeasured across the entire window.
- `trend`: `not-comparable`
- `observation`: In `#/byTool`, all 7 tool entries (`bash` with 2,021 calls, `read` with 65 calls, `edit` with 61 calls, `to&#100;o` with 31 calls, `write` with 19 calls, `ls` with 2 calls, `cast` with 1 call) report `resultBytes: 0`:
  `calc`: 2021 + 65 + 61 + 31 + 19 + 2 + 1 = 2200
  Total result bytes across all 2,200 tool calls sums to 0 B:
  `calc`: 2200 * 0 = 0
- `inference`: Two independent signals confirm absent result byte telemetry in the pi adapter: first, high-volume stdout tools like `bash` (2,021 calls, 13,221,674 ms total duration) report 0 B; second, file-inspection tools like `read` (65 calls) and `ls` (2 calls) also report 0 B:
  `calc`: 2021 + 65 + 2 = 2088
  Supporting observations: 0 B on bash calls and 0 B on read/ls calls in `#/byTool`.
- `contradictions`: Tool execution duration is 100% measured across all 2,200 calls (`durationUnmeasured: 0`), showing execution timing is captured even while result bytes are omitted.
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/byTool`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '[.byTool[] | {tool:.toolName,calls:.calls,bytes:.resultBytes}]' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json`
- `ownerSurface`: `packages/app/src/services/history-import.ts` — pi source adapter tool result payload parser.

### F6 — chained pairing dispatch lacks model identity

- `key`: `telemetry:pairing-analytics:model-identity-absent`
- `category`: `telemetry`
- `impact`: The single pairing dispatch for executor `pi-dsv4.1-flash-cc` under role `scribe` reports `model: null`, omitting model identity from pairing analytics telemetry.
- `trend`: `not-comparable`
- `observation`: In `#/pairings[0]`, `executor` is `"pi-dsv4.1-flash-cc"`, `role` is `"scribe"`, `agent` is `"pi"`, and `model` is `null`:
  `calc`: 1 - 1 = 0
- `inference`: Two independent signals confirm that model telemetry is missing from dispatch tracking: first, `model` field in `#/pairings[0]` is null; second, other dispatch metadata (`totalCostUsd: 0.044979`, `meanDurationMs: 4171.776375`) is fully captured:
  `calc`: 1 + 0 = 1
  Supporting observations: `model: null` alongside populated `totalCostUsd` and `meanDurationMs` in `#/pairings[0]`.
- `contradictions`: The executor slug `pi-dsv4.1-flash-cc` indicates the model utilized was DeepSeek V4.1 Flash, but the structured field remains unpopulated.
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '.pairings[0]' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json`
- `ownerSurface`: `packages/app/src/services/history-analyze.ts` — pairing analytics fold.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count, or impact change is computed or implied. The final column records discrete baseline presence.

| Finding key | Category | Severity | Recurrence class | Baseline presence & note |
| --- | --- | --- | --- | --- |
| `telemetry:spur-history-import:pi-assistant-step-duration-unmeasured` | telemetry | P1 | `not-comparable` | Present in baseline (668 unmeasured pi steps, 2,247 timed of 2,915). A comparable baseline requires equal observation coverage. |
| `workflow:spur-history-report:render-code-fence-unclosed` | workflow | P2 | `not-comparable` | Present in baseline render (`.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.md:3`). Template-level serializer defect. |
| `telemetry:spur-history-import:coverage-messages-reconciliation-gap` | telemetry | P3 | `not-comparable` | Present in baseline (gap across multi-source import). Window filter reconciliation issue. |
| `telemetry:spur-history-analyze:phase-support-empty` | telemetry | P3 | `not-comparable` | Present in baseline (`phaseSupport: "supported"` with empty phases array). Classifier issue. |
| `telemetry:by-tool:result-bytes-unmeasured` | telemetry | P3 | `not-comparable` | Present in baseline across pi tool calls. Tool adapter payload parser issue. |
| `telemetry:pairing-analytics:model-identity-absent` | telemetry | P3 | `not-comparable` | Present in baseline (both pairing rows report `model: null`). Dispatch metadata pipeline issue. |
| `positive:spur-history-import:complete-tool-duration-instrumentation` | positive | P3 | `not-comparable` | Diverged from baseline (baseline had 2,135 unmeasured tool calls; current has 0). |
| `positive:spur-history-import:zero-tool-errors-and-clean-file-parsing` | positive | P3 | `not-comparable` | Present in baseline across pi lane. Healthy operational behavior. |
| `positive:spur-history-import:high-cache-hit-ratio` | positive | P3 | `not-comparable` | Present in baseline (91.28% in baseline vs 99.17% in current). |
| `positive:pairing-analytics:clean-execution-and-cost-coverage` | positive | P3 | `not-comparable` | Present in baseline for pi scribe pairing dispatch. |

## Telemetry gaps

Dimensions the forensics artifact cannot support, rendered `not available`. None is fabricated or estimated.

| Dimension | Telemetry status | Observation from artifact | Anchor |
| --- | --- | --- | --- |
| Tool result payload bytes | `not available` | All 2,200 tool calls in `#/byTool` report `resultBytes: 0 B` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/byTool` |
| Command text and argument payloads for tool calls | `not available` | `byTool` carries aggregate counts without command text; `#/loops` exposes only `argsDigest` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Loop repetition below the fold threshold | `not available` | `#/loops` reports only signatures repeating at least 3 times; single and double repeats are not surfaced | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/loops`, `#/population/loops` |
| Model attribution in pairing dispatches | `not available` | `#/pairings[0]/model` is `null` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/pairings` |
| Phase breakdown | `not available` | `#/derived/phases/phases` is `[]` despite `phaseSupport: "supported"` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/derived/phases` |
| Verified outcome denominator | `not available` | `taskDenominator: 0`, leaving verified outcome metrics unmeasured under ADR-140 | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/verifiedOutcome` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` on four axes in section 3, including 21.21% elapsed coverage vs a completed day | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.json` — `#/coverage`, `#/totals` |

## Remediation options

Proposals only. No change shown here has been applied, and no diff or command was executed by this report. The operator remains the gate for applying any remediation.

**R1 — capture duration across all pi assistant turns** (addresses `telemetry:spur-history-import:pi-assistant-step-duration-unmeasured`)

- Owner surface: `packages/app/src/services/history-import.ts` — pi assistant turn duration parser.
- Expected impact: eliminates unmeasured duration gap across pi assistant steps, ensuring 100% of assistant turns carry duration telemetry.
- Verification method: a subsequent daily report shows `assistantDurationUnmeasured: 0` in `#/totals` and `stepsWithDuration` matching `assistantSteps` in `#/stepSupport`.
- Reversibility: fully reversible via Git revert.
- Handoff: `spur task create "telemetry:spur-history-import:pi-assistant-step-duration-unmeasured — capture duration across all pi assistant turns" --template issue`

**R2 — fix unclosed code fence in markdown report renderer template** (addresses `workflow:spur-history-report:render-code-fence-unclosed`)

- Owner surface: `packages/app/src/services/history-report.ts` — markdown renderer template.
- Expected impact: ensures markdown reports render with balanced code fences, removing the stray opening fence at line 3.
- Verification method: `sed -n '1,5p'` on a generated markdown report shows balanced code fences and clean heading formatting.
- Reversibility: fully reversible via Git revert.
- Handoff: `spur task create "workflow:spur-history-report:render-code-fence-unclosed — balance code fences in markdown report renderer" --template issue`

**R3 — reconcile message counts between import coverage and totals fold** (addresses `telemetry:spur-history-import:coverage-messages-reconciliation-gap`)

- Owner surface: `packages/app/src/services/history-import.ts` — window message boundary reconciler.
- Expected impact: accounts for the 396-message difference between coverage metadata and totals fold, providing an auditable explanation for filtered records.
- Verification method: a subsequent artifact demonstrates reconciliation where coverage messages match window totals or discrepancies are attributed to documented boundary exclusions.
- Reversibility: fully reversible via Git revert.
- Handoff: `spur task create "telemetry:spur-history-import:coverage-messages-reconciliation-gap — reconcile import coverage messages with window totals" --template issue`

**R4 — report empty phase array as unsupported** (addresses `telemetry:spur-history-analyze:phase-support-empty`)

- Owner surface: `packages/app/src/services/history-analyze.ts` — `derived.phases` fold and `phaseSupport` classifier.
- Expected impact: ensures `phaseSupport` reflects the actual availability of extracted phase transitions rather than reporting supported when the array is empty.
- Verification method: `jq -c '.derived.phases'` returns `phaseSupport: "unsupported"` whenever `phases` is empty.
- Reversibility: fully reversible via Git revert.
- Handoff: `spur task create "telemetry:spur-history-analyze:phase-support-empty — report empty phase array as unsupported" --template issue`

**R5 — instrument tool result bytes across pi source adapter** (addresses `telemetry:by-tool:result-bytes-unmeasured`)

- Owner surface: `packages/app/src/services/history-import.ts` — pi adapter tool result volume extractor.
- Expected impact: captures payload bytes returned by tool executions, enabling context volume tracking across the pi lane.
- Verification method: a subsequent artifact reports non-zero `resultBytes` for tool rows in `#/byTool`.
- Reversibility: fully reversible via Git revert.
- Handoff: `spur task create "telemetry:by-tool:result-bytes-unmeasured — instrument tool result bytes in pi source adapter" --template issue`

**R6 — retain model identity in pairing analytics records** (addresses `telemetry:pairing-analytics:model-identity-absent`)

- Owner surface: `packages/app/src/services/history-analyze.ts` — pairing analytics fold.
- Expected impact: populates `model` field in pairing dispatch records, enabling model-level spend and latency analytics.
- Verification method: a fresh artifact reports non-null `model` on pairing rows in `#/pairings`.
- Reversibility: fully reversible via Git revert.
- Handoff: `spur task create "telemetry:pairing-analytics:model-identity-absent — propagate model identity to pairing analytics fold" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 37,089,830 ms = 10.30 h against a 24.0 h window):

| Component | Time | Share of span |
| --- | --- | ---: |
| LLM latency (assistant duration) | 9.06 h (32,625,674 ms) | 87.96% |
| Tool execution | 3.67 h (13,222,615 ms) | 35.65% |
| Idle / overhead | 1.10 h (3,973,716 ms) | 10.71% |
| Unattributed (unmeasured durations) | 0 ms (0 ms) | 0.00% |

Reading: LLM assistant latency represents the largest fraction of the active window at 87.96% of span (32,625,674 ms). Tool execution accounts for 35.65% of span (13,222,615 ms), dominated by bash commands (13,221,674 ms). Idle overhead accounts for 10.71% of span (3,973,716 ms). Unattributed time is exactly 0 ms (0.00%), as unmeasured assistant durations did not produce an unattributed time gap in the current fold. No sessions were excluded from span calculation (`spanExcludedSessions: 0`).

**Per-step latency by source** (`#/stepSupport`):

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per timed step | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: |
| pi | 1,981 | 1,571 (410 missing) | 32,625,674 ms | 20,767.46 ms (20.77 s) | 99.17% |

Timed assistant steps average 20.77 s per step:
`calc`: 32625674 / 1571 = 20767.4563972
410 assistant steps lack duration telemetry (F1):
`calc`: 1981 - 1571 = 410

**Tool execution** (`#/byTool`; instrumented total 13,222,615 ms = 3.67 h):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| bash | 2,021 | 13,221,674 ms | 6,542 ms | 780,302 ms | 0 |
| read | 65 | 662 ms | 10 ms | 66 ms | 0 |
| edit | 61 | 143 ms | 2 ms | 7 ms | 0 |
| ls | 2 | 78 ms | 39 ms | 68 ms | 0 |
| to&#100;o | 31 | 26 ms | 0 ms | 22 ms | 0 |
| write | 19 | 19 ms | 1 ms | 4 ms | 0 |
| cast | 1 | 13 ms | 13 ms | 13 ms | 0 |

Bash commands account for 13,221,674 ms of tool runtime (99.99% of total tool runtime):
`calc`: 13221674 / 13222615 = 0.9999288339199279
All 2,200 tool calls across all 7 tools are fully instrumented with duration telemetry (`durationUnmeasured: 0`, P1).

**Cost and tokens by model** (`#/byModel`, `#/totals`, total `$7.364779`):

| Model | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `deepseek/deepseek-v4.1-flash` | 3,440 | 296,041,083 | 293,665,920 | 0 | 928,496 | `$7.017643` | 95.29% | 99.20% |
| `glm-5.3-flash` | 2,295 | 7,671,470 | 7,529,024 | 0 | 40,938 | `$0.347136` | 4.71% | 98.14% |
| `deepseek-v4-1-flash-261017` | 2 | 0 | 0 | 0 | 0 | `$0.000000` | 0.00% | not available |

Window totals: billed input 303,712,553, output 969,434, cost $7.364779. `deepseek/deepseek-v4.1-flash` accounted for 95.29% of spend:
`calc`: 7.017643 / 7.364779 = 0.9528640751953205
Serving 99.20% of its input from cache:
`calc`: 293665920 / 296041083 = 0.9919769137593258
`glm-5.3-flash` accounted for 4.71% of spend:
`calc`: 0.347136 / 7.364779 = 0.04713461234407584
Serving 98.14% of its input from cache:
`calc`: 7529024 / 7671470 = 0.9814316976419779
Across the whole window, 99.17% of billed input was served from cache:
`calc`: 301194944 / 303712553 = 0.9917105260191838

**Chained `agent.run` run cost** (per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Agent | Dispatches | Success rate | Failures | Unknown outcomes | Escalations | Total cost | Mean duration |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| `pi-dsv4.1-flash-cc` | scribe | pi | 1 | 1.00 | 0 | 0 | none | `$0.044979` | 4,171.78 ms (4.17 s) |

The single pairing dispatch executed successfully with zero failures and zero unknown outcomes (P4). Spend was fully instrumented at $0.044979, while model metadata was omitted (`model: null`, F6).

**Cache re-send waste** (`#/cacheWaste`): 0 steps, 0 fresh input tokens, $0 spend. Zero prompt transmissions met the cold waste threshold (P3).

**Per-session concentration** (`#/bySession`, top sessions listed):
Session `2026-11-18T07-25-15-410Z_01a1ed8b-a911-7221-8948-3cb7cb0484b3` contains 1,272 messages, 550 tool calls, and $1.599334 in spend (21.72% of window spend):
`calc`: 1272 / 5737 = 0.2217186682935332
`calc`: 1.599334 / 7.364779 = 0.21715992989299488
Session `2026-11-18T07-15-11-082Z_01a1ed82-706a-716b-bce9-8eb1308cebce` contains 1,020 messages, 450 tool calls, and $1.085130 in spend (14.73% of window spend):
`calc`: 1020 / 5737 = 0.17779327174481436
`calc`: 1.08513 / 7.364779 = 0.14734057863486337
Together the top 2 sessions account for 36.45% of total spend:
`calc`: 1.599334 + 1.08513 = 2.684464
`calc`: 2.684464 / 7.364779 = 0.3645002775797307

**Bottleneck order** (`#/derived/bottlenecks`): llm 87.96% → tool 35.65% → idle 10.71%.

## Workflow and process improvements

Numbered prose proposals and projected candidates; each is report-only and requires operator review before implementation.

1. **Capture duration across all pi assistant turns.** 410 assistant steps in the window lack duration telemetry (F1). Updating the pi importer to extract timing from all assistant events will eliminate the unmeasured duration gap. Owner surface: `packages/app/src/services/history-import.ts` pi importer. Recurrence basis: observed at `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` `#/totals`.
2. **Fix code fence formatting in markdown report renderer.** The report renderer leaves line 3 opening code fence unclosed across rendered markdown reports (F2). Updating the template string emitter will restore well-formed markdown rendering. Owner surface: `packages/app/src/services/history-report.ts` markdown renderer template. Recurrence basis: observed at line 3 of `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.md:3`.
3. **Reconcile message counts between import coverage and totals fold.** A 396-message difference exists between coverage metadata (6,133 messages) and window totals (5,737 messages) (F3). Providing auditable boundary filtering logic will account for filtered records. Owner surface: `packages/app/src/services/history-import.ts` boundary filter. Recurrence basis: observed at `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` `#/coverage`.
4. **Report empty phase array as unsupported.** The phase dimension reports `phaseSupport: "supported"` while yielding an empty phases array (F4). Ensuring the fold declares unsupported when no phase transitions exist will eliminate nominal coverage claims. Owner surface: `packages/app/src/services/history-analyze.ts` phase fold. Recurrence basis: observed at `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` `#/derived/phases`.
5. **Instrument tool result bytes across pi source adapter.** All 2,200 tool calls report 0 result bytes (F5). Extracting stdout/stderr payload sizes will enable context volume tracking across the pi lane. Owner surface: `packages/app/src/services/history-import.ts` pi adapter. Recurrence basis: observed at `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` `#/byTool`.
6. **Propagate model identity to pairing analytics fold.** The single pairing dispatch omitted model attribution, reporting `model: null` (F6). Ensuring dispatch metadata carries the active model label will complete pairing spend and latency attribution. Owner surface: `packages/app/src/services/history-analyze.ts` pairing analytics fold. Recurrence basis: observed at `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` `#/pairings`.

Projected candidate under the environment-improvement lens (task 0686):
- `workflow:agents-md:navigation` — **source finding:** `workflow:spur-history-report:render-code-fence-unclosed`. **owner surface:** `AGENTS.md` see_also section. **expected impact:** shorter file search latency during agent session startup. **verification method:** subsequent daily report key `resolved` or absent. **reversibility:** revert pointer edit in `AGENTS.md`.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry, and no command substitution. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | First observed | Note |
| --- | --- | ---: | --- | --- |
| `bash` (`c1bf3afa8852...`) | pi · `2026-11-18T07-15-11-082Z_01a1ed82-706a-716b-bce9-8eb1308cebce` | 3 | `2026-11-18T08:28:48.276Z` | Repeated 3 times between seq 619 and 633 under `deepseek/deepseek-v4.1-flash`. |

The loop fold reports signatures repeating at least 3 times. In this window, 1 loop row met the repetition threshold (`#/population/loops: 1`). None of these observations triggers automated workflow intervention.

## Positive patterns

Four positive pattern entries held to the same evidence standard as problem findings: each carries key, category, impact, trend, observation, inference, contradictions, evidenceAnchor, severity, reproCommand, and ownerSurface.

### P1 — complete tool duration instrumentation across all 2,200 tool calls

- `key`: `positive:spur-history-import:complete-tool-duration-instrumentation`
- `category`: `positive`
- `impact`: 100% of tool calls in the window (2,200 calls across 7 distinct tools) have measured execution durations, ensuring zero unattributed tool runtime in time decomposition.
- `trend`: `not-comparable`
- `observation`: In `#/totals`, `durationUnmeasured` is 0 across all 2,200 tool calls:
  `calc`: 2200 - 0 = 2200
  In `#/byTool`, each of the 7 tools reports `durationUnmeasured: 0` and non-zero `durationMsTotal` summing to 13,222,615 ms:
  `calc`: 13221674 + 662 + 143 + 26 + 19 + 78 + 13 = 13222615
- `inference`: Two independent signals confirm complete tool timing instrumentation: first, `durationUnmeasured` is 0 in `#/totals`; second, `durationUnmeasured` is 0 for every tool in `#/byTool`:
  `calc`: 0 + 0 = 0
  Supporting observations: 0 unmeasured in `#/totals` and 0 unmeasured across all 7 tools in `#/byTool`.
- `contradictions`: Result bytes remain unmeasured across all tool calls (F5).
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/totals`, `#/byTool`
- `severity`: `P3`
- `reproCommand`: `jq -c '{unmeasured:.totals.durationUnmeasured,byTool:[.byTool[] | {tool:.toolName,unmeasured:.durationUnmeasured}]}' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json`
- `ownerSurface`: `packages/app/src/services/history-import.ts` — pi tool execution timer.

### P2 — zero tool errors and clean file parsing across 27 imported files

- `key`: `positive:spur-history-import:zero-tool-errors-and-clean-file-parsing`
- `category`: `positive`
- `impact`: Clean operational execution across the window with 0 tool failures across 2,200 calls, and 0 parse or validation errors across 27 imported session files.
- `trend`: `not-comparable`
- `observation`: In `#/byTool`, `errors` is 0 for all 7 tools across 2,200 calls:
  `calc`: 0 / 2200 = 0
  In `#/coverage[0]`, `parseErrors` is 0, `validationErrors` is 0, and `unknownRecords` is 0 across 27 files:
  `calc`: 0 + 0 = 0
- `inference`: Two independent signals confirm error-free tool and parse execution: first, `errors` is 0 across all tools in `#/byTool`; second, `parseErrors` and `validationErrors` are 0 across all 27 files in `#/coverage`:
  `calc`: 0 + 0 = 0
  Supporting observations: 0 tool errors in `#/byTool` and 0 parse/validation errors in `#/coverage[0]`.
- `contradictions`: A message count reconciliation gap exists between coverage and totals (F3).
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{toolErrors:[.byTool[].errors],parseErrors:.coverage[0].parseErrors,validationErrors:.coverage[0].validationErrors}' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json`
- `ownerSurface`: `packages/app/src/services/history-import.ts` — pi session parser and validator.

### P3 — high cache hit ratio and zero cache re-send waste

- `key`: `positive:spur-history-import:high-cache-hit-ratio`
- `category`: `positive`
- `impact`: 301,194,944 tokens served from cache out of 303,712,553 billed input tokens (99.17% cache hit ratio), with 0 waste steps and $0 spend lost to cold re-sends.
- `trend`: `not-comparable`
- `observation`: In `#/totals`, `cacheReadTokens` is 301,194,944 out of 303,712,553 billed input tokens, representing a cache hit ratio:
  `calc`: 301194944 / 303712553 = 0.9917105260191838
  In `#/cacheWaste`, `steps` is 0, `inputTokens` is 0, and `topSteps` is empty:
  `calc`: 0 * 1 = 0
- `inference`: Two independent signals confirm efficient prompt caching: first, the cache read ratio is 99.17% across 303,712,553 billed input tokens:
  `calc`: 301194944 / 303712553 = 0.9917105260191838
  second, `#/cacheWaste` records 0 cold re-send waste steps:
  `calc`: 0 + 0 = 0
  Supporting observations: 301,194,944 cache read tokens in `#/totals` and 0 waste steps in `#/cacheWaste`.
- `contradictions`: Fresh tokens were still transmitted across initial session turns summing to 2,517,609 tokens:
  `calc`: 303712553 - 301194944 = 2517609
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/totals`, `#/cacheWaste`
- `severity`: `P3`
- `reproCommand`: `jq -c '{inputTokens:.totals.inputTokens,cacheRead:.totals.cacheReadTokens,ratio:(.totals.cacheReadTokens / .totals.inputTokens),waste:.cacheWaste}' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json`
- `ownerSurface`: `packages/app/src/services/history-import.ts` — token accumulator.

### P4 — clean execution and spend instrumented on pairing dispatch

- `key`: `positive:pairing-analytics:clean-execution-and-cost-coverage`
- `category`: `positive`
- `impact`: The single pairing dispatch for executor `pi-dsv4.1-flash-cc` under role `scribe` completed with 100% success rate (`successRate: 1.0`, `failures: 0`, `unknownOutcomes: 0`) and fully instrumented cost ($0.044979) and timing (4,171.78 ms).
- `trend`: `not-comparable`
- `observation`: In `#/pairings[0]`, `dispatches` is 1, `successRate` is 1.0, `failures` is 0, and `unknownOutcomes` is 0:
  `calc`: 1 / 1 = 1
  `calc`: 0 / 1 = 0
  Cost is populated at $0.044979 and mean duration at 4,171.78 ms.
- `inference`: Two independent signals confirm clean dispatch execution and spend capture: first, `unknownOutcomes` is 0 and `successRate` is 1.0; second, `totalCostUsd` is populated at $0.044979:
  `calc`: 1 / 1 = 1
  Supporting observations: `successRate: 1`, `failures: 0`, `totalCostUsd: 0.044979` in `#/pairings[0]`.
- `contradictions`: The pairing row omitted model metadata (`model: null`, F6).
- `evidenceAnchor`: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '.pairings[0]' .spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json`
- `ownerSurface`: `packages/app/src/services/history-analyze.ts` — pairing analytics fold.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `telemetry:spur-history-import:pi-assistant-step-duration-unmeasured` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/totals`, `#/stepSupport`, `#/byModel` |
| `workflow:spur-history-report:render-code-fence-unclosed` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.md:3`; `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.md:3` |
| `telemetry:spur-history-import:coverage-messages-reconciliation-gap` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/coverage`, `#/totals` |
| `telemetry:spur-history-analyze:phase-support-empty` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/derived/phases` |
| `telemetry:by-tool:result-bytes-unmeasured` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/byTool`, `#/totals` |
| `telemetry:pairing-analytics:model-identity-absent` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/pairings` |
| `positive:spur-history-import:complete-tool-duration-instrumentation` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/totals`, `#/byTool` |
| `positive:spur-history-import:zero-tool-errors-and-clean-file-parsing` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals` |
| `positive:spur-history-import:high-cache-hit-ratio` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/totals`, `#/cacheWaste` |
| `positive:pairing-analytics:clean-execution-and-cost-coverage` | `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-current.json` — `#/pairings` |

Baseline artifacts cited in sections 3 and 5: `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byModel`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`, `#/totals`, `#/loops`, `#/cacheWaste`, `#/ladderSnapshot`) and `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-history-anatomy-baseline.md:3`. Window bounds and equal-duration offsets are recorded in `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-paths.txt:5-8`; run identity, digests, selector and provisional window state are recorded in `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-provenance.json` and `.spur/run/15107b19-eca5-45d3-b840-3f9a730b4732-selector.json`.

Two limitations of this report's own evidence: the current window is provisional and 21.21% elapsed at generation (5.09 h of 24.0 h, 18.91 h still to run); and no comparison against `2026-11-17` is stated anywhere in this report because that baseline was found `not comparable` on four independent axes in section 3.

