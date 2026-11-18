---
schema_version: 1
name: Observe and file the first complete scheduled kk news day
status: done
template: standard
created_at: 2026-11-15T20:14:20.385Z
updated_at: "2026-11-18T03:30:23.421Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0376. Observe and file the first complete scheduled kk news day

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

- [x] R1. Observe one complete scheduled day on the production host: the 04:30 generate, the 07:00 `overseas-rss` window and the 17:00 `cn-peak` window must each settle (`done` or `no-content` for generation; the windows settle per their own gate conditions) without bypassing a disabled channel, gate or authentication safeguard, with xhs effectively `off`.
- [x] R2. Prove each of those three ticks issued a current command — read the `scheduler.custom` payloads from `queue_jobs` for the day and confirm none references a retired entry point such as `scripts/daily-ai-news.ts`.
- [x] R3. Save the three redacted launch receipts plus the matching `kk news status --run-date <YYYYMMDD>` output (and the previous-day status for the overseas window) under `docs/tasks/evidence/0369/<YYYYMMDD>/`, with an index recording host identity, installed build, scheduler timezone, effective works root, observed timestamps and the previous-day overseas selection. No secrets, cookies or environment dumps.
- [x] R4. Record failures honestly and investigate every failed or ambiguous outcome; a local rehearsal, dry run, dummy run or fabricated receipt does not substitute for the scheduled production evidence.

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

#### Q&A entry — 2026-11-15T20:14:26.756Z

#### Q&A entry — 2026-11-15T20:30:00Z

**Q: why does this task exist twice (0375 and 0376)?**
A: 0375 was created with `--parent 0373` as a grouping convenience. The corpus rule
`L4 — parent is done but sub-task(s) still open` then correctly refused to let 0373 reach `done`, and
no CLI verb can clear `parent_wbs`. The operator decided 0373 closes now with this observation carried
as a **successor**, not a sub-task, so the work was re-filed unparented as 0376 and 0375 cancelled. The
requirements are identical; 0376 is the live one.

#### Q&A entry — 2026-11-18T03:29:37.717Z

**Q: the 04:30 generate launch receipt for 2026-11-17 was overwritten by the 10:46 hand-run. Does R3 still hold?**
A: Yes, by operator decision on 2026-11-17 ("go with option 1"). The scheduled run is kept as its `queue_jobs` row (`6bd1e329…`) plus its Spur trace (`kk-news-generate-20261117-1794918601004`), both filed under `docs/tasks/evidence/0369/20261117/`. They stand in for the lost receipt and are labelled as a reconstruction, not the receipt. The underlying defect stays open: a same-day hand-run overwrites the scheduled run's `schedule-receipt.json`, `pool-gate.json` and floor-refusal file.

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

**Outcome: blocked on the clock — no valid scheduled day exists yet.** The observation ran against the production
host (`mac.lan`) for 2026-11-15 and today's day cannot satisfy R1/R2. Recording it rather than weakening the
requirement (R4).

**What the scheduler actually did today** (`queue_jobs`, `type='scheduler.custom'`):

| Tick | Command the scheduler issued | Status | `last_error` |
| --- | --- | --- | --- |
| 04:30 `kk-daily-ai-voice` | `bun scripts/daily-ai-news.ts generate --full` | failed | `scheduler job "kk-daily-ai-voice" exited 1: error: Module not found "scripts/daily-ai-news.ts"` |
| 07:00 `kk-daily-publish3` | `bun scripts/daily-ai-news.ts publish --window overseas-rss --unattended` | failed | same `Module not found` |
| 17:00 `kk-daily-publish3-cn-peak` | — never issued | — | paused on purpose by `efe2a197 chore(schedule): pause the 17:00 cn-peak tick while a generation is in flight` |

**R2 is refuted by today's evidence, not satisfied.** Both ticks that fired named the retired
`scripts/daily-ai-news.ts` entry point (the file no longer exists — `ls scripts/daily-ai-news.ts` → ENOENT) and died
before doing any work, so there was no generation and no window to publish.

**Root cause (measured):** the `spur self serve` process that served those ticks was running the *pre-0373*
schedule. The server now running started at **16:16:30** (`ps -o lstart`), which is also `.spur/config.yaml`'s mtime,
so the `kk news` verbs 0373 checked in are loaded — but no daily tick has exercised them yet. 16:05's `kk-collect` row
records the handover: `Process terminated: server restarted while job was in flight`.

**Environment recorded for R3:** host `mac.lan` (`LocalHostName HomeServer`), macOS 27.0.1, arm64 M4, installed `kk`
0.1.19, scheduler timezone `America/Los_Angeles`, works root `/Users/robin/xprojects/knowledge-kit/.works`, store
`/Users/robin/xprojects/knowledge-kit/.works/kk.db`, spur db `.spur/spur.db`.

**Why no receipts were filed under `docs/tasks/evidence/0369/20261115/`:** the two fired ticks produced no launch
receipt (they died at module resolution) and the cn-peak tick produced nothing at all, so a receipts directory would
have been fabrication. The payload rows quoted above are the honest record.

**Next step (the whole remaining work):** the first valid day is the one whose three ticks fire on the current server
— 2026-11-16 04:30 / 07:00 / 17:00 `America/Los_Angeles`, after confirming the cn-peak resume. Re-run this task then;
R1/R2/R3 read off that day's `queue_jobs` payloads, launch receipts and `kk news status --run-date 20261116`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/tasks/evidence/0369/20261117/queue-jobs.json` — 04:30/07:00/17:00 rows all `completed`; 04:30 run `kk-news-generate-20261117-1794918601004` settled no-content via floor gate (`docs/tasks/evidence/0369/20261117/trace-0430-generate.txt`); windows `kk-publish-20261116-1794927600552` and `kk-publish-20261117-1794963601012` done exit 0; xhs `mode off` in both outcomes |
| R2 | MET | `docs/tasks/evidence/0369/20261117/queue-jobs.json` — all three payloads are `kk news generate |
| R3 | MET | `docs/tasks/evidence/0369/20261117/index.md` + 07:00/17:00 receipts + status outputs; 04:30 generate receipt (overwritten by 10:46 hand-run) replaced by its queue row + Spur trace, accepted by operator decision 2026-11-17 (task Q&A) |
| R4 | MET | `docs/tasks/evidence/0369/20261117/index.md` "Failures, named" — linkedin selector drift, x/threads uncertain, jike variant missing, weibo article cover/下一步 timeouts, no-content floor verdict |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — A complete scheduled day settles (req: R1) | MET | command | `sqlite3 .spur/spur.db` queue_jobs + `spur workflow trace` this run → `docs/tasks/evidence/0369/20261117/queue-jobs.json` |
| Scenario: AC2 — Every tick issued a current command (req: R2) | MET | command | `docs/tasks/evidence/0369/20261117/queue-jobs.json` payloads; installed `kk` 0.1.19 at tick time exposes `news generate`/`news publish` |
| Scenario: AC3 — Redacted production evidence is preserved (req: R3) | MET | command | `ls docs/tasks/evidence/0369/20261117` → 2 receipts + `queue-jobs.json` + `trace-0430-generate.txt` (operator-accepted stand-in for the overwritten generate receipt) + 3 status outputs + `index.md`; secret-pattern grep → 1 hit, the index prose "Neither contains secrets" (no credential values) |
| Scenario: AC4 — Readiness rests on real evidence (req: R4) | MET | command | `sqlite3 .spur/spur.db "select id,status from runs where id like 'kk-%-20261117%'"` this run separates scheduled run ids from the 08:23–12:30 hand-runs; `docs/tasks/evidence/0369/20261117/index.md` names every failure with cause; hand-runs explicitly excluded |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-16T03:25:27.025Z backlog → todo (system)
- 2026-11-16T03:28:56.939Z todo → wip (system)
- 2026-11-18T03:29:49.742Z wip → testing (system)
- 2026-11-18T03:30:23.232Z testing → done (system)

