---
template: feature-impl
schema_version: 1
name: "Implement the live Firecrawl client in web-search"
description: ""
status: done
type: task
profile: standard
feature_id: C4
parent_wbs: null
priority: P1
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T07:25:44.076Z"
updated_at: "2026-08-15T02:43:42.342Z"
---

## 0057. Implement the live Firecrawl client in web-search

### Background
wayfinder:task — C4 Daily-usable STORM research. Independent of 0056/0058/0059.

**Work.** Implement the live Firecrawl HTTP client in `plugins/ingestions/web-search` against the shipped 0054 contract. Today `fixture !== true` exits 1 with `live Firecrawl not implemented in v1`.

**Verified premises (re-checked 2026-08-14 this refine):**
- Contract: `docs/tasks/0054_specify-the-firecrawl-topic-to-doc-ingest-contract.md` Solution blocks 1–8.
- Stub: `plugins/ingestions/web-search/src/index.ts` — `parseInput`, `buildFixtureDocs`, unexported `computeId`, `main`. Live branch at the `if (!input.fixture)` block (lines 118–126).
- Tests: `plugins/ingestions/web-search/tests/web-search.test.ts` — fixture happy path, id stability, maxResults cap, `runInvoke`, live-mode fail-loud (asserts the "not implemented" string), missing topic, `parseInput` edges.
- `computeId` is `sha256(uri).digest('hex').slice(0, 16)` (`index.ts` `computeId`).
- 0054: `POST https://api.firecrawl.dev/v2/search`, `Authorization: Bearer ${FIRECRAWL_API_KEY}`, body `{ query, limit, sources: ["web"], scrapeOptions: { formats: ["markdown"] } }`, map `data.web[]`. `fetch` only. No SDK.
- Fail-loud block 5 is binding. Fixture path must keep working.

**Out of this ticket:** query expansion; config.yaml; workflow YAML (0059 may flip default `fixture`); render helper; skill/command; changing `kindContract`.
### Requirements
- [x] R1. Replace the `fixture !== true` stub with `searchFirecrawl` per 0054 blocks 2–5. Keep `fixture: true` → `buildFixtureDocs` unchanged. Inject `fetch` so CI never hits the network. Tests: live happy path (fake `data.web` with markdown); fixture regression; simulated rows 2–8 of the 0054 fail-loud table that can be faked (missing key, HTTP 401/429, zero hits, partial skip, hits-but-no-bodies, malformed `success:true` with null `data`).
- [x] R2. Missing `FIRECRAWL_API_KEY` on a live run: stderr exactly `web-search failed: FIRECRAWL_API_KEY is unset`, exit 1, no `--out`. Fixture runs do not read the key.
- [x] R3. Export `computeId` (same algorithm) so 0059's local-Doc mapping can stay consistent if a later helper imports it. Do not change the hash.
### Acceptance Criteria
```gherkin
Feature: Live Firecrawl client in web-search

  Scenario: R1 — Live path maps search hits to Docs
    Given a valid --in {topic, maxResults} and fixture not true
    And FIRECRAWL_API_KEY is set
    When the plugin runs with an injected fetch returning data.web markdown
    Then --out is DocListSchema, ids are sha256(url).hex.slice(0,16), and fixture:true still emits canned Docs

  Scenario: R2 — Live path fails loud without a key
    Given fixture is not true and FIRECRAWL_API_KEY is unset
    When the plugin runs
    Then exit is 1, --out is not written, and stderr is "web-search failed: FIRECRAWL_API_KEY is unset"

  Scenario: R3 — computeId stays stable and exported
    Given the same sourceUri
    When computeId is called twice
    Then both results are the same 16-char hex string
```
### Q&A
- **SDK vs fetch?** Closed (0054 + this refine): `fetch` only. No Firecrawl npm package.
- **Retry on 429?** Closed (0054): no silent retry in v1. Exit 1 with status in stderr.
- **Where does fetch get injected?** Closed: `searchFirecrawl(input, deps)` with `deps.fetch` defaulting to `globalThis.fetch` from `main`. Tests pass a fake. Do not monkey-patch globally except as a last resort.
- **Anonymous Firecrawl (no key)?** Closed: still require `FIRECRAWL_API_KEY` (0054 block 2 / row 2). Do not call the API without a key.
- **Amend 0054 if docs drifted?** Closed: re-fetch search + endpoint pages on implement (date the fetch). Amend 0054 Solution in the same commit only if a field/status code contradicts; do not silently change mapping.
- **Workflow fixture default?** Closed: not this ticket. 0059 owns the YAML var. This plugin still treats `fixture === true` as stub.
- **Feature AC match?** Closed: C4 wayfinder-map; task-local AC; DD-09 subset warnings expected.
### Design
**WHAT.** Production code + tests in `plugins/ingestions/web-search`. No contract redesign — 0054 Solution wins.

**WHY.** Daily research is fake on canned Docs. 0054 is already implementable.

**WHERE.**
- `plugins/ingestions/web-search/src/index.ts` — add live path; keep `parseInput` / `buildFixtureDocs` / `main`.
- `plugins/ingestions/web-search/tests/web-search.test.ts` — extend; do not delete fixture tests.
- Optional split `src/firecrawl.ts` only if `index.ts` would exceed ~250 lines. Default: stay in `index.ts`.

**Frozen names.**
- `export function computeId(uri: string): string` — move the existing helper to export (same body).
- `export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>`
- `export interface SearchDeps { fetch: FetchLike; env: Record<string, string | undefined>; now: () => Date }`
- `export async function searchFirecrawl(input: InInput, deps: SearchDeps): Promise<Doc[]>` — throws an `Error` whose `message` is the fail-loud diagnostic (no `--out`). `main` catches, prints `web-search failed: ${message}`, returns 1.
- `main` live branch: if `!input.fixture` then `searchFirecrawl(input, { fetch: globalThis.fetch, env: process.env, now: () => new Date() })` then `DocListSchema.parse` + write `--out`.

**Request (0054 block 3).**
- `POST https://api.firecrawl.dev/v2/search`
- Headers: `Content-Type: application/json`, `Authorization: Bearer ${deps.env.FIRECRAWL_API_KEY}`
- Body: `{ query: input.topic, limit: input.maxResults, sources: ["web"], scrapeOptions: { formats: ["markdown"] } }`

**Doc mapping (0054 block 4).** `id = computeId(url)`; `body` = trimmed `markdown`; `title`; `sourceUri` = `url`; `mediaType` = `text/markdown`; `metadata.query` = topic; `metadata.rank` = 0-based index in `data.web`; `metadata.position` = vendor field when present; `metadata.scraped_at` = `deps.now().toISOString()`.

**Frozen stderr (after the `web-search failed: ` prefix `main` adds).**
- Missing key: `FIRECRAWL_API_KEY is unset`
- Transport/`fetch` throw: `Firecrawl network error: <message>`
- HTTP 401/402/400/404/408/429/5xx or `success:false`: `Firecrawl HTTP <status>: <body error or empty>`
- Malformed 200 (`success:true`, `data` null/absent): `Firecrawl malformed response: data missing`
- Hits but zero usable bodies: `Firecrawl returned hits but no usable markdown bodies`

Zero hits (`data.web` empty/missing under present `data`): return `[]` (exit 0, write `[]`). Partial: skip unusable items, `console.warn` per skip, return the rest.

**Tests (fake fetch only).** Keep existing fixture + `runInvoke` + parseInput tests. Add: live happy path; missing key (R2 string); 401; 429; zero hits writes `[]`; one good + one empty markdown (partial); all empty markdown (exit 1, no `--out`); malformed data. Assert fixture tests never set `FIRECRAWL_API_KEY`.

**Anti-patterns:** no SDK; no key in `--in`/`plugin.json`; no silent retry; do not remove fixture; do not change `kindContract` or 0054 `--in` keys; do not call network in `bun test`.

**Assumes from deps:** none (no `dependencies[]`). **Leaves:** 0059 may default YAML `fixture` to `"false"`; this plugin still honors `fixture: true` for CI.
### Plan
1. Re-read 0054 Solution blocks 1–8 and `plugins/ingestions/web-search/src/index.ts` + tests (R1).
2. Re-fetch https://docs.firecrawl.dev/features/search and the search endpoint page; date the fetch. Amend 0054 only if drifted (Q&A).
3. Export `computeId`; add `FetchLike` / `SearchDeps` / `searchFirecrawl`; wire `main` (R1, R3).
4. Tests for R1/R2 rows with injected fetch; keep fixture + `runInvoke` tests green.
5. `bun test plugins/ingestions/web-search/tests/web-search.test.ts` then `spur task check 0057 --json`.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/ingestions/web-search/src/index.ts:269` |
| `plugins/ingestions/web-search/src/index.ts:43` |
| `plugins/ingestions/web-search/src/index.ts:49` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:157` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:162` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:377` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:381` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:447` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:6` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:94` |
### Testing
**Verdict: PASS** (re-verify `--force` 2026-08-14)

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/ingestions/web-search/src/index.ts:78-178` `searchFirecrawl` — POST `https://api.firecrawl.dev/v2/search` (`:87-99`), Bearer from `deps.env.FIRECRAWL_API_KEY` (`:79-83,91`), body `{query, limit, sources:["web"], scrapeOptions:{formats:["markdown"]}}` (`:93-98`), `data.web[]` mapped with `computeId(url)` (`:146-170`). `SearchDeps` at `:53-57`; `main` injects `globalThis.fetch` at `:271-275`. Fixture `buildFixtureDocs` still used when `fixture` (`:288-295`). Tests `plugins/ingestions/web-search/tests/web-search.test.ts` — 29 pass this run (live happy path, 401, 429, transport, zero-hits, partial, all-empty, malformed data, success:false). |
| R2 | MET | `plugins/ingestions/web-search/src/index.ts:79-83` throws `FIRECRAWL_API_KEY is unset`; `main` catch at `:282-284` prefixes `web-search failed: ` and returns 1 (no `--out`). Fixture branch `:288-295` does not read the key. Test asserts exact stderr + exit 1 + no `--out` (this run). |
| R3 | MET | `plugins/ingestions/web-search/src/index.ts:45-47` `export function computeId` — `sha256(uri).digest('hex').slice(0, 16)`. Test asserts `/^[0-9a-f]{16}$/` and stability (this run). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — Live path maps search hits to Docs | MET | test | `NODE_ENV=test bun test plugins/ingestions/web-search/tests/web-search.test.ts` — 29 pass / 0 fail this run (live happy path + fixture regression). |
| Scenario: R2 — Live path fails loud without a key | MET | test | Same file — R2 test: exit 1, no `--out`, stderr `web-search failed: FIRECRAWL_API_KEY is unset`. |
| Scenario: R3 — computeId stays stable and exported | MET | test | Same file — R3 test: same 16-hex for same uri. Export at `plugins/ingestions/web-search/src/index.ts:45`. |

**SECUA Review**

No P1–P3. Secrets stay env-only. No silent 429 retry (`:112-114`).

**design-conformance:** DONE — frozen names `searchFirecrawl`, `FetchLike`, `SearchDeps`, `computeId` match Design.

Coverage: `plugins/ingestions/web-search/src/index.ts` 100% funcs / 99.50% lines this run.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Usability | plugins/ingestions/web-search/src/index.ts:114 | Non-JSON 4xx/5xx error body yields an empty diagnostic: stderr becomes `Firecrawl HTTP 502: ` (trailing space, no body error). 0054 Block 5 says stderr includes status + body error; status is present so this is acceptable, but a gateway HTML body degrades the message. `extractError` could fall back to a truncated body snippet; cosmetic, non-blocking. |
| P4 | Architecture | plugins/ingestions/web-search/src/index.ts:69 | `searchFirecrawl` (≈120 lines) lives in `index.ts` alongside `main`/`parseInput`/`buildFixtureDocs`. Cohesive and within the Design's ~250-line default, but a future split to `src/firecrawl.ts` would isolate the transport concern. Advisory only; not warranted for this diff. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `src/index.ts:69-191` — `searchFirecrawl` implements the live path per 0054 Blocks 2–5 (one `POST /v2/search`, Bearer auth, `scrapeOptions.formats:["markdown"]`, `data.web[]` mapping). `SearchDeps` (`:49-56`) injects fetch/env/now; `main` passes `globalThis.fetch` (`:277`). Fixture path `buildFixtureDocs` (`:196-215`) unchanged. Tests `tests/web-search.test.ts:94-382` cover happy path, 401, 429, zero-hits, partial skip, all-empty, malformed data, transport error. |
| R2 | MET | `src/index.ts:74-77` throws `FIRECRAWL_API_KEY is unset`; `main:292` prefixes `web-search failed: ` and returns 1. Fixture branch (`:283`) never reads the key. Test `tests/web-search.test.ts:157-186` asserts exact stderr string, exit 1, and no `--out`. |
| R3 | MET | `src/index.ts:44` — `export function computeId` (same `sha256(url).hex.slice(0,16)` algorithm, unchanged). Test `tests/web-search.test.ts:378-382` asserts 16-char hex + stability + differentiation. |

**Design conformance:** All frozen names implemented exactly — `computeId` exported, `FetchLike`/`SearchDeps`/`searchFirecrawl` signatures match `### Design`; request body and Doc mapping match 0054 Blocks 3–4; no scope creep; `kindContract`/`--in` keys untouched. DONE.

**SECUA:** Security — key read from `process.env` only, never logged or written to `--in`/`--out`; fixture never a secret channel. Efficiency — single HTTP call per 0054; `res.text()` read once before status check. Correctness — all 8 fail-loud rows implemented with matching exit/`--out` semantics; `data.web ?? []` (row 6), `docs.length===0 && skipped>0` (row 8) edge handled; `Doc` mapping schema-valid against `DocSchema` (`packages/kk-core/src/schemas.ts:4-11`). Usability — fail-loud messages actionable; injected-fetch keeps CI offline. Architecture — thin C1-compliant boundary, `SearchDeps` seam well-placed for testability (100% func coverage).

**Residual risk:** No blockers/majors. (1) Live behavior unverified against the real Firecrawl API (tests use fakes by design); first live call may surface an undocumented response shape — worth one manual smoke run with a real key before feature ship. (2) 0054 row 4 distinguishes 401/402 but both map to the same generic `Firecrawl HTTP <status>` message; acceptable v1, revisit if operators need distinct diagnostics. (3) `extractError` empty on non-JSON bodies (P4 above).

**Disposition:** APPROVE — no P1–P3 findings; all requirements MET; design conforms; tests independently re-run green (29 pass, 100% funcs / 99.50% lines on `index.ts`).
### References
- Feature [C4](../features/C4_daily-usable-storm-research.md)
- Contract: [0054](0054_specify-the-firecrawl-topic-to-doc-ingest-contract.md) Solution blocks 1–8
- Plugin: `plugins/ingestions/web-search/src/index.ts`, `tests/web-search.test.ts`
- C1: `docs/design/ingestion-plugin-specification.md` §1.3 secrets, §2.4 fail-loud
- Firecrawl (re-fetch on implement): https://docs.firecrawl.dev/features/search · https://docs.firecrawl.dev/api-reference/endpoint/search
### History
- 2026-08-14T21:55:14.286Z todo → wip (system)
- 2026-08-14T22:01:36.928Z wip → testing (system)
- 2026-08-14T22:01:37.357Z testing → done (system)
