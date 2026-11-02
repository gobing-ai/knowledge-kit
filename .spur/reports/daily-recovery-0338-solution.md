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
