---
schema_version: 1
name: Review and migrate compatible CLI and browser session callers
status: todo
template: feature-impl
created_at: 2026-10-13T22:24:49.083Z
updated_at: "2026-10-13T22:41:28.151Z"
feature_id: A22
priority: P1
tags:
  - cli
  - browser-session
estimate_hours: 4

dependencies: ["0275", "0276", "0277"]
ac_altitude: task-local
ac_numbering: task-local
---

## 0278. Review and migrate compatible CLI and browser session callers

### Background

Feature A22. Implements: R8 — Implementation tasks precede evidence-based caller migration; R1 — Canonical operations have exactly two command words; R2 — Existing command routes preserve their contracts; R7 — Shared browser behavior and plugin readiness remain compatible. Design authority: docs/design/kk-noun-verb-bots.md; ADR-037/038. Implement only this deliverable. Use Bun and existing workspace seams; no new runtime or package. Keep docs/04_DESIGN.md and affected authority/derived docs synchronized in the implementation change. Do not edit .github/workflows. Run bun run lint, bun run test, bun run build and affected Spur rules before implementation completion. Preserve partial evidence if the working budget is reached; do not widen scope or manufacture source edits.

**Refine corrections (2026-10-13)**
- Caller review claimed whole CLI and session scenarios → it only consumes verified upstream contracts → assign only feature R8 and define dependency outputs.
- Comprehensive inventory could sweep historical evidence into migration → historical tasks/ADRs/verdicts must retain past truth → distinguish active recipes and forbid mass historical rewrites.
- Bot open was a possible replacement for every browser call → publisher callbacks need in-process contexts → freeze replaceable/shared-helper/retained categories with concrete equivalence tests.
- Browser/podcast support was open-ended → current Xiaoyuzhou connector is absent and microfeed is API → require measured classification and no new transport in this review.

Out of scope: implementing other A22 tasks, changing publishing operations, adding a plugin kind/runtime, credential export, server logout, arbitrary caller rewrites, or changes to .github/workflows. Authority: ADR-037/038 and docs/design/kk-noun-verb-bots.md. All changes use the project Bun/Biome conventions and CLI-gated corpus writes. Shared task checks now use Scenario AC with task requirement bindings; feature titles remain stable. No implementation success is claimed by this refinement.

### Requirements

- [ ] R1. After 0275/0276/0277 complete, freeze a file-level inventory of command, profile/session and browser-launch callers across apps, packages, plugins, product workflows, docs, tests and package scripts; record actual supported transports instead of assuming a channel connector exists.
- [ ] R2. Write docs/reviews/2026-10-13-A22-cli-browser-caller-migration.md with each candidate classified replaceable CLI entry, shared-helper reuse or retained specialized path, its evidence and associated regression test. Migrate only behavior-equivalent operator recipes and stage/lock invocations.
- [ ] R3. Retain publishing contexts, read-only preflights, WeChat restoration, environment overrides, X API posts and microfeed API transport unless equivalent reuse is proven. Xiaoyuzhou generic login does not imply a publisher adapter. A report-only outcome is valid when all remaining candidates need specialized paths.
- [ ] R4. For each replaced caller verify argv/output/exit/scope behavior at the layer that executes it, validate affected Spur workflow YAML and capability files using their existing owner tools, and run required repository checks without initiating a real publish.
- [ ] R5. Synchronize affected surface/design/workflow docs and canonical examples, keeping historical task/verdict/ADR records intact. Record retained paths, unsupported connectors and live-unverified limitations; update lifecycle/status only through Spur with actual implementation evidence.

### Acceptance Criteria

```gherkin
Feature: Review and migrate compatible CLI and browser session callers

  Scenario: AC1 — R8 — Implementation tasks precede evidence-based caller migration (req: R1; R2; R3; R4; R5)
    Given the canonical surface design and bot lifecycle implementation tasks
    When the dependent caller review executes after the bot tasks
    Then it inventories workflows, scripts, skills, docs, tests and publisher session entry points
    And it records each candidate as replaceable, shared-helper reuse or retained with a concrete reason
    And compatible operator entry points use canonical commands with regression evidence
    And publishing flows keep their existing session, readiness and error semantics
    And all tasks are linked to this feature with explicit dependencies and verification plans

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T22:41:27.592Z

The deliverable is a complete inventory plus supported migration, not a compulsory rewrite. Historical evidence and custom external-profile recipes remain unchanged unless explicitly applicable. API transports and long-lived publishing contexts remain specialized. Only R8 is owned here; earlier task contracts are consumed, not reimplemented.

### Design

Depends on 0275's canonical stage/lock + alias routes, 0276's generic lifecycle/lease/metadata, and 0277's channel adapters/state behavior. They must be implemented and verified before this task executes; refinement does not execute them. This task owns only the inventory/report and justified caller changes, never the upstream API or session algorithms. Keep feature R8 as its scenario; remove R1/R2/R7 duplicate whole-implementation claims because this task consumes those contracts rather than implements them.

Freeze candidate roots with rg across apps/cli, apps/board, packages, plugins/kk/workflows, plugins/kk/scripts, plugins/kk/skills, plugins/kk/commands, plugins/publishings, docs/design and active operator docs. Include shipped workflow definitions and any project-local .spur/workflows overrides that actually reference kk; distinguish local ignored operator artifacts from committed product files. Include resolveBrowserProfileDir/resolveChannelProfileDir, kkBrowserLauncher/openPersistentBrowser/loginWithProfile/withProfilePage, profile-check invocation, kk stage, kk store lock and old hidden aliases. Deduplicate by file:line and call site; counts are measured at execution time, never copied from this planning snapshot.

Matrix columns: file:line, current call/transport, category, selected replacement or retained reason, regression evidence, action status. Preserve historical docs/tasks and ADR entries: they are evidence, not stale recipes to mass-rewrite. In-process publish flows keep their callback/context lifetimes; bot open is an interactive operator process, not a publish helper. Use shared-harness helper reuse only when site readiness, errors and ownership semantics remain intact. Do not migrate customized external profile locations to fixed bot paths without explicit equivalence; retain them with a reason. Unsupported/custom-domain adapter cases remain generic or specialized, never silently site-verified.

Regression observations: workflow argv changes in existing workflow/stage tests; operator recipes via docs tests or a local non-publishing example; shared-helper caller changes through their channel/launcher tests. Run capability validation only on changed skill/command files using Superskill noun validation after checking current noun help; do not invoke an agent-generation workflow. Workflow YAML changes use Spur validation. Report-only requireDiff=false; scoped caller migrations requireDiff=true. Save report even if a candidate cannot safely change; no invented source diff to satisfy a tool. Existing four-hour estimate is a bounded sweep; persist unprocessed candidates honestly at its boundary rather than calling an incomplete review comprehensive.

Scope: report plus compatible caller patches/associated tests/docs. No new CLI, browser transport or ownership layer. No real publishing or .github/workflows edits. Leave a completed inventory with explicit retained reasons and implementation evidence for feature closure.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

Verified source premises: apps/cli/src/stage.ts:13; plugins/kk/workflows/kk-collect.yaml:79; plugins/publishings/wechatmp-pub/src/index.ts:73; plugins/publishings/podcast-pub/src/index.ts:58; AGENTS.md:26.

### Plan

- [ ] 1. Read verified upstream implementations/task evidence and current concurrent worktree state; freeze candidate inventory and transport classification before any edit.
- [ ] 2. Write the durable migration matrix and decide every candidate from actual semantics; distinguish active recipes from historical evidence and operator-local overrides.
- [ ] 3. Migrate compatible stage/lock recipes and operator browser session entry points, or reuse proven shared helpers; retain specialized/API paths with concrete reasons. Never replace an in-process publish context with bot open.
- [ ] 4. Update relevant existing workflow/stage/channel/docs tests for changed callers, validate affected workflow/capability artifacts, and run required lint/test/build/constraint checks. Do not trigger live publishing.
- [ ] 5. Sync changed docs/status through authority/Spur, finalize every matrix row with regression evidence or retained rationale, and report counts plus real remaining limitations.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A22; ADR-037/038; docs/design/kk-noun-verb-bots.md.

Current-tree premises: apps/cli/src/stage.ts:13; plugins/kk/workflows/kk-collect.yaml:79; plugins/publishings/wechatmp-pub/src/index.ts:73; plugins/publishings/podcast-pub/src/index.ts:58; AGENTS.md:26.

Dependency contracts: 0275, 0276, 0277.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

### History
