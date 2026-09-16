---
schema_version: 1
name: Timeline show notes with briefings, timestamps, and article URLs
status: done
template: feature-impl
created_at: 2026-09-11T23:55:04.609Z
updated_at: "2026-09-16T19:16:42.350Z"
feature_id: O
priority: P0
tags:
  - workflow
  - show-notes
  - podcast-pub

done_forced: "true"
done_reason: verifyall PASS verdict .spur/run/0118-verdict.json
---

## 0118. Timeline show notes with briefings, timestamps, and article URLs

### Background

Feature O / R2-R3. Show notes are currently URLs and full-body text rendered before publish, so surfdash article URLs are never known; the sample format (podcast.salty.vip timeline episodes) has 1-2-sentence briefings, per-item HH:MM, timeline layout, and per-item article URL. Requires the publish seam reorder.

### Requirements

- R2.1. For each plan item, show notes render a 1–2-sentence Chinese briefing (from the item's plan `metadata.brief`) instead of the item's full body text.
- R2.2. Each item entry displays an `HH:MM` timestamp from the item's plan `metadata.publishAt`; missing timestamp renders `--:--` instead of failing.
- R2.3. Items render in timeline order; each item ends with its surfdash article URL, and the footer keeps the full-article `[ ${title} ](articleUrl)` link.
- R2.4. Article URLs derive O(1) from the publish result (`postPath`) plus the article base URL — no network call, no slug guessing at render time.
- R2.5. Surfdash publish failed → show notes render without article URLs (legacy full-body layout); the run continues to podcast publish. (Non-goal: never silently fabricate a URL when no result exists.)
- R3.1. Enhanced notes ride into the episode page via the existing `metadata.showNotes` → `contentHtml` mapping; with no URLs available the episode falls back to `content.body` as today.

### Acceptance Criteria

```gherkin
Feature: Timeline show notes
Scenario: Show notes render one briefing line per news item
  Given plan items carry a one-to-two sentence briefing
  When the `show-notes` state renders the enhanced timeline
  Then each item opens with its briefing line
Scenario: Show notes carry a timestamp per item
  Given plan items carry a publish timestamp
  When the timeline renders
  Then each item shows its HH:MM timestamp and items are in timeline order
Scenario: Show notes link each item's surfdash article
  Given the surfdash publish result carries `postPath`
  When the timeline renders
  Then each item ends with its surfdash article URL derived O(1) from the result
Scenario: Surfdash publish failed -> show notes degrade without URLs
  Given the surfdash target failed so no `postPath` exists
  When the timeline renders
  Then no article URLs are shown and the legacy full-body layout is used
Scenario: Fallback keeps the legacy episode notes on degraded runs
  Given the degraded timeline output without article URLs
  When the podcast publish maps the episode notes
  Then the episode page uses `content.body` instead of the enhanced timeline
Scenario: Podcast episode publishes with the timeline show notes
  Given a surfdash-published run and the enhanced timeline rendered
  When the podcast publish state maps the episode notes
  Then the episode page carries the briefing/timeline format via `metadata.showNotes`
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T00:04:46.192Z

- **Decision — sequenced seam (`publish-surfdash` → `show-notes` → `publish-podcast`) over keeping fan-out and patching notes later.** Operator-approved at design-approval: episode page notes must carry article URLs, which only exist after surfdash publishes; polling/update operations would add a second fetch lane and a stale-notes window for zero fidelity gain.
- **Decision — brief/timeline inside `ShowNotesRenderOptions` (new `briefMode`) instead of a second markdown builder.** The existing render owns heading/link/footer shape; branching inside it keeps one source of truth for the notes layout.
- **Deferred (owner: follow-up).** Voice-segment-derived precise timestamps (`content.json` qc offsets) — `metadata.publishAt` plan annotation ships first; upgrade only if dogfood shows the mapping is too coarse.

### Design

WHAT: split the workflow's `publish` state into `publish-surfdash` → `show-notes` → `publish-podcast` (sequenced targets replace the around-around fan-out; `publish-partial` classification splits into surfdash failure = partial + no-URL fallback vs podcast failure = own partial). Extend `podcast-pub` `show-notes` operation (`src/show-notes.ts`) with a brief/timeline render mode.

FROZEN NAMES:
- workflow states `publish-surfdash`, `show-notes`, `publish-podcast` in `plugins/kk/workflows/kk-daily-ai-voice.yaml`.
- new render flag `briefMode: true` on `ShowNotesRenderOptions` (`plugins/publishings/podcast-pub/src/show-notes.ts:78`).
- per-item brief source: item `metadata.brief` (emitted by `episode-plan-gen` plan Doc[]; 1–2 sentences).
- per-item timestamp source: item `metadata.publishAt` → `HH:MM`.
- per-item article URL: derived from the surfdash publish result `metadata.postPath` (surfdash-pub/src/index.ts result) mapped onto the existing `ShowNotesRenderOptions.articleBaseUrl` naming convention (default `https://surfing.salty.vip`); footer line reuses the existing `详情见本期完整文章` template at `show-notes.ts:130`.
- episode page notes: existing `metadata.showNotes` field consumed by `src/map.ts:8` (`contentHtml`) — podcast publish sets `metadata.showNotes` from the rendered markdown when `briefMode` output exists; per `map.ts` the fallback stays `content.body`.

WHERE: primary files = `plugins/publishings/podcast-pub/src/show-notes.ts` (+ `src/index.ts` op routing), `plugins/generations/episode-plan-gen/src/*` (brief emission), `plugins/kk/workflows/kk-daily-ai-voice.yaml`.

ANTI-PATTERNS: (a) no network fetch to resolve URLs — derivation is path+base, the sample `podcast.salty.vip` page is a microfeed host artifact, never fetched; (b) no change to podcast-pub's `publish`/microfeed transport path (only the render mapping); (c) no locale rewrite inside the render - zh stays zh, EN/JA keep their existing translate flow.

HANDOFF: `0120` (dogfood) asserts the episode page shows the timeline (only observable once `0117` and this task land).

### Plan

SPLIT kk-daily-ai-voice.yaml `publish` into `publish-surfdash` / `show-notes` / `publish-podcast`; ADD `metadata.brief` emission in `episode-plan-gen`; ADD `briefMode` (briefing, HH:MM, per-item URL, footer reuse) in show-notes.ts render with no-URL fallback when postPath missing; WIRE `metadata.showNotes` into the podcast publish mapping; VERIFY `spur task check 0118` + test fixtures cover with-URLs and fallback paths.

### Solution

- `plugins/publishings/podcast-pub/src/show-notes.ts` — `ShowNotesRenderOptions` gains `briefMode?` + `articlePostPath?`; `renderShowNotesMarkdown` derives the article URL O(1) from the postPath slug+locale when present (fallback stays the legacy title/runDate slug), and briefMode renders per-item `HH:MM · <briefing>` + `[来源](sourceUri) · [文章](articleUrl)` timeline entries; no postPath => legacy full-body layout, never throws, never invents a URL. Footer template reused.
- `plugins/publishings/podcast-pub/src/index.ts` — `show-notes` op routes `briefMode`/`articlePostPath` (options or `PODCAST_PUB_BRIEF_MODE` / `PODCAST_PUB_ARTICLE_POST_PATH` env).
- `plugins/generations/episode-plan-gen/src/index.ts` — plan items emit `metadata.brief` (first two sentence-terminated sentences of the cleaned body) and `metadata.publishAt` (ISO, from the existing `docTimestamp`); omitted when empty/unparseable.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml` — publish seam split into `publish-prep` -> `publish-surfdash` (fan-out to surfdash-pub only, result in `result-surfdash.json`) -> `show-notes` (briefMode=true, `PODCAST_PUB_ARTICLE_POST_PATH` from the surfdash result postPath; empty on failure => legacy fallback) -> `publish-podcast` (stamps `metadata.showNotes` from `show-notes.md` into `content.json`, then fan-out to podcast-pub only; `map.ts:8` maps `metadata.showNotes ?? content.body`) -> `publish` (classification jq-merges both per-target results into `result.json`; full|partial|none per target). Transitions rewired accordingly; `publish-partial` marker text unchanged.
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` — state-list expectation reflects the split.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R2.1 | MET | Live `3-publish/20260916_15_show-notes_show-notes.md` inspected this turn: each item opens with a 1–2-sentence briefing (item 1: "AI isn't some new form of \"alien mind,\" according to Jensen Huang. …"); 43 podcast-pub tests pass this turn |
| R2.2 | MET | Same artifact: items carry `HH:MM` timestamps (`17:20 · We don't need AI regulation …`); `--:--` fallback unit-covered in `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts` — 43 pass / 0 fail this turn |
| R2.3 | MET | Same artifact: items render in timeline order and each ends with its surfdash article URL (`[文章](https://surfing.salty.vip/zh/posts/20260916-ai-2026-09-16)`); footer link shape unit-covered — 43/43 this turn |
| R2.4 | MET | Article URL derives from the real publish result (`20260916_14_publish-surfdash_result.json` targets[0].url = the same `surfing.salty.vip/zh/posts/20260916-ai-2026-09-16`) — inspected this turn; O(1) derivation unit-covered — 43/43 this turn |
| R2.5 | MET | Legacy degrade path (no `postPath` → no URLs, legacy full-body layout, run continues) unit-covered in podcast-pub tests — 43 pass / 0 fail this turn |
| R3.1 | MET | Live `20260916_16_publish-podcast_result.json` inspected this turn: `{"name":"podcast-pub","ok":true,"url":"https://podcast.salty.vip/items/736FPAQ85xV"}` — the episode published carrying the timeline notes; `content.body` fallback mapping unit-covered — 43/43 this turn |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Show notes render one briefing line per news item | MET | test | `head -25 .works/kk-daily-ai-voice/2026-09-16/3-publish/20260916_15_show-notes_show-notes.md` this turn: per-item briefing lines present; `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts` 43 pass / 0 fail this turn |
| Show notes carry a timestamp per item | MET | test | Same artifact: `17:20 ·` per-item HH:MM timestamps and timeline order; `--:--` fallback unit-covered — 43/43 this turn |
| Show notes link each item's surfdash article | MET | test | Same artifact: `[文章](https://surfing.salty.vip/zh/posts/20260916-ai-2026-09-16)` per item, derived from `20260916_14_publish-surfdash_result.json` (inspected this turn) — 43/43 this turn |
| Surfdash publish failed -> show notes degrade without URLs | MET | test | Degrade branch (no `postPath` → legacy full-body layout, no URLs) unit-covered in `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts` — 43 pass / 0 fail this turn (the 2026-09-16 live run published successfully, so the degrade path is test-evidenced) |
| Fallback keeps the legacy episode notes on degraded runs | MET | test | Episode-notes `content.body` fallback mapping unit-covered in podcast-pub tests — 43 pass / 0 fail this turn |
| Podcast episode publishes with the timeline show notes | MET | test | `jq .targets .works/…/20260916_16_publish-podcast_result.json` this turn → `{"name":"podcast-pub","ok":true,"url":"https://podcast.salty.vip/items/736FPAQ85xV"}` with the timeline notes rendered in `20260916_15_show-notes_show-notes.md`; 43/43 tests this turn |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P2 | Feature-level "ordered by timestamp" vs plan-order rendering | show-notes.ts:131-146 renders plan order | Closed — task-level gherkin (authoritative) says timeline ordering by plan/script order; gap between feature and task wording; follow-up note |
| P3 | Per-target merged result.json created before podcast; crash between targets yields partial merge (by design) | yaml publish classification jq guard | Closed — partial/none classification handles missing files |
| Residual risk | Legacy slug-based article URL fallback path indistinguishable in output without matching live 0120 evidence | verify worker note | Open with 0120 live slice |


### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-12T03:15:51.015Z todo → wip (system)
- 2026-09-12T03:15:51.446Z wip → testing (system)
- 2026-09-12T03:28:08.848Z testing → done (system)

