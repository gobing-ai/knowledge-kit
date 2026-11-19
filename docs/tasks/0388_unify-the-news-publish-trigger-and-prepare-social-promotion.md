---
schema_version: 1
name: Unify the news publish trigger and prepare social promotion
status: done
template: feature-impl
created_at: 2026-11-18T04:03:43.217Z
updated_at: "2026-11-19T01:19:54.670Z"
feature_id: L3
priority: P1

estimate_hours: 8
dependencies: ["0386", "0387"]
done_forced: "false"
done_reason: unforced close
---

## 0388. Unify the news publish trigger and prepare social promotion

### Background

L3 · 发布预设和现有发布核心。现行发布入口按窗口变更默认期次，迁移时必须固定节目日期。 证据 `apps/cli/src/commands/content-launch.ts:525`。覆盖 R9。

### Requirements

- [x] R1. 依赖满足的目标按既有权限执行，微信保留草稿和扫码边界，未就绪的引流可按目标重试且提供逐渠道实机测试材料（L3 R9）

### Acceptance Criteria

- [ ] R9 — 各渠道由一次发布触发并保留授权矩阵

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.156Z

**Ready decisions.** Consume generated assets from 0386/0387. Keep kk news publish as the entry point and the existing preset as the authority on modes. Dispatch the dependency graph once per frozen date, resolve successful owner URLs from same-bundle receipts, and use existing per-target retry without repeating completed effects. Keep compatibility for legacy windows. Leave operator clock and live authorization unchanged during rehearsal. Target-specific WeChat article binding belongs to 0395 and correction evidence to 0396.

**Source premise.** `apps/cli/src/commands/content-launch.ts:525` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Rehearse dry and fake sends with cross-midnight run date, DST, RSS miss, partial success, retry and unchanged approvals. Preserve full target and operation receipt evidence.

### Design

**Decision** — 发布预设和现有发布核心由现有边界承载。扩展单次新闻发布选择与目标依赖，保留授权模式、旧目标重放及微信人工步骤。通过预检、RSS 超时、部分失败、幂等和 DST 的 dry-run，按渠道留社媒预演材料与排程切换方案。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `apps/cli/src/commands/content-launch.ts:525`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 8 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 扩展单次新闻发布选择与目标依赖，保留授权模式、旧目标重放及微信人工步骤。通过预检、RSS 超时、部分失败、幂等和 DST 的 dry-run，按渠道留社媒预演材料与排程切换方案。
- [ ] 保留 E2E 回放证据与相应文档更新。

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/content-launch.ts:105` |
| `apps/cli/src/commands/content-launch.ts:34` |
| `apps/cli/src/commands/content-launch.ts:516` |
| `apps/cli/src/publish-matrix.ts:1391` |
| `apps/cli/src/publish-matrix.ts:1474` |
| `apps/cli/src/publish-matrix.ts:1665` |
| `apps/cli/src/publish-matrix.ts:1688` |
| `apps/cli/src/publish-matrix.ts:24` |
| `apps/cli/tests/publish-matrix.test.ts:1481` |
| `apps/cli/.works/kk.db:1` |
| `apps/cli/.works/kk.db-shm:1` |
| `apps/cli/.works/kk.db-wal:1` |
| `apps/cli/.works/test-artifacts/0212/README.md:1` |
| `apps/cli/.works/test-artifacts/0212/cutover-fixtures.md:1` |
| `apps/cli/.works/tmp/test-content-nouns/summary.json:1` |
| `apps/cli/.works/tmp/test-daily-recovery/cache/summary.json:1` |
| `apps/cli/src/publish-dispatch.ts:1` |
| `apps/cli/tests/publish-dispatch.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — 依赖满足的目标按既有权限执行，微信保留草稿和扫码边界，未就绪的引流可按目标重试且提供逐渠道实机测试材料（L3 R9） | MET | Dependency-satisfied dispatch + per-target retry + adoption: `apps/cli/src/publish-matrix.ts:1486-1536`, `:1669-1678`; `apps/cli/tests/publish-matrix.test.ts:1533-1583` (second trigger adopts), `:1560-1583` (only the failed target retried under `--retry`); WeChat draft + QR-scan boundary: `apps/cli/src/publish-dispatch.ts:142-153`, `apps/cli/tests/publish-dispatch.test.ts:218-248`; authorization matrix preserved: `apps/cli/src/publish-matrix.ts:607-613`, `:1595-1601` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R9 — 各渠道由一次发布触发并保留授权矩阵 | MET | test | One trigger, one frozen date, no repeated effect: `apps/cli/tests/publish-matrix.test.ts:1533-1558`; unique-ledger behaviour now mutation-certified at `apps/cli/tests/publish-matrix.test.ts:1629-1654`; `apps/cli/tests/publish-dispatch.test.ts:133-250`; production wiring `apps/cli/src/publish-matrix.ts:1482-1526`, `:1662-1695`; wechatmp never live `apps/cli/src/publish-dispatch.ts:142-153` |
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

- 2026-11-18T22:55:15.481Z todo → wip (system)
- 2026-11-19T01:19:53.708Z wip → testing (system)
- 2026-11-19T01:19:54.654Z testing → done (system)

