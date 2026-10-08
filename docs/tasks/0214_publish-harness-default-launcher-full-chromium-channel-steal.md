---
schema_version: 1
name: "publish-harness default launcher: full-Chromium channel + stealth launch so headed login and headless check share one cookie store"
status: done
template: issue
created_at: 2026-10-07T17:59:24.600Z
updated_at: "2026-10-08T00:26:08.452Z"
feature_id: E91

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/0214-verdict.json
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

- [x] R1. `@gobing-ai/publish-harness/browser` exports a default `BrowserLauncher`. It launches with `channel` from `KK_BROWSER_CHANNEL` (default `chromium`; `chrome` uses installed Google Chrome), `--disable-blink-features=AutomationControlled`, `ignoreDefaultArgs: ['--enable-automation']`, and an init script that hides `navigator.webdriver`. It keeps the library launcher's semantics: owner-only (0o700) profile dir creation, `BrowserProfileMissingError` for a missing profile when headless, and busy/missing-browser error mapping.
- [x] R2. `checkChannelSession`, `runProfileCli`, and every browser publish plugin (infoq, juejin, substack, x, wechatmp, xhs) use that launcher whenever no launcher is injected.
- [x] R3. A session written by a headed launch through the harness launcher stays readable by a later headless launch of the same profile. This is proved by an E2E check that leaves a repeatable artifact.
- [x] R4. `docs/04_DESIGN.md` documents `KK_BROWSER_CHANNEL` and the launcher defaults in the same commit.

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

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/publish-harness/src/browser.ts:111` `createKkBrowserLauncher`, `packages/publish-harness/src/browser.ts:128` channel from `KK_BROWSER_CHANNEL` default chromium, `packages/publish-harness/src/browser.ts:134-135` AutomationControlled/`--enable-automation`, `packages/publish-harness/src/browser.ts:151` webdriver init script, `packages/publish-harness/src/browser.ts:159` `kkBrowserLauncher`. |
| R2 | MET | `packages/publish-harness/src/browser.ts:204,290` default launcher in `checkChannelSession`/`runProfileCli`; plugins: `plugins/publishings/infoq-pub/src/index.ts:223`, `plugins/publishings/juejin-pub/src/index.ts:186`, `plugins/publishings/substack-pub/src/index.ts:179`, `plugins/publishings/x-pub/src/index.ts:268`, `plugins/publishings/xhs-pub/src/index.ts:100`, `plugins/publishings/wechatmp-pub/src/index.ts:111`. |
| R3 | MET | E2E re-run this pass, artifact `.spur/run/e2e/0214-launcher-session.json` `pass:true`; script `packages/publish-harness/scripts/e2e-launcher-session.ts:1`. |
| R4 | MET | `docs/04_DESIGN.md:658` `KK_BROWSER_CHANNEL` row; `docs/04_DESIGN.md:747` launcher export row with defaults and E2E command. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — harness launcher applies channel and stealth options (req: R1) | MET | test | `packages/publish-harness/tests/browser.test.ts:656` createKkBrowserLauncher tests pass in the focused run. |
| AC2 — plugins default to the harness launcher (req: R2) | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1383-1387` asserts `defaultLauncher` is `kkBrowserLauncher.launch`; `plugins/publishings/wechatmp-pub/tests/wechatmp-default-launcher.test.ts:5-11` exercises the production default seam; both pass this pass (107 + 272 focused, 0 fail). Remaining plugins wire `deps.launcher ?? kkBrowserLauncher` at the R2 anchors. |
| AC3 — headed-written cookie survives a headless reopen (req: R3) | MET | command | `.spur/run/e2e/0214-launcher-session.json` regenerated this pass, `pass:true`. |
| AC4 — surface documented (req: R4) | MET | command | `grep -n KK_BROWSER_CHANNEL docs/04_DESIGN.md` run this pass → 2 hits: env row `docs/04_DESIGN.md:658` and launcher export row `docs/04_DESIGN.md:747` (defaults + E2E command). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Fresh-context verification of the implemented tree against this task's claims (2026-10-07).

| Priority | Dimension | Finding | Disposition |
| --- | --- | --- | --- |
| P3 | correctness | Cookie persistence across headed/headless is environment-dependent (Playwright build layout can change across versions); guarded by the E2E artifact which pins both directions + chrome channel. | DEFERRED — accepted residual risk; re-check after Playwright upgrades via `bun run e2e:launcher` (packages/publish-harness/package.json:12; re-run 2026-10-07, pass:true) |
| P3 | security | Stealth options (AutomationControlled off, --enable-automation dropped, webdriver init script) reduce bot detection but are not an anonymity guarantee; scope is OAuth login acceptance only. | DEFERRED — accepted residual risk; scope is OAuth login acceptance (ADR-032), no anonymity claim |
| P4 | ops | KK_BROWSER_CHANNEL=chrome requires Google Chrome installed; error message names the install command. | ACCEPTED |

Residual risk: none new; artifact-based cookie persistence is environment-dependent by nature but was reproduced in both directions plus the chrome channel.
Disposition: implementation verified against all four AC — no open findings. Shippable.

### References

- `.spur/context/pitfalls.md` → "2026-10-07 — operator logins for browser channels (0193/0194)"
- `.spur/run/discovery/cookie-persist-repro2.ts`, `cookie-persist-repro3.ts`, `login-x3.ts`
- `packages/publish-harness/node_modules/@gobing-ai/ts-browser-automation/src/launcher.ts:95-120`
- Blocks: 0193, 0194

### History

- 2026-10-07T20:45:25.632Z todo → wip (system)
- 2026-10-07T20:45:27.510Z wip → testing (system)
- 2026-10-07T20:45:58.387Z testing → done (system)

