---
schema_version: 1
name: Add publish plugins for LinkedIn, Facebook, Instagram, shipinhao 图文 and threads images
status: wip
template: feature-impl
created_at: 2026-10-22T18:41:33.871Z
updated_at: "2026-11-04T07:45:04.360Z"

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

Implemented LinkedIn publishing (0328, LinkedIn-only scope). New plugin `plugins/publishings/linkedin-pub/`, scaffolded from **jike-pub** — browser + text + image + live-only shape (the plan's threads-pub note was unusable: threads-pub is API-only, no browser/image; deviation documented in the run report).

- **R1 failure list first, post operation**: `plugins/publishings/linkedin-pub/src/index.ts:262` refuses pre-browser, in order — unknown `operation` (`options.operation ?? content.metadata.operation`, declared `post` only), non-script driver, absent or `draft` `publishStatus` (`plugins/publishings/linkedin-pub/src/index.ts:272` — "LinkedIn drafts are not addressable — set publishStatus: public"), unknown publishStatus, empty body, over-length body (>3000 code points, `plugins/publishings/linkedin-pub/src/index.ts:61` — refused, never truncated), image violations (not array / blank entry / wrong ext / missing file / >1 image). Browser stages fail loud with typed Result metadata `stage`: `share-trigger`, `composer`, `text-readback`, `image-upload`, `send-enabled`, `confirmation`, `failure-toast` (`plugins/publishings/linkedin-pub/src/index.ts:79` selector table) — a drifted selector can never silently skip or post text-only. Text + one image (cap 1); success only from an observed signal (fresh post link whose card read back the body excerpt, or a fresh success toast); editor-cleared/modal-closed alone never reports `ok: true`.
- **R2 readiness probe**: `plugins/publishings/linkedin-pub/plugin.json` declares `check: ./src/profile-check.ts` (shared `runProfileCli`: login|check|open, exit 0/1/2, `plugins/publishings/linkedin-pub/src/profile-check.ts:16`) + `browserSession { profileName: linkedin, homeUrl: https://www.linkedin.com/feed/ }`. Verified: `kk plugin check linkedin-pub` → refused "no linkedin browser profile at ~/.config/kk/browser-profiles/linkedin — run the login command first", exit 1, zero browser launches, no posting.
- **R3 social variant**: `plugins/kk/scripts/daily-stages.ts:1887` (`SOCIAL_LIMITS.linkedin { max: 3000 }`, code points, not weighted); `plugins/kk/workflows/kk-daily-ai-voice3.yaml:779` authoring prompt + :762 description now four platforms (x, weibo, threads, linkedin). Fixture-verified: 3005-char `26-social/linkedin.md` → `30-variants/social_linkedin.content.json` truncated to 3000 with `truncatedFrom: 3005, truncatedUnit: code_units`.
- **R4 preset row**: `{ plugin: linkedin-pub, operation: post, variant: social:linkedin, tier: 3, window: overseas-rss, mode: dummy }` at `plugins/kk/publish-presets/daily-ai-voice.json:106`. Fixture-verified end-to-end via `kk stage run` (bundle-variants → publish-matrix-bundle → publish-matrix-plan → publish-matrix-send on `.works/tmp/test-linkedin-matrix/20260328`): plan emits `linkedin-pub.post` planned; send writes the synthetic receipt `dummy://linkedin-pub.post` with `dummy: true, effect: none` — the plugin is never invoked; `publish-matrix-check --all-windows` correctly excludes dummy rows from preflight probes.
- No new dependency; no credentials in any file. Selectors are **provisional** (never measured against a live logged-in session) — the operator live gate (login + one manual post) must re-measure them before any live flip.
- Tests: `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts` (36 pass) — offline fake pages only, layered mapping/refusals/preflight/flow per the jike-pub precedent.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T19:09:53.125Z backlog → todo (system)
- 2026-11-04T07:45:04.360Z todo → wip (system)

