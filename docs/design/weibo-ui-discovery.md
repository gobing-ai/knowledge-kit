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

## 4. Live post attempt (operator-approved, one write)

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

**Status of the post leg:** one approved attempt, no observed outcome, no published content. A second
attempt needs fresh operator approval; the measured noise (button enabled, text present, no card, no
toast) is consistent with Weibo silently declining the send for this brand-new account.

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
