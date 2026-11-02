---
schema_version: 1
name: Restore unattended scheduled daily AI news generation and delivery after October 26 outage
status: wip
template: issue
created_at: 2026-11-02T02:34:11.966Z
updated_at: "2026-11-02T04:14:26.563Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P0
feature_id: G11
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

- [ ] R1. Preserve valid primary safety artifacts, retry only missing or invalid outputs, bound agent calls, and retain fail-closed draft-integrity checks.
- [ ] R2. Recompute stale plan/QC caches when their decisive inputs change, allowing a no-content refusal to recover without manual file deletion or relaxed quality gates.
- [ ] R3. Derive primary publish classification from actual named receipts and never promote store selections to published unless both required primary channels published.
- [ ] R4. Record dated scheduler/run/channel evidence and honestly distinguish generation, primary publication, optional channel failures and unavailable authentication.
- [ ] R5. Verify through failure-first automated behavior checks, required project gates and a fresh isolated workflow rehearsal; activate only approved runtime changes, with no historical backfill or duplicate live sends.

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

### Design

Keep the active voice2 product path and its current channel draft/live settings. Do not activate the separately planned voice3 migration during outage recovery. Preserve the existing safety gate, independent judge, remediation budget and admission-only exclusions.

Owned source surfaces: `plugins/kk/scripts/daily-stages.ts` plan/QC cache fingerprints; `apps/cli/src/commands/daily.ts` primary receipt classification; `plugins/kk/scripts/daily-scheduled-run.ts` bounded process supervision and recorded delivery status; `plugins/kk/scripts/safety-artifact-check.ts` report/verdict/revision transition predicates; relevant first-failing behavior tests. The existing operator edit in `plugins/publishings/surfdash-pub/src/digest-check.ts` is preserved and corrected for folded-list sibling boundaries. `docs/04_DESIGN.md` records changed surfaces.

Workflow changes are prepared as reviewable copies under `.spur/reports/daily-recovery-prepared/`, pending explicit approval. Safety primary/retry states have separate guard edges so the agent runtime cannot delete a successful primary artifact during an unnecessary retry. Numeric per-action 600-second deadlines bound authoring/review calls. No-op remediation still spends its existing budget and can reach admission-only exclusion; malformed drafts remain blocked. Voice2 forwards the retry executor and assigns the safety child `<parent-run-id>-safety` for targeted cleanup. Mark-published requires full primary publication.

The scheduler proposal keeps the same 04:30 local tick and four-hour outer budget, invokes the supervised launcher with a 3h45m internal deadline, pins the configured works root and the actually probed `codex-sol` executor. No global agent config changes. The launcher kills only its owned process group, closes known run ids and syncs the ledger; no-content/incomplete delivery is nonzero and recorded, not a silent green. Reservations are recycled only for a positively identified trace with no channel-send start; all attempted/uncertain delivery stays reserved.

Live prerequisites are separate: installed-bundle backup/sync/restart and historical orphan/selection cleanup need the requested runtime approval; WeChat authentication must be restored through the existing login surface. No fabricated authentication, weakened gate, historical edition generation or unapproved live test post.

### Plan

- [x] Trace historical scheduler, agent sessions, channel readiness and installed runtime; preserve baseline changes.
- [x] Write failure-first safety retry, cache recovery and primary receipt regression checks.
- [x] Apply minimal source fixes, promote the reviewed workflows and activate the runtime after Robin's explicit approval.
- [x] Run focused behavior checks, project lint/tests/build/rules and review final diff. Full active tests pass; unrelated pre-existing report formatting still fails repository lint and is recorded separately.
- [x] Run isolated fresh rehearsal, activate approved fixes and verify tomorrow's schedule; record limitations and evidence. WeChat authentication remains an explicit external prerequisite, not a completed channel check.

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

Implemented source changes (entry anchors: `plugins/kk/scripts/daily-stages.ts:121`, `apps/cli/src/commands/daily.ts:355`, `plugins/kk/scripts/daily-scheduled-run.ts:1`):
- `plugins/kk/scripts/daily-stages.ts`: input-aware plan/QC caches, stale floor-refusal recovery, guards against pairing changed plans/candidates with authored artifacts, and Surfdash intent/uncertainty journal.
- `apps/cli/src/commands/daily.ts`: named primary receipt completeness, preservation of one-sided successes, and explicit malformed completeness diagnostics.
- `plugins/publishings/podcast-pub/src/index.ts`: deterministic canonical payload/media idempotency identity.
- `plugins/publishings/surfdash-pub/src/index.ts`: distinguish pre-dispatch not-sent failures from uncertain failures during/after postsurfing; `digest-check.ts` preserves folded/literal list siblings and YAML paragraph semantics while retaining the starting operator repair.
- `plugins/kk/scripts/daily-scheduled-run.ts`: bounded scheduling with explicit works root and executors, owned process-tree teardown including detached workers, terminal receipt/ledger handling, required enabled-channel completion, and conservative invocation-bound stable-trace reservation release.
- `plugins/kk/scripts/safety-artifact-check.ts`: complete report/judge/revision contracts and unattended escalation predicate.
- Regression tests cover each behavior before its fix; safety legacy coverage remains intact for both the active and prepared state machines.

Activated following Robin's explicit approval: split safety producer/retry states, per-action deadlines, explicit work-dir and retry forwarding, deterministic child-run identity, guarded store settlement, and supervised 04:30 scheduler command. Deployment-ready workflow copies were promoted to the active workflow paths; schema validation passes. An attempt receipt declares remediation completion without deleting the in-place drafts.

Operational evidence: scheduler fired daily, three four-hour kills left orphans, expired Claude retry deleted successful primary evidence. The six known orphan records are now closed and the 46 proven pre-publication reservations released; live eligible supply is 67 stories. WeChat authentication is refused; XHS stays intentionally disabled. No historical editions or live test posts were produced. The installed runtime is backed up, synced and hash-verified; the scheduler restarted idle and registered five jobs. Surfdash locally fast-forwarded to origin/main while preserving untracked files; authenticated Surfdash and podcast reads pass. Actual active model safety rehearsal reached clean in 161 seconds. Late no-content reservation recovery passes a 141-assertion process test.

Remaining limitations: WeChat still needs its one-time authenticated session; the reopened Chrome login window is waiting for the operator. Full active tests passed with exit0 (4319 pass,3 existing skips,0 fail); both rule presets, build, typecheck and changed-source checks pass. Repository lint retains pre-existing report formatting failures. No new channel or live-send permission was inferred, no task-wide verify PASS is asserted, and final all-channel delivery remains unproven until authentication and real scheduled receipts exist.

### Testing

Evidence root: `.works/tmp/test-daily-recovery/`.

- Initial failure-first probes reproduced destructive safety retries, sticky plan/QC refusal, partial/duplicate primary receipt misclassification, missed detached descendants, false successful no-content/incomplete outcomes and unsafe reservation release boundaries.
- Initial full `bun run test`: 4303 pass, 3 pre-existing skips, 2 fail (new regressions against active unfixed safety YAML), exit 1; 661.6 seconds.
- Prepared safety/cache/launcher focused run: 29 pass, 0 fail, 335 assertions.
- Latest safety/settlement focused run after declared remediation completion: 25 pass, 0 fail, 176 assertions.
- Launcher focused process fixtures: 1 pass, 0 fail, 132 assertions, including detached workers and stale/in-flight/remote-send trace retention.
- Surfdash recovery + publisher focused tests after final delivery-state classification: 70 pass, 0 fail; focused exit 1 is coverage-only, not assertion failure.
- Podcast package tests: 76 pass, 0 fail; focused package-wide coverage is separately nonzero.
- Build and workspace typecheck pass. Changed-source Biome check passes across 17 files. `git diff --check` passes.
- `bun run lint` remains failed on pre-existing report JSON formatting; unrelated report bytes were preserved.
- Rule presets: recommended-pre-check 58/58 pass; recommended-post-check 2/2 pass after full-suite coverage was available.
- Deployment-ready safety and voice2 schema/semantic validation both pass. Prepared voice2 dry-run completes.
- Actual configured codex-sol artifact-write probe passes; synthetic real-model safety run reaches clean in 180 seconds. The final deployment-copy synthetic run with unattended=true also reaches clean in 166 seconds (daily-recovery-final-safety-20261101).
- Actual local VoxCPM smoke produces 3.68-second synthetic audio. Podcast authenticated GET returns HTTP 200. Refreshed WeChat probe returns refused, authentication not confirmed within 35000ms.
- Store backup simulation releases the six confirmed pre-publication failed runs and increases 168h eligible supply from 22 to 67; production store remains unchanged.
- Final candidate full suite with `KK_SAFETY_WORKFLOW` pointing at the prepared safety copy: 4319 pass, 3 existing skips, 0 failed assertions, 21938 assertions, 678.37 seconds. Exit 1 was solely digest-check function coverage 88.89%, line95.45%. Removed two unnecessary callback closures in the malformed-input fallback in favor of an equivalent explicit loop. Existing45 digest tests pass; focused digest module measures100% functions and94.97% lines. The full gate on promoted active files remains required before closure. Candidate selection is not production deployment.

Post-approval activation checks:
- `bun run test` against active files, no candidate override: exit0,4319 pass,3 existing skips,0fail,21949 assertions,676.41 seconds. Late supervisor script-only no-content release delta:141 assertions pass, including retained reservations after any send attempt.
- Focused active DAG/safety/settlement suite:70pass,0fail,708assertions. Build and workspace typecheck pass. Changed-source Biome:18files clean. `git diff --check` passes. Recommended-pre-check:58rules pass; recommended-post-check:2rules pass.
- Active model safety through the installed stage body: clean in161seconds. Active DAG dry-run:done. Installed classifier smoke:partial with one observed success and a named missing podcast failure.
- Runtime backup/sync complete; seven hash checks match. Deployment CLI excludes unrelated pre-existing publish-matrix working changes using a build-only source overlay, leaving the source intact.
- Six historical orphan records closed and46 reservations released after trace proof of no send. Live eligible168h pool67. Scheduler restarted idle; new PID21269, BoardHTTP200,five jobs registered, next daily tick November2at04:30PST.
- Surfdash fast-forwarded116commits with no divergence or untracked-file collisions. Authenticated existing-postGET200; podcastauthenticatedread200. WeChat login timed out after180seconds; reopened using configured Chrome with a longer timeout and awaits the operator.
- Repository-wide lint still fails on unrelated pre-existing report formatting. No new tests skipped, assertions weakened, historical edition generated or test post sent. WeChat authentication and all-channel live completion remain unverified; task remains wip, no final task verifyPASS.

### Review

Review outcome: code/runtime recovery activated and tested; overall operational completion remains PARTIAL.

Resolved findings:
- Unconditional safety retry deleting successful primary artifacts: separate guarded states, real-dispatcher regression and active real-model rehearsal.
- Missing/contradictory judge contracts and unattended real escalations: full contract predicates and fail-closed unattended routing. Admission-only no-op remediation still spends its bounded budget and can exclude platforms.
- Stale plan/QC caches and changed candidates paired with old drafts: decisive-input fingerprints and downstream-artifact guards.
- Incorrect receipt completeness and store promotion: exact named primary target set and full-only settlement predicate.
- Timeout/orphan/reservation loss: owned-tree supervision including detached workers, durable outcome receipts, exact cancellation, stable terminal invocation-bound trace before pre-send release. No-content after selection is covered; attempted/uncertain sends retain reservations.
- Duplicate remote effects: deterministic podcast request/media identity within the existing24h backend window; Surfdash intent journal and explicit not-sent/uncertain failure metadata.
- Installed/runtime drift and stale Surfdash checkout: backed up and synced affected files, hash proof, idle scheduler restart, local fast-forward with untracked files preserved.

Verification evidence: active full suite4319pass/3existing skips/0fail,exit0; active focused70pass/708assertions; final supervisor141assertions; build/typecheck/changed-source style pass; pre58/post2rules pass. Evidence is under `.works/tmp/test-daily-recovery/` and summarized in the investigation report.

Open operational prerequisite: WeChat authentication was refused and the firstQR login expired; the longer login window awaits the operator. Keep its draft-only channel enabled and required; do not claim all-channel success or fabricate login. XHS remains disabled by the existing configuration. Root lint retains unrelated pre-existing report-format findings. No overall task verifyPASS or end-to-end live-publication proof is asserted, and no historical editions were replayed.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-02T02:38:40.539Z todo → wip (system)

