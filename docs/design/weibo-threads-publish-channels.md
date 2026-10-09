# Weibo + Threads publish channels (E94)

**Status:** proposed (E94) · **Parent:** E9 · **Template:** `plugins/publishings/x-pub` ·
**Binding decisions:** ADR-027 (browser channels on ts-browser-automation), E91-D5 (draft by
default), E91-D6 (success only from an observed signal), ADR-032 (`check` profile probe).

Two new `kind: publish` plugins built from the x-pub split: **the official API where one is usable,
a script browser flow otherwise**. No new shared harness code, no new dependencies.

| Channel | Plugin | Operations | Transport | Auth |
| --- | --- | --- | --- | --- |
| Threads | `plugins/publishings/threads-pub` | `post` | Official Threads API (file-cli, like `XPostApiTransport`) | `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` |
| Weibo | `plugins/publishings/weibo-pub` | `post`, `article` | Script driver on `@gobing-ai/publish-harness/browser` (like `XArticleBrowserTransport`) | Persistent profile: `--profile` > `WEIBO_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > default |

## 1. Transport verdict (why the split)

- **Threads → API.** Meta publishes a two-step text-post API: `POST /{threads-user-id}/threads`
  (`media_type=TEXT`, `text`) returns a container id, then `POST /{threads-user-id}/threads_publish`
  (`creation_id`) returns the media id. Text cap is 500 characters. Sources:
  <https://developers.facebook.com/docs/threads/posts/>,
  <https://developers.facebook.com/documentation/threads/reference/publishing>. A browser path adds
  bot-detection risk for no capability gain → **no browser fallback** (R11).
- **Weibo → browser.** The open-platform `statuses/share` endpoint requires an approved app and a
  bound safe-domain URL embedded in every post (<https://v2ex.com/t/379387>), which makes it
  unusable for arbitrary content. The weibo.com composer and the 头条文章 editor are the only
  general-purpose paths → script driver, same rails as x-article / xhs / wechatmp.

## 2. threads-pub

```
Content(text | markdown body) ──► resolveOperation('post') ──► ThreadsPostApiTransport
   POST https://graph.threads.net/v1.0/{THREADS_USER_ID}/threads  {media_type:TEXT, text, access_token}
   → { id: creationId }
   POST https://graph.threads.net/v1.0/{THREADS_USER_ID}/threads_publish {creation_id, access_token}
   → { id: mediaId }  ──► Result { ok:true, target:'threads', id: mediaId, url?: permalink }
```

- **Text source:** `content.body.trim() || content.title` (as x-pub; `Content` has no `text` field); reject (ok false) when
  empty, or when longer than 500 characters — no silent truncation (R2).
- **Preflight (R2):** missing `THREADS_ACCESS_TOKEN` / `THREADS_USER_ID` → `ok:false` naming the
  missing env; no network call, never a browser.
- **Errors (R3):** non-2xx → `ok:false` with HTTP status and the Graph `error.message`; the token
  goes in the form body on POSTs (query param only on the permalink GET) and is redacted from every
  error string, log line and Result. Timeout uses the
  shared `REQUEST_TIMEOUT_MS = 120_000` pattern from x-pub.
- **Permalink:** best-effort `GET /{mediaId}?fields=permalink`; failure leaves `url` unset and
  does not flip `ok` (the publish already happened).
- **Deferred (R11):** `metadata.images` / any `driver` option → `ok:false` stating threads-pub
  posts text only. No `check` script (API channel, nothing to probe beyond env presence — same as
  x-pub post).

## 3. weibo-pub

Mirrors `XArticleBrowserTransport` (`plugins/publishings/x-pub/src/index.ts:260`):
`ChannelBrowserConfig` + `checkChannelSession` preflight + `withProfilePage` + `resolveSelector`
selector ladders + `expectOutcome` observed-signal success.

| Op | Entry URL | Draft path (default) | Live path (`publishStatus:'public'`) | Success signal |
| --- | --- | --- | --- | --- |
| `post` | `https://weibo.com` home composer | **Refused before the browser opens** — the web composer has no draft | fill composer → 发送 | new feed card / toast observed; status id from the card link |
| `article` | 头条文章 editor (`https://card.weibo.com/article/v3/editor` — provisional, pinned by 0246) | title + `pasteHtml(markdownToHtml(body))` + optional cover via `uploadFile` → **保存草稿** | same, then 发布 | 保存成功 toast (draft) / article URL (live) |

- **Draft-by-default (E91-D5, R4/R5):** only `metadata.publishStatus === 'public'` clicks a live
  button. A `post` run without it returns `ok:false` *"weibo post has no draft; set
  publishStatus: public"* — refusing is safer than silently going live.
- **Session preflight (R6):** `checkChannelSession` headless probe; unauthenticated (login-URL
  redirect / missing composer) → `ok:false` with the login instruction
  `bun plugins/publishings/weibo-pub/src/profile-check.ts login`; no headed window opens.
- **profile-check (R7):** `src/profile-check.ts login|check` via `runProfileCli`, profile resolved
  by `resolveChannelProfileDir('weibo', …)`; exit 0 authenticated / 1 not authenticated /
  2 usage error. `plugin.json` declares `"check": "./src/profile-check.ts"` (ADR-032).
- **Operation/driver gate (R8):** `resolveOperation` accepts `post|article`; the driver is a
  constructor / `getPublishTransport` seam (as x-pub, xhs-pub) accepting `script` only (`agent` fails fast). Unknown values are refused by name.
- **Selectors:** `WEIBO_POST_SELECTORS` / `WEIBO_ARTICLE_SELECTORS` exported constants with
  ordered fallbacks; the live operator dogfood (task 4) pins them and records the discovery note at
  `docs/design/weibo-ui-discovery.md` (same pattern as `x-article-ui-discovery.md`).

## 4. Shared rails

- **Fake transport (R9):** `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` → `getPublishTransport` returns
  the publish-harness fake for both plugins; all tests run offline.
- **IO:** `main()` → `processPublishIO(--in, --out)` unchanged from x-pub.
- **Registration (R10):** add `threads` and `weibo` wherever channels are enumerated —
  `packages/kk-core/tests/registry.test.ts`, `apps/cli/tests/commands/plugin-check.test.ts`
  (weibo only; threads has no `check`), `plugins/kk/skills/publish/SKILL.md` channel + env tables,
  `docs/03_ARCHITECTURE.md` channel list, `docs/04_DESIGN.md` index rows. Per-plugin 04 sections, the
  profile-env row and verdict rows ship with each plugin (0243/0244, T3).

## 5. Out of scope

Threads media/carousel posts and long-lived-token refresh; any Threads browser path; the Weibo
share API; new harness helpers or dependencies; wiring into daily / itc workflows
(`plugins/kk/scripts/itc-stages.ts`); an ADR-025 rate cap.

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Weibo DOM churn breaks selectors | Selector ladders + live dogfood task; failures surface as `ok:false` naming the step, never false success (E91-D6) |
| Weibo risk-control (captcha / 安全验证) mid-flow | Detected as an unobserved success signal → `ok:false`; operator re-runs `login` headed |
| Threads token expiry (60-day long-lived) | Graph 190 error surfaced verbatim (redacted); refresh is out of scope |
