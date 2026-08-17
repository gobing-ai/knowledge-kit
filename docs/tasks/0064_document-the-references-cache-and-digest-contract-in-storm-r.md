---
template: meta
schema_version: 1
name: "Document the references cache and digest contract in storm-research SKILL.md"
description: ""
status: done
type: meta
profile: standard
feature_id: C5
parent_wbs: null
priority: P2
tags: ["storm-research", "docs"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T03:35:23.273Z"
updated_at: "2026-08-17T03:51:40.644Z"
---

## 0064. Document the references cache and digest contract in storm-research SKILL.md

### Background

Implements: C5 R8 — The works layout and skill document the references cache and digest contract.

Shipping obligation for C5 (design §0, §5, ADR-013): amend the storm-research SKILL.md 0056 tables — add the references/ works-layout row (written by ingest; audit trail + render-tail resolution target), the markitdown fail-loud row (live mode requires the binary), and the digest-don't-index practice under Better-report. Single owner of the SKILL.md file surface, keeping code diffs clean.

Lands last in the C5 batch — it documents the ingest and report-craft changes.
Rubric: E1 D1 L1 C0 R0 = 3 → task (kept: R8 is @core and needs AC coverage; folding it into a code task would mix docs into the code diff — rejected).

### Requirements
- [x] R1. Add the references/ row to the `## Works layout (0056, frozen)` table — written by ingest (web-search live path); consumed as audit trail and the render tail's resolution target.
- [x] R2. Add the markitdown row to the `## Fail-loud table` — live mode requires the binary on PATH; missing → exit 1 naming markitdown, no docs.json.
- [x] R3. Add the digest-don't-index practice under `## Better-report practices` — references are evidence, not the deliverable; the report states conclusions.
- [x] R4. Amend the works-layout invariant (SKILL.md:166, "do not rename or add sidecars") with the ADR-013 exception for references/ — otherwise the new row contradicts the skill's own invariant.

Non-goals: no other SKILL.md sections touched; no 05-features status flip (wrap owns that); no code changes (0062/0063 own those).
### Acceptance Criteria
```gherkin
Feature: STORM research workflow evidence hardening

  @core
  Scenario: R1 — [doc-only] The works layout and skill document the references cache and digest contract
    Given the C5 change lands
    When the 0056 works-layout table and storm-research SKILL.md are read
    Then references/ is listed in the layout and the skill records the digest-don't-index practice

  @core
  Scenario: R2 — [doc-only] SKILL.md fail-loud table documents the markitdown requirement
    Given the storm-research SKILL.md
    When the fail-loud table is read
    Then a row states live mode requires markitdown on PATH, and a missing binary exits 1 naming markitdown with no docs.json written

  @core
  Scenario: R3 — [doc-only] SKILL.md records the digest-don't-index practice
    Given the storm-research SKILL.md
    When the better-report practices are read
    Then references are framed as evidence, not the deliverable — the report states conclusions

  @core
  Scenario: R4 — [doc-only] The works-layout invariant carries the ADR-013 references/ exception
    Given the SKILL.md invariant that sidecars must not be renamed or added
    When the references/ cache row is read
    Then an explicit ADR-013 exception accompanies it so the row does not contradict the invariant
```

- **Feature AC match?** Closed: feature scenario R8 is carried verbatim as task-local R1
  (`ac_numbering: task-local`); `normalizeTitle` strips the prefix, so feature traceability is
  unaffected. R2–R4 split the doc-only umbrella into per-requirement scenarios.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT/WHY** — Docs half of C5 (ADR-013, satellite §0/§5): the skill must teach what 0062/0063 ship. Single file surface: `plugins/kk/skills/storm-research/SKILL.md`.

**Frozen edit targets** (verified against current tree):
- `## Works layout (0056, frozen)` table (SKILL.md:96) — add the `references/` row; the heading's "frozen" marker gains the ADR-013 amendment note.
- `## Fail-loud table (0056 rows the agent must execute)` (SKILL.md:125) — add the markitdown row.
- `## Better-report practices (R1)` (SKILL.md:140) — add digest-don't-index.
- `## Invariants` (SKILL.md:158–166) — the "do not rename or add sidecars" line (:166) gains the ADR-013 exception for `references/`; without it the new layout row contradicts the skill's own invariant.

**Anti-patterns:** do not document unshipped behavior verbatim as if live before 0062/0063 land (this task is sequenced last); do not add new sections — four existing edit points only; do not touch `docs/05_FEATURES.md` (wrap-step owns status).
### Plan
1. Confirm 0062 and 0063 have landed (this task documents shipped behavior — satellite §0).
2. SKILL.md works-layout table: add `references/<doc-id>.md` row (writer: ingest live path; contents: normalized full content, filename = Doc id) + ADR-013 amendment note on the frozen marker (R1).
3. Fail-loud table: add the markitdown row (R2).
4. Better-report practices: add digest-don't-index (R3).
5. Invariants: carve the ADR-013 exception into the sidecars line (R4).
6. Verify: `spur task check 0064` clean; read the rendered SKILL.md table rows once for formatting.
### Solution
Single file surface: `plugins/kk/skills/storm-research/SKILL.md` (181 lines now, was 166). Four frozen edit points, no new sections, no code changes:

1. **R1 — works layout:** heading `## Works layout (0056, frozen)` → `(0056, frozen; ADR-013 adds `references/`)`; added table row `references/<doc-id>.md` (written by ingest live path; contents = normalized full content via `/v2/scrape` → markitdown, file name = Doc id; audit trail + citation-resolution target). Matches 0062's shipped `scrapeAndCacheDocs` (web-search src/index.ts:246).
2. **R2 — fail-loud:** added row — `markitdown` missing from PATH (live mode) → ingest exit 1 with stderr `web-search failed: markitdown is not on PATH`, probed before any network call, no docs.json; recovery = install markitdown / re-run. Matches the shipped PATH probe (web-search src/index.ts:385).
3. **R3 — better-report practice 7 "Digest, don't index":** references are evidence, not the deliverable; synthesize/compare/state conclusions, never list sources one per line; render drops the `## Outline` replay (ADR-013 D7); references tail + cache files are the audit trail behind each cite id. Matches 0063's article-stage prompt mandate (storm.ts:245) and render-md outline-drop.
4. **R4 — invariants:** amended the sidecars line with the ADR-013 exception for `references/<doc-id>.md`, so the new layout row no longer contradicts the invariant.

Verified against shipped code, not the design doc prose (both had landed: 0062, 0063 done). No exact-string cross-references to the old heading exist outside the task file.
### Testing
Coverage: N/A (documentation-only change; no runtime code path added).

**Re-verification (--auto --force --focus all, 2026-08-16):** verdict re-derived against the current working tree holding the uncommitted C5 changes (SKILL.md +8/−1; storm-evidence-cache.md status flips only). Every documented claim traced to shipped source. `bun run lint` exit 0 (markdown not linted; host gate green).

**Verdict: PASS** — all requirements and all AC scenarios MET on the current tree. Artifact: `.spur/run/0064-verdict.json` (overwritten this pass). AC scenarios renumbered task-local 2026-08-16 (feature C5 AC extended R16–R18 to cover the per-requirement doc scenarios; the umbrella scenario's title text is unchanged, so normalized-title traceability is preserved).

| Req | Status | Evidence |
|-----|--------|----------|
| R1 works-layout `references/` row | MET | SKILL.md:96 heading amendment + :108 row; matches `scrapeAndCacheDocs` (web-search src/index.ts:246; cacheDir :247, `${doc.id}.md` :256, live-path-only call :390) |
| R2 fail-loud markitdown row | MET | SKILL.md:137; matches PATH probe src/index.ts:385-387 before `searchFirecrawl` (:389) and any write (:396); stderr `web-search failed: markitdown is not on PATH`, exit 1 (:398-400) |
| R3 digest-don't-index practice | MET | SKILL.md:159-162 practice 7; matches storm.ts:245 article mandate and render-md.ts:10,15 (`outline` ignored, ADR-013 D7) |
| R4 invariant ADR-013 exception | MET | SKILL.md:172-173; no self-contradiction with the new layout row |

| AC | Status | Evidence |
|----|--------|----------|
| Scenario: R1 — [doc-only] The works layout and skill document the references cache and digest contract | MET | references/ in works-layout table (SKILL.md:108) + digest-don't-index practice (SKILL.md:159-162); single-file surface held |
| Scenario: R2 — [doc-only] SKILL.md fail-loud table documents the markitdown requirement | MET | SKILL.md:137 fail-loud row matches src/index.ts:385-387 PATH probe ahead of `searchFirecrawl` (:389) and any write (:396): exit 1, stderr names markitdown, no docs.json |
| Scenario: R3 — [doc-only] SKILL.md records the digest-don't-index practice | MET | SKILL.md:159-162 practice 7 matches storm.ts:245 article-stage mandate and render-md.ts:10,15 outline drop (ADR-013 D7) |
| Scenario: R4 — [doc-only] The works-layout invariant carries the ADR-013 references/ exception | MET | SKILL.md:172-173 invariant amended with the ADR-013 exception for references/<doc-id>.md; no self-contradiction with the :108 layout row |

| SECUA dimension | Result | Notes |
|-----------------|--------|-------|
| Correctness of claims | PASS | All four edit points faithful to current source |
| Staleness / contradictions | PASS | Design-doc flip to "shipped 2026-08-16" consistent; invariant amended so no self-conflict |
| Usability for skill consumer | PASS | Rows name exact stderr, probe timing, and recovery |
| P4 carry-over | No action | Practice 7 "never lists sources one per line" vs one-line tail render — scoped by the same paragraph (names the tail as audit trail) |
### Review
**Disposition: PASS** — no blockers. Docs-only diff audited against the shipped code it describes; every factual claim traced.

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | (none) | — |
| P2 | (none) | — |
| P3 | (none) | — |
| P4 | Practice 7 "never lists sources one per line" could be misread against the references tail, which renders one `- <label>` per item — the sentence scopes to the report body and the same paragraph names the tail as the audit trail, so wording nuance only | No action |
| P4 | Fail-loud row's "probed before any network call" is accurate for fetch (counter-asserted in 0062 tests) but the searchFirecrawl key check (index.ts:121) fires earlier when FIRECRAWL_API_KEY is unset | No action — row names markitdown mode precisely |

**Traceability of prose → code:** `references/` row matches `scrapeAndCacheDocs` (web-search src/index.ts:246; `/v2/scrape` → markitdown, file name = Doc id, live path only). Markitdown row matches the PATH probe (src/index.ts:385, exit 1 `web-search failed: markitdown is not on PATH`, no docs.json write). Practice 7 mandate matches storm.ts:245 and the render's ignored-`outline` (render-md.ts:10, ADR-013 D7). Invariant exception resolves the would-be self-contradiction with the frozen sidecar rule. SECUA: no code, no secrets, no surface change. T3: docs describe post-change shape only — no drift.
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-08-16T17:26:16.932Z todo → wip (system)
- 2026-08-16T17:31:54.660Z wip → testing (system)
- 2026-08-16T17:33:09.743Z testing → done (system)
