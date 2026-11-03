---
schema_version: 1
name: Restore unattended scheduled daily AI news generation and delivery after October 26 outage
status: done
template: issue
created_at: 2026-11-02T02:34:11.966Z
updated_at: "2026-11-03T07:24:59.581Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P0
feature_id: G11
done_forced: "false"
done_reason: unforced close
---

## 0338. Restore unattended scheduled daily AI news generation and delivery after October 26 outage

### Background

The scheduled daily AI news pipeline stopped delivering while Robin was away. Scope authorized on 2026-11-01: investigate failures since 2026-10-26, fix causes and verify tomorrow's unattended run; do not regenerate or publish historical editions. Preserve the starting dirty tree, especially publish-matrix changes and the existing digest-check fix. Workflow edits and runtime activation have been requested separately under AGENTS.md.

Observed evidence:
- Scheduler is live under launchd ai.gobing.spur-serve; each 04:30 local tick ran. Production remains voice2, not the unreleased voice3 migration.
- October 26 run 561af6d9-f2cc-485a-a478-ea8062116bd0 closed no-content: 2 candidates estimated 11 minutes below the configured 15-minute floor.
- October 27–29 parent and nested safety runs retain running records after the scheduled process stopped; no publish receipts exist.
- October 30–November 1 failed at safety. November 1 nested trace 323f6ab8-41fc-4ab3-92d9-aa9e4259cf6e and its saved agent sessions prove the primary wrote valid reports. Unconditional retry agent.run actions delete the primary's expectFile before dispatch; the Claude retry exits 3 with expired OAuth, leaving the gate no report/verdict. The gate correctly blocks and quarantines drafts.
- Primary Pi stages took tens of minutes and lack per-action timeout bounds. A configured codex-sol artifact-write probe passed in 10.6 seconds.
- WeChat readiness is refused (expired authentication). XHS is intentionally disabled and its cached browser lease is stale. Do not turn disabled channels on implicitly or change draft/live permissions.
- Publication settlement marks selections published without checking primary success. Classification discards a single available receipt and can falsely count duplicate/unexpected targets as complete.
- Plan/QC caches use existence alone, making a floor refusal sticky when input supply or runtime settings change.

Evidence remains in existing run artifacts and .works/tmp/test-daily-recovery. Do not copy credentials into reports.

### Requirements

- [x] R1. Preserve valid primary safety artifacts, retry only missing or invalid outputs, bound agent calls, and retain fail-closed draft-integrity checks.
- [x] R2. Recompute stale plan/QC caches when their decisive inputs change, allowing a no-content refusal to recover without manual file deletion or relaxed quality gates.
- [x] R3. Derive primary publish classification from actual named receipts and never promote store selections to published unless both required primary channels published.
- [x] R4. Record dated scheduler/run/channel evidence and honestly distinguish generation, primary publication, optional channel failures and unavailable authentication.
- [x] R5. Verify through failure-first automated behavior checks, required project gates and a fresh isolated workflow rehearsal; activate only approved runtime changes, with no historical backfill or duplicate live sends.

### Acceptance Criteria

```gherkin
Scenario: AC1 — successful primary review survives an unavailable retry (req: R1)
Given a primary safety reviewer wrote a valid report and a judge wrote a valid verdict
When the configured fallback is unavailable
Then the fallback is skipped and the unchanged reviewed drafts remain admissible

Scenario: AC2 — invalid review output stays blocked after bounded recovery (req: R1)
Given neither review attempt produces valid evidence
When the bounded safety workflow finishes
Then publication remains blocked with a recorded failure

Scenario: AC3 — changed supply or floor recovers no-content planning (req: R2)
Given a prior candidate cache was emptied by a duration-floor refusal
When decisive planning or QC inputs change
Then the next stage invocation recomputes rather than replaying the refusal

Scenario: AC4 — missing or duplicate primary receipts never establish full publication (req: R3)
Given primary publication has missing failed duplicate or unrelated receipts
When classification and store settlement run
Then actual successes remain visible and incomplete publication never promotes selections

Scenario: AC5 — recovery evidence records actual checks and activation state (req: R4, R5)
Given historical runs are inspected without replaying publication
When automated checks and an isolated rehearsal complete
Then a durable report records outcomes remaining authentication blockers and the exact active schedule
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-02T04:09:21.954Z

Robin explicitly answered `approved` to the concrete activation request in this conversation.
The request covered the prepared workflow fixes for the existing channel set, installed-package
sync, scheduler restart and cleanup of confirmed failed-run reservations. It did not authorize
historical edition regeneration, new channels or changing draft operations to live sends.

Activation performed on November 1: active workflow promotion and supervisor scheduler command;
backup and sync of affected installed code; six confirmed orphan records closed; 46 selections
released only after trace proof of no publication attempt. The scheduler restarted idle and
registered all five jobs. Evidence is in `.works/tmp/test-daily-recovery/probes/activation.json`,
`runtime-activation.json`, `runtime-verified.json`, `orphan-cleanup.json`,
`production-releases.json`, and `activated-scheduler-readiness.json`.

WeChat remains enabled and draft-only. Its first login window timed out without a QR scan. A
second login was opened using the existing configured Chrome channel with a longer timeout;
the operator's QR scan remains necessary. No authentication was fabricated and no new browser
dependency was installed. Final active-suite checks are in progress; no task verify PASS yet.

#### Q&A entry — 2026-11-03T03:46:52.665Z

Robin confirmed on November 2 that he published today's WeChat article after adding 原文链接
`https://surfing.salty.vip/zh/posts/20261102-ai-2026-11-02` and clicking 一键排版. Authenticated
publication history independently confirms one new post at 19:25 PST:
`https://mp.weixin.qq.com/s/sOCVXFjFlIzCxXq5WeY1pg`. Record this as operator-confirmed publication,
not an unattended plugin success. Do not send another copy of today's edition.

The missing original link exposed a workflow ordering issue: WeChat was prepared before the
Surfdash result existed. The repaired soft node waits for that attempt to settle and consumes
its observed successful URL. The native saved-editor investigation remains active; strict
title/body/media/cover equality remains required, with only observed WeChat CDN size variants
normalized.

The complete Surfdash code repair is prepared as reviewed local commit `21505ad` in
`/tmp/surfdash-candidate-latest-SD1WO5`. The explicit approval request to push that exact commit
is pending. No answer to the earlier future WeChat public-versus-draft policy question has been
received; its default remains unchanged. Approval for today's publication is not an answer to
those separate pending questions.

#### Q&A entry — 2026-11-03T05:29:25.849Z

The latest instruction, “make the process smooth to publish things on wechatmp as expected,” continues the original request for the whole existing daily workflow without HITL. The protected authenticated rehearsal reached the real final publication control at 21:10 PST after original-URL insertion, native formatting, acknowledged save, strict persisted snapshot checks and one bounded native latest-draft recovery. The final click was blocked independently at adapter and browser-event boundaries. Authenticated history rechecked at 21:28 PST still shows exactly 134 publications, including the one operator-posted November 2 edition. No duplicate or historical edition was sent.

The requested unattended public WeChat workflow authorizes activation of the existing scheduled --wechat-live opt-in after final gates. This clarification supersedes the earlier optional policy-question hold; it is based on the original and latest instructions, not silence. General plugin defaults remain draft, and no new channel is enabled. Actual runtime synchronization and scheduler reload must still be recorded after execution.

The separate request to push reviewed Surfdash production code commit 21505ad remains pending. Static cover deployment and overall task verification remain incomplete; do not mark task 0338 done or assert all-channel delivery.

#### Q&A entry — 2026-11-03T06:44:27.065Z

Activation completed on November 2 after final verification: full knowledge-kit suite exits zero (4,400 pass, zero fail, three baseline skips), lint/typecheck/build and pre58/post2 rules pass. The actual bun-global package is backed up and synchronized with eight matching hashes. Its WeChat readiness probe runs from outside the checkout against the installed plugin and reports authenticated/verified read-only.

The daily command now explicitly uses `KK_BROWSER_CHANNEL=chrome` and `--wechat-live`. Chrome matches the successful authenticated rehearsal; launchd previously had no channel override. The queue was idle for sync and restart. New scheduler PID86269 serves HTTP200, registers five configured plus three built-in schedules, and retains the November3 04:30PST / 12:30UTC tick. No historical run was regenerated, no podcast was resent and today's WeChat publication remains operator-confirmed rather than attributed to automation.

The complete Surfdash candidate is now `786652f` atop `21505ad` (eight files). Complete deployment validation found and repaired an extra Astro brace, then passed lint, content/SEO checks, pre/post rules, 1,380 tests and production build after frozen install. Independent review passes; parsed frontmatter values, bodies, assets and settings are unchanged. The current approval question explicitly covers both commits and supersedes older requests. No answer has been received and no source push/deployment occurred. Fresh three-locale checks still report page200/cover404. Overall verdict remains PARTIAL and task status remains wip until deployment and positive reconciliation finish.

### Design

Keep the active voice2 path. Spur owns orchestration and `kk` owns deterministic steps. General channel defaults remain draft and XHS remains disabled. Robin's original no-HITL request and latest public WeChat instruction authorize the existing daily scheduler's explicit `--wechat-live` option; its command also pins Chrome to reproduce the authenticated browser rehearsal.

Preserve valid primary safety artifacts; retry only missing/invalid evidence. Bound author/reviewer calls and the supervised scheduled process tree, retain fail-closed safety/content integrity checks, and invalidate plan/QC caches when decisive inputs change. Derive publication status from actual named receipts; incomplete or uncertain remote effects never establish full publication or release attempted-send reservations.

Prepare, translate, normalize, refine, validate and fingerprint all three Surfdash locale files before publication. Bind dispatch to those bytes. WeChat waits for the Surfdash attempt to settle and uses its observed successful URL for 原文链接. Compose URL/media/cover before native layout; require completed native save and strict persisted readback, then permit at most one native latest-draft recovery before final confirmation. Never retry an uncertain final send.

Installed runtime activation is complete with backup, eight matching hashes, authenticated installed-plugin readiness and an idle scheduler restart. The next daily tick is November 3 at 04:30 PST. The reviewed Surfdash commits 21505ad and 786652f are approved and deployed. CI, public pages/assets and positive receipt reconciliation pass. Missing/malformed primary receipts produce failed CMS-resync evidence without aborting reporting; successful locale receipts are read by path.

### Plan

- [x] Trace historical scheduler, model sessions, authentication, caches, receipts and installed-runtime drift.
- [x] Reproduce and fix safety retry, bounded supervision, cache identity and primary settlement failures.
- [x] Verify and repair the actual WeChat URL/layout/media/save/latest-version/final-confirmation path without duplicating today's public edition.
- [x] Run final source review, lint/typecheck/build, the full suite (4,400 pass), coverage thresholds and pre/post rule gates.
- [x] Back up and synchronize the installed runtime; verify eight hashes and authenticated installed-plugin readiness.
- [x] Activate the existing scheduled public WeChat option with Chrome; reload idle and verify native scheduler state for November 3 at 04:30 PST.
- [x] Prepare and independently review the complete Surfdash candidate; pass every required CI gate and production build locally.
- [x] Record actual publication provenance, current checks, activation and remaining blocker through the harness.
- [x] Apply Robin’s continuation approval; push the reviewed Surfdash candidate without force or unrelated changes.
- [x] Verify deployment/public assets, preserve unrelated live-checkout files, reconcile existing receipts and settle seven stories.

- [x] Reproduce and fix locale completeness and missing/malformed folded-tail closure; pass final gates and sync the final installed stage.

### Root Cause

The scheduled daily AI news pipeline stopped delivering while Robin was away. Scope authorized on 2026-11-01: investigate failures since 2026-10-26, fix causes and verify tomorrow's unattended run; do not regenerate or publish historical editions. Preserve the starting dirty tree, especially publish-matrix changes and the existing digest-check fix. Workflow edits and runtime activation have been requested separately under AGENTS.md.

Observed evidence:
- Scheduler is live under launchd ai.gobing.spur-serve; each 04:30 local tick ran. Production remains voice2, not the unreleased voice3 migration.
- October 26 run 561af6d9-f2cc-485a-a478-ea8062116bd0 closed no-content: 2 candidates estimated 11 minutes below the configured 15-minute floor.
- October 27–29 parent and nested safety runs retain running records after the scheduled process stopped; no publish receipts exist.
- October 30–November 1 failed at safety. November 1 nested trace 323f6ab8-41fc-4ab3-92d9-aa9e4259cf6e and its saved agent sessions prove the primary wrote valid reports. Unconditional retry agent.run actions delete the primary's expectFile before dispatch; the Claude retry exits 3 with expired OAuth, leaving the gate no report/verdict. The gate correctly blocks and quarantines drafts.
- Primary Pi stages took tens of minutes and lack per-action timeout bounds. A configured codex-sol artifact-write probe passed in 10.6 seconds.
- WeChat readiness is refused (expired authentication). XHS is intentionally disabled and its cached browser lease is stale. Do not turn disabled channels on implicitly or change draft/live permissions.
- Publication settlement marks selections published without checking primary success. Classification discards a single available receipt and can falsely count duplicate/unexpected targets as complete.
- Plan/QC caches use existence alone, making a floor refusal sticky when input supply or runtime settings change.

Evidence remains in existing run artifacts and .works/tmp/test-daily-recovery. Do not copy credentials into reports.

### Solution

Implemented and verified the safety retry, bounded scheduling, cache recovery, named-receipt classification and conservative reservation/settlement fixes described in the November 1 investigation. No historical edition was regenerated or published. The November 2 morning run remains recorded as incomplete rather than rewritten as an on-time success.

Additional November 2 repairs:

The WeChat composition order is implemented at `plugins/publishings/wechatmp-pub/src/flow.ts:1231`.

- Surfdash locale preparation/refinement now precedes dispatch, with exact path/hash binding and durable uncertain-delivery evidence.
- WeChat consumes Surfdash's observed URL after its attempt settles. Native one-click layout runs after URL, media and cover insertion and waits for completion.
- The current image/audio chooser is bound to exact content identities. Public submission requires acknowledged native save and persisted title/body/media/cover/original-URL equality.
- The known stale-draft refusal permits one native latest-draft action before final confirmation; unknown/final-send outcomes are never retried. Current final-dialog controls, notification state, session persistence and secret-safe diagnostics are verified.

Robin posted today's WeChat edition at 19:25 PST. Authenticated history confirms one additional publication, 133→134, at `https://mp.weixin.qq.com/s/sOCVXFjFlIzCxXq5WeY1pg`. The canonical receipt explicitly records operator publication. The later authenticated rehearsal stopped before final send and did not create a duplicate. The already-live podcast was not resent.

Final knowledge-kit checks pass: 4,404 tests, zero failures, three baseline skips; lint/typecheck/build; 58 pre-check and two post-check rules; all file thresholds. Runtime backup/sync verifies eight hashes. Installed WeChat readiness passes headlessly and read-only. Scheduler PID 86269 is healthy with eight registrations; the daily command uses Chrome and explicit public WeChat at 04:30 PST / 12:30 UTC on November 3.

Recovery verification is PASS. Robin authorized the complete candidate with `continue`; Surfdash Deploy 41592575717 succeeds at commit 786652f. All three locale pages and cover assets return 200. The live checkout is fast-forwarded with unrelated files preserved. Positive CMS/deploy evidence reconciles the preserved uncertain receipt without another publisher call. The final stage-source fixes for locale success and missing/malformed reporting receipts are synced and hash-verified. Installed classification is full, required channels are done, and seven stories are promoted after a native SQLite backup. A separate recovery receipt preserves the original morning incomplete outcome. No claim is made that the next scheduled edition has already run.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Active safety guard regressions in `apps/cli/tests/kk-workflow-stages.test.ts`; bounded supervisor process fixtures in `plugins/kk/tests/daily-scheduled-run.test.ts`; primary artifacts survive an unavailable retry. |
| R2 | MET | Changed-supply/cache regressions in `apps/cli/tests/daily-cache-recovery.test.ts` and `apps/cli/tests/kk-workflow-stages.test.ts`; no relaxed duration or safety floor. |
| R3 | MET | Named/missing/duplicate receipt and store-settlement checks in `apps/cli/tests/commands/daily.test.ts`; incomplete Surfdash delivery remains reserved and is not promoted to published. |
| R4 | MET | Dated findings, operator publication provenance, protected rehearsal, scheduler evidence and remaining deployment blocker in `docs/report/2026-11-02-daily-ai-news-recovery.md`. |
| R5 | MET | Full suite 4,404 pass / zero fail / three existing skips, lint/typecheck/build and pre58/post2 rules pass; installed final stage hash matches, authenticated WeChat check verifies, public Chrome scheduler stays at 04:30 PST. Surfdash Deploy 41592575717 succeeds; all six locale page/asset checks return 200. Installed classification is full with all required channels done; seven selections are published, with a separate late recovery receipt preserving the original incomplete morning outcome. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — successful primary review survives an unavailable retry (req: R1) | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts`: valid primary safety output is retained and unavailable fallback is skipped. |
| AC2 — invalid review output stays blocked after bounded recovery (req: R1) | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts`: invalid/missing safety evidence remains fail-closed after bounded recovery. |
| AC3 — changed supply or floor recovers no-content planning (req: R2) | MET | test | `apps/cli/tests/daily-cache-recovery.test.ts`: decisive supply/settings changes invalidate the sticky no-content cache. |
| AC4 — missing or duplicate primary receipts never establish full publication (req: R3) | MET | test | `apps/cli/tests/commands/daily.test.ts`: missing, duplicate and unrelated primary receipts cannot establish full publication. |
| AC5 — recovery evidence records actual checks and activation state (req: R4, R5) | MET | command | `docs/report/2026-11-02-daily-ai-news-recovery.md`, final-closure gate logs and `.works/kk-daily-ai-voice2/20261102/recovery-receipt.json` record actual checks, activated schedule, successful deployment and guarded settlement; original morning status is preserved. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Source review: PASS — no remaining P1/P2 code findings. Recovery verification: PASS.**

Independent review covered safety artifact retention, cache identity, publication settlement, Surfdash preparation/fingerprints, WeChat native save/readback and the new Chromium integration checks. The actual authenticated WeChat rehearsal reached the final publication control and stopped before executing it; Robin's already-public edition is not represented as an automated send.

| # | Finding | Priority | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Destructive unconditional safety retry, unbounded scheduled calls and stale floor-refusal caches | P1 | FIXED | Failure-first process/workflow/cache checks; November 1 investigation and activation evidence. |
| 2 | Incomplete primary receipt classification and unsafe publication settlement | P1 | FIXED | `apps/cli/tests/commands/daily.test.ts`; uncertain sends retain their reservations and are not retried blindly. |
| 3 | Surfdash locale/refine/publication ordering and WeChat original-link ordering | P2 | FIXED | `plugins/kk/workflows/kk-daily-ai-voice2.yaml`, validated locale identities and ordering regressions. |
| 4 | WeChat current formatting UI, media/cover binding, completed native save, persisted URL/content equality and one bounded stale-version recovery | P2 | FIXED | Protected authenticated final-boundary rehearsal and real Chromium integration artifacts; no duplicate publication. |
| 5 | Surfdash CI and public static asset deployment blockers | P2 | FIXED | Approved commits 21505ad and 786652f; Deploy 41592575717 passes and all three pages/assets return 200. |

Current gate and runtime activation details are recorded in `docs/report/2026-11-02-daily-ai-news-recovery.md`. Earlier check counts and authentication failures are historical evidence in the November 1 report. XHS remains intentionally disabled. Final repository verification passes 4,404 tests with zero failures and three baseline skips. Missing/malformed folded-tail receipts and locale success recognition have failure-first integration regressions. Required channels and seven selected stories are settled. No historical backfill, duplicate WeChat edition or podcast resend occurred.

### References

- [November 1 outage investigation and approved activation](../report/2026-11-01-daily-ai-news-recovery.md).
- [November 2 delivery recovery and additional root causes](../report/2026-11-02-daily-ai-news-recovery.md).
- Runtime, browser and gate evidence: `.works/tmp/test-daily-recovery/probes/` (local disposable artifacts).
- November 2 per-channel receipts and original/reconciled Surfdash evidence: `.works/kk-daily-ai-voice2/20261102/31-publish/`.

### History

- 2026-11-02T02:38:40.539Z todo → wip (system)
- 2026-11-03T07:24:39.197Z wip → testing (system)
- 2026-11-03T07:24:59.495Z testing → done (system)

