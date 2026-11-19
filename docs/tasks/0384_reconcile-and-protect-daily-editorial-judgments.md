---
schema_version: 1
name: Reconcile and protect daily editorial judgments
status: done
template: feature-impl
created_at: 2026-11-18T04:03:43.213Z
updated_at: "2026-11-19T23:19:51.316Z"
feature_id: L3
priority: P1

estimate_hours: 8
dependencies: ["0393"]
done_forced: "false"
done_reason: unforced close
---

## 0384. Reconcile and protect daily editorial judgments

### Background

L3 · 冻结后对齐、提交与快照。现行工作流在最终选题后进入稿件阶段，提供确定的对齐入口。 证据 `plugins/kk/workflows/kk-news-generate.yaml:137`。覆盖 R4, R10。

### Requirements

- [x] R1. conclusion.md 记录有证据的新判断和被取代记录，稿件采用本期快照并明确承认错误、致歉及更正（L3 R4）
- [x] R2. 重复操作不重复追加，冲突不会覆盖已确认判断，无新判断时复用合法快照（L3 R10）

### Acceptance Criteria

- [ ] R4 — 起草前对齐判断并公开纠错
- [ ] R10 — 重试和并发保护判断历史

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:03.365Z

**Ready decisions.** Use selected IDs and provenance produced by 0393. Bind proposal → validated commit → immutable run snapshot; 0385 consumes the snapshot and 0396 consumes correction IDs. Reuse the existing kk lock and same-directory atomic replacement. Treat unavailable or corrupt historical state as an explicit stop for judgment-dependent writing; preserve no-op replay and concurrent compare-and-swap. Carry a recovery receipt and backed-up path. Keep full editorial wording and external delivery in 0385/0396.

**Source premise.** `plugins/kk/workflows/kk-news-generate.yaml:137` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay new, superseded, empty, corrupt, concurrent and repeated proposals against disposable works. Prove cleanup protection and restore with the committed snapshot unchanged.

### Design

**Decision** — 冻结后对齐、提交与快照由现有边界承载。扩展 news-editorial 对齐模式与确定性提交步骤，沿用现有锁并采用摘要比较和原子替换。区分初次初始化和异常丢失。验证清理、对齐失败、并发和重放，文档同步到 ADR-054 约定。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/workflows/kk-news-generate.yaml:137`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 8 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 扩展 news-editorial 对齐模式与确定性提交步骤，沿用现有锁并采用摘要比较和原子替换。区分初次初始化和异常丢失。验证清理、对齐失败、并发和重放，文档同步到 ADR-054 约定。
- [ ] 保留 E2E 回放证据与相应文档更新。

### Solution

- **Ledger module** `plugins/kk/scripts/news-editorial-ledger.ts` (new): parse/render the single machine
  block in `<works_dir>/kk-news-generate/conclusion.md`, validate a proposal against the ids the
  *settled* plan carries, reconcile it (append / replay no-op / conflicting rewrite), and commit
  atomically. The four R10 protections run in this order: (1) the existing kk store single-flight claim
  `kk-news-editorial-ledger` injected as a `LockPort` (`kk lock acquire/release`, ADR-054 — no second
  lock); (2) compare-and-swap on the text digest read before the claim and re-read after it; (3)
  stable-id replay = `no-op`; (4) snapshot reuse when there is nothing new, refusal when this run
  already froze a foreign revision. Unavailable/corrupt history is an explicit `stop` with
  `<ledger>.corrupt` / `<ledger>.bak-<stamp>` reported — the ledger is never rebuilt from a proposal.
  Same-directory temp file + `renameSync` gives the one-inode atomic swap; every exit path writes the
  commit receipt.
- **Immutable run snapshot** `21-plan/<date>_judgment-snapshot.json` (`runDate`, `ledgerDigest`,
  `proposalDigest`, `judgments`, `superseded`, `corrections`, `preamble`) is what 0385 drafts from and
  0396 corrects from. It is a *projection* of the ledger, not a second authority: retired records leave
  `judgments` (they may not be drafted from) but travel verbatim in `superseded` and in each
  `correction.retired` (`id`/`date`/`fact`/`attribution`/`comment`/`supersededBy`), alongside the
  renderable `correction.text` and the `preamble` acknowledgment — so "what was wrong" and the wording
  owed are answerable from the snapshot alone, without reading the live ledger.
- **No new workflow nodes.** The frozen 20-node graph is unchanged: the `align` mode is authored by the
  existing `curate` scribe (its prompt asks for `21-plan/<date>_judgment-proposal.json` beside the
  plan), and the deterministic commit rides the existing `generate-check --step curate --final` row —
  `curate-final` runs `curate-check` then the non-advisory `news-editorial-commit` stage
  (`apps/cli/src/commands/content-generate.ts:891-899`), so `curate-final → script-write` cannot be
  reached with a refused commit. `script-write` drafts from the frozen snapshot
  (`plugins/kk/workflows/kk-news-generate.yaml:173-175`), never the live ledger.
- **Reselect tolerance belongs to the stage, not the ledger.** The proposal is authored in `curate`,
  while `curate-check`/`curate-fix`/the `--final` fallback settle `21-plan/<date>_03_plan_plan.json`
  afterwards, so a judgment can cite a selected id the settled plan dropped. `validateProposal` still
  refuses such an id (an unknown id must never be committed); `dropReselectedJudgments` in the stage
  drops those judgments before the commit and records them in the receipt's `droppedByReselection`
  (`<judgmentId>=> <selectedId>`) plus a printed line — the surviving judgments still commit, and a
  proposal with nothing committable left behaves exactly like the documented empty proposal (this run's
  legal snapshot is reused). Never a silent drop, never a hard stop for reselection alone, so the
  documented fallback row stays a fallback.
- **Stage body** `newsEditorialCommit(args)` in `plugins/kk/scripts/daily-stages.ts` — positional
  `news-editorial-commit <work_dir> <run_date> <run_id> [proposal_file] [ledger_file]`, exactly the
  daily-* convention. Defaults: proposal `21-plan/<date>_judgment-proposal.json` (absent = the
  documented "nothing new" case), ledger `dirname(work_dir)/conclusion.md`, outputs
  `21-plan/<date>_judgment-snapshot.json` + `21-plan/<date>_judgment-commit-receipt.json`. It supplies
  the ledger lock as a `kk lock acquire/release` port (`KK_EDITORIAL_COMMIT_OFFLINE=1` = the documented
  no-lock seam), prints the honest summary `committed | reused | conflict | stop` with
  appended/superseded/corrections/dropped counts, and exits 1 on `conflict`/`stop` with the recovery
  path. Dispatch: `case 'news-editorial-commit'` in `plugins/kk/scripts/kk-workflow-stages.ts:1925`.
- **Skill contract** `plugins/kk/skills/news-editorial/SKILL.md`: the `align` row in the invocation
  contract plus `## Mode: align` (proposal JSON, no-invention, stable-id, supersede-never-edit, "empty
  is legal", acknowledgment wording) — the rules the deterministic commit enforces and 0385 inherits.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/scripts/news-editorial-ledger.ts:296` renders `## 现行判断` + `## 被取代记录（保留不改写）` + `## 本期更正说明`; `:826` freezes `superseded`/`corrections.retired`/`text`/`preamble`; `plugins/kk/skills/news-editorial/SKILL.md:129` is the `align` contract; `plugins/kk/tests/news-editorial-ledger.test.ts:223` pins the retired record, correction id and preamble |
| R2 | MET | `plugins/kk/scripts/news-editorial-ledger.ts:521` — lock (`:597`), CAS (`:612`), replay no-op, snapshot reuse (`:659`); pinned by `plugins/kk/tests/news-editorial-ledger.test.ts:107`, `:142`, `:174`, `:190` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — 起草前对齐判断并公开纠错 | MET | test | `plugins/kk/tests/news-editorial-ledger.test.ts:223` (retired record + `text` + `preamble` frozen and written); authoring wired at `plugins/kk/workflows/kk-news-generate.yaml:94`, draft reads the snapshot at `plugins/kk/workflows/kk-news-generate.yaml:173` |
| R10 — 重试和并发保护判断历史 | MET | test | `plugins/kk/tests/news-editorial-ledger.test.ts:107` (replay no-op, byte-identical ledger), `:142` (CAS loses cleanly, both judgments survive), `:174` (contended lock writes nothing), `:190` (corrupt history stops with the backup path) — 22 pass / 0 fail |
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

- 2026-11-18T14:11:59.392Z todo → wip (system)
- 2026-11-18T14:51:08.100Z wip → testing (system)
- 2026-11-18T14:51:08.676Z testing → done (system)

