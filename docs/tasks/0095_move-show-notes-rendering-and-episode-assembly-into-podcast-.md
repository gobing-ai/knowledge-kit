---
schema_version: 1
name: "Move show-notes rendering and episode assembly into podcast-pub"
status: todo
template: feature-impl
created_at: 2026-09-06T14:35:05.214Z
updated_at: "2026-09-06T18:00:20.548Z"
feature_id: L1
priority: P1
tags: ["publish", "podcast-pub", "feature-K"]
---

## 0095. Move show-notes rendering and episode assembly into podcast-pub

### Background

kk-daily-ai-voice inlines show-notes rendering (bun -e with surfing.salty.vip URL construction) and publish-prep episode assembly (audio+cover merge) — but podcast-pub/src/show-notes.ts already exists. Feature L1 D4/R6: the plugin owns its mechanics. ADR-007: kk owns steps, workflow owns orchestration.

### Requirements

R1. podcast-pub gains `operation: 'show-notes'`: renders uniform show notes from plan Doc[] (title, source label, links) — absorbs the workflow's inline bun -e logic including the surfing.salty.vip article-URL construction.
R2. podcast-pub publish performs full episode assembly internally: accepts article Content + audio metadata + cover path via options, builds attachment/duration/show-notes itself — absorbs publish-prep's merge for the podcast seam.
R3. Operation routing follows the existing options.operation pattern (resolveOperation); unknown operations fail loud.
R4. Unit tests cover both operations with fake transport (publish-harness).
R5. No workflow-YAML changes in this task — the workflow switch lands in the YAML task.

### Acceptance Criteria

- [ ] `operation: 'show-notes'` on r6 plan Doc[] produces identical headings to the workflow's inline renderer (byte-diff on fixture)
- [ ] publish with assembly options yields a Result with enclosure + image + duration
- [ ] unknown operation still fails loud
- [ ] existing podcast-pub tests green

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
WHAT: podcast-pub absorbs the two workflow-inline mechanics that are podcast-specific: (1) show-notes GENERATION from plan Doc[] (currently an inline bun -e in the workflow's show-notes state), (2) episode assembly merge (currently publish-prep's inline bun -e). Both become plugin code; the workflow keeps only orchestration calls.

WHY: ADR-019 D4 — target-specific mechanics belong to the target's plugin (ADR-007: kk owns steps, workflow owns orchestration). NOTE (premise corrected at refine): podcast-pub/src/show-notes.ts is the markdown→HTML sanitizer (`renderShowNotesHtml`, design D6.1) — it is NOT the generator. The generator (plan Doc[] → show-notes markdown: `# title` + `## N. <title>` + sourceLabel + links + article URL) lives ONLY in the workflow inline script today. This task writes that generator as plugin code and reuses the existing sanitizer downstream unchanged.

WHERE (frozen):
- `plugins/publishings/podcast-pub/src/show-notes.ts` — add exported `renderShowNotesMarkdown(docs: Doc[], opts: { title: string; runDate: string; articleBaseUrl?: string }): string`. Port the workflow's logic verbatim: slugify(articleTitle) for the article URL (`<articleBaseUrl>/zh/posts/<runDate>-<slug>`, default base `https://surfing.salty.vip`), sourceLabel (metadata.sourceName → hostname strip www. → 来源 fallback), per-item `## N.` sections with link list. Keep `renderShowNotesHtml` untouched.
- `plugins/publishings/podcast-pub/src/index.ts` — extend OPERATIONS with `'show-notes'`: input = plan Doc[] JSON (`--in`), output = markdown file (`--out`); options {title, runDate, articleBaseUrl?}. No microfeed API call in this operation (pure render).
- publish operation: accept additive options {audioFile, coverPath, durationSec} — when present, the plugin assembles the episode itself (absorbing publish-prep's article+audio merge for the podcast seam); absent → today's behavior unchanged.
- `resolveOperation` (index.ts:50) routes both; unknown operations keep failing loud.

Precedence: publish options are additive/optional — the existing Content→episode mapping (map.ts) is the fallback when assembly options are absent.

Anti-patterns: no microfeed calls in show-notes render; no HTML in the markdown generator (sanitizer owns that); no breaking change to existing publish contract; no new config keys.

Handoff: 0097 replaces the workflow's show-notes bun -e with `kk executor run podcast-pub` (operation show-notes) and slims publish-prep. Docs: 04_DESIGN.md podcast-pub operations section.
### Plan
1. Read workflow inline show-notes bun -e (kk-daily-ai-voice.yaml:202-208) + publish-prep (209-215) + existing renderShowNotesHtml + map.ts.
2. Implement renderShowNotesMarkdown in show-notes.ts (verbatim port of the inline logic).
3. Extend OPERATIONS + resolveOperation + PodcastPubOptions for 'show-notes' (pure render, --in plan docs, --out markdown).
4. Extend publish with additive assembly options {audioFile, coverPath, durationSec}.
5. Tests (fake transport via publish-harness): renderShowNotesMarkdown on r6 plan fixture byte-matches the workflow renderer's output (capture current output as golden first); show-notes operation writes file, makes no HTTP calls; publish with/without assembly options; unknown operation fails loud.
6. Sync docs/04_DESIGN.md podcast-pub operations.
7. Verify: bun run lint && bun run test clean. Workflow switch is 0097's job — do not touch YAML here.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
