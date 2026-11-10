---
schema_version: 1
name: Merge, compile and gc maintenance verbs
status: todo
template: feature-impl
created_at: 2026-11-10T19:11:03.857Z
updated_at: "2026-11-10T20:24:54.625Z"
feature_id: I1
priority: P2
tags:
  - wiki
  - maintenance
estimate_hours: 6

dependencies: ["0351"]
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

- [ ] R1. `kk wiki merge <source> <target>` writes the union of both bodies and frontmatter `sources` into the target page through `applyWrite`.
- [ ] R2. `merge` leaves a `redirect_to: <slug>` stub for the absorbed path and rewrites every inbound link to the surviving page.
- [ ] R3. `merge` on a guarded source page refuses, reports `refused`, and leaves both bodies unchanged.
- [ ] R4. `kk wiki compile` regenerates `content/index.md` and `content/MAP.md` from the current pages, and a second consecutive run is byte-identical.
- [ ] R5. `kk wiki gc` deletes unreferenced snapshots under `raw/<type>/` and `raw/tmp/` only, keeps every referenced raw file, never touches a directory listed in `wiki.mirrors`, and reports both lists.
- [ ] R6. `kk wiki gc` without `--yes` prints the plan and deletes nothing.
- [ ] R7. Every new file in `packages/kk-wiki/src` clears the per-file coverage threshold with its own tests.

### Acceptance Criteria

- [ ] AC1 — Merge combines overlapping pages and redirects incoming links
- [ ] AC2 — Compile regenerates the index and map from the vault structure
- [ ] AC3 — Gc removes unused raw caches and keeps referenced raw files

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/I1_kk-wiki-vault-cli.md` — AC R10, R11, R14.
- Decision: `docs/00_ADR.md:1679` ADR-046.
- Shapes: `docs/design/kk-wiki.md:33-54` (merge/compile/gc rows), `docs/design/kk-wiki.md:56-82` (vault layout).

### History
