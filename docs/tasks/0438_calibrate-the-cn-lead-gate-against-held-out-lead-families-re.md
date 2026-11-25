---
schema_version: 1
name: Calibrate the CN-lead gate against held-out lead families (recall 22/30, product false positives 12%)
status: todo
template: issue
created_at: 2026-11-25T20:50:28.401Z
updated_at: "2026-11-25T21:39:21.134Z"
feature_id: L3

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 5
---

## 0438. Calibrate the CN-lead gate against held-out lead families (recall 22/30, product false positives 12%)

### Background

A deterministic CN-lead gate exists (`plugins/kk/scripts/cn-lead-gate.ts`, wired into `daily-curate-check`
before synthesis, 0433), but six review rounds measured that its coverage is calibration work, not a
one-shot table.

Held-out measurements (each from a fresh reviewer pass, leads authored for that pass):

- v4: 15/42 class leads passed, 10 materially in class.
- v5: 22/30 passed (73%), all 8 materially in class; and the widening cost precision — 10/86 fresh
  product leads demoted (12%): Apache `许可`, code `审查`, vendor postmortem `调查`, product `限制`,
  and `新规` matching across a morpheme boundary in 更新规范.
- v5 sized the fix: extending the object/adjudication tables (E1) and the administrative-instrument
  predicate (E3) takes recall to 29-30/30 and product precision to 92%, with all 32 shipped fixture
  rows still correct.

Residual gaps named by v5: 指引 / 条例 / 细则 / 备案 / 征求意见 / 供应 / bare 管制 absent from the
vocabulary; the product-policy carve-out cancels on generic government words, so `教育部` / `央行` /
`数据局` fail to cancel while a company's `安全部门` does.

Acceptance for this task:
- a held-out measurement of >= 28/30 class leads caught, with <= 3/86 product-lead false positives,
  reproduced by a committed fixture table (not an ad-hoc probe);
- no path where a false positive refuses the whole day before synthesis (`enforceCnLead`'s
  all-candidates-tripped refusal must require an enumerated strong-class hit, not a two-signal match);
- the measurement method (fixture families both directions) committed so the next change is judged
  against it rather than against new anecdotes.

**Refine corrections (2026-11-25)**

- "E3 takes … product precision to 92%" set against the acceptance "<= 3/86 product false positives" → E3 alone leaves 36/40 + 43/46 = **7/86** false positives (0433 visit-5 table), more than double the budget. Meeting the bar also needs the review's item (c): a product-side escape for `许可`/`审查`/`调查`/`限制`, plus a trailing boundary on Latin terms (`Airbnb`/`Airtable` → `ai+…`). Both are now in R2/Design.
- "a committed fixture table reproduces the measurement" → the visit-5 held-out lists were **not persisted**. Only the 8 class misses, the 3 E3-accepted residuals and the false-positive rows (7 tabled + 3 amplification-pool rows + `Airtable 收紧免费额度上限`) are written out in `docs/tasks/0433_…md` § Review visit 5 (searched the repo: no other copy). The fixture is therefore re-authored here (seeded with those rows), frozen and measured against the **unchanged** gate before any gate edit.
- "`教育部` / `央行` / `数据局` fail to cancel" → only the `教育部` miss is the carve-out (`指南` ∈ `PRODUCT_POLICY_WORDS`, and `/政府|监管|国家|部门|法案|网信办|工信部|会议/` at `plugins/kk/scripts/cn-lead-gate.ts:294-296` has no ministry). The `央行` miss is `指引` absent and the `数据局` miss is `征求意见` absent; the `安全部门` false positive is `部门` cancelling the carve-out. One government-actor predicate fixes the first and last; the vocabulary additions fix the middle two.
- Residual list: visit 5's E1 also added `规划`. It is left out on purpose. Company roadmaps use it (`英伟达公布 2027 年最新规划`), and with `新规` dropped it would re-create that exact false positive.
- Line anchors moved since visit 5: the all-candidates refusal is `plugins/kk/scripts/daily-stages.ts:5836-5850` (cited as 5605-5620); the non-final rejection is `:5978-5984` (cited as 5747-5756). Code facts confirmed: `enforceCnLead` returns `blocked` when no candidate passes `checkCnLeadPlan` with zero hits of **either** detector (`cn-lead-gate.ts:397-418`), so a pool of two-signal-only false positives refuses the day; that path runs only under `daily-curate-check --final`.
- Fixture count confirmed: `plugins/kk/tests/cn-lead-gate-0433.test.ts` holds 22 trip rows (8 + 7 + 7) and 10 pass rows (6 + 4) in its tables, plus the AC1/AC2 constants.

### Requirements

- [ ] R1. On the committed class fixture (30 held-out XY-02/WX-01-class leads), the gate catches **>= 28/30**.
- [ ] R2. On the committed product fixture (86 product/market leads), the gate trips **<= 3/86**.
- [ ] R3. Every row of the shipped 0433 tables (`plugins/kk/tests/cn-lead-gate-0433.test.ts`: 22 trip, 10 pass, plus AC1/AC2) keeps its current verdict.
- [ ] R4. `enforceCnLead` returns `blocked` only when **every** candidate carries at least one enumerated-vocabulary hit (`CN_LEAD_VOCABULARY`). A pool with no clean candidate but at least one two-signal-only candidate leads with the first such candidate, and the run continues.
- [ ] R5. The measurement method is committed: both fixture families live in one data file, a test asserts the R1/R2 thresholds from it, every term this task adds is pinned by at least one row that trips **only** through it, and the module docblock plus `news-editorial/references/selection.md` § CN lead say how to re-measure.

Out of scope: the reporting-duty shape (`要求…报告`, 0433 visit-5 accepted residuals), a run artifact for successful demotions (visit-5 P4 #6), an automated tie between the vocabulary and the platform reference files (P4 #9), and any change to `content-safety` or the post-spend safety review.

### Acceptance Criteria

```gherkin
Scenario: AC1 — held-out class recall meets the bar (req: R1)
Given `plugins/kk/tests/fixtures/cn-lead-calibration.json` family `class` (30 rows)
When each row's lead is scanned with `scanCnLead(lead, '')`
Then at least 28 rows have hits, and the test names every missed row

Scenario: AC2 — product false positives stay within budget (req: R2)
Given the same file's family `product` (86 rows)
When each row is scanned
Then at most 3 rows have hits, and the test names every tripping row with its terms

Scenario: AC3 — the shipped 0433 tables are unchanged (req: R3)
Given the unmodified `plugins/kk/tests/cn-lead-gate-0433.test.ts`
When `bun test plugins/kk/tests/cn-lead-gate-0433.test.ts` runs
Then every case passes with no row edited, removed or moved between tables

Scenario: AC4 — a two-signal-only pool never refuses the day (req: R4)
Given a `--final` candidate pool of three product leads that trip only the two-signal detector
When `daily-curate-check --final` runs through the real runner
Then it exits 0, writes no `_03_cn-lead-refusal.json`, and the plan leads with the first candidate
And a pool where every candidate carries a vocabulary hit still exits non-zero with the refusal record

Scenario: AC5 — every added term is load-bearing (req: R5)
Given each fixture row that declares `pins: "<term>"`
When the row is scanned
Then its hit terms include that term, and removing the term from the gate turns the row clean
```

Test layers: AC1/AC2/AC5 in a new `plugins/kk/tests/cn-lead-gate-0438.test.ts` (pure `scanCnLead`, no mocks). AC3 is the existing file, unmodified. AC4 extends the real-runner leg pattern of `cn-lead-gate-0433.test.ts:198-262` (spawns `plugins/kk/scripts/kk-workflow-stages.ts daily-curate-check`). The AC5 "removing turns it clean" half is checked once by hand during implementation (fail-first evidence recorded in `### Testing`); the committed assertion is the `pins` term-membership check.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-25T21:39:06.900Z

- **Q: Where do the 30/86 held-out rows come from, given visit 5's lists were not persisted?** Closed: seed with every row visit 5 wrote out (8 class misses into `class`; the 7 tabled + 3 amplification + Airtable false-positive rows into `product`). Author the rest to reach 30/86 and commit the file with a baseline measurement against the **unchanged** gate before editing `cn-lead-gate.ts`. Rows are never edited after seeing gate output. Adding rows is allowed; removing one needs a Q&A line with the reason.
- **Q: Do the 3 E3-accepted residuals count in the 30?** Closed: no. They go in a separate `acceptedMisses` family, asserted to still pass, so the tradeoff stays visible without being counted against R1.
- **Q: Add `规划`?** Closed: no (see corrections: company roadmaps).
- **Q: How do `许可`/`审查`/`调查`/`限制` get a product-side escape?** Closed: extend the existing carve-out mechanism rather than adding a third detector. These four plus `PRODUCT_POLICY_WORDS` (+ `指引`) become *context-dependent signals*, and they count only when the same surface also matches the government-actor/jurisdiction predicate.
- **Q: R4: under `--final`, what leads a pool with no clean candidate?** Closed: the first candidate whose hits are all two-signal. The run then carries a weak lead instead of shipping nothing (visit-5 amplification: a refusal is worse than the incident it prevents). Refusal stays for the honest dead end of vocabulary-class hits everywhere.

### Design

**WHAT.** Recalibrate `plugins/kk/scripts/cn-lead-gate.ts` against a committed two-family fixture. Widen the policy vocabulary, replace the generic carve-out cancellation with a government-actor predicate, give the ambiguous product/policy words a context requirement, bound Latin matching on both sides, and narrow the `blocked` dead end to vocabulary-class hits.

**WHY.** Six review visits each widened the table against fresh anecdotes and each next visit found the unpinned half. A committed fixture in both directions turns the next change into a measurement. The refusal path currently turns three product false positives into a day with no episode.

**WHERE.** `plugins/kk/scripts/cn-lead-gate.ts` (constants `:180-230`, `trips` `:263-267`, second detector `:285-301`, `enforceCnLead` `:397-418`); `plugins/kk/scripts/daily-stages.ts:5836-5860` (log the weak-lead case beside the demotion line); new `plugins/kk/tests/fixtures/cn-lead-calibration.json` and `plugins/kk/tests/cn-lead-gate-0438.test.ts`; `plugins/kk/skills/news-editorial/references/selection.md` § CN lead.

**Frozen names / shapes.**
- `CnLeadHit.detector: 'vocabulary' | 'two-signal'` (new field; `daily-stages.ts` is the only importer).
- `CnLeadEnforcement.weakLead: { id: string; terms: string[] } | null`, set when R4's fallback chose the lead. `blocked` keeps its shape.
- `POLICY_SIGNAL_TERMS` += `指引`, `条例`, `细则`, `备案`, `征求意见`, `供应`, `管制`; −= `新规` (the vocabulary row's `出口新规` stays).
- `PRODUCT_POLICY_WORDS` += `指引`. New constant `CONTEXT_DEPENDENT_SIGNALS` = `PRODUCT_POLICY_WORDS` ∪ {`许可`, `审查`, `调查`, `限制`}.
- New constant `GOVERNMENT_ACTOR_RE` replaces the inline `/政府|监管|国家|部门|法案|网信办|工信部|会议/`. Start from visit 5's list: 国务院 / 人大 / 政协 / 网信办 / 工信部 / 数据局 / 央行 / 人民银行 / 总局 / 部委 / 市场监管 / 教育部 / 商务部 / 财政部 / 司法部 / 药监局 / 委员会 / 办公厅 / 政府 / 监管, plus the jurisdiction actors the class fixture needs (美国 / 美方 / 欧盟 / 对华 …). Drop `部门` and `会议`. Every entry must be pinned by a fixture row (AC5).
- Fixture file shape: `{ "class": Row[], "product": Row[], "acceptedMisses": Row[] }`, `Row = { "lead": string, "note": string, "source": "0433-v5" | "0438", "pins"?: string }`.

**Algorithm (second detector, per surface).** First find an AI object. Then find the policy signals present. A signal in `CONTEXT_DEPENDENT_SIGNALS` counts only if `GOVERNMENT_ACTOR_RE` matches the same squashed surface; any other signal counts outright. Emit one `two-signal` hit for the first counting signal. Latin matching becomes `(^|[^a-z0-9])term(?:s|'s)?(?![a-z0-9])`, which keeps plurals and possessives (the vocabulary comment at `:60-63` relies on `export controls`) and rejects `Airbnb`.

**Algorithm (`enforceCnLead`).** Clean candidate first (unchanged). Else take the first candidate whose hits are all `two-signal` → `weakLead`, same reorder as demotion. Else `blocked`.

**Anti-patterns.**
- No single-character actor tokens (`市` matches `市场`, `省` matches `省钱`).
- No row edits to make a number pass; no threshold tuning in the test.
- Do not touch the 0433 test file (AC3 proves R3 only if it is unmodified).
- No LLM call and no I/O in the gate (stays a pure function).
- No new mainline class or rule id.

**Dependencies / handoffs.** None in `dependencies[]`. Builds on the 0433 gate as shipped. After the edit, follow AGENTS.md "Editing `plugins/kk/scripts/`": rsync to the installed package, then `bun scripts/bundle-plugins.ts`. Otherwise the scheduled run keeps the old gate and `kk news generate`'s launch preflight refuses on the drift.

### Plan

0. Preconditions: `proto trust .prototools`; `git worktree list` / `spur task list --status wip` show no other edit to `plugins/kk/scripts/cn-lead-gate.ts` or `daily-stages.ts` (clean on 2026-11-25).
1. **Freeze the fixture (R5).** Write `plugins/kk/tests/fixtures/cn-lead-calibration.json` (30 class / 86 product / 3 acceptedMisses; visit-5 rows tagged `source: "0433-v5"`). Write `cn-lead-gate-0438.test.ts` with the threshold and `pins` assertions. Run it against the **unchanged** gate and record the baseline counts in `### Testing` (expect it to fail R1/R2). Commit the fixture before any gate edit.
2. **Vocabulary + Latin boundary (R1/R2).** Add and drop terms per Design and tighten `trips`. Re-run 0438 + 0433.
3. **Actor predicate + context-dependent signals (R1/R2).** Introduce `GOVERNMENT_ACTOR_RE` and `CONTEXT_DEPENDENT_SIGNALS`. Re-run both suites. If a threshold is still missed, list the failing rows and their mechanism; do not edit rows.
4. **R4.** Add `detector` and `weakLead`, change `enforceCnLead`, and log the weak lead in `daily-stages.ts`. Add the AC4 real-runner legs (two-signal-only pool → exit 0; vocabulary-everywhere pool → non-zero + refusal record).
5. **AC5 fail-first.** For each added term, temporarily remove it and confirm its pinned row turns clean. Record the result in `### Testing`, then restore.
6. **Docs (R5).** Module docblock: the measurement method and the fixture path. Fix the stale "node 5/19" line to the measured node numbers. `selection.md` § CN lead: the scanned surface (title + brief/summary/first body sentence), the weak-lead fallback and how to re-measure.
7. **Install sync.** `rsync -a plugins/kk/scripts/ "$KK_PKG/plugins/kk/scripts/"`, `bun scripts/bundle-plugins.ts`, `bun run tools:fresh` shows no drift.
8. Gates: `bun run lint`, `bun run test` (exit code, per-file 90% coverage), `bun run build`.

### Root Cause

Calibration debt, not a single defect (measured in 0433 Review visit 5). Three causes. (1) Vocabulary gaps on the domestic administrative-instrument surface: `POLICY_SIGNAL_TERMS` at `plugins/kk/scripts/cn-lead-gate.ts:197-230` lacks 指引/条例/细则/备案/征求意见/供应/管制. (2) Over-broad signals with no product-side escape: `许可`/`审查`/`调查`/`限制` ∈ `POLICY_SIGNAL_TERMS`, and the carve-out (`:294-296`) cancels on the generic `部门`/`会议`, not on government actors. Add to that the CJK substring artifact `新规` (更**新规**范) and the Latin leading-only boundary at `:263-267`. (3) The `blocked` dead end (`:405-411`) treats a two-signal false positive like an enumerated class hit, so false positives can refuse the day at `plugins/kk/scripts/daily-stages.ts:5836-5850`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Gate: `plugins/kk/scripts/cn-lead-gate.ts` (0433); wiring `plugins/kk/scripts/daily-stages.ts:5836-5860` (`--final` demote/refuse), `:5978-5984` (rejection → `curate --fix`)
- Measurements and the sized fix: `docs/tasks/0433_news-curation-may-lead-a-cn-episode-with-a-trade-control-mai.md` § Review visit 5 (breadth table, missed-lead table, false-positive table, "Next" items a–d); visit 4 at `:140`
- Shipped fixtures: `plugins/kk/tests/cn-lead-gate-0433.test.ts`
- Contract: `plugins/kk/skills/news-editorial/references/selection.md` § CN lead constraint; platform rules `plugins/kk/skills/content-safety/references/platforms/xiaoyuzhou.md` (XY-02), `wechatmp.md` (WX-01)
- Install-sync rule: `AGENTS.md` § Editing `plugins/kk/scripts/`

### History
