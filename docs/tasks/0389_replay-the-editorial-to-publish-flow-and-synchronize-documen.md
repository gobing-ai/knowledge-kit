---
schema_version: 1
name: Replay the editorial-to-publish flow and synchronize documentation
status: done
template: feature-impl
created_at: 2026-11-18T04:03:43.217Z
updated_at: "2026-11-19T23:19:52.754Z"
feature_id: L3
priority: P1

estimate_hours: 5
dependencies: ["0388", "0390", "0395", "0396"]
done_forced: "false"
done_reason: unforced close
---

## 0389. Replay the editorial-to-publish flow and synchronize documentation

### Background

L3 · 跨插件回放与文档一致性。现行发布 DAG 和生成 DAG 可用冻结产物做串联回放。 证据 `plugins/kk/workflows/kk-publish.yaml:50`。覆盖 R1。

### Requirements

- [x] R1. 由可重放基线验证流程校验归代码、编辑判断归 Agent、目标适配归插件（L3 R1）

### Acceptance Criteria

- [x] R1 — 验证现有边界与节目基线

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.354Z

**Ready decisions.** Close the batch after 0388, 0390, 0395 and 0396. Consume read-only fixture receipts from their providers and cover the three observation tasks through the integrated current pipeline. Keep release operations outside acceptance: installed-package and offline transport rehearsals prove behavior, and the report identifies any actual account, asset or live confirmation still needed.

**Source premise.** `plugins/kk/workflows/kk-publish.yaml:50` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Save one repeatable end-to-end command and its artifact paths. Compare normal and no-content outputs, cue timing, duplicate prevention, source links, failure drill-down, correction delivery and exact publish retry. Run lint, build, test and configured rule gates.

### Design

**Decision** — 跨插件回放与文档一致性由现有边界承载。用 10 月 19 日与两个相异新闻密度的冻结输入重放主链及故障分支，归档差异、截图与发布收据，核对 00/03/04/05 文档及工具安装漂移。记录需要运营实机批准的校验。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/workflows/kk-publish.yaml:50`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 5 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 用 10 月 19 日与两个相异新闻密度的冻结输入重放主链及故障分支，归档差异、截图与发布收据，核对 00/03/04/05 文档及工具安装漂移。记录需要运营实机批准的校验。
- [ ] 保留 E2E 回放证据与相应文档更新。

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/04_DESIGN.md:24` |
| `docs/04_DESIGN.md:558` |
| `docs/04_DESIGN.md:6` |
| `docs/04_DESIGN.md:8` |
| `docs/05_FEATURES.md:124` |
| `docs/05_FEATURES.md:6` |
| `docs/05_FEATURES.md:8` |
| `apps/cli/.works/kk.db:1` |
| `apps/cli/.works/kk.db-shm:1` |
| `apps/cli/.works/kk.db-wal:1` |
| `apps/cli/.works/test-artifacts/0212/README.md:1` |
| `apps/cli/.works/test-artifacts/0212/cutover-fixtures.md:1` |
| `apps/cli/.works/tmp/test-content-nouns/summary.json:1` |
| `apps/cli/.works/tmp/test-daily-recovery/cache/summary.json:1` |
| `apps/cli/tests/editorial-publish-replay-0389.test.ts:1` |
| `plugins/publishings/podcast-pub/.works/tmp/test-podcast-transcript/episode-1.mp3:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Code-owned refusals executed, not described: `apps/cli/tests/editorial-publish-replay-0389.test.ts:194-209` (`validateProposal` refuses an unselected id; `parseConclusion` errors on a corrupt machine block), `:488-520` (`BundleSchema` refuses `safety.status=block`, an unknown top-level key and a variant without `sha256`; `resolveFrozenRunDate` throws on `2026-13-40`). Agent-owned judgement: `:561-577` (skill declares "Everything deterministic stays in code" + policy vocabulary; ledger must not carry `新闻优先`/`选题边界`/`white-collar` vocabulary and must not read the skill). Plugin-owned adaptation: `:579-614` (non-empty owner scan of `plugins/publishings/podcast-pub/src` for `<!--kk:timeline-->`/`<!--kk:corrections-->`/`kk-tl-row`, zero in `apps/cli/src`, zero `plugins/publishings/*` or `@gobing-ai/*-pub` imports in the CLI, 22 `<name>-pub` packages each owning `src/index.ts`). Vacuous-pass guards present (`:545` >10 agent surfaces, `:589` non-empty owner scan, `:606` >10 plugin dirs). **Mutation sensitivity verified live by this review, not assumed:** a new file `apps/cli/src/…tmp.ts` containing `<!--kk:corrections-->` → 8 pass / 1 fail at `:593`; file deleted, `git status --porcelain` md5 identical before/after |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — 验证现有边界与节目基线 | MET | test | `cd apps/cli && NODE_ENV=test bun test tests/editorial-publish-replay-0389.test.ts` → **9 pass / 0 fail, 125 expect()**, fresh run by this review (0.22 s). Boundary half: `:538-614` (three split scans + the probe above). Baseline half replayed over frozen fixtures through the shipped modules: `:147-192` 0385 `freezeEpisodeIdentity`/`composeEpisodeTitle`/`identityFromMetadata` (`第261119期 · …`), `:211-283` 0386 `renderBriefShowNotes` (frozen H1, `openai.com` source label, `待文章发布回执` placeholder) + 0396 `readFrozenCorrections`/`renderCorrectionsBlock`, `:321-397` 0388 `resolveFrozenRunDate` → `planDispatch` ×4 → `writeDispatchLedger`/`readDispatchLedger` over the node fs port in a `mkdtemp` dir, `:399-486` 0395 gate + `carryOfficialAccountLink` idempotency, `:488-520` schema/date boundary |
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

- 2026-11-19T07:37:36.550Z todo → wip (system)
- 2026-11-19T07:40:18.179Z wip → testing (system)
- 2026-11-19T07:40:19.511Z testing → done (system)

