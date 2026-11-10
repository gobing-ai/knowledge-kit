---
schema_version: 1
id: "I1"
name: "kk wiki vault CLI"
status: active
priority: P2
tags: []
created_at: "2026-11-10T19:06:55.156Z"
updated_at: "2026-11-10T21:27:41.791Z"
---

# I1: kk wiki vault CLI

## Goal

Give `kk` a `wiki` noun family that turns raw source snapshots into a persistent, interlinked
Markdown vault, and a Quartz-compatible projection of that vault, so knowledge accumulates in one
plain-Markdown place that Obsidian, agents and a published site all read. `kk` owns the deterministic
mechanics; model-bearing authoring stays in a `plugins/kk` skill that writes through those verbs.

## Scope

- In: `@gobing-ai/kk-wiki` vault package — page model + frontmatter schema, `[[wikilink]]` graph,
  merge with link redirection, index/MAP compilation, lint rules, gc, Quartz-compatible publish
  projection, raw snapshot writer, and the `user_edited: true` append-only guard.
- In: the `kk wiki` noun with one module per verb (`ingest`, `summarize`, `synthesize`, `merge`,
  `compile`, `link`, `lint`, `gc`, `sync`, `publish`, `query`, `context`), each stateless,
  pipe-friendly, `--json`-capable and configured from `kk.config.json` or environment.
- In: a `plugins/kk` wiki skill family for the model-bearing verbs (`summarize`, `synthesize`,
  `query`) that authors pages through the deterministic verbs and never edits around the guard.
- In: a design satellite `docs/design/kk-wiki.md` plus the consumer setup notes a vault repository
  needs (config keys, folder layout, Quartz target shape).
- Out: bootstrapping the `~/xprojects/treasury` repository (Quartz config, `content/`, R2/rclone
  `raw/` sync, cron loop, Cloudflare Pages) — a separate repository with its own run.
- Out: any embedding or vector-store retrieval, any Quartz source fork, and any hosted/wiki service.
- Out: production deploys, remote sync credentials or paid LLM generation runs during this feature.

## Acceptance Criteria

```gherkin
Feature: I1 — kk wiki vault CLI

  @home-node
  Scenario: R1 — Work on the kk wiki vault CLI has a home node
    # covers: none
    Given a change that targets the kk wiki vault CLI
    When the change is planned as a feature
    Then it is feature I1, a child of the LLM wiki umbrella feature I

  @core
  Scenario: R2 — Ingest a local file into a raw snapshot with frontmatter
    # covers: I1
    Given a Markdown source file at "fixtures/article.html" and `--type html`
    When the operator runs `kk wiki ingest fixtures/article.html --type=html --out raw`
    Then `raw/html/<id>.md` exists with YAML frontmatter carrying title, source type, source uri and ingested_at
    And the body preserves the source text without frontmatter duplicates

  @core
  Scenario: R3 — Ingest a URL or stdin source into the same raw shape
    # covers: I1
    Given a piped stdin body and `--type rss`
    When the operator runs `kk wiki ingest - --type=rss --out raw`
    Then a raw snapshot is written with the same frontmatter keys as a file ingest
    And the snapshot records the stdin source as its origin

  @edge
  Scenario: R4 — Ingest rejects an unsupported source type
    # covers: I1
    Given no `--type` and a source path whose extension is unknown
    When the operator runs `kk wiki ingest fixtures/blob.bin`
    Then the command exits nonzero naming the unsupported type
    And no raw snapshot is written

  @core
  Scenario: R5 — Summarize a raw asset into a summary section with extracted references
    # covers: I2
    Given one raw snapshot at "raw/html/a1.md" with model-authored summary text on stdin
    When the operator runs `kk wiki summarize raw/html/a1.md`
    Then the target page carries the summary section
    And every extracted entity or concept name that matches a vault page is recorded as a wikilink

  @core
  Scenario: R6 — Synthesize creates a page for a topic the vault does not have
    # covers: I3
    Given a vault whose `content/concepts/` holds no page for "vector index"
    When the operator runs `kk wiki synthesize "vector index"` with authored body text
    Then `content/concepts/vector-index.md` is created with schema-valid frontmatter
    And the page is linked from the compiled index on the next `kk wiki compile`

  @core
  Scenario: R7 — Synthesize extends an existing page in place
    # covers: I3
    Given `content/entities/karakeep.md` already exists with its own sections
    When the operator runs `kk wiki synthesize content/entities/karakeep.md` with new authored text
    Then the existing sections remain in place
    And the new material is added without discarding prior content

  @core
  Scenario: R8 — A user-edited page receives AI changes only in a dated append section
    # covers: I4
    Given a page whose frontmatter carries `user_edited: true`
    When any write verb targets that page with new material
    Then the page body above `## AI Updates` is byte-identical afterwards
    And the material appears under `## AI Updates (YYYY-MM-DD)` with the run date

  @edge
  Scenario: R9 — The user-edited guard applies to every write verb
    # covers: I4
    Given two pages with `user_edited: true` that overlap in subject
    When the operator runs `kk wiki merge`, `kk wiki synthesize` and `kk wiki link --fix` against them
    Then none of the three replaces the page body
    And each command reports the guard decision for the page

  @core
  Scenario: R10 — Merge combines overlapping pages and redirects incoming links
    # covers: I5
    Given `content/concepts/a.md` and `content/concepts/b.md` covering the same concept, with three pages linking to a
    When the operator runs `kk wiki merge content/concepts/a.md content/concepts/b.md`
    Then the surviving page holds the union of both bodies and frontmatter sources
    And every `[[a]]` reference now resolves through a redirect to the surviving page

  @core
  Scenario: R11 — Compile regenerates the index and map from the vault structure
    # covers: I6
    Given a vault with pages under `content/concepts/` and `content/entities/`
    When the operator runs `kk wiki compile`
    Then `content/index.md` lists every page with a wikilink and a one-line summary
    And `content/MAP.md` reflects the current folder and tag routing
    And a second consecutive compile produces the same bytes

  @core
  Scenario: R12 — Link reports unlinked entity mentions without editing
    # covers: I7
    Given a page that mentions "Karakeep" in prose while `content/entities/karakeep.md` exists
    When the operator runs `kk wiki link`
    Then the report names the page and the unlinked mention
    And the page file is unchanged on disk

  @core
  Scenario: R22 — Link fix injects the wikilinks it reported
    # covers: I7
    Given the same unlinked mention reported by `kk wiki link`
    When the operator runs `kk wiki link --fix`
    Then the mention becomes `[[karakeep|Karakeep]]`
    And the report lists the changed files

  @core
  Scenario: R13 — Lint reports broken links, orphan pages and missing frontmatter
    # covers: I7
    Given a vault containing a `[[missing-page]]` link, a page with no inbound link and a page without frontmatter
    When the operator runs `kk wiki lint`
    Then the report lists one finding per defect class with its file path
    And the command exits nonzero because findings exist

  @edge
  Scenario: R23 — Lint exits zero once no finding remains
    # covers: I7
    Given a vault whose last lint run reported zero findings
    When the operator runs `kk wiki lint --json`
    Then the findings list is empty
    And the command exits zero

  @edge
  Scenario: R14 — Gc removes unused raw caches and keeps referenced raw files
    # covers: I8
    Given `raw/html/a1.md` is referenced by a page and `raw/tmp/stale.json` is referenced by nothing
    When the operator runs `kk wiki gc`
    Then `raw/tmp/stale.json` is deleted and `raw/html/a1.md` is kept
    And the report lists what was removed and what was kept

  @core
  Scenario: R15 — Publish writes a Quartz-compatible tree
    # covers: I9
    Given a vault with `content/index.md`, `content/concepts/` and `content/entities/`
    When the operator runs `kk wiki publish --target out/wiki`
    Then `out/wiki/content/index.md` and the concept and entity pages exist at their vault-relative paths
    And every internal wikilink resolves inside the published tree
    And Quartz is neither forked nor modified

  @core
  Scenario: R16 — Sync runs the configured remote adapter
    # covers: I9
    Given `kk.config.json` declares remote "r2" as an rclone-style command
    When the operator runs `kk wiki sync r2 --dry-run`
    Then the command prints the resolved remote and the files it would transfer, and transfers nothing

  @edge
  Scenario: R24 — Sync rejects an undeclared remote name
    # covers: I9
    Given `kk.config.json` declares remote "r2" only
    When the operator runs `kk wiki sync dropbox`
    Then the command exits nonzero naming the unknown remote
    And nothing is transferred

  @core
  Scenario: R17 — Query returns ranked pages with their paths
    # covers: I10
    Given a vault where three pages discuss retrieval and one discusses publishing
    When the operator runs `kk wiki query "how does retrieval work" --json`
    Then the JSON lists the three retrieval pages ranked ahead of the publishing page
    And each row carries the vault-relative page path

  @core
  Scenario: R18 — Context packs the topic page with its graph neighbours
    # covers: I10
    Given `content/concepts/retrieval.md` links to two pages and is linked from one
    When the operator runs `kk wiki context "retrieval"`
    Then the output is one Markdown block holding the topic page and its linked neighbours
    And each included page is introduced by its vault-relative path

  @core
  Scenario: R19 — Every wiki verb supports JSON output and a stable exit code
    # covers: I11
    Given any implemented wiki verb
    When it is invoked with `--json`
    Then stdout is a single JSON document with an `ok` field
    And the exit code is zero on success and nonzero on failure

  @core
  Scenario: R20 — Configuration resolves from kk.config.json and the environment
    # covers: I11
    Given a `kk.config.json` with a wiki vault root and one overridden by an environment variable
    When any wiki verb runs without an explicit path flag
    Then the vault root resolves from the environment override first and the config file second
    And provider credentials resolve from the environment without ever being written to the vault

  @edge
  Scenario: R21 — Model-bearing verbs stay deterministic in the CLI
    # covers: I11
    Given the same stdin text and the same vault state
    When `kk wiki summarize` and `kk wiki synthesize` run twice
    Then both runs produce byte-identical pages
    And no network or provider call is made by the CLI process
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0351 | Vault page model, wikilink graph, link and lint | todo |
| 0354 | Publish, sync and retrieval surfaces | todo |
| 0352 | Guarded page writes: summarize, synthesize and the user-edited guard | todo |
| 0353 | Merge, compile and gc maintenance verbs | todo |
| 0350 | kk wiki noun foundation, config and raw ingest | wip |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-10T21:27:41.791Z backlog → active (system)

