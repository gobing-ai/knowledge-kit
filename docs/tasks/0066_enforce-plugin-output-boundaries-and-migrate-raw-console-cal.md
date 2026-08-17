---
template: feature-impl
schema_version: 1
name: "Enforce plugin output boundaries and migrate raw console call sites"
description: ""
status: done
type: task
profile: standard
feature_id: A3
parent_wbs: null
priority: P2
tags: ["ts-libs", "logging", "plugins", "rules"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T05:41:23.923Z"
updated_at: "2026-08-17T21:30:42.306Z"
---

## 0066. Enforce plugin output boundaries and migrate raw console call sites

### Background

Feature A3 makes the existing output-boundaries gate cover production plugins and removes the violations it exposes. Implements: the plugin and root-script subsystem slice of R2 — terminal output delegates to ts-utils; the karakeep-local and web-search subsystem slice of R3 — structured logging is initialized once per diagnostic-emitting process; R4 — all production console call sites migrate to the seams; R5 — karakeep-local gains its missing package.json; R7 — the rule proves RED then GREEN; R8 — warning paths stay non-fatal; R9 — rule scope extension flags production only.

Ordering: after “Establish the ts-libs catalog and CLI output foundation”; it consumes the catalog and logging/output contracts created there.

Boundary: karakeep-local, web-search, render-md, and the rule update stay together because the deliverable is one independently verifiable RED→GREEN enforcement boundary. Splitting by plugin would leave intermediate tasks with a knowingly failing required rule or weaken proof that the complete 15-site baseline was detected.

Candidate rubric: E8 D1 L3 C1 R1 = 14 → retain as one enforcement-and-migration vertical slice; rejected split: one task per plugin would multiply ceremony and break the atomic RED→GREEN review context.

### Requirements
- [x] R2. A single terminal-output seam is backed by ts-utils echo and echoError for migrated plugins and scripts.
- [x] R3. Structured logging is initialized once per diagnostic-emitting process before dispatch.
- [x] R4. All 15 baseline production console call sites migrate to ts-utils / ts-infra seams.
- [x] R5. karakeep-local gains a sibling-convention package.json and tsconfig.json.
- [x] R7. The output-boundaries rule enforces the invariant RED (15 violations) then GREEN (0 violations).
- [x] R8. Warning paths stay non-fatal after migration, continuing execution.
- [x] R9. Rule scope extension flags production source only, leaving test files and fixtures unflagged.
### Acceptance Criteria
```gherkin
Feature: Enforce plugin output boundaries and migrate raw console call sites

  @core
  Scenario: R2 — A single terminal-output seam is backed by ts-utils echo and echoError
    Given the migrated karakeep-local, web-search, and plugins/kk/scripts/render-md.ts
    When usage and fatal paths run for each
    Then usage and fatal messages go to stderr via ts-utils echoError with unchanged text, routing, final newlines, and exit codes
    And the render-md script's render logic stays byte-identical to packages/kk-core/src/render-md.ts per its SYNC header

  @core
  Scenario: R3 — Structured logging is initialized once per diagnostic-emitting process
    Given the migrated plugin executables
    When each plugin process starts
    Then initializeLogger runs exactly once in the entry path, never at module top level
    And recoverable diagnostics use getLogger('kk.ingestion.karakeep-local') and getLogger('kk.ingestion.web-search') with no custom sink
    And the render-md script initializes nothing, emitting only usage/fatal lines via echoError

  @core
  Scenario: R4 — All production console call sites migrate to the seams
    Given the 15-site baseline (7 karakeep-local, 6 web-search, 2 render-md script)
    When the migration is complete
    Then every baseline site delegates to echoError for usage/fatal or getLogger(...).warn for recoverable diagnostics
    And zero console-method or raw stdout/stderr writes remain under apps, packages, and plugins production source

  @core
  Scenario: R5 — karakeep-local gains the package.json it is missing
    Given a new plugins/ingestions/karakeep-local/package.json following the web-search sibling convention
    When the workspace is installed and built
    Then the manifest declares only direct dependencies: catalog: entries for ts-utils and ts-infra plus workspace:* for @gobing-ai/kk-core if imported
    And the plugin.json invocation contract and build are unchanged

  @core
  Scenario: R7 — The output-boundaries rule enforces the invariant RED then GREEN
    Given the rule scope extension applied to the pre-migration tree
    When recommended-pre-check runs before and after migration
    Then the before run reports exactly the 15 baseline sites (captured in the task record)
    And the after run reports zero output-boundaries findings

  @core
  Scenario: R8 — Warning paths stay non-fatal after migration
    Given the migrated plugins
    When corrupt-file and scrape-failure warning paths execute
    Then warnings emit through the plugin logger and processing continues
    And exit codes and control flow match the pre-migration behavior

  @core
  Scenario: R9 — Rule scope extension flags production only
    Given the extended include and exclude lists
    When the rule runs against the full tree
    Then production source under plugins/**/src/** and plugins/kk/scripts/** is covered
    And tests, test files, fixtures, node_modules, and dist are unflagged
```
### Q&A
- **Baseline count is 15, not 17.** The idea-eval report said 17 (8/7/2); direct rg on the tree
  gives 15 (7 karakeep-local, 6 web-search, 2 render-md script). The task's R2 premise is the
  correct one — the eval overcounted.
- **`apps/cli/plugins/**` needs no rule exclude.** `/apps/cli/plugins/` is gitignored (line 159)
  and the rg evaluator honors gitignore — verified: current pre-check is GREEN with copies
  present. Rule changes stay at the design-doc §5 list.
- **Test capture seam is `fileSink`.** ts-infra `InitLoggerOptions` = `{ level, console, fileSink, json }`
  — no memory sink; tests re-initialize with `console: false, fileSink: capture` (reconfigure is
  safe: prior config resets) or mute via `setLoggerMuted(true)`.
- **Script self-containedness traded deliberately.** The kk render-md script gains a ts-utils
  import; resolution is covered by the root devDep (repo) and the kk package's own ts-utils dep
  (installed). Byte-identity with kk-core render-md is preserved because both sides import the
  same symbol after 0065.
- **Other plugins' `@gobing-ai/utils` imports (content-gen, qiita-pub, zenn-pub, surfdash-pub,
  emdash-pub) are out of scope here** — they have no console violations; 0067 migrates them as
  part of the utils removal.
### Design
**WHAT.** Extend `output-boundaries.yaml` to plugin production source (RED first, proving the
gate sees all 15 baseline sites), then migrate karakeep-local (7), web-search (6), and
`plugins/kk/scripts/render-md.ts` (2) onto the ts-utils/ts-infra seams, and add karakeep-local's
missing `package.json`. One atomic RED→GREEN enforcement boundary.

**WHY.** Rule-first proves detection before removal — migrating first would leave the blind
window unmeasured. One task keeps RED and GREEN in a single review context.

**WHERE / frozen names.**

- `.spur/rules/typescript/output-boundaries.yaml`: include `+= plugins/**/src/**/*.ts,
  plugins/kk/scripts/**/*.ts`; exclude `= **/tests/**, **/*.test.ts, **/fixtures/**,
  **/node_modules/**, **/dist/**` (design-doc §5 verbatim).
- `plugins/ingestions/karakeep-local/package.json` (new): mirror
  `plugins/ingestions/web-search/package.json` — `name: @gobing-ai/karakeep-local`, private,
  `type: module`, typecheck script, `dependencies: { "@gobing-ai/kk-core": "workspace:*",
  "@gobing-ai/ts-utils": "catalog:", "@gobing-ai/ts-infra": "catalog:" }`,
  `devDependencies: { "@types/bun": "1.3.14" }`. Drop kk-core if source never imports it.
- Root `package.json` devDependencies `+= "@gobing-ai/ts-utils": "catalog:"` — the deferred
  0065 handoff; the root consumer is the kk render-md script.
- `plugins/ingestions/web-search/package.json`: `+= "@gobing-ai/ts-utils": "catalog:",
  "@gobing-ai/ts-infra": "catalog:"`; drop `@gobing-ai/utils` (import exists in src today? —
  web-search src imports only console builtins now; verify at implement: remove the utils dep
  only if unused).
- Call-site mapping (fatal/usage → `echoError`; recoverable → `getLogger(...).warn`):
  karakeep-local `:143` usage → echoError; `:152, :163` fatal → echoError; `:72, :115, :118`
  `Warning:` recoverable → `log.warn`; `:40` `Error:` + err → echoError if the path exits,
  `log.error` if recovered — decide at the call site by fatality, record the choice in Solution.
  web-search `:363` usage, `:371, :398, :412` `web-search failed` fatal → echoError;
  `:197, :298` `console.warn` recoverable → `log.warn`.
  Categories: `kk.ingestion.karakeep-local`, `kk.ingestion.web-search`.
- Bootstrap per plugin process: `await initializeLogger({ console: process.env.NODE_ENV !== 'test', json: true, level: 'warn' })`
  inside the entry/dispatch path only — never at module top level (tests import the module and
  install their own sink).
- `plugins/kk/scripts/render-md.ts`: `console.error` ×2 (`:128, :136`) → `echoError`; add
  `import { echoError } from '@gobing-ai/ts-utils'`. Resolution: repo runs → root devDep;
  installed-package runs → the kk package's own ts-utils dependency (0065). Keep render logic
  byte-identical with `packages/kk-core/src/render-md.ts` (its post-0065 form) per the SYNC header.

**Tests.** web-search tests currently assign `console.error`/`console.warn` (ORIGINAL_ restore).
Replace with `initializeLogger({ console: false, fileSink: (line) => captured.push(line) })`
in setup (re-init is safe — it resets first) and/or `setLoggerMuted(true)` when only silence is
needed; assert on captured JSON-lines. `echoError` capture uses ts-utils
`setDefaultOutputTargets` / `createBufferTarget`. karakeep-local tests have no console patching —
no change expected beyond imports.

**Anti-patterns (do not implement).**
- No `console.*` left behind "temporarily", and no per-site `// biome-ignore`-style rule
  suppression — GREEN must be real.
- No logger initialization at module top level — import-time side effects break the test seam.
- No changes under `apps/cli/plugins/**` — gitignored synced built-ins; fix at `plugins/*` source
  and let the bundle sync propagate (`.gitignore:159` is also why the current rule stays green
  with copies present — the rg evaluator honors gitignore).
- No warning→fatal upgrades: `Warning:` paths keep their continue-on-error flow and exit codes.
- No ts-infra edge in the render-md script — usage/fatal only, `echoError` suffices.

**Handoff.** Assumes from 0065: catalog exists, ts-utils/ts-infra resolvable, kk-core render-md
already on `echoError`. Leaves for 0067: `packages/utils` deletion (all plugin imports of
`@gobing-ai/utils` — content-gen, qiita-pub, zenn-pub, surfdash-pub, emdash-pub — migrate there,
not here; this task touches only the three console-violating surfaces).
### Plan
1. [x] (R1) Edit `.spur/rules/typescript/output-boundaries.yaml` include/exclude per Design.
2. [x] (R2) Run `spur rule run --preset recommended-pre-check --fail-on warning` — capture RED output; verify findings cover exactly the 15 baseline sites (7 karakeep-local + 6 web-search + 2 render-md script); paste count into the task record.
3. [x] (R3) Add `plugins/ingestions/karakeep-local/package.json` per sibling convention; `bun install`; verify workspace picks it up (`bun run --filter './plugins/ingestions/*' typecheck`).
4. [x] (R6) Root devDeps `+= @gobing-ai/ts-utils: catalog:`; migrate `plugins/kk/scripts/render-md.ts` (2 sites) to `echoError`; diff render logic vs kk-core post-0065 — must stay byte-identical; run the STORM render fixture once.
5. [x] (R4) karakeep-local: manifest deps, entry-path `initializeLogger`, site mapping per Design (7 sites); fatal exit codes + warning flow unchanged.
6. [x] (R5) web-search: manifest deps, entry-path `initializeLogger`, site mapping per Design (6 sites); migrate tests off console monkey-patching to `fileSink` capture / `setLoggerMuted` / `createBufferTarget`.
7. [x] (R7) `spur rule run --preset recommended-pre-check` → zero output-boundaries findings; `bun run lint && bun run test` green; spot-check one fatal path per migrated binary for stderr text + exit code parity.
1. Extended `.spur/rules/typescript/output-boundaries.yaml` to include `plugins/**/src/**/*.ts` and `plugins/kk/scripts/**/*.ts` while excluding `tests/**`, `fixtures/**`, `node_modules/**`, and `dist/**`.
2. Proved RED baseline on `recommended-pre-check`: detected exactly 15 violations ([plugins/ingestions/karakeep-local/src/index.ts:40](file:///Users/robin/xprojects/knowledge-kit/plugins/ingestions/karakeep-local/src/index.ts#L40) (7 sites), [plugins/ingestions/web-search/src/index.ts:197](file:///Users/robin/xprojects/knowledge-kit/plugins/ingestions/web-search/src/index.ts#L197) (6 sites), [plugins/kk/scripts/render-md.ts:128](file:///Users/robin/xprojects/knowledge-kit/plugins/kk/scripts/render-md.ts#L128) (2 sites)).
3. Created `plugins/ingestions/karakeep-local/package.json` and `tsconfig.json` with `@gobing-ai/ts-utils` and `@gobing-ai/ts-infra` catalog dependencies.
4. Added `@gobing-ai/ts-utils: catalog:` to root `package.json` devDependencies for `plugins/kk/scripts/render-md.ts`.
5. Migrated `plugins/kk/scripts/render-md.ts` call sites to `echoError` from `@gobing-ai/ts-utils`.
6. Migrated `plugins/ingestions/karakeep-local/src/index.ts` to `echoError` (fatal/usage) and `getLogger('kk.ingestion.karakeep-local').warn` (recoverable corruption warnings), with `initializeLogger` in `import.meta.main`.
7. Migrated `plugins/ingestions/web-search/src/index.ts` to `echoError` (fatal/usage) and `getLogger('kk.ingestion.web-search').warn` (scrape warnings), with `initializeLogger` in `import.meta.main`.
8. Updated test suites in `plugins/ingestions/karakeep-local/tests/karakeep-local.test.ts` and `plugins/ingestions/web-search/tests/web-search.test.ts` to use `captureEchoErrors` and `captureLogWarns`.
9. Verified GREEN: `spur rule run --preset recommended-pre-check` passed with 0 violations across 38 active rules.
- `spur rule run --preset recommended-pre-check --fail-on warning --verbose` passed (38/38 rules passed).
- `bun run autofix && bun run spur-check:full` passed:
  - Lint and typecheck clean across all workspaces.
  - 388 tests passed across 31 test files (0 failures).
  - Code coverage: Aggregate line coverage 99.17%, function coverage 99.22% (exceeds >= 90% threshold).
  - Pre-check and post-check rules all clean.
| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 | Output boundary enforcement | Resolved: extended output-boundaries rule and proved 15 RED detections before migrating to GREEN |
| P2 | Logger initialization lifecycle | Resolved: initializeLogger called exactly once per process in import.meta.main, avoiding module-scope leaks |
| P3 | Terminal error routing | Resolved: user-facing fatal/usage errors routed to stderr via ts-utils echoError preserving exit codes and text |
| P4 | Test isolation and capture | Resolved: test suites use ts-utils buffer capture and ts-infra fileSink without global console monkey-patching |
- Feature: A3 (`docs/features/A3_ts-libs-logging-foundation.md`)
- Authority: ADR-014/ADR-015; design `docs/design/ts-libs-logging-foundation.md` §§3–6
- Rule: `.spur/rules/typescript/output-boundaries.yaml`; preset `recommended-pre-check` (`bun run test-pre-check`)
- Depends on: 0065 (catalog + seams; kk-core render-md on `echoError`)
- Source contracts (read 2026-08-16): ts-libs `packages/infra/src/logger.ts` (`InitLoggerOptions.fileSink`), `packages/utils/src/output.ts` @ 0.4.35
- Handoff: 0067 (utils removal across remaining plugin consumers)
- 2026-08-17T21:13:56.523Z todo → wip (system)
- 2026-08-17T21:13:56.833Z wip → testing (system)
- 2026-08-17T21:13:59.537Z testing → done (system)
### Solution
1. Extended `.spur/rules/typescript/output-boundaries.yaml` to include `plugins/**/src/**/*.ts` and `plugins/kk/scripts/**/*.ts` while excluding `tests/**`, `fixtures/**`, `node_modules/**`, and `dist/**`.
2. Proved RED baseline on `recommended-pre-check`: detected exactly 15 violations ([plugins/ingestions/karakeep-local/src/index.ts:40](file:///Users/robin/xprojects/knowledge-kit/plugins/ingestions/karakeep-local/src/index.ts#L40) (7 sites), [plugins/ingestions/web-search/src/index.ts:197](file:///Users/robin/xprojects/knowledge-kit/plugins/ingestions/web-search/src/index.ts#L197) (6 sites), [plugins/kk/scripts/render-md.ts:128](file:///Users/robin/xprojects/knowledge-kit/plugins/kk/scripts/render-md.ts#L128) (2 sites)).
3. Created `plugins/ingestions/karakeep-local/package.json` and `tsconfig.json` with `@gobing-ai/ts-utils` and `@gobing-ai/ts-infra` catalog dependencies.
4. Added `@gobing-ai/ts-utils: catalog:` to root `package.json` devDependencies for `plugins/kk/scripts/render-md.ts`.
5. Migrated `plugins/kk/scripts/render-md.ts` call sites to `echoError` from `@gobing-ai/ts-utils`.
6. Migrated `plugins/ingestions/karakeep-local/src/index.ts` to `echoError` (fatal/usage) and `getLogger('kk.ingestion.karakeep-local').warn` (recoverable corruption warnings), with `initializeLogger` in `import.meta.main`.
7. Migrated `plugins/ingestions/web-search/src/index.ts` to `echoError` (fatal/usage) and `getLogger('kk.ingestion.web-search').warn` (scrape warnings), with `initializeLogger` in `import.meta.main`.
8. Updated test suites in `plugins/ingestions/karakeep-local/tests/karakeep-local.test.ts` and `plugins/ingestions/web-search/tests/web-search.test.ts` to use `captureEchoErrors` and `captureLogWarns`.
9. Verified GREEN: `spur rule run --preset recommended-pre-check` passed with 0 violations across 38 active rules.
### Testing
- `spur rule run --preset recommended-pre-check --fail-on warning --verbose` passed (38/38 rules passed).
- `bun run autofix && bun run spur-check:full` passed:
  - Lint and typecheck clean across all workspaces.
  - 388 tests passed across 31 test files (0 failures).
  - Code coverage: Aggregate line coverage 99.17%, function coverage 99.22% (exceeds >= 90% threshold).
  - Pre-check and post-check rules all clean.
### Review
| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 | Output boundary enforcement | Resolved: extended output-boundaries rule and proved 15 RED detections before migrating to GREEN |
| P2 | Logger initialization lifecycle | Resolved: initializeLogger called exactly once per process in import.meta.main, avoiding module-scope leaks |
| P3 | Terminal error routing | Resolved: user-facing fatal/usage errors routed to stderr via ts-utils echoError preserving exit codes and text |
| P4 | Test isolation and capture | Resolved: test suites use ts-utils buffer capture and ts-infra fileSink without global console monkey-patching |
### References
- Feature: A3 (`docs/features/A3_ts-libs-logging-foundation.md`)
- Authority: ADR-014/ADR-015; design `docs/design/ts-libs-logging-foundation.md` §§3–6
- Rule: `.spur/rules/typescript/output-boundaries.yaml`; preset `recommended-pre-check` (`bun run test-pre-check`)
- Depends on: 0065 (catalog + seams; kk-core render-md on `echoError`)
- Source contracts (read 2026-08-16): ts-libs `packages/infra/src/logger.ts` (`InitLoggerOptions.fileSink`), `packages/utils/src/output.ts` @ 0.4.35
- Handoff: 0067 (utils removal across remaining plugin consumers)
### History
- 2026-08-17T21:13:56.523Z todo → wip (system)
- 2026-08-17T21:13:56.833Z wip → testing (system)
- 2026-08-17T21:13:59.537Z testing → done (system)
