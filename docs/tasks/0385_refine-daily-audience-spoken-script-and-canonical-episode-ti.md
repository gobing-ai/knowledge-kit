---
schema_version: 1
name: Refine daily audience, spoken script and canonical episode title
status: done
template: feature-impl
created_at: 2026-11-18T04:03:43.216Z
updated_at: "2026-11-18T19:15:11.197Z"
feature_id: L3
priority: P1

estimate_hours: 8
dependencies: ["0384", "0392", "0394"]
done_forced: "false"
done_reason: unforced close
---

## 0385. Refine daily audience, spoken script and canonical episode title

### Background

L3 · 受众、证据、节奏与节目元数据。现行风格契约定义为技术分享，选题和文案有现成模式可扩展。 证据 `plugins/kk/skills/news-editorial/references/style-contract.zh.md:9`。覆盖 R2, R3, R5, R6。

### Requirements

- [x] R1. 按时效和对白领听众的影响筛选，以白话解释必要术语并把深度专题留到周更（L3 R2）
- [x] R2. 在文案中区分可归因事实、评论和待证推断，证据不足时归因或省略（L3 R3）
- [x] R3. 开场仅简短问候及一到两句要点，逐条评论可省略且至多一句，跨条目综评按价值和时长调整或省略（L3 R5）
- [x] R4. 中文发布标题采用第261120期 · 当日要点，封面复用同一要点，重试和历史重放保留节目身份（L3 R6）

### Acceptance Criteria

- [x] R2 — 按受众影响选择和解释新闻
- [x] R3 — 核查商业声明与评论证据
- [ ] R5 — 短开场和可选评论符合口播节奏
- [ ] R6 — 各发布目标共用冻结的节目标题

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:03.564Z

**Ready decisions.** Consume the 0384 snapshot, 0392 boundary decision and 0394 citation fields. Freeze one episode date and a headline with selected source IDs, and regenerate or withhold title and derived copy if admission removes its supporting sources. Only the existing script/Content seams change. Preserve historical bundle decoding and GUID/slug identity. 0386/0387 consume the frozen title and IDs; 0396 owns public correction delivery receipts.

**Source premise.** `plugins/kk/skills/news-editorial/references/style-contract.zh.md:9` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay a dense and a thin issue, a false claim, removed headline support and an old bundle. Verify all title consumers and the optional short-comment limits.

### Design

**Decision** — 受众、证据、节奏与节目元数据由现有边界承载。在 news-editorial 和现有稿件校验、渲染分支内更新受众与口播，保留安全边界和裁剪引用校验。以节目日期和已确认 headline 固定标题，补齐旧历史与渠道标题检查。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/skills/news-editorial/references/style-contract.zh.md:9`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 8 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 在 news-editorial 和现有稿件校验、渲染分支内更新受众与口播，保留安全边界和裁剪引用校验。以节目日期和已确认 headline 固定标题，补齐旧历史与渠道标题检查。
- [ ] 保留 E2E 回放证据与相应文档更新。

### Solution

见 `.spur/run/0385-implement-receipt.md`（实现收据，含逐条 R1–R4 的 file:line 变更图）。摘要：

- 契约/提示词：`plugins/kk/skills/news-editorial/references/style-contract.zh.md:9`（栏目定位改白领新闻播报）、
  `:26` 受众取舍（R1）、`:49` 事实/评论/待证推断（R2）、`:72`/`:74`/`:75` 开场、可省点评与可省综评（R3）、
  `:80` 节目标题与节目身份（R4）；`SKILL.md:44,63,76-93` 同步；`references/selection.md:26` 增补排序口径。
- 身份冻结：新增纯模块 `plugins/kk/scripts/episode-identity.ts`（`第<YYMMDD>期 · 当日要点`、支持源撤销即撤稿、
  `identityFromMetadata` 供重试/重放）。`daily-stages.ts:4922`（`dailyEditorialRender` 冻结并写入
  `21-plan/<date>_05_script_identity.json`、文章 Content 标题/H1、封面 brief 同一要点）、
  `daily-stages.ts:2529`（`dailyPublishPrep` 读冻结身份、撤稿即拒发、ID3 与发布 Content 共用同一标题）。

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — 按时效和对白领听众的影响筛选，白话解释术语，深度专题留给周更 | MET | `plugins/kk/skills/news-editorial/references/style-contract.zh.md:9-14` (栏目定位, 白领听众), `:26-34` (受众取舍 + the advisory rule statement `:34`), `plugins/kk/skills/news-editorial/references/selection.md:26-30` (urgency × white-collar impact ordering); the 解释 half is now executable — `plugins/generations/dailynews-gen/src/editorial-claims.ts:199-210` (`r2:unexplained-jargon`) with tests `plugins/generations/dailynews-gen/tests/editorial-claims.test.ts:132`, `:143`, `:152`, `:158` |
| R2 — 区分可归因事实、评论和待证推断，证据不足时归因或省略 | MET | Contract `style-contract.zh.md:49-62` (three-way separation, 商业声明 attribution, omission as default, advisory rule statement `:65`); executable legs `editorial-claims.ts:166-175` (`r3:commentary-in-facts`), `:186-196` (`r3:unattributed-claim`) with tests `editorial-claims.test.ts:83`, `:103`, `:111`, `:119`, `:124`; banned-scaffold list still enforced (`src/script-plan.ts:322-331`) |
| R3 — 开场一句问候加一到两句要点，逐条评论可省略且至多一句，综评按价值调整或省略 | MET | `style-contract.zh.md:74` (insight optional, omission ≡ `""`) enforced by `src/script-plan.ts:107` (probe: omitted / `""` / `"   "` → `ok:true`), builder skips only the comment (`src/script-builder.ts:431-441`), render keeps the item (`daily-stages.ts:4956-4968`); `≤1 sentence` now checked by `editorial-claims.ts:178-185` + test `:91`; pinned at `plugins/kk/tests/episode-identity-0385.test.ts:391` |
| R4 — 标题 `第261120期 · 当日要点`，封面复用同一要点，重试/历史重放保留身份，支持源撤销即撤稿 | MET | `plugins/kk/scripts/episode-identity.ts:54-146`; freeze + cover reuse `plugins/kk/scripts/daily-stages.ts:5033-5047`/`:5075`; article seam both orders `:763-775`/`:874`; replay `:722-732`, withhold refusal `:2602-2613`; tests `plugins/kk/tests/episode-identity-0385.test.ts:495`, `:525`. Re-probed this turn: object cover `{scene,headline,sourceIds}` → `ok:true`, `{headline}`-only → `ok:true`, legacy string → `ok:true`, `cover:""` → `schema`, 26-char headline → `cap:coverHeadline` (`caps.coverHeadline === 25`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 — 按受众影响选择和解释新闻 | MET | test | Executable explanation leg: `plugins/generations/dailynews-gen/src/editorial-claims.ts:199-210` (`r2:unexplained-jargon`, contract-owned vocabularies `:46`, `:55`) proven failure-sensitive by `plugins/generations/dailynews-gen/tests/editorial-claims.test.ts` › *"flags bare jargon, accepts a dash gloss and a parenthetical gloss"* (`:132`), › *"accepts the contract own 「也就是说」 shape and flags the same term inside insight too"* (`:143`), › *"matches latin jargon case-insensitively and ignores text with no listed term"* (`:152`), › *"a gloss in a different sentence does not rescue the term in this one"* (`:158`); plus the blast-radius pair `:169`/`:173` (the accepted fixture plan → `[]`). Verified live: `bun test plugins/generations/dailynews-gen/tests` → 87 pass / 0 fail, `editorial-claims.ts` 100.00 % funcs / 100.00 % lines. The 选择 leg stays prompt-level (`selection.md:26-30`) — gap named in finding 5, not claimed as tested |
| R3 — 核查商业声明与评论证据 | MET | test | Executable: `editorial-claims.ts:160-196` — `r3:commentary-repeat` (`:162`), `r3:commentary-in-facts` (`:172`), `r3:insight-multi-sentence` (`:181`), `r3:unattributed-claim` (`:186-196`, `QUANTIFIED_RE :98` + `SUPERLATIVE_RE :100` + `hasAttribution :106` ← `ATTRIBUTION_MARKERS :73`) — each rule with a failing input and a passing counterpart in `tests/editorial-claims.test.ts` › *"flags two commentary markers in one item, accepts one"* (`:66`), *"counts a synonym as the same marker"* (`:77`), *"flags a commentary marker in the fact sentence, accepts it only in insight"* (`:83`), *"flags an insight longer than one sentence, accepts exactly one"* (`:91`), *"flags an unattributed funding figure, accepts the same figure with a named source"* (`:103`), *"flags an unattributed superlative, accepts it when the announcement is named"* (`:111`), *"accepts a fact sentence with no number and no superlative, and an attribution link counts"* (`:119`), *"reports the offending sentence so a fix pass knows what to re-attribute"* (`:124`). Advisory (not rejection) proven by `:177` (`scriptSource === 'plan'`, `scriptPlanErrors === []`, advisories stamped) and `:291` (advisory file written, `_08_script-write_errors.json` absent). My probe: a plan carrying all five findings still validates `ok:true` |
| R5 — 短开场和可选评论符合口播节奏 | MET | test | `style-contract.zh.md:74` (optional insight, omission ≡ `""`) enforced: `src/script-plan.ts:107`, builder `src/script-builder.ts:431-441` (no bare 「。」), render `daily-stages.ts:4956-4968`; tests `plugins/kk/tests/episode-identity-0385.test.ts:391` (35 tests, 0 fail this turn) + `tests/script-plan.test.ts` R3 group |
| R6 — 各发布目标共用冻结的节目标题 | MET | test | One record read by every target: article Content title/H1 + `metadata.episodeIdentity` (`daily-stages.ts:740-756`, applied `:874` first-run and retry — `episode-identity-0385.test.ts:495`, `:525`), cover brief `:5075`, ID3 + publish Content `:2627`, `:2645-2657`, show notes `:5216` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T17:06:28.882Z todo → wip (system)
- 2026-11-18T19:15:10.374Z wip → testing (system)
- 2026-11-18T19:15:11.190Z testing → done (system)

