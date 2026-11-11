---
kind: plan
title: kk wiki — vault CLI and treasury Quartz vault discovery
tags: [brainstorm, wiki, kk-wiki, treasury]
needs_design: true
run_id: 8e125b84-b541-4ecc-b98e-10b488590b86
created_at: 2026-11-10
---

# kk wiki — discovery

## Overview

The operator ask is preserved verbatim at `.spur/run/8e125b84-b541-4ecc-b98e-10b488590b86-idea-input.md`: build an LLM
wiki on the existing stack (spur, kk, karakeep), driven by two prepared specs —
`~/Downloads/knowledge_kit_cli_spec.md` (extend `kk` with a `kk wiki` verb family) and
`~/Downloads/personal_wiki_vault_spec.md` (bootstrap `~/xprojects/treasury` as a Quartz 4 vault).

This review covers the current `kk` noun surface (`apps/cli/src/cli.ts`), the plugin kinds and
ingestion plugins already shipped (`plugins/ingestions/karakeep-local`), the vault-shaped reference
already vendored at `vendors/llm-wiki.md`, and the parked feature **I — LLM wiki**
(`docs/features/I_llm-wiki.md`, status `backlog`, AC is an explicit map-fog marker). It creates a
design and a task batch; it executes no publishing, no deploys, and no paid LLM generation.

## Findings

| Priority | Evidence | Finding and planned response |
| --- | --- | --- |
| High | `docs/features/I_llm-wiki.md:19-29` | Feature **I** is parked with a fog AC ("Do not implement against this feature"). The two specs are the go signal for the `kk` half only; keep **I** as the umbrella and land the work as its child, replacing nothing in **I**'s fog marker. |
| High | `apps/cli/src/cli.ts:28-42` | Eleven nouns are registered (`board`, `bot`, `daily`, `executor`, `itc`, `ledger`, `lock`, `plugin`, `schedule`, `stage`, `store`); no `wiki` noun exists, so `kk wiki …` is a new noun family with per-verb modules, not a flag on an existing noun. |
| High | `packages/kk-core/src/index.ts:1-40`, `packages/kk-store` | Core owns Doc/Content/Result contracts and plugin kinds only. Vault mechanics (page model, wikilink graph, frontmatter guard, index compilation) have no home today — they need their own package rather than growing `kk-core`. |
| High | `plugins/ingestions/karakeep-local/src/index.ts:1-40` | Karakeep content is already normalized into `Doc[]` from `content.md` + `meta.json` mirror folders. `kk wiki ingest` must not re-implement fetchers: raw → Doc reuses ingestion plugins, and `Doc` → raw Markdown snapshot is the new, small piece. |
| Medium | `docs/04_DESIGN.md:63-70` | The CLI is a flat commander tree with per-noun modules and `--json` on every noun. `kk wiki` must ship the same shape (module per verb, JSON output, exit-code seam) or it becomes a second CLI. |
| Medium | `vendors/llm-wiki.md:25-46` | The reference pattern puts **the LLM** in charge of synthesis; `kk`'s shipped contract puts model-bearing work in skills/`agent.run` and deterministic mechanics in `kk` (`AGENTS.md` "kk owns steps; spur workflow owns orchestration"). Synthesis therefore splits: `kk wiki` does graph/mechanics, a skill does authoring. |
| Medium | `~/Downloads/personal_wiki_vault_spec.md:22-40` | The vault spec describes a *second* repository (`~/xprojects/treasury`) with Quartz, R2/rclone and Cloudflare Pages. Nothing under `apps/`, `packages/` or `plugins/` references rclone or R2 today, so this is net-new and belongs outside this repo's task batch. |
| Low | `~/Downloads/knowledge_kit_cli_spec.md:36` | The spec's only hard safety rule is `user_edited: true` append-only protection. It is a page-write guard in the vault package, not a prompt instruction — enforceable and testable. |

## Approaches

### A1 — New `@gobing-ai/kk-wiki` package behind a `kk wiki` noun (deterministic core + skill-authored synthesis)

- Vault mechanics as a pure package: page model + frontmatter schema, wikilink parser/graph,
  merge-with-redirect, index/MAP compilation, lint rules, gc, quartz publish target, raw snapshot
  writer.
- LLM-bearing work (summarize/synthesize/query drafting) is a skill (`plugins/kk/skills/wiki-*`)
  that calls the deterministic verbs and writes pages through the same guard.
- Trade-offs: every verb is unit-testable without a model; the guard is enforced in code; the CLI
  stays stateless. Cost: one new package and one new skill family; `summarize`/`synthesize`/
  `query` are not one-shot CLI answers on their own.

### A2 — Everything as plugins (ingestion ingests, generator synthesizes, publish publishes to Quartz)

- `kk wiki` becomes thin dispatch over the existing three plugin kinds; no new package.
- Trade-offs: maximal reuse of the executor seam. Cost: the vault is not a plugin input/output —
  `link`, `lint`, `merge`, `compile`, `gc` are whole-vault operations, and forcing them into
  `PluginManifest.operations` (`packages/kk-core/src/index.ts`) stretches the kind contract into
  something it was not designed for.

### A3 — Harvest `vendors/gbrain`, wrap its cycle/synthesize commands

- Trade-offs: synthesis, extraction and link repair already exist there. Cost: `vendors/` is a
  research sandbox with its own store model (facts/atoms, its own DB), which conflicts with the
  vault-as-source-of-truth model the operator's specs require; it also drags a large dependency
  surface into `kk`.

## Recommendation

**A1**, narrowed: deterministic vault mechanics land in `packages/kk-wiki` behind the `kk wiki`
noun; raw ingestion reuses existing ingestion plugins; synthesis/summarize/query authoring is a
`plugins/kk` skill that reads and writes the vault through those verbs. The treasury vault bootstrap
is planned in that repository, not here.

Stakes: A1 adds a package and one skill family but keeps every mechanic testable and keeps the
`user_edited` guard enforceable; A3 is the fast path to a demo but forks the data model.

## Design Summary

**Boundary.** `packages/kk-wiki` (`@gobing-ai/kk-wiki`) is pure and model-free: it owns
`VaultPage` (path, frontmatter, body), the `[[wikilink]]` parser/graph, index compilation, lint
rules, merge + redirect rewriting, gc, quartz publish projection, and the raw snapshot writer. It
imports `@gobing-ai/kk-core` for `Doc`; it never imports the executor, browser, or store.
`apps/cli/src/commands/wiki.ts` registers the noun and one module per verb in
`apps/cli/src/wiki/`; every verb supports `--json`, reads stdin where the spec says so, and returns
the standard exit code.

**Frontmatter contract.** `title`, `type: concept|entity|source|index`, `tags[]`, `sources[]`
(raw ids/URIs), `updated_at`, `user_edited?: boolean`. Frontmatter is validated by a zod schema in
`kk-wiki`; lint reports violations, and every write path refuses to overwrite a page with
`user_edited: true` except in append mode under `## AI Updates (YYYY-MM-DD)`.

**Verb split.** Deterministic in `kk`: `ingest --type`, `merge`, `compile`, `link`, `lint`, `gc`,
`publish --target`, `sync`, `context`. Model-bearing, shipped as a skill that calls them:
`summarize`, `synthesize`, `query` — the skill decides page edits, the verbs enforce the guard and
the graph. `kk wiki` never calls an LLM (ADR-007: LLM-as-judge/authoring is a skill, not a kk noun).

**Raw layer.** `ingest` writes `raw/<source-type>/<id>.md` with YAML frontmatter and a stable id;
existing ingestion plugins supply `Doc[]` for karakeep/R2 mirrors, so the vault's `raw/` is a
projection of whatever `kk executor run` already produces, not a second fetcher.

**Publish.** `publish --target <dir>` renders `content/` into a Quartz-compatible tree
(`index.md`, `concepts/`, `entities/`, attachment rewrites) without forking Quartz; the treasury
repo owns `quartz.config.ts` and the Cloudflare Pages build.

**Treasury boundary.** `~/xprojects/treasury` is a separate git repository: Quartz 4 config, the
vault folders, `kk.config.json`, rclone R2 sync of `raw/`, and the cron loop. It is planned and
executed in its own run against the released `kk wiki` surface; this feature ships the surface plus
a documented consumer setup.

**Verification.** Package unit tests over fixtures (graph, lint, merge redirects, guard, publish
projection); CLI tests asserting `--json` shapes and exit codes; an end-to-end check that ingests a
fixture Doc set, synthesizes fixture pages, lints clean, and publishes a tree that a static build
accepts.

## Next Steps

1. Feature `I1` under **I** with AC covering the inventory below.
2. Task batch: package contract → graph/link/lint → ingest/raw → compile/merge/gc → publish → CLI
   noun wiring → skill → docs/design satellite (`docs/design/kk-wiki.md`) → consumer setup guide.
3. Deferred to its own run: the treasury repo bootstrap (Quartz, R2/rclone, cron, Pages).
