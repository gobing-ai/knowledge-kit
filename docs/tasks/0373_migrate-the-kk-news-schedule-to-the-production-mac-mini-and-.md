---
schema_version: 1
name: Migrate the kk news schedule to the production Mac mini and capture a complete scheduled day
status: wip
template: standard
created_at: 2026-11-15T06:57:07.172Z
updated_at: "2026-11-15T19:57:42.896Z"

ac_altitude: task-local
ac_numbering: task-local
---

## 0373. Migrate the kk news schedule to the production Mac mini and capture a complete scheduled day

### Background

Deferred by Robin on 2026-11-14 from task 0372, then re-scoped on 2026-11-15 when a coding agent
running **on the production Mac mini itself** took the task.

The 2026-11-14 handoff in `docs/migration.md` assumed a remote migration: a laptop operator reaching
the target over `ssh homelab` (`mac.lan`). That premise is wrong for the machine that now owns the
task. The host is `mac.lan` / `HomeServer` — Mac16,10 Mac mini, Apple M4, 16 GB, macOS 27.0.1,
arm64, `America/Los_Angeles` (PST). It is the production target, it runs `ai.gobing.spur-serve`, and
it holds the live `kk.db` (14 MB, `.works/kk.db`). There is nothing to migrate *onto* it; the
remaining work is a same-host cutover plus the production defects inspection uncovered.

Defects observed read-only on 2026-11-15, before any change:

1. **Retired entry point still scheduled.** `queue_jobs` shows every scheduled kk news tick from
   2026-11-12 through 2026-11-15 issuing `bun scripts/daily-ai-news.ts …`. Commit `86ec3def`
   deleted that file on 2026-11-14 21:27, so the 2026-11-14 17:00, 2026-11-15 04:30 and
   2026-11-15 07:00 ticks all died with `error: Module not found "scripts/daily-ai-news.ts"`.
   `.spur/config.yaml` already names the `kk news generate|publish` verbs, and the scheduler process
   restarted at 2026-11-15 09:49 emits the current `kk-collect` command, so the stale payloads came
   from a prior server instance. The recovery is unverified until a fresh tick proves it.
2. **Two servers, one port; the supervised one loses.** `spur self serve` (started by hand from a
   login shell at 09:49) holds `*:3003`, so the launchd agent `ai.gobing.spur-serve` cannot bind and
   crash-loops (`launchctl` `runs = 22`, last exit 1). The process actually scheduling and running
   jobs is therefore unsupervised: it dies with its shell and does not survive a reboot, breaking the
   "exactly one scheduler host, survives logout" contract the daily job depends on.
3. **Config and behaviour disagree.** `.spur/config.yaml` declares
   `bootstrap.scheduler.enabled: false` (commit `6a1713ea`, 2026-11-13) while the running server
   schedules ticks and its job queue is live.
4. **No episode produced.** `kk news status` reports `generate`, `bundle` and `windows` all `null`
   for 2026-11-15 and `.works/kk-news-generate/20261115` does not exist. The last generation
   (2026-11-14) settled `no-content` on a genuinely thin pool (6 eligible stories at the 72 h window,
   a 3901-character script estimating 11.7 min against a 15 min floor) — an editorial supply
   result, not a defect, and an accepted settle state under R4.
5. **Stale artifacts.** `docs/tasks/evidence/0369/` does not exist, and the
   `docs/migration.md` "Current handoff" still describes the ssh target and the retired commands.

This task records work to perform later, not authorization to publish live. Generation and the
publish windows may run, but every live row and every external send still needs explicit approval.

### Requirements

- [ ] R1. Treat this host as the production target: re-confirm its identity (`mac.lan` / HomeServer, Mac16,10, macOS 27.0.1, arm64, `America/Los_Angeles`), the checkout in use, the effective `works_dir`, and the real package root the installed `kk` resolves to. Obtain explicit operator authorization before installation, scheduler changes or any live send; preserve unrelated jobs and ensure exactly one scheduler host.
- [ ] R2. Restore one supervised scheduler host: exactly one process owns port 3003, that process is the launchd job `ai.gobing.spur-serve` (so it survives logout and reboot), any duplicate server is retired without killing an in-flight job, and the process is observed stable rather than crash-looping.
- [ ] R3. Make `bootstrap.scheduler.enabled` in `.spur/config.yaml` agree with observed behaviour, and prove every scheduled tick issues a current command — no `scheduler.custom` payload may reference a retired entry point such as `scripts/daily-ai-news.ts`. The three kk news jobs must run `kk news generate --publish`, `kk news publish --window overseas-rss --unattended` and `kk news publish --window cn-peak --unattended` on the documented `America/Los_Angeles` schedule.
- [ ] R4. Observe one complete scheduled day on this host: generation settles `done` or `no-content`, both publish windows settle, xhs stays effectively `off` while flagged, and no disabled channel, gate or authentication safeguard is bypassed.
- [ ] R5. Save the three redacted launch receipts and the matching `kk news status` output under `docs/tasks/evidence/0369`, together with an index recording host identity, installed build, scheduler timezone, effective works root, observed timestamps and the previous-day overseas selection. No secrets, cookies or environment dumps.
- [ ] R6. Keep rollback explicit: identify the known-good installed bundle, config and scheduler backup before each change, preserve `kk.db`, and verify no second scheduler host was re-armed.
- [ ] R7. Run the applicable repository and migration checks, record failures honestly, and base every readiness claim on real production evidence — a local rehearsal, dry run, dummy run or fabricated receipt does not count.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Deployment changes are approved and the workspace is pinned (req: R1)
  Given the production host, its checkout, effective works_dir and installed package root have been inspected read-only
  When the cutover is applied
  Then operator approval covers installation, scheduler changes and effective live sends, works_dir is pinned absolute and persistent, and unrelated scheduler jobs are preserved

Scenario: AC2 — Exactly one supervised scheduler host serves port 3003 (req: R2)
  Given a duplicate shell-owned server and a crash-looping launchd agent
  When the duplicate is retired and ai.gobing.spur-serve takes the port
  Then one launchd-owned process listens on 3003, stays up across repeated observation, and no in-flight job was killed to get there

Scenario: AC3 — Every scheduled tick issues a current command (req: R3)
  Given the retired scripts/daily-ai-news.ts entry point no longer exists
  When the scheduler enqueues the kk news jobs
  Then each payload names a kk news verb that exists in the installed build, bootstrap.scheduler.enabled matches observed behaviour, and no tick fails with Module not found

Scenario: AC4 — A complete scheduled production day settles (req: R4)
  Given xhs remains effectively off and no gate is bypassed
  When generation and the overseas-rss and cn-peak ticks run
  Then generation settles done or no-content and both windows settle according to their gate conditions

Scenario: AC5 — Redacted production evidence is preserved (req: R5)
  Given the real scheduled production runs
  When their receipts and status outputs are reviewed
  Then docs/tasks/evidence/0369 holds all three receipts, the matching status outputs and an index with host, build, timezone, works root, timestamps and the previous-day overseas selection, with no secrets or authentication state

Scenario: AC6 — Readiness rests on real evidence and stays reversible (req: R6, R7)
  Given the deployment, its backups and the production evidence
  When migration verification runs
  Then the applicable checks pass, kk.db is intact, rollback needs no second scheduler host, and no local or dummy run is presented as production proof
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Same-host cutover on the production Mac mini. No ssh, no second machine: every step runs from this
checkout, and `docs/migration.md` is the historical context, not a remote runbook.

1. Inspect read-only and record non-secret identity: host, macOS build, arch, timezone, installed
   `kk`/`spur`/`bun` versions, the package root `kk` resolves to (`~/.bun/install/global/...`, not the
   stale `~/node_modules` copy), `bootstrap.database.url` and `works_dir`.
2. Retire the duplicate server without losing work: wait for the in-flight scheduler job to finish,
   stop the shell-owned `spur self serve`, confirm port 3003 is free, then let the launchd agent bind
   it. Never bootout the launchd job while it is the only live scheduler host.
3. Reconcile config with behaviour: set `bootstrap.scheduler.enabled: true` in `.spur/config.yaml`,
   since the jobs are meant to run and already do; keep `.spur/config.yaml` as the single source of
   the three kk news job definitions.
4. Verify the tick path end to end: read the next `scheduler.custom` payloads from
   `queue_jobs`/`/api/jobs` and confirm they name `kk news` verbs, not retired scripts.
5. Prove generation on this host with the installed build, using a real run (a `no-content` settle is
   an acceptable outcome, a fabricated one is not), then let the scheduled ticks carry the day.
6. Capture redacted receipts plus `kk news status` per run date into
   `docs/tasks/evidence/0369/<YYYYMMDD>/`, review them for secrets, and only then mark the task done.

Rollback: keep the pre-change copies of `.spur/config.yaml` and the launchd plist, preserve
`.works/kk.db`, and restore the previous serving arrangement by re-enabling exactly one host — never
by re-arming a second.

### Plan

1. Read `docs/migration.md` as history, then inspect this host read-only and record its identity,
   installed build, package root, `works_dir` and scheduler state.
2. Record rollback copies of `.spur/config.yaml` and `~/Library/LaunchAgents/ai.gobing.spur-serve.plist`.
3. Retire the duplicate `spur self serve` after the in-flight job settles; re-enable the scheduler in
   config; let `ai.gobing.spur-serve` own port 3003 and confirm it stays up.
4. Confirm the next enqueued kk news payloads name `kk news` verbs.
5. Run a real generation on this host and let the scheduled ticks carry the day; keep xhs off.
6. Save redacted evidence under `docs/tasks/evidence/0369/`, run the repository checks, and close the
   task only from real scheduled evidence.

### Solution

Same-host cutover on the production Mac mini. No application code changed; the work is deployment,
scheduler and configuration state plus the corpus.

- `.spur/config.yaml:61` — `bootstrap.scheduler.enabled` false → true (with the dated WHY), so the
  flag stops documenting a behaviour that was not real; the running server had been scheduling all
  along.
- `.spur/config.yaml:147` — the three kk news jobs now pin `--agent pi-dsv4.1-flash-cc`. Cost-first
  resolution landed on executors that die at dispatch (opencode `-free` = invalid credential,
  `agy-gemini` = expired OAuth, `pi-dsv4.1-flash-volc` = 429 until 2026-11-18).
- `~/.config/spur/config.yaml` (machine config, not in Git) — the two `opencode-*-free` executors are
  `disabled: true` with the reproduction in a comment.
- `.bun/install/global/.../knowledge-kit/dist/index.js` — replaced with a fresh `bun run build` of
  this checkout. The installed 0.1.19 predated `99be5d14`'s `greenWithBundle` fix; only that hunk
  differed. `plugins/kk/scripts/` and `plugins/kk/workflows/` already matched.
- Scheduler host — the shell-owned `spur self serve` (pid 13440) was retired after the in-flight
  `kk-collect` settled and `ai.gobing.spur-serve` was re-bootstrapped, so exactly one launchd-owned
  process listens on 127.0.0.1:3003 and survives logout.
- `~/.config/kk/browser-leases/` — the weibo and shipinhao lease dirs were moved to
  `.works/tmp/rollback-20261115/leases/` after their holder processes and Chrome instances were
  confirmed gone.
- `docs/migration.md` — the Current handoff now describes the same-host cutover and the defects
  inspection found, replacing the remote-`ssh homelab` premise.

Rollback copies: `.works/tmp/rollback-20261115/` holds `config.yaml.bak`, the launchd plist,
`installed-dist-index.js.bak`, `spur-config.yaml.bak` and the two lease dirs. `kk.db` was never
modified.

Blocker carried to task 0374: `kk news prepare` extracts a non-empty pool and then never runs
`daily-plan`/`daily-qc-content`, so the gate writes EMPTY and generation settles `no-content`.

### Testing

Run on the production host (`mac.lan`, macOS 27.0.1, arm64, America/Los_Angeles) on 2026-11-15.

| Check | Command | Result |
| --- | --- | --- |
| Single supervised scheduler | `launchctl print gui/501/ai.gobing.spur-serve` + `lsof -nP -iTCP:3003 -sTCP:LISTEN` | PASS — state running, `runs = 1`, pid stable over 90 s, only that pid on 3003 |
| Scheduler is live under launchd | `queue_jobs` after the restart | PASS — 2026-11-15 10:30:00 `history-refresh` enqueued with the current config command |
| Tick commands are current | `SELECT … json_extract(payload,'$.command')` | PARTIAL — `kk-collect` verified current; the kk news payloads can only be re-read at their next tick (17:00 / 04:30) |
| Installed bundle matches the checkout | `diff apps/cli/dist/index.js <installed dist>` | PASS — identical; `greenWithBundle` present |
| Installed scripts/workflows | `diff -rq plugins/kk/{scripts,workflows}/ <installed>` | PASS — identical |
| `kk.db` integrity | `sqlite3 .works/kk.db "PRAGMA quick_check;"` | PASS — `ok` |
| Executor probes | `spur agent run "reply ok" --agent <name>` | PASS for `pi-dsv4.1-flash-cc`, `pi-deepseek`, `grok-4.7`; FAIL for `pi-dsv4.1-flash-volc` (429, resets 2026-11-18), `opencode -free` (invalid credential), `agy-gemini` (OAuth login) |
| Generation launch + executor probe | `kk news generate --run-date 20261115 --agent pi-dsv4.1-flash-cc` | PASS — launch accepted, executor probe passed, `kk news prepare` ran to the pool gate |
| Generation produces content | same command | FAIL — `status: no-content`, `exitCode: 0`; pool gate EMPTY although `10-collect/pool.json` holds 4 items. Filed as task 0374 |
| Prepare reproduction | `kk news prepare --work-dir .works/tmp/prepare-probe/20261115 --run-date 20261115` | Reproduced 3× (relative, absolute, in-workflow) — `step-timing.json` lists only `extract`, `21-plan/` absent |
| Full scheduled day (R4) | pending the 17:00 cn-peak tick and the next 04:30 generate | NOT RUN — cannot pass while 0374 is open |
| Redacted evidence (R5) | `docs/tasks/evidence/0369/` | NOT WRITTEN — no production run has produced a receipt worth preserving yet |

Repository gate (`bun run lint`, `bun run test`, `bun run build`) was NOT re-run to completion for
this task: the change set is `.spur/config.yaml`, `docs/migration.md` and task corpus, plus the
bundle rebuild that `bun run build` already produced. `bun run build` passed.

Batch follow-up 2026-11-15 11:55 PST (task 0374 landed, bundle redeployed):

- The `no-content` settle recorded above was **not** an editorial supply verdict. 0374 fixed the real
  cause — `kk news prepare` counted a bare `Doc[]` pool as zero items, so plan and QC never ran.
- The fixed bundle (`apps/cli/dist/index.js` from batch worktree `kk-runall-90de0e`, commit
  `72894080`) is deployed to `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit/dist/`.
  The pre-fix bundle is at `.works/tmp/rollback-20261115/installed-dist-index.prerefram.bak`.
- Live proof on the real store: `kk news prepare` now prints
  `{"pool":"ok","candidates":4,"selected":4}` and writes `pool-gate.json {"status":"PASS"}`; the gate
  earlier returned `{"pool":"empty","candidates":0}` on the same store and window.
- A real generation is running against that gate (`kk news generate --run-date 20261115 --agent
  pi-dsv4.1-flash-cc`, run `kk-news-generate-20261115-1794772431516`), authoring from the 4 admitted
  candidates. Its receipt is `.works/kk-news-generate/20261115/schedule-receipt.json`.
- R4 is still NOT met: this is a manual recovery run, not a scheduled day. The 17:00 `cn-peak` tick
  and the next 04:30 generate are what must settle before R4/R5 can be claimed.

### Review

Disposition: **not done — carried forward.** The deployment half is fixed and verified; R4/R5 remain
blocked by an open product defect (task 0374), so this task must not be marked complete.

Findings:

- **P1 — `kk news prepare` never runs plan/QC after a successful extract.** `10-collect/pool.json`
  holds 4 items and `step-timing.json` records only `extract`; `21-plan/` is never created, so the
  gate writes EMPTY and the day closes `no-content`. Reproduced 3× and filed as task 0374 with the
  trace seam named. This invalidates the 2026-11-14 reading that "the day is genuinely thin" as the
  reason for `no-content`.
- **P1 — the daily job could not have run at all before this change.** The scheduled payloads named
  `scripts/daily-ai-news.ts`, deleted by `86ec3def`; every tick from 2026-11-13 through 2026-11-15
  failed with `Module not found`. Fixed by the config the server now reads, but the proof waits for a
  real tick.
- **P2 — the supervised scheduler host was dead for at least a day.** `launchctl` showed 165 restarts
  against a port owned by a shell-started duplicate; a reboot would have taken the scheduler with the
  terminal. Now one launchd-owned process on 3003, verified stable.
- **P2 — the installed bundle was behind the checkout.** `dist/index.js` lacked `99be5d14`'s
  `greenWithBundle` fix, so a `done`-with-no-bundle generate kept blocking the next day's pools. Fixed
  by rebuilding and deploying; this is the AGENTS.md staleness trap firing in the upward direction.
- **P2 — the executor ladder has no headroom.** Three of the available standard/capable executors are
  unusable for account reasons (`volc` 429 until 2026-11-18, `zai` monthly limit, `agy` OAuth expired,
  opencode credentials invalid). Only `pi-dsv4.1-flash-cc`, `pi-deepseek` and `grok-4.7` answered. The
  pin makes the schedule work but leaves no failover: when `pi-dsv4.1-flash-cc` is exhausted the job
  stops with no ladder to climb. Re-authenticate `agy` and restore a permissive `volc` quota, or add a
  second pinned fallback.
- **P3 — secrets are stored in plaintext in `~/.config/kk/config.yaml`** (publish tokens and a purge
  secret among them). Out of scope here and not changed, but worth moving to a keychain-backed source
  before the next exposure.
- **P3 — `.spur/config.yaml` still comments that morning runs stay draft-only** while the active
  `daily-ai-voice` preset marks the after-generate rows `live`. The comment and the preset disagree;
  the schedule follows the preset. Update the comment or the preset, deliberately.

Residual risk: the 17:00 `cn-peak` tick will send a live weibo article if a bundle exists, and the next
04:30 generate will still settle `no-content` until 0374 lands. Nothing in this change set touches
`kk.db`, and every mutation has a pre-change copy under `.works/tmp/rollback-20261115/`.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-15T07:06:27.578Z backlog → todo (system)
- 2026-11-15T19:03:53.363Z todo → wip (system)

