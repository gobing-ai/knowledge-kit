---
name: kk wiki vault
doc: design/kk-wiki
owns: "SHAPES — kk wiki verb signatures, vault frontmatter schema, config keys, publish projection"
authority: derived
version: 0.4.0
created_at: 2026-11-10
updated_at: 2026-11-10
derived_from: [00_ADR, 01_PRD, 03_ARCHITECTURE]
status: partial — `ingest` (0350), `link`/`lint` (0351), `summarize`/`synthesize` (0352) shipped; the remaining verbs are accepted design (I1, ADR-046)
---

# kk wiki vault — design satellite

> Accepted design for feature **I1** (`docs/features/I1_kk-wiki-vault-cli.md`). Shapes here are the
> contract tasks implement against; once the verbs ship, `docs/04_DESIGN.md` §1 transcribes them
> from the code registrations and this satellite keeps only the vault-specific shapes.

## 1. Package boundary

| Item | Value |
| --- | --- |
| Package | `packages/kk-wiki` — `@gobing-ai/kk-wiki` |
| Responsibility | Deterministic vault mechanics only: page model, frontmatter schema, wikilink graph, link/lint, merge + redirect, index/MAP compile, gc, raw snapshot writer, Quartz publish projection, `user_edited` guard |
| May depend on | `@gobing-ai/kk-core` (the `Doc` contract), `zod`, `node:fs` / `node:path` |
| Must not depend on | the executor seam, browser automation, `@gobing-ai/kk-store`, any LLM/provider client |
| CLI home | `apps/cli/src/commands/wiki.ts` registers the noun; one module per verb under `apps/cli/src/wiki/` |

The deletion test: without this package the CLI would grow graph, frontmatter and projection code
inside `apps/cli`, which is where the invariants in `docs/03_ARCHITECTURE.md` §Module boundaries
forbid shared logic from living.

## 2. Verb surface

Every verb is stateless, reads `kk.config.json` + environment for defaults, accepts `--json`, and
exits `0` on success / `1` on a handled failure / `2` on a usage error.

| Verb | Signature | Deterministic behavior | Model-bearing? |
| --- | --- | --- | --- |
| `ingest` | `kk wiki ingest <source\|-> [--type=url\|pdf\|html\|rss] [--out <dir>] [--json]` | Writes `raw/<type>/<id>.md` with frontmatter; unknown extension without `--type` exits 2 naming the type; html/pdf/url go through the markitdown runner and exit 1 naming it when absent (**shipped, 0350**) | no |
| `summarize` | `kk wiki summarize <page> --from <-\|file> [--json]` | Renders the supplied summary text into the page's `## Summary` section and links every mentioned title (**shipped, 0352**) | text is authored by the `kk:wiki-authoring` skill and passed on stdin |
| `synthesize` | `kk wiki synthesize <topic\|page> --from <-\|file> [--type <pageType>] [--json]` | Creates a page when absent, extends in place when present; applies the `user_edited` guard (**shipped, 0352**) | text authored by the skill |
| `merge` | `kk wiki merge <source-page> <target-page> [--json]` | Unions bodies + frontmatter `sources`, writes a redirect for the source path, rewrites inbound links | no |
| `compile` | `kk wiki compile [--json]` | Regenerates `content/index.md` and `content/MAP.md`; idempotent byte-for-byte | no |
| `link` | `kk wiki link [--fix] [--json]` | Reports unlinked mentions of existing page titles; `--fix` rewrites them to `[[slug\|Surface]]`, and a `user_edited` page receives the change under `## AI Updates` (**shipped, 0351**) | no |
| `lint` | `kk wiki lint [--json]` | Reports broken links, orphan pages, missing/invalid frontmatter; nonzero when findings exist (**shipped, 0351**) | no |
| `gc` | `kk wiki gc [--json]` | Deletes unreferenced `raw/**` caches and `raw/tmp/**`; keeps referenced raw files | no |
| `sync` | `kk wiki sync <remote> [--dry-run] [--json]` | Runs the remote declared in config (`command`), prints the resolved command and planned transfers; `--dry-run` transfers nothing | no (transport lives in the remote's own CLI, e.g. rclone) |
| `publish` | `kk wiki publish --target <dir> [--json]` | Renders `content/` into `<dir>/content/` as a Quartz-compatible tree; never forks or patches Quartz | no |
| `query` | `kk wiki query <prompt> [--limit <n>] [--json]` | Ranks vault pages against the prompt by deterministic term scoring; prints page paths + excerpts; the answer is composed by the skill | no |
| `context` | `kk wiki context <topic> [--depth <n>] [--json]` | Emits one Markdown block: the topic page plus its graph neighbours, each introduced by its vault-relative path | no |

`summarize`, `synthesize` and `query` are the only verbs a model feeds; the CLI itself performs no
network or provider call (R21).

## 3. Vault layout and frontmatter

```text
<vault>/
├── kk.config.json          # wiki root, remotes, defaults
├── raw/<type>/<id>.md      # layer 1 — write-once snapshots, never edited by the model
└── content/                # layer 2 — the Obsidian vault root = Quartz content root
    ├── index.md
    ├── MAP.md
    ├── concepts/<slug>.md
    └── entities/<slug>.md
```

Page frontmatter (zod schema in `kk-wiki`; `lint` reports every violation with `path:line`):

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `title` | string | yes | Display title; the wikilink target resolves from it |
| `type` | `concept \| entity \| source \| index` | yes | Folder class and index grouping |
| `tags` | string[] | no | Free tags; `MAP.md` groups by them |
| `sources` | string[] | no | Raw ids or source URIs this page was built from |
| `updated_at` | RFC3339 string | yes | Last write by any verb |
| `user_edited` | boolean | no | `true` engages the append-only guard |

Slug = lowercased title with non-alphanumerics collapsed to `-`. A duplicate slug across
`concepts/` and `entities/` is a `lint` error.

## 4. The `user_edited` guard

1. Any write verb that targets a page with `user_edited: true` appends under
   `## AI Updates (<YYYY-MM-DD>)` and leaves every byte above that heading untouched.
2. The heading is created once per day; a second write on the same day appends to the existing
   section.
3. `merge` on a guarded source page refuses and reports the guard decision instead of rewriting it.
4. The guard is a package function every write path calls — never a prompt instruction.

## 5. Config keys (`kk.config.json`)

```json
{
  "wiki": {
    "root": ".",
    "raw": "raw",
    "content": "content",
    "defaultType": "html",
    "remotes": {
      "r2": { "command": "rclone sync {content} {remote}", "remote": "r2:treasury/raw" }
    }
  }
}
```

Precedence: explicit flag → `KK_WIKI_*` environment variable → config file → built-in default.
Credentials come from the environment only; no verb ever writes a credential into the vault.

## 6. Publish projection

`kk wiki publish --target <dir>` writes `<dir>/content/…` mirroring `content/…` one-to-one, with:
wikilinks left intact (Quartz resolves them), attachment paths rewritten to vault-relative, and
`index.md`/`MAP.md` treated as ordinary pages. Quartz itself stays an upstream dependency of the
consuming repository — this project neither vendors nor patches it.

## 7. Consumer: the treasury vault (deferred)

`~/xprojects/treasury` is a separate repository: `quartz.config.ts` / `quartz.layout.ts`,
`content/{concepts,entities}`, `raw/` synced from the R2 bucket that Karakeep mirrors, a cron loop
(`ingest → synthesize → link --fix → lint → git push`), and a Cloudflare Pages build
(`npx quartz build` → `public`). It is planned and executed in its own run against this surface;
this feature ships the surface plus the setup notes in §1–§6.
