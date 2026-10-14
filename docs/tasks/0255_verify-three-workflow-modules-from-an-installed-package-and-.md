---
schema_version: 1
name: Verify three workflow modules from an installed package and harden operator setup
status: done
template: feature-impl
created_at: 2026-10-11T23:22:42.780Z
updated_at: "2026-10-14T05:53:11.340Z"
feature_id: G8
priority: P2
tags:
  - board
  - workflows
estimate_hours: 4

dependencies: ["0253", "0254"]
ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0255-verdict.json
---

## 0255. Verify three workflow modules from an installed package and harden operator setup

### Background

Feature G8; accepted design docs/design/workflow-board-modules.md and ADR-035. Implements: R1 — Three workflow modules load through the installed Board; R2 — Run selection stays consistent across all four tabs; R10 — No runs and unavailable artifacts have explicit states; R11 — Overwritten workspaces never impersonate historical outputs; R12 — Artifact access is limited to the selected project and run; R13 — Refreshing and connection failures preserve a truthful view; R14 — Modules remain accessible and distributable.

Ownership: apps/board/tests/** and fixtures, apps/cli/tests/board/** (new), scripts packaging tests, docs/design/workflow-board-modules.md, docs/04_DESIGN.md, docs/05_FEATURES.md, docs/02_ROADMAP.md, AGENTS.md and operator setup instructions; minimal source fixes only for acceptance failures.

Verified source premises: docs/design/workflow-board-modules.md section 9; installed @gobing-ai/spur 0.4.2 public ABI and observed run APIs; existing CLI/stage preparation symbols and artifact writers inspected during this ready audit.

Rubric: E4 D1 L3 C1 R1 = 10; retain this cohesive deliverable with steps in Plan. Dependencies are the persisted frontmatter WBS edges; their explicit handoff is frozen in Design.


Also implements R15 — Workflow definitions remain in Settings Workflows.

**Refine corrections (2026-10-11)**
- Browser harness deferred to available tooling → Playwright is installed and previous Settings browser proof passed → use Playwright with real installed Board and reader.
- New production diff required even for hardening → acceptance work may correctly need only tests/docs → require durable executable integration evidence; fix source only for demonstrated defects.
- Pack/stage assumed to include UI → existing prepack does not build UI → verify the explicit 0252 build hook from a separate packed install.
- Workflow relocation seemed pending → relative symlink and unchanged file are already present → assert discovery/compatibility without copying or moving again.
- Acceptance checkbox titles lacked requirement/test binding → bind all five local requirements to executable scenarios and package/browser test layers.
- Generic prerequisites and source-import risk → consume completed 0253/0254 and transitive 0252 artifacts only → isolated install proof must run without either checkout or sibling Spur sources.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The installed host advertises contributionApiVersion 1 and React 19.2.1 / ReactDOM 19.2.1 / React Router 7.11.0, and `board/index.d.ts` fixes the contribution shape (`apiVersion: 1`, `webModule`, a `component` mounted in the host's own React tree) | installed `@gobing-ai/spur` `board/index.d.ts` + `web/board-runtime.json` | Read `node_modules/@gobing-ai/spur/board/index.d.ts:21,27,38` and `web/board-runtime.json:4-11` (0.4.2) | HIGH |
| A module declaration is a discriminated `react`/`iframe` union validated `.strict()` with `id` matching `^[a-z][a-z0-9-]*$`, `name`, `icon`, optional `sidebarLabel`/`description`/`order`, and for `type: react` a `directory`, `entry` and optional `styles`; a duplicate id or a reserved-identity collision is refused at config load | installed bundle zod schema `boardModuleDeclarationSchema` / `validateBoardModuleDeclarations` | Read the emitted schema and the collision check in `node_modules/@gobing-ai/spur/spur.js` (0.4.2); the reserved ids come from `web/board-runtime.json` `reservedModules` | HIGH |
| A declared module's route is `/modules/<id>` (the host derives it; the declaration carries no route field) | installed bundle constant `BOARD_MODULE_ROUTE_PREFIX = "/modules/"` | Read the constant and `boardModuleRoute(id)` in `spur.js`; the reserved-module routes in `web/board-runtime.json` are the `board/<route>` family instead | HIGH |
| `bootstrap.modules` is validated by the RUNTIME zod schema only — the shipped `schemas/spur-config.schema.json` `bootstrap` block lists just logging/telemetry/database/scheduler | installed `schemas/spur-config.schema.json:20` (bootstrap) and the emitted `bootstrapSectionSchema` in installed `spur.js` | Read both files in `node_modules/@gobing-ai/spur`: `schemas/spur-config.schema.json:20` opens the `bootstrap` object whose properties are only logging/telemetry/database/scheduler, while `spur.js` extends it with `modules: boardModuleDeclarationsSchema.optional()` | HIGH |
| Settings → Workflows is the real route `/board/settings/workflows`, its tab set is general/agents/workflows, and the definition view already renders `rawYaml` plus a Mermaid diagram | installed Board web bundle `web/_astro/BoardApp.*.js` | Read the route composition (`selectTab` → `/board/settings/<id>`), the tab array, and the `/project/workflows` payload fields (`rawYaml`, `mermaidDiagram`) | HIGH |
| The published package ships the `board` and `web` trees, and Chromium is pinned by the root catalog at playwright 1.55.0 | installed `package.json` `files`; the repo root `package.json` `workspaces.catalog` | Read both: `files` includes `board` and `web`; the catalog entry is `"playwright": "1.55.0"` | HIGH |

### Requirements

- [x] R1. Prove all three native modules from a separately packed Knowledge Kit install in the installed Spur Board without source-checkout imports.
- [x] R2. Verify stable run/tab/history links, project isolation, reader outage/stale recovery, same-folder supersession, safe config/artifacts and broken-module containment across all modules.
- [x] R3. Verify keyboard/narrow-screen usability, media ranges and host React identity and document exact setup/restart/shutdown and legacy evidence limits.
- [x] R4. Complete required repository checks and update planned/shipped documentation only from actual implementation and verification evidence.
- [x] R5. Reuse Settings → Workflows for definition browsing, YAML/copy and static graphs; link /board/settings/workflows and expose only captured run settings in the module. No duplicate current-definition endpoint.

Non-goals: no execution/edit/publish controls, extra workflow-definition UI/API, raw store reads, arbitrary file access, upstream Spur edits or paid/live workflow runs. Preserve existing unrelated behavior.

### Acceptance Criteria

```gherkin
Feature: G8 task 0255

  Scenario: AC1 — Three workflow modules load through the installed Board (req: R1)
    # Test lens: apps/board/tests/installed-board.test.ts; scripts/tests/board-package.test.ts
    Given the three compiled workflow contributions and a compatible installed Spur Board
    When the operator opens each registered module
    Then Collect, Daily AI Voice and IT Content render in the host navigation at distinct routes without rebuilding Spur

  Scenario: AC2 — Run selection stays consistent across all four tabs (req: R2)
    # Test lens: apps/board/tests/installed-board.test.ts; scripts/tests/board-package.test.ts
    Given two runs of a workflow with different outputs
    When the operator selects the older run and changes tabs
    Then Summary, Results, Execution progress and Workflow Config Summary all retain that run ID and the URL preserves run and tab selection

  Scenario: AC3 — No runs and unavailable artifacts have explicit states (req: R2)
    # Test lens: apps/board/tests/installed-board.test.ts; scripts/tests/board-package.test.ts
    Given a workflow with no runs or a selected run with missing, malformed, oversized or unfinished outputs
    When the operator opens its module
    Then the view distinguishes no runs, pending, unavailable, invalid and truncated evidence and keeps other tabs usable

  Scenario: AC4 — Overwritten workspaces never impersonate historical outputs (req: R2)
    # Test lens: apps/board/tests/installed-board.test.ts; scripts/tests/board-package.test.ts
    Given two run IDs share one workspace and the later run owns its artifacts
    When the operator selects the earlier run
    Then the view retains its recorded progress and sanitized config but marks artifact content superseded or unverifiable rather than displaying later outputs as earlier results

  Scenario: AC5 — Artifact access is limited to the selected project and run (req: R2)
    # Test lens: apps/board/tests/installed-board.test.ts; scripts/tests/board-package.test.ts
    Given a running local reader and requests for another project, workflow, unlisted artifact, traversal path or escaping symlink
    When the requests reach the reader
    Then access is refused and only allowlisted run-bound files and sanitized config are readable from the configured Board origin

  Scenario: AC6 — Refreshing and connection failures preserve a truthful view (req: R2)
    # Test lens: apps/board/tests/installed-board.test.ts; scripts/tests/board-package.test.ts
    Given a selected active run and then a reader or Spur API outage
    When the automatic refresh occurs
    Then the view labels stale data with its last successful update, keeps available progress separate from artifact failures, preserves selection and offers manual refresh without overlapping requests

  Scenario: AC7 — Modules remain accessible and distributable (req: R3; R4)
    # Test lens: apps/board/tests/installed-board.test.ts; scripts/tests/board-package.test.ts
    Given a packed Knowledge Kit install with the three modules and documented setup
    When the operator navigates using a keyboard at a narrow viewport and opens a saved run URL
    Then tabs and controls are labeled and usable, module assets and reader resolve outside the source checkout, and a broken contribution leaves built-in Board navigation usable

  Scenario: AC8 — Workflow definitions remain in Settings Workflows (req: R5)
    # Test lens: apps/board/tests/installed-board.test.ts; scripts/tests/board-package.test.ts
    Given repository workflows have one canonical home under plugins/kk/workflows and .spur/workflows is its relative symlink
    When the operator follows the module configuration link to /board/settings/workflows
    Then the existing dropdown lists kk-collect, kk-daily-ai-voice2 and kk-itc once each, existing YAML and static graph controls remain authoritative, and .spur/workflows/feature-verification.yaml resolves to the canonical file
    And the modules provide no duplicate definition browser, YAML viewer, static graph or current-definition reader endpoint
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:52:28.917Z

Closed ready-audit decisions (2026-10-11): use section 9 frozen APIs and artifact-only projections; existing Settings owns definitions; no current-definition endpoint. Capture revocation failure stops before overwriting results; optional capture failure after revocation only warns. Missing historical/config/producer/topology evidence stays unknown. Future audio sections are optional. Dependency contracts and named observing tests are fixed in Design. No open product decision remains.

### Design

This slice produces the installed-package/operator acceptance deliverable; it does not defer earlier slices' behavioral tests. Use the installed Spur distribution and a temporary packed KK install, with deterministic synthetic runs/artifacts and Playwright observing the actual installed Board and local reader. Never point the installation proof at sibling Spur source paths or a repo-only workspace dependency. Cover all module routes, shared hooks, direct URLs, side navigation after contribution failure, reader unavailable, stale refresh, malformed/unowned artifacts, sanitized values, malicious Origin/Host/path/symlink requests, cross-project same-named workflows, same-day reruns, audio ranges and narrow/keyboard access. Preserve UI behavior and fix the smallest root cause for observed failures; create no generic test infrastructure. Documentation explicitly distinguishes partial legacy support and local-only operation. Do not alter GitHub workflow files or run real generation/publishing.

Execution budget: one task pipeline pass, at most two focused correction passes; preserve failing evidence and request replanning if the concrete integration contract differs. Durable executable integration tests and operator evidence are required; source changes are made only for demonstrated defects. Persist fixtures/test evidence with the task and implementation; .spur/run scratch is volatile. No drive-by refactors or GitHub workflow changes.

Settings → Workflows owns current definitions, dropdown, YAML/copy and static graphs. Link /board/settings/workflows; its current dropdown has no workflow-selection URL contract. Config Summary owns only sanitized recorded run values, capture provenance and explicit unknowns. Do not create a current-definition reader endpoint or duplicate viewer. Run-specific progress remains in the module.

Consume finished 0253 and 0254 contributions and their fixtures plus transitive 0252 capture/reader/build contracts. This task owns executable installed acceptance and operator documentation; it does not reimplement those slices or require invented source edits. Exact observing files: apps/board/tests/installed-board.test.ts and scripts/tests/board-package.test.ts. Use Playwright already available in the workspace, Bun assertions, real temporary package installs and real local HTTP servers. Run the built installed Spur distribution, never sibling source imports.

First build and pack with the actual CLI prepack hook, install in a fresh directory and inspect all three dist/board entries/CSS and the kk board serve command. Drive the real native module routes and existing /board/settings/workflows dropdown, not a mock of the module loader. Check project mismatch and reader outage through real HTTP, shared React hooks through successful mounting/navigation, media ranges, keyboard/narrow view, and built-in navigation after a broken contribution. Existing .spur/workflows is already a relative symlink; check realpath identity and unique catalog entries. Make no claim that existing legacy output ownership can be reconstructed. Source fixes are permitted only for an observed failure.

Audit baseline: git worktree list shows this main checkout only; spur task list --status wip is empty. Prior authorized uncommitted G8/discovery changes are retained. Recheck these facts at implementation startup; they do not authorize reverting another contributor. Execution budget remains one pipeline pass plus at most two focused correction passes. Persist durable fixtures in the named test areas and verification evidence through Spur; scratch under .spur/run is not the sole handoff.

### Plan

1. (R1/R4) Confirm 0253/0254 are implemented and consume their fixtures plus transitive 0252; build and pack via real prepack, install in a fresh directory and inspect all three assets and reader command.
2. (R1/R2/R3) Start installed Board and reader on deterministic fixture data; execute installed-board.test.ts with Playwright to drive native routes, shared React hooks, deep links/back, keyboard/narrow viewport and media ranges.
3. (R2) Exercise real HTTP project/origin/path/symlink isolation, producer ownership, stale recovery and reader outage; break a contribution and verify built-in navigation survives. Fix only demonstrated root causes.
4. (R5) Drive the existing Settings Workflows dropdown and YAML/static graph controls; assert module links and no duplicate config endpoint/viewer. Confirm relative workflow alias and valid unique target catalog entries.
5. (R3/R4) Publish durable setup/evidence and limitations; reconcile design/03/04/05/02 and AGENTS only from verified shipped behavior. No fabricated production edits, generation or publishing.
6. (R1-R5) Run affected integration/package tests, lint, full unit suite, workspace build and rule presets; record actual per-scenario verification evidence and inspect intentional Git changes before closure.

### Solution

Route decision (verified live, not assumed): the host's module PAGE is `/board/modules/<id>` (only
that path mounts `.kk-board` in a real Chromium; the bare `/modules/<id>` page renders the SPA 404),
while the module ASSETS and the descriptor `route`/`entryUrl` in `GET /api/board/modules` use the bare
`/modules/<id>` prefix. The module route constants therefore use `/board/modules/<id>` and the asset
assertions use `/modules/<id>/index.js`. Config decision: `.spur/config.yaml` declares the three
`bootstrap.modules` with `enabled: false` because both candidate trees are gitignored build output and
an ENABLED declaration makes `spur serve` exit 1 ("module directory … was not found"); the operator
flips the flag after a build (probed both directions against a throwaway project).

| Change | Anchor | Rationale |
| --- | --- | --- |
| `bootstrap.modules` for the three native modules, declared `enabled: false` | `.spur/config.yaml:20` | The host validates each `directory` at server start, so the truthful shape for a checkout with unbuilt (gitignored) assets is disabled; document the build-first flip. |
| `playwright` catalog devDependency in the board workspace | `apps/board/package.json:22` | The installed-package acceptance layer launches real Chromium from the board test workspace, pinned by the root catalog at 1.55.0. |
| Collect module page route constant `COLLECT_MODULE_PATH` | `apps/board/src/shared/run-selection.ts:128` | The shared deep-link writer must target the page the SPA actually mounts at `/board/modules/kk-collect`, or it fights the host router and loses run/tab selection. |
| Daily AI Voice module page route constant `MODULE_PATH` | `apps/board/src/daily-voice/index.tsx:42` | Same defect fix for the daily module: the address-bar target is the mounted `/board/modules/<id>` page. |
| IT Content module page route constant `MODULE_PATH` | `apps/board/src/itc/index.tsx:42` | Same defect fix for the ITC module. |
| Collect poller loads on first mount, not after one interval | `apps/board/src/collect/index.tsx:77` | A first visit waited a whole interval (a blank module) before showing recorded history; the loader owns its own error handling, so an immediate `loop()` is safe. |
| Daily AI Voice poller loads on first mount | `apps/board/src/daily-voice/index.tsx:78-81` | Same demonstrated blank-module defect fixed for the daily module. |
| IT Content poller loads on first mount | `apps/board/src/itc/index.tsx:78-81` | Same demonstrated blank-module defect fixed for the ITC module. |
| Installed-package Board acceptance suite (three routes, tabs, isolation, media, Settings) | `apps/board/tests/installed-board.test.ts:496` | The durable executable integration evidence: packs the CLI, installs it in a throwaway project, drives the installed Board with real Chromium. |
| Cross-process build lock for the shared pack/build output | `apps/board/tests/installed-board.test.ts:113-128` | `bun pm pack` (prepack) and `buildBoard` write the shared `apps/*/dist` trees; the lock makes the suite correct under `bun test` across files. |
| Readiness waits on a real signal and surfaces the server's captured output | `apps/board/tests/installed-board.test.ts:172-174` | Replacing a discarded-output spawn + fixed sleep with a health-signal wait that prints the server log makes an early `spur serve` exit diagnosable instead of "Unable to connect". |
| Packed-CLI distribution assertions (three entry trees, facades, no checkout paths) | `scripts/tests/board-package.test.ts:154` | Extends the packaging contract from one entry to all three, proving the tarball ships assets + CSS and externalizes only the host React facades. |
| Shared run-selection route expectations | `apps/board/tests/shared/run-selection.test.ts:71` | The unit expectations track the corrected `/board/modules/kk-collect` page route so the URL-writer contract stays pinned. |
| Operator setup / restart / shutdown / installed acceptance / legacy limits | `docs/04_DESIGN.md:369` | Documents the exact build-first-then-enable flip and the installed-user steps only from verified behaviour. |
| Installed-package acceptance description | `docs/04_DESIGN.md:401` | Names the named test file and its byte-identical-asset guarantee as the executable proof. |
| Legacy evidence limits | `docs/04_DESIGN.md:414` | States that pre-capture runs and unowned workspaces are never reconstructed, matching the reader's actual 404/`superseded` behaviour. |
| Route claim row (page vs asset prefix) | `docs/04_DESIGN.md:495` | Records the empirically-confirmed dual-route fact and its evidence (Chromium + `GET /api/board/modules`). |
| G8 PRD row: planned → delivered by tasks 0252–0255 | `docs/01_PRD.md:76` | Reflects the shipped workflow-visibility surface for the installed Board. |
| G8 roadmap heading and status | `docs/02_ROADMAP.md:70` | Roadmap now states 0252–0254 are implemented and 0255 adds the packed-install proof. |
| G8 features row | `docs/05_FEATURES.md:106` | Feature table moves to active with the named acceptance files. |
| G8 feature-doc note (acceptance + config + defect fixes) | `docs/features/G8_workflow-visibility-in-spur-board-collect-daily-ai-voice-it-content.md:160` | Records the 0255 slice against the G8 feature document. |
| `playwright` workspace resolution entry | `bun.lock:19` | The lockfile records the catalog-pinned Playwright the board test workspace depends on. |

**Verify follow-up (2026-10-13, G8 verifyall) — two review advisories closed:**

- AC2 browser coverage: `apps/board/tests/installed-board.test.ts:560` now walks all four tabs (loop `:564-579`) and asserts the run in the URL, the selector and the `aria-current` tab on each. Proven by a temporary mutation (Config tab drops the run → red at `config`), restored.
- Shared-build lock foot-gun: the stale-lock grace was 600 s against a 300 s waiter deadline, so a SIGKILLed holder's lock was never reclaimed. Grace is now 120 s in both copies (`apps/board/tests/installed-board.test.ts:121-125`, `scripts/tests/board-package.test.ts:43-46`). Red first: a 150 s-old lock hung `board-package.test.ts` (timed out at 5 s); green after: 8 pass / 0 fail with the lock reclaimed.
- Not changed: the `usePolling` triplication (pre-existing refactor, out of this task's scope) and the env-dependent `spur` resolution (by design; `SPUR_BIN` escape hatch).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/board/tests/installed-board.test.ts:369` `setup()` packs the CLI with `bun pm pack` (`:378`) and extracts the tarball into a throwaway project (`:390`); the project declares each module against `node_modules/@gobing-ai/knowledge-kit/dist/board/<entry>` (`:214`, `:235`), never the checkout. `:526` asserts the served `/modules/<id>/index.js` is byte-identical to the packed install for all three modules, so no source-checkout import can satisfy the route; `scripts/tests/board-package.test.ts:192` asserts the packed reader and entries carry no checkout path. Re-run this stage: `apps/board/tests/installed-board.test.ts` 14 pass / 0 fail (86 expect), `scripts/tests/board-package.test.ts` 8 pass / 0 fail (61 expect). |
| R2 | MET | Installed-context executable coverage: `apps/board/tests/installed-board.test.ts:545` and `:560` prove the deep link plus run/tab retention across all four tabs, a reload and back/forward; `:633` proves foreign Origin→403, unlisted artifact→404, traversal→404, escaping-symlink→404 and cross-workflow read→404; `:618` proves same-workspace supersession (`availability: superseded`, recorded config `{limit:'7'}` retained); `:594` and `:601` prove the no-runs and missing/unavailable states; `:668` proves the reader-outage truthful view; `:751` proves a broken contribution leaves the built-in Board navigation usable and a sibling module still mounts. |
| R3 | MET | `:680` keyboard use at a 480 px viewport (labelled `aria-label="Collect tabs"`, 4 labelled controls, Enter activates "Execution progress", labelled run selector); `:701` audio byte ranges (206 with `bytes 0-3/64`, 416 unsatisfiable); `scripts/tests/board-package.test.ts:178` pins the host React identity (each entry imports only `react` and `react/jsx-runtime`, bundles no `createRoot` and no second react-dom). Setup/restart/shutdown and the legacy evidence limits are documented at `docs/04_DESIGN.md:370`, `:395` and `:411`. |
| R4 | MET | Full gate receipt `status: PASS`, digest `sha256:caf27b1506a1df054db74d00acf609641764f81e5824621aa7b3810db60dc65d`, 2730 pass / 2 skip / 0 fail after `biome check` + `typecheck` + `lint` + `spur rule run --preset recommended-pre-check` and `--preset recommended-post-check` ("All 2 rules passed"; certified verdict `.spur/memory/evidence/0255-verdict.json`). All fingerprinted code/test/doc files carry mtimes before the gate capture; the docs updates are anchored on shipped behaviour (`docs/01_PRD.md:76`, `docs/02_ROADMAP.md:70`, `docs/04_DESIGN.md:402`, `docs/05_FEATURES.md:108`, `docs/features/G8_workflow-visibility-in-spur-board-collect-daily-ai-voice-it-content.md:160`). |
| R5 | MET | `:716` opens `/board/settings/workflows`, asserts the dropdown lists each of kk-collect, kk-daily-ai-voice2 and kk-itc exactly once, and that a module renders `a[href="/board/settings/workflows"]`. `scripts/tests/board-package.test.ts:89` asserts `.spur/workflows` is the relative symlink `../plugins/kk/workflows` (realpath of `.spur/workflows/feature-verification.yaml` equals `plugins/kk/workflows/feature-verification.yaml`). No current-definition endpoint or viewer was added: the 0255 diff touches no `apps/cli/src` file and the modules read only the run-bound reader routes `/results`, `/config` and `/artifacts/<id>` (`apps/board/src/shared/api.ts:113-120`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Three workflow modules load through the installed Board (req: R1) | MET | test | `apps/board/tests/installed-board.test.ts:515` opens `/board/modules/<id>` for all three modules and asserts `.kk-board-<entry>` count 1, `h1` = module name and 4 tab buttons (`:522`); `:526` asserts each served bundle is byte-identical to the packed install. `bun test apps/board/tests/installed-board.test.ts` re-run this stage: 14 pass / 0 fail. |
| AC2 — Run selection stays consistent across all four tabs (req: R2) | MET | test | `apps/board/tests/installed-board.test.ts:545` restores `?run=r-b&tab=results` and keeps `run`, `tab` and the validated `kkApi` origin in the URL; `:560` walks all four tabs (Summary, Workflow Config Summary, Results, Execution progress — loop `:564-579`) asserting `run=r-b` in the URL, `r-b` in the selector and the `aria-current` tab on each, then keeps `r-b` through a reload and browser back/forward; the four-tab set is asserted at `:522`. Closed this pass (residual advisory: browser layer exercised only one transition): a temporary mutation making the Config tab drop the run turned `:560` red (`Expected: "config"`), restored. Re-run: certified verdict `.spur/memory/evidence/0255-verdict.json`. |
| AC3 — No runs and unavailable artifacts have explicit states (req: R2) | MET | test | `:594` states "No runs recorded for kk-itc"; `:601` a captured run with no artifacts reports `availability: missing`, `summary.inserted: null` and every artifact `missing`, and the page states "missing". Re-run this stage: pass. |
| AC4 — Overwritten workspaces never impersonate historical outputs (req: R2) | MET | test | `:618` two run ids share `.works/kk-collect/S3`; the earlier run reports `availability: superseded` with every artifact superseded while its recorded config still reads `{limit:'7'}`. Re-run this stage: pass. |
| AC5 — Artifact access is limited to the selected project and run (req: R2) | MET | test | `:633` a foreign Origin is 403; an unlisted artifact is 404; `../../etc/passwd` is 404; an allowlisted id whose bytes are an out-of-tree symlink is 404; the daily run read under the collect workflow is 404. Re-run this stage: pass. |
| AC6 — Refreshing and connection failures preserve a truthful view (req: R2) | MET | test | `:668` with a dead reader port the Board run history still renders, the page states "unavailable" and the selection is preserved; stale labelling with its last success and the no-overlapping-request guard are pinned by `apps/board/tests/shared/refresh.test.ts:15` ("ignores a tick while a request is pending") and `:28` ("keeps the last success while failing"). Re-run this stage: `installed-board.test.ts` 14 pass / 0 fail, `refresh.test.ts` 4 pass / 0 fail. |
| AC7 — Modules remain accessible and distributable (req: R3; R4) | MET | test | `:526` byte-identical served assets; `:680` keyboard use at 480 px; `:701` audio byte ranges; `scripts/tests/board-package.test.ts:170` the tarball ships all three entry trees (index.js + index.css) plus the reader binary, `:178` externalizes only the host React facades, `:192` resolves outside the source checkout; `apps/board/tests/installed-board.test.ts:751` a broken contribution shows the containment panel and a sibling module still mounts. Re-run this stage: 14 pass + 8 pass / 0 fail. |
| AC8 — Workflow definitions remain in Settings Workflows (req: R5) | MET | test | `:716` `/board/settings/workflows` lists each of the three workflows once and the module renders `a[href="/board/settings/workflows"]`; `scripts/tests/board-package.test.ts:89` asserts `.spur/workflows` is the relative symlink `../plugins/kk/workflows` and that all three definition files resolve through it, with no duplicate viewer or definition endpoint added (no `apps/cli/src` change). Re-run this stage: pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0255 (round 2, post-remediation)

**Scope:** uncommitted working-tree diff vs `HEAD` on `sp/runall-0255-0268-de19` — 15 modified files plus the new `apps/board/tests/installed-board.test.ts` (775 lines), reviewed after the bounded `test-fix` hop that repaired round 1's two P3s.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH — every claim is anchored to a `path:line` in this tree and re-measured this round: the three named layers re-run (`apps/board/tests/installed-board.test.ts`, `scripts/tests/board-package.test.ts`, `apps/board/tests/shared/run-selection.test.ts`) and `spur task check 0255` re-run; e.g. `apps/board/src/shared/run-selection.ts:127`, `apps/board/tests/installed-board.test.ts:496`.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | traceability | Round 1: the `## Solution` change map cited comment/blank lines (5 `L4.anchor-subject-mismatch` warnings). Repaired, verified: citations now land on the implementing lines — `apps/board/src/collect/index.tsx:77`=`void loop();`, `apps/board/tests/installed-board.test.ts:113`=`withBuildLock`, `:172`=`waitFor`, `:496`=`describe('installed Board native modules…')`; `spur task check 0255` returns PASS with only 2 warnings (finding 6). | `docs/tasks/0255_verify-three-workflow-modules-from-an-installed-package-and-.md:167` | RESOLVED (check PASS; fixed in working tree) |
| 2 | P3 (minor) | correctness | Round 1: stale JSDoc above `COLLECT_MODULE_PATH` named the bare asset prefix as the module route. Repaired, verified: the comment now reads “The Collect module page route (`/board/modules/<id>`); its assets use the bare `/modules/<id>` prefix.” — matching `COLLECT_MODULE_PATH` on the next line. | `apps/board/src/shared/run-selection.ts:127` | RESOLVED (fixed in working tree) |
| 3 | P4 (advisory) | architecture | `usePolling` is copy-pasted verbatim into all three module files (one ~15-line hook ×3); this diff applied the same one-line mount fix on three surfaces. A shared `src/shared/use-polling.ts` (the seam `refresh.ts`/`run-selection.ts` already model) would delete two of the three copies. Pre-existing, not introduced here. | `apps/board/src/collect/index.tsx:60` | ACCEPTED |
| 4 | P4 (advisory) | correctness | The installed-package layer resolves the host `spur` via `import.meta.resolve('@gobing-ai/spur/package.json')` → a global/home install (it is not a KIT dependency), then `Bun.which('spur')`, then throws. Environment-dependent by design; loud on failure (a missing Chromium or `spur` FAILS setup, never a silent skip); `SPUR_BIN` is the documented escape hatch. | `apps/board/tests/installed-board.test.ts:86` | ACCEPTED |
| 5 | P4 (advisory) | usability | AC2 says “across all four tabs”; the browser layer asserts 4 tabs exist and exercises one tab transition plus reload and back/forward. Full four-tab retention is pinned only by the unit writer contract. | `apps/board/tests/installed-board.test.ts:535` | ACCEPTED |
| 6 | P4 (advisory) | traceability | Two residual `L4.anchor-subject-mismatch` warnings remain (warning-level; `spur task check` still PASS): the cited lines name the right suite/row, but the heuristic's subject token (`cli`, `prd`) cannot lexically appear in them — false positives, not imprecision. | `docs/tasks/0255_verify-three-workflow-modules-from-an-installed-package-and-.md:170` | ACCEPTED |
| 7 | P4 (advisory) | correctness | `withBuildLock` is duplicated across the two test files and its stale-lock grace (600 s) exceeds the waiter deadline (300 s): a holder killed by SIGKILL makes the next run fail after 300 s instead of reclaiming the lock (reclaim fires only for locks older than 600 s). Fail-loud is deliberate, but one shared implementation with a grace below the deadline would remove the foot-gun. | `scripts/tests/board-package.test.ts:27` | ACCEPTED |

##### Functional Traceability

| AC | Requirement | Executable observing layer | Verdict |
|----|-------------|----------------------------|---------|
| AC1 — Three modules load through the installed Board | R1 | `apps/board/tests/installed-board.test.ts:497` (`installed Board native modules`): opens `/board/modules/<id>` for all three, asserts `.kk-board-<entry>` count=1, `h1`=module name, 4 tab buttons; `:508` asserts the served `/modules/<id>/index.js` is byte-identical to the packed install | MET |
| AC2 — Run selection stays consistent across all four tabs | R2 | `apps/board/tests/installed-board.test.ts:527` restores `?run=&tab=`, `:542` retains the run across a tab change, reload and back/forward and keeps `kkApi`; unit `apps/board/tests/shared/run-selection.test.ts:71` pins the writer contract | MET |
| AC3 — No runs and unavailable artifacts have explicit states | R2 | `apps/board/tests/installed-board.test.ts:564` (no-runs empty state) and `:571` (reader `availability: missing`, artifacts `missing`, page shows "missing") | MET |
| AC4 — Overwritten workspaces never impersonate historical outputs | R2 | `apps/board/tests/installed-board.test.ts:588`: `r-sup-old` → `availability: superseded`, artifacts superseded, recorded config still `{limit:'7'}` | MET |
| AC5 — Artifact access is limited to the selected project and run | R2 | `apps/board/tests/installed-board.test.ts:603`: foreign Origin→403, unlisted artifact→404, traversal→404, allowlisted-id symlink escaping the workspace→404, cross-workflow read→404 | MET |
| AC6 — Refreshing and connection failures preserve a truthful view | R2 | `apps/board/tests/installed-board.test.ts:638`: a dead `kkApi` port still shows Board run history and an `unavailable` diagnostic; `:650` keyboard/480 px; `:671` audio byte ranges | MET |
| AC7 — Modules remain accessible and distributable | R3; R4 | `apps/board/tests/installed-board.test.ts:508` byte-identical assets; `scripts/tests/board-package.test.ts:154` tarball ships all three entry trees + CSS + reader binary and externalizes only the host React facades; `:716` a broken entry shows the containment panel and a sibling still mounts | MET |
| AC8 — Workflow definitions remain in Settings Workflows | R5 | `apps/board/tests/installed-board.test.ts:686`: `/board/settings/workflows` lists each of the three once; the module links `a[href="/board/settings/workflows"]` | MET |

##### Pre-change discrimination

Against the pre-change tree this task corrects, the fixes are load-bearing, not cosmetic:

- `apps/board/src/shared/run-selection.ts:128` (page route `…kk-collect`): `syncSelectionUrl` no-ops unless `location.pathname === modulePath`. Pre-change the constant was the bare asset route, so on the real page (`/board/modules/kk-collect`) the writer never fired and the AC2 tab-change URL assertion at `installed-board.test.ts:542` would fail.
- `apps/board/src/collect/index.tsx:77` plus the two sibling pollers: the first loader now runs on mount instead of after one interval. The AC3 "missing" assertion (`installed-board.test.ts:571`) reads within 800 ms and the AC6 run-list wait (`:638`) within 15 s — both out of reach if the first poll were deferred by a 30 s interval.

##### Evidence (fresh, this review)

- `bun test apps/board/tests/installed-board.test.ts` → 14 pass / 0 fail (86 expect calls, 35.36 s, real Chromium).
- `bun test scripts/tests/board-package.test.ts` → 8 pass / 0 fail (61 expect calls, 7.38 s).
- `bun test apps/board/tests/shared/run-selection.test.ts` → 11 pass / 0 fail (23 expect calls, 132 ms).
- `spur task check 0255` → PASS, with 2 warning-level `L4.anchor-subject-mismatch` heuristics (finding 6).
- Pipeline gate receipt → `status: PASS`, digest `sha256:caf27b15…c65d`, 2732 tests / 0 fail (certified verdict `.spur/memory/evidence/0255-verdict.json`).

##### Residual risk

- No P1/P2 and no open P1–P3: both round-1 P3s are resolved in the working tree (findings 1–2).
- The P4s are all `ACCEPTED`: duplication/seam items (3), environment coupling of the installed layer with a loud-failure design (4), AC2's browser breadth (5), two heuristic checker warnings (6), and build-lock fragility (7).
- Round 2 changed no code or tests; it re-verified the repaired tree, so the quality gate receipt's digest still certifies the reviewed bytes.

**Next:** none required — repository state at `sp/runall-0255-0268-de19` is accept-ready. The operator-only build-first-then-enable flip for `.spur/config.yaml` `bootstrap.modules` is documented at `docs/04_DESIGN.md:386`.

### References

- Feature G8; ADR-035 (including ready-audit ownership amendment).
- docs/design/workflow-board-modules.md section 9: frozen names, types, capture timing, ownership and test handoff.
- docs/plans/2026-10-11-G8-ready-refinement.md: durable checklist/corrections report.
- Installed Spur 0.4.2: board/index.d.ts and web/board-runtime.json; public HTTP list/detail/progress contracts verified against the running project Board. Sibling Spur source was read only for contract inspection, never a runtime/package dependency.
- Existing project worktree only; no active wip tasks at audit. Prior authorized changes remain in the shared checkout.

### History

- 2026-10-12T22:31:50.321Z todo → wip (system)
- 2026-10-12T23:33:27.777Z wip → testing (system)
- 2026-10-12T23:33:51.071Z testing → done (system)

