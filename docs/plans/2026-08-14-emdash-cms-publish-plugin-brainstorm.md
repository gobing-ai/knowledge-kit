---
title: EmDash CMS publish plugin
date: 2026-08-14
needs_design: true
idea: Develop a publishing plugin to publish new posts to Cloudflare EmDash CMS websites
sources:
  - https://docs.emdashcms.com/introduction/
  - https://docs.emdashcms.com/reference/rest-api/
  - https://docs.emdashcms.com/reference/cli/
  - https://docs.emdashcms.com/reference/mcp-server/
  - https://docs.emdashcms.com/concepts/content-model/
  - https://docs.emdashcms.com/guides/working-with-content/
  - https://docs.emdashcms.com/guides/create-a-blog/
  - https://docs.emdashcms.com/guides/ai-tools/
  - https://docs.emdashcms.com/deployment/secrets/
---

# Brainstorm: EmDash CMS publish plugin

**Date:** 2026-08-14

## Overview

Robin now runs more Astro sites on [EmDash](https://docs.emdashcms.com/introduction/)
(Cloudflare Workers + D1 + R2). knowledge-kit already ships three `kind: publish`
plugins — `surfdash-pub` (CLI), `zenn-pub` (CLI), `qiita-pub` (token API) — under the
E2 `PublishTransport` contract (`Content` → `Result`, env-only secrets, fail-loud
exit). There is no EmDash channel, so a generated `Content` cannot land on those
sites through `kk executor run` / `kk fan-out`.

EmDash is **not** a separate headless CMS. It lives inside the Astro site. Remote
writes still exist: REST at `/_emdash/api/`, an official `emdash` CLI
(`content create` / `content publish`), and an MCP server. Auth for machines is a
personal access token (`ec_pat_*`) via `Authorization: Bearer`, also accepted as
`EMDASH_TOKEN`. Default blog seed is collection `posts` with `title`, `content`
(Portable Text), `excerpt`, `featured_image`, plus taxonomies.

The work is a new publish plugin instance under kind parent **E**, not a new
platform kind and not a new feature-tree root.

## Approaches

### Approach 1: REST PAT transport (`emdash-pub`, qiita-shaped) ⭐ Recommended

**Description:** Ship `plugins/publishings/emdash-pub` as a `kind: publish` plugin
that implements `PublishTransport` with `kind: 'file-cli'` (token-API, no browser —
ADR-008 / E2). `publish()` `POST`s
`{EMDASH_URL}/_emdash/api/content/{collection}` with
`Authorization: Bearer ${EMDASH_TOKEN}` and the REST create envelope
`{ data, slug, status }`. Map `Content.title` / heading, `Content.body` (markdown →
Portable Text), excerpt, tags, and `metadata.published` → `status`. Offline tests
use `FakeFileCliTransport` plus a mocked `fetch` for the live mapper, same as
`qiita-pub`.

**Trade-offs:**
- **Pros:**
  - Matches the shipped Qiita channel: one plugin dir, env-only secrets, no extra
    runtime binary.
  - Official env names (`EMDASH_URL`, `EMDASH_TOKEN`) already exist in EmDash CLI
    docs — operators can reuse one token for `emdash` CLI and `kk`.
  - Fan-out to many sites is already `kk fan-out` with different env per invocation.
  - Offline-testable; no Playwright; no site-side EmDash plugin to install.
- **Cons:**
  - `Content.body` is markdown; EmDash stores `portableText`. We must own a
    markdown → Portable Text mapper (or prove the REST create endpoint accepts
    markdown/HTML and converts it).
  - Per-site schemas vary (visual modelling). Default `posts` is a convention, not
    a guarantee — collection slug and field names must be configurable and fail
    loud on `VALIDATION_ERROR` / missing collection.
  - REST “Working with Content” example uses an HTML string; the REST reference
    uses `{ data: { content: [...] } }`. The plugin must pick the documented
    envelope (`data` + Portable Text) and lock it in tests.

**Implementation Notes:**
- Plugin layout copies `qiita-pub` (`plugin.json`, `src/index.ts`, bun tests).
- Env (secrets never in `plugin.json` / `Result`):
  - `EMDASH_URL` — site origin (required)
  - `EMDASH_TOKEN` — `ec_pat_*` with `content:write` (required)
  - `EMDASH_COLLECTION` — default `posts`
  - optional field overrides later (`EMDASH_TITLE_FIELD`, `EMDASH_BODY_FIELD`) if
    a site renamed the seed fields
- Default **draft** unless `Content.metadata.published === true` (safer than the
  official CLI, which auto-publishes unless `--draft`).
- Body mapper v1: headings, paragraphs, lists, fenced code, links, emphasis.
  Unsupported constructs fail loud rather than silently drop.
- Result: `ok`, `target: 'emdash'`, `id` (ULID), `url` derived from
  `{EMDASH_URL}` + site post path if known, else omit `url` and keep `id`.
- Out of v1: media upload / `featured_image`, i18n translations, schema writes,
  update-in-place / `_rev` concurrency, menus, MCP.

**Confidence:** HIGH (transport + auth + default collection); MEDIUM (exact
markdown → Portable Text write shape — two official pages disagree on create body)
**Sources:**
- [REST API — Create Content](https://docs.emdashcms.com/reference/rest-api/) | **Verified**: 2026-08-14
- [Working with Content — Content API](https://docs.emdashcms.com/guides/working-with-content/) | **Verified**: 2026-08-14
- [Content model](https://docs.emdashcms.com/concepts/content-model/) | **Verified**: 2026-08-14
- [Create a Blog — default posts fields](https://docs.emdashcms.com/guides/create-a-blog/) | **Verified**: 2026-08-14
- [Secrets — API tokens `ec_pat_`](https://docs.emdashcms.com/deployment/secrets/) | **Verified**: 2026-08-14
- `plugins/publishings/qiita-pub/src/index.ts` (this repo, 2026-08-14)
- `docs/design/publish-plugin-specification.md` §2 (this repo, 2026-08-14)

### Approach 2: Shell the official `emdash` CLI

**Description:** Implement `emdash-pub` as a `file-cli` child-process transport
(`npx emdash content create <collection> --file … --url … --token …` plus
`--draft` when not publishing), mirroring `surfdash-pub` / `zenn-pub`. Lean on
the official CLI’s documented markdown conversion (`content get` returns
markdown unless `--raw`).

**Trade-offs:**
- **Pros:**
  - First-party client already speaks auth, envelopes, and PT ↔ markdown.
  - Less custom HTTP / Portable Text code in knowledge-kit.
- **Cons:**
  - Runtime depends on `emdash` being resolvable (`npx` / local install) — heavier
    and less deterministic than `fetch`.
  - CLI **auto-publishes unless `--draft`** — easy to invert and ship live posts
    by default if we wrap it naively.
  - `content create --data` is JSON of field values; it is **not** documented
    that a markdown string is accepted for `portableText` fields. The GET-side
    converter does not prove the write path.
  - Harder to assert request bodies in unit tests (spawn + fixture CLI).

**Implementation Notes:**
- Only choose this if a spike shows REST create rejects markdown/HTML and the
  official CLI is the only write path that converts.
- Still classify as `file-cli`; still env-only `EMDASH_URL` / `EMDASH_TOKEN`.

**Confidence:** MEDIUM
**Sources:**
- [CLI — `content create` / `content get --raw`](https://docs.emdashcms.com/reference/cli/) | **Verified**: 2026-08-14

### Approach 3: MCP JSON-RPC or a site-side EmDash plugin

**Description:** Either POST JSON-RPC to `/_emdash/api/mcp` (`content_create` +
`content_publish`) with a PAT, or install an EmDash plugin on each site that
accepts a webhook from knowledge-kit.

**Trade-offs:**
- **Pros:**
  - MCP tools are the richest documented write surface (publish, schedule,
    taxonomies, media_upload).
  - A site-side plugin could normalize schemas once per site.
- **Cons:**
  - MCP is an assistant protocol (OAuth + scopes + JSON-RPC), not a batch
    publish contract. Extra moving parts for the same `Content` → post job.
  - A site-side EmDash plugin must be installed on every target — the opposite
    of “push to existing Cloudflare sites from `kk`”.
  - Media via MCP is limited (`media_upload` exists; the AI Tools guide still
    warns the MCP transport cannot carry arbitrary binaries in some clients).

**Implementation Notes:**
- Reject as v1. Revisit only if REST + CLI both fail for Portable Text writes.

**Confidence:** HIGH that this is the wrong v1 seam
**Sources:**
- [MCP Server Reference](https://docs.emdashcms.com/reference/mcp-server/) | **Verified**: 2026-08-14
- [AI Tools](https://docs.emdashcms.com/guides/ai-tools/) | **Verified**: 2026-08-14
- [Introduction — not a headless CMS](https://docs.emdashcms.com/introduction/) | **Verified**: 2026-08-14

## Recommendations

Ship **Approach 1**: a new `emdash-pub` publish plugin under **E**, qiita-shaped
REST + PAT, official env names, markdown → Portable Text mapper, default draft,
offline harness tests. Feature node: child of **E** (next free digit **E5**),
not a new root — E already owns “future channels under E4’s pattern”.

Pick Approach 2 only if the system-design spike shows REST create will not accept
a Portable Text (or converted) body. Do not build MCP or a site-side EmDash
plugin for v1.

## Design Summary

`plugins/publishings/emdash-pub` is a `kind: publish` instance of the existing
E2 contract. It does not change `@gobing-ai/kk-core` schemas or the CLI noun
tree.

```
Content JSON (--in)
  → validate ContentSchema
  → map title / slug / excerpt / tags / status
  → markdown body → Portable Text blocks
  → POST {EMDASH_URL}/_emdash/api/content/{collection}
       Authorization: Bearer {EMDASH_TOKEN}
       { data, slug, status }
  → Result { ok, target: "emdash", id, url?, error? }
```

**Invariants**
- Secrets only via env (`EMDASH_TOKEN`); never in `plugin.json` or Result.
- Missing URL/token, invalid Content, HTTP 4xx/5xx, slug conflict → `ok: false`,
  exit 1.
- Collection default `posts`; override with `EMDASH_COLLECTION`.
- Create new posts only in v1 (no update / `_rev`).
- No browser transport. No core package changes.

**Rejected**
- Wrapping `npx emdash` as the primary transport (Approach 2) — extra runtime,
  auto-publish default, write-side markdown conversion not specified.
- MCP or installing an EmDash plugin on each site (Approach 3).
- Featured-image / media library / i18n / schema mutation in v1.

**Open design item (system-design, not a blocker to proceed):** confirm create
body: REST reference `{ data: { title, content: PortableText[] } }` vs the
Working-with-Content HTML string example. Lock the winner in
`docs/design/emdash-pub.md` with a fixture test.

## Spec self-review

- No `TODO` / `TBD` / `???` / empty required sections.
- No contradiction with ADR-007 (three kinds) or E2 (transport + env secrets).
- Scope is one publish plugin + mapper; not a new kind, not WT harvest, not
  media/i18n.
- Feature parent is **E** (MECE); E1–E4 exist, E5 is free.

## Next Steps

1. Taste-gate this evaluation (`idea-eval`).
2. `spur feature create "EmDash CMS publisher" --parent E` → E5.
3. Author R-numbered AC; `spur feature check --strict`.
4. System-design satellite `docs/design/emdash-pub.md` (envelope + mapper + env).
5. Decompose and batch-create under E5.
6. Implement via `/sp-dev-runall --feature E5` after refine.

---

**Generated by:** sp-brainstorm
**Research delegation:** official EmDash docs 2026-08-14 + in-repo publish spec / qiita-pub
**Operator review:** pending idea-eval taste gate (`--auto` does not pre-approve taste)
