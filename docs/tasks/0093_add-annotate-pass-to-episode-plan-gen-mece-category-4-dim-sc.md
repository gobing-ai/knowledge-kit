---
schema_version: 1
name: "Add annotate pass to episode-plan-gen (MECE category + 4-dim scores)"
status: done
template: feature-impl
created_at: 2026-09-06T14:35:05.189Z
updated_at: "2026-09-07T21:27:38.534Z"
feature_id: L1
priority: P1
tags: ["generator", "episode-plan-gen", "feature-K"]
---

## 0093. Add annotate pass to episode-plan-gen (MECE category + 4-dim scores)

### Background

Dogfood r4 (2026-09-06): plan selection was opaque — 10/15 slots went to stale archives because there was no explicit category/score model. fdf3905 added gates; Feature L1 D2 makes understanding first-class: annotate every candidate BEFORE selection. Implements Feature L1 scenario R3.

### Requirements

R1. Every blended doc gets metadata.category ∈ {ai-news, ai-technical, ai-research, ai-industry, non-ai} — exactly one, MECE, deterministic tag/source/title-signal mapping.
R2. Every doc gets metadata.scores {quality, importance, urgency, impact}, each integer 0–5 per a documented rubric (docs/design/episode-plan-gen.md).
R3. Annotate is deterministic: same input → same output, no LLM.
R4. Annotate drops nothing; existing gates (freshness ≤7d, per-source cap 5, tag denylist) keep running after annotation.
R5. Rubric + taxonomy documented in docs/design/episode-plan-gen.md with 'v1, tune later' annotation.

### Acceptance Criteria

```gherkin
Feature: Add annotate pass to episode-plan-gen (MECE category + 4-dim scores)

  Scenario: Every blended candidate is annotated with category and dimension scores
    Given the r6 real blended fixture set
    When planEpisode annotates every candidate before the gates
    Then every doc carries exactly one MECE metadata.category and integer 0-5 scores
    And the same input twice yields byte-identical annotation
    And the existing 16 episode-plan-gen tests and fdf3905 gates still pass
    And the rubric is documented in docs/design/episode-plan-gen.md
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

WHAT: episode-plan-gen gains an annotate pass inside `planEpisode` (index.ts:167) that runs on every blended doc BEFORE `passesGates` (index.ts:59). Each doc's metadata gains `category` (one of the MECE taxonomy) and `scores` (4 dimensions, 0–5). Annotate drops nothing — gates/caps/dedup keep their current behavior.

WHY: ADR-019 D2 — understanding (annotate) and selection (filter) are one cohesive pass over the same array in one plugin; a second plugin would split the module and double the discovery surface. Deterministic heuristics only — r5 (2026-09-06) proved LLM-written JSON in the plan seam is fragile.

WHERE (frozen):

- `plugins/generations/episode-plan-gen/src/index.ts` — new exported pure functions `classifyCategory(doc: Doc): Category` and `scoreDimensions(doc: Doc): DimensionScores`; called in the planEpisode loop before passesGates. Types: `type Category = 'ai-news' | 'ai-technical' | 'ai-research' | 'ai-industry' | 'non-ai'`; `interface DimensionScores { quality: number; importance: number; urgency: number; impact: number }`.
- Taxonomy constants at module top beside SOURCE_BASE (index.ts:20-34): `TAG_CATEGORY` (tag→category map), `CATEGORY_KEYWORDS` (title/body signal lists), `NON_AI_SOURCES` (default-deny source list).
- `docs/design/episode-plan-gen.md` — new rubric section (exists, add section; do not create a new satellite).

Precedence in classifyCategory (first match wins):

1. metadata.tags hit in TAG_CATEGORY (e.g. `ai-news`→ai-news, `research`/`paper`→ai-research, `tutorial`/`guide`→ai-technical, geopolitics/military-conflict/war→non-ai)
2. title+first-200-chars-of-body keyword scan: technical terms (API, tutorial, benchmark, architecture) → ai-technical; launch/release/announce verbs + product names → ai-news; company/funding/policy → ai-industry
3. default `non-ai`

Dimension rubric v1 (all deterministic; document as "v1 — tune later"):

- quality: 1 + min(4, round(body.length / 1500)) — longer sourced pieces score higher; +1 if sourceUri present (cap 5)
- importance: SOURCE_BASE-derived: aihot→4, rss→3, hackernews→3, others→2; +1 if metadata.relevance_score ≥ 0.8 (cap 5)
- urgency: from docTimestamp (index.ts:42) vs planDate: same-day→5, ≤2d→4, ≤7d→3, older→1; undated→3 (curated same-day sources)
- impact: engagement-based: engagementScore (index.ts:127) mapped log10 max>1000→5, >100→4, >10→3, >1→2, else 1

Anti-patterns: no LLM calls; no new plugin; no dropping in annotate; no config file for the rubric (constants stay greppable in index.ts); scores are integers 0–5, not the 0–100 planScore scale (planScore stays for ranking; scores are for QC thresholds).

Handoff: 0094 consumes `category` + `scores` in filter mode. 0097 maps the quality-control-content state.

### Plan

1. Read current planEpisode + gates (index.ts:59-66, 167-253) and the r6 fixture at .spur/run/daily-dogfood-20260906/1-ingest/blended.json for real tag/source shapes.
2. Define `Category`, `DimensionScores`, TAG_CATEGORY / CATEGORY_KEYWORDS / NON_AI_SOURCES constants with doc comments.
3. Implement `classifyCategory` with the 3-step precedence; unit-test each precedence level + default.
4. Implement `scoreDimensions` per the v1 rubric; unit-test bounds (0–5), determinism, and the engagement/relevance edge cases.
5. Wire both into planEpisode before passesGates; assert annotate changes no existing selection outcome (16 existing tests must stay green unmodified).
6. Add the rubric section to docs/design/episode-plan-gen.md; sync docs/04_DESIGN.md if env/surface changed (it does not — annotate is unconditional).
7. Verify: bun run lint && bun run test clean; replay r6 blended.json, confirm every output doc carries category + scores.

### Solution

Annotate pass implemented per the frozen WHERE list — exported pure `classifyCategory` + `scoreDimensions`, taxonomy constants beside `SOURCE_BASE`, wired into the `planEpisode` loop before `passesGates`. No LLM, no new plugin, nothing dropped, selection behavior unchanged (16 existing tests green unmodified).

- `plugins/generations/episode-plan-gen/src/index.ts:36-122` — taxonomy constants beside `SOURCE_BASE`: `Category` / `DimensionScores` types (`index.ts:43-52`), `TAG_CATEGORY` tag→category map (`index.ts:54-64`), `NON_AI_SOURCES` default-deny set, `polymarket` (`index.ts:67`), `CATEGORY_KEYWORDS` ordered technical→news→industry signal lists (`index.ts:70-119`), `IMPORTANCE_BASE` / `DEFAULT_IMPORTANCE` source tiers (`index.ts:121-122`).
- `plugins/generations/episode-plan-gen/src/index.ts:215-295` — `maxEngagement` extracted from `engagementScore` (pure internal refactor; `planScore` output identical), `matchesKeyword` (Latin whole-word boundary + common inflections so `launch` still hits `launches`/`launched`/`launching` and `fine-tun` hits `fine-tuning`, but `cli` never hits `client`; CJK substring), exported `classifyCategory` (`index.ts:247`) with precedence tag-map → non-AI source deny → title + first-200-chars body-head keyword scan → default `non-ai`, and exported `scoreDimensions` (`index.ts:272`) implementing the v1 rubric (quality length+sourced cap 5, importance tier+relevance≥0.8 cap 5, urgency same-day 5 / ≤2d 4 / ≤7d 3 / older 1 / undated 3 via UTC day floors, impact log-magnitude tiers >1000/>100/>10/>1). `planDate` is REQUIRED (verify-stage P3-2 fix) — `scoreDimensions` is a pure function of (doc, planDate) and `planEpisode` passes its resolved date (`index.ts:341`), so the same input always yields the same output (R3 determinism; no wall-clock default). 0094 consumes a deterministic API.
- `plugins/generations/episode-plan-gen/src/index.ts:326-344` — `planEpisode` loop: every blended doc is annotated (`metadata.category` + `metadata.scores`) BEFORE `passesGates`; the gate now reads the annotated copy. Annotate drops nothing — freshness/tag gates, URL/title dedup, per-source cap, and `planScore` all behave exactly as before; annotated fields flow to output through the existing metadata spread.
- `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:248-565` — 17 annotate tests across four describes: classify precedence levels + default + whole-word boundary collision cases (`:248`), rubric bounds/determinism/engagement+relevance edges (`:388`), planEpisode wiring — every survivor carries category + integer 0–5 scores, byte-identical rerun, geopolitics gate still applies after annotation (`:447`), real-r6 fixture replay (`:525`). The 16 pre-existing tests are untouched. Verify-stage additions: the keyword-boundary collision test locks the review P3-1 fix, and every `scoreDimensions` call passes the now-required `planDate`.
- `docs/design/episode-plan-gen.md:45-73` — "Annotate (category + dimension scores) — v1, tune later" rubric section (taxonomy precedence + 4-dim rubric; keyword-boundary and `scoreDimensions` purity notes added at verify), plus Surface rows (`docs/design/episode-plan-gen.md:22-24`) and selection-metadata rows (`docs/design/episode-plan-gen.md:87-88`). Verify stage also repaired the pre-existing drift: the Scoring section now matches the current `planScore` formula (`docs/design/episode-plan-gen.md:36-43`) and the `cleanBody`/`normalizeUrl` Surface rows describe actual behavior. No satellite doc; `docs/04_DESIGN.md` needs no sync (annotate is unconditional, no env/surface change).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Exactly one metadata.category per blended doc from the MECE set {ai-news, ai-technical, ai-research, ai-industry, non-ai} — TAG_CATEGORY + matchesKeyword/classifyCategory (plugins/generations/episode-plan-gen/src/index.ts#7CFB :274-298, table :63-89 post-0099 expansion) |
| R2 | MET | metadata.scores {quality, importance, urgency, impact}, integer 0-5 per documented rubric docs/design/episode-plan-gen.md:51 |
| R3 | MET | Deterministic, no LLM — pure classification functions index.ts#7CFB :274-298 wired in planEpisode :364-381; determinism asserted by unit tests :395-443 |
| R4 | MET | Annotate drops nothing; freshness <=7d, per-source cap 5, tag denylist run after annotation in the select leg (planEpisode :364-381) |
| R5 | MET | Rubric + taxonomy documented in docs/design/episode-plan-gen.md:51 with 'v1, tune later' annotation |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — Every blended candidate is annotated with category and dimension scores | MET | command | bun test plugins/generations/episode-plan-gen → 53 pass / 0 fail (this session); annotate paths :255-360/:361/:395-443/:475-499 exercised |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope:** 0093 annotate-pass diff only — `plugins/generations/episode-plan-gen/src/index.ts`, `plugins/generations/episode-plan-gen/tests/` (incl. new `fixtures/r6-blended.json`), `docs/design/episode-plan-gen.md`. apps/cli fan-in + 0092/0094–0098 excluded per run scope.
**Dimensions:** functional traceability, SECUA, architecture. Fresh evidence this review run: `bun test plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts` → **32 pass / 0 fail**, 215 expect() (coverage: src/index.ts 100% funcs / 97.37% lines, uncovered 471–483 = CLI error paths only); `bun run lint` → exit 0. Fixture `tests/fixtures/r6-blended.json` verified 15 docs, semantically identical to `.spur/run/daily-dogfood-20260906/1-ingest/blended.json`.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | correctness | `plugins/generations/episode-plan-gen/src/index.ts:232-234` | `matchesKeyword` Latin match is word-start-only (`\bword`), so short keywords prefix-over-match: `cli` hits "client(s)", `ships` hits "shipments" — deterministic category bias toward ai-technical/ai-news. Acceptable for v1 ("tune later"); tighten the boundary in v2 tuning. |
| P3 | usability / determinism | `plugins/generations/episode-plan-gen/src/index.ts:264,276` | `scoreDimensions(doc, planDate?)` defaults planDate to `new Date()` — direct callers that omit it get day-dependent urgency (R3's same-input→same-output holds only when planDate is passed; `planEpisode` always passes it, `index.ts:331`). Make it required or document the purity contract before 0094 consumes scores directly. |
| P4 | documentation | `docs/tasks/0093_add-annotate-pass-to-episode-plan-gen-mece-category-4-dim-sc.md` (Solution) | Solution test anchors stale: cites describes at `:324`/`:381`; actual describe starts are `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:356` (scoreDimensions rubric) and `:413` (wiring). All other Solution anchors re-verified fresh this run; content accurate. |
| P4 | design-conformance | task Design vs `plugins/generations/episode-plan-gen/src/index.ts:67,242-262` | classifyCategory precedence implemented as 4 steps (tags → `NON_AI_SOURCES` deny → keywords → default) vs task Design's 3-step list; documented in Solution + `docs/design/episode-plan-gen.md:47-58` and locked by tests (`tests/episode-plan-gen.test.ts:268,323`) → CHANGED, acceptable. |
| P4 | efficiency | `plugins/generations/episode-plan-gen/src/index.ts:234` | `new RegExp` compiled per keyword per call (~35 words × docs); negligible at current scale — precompile at module load if doc volume grows. |
| P4 | correctness | `plugins/generations/episode-plan-gen/src/index.ts:267` | quality uses the raw (pre-`cleanBody`) body length — star ratings/heading copies marginally inflate the length tier; deterministic and immaterial; consider cleaned body during v2 tuning. |
| P4 | documentation | `docs/design/episode-plan-gen.md:24,25,38-43` (pre-existing, outside this diff) | Surface rows understate `cleanBody`/`normalizeUrl` behavior (rating strip; full query-string drop, not just utm_*) and the Scoring section still describes the superseded planScore formula. Not introduced by 0093; fix before 0094 authors rely on them. |

**Verdict: PASS** — R1–R5 all MET; 0 blocker / 0 major findings. **Disposition: approve** (gate auto-approved per `--auto`).

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/generations/episode-plan-gen/src/index.ts:242-262` — `classifyCategory` returns exactly one of the closed 5-value `Category` union (`index.ts:43`), tag → source-deny → keyword → default precedence; precedence tests `tests/episode-plan-gen.test.ts:248-354` |
| R2 | MET | `plugins/generations/episode-plan-gen/src/index.ts:264-287` — `scoreDimensions` writes 4 integer 0–5 dims; rubric documented `docs/design/episode-plan-gen.md:59-76`; bounds/edge tests `tests/episode-plan-gen.test.ts:356-411` |
| R3 | MET | Pure functions, no LLM/network; byte-identical reruns incl. real r6 fixture + input non-mutation `tests/episode-plan-gen.test.ts:450-455,521-531` |
| R4 | MET | Annotate runs before any gate and drops nothing: `plugins/generations/episode-plan-gen/src/index.ts:326-335` (annotate → `passesGates(cleaned)`); gates/cap/dedup logic byte-identical in diff; R4 wiring test `tests/episode-plan-gen.test.ts:461-489`; pre-existing 16 tests unmodified (diff is pure additions) |
| R5 | MET | `docs/design/episode-plan-gen.md:45-76` — "Annotate (category + dimension scores) — v1, tune later" with full precedence + 4-dim rubric; surface rows `:21-22`, selection-metadata rows `:83-84` |

#### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Every blended candidate annotated (R3 scenario) | MET | test | `tests/episode-plan-gen.test.ts:435-449,495-519` |
| r6 fixture yields category + scores on every surviving doc | MET | test | `tests/episode-plan-gen.test.ts:495-519` — 4/15 survivors, MECE + integer 0–5; precedence hits asserted (research-paper tag, GPT-6 headline) |
| Same input twice → byte-identical | MET | test | `tests/episode-plan-gen.test.ts:450-455,521-531` |
| All scores 0–5; exactly one category | MET | test | `tests/episode-plan-gen.test.ts:399-411,435-449` |
| Existing 16 tests + gates still pass | MET | command | Fresh this run: `bun test plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts` → 32 pass / 0 fail; `bun run lint` → exit 0 |
| Rubric documented | MET | static | `docs/design/episode-plan-gen.md:45-76` |

#### SECUA + Architecture Notes

- Security: clean — no injection (regex patterns are escaped hardcoded constants; haystack is only the test subject), no secrets, no LLM, no network.
- Architecture: deep pure seams — `classifyCategory`/`scoreDimensions` are exported so 0094 consumes them without reaching into `planEpisode` (ADR-019 D2 cohesion blessed in the design doc); `maxEngagement` extraction (`index.ts:215-226`) is genuine reuse feeding both `engagementScore` and the impact dim; test surface is excellent (pure functions + checked-in real-data fixture, zero mocks). Constants-in-module is a documented tradeoff, not a shallow-module flag.

#### Residual Risk

1. v1 keyword heuristics will misclassify some real items (prefix over-match; 200-char body window); accepted "tune later" — systematic bias propagates into 0094 QC thresholds, mitigated by tag-first precedence on tagged sources.
2. `scoreDimensions` optional planDate is a purity footgun for 0094 direct consumers (P3 above).
3. One historical full-suite run reported a single non-reproducing failure outside episode-plan-gen (Testing section); plugin suite green in every run including this review's — monitor in verify stage.
4. Pre-existing design-doc drift (Scoring / `cleanBody` / `normalizeUrl` rows) may mislead 0094 authors.

**Next:** verify stage may proceed. Non-blocking fix items for verify/v2: (a) tighten `matchesKeyword` word boundary, (b) make `scoreDimensions` planDate required or document the determinism contract, (c) refresh stale Solution anchors + pre-existing design-doc rows (docs hygiene).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-06T22:56:20.801Z todo → wip (system)
- 2026-09-06T23:44:12.068Z wip → testing (system)
- 2026-09-06T23:46:41.808Z testing → done (system)
