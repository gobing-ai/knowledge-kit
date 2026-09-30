---
schema_version: 1
name: Migrate xhs-pub and wechatmp-pub plumbing onto the shared browser module
status: todo
template: feature-impl
created_at: 2026-09-30T04:05:03.979Z
updated_at: "2026-09-30T05:05:29.045Z"
feature_id: E91
priority: P2
tags:
  - publish
  - browser
  - xhs
  - wechatmp
estimate_hours: 3

dependencies: ["0183"]
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

- [ ] R1. `xhs-pub`: replace the inline profile precedence at `src/profile-check.ts:89-90` and `src/index.ts:613-614` with `resolveChannelProfileDir(CHANNEL, override)` from `@gobing-ai/publish-harness/browser`.
- [ ] R2. `xhs-pub`: replace the local `waitUntil` (`src/index.ts:356`) with the shared `waitUntil(predicate, timeoutMs, POLL_MS)`; `findSelector`/`findAttachedSelector` (:365-400) keep their bodies but may call `waitUntil` only if the thrown message text is unchanged.
- [ ] R3. `xhs-pub`: `checkXhsProfileSession` becomes a thin wrapper over `checkChannelSession({channel: CHANNEL, homeUrl: PUBLISH_URL, isAuthenticated: <existing xhs gate>}, {profileDir, launcher, timeoutMs})`, keeping its exported name, `ProfileSessionCheck` shape `{status, profileDir, detail}`, and the headless→headed fallback.
- [ ] R4. `wechatmp-pub`: replace the poll loops in `src/index.ts:195-206` (`pollLogin`) and `src/profile-check.ts:23` with the shared `waitUntil`, preserving the 1000 ms interval, `CONSOLE_READY_TIMEOUT_MS`, and the thrown error text.
- [ ] R5. Existing `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` and `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` pass with no assertion edits; profile dirs for non-blank env values are identical.

Out of scope: `runProfileCli` adoption; wechatmp profile resolution, login, storageState, `openWithState`, innerHTML insertion, `markdownToWechatHtml`; xhs selectors, closed-shadow CDP path, ADR-025 guard, submit loop (`src/index.ts:728`); `waitForAny` (:237) — it is a selector race, not a predicate poll.

### Acceptance Criteria

- [ ] AC1 — XHS and WeChat MP reuse the shared library without behavior change (req: R1, R2, R3, R4, R5)

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

- [ ] 0. Precondition: 0183 merged; `bun install` so `@gobing-ai/publish-harness/browser` resolves.
- [ ] 1. Run both plugin suites green before touching code (baseline). (R5)
- [ ] 2. xhs: swap profile resolution (R1), `waitUntil` (R2), `checkXhsProfileSession` wrapper (R3); rerun xhs suite.
- [ ] 3. wechatmp: swap the two poll loops (R4); rerun wechatmp suite.
- [ ] 4. `git diff plugins/publishings/*/tests` is empty. (R5)
- [ ] 5. Update the xhs paragraph at `docs/04_DESIGN.md:510` to say profile resolution and the session check come from `@gobing-ai/publish-harness/browser`.
- [ ] 6. `bun run lint`, `bun run test`, `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
