---
schema_version: 1
name: Normalize kk stage and lock commands with compatible aliases
status: todo
template: feature-impl
created_at: 2026-10-13T22:24:49.070Z
updated_at: "2026-10-13T22:40:51.452Z"
feature_id: A22
priority: P1
tags:
  - cli
  - browser-session
estimate_hours: 4

ac_altitude: task-local
ac_numbering: task-local
---

## 0275. Normalize kk stage and lock commands with compatible aliases

### Background

Feature A22. Implements: R1 — Canonical operations have exactly two command words; R2 — Existing command routes preserve their contracts. Design authority: docs/design/kk-noun-verb-bots.md; ADR-037/038. Implement only this deliverable. Use Bun and existing workspace seams; no new runtime or package. Keep docs/04_DESIGN.md and affected authority/derived docs synchronized in the implementation change. Do not edit .github/workflows. Run bun run lint, bun run test, bun run build and affected Spur rules before implementation completion. Preserve partial evidence if the working budget is reached; do not widen scope or manufacture source edits.

**Refine corrections (2026-10-13)**
- Future stage named run was treated as an existing compatibility obligation → the current dispatcher has no run stage → reserve run for canonical syntax and preserve valid current legacy identifiers.
- Stage alias registration had no dispatch entry specified → main() alone owns product argv parsing → freeze pre-parse normalizeStageArgs and keep the visible noun action-free.
- Root/default group behavior and missing run data were ambiguous → current main and Commander seams own help/error behavior → state explicit group/help and canonical usage handling.
- Lock aliases could duplicate actions → current store handlers already own SQLite side effects → share one registrar and verify with a real temporary DB.
- Checkbox AC had no task requirement coverage → the ready checklist requires bound scenarios → use executable Scenario AC with explicit requirement bindings.
- Canonical docs and bulk callers overlapped 0278 → 0275 owns surface docs/tests; 0278 owns bulk recipes → freeze handoff and out-of-scope boundaries.

Out of scope: implementing other A22 tasks, changing publishing operations, adding a plugin kind/runtime, credential export, server logout, arbitrary caller rewrites, or changes to .github/workflows. Authority: ADR-037/038 and docs/design/kk-noun-verb-bots.md. All changes use the project Bun/Biome conventions and CLI-gated corpus writes. Shared task checks now use Scenario AC with task requirement bindings; feature titles remain stable. No implementation success is claimed by this refinement.

### Requirements

- [ ] R1. Expose only canonical two-command-word product actions; keep valid nouns/verbs, add stage run and top-level lock acquire/release, and leave all root/noun groups without default product actions.
- [ ] R2. Normalize valid legacy stage invocations at main() before Commander parses them; preserve full process argv prefixes, root -v/--verbose, -- separators, ordered data/unknown options and runStage stdout/stderr/child status. Reserve run as the new verb because no current stage identifier is run.
- [ ] R3. Use one lock registrar and the existing SQLite action engines for canonical lock and hidden store lock routes; retain all existing invoke/fanin/fanout/plugin/plugins aliases and option/default/output semantics without alias diagnostics.
- [ ] R4. Test the real main parsing path and real temporary SQLite lock effects, plus recursive command-tree shape and hidden alias visibility; keep current valid legacy callers working.
- [ ] R5. Update canonical surface documentation and package help tests in this implementation change; defer bulk workflow/skill recipe migration to 0278.

### Acceptance Criteria

```gherkin
Feature: Normalize kk stage and lock commands with compatible aliases

  Scenario: AC1 — R1 — Canonical operations have exactly two command words (req: R1; R4; R5)
    Given the complete visible command tree including all store and workflow operations
    When an operator inspects root and noun help
    Then each executable operation uses kk followed by one noun and one verb
    And stage run and lock acquire and lock release replace the irregular canonical paths
    And existing valid board, daily, executor, ledger, plugin, schedule and store operations retain their names
    And a command-tree test detects a direct noun action or a nested third command word

  Scenario: AC2 — R2 — Existing command routes preserve their contracts (req: R2; R3; R4; R5)
    Given scripts using stage positional arguments, store lock acquire or release, and existing hidden aliases
    When they execute with their original arguments and options
    Then they reach the same action engines with equivalent stdout, stderr, exit codes and side effects
    And aliases are hidden from canonical help without emitting warnings into machine output
    And legacy stage names and canonical stage run dispatch without losing unknown options or positional arguments

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T22:40:49.139Z

Stage run is newly reserved syntax; preserve existing valid stage identifiers rather than hypothetical future identifiers. Canonical routing lives in main pre-parse normalization, and locks share current SQLite engines. Bulk recipe replacement belongs to 0278.

### Design

Chosen shape: export normalizeStageArgs(argv: readonly string[]): string[] from apps/cli/src/commands/stage.ts; main.ts calls it before parseAsync. It preserves argv[0:2], recognizes the root stage token after supported root globals, and inserts run only for legacy stage-data tokens. help stage and root help/version are unchanged; stage run --help targets canonical verb help; stage run with no stage is a canonical usage error. No existing stage has identifier run, so do not invent a compatibility branch for a hypothetical future run stage. Root/noun absence shows Commander help/usage without executing data work. The normalization contract applies to main(), the product entry; direct registrar unit tests exercise canonical registration.

registerStageCommand registers stage as a group and run <args...> as its only visible operation; the handler delegates to runStage. Keep unknown-option handling and argument order through the existing output/error seam. Lift lock registration into apps/cli/src/commands/lock.ts as registerLockCommands(parent, hidden=false) or an equally small shared registrar; canonical lock uses it once, hidden store lock uses it once. SQLite actions stay shared; no child kk invocation and no copied action bodies.

Ownership: apps/cli/src/main.ts, cli.ts, commands/stage.ts, commands/store.ts, new commands/lock.ts, affected CLI tests, and surface docs. No dependency on 0276; leave 0278 canonical routes/alias tests to consume. No bot code. Production requireDiff=true. Budget: existing four-hour estimate; save partial task evidence rather than broadening.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

Verified source premises: apps/cli/src/main.ts:28; apps/cli/src/commands/stage.ts:9; apps/cli/src/commands/store.ts:1605; apps/cli/src/cli.ts:19; apps/cli/tests/main.test.ts:52; apps/cli/tests/commands/store.test.ts:38.

### Plan

- [ ] 1. Baseline: read all stage identifiers in kk-workflow-stages.ts and all createProgram/main callers; capture current supported legacy argv and lock outputs. Record concurrent work/baseline findings.
- [ ] 2. Implement main-stage argv normalization and canonical stage registration; factor lock registration around the existing handlers. Retain current aliases.
- [ ] 3. Extend apps/cli/tests/main.test.ts and commands/stage.test.ts for globals, --, unknown options, help, unknown stages, missing data and child exit failures. Extend commands/store.test.ts plus new commands/lock.test.ts to acquire/re-enter/contend/release a real temporary DB through canonical and legacy routes.
- [ ] 4. Update recursive command-tree assertions in apps/cli/tests/main.test.ts or a focused cli-surface.test.ts; sweep pinned visible noun/verb lists and help expectations before running tests.
- [ ] 5. Sync docs/04_DESIGN.md, docs/design/kk-cli-surface.md, the A22 satellite and AGENTS surface notes; run targeted tests, rebuild/package smoke, bun run lint/test/build and affected Spur constraints. Report pre-existing outside-scope failures.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A22; ADR-037/038; docs/design/kk-noun-verb-bots.md.

Current-tree premises: apps/cli/src/main.ts:28; apps/cli/src/commands/stage.ts:9; apps/cli/src/commands/store.ts:1605; apps/cli/src/cli.ts:19; apps/cli/tests/main.test.ts:52; apps/cli/tests/commands/store.test.ts:38.

Dependency contracts: none.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

### History
