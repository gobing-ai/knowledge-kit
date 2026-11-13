---
schema_version: 1
name: "xhs-pub: out-of-page outcome capture, no headless console visits, shared bot login path"
status: done
template: feature-impl
created_at: 2026-11-13T19:00:05.748Z
updated_at: "2026-11-13T20:55:44.416Z"
feature_id: E9

ac_altitude: task-local
ac_numbering: task-local
priority: P1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0370-verdict.json
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

- [x] R1. Outcome capture reads responses out of page only: delete `CAPTURE_INJECT_EXPR`, `CAPTURE_READ_EXPR` and their callers; arm `onContextResponse` before the save/publish click and classify the collected bodies with the existing rules unchanged (-913x or risk text → `AccountRiskControlError`; platform biz error → `PublishError`; `note_id` → `metadata.serverCapture`). A context without the listener degrades to the UI signals, as today.
- [x] R2. No expression the plugin sends to `page.evaluate` or `addInitScript`, in any of the four operations and in draft verification, assigns to or wraps `fetch`, `XMLHttpRequest`, `console`, or any other page global. Reads stay allowed.
- [x] R3. A publish launches the browser exactly once, headed. The headless preflight is removed from `XhsBrowserTransport`; the first flow step is the readiness gate (`isXhsConsoleReady`, bounded by `PREFLIGHT_TIMEOUT_MS`), and a console that is not ready ends the run with a typed session refusal (`effect: none`) naming `kk bot login xhs` — it never waits for an interactive login.
- [x] R4. The automation guard is unchanged in shape: the `publish` budget is consumed at that single launch, and a refusal by the guard happens before any launch.
- [x] R5. `check` (the manifest `check` entry) launches no browser by default: profile directory absent → `refused`; `bot.json` `expiresAt` in the past → `refused` naming the date; otherwise `verified` with a detail starting `offline:` and the expiry or `expiry unknown`. It reads metadata through `readBotMetadata` (`packages/publish-harness/src/bot.ts`) and does not draw the `check` budget. `check --headed` keeps today's headed probe and budget. No call in the plugin can launch headless.
- [x] R6. `login` and `open` go through the shared `runProfileCli` path with the xhs readiness predicate, so a bot-mode login verdict carries `expiresAt` like the other channels. The hand-rolled `loginProfile` and `openXhsSession` are deleted. `login` and `open` stay outside the automation budget.
- [x] R7. Existing typed errors, receipts, `Result` metadata keys and exit codes are unchanged, except the preflight-refusal detail text; no existing test assertion is weakened — a test of removed behaviour is replaced by one for its successor and both are listed in Solution.
- [x] R8. Docs in the same commit: a dated amendment under ADR-025 in `docs/00_ADR.md` (preflight is the readiness gate of the single headed visit; `check` is offline by default); `docs/04_DESIGN.md` ADR-025 paragraph (line 1892 on 2026-11-13) and `docs/design/xhs-image-cards.md` rule 1 (line 78) no longer describe a headless preflight; module comments describing the removed capture layer are corrected.
- [x] R9. `bun run lint`, `bun run test`, `bun run build` exit 0; `plugins/publishings/xhs-pub/src/*.ts` each stay at or above 90% line and function coverage.

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

1. [x] Read `flow.ts` capture layer, `index.ts` transport, `profile-check.ts`, `packages/publish-harness/src/browser.ts` `runProfileCli`, and `bot.ts` `readBotMetadata`.
2. [x] Write the AC1–AC4 tests and confirm the focused cases against the implementation.
3. [x] R1–R2 (capture): removed in-page patches; context response, page console, and read-only risk-text capture are armed before actions and disposed afterward.
4. [x] R3–R4 (single launch): removed publish preflight, added the bounded headed readiness gate, and consume the publish budget only after the opener succeeds.
5. [x] R5–R6 (offline check, shared login): default check reads profile metadata offline; headed check remains explicit; login/open use `runProfileCli`.
6. [x] R8 docs and targeted checks. Full `bun run lint`, `bun run test`, and `bun run build` remain pipeline-owned; no live XHS visit was run.

### Solution

Implemented the 0370 XHS safety changes in the existing plugin seams.

- `plugins/publishings/xhs-pub/src/flow.ts:251-328` removes the in-page XHR/fetch/console/MutationObserver capture and replaces it with context response bodies, page console events, and a read-only DOM risk-leaf delta. The capture is armed before each save/publish action, waits bounded response-body reads, classifies through the existing risk/biz/note-id rules, and always disposes both listeners (`plugins/publishings/xhs-pub/src/flow.ts:1118-1184`, `:1193-1237`).
- `plugins/publishings/xhs-pub/src/index.ts:239-253` retains only the explicit headed session probe; `plugins/publishings/xhs-pub/src/index.ts:292-342` removes publish preflight, launches once headed, gates readiness inside that visit, returns an effect-free refusal naming `kk bot login xhs`, and records the publish budget only after the opener succeeds.
- `plugins/publishings/xhs-pub/src/profile-check.ts:1-152` makes default `check` offline through `readBotMetadata`, refuses absent/expired/corrupt metadata, preserves `check --headed`, and routes `login`/`open` through shared `runProfileCli` so bot-mode login preserves `expiresAt`.
- `plugins/publishings/xhs-pub/src/page.ts:14-16` and `:204-205` correct stale readiness comments; `plugins/publishings/xhs-pub/src/automation-guard.ts:10-14` documents the new visit accounting.
- `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:554-827` and `:3765-3810` cover all four operations/modes, forbidden page-global mutation, response capture precedence and bounded body reads, one headed launch/readiness refusal, offline metadata cases, shared login expiry, and read-only DOM probing. The AC1 test writes `.works/tmp/test-xhs-capture/summary.json`.
- `docs/00_ADR.md:1100-1112`, `docs/04_DESIGN.md:1884-1892`, and `docs/design/xhs-image-cards.md:78-103` record the dated ADR-025 amendment and current operator behavior. The live channel remains disabled; no live XHS visit was performed.

The existing task scope and typed errors/result metadata remain intact. The only intentional behavior change outside the three removals is that a browser launch failure does not consume a publish visit budget, because no console visit occurred.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/xhs-pub/src/flow.ts:263-325` arms context-response and page-console capture before each action, and `plugins/publishings/xhs-pub/src/flow.ts:1123-1237` classifies and disposes it; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:554-613` covers all operations/modes, risk refusal, note-id metadata, and listener disposal. |
| R2 | MET | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:554-595` records every evaluated expression for all four operations and both modes and rejects page-global mutation patterns; `plugins/publishings/xhs-pub/src/flow.ts:251-263` uses a read-only DOM expression. |
| R3 | MET | `plugins/publishings/xhs-pub/src/index.ts:292-391` performs the bounded readiness gate inside the single headed visit and returns the typed login refusal; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:620-756` proves one headed launch, bounded dead-session refusal, and effect-free delivery. |
| R4 | MET | `plugins/publishings/xhs-pub/src/index.ts:316-335` checks the publish budget before opening and records one visit only after the opener succeeds; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2310-2388` proves refusal before opening after the budget is spent. |
| R5 | MET | `plugins/publishings/xhs-pub/src/profile-check.ts:104-150` performs offline metadata checks and keeps headed probing explicit; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:666-743` covers future, expired, legacy, absent, corrupt, unreadable, and misspelled-headed cases without a browser. |
| R6 | MET | `plugins/publishings/xhs-pub/src/profile-check.ts:75-101` routes login/open through the shared profile CLI with the XHS readiness predicate; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:764-807` verifies headed login, default URL, and cookie-derived expiry. |
| R7 | MET | `plugins/publishings/xhs-pub/src/index.ts:69-84` preserves typed `Result` failures and effect metadata; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3731-3763` verifies risk and business-error behavior, and the full XHS test file reports 170 pass and 0 fail with no weakened assertions. |
| R8 | MET | `docs/00_ADR.md:1105-1118`, `docs/04_DESIGN.md:1890-1892`, and `docs/design/xhs-image-cards.md:78-103` document the dated one-headed-visit, offline-check, and out-of-page-capture policy. |
| R9 | MET | `bun run lint`, `bun run test`, and `bun run build` completed successfully; the full test receipt reports 5142 pass and 0 fail across 280 files, and the XHS source coverage receipt reports every changed source file at or above 90% line and function coverage. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — The page is never modified to observe a publish (req: R1, R2) | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:554-613` executes all four operations in draft/live modes, audits evaluate expressions, verifies -9136 refusal and note-id metadata, writes the capture summary, and confirms listeners are disposed. |
| Scenario: AC2 — One headed launch per publish, none when the session is dead (req: R3, R4, R7) | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:620-756` and `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2310-2388` verify one headed launch, bounded readiness refusal with effect none, and budget refusal before launch. |
| Scenario: AC3 — The session check opens no browser (req: R5) | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:666-743` verifies offline metadata outcomes, unchanged guard events, and rejection of a misspelled headed flag; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2287-2305` verifies explicit headed probing. |
| Scenario: AC4 — Login records session facts through the shared path (req: R6) | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:764-807` verifies the final JSON login verdict contains status, default URL, and expires-at facts and that the launch is headed. |
| Scenario: AC5 — Gate and records (req: R8, R9) | MET | command | `bun run lint`, `bun run test`, `bun run build`, `bun run test-pre-check`, and `bun run test-post-check` all completed successfully; `docs/00_ADR.md:1105-1118` carries the dated ADR-025 amendment. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

## Review verdict

Verdict: PASS

Confidence: HIGH

Scope: XHS implementation and documentation in `1095d009`, repository gate-environment repair in
`28b1df6e`, and authorized task/rule evidence repairs in `cc5e1a5e`. The gate repairs are additive
test-environment and corpus-evidence fixes; they do not change XHS runtime behavior.

#### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
|---|---|---|---|---|---|
| 1 | P4 | verification | No open correctness, security, efficiency, usability, or architecture finding. The live XHS browser, profile, and publishing path were not invoked by scope. | `plugins/publishings/xhs-pub/` | CLOSED |

#### Functional traceability

| Requirement | Status | Evidence |
|---|---|---|
| R1 | MET | `plugins/publishings/xhs-pub/src/flow.ts:263-325` and `:1123-1237` implement bounded out-of-page capture and disposal; the full XHS test file reports 170 pass and 0 fail. |
| R2 | MET | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:554-595` audits all recorded expressions for page-global mutation and passes. |
| R3 | MET | `plugins/publishings/xhs-pub/src/index.ts:292-391` performs one headed visit with the bounded readiness gate and typed login refusal. |
| R4 | MET | `plugins/publishings/xhs-pub/src/index.ts:316-335` records the visit only after an opener succeeds; cap/refusal tests pass. |
| R5 | MET | `plugins/publishings/xhs-pub/src/profile-check.ts:104-150` implements offline metadata checks; offline and explicit-headed tests pass. |
| R6 | MET | `plugins/publishings/xhs-pub/src/profile-check.ts:75-101` uses the shared profile path; the expiry-bearing login test passes. |
| R7 | MET | `plugins/publishings/xhs-pub/src/index.ts:69-84` preserves typed `Result` failures and effect metadata; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3731-3763` verifies risk and business-error behavior. |
| R8 | MET | `docs/00_ADR.md:1105-1118`, `docs/04_DESIGN.md:1890-1892`, and `docs/design/xhs-image-cards.md:78-103` are synchronized with the implementation. |
| R9 | MET | Lint, full tests, build, pre-check, and post-check all pass; the full receipt is 5142 pass / 0 fail and every XHS source file meets the stated coverage threshold. |

#### Design conformance

| Design claim | Status | Evidence |
|---|---|---|
| Out-of-page response/console/DOM capture replaces page-global patching | DONE | `plugins/publishings/xhs-pub/src/flow.ts:251-325` and `:1123-1237` |
| Readiness is the first step of one headed visit and consumes one visit budget | DONE | `plugins/publishings/xhs-pub/src/index.ts:292-391` |
| Default check is offline and login/open use the shared profile path | DONE | `plugins/publishings/xhs-pub/src/profile-check.ts:75-150` |
| ADR/design documentation and tests are updated in the same implementation slice | DONE | `docs/00_ADR.md:1105-1118`, `docs/04_DESIGN.md:1890-1892`, and XHS tests |

#### Verification

The full XHS test file passes 170 tests with 0 failures. Repository verification completed with
`bun run lint`, `bun run test`, and `bun run build`; the rule pre-check and post-check also exit 0.
No live XHS visit or publishing action was performed.

### References

- ADR-025 (`docs/00_ADR.md`), ADR-050 (bot recovery contract), `docs/04_DESIGN.md` §1.12 (`kk bot`).
- Task 0350 (the ported capture layer), commits `12dcead1`, `8aa2bc22`, `d1d1ca0e`.
- `.spur/context/pitfalls.md` — 2026-11-10 xhs entries; 2h visit cap.
- Follow-up, not this task: operator re-enables xhs draft-only after the account clears; feature-level move of the launcher to an attached, normally started Chrome.

### History

- 2026-11-13T19:28:04.479Z backlog → todo (system)
- 2026-11-13T20:55:24.829Z todo → wip (system)
- 2026-11-13T20:55:25.045Z wip → testing (system)
- 2026-11-13T20:55:27.395Z testing → done (system)
