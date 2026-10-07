---
schema_version: 1
name: "kk-collect workflow: standalone 4h collection into the store"
status: todo
template: feature-impl
created_at: 2026-10-07T03:58:06.075Z
updated_at: "2026-10-07T05:06:30.190Z"
feature_id: G31
priority: P1
tags:
  - kk-collect
  - workflow
estimate_hours: 7

dependencies: ["0206", "0207"]
---

## 0208. kk-collect workflow: standalone 4h collection into the store

### Background

Implements: R1 — kk-collect runs ingestion standalone and persists every item to the store; R2 — Re-collecting an already stored item updates it without duplicating; R6 — Overlapping collect runs are single-flight; R7 — A launchd/cron template schedules kk-collect every 4 hours.

Design: docs/design/kk-collect-and-daily-voice2.md §3, §5. Evidence: 20261006 run spent 1906 s in collect (step-timing.json).

### Requirements

- [ ] R1. `kk store lock acquire --name collect --run <id> [--ttl 21600000] [--db]` prints `{"acquired":true}` (exit 0) or `{"skipped":"locked","holder":<run>}` (exit 0). A lock older than its TTL is reclaimed. `kk store lock release --name collect --run <id>` frees only its own lock.
- [ ] R2. `kk store ingest --run <id> --in <Doc[].json> --new-ids <path> [--db]` calls `ItemsDao.upsertDocs`, writes a `collect_runs` row, writes the inserted plus label-invalidated ids to `--new-ids`, and prints `{inserted, updated, unchanged}`.
- [ ] R3. `plugins/kk/workflows/kk-collect.yaml` is a `kind: state-machine` with states `lock → collect → store → label → release → done`, plus `skipped` and `failed`:
  - `lock`: `kk ledger sync`, then acquire. It writes `<work_dir>/lock.json`, and a guard routes `skipped` when that file says skipped.
  - `collect`: same `kk executor fan-in --source …` sources and timeout overrides as `kk-daily-ai-voice.yaml` `collect`, writing to `<work_dir>/10-ingest/<stamp>_02_collect_blended.json`.
  - `store` and `label` route to a `release-failed` state that releases the lock and ends `failed`.
- [ ] R4. Core-facts markdown reuses the existing, unmodified `kk stage daily-collect-facts <work_dir> <stamp> <plugins_path>`, with `work_dir = .works/kk-collect/<stamp>` and `stamp = $(date -u +%Y%m%dT%H%MZ)`, so there is no new code in kk-workflow-stages.ts.
- [ ] R5. `label` runs `kk store label --run … --new-ids …` (task 0209). Until 0209 lands, the state's action is `true` and it exits 0.
- [ ] R6. `kk schedule render kk-collect --platform launchd|cron [--repo <dir>]` prints, from `plugins/kk/schedules/{launchd.plist.tmpl,cron.tmpl}`:
  - launchd: a plist with `StartInterval` 14400 and `ProgramArguments` = `spur workflow run plugins/kk/workflows/kk-collect.yaml`, with stdout/stderr going to `.works/kk-collect/launchd.log`;
  - cron: `0 */4 * * *`.

  Nothing is installed. The plugin README says installing it is an operator action.
- [ ] R7. `release` runs `kk ledger append --workflow kk-collect --run ${run.id}` after the release.

### Acceptance Criteria

- [ ] AC1 — kk-collect runs ingestion standalone and persists every item to the store
- [ ] AC2 — Re-collecting an already stored item updates it without duplicating
- [ ] AC3 — Overlapping collect runs are single-flight
- [ ] AC4 — A launchd/cron template schedules kk-collect every 4 hours

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

Files: `apps/cli/src/commands/store.ts` (lock, ingest), `apps/cli/src/commands/schedule.ts`, `apps/cli/src/cli.ts`, `plugins/kk/workflows/kk-collect.yaml`, `plugins/kk/schedules/*.tmpl`, `plugins/kk/README.md` (schedule section), `apps/cli/tests/kk-collect.test.ts`, `docs/04_DESIGN.md`.

Run id in YAML: verify the interpolation name (`${run.id}` or the engine's equivalent) with `spur workflow validate` before relying on it. If it is unavailable, `kk ledger append --latest` resolves the newest finished run of the workflow.

### Plan

- [ ] Failure-first list (lock held, stale lock, fan-in partial source failure, empty Doc[], store write error releases the lock, a second run inside the TTL, schedule render on an unknown platform).
- [ ] `lock` + `ingest` verbs on top of the 0206 DAOs.
- [ ] `kk-collect.yaml`; `spur workflow validate plugins/kk/workflows/kk-collect.yaml`.
- [ ] `schedule render` + templates + README section.
- [ ] E2E `apps/cli/tests/kk-collect.test.ts` with fake ingestion plugins via `--plugins-root` (the existing fan-in test pattern) and a temp `KK_CONFIG` pointing `store.db_path` at a tmp DB. Run the workflow twice, then assert: second-run upsert counts, the ledger has two sections, a held lock yields skipped. Copy the DB plus ledger to `.works/test-artifacts/0208/`.
- [ ] `docs/04_DESIGN.md` rows; `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
