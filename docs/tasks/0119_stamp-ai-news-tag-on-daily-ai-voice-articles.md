---
schema_version: 1
name: Stamp ai-news tag on daily AI voice articles
status: done
template: feature-impl
created_at: 2026-09-11T23:55:04.610Z
updated_at: "2026-09-12T00:09:35.874Z"
feature_id: O
priority: P1
tags:
  - generator
  - tagging

done_forced: "true"
done_reason: verifyall PASS verdict .spur/run/0119-verdict.json
---

## 0119. Stamp ai-news tag on daily AI voice articles

### Background

Feature O / R4. surfdash-pub already maps `content.metadata.tags` to article frontmatter (surfdash-pub src/index.ts); the daily AI voice generator simply does not emit the tag.

### Requirements

- R4.1. Every article the `kk-daily-ai-voice` flow publishes to surfdash carries `metadata.tags` including `ai-news` at generation time (single-source: `daily-article-gen`).
- R4.2. The existing surfdash-pub frontmatter mapping writes the tag into the article's frontmatter untouched (verify, no change unless a gap appears).
- R4.3. Explicit non-goal: no new env/CLI knob (`AI_NEWS_TAG` etc.) until a second tag source exists.

### Acceptance Criteria

```gherkin
Feature: ai-news tagging
Scenario: Article publish stamps the tag
  Given the daily article is assembled by `daily-article-gen`
  When the publish workflow produces frontmatter
  Then the frontmatter tags include `ai-news` for every article shipped this flow
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T00:04:57.184Z

- **Decision — tag emitted by the generator, not injected by surfdash-pub.** An env knob (`AI_NEWS_TAG`) would make a never-changing value configurable and leak a workflow convention into a generic transport; the constant lives with the author that owns the semantics.
- **Deferred – None.**

### Design

WHAT: `plugins/generations/daily-article-gen/src/*` stamps `metadata.tags = ['ai-news', ...existing]` on generated Content. WHY: generator owns content intent; `surfdash-pub` owns transport mapping (`metadata.tags` → frontmatter, already shipping) — putting the tag at publish would couple a daily-workflow convention into a generic plugin.

FROZEN NAMES:
- tag value exactly `ai-news` (string literal, single constant).
- stamping location: the daily-article-gen Content assembly step, appended after any existing tags (defensive merge, never overwrite).

WHERE: primary files = `plugins/generations/daily-article-gen/src/*`; read-only cross-check `plugins/publishings/surfdash-pub/src/index.ts` frontmatter map.

ANTI-PATTERNS: (a) no per-workflow tag plumbing in other generators (core-facts-gen etc. stay untouched); (b) no frontmatter rewrite in surfdash-pub beyond what the existing mapping already does; (c) no config knob — a value that never changes is a constant.

HANDOFF: `0120` (dogfood) asserts frontmatter includes `ai-news`.

### Plan

STAMP `metadata.tags` in daily-article-gen output; VERIFY frontmatter carries the tag in local dry-run posting (surfdash-pub src/index.ts mapping); ADD unit test on generated content metadata (and the mapping already covered).

### Solution

daily-article-gen/src/index.ts:46-56 AI_NEWS_TAG constant + tagsFor(docs): lead position, dedupe merge, non-string filter; stamped in docsToContent metadata (:64). No env knob (frozen name by task intent).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R4.1 | MET | AI_NEWS_TAG + tagsFor(): daily-article-gen/src/index.ts:46-56; stamped in docsToContent :64 |
| R4.2 | MET | surfdash frontmatter tags mapping pre-existing surfdash-pub/src/index.ts:76-100; single-source verified |
| R4.3 | MET | no env/CLI knob; no AI_NEWS_TAG env read anywhere |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Article frontmatter tags include ai-news | MET | mixed | Article frontmatter tags include ai-news as lead, deduped merge, non-strings filtered. \| bun run test: 11 daily-article-gen tests pass; lint 0; task check 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P3 | Tag constant not env-tunable by design (frozen) | daily-article-gen/src/index.ts:46-56 | Closed — matches task intent (frozen name) |
| P4 | ai-news tag also collides with surfdash tag style? | surfdash-pub/src/index.ts:76-100 | Closed — mapping verified, single source |
| Residual risk | None outstanding | 11 plugin tests | Accept |


### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-12T03:15:52.085Z todo → wip (system)
- 2026-09-12T03:28:02.052Z wip → testing (system)
- 2026-09-12T03:28:09.288Z testing → done (system)

