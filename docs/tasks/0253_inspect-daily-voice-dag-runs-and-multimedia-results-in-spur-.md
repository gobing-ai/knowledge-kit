---
schema_version: 1
name: Inspect daily voice DAG runs and multimedia results in Spur Board
status: done
template: feature-impl
created_at: 2026-10-11T23:22:42.778Z
updated_at: "2026-10-12T06:43:50.018Z"
feature_id: G8
priority: P2
tags:
  - board
  - workflows
estimate_hours: 8

dependencies: ["0252"]
ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0253-verdict.json
---

## 0253. Inspect daily voice DAG runs and multimedia results in Spur Board

### Background

Feature G8; accepted design docs/design/workflow-board-modules.md and ADR-035. Implements: R3 — Summary separates execution status from result outcome; R5 — Daily voice results show content audio and channel outcomes; R8 — Daily progress preserves DAG branches and nested evidence; R9 — Configuration distinguishes current defaults and recorded run values; R10 — No runs and unavailable artifacts have explicit states; R11 — Overwritten workspaces never impersonate historical outputs; R13 — Refreshing and connection failures preserve a truthful view.

Ownership: apps/board/src/daily-voice/** (new), apps/board/src shared UI only where behavior repeats, apps/cli/src/board daily projection/capture, plugins/kk/workflows/kk-daily-ai-voice2.yaml, apps/cli/src/commands/daily.ts, .spur/config.yaml, browser/package outputs and corresponding fixtures/docs.

Verified source premises: docs/design/workflow-board-modules.md section 9; installed @gobing-ai/spur 0.4.2 public ABI and observed run APIs; existing CLI/stage preparation symbols and artifact writers inspected during this ready audit.

Rubric: E8 D1 L3 C1 R1 = 14; retain this cohesive deliverable with steps in Plan. Dependencies are the persisted frontmatter WBS edges; their explicit handoff is frozen in Design.

**Refine corrections (2026-10-11)**
- DAG fallback left as an implementation-time choice → live installed 0.4.2 progress emits state-oriented rows and orphan-action-row diagnostics → freeze public run-detail node/attempt fallback.
- Daily preparation location/default workspace only loosely identified → prepareAction resolves configured works root which may be outside the checkout → capture that exact child directory at the existing prepare seam.
- Run capture settings and definition unspecified → engine injects __definitionDigest and existing __runId → forward the frozen typed capture inputs and digest-check topology.
- Same-day supersession only checked by owner marker → current producer can still see earlier cached files → require selected-run producer success before displaying artifacts.
- Section audio treated as existing → ADR-034 is accepted design, not required shipped output → show recorded final audio now and sections only if actually described by outputs.
- Acceptance checkbox titles lacked requirement/test binding → executable feature-title scenarios are available → bind every local R item and name its observing test file.
- Dependency referenced a volatile sidecar → frontmatter already depends on 0252 → freeze the exact shared contracts consumed and daily projection handed to 0255.

**Consumed from 0252 (2026-10-12).** The reader/capture contract is shipped and frozen — consume it,
do not clone it. Four constraints the 0252 verify pass surfaced for this task:

1. **Media bytes are fetched AFTER the owner re-check.** `artifactContent`
   (`apps/cli/src/board/reader.ts:603`) re-reads the file for `image|audio` kinds after
   `artifactFor` has compared the pre/post marker. Harmless today (`COLLECT_ARTIFACTS` is json/text
   only) but a media descriptor you register would inherit it: read the bytes inside `observe`
   (before the check) or re-verify ownership after the fetch, and extend the P2 fixtures.
2. **`captureRun`'s works root is structural, not project-bound.** The guard accepts any path with a
   `.works`/`works` segment and refuses `/`, home, the project root, its ancestors and a works root
   itself (`apps/cli/src/board/capture.ts:309`). The daily default workspace lives under the
   configured works root (`~/.config/kk/works/...`, `apps/cli/src/commands/daily.ts:113`), which is
   outside the project — pass that root explicitly rather than widening the guard.
3. **Progress rows now carry `timing` (durationMs / startedAt→completedAt / `timing unknown`) and
   `operatorWait`, derived only from recorded evidence.** Reuse them for the DAG view; do not
   re-derive a percentage.
4. **The progress route 404s on an orphan-row diagnostic** instead of returning diagnostics, so a
   DAG run can lose the whole projection — fall back to `/api/runs/<id>` action rows and mark the
   dependency edges unavailable rather than inventing them.

### Requirements

- [x] R1. Ship the Daily AI Voice native module with all four tabs and the shared stable run-selection behavior.
- [x] R2. Project available article, cover, script, audio, quality/safety report and per-channel draft/live/skipped/failure outcomes with previews and range-capable playback/download.
- [x] R3. Display recorded DAG dependencies/node attempts/retry siblings without an invented sequential stage, skipped state or percentage; expose nested safety linkage only when recorded.
- [x] R4. Capture sanitized effective daily settings before output generation and reject superseded same-day artifacts while preserving recorded config/progress; keep publishing and scheduling unchanged.
- [x] R5. Reuse Settings → Workflows for definition browsing, YAML/copy and static graphs; link /board/settings/workflows and expose only captured run settings in the module. No duplicate current-definition endpoint.

Non-goals: no execution/edit/publish controls, extra workflow-definition UI/API, raw store reads, arbitrary file access, upstream Spur edits or paid/live workflow runs. Preserve existing unrelated behavior.

### Acceptance Criteria

```gherkin
Feature: G8 task 0253

  Scenario: AC1 — Summary separates execution status from result outcome (req: R1)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a completed run with partial publishing and a failed run with available outputs
    When the operator opens Summary for each run
    Then the view shows run identity, start time, elapsed time, execution status, known result outcome, counts, freshness and diagnostics without calling partial results fully successful

  Scenario: AC2 — Daily voice results show content audio and channel outcomes (req: R2)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a daily voice run with an article, cover, script, audio and mixed channel result files
    When the operator opens Results
    Then the view previews available article and cover, plays and downloads audio, links available script and report, and distinguishes per-channel draft, live, skipped and failed outcomes

  Scenario: AC3 — Daily progress preserves DAG branches and nested evidence (req: R3)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a daily voice DAG run with concurrent nodes, skipped branches, retry siblings and nested safety work
    When the operator opens Execution progress
    Then the view shows dependency relationships and actual node states, separates retries, and links nested evidence when a child run identity is recorded without claiming a single current stage or invented percentage

  Scenario: AC4 — Configuration distinguishes current defaults and recorded run values (req: R4; R5)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a workflow changed after a run and a newer run with captured sanitized effective configuration
    When the operator opens Workflow Config Summary for both runs
    Then the view shows sanitized recorded run values and captured schedule overrides with provenance, marks uncaptured historical values unknown, and links to Settings Workflows for the current definition and defaults without duplicating its viewer

  Scenario: AC5 — No runs and unavailable artifacts have explicit states (req: R1; R2)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a workflow with no runs or a selected run with missing, malformed, oversized or unfinished outputs
    When the operator opens its module
    Then the view distinguishes no runs, pending, unavailable, invalid and truncated evidence and keeps other tabs usable

  Scenario: AC6 — Overwritten workspaces never impersonate historical outputs (req: R4)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given two run IDs share one workspace and the later run owns its artifacts
    When the operator selects the earlier run
    Then the view retains its recorded progress and sanitized config but marks artifact content superseded or unverifiable rather than displaying later outputs as earlier results

  Scenario: AC7 — Refreshing and connection failures preserve a truthful view (req: R1)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a selected active run and then a reader or Spur API outage
    When the automatic refresh occurs
    Then the view labels stale data with its last successful update, keeps available progress separate from artifact failures, preserves selection and offers manual refresh without overlapping requests
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:52:23.287Z

Closed ready-audit decisions (2026-10-11): use section 9 frozen APIs and artifact-only projections; existing Settings owns definitions; no current-definition endpoint. Capture revocation failure stops before overwriting results; optional capture failure after revocation only warns. Missing historical/config/producer/topology evidence stays unknown. Future audio sections are optional. Dependency contracts and named observing tests are fixed in Design. No open product decision remains.

### Design

Reuse the Collect slice foundation. The installed live DAG projection is state-oriented and incomplete; use supported run-detail action rows for node attempts and digest-verified captured topology for edges, with a deterministic regression fixture. Link Settings for the current static graph; unknown historical node/dependency evidence stays unknown. Do not modify Spur or implement an engine. Daily preparation creates the run binding after resolving work_dir and before any output producer; data applies to the selected __runId, not date/latest anchors. Same-date older content becomes superseded; captured config remains readable. Media streams only from the run-owned allowlist and supports byte ranges; previews do not load entire audio into memory. Parse existing Content/Result/report shapes and preserve semantic channel outcomes independently of engine status. Captured settings use section 9's numeric/boolean/enum allowlists; current configuration belongs in Settings. No raw commands, free-text profile identifiers or provider secrets. Existing production DAG dependencies, safety behavior, caches and publish defaults remain intact.

Execution budget: one task pipeline pass, at most two focused correction passes; preserve failing evidence and request replanning if the concrete integration contract differs. New production diff required; a planning-only result cannot satisfy this task. Persist fixtures/test evidence with the task and implementation; .spur/run scratch is volatile. No drive-by refactors or GitHub workflow changes.

Settings → Workflows owns current definitions, dropdown, YAML/copy and static graphs. Link /board/settings/workflows; its current dropdown has no workflow-selection URL contract. Config Summary owns only sanitized recorded run values, capture provenance and explicit unknowns. Do not create a current-definition reader endpoint or duplicate viewer. Run-specific progress remains in the module.

Consume 0252's shared UI/types, identity-checked HTTP reader, captureRun, artifact policy and build hook; do not re-own them. Produce apps/board/src/daily-voice/index.tsx and apps/cli/src/board/daily-voice.ts, daily fixtures and the enabled built contribution for 0255. Follow section 9 names and capture options. No new server or definition/config viewer.

The live installed 0.4.2 DAG progress probe returned state-oriented rows with orphan-action-row diagnostics. Use public run-detail actions keyed by node plus action ID for actual node attempts, and captured digest-verified topology for run dependency edges. No evidence means unknown; keep retry siblings distinct and child safety links only when recorded. Missing captured topology links Settings for current structure without calling it historical. Capture at daily.ts:prepareAction, preserving voice1 and direct callers with no Board run flags. Use the explicit captured workspace even when outside the project, never derive it from latest anchors/date/mtime. Require successful selected-run producers before exposing cached or new media. Future ADR-034 section audio is optional until actual output descriptors exist.

Audit baseline: git worktree list shows this main checkout only; spur task list --status wip is empty. Prior authorized uncommitted G8/discovery changes are retained. Recheck these facts at implementation startup; they do not authorize reverting another contributor. Execution budget remains one pipeline pass plus at most two focused correction passes. Persist durable fixtures in the named test areas and verification evidence through Spur; scratch under .spur/run is not the sole handoff.

### Plan

1. (R1) Read 0252 contracts and fixtures; confirm installed list/detail API shapes and the saved live DAG limitation. Add the daily-voice native entry using shared run-selection/polling and four tabs.
2. (R4) Thread explicit run/digest/allowlisted values into daily.ts:prepareAction and freeze exact workspace ownership before result producers; test configured external child roots, no-Board direct callers and unchanged voice1 behavior.
3. (R2) Map current article/cover/script/final audio, report, quality/safety and per-target outputs to fixed producer nodes; require selected-run success for cached files, and show absent future section audio explicitly.
4. (R3) Project DAG actions/retry siblings with captured dependency edges and unknown historical gaps; show nested child linkage only when recorded. Add deterministic retry/no-content/partial-channel fixtures.
5. (R1/R5) Use captured config plus /board/settings/workflows link, enable only the built daily entry and hand its projection/fixtures to 0255. Test shared run links and stale/reader-outage behavior.
6. (R1-R5) Run section 9 daily tests and existing daily/voice2 regressions, then lint, full unit suite, workspace build and rule presets; update the actual shipped surface docs.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/board/src/shared/run-selection.ts:130` |
| `apps/board/src/shared/run-selection.ts:149` |
| `apps/board/src/shared/run-selection.ts:155` |
| `apps/cli/src/board/capture.ts:135` |
| `apps/cli/src/board/capture.ts:281` |
| `apps/cli/src/board/capture.ts:352` |
| `apps/cli/src/board/capture.ts:363` |
| `apps/cli/src/board/capture.ts:366` |
| `apps/cli/src/board/collect.ts:113` |
| `apps/cli/src/board/collect.ts:95` |
| `apps/cli/src/board/manifest.ts:106` |
| `apps/cli/src/board/manifest.ts:149` |
| `apps/cli/src/board/manifest.ts:275` |
| `apps/cli/src/board/manifest.ts:74` |
| `apps/cli/src/board/reader.ts:14` |
| `apps/cli/src/board/reader.ts:346` |
| `apps/cli/src/board/reader.ts:357` |
| `apps/cli/src/board/reader.ts:360` |
| `apps/cli/src/board/reader.ts:383` |
| `apps/cli/src/board/reader.ts:390` |
| `apps/cli/src/board/reader.ts:4` |
| `apps/cli/src/board/reader.ts:405` |
| `apps/cli/src/board/reader.ts:410` |
| `apps/cli/src/board/reader.ts:460` |
| `apps/cli/src/board/reader.ts:486` |
| `apps/cli/src/board/reader.ts:490` |
| `apps/cli/src/board/reader.ts:505` |
| `apps/cli/src/commands/daily.ts:164` |
| `apps/cli/src/commands/daily.ts:243` |
| `apps/cli/src/commands/daily.ts:4` |
| `apps/cli/src/commands/daily.ts:488` |
| `apps/cli/src/commands/daily.ts:522` |
| `apps/cli/src/commands/daily.ts:56` |
| `apps/cli/src/commands/daily.ts:7` |
| `docs/04_DESIGN.md:343` |
| `docs/04_DESIGN.md:367` |
| `docs/04_DESIGN.md:376` |
| `plugins/kk/workflows/kk-daily-ai-voice2.yaml:117` |
| `plugins/kk/workflows/kk-daily-ai-voice2.yaml:85` |
| `scripts/build-board.ts:41` |
| `apps/board/src/daily-voice/index.css:1` |
| `apps/board/src/daily-voice/index.tsx:1` |
| `apps/board/src/daily-voice/view.ts:1` |
| `apps/board/tests/daily-voice/view.test.ts:1` |
| `apps/cli/src/board/daily-voice.ts:1` |
| `apps/cli/tests/board/daily-voice.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Four tabs + shared run selection are shipped and exercised: `apps/board/src/daily-voice/index.tsx:44-49` maps all four `BOARD_TABS` and `:200-211` renders them; deep link → selection → address-bar write-back reuse the shared module (`apps/board/src/daily-voice/index.tsx:87-200`). Test `apps/board/tests/shared/run-selection.test.ts:129` (`ships exactly the four tabs`) and `:64` (URL write-back) pass in the board suite run this session (53 pass / 0 fail / 166 expect). The `modulePath` extension (`apps/board/src/shared/run-selection.ts:130-160`) leaves the Collect default unchanged (`apps/board/tests/shared/run-selection.test.ts:76`). |
| R2 | MET | Shape-aware channel projection `apps/cli/src/board/daily-voice.ts:327-368` reads both recorded result shapes (fan-out `targets[]` and the single top-level `Result` object). Tests: `apps/cli/tests/board/daily-voice.test.ts:460` (route: surfdash live, podcast live, xhs draft, wechat draft, article/quality/safety), `:295` (present-but-failed → error, url withheld), `:542` (audio 206 byte range, `content-type: audio/mpeg`, 416 refusal); previews/links `apps/board/src/daily-voice/index.tsx:271-345`. Independent probe (real writers, run this session): draft `.json` from xhs-pub/wechatmp-pub → `draft`, fan-out aggregate → `live` + url, locale sync literal → `draft`, 0 failed channels. |
| R3 | MET | Node attempts come from run-detail action rows keyed by node (`apps/cli/src/board/daily-voice.ts:225-239`), progress is projected only from recorded evidence (`:296-325`: attempts, recorded timing, `edgesKnown` only for a digest-verified capture, `childRunId` only when the safety row recorded one), and the reader never calls the 404-ing DAG `/progress` route for node specs (`apps/cli/src/board/reader.ts:346-390`). Tests: `apps/cli/tests/board/daily-voice.test.ts:485` (failed primary vs passed retry sibling stay distinct), `:500` (captured edges + nested safety child run), `:225` (no topology → null edges), `apps/board/tests/daily-voice/view.test.ts:109` (null edges → `edgesKnown` false). No sequential stage, skipped state or percentage is derived anywhere in `projectProgress`. |
| R4 | MET | Capture runs after the workspace is composed and before any producer (`apps/cli/src/commands/daily.ts:164-208,243-257`), values are allowlist-validated at the trust boundary (`apps/cli/src/board/capture.ts:83-104`) and the external configured works root is accepted only as an explicitly passed canonical child (`apps/cli/src/board/capture.ts:281-296,349-366`). Tests: `apps/cli/tests/board/daily-voice.test.ts:609` (captures into the configured external works root; a no-flag caller composes and captures nothing), `:566` (same-day later owner → artifacts superseded + diagnostic), `:581` (root itself, untrusted external path and the home/project tree refused). Publishing and scheduling are untouched: `git diff -- plugins/kk/workflows/kk-daily-ai-voice2.yaml` adds only the `__definitionDigest` var plus the prepare-node `--setting` flags, and `.spur/config.yaml` is unmodified (`git status --porcelain`). Regressions `apps/cli/tests/commands/daily.test.ts:87` and `apps/cli/tests/voice2-dag.test.ts:976` pass. |
| R5 | MET | `apps/board/src/daily-voice/index.tsx:387-410` renders only the captured `RunConfig.settings` + `unavailableKeys` + capture timestamp and links `/board/settings/workflows`; the reader route surface is unchanged at health/results/config/artifacts with no definition endpoint (`apps/cli/src/board/reader.ts:537-555`). Config route behaviour is pinned by `apps/cli/tests/board/reader.test.ts:246-251` (`capturedAt` + `unavailableKeys: ['horizon_hours']`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Summary separates execution status from result outcome (req: R1) | MET | test | `apps/board/tests/daily-voice/view.test.ts:135` keeps `Execution status` apart from `Result outcome` and labels every unknown; `:150` renders a partial outcome with failed channels and `1/2 artifacts available`; run identity/start/elapsed/freshness/diagnostics wiring `apps/board/src/daily-voice/index.tsx:169-193,254-268`; `apps/cli/tests/board/daily-voice.test.ts:460` pins the served `status`/`outcome`. |
| AC2 — Daily voice results show content audio and channel outcomes (req: R2) | MET | test | `apps/cli/tests/board/daily-voice.test.ts:460` (article title, quality 98, safety verdict, surfdash live / podcast live / xhs draft / wechat draft), `:542` (audio 206 range `audio/mpeg` + 416), `:295` (failed target → `error`); plus the real-writer probe (11/11): real xhs-pub draft `.json` → `draft`, real wechatmp-pub draft `.json` → `draft`, real fan-out aggregate → `live`, real locale sync literal → `draft`, `counts.failed` 0. |
| AC3 — Daily progress preserves DAG branches and nested evidence (req: R3) | MET | test | `apps/cli/tests/board/daily-voice.test.ts:485` (concurrent-failure primary and retry sibling stay two distinct nodes), `:500` (dependency edges only from a digest-verified capture; nested safety child run shown only when its action recorded one), `:225` (no recorded topology → `edges: null`, `edgesKnown: false`), `apps/board/tests/daily-voice/view.test.ts:109` (null edges stay unknown in the view). |
| AC4 — Configuration distinguishes current defaults and recorded run values (req: R4; R5) | MET | test | `apps/cli/tests/board/reader.test.ts:246-251` (config route serves `capturedAt` and states the uncaptured `horizon_hours` in `unavailableKeys`); `apps/cli/tests/board/daily-voice.test.ts:609` records the allowlisted run values — the scheduler's launch overrides are the same path (`.spur/config.yaml:111` passes `publish_enabled`/`skip_review`, forwarded to `--setting` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:116-132`); the panel shows only captured values and links Settings → Workflows (`apps/board/src/daily-voice/index.tsx:387-410`). |
| AC5 — No runs and unavailable artifacts have explicit states (req: R1; R2) | MET | test | `apps/cli/tests/board/daily-voice.test.ts:402` (malformed JSON evidence → explicit absent, no throw), `:359` (no-content outcome explicit, channels `unavailable`), `:529` (failed producer → artifact `missing` + 404, never stale bytes); `apps/cli/tests/board/reader.test.ts:326` (over-cap evidence reported `oversized`, never truncated) and `:552` (structurally invalid stored evidence); pending/unavailable/skipped channel states `apps/cli/tests/board/daily-voice.test.ts:273-338`; the no-runs state and per-tab independence `apps/board/src/daily-voice/index.tsx:224-249`. |
| AC6 — Overwritten workspaces never impersonate historical outputs (req: R4) | MET | test | `apps/cli/tests/board/daily-voice.test.ts:566` (two run ids in one workspace; the earlier run's artifacts become `superseded` with the diagnostic while its record stays readable), `:445` (foreign owner → every artifact superseded), `:581` (trusted works-root guard refuses the root, home/config tree, project, ancestors, prefixes, `..` and out-of-root symlinks). |
| AC7 — Refreshing and connection failures preserve a truthful view (req: R1) | MET | test | `apps/board/tests/shared/refresh.test.ts:15` (a tick while a request is pending is ignored — no overlapping requests), `:28` (last success kept while failing, backoff capped at 30s), `:38` (never presents stale data as fresh); selection preserved through `apps/board/tests/shared/run-selection.test.ts:41`; outage diagnostics, manual Refresh and the per-source busy guards `apps/board/src/daily-voice/index.tsx:100-161,186-188`; a foreign Board origin is refused at the reader (`apps/cli/tests/board/daily-voice.test.ts:558`). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature G8; ADR-035 (including ready-audit ownership amendment).
- docs/design/workflow-board-modules.md section 9: frozen names, types, capture timing, ownership and test handoff.
- docs/plans/2026-10-11-G8-ready-refinement.md: durable checklist/corrections report.
- Installed Spur 0.4.2: board/index.d.ts and web/board-runtime.json; public HTTP list/detail/progress contracts verified against the running project Board. Sibling Spur source was read only for contract inspection, never a runtime/package dependency.
- Existing project worktree only; no active wip tasks at audit. Prior authorized changes remain in the shared checkout.

### History

- 2026-10-12T06:43:04.897Z todo → testing (system)
- 2026-10-12T06:43:50.007Z testing → done (system)

