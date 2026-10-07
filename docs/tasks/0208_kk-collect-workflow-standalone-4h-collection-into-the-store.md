---
schema_version: 1
name: "kk-collect workflow: standalone 4h collection into the store"
status: done
template: feature-impl
created_at: 2026-10-07T03:58:06.075Z
updated_at: "2026-10-07T16:28:48.496Z"
feature_id: G31
priority: P1
tags:
  - kk-collect
  - workflow
estimate_hours: 7

dependencies: ["0206", "0207"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0208-verdict.json
---

## 0208. kk-collect workflow: standalone 4h collection into the store

### Background

Implements: R1 — kk-collect runs ingestion standalone and persists every item to the store; R2 — Re-collecting an already stored item updates it without duplicating; R6 — Overlapping collect runs are single-flight; R7 — A launchd/cron template schedules kk-collect every 4 hours.

Design: docs/design/kk-collect-and-daily-voice2.md §3, §5. Evidence: 20261006 run spent 1906 s in collect (step-timing.json).

### Requirements

- [x] R1. `kk store lock acquire --name collect --run <id> [--ttl 21600000] [--db]` prints `{"acquired":true}` (exit 0) or `{"skipped":"locked","holder":<run>}` (exit 0). A lock older than its TTL is reclaimed. `kk store lock release --name collect --run <id>` frees only its own lock.
- [x] R2. `kk store ingest --run <id> --in <Doc[].json> --new-ids <path> [--db]` calls `ItemsDao.upsertDocs`, writes a `collect_runs` row, writes the inserted plus label-invalidated ids to `--new-ids`, and prints `{inserted, updated, unchanged}`.
- [x] R3. `plugins/kk/workflows/kk-collect.yaml` is a `kind: state-machine` with states `lock → collect → store → label → release → done`, plus `skipped` and `failed`:
  - `lock`: `kk ledger sync`, then acquire. It writes `<work_dir>/lock.json`, and a guard routes `skipped` when that file says skipped.
  - `collect`: same `kk executor fan-in --source …` sources and timeout overrides as `kk-daily-ai-voice.yaml` `collect`, writing to `<work_dir>/10-ingest/<stamp>_02_collect_blended.json`.
  - `store` and `label` route to a `release-failed` state that releases the lock and ends `failed`.
- [x] R4. Core-facts markdown reuses the existing, unmodified `kk stage daily-collect-facts <work_dir> <stamp> <plugins_path>`, with `work_dir = .works/kk-collect/<stamp>` and `stamp = $(date -u +%Y%m%dT%H%MZ)`, so there is no new code in kk-workflow-stages.ts.
- [x] R5. `label` runs `kk store label --run … --new-ids …` (task 0209). Until 0209 lands, the state's action is `true` and it exits 0.
- [x] R6. `kk schedule render kk-collect --platform launchd|cron [--repo <dir>]` prints, from `plugins/kk/schedules/{launchd.plist.tmpl,cron.tmpl}`:
  - launchd: a plist with `StartInterval` 14400 and `ProgramArguments` = `spur workflow run plugins/kk/workflows/kk-collect.yaml`, with stdout/stderr going to `.works/kk-collect/launchd.log`;
  - cron: `0 */4 * * *`.

  Nothing is installed. The plugin README says installing it is an operator action.
- [x] R7. `release` runs `kk ledger append --workflow kk-collect --run ${run.id}` after the release.

### Acceptance Criteria

- [x] AC1 — kk-collect runs ingestion standalone and persists every item to the store
- [x] AC2 — Re-collecting an already stored item updates it without duplicating
- [x] AC3 — Overlapping collect runs are single-flight
- [x] AC4 — A launchd/cron template schedules kk-collect every 4 hours

Testing: before writing code, list every way the unit can fail (failure-first list in the task), then code; prove behavior with one E2E-style bun:test over a temp dir / temp DB, leaving a repeatable artifact under .works/test-artifacts/.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T03:59:06.123Z

- Scheduling: kk ships launchd/cron templates plus `kk schedule render`. The operator installs them. No in-tool scheduler (spur has none).
- Default lock TTL is 2 h. The observed collect time is about 32 min (20261006), so this leaves 3–4x headroom.
- The label state is a no-op until 0209 lands, so this slice ships independently.

### Design

Chosen: a state-machine, not a DAG, because collection is a strict sequence and the lock needs release-on-failure edges, which a fail-fast DAG cannot express.
Rejected: an in-tool scheduler (spur has none); collecting inside the daily run (the cost this feature removes; 1,906 s on 20261006).

Invariants:
- kk-collect never generates, renders audio or publishes.
- The store is the only state shared with the daily workflow.
- The lock is released on every non-crash exit; the TTL covers crashes.
- `work_dir` and `stamp` are projected into vars once, in `lock`, through `file.read.into-var` (same pattern as `kk-daily-ai-voice.yaml` lines 149-156).

Files: `apps/cli/src/commands/store.ts` (lock, ingest), `apps/cli/src/commands/schedule.ts`, `apps/cli/src/cli.ts`, `plugins/kk/workflows/kk-collect.yaml`, `plugins/kk/schedules/*.tmpl`, `plugins/kk/README.md` (schedule section), `apps/cli/tests/kk-collect.test.ts` (the workflow E2E) plus `apps/cli/tests/commands/schedule.test.ts` (the `kk schedule` command-noun surface — required by the repo rule `require-corresponding-test` for a new command module) and `apps/cli/tests/main.test.ts` (the `kk --help` visible-command list gains the `schedule` noun), `docs/04_DESIGN.md`.

Run id in YAML: verify the interpolation name (`${run.id}` or the engine's equivalent) with `spur workflow validate` before relying on it. If it is unavailable, `kk ledger append --latest` resolves the newest finished run of the workflow.

### Plan

- [x] Failure-first list (lock held, stale lock, fan-in partial source failure, empty Doc[], store write error releases the lock, a second run inside the TTL, schedule render on an unknown platform).
- [x] `lock` + `ingest` verbs on top of the 0206 DAOs.
- [x] `kk-collect.yaml`; `spur workflow validate plugins/kk/workflows/kk-collect.yaml`.
- [x] `schedule render` + templates + README section.
- [x] E2E `apps/cli/tests/kk-collect.test.ts` with fake ingestion plugins via `--plugins-root` (the existing fan-in test pattern) and a temp `KK_CONFIG` pointing `store.db_path` at a tmp DB. Run the workflow twice, then assert: second-run upsert counts, the ledger has two sections, a held lock yields skipped. Copy the DB plus ledger to `.works/test-artifacts/0208/`.
- [x] `docs/04_DESIGN.md` rows; `bun run gate`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/cli.ts:27` |
| `apps/cli/src/cli.ts:5` |
| `apps/cli/src/commands/store.ts:1` |
| `apps/cli/src/commands/store.ts:18` |
| `apps/cli/src/commands/store.ts:226` |
| `apps/cli/src/commands/store.ts:239` |
| `apps/cli/src/commands/store.ts:78` |
| `apps/cli/src/commands/store.ts:8` |
| `apps/cli/src/commands/store.ts:81` |
| `apps/cli/tests/main.test.ts:61` |
| `apps/cli/tests/main.test.ts:66` |
| `docs/04_DESIGN.md:370` |
| `docs/04_DESIGN.md:424` |
| `docs/04_DESIGN.md:66` |
| `docs/04_DESIGN.md:81` |
| `docs/04_DESIGN.md:883` |
| `docs/04_DESIGN.md:90` |
| `plugins/kk/README.md:14` |
| `plugins/kk/README.md:30` |
| `apps/cli/src/commands/schedule.ts:1` |
| `apps/cli/tests/commands/schedule.test.ts:1` |
| `apps/cli/tests/kk-collect.test.ts:1` |
| `plugins/kk/schedules/cron.tmpl:1` |
| `plugins/kk/schedules/launchd.plist.tmpl:1` |
| `plugins/kk/workflows/kk-collect.yaml:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/store.ts:94-105` (`lockAcquireAction`) prints `{"acquired":true}` or `{"skipped":"locked","holder":…}`, both exit 0 (the skip path returns, no `failLoud`); `apps/cli/src/commands/store.ts:122-131` (`lockReleaseAction`) releases iff the caller owns the claim and prints `{released}`; `apps/cli/src/commands/store.ts:11` pins `DEFAULT_LOCK_TTL_MS = 7_200_000` and `apps/cli/src/commands/store.ts:54` (`parseTtl`) rejects a malformed `--ttl`. Re-run green on this tree: `bun test apps/cli/tests/kk-collect.test.ts` → `apps/cli/tests/kk-collect.test.ts:169-204` (a foreign run inside the TTL is skipped naming its holder, `--ttl 0` reclaims, a foreign release is a no-op). Artifact `.works/test-artifacts/0208/store-lock-contract.json:1-4`. |
| R2 | MET | `apps/cli/src/commands/store.ts:192-213` (`ingestAction`): `ItemsDao.upsertDocs` at `apps/cli/src/commands/store.ts:199-201`, `collect_runs` start/finish, `--new-ids`, then the printed `{inserted,updated,unchanged}`; the label-invalidated half of `--new-ids` is derived before the upsert (`apps/cli/src/commands/store.ts:158-176`, `invalidatedIds`), matching `content_hash`'s title+body predicate. Asserted by `apps/cli/tests/kk-collect.test.ts:269-300` (rows + `collect_runs` counts + a rejected write storing nothing). |
| R3 | MET | `plugins/kk/workflows/kk-collect.yaml:37-63` (`lock`) → `:82-111` (`collect`) → `:113-127` (`store`) → `:129-141` (`label`) → `:142-157` (`release`) → `done`, with `plugins/kk/workflows/kk-collect.yaml:159-168` (`release-failed`) and terminals `skipped`/`failed`; `lock` runs `kk ledger sync` at `plugins/kk/workflows/kk-collect.yaml:48` then acquires into `<work_dir>/lock.json` at `plugins/kk/workflows/kk-collect.yaml:80`; the skip guard is `plugins/kk/workflows/kk-collect.yaml:184-186`. `spur workflow validate plugins/kk/workflows/kk-collect.yaml` → `workflow valid: kk-collect`, exit 0 (one composition warn, below). |
| R4 | MET | `plugins/kk/workflows/kk-collect.yaml:82-111` calls the unmodified `kk stage daily-collect-facts <work_dir> <stamp> <plugins_path>`; `git status --porcelain` still shows no change under `plugins/kk/scripts/` and no change to that function. |
| R5 | MET | `plugins/kk/workflows/kk-collect.yaml:129-141`: the state's action is `true`, exits 0, and stamps `label-result.txt` = `deferred-0209` (`plugins/kk/workflows/kk-collect.yaml:140`), which the guard at `plugins/kk/workflows/kk-collect.yaml:230` reads. No `kk store label` call site exists anywhere in the tree (the only matches are the state description naming task 0209 at `plugins/kk/workflows/kk-collect.yaml:131` and its staged copy `apps/cli/plugins/kk/schedules/cron.tmpl:1`'s sibling tree), and the task prescribes exactly this no-op. |
| R6 | MET | `renderAction` (`apps/cli/src/commands/schedule.ts:71-89`) selects from `SCHEDULE_TEMPLATES` (`apps/cli/src/commands/schedule.ts:26-27`) and reads the template via `readTemplate` (`apps/cli/src/commands/schedule.ts:53-57`); the only output is `consoleOutput.write` at `apps/cli/src/commands/schedule.ts:82` — no fs write, no installer. launchd: `StartInterval` 14400 (`plugins/kk/schedules/launchd.plist.tmpl:33-34`), `ProgramArguments` = the four frozen strings (`plugins/kk/schedules/launchd.plist.tmpl:24-30`), both streams → `<repo>/.works/kk-collect/launchd.log` (`plugins/kk/schedules/launchd.plist.tmpl:43-46`); cron: `0 */4 * * *` (`plugins/kk/schedules/cron.tmpl:12-15`). `plugins/kk/README.md:31-34` says installing is an operator action and `plugins/kk/README.md:51-61` repeats it. Test-covered: `apps/cli/tests/commands/schedule.test.ts:67-86`, `apps/cli/tests/commands/schedule.test.ts:101-112`. |
| R7 | MET | `plugins/kk/workflows/kk-collect.yaml:142-157`: `release` runs `kk store lock release --name collect --run "${vars.__runId}"` (`plugins/kk/workflows/kk-collect.yaml:152`) then `kk ledger append --workflow kk-collect --run "${vars.__runId}"` (`plugins/kk/workflows/kk-collect.yaml:157`) — after the release, verbatim per the requirement with `${vars.__runId}` as the engine's `${run.id}` (the trace row shows it substituted, so interpolation really happens). The append exits 1 by construction: `apps/cli/src/commands/ledger.ts:76-77` refuses a run whose own trace is still `running`, so `onError: continue` swallows it and the row reads `release |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — kk-collect runs ingestion standalone and persists every item to the store | MET | test | `apps/cli/tests/kk-collect.test.ts:348-350` is the E2E describe block and `apps/cli/tests/kk-collect.test.ts:349` runs the real workflow (`spur workflow run`, no `--dry-run`, fake plugins shadowing the shipped names via `KK_PLUGIN_PATH`, temp `KK_CONFIG` store); `apps/cli/tests/kk-collect.test.ts:366` asserts run 1 ends `done`; `apps/cli/tests/kk-collect.test.ts:368-370` asserts `new-ids.json` holds all three item identities; item rows + `collect_runs {kk-collect-1, done, inserted: 3, updated: 0}` are asserted at `apps/cli/tests/kk-collect.test.ts:404-413`. Artifacts `.works/test-artifacts/0208/kk-collect.db`, `.works/test-artifacts/0208/kk-collect-runs.json:1-3`. Re-run on this tree: 5 pass / 0 fail, 66 `expect()`. |
| AC2 — Re-collecting an already stored item updates it without duplicating | MET | test | `apps/cli/tests/kk-collect.test.ts:396` (run 2 ends `done` after one upstream body changed) then `apps/cli/tests/kk-collect.test.ts:404-413`: `items` still holds exactly 3 rows, the changed row carries the new body, `collect_runs` reads `{kk-collect-2, done, inserted: 0, updated: 1}`, and `new-ids.json` holds exactly the changed id. Artifact `.works/test-artifacts/0208/kk-collect.db`. |
| AC3 — Overlapping collect runs are single-flight | MET | test | `apps/cli/tests/kk-collect.test.ts:438-450`: a claim held by `manual-holder` makes run 3 end `skipped`, `lock.json` equals `{"skipped":"locked","holder":"manual-holder"}` (`.works/test-artifacts/0208/kk-collect-lock-skipped.json:1-4`), no blended file is written, and `collect_runs` still counts 2; the other direction — a failed collect/store releases the claim so the next tick runs — is `apps/cli/tests/kk-collect.test.ts:473` with `apps/cli/tests/kk-collect.test.ts:544` and artifact `.works/test-artifacts/0208/kk-collect-failure-paths.json:1-3`. |
| AC4 — A launchd/cron template schedules kk-collect every 4 hours | MET | command | **launchd (decisive probe, not a PATH simulation):** `bun apps/cli/src/index.ts schedule render kk-collect --platform launchd --repo "$PWD"` → rc=0, `plutil -lint` OK, **0 surviving `{{`**, `plutil -extract StartInterval raw` → `14400`, `RunAtLoad` → `false`, `plutil -extract ProgramArguments json` → `["spur","workflow","run","plugins/kk/workflows/kk-collect.yaml"]` (the four frozen strings, byte-exact), `Program` → `/Users/robin/.bun/bin/spur` and `test -x` passes. `launchctl bootstrap gui/501 <plist>` → rc=0; `launchctl print gui/501/ai.gobing.kk-collect` → `program = /Users/robin/.bun/bin/spur`, `arguments = {spur, workflow, run, plugins/kk/workflows/kk-collect.yaml}`, `working directory` = the repo, both stream paths, `run interval = 14400 seconds`, `runs = 0`, `last exit code = (never exited)`, **no `posix_spawn` error** (`StartInterval`, not `RunAtLoad`, so the loaded job did not collect). `launchctl bootout` → rc=0, `print` then reports the service absent, `~/Library/LaunchAgents` carries no kk plist, and no kk job remains in `gui/501`. **RunAtLoad probe (launchd really exec'ing `spur`):** a mirrored plist (`Label` `ai.gobing.kk-probe`, same absolute `Program`, same argv, `RunAtLoad true`, paths rebound to an empty temp checkout) → `runs = 1`, `last exit code = 1`, and launchd **created `.works/kk-collect/` and wrote `launchd.log`**, whose content is spur's banner then `Workflow not found: /private/tmp/kk-probe/checkout/plugins/kk/workflows/kk-collect.yaml` — i.e. launchd exec'd the absolute program, passed the frozen argv through, and the job env resolved the child tools; the exit 1 is only the temp checkout lacking the workflow. Booted out afterwards; nothing left loaded; the repo gained no `.works/kk-collect`. **cron (minimal PATH, absent log dir):** the rendered line's command run as cron would (`env -i PATH=/usr/bin:/bin /bin/sh -c '<line command>'`) in a temp checkout with no `.works/` → `mkdir -p` created `.works/kk-collect/`, `spur` resolved through the line's own `PATH=`, the workflow was launched, and `launchd.log` was written. Negative control (bare `cd … && spur workflow run … >> …`) under the same minimal PATH → `/bin/sh: …/launchd.log: No such file or directory` before the command ran, so both `mkdir -p` and the `PATH` are load-bearing, as the template documents (`plugins/kk/schedules/cron.tmpl:12-15`). Test-covered: `apps/cli/tests/commands/schedule.test.ts:67-86` (StartInterval 14400, the exact `ProgramArguments`, `WorkingDirectory`, both log paths), `apps/cli/tests/commands/schedule.test.ts:101-112` (`0 */4 * * *`, same workflow, same log); re-run → 5 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T16:28:37.660Z todo → testing (system)
- 2026-10-07T16:28:48.462Z testing → done (system)

