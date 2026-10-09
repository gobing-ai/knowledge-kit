---
schema_version: 1
name: weibo-pub live operator dogfood — pin composer and article editor selectors
status: todo
template: feature-impl
created_at: 2026-10-09T23:19:30.104Z
updated_at: "2026-10-09T23:48:38.532Z"
feature_id: E94
priority: P3
tags:
  - publish
  - weibo
  - dogfood
  - E94
estimate_hours: 2

dependencies: ["0244"]
---

## 0246. weibo-pub live operator dogfood — pin composer and article editor selectors

### Background

Offline tests cannot prove Weibo selectors. An operator-attended live run pins `WEIBO_POST_SELECTORS` / `WEIBO_ARTICLE_SELECTORS` / `WEIBO_ARTICLE_URL` and records the discovery note, same as `docs/design/x-article-ui-discovery.md` (task 0204/0194). Design: `docs/design/weibo-threads-publish-channels.md` §3, §6.

Implements (live evidence): R4 — weibo-pub saves a post or article draft by default from an observed signal; R5 — weibo-pub publishes live only when publishStatus is public.

**Refine corrections (2026-10-09)**
- Article editor URL and 保存草稿 label were treated as known → no first-party source (web search 2026-10-09) → this task owns measuring them, and owns re-scoping R4's article half through `spur feature update E94` if no draft control exists.
- `checkHeadedOnly` default unmeasured → x-pub needed `true` (`plugins/publishings/x-pub/src/index.ts:212`) → this task measures Weibo's headless behaviour and sets it.
- Concurrency: no `wip` tasks; worktree `knowledge-kit-runall-0237-0238-53a2` touches only `plugins/kk/scripts/daily-stages.ts` + `plugins/kk/workflows/kk-daily-ai-voice2.yaml` → no overlap.

### Requirements

- [ ] R1. Operator runs `bun plugins/publishings/weibo-pub/src/profile-check.ts login` then `check` (exit 0) on a disposable Weibo account; record whether headless `check` passes and set `WEIBO_CONFIG.checkHeadedOnly` accordingly.
- [ ] R2. Live `article` run (no publishStatus) saves a 头条文章 draft and returns `ok: true` from the observed signal; the draft is visible in Weibo's draft list. If no draft control exists, stop and re-scope via `spur feature update E94` instead.
- [ ] R3. Live `post` run with `publishStatus: 'public'` returns `ok: true` with the status URL; the operator deletes the post afterwards.
- [ ] R4. `WEIBO_ARTICLE_URL`, `WEIBO_POST_SELECTORS`, `WEIBO_ARTICLE_SELECTORS` and signals updated to the observed DOM; `docs/design/weibo-ui-discovery.md` records each selector hit, signal and the measurement date; `docs/04_DESIGN.md` satellite row drops "live selectors pending 0246".

### Acceptance Criteria

- [ ] AC1 — weibo-pub saves a post or article draft by default from an observed signal (req: R2)
- [ ] AC2 — weibo-pub publishes live only when publishStatus is public (req: R3)

Evidence: live run Result JSON + `docs/design/weibo-ui-discovery.md`; offline suite re-run green after constant changes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T23:48:37.710Z

- **No article draft control found** — deferred contingency owned here: re-scope via feature update, never fall back to live publishing.

### Design

- **Approach:** operator-attended headed runs; capture DOM with the harness, then pin ladders (measured candidate first, seed candidates kept as fallbacks). Reason: E91-D6 needs a real observed signal.
- **Where:** `plugins/publishings/weibo-pub/src/index.ts` (constants only), `docs/design/weibo-ui-discovery.md` (new), `docs/04_DESIGN.md` row.
- **No new API:** constants and config flag only; flow logic changes only if a measured interaction demands it (record why in the note).
- **Rejected:** recorded HAR fixtures (stale under DOM churn).
- **Invariants:** no live run without `publishStatus: 'public'`; test content deleted; no credentials, cookies or page HTML committed.
- **Dependencies:** assumes 0244's transport and profile-check; leaves `bun run test` green.

### Plan

- [ ] 1. login / check (headless and headed) → R1.
- [ ] 2. Article draft run; adjust selectors/URL → R2.
- [ ] 3. Public post run; adjust selectors; delete post → R3.
- [ ] 4. Discovery note + 04 row; `bun run test` → R4.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature E94; design `docs/design/weibo-threads-publish-channels.md` §3/§6; precedent `docs/design/x-article-ui-discovery.md`; depends on 0244

### History
