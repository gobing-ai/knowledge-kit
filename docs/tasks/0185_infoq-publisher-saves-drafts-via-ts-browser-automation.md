---
schema_version: 1
name: InfoQ publisher saves drafts via ts-browser-automation
status: done
template: feature-impl
created_at: 2026-09-30T04:05:03.981Z
updated_at: "2026-10-08T01:34:26.196Z"
feature_id: E91
priority: P2
tags:
  - publish
  - browser
  - infoq
estimate_hours: 4

dependencies: ["0183"]
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/knowledge-kit-runall-E91-48d71d0b/.spur/memory/evidence/0185-verdict.json
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

- [x] R1. `plugins/publishings/infoq-pub/package.json` adds `"@gobing-ai/ts-browser-automation": "catalog:"` and `"playwright": "catalog:"`; `InfoqBrowserTransport` becomes `kind: 'browser'`, `driver: 'script'` by default, and drives the InfoQ editor through upstream `withProfilePage` after a headless `checkChannelSession` preflight.
- [x] R2. Title and body are filled via the shared helpers: ProseMirror rich text → `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))`.
- [x] R3. A draft run (default) returns `ok: true`, `publishStatus: 'draft'`, and the observed draft URL (and id when the URL carries one) only when `expectOutcome` observes the draft signal; no signal → `ok: false` naming the label and timeout.
- [x] R4. The live control is clicked only when `content.metadata.publishStatus === 'public'`; any value other than absent/`'draft'`/`'public'` → `ok: false` before opening a browser.
- [x] R5. `src/profile-check.ts` runs `runProfileCli(CONFIG, Bun.argv.slice(2))` (login/check); profile precedence `options.profileDir` / `--profile` > `INFOQ_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > default, via `resolveChannelProfileDir`. A refused/missing session returns `ok: false` whose error names `bun plugins/publishings/infoq-pub/src/profile-check.ts login`, with the profile dir path only — no cookie, token, or stack in the Result.
- [x] R6. `driver: 'agent'` fails fast with `unsupported driver 'agent' for infoq` (xhs precedent `plugins/publishings/xhs-pub/src/index.ts:607`); `getPublishTransport()` defaults to `'script'` and the fake branch returns `FakeBrowserTransport('script')`; `plugin.json` description says "script browser transport (ts-browser-automation)"; `docs/04_DESIGN.md` "Leftover CMS browser plugins" section (~:506-512) documents the infoq flow, CLI and env.

Out of scope: tags/cover/category beyond what R2-R4 name; an automation guard (E91-D7); selectors in the shared module (E91-D3); CI against the live site.

### Acceptance Criteria

- [x] AC1 — InfoQ publisher saves an article draft through a persistent browser profile (req: R1, R2, R3, R5)
- [x] AC2 — Live publishing happens only on explicit request (req: R4)
- [x] AC3 — Expired or missing sessions report a login instruction instead of a stack trace (req: R5, R6)

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

- [x] 0. Precondition: 0183 merged; add the two `catalog:` deps to `plugins/publishings/infoq-pub/package.json`; `bun install`. (R1)
- [x] 1. Write the failing tests first (replace `tests/infoq-pub.test.ts:14,20,27`): draft happy path with observed signal; no signal → fail; live only on `public`; invalid `publishStatus`; refused session → hint; agent driver; profile precedence incl. `INFOQ_PROFILE_DIR`. (R2-R6)
- [x] 2. Implement constants, `SELECTORS`, `CONFIG`, `isAuthenticated`, transport flow, `getPublishTransport`. (R1-R4, R6)
- [x] 3. Add `src/profile-check.ts` over `runProfileCli`. (R5)
- [x] 4. `plugin.json` description; `docs/04_DESIGN.md` infoq paragraph + env rows. (R6)
- [x] 5. `bun run lint`, `bun run test`, `bun run build`.
- [x] 6. Operator dogfood handed off (not CI): the live `login` → `check` → one draft run and the re-measurement of `EDITOR_URL`, selectors and the draft signal are operator-owned (E91 out-of-scope: no live dogfood runs during planning or CI) and tracked by follow-up task 0191 (feature E91).

### Solution

Replaces the stub contract (`agent` default, `sessionReady`, dummy draft Result) with the script-driven InfoQ flow over the 0183 shared helpers plus upstream `withProfilePage`. `processPublishIO` / `main` / `runInvoke` keep their behaviour, with the `'script'` default and the fake branch moved to `FakeBrowserTransport('script')`. No 0183 helper is forked: `resolveChannelProfileDir`, `checkChannelSession`, `runProfileCli`, `pasteHtml`, `markdownToHtml`, `waitUntil` and `expectOutcome` are imported as-is, and candidate-selector resolution adds the harness root's existing `trySelectors` rather than a second poll loop — no signature gap was found in the shared module, so it needed no change.

#### Change map

| file:line | change |
| --- | --- |
| `plugins/publishings/infoq-pub/package.json:10` | adds `"@gobing-ai/ts-browser-automation": "catalog:"` (Plan 0, R1) |
| `plugins/publishings/infoq-pub/package.json:14` | adds `"playwright": "catalog:"` (Plan 0, R1); the step-0 `bun install` wrote the matching `bun.lock` workspace entry |
| `plugins/publishings/infoq-pub/src/index.ts:32` | `export const CHANNEL = 'infoq'` — the frozen slug that names the Result target and the `INFOQ_PROFILE_DIR` tier (R1) |
| `plugins/publishings/infoq-pub/src/index.ts:38` | `export const EDITOR_URL = 'https://xie.infoq.cn/write'` — the frozen write-page URL the dogfood re-measures (R1) |
| `plugins/publishings/infoq-pub/src/index.ts:40` | `export const LOGIN_URL_RE = /(account\.infoq\.cn|\/login)/` — the SSO/redirect shape the readiness predicate rejects (R1) |
| `plugins/publishings/infoq-pub/src/index.ts:47` | `export const SELECTORS` — the frozen `title`/`summary`/`body`/`draft`/`live` lists seeded from the wt script (R2, R4) |
| `plugins/publishings/infoq-pub/src/index.ts:68` | `export const isAuthenticated` — editor reachable and title attached, the one readiness spelling shared by the preflight and the CLI (R1, R5) |
| `plugins/publishings/infoq-pub/src/index.ts:72` | `export const CONFIG: ChannelBrowserConfig` — `{channel, homeUrl: EDITOR_URL, isAuthenticated, loginTimeoutMs: 180_000}` for the shared check/CLI (R1) |
| `plugins/publishings/infoq-pub/src/index.ts:97` | `findSelector` — resolves the first attached candidate through the shared `trySelectors` + `waitUntil`, throwing the selector list and deadline (R2) |
| `plugins/publishings/infoq-pub/src/index.ts:120` | `readToast` — first visible `:text(…)` toast text, the evidence half of both outcome probes (R3, R4) |
| `plugins/publishings/infoq-pub/src/index.ts:131` | `InfoqBrowserTransport` declares `kind = 'browser'` with `driver: BrowserDriver`; `:137` the constructor is `(driver = 'script', deps: { launcher?, stepTimeoutMs? = 30_000 })` (R1, R6) |
| `plugins/publishings/infoq-pub/src/index.ts:144` | `driver !== 'script'` → `unsupported driver '<driver>' for infoq`, before anything else runs (R6) |
| `plugins/publishings/infoq-pub/src/index.ts:147` | `publishStatus` outside absent/`'draft'`/`'public'` → `ok: false` naming the value, before any browser opens (R4) |
| `plugins/publishings/infoq-pub/src/index.ts:153` | `resolveChannelProfileDir(CHANNEL, options.profileDir)` owns the `INFOQ_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` → default precedence (R5) |
| `plugins/publishings/infoq-pub/src/index.ts:157` | `checkChannelSession(CONFIG, {profileDir, launcher, headedFallback: false, timeoutMs})` — the headless publish preflight; a refusal returns `ok: false` naming the login command and the profile-dir detail, never a cookie/HTML/stack (R5, AC3) |
| `plugins/publishings/infoq-pub/src/index.ts:168` | `withProfilePage({profileDir, url: EDITOR_URL, isAuthenticated, headless: options.headless === true, launcher, timeoutMs})` around the site flow (R1) |
| `plugins/publishings/infoq-pub/src/index.ts:183` | the single failure mapper: one-line `ok: false` from the thrown error, plus ` — run: <login command>` for `LoginTimeoutError`/`BrowserProfileMissingError` (R5, AC3) |
| `plugins/publishings/infoq-pub/src/index.ts:202` | title filled from the shared resolution (R2) |
| `plugins/publishings/infoq-pub/src/index.ts:208` | optional `metadata.summary` filled only when it is a non-empty string (R2) |
| `plugins/publishings/infoq-pub/src/index.ts:214` | `pasteHtml(page, bodySelector, markdownToHtml(content.body))` — the ProseMirror body path (R2) |
| `plugins/publishings/infoq-pub/src/index.ts:217` | captures the pre-save URL, clicks `保存草稿`, then `expectOutcome(probeDraft, {label: "infoq draft save '<selector>'"})`; no signal → `ok: false` naming the label and timeout (R3) |
| `plugins/publishings/infoq-pub/src/index.ts:230` | draft Result: `{ok: true, target, id?, url: page.url(), message, metadata: {driver, publishStatus, profileDir}}`, `id` only from a URL-carried id segment (R3) |
| `plugins/publishings/infoq-pub/src/index.ts:241` | `提交` is resolved and clicked **only** on the `publishStatus === 'public'` path, with its own pre-click URL baseline (R4, AC2) |
| `plugins/publishings/infoq-pub/src/index.ts:252` | live Result message `infoq submitted for InfoQ editorial review` — InfoQ has no self-publish (R4) |
| `plugins/publishings/infoq-pub/src/index.ts:267` | `probeDraft` — a moved URL carrying `/\/(\d{4,}|[0-9a-f]{16,})(\/|$|\?)/` or a visible `保存成功`/`已保存` toast, else null (R3) |
| `plugins/publishings/infoq-pub/src/index.ts:274` | `probeLive` — a visible `提交成功`/`审核` toast or a URL that moved off the post-draft URL, else null (R4) |
| `plugins/publishings/infoq-pub/src/index.ts:281` | `getPublishTransport(driver = 'script')` — fake branch returns `FakeBrowserTransport('script')` (R6) |
| `plugins/publishings/infoq-pub/src/profile-check.ts:18` | `process.exit(await runProfileCli(CONFIG, Bun.argv.slice(2)))` — the `login|check` operator entry over the shared CLI (Plan 3, R5) |
| `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:58` | `makeFakePage` — records every `goto`/`fill`/`click`/`evaluate`, scripts URL moves and toasts, and keeps `:text(…)` selectors unattached until a toast is scripted |
| `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:122` | `makeFakeLauncher` — one page script per launch, recording the `ProfileLaunchRequest` list and context closes, with an optional throw-at-launch |
| `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:212` | draft happy path: `ok: true`, `publishStatus: 'draft'`, observed draft URL + id, launches `[headless true, headless false]`, and **no** `提交` click on the draft run (task-local check, AC1/AC2) |
| `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:263` | unobserved draft signal → `ok: false` naming the control and the 30 ms deadline, with no live click (task-local check, AC1) |
| `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:276` | live control clicked only for `publishStatus === 'public'`; `:289` explicit `'draft'` stays a draft; `:298` unknown value fails with zero launcher calls; `:310` agent driver fails with zero launcher calls (AC2) |
| `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:321` | missing profile → login instruction, one line, no stack; `:338` expired session (login URL) → same; `:351` a session that expires after the preflight → same (AC3) |
| `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:367` | profile precedence incl. `INFOQ_PROFILE_DIR` over `KK_BROWSER_PROFILE_DIR` and `options.profileDir` over both; `:386` `options.headless === true` keeps the editor visit headless (R5) |
| `plugins/publishings/infoq-pub/plugin.json:6` | description now says "…via script browser transport (ts-browser-automation)", matching the `script`-only transport (Plan 4, R6) |
| `docs/04_DESIGN.md:574` | new `infoq-pub` paragraph in "Leftover CMS browser plugins": flow, `publishStatus` switch, draft/live signals, Result shape, `profile-check.ts` CLI and the env precedence (Plan 4, R6) |

#### Disclosed divergences

1. **`checkChannelSession` gets an explicit `timeoutMs: this.stepTimeoutMs`** (`src/index.ts:161`) where the Design's flow line lists only `{profileDir, launcher, headedFallback: false}`. The default is the harness's own check deadline (`30_000`), so production timing is unchanged; the explicit pass is what makes the refusal path testable without a 30 s wait (`tests/infoq-pub.test.ts:338,351`).
2. **`withProfilePage`'s `timeoutMs` is `this.stepTimeoutMs`** (`src/index.ts:179`). The Design leaves the value as a bare `timeoutMs`; `CONFIG.loginTimeoutMs` (180 s) stays the interactive-login deadline owned by `runProfileCli`, while the post-goto readiness confirmation is bounded like every other step after an already-verified preflight.
3. **`url` is always `page.url()` in the draft Result** (`src/index.ts:235`), per the Design's "`url` = page URL". On the toast-only signal that is the editor URL, not a draft URL; `id` is present only for the URL branch (`:228`).
4. **`readToast` returns the element's own text** (`src/index.ts:126`), not the candidate literal — `:text(…)` matches substrings, so a toast rendering `保存成功！` reports what it observed.
5. **`bun.lock`** carries this task's `@gobing-ai/infoq-pub` dependency entry plus pre-existing unrelated hunks from 0183/0184 (`packages/publish-harness` deps, `apps/cli` version) that were already in the working tree before this task started.

Plan step 6 (operator dogfood) is untouched: still `- [ ]`, its text unchanged. It is an operator-owned live-site step (`profile-check.ts login` → `check` → one draft run, re-measuring `EDITOR_URL`, selectors and the draft signal) and its recording decision is pending with the operator, so no live site was contacted and no dogfood evidence is claimed here.

#### Confidence level

Confidence: HIGH — for the infoq-pub flow as delivered, bounded to the plugin-grain evidence this task declares (recording fake launcher and fake page; no live site).

| Area | First-hand basis (this tree, this run) | Bound |
| --- | --- | --- |
| R1-R4 deps, preflight, editor flow, draft/live split | `bun run lint` exit 0 (Biome 2.5.5 check plus every workspace typecheck, `@gobing-ai/infoq-pub` included), `bun run build` exit 0, targeted suite 21 pass / 0 fail with `plugins/publishings/infoq-pub/src/index.ts` at 100.00 % lines / 90.63 % funcs | no real browser: the launcher and page are the suite's fakes (`plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:58` fake page, `:122` fake launcher) |
| R5 / AC3 session failures | the three refusal cases (`plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:321` missing profile, `:338` expired session, `:351` expiry after the preflight) assert the login command, the profile-dir detail, a single line and no `    at ` frame, with exactly one preflight launch | the wording of a real InfoQ refusal is unverified; the refusal itself comes from the shared `checkChannelSession` (`packages/publish-harness/src/browser.ts:107-148`, one pass because `headedFallback: false` at `:112`) |
| R6 transport surface | `plugins/publishings/infoq-pub/plugin.json:6` description and `docs/04_DESIGN.md:574` paragraph; the `'script'` default and `FakeBrowserTransport('script')` are asserted at `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:173` and `:414` | registry and CLI consumers are covered by the untouched suites that run green in the full pass (`packages/kk-core/tests/registry.test.ts`, `apps/cli/tests/itc-stages.test.ts`) |
| No regression outside the plugin | `bun run test` → 1774 pass / 2 skip / 0 fail, coverage 98.43 % lines / 98.27 % funcs (gate 90 %) | the 2 skips are pre-existing and not in this plugin; I did not capture a pre-change full-suite baseline, only the infoq file's own 8 → 21 test delta |
| Selector table, `EDITOR_URL`, draft signal | seed-derived from the wt `publish-to-infoq` script and pinned by the assertion at `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:189` | **unverified against the live site** — Plan step 6 (operator dogfood) is the re-measure; drift surfaces as `ok:false` naming the control and the deadline |

#### Follow-up handoff — operator dogfood (2026-10-05)

Operator decision recorded after this report: the Plan step 6 dogfood is **handed off, not performed here**. The live `login` → `check` → one draft run cannot run in CI and live dogfood runs are out of E91's scope, so the task-side deliverable of that step is the handoff itself; the live run and the re-measurement are tracked by follow-up task **0191** (Operator dogfood for infoq-pub, feature E91), which owns any constant update the re-measure turns up. Plan step 6 now says exactly that and is ticked as handed off (`docs/tasks/0185_infoq-publisher-saves-drafts-via-ts-browser-automation.md:124`).

Consequence for the evidence above: `EDITOR_URL`, the `SELECTORS` lists and the draft/live signals stay seed-derived (wt `publish-to-infoq` script) and **unverified against the live site**, so the bound in the "Selector table, `EDITOR_URL`, draft signal" row of the confidence table stands as written (`docs/tasks/0185_infoq-publisher-saves-drafts-via-ts-browser-automation.md:192`). No dogfood was run and no live-site evidence is claimed anywhere in this section.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/infoq-pub/package.json:10,14` deps; `plugins/publishings/infoq-pub/src/index.ts:212` `kind='browser'`, `:219` default driver `script`; preflight `plugins/publishings/infoq-pub/src/index.ts:244-252` then `withProfilePage` `plugins/publishings/infoq-pub/src/index.ts:259`. CHANGED by 0191: preflight is now headed-only (`headedOnly:true`, WAF 451s headless) — supersession documented in 0191 and `docs/04_DESIGN.md:861`. |
| R2 | MET | `plugins/publishings/infoq-pub/src/index.ts:309` title via `findSelector(SELECTORS.title)`; `plugins/publishings/infoq-pub/src/index.ts:318` `pasteHtml(page, bodySelector, markdownToHtml(content.body))` plus the input event at `:321-328`. |
| R3 | MET | `plugins/publishings/infoq-pub/src/index.ts:332` `expectOutcome(() => readToast(page, DRAFT_SAVED_TEXTS))`; draft id from `/draft/<id>` (`plugins/publishings/infoq-pub/src/index.ts:306`); no signal → `ok:false` naming the label and deadline. |
| R4 | MET | `plugins/publishings/infoq-pub/src/index.ts:234-238` rejects any publishStatus outside absent/draft/public before profile resolution; `plugins/publishings/infoq-pub/src/index.ts:338` returns on draft before the live block, `div.submit-btn` resolved only at `plugins/publishings/infoq-pub/src/index.ts:349`. |
| R5 | MET | `plugins/publishings/infoq-pub/src/profile-check.ts:20` `runProfileCli(CONFIG, Bun.argv.slice(2))`; precedence via `resolveChannelProfileDir` `plugins/publishings/infoq-pub/src/index.ts:240`; refusal names `LOGIN_INSTRUCTION` (`plugins/publishings/infoq-pub/src/index.ts:86`), pinned `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:41`. |
| R6 | MET | `plugins/publishings/infoq-pub/src/index.ts:230` `unsupported driver 'agent' for infoq`; `plugins/publishings/infoq-pub/src/index.ts:392-394` default `script`, fake branch `FakeBrowserTransport('script')`; `plugins/publishings/infoq-pub/plugin.json:7` description. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 [R5] | MET | test | `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:394` expired session → login command, no stack; `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:388,404,418` assert no `    at ` frame. |
| AC2 [R9] | MET | test | `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts` draft-only cases (26 tests) pass; draft branch never resolves `SELECTORS.live` (`plugins/publishings/infoq-pub/src/index.ts:338` before `:349`). |
| AC3 [R11] | MET | test | `plugins/publishings/infoq-pub/src/index.ts:139` `fail()` carries message only; preflight refusal message names profile dir + login command; `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:388-418`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0185

**Scope:** task 0185's diff vs the 0183 baseline — `plugins/publishings/infoq-pub/{package.json,plugin.json,src/index.ts,src/profile-check.ts,tests/infoq-pub.test.ts}`, the new `infoq-pub` paragraph of `docs/04_DESIGN.md` (Plan step 4, `:574`) and `docs/tasks/0185_*.md`. 0183's/0184's still-uncommitted work (`packages/publish-harness/**`, `xhs-pub`, `wechatmp-pub`) is treated as the frozen dependency — `packages/publish-harness/src/browser.ts` was not touched by 0185 (mtime 2026-10-04 22:07:50, before 0185's first edit 2026-10-05 00:47:45) and was not re-reviewed.
**Dimensions:** functional traceability (R1–R6, AC1–AC3), SECUA (security, efficiency, correctness, usability, architecture), architectural depth
**Verdict:** PASS — 0 blocker, 0 major, 1 minor (deferrable, deferred to 0191 with a reason), 4 advisory; every requirement traced to `file:line` evidence

**Independence.** Every claim below is re-derived from this tree, not taken from `## Solution`: the full source diff, `src/profile-check.ts` and the suite were read directly; the flow was walked against the frozen `## Design` line by line (driver → `publishStatus` → profile → preflight → `withProfilePage` → title/summary → `pasteHtml` → draft click → `expectOutcome` → live click only on `public`); the six helpers the flow consumes were read in `packages/publish-harness/src/browser.ts` and the two upstream calls in the installed `@gobing-ai/ts-browser-automation@0.5.11` (`src/operations.ts` — `headless` default `false`, `isAuthenticated` polling, `context.close()` in `finally`) to check the semantics the flow relies on; the targeted suite was re-run first-hand rather than quoted; the two handoff obligations 0183's review left for 0185 (captured as residuals in `docs/tasks/0190_residuals-from-0183.md:16,17`) were checked explicitly (see Correctness below); gate freshness was proved by mtime ordering.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | correctness | `readToast` searches the **whole document** with no scope (`page.locator(':text("…")')`, `:122`), and both probes call it (`probeDraft` `:270`, `probeLive` `:275`), so the article body this flow itself pasted (`pasteHtml` `:215`, which runs **before** the draft click `:219` and both probes) participates in the search. An article whose body contains `保存成功` or `已保存` makes the draft probe report success immediately after the click whether or not InfoQ saved anything; a body containing `提交成功` or `审核` does the same for the live probe, whose Result then reads `infoq submitted for InfoQ editorial review` (`:255`) for an article that was never submitted — a false `ok: true` on the E91-D6 rail. The candidate lists themselves are design-frozen (`:61-62` mirror the Design's draft/live signal definitions), so this is not a frozen-name divergence: the **search scope** is the implementation's own choice (the Design says a visible `:text(…)` *toast*, and the pasted editor is not one). Fix shape: exclude the editor container, or scope the read to the toast/notification container — a localized change whose validation needs the live DOM. | `plugins/publishings/infoq-pub/src/index.ts:61-62,120-129,267-279` | FIXED — 5d3932de: readToast reads only notification containers via the shared readScopedSignal (plugins/publishings/infoq-pub/src/index.ts:181-185; tests infoq-pub.test.ts:302, browser.test.ts:567) (was: DEFER — 0191 (Operator dogfood for infoq-pub: profile-check login then check then one draft run, re-measuring the draft signal; feature E91) owns the infoq live-site signal pass, where the toast DOM is observable and this fix can be validated; its draft run is exactly the half that can reproduce it, and the live-toast variant gets the same fix (no E91 task exercises a live submit).) |
| 2 | P4 (advisory) | correctness | On the toast-only draft signal the Result carries `url: page.url()` — the **unmoved editor URL** — and drops the observed toast text (`:230-239`); `id` is taken only from a URL-carried segment (`:228`). The branch therefore reports no draft-specific artifact at all: `url` copies the editor page URL, which the Design's own rule (`url` = page URL) sanctions and `## Solution` divergence 3 discloses, but that value is then propagated as the draft's URL by `apps/cli/src/fanout.ts:108` and carried into skip records (`:526`), so a consumer can read `https://xie.infoq.cn/write` as the article URL of a saved draft. | `plugins/publishings/infoq-pub/src/index.ts:228-239,267-271` (consumer: `apps/cli/src/fanout.ts:108`) | — |
| 3 | P4 (advisory) | usability | Every preflight refusal is suffixed with the login command (`:158-164`), including refusals that logging in cannot fix: `PlaywrightUnavailableError`, `BrowserProfileBusyError` (profile locked by another Chromium instance) and a `goto`/readiness failure all come back as `status: 'refused'` from the shared check (`packages/publish-harness/src/browser.ts:107-148`) and are then told to `run: bun plugins/publishings/infoq-pub/src/profile-check.ts login`. The real cause always precedes the hint in the same string, so this is a misleading suffix rather than a wrong diagnosis; `needsLogin` (`:88-90`) already exists and gates the hint on the editor-visit path (`:184`). | `plugins/publishings/infoq-pub/src/index.ts:88-90,158-164` | — |
| 4 | P4 (advisory) | architecture | Deepening opportunity left deliberately: `findSelector` (`:97-115`) is a candidate-list poll loop the shared module does not export (its `requireAttached` resolves a single selector and stays private, `packages/publish-harness/src/browser.ts:340-350`), and `readToast` (`:120-129`) has no shared equivalent — so xhs `findSelector`/`findAttachedSelector` (`plugins/publishings/xhs-pub/src/index.ts:356-394`) and this one are two of the same shape, before juejin/substack/x-article land. One exported `resolveSelector(page, selectors, {visible})` plus a scoped signal reader would serve all four channels; this is the same residual 0184's review recorded (its advisory 4). Not a defect — E91-D3 keeps selector resolution site-local for now. | `plugins/publishings/infoq-pub/src/index.ts:97-129` | — |
| 5 | P4 (advisory) | functional (evidence) | R5's CLI wiring is verified by reading only: `src/profile-check.ts` is loaded by no test — it is absent from the targeted run's coverage table, which lists only `src/index.ts` for the plugin — so `process.exit(await runProfileCli(CONFIG, Bun.argv.slice(2)))` under the `import.meta.main` guard (`:17-19`) is unexercised. The shared `runProfileCli` is covered by 0183's suite, and `xhs-pub`'s precedent imports its own profile-check main in tests (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:32`). Two lines, no defect found on reading; recorded so the evidence gap is visible rather than implied. | `plugins/publishings/infoq-pub/src/profile-check.ts:17-19` | — |

No P1 (blocker) and no P2 (major) findings. Row 1 is the only P3 and is deferred to a named E91 task, so no row blocks this task's verdict.

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 — `catalog:` deps, `kind: 'browser'`, `driver: 'script'`, editor through `withProfilePage` after a headless preflight | MET | `package.json:10,14` add `"@gobing-ai/ts-browser-automation": "catalog:"` and `"playwright": "catalog:"`; `kind` is `'browser'` and the constructor defaults to `'script'` (`src/index.ts:131,137`); the flow resolves the profile dir (`:153`), runs `checkChannelSession(CONFIG, {profileDir, launcher, headedFallback: false, timeoutMs})` (`:157-166`) and only then opens `EDITOR_URL` through upstream `withProfilePage` with `isAuthenticated` and the site flow as its callback (`:168-182`). Asserted at `tests/infoq-pub.test.ts:170-179` (kind/driver/`EDITOR_URL`/`CONFIG.loginTimeoutMs`) and `:225-226` (launch heads `[true, false]` and both launches on the resolved profile dir). |
| R2 — title and body via the shared helpers, ProseMirror body through `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))` | MET | `src/index.ts:202-206` resolves the first attached `SELECTORS.title` candidate through the shared `trySelectors` (`:104-105`, `visible: false`) and fills it; `:208-212` fills the optional `metadata.summary` only when it is a non-empty string; `:214-215` is exactly `await pasteHtml(page, bodySelector, markdownToHtml(content.body), {timeoutMs})` with both symbols imported from `@gobing-ai/publish-harness/browser` (`:11-19`) — no local copy of any helper exists in the diff. Covered by `tests:227` (title fill), `:235-242` (summary present then absent) and `:228` (the paste `evaluate` happened). See residual risk 2 for the strength of the last assertion. |
| R3 — draft run returns `ok: true` + `publishStatus: 'draft'` + the observed draft URL/id only on an observed signal; no signal → `ok: false` naming label and timeout | MET | `src/index.ts:217-235`: pre-save URL baseline, `保存草稿` click, then `expectOutcome(() => probeDraft(page, urlBeforeSave), {label: 'infoq draft save …'})`; an unobserved signal returns `fail(draft.error)` and the Result carries `publishStatus: 'draft'`, `id` only from a URL-carried id segment (`:228`) and `url: page.url()`. `probeDraft` (`:267-271`) accepts only a moved URL carrying `DRAFT_URL_ID_RE` or a visible save toast. Asserted at `tests:216-223` (ok/target/url/id/draft/metadata) and `:263-272` (unobserved → `ok:false` naming the selector and the 30 ms deadline, with no live click). The toast branch's `url`/`id` semantics are finding 2. |
| R4 — live control clicked only for `content.metadata.publishStatus === 'public'`; any other value fails before a browser opens | MET | `src/index.ts:147-150` returns `ok: false` for any value outside absent/`'draft'`/`'public'` **before** profile resolution or launch; `:241-247` resolves and clicks the `提交` control only inside the `public` branch, with its own pre-click URL baseline (`:244`, and the comment at `:242-243` says why it is not the draft baseline); the draft branch returns before that block (`:230-239`). Asserted at `tests:276-287` (public clicks both, message says editorial review), `:289-296` (explicit `'draft'`, no live click), `:298-308` (unknown value → `ok:false` with zero launcher requests and zero recorded calls), `:212-233` and `:263-272` (a draft run's recorded clicks contain `button:has-text("保存草稿")` and no `button:has-text("提交")`). |
| R5 — `profile-check.ts` over `runProfileCli(CONFIG, Bun.argv.slice(2))`, four-tier profile precedence, refusals as a one-line `ok:false` naming the login command and the profile dir only | MET | `src/profile-check.ts:17-19` is `process.exit(await runProfileCli(CONFIG, Bun.argv.slice(2)))` under `import.meta.main`; precedence is the shared `resolveChannelProfileDir(CHANNEL, options.profileDir)` (`src/index.ts:152-153`), i.e. `options.profileDir` > `INFOQ_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/infoq` (`packages/publish-harness/src/browser.ts:85-95`, blank = unset); a refusal returns `fail('infoq session preflight refused: <detail> — run: <LOGIN_INSTRUCTION>')` (`:158-164`) where `detail` carries the profile dir path only (`packages/publish-harness/src/browser.ts:131-148`). Asserted at `tests:321-335` (missing profile: login command, `no infoq browser profile at <dir>`, exactly one line, no `    at ` frame, one launch, no context close), `:338-348` (expired session) and `:351-362` (session expires after the preflight — `LoginTimeoutError` mapped at `src/index.ts:184`), plus `:367-384` (precedence incl. `INFOQ_PROFILE_DIR` over `KK_BROWSER_PROFILE_DIR` and `options.profileDir` over both) and `:386-392` (`options.headless === true` keeps the editor visit headless). Evidence gap for the two-line CLI wiring: finding 5. |
| R6 — agent driver fast-fails; `getPublishTransport()` defaults to `'script'` and the fake branch returns `FakeBrowserTransport('script')`; `plugin.json` description; `docs/04_DESIGN.md` infoq paragraph | MET | `src/index.ts:144-146` fails with exactly `unsupported driver 'agent' for infoq` before anything else runs; `:281-286` defaults the driver to `'script'` and returns `new FakeBrowserTransport('script')` on `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`; `plugin.json:6` ends `… via script browser transport (ts-browser-automation)`; `docs/04_DESIGN.md:574` documents the flow, the `publishStatus` switch, both signals, the Result shape, the CLI (`login|check [--profile <dir>] [--timeout <ms>]`, exit 0/1/2) and the env precedence. Asserted at `tests:310-317` (agent driver, zero launches) and `:409-418` (fake branch is a `'script'` `FakeBrowserTransport`). The Plan's anchor (`~:506-512`) has drifted; the paragraph is at `:574` in the "Leftover CMS browser plugins" section, which the requirement names by section, not by line. |

| AC | Req | Status | Evidence |
| --- | --- | --- | --- |
| AC1 — InfoQ publisher saves an article draft through a persistent browser profile | R1, R2, R3, R5 | MET | Preflight on the resolved profile dir, then a headed editor visit on the same dir (`src/index.ts:157-182`), title/summary/`pasteHtml` (`:202-215`), `保存草稿` + `expectOutcome` (`:217-235`). `tests:212-233` asserts the draft Result (`ok: true`, `publishStatus: 'draft'`, observed `DRAFT_URL` + id `1234567890`, both launches `[true, false]` on `DEFAULT_DIR`, title fill, paste `evaluate`, draft click, **no** submit click, both contexts closed); the profile/session half of the AC is `tests:321-362`. Bound: fake launcher and fake page only — no live xie.infoq.cn run (Plan step 6 is the operator dogfood, handed to 0191). |
| AC2 — Live publishing happens only on explicit request | R4 | MET | `src/index.ts:147-150` (unknown value → fail before a browser) and `:230-247` (draft branch returns before the live block; the live control is resolved and clicked only for `'public'`); the message for a `public` run says "submitted for InfoQ editorial review" rather than "published" (`:255`). Tests: `:276-287` (both clicks only on public), `:289-296`, `:298-308` (zero launcher calls), `:212-233` and `:263-272` (recorded clicks on a draft run contain the draft selector and no submit selector — the task-local check, genuinely proven by the fake launcher's call log). |
| AC3 — Expired or missing sessions report a login instruction instead of a stack trace | R5, R6 | MET | The three refusal tests assert `ok: false`, the login command, the profile dir, `result.error?.split('\n')` length 1 and `not.toContain('    at ')` (`tests:325-332`, `:342-347`, `:357-361`); the mapping is `error.message` only via `fail()` (`src/index.ts:79-85`, `:183-186`), and the driver surface fails fast (`:310-317`) with the fake branch intact (`:409-418`). |

##### SECUA and architectural-depth pass

- **Security — the invariant holds for everything the flow can construct.** No `cookie`, `storageState`, `localStorage` or token reference exists anywhere in `infoq-pub/src` (grep; the only textual hit is the comment at `src/index.ts:57`), and the profile directory — the login artifact — is the only profile detail that reaches a Result (`:153`, `:162`, `:233`) or a message (`:237`), which R5 permits. Every failure string is built from `error.message` alone (`:79-85`, `:183-186`), never `error.stack`, and the three session tests assert a single line with no `    at ` frame (`tests:331-332`, `:346-347`, `:360-361`). The refusal detail is the shared module's, which carries the profile dir path only (`packages/publish-harness/src/browser.ts:131-148`). Output boundaries: zero `console.*` and zero `process.stdout/stderr.write` in the plugin, so `no-console-output` and `no-raw-stdout-stderr` (`.spur/rules/typescript/output-boundaries.yaml:44-55`) hold — failures go through `echoError` (`src/index.ts:332,338,350`) and the Result file, and both post-check rules pass in the gate.
- **Efficiency.** No sleeps and no retry loops in the plugin: every wait is a bounded shared poll (`waitUntil`, 500 ms cadence; `STEP_TIMEOUT_MS = 30_000` at `:55`), `findSelector` reads two candidates' `count()` per poll with `visible: false` (`:104-105`), and the `readToast` probe is at most 3 reads per candidate per poll (`:122-126`). The two sequential launches per publish (headless preflight `:157-166`, headed editor visit `:168-182`) are the ADR-025/preflight contract the Design freezes, not extra work here, and neither context leaks (`withProfilePage`'s `finally`; asserted `tests:232`). The targeted suite runs the whole flow with `stepTimeoutMs: 200` in ~1.2 s.
- **Correctness.** The flow order matches the frozen Design step for step, including the two fail-fast guards before any browser work, and the live path re-baselines the URL at the submit click rather than reusing the draft baseline (`:244`). No success path bypasses a probe. The two handoff obligations 0183's review left for this task are discharged: (a) "0185/0186 must assert the body" — the infoq body goes through `pasteHtml`, whose non-empty post-condition throws (`packages/publish-harness/src/browser.ts:262-267`), not through the unguarded `keyboard` branch, so an empty body can never become a draft success; (b) "channel flows must wrap the probe" — `readToast` guards all three awaits with `.catch` (`:122-126`) and `publish()` wraps the whole `withProfilePage` call in try/catch (`:167-186`), so a rejecting probe becomes a one-line `ok: false` instead of an unhandled rejection (residual 57393658 in `docs/tasks/0190_residuals-from-0183.md:17` does not apply to this flow). Open correctness item: finding 1.
- **Usability.** Failures name what was missing and for how long: `findSelector` throws `<what>: <candidates> not attached within <timeout>ms` (`:108-110`) and `expectOutcome` returns `infoq draft save '<selector>': no outcome observed within <timeout>ms` (`packages/publish-harness/src/browser.ts:311-335`), and every session failure names the exact operator command (`:58`). The live Result is labelled honestly ("submitted for InfoQ editorial review"). Operator surface is documented three times over (`src/profile-check.ts:1-13`, `docs/04_DESIGN.md:574`, `src/index.ts:57-58`). Finding 3 is the one usability nit.
- **Architecture.** The site flow is deep where it must be (one exported class owning driver/`publishStatus` validation, the profile/preflight/editor sequence, and both probes) and shallow where sharing wins: `resolveChannelProfileDir`, `checkChannelSession`, `waitUntil`, `pasteHtml`, `markdownToHtml` and `expectOutcome` are imported, not forked, and the diff adds no copy of any of them (0183's contract kept). The readiness predicate is defined once (`isAuthenticated`, `:68-69`) and consumed by both the publish preflight (`CONFIG`, `:72-77`) and the operator CLI (`src/profile-check.ts:18`) — one spelling of "session ready". The launcher and step timeout are injected (`:137`), which is what makes the whole flow testable against fakes (100 % lines / 90.63 % funcs for `src/index.ts`). Finding 4 is the deferred deepening.

##### Verification performed for this review

- Quality gate re-used, not re-run (the stage forbids a second `bun run spur-check`): `.spur/run/0185-test-gate.log` — `biome check .` → "Checked 306 files in 170ms. No fixes applied."; every workspace typecheck "Exited with code 0"; pre-check "All 53 rules passed — no violations found."; suite `1774 pass / 2 skip / 0 fail` (97 files); post-check "All 2 rules passed — no violations found."; `.spur/run/0185-test-gate.status` reads `PASS` and `.spur/run/0185-test-gate.findings` is empty. Freshness proved by mtime: the log (06:48:08) postdates every 0185 edit (latest `src/index.ts` 00:58:36, `tests` 00:51:47, `docs/04_DESIGN.md` 00:52:32), and the frozen `packages/publish-harness/src/browser.ts` is unchanged since 2026-10-04 22:07:50.
- Narrow suite re-run in this review: `NODE_ENV=test bun test plugins/publishings/infoq-pub/tests/infoq-pub.test.ts` → `21 pass / 0 fail / 93 expect() calls` in 1.2 s, exit 0; its coverage table shows `plugins/publishings/infoq-pub/src/index.ts` at `90.63 % Funcs / 100.00 % Lines` and no row for `src/profile-check.ts` (finding 5).
- Static checks on the 0185 diff: no `console.*`, no `process.stdout/stderr.write` under `infoq-pub/src`; no cookie/storageState/localStorage/token reference; no added `biome-ignore`, `@ts-ignore`, `as any`, `: any`, `TODO` or `FIXME`; no added line anywhere in the tree's diff matching the residual sweep's marker pattern; 0185 adds no `packages/publish-harness/**` hunk.
- Read first-hand for this review: `src/index.ts` (all 356 lines), `src/profile-check.ts`, `tests/infoq-pub.test.ts` (all 471 lines), `package.json`, `plugin.json`, the `docs/04_DESIGN.md` diff, `packages/publish-harness/src/browser.ts`, `@gobing-ai/ts-browser-automation@0.5.11` `src/operations.ts` + `src/errors.ts`, `apps/cli/src/fanout.ts:95-120,515-535`, and `packages/kk-core/src/schemas.ts:32-40` for the Result shape.
- Not done by design: no fix, no `## Solution` rewrite, no status change, no `spur task record`, no worktree, no commit, no live-site contact.

##### Residual risk (not verified)

1. **Live-site behaviour.** `EDITOR_URL`, the five `SELECTORS` lists and the draft/live signal strings are seed-derived from the wt script and unverified against xie.infoq.cn; Plan step 6 is operator-owned and handed to 0191. A drift shows up as `ok: false` naming the control and deadline, or — per finding 1 — as a false success; a bot-wall, a different editor URL or a different toast wording can only be settled by that live pass. This review contacted no live site.
2. **The paste wiring rests on reading, not on an assertion.** The fake page records only `evaluate:<first 32 chars>` and returns a fixed non-empty string (`tests:97-100`), so the suite cannot distinguish `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))` from a mis-wired call; the empty-body protection comes from the shared helper's own non-empty poll, which is tested in 0183's suite.
3. **Playwright error text.** The mapping is `error.message` only, which cannot carry a stack, but no real browser was driven here to prove that no live failure message (e.g. an `evaluate` failure inside the paste script, whose expression embeds the article HTML) can carry page- or content-derived text into a Result.
4. **The "one line" guarantee is asserted only for the three session paths.** A `goto`/click failure can still produce a multi-line `error` in the Result (a Playwright call log, not a stack). Untested and unverifiable without a browser.
5. **Process observation (outside the code under review).** This tree carries no verify-stage output for 0185 — `## Testing` is empty, `R1–R6` and `AC1–AC3` are unticked and there is no `0185-verdict.json`, while 0183/0184 carried all three at review time. The residual sweep's `unchecked-box` category reads those nine lines as blocking, so its outcome depends on the verify stage ticking them before `record` (the task template's own rule is that requirement boxes are "checked at close"). This review left them untouched by design: the reviewer writes `## Review` and nothing else.

##### Verification confidence — HIGH

Basis, each leg re-derived in this stage rather than quoted: R1-R6/AC1-AC3 are each anchored to a `file:line` read here (R1 `src/index.ts:131,137,153-182` asserted at `tests:170-179,225-226`; R2 `:202-215` asserted at `tests:227,228,235-242`; R3 `:217-235,267-271` asserted at `tests:216-223,263-272`; R4 `:147-150,241-247` asserted at `tests:276-308` and `:212-233`; R5 `src/profile-check.ts:17-19`, `src/index.ts:152-164` asserted at `tests:321-362,367-392`; R6 `:144-146,281-286`, `plugin.json:6`, `docs/04_DESIGN.md:574` asserted at `tests:310-317,409-418`); the flow was compared against the frozen Design line by line; the helpers' semantics were checked in the shared module and upstream; the suite was re-run first-hand (21/0); gate freshness was proved by mtime ordering; the task-local check was verified to be genuinely proven by the fake launcher's recorded call log rather than by a mock's return value.

MEDIUM, not claimed as HIGH: everything that requires a real browser or the live site — `EDITOR_URL`/selector/toast drift, the security question of Playwright's own error text, the one-line guarantee outside the session paths, and the paste wiring (residual risk 1-4). The task itself declares the same bound (`## Solution` §Confidence level), and finding 1 is the concrete cost of that bound.

**Next:** no action required inside this task — accept R1-R6/AC1-AC3 as traced and the four disclosed divergences as recorded; finding 1 is deferred to 0191 (infoq live-site signal pass), findings 2-5 are advisory and need no disposition.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-05T13:42:18.064Z todo → wip (system)
- 2026-10-05T14:14:34.762Z wip → testing (system)
- 2026-10-05T14:15:09.047Z testing → done (system)

