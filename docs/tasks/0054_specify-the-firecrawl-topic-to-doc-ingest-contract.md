---
template: feature-impl
schema_version: 1
name: "Specify the Firecrawl topic-to-Doc ingest contract"
description: ""
status: done
type: task
profile: standard
feature_id: C3
parent_wbs: null
priority: P1
tags: ["wayfinder:research"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T03:34:53.458Z"
updated_at: "2026-08-14T05:57:18.007Z"
---

## 0054. Specify the Firecrawl topic-to-Doc ingest contract

### Background
wayfinder:research — C3 STORM topic-research workflow.

**Question.** What is the v1 `web-search` ingest plugin's invoke contract (so a later implementer can code `plugins/ingestions/web-search` without guessing)?

**Verified premises (2026-08-14, this refine — do not re-derive, do correct if docs moved):**
- C1 API sources use a JSON `--in` file; secrets inherit `process.env` only (`docs/design/ingestion-plugin-specification.md` §1.3, §2.2).
- Ingestion `kindContract` input is `null`; output is `DocListSchema` (`packages/kk-core/src/kinds.ts`).
- C1 §2.4: zero matching items → write `[]` and exit 0; partial item failure → skip + stderr warn + exit 0; auth/source inaccessible → nonzero.
- D4 empty `Doc[]` → Notice Content, exit 0 (`plugins/generations/content-gen/src/index.ts`). D4 `Content.references` map `sourceUri`/`title`/`id` (`storm.ts` `generateWithStormPipeline`).
- C2 `karakeep-local` is an FS source (`--in` directory, id = sha256 of relative path). Do not copy `--in` semantics.
- Firecrawl official (fetched 2026-08-14): base `https://api.firecrawl.dev`; search `POST /v2/search`; auth `Authorization: Bearer <key>`; curl samples use `$FIRECRAWL_API_KEY`; `scrapeOptions.formats: ["markdown"]` returns page markdown in one call. Feature page: https://docs.firecrawl.dev/features/search — API intro: https://docs.firecrawl.dev/api-reference/introduction

**Out of this ticket:** plugin source; workflow YAML; implementing query-expansion; D4 edits; Brief schema; publish.
### Requirements
- [x] R1. Produce an implementable ingest contract in this task's Solution, cited to C1 (`docs/design/ingestion-plugin-specification.md`), karakeep-local (contrast only), D4 Doc consumption (`content-gen` `index.ts` + `storm.ts`), and current Firecrawl HTTP docs (dated). The Solution must name `--in` JSON keys, the env secret, Doc field mapping, the search/scrape call sequence, and a fail-loud table so `plugins/ingestions/web-search` can be scaffolded without asking the operator.
- [x] R2. Explicitly resolve the C1 §2.4 empty-success (`[]` + exit 0) vs D4 Notice Content tension for (a) zero search hits and (b) hits with zero usable bodies. State the chosen exit/output for each row of the fail-loud table and why it follows or departs from C1.
### Acceptance Criteria
```gherkin
Feature: Firecrawl topic-to-Doc ingest contract

  Scenario: R1 — Contract is implementable without guessing
    Given C1, karakeep-local, D4, and current Firecrawl HTTP docs
    When the investigation is recorded in Solution
    Then --in JSON keys, env secret name, Doc field mapping, call sequence, and fail-loud table are specified with citations
    And an implementer can scaffold plugins/ingestions/web-search without asking the operator

  Scenario: R2 — C1 tensions are explicit
    Given C1 §2.4 empty-success and D4 empty-DocList Notice Content
    When zero hits or all scrapes fail
    Then the contract states the chosen exit/output behavior and why it does or does not follow C1
```
### Q&A
- **Query expansion in v1?** Closed: use the topic string as the single Firecrawl `query`. Expansion is C3 fog, not this ticket.
- **Search+scrape one call or two?** Closed for Design: prefer `POST /v2/search` + `scrapeOptions`. Solution may switch to two-step only with a cited blocker.
- **Env name?** Closed starting point: `FIRECRAWL_API_KEY` (vendor curl, 2026-08-14). Solution confirms or cites a different official name.
- **Feature Gherkin match?** Closed: C3 is a `wayfinder-map` (no BDD AC). Task AC is `ac_numbering: task-local`. Expected L4 subset warnings vs feature AC; not a defect.
- **Empty ingest vs D4 Notice?** Design recommends C1 empty-success for zero hits, fail-loud for hits-but-no-bodies. Solution owns the final row.
- **SDK vs fetch?** Closed: default `fetch` to the HTTP API. No new runtime.
### Design
**WHAT.** A research artifact (this task's Solution), not code. Solution is the contract 0055 and later implement work consume.

**WHY.** D4 is grounded STORM on `Doc[]` and must not search the web. C3 v1 is compose-plugins: Firecrawl-backed ingest → existing `content-gen`. Without a cited contract, the prototype invents endpoints and fail-loud behavior.

**WHERE (read these; do not invent):**
- `docs/design/ingestion-plugin-specification.md` (C1)
- `plugins/ingestions/karakeep-local/src/index.ts` (FS contrast only)
- `plugins/generations/content-gen/src/index.ts` and `src/storm.ts` (`references` mapping)
- `packages/kk-core/src/schemas.ts` (`DocSchema`) and `src/kinds.ts` (`kindContract('ingestion')`)
- Firecrawl (re-fetch; correct the refine snapshot if drifted): https://docs.firecrawl.dev/features/search , https://docs.firecrawl.dev/api-reference/introduction , https://docs.firecrawl.dev/api-reference/endpoint/search

**Frozen starting points (confirm or correct in Solution — do not silently replace):**
- Plugin id/path: `web-search` / `plugins/ingestions/web-search/` (Firecrawl is the backend, not the name).
- `--in` JSON (C1 API source): required `topic` (non-empty string); optional `maxResults` (positive int, default 8); optional `fixture` (boolean) reserved for 0055 stub — document it, do not implement.
- Env: `FIRECRAWL_API_KEY` (name taken from Firecrawl curl comments, 2026-08-14). Header `Authorization: Bearer <key>`. Never put the key in `--in` or `plugin.json`.
- Call sequence (preferred): one `POST https://api.firecrawl.dev/v2/search` with `query` = topic and `scrapeOptions.formats = ["markdown"]`. Two-step search-then-scrape only if the investigator cites a blocking reason (filter-before-scrape, cost).
- Query expansion: **v1 uses the topic string as the single query.** Record that recommendation; do not design an LLM expansion loop here.
- Doc mapping to lock (field → source): `id` deterministic from canonical URL (sha256 hex prefix, same idea as C2 path hash); `sourceUri` = result URL; `title` = result title; `body` = scraped markdown (required); `mediaType` = `text/markdown`; `metadata.query`, `metadata.rank`/`position`, `metadata.scraped_at`.
- D4 citation survival: every emitted Doc MUST have `id` and SHOULD have `sourceUri` + `title` (`storm.ts` maps those onto `Content.references`).

**Recommended fail-loud table (confirm or amend with why):**
- Missing/invalid `--in` (no topic) → stderr + exit 1, no `--out`.
- Missing `FIRECRAWL_API_KEY` on a live (non-fixture) run → stderr + exit 1 (C1 auth fail).
- Firecrawl 401/402 → stderr + exit 1.
- Firecrawl 429 → stderr + exit 1 (do not silent-retry in v1).
- Zero web hits → `[]` + exit 0 (C1 §2.4). Call out that D4 will then write Notice Content.
- Some results lack markdown → skip those items, stderr warn, emit the rest, exit 0 (C1 partial).
- Hits > 0 but zero usable bodies → **depart from C1 empty-success**: stderr + exit 1. Why: treating this as success hides a scrape outage and feeds D4 a useless Notice. Record the departure.

**Solution must contain these labeled blocks (no extra plugin code):**
1. `--in` JSON schema (required/optional keys + types)
2. Env + HTTP auth
3. Call sequence (endpoint, method, request fields, response fields used)
4. Doc mapping table
5. Fail-loud table (condition → exit → `--out`)
6. C1 tension note (R2)
7. Dated citations (`file:line` or URL + date)
8. Handoff to 0055 (which keys the workflow must write)

**Anti-patterns:**
- Do not write `plugins/ingestions/web-search` or workflow YAML (0055).
- Do not add a Firecrawl npm SDK as a decided dependency — HTTP via `fetch` is the default unless Solution cites a blocker.
- Do not widen `DocSchema` / add plugin kinds / implement Brief.
- Do not port `vendors/storm` Python/DSPy.
- Do not put retrieval inside `content-gen`.
- Do not invent response fields not in the fetched docs.

**No new public kk CLI.** Invoke remains `kk executor run web-search --in <json> --out <docs.json>`.
### Plan
1. Re-read C1 spec + `kindContract('ingestion')` + D4 `index.ts`/`storm.ts` reference mapping (R1).
2. Re-fetch Firecrawl search + intro + search-endpoint pages; note fetch date; correct any refine snapshot drift (R1).
3. Write Solution blocks 1–5 (schema, env/auth, call sequence, Doc mapping, fail-loud) with citations (R1).
4. Write Solution block 6: zero-hits vs zero-bodies vs C1/D4, including the recommended departure for hits-but-no-bodies (R2).
5. Write handoff keys for 0055; do not graduate implement tickets in the 0054 session (wayfinder one-ticket rule).
6. Verify: `spur task check 0054 --json` pass; a reader can implement `--in` parse + Doc map from Solution alone.
### Solution
**Contract: `web-search` ingestion plugin (Firecrawl-backed).** Research artifact only — no plugin code in this ticket (0055 implements). Invoke shape stays `kk executor run web-search --in <json> --out <docs.json>` (C1 §1.2, `docs/design/ingestion-plugin-specification.md:19-22`).

**Block 1 — `--in` JSON schema (API source, C1 §2.2 `:57-59`):**
```jsonc
// plugins/ingestions/web-search --in input.json
{
  "topic": "STORM research topic as a single Firecrawl query",   // REQUIRED, non-empty string
  "maxResults": 8,    // OPTIONAL, positive int, default 8; passed through as Firecrawl `limit` (OpenAPI bounds 1..100)
  "fixture": false    // OPTIONAL, boolean, default false; RESERVED for 0055 stub (bypass HTTP, emit canned Docs) — documented here, not implemented
}
```
- `topic` REQUIRED — reject missing/empty/non-string with stderr + exit 1 (fail-loud table row 1).
- `maxResults` OPTIONAL — if present must be a positive integer, else invalid `--in` (row 1). Plugin performs no clamping: the OpenAPI bounds `limit` to 1..100 (min 1, max 100, default 10) but does not document clamp-vs-reject; an out-of-range value is passed through and, if the API rejects it, the resulting HTTP error lands on row 5 (endpoint OpenAPI, fetched 2026-08-14).
- `fixture` OPTIONAL — no behavior in 0054; 0055 may honor it to emit canned `Doc[]` without HTTP. Never a secret channel.

**Block 2 — Env + HTTP auth:**
- Secret env var: **`FIRECRAWL_API_KEY`** — name confirmed against official curl sample `-H "Authorization: Bearer $FIRECRAWL_API_KEY"` (https://docs.firecrawl.dev/features/search, fetched 2026-08-14; frozen premise confirmed, no correction).
- Header: `Authorization: Bearer <FIRECRAWL_API_KEY>` (https://docs.firecrawl.dev/api-reference/introduction, fetched 2026-08-14).
- Read via `process.env` only (C1 §1.3 `:24-26`). NEVER in `--in` or `plugin.json` (C1 §1.3 `:26`; manifest holds no secrets).
- Plugin entry spawned with full env inheritance (C1 §1.2 `:22`).

**Block 3 — Call sequence:** One HTTP call (two-step search-then-scrape is NOT used; `scrapeOptions.formats: ["markdown"]` returns page markdown per result in the same response — feature docs, fetched 2026-08-14 — so no cited blocker exists for the one-call design; frozen premise confirmed).

| Step | Value |
|---|---|
| Endpoint | `POST https://api.firecrawl.dev/v2/search` (base URL: api-reference/introduction, fetched 2026-08-14; path: features/search + endpoint reference) |
| Headers | `Content-Type: application/json`; `Authorization: Bearer ${process.env.FIRECRAWL_API_KEY}` |
| Request body | `{ "query": <topic>, "limit": <maxResults\|8>, "sources": ["web"], "scrapeOptions": { "formats": ["markdown"] } }` |
| Request fields used | `query` (string, required, maxLength 500 — endpoint OpenAPI), `limit` (int, default 10, min 1, max 100), `sources` (default `["web"]`; sent explicitly to lock web-only), `scrapeOptions.formats` (object form per endpoint OpenAPI `Formats` component `[{"type": "markdown"}]`, fetched 2026-08-14; string form `["markdown"]` shown in the features/search SDK sample — send the string form, matching the sample) |
| Response fields used | `success` (bool); `data.web[]` — `url` (string, "URL of the search result"), `title` (string), `markdown` (string, nullable — "Markdown content if scraping was requested"), `position` (int, documented on web results in features/search response sample), `metadata.url`/`metadata.statusCode`/`metadata.error` (diagnostics only); top-level `error` on failure |
| Query expansion | v1 sends the `topic` string verbatim as the single `query`. No LLM expansion loop in v1 (recorded recommendation, not designed here). |

- Ignore `data.images` / `data.news` (never requested; `sources: ["web"]`).
- Result-list shape: `data.web ?? []` under `success: true`; a 200 `success:true` with `data` absent/null is a malformed response → row 5 (stderr + exit 1, no `--out`); `data` present but `web` missing/empty = zero hits (row 6).
- `success === false` in a 200 body, or a non-2xx status → fail-loud table rows 4–5.

**Block 4 — Doc mapping table** (output = `DocListSchema`, C1 §2.1 `:52-55`; `DocSchema` at `packages/kk-core/src/schemas.ts:4-11`, list at `:43`):

| `DocSchema` field | Source | Notes |
|---|---|---|
| `id` (required) | `sha256(canonicalUrl).hex.slice(0,16)` where canonicalUrl = web item `url` | Same hashing idea as karakeep-local (`plugins/ingestions/karakeep-local/src/index.ts:15-16`, ids at `:77`, `:98`) applied to the resource URI per C1 §2.3 id stability (`:63`); deterministic across re-runs. Identical URLs → identical ids; no dedup pass in v1. |
| `body` (required) | web item `markdown`, trimmed | Required primary content (C1 §2.3 `:64`). Empty/whitespace-only or `null`/missing markdown → item unusable (fail-loud rows 7–8). |
| `title` (optional, SHOULD) | web item `title` | Needed for D4 citation survival — `storm.ts` maps `title` onto `Content.references[].title` (`plugins/generations/content-gen/src/storm.ts:326`). |
| `sourceUri` (optional, SHOULD) | web item `url` | Mapped to `Content.references[].url` (`plugins/generations/content-gen/src/storm.ts:326`). |
| `mediaType` (optional) | `"text/markdown"` | Body is Firecrawl-scraped markdown. |
| `metadata` (optional) | object | See below. |

`metadata` keys (all vendor-specific, C1 §2.3 `:66`):
- `query`: the `topic` string sent to Firecrawl.
- `rank`: 0-based index of the item in `data.web` (deterministic, guaranteed — contract ordering).
- `position`: Firecrawl's 1-based `position` field when present (features/search response sample, fetched 2026-08-14; present on web items in the sample, though the endpoint OpenAPI `data.web[]` schema documents it only on `images`/`news` — read it defensively).
- `scraped_at`: ISO-8601 UTC timestamp captured when the response was received (plugin clock).

D4 citation survival: every emitted Doc MUST have `id`; SHOULD have `sourceUri` + `title` — `generateWithStormPipeline` builds `references: docs.map((doc) => ({ url: doc.sourceUri, title: doc.title, cite: doc.id }))` and feeds `docIds` into the STORM evidence gate (`plugins/generations/content-gen/src/storm.ts:326`, `plugins/generations/content-gen/src/storm.ts:330`); `assertKnownEvidence` (`plugins/generations/content-gen/src/storm.ts:116-120`) rejects citations to unknown IDs at every stage (`plugins/generations/content-gen/src/storm.ts:177,216,254,301`). A Doc missing `id` would break that gate.

**Block 5 — Fail-loud table** (condition → exit → `--out`):

| # | Condition | Exit | `--out` | Rationale |
|---|---|---|---|---|
| 1 | Missing/invalid `--in`: file unreadable, invalid JSON, missing/empty/non-string `topic`, non-positive `maxResults` | 1 | not written | C1 §1.4 failure (`:28-30`); cannot run |
| 2 | Missing `FIRECRAWL_API_KEY` on a live (non-`fixture`) run | 1 | not written | C1 §2.4 Fatal Error — auth failure (`:71`). Key is required by this plugin's contract, not by Firecrawl (features/search, fetched 2026-08-14: "No API key needed to get started — add one for higher rate limits"); stderr states `FIRECRAWL_API_KEY` is unset |
| 3 | Network/transport error (DNS, connection refused, TLS, `fetch` throws) | 1 | not written | C1 §2.4 Fatal Error — source inaccessible (`:71`) |
| 4 | Firecrawl HTTP 401 or 402 | 1 | not written | Auth/credits per introduction status table (fetched 2026-08-14); 401 = key not provided, 402 = payment required |
| 5 | Firecrawl HTTP 400, 404, 408, 429, 5xx, 200 with `success:false`, or a malformed 200 body (`success:true` with `data` absent/null) | 1 | not written | 400 bad params, 408 timeout, 429 rate limit, 5xx server error (introduction table). **No silent retry on 429 in v1** (frozen premise; retry policy is 0055+ scope). stderr includes status + body `error`/error code |
| 6 | Zero web hits (`data.web` empty/missing under present `data`, `success:true`) | 0 | `[]` | C1 §2.4 Empty Output (`:69`). D4 will then emit Notice Content (`content-gen` `src/index.ts:9-14,23-24`) — see block 6 |
| 7 | Some items lack usable `markdown` | 0 | valid Docs only | C1 §2.4 Partial Item Failure: skip + stderr warn + exit 0 (`:70`) |
| 8 | Hits > 0 but zero usable bodies (every item skipped by row 7) | **1** | not written | **Deliberate departure from C1 §2.4 Empty Output** — see block 6 |

**Block 6 — C1 tension note (R2):**
- **(a) Zero search hits** → follows C1 §2.4 Empty Output (`docs/design/ingestion-plugin-specification.md:69`): write `[]`, exit 0. Downstream D4 `content-gen` treats an empty `Doc[]` as Notice Content (`title: 'Notice'`, `body: '# Notice\nNo documents provided for generation.'` — `plugins/generations/content-gen/src/index.ts:9-14`, dispatch at `:24`). That is accepted v1 behavior: a genuinely empty search result is a legitimate answer, not a failure; the Notice surfaces the emptiness to the reader.
- **(b) Hits > 0 but zero usable bodies** → **departs from C1 empty-success**: stderr diagnostic + exit 1, no `--out`. Why: treating "results found but every scrape came back without markdown" as success would (i) hide a scrape/rendering outage behind the same empty-success path as a true zero-hit query, and (ii) feed D4 the same useless Notice while the operator sees exit 0 — indistinguishable from a legitimately empty topic. Failing loud converts an ambiguous silent-None into an actionable error. Scope of the departure is deliberately narrow: only the "hits exist, bodies all unusable" row; row 7 (partial) still follows C1, and row 6 (true zero hits) still follows C1.

**Block 7 — Dated citations:**
- `docs/design/ingestion-plugin-specification.md:19-30` (C1 §1.2–§1.4 invoke/exit/secrets), `:52-71` (C1 §2 kind/`--in`/mapping/failure), `:75-78` (platform compliance)
- `packages/kk-core/src/kinds.ts:50-55` — `KindContract` interface shape; `:58` — `kindContract('ingestion')` = `{ input: null, output: DocListSchema }`
- `packages/kk-core/src/schemas.ts:4-11` (`DocSchema`), `:43` (`DocListSchema`)
- `plugins/generations/content-gen/src/index.ts:9-14` (`EMPTY_CONTENT` Notice), `:23-24` (empty `Doc[]` → Notice, exit 0)
- `plugins/generations/content-gen/src/storm.ts:325-330` — `Content.references` = `{ url: sourceUri, title, cite: id }` + `docIds` provenance metadata; `:116-120` + `:177,216,254,301` — `assertKnownEvidence` evidence gate
- `plugins/ingestions/karakeep-local/src/index.ts:15-16,77,98` — contrast: FS source, `id` = sha256 hex prefix of relative path (id-stability precedent for the URL-hash mapping)
- Firecrawl, all fetched 2026-08-14 (UTC):
  - https://docs.firecrawl.dev/features/search — `POST https://api.firecrawl.dev/v2/search`; `query`/`limit`/`scrapeOptions.formats:["markdown"]` (string form in SDK sample); curl auth comment `$FIRECRAWL_API_KEY`; anonymous-mode note "No API key needed to get started — add one for higher rate limits"; response `data.web[].url/title/description/position` and per-result markdown
  - https://docs.firecrawl.dev/api-reference/introduction — base URL `https://api.firecrawl.dev`; `Authorization: Bearer <key>`; status codes 200/400/401/402/404/408/429/5xx + error codes
  - https://docs.firecrawl.dev/api-reference/endpoint/search — request schema (`query` required maxLength 500; `limit` default 10 min 1 max 100; `sources` default `["web"]`; `scrapeOptions.formats` object form per `Formats` component, string form per features/search sample) and 200 response `data.web[]` fields (`url`, `title`, `markdown` nullable, `metadata.url/statusCode/error`; `position` documented on web results only in the features/search sample)

**Block 8 — Handoff to 0055** (workflow must write these `--in` keys):
- `topic` (REQUIRED) — from the C3 research brief/topic; v1 sends it verbatim as the single Firecrawl query.
- `maxResults` (OPTIONAL, default 8) — cap on `data.web` items ingested; passed as Firecrawl `limit`.
- `fixture` (OPTIONAL, default false) — 0055 stub switch: when true, emit canned `Doc[]` without HTTP (no `FIRECRAWL_API_KEY` required); when false/absent, live Firecrawl path. Plugin skeleton must read and branch on it; 0054 defines only the key's meaning.
- Invoke: `kk executor run web-search --in <json> --out <docs.json>`; wire `--out` into the D4 `content-gen` `--in`.
### Testing
**verifyall --force 2026-08-14 (this run).** Research contract re-audit. No production code in this ticket.

**Per-Requirement Traceability**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | command: `spur task check 0054 --json` → pass=true. Solution Blocks 1–8 present at `docs/tasks/0054_specify-the-firecrawl-topic-to-doc-ingest-contract.md:119-201` (--in schema, env/auth, POST /v2/search+scrapeOptions, Doc mapping, fail-loud table, C1 tension, dated citations, 0055 handoff). D4 citation mapping re-read `plugins/generations/content-gen/src/storm.ts:326` (`references` from `sourceUri`/`title`/`id`). |
| R2 | MET | command: `spur task show 0054` Solution Block 6 (`:185`) states zero hits → `[]`+exit 0 (C1); hits-but-no-bodies → exit 1 (documented C1 departure). D4 empty path re-read `plugins/generations/content-gen/src/index.ts:23-24`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — Contract is implementable without guessing | MET | command | `spur task check 0054 --json` pass=true; 8 labeled Solution blocks at `:119-201` name --in keys, FIRECRAWL_API_KEY, Doc map, call sequence, fail-loud table |
| R2 — C1 tensions are explicit | MET | command | Block 6 (`:185`) records zero-hits vs hits-but-no-bodies vs C1 §2.4 and D4 Notice Content |

**SECUA:** no code diff on this ticket. Coverage: N/A (documentation-only research artifact).

**design-conformance:** 8/8 required Solution blocks DONE vs Design. **Fix this run:** Requirements checkboxes flipped `[ ]` → `[x]` (L3.unchecked-checklist). Artifact: `.spur/run/0054-verdict.json`.
### Review
**Review (2026-08-14, stage: review-only).** Three-dimensional review of the Solution contract (8 labeled blocks) against R1/R2 + AC, with SECUA and architecture-depth passes.

**Citation verification (all file:line refs spot-checked against the tree; Firecrawl re-fetched live during review):**
- C1 `docs/design/ingestion-plugin-specification.md` — §1.2 `:19-22`, §1.3 `:24-26`/`:26`, §1.4 `:28-30`, §2.1 `:52-55`, §2.2 `:57-59`, §2.3 `:63-66`, §2.4 `:69-71`, §3 `:75-78` — all exact.
- `packages/kk-core/src/kinds.ts:52-55` (KindContract shape), `:57-58` (`ingestion = { input: null, output: DocListSchema }`) — exact.
- `packages/kk-core/src/schemas.ts:4-11` (DocSchema), `:43` (DocListSchema) — exact.
- `plugins/generations/content-gen/src/index.ts:9-14` (EMPTY_CONTENT Notice), `:23-24` (empty Doc[] → Notice, exit 0) — exact.
- `plugins/generations/content-gen/src/storm.ts:326` (`references: docs.map(d => ({url: sourceUri, title, cite: id}))`), `:325-330` (Content block incl. `docIds` at `:330`) — exact.
- `plugins/ingestions/karakeep-local/src/index.ts:15-16` (sha256 slice(0,16)), `:77`, `:98` (id = hash(relPath)) — exact.
- Firecrawl (live re-fetch, 2026-08-14): `POST https://api.firecrawl.dev/v2/search`; curl `-H "Authorization: Bearer $FIRECRAWL_API_KEY"`; `query` maxLength 500; `limit` default 10, min 1, max 100; `sources` default `["web"]`; `data.web[]` `url`/`title`/`markdown` (nullable)/`metadata.url`/`statusCode`/`error`; `position` on web results (features/search response sample); `scrapeOptions.formats` string-or-object form (OpenAPI `Formats` component) — all claims confirmed against the fetched pages.

**Functional traceability (R1/R2):** R1 satisfied — Block 1 (`--in` keys: topic required / maxResults / fixture), Block 2 (env `FIRECRAWL_API_KEY`, Bearer header, process.env-only), Block 3 (one-call POST /v2/search with `scrapeOptions.formats:["markdown"]`, two-step explicitly rejected with reasoning), Block 4 (Doc mapping table incl. deterministic `id` = sha256(url).hex[0:16], D4 citation-survival requirements), Block 5 (8-row fail-loud table with exit/`--out`/rationale per row) — all cited. R2 satisfied — Block 6 resolves the C1 §2.4 empty-success vs D4 Notice tension for both (a) zero hits (follows C1: `[]` + exit 0, Notice downstream accepted) and (b) hits-but-no-bodies (deliberate narrow departure: exit 1, no `--out`, with rationale). All 8 required blocks present; no plugin code. AC scenarios both covered. Anti-patterns respected (no SDK, no schema widening, no retrieval in content-gen, no invented response fields).

**SECUA:** Security — secrets env-only, never in `--in`/`plugin.json`; fixture never a secret channel; no silent 429 retry. Efficiency — single HTTP call; no dedup pass in v1 is a documented deliberate tradeoff (identical URLs → identical ids). Correctness — call/response field usage matches the live OpenAPI; fail-loud rows internally consistent; D4 evidence gate not broken (id always emitted). Usability — implementable without operator round-trips; handoff block 8 lists exactly the keys 0055 must write. Architecture — thin plugin boundary, C1-compliant invoke shape, narrow documented C1 departure, id-stability precedent reused from karakeep-local without copying `--in` semantics.

| Severity | Finding | Evidence |
|---|---|---|
| P1 | None | — |
| P2 | None | — |
| P3 | None | — |
| P4 | Evidence-gate citation is one step off: Solution says the gate "validates agent citations against `docIds` (`storm.ts:327-330`)"; those lines *construct* the `docIds` provenance metadata. The validation itself lives in `assertKnownEvidence` / `articleStage`/`outlineStage` earlier in the file. Substantive claim (missing `id` breaks the gate) is correct — cite `:330` as the provenance feed, not the validator. | `plugins/generations/content-gen/src/storm.ts:327-330` |
| P4 | Internally inconsistent `limit` behavior: Block 1 says "API clamps 1..100" while Block 3/row 5 says "Firecrawl returns 400 for `limit` outside 1..100". The OpenAPI constrains `limit` to 1..100 but does not document runtime clamp-vs-reject; the two statements contradict. Recommend one line: plugin validates positive int; out-of-range → row 5 regardless of vendor behavior. | `docs/design/ingestion-plugin-specification.md` §2.2; endpoint OpenAPI `limit` |
| P4 | Degenerate 200 body edge uncovered: "Treat `data.web ?? []` as the result list" assumes `data` is present; a 200 `{"success": true}` with `data` missing/null would throw on `data.web`. Add one clause mapping `data` absent → row 6 (zero hits) or row 5 (malformed response). | Block 3, row 6 |
| P4 | Block 6 says EMPTY_CONTENT "dispatch at `:24`" — the ternary dispatching EMPTY_CONTENT is `:23`; `:24` is the `writeFile`. Block 7's `:23-24` is correct; align Block 6. | `plugins/generations/content-gen/src/index.ts:23-24` |
| P4 | Missing-key-is-fatal is stricter than the vendor: features/search (fetched same day) states "No API key needed to get started — add one for higher rate limits". Row 2's rationale ("C1 auth failure") is the ticket's frozen premise and conformant, but the contract should state the key is *required by the plugin, not the vendor* so a future operator asking "why does it fail without a key?" gets the answer without re-deriving it. | https://docs.firecrawl.dev/features/search (2026-08-14) |

**Verdict: PASS.** R1/R2 fully satisfied; all 8 labeled blocks present and mutually consistent; every local file:line citation verified exact against the tree; Firecrawl citations verified against live docs; 0 P1, 0 P2, 0 P3, 5 P4 nits (citation precision / wording / edge-case documentation) — none block 0055 from consuming the contract. Residual risk: low — the P4 edge (degenerate 200 body) is the only gap that could bite an implementer, and it is trivially closed by the row 6/row 5 clause.
### References
- Feature: [C3 STORM topic-research workflow](docs/features/C3_storm-topic-research-workflow.md)
- C1: [ingestion-plugin-specification.md](docs/design/ingestion-plugin-specification.md)
- D4: [D4_own-storm-generator.md](docs/features/D4_own-storm-generator.md), `plugins/generations/content-gen/src/storm.ts`, `src/index.ts`
- Contrast instance: `plugins/ingestions/karakeep-local/src/index.ts`
- Contracts: `packages/kk-core/src/schemas.ts`, `packages/kk-core/src/kinds.ts`
- CLI: `docs/04_DESIGN.md` § `executor run` / `plugin status`
- Downstream: 0055 Prototype the STORM research workflow dry-run
- Firecrawl (verify on run day): https://docs.firecrawl.dev/features/search , https://docs.firecrawl.dev/api-reference/introduction , https://docs.firecrawl.dev/api-reference/endpoint/search
### History
- 2026-08-14T04:32:00.765Z todo → wip (system)
- 2026-08-14T04:42:21.697Z wip → testing (system)
- 2026-08-14T04:42:26.067Z testing → done (system)
