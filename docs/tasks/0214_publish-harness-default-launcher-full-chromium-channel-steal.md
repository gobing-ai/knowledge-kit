---
schema_version: 1
name: "publish-harness default launcher: full-Chromium channel + stealth launch so headed login and headless check share one cookie store"
status: todo
template: issue
created_at: 2026-10-07T17:59:24.600Z
updated_at: "2026-10-07T18:16:37.191Z"
feature_id: E91

ac_numbering: task-local
ac_altitude: task-local
---

## 0214. publish-harness default launcher: full-Chromium channel + stealth launch so headed login and headless check share one cookie store

### Background

Operator dogfood for 0193 (substack) and 0194 (x) found that a successful headed `profile-check.ts login` never leads to a passing `check`. The check runs headless first and finds no session cookie (`substack.sid`, `auth_token`).

Root cause, reproduced on 2026-10-07 with `.spur/run/discovery/cookie-persist-repro2.ts` and `repro3.ts`:
- Playwright 1.55 runs headed sessions on the full Chromium build (`chromium-1187`) and headless sessions on a separate `chromium_headless_shell-1187` binary.
- Cookies written by one binary can't be read by the other. Reopening a profile in the other mode wipes its Cookies DB.
- Same-mode reopen keeps cookies. With `channel: 'chromium'` (full Chromium in new-headless mode), both mixed directions keep them.

Separately, Google OAuth refuses vanilla automation Chromium ("This browser or app may not be secure"). The stealth options used by `.spur/run/discovery/login-x3.ts` pass it for X.

The fix seam is the `BrowserLauncher` that every browser publish channel opens profiles through. Today that's the ts-browser-automation default, which calls `launchPersistentContext(profileDir, { headless })` (`ts-browser-automation/src/launcher.ts:114`).

### Requirements

- [ ] R1. `@gobing-ai/publish-harness/browser` exports a default `BrowserLauncher`. It launches with `channel` from `KK_BROWSER_CHANNEL` (default `chromium`; `chrome` uses installed Google Chrome), `--disable-blink-features=AutomationControlled`, `ignoreDefaultArgs: ['--enable-automation']`, and an init script that hides `navigator.webdriver`. It keeps the library launcher's semantics: owner-only (0o700) profile dir creation, `BrowserProfileMissingError` for a missing profile when headless, and busy/missing-browser error mapping.
- [ ] R2. `checkChannelSession`, `runProfileCli`, and every browser publish plugin (infoq, juejin, substack, x, wechatmp, xhs) use that launcher whenever no launcher is injected.
- [ ] R3. A session written by a headed launch through the harness launcher stays readable by a later headless launch of the same profile. This is proved by an E2E check that leaves a repeatable artifact.
- [ ] R4. `docs/04_DESIGN.md` documents `KK_BROWSER_CHANNEL` and the launcher defaults in the same commit.

### Acceptance Criteria

<!-- ac_altitude: task-local -->
<!-- ac_numbering: task-local -->

```gherkin
Scenario: AC1 — harness launcher applies channel and stealth options (req: R1)
  Given KK_BROWSER_CHANNEL is unset, or set to chrome
  When the harness launcher opens a profile
  Then launchPersistentContext receives channel chromium (or chrome), the AutomationControlled arg, and ignoreDefaultArgs --enable-automation
  And a missing profile in headless mode throws BrowserProfileMissingError

Scenario: AC2 — plugins default to the harness launcher (req: R2)
  Given a browser publish plugin with no injected launcher
  When it opens a profile session
  Then it goes through the harness launcher

Scenario: AC3 — headed-written cookie survives a headless reopen (req: R3)
  Given a fresh profile and a cookie written during a headed launch through the harness launcher
  When the same profile is reopened headless through the harness launcher
  Then the cookie is present, and the check writes its result as a JSON artifact

Scenario: AC4 — surface documented (req: R4)
  Given the change set
  Then docs/04_DESIGN.md names KK_BROWSER_CHANNEL with its default and allowed values
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

Every browser channel opened profiles through the ts-browser-automation default launcher, which calls `playwright.chromium.launchPersistentContext(profileDir, { headless })` (`ts-browser-automation/src/launcher.ts:114`). With no `channel`, Playwright 1.55 runs headed sessions on full Chromium and headless sessions on `chromium_headless_shell`. The two don't share a readable cookie store, and reopening across them wipes it. So a headed `login` followed by a headless `check` always refused. Reproduced by the E2E control rows (`playwright-default` → `kept: false` in both directions).

### Solution

- `packages/publish-harness/src/browser.ts:111` (default wired at :204): `createKkBrowserLauncher` / `kkBrowserLauncher`. It reads `channel` from `KK_BROWSER_CHANNEL` (default `chromium`), adds the AutomationControlled arg, `ignoreDefaultArgs: ['--enable-automation']` and a `navigator.webdriver` init script, and maps busy/missing-browser errors. `checkChannelSession` and `runProfileCli` default to it.
- `packages/publish-harness/src/profile-dir.ts:12`: `ensureProfileDir` (0o700 create when headed, refuse when headless, adopt an existing dir). Allowlisted in `.spur/rules/strict/runtime-boundaries.yaml` `no-direct-fs-io`, because the ts-runtime `ensureDir` takes no mode.
- Plugins:
  - infoq/juejin/substack/x set `this.launcher = deps.launcher ?? kkBrowserLauncher`.
  - wechatmp passes `launcher: kkBrowserLauncher` to `openPersistentBrowser` (index + profile-check).
  - xhs `defaultLauncher = kkBrowserLauncher.launch`, and `loginProfile` defaults to it.
- `docs/04_DESIGN.md`: `KK_BROWSER_CHANNEL` env row, `kkBrowserLauncher` surface row, 0177/0214 note, xhs paragraph.

### Testing

- E2E (AC3): `cd packages/publish-harness && bun run e2e:launcher` writes `.spur/run/e2e/0214-launcher-session.json`.
  - 2026-10-07: `pass: true`. kkBrowserLauncher keeps the cookie headed→headless and headless→headed. The playwright-default control loses it in both directions.
  - `KK_BROWSER_CHANNEL=chrome` also passes.
- Unit tests:
  - `packages/publish-harness/tests/browser.test.ts` → `createKkBrowserLauncher (0214)`: default and chrome channel, stealth options, headless refusal before launch, blank path, error mapping.
  - `tests/profile-dir.test.ts`: 0o700 create, headless refusal, adopt, file rejection.
  - wechatmp/xhs binding tests updated.
- `bun run gate`: exit 0. 1960 pass, 0 fail, 53 + 2 rules pass, coverage 98.42% lines.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `.spur/context/pitfalls.md` → "2026-10-07 — operator logins for browser channels (0193/0194)"
- `.spur/run/discovery/cookie-persist-repro2.ts`, `cookie-persist-repro3.ts`, `login-x3.ts`
- `packages/publish-harness/node_modules/@gobing-ai/ts-browser-automation/src/launcher.ts:95-120`
- Blocks: 0193, 0194

### History
