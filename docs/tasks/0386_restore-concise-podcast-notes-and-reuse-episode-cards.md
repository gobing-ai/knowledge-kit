---
schema_version: 1
name: Restore concise podcast notes and reuse episode cards
status: done
template: feature-impl
created_at: 2026-11-18T04:03:43.216Z
updated_at: "2026-11-18T21:18:29.958Z"
feature_id: L3
priority: P1

estimate_hours: 7
dependencies: ["0385"]
done_forced: "false"
done_reason: unforced close
---

## 0386. Restore concise podcast notes and reuse episode cards

### Background

L3 · podcast-pub 备注与卡片适配。旧备注读取 SurfDash 结果及音频产物，需要针对现行冻结产物重新接线。 证据 `plugins/kk/scripts/daily-stages.ts:4839`。覆盖 R7。

### Requirements

- [x] R1. 站点呈现简短要点、来源、实测时间线与有序卡片，文章链接随真实回执出现，卡片缺失时仍可读且备注区别于正文（L3 R7）

### Acceptance Criteria

- [ ] R7 — 节目备注恢复时间线并展示卡片

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:03.763Z

**Ready decisions.** Consume the final selected IDs, headline and 0394 citation provenance carried through 0385. Use the final audio offset evidence and existing card order. Render without a SurfDash URL, then enrich using an actual receipt. Record optional card-upload errors separately. Reuse podcast-pub’s renderer/transport, preserve old inputs and keep RSS text available when HTML or card assets are absent. 0388 consumes the resulting podcast payload.

**Source premise.** `plugins/kk/scripts/daily-stages.ts:4839` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay the 2026-10-19 notes structure plus a current case with excluded item, missing offset, missing card and unavailable article URL. Compare rendered station page and RSS payload.

### Design

**Decision** — podcast-pub 备注与卡片适配由现有边界承载。固定历史与当期样本，验证站点接受的 HTML，复用发布插件上传图片与出具回执。按实测时间和已讲条目渲染，链接随真实回执生成，提供文本和无卡片降级。

**Rejected alternative** — 从新建并行链路承载本能力，会产生第二套运维和兼容行为。

**Evidence** — `plugins/kk/scripts/daily-stages.ts:4839`；`docs/design/daily-ai-news-editorial-delivery.md`。预计 7 小时。

### Plan

- [ ] 复核现行入口、历史输入和已有任务，编写可重放的失败样例。
- [ ] 固定历史与当期样本，验证站点接受的 HTML，复用发布插件上传图片与出具回执。按实测时间和已讲条目渲染，链接随真实回执生成，提供文本和无卡片降级。
- [ ] 保留 E2E 回放证据与相应文档更新。

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-workflow-stages.test.ts:1071` |
| `plugins/kk/scripts/daily-stages.ts:5306` |
| `plugins/kk/scripts/daily-stages.ts:5317` |
| `plugins/publishings/podcast-pub/src/index.ts:226` |
| `plugins/publishings/podcast-pub/src/index.ts:231` |
| `plugins/publishings/podcast-pub/src/index.ts:28` |
| `plugins/publishings/podcast-pub/src/index.ts:6` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:176` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:201` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:203` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:23` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:231` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:26` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:294` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:362` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:370` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:420` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:470` |
| `plugins/publishings/podcast-pub/src/show-notes.ts:53` |
| `apps/cli/.works/kk.db:1` |
| `apps/cli/.works/kk.db-shm:1` |
| `apps/cli/.works/kk.db-wal:1` |
| `apps/cli/.works/test-artifacts/0212/README.md:1` |
| `apps/cli/.works/test-artifacts/0212/cutover-fixtures.md:1` |
| `apps/cli/.works/tmp/test-content-nouns/summary.json:1` |
| `apps/cli/.works/tmp/test-daily-recovery/cache/summary.json:1` |
| `plugins/publishings/podcast-pub/.works/tmp/test-podcast-transcript/episode-1.mp3:1` |
| `plugins/publishings/podcast-pub/src/show-notes-brief.ts:1` |
| `plugins/publishings/podcast-pub/tests/show-notes-brief-0386.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — site shows brief bullets, sources, MEASURED timeline and ordered cards; article link only with a real receipt; still readable when cards are missing and distinct from the article body | MET | bullets+sources: `plugins/publishings/podcast-pub/src/show-notes-brief.ts:155-165` render `kk-tl-brief` + `来源：<label>` from `sourceLabelFor` (`show-notes.ts:373-384`, `metadata.sourceName` → URL host), proven by `tests/show-notes-brief-0386.test.ts:44-56` (`来源：Sam Altman</a>`, `来源：anthropic.com</a>`); measured timeline: `computeAudioOffsets` (`show-notes.ts:68-101`) over `metadata.segments[]` in exact mode, asserted `0:10`/`0:30` from the measured 10s+20s segments (`tests/show-notes-brief-0386.test.ts:47-49`); ordered cards: `planCards` keeps manifest order (`show-notes-brief.ts:80-107`), `renderCardsRegion` (`:113-130`), asserted `[1,2,3,4]` + alt fallbacks (`tests/show-notes-brief-0386.test.ts:129-146`); receipt-gated link: `applyArticleReceipt` requires `ok !== false` **and** a `metadata.postPath` slug (`show-notes-brief.ts:222-240`), asserted link-free/byte-identical on absent+failed receipts (`tests/show-notes-brief-0386.test.ts:98-107`) and enriched on a real one (`:109-127`), with the stage feeding postPath only from `firstPostPath(...,'surfdash-pub')` which requires `ok === true` (`kk-workflow-stages.ts:1227`); cards-missing degradation: no `kk:cards`/`<img>`, timeline+placeholder intact through `renderShowNotesHtml` (`tests/show-notes-brief-0386.test.ts:161-171`); distinct from the article body: per-item `itemBrief` only, hostile markup escaped (`:74-82`, `:196-215`) and markdown→`content_html`/RSS via `map.ts:184` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — 节目备注恢复时间线并展示卡片 | MET | test | `plugins/publishings/podcast-pub/tests/show-notes-brief-0386.test.ts` — 12 pass / 0 fail / 59 expects (re-run in this review: `cd plugins/publishings/podcast-pub && bun test tests/show-notes-brief-0386.test.ts`); timeline `0:10`/`0:30` from measured segments (`:44-56`), ordered card region + `<img>` only from a hosted URL (`:129-159`); stage seam `apps/cli/tests/kk-workflow-stages.test.ts:3639-3710` — 5 pass / 0 fail (`cd apps/cli && bun test tests/kk-workflow-stages.test.ts -t "show-notes"`); `bunx tsc --noEmit -p plugins/publishings/podcast-pub` exit 0 |
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

- 2026-11-18T20:50:02.280Z todo → wip (system)
- 2026-11-18T21:18:29.337Z wip → testing (system)
- 2026-11-18T21:18:29.952Z testing → done (system)

