---
schema_version: 1
name: weibo-pub live operator dogfood — pin composer and article editor selectors
status: wip
template: feature-impl
created_at: 2026-10-09T23:19:30.104Z
updated_at: "2026-10-12T15:09:10.084Z"
feature_id: E94
priority: P3
tags:
  - publish
  - weibo
  - dogfood
  - E94
estimate_hours: 2

dependencies: ["0244", "0245"]
---

## 0246. weibo-pub live operator dogfood — pin composer and article editor selectors

### Background

Offline tests cannot prove Weibo selectors. An operator-attended live run pins `WEIBO_POST_SELECTORS` / `WEIBO_ARTICLE_SELECTORS` / `WEIBO_ARTICLE_URL` and records the discovery note, same as `docs/design/x-article-ui-discovery.md` (task 0204/0194). Design: `docs/design/weibo-threads-publish-channels.md` §3, §6.

Implements (live evidence): R4 — weibo-pub saves a post or article draft by default from an observed signal; R5 — weibo-pub publishes live only when publishStatus is public.

**Refine corrections (2026-10-09)**
- Article editor URL and 保存草稿 label were treated as known → no first-party source (web search 2026-10-09) → this task owns measuring them, and owns re-scoping R4's article half through `spur feature update E94` if no draft control exists.
- `checkHeadedOnly` default unmeasured → x-pub needed `true` (`plugins/publishings/x-pub/src/index.ts:212`) → this task measures Weibo's headless behaviour and sets it.
- Concurrency: no `wip` tasks; worktree `knowledge-kit-runall-0237-0238-53a2` touches only `plugins/kk/scripts/daily-stages.ts` + `plugins/kk/workflows/kk-daily-ai-voice2.yaml` → no overlap.

**Refine corrections (2026-10-11)**
- Setting `checkHeadedOnly` was treated as making publishing usable headlessly → shared operator check forwards it, but publish must retain a headless-only preflight → measure and report both separately, never bypass R6.
- The invariant “no live run without public” also forbade the required article draft probe → distinguish permitted unpublished draft runs from explicitly approved public test writes.
- Only 0244 was a dependency although this task finalizes 0245’s docs row → add dependency 0245 to serialize row ownership.
- Feature R5 covers public article and post, but the planned dogfood measured only post → include a separate operator-approved article-public leg or leave R5 live evidence explicitly incomplete.
- Historical concurrency inventory → Current-tree audit (2026-10-11): no WIP tasks. Other worktree `knowledge-kit-runall-g8-4173` owns G8 board/workflow work and currently edits root `package.json`, `bun.lock`, and `apps/cli/package.json`; coordinate lockfile integration before implementation, preserve its changes. The main tree has pre-existing edits in daily, store-selections, voice2-dag and wechatmp tests; preserve them.

### Requirements

- [ ] R1. Operator runs `bun plugins/publishings/weibo-pub/src/profile-check.ts login` then `check` (exit 0) on a disposable Weibo account; record a forced headless `checkChannelSession` call (`headedFallback: false`, no headedOnly) separately from operator `check --headed`; set `WEIBO_CONFIG.checkHeadedOnly` for the operator CLI only if measured. If forced headless fails, record the fail-closed publish limitation and do not run public legs by bypassing preflight.
- [ ] R2. Live `article` run (no publishStatus) saves a 头条文章 draft and returns `ok: true` from the observed signal; the draft is visible in Weibo's draft list. If no draft control exists, stop and re-scope via `spur feature update E94` instead.
- [ ] R3. With separate explicit operator approval for each public write, live `post` and live `article` runs with `publishStatus: 'public'` return `ok: true` from fresh signals with their status/article URLs and ids; operator removes the disposable test content afterwards. No approval or no headless verification means stop before the public write and retain partial evidence, never claim R5 verified.
- [ ] R4. `WEIBO_ARTICLE_URL`, `WEIBO_POST_SELECTORS`, `WEIBO_ARTICLE_SELECTORS` and signals updated to the observed DOM; `docs/design/weibo-ui-discovery.md` records each selector hit, signal and the measurement date; `docs/04_DESIGN.md` satellite row drops "live selectors pending 0246".


**Out of scope:** production-account publishing, automatic deletion, credentials/session artifacts, bypassing headless preflight, changing feature scope merely to make a test pass. Any missing draft control or required flow change is documented and re-planned through Spur; no fallback to live publishing.

### Acceptance Criteria

- [ ] AC1 — weibo-pub saves a post or article draft by default from an observed signal (req: R2)
- [ ] AC2 — weibo-pub publishes live only when publishStatus is public (req: R3)

Evidence: live run Result JSON + `docs/design/weibo-ui-discovery.md`; offline suite re-run green after constant changes.

Given 0244/0245 are complete and an operator has a disposable verified account, when the draft leg and separately approved public post/article legs run, then fresh observed signals and cleanup records prove AC1/AC2. `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` must also retain stale-signal refusal and headless-only preflight regression cases after selector changes. Offline tests alone cannot verify live AC.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T23:48:37.710Z

- **No article draft control found** — deferred contingency owned here: re-scope via feature update, never fall back to live publishing.

#### Q&A entry — 2026-10-12T04:28:56.405Z

- **Public-write permission** — closed: refinement authorizes this plan only; actual public post and article writes each need explicit operator approval at execution. Draft leg remains unpublished.
- **Headless wall/no draft control** — closed: stop that leg, retain evidence and re-plan; never switch publish to a headed-only probe or public fallback.
- **Dependencies/status ownership** — closed: 0245 precedes this task; shipped status requires completed live evidence and cleanup.

### Design

- **Approach:** operator-attended headed runs; capture DOM with the harness, then pin ladders (measured candidate first, seed candidates kept as fallbacks). Reason: E91-D6 needs a real observed signal.
- **Where:** `plugins/publishings/weibo-pub/src/index.ts` (constants only), `docs/design/weibo-ui-discovery.md` (new), `docs/04_DESIGN.md` row.
- **No new API:** constants and config flag only; flow logic changes only if a measured interaction demands it (record why in the note).
- **Rejected:** recorded HAR fixtures (stale under DOM churn).
- **Invariants:** unpublished article drafts are allowed without public; public writes require both `publishStatus: 'public'` and contemporaneous operator approval; test content removed by the operator; no credentials, cookies or page HTML committed.
- **Dependencies:** assumes 0244's transport/profile-check and 0245's registered channels/live-pending docs row; leaves selectors and evidence verified, plus lint/test/build and applicable rule gates green.

- **Bounded operator run:** one login and one forced-headless probe, then at most one article draft, one explicitly approved public post and one explicitly approved public article per attempt (no automated retry). Persist sanitized Result JSONs under `.spur/run/0246-weibo-<date>/`; discovery note carries command/options, measurement time, outcome step/signal, observed public URLs/ids and cleanup confirmation. No cookies, page HTML, full DOM dumps, token values or screenshots exposing account data are committed. Preserve partial artifacts and the concrete failed step; resume only after reconciling the current task contract.
- **Contingencies closed:** absence of a draft control, headless refusal, missing public-write approval or stale signals stops the affected leg. Record the fact and required operator action; do not mark the task done or the satellite shipped. A feature-body change uses `spur feature update` preserving scenario identity and requires renewed ready review of affected tasks. Live DOM is deliberately unknown before this task; its first deliverable is measurement, not assumed selectors.
- **Finalization:** only after both draft/public evidence and cleanup are recorded does the 04 row and satellite status become shipped. If flow changes exceed constants/config, persist discovery and re-plan rather than improvising a new flow under a selector task.
- Current-tree audit (2026-10-11): no WIP tasks. Other worktree `knowledge-kit-runall-g8-4173` owns G8 board/workflow work and currently edits root `package.json`, `bun.lock`, and `apps/cli/package.json`; coordinate lockfile integration before implementation, preserve its changes. The main tree has pre-existing edits in daily, store-selections, voice2-dag and wechatmp tests; preserve them.

### Plan

- [ ] 0. Confirm 0244/0245 complete and operator/account available; agree disposable content. Login then forced headless and headed checks → R1. Preserve partial evidence if unavailable; no fake live verdict.
- [ ] 2. Article draft run; adjust selectors/URL → R2.
- [ ] 3. Obtain explicit approval separately for a public post and public article; run each once after headless verification, pin fresh signals, have operator remove both → R3.
- [ ] 4. Record sanitized discovery and cleanup evidence; only on complete evidence finalize satellite + 04 row. Run lint/test/build and applicable rules; inspect intentional Git changes → R4.

### Solution

#### Change map

| Path | What changed |
| --- | --- |
| `plugins/publishings/weibo-pub/src/index.ts:54-72` | `WEIBO_POST_SELECTORS` **pinned from live measurement** (2026-10-12): composer `textarea[placeholder*="新鲜事"]` (measured node: `textarea`, placeholder `有什么新鲜事想分享给大家？`, class `_input_*`), send `button:has-text("发送")`, and the feed-card ladder now leads with the measured `a[class*="_time_"]`. Every `send` fallback stays constrained to its own 发送 text because the measured `woo-button-primary` class is shared with the account's 管理 button — a bare class fallback would click the wrong control. |
| `plugins/publishings/weibo-pub/src/index.ts:36-43` | `WEIBO_ARTICLE_URL` doc now records the measurement: the route redirects to `weibo.com/` for an account without the 头条文章 entitlement (the throwaway account had none). |
| `plugins/publishings/weibo-pub/src/index.ts:69-80` | `WEIBO_ARTICLE_SELECTORS` doc states plainly that they are **not** measured live and why, keeping the fail-closed ladders. |
| `plugins/publishings/weibo-pub/src/index.ts:226-231` | One bounded post-flow refresh flag (`reloadedForPost`) so a card Weibo only renders after a reload is still observed — the composer sits at the top of the timeline, but the feed does not always insert the new card in place. |
| `plugins/publishings/weibo-pub/src/index.ts:~455-470` | `probePostLive` now (a) filters fresh cards, (b) reads the excerpt from the **card container** rather than the link (measured: the matched link's own text is the timestamp, e.g. `3小时前`), and (c) performs the single reload when no fresh card has appeared. |
| `plugins/publishings/weibo-pub/src/index.ts:~605-620` | `cardTextScript` reads `closest('article, [class*="card"], [class*="Card"], div[class*="Feed"]')` with a parent fallback — same measurement. |
| `plugins/publishings/weibo-pub/src/index.ts:~330-350` | The post flow snapshots toasts before the send and names a fresh one in the refusal (`… (site said: …)`), so a site-side rejection is reported instead of a bare timeout. |
| `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` | One new case: a fresh failure toast is named when the send produces no card (`38` offline tests total, all green). |
| `docs/design/weibo-ui-discovery.md` | **New** measurement note: R1 preflight results, the composer/send/status-link measurements with counts and descriptors, the two live post attempts and their read-only verification, the four 头条文章 routes and their landings, the entitlement finding, and the pinned constants with the reasons for each flow fix. |
| `docs/04_DESIGN.md:43` | Satellite row: `implemented (E94)`; Weibo post selectors pinned live 2026-10-12, 头条文章 half entitlement-gated, **live post/article evidence still open (0246)** — deliberately not "shipped". |
| `docs/features/E94_…md` (feature corpus, via `spur feature update`) | R4's scenario body: `Given a verified Weibo browser profile with the 头条文章 entitlement …` plus a step stating that an account without it is refused rather than silently publishing (measured 2026-10-12). **Scenario identity unchanged**; `spur feature check E94` passes. |

#### Measured outcome vs the task's requirements (honest summary)

| Req | Outcome |
| --- | --- |
| R1 | **MET** — operator `login` and `check` both exit 0, and a forced-headless `checkChannelSession` probe (`headedFallback: false`, no `headedOnly`) reports `verified`. `checkHeadedOnly` therefore stays `false`, unlike x-pub. |
| R2 | **NOT MET (third-party)** — no 头条文章 editor is reachable for the throwaway account: `card.weibo.com/article/v3/editor` (and `#/draft`) redirect to `weibo.com/`, `/ttarticle/p/write` 404s, `/article/write` reports the account ineligible, and the creator centre has no 文章/写文章 entry. No draft control exists to measure, so the article leg stops per the task's closed contingency and the feature R4 body carries the entitlement condition. |
| R3 | **NOT MET (third-party)** — two explicitly approved live post attempts (separate approvals) both fail closed: the composer holds the text, the send control is enabled/visible/topmost (measured), but no card appears on the home feed or the account timeline (verified read-only by body-text search) and no toast — success or failure — is emitted. Nothing was published, so R5's live post and article evidence is **not** obtained. |
| R4 | **PARTIAL** — the post selectors/signals are pinned from live measurement, the two measured flow consequences are fixed, the discovery note is written, and the 04 row drops the blanket "live selectors pending" wording. The article selectors remain unmeasured because no editor rendered. |

#### Rationale

- **Measurement first, then pins.** The two seed ladders that the live DOM falsified were the status-link shape (`/status/` and `/detail/` measured **0** matches on the desktop feed) and the card-text source (the matched link's own text is the timestamp). Both were fixed from the measurement rather than patched around.
- **Fail-closed held.** The unobserved post outcome was reported as `ok: false` both times and independently verified as *not published*, so the run never claimed a success it did not see (E91-D6) and produced no unintended public write.
- **No repair-lane thrash for a third-party blocker.** The unmet requirements are an account entitlement and a site-side refusal of the send — no code change can repair them, so the run records the PARTIAL verdict and stops rather than spending the bounded fix budget on identical retries.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

#### Review Report — 0246

**Scope:** task 0246's working diff inside the batch's uncommitted tree (37 files, +3709 / −102; this task's own edits are `plugins/publishings/weibo-pub/src/index.ts`, its test file, `docs/design/weibo-ui-discovery.md`, `docs/04_DESIGN.md`, and the E94 feature R4 body via `spur feature update`)
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

_PASS applies to the change under review (no P1–P3 findings; the implementation, its tests and its documentation are sound). The requirement-level outcome is unmet for R2/R3 for third-party reasons, which the verify stage records as PARTIAL — no code repair can address an account entitlement or a site-side refusal of the send._

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The post-live acceptance compares a 30-character normalized excerpt against the card container's text. A real card may truncate the body (an ellipsis or a 全文 link), which would read as a refusal. The two live attempts never reached the card stage, so this remains **unverified against a published card** — it is the most likely next failure mode for the post leg. | `plugins/publishings/weibo-pub/src/index.ts` (`cardTextScript`, `probePostLive`) | OPEN (unverified: no published card observed) |
| 2 | P4 (advisory) | correctness | `reloadedForPost` is per-instance and never reset, so a second publish on the same transport instance would not refresh the feed. Production resolves a fresh transport per `processPublishIO` call, so this is a direct-caller edge only. | `plugins/publishings/weibo-pub/src/index.ts` (transport field) | ACCEPTED |
| 3 | P4 (advisory) | correctness | The 头条文章 selectors and `WEIBO_ARTICLE_URL` remain **unmeasured** because no editor rendered for the throwaway account (entitlement). They stay fail-closed ladders; the feature R4 body now carries the entitlement condition and the discovery note records the four measured route landings. | `plugins/publishings/weibo-pub/src/index.ts:60-80`, `docs/design/weibo-ui-discovery.md` §5 | DEFER (needs an account with the 头条文章 entitlement) |
| 4 | P4 (advisory) | correctness | Two separately approved live posts were **declined by Weibo**: the composer held the text, the send control measured enabled/visible/topmost, no card appeared on the home feed or the account timeline (verified read-only by body-text search) and no toast was emitted. The fail-closed path behaved correctly (nothing published, `ok: false` both times) but R5's live post evidence is not obtained on this account. | `.spur/run/0246-weibo-*/post*-result.json`, `docs/design/weibo-ui-discovery.md` §4 | OPEN (platform/account behaviour; needs a different account or a later retry) |
| 5 | P4 (advisory) | efficiency | The first `task-diffstat` run for this task was **fail-closed** (`files: 0`, `sensitive: true`) because the task's base SHA had not been captured at precheck; the lane still resolved to `safety`, i.e. the strictest lane, and the diffstat was re-measured after recording the base SHA. No decision was taken from the empty artifact. | `.spur/run/0246-diffstat.json`, `.spur/run/0246-base.sha` | ACCEPTED |

No P1–P3 findings. Security-relevant negatives, measured: the forced-headless preflight verifies and is never bypassed (no headed fallback on the publish path, `checkHeadedOnly` stays `false`), no page HTML/cookie/token/screenshot is committed (only bounded node descriptors), and both live writes were individually approved and independently verified as not published.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | operator `bun plugins/publishings/weibo-pub/src/profile-check.ts login` → exit 0 (`verified`); `check --timeout 60000` → exit 0 headless; forced-headless `checkChannelSession(WEIBO_CONFIG, { headedFallback: false })` → `verified`. Recorded in `docs/design/weibo-ui-discovery.md` §1. `checkHeadedOnly` stays `false`. |
| R2 | UNMET | No 头条文章 editor is reachable for the account: four measured routes (editor → `weibo.com/`, `#/draft` → `weibo.com/`, `/ttarticle/p/write` → 404, `/article/write` → ineligible) and no 文章 entry in the creator centre (`docs/design/weibo-ui-discovery.md` §5). The task's closed contingency applies: the leg stops, and the feature R4 body was re-scoped through `spur feature update E94` (scenario identity unchanged, `spur feature check E94` passes). |
| R3 | UNMET | Two separately approved live post runs returned `ok: false` (`no outcome observed within 30000ms`) and a read-only re-check found the text absent from both `weibo.com/` and `weibo.com/u/<uid>`, i.e. nothing published; the article-public leg is blocked by the same entitlement. R5's live evidence is therefore **not** obtained. |
| R4 | PARTIAL | Pinned from measurement: `WEIBO_POST_SELECTORS` (composer/send/feedCard) with the measured node descriptors, `send` fallbacks constrained to their own 发送 text, the card-container text source, the single bounded reload and the fresh-toast naming; `docs/design/weibo-ui-discovery.md` written; `docs/04_DESIGN.md:43` no longer claims live verification is merely pending. Unmeasured remainder: the article selectors and the card-excerpt comparison. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — weibo-pub saves a post or article draft by default from an observed signal (req: R2) | UNMET | manual-review | No draft control exists for the account (`docs/design/weibo-ui-discovery.md` §5); the offline suite covers the draft rail (`plugins/publishings/weibo-pub/tests/weibo-pub.test.ts`) but a live draft was never observed |
| AC2 — weibo-pub publishes live only when publishStatus is public (req: R3) | UNMET | manual-review | Two approved live post runs were declined by the site without publishing (`docs/design/weibo-ui-discovery.md` §4); the refusal path itself is green offline and in both live runs |
| R4 — weibo-pub saves a post or article draft by default from an observed signal | PARTIAL | test | selector/signal pins are exercised by `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` (38 pass); the live draft leg is entitlement-blocked |
| R5 — weibo-pub publishes live only when publishStatus is public | UNMET | manual-review | no published post or article was observed; both attempts fail closed with nothing written |

##### Consequence for the task and the batch

This task's own contract is explicit: *"Missing draft control, failed headless preflight or unavailable approval stops that leg and retains partial evidence"* and *"do not mark the task done or the satellite shipped"*. With R2 and R3 unmet, 0246 **stops** here: the run is closed `interrupted` (evidence retained, resumable) rather than advanced into the bounded repair lane — the unmet requirements are an account entitlement and a site-side refusal of the send, neither of which any code fix can repair.

**Operator actions required to finish this task later:** (1) an account **with** the 头条文章 entitlement for the draft/article legs, and (2) a determination of why this fresh account's sends are declined (or a different account for the post leg). The pinned post selectors, both live Result JSONs and the discovery note are the retained evidence.

### References

- Feature E94; design `docs/design/weibo-threads-publish-channels.md` §3/§6; precedent `docs/design/x-article-ui-discovery.md`; depends on 0244

### History

- 2026-10-12T15:01:44.562Z todo → wip (system)

