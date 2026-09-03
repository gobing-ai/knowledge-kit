---
schema_version: 1
name: "Article generation + publish fan-out incl. podcast show notes"
status: todo
template: feature-impl
created_at: 2026-09-03T04:21:27.667Z
updated_at: "2026-09-03T04:40:24.681Z"
feature_id: F61
dependencies: ["0088"]
---

## 0091. Article generation + publish fan-out incl. podcast show notes

### Background

**Type:** `wayfinder:research` — evidence reading; no production code. Map: feature F61. Blocked by 0088 (needs the gap plan).

**Sharp question:** which generator produces the templated article from core facts (extend `content-gen` vs new `article-gen`), can `podcast-pub` carry the article as episode show notes (decided on map F61: yes — verify the target platform supports it), and what fan-out shape does `docs/design/fan-in-and-fan-out-specification.md` prescribe for the v1 targets (`podcast-pub` + `surfdash-pub`)?

**Platform scope:** v1 article platform = **surfdash only** (map F61 decision); note how additional `*-pub` plugins would slot in later, but do not design for them.

### Requirements

- [ ] R1. Article generator home decided (extend `content-gen` vs new plugin) with the template approach named.
- [ ] R2. `podcast-pub` show-notes capability verified against its target platform; the gap named if missing.
- [ ] R3. Publish fan-out shape recommended (one kk fan-out subcommand vs sequential states) for v1 targets `podcast-pub` + `surfdash-pub`, with a note on how more `*-pub` plugins slot in later.

### Acceptance Criteria

- [ ] R1–R3 answered with file-level evidence in `## Solution`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T04:40:24.496Z

- Closed 2026-09-02 (operator): v1 article platform = surfdash only; podcast carries the article as show notes. Remaining unknown — whether microfeed supports show notes — is R2's investigation, not an open decision.

### Design

**WHAT:** three evidence-backed answers — (a) article generator home: extend `content-gen` vs new `article-gen`; (b) `podcast-pub` show-notes capability against its target (self-hosted microfeed REST API — verified 2026-09-02: `plugins/publishings/podcast-pub/plugin.json`, item ops in `src/map.ts`); (c) fan-out shape for the v1 targets `podcast-pub` + `surfdash-pub` per `docs/design/fan-in-and-fan-out-specification.md`.

**WHY:** locks the publish half of the extended workflow before implement tasks graduate.

**Assumes from deps:** 0088's dispositions for article generation and publish steps. Conflicts surface to map F61; no silent re-ownership.

**WHERE — frozen read set (verified present 2026-09-02):** `plugins/generations/content-gen/plugin.json` + `src/` surface (STORM pipeline: curation, outline, article, polish); `plugins/publishings/podcast-pub/{plugin.json, src/map.ts}` + `docs/design/podcast-pub.md`; `plugins/publishings/surfdash-pub/`; `docs/design/publish-plugin-specification.md`; `docs/design/fan-in-and-fan-out-specification.md`.

**Deliverable contract — `## Solution` carries three named subsections:** `Article generator home` · `Podcast show-notes capability` · `Fan-out shape (v1: podcast-pub + surfdash-pub)`.

**Anti-patterns:** do not design for platforms beyond surfdash (map decision — note only how extra `*-pub` plugins slot in); no code changes; no template authoring (that is 0090's downstream).

**Handoff:** implement tasks graduated after this ticket consume the three answers verbatim.

### Plan

- [ ] 1. Claim after 0088 is done; read its Solution dispositions first. (dep)
- [ ] 2. Read content-gen surface; decide extend-vs-new with rationale. (R1)
- [ ] 3. Read podcast-pub transport + microfeed item ops; verify show-notes/description support; name the gap if missing. (R2)
- [ ] 4. Read surfdash-pub + publish spec; recommend the fan-out shape for the two v1 targets. (R3)
- [ ] 5. Write `## Solution` per the deliverable contract. (R1–R3)

Verification intent: `spur task check 0091` clean; reviewer confirms all three contracted subsections exist with file-level evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Map: `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`
- `docs/design/publish-plugin-specification.md` · `docs/design/podcast-pub.md` · `docs/design/fan-in-and-fan-out-specification.md`
- Depends on: 0088 (dispositions)

### History
