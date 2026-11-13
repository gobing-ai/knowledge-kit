---
schema_version: 1
name: "xhs-pub: out-of-page outcome capture, no headless console visits, shared bot login path"
status: todo
template: feature-impl
created_at: 2026-11-13T19:00:05.748Z
updated_at: "2026-11-13T20:16:52.684Z"
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

- [x] R1. Outcome capture reads responses out of page only: delete `CAPTURE_INJECT_EXPR`, `CAPTURE_READ_EXPR` and their callers; arm `onContextResponse` before the save/publish click and classify the collected bodies with the existing rules unchanged (-913x or risk text → `AccountRiskControlError`; platform biz error → `PublishError`; `note_id` → `metadata.serverCapture`). A context without the listener degrades to the UI signals, as today.
- [x] R2. No expression the plugin sends to `page.evaluate` or `addInitScript`, in any of the four operations and in draft verification, assigns to or wraps `fetch`, `XMLHttpRequest`, `console`, or any other page global. Reads stay allowed.
- [x] R3. A publish launches the browser exactly once, headed. The headless preflight is removed from `XhsBrowserTransport`; the first flow step is the readiness gate (`isXhsConsoleReady`, bounded by `PREFLIGHT_TIMEOUT_MS`), and a console that is not ready ends the run with a typed session refusal (`effect: none`) naming `kk bot login xhs` — it never waits for an interactive login.
- [x] R4. The automation guard is unchanged in shape: the `publish` budget is consumed at that single launch, and a refusal by the guard happens before any launch.
- [x] R5. `check` (the manifest `check` entry) launches no browser by default: profile directory absent → `refused`; `bot.json` `expiresAt` in the past → `refused` naming the date; otherwise `verified` with a detail starting `offline:` and the expiry or `expiry unknown`. It reads metadata through `readBotMetadata` (`packages/publish-harness/src/bot.ts`) and does not draw the `check` budget. `check --headed` keeps today's headed probe and budget. No call in the plugin can launch headless.
- [x] R6. `login` and `open` go through the shared `runProfileCli` path with the xhs readiness predicate, so a bot-mode login verdict carries `expiresAt` like the other channels. The hand-rolled `loginProfile` and `openXhsSession` are deleted. `login` and `open` stay outside the automation budget.
- [x] R7. Existing typed errors, receipts, `Result` metadata keys and exit codes are unchanged, except the preflight-refusal detail text; no existing test assertion is weakened — a test of removed behaviour is replaced by one for its successor and both are listed in Solution.
- [x] R8. Docs in the same commit: a dated amendment under ADR-025 in `docs/00_ADR.md` (preflight is the readiness gate of the single headed visit; `check` is offline by default); `docs/04_DESIGN.md` ADR-025 paragraph (line 1892 on 2026-11-13) and `docs/design/xhs-image-cards.md` rule 1 (line 78) no longer describe a headless preflight; module comments describing the removed capture layer are corrected.
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

- `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts --test-name-pattern 'capture|profile|session|login|readiness|preflight|launch|headless|automation'`: 80 pass, 0 fail, 325 assertions; the filtered command's per-file coverage report is informational because it imports broad shared modules.
- `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`: 170 pass, 0 fail, 673 assertions. The test cases are green; Bun's single-file coverage run reports below-threshold coverage in imported shared modules and therefore is not the repository gate. The required root `bun run test` remains pipeline-owned.
- `bun run --filter @gobing-ai/xhs-pub typecheck`: PASS.
- `bunx biome check plugins/publishings/xhs-pub/src/automation-guard.ts plugins/publishings/xhs-pub/src/flow.ts plugins/publishings/xhs-pub/src/index.ts plugins/publishings/xhs-pub/src/modes.ts plugins/publishings/xhs-pub/src/page.ts plugins/publishings/xhs-pub/src/profile-check.ts plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`: PASS.
- `spur task gate 0370 light`: BLOCKED by Spur because `docs/00_ADR.md` has no owning workspace package; Spur explicitly requires the full suite for this cross-cutting documentation change.
- No live XHS browser, publishing, or profile was opened. `bun run lint`, `bun run test`, and `bun run build` are left to the pipeline gate.

Continuation checks (2026-11-13): full `bun run lint` and `bun run build` exited 0 (0370-lint-final.log and 0370-build-final.log). Full `bun run test` reported workflow-tree, kk-collect and voice3 migration failures outside changed files; stopped after confirmed failures (exit 130), so the complete suite/coverage gate is NOT passed. Baseline status of these failures is not established. Evidence: .spur/run/0370-test-final.log. `spur rule run` exited 1 because @gobing-ai/spur/schemas/preset.schema.json cannot resolve from the worktree (0370-rules-final.log). `spur task check 0370 --json` passed. Implementation retained for review; no completion verdict, merge, push or live XHS visit. Remaining: resolve gate environment/failures, rerun full checks, review and verify.

Verification correction (2026-11-13): the initial cap test assumed a browser-launch failure consumed the visit budget, which contradicts the task's launch accounting. It now first performs a successful headed launch that refuses readiness, then proves the next publish is refused before `openPage`; `bun test ... --test-name-pattern 'cap: a second publish inside the window'` reports 1 pass / 0 fail (the single-file coverage wrapper exits 1 because unrelated imported files are under threshold). The full XHS file reports 170 pass / 0 fail / 673 assertions; changed XHS source coverage is automation-guard 98.25% lines / 100% functions, flow 99.31% / 90.73%, index 100% / 100%, modes 96.61% / 100%, page 97.39% / 94.23%, profile-check 100% / 100%.

Repository baseline evidence (same clean base `233070e1` on `main`): `g-feature-tree.test.ts` fails because `kk-itc-author` has homes `G2` and `G61`; `kk-collect.test.ts` fails two E2E cases with `system_events.uncataloged`; `smart-seo-installed.test.ts` fails because `@gobing-ai/spur/package.json` is unavailable. These failures reproduce without 0370 files. Voice3 migration failures also occur in the task branch outside the changed paths. Full `bun run lint` and `bun run build` exit 0. `spur rule run` resolves with `NODE_PATH=/Users/robin/.bun/install/global/node_modules` but fails the unrelated dead-run-scoped-citation rule on tasks 0349 and 0350. The repository-wide R9 gate remains externally blocked; no XHS-specific failure remains.

### Review

## Review verdict

Verdict: PARTIAL

Confidence: HIGH

#### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
|---|---|---|---|---|---|
| 1 | P4 | verification | The XHS implementation and changed-file coverage pass, but the repository-wide R9 command is blocked by pre-existing failures on the clean base and the rules preset reports unrelated dead run-scoped citations in tasks 0349/0350. | `.spur/run/0370-verification-append.md` | OPEN external gate |

#### Functional traceability

| Requirement | Status | Evidence |
|---|---|---|
| R1 | MET | `plugins/publishings/xhs-pub/src/flow.ts` context response/page console/read-only DOM capture; AC1 tests pass |
| R2 | MET | AC1 expression audit passes for all four operations and both modes |
| R3 | MET | single headed launch/readiness refusal tests pass |
| R4 | MET | guard launch accounting and refusal-before-open tests pass |
| R5 | MET | offline and explicit headed profile checks pass |
| R6 | MET | shared `runProfileCli` login/open tests pass |
| R7 | MET | existing typed result/error assertions remain green in 170-test XHS run |
| R8 | MET | dated ADR-025 amendment and design docs updated |
| R9 | PARTIAL | changed XHS files meet coverage; full repository test/rules gates are blocked by unrelated baseline/environment failures |

No P1–P3 findings. No live XHS browser, profile or publish was used.

### References

- ADR-025 (`docs/00_ADR.md`), ADR-050 (bot recovery contract), `docs/04_DESIGN.md` §1.12 (`kk bot`).
- Task 0350 (the ported capture layer), commits `12dcead1`, `8aa2bc22`, `d1d1ca0e`.
- `.spur/context/pitfalls.md` — 2026-11-10 xhs entries; 2h visit cap.
- Follow-up, not this task: operator re-enables xhs draft-only after the account clears; feature-level move of the launcher to an attached, normally started Chrome.

### History

- 2026-11-13T19:28:04.479Z backlog → todo (system)
