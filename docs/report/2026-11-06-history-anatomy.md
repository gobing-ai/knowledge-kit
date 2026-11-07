---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-11-06"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-11-06T00:00:00.000-08:00
    until: 2026-11-06T23:59:59.999-08:00
  sources:
    - source: agy
    - source: claude
    - source: codex
    - source: pi
windowState: "provisional"
generatedAt: "2026-11-07T01:40:29.364Z"
validatedAt: "2026-11-07T01:40:29.364Z"
artifactDigest: "dc71d901d9063038cec42d532efd710a57e58bab8f0c0b19b80ccf27785fa040"
baselineArtifactDigest: "fd7b607bba65f329a78fb3550ddb952ed8c6400a0a8d3aa1f6569b86e0edd2f6"
contractDigest: "34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5"
skillDigest: "8235b95aca5968ae89cc990ece51412b3df564099614ae3690963a588be1c0f2"
workflowDigest: "not available"
helperDigest: "655ba1e8600dfe28802c1f151a5f9bbc815408d023beb2c0b465f6bfff45169d"
runId: "f527aa66-bc0b-483e-94f2-da75a84e70c4"
currentArtifactPath: ".spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json"
spurVersion: "not available"
schemaVersion: 1
executor: "coder"
model: "not available"
cacheDisposition: "miss"
coverage:
  - source: agy, status: ok, lastImportedAt: 2026-11-07T00:00:02.123Z
  - source: claude, status: ok, lastImportedAt: 2026-11-06T03:00:02.465Z
  - source: codex, status: ok, lastImportedAt: 2026-11-06T14:00:35.634Z
  - source: pi, status: ok, lastImportedAt: 2026-11-06T21:00:00.867Z
---

> imported snapshot as of 2026-11-06T03:00:02.465Z · window provisional · cache miss

<!-- Candidate authored by sp:history-anatomy enrich · mode daily · run f527aa66-bc0b-483e-94f2-da75a84e70c4 · schema v1 -->

# History forensics report — 2026-11-06 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `f527aa66`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report. No workflow was launched by this operation.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-11-06`, baseline is the immediately preceding local calendar day `2026-11-05` |
| Current window | `2026-11-06T00:00:00.000-08:00` → `2026-11-06T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Baseline window | `2026-11-05T00:00:00.000-08:00` → `2026-11-05T23:59:59.999-08:00` (America/Los_Angeles, 24.0 h) |
| Window offsets | Both windows sit entirely in `-08:00`; the DST fall-back of `2026-11-01` is outside both, so the two windows are equal-duration with identical UTC offsets — read from `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-paths.txt:6-8` |
| Window state | `provisional` for both artifacts. Current generated `2026-11-07T01:40:27.383Z` (`#/generatedAt`), i.e. `17.67` h into the 24.0 h it measures (73.64% elapsed, 6.33 h still to run). Baseline generated `2026-11-07T01:40:28.703Z`, `17.67` h after its own window had fully elapsed — so the baseline day is complete and the current day is not |
| Generated | `2026-11-07T01:40:27.383Z` (current) · `2026-11-07T01:40:28.703Z` (baseline) |
| Toolchain | spur `0.4.25` (artifact `#/spurVersion`) · artifact `schemaVersion` `1` · executor `coder`, model `not available` · contract version `1` |
| Digests | artifact `dc71d901d9063038cec42d532efd710a57e58bab8f0c0b19b80ccf27785fa040` · baseline artifact `fd7b607bba65f329a78fb3550ddb952ed8c6400a0a8d3aa1f6569b86e0edd2f6` · contract `34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5` · skill `8235b95aca5968ae89cc990ece51412b3df564099614ae3690963a588be1c0f2` · helper `655ba1e8600dfe28802c1f151a5f9bbc815408d023beb2c0b465f6bfff45169d` · workflow `not available`. Read from `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-provenance.json` |
| Selector | sources `all` (`agy`, `claude`, `codex`, `pi`), no session/run/task narrowing, leaderboard depth `20` (`#/population/appliedTop`). Read from `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-selector.json` |
| Cache disposition | `miss` — disposition `no-cache`, so the run recomputed (`.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-cache-disposition.txt`) |
| Current artifact | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.md` |
| Path resolution | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-paths.txt` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| agy | ok | 253 | 13,347 | 6,851 | 0 | 0 | 0 | `2026-11-07T00:00:02.123Z` |
| claude | ok | 14 | 1,071 | 174 | 0 | 0 | 0 | `2026-11-06T03:00:02.465Z` |
| codex | ok | 49 | 3,041 | 284 | 0 | 0 | 0 | `2026-11-06T14:00:35.634Z` |
| pi | ok | 10 | 5,650 | 2,395 | 0 | 0 | 0 | `2026-11-06T21:00:00.867Z` |

Population: `96` sessions, `22` tool keys, `92` loop signals, `1` warning, leaderboard depth applied `20` (`#/population`). `#/bySession` is therefore a bounded slice — 20 of 96 — and the rendered summary states exactly that (`Sessions | top 20 of 96`, `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:11`). Those 20 listed sessions hold 6,911 of 22,918 messages (30.16%), 2,423 of 9,704 tool calls (24.97%) and `$26.576348` of `$36.690767` (72.43%) of window cost, leaving 76 unlisted sessions carrying `$10.114419` (27.57%) inside `#/totals` but outside `#/bySession`. `#/byTool` lists 20 of 22 tool keys (`.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:199`), so two tool keys are inside `#/population/tools` and absent from the table; the rows shown account for 9,587 of 9,704 calls (98.79%). `#/loops` (92 rows) and `#/warnings` (1 row) are complete because both are below the applied depth. The step leaderboards (`#/topStepsByTokens`, `#/topStepsByDuration`) hold 20 rows each and are slices of the 9,280 assistant steps in `#/stepSupport`, not population totals.

Import freshness differs by lane and is not interpretable as staleness (`#/coverage`, against `#/generatedAt` `2026-11-07T01:40:27.383Z`): agy is 1.67 h older, pi 4.67 h, codex 11.66 h, claude 22.67 h. Three of those checkpoints fall inside the window they report on; the claude checkpoint (`2026-11-06T03:00:02.465Z`) falls 5.00 h *before* the window start while the same row counts 1,071 in-window messages — an internal contradiction that makes the field unusable as a freshness marker and is finding F5.

## Executive summary

- The measured current window is 96 sessions (top 20 listed), 22,918 messages, 9,704 tool calls, a 41.07 h activity span, `$36.690767` of provider-billed cost, and 270,077,294 billed input tokens at an 89.42% cache-read share. Four sources imported (`agy`, `claude`, `codex`, `pi`) with zero parse errors, zero validation errors and zero unknown records across 326 files.
- The dominant defect is measurement, not workload. 7,310 of 9,704 tool calls (75.33%) carry no duration, and the three untimed lanes are exactly the three whose `#/bySource` duration is 0 — so the `toolMs` bucket (68,080,108 ms, 46.05% of the span) is one lane's measurement (pi) presented as a window total, and 56,473,685 ms (38.20% of span) is explicitly unattributed (`#/warnings/0`).
- The largest lane by volume bills nothing. `agy` carries 13,347 of 22,918 records (58.24%) and 6,851 of 9,704 tool calls (70.60%) with 0 input tokens, 0 cost and 0 measured duration; 2,800 of 22,918 records (12.22%) carry provider usage at all. The one usage-bearing model-`unknown` record (92,473 input tokens, `$0.046783`) is arithmetically inside the codex source row, not agy's (`#/bySource/codex/inputTokens` exceeds its two named models by exactly that amount) — finding F2.
- The claude lane's completeness is not determinable: its checkpoint is 22.67 h older than generation and 29.00 h older than the window's end, but it also falls 5.00 h *before* the window starts while the row counts 1,071 in-window messages — so the field cannot be a run-level freshness marker (F5). The lane's 930 window messages against the baseline's 5,779 are therefore attributable to neither workload nor truncation, and section 3 refuses to read the difference as a change.
- `codex` accumulates 1,025 ms of assistant duration across 334 steps — 3.07 ms per step while its steps bill ~100k input tokens each (`#/topStepsByTokens` rows at 111,113 / 108,479 / 107,490 input with 3 / 1 / 4 ms) — against pi's 4,535.92 ms per step in the same artifact: a 1,478× gap recorded by the same fold, so codex's step durations are timestamp deltas rather than latency (F3).
- The `llmMs` bucket (`12,950,215` ms) exceeds the sum of the per-source assistant durations (`12,253,619` ms) by 696,596 ms (5.38% of the bucket), while the four buckets still sum to the span exactly in this artifact. The baseline artifact fails the same reconciliation in the other direction — its buckets exceed its span by 3,641,238 ms and its shares sum to 100.94% — so bucket-to-component reconciliation is not guaranteed in this series (F4).
- Delegation is the weakest verified axis: claude as reviewer fails 7 of 16 dispatches (43.75%) with 5 resource-exhaustion escalations; `minimax`, the ladder's cheapest entry, fails 6 of 6 scribe dispatches at a 6.2 s mean; the codex-sol reviewer succeeds 34 of 34 (positive P2). Per-pairing cost is populated on 2 of 7 rows, covering 4 of 97 dispatches and `$1.666203` of window cost (F9).
- The value axis is empty again: `taskDenominator` 0, `verifiedResults` 0, every rate `null`, `costCoverage` `{covered: 0, total: 0}` — so 41.07 h and `$36.690767` cannot be priced per verified result (F7).
- Baseline comparison verdict: **`not comparable`**. Window duration and source set align exactly, but four independent axes do not: observation coverage (73.64% elapsed vs a completed day), instrumentation regime (75.33% vs 52.70% of calls untimed; 12.22% vs 22.49% of records with usage), lane and model composition (the claude lane's size and `claude-opus-5-5` absent here), and tool-key composition (22 vs 30 keys). No trend, delta, or percentage is stated against the baseline anywhere in this report, and every finding is classified `not-comparable`.
- The workflow half is healthy where it is measured: zero tool errors across 9,704 calls, zero parse/validation/unknown records across 326 files, `#/bySource` and `#/byModel` both summing to every `#/totals` axis in this artifact, and 0 unknown dispatch outcomes across all 97 dispatches.

## Baseline comparison

**Verdict: `not comparable`.** No trend, no delta, and no percentage is stated against the baseline anywhere in this report. Four independent differences block comparability; the first two axes that *do* align are stated first so the blockers are not overstated.

**Aligning axes (stated, not compared).** Both windows are 24.0 h long with identical `-08:00` offsets — unlike the `2026-11-01`→`2026-11-02` pair of the earlier series, there is no DST asymmetry here (`.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-paths.txt:6-8`). Both artifacts cover the same four source lanes (`agy`, `claude`, `codex`, `pi`), all reporting `status` `ok` with 0 parse errors, 0 validation errors and 0 unknown records (`#/coverage`), and both were generated by spur `0.4.25` with the same contract digest and an identical 25-entry `#/ladderSnapshot`.

1. **Observation coverage is not equal.** The current artifact was generated `17.67` h into the day it measures — 73.64% elapsed, 6.33 h still to run — while the baseline artifact was generated `17.67` h *after* its window had fully elapsed (`#/generatedAt`; window bounds as above). A truncated day against a complete day is materially different observation coverage: any count comparison would systematically understate the current side, and any per-hour rate would divide by two different effective denominators.
2. **Instrumentation regime differs.** The current artifact leaves 7,310 of 9,704 tool calls without a duration (75.33%); the baseline leaves 2,930 of 5,560 (52.70%). The assistant-step axis differs further: 5,971 of 9,280 steps carry no duration here (`#/totals/assistantDurationUnmeasured`) against 1,307 of 6,766 there. The same statistic therefore describes two different measurement populations, so no tool-time or latency figure is like-for-like. The two folds also disagree internally on this axis — the baseline's `#/stepSupport` implies 1,515 untimed steps (6,766 − 5,251) against its `#/totals` 1,307, a 208-step gap, where the current artifact's gap is 3 steps (F4).
3. **Lane and model composition changed.** `#/bySource` messages: agy 13,347 (here) against 2,736 (baseline); claude 930 against 5,779; codex 3,041 against 3,417; pi 5,600 against 6,603. Cost shares move with it — claude `$1.223817` (3.34%) against `$9.591459` (19.31%). `#/byModel` carries `claude-opus-5-5` in the baseline (4,114 messages, `$5.752557`) and not here, where the claude lane is `claude-opus-5` only (799 messages, `$1.223817`). The claude shift cannot be attributed to workload or to truncation: F5 shows the claude lane's freshness field is self-inconsistent (a checkpoint 5.00 h before its own window's start alongside 1,071 in-window messages), so neither explanation is supported by the artifact.
4. **Tool-key composition changed.** `#/population/tools` is 22 here against 30 in the baseline, and the families differ: the baseline carries `mcp__firecrawl-mcp__firecrawl_scrape`, `Monitor`, `followup_task`, `spawn_agent`, `wait_agent`, `list_agents` and a `request_user_input_async` key, none of which appear here; this window introduces `Skill`, `ToolSearch` and `contact_supervisor`. A tool-name distribution over different key sets is not the same statistic, and per-tool latency cannot be paired row-for-row.

Per-axis values, stated as separate facts only:

| Axis | Current artifact | Baseline artifact | Compared? |
| --- | --- | --- | --- |
| Window duration | 24.0 h (`-08:00` both bounds) | 24.0 h (`-08:00` both bounds) | aligned — no DST asymmetry |
| Observation coverage | 73.64% elapsed at generation (17.67 h of 24.0 h) | 100% elapsed, generated 17.67 h after window end | no |
| Sources | `agy`, `claude`, `codex`, `pi` (326 files, all `ok`) | `agy`, `claude`, `codex`, `pi` (133 files, all `ok`) | aligned source set |
| Sessions | 96 (top 20 listed, 30.16% of messages, 72.43% of cost) | 93 (top 20 listed, 39.52% of messages, 50.11% of cost) | no |
| Messages (`#/totals`) | 22,918 | 18,535 | no |
| Tool calls | 9,704 | 5,560 | no |
| Instrumented tool calls | 2,394 of 9,704 (24.67%) | 2,630 of 5,560 (47.30%) | no |
| Records with provider usage | 2,800 of 22,918 (12.22%) | 4,169 of 18,535 (22.49%) | no |
| Assistant steps timed | 3,306 of 9,280 (35.63%) | 5,251 of 6,766 (77.61%) | no |
| Span | 147,837,659 ms (41.07 h) | 385,330,155 ms (107.04 h) | no |
| Cost | `$36.690767` | `$49.673614` | no |
| Billed input / cache share | 270,077,294 at 89.42% cache-read | 413,359,644 at 91.54% | no |
| Tool keys | 22 (20 listed) | 30 (20 listed) | no |
| Loop rows | 92 (85 agy, 5 claude, 2 pi) | 23 (19 agy, 3 claude, 1 pi) | no |
| Pairings / dispatches / costed rows | 7 / 97 / 2 | 5 / 74 / 1 | no |
| Verified outcomes | denominator 0, all rates `null` | denominator 0, all rates `null` | no |

The one same-shape observation both artifacts support — reported as "present in both", never as a change — is the class of structural gaps: `#/derived/phases` is `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}` in both; `#/verifiedOutcome` is all-zero in both; the renders are corrupted identically in both; `#/loops` is dominated by agy rows carrying the same `argsDigest` in both (85 of 92 here, 19 of 23 there); and both artifacts' spans exceed their own 24 h window (41.07 h and 107.04 h). Those are recorded per finding in section 5 as `not-comparable` with a discrete-presence note, not as trends.

## Findings

Twelve problem findings: one P1, six P2, five P3. Every field set is complete; `trend` is `not-comparable` for all of them because the baseline was found `not comparable` in section 3. All commands are reproducible verbatim from the repository root and none was run by this report.

### F1 — 75.33% of tool calls carry no duration, so the tool-time bucket is one lane's measurement

- `key`: `telemetry:spur-history-import:tool-duration-unmeasured`
- `category`: `telemetry`
- `impact`: `toolMs` is 46.05% of the 41.07 h span — the largest measured bucket — but it is computed from 2,394 of 9,704 calls (24.67%), and it equals the pi lane's `durationMs` to the millisecond. The agy lane contributes 6,851 calls (70.60% of all calls) and zero measured milliseconds; codex contributes 284 and claude 174, also zero. Every tool-latency statement and the whole bottleneck ranking therefore describe a quarter of the window, and the 38.20% unattributed bucket is the arithmetic remainder.
- `trend`: `not-comparable`
- `observation`: `#/totals` reports `toolCalls` 9,704 with `durationUnmeasured` 7,310. `#/bySource` reports `durationMs` 0 with `durationUnmeasured` 6,851 (agy), 0 / 174 (claude), 0 / 284 (codex) and 68,080,108 / 1 (pi). `#/byTool` reports `bash` 2,251 calls with `durationMsTotal` 36,252,172 and `durationUnmeasured` 1; `ask_user_question` 3 calls with 31,628,175 ms; and `durationMsTotal` 0 with every call unmeasured for `read_file` (3,690), `run_command` (2,675), `exec` (284), `edit_file` (183), `manage_task` (196), `write_file` (107), `Write` (9), `ToolSearch` (1) and `Skill` (6). `#/derived/timeDecomposition` reports `toolMs` 68,080,108 against `spanMs` 147,837,659, and `#/warnings/0` states that 56,473,685 ms could not be attributed because some durations were unmeasured.
- `inference`: Two independent signals say the bucket is a single-lane measurement rather than a window total. First, `toolMs` equals `#/bySource/pi/durationMs` exactly (68,080,108 on both), so the aggregate is the pi lane by identity. Second, the 7,310 unmeasured calls concentrate in precisely the three lanes whose `durationMs` is 0 — agy, claude and codex — while the only lane with a non-zero value (pi) has 1 unmeasured call. Named observations: the `toolMs`/`bySource/pi` identity, the per-lane `durationMs` 0 with `durationUnmeasured` populated on three lanes, and the explicit `derived-unattributed-time` warning.
- `contradictions`: Partial measurement is not absent measurement: bash has 2,250 of 2,251 calls measured and holds 36,252,172 ms, so tool time does exist in this window — it just is not attributable to the dominant lanes. Tool names do not identify lanes (`bash` is pi's, `run_command` is agy's, `exec` is codex's), so "untimed lane" cannot be inferred from a tool row alone. A `bash` call measured at 2,400,004 ms (40.0 min) also shows the measured subset is not uniform.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/byTool`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:66-68`
- `severity`: `P1`
- `reproCommand`: `jq -c '{calls:.totals.toolCalls,unmeasured:.totals.durationUnmeasured,fullyTimed:([.byTool[]|select(.durationUnmeasured==0)|.calls]|add),bashTimed:(.byTool[]|select(.toolName=="bash")|[.calls,.durationUnmeasured]),perSource:[.bySource|to_entries[]|{s:.key,tools:.value.toolCalls,ms:.value.durationMs,u:.value.durationUnmeasured}],toolMs:.derived.timeDecomposition.toolMs,piMs:.bySource.pi.durationMs,unattributed:.derived.timeDecomposition.unattributedMs,span:.derived.timeDecomposition.spanMs}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the agy, claude and codex lanes' per-tool-call duration emission, consumed by the `byTool` and `derived.timeDecomposition` folds in `spur history analyze`.

### F2 — the agy lane bills nothing, and its one usage-bearing record is attributed to codex

- `key`: `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex`
- `category`: `telemetry`
- `impact`: 13,347 of 22,918 records (58.24%) — the whole agy lane — carry no provider usage, so 58% of the window has no token figure and no cost. The single usage-bearing model-`unknown` record (92,473 billed input, 46,080 cache-read, 78 output, `$0.046783`) is arithmetically inside the codex source row while its 6,851 sibling tool calls are counted on agy, so per-lane cost is both under-attributed (agy at `$0`) and marginally over-attributed (codex by 0.034% of its billed input). Any statement of the form "lane X produced N% of spend" excludes 58% of the records.
- `trend`: `not-comparable`
- `observation`: `#/bySource/agy` reports `records` 13,347 with `recordsWithUsage` 0 and `inputTokens` 0, `cacheReadTokens` 0, `costUsd` 0. `#/byModel/unknown` reports `records` 13,352, `recordsWithUsage` 1, `inputTokens` 92,473, `cacheReadTokens` 46,080, `outputTokens` 78, `costUsd` 0.046783, `toolCalls` 6,851 — the last figure equal to `#/bySource/agy/toolCalls`. `#/bySource/codex` reports `inputTokens` 34,128,981 and `costUsd` 21.139689, while its two named models sum to `1,042,473` + `32,994,035` = `34,036,508` input and `0.71283` + `20.380076` = `21.092906` cost; the differences are exactly `92,473` and `0.046783`.
- `inference`: Two independent signals say the `unknown`-model bucket is agy's record set whose usage lands on the codex row. First, the arithmetic identity: codex's source totals exceed its two named models by exactly the unknown row's input, cache-read and cost, to the unit. Second, the record-count symmetry: the unknown bucket carries 6,851 tool calls, which is agy's tool-call count exactly, while agy's own source row carries the 13,347 records with zero usage. Named observations: the exact codex-minus-models difference, the agy `recordsWithUsage` 0 over 13,347 records, and the 6,851-call equality.
- `contradictions`: Totals reconcile either way — `#/bySource` and `#/byModel` each sum to every `#/totals` axis — so this is an attribution asymmetry, not an arithmetic defect. The magnitude is small: 92,473 of 270,077,294 billed input (0.034%) and `$0.046783` of `$36.690767` (0.13%). One record carrying usage does not establish that the agy adapter reports usage at all, so the split is best read as "one agy record resolved a model the fold could not label"; the confirmation path is to inspect that raw record and compare its model field against the mapping the fold applies.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/bySource/agy`, `#/bySource/codex`, `#/byModel`, `#/totals`
- `severity`: `P2`
- `reproCommand`: `jq -c '{agy:{rec:.bySource.agy.records,use:.bySource.agy.recordsWithUsage,cost:.bySource.agy.costUsd,tools:.bySource.agy.toolCalls},unknown:{rec:.byModel.unknown.records,use:.byModel.unknown.recordsWithUsage,in:.byModel.unknown.inputTokens,cost:.byModel.unknown.costUsd,tools:.byModel.unknown.toolCalls},codexIn:.bySource.codex.inputTokens,namedCodexIn:(.byModel["gpt-6-astra"].inputTokens+.byModel["gpt-6.1-sol"].inputTokens),codexCost:.bySource.codex.costUsd,namedCodexCost:(.byModel["gpt-6-astra"].costUsd+.byModel["gpt-6.1-sol"].costUsd)}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `bySource` / `byModel` joins, specifically model resolution for the agy adapter and source attribution of the residual `unknown` bucket.

### F3 — codex assistant durations are millisecond-scale on 100k-token steps

- `key`: `telemetry:spur-history-import:codex-assistant-duration-implausible`
- `category`: `telemetry`
- `impact`: The `llmMs` bucket is presented as agent latency, but the lane with 57.62% of window cost contributes 1,025 ms across 334 assistant steps — 3.07 ms per step — while its steps bill ~100k input tokens each. So codex latency, tokens-per-second and per-step throughput cannot be stated, and the time decomposition's 8.76% LLM share is dominated by the pi lane's measurement, not by the lane that spent the money.
- `trend`: `not-comparable`
- `observation`: `#/bySource/codex` reports `assistantDurationMs` 1,025 with `assistantDurationUnmeasured` 0. `#/stepSupport` reports codex `assistantSteps` 334 with `stepsWithDuration` 334 and `stepsWithDerivedDuration` 334, against pi 2,379 / 2,368 / 2,368 and claude 298 / 281 / 281. `#/topStepsByTokens` rows are all `gpt-6.1-sol`/codex at `111,113` input / `110,720` cache read / 98 output in `3` ms, `108,479` / `107,776` / 2,461 in `1` ms, `107,490` / `107,008` / 102 in `4` ms, `107,237` / `106,880` / 92 in `3` ms, `105,243` / `104,576` / 1,861 in `2` ms. Per-timed-step means: codex `3.07` ms, claude `1,361.37` ms, pi `4,535.92` ms, agy `3,495.36` ms.
- `inference`: Two independent signals say the codex duration series is derived on a scale that cannot represent a provider round trip. First, the absolute values: a 111k-token prompt completed in 3 ms is below any plausible request/response latency, and the five largest steps in the window cluster at 1–4 ms. Second, the cross-lane contrast within one artifact: 3.07 ms per codex step against 4,535.92 ms per pi step — a 1,478× gap computed by the same fold in the same window. Named observations: the five cited step rows, the per-step means by lane, and the fact that codex has 0 unmeasured step durations (so the defect is not missing data).
- `contradictions`: All lanes report `stepsWithDerivedDuration` equal to `stepsWithDuration` (codex 334/334, pi 2,368/2,368), so the derivation flag does not separate a good series from a bad one — the difference is in each adapter's timestamp semantics. Codex steps are also plausibly finer-grained than pi steps (a streamed step is not a round trip), which would compress per-step duration legitimately; the artifact cannot distinguish granularity from derivation, so the causal claim is labelled a hypothesis with the confirmation path of comparing one codex step's recorded duration against its request/response timestamps in the raw session record.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/bySource/codex`, `#/bySource/pi`, `#/stepSupport`, `#/topStepsByTokens`, `#/derived/timeDecomposition`
- `severity`: `P2`
- `reproCommand`: `jq -c '{codexMs:.bySource.codex.assistantDurationMs,codexSteps:(.stepSupport[]|select(.source=="codex")|.assistantSteps),codexTimed:(.stepSupport[]|select(.source=="codex")|.stepsWithDuration),codexPerStep:(.bySource.codex.assistantDurationMs/(.stepSupport[]|select(.source=="codex")|.stepsWithDuration)),piPerStep:(.bySource.pi.assistantDurationMs/(.stepSupport[]|select(.source=="pi")|.stepsWithDuration)),piSteps:(.stepSupport[]|select(.source=="pi")|.assistantSteps),top:[.topStepsByTokens[0:5][]|{m:.model,it:.inputTokens,cr:.cacheReadTokens,ot:.outputTokens,ms:.durationMs}]}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the codex assistant-step duration derivation, consumed by the `stepSupport` and `derived.timeDecomposition` folds in `spur history analyze`.

### F4 — the time decomposition does not reconcile: `llmMs` exceeds its components

- `key`: `telemetry:spur-history-analyze:time-decomposition-nonreconciling`
- `category`: `telemetry`
- `impact`: The rendered "LLM latency 3.6 h / 9%" (`current.md:65`) has no component-level breakdown in this artifact: `llmMs` is 12,950,215 ms while the per-source assistant durations sum to 12,253,619 ms, so 696,596 ms (5.38% of the bucket) is attributed to LLM time by the bucket and to nothing by the lanes. In the baseline artifact the same reconciliation fails in the opposite direction — its four buckets exceed its own span by 3,641,238 ms, so its shares sum to 100.94% — which means a reader cannot assume any one decomposition balances.
- `trend`: `not-comparable`
- `observation`: `#/derived/timeDecomposition` reports `llmMs` 12,950,215, `toolMs` 68,080,108, `idleMs` 10,333,651, `unattributedMs` 56,473,685 and `spanMs` 147,837,659; the four buckets sum to 147,837,659, exactly the span. `#/totals/assistantDurationMs` is 12,253,619 and equals the sum of the four `#/bySource[].assistantDurationMs` values (1,129,000 agy + 382,544 claude + 1,025 codex + 10,741,050 pi). The baseline artifact reports `llmMs` 19,297,372 against `assistantDurationMs` 14,986,977 (excess 4,310,395), and its four buckets sum to 388,971,393 against `spanMs` 385,330,155 (excess 3,641,238).
- `inference`: Two independent signals, in two artifacts, say the bucket and the rows are computed over different record sets. First, `llmMs` exceeds the per-source assistant-duration total in both artifacts (696,596 ms here, 4,310,395 ms there) — the bucket cannot be the sum of the rows it is displayed beside. Second, the bucket-to-span property holds here but fails in the baseline by 3,641,238 ms, so the residual assignment is not an invariant of the fold. Named observations: the two `llmMs` excesses, the current bucket-sum equality, and the baseline bucket-sum overflow.
- `contradictions`: The current decomposition does balance against the span, so the fold is not uniformly broken — one of the two properties holds on the current artifact. The unmeasured step counts also disagree between folds: `#/stepSupport` implies 5,974 steps without duration (9,280 steps − 3,306 timed) while `#/totals` reports `assistantDurationUnmeasured` 5,971, a 3-step difference that means "unmeasured" itself has two definitions here. A plausible mechanism for both excesses is that `llmMs` includes derived durations from records the per-source fold excludes (the `unknown`-model set of F2); that is a hypothesis with the confirmation path of recomputing `llmMs` from the step rows after excluding the unknown bucket.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/derived/timeDecomposition`, `#/bySource`, `#/totals`, `#/stepSupport`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/derived/timeDecomposition`, `#/totals`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:65`
- `severity`: `P2`
- `reproCommand`: `jq -c '{llm:.derived.timeDecomposition.llmMs,srcAssistant:.totals.assistantDurationMs,llmExcess:(.derived.timeDecomposition.llmMs-.totals.assistantDurationMs),bucketSum:([.derived.timeDecomposition.llmMs,.derived.timeDecomposition.toolMs,.derived.timeDecomposition.idleMs,.derived.timeDecomposition.unattributedMs]|add),span:.derived.timeDecomposition.spanMs,stepGap:(([.stepSupport[].assistantSteps]|add)-([.stepSupport[].stepsWithDuration]|add)),totUnmeasured:.totals.assistantDurationUnmeasured}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `derived.timeDecomposition` fold (its `llmMs` / `idleMs` / `unattributedMs` derivation) and the assistant-duration counters that feed it.

### F5 — the claude lane's import checkpoint is self-inconsistent, so its freshness is not determinable

- `key`: `coverage:spur-history-import:claude-lane-import-stale`
- `category`: `coverage`
- `impact`: The claude lane's freshness cannot be assessed: its recorded `lastImportedAt` is `2026-11-06T03:00:02.465Z`, which is 5.00 h *before* the window it reports on even begins (`2026-11-06T08:00:00Z`), 22.67 h older than generation and 29.00 h older than the window's end — while the same row counts 1,071 messages inside that window with zero parse errors. A per-run checkpoint cannot both precede the window and have imported the window's contents, so neither "the lane is complete" nor "the lane is truncated" is supportable. The consequence is that the claude lane's 930 `#/bySource` messages and 3.34% cost share are of unknown completeness, and its size drop against the baseline (5,779) is attributable to neither workload nor truncation.
- `trend`: `not-comparable`
- `observation`: `#/coverage/1` reports claude `status` `ok`, `files` 14, `messages` 1,071, `toolCalls` 174, `parseErrors` 0, `validationErrors` 0, `lastImportedAt` `2026-11-06T03:00:02.465Z`. The selector window is `2026-11-06T00:00:00.000-08:00` → `2026-11-06T23:59:59.999-08:00` (= `2026-11-06T08:00:00Z` → `2026-11-07T07:59:59.999Z`), and `#/generatedAt` is `2026-11-07T01:40:27.383Z`. The other three lanes record checkpoints *inside* the window: agy `2026-11-07T00:00:02.123Z` (16.00 h after its start), codex `2026-11-06T14:00:35.634Z` (6.01 h after), pi `2026-11-06T21:00:00.867Z` (13.00 h after). The baseline artifact is uniform the other way: all four of its checkpoints lie inside its window and precede its generation by 25.43–32.93 h, its claude row included (`2026-11-05T23:30:01.219Z`, 15.50 h after its window start).
- `inference`: Two independent signals say this field is not a run-level "import ran at" timestamp, so freshness cannot be read from it. First, internal contradiction: a monotonic per-run checkpoint written at `03:00:02.465Z` cannot coexist with 1,071 records from a window that begins 5.00 h later — one of the two figures must mean something other than its name implies. Second, cross-lane and cross-artifact distribution: in this artifact three lanes' checkpoints sit inside the measured window while claude's sits before its start, and in the baseline artifact all four checkpoints sit inside the window yet precede generation by 25.43–32.93 h — a shape consistent with a per-file "last scanned" marker, not a run marker. Named observations: the 5.00 h pre-window checkpoint against the 1,071 in-window messages, the three inside-window lanes here, and the four baseline lanes whose checkpoints sit inside the window yet precede generation by 25 h or more.
- `contradictions`: The lane clearly did import: `status` `ok`, 0 parse errors, 0 validation errors, 1,071 messages. So the defect is the field's meaning, not the import, and a reader who treats `lastImportedAt` as freshness would wrongly conclude truncation — a trap the row's own shape invites. A per-file checkpoint explains every observation at once, but it is one hypothesis among several (the field may be written for a subset of sources, or updated out of order), and the confirmation path is to read the importer's checkpoint write site and compare two consecutive runs of one lane. The baseline's uniform 25 h+ lag also cuts against reading the current value as a new staleness regression.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/coverage`, `#/generatedAt`, `#/selector`, `#/bySource/claude`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/coverage`, `#/generatedAt`, `#/selector`
- `severity`: `P2`
- `reproCommand`: `jq -c '{gen:.generatedAt,windowStart:.selector.since,windowEnd:.selector.until,lane:[.coverage[]|{s:.source,msgs:.messages,tools:.toolCalls,last:.lastImportedAt,status:.status,pe:.parseErrors,ve:.validationErrors}],bySourceClaude:.bySource.claude.messages,covClaude:(.coverage[]|select(.source=="claude")|.messages)}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the claude source lane's run checkpoint and its per-file import coverage accounting.

### F6 — the claude reviewer pairing fails 7 of 16 dispatches and escalates capacity 5 times

- `key`: `reliability:claude-executor:reviewer-dispatch-failures`
- `category`: `reliability`
- `impact`: 7 failed reviewer dispatches out of 16 (43.75%) is rework, not latency: a reviewer lane that fails nearly half its dispatches forces a re-dispatch or an unsanctioned review, and 5 of those failures escalate as `resource-exhaustion`, naming capacity as the mechanism. The lane is the ladder's most expensive tier (`capable-3`, order 24), so failures land on the costliest path — and the same lane failed 8 of 21 in the baseline window, so this is a standing property rather than a one-day incident.
- `trend`: `not-comparable`
- `observation`: `#/pairings` row (`executor` `claude`, `role` `reviewer`, `agent` `claude`, `model` `null`) reports `dispatches` 16, `successRate` 0.5625, `failures` 7, `unknownOutcomes` 0, `escalations` `{"resource-exhaustion": 5}`, `totalCostUsd` `null`, `meanDurationMs` 91,451.47. `#/ladderSnapshot` places `claude` at order 24, tier `capable-3`. The baseline artifact's corresponding row reports `dispatches` 21, `successRate` 0.61905, `failures` 8, `escalations` `{"resource-exhaustion": 4}`, `meanDurationMs` 172,792.01.
- `inference`: Two independent signals point at capacity rather than at an intermittent bug. First, 7 of 16 failures with 5 escalated as `resource-exhaustion` — a majority of the failures carry the same capacity class. Second, the same lane fails at a comparable rate in the baseline artifact (8 of 21, 38.10%) with the same escalation class, so the behaviour repeats across two independent windows. Named observations: the current failure and escalation counts, the baseline failure and escalation counts, and the ladder position.
- `contradictions`: The counts do not reduce to one mechanism: 7 failures against 5 escalations leaves 2 failures with no escalation class, so not every failure is capacity. `successRate` semantics around escalation are also unresolved — the codex-sol reviewer row records 6 `resource-exhaustion` escalations at `successRate` 1.0, so an escalation can coexist with a recorded success, which means any failure share computed from `successRate` alone under-describes escalation pressure. `totalCostUsd` is `null`, so the cost of re-dispatch is `not available` here.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/pairings`
- `severity`: `P2`
- `reproCommand`: `jq -c '[.pairings[]|{e:.executor,r:.role,a:.agent,d:.dispatches,sr:.successRate,f:.failures,esc:.escalations,ms:.meanDurationMs,c:.totalCostUsd}]' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: the `claude` executor ladder entry (`#/ladderSnapshot`, order 24, tier `capable-3`) and the resource policy of the agent-dispatch path that escalates it.

### F7 — no task entered the verified-outcome fold, so the value axis is empty

- `key`: `coverage:spur-task-check:verified-outcome-absent`
- `category`: `coverage`
- `impact`: The only dimension that ties agent activity to verified work contributes nothing: `taskDenominator` 0 makes `verifiedRate`, `verifiedWithoutCorrectionRate`, `correctionRate`, `timeToVerified` and `measuredTokensPerVerifiedResult` all `null`, with `costCoverage` `{covered: 0, total: 0}`. The report can describe 41.07 h and `$36.690767` but cannot state that any of it produced a verified result, so cost per verified result — the metric that would rank every other finding by value — is not computable for this window. The baseline reports the identical all-zero shape, so the axis has now been empty across both windows of this run.
- `trend`: `not-comparable`
- `observation`: `#/verifiedOutcome` reports `taskDenominator` 0, `verifiedResults` 0, `verifiedRate` `null`, `verifiedWithoutCorrection` 0, `verifiedWithoutCorrectionRate` `null`, `correctionCount` 0, `correctionRate` `null`, `retryExhaustedCount` 0, `measuredTokensPerVerifiedResult` `null`, `timeToVerified` `{count: 0, meanMs: null, maxMs: null}`, `costCoverage` `{covered: 0, total: 0}`, and every `excludedReasons` bucket 0 (`notDone`, `forcedDone`, `missingVerdict`, `syntheticVerdict`, `verdictNotPass`, `proofAbsent`, `certifyingRunFailed`).
- `inference`: A zero denominator combined with all-zero exclusion buckets means no task was in scope for the fold at all — a scope gap, not a failed verdict, which would instead populate a named bucket. Named observations: the zero `taskDenominator`, the all-zero `excludedReasons`, and the zeroed `costCoverage` that follows from both.
- `contradictions`: The window plainly contains task-shaped work — `manage_task` 196 calls, `to&#100;o` 19 calls and 9,704 tool calls overall — so activity exists that the fold does not see. The artifact carries no field explaining why the denominator is 0, so "tasks created after the fold's snapshot" and "tasks not joined to a verdict" cannot be distinguished. Because the baseline is also all-zero, the failure is not specific to this window.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`, `#/totals`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/verifiedOutcome`
- `severity`: `P2`
- `reproCommand`: `jq -c '.verifiedOutcome|{den:.taskDenominator,verified:.verifiedResults,rate:.verifiedRate,excluded:.excludedReasons,cost:.costCoverage,ttv:.timeToVerified}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur task check` — the verification gate whose PASS proof the `verifiedOutcome` fold reads — together with that fold's task-window join in `spur history analyze`.

### F8 — the ladder's cheapest entry fails 6 of 6 scribe dispatches in ~6 seconds

- `key`: `reliability:minimax-executor:scribe-dispatch-failure-total`
- `category`: `reliability`
- `impact`: `minimax` is `#/ladderSnapshot` order 0, tier `cheap` — the first entry any ladder walk tries — and it fails 6 of 6 scribe dispatches with a mean duration of 6,180.44 ms (6.2 s) and no recorded cost. Every dispatch fails in the time an unreachable endpoint or a rejected request takes, so the entry produces no work while still consuming dispatch attempts; the fallback that eventually succeeds is then unaccounted for in the pairing fold.
- `trend`: `not-comparable`
- `observation`: `#/pairings` row (`executor` `minimax`, `role` `scribe`, `agent` `pi`, `model` `null`) reports `dispatches` 6, `successRate` 0, `failures` 6, `unknownOutcomes` 0, `escalations` `{}`, `totalCostUsd` `null`, `meanDurationMs` 6,180.44. `#/ladderSnapshot[0]` is `{"name": "minimax", "tier": "cheap", "order": 0}`. The other scribe rows are `codex-sol` (16 dispatches, `successRate` 0.875, `failures` 2, `meanDurationMs` 66,441.00, cost `null`) and `pi-dsv4.1-flash-volc` (1 dispatch, `successRate` 1, `meanDurationMs` 62,750.81, `totalCostUsd` 0.087659).
- `inference`: Two independent signals say the entry is unavailable or misconfigured rather than slow or weak. First, the failure rate is total (6 of 6) with 0 unknown outcomes, so the attempts reached a terminal failure state every time. Second, the mean duration is roughly an order of magnitude below the working scribe rows (6,180 ms against 66,441 and 62,750 ms), i.e. the dispatches end almost immediately instead of completing work. Named observations: the 6-of-6 failure count, the 6.2 s mean against the two working scribes' means, and the absent cost on a row whose successful peer carried `$0.087659`.
- `contradictions`: The baseline artifact has no `minimax` row at all, so this cannot be classified as new or recurring under a not-comparable baseline. Its `claude` scribe row failed 1 of 1 at 5,126.22 ms — the same fail-fast shape on a different executor — which suggests the class is broader than this entry. Six failures could also be six attempts of one logical dispatch rather than six independent dispatches, since the fold exposes no dispatch timestamps.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '{rows:[.pairings[]|select(.role=="scribe")|{e:.executor,a:.agent,d:.dispatches,sr:.successRate,f:.failures,ms:.meanDurationMs,c:.totalCostUsd}],ladder0:.ladderSnapshot[0]}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: the `minimax` ladder entry (`#/ladderSnapshot`, order 0, tier `cheap`) and the dispatch configuration of its pi-agent scribe pairing.

### F9 — the pairing fold prices 2 of 7 rows, covering 4% of dispatches

- `key`: `coverage:pairing-analytics:cost-coverage-partial`
- `category`: `coverage`
- `impact`: Per-stage cost is the one number that makes a chained `agent.run` stage comparable to its alternatives. Here 2 of 7 pairing rows carry `totalCostUsd` — `$1.666203`, which is 4.54% of the `$36.690767` window total — and those two rows cover 4 of 97 dispatches (4.12%). `model` is `null` on all 7 rows, so no stage cost or duration is attributable to a model through this fold, and 95.9% of dispatches have no cost at all.
- `trend`: `not-comparable`
- `observation`: `#/pairings` rows: `agy-gemini` reviewer 21 dispatches `successRate` 0.95238, cost `null`, `meanDurationMs` 340,117.45; `claude` reviewer 16 / 0.5625, cost `null`, 91,451.47; `codex-sol` reviewer 34 / 1.0, cost `null`, 143,972.43; `codex-sol` scribe 16 / 0.875, cost `null`, 66,441.00; `minimax` scribe 6 / 0, cost `null`, 6,180.44; `pi-dsv4.1-flash-volc` reviewer 3 / 0.66667, cost `1.578544`, 1,793,281.55; `pi-dsv4.1-flash-volc` scribe 1 / 1.0, cost `0.087659`, 62,750.81. Every row reports `dispatches` and `meanDurationMs`; `model` is `null` on all 7. The baseline's 5 rows cost 1 of 5 (`pi-dsv4.1-flash-volc` reviewer `$0.491388`, 0.99% of its `$49.673614`), covering 1 of 74 dispatches.
- `inference`: Two independent signals say the missing field is a cost join, not dispatch accounting. First, the split is exact by `agent`: both costed rows are `agent` `pi` (via `pi-dsv4.1-flash-volc`), and all five rows with `agent` `claude`, `antigravity-cli` or `codex` are `null` — a per-agent population pattern rather than random absence. Second, duration and dispatch counts are populated on 7 of 7 rows, so the rows themselves are complete; only the cost and model joins fail. Named observations: the 2-of-7 costed split by agent, and the 7-of-7 populated durations and dispatch counts.
- `contradictions`: The two costed rows are inconsistent with each other in a way cost alone cannot explain: the reviewer row costs `$1.578544` across 3 dispatches with 1 failure at a 1,793,281 ms mean, while the scribe row costs `$0.087659` for 1 successful dispatch at 62,750 ms — a 28.6× duration gap and a 18× cost-per-dispatch gap on one executor. `null` is the contract-correct rendering of an absent signal, so the fold is not fabricating; but with a 4.54% cost coverage no share-of-window statement about stages is supportable.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/pairings`, `#/totals/costUsd`
- `severity`: `P3`
- `reproCommand`: `jq -c '{dispatches:([.pairings[].dispatches]|add),failures:([.pairings[].failures]|add),rows:(.pairings|length),costed:([.pairings[]|select(.totalCostUsd!=null)]|length),costedDispatches:([.pairings[]|select(.totalCostUsd!=null)|.dispatches]|add),costSum:([.pairings[].totalCostUsd|select(.!=null)]|add),day:.totals.costUsd,models:[.pairings[].model]}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: the pairing analytics fold's cost and model joins in `spur history analyze`.

### F10 — the loop fold's argument digest is `sha256(null)` on 85 of 92 rows

- `key`: `telemetry:spur-history-analyze:loop-args-digest-null`
- `category`: `telemetry`
- `impact`: 85 of 92 loop rows belong to the agy lane and all carry the identical `argsDigest` beginning `74234e98afe7498fb5daf1f36ac2d78a…`, which is `sha256` of the literal JSON `null`. The fold reports "1,002 repeats of `read_file`" and "992 repeats of `run_command`" where what it has is 1,002 and 992 calls whose arguments were never captured. An operator therefore cannot separate genuine repetition from a missing digest — which is precisely the signal section 10 exists to surface, and precisely what F1's untimed lane also cannot supply.
- `trend`: `not-comparable`
- `observation`: `#/loops` holds 92 rows: 85 agy, 5 claude, 2 pi. The 85 agy rows share the digest prefix `74234e98afe7498fb5daf1f36ac2d78a…` and carry `model` `unknown`; the largest report `repeats` 1,002 (`read_file`, session `6984f444-c058-4bee-93ef-9524bc445e10`), 992 (`run_command`, same session) and 183 (`edit_file`, same session), and the repeats across those 85 rows sum to 6,851 — equal to `#/bySource/agy/toolCalls` 6,851. The 7 non-agy rows carry distinct digests (`b8c3f0bdcaf7…`, `305c9903dc43…`, `f4e7caf72634…`, `fb1718be0562…`, `78e27b7e18c3…` on claude; `2b4dca5be8ba…`, `b51948b65b3a…` on pi) and their repeats sum to 35 against 174 claude and 2,395 pi tool calls. The baseline artifact repeats the shape: 19 of 23 rows share the same `74234e98afe7498fb5daf1f36ac2d78a…` prefix and their repeats sum to 1,366, equal to its `#/bySource/agy/toolCalls` 1,366.
- `inference`: Three signals say the digest is the fold's repetition key and that a null digest collapses a whole lane into one signature. First, the constant equals `sha256` of JSON `null`, so it is an absent-argument marker rather than a command identity. Second, the agy rows partition agy's calls exactly — repeats sum to the lane's tool calls in both artifacts (6,851 here, 1,366 there), so no agy call was excluded as a singleton. Third, lanes with real digests do exclude singletons (claude 29 repeats of 174 calls, pi 6 of 2,395), so the singleton filter keys on the digest. Named observations: the `sha256(null)` identity, the two exact repeats-to-calls equalities, and the two lanes that do exclude singletons.
- `contradictions`: The 85 rows are not one signature: they are grouped per session and tool, and 28 of them report `firstSeq` equal to `lastSeq`, so session and tool grouping does work and only the argument component is missing. Within a session, a 1,002-repeat row may still reflect genuine repetition of an unknown command — the artifact cannot say which, so the rows are neither proof of repetition nor proof of its absence. The same constant also appears on `model` `unknown` rows exclusively, so the missing argument and the missing model may share one adapter gap rather than being two defects.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/loops`, `#/population/loops`, `#/bySource/agy`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/loops`
- `severity`: `P3`
- `reproCommand`: `jq -c '{rows:(.loops|length),bySource:(.loops|group_by(.source)|map({s:.[0].source,n:length,repeats:([.[].repeats]|add)})),digests:(.loops|group_by(.argsDigest)|map({d:.[0].argsDigest[0:16],n:length,repeats:([.[].repeats]|add)})|sort_by(-.n)[0:4]),agyCalls:.bySource.agy.toolCalls}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the loop fold's `argsDigest` derivation and singleton filter as fed by the agy adapter.

### F11 — the flagged cache-waste rows carry 9.9% of a lane's cost on 0.63% of its input

- `key`: `telemetry:spur-history-analyze:per-step-cost-basis-mismatch`
- `category`: `telemetry`
- `impact`: `#/cacheWaste` flags 13 steps in one session carrying `1,387,570` fresh input tokens and `$1.417755` of cost. Those 13 rows are 0.63% of the pi lane's billed input but 9.90% of its `$14.327261` cost, and their implied rate (`$1.0080` per 1M input) is 15.6× the lane's own rate (`$0.0648` per 1M). So cache-waste *cost* cannot be read off these rows: the per-step `costUsd` and the lane aggregate are not on one pricing basis, and any "cost of the waste" figure derived from them would be wrong by an order of magnitude.
- `trend`: `not-comparable`
- `observation`: `#/cacheWaste` reports `steps` 13, `inputTokens` 1,387,570, and 13 `topSteps` rows, all `model` `glm-5.3-flash`, all in session `2026-11-05T20-14-59-915Z_01a1ad59-b54a-70fd-99b4-983fe28a972b`, with `inputTokens` `110,997` / `110,393` / `107,893` … and `cacheReadTokens` 0 (0.0% reuse), `costUsd` `0.111887` / `0.112663` / `0.108333` …, `durationMs` 4,216 / 1,540 / 5,061. `#/bySource/pi` reports `inputTokens` 221,244,812 and `costUsd` 14.327261. The baseline artifact reports the same pattern: `steps` 28, `inputTokens` 2,981,307 (1.27% of its lane's `235,251,769` input) with its 20 listed rows summing to `$2.185022` (12.5% of its `glm-5.3-flash` cost `$17.470136`).
- `inference`: Two independent arithmetic signals say the two figures use different bases. First, the implied per-token rate of the flagged rows (`$1.0080` per 1M input, from `0.111887` over `110,997` tokens) is 15.6× the lane rate (`$0.0648` per 1M billed input, from `14.327261` over `221,244,812`). Second, the cost share of those rows (9.90%) is 15.7× their input share (0.63%) — the same factor from an independent ratio, which is what a per-request fixed component would produce. Named observations: the implied per-row rate, the lane rate, and the two shares.
- `contradictions`: The filter selects on size and coldness by construction (input > 100,000 and reuse < 10%), so it samples exactly the largest, coldest steps — a per-step fixed cost is necessarily over-represented in any share computed from that sample, which weakens the "mismatch" reading. The rows also carry no `cacheWriteTokens`, so part of a pricing explanation may be a missing field rather than a different basis. The mechanism is a hypothesis with a stated confirmation path: compare one flagged row's provider usage record against the lane's aggregate rate before drawing a cost-of-waste conclusion.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/cacheWaste`, `#/bySource/pi`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/cacheWaste`, `#/bySource/pi`
- `severity`: `P3`
- `reproCommand`: `jq -c '{steps:.cacheWaste.steps,flaggedIn:.cacheWaste.inputTokens,flaggedCost:([.cacheWaste.topSteps[].costUsd]|add),laneIn:.bySource.pi.inputTokens,laneCost:.bySource.pi.costUsd,inShare:(.cacheWaste.inputTokens/.bySource.pi.inputTokens),costShare:(([.cacheWaste.topSteps[].costUsd]|add)/.bySource.pi.costUsd),rowRate:(.cacheWaste.topSteps[0].costUsd/(.cacheWaste.topSteps[0].inputTokens/1000000)),laneRate:(.bySource.pi.costUsd/(.bySource.pi.inputTokens/1000000))}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `cacheWaste` fold's per-step `costUsd` derivation and its relationship to the `bySource` aggregates.

### F12 — both renders open with a duplicated title inside an unclosed code fence

- `key`: `workflow:spur-history-report:render-title-corrupted`
- `category`: `workflow`
- `impact`: Both rendered artifacts open with a broken header — a bare opening fence followed by a self-overlapping title — and the fence is never closed, so all 211 lines of the current render sit inside one code block. Any consumer that parses the markdown header, links the first line, renders the file, or diffs renders across days sees a corrupted and unstable document. Low blast radius, deterministic, and it degrades the artifact operators read directly.
- `trend`: `not-comparable`
- `observation`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:3` is a bare opening fence and `:4` reads `# History forensics report — generated 2026-11-07T01:2# History forensics report — generated 2026-11-07T01:40:27.383Z`; the file contains exactly one line matching `^```` ``` across its 211 lines, so the fence never closes. `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.md:3-4` is corrupted identically with its own timestamp `2026-11-07T01:40:28.703Z`, and holds one such line across 219 lines.
- `inference`: The shared `…T01:4` prefix before the complete title indicates the header writer emits the timestamp plus a truncated title and then the full title — one renderer path, not per-artifact damage, since the same malformation appears in two independently rendered files with only the timestamp differing. Named observations: the identical malformation at lines 3–4 of two separately rendered files, the truncated-prefix-then-full-title shape, and the single unclosed fence in each.
- `contradictions`: The artifact JSON is unaffected — `#/generatedAt` is well formed in both (`2026-11-07T01:40:27.383Z`, `2026-11-07T01:40:28.703Z`) — so the defect is confined to the markdown renderer and contaminates no computed value in this report. That the title truncation and the missing closing fence share one cause is a hypothesis resting on one signal (their co-location in the same writer), with the confirmation path of inspecting the renderer's header and footer emitters.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:3-4`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.md:3-4`
- `severity`: `P3`
- `reproCommand`: `sed -n '1,5p' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md; grep -c '^```' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md; wc -l .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md`
- `ownerSurface`: `spur history report` — the markdown header and fence writer used by `--mode forensics`.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count or impact change is computed or implied. The final column records only whether the same signal class is discretely present in the baseline artifact (an observation about two artifacts, not a measured change) and what a comparable baseline would need.

| Stable key | Recurrence class | Severity now | Discrete baseline presence and what a comparable baseline would need |
| --- | --- | --- | --- |
| `telemetry:spur-history-import:tool-duration-unmeasured` | `not-comparable` | P1 | Same class present at a different scale: the baseline leaves 2,930 of 5,560 calls unmeasured (52.70%), with `durationMs` 0 on the agy, claude and codex lanes and 95,646,039 ms on pi. A comparable baseline needs equal elapsed coverage, the same lanes, and a comparable instrumentation regime. |
| `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex` | `not-comparable` | P2 | Partly present: the baseline's agy lane is also usage-less (0 of 2,736 records with usage, `$0` cost), and its `#/byModel/unknown` carries 0 tokens and 0 cost — so the occupancy of the unknown bucket exists there without the usage-bearing record that produces the codex-side split. A comparable baseline needs a usage-bearing unknown record in the same window. |
| `telemetry:spur-history-import:codex-assistant-duration-implausible` | `not-comparable` | P2 | Same class present at the same scale: baseline codex `assistantDurationMs` 1,111 over `#/stepSupport` 369 steps (3.01 ms per step) with 369 of 369 derived, and `#/topStepsByTokens` rows at ~100k input in 2–4 ms. A comparable baseline needs the same codex lane so the derivation can be read twice. |
| `telemetry:spur-history-analyze:time-decomposition-nonreconciling` | `not-comparable` | P2 | Same class present, worse in the other direction: baseline `llmMs` 19,297,372 exceeds `assistantDurationMs` 14,986,977 by 4,310,395 and its four buckets exceed `spanMs` 385,330,155 by 3,641,238 (shares sum to 100.94%), while the current buckets sum to the span exactly. A comparable baseline needs a fold whose bucket and row derivations agree in both windows. |
| `coverage:spur-history-import:claude-lane-import-stale` | `not-comparable` | P2 | Present in kind, absent in the specific contradiction: the baseline's four checkpoints all lie inside its own window (claude `2026-11-05T23:30:01.219Z`, 15.50 h after its window start) and precede generation by 25.43–32.93 h, so the field lags there too — but no baseline row places a checkpoint before its own window's start. A comparable baseline needs checkpoints with the same semantics in both windows. |
| `reliability:claude-executor:reviewer-dispatch-failures` | `not-comparable` | P2 | Same class present: baseline `claude` reviewer 21 dispatches at `successRate` 0.61905 with 8 failures and `{"resource-exhaustion": 4}`. Two independent windows, one lane, one mechanism — recorded as presence, not as a failure-rate change. |
| `coverage:spur-task-check:verified-outcome-absent` | `not-comparable` | P2 | Same class present: baseline `#/verifiedOutcome` also reports `taskDenominator` 0, every `excludedReasons` bucket 0, `costCoverage` `{covered: 0, total: 0}` and all rates `null`. |
| `reliability:minimax-executor:scribe-dispatch-failure-total` | `not-comparable` | P3 | Absent: the baseline has no `minimax` row in `#/pairings`; its closest shape is `claude` scribe 1 of 1 failed at 5,126.22 ms. A comparable baseline needs the same ladder entries dispatched in both windows. |
| `coverage:pairing-analytics:cost-coverage-partial` | `not-comparable` | P3 | Same class present at a lower coverage: baseline costs 1 of 5 rows (`$0.491388`, 0.99% of its window cost, 1 of 74 dispatches) against 2 of 7 rows here (4.54%, 4 of 97). Both windows leave `model` `null` on every row. |
| `telemetry:spur-history-analyze:loop-args-digest-null` | `not-comparable` | P3 | Same class present: 19 of 23 baseline rows carry the `74234e98afe7498fb5daf1f36ac2d78a…` prefix and their repeats sum to 1,366, equal to baseline agy tool calls. A comparable baseline needs an adapter that emits real argument digests. |
| `telemetry:spur-history-analyze:per-step-cost-basis-mismatch` | `not-comparable` | P3 | Same class present: baseline `#/cacheWaste` flags 28 steps carrying 2,981,307 tokens (1.27% of its lane input) whose 20 listed rows sum to `$2.185022` (12.5% of its `glm-5.3-flash` cost). A comparable baseline needs the per-step cost basis documented or reconciled in both windows. |
| `workflow:spur-history-report:render-title-corrupted` | `not-comparable` | P3 | Same class present: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.md:4` is corrupted identically and holds one unclosed fence across 219 lines. Two independently rendered files with a `file:line` anchor satisfy the recurrence rule for a process improvement. |
| `positive:spur-history-import:clean-import-and-tool-runs` | `not-comparable` | P3 | Same class present: both baseline `#/coverage` rows (4 sources) report `parseErrors` 0, `validationErrors` 0 and `unknownRecords` 0, and every baseline `#/byTool[].errors` is 0 over 5,560 calls. Presence, not a counted change. |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `not-comparable` | P3 | Same class present: baseline `codex-sol` reviewer 30 dispatches at `successRate` 1 with 0 failures, and `unknownOutcomes` 0 on all 5 rows, against 34 dispatches at 1 here. Each figure is its own artifact's value and is not subtracted. |
| `positive:spur-history-import:pi-complete-measurement-axis` | `not-comparable` | P3 | Same class present: baseline pi `assistantSteps` 2,634 with `stepsWithUsage` 2,635, `stepsWithDuration` 2,603, `stepsWithCacheRead` 2,634, 4 unmeasured tool calls of 2,634, and 94.35% cache reuse at `$0.0753` per 1M billed input. |
| `positive:spur-history-analyze:source-and-model-folds-sum-to-totals` | `not-comparable` | P3 | Same class present: the baseline's `#/bySource` and `#/byModel` also sum to its `#/totals` on every axis checked (messages, tool calls, input, output, cache read, cost). Its `#/derived/timeDecomposition` fails the analogous check, which is why the positive is scoped to the source and model folds. |

## Telemetry gaps

Dimensions the artifact cannot support. Each renders `not available`; none is inferred from a raw history file.

| Dimension | Rendering | Why | Anchor |
| --- | --- | --- | --- |
| Duration for 7,310 of 9,704 tool calls | `not available` | Three lanes report `durationMs` 0 with populated `durationUnmeasured` (agy 6,851, claude 174, codex 284); only pi is timed | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/byTool`, `#/bySource`, `#/totals` |
| Provider usage on 20,118 of 22,918 records | `not available` | `#/totals/recordsWithUsage` 2,800 of 22,918 (12.22%); agy 0 of 13,347, codex 263 of 3,041, claude 157 of 930, pi 2,380 of 5,600 — so per-record token attribution has no denominator | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/totals`, `#/bySource` |
| Token and cost attribution for the agy lane | `not available` | `#/bySource/agy` is 0 on every token axis and 0 cost over 13,347 records; the only usage-bearing leftover sits in `#/byModel/unknown` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/bySource/agy`, `#/byModel/unknown` |
| Codex per-step assistant latency | `not available` | 1,025 ms over 334 steps with 100k-token prompts recorded at 1–4 ms; the series cannot represent provider round trips | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/bySource/codex`, `#/stepSupport`, `#/topStepsByTokens` |
| Component breakdown of `llmMs` | `not available` | `llmMs` 12,950,215 exceeds `assistantDurationMs` 12,253,619 by 696,596 ms, so 5.38% of the bucket has no per-source row | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/derived/timeDecomposition`, `#/bySource` |
| Agreement between step-level and total unmeasured counts | `not available` | `#/stepSupport` implies 5,974 unmeasured steps (9,280 − 3,306) against `#/totals` `assistantDurationUnmeasured` 5,971 — a 3-step disagreement between two folds | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/stepSupport`, `#/totals` |
| Message-count reconciliation between `#/coverage` and `#/bySource` | `not available` | `#/coverage` sums to 23,109 messages against `#/totals` 22,918; the difference sits in claude (1,071 vs 930) and pi (5,650 vs 5,600), so neither count is a per-lane population total | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/coverage`, `#/bySource`, `#/totals` |
| Two of 22 tool keys | `not available` | `#/population/tools` 22 against `#/byTool` 20 rows; the listed rows cover 9,587 of 9,704 calls (98.79%) | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/population`, `#/byTool` |
| Result bytes for the untimed lanes | `not available` | `resultBytes` is non-zero only on four claude rows (312,189 + 1,742 + 868 + 216 bytes); every agy, codex and pi tool row reports 0 bytes | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/byTool` |
| Tool command and argument text | `not available` | `byTool` carries no command field; `#/loops` exposes only `argsDigest`, which is `sha256(null)` on 85 of 92 rows (`model` `unknown`) | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Loop repetition below the fold's threshold | `not available` | `#/loops` reports only signatures repeating at least 3 times; single and double repeats are not surfaced, and with a null digest the threshold cannot be interpreted | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/loops`, `#/population/loops` |
| Per-session detail beyond the top 20 | `not available` | `#/population/sessions` 96 against `appliedTop` 20; 76 sessions and `$10.114419` (27.57% of cost) have no per-session row | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/population`, `#/bySession`, `#/totals` |
| Per-pairing cost and model | `not available` | `totalCostUsd` `null` on 5 of 7 rows; `model` `null` on all 7 rows | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/pairings` |
| Verified-rate, correction-rate, time-to-verified, tokens per verified result | `not available` | `taskDenominator` 0; every rate field `null` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/verifiedOutcome` |
| Per-phase breakdown | `not available` | `phaseSupport` `supported` with an empty `phases` array and `invalidPhaseCount` 0, in both artifacts | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/derived/phases`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/derived/phases` |
| Cache-write volume | `not available` | `cacheWriteTokens` is non-zero only on claude (437,169) while cache reads are in the hundreds of millions on every populated lane, so "no writes" and "writes unreported" cannot be distinguished for three lanes | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/totals`, `#/bySource` |
| Per-step cost on the lane's pricing basis | `not available` | The flagged `#/cacheWaste` rows imply `$1.0080` per 1M input against the lane's `$0.0648`, so a per-step cost of the waste is not derivable | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/cacheWaste`, `#/bySource/pi` |
| Claude-lane completeness (freshness field) | `not available` | The claude checkpoint precedes its own window's start by 5.00 h yet the row counts 1,071 in-window messages, so the field is not a run-level freshness marker | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/coverage/1`, `#/generatedAt`, `#/selector` |
| The current day's remaining 6.33 h | `not available` | The window is `provisional` and 73.64% elapsed at generation; every current-window figure is a partial-day fact | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-provenance.json` — `windowState`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/generatedAt`, `#/selector` |
| Workflow digest and provenance model | `not available` | Provenance records `workflowDigest`, `model` and `spurVersion` as `not available` while the artifact reports spur `0.4.25` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-provenance.json` — `workflowDigest`, `model`, `spurVersion` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` on four axes in section 3, including 73.64% elapsed coverage against a completed day | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/generatedAt`, `#/coverage`, `#/totals` |

Attribution note for the 38.20% unattributed bucket: the artifact's own warning `derived-unattributed-time` states that `56473685ms` could not be attributed to llm/tool/idle because some durations were unmeasured, and points at the per-source step-support matrix (`#/warnings/0`, restated at `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:201`). That is a gap, not workload: combined with F1 (7,310 untimed calls), F3 (millisecond-scale codex step durations) and F4 (`llmMs` above its components), it is the arithmetic shadow of measurement, not idle agent time.

## Remediation options

Proposals only. Nothing below has been applied, no diff is produced, and no command here was run by this report. Each option carries the printed `spur task create` handoff that lands it, with the finding's stable key in the task text so the next report classifies that finding as `resolved`. The operator remains the gate: a model-authored report never writes to the task corpus.

**R1 — emit per-call tool timing on the agy, claude and codex lanes** (addresses `telemetry:spur-history-import:tool-duration-unmeasured`)

- Owner surface: `spur history import` — the per-tool-call duration record for the three untimed lanes, consumed by `byTool` and `derived.timeDecomposition`.
- Expected impact: `toolMs` stops being one lane's identity and covers up to 9,704 calls; the 38.20% unattributed bucket shrinks by the share currently hiding untimed calls; the bottleneck ranking stops leading with an instrumentation residual.
- Verification method: a fresh artifact reports `#/totals/durationUnmeasured` near 0 against `#/totals/toolCalls`, non-zero `durationMs` on at least one of agy/claude/codex, and `#/warnings` free of `derived-unattributed-time`.
- Reversibility: reversible — an importer field mapping; a re-import rebuilds the rows and reverting the mapping restores today's behaviour.
- Handoff: `spur task create "telemetry:spur-history-import:tool-duration-unmeasured — emit per-call tool timing on the agy, claude and codex lanes" --template issue`

**R2 — resolve the model label for agy records and stop folding usage into the codex row** (addresses `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex`)

- Owner surface: `spur history analyze` — the `bySource`/`byModel` joins: model resolution for the agy adapter and source attribution of the residual `unknown` bucket.
- Expected impact: agy either reports its own tokens and cost or renders the dimension `not available` per lane; the codex row stops carrying 92,473 input tokens and `$0.046783` that belong to another lane; per-lane cost shares become readable for 58.24% of the records.
- Verification method: a fresh artifact either reports non-zero `#/bySource/agy/inputTokens` with a populated `#/byModel` entry for the agy models, or an explicit `not available` marker on that lane; `#/bySource/codex/inputTokens` equals the sum of its named models exactly.
- Reversibility: reversible — a mapping and an attribution rule; no history is rewritten.
- Handoff: `spur task create "telemetry:spur-history-import:agy-zero-usage-attributed-to-codex — resolve agy model labels and source attribution" --template issue`

**R3 — fix or explicitly invalidate codex per-step duration derivation** (addresses `telemetry:spur-history-import:codex-assistant-duration-implausible`)

- Owner surface: `spur history import` — the codex assistant-step duration derivation, consumed by `stepSupport` and `derived.timeDecomposition`.
- Expected impact: `llmMs` becomes a latency figure an operator can act on for the lane holding 57.62% of cost, or codex latency renders `not available` instead of a millisecond-scale value; either outcome stops the LLM bucket from being read as codex latency.
- Verification method: a fresh artifact reports codex per-step duration in a plausible range for 100k-token prompts with `stepsWithDuration` either complete or explicitly partial, or `#/bySource/codex/assistantDurationMs` renders `not available` with a named reason.
- Reversibility: reversible — a derivation rule; raw session records are untouched, so a corrected derivation recomputes.
- Handoff: `spur task create "telemetry:spur-history-import:codex-assistant-duration-implausible — fix or invalidate codex per-step duration derivation" --template issue`

**R4 — reconcile `llmMs` with its per-source rows and assert bucket = span** (addresses `telemetry:spur-history-analyze:time-decomposition-nonreconciling`)

- Owner surface: `spur history analyze` — the `derived.timeDecomposition` fold and the assistant-duration counters feeding it.
- Expected impact: the LLM bucket either equals the sum of its rows or states the residual as its own component; a bucket-sum assertion makes a 100.94%-share decomposition fail loudly instead of rendering.
- Verification method: a fresh artifact reports `llmMs` equal to the sum of `#/bySource[].assistantDurationMs` (or a named residual field), and the four buckets equal `spanMs`; the baseline's own figures recomputed through the fixed fold reproduce the same property.
- Reversibility: reversible — a fold computation and an assertion; no artifact is rewritten.
- Handoff: `spur task create "telemetry:spur-history-analyze:time-decomposition-nonreconciling — reconcile llmMs with per-source rows" --template issue`

**R5 — make the claude import checkpoint self-consistent** (addresses `coverage:spur-history-import:claude-lane-import-stale`)

- Owner surface: `spur history import` — the claude source lane's run checkpoint and per-file coverage accounting.
- Expected impact: the coherence question is settled — either the field becomes a run-level checkpoint that sits inside the window it describes, or it is renamed and rendered `not available` as freshness. Either outcome removes the trap that made a 5.00 h-pre-window timestamp look like truncation, and lane message and cost shares stop being read as lower bounds.
- Verification method: a fresh artifact reports a claude `lastImportedAt` that lies inside the window it reports (or a differently named field for the same value), the row's message count stays non-zero, and the field's relation to `#/generatedAt` matches the other three lanes' relation.
- Reversibility: reversible — a checkpoint write site and a field name; re-importing rebuilds the lane.
- Handoff: `spur task create "coverage:spur-history-import:claude-lane-import-stale — make the claude import checkpoint self-consistent" --template issue`

**R6 — decide the claude reviewer lane's capacity or its ladder position** (addresses `reliability:claude-executor:reviewer-dispatch-failures`)

- Owner surface: the `claude` executor entry (`#/ladderSnapshot`, order 24, tier `capable-3`) and the resource policy of the dispatch path that escalates `resource-exhaustion`.
- Expected impact: either the reviewer lane's failure share falls below the escalation pressure it currently carries, or it is demoted out of the reviewer role so rework lands on a lane that can complete; 7 of 16 failed dispatches become measurable work again.
- Verification method: a subsequent artifact reports the `claude` reviewer row's `failures` and `escalations` counts, with either a materially lower failure share at comparable dispatches or a documented ladder change visible in `#/ladderSnapshot`.
- Reversibility: reversible — a ladder ordering and a resource policy; no dispatch record is deleted.
- Handoff: `spur task create "reliability:claude-executor:reviewer-dispatch-failures — decide the claude reviewer lane's capacity or ladder position" --template issue`

**R7 — populate the outcome fold's task denominator** (addresses `coverage:spur-task-check:verified-outcome-absent`)

- Owner surface: `spur task check` (the proof-producing gate) together with the `verifiedOutcome` fold's task-window join.
- Expected impact: `verifiedRate`, `timeToVerified` and `costCoverage` become computable, so cost per verified result — the metric that would rank the other findings by value — stops rendering `not available` for a day that cost `$36.690767`.
- Verification method: a subsequent artifact reports a non-zero `#/verifiedOutcome/taskDenominator` and either a non-zero `verifiedResults` or a named non-zero `excludedReasons` bucket identifying why an in-scope task was excluded.
- Reversibility: reversible — a scope and join change in the fold; no verdict data is deleted.
- Handoff: `spur task create "coverage:spur-task-check:verified-outcome-absent — populate the outcome fold task denominator" --template issue`

**R8 — repair or retire the `minimax` cheap-tier scribe entry** (addresses `reliability:minimax-executor:scribe-dispatch-failure-total`)

- Owner surface: the `minimax` ladder entry (`#/ladderSnapshot`, order 0, tier `cheap`) and its pi-agent scribe dispatch configuration.
- Expected impact: removes a first-stop entry that produces 0 successes in 6 attempts at a 6.2 s mean, so ladder walks stop spending dispatch attempts on an entry that cannot complete work; the fallback that succeeds becomes attributable.
- Verification method: a subsequent artifact either reports a non-zero `successRate` on the `minimax` row with a mean duration in the range of the working scribes, or the entry is absent from `#/ladderSnapshot` / `#/pairings` with the removal recorded.
- Reversibility: reversible — a ladder entry and an endpoint configuration.
- Handoff: `spur task create "reliability:minimax-executor:scribe-dispatch-failure-total — repair or retire the minimax cheap-tier scribe entry" --template issue`

**R9 — extend the pairing cost join to every agent and state its coverage** (addresses `coverage:pairing-analytics:cost-coverage-partial`)

- Owner surface: the pairing analytics fold's cost and model joins in `spur history analyze`.
- Expected impact: every chained `agent.run` stage becomes costable, or the fold states how many dispatches its cost covers, so stage spend is either computable or explicitly `not available` — instead of 4.54% coverage presented without a denominator.
- Verification method: for a fresh artifact, `#/pairings` rows either carry non-null `totalCostUsd` whose sum is at most `#/totals/costUsd`, or each row carries an explicit coverage marker; `model` is populated or explicitly `not available` per row.
- Reversibility: reversible — a join predicate and a provenance field; no dispatch record is deleted.
- Handoff: `spur task create "coverage:pairing-analytics:cost-coverage-partial — extend the pairing cost join and state its coverage" --template issue`

**R10 — emit real argument digests on the agy lane, or mark them absent** (addresses `telemetry:spur-history-analyze:loop-args-digest-null`)

- Owner surface: `spur history analyze` — the loop fold's `argsDigest` derivation as fed by the agy adapter, and its singleton filter.
- Expected impact: repetition counts become argument-derived, so a "1,002 repeats" row means one command repeated instead of 1,002 calls with unknown arguments; the section-10 advisory becomes actionable and the singleton filter applies to agy as it already does to claude and pi.
- Verification method: a fresh artifact reports distinct `argsDigest` values across agy loop rows whose repeats sum to fewer than the lane's tool calls (singletons excluded), or renders the argument dimension `not available` per row rather than a constant digest.
- Reversibility: reversible — a hash input and a filter; no history is rewritten.
- Handoff: `spur task create "telemetry:spur-history-analyze:loop-args-digest-null — emit real argument digests or mark them absent" --template issue`

**R11 — document or reconcile the per-step cost basis in `cacheWaste`** (addresses `telemetry:spur-history-analyze:per-step-cost-basis-mismatch`)

- Owner surface: `spur history analyze` — the `cacheWaste` fold's per-step `costUsd` derivation relative to the `bySource` aggregates.
- Expected impact: a cost-of-waste figure becomes derivable from the rows, or the difference between per-step and lane pricing is stated so no reader multiplies 13 rows by a lane rate; today the flagged rows imply `$1.0080` per 1M input against a `$0.0648` lane rate.
- Verification method: a fresh artifact reports per-step `costUsd` that sums to within the lane aggregate at the flagged rows' input share, or carries an explicit basis field (per-request vs blended) on each row.
- Reversibility: reversible — a derivation and a field.
- Handoff: `spur task create "telemetry:spur-history-analyze:per-step-cost-basis-mismatch — document or reconcile the cacheWaste per-step cost basis" --template issue`

**R12 — emit the render title once and close the body fence** (addresses `workflow:spur-history-report:render-title-corrupted`)

- Owner surface: `spur history report` — the markdown header and fence writer for `--mode forensics`.
- Expected impact: the rendered artifact's first readable line stops contradicting itself, the fence count becomes balanced, and header parsing, markdown rendering and cross-day render diffs become safe.
- Verification method: `sed -n '1,5p'` on a fresh render shows the title exactly once with no truncated prefix, and the file's count of `^```` ``` marker lines is even.
- Reversibility: reversible — a renderer-only change; no artifact is rewritten.
- Handoff: `spur task create "workflow:spur-history-report:render-title-corrupted — emit the render title once and close the body fence" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 147,837,659 ms = 41.07 h against a 24.0 h window):

| Component | Time | Share of span |
| --- | ---: | ---: |
| Tool execution | 18.91 h (68,080,108 ms) | 46.05% |
| Unattributed (unmeasured durations) | 15.69 h (56,473,685 ms) | 38.20% |
| LLM latency (assistant duration, summed) | 3.60 h (12,950,215 ms) | 8.76% |
| Idle / overhead | 2.87 h (10,333,651 ms) | 6.99% |

Reading: the four buckets sum to `spanMs` exactly, but three of the four do not describe what their labels claim. Tool time equals the pi lane's `durationMs` to the millisecond, so 46.05% is one lane's measurement (F1). LLM time exceeds the sum of the per-source assistant durations by 696,596 ms (F4), and within the lanes that figure is dominated by pi (10,741,050 of 12,253,619 ms) while codex — 57.62% of cost — contributes 1,025 ms (F3). Unattributed is an instrumentation residual, explicitly not workload (`#/warnings/0`). Idle is the only bucket that is neither a single-lane identity nor a known reconciliation gap. The span itself is 41.07 h against a 24.0 h window (1.71×), because session spans intersect the window boundary rather than fit inside it — so every "share of wall" figure above is a share of an activity span, not of the day, and one session with unusable timestamps is excluded from it (`spanExcludedSessions` 1).

**Per-step latency by source** (`#/bySource`, `#/stepSupport`) — the axis that explains the LLM bucket:

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per timed step | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: |
| codex | 334 | 334 (complete) | 1,025 ms | 3.07 ms | 47.48% |
| claude | 298 | 281 (17 missing) | 382,544 ms | 1,361.37 ms | 97.02% |
| agy | 6,269 | 323 (5,946 missing) | 1,129,000 ms | 3,495.36 ms | `not available` |
| pi | 2,379 | 2,368 (11 missing) | 10,741,050 ms | 4,535.92 ms | 95.38% |

The 1,478× per-step gap between codex and pi inside one artifact is the reason the codex series is treated as a derivation artifact rather than a fast lane (F3): its five largest steps bill 111,113 / 108,479 / 107,490 / 107,237 / 105,243 input tokens and are recorded at 3 / 1 / 4 / 3 / 2 ms. Codex is the only lane with complete step-duration coverage, and its completeness is precisely what makes the scale legible as wrong. agy has 6,269 steps and 323 durations — 94.85% of its steps are unmeasured, which is the step-level shadow of F1. The largest single duration in the window is a pi `glm-5.3-flash` step at 1,251,406 ms (20.9 min), which no cache or token figure explains.

**Tool execution** (`#/byTool`; instrumented total 68,080,108 ms):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| bash | 2,251 | 36,252,172 ms | 16,112 ms | 2,400,004 ms | 1 |
| ask_user_question | 3 | 31,628,175 ms | 10,542,725 ms | 29,764,919 ms | 0 |
| bg_wait | 3 | 193,086 ms | 64,362 ms | 193,081 ms | 0 |
| web_search | 2 | 5,150 ms | 2,575 ms | 3,216 ms | 0 |
| write | 17 | 778 ms | 45 ms | 379 ms | 0 |
| edit | 73 | 349 ms | 4 ms | 16 ms | 0 |
| subagent | 4 | 253 ms | 63 ms | 188 ms | 0 |
| read | 22 | 122 ms | 5 ms | 21 ms | 0 |
| to&#100;o | 19 | 23 ms | 1 ms | 5 ms | 0 |
| contact_supervisor | 1 | 0 ms | 0 ms | 0 ms | 0 |
| read_file | 3,690 | `not available` | `not available` | `not available` | 3,690 |
| run_command | 2,675 | `not available` | `not available` | `not available` | 2,675 |
| exec | 284 | `not available` | `not available` | `not available` | 284 |
| manage_task | 196 | `not available` | `not available` | `not available` | 196 |
| edit_file | 183 | `not available` | `not available` | `not available` | 183 |
| write_file | 107 | `not available` | `not available` | `not available` | 107 |
| Write | 9 | `not available` | `not available` | `not available` | 9 |
| Skill | 6 | `not available` | `not available` | `not available` | 6 |
| ToolSearch | 1 | `not available` | `not available` | `not available` | 1 |

Only the pi lane is instrumented; 2,394 of 9,704 calls (24.67%) carry a duration. Within that measured set a human-wait call dominates: three `ask_user_question` calls hold 31,628,175 ms — 46.46% of all measured tool time — and the longest is 29,764,919 ms (8.27 h, 20.13% of the span). Excluding the human-wait calls, `bash` is 53.25% of measured tool time over 2,250 calls at a 16,112 ms mean and a 2,400,004 ms maximum (40.0 min). These are the only tool-latency facts this window supports, and none of them describes the agy, codex or claude lanes (F1). Tool-name fragmentation is material here: the read family splits as `read_file` 3,690 / `Read` 41 / `read` 22 (3,753 calls), the write family as `write_file` 107 / `write` 17 / `Write` 9 (133), the edit family as `edit_file` 183 / `edit` 73 (256), and the shell family as `run_command` 2,675 / `bash` 2,251 / `exec` 284 (5,210) — so any per-tool ranking computed from these keys understates each operation by the size of its aliases (process item 10).

**Cost and tokens by source** (`#/bySource`, `#/totals`, total `$36.690767`):

| Source | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cost / 1M billed input | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| codex | 3,041 | 34,128,981 | 16,206,080 | 0 | 142,882 | `$21.139689` | 57.62% | $0.6194 | 47.48% |
| pi | 5,600 | 221,244,812 | 211,024,256 | 0 | 821,341 | `$14.327261` | 39.05% | $0.0648 | 95.38% |
| claude | 930 | 14,703,501 | 14,266,028 | 437,169 | 81,527 | `$1.223817` | 3.34% | $0.0832 | 97.02% |
| agy | 13,347 | 0 | 0 | 0 | 0 | `$0` | 0.00% | `not available` | `not available` |

Window totals: billed input 270,077,294 (fresh 28,580,930 · cache-read 241,496,364 · cache-write 437,169), output 1,045,750, overall cache-hit ratio 89.42%, provider usage present on 2,800 of 22,918 records (12.22%). Three cost cells are measured; agy's is 0 by absence, not by measurement (F2). Read together: codex is the expensive lane on a per-token basis (`$0.6194` per 1M billed input, 9.6× pi's `$0.0648`) at only 47.48% cache reuse, and pi is the bulk lane on the cheap rate at 95.38% reuse — so spend concentration (codex 57.62%) and volume concentration (pi 81.9% of billed input) point in opposite directions, and neither equals record mass (agy 58.24%). Output is priced at `$35.0856` per 1M output tokens across a small output volume. The codex reuse figure (47.48%) is nearly identical to the baseline's (47.36%) — a stable lane property, recorded here as presence in both artifacts, not as a trend, because section 3 found the pair incomparable.

**Chained `agent.run` run cost** (per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Agent | Dispatches | Success rate | Failures | Unknown outcomes | Escalations | Total cost | Mean duration |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| `codex-sol` | reviewer | antigravity-cli | 34 | 1.00 | 0 | 0 | `resource-exhaustion`: 6 | `not available` | 143,972.43 ms (2.40 min) |
| `agy-gemini` | reviewer | antigravity-cli | 21 | 0.95 | 1 | 0 | none | `not available` | 340,117.45 ms (5.67 min) |
| `claude` | reviewer | claude | 16 | 0.56 | 7 | 0 | `resource-exhaustion`: 5 | `not available` | 91,451.47 ms (1.52 min) |
| `codex-sol` | scribe | codex | 16 | 0.88 | 2 | 0 | none | `not available` | 66,441.00 ms (1.11 min) |
| `minimax` | scribe | pi | 6 | 0.00 | 6 | 0 | none | `not available` | 6,180.44 ms (6.2 s) |
| `pi-dsv4.1-flash-volc` | reviewer | pi | 3 | 0.67 | 1 | 0 | none | `$1.578544` | 1,793,281.55 ms (29.9 min) |
| `pi-dsv4.1-flash-volc` | scribe | pi | 1 | 1.00 | 0 | 0 | none | `$0.087659` | 62,750.81 ms (1.05 min) |

The seven pairings cover 97 dispatches with 17 failures (17.53%), 0 unknown outcomes and 11 escalations (6 codex-sol reviewer, 5 claude reviewer). Only the two pi rows are costed — `$1.666203`, 4.54% of window cost, covering 4 of 97 dispatches (F9) — and `model` is `null` on every row, so no stage cost is attributable to a model. Two rows carry failure mass: the claude reviewer's 7 of 16 (F6) and the minimax scribe's 6 of 6 at 6.2 s (F8). The escalation pattern is the most informative row in the table: codex-sol records 6 capacity escalations while reporting `successRate` 1.0, so escalation pressure and failure outcomes are different signals, and a lane can be capacity-strained without appearing in any failure count.

**Cache re-send waste** (`#/cacheWaste`): 13 steps, 1,387,570 input tokens, all `glm-5.3-flash`, all inside one session (`2026-11-05T20-14-59-915Z_01a1ad59-b54a-70fd-99b4-983fe28a972b`), each with `cacheReadTokens` 0 (0.0% reuse) at inputs of 110,997 / 110,393 / 107,893 / 107,547 … The concentration is the finding here: all 13 cold steps sit in one long session, which is the shape of a prefix that stopped matching rather than of many sessions starting cold. That session is also the window's largest by cost — `$13.060301`, 35.6% of the total — so the waste and the spend are in the same place. Cost is `not available` on the lane's basis (the rows imply `$1.0080` per 1M input against a lane rate of `$0.0648`, F11), so the rows' `$1.417755` is reported as recorded, never as the cost of the waste. The baseline flagged 28 steps across six sessions (2,981,307 tokens); the current window's 13 are a single-session anomaly of the same class, and the two are not compared.

**Per-session concentration** (`#/bySession`, top 20 of 96): the largest session is the shared pi session above — 5,217 messages, 2,251 tool calls, `$13.060301` (35.6% of window cost), `assistantDurationMs` 8,151,072. The other 19 listed rows are codex sessions of 74–104 messages and $0.49–$0.91 each; the top two rows hold 38.06% of cost. Because `#/bySession` is truncated at 20 of 96 and holds only 30.16% of messages while holding 72.43% of cost, the unlisted 76 sessions are numerous and cheap, and the listed set is a cost-weighted slice rather than a volume slice — the per-session shares below are computed against the window total and are exact for the listed rows, not a complete decomposition (section 1). The same session also appears in the baseline artifact with 308 messages, `$0.845309` and `sessionState` `in-progress` — i.e. it accrued ~4,909 more messages across the boundary — and its `startedAt` differs between the two artifacts (`2026-11-06T00:54:28.987Z` here against `2026-11-05T20:14:59.915Z` there) while both values precede their own window's start; that is an observation with a single supporting signal and is recorded in process item 9, not as a finding.

**Bottleneck order** (`#/derived/bottlenecks`): tool 46.05% → unattributed 38.20% → llm 8.76% → idle 6.99%. The first two rows are measurement statements, not workload statements (F1, F4; section 6 attribution note).

## Workflow and process improvements

Numbered prose proposals; each is report-only and requires operator acceptance before any surface changes. None is projected through the environment-improvement lens — no candidate here carries a retro-category projection, and each is valid unprojected report grammar.

1. **Separate "imported" from "measurable" in the per-source status row, and make the freshness field self-consistent.** All four lanes report `status` `ok` with zero parse and validation errors while three of them contribute no tool timing at all (F1) and one contributes no token or cost figure at all (F2); the claude lane additionally reports a checkpoint 5.00 h before its own window's start while counting 1,071 in-window messages (F5). A status field that cannot be non-`ok` for a lane with no measurable content, and a freshness field that can contradict the row it sits on, carry no information. Owner surface: the per-source coverage contract in `spur history import` and `spur history analyze`. Recurrence basis: the all-clear-status shape with an uninterpretable checkpoint appears in both artifacts of this run — the baseline's four checkpoints all precede its generation by 25.43–32.93 h at `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` `#/coverage`, against a checkpoint that precedes its own window start at `#/coverage/1` of the current artifact.
2. **Print the coverage denominator next to every aggregate the render shows.** The current render prints `Tool execution | 18.9h | 46%` (`.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:66`) without stating that the figure is one lane's measurement covering 2,394 of 9,704 calls, so 24.67% of the population is presented as a window total — the bounded-leaderboard truthfulness invariant applied to a time column rather than to a table. Owner surface: `spur history report`'s time-decomposition writer. Recurrence basis: single-window, high-impact contract violation cited at `file:line` (report-contract truthfulness invariants: no bounded set presented as a population total).
3. **Qualify a wall-clock span that exceeds its own window.** The render states `Wall clock (span) | 41.1h | 100%` (`.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:69`) for a 24.0 h window — 1.71× the window — without saying that the figure is the union of intersecting session spans and excludes one session with unusable timestamps. A reader taking 41.1 h as the day's wall clock would overstate the window by 71%. Owner surface: `spur history report`'s summary and time-decomposition writers. Recurrence basis: the same construction appears in both artifacts (107.04 h against the same 24.0 h window length at `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` `#/derived/timeDecomposition/spanMs`), so the qualification is needed for every run of this workflow.
4. **Treat a partially elapsed current window as a comparability blocker in the runner, not in the reader.** The current artifact was generated 73.64% of the way through the day it measures while its baseline had fully elapsed, and this report had to derive that from `#/generatedAt` against the selector bounds to avoid stating a fabricated delta. Owner surface: the history-anatomy workflow's baseline selection and the mode contract's comparability rule. Recurrence basis: both artifacts of this run carry `windowState` `provisional` (`.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-provenance.json`, `windowState`), and the earlier `2026-11-02` report recorded the same asymmetry — two independent windows.
5. **Make the phase fold's label follow its data.** `phaseSupport: "supported"` with `phases: []` and `invalidPhaseCount` 0 is present in both artifacts of this run, so the label has asserted availability while the list has been empty in at least two independent windows. Owner surface: `spur history analyze`, the `derived.phases` fold. Recurrence basis: two artifacts, at `#/derived/phases` in the current artifact and the same path in `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json`.
6. **Assert that the time buckets sum to the span, and that `llmMs` equals its rows.** The current artifact passes the first check and fails the second by 696,596 ms; the baseline fails the first by 3,641,238 ms and renders shares that sum to 100.94% (F4). A fold-level assertion turns a silent mis-render into a visible failure on either artifact. Owner surface: `spur history analyze`, the `derived.timeDecomposition` fold. Recurrence basis: two artifacts, each failing one of the two properties — `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` `#/derived/timeDecomposition` and the same path in the baseline artifact.
7. **Emit loop rows with real argument identity.** 85 of 92 rows here and 19 of 23 in the baseline carry `sha256(null)` as the argument digest, and the repeats on those rows sum exactly to the agy lane's tool-call count in both artifacts, so the fold reports "same tool, arguments unknown" counts as repetitions (F10). An operator cannot act on the section-10 advisory until the digest is real. Owner surface: the loop fold in `spur history analyze` and the agy adapter's argument capture. Recurrence basis: two artifacts, `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` `#/loops` and `#/loops` of the baseline artifact.
8. **Reconcile the message counts between `#/coverage` and `#/bySource`.** The current artifact's coverage rows sum to 23,109 messages against `#/totals` 22,918 — claude 1,071 against 930, pi 5,650 against 5,600 — and the baseline's disagree by 1,228 on the claude lane alone. Two per-lane message counts whose definitions differ by up to 21% (baseline claude, 7,007 against 5,779) and by 15.2% (claude here, 1,071 against 930) are not interchangeable, and every lane-share statement has to say which one it used. Owner surface: the coverage fold and the `bySource` fold in `spur history analyze`. Recurrence basis: both artifacts, at `#/coverage` and `#/bySource` of each.
9. **State session boundary semantics on the bySession row.** The window's costliest session, `2026-11-05T20-14-59-915Z_01a1ad59-b54a-70fd-99b4-983fe28a972b`, reports `startedAt` `2026-11-06T00:54:28.987Z` here and `2026-11-05T20:14:59.915Z` in the baseline — two values for one session id, both preceding their own window start — while its `sessionState` moves from `in-progress` to `complete` across the two artifacts. An operator reading `startedAt` as a window-anchored field would conclude the session began 7.09 h before the day it is counted in. Owner surface: `spur history analyze`, the `#/bySession` fold's time fields. Recurrence basis: single-window observation with one supporting signal, so this is a process item rather than a finding; the confirmation path is a third artifact showing the same session id, where a stable `startedAt` would indicate a per-window projection rather than an unstable field.
10. **Aggregate tool-name aliases before publishing per-tool statistics.** `#/population/tools` reports 22 keys and `#/byTool` 20 rows, in which the read family is split across `read_file` 3,690, `Read` 41 and `read` 22, the write family across 107 / 17 / 9, the edit family across 183 / 73, and the shell family across 2,675 / 2,251 / 284. Every per-tool ranking, error count and latency mean therefore describes one adapter's spelling rather than one operation. Owner surface: the tool-name normalization in `spur history analyze`, applied before the `byTool` fold. Recurrence basis: both artifacts, with different key sets (22 here against 30 in the baseline, including MCP-prefixed and `Monitor`/`ToolSearch` keys), so the fragmentation is not a one-day artifact.
11. **Carry the pairing's coverage denominator on the row.** One artifact of this run prices 2 of 7 pairing rows and the other prices 1 of 5, while `model` is `null` on every row of both; in each case the reader must derive coverage by hand to avoid presenting 4.54% of dispatches as a stage-cost picture (F9). Owner surface: the pairing analytics fold in `spur history analyze`. Recurrence basis: two artifacts with partial cost coverage and null model identity throughout.
12. **Decide the reviewer lanes' capacity as a pair.** The claude reviewer fails 7 of 16 (F6) and the codex-sol reviewer records 6 `resource-exhaustion` escalations at `successRate` 1.0 — two lanes, one capacity signal, different symptoms. Treating escalation as invisible-on-success and failure as visible-on-failure splits one constraint across two columns and hides it from any single-row read. Owner surface: the ladder entries `claude` (order 24, tier `capable-3`) and `codex-sol` (order 20, tier `capable-2`) with their resource policy. Recurrence basis: two artifacts — the baseline records `resource-exhaustion` 4 on claude and 0 on codex-sol at 30 dispatches, so the escalation count is itself variable across windows.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry and no command substitution. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | First observed | Note |
| --- | --- | ---: | --- | --- |
| `read_file` + `argsDigest` `74234e98afe7498f…` | agy · `6984f444-c058-4bee-93ef-9524bc445e10` | 1,002 | `2026-11-06T18:18:31Z` | The digest is `sha256(null)`, so this counts 1,002 `read_file` calls with no captured arguments, not 1,002 identical reads (F10). `firstSeq` 1 → `lastSeq` 1,101, `model` `unknown`. |
| `run_command` + `argsDigest` `74234e98afe7498f…` | agy · `6984f444-c058-4bee-93ef-9524bc445e10` | 992 | `2026-11-06T18:18:31Z` | Same session, same null digest, a different tool — the only discriminator between the two rows is the tool name. |
| `edit_file` + `argsDigest` `74234e98afe7498f…` | agy · `6984f444-c058-4bee-93ef-9524bc445e10` | 183 | `2026-11-06T18:33:50Z` | Third tool on the same null digest in the same session; the 183 count equals `#/byTool/edit_file/calls`, so every `edit_file` call in the window is inside this one row. |
| `read_file` + `argsDigest` `74234e98afe7498f…` | agy · `5802d775-99f5-4b43-b2c3-4f6b0409bd9c` | 168 | `2026-11-06T00:41:17Z` | A second session on the same null digest; repeats of 168 inside 53 sequence positions show the fold is not dividing by sequence range. |
| `run_command` + `argsDigest` `74234e98afe7498f…` | agy · `64ca75a7-51e0-4a2a-a442-c761e1cc5a39` | 164 | `2026-11-06T01:36:39Z` | Same class; `firstSeq` 1 → `lastSeq` 129, so 164 repeats are counted across 129 positions. |
| `Edit` + `argsDigest` `b8c3f0bdcaf7bd53…` | claude · `adb61042-819c-43d6-a744-61…` | 6 | `2026-11-06` window | A real digest: the same edit argument signature six times in one session. `firstSeq` and `lastSeq` are both 0, so position and separation are `not available`. |
| `Edit` + `argsDigest` `305c9903dc432db3…` | claude · `b3d68ee9-485b-4fb2-8cca-4e…` | 6 | `2026-11-06` window | A real digest on a second claude session; six repeats, sequence positions unavailable for the same reason. |
| `bash` + `argsDigest` `2b4dca5be8baa934…` | pi · `2026-11-05T20-14-59-915Z_01a1ad59…` | 3 | `2026-11-05T20-14-59Z` | The only pi rows with usable sequence positions: repeats 3 across `firstSeq` 4,325 → `lastSeq` 4,339, so the same command ran three times within a 15-step span of the window's costliest session. |

The artifact exposes repetition only through the loop fold, which reports signatures repeating at least 3 times. Of the 92 rows, 85 belong to the agy lane and carry a null argument digest whose repeats sum exactly to that lane's 6,851 tool calls — so the folds for that lane are "calls with unknown arguments", and the 7 rows with real digests (claude 5, pi 2) sum to 35 repeats against 174 and 2,395 calls respectively. Repeat counts of one or two are `not available` from this evidence plane, and the 9,704 tool calls are not individually inspectable for repetition because `byTool` carries no command text. Two distribution observations are recorded here rather than as repetition classes: the shell family (`run_command` 2,675 + `bash` 2,251 + `exec` 284 = 5,210 calls, 53.7% of the window) and the read family (3,753 calls, 38.7%) are split across aliases per process item 10; and a single `ask_user_question` call holds 20.13% of the span, which is human-decision time, not a signature the fold classifies. Neither is proposed as a trigger for any automated behaviour.

## Positive patterns

Held to the same evidence standard as the problems above: observation, inference, and at least one anchor each.

### P1 — 9,704 tool calls and 326 imported files produced no errors

- `key`: `positive:spur-history-import:clean-import-and-tool-runs`
- `category`: `positive`
- `impact`: The evidence plane is trustworthy on its error axis: no tool call failed and no record was rejected across four sources and 326 files. That is what makes the report's gaps measurement-coverage gaps (F1, F2, F4) rather than import corruption, and it is the reason no figure here needs a caveat about lost or malformed data.
- `trend`: `not-comparable`
- `observation`: `#/byTool[].errors` is 0 for all 20 listed tool keys summing over 9,587 calls, and the two unlisted keys are counted in `#/population/tools` 22 with no error row. `#/coverage` reports `parseErrors` 0, `validationErrors` 0, `unknownRecords` 0, `parseErrorSamples` `[]` and `validationErrorSamples` `[]` for all four sources — agy 253 files, claude 14, codex 49, pi 10.
- `inference`: Zero errors across every listed tool key plus zero parse, validation and unknown counts across all 326 files means the importers read this window's corpus without loss or rejection, so the artifact's content is complete relative to what the sources recorded. Named observations: the all-zero `errors` column, the all-zero error counters in `#/coverage`, and the agreement between `#/coverage` tool calls (9,704) and `#/totals/toolCalls` (9,704).
- `contradictions`: A clean error axis says nothing about coverage: the same `#/coverage` rows report `ok` while three lanes emit no tool durations (F1), the agy lane emits no usage (F2) and the claude checkpoint cannot be read as freshness (F5), so "no errors" must not be read as "fully measured". The message axis does not reconcile (`#/coverage` sums to 23,109 against 22,918), so completeness is asserted for tool calls and files, not for messages.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`, `#/population`
- `severity`: `P3`
- `reproCommand`: `jq -c '{toolErrors:([.byTool[].errors]|add),listedCalls:([.byTool[].calls]|add),coverage:[.coverage[]|{s:.source,f:.files,m:.messages,p:.parseErrors,v:.validationErrors,u:.unknownRecords}],totals:{m:.totals.messages,c:.totals.toolCalls}}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — all four source lanes and their validation path.

### P2 — the codex-sol reviewer lane completed 34 of 34 dispatches

- `key`: `positive:spur-history-analyze:pairing-dispatch-reliability`
- `category`: `positive`
- `impact`: One reviewer lane is fully reliable at volume: 34 dispatches, 0 failures, 0 unknown outcomes. Combined with 0 unknown outcomes on all 7 pairing rows, it means the dispatch axis has no unclassified terminal states this window, so a failure share computed from the fold is measured rather than assumed.
- `trend`: `not-comparable`
- `observation`: `#/pairings` row (`executor` `codex-sol`, `role` `reviewer`, `agent` `antigravity-cli`) reports `dispatches` 34, `successRate` 1, `failures` 0, `unknownOutcomes` 0, `escalations` `{"resource-exhaustion": 6}`, `meanDurationMs` 143,972.43. Across all 7 rows `unknownOutcomes` sums to 0 over 97 dispatches.
- `inference`: 34 dispatches at `successRate` 1 with 0 unknown outcomes means every dispatch on that lane reached a classified terminal state and none failed — a measured, not assumed, reliability figure. Named observations: the 34-dispatch count, the `successRate` 1.0, and the zero `unknownOutcomes` sum across all rows.
- `contradictions`: The same row records 6 `resource-exhaustion` escalations, so success is not evidence of headroom — the lane absorbed capacity pressure without failing, which is a different property from being unconstrained. Its `totalCostUsd` is `null`, so the lane's success cannot be priced. The baseline's `codex-sol` reviewer row also reports 30 dispatches at `successRate` 1, but on a different lane mix, so the two figures are each their own artifact's value and are not subtracted.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/pairings`
- `severity`: `P3`
- `reproCommand`: `jq -c '{rows:[.pairings[]|{e:.executor,r:.role,d:.dispatches,sr:.successRate,f:.failures,u:.unknownOutcomes,esc:.escalations}],dispatches:([.pairings[].dispatches]|add),unknown:([.pairings[].unknownOutcomes]|add)}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: the `agent.run` dispatch path and the pairing analytics fold in `spur history analyze`.

### P3 — the pi lane is fully instrumented on every axis and is the cheapest source

- `key`: `positive:spur-history-import:pi-complete-measurement-axis`
- `category`: `positive`
- `impact`: Every quantitative claim about pi latency, tokens and tool time in this window rests on a lane with a complete denominator: 2,394 of 2,395 tool calls timed, 2,379 of 2,379 steps with usage, 2,368 with duration and cache-read, and 95.38% cache reuse at `$0.0648` per 1M billed input — 9.6× cheaper than codex per billed token. That is what makes F1's single-lane identity and F3's 1,478× per-step comparison defensible rather than inferred.
- `trend`: `not-comparable`
- `observation`: `#/stepSupport` pi row reports `assistantSteps` 2,379, `stepsWithUsage` 2,379, `stepsWithDuration` 2,368, `stepsWithDerivedDuration` 2,368, `stepsWithCacheRead` 2,379. `#/bySource/pi` reports `toolCalls` 2,395 with `durationMs` 68,080,108 and `durationUnmeasured` 1, `inputTokens` 221,244,812, `cacheReadTokens` 211,024,256, `costUsd` 14.327261. Every timed `#/byTool` row except one measured bash call belongs to this lane.
- `inference`: A lane whose step counts, usage counts, duration counts and cache-read counts agree within 11 steps (and whose tool-call unmeasured count is 1 of 2,395) is emitting a measurement record per step, so its aggregates are measured rather than inferred. Named observations: the near-equal step counts, the 1-of-2,395 unmeasured tool call, and the 95.38% reuse that agrees with the lane's populated cache fields.
- `contradictions`: pi's completeness is not matched by cost weight per token but is matched by volume: it carries 81.9% of billed input (221,244,812 of 270,077,294) while holding 39.05% of cost and 5,600 of 22,918 messages (24.43%), so a complete lane is also the window's token bulk — and its 13 cold-reuse steps are the entire `#/cacheWaste` population (F11). Its 11 unmeasured step durations and 1 unmeasured tool call mean even this lane is not perfectly complete.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/pi`, `#/byTool`, `#/cacheWaste`
- `severity`: `P3`
- `reproCommand`: `jq -c '{steps:(.stepSupport[]|select(.source=="pi")),tools:{calls:.bySource.pi.toolCalls,ms:.bySource.pi.durationMs,u:.bySource.pi.durationUnmeasured},reuse:(.bySource.pi.cacheReadTokens/.bySource.pi.inputTokens),ratePerM:(.bySource.pi.costUsd/(.bySource.pi.inputTokens/1000000)),codexRatePerM:(.bySource.codex.costUsd/(.bySource.codex.inputTokens/1000000))}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pi source lane, as the reference implementation the other three lanes should match.

### P4 — the source and model folds both sum to every window total

- `key`: `positive:spur-history-analyze:source-and-model-folds-sum-to-totals`
- `category`: `positive`
- `impact`: Ten independent reconciliation checks pass on the source fold and seven on the model fold, which means the cost, token and volume totals in this report are carried by two independent distributions that agree with `#/totals` exactly. A reader can therefore attribute a discrepancy to a specific dimension (F1, F2, F4) rather than to a suspected arithmetic drift, and the four time buckets also sum to the span exactly here.
- `trend`: `not-comparable`
- `observation`: `#/bySource` sums equal `#/totals` for `inputTokens` (270,077,294), `outputTokens` (1,045,750), `cacheReadTokens` (241,496,364), `cacheWriteTokens` (437,169), `costUsd` (36.690767), `records` (22,918), `messages` (22,918), `toolCalls` (9,704), `assistantDurationMs` (12,253,619) and `durationMs` (68,080,108). `#/byModel` sums equal `#/totals` for input, output, cache read, cost, records, messages and tool calls. `#/derived/timeDecomposition` buckets sum to `spanMs` 147,837,659.
- `inference`: Because both distributions independently reproduce every total, the folds compute from one shared record base rather than from divergent counts — so a discrepancy elsewhere in the report localizes to the dimension that owns it. Named observations: the ten source-fold equalities, the seven model-fold equalities, and the bucket-to-span equality.
- `contradictions`: Agreement at the total does not imply agreement per lane: the two folds distribute differently (F2's 92,473-token split), `#/coverage` messages do not reconcile with `#/bySource` messages (23,109 against 22,918), and `llmMs` exceeds the row total it sits beside (F4). The baseline passes the same source and model checks but fails the bucket-to-span check, so the positive is scoped to the source and model folds.
- `evidenceAnchor`: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/bySource`, `#/byModel`, `#/totals`, `#/derived/timeDecomposition`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/bySource`, `#/byModel`, `#/totals`
- `severity`: `P3`
- `reproCommand`: `jq -c '{src:{in:(([.bySource[].inputTokens]|add)==.totals.inputTokens),out:(([.bySource[].outputTokens]|add)==.totals.outputTokens),cr:(([.bySource[].cacheReadTokens]|add)==.totals.cacheReadTokens),cw:(([.bySource[].cacheWriteTokens]|add)==.totals.cacheWriteTokens),cost:(((([.bySource[].costUsd]|add)-.totals.costUsd)|if .<0 then -. else . end)<0.000001),rec:(([.bySource[].records]|add)==.totals.records),msgs:(([.bySource[].messages]|add)==.totals.messages),tools:(([.bySource[].toolCalls]|add)==.totals.toolCalls),asst:(([.bySource[].assistantDurationMs]|add)==.totals.assistantDurationMs),dur:(([.bySource[].durationMs]|add)==.totals.durationMs)},model:{in:(([.byModel[].inputTokens]|add)==.totals.inputTokens),out:(([.byModel[].outputTokens]|add)==.totals.outputTokens),cr:(([.byModel[].cacheReadTokens]|add)==.totals.cacheReadTokens),cost:(((([.byModel[].costUsd]|add)-.totals.costUsd)|if .<0 then -. else . end)<0.000001),rec:(([.byModel[].records]|add)==.totals.records),msgs:(([.byModel[].messages]|add)==.totals.messages),tools:(([.byModel[].toolCalls]|add)==.totals.toolCalls)},buckets:(([.derived.timeDecomposition.llmMs,.derived.timeDecomposition.toolMs,.derived.timeDecomposition.idleMs,.derived.timeDecomposition.unattributedMs]|add)==.derived.timeDecomposition.spanMs)}' .spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json`
- `ownerSurface`: the `totals`, `bySource`, `byModel` and `derived.timeDecomposition` folds in `spur history analyze`.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `telemetry:spur-history-import:tool-duration-unmeasured` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/byTool`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:66-68` |
| `telemetry:spur-history-import:agy-zero-usage-attributed-to-codex` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/bySource/agy`, `#/bySource/codex`, `#/byModel`, `#/totals` |
| `telemetry:spur-history-import:codex-assistant-duration-implausible` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/bySource/codex`, `#/bySource/pi`, `#/stepSupport`, `#/topStepsByTokens` |
| `telemetry:spur-history-analyze:time-decomposition-nonreconciling` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/derived/timeDecomposition`, `#/bySource`, `#/totals`, `#/stepSupport`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/derived/timeDecomposition`, `#/totals`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:65` |
| `coverage:spur-history-import:claude-lane-import-stale` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/coverage/1`, `#/generatedAt`, `#/selector`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/coverage/1` |
| `reliability:claude-executor:reviewer-dispatch-failures` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/pairings` |
| `coverage:spur-task-check:verified-outcome-absent` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/verifiedOutcome` |
| `reliability:minimax-executor:scribe-dispatch-failure-total` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/pairings` |
| `coverage:pairing-analytics:cost-coverage-partial` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/pairings`, `#/totals/costUsd` |
| `telemetry:spur-history-analyze:loop-args-digest-null` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/loops`, `#/population/loops`, `#/bySource/agy`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/loops` |
| `telemetry:spur-history-analyze:per-step-cost-basis-mismatch` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/cacheWaste`, `#/bySource/pi`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/cacheWaste`, `#/bySource/pi` |
| `workflow:spur-history-report:render-title-corrupted` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.md:3-4`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.md:3-4` |
| `positive:spur-history-import:clean-import-and-tool-runs` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/totals`, `#/population` |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/pairings`, `#/ladderSnapshot` |
| `positive:spur-history-import:pi-complete-measurement-axis` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/stepSupport`, `#/bySource/pi`, `#/byTool`, `#/cacheWaste` |
| `positive:spur-history-analyze:source-and-model-folds-sum-to-totals` | `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-current.json` — `#/bySource`, `#/byModel`, `#/totals`, `#/derived/timeDecomposition`; `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` — `#/bySource`, `#/byModel`, `#/totals` |

Baseline artifacts cited in sections 3 and 5: `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byModel`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`, `#/totals`, `#/loops`, `#/cacheWaste`, `#/ladderSnapshot`) and `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-history-anatomy-baseline.md:3-4`. Window bounds and the equal-duration offsets are recorded in `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-paths.txt:5-8`; run identity, digests, selector and the provisional window state are recorded in `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-provenance.json` and `.spur/run/f527aa66-bc0b-483e-94f2-da75a84e70c4-selector.json`.

Two limitations of this report's own evidence, stated rather than masked: the current window is provisional and only 73.64% elapsed, so every current-window figure is a partial-day fact; and no comparison against `2026-11-05` is stated anywhere, because that baseline was found `not comparable` on four independent axes in section 3 — the first of them being a completed day against this truncated one.

