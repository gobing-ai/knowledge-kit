---
schema_version: 1
name: Verify three workflow modules from an installed package and harden operator setup
status: todo
template: feature-impl
created_at: 2026-10-11T23:22:42.780Z
updated_at: "2026-10-11T23:52:29.726Z"
feature_id: G8
priority: P2
tags:
  - board
  - workflows
estimate_hours: 4

dependencies: ["0253", "0254"]
ac_altitude: task-local
ac_numbering: task-local
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

### Requirements

- [ ] R1. Prove all three native modules from a separately packed Knowledge Kit install in the installed Spur Board without source-checkout imports.
- [ ] R2. Verify stable run/tab/history links, project isolation, reader outage/stale recovery, same-folder supersession, safe config/artifacts and broken-module containment across all modules.
- [ ] R3. Verify keyboard/narrow-screen usability, media ranges and host React identity and document exact setup/restart/shutdown and legacy evidence limits.
- [ ] R4. Complete required repository checks and update planned/shipped documentation only from actual implementation and verification evidence.
- [ ] R5. Reuse Settings → Workflows for definition browsing, YAML/copy and static graphs; link /board/settings/workflows and expose only captured run settings in the module. No duplicate current-definition endpoint.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G8; ADR-035 (including ready-audit ownership amendment).
- docs/design/workflow-board-modules.md section 9: frozen names, types, capture timing, ownership and test handoff.
- docs/plans/2026-10-11-G8-ready-refinement.md: durable checklist/corrections report.
- Installed Spur 0.4.2: board/index.d.ts and web/board-runtime.json; public HTTP list/detail/progress contracts verified against the running project Board. Sibling Spur source was read only for contract inspection, never a runtime/package dependency.
- Existing project worktree only; no active wip tasks at audit. Prior authorized changes remain in the shared checkout.

### History
