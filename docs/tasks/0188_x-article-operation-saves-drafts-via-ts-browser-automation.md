---
schema_version: 1
name: X article operation saves drafts via ts-browser-automation
status: todo
template: feature-impl
created_at: 2026-09-30T04:05:03.984Z
updated_at: "2026-09-30T05:09:54.192Z"
feature_id: E91
priority: P2
tags:
  - publish
  - browser
  - x
estimate_hours: 4

dependencies: ["0183"]
---

## 0188. X article operation saves drafts via ts-browser-automation

### Background

`x-pub` `article` ships as a stub (`XArticleBrowserTransport`, `sessionReady` never true in production → every real run returns `login timeout`). This task replaces it with a script-driven Playwright flow over `@gobing-ai/ts-browser-automation` and the shared `@gobing-ai/publish-harness/browser` module from 0183. The `post` operation keeps the official API.

Implements: R8 — X article mode saves a long-form draft while post mode keeps the official API; R9 — Live publishing happens only on explicit request; R11 — Expired or missing sessions report a login instruction instead of a stack trace

Design satellite: `docs/design/browser-publish-channels.md` (ADR-027, feature E91). Selector seed: `/Users/robin/.claude/plugins/marketplaces/cc-agents/plugins/wt/skills/publish-to-x/scripts/x-article-playwright.ts` (wt skill, read-only reference; re-measure live).

**Refine corrections (2026-09-29)**

- "click the publish control only when `options.publish === true`" → no plugin uses `options.publish`; the live switch is `content.metadata.publishStatus === 'public'` (`plugins/publishings/xhs-pub/src/index.ts:618`, `plugins/publishings/wechatmp-pub/src/index.ts:319-321`) → R4 uses `publishStatus`; feature E91 R9 step and E91-D5 corrected.
- "profile precedence `--profile` > `X_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR`" → the stub resolves `options.profileDir ?? X_PROFILE_DIR` only (`plugins/publishings/x-pub/src/index.ts:145-148`) although `docs/04_DESIGN.md:397` already lists x-pub article under `KK_BROWSER_PROFILE_DIR` → adopting `resolveChannelProfileDir('x', …)` makes code match the documented surface.
- "cover via `uploadFile`" with no source named → `ContentSchema` has no cover field (`packages/kk-core/src/schemas.ts`) → cover path = `options.coverPath ?? content.metadata.coverImage` (existing naming: `plugins/publishings/podcast-pub/src/index.ts:200`, `src/map.ts:20`), optional, validated before the browser.
- Fake branch returns `FakeBrowserTransport('agent')` (`plugins/publishings/x-pub/src/index.ts:166`) and the test asserts the agent stub (`plugins/publishings/x-pub/tests/x-pub.test.ts:101-115,128`) → fake switches to `'script'`; that stub test is replaced.
- `x-pub/package.json` declares neither `@gobing-ai/ts-browser-automation` nor `playwright`; root has only catalog entries (`package.json:19-20`) → R1 adds both `catalog:`, Plan step 0 `bun install`. The `post` path must not load them: `XPostApiTransport` stays importable without touching Playwright at module load (upstream imports playwright lazily; verified by the post-path test running with no browser).
- Seed success detection is "URL no longer contains `/edit/`" after clicks and JS-click retries (`x-article-playwright.ts:831-889`) → draft evidence is the positive `/compose/articles/edit/<id>` URL; live evidence is a URL leaving `/edit/` that carries the article id (E91-D6). No JS-click retry loops.

### Requirements

- [ ] R1. `plugins/publishings/x-pub/package.json` adds `"@gobing-ai/ts-browser-automation": "catalog:"` and `"playwright": "catalog:"`; `XArticleBrowserTransport` becomes `kind: 'browser'`, `driver: 'script'` by default, and drives `https://x.com/compose/articles` through upstream `withProfilePage` after a headless `checkChannelSession` preflight.
- [ ] R2. The flow clicks the write control, fills the title, inserts the body with `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))` (Draft.js editor), and, when a cover path is given (`options.coverPath ?? content.metadata.coverImage`), uploads it with `uploadFile`. A given cover that is not an absolute path to an existing `.png|.jpg|.jpeg|.webp` file → `ok: false` before opening a browser.
- [ ] R3. A draft run (default) returns `ok: true`, `metadata: {operation: 'article', driver: 'script', publishStatus: 'draft', profileDir}`, `url` = observed `/compose/articles/edit/<id>` URL and `id` = `<id>`, only when `expectOutcome` observes it; otherwise `ok: false`.
- [ ] R4. The publish control is clicked only when `content.metadata.publishStatus === 'public'`; any value other than absent/`'draft'`/`'public'` → `ok: false` before opening a browser.
- [ ] R5. `src/profile-check.ts` runs `runProfileCli(ARTICLE_CONFIG, Bun.argv.slice(2))`; profile precedence `options.profileDir` / `--profile` > `X_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > default via `resolveChannelProfileDir('x', …)`. A refused/missing session returns `ok: false` naming `bun plugins/publishings/x-pub/src/profile-check.ts login`, profile dir path only — no cookie, token, or stack.
- [ ] R6. The `post` operation keeps `XPostApiTransport` (API v2, OAuth1) byte-for-byte and never opens a browser; `resolveOperation` (`src/index.ts:66`) unchanged.
- [ ] R7. `driver: 'agent'` fails fast `unsupported driver 'agent' for x article`; `getPublishTransport('article')` fake branch returns `FakeBrowserTransport('script')`; `plugin.json` description → "post via official tweets API; article via script browser transport (ts-browser-automation)"; `docs/04_DESIGN.md` x-pub table (:497-504) row `XArticleBrowserTransport` → `browser` / `driver: script`, plus a paragraph for the article flow, CLI, cover input.

Out of scope: browser posting for `post` (X Automation Rules); an automation guard (E91-D7 — X is the first candidate when a warning arrives); inline images inside the article body; scheduling.

### Acceptance Criteria

- [ ] AC1 — X article mode saves a long-form draft while post mode keeps the official API (req: R1, R2, R3, R5, R6)
- [ ] AC2 — Live publishing happens only on explicit request (req: R4)
- [ ] AC3 — Expired or missing sessions report a login instruction instead of a stack trace (req: R5, R7)

Task-local check: the fake-launcher test in `plugins/publishings/x-pub/tests/x-pub.test.ts` proves the publish control is never clicked on a draft run and that an unobserved draft signal yields `ok: false`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T05:09:54.191Z

- **Q: Live switch field?** Closed: `content.metadata.publishStatus === 'public'` (xhs/wechatmp convention); `options.publish` rejected.
- **Q: Cover source?** Closed: `options.coverPath ?? content.metadata.coverImage` (podcast-pub naming); optional; validated before the browser.
- **Q: Add `KK_BROWSER_PROFILE_DIR` for x?** Closed: yes — 04 already documents it; code catches up. Profile dir default (`…/browser-profiles/x`) unchanged.
- **Q: Automation guard for X?** Closed: not in this feature (E91-D7). X is the first candidate; trigger = any automated-activity warning on the account.
- **Q: Headed or headless publish run?** Closed: headed default, `options.headless === true` opt-in; preflight headless-only.

### Design

Approach: site-owned flow in `plugins/publishings/x-pub/src/index.ts` over the 0183 helpers (E91-D2/D3), replacing only `XArticleBrowserTransport` and the article branch of `getPublishTransport`.

Assumed from 0183 (frozen there): `ChannelBrowserConfig`, `resolveChannelProfileDir`, `checkChannelSession`, `runProfileCli`, `pasteHtml`, `uploadFile`, `expectOutcome`, `markdownToHtml` from `@gobing-ai/publish-harness/browser`. Do not fork local copies.

Frozen names (`src/index.ts`, additions):

```ts
export const ARTICLE_CHANNEL = 'x';                       // profile dir …/browser-profiles/x (unchanged)
export const X_ARTICLES_URL = 'https://x.com/compose/articles';
export const ARTICLE_EDIT_RE = /\/compose\/articles\/edit\/(\d+)/;
export const LOGIN_URL_RE = /(\/i\/flow\/login|\/login)/;
export const ARTICLE_SELECTORS = { write, title, body, addPhotos, fileInput, publish } as const;
export const isArticleAuthenticated: IsAuthenticatedPredicate; // !LOGIN_URL_RE.test(url) && (write || title) attached
export const ARTICLE_CONFIG: ChannelBrowserConfig;       // { channel: 'x', homeUrl: X_ARTICLES_URL, isAuthenticated: isArticleAuthenticated, loginTimeoutMs: 180_000 }
export class XArticleBrowserTransport implements PublishTransport {
    readonly kind = 'browser';
    constructor(driver?: BrowserDriver /* 'script' */, deps?: { launcher?: BrowserLauncher; stepTimeoutMs?: number /* 30_000 */ });
}
```

Selectors (seed `x-article-playwright.ts:143-187`; trimmed to data-testid/placeholder first, re-measured in dogfood):

```
write:     ['[data-testid="empty_state_button_text"]', 'button:has-text("Write")', '[aria-label*="Write" i]']
title:     ['textarea[placeholder="Add a title"]', '[data-testid="twitter-article-title"]']
body:      ['.DraftEditor-editorContainer [contenteditable="true"]', 'div[role="textbox"]']
addPhotos: ['[data-testid="addPhotoButton"]', 'button[aria-label*="Add photos" i]']
fileInput: ['[data-testid="fileInput"]', 'input[type="file"][accept*="image"]']
publish:   ['[data-testid="publishButton"]', 'button:has-text("Publish")']
```

(`tweetButton`/`Tweet` from the seed are dropped — they belong to the post composer and would risk a tweet.)

Flow: validate driver → validate `publishStatus` → validate cover (if given) → `resolveChannelProfileDir('x', options.profileDir)` → `checkChannelSession(ARTICLE_CONFIG, {profileDir, launcher, headedFallback: false})` → `withProfilePage({profileDir, url: X_ARTICLES_URL, isAuthenticated: isArticleAuthenticated, headless: options.headless === true, launcher, timeoutMs}, fn)`; fn = click `write` → fill `title` (`content.title ?? 'Untitled'`) → `pasteHtml(body)` → cover: click `addPhotos` if present, `uploadFile(fileInput, cover)` → `expectOutcome(() => ARTICLE_EDIT_RE match ? url : null, {label: 'x article draft'})` → if public: click `publish`, then `expectOutcome` for a URL that no longer matches `ARTICLE_EDIT_RE` and matches `/\/articles?\/(\d+)/`.

Result mapping and errors as 0185 (typed upstream errors → `ok:false` one-liners; session errors append the login hint). `metadata.operation: 'article'` always present.

Anti-patterns: touching `XPostApiTransport`, `oauth1Header`, or `resolveOperation`; any browser fallback for `post`; JS-click retry loops on publish (seed :831-889); clicking `publish` on a draft run; importing `playwright` values at module top level in `index.ts` (keeps `post` runs browser-free).

Test layer: `plugins/publishings/x-pub/tests/x-pub.test.ts` — replace the stub case (:101-115) with fake-launcher cases: draft URL observed → ok with id; no edit URL → fail; draft never clicks `publish`; public clicks `publish` and needs the post-edit URL; cover validation failures with zero launcher calls; refused session → hint; agent → unsupported; profile precedence incl. `KK_BROWSER_PROFILE_DIR`. Existing post/OAuth tests stay untouched; fake-switch test (:117-125) and processPublishIO article test (:127+) keep asserting `FakeBrowserTransport`, constructed with `'script'`.

Handoff: none downstream. Independent of 0184-0187.

### Plan

- [ ] 0. Precondition: 0183 merged; add the two `catalog:` deps to `plugins/publishings/x-pub/package.json`; `bun install`. (R1)
- [ ] 1. Write failing tests first, replacing `tests/x-pub.test.ts:101-115`: draft observed/unobserved, live gating, publishStatus validation, cover validation, session refusal hint, agent driver, profile precedence; confirm existing post tests are untouched. (R2-R7)
- [ ] 2. Implement constants, selectors, `ARTICLE_CONFIG`, transport flow; switch the fake branch to `'script'`. (R1-R4, R7)
- [ ] 3. Add `src/profile-check.ts` over `runProfileCli`. (R5)
- [ ] 4. `plugin.json` description; `docs/04_DESIGN.md` x-pub table row + article paragraph; env row :397 already lists x-pub article (verify wording). (R7)
- [ ] 5. `bun run lint`, `bun run test`, `bun run build`; `git diff` shows no change inside `XPostApiTransport`. (R6)
- [ ] 6. Operator dogfood (not CI, recorded in Testing): `profile-check.ts login` → `check` → one draft run with and without a cover; re-measure selectors and the edit-URL pattern. Never run the live path in dogfood.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
