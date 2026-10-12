---
schema_version: 1
name: weibo-pub — Weibo post and 头条文章 article script browser transport with profile-check
status: done
template: feature-impl
created_at: 2026-10-09T23:19:30.101Z
updated_at: "2026-10-12T06:39:11.421Z"
feature_id: E94
priority: P2
tags:
  - publish
  - weibo
  - browser
  - E94
estimate_hours: 8

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0244-verdict.json
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

**Refine corrections (2026-10-11)**
- The x-pub peer already pins `checkHeadedOnly: true`, but shared `checkChannelSession` only obeys `opts.headedOnly`; `runProfileCli` forwards the config → keep the operator setting separate from a publish preflight, which always uses `headedFallback: false` and never `headedOnly: true`.
- An existing feed card or success toast could satisfy the proposed outcome probe → snapshot old links/toast visibility before the action and accept only a fresh signal afterward.
- The proposed draft URL and controls remain unmeasured → explicitly provisional selectors, fail closed; 0246 owns live discovery and no-draft contingency.
- Historical worktree claim → Current-tree audit (2026-10-11): no WIP tasks. Other worktree `knowledge-kit-runall-g8-4173` owns G8 board/workflow work and currently edits root `package.json`, `bun.lock`, and `apps/cli/package.json`; coordinate lockfile integration before implementation, preserve its changes. The main tree has pre-existing edits in daily, store-selections, voice2-dag and wechatmp tests; preserve them.

### Requirements

- [x] R1. Scaffold `plugins/publishings/weibo-pub` (`plugin.json` with `"check": "./src/profile-check.ts"`, `package.json` `@gobing-ai/weibo-pub` with x-pub's dependency set, `tsconfig.json`, `src/index.ts`, `src/profile-check.ts`, `tests/weibo-pub.test.ts`).
- [x] R2. `article`: opens `WEIBO_ARTICLE_URL`, fills title (`content.title ?? 'Untitled'`), pastes `markdownToHtml(content.body)` via `pasteHtml`, optional cover via `uploadFile` (`options.coverPath ?? metadata.coverImage`, absolute existing `.png|.jpg|.jpeg|.webp`, refused pre-browser otherwise), then clicks `saveDraft` (default) or `publish` (`publishStatus: 'public'`).
- [x] R3. `post`: only with `metadata.publishStatus === 'public'` — opens `WEIBO_HOME_URL`, fills the composer with `content.body.trim() || content.title`, clicks `send`. Without `public` it returns `ok: false` ("weibo post has no draft; set publishStatus: public") before any browser opens. A cover on `post` is refused (text-only).
- [x] R4. Success only from an `expectOutcome` signal (article draft: saved toast or draft-URL change; article live: published article URL; post: new feed card link carrying the status id); no fresh signal within the step deadline → `ok: false` naming the step and deadline. A pre-existing feed card, editor URL or already-visible toast is never success. Article title and body must be read back before save/publish; a provided cover needs a fresh observed attachment signal.
- [x] R5. A `publishStatus` other than absent/`draft`/`public` → `ok: false` pre-browser.
- [x] R6. Headless `checkChannelSession(WEIBO_CONFIG, {headedFallback: false})` preflight; not verified → `ok: false` naming `bun plugins/publishings/weibo-pub/src/profile-check.ts login`; no headed window opens.
- [x] R7. `profile-check.ts` = `runProfileCli(WEIBO_CONFIG, argv)`: `login|check`, precedence `--profile` > `WEIBO_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > default, exit 0/1/2.
- [x] R8. `resolveOperation` accepts `post|article`; unknown → `ok: false` naming the value and set, pre-transport. Driver is resolved from `options.driver ?? 'script'`; a driver other than `script` (including a wrong type) → `ok: false` naming the value and supported set before transport resolution. Retain the constructor/getPublishTransport seam for tests and callers.
- [x] R9. `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` → `FakeBrowserTransport('script')`.
- [x] R10. `docs/04_DESIGN.md` weibo-pub section, profile-env row and verdict rows in the same commit.

**Out of scope:** Weibo share API, post images, live selector pinning (0246), channel enumerations (0245).

### Acceptance Criteria

- [x] AC1 — weibo-pub saves a post or article draft by default from an observed signal (req: R2) (req: R3) (req: R4)
- [x] AC2 — weibo-pub publishes live only when publishStatus is public (req: R3) (req: R5)
- [x] AC3 — weibo-pub refuses an unauthenticated session before any headed browser opens (req: R6)
- [x] AC4 — weibo-pub ships a profile-check login and check entry (req: R7)

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

#### Q&A entry — 2026-10-12T04:28:47.716Z

- **Driver input** — closed: `options.driver` is supported only as `script`; expose the same refusal through IO and constructor seams.
- **Operator versus publish probe** — closed: `checkHeadedOnly` can affect the operator CLI; never forward it to publish preflight.
- **Freshness** — closed: old feed cards/toasts are negative tests; live selectors remain owned by 0246.

### Design

- **Approach:** copy the x-article skeleton — `WEIBO_CONFIG: ChannelBrowserConfig`, selector ladders resolved with `resolveSelector`, `withProfilePage` session, `expectOutcome` signals, one transport class branching on operation. Reason: the harness already owns every browser primitive; the plugin is selectors + flow.
- **Where:** `plugins/publishings/weibo-pub/{plugin.json,package.json,tsconfig.json,src/index.ts,src/profile-check.ts,tests/weibo-pub.test.ts}`; `docs/04_DESIGN.md`.
- **Frozen names:** `TARGET = 'weibo'` (also the profile channel); `WEIBO_HOME_URL = 'https://weibo.com'`; `WEIBO_ARTICLE_URL = 'https://card.weibo.com/article/v3/editor'` (provisional); `LOGIN_URL_RE` (passport.weibo.com / `/login`); `export const WEIBO_OPERATIONS = ['post', 'article'] as const`; `export const WEIBO_POST_SELECTORS = {composer, send, feedCard}`; `export const WEIBO_ARTICLE_SELECTORS = {title, body, fileInput, saveDraft, publish}`; `export const isWeiboAuthenticated: IsAuthenticatedPredicate`; `export const WEIBO_CONFIG`; `export class WeiboBrowserTransport implements PublishTransport` (`kind = 'browser'`, ctor `(operation, driver = 'script', deps = {launcher?, stepTimeoutMs?})`); `export function getPublishTransport(operation = 'post', driver = 'script')`; `processPublishIO`, `main` as x-pub.
- **Order of refusals (all pre-browser):** operation → driver → publishStatus value → post-without-public → non-empty post text → cover validity → session preflight. This ordering also applies before injected/fake transport resolution; the real transport repeats relevant guards for direct callers. Then the headed flow.
- **Anti-patterns:** never click `publish`/`send` without `publishStatus: 'public'`; never return ok from a timeout or a click alone; no headed window on a refused preflight; no new harness helper; no `agent` driver path; no post text cap (Weibo's composer enforces its own; an over-limit run shows up as no signal).
- `checkHeadedOnly`: `false` by default; 0246 may change it for the operator CLI only. Publish always calls `checkChannelSession(WEIBO_CONFIG, {profileDir, launcher, headedFallback: false, timeoutMs: stepTimeoutMs})` with `headedOnly` absent/false. A headed operator check never authorizes an automatic headed preflight fallback.
- **Handoff:** 0246 pins `WEIBO_ARTICLE_URL` and every selector against the live DOM; 0245 enumerates `weibo-pub` and relies on `plugin.json.check`.

- **Frozen driver input:** `options.driver ?? 'script'`, with runtime validation before `getPublishTransport(operation, driver)`; reject `agent` and unknown values. This makes the feature's Content-carried driver refusal observable through the real CLI as well as the constructor seam. Operation uses `options.operation ?? metadata.operation ?? 'post'` exactly as x-pub.
- **IO/fake contract:** follow `processPublishIO`/`main` in x-pub (schema-valid failure output then nonzero exit). Fake mode skips profile/session and real browser, but preserves deterministic input, operation, driver, publishStatus, empty-post-text and cover refusals. Successful fake fixtures use article/no publishStatus or post/public. Never leak browser exception messages verbatim: emit only bounded site-owned step/deadline/recovery text; no DOM, cookie, token or stack in stderr/Result.
- **Bounded flow:** `stepTimeoutMs` defaults to 30_000; pass it to every selector wait, fill, click, navigation, upload and outcome probe. Default flow is headed after the single headless preflight, with `options.headless === true` opting in to a headless flow. Use `options.profileDir` as the publish override and shared profile precedence.
- **Fresh outcomes:** snapshot existing feed status hrefs and toast visibility before send/save. For posts accept only a newly appearing status link with matching submitted text and an extracted status id. For article draft accept a newly appearing saved toast after readback, or a changed draft URL carrying its id; for article live require departure from editor onto a published article URL. Capture evidence in Result (`operation`, `driver`, `publishStatus`, id/url when observed); no click-only success. Candidate DOM labels/URL shapes are provisional until 0246: use fail-closed ladders, never invent measured selectors.
- **Dependencies/build:** use x-pub's existing catalog dependency set, record the new workspace in `bun.lock`, and rely on `scripts/bundle-plugins.ts` to bundle both entry and declared check (0249 is already shipped). Do not copy or modify the bundler.
- Current-tree audit (2026-10-11): no WIP tasks. Other worktree `knowledge-kit-runall-g8-4173` owns G8 board/workflow work and currently edits root `package.json`, `bun.lock`, and `apps/cli/package.json`; coordinate lockfile integration before implementation, preserve its changes. The main tree has pre-existing edits in daily, store-selections, voice2-dag and wechatmp tests; preserve them.

### Plan

- [x] 0. Scaffold, then `bun install` so `bun.lock` records `@gobing-ai/weibo-pub`.
- [x] 1. Failure-list tests first: unknown op, `agent` driver, bad publishStatus, post without public, cover on post, bad cover path, unauthenticated preflight (no headed request), missing signal → R3/R5/R6/R8.
- [x] 2. Flow tests: article draft clicks `saveDraft` never `publish`; article public clicks `publish`; post public clicks `send`; ok only with the signal → R2/R4.
- [x] 3. Profile tests: precedence + exit codes through `runProfileCli` → R7; fake-env test → R9.
- [x] 4. Implement `src/index.ts`, `src/profile-check.ts` → R1–R9.
- [x] 5. `docs/04_DESIGN.md` entries → R10.
- [x] 6. `bun run lint`, `bun run test`, `bun run build` and applicable Spur rule gates pass; inspect intentional changes, including `bun.lock`.

- [x] 7. In recording fake-page tests assert stale toast/feed/URL refusal, attachment/readback failure, explicit action deadlines, real driver option refusal before injected/fake transport, empty post text, operation precedence, safe failure output/stderr, and headless-only preflight even with `checkHeadedOnly: true` → R2–R9. Test `runProfileCli(WEIBO_CONFIG, argv, {launcher, stdout})` for 0/1/2 and profile tiers; the thin `profile-check.ts` wrapper mirrors x-pub, with a subprocess usage-error smoke check requiring no browser. Restore env afterward; do not add an exported wrapper API just for testing.

### Solution

#### Change map

| Path | What changed |
| --- | --- |
| `plugins/publishings/weibo-pub/plugin.json` | New manifest: `kind: publish`, `entry: ./src/index.ts`, **`check: ./src/profile-check.ts`** (the seventh browser channel with a probe, ADR-032). |
| `plugins/publishings/weibo-pub/package.json` | `@gobing-ai/weibo-pub` with the x-pub dependency set (the browser transport needs `ts-browser-automation` + `playwright`). |
| `plugins/publishings/weibo-pub/src/index.ts:54-83` | `WEIBO_POST_SELECTORS` / `WEIBO_ARTICLE_SELECTORS` — ordered, fail-closed ladders, marked provisional for 0246. |
| `plugins/publishings/weibo-pub/src/index.ts:85` | `LOGIN_INSTRUCTION` — the operator recovery command every session failure names. |
| `plugins/publishings/weibo-pub/src/index.ts:92-106` | `fail()` / `boundedDetail()` / `bounded()` — every refusal is one bounded line: no DOM dump, cookie or stack. |
| `plugins/publishings/weibo-pub/src/index.ts:127-158` | `resolveOperation()` + `resolveDriver()` — operation and `options.driver ?? 'script'`, both refused by name before any transport exists (R8). |
| `plugins/publishings/weibo-pub/src/index.ts:165-189` | `isWeiboAuthenticated` / `WEIBO_CONFIG` — no login redirect and either the composer or the editor reachable; `checkHeadedOnly: false` and deliberately never forwarded by a publish preflight (R6). |
| `plugins/publishings/weibo-pub/src/index.ts:189-211` | `resolveCover()` — absolute, existing `.png|.jpg|.jpeg|.webp` or a pre-browser refusal (copied from the x-pub peer per the task's refine note). |
| `plugins/publishings/weibo-pub/src/index.ts:216-320` | `WeiboBrowserTransport` — refusal order (operation → driver → `publishStatus` value → post-without-public → post text → cover → session preflight), headless single-pass `checkChannelSession(WEIBO_CONFIG, {headedFallback: false})`, then one headed flow (R3, R5, R6). |
| `plugins/publishings/weibo-pub/src/index.ts:321-411` | `runArticleFlow()` — title fill → `pasteHtml(markdownToHtml(body))` → optional cover + fresh attachment signal → read-back of both fields → `保存草稿` (default) or the publish control; draft evidence is a **fresh** toast or a changed draft URL (R2, R4). |
| `plugins/publishings/weibo-pub/src/index.ts:413-438` | `runPostFlow()` — composer fill → read-back → `发送`, then a **new** feed card whose own text carries the submitted excerpt (R3, R4). |
| `plugins/publishings/weibo-pub/src/index.ts:440-538` | `requireReadback()`, `countImages()`, toast/feed-card snapshots and the draft, article-live and post-live probes — the "fresh signal only" rails (E91-D6). |
| `plugins/publishings/weibo-pub/src/index.ts:540-609` | `statusIdFrom()`, `liveArticleUrl()`, `probeDraftUrl()` and the page scripts (`kk-weibo-readback` / `-cover` / `-toasts` / `-feed` / `-card-text`) the probes evaluate. |
| `plugins/publishings/weibo-pub/src/index.ts:622-706` | `getPublishTransport()` (`FakeBrowserTransport('script')` under the fake env, R9), `processPublishIO()` (validates Content + operation + driver before resolving a transport) and `main()`. |
| `plugins/publishings/weibo-pub/src/profile-check.ts` | `runProfileCli(WEIBO_CONFIG, argv)` wrapper — `login|check`, precedence and exit codes live in the shared CLI (R7). |
| `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` | 37 offline tests: the refusal order with zero launches, the session preflight (one headless pass, `checkHeadedOnly` never forwarded), draft vs live article flows, fresh-vs-stale toast/feed/URL signals, read-back and cover-attachment refusals, profile precedence and exit codes (incl. a bare-entry usage smoke check), fake transport, IO and `main()` (R2–R9). |
| `packages/kk-core/tests/registry.test.ts:236,608` | Both inventories gain `weibo-pub`, keeping the shipped kind-collection discovery asserted exactly (R1). |
| `apps/cli/tests/commands/plugin-check.test.ts:177-179` | `weibo-pub` joins `CHANNELS` and "six" → "seven": the manifest's `check` makes the probe list seven (R2). |
| `docs/04_DESIGN.md` | `KK_BROWSER_PROFILE_DIR` row gains `weibo-pub` / `WEIBO_PROFILE_DIR`, the transport-verdict table gains the `weibo-pub` row, and the `@gobing-ai/weibo-pub` package section documents the rails (R10). |

#### Rationale

- **Refusal order is the contract** (R5/R6/R8): operation, driver, `publishStatus`, post-without-public, post text, cover and only then the session preflight — so an unsupported request costs no browser launch, and an absent profile costs exactly one headless pass.
- **Draft by default, live only on an explicit `public`** (E91-D5): the composer has no draft, so `post` **refuses** without `public` rather than silently publishing, and an `article` run clicks the publish control only for `public`.
- **Fresh signals only** (E91-D6): toasts, feed cards and the editor URL are snapshotted before the action, so a pre-existing card/toast can never be reported as this run's outcome; an unobserved outcome is a refusal naming the step and the deadline.
- **The recovery command is never truncated** (found while fixing the suite): `fail()` bounds the message to one line, so the session refusal now puts `bun plugins/publishings/weibo-pub/src/profile-check.ts login` **before** the harness detail — the operator's next action must not be the part that gets cut.
- **Read-back before any save/publish** (R4): a title or body the editor dropped is a refusal, not a saved draft with an empty article.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/weibo-pub/plugin.json:1-8` (`kind: publish`, `check: ./src/profile-check.ts`), `plugins/publishings/weibo-pub/package.json:1-19`, `plugins/publishings/weibo-pub/tsconfig.json:1-4`, `plugins/publishings/weibo-pub/src/index.ts:1-706`, `plugins/publishings/weibo-pub/src/profile-check.ts:1-20`, `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:1-662` |
| R2 | MET | `plugins/publishings/weibo-pub/src/index.ts:321-411` — title fill, `pasteHtml(markdownToHtml(body))`, optional cover with a fresh attachment signal, `保存草稿` by default; `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:362-446` covers draft-url, fresh-toast, cover-upload and cover-refusal |
| R3 | MET | `plugins/publishings/weibo-pub/src/index.ts:253-268` (post requires `public`, text-only cover refusal), `plugins/publishings/weibo-pub/src/index.ts:413-438` (composer → read-back → 发送 → fresh card); `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:282-306` and `:449-485` |
| R4 | MET | `plugins/publishings/weibo-pub/src/index.ts:447-512` — read-back before any save/publish and the fresh-signal probes (toast snapshot, feed-card snapshot, draft URL, published article URL); `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:399-446` and `:464-476` cover the stale-toast, no-signal, existing-card and non-matching-card refusals |
| R5 | MET | `plugins/publishings/weibo-pub/src/index.ts:250-256` — any other `publishStatus` refused pre-browser; `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:272-280` |
| R6 | MET | `plugins/publishings/weibo-pub/src/index.ts:271-284` — `checkChannelSession(WEIBO_CONFIG, { headedFallback: false })`, refusal leads with the login command; `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:319-359` asserts one headless request and that `checkHeadedOnly` is never forwarded |
| R7 | MET | `plugins/publishings/weibo-pub/src/profile-check.ts:1-20` over `runProfileCli`; `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:488-560` covers precedence, exit codes 0/1/2 and the bare-entry usage smoke check |
| R8 | MET | `plugins/publishings/weibo-pub/src/index.ts:127-158` — operation and `options.driver` refused by name before any transport exists; `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:223-270` |
| R9 | MET | `plugins/publishings/weibo-pub/src/index.ts:622-626` — `FakeBrowserTransport('script')` under the fake env; `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:563-620` plus the CLI probe below |
| R10 | MET | `docs/04_DESIGN.md:809` (profile-env row gains `weibo-pub` / `WEIBO_PROFILE_DIR`), `docs/04_DESIGN.md:931` (transport-verdict row), `docs/04_DESIGN.md:1016-1028` (`@gobing-ai/weibo-pub` package section) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — weibo-pub saves a post or article draft by default from an observed signal | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:363-388` — the draft run clicks 保存草稿 and never the publish control, and success requires the fresh draft URL or the fresh toast; production `plugins/publishings/weibo-pub/src/index.ts:321-411` |
| R5 — weibo-pub publishes live only when publishStatus is public | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:282-298` (post without `public` refused pre-browser), `:272-280` (unknown value refused), `:390-397` (publish control clicked only for `public`) |
| R6 — weibo-pub refuses an unauthenticated session before any headed browser opens | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:320-359` — one headless request on a refusal, login command in the error, and the preflight stays headless with `checkHeadedOnly: true` |
| R7 — weibo-pub ships a profile-check login and check entry | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:488-560` over `plugins/publishings/weibo-pub/src/profile-check.ts:1-20` |
| AC1 — weibo-pub saves a post or article draft by default from an observed signal (req: R2) (req: R3) (req: R4) | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:362-446` |
| AC2 — weibo-pub publishes live only when publishStatus is public (req: R3) (req: R5) | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:272-298` and `:390-397` |
| AC3 — weibo-pub refuses an unauthenticated session before any headed browser opens (req: R6) | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:319-359` |
| AC4 — weibo-pub ships a profile-check login and check entry (req: R7) | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:488-560` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0244

**Scope:** task 0244 working diff (20 files, +2508 / −36; `plugins/publishings/weibo-pub/**`, `docs/04_DESIGN.md`, `packages/kk-core/tests/registry.test.ts`, `apps/cli/tests/commands/plugin-check.test.ts`, `bun.lock`)
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | Every selector ladder in this plugin is **provisional**: the 头条文章 editor URL, the `保存草稿` label and all composer/feed selectors come from the filed design, not from a measured live session. A wrong selector fails closed (a loud refusal naming the step and deadline, never silent success), but the article half of R2/R4 cannot be called live-verified. Owner and follow-up already exist: task 0246 measures and pins them, and re-scopes the article half through `spur feature update` if no draft control is found. | `plugins/publishings/weibo-pub/src/index.ts:54-83` | DEFER (0246 owns live selector pinning; recorded in the task's closed Q&A) |
| 2 | P4 (advisory) | correctness | The cover-attachment baseline scopes its image count to `closest('form, section, article, main')`. On the live editor that container may not include the cover preview, which would read as "no fresh attachment" and refuse an article that did attach a cover. Fail-closed direction; 0246's live walk pins the real scope. | `plugins/publishings/weibo-pub/src/index.ts:572-578` | ACCEPTED |
| 3 | P4 (advisory) | correctness | The post signal compares a 30-character normalized excerpt of the submitted text against the new card's own text. A card that truncates the body, or renders it in a nested node the probe does not read, becomes a refusal rather than a false success — the correct direction, at the cost of a possible false negative on the live feed. | `plugins/publishings/weibo-pub/src/index.ts:605-611` | ACCEPTED |
| 4 | P4 (advisory) | correctness | `statusIdFrom()` falls back to the URL's trailing segment when no explicit `status`/`detail`/`show` pattern matches, so an unusual observed URL could put a non-id token in `Result.id`. Only URLs the probes observed are passed in, and the fallback exists because the desktop status form is `weibo.com/<uid>/<status-key>` with no marker segment. | `plugins/publishings/weibo-pub/src/index.ts:540-548` | ACCEPTED |
| 5 | P4 (advisory) | architecture | The driver refusal is implemented twice — `resolveDriver()` at the IO gate and `this.driver !== 'script'` in `publish()` — with the same wording in two literals. Intentional (the IO path must refuse before a transport exists, and a direct transport caller must still refuse), but the two messages have to stay in sync. The x-pub peer has the same shape. | `plugins/publishings/weibo-pub/src/index.ts:147-158`, `:228-235` | ACCEPTED |
| 6 | P4 (advisory) | efficiency | One observation of the fake-transport probe (`kk executor run weibo-pub`) took 22 minutes while three other agent suites saturated this machine, and 1.2 s when re-measured — i.e. the wall time was contention, not plugin work. Recorded because a step-level timeout under that load would have read as a plugin defect; there is no plugin-side hot path (all imports are lazy, no bundling at run time). | `plugins/publishings/weibo-pub/src/index.ts:622-706` | ACCEPTED |

No P1–P2 findings. Security-relevant negatives verified by tests: the session preflight never escalates to a headed window (one headless request on a refusal, asserted with `checkHeadedOnly: true` forced on the config), every refusal happens before the launcher is touched, and the operator recovery command leads every session message so a bounded line cannot truncate it.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/publishings/weibo-pub/plugin.json:1-8` (`kind: publish`, `check: ./src/profile-check.ts`), `package.json:1-19`, `tsconfig.json:1-4`, `src/index.ts:1-706`, `src/profile-check.ts:1-20`, `tests/weibo-pub.test.ts:1-662` |
| R2 | MET | `src/index.ts:321-411` (title, `pasteHtml(markdownToHtml(body))`, cover, `保存草稿`) + tests "a draft run clicks 保存草稿, never the publish control" and the cover tests |
| R3 | MET | `src/index.ts:253-268` (post requires `public`), `:264-268` (text-only cover refusal), `:413-438` (composer → read-back → 发送 → fresh card) + tests for each refusal |
| R4 | MET | fresh-signal rails at `:447-512` (`probeDraft`, `probeFreshToast`, `probeArticleLive`, `probePostLive`) + read-back tests, stale-toast test, existing-feed test, non-matching-card test, and both no-signal refusals naming step + deadline |
| R5 | MET | `src/index.ts:250-256` — `publishStatus` other than absent/`draft`/`public` refused pre-browser + test |
| R6 | MET | `src/index.ts:271-299` — `checkChannelSession(WEIBO_CONFIG, {headedFallback: false})`, refusal names `LOGIN_INSTRUCTION`; tests assert one headless request and that `checkHeadedOnly` is never forwarded |
| R7 | MET | `src/profile-check.ts:1-20` + tests for precedence, exit codes 0/1/2, the login path and a bare-entry usage smoke check |
| R8 | MET | `src/index.ts:127-158` (operation + driver before any transport) + the injected-transport and `processPublishIO` refusal tests |
| R9 | MET | `src/index.ts:622-626` — `FakeBrowserTransport('script')` under the fake env + offline `processPublishIO`/`runInvoke`/CLI probe |
| R10 | MET | `docs/04_DESIGN.md:809` (profile-env row), `:931` (transport-verdict row), `:1016-1028` (`@gobing-ai/weibo-pub` package section) |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R4 — weibo-pub saves a post or article draft by default from an observed signal | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` draft-url and fresh-toast cases; production `plugins/publishings/weibo-pub/src/index.ts:321-411` |
| R5 — weibo-pub publishes live only when publishStatus is public | MET | test | `tests/weibo-pub.test.ts` post-without-public refusal, unknown-publishStatus refusal, and the publish-control-only-for-public case |
| R6 — weibo-pub refuses an unauthenticated session before any headed browser opens | MET | test | `tests/weibo-pub.test.ts` preflight cases (one headless request, login command in the error, `checkHeadedOnly` never forwarded) |
| R7 — weibo-pub ships a profile-check login and check entry | MET | test | `tests/weibo-pub.test.ts` profile-check suite + `plugins/publishings/weibo-pub/src/profile-check.ts:1-20` |
| AC1 — both plugins refuse an unknown operation or driver by name before any transport (req: R6) | MET | test | threads half: `plugins/publishings/threads-pub/tests/threads-pub.test.ts`; weibo half: `tests/weibo-pub.test.ts` + the CLI refusal probe below. The cross-plugin fan-out assertion is task 0245's. |
| AC2 — both plugins run offline under the fake publish transport (req: R6) | MET | test | both suites' fake-env cases plus the two CLI probes below; the cross-plugin fan-out assertion is task 0245's |
| AC3 — the new channels are listed wherever publish channels are enumerated (req: R1) (req: R2) (req: R3) (req: R4) (req: R5) | PARTIAL | static-ref | This task's own slice is done (`packages/kk-core/tests/registry.test.ts:242,611`, `apps/cli/tests/commands/plugin-check.test.ts:177-179`, `docs/04_DESIGN.md`). The remaining enumeration surfaces (`plugins/kk/skills/publish/SKILL.md`, `docs/03_ARCHITECTURE.md`) belong to task 0245, which is the scenario's covering task. |
| AC4 — weibo-pub ships a profile-check login and check entry (req: R7) | MET | test | as R7 above |

##### Acceptance evidence (1135 R1/R2)

Public surfaces probed against a throwaway root, no corpus writes, no network:

```console
$ KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake bun apps/cli/src/index.ts executor run weibo-pub \
      --in /tmp/kk-weibo-probe/in.json --out /tmp/kk-weibo-probe/out.json ; echo rc=$?
rc=0
$ cat /tmp/kk-weibo-probe/out.json
{ "ok": true, "target": "fake-browser", "url": "https://example.com/browser-draft",
  "id": "fake-browser-id-123", "message": "Published offline via FakeBrowserTransport",
  "metadata": { "driver": "script" } }

$ KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake bun apps/cli/src/index.ts executor run weibo-pub \
      --in /tmp/kk-weibo-probe/bad.json --out /tmp/kk-weibo-probe/bad-out.json
Plugin entry 'weibo-pub' failed (exit code 1): weibo-pub failed: unsupported operation 'dm' for weibo: expected one of post, article
$ cat /tmp/kk-weibo-probe/bad-out.json
{ "ok": false, "target": "weibo", "error": "unsupported operation 'dm' for weibo: expected one of post, article" }

$ bun plugins/publishings/weibo-pub/src/profile-check.ts nope   # bare-entry usage smoke
exit 2
```

Changed-path static self-check: `bun run spur-check` PASS at digest `sha256:15a18ffd82f5a9fe0424427016c79e7240c77dc515b2e1781553d9b489b036b9` (2500 pass / 2 skip / 0 fail; `recommended-pre-check` and `recommended-post-check` presets green).

**Next:** 0245 registers both channels in the remaining enumeration surfaces and adds the cross-plugin fan-out test; 0246 pins the provisional selectors live and owns the final status flip.

### References

- Feature E94; design `docs/design/weibo-threads-publish-channels.md` §3; ADR-027, ADR-032; E91-D5/D6
- Template: `plugins/publishings/x-pub/src/index.ts:164-440`, `plugins/publishings/x-pub/src/profile-check.ts`
- Weibo share API rejection evidence: https://v2ex.com/t/379387

### History

- 2026-10-12T06:01:52.011Z todo → wip (system)
- 2026-10-12T06:37:59.076Z wip → testing (system)
- 2026-10-12T06:39:11.409Z testing → done (system)

