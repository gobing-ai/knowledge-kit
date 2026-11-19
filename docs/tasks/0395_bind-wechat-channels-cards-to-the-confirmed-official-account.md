---
schema_version: 1
name: Bind WeChat Channels cards to the confirmed Official Account article
status: done
template: feature-impl
created_at: 2026-11-18T04:49:21.260Z
updated_at: "2026-11-19T23:19:53.526Z"
feature_id: L3
priority: P1

estimate_hours: 5
dependencies: ["0388"]
done_forced: "false"
done_reason: unforced close
---

## 0395. Bind WeChat Channels cards to the confirmed Official Account article

### Background

The daily preset already defines shipinhao-pub/image with generic cards (plugins/kk/publish-presets/daily-ai-voice.json:126). The generic article placeholder resolves SurfDash (apps/cli/src/publish-matrix.ts:469). A WeChat draft has no confirmed public article URL.

### Requirements

- [x] R1. Gate the existing Channels image target on the verified Official Account article for the same episode, and carry that URL plus the approved card payload (L3 R18).
- [x] R2. Defer only that target when the link is missing or unsafe, preserve configured modes, and retry using existing target receipts.

### Acceptance Criteria

- [ ] R18 — 视频号卡片只使用已确认的公众号文章链接

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:05.568Z

**Ready decisions.** Consume 0388 target dependency and receipt contracts. Scope changes to the existing image operation and its variant. A prepared draft has no eligible link; an operator-confirmed public link must carry same-episode identity and safe URL verification. Targets retain their current configured modes. A dry or fake transport is enough to verify behavior when live access is absent.

**Source premise.** `plugins/kk/publish-presets/daily-ai-voice.json:126` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay draft, bad link, different episode, approved same-episode link and a retry. Record dependency classification and downstream delivery outcome for 0389.

### Design

Own the shipinhao-pub image payload and target dependency binding after 0388. Accept a verified public URL from existing WeChat results where available, or an operator-supplied URL through the existing receipt/recovery path if a draft was manually released. Bind it to the same episode/bundle and verify the allowed platform destination at the trusted boundary. Generic card and article variants retain their existing behavior. Any URL missing, unverified or pointing to an unrelated episode produces a visible non-send outcome. Adopt the channel’s existing approved link mechanism if supported; if a clickable attachment is unavailable, use the official URL in the caption when allowed and record that distinction. Keep off/dummy/draft/live unchanged.

### Plan

- [ ] Add fake transport fixtures for draft, published but unverified, verified same-episode link, mismatched episode and retry.
- [ ] Prepare the scoped card payload, dependency evidence and manual release handoff. Reuse existing classification and retry.
- [ ] Capture the target plan, payload and receipt in a repeatable rehearsal. Check unrelated targets and duplicate suppression.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/publish-matrix.ts:12` |
| `apps/cli/src/publish-matrix.ts:1398` |
| `apps/cli/src/publish-matrix.ts:1647` |
| `apps/cli/src/publish-matrix.ts:1688` |
| `apps/cli/src/publish-matrix.ts:1734` |
| `apps/cli/src/publish-matrix.ts:37` |
| `apps/cli/tests/daily-cache-recovery.test.ts:124` |
| `apps/cli/tests/daily-cache-recovery.test.ts:197` |
| `apps/cli/.works/kk.db:1` |
| `apps/cli/.works/kk.db-shm:1` |
| `apps/cli/.works/kk.db-wal:1` |
| `apps/cli/.works/test-artifacts/0212/README.md:1` |
| `apps/cli/.works/test-artifacts/0212/cutover-fixtures.md:1` |
| `apps/cli/.works/tmp/test-content-nouns/summary.json:1` |
| `apps/cli/.works/tmp/test-daily-recovery/cache/summary.json:1` |
| `apps/cli/src/publish-channels-link.ts:1` |
| `apps/cli/tests/publish-channels-link.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Gate: `apps/cli/src/publish-channels-link.ts:106-150` (same-episode via `resolveOwnerUrls` on `plan.parentRunId` at `:120`; safe-destination verification at `:83-95`; only `shipinhao-pub`/`image` targeted at `:68-73`). Wiring: `apps/cli/src/publish-matrix.ts:1650` (`channelsCardIds`) + `1694-1721` (gate before payload work, `channels-card-deferred`/`channels-card-bound` events) + `1734-1743` (carry). Producer set = this bundle's wechatmp `variant: article` rows across sibling plans: `apps/cli/src/publish-matrix.ts:1436-1456`. Payload carry: `apps/cli/src/publish-channels-link.ts:161-197`. Proof: `apps/cli/tests/publish-channels-link.test.ts:349-370` (retry sends the card once with `https://mp.weixin.qq.com/s/AbCdEf123456`, `metadata.images` unchanged) |
| R2 | MET | Per-row deferral via the documented seam (`apps/cli/src/publish-matrix.ts:1711` → `apps/cli/src/publish-core.ts:498-520` writes `failed`/`effect: none` and continues the loop); no mode write anywhere in the diff. Siblings keep modes and dispatch + card is the only ledger `retry` entry: `apps/cli/tests/publish-channels-link.test.ts:305-325`. Missing-link and unsafe-link classes: `:327-347`. Retry through 0388's ledger only (`retryable`/`--retry`), sends once and does not resend: `:356-373` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R18 — 视频号卡片只使用已确认的公众号文章链接 | MET | test | `apps/cli/tests/publish-channels-link.test.ts:305-325` — draft article → card receipt `failed`/`effect: none`/`channels-card-article-still-draft`, siblings `surfdash-pub.post` + `wechatmp-pub.文章` + `x-pub.post` dispatched, only `shipinhao-pub.image` in `retryable(ledger)`; `:349-370` — after release the retried card ships that exact URL with the unchanged approved `metadata.images` and a second retry issues 0 calls; `:338-347` — a foreign link never dispatches. Fresh run: `cd apps/cli && bun test tests/publish-channels-link.test.ts` → 9 pass / 0 fail, 59 expects; mutation-stubbed gate → 6 fail (probe (d)) |
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

- 2026-11-19T01:53:04.750Z todo → wip (system)
- 2026-11-19T02:44:13.069Z wip → testing (system)
- 2026-11-19T02:44:13.686Z testing → done (system)

