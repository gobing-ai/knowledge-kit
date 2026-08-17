---
template: feature-impl
schema_version: 1
name: "Live ingest caches normalized full content per reference"
description: ""
status: done
type: task
profile: standard
feature_id: C5
parent_wbs: null
priority: P2
tags: ["storm-research", "evidence-cache", "web-search"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T03:35:23.255Z"
updated_at: "2026-08-17T03:51:40.261Z"
---

## 0062. Live ingest caches normalized full content per reference

### Background

Implements: C5 R1 — Live ingest scrapes and normalizes full content into a per-reference cache; R2 — Doc bodies use the normalized full content while docs.json stays contract-valid; R3 — A per-URL scrape failure is non-fatal with snippet fallback; R4 — Re-running ingest reuses the cached normalized body; R5 — Live ingest fails loud when markitdown is unavailable; R9 — Fixture mode performs no scrape and needs no key or markitdown; R10 — Live ingest with FIRECRAWL_API_KEY unset fails loud before scraping; R11 — A scrape returning unusable content falls back to the snippet body.

Extends the web-search ingestion plugin live path (design D1–D6, ADR-013): after searchFirecrawl returns Doc[], fetch each source via Firecrawl /v2/scrape with formats: ["markdown"], normalize the HTML with the markitdown binary on PATH, write works/<topic-id>/references/<doc-id>.md (doc id = sha256(sourceUri) 16-hex), and use the normalized text as the Doc body — the Doc[] shape stays unchanged. Cache reuse is file-existence only (no TTL, no query bookkeeping). Scrape and markitdown stay injectable (extend SearchDeps) so unit tests never hit the network or the real binary.

First task in the C5 batch — runs in parallel with the report-craft task; the SKILL.md doc task lands last.
Rubric: E3 D1 L1 C0 R1 = 6 → task (score 5+; cohesive single-file surface — a scrape/cache split from the fail-loud rows would contend over the same file and was rejected).

### Requirements
- [x] R1. Fetch each source's full content via Firecrawl /v2/scrape (POST, Bearer key from FIRECRAWL_API_KEY, formats cover html + markdown), in live mode only.
- [x] R2. Normalize fetched HTML with the markitdown binary and write works/<topic-id>/references/<doc-id>.md (doc id = sha256(sourceUri) 16-hex, existing computeId), creating the references/ dir as a sibling of the --out file.
- [x] R3. Reuse references/<doc-id>.md when it exists — no new /v2/scrape call for that source.
- [x] R4. Use the normalized full content as each Doc body in docs.json; keep the Doc[] shape parseable by DocListSchema.
- [x] R5. On per-URL scrape failure or empty/unparsable content: warn naming the URL, keep the search-snippet body, exit 0, still write docs.json.
- [x] R6. Fail loud in live mode when markitdown is not on PATH: exit 1, stderr names markitdown, no docs.json.
- [x] R7. Fail loud in live mode when FIRECRAWL_API_KEY is unset: exit 1, stderr names the key, no docs.json.
- [x] R8. Fixture mode performs no scrape, no key check, and no markitdown invocation — canned docs unchanged.
- [x] R9. Extend SearchDeps with injectable scrape + markitdown runners and unit-test R1–R8 without network or the real binary.

Non-goals: no cache invalidation/TTL/query-keying (delete the file to refresh — satellite §4 ponytail ceiling); no fixture-path behavior change; no new CLI flags, --in fields, env vars, or packages; render/generator changes are 0063's scope, not this task's.
### Acceptance Criteria
```gherkin
Feature: STORM research workflow evidence hardening

  @core
  Scenario: R1 — Live ingest scrapes and normalizes full content into a per-reference cache
    Given web-search returns a Doc[] whose items carry sourceUri and search-snippet bodies
    And FIRECRAWL_API_KEY is set and markitdown is installed
    When the live ingest runs
    Then each source is fetched via Firecrawl /v2/scrape and normalized with the markitdown binary
    And works/<topic-id>/references/<doc-id>.md exists for every emitted Doc

  @core
  Scenario: R2 — Scraped HTML is normalized with markitdown and cached per reference
    Given a successful /v2/scrape response carrying html and markdown formats
    When the live ingest normalizes a source
    Then the markitdown output is written to references/<doc-id>.md with doc-id = computeId(sourceUri)
    And the references/ directory is created as a sibling of the --out file when missing

  @core
  Scenario: R3 — Re-running ingest reuses the cached normalized body
    Given references/<doc-id>.md already exists for a source and the query is unchanged
    When ingest re-runs for the same topic
    Then the cached file is reused without a new /v2/scrape call for that source

  @core
  Scenario: R4 — Doc bodies use the normalized full content while docs.json stays contract-valid
    Given the references/ cache files exist from the scrape pass
    When docs.json is written
    Then each Doc body is the normalized full content
    And docs.json still parses against DocListSchema with the unchanged Doc[] shape

  @core
  Scenario: R5 — A per-URL scrape failure is non-fatal with snippet fallback
    Given one source URL whose /v2/scrape call fails
    When the live ingest runs
    Then that Doc keeps its search-snippet body and a warning names the failed URL
    And the ingest exits 0 and docs.json is written

  @edge
  Scenario: R5 — A scrape returning unusable content falls back to the snippet body
    Given a source whose scrape returns empty or unparsable content
    When the live ingest runs
    Then that Doc keeps the search-snippet body and the failure is warned, not fatal

  @core
  Scenario: R6 — Live ingest fails loud when markitdown is unavailable
    Given live mode with FIRECRAWL_API_KEY set and no markitdown binary on PATH
    When the ingest runs
    Then it exits 1 with a diagnostic naming markitdown
    And no docs.json is written

  @edge
  Scenario: R7 — Live ingest with FIRECRAWL_API_KEY unset fails loud before scraping
    Given live mode with FIRECRAWL_API_KEY unset
    When the ingest runs
    Then it exits 1 naming FIRECRAWL_API_KEY and writes no docs.json

  @edge
  Scenario: R8 — Fixture mode performs no scrape and needs no key or markitdown
    Given fixture is "true"
    When the ingest runs
    Then it emits the canned docs with no network calls, no FIRECRAWL_API_KEY, and no markitdown invocation

  @edge
  Scenario: R9 — Live ingest is unit-testable without network or the real markitdown binary
    Given SearchDeps carries injected scrape and markitdown runners
    When the web-search suite runs
    Then no network call is made and the real markitdown binary is never invoked
```

- **Feature AC match?** Closed: scenarios carry the feature's titles verbatim with task-local
  R-prefixes (`ac_numbering: task-local`); `normalizeTitle` strips the prefix, so feature
  traceability is unaffected. Two scenarios share R5 because feature R3 (scrape failure) and
  feature R11 (unusable content) both map to task-local R5.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT/WHY** — Extend the web-search live path with a per-reference evidence cache (ADR-013, decisions D1–D6; satellite `docs/design/storm-evidence-cache.md`). After search returns `Doc[]` snippet bodies, a scrape/cache pass replaces each body with markitdown-normalized full content cached at `references/<doc-id>.md`. One owner of the `Doc[]` contract; every pipeline benefits.

**WHERE** — `plugins/ingestions/web-search/src/index.ts` only; tests in `plugins/ingestions/web-search/tests/`.

**Frozen names** (verified against current tree):
- `export type MarkitdownRunner = (html: string) => Promise<string>` — spawns `markitdown -x .html` and pipes HTML to its stdin, returns markdown stdout; non-zero exit or empty output ⇒ throw (unusable content → R5 path). The `-x .html` extension hint is **required**: bare stdin passes HTML through unconverted (verified against markitdown 0.1.4).
- `SearchDeps` (currently `{ fetch, env, now }`, index.ts:53) gains `scrape?: FetchLike` (defaults to `deps.fetch`) and `markitdown?: MarkitdownRunner`.
- New exported seam `scrapeAndCacheDocs(docs: Doc[], deps: SearchDeps, outPath: string): Promise<Doc[]>`; cache dir = `join(dirname(outPath), 'references')` (D6 — no new input surface).
- Doc id: existing `computeId(uri)` (index.ts:45) — sha256 hex prefix 16.
- Scrape call: `POST https://api.firecrawl.dev/v2/scrape`, `Authorization: Bearer ${deps.env.FIRECRAWL_API_KEY}`, body `{ url, formats: ['html', 'markdown'] }` — same request style as the 0057 search call (index.ts:87).
- Normalization precedence: `data.html` present → `deps.markitdown(html)`; else `data.markdown` present → use as-is (already markdown); else unusable → R5 warn path.
- `main()` live branch: probe `markitdown` on PATH (`--version`) before any network call when `deps.markitdown` is absent; probe failure ⇒ `web-search failed: … markitdown …`, exit 1, no `--out` write (R6). Key check stays as-is (index.ts:82, R7). Warn channel: `console.warn('web-search: scrape failed (url=<url>)')` — matches the existing skip-warn style (index.ts:155).

**Algorithm (live path, after search returns docs):** sequential per Doc (deliberate — no parallel fan-out; rate-limit friendly, deterministic): cache file exists → body = file content; else scrape → normalize → `mkdir -p` references dir + write file → body = normalized text; any per-URL throw/empty ⇒ warn + keep snippet body, continue. Result feeds the existing `DocListSchema.parse` + write (invariant 3).

**Anti-patterns (do not implement):** no new npm dependency (markitdown is a probed PATH binary); no TTL/invalidation/query-keyed cache (file-existence reuse only — satellite §4 ponytail ceiling); no new CLI flags/`--in` fields/env vars; no changes to the fixture branch (invariant 4); never let one URL's failure reject the pass (invariant 2); never write docs.json on a fail-loud path.

**Handoff:** 0063 (report craft) assumes only body *provenance* changes — Doc shape untouched; 0064 documents the shipped rows in SKILL.md. No `dependencies[]` edges; 0062 ∥ 0063, 0064 last (decompose ordering).
### Plan
1. Types: add `MarkitdownRunner`; extend `SearchDeps` with `scrape?` + `markitdown?` (R9 seam).
2. Add `markitdown` PATH probe + real runner (spawn, stdin/stdout); wire into `main()` live branch before any network call — fail loud exit 1 naming markitdown, no `--out` write (R6). Key check unchanged (R7).
3. Implement `scrapeAndCacheDocs`: per-Doc cache-existence reuse (R3) → `/v2/scrape` (R1) → markitdown normalization + cache write under `dirname(--out)/references/` (R2) → body swap (R4); per-URL failure ⇒ warn + snippet body (R5).
4. Call it from `main()`'s live branch between `searchFirecrawl` and `DocListSchema.parse` + writeFile (R4).
5. Confirm the fixture branch is untouched (R8).
6. Tests in `plugins/ingestions/web-search/tests/` with injected fakes: scrape success → cache file + body swap; pre-seeded cache → no scrape call; scrape throw/empty → warn + snippet fallback + exit 0; missing markitdown → exit 1, no `--out`; missing key → exit 1; fixture → no fakes invoked (covers R1–R9).
7. Verify: `bun run lint` clean, `bun run test` green.
### Solution
**Change map** (R1–R9, ADR-013 D1–D6):

- `plugins/ingestions/web-search/src/index.ts`
  - `MarkitdownRunner` type (src/index.ts:54) + `realMarkitdown` runner (src/index.ts:71): spawns the absolute `markitdown -x .html` path (resolved via `Bun.which` with an explicit `PATH` option — plain argv[0] lookup can resolve against a startup PATH snapshot), HTML on stdin, markdown on stdout; throws on non-zero exit or empty output (unusable content → per-URL fallback).
  - `SearchDeps` gains `scrape?: FetchLike` (src/index.ts:62, defaults to `deps.fetch`) and `markitdown?: MarkitdownRunner` (src/index.ts:64) — R9 injectable seams.
  - New exported `scrapeAndCacheDocs` (src/index.ts:246): sequential per-Doc pass — cache hit at `dirname(outPath)/references/<doc-id>.md` reuses the file (no scrape, R3/R4); miss → POST `https://api.firecrawl.dev/v2/scrape` (`formats: ['html','markdown']`, Bearer `FIRECRAWL_API_KEY`) → normalize (`data.html` → markitdown; else `data.markdown` as-is; else unusable) → write cache + swap Doc body (R1/R2/R4). Per-URL throw/empty warns `web-search: scrape failed (url=…)` and keeps the snippet body — never fatal (R5/R11, D5). Docs without `sourceUri` pass through; input order and non-body fields untouched.
  - `main()` live branch: markitdown PATH probe (src/index.ts:385) before any network call — missing ⇒ exit 1 `markitdown is not on PATH`, no `--out` (R6). Key check unchanged inside `searchFirecrawl` (R7). `scrapeAndCacheDocs` runs between search and `DocListSchema.parse` + write (src/index.ts:390). Fixture branch untouched (R8).
- `plugins/ingestions/web-search/tests/web-search.test.ts` — 10 new tests (describe at tests/web-search.test.ts:573) + stub-`markitdown` PATH shim and URL-routed `/v2/search` vs `/v2/scrape` fetch mocks. Covers: live scrape→cache→body-swap e2e (R1/R2), pre-seeded cache skips scrape (R3/R4), failed scrape warns + snippet fallback + exit 0 + docs.json written (R5), missing markitdown exit 1 + no docs.json + zero network calls (R6), key unset exit 1 (R7, pre-existing), fixture no-network/no-cache (R8/R9), unit seams for unusable content, transport throw, html-vs-markdown precedence (R11/R9).
### Testing
**Verdict: PASS** (re-verified under `--force` against the uncommitted C5 working tree, 2026-08-16) — all requirements and AC MET with executable test evidence; verify made no code edits.

Independent gates re-run this turn: `bun test plugins/ingestions/web-search` → 44 pass / 0 fail, 158 expects, src/index.ts 100% funcs / 99.64% lines; `bun run lint` exit 0 (biome 99 files + typecheck, 10 workspaces). Verdict artifact: `.spur/run/0062-verdict.json` (rewritten this turn; no fix pass needed — no other .spur/run artifacts touched). AC scenarios renumbered task-local 2026-08-16 (feature C5 AC extended R12/R13 to cover the two task-local scenarios; scenario title text unchanged, so normalized-title traceability is preserved).

| Req | Status | Evidence |
|-----|--------|----------|
| R1 scrape via /v2/scrape (POST, Bearer, html+markdown, live-only) | MET | src/index.ts:269-276, call site :390 (live branch only); tests/web-search.test.ts:591 |
| R2 markitdown normalize + references/<doc-id>.md sibling of --out | MET | src:247 cacheDir, :288 markitdown, :294-295 write; tests:591 |
| R3 cache reuse — no new scrape call | MET | src:256-262 cache-hit branch; tests:623 (scrapeCalls === [b] only); whitespace-miss edge tests:786 |
| R4 normalized body + DocListSchema-valid docs.json | MET | src:296 body swap, :395 `DocListSchema.parse(cached)` gates write; tests:591 |
| R5 per-URL failure: warn naming URL, snippet fallback, exit 0, docs.json written | MET | src:297-300 catch→warn→push snippet; tests:652, 734, 820, 836 |
| R6 markitdown off PATH: exit 1, stderr names markitdown, no docs.json | MET | src:385-388 probe before any network; tests:680 (0 fetch calls), tests:868 |
| R7 key unset: exit 1, stderr names key, no docs.json | MET | pre-existing first gate src:121-124; tests:181 |
| R8 fixture: no scrape/key/markitdown, canned docs unchanged | MET | fixture branch src:403-414 untouched by diff; tests:421 (0 fetch, no references/) |
| R9 injectable SearchDeps.scrape?/markitdown?, hermetic tests | MET | src:62-64 seams; 44 tests / 158 expects, no network, stub-markitdown PATH shim tests:36-48 |

| AC (task scenario) | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R1 — Live ingest scrapes and normalizes full content into a per-reference cache | MET | test | tests:591 scrape → markitdown → references/<doc-id>.md for every Doc |
| Scenario: R2 — Scraped HTML is normalized with markitdown and cached per reference | MET | test | tests:591 markitdown output → references/<doc-id>.md with doc-id = computeId(sourceUri); references/ dir created as sibling of --out (src:247,288,294-295) |
| Scenario: R3 — Re-running ingest reuses the cached normalized body | MET | test | tests:623 pre-seeded cache → zero scrape calls for that source |
| Scenario: R4 — Doc bodies use the normalized full content while docs.json stays contract-valid | MET | test | tests:591 body-swap + DocListSchema.parse(docs.json) |
| Scenario: R5 — A per-URL scrape failure is non-fatal with snippet fallback | MET | test | tests:652 warn names URL, snippet kept, exit 0, docs.json written |
| Scenario: R5 — A scrape returning unusable content falls back to the snippet body | MET | test | tests:706 empty/whitespace payload → warn + snippet; tests:836 success:false |
| Scenario: R6 — Live ingest fails loud when markitdown is unavailable | MET | test | tests:680 exit 1, stderr names markitdown, no docs.json, no network |
| Scenario: R7 — Live ingest with FIRECRAWL_API_KEY unset fails loud before scraping | MET | test | tests:181 exit 1 exact stderr, no --out |
| Scenario: R8 — Fixture mode performs no scrape and needs no key or markitdown | MET | test | tests:421 canned docs, 0 network, no references/ dir |
| Scenario: R9 — Live ingest is unit-testable without network or the real markitdown binary | MET | test | SearchDeps.scrape?/markitdown? injected across the suite (src:62-64); 44 tests / 158 expects hermetic, zero network, stub-markitdown PATH shim tests:36-48 |

SECUA (re-run on current diff): Security — key never logged; spawn via argv array, no shell. Efficiency — sequential per-Doc by design; cache-hit short-circuits. Correctness — per-URL errors contained; order and non-body fields preserved; schema gates write. Usability — fail-loud diagnostics name markitdown / FIRECRAWL_API_KEY; warns name the URL. Architecture — matches ADR-013 D1–D6; no contract change; seams injectable. P3 (accepted by design, D5): cache-read fs errors treated as miss → re-scrape + warn fallback (src:257-265). P4 (note, out of scope): tests override console.warn without restore — no correctness impact.

Coverage: web-search src/index.ts 100% funcs / 99.64% lines (>= 90% gate). Non-goals respected: no TTL/query-keying, no new CLI flags/--in fields/env vars/packages; fixture path unchanged. Design frozen names all present (MarkitdownRunner, realMarkitdown `-x .html`, SearchDeps.scrape?/markitdown?, scrapeAndCacheDocs, D6 cache location, computeId, 0057-style request, normalization precedence, warn channel).

Residual risks: real markitdown conversion quality unverifiable hermetically (first live STORM run post-merge is the true e2e); stale-cache reuse across queries sharing a URL is the documented ceiling (delete the file to refresh).
### Review
**Disposition: PASS** — no blockers. Diff: src/index.ts +125, tests +383; 44/44 tests, 100% lines / 99.64% branches; lint exit 0. Traceability R1–R9 all MET with test evidence.

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | (none) | — |
| P2 | (none) | — |
| P3 | Cache-read errors treated as miss → poisoned cache (EACCES/EISDIR) re-scrapes and warn-falls-back instead of surfacing fs error (index.ts:259) | Accepted by design (D5 self-healing, non-fatal) |
| P3 | Solution section claims "10 new tests"; diff adds 15; task R-numbering offset vs AC numbering (test labels match neither list) | Corpus prose only; coverage correct — no action |
| P4 | tests/{tmp,tmp-stub-bin,tmp-md-stub} not gitignored; SIGKILLed run leaves untracked dirs | Opportunistic; add ignore line if it bites |
| P4 | PATH probe in main() duplicates realMarkitdown's internal Bun.which (~µs) | Keeps seam honest when dep injected; no action |

SECUA: no new deps; kk-core boundary respected; API key never logged; fail-loud paths never write --out; hermetic tests via injected seams. Architecture matches ADR-013 D1–D6. Residual: real markitdown quality unverifiable hermetically (first live STORM run is e2e); stale cache across queries sharing a URL is the documented non-goal ceiling.
### References

C5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-16T16:40:08.846Z todo → wip (system)
- 2026-08-16T16:58:39.730Z wip → testing (system)
- 2026-08-16T16:58:39.977Z testing → done (system)
