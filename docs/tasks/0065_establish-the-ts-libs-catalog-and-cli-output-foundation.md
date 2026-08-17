---
template: feature-impl
schema_version: 1
name: "Establish the ts-libs catalog and CLI output foundation"
description: ""
status: done
type: task
profile: standard
feature_id: A3
parent_wbs: null
priority: P2
tags: ["ts-libs", "logging", "foundation"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T05:41:23.915Z"
updated_at: "2026-08-17T21:30:42.024Z"
---

## 0065. Establish the ts-libs catalog and CLI output foundation

### Background

Feature A3 replaces the local output foundation with the published ts-libs contracts. Implements: R1 — ts-libs packages are constrained in the root catalog and depended on only where consumed; the CLI and kk-core subsystem slice of R2 — a single terminal-output seam is backed by ts-utils echo and echoError; the CLI subsystem slice of R3 — structured logging is initialized once per diagnostic-emitting process.

Ordering: first; this task establishes the catalog and process-level seams consumed by the plugin migrations.

Boundary: keep the root catalog, CLI adapter/bootstrap, and kk-core output migration together because they define one foundation contract and share the root manifest, CLI entry point, and output tests. Plugin call-site migrations remain separate vertical slices.

Parent rubric: E20 D3 L3 C1 R1 = 28 → decompose (force: effort exceeds 16 hours). Candidate rubric: E6 D1 L2 C1 R1 = 11 → retain as one independently reviewable foundation task.

### Requirements
- [x] R1. Convert the root Bun workspace declaration to object form and constrain @gobing-ai/ts-utils, @gobing-ai/ts-infra, @gobing-ai/ts-runtime, and @gobing-ai/ts-db at ^0.4.35 in one catalog, declaring catalog dependencies only in direct consumers.
- [x] R2. Add apps/cli/src/output.ts as the injectable CommandOutput adapter over ts-utils echo and echoError, preserving stdout/stderr routing, message text, one final newline, and exit behavior; migrate apps/cli and packages/kk-core off @gobing-ai/utils.
- [x] R3. Initialize ts-infra logging exactly once at the CLI process entry before dispatch and use getLogger at CLI diagnostic call sites without custom sinks; keep packages/utils operational until remaining consumers are migrated.
### Acceptance Criteria
```gherkin
Feature: Establish the ts-libs catalog and CLI output foundation

  @core
  Scenario: R1 — ts-libs packages are constrained in the root catalog and depended on only where consumed
    Given the root package.json and workspace manifests after migration
    When the workspace declaration and dependencies are inspected
    Then workspaces is in Bun object form with one catalog declaring @gobing-ai/ts-utils, @gobing-ai/ts-infra, @gobing-ai/ts-runtime, and @gobing-ai/ts-db all at ^0.4.35
    And apps/cli declares catalog: dependencies on ts-utils and ts-infra
    And packages/kk-core declares a catalog: dependency on ts-utils
    And no workspace declares a dependency on ts-runtime or ts-db
    And packages/publish-harness no longer declares @gobing-ai/utils
    And bun install resolves the catalog cleanly

  @core
  Scenario: R2 — A single terminal-output seam is backed by ts-utils echo and echoError
    Given apps/cli/src/output.ts binding ts-utils echo and echoError per the frozen design
    When the CLI runs help, error, and data-output paths and kk-core render-md runs usage and fatal paths
    Then every apps/cli and packages/kk-core production call site delegates to echo or echoError through the adapter or directly
    And stdout/stderr routing, message text, final newlines, and exit codes are byte-identical to the pre-migration baseline
    And rg '@gobing-ai/utils' apps/cli/src packages/kk-core/src returns no matches

  @core
  Scenario: R3 — Structured logging is initialized once per diagnostic-emitting process
    Given the kk CLI process entry point
    When the process starts under any subcommand
    Then initializeLogger runs exactly once before dispatch with the console sink disabled when NODE_ENV=test
    And diagnostic call sites use getLogger('kk.cli') without installing a custom sink
    And packages/kk-core render-md initializes nothing, emitting only usage/fatal lines via echoError
```
### Q&A
- **Injection surface:** keep `MainOptions { stdout?, stderr? }` in `main.ts`; defaults bind to `consoleOutput`. Design-doc §2's `main(argv, { output })` is the spur-new shape; knowledge-kit already ships a tested injection surface — chosen: extend it, don't add a parallel one.
- **Newline mapping:** verified every in-scope `logger.out` string ends with `\n` and every `logger.error` call is single-string, so `echoError(s)` / `echo(withoutFinalLineEnding(s))` are byte-identical swaps. Any future site breaking the assumption must be fixed per-site, not pattern-forced.
- **kk-core logging:** ts-utils only. render-md emits usage/fatal lines; no structured diagnostics, so no ts-infra edge.
- **Root ts-utils devDep:** deferred to 0066 (its only root consumer, `plugins/kk/scripts/render-md.ts`, migrates there).
- **`apps/cli/plugins/*`:** are synced built-in copies (ADR-012), not sources — never edit; 0066 decides the rule exclude and fixes at `plugins/*` source.
- **publish-harness:** manifest-only utils dep (no source import) — dep line removed, nothing replaces it.
### Design
**WHAT.** Root catalog + the two process-level seams every later migration consumes: Bun
workspace object form with one catalog pinning all four ts-libs at `^0.4.35` (npm-verified
0.4.35, 2026-08-16); `apps/cli/src/output.ts` as the ts-utils terminal-output binding;
`initializeLogger` once at the CLI entry. Migrate `apps/cli` and `packages/kk-core` off
`@gobing-ai/utils`; leave `packages/utils` running for plugins (0066/0067 finish the cutover).

**WHY.** One version source (ADR-014) and one output/diagnostics seam (ADR-015) before any
plugin call-site migration — 0066/0067 then touch only call sites, not foundations.

**WHERE / frozen names.**

- `package.json` (root): `"workspaces": { "packages": [<existing 5 globs, unchanged>], "catalog": { ... } }`.
  No root ts-utils devDep yet — the `plugins/kk/scripts/render-md.ts` consumer edge arrives
  with its migration in 0066 (a root edge today is a dead dependency).
- `apps/cli/package.json`: `"@gobing-ai/ts-utils": "catalog:"`, `"@gobing-ai/ts-infra": "catalog:"`; drop `@gobing-ai/utils`.
- `packages/kk-core/package.json`: `"@gobing-ai/ts-utils": "catalog:"`; drop `@gobing-ai/utils`.
- `packages/publish-harness/package.json`: drop `@gobing-ai/utils` (manifest-only dep, no source import).
- `apps/cli/src/output.ts` (new): `interface CommandOutput { write(message: string): void; error(message: string): void }`,
  `consoleOutput: CommandOutput`, `toJson(value: unknown): string` — exactly the design-doc §2
  module, including `withoutFinalLineEnding` (strip one existing trailing `\r?\n`; ts-utils
  `echo`/`echoError` each append exactly one `\n`).
- `apps/cli/src/main.ts`: keep the public `MainOptions { stdout?, stderr? }` injection surface;
  defaults become `consoleOutput.write` / `consoleOutput.error` (was `logger.out` / `logger.error`).
- `apps/cli/src/index.ts`: `await initializeLogger({ console: process.env.NODE_ENV !== 'test', json: true, level: 'warn' })`
  before `main()`; category root `kk.cli` via `getLogger('kk.cli')` where a diagnostic is needed.
- `packages/kk-core/src/render-md.ts`: `logger.error(...)` → `echoError(...)` direct (both append one `\n`).

**Call-site mapping rule (audited, all current sites safe).** Every `logger.error(...)` /
`logger.out(...)` site in `apps/cli/src` (main, fanin, fanout, invoke, commands/plugin) and
`kk-core/src/render-md.ts` passes a **single string**; all `logger.out` strings end with `\n`.
Map: `logger.error(s)` → `echoError(s)`; `logger.out(s)` → `echo(withoutFinalLineEnding(s))`;
multi-arg `logger.error(a, b)` (space-join + JSON.stringify non-strings) → join first, then
`echoError`. `logger.info` has no call sites in scope — do not migrate what does not exist.
Byte-identity is the acceptance bar (R3); any site found violating the audit assumptions stops
the line — fix the mapping, don't force the pattern.

**Tests.** `apps/cli/tests/*` and `packages/kk-core/tests/render-md.test.ts` currently
monkey-patch `logger.out`/`logger.error`. Migrate to: `MainOptions` overrides where the test
already drives `main()`; ts-utils `setDefaultOutputTargets` / `createBufferTarget` for
capture at lower seams; `setLoggerMuted(true)` in setup where diagnostics would print. No test
keeps a `@gobing-ai/utils` import.

**Anti-patterns (do not implement).**
- No parallel `{ output }` injection object in `main()` — `MainOptions` is the tested surface (deviation note: design-doc §2's `main(argv, { output })` is illustrative; the invariant is the adapter module + unchanged observable behavior, not a second options shape).
- No speculative `getLogger` call sites — the CLI today has zero diagnostic logging; initialize the seam, use it only where a real diagnostic exists (plugin-spawn diagnostics stay user-facing `echoError`).
- No ts-infra dependency in kk-core — render-md emits usage/fatal lines only (`echoError`).
- No changes under `plugins/**` or `apps/cli/plugins/**` — those are 0066/0067 scope (and `apps/cli/plugins/*` are synced built-in copies per ADR-012: fix at source, never edit copies).
- No `packages/utils` edits or deletion — 0067 owns removal.

**Handoff.** Leaves for 0066: root ts-utils devDep + script/plugin `console.*` migrations,
rule-glob extension (including the `apps/cli/plugins/**` exclude decision). Leaves for 0067:
`packages/utils` deletion once `rg '@gobing-ai/utils' apps packages plugins` is empty.
Assumes nothing from siblings — 0065 is first.
### Plan
1. [x] (R1) Root `package.json`: workspaces → object form; add catalog with the four `@gobing-ai/ts-*` at `^0.4.35`. Run `bun install` — must resolve.
2. [x] (R2) Manifests: apps/cli +catalog: ts-utils/ts-infra, −utils; kk-core +catalog: ts-utils, −utils; publish-harness −utils. `bun install` again; `bun run build` green before touching source.
3. [x] (R3) Add `apps/cli/src/output.ts` per Design (frozen module from design-doc §2).
4. [x] (R4) `apps/cli/src/index.ts`: `initializeLogger` once before `main()` (console sink off under `NODE_ENV=test`, json true, level warn).
5. [x] (R3/R5) Migrate call sites per the mapping rule: main.ts (defaults → `consoleOutput`), fanin.ts, fanout.ts, invoke.ts, commands/plugin.ts, cli.ts/config.ts if they import utils; kk-core `render-md.ts` → `echoError`.
6. [x] (R5) Migrate tests off `logger` monkey-patching → `MainOptions` / `createBufferTarget` / `setLoggerMuted` per Design.
7. [x] (R3) Byte-identity check: run `kk --help`, a failing command, and `kk plugins list --json` before/after (capture from the pre-migration binary first) and diff stdout/stderr/exit code.
8. [x] (R5/R6) Gates: `rg '@gobing-ai/utils' apps/cli/src packages/kk-core/src` → empty; `bun run lint && bun run test && bun run build` green; `packages/utils` untouched.
- `package.json:6`: converted `workspaces` to object format with `catalog` pinning `@gobing-ai/ts-utils`, `@gobing-ai/ts-infra`, `@gobing-ai/ts-runtime`, and `@gobing-ai/ts-db` at `^0.4.35`.
- `apps/cli/package.json:10`: switched to catalog dependencies on `ts-utils` and `ts-infra`, dropped `@gobing-ai/utils`.
- `packages/kk-core/package.json:12`: switched to catalog dependency on `ts-utils`, dropped `@gobing-ai/utils`.
- `packages/publish-harness/package.json:12`: dropped unused `@gobing-ai/utils` dependency.
- `apps/cli/src/output.ts:1`: implemented `CommandOutput` interface with `consoleOutput` adapter over `echo`/`echoError` and `toJson` helper.
- `apps/cli/src/index.ts:13`: added `initializeLogger` before `main()`.
- `apps/cli/src/main.ts:20`, `apps/cli/src/fanin.ts:1`, `apps/cli/src/fanout.ts:1`, `apps/cli/src/invoke.ts:4`, `apps/cli/src/commands/plugin.ts:1`: migrated `logger.out`/`logger.error` to `echo`/`echoError`.
- `packages/kk-core/src/render-md.ts:3`: migrated error reporting to `echoError`.
- `apps/cli/tests/capture.ts:1`, `apps/cli/tests/output.test.ts:1`: added buffer target capture fixtures and output unit tests.
- `bun run spur-check:full`: Biome lint check, typecheck, pre-check rules, 388 unit tests, and post-check rules (coverage-gate, tsdoc-export) all PASS.
- Aggregate coverage: line 99.21%, function 99.22% (meets 90% threshold).
- `rg '@gobing-ai/utils' apps/cli/src packages/kk-core/src`: zero matches.
- `bun run build`: `@gobing-ai/knowledge-kit` built cleanly.
**Disposition: PASS** — no blockers.

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | (none) | — |
| P2 | (none) | — |
| P3 | (none) | — |
| P4 | (none) | — |

- SECUA: No credentials or unvalidated inputs; terminal stdout/stderr separation preserved; exit codes preserved; no breaking public API changes.
- Traceability: R1, R2, R3 fully implemented and verified against Acceptance Criteria scenarios.
- Residual Risk: Low. Remaining plugin migrations and `@gobing-ai/utils` deletion isolated to subsequent tasks 0066 and 0067.
- Feature: A3 (`docs/features/A3_ts-libs-logging-foundation.md`)
- Authority: ADR-014 (catalog), ADR-015 (output vs diagnostics); design `docs/design/ts-libs-logging-foundation.md` §§1–3, 7
- Source contracts (read 2026-08-16): `/Users/robin/xprojects/ts-libs/packages/utils/src/output.ts` @ 0.4.35; `/Users/robin/xprojects/ts-libs/packages/infra/src/logger.ts` @ 0.4.35; spur-new `apps/cli/src/{output,index}.ts`
- Handoff: 0066 (plugin/script migrations + rule scope), 0067 (utils removal)
- 2026-08-17T21:07:55.872Z todo → wip (system)
- 2026-08-17T21:07:57.946Z wip → testing (system)
- 2026-08-17T21:08:23.032Z testing → done (system)
### Solution
- `package.json:6`: converted `workspaces` to object format with `catalog` pinning `@gobing-ai/ts-utils`, `@gobing-ai/ts-infra`, `@gobing-ai/ts-runtime`, and `@gobing-ai/ts-db` at `^0.4.35`.
- `apps/cli/package.json:10`: switched to catalog dependencies on `ts-utils` and `ts-infra`, dropped `@gobing-ai/utils`.
- `packages/kk-core/package.json:12`: switched to catalog dependency on `ts-utils`, dropped `@gobing-ai/utils`.
- `packages/publish-harness/package.json:12`: dropped unused `@gobing-ai/utils` dependency.
- `apps/cli/src/output.ts:1`: implemented `CommandOutput` interface with `consoleOutput` adapter over `echo`/`echoError` and `toJson` helper.
- `apps/cli/src/index.ts:13`: added `initializeLogger` before `main()`.
- `apps/cli/src/main.ts:20`, `apps/cli/src/fanin.ts:1`, `apps/cli/src/fanout.ts:1`, `apps/cli/src/invoke.ts:4`, `apps/cli/src/commands/plugin.ts:1`: migrated `logger.out`/`logger.error` to `echo`/`echoError`.
- `packages/kk-core/src/render-md.ts:3`: migrated error reporting to `echoError`.
- `apps/cli/tests/capture.ts:1`, `apps/cli/tests/output.test.ts:1`: added buffer target capture fixtures and output unit tests.
### Testing
- `bun run spur-check:full`: Biome lint check, typecheck, pre-check rules, 388 unit tests, and post-check rules (coverage-gate, tsdoc-export) all PASS.
- Aggregate coverage: line 99.21%, function 99.22% (meets 90% threshold).
- `rg '@gobing-ai/utils' apps/cli/src packages/kk-core/src`: zero matches.
- `bun run build`: `@gobing-ai/knowledge-kit` built cleanly.
### Review
**Disposition: PASS** — no blockers.

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | (none) | — |
| P2 | (none) | — |
| P3 | (none) | — |
| P4 | (none) | — |

- SECUA: No credentials or unvalidated inputs; terminal stdout/stderr separation preserved; exit codes preserved; no breaking public API changes.
- Traceability: R1, R2, R3 fully implemented and verified against Acceptance Criteria scenarios.
- Residual Risk: Low. Remaining plugin migrations and `@gobing-ai/utils` deletion isolated to subsequent tasks 0066 and 0067.
### References
- Feature: A3 (`docs/features/A3_ts-libs-logging-foundation.md`)
- Authority: ADR-014 (catalog), ADR-015 (output vs diagnostics); design `docs/design/ts-libs-logging-foundation.md` §§1–3, 7
- Source contracts (read 2026-08-16): `/Users/robin/xprojects/ts-libs/packages/utils/src/output.ts` @ 0.4.35; `/Users/robin/xprojects/ts-libs/packages/infra/src/logger.ts` @ 0.4.35; spur-new `apps/cli/src/{output,index}.ts`
- Handoff: 0066 (plugin/script migrations + rule scope), 0067 (utils removal)
### History
- 2026-08-17T21:07:55.872Z todo → wip (system)
- 2026-08-17T21:07:57.946Z wip → testing (system)
- 2026-08-17T21:08:23.032Z testing → done (system)
