---
schema_version: 1
name: "kk-collect workflow: standalone 4h collection into the store"
status: done
template: feature-impl
created_at: 2026-10-07T03:58:06.075Z
updated_at: "2026-10-07T23:22:11.616Z"
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
| R1 | MET | `apps/cli/src/commands/store.ts:151` lockAcquireAction writes acquired at `apps/cli/src/commands/store.ts:158` or skipped with holder at `apps/cli/src/commands/store.ts:162`, both exit 0; release at `apps/cli/src/commands/store.ts:179`; tests `apps/cli/tests/kk-collect.test.ts:169`, `packages/kk-store/tests/dao/locks.test.ts:28` |
| R2 | MET | `apps/cli/src/commands/store.ts:249` ingestAction upserts at `apps/cli/src/commands/store.ts:258` and writes new ids via `apps/cli/src/commands/store.ts:234`; tests `apps/cli/tests/kk-collect.test.ts:269`, `packages/kk-store/tests/dao/items.test.ts:51` |
| R3 | MET | `plugins/kk/workflows/kk-collect.yaml:37` lock → `plugins/kk/workflows/kk-collect.yaml:82` collect → `plugins/kk/workflows/kk-collect.yaml:113` store → `plugins/kk/workflows/kk-collect.yaml:129` label → `plugins/kk/workflows/kk-collect.yaml:148` release → done, with skipped/failed terminals at `plugins/kk/workflows/kk-collect.yaml:12`. Fix pass: spur's ADR-115 composition lint had made `spur workflow validate` exit 1 (label→release guard, 10 logical commands > 5); the guard was rewritten to 3 commands at `plugins/kk/workflows/kk-collect.yaml:242` and validate now exits 0 |
| R4 | MET | `plugins/kk/workflows/kk-collect.yaml:111` calls the unmodified daily-collect-facts stage; E2E `apps/cli/tests/kk-collect.test.ts:349` |
| R5 | MET | `plugins/kk/workflows/kk-collect.yaml:145` runs kk store label with run id and new-ids (0209 landed, so the interim stub is superseded) |
| R6 | MET | `apps/cli/src/commands/schedule.ts:71` renderAction selects from `apps/cli/src/commands/schedule.ts:26` and reads via `apps/cli/src/commands/schedule.ts:53`; `kk schedule render kk-collect --platform cron` this run printed a `0 */4 * * *` line; tests `apps/cli/tests/commands/schedule.test.ts:53` |
| R7 | MET | `plugins/kk/workflows/kk-collect.yaml:158` releases the lock then `plugins/kk/workflows/kk-collect.yaml:163` appends the ledger; failure path releases at `plugins/kk/workflows/kk-collect.yaml:174`; `apps/cli/tests/kk-collect.test.ts:473` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — kk-collect runs ingestion standalone and persists every item to the store | MET | test | `apps/cli/tests/kk-collect.test.ts:349` E2E describe; green in this run's `bun test apps/cli/tests/kk-collect.test.ts plugins/kk/tests/verdict-confidence.test.ts` (57/57) after the guard fix |
| AC2 — Re-collecting an already stored item updates it without duplicating | MET | test | `apps/cli/tests/kk-collect.test.ts:349` run 2, plus `packages/kk-store/tests/dao/items.test.ts:36` |
| AC3 — Overlapping collect runs are single-flight | MET | test | `apps/cli/tests/kk-collect.test.ts:169`, `packages/kk-store/tests/kk-store.test.ts:179` (concurrent openers) |
| AC4 — A launchd/cron template schedules kk-collect every 4 hours | MET | command | `bun apps/cli/src/index.ts schedule render kk-collect --platform cron` → `0 */4 * * *` entry running `spur workflow run plugins/kk/workflows/kk-collect.yaml`; `apps/cli/tests/commands/schedule.test.ts:67` |
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

