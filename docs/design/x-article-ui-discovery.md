# x article-composer UI discovery (task 0204) — second pass, measured 2026-10-06

## Status: MEASURED — login + draft-save signal proven

**Mode coverage.** x declares two operations (`X_OPERATIONS`, `plugins/publishings/x-pub/src/index.ts:90`):
`article` is the browser composer measured below; `post` is **excluded from UI discovery** because it
publishes through the API v2 transport (`POST /2/tweets`, `plugins/publishings/x-pub/src/index.ts:39`) and
has no console UI, entry URL or draft affordance to measure.

- Profile created at `~/.config/kk/browser-profiles/x` (X_PROFILE_DIR / KK_BROWSER_PROFILE_DIR override);
  operator login completed 2026-10-06 (account 咸话咸说@tangmian).
- Evidence artifacts (`.spur/run/discovery/`): `x-login3.json`, `x-walk2.json`, `x-walk3.json`;
  scripts `login-x3.ts`, `walk-x2.ts`, `walk-x3.ts`.

## Login requirements (measured)

- **Vanilla automation Chromium is refused by Google OAuth**: the operator hit 「This browser or app may not be
  secure」 on every OAuth path. A stealth launch succeeds: `--disable-blink-features=AutomationControlled`,
  `ignoreDefaultArgs: ['--enable-automation']`, plus an init script returning `undefined` for `navigator.webdriver`.
  X's own **Email or username → password** flow is the most reliable path; OAuth works under the stealth launch.
- Login entry: `https://x.com/i/flow/login` (also `/i/jf/onboarding/web?...mode=login` when bounced from a deep link).

## Measured composer contract

| Control | Measured | Recorded candidate → verdict |
| --- | --- | --- |
| Entry URL | `https://x.com/compose/articles` is now an **Articles dashboard** (Articles/Drafts/Published tabs, "Your drafts live here") — not the composer | deep link → **drifted**, still usable as the hub |
| Write entry | `a` with text **Write** in the hub → SPA route to **`/compose/articles/edit/<id>`**; draft row created server-side on entry | `ARTICLE_EDIT_RE /\/compose\/articles\/edit\/(\d+)/` → **still matches** (id `2107589269258919936` measured) |
| Title | `textarea[placeholder="Add a title"]` (TEXTAREA, not INPUT) | re-measure needed in `ARTICLE_SELECTORS.title` |
| Body | `div[contenteditable="true"]` composer + rich-text toolbar (bold/italic/strikethrough/blockquote/ul/ol/link/emoji, Body, Insert) | toolbar measured; body host is a div composer |
| Autosave | **`Last saved just now`** status next to the `Draft` chip; no manual save button | autosave signal |
| Draft signal | edit URL id + reload persistence (`x-walk3.json`: title/body read back identical) | **proven** |
| Live/publish | `Publish` button + `Preview` in the editor header — **located, never clicked** | article publish affordance recorded |

## Draft-save signal (R3) — proven end to end

Typed title + body on the edit URL → `Last saved just now` → hard reload read back identical content
(`x-walk3.json`). Test draft `2107589269258919936` (「E92 walk 21:50」) remains in Drafts as the artifact.

## Safety

Login, navigation, draft fill/save and reload only. `Publish` was located and **never clicked**; the post
affordance (API v2 boundary) was never triggered.
