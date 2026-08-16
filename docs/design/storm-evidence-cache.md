# STORM evidence cache + report digestion

Feature **C5** (accepted design — ADR-013, 2026-08-15; not yet built). Durable
per-reference evidence cache owned by the `web-search` ingestion plugin, `markitdown`
normalization, and a digest-don't-index report contract.

> Chosen approach: extend the `web-search` plugin live path (scrape → markitdown → cache →
> body) and tighten report craft in the same change. Rejected: a `fetch-refs` workflow
> state (splits the `Doc[]` contract across two components); generator-side lazy fetch
> (no durable cache, re-fetches every run, keeps the boilerplate).

Authority: **ADR-013** (Accepted (design)). Amends the frozen 0056 works layout (adds
`references/`). No new `kk` noun, no new workflow states, no new package dependency —
`markitdown` is the already-installed external binary.

---

## 0. Works layout amendment (0056)

`works/<topic-id>/references/` is added to the frozen layout. Written by the ingest step
(`web-search` plugin); consumed by no other step as a contract (it is an audit trail and
the render tail's resolution target).

| File / dir | Written by | Contents |
| --- | --- | --- |
| `references/<doc-id>.md` | ingest (live path) | normalized full content for one source; file name = Doc id (`sha256(sourceUri)` 16-hex) |

At shipping, the `storm-research` SKILL.md 0056 tables gain: the `references/` layout row,
the markitdown fail-loud row, and the digest-don't-index practice under Better-report (R8).

## 1. Decisions

| ID | Choice | Rejected | Why |
|----|--------|----------|-----|
| D1 | Evidence cache lives in the `web-search` ingestion plugin | New `fetch-refs` workflow state | One owner of the `Doc[]` contract; every ingestion→generation pipeline benefits; zero behavior gain from relocation |
| D2 | Scrape via Firecrawl `/v2/scrape` (`formats: ["markdown"]`), same `FIRECRAWL_API_KEY` | — | Same documented API family as the shipped `/v2/search` (0057); key stays env-only |
| D3 | Normalize with the `markitdown` binary on PATH, availability-checked | New npm dependency; skip normalization | It is the installed tool today (0.1.4); no new package; fail loud only when live mode requires it |
| D4 | Cache key = Doc id = `sha256(sourceUri)` 16-hex; file existence ⇒ reuse | Query-derived keys | URL-derived ids are already deterministic across runs (0054); reuse needs no query bookkeeping |
| D5 | Per-URL scrape failure / unusable content → warn + keep snippet body, exit 0 | Fail the whole ingest | A single dead source must not sink research (R3/R11); snippet body remains valid evidence |
| D6 | `references/` derived from the plugin's `--out` dir; no new `--in` field / env var | New input key, new workflow var | `--out` is already `work_dir/docs.json`; the cache dir is a sibling — zero surface growth |
| D7 | Digest-don't-index is contract: content-gen prompt mandates synthesis; render drops the `## Outline` replay | Leave craft to prompt variance | Digestion quality must not be luck; references are evidence, not the deliverable (R6/R7) |

## 2. Flow (live path)

```text
searchFirecrawl (0057) ──→ Doc[] snippet bodies
        │ per Doc with usable sourceUri (id = computeId(uri)):
        ▼
/ v2/scrape exists in references/<id>.md ? ──yes──→ reuse file (no scrape)
        │ no
        ▼
POST /v2/scrape { formats: ["markdown"] } ──→ markitdown < html > references/<id>.md
        │ failure / empty / unparsable
        ▼
warn ("scrape failed: <url>"); body stays the search snippet
        ▼
docs.json body = normalized cached content (Doc[] shape unchanged)
```

Fixture path (`fixture: true`): unchanged canned `Doc[]`, no network, no key check, no
`markitdown` invocation (R9).

## 3. Fail-loud rows (new / changed)

| Condition | Behavior |
| --- | --- |
| Live mode, `markitdown` not on PATH (R5) | exit 1, stderr names `markitdown`; no `docs.json` |
| Live mode, `FIRECRAWL_API_KEY` unset (R10) | exit 1, stderr names the key; no `docs.json` (unchanged from 0057) |
| Single-URL scrape failure / empty / unparsable content (R3/R11) | warn naming the URL; that Doc keeps the snippet body; ingest exits 0; `docs.json` written |

Warnings name the exact URL. Never silently skip, never auto-retry (0057 policy).

## 4. Cache reuse (R4)

- Reuse condition: `references/<doc-id>.md` exists. No content comparison, no TTL, no query
  check — the key is URL-derived, so a re-run over the same sources (same or new query)
  reuses the same files.
- A stale cache is refreshed only by deleting the file (or a fresh work dir). Recorded as a
  deliberate simplification: no invalidation policy until evidence shows staleness matters
  (`ponytail:` ceiling — the cache is append-only per topic id).
- The cache is per-topic (`works/<topic-id>/references/`), matching the existing
  last-write-wins topic workspace (0056).

## 5. Report digestion contract

- **Generator (content-gen, STORM pipeline):** prompt text mandates synthesis — the body
  draws findings from across the supplied documents rather than listing them one per line
  (R6). Every citation still resolves to an allowed Doc id (existing contract).
- **Render (`renderContentMarkdown` in `@gobing-ai/kk-core` + the byte-identical
  `plugins/kk/scripts/render-md.ts` copy):** stop appending the `## Outline` block
  (`content.outline` stays in `content.json` — it is dropped only in the markdown tail);
  keep the compact `## References` list, whose `cite` ids resolve to
  `references/<doc-id>.md` files (R7). Both copies change together (SYNC comment).
- **SKILL.md (R8, shipping obligation):** Better-report practices record
  "digest, don't index — references are evidence, not the deliverable."

## 6. Surface

Lands with C5 implementation (T3 same-commit):

- `plugins/ingestions/web-search/src/index.ts` — scrape → markitdown → cache → body in the
  live path; cache-dir creation under `--out`'s dir; injectable scrape/markitdown deps for
  tests (extend `SearchDeps`).
- `plugins/kk/skills/storm-research/SKILL.md` — 0056 works-layout row, fail-loud row,
  digest practice (R8).
- `packages/kk-core/src/render-md.ts` + `plugins/kk/scripts/render-md.ts` — outline replay
  removed, references tail unchanged in shape.
- `plugins/generations/content-gen/src/storm.ts` — synthesis mandate in the article-stage
  prompt.
- No new CLI flags, config keys, env vars, workflow vars, or `kk` nouns.

## 7. Test seams

- Extend `SearchDeps` with `scrape: FetchLike` and an injectable `markitdown` runner —
  unit tests never hit the network or the real binary.
- Fixture: scrape-failure doc keeps snippet body, ingest exits 0 (R3); unusable-content doc
  same (R11).
- Reuse: pre-seeded `references/<id>.md` → no scrape call recorded (R4).
- Fail-loud: markitdown runner missing → exit 1, no `--out` (R5); key unset → exit 1 (R10).
- Fixture mode: no network, no key, no markitdown invocation (R9).
- Render: no `## Outline` in output; references resolve to cached ids (R7).
- `docs.json` parses against `DocListSchema` with the unchanged `Doc[]` shape (R2).

## 8. Invariants

1. `references/` files are keyed by Doc id; the id and the body come from the same source URI.
2. A scrape failure never fails the ingest; only missing `markitdown` / key (live mode) does.
3. `docs.json` never changes shape — only body provenance (snippet vs normalized full text).
4. Fixture mode is byte-for-byte unchanged in behavior: no network, no key, no binary.
5. The render `## Outline` removal is applied to both copies of the render function.
6. No new `kk` noun, workflow state, or package dependency.
