---
schema_version: 1
name: Publish, sync and retrieval surfaces
status: todo
template: feature-impl
created_at: 2026-11-10T19:11:03.858Z
updated_at: "2026-11-10T20:24:54.801Z"
feature_id: I1
priority: P2
tags:
  - wiki
  - publish
  - retrieval
estimate_hours: 6

dependencies: ["0351"]
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

- [ ] R1. `kk wiki publish --target <dir>` writes `<dir>/content/**` mirroring the vault one-to-one with wikilinks intact and attachment paths vault-relative.
- [ ] R2. `publish` refuses a target inside the vault, writes only under `--target`, and never modifies the vault or Quartz source.
- [ ] R3. `kk wiki sync <remote> --dry-run` prints the resolved command and planned transfers from `WikiConfig.remotes` without transferring.
- [ ] R4. `kk wiki sync <unknown>` exits 2 naming the unknown remote and prints the declared remote names.
- [ ] R5. `kk wiki query <prompt> --json` ranks pages by the frozen deterministic scoring and returns vault-relative paths with excerpts.
- [ ] R6. `kk wiki context <topic>` emits one Markdown block holding the topic page and its graph neighbours, each introduced by its vault-relative path.
- [ ] R7. The treasury consumer notes (Quartz config, `content/`, rclone-synced `raw/`, loop stages, Pages build) are recorded in `docs/design/kk-wiki.md` without creating files in that repository.
- [ ] R8. Every new file in `packages/kk-wiki/src` clears the per-file coverage threshold with its own tests.

### Acceptance Criteria

- [ ] AC1 — Publish writes a Quartz-compatible tree
- [ ] AC2 — Sync runs the configured remote adapter
- [ ] AC3 — Sync rejects an undeclared remote name
- [ ] AC4 — Query returns ranked pages with their paths
- [ ] AC5 — Context packs the topic page with its graph neighbours

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/I1_kk-wiki-vault-cli.md` — AC R15, R16, R24, R17, R18.
- Decision: `docs/00_ADR.md:1679` ADR-046.
- Shapes: `docs/design/kk-wiki.md:111-124` (publish projection and the treasury consumer).
- Raw layer projection source: `plugins/ingestions/karakeep-local/plugin.json:6`.

### History
