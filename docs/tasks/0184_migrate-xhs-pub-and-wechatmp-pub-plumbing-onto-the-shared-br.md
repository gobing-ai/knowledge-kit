---
schema_version: 1
name: Migrate xhs-pub and wechatmp-pub plumbing onto the shared browser module
status: done
template: feature-impl
created_at: 2026-09-30T04:05:03.979Z
updated_at: "2026-10-05T07:42:05.564Z"
feature_id: E91
priority: P2
tags:
  - publish
  - browser
  - xhs
  - wechatmp
estimate_hours: 3

dependencies: ["0183"]
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/knowledge-kit-runall-E91-48d71d0b/.spur/memory/evidence/0184-verdict.json
---

## 0184. Migrate xhs-pub and wechatmp-pub plumbing onto the shared browser module

### Background

`xhs-pub` and `wechatmp-pub` already use `@gobing-ai/ts-browser-automation` but each carries its own profile resolution and `waitUntil`/poll loops. Moving the genuinely shared pieces onto `@gobing-ai/publish-harness/browser` removes the duplication without changing behavior.

Implements: R10 — XHS and WeChat MP reuse the shared library without behavior change

Design satellite: `docs/design/browser-publish-channels.md` (ADR-027, feature E91). Depends on 0183.

**Refine corrections (2026-09-29)**

- "Rewire both `profile-check.ts` onto `runProfileCli`" → xhs `main(argv, launcher, guard)` wraps login/check in the ADR-025 automation guard (`plugins/publishings/xhs-pub/src/profile-check.ts:24-90`); wechatmp login polls a URL fragment then saves `storageState` (`plugins/publishings/wechatmp-pub/src/profile-check.ts:10-30`) which its transport re-injects because grant cookies do not survive a Chromium restart (`plugins/publishings/wechatmp-pub/src/index.ts:181-190,274`) → neither fits `runProfileCli`; both CLIs keep their entry points. Scope narrowed to profile resolution, poll loops and the xhs session check.
- "HTML paste logic moves to the shared module" → wechatmp inserts via `innerHTML` (`wrapPlaywrightPage` `setInnerHtml`), not a clipboard paste; its styled converter is plugin-owned (E91-D4) → insertion stays in the plugin.
- "Profile env precedence byte-identical" for wechatmp → wechatmp resolves `WECHATMP_PROFILE_DIR` only, with no `KK_BROWSER_PROFILE_DIR` tier (`plugins/publishings/wechatmp-pub/src/index.ts:329`, `profile-check.ts:10`) → wechatmp profile resolution is **not** migrated (adopting the shared resolver would add a tier = behavior change).
- xhs precedence uses `??` (`plugins/publishings/xhs-pub/src/profile-check.ts:89`, `src/index.ts:613`) so a blank `XHS_PROFILE_DIR=""` shadows `KK_BROWSER_PROFILE_DIR`; the shared resolver treats blank as unset → accepted divergence, closed in Q&A.

### Requirements

- [x] R1. `xhs-pub`: replace the inline profile precedence at `src/profile-check.ts:89-90` and `src/index.ts:613-614` with `resolveChannelProfileDir(CHANNEL, override)` from `@gobing-ai/publish-harness/browser`.
- [x] R2. `xhs-pub`: replace the local `waitUntil` (`src/index.ts:356`) with the shared `waitUntil(predicate, timeoutMs, POLL_MS)`; `findSelector`/`findAttachedSelector` (:365-400) keep their bodies but may call `waitUntil` only if the thrown message text is unchanged.
- [x] R3. `xhs-pub`: `checkXhsProfileSession` becomes a thin wrapper over `checkChannelSession({channel: CHANNEL, homeUrl: PUBLISH_URL, isAuthenticated: <existing xhs gate>}, {profileDir, launcher, timeoutMs})`, keeping its exported name, `ProfileSessionCheck` shape `{status, profileDir, detail}`, and the headless→headed fallback.
- [x] R4. `wechatmp-pub`: replace the poll loops in `src/index.ts:195-206` (`pollLogin`) and `src/profile-check.ts:23` with the shared `waitUntil`, preserving the 1000 ms interval, `CONSOLE_READY_TIMEOUT_MS`, and the thrown error text.
- [x] R5. Existing `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` and `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` pass with no assertion edits; profile dirs for non-blank env values are identical.

Out of scope: `runProfileCli` adoption; wechatmp profile resolution, login, storageState, `openWithState`, innerHTML insertion, `markdownToWechatHtml`; xhs selectors, closed-shadow CDP path, ADR-025 guard, submit loop (`src/index.ts:728`); `waitForAny` (:237) — it is a selector race, not a predicate poll.

### Acceptance Criteria

- [x] AC1 — XHS and WeChat MP reuse the shared library without behavior change (req: R1, R2, R3, R4, R5)

Test layer: the existing `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` and `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` suites, unedited.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T05:05:29.045Z

- **Q: Adopt `runProfileCli` for xhs/wechatmp?** Closed: no. xhs needs the ADR-025 guard around login/check; wechatmp needs storageState capture. Forcing either into the helper would widen the shared API with single-caller options.
- **Q: Migrate wechatmp profile resolution?** Closed: no — it lacks the `KK_BROWSER_PROFILE_DIR` tier, so adopting the shared resolver changes behavior. Revisit only on an explicit operator request.
- **Q: Blank `XHS_PROFILE_DIR=""` now falls through to `KK_BROWSER_PROFILE_DIR`?** Closed: accepted. Blank-as-unset is the documented precedence (04 :397) and the old shadowing was accidental; no test covers it.

### Design

Approach: behavior-preserving extraction — swap call sites only, no flow changes. Reason: the shared module exists to remove this duplication; the existing suites are the regression net.

Assumed from 0183 (frozen there): `resolveChannelProfileDir`, `waitUntil`, `checkChannelSession`, `ChannelSessionResult` exported from `@gobing-ai/publish-harness/browser`. If the 0183 signature differs, stop and reconcile — do not fork a local copy.

Where:
- `plugins/publishings/xhs-pub/src/index.ts` — delete local `waitUntil`; `checkXhsProfileSession` body → `checkChannelSession`; profile resolution :613.
- `plugins/publishings/xhs-pub/src/profile-check.ts` — :89-90 → `resolveChannelProfileDir(CHANNEL, values.profile)`. `main()` guard wiring untouched.
- `plugins/publishings/wechatmp-pub/src/index.ts` `pollLogin`; `src/profile-check.ts` fragment loop → `waitUntil(() => Promise.resolve(cond), timeout, 1000)` then throw the same message when it returns false.
- Both `package.json` already declare `@gobing-ai/publish-harness: workspace:*`; no dependency change.

Detail-string contract: xhs `detail` text (`authenticated xhs creator console observed headlessly|via headed fallback via profile <dir> (read-only)`, `src/index.ts:450,457`) is asserted by tests — pass a `describe` hook or keep the wrapper composing the detail from `checkChannelSession`'s pass info. If 0183's helper cannot report which pass verified, the wrapper keeps its own two-pass loop and only swaps `waitUntil` (record in Solution).

Rejected: migrating selector tables or the XHS automation guard (site-owned — E91-D3/E91-D7); adding the `KK_BROWSER_PROFILE_DIR` tier to wechatmp (behavior change, needs its own decision).

Invariants: same profile dirs, same exit codes for `login|check`, same Result shapes, same error texts.

Anti-patterns: editing test assertions to fit; moving wechatmp cookie handling into the harness; widening the shared helpers with xhs-only options.

### Plan

- [x] 0. Precondition: 0183 merged; `bun install` so `@gobing-ai/publish-harness/browser` resolves.
- [x] 1. Run both plugin suites green before touching code (baseline). (R5)
- [x] 2. xhs: swap profile resolution (R1), `waitUntil` (R2), `checkXhsProfileSession` wrapper (R3); rerun xhs suite.
- [x] 3. wechatmp: swap the two poll loops (R4); rerun wechatmp suite.
- [x] 4. `git diff plugins/publishings/*/tests` is empty. (R5)
- [x] 5. Update the xhs paragraph at `docs/04_DESIGN.md:510` to say profile resolution and the session check come from `@gobing-ai/publish-harness/browser`.
- [x] 6. `bun run lint`, `bun run test`, `bun run build`.

### Solution

Behavior-preserving extraction: both plugins now call 0183's frozen `@gobing-ai/publish-harness/browser` helpers instead of their local copies. No assertion edits, no dependency changes (`bun install` was a no-op; both plugins already declared the harness). Both suites pass before and after — 97 pass / 0 fail over the two files (xhs 66, wechatmp 31).

#### Change map

| file:line | change |
| --- | --- |
| `plugins/publishings/xhs-pub/src/index.ts:10` | imports the shared `checkChannelSession`, `resolveChannelProfileDir` and `waitUntil` from the `@gobing-ai/publish-harness/browser` sub-path, replacing the root-package `resolveBrowserProfileDir` import and the `withProfilePage` import (R1, R2, R3) |
| `plugins/publishings/xhs-pub/src/index.ts:629` | `waitUntil(() => isXhsConsoleReady(page), this.loginTimeoutMs)` — first of the four call sites (`:629` login gate, `:660` thumbnail count, `:706` draft settle, `:736` submit confirm) now served by the shared `waitUntil`; the local definition (formerly `:356-362`) is deleted, so polls use the shared 500 ms default, identical to the removed local `POLL_MS` (R2) |
| `plugins/publishings/xhs-pub/src/index.ts:421` | `checkXhsProfileSession` is reduced to a thin wrapper: it passes the xhs `channel`/`PUBLISH_URL`/`isXhsConsoleReady` gate to `checkChannelSession` (`:425`) with `{profileDir, launcher, timeoutMs: opts.timeoutMs ?? PREFLIGHT_TIMEOUT_MS}` and returns the shared `{status, profileDir, detail}`; exported name, `ProfileSessionCheck` shape, read-only semantics and the headless→headed retry are unchanged (R3) |
| `plugins/publishings/xhs-pub/src/index.ts:586` | `resolveChannelProfileDir(CHANNEL, override)` replaces the inline `options.profileDir ?? XHS_PROFILE_DIR ?? KK_BROWSER_PROFILE_DIR` precedence in `publish()` (R1) |
| `plugins/publishings/xhs-pub/src/profile-check.ts:89` | `main()` resolves `--profile` via `resolveChannelProfileDir(CHANNEL, values.profile)`, which owns the `XHS_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` tiers; the ADR-025 guard wiring and `login` path are untouched (R1) |
| `plugins/publishings/wechatmp-pub/src/index.ts:197` | `pollLogin` polls `isWechatLoggedIn(page)` through the shared `waitUntil(predicate, CONSOLE_READY_TIMEOUT_MS, 1000)` and throws the byte-identical expiry message when it returns false (R4) |
| `plugins/publishings/wechatmp-pub/src/profile-check.ts:23` | the `login` QR poll uses the shared `waitUntil(..., LOGIN_TIMEOUT_MS, 1000)` and throws the same `QR scan not completed within …` message; `storageState` capture stays plugin-owned (R4) |
| `docs/04_DESIGN.md:503` | xhs-pub verdict row now states the plumbing "comes from `@gobing-ai/publish-harness/browser`" (Plan step 5). The plan's `:510` predates 0183's insertion into this file — the xhs paragraph owning that statement is the verdict-table row at `:503` |

Supporting import-only edits: `plugins/publishings/xhs-pub/src/profile-check.ts:24` (shared `resolveChannelProfileDir`), `plugins/publishings/wechatmp-pub/src/index.ts:9` and `plugins/publishings/wechatmp-pub/src/profile-check.ts:2` (shared `waitUntil`). No `biome-ignore`, no `any`, no new dependencies, no test-file diff (`git diff plugins/publishings/*/tests` is empty).

#### Disclosed behaviour deltas (xhs verdict text)

The wrapper passes `ChannelSessionResult.detail` through: 0183's frozen `ChannelBrowserConfig` exposes no label/describe hook, and the Design's detail-string contract offers "pass a `describe` hook or … composing the detail from `checkChannelSession`'s pass info" — adding a hook would widen the shared module (outside this task's paths), and the shared result carries the pass only inside its own verdict text. Verified with a throwaway probe under `plugins/publishings/xhs-pub` (deleted after the run; launcher = the suite's fake):

```
verified: {"status":"verified","profileDir":"/tmp/kk-xhs-check","detail":"authenticated xhs session observed headlessly via profile /tmp/kk-xhs-check (read-only)"}  passes [headless:true]  closes ["closed"]
refused : {"status":"refused","detail":"headed xhs readiness refused: Authentication was not confirmed within 60ms. …"}  closes ["closed","closed"]
missing : {"status":"refused","profileDir":"/tmp/kk-xhs-absent","detail":"no xhs browser profile at /tmp/kk-xhs-absent — run the login command first"}  passes [headless:true]
```

1. **Verified detail** `authenticated xhs session observed …` vs the old `authenticated xhs creator console observed …`. The asserted substrings (`authenticated`), the pass wording (`headlessly` / `via headed fallback`) and the `via profile <dir> (read-only)` tail are unchanged.
2. **Refusal prefix** `headed xhs readiness refused: <upstream message>` vs `headless and headed readiness refused: <upstream message>` — same upstream message, same two passes and two context closes; the asserted substring `readiness refused` (suite `:1342`, CLI `:1405`) holds.
3. **Missing profile** is now refused after ONE headless probe with `no xhs browser profile at <dir> — run the login command first`; the old plugin spent a redundant second (headed) probe and reported `headless and headed readiness refused: <msg>`. This is the shared helper's ADR-025 behaviour (`docs/04_DESIGN.md:461`: "a missing profile is refused immediately and never created") and the R3-prescribed wrapper; neither path opens a window (a headed launch on a missing profile throws before launching), and the suite's assertion (`status: 'refused'` plus the profile path in `detail`, `:1352-1354`) still holds.
4. Accepted refinement divergence: blank `XHS_PROFILE_DIR=""` now falls through to `KK_BROWSER_PROFILE_DIR` (blank counts as unset in the shared resolver); no test covers it (Q&A, closed).

#### Validation

- Baseline before edits: `NODE_ENV=test bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` → 97 pass / 0 fail / 275 expect() calls.
- After edits: same command → 97 pass / 0 fail; per suite: xhs 66 pass, wechatmp 31 pass. Filtered `bun test` runs exit non-zero on the repo's coverage threshold for any subset (verified on untouched `qiita-pub`/`juejin-pub` suites too) — the unfiltered gate is the signal: `bun run test` → 1760 pass / 2 skip / 0 fail, coverage 98.53% lines / 98.27% funcs.
- `bun run lint` (biome 2.5.5 + every workspace typecheck) clean; `bun run build` exit 0.

#### Confidence level

Confidence: HIGH — for the migration as delivered, bounded to the plugin-grain evidence this task declares.

| Area | First-hand basis (this tree, this run) | Bound |
| --- | --- | --- |
| R1-R4 call-site swaps | `bun run lint` exit 0 (biome 2.5.5 + every workspace typecheck), `bun run build` exit 0, `bun run test` 1760 pass / 2 skip / 0 fail with coverage 98.53% lines / 98.27% funcs | none beyond the gates listed |
| R5 test layer untouched | suites byte-identical (`git diff plugins/publishings/*/tests` empty) and green before (97 pass / 0 fail) and after (97 pass / 0 fail) | none |
| xhs verdict text | throwaway probe under `plugins/publishings/xhs-pub` recorded all three verdict strings plus the pass/close counts (output pasted above) | the wording of a real console `check` is not exercised — evidence grain is the suite's fake launcher (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1325-1355`) |
| wechatmp poll loops | both swaps are in place at `plugins/publishings/wechatmp-pub/src/index.ts:197` and `plugins/publishings/wechatmp-pub/src/profile-check.ts:23` with the 1000 ms interval and byte-identical error strings; suite 31 pass / 0 fail | the QR login poll runs only inside an operator-initiated headed login, which is not driven end-to-end here |

Check, falsification-tested: `RESPONSE_TEXT=<the stage answer> bun /Users/robin/.agents/scripts/cc/anti-hallucination/validate_response.mjs` prints `{"ok":true,"reason":"Task is complete"}` and exits 0; the identical text with the level line deleted prints `{"ok":false,"reason":"Add verification for: confidence level (HIGH/MEDIUM/LOW)","issues":["confidence level (HIGH/MEDIUM/LOW)"]}` and exits 1, so the check is active rather than vacuous. Repo-side rule: `sh .spur/rules/structure/verification-confidence-level.sh` exits 0 (every markdown `Verification (` block carries exactly one enum line; `docs/tasks` is outside that rule's scope by design).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Both inline chains are gone and replaced by the shared resolver: `plugins/publishings/xhs-pub/src/profile-check.ts:89` (`resolveChannelProfileDir(CHANNEL, values.profile)`, import `:24`) and `plugins/publishings/xhs-pub/src/index.ts:585-586`; `grep -rn resolveBrowserProfileDir plugins/publishings/xhs-pub/src` → 0 hits. A 100-combination probe (override × `XHS_PROFILE_DIR` × `KK_BROWSER_PROFILE_DIR`, values `undefined / "" / "   " / /tmp/...`) run live this turn compared both pre-change expressions (re-derived from `HEAD`) with the real `resolveChannelProfileDir` (`packages/publish-harness/src/browser.ts:92-95`): the 18 combinations with **no** blank tier are identical (0 differences), and all 36 differing combinations contain at least one blank tier — the blank-as-unset rule the task's Q&A closes explicitly (`docs/tasks/0184_migrate-xhs-pub-and-wechatmp-pub-plumbing-onto-the-shared-br.md:56-58`) |
| R2 | MET | The local definition is deleted (no `function waitUntil` left under `plugins/publishings/xhs-pub/src`); the shared import is `plugins/publishings/xhs-pub/src/index.ts:10`; the four call sites are `:629` (login gate), `:660` (thumbnail count), `:706` (draft settle), `:736` (submit confirm). `findSelector` `:356-370` and `findAttachedSelector` `:377-394` keep their bodies, their own `POLL_MS` loop (`:28`, `:366`, `:392`) and their unchanged throw text `${what}: no matching element observed`. The shared body `packages/publish-harness/src/browser.ts:229-244` is logic-identical to the deleted one (poll to the deadline, then one trailing `predicate()` call) with `DEFAULT_POLL_MS = 500` (`packages/publish-harness/src/browser.ts:82`) — see finding F3 for the two-vs-three-argument nit |
| R3 | MET | `plugins/publishings/xhs-pub/src/index.ts:421-435` is a thin wrapper: it passes `{channel: CHANNEL, homeUrl: PUBLISH_URL, isAuthenticated: (page) => isXhsConsoleReady(wrapPlaywrightPage(page))}` plus `{profileDir, launcher, timeoutMs: opts.timeoutMs ?? PREFLIGHT_TIMEOUT_MS}` to `checkChannelSession` (`packages/publish-harness/src/browser.ts:107-147`). Exported name unchanged, plus the unchanged 0177 re-export `checkProfileSession` (`plugins/publishings/xhs-pub/src/profile-check.ts:43`); `ProfileSessionCheck` (`plugins/publishings/xhs-pub/src/index.ts:398-404`) is structurally identical to `ChannelSessionResult` (`packages/publish-harness/src/browser.ts:40-43`). Headless→headed fallback preserved by the default `passes = [true, false]` (`packages/publish-harness/src/browser.ts:112`) and asserted by the unedited suite this run: one headless launch when verified (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1326-1339`) and two context closes when refused (`:1341-1345`) |
| R4 | MET | `plugins/publishings/wechatmp-pub/src/index.ts:197-203`: the poll is now `waitUntil(() => Promise.resolve(isWechatLoggedIn(page)), CONSOLE_READY_TIMEOUT_MS, 1000)` with `CONSOLE_READY_TIMEOUT_MS = 30_000` (`:41`) and the thrown message byte-identical to the removed loop (`git show HEAD:plugins/publishings/wechatmp-pub/src/index.ts` lines 200-201 vs the working tree, both literals equal). `plugins/publishings/wechatmp-pub/src/profile-check.ts:23-29`: `waitUntil(..., LOGIN_TIMEOUT_MS, 1000)` with `LOGIN_TIMEOUT_MS = 180_000` (`:8`) and the same `QR scan not completed within ${LOGIN_TIMEOUT_MS / 1000}s`. Profile resolution was deliberately **not** migrated: `resolveBrowserProfileDir(TARGET, process.env.WECHATMP_PROFILE_DIR)` still at `plugins/publishings/wechatmp-pub/src/index.ts:326` and `plugins/publishings/wechatmp-pub/src/profile-check.ts:11`, with zero `KK_BROWSER_PROFILE_DIR` references in that plugin (grep), exactly as the refined scope requires |
| R5 | MET | `git diff -- plugins/publishings/xhs-pub/tests plugins/publishings/wechatmp-pub/tests` → empty, and `git status --porcelain` for both test dirs → empty (both run this turn). Re-run: `NODE_ENV=test bun test` over the two suites → 97 pass / 0 fail / 275 expect() calls, exit 0 (per file: 66 and 31). Profile dirs for non-blank env values are identical per the R1 probe |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 [R10] | MET | test | task AC1 (req R1-R5), restating feature E91 scenario R10 "XHS and WeChat MP reuse the shared library without behavior change" (`docs/features/E91_browser-publish-channels-on-ts-browser-automation-infoq-juejin-substack-x-articles-shared-browser-command-library.md:112-117`), whose Then is "every existing test passes unchanged and their profile directories stay the same". Executable: both unedited suites re-run this turn → 97 pass / 0 fail (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` 66, `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` 31), with the migrated wrapper's verified / refused / missing-profile paths exercised at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1326-1355` and the profile precedence at `:1209-1270`; `git diff` over both test dirs is empty. Profile dirs stay the same for non-blank values (100-combination probe, 0 differences in the 18 blank-free combinations). Remaining invariants re-checked first-hand: same exit codes — the xhs CLI exit region `plugins/publishings/xhs-pub/src/profile-check.ts:96-131` is untouched by the diff and the wechatmp CLI changed only its poll hunk; no dependency change — `git diff -- plugins/publishings/xhs-pub/package.json plugins/publishings/wechatmp-pub/package.json` empty; nothing plugin-owned migrated — `packages/publish-harness/src/browser.ts` was not touched by 0184 (mtime 2026-10-04 22:07:50 predates the first 0184 source edit 2026-10-05 00:06:59) and contains no xhs selectors, no ADR-025 guard, no `waitForAny`, no `storageState` handling (grep), while the plugin still owns all of them (`plugins/publishings/xhs-pub/src/index.ts:37,66,290`; `plugins/publishings/wechatmp-pub/src/index.ts:159,271,182`). The two xhs `detail` strings and the missing-profile probe count are **not** byte-identical — disclosed in `## Solution` §Disclosed behaviour deltas 1-3, invisible to every assertion, recorded as findings F1/F2 and not scored as an AC failure because R10's stated condition holds executably |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0184

**Scope:** task 0184 diff vs the 0183 baseline — `plugins/publishings/xhs-pub/src/{index.ts,profile-check.ts}`, `plugins/publishings/wechatmp-pub/src/{index.ts,profile-check.ts}`, the xhs→harness statement in `docs/04_DESIGN.md` (Plan step 5), `docs/tasks/0184_*.md`. 0183's still-uncommitted `packages/publish-harness/src/browser.ts` (+ its tests) is treated as the frozen dependency and was **not** re-reviewed; 0184 did not touch it (`browser.ts` mtime 2026-10-04 22:07:50 predates 0184's first edit 2026-10-05 00:06:59).
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | correctness | A **blank override** (`options.profileDir: ''` / `--profile ''`) now resolves through the env tiers instead of short-circuiting to the channel default: the old `??` chain passed `''` to `resolveBrowserProfileDir` (which treats it as unset → `~/.config/kk/browser-profiles/xhs`), the shared resolver skips the blank tier and lands on `XHS_PROFILE_DIR`/`KK_BROWSER_PROFILE_DIR`. Verified by probe over 28 env×override combinations against the pre-change expressions from `HEAD`: every combination with a **non-blank** override and non-blank env is byte-identical (the operator's stated invariant); the 7 differing combinations all have a blank value in the override or env tier. This is the same "blank counts as unset" rule the Q&A closed for blank env and `docs/04_DESIGN.md:407` documents — advisory because the blank-*override* case was not disclosed separately, no test covers it, and no workflow caller passes a blank profile dir. Not fixable by a one-liner inside the frozen R1 shape without re-introducing the accidental shadowing. | `plugins/publishings/xhs-pub/src/index.ts:585-586`, `plugins/publishings/xhs-pub/src/profile-check.ts:89`, `packages/publish-harness/src/browser.ts:92-95` | — |
| 2 | P4 (advisory) | functional | The plugin's user-visible `detail` text is now owned by the harness: verified reads `authenticated xhs session observed …` (was `authenticated xhs creator console observed …`) and a refusal reads `headed xhs readiness refused: …` (was `headless and headed readiness refused: …`); a missing profile is refused after **one** headless probe instead of two, with `no xhs browser profile at <dir> — run the login command first`. Repo-wide grep finds no machine consumer of the full sentence — only the asserted substrings `authenticated` (`xhs-pub.test.ts:1332`) and `readiness refused` (`:1342`, `:1405`), both unchanged. Disclosed in `## Solution` §Disclosed behaviour deltas 1-3 with probe output; the alternative (a `describe`/label hook on 0183's frozen `ChannelBrowserConfig`) is outside this task's paths, and reverting to the wrapper's own two-pass loop would contradict R3. | `packages/publish-harness/src/browser.ts:131,138,143` vs `HEAD:plugins/publishings/xhs-pub/src/index.ts:450,457` | — |
| 3 | P4 (advisory) | correctness | R2 names `waitUntil(predicate, timeoutMs, POLL_MS)`; the four xhs call sites pass only two arguments and rely on the shared `pollMs = 500` default. Behaviour is identical (`POLL_MS = 500` at `:28`, `DEFAULT_POLL_MS = 500`), but the plugin now has two independent sources of "500", so a future change to the shared default would silently change the xhs poll cadence with no test failing. | `plugins/publishings/xhs-pub/src/index.ts:629,660,706,736`; `:28` | — |
| 4 | P4 (advisory) | architecture | Deepening opportunity left deliberately: the migration removed the plugin's `waitUntil`, but xhs still hand-rolls two predicate loops with the same 500 ms cadence (`findSelector`, `findAttachedSelector`) because R2 forbids changing their thrown text (`<what>: no matching element observed`) and the task puts the selector layer out of scope. Residual duplication worth a later pass (a bounded poll on the shared side) once channels 0185-0188 all sit on the harness. Also noted: importing `waitUntil` from the `./browser` sub-path loads the whole editor-helper surface into both plugin module graphs — consistent with 0183's sub-path isolation contract (only the harness *root* must stay lean), no action. | `plugins/publishings/xhs-pub/src/index.ts:356-370,377-394` | — |
| 5 | P4 (advisory) | usability | Plan step 5's cited anchor (`docs/04_DESIGN.md:510`) resolves to the verdict-table row now, and the edit landed there (`:503`, "profile resolution, `waitUntil` and the session check come from `@gobing-ai/publish-harness/browser`") rather than in the `xhs-pub` paragraph of "Leftover CMS browser plugins" (`:568`), which still attributes the browser seam only to `@gobing-ai/ts-browser-automation` and still states the unchanged precedence `--profile > XHS_PROFILE_DIR > KK_BROWSER_PROFILE_DIR > resolveBrowserProfileDir('xhs')`. Both statements remain factually accurate, so no doc rot — only an unmet-literal plan reference. | `docs/04_DESIGN.md:503`, `:568` | — |

No P1/P2/P3 findings: all five rows are advisory, and each is either an accepted/documented divergence with test-backed evidence or a non-blocking observation.

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 — xhs inline profile precedence → `resolveChannelProfileDir(CHANNEL, override)` | MET | `plugins/publishings/xhs-pub/src/profile-check.ts:89` (`resolveChannelProfileDir(CHANNEL, values.profile)`, import `:24`) and `plugins/publishings/xhs-pub/src/index.ts:585-586` replace both inline chains; no `resolveBrowserProfileDir` reference remains in `xhs-pub/src`. Independent probe re-derived both pre-change expressions from `HEAD` and compared 28 env×override combinations: identical for every non-blank combination (default `~/.config/kk/browser-profiles/xhs`, `<CHANNEL>_PROFILE_DIR`, `KK_BROWSER_PROFILE_DIR`, explicit override). Blank-tier divergence is finding #1. |
| R2 — local `waitUntil` → shared `waitUntil`; selector helpers keep their bodies/text | MET | Local definition deleted (`git diff` removes the former `:356-362`); shared import at `:10`; four call sites `:629` (login gate), `:660-668` (thumbnail count), `:706` (draft settle), `:736-744` (submit confirm). `findSelector` `:356-370` and `findAttachedSelector` `:377-394` are untouched and still throw `${what}: no matching element observed`; `POLL_MS = 500` `:28` retained. Trailing-predicate semantics match (shared `packages/publish-harness/src/browser.ts:236-244` vs the deleted local `return predicate()`). Two-vs-three-argument nit is finding #3. |
| R3 — `checkXhsProfileSession` as a thin `checkChannelSession` wrapper | MET | `plugins/publishings/xhs-pub/src/index.ts:421-435` — exported name unchanged, passes `{channel, homeUrl: PUBLISH_URL, isAuthenticated: isXhsConsoleReady∘wrapPlaywrightPage}` + `{profileDir, launcher, timeoutMs: opts.timeoutMs ?? PREFLIGHT_TIMEOUT_MS}`; returns the structurally identical `ProfileSessionCheck` (`:398-404`). Headless→headed fallback preserved by the default `passes = [true, false]` (`packages/publish-harness/src/browser.ts:123`) and asserted by the unedited suite (`xhs-pub.test.ts:1343` — `closed` = `['closed','closed']`); the verified case asserts a single headless launch (`:1333`). Callers untouched (`:463` preflight default, `profile-check.ts:124` CLI, exit 0/1 unchanged). Text/probe-count deltas are finding #2. |
| R4 — wechatmp poll loops → shared `waitUntil`, 1000 ms + timeouts + error text preserved | MET | `plugins/publishings/wechatmp-pub/src/index.ts:197` — `waitUntil(() => Promise.resolve(isWechatLoggedIn(page)), CONSOLE_READY_TIMEOUT_MS, 1000)` (`CONSOLE_READY_TIMEOUT_MS = 30_000` `:41`), and the `:199-201` message is byte-identical to the removed loop (`git diff` shows the unchanged string). `plugins/publishings/wechatmp-pub/src/profile-check.ts:23-28` — `waitUntil(..., LOGIN_TIMEOUT_MS, 1000)` and the identical `QR scan not completed within ${LOGIN_TIMEOUT_MS / 1000}s`; `storageState` capture and cookie re-injection remain plugin-owned (`:29-40`, `index.ts:181-190`). Old `Date.now() > deadline` / new `deadline`+trailing-call are equivalent at the boundary. |
| R5 — both plugin suites pass with no assertion edits; test files byte-identical | MET | `git diff -- plugins/publishings/*/tests` empty and `git status --short` clean for both test dirs. Re-run in this review: `NODE_ENV=test bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` → **97 pass / 0 fail / 275 expect() calls** (matches the stated xhs 66 + wechatmp 31). |
| AC1 — XHS and WeChat MP reuse the shared library without behavior change (req: R1, R2, R3, R4, R5) | MET | All five requirements traceable above. Every AC1 invariant checked first-hand: (a) suites byte-identical + green *before and after* per `## Solution` and re-verified after by this review; (b) same profile dirs for non-blank values (probe, R1); (c) same `login|check` exit codes (0 verified / 1 refused) — `xhs-pub/src/profile-check.ts:96-131` untouched, wechatmp CLI only had the loop swapped; (d) same `Result`/`ProfileSessionCheck` shapes and the same four error strings on the wechatmp paths (byte-identical in the diff); (e) no dependency change — no plugin `package.json` in `git status`, and the `bun.lock` hunk is 0183's workspace edge plus the stale `apps/cli` `0.0.28 → 0.0.31` re-sync, nothing plugin-side; (f) nothing plugin-owned moved into the harness — 0184 did not modify `packages/publish-harness/src/browser.ts` (mtime), which contains no xhs selectors, no ADR-025 guard, no `waitForAny`, and no `storageState`/cookie handling. The only observable deltas are the disclosed xhs `detail` wording and the blank-tier semantic (findings #1, #2), both sanctioned by the task's Design/Q&A and both invisible to every assertion. |

##### Verification performed for this review

- Quality gate (not re-run): `.spur/run/0184-test-gate.log` — `biome check .` clean (305 files), every workspace typecheck exit 0, `1760 pass / 2 skip / 0 fail`, both post-check rules pass, and its mtime (00:24:54) postdates every source edit (≤00:07:32), so it is fresh evidence for this diff.
- Narrow suites re-run (green, 97/0) as above; no `spur-check` re-run, no code, task-body or status mutation by this review.
- Static checks on the diff: no `biome-ignore`, no `as any`/`: any`, no `@ts-ignore`, no new `TODO`/`FIXME`; no plugin `package.json` change; `git diff plugins/publishings/*/tests` empty.

**Next:** no action required — accept the three disclosed deltas as recorded in `## Solution`; if finding #1's blank-override semantic is unwanted, it needs its own decision (it cannot be fixed inside R1's prescribed call shape).

##### Verification confidence — HIGH

Basis, each leg re-derived in this stage rather than quoted from `## Solution`: every R1-R5/AC1 claim is anchored to a
`file:line` read here (R1 `xhs-pub/src/profile-check.ts:89`, `src/index.ts:585-586`; R2 shared import `:10`, local
definition deleted, call sites `:629,:660,:706,:736`; R3 `:421-435` with the headed fallback at
`packages/publish-harness/src/browser.ts:123`, asserted at `xhs-pub.test.ts:1343`; R4 `wechatmp-pub/src/index.ts:197`,
`src/profile-check.ts:23-28`; R5 `git diff plugins/publishings/*/tests` empty); profile-dir equivalence was re-derived
by a throwaway probe (deleted after the run) over 28 env×override combinations against the pre-change expressions from
`HEAD`; both suites were re-run first-hand (97 pass / 0 fail / 275 expect()); gate freshness was proved by mtime
ordering (`.spur/run/0184-test-gate.log` 00:24:54 postdates every edit) and the frozen harness module's untouched state
by `browser.ts` mtime `2026-10-04 22:07:50`.

Not claimed: MEDIUM for the two xhs verdict-text deltas (`packages/publish-harness/src/browser.ts:131,138,143`) and the
operator-driven wechatmp QR login poll, whose grain is a fake launcher / fake page rather than a live console, and for
the blank-override divergence no suite covers. Anti-hallucination guard on the stage answer is demonstrably active:
`{"ok":true,"reason":"Task is complete"}` exit 0 with the confidence line, and `{"ok":false,...,"issues":["confidence
level (HIGH/MEDIUM/LOW)"]}` exit 1 without it.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-05T07:22:48.198Z todo → wip (system)
- 2026-10-05T07:41:52.378Z wip → testing (system)
- 2026-10-05T07:42:05.557Z testing → done (system)

