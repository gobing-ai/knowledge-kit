---
schema_version: 1
name: InfoQ publisher saves drafts via ts-browser-automation
status: todo
template: feature-impl
created_at: 2026-09-30T04:05:03.981Z
updated_at: "2026-09-30T05:08:34.892Z"
feature_id: E91
priority: P2
tags:
  - publish
  - browser
  - infoq
estimate_hours: 4

dependencies: ["0183"]
---

## 0185. InfoQ publisher saves drafts via ts-browser-automation

### Background

`infoq-pub` ships as a stub: `sessionReady` is never true in production, so every real run returns `login timeout`. This task replaces it with a script-driven Playwright flow over `@gobing-ai/ts-browser-automation` and the shared `@gobing-ai/publish-harness/browser` module from 0183.

Implements: R5 — InfoQ publisher saves an article draft through a persistent browser profile; R9 — Live publishing happens only on explicit request; R11 — Expired or missing sessions report a login instruction instead of a stack trace

Design satellite: `docs/design/browser-publish-channels.md` (ADR-027, feature E91). Selector seed: `/Users/robin/.claude/plugins/marketplaces/cc-agents/plugins/wt/skills/publish-to-infoq/scripts/infoq-playwright.ts` (wt skill, read-only reference; re-measure live).

**Refine corrections (2026-09-29)**

- "click the publish control only when `options.publish === true`" → no plugin uses `options.publish`; the existing live switch is `content.metadata.publishStatus === 'public'` (`plugins/publishings/xhs-pub/src/index.ts:618`, `plugins/publishings/wechatmp-pub/src/index.ts:319-321`) → R4 uses `publishStatus`; feature E91 R9 step and design E91-D5 corrected in the same refine.
- "depends on `@gobing-ai/ts-browser-automation`" implied available → `plugins/publishings/infoq-pub/package.json` declares neither it nor `playwright`; the root holds only a catalog entry (`package.json:19-20`) and Bun's isolated store links declared deps only → R1 adds both as `catalog:` (precedent `plugins/publishings/xhs-pub/package.json`), Plan step 0 `bun install`.
- Existing tests assert the stub contract (`plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:14,20,27` — agent default, `sessionReady`, agent/script parity) and `plugin.json` says "browser/agent transport" → those three cases are replaced, not kept; description updated (R6).
- "`checkChannelSession` headless preflight" → 0183 froze `{status, profileDir, detail}` with an optional headed retry → publish preflight passes `headedFallback: false`; `withProfilePage` defaults to headed, so the flow passes `headless` explicitly (default `false`, `options.headless === true` opt-in).
- "drives the xie.infoq.cn write page" (single URL) → the seed tries three editor URLs (`infoq-playwright.ts:545-547`: `/write`, `/write/article/new`, `/article/create`) and returns `page.url()` after a 3 s sleep as "success" (`:384-390`) → EDITOR_URL frozen to `https://xie.infoq.cn/write` with a re-measure step; success needs an observed signal (E91-D6).
- InfoQ's non-draft control is `提交` = submit for editorial review, not publish (`infoq-playwright.ts:59-61,370`) → live path reports `message: 'submitted for InfoQ editorial review'`, `publishStatus: 'public'`.

### Requirements

- [ ] R1. `plugins/publishings/infoq-pub/package.json` adds `"@gobing-ai/ts-browser-automation": "catalog:"` and `"playwright": "catalog:"`; `InfoqBrowserTransport` becomes `kind: 'browser'`, `driver: 'script'` by default, and drives the InfoQ editor through upstream `withProfilePage` after a headless `checkChannelSession` preflight.
- [ ] R2. Title and body are filled via the shared helpers: ProseMirror rich text → `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))`.
- [ ] R3. A draft run (default) returns `ok: true`, `publishStatus: 'draft'`, and the observed draft URL (and id when the URL carries one) only when `expectOutcome` observes the draft signal; no signal → `ok: false` naming the label and timeout.
- [ ] R4. The live control is clicked only when `content.metadata.publishStatus === 'public'`; any value other than absent/`'draft'`/`'public'` → `ok: false` before opening a browser.
- [ ] R5. `src/profile-check.ts` runs `runProfileCli(CONFIG, Bun.argv.slice(2))` (login/check); profile precedence `options.profileDir` / `--profile` > `INFOQ_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > default, via `resolveChannelProfileDir`. A refused/missing session returns `ok: false` whose error names `bun plugins/publishings/infoq-pub/src/profile-check.ts login`, with the profile dir path only — no cookie, token, or stack in the Result.
- [ ] R6. `driver: 'agent'` fails fast with `unsupported driver 'agent' for infoq` (xhs precedent `plugins/publishings/xhs-pub/src/index.ts:607`); `getPublishTransport()` defaults to `'script'` and the fake branch returns `FakeBrowserTransport('script')`; `plugin.json` description says "script browser transport (ts-browser-automation)"; `docs/04_DESIGN.md` "Leftover CMS browser plugins" section (~:506-512) documents the infoq flow, CLI and env.

Out of scope: tags/cover/category beyond what R2-R4 name; an automation guard (E91-D7); selectors in the shared module (E91-D3); CI against the live site.

### Acceptance Criteria

- [ ] AC1 — InfoQ publisher saves an article draft through a persistent browser profile (req: R1, R2, R3, R5)
- [ ] AC2 — Live publishing happens only on explicit request (req: R4)
- [ ] AC3 — Expired or missing sessions report a login instruction instead of a stack trace (req: R5, R6)

Task-local check: the fake-launcher test in `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts` proves the live control is never clicked on a draft run and that an unobserved draft signal yields `ok: false`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T05:08:19.728Z

- **Q: Live switch field?** Closed: `content.metadata.publishStatus === 'public'`, same as xhs/wechatmp; `options.publish` rejected (would be a third convention).
- **Q: Headed or headless publish run?** Closed: headed by default (sites bot-wall headless; upstream default), `options.headless === true` opt-in; preflight is headless-only.
- **Q: Keep the stub-contract tests?** Closed: no — they assert the `agent` default and `sessionReady` that E91-D1 removes.
- Deferred: selector/URL drift beyond the dogfood re-measure — owner Robin, trigger: a draft run returns `ok:false` with a selector timeout.
- **Q: What does `public` mean on InfoQ?** Closed: submit for editorial review (`提交`); InfoQ has no self-publish.

### Design

Approach: site-owned flow in `plugins/publishings/infoq-pub/src/index.ts` over the 0183 helpers (E91-D2/D3). Reason: selectors drift per site and must live where they are tested; plumbing is shared.

Assumed from 0183 (frozen there): `ChannelBrowserConfig`, `resolveChannelProfileDir`, `checkChannelSession`, `runProfileCli`, `pasteHtml`, `fillCodeMirror`, `expectOutcome`, `markdownToHtml`, `waitUntil` from `@gobing-ai/publish-harness/browser`. Do not fork local copies; signature gaps go back to 0183's module in this change.

Frozen names (`src/index.ts`):

```ts
export const CHANNEL = 'infoq';
export const EDITOR_URL = 'https://xie.infoq.cn/write'   // seed candidates :545-547; re-measure in dogfood
export const LOGIN_URL_RE = /(account\.infoq\.cn|\/login)/
export const SELECTORS = { /* see table */ } as const;
export const CONFIG: ChannelBrowserConfig;          // { channel: CHANNEL, homeUrl: EDITOR_URL, isAuthenticated, loginTimeoutMs: 180_000 }
export const isAuthenticated: IsAuthenticatedPredicate; // !LOGIN_URL_RE.test(page.url()) && SELECTORS.title attached
export class InfoqBrowserTransport implements PublishTransport {
    readonly kind = 'browser';
    constructor(driver?: BrowserDriver /* 'script' */, deps?: { launcher?: BrowserLauncher; stepTimeoutMs?: number /* 30_000 */ });
}
export function getPublishTransport(driver?: BrowserDriver /* 'script' */): PublishTransport;
```

Selectors (seeded from the wt script; the dogfood re-measures):

```
title:   ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]']
summary: ['input[placeholder*="摘要"]', 'textarea[placeholder*="摘要"]', 'input[name="summary"]']   // from content.metadata.summary, optional
body:    ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"]']
draft:   ['button:has-text("保存草稿")']
live:    ['button:has-text("提交")']
```

Flow: validate driver → validate `publishStatus` → no extra pre-validation → resolve profile → `checkChannelSession(CONFIG, {profileDir, launcher, headedFallback: false})` → `withProfilePage({profileDir, url: EDITOR_URL, isAuthenticated, headless: options.headless === true, launcher, timeoutMs}, fn)` where fn = fill title → optional summary → pasteHtml(body) → click `draft` → expectOutcome(draft) → if public: click `live` → expectOutcome(live).

Draft signal: probe returns (a) `page.url()` when it differs from the pre-save URL and contains an id segment matching `/\/(\d{4,}|[0-9a-f]{16,})(\/|$|\?)/`, else (b) the text of a visible `:text("保存成功"), :text("已保存")` toast, else null. `id` = the URL id segment when (a), otherwise omitted; `url` = page URL.
Live signal: probe returns the URL or a visible `:text("提交成功"), :text("审核")` toast text.

Result: `{ ok, target: 'infoq', id?, url?, message, metadata: { driver: 'script', publishStatus, profileDir } }`. Helper errors and upstream typed errors (`BrowserProfileMissingError`, `LoginTimeoutError`, `PlaywrightUnavailableError`) map to `ok:false` one-liners; the login hint is appended for session errors.

Anti-patterns: success after a sleep or click without a probe (E91-D6); clicking any live control on a draft run (E91-D5, invariant 4); logging page HTML/cookies; retrying submit loops; copying the wt script's `console.log` style (use Result/`echoError`).

Test layer: `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts` with a fake `BrowserLauncher` whose context/page records `click`/`fill`/`evaluate` calls and scripts URL/toast changes. Asserts: draft run never clicks live selectors; missing signal → `ok:false`; session refused → login hint and no stack; agent driver → unsupported; invalid `publishStatus` → fail with zero launcher calls. Existing `processPublishIO` / `main` / `runInvoke` cases stay, switched to `FakeBrowserTransport('script')`.

Handoff: none downstream. Independent of 0184 and the other channel tasks (touch disjoint plugin dirs; shared-module changes coordinate through 0183's file).

### Plan

- [ ] 0. Precondition: 0183 merged; add the two `catalog:` deps to `plugins/publishings/infoq-pub/package.json`; `bun install`. (R1)
- [ ] 1. Write the failing tests first (replace `tests/infoq-pub.test.ts:14,20,27`): draft happy path with observed signal; no signal → fail; live only on `public`; invalid `publishStatus`; refused session → hint; agent driver; profile precedence incl. `INFOQ_PROFILE_DIR`. (R2-R6)
- [ ] 2. Implement constants, `SELECTORS`, `CONFIG`, `isAuthenticated`, transport flow, `getPublishTransport`. (R1-R4, R6)
- [ ] 3. Add `src/profile-check.ts` over `runProfileCli`. (R5)
- [ ] 4. `plugin.json` description; `docs/04_DESIGN.md` infoq paragraph + env rows. (R6)
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
