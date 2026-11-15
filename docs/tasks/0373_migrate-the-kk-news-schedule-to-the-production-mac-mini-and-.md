---
schema_version: 1
name: Migrate the kk news schedule to the production Mac mini and capture a complete scheduled day
status: todo
template: standard
created_at: 2026-11-15T06:57:07.172Z
updated_at: "2026-11-15T07:06:27.578Z"

ac_altitude: task-local
ac_numbering: task-local
---

## 0373. Migrate the kk news schedule to the production Mac mini and capture a complete scheduled day

### Background

Deferred by Robin on 2026-11-14 from task 0372. The operator approved retaining the landed retirement with a sequencing exception, but production migration and real scheduled-day proof remain unverified. This standalone follow-up owns that deferred work, outside G61 like its source task. See docs/migration.md, Current handoff. The historical October target is ssh homelab (mac.lan); inspect and re-confirm it before making changes. This task records work to perform later, not authorization to install, change scheduling or publish now.

### Requirements

- [ ] R1. Follow docs/migration.md current kk news handoff: inspect the real Mac mini deployment, package root, effective works_dir and scheduler. Obtain explicit operator authorization before installation, scheduler changes or live publishing; preserve unrelated jobs and ensure one scheduler host.
- [ ] R2. After approved migration, observe one complete scheduled day of kk news generate --publish, kk news publish --window overseas-rss --unattended, and kk news publish --window cn-peak --unattended on the Mac mini. Generation settles done or no-content and both publish windows settle. Keep xhs off while flagged; never bypass disabled channels or authentication safeguards.
- [ ] R3. Save the three redacted launch receipts and kk news status output under docs/tasks/evidence/0369 with host, build, scheduler timezone, works root and observed timestamps. Distinguish overseas previous-day selection from local-day generation; no secrets, cookies or environment dumps.
- [ ] R4. Mark migration verified only from real scheduled production evidence; local, dry-run and dummy tests do not count. Run the applicable repository and migration checks, record failures honestly, and preserve rollback evidence without re-arming a second scheduler.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Deployment and scheduling changes are explicitly approved (req: R1)
  Given the actual Mac mini installation and existing scheduler have been inspected
  When the migration is applied
  Then operator approval covers its installation, scheduler changes and effective live sends, persistent works_dir is pinned and only one scheduler host is active

Scenario: AC2 — A complete scheduled production day settles (req: R2)
  Given xhs remains effectively off on the production Mac mini
  When generation and the overseas-rss and cn-peak scheduled ticks run
  Then generation is done or no-content and both publish windows settle without bypassing gates

Scenario: AC3 — Redacted production evidence is preserved (req: R3)
  Given the real scheduled production runs
  When their receipts and status outputs are reviewed
  Then docs/tasks/evidence/0369 contains all three receipts and corresponding status outputs with host, build, timezone, works root, timestamps and previous-day overseas selection, without secrets or authentication state

Scenario: AC4 — Migration readiness is based on real evidence (req: R4)
  Given the deployment, scheduler backups and production evidence
  When migration verification runs
  Then the applicable checks pass, rollback remains possible without losing kk.db or enabling a duplicate scheduler, and no local or dummy run is substituted for production proof
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Follow the Current handoff in docs/migration.md. Inspect the actual host and installed package read-only, obtain approval for the concrete production mutations, synchronize the built CLI and shipped scripts/workflows, pin persistent works_dir and ensure one active scheduler host. Observe a full scheduled day with effective xhs off, preserve redacted receipts/status and rollback metadata, and verify from real Mac mini evidence. Its AC are task-local because this deferred operator migration is outside G61 shipping scope.

### Plan

1. Read docs/migration.md current handoff and task 0372 operator scope decisions.
2. Inspect the target read-only; present the concrete install/scheduler/live-send changes for operator approval.
3. Apply approved deployment and validate one scheduler host, persistent works_dir and disabled xhs.
4. Observe a full scheduled day, save sanitized evidence and run verification before marking this task done.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-15T07:06:27.578Z backlog → todo (system)

