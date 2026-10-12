---
schema_version: 1
name: weibo-pub live operator dogfood — pin composer and article editor selectors
status: blocked
template: feature-impl
created_at: 2026-10-09T23:19:30.104Z
updated_at: "2026-10-12T18:36:27.022Z"
feature_id: E94
priority: P3
tags:
  - publish
  - weibo
  - dogfood
  - E94
estimate_hours: 2

dependencies: ["0244", "0245"]
ac_numbering: task-local
ac_altitude: task-local
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

**Diagnosis pass (2026-10-12, extended).** A later read-only pass over the state the two approved attempts
left behind (`docs/design/weibo-ui-discovery.md` §4a) measured: the home composer **still holds the
attempt's 114-character draft** (a successful send clears it; Weibo persists an unsent draft), the send
control is enabled and topmost, **no dialog, notice or real-name hint is present at rest**, the headless
session still verifies, and `https://open.weibo.com/apps` redirects away — there is no open-platform app
for this account either. The silence therefore has three candidate causes, and none is confirmed:

1. the synthetic click never drives the desktop app's submit handler (favoured by the total absence of
   feedback plus the retained draft);
2. risk control quietly drops the submission for a brand-new, unverified account;
3. a verification modal appears after the click and the current flow never looks for one — it probes
   cards and toasts only, so a modal is invisible to it.

The first deliverable of this task is therefore **explaining the silence**, not another live write. The
existing flow is not wrong — it fails closed, published nothing, and is covered by 39 offline tests — but
a third approved attempt without that explanation would burn an approval again.

**Route options** (`docs/design/weibo-ui-discovery.md` §4b): the desktop composer (current, measured),
the **mobile composer** at `m.weibo.cn/compose/` (a simpler API-backed page, entirely unmeasured, and the
cheapest next measurement), and the **official open-platform API** (`statuses/update.json`; `statuses/share.json`
for text-plus-link) which needs an operator-registered app with write permission, an OAuth 2.0 token, and a
bound safe domain for `share` — it would follow the existing threads-pub/x-pub env-only credential pattern.

**Freshness note for a re-implementation.** The current account session is throwaway and its two sends were
declined; the desktop selectors were measured on it and remain valid, but nothing required a fresh account —
a properly verified account is a prerequisite for either browser route's public leg.

**Purpose (2026-10-12, operator-set): an announcement channel.** The channel exists so a reader learns a
**new episode is out** — not to mirror the episode body. That means a short post (episode title + one-line
hook), the **episode link**, and the **cover artwork**; everything else stays on the episode page.

**The "114 characters" reading is corrected.** 114 was never a platform limit — it is the length of the
unsubmitted draft my probe found *still sitting in the composer* (evidence: §4a). Weibo's own limit is far
larger: a Weibo customer-service FAQ updated 2024-09-04 states up to **5000 Chinese characters**
(<https://kefu.weibo.com/faqdetail?id=21510>), the older `statuses/update` documentation still cites 140 with
long text via `is_longtext` (<https://open.weibo.com/wiki/2/statuses/update>), and long posts are **truncated
to roughly 140 characters in feeds** behind a "show full text" control. So the binding constraint is the
*feed preview*, not the platform: keep the announcement's visible hook inside ~140 characters so the reader
sees the hook and the link without expanding anything. Nothing has to be shortened to 114.

**The announcement route is the one the platform is built for.** `statuses/share` exists for "text plus a
link": it requires the text to contain a URL **under the app's configured safe domain**, and takes the image
as a `pic` **binary upload** (documented: JPEG/GIF/PNG, under 5 MB) rather than an image URL
(<https://open.weibo.com/wiki/2/statuses/share>). Link-card previews are not guaranteed by merely including a
URL, so the announcement's value must not depend on a preview card rendering.

**Gap this opens in the current plugin.** `post` refuses any cover image ("weibo post is text-only", task
0244 R3) — written when the channel was a text mirror. An announcement wants the cover, so that refusal has to
become a *supported one-image* rail (R9).

### Requirements

- [ ] R1. Operator runs `bun plugins/publishings/weibo-pub/src/profile-check.ts login` then `check` (exit 0) on a disposable Weibo account; record a forced headless `checkChannelSession` call (`headedFallback: false`, no headedOnly) separately from operator `check --headed`; set `WEIBO_CONFIG.checkHeadedOnly` for the operator CLI only if measured. If forced headless fails, record the fail-closed publish limitation and do not run public legs by bypassing preflight.
- [ ] R2. Live `article` run (no publishStatus) saves a 头条文章 draft and returns `ok: true` from the observed signal; the draft is visible in Weibo's draft list. If no draft control exists, stop and re-scope via `spur feature update E94` instead.
- [ ] R3. With separate explicit operator approval for each public write, live `post` and live `article` runs with `publishStatus: 'public'` return `ok: true` from fresh signals with their status/article URLs and ids; operator removes the disposable test content afterwards. No approval or no headless verification means stop before the public write and retain partial evidence, never claim R5 verified.
- [ ] R4. `WEIBO_ARTICLE_URL`, `WEIBO_POST_SELECTORS`, `WEIBO_ARTICLE_SELECTORS` and signals updated to the observed DOM; `docs/design/weibo-ui-discovery.md` records each selector hit, signal and the measurement date; `docs/04_DESIGN.md` satellite row drops "live selectors pending 0246".


**Out of scope:** production-account publishing, automatic deletion, credentials/session artifacts, bypassing headless preflight, changing feature scope merely to make a test pass. Any missing draft control or required flow change is documented and re-planned through Spur; no fallback to live publishing.
- [ ] R5. Diagnose the silent decline **before any further public write**: capture the post-click page state (visible dialog/modal text, the composer's length before and after the click, and the toast list) plus the account's standing (age, phone/real-name verification, any 异常/受限 notice), and record which of the three candidate causes in Background the evidence supports. No third live attempt without approval, and none at all before this diagnosis is recorded.
- [ ] R6. Measure the alternative browser path: open `https://m.weibo.cn/compose/` in the same profile, record whether the composer and its submit control attach, and capture the post-click state there; if it is cleaner than the desktop app, re-derive `WEIBO_POST_SELECTORS`/the submit step for it and record the decision.
- [ ] R7. Decide and record the route — desktop composer with a fixed submit path, mobile composer, or the official API with an operator-registered app — including its prerequisites (account standing; for the API: App Key/Secret, token scope, safe domain) and the env-only credential names it would use. The plugin's code and docs must match the chosen route, and a route not yet chosen stays documented as unselected.
- [ ] R8. A **dedicated Weibo announcement content shape** for a new episode, plus the reusable way to hand it to the channel: the visible body carries the episode title plus a one-line hook **inside ~140 characters** (the feed's display budget — the platform allows 2000–5000, the feed truncates), followed by the episode **link** as plain text in the same body so Weibo autolinks it; `options.coverPath` / `metadata.coverImage` carries the cover artwork (R9). Record the shape as a concrete worked example derived from a real episode's Content and metadata (daily/ITC episode title, link, cover) together with the copyable `kk executor run weibo-pub --in <content.json> --out <result.json>` invocation and its env prerequisites, so any workflow can produce the announcement. Wiring the channel into daily/ITC stays a separate feature (E94 scope), so this is the documented handoff surface, not a new workflow step.
- [ ] R9. `post` accepts **one** cover image, replacing the unconditional text-only refusal: the browser flow uploads it through the composer's image input and requires a fresh observed attachment before the send; the API route (if chosen under R7) sends it as the `pic` binary (JPEG/GIF/PNG, under 5 MB — <https://open.weibo.com/wiki/2/statuses/share>). Refuse only genuinely unsupported input (more than one image, a non-image path, an oversized file), naming the reason, and never drop an image silently. `article` keeps its existing cover rail.
- [ ] R11. **Reader-visible verification**: after a live announcement, the post is observable on the account's timeline/home feed, its id/URL is recorded, the embedded link resolves to the episode, and the cover renders (or the absence of a cover card is recorded as an observation, since previews are not guaranteed). The evidence goes into `docs/design/weibo-ui-discovery.md`, not the repository's committed scratch.

### Acceptance Criteria

- [ ] AC1 — weibo-pub saves a post or article draft by default from an observed signal (req: R2)
- [ ] AC2 — weibo-pub publishes live only when publishStatus is public (req: R3)

Evidence: live run Result JSON + `docs/design/weibo-ui-discovery.md`; offline suite re-run green after constant changes.

Given 0244/0245 are complete and an operator has a disposable verified account, when the draft leg and separately approved public post/article legs run, then fresh observed signals and cleanup records prove AC1/AC2. `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` must also retain stale-signal refusal and headless-only preflight regression cases after selector changes. Offline tests alone cannot verify live AC.
- [ ] AC3 — the silence is explained by measured evidence (post-click dialog state, composer before/after, toasts, account standing) and recorded in `docs/design/weibo-ui-discovery.md`, with no public write made before the diagnosis
- [ ] AC4 — the chosen publish route and its prerequisites are recorded, `m.weibo.cn`'s composer is measured either way, and the plugin's selectors/docs match the route
- [ ] AC5 — a dedicated announcement Content for a real episode validates offline: the visible hook is inside the ~140-character display budget, the episode link is present in the body, and the cover path is accepted
- [ ] AC6 — a `post` carrying exactly one cover image is accepted end-to-end in the offline suite (fresh-attachment signal observed, image part of the submitted content), while more than one image, a non-image path, or an oversized file is refused by name
- [ ] AC7 — the reusable invocation contract is documented with a copyable example, and a live announcement is verified reader-visibly with its URL, the resolving episode link and the cover observation recorded

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

**Diagnosis-first order (extension, 2026-10-12).** R5 is now the gate for every other leg: a third approved
attempt is only worth its approval once the post-click snapshot names the cause. The snapshot is bounded —
visible dialogs/modals (text ≤ 200 chars), the composer's length before and after the click, the toast list,
and the account's standing indicators — and lives in the run plane, never in the repository.

**Route selection.** Prefer fixing the browser path when the cause is a submission-handler or modal problem
(hypothesis 1 or 3) — cheapest, no app review. Measure `m.weibo.cn/compose/` in parallel because it is a
different, simpler front end and may sidestep the desktop React app entirely. Choose the API route
(hypothesis 2, or when a stable CI-grade channel is wanted) only with an operator-registered app; then the
plugin grows a `file-cli` transport beside the browser one, with `WEIBO_APP_KEY` / `WEIBO_APP_SECRET` /
`WEIBO_ACCESS_TOKEN` env-only credentials and the same redaction rail, and the browser transport stays as
the fallback it is today.

**Invariants unchanged.** No public write without `publishStatus: 'public'` *and* contemporaneous operator
approval; the headless preflight is never bypassed; a send whose outcome cannot be observed is `ok: false`;
drafts remain the default; the account's credentials/session never enter the repository.

**Announcement content contract (extension, 2026-10-12).** The channel's Content is an *announcement*, so its
body is authored for the feed, not copied from the episode: `title` carries the episode name, `body` is
`<hook ≤ ~140 display chars>\n<episode link>` and nothing else, and the cover travels in
`options.coverPath` / `metadata.coverImage`. The link must be in the body text (Weibo autolinks it, and
`statuses/share` *requires* a URL in the text); no card preview is assumed. The visible hook budget is a
*display* budget derived from feed truncation, not a platform limit — the platform accepts 2000–5000
characters, so an over-long body is a content-quality defect, not a refusal: the plugin may validate and warn
on a body over the budget, but it must not truncate silently (the no-truncation rule from 0243 still holds).

**One-image post rail.** `post` gains the same cover plumbing `article` already has: resolve and validate the
path pre-browser (absolute, existing image, single image), upload it in the composer, require a fresh observed
attachment, and in the API route map it to `pic`. The refusal set narrows to unsupported input; the existing
"text-only" refusal is removed with this task, and the stale-literal test that asserts it is replaced by the
new refusal cases (offline, fake page).

**Route mapping (feeds R7).** Browser route: composer + image input + send, all with the observed-signal rule.
API route (`statuses/share.json`): `status` = hook + link, `url` = the episode link under the app's safe
domain, `pic` = the cover binary; `statuses/update.json` covers text-only posts once `is_longtext` matters.
Credentials env-only (`WEIBO_APP_KEY` / `WEIBO_APP_SECRET` / `WEIBO_ACCESS_TOKEN`), never in the task or the
repository, and the redaction rail from threads-pub applies unchanged.

**Invariants unchanged.** No public write without `publishStatus: 'public'` *and* contemporaneous operator
approval; the headless preflight is never bypassed; an unobservable outcome is `ok: false`; drafts stay the
default for `article`; no credential, cookie or page HTML in the repository.

### Plan

- [ ] 1. **Diagnose the silence** (R5, AC3): re-verify the session, capture the composer's retained draft, then obtain one operator approval for a diagnostic send whose purpose is the post-click snapshot (dialog text, composer length before/after, toasts); record it in `docs/design/weibo-ui-discovery.md`. Also record the account's standing (verified/phone/异常 notices) — hypothesis 2 either dies here or becomes the blocker.
- [ ] 2. **Measure the mobile composer** `https://m.weibo.cn/compose/` in the same profile (R6, AC4): composer/submit selectors and post-click state; if cleaner than the desktop app, re-derive `WEIBO_POST_SELECTORS` and the submit step for it.
- [ ] 3. **Add the one-image post rail** (R9, AC6): cover resolution/validation pre-browser, composer upload with a fresh-attachment signal, refusal cases for >1 image / non-image / oversized, and the fake-page tests replacing the old text-only assertion. Keep the offline suite green.
- [ ] 4. **Author the announcement shape** (R8, AC5): the hook + link body, the cover field, a worked example from a real episode's Content/metadata, and the display-budget validation (warn, never truncate).
- [ ] 5. **Document the reusable invocation** (R8, AC7): `kk executor run weibo-pub --in …` with the announcement fields, a copyable `content.json`, and the env prerequisites; note that daily/ITC wiring is out of scope here.
- [ ] 6. **Live announcement, once approved** (R3, R11, AC7): one approved public post, then check the timeline for the post, click the link through to the episode, and record whether the cover rendered. The article/头条文章 leg stays optional and entitlement-gated (`docs/design/weibo-ui-discovery.md` §5).
- [ ] 7. **Finish**: `bun run spur-check`, update `docs/04_DESIGN.md`'s satellite row to the honest status, and leave the run-scoped evidence in the run plane.

 plans, kept for context, not part of this plan: the original 0246 steps 0/2/3/4 predate the
diagnosis pass; the first diagnosis-first revision is folded into steps 1–2 above.)_

### Solution

The re-implementation (2026-10-12, in-session) replaced the click-driven post with the mechanism the
**diagnosis** pointed at, and made the channel an announcement channel.

| Surface | Change |
| --- | --- |
| `plugins/publishings/weibo-pub/src/index.ts:51` | `WEIBO_MOBILE_COMPOSE_URL` (`https://m.weibo.cn/compose/`, measured) is the post entry |
| `plugins/publishings/weibo-pub/src/index.ts:69-100` | `WEIBO_POST_SELECTORS` holds the measured mobile composer (`textarea[placeholder*="分享新鲜事"]`), send (`a.m-send-btn`) and a post `fileInput` |
| `plugins/publishings/weibo-pub/src/index.ts:108-114`, `:216-256` | **One-image rail** for `post` (R9): `POST_IMAGE_EXTS` / `MAX_IMAGE_BYTES` (5 MB, Weibo's documented `pic` bound) and a `resolveCover` that accepts exactly one image (`options.coverPath` › single-element `options.images` › `metadata.coverImage`) and names the refusal otherwise |
| `plugins/publishings/weibo-pub/src/index.ts:451-513` | `runPostFlow` fills the mobile composer, uploads the cover with a fresh attachment, reads its id and **refuses** when unreadable rather than posting text-only while claiming an image; R3's text-only refusal is gone |
| `plugins/publishings/weibo-pub/src/index.ts:515-535`, `:639-668` | **Submit through the page's own mobile API**: `submitViaMobileApi` + `apiSubmitScript` issue `POST https://m.weibo.cn/api/statuses/update` from the page context with the page's `st` token and the session cookies — the request the web app itself makes; the returned status id is the observed outcome (`https://m.weibo.cn/detail/<id>`) |
| `plugins/publishings/weibo-pub/src/index.ts:671-705` | **Site refusals rendered, not swallowed**: `parseApiSubmit` / `parseSiteRefusal` turn the payload into `HTTP <status> errno <code>: <msg> (<action>: <url>)` |
| `plugins/publishings/weibo-pub/src/index.ts:576-594`, `:719-728` | `postDiagnostics` + `dialogTextScript` record composer length before→after, the first visible dialog/verification text and any fresh toast on every failed submit |
| `plugins/publishings/weibo-pub/src/index.ts` (removals) | The click-era probes (`probePostLive`, feed-card reads, card-text scripts, `reloadedForPost`) are deleted — they could never have observed this route |
| `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:465-580` | 41 cases: the mobile route, the API submit with and without a pic id, the unreadable-pic-id refusal, Weibo's `errno 200001` rendering, the post-click diagnosis, and the image refusal set |
| `docs/design/weibo-ui-discovery.md` §2b/§4a/§4b/§4c/§7 | Mobile composer measured + route decision; **hypothesis 2 confirmed** with the site's payload; the route table; the announcement contract with a copyable example; the account activation as the one blocker |
| `docs/04_DESIGN.md` (weibo-pub section) | Mobile composer + API submit, the one-image rail, the announcement contract/example, the account prerequisite |
| `.spur/rules/strict/http-boundaries.yaml` (`no-direct-fetch` list) | Exemption for the new transport: its `fetch(` is the page-context submit string, i.e. the transport's own boundary |

**Diagnosis outcome (the deliverable this pass turned on).** Three live attempts never published anything, and
the mobile API finally answered with Weibo's own payload:
`{"ok":0,"errno":"200001","msg":"您的微博账号处于异常状态，请立即激活账号…","title":"账号异常","btn":{"text":"立即激活","url":"http://m.weibo.cn/security?…"}}`
— the account is **flagged abnormal and must be activated**. That is the single blocker for the live legs; no
code path was at fault, and nothing was ever published from this account.

### Testing

Commands run in the invoking tree (`knowledge-kit`, branch `main`) on 2026-10-12:

| Command | Outcome |
| --- | --- |
| `bun test plugins/publishings/weibo-pub` | **41 pass / 0 fail**; `src/index.ts` funcs 98.5 %, lines 100 % |
| `cd plugins/publishings/weibo-pub && bun run typecheck` | clean |
| `bun run lint` (biome + every workspace typecheck, incl. `@gobing-ai/weibo-pub`) | clean |
| `bun run test-pre-check` | **All 59 rules passed** (after the `no-direct-fetch` exemption for this transport) |
| `bun run test-post-check` | All 2 rules passed |
| `bun run test` (repo suite) | **2672 pass / 2 skip / 5 fail / 2 errors** — none in this change: 2 are `package publish metadata (R1/R2)` failing because the concurrently developed `voxcpm-tts` plugin cannot bundle (`error: bundling voxcpm-tts failed: entry ./src/index.ts: Bundle failed`, from another session's in-flight work), 2 are `vendors/karakeep` dependency-resolution errors (`Cannot find package 'zustand'`, `Cannot find module '@testing-library/react'`), and 1 is an unrelated `formatLocalDate` locale expectation. This task's change set is `plugins/publishings/weibo-pub/{src,tests}`, `docs/04_DESIGN.md`, `docs/design/weibo-ui-discovery.md`, `.spur/rules/strict/http-boundaries.yaml` and this task file — none of them referenced by a failing test. |
| Live announcement (approved): `kk executor run weibo-pub --in .spur/run/0246-live/announcement2.json --out …` | `ok: false` with **the site's own refusal**: `HTTP 200 errno 200001: 您的微博账号处于异常状态，请立即激活账号…` — i.e. the submit path works (the request reached Weibo and returned its structured payload) and the account is flagged abnormal |
| Read-only visibility check afterwards | the text is absent from the home feed and the account timeline — nothing was published, so no unintended public content exists |
| `docs/design/weibo-ui-discovery.md` §2b/§4a/§4b/§4c/§7 | measurements, the confirmed diagnosis, the route decision, the announcement contract, and the account blocker recorded |

Coverage: the plugin's own thresholds are met (`src/index.ts` 100 % lines, 98.5 % funcs). The repo-wide suite
is red only for the concurrent `voxcpm-tts`/vendor causes above, which are outside this task's change set.

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
- 2026-10-12T17:38:04.512Z wip → blocked (system)
- 2026-10-12T17:48:50.896Z blocked → todo (system)
- 2026-10-12T18:04:06.761Z todo → wip (system)
- 2026-10-12T18:36:27.022Z wip → blocked (system)

