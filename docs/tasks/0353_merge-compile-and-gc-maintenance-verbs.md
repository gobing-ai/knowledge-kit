---
schema_version: 1
name: Merge, compile and gc maintenance verbs
status: done
template: feature-impl
created_at: 2026-11-10T19:11:03.857Z
updated_at: "2026-11-11T00:41:17.125Z"
feature_id: I1
priority: P2
tags:
  - wiki
  - maintenance
estimate_hours: 6

dependencies: ["0351"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0353-verdict.json
---

## 0353. Merge, compile and gc maintenance verbs

### Background

Three verbs keep the vault coherent as it grows: `merge` collapses duplicate pages and redirects the links that pointed at the absorbed one, `compile` regenerates the index and map from the structure, and `gc` deletes raw caches nothing references any more.

`compile` is also the idempotency contract for the whole vault - a compiled artifact that changes bytes on every run makes every later git diff meaningless, so the test is a second consecutive run.

Implements: R10 - Merge combines overlapping pages and redirects incoming links; R11 - Compile regenerates the index and map from the vault structure; R14 - Gc removes unused raw caches and keeps referenced raw files.

Rubric: E2 D1 L1 C0 R1 = 5 -> decompose (three cohesive maintenance verbs over the existing index).

Rejected: deleting the absorbed page in `merge` - a redirect stub keeps old Obsidian links and external URLs working; deletion is a separate operator decision.

**Refine corrections (2026-11-10)**
- `gc` deleted "unreferenced `raw/**`" with no exception -> the first real consumer, the treasury vault, keeps an rclone-managed mirror under `raw/karakeep/` (see `~/xprojects/treasury` feature A, task 0004) where deletion fights the next sync -> `gc` only reclaims `raw/<type>/` snapshots this tool wrote and `raw/tmp/`, and skips any directory listed in `wiki.mirrors`.
- `merge` was to "write the union of both bodies" -> 0351's `applyWrite` is the only body writer and 0352 owns guard semantics -> merge composes `applyWrite` and refuses a guarded source page instead of adding its own writer.
- Redirect storage was unnamed -> it is a frontmatter key on the absorbed page (`redirect_to: <slug>`), which the 0351 index already reads as a page field and `link --fix` can rewrite against.
- Coverage and dry-run defaults were unstated -> `bunfig.toml` enforces 90% lines/functions per file; `gc` defaults to a plan-only run.

### Requirements

- [x] R1. `kk wiki merge <source> <target>` writes the union of both bodies and frontmatter `sources` into the target page through `applyWrite`.
- [x] R2. `merge` leaves a `redirect_to: <slug>` stub for the absorbed path and rewrites every inbound link to the surviving page.
- [x] R3. `merge` on a guarded source page refuses, reports `refused`, and leaves both bodies unchanged.
- [x] R4. `kk wiki compile` regenerates `content/index.md` and `content/MAP.md` from the current pages, and a second consecutive run is byte-identical.
- [x] R5. `kk wiki gc` deletes unreferenced snapshots under `raw/<type>/` and `raw/tmp/` only, keeps every referenced raw file, never touches a directory listed in `wiki.mirrors`, and reports both lists.
- [x] R6. `kk wiki gc` without `--yes` prints the plan and deletes nothing.
- [x] R7. Every new file in `packages/kk-wiki/src` clears the per-file coverage threshold with its own tests.

### Acceptance Criteria

- [x] AC1 — Merge combines overlapping pages and redirects incoming links
- [x] AC2 — Compile regenerates the index and map from the vault structure
- [x] AC3 — Gc removes unused raw caches and keeps referenced raw files

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** `merge.ts` composes `graph.ts` (inbound links), `write.ts` (`applyWrite`) and the redirect stub; `compile.ts` renders `index.md` and `MAP.md` from a deterministic sort (type, then slug) and writes only when bytes differ; `gc.ts` computes the referenced-raw set from page frontmatter `sources` plus body mentions, subtracts `wiki.mirrors` directories, and deletes only with `--yes`.

**Frozen names.**
- `mergePages(index, from, to, opts) -> { written: string, redirects: number, guard: 'clean' | 'refused' }`.
- `compileIndex(pages) -> { index: string, map: string }`, plus `writeCompiled(contentDir, result) -> { written: boolean }`.
- `planGc(index, config) -> { delete: string[], keep: string[], skippedMirrors: string[] }`, `applyGc(plan, opts) -> { deleted: string[] }`.
- Verb modules `apps/cli/src/wiki/{merge,compile,gc}.ts`.
- Compiled file names are exactly `content/index.md` and `content/MAP.md`.
- Redirect key is exactly `redirect_to`; `gc` flag is `--yes`; `compile` flag set is empty (no `--force`).

**Invariants.**
- `compile` output is a pure function of the page set: same pages, same bytes, no dates and no counts that drift.
- `gc` never deletes a file it cannot prove unreferenced, skips `wiki.mirrors` wholesale, and deletes nothing without `--yes`.
- `merge` never touches the body of a guarded page and never deletes the absorbed page's file.
- No verb writes a body outside `applyWrite`.

**Anti-patterns (do not implement).**
- No incremental index compile; a full recompute is cheap at this scale and removes index-drift bugs.
- No `rm` on a path outside `raw/` and never a recursive delete of a directory the index did not scan.
- No automatic merge of duplicate slugs inside `compile`; duplicates are a lint finding the operator resolves with `merge`.

**Test observability.** Fixture vaults under `packages/kk-wiki/tests/fixtures/`: two overlapping pages with three inbound links, a guarded source page, a vault with no pages (empty compile), a `raw/karakeep/` directory listed in `wiki.mirrors`, and a referenced raw snapshot. Compile idempotency is asserted by comparing two consecutive renders byte for byte.

**Handoff to dependents.** 0354 reads the compiled index for `query`; the treasury loop relies on `lint` (0351) and `compile` staying side-effect free apart from `content/index.md` and `content/MAP.md`.

### Plan

1. Implement `compile.ts` with fixture pages and the byte-identical second-run test.
2. Implement `merge.ts` with redirect stubs, inbound-link rewriting and the guarded-source refusal through `applyWrite`.
3. Implement `gc.ts` with the referenced-set computation, the `wiki.mirrors` skip list, the plan-only default and `--yes`.
4. Wire the three CLI verbs and assert their `--json` shapes.
5. Transcribe the verbs into `docs/04_DESIGN.md` §1, including the `--yes` deletion gate and the mirror skip rule.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/wiki.ts:125` |
| `apps/cli/src/commands/wiki.ts:6` |
| `apps/cli/src/commands/wiki.ts:71` |
| `apps/cli/tests/main.test.ts:237` |
| `apps/cli/tests/main.test.ts:242` |
| `docs/04_DESIGN.md:6` |
| `docs/04_DESIGN.md:87` |
| `docs/design/kk-wiki.md:10` |
| `docs/design/kk-wiki.md:43` |
| `docs/design/kk-wiki.md:47` |
| `docs/design/kk-wiki.md:6` |
| `packages/kk-wiki/src/index.ts:1` |
| `packages/kk-wiki/src/index.ts:23` |
| `packages/kk-wiki/src/index.ts:3` |
| `apps/cli/src/wiki/maintenance.ts:1` |
| `apps/cli/tests/wiki/maintenance.test.ts:1` |
| `packages/kk-wiki/src/compile.ts:1` |
| `packages/kk-wiki/src/gc.ts:1` |
| `packages/kk-wiki/src/merge.ts:1` |
| `packages/kk-wiki/tests/compile.test.ts:1` |
| `packages/kk-wiki/tests/gc.test.ts:1` |
| `packages/kk-wiki/tests/merge.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-wiki/src/merge.ts:27`; `packages/kk-wiki/tests/merge.test.ts` |
| R2 | MET | `packages/kk-wiki/src/merge.ts:27`; `packages/kk-wiki/tests/merge.test.ts` (stub + rewrites) |
| R3 | MET | `packages/kk-wiki/tests/merge.test.ts` (guarded source refused); CLI case in `apps/cli/tests/wiki/maintenance.test.ts` |
| R4 | MET | `packages/kk-wiki/src/compile.ts:38`; `packages/kk-wiki/tests/compile.test.ts` (byte-identical renders) |
| R5 | MET | `packages/kk-wiki/src/gc.ts:21`; `packages/kk-wiki/tests/gc.test.ts` (keeps referenced, skips mirrors) |
| R6 | MET | `apps/cli/src/wiki/maintenance.ts:102`; `apps/cli/tests/wiki/maintenance.test.ts` (plan without `--yes`) |
| R7 | MET | per-file coverage on the gate run: `merge.ts`, `compile.ts`, `gc.ts` all 100 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Merge combines overlapping pages and redirects incoming links | MET | test | `packages/kk-wiki/tests/merge.test.ts`, `apps/cli/tests/wiki/maintenance.test.ts` |
| AC2 — Compile regenerates the index and map from the vault structure | MET | test | `packages/kk-wiki/tests/compile.test.ts`, `apps/cli/tests/wiki/maintenance.test.ts` |
| AC3 — Gc removes unused raw caches and keeps referenced raw files | MET | test | `packages/kk-wiki/tests/gc.test.ts`, `apps/cli/tests/wiki/maintenance.test.ts` (mirror skip) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope.** Task 0353 — `merge`, `compile` and `gc`: the three maintenance verbs and the mirror-safety
scope `gc` needs for a vault whose `raw/` holds an externally managed mirror.

**Traceability.** All seven requirements land in named files with tests: merge unions bodies and
sources, writes a `redirect_to` stub and rewrites inbound links (`packages/kk-wiki/src/merge.ts:27`);
compile renders `index.md`/`MAP.md` from a sorted page set (`packages/kk-wiki/src/compile.ts:38`);
gc plans deletions only inside `raw/<type>/` and `raw/tmp/`, skipping every `wiki.mirrors` tree
(`packages/kk-wiki/src/gc.ts:21`). The CLI verbs are thin renderers over those functions
(`apps/cli/src/wiki/maintenance.ts:49`).

**SECUA.** Security: `gc` deletes nothing without `--yes` and cannot reach a mirror path; merge
refuses a `user_edited` source instead of overwriting it. Errors: a missing page throws a named
error, a config defect exits 1. Contracts: the package exposes the three functions; the CLI imports
only the package entry. Usability: every verb prints a plan or an outcome and supports `--json`.

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `apps/cli/src/wiki/maintenance.ts` | The first cut computed inbound-link rewrites in memory but wrote only the target and the stub, so the rewritten pages never reached disk | FIXED |

Confidence: HIGH

Verdict: PASS

### References

- Feature: `docs/features/I1_kk-wiki-vault-cli.md` — AC R10, R11, R14.
- Decision: `docs/00_ADR.md:1679` ADR-046.
- Shapes: `docs/design/kk-wiki.md:33-54` (merge/compile/gc rows), `docs/design/kk-wiki.md:56-82` (vault layout).

### History

- 2026-11-11T00:05:30.632Z todo → wip (system)
- 2026-11-11T00:41:15.890Z wip → testing (system)
- 2026-11-11T00:41:17.119Z testing → done (system)

