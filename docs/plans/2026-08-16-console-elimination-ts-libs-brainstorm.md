---
name: console-elimination-ts-libs-brainstorm
date: 2026-08-16
needs_design: true
---

# Brainstorm — Eliminate `console.*` via ts-libs foundation consolidation

## Overview

knowledge-kit's output-boundaries spur rule (`no-console-output`, severity error) only scans
`apps/**` and `packages/**` — and those trees are clean. The 17 real production `console.*`
call sites live where the rule's include globs don't reach: `plugins/ingestions/karakeep-local/src`
(8), `plugins/ingestions/web-search/src` (7), and `plugins/kk/scripts/render-md.ts` (2). The gate
exists but is blind to the violations, and the project's own output seam (`@gobing-ai/utils`
logger) is an 18-line Bun.write wrapper with no levels — a forked mini-version of what ts-libs
already ships (`ts-utils` echo/echoError output seam, `ts-infra` LogTape-backed structured
logger). The model project `spur-new` demonstrates the target pattern end-to-end. Verified today:
all four `@gobing-ai/ts-*` packages are published on npm at 0.4.35.

## Current state (evidence)

| Fact | Evidence |
|---|---|
| Clean apps/packages | `apps/cli/src/main.ts:32-33` routes commander output through `@gobing-ai/utils` logger |
| 17 violating sites | `karakeep-local/src/index.ts:40,72,115,118,143,152,163`; `web-search/src/index.ts:197,298,363,371,398,412`; `plugins/kk/scripts/render-md.ts:128,136` |
| Rule scope gap | `.spur/rules/typescript/output-boundaries.yaml` includes only `apps/**/src/**` and `packages/**/src/**` |
| Rule IS wired | `recommended-pre-check.yaml` extends the `typescript` category — the rule runs, it just doesn't see `plugins/**` |
| Local logger is minimal | `packages/utils/src/logger.ts` — info/error/out via `Bun.write`, no warn/debug/levels |
| Model wiring | `spur-new/apps/cli/src/output.ts` = `echo`/`echoError` from `@gobing-ai/ts-utils`; deps pinned via Bun workspace `catalog:`; startup via ts-infra `initializeLogger` with `NODE_ENV=test → logging disabled` |
| Plugin invocation | `apps/cli/src/invoke.ts:44` — sole sanctioned `Bun.spawnSync` seam; plugins are subprocesses writing results to files (stdout purity preserved if logging goes to stderr) |
| karakeep-local has no package.json | Only `plugin.json` — needs one to declare deps |
| web-search precedent | `plugins/ingestions/web-search/package.json` already depends on `@gobing-ai/kk-core` `workspace:*` — plugin-depends-on-workspace-package is established |

## Approaches

### Approach 1: ts-libs foundation swap ⭐ Recommended

**Description:** Mirror spur-new. Pin all four `@gobing-ai/ts-*` in a root Bun workspace
`catalog:`; create `apps/cli/src/output.ts` delegating to `ts-utils` `echo`/`echoError`;
bootstrap `ts-infra` `initializeLogger` at CLI startup (console sink to stderr,
`NODE_ENV=test` → disabled); give each plugin (`karakeep-local` gains a `package.json`) a
`getLogger('<plugin>')` for diagnostics-to-stderr; dissolve or delegate `@gobing-ai/utils`
(logger → seam, `add()` deleted, zod re-export relocated). Extend `output-boundaries.yaml`
include to `plugins/**/src/**/*.ts` + `plugins/kk/scripts/**/*.ts` and re-point its
sanctioned-sink wording to the ts seam. **Reshape:** depend where consumed — `ts-utils`,
`ts-infra` now; `ts-runtime` only if/where it replaces the `invoke.ts` spawn seam or
`fanin`/`fanout` fs code; **defer `ts-db`** (knowledge-kit has no persistence layer; a
catalog pin without a dependency keeps the version contract without dead weight).

**Trade-offs:**
- **Pros:**
  - One logging/output stack across the portfolio (spur, ts-libs, etd already on it) — shared bug fixes, shared test-muting pattern (`setLoggerMuted` replaces the `console.error` monkey-patching in `web-search.test.ts`)
  - Gate becomes real: 17 violations → 0 with rule scope matching reality
  - Deletes bespoke code (`packages/utils` logger, eventually the package)
  - Structured levels (warn/debug/fatal) the local logger lacks
- **Cons:**
  - Cross-repo coupling: knowledge-kit tracks ts-libs 0.x semver (0.x = breaking bumps possible; catalog centralizes the pin, upgrades become one-line)
  - `initializeLogger` is async — every plugin entry gains a bootstrap step (short-lived CLIs; console-sink only, cheap)
  - Blast radius: 6+ workspaces touched; `@gobing-ai/utils` dissolution must migrate apps/cli + 5 plugin packages + tests
  - LogTape dependency tree added to plugin subprocesses (already npm-published, bundleable)

**Implementation Notes:**
- Catalog: `workspaces.catalog` in root `package.json` (`@gobing-ai/ts-utils|ts-infra|ts-runtime|ts-db: ^0.4.35`), consumers use `catalog:`.
- Plugin stdout purity: results already go to `--out` files; all logging sinks to stderr — the executor captures streams, no JSON contract change.
- Sequence: (1) extend rule scope, confirm preset goes RED on current tree (gate TDD); (2) add catalog + output seam + logger bootstrap; (3) migrate the 17 sites; (4) dissolve/delegate utils; (5) preset GREEN.

**Confidence:** HIGH (codebase facts read directly; ts-libs 0.4.35 API verified from source today; npm publication verified today) / MEDIUM (ts-libs 0.x API stability across future bumps)

**Sources:**
- `/Users/robin/xprojects/ts-libs/packages/infra/src/logger.ts` — `getLogger`/`initializeLogger`/`setLoggerMuted` (LogTape-backed). Verified 2026-08-16.
- `/Users/robin/xprojects/ts-libs/packages/utils/src/output.ts` — `echo`/`echoError`/`exitProcess`/`createBufferTarget`. Verified 2026-08-16.
- `/Users/robin/xprojects/spur-new/package.json`, `apps/cli/src/output.ts`, `apps/cli/src/index.ts` — catalog wiring, seam, `logging.console:false` / test-disable pattern. Verified 2026-08-16.
- `npm view @gobing-ai/ts-{utils,infra,runtime,db}` → 0.4.35 each. Verified 2026-08-16.

### Approach 2: Extend the local logger, no new deps

**Description:** Add `warn`/`debug` + stderr routing to `packages/utils/src/logger.ts`, route the
17 plugin sites through it, extend the rule scope. Zero dependency changes.

**Trade-offs:**
- **Pros:** Smallest diff; no cross-repo coupling; no async bootstrap.
- **Cons:** Perpetuates a third logging implementation beside ts-libs and spur's stack; no structured logging, no LogTape sinks/formatters; portfolio drifts instead of consolidating — contradicts the idea's stated goal.

**Confidence:** HIGH (feasibility), LOW (as a strategy — forks what already exists)

**Sources:** local `packages/utils/src/logger.ts`; ts-libs logger (above).

### Approach 3: ts-utils output seam only (no LogTape)

**Description:** Adopt `echo`/`echoError` + `createBufferTarget` from ts-utils as the universal
seam for all 17 sites and the CLI; skip ts-infra/LogTape entirely.

**Trade-offs:**
- **Pros:** Sync API (no async bootstrap in plugin entries); portable (`WriteTarget` abstraction); still deletes the bespoke logger.
- **Cons:** No levels/structure — `web-search` genuinely wants warn-vs-error distinction (`console.warn` for per-hit skips, `console.error` for aggregate failure, visible in its tests); operator's model (spur-new) standardizes on the ts-infra logger, so this lands halfway.

**Confidence:** MEDIUM

**Sources:** ts-utils `output.ts`; spur-new model wiring (above).

## Recommendation

**Approach 1, reshaped on ts-db.** Import-and-consume `ts-utils` + `ts-infra` now (they have
direct consumers in this refactor), add `ts-runtime` only where it demonstrably replaces
ad-hoc spawn/fs code (`invoke.ts` seam — optional, stage last), and keep `ts-db` as a catalog
pin only until a persistence requirement exists. Importing ts-db as a real dependency today
creates a dead edge that the repo's own surgical-change rule and the spur hygiene gates would
flag. Everything else proceeds exactly as the idea states.

## Next Steps

1. `/sp:dev-idea` continue → feature-create consumes this artifact + `.spur/run/idea-eval-report.md`.
2. Feature decomposition order: rule-scope-first (gate RED) → catalog+seam → 17-site migration → utils dissolution → optional `invoke.ts` runtime adoption.
3. Each task ends with `spur rule run --preset recommended-pre-check` GREEN (it is wired via the `typescript` category today).

## Design Summary

**Target state.** Root `package.json` gains a Bun workspace `catalog:` pinning
`@gobing-ai/ts-{utils,infra,runtime,db}` at `^0.4.35`. A new `apps/cli/src/output.ts` seam
delegates to ts-utils `echo`/`echoError`; `main.ts`'s `configureOutput` writers point at it
(replacing `@gobing-ai/utils` logger), and CLI startup calls ts-infra `initializeLogger`
(console sink → stderr; `NODE_ENV=test` → `{ logging: { enabled: false } }`, mirroring
spur-new). Each plugin package (`karakeep-local` gains a `package.json` + `tsconfig.json`;
`web-search` extends its existing one; `plugins/kk/scripts/render-md.ts` follows the repo
scripts convention) depends on `@gobing-ai/ts-infra` via `catalog:` and logs through
`getLogger('<plugin-name>')` to stderr — plugin result JSON stays file-written via `--out`,
so the executor's stream capture and stdout purity are untouched. `@gobing-ai/utils` is
dissolved: `logger` consumers migrate to the seam/getLogger, `add()` (test artifact) is
deleted, the zod re-export moves to consumers or kk-core. `.spur/rules/typescript/output-boundaries.yaml`
extends `include` to `plugins/**/src/**/*.ts` and `plugins/kk/scripts/**/*.ts` and its
sanctioned-sink description changes from "`apps/cli/src/output.ts` → ts-utils echo/echoError
(via `@gobing-ai/utils` logger)" to the ts seam. **Deferred:** `ts-db` dependency (no consumer);
`ts-runtime` adoption at the `invoke.ts` spawn seam is optional last-stage, replacing the
allowlisted `Bun.spawnSync` only if `process-executor` maps cleanly onto `PluginEntrySpawnOptions`.

**Sequencing & verification.** Rule scope first (preset must report the 17 sites RED before any
code change — proves the gate sees them), then catalog + seam + bootstrap, then the 17-site
migration (per-plugin: karakeep-local, web-search, render-md), then utils dissolution with all
consumers migrated in the same change (clean cutover, no re-export shim), preset + `bun run
lint` + `bun run test` GREEN at every task boundary. Plugin tests move from `console.error`
monkey-patching to `setLoggerMuted(true)` / injected sinks where practical, keeping the
existing assertions on captured messages.

**Risks.** ts-libs 0.x breaking bumps (mitigated: catalog pin, upgrade is one line);
async `initializeLogger` in plugin entries (mitigated: fire-and-await once at main() start,
console-only sinks); utils dissolution blast radius (mitigated: single-change cutover with
typecheck as the completeness check).
