---
schema_version: 1
name: Inspect collection runs through a native Board module and local reader
status: done
template: feature-impl
created_at: 2026-10-11T23:22:42.773Z
updated_at: "2026-10-12T04:39:19.780Z"
feature_id: G8
priority: P2
tags:
  - board
  - workflows
estimate_hours: 12

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0252-verdict.json
---

## 0252. Inspect collection runs through a native Board module and local reader

### Background

Feature G8; accepted design docs/design/workflow-board-modules.md and ADR-035. Implements: R2 — Run selection stays consistent across all four tabs; R3 — Summary separates execution status from result outcome; R4 — Collect results show ingestion and labeling evidence; R7 — Progress preserves state visits and retries; R9 — Configuration distinguishes current defaults and recorded run values; R10 — No runs and unavailable artifacts have explicit states; R11 — Overwritten workspaces never impersonate historical outputs; R12 — Artifact access is limited to the selected project and run; R13 — Refreshing and connection failures preserve a truthful view.

Ownership: apps/board/** (new), apps/cli/src/board/** (new), apps/cli/src/commands/board.ts (new), apps/cli/src/cli.ts, plugins/kk/workflows/kk-collect.yaml, plugins/kk/scripts/kk-workflow-stages.ts, package.json, apps/cli/package.json, scripts/bundle-plugins.ts, .spur/config.yaml and corresponding tests/docs.

Verified source premises: docs/design/workflow-board-modules.md section 9; installed @gobing-ai/spur 0.4.2 public ABI and observed run APIs; existing CLI/stage preparation symbols and artifact writers inspected during this ready audit.

Rubric: E12 D1 L3 C1 R1 = 18; retain this cohesive deliverable with steps in Plan. No predecessor.


Also implements R15 — Workflow definitions remain in Settings Workflows.

**Refine corrections (2026-10-11)**
- Unverified file-line premises → inspected collectPrepare, lock state, store stdout and CLI registration → replace speculative anchors with current symbol references.
- Current/store projections left open → store-result.json is inserted/updated/unchanged and label-result.txt is aggregate evidence → artifacts-only reader; absent per-label detail stays unavailable.
- New workspace owner treated as sufficient → old files remain until producers finish → revoke old owner and require exact successful producer evidence before serving content.
- Browser identity check alone → reader also needs execution authority → validate project/run via supported Board HTTP APIs in the reader.
- Capture CLI/type names unspecified → frozen section 9 contract → use captureRun and declared run/digest vars without inventing APIs.
- Browser packaging assumed existing staging → CLI prepack only builds CLI/plugins → invoke the shared Bun browser build explicitly from root build and prepack.
- Foundation AC claimed all three modules → daily/ITC implementations depend on this task → final three-module proof belongs solely to 0255; keep Collect foundation observable here.
- Workflow relocation described as future work → symlink and catalog/browser proof already exist → preserve that topology and verify it, do not repeat the move.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The contribution ABI is `apiVersion: 1`, the entry exports `webModule`, and the component renders inside the host's own React tree without `createRoot` | installed `@gobing-ai/spur` declaration-only `./board` export | Read `node_modules/@gobing-ai/spur/board/index.d.ts:21,24,27,38` (0.4.2) | HIGH |
| The host advertises `react`, `react/jsx-runtime` and `react/jsx-dev-runtime` (plus `react-dom`, `react-dom/client`, `react-router`, `react-router/dom`) at React 19.2.1 / ReactDOM 19.2.1 / React Router 7.11.0 | installed `web/board-runtime.json` | Read `node_modules/@gobing-ai/spur/web/board-runtime.json:4-11`; all seven named `web/_astro/board-facade-*.js` assets exist on disk | HIGH |
| A module declaration is a `.strict()` discriminated `react`/`iframe` union with `id` matching `^[a-z][a-z0-9-]*$`; a duplicate id or a reserved-identity collision is refused at config load, and the host derives the route as `/modules/<id>` | installed bundle `boardModuleDeclarationSchema`, `validateBoardModuleDeclarations`, `BOARD_MODULE_ROUTE_PREFIX` and `web/board-runtime.json` `reservedModules` | Read the emitted zod shapes, the collision check and the route constant in `node_modules/@gobing-ai/spur/spur.js` (0.4.2) | HIGH |
| `bootstrap.modules` is validated by the RUNTIME schema only — the shipped `schemas/spur-config.schema.json` `bootstrap` block lists just logging/telemetry/database/scheduler | installed `schemas/spur-config.schema.json:20` and the bundle's `bootstrapSectionSchema` | Read both in `node_modules/@gobing-ai/spur` (0.4.2); the consequence (enable a module only after its assets exist) is in docs/04_DESIGN.md | HIGH |
| The runs API is `/api/runs` (with `workflow`, `limit`, `cursor`, `status`, `since`), `/api/runs/:runId`, `/api/runs/:runId/progress` and `/api/runs/by-wbs/:wbs`, and the progress route answers 404 `RUN_NOT_FOUND` once the projection carries an `orphan-row` diagnostic | installed bundle route registrations and `projectWorkflowProgress` | Read the `app.get` handlers and the orphan-row guard in `node_modules/@gobing-ai/spur/spur.js` (0.4.2) | HIGH |
| §9's literal read protocol (`O_NOFOLLOW`, a held descriptor, `fstat` on the descriptor) is not implementable here: `no-direct-fs-io` is an error over `apps/**/src/**` and the `@gobing-ai/ts-runtime` `FileSystem` seam exposes no open/fd primitive | `.spur/rules/strict/runtime-boundaries.yaml` and the installed `FileSystem` declaration | Read both; the reader therefore implements the behavioural guarantee (re-resolve, pre/post-read stat, post-read owner re-verification with `404 board.artifact.owner-changed`) and the residual is recorded in `.spur/memory/runs/g8-0252-465e601c.md` as an open operator decision | HIGH |

### Requirements

- [x] R1. Ship a native Collect module with the four tabs, stable run/tab deep links, paged run selection and truthful summary/refresh states.
- [x] R2. Implement the minimal read-only local reader and exact project/run/artifact access checks, recorded run config projection, sanitized run capture and same-folder supersession behavior.
- [x] R3. Expose run-bound artifact-backed source/ingestion/aggregate-label/facts results and recorded state progress without triggering any pipeline operation.
- [x] R4. Build and distribute the first native entry with host React externalized; preserve all existing CLI/workflow behavior and include fixtures, setup notes and surface docs.
- [x] R5. Reuse Settings → Workflows for definition browsing, YAML/copy and static graphs; link /board/settings/workflows and expose only captured run settings in the module. No duplicate current-definition endpoint.

Non-goals: no execution/edit/publish controls, extra workflow-definition UI/API, raw store reads, arbitrary file access, upstream Spur edits or paid/live workflow runs. Preserve existing unrelated behavior.

### Acceptance Criteria

```gherkin
Feature: G8 task 0252

  Scenario: AC1 — Run selection stays consistent across all four tabs (req: R1; R4)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given two runs of a workflow with different outputs
    When the operator selects the older run and changes tabs
    Then Summary, Results, Execution progress and Workflow Config Summary all retain that run ID and the URL preserves run and tab selection

  Scenario: AC2 — Summary separates execution status from result outcome (req: R1)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a completed run with partial publishing and a failed run with available outputs
    When the operator opens Summary for each run
    Then the view shows run identity, start time, elapsed time, execution status, known result outcome, counts, freshness and diagnostics without calling partial results fully successful

  Scenario: AC3 — Collect results show ingestion and labeling evidence (req: R3)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a collection run with source counts, inserted and updated counts, facts and label results
    When the operator opens Results
    Then the view shows available source and label counts, confidence and fallback information, facts preview and downloads without inventing absent counts

  Scenario: AC4 — Progress preserves state visits and retries (req: R3)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a collection or IT Content run with a repeated state, a failed action and an operator pause
    When the operator opens Execution progress
    Then the view shows recorded state visits and attempts, timings, pause or failure diagnostics and pending or skipped work without triggering an execution action

  Scenario: AC5 — Configuration distinguishes current defaults and recorded run values (req: R2; R5)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a workflow changed after a run and a newer run with captured sanitized effective configuration
    When the operator opens Workflow Config Summary for both runs
    Then the view shows sanitized recorded run values and captured schedule overrides with provenance, marks uncaptured historical values unknown, and links to Settings Workflows for the current definition and defaults without duplicating its viewer

  Scenario: AC6 — No runs and unavailable artifacts have explicit states (req: R1; R2)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a workflow with no runs or a selected run with missing, malformed, oversized or unfinished outputs
    When the operator opens its module
    Then the view distinguishes no runs, pending, unavailable, invalid and truncated evidence and keeps other tabs usable

  Scenario: AC7 — Overwritten workspaces never impersonate historical outputs (req: R2)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given two run IDs share one workspace and the later run owns its artifacts
    When the operator selects the earlier run
    Then the view retains its recorded progress and sanitized config but marks artifact content superseded or unverifiable rather than displaying later outputs as earlier results

  Scenario: AC8 — Artifact access is limited to the selected project and run (req: R2)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a running local reader and requests for another project, workflow, unlisted artifact, traversal path or escaping symlink
    When the requests reach the reader
    Then access is refused and only allowlisted run-bound files and sanitized config are readable from the configured Board origin

  Scenario: AC9 — Refreshing and connection failures preserve a truthful view (req: R1)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a selected active run and then a reader or Spur API outage
    When the automatic refresh occurs
    Then the view labels stale data with its last successful update, keeps available progress separate from artifact failures, preserves selection and offers manual refresh without overlapping requests

  Scenario: AC10 — Workflow definitions remain in Settings Workflows (req: R5)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given repository workflows have one canonical home under plugins/kk/workflows and .spur/workflows is its relative symlink
    When the operator follows the module configuration link to /board/settings/workflows
    Then the existing dropdown lists kk-collect, kk-daily-ai-voice2 and kk-itc once each, existing YAML and static graph controls remain authoritative, and .spur/workflows/feature-verification.yaml resolves to the canonical file
    And the modules provide no duplicate definition browser, YAML viewer, static graph or current-definition reader endpoint
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:52:20.593Z

Closed ready-audit decisions (2026-10-11): use section 9 frozen APIs and artifact-only projections; existing Settings owns definitions; no current-definition endpoint. Capture revocation failure stops before overwriting results; optional capture failure after revocation only warns. Missing historical/config/producer/topology evidence stays unknown. Future audio sections are optional. Dependency contracts and named observing tests are fixed in Design. No open product decision remains.

### Design

Use ADR-035 and docs/design/workflow-board-modules.md sections 2-6. One shared browser workspace and one KK reader are justified by three concrete callers; no generic plugin framework or new server framework. Resolve same-origin /api/project identity before accepting local reader data. Reuse Spur /api/runs list/detail/progress; treat their payloads as versioned trust boundaries. Bind future collect runs before outputs through the existing collect preparation path and a KK-owned capture helper/command; append-only per-run metadata plus atomic workspace ownership marker, no copied media. Old/legacy output with no ownership proof remains unavailable. Reader binds 127.0.0.1, accepts only the configured exact Board Origin/Host, allowlisted GET/HEAD/OPTIONS, bounded/safe previews and canonical artifact access; no store migration or write on read. Source counts/inserted/updated/label confidence come from existing artifacts; no store/DAO reads are introduced. Collect progress reuses state visit/attempt evidence. Browser build uses Bun and the public type-only contribution ABI, scopes CSS, and creates no React root. Command registration follows existing CLI patterns; compiled files and package manifests follow existing distribution path. The first installed native/reader/identity smoke proof happens before expanding the UI. After old-owner revocation, optional capture failure warns and withholds Board data; failed revocation stops before result overwrites. A broken reader leaves Spur progress usable.

Execution budget: one task pipeline pass, at most two focused correction passes; preserve failing evidence and request replanning if the concrete integration contract differs. New production diff required; a planning-only result cannot satisfy this task. Persist fixtures/test evidence with the task and implementation; .spur/run scratch is volatile. No drive-by refactors or GitHub workflow changes.

Settings → Workflows owns current definitions, dropdown, YAML/copy and static graphs. Link /board/settings/workflows; its current dropdown has no workflow-selection URL contract. Config Summary owns only sanitized recorded run values, capture provenance and explicit unknowns. Do not create a current-definition reader endpoint or duplicate viewer. Run-specific progress remains in the module.

Consume docs/design/workflow-board-modules.md section 9 as the frozen cross-task contract. No predecessor; hand 0253/0254 the shared Board UI, type-only @gobing-ai/kk-board/contracts export, captureRun, fixed workflow reader dispatch and build hook; hand 0255 the installed Collect smoke/package fixture. Keep settings definition inspection solely in /board/settings/workflows. Existing workflow relocation is baseline, not implementation work.

Use the installed same-origin run APIs with their observed runs/count/nextCursor/hasMore envelope. Reader identity/producer verification uses the configured Board origin with bounded requests; it never accepts a browser assertion as authorization. Capture after successful Collect lock acquisition, never from a skipped lock contender. Revoke old owner before producer writes; failure to revoke stops before overwrites, while optional new-capture failure after revocation warns and continues with content withheld. Test stale files under a new owner, producer action keys, same-run retries and ownership changes during ranges. No optional store read path.

Build only existing entries (Collect now); later entry owners extend that fixed list. The shared Bun build emits checkout and CLI distribution assets, and both root build and CLI prepack invoke it explicitly. Do not register absent future entries.

Audit baseline: git worktree list shows this main checkout only; spur task list --status wip is empty. Prior authorized uncommitted G8/discovery changes are retained. Recheck these facts at implementation startup; they do not authorize reverting another contributor. Execution budget remains one pipeline pass plus at most two focused correction passes. Persist durable fixtures in the named test areas and verification evidence through Spur; scratch under .spur/run is not the sole handoff.

### Plan

1. (R1/R4) Verify Bun/.prototools, installed Spur 0.4.2 public ABI/runtime manifest and saved API shapes; preserve prior changes and no-wip baseline. Add browser package/type-only contracts and a hook-bearing Collect entry.
2. (R4) Add scripts/build-board.ts and explicit root/prepack invocation; emit only existing contribution entries with host React externalized and prove a separately built Collect entry mounts.
3. (R2) Implement the section 9 capture/reader commands and immutable record/owner marker; use public Board identity/run/progress evidence and fixed artifact manifests. Add real-file/HTTP boundary tests.
4. (R2/R3) Declare run/digest binding and integrate capture strictly after successful collect lock acquisition before collection results; test lock contenders, revocation refusal, optional capture failure and old files under a new owner.
5. (R1/R3/R5) Implement Collect results, exact producer-key authorization, state progress, paged stable run/tab links, bounded previews and captured settings with the existing Settings link. Exercise no-run/failed/partial/stale fixtures.
6. (R1-R5) Run named reader/capture/Collect/browser/package tests, lint, full unit suite, workspace build and rule presets; document shipped CLI/setup surface and leave a concrete contracts/fixtures handoff to 0253/0254/0255.

### Solution

Shipped the Collect vertical slice plus the native-module/reader/provenance foundation that
0253/0254/0255 consume: a browser workspace `@gobing-ai/kk-board` with a pure-logic shared layer, one
native `webModule` contribution, a loopback read-only reader with strict project/run/artifact
authority, a `kk board capture` seam that binds a run id to its canonical workspace before output
generation, and a Collect projection built from artifact evidence and recorded producer attempts.

Two independent reviews drove two repair passes; every `file:line` below is the FINAL anchor
measured after the last pass (the earlier map drifted by 2–110 lines and was corrected).

#### Change map (per requirement)

| Req | Anchor | What changed |
| --- | --- | --- |
| R4 | `apps/board/package.json:2` | New `@gobing-ai/kk-board` workspace: ESM, `typecheck` script, declaration-only `./contracts` export, React 19.2.1 + types pinned to the host manifest |
| R4 | `apps/board/tsconfig.json:5` | Extends the shared TS base with `jsx: react-jsx` and DOM/DOM.Iterable libs |
| R1 | `apps/board/src/contracts.ts:11` | The frozen §9 type set (`WorkflowName`, `RunCaptureInput`, `RunCapture`, `BoardHealth`, `RunConfig`, `RunResults`, `ArtifactDescriptor`, `BoardDiagnostic`, `Availability`) |
| R1 | `apps/board/src/shared/run-selection.ts:88` | `resolveSelection`: newest-run first visit, unknown id → diagnostic, no silent fallback |
| R1 | `apps/board/src/shared/run-selection.ts:113` | `selectionQuery`/`selectionPath`: the deep link now PRESERVES unknown module parameters, so §4's `kkApi` reader origin survives a run/tab change and a reload |
| R1 | `apps/board/src/shared/run-selection.ts:146` | `syncSelectionUrl`: writes the selection back into the address bar (AC1), passes the host router's state through, no-ops when already matching or once the router has navigated away |
| R1 | `apps/board/src/shared/refresh.ts:33` | Polling/backoff reducer: no overlapping requests, capped 30 s backoff, last-success freshness label |
| R1 | `apps/board/src/shared/format.ts:14` | The seven `Availability` states, diagnostic lines, timestamp/byte/elapsed formatting |
| R1 | `apps/board/src/shared/format.ts:80` | `dedupeDiagnostics`: one row per code, so a flapping reader cannot grow duplicate React keys |
| R1 | `apps/board/src/shared/api.ts:54` | `readerOriginFrom` validates a `kkApi` override with `isLoopbackHttpOrigin` and falls back to the default origin with a diagnostic instead of throwing during render |
| R1 | `apps/board/src/shared/api.ts:79` | Loopback origin guard plus the reader/Board fetch client with an injectable fetch seam |
| R1 | `apps/board/src/collect/index.tsx:83` | `CollectModule`: four tabs, header with run id/status/freshness, permanent link, manual refresh, no `createRoot` |
| R1 | `apps/board/src/collect/index.tsx:344` | `export const webModule: BoardContribution = { apiVersion: 1, component: CollectModule }` (the host ABI entry) |
| R2 | `apps/board/src/shared/collect.ts:104` | Summary keeps execution status separate from result outcome; artifact availability `n/m`; unknown stated |
| R3 | `apps/board/src/shared/collect.ts:192` | Progress rows built from recorded visits and `actionKey — status` evidence only |
| R4 | `scripts/build-board.ts:69-79` | Bun browser-ESM build into both `apps/board/dist/<entry>` and `apps/cli/dist/board/<entry>`, React facades externalized, production JSX |
| R4 | `package.json:26` | Root `build` invokes the board build |
| R4 | `apps/cli/package.json:43` | CLI `build:bundle` invokes it so `prepack` ships the assets |
| R4 | `apps/cli/package.json:57` | CLI declares `@gobing-ai/kk-board` as a devDependency for the `./contracts` types |
| R2 | `apps/cli/src/board/manifest.ts:30` | Per-workflow capture allowlists (collect integers; daily booleans/choices/durations; itc booleans/locale) |
| R2 | `apps/cli/src/board/manifest.ts:86` | `ArtifactSpec.mime`, so a descriptor can declare its real media type |
| R2 | `apps/cli/src/board/manifest.ts:88` | Fixed artifact manifest mapping blended/facts/store-result/label-result to the four producer keys |
| R2 | `apps/cli/src/board/manifest.ts:145` | `resolveWithin`: traversal, absolute patterns and NUL bytes refused |
| R2 | `apps/cli/src/board/manifest.ts:163` | `resolveAvailability` — the single place a state may become `available` (owner marker + producer + file), including the `invalid` state for malformed evidence |
| R2 | `apps/cli/src/board/capture.ts:30` | `WORKS_REL` and the works-root names (`.works` project-local, `works` external) |
| R2 | `apps/cli/src/board/capture.ts:179` | `readOwnerMarker` refuses a marker whose `schemaVersion` is missing or not 1 |
| R2 | `apps/cli/src/board/capture.ts:191` | `readCaptureRecord` validates the record SHAPE (string ids, absolute `workspacePath`, `settings` object) so malformed stored evidence answers §9's 422 instead of 500 |
| R2 | `apps/cli/src/board/capture.ts:238` | `topologyFromYaml` — nodes/edges from a state machine or DAG |
| R2 | `apps/cli/src/board/capture.ts:282` | `captureRun`: validation, conflict refusal, mandatory revocation (throw ⇒ no record), atomic record + marker, workspace guard that resolves a relative `--work-dir` against the project and refuses `/`, home, the project root, its ancestors and a works root itself |
| R2 | `apps/cli/src/board/reader.ts:184` | `createBoardReader`: 127.0.0.1 bind, exact Board origin, loopback Host, project/run authority via the public Board API |
| R2 | `apps/cli/src/board/reader.ts:81` | `parseByteRange`: absent / unsatisfiable (416) / inclusive 206 slice |
| R2 | `apps/cli/src/board/reader.ts:207` | `authorize`: absent record → 404, present-but-invalid → 422 |
| R2 | `apps/cli/src/board/reader.ts:294` | `markerState` distinguishes an absent, a foreign and a malformed owner marker |
| R2 | `apps/cli/src/board/reader.ts:313` | `observe`: re-resolves the canonical path immediately before the read, pre- and post-read size checks, containment per read |
| R2 | `apps/cli/src/board/reader.ts:414` | `artifactFor` re-reads the marker after the bounded read and discards the observation with `404 board.artifact.owner-changed` when the owner moved |
| R2 | `apps/cli/src/board/reader.ts:515` | The HTTP surface for health/results/config/artifacts with 400/403/404/405/416/422/503 |
| R3 | `apps/cli/src/board/reader.ts:139` | `producerStateFrom` resolves an action key across EVERY visit: any success → available, a running retry → pending, else failure |
| R3 | `apps/cli/src/board/reader.ts:166` | `mimeFor` prefers the descriptor's declared mime |
| R3 | `apps/cli/src/board/reader.ts:603` | `artifactContent`: real byte slices for image/audio, and a BYTE-cut text preview that matches its `Content-Range` |
| R3 | `apps/cli/src/board/collect.ts:52` | Source counts derived from the captured blended docs, artifacts only |
| R3 | `apps/cli/src/board/collect.ts:144` | Collect `RunResults` projection; absent per-label/source detail stays `unavailable` |
| R3 | `apps/cli/src/board/collect.ts:220` | Availability roll-up: `available` only when EVERY artifact is available, else the most specific failure |
| R2 | `apps/cli/src/commands/board.ts:113` | `kk board serve` (loopback, exact origin, default 4340) and `kk board capture` (workflow/run/work-dir/stamp/digest/setting); the `--work-dir` help states the works-root contract |
| R4 | `apps/cli/src/cli.ts:2` | `createProgram` registers the `board` noun |
| R2 | `plugins/kk/workflows/kk-collect.yaml:97` | Capture runs inside the successful lock-holder path, after `lock acquire` and before any collection output |
| R2 | `plugins/kk/workflows/kk-collect.yaml:186` | The `collect → store` guard also requires the capture artifact, so a refused revocation cannot reach ingest |
| R3 | `plugins/kk/workflows/kk-collect.yaml:33` | Declares the engine-injected `__definitionDigest` var |
| R4 | `apps/cli/tests/main.test.ts:68` | Visible-noun list extended with `board` (gate-lane fixture repair) |
| R4 | `scripts/publish-manifest.test.ts:88` | Private-workspace set extended with `@gobing-ai/kk-board` (gate-lane fixture repair) |

#### Verification

Full quality gate PASS at proof digest `sha256:2608cf74…` (and re-run after the second review's
repairs): 2512 tests, 0 failures, 55 pre-check + 2 post-check rules clean, per-file coverage ≥90 %
lines and functions on every new or changed board file. Public-surface probes: `kk board capture`
wrote the record and the owner marker; `kk board serve` answered `/api/health` 200, refused a foreign
Origin (403), an unknown capture (404), a stray query (400), and failed closed (503) with no Board
project API reachable. Two reviews ran against this change set; the second accepted the reader's
non-descriptor race mitigation as a recorded deviation (the literal `O_NOFOLLOW` mechanism is not
implementable under this repo's `no-direct-fs-io` boundary) and closed every other finding.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Native four-tab Collect entry, stable deep links, paged selection and truthful refresh states, all present and passing. Entry `apps/board/src/collect/index.tsx:83` (`CollectModule`), the four tabs run-selection.ts case (`BOARD_TABS` = summary/results/progress/config) rendered at `apps/board/src/collect/index.tsx:207,238-241`, host-ABI entry index.tsx case (`webModule`). Deep-link parse/resolve/URL write-back `apps/board/src/shared/run-selection.ts:54,88,146`; paged history run-selection.ts case; polling/backoff and freshness `apps/board/src/shared/refresh.ts:38,48,73`. Lane re-run this pass: `NODE_ENV=test bun test apps/cli/tests/board apps/board/tests apps/cli/tests/commands/board.test.ts scripts/tests/board-package.test.ts` -> 106 pass / 0 fail (12 files), incl. `apps/board/tests/shared/run-selection.test.ts:41,64,91,113,129` and `apps/board/tests/shared/refresh.test.ts:15,21,28,38`. |
| R2 | MET | Minimal read-only reader with exact project/run/artifact authority, recorded config projection, run capture and same-folder supersession. `apps/cli/src/board/reader.ts:184` (`createBoardReader`; exact-Origin + loopback-Host gate reader.ts case; project/run authority reader.ts case; canonical containment and per-read marker re-check `apps/cli/src/board/reader.ts:313,414`), capture.ts case (`captureRun`: validation, conflict refusal, mandatory revocation, atomic record+marker, structural works-root guard), `apps/cli/src/board/manifest.ts:145,163` (path guard; single `available` gate), config projection reader.ts case, commands board.ts case. Tests pass in the lane: `apps/cli/tests/board/reader.test.ts:177,189,202,211,266,277,288,352,363,371,553` and `apps/cli/tests/board/capture.test.ts:94,117,124,137,148,245,267,274,298`. Live probe (throwaway `mktemp` root, this pass): `kk board capture --workflow kk-collect --run run-1 --work-dir .works/kk-collect/S1 --stamp S1 --setting limit=10` wrote `.works/.board/runs/run-1.json` and `.works/kk-collect/S1/.kk-board-owner.json` (exit 0); `kk board serve` answered `/api/health` 200, foreign Origin 403, unknown capture 404, stray query 400, POST 405, `..%2f..%2fetc%2fpasswd` artifact 404, and results 503 with no Board API reachable. |
| R3 | MET | Run-bound, artifact-backed, read-only exposure that triggers no pipeline operation. `apps/cli/src/board/collect.ts:52` (`sourceCountsOf`), collect.ts case (`projectCollectResults`), collect.ts case (`overallAvailability`: `available` only when EVERY artifact is available), producer evidence across every visit reader.ts case (`producerStateFrom`), real byte/range content reader.ts case; browser projections `apps/board/src/shared/collect.ts:93,236`. Tests pass: `apps/cli/tests/board/collect.test.ts:31,44,51,65,99`, `apps/cli/tests/board/reader.test.ts:221,254,288,397,443,473,502`, `apps/board/tests/shared/collect.test.ts:71,206,244`. The reader allows GET/HEAD/OPTIONS only (reader.ts case), so opening the module mutates nothing. |
| R4 | MET | First native entry built and distributed with host React externalized; existing behavior preserved; fixtures, setup notes and surface docs now shipped. `scripts/build-board.ts:69-79` emits `apps/board/dist/collect/{index.js,index.css}` and `apps/cli/dist/board/collect/{index.js,index.css}` (both present on disk); externalized facades and no `createRoot` `scripts/build-board.ts:44,78`; wired into the root build package.json case and the CLI `build:bundle`/`prepack` package.json case; package proof `scripts/tests/board-package.test.ts:18,30,57`. Surface docs + setup notes added this pass: 04_DESIGN.md case (the `kk board` section: both verbs with flags, reader routes and full status vocabulary, and the `Operator setup (checkout)` list covering the build, the `bootstrap.modules` config-load hazard, `kk board serve`, `/modules/<id>` and `kkApi`) plus the synopsis at 04_DESIGN.md case. Fixtures live in the named test areas (`apps/cli/tests/board/*`, `apps/board/tests/*`, `scripts/tests/board-package.test.ts`). Existing behavior preserved: `NODE_ENV=test bun test apps/cli/tests/kk-collect.test.ts` 6 pass / 0 fail (the real workflow incl. `kk board capture`), and the gate receipt `.spur/run/0252-check-receipt.json` PASS on `inputDigest sha256:bced0e2db59a14431fcc75fbd24f402071e5855b9870ba77798df2b4623dd8d7` (log `.spur/run/0252-test-gate.log`: 2520 pass / 2 skip / 0 fail, 55 pre + 2 post rules clean). |
| R5 | MET | Settings -> Workflows owns definitions; the module only links out and exposes captured run settings. Links `apps/board/src/collect/index.tsx:235,344`; the module contains no definition browser, YAML viewer or static graph, and the reader's whole route surface is health/results/config/artifacts (`apps/cli/src/board/reader.ts:515,519`) with no current-definition endpoint. Canonical home proven: `scripts/tests/board-package.test.ts:44` asserts `.spur/workflows` is the relative symlink to `plugins/kk/workflows`; re-run this pass `spur workflow list --json` returns `kk-collect`, `kk-daily-ai-voice2` and `kk-itc` exactly once each and `realpath .spur/workflows/feature-verification.yaml` = `plugins/kk/workflows/feature-verification.yaml`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Run selection stays consistent across all four tabs (req: R1; R4) | MET | test | `apps/board/tests/shared/run-selection.test.ts:41` (keeps the linked run id and tab across a tab change), `:64` (writes the selection into the address bar and preserves the host router state; no-op when already matching or after a host navigation), `:91` (retains a validated `kkApi` reader origin in the saved URL), `:129` (exactly the four tabs) — all pass in this pass's lane (106 pass / 0 fail). One shared `selection` state feeds all four panels (`apps/board/src/collect/index.tsx:95,183,238-241`), so a tab change cannot alter the run. |
| AC2 — Summary separates execution status from result outcome (req: R1) | MET | test | `apps/cli/tests/board/collect.test.ts:51` (`overallAvailability` is `available` only when EVERY artifact is available, else the most specific failure — a partial run never reads fully successful), `apps/board/tests/shared/collect.test.ts:52` (Execution status `done`, Elapsed `5m 0s`, Result availability `n/m artifacts available`, Label verdict `PASS (HIGH)`), `:62` (unknown execution status stated explicitly), `:177` (roll-up counts). Header shows run identity/status/freshness and diagnostics `apps/board/src/collect/index.tsx:196,243`. |
| AC3 — Collect results show ingestion and labeling evidence (req: R3) | MET | test | Closed this pass: `collectSummaryFacts` now emits `Model labeled` `apps/board/src/shared/collect.ts:138`, `Fallback labeled` `apps/board/src/shared/collect.ts:143` and a bounded, truncation-reporting `Core facts` preview `apps/board/src/shared/collect.ts:151-155` (`oversized` availability plus an explicit note pointing at the facts artifact), rendered by `SummaryPanel` `apps/board/src/collect/index.tsx:260`; artifact downloads remain in `ResultsPanel` `apps/board/src/collect/index.tsx:283`. Tests: `apps/board/tests/shared/collect.test.ts:206` (model/fallback counts + bounded preview), `:221` (truncation reported, not silently cut), `:233` (unknown counts stated `unverified`, never an invented zero); reader half `apps/cli/tests/board/reader.test.ts:221`. |
| AC4 — Progress preserves state visits and retries (req: R3) | MET | test | Closed this pass: `ProgressRow` carries `timing` `apps/board/src/shared/collect.ts:204-214` (recorded `durationMs`, else `startedAt -> completedAt`, else `timing unknown`) and `operatorWait` `apps/board/src/shared/collect.ts:219-231` (true only when the recorded status or an action key names a wait), both rendered at `apps/board/src/collect/index.tsx:311-312` with no execution action in the module. Tests: `apps/board/tests/shared/collect.test.ts:244` (durationMs / started->completed / gap stated), `:255` (operator wait only on recorded evidence, a fast state stays false), `:266` (a repeated visit failed-then-done, plus `skipped` and `pending`, stay distinct); cross-visit retry resolution `apps/cli/tests/board/reader.test.ts:397,443`. |
| AC5 — Configuration distinguishes current defaults and recorded run values (req: R2; R5) | MET | test | `apps/cli/tests/board/reader.test.ts:221` (config projection: `settings {limit:'10'}` from the run record, truthy `capturedAt`, `unavailableKeys ['horizon_hours']` — uncaptured keys stated, never substituted with current defaults); capture-side allowlisting/redaction `apps/cli/tests/board/capture.test.ts:85,219`, `apps/cli/tests/board/manifest.test.ts:20`; the module renders captured values, the "Uncaptured keys" line, "Recorded configuration unavailable for this run" for an empty capture, and the Settings -> Workflows link without duplicating its viewer `apps/board/src/collect/index.tsx:327-345`. |
| AC6 — No runs and unavailable artifacts have explicit states (req: R1; R2) | MET | test | `apps/cli/tests/board/manifest.test.ts:54` (`available` only with marker + producer + file; pending/invalid/missing/superseded otherwise), `apps/cli/tests/board/reader.test.ts:326` (over-cap evidence reported `oversized`, never silently truncated), `:371,381` and `:553` (422 for malformed record/marker, never 500), `:288` (later owner -> `superseded`); no-run state + Settings link `apps/board/src/collect/index.tsx:229-236`; distinct label per state `apps/board/tests/shared/format.test.ts:24`. |
| AC7 — Overwritten workspaces never impersonate historical outputs (req: R2) | MET | test | `apps/cli/tests/board/capture.test.ts:137` (revokes the previous owner marker before writing the new one; the earlier run's immutable record survives), `:148` (a refused revocation throws and writes no record, leaving the old marker), `apps/cli/tests/board/reader.test.ts:288` (later owner -> files `superseded`, the artifact 404s while a still-authorised artifact serves), `apps/cli/tests/board/collect.test.ts:99` (foreign owner -> superseded even with all files present). Recorded config and progress survive supersession because `configFor` `apps/cli/src/board/reader.ts:395` and the Board progress read never consult the marker. |
| AC8 — Artifact access is limited to the selected project and run (req: R2) | MET | test | `apps/cli/tests/board/reader.test.ts:177` (foreign Origin 403, non-loopback Host 403), `:189` (400 for unknown workflow, unsafe run id, stray query), `:202` (404 unknown capture; 403 when the Board project does not own it), `:211` (404 when the Board run/workflow differs), `:266` (unlisted and traversal artifact id -> 404; an id is never a path), `:277` (a symlink escaping the workspace -> 404), method refusal `:177` (POST 405). Independent live probe this pass: health 200, foreign Origin 403, unknown capture 404, traversal 404, POST 405, stray query 400, no-Board 503. |
| AC9 — Refreshing and connection failures preserve a truthful view (req: R1) | MET | test | `apps/board/tests/shared/refresh.test.ts:15` (a tick while pending is ignored — no overlapping requests), `:21` (last success recorded, steady interval restored), `:28` (last success kept while failing, backoff capped at 30 s), `:38` ("Not yet loaded" instead of pretending freshness); header freshness label, manual Refresh and the busy-ref wiring `apps/board/src/collect/index.tsx:108-155,196`. Closed this pass: progress is now fetched independently of the reader calls `apps/board/src/collect/index.tsx:157-162` and a failure leaves the last good value in place, so a reader outage never blanks Spur's own progress (design §6); Board progress unavailability is `unverified` `apps/cli/tests/board/reader.test.ts:313`. |
| AC10 — Workflow definitions remain in Settings Workflows (req: R5) | MET | test | `scripts/tests/board-package.test.ts:44` asserts `.spur/workflows` is the relative symlink to `../plugins/kk/workflows` and that `kk-collect`, `kk-daily-ai-voice2`, `kk-itc` and `feature-verification.yaml` resolve under it; re-run this pass `spur workflow list --json` returns the three module names exactly once each and `realpath .spur/workflows/feature-verification.yaml` equals `plugins/kk/workflows/feature-verification.yaml`; the module links `/board/settings/workflows` `apps/board/src/collect/index.tsx:235,344` and adds no definition browser, YAML viewer, static graph or current-definition reader endpoint. |
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

- 2026-10-12T01:40:59.487Z todo → wip (system)
- 2026-10-12T04:38:15.205Z wip → testing (system)
- 2026-10-12T04:39:07.885Z testing → done (system)

