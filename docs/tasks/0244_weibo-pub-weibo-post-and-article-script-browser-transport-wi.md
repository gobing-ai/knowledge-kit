---
schema_version: 1
name: weibo-pub — Weibo post and 头条文章 article script browser transport with profile-check
status: todo
template: feature-impl
created_at: 2026-10-09T23:19:30.101Z
updated_at: "2026-10-09T23:48:32.073Z"
feature_id: E94
priority: P2
tags:
  - publish
  - weibo
  - browser
  - E94
estimate_hours: 8

---

## 0244. weibo-pub — Weibo post and 头条文章 article script browser transport with profile-check

### Background

New `kind: publish` plugin `plugins/publishings/weibo-pub`, modelled on x-pub's `XArticleBrowserTransport` (`plugins/publishings/x-pub/src/index.ts:260`) over `@gobing-ai/publish-harness/browser`. Design: `docs/design/weibo-threads-publish-channels.md` §3. Rails: E91-D5 draft by default, E91-D6 success only from an observed signal, ADR-032 `check` script.

Implements: R4 — weibo-pub saves a post or article draft by default from an observed signal; R5 — weibo-pub publishes live only when publishStatus is public; R6 — weibo-pub refuses an unauthenticated session before any headed browser opens; R7 — weibo-pub ships a profile-check login and check entry; R8 (weibo half); R9 (weibo half).

**Refine corrections (2026-10-09)**
- "Driver accepts `script` only" read as a Content option → no publish plugin reads `options.driver`; the driver is a constructor / `getPublishTransport` seam (`plugins/publishings/xhs-pub/src/index.ts:312`, `plugins/publishings/x-pub/src/index.ts:265`) → weibo-pub follows that seam and refuses a non-`script` driver inside `publish()` before any browser.
- `WEIBO_PROFILE_DIR` needs wiring → `resolveChannelProfileDir('weibo', override)` already derives `<CHANNEL>_PROFILE_DIR` (`packages/publish-harness/src/browser.ts:168`) → no new env code.
- 头条文章 editor URL `https://card.weibo.com/article/v3/editor` and the 保存草稿 label → no first-party source found (web search 2026-10-09) → both are provisional constants; 0246 pins them. If 0246 finds no article draft control, the article half of R4 is re-scoped there through `spur feature update`.
- Fake transport unnamed → `FakeBrowserTransport('script')` as x-pub (`plugins/publishings/x-pub/src/index.ts:453`).
- 04_DESIGN surface ownership → T3 → this task adds the `@gobing-ai/weibo-pub` section, `WEIBO_PROFILE_DIR` in the profile-env row (`docs/04_DESIGN.md:802`) and verdict rows beside `docs/04_DESIGN.md:921`.
- `cover` handling → x-pub's `resolveCover` is module-private (`plugins/publishings/x-pub/src/index.ts:236`) → copied into weibo-pub (peer pattern), not extracted.
- Concurrency: no `wip` tasks; worktree `knowledge-kit-runall-0237-0238-53a2` touches only `plugins/kk/scripts/daily-stages.ts` + `plugins/kk/workflows/kk-daily-ai-voice2.yaml` → no overlap.

### Requirements

- [ ] R1. Scaffold `plugins/publishings/weibo-pub` (`plugin.json` with `"check": "./src/profile-check.ts"`, `package.json` `@gobing-ai/weibo-pub` with x-pub's dependency set, `tsconfig.json`, `src/index.ts`, `src/profile-check.ts`, `tests/weibo-pub.test.ts`).
- [ ] R2. `article`: opens `WEIBO_ARTICLE_URL`, fills title (`content.title ?? 'Untitled'`), pastes `markdownToHtml(content.body)` via `pasteHtml`, optional cover via `uploadFile` (`options.coverPath ?? metadata.coverImage`, absolute existing `.png|.jpg|.jpeg|.webp`, refused pre-browser otherwise), then clicks `saveDraft` (default) or `publish` (`publishStatus: 'public'`).
- [ ] R3. `post`: only with `metadata.publishStatus === 'public'` — opens `WEIBO_HOME_URL`, fills the composer with `content.body.trim() || content.title`, clicks `send`. Without `public` it returns `ok: false` ("weibo post has no draft; set publishStatus: public") before any browser opens. A cover on `post` is refused (text-only).
- [ ] R4. Success only from an `expectOutcome` signal (article draft: saved toast or draft-URL change; article live: published article URL; post: new feed card link carrying the status id); no signal within the step deadline → `ok: false` naming the step and deadline.
- [ ] R5. A `publishStatus` other than absent/`draft`/`public` → `ok: false` pre-browser.
- [ ] R6. Headless `checkChannelSession(WEIBO_CONFIG, {headedFallback: false})` preflight; not verified → `ok: false` naming `bun plugins/publishings/weibo-pub/src/profile-check.ts login`; no headed window opens.
- [ ] R7. `profile-check.ts` = `runProfileCli(WEIBO_CONFIG, argv)`: `login|check`, precedence `--profile` > `WEIBO_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > default, exit 0/1/2.
- [ ] R8. `resolveOperation` accepts `post|article`; unknown → `ok: false` naming the value and set, pre-transport. A driver other than `script` → `ok: false` `unsupported driver '<d>' for weibo` pre-browser.
- [ ] R9. `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` → `FakeBrowserTransport('script')`.
- [ ] R10. `docs/04_DESIGN.md` weibo-pub section, profile-env row and verdict rows in the same commit.

**Out of scope:** Weibo share API, post images, live selector pinning (0246), channel enumerations (0245).

### Acceptance Criteria

- [ ] AC1 — weibo-pub saves a post or article draft by default from an observed signal (req: R2) (req: R3) (req: R4)
- [ ] AC2 — weibo-pub publishes live only when publishStatus is public (req: R3) (req: R5)
- [ ] AC3 — weibo-pub refuses an unauthenticated session before any headed browser opens (req: R6)
- [ ] AC4 — weibo-pub ships a profile-check login and check entry (req: R7)

Test layer: `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` with a copied `makeFakeLauncher` (pattern at `plugins/publishings/x-pub/tests/x-pub.test.ts:166`) — the fake launcher records `goto`/click/paste calls and headless flags, so pre-browser refusals and draft-vs-live clicks are observable. Live DOM truth is 0246.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T23:48:31.020Z

- **Post draft** — closed: Weibo's web composer has no draft, so `post` requires `publishStatus: 'public'` (refusing beats silently going live).
- **Driver surface** — closed: constructor/`getPublishTransport` seam, matching x-pub/xhs-pub.
- **Article editor URL + 保存草稿** — deferred to 0246 (owner): provisional constants until measured live.
- **Post text cap** — closed: not enforced client-side.

### Design

- **Approach:** copy the x-article skeleton — `WEIBO_CONFIG: ChannelBrowserConfig`, selector ladders resolved with `resolveSelector`, `withProfilePage` session, `expectOutcome` signals, one transport class branching on operation. Reason: the harness already owns every browser primitive; the plugin is selectors + flow.
- **Where:** `plugins/publishings/weibo-pub/{plugin.json,package.json,tsconfig.json,src/index.ts,src/profile-check.ts,tests/weibo-pub.test.ts}`; `docs/04_DESIGN.md`.
- **Frozen names:** `TARGET = 'weibo'` (also the profile channel); `WEIBO_HOME_URL = 'https://weibo.com'`; `WEIBO_ARTICLE_URL = 'https://card.weibo.com/article/v3/editor'` (provisional); `LOGIN_URL_RE` (passport.weibo.com / `/login`); `export const WEIBO_OPERATIONS = ['post', 'article'] as const`; `export const WEIBO_POST_SELECTORS = {composer, send, feedCard}`; `export const WEIBO_ARTICLE_SELECTORS = {title, body, fileInput, saveDraft, publish}`; `export const isWeiboAuthenticated: IsAuthenticatedPredicate`; `export const WEIBO_CONFIG`; `export class WeiboBrowserTransport implements PublishTransport` (`kind = 'browser'`, ctor `(operation, driver = 'script', deps = {launcher?, stepTimeoutMs?})`); `export function getPublishTransport(operation = 'post', driver = 'script')`; `processPublishIO`, `main` as x-pub.
- **Order of refusals (all pre-browser):** driver → operation → publishStatus value → post-without-public → cover validity → session preflight. Then the headed flow.
- **Anti-patterns:** never click `publish`/`send` without `publishStatus: 'public'`; never return ok from a timeout or a click alone; no headed window on a refused preflight; no new harness helper; no `agent` driver path; no post text cap (Weibo's composer enforces its own; an over-limit run shows up as no signal).
- **checkHeadedOnly:** `false` by default; 0246 measures whether Weibo login-walls headless and flips it if so.
- **Handoff:** 0246 pins `WEIBO_ARTICLE_URL` and every selector against the live DOM; 0245 enumerates `weibo-pub` and relies on `plugin.json.check`.

### Plan

- [ ] 0. Scaffold, then `bun install` so `bun.lock` records `@gobing-ai/weibo-pub`.
- [ ] 1. Failure-list tests first: unknown op, `agent` driver, bad publishStatus, post without public, cover on post, bad cover path, unauthenticated preflight (no headed request), missing signal → R3/R5/R6/R8.
- [ ] 2. Flow tests: article draft clicks `saveDraft` never `publish`; article public clicks `publish`; post public clicks `send`; ok only with the signal → R2/R4.
- [ ] 3. Profile tests: precedence + exit codes through `runProfileCli` → R7; fake-env test → R9.
- [ ] 4. Implement `src/index.ts`, `src/profile-check.ts` → R1–R9.
- [ ] 5. `docs/04_DESIGN.md` entries → R10.
- [ ] 6. `bun run lint` and `bun run test` green.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature E94; design `docs/design/weibo-threads-publish-channels.md` §3; ADR-027, ADR-032; E91-D5/D6
- Template: `plugins/publishings/x-pub/src/index.ts:164-440`, `plugins/publishings/x-pub/src/profile-check.ts`
- Weibo share API rejection evidence: https://v2ex.com/t/379387

### History
