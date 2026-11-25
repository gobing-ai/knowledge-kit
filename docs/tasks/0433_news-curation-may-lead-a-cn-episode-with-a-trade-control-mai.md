---
schema_version: 1
name: News curation may lead a CN episode with a trade-control mainline the CN platforms block
status: blocked
template: issue
created_at: 2026-11-24T21:55:05.683Z
updated_at: "2026-11-25T16:39:44.898Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
---

## 0433. News curation may lead a CN episode with a trade-control mainline the CN platforms block

### Background

2026-11-24 dogfood, measured end to end. The curator authored today's episode around the day's biggest
story — 英伟达董事会恢复黄仁勋职务并新设国家安全与出口管制委员会 — as the lead title, headline and
summary. The variants safety review then graded that mainline against the skill's own conservative
platform stance:

- `xiaoyuzhou` XY-02 (`时政/公共事务主线：政治、外交/贸易管制、军事、公共政策争议…` → block, disposition `escalate`)
- `wechatmp` WX-01 (same shape for 图文)
- `apple-podcasts` AP-02 (evidence gap only — closed the same day by task work on the reference file)

Result: `bundle.safety.excludedPlatforms = [xiaoyuzhou, apple-podcasts, wechatmp]`, so
`podcast-pub.episode` and `wechatmp-pub.文章` were dropped for the day *after* the full TTS pass had
already been paid for (12.6 min of audio, 753 s). The operator accepted the exclusion rather than
override it; the episode shipped only to surfdash + 视频号 audio + jike.

The pipeline behaved as designed — the gap is upstream. The editorial selection never considers the
CN distribution surface it is writing for, so the cheapest-looking lead (the biggest story) can be the
one that costs the day its primary channel.

Evidence: `.works/kk-news-generate/20261124/4-safety-variants/20261124_09_safety-review_report.json`
(per-platform findings with `disposition: escalate`), `4-safety-variants/safety.json`
(`excludedPlatforms`), and the publish plan (`4-publish/plan.after-generate.json`, two rows
`excluded by bundle safety`).

### Requirements

- [ ] R1. The news-editorial selection contract must name the CN-platform constraint explicitly: a mainline that is 时政/贸易管制/公共安全审查 (state security review, export controls, foreign-intelligence framing) must not be the episode's lead title, headline or summary for a CN-distributed cut.
- [ ] R2. When such a story is the day's biggest, the selection must either demote it to a body item with a neutral headline or produce two cuts (CN lead vs overseas lead) — the chosen behaviour is recorded with its tradeoff.
- [ ] R3. A deterministic check (not a prose instruction only) must fail the plan when the lead title/summary trips the CN-blocked mainline vocabulary on the CN cut.
- [ ] R4. The failure must be visible before the TTS spend, not only in the post-spend safety verdict.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a state-security lead is refused before synthesis (req: R1, R3, R4)
Given a plan whose lead title is `…国家安全与出口管制委员会` on the CN cut
When the plan is authored and the pre-spend gate runs
Then the plan check fails (or rewrites the lead) naming XY-02/WX-01 as the rule, and no audio is synthesized

Scenario: AC2 — a product lead passes untouched (req: R1)
Given a plan whose lead is a model/product release
Then the check passes and the run continues to the floor gate
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-25T16:39:44.897Z

Implementation shipped (deterministic pre-spend CN-lead gate, wired into daily-curate-check). Verification did not certify: six review visits measured a residual recall gap (22/30 held-out class leads) and a 12% product-lead false-positive rate after the widening. Calibration continues in 0437, which the `## Review` reports of the last visit size (E1/E3: 29-30/30 recall, 92% product precision, all 32 shipped fixture rows still correct).

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

**R2 decision — demote, not two cuts.** The CN-blocked story is moved to a body position and the first clean
in-scope story leads. Tradeoff, recorded: the pipeline ships one zh script, one TTS pass and one bundle, so the
alternative (a CN lead + a separate overseas lead) would add a second render path, a second headline slot and a
second audio variant to save one episode's lead position — far more than the day lost. Demote keeps one cut and
one synthesis bill; the cost is that the CN surface does not lead with the day's biggest story. When the pool has
no clean lead at all, the run refuses *before* synthesis (`21-plan/<date>_03_cn-lead-refusal.json`, non-zero exit)
instead of paying for an episode the CN rows would drop afterwards. Only the **lead position** is constrained —
the story stays in scope as a body item (SKILL.md shared rule 2 keeps export controls and AI-capacity regulation
reportable), which is what the `curate --fix` pass is told to do with the rule.

| `path:line` | What / why |
| --- | --- |
| `plugins/kk/scripts/cn-lead-gate.ts:1-42` | NEW. Module docblock: the 2026-11-24 incident, why the gate is a *lead-position* constraint rather than an item exclusion, that the shipped `XY-02`/`WX-01` platform references stay the vocabulary's source of truth, and the recorded demote tradeoff. |
| `plugins/kk/scripts/cn-lead-gate.ts:44` | `CN_LEAD_RULE_IDS = ['XY-02','WX-01']` — the shipped review items every failure message names, so `curate --fix` routes on the platform rule, not on a local invention. |
| `plugins/kk/scripts/cn-lead-gate.ts:46-139` | `CN_LEAD_VOCABULARY`, the machine-readable form of XY-02/WX-01's 时政/贸易管制/公共安全审查 mainline: three classes (trade-control, state-security-review, political-affairs) with CJK + Latin terms. |
| `plugins/kk/scripts/cn-lead-gate.ts:160-216` | `scanCnLead(title, summary)` — pure scan (CJK substring, Latin word-boundary so `war` never matches `software`), `leadSurfaceOf` (title + `metadata.brief`, never the body), `cnLeadMessage` (names the lead, the matched terms and XY-02/WX-01). |
| `plugins/kk/scripts/cn-lead-gate.ts:218-249` | `checkCnLeadPlan(docs)` — scans plan index 0 only; empty plan passes (`empty-plan` owns that case). R3's deterministic check. |
| `plugins/kk/scripts/cn-lead-gate.ts:251-290` | `enforceCnLead(docs)` — R2's demote behaviour as code (clean item leads, tripping item moves to a body position, relative order kept; identical array when nothing trips) plus the honest dead end (`blocked`) when every candidate trips. |
| `plugins/kk/scripts/daily-stages.ts:70` | Import the gate into the stage bodies (same-directory sibling, no new dependency). |
| `plugins/kk/scripts/daily-stages.ts:5559-5572` | `dailyCurateCheck` docblock: the errors artifact now carries an optional `detail`, and the plan stage is named as the pre-spend home (R4). |
| `plugins/kk/scripts/daily-stages.ts:5581-5582` | `21-plan/<date>_03_cn-lead-refusal.json` — the refusal record path for an unsynthesizable pool. |
| `plugins/kk/scripts/daily-stages.ts:5598-5627` | `--final` fallback (no agent left on that path): `enforceCnLead` on the raw candidates — demote and log, or write the refusal artifact and exit non-zero **before** the voice nodes. |
| `plugins/kk/scripts/daily-stages.ts:5742-5756` | The pass path: `checkCnLeadPlan(planDocs)` pushes `cn-lead:XY-02` (with the message as `detail`) into `_03_curate_errors.json` so the `curate-fix` node rewrites the lead; the message is echoed on stderr. Node 5 of 20 — the failure is visible ~14 nodes before any TTS spend. |
| `plugins/kk/skills/news-editorial/SKILL.md:71-84` | R1's prose half: shared rule 4 names the CN-platform constraint, the surfaces it governs (lead title / headline / summary), the in-scope-but-not-lead distinction, the demote behaviour and the `cn-lead:XY-02` enforcement. |
| `plugins/kk/skills/news-editorial/SKILL.md:110-116` | The `cover.headline` contract now says the frozen 当日要点 obeys rule 4 too — it anchors the story that now leads, never the demoted mainline. |
| `plugins/kk/skills/news-editorial/SKILL.md:177` | `curate --fix`: `cn-lead:XY-02` added to the rule list, with the fix (demote + neutral headline, never drop the item). |
| `plugins/kk/skills/news-editorial/references/selection.md:35-61` | New § CN lead: which mains lines trip, the demote policy, the recorded tradeoff against two cuts, the refusal case, and the note that the check lives in code (`cn-lead-gate.ts`) rather than in this prose. |
| `plugins/kk/skills/news-editorial/references/selection.md:80-83` | `curate --fix` rule `cn-lead:XY-02`: demote, lead with the first clean story, rewrite title/`metadata.brief` to a neutral headline, keep every fact. |
| `plugins/kk/tests/cn-lead-gate-0433.test.ts:1-232` | NEW. Unit coverage of the three pure functions (AC1 fixture trips and names XY-02/WX-01, AC2 product lead passes untouched, summary-only trip, body not scanned, English fallback surface, `software`/`war` near-miss) plus four stage tests driving `daily-curate-check` through the real runner (AC1 rejection + `detail`, AC2 acceptance, `--final` demotion, `--final` refusal). |
| `apps/cli/tests/kk-workflow-stages.test.ts:39,4878` | Lone-runner fixture ships `cn-lead-gate.ts` beside `daily-stages.ts` (the same rule the fixture already applies to the attempt ledger and the citation resolver). |

Verification: `NODE_ENV=test bun test plugins/kk/tests/cn-lead-gate-0433.test.ts` → 16 pass / 0 fail (fail-first:
the same file errored `Cannot find module '../scripts/cn-lead-gate.ts'` before the module existed and failed the
three stage assertions before the stage wiring landed). Regression: `apps/cli/tests/kk-workflow-stages.test.ts`
181 pass, `apps/cli/tests/content-generate.e2e.test.ts` 9 pass, `apps/cli/tests/kk-news-generate.e2e.test.ts`
4 pass, `plugins/kk/tests/runtime-requires.test.ts` 4 pass. `biome check` clean on every touched TS file.

#### Review remediation (review visit 1, P3)

| File | Lines | What / why |
| --- | --- | --- |
| `plugins/kk/scripts/cn-lead-gate.ts` | 198-222 | `leadSurfaceOf` now falls back to the lead's FIRST BODY SENTENCE when neither `metadata.brief` nor `summary` is present. The shipped CN show notes use exactly that fallback (`planItemsForPodcast`), so the summary half was unscanned by construction on the `--final` path (raw candidates carry no `brief`). Only the lead's first sentence is read; body items and the rest of the body stay out of scope. |
| `plugins/kk/tests/cn-lead-gate-0433.test.ts` | 71-84 | Regression: a brief-less lead whose first body sentence carries 国家安全审查/出口管制 fails the plan with a `summary` hit. Fails on the two-source version, passes on the fix. |

#### Review remediation (review visit 2, P3 — vocabulary breadth)

Visit 2 measured 8 plausible XY-02/WX-01-class leads that still PASSED the gate (e.g. `美国商务部发布 AI
芯片出口新规`, `美国对华加征 25% 芯片关税`, `台积电对华出货需申请许可`, `台湾地区选举结果影响半导体政策`).
The vocabulary named one incident's phrasing, not the class.

| File | Lines | What / why |
| --- | --- | --- |
| `plugins/kk/scripts/cn-lead-gate.ts` | 64-145 | Trade-control class widened to the export-licensing and tariff surface (出口许可/出口新规/出口合规/对华出口/对华出货/获准对华/出货需申请/审批许可/许可证制度/芯片关税/关税/商务部, `export license`); political-affairs class gains 选举结果/军方/美军/军队 (`armed forces`). Same substring semantics, lead position only. |
| `plugins/kk/tests/cn-lead-gate-0433.test.ts` | 250-278 | Regression table over the 8 measured lead shapes (each must trip) plus three ordinary product/valuation leads that must stay clean, so a future widening cannot silently turn into a blanket keyword filter. |

#### Review remediation (review visit 4, P3 — domestic policy surface)

Visit 4 re-measured with 42 fresh leads: 15 passed, 10 of them materially in class, because the
domestic 时政 surface says `人工智能`/`生成式` (not "AI") and ordinary administrative acts are
`办法` / `行动计划` / `约谈` / `规范` — and the product-usage-policy carve-out was an identity test on one
object+noun pair.

| File | Lines | What / why |
| --- | --- | --- |
| `plugins/kk/scripts/cn-lead-gate.ts` | 150-205 | `AI_OBJECT_TERMS` gains 人工智能 / 生成式; `POLICY_SIGNAL_TERMS` gains 办法 / 行动计划 / 约谈 / 规范 / 指南; the political class gains 网信办 / 工信部 / 中央经济工作会议 / 军控 / 军用 / 情报部门. |
| `plugins/kk/scripts/cn-lead-gate.ts` | 206-225 | The product-usage-policy carve-out is now a family test (`PRODUCT_POLICY_WORDS` = 政策/规则/规范/指南) that any government/regulator word cancels, instead of `object === '模型' && policy === '政策'` — so `OpenAI 更新大模型使用规则` stays clean while `网信办…新办法` still trips. |
| `plugins/kk/tests/cn-lead-gate-0433.test.ts` | 300-340 | Regression tables for visit 4's 7 material misses (must trip) and 4 product-policy/usage leads (must stay clean). |

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

#### Review Report — 0433 (visit 5 — CN-platform lead gate, re-judged after the domestic-policy-surface remediation)

**Scope:** the whole change on `sp/runall-feature-l3-4e48` for this task — `plugins/kk/scripts/cn-lead-gate.ts` (new, 418 L), `plugins/kk/scripts/daily-stages.ts` (`dailyCurateCheck`, 5578-5793), `plugins/kk/tests/cn-lead-gate-0433.test.ts` (new, 340 L), `plugins/kk/skills/news-editorial/SKILL.md:71-84,110-116,171-180`, `plugins/kk/skills/news-editorial/references/selection.md:35-61,79-84`, `apps/cli/tests/kk-workflow-stages.test.ts:38-39,4878`. The 0431/0432 in-flight edits (`apps/cli/src/publish-matrix.ts`, `plugins/publishings/surfdash-pub/*`) were read only to confirm 0433 does not touch them.
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PARTIAL

##### Visit-5 remediation — re-derived fail-first on this tree

Method: each mutant is a copy of `cn-lead-gate.ts` in a scratch dir with exactly one edit, run against the same fixture tables the shipped test asserts; no repo file was modified.

| Claim under test | Result | Evidence |
| --- | --- | --- |
| `人工智能` / `生成式` are AI-industry objects | Present, thinly pinned | `plugins/kk/scripts/cn-lead-gate.ts:182-195`. Removing both breaks **1 of 7** visit-4 class rows (`多地出台人工智能产业扶持办法`); removing `生成式` alone breaks **0 of 7** — it is dead weight against the shipped table |
| 办法 / 行动计划 / 约谈 / 规范 / 指南 are policy signals | Present, same single row | `plugins/kk/scripts/cn-lead-gate.ts:199-230`. Removing all five breaks the same one row (`多地出台人工智能产业扶持办法`); the other six visit-4 rows still trip on pre-existing enumerated terms (`网信办`, `工信部`, `中央经济工作会议`, `军控`, `军用`) |
| Carve-out is a noun family, not an identity test | Holds, strongly pinned | `plugins/kk/scripts/cn-lead-gate.ts:294-296`; reverting to visit 3's `object === '模型' && policy === '政策'` breaks **4 of 4** product-policy rows (`plugins/kk/tests/cn-lead-gate-0433.test.ts:325-340`) |
| Visit 4's 15-row miss list | **8/15** now trip (was 0/15) | `中国网信办…新办法`, `国家网信办约谈…`, `工信部…行动计划`, `多地出台…办法`, `中央经济工作会议…`, `德国情报部门…`, `朝鲜半岛…军用`, `俄罗斯…军控` trip; **5 of the 10 material rows still pass** (要求 / 示范区建设 / bare 管制 / 供应 / 报告) |
| Task suite + regressions | Green | `plugins/kk/tests/cn-lead-gate-0433.test.ts` **50 pass / 0 fail**, 86 assertions, 100 % funcs + lines on the module; `apps/cli/tests/kk-workflow-stages.test.ts` 181 pass / 0 fail; `apps/cli/tests/kk-news-generate.e2e.test.ts` 4 pass / 0 fail; `plugins/kk/tests/runtime-requires.test.ts` 4 pass / 0 fail; `bunx biome check` clean on `cn-lead-gate.ts`, `cn-lead-gate-0433.test.ts`, `daily-stages.ts` |
| Installed bundle carries this vocabulary | Holds (visit-4 caveat closed) | `apps/cli/plugins/kk/scripts/cn-lead-gate.ts` is the gitignored build (`.gitignore:169`); its term list and its carve-out line (`:295`) are byte-identical to source, so the installed-package suites no longer validate a previous vocabulary |

##### Breadth re-measurement — 30 held-out class leads invented for this visit

Every string below was written for this review and none appears in `plugins/kk/tests/cn-lead-gate-0433.test.ts` (fixture lists at `:52-58,254-300,314-331`). All 30 are genuinely XY-02/WX-01 class. The current-vs-extension columns are read-only measurements: E1 adds policy nouns only (指引/条例/细则/备案/征求意见/规划/供应/bare 管制); E3 adds those, drops `新规`, and keys the carve-out cancellation on government actors instead of `国家|部门|会议`.

| Surface | current | E1 | E3 |
| --- | --- | --- | --- |
| Held-out class leads caught | **22/30 (73 %)** | 29/30 | **30/30** |
| Visit-4 material misses still passing | 5/10 | 3/10 | 3/10 |
| Fresh product leads clean | 35/40 + 41/46 (88 %) | 35/40 + 41/46 | 36/40 + 43/46 (92 %) |
| Shipped fixture rows still correct (22 trip / 10 pass) | 32/32 | 32/32 | 32/32 |

| # | Missed held-out lead | Material to R3? | Why |
| --- | --- | --- | --- |
| 1 | `深圳市发布人工智能产业促进条例` | **Material** | 地方性法规 on the AI industry is a 公共政策 mainline; object `人工智能` matches, `条例` is not a policy signal |
| 2 | `北京市出台生成式人工智能服务备案细则` | **Material** | Regulatory filing rules — the 生成式AI 备案 layer the platform file documents; `备案`/`细则` absent |
| 3 | `央行发布金融领域人工智能应用指引` | **Material** | A ministry-level guideline; `指引` absent (its siblings 指南/规范 are present) |
| 4 | `教育部印发中小学人工智能教学指南` | **Material** | `指南` *is* a policy signal here, but the carve-out cancels it because `教育部` is not in the cancellation list (`:295` lists `国家|部门|会议`, not ministries) |
| 5 | `国家数据局就人工智能数据合规征求意见` | **Material** | 征求意见-stage rulemaking; `征求意见`/`合规` absent |
| 6 | `美方要求台积电停止向中国客户供应先进制程` | **Material** | The incident class (trade control); object `台积电` matches, `供应`/`要求` absent |
| 7 | `多地开展人工智能服务算法备案专项检查` | **Material** | Regulatory inspection campaign; `备案` absent |
| 8 | `中国人工智能立法进入征求意见阶段` | **Material** | 立法 is 时政 by any reading; `征求意见` absent |

**Residual after the measured extension (E3, 3 rows of visit 4's list):** `中国推出 AI 生成内容标识新要求`, `北京上海同步启动人工智能示范区建设`, `美国要求云厂商报告外国客户的大模型训练情况`. These are **accepted tradeoffs**, not gaps: `要求`/`报告` are the two nouns a product/research lead also uses (`某公司发布大模型安全报告`, `某大模型要求用户实名`), so adding them to the flat policy list trades a real false-positive class for these phrasings; they need a reporting-duty shape (`要求…报告` in one surface, or a government actor), which is a design step, not a table entry.

##### False-positive side re-measured — a blocked CLEAN lead costs the day's editorial too

10 of 86 fresh product/market leads (12 %) are demoted. Five distinct mechanisms, all reproducible:

| Fresh product lead | Trips on | Mechanism |
| --- | --- | --- |
| `某开源大模型改用 Apache 许可，商用门槛降低` | `大模型+许可` | `许可` is a policy signal, and an open-source licence is a product fact |
| `GitHub Copilot 上线代码审查助手，支持大模型补全` | `大模型+审查` | code review is a product feature; `审查` is a security-review signal |
| `Anthropic 调查 Claude 输出异常并发布复盘` | `模型+调查` | a vendor postmortem is not a state investigation |
| `OpenAI 限制模型输出长度以降低推理成本` | `模型+限制` | product-level limit, not a regulatory restriction |
| `Anthropic 安全部门更新模型使用政策` | `模型+政策` | the carve-out is cancelled by `部门` — a *company* department reads as a government word (`:295`) |
| `英伟达发布 GPU 驱动更新规范说明` | `英伟达+新规` | CJK substring artifact: 更**新规**范 matches `新规` across a morpheme boundary (`:263-267`) |
| `Airbnb 限制房东上架数量` | `ai+限制` | Latin matching has a leading boundary only, so `ai` matches the `Ai` of any English word (`:263-267`) |

**Amplification, measured.** A three-item product pool of the first three rows above (`某开源大模型改用 Apache 许可`, `Cursor 新增代码审查智能体，支持大模型补全`, `OpenAI 限制模型单次输出长度`) makes `enforceCnLead` return `blocked`, so `daily-curate-check --final` writes the refusal record and exits non-zero (`plugins/kk/scripts/daily-stages.ts:5605-5620`) — the day ships *nothing*, which is worse than the 2026-11-24 outcome it prevents (that day still shipped surfdash + 视频号 + 即刻). The non-final path is milder: the same pool goes to `curate-fix`, which can demote by rule.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | functional | **Class recall is still short on the domestic administrative-instrument surface.** 22/30 held-out in-class leads pass (73 %), 8/8 of the misses materially in class; 5 of visit 4's 10 material misses also still pass. Three measurable causes: no 指引/条例/细则/备案/征求意见/规划/供应 and no bare 管制 in `POLICY_SIGNAL_TERMS`; and the carve-out's cancellation list is generic words (`国家|部门|会议`) rather than government actors, so a real ministry (`教育部`, `央行`, `数据局`) fails to cancel while a company department (`安全部门`) does. Sized read-only: E1 → 29/30, E3 → 30/30, both with the 32 shipped fixture rows unchanged and product clean-rate flat-to-better. This is still the incident one level down: a re-phrased domestic rule reaches synthesis and the CN rows drop after the spend | `plugins/kk/scripts/cn-lead-gate.ts:199-230,294-296` | OPEN |
| 2 | P3 (minor) | correctness | **Over-trigger on ordinary product copy has grown with the vocabulary.** 10 of 86 fresh product leads demoted (12 %) through four signal words that are also product words — `许可` (open-source licence), `审查` (code review), `调查` (vendor postmortem), `限制` (product limit) — plus the carve-out cancellation above. Cost is normally one lead slot (the item stays, the run continues), but a pool where every candidate trips returns `blocked` and refuses the whole day before synthesis, so the crowd-out is worse than the incident it guards against. `PRODUCT_POLICY_WORDS` covers the 政策/规则/规范/指南 family only; the four signals above have no product-side escape | `plugins/kk/scripts/cn-lead-gate.ts:197,294-296`; `plugins/kk/scripts/daily-stages.ts:5605-5620` | OPEN |
| 3 | P3 (minor) | correctness | **`新规` matches across a CJK morpheme boundary.** `trips` falls back to `squash(text).includes(squash(term))` for CJK, so 更新+规范 / 更新+规则 / 最新+规划 all contain `新规`: `英伟达发布 GPU 驱动更新规范说明`, `某大模型更新规则说明`, `英伟达公布 2027 年最新规划` all demote. Dropping `新规` costs **0 of 32** fixture rows (the 出口新规 / 商务部 / 规则 rows keep tripping) and lifts product clean-rate 88 % → 92 % in the same measurement as finding 1's extension | `plugins/kk/scripts/cn-lead-gate.ts:263-267,199-230` | OPEN |
| 4 | P3 (minor) | correctness (tests) | **The visit-5 regression tables do not pin the visit-5 fix.** Of the 7 new class rows, exactly one (`多地出台人工智能产业扶持办法`) depends on the added terms; `生成式` is pinned by none. A future edit that removes the terms this visit added would leave the suite green — the same failure mode that made visits 2–4 necessary (each widening was pinned by one or two rows and each next visit found the unpinned half) | `plugins/kk/tests/cn-lead-gate-0433.test.ts:314-340` | OPEN |
| 5 | P4 (advisory) | documentation | Doc drift carried from visit 4: the module docblock says the failure lands at "workflow node 5" and the safety verdict at "node 19"; measured, `curate-check` is node **4 of 25** (`plugins/kk/workflows/kk-news-generate.yaml:116`), `voice` 18 (`:423`), `safety-variants` 24 (`:520`). `references/selection.md:59-61` still describes the scanned surface as `title` + `metadata.brief`, while the gate also scans `doc.summary` and the lead's first body sentence | `plugins/kk/scripts/cn-lead-gate.ts:15`; `plugins/kk/skills/news-editorial/references/selection.md:59-61` | ACCEPTED |
| 6 | P4 (advisory) | usability | A successful demotion still leaves no run artifact — only the `console.error` line at `plugins/kk/scripts/daily-stages.ts:5621-5624` — while the refusal case writes `21-plan/<date>_03_cn-lead-refusal.json`. An operator auditing the work dir cannot see that the day's biggest story was moved, nor which terms tripped | `plugins/kk/scripts/daily-stages.ts:5621-5624` | ACCEPTED |
| 7 | P4 (advisory) | correctness | The gated lead can differ from the shown-notes lead: `planItemsForPodcast` prefers `21-plan/<date>_03_plan_plan-shownotes.json`, written after filtering ids the article omitted, so position 0 of the notes can be an item that was never lead-gated (the episode title/summary still come from the gated plan) | `plugins/kk/scripts/daily-stages.ts:3049-3051` | ACCEPTED |
| 8 | P4 (advisory) | correctness | Latin terms match from a leading boundary only, so `ai` matches the first two letters of any English word (`Airbnb 限制房东上架数量` → `ai+限制`, `Airtable 收紧免费额度上限` → `ai+收紧`). Low recurrence in a Chinese-language AI pool and the two-signal rule keeps it quiet, but it is a one-line fix (`(?![a-z])` for Latin terms) that can ride along with finding 2 | `plugins/kk/scripts/cn-lead-gate.ts:251-267` | ACCEPTED |
| 9 | P4 (advisory) | architecture | Still no automated tie between `CN_LEAD_RULE_IDS`/`CN_LEAD_VOCABULARY` and the platform reference files, so the "re-verify against XY-02/WX-01" duty stays comment prose (carried unchanged from visits 1–4) | `plugins/kk/scripts/cn-lead-gate.ts:24-42` | ACCEPTED |

##### Bypass surfaces re-checked this visit

- **Pre-spend visibility (R4).** `plugins/kk/workflows/kk-news-generate.yaml`: `curate` 3 → `curate-check` **4 of 25** (`:116`) → `curate-fix` 5 (`:128`) → `curate-final` 6 (`:155`) → `script-write` 7 (`:168`) … `voice` 18 (`:423`) … `safety-variants` 24 (`:520`). Both the rejection and the refusal land 14 nodes before any synthesis.
- **Check ordering (new this visit).** The gate runs at `plugins/kk/scripts/daily-stages.ts:5747-5750`, i.e. **before** `dedupPlanByTitle` (`:5761`). That ordering is safe: `dedupPlanByTitle` keeps the first occurrence (`plugins/kk/scripts/kk-workflow-stages.ts:977-997`), so the gated index-0 lead cannot be dropped in favour of an ungated one.
- **Repair chain.** Rejection writes `_03_curate_errors.json` with `detail` and exits 0 (`daily-stages.ts:5747-5756,5640`); `curate-fix` runs only when that file is non-empty (`kk-news-generate.yaml:128-131`); `curate-final --final` either demotes deterministically over the candidates it substitutes (`daily-stages.ts:5605-5624`) or writes the refusal record and exits non-zero (`:5608-5620`), so `script-write`/`render`/`voice` never run a refused day.
- **CLI routing / lone-runner fixture.** `plugins/kk/scripts/kk-workflow-stages.ts` dispatches `daily-curate-check` → `dailyCurateCheck`; no second entry point. The lone-runner fixture ships the new module beside `daily-stages.ts` (`apps/cli/tests/kk-workflow-stages.test.ts:38-39,4878`), which is what keeps the 181-test suite honest about the same-directory import.
- **Security / efficiency of the module.** Every term is regex-escaped and matched as a literal prefix (`cn-lead-gate.ts:253-267`) — no ReDoS surface; the scan is O(terms × 2 surfaces) over ~136 short terms once per plan stage, and `enforceCnLead` runs it at most once per candidate on the `--final` path only. Negligible against the stage it gates.
- **Evidence gap.** `plugins/kk` is covered by no workspace `tsconfig`, so `bun run lint`'s typecheck never sees `cn-lead-gate.ts`; its type gate here is `bunx biome check` plus Bun's transpile-and-run under test. Repo-wide property, not a 0433 regression, but it means no `typecheck` evidence exists for the new file.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — the selection contract names the CN-platform constraint explicitly (lead title / headline / summary, CN cut) | MET | `plugins/kk/skills/news-editorial/SKILL.md:71-84` — shared rule 4 names 时政/贸易管制/公共安全审查, the three governed surfaces, the in-scope-but-not-lead distinction, the demote behaviour and the `cn-lead:XY-02` enforcement; `SKILL.md:110-116` extends it to the frozen `cover.headline`; `SKILL.md:171-180` adds the rule to `curate --fix`; `plugins/kk/skills/news-editorial/references/selection.md:35-61` § CN lead + `:79-84` the fix instruction |
| R2 — the chosen behaviour (demote vs two cuts) is implemented and recorded with its tradeoff | MET | `plugins/kk/scripts/cn-lead-gate.ts:397-418` `enforceCnLead` (clean item leads, tripping item to the first body position, relative order kept, same array when clean, `blocked` dead end); wired at `plugins/kk/scripts/daily-stages.ts:5605-5624`; tradeoff recorded at `cn-lead-gate.ts:37-41`, `references/selection.md:49-56` and the task's Solution section; pinned by `plugins/kk/tests/cn-lead-gate-0433.test.ts:113-145,223-232` |
| R3 — a deterministic check fails the plan when the lead title/summary trips the CN-blocked mainline vocabulary on the CN cut | PARTIAL | The check is pure, deterministic and wired pre-spend (`cn-lead-gate.ts:269-310` scan, `:361-377` plan check, `daily-stages.ts:5747-5756`), AC1's fixture is rejected naming `XY-02`/`WX-01`, and every visit-5 remediation claim was re-derived fail-first above (1/7, 1/7, 4/4 rows). Not full: **finding 1 is open** — 22/30 held-out in-class leads still pass (8/8 materially in class) and 5 of visit 4's 10 material misses still pass, from named table/predicate gaps that a measured extension (E3) closes to 30/30 with the 32 existing fixture rows unchanged; **findings 2–4** record the false-positive side this widening introduced (10/86 fresh product leads demoted, 12 %) and the regression tables that do not pin the fix |
| R4 — the failure is visible before the TTS spend, not only in the post-spend safety verdict | MET | `plugins/kk/workflows/kk-news-generate.yaml` `curate-check` node 4 of 25 (`:116`) vs `voice` 18 (`:423`) vs `safety-variants` 24 (`:520`); non-final rejection writes `_03_curate_errors.json` + stderr (`daily-stages.ts:5747-5756`); an unsynthesizable pool writes `21-plan/<date>_03_cn-lead-refusal.json` and exits non-zero (`daily-stages.ts:5608-5620`), driven end to end by `plugins/kk/tests/cn-lead-gate-0433.test.ts:199-247` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — a state-security lead is refused before synthesis, naming XY-02/WX-01 | MET | test + static-ref | `plugins/kk/tests/cn-lead-gate-0433.test.ts:199-212` — the real runner `daily-curate-check` writes rule `cn-lead:XY-02` with `detail` naming `WX-01`, leaves the plan for the fix pass and exits 0; refusal leg `:233-247` — non-zero exit plus `21-plan/<date>_03_cn-lead-refusal.json`; nothing synthesized first: `plugins/kk/workflows/kk-news-generate.yaml:116` (node 4) vs `:423` (node 18) |
| AC2 — a product lead passes untouched and the run continues to the floor gate | MET | test | `plugins/kk/tests/cn-lead-gate-0433.test.ts:214-221` — real runner: no errors file, `curate-check: accepted`; unit counterparts `:52-57,293-300`; 76 of 86 fresh product/market leads written for this visit pass untouched (88 %), including every release/benchmark/pricing shape (the 10 exceptions are the licence / code-review / postmortem / output-limit / policy-with-department shapes of finding 2, not product releases) |

**Next:** one bounded repair, all four items measured read-only in this visit (the 32 shipped fixture rows stay correct in every one). (a) Add `指引`, `条例`, `细则`, `备案`, `征求意见`, `规划`, `供应` and bare `管制` to `POLICY_SIGNAL_TERMS`; drop `新规` (substring artifact) — together this takes the held-out class sample 22/30 → 29-30/30 and product clean-rate 88 % → 92 %. (b) Replace the carve-out cancellation `/政府|监管|国家|部门|法案|网信办|工信部|会议/` with government actors (国务院/人大/政协/网信办/工信部/数据局/央行/总局/部委/市场监管/教育部/商务部/财政部/司法部/药监局/委员会/办公厅/政府) and drop the corporate `部门` and the generic `会议` — that closes the 教育部/央行 misses and the `安全部门` false positive at once. (c) Give `许可`/`审查`/`调查`/`限制` a product-side escape (same family mechanism as `PRODUCT_POLICY_WORDS`, but for product actions) **or** record them as accepted with the refusal amplification in the module docblock; add the `(?![a-z])` trailing guard for Latin terms while in that function. (d) Pin all of it with a held-out table the implementer did not write — at minimum the 30 class leads and 46 product leads measured here — and assert each newly added term is load-bearing, so the next visit does not find the unpinned half again.

Verdict: PARTIAL

### References

- Safety report: `.works/kk-news-generate/20261124/4-safety-variants/20261124_09_safety-review_report.json`
- Skill refs: `plugins/kk/skills/content-safety/references/platforms/xiaoyuzhou.md` (XY-02), `wechatmp.md` (WX-01)
- Selection contract: `plugins/kk/skills/news-editorial/references/selection.md`, `style-contract.zh.md`
- Cost of the miss: 12.6 min TTS pass (`30-audio/`) with the two CN rows excluded

### History

- 2026-11-25T07:29:55.818Z todo → wip (system)
- 2026-11-25T16:39:44.370Z wip → blocked (system)

