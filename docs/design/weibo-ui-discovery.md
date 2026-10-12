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

**Hypotheses, with the evidence that would settle each** (none is confirmed):

1. **The synthetic click never drives the app's submit handler.** Favoured by the total absence of
   feedback and the retained draft; a real submission that Weibo rejected would normally toast.
   *Settles it:* a post-click snapshot (dialog/modal text, composer length before/after, toast list).
2. **Risk control silently drops the submission** for a brand-new, unverified account. Consistent with
   the silence, but it would usually surface an error toast. *Settles it:* the same snapshot, plus the
   account's standing (age, phone/real-name verification, any 异常/受限 notice on the timeline).
3. **A verification modal appears, then the flow never looks for it.** The existing flow probes cards
   and toasts only, so a modal would be invisible to it. *Settles it:* the same snapshot — this is the
   first thing the re-implementation must capture.

## 4b. Route options for a proper Weibo publish

| Route | Transport | Prerequisites | Evidence today |
| --- | --- | --- | --- |
| **Desktop web composer** (current) | browser · `script` | A verified account; and a flow that proves the app received the submit (composer cleared or a fresh toast) rather than assuming a DOM click lands | Composer/send/feed selectors measured; the submit is a no-op on this account |
| **Mobile web composer** (`m.weibo.cn`) — *unmeasured candidate* | browser · `script` | Same account requirement; no separate entitlement | Not measured at all. Its composer is a simpler, API-backed page (`/compose/`), so it is the cheapest next measurement if the desktop handler is the blocker |
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

- One more explicitly approved live post attempt (fresh approval) to determine whether this account can
  publish at all; if it cannot, the post leg of R5 stays unverified with this note as the evidence.
- The article draft/live legs need an account **with** the 头条文章 entitlement; the selectors there
  remain unmeasured, which the code states in its own TSDoc.
