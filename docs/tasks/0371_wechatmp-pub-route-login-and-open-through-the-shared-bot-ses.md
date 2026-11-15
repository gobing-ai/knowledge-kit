---
schema_version: 1
name: "wechatmp-pub: route login and open through the shared bot session path"
status: done
template: feature-impl
created_at: 2026-11-13T19:00:06.213Z
updated_at: "2026-11-15T04:57:25.295Z"
feature_id: E9

ac_altitude: task-local
ac_numbering: task-local
dependencies: ["0370"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0371-verdict.json
---

## 0371. wechatmp-pub: route login and open through the shared bot session path

### Background

Audit 2026-11-13 (with task 0370): `wechatmp-pub` is the only other channel whose session CLI is hand-rolled. `src/profile-check.ts` and `src/index.ts` call the upstream `openPersistentBrowser` directly (`src/index.ts:164`, `:229`), and its bot-mode login verdict is `{status, profileDir, defaultUrl}` without the session facts added in 0305, so `kk bot list` shows `unknown` expiry for it. Thirteen channels get this from the shared `runProfileCli`.

WeChat is not flagged and its publish path (same-origin CGI draft with an exported `storage-state.json`) works; this task only removes the duplicated login/open path. Out of scope: the CGI publish flow, `apps/cli/src/**`, any live WeChat publish.

### Requirements

- [x] R1. `login` and `open` in `plugins/publishings/wechatmp-pub/src/profile-check.ts` run through the shared `runProfileCli` path with the WeChat readiness predicate; the bot-mode login verdict carries `expiresAt` like the other channels.
- [x] R2. The `storage-state.json` export after a successful login is preserved byte-for-byte in shape and location (`storageStatePath`), including its atomic temp-file write.
- [x] R3. `check` behaviour, output and exit codes are unchanged; no existing test assertion is edited.
- [x] R4. After the change, `rg -n "openPersistentBrowser" plugins/publishings/wechatmp-pub/src` prints only call sites the publish flow itself needs; each remaining one is listed in Solution with the reason.
- [x] R5. A harness change is allowed only as an additive optional hook (for the storage-state export) and must leave the other channels' tests untouched. `bun run lint`, `bun run test`, `bun run build` exit 0.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Login records session facts and still exports storage state (req: R1, R2)
  Given a recording launcher whose page passes the WeChat readiness predicate and holds one persistent httpOnly cookie
  When `profile-check.ts login --url <console url>` runs
  Then the last stdout line is a JSON verdict with status verified, defaultUrl and expiresAt
  And storage-state.json exists at storageStatePath(profileDir) and no temp file is left beside it

Scenario: AC2 — Check and the publish flow are unchanged (req: R3, R4, R5)
  Given the change is applied
  When `git diff --stat -- plugins/publishings/wechatmp-pub/tests` and `bun run lint && bun run test && bun run build` run
  Then no existing assertion changed and all three commands exit 0
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T19:01:13.628Z

- **Tests first.** Write AC1 before the code. Failure modes to cover: the storage-state export runs before the readiness predicate passes; the export is skipped on the shared path; a refused login leaves a partial `storage-state.json`.
- **Why separate from 0370?** Different channel, no account risk, and it can wait; 0370 is urgent.
- **If `runProfileCli` cannot host the export without a non-additive change**, stop and report instead of forking the helper.

### Design

`plugins/publishings/wechatmp-pub/src/profile-check.ts` delegates `login`/`open` to `runProfileCli`; the storage-state export runs on the page the predicate accepted. `src/index.ts` keeps `storageStatePath` and the export function. Reuse the shape 0370 lands for xhs.

### Plan

1. Read `wechatmp-pub/src/profile-check.ts`, `src/index.ts:95-240`, and `runProfileCli` in `packages/publish-harness/src/browser.ts`.
2. Write AC1; confirm it fails.
3. R1–R4. `bun run lint && bun run test && bun run build`. One commit.

### Solution

Change map (one anchor per row; R1–R5). `login` and `open` now run through the shared
`runProfileCli`; the channel's `storage-state.json` artifact survives through two additive optional
harness hooks.

| Requirement | Change |
| --- | --- |
| R1 | `plugins/publishings/wechatmp-pub/src/profile-check.ts:85` — the `login`/`open` branch calls `runProfileCli(wechatSessionConfig, argv, …)` with an injectable launcher and a stdout adapter that mirrors refusals to stderr |
| R1 | `plugins/publishings/wechatmp-pub/src/index.ts:273` — `wechatSessionConfig` carries the console readiness predicate, the canonical home URL and the session hooks; bot-mode `expiresAt` now comes from the shared `captureSessionFacts` |
| R1 | `plugins/publishings/wechatmp-pub/src/index.ts:259` — `wechatBrowserLauncher` is the single launch seam the shared CLI and the publish flow open through |
| R2 | `plugins/publishings/wechatmp-pub/src/index.ts:279` — `onAuthenticated` settles then calls the unchanged `persistWechatSessionState`, so `storageStatePath` and the atomic temp-file + rename write are preserved byte-for-byte |
| R2 | `plugins/publishings/wechatmp-pub/src/index.ts:220` — `restoreWechatSessionState` is the extracted cookie + localStorage replay that `open` runs through `onOpen` |
| R3 | `plugins/publishings/wechatmp-pub/src/profile-check.ts:110` — `check` keeps the channel-owned `checkWechatSession` branch with its verdict shape, output and exit codes untouched |
| R4 | `plugins/publishings/wechatmp-pub/src/index.ts:199` — remaining `openPersistentBrowser` call in `openWithState`, needed by the read-only `check` probe because the shared check cannot re-inject a captured state |
| R4 | `plugins/publishings/wechatmp-pub/src/index.ts:261` — the other remaining call seeds `wechatBrowserLauncher.launch`, the seam every shared login/open and the publish flow launch through (not a second login routine) |
| R5 | `packages/publish-harness/src/browser.ts:95` — additive optional `sessionState` hooks on `ChannelBrowserConfig`; no existing channel sets them, so its behavior is unchanged |
| R5 | `packages/publish-harness/src/browser.ts:525` — `loginWithAuthenticatedPage` runs the capture hook on the page the readiness predicate accepted and keeps a landed capture a success when the context close then fails |
| R5 | `packages/publish-harness/src/browser.ts:495` — `openChannelSession` runs `onOpen` before navigation and closes + refuses when the hook cannot restore the session |

Deleted: `openWechatSession` (its re-injection now runs inside the shared `open` path) and the
direct `openPersistentBrowser` login in `openWechatLogin` (now a programmatic entry over
`runProfileCli`, kept because the publish flow and tests call it). Runtime-written evidence:
`.spur/run/0371-test-gate.status` (gate), `.spur/run/0371-verdict.json` (review).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/wechatmp-pub/src/profile-check.ts:85` `runProfileCli(wechatSessionConfig, …)` for `login`/`open` (`plugins/publishings/wechatmp-pub/src/profile-check.ts:83`); test `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check-shared-session.test.ts:75` asserts `expiresAt` (`plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check-shared-session.test.ts:94`). |
| R2 | MET | `plugins/publishings/wechatmp-pub/src/index.ts:125` `persistWechatSessionState`: target `storageStatePath` `plugins/publishings/wechatmp-pub/src/index.ts:129`, temp file `plugins/publishings/wechatmp-pub/src/index.ts:130`, atomic rename `plugins/publishings/wechatmp-pub/src/index.ts:138`; wired as the `onAuthenticated` hook `plugins/publishings/wechatmp-pub/src/index.ts:279`; test `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check-shared-session.test.ts:103` (only `storage-state.json` left). |
| R3 | MET | `check` still goes through `checkWechatSession` `plugins/publishings/wechatmp-pub/src/profile-check.ts:110`; `bun test plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts` → 12 pass / 0 fail (this run), e.g. `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:96`, `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:150`. |
| R4 | MET | `rg -n openPersistentBrowser plugins/publishings/wechatmp-pub/src` → `plugins/publishings/wechatmp-pub/src/index.ts:21` (import), `plugins/publishings/wechatmp-pub/src/index.ts:199`, `plugins/publishings/wechatmp-pub/src/index.ts:261` — publish-flow call sites only; none in `profile-check.ts`. |
| R5 | MET | additive optional hook `packages/publish-harness/src/browser.ts:95` `sessionState?: ChannelSessionStateHooks`; `spur --no-logo feature verify E9` (lint + rule checks + full test suite) → PASS, exit 0, 2026-11-14: 5341 pass / 0 fail across 303 files; log `.spur/run/run_a3d0d834-9156-4182-9aa8-1b3acfdb6700-feature-verification.log` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Login records session facts and still exports storage state (req: R1, R2) | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check-shared-session.test.ts:75` — 1 pass / 0 fail (this run) |
| AC2 — Check and the publish flow are unchanged (req: R3, R4, R5) | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:96`, `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:150` (12 pass / 0 fail); full suite: `spur --no-logo feature verify E9` (lint + rule checks + full test suite) → PASS, exit 0, 2026-11-14: 5341 pass / 0 fail across 303 files; log `.spur/run/run_a3d0d834-9156-4182-9aa8-1b3acfdb6700-feature-verification.log` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Re-review of the 0371 diff after the remediation visit (full tier green again: `spur task gate 0371
recheck` PASS in 1120373 ms at git tree `c323861a`, `.spur/run/0371-test-gate.log`). Dimensions:
functional traceability (R → `file:line`), SECUA, and architecture depth. Every finding from the
first pass was re-checked against the fixed tree instead of being copied forward.

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P2 (major) | `docs/04_DESIGN.md:1624` | T3 surface drift found in pass 1: the `ChannelBrowserConfig`, `runProfileCli` and wechatmp rows described a surface without the `sessionState` hooks. Fixed — `docs/04_DESIGN.md:1624` documents `sessionState?` (`onAuthenticated`/`onOpen`), `docs/04_DESIGN.md:1631` documents the page-scoped login and the `open` restore seam, `docs/04_DESIGN.md:1757` documents the shared `login\|open` routing with the channel-owned `check`. | RESOLVED |
| P3 (minor) | `packages/publish-harness/src/browser.ts:527` | Close-error tolerance was keyed on the login shape, so a bot-mode login with no hook silently swallowed a shutdown error and reported a capture it never made. Fixed — `sessionCaptured` is derived from `config.sessionState?.onAuthenticated`, so only a real hook capture excuses a close failure and every other channel keeps `withProfilePage` semantics. | RESOLVED |
| P4 (advisory) | `plugins/publishings/wechatmp-pub/src/profile-check.ts:90` | An `open` refusal printed twice on stderr. Fixed — only `profile login failed:` is mirrored; the `open` refusal reaches the operator once, through its composed verdict detail. | RESOLVED |

Residual risk carried by this review: the login/open path is exercised with recording launchers, not a
live WeChat console visit (the task's out-of-scope line forbids a live publish, and the QR scan is
operator-interactive). `check` remains the only verb whose session comes from the re-injected
state, so a state file that parses but no longer authenticates still reports `refused` at `check`
time rather than at `login` time — unchanged from before this task.

Confidence: HIGH
Verdict: PASS

### References

- Task 0370 (same alignment for xhs), 0305 (session facts), 0277 (bot channel binding). `docs/04_DESIGN.md` §1.12.

### History

- 2026-11-14T07:38:54.484Z backlog → todo (system)
- 2026-11-14T07:55:16.801Z todo → wip (system)
- 2026-11-14T08:39:06.162Z wip → testing (system)
- 2026-11-14T08:39:07.315Z testing → done (system)

