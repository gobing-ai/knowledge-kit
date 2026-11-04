---
schema_version: 1
name: Add publish plugins for LinkedIn, Facebook, Instagram, shipinhao 图文 and threads images
status: wip
template: feature-impl
created_at: 2026-10-22T18:41:33.871Z
updated_at: "2026-11-04T09:09:44.055Z"

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

#### Review Report — 0328

**Scope:** `git diff 294be71..HEAD` (commits 3ab4e60 implementation + a41335b remediation; branch `sp/run-0328-bb40`) — new plugin `plugins/publishings/linkedin-pub/` (LinkedIn-only re-scope; the other four platforms are out-of-scope split proposals), `SOCIAL_LIMITS.linkedin` in `plugins/kk/scripts/daily-stages.ts`, social-write prompt in `plugins/kk/workflows/kk-daily-ai-voice3.yaml`, `daily-ai-voice.json` preset row, and expectation updates in `packages/kk-core/tests/registry.test.ts` + `apps/cli/tests/commands/plugin-check.test.ts`.

**Dimensions:** functional, security, efficiency, correctness, usability, architecture

**Verdict:** PASS

Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | Stale count word in the changed prompt block: `kk-daily-ai-voice3.yaml:775` still says "Write three short zh posts, one per file:" while the diff added a fourth bullet (`26-social/linkedin.md` at line 779; the description at line 762 was updated to four platforms, the input count was not). The enumerated file list stays operative and a missing file skips the variant gracefully with a log line, so the worst case is one skipped LinkedIn variant for a run, never a failure | `plugins/kk/workflows/kk-daily-ai-voice3.yaml:775` | DEFER(one-word count fix on the next workflow touch; the missing-file skip bounds the blast radius) |
| 2 | P3 (minor) | functional | The remediation's expectation sweep missed a third sibling inventory: `CHECK_DECLARING_PLUGINS` enumerates the plugins whose manifest declares a TypeScript readiness check (per-task credits in its comment, 0249→0297) but omits the new check-declaring `linkedin-pub`, so the bundler's rewrite of its `check` to an existing `./dist/*.js` artifact is never asserted. The suite stays green (24 pass — the list is an input, not an exact-equality assertion), so this is a latent coverage gap of the same class a41335b fixed, not a red test | `scripts/bundle-plugins.test.ts:35` | DEFER(add `linkedin-pub` to the list on the next test touch; the bundling path is generic and exercised by the 14 listed peers) |
| 3 | P4 (advisory) | architecture | Mid-flow crash paths outside the wrapped stages — the share-box `click`, the composer `fill`, and the send-stage `resolveSelector` (`src/index.ts:402`) — surface through the generic catch as `ok:false` without typed `stage` metadata; the message still names the selector label and stays bounded, and the shape is identical to the jike-pub scaffold peer (`plugins/publishings/jike-pub/src/index.ts:420`) | `plugins/publishings/linkedin-pub/src/index.ts:402` | ACCEPTED |
| 4 | P4 (advisory) | functional | No committed regression test asserts the linkedin 3000 backstop: the 0327 bundle-variant tests cover x only (`apps/cli/tests/kk-workflow-stages.test.ts:2281-2312`), so the new `SOCIAL_LIMITS` entry rides on the generic truncation logic. Review reproduced the backstop live: a 3005-character zh `linkedin.md` produced `30-variants/social_linkedin.content.json` truncated to 3000 with `truncatedFrom: 3005, truncatedUnit: code_units` | `plugins/kk/scripts/daily-stages.ts:1887` | ACCEPTED |
| 5 | P4 (advisory) | functional | `bun.lock` carries an unrelated `@gobing-ai/knowledge-kit` version bump 0.1.4 → 0.1.11 alongside the new workspace link — a lockfile resync from `bun install`, not a dependency change: every new dependency is `workspace:*` or `catalog:` (`plugins/publishings/linkedin-pub/package.json:7-14`), satisfying the no-new-dependency constraint | `bun.lock:28` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | plugin manifest `plugins/publishings/linkedin-pub/plugin.json:3-5` (`kind: publish`, `entry`, ADR-009 collection `plugins/publishings/linkedin-pub/`); operation selection `options.operation ?? content.metadata.operation` with declared `post` only at `plugins/publishings/linkedin-pub/src/index.ts:150-165`; draft/absent `publishStatus` refusal before any browser at `src/index.ts:269-274` ("LinkedIn drafts are not addressable"); over-length refusal, never truncation, at `src/index.ts:283-286` with the 3000 cap at `src/index.ts:61`; image violations (not array / blank / wrong ext / missing / cap 1) at `src/index.ts:204-238`; provisional selector table with typed stage failures (`share-trigger`, `composer`, `text-readback`, `image-upload`, `send-enabled`, `confirmation`, `failure-toast`) at `src/index.ts:79` and `src/index.ts:344` (`runPostFlow`); refusal+flow tests `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts:291-474` — 36 pass / 0 fail, `src/index.ts` at 100% line and function coverage |
| R2 | MET | probe declared `check: ./src/profile-check.ts` (`plugin.json:5`); shared `runProfileCli` gate at `plugins/publishings/linkedin-pub/src/profile-check.ts:16` with the shared readiness predicate `src/index.ts:182-190`; fresh `kk plugin check linkedin-pub` → "refused — no linkedin browser profile at ~/.config/kk/browser-profiles/linkedin — run the login command first", exit 1, zero browser launches, no posting; logged-out/missing-profile/expired-session paths tested at `tests/linkedin-pub.test.ts:423-474` |
| R3 | MET | `SOCIAL_LIMITS.linkedin { max: 3000 }` at `plugins/kk/scripts/daily-stages.ts:1887` (character count, matching the weibo/threads unit); four-platform description and the `26-social/linkedin.md — at most 3000 characters` bullet at `plugins/kk/workflows/kk-daily-ai-voice3.yaml:762` and `:779`; fresh reproduction: `kk stage run daily-bundle-variants` on a 3005-char zh fixture → variant truncated to 3000 (`truncatedFrom: 3005, truncatedUnit: code_units`) |
| R4 | MET | unit tests on payload validation and operation selection with the fake transport: `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts` (36 pass / 0 fail, offline fake pages only, `FakeBrowserTransport` from `@gobing-ai/publish-harness`); dummy-mode send through publish3 reproduced fresh by this review: `publish-matrix-plan` → row `linkedin-pub.post` `mode: dummy` tier 3 planned, `publish-matrix-send` → receipt `dummy://linkedin-pub.post` with `dummy: true, effect: none` (plugin never invoked); preset row `{plugin: linkedin-pub, operation: post, variant: social:linkedin, tier: 3, window: overseas-rss, mode: dummy}` at `plugins/kk/publish-presets/daily-ai-voice.json:106-113` |

##### Architecture Notes

- ADR-009 conformance: manifest shape (name/kind/entry/check/version/description/browserSession) is field-identical to the jike-pub peer; discovery verified by `packages/kk-core/tests/registry.test.ts` (32 pass, `linkedin-pub` present in both multi-root union lists).
- Documented scaffold deviation is sound: the plan named threads-pub, but threads-pub is API-only with no browser path and no `check`/`browserSession` (`plugins/publishings/threads-pub/plugin.json`), so jike-pub — browser + text + image + live-only + probe — is the correct nearest shape; the deviation is recorded in the task Solution.
- Publish-harness reuse is deep, not cosmetic: `FakeBrowserTransport`, `trySelectors`, `checkChannelSession`, `expectOutcome`, `kkBrowserLauncher`, `resolveChannelProfileDir`, `resolveSelector`, `uploadFile`, and the shared profile-precedence `runProfileCli` — the plugin adds only LinkedIn-owned predicates and selectors.
- No copy shaping beyond limits: the plugin trims, counts code points, refuses over-length (`src/index.ts:285`), and never rewrites body text; `normalizeText` is comparison-only.
- SECUA: no credentials in any changed file (diff scanned); every browser-stage failure is bounded to one 300-char line with the recovery command leading (`boundedDetail`, `stageFail`), no DOM dump, cookie, token or stack in any Result; preflight never escalates to a headed window; dummy rows are excluded from preflight probes by the generic machinery (`apps/cli/src/publish-matrix.ts:511,524`), verified live (`publish-matrix-check --all-windows` recorded 7 probes, none for linkedin).
- Lint gate: `bun run lint` clean (Biome 2.5.15 + typecheck across workspaces including the new plugin).

##### Residual Risk

- Every LinkedIn selector, toast regex, post-link shape and the login-redirect regex are **provisional** — never measured against a live logged-in session. The operator live gate (plan step 5: `kk bot login linkedin-pub`, then one manual post with `live_channels=linkedin-pub`) must re-measure them before any `dummy → live` flip; until then a drifted selector fails loud (typed stage refusal) rather than posting wrong content, but live sends may refuse outright.
- `IMAGE_EXTS` is a peer-parity set, not a measured LinkedIn limit (`src/index.ts:65-67`); the live gate must confirm.
- Unit nuance: the stage backstop measures linkedin in code units while the plugin caps in code points — truncation only ever shortens, so the plugin cap cannot fire on stage-produced content; benign direction, shared with the weibo/threads entries.
- The two DEFER-ed P3 rows ride to wrap residuals.

##### Disposition

Approve (PASS). No blocker or major findings; both P3s are dispositioned DEFER with bounded impact and ride to wrap; the P4s are accepted observations. No remediation hop is required — proceed to the approval decision point. Fresh evidence pasted in this report was re-run by the reviewer on this worktree (plugin suite 36 pass, registry 32 pass, plugin-check 12 pass, bundle-plugins 24 pass, kk-workflow-stages 151 + 58 pass, `bun run lint` clean, live `kk plugin check` + full matrix chain to a dummy receipt).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T19:09:53.125Z backlog → todo (system)
- 2026-11-04T07:45:04.360Z todo → wip (system)

