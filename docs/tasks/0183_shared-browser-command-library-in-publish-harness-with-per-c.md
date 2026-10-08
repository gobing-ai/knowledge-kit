---
schema_version: 1
name: Shared browser command library in publish-harness with per-channel transport verdict
status: done
template: feature-impl
created_at: 2026-09-30T04:05:03.970Z
updated_at: "2026-10-08T01:34:25.883Z"
feature_id: E91
priority: P1
tags:
  - publish
  - browser
  - harness
estimate_hours: 4

done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/knowledge-kit-runall-E91-48d71d0b/.spur/memory/evidence/0183-verdict.json
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

- [x] R1. Add `packages/publish-harness/src/browser.ts`, exported as `"./browser": "./src/browser.ts"` in `packages/publish-harness/package.json`, which also gains `"@gobing-ai/ts-browser-automation": "catalog:"` under `dependencies` (`playwright` stays a `catalog:` devDependency; `Page` is a type-only import).
- [x] R2. Provide `resolveChannelProfileDir(channel, override?)` with precedence `override` > `<CHANNEL>_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir(channel)`; `checkChannelSession(config, opts)` returning `{status: 'verified'|'refused', profileDir, detail}` (headless probe, one headed retry unless `headedFallback: false`; a missing profile is refused, never created); and `runProfileCli(config, argv?, deps?)` for `login` (headed `loginWithProfile`) and `check` (`checkChannelSession`), accepting `--profile <dir>` and `--timeout <ms>`, returning exit code 0 verified / 1 refused / 2 usage error.
- [x] R3. Provide `waitUntil(predicate, timeoutMs, pollMs = 500)`, `pasteHtml(page, selector, html)` (synthetic `ClipboardEvent('paste')` carrying `text/html` + `text/plain`, then verifies the editor text is non-empty), `fillCodeMirror(page, selector, markdown)` (CodeMirror 6 `view.dispatch` → CodeMirror 5 `CodeMirror.setValue` → `keyboard.insertText` fallback), `uploadFile(page, selector, filePath)` (attached `input[type=file]`, visibility not required), `expectOutcome(probe, {timeoutMs, label})`, and `markdownToHtml` = `Bun.markdown.html`. Every helper failure throws `Error` whose message names the selector (or label) and the timeout.
- [x] R4. Update `docs/04_DESIGN.md`: the per-plugin transport verdict table with reasons (infoq, juejin, medium, qiita, substack, x post/article, zenn, xhs, wechatmp) and the Medium browser-fallback deferral (medium section ~:479); the `@gobing-ai/publish-harness/browser` export table beside ~:440-450; the `KK_BROWSER_PROFILE_DIR` row :397 (driver `script`, add `x-pub` article tier); the design-index row :41 stays `planned (E91, ADR-027)` until the last channel task ships. Add a "superseded by ADR-027 for juejin/substack/infoq/x-article" note to `docs/design/remaining-wt-publish-harvest.md` at D13 (:34) and the per-channel policy rows (:43-48).
- [x] R5. The main `@gobing-ai/publish-harness` entry (`src/index.ts`) does not import `./browser` or `@gobing-ai/ts-browser-automation`, so API-only plugins never load it.

Out of scope: site selectors or flows (E91-D3, per-channel tasks 0185-0188); migrating xhs/wechatmp (0184); an automation guard (E91-D7); a Medium browser transport (deferred, R12).

### Acceptance Criteria

- [x] AC1 — Each listed publisher carries a recorded transport verdict with its reason (req: R4)
- [x] AC2 — Shared browser library resolves channel profiles and exposes a login and check CLI (req: R1, R2, R5)
- [x] AC3 — Shared editor helpers insert article bodies into rich and markdown editors (req: R3)
- [x] AC4 — Publish results report success only after the browser shows the outcome (req: R3)
- [x] AC5 — Medium browser fallback stays deferred until the token path stops working (req: R4)

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

- [x] 0. Precondition: add the `catalog:` dependency and `./browser` export to `packages/publish-harness/package.json`, run `bun install`, confirm `packages/publish-harness/node_modules/@gobing-ai/ts-browser-automation` resolves. (R1)
- [x] 1. Write the failure list first as `browser.test.ts` cases: precedence each tier + blank env; missing profile headless → refused without headed retry; headless refused then headed verified; `headedFallback:false` single pass; CLI unknown verb → 2; login/check exit codes; selector never attaches → error names selector+timeout; paste leaves editor empty → error; CodeMirror 6/5/keyboard fallback order; upload on hidden input; outcome timeout → `{ok:false}`; `markdownToHtml` table output. (R2, R3)
- [x] 2. Implement `src/browser.ts` to the frozen surface until the suite passes. (R1-R3)
- [x] 3. Add a test asserting `src/index.ts` source contains no `./browser` / `ts-browser-automation` import. (R5)
- [x] 4. Docs: 04 verdict table + Medium deferral + export table + env row; superseded notes in `remaining-wt-publish-harvest.md`. (R4)
- [x] 5. `bun run lint`, `bun run test`, `bun run build`; `spur rule run` via `bun run gate`.

### Solution

Implemented the shared browser command library behind a new `@gobing-ai/publish-harness/browser` sub-path export (R1), with the per-channel transport verdict recorded in the design surface (R4). Test-first: the failure list from Plan step 1 was written as `tests/browser.test.ts` before `src/browser.ts` existed.

| File:line | Change |
| --------- | ------ |
| `packages/publish-harness/package.json:7` | `./browser` sub-path export → `./src/browser.ts` (R1) |
| `packages/publish-harness/package.json:15` | `@gobing-ai/ts-browser-automation: catalog:` under `dependencies`; `playwright` stays a `catalog:` devDependency (type-only import). The `bun install` this step requires rewrites `bun.lock` with the workspace edge for that dependency (versions already locked — no new package) **plus one unrelated, correct hunk**: `apps/cli` workspace version `0.0.28` → `0.0.31`, stale in the lock against the release commit `37c84af5` (`apps/cli/package.json` is `0.0.31`), re-synced as a side effect of the same install (R1) |
| `packages/publish-harness/package.json:16` | `@gobing-ai/ts-utils: catalog:` under `dependencies` — the sanctioned output seam the `no-raw-stdout-stderr` rule points at; workspace edge only, version already locked |
| `packages/publish-harness/src/browser.ts:14` | Re-exports the upstream `BrowserLauncher` / `IsAuthenticatedPredicate` types so channel plugins keep one import for the config and deps seams (TSDoc line above it) |
| `packages/publish-harness/src/browser.ts:28` | Frozen `ChannelBrowserConfig` — `{ channel, homeUrl, isAuthenticated, loginTimeoutMs? }` (R2) |
| `packages/publish-harness/src/browser.ts:40` | Frozen `ChannelSessionResult` — `{ status: 'verified' \| 'refused', profileDir, detail }` (R2) |
| `packages/publish-harness/src/browser.ts:53` | `ChannelSessionOptions` — `{ profileDir, launcher?, headedFallback?, timeoutMs? }` (R2); its TSDoc block at `packages/publish-harness/src/browser.ts:49` clears the `every-export-has-tsdoc` hit the post-check gate reported at this line |
| `packages/publish-harness/src/browser.ts:68` | `ProfileCliDeps` — `{ launcher?, stdout? }`, the injected output seam that keeps `console.*` out of this module; its TSDoc block at `packages/publish-harness/src/browser.ts:64` clears the second `every-export-has-tsdoc` hit |
| `packages/publish-harness/src/browser.ts:75` | Login deadline default `180_000` (`ChannelBrowserConfig.loginTimeoutMs`) |
| `packages/publish-harness/src/browser.ts:80` | Session-check deadline default `30_000` per pass — the `xhs-pub` `PREFLIGHT_TIMEOUT_MS` scale the check mirrors, not the interactive login wait |
| `packages/publish-harness/src/browser.ts:92` | `resolveChannelProfileDir(channel, override?)` — `override` > `<CHANNEL>_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir(channel)`; blank tiers count as unset, nothing is created (R2) |
| `packages/publish-harness/src/browser.ts:107` | `checkChannelSession(config, opts)` — headless `withProfilePage` probe, one headed retry unless `headedFallback: false`; `BrowserProfileMissingError` refuses immediately (no headed retry, no fabricated profile); detail carries the profile-dir path only (R2, ADR invariant 1) |
| `packages/publish-harness/src/browser.ts:158` | `runProfileCli(config, argv?, deps?)` — `node:util` `parseArgs`, `--profile` / `--timeout`; `login` = headed `loginWithProfile`, `check` = `checkChannelSession`; exit 0 verified / 1 refused / 2 usage error (unknown verb or bad `--timeout`), one line per message via `deps.stdout` (R2) |
| `packages/publish-harness/src/browser.ts:166` | Default writer of those lines is the ts-utils `echo` seam (no `process.stdout.write`, no `console.*`); `deps.stdout` stays the injected override |
| `packages/publish-harness/src/browser.ts:229` | `waitUntil(predicate, timeoutMs, pollMs = 500)` — poll to the deadline then one final predicate call, matching the xhs local |
| `packages/publish-harness/src/browser.ts:251` | `pasteHtml(page, selector, html, opts?)` — synthetic `ClipboardEvent('paste')` carrying `text/html` + `text/plain`, then polls the editor text non-empty; failure names selector + timeout (R3) |
| `packages/publish-harness/src/browser.ts:274` | `fillCodeMirror(page, selector, markdown, opts?)` — CodeMirror 6 `view.dispatch` → CodeMirror 5 `setValue` → `keyboard.insertText` fallback (R3) |
| `packages/publish-harness/src/browser.ts:296` | `uploadFile(page, selector, filePath, opts?)` — attached `input[type=file]` via `setInputFiles`; visibility never consulted (R3) |
| `packages/publish-harness/src/browser.ts:311` | `expectOutcome(probe, { timeoutMs, label, pollMs? })` — `{ ok: true, evidence }` / `{ ok: false, error: '<label>: no outcome observed within <ms>ms' }`; a probe that fires without a signal (empty string) is not success (R3, E91-D6, AC4) |
| `packages/publish-harness/src/browser.ts:337` | `markdownToHtml` = `Bun.markdown.html` (E91-D4) |
| `packages/publish-harness/src/browser.ts:340` | `requireAttached` — shared attach poll whose error names the helper, selector, and timeout |
| `packages/publish-harness/src/browser.ts:359` | Browser-side paste script; `text/plain` derived from the HTML (strings, not function callbacks, because the harness tsconfig has no DOM lib) |
| `packages/publish-harness/src/browser.ts:383` | Browser-side CodeMirror script with the CM6 → CM5 → keyboard order; `view.dispatch` replaces the full document range |
| `packages/publish-harness/tests/browser.test.ts:35` | Fake `Page` exposing only `locator` / `evaluate` / `keyboard` / `setInputFiles`, recording every call so the DOM path taken is assertable |
| `packages/publish-harness/tests/browser.test.ts:78` | Fake `BrowserLauncher` returning a recording context (`pages` / `newPage` / `close`); `onLaunch` throws to simulate refusals, so no real browser is ever launched |
| `packages/publish-harness/tests/browser.test.ts:112` | Env save/restore hooks for `INFOQ_PROFILE_DIR` / `KK_BROWSER_PROFILE_DIR` (cleared per case, originals restored) |
| `packages/publish-harness/tests/browser.test.ts:124` | Precedence cases: default tier, override > channel > shared, blank tier falls through |
| `packages/publish-harness/tests/browser.test.ts:152` | Session cases: headless verified, missing profile refused with no headed retry (one launch), headless-then-headed verified, `headedFallback: false` single pass |
| `packages/publish-harness/tests/browser.test.ts:202` | CLI cases: unknown verb → 2, bad `--timeout` → 2, `login` 0/1, `check` 0/1 |
| `packages/publish-harness/tests/browser.test.ts:275` | Default-writer case: no `stdout` dep, so the line goes to the ts-utils stdout target, captured with `createBufferTarget()` + `setDefaultOutputTargets()` (the `apps/cli/tests/capture.ts` pattern) and restored in `finally` |
| `packages/publish-harness/tests/browser.test.ts:280` | `waitUntil` before-deadline and trailing-call semantics |
| `packages/publish-harness/tests/browser.test.ts:304` | `pasteHtml`: clipboard payload carries the HTML, empty editor throws, never-attached selector throws (both named selector + timeout) |
| `packages/publish-harness/tests/browser.test.ts:327` | `fillCodeMirror`: CM6/CM5 attempt order asserted on the emitted script, no keyboard insert when an editor API runs, keyboard fallback, vanished element throws |
| `packages/publish-harness/tests/browser.test.ts:367` | `uploadFile`: hidden input is set without an `isVisible` call; missing input throws |
| `packages/publish-harness/tests/browser.test.ts:384` | `expectOutcome`: evidence returned, empty probe result skipped, timeout reports label + ms |
| `packages/publish-harness/tests/browser.test.ts:404` | `markdownToHtml` renders a GFM table through Bun |
| `packages/publish-harness/tests/browser.test.ts:413` | R5 source-import assertion: `src/index.ts` contains no `./browser` and no `ts-browser-automation` import |
| `docs/04_DESIGN.md:407` | `KK_BROWSER_PROFILE_DIR` row now names the `script` driver and `resolveChannelProfileDir` tiers (blank = unset) (R4) |
| `docs/04_DESIGN.md:462` | New `@gobing-ai/publish-harness/browser` export table beside the package table — every frozen export, its kind, and its notes (R4) |
| `docs/04_DESIGN.md:487` | New per-publisher transport verdict table with reasons: infoq, juejin, substack, x-pub article (Implement), x-pub post, medium, qiita, zenn (Keep), xhs, wechatmp (Migrate plumbing) (R4, AC1) |
| `docs/04_DESIGN.md:541` | Medium section records the browser fallback as deferred until the token path stops accepting posts (R4, R12, AC5) |
| `docs/04_DESIGN.md:41` | Design-index row left at `planned (E91, ADR-027)` as required until the last channel task ships (R4) |
| `docs/design/remaining-wt-publish-harvest.md:34` | D13 superseded by ADR-027 for `juejin`/`substack`/`infoq`/`x-pub` `article` — those ship as `script` flows, not `agent` (R4) |
| `docs/design/remaining-wt-publish-harvest.md:45` | Per-channel policy rows for x-pub `article`, juejin, substack, infoq now read `script` with an explicit `superseded by ADR-027` marker (R4) |

Deviations from the task text, both inside the frozen surface: (1) the check deadline defaults to 30s per pass (documented at `packages/publish-harness/src/browser.ts:80`) because the design gives no check default and names the xhs preflight as the mirror; (2) `expectOutcome` treats an empty-string probe result as "no outcome observed" rather than success, since `{ ok: true, evidence: '' }` would report an outcome the browser never showed (E91-D6). Doc anchors had shifted by ~+10 lines from the numbers in `## Requirements`: the `KK_BROWSER_PROFILE_DIR` row is at `docs/04_DESIGN.md:407` (was cited `:397`), the medium section at `:541` (cited `:479`), and the harvest policy rows at `:45-48` (cited `:43-48`); edits landed at the semantically correct locations. The two doc files were left out of scope for `x-pub`/leftover-CMS module sections that still describe today's `agent` stubs — those are owned by the channel tasks 0184-0188.

**Verification confidence: HIGH** for the library contract and the recorded verdict (AC1, AC2, AC5): the frozen surface is implemented verbatim, `bun run lint` (Biome 2.5.5 + typecheck, all workspaces) is clean, and the 32 targeted cases cover every Plan step-1 failure plus the R5 source-import assertion.

**Verification confidence: MEDIUM** for the live-page effect of the editor helpers (AC3, AC4): they are proven against a fake `Page` and fake `BrowserLauncher` only — no real ProseMirror/CodeMirror editor and no real upload input was driven, which is the per-channel dogfood owned by tasks 0185-0188. Success is still gated on an observed browser signal by construction (`expectOutcome`, `pasteHtml` non-empty verification), but that gate itself is fake-tested here.

**Uncertainty scan:** `grep -nEi "it could|could|might|maybe|probably|likely|seems|appears|should work|presumably|perhaps|possibly|I think|assume"` over every changed file returns 0 hedges authored by this change; the literal phrase "it could" does not occur anywhere in the change. The only `appears` hits in the touched files are pre-existing untouched text (`docs/04_DESIGN.md:176`, `docs/design/remaining-wt-publish-harvest.md:22`, both outside this diff's hunks) where it means "a consumer exists".

**Gate re-check (test-fix stage):** `packages/publish-harness/src/browser.ts:163`, `packages/publish-harness/src/browser.ts:166` — the `runProfileCli` default writer is now the ts-utils `echo` seam instead of `process.stdout.write`, so `bun run test-pre-check` (the exact preset that failed) prints `All 53 rules passed — no violations found.` and exits 0: no suppression, no rule edit, no `console.*` swap.
`packages/publish-harness/tests/browser.test.ts:275` — the default-writer case captures the ts-utils stdout target with `createBufferTarget()` + `setDefaultOutputTargets()` and restores it in `finally`, asserting the usage line the seam received (replacing the earlier real-stdout print).
`packages/publish-harness/src/browser.ts:158` — measured result: the single-file run reports `32 pass, 0 fail, 68 expect() calls`; its nonzero exit code is `bunfig.toml`'s aggregate `coverageThreshold` (90%) applied to a single-file subset (`packages/publish-harness/src/index.ts` is only 29.66% covered there) — an unrelated file shows the identical pattern (`bun test packages/kk-core/tests/index.test.ts` → 2 pass / 0 fail / exit 1) — while the package-scoped run `bun test packages/publish-harness` exits 0 with `49 pass, 0 fail`.

**Stage confidence (test-fix):** HIGH for the gate fix — `packages/publish-harness/src/browser.ts:166` writes through the ts-utils `echo` seam (the `no-raw-stdout-stderr` hit the attempt-1 gate logged at old line 149 is gone; `grep -rn "process\.(stdout|stderr)\.write" packages/publish-harness/ --include=*.ts` → 0 hits), `packages/publish-harness/package.json:16` declares the dependency, and the exact failing gate now exits 0 (`All 53 rules passed — no violations found.`). No suppression of any kind was used.
**Stage confidence (test-fix): MEDIUM** for the full-repo gate — `bun run test` / `bun run gate` were deliberately not run in this stage, so the single-file exit 1 (`packages/publish-harness/tests/browser.test.ts` → 32 pass / 0 fail, exit 1 from bunfig's aggregate coverage threshold) is diagnosed and reproduced on an unrelated file but is confirmed only by the pipeline's test-recheck.
**Uncertainty phrases:** none — `grep -nEi "it could|could|might|maybe|probably|likely|seems|appears|should work|presumably|perhaps|possibly|I think|assume"` over the changed files, every added diff line, and the stage artifact returns 0 matches.

**Gate re-check (test-fix attempt 2):** the `every-export-has-tsdoc` errors at the old `:44`/`:53` are cleared by TSDoc blocks now at `packages/publish-harness/src/browser.ts:49` and `packages/publish-harness/src/browser.ts:64`, and the whole file was swept — all 14 exported symbols documented, including the re-export at `packages/publish-harness/src/browser.ts:14` and the `ChannelSessionResult` fields at `packages/publish-harness/src/browser.ts:40`.
`bun run test-post-check:full` evaluates both preset rules live — `▶ [2/2] every-export-has-tsdoc (tsdoc-export) ✓ passed`; the rule is provably active, not vacuous: a throwaway `packages/publish-harness/src/__tsdoc-probe.ts` with one undocumented export made it fail (`Exported const "tsdocProbe" is missing a doc comment`), and the probe file was deleted afterwards.
Measured: `bun run test-post-check` → `All 2 rules passed — no violations found.` exit 0; `bun run test-pre-check` → `All 53 rules passed` exit 0; `bun test packages/publish-harness/tests/browser.test.ts` → 32 pass / 0 fail; `bun test packages/publish-harness` → 49 pass / 0 fail exit 0; `bun run lint` exit 0. Confidence HIGH (all four gates are command exit codes, and the rule was falsification-tested); the only bound is that `bun run spur-check` itself was left to the pipeline's recheck. Uncertainty phrases: none.

**Repair-stage confidence: HIGH** for both items of this bounded stage. The six `## Plan` steps (`docs/tasks/0183_shared-browser-command-library-in-publish-harness-with-per-c.md:112` … `:117`) are now `- [x]` with step text byte-identical apart from the checkbox prefix (verified by comparing the prefix-stripped text before and after), and each is backed by delivered artifacts: `packages/publish-harness/package.json:7`, `packages/publish-harness/package.json:15`, `packages/publish-harness/package.json:16`, the lock edges at `bun.lock:48` and `bun.lock:15`, `packages/publish-harness/src/browser.ts:14`, `packages/publish-harness/tests/browser.test.ts:275`, `docs/04_DESIGN.md:462`, `docs/04_DESIGN.md:487`, `docs/04_DESIGN.md:541`, `docs/design/remaining-wt-publish-harvest.md:34`.
The single clause with no evidence in the pipeline gate log was `bun run build` — the pipeline ran `bun run spur-check`, not `bun run gate` — so it was executed directly before ticking (`@gobing-ai/knowledge-kit build: Bundled 366 modules in 23ms`, Exited with code 0): no box rests on an assumption. The P4 disclosure fix is in `docs/tasks/0183_shared-browser-command-library-in-publish-harness-with-per-c.md:126`, stating the observed versions (`apps/cli` `0.0.28` → `0.0.31`, `apps/cli/package.json` at `0.0.31`) and the release commit rather than hedging.
**Repair-stage confidence: MEDIUM** for the claim that no unchecked-box residual remains: the sweep also counted 2 P3 review findings, which live in `## Review` — a section this stage is forbidden to edit and which the review coordinator owns, so their closure is that coordinator's act, not a fact this stage can verify.
**Uncertainty phrases:** none introduced by this stage — the `grep -nEi "it could|could|might|maybe|probably|likely|seems|appears|should work|presumably|perhaps|possibly|I think|assume"` sweep over the added lines returns 0 matches, and the recorded verify verdict is `PARTIAL` with `confidence: HIGH` (`.spur/run/0183-verdict.json`), whose residual cause is exactly what this stage repaired.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/publish-harness/package.json:7` exports `"./browser": "./src/browser.ts"`; `:16` `@gobing-ai/ts-browser-automation` `catalog:` under dependencies; `:21` `playwright` `catalog:` devDependency; `packages/publish-harness/src/browser.ts:14` imports `Page` type-only. |
| R2 | MET | `packages/publish-harness/src/browser.ts:168` `resolveChannelProfileDir` (override > `<CHANNEL>_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > default; blank = unset); `packages/publish-harness/src/browser.ts:183` `checkChannelSession` returning `{status, profileDir, detail}`, headless then headed retry unless `headedFallback:false`, missing profile refused; `packages/publish-harness/src/browser.ts:239` `runProfileCli` login/check exit 0/1/2. Tests `packages/publish-harness/tests/browser.test.ts:134`, `packages/publish-harness/tests/browser.test.ts:162`, `packages/publish-harness/tests/browser.test.ts:226`. |
| R3 | MET | `packages/publish-harness/src/browser.ts:317` `waitUntil(predicate, timeoutMs, pollMs=500)` with trailing evaluation; `packages/publish-harness/src/browser.ts:339` `pasteHtml` (synthetic paste + non-empty check); `packages/publish-harness/src/browser.ts:363` `fillCodeMirror` (CM6 → CM5 → fill, non-empty assert); `packages/publish-harness/src/browser.ts:396` `uploadFile`; `packages/publish-harness/src/browser.ts:411` `expectOutcome` (probe rejections caught); `packages/publish-harness/src/browser.ts:580` `markdownToHtml`. Tests `packages/publish-harness/tests/browser.test.ts:358`, `packages/publish-harness/tests/browser.test.ts:382`, `packages/publish-harness/tests/browser.test.ts:405`, `packages/publish-harness/tests/browser.test.ts:475`, `packages/publish-harness/tests/browser.test.ts:492`, `packages/publish-harness/tests/browser.test.ts:512`, `packages/publish-harness/tests/browser.test.ts:638`. |
| R4 | MET | `docs/04_DESIGN.md:769` per-plugin verdict table (Medium deferred row `docs/04_DESIGN.md:776`); Medium deferral paragraph `docs/04_DESIGN.md:817`; `@gobing-ai/publish-harness/browser` export table `docs/04_DESIGN.md:742` (rows updated this pass to current option surface); `KK_BROWSER_PROFILE_DIR` row `docs/04_DESIGN.md:657`. |
| R5 | MET | `packages/publish-harness/src/index.ts:1-3` imports only `node:os`, `node:path` and a `kk-core` type — no `./browser` and no ts-browser-automation; isolation test `packages/publish-harness/tests/browser.test.ts:647`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 [non-behavior] [R1] | MET | static-ref | `packages/publish-harness/package.json:7,16,21` re-read this pass. |
| AC2 [R2] | MET | test | `packages/publish-harness/tests/browser.test.ts:134` (precedence incl. blank tiers) and `packages/publish-harness/tests/browser.test.ts:162` (verified/refused, headed retry, `headedFallback:false`, missing profile never created) pass in the focused re-run. |
| AC3 [R3] | MET | test | `packages/publish-harness/tests/browser.test.ts:358`, `packages/publish-harness/tests/browser.test.ts:382`, `packages/publish-harness/tests/browser.test.ts:405`, `packages/publish-harness/tests/browser.test.ts:475`, `packages/publish-harness/tests/browser.test.ts:492` pass in the focused re-run (54 tests in the file, 0 fail). |
| AC4 [R4] | MET | test | `packages/publish-harness/tests/browser.test.ts:226` covers `runProfileCli` login/check/usage exit codes; surface documented at `docs/04_DESIGN.md:742-751`. |
| AC5 [non-behavior] [R12] | MET | static-ref | Medium stays `file-cli` with browser fallback deferred: `docs/04_DESIGN.md:776`, `docs/04_DESIGN.md:817`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0183

**Scope:** task 0183 working-tree change set — `packages/publish-harness/src/browser.ts` (new), `packages/publish-harness/tests/browser.test.ts` (new), `packages/publish-harness/package.json`, `bun.lock`, `docs/04_DESIGN.md`, `docs/design/remaining-wt-publish-harvest.md`, `docs/tasks/0183_*.md`
**Dimensions:** functional traceability (R1–R5, AC1–AC5), SECUA (security, efficiency, correctness, usability, architecture), architectural depth
**Verdict:** PASS — 0 blocker, 0 major, 2 minor, 5 advisory; every requirement traced to `file:line` evidence

**Independence.** This review reads the diff and both new files directly and re-derives evidence rather than accepting `## Solution` prose: re-ran `bun test packages/publish-harness` → `49 pass / 0 fail`, exit 0; `bun run test-pre-check` → `All 53 rules passed — no violations found.`, exit 0; re-derived the module's runtime export surface by importing it; and diffed the implementation against the installed `@gobing-ai/ts-browser-automation@0.5.11` type declarations. Doc anchors claimed in `## Solution` were re-checked line by line.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | correctness | The `keyboard` branch of `fillCodeMirror` has no post-condition: `keyboard.insertText` is awaited and the function returns `void` without confirming the editor received the text — unlike `pasteHtml`, which polls the editor non-empty. A stolen-focus no-op is reported as success, and a downstream flow that then clicks "save draft" can observe a draft id for an empty body. The task's frozen surface does not require this check, so 0185/0186 must assert the body (or the flow is a false-success path for AC4). | `packages/publish-harness/src/browser.ts:287-289` | FIXED — 5d3932de: fillCodeMirror keyboard branch now polls a non-empty post-condition and throws (packages/publish-harness/src/browser.ts:379-388, test browser.test.ts:454); expectOutcome catches probe rejections into ok:false (browser.ts:426, test browser.test.ts:512) (was: DEFER: 0185/0186 assert the body after fillCodeMirror) |
| 2 | P3 (minor) | correctness | `expectOutcome` advertises a Result-shaped return (`{ ok: false, error }`) but propagates probe exceptions: a `probe()` that rejects (e.g. `page.evaluate` while the page navigates) rejects `expectOutcome` instead of yielding `{ ok: false }`. Channel flows 0185-0188 must wrap the probe, or a transient DOM read turns the "never report unseen success" rail into an unhandled rejection. | `packages/publish-harness/src/browser.ts:311-333` | FIXED — 5d3932de: fillCodeMirror keyboard branch now polls a non-empty post-condition and throws (packages/publish-harness/src/browser.ts:379-388, test browser.test.ts:454); expectOutcome catches probe rejections into ok:false (browser.ts:426, test browser.test.ts:512) (was: DEFER: 0185-0188 wrap the expectOutcome probe) |
| 3 | P4 (advisory) | correctness (scope) | `bun.lock` carries a second, unrelated hunk: `apps/cli` version `0.0.28 → 0.0.31`. It is *correct* (the lock was stale against HEAD's release commit `37c84af5`; `apps/cli/package.json` is `0.0.31`), but the `## Solution` table says the lockfile "gains a workspace edge only", which under-discloses it. Diff reviewers should not have to rediscover this. | `bun.lock:15` | ACCEPT (advisory, no action) |
| 4 | P4 (advisory) | architecture | `browser.ts` imports `resolveBrowserProfileDir` from `./index`, so profile-dir precedence is split across two modules and every consumer of the `./browser` sub-path also loads the harness barrel. The coupling is directional (no cycle, R5 holds) and is deliberate reuse-over-fork; noted as a depth observation, not a defect. | `packages/publish-harness/src/browser.ts:11` | ACCEPT (advisory, no action) |
| 5 | P4 (advisory) | correctness (spec) | R1 names only `@gobing-ai/ts-browser-automation`, but `@gobing-ai/ts-utils` was also added to `dependencies`. This is required — the module's default CLI writer must use the sanctioned `echo` seam (`no-raw-stdout-stderr`, `.spur/rules/typescript/output-boundaries.yaml:49-55`) — and is disclosed in `## Solution`. Recorded so the literal-deviation is visible in review, not silent. | `packages/publish-harness/package.json:16` | ACCEPT (advisory, no action) |
| 6 | P4 (advisory) | efficiency | Handoff risk, not a defect here: `scripts/bundle-plugins.ts` marks only `playwright` external, so 0185-0188's `publish-harness/browser` imports will inline `@gobing-ai/ts-browser-automation` + `@gobing-ai/ts-utils` into each plugin bundle and rely on `playwright` resolving at run time. Same shape as `xhs-pub` today (0177/ADR-024), so accepted — but unverified by this task. | `scripts/bundle-plugins.ts:77` | ACCEPT (advisory, no action) |
| 7 | P4 (advisory) | usability | `runProfileCli` `check` writes a JSON verdict line and then, on refusal, a second human prose line to the same stdout, so stdout is not a single machine-readable document. The design says "one line per message", so this is per-spec; flagged as an operator-surface nit, not a bug. | `packages/publish-harness/src/browser.ts:217-221` | ACCEPT (advisory, no action) |

No P1 (blocker) and no P2 (major) findings.

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 — `src/browser.ts` + `./browser` export + `ts-browser-automation` dependency | MET | `package.json:6-7` (`"./browser": "./src/browser.ts"`), `package.json:15`, resolvable symlink `packages/publish-harness/node_modules/@gobing-ai/ts-browser-automation`; `playwright` stays a `catalog:` devDependency (`package.json:19`) and `Page` is `import type` (`src/browser.ts:10`); `bun.lock` gains workspace edges, not packages |
| R2 — `resolveChannelProfileDir` / `checkChannelSession` / `runProfileCli` | MET | `src/browser.ts:92-95` (override > `<CHANNEL>_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir`, blank = unset, no creation); `src/browser.ts:107-153` (headless probe + one headed retry unless `headedFallback:false`, `BrowserProfileMissingError` → immediate refusal, detail carries the profile dir only); `src/browser.ts:158-225` (`login|check`, `--profile`, `--timeout`, exit 0/1/2). Signature matches the installed upstream `.d.ts` (`withProfilePage` overloads, `loginWithProfile` options, `BrowserProfileMissingError`) — `src/browser.ts:14` re-exports the seam types. Extra exports `ChannelSessionOptions` (`:53`) and `ProfileCliDeps` (`:68`) are additive, no frozen export removed |
| R3 — editor/outcome helpers | MET | `waitUntil` `src/browser.ts:229-242` (poll to deadline then one final call, matching `plugins/publishings/xhs-pub/src/index.ts:356-362`); `pasteHtml` `:251-271` (ClipboardEvent with `text/html` + `text/plain`, then non-empty poll); `fillCodeMirror` `:274-291` (CM6 `view.dispatch` → CM5 `setValue` → `keyboard.insertText`, order asserted on the emitted script); `uploadFile` `:296-305` (`setInputFiles`, no visibility consult); `expectOutcome` `:311-334`; `markdownToHtml` `:337`; failures name selector/label + timeout via `requireAttached` `:340-350` |
| R4 — `docs/04_DESIGN.md` verdict table, export table, env row, index row, harvest notes | MET | `docs/04_DESIGN.md:407` env row (`script` driver, `resolveChannelProfileDir` tiers, blank = unset); `:462` `@gobing-ai/publish-harness/browser` export table (all 11 exports + 2 re-exported types); `:487` transport-verdict table with 10 publishers and reasons (infoq/juejin/substack/x-article Implement; x post/medium/qiita/zenn Keep; xhs/wechatmp Migrate plumbing); `:541` Medium fallback deferral; `:41` design-index row left at `planned (E91, ADR-027)`; `docs/design/remaining-wt-publish-harvest.md:34` D13 superseded note and `:45-48` four per-channel policy rows with explicit `superseded by ADR-027` markers |
| R5 — main entry stays browser-free | MET | `packages/publish-harness/src/index.ts:1-3` imports only `node:os`, `node:path`, and type-only `@gobing-ai/kk-core`; `grep -n "ts-browser-automation" src/index.ts` → 0 hits; regression test `packages/publish-harness/tests/browser.test.ts:413-419` |
| AC1 — recorded transport verdict per publisher | MET | `docs/04_DESIGN.md:487-502` — 10 rows, each with transport + verdict + reason |
| AC2 — profile resolution + `login`/`check` CLI | MET | `src/browser.ts:92`, `:107`, `:158`; `tests/browser.test.ts:124-151` (5 precedence cases incl. blank tier), `:202-278` (exit 0/1/2, unknown verb never launches, default ts-utils writer captured and restored) |
| AC3 — editor helpers insert bodies | MET (library grain) | `src/browser.ts:251`, `:274`; `tests/browser.test.ts:304-365` assert the emitted scripts and the failure messages against a fake `Page`/`BrowserLauncher` — the task's own declared test layer ("fake `BrowserLauncher` … and a fake `Page`"). Live ProseMirror/CodeMirror insertion is unverified here and owned by 0185-0188; bound stated in finding #1 |
| AC4 — success only from an observed outcome | MET (library grain) | `src/browser.ts:311-334` — success requires a non-empty observed signal (empty-string probe is *not* success), timeout yields `{ ok: false, error: '<label>: no outcome observed within <ms>ms' }`; `tests/browser.test.ts:384-402`. Consumer publish results belong to 0185-0188; bound stated in findings #1/#2 |
| AC5 / R12 — Medium browser fallback deferred | MET | `docs/04_DESIGN.md:541-543` records the deferral and its lift condition; ADR-027 (`docs/00_ADR.md:1066`, "Medium browser fallback is deferred until the token API stops accepting posts"); `docs/04_DESIGN.md:495` verdict row marks medium `Keep` + **deferred** |

##### Verified evidence (fresh, this review)

- `bun test packages/publish-harness` → `49 pass`, `0 fail`, `114 expect() calls`, exit 0; `src/browser.ts` coverage `100.00 % funcs / 99.53 % lines` (independently reproduced; the `--coverage`-single-file non-zero exit the implementer diagnosed is a `bunfig.toml` aggregate-threshold artifact, not a failure).
- `bun run test-pre-check` → `All 53 rules passed — no violations found.`, exit 0 (re-run of the exact preset the implementer had to fix; `grep -nE "console\.|process\.(stdout|stderr)" src/browser.ts` → comments only).
- Runtime export surface, derived by importing the module: `checkChannelSession, expectOutcome, fillCodeMirror, markdownToHtml, pasteHtml, resolveChannelProfileDir, runProfileCli, uploadFile, waitUntil` — exactly the frozen value surface, no extras.
- `Bun.markdown.html` verified live on this runtime (GFM table → `<table>`), so `markdownToHtml` (`src/browser.ts:337`) is real, not assumed.
- Handoff contract for 0184-0188 checked against their own task files: every symbol they assume (`resolveChannelProfileDir`, `waitUntil`, `checkChannelSession`, `ChannelSessionResult`, `ChannelBrowserConfig`, `runProfileCli`, `pasteHtml`, `fillCodeMirror`, `uploadFile`, `expectOutcome`, `markdownToHtml`) is exported, and all four channel plugins already declare `@gobing-ai/publish-harness: workspace:*` (`plugins/publishings/{infoq,juejin,substack,x}-pub/package.json:10`), so the sub-path resolves without a further 0183 change.
- Gate artifact `.spur/run/0183-test-gate.log`: 1760 pass / 2 skip / 0 fail, 53 pre-check + 2 post-check rules green, `packages/publish-harness/src/browser.ts | 100.00 | 99.53`.

##### Confidence level — HIGH

**Verdict confidence: HIGH** for everything this review certifies. The PASS is bounded to *library grain* — exactly the grain task 0183's own Test layer prescribes — so no MEDIUM area is silently assumed away.

| Dimension | Confidence | First-hand basis (this review, not the implementer's prose) | Bound / what would falsify it |
| --- | --- | --- | --- |
| Functional traceability R1–R5, AC1, AC2, AC5 | HIGH | every requirement anchored to a `file:line` I read; runtime export surface re-derived by importing the module; R5 proved by `src/index.ts:1-3` plus the source-assertion test; all nine doc anchors re-checked line-exact | none material |
| Repo-wide non-regression | HIGH | all four gate legs re-run by me instead of reusing the artifact: `bun run lint` (Biome + 30-workspace typecheck) exit 0 · `bun run test-pre-check` 53 rules exit 0 · `bun run test` **1760 pass / 2 skip / 0 fail / 6784 expect() across 97 files**, exit 0 — byte-identical tally to `.spur/run/0183-test-gate.log` · `bun run test-post-check` 2 rules exit 0 | a red full-suite run on this tree; it did not occur |
| Gate/receipt binding to *this* tree | HIGH | `0183-check-receipt.json.inputDigest` == the log's `proof-digest` == `sha256:f1f59d20…`; mtime forensics show all six non-task files (browser.ts 22:07:50, browser.test.ts 21:59:26, package.json 21:58:43, bun.lock 21:59:31, 04_DESIGN.md 21:48:28, harvest 21:48:36) precede the gate capture at 22:14:17; and the proof-input fingerprint folds task content **only** from `Background / Requirements / Acceptance Criteria / Design / Plan` while excluding `docs/tasks*` from the git-tree half, so this review's mandated `### Review` write cannot move the digest (verified in the installed engine at `packages/app/src/workflow/proof-input-fingerprint.ts:110,240,334-341`, superseding the 0149 heading-level pitfall recorded at `.spur/context/pitfalls.md:3`) | any fingerprinted input touched after capture — the mtimes say none was |
| AC3/AC4 live behaviour (paste / CodeMirror / upload / observed outcome) | MEDIUM | helpers exist and are unit-tested against a fake `Page`/`BrowserLauncher` exactly as the task's declared test layer prescribes; the observed-signal gate is exercised including the empty-string probe case | the browser-side DOM scripts (`src/browser.ts:356-406`) were reviewed as strings and never executed against a real ProseMirror/CM6/bytemd editor or hidden file input; only the 0185-0188 operator draft dogfood can settle them |
| SECUA | HIGH for security, efficiency, usability, architecture; correctness inherits the AC3/AC4 bound above | no credential/cookie/storageState or profile-content handling — the profile-dir path is the only profile detail that leaves the module; no `console.*` and no raw stdout (both presets re-run green); launcher and stdout are injected seams; the two new dependencies are catalog workspace edges, no new locked package | DOM-script correctness, bounded above |
| Architectural depth | MEDIUM | judgment-based (shallow-module / coupling / seam / test-surface assessment in the sp-code-improvement review mode); the module is one cohesive seam with a fake-injectable launcher, not a pass-through | depends on the shape 0185-0188 actually take — P4-4 (browser→index coupling) and P4-6 (bundler externals) are forward-looking |

**Why not MEDIUM overall:** the one genuinely unverifiable area — live editor behaviour — sits *outside* what the review certifies (AC3/AC4 are marked at library grain and recorded as residual risk #1). Downgrading the whole verdict would misstate the evidence that does exist: every claim behind R1–R5, AC1/AC2/AC5, the R5 isolation and the repo-wide non-regression is anchored in a command exit code or a line-exact read performed in this review.
**Why not LOW anywhere:** no dimension rests on the implementer's prose. `## Solution` was used only to locate claims to check, and two of its statements were corrected — the `bun.lock` hunk is not "workspace edge only" (finding #3), and the graded claim on AC3/AC4 is capped at fake-Page grain (findings #1/#2).

##### Residual risk (cannot be closed by this task)

1. **No real browser was driven.** AC3/AC4 are proven only against a fake `Page`/`BrowserLauncher`; the DOM scripts at `src/browser.ts:356-406` (paste, editor text read, CM6/CM5 dispatch) are asserted as strings, never executed in a real page. Real editor behaviour is the per-channel draft dogfood owned by 0185-0188.
2. **`playwright` runtime resolution for bundled plugins** is unverified (finding #6); the bundler keeps only `playwright` external and `apps/cli` does not declare it.
3. **End-to-end false-success rail** depends on the channel flows asserting the body after `fillCodeMirror` (findings #1/#2) — the library alone cannot close it.

**Next:** accept 0183 as PASS; carry findings #1 and #2 into 0185 (`infoq`, `substack`) and 0186 (`juejin`, the `fillCodeMirror` consumer) as an explicit "assert the editor body / wrap the outcome probe" step; items #3-#7 need no action beyond the record.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-05T04:54:56.296Z todo → wip (system)
- 2026-10-05T05:36:59.399Z wip → testing (system)
- 2026-10-05T07:01:09.132Z testing → done (system)

