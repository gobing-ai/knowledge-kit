---
schema_version: 1
name: Observe and file the first complete scheduled kk news day
status: cancelled
template: standard
created_at: 2026-11-15T20:12:03.990Z
updated_at: "2026-11-15T20:14:32.184Z"
parent_wbs: "0373"

ac_altitude: task-local
ac_numbering: task-local
---

## 0375. Observe and file the first complete scheduled kk news day

### Background

Deferred out of task 0373 on 2026-11-15 by operator decision, so 0373 can close on the deployment and
generation repairs and the dogfood run can start without waiting a day of wall clock.

0373 fixed what could be fixed in one session: one supervised scheduler host, the checked-in schedule
naming `kk news` verbs, the installed bundle brought level with the checkout, and the `kk news prepare`
pool-gate defect (task 0374) that had closed every day as `no-content`. What it could not produce is
the production proof the original R4/R5 asked for, because a *complete scheduled day* needs three
ticks that only the clock can fire: `04:30 kk news generate --publish`,
`07:00 kk news publish --window overseas-rss --unattended` and
`17:00 kk news publish --window cn-peak --unattended` in `America/Los_Angeles`.

The evidence must come from the scheduler's own ticks, not from a hand-run verb. A manual window run
proves the verb, not the schedule — that distinction is the whole point of the requirement, so it is
not weakened here.

### Requirements

- [ ] R1. Observe one complete scheduled day on the production host: the 04:30 generate, the 07:00 `overseas-rss` window and the 17:00 `cn-peak` window must each settle (`done` or `no-content` for generation; the windows settle per their own gate conditions) without bypassing a disabled channel, gate or authentication safeguard, with xhs effectively `off`.
- [ ] R2. Prove each of those three ticks issued a current command — read the `scheduler.custom` payloads from `queue_jobs` for the day and confirm none references a retired entry point such as `scripts/daily-ai-news.ts`.
- [ ] R3. Save the three redacted launch receipts plus the matching `kk news status --run-date <YYYYMMDD>` output (and the previous-day status for the overseas window) under `docs/tasks/evidence/0369/<YYYYMMDD>/`, with an index recording host identity, installed build, scheduler timezone, effective works root, observed timestamps and the previous-day overseas selection. No secrets, cookies or environment dumps.
- [ ] R4. Record failures honestly and investigate every failed or ambiguous outcome; a local rehearsal, dry run, dummy run or fabricated receipt does not substitute for the scheduled production evidence.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A complete scheduled day settles (req: R1)
  Given xhs remains effectively off and no gate is bypassed
  When the 04:30 generate, the 07:00 overseas-rss window and the 17:00 cn-peak window run on the production host
  Then generation settles done or no-content and both windows settle according to their gate conditions

Scenario: AC2 — Every tick issued a current command (req: R2)
  Given the retired scripts/daily-ai-news.ts entry point no longer exists
  When the day's scheduler.custom payloads are read back
  Then all three name a kk news verb that exists in the installed build, and none fails with Module not found

Scenario: AC3 — Redacted production evidence is preserved (req: R3)
  Given the real scheduled runs
  When their receipts and status outputs are reviewed
  Then docs/tasks/evidence/0369/<YYYYMMDD> holds all three receipts, the matching status outputs and an index with host, build, timezone, works root, timestamps and the previous-day overseas selection, with no secrets or authentication state

Scenario: AC4 — Readiness rests on real evidence (req: R4)
  Given the receipts and status outputs
  When the day is judged
  Then every failure is named with its cause, and no local, dry-run or dummy run is presented as production proof
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-15T20:14:31.807Z

#### Q&A entry — 2026-11-15T20:31:00Z

**Q: cancelled — why?**
A: created with `--parent 0373`, which made the corpus refuse 0373's `done` transition
(`L4 — parent is done but sub-task(s) still open`) while this work is a day of wall clock away. The
observation is carried unparented as **0376** with identical requirements; nothing is dropped. See
0376's Q&A for the full note.

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. The morning after 0373 closes, read `queue_jobs` for the day's three `scheduler.custom` ticks and the
   matching `docs/tasks/evidence/0369` receipt locations under `.works/kk-news-generate/<YYYYMMDD>/`
   and the publish window run directories.
2. Confirm each payload is a current `kk news` verb and each run settled; investigate anything failed
   or ambiguous rather than re-running until green.
3. Copy the receipts and `kk news status` output into `docs/tasks/evidence/0369/<YYYYMMDD>/`, redact,
   and write the evidence index.
4. Update this task and `docs/migration.md` with the day's outcome; leave production readiness open if
   any window did not settle.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-15T20:14:31.438Z backlog → todo (system)
- 2026-11-15T20:14:32.184Z todo → cancelled (system)

