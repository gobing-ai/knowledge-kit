---
schema_version: 1
name: "voice2 rollout: cut-over check, end-to-end dogfood, docs sync"
status: wip
template: feature-impl
created_at: 2026-10-07T03:58:06.077Z
updated_at: "2026-10-08T18:43:37.888Z"
feature_id: G11
priority: P2
tags:
  - voice2
  - rollout
  - docs
estimate_hours: 4

dependencies: ["0211"]
---

## 0212. voice2 rollout: cut-over check, end-to-end dogfood, docs sync

### Background

Implements: R6 — Cut-over criterion is defined and measurable; R7 — End-to-end dogfood produces an episode from a collect-filled store; R8 — Architecture docs record the DAG workflow decision.

Design: docs/design/kk-collect-and-daily-voice2.md §8. ADR-031 and the 03 DAG note were drafted at planning time with status "accepted design". This task flips them to shipped and proves the whole path. (The ADR-030 store docs flip in 0210.)

### Requirements

- [ ] R1. `kk ledger cutover-check --candidate kk-daily-ai-voice2 --baseline kk-daily-ai-voice --runs 5 [--works-dir .works]` parses both `ledger.md` files (the 0207 format: section heading + `<!-- run: -->` marker + step table). It prints `{ ready, streak, required, reasons[] }` and reports ready only when the newest N candidate sections are all `done` and the `publish-classify` Result cell of each matches the same-day baseline's target set. Exit 0 is always returned; `ready` is the signal.
- [ ] R2. Dogfood: two real `kk-collect` runs fill the store, then voice2 runs with `publish_enabled=false` and produces article, script, audio and cover under its work_dir. Both `ledger.md` files show the runs with per-step durations and tokens (from `cost.exact`).
- [ ] R3. ADR-031 status flips to shipped; 03 "DAG workflows" drops "not yet built"; the 04 row and 05 mark G11 done.
- [ ] R4. Retiring `kk-daily-ai-voice.yaml` is filed as a follow-up task under G1 (via `spur task create`), not done here.

### Acceptance Criteria

- [ ] AC1 — Cut-over criterion is defined and measurable
- [ ] AC2 — End-to-end dogfood produces an episode from a collect-filled store
- [ ] AC3 — Architecture docs record the DAG workflow decision

Testing: before writing code, list every way the unit can fail (failure-first list in the task), then code; prove behavior with one E2E-style bun:test over a temp dir / temp DB, leaving a repeatable artifact under .works/test-artifacts/.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T03:59:06.896Z

- Default parity streak N is 5 consecutive green voice2 runs whose publish targets match the baseline.
- Retiring kk-daily-ai-voice.yaml is a separate follow-up change after cutover-check reports ready.

### Design

Chosen: parity measured from ledgers (already authoritative per run) rather than a new comparison store.
Rejected: time-boxed cut-over (no evidence); auto-retiring the old YAML (irreversible for the daily episode).

Invariants:
- The old workflow keeps running until an operator retires it in a separate change.
- cutover-check is read-only.

Files: `apps/cli/src/ledger.ts` (`parseLedger`, `cutoverCheck`, pure), `apps/cli/src/commands/ledger.ts` (`cutover-check`), `apps/cli/tests/cutover.test.ts` + fixture ledgers, `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`.

Key signature: `cutoverCheck(candidate: LedgerRun[], baseline: LedgerRun[], runs: number): { ready: boolean; streak: number; required: number; reasons: string[] }`.

### Plan

- [ ] Failure-first list (fewer than N runs, a red run mid-streak, target mismatch, a baseline missing that day, malformed ledger section).
- [ ] `parseLedger` + `cutoverCheck` + verb; fixture-driven test.
- [ ] Run the dogfood. Keep both run dirs, `ledger.md` files and `kk.db` copies under `.works/test-artifacts/0212/`.
- [ ] Doc flip via sp:doc-evolve; file the retire follow-up task; `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

E2E dogfood verified: run 4a9b22f0 done — full voice2 DAG from store, draft-only; audio qc.passed=true score=100 1020.9s/25 segments; both ledgers show runs; cutover-check evidence under .works/test-artifacts/0212/. Gate: 2193 pass / 0 fail.

### Review

PASS (self-review, SECUA-lite): diff matches R1–R4; both ledger summary bridges (publish/publish-classify) shape-consistent; wrap-docs edge is a true dataflow dependency declared topologically; profile gte-2 synced across yaml/test/design doc; no suppressions or skipped tests; gate 2193 pass / 0 fail (bun run gate).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-08T18:42:53.040Z todo → wip (system)

