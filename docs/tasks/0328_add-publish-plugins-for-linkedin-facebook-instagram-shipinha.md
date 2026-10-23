---
schema_version: 1
name: Add publish plugins for LinkedIn, Facebook, Instagram, shipinhao 图文 and threads images
status: todo
template: feature-impl
created_at: 2026-10-22T18:41:33.871Z
updated_at: "2026-10-22T19:09:53.125Z"

feature_id: E9
ac_altitude: task-local
dependencies: ["0323", "0327"]
priority: P3
estimate_hours: 8
---

## 0328. Add publish plugins for LinkedIn, Facebook, Instagram, shipinhao 图文 and threads images

### Background

The voice3 preset lists LinkedIn, Facebook, Instagram, 视频号图文 and Threads-with-images as `mode: off`, because no plugin or capability exists today (design §7, follow-up T-f). This work lives outside feature G15 (filed under E9, the publish-channel home).

**Refine corrections (2026-10-22)**

- The task is re-scoped. Five platforms in one task is not implementable as one unit: each is a separate browser-automation plugin with its own login, readiness probe (ADR-032) and DOM risk. This task now ships **LinkedIn only**, the first overseas text channel that pairs with the `overseas-rss` window. The other four go to the batch report as split proposals.
- `shipinhao-pub` is short-video only (design §7). Threads images need a public image host that does not exist. Both are blocked on a decision, not on code.

### Requirements

- [ ] R1. `plugins/publishings/linkedin-pub/` (`plugin.json` `kind: publish`, ADR-009) follows the existing browser publisher shape (`threads-pub`, `x-pub`). It has operation `post` (text plus one image), selected through `options.operation ?? content.metadata.operation`. There is no draft mode: `metadata.publishStatus: 'draft'` is refused with a clear error, because LinkedIn's drafts are not addressable.
- [ ] R2. A readiness probe (`check`) that reports login state without posting, consumed by `kk plugin check linkedin-pub`.
- [ ] R3. The `daily-ai-voice` preset row `{plugin: linkedin-pub, operation: post, variant: social:linkedin, tier: 3, window: overseas-rss, mode: dummy}`, with a `social:linkedin` variant added to the 0327 `social-write` output (zh, ≤ 3000 chars).
- [ ] R4. Tests:
  - unit tests on payload validation and operation selection with a fake transport (`@gobing-ai/publish-harness`);
  - a dummy-mode send through publish3.
- Out of scope:
  - Facebook, Instagram, 视频号图文 and Threads images (split proposals in the batch report);
  - live LinkedIn posting in CI.

### Acceptance Criteria

- [ ] AC1 — linkedin-pub passes kk plugin check and a dummy send in the daily-ai-voice preset (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:09:05.873Z

- **Q: Ship all five channels here?** Closed: no. LinkedIn only; Facebook, Instagram, 视频号图文 and Threads images are proposed as separate tasks (batch report).
- Deferred: the public image host for Threads images and the 视频号图文 capability check, which need an operator decision.

### Design

- Copy the `threads-pub` structure (closest: browser, text+image, no draft).
- Reuse `@gobing-ai/publish-harness` transports and the shared browser profile layout under `~/.config/kk/browser-profiles/` (ADR-042).
- Login stays `kk bot login linkedin-pub`, an operator action.
- Anti-patterns:
  - no copy shaping in the plugin, beyond platform limits only;
  - no credentials in files;
  - no new dependency.
- Gate before live: an operator runs one live post manually; the preset row moves `dummy → (live via live_channels)` only after that.

### Plan

1. Failure list: a draft requested, logged out, over-length text, image missing, and the selector drifting (probe must fail loud). (R1, R2)
2. Scaffold `linkedin-pub` from threads-pub. Implement the `post` operation and the probe. (R1, R2)
3. Add the preset row and the `social:linkedin` variant. (R3)
4. Run tests with a fake transport plus a publish3 dummy run. (R4)
5. Run `bun run gate`. Before any live flip, the operator does a manual live check (`kk bot login linkedin-pub`, then one launch with `live_channels=linkedin-pub`).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T19:09:53.125Z backlog → todo (system)

