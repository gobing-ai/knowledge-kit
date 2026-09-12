---
schema_version: 1
name: Timeline show notes with briefings, timestamps, and article URLs
status: todo
template: feature-impl
created_at: 2026-09-11T23:55:04.609Z
updated_at: "2026-09-12T00:04:56.444Z"
feature_id: O
priority: P0
tags:
  - workflow
  - show-notes
  - podcast-pub

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
Scenario: Enhanced notes render per-item briefing, timestamp, and article URL
  Given an episode plan whose items carry metadata.brief and metadata.publishAt, and a surfdash publish result with metadata.postPath
  When the workflow `show-notes` state runs with surfdash published
  Then `show-notes.md` renders every item with its 1-2-sentence briefing, an HH:MM timestamp, timeline ordering, and its surfdash article URL
  And the `publish-podcast` mapping carries the enhanced notes into the episode page via `metadata.showNotes`
Scenario: Surfdash failed -> legacy fallback notes
  Given the surfdash publish target failed so no postPath exists
  When the `show-notes` state renders
  Then `show-notes.md` has no article URLs and uses the legacy full-body layout
  And `publish-podcast` uses `content.body` as the episode page notes as today
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
