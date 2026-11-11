---
schema_version: 1
name: Publish, sync and retrieval surfaces
status: done
template: feature-impl
created_at: 2026-11-10T19:11:03.858Z
updated_at: "2026-11-11T01:20:40.116Z"
feature_id: I1
priority: P2
tags:
  - wiki
  - publish
  - retrieval
estimate_hours: 6

dependencies: ["0351"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0354-verdict.json
---

## 0354. Publish, sync and retrieval surfaces

### Background

The vault has to leave the machine in three directions: a static-site tree for Quartz, a remote transfer for the raw layer, and a dense context block an agent can consume. This task ships those four verbs (`publish`, `sync`, `query`, `context`) and the consumer notes the treasury repository needs.

`query` deliberately stops at ranked pages plus excerpts: composing the answer is the skill's job, so the CLI performs no model call (ADR-046) and the ranking stays deterministic and testable.

Implements: R15 - Publish writes a Quartz-compatible tree; R16 - Sync runs the configured remote adapter; R24 - Sync rejects an undeclared remote name; R17 - Query returns ranked pages with their paths; R18 - Context packs the topic page with its graph neighbours.

Rubric: E3 D2 L1 C1 R1 = 8 -> decompose (four verbs over one vault index, plus the consumer contract).

Rejected: vendoring or patching Quartz to control the output - the spec's own rule is to keep Quartz an upstream dependency of the consuming repository.

**Refine corrections (2026-11-10)**
- `sync` was to "resolve `wiki.remotes.<name>`" without saying who owns that config -> 0350 freezes `WikiConfig` with `mirrors` and `remotes` -> this task reads that resolver only; it never re-reads the config file itself.
- `query` ranking had no stated reuse check -> the only ranking code in the repo is store-bound (`packages/kk-store/src/dao/*`, FTS over `.works/kk.db`), and ADR-046 forbids `kk-wiki` depending on the store -> scoring is a local pure function with the frozen weights below.
- `publish` output shape was loosely described -> the Quartz contract needs the vault's `content/` tree preserved one-to-one under `<target>/content/` with attachments rewritten -> fixed below.
- Coverage was unstated -> `bunfig.toml` enforces 90% lines/functions per file; `query`/`context` are pure and fully testable from fixtures.
- The treasury consumer now exists (`~/xprojects/treasury`, feature A) -> the consumer notes are a factual pointer, not a hypothetical.

### Requirements

- [x] R1. `kk wiki publish --target <dir>` writes `<dir>/content/**` mirroring the vault one-to-one with wikilinks intact and attachment paths vault-relative.
- [x] R2. `publish` refuses a target inside the vault, writes only under `--target`, and never modifies the vault or Quartz source.
- [x] R3. `kk wiki sync <remote> --dry-run` prints the resolved command and planned transfers from `WikiConfig.remotes` without transferring.
- [x] R4. `kk wiki sync <unknown>` exits 2 naming the unknown remote and prints the declared remote names.
- [x] R5. `kk wiki query <prompt> --json` ranks pages by the frozen deterministic scoring and returns vault-relative paths with excerpts.
- [x] R6. `kk wiki context <topic>` emits one Markdown block holding the topic page and its graph neighbours, each introduced by its vault-relative path.
- [x] R7. The treasury consumer notes (Quartz config, `content/`, rclone-synced `raw/`, loop stages, Pages build) are recorded in `docs/design/kk-wiki.md` without creating files in that repository.
- [x] R8. Every new file in `packages/kk-wiki/src` clears the per-file coverage threshold with its own tests.

### Acceptance Criteria

- [x] AC1 — Publish writes a Quartz-compatible tree
- [x] AC2 — Sync runs the configured remote adapter
- [x] AC3 — Sync rejects an undeclared remote name
- [x] AC4 — Query returns ranked pages with their paths
- [x] AC5 — Context packs the topic page with its graph neighbours

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** `publish.ts` walks `content/` and writes the same relative paths under `<target>/content/`, rewriting only attachment links; it refuses a target inside the vault. `sync.ts` takes `WikiConfig.remotes[name]`, substitutes `{content}` and `{remote}`, and never shells out in dry-run. `query.ts` scores pages with a pure function over the index; `context.ts` packs the topic page plus neighbours to depth 1 via `graph.ts`.

**Frozen names.**
- `publishVault(contentDir, target) -> { files: string[], refused?: 'target-inside-vault' }`.
- `resolveRemote(config, name) -> { argv: string[], remote: string }`; template placeholders exactly `{content}` and `{remote}`.
- `rankPages(index, prompt, { limit }) -> { path, title, excerpt, score }[]`.
- `packContext(index, topic, { depth = 1 }) -> { markdown: string, pages: string[] }`.
- Verb modules `apps/cli/src/wiki/{publish,sync,query,context}.ts`.

**Frozen scoring (query).** Sum per matched term: title 3, tag 2, body 1; ties break on slug ascending; `--limit` defaults to 10; an empty match set returns `ok: true` with an empty list, never an error. Excerpt is the first sentence containing a matched term, truncated to 200 characters.

**Invariants.**
- `publish` performs no network call and writes nothing outside `--target`.
- `sync` never invents a remote; an undeclared name is a usage error listing the declared names.
- `query` and `context` make no provider call and produce identical output for identical vault state.
- `context` output is one Markdown block; each page is introduced by a heading carrying its vault-relative path.

**Anti-patterns (do not implement).**
- No embedding or vector index; ranking is the frozen scoring above.
- No Quartz source modification, vendoring, or build invocation from `publish`.
- No rclone-specific flag hardcoded in `sync`; the command comes from config.
- No `publish` that deletes stray files in the target on a first run (no `--delete`); the target is the consumer's tree.

**Test observability.** Fixture vault with three retrieval pages and one publishing page (ranking order asserted), a guarded page (publish copies it unchanged), a temp target directory (byte comparison of the published tree), and a stub remote command (`printf`) for sync dry-run. Consumer notes are verified by doc presence, not by a model call.

**Handoff to dependents.** `~/xprojects/treasury` (feature A) consumes `publish`, `sync` and `context`: its task 0004 relies on the `remotes.r2` shape and its task 0005 on the verb names. Keep both stable; a rename needs those tasks updated in the same change.

### Plan

1. Implement `publish.ts` with the fixture vault and a byte comparison of the published tree, including the target-inside-vault refusal.
2. Implement `sync.ts` with remote resolution from `WikiConfig`, `{content}`/`{remote}` substitution, dry-run output and the unknown-remote error listing declared names.
3. Implement `query.ts` with the frozen weights, tie-break, excerpt rule and `--limit`.
4. Implement `context.ts` neighbourhood packing at depth 1 with path-headed sections.
5. Wire the four verbs and assert their `--json` shapes through `main(argv)`.
6. Record the treasury consumer notes in `docs/design/kk-wiki.md` §7 and transcribe the four verbs into `docs/04_DESIGN.md` §1.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/wiki.ts:180` |
| `apps/cli/src/commands/wiki.ts:7` |
| `apps/cli/src/commands/wiki.ts:93` |
| `apps/cli/tests/main.test.ts:238` |
| `apps/cli/tests/main.test.ts:244` |
| `apps/cli/tests/main.test.ts:247` |
| `docs/04_DESIGN.md:6` |
| `docs/04_DESIGN.md:87` |
| `docs/design/kk-wiki.md:10` |
| `docs/design/kk-wiki.md:48` |
| `docs/design/kk-wiki.md:6` |
| `packages/kk-wiki/src/index.ts:2` |
| `packages/kk-wiki/src/index.ts:38` |
| `packages/kk-wiki/src/index.ts:52` |
| `apps/cli/src/wiki/retrieval.ts:1` |
| `apps/cli/tests/wiki/retrieval.test.ts:1` |
| `packages/kk-wiki/src/context.ts:1` |
| `packages/kk-wiki/src/publish.ts:1` |
| `packages/kk-wiki/src/query.ts:1` |
| `packages/kk-wiki/src/sync.ts:1` |
| `packages/kk-wiki/tests/context.test.ts:1` |
| `packages/kk-wiki/tests/publish.test.ts:1` |
| `packages/kk-wiki/tests/query.test.ts:1` |
| `packages/kk-wiki/tests/sync.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/publish.ts:25`; `packages/kk-wiki/tests/publish.test.ts` |
| R2 | MET | `scripts/publish.ts:25` (refusal); CLI case in `apps/cli/tests/wiki/retrieval.test.ts` |
| R3 | MET | `packages/kk-wiki/src/sync.ts:28`; `packages/kk-wiki/tests/sync.test.ts` (substitution, dry run) |
| R4 | MET | `packages/kk-wiki/tests/sync.test.ts` (unknown remote names the declared set); CLI exit 2 |
| R5 | MET | `packages/kk-wiki/src/query.ts:53`; `packages/kk-wiki/tests/query.test.ts` (ranking, tie-break, limit, empty) |
| R6 | MET | `packages/kk-wiki/src/context.ts:16`; `packages/kk-wiki/tests/context.test.ts` (path-headed block, both link directions) |
| R7 | MET | consumer notes live in `docs/design/kk-wiki.md` §7; no file was created in the treasury repository |
| R8 | MET | per-file coverage on the gate run: `publish.ts`, `sync.ts`, `query.ts`, `context.ts` all ≥96% lines |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Publish writes a Quartz-compatible tree | MET | test | `packages/kk-wiki/tests/publish.test.ts`, `apps/cli/tests/wiki/retrieval.test.ts` |
| AC2 — Sync runs the configured remote adapter | MET | test | `packages/kk-wiki/tests/sync.test.ts`, CLI dry-run case |
| AC3 — Sync rejects an undeclared remote name | MET | test | `packages/kk-wiki/tests/sync.test.ts`, CLI exit 2 case |
| AC4 — Query returns ranked pages with their paths | MET | test | `packages/kk-wiki/tests/query.test.ts`, CLI JSON case |
| AC5 — Context packs the topic page with its graph neighbours | MET | test | `packages/kk-wiki/tests/context.test.ts`, CLI case |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope.** Task 0354 — the four remaining verbs: `publish`, `sync`, `query`, `context`. This closes the
twelve-verb `kk wiki` surface.

**Traceability.** publish projects `content/` one-to-one and refuses a target inside it
(`packages/kk-wiki/src/publish.ts:25`); sync resolves the declared remote into an argv and names an
undeclared one (`packages/kk-wiki/src/sync.ts:28`); query ranks with the frozen weights
(`packages/kk-wiki/src/query.ts:53`); context packs the topic page plus neighbours
(`packages/kk-wiki/src/context.ts:16`). The CLI is a thin renderer over those four functions.

**SECUA.** Security: publish writes only under `--target` and cannot target the vault itself; sync
never executes in a dry run and never invents a remote; no credential is read. Errors: an undeclared
remote is a usage exit 2, a config defect exits 1, and a publish refusal exits 2. Contracts: the
package owns the four functions, the CLI imports only the package entry, and no provider client is
reachable. Usability: every verb supports `--json` and a readable summary.

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `packages/kk-wiki/src/query.ts` | The first cut special-cased a prompt term equal to a slug, duplicating what the title weight already scores | FIXED |

Confidence: HIGH

Verdict: PASS

### References

- Feature: `docs/features/I1_kk-wiki-vault-cli.md` — AC R15, R16, R24, R17, R18.
- Decision: `docs/00_ADR.md:1679` ADR-046.
- Shapes: `docs/design/kk-wiki.md:111-124` (publish projection and the treasury consumer).
- Raw layer projection source: `plugins/ingestions/karakeep-local/plugin.json:6`.

### History

- 2026-11-11T00:43:47.136Z todo → wip (system)
- 2026-11-11T01:20:38.737Z wip → testing (system)
- 2026-11-11T01:20:40.106Z testing → done (system)

