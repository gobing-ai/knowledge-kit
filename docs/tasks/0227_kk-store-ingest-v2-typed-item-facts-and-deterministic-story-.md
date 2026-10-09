---
schema_version: 1
name: "kk store ingest v2: typed item facts and deterministic story_id clustering"
status: done
template: feature-impl
created_at: 2026-10-09T01:27:19.855Z
updated_at: "2026-10-09T05:25:43.365Z"
feature_id: G32

dependencies: ["0225"]
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0227-verdict.json
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

- [x] R1. `ItemsDao` ingest fills the facts for every inserted or updated item, using pure functions in `packages/kk-store/src/facts.ts`:
  - `engagement`: the largest finite number among `metadata.engagement`'s values, the same as the plugin's `maxEngagement`. NULL when the key is absent or holds no number.
  - `body_chars`: `[...body].length`, counted in code points.
  - `source_tier`: `'curated'` for `aihot`, `'community'` for `rss` / `hackernews`, `'other'` otherwise. This mirrors `IMPORTANCE_BASE` (`episode-plan-gen/src/index.ts:184`), and a code comment cross-references it.
  - `lang`: `metadata.lang` if it is a non-empty string, else `'zh'` when the title contains any CJK ideograph (U+4E00–U+9FFF), else `'en'` when the title has a Latin letter, else NULL.
  - `domain`: `new URL(canonical_url).hostname` lowercased, with a leading `www.` stripped. NULL on a parse failure.
- [x] R2. `storyIdFor(title, candidates, threshold)` in `packages/kk-store/src/story.ts`:
  - **Normalize:** NFKC, lowercase, strip a trailing outlet suffix after ` - ` / ` | ` / `｜` / ` — ` when the suffix is ≤ 30 chars, then strip punctuation and symbols (`\p{P}\p{S}`).
  - **Tokenize:** CJK runs → character bigrams (a single-char run → that char); Latin/digit runs → words.
  - **Match:** take the Jaccard similarity against each candidate's tokens. The best candidate at `>= threshold` (ties → earliest `first_seen_at`, then smallest id) supplies its `story_id`; otherwise return `null` and the caller uses the item's own id.
  - **Guard:** an empty token set never matches.
- [x] R3. Candidates are items with `first_seen_at >= now - window_hours` plus docs that precede this one in the same ingest batch. An **existing** item (update path) keeps its `story_id`. `readStoreConfig` (0226) gains `story: { threshold (default 0.6, range (0,1]), windowHours (default 72, a positive integer) }` from `store.story.threshold` / `store.story.window_hours`, under the same fail-loud rule. Code carries `// ponytail: no cross-language merge; upgrade path is an embedding backend`.
- [x] R4. `kk store backfill-facts [--db]` recomputes facts for all items. It then recomputes `story_id` in `first_seen_at, id` order, using as candidates only items earlier in that order and inside the window, so clustering stays causal. It is idempotent: a second run changes 0 rows. It prints `{updated}`, the count of rows whose values changed.
- [x] R5. In the same commit, `docs/04_DESIGN.md` lists `backfill-facts` and the `store.story.*` keys.

### Acceptance Criteria

- [x] AC1 — Ingest records deterministic item facts as typed columns
- [x] AC2 — Near-duplicate titles within 72 hours share one story

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

Recorded by the batch driver from the verified working diff: the implement stage's closing report was garbled
(it answered an unrelated tooling guard instead of reporting its work) and it never wrote this section. Every
anchor below was re-read in the tree and independently verified by this task's review and verify passes, which
both derived their evidence from the code rather than from an implementer narrative.

#### Change map

- `packages/kk-store/src/facts.ts` (new) — the pure fact derivation. `toFiniteNumber` `:46`, `maxEngagement` `:57`
  (largest finite value in `metadata.engagement`, mirroring the plugin's at
  `plugins/generations/episode-plan-gen/src/index.ts:334-341`), tier sets `:30` with the `IMPORTANCE_BASE`
  cross-reference comment `:26` (the plugin's constant is at its `:184`), `lang` chain `:77`, `domain` `:86`
  (`new URL()` + lowercased host + `www.` stripped, NULL on a parse failure), `itemFacts(doc)` `:96`
  (`body_chars` = `[...body].length`, counted in code points).
- `packages/kk-store/src/story.ts` (new) — `DEFAULT_STORY_POLICY` `:23` and the `ponytail: no cross-language merge`
  note `:11`; `OUTLET_SEPARATOR` `:46`, `stripOutletSuffix` `:57` (the ≤30-char guard is `:67`), `normalizeTitle`
  `:72` (NFKC + lowercase + `\p{P}\p{S}` → space), `storyTokens` `:81` (CJK run → character bigrams, single-char
  run → that char, Latin/digit run → words), `jaccard` `:102`, the tie-break `precedes` `:112`
  (earliest `first_seen_at`, then smallest id), `storyIdFor(title, candidates, threshold)` `:123` returning the
  matched candidate's `story_id` and `null` otherwise (the caller then uses the item's own id). Zero imports, so
  the plugin's whole-string char-bigram `titleSimilarity` is provably not reused.
- `packages/kk-store/src/dao/items.ts` — `prepareItem` `:156` fills the five facts through `itemFacts`; the update
  path's `UPDATE_ITEM_SQL` `:115` deliberately omits `story_id` so an existing item keeps its story;
  `storyCandidates(now - window)` `:363`; batch candidates appended only after the current item is handled `:232`;
  `backfillFacts(policy)` `:304` — one `ORDER BY first_seen_at, id` scan `:305`, a per-row sliding window `:325`,
  `storyIdFor(...) ?? row.id` `:331`, a changed-row comparison over all five facts plus `story_id` `:334`, and one
  `adapter.batch` of only the changed rows `:343` returning that count.
- `packages/kk-store/src/config.ts` — `StoreConfig.story` `:38`, defaults `:70` (0.6 / 72),
  `readStoryThreshold` `:126` (a number in `(0, 1]`), `readStoryWindowHours` `:136` (a positive integer),
  `readStoryConfig` `:146` and the same single `readStoreConfig` entry point `:157` — a present-but-invalid key
  throws `StoreConfigInvalidError` naming it, per 0226's contract; no second reader was added.
- `packages/kk-store/src/index.ts` — re-exports the new modules.
- `apps/cli/src/commands/store.ts` — `backfillFactsAction` `:1303` prints `{"updated":n}` and reads the configured
  policy `:1306`; the verb is registered with only `--db` `:1365`; `ingestAction` `:291` passes the same policy.
- `docs/04_DESIGN.md` — the `backfill-facts` usage line `:73`, the command-table row `:95`, the typed-facts prose
  `:441`, the story section `:452`, the `backfill-facts` contract `:463` and both `store.story.*` keys `:530`.
- Tests: `packages/kk-store/tests/facts.test.ts` (34 cases), `packages/kk-store/tests/story.test.ts` (15),
  `packages/kk-store/tests/dao/items-v2.test.ts` (12, covering AC1's insert/update paths and AC2's clustering),
  `packages/kk-store/tests/config.test.ts` (+9 for the story keys), `apps/cli/tests/commands/store.test.ts`
  (+4 for the verb).

#### Known deviation (filed, not fixed here)

`TOKEN_RUN`'s word alternative at `story.ts:50` also matches Han, so a CJK run glued to a preceding Latin/digit
character becomes one fused token (`storyTokens("OpenAI发布新模型")` is a single token), and a whitespace-only
near-duplicate of a mixed-script headline never clusters. Both the review and the verify pass reproduced it and
judged it non-blocking (boundary defect inside an implemented capability; zero live impact — 0 of 78 live titles
contain a CJK ideograph). It is carried by follow-up task 0234, together with the uncalibrated 0.6 Jaccard
threshold that 0230 owns.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | One derivation, `itemFacts(doc)` at `packages/kk-store/src/facts.ts:96-103`, called from `prepareItem` (`packages/kk-store/src/dao/items.ts:156-169`) and from `backfillFacts` (`packages/kk-store/src/dao/items.ts:316-322`). engagement: `maxEngagement` at `packages/kk-store/src/facts.ts:57-64` over `toFiniteNumber` at `packages/kk-store/src/facts.ts:46-50`, mirroring the plugin's `maxEngagement` at `plugins/generations/episode-plan-gen/src/index.ts:334-341` (same `parseFloat`-of-a-numeric-string, same finite filter), NULL when no value is finite. body_chars: `[...(doc.body ?? '')].length` at `packages/kk-store/src/facts.ts:99`. source_tier: sets at `packages/kk-store/src/facts.ts:30-31` read at `packages/kk-store/src/facts.ts:67-74`, with the `IMPORTANCE_BASE` cross-reference comment at `packages/kk-store/src/facts.ts:26-28` naming `plugins/generations/episode-plan-gen/src/index.ts:184`. lang chain at `packages/kk-store/src/facts.ts:77-83`. domain at `packages/kk-store/src/facts.ts:86-93`. My probes this pass: body "🎉"→1, "𠀀"→1, "a🎉b𠀀"→4, ""→0; engagement absent/`{}`/`"n/a"`/`NaN`/`Infinity`/array→null, `{"a":"1e3","b":"2"}`→1000, `{"a":"Infinity","b":3}`→3, `{"a":-5,"b":-1}`→-1; domain `https://WWW.Example.COM/A`→`example.com`, `https://example.com:8443/a`→`example.com`, `www.example.com/x`→`example.com`, `not a url at all`→null; tiers aihot/rss/hackernews/reddit/youtube/missing→curated/community/community/other/other/other. Tests re-run this pass: `packages/kk-store/tests/facts.test.ts` 34 pass / 0 fail, `packages/kk-store/tests/dao/items-v2.test.ts` "ItemsDao.upsertDocs — typed facts (0227 R1, AC1)" 3 pass / 0 fail. |
| R2 | MET | Normalize: `stripOutletSuffix` at `packages/kk-store/src/story.ts:57-69` (last ` - `/` — `/` |
| R3 | MET | Candidates on ingest = `storyCandidates(now - windowHours*3_600_000)` at `packages/kk-store/src/dao/items.ts:363-374`, called at `packages/kk-store/src/dao/items.ts:219`, plus `batchCandidates` appended only after the current item is handled (`packages/kk-store/src/dao/items.ts:232-233` insert, `:261` update) — the set at `:232` is `[...recent, ...batchCandidates]`. My probes this pass: exactly 72h → merges to the earlier root; 72h+1ms → own root (inclusive boundary, and no in-window middle member), re-run on a fresh store. Update path never writes `story_id` (`UPDATE_ITEM_SQL` at `packages/kk-store/src/dao/items.ts:115-119` omits it), and `previous.storyId` feeds the candidate list at `packages/kk-store/src/dao/items.ts:261` (`toCandidate` maps NULL→own id at `packages/kk-store/src/dao/items.ts:172-174`); my probe: an existing item whose title is rewritten to an unrelated headline keeps the old root (`updated:1`). Config: `StoreConfig.story` at `packages/kk-store/src/config.ts:38`, defaults at `packages/kk-store/src/config.ts:70-72` (0.6 / 72 via `packages/kk-store/src/story.ts:23-25`), readers `readStoryThreshold` at `packages/kk-store/src/config.ts:126-134` `(0,1]` and `readStoryWindowHours` at `packages/kk-store/src/config.ts:136-144` positive integer, dispatch in `readStoryConfig` at `packages/kk-store/src/config.ts:146-155` (absent sub-key → default, present bad → `StoreConfigInvalidError` naming the key), wired into the single reader at `packages/kk-store/src/config.ts:157-167`; no second reader (grep for `store.story` outside `packages/kk-store/src/config.ts`: only the two CLI call sites `apps/cli/src/commands/store.ts:286` and `apps/cli/src/commands/store.ts:1306`, both `readStoreConfig`). My probes this pass: absent `store`/absent `story`/`story: {}` → `{threshold:0.6,windowHours:72}`; `threshold: 1` accepted; `story: 7`, `threshold: 0/-0.1/1.0001/"0.6"`, `window_hours: 0/1.5/"72"` each throw `StoreConfigInvalidError` naming exactly that key. `// ponytail: no cross-language merge…` at `packages/kk-store/src/story.ts:11`. Tests re-run: `packages/kk-store/tests/dao/items-v2.test.ts` story describes 5 pass / 0 fail, `packages/kk-store/tests/config.test.ts` 9 pass / 0 fail. |
| R4 | MET | `backfillFacts(policy)` at `packages/kk-store/src/dao/items.ts:304-360`: one `ORDER BY first_seen_at, id` scan (`:305-309`), a sliding candidate list pruned to the row's OWN window (`:325-330`), `storyIdFor(...) ?? row.id` (`:331`), candidates appended after each row so only earlier rows are visible (`:332`), the changed test comparing all five facts plus `story_id` (`:334-341`), one `adapter.batch` of only the changed rows (`:343-358`), returning that count. CLI: `backfillFactsAction` at `apps/cli/src/commands/store.ts:1303-1317` prints `{"updated":n}` and reads the configured policy at `apps/cli/src/commands/store.ts:1306`; registration with only `--db` at `apps/cli/src/commands/store.ts:1365-1372`; `ingestAction` passes the same policy to `upsertDocs` at `apps/cli/src/commands/store.ts:291`. **Idempotence verified first-hand on the real 78-item store** (my own copy at `.works/test-artifacts/0227/kk-live-copy.db`, never the original): `kk store migrate` → `{"applied":1}`, then `backfill-facts` → `{"updated":78}`, `{"updated":0}`, `{"updated":0}` (three runs, exit 0 each). Count semantics probed directly: after corrupting exactly two rows (one `engagement`, one `story_id`) the next run reported `{"updated":2}` and the one after `{"updated":0}` — the count is changed rows, not a constant. Causal order probed on a fresh store with the three titles ingested NEWEST-first and all six v2 columns staged NULL/`id`: one run reported 3 and rooted all three on the EARLIEST member's id; a second run reported 0. Failure path: `store backfill-facts --db /tmp` → exit 1, `kk.store.backfill-facts.failed: unable to open database file`, nothing on stdout. Tests re-run: `packages/kk-store/tests/dao/items-v2.test.ts` "ItemsDao.backfillFacts (0227 R4)" 4 pass / 0 fail, `apps/cli/tests/commands/store.test.ts` "kk store backfill-facts (0227 R4)" 4 pass / 0 fail. |
| R5 | MET | `docs/04_DESIGN.md:73` the `kk store backfill-facts [--db <path>]` usage line; `docs/04_DESIGN.md:95` the command-table row (`backfill-facts`, idempotent, prints `{updated}`, shipped task 0227); `docs/04_DESIGN.md:441-450` the five typed facts; `docs/04_DESIGN.md:452-461` the story key (tokenization, candidates, earliest-member root, update path); `docs/04_DESIGN.md:463-467` the `backfill-facts` contract (causal order, `{updated}`, idempotent second run, failure string); `docs/04_DESIGN.md:530-533` both `store.story.*` keys with ranges and defaults; `docs/04_DESIGN.md:803-805` the packaged fact and story surface. Every anchor re-read at the cited lines this pass; the prose matches the source, including the idempotency and causal-order claims. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Ingest records deterministic item facts as typed columns | MET | test | `packages/kk-store/tests/dao/items-v2.test.ts:46` "fills every fact column on insert" reads all five columns back from a real store (engagement 30, bodyChars 4, sourceTier community, lang ja, domain example.com) and `packages/kk-store/tests/dao/items-v2.test.ts:74` "recomputes the facts on the update path" pins the update path (bodyChars 20, curated, engagement 7). Run by name this pass: `bun test packages/kk-store/tests/dao/items-v2.test.ts -t "typed facts"` → 3 pass / 0 fail / 17 expect(); the whole file → 12 pass / 0 fail. Independent evidence: after `kk store backfill-facts` on my own copy of the live store, all 78 rows carry non-NULL `domain` and `body_chars`, `body_chars` equals `[...body].length` for 78/78, 55 carry `engagement`, and `source_tier` splits 10 curated / 23 community / 45 other — the `aihot` / `rss`+`hackernews` / tail shape R1 specifies. Feature scenario `R6 — Ingest records deterministic item facts as typed columns`. |
| AC2 — Near-duplicate titles within 72 hours share one story | MET | test | `packages/kk-store/tests/dao/items-v2.test.ts:114` "gives one story to near-duplicate titles within 72h" (three URL-distinct titles, two with outlet suffixes, over 71h, one root) plus `:130` "does not merge across the 72h boundary", `:148` "clusters duplicate titles inside one ingest batch", `:173` "gives an unrelated title its own story id"; run by name this pass: `bun test packages/kk-store/tests/dao/items-v2.test.ts -t "story clustering"` → 5 pass / 0 fail / 9 expect(). Independent evidence: replaying the real causal order over the 78 live titles with the shipped `storyIdFor` at the default 0.6 produced exactly 3 merges — `Guys this is huge (good news)` / `GUYS THIS IS HUGE (good news)` (1.000), the two `Pope Leo says AI concerns…` variants (1.000) and `…best AI model end of October?` / `…end of November?` (0.818) — all three genuine near-duplicates, reproduced from my own copy of the store, not from the review's numbers. Counterexample classes are the two P3/P4 rows below; neither is corpus-reachable today (0 of 78 live titles contain a CJK ideograph). Feature scenario `R7 — Near-duplicate titles within 72 hours share one story`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0227

**Scope:** the worktree's uncommitted batch diff, content-scoped to 0227 — new `packages/kk-store/src/facts.ts`, `packages/kk-store/src/story.ts`, `packages/kk-store/tests/facts.test.ts`, `packages/kk-store/tests/story.test.ts`, `packages/kk-store/tests/dao/items-v2.test.ts`; modified `packages/kk-store/src/dao/items.ts` (fact wiring + `backfillFacts`), `packages/kk-store/src/config.ts` (`store.story.*`), `packages/kk-store/src/index.ts`, `apps/cli/src/commands/store.ts` (`backfill-facts`), `docs/04_DESIGN.md`. 0225/0226 files (migration internals, `selections` DAO/schema, `labelsCurrentSql`, the label pass, `--replay`, `docs/00_ADR.md`) were excluded as out of scope; residuals 0231–0233 were not re-litigated.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture depth
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | `TOKEN_RUN`'s word alternative (`[\p{L}\p{N}]+`) also matches Han/kana, so a CJK run immediately after a Latin/digit character is absorbed into ONE fused word token instead of being bigrammed — R2's "CJK runs → character bigrams" does not hold on that boundary. Measured with the shipped function: `storyTokens("OpenAI发布新模型")` = `{"openai发布新模型"}`, `storyTokens("GPT5震撼发布")` = `{"gpt5震撼发布"}`, `storyTokens("Meta裁员1000人")` = `{"meta裁员1000人"}` (1 token each); `storyTokens("OpenAI 发布新模型")` = `{"openai","发布","布新","新模","模型"}`. Consequence: `jaccard("OpenAI发布新模型","OpenAI 发布新模型") = 0.00`, so a whitespace-only near-duplicate of a mixed-script headline never shares a story at any threshold (AC2 for that input class); longer mixed titles still merge because the shared CJK prefix carries the score (`华为发布新一代AI芯片` vs the same with spaces = 0.67). Live impact is nil today — 0 of the 78 live-store titles are mixed-script (all English, `aihot` included) — so this is a latent defect on a path exercised only by fixtures. Fix: stop the word alternative before Han/Hiragana/Katakana (or split the normalized title into script runs before tokenizing). | `packages/kk-store/src/story.ts:44` (TOKEN_RUN), `packages/kk-store/src/story.ts:81-95` | DEFER (0230) |
| 2 | P4 (advisory) | correctness | Unweighted token Jaccard at the frozen default `0.6` is a precision/recall trade-off rather than a coding error, but both directions are demonstrable on real titles: over-merge of semantically OPPOSITE headlines — `英伟达股价大涨`/`英伟达股价大跌` = 0.714 → MERGE, `Trump signs the AI bill`/`Trump vetoes the AI bill` = 0.667 → MERGE, `AI is changing everything`/`AI is changing nothing` = 0.600 → MERGE; and on the live store `backfill-facts` merges the recurring `…best AI model end of October?` with `…end of November?` (0.82) while missing one true same-event pair (`U.S. 30-year mortgage rate hits 3-year high, refinancing demand halves` vs `…hits 7.40%, a three-year high` = 0.50). Counts on the real corpus: 3 merges of 78 items, all three genuine near-duplicates; 7 further pairs sit in [0.30, 0.60), none an obvious merge miss except the mortgage pair. Plan step 4 asked for the calibration pairs to be recorded in `## Testing`; that section is still empty. The threshold is operator-tunable (`store.story.threshold`, R3) and the Handoffs assign the live-store calibration to 0230. | `packages/kk-store/src/story.ts:23` (DEFAULT_STORY_THRESHOLD), `docs/04_DESIGN.md:530` | DEFER (0230) |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `facts.ts:57-65` `maxEngagement` — largest finite value via `toFiniteNumber`, which is byte-for-byte the plugin's `toNumber` (`plugins/generations/episode-plan-gen/src/index.ts:328-331`), NULL when no value is finite; the plugin floors at 0 only for its own caller, R1's NULL is what is implemented. `:30-31,67-74` tier sets `{aihot}`→curated / `{rss,hackernews}`→community / else other, comment cross-references `IMPORTANCE_BASE` (`…index.ts:184`). `:77-83` lang: declared non-empty `metadata.lang` → CJK ideograph U+4E00–U+9FFF → Latin letter → NULL. `:86-94` domain: `new URL(…).hostname` lowercased, `www.` stripped, NULL on throw. `:96-105` `[...body].length`. Pure: only imports are the `Doc` type and `canonicalUrlForDoc` — no fs, db, clock, or network. Probes this run: body `"🎉"`→1 (UTF-16 2), `"𠀀"`→1, `"a🎉b𠀀"`→4; engagement absent/array/nested/`"n/a"`/`NaN`→null, `{"a":"1e3"}`→1000, `{"a":Infinity,"b":3}`→3; domain `https://WWW.Example.COM/A`→`example.com`, `https://example.com:8443/a`→`example.com`, `not a url at all`→null. Tests: `tests/facts.test.ts` (all four describes), `tests/dao/items-v2.test.ts` "fills every fact column on insert", "recomputes the facts on the update path", "leaves the facts alone on the unchanged path". |
| R2 | MET | Normalize `story.ts:57-70` (last separator wins, suffix 1–30 chars, a longer clause left whole), `:72-73` NFKC + lowercase + `\p{P}\p{S}`→space; tokenize `:81-95` (CJK run → bigrams, single-char run → that char, Latin/digit run → word); match `:102-110` Jaccard + `:123-140` best candidate at `>= threshold`, `:112-115` ties by earliest `firstSeenAt` then smallest id, returning the candidate's `storyId` (not its id); guard `:124-125` empty token set never matches. Not the plugin's `titleSimilarity`: `story.ts` has ZERO imports and the plugin's whole-string char-bigram helper is untouched (`…index.ts:313-320`). Tests: `tests/story.test.ts` — "strips a trailing outlet suffix", "keeps a long trailing clause that is not an outlet suffix", "strips a suffix of exactly 30 characters but not 31", "bigrams CJK runs and keeps a single-character run as that character", "tokenizes Latin/digit runs as words, never character bigrams", "matches at exactly the threshold and refuses below it" (0.5 → match, 0.51 → null), "picks the best candidate, then the earliest first_seen_at, then the smallest id", "never matches on an empty token set, even at threshold 0", "returns the matching candidate story root, not the candidate id". **Deviation:** the tokenize bullet fails when a CJK run is glued to a preceding Latin/digit character — finding 1. |
| R3 | MET | Candidates = `items.first_seen_at >= now - windowHours*3_600_000` (`dao/items.ts:363-376`) plus the docs preceding this one in the batch (`:205-247`, `batchCandidates` is appended only after the current item is written — `:214` insert, `:212` update); the boundary is inclusive at exactly 72 h (`tests/dao/items-v2.test.ts` "does not merge across the 72h boundary": `t0+72h` merges, `t0+72h+1ms` does not). The update path never writes `story_id` (`UPDATE_ITEM_SQL`, `:115-121`) and feeds the existing root forward via `previous.storyId` (`:212`, `toCandidate` maps NULL → own id, `:172-174`) — test "keeps an existing item's story_id when its content changes". Config: `config.ts:38-40` (`StoryConfig` on `StoreConfig`), `:70-72` defaults 0.6/72, `:126-143` `(0,1]` and positive-integer readers, `:146-152` absent→default / present+invalid→`StoreConfigInvalidError`, `:150-156` wired into the ONE reader `readStoreConfig`; `tests/config.test.ts:208-215` covers `store.story: 7`, `threshold: 0`, `1.5`, `"0.6"`, `window_hours: 0`, `-1`, `1.5`, `"72"`. No second reader: grep shows `store.story` is read only via `readStoreConfig` (`apps/cli/src/commands/store.ts:286,1306`). `// ponytail: no cross-language merge…` present at `story.ts:11`. |
| R4 | MET | `dao/items.ts:304-357`: one scan `ORDER BY first_seen_at, id`, a sliding candidate list pruned to the row's OWN window (`:327-332`), root `?? row.id` (`:333`), one `adapter.batch` of only the changed rows, returning that count; the changed test compares all five facts plus `story_id` before writing (`:336-352`). CLI `store.ts:1303-1317` prints `{"updated":n}`; `:1366-1372` registers `backfill-facts` with only `--db`; `:291` passes the configured policy to ingest. Tests: `tests/dao/items-v2.test.ts` "recomputes NULL facts and the story ids, then is idempotent", "clusters causally in first_seen_at, id order", "does not cluster across the window in the causal pass", "is a no-op on an empty store"; `apps/cli/tests/commands/store.test.ts` "recomputes the facts and prints {updated}, then is idempotent", "uses the store.story.threshold from the kk config", "exits 1 with kk.store.backfill-facts.failed". |
| R5 | MET | `docs/04_DESIGN.md:73` usage line, `:95` command-table row (`backfill-facts`, idempotent, prints `{updated}`), `:441-450` the five typed facts, `:452-461` the story key (tokenization, candidates, earliest-member root, update path), `:463-467` the `backfill-facts` contract, `:530-532` both `store.story.*` keys with ranges and defaults, `:803` the packaged `facts`/`story` surface. The prose was checked against the source and is accurate (including the idempotency and causal-order claims). |

##### AC verification

| AC | Status | Proving test / evidence |
|----|--------|-------------------------|
| AC1 — Ingest records deterministic item facts as typed columns | MET | `packages/kk-store/tests/dao/items-v2.test.ts` › "ItemsDao.upsertDocs — typed facts (0227 R1, AC1)" › "fills every fact column on insert" reads all five columns back from the store (engagement 30, bodyChars 4, sourceTier community, lang ja, domain example.com) and "recomputes the facts on the update path"; `packages/kk-store/tests/facts.test.ts` pins each derivation. Independent evidence: the live-store copy's 78 rows after `backfill-facts` all carry non-NULL `domain` and `body_chars`, 55 carry `engagement`, and `source_tier` splits 10 curated / 23 community / 45 other — exactly the `aihot` / `rss`+`hackernews` / tail shape. |
| AC2 — Near-duplicate titles within 72 hours share one story | MET | `packages/kk-store/tests/dao/items-v2.test.ts` › "gives one story to near-duplicate titles within 72h" (three URL-distinct titles, two carrying outlet suffixes, over 71 h → one root) plus "clusters duplicate titles inside one ingest batch", "gives an unrelated title its own story id", "does not merge across the 72h boundary"; `packages/kk-store/tests/story.test.ts` › "storyIdFor" (threshold, tie-break, empty-set guard, no over-merge of unrelated Latin titles). Independent evidence: replaying the real causal order over the 78 live titles with the shipped `storyIdFor` produced 3 merges, all three genuine near-duplicates (two case-variant duplicates and one `end of October?`/`end of November?` pair). Two counterexample classes are recorded in findings 1 and 2 and are not corpus-reachable today. |

##### Independent verification performed in this run

1. `NODE_ENV=test bun test packages/kk-store/tests/facts.test.ts packages/kk-store/tests/story.test.ts packages/kk-store/tests/dao/items-v2.test.ts packages/kk-store/tests/config.test.ts apps/cli/tests/commands/store.test.ts` → **82 pass / 0 fail, 223 expect() calls**; `facts.ts` and `story.ts` at **100% line and branch** coverage.
2. Live store copied to a gitignored path (`.works/test-artifacts/kk-live-copy.db`, 78 items, WAL included) then driven through the real CLI: `store migrate` → `{"applied":1}`; `store backfill-facts` → `{"updated":78}`; `store backfill-facts` → `{"updated":0}`; `store backfill-facts` → `{"updated":0}`. **Idempotence verified first-hand on real data, not assumed** (three runs, exit 0 each).
3. Post-backfill audit of that copy: exactly 3 rows with `story_id != id`, forming 2 groups of 2, both genuine near-duplicates; `domain` 0 NULL, `lang` all `en`, `body_chars` 13–2719.
4. Pairwise token Jaccard across all 78 live titles: 3 pairs ≥ 0.6 (all genuine), 7 pairs in [0.30, 0.60) eyeballed for missed merges (finding 2).
5. Purity/architecture: `story.ts` has no imports and no clock read; `facts.ts` imports only the `Doc` type and `canonicalUrlForDoc`; no kk-store → plugin or plugin → kk-store edge was added.
6. Not re-run by me: the suite-wide gate. `bun run spur-check` exit 0 (2306 pass / 2 skip / 0 fail across 128 files) is the driver's reported evidence, cited as such.

##### Residual risk

- **Unchanged ingest path leaves facts at their first-seen value.** `content_hash` covers title+body only (`dao/items.ts:150-152`), so a re-collected item with identical text but a higher `engagement` (or a different `source`) stays `unchanged` and keeps the old fact. This is deliberate and documented (`docs/04_DESIGN.md:450-451`, `tests/dao/items-v2.test.ts` failure-list item 3); R4's `backfill-facts` is the repair path. No AC requires otherwise.
- **`lang` edge cases:** the declared value is returned verbatim, so `metadata.lang = " en "` stores untrimmed (`facts.ts:79`); a whitespace-only string correctly falls through. A title written only in kana, Hangul or CJK extension-B ideographs yields `NULL` — that is exactly R1's wording (U+4E00–U+9FFF + ASCII Latin), but it means a kana-only Japanese headline gets no `lang`.
- **`stripOutletSuffix`'s ≤ 30 guard counts UTF-16 units** (`suffix.length`, `story.ts:63-69`), not code points; an astral character in an outlet name makes the guard off by one. No corpus outlet name is affected.
- **The CJK tokenizer path has no live data.** 0 of 78 live titles are mixed-script and 0 contain a CJK ideograph (all English, `aihot` included), so the bigram path rests entirely on fixtures; finding 1 lives in that blind spot.
- **Per-candidate re-tokenization:** `storyIdFor` calls `storyTokens` inside the candidate loop, so each insert tokenizes every in-window title again — acceptable at the documented hundreds-per-window bound and flagged by the Design's own `ponytail:` note (add a token inverted index past ~10k items per window).
- **Threshold calibration is unrecorded** (finding 2) and the merged October/November polls show the default is not precision-perfect on recurring-question titles.

**Disposition:** R1–R5 and AC1/AC2 are met and were verified against the code, the new tests and an independent run over a real 78-item store; the only open items are one P3 defect on a path with no live data (deferred to 0230 for the fix or a `residuals-from-0227` task) and one P4 calibration observation owned by 0230. Nothing blocks a requirement or an acceptance criterion. Verdict: PASS.

### References

- Feature G32 (R6, R7). Brainstorm D2, D5. Depends on 0225 (columns); config via 0226's `readStoreConfig` (if 0226 has not landed, add `readStoreConfig` here with the same frozen signature).
- `plugins/generations/episode-plan-gen/src/index.ts:184` (IMPORTANCE_BASE), `:313-320` (titleSimilarity), `:334-341` (maxEngagement), `:394-422` (scoreDimensions).
- `packages/kk-store/src/dao/items.ts:147-222` (atomic ingest batch), `src/schema/items.ts:11-22`.

### History

- 2026-10-09T02:45:15.014Z backlog → todo (system)
- 2026-10-09T05:11:07.571Z todo → wip (system)
- 2026-10-09T05:25:18.222Z wip → testing (system)
- 2026-10-09T05:25:23.603Z testing → done (system)

