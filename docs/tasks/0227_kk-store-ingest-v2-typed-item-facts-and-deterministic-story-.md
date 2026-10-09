---
schema_version: 1
name: "kk store ingest v2: typed item facts and deterministic story_id clustering"
status: todo
template: feature-impl
created_at: 2026-10-09T01:27:19.855Z
updated_at: "2026-10-09T02:45:15.014Z"
feature_id: G32

dependencies: ["0225"]
priority: P2
estimate_hours: 5
---

## 0227. kk store ingest v2: typed item facts and deterministic story_id clustering

### Background

The four heuristic dimension scores are pure functions of facts: body length (quality), source tier (importance), publish date (urgency) and engagement (impact). Those facts sit untyped in `items.metadata_json`. G32 D2 moves deterministic facts into typed `items` columns and keeps judgments in `labels`.

Separately, the same event reported under different URLs is stored as unrelated items. Without a story key, selection dedup lets the same news in again the next day under another URL (D5).

Depends on 0225, which adds the columns.

**Refine corrections (2026-10-08)**

- **R2 is dropped.** The heuristic is already a set of pure functions: `classifyCategory`/`scoreDimensions` in `plugins/generations/episode-plan-gen/src/index.ts:366-422`. The plugin depends only on `@gobing-ai/kk-core` (its `package.json`), and `kk store label` reaches it out of process through `kk executor run`. Moving it into kk-store would add a plugin→kk-store dependency edge and is not needed for D2: the fact columns are the backtest signals, and the heuristic stays the `heuristic` maker. The old R3–R6 become R2–R5.
- **Fact semantics were unspecified.** They are frozen below and mirror the plugin's reads:
  - `maxEngagement` (`:334-341`): the largest numeric value in `metadata.engagement`;
  - `IMPORTANCE_BASE` (`:184`): aihot 4, rss/hackernews 3, other 2;
  - body length (`:397`).
- Live store (`.works/kk.db`):
  - `metadata.lang` exists only on rss (4/4) and 2 hackernews items; a fallback detector is required;
  - `metadata.engagement` exists on 52/68 items;
  - sources: aihot 10, github 4, grounding 3, hackernews 15, polymarket 4, reddit 14, rss 4, youtube 14.
- Prior art: the plugin's `titleSimilarity` (`:313-320`) is whole-string char bigrams for in-plan dedup. D5 deliberately uses CJK bigrams plus Latin words, because Latin char bigrams over-merge unrelated English titles. Do not reuse it.
- `domain` is derived here (0225 removed the SQL derivation).

### Requirements

- [ ] R1. `ItemsDao` ingest fills the facts for every inserted or updated item, using pure functions in `packages/kk-store/src/facts.ts`:
  - `engagement`: the largest finite number among `metadata.engagement`'s values, the same as the plugin's `maxEngagement`. NULL when the key is absent or holds no number.
  - `body_chars`: `[...body].length`, counted in code points.
  - `source_tier`: `'curated'` for `aihot`, `'community'` for `rss` / `hackernews`, `'other'` otherwise. This mirrors `IMPORTANCE_BASE` (`episode-plan-gen/src/index.ts:184`), and a code comment cross-references it.
  - `lang`: `metadata.lang` if it is a non-empty string, else `'zh'` when the title contains any CJK ideograph (U+4E00–U+9FFF), else `'en'` when the title has a Latin letter, else NULL.
  - `domain`: `new URL(canonical_url).hostname` lowercased, with a leading `www.` stripped. NULL on a parse failure.
- [ ] R2. `storyIdFor(title, candidates, threshold)` in `packages/kk-store/src/story.ts`:
  - **Normalize:** NFKC, lowercase, strip a trailing outlet suffix after ` - ` / ` | ` / `｜` / ` — ` when the suffix is ≤ 30 chars, then strip punctuation and symbols (`\p{P}\p{S}`).
  - **Tokenize:** CJK runs → character bigrams (a single-char run → that char); Latin/digit runs → words.
  - **Match:** take the Jaccard similarity against each candidate's tokens. The best candidate at `>= threshold` (ties → earliest `first_seen_at`, then smallest id) supplies its `story_id`; otherwise return `null` and the caller uses the item's own id.
  - **Guard:** an empty token set never matches.
- [ ] R3. Candidates are items with `first_seen_at >= now - window_hours` plus docs that precede this one in the same ingest batch. An **existing** item (update path) keeps its `story_id`. `readStoreConfig` (0226) gains `story: { threshold (default 0.6, range (0,1]), windowHours (default 72, a positive integer) }` from `store.story.threshold` / `store.story.window_hours`, under the same fail-loud rule. Code carries `// ponytail: no cross-language merge; upgrade path is an embedding backend`.
- [ ] R4. `kk store backfill-facts [--db]` recomputes facts for all items. It then recomputes `story_id` in `first_seen_at, id` order, using as candidates only items earlier in that order and inside the window, so clustering stays causal. It is idempotent: a second run changes 0 rows. It prints `{updated}`, the count of rows whose values changed.
- [ ] R5. In the same commit, `docs/04_DESIGN.md` lists `backfill-facts` and the `store.story.*` keys.

### Acceptance Criteria

- [ ] AC1 — Ingest records deterministic item facts as typed columns
- [ ] AC2 — Near-duplicate titles within 72 hours share one story

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T02:39:09.099Z

- **Q: Should the heuristic move into kk-store?** No (refine audit). Closed: it is already pure in the plugin, and moving it adds a dependency edge without serving D2. Revisit only if a non-plugin caller needs the scores.
- **Q: Where does `lang` come from?** Closed: `metadata.lang`, else a script detector on the title. Only 6/68 live items carry `metadata.lang`.
- **Q: Where does `source_tier` come from?** Closed: a three-value enum mirroring `IMPORTANCE_BASE`, with a cross-reference comment.

### Design

**Frozen names**:

| Kind | Names |
|---|---|
| Facts | `itemFacts(doc): ItemFacts` in `src/facts.ts` |
| Story | `storyTokens(title): Set<string>` and `storyIdFor(title, candidates, threshold): string \| null` in `src/story.ts` |
| Backfill | `ItemsDao.backfillFacts(policy): Promise<number>` |
| CLI | verb `backfill-facts` |
| Config | `StoreConfig.story { threshold, windowHours }` |

**Decisions**:

- Clustering is deterministic, local and zero-cost. The candidate set is bounded by the window (hundreds of rows), so an O(n) scan per new item is acceptable. `ponytail:` add a token inverted index past ~10k items per window.
- A story's id is its earliest member's id. A later item never re-roots an existing story, and the update path never re-clusters.
- Clustering uses the title only. Stub-length bodies are common (G31 0212 dogfood), so bodies would add noise.
- The facts are computed in the DAO's ingest batch, so the batch stays one atomic `adapter.batch` (`dao/items.ts:147-222`).

**Anti-patterns**:

- Importing plugin source into kk-store, or kk-store into the plugin.
- Re-clustering existing items on ingest.
- Using the wall clock inside `storyIdFor`; the caller passes candidates.
- Reusing `titleSimilarity`.

**Handoffs**:

- **0228**'s exclusion keys on `items.story_id`. Until this task lands, it equals `id` via the 0225 backfill.
- **0230** runs `backfill-facts` on the live store and records the calibration.

### Plan

1. Write the failure-first list:
   - an empty title; an emoji- or punctuation-only title;
   - mixed CJK and Latin text;
   - an outlet suffix that differs only by outlet, and a long ` - ` clause that is not a suffix;
   - the window boundary at exactly 72h;
   - an existing item's update, which must keep its `story_id`;
   - a missing engagement key, and engagement holding strings;
   - an unparseable URL;
   - duplicate titles inside one batch;
   - a backfill run twice.
2. Write `itemFacts` with table tests, then `storyTokens`/`storyIdFor` with table tests built from real titles in `.works/kk.db`.
3. Wire ingest, `backfillFacts` and the CLI verb, and add the `story` config.
4. Calibrate the threshold on the live 68 items (`backfill-facts` on a copy). Record pairs merged or missed in Testing.
5. Update 04 and run `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G32 (R6, R7). Brainstorm D2, D5. Depends on 0225 (columns); config via 0226's `readStoreConfig` (if 0226 has not landed, add `readStoreConfig` here with the same frozen signature).
- `plugins/generations/episode-plan-gen/src/index.ts:184` (IMPORTANCE_BASE), `:313-320` (titleSimilarity), `:334-341` (maxEngagement), `:394-422` (scoreDimensions).
- `packages/kk-store/src/dao/items.ts:147-222` (atomic ingest batch), `src/schema/items.ts:11-22`.

### History

- 2026-10-09T02:45:15.014Z backlog → todo (system)

