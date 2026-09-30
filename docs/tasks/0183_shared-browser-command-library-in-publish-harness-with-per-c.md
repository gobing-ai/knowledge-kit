---
schema_version: 1
name: Shared browser command library in publish-harness with per-channel transport verdict
status: todo
template: feature-impl
created_at: 2026-09-30T04:05:03.970Z
updated_at: "2026-09-30T05:04:33.522Z"
feature_id: E91
priority: P1
tags:
  - publish
  - browser
  - harness
estimate_hours: 4

---

## 0183. Shared browser command library in publish-harness with per-channel transport verdict

### Background

Every browser publisher needs the same plumbing — profile-dir resolution, a login/check CLI, polling, editor input, observed-outcome — and `xhs-pub`/`wechatmp-pub` each re-implement it. This task adds the shared module the four new channel flows build on, and records the per-channel transport verdict.

Implements: R1 — Each listed publisher carries a recorded transport verdict with its reason; R2 — Shared browser library resolves channel profiles and exposes a login and check CLI; R3 — Shared editor helpers insert article bodies into rich and markdown editors; R4 — Publish results report success only after the browser shows the outcome; R12 — Medium browser fallback stays deferred until the token path stops working

Design satellite: `docs/design/browser-publish-channels.md` (ADR-027, feature E91).

**Refine corrections (2026-09-29)**

- "`ts-browser-automation` is already a root dependency; no new package in the lockfile" → it is a root **catalog** entry (`package.json:19`, `workspaces.catalog`), not a dependency; Bun's isolated store links only declared deps (`packages/publish-harness/node_modules/@gobing-ai/` holds only `kk-core`) → R1 now adds `"@gobing-ai/ts-browser-automation": "catalog:"` to `packages/publish-harness/package.json` + step-0 `bun install`. The version is already in `bun.lock`, so the lockfile gains a workspace edge, not a package.
- "`checkChannelSession` headless, read-only" returning `{ok}` → the only production precedent (`plugins/publishings/xhs-pub/src/index.ts:429-460`) is headless-then-headed because XHS bot-walls headless loads, and returns `{status, profileDir, detail}` → shared helper mirrors that shape with a `headedFallback` flag (default true for the `check` CLI; new channels pass false for the publish preflight).
- "`runProfileCli` rewires xhs and wechatmp" → wechatmp login captures `storageState` and its transport re-injects cookies (`plugins/publishings/wechatmp-pub/src/index.ts:181-206,274`); xhs `main()` carries the ADR-025 guard → `runProfileCli` is for the four new channels only; 0184 scope narrowed accordingly.
- `withProfilePage` defaults to headed (`@gobing-ai/ts-browser-automation@0.5.11`) → publish flows pass `headless` explicitly (documented in Design).
- 04 surfaces that go stale were not listed → R4 names `docs/04_DESIGN.md:41,397,440-450,479,497-512` and the superseded note in `docs/design/remaining-wt-publish-harvest.md:34,43-48`.

### Requirements

- [ ] R1. Add `packages/publish-harness/src/browser.ts`, exported as `"./browser": "./src/browser.ts"` in `packages/publish-harness/package.json`, which also gains `"@gobing-ai/ts-browser-automation": "catalog:"` under `dependencies` (`playwright` stays a `catalog:` devDependency; `Page` is a type-only import).
- [ ] R2. Provide `resolveChannelProfileDir(channel, override?)` with precedence `override` > `<CHANNEL>_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir(channel)`; `checkChannelSession(config, opts)` returning `{status: 'verified'|'refused', profileDir, detail}` (headless probe, one headed retry unless `headedFallback: false`; a missing profile is refused, never created); and `runProfileCli(config, argv?, deps?)` for `login` (headed `loginWithProfile`) and `check` (`checkChannelSession`), accepting `--profile <dir>` and `--timeout <ms>`, returning exit code 0 verified / 1 refused / 2 usage error.
- [ ] R3. Provide `waitUntil(predicate, timeoutMs, pollMs = 500)`, `pasteHtml(page, selector, html)` (synthetic `ClipboardEvent('paste')` carrying `text/html` + `text/plain`, then verifies the editor text is non-empty), `fillCodeMirror(page, selector, markdown)` (CodeMirror 6 `view.dispatch` → CodeMirror 5 `CodeMirror.setValue` → `keyboard.insertText` fallback), `uploadFile(page, selector, filePath)` (attached `input[type=file]`, visibility not required), `expectOutcome(probe, {timeoutMs, label})`, and `markdownToHtml` = `Bun.markdown.html`. Every helper failure throws `Error` whose message names the selector (or label) and the timeout.
- [ ] R4. Update `docs/04_DESIGN.md`: the per-plugin transport verdict table with reasons (infoq, juejin, medium, qiita, substack, x post/article, zenn, xhs, wechatmp) and the Medium browser-fallback deferral (medium section ~:479); the `@gobing-ai/publish-harness/browser` export table beside ~:440-450; the `KK_BROWSER_PROFILE_DIR` row :397 (driver `script`, add `x-pub` article tier); the design-index row :41 stays `planned (E91, ADR-027)` until the last channel task ships. Add a "superseded by ADR-027 for juejin/substack/infoq/x-article" note to `docs/design/remaining-wt-publish-harvest.md` at D13 (:34) and the per-channel policy rows (:43-48).
- [ ] R5. The main `@gobing-ai/publish-harness` entry (`src/index.ts`) does not import `./browser` or `@gobing-ai/ts-browser-automation`, so API-only plugins never load it.

Out of scope: site selectors or flows (E91-D3, per-channel tasks 0185-0188); migrating xhs/wechatmp (0184); an automation guard (E91-D7); a Medium browser transport (deferred, R12).

### Acceptance Criteria

- [ ] AC1 — Each listed publisher carries a recorded transport verdict with its reason (req: R4)
- [ ] AC2 — Shared browser library resolves channel profiles and exposes a login and check CLI (req: R1, R2, R5)
- [ ] AC3 — Shared editor helpers insert article bodies into rich and markdown editors (req: R3)
- [ ] AC4 — Publish results report success only after the browser shows the outcome (req: R3)
- [ ] AC5 — Medium browser fallback stays deferred until the token path stops working (req: R4)

Task-local check: importing `@gobing-ai/publish-harness` (main entry) does not load `ts-browser-automation` (test layer: `packages/publish-harness/tests/browser.test.ts`, source-import assertion).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T05:04:33.521Z

- **Q: Root dependency or per-workspace?** Closed: per-workspace `catalog:` entries; the root only holds the catalog and Bun's isolated store does not hoist. Version already locked.
- **Q: Session check shape?** Closed: `{status, profileDir, detail}` with headless→headed fallback, copied from the only production precedent (xhs); new channels disable the fallback for publish preflight so an automated run never pops an unexpected window before the flow itself opens.
- **Q: Does `runProfileCli` cover xhs/wechatmp?** Closed: no — xhs keeps its guard-wrapped `main()`, wechatmp keeps storageState login. Helper serves the four new channels.
- **Q: Where does the verdict live?** Closed: `docs/04_DESIGN.md` (surface) with rationale in `docs/design/browser-publish-channels.md` §1; ADR-027 already records the decision.
- Deferred: upstreaming `browser.ts` into `@gobing-ai/ts-browser-automation` — owner Robin, condition: API stable across all four channels.

### Design

Approach: one `browser.ts` module behind a `./browser` sub-path export of `@gobing-ai/publish-harness` (E91-D2). Reason: harvest D1 already placed session helpers in the harness; a sub-path keeps API plugins free of browser code; a separate package fails the deletion test.

Rejected: new `packages/publish-browser`; upstreaming into ts-libs now (promote once stable); adding `marked` (Bun built-in suffices — E91-D4, `Bun.markdown.html` verified for GFM tables, fenced code, task lists on Bun 1.3.14); exporting upstream's internal `pollPredicate` (not public in 0.5.11).

Frozen surface (`packages/publish-harness/src/browser.ts`):

```ts
export interface ChannelBrowserConfig {
    channel: string;                            // 'infoq' → INFOQ_PROFILE_DIR
    homeUrl: string;                            // page opened for login/check
    isAuthenticated: IsAuthenticatedPredicate;  // re-exported upstream type
    loginTimeoutMs?: number;                    // default 180_000
}
export interface ChannelSessionResult { status: 'verified' | 'refused'; profileDir: string; detail: string }
export function resolveChannelProfileDir(channel: string, override?: string): string;
export function checkChannelSession(config: ChannelBrowserConfig, opts: { profileDir: string; launcher?: BrowserLauncher; headedFallback?: boolean; timeoutMs?: number }): Promise<ChannelSessionResult>;
export function runProfileCli(config: ChannelBrowserConfig, argv?: string[], deps?: { launcher?: BrowserLauncher; stdout?: (line: string) => void }): Promise<number>;
export function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number, pollMs?: number): Promise<boolean>;
export function pasteHtml(page: Page, selector: string, html: string, opts?: { timeoutMs?: number }): Promise<void>;
export function fillCodeMirror(page: Page, selector: string, markdown: string, opts?: { timeoutMs?: number }): Promise<void>;
export function uploadFile(page: Page, selector: string, filePath: string, opts?: { timeoutMs?: number }): Promise<void>;
export function expectOutcome(probe: () => Promise<string | null>, opts: { timeoutMs: number; label: string; pollMs?: number }): Promise<{ ok: true; evidence: string } | { ok: false; error: string }>;
export const markdownToHtml: (markdown: string) => string;
```

Algorithms:
- `resolveChannelProfileDir`: env key `${channel.toUpperCase()}_PROFILE_DIR`; blank strings count as unset; final tier delegates to existing `resolveBrowserProfileDir` (`packages/publish-harness/src/index.ts:231`), which already validates/expands.
- `checkChannelSession`: loop `headless of [true, false]` (second pass only when `headedFallback !== false`) calling upstream `withProfilePage({profileDir, headless, url: homeUrl, isAuthenticated, timeoutMs, launcher}, () => true)`; `BrowserProfileMissingError` → refused immediately (no headed retry); other errors on the last pass → refused with the error message. Detail strings contain the profile dir path only (ADR invariant 1). Mirrors `plugins/publishings/xhs-pub/src/index.ts:429-460`.
- `runProfileCli`: parse with `node:util` `parseArgs` (as xhs `profile-check.ts`); `login` → `loginWithProfile({profileDir, url: homeUrl, isAuthenticated, timeoutMs, launcher})` then print verified line; `check` → `checkChannelSession`; upstream typed errors map to one-line messages, never stacks.
- `waitUntil`: same semantics as the xhs local (`plugins/publishings/xhs-pub/src/index.ts:356`) — poll until deadline, then one final predicate call.
- `expectOutcome`: `waitUntil` over `probe() !== null`; timeout → `{ok:false, error: '<label>: no outcome observed within <ms>ms'}` (E91-D6).

Anti-patterns: no site selectors or URLs in the module (E91-D3); no cookies/storageState handling (wechatmp keeps its own); no `console.*` (return strings / injected `stdout`); no value import of `playwright` (type-only); `index.ts` must not re-export browser code (R5).

Handoff: 0184 consumes `resolveChannelProfileDir`, `waitUntil`, `checkChannelSession`; 0185-0188 consume the whole surface and add their own `catalog:` deps. Signature changes after this task require updating dependents in the same change.

Test layer: `packages/publish-harness/tests/browser.test.ts` with a fake `BrowserLauncher` (returns a fake context/page recording calls) and a fake `Page` exposing `evaluate`/`locator`/`keyboard`/`setInputFiles`; env precedence tests save/restore `process.env`.

### Plan

- [ ] 0. Precondition: add the `catalog:` dependency and `./browser` export to `packages/publish-harness/package.json`, run `bun install`, confirm `packages/publish-harness/node_modules/@gobing-ai/ts-browser-automation` resolves. (R1)
- [ ] 1. Write the failure list first as `browser.test.ts` cases: precedence each tier + blank env; missing profile headless → refused without headed retry; headless refused then headed verified; `headedFallback:false` single pass; CLI unknown verb → 2; login/check exit codes; selector never attaches → error names selector+timeout; paste leaves editor empty → error; CodeMirror 6/5/keyboard fallback order; upload on hidden input; outcome timeout → `{ok:false}`; `markdownToHtml` table output. (R2, R3)
- [ ] 2. Implement `src/browser.ts` to the frozen surface until the suite passes. (R1-R3)
- [ ] 3. Add a test asserting `src/index.ts` source contains no `./browser` / `ts-browser-automation` import. (R5)
- [ ] 4. Docs: 04 verdict table + Medium deferral + export table + env row; superseded notes in `remaining-wt-publish-harvest.md`. (R4)
- [ ] 5. `bun run lint`, `bun run test`, `bun run build`; `spur rule run` via `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
