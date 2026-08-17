# EmDash CMS publisher

Feature **E5** (shipped — task `0061`). Publish plugin instance
`plugins/publishings/emdash-pub` that creates a new post on an existing EmDash
CMS site via the official REST API.

> Chosen approach: qiita-shaped REST + PAT transport (`file-cli`). No new kind,
> no core schema change, no ADR — extends the E2 publish seam.

Authority for the generic contract: [publish-plugin-specification.md](publish-plugin-specification.md).
Official write surface: [REST API](https://docs.emdashcms.com/reference/rest-api/)
(verified 2026-08-14).

---

## 1. Decisions

| ID | Choice | Rejected | Why |
|----|--------|----------|-----|
| D1 | New plugin dir `plugins/publishings/emdash-pub` (`kind: publish`) | New kind; wrap as a `kk` noun; site-side EmDash plugin | E2 instance pattern; `kk executor run emdash-pub` is the invoke path |
| D2 | Direct `fetch` to `POST {origin}/_emdash/api/content/{collection}` | `npx emdash content create`; MCP JSON-RPC | Same as `qiita-pub`; no extra binary; MCP is an assistant protocol |
| D3 | Auth: `Authorization: Bearer {EMDASH_TOKEN}` (`ec_pat_*`) | Session cookie; Cloudflare Access JWT; passkey | PAT is the documented machine credential |
| D4 | Env names `EMDASH_URL`, `EMDASH_TOKEN`, optional `EMDASH_COLLECTION` | Plugin-prefixed names; config file | Official CLI already uses `EMDASH_URL` / `EMDASH_TOKEN` |
| D5 | Create envelope `{ data: { title, content, excerpt? }, slug, status }` | Working-with-Content HTML-string example | REST reference + content model (`PortableTextBlock[]`) win |
| D6 | Own markdown → Portable Text mapper in the plugin | Depend on `emdash` package; send raw markdown | `emdash` is the CMS runtime, not a kk workspace dep |
| D7 | Default `status: draft`; `published` only when `Content.metadata.published === true` | Match CLI auto-publish; default published (spec §2.3) | Safer for live Cloudflare sites; spec default is for SSG frontmatter |
| D8 | Default collection `posts`; override `EMDASH_COLLECTION` | Probe schema and guess; require collection in Content | Seed blog collection; fail loud on `NOT_FOUND` / `VALIDATION_ERROR` |
| D9 | Create-only v1 (no `_rev` update) | Upsert-by-slug | Avoids concurrency protocol; slug conflict fails loud |
| D10 | `Result.url` omitted unless `EMDASH_PUBLIC_POST_PATH` is set | Guess `/blog/{slug}` | Public path is per-site; `id` is always the ULID from the API |
| D11 | No ADR | ADR for “EmDash as a publish target” | Extends E2; two-way door; delete the plugin to reverse |

---

## 2. Module layout

```
plugins/publishings/emdash-pub/
  plugin.json              # name: emdash-pub, kind: publish, entry: ./src/index.ts
  package.json             # @gobing-ai/emdash-pub; workspace deps kk-core, publish-harness, utils
  src/index.ts             # CLI --in/--out, transport, mapper (same grain as qiita-pub)
  tests/emdash-pub.test.ts
```

No new workspace package under `packages/`. No change to `apps/cli`.

---

## 3. Interfaces

```ts
export interface EmDashCreateEnvelope {
    data: {
        title: string;
        content: PortableTextBlock[];
        excerpt?: string;
    };
    slug: string;
    status: 'draft' | 'published';
}

export interface PortableTextSpan {
    _type: 'span';
    text: string;
    marks?: string[];
}

export interface PortableTextBlock {
    _type: 'block' | 'code';
    style?: 'normal' | 'h2' | 'h3' | 'h4' | 'blockquote';
    children?: PortableTextSpan[];
    markDefs?: Array<{ _type: 'link'; href: string; _key: string }>;
    listItem?: 'bullet' | 'number';
    language?: string;
    code?: string;
}

export function mapContentToEmDashCreate(content: Content): EmDashCreateEnvelope;
export function markdownToPortableText(markdown: string): PortableTextBlock[];
export class EmDashApiTransport implements PublishTransport; // kind: 'file-cli'
export function getPublishTransport(): PublishTransport;
```

`getPublishTransport()` returns `FakeFileCliTransport` when
`KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (same seam as the other channels).

---

## 4. Env (secrets never on disk)

| Variable | Required | Default | Role |
|----------|----------|---------|------|
| `EMDASH_URL` | yes | — | Site origin, no trailing slash (e.g. `https://example.com`) |
| `EMDASH_TOKEN` | yes | — | PAT (`ec_pat_*`) with `content:write` |
| `EMDASH_COLLECTION` | no | `posts` | Collection slug in the create path |
| `EMDASH_PUBLIC_POST_PATH` | no | unset | Optional template `{slug}` → `Result.url` |
| `KNOWLEDGE_KIT_PUBLISH_TRANSPORT` | no | live | `fake` selects the harness transport |

Missing `EMDASH_URL` or `EMDASH_TOKEN` → `ok: false`, exit 1, error names the variable.
Token value never appears in `Result`, logs, or `plugin.json`.

---

## 5. Content mapping

| Content | EmDash field |
|---------|----------------|
| `title`, else first `#` heading, else fail loud | `data.title` |
| slugify(title) or `metadata.slug` | `slug` |
| markdown `body` minus a consumed `#` title line | `data.content` (Portable Text) |
| `metadata.description` or first paragraph | `data.excerpt` (omit if empty) |
| `metadata.published === true` | `status: published`; else `draft` |

Mapper v1 supports: paragraphs, ATX `##`–`####`, unordered/ordered lists, fenced
code, `*emphasis*` / `**strong**`, `[text](url)` links. Tables, raw HTML, and
inline/embedded images fail loud (no silent drop).

---

## 6. HTTP

```
POST {EMDASH_URL}/_emdash/api/content/{collection}
Authorization: Bearer {EMDASH_TOKEN}
Content-Type: application/json

{ "data": { "title", "content", "excerpt?" }, "slug", "status" }
```

Success (`success: true`, `data.item.id` string):
`Result { ok: true, target: 'emdash', id, url?, message }`.

Failure (network, non-2xx, `success: false`, missing `id`):
`Result { ok: false, target: 'emdash', error }` including HTTP status and
`error.code` when present (`SLUG_CONFLICT`, `UNAUTHORIZED`, `VALIDATION_ERROR`,
`NOT_FOUND`). Exit 1.

---

## 7. Invariants

- No `@gobing-ai/kk-core` schema change.
- Transport `kind` is `file-cli` (token API, ADR-008).
- Tests run offline; live `fetch` is injected or mocked.
- v1 does not update, delete, upload media, assign taxonomies, or call MCP.

---

## 8. 03 / 04 sync (executed at E5 ship, 2026-08-16)

- `04` §0 index row: this satellite, status shipped (E5).
- `03` module list + workspace table: add `emdash-pub` **when the plugin ships**,
  not in this planning change (constitution §6.4 — current architecture only).
- `01` / `05`: at ship (T4 / shipped-surface row), not now.
