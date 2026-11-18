---
schema_version: 1
name: Compose news covers for the two centered crops
status: done
template: feature-impl
created_at: 2026-11-18T04:03:43.217Z
updated_at: "2026-11-18T22:25:45.124Z"
feature_id: L3
priority: P1

estimate_hours: 6
dependencies: ["0385"]
done_forced: "false"
done_reason: unforced close
---

## 0387. Compose news covers for the two centered crops

### Background

L3 · 新闻封面预设和排版。现有排版器固定了左上标识位置，可复用分层合成。 证据 `plugins/kk/scripts/cover-compositor.ts:121`。覆盖 R8。

### Requirements

- [x] R1. 两个目标平台的中心裁切都保留标题要点，完整封面右上角显示缩小后的透明标识，验证产物包含参考融合及平台裁切预览（L3 R8）

### Acceptance Criteria

- [ ] R8 — 新闻封面兼容中心裁切

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:03.960Z

**Ready decisions.** Consume the headline from 0385 and reuse the L2 preset/compositor. Keep alpha and preserve text contrast, glyph wrapping and the safe area shared by both crops. The operator banner is absent locally. Use a checked-in alpha-logo fixture for deterministic verification and report actual reference comparison as a separate operator check. Hand 0388 the same normalized cover artifact as today.

**Source premise.** `plugins/kk/scripts/cover-compositor.ts:121` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Run the existing daily-cover mock with short and long CJK titles and export both crop previews. Keep the existing compositor test command and add the measured capture to evidence when available.

### Design

**Decision** — 新闻封面预设和排版由现有边界承载。复用 L2、image-gen 与 compositor。核对操作员参考和两个平台裁切，使用透明右上标识及安全区域标题，留下长短标题裁切预览。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/scripts/cover-compositor.ts:121`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 6 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 复用 L2、image-gen 与 compositor。核对操作员参考和两个平台裁切，使用透明右上标识及安全区域标题，留下长短标题裁切预览。
- [ ] 保留 E2E 回放证据与相应文档更新。

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/kk/scripts/cover-compositor.ts:2` |
| `plugins/kk/scripts/cover-compositor.ts:281` |
| `plugins/kk/scripts/cover-compositor.ts:294` |
| `plugins/kk/scripts/cover-compositor.ts:325` |
| `plugins/kk/scripts/cover-compositor.ts:336` |
| `plugins/kk/scripts/cover-compositor.ts:344` |
| `plugins/kk/scripts/cover-compositor.ts:364` |
| `plugins/kk/scripts/cover-compositor.ts:37` |
| `plugins/kk/scripts/cover-compositor.ts:412` |
| `plugins/kk/scripts/daily-cover-mock.ts:137` |
| `plugins/kk/scripts/daily-cover-mock.ts:14` |
| `plugins/kk/scripts/daily-cover-mock.ts:169` |
| `plugins/kk/scripts/daily-cover-mock.ts:186` |
| `plugins/kk/scripts/daily-cover-mock.ts:22` |
| `plugins/kk/scripts/daily-cover-mock.ts:26` |
| `plugins/kk/scripts/daily-cover-mock.ts:61` |
| `plugins/kk/scripts/daily-cover-mock.ts:71` |
| `plugins/kk/tests/cover-compositor.test.ts:12` |
| `plugins/kk/tests/cover-compositor.test.ts:125` |
| `plugins/kk/tests/cover-compositor.test.ts:14` |
| `plugins/kk/tests/cover-compositor.test.ts:151` |
| `plugins/kk/tests/cover-compositor.test.ts:153` |
| `plugins/kk/tests/cover-compositor.test.ts:158` |
| `plugins/kk/tests/cover-compositor.test.ts:175` |
| `plugins/kk/tests/cover-compositor.test.ts:24` |
| `plugins/kk/tests/cover-compositor.test.ts:86` |
| `plugins/kk/tests/daily-cover-mock.test.ts:43` |
| `plugins/kk/tests/daily-cover-mock.test.ts:9` |
| `apps/cli/.works/kk.db:1` |
| `apps/cli/.works/kk.db-shm:1` |
| `apps/cli/.works/kk.db-wal:1` |
| `apps/cli/.works/test-artifacts/0212/README.md:1` |
| `apps/cli/.works/test-artifacts/0212/cutover-fixtures.md:1` |
| `apps/cli/.works/tmp/test-content-nouns/summary.json:1` |
| `apps/cli/.works/tmp/test-daily-recovery/cache/summary.json:1` |
| `plugins/kk/tests/cover-crop-safety-0387.test.ts:1` |
| `plugins/kk/tests/fixtures/alpha-logo.svg:1` |
| `plugins/publishings/podcast-pub/.works/tmp/test-podcast-transcript/episode-1.mp3:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — 两个目标平台的中心裁切都保留标题要点；完整封面右上角显示缩小后的透明标识；验证产物包含参考融合及平台裁切预览 | MET | (a) crops keep the point: `safeAreaRect()` = `{416,34,512,508}` inside both crop rects `{0,2,1344,572}` / `{384,0,576,576}`, `plugins/kk/tests/cover-crop-safety-0387.test.ts:130-146`; pixels inside the tight 1:1 crop differ **58** from backdrop while the withheld-headline control measures **0** (own probe, this round). (b) top-right scaled transparent emblem: `logoRect()` = `{1264,24,56,38}` (`plugins/kk/scripts/cover-compositor.ts:130`), drawn without a plate (`plugins/kk/scripts/cover-compositor.ts:340,364`), present at **663** vs the same-band bare rect on the flat bg and **95** on the photo bg, and **0** when the badge is absent — the probe now fails on an emblemless cover (`plugins/kk/tests/cover-crop-safety-0387.test.ts:397,405-406`). (c) verification products: `cover-full.png`, `cover-reference.png`, `reference-logo-blend.png`, `crop-wechat-mp.png` (1344×572), `crop-podcast-site.png` (576×576) + `manifest.json` under `.spur/run/0387-cover-previews/{short,long}/`, regenerated this round from the restored source with the emblem at `bbox y=24`. |
| R1 (verification-integrity sub-claim: the artifacts actually prove the emblem) | MET | Both mutation-named tests fail under an absent default emblem (20 pass / 2 fail) and the artifacts' own pixels carry it (badge `(202,211,224,243)` vs bare `(0,0,0,0)`) — see P2 row 1 and P4 row 5. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R8 — 新闻封面兼容中心裁切 | MET | command | `bun test tests/cover-crop-safety-0387.test.ts tests/cover-compositor.test.ts tests/daily-cover-mock.test.ts` (from `plugins/kk`) → 45 pass / 0 fail (22 in the safety file); mutation control 20 pass / 2 fail with both named cases; lint exit 0; geometry asserted against real platform aspects at `plugins/kk/tests/cover-crop-safety-0387.test.ts:99-110,130-146` (WeChat `crop_multi` parity, `plugins/publishings/wechatmp-pub/src/cgi.ts:20`); artifact pixels at `:374-408`; shipped crops `.spur/run/0387-cover-previews/short/crop-podcast-site.png` (576×576), `.../crop-wechat-mp.png` (1344×572) per `.spur/run/0387-cover-previews/short/manifest.json` |
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

- 2026-11-18T21:48:09.087Z todo → wip (system)
- 2026-11-18T22:25:44.462Z wip → testing (system)
- 2026-11-18T22:25:45.118Z testing → done (system)

