---
template: feature-impl
schema_version: 1
name: "Complete the ts-libs cutover and remove @gobing-ai/utils"
description: ""
status: todo
type: task
profile: standard
feature_id: A3
parent_wbs: null
priority: P2
tags: ["ts-libs", "logging", "cleanup"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T05:41:23.927Z"
updated_at: "2026-08-17T06:37:31.532Z"
---

## 0067. Complete the ts-libs cutover and remove @gobing-ai/utils

### Background

Feature A3 ends the dual-stack period by migrating every remaining consumer and deleting the local utility workspace. Implements: the remaining generator and publisher subsystem slice of R2 — terminal output uses the shared ts-utils seam; the remaining generator and publisher subsystem slice of R3 — diagnostic processes initialize ts-infra once and use scoped loggers; R6 — @gobing-ai/utils dissolves without a compatibility layer.

Ordering: after “Establish the ts-libs catalog and CLI output foundation”. It may be implemented alongside the raw-console migration only with explicit lockfile coordination; otherwise run it last so deletion occurs after every consumer has a replacement seam.

Boundary: all remaining manifests, source imports, tests, and packages/utils deletion form one clean-cutover review and rollback boundary. Splitting package deletion from consumer migration would require a forbidden compatibility interval or a broken workspace graph.

Candidate rubric: E6 D1 L3 C1 R1 = 12 → retain as one independently reviewable clean-cutover task; rejected split: per-plugin cleanup would repeatedly edit the same manifest/test conventions and leave @gobing-ai/utils partially alive.

### Requirements
- [ ] R1. Inventory and migrate every remaining @gobing-ai/utils source import in generator and publisher workspaces to ts-utils for operator-facing output or ts-infra for structured diagnostics according to the accepted design ownership table.
- [ ] R2. Initialize ts-infra exactly once in each migrated diagnostic-emitting executable, use stable kk.<kind>.<plugin> categories at getLogger call sites, and install no custom logging sink.
- [ ] R3. Replace logger monkey-patching and muting in affected tests with injected CommandOutput, ts-utils buffer targets, or ts-infra setLoggerMuted as appropriate while preserving behavioral assertions.
- [ ] R4. Remove every @gobing-ai/utils manifest dependency after its source consumer migrates, then delete packages/utils including the unconsumed add, z, and ZodType exports.
- [ ] R5. Prove that no source or package manifest references @gobing-ai/utils and that no replacement compatibility package, re-export shim, or speculative abstraction was introduced.
- [ ] R6. Preserve all user-visible output, diagnostic severity, stderr/stdout routing, final newlines, and exit codes, and pass lint, tests, build, and the output-boundaries rule.
### Acceptance Criteria
```gherkin
Feature: Complete the ts-libs cutover and remove @gobing-ai/utils

  @core
  Scenario: R2 — A single terminal-output seam is backed by ts-utils echo and echoError
    Given the five remaining consumer plugins (content-gen, qiita-pub, zenn-pub, surfdash-pub, emdash-pub)
    When usage, invalid-argument, and failure paths run for each
    Then all 14 logger.error call sites delegate to ts-utils echoError with unchanged text, stderr routing, final newlines, and exit codes
    And tests capture stderr through ts-utils createBufferTarget/setDefaultOutputTargets with no spyOn(logger, ...) remaining
    And none of the five plugins declares a ts-infra dependency or calls initializeLogger, having no structured diagnostics to emit

  @core
  Scenario: R6 — The @gobing-ai/utils package dissolves without a compatibility layer
    Given zero remaining source consumers
    When the cutover lands
    Then every workspace manifest @gobing-ai/utils dependency is removed
    And packages/utils is deleted including the unconsumed add, z, and ZodType exports
    And rg '@gobing-ai/utils' apps packages plugins returns no source or manifest matches
    And no replacement package, re-export shim, or compatibility wrapper exists
    And bun install, bun run lint, bun run test, and bun run build all pass
```
### Q&A
- **R2 is vacuous by design.** All 14 remaining call sites are usage/fatal — none of the five
  plugins emits structured diagnostics, so per design-doc §1 ("ts-infra only when its executable
  emits structured diagnostics") no ts-infra edges are added. The R2 requirement is satisfied by
  there being zero diagnostic-emitting executables to initialize.
- **Uniform echoError mapping.** Every site is a single-string `logger.error(s)`; both the old
  logger and ts-utils `echoError` append exactly one newline to stderr — byte-identical, no
  adapter needed.
- **Test seam is buffer targets, not spies.** `spyOn(logger, 'error')` (12 sites) cannot carry
  over to a free function; ts-utils `setDefaultOutputTargets` + `createBufferTarget` is the
  supported capture seam, and assertion text carries over unchanged.
- **No dependency edges added to the corpus.** `spur task update` exposes no dependencies
  frontmatter verb; ordering (0065 → 0066 → 0067) stays documented in Background/Design prose
  and enforced by the 0067 pre-flight check instead.
- **Baseline count sanity:** feature-wide console-site totals are 15 (0066) + 0 here — this
  task's sites are `@gobing-ai/utils` logger calls, not raw console, and were never rule-flagged.
### Design
**WHAT.** Migrate the last five `@gobing-ai/utils` consumers — `content-gen` (2 sites),
`qiita-pub` (3), `zenn-pub` (2), `surfdash-pub` (2), `emdash-pub` (3): 14 `logger.error`
usage/fatal sites, all single-string — then delete `packages/utils`. One clean-cutover review
and rollback boundary; no compatibility interval.

**WHY.** Deletion in the same change as the last consumer migration is what makes the cutover
atomic — a separate deletion task would force a shim or a broken graph in between (ADR-015).

**WHERE / frozen names.**

- Site mapping (uniform): `logger.error(s)` → `echoError(s)`; import line
  `import { logger } from '@gobing-ai/utils'` → `import { echoError } from '@gobing-ai/ts-utils'`.
  All 14 sites are usage/fatal single-string calls (inventoried 2026-08-17): content-gen
  `src/index.ts:36,44`; qiita-pub `:242,247,255`; zenn-pub `:295,303`; surfdash-pub `:185,193`;
  emdash-pub `:430,435,443`. `logger.error` and `echoError` both append exactly one `\n` to
  stderr — byte-identical swaps.
- Manifests (five plugin `package.json`s): `dependencies` − `@gobing-ai/utils`,
  + `"@gobing-ai/ts-utils": "catalog:"`. No ts-infra edge anywhere in this task (R2 is vacuous:
  these executables emit no structured diagnostics — design-doc §1 grants ts-infra only to
  diagnostic emitters).
- Test seam (12 spy sites): `spyOn(logger, 'error').mockImplementation(...)` → install a stderr
  `createBufferTarget()` via `setDefaultOutputTargets({ stderr: buffer })`, assert on buffer
  content, restore with the returned restore function in `afterEach`. Files:
  `content-gen.test.ts` (4 spies), `qiita-pub.test.ts` (3), `zenn-pub.test.ts` (1),
  `surfdash-pub.test.ts` (1), `emdash-pub.test.ts` (3). Behavioral assertions move from
  "spy called" to "buffer contains the message" — assertion text stays the source of truth.
- Deletion: `packages/utils/` (src/index.ts `add`/`z`/`ZodType`/`logger` + logger.ts +
  package.json + tsconfig). No path references exist outside the directory (verified:
  tsconfig/bunfig/tooling clean).
- Post-conditions: `rg '@gobing-ai/utils' apps packages plugins` → empty (source + manifests);
  `bun install && bun run build && bun run lint && bun run test` green; output-boundaries rule
  stays GREEN.

**Anti-patterns (do not implement).**
- No compatibility package, re-export shim, or `@gobing-ai/utils` alias in the catalog.
- No ts-infra dependency or `initializeLogger` in any of the five plugins — nothing here emits
  structured diagnostics; adding one is speculative wiring (0065/0066 enforce the same rule).
- No logger.info migration — zero call sites exist; do not invent them.
- No edits to `kk-core/tests/render-md.test.ts` or `apps/cli/tests/*` — those belong to 0065
  and must already be done; a failure there means 0065 is incomplete, stop and surface.
- No lockfile hand-editing; regenerate via `bun install` only.

**Handoff.** Assumes 0065 (catalog; apps/cli, kk-core, publish-harness migrated) and 0066
(karakeep-local, web-search, render-md script migrated; rule GREEN) are complete — this is the
final cutover. Leaves nothing: feature A3 closes here.
### Plan
1. [ ] (pre-flight) Verify 0065/0066 landed: `rg '@gobing-ai/utils' apps/cli/src packages/kk-core/src plugins/ingestions plugins/kk/scripts` → empty; pre-check GREEN. If not, stop — this task is last.
2. [ ] (R1) Migrate the 14 sites + import lines across the five plugins per the uniform mapping; each plugin's fatal paths re-run once for stderr/exit-code parity.
3. [ ] (R3) Migrate the 12 `spyOn(logger, 'error')` test sites to `createBufferTarget`/`setDefaultOutputTargets` capture; assertions preserved.
4. [ ] (R4) Remove `@gobing-ai/utils` from the five plugin manifests; `bun install`; `bun run build` green.
5. [ ] (R4) Delete `packages/utils/`; `bun install`; confirm workspace graph resolves (no dangling workspace:* references).
6. [ ] (R5) Audit: `rg '@gobing-ai/utils' apps packages plugins` → empty; no shim exists.
7. [ ] (R6) Gates: `bun run lint && bun run test && bun run build` green; `spur rule run --preset recommended-pre-check` GREEN; parity spot-check one fatal path per plugin.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: A3 (`docs/features/A3_ts-libs-logging-foundation.md`)
- Authority: ADR-014/ADR-015; design `docs/design/ts-libs-logging-foundation.md` §§1, 4, 6
- Depends on: 0065 (catalog + CLI/kk-core migration), 0066 (plugin console migration + rule GREEN)
- Source contracts (read 2026-08-16): ts-libs `packages/utils/src/output.ts` (`echoError`, `setDefaultOutputTargets`, `createBufferTarget`) @ 0.4.35
### History
