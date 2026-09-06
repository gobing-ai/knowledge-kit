---
schema_version: 1
name: "Add annotate pass to episode-plan-gen (MECE category + 4-dim scores)"
status: todo
template: feature-impl
created_at: 2026-09-06T14:35:05.189Z
updated_at: "2026-09-06T17:57:50.090Z"
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

- [ ] fixture blended set (r6 real data) yields category + scores on every doc
- [ ] same input twice → byte-identical annotation
- [ ] all scores within 0–5; every doc has exactly one category
- [ ] existing 16 episode-plan-gen tests + fdf3905 gates still pass
- [ ] rubric documented in docs/design/episode-plan-gen.md

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
