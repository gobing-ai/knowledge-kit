---
schema_version: 1
name: "New item decisions: kk-item-china-politics, kk-item-sensitivity, kk-item-audience with conservative gate"
status: done
template: feature-impl
created_at: 2026-10-09T01:27:20.364Z
updated_at: "2026-10-09T07:12:13.701Z"
feature_id: G32

dependencies: ["0226"]
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0229-verdict.json
---

## 0229. New item decisions: kk-item-china-politics, kk-item-sensitivity, kk-item-audience with conservative gate

### Background

G32 D3 adds three judgment dimensions to prepare a normalized topic-selection logic.

**`kk-item-china-politics`.** The operator scoped it narrowly. It covers China's current political system and institutions, and the top leader's personal information. Its purpose is to avoid unnecessary platform-moderation rejection. It must NOT exclude China-related content in general: Chinese AI companies, models, industry and ordinary regulation news stay eligible.

**`kk-item-sensitivity`.** Broader publish risk: unverified claims, legal exposure, other political sensitivity.

**`kk-item-audience`.** Routes items to future topics by reader depth.

Depends on 0226 (raw observations, priority and threshold).

**Refine corrections (2026-10-08)**

- **The profile would reject the new ids.** `packages/kk-store/src/profile.ts:20-26` `ITEM_DECISION_IDS` is the closed list a profile may name (`:109-112`), so R4's gate would fail with `kk.store.profile.invalid`. This is added as R6.
- **The label loop is hard-wired to five decisions.**
  - `CATEGORY_LABELS` (`store.ts:62`) and `SCORE_DIMENSIONS` (`:65`) drive `labelItem` (`:641-685`).
  - `decisionValue` (`:566-572`) accepts only category labels or integers 0–5. A china-politics `4` would be accepted, and an audience label would be rejected.
  - Corrected in R3.
- **The prefilter was not a floor.** As filed, a keyword hit wrote a `heuristic` row with value 3. Under 0226's default priority `['*', 'heuristic']`, any model answer outranks it: a model `0` on an item naming the top leader would pass the gate. Corrected: the prefilter writes maker `keyword`, and the per-decision priority default for `kk-item-china-politics` ranks `keyword` first. A hit is then a hard floor, and a non-hit has no `keyword` row and falls through to the model.
- **Rubric range is verified.** Catalog `score` criteria are an ordered list of at least 2 levels, and the value is an integer in `[0, levels-1]` (`@gobing-ai/spur/schemas/decision-catalog.schema.json:138-140,182-197`). Four criteria give 0–3.
- **Fallback values do not affect selection.** A spur `source: default` row is excluded from `labels_current` (0226 R4), so fail-closed comes from "no current row", not from a fallback value.

### Requirements

- [x] R1. Add `kk-item-china-politics` (`type: score`, 4 criteria → 0–3, `fallback: 3`) to `plugins/kk/decisions/kk-items.yaml`. Levels:
  - 0 — no reference to China's political system, institutions or top leader. Chinese companies, models and products count as 0.
  - 1 — a factual mention of a Chinese government body or policy as news context (CAC filing, export rule).
  - 2 — commentary or analysis of the political system or institutions.
  - 3 — the top leader's personal information, or a direct critique of the system.

  The `description` states the moderation purpose and the not-exclude-China rule verbatim. Parameters are `title` and `source`, the same as the siblings.
- [x] R2. Add the other two decisions:
  - `kk-item-sensitivity`: `type: score`, 4 criteria (none / mild / notable / high publish risk), naming unverified claims, legal exposure and political sensitivity, `fallback: 1`.
  - `kk-item-audience`: `type: choice`, labels `general`, `practitioner`, `researcher`, `fallback: general`.
- [x] R3. Generalize the label pass in `apps/cli/src/commands/store.ts` onto one table, `LABEL_DECISIONS: readonly LabelDecision[]`, where `LabelDecision = { id, kind: 'choice', labels } | { id, kind: 'score', levels }`. It holds the existing five plus the new three. `decisionValue` validates against that entry. Routing:
  - the existing five keep today's heuristic-first routing;
  - the new three are consulted for **every** labelled item in both modes, because the heuristic has no signal for them;
  - their consults count in `consults` / `consultMs`.
- [x] R4. The china-politics keyword prefilter is a case-insensitive substring match over title plus body head (first 200 chars) against `store.labels.china_politics_terms` (a `readStoreConfig` key: a string[], with a built-in default list of top-leader and central-institution terms only, e.g. 习近平, 总书记, 中共中央, 政治局, 中南海, Xi Jinping, Politburo, Zhongnanhai; never generic terms like 中国 / China / Beijing).
  - On a hit it writes a `kk-item-china-politics` observation with `maker 'keyword'`, `source 'heuristic'`, value `3`, `reason 'keyword:<term>'`.
  - `readStoreConfig` defaults `decisionPriority['kk-item-china-politics']` to `['keyword', '*', 'heuristic']`, which applies when the operator sets none.
  - The model is still consulted on a hit, so backtesting keeps both rows.
- [x] R5. `plugins/kk/decisions/extract/ai-news.yaml` gains `kk-item-china-politics: { lte: 1 }`. A `where` key is an inner join on `labels_current`, so an item with no current china-politics answer is excluded (fail-closed). This is pinned by a test.
- [x] R6. Add the three ids to `ITEM_DECISION_IDS` (`packages/kk-store/src/profile.ts:20`) and update its lockstep comment.
- [x] R7. A fixture set of real titles covers every china-politics level. It includes at least three Chinese-AI-industry items (e.g. a DeepSeek/Qwen/Kimi release) that must score 0, and at least one keyword hit. The tests run against a recorded maker-answer fixture (a stubbed `runDecision`), never a live model.
- [x] R8. `docs/04_DESIGN.md` (label decisions and the `china_politics_terms` key) and design doc §4 list the new decisions, in the same commit.

### Acceptance Criteria

- [x] AC1 — New judgment decisions label every new item, and china-politics gates conservatively

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T01:29:42.279Z

- **Fail-closed vs. pool emptiness.** If the model backend is down for a whole collect run, new items lack a china-politics answer and the ai-news pool shrinks. The operator accepted this trade-off: the purpose is moderation safety. The keyword prefilter only adds exclusions.
- **Per-platform thresholds** (e.g. stricter for xhs/wechat) are out of scope. This task ships a profile-level gate only.

#### Q&A entry — 2026-10-09T02:42:25.732Z

- **Q: How does a keyword hit beat a model answer?** Through priority, not value. Closed: maker `keyword` is ranked first for this decision by default, so a hit is a hard floor while a non-hit defers to the model.
- **Q: Does the catalog fallback value matter?** No. Closed: `source: default` rows never become current (0226 R4), so fail-closed comes from the missing row.

### Design

**Frozen names**:

| Kind | Names |
|---|---|
| Decision ids | `kk-item-china-politics`, `kk-item-sensitivity`, `kk-item-audience` |
| Label table | `LABEL_DECISIONS`, `LabelDecision` |
| Maker | `keyword` |
| Config key | `store.labels.china_politics_terms` |
| Reason format | `keyword:<term>` |

**Decisions**:

- Each new item costs three extra consults. Use the cheapest maker that clears the backtest later; until then, the configured default maker.
- Catalog `minConfidence` stays 0 (0226). A below-threshold model answer is ineligible. Without a `keyword` row, the item then has no current china-politics value and is excluded.
- Per-platform thresholds are out of scope; the gate is profile-level.

**Concurrency**: design doc §4 carries another session's uncommitted edits. Apply the same rule as 0228: edit on top of the working copy and commit only this task's hunks.

**Anti-patterns**:

- Generic China terms in the prefilter; they would violate D3a by excluding China-related content.
- Writing the prefilter as maker `heuristic`.
- Special-casing the new ids outside `LABEL_DECISIONS`.
- Live model calls in tests.

**Handoffs**: **0230** reviews live china-politics distributions and records the false-positive and false-negative notes from the dogfood.

### Plan

1. Write the failure-first list:
   - backend down (no china-politics row, so the item is excluded);
   - an out-of-vocabulary audience value;
   - a score of 4 for a 0–3 decision;
   - a prefilter false positive on a company name;
   - Chinese-industry news wrongly scoring high;
   - a keyword hit where the model answers 0 (`keyword` must win);
   - an operator override of the china-politics priority.
2. Add the catalog entries and run `spur decision status --json` (expect ok); `spur decision show kk-item-china-politics --json` shows 4 levels.
3. Add `LABEL_DECISIONS`, the routing, the prefilter, the config key and the per-decision priority default.
4. Add the `ITEM_DECISION_IDS` entries, the profile gate and its fail-closed test.
5. Update docs (R8) and run `bun run gate`.

### Solution

Task 0229 R1–R8. Every new decision uses the frozen names; no test calls a live model (`KK_SPUR_BIN` stub only).

**Catalog (R1/R2)** — `plugins/kk/decisions/kk-items.yaml:121` adds `kk-item-china-politics` (score, 4 criteria → 0–3, `fallback: 3`, `title`+`source`, description carrying the moderation purpose and the not-exclude-China rule verbatim), `:144` `kk-item-sensitivity` (score, 4 criteria none/mild/notable/high publish risk, `fallback: 1`), `:165` `kk-item-audience` (choice `general`/`practitioner`/`researcher`, `fallback: general`).

**Config (R4)** — `packages/kk-store/src/config.ts:23` `CHINA_POLITICS_DECISION_ID`; `:31` `DEFAULT_CHINA_POLITICS_TERMS` (top-leader / central-institution only — 习近平, 总书记, 中共中央, 政治局, 中南海, 党中央, Xi Jinping, Politburo, Zhongnanhai; never 中国 / China / Beijing); `:48` `DEFAULT_CHINA_POLITICS_DECISION_PRIORITY = ['keyword','*','heuristic']`; `:62` `StoreLabelConfig.chinaPoliticsTerms`; `:118` `readStringList` (fail-loud, shared with the priority reader); `:153-156` reads the `store.labels.china_politics_terms` key; `:171-173` applies the per-decision priority default when the operator sets none. Exported from `packages/kk-store/src/index.ts:12-14`.

**Label pass (R3/R4)** — `apps/cli/src/commands/store.ts:87-118`: `LabelDecision` (`{ id, kind: 'choice', labels } | { id, kind: 'score', levels }`), `LABEL_DECISIONS` (the existing five plus the new three — the ONE table), `HEURISTIC_DECISION_IDS` (the heuristic's annotation surface), `KEYWORD_MAKER = 'keyword'`, `CHINA_POLITICS_BODY_HEAD = 200`. `apps/cli/src/commands/store.ts:651-674` `labelDecision` / `decisionValue` / `scoreOf` validate a value against its own table entry (a `4` is rejected for a 0–3 decision and accepted for a 0–5 one; an audience label outside the vocabulary is rejected). `:757` `heuristicValueFor`; `:774` `matchedChinaPoliticsTerm` (case-insensitive substring over title plus the body head); `:787` `keywordRow` (maker `keyword`, source `heuristic`, value `3`, `reason 'keyword:<term>'`); `:823` `labelItem` iterates the table — the heuristic's five keep the routed-only consult, the three judgment decisions are consulted for EVERY labelled item in both modes and their consults count in `consults`/`consultMs`, and on a china-politics hit the floor row is written while the model is still consulted. `:894` `CATALOG_DECISION_IDS` is derived from the table (so `--decisions`/replay defaults follow it). `:1154-1178` one `readStoreConfig` read feeds both the policy and the prefilter terms.

**Profile gate (R5/R6)** — `plugins/kk/decisions/extract/ai-news.yaml:26` adds `kk-item-china-politics: { lte: 1 }` (inner join on `labels_current`, so an unjudged item is excluded); `packages/kk-store/src/profile.ts:22-30` `ITEM_DECISION_IDS` gains the three ids, comment updated to lockstep.

**Docs (R8)** — `docs/04_DESIGN.md` (the `store label`/`store extract` verb rows, the eight decisions + routing/prefilter paragraph, the `china_politics_terms` key and the priority default, the profile block + fail-closed note); `docs/design/kk-collect-and-daily-voice2.md` §4 (three table rows, the judgment/prefilter paragraph, the cost-control note of three extra consults, the profile block, `ITEM_DECISION_IDS`).

**Tests (R7 + the Plan's failure-first list)** — `apps/cli/tests/store-label.test.ts:886` a new describe block against a stubbed `runDecision`: (1) AC1 — a keyword hit is a hard floor (maker `keyword` value 3 beats model 0; both rows kept; the item is excluded), (2) backend down ⇒ no current china-politics row ⇒ the item is excluded (fail-closed), (3) a real-title fixture for every level (DeepSeek/Qwen/Kimi score 0, policy 1, commentary 2, leader 3) with the pool admitting 0/1 and dropping 2/3, (4) the prefilter does not fire on a company name, (5) an out-of-vocabulary audience value is rejected, (6) a score 4 is rejected for 0–3 but accepted for 0–5, (7) an operator per-decision priority override flips the selection. `apps/cli/tests/store-label.test.ts:443` and the routed/raw/AC2/replay counts move to the eight-decision table. `apps/cli/tests/store-extract.test.ts:348` pins the fail-closed gate over the shipped profile; `apps/cli/tests/store-selections.test.ts` seeds the china-politics label the shipped gate now requires; `packages/kk-store/tests/config.test.ts` (terms key + priority default + malformed key); `packages/kk-store/tests/profile.test.ts` (the shipped predicate + the three ids); `plugins/kk/tests/decision-catalog.test.ts` (eight ids, the new rubrics/fallbacks, the verbatim scope rule).

**Known blocker — PRE-EXISTING, not this task.** `spur decision status --json` returns `ok:false` with exactly one `loadError`: `plugins/kk/decisions/kk-items.yaml` `version: 2` vs the installed `@gobing-ai/spur@0.4.0` schema `version: { const: 1 }`. That `version: 2` is uncommitted predecessor work (task 0226 R1 — `git diff` shows `version: 1 → 2`), which this task must not revert, and `grep -A2 '"version"'` over every cached spur schema on this machine confirms the const is `1`. So `spur decision show kk-item-china-politics --json` cannot load the catalog in this environment. Substituted evidence: validating the same document against that installed schema with ajv (patching `version` to 1 in memory) is VALID with zero errors, and as shipped the ONLY error is the `version` const — so the three new decisions add no schema error; the hermetic contract test pins their ids, level counts, fallbacks and parameters.

#### Cross-task correction applied by the batch driver (2026-10-09)

Implementing R1 surfaced a **spec-level defect inherited from task 0226 R1**, which the deliverable cannot work
without fixing: 0226's R1 mandated bumping the catalog `version: 1` → `2`, but the installed
`@gobing-ai/spur@0.4.0` schema pins `version` to the literal `1`
(`node_modules/@gobing-ai/spur/schemas/decision-catalog.schema.json` → `{"const": 1}`; same in the bun install
cache). With `version: 2` the whole catalog refused to load — `spur decision status --json` returned
`ok: false` with `Decision catalog "plugins/kk/decisions/kk-items.yaml" failed to parse or validate` — so
**every `spur decision run` consult was dead** (the label pass routes all three new judgment decisions, and the
existing five, through `spur decision run`; `apps/cli/src/commands/store.ts:394,610,1104`). That is the feature's
core path, so the batch driver reverted the bump and corrected the assertions that pinned it:

- `plugins/kk/decisions/kk-items.yaml:13` — `version: 1` again (`defaults.minConfidence: 0` from 0226 stays).
- `plugins/kk/tests/decision-catalog.test.ts:83` — asserts `1`, with the header note reworded.
- `apps/cli/tests/store-label.test.ts:314,431,708` — assert `version: 1` / `catalog_version === '1'`.

Effect on R1–R8 of this task: none — `catalog_version` is still read from the catalog's `version` and falls back
to `'unknown'` (0226's contract, unchanged); the value is simply `'1'`. Verified after the change:
`spur decision status --json` → `{"ok":true,"registered":1,"shared":1}` with zero load errors, and
`spur decision show kk-item-china-politics --json` reports `type: score`, its four levels and `fallback: 3` —
Plan step 2, which the implement stage reported as blocked, is now satisfied.

**Consequence recorded for the operator:** `catalog_version` can no longer distinguish rubric revisions, because
`version` is schema-pinned. A revision that survives the pin (the catalog file's content hash, or a new column)
is the remaining design question; it is filed as a follow-up task rather than smuggled into 0229.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/decisions/kk-items.yaml:121-141`: `kk-item-china-politics` is `type: score` with four `criteria` levels in the mandated order (0 no reference to the system/institutions/top leader, Chinese companies/models/products count as 0; 1 a factual government-body or policy mention as news context, CAC filing / export rule; 2 commentary or analysis of the system or institutions; 3 the top leader's personal information or a direct critique), `fallback: 3`, `parameters` exactly `title` + `source`. Its `description` (`plugins/kk/decisions/kk-items.yaml:122-127`) states the moderation purpose ("Purpose: avoid unnecessary platform-moderation rejection") and the not-exclude-China rule verbatim ("It must NOT exclude China-related content in general"). Live this pass: `spur decision show kk-item-china-politics --json` exit 0, reporting `type: score`, the four levels, `fallback: 3`, parameters `title`/`source` (plus the schema-injected optional `instructions`). Suite green: `plugins/kk/tests/decision-catalog.test.ts:125` — 7 pass / 0 fail, 138 expect(). |
| R2 | MET | `plugins/kk/decisions/kk-items.yaml:144-162` `kk-item-sensitivity` — `type: score`, four levels (none / mild unverified or single-source / notable contested or legal exposure / high defamatory or acute political sensitivity), `fallback: 1`; `plugins/kk/decisions/kk-items.yaml:165-179` `kk-item-audience` — `type: choice`, `criteria` keys exactly `general`/`practitioner`/`researcher`, `fallback: general`, both with `title`+`source`. Vocabularies are closed by the label table entry and validator: `apps/cli/src/commands/store.ts:22` (`AUDIENCE_LABELS`), `apps/cli/src/commands/store.ts:46` (`kk-item-audience`, kind choice), `apps/cli/src/commands/store.ts:661-669` (`decisionValue`). Live this pass: `spur decision status --json` lists all three ids registered with zero load errors. My probe fed an out-of-vocabulary audience (`expert`) and got no audience row and no stored `expert` level (0 rows), while the in-vocabulary answers of the same pass were written. Catalog suite: `plugins/kk/tests/decision-catalog.test.ts:125`, `:157`. |
| R3 | MET | One table: `apps/cli/src/commands/store.ts:28-30` (`LabelDecision`) and `apps/cli/src/commands/store.ts:38-47` (`LABEL_DECISIONS`, the five existing + the three new), consumed by `labelDecision`/`decisionValue`/`scoreOf` at `apps/cli/src/commands/store.ts:651-674` and by `CATALOG_DECISION_IDS` at `apps/cli/src/commands/store.ts:894`; the routing loop is `apps/cli/src/commands/store.ts:846-858`. Independently probed this pass with my own `KK_SPUR_BIN` stub that appends every `$3` (decision id) it is invoked with, driving the real CLI binary (`bun apps/cli/src/index.ts`): (a) an UNROUTED item in default heuristic mode spawned exactly `['kk-item-audience','kk-item-china-politics','kk-item-sensitivity']` and printed `consults: 3, consultMs: 300` — the existing five are never spawned for it, so the heuristic keeps heuristic-first routing; (b) a routed item (`metadata.needs_model`) in default heuristic mode AND a `--mode decision` item each spawned all eight ids and printed `consults: 8, consultMs: 800` — so the three are consulted for every labelled item in both modes and their consults count. Suite green by name: `apps/cli/tests/store-label.test.ts:443` (unrouted → `spawns == JUDGMENT_IDS`, `consults: 3`), `apps/cli/tests/store-label.test.ts:474` (routed → all eight, `consults: 8`). |
| R4 | MET | Prefilter `apps/cli/src/commands/store.ts:774-780` — `(title + "\n" + body.slice(0, 200)).toLowerCase()` vs each lowercased term; the config key is read at `packages/kk-store/src/config.ts:153-156` and the priority default applied at `packages/kk-store/src/config.ts:171-173`; the hit row is `apps/cli/src/commands/store.ts:787-804` (maker `keyword`, source `heuristic`, value `3`, `reason: keyword:<term>`); the model is still consulted on a hit at `apps/cli/src/commands/store.ts:856`. My probe (7 independent checks, own real titles, own stub): a title-only hit and a body-head hit (term at body char 150) each wrote exactly one `keyword` row with `value 3`, `source heuristic`, `reason keyword:习近平`, AND the model row (`value 0`, `source model`) — both kept; a term starting exactly at body char 200 did NOT fire and the item stayed pool-eligible; a company/product item (DeepSeek/Qwen/Kimi) fired nothing; a generic item ("China's AI industry keeps growing fast", body "Beijing and 中国") fired nothing. `DEFAULT_CHINA_POLITICS_TERMS` (`packages/kk-store/src/config.ts:31-41`) is exactly the nine top-leader/central-institution terms (习近平, 总书记, 中共中央, 政治局, 中南海, 党中央, Xi Jinping, Politburo, Zhongnanhai) with no 中国 / China / Beijing; the default per-decision priority (`packages/kk-store/src/config.ts:48`) is `['keyword','*','heuristic']`. An operator config `store.labels.decisions.kk-item-china-politics.priority: [fm-local, keyword]` flipped the current value from 3 (maker `keyword`) to 0 (maker `fm-local`), so the default applies only when the operator sets none. Tests: `packages/kk-store/tests/config.test.ts:210`, `:231`; `apps/cli/tests/store-label.test.ts:1128`, `:1189`. |
| R5 | MET | `plugins/kk/decisions/extract/ai-news.yaml:26` adds `kk-item-china-politics: { lte: 1 }`; the mechanism is the join switch at `packages/kk-store/src/dao/items.ts:399` (`JOIN` for a decision in `where`, `LEFT JOIN` only for an `order`-only decision) closing over the `labels_current` CTE, with the bound predicate at `packages/kk-store/src/dao/items.ts:422`. My probe showed the mechanism rather than only the outcome: for an item whose china-politics consult exited 1, `labels` holds 0 rows for that decision, a hand-built INNER JOIN over `labels` on that decision drops it while the LEFT JOIN keeps it, and the shipped `ai-news` pool excludes it — while admitting the 0 and 1 items and dropping the 2, the 3 and the keyword floor. Test pinned at `apps/cli/tests/store-extract.test.ts:348` (only the 0 and 1 items survive; the unjudged and the 2 are absent). |
| R6 | MET | `packages/kk-store/src/profile.ts:22-31` adds `kk-item-china-politics`, `kk-item-sensitivity`, `kk-item-audience`; the lockstep comment is updated at `packages/kk-store/src/profile.ts:11-21`; the gate that rejects an unknown key is `packages/kk-store/src/profile.ts:114-117`. Test: `packages/kk-store/tests/profile.test.ts:77` ("accepts the three judgment decisions 0229 added to the catalog (R6)"), which also parses the shipped `{ lte: 1 }` predicate. |
| R7 | MET | Fixture set `apps/cli/tests/store-label.test.ts:902-971`: three Chinese-AI-industry titles (DeepSeek-V4, Qwen3.5, Kimi K2.5) recorded at 0, plus one title per level (the filing-rule item 1, the platform-cycle commentary 2, the leadership profile 3) and one keyword hit (`习近平` in the title, recorded model 0). No live model: every label invocation in the block passes `KK_SPUR_BIN` (`apps/cli/tests/store-label.test.ts:1012`, `:1078`), and the group's stub exits 1 for an id it has no recorded answer for, so a missing recording degrades rather than calling out. My own probe reproduced all four levels from my own titles on a fresh database with my own stub. |
| R8 | MET | `docs/04_DESIGN.md:98-99` — the `store label` / `store extract` verb rows name the three decisions and the gate; `docs/04_DESIGN.md:500-521` — the eight decisions, `LABEL_DECISIONS` as the one table with its validator, the judgment-decision routing, and the china-politics prefilter (title + first 200 body chars, maker `keyword`, reason format); `docs/04_DESIGN.md:541-545` — `store.labels.china_politics_terms` and the per-decision `['keyword','*','heuristic']` default. `docs/design/kk-collect-and-daily-voice2.md:85-87` (the three rubric rows), `:92-102` (routing + prefilter), `:126` (the profile gate), `:133` (`ITEM_DECISION_IDS`). Caveat stated rather than hidden: the "same commit" clause is not observable in this tree — the whole 0229 change set (code + docs) is uncommitted in the G32 batch worktree, so the docs hunks and the code hunks are one working-tree change set that will land together. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — New judgment decisions label every new item, and china-politics gates conservatively | MET | test | `apps/cli/tests/store-label.test.ts:1028` — executed by name this pass (`NODE_ENV=test bun test apps/cli/tests/store-label.test.ts -t "AC1 — a keyword hit is a hard floor"` in the worktree) → 1 pass, 0 fail, 15 expect(), exit 0; its assertions include the maker `keyword` row at value 3 with `reason 'keyword:习近平'`, the surviving model row at 0, `keyword` winning `currentFor`, and the item excluded from the shipped pool. Label-coverage half: `apps/cli/tests/store-label.test.ts:1091` — executed by name (`-t "R7 — every level is labelled from real titles"`) → 1 pass, 0 fail, 26 expect(), exit 0; all eight decisions are labelled per item and the pool admits 0/1 while dropping 2/3. Independently reproduced by my own probe against the real CLI: every routed item consulted all eight ids (8 spawns, `consults: 8`), an unrouted item consulted exactly the three new ones (`consults: 3`) while keeping its five heuristic rows, and the gate admitted 0/1 and excluded 2/3, the keyword floor and an unjudged item. Feature scenario R11 — New judgment decisions label every new item, and china-politics gates conservatively. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0229
**Scope:** 0229's files in the uncommitted G32 batch diff — catalog `plugins/kk/decisions/kk-items.yaml` + `plugins/kk/decisions/extract/ai-news.yaml`; `packages/kk-store/src/{config,profile,index}.ts`; `apps/cli/src/commands/store.ts`; the 0229 test additions in `plugins/kk/tests/decision-catalog.test.ts`, `apps/cli/tests/{store-label,store-extract,store-selections}.test.ts`, `packages/kk-store/tests/{config,profile}.test.ts`; `docs/04_DESIGN.md` + `docs/design/kk-collect-and-daily-voice2.md` §4. 0225–0228 hunks and the residuals filed as 0231–0235 were not re-litigated.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | usability | Post-revert prose still says "version 2": the catalog-version test is *titled* "is the bundled schema version 2 …", its inline comment reads "Version 2 since task 0226 …", and the sibling test is *titled* "R1 — the catalog declares version 2 …". All three assertions pin `version: 1` / `catalog_version === '1'` correctly, and the correction paragraph is accurate — only the descriptive text was left behind, so the tests now contradict their own names. | `plugins/kk/tests/decision-catalog.test.ts:71`, `:81`; `apps/cli/tests/store-label.test.ts:311` | ACCEPTED (0230 doc-sync) |
| 2 | P4 (advisory) | correctness | R7 coverage limit, by design: the fixture answers are *recorded* model values, so the suite proves the label pass preserves the recorded level and the prefilter/gate do not derail it — it cannot prove a live model actually scores the DeepSeek/Qwen/Kimi titles 0. The failure-first item "Chinese-industry news wrongly scoring high" is therefore exercised only against a stub. | `apps/cli/tests/store-label.test.ts:1091-1125` (the R7 test; recorded answers via `labelOne` → `acceptedAnswers`, `:126-142`, served by `stubSpur`, `:172`) | DEFER (0230) |
| 3 | P4 (advisory) | correctness | The default term list carries bare honourifics/institution names that are not China-unique — `总书记`, `政治局`, `Politburo`. A non-China leader story (e.g. a Vietnamese or historical Soviet Politburo item) matches, is floored to 3, and is excluded by `lte: 1`. This is in-spec (the operator's own example list) and over-exclusion is the accepted trade-off, but the fixture set does not exercise it, so it belongs in the live false-positive notes. | `packages/kk-store/src/config.ts:31-46`; the floor path `apps/cli/src/commands/store.ts:774-800` | DEFER (0230) |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/kk/decisions/kk-items.yaml:121-140` — `type: score`, `criteria` = the four levels verbatim (0 no reference / 1 factual CAC-or-export mention / 2 system commentary / 3 top-leader personal info or direct critique), `fallback: 3`, `parameters: title` + `source`. `description` carries the scope rule verbatim ("must NOT exclude China-related content in general", "Purpose: avoid unnecessary platform-moderation rejection"). Live: `spur decision show kk-item-china-politics --json` → `type: score`, 4 levels, `fallback: 3`. |
| R2 | MET | `kk-items.yaml:144-161` sensitivity (4 criteria naming unverified claims / legal exposure / political sensitivity, `fallback: 1`); `:165-179` audience (`type: choice`, keys exactly `general`/`practitioner`/`researcher`, `fallback: general`). Vocabulary closed by the table entry + validator: `apps/cli/src/commands/store.ts:81,105,661-669`. |
| R3 | MET | ONE table: `store.ts:87-105` `LabelDecision` + `LABEL_DECISIONS` (five + three). `labelDecision`/`decisionValue`/`scoreOf` (`:651-673`) validate against the entry — `4` rejected for a 0–3 decision, accepted for a 0–5 one; an out-of-vocabulary audience label rejected. Routing: `labelItem` (`:823-858`) skips the consult for a heuristic-annotated decision when unrouted (`:851`) but always reaches the judgment three — both modes; `consults`/`consultMs` increment inside `decide()` (`:839-844`) and are reported at `:1026`. Regression check on the five: `apps/cli/tests/store-label.test.ts:443` asserts `spawns == JUDGMENT_IDS` for an unrouted item (the five are NOT spawned) and `consults: 3`; the routed test (`:481`) asserts all eight spawn and `consults: 8`. |
| R4 | MET | Prefilter `store.ts:774-781`: `(title + "\n" + body.slice(0, 200)).toLowerCase()` vs each `term.toLowerCase()` — case-insensitive substring, title + 200-char body head. Default list `config.ts:31-46` — 习近平, 总书记, 中共中央, 政治局, 中南海, 党中央, Xi Jinping, Politburo, Zhongnanhai; no 中国/China/Beijing (also asserted at `apps/cli/tests/store-label.test.ts:1128-1132` and `packages/kk-store/tests/config.test.ts:231-243`). Hit row `store.ts:787-801`: maker `keyword`, source `heuristic`, value `3`, `reason: keyword:<term>`; the model is still consulted at `:855-856` (both rows kept). Priority default `config.ts:171-173` only when the operator set none (an explicit override wins — `config.ts:166-170`, tested `store-label.test.ts:1188-1219`); ranking `packages/kk-store/src/dao/labels.ts:92-104` puts `keyword` at 0, `'*'` at 1, `heuristic` at 2. Not maker `heuristic`. |
| R5 | MET | `plugins/kk/decisions/extract/ai-news.yaml:26` gains `kk-item-china-politics: { lte: 1 }`; `packages/kk-store/src/dao/items.ts:399` emits an INNER `JOIN <labels_current>` for a decision named in `where` (LEFT JOIN only for `order`) — an item with no current china-politics row cannot survive, so the gate is fail-closed from the join, not from a fallback value. Proven end to end through the shipped profile by `apps/cli/tests/store-extract.test.ts:348` (only the 0 and 1 items survive; the unjudged and the 2 are absent) and by `store-label.test.ts:1069` (backend down ⇒ excluded) and `:1168` (out-of-range 4 ⇒ no row ⇒ excluded). |
| R6 | MET | `packages/kk-store/src/profile.ts:22-30` — the three ids added; lockstep comment at `:13-21` updated. Test: `packages/kk-store/tests/profile.test.ts` "accepts the three judgment decisions 0229 added to the catalog (R6)". |
| R7 | MET | `apps/cli/tests/store-label.test.ts:886-1240` — real titles for all four levels (DeepSeek-V4 `0`, Qwen3.5 `0`, Kimi K2.5 `0`, filing rule `1`, platform-cycle commentary `2`, leadership profile `3`) + one keyword fixture; every consult goes through `stubSpur` (`KK_SPUR_BIN`, `:172`), no live model. Pool assertions at `:1113-1123` (0/1 admitted, 2/3/keyword dropped). |
| R8 | MET | `docs/04_DESIGN.md:98-99` (verb rows), `:500-545` (eight decisions, the one table + validator, judgment routing, the prefilter, `china_politics_terms` + the priority default), `:600-636` (profile block + the fail-closed note); `docs/design/kk-collect-and-daily-voice2.md:78-126` (three rows, the judgment/prefilter paragraph, the three-extra-consults cost note, the profile block). Docs hunks sit in the same uncommitted batch as the code, so "same commit" holds only once the batch commit lands. |

##### AC verdicts (one row per criterion)

| AC | Verdict | Proving test |
|----|---------|--------------|
| AC1 — New judgment decisions label every new item, and china-politics gates conservatively | MET | `apps/cli/tests/store-label.test.ts` — "AC1 — a keyword hit is a hard floor: maker `keyword` value 3 beats a model 0, and the item is excluded" (both rows kept, `keyword` current at value 3, pool excludes the item) and "R7 — every level is labelled from real titles: 0 for the Chinese-AI items, 1/2/3 for the rest" (all eight decisions labelled per item; the pool admits 0/1 and drops 2/3). Run: `bun test apps/cli/tests/store-label.test.ts` → 22 pass / 0 fail. |

##### Cross-task correction — independently verified

The batch driver's reverted `version: 2 → 1` is correct and necessary, verified from the installed runtime rather than from the prose:

- The `spur` on PATH resolves to `/Users/robin/node_modules/@gobing-ai/spur/spur.js`, i.e. **`@gobing-ai/spur@0.4.0`**, whose `schemas/decision-catalog.schema.json` declares `properties.version = {"const": 1}` and lists `version` as required. The bun install-cache copies of that schema carry the same `{"const": 1}`.
- With `plugins/kk/decisions/kk-items.yaml:13` back at `version: 1`, the catalog loads: `spur decision status --json` → `{"ok": true, "loadErrors": [], "duplicateIds": []}` with layers `project 0 / registered 1 / shared 1`.
- `spur decision show kk-item-china-politics --json` returns `type: score`, the four level strings, `fallback: 3`, and `parameters` `title` + `source` (plus the schema-injected optional `instructions`) — Plan step 2 is satisfied.
- The assertions now pin `1`: `plugins/kk/tests/decision-catalog.test.ts:83` (`expect(catalog.version).toBe(1)`), `apps/cli/tests/store-label.test.ts:313` (`toContain('version: 1')`), `:431` and `:708` (`catalog_version === '1'`).

I agree with the correction and with the consequence recorded for the operator: `version` is schema-pinned, so `catalog_version` can no longer distinguish rubric revisions. One caveat on the record itself — the `## Solution` section still carries the superseded "Known blocker — PRE-EXISTING" paragraph (`docs/tasks/0229_…md:145`) stating that the catalog cannot load in this environment, directly above the correction paragraph that says it does. The implementer owns `## Solution`, so this review does not rewrite it; it is flagged for the same doc-sync pass as finding 1.

##### Verification evidence (this run)

| Command | Result |
|---------|--------|
| `spur decision status --json` | `ok: true`, zero `loadErrors`, registered 1 / shared 1 |
| `spur decision show kk-item-china-politics --json` | score, 4 levels, `fallback: 3` |
| `bun test plugins/kk/tests/decision-catalog.test.ts` | 7 pass / 0 fail |
| `bun test apps/cli/tests/store-label.test.ts` | 22 pass / 0 fail |
| `bun test apps/cli/tests/store-extract.test.ts apps/cli/tests/store-selections.test.ts` | 27 pass / 0 fail |
| `bun test packages/kk-store/tests/config.test.ts packages/kk-store/tests/profile.test.ts` | 23 pass / 0 fail |
| `bun test apps packages plugins scripts` (full suite, `--timeout 20000`) | 2336 pass / 2 skip / 0 fail (2338 across 129 files) |
| `bunx biome check` on the nine 0229 source/test files | no fixes applied |
| `bunx tsc --noEmit` in `packages/kk-store` and `apps/cli` | exit 0 both |

##### Residual risk

- Live china-politics distributions — whether a real model actually places DeepSeek/Qwen/Kimi items at 0 and whether the prefilter's bare honourifics false-positive on non-China leader stories — are unmeasured here; findings 2 and 3 are the formal record, owned by 0230 (the feature's declared handoff for false-positive/false-negative notes).
- `LABEL_DECISIONS` (`store.ts:97-105`) restates the catalog's vocabularies and level counts (`levels: 4/6`, `AUDIENCE_LABELS`) rather than deriving them from `kk-items.yaml`. Frozen by R3's design, and the failure mode is safe (a rubric that outgrew its entry makes an answer invalid ⇒ no row ⇒ the item is excluded, fail-closed), but nothing pins the two files in lockstep for the new ids.
- `catalog_version` is now always `'1'` (schema-pinned), so stored observations can no longer say which rubric revision produced them — already recorded by the batch driver as a follow-up design question.
- The cross-path/architecture pass on this task raised no deepening opportunity worth a finding: the label pass already routes through one table + one config read (`store.ts:1154-1178`), and the prefilter sits behind a pure function (`:774`).
- Unrun checks: `bun run gate` as a whole was not executed (its `spur-check` step runs the rule presets); the equivalent substance — biome, typecheck, the full test suite — was run separately and is reported above.

**Disposition:** PASS — R1–R8 and AC1 verified with fresh, pasted evidence; no P1–P3 finding; three P4 advisories dispositioned to 0230. No fix was implemented by this review.

### References

- Feature G32 (R8). Brainstorm D3, D3a (operator clarification). Depends on 0226 (`readStoreConfig`, per-decision priority, `labels_current`).
- `apps/cli/src/commands/store.ts:61-65,566-572,641-685`; `packages/kk-store/src/profile.ts:12-26,109-112`; `plugins/kk/decisions/kk-items.yaml`; `plugins/kk/decisions/extract/ai-news.yaml`.
- Catalog schema: `@gobing-ai/spur/schemas/decision-catalog.schema.json:138-140,182-197` (score levels = criteria length).

### History

- 2026-10-09T02:45:16.215Z backlog → todo (system)
- 2026-10-09T06:55:09.344Z todo → wip (system)
- 2026-10-09T07:12:08.091Z wip → testing (system)
- 2026-10-09T07:12:13.677Z testing → done (system)

