---
schema_version: 1
name: "New item decisions: kk-item-china-politics, kk-item-sensitivity, kk-item-audience with conservative gate"
status: todo
template: feature-impl
created_at: 2026-10-09T01:27:20.364Z
updated_at: "2026-10-09T02:45:16.215Z"
feature_id: G32

dependencies: ["0226"]
priority: P2
estimate_hours: 4
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

- [ ] R1. Add `kk-item-china-politics` (`type: score`, 4 criteria → 0–3, `fallback: 3`) to `plugins/kk/decisions/kk-items.yaml`. Levels:
  - 0 — no reference to China's political system, institutions or top leader. Chinese companies, models and products count as 0.
  - 1 — a factual mention of a Chinese government body or policy as news context (CAC filing, export rule).
  - 2 — commentary or analysis of the political system or institutions.
  - 3 — the top leader's personal information, or a direct critique of the system.

  The `description` states the moderation purpose and the not-exclude-China rule verbatim. Parameters are `title` and `source`, the same as the siblings.
- [ ] R2. Add the other two decisions:
  - `kk-item-sensitivity`: `type: score`, 4 criteria (none / mild / notable / high publish risk), naming unverified claims, legal exposure and political sensitivity, `fallback: 1`.
  - `kk-item-audience`: `type: choice`, labels `general`, `practitioner`, `researcher`, `fallback: general`.
- [ ] R3. Generalize the label pass in `apps/cli/src/commands/store.ts` onto one table, `LABEL_DECISIONS: readonly LabelDecision[]`, where `LabelDecision = { id, kind: 'choice', labels } | { id, kind: 'score', levels }`. It holds the existing five plus the new three. `decisionValue` validates against that entry. Routing:
  - the existing five keep today's heuristic-first routing;
  - the new three are consulted for **every** labelled item in both modes, because the heuristic has no signal for them;
  - their consults count in `consults` / `consultMs`.
- [ ] R4. The china-politics keyword prefilter is a case-insensitive substring match over title plus body head (first 200 chars) against `store.labels.china_politics_terms` (a `readStoreConfig` key: a string[], with a built-in default list of top-leader and central-institution terms only, e.g. 习近平, 总书记, 中共中央, 政治局, 中南海, Xi Jinping, Politburo, Zhongnanhai; never generic terms like 中国 / China / Beijing).
  - On a hit it writes a `kk-item-china-politics` observation with `maker 'keyword'`, `source 'heuristic'`, value `3`, `reason 'keyword:<term>'`.
  - `readStoreConfig` defaults `decisionPriority['kk-item-china-politics']` to `['keyword', '*', 'heuristic']`, which applies when the operator sets none.
  - The model is still consulted on a hit, so backtesting keeps both rows.
- [ ] R5. `plugins/kk/decisions/extract/ai-news.yaml` gains `kk-item-china-politics: { lte: 1 }`. A `where` key is an inner join on `labels_current`, so an item with no current china-politics answer is excluded (fail-closed). This is pinned by a test.
- [ ] R6. Add the three ids to `ITEM_DECISION_IDS` (`packages/kk-store/src/profile.ts:20`) and update its lockstep comment.
- [ ] R7. A fixture set of real titles covers every china-politics level. It includes at least three Chinese-AI-industry items (e.g. a DeepSeek/Qwen/Kimi release) that must score 0, and at least one keyword hit. The tests run against a recorded maker-answer fixture (a stubbed `runDecision`), never a live model.
- [ ] R8. `docs/04_DESIGN.md` (label decisions and the `china_politics_terms` key) and design doc §4 list the new decisions, in the same commit.

### Acceptance Criteria

- [ ] AC1 — New judgment decisions label every new item, and china-politics gates conservatively

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G32 (R8). Brainstorm D3, D3a (operator clarification). Depends on 0226 (`readStoreConfig`, per-decision priority, `labels_current`).
- `apps/cli/src/commands/store.ts:61-65,566-572,641-685`; `packages/kk-store/src/profile.ts:12-26,109-112`; `plugins/kk/decisions/kk-items.yaml`; `plugins/kk/decisions/extract/ai-news.yaml`.
- Catalog schema: `@gobing-ai/spur/schemas/decision-catalog.schema.json:138-140,182-197` (score levels = criteria length).

### History

- 2026-10-09T02:45:16.215Z backlog → todo (system)

