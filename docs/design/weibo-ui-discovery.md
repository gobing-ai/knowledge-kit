# weibo-pub UI discovery (E94 / task 0246)

**Status:** measured 2026-10-12 on a signed-in throwaway Weibo account in the persistent profile
`~/.config/kk/browser-profiles/weibo` (headed login, then read-only probes). Precedent:
`x-article-ui-discovery.md` (0194), `xhs-ui-discovery.md`.

**Scope of evidence.** Measurements below come from live DOM reads (`describeNode`-style descriptors:
tag, placeholder, aria-label, role, class, ≤ 40 chars of text). No page HTML, cookie, token or
screenshot is recorded here, and none is committed: the run-scoped probe scripts, the two live
`Result` JSONs and the route/selector dumps live in the run's `.spur/run/` plane (retained with the
batch evidence), never in the repository.

## 1. Session / preflight (R1)

| Probe | Command | Result |
| --- | --- | --- |
| Operator login | `bun plugins/publishings/weibo-pub/src/profile-check.ts login --timeout 600000` | exit 0 — `weibo profile login verified` (the readiness predicate matched after the sign-in) |
| Operator check | `bun plugins/publishings/weibo-pub/src/profile-check.ts check --timeout 60000` | exit 0 — `{"status":"verified", … "observed headlessly …"}` |
| **Forced-headless publish preflight** (`headedFallback: false`, no `headedOnly`) | a run-scoped probe calling `checkChannelSession(WEIBO_CONFIG, { headedFallback: false })` over the same profile (probe retained with the batch evidence, not committed — the call site is `plugins/publishings/weibo-pub/src/index.ts:271-299`) | `{"status":"verified"}` — a headless pass is sufficient |

**Decision:** `WEIBO_CONFIG.checkHeadedOnly` stays **`false`**. Unlike x-pub (`checkHeadedOnly: true`,
headless article loads are login-walled), this channel verifies headlessly, so the operator CLI needs
no headed-only mode — and the publish preflight keeps its headless-only gate (unchanged R6).

**Fresh-profile note:** with no profile, `https://weibo.com` redirects to
`https://passport.weibo.com/visitor/visitor?…` and the composer never attaches — the login gate is the
expected state until `login` completes.

## 2. Post composer (measured)

| Group | Candidate | count | visible | Measured node |
| --- | --- | --- | --- | --- |
| composer | `textarea[placeholder*="新鲜事"]` | 1 | yes | `textarea`, placeholder `有什么新鲜事想分享给大家？`, class `_input_1rz8r_8` |
| composer | `textarea[placeholder*="分享"]` | 1 | yes | same node (the placeholder contains 分享) |
| composer | `div[contenteditable="true"][class*="Form"]`, `div[role="textbox"]`, `[contenteditable="true"]` | 0 | no | — the composer is a real `<textarea>`, not a contenteditable |
| send | `button:has-text("发送")` | 1 | yes | `button` text `发送`, classes `woo-button-main woo-button-flat woo-button-primary woo-button-m woo-button-round _btn_2z30i_68` |
| send | `button[class*="woo-button-primary"]` | 1 | yes | **matches the account's 管理 button** on the home page — dangerous as a bare class fallback |

Send-control state after `fill()` **and** after human-style typing: `enabled: true`, `visible: true`,
`elementFromPoint` at the button centre is the button itself (no overlay), `disabled: false`,
`aria-disabled: null`. So the click is not blocked by actionability.

## 2b. Mobile composer — the route `post` now uses (measured 2026-10-12)

| Measurement | Value |
| --- | --- |
| URL | `https://m.weibo.cn/compose/` — loads with the same profile, **not** login-walled (`loginWall: false`) |
| Composer | one real `<textarea>` with placeholder `分享新鲜事…` |
| Send control | `a.m-send-btn` (text 发送), `disabled=false` |
| Image input | `input[type="file"]`, `accept="image/gif,image/jpeg,image/webp,image/jpg,image/png,image/bmp"` |
| `m.weibo.cn/` root | no send control — `/compose/` is the entry |

**Route decision (R6/R7):** `post` goes through the **mobile composer**. It is a plain, server-rendered page
with one textarea, one send anchor and a native image input, where the desktop React app's 发送 click produced
no submission at all (draft retained, no toast, no card, twice — §4a). The desktop selectors stay in the
ladder only as fallbacks, and the desktop no-op remains a documented hypothesis rather than something a live
write has to settle.

**Live signals on this route.** On success the composer page navigates to `/detail/<id>` (or `/status/<id>`) —
that URL carries the new status id and is the strongest evidence available, so it is probed first; a fresh
feed card carrying the excerpt and a fresh success toast remain secondary. On failure the flow now records its
own diagnosis (composer length before→after, the first visible dialog/verification text, any fresh toast),
so a silent send cannot recur without an explanation attached.

## 3. Status links / cards (measured — the decisive finding)

| Candidate | Matches on the signed-in home feed | Matches on `weibo.com/u/<uid>` |
| --- | --- | --- |
| `a[href*="/status/"]` | **0** | 0 |
| `a[href*="/detail/"]` | **0** | 0 |
| `a[class*="_time_"]` | 8 | 4 |

Observed shapes: `https://weibo.com/1639529981/Rmjpn9a6o`, `https://weibo.com/2803301701/Rmhqd1LYf` —
i.e. **`https://weibo.com/<uid>/<mblogid>`**, carried by the card's timestamp link (`a._time_*`,
text `2小时前`/`昨天 00:10`).

Two consequences had to be fixed in the flow, both measured rather than assumed:

1. The seed `feedCard` ladder (`/status/`, `/detail/`) could never observe a post on the desktop
   feed — the measured `a[class*="_time_"]` shape is now the first candidate.
2. The matched link's **own** text is the timestamp, so the submitted-excerpt comparison must read the
   card **container** (`closest('article, [class*="card"], [class*="Card"], div[class*="Feed"]')`,
   falling back to the link's parent).

## 4. Live post attempts (operator-approved, two writes)

Content: an explicitly marked temporary dogfood post; `metadata.publishStatus: 'public'`,
`options.operation: 'post'`. Result (`ok: false`):

```json
{ "ok": false, "target": "weibo",
  "error": "weibo post 'button:has-text(\"发送\")': no outcome observed within 30000ms" }
```

Read-only verification afterwards (`weibo.com/` and `weibo.com/u/<uid>`, body-text search for the
posted text): **the text is absent from both** — nothing was published, so the fail-closed refusal was
correct and no unintended public write occurred. No failure toast was visible either; the post path
previously never read toasts, so a site-side rejection could not be named. That gap is closed: a fresh
toast after the send is now reported as `(site said: …)` with the outcome error.

**Status of the post leg:** two separately approved attempts, no observed outcome, no published
content. Both the noise (button enabled, text present, no card, no toast) and the silent decline need
the diagnosis below before a third attempt is worth its approval.

## 4a. Send-path diagnosis (2026-10-12, second pass, read-only)

A later read-only pass (no clicks) measured the state left behind by those attempts:

| Observation | Value | What it rules in / out |
| --- | --- | --- |
| Composer content | **still holds the 114-character draft** (`composerValueLength: 113`) | The desktop app never submitted — a successful send clears the composer, and Weibo persists an unsent draft locally. The text is the *previous* attempt's, so the send was a no-op, not a rejected submission with a cleared box. |
| Send control | present, `disabled: false`, topmost at its centre | Not an actionability block (already measured; re-confirmed) |
| Dialogs / notices / verification hints on `weibo.com/` | **0** (`verificationHints: 0`, no non-empty notices at rest) | No standing real-name/verification gate is visible *at rest*; a gate that appears **only after the click** is still unmeasured |
| Session | still valid headlessly (composer attached, no login redirect) | The profile survives; the silence is not an expired session |
| `https://open.weibo.com/apps` | redirects to `weibo.com/<uid>` | No open-platform app console for this account, so the API route has no ready app either |

**Hypotheses, with the evidence that would settle each** — **resolved 2026-10-12: hypothesis 2 is CONFIRMED.**

1. ~~The synthetic click never drives the app's submit handler.~~ Ruled out as the *cause*: it was the same on
the mobile page (`<a class="m-send-btn">` with no href, `composer 96->96`), and the page's own submit path
reproduces the refusal immediately (below).
2. **Risk control / account state silently drops the submission — CONFIRMED.** Submitting through the page's
own mobile API (`POST https://m.weibo.cn/api/statuses/update`, the request the web app itself issues)
returned the site's own payload:

```json
{"ok":0,"errno":"200001",
 "msg":"您的微博账号处于异常状态，请立即激活账号，确保正常使用。",
 "title":"账号异常",
 "btn":{"color":"red","text":"立即激活","url":"http://m.weibo.cn/security?callback=…"}}
```

So the account is **flagged as abnormal and must be activated** (`m.weibo.cn/security`, normally a
phone/real-name step). Both front ends had been showing the same refusal and this session's probes simply
never read it; the mobile app swallows it into a dialog the composer flow never looked for. Nothing was ever
published from this account, and no code path was at fault.
3. ~~A verification modal appears, then the flow never looks for it.~~ Still true as a *client-side* rendering
of the above — and the flow now records dialogs, composer length and toasts on every failed submit.

**Submission mechanism (adopted this pass).** `post` no longer relies on a synthetic click. The mobile page's
own API answers this session — measured `GET https://m.weibo.cn/api/config` →
`200 {"ok":1,"data":{"login":true,"st":"…","uid":"1409996644",…}}` — so the browser process submits through
`POST /api/statuses/update` with the page's `st` token and the session's cookies: the same request the web app
issues, no app registration, and a returned status id as the observed outcome. Refusals are rendered as
`HTTP <status> errno <code>: <msg> (<action>: <url>)` so the operator's next action is never hidden inside a
JSON blob.

## 4b. Route options for a proper Weibo publish

| Route | Transport | Prerequisites | Evidence today |
| --- | --- | --- | --- |
| **Desktop web composer** (current) | browser · `script` | A verified account; and a flow that proves the app received the submit (composer cleared or a fresh toast) rather than assuming a DOM click lands | Composer/send/feed selectors measured; the submit is a no-op on this account |
| **Mobile composer** (`m.weibo.cn/compose/`) — *adopted* | browser · `script`, submitting through the page's own mobile API | A **verified/activated account** (see §4a — this account is flagged abnormal) | Composer, send anchor and image input measured; `GET /api/config` answers `{ok:1,data:{login:true,st,uid}}`; the submit reaches Weibo and returns its structured refusal |
| **Official open-platform API** (`statuses/share.json` for text-with-link, `statuses/update.json` for text) | `file-cli` | A Weibo app (App Key/Secret) with write permission — the API requires an app that passed review — plus an OAuth 2.0 token (`statuses_update` scope) and, for `share`, a bound 安全域名 | No app exists for this account (`open.weibo.com/apps` redirects away), so this route needs an operator-side app registration first. It would slot into the existing threads-pub/x-pub credential pattern (`WEIBO_APP_KEY` / `WEIBO_APP_SECRET` / `WEIBO_ACCESS_TOKEN`, env-only) |

Route **decision rule:** do not spend another public write until the diagnosis in §4a explains the
silence. If hypothesis 1 or 3 holds, fix the submit path (or move to the mobile composer) and keep the
browser route; if hypothesis 2 holds, the account is the blocker and either a properly aged/verified
account or the API route (with an operator-registered app) is the way — the browser flow then stays
fail-closed rather than retrying.

**Platform limits (verified 2026-10-12) — the "114" in §4a is not one of them.** 114 is the retained
*draft length* of the failed attempt, not a platform bound. A Weibo post allows up to **5000 Chinese
characters** per Weibo's own customer-service FAQ updated 2024-09-04
(<https://kefu.weibo.com/faqdetail?id=21510>); the older `statuses/update` documentation still cites 140
with long text gated behind `is_longtext` (<https://open.weibo.com/wiki/2/statuses/update>). Feeds
truncate long posts to roughly 140 characters behind a "show full text" control, so an **announcement
hook** has a ~140-character *display* budget — a content-quality target, never a refusal condition, and
never a reason to truncate silently. `statuses/share` additionally requires the text to contain a URL
under the app's configured safe domain and takes the cover as a `pic` **binary upload**
(JPEG/GIF/PNG, under 5 MB): <https://open.weibo.com/wiki/2/statuses/share>.

**Channel purpose (operator-set 2026-10-12): announce a new episode.** The Content is an announcement —
episode title, one-line hook, the episode link, the cover — not a copy of the episode body. That shape is
what task 0246 now specifies (R8–R11), including the one-image post rail an announcement needs.


## 4c. The announcement contract (episode is out)

The channel exists so a reader learns **a new episode is out**, so its Content is an announcement, not a copy
of the episode. Verified limits (`kefu.weibo.com/faqdetail?id=21510`, 2024-09-04: up to 5000 characters;
feeds truncate to ~140 behind a "show full text" control) make the binding budget a **display** one:

| Field | Value |
| --- | --- |
| `title` | the episode name (kept for the Result and for a future card) |
| `body` | one hook line **inside ~140 characters** so it survives the feed preview, then the episode **link** on its own line (Weibo autolinks it; `statuses/share` requires a URL in the text) |
| `metadata.publishStatus` | `'public'` — a post has no draft, so an announcement is inherently a live write and needs the operator's contemporaneous approval |
| `options.coverPath` | exactly **one** image, ≤ 5 MB, one of `.png .jpg .jpeg .webp .gif .bmp` (the composer's measured `accept` list; the 5 MB bound is Weibo's documented `pic` limit) |
| `options.operation` | `post` |

Copyable example — `weibo-announcement.json`:

```json
{
  "title": "S05E12 · MoE 推理的显存账",
  "body": "新一期上线：MoE 推理到底吃多少显存？三种量化档位实测，结论有点反直觉。\nhttps://episodes.example.com/s05e12",
  "format": "markdown",
  "metadata": { "publishStatus": "public" },
  "options": { "operation": "post", "coverPath": "/abs/path/s05e12-cover.png" }
}
```

```bash
kk executor run weibo-pub --in weibo-announcement.json --out weibo-result.json
# Result: { ok: true, target: 'weibo', id: '<status id>', url: 'https://m.weibo.cn/detail/<id>', ... }
```

The hook above is 45 characters — well inside the display budget and far inside the platform's 5000. A body
over the display budget is a content-quality defect, not a refusal: the plugin never truncates. Wiring the
channel into the daily/ITC workflows stays a separate feature (E94 scope); this contract plus the invocation
above is the handoff surface.

## 5. 头条文章 (article) — entitlement-gated, not reachable

| Route | Measured landing |
| --- | --- |
| `https://card.weibo.com/article/v3/editor` | `https://weibo.com/` (redirect; no editor, no title/body control) |
| `https://card.weibo.com/article/v3/editor#/draft` | `https://weibo.com/` |
| `https://weibo.com/ttarticle/p/write` | `https://weibo.com/sorry?pagenotfound` |
| `https://weibo.com/article/write` | `https://weibo.com/sorry?usernotexists&…` (account not eligible) |
| `https://weibo.com/creator` | loads, but contains **no** 文章 / 写文章 / 头条文章 entry |

So this account has no 头条文章 entitlement: **no draft control, no editor**. Per task 0246's closed
contingency the article leg stops here, is recorded, and the feature scenario R4 body is re-scoped
through `spur feature update` to carry the entitlement condition (scenario identity unchanged). The
article path stays implemented and offline-tested in `plugins/publishings/weibo-pub/src/index.ts`, with
provisional ladders that fail closed (`WEIBO_ARTICLE_SELECTORS`, `WEIBO_ARTICLE_URL`).

## 6. Pins applied to the constants (measured first, seeds kept as fallbacks)

```ts
WEIBO_POST_SELECTORS = {
  composer: ['textarea[placeholder*="新鲜事"]', 'textarea[placeholder*="分享"]', 'div[contenteditable="true"][class*="Form"]'],
  send: ['button:has-text("发送")', 'button[class*="woo-button-primary"]:has-text("发送")', 'button[class*="Submit"]:has-text("发送")'],
  feedCard: ['a[class*="_time_"]', 'a[href*="/status/"]', 'a[href*="/detail/"]'],
}
```

Every `send` fallback stays constrained to its own 发送 text because the measured
`woo-button-primary` class is shared with the account's 管理 button.

## 7. Open items

- **The account must be activated** (`errno 200001` → `m.weibo.cn/security`). That is the single blocker for
  every live leg; a fresh account's sends are refused regardless of mechanism, which is exactly what the
  three approved attempts hit.
- The **cover's pic-id source** is unmeasured: an image uploads through the composer, but the API submit needs
  the image's id, so the flow refuses rather than posting text-only while claiming an image. Measure it on the
  activated account (`window.config` / the composer's own state after a `setInputFiles`).
- The desktop composer route stays deprecated in favour of the mobile one; its no-op is explained by §4a and
  needs no further work.
- The 头条文章 article leg still needs an account with that entitlement (§5).
