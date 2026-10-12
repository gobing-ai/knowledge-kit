---
schema_version: 1
name: weibo-pub live operator dogfood — pin composer and article editor selectors
status: todo
template: feature-impl
created_at: 2026-10-09T23:19:30.104Z
updated_at: "2026-10-12T04:28:58.442Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature E94; design `docs/design/weibo-threads-publish-channels.md` §3/§6; precedent `docs/design/x-article-ui-discovery.md`; depends on 0244

### History
