---
schema_version: 1
name: Restore unattended scheduled daily AI news generation and delivery after October 26 outage
status: wip
template: issue
created_at: 2026-11-02T02:34:11.966Z
updated_at: "2026-11-02T03:33:13.406Z"

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

### Design

Keep the active voice2 product path and its current channel draft/live settings. Do not activate the separately planned voice3 migration during outage recovery. Preserve the existing safety gate, independent judge, remediation budget and admission-only exclusions.

Owned source surfaces: `plugins/kk/scripts/daily-stages.ts` plan/QC cache fingerprints; `apps/cli/src/commands/daily.ts` primary receipt classification; `plugins/kk/scripts/daily-scheduled-run.ts` bounded process supervision and recorded delivery status; `plugins/kk/scripts/safety-artifact-check.ts` report/verdict/revision transition predicates; relevant first-failing behavior tests. The existing operator edit in `plugins/publishings/surfdash-pub/src/digest-check.ts` is preserved and corrected for folded-list sibling boundaries. `docs/04_DESIGN.md` records changed surfaces.

Workflow changes are prepared as reviewable copies under `.spur/reports/daily-recovery-prepared/`, pending explicit approval. Safety primary/retry states have separate guard edges so the agent runtime cannot delete a successful primary artifact during an unnecessary retry. Numeric per-action 600-second deadlines bound authoring/review calls. No-op remediation still spends its existing budget and can reach admission-only exclusion; malformed drafts remain blocked. Voice2 forwards the retry executor and assigns the safety child `<parent-run-id>-safety` for targeted cleanup. Mark-published requires full primary publication.

The scheduler proposal keeps the same 04:30 local tick and four-hour outer budget, invokes the supervised launcher with a 3h45m internal deadline, pins the configured works root and the actually probed `codex-sol` executor. No global agent config changes. The launcher kills only its owned process group, closes known run ids and syncs the ledger; no-content/incomplete delivery is nonzero and recorded, not a silent green. Reservations are recycled only for a positively identified trace with no channel-send start; all attempted/uncertain delivery stays reserved.

Live prerequisites are separate: installed-bundle backup/sync/restart and historical orphan/selection cleanup need the requested runtime approval; WeChat authentication must be restored through the existing login surface. No fabricated authentication, weakened gate, historical edition generation or unapproved live test post.

### Plan

- [x] Trace historical scheduler, agent sessions, channel readiness and installed runtime; preserve baseline changes.
- [x] Write failure-first safety retry, cache recovery and primary receipt regression checks.
- [x] Apply minimal source fixes and prepare reviewed scheduler/runtime changes. Active workflow promotion and runtime activation remain pending approval.
- [ ] Run focused behavior checks, project lint/tests/build/rules and review final diff.
- [ ] Run isolated fresh rehearsal, activate approved fixes and verify tomorrow's schedule; record limitations and evidence.

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

Prepared, not activated: split safety producer/retry states, per-action deadlines, explicit work-dir and retry forwarding, deterministic child-run identity, guarded store settlement, and supervised 04:30 scheduler command. Deployment-ready workflow copies are under `.spur/reports/daily-recovery-prepared/deployment/`; schema validation passes. An attempt receipt declares remediation completion without deleting the in-place drafts.

Operational evidence: scheduler fired daily, three four-hour kills left orphans, expired Claude retry deleted successful primary evidence, 46 selections remain reserved, WeChat authentication is refused, XHS is intentionally disabled, current collector is healthy. No historical editions or live test posts were produced. Actual model/voice/API probes and SQLite-copy release simulation are recorded in the investigation report.

Not complete: workflow/runtime activation and production cleanup await the explicitly requested operator answer; WeChat requires a fresh authenticated session. Generic continuation has not expanded channel draft/live permissions. No final verification PASS or tomorrow-readiness guarantee is asserted.

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

No new tests were skipped or assertions weakened. No live posting, historical regeneration, installed-package sync, scheduler restart or production reservation changes occurred. Task remains wip; no final verify PASS.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-02T02:38:40.539Z todo → wip (system)

