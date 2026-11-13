---
schema_version: 1
name: "xhs-pub: out-of-page outcome capture, no headless console visits, shared bot login path"
status: backlog
template: feature-impl
created_at: 2026-11-13T19:00:05.748Z
updated_at: "2026-11-13T19:19:27.787Z"
feature_id: E9

ac_altitude: task-local
ac_numbering: task-local
priority: P1
---

## 0370. xhs-pub: out-of-page outcome capture, no headless console visits, shared bot login path

### Background

The xhs account was flagged for abnormal activity again (risk-control code -9136 on the publish after the 2026-11-11/12 repair; xhs is `off` in every window since `d1d1ca0e`). An audit on 2026-11-13 found no third-party xhs library at runtime, but three things in our own code that make a publish look automated or cost extra console visits:

1. **In-page native patching.** Task 0350 (2026-11-10) ported a response-sniffing pattern from an external reference: `flow.ts` replaces `XMLHttpRequest.prototype` methods and `window.fetch` inside the creator-console page (`CAPTURE_INJECT_EXPR`, `plugins/publishings/xhs-pub/src/flow.ts:281`, `:296`, injected at `:347`). Replaced natives are a standard anti-bot check. The plugin already has an out-of-page listener (`onContextResponse`, `src/page.ts:276`).
2. **Headless console visits.** Every publish first runs a headless session preflight, retried headed on refusal (`checkXhsProfileSession`, `src/index.ts:259`), then the headed publish: up to three launches per publish on a site measured to wall headless loads (2026-09-29). The daily generate run also probes the session through the plugin's `check` entry.
3. **Hand-rolled session CLI.** `src/profile-check.ts` implements `login`/`open` on the upstream helpers directly, while 13 channels use the shared `runProfileCli`. Its bot-mode login verdict therefore lacks the session facts added in 0305 (`expiresAt`), so `kk bot list` cannot tell a stale xhs session without opening a browser.

Cause is inferred from the timeline, not proven: xhs does not say why an account is flagged. This task removes the three exposures; it does not re-enable the channel.

Out of scope: the publish preset (xhs stays `off`), any live xhs run, `apps/cli/src/**` (G61 tasks 0360–0369 own it), the browser launcher itself, other channels.

### Requirements

- [ ] R1. Outcome capture reads responses out of page only: delete `CAPTURE_INJECT_EXPR`, `CAPTURE_READ_EXPR` and their callers; arm `onContextResponse` before the save/publish click and classify the collected bodies with the existing rules unchanged (-913x or risk text → `AccountRiskControlError`; platform biz error → `PublishError`; `note_id` → `metadata.serverCapture`). A context without the listener degrades to the UI signals, as today.
- [ ] R2. No expression the plugin sends to `page.evaluate` or `addInitScript`, in any of the four operations and in draft verification, assigns to or wraps `fetch`, `XMLHttpRequest`, `console`, or any other page global. Reads stay allowed.
- [ ] R3. A publish launches the browser exactly once, headed. The headless preflight is removed from `XhsBrowserTransport`; the first flow step is the readiness gate (`isXhsConsoleReady`, bounded by `PREFLIGHT_TIMEOUT_MS`), and a console that is not ready ends the run with a typed session refusal (`effect: none`) naming `kk bot login xhs` — it never waits for an interactive login.
- [ ] R4. The automation guard is unchanged in shape: the `publish` budget is consumed at that single launch, and a refusal by the guard happens before any launch.
- [ ] R5. `check` (the manifest `check` entry) launches no browser by default: profile directory absent → `refused`; `bot.json` `expiresAt` in the past → `refused` naming the date; otherwise `verified` with a detail starting `offline:` and the expiry or `expiry unknown`. It reads metadata through `readBotMetadata` (`packages/publish-harness/src/bot.ts`) and does not draw the `check` budget. `check --headed` keeps today's headed probe and budget. No call in the plugin can launch headless.
- [ ] R6. `login` and `open` go through the shared `runProfileCli` path with the xhs readiness predicate, so a bot-mode login verdict carries `expiresAt` like the other channels. The hand-rolled `loginProfile` and `openXhsSession` are deleted. `login` and `open` stay outside the automation budget.
- [ ] R7. Existing typed errors, receipts, `Result` metadata keys and exit codes are unchanged, except the preflight-refusal detail text; no existing test assertion is weakened — a test of removed behaviour is replaced by one for its successor and both are listed in Solution.
- [ ] R8. Docs in the same commit: a dated amendment under ADR-025 in `docs/00_ADR.md` (preflight is the readiness gate of the single headed visit; `check` is offline by default); `docs/04_DESIGN.md` ADR-025 paragraph (line 1892 on 2026-11-13) and `docs/design/xhs-image-cards.md` rule 1 (line 78) no longer describe a headless preflight; module comments describing the removed capture layer are corrected.
- [ ] R9. `bun run lint`, `bun run test`, `bun run build` exit 0; `plugins/publishings/xhs-pub/src/*.ts` each stay at or above 90% line and function coverage.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The page is never modified to observe a publish (req: R1, R2)
  Given the fake console scripted for 上传图文, 上传视频, 写长文 and 发播客, in draft and live mode
  When each operation runs to completion and the fake records every expression sent to evaluate and addInitScript
  Then no recorded expression matches /XMLHttpRequest|\.fetch\s*=|console\.\w+\s*=|prototype\.(open|send)/
  And a save response carrying code -9136 delivered through the context response listener throws AccountRiskControlError
  And a response carrying note_id lands in Result metadata.serverCapture
  And the test writes .works/tmp/test-xhs-capture/summary.json listing operation, mode, expression count and verdict

Scenario: AC2 — One headed launch per publish, none when the session is dead (req: R3, R4, R7)
  Given a recording launcher and a console that is ready
  When a draft publish runs
  Then the launcher was called exactly once with headless false and the guard recorded one publish event
  And with a console that never becomes ready the run ends inside PREFLIGHT_TIMEOUT_MS with a session refusal of effect none naming `kk bot login xhs`
  And with the publish budget already spent the launcher is never called

Scenario: AC3 — The session check opens no browser (req: R5)
  Given a profile with bot.json expiresAt in the future, one with expiresAt in the past, one without expiresAt, and no profile
  When `profile-check.ts check` runs for each with a launcher that throws when called
  Then the verdicts are verified (offline, expiry date), refused (expired date), verified (offline, expiry unknown), refused (no profile)
  And the automation state file is unchanged
  And `check --headed` calls the launcher once with headless false and records one check event

Scenario: AC4 — Login records session facts through the shared path (req: R6)
  Given a recording launcher whose page passes the xhs readiness predicate and holds one persistent httpOnly cookie
  When `profile-check.ts login --url <publish url>` runs
  Then the last stdout line is a JSON verdict with status verified, defaultUrl and expiresAt
  And `rg -n "loginWithProfile|openPersistentBrowser" plugins/publishings/xhs-pub/src` prints nothing

Scenario: AC5 — Gate and records (req: R8, R9)
  Given the change is applied
  When `bun run lint && bun run test && bun run build` run
  Then all exit 0 and ADR-025 carries the dated amendment
```

### Q&A

- **Tests first.** Write AC1–AC4 as failing tests against the untouched tree before editing `src/`. Ways this can fail, to be covered before the code: a capture armed after the click misses the response; a response arriving from a worker or a second tab is not seen by a page-level listener (use the context listener); the listener is left attached after the flow and leaks into draft verification; the readiness gate waits the login timeout instead of the preflight timeout; the guard budget is consumed although the launch never happened; an unreadable `bot.json` is treated as "no expiry" instead of refused; `check` silently launches when `--headed` is misspelt.
- **Why not keep the headless preflight for a fast refusal?** The readiness gate inside the headed visit gives the same fast refusal with one launch instead of up to three, and headless loads of this console are walled (ADR-025 amendment 2026-09-29).
- **A dead session now costs a publish budget.** Yes: a console visit happened, and the budget counts visits. Recovery is `kk bot login xhs` (uncapped) and the next window. State this in the ADR amendment.
- **Is `expiresAt` proof of a live session?** No, it is an estimate from the cookie jar at login. Offline `check` only answers "is there a reason to expect failure"; the readiness gate in the publish visit is the authority.
- **Profiles logged in before this task have no `expiresAt`.** They report `verified … expiry unknown`. Do not force a re-login.
- **Console-message capture.** If a verdict today comes only from a patched `console.*`, use Playwright's page `console` event through the `XhsPage` seam; do not re-add an in-page wrapper.
- **Can the harness change?** Only additively (an optional field or hook on `runProfileCli` / `ChannelBrowserConfig`) and only if R6 cannot be met without it. The other 13 channels' behaviour and tests must not change.
- **No live run.** The account is flagged and the channel is off. Do not open the xhs console with the real profile, do not edit the publish preset. Live confirmation is an operator-run follow-up: record it under Testing as not run.
- **Concurrent work.** G61 tasks 0360–0369 are editing `apps/cli/src/**` and the workflows. Stay inside `plugins/publishings/xhs-pub/**`, the three docs named in R8, and (if needed, additively) `packages/publish-harness/src/browser.ts`.

### Design

| File | Change |
| --- | --- |
| `plugins/publishings/xhs-pub/src/flow.ts` | R1, R2: remove the inject/read expressions; one `armOutcomeCapture(page)` built on `onContextResponse`/`offContextResponse`, returning the collected bodies to the existing classifier. R3: readiness gate as the first step. |
| `plugins/publishings/xhs-pub/src/page.ts` | Seam only if a page `console` event is needed (Q&A). |
| `plugins/publishings/xhs-pub/src/index.ts` | R3, R4: drop `preflight` from `XhsBrowserTransport`; `checkXhsProfileSession` keeps only the headed form used by `check --headed`. |
| `plugins/publishings/xhs-pub/src/profile-check.ts` | R5: offline `check`. R6: `login`/`open` delegate to `runProfileCli`. |
| `plugins/publishings/xhs-pub/tests/*` | AC1–AC4, written first. |
| `docs/00_ADR.md`, `docs/04_DESIGN.md`, `docs/design/xhs-image-cards.md` | R8. |

Nothing new is abstracted: the response listener, the readiness predicate, `runProfileCli`, `readBotMetadata` and the guard all exist. Expected net change is a deletion.

**Capture shape (worked out 2026-11-13, not implemented).** The removed layer has four sources; each has an out-of-page equivalent:

| Removed in-page source | Replacement |
| --- | --- |
| patched XHR / `fetch` | context `response` event, `response.text()` for `resourceType` `xhr`/`fetch` only; await pending body reads before classifying |
| patched `console.*` | the driver's page `console` event through the existing `XhsPage.on`/`off` seam |
| `MutationObserver` writing `window.__kkXhsOutcome` | a read-only expression listing short leaf texts that match the risk phrases, diffed against the same read taken when the capture armed |

Arm before the click, dispose in a `finally`. `settleConsole` (`flow.ts:736`) unsubscribes a different closure than it subscribed, so its listener leaks: fix it in the same change. The test fake holds one context handler and its `evaluate` log drops the expression; it needs a handler set, the expression recorded, and the scripted outcome delivered at the save/publish click rather than at subscribe time. The full plugin test file takes over two minutes: run with `-t` while iterating.

### Plan

1. Read `flow.ts` capture layer (`:231`–`:400`, `:640`–`:740`), `index.ts` transport, `profile-check.ts`, `packages/publish-harness/src/browser.ts` `runProfileCli`, `bot.ts` `readBotMetadata`.
2. Write the AC1–AC4 tests; confirm each fails on the untouched tree.
3. R1–R2 (capture). Run the plugin tests.
4. R3–R4 (single launch). Run the plugin tests.
5. R5–R6 (offline check, shared login). Run the plugin tests.
6. R8 docs. `bun run lint && bun run test && bun run build`. One commit: `fix(xhs-pub): …`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- ADR-025 (`docs/00_ADR.md`), ADR-050 (bot recovery contract), `docs/04_DESIGN.md` §1.12 (`kk bot`).
- Task 0350 (the ported capture layer), commits `12dcead1`, `8aa2bc22`, `d1d1ca0e`.
- `.spur/context/pitfalls.md` — 2026-11-10 xhs entries; 2h visit cap.
- Follow-up, not this task: operator re-enables xhs draft-only after the account clears; feature-level move of the launcher to an attached, normally started Chrome.

### History
