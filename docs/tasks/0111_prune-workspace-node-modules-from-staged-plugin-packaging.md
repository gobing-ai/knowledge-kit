---
schema_version: 1
name: Prune workspace node_modules from staged plugin packaging
status: done
template: issue
created_at: 2026-09-10T23:23:48.959Z
updated_at: "2026-09-11T03:20:19.842Z"
feature_id: L

ac_altitude: task-local
priority: P1
---

## 0111. Prune workspace node_modules from staged plugin packaging

### Background

Follow-up from the 0110 conflict audit (F-0001). Task 0110 bundled staged plugin entries so they
run without repository `node_modules`, but `scripts/bundle-plugins.ts` still copied each plugin's
`node_modules` (workspace symlinks into `packages/`). `apps/cli/package.json` `files` includes
`plugins/`, so `prepack` / `npm publish` can ship checkout-bound symlinks. Isolated AC1 smoke had
to copy only `plugin.json` + `dist/index.js` to prove closure.

Task-local AC: this is a packaging regression of 0110 I1, not a Feature L ship criterion.

### Requirements

- [x] R1 — Staging must prune `node_modules` (and `.git`) so the copied plugin tree contains no
  workspace symlinks into the checkout.
- [x] R2 — A regression check fails when `EXCLUDE` lets `node_modules` through, and prepack staging
  leaves no `node_modules` under product plugin collections.

### Acceptance Criteria

- [x] AC1 (R1): Given a plugin path containing `node_modules/@gobing-ai/kk-core`, when EXCLUDE is
  applied, then that path is pruned and `src/index.ts` / `plugin.json` still stage.
- [x] AC2 (R2): Given `bun run prepack` in `apps/cli`, when staging finishes, then no product plugin
  under `ingestions|generations|publishings` has a `node_modules` directory.

### Q&A

Task-local AC confirmed: packaging regression of 0110 I1, not a Feature L ship criterion.
`Bun.build` must use the source plugin entry after pruning staged `node_modules`.

### Design

Prune `node_modules` at copy time (`EXCLUDE`), then `Bun.build` from the **source** plugin entry so
workspace packages still resolve. The staged tree never contains checkout-bound symlinks; the
installed `dist/index.js` stays self-contained. Guard `import.meta.main` so tests can import
`EXCLUDE` without restaging.

### Plan

1. Extend `EXCLUDE` with `node_modules` and `.git`.
2. Guard the CLI main block with `import.meta.main`.
3. Add `scripts/bundle-plugins.test.ts` path cases; extend `apps/cli/tests/package.test.ts` prepack
   assertion.
4. Sync the 03 I1 mechanism row.

### Root Cause

`scripts/bundle-plugins.ts:36` `EXCLUDE` listed `.DS_Store`, `.spur`, `tests`, and `evals` only.
`cp`'s filter therefore copied each plugin's `node_modules`, including workspace symlinks such as
`apps/cli/plugins/generations/core-facts-gen/node_modules/@gobing-ai/kk-core` →
`packages/kk-core`. Bundling inlines the closure into `dist/index.js`, so the copied tree is
redundant and reintroduces 0110 I1 if anything resolves via `node_modules` first.

The module also ran `bundlePlugins()` on every import (no `import.meta.main` guard), so a unit
test could not import `EXCLUDE` without restaging.

### Solution

Staging prune plus source-entry bundling (0111 / conflict F-0001).

| Change (`file:line`) | Why |
| --- | --- |
| `scripts/bundle-plugins.ts:38` `EXCLUDE` adds `node_modules` and `.git` | Staged copy must not carry workspace symlinks |
| `scripts/bundle-plugins.ts:51-78` `bundleStagedEntry(pluginDir, sourceDir)` builds from the source plugin entry | Bun.build resolves `@gobing-ai/*` from the checkout; the staged tree has no `node_modules` |
| `scripts/bundle-plugins.ts:131-141` `import.meta.main` guard with optional `<plugin-target> <marketplace-target>` args | Importing `EXCLUDE` from tests must not restage; tests stage a scratch tree by spawning the script — bun test cannot run `Bun.build` in-process for the plugins' workspace symlinks (verified 0111: the identical build fails only when invoked from a test file inside the workspaces project) |
| `scripts/bundle-plugins.test.ts:10-28` | Path-level EXCLUDE regression |
| `scripts/bundle-plugins.test.ts:30-58` | Staging run (subprocess): `dist/index.js` written, manifest rewritten to `./dist/index.js`, no staged `node_modules` |
| `apps/cli/tests/package.test.ts:20-36` | prepack leaves no product-plugin `node_modules` |
| `docs/03_ARCHITECTURE.md:188` I1 row | Mechanism: prune `node_modules` at staging |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/bundle-plugins.ts:38` EXCLUDE prunes node_modules/.git; `scripts/bundle-plugins.test.ts:31` prune expect; fresh 10 pass/0 fail |
| R2 | MET | `scripts/bundle-plugins.test.ts:53-57` staging run no node_modules; `apps/cli/tests/package.test.ts:33,36-42` prepack exit 0, no product-plugin node_modules; fresh 2 pass/0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 (R1) | MET | test | `scripts/bundle-plugins.test.ts:31,37-38` node_modules pruned, source/manifests still stage |
| AC2 (R2) | MET | test | `apps/cli/tests/package.test.ts:33,36-42` prepack exit 0, no staged node_modules |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0111

**Scope:** working-tree diff — `scripts/bundle-plugins.ts` (modified), `scripts/bundle-plugins.test.ts` (new), `apps/cli/tests/package.test.ts` (modified), `docs/03_ARCHITECTURE.md:188` (I1 row). Unrelated dirty files (`docs/04_DESIGN.md`, `docs/design/podcast-pub.md`, `docs/design/publish-plugin-specification.md`, `.spur/context/learnings.md`, `.spur/reports/history/latest.json`) excluded per task scope.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | usability | `bundleStagedEntry`'s catch surfaces only `error.message` — the generic `"Bundle failed"` — and discards the per-error diagnostics in `AggregateError.errors` (probed this run: Bun 1.3.14 `Bun.build` throws `AggregateError` with `message: "Bundle failed"` and `errors: [ResolveMessage: Could not resolve: "…"]`). A failed stage now reports `bundling <name> failed: Bundle failed` without naming the failing import. Non-blocking. | `scripts/bundle-plugins.ts:75-78` |
| 2 | P4 (advisory) | security | Positive: pruning `node_modules` (workspace symlinks into `packages/`) and `.git` removes checkout-bound paths and VCS metadata from the published tarball. No secrets/injection surface introduced. | `scripts/bundle-plugins.ts:38` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `scripts/bundle-plugins.ts:38` — `EXCLUDE` adds `node_modules`/`.git`; `scripts/bundle-plugins.test.ts:31-33,46` prune staged `node_modules`/`.git`; `:107` + `apps/cli/tests/package.test.ts:33` leave no staged `node_modules` |
| R2 | MET | `scripts/bundle-plugins.test.ts:30-34` EXCLUDE path regression (fails if `node_modules` not pruned) + `apps/cli/tests/package.test.ts:20-34` prepack asserts no product-plugin `node_modules` |

##### Acceptance Criteria Verification

| AC | Status | Evidence |
|----|--------|----------|
| AC1 (R1) | MET | `scripts/bundle-plugins.test.ts:31` `node_modules/@gobing-ai/kk-core` pruned (EXCLUDE true); `:37-38` `src/index.ts` / `plugin.json` still stage (EXCLUDE false) |
| AC2 (R2) | MET | `apps/cli/tests/package.test.ts:20-34` prepack exit 0; no `node_modules` under `ingestions\|generations\|publishings` |

**Fresh evidence (this run):** `bun test scripts/bundle-plugins.test.ts` → 10 pass / 0 fail (43 expect calls, 100% funcs / 91.03% lines); `bun test apps/cli/tests/package.test.ts` → 2 pass / 0 fail (23 expect calls); `bun run typecheck` (apps/cli) → exit 0. Probe: Bun 1.3.14 `Bun.build` throws `AggregateError` (`message: "Bundle failed"`, `errors: [ResolveMessage: Could not resolve: "no-such-pkg-0111"…]`), confirming the try/catch rethrow is the correct failure path and the removed `result.success` branch was dead code. New failure test `scripts/bundle-plugins.test.ts:143-158` (`rejects.toThrow('bundling broken-gen failed')`) passes.

**Next:** accept the P3 or restore per-error diagnostics (format `AggregateError.errors`) in the throw. No blockers.

### References

- Conflict audit F-0001 (0110 close-out).
- Task 0110 I1 / ADR-012 amendment 2026-09-10.
- `scripts/bundle-plugins.ts`, `apps/cli/tests/package.test.ts`, `docs/03_ARCHITECTURE.md` Execution boundary integrity.

### History

- 2026-09-10T23:25:41.836Z todo → wip (system)
- 2026-09-11T01:21:53.424Z wip → testing (system)
- 2026-09-11T02:18:26.401Z testing → done (system)

