---
schema_version: 1
name: Substack publisher saves drafts via ts-browser-automation
status: todo
template: feature-impl
created_at: 2026-09-30T04:05:03.983Z
updated_at: "2026-09-30T05:08:47.493Z"
feature_id: E91
priority: P2
tags:
  - publish
  - browser
  - substack
estimate_hours: 4

dependencies: ["0183"]
---

## 0187. Substack publisher saves drafts via ts-browser-automation

### Background

`substack-pub` ships as a stub: `sessionReady` is never true in production, so every real run returns `login timeout`. This task replaces it with a script-driven Playwright flow over `@gobing-ai/ts-browser-automation` and the shared `@gobing-ai/publish-harness/browser` module from 0183.

Implements: R7 — Substack publisher saves a post draft through a persistent browser profile; R9 — Live publishing happens only on explicit request; R11 — Expired or missing sessions report a login instruction instead of a stack trace

Design satellite: `docs/design/browser-publish-channels.md` (ADR-027, feature E91). Selector seed: `/Users/robin/.claude/plugins/marketplaces/cc-agents/plugins/wt/skills/publish-to-substack/scripts/substack-playwright.ts` (wt skill, read-only reference; re-measure live).

**Refine corrections (2026-09-29)**

- "click the publish control only when `options.publish === true`" → no plugin uses `options.publish`; the existing live switch is `content.metadata.publishStatus === 'public'` (`plugins/publishings/xhs-pub/src/index.ts:618`, `plugins/publishings/wechatmp-pub/src/index.ts:319-321`) → R4 uses `publishStatus`; feature E91 R9 step and design E91-D5 corrected in the same refine.
- "depends on `@gobing-ai/ts-browser-automation`" implied available → `plugins/publishings/substack-pub/package.json` declares neither it nor `playwright`; the root holds only a catalog entry (`package.json:19-20`) and Bun's isolated store links declared deps only → R1 adds both as `catalog:` (precedent `plugins/publishings/xhs-pub/package.json`), Plan step 0 `bun install`.
- Existing tests assert the stub contract (`plugins/publishings/substack-pub/tests/substack-pub.test.ts:14,20,27` — agent default, `sessionReady`, agent/script parity) and `plugin.json` says "browser/agent transport" → those three cases are replaced, not kept; description updated (R6).
- "`checkChannelSession` headless preflight" → 0183 froze `{status, profileDir, detail}` with an optional headed retry → publish preflight passes `headedFallback: false`; `withProfilePage` defaults to headed, so the flow passes `headless` explicitly (default `false`, `options.headless === true` opt-in).
- "publication URL from `options.publicationUrl` or `SUBSTACK_PUBLICATION_URL`" → neither exists in code or `docs/04_DESIGN.md` env table today (`rg SUBSTACK_PUBLICATION_URL` → only this task); the seed falls back to `https://substack.com/new` when unset (`substack-playwright.ts:236-244`), which lands on an arbitrary publication → the URL is **required**: missing → `ok:false` before any browser; new env row added to 04.
- Seed draft buttons are guesses (`substack-playwright.ts:131-136`) while Substack autosaves and rewrites `/publish/post/new` to `/publish/post/<id>` → draft evidence is that URL rewrite; no draft-button click required.
- Substack's live path emails subscribers (`Send to everyone now`, `substack-playwright.ts:120-125`) → live stays behind `publishStatus: 'public'` and is excluded from the operator dogfood.

### Requirements

- [ ] R1. `plugins/publishings/substack-pub/package.json` adds `"@gobing-ai/ts-browser-automation": "catalog:"` and `"playwright": "catalog:"`; `SubstackBrowserTransport` becomes `kind: 'browser'`, `driver: 'script'` by default, and drives the Substack editor through upstream `withProfilePage` after a headless `checkChannelSession` preflight.
- [ ] R2. Title and body are filled via the shared helpers: ProseMirror rich text → `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))`.
- [ ] R3. A draft run (default) returns `ok: true`, `publishStatus: 'draft'`, and the observed draft URL (and id when the URL carries one) only when `expectOutcome` observes the draft signal; no signal → `ok: false` naming the label and timeout.
- [ ] R4. The live control is clicked only when `content.metadata.publishStatus === 'public'`; any value other than absent/`'draft'`/`'public'` → `ok: false` before opening a browser.
- [ ] R5. `src/profile-check.ts` runs `runProfileCli(channelConfig(publicationUrl), argv)` (publication from `--publication` or `SUBSTACK_PUBLICATION_URL`) (login/check); profile precedence `options.profileDir` / `--profile` > `SUBSTACK_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > default, via `resolveChannelProfileDir`. A refused/missing session returns `ok: false` whose error names `bun plugins/publishings/substack-pub/src/profile-check.ts login`, with the profile dir path only — no cookie, token, or stack in the Result.
- [ ] R6. `driver: 'agent'` fails fast with `unsupported driver 'agent' for substack` (xhs precedent `plugins/publishings/xhs-pub/src/index.ts:607`); `getPublishTransport()` defaults to `'script'` and the fake branch returns `FakeBrowserTransport('script')`; `plugin.json` description says "script browser transport (ts-browser-automation)"; `docs/04_DESIGN.md` "Leftover CMS browser plugins" section (~:506-512) documents the substack flow, CLI and env.

Out of scope: tags/cover/category beyond what R2-R4 name; an automation guard (E91-D7); selectors in the shared module (E91-D3); CI against the live site.

### Acceptance Criteria

- [ ] AC1 — Substack publisher saves a post draft through a persistent browser profile (req: R1, R2, R3, R5)
- [ ] AC2 — Live publishing happens only on explicit request (req: R4)
- [ ] AC3 — Expired or missing sessions report a login instruction instead of a stack trace (req: R5, R6)

Task-local check: the fake-launcher test in `plugins/publishings/substack-pub/tests/substack-pub.test.ts` proves the live control is never clicked on a draft run and that an unobserved draft signal yields `ok: false`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T05:08:22.293Z

- **Q: Live switch field?** Closed: `content.metadata.publishStatus === 'public'`, same as xhs/wechatmp; `options.publish` rejected (would be a third convention).
- **Q: Headed or headless publish run?** Closed: headed by default (sites bot-wall headless; upstream default), `options.headless === true` opt-in; preflight is headless-only.
- **Q: Keep the stub-contract tests?** Closed: no — they assert the `agent` default and `sessionReady` that E91-D1 removes.
- Deferred: selector/URL drift beyond the dogfood re-measure — owner Robin, trigger: a draft run returns `ok:false` with a selector timeout.
- **Q: Default publication when the URL is unset?** Closed: none — fail fast; `substack.com/new` picks an arbitrary publication.

### Design

Approach: site-owned flow in `plugins/publishings/substack-pub/src/index.ts` over the 0183 helpers (E91-D2/D3). Reason: selectors drift per site and must live where they are tested; plumbing is shared.

Assumed from 0183 (frozen there): `ChannelBrowserConfig`, `resolveChannelProfileDir`, `checkChannelSession`, `runProfileCli`, `pasteHtml`, `fillCodeMirror`, `expectOutcome`, `markdownToHtml`, `waitUntil` from `@gobing-ai/publish-harness/browser`. Do not fork local copies; signature gaps go back to 0183's module in this change.

Frozen names (`src/index.ts`):

```ts
export const CHANNEL = 'substack';
export function editorUrl(publicationUrl: string): string;   // `${base}/publish/post/new`, base = URL without trailing '/' or '/publish'
export const LOGIN_URL_RE = /(\/sign-in|substack\.com\/account\/login)/
export const SELECTORS = { /* see table */ } as const;
export function channelConfig(publicationUrl: string): ChannelBrowserConfig; // { channel: CHANNEL, homeUrl: editorUrl(u), isAuthenticated, loginTimeoutMs: 180_000 }
export const isAuthenticated: IsAuthenticatedPredicate; // !LOGIN_URL_RE.test(page.url()) && SELECTORS.title attached
export class SubstackBrowserTransport implements PublishTransport {
    readonly kind = 'browser';
    constructor(driver?: BrowserDriver /* 'script' */, deps?: { launcher?: BrowserLauncher; stepTimeoutMs?: number /* 30_000 */ });
}
export function getPublishTransport(driver?: BrowserDriver /* 'script' */): PublishTransport;
```

Selectors (seeded from the wt script; the dogfood re-measures):

```
title:    ['[data-testid="title-input"]', 'textarea[placeholder="Title"]', 'input[placeholder="Title"]']   // seed :84-90
subtitle: ['[data-testid="subtitle-input"]', 'textarea[placeholder="Add a subtitle..."]']   // metadata.subtitle, optional
body:     ['.ProseMirror[contenteditable="true"]']
continue: ['[data-testid="continue-button"]', 'button:has-text("Continue")']
send:     ['[data-testid="publish-button"]', 'button:has-text("Send to everyone now")', 'button:has-text("Publish now")']
```

Publication URL: `options.publicationUrl ?? process.env.SUBSTACK_PUBLICATION_URL`; `profile-check.ts` reads the env (or `--publication <url>`, passed through as `argv` after stripping) and calls `runProfileCli(channelConfig(url), rest)`.

Flow: validate driver → validate `publishStatus` → Pre-validation (before the browser): publication URL present and parses as `https:`, else `ok:false` naming `SUBSTACK_PUBLICATION_URL`. → resolve profile → `checkChannelSession(channelConfig(publicationUrl), {profileDir, launcher, headedFallback: false})` → `withProfilePage({profileDir, url: editorUrl(publicationUrl), isAuthenticated, headless: options.headless === true, launcher, timeoutMs}, fn)` where fn = fill title → optional subtitle → pasteHtml(body) → expectOutcome(draft) → if public: click `continue` → click `send` → expectOutcome(live).

Draft signal: probe returns `page.url()` when it matches `/\/publish\/post\/(\d+)/` (id = capture), else null.
Live signal: probe returns the URL when it matches `/\/p\/[^/?#]+/` or `/\/publish\/posts\/published/`, else null.

Result: `{ ok, target: 'substack', id?, url?, message, metadata: { driver: 'script', publishStatus, profileDir } }`. Helper errors and upstream typed errors (`BrowserProfileMissingError`, `LoginTimeoutError`, `PlaywrightUnavailableError`) map to `ok:false` one-liners; the login hint is appended for session errors.

Anti-patterns: success after a sleep or click without a probe (E91-D6); clicking any live control on a draft run (E91-D5, invariant 4); logging page HTML/cookies; retrying submit loops; copying the wt script's `console.log` style (use Result/`echoError`).

Test layer: `plugins/publishings/substack-pub/tests/substack-pub.test.ts` with a fake `BrowserLauncher` whose context/page records `click`/`fill`/`evaluate` calls and scripts URL/toast changes. Asserts: draft run never clicks live selectors; missing signal → `ok:false`; session refused → login hint and no stack; agent driver → unsupported; invalid `publishStatus` → fail with zero launcher calls. Existing `processPublishIO` / `main` / `runInvoke` cases stay, switched to `FakeBrowserTransport('script')`.

Handoff: none downstream. Independent of 0184 and the other channel tasks (touch disjoint plugin dirs; shared-module changes coordinate through 0183's file).

### Plan

- [ ] 0. Precondition: 0183 merged; add the two `catalog:` deps to `plugins/publishings/substack-pub/package.json`; `bun install`. (R1)
- [ ] 1. Write the failing tests first (replace `tests/substack-pub.test.ts:14,20,27`): draft happy path with observed signal; no signal → fail; live only on `public`; invalid `publishStatus`; refused session → hint; agent driver; profile precedence incl. `SUBSTACK_PROFILE_DIR`. (R2-R6)
- [ ] 2. Implement constants, `SELECTORS`, `CONFIG`, `isAuthenticated`, transport flow, `getPublishTransport`. (R1-R4, R6)
- [ ] 3. Add `src/profile-check.ts` over `runProfileCli`. (R5)
- [ ] 4. `plugin.json` description; `docs/04_DESIGN.md` substack paragraph + env rows. (R6)
- [ ] 5. `bun run lint`, `bun run test`, `bun run build`.
- [ ] 6. Operator dogfood (not CI, recorded in Testing): `profile-check.ts login` → `check` → one draft run; re-measure `EDITOR_URL`, selectors, and the draft signal; update constants if they drifted. Never run the live path in dogfood.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
