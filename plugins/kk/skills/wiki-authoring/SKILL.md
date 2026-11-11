---
name: wiki-authoring
version: 0.1.0
requires: [cli:kk, local-fs]
description: This skill should be used when a personal Markdown vault needs authored page text — "summarize this source into the vault", "synthesize a concept page for X", "extend the page about Y", or when a kk wiki pipeline step needs agent-written prose. Supplies text to `kk wiki summarize|synthesize`; the CLI owns placement, the guard and the graph.
---

# wiki-authoring — author vault pages through the CLI

The vault at `content/` is plain Markdown that a human edits and Quartz publishes. This skill writes
prose; `kk wiki` does everything else. Never edit a page file directly.

## Contract

1. Read what exists first: `kk wiki context "<topic>"` (or `kk wiki query "<prompt>"`) to see the
   pages and neighbours already in the vault.
2. Compose the text: dense, factual, no navigation chatter. One page per concept or entity, and each
   paragraph should stand alone because a later `compile` copies it into the index.
3. Hand the text to the CLI on stdin — never write the file yourself:

   ```bash
   kk wiki synthesize "<Topic>" --from - --json <<'TEXT'
   <authored markdown>
   TEXT
   ```

   Use `--type entity` for a tool, project or framework page; the default is `concept`.
   Use `kk wiki summarize <page> --from -` to place a summary into an existing page.
4. Verify: `kk wiki lint` exits 0 and `kk wiki link` reports no unlinked mention of a title you
   just introduced.

## The guard (never work around it)

- A page whose frontmatter carries `user_edited: true` is **never** replaced. Your text lands under
  `## AI Updates (<YYYY-MM-DD>)`, and the CLI reports `guard: appended`.
- Never pass a "replace anyway" intent, never rewrite the file with an editor tool, and never strip
  `user_edited`.
- `index.md` and `MAP.md` are compiled — do not author them; run `kk wiki compile`.

## Frontmatter you may rely on

`title`, `type` (`concept|entity|source|index`), `tags[]`, `sources[]`, `updated_at`,
`user_edited?`, `redirect_to?`. Values are flat: scalars and string arrays only.

## Modes

| Mode | Command | Use |
| --- | --- | --- |
| `synthesize` (new) | `kk wiki synthesize "<Topic>" --from -` | A concept or entity the vault does not have |
| `synthesize` (extend) | `kk wiki synthesize <page-path> --from -` | New material for an existing page |
| `summarize` | `kk wiki summarize <page-path> --from -` | A raw asset's summary placed into its page |

See [references/page-shapes.md](references/page-shapes.md) for the shapes a page must satisfy.
