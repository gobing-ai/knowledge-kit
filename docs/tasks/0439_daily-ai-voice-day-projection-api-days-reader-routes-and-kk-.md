---
schema_version: 1
name: Daily AI Voice day projection, /api/days reader routes and kk news digest
status: done
template: feature-impl
created_at: 2026-11-26T00:29:45.929Z
updated_at: "2026-11-26T03:11:28.169Z"
feature_id: G83
priority: P1
tags:
  - board
  - daily-ai-voice
  - reader
  - cli

estimate_hours: 10
done_forced: "false"
done_reason: unforced close
---

## 0439. Daily AI Voice day projection, /api/days reader routes and kk news digest

### Background

Feature G83 replaces the run-centric Daily AI Voice module with a day-centric ops console. This task builds the shared read path every surface consumes.

Implements: R2 — One shared day projection joins generation, publish windows and safety; R4 — The digest is available from the CLI as markdown and JSON; R8 — Every attention item and detail row offers a pre-filled redo recipe; R12 — Unknowns and missing evidence stay explicit across the console

Design: docs/design/daily-voice-ops-console.md §1–§3, §5.

**Refine corrections (2026-11-25)** — premises audited against the current tree:

1. **Publish windows are file-based, not a kk-publish run join.** The reader never reads kk-publish Spur runs: `kk-publish` is not a `WorkflowName` (`apps/board/src/contracts.ts:11`), and `publishingEvidence` (`apps/cli/src/board/news.ts`, around line 254) projects windows from `<day>/4-publish/{plan,check,outcome,settlement}.<window>.json`. A window's run id and launch status come from `<day>/4-publish/schedule-receipt.<window>.json`, written by `apps/cli/src/commands/content-launch.ts:525`; its fields include `runId`, `window`, `status` and `exitCode`. R1's "kk-publish runs bound to that work_dir" and R6's "unbound evidence" therefore mean the per-window receipt and files. A window with no receipt and no plan is `not-run`. A plan with no receipt is `unknown`, with reason `no-launch-receipt`.
2. **Generation attempts** come from the capture records `.works/.board/runs/<runId>.json` (`BOARD_RUNS_REL`, `apps/cli/src/board/capture.ts`) where `workflow === 'kk-news-generate'` and `workspacePath` is the day directory. The newest `capturedAt` is the current attempt. `<day>/schedule-receipt.json` supplies the launch status.
3. **There is no `ReaderContext` type.** Reader helpers take `{ projectPath, fs }`, for example `storeOverview({ projectPath, fs }, runIds)`. Use that shape.
4. **Query parameters:** `apps/cli/src/board/reader.ts:666-668` says the G81 store views are the only routes that take query parameters. `/api/days?from&until` adds a `parseDaysQuery(url.searchParams)` that returns `{response}` on error, following `parseRunsQuery`, and updates that comment.
5. **Reuse the news projection.** `projectNewsResults` (`news.ts:469`), `publishingEvidence`, `engineAttempts` and `projectProgress` (`apps/cli/src/board/daily-voice.ts:308`) already compute engines, progress and window targets. `projectDay` composes them and does not reimplement them.

### Requirements

- [x] R1. `projectDay({projectPath, fs}, day)` in `apps/cli/src/board/day.ts` joins the day's sources into one `DailyDigest` with per-figure sources:
  - the kk-news-generate attempts (capture records whose `workspacePath` is the day dir, plus `schedule-receipt.json`);
  - the per-window publish evidence (`4-publish/*.<window>.json` and `schedule-receipt.<window>.json`);
  - the safety outcome.
- [x] R2. Status is worst-of per the satellite. The closed attention rule set emits severity-ordered items, and each item carries recipes.
- [x] R3. `resolveArgv(kind, params)` in `apps/cli/src/board/actions.ts` produces recipe argv from validated params only. No free text is accepted.
- [x] R4. The reader serves GET `/api/days/<YYYYMMDD>` and `/api/days?from&until` (at most 31 days) under the existing loopback and origin rules.
- [x] R5. `kk news digest --run-date <day> [--json]` renders the same digest. A missing day exits nonzero and names the path it looked up.
- [x] R6. Missing evidence reads as unknown with a reason, never as zero or success. Examples: no receipt, an unreadable file, a running receipt.

### Acceptance Criteria

- [x] AC1 — One shared day projection joins generation, publish windows and safety
- [x] AC2 — The digest is available from the CLI as markdown and JSON
- [x] AC3 — Every attention item and detail row offers a pre-filled redo recipe
- [x] AC4 — Unknowns and missing evidence stay explicit across the console

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T01:08:52.679Z

- **Q: Join kk-publish Spur runs, or read the day dir?** A: Read the day dir. It holds per-window receipts (`runId`, `status`) and plan/outcome/settlement files, and kk-publish is not a reader workflow. Adding kk-publish to `WorkflowName` is deferred until a run-level publish drill-down is needed.
- **Q: How does a `running` receipt whose process died read?** A: As `running`, with the source named, until the receipt is rewritten. The digest does not probe processes. `ponytail:` stale-running is possible after a crash; add a Spur run-detail probe if it shows up in practice.
- **Q: Where does safety come from?** A: The day's `4-safety-variants` verdict files. A missing verdict means `unknown`. The parent-level `ledger.md` and `conclusion.md` are not per-day evidence.
- **Q: Who owns the `ReaderContext` name?** A: Nobody. Use the existing `{projectPath, fs}` shape.

### Design

**Chosen.** One projection module in `apps/cli/src/board/`. The reader routes and the CLI verb both consume it, so the Board and the CLI cannot disagree.

**Rejected:**
- A projection in `apps/board`: the CLI could not reuse it.
- A join on kk-publish Spur runs: kk-publish is not a reader `WorkflowName`, and the day dir already holds per-window receipts.
- Shelling out to `spur workflow profile` from the reader: the reads would be unbounded and process-backed.

**Frozen names and paths:**
- `apps/cli/src/board/day.ts`:
  - `projectDay(ctx: { projectPath: string; fs: …same fs type the reader helpers use }, day: string): Promise<DailyDigest | DayNotFound>`
  - `listDays(ctx, from: string, until: string): Promise<DaySummary[]>`
  - `DayNotFound = { notFound: true; lookedUp: string }`
- `apps/cli/src/board/actions.ts`:
  - `type ActionKind = 'generate-from-node' | 'publish-retry' | 'publish-window' | 'rerender-step' | 'cancel-run' | 'store-release'`
  - `resolveArgv(kind, params): { argv: string[]; dryRunArgv?: string[]; live: boolean }`, which throws a typed `ActionParamError` on invalid params.
- Contracts in `apps/board/src/contracts.ts`: `DailyDigest`, `DaySummary`, `DayStatus = 'ok' | 'attention' | 'failed' | 'running' | 'unknown'`, `AttentionItem`, `Recipe`, `ActionKind` (re-exported).
- Day key regex: `^\d{8}$`. Day dir: `<works>/kk-news-generate/<day>/`.
- Window ids: `PUBLISH_WINDOWS` (`news.ts:40`).

**Source map:**

| Digest part | Source |
| --- | --- |
| Generation attempts | capture records filtered by `workspacePath` |
| Generation status | `schedule-receipt.json` |
| Generation engines and progress | `projectNewsResults` over the newest attempt |
| Node durations | `step-timing.json` (`{step, startedAt, endedAt}[]`) |
| Windows | `publishingEvidence`, plus `4-publish/schedule-receipt.<window>.json` for `runId` and launch status |
| Safety | `4-safety-variants/*safety-verdict.status`, `*_09_safety-judge_verdict.json` |

`ledger.md` and `conclusion.md` live at `<works>/kk-news-generate/` (the parent), not per day. Safety therefore reads the day's verdict files only; the conclusion line is optional and best-effort.

**Recipe argv (frozen):**
- `generate-from-node`: `['spur','workflow','run','plugins/kk/workflows/kk-news-generate.yaml','--from',node,'--from-run',runId,'--async','--json']`
- `publish-retry`: `['kk','news','publish','--run-date',day,'--window',w,'--retry', …(channels ? ['--channels',csv] : [])]`, with `dryRunArgv` = the same plus `--dry-run`, and `live: true`.
- `publish-window`: `['kk','news','publish','--run-date',day,'--window',w, …(dummy ? ['--dummy'] : [])]`, with `live: !dummy`.
- `rerender-step`:
  - `voice`: `['kk','news','generate-voice','--work-dir',dayDir, …(engine ? ['--engine',engine] : [])]`, where `engine` must be in the `--help` enum: voxcpm, gemini, omnivoice, voicebox, vibe-voice.
  - `cards` and `render`: `--work-dir` only.
- `cancel-run`: `['spur','workflow','cancel',runId,'--json']`.
- `store-release`: `['kk','store','release','--run',runId]`.

`node` must be in the run topology's nodes, read from the capture record `topology.nodes`. Otherwise it is refused.

**Anti-patterns:**
- Reading kk.db or the store.
- Following receipt or plan paths as links.
- Inferring success from a missing file.
- Free-text params.
- Building argv anywhere except `resolveArgv`.
- `listDays` reading more than 31 dirs.

**Handoff:**
- 0440 consumes `DailyDigest`, `DaySummary`, `Recipe` and the two routes.
- 0441 consumes `DailyDigest.generation.attempts[].runId` and the existing per-run routes.
- 0442 consumes `resolveArgv`, `ActionKind` and `ActionParamError` unchanged.

**Tests (per AC), all `bun:test`:**

| AC | Test file | Covers |
| --- | --- | --- |
| AC1 | `apps/cli/tests/board-day.test.ts` | fixture day dirs: join, worst-of status, sources |
| AC2 | `apps/cli/tests/news-digest.test.ts` | markdown and JSON output, missing-day exit code and path |
| AC3 | `apps/cli/tests/board-actions-argv.test.ts` | every kind, invalid params refused |
| AC4 | `board-day.test.ts` | the unknown cases: no receipt, plan without receipt, running receipt, unreadable JSON |

The reader routes are covered in `apps/cli/tests/board-reader*.test.ts`, extending the existing pattern, including the query-param refusals and the 31-day cap.

Surface shapes land in `docs/04_DESIGN.md` in the same commit (T3).

### Plan

- Write the failure list first (missing day, unbound publish run, live run, refused generation, failed target with effect none, provenance mismatch).
- Implement `projectDay` / `listDays` and the attention rules against fixture day dirs.
- Implement `resolveArgv` with per-kind param validation.
- Add the two reader routes.
- Add `kk news digest` and its 04 surface entry.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `apps/cli/src/board/day.ts` | 1-620 | New: `projectDay()` / `listDays()` join the day's generation attempts (capture records), per-window publish evidence and safety verdict into one `DailyDigest`. Capture records are the only authority for "this run belongs to that day"; every read goes through `observeRelative` containment; no Board call and no store read. |
| `apps/cli/src/board/day.ts` | 150-300 | Worst-of status (`running > failed > attention > ok`, `unknown` when nothing was recorded) and the closed attention rule set (generation-failed/refused, window-not-run past its slot, target-failed, provenance-mismatch, safety-flag), each carrying its evidence and recipes. |
| `apps/cli/src/board/actions.ts` | 1-260 | New: `resolveArgv(kind, params)` — the single argv mapping the digest renders and the action plane will execute. Closed key sets per kind, no free text, typed `ActionParamError`; `recipeOf` returns null instead of a half-valid recipe. |
| `apps/cli/src/board/digest.ts` | 1-115 | New: markdown renderers for one digest and the day list. Presentation only — unknown renders as `unknown (<reason>)`, recipes as copyable commands, an empty attention list as an explicit all-clear. |
| `apps/cli/src/board/news.ts` | 244-260, 304, 398, 446 | Exported `publishingEvidence`/`bundleEvidence` for reuse instead of reimplementation, and normalized the plan/outcome run-date comparison (`2026-11-25` vs the `20261125` stamp) so a real day no longer reads as a provenance mismatch. |
| `apps/cli/src/board/reader.ts` | 701-725, 754-780, 947-963 | `GET /api/days/<YYYYMMDD>` and `GET /api/days?from&until`, matched before the no-query-parameter gate; `parseDaysQuery` validates the 31-day bound (the span is computed from the digit key, not `Date.parse` of a non-ISO string). |
| `apps/cli/src/commands/content.ts` | 30-35, 60-70, 500-560 | `kk news digest --run-date <day> [--json]` and `--days --from/--until`; missing day exits 1 naming the looked-up path, malformed input exits 2. |
| `apps/board/src/contracts.ts` | 283-420 | `DailyDigest`, `DaySummary`, `DayStatus`, `DayGeneration`, `DayWindow`, `DaySafety`, `AttentionItem`, `Recipe`, `ActionKind`, `DayAttempt`, `DayNodeDuration` — the shapes 0440-0442 consume unchanged. |
| `apps/cli/tests/board/board-day.test.ts` | 1-430 | AC1/AC4: the join and its sources, worst-of status, every unknown case, the attention rules and their recipes, `listDays` bounds. |
| `apps/cli/tests/board/board-actions-argv.test.ts` | 1-215 | AC3: every kind's frozen argv, and each refusal (unknown kind, foreign key, free text, bad day/window/channel/runId, engine on a non-voice step, escaping `dayDir`). |
| `apps/cli/tests/board/news-digest.test.ts` | 1-330 | AC2: markdown vs `--json` equality, missing-day exit 1 with the path, malformed exit 2, `--days`, and the renderer's unknown/all-clear/recipe output. |
| `apps/cli/tests/board/reader-days.test.ts` | 1-140 | The two routes: 200 digest, 404 with the path, 400 for a bad key or any query, the bounded list, and every refused range. |
| `docs/04_DESIGN.md` | 425-441, 1461-1467, 1487-1488 | T3 surface: the two routes and their status vocabulary, the `kk news digest` verb and its exit codes. |

Deliberate limits, recorded rather than hidden:

- `DayContext.worksDir` is optional and defaults to `<project>/.works`; the CLI wires the configured root, the reader uses the default (the compiled layout), so an external works root is a CLI-side fact today.
- `engine-fallback` is in the closed rule set but is not emitted: the fallback chain lives in run-detail action rows, which the file-backed projection does not have. 0441 owns the Generation tab that reads them; no invented guess was added here.
- A failed generation names a resume node only when `step-timing.json` recorded a start without an end; otherwise the item says the node is unrecorded and carries no recipe.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 `projectDay({projectPath, fs}, day)` joins generation attempts, per-window publish evidence and safety, with per-figure sources | MET | `apps/cli/src/board/day.ts:591` (entry), `:180` (`captureIndex` — attempts keyed by the capture record's `workspacePath`), `:256` (`windowLaunch` — per-window receipt), `:196` (`safetyOf`), `:530` (sources map); `apps/cli/tests/board/day.test.ts:170` asserts every source key |
| R2 Worst-of status; closed severity-ordered attention rule set, each item carrying recipes | MET | `apps/cli/src/board/day.ts:423` (`worstOf`), `:296` (`attentionItems`), `:420`/`:547` (severity sort); `apps/cli/tests/board/day.test.ts:250,300,340,380,420,440` |
| R3 `resolveArgv(kind, params)` produces recipe argv from validated params only, no free text | MET | `apps/cli/src/board/actions.ts:116`, validation helpers `:62-113`, `ActionParamError` `:45`; `apps/cli/tests/board/actions.test.ts:88-160` (every refusal) |
| R4 Reader serves `GET /api/days/<YYYYMMDD>` and `/api/days?from&until` (≤31 days) under the existing loopback/origin rules | MET | `apps/cli/src/board/reader.ts:754` (route match before the no-parameter gate), `:701`/`:716` (handlers), `:947` (`parseDaysQuery`, span from the digit key); origin/host/method gates above them unchanged (`:735-750`); `apps/cli/tests/board/reader-days.test.ts:64` |
| R5 `kk news digest --run-date <day> [--json]` renders the same digest; missing day exits nonzero naming the path | MET | `apps/cli/src/commands/content.ts:501,517`; `apps/cli/tests/board/digest.test.ts:109,127` (exit 1 + path, markdown/JSON equality) |
| R6 Missing evidence reads unknown with a reason, never zero/success | MET | `apps/cli/src/board/day.ts:238` (`no-launch-receipt`), `:120` (`unrecognized-launch-status`), `:453` (`unknown` when nothing recorded), `:210` (bundle safety fallback); `apps/cli/tests/board/day.test.ts:216,235,250,265,290` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 One shared day projection joins generation, publish windows and safety | MET | test | `apps/cli/tests/board/day.test.ts:170`; `apps/cli/src/board/day.ts:591` |
| AC2 The digest is available from the CLI as markdown and JSON | MET | test | `apps/cli/tests/board/digest.test.ts:109` (both modes read the same digest; missing day exits 1 with the path) |
| AC3 Every attention item and detail row offers a pre-filled redo recipe | MET | test | `apps/cli/tests/board/actions.test.ts:28-80` (frozen argv per kind), `apps/cli/tests/board/day.test.ts:340` (target-failed recipe + dry run), `:420` (resume recipe); refusals carry none by design (`:380`) |
| AC4 Unknowns and missing evidence stay explicit | MET | test | `apps/cli/tests/board/day.test.ts:216-300` (no directory, plan without receipt, malformed receipt, unknown status, empty day, no judge confidence) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: `docs/features/G83_daily-ai-voice-ops-console-day-centric-digest-debug-tabs-and-guarded-redo-tools.md`
- Design satellite: `docs/design/daily-voice-ops-console.md` (index row `docs/04_DESIGN.md:64`)
- Decision: `docs/00_ADR.md:1417` (ADR-035 amendment 2026-11-25)
- Brainstorm: `docs/plans/2026-11-25-daily-ai-voice-ops-console-brainstorm.md`
- Code anchors: `apps/cli/src/board/reader.ts:666-724`, `apps/cli/src/board/news.ts:40,58-160,254,469`, `apps/cli/src/board/daily-voice.ts:308`, `apps/cli/src/board/capture.ts` (`BOARD_RUNS_REL`), `apps/cli/src/commands/content-launch.ts:525`, `apps/board/src/contracts.ts:11,44,250`
- Follow-ups: G84 (in-board artifact editor), G85 (digest push notification)

### History

- 2026-11-26T01:56:12.109Z todo → wip (system)
- 2026-11-26T03:11:26.025Z wip → testing (system)
- 2026-11-26T03:11:28.160Z testing → done (system)

