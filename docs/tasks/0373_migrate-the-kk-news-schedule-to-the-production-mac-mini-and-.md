---
schema_version: 1
name: Migrate the kk news schedule to the production Mac mini and capture a complete scheduled day
status: done
template: standard
created_at: 2026-11-15T06:57:07.172Z
updated_at: "2026-11-16T18:10:46.323Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Treat this host as the production target: re-confirm its identity (`mac.lan` / HomeServer, Mac16,10, macOS 27.0.1, arm64, `America/Los_Angeles`), the checkout in use, the effective `works_dir`, and the real package root the installed `kk` resolves to. Obtain explicit operator authorization before installation, scheduler changes or any live send; preserve unrelated jobs and ensure exactly one scheduler host.
- [x] R2. Restore one supervised scheduler host: exactly one process owns port 3003, that process is the launchd job `ai.gobing.spur-serve` (so it survives logout and reboot), it runs the operator's chosen server argv (`spur self serve --host 0.0.0.0 --port 3003`), and it is observed stable rather than crash-looping.
- [x] R3. Make `bootstrap.scheduler.enabled` in `.spur/config.yaml` agree with observed behaviour, and ensure the checked-in schedule names current commands only — no `scheduler.custom` payload may reference a retired entry point such as `scripts/daily-ai-news.ts` — and prove the running server reads that checked-in config.
- [x] R4. Repair the generation path so a day that has content produces a bundle: the pool gate must count what `dailyExtract` actually writes, so plan and QC run and the gate can answer PASS.
- [x] R5. Keep the installed deployment level with the checkout — `dist/index.js`, `plugins/kk/scripts/` and `plugins/kk/workflows/` — so a scheduled run executes the code that was reviewed, not a stale bundle.
- [x] R6. Keep rollback explicit: record the known-good bundle, config and scheduler backups before each change, preserve `kk.db`, and verify no second scheduler host was re-armed.
- [x] R7. Run the applicable repository checks, record failures honestly, and name what remains unproven rather than substituting a local or dummy run for production evidence.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The production host is identified and changes are approved (req: R1)
  Given the host, its checkout, effective works_dir and installed package root have been inspected read-only
  When the cutover is applied
  Then operator approval covers installation, scheduler changes and effective live sends, works_dir is pinned absolute and persistent, and unrelated scheduler jobs are preserved

Scenario: AC2 — Exactly one supervised scheduler host serves port 3003 (req: R2)
  Given a duplicate shell-owned server and a crash-looping launchd agent
  When the duplicate is retired and ai.gobing.spur-serve takes the port
  Then one launchd-owned process listens on 3003 with the operator's argv, stays up across repeated observation, and no in-flight job was killed to get there

Scenario: AC3 — Config, schedule and running server agree (req: R3)
  Given the retired scripts/daily-ai-news.ts entry point no longer exists
  When bootstrap.scheduler.enabled and the checked-in job commands are read against the running server
  Then the flag matches behaviour, every job command names a kk verb that exists in the installed build, and a post-restart tick proves the server reads that config

Scenario: AC4 — A day with content produces a bundle (req: R4)
  Given a store pool the extract admits and the pool gate reads
  When generation prepares a run
  Then plan and QC execute, the gate answers PASS, and the run proceeds to author from the admitted candidates instead of closing no-content

Scenario: AC5 — The installed deployment matches the checkout (req: R5)
  Given the checkout that was reviewed
  When the installed kk is compared with a fresh build of it
  Then dist/index.js, plugins/kk/scripts/ and plugins/kk/workflows/ are byte-identical to the checkout

Scenario: AC6 — Every change stays reversible (req: R6, R7)
  Given the deployment, its backups and the checks that ran
  When the cutover is reviewed
  Then known-good bundle, config and scheduler copies exist outside Git, kk.db is intact, no second scheduler host is armed, and each check's real result is recorded
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-15T20:12:34.882Z

#### Q&A entry — 2026-11-15T20:15:00Z

**Q: the original R4/R5 required one complete scheduled day plus its redacted receipts. Can 0373 close without it?**
A: No — a scheduled day is clock-bound (04:30 / 07:00 / 17:00 ticks), and hand-running a window proves
the verb, not the schedule. Operator decision 2026-11-15: 0373 closes on what this session repaired and
proved (single supervised host, current commands, installed bundle level with the checkout, the
`kk news prepare` gate defect fixed and a real generation authoring from a PASS gate). The scheduled-day
proof moves to **task 0375**, which owns observing the next full day, reading back the three tick
payloads and filing `docs/tasks/evidence/0369/<YYYYMMDD>/`. Deferring rather than weakening: R4/R5 are
removed from this task's Requirements and named in 0375, so nothing is silently marked satisfied.

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

Same-host cutover on the production Mac mini. No product code owned by this task; the work is
deployment, scheduler and configuration state, with the one generation-path defect split out to 0374.

- **Scheduler host** — the shell-owned duplicate was retired (after its in-flight `kk-collect` settled)
  and `ai.gobing.spur-serve` re-bootstrapped so exactly one launchd-owned process owns port 3003. Per
  operator decision the launchd argv now runs the server the operator actually uses:
  `spur self serve --cwd /Users/robin/xprojects/knowledge-kit --host 0.0.0.0 --port 3003 --no-open`.
  Backup of the previous plist: `.works/tmp/rollback-20261115/ai.gobing.spur-serve.plist.pre-selfserve`.
  `kk schedule render kk-serve` still hardcodes `serve` + `127.0.0.1`
  (`plugins/kk/schedules/kk-serve.launchd.plist.tmpl`), so a re-render reverts this — tracked as a
  follow-up, not fixed here.
- **Schedule** — `.spur/config.yaml:61` `bootstrap.scheduler.enabled` false → true, with the dated WHY;
  `:147` the three kk news jobs pin `--agent pi-dsv4.1-flash-cc`. `apps/cli/tests/schedule-no-scripts.e2e.test.ts`
  updated in the same change so its exact-command assertion keeps its real property (a `kk` verb, no
  `scripts/` entry point, no bare `bun`).
- **Executors** — `~/.config/spur/config.yaml` (machine config, not Git): the two `opencode-*-free`
  entries are `disabled: true` with the reproduction in a comment; they answer `Invalid credential`
  while passing the readiness probe.
- **Installed deployment** — `dist/index.js` replaced with a fresh build of this checkout twice: the
  first attempt came from a shell with `NODE_ENV=test` and shipped `initializeLogger({ console: false })`,
  caught by diffing against a main-tree build (`apps/cli/src/index.ts:10`) and redeployed.
  `plugins/kk/scripts/` and `plugins/kk/workflows/` already matched. Backups:
  `installed-dist-index.js.bak` (0.1.19) and `installed-dist-index.prerefram.bak`.
- **Generation path** — the `no-content` closure was a real defect, not a thin pool: `readJsonFile`
  returned `null` for the bare `Doc[]` that `dailyExtract` writes, so `poolNonEmpty` was always false.
  Fixed under 0374 (`apps/cli/src/commands/content-generate.ts:404,405,748,765,864`), merged to `main`.
- **Browser leases** — the weibo and shipinhao `kk bot open` windows were closed with operator approval
  and their stale lease dirs moved to `.works/tmp/rollback-20261115/leases/`.
- `docs/migration.md` — Current handoff rewritten for the same-host reality.

Carried to **0376**: the scheduled-day observation and the redacted receipts (former R4/R5).

**Deployment close (2026-11-16).** Rebuilt and redeployed the reviewed `dist/index.js`, `plugins/kk/scripts/`, and `plugins/kk/workflows/` after the 0377 reporting fix. Pre-change copies are under `.works/tmp/rollback-20261116/installed-pre-verifyall/`; the machine config backup is `.works/tmp/rollback-20261116/config.yaml.pre-k2-xhs`. Installed and checkout dist now share SHA-256 `d65449e284f64dbd9a9905975e7c5beec7d6cbdfb2b363ae4178db51f603bbb6`, and all three recursive diffs are empty. The launchd scheduler remains one stable listener on port 3003. Full `bun run gate` finished 5247 pass / 0 fail.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Current host inspection: `mac.lan` / `HomeServer`, Mac16,10, macOS 27.0.1, arm64, PST; `kk` resolves to `/Users/robin/.bun/install/global/node_modules/@gobing-ai/knowledge-kit/dist/index.js`; effective `works_dir` and `store.db_path` are pinned absolute. Prior operator approvals and preserved jobs are recorded in `docs/tasks/0373_migrate-the-kk-news-schedule-to-the-production-mac-mini-and-.md:104`. |
| R2 | MET | `launchctl print gui/501/ai.gobing.spur-serve` → running, `runs = 1`, never exited; `lsof -nP -iTCP:3003 -sTCP:LISTEN` → only pid 90425; argv is the approved `spur self serve --cwd /Users/robin/xprojects/knowledge-kit --host 0.0.0.0 --port 3003 --no-open`. |
| R3 | MET | `.spur/config.yaml:65` enables the scheduler and `:166,:191,:204` use current `kk news` verbs; `apps/cli/tests/schedule-no-scripts.e2e.test.ts` passed. `/api/jobs` shows repeated post-restart `history-refresh` ticks with the checked-in command. |
| R4 | MET | `apps/cli/tests/content-generate.e2e.test.ts:333` passed: bare `Doc[]` reaches plan/QC and a PASS pool gate; `apps/cli/src/commands/content-generate.ts:753` reads the array through `readJsonValue`. |
| R5 | MET | Rebuilt and redeployed after the 0377 fix. Installed and checkout dist share SHA-256 `d65449e284f64dbd9a9905975e7c5beec7d6cbdfb2b363ae4178db51f603bbb6`; recursive diffs for dist, scripts, and workflows are all empty. Backups are under `.works/tmp/rollback-20261116/`. |
| R6 | MET | `.works/tmp/rollback-20261115/` contains the plist, config, machine config, and two bundle backups; `sqlite3 .works/kk.db 'PRAGMA quick_check;'` → `ok`; one listener remains on 3003. |
| R7 | MET | Fresh `bun run gate` passed: format, build, lint, typecheck, 58+2 rules, and 5247 tests with zero failures. Scheduled-day evidence remains explicitly outside this task. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | Host/config/package inspection completed read-only; original operator approvals are recorded in the task Solution. |
| AC2 | MET | command | `launchctl` plus `lsof` prove one stable launchd-owned listener on 3003 with the approved argv. |
| AC3 | MET | test | `apps/cli/tests/schedule-no-scripts.e2e.test.ts` passed; live `/api/jobs` confirms the running server reads checked-in commands. |
| AC4 | MET | test | `apps/cli/tests/content-generate.e2e.test.ts:333` proves a non-empty pool reaches plan/QC and a PASS gate. |
| AC5 | MET | command | Installed and checkout dist have identical SHA-256; dist, scripts, and workflows all diff clean. |
| AC6 | MET | command | Backup inventory exists, DB quick_check is `ok`, one scheduler listener remains, and the final gate is fully green at 5247/5247. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Disposition: **done for this task's scope.** The scheduled-day observation and its receipts moved to
0376 by explicit operator decision, recorded in Q&A; they are not claimed here.

Findings:

- **P1 (fixed elsewhere) — every generation closed `no-content`.** Not editorial supply: `readJsonFile`
  returned `null` for the bare `Doc[]` pool that `dailyExtract` writes, so `poolNonEmpty` was false, plan
  and QC never ran, and the gate reported `pooled === 0`. Fixed and proven under 0374. The 2026-11-14
  reading that "the day is genuinely thin" was wrong for the same-day runs.
- **P1 (fixed) — no scheduled tick could have worked.** The three job payloads named
  `scripts/daily-ai-news.ts`, deleted by `86ec3def`; every tick from 2026-11-13 to 2026-11-15 died with
  `Module not found`. The schedule now names `kk` verbs and the running server was proven to read it
  (a post-restart `history-refresh` tick fired from the checked-in command).
- **P1 (fixed) — no executor could run the workflow headlessly.** `opencode -free` = invalid credential,
  `agy-gemini` = expired OAuth, `pi-dsv4.1-flash-volc` = 429 until 2026-11-18. Pinned
  `pi-dsv4.1-flash-cc`, which answered a probe here. **Residual: no failover.** When that executor is
  exhausted the job stops with no ladder to climb — re-authenticate `agy`, restore `volc` quota, or add
  a second pinned fallback.
- **P2 (fixed) — the supervised scheduler host was dead.** `launchctl` had counted 165 → 316 restarts
  against a port owned by a shell-started duplicate, so a reboot would have taken the scheduler with the
  terminal. Now one launchd process on 3003, verified stable.
- **P2 (fixed) — the installed bundle was behind the checkout.** It lacked `99be5d14`'s
  `greenWithBundle` fix, so a `done`-with-no-bundle generate kept blocking the next day's pools.
- **P2 (open, outside this repo) — something else keeps starting an unsupervised server.** During the
  close-out a `spur self serve --host 0.0.0.0 --port 3003` appeared from the `-zsh` under
  `herdr server` and stole the port, pushing the launchd job to 316 restarts. The plist now runs that
  same argv under supervision, so the two are no longer rivals by accident — but a hand-started copy
  still wins the port. Worth stopping at the source.
- **P3 — secrets are plaintext in `~/.config/kk/config.yaml`** (publish tokens and a purge secret). Not
  changed here; move them to a keychain-backed source.
- **P3 — `.spur/config.yaml` still comments that morning runs stay draft-only** while the active
  `daily-ai-voice` preset marks the after-generate rows `live`. The comment and the preset disagree; the
  schedule follows the preset.

Rollback: every mutation has a pre-change copy under `.works/tmp/rollback-20261115/` (config, launchd
plist before and after the `self serve` change, both pre-fix bundles, the machine spur config, the two
lease dirs). `kk.db` was never modified (`PRAGMA quick_check` → `ok`).

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-15T07:06:27.578Z backlog → todo (system)
- 2026-11-15T19:03:53.363Z todo → wip (system)
- 2026-11-15T20:13:48.309Z wip → testing (system)
- 2026-11-15T20:14:41.488Z testing → done (system)

