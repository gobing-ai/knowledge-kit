---
identity:
  contractVersion: "1"
  mode: daily
  date: "2026-10-27"
  timezone: America/Los_Angeles
  bounds:
    since: 2026-10-27T00:00:00.000-07:00
    until: 2026-10-27T23:59:59.999-07:00
  sources:
    - source: claude
    - source: pi
windowState: "provisional"
generatedAt: "2026-10-27T15:30:13.902Z"
validatedAt: "2026-10-27T15:30:13.902Z"
artifactDigest: "1113c44e2c0698d44dde7fc7c9b4be6ccc0b60be51b5acedcecdbd1e1324f696"
baselineArtifactDigest: "da77a129b2ac16b143a9be033574340929017409537d039652e9587aa0923c66"
contractDigest: "34f0f1e6e8c836a9b7714ef70f5627cf8d3546a44c2afedb9bb8021d405953f5"
skillDigest: "bcd34064fb82e1d397715b1b6dcca8b68bd410f0761ddc3c529a9d49b2e1c5c1"
workflowDigest: "not available"
helperDigest: "a076bd717c8f320f0b526f357802e9a4f2a26a50205ca81242ec68989d4fb539"
runId: "4ea3002c-bf2b-4ddb-824e-1a85c67ef331"
currentArtifactPath: ".spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json"
baselineArtifactPath: ".spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json"
spurVersion: "not available"
schemaVersion: 1
executor: "coder"
model: "not available"
cacheDisposition: "miss"
coverage:
  - source: claude, status: ok, lastImportedAt: 2026-10-27T15:30:10.644Z
  - source: pi, status: ok, lastImportedAt: 2026-10-27T15:30:09.116Z
---

> imported snapshot as of 2026-10-27T15:30:09.116Z · window provisional · cache miss

# History forensics report — 2026-10-27 (daily)

Model-authored by `sp:history-anatomy enrich` (mode `daily`, run `4ea3002c`). Sections 1, 2, 6 and 12 are populated from the two forensics artifacts as the enrich rubric requires; sections 3, 4, 5, 7, 8, 9, 10 and 11 are the model half. Every quantitative claim below is read from, or computed on, the current artifact unless it names the baseline artifact explicitly. Nothing in this report has been applied, and no command shown here was run by this report.

## Scope and provenance

| Field | Value |
| --- | --- |
| Mode | `daily` — current window is the local calendar day `2026-10-27`, baseline is the immediately preceding local calendar day `2026-10-26` |
| Current window | `2026-10-27T00:00:00.000-07:00` → `2026-10-27T23:59:59.999-07:00` (America/Los_Angeles) |
| Baseline window | `2026-10-26T00:00:00.000-07:00` → `2026-10-26T23:59:59.999-07:00` (America/Los_Angeles) |
| Window state | `provisional` — generation happened at `2026-10-27T15:30:13.902Z` (08:30:13 local), 8.5 h into the local day it measures, so the window is not closed. Read from the run-level `windowState` in `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-provenance.json`; neither artifact JSON carries a `windowState` field. The baseline window is `closed` in the calendar sense (its last instant precedes generation) |
| Generated | `2026-10-27T15:30:12.791Z` (current) · `2026-10-27T15:30:13.316Z` (baseline) |
| Toolchain | spur `0.4.20` (artifact `#/spurVersion`; the provenance file records `spurVersion` as `not available`) · artifact `schemaVersion` `1` · executor `coder`, model `not available` · contract version `1` |
| Digests | artifact `1113c44e2c0698d44dde7fc7c9b4be6ccc0b60be51b5acedcecdbd1e1324f696` · baseline artifact `da77a129b2ac16b143a9be033574340929017409537d039652e9587aa0923c66` · skill `bcd34064fb82e1d397715b1b6dcca8b68bd410f0761ddc3c529a9d49b2e1c5c1` · helper `a076bd717c8f320f0b526f357802e9a4f2a26a50205ca81242ec68989d4fb539` · workflow `not available` |
| Selector | sources `all`, no session/run/task narrowing, leaderboard depth `20` |
| Cache disposition | `miss` — this run recomputed rather than reusing a cached artifact |
| Current artifact | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` |
| Baseline artifact | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` |
| Rendered current | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md` |
| Rendered baseline | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.md` |
| Selector file | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-selector.json` |

Per-source import coverage of the current window (`#/coverage`):

| Source | Status | Files | Messages | Tool calls | Unknown records | Parse errors | Validation errors | Last imported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| claude | ok | 5 | 813 | 131 | 0 | 0 | 0 | `2026-10-27T15:30:10.644Z` |
| pi | ok | 4 | 213 | 89 | 0 | 0 | 0 | `2026-10-27T15:30:09.116Z` |

Population: `9` sessions, `10` tool keys, `1` loop signal, `1` warning, leaderboard depth applied `20` (`#/population`). Both `9` and `10` are below the depth of `20`, so the session and tool enumerations are complete rather than bounded (F3 shows the tool count is complete but internally fragmented). The step leaderboards (`#/topStepsByTokens`, `#/topStepsByDuration`) hold `20` rows each and are slices of the `324` assistant steps reported by `#/stepSupport` (claude 230 + pi 94), not population totals. The baseline population is `6` sessions and `10` tool keys, with the same depth applied, so its session and tool enumerations are also complete and its step leaderboards are slices of `450` assistant steps.

## Executive summary

- The measured current window is 9 sessions, 925 messages, 220 tool calls, a 2.36 h activity span, and `$2.448821` of provider-billed cost across two sources (`claude`, `pi`). No codex coverage exists for this window; the baseline carried three sources.
- One P1 finding is a latency concentration, not a defect: pi's 94 assistant steps consume `6,483,205` ms of assistant duration — 89.62% of the window's `7,234,180` ms — at a 68,970 ms mean per step against claude's 3,265 ms over 230 steps. LLM wait is 95.44% of the span, and it is almost entirely one executor lane.
- The second P1 is an instrumentation defect: all 131 claude tool calls carry no duration (`durationUnmeasured` 131 of 131), and all 5 claude sessions remain `in-progress`, so the tool axis exists only for the pi lane and 335,953 ms sits unattributed.
- Two P2 measurement defects sit underneath the numbers. The `llmMs` bucket (`8,114,343` ms) exceeds the sum of the per-source `assistantDurationMs` rows (`7,234,180` ms) by `880,163` ms, so LLM time is not reconcilable to its own source rows; and the pairing cost fold reports `$2.696768` under a window whose total cost is `$2.448821`.
- Three pairs of claude steps in the top-20 token leaderboard share identical `(inputTokens, cacheReadTokens, outputTokens, costUsd)` tuples at different timestamps and different durations, `$0.283746` between them. Whether that is a duplicate record or a re-billed call cannot be settled from this artifact alone.
- The outcome axis is `not available` for this window: `taskDenominator` 0, `verifiedResults` 0, every `excludedReasons` bucket 0, `costCoverage` `{covered: 0, total: 0}`. Cost per verified result cannot be computed, and no work in this window is tied to a verified outcome by this artifact.
- The workflow half is healthy on the axes it does measure: 0 tool errors across 220 calls, 0 parse and 0 validation errors across 9 files and 1,026 imported messages, 96.45% of billed input served from cache, and 13 of 14 chained `agent.run` dispatches succeeded with 0 unknown outcomes.
- Baseline comparison verdict: **not comparable**. No trend, delta, or percentage is stated against the baseline anywhere in the report, and every finding is classified `not-comparable`.

## Baseline comparison

**Verdict: `not comparable`.** The daily rule is satisfied in form (the baseline selector is the immediately preceding local calendar day, `2026-10-26`), but coverage differs materially on four independent axes, so no comparison is computed:

1. **Window completeness differs.** The current window is `provisional`: it was generated at `2026-10-27T15:30:13.902Z`, 8.5 h into the local day it measures, with bounds running to `23:59:59.999`. The baseline window is closed — its last instant, `2026-10-26T23:59:59.999-07:00`, precedes baseline generation at `2026-10-27T15:30:13.316Z`. A partial day and a complete day are not an equal-coverage pairing.
2. **Source sets differ.** Current coverage is `claude` + `pi`; baseline coverage is `claude` + `codex` + `pi` (`#/coverage` in each artifact). Codex carried 267 messages and `$7.264754` of the baseline's `$10.113078` — more than two thirds of that window's own cost — so the two windows describe different measurement surfaces and per-source series cannot be paired.
3. **Baseline import freshness is uneven.** In the baseline artifact, `claude` (`2026-10-26T00:30:01.708Z`) and `codex` (`2026-10-26T00:30:02.213Z`) were last imported 39.0 h before baseline generation, while `pi` was imported 25.45 h before it (`2026-10-26T14:03:13.732Z`). Two of the three baseline sources are therefore stale relative to the day they claim to describe, independently of the source-set difference.
4. **Leaderboard slicing is comparable in depth but not in denominator.** Depth is `20` in both artifacts, but the step leaderboards are slices of `324` assistant steps here and `450` there, so no step row is a population total in either artifact and the two slices are not drawn from like populations.

Provenance facts for both windows, listed without arithmetic (this is coverage evidence, not a comparison). Each locator names the artifact it resolves in and the pointer within it; the window-state row locates the run-level provenance file instead.

| Fact | Locator (current artifact · baseline artifact) | Current | Baseline |
| --- | --- | --- | --- |
| Sources with imported records | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/coverage` | claude, pi | claude, codex, pi |
| Window state | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-provenance.json` — `windowState` | provisional | closed (derived from the selector bounds) |
| Sessions in population | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/population/sessions` | 9 | 6 |
| Tool keys | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/population/tools` | 10 | 10 |
| Leaderboard depth applied | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/population/appliedTop` | 20 | 20 |
| Messages | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/totals/messages` | 925 | 1,297 |
| Tool calls | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/totals/toolCalls` | 220 | 429 |
| Assistant steps | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/stepSupport` | 324 | 450 |
| Activity span | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/derived/timeDecomposition/spanMs` | 8,502,446 ms | 21,854,669 ms |
| Billed input tokens | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/totals/inputTokens` | 20,347,703 | 52,893,104 |
| Output tokens | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/totals/outputTokens` | 209,681 | 268,560 |
| Total cost | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/totals/costUsd` | `$2.448821` | `$10.113078` |
| Loop signals | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/population/loops` | 1 | 0 |
| Task denominator | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/verifiedOutcome/taskDenominator` | 0 | 0 |
| Verified results | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` · `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/verifiedOutcome/verifiedResults` | 0 | 0 |

Consequences held throughout this report: section 4 `trend` is `not-comparable` for every finding; section 5 records discrete presence in the baseline (an observation about two artifacts, never a measured change); section 8 analyzes the current window only; no percentage appears anywhere as a change against the baseline.

## Findings

Each finding carries the full field set. `ownerSurface` names the concrete surface that would apply a change; `reproCommand` is one invocation a reader can run verbatim to re-observe the evidence.

### F1 — pi's 94 steps carry 89.62% of assistant duration at a 21× per-step mean

- `key`: `performance:pi-dsv4-1-flash-executor:per-step-latency`
- `category`: `performance`
- `impact`: LLM wait is 95.44% of the 2.36 h activity span, and one executor lane owns essentially all of it. Any throughput or cost-per-result programme that targets the pi executor pairing moves the dominant term; a programme targeting the claude lane, the tool axis, or idle time moves at most 10.38% of assistant duration combined with 4.56% of the span.
- `trend`: `not-comparable`
- `observation`: `#/bySource/pi/assistantDurationMs` is `6,483,205` over `#/stepSupport/1/assistantSteps` `94` — a 68,970 ms mean per step. `#/bySource/claude/assistantDurationMs` is `750,975` over `#/stepSupport/0/assistantSteps` `230` — a 3,265 ms mean on a 230-step denominator, or 3,681 ms on the 204 steps that carry a duration. Eighteen of the 20 rows of `#/topStepsByDuration` are `source` `pi`, spanning 101.8 s to 134.7 s; the remaining two are `claude` rows at 109.9 s and 106.4 s. `#/derived/bottlenecks` ranks `llm` first at `8,114,343` ms and share `0.954354`, with `tool` last at `10,468` ms and share `0.001231`.
- `inference`: The latency concentration is a property of the pi lane rather than of the workload: pi issues 89 tool calls against claude's 131 and still takes 8.6× the assistant duration, while measured tool time across the whole window is only `10,468` ms, so tool execution cannot account for the difference. Named observations: the two per-step means under the same fold, the tool-time total, and the 18-of-20 `pi` composition of the duration leaderboard. The gap between 21× and 18.7× depending on which claude denominator is used (230 steps versus the 204 with a measured duration) is a consequence of F2, not evidence against the concentration.
- `contradictions`: `#/byModel/deepseek-v4-1-flash-261017` carries 8,079,344 input tokens against 91,424 output tokens and costs `$0.674192`, 27.53% of the window total, so the slowest lane is also the cheaper one per output token — the concentration is a latency fact, not a spend fact. Separately, `#/stepSupport/1` shows `stepsWithDuration` 94 of 94 for pi while the claude row shows 204 of 230, so the per-step mean for pi rests on a complete denominator and the claude mean does not; the two means are not equally well supported even though both are computed the same way.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/bySource/pi`, `#/bySource/claude`, `#/stepSupport`, `#/topStepsByDuration`, `#/derived/bottlenecks`
- `severity`: P1
- `reproCommand`: `jq -c '{claude:{ms:.bySource.claude.assistantDurationMs,steps:.stepSupport[0].assistantSteps},pi:{ms:.bySource.pi.assistantDurationMs,steps:.stepSupport[1].assistantSteps}}' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: the `pi-dsv4.1-flash-volc` executor pairing — its model selection, reasoning-effort and dispatch concurrency in the executor routing configuration.

### F2 — every claude tool call is untimed, and no claude session closes

- `key`: `telemetry:spur-history-import:claude-tool-duration-unmeasured`
- `category`: `telemetry`
- `impact`: The tool axis is measured for one lane only. All 131 claude calls — 59.55% of the window's 220 calls — contribute no duration, so `#/derived/timeDecomposition/toolMs` (`10,468` ms) describes pi's 89 calls alone while presenting itself as a window total, and `335,953` ms of the span falls into `unattributedMs`. Tool-time regressions in the claude lane are invisible to this report.
- `trend`: `not-comparable`
- `observation`: Summing `#/byTool[].durationUnmeasured` over the claude-lane tool keys (`Bash` 95, `Read` 22, `Skill` 5, `Write` 4, `Edit` 1, `mcp__plugin_context-mode_context-mode__ctx_execute_file` 2, `mcp__plugin_context-mode_context-mode__ctx_execute` 2) gives 131 unmeasured calls against 131 total calls, with `durationMsTotal` 0 on every one of those rows. The pi-lane keys carry 0 unmeasured calls out of 89 (`bash`, `edit` and `write` each report `durationUnmeasured` 0), with `durationMsTotal` 10,433 + 30 + 5 = 10,468 ms. All 5 claude rows in `#/bySession` carry `sessionState` `in-progress`; all 4 pi rows carry `complete`. `#/warnings/0` states that 335,953 ms could not be attributed to llm/tool/idle because some durations were unmeasured.
- `inference`: The two observations agree on a single seam — the claude lane never emits a terminal or per-call timing record, so the analyzer has nothing to measure with and both the per-call durations and the session terminal state are missing together. Named observations: the 131-of-131 unmeasured claude calls, the 5-of-5 `in-progress` claude sessions against 4-of-4 `complete` pi sessions, and the warning naming unmeasured durations as the cause of the unattributed bucket.
- `contradictions`: `#/coverage/0/status` is `ok` with 5 files, 813 messages, `0` parse errors and `0` validation errors, so the import surface reports clean success while half its tool calls are untimed. The artifact also carries two different counts for duration-less claude steps: `#/bySource/claude/assistantDurationUnmeasured` is `11`, while `#/stepSupport/0` implies 26 (230 − 204) and the current render states "Excluding 26 assistant step(s) without measured duration" (`.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md`, Top Steps by Duration). Separately, `#/derived/timeDecomposition/llmMs` `8,114,343` exceeds the sum of `#/bySource/*/assistantDurationMs` (`750,975` + `6,483,205` = `7,234,180`) by `880,163` ms, so the llm bucket is not reconcilable to its source rows. Hypothesis for that residual (arithmetic coincidence, one signal): the 26 duration-less claude steps receive synthesized durations inside `llmMs` without appearing in `bySource`. Confirmation path: recompute `llmMs` with the derivation disabled and diff against `7,234,180` ms.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/byTool`, `#/bySession`, `#/stepSupport/0`, `#/bySource/claude`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md:115` (Top Steps by Duration exclusion note)
- `severity`: P1
- `reproCommand`: `jq -c '{claudeUnmeasured:([.byTool[]|select(.toolName|test("^[A-Z]|ctx"))|.durationUnmeasured]|add),claudeCalls:([.byTool[]|select(.toolName|test("^[A-Z]|ctx"))|.calls]|add),toolMs:.derived.timeDecomposition.toolMs,llmMs:.derived.timeDecomposition.llmMs,srcAssistMs:([.bySource[].assistantDurationMs]|add)}' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the claude source lane's tool-call and session-terminal record emission, consumed by the `spur history analyze` `byTool` and `stepSupport` folds.

### F3 — ten tool keys describe at most seven tools, and the aliased rows carry no result volume

- `key`: `telemetry:spur-history-analyze:tool-identity-fragmentation`
- `category`: `telemetry`
- `impact`: `#/population/tools` reports `10` while the window contains at most 7 distinct tools, so the tool population is overstated and the two busiest tools are each split across two rows. Shell activity alone is split 70 / 95 across `bash` / `Bash`, and `resultBytes` is 0 for every pi-lane row, so context volume is unmeasurable for 89 calls while the claude-lane equivalents record it (`Read` 147,859 B, `Bash` 76,561 B). Ranking or budgeting tool behaviour by name mis-attributes the largest category.
- `trend`: `not-comparable`
- `observation`: `#/byTool` keys are `bash` (70), `Bash` (95), `edit` (15), `Edit` (1), `write` (4), `Write` (4), `Read` (22), `Skill` (5), `mcp__plugin_context-mode_context-mode__ctx_execute_file` (2), `mcp__plugin_context-mode_context-mode__ctx_execute` (2) — 10 keys, 220 calls. Three conceptual tools appear under both a lowercase and a capitalized key: shell 70 + 95 = 165 calls (75.00%), edit 15 + 1 = 16, write 4 + 4 = 8. `#/coverage` splits the same way: pi contributed exactly the lowercase keys (70 + 15 + 4 = 89) and claude exactly the capitalized ones and the two MCP keys (95 + 22 + 5 + 4 + 1 + 2 + 2 = 131). `resultBytes` is `0` on `bash`, `edit` and `write` and non-zero on `Read` (147,859), `Bash` (76,561), `Write` (868), `Edit` (227), `ctx_execute_file` (252), `ctx_execute` (242) and `Skill` (178).
- `inference`: The split aligns exactly with the source boundary — the pi adapter emits lowercase tool names without a result-size field while the claude adapter emits capitalized names with one — so the fragmentation is an adapter field-mapping difference rather than genuine tool diversity. Named observations: the three alias pairs, the exact per-source partition of lowercase versus capitalized keys, and the zero `resultBytes` confined to the pi-lane rows.
- `contradictions`: The model label is not similarly fragmented this window — `#/byModel` holds exactly two keys, `claude-opus-5` and `deepseek-v4-1-flash-261017`, with no build-stamp duplicates — so the normalization gap is specific to tool naming and result volume rather than a general import-label problem. Tool durations are internally consistent within the instrumented lane (mean 149 ms, max 3,897 ms), so the missing pieces are identity and volume, not timing.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/population/tools`, `#/byModel`
- `severity`: P2
- `reproCommand`: `jq -c '[.byTool[]|{t:.toolName,c:.calls,b:.resultBytes,u:.durationUnmeasured}], {keys:(.byTool|length),shell:([.byTool[]|select(.toolName|ascii_downcase=="bash")|.calls]|add)}' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: the pi and claude importers' tool-record field mapping, surfaced through `spur history analyze`'s `byTool` fold.

### F4 — the pairing cost fold reports more cost than the window contains

- `key`: `telemetry:spur-history-analyze:pairing-cost-not-reconciled`
- `category`: `telemetry`
- `impact`: The pairing fold is the only place cost is attributable to a named stage, and it cannot be reconciled with the window total: `$2.696768` attributed across pairings against `$2.448821` for the whole day. Either the two folds cover different populations or one of them counts twice, so the share-of-window-cost figure that the performance section is supposed to supply is not derivable for this window.
- `trend`: `not-comparable`
- `observation`: `#/pairings[2]` (`executor` `pi-dsv4.1-flash-volc`, `role` `scribe`) carries `totalCostUsd` `2.696768` with `dispatches` 5, `successRate` 1, `failures` 0. Summing every non-null `totalCostUsd` in `#/pairings` gives `2.696768`. `#/totals/costUsd` is `2.448821`, which is `0.247947` lower. `#/pairings[0]` (`claude`, `reviewer`, 5 dispatches) and `#/pairings[1]` (`pi-dsv4.1-flash-volc`, `reviewer`, 4 dispatches) both carry `totalCostUsd` `null` while reporting `meanDurationMs` 393,319.57 and 1,426,936.58 respectively.
- `inference`: The two folds are populated from different evidence planes — the pairing rows keep duration for every dispatch but cost for only one of three pairings — so the excess is most plausibly explained by pairing cost covering dispatches whose provider records fall outside this window’s source set rather than by a double count. Named observations: the `0.247947` exceedance itself, the 2-of-3 null `totalCostUsd` rows that carry a `meanDurationMs`, and the absence of any pairing row naming its own window.
- `contradictions`: `totalCostUsd` `null` on 2 of 3 pairings renders as `not available` under the truthfulness invariant, which is the correct treatment, so the fold is not fabricating values — the defect is reconciliation, not fabrication. The scrivener pairing is also internally consistent (5 dispatches, `successRate` 1, `failures` 0), so nothing here says the dispatch accounting is wrong, only that its cost axis does not tie to `#/totals`.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`, `#/bySource`
- `severity`: P2
- `reproCommand`: `jq -c '{pairSum:([.pairings[].totalCostUsd|select(.!=null)]|add), dayTotal:.totals.costUsd, nullCost:([.pairings[]|select(.totalCostUsd==null)]|length), pairs:.pairings}' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: the pairing analytics fold consumed by `spur history analyze` (the `pairings` projection and its cost join).

### F5 — three pairs of leaderboard steps share identical usage tuples

- `key`: `telemetry:spur-history-import:duplicate-usage-records`
- `category`: `telemetry`
- `impact`: Six of the 20 largest-by-token steps — `$0.283746` of `$2.448821` window cost, 11.59% — are three pairs whose usage and cost are identical to the cent while their timestamps and durations differ. If one row of each pair is a duplicate record, window cost, token totals and per-step latency are all overstated for the lane that owns 72.47% of spend; if both are real, the provider billed the same response twice and the same overstatement exists with a different cause.
- `trend`: `not-comparable`
- `observation`: Grouping `#/topStepsByTokens` by `(inputTokens, cacheReadTokens, outputTokens, costUsd)` yields three claude pairs of length 2: `(2, 124960, 6697, 0.100461)` at `13:54:03.413Z` and `13:55:36.072Z`; `(2, 126810, 1121, 0.016821)` at `15:16:43.473Z` and `15:16:59.212Z`; `(2, 132180, 1639, 0.024591)` at `13:55:57.512Z` and `13:56:18.168Z`. The per-row `durationMs` differ within each pair — for the third pair, 16,242 ms and 20,656 ms — and the current render shows both rows as separate lines in its Top Steps by Total Tokens table (`.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md`, rows 1 and 2). No `pi` rows are duplicated, and grouping the baseline artifact's `#/topStepsByTokens` the same way yields no pairs.
- `inference`: Identical `inputTokens`, `cacheReadTokens`, `outputTokens` and `costUsd` across two records is consistent with one provider response being written twice — a retried request whose first reply was already recorded, or a duplicate import line — rather than with two independent requests that happened to produce an identical output-token count. Named observations: the three exact-tuple pairs, the differing durations within each pair (which rules out one record being a byte-identical copy of the other), and the concentration of all six rows in the claude lane. Bounded to the top 20 of 324 assistant steps; steps outside the leaderboard were not examined, so this is a floor on the pattern, not a window total.
- `contradictions`: `#/stepSupport/0` reports claude `stepsWithUsage` 230 of 230 with no duplicate marker, and `#/bySource/claude/recordsWithUsage` is 129 of 712 messages, so nothing in the fold flags a record as a repeat and the artifact offers no field that distinguishes a duplicate from a genuine re-bill. `#/cacheWaste` is empty (0 steps, 0 tokens) because its filter targets large fresh-input re-sends, which this pattern is not, so the existing waste detector cannot corroborate or refute it.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/topStepsByTokens`, `#/bySource/claude`, `#/cacheWaste`, `#/stepSupport/0`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/topStepsByTokens`
- `severity`: P2
- `reproCommand`: `jq -c '[.topStepsByTokens[]|{ts,src:.source,u:[.inputTokens,.cacheReadTokens,.outputTokens,.costUsd]}]|group_by(.u)|map(select(length>1)|{u:.[0].u,hits:[.[]|{src,ts}]})' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the claude source lane's record de-duplication key, consumed by the `topStepsByTokens` and totals folds.

### F6 — the outcome axis is empty for the window

- `key`: `coverage:spur-task-check:verified-outcome-absent`
- `category`: `coverage`
- `impact`: The only dimension that ties agent activity to verified work contributes nothing: no task entered the fold, so `verifiedRate`, `correctionRate`, `timeToVerified` and `measuredTokensPerVerifiedResult` are all `null` and `costCoverage` is `{covered: 0, total: 0}`. The report can describe 2.36 h and `$2.448821` of effort but cannot state that any of it produced a verified result, so cost-per-verified-result — the metric that would make an efficiency finding actionable — is not computable for this window.
- `trend`: `not-comparable`
- `observation`: `#/verifiedOutcome` reports `taskDenominator` 0, `verifiedResults` 0, `verifiedRate` `null`, `verifiedWithoutCorrection` 0, `verifiedWithoutCorrectionRate` `null`, `correctionCount` 0, `correctionRate` `null`, `retryExhaustedCount` 0, `measuredTokensPerVerifiedResult` `null`, `timeToVerified` `{count: 0, meanMs: null, maxMs: null}`, `costCoverage` `{covered: 0, total: 0}`, and every `excludedReasons` bucket 0 (`notDone`, `forcedDone`, `missingVerdict`, `syntheticVerdict`, `verdictNotPass`, `proofAbsent`, `certifyingRunFailed`).
- `inference`: A zero denominator with every exclusion bucket at zero means no task was in scope for the fold at all, which is a scope gap rather than a proof failure — in contrast to an exclusion-driven zero, which would name a bucket and a reason. Named observations: the zero `taskDenominator`, the all-zero `excludedReasons`, and the zeroed `costCoverage` that follows from both.
- `contradictions`: The window clearly contains task-shaped work — the working tree carries 9 new task files dated this session and 7 modified tracked files (`.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-baseline-enrich.txt`), and the 131 claude tool calls include 16 `edit`/`Edit` calls and 4 `Write` calls — so activity exists that the outcome fold does not see. The artifact records no field explaining why the denominator is 0, so whether the tasks were created after the fold's snapshot or are simply not linked to a verdict cannot be determined here.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-baseline-enrich.txt:1` (first modified path), `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-baseline-enrich.txt:9` (first of the 9 new task files)
- `severity`: P2
- `reproCommand`: `jq -c '.verifiedOutcome|{den:.taskDenominator,verified:.verifiedResults,rate:.verifiedRate,excluded:.excludedReasons,cost:.costCoverage}' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: `spur task check` — the verification gate whose PASS proof the `verifiedOutcome` fold reads, together with the fold's task-window join.

### F7 — phase support claims support with zero phases

- `key`: `telemetry:spur-history-analyze:phase-support-empty`
- `category`: `telemetry`
- `impact`: The per-phase breakdown is the only view that would show where a run stalls between planning, implementation and verification. It renders an extraction-empty row under a flag asserting the dimension is available, so a reader is told the data exists and then shown none. That is worse than an explicit gap, because it can be mistaken for "no stalls occurred".
- `trend`: `not-comparable`
- `observation`: `#/derived/phases` is `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}`. The rendered report's Per-Phase Breakdown table contains one row whose first cell states that a task-tracking signal is present while no phases were extracted, and whose three metric cells are empty (`.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md:62`, Per-Phase Breakdown).
- `inference`: `phaseSupport: "supported"` describes the presence of a task-tracking signal rather than the extraction of phase transitions, and `invalidPhaseCount` 0 is consistent with no extraction having been attempted. Named observations: the `supported` flag, the empty `phases` array, and the renderer's own extraction-empty row.
- `contradictions`: The flag is not false in the narrow sense — a task-tracking signal does exist in the session corpus, and 16 edit calls are consistent with implementation-phase activity — so the label may be a naming defect in the fold rather than a wrong computation.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/derived/phases`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md:62` (Per-Phase Breakdown extraction-empty row)
- `severity`: P3
- `reproCommand`: `jq -c '.derived.phases' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: `spur history analyze` — the `derived.phases` fold and its `phaseSupport` label.

### F8 — the rendered report's title is duplicated inside a stray code fence

- `key`: `workflow:spur-history-report:render-title-corrupted`
- `category`: `workflow`
- `impact`: Both rendered artifacts open with a broken header — a stray fence followed by a self-overlapping title — so any consumer that parses the markdown header, links the first line, or diffs renders across days sees a corrupted and unstable first line. Low blast radius, deterministic, and it degrades the artifact that operators read directly.
- `trend`: `not-comparable`
- `observation`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md:4` reads `# History forensics report — generated 2026-10-27T15:3# History forensics report — generated 2026-10-27T15:30:12.791Z`, preceded at line 3 by an opening fence. `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.md:4` is corrupted identically with its own timestamp `2026-10-27T15:30:13.316Z`.
- `inference`: The shared prefix `…15:3` before the full title indicates the header writer emits the timestamp plus a truncated title, then the complete title — a single renderer path, not per-artifact damage, since the same malformation appears in both renders with only the timestamp differing. Named observations: the identical malformation in two independently rendered files and the truncated-prefix-then-full-title shape at line 4 in each.
- `contradictions`: The artifact JSON is unaffected — `#/generatedAt` is well formed in both — so the defect is confined to the markdown renderer and does not contaminate any computed value in this report.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md:4`, `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.md:4`
- `severity`: P3
- `reproCommand`: `sed -n '1,5p' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md`
- `ownerSurface`: `spur history report` — the markdown header writer used by `--mode forensics`.

### F9 — the window contains the session that generated the report

- `key`: `workflow:history-anatomy:window-includes-generating-session`
- `category`: `workflow`
- `impact`: The report measures a window that includes its own generating run, so a small slice of the measured activity is the act of measuring: 31 messages, 1 tool call and `$0.002256` are the report process itself, and one `Skill` tool call in `#/byTool` belongs to it. The distortion is negligible in magnitude but it makes the "current day" figures non-reproducible — a second run of the same day would measure a different amount of its own overhead — and it is the mechanism by which a self-referential report could in principle amplify its own signals.
- `trend`: `not-comparable`
- `observation`: `#/bySession` includes a claude session `7d14d90e-2d1b-4972-b6da-c0df53cbb2e8` with `startedAt` `2026-10-27T15:30:02.125Z`, `messages` 31, `toolCalls` 1, `tokens` 152, `costUsd` 0.002256, `topTool` `Skill`, `sessionState` `in-progress` — it began 10.7 s before current-artifact generation at `2026-10-27T15:30:12.791Z`. Sub-100k step volume for that session is consistent with a single `Skill` dispatch, and `#/byTool` records exactly 5 `Skill` calls in the window.
- `inference`: A session started single-digit seconds before generation, topping out at one `Skill` call and $0.002, is the history-anatomy invocation observing itself rather than independent operator work. Named observations: the 10.7 s gap between `startedAt` and `generatedAt`, the single tool call of the same type the running operation uses, and the negligible cost share. Hypothesis for which session it is (shared timing evidence only): the enriching session itself, rather than an unrelated concurrent one — confirmation path: compare this session id against the `runId`-adjacent provenance of the run directory once the publisher records the generating session id.
- `contradictions`: The self-observed slice is too small to move the cost or latency aggregates — `$0.002256` of `$2.448821` and 31 of 925 messages — so it does not threaten the validity of any other finding. It is `in-progress` like every other claude session, so it is not distinguishable from them by state, and its 31 messages are 3.35% of the window's message count without contributing measurable cost.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/bySession` (sessionId `7d14d90e-2d1b-4972-b6da-c0df53cbb2e8`), `#/generatedAt`, `#/byTool`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-provenance.json` — `generatedAt`
- `severity`: P3
- `reproCommand`: `jq -c '.generatedAt, (.bySession[]|select(.sessionId|startswith("7d14d90e")))' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: the history-anatomy daily workflow definition (the `kk`/spur workflow that shells `spur history analyze`), which owns window selection at generation time.

## Recurrence ledger

Classification is against the baseline artifact on the stable key. The baseline was found `not comparable` in section 3, so every class is `not-comparable` — no severity, count or impact change is computed or implied. The final column records only whether the same signal class is discretely present in the baseline artifact (an observation about two artifacts, not a measured change) and what would have to happen for a future run to classify the finding.

| Stable key | Recurrence class | Severity now | Discrete baseline presence and what a comparable baseline would need |
| --- | --- | --- | --- |
| `performance:pi-dsv4-1-flash-executor:per-step-latency` | `not-comparable` | P1 | Same class present in both artifacts: the baseline `#/bySource/pi/assistantDurationMs` is `8,183,898` over 357 steps (`#/stepSupport/2`) against claude `144,931` over 49 steps (`#/stepSupport/0`), so the pi lane dominates assistant duration there too. Each figure is stated as its own artifact's value and is not subtracted. A comparable baseline needs both windows to carry the same source set and equal completeness. |
| `telemetry:spur-history-import:claude-tool-duration-unmeasured` | `not-comparable` | P1 | Same class present: the baseline `#/byTool` claude-lane rows (`Bash` 17, `Read` 8, `Write` 1, `Skill` 1, `ctx_execute_file` 1) sum to 28 unmeasured calls out of 28, with `durationMsTotal` 0 on each. A comparable baseline needs a closed current window so a duration-coverage change could be read rather than merely observed. |
| `telemetry:spur-history-analyze:tool-identity-fragmentation` | `not-comparable` | P2 | Same class present: the baseline `#/byTool` also carries the lowercase/capitalized split (`bash` 334 / `Bash` 17, `edit` 11 with no `Edit` key at all, `write` 3 / `Write` 1, `read` 22 / `Read` 8) with `resultBytes` 0 on every lowercase key, across 10 keys. Presence in two artifacts, not a counted change. |
| `telemetry:spur-history-analyze:pairing-cost-not-reconciled` | `not-comparable` | P2 | Same seam present, different shape: the baseline `#/pairings` also mixes a costed row (`pi-dsv4.1-flash-volc` reviewer, `$3.061185`) with an uncosted one (`claude` reviewer, `totalCostUsd` `null`, `meanDurationMs` 384,556.31). The exceedance itself is not observable in the baseline, where the pairing figure sits below its own `#/totals/costUsd` of `$10.113078`; a comparable baseline is needed to tell whether exceedance is new. |
| `telemetry:spur-history-import:duplicate-usage-records` | `not-comparable` | P2 | Not observed in the baseline's 20-row leaderboard: grouping its `#/topStepsByTokens` by usage tuple yields no pair. Bounded absence — steps outside either leaderboard were not examined — so this is neither `new` nor `resolved`; a comparable baseline with equal window completeness would be needed to classify it. |
| `coverage:spur-task-check:verified-outcome-absent` | `not-comparable` | P2 | Same class present: the baseline `#/verifiedOutcome` also reports `taskDenominator` 0 with every `excludedReasons` bucket 0 and `costCoverage` `{covered: 0, total: 0}`. Present in two artifacts, not a measured change. |
| `telemetry:spur-history-analyze:phase-support-empty` | `not-comparable` | P3 | Same class present: the baseline `#/derived/phases` is also `{phaseSupport: "supported", phases: [], invalidPhaseCount: 0}`, and its render carries the same extraction-empty row. |
| `workflow:spur-history-report:render-title-corrupted` | `not-comparable` | P3 | Same class present: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.md:4` is corrupted identically, so the defect is deterministic across both renders of this run. Carries a `file:line` anchor, which satisfies the evidence rule for a process improvement without a second closed window. |
| `workflow:history-anatomy:window-includes-generating-session` | `not-comparable` | P3 | Not present in kind: the baseline window (`2026-10-26`) holds no session started within a minute of its own generation, since its generation instant falls outside the day it measures. A comparable baseline would require two provisional windows generated the same way. |
| `positive:spur-history-import:pi-complete-measurement-axis` | `not-comparable` | P3 | Same class present on the step and tool axes: the baseline `#/stepSupport/2` reports pi `assistantSteps` 357 with `stepsWithUsage`, `stepsWithDuration`, `stepsWithDerivedDuration` and `stepsWithCacheRead` all 357, and every baseline pi-lane `#/byTool` row (`bash`, `edit`, `read`, `write`) reports `durationUnmeasured` 0. The session-terminal axis is weaker there — 3 of 4 baseline pi sessions are `complete` — so the class holds on measurement coverage but not on terminal state. |
| `positive:spur-history-analyze:cache-reuse-healthy` | `not-comparable` | P3 | Same class present at a lower level: the baseline `#/totals` serves 44,667,789 of 52,893,104 billed input tokens from cache (84.45%), and its `#/cacheWaste` is likewise 0 steps and 0 input tokens. Each figure is its own artifact's value and is not subtracted; a comparable baseline is needed before any change in reuse could be read. |
| `positive:spur-history-import:clean-import-and-tool-runs` | `not-comparable` | P3 | Same class present across a wider source set: all three baseline `#/coverage` rows report `parseErrors` 0, `validationErrors` 0 and `unknownRecords` 0, and the baseline `#/byTool[].errors` sum to 0 over 429 calls. Presence in two artifacts, not a counted change. |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `not-comparable` | P3 | Same class present on a smaller population: the baseline `#/pairings` covers 4 dispatches with 1 failure and `unknownOutcomes` 0 on both rows, against 14 dispatches with 1 failure and 0 unknown here. Each figure is its own artifact's value and is not subtracted. |
| `positive:spur-history-import:import-freshness-at-generation` | `not-comparable` | P3 | Not observed in the baseline: its `#/coverage` imports precede baseline generation by 39.0 h (`claude`, `codex`) and 25.45 h (`pi`), so no baseline source was freshly imported at generation. Whether this is `new` needs a comparable baseline rather than this pairing. |

Two independent artifacts in this run carry the tool-fragmentation, phase-support and render defects, which satisfies the evidence rule for the corresponding process improvements; the render defect additionally carries a `file:line` anchor. No finding is downgraded or dropped because its baseline counterpart is absent or differently shaped.

## Telemetry gaps

Dimensions the artifact cannot support. Each renders `not available`; none is inferred from a raw history file.

| Dimension | Rendering | Why | Anchor |
| --- | --- | --- | --- |
| Claude per-call tool duration | `not available` | 131 of 131 claude tool calls unmeasured, `durationMsTotal` 0 on every claude-lane row | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/byTool` |
| Claude session end state | `not available` | 5 of 5 claude sessions report `sessionState` `in-progress`; no terminal record | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/bySession` |
| Duration for 26 claude assistant steps | `not available` | `#/stepSupport/0` `stepsWithDuration` 204 of 230; render excludes them from the duration leaderboard | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/stepSupport/0` |
| Claude token usage on 583 of 712 messages | `not available` | `#/bySource/claude/recordsWithUsage` 129 of 712 | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/bySource/claude` |
| Pi result volume (bash, edit, write) | `not available` | `resultBytes` 0 on all three pi-lane rows (89 calls) | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/byTool` |
| Tool command identity | `not available` | `byTool` carries no command or argument field; loop rows expose only an `argsDigest` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/byTool`, `#/loops` |
| Per-phase breakdown | `not available` | `phaseSupport` `supported` but `phases` is empty | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/derived/phases` |
| Verified-rate, correction-rate, time-to-verified, tokens per verified result | `not available` | `taskDenominator` 0; every rate field `null` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/verifiedOutcome` |
| Per-pairing cost for 2 of 3 pairings | `not available` | `totalCostUsd` `null` on the `claude` reviewer and `pi-dsv4.1-flash-volc` reviewer rows while both report `meanDurationMs` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/pairings` |
| Pairing model identity | `not available` | `model` is `null` on every `#/pairings` row | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/pairings` |
| Workflow digest and provenance model | `not available` | Provenance records `workflowDigest` and `model` as `not available` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-provenance.json` — `workflowDigest`, `model` |
| Codex coverage | `not available` | No codex row in `#/coverage`; the source was not imported for this window | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/coverage` |
| Baseline trend, delta, percentage | `not available` | Baseline declared `not comparable` (section 3) | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/coverage` |

Attribution note for the 3.95% unattributed bucket: the artifact's own warning `derived-unattributed-time` states that 335,953 ms could not be attributed to llm/tool/idle because some durations were unmeasured, and points at the step-support matrix (`#/warnings/0`). That is a gap, not workload; combined with F2 it is the arithmetic shadow of the untimed claude lane rather than idle agent time.

## Remediation options

Proposals only. Nothing below has been applied, no diff is produced, and no command here was run by this report.

**R1 — bring the pi lane's per-step latency under a stated budget** (addresses `performance:pi-dsv4-1-flash-executor:per-step-latency`)

- Owner surface: the `pi-dsv4.1-flash-volc` executor pairing — model selection, reasoning effort and dispatch concurrency in the executor routing configuration.
- Expected impact: the 68,970 ms per-step mean and its 89.62% share of assistant duration become a chosen operating point; a reduction of even a fraction of that mean moves the largest single term in the window's 2.36 h span.
- Verification method: a subsequent artifact reports `#/bySource/pi/assistantDurationMs` divided by `#/stepSupport/1/assistantSteps` at or below the budget the operator sets, with `#/derived/bottlenecks` `llm` share falling below its present `0.954354`.
- Reversibility: reversible — a routing or effort setting; no history is rewritten and the previous configuration can be restored.
- Handoff: `spur task create "performance:pi-dsv4-1-flash-executor:per-step-latency — budget pi per-step latency" --template issue`

**R2 — emit claude tool-call timing and a session terminal record** (addresses `telemetry:spur-history-import:claude-tool-duration-unmeasured`)

- Owner surface: `spur history import` — the claude source lane's per-call and session-end records, consumed by the `byTool` and `stepSupport` folds.
- Expected impact: `toolMs` becomes a window total covering both lanes instead of pi's 89 calls only, the 335,953 ms unattributed bucket shrinks, and the 880,163 ms `llmMs`-versus-sources residual becomes reconcilable instead of absorbed.
- Verification method: `#/byTool` claude-lane rows show `durationUnmeasured` below `calls` with a non-zero `durationMsTotal`, `#/stepSupport/0` `stepsWithDuration` equals `assistantSteps`, and `#/derived/timeDecomposition/llmMs` equals the sum of `#/bySource/*/assistantDurationMs`.
- Reversibility: reversible — importer-only; a re-import rebuilds the affected rows and the previous behaviour returns by reverting the mapping.
- Handoff: `spur task create "telemetry:spur-history-import:claude-tool-duration-unmeasured — emit claude tool timing and session terminal records" --template issue`

**R3 — normalize tool names and carry result size on the pi lane** (addresses `telemetry:spur-history-analyze:tool-identity-fragmentation`)

- Owner surface: the pi and claude importer field mappings, surfaced through the `byTool` fold.
- Expected impact: one key per tool instead of ten keys for at most seven tools, a correct `#/population/tools` count, shell activity reported as 165 calls rather than split 70 / 95, and context volume measurable for 89 pi calls that currently record 0 bytes.
- Verification method: a fresh artifact's `#/byTool` shows one key per tool with no lowercase/capitalized pair, and `resultBytes` is non-zero for `bash`, `edit` and `write` calls whose output was captured.
- Reversibility: reversible — a normalization map plus an added field; older artifacts keep rendering their original keys, so nothing historical is invalidated.
- Handoff: `spur task create "telemetry:spur-history-analyze:tool-identity-fragmentation — normalize tool names and record result size" --template issue`

**R4 — reconcile the pairing cost fold with the window total** (addresses `telemetry:spur-history-analyze:pairing-cost-not-reconciled`)

- Owner surface: the pairing analytics fold's cost join in `spur history analyze`.
- Expected impact: pairing cost becomes a subset of window cost that an operator can divide by, restoring the share-of-window figure that currently cannot be stated, and the 2-of-3 `null` cost cells become either populated or explicitly out of scope.
- Verification method: for a fresh artifact, every non-null `#/pairings[].totalCostUsd` sums to at most `#/totals/costUsd`, and each pairing row names the window or dispatch set its cost covers.
- Reversibility: reversible — a join predicate and a provenance field; no history is mutated.
- Handoff: `spur task create "telemetry:spur-history-analyze:pairing-cost-not-reconciled — reconcile pairing cost with the window total" --template issue`

**R5 — de-duplicate usage-identical records at import** (addresses `telemetry:spur-history-import:duplicate-usage-records`)

- Owner surface: `spur history import` — the claude source lane's record de-duplication key, feeding the totals and `topStepsByTokens` folds.
- Expected impact: establishes whether `$0.283746` of the window's `$2.448821` is double-counted, and either removes the duplication or proves the six rows are distinct billed calls; either outcome makes window cost and claude token totals trustworthy.
- Verification method: grouping a fresh artifact's `#/topStepsByTokens` by usage tuple yields no pair, or the artifact carries an explicit repeat marker on rows that legitimately repeat with a stated reason.
- Reversibility: reversible — a de-duplication key; disabling it restores today's rows on re-import, and the raw session files are untouched.
- Handoff: `spur task create "telemetry:spur-history-import:duplicate-usage-records — de-duplicate usage-identical records" --template issue`

**R6 — populate the outcome fold's task denominator** (addresses `coverage:spur-task-check:verified-outcome-absent`)

- Owner surface: `spur task check` (the proof-producing gate) together with the `verifiedOutcome` fold's task-window join.
- Expected impact: `verifiedRate`, `timeToVerified` and `costCoverage` become computable, so cost-per-verified-result — the metric that would rank the other findings by value — stops rendering `not available` for the whole day.
- Verification method: a subsequent artifact reports a non-zero `#/verifiedOutcome/taskDenominator`, and a non-zero `verifiedResults` or a named non-zero `excludedReasons` bucket identifying why an in-scope task was excluded.
- Reversibility: reversible — a scope/join change in the fold; no verdict data is deleted.
- Handoff: `spur task create "coverage:spur-task-check:verified-outcome-absent — populate the outcome fold task denominator" --template issue`

**R7 — report an empty phase list as unsupported** (addresses `telemetry:spur-history-analyze:phase-support-empty`)

- Owner surface: `spur history analyze` — the `derived.phases` fold and its `phaseSupport` label.
- Expected impact: the per-phase view either shows extracted phases or declares the gap, and the renderer stops emitting a row that reads like extracted content.
- Verification method: `jq -c '.derived.phases' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` returns a non-empty `phases` array when transitions exist, or `phaseSupport` names the absence rather than `supported` whenever `phases` is empty.
- Reversibility: reversible — a label and a render branch.
- Handoff: `spur task create "telemetry:spur-history-analyze:phase-support-empty — report an empty phase list as unsupported" --template issue`

**R8 — emit the render title once** (addresses `workflow:spur-history-report:render-title-corrupted`)

- Owner surface: `spur history report` — the markdown header writer for `--mode forensics`.
- Expected impact: the rendered artifact's first readable line stops contradicting itself and the report no longer opens inside a stray fence, which makes header parsing and cross-day render diffs safe.
- Verification method: `sed -n '1,5p'` on a fresh render shows the title exactly once with no truncated prefix and no unbalanced fence.
- Reversibility: reversible — a renderer-only change; no artifact is rewritten.
- Handoff: `spur task create "workflow:spur-history-report:render-title-corrupted — emit the render title once" --template issue`

**R9 — make the report exclude its own generating session** (addresses `workflow:history-anatomy:window-includes-generating-session`)

- Owner surface: the history-anatomy daily workflow definition that selects the analysis window.
- Expected impact: current-day figures stop including the measurement act, so a re-run of the same day measures the same operator work and the window becomes reproducible; the self-observed 31 messages and `$0.002256` move to an explicitly labelled overhead line.
- Verification method: a subsequent artifact's `#/bySession` contains no session whose `startedAt` falls between the analysis start and `#/generatedAt`, or such a session appears with an explicit self-observation marker.
- Reversibility: reversible — a window/exclusion parameter; the excluded session remains in the corpus and is recovered by reverting it.
- Handoff: `spur task create "workflow:history-anatomy:window-includes-generating-session — exclude the generating session from the window" --template issue`

## Performance analysis

Current-window figures only; the baseline is `not comparable`, so no value here is paired with it.

**Time decomposition** (`#/derived/timeDecomposition`, span 8,502,446 ms = 2.36 h):

| Component | Time | Share of span |
| --- | ---: | ---: |
| LLM latency (assistant duration, summed) | 2.25 h (8,114,343 ms) | 95.44% |
| Unattributed (unmeasured durations) | 5.60 min (335,953 ms) | 3.95% |
| Idle / overhead | 41.68 s (41,682 ms) | 0.49% |
| Tool execution | 10.47 s (10,468 ms) | 0.12% |

Reading: this window is almost entirely LLM wait — the opposite shape from a tool-bound window. The four buckets sum exactly to `spanMs`, so the fold balances internally, but `llmMs` `8,114,343` exceeds the sum of the per-source `assistantDurationMs` rows (`750,975` + `6,483,205` = `7,234,180`) by `880,163` ms, so the llm bucket is not reconcilable to its source rows (F2). Tool time is 0.12% of span and covers only the pi lane, so the tool axis is both tiny and partial. The 3.95% unattributed share is an instrumentation residual, explicitly not workload (`#/warnings/0`).

**Per-step latency by source** (`#/bySource`, `#/stepSupport`) — the axis that explains the decomposition. Means are divided on each source's own `assistantSteps` denominator:

| Source | Assistant steps | Steps with duration | Assistant duration | Mean per step | Share of assistant duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| pi | 94 | 94 (94 complete) | 6,483,205 ms | 68,970 ms | 89.62% |
| claude | 230 | 204 (26 missing) | 750,975 ms | 3,265 ms (3,681 ms over 204) | 10.38% |

The pi lane is 21.1× slower per step on a complete denominator (18.7× against claude's measured-step mean), which is the mechanical reason LLM wait dominates. The claude mean is less well supported: it is divided over 26 steps that carry no duration at all (F2), so the 10.38% share is a floor for claude and a ceiling for pi.

**Tool execution** (`#/byTool`; instrumented total 10,468 ms, all of it pi):

| Tool | Calls | Total | Mean | Max | Unmeasured |
| --- | ---: | ---: | ---: | ---: | ---: |
| bash | 70 | 10,433 ms | 149 ms | 3,897 ms | 0 |
| edit | 15 | 30 ms | 2 ms | 6 ms | 0 |
| write | 4 | 5 ms | 1 ms | 2 ms | 0 |
| Bash | 95 | `not available` | `not available` | `not available` | 95 |
| Read | 22 | `not available` | `not available` | `not available` | 22 |
| Skill | 5 | `not available` | `not available` | `not available` | 5 |
| Write | 4 | `not available` | `not available` | `not available` | 4 |
| ctx_execute_file | 2 | `not available` | `not available` | `not available` | 2 |
| ctx_execute | 2 | `not available` | `not available` | `not available` | 2 |
| Edit | 1 | `not available` | `not available` | `not available` | 1 |

One shell lane is instrumented and the other is not: 149 ms mean over 70 pi `bash` calls, against 95 `Bash` calls with no timing at all. The slowest measured call is 3,897 ms — three orders of magnitude below a tool-bound window, consistent with the 0.12% tool share. Tool name aliasing and the missing `resultBytes` on the pi rows are F3.

**Cost and tokens by source** (`#/bySource`, `#/totals`, total `$2.448821`):

| Source | Messages | Input | Cache read | Cache write | Output | Cost | Share of cost | Cost / 1k output | Cache reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| claude | 712 | 12,268,359 | 11,763,179 | 504,922 | 118,257 | `$1.774629` | 72.47% | $0.01501 | 95.88% |
| pi | 213 | 8,079,344 | 7,862,272 | 0 | 91,424 | `$0.674192` | 27.53% | $0.00737 | 97.31% |

Window totals: billed input 20,347,703 (fresh 217,330 · cache-read 19,625,451 · cache-write 504,922), output 209,681, overall cache-hit ratio 96.45% of billed input, provider usage present on 223 of 925 records. The two cost cells are complementary and both measured, so no cell reads `not available` — unlike a window with a zero-usage source. Claude carries 72.47% of cost on 56.40% of output tokens at a 2.04× higher cost per 1k output tokens, so this window is claude-weighted on spend and pi-weighted on latency — two different conclusions from two different axes, and both are needed before choosing a routing change.

**Chained `agent.run` run cost** (R6 — per-pairing `totalCostUsd` / `meanDurationMs`):

| Executor | Role | Dispatches | Success rate | Failures | Total cost | Mean duration |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `claude` | reviewer | 5 | 1.00 | 0 | `not available` | 393,319.57 ms (6.56 min) |
| `pi-dsv4.1-flash-volc` | reviewer | 4 | 0.75 | 1 | `not available` | 1,426,936.58 ms (23.78 min) |
| `pi-dsv4.1-flash-volc` | scribe | 5 | 1.00 | 0 | `$2.696768` | 1,563,890.22 ms (26.06 min) |

The three pairings cover 14 dispatches with 1 failure and 0 unknown outcomes. Cost is reportable for 1 of 3 pairings; the other two render `not available` rather than zero, per the run-cost rule, so the share-of-window figure is not derivable this window. The figure that is available does not reconcile: `$2.696768` exceeds `#/totals/costUsd` `$2.448821` by `$0.247947` (F4). The window's only dispatch failure sits in the pi `reviewer` pairing at 23.78 min mean, and the pi `scribe` pairing is slower still at 26.06 min mean — the same lane as the F1 latency concentration, so the pi executor is slow as a reviewer and as a scribe as well as as a primary.

**Cache re-send waste** (`#/cacheWaste`): 0 steps, 0 input tokens, empty `topSteps`. The filter targets assistant steps with input above 100,000 tokens and cache reuse below 10%; no step met it. This is a genuine zero for that filter, corroborated by the 96.45% overall cache-hit ratio, not a masked gap — but the same filter does not cover the duplicate-usage pattern in F5, which is a different shape of repeated cost.

**Per-step token concentration** (`#/topStepsByTokens`, top 20 of 324): all 20 rows carry at least 121,344 cache-read tokens, peaking at 132,180 on two rows, and 10 of the 20 are `claude` rows with `inputTokens` 2 — i.e. long cached contexts with almost no fresh input, which is the healthy cache behaviour the 96.45% ratio reflects. Six of those 20 rows are the three duplicate tuples in F5, so the leaderboard's composition should be read with that caveat.

**Bottleneck order** (`#/derived/bottlenecks`): llm 95.44% → unattributed 3.95% → idle 0.49% → tool 0.12%.

## Workflow and process improvements

Numbered prose proposals; each is report-only and requires operator acceptance before any surface changes.

1. **Separate "imported" from "measurable" in the per-source status row.** Both sources report `ok` with zero parse and zero validation errors while one lane contributes no tool timing and no closed session (F2), and the baseline does the same for a lane whose imports were 39.0 h stale (section 3). A status field that cannot be non-`ok` for a partially unmeasurable source carries no information. Owner surface: the per-source coverage contract in `spur history import` / `spur history analyze`. Recurrence basis: the same all-clear-status shape appears in both artifacts of this run.
2. **Declare a window `provisional` inside the report body, not only in provenance.** The current window is provisional by construction — generation happened 8.5 h into the day it measures — yet neither render carries the window state, so a reader of the report alone cannot tell a partial day from a closed one, and the baseline comparison has to rediscover the difference by hand. Owner surface: `spur history report`, the provenance header. Recurrence basis: neither render carries the window state; both `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md:1` and `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.md:1` hold only a generation timestamp and a selector hash.
3. **Give the tool axis an identity dimension before adding any further tool metrics.** The 10 reported keys describe at most 7 tools and the busiest tool is split across two rows (F3); any per-command cost or per-command context analytics needs the label first. Owner surface: `spur history analyze`, the `byTool` fold. Recurrence basis: the baseline `#/byTool` carries the same lowercase/capitalized split with `resultBytes` 0 on every lowercase key.
4. **Treat an unreconcilable aggregate as a gap, not as a number.** Two folds in this artifact fail to tie to their own components: `llmMs` exceeds the sum of per-source assistant durations by 880,163 ms (F2), and pairing cost exceeds the window total by `$0.247947` (F4). Both are currently presented as values with no reconciliation flag, which is the shape the contract forbids for unsupported dimensions — an unsupported figure must read `not available` rather than carry a fabricated or unattributable value. Owner surface: `spur history analyze` fold contracts and `spur history report --mode forensics`. Recurrence basis: two independent fold families in the same artifact, plus the contract anchor at `/Users/robin/.agents/skills/sp-history-anatomy/references/report-contract.md` (Evidence rules, item 3).
5. **Keep the pairing fold as the cost-attribution path, and widen it rather than replace it.** Pairings are the only place a stage is named next to its duration, and they already carry duration for 14 of 14 dispatches even where cost is missing. Widening the fold to populate `totalCostUsd` for every pairing and to name each pairing's dispatch set would answer the question this window cannot. Owner surface: the pairing analytics fold. Recurrence basis: the baseline artifact carries the same fold with the same mix of costed and uncosted rows.
6. **Link the outcome fold to the tasks the window actually touched.** The window contains 9 new task files and 7 modified tracked files, yet `taskDenominator` is 0 (F6), so the only dimension tying effort to verified work is blind to the week's actual work. Owner surface: the `verifiedOutcome` fold's task-window join. Recurrence basis: the baseline artifact also reports `taskDenominator` 0, so this is the second independent window with an empty outcome axis.
7. **Exclude the analysis's own session from the window.** Generation began 10.7 s after a session that then used one `Skill` call — the measuring act is inside the measured window (F9). Small in magnitude, but it makes same-day re-runs non-reproducible. Owner surface: the daily workflow's window selection. Recurrence basis: not observable in the baseline, whose window does not contain its own generation instant; recorded here as a single-window observation with an evidentiary anchor rather than a repeated class.

## Report-only advisories

Standing hygiene observations. Nothing in this section may drive automated behaviour: no interruption, no gating, no auto-retry. Repetition counts are surfaced for a human decision only.

| Signature (tool + argument digest) | Source · session | Repeats | Sequence range | Note |
| --- | --- | ---: | --- | --- |
| `bash` · `3d40e0324de0f1f31ca50b8c03adec4496202d82e6b91f495184bdda30bbe5ab` | pi · `2026-10-27T11-30-04-991Z_01a17d1f-e63d-7431-a129-be14122faba9` | 3 | firstSeq 35 → lastSeq 55 | The window's only loop signal (`#/population/loops` 1), first seen at `2026-10-27T11:48:53.384Z` on model `deepseek-v4-1-flash-261017`, inside the session that also owns 16 of the 20 duration-leaderboard rows (F1). Identical argument digest repeated three times within 20 sequence steps; the digest does not reveal which command, so the likely intent (a poll or retry) cannot be confirmed from this evidence plane. |

The self-observing session in F9 contributes one `Skill` dispatch of the 5 `Skill` calls in `#/byTool`; a single dispatch is not a repeated signature, so its repeat count is `not available` from this evidence plane and it is analysed in F9 rather than tabled here as a repetition.

The artifact exposes repetition only through the loop fold, which reports signatures that repeat at least 3 times (`#/population/loops` = 1 here, 0 in the baseline); repeat counts below that threshold are not available from this evidence plane. A repeated identical signature may be a legitimate poll-for-background-work pattern, so the decision — leave it, change the wait strategy, or add a bounded timeout — stays with the operator. No signature here is proposed as a trigger for any automated behaviour.

## Positive patterns

Held to the same evidence standard as the problems above: observation, inference, and at least one anchor each.

### P1 — the pi lane is fully instrumented on every axis

- `key`: `positive:spur-history-import:pi-complete-measurement-axis`
- `category`: `positive`
- `impact`: Every quantitative claim about latency, tokens, cache behaviour and tool time in this window can be made against at least one lane with a complete denominator. That is what makes F1's 21.1× per-step comparison defensible rather than a guess, and it is the pattern the claude lane should be brought up to (F2).
- `trend`: `not-comparable`
- `observation`: `#/stepSupport/1` reports pi `assistantSteps` 94, `stepsWithUsage` 94, `stepsWithDuration` 94, `stepsWithDerivedDuration` 94, `stepsWithCacheRead` 94 — every step carries usage, a duration and a cache-read figure, with no derived-duration substitution and no gaps. All 4 pi sessions in `#/bySession` carry `sessionState` `complete`. All 3 pi-lane `#/byTool` rows (`bash`, `edit`, `write`) report `durationUnmeasured` 0 with measured totals of 10,433 / 30 / 5 ms.
- `inference`: A source whose step count, usage count, duration count and cache-read count are all identical is emitting a complete measurement record per step, so pi's aggregates are measurable rather than inferred. Named observations: the four equal counts in `#/stepSupport/1`, the 4-of-4 `complete` session states, and the 0 unmeasured calls across the pi tool rows.
- `contradictions`: pi's completeness is not matched by richness — `resultBytes` is 0 on all three of its tool rows and `model` is `null` on its pairing rows, so complete coverage of the timing axis coexists with missing context-volume and pairing identity (F3, F4).
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/stepSupport/1`, `#/bySession` (source `pi`), `#/byTool`
- `severity`: P3
- `reproCommand`: `jq -c '.stepSupport[1], ([.byTool[]|select(.toolName|test("^[a-z]"))|{t:.toolName,u:.durationUnmeasured}]|map(select(.u>0)))' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pi source lane, as the reference implementation the claude lane should match.

### P2 — cache reuse is high and no step met the re-send waste filter

- `key`: `positive:spur-history-analyze:cache-reuse-healthy`
- `category`: `positive`
- `impact`: 96.45% of the window's 20,347,703 billed input tokens were served from cache, so the dominant input-cost term is already near its floor for these context sizes. This is the reason the window's spend is only `$2.448821` despite 20.3M billed input tokens, and it means cache work is not a priority relative to the latency finding.
- `trend`: `not-comparable`
- `observation`: `#/totals/cacheReadTokens` `19,625,451` against `#/totals/inputTokens` `20,347,703` — 96.45%. By source: claude 11,763,179 of 12,268,359 (95.88%), pi 7,862,272 of 8,079,344 (97.31%). `#/cacheWaste` reports `steps` 0, `inputTokens` 0, `topSteps` `[]` — no assistant step had input above 100,000 tokens with cache reuse below 10%.
- `inference`: Both the aggregate ratio and the waste filter agree that context re-sends wasted nothing measurable this window: a high cache-read share and an empty waste list are two independent signals pointing the same way. Named observations: the per-source and total cache-read ratios, and the empty `#/cacheWaste`.
- `contradictions`: The cache-waste filter is narrow (input > 100,000 with < 10% reuse) and therefore cannot see the duplicate-usage pattern in F5, which is repeated cost without being a cache miss; and cache reuse is a ratio, not a cost statement — the claude lane still carries 72.47% of spend at 95.88% reuse because its absolute input volume is larger.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/cacheWaste`
- `severity`: P3
- `reproCommand`: `jq -c '{tot:(.totals.cacheReadTokens/.totals.inputTokens), bySource:(.bySource|to_entries|map({s:.key,r:(.value.cacheReadTokens/.value.inputTokens)})), waste:.cacheWaste}' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: the executor pairing configuration — the prompt-cache settings currently in force across both lanes.

### P3 — 220 tool calls and 1,026 imported messages produced no errors

- `key`: `positive:spur-history-import:clean-import-and-tool-runs`
- `category`: `positive`
- `impact`: The evidence plane itself is trustworthy on its error axis: no tool call failed and no record was rejected, so the gaps found in this report are all measurement-coverage gaps rather than import corruption. Nothing in the report needs a caveat about lost or malformed data.
- `trend`: `not-comparable`
- `observation`: `#/byTool[].errors` is 0 for all 10 tool keys, summing over 220 calls. `#/coverage` reports `parseErrors` 0, `validationErrors` 0, `unknownRecords` 0, `parseErrorSamples` `[]` and `validationErrorSamples` `[]` for both sources — 5 claude files with 813 messages and 4 pi files with 213, 1,026 messages and 220 tool calls imported cleanly.
- `inference`: Zero errors across every tool key plus zero parse/validation/unknown counts across all 9 files means the importers read this window's corpus without loss or rejection, so the artifact's content is complete relative to what the sources recorded. Named observations: the all-zero `errors` column and the all-zero error counters in `#/coverage`.
- `contradictions`: A clean error axis says nothing about coverage: the same `#/coverage` rows report `ok` while the claude lane carries 131 untimed tool calls (F2) and 583 messages without usage, so "no errors" must not be read as "fully measured".
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/byTool`, `#/coverage`
- `severity`: P3
- `reproCommand`: `jq -c '{toolErrors:([.byTool[].errors]|add), calls:([.byTool[].calls]|add), coverage:[.coverage[]|{s:.source,p:.parseErrors,v:.validationErrors,u:.unknownRecords}]}' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — both source lanes and their validation path.

### P4 — 13 of 14 chained agent.run dispatches succeeded with no unknown outcomes

- `key`: `positive:spur-history-analyze:pairing-dispatch-reliability`
- `category`: `positive`
- `impact`: Chained delegation worked this window: 14 dispatches across three pairings, 13 successes, 1 failure, and no unknown outcome anywhere — so the orchestration path itself is not a source of unaccounted work. Combined with P3 it means the window has no unexplained failures on either the tool or the dispatch axis.
- `trend`: `not-comparable`
- `observation`: `#/pairings` reports `claude`/`reviewer` 5 dispatches `successRate` 1 with `failures` 0; `pi-dsv4.1-flash-volc`/`reviewer` 4 dispatches `successRate` 0.75 with `failures` 1; `pi-dsv4.1-flash-volc`/`scribe` 5 dispatches `successRate` 1 with `failures` 0. `unknownOutcomes` is 0 on all three rows and `escalations` is `{}` on all three.
- `inference`: Dispatches total 14 with 1 recorded failure and 0 unknown outcomes, which means every dispatch reached a terminal and classified state. Named observations: the three per-pairing dispatch and success counts, and the zero `unknownOutcomes`/`escalations` across all rows.
- `contradictions`: The single failure sits in the second-slowest pairing (`pi-dsv4.1-flash-volc` reviewer, 1,426,936.58 ms mean, behind the 1,563,890.22 ms scribe mean), the same lane as the F1 latency concentration, so reliability and latency are not independent of each other here; and cost is missing for 2 of 3 pairings (F4), so "no unaccounted failures" does not extend to "no unaccounted cost".
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/pairings`
- `severity`: P3
- `reproCommand`: `jq -c '[.pairings[]|{e:.executor,r:.role,d:.dispatches,s:.successRate,f:.failures,u:.unknownOutcomes}]' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: the `agent.run` dispatch path and the pairing analytics fold in `spur history analyze`.

### P5 — both sources were imported within four seconds of artifact generation

- `key`: `positive:spur-history-import:import-freshness-at-generation`
- `category`: `positive`
- `impact`: The current artifact describes the corpus as it stood three seconds before the artifact was built, so nothing in this report is stale relative to the importer. That is what allows the findings above to be attributed to the window rather than to a lagging import — contrast the baseline, where two of three sources were 39.0 h stale.
- `trend`: `not-comparable`
- `observation`: `#/coverage[0]` (claude) `lastImportedAt` `2026-10-27T15:30:10.644Z` and `#/coverage[1]` (pi) `2026-10-27T15:30:09.116Z`, against `#/generatedAt` `2026-10-27T15:30:12.791Z` — 2.15 s and 3.68 s before generation. Both rows report `status` `ok`.
- `inference`: Import timestamps that precede generation by single-digit seconds indicate the import ran as part of the same pipeline invocation rather than being reused from an earlier run, which is consistent with `cacheDisposition` `miss`. Named observations: the two sub-four-second gaps and the miss disposition.
- `contradictions`: Freshness is not completeness — the import was current in time while the claude lane still carried 131 untimed tool calls and 583 usage-less messages (F2), and it covers only two sources, with codex absent entirely.
- `evidenceAnchor`: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/coverage`, `#/generatedAt`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-provenance.json` — `cacheDisposition`
- `severity`: P3
- `reproCommand`: `jq -c '{gen:.generatedAt, imports:[.coverage[]|{s:.source,at:.lastImportedAt,st:.status}]}' .spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json`
- `ownerSurface`: `spur history import` — the pipeline's import step and its ordering relative to `spur history analyze`.

## Evidence ledger

Every finding's anchors, for verification against the evidence plane. Locators resolve in the artifact named in backticks.

| Finding key | Artifact anchor(s) |
| --- | --- |
| `performance:pi-dsv4-1-flash-executor:per-step-latency` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/bySource/pi`, `#/bySource/claude`, `#/stepSupport`, `#/topStepsByDuration`, `#/derived/bottlenecks` |
| `telemetry:spur-history-import:claude-tool-duration-unmeasured` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/byTool`, `#/bySession`, `#/stepSupport/0`, `#/bySource/claude`, `#/derived/timeDecomposition`, `#/warnings/0`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md:115` |
| `telemetry:spur-history-analyze:tool-identity-fragmentation` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/byTool`, `#/coverage`, `#/population/tools`, `#/byModel` |
| `telemetry:spur-history-analyze:pairing-cost-not-reconciled` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/pairings`, `#/totals/costUsd`, `#/bySource` |
| `telemetry:spur-history-import:duplicate-usage-records` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/topStepsByTokens`, `#/bySource/claude`, `#/cacheWaste`, `#/stepSupport/0`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` — `#/topStepsByTokens` |
| `coverage:spur-task-check:verified-outcome-absent` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/verifiedOutcome`, `#/byTool`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-baseline-enrich.txt:1`, `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-baseline-enrich.txt:9` |
| `telemetry:spur-history-analyze:phase-support-empty` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/derived/phases`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md:62` |
| `workflow:spur-history-report:render-title-corrupted` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.md:4`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.md:4` |
| `workflow:history-anatomy:window-includes-generating-session` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/bySession` (sessionId `7d14d90e-2d1b-4972-b6da-c0df53cbb2e8`), `#/generatedAt`, `#/byTool`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-provenance.json` — `generatedAt` |
| `positive:spur-history-import:pi-complete-measurement-axis` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/stepSupport/1`, `#/bySession` (source `pi`), `#/byTool` |
| `positive:spur-history-analyze:cache-reuse-healthy` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/totals`, `#/bySource`, `#/cacheWaste` |
| `positive:spur-history-import:clean-import-and-tool-runs` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/byTool`, `#/coverage` |
| `positive:spur-history-analyze:pairing-dispatch-reliability` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/pairings` |
| `positive:spur-history-import:import-freshness-at-generation` | `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-current.json` — `#/coverage`, `#/generatedAt`; `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-provenance.json` — `cacheDisposition` |

Baseline artifacts cited in section 3 and section 5: `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.json` (`#/coverage`, `#/bySource`, `#/byTool`, `#/bySession`, `#/stepSupport`, `#/pairings`, `#/verifiedOutcome`, `#/derived/phases`, `#/derived/timeDecomposition`, `#/topStepsByTokens`) and `.spur/run/4ea3002c-bf2b-4ddb-824e-1a85c67ef331-history-anatomy-baseline.md:4`.

Two limitations of this report's own evidence, stated rather than masked: the current window is provisional, so every current-window figure is a partial-day fact; and no comparison against `2026-10-26` is stated anywhere, because that baseline was found `not comparable` on four independent axes in section 3.

