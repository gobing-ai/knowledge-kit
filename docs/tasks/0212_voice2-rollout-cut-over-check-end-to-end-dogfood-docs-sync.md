---
schema_version: 1
name: "voice2 rollout: cut-over check, end-to-end dogfood, docs sync"
status: done
template: feature-impl
created_at: 2026-10-07T03:58:06.077Z
updated_at: "2026-10-08T20:39:58.999Z"
feature_id: G11
priority: P2
tags:
  - voice2
  - rollout
  - docs
estimate_hours: 4

dependencies: ["0211"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0212-verdict.json
---

## 0212. voice2 rollout: cut-over check, end-to-end dogfood, docs sync

### Background

Implements: R6 — Cut-over criterion is defined and measurable; R7 — End-to-end dogfood produces an episode from a collect-filled store; R8 — Architecture docs record the DAG workflow decision.

Design: docs/design/kk-collect-and-daily-voice2.md §8. ADR-031 and the 03 DAG note were drafted at planning time with status "accepted design". This task flips them to shipped and proves the whole path. (The ADR-030 store docs flip in 0210.)

### Requirements

- [x] R1. `kk ledger cutover-check --candidate kk-daily-ai-voice2 --baseline kk-daily-ai-voice --runs 5 [--works-dir .works]` parses both `ledger.md` files (the 0207 format: section heading + `<!-- run: -->` marker + step table). It prints `{ ready, streak, required, reasons[] }` and reports ready only when the newest N candidate sections are all `done` and the `publish-classify` Result cell of each matches the same-day baseline's target set. Exit 0 is always returned; `ready` is the signal.
- [x] R2. Dogfood: two real `kk-collect` runs fill the store, then voice2 runs with `publish_enabled=false` and produces article, script, audio and cover under its work_dir. Both `ledger.md` files show the runs with per-step durations and tokens (from `cost.exact`).
- [x] R3. ADR-031 status flips to shipped; 03 "DAG workflows" drops "not yet built"; the 04 row and 05 mark G11 done.
- [x] R4. Retiring `kk-daily-ai-voice.yaml` is filed as a follow-up task under G1 (via `spur task create`), not done here.

### Acceptance Criteria

- [x] AC1 — Cut-over criterion is defined and measurable
- [x] AC2 — End-to-end dogfood produces an episode from a collect-filled store
- [x] AC3 — Architecture docs record the DAG workflow decision

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

- [x] Failure-first list (fewer than N runs, a red run mid-streak, target mismatch, a baseline missing that day, malformed ledger section).
- [x] `parseLedger` + `cutoverCheck` + verb; fixture-driven test.
- [x] Run the dogfood. Keep both run dirs, `ledger.md` files and `kk.db` copies under `.works/test-artifacts/0212/`.
- [x] Doc flip via sp:doc-evolve; file the retire follow-up task; `bun run gate`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/daily.ts:264` |
| `apps/cli/src/commands/ledger.ts:222` |
| `apps/cli/src/commands/ledger.ts:24` |
| `apps/cli/src/commands/ledger.ts:293` |
| `apps/cli/src/commands/ledger.ts:6` |
| `apps/cli/src/commands/ledger.ts:9` |
| `apps/cli/src/ledger.ts:327` |
| `apps/cli/tests/commands/ledger.test.ts:50` |
| `apps/cli/tests/commands/ledger.test.ts:63` |
| `apps/cli/tests/cutover.test.ts:1` |
| `apps/cli/tests/voice2-dag.test.ts:212` |
| `apps/cli/tests/voice2-dag.test.ts:236` |
| `apps/cli/tests/voice2-dag.test.ts:590` |
| `apps/cli/tests/voice2-dag.test.ts:599` |
| `apps/cli/tests/voice2-dag.test.ts:608` |
| `docs/00_ADR.md:1173` |
| `docs/03_ARCHITECTURE.md:114` |
| `docs/04_DESIGN.md:1033` |
| `docs/05_FEATURES.md:95` |
| `docs/design/kk-collect-and-daily-voice2.md:98` |
| `packages/kk-store/tests/profile.test.ts:36` |
| `plugins/generations/daily-article-gen/src/index.ts:143` |
| `plugins/kk/decisions/extract/ai-news.yaml:16` |
| `plugins/kk/scripts/daily-stages.ts:1252` |
| `plugins/kk/scripts/daily-stages.ts:575` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1136` |
| `plugins/kk/workflows/kk-daily-ai-voice2.yaml:370` |
| `plugins/kk/workflows/kk-daily-ai-voice2.yaml:389` |
| `plugins/kk/workflows/kk-daily-ai-voice2.yaml:421` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/src/ledger.ts:1 (parseLedger/classifyTargetSet/cutoverCheck), verb apps/cli/src/commands/ledger.ts; 16 tests apps/cli/tests/cutover.test.ts:1; real-binary runs saved .works/test-artifacts/0212/cutover-check.txt and cutover-check-ready.txt ({"ready":true,"streak":5}, exit 0) |
| R2 | MET | kk-collect runs 73d06323+55e781fb filled store (56 items/280 labels/2 collect_runs); voice2 run 4a9b22f0 done draft-only: audio 30-audio/20261007_11_generate_content.mp3+wav metadata.qc.passed=true score=100 1020.9s/25 segments (evidence .works/test-artifacts/0212/run-4a9b22f0-audio-qc.json); ledgers: voice1 20 sections + voice2 12 sections (.works/test-artifacts/0212/ledger-rows.txt) |
| R3 | MET | docs/00_ADR.md:1171 ADR-031 implemented; docs/03_ARCHITECTURE.md:114 shipped note; docs/04_DESIGN.md:1033 row shipped; docs/05_FEATURES.md:95 G11 done |
| R4 | MET | follow-ups filed: 0222 (retire voice1 yaml), 0223 (gemini TTS probe/429 gap), 0224 (orphaned stage children) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Cut-over criterion is defined and measurable | MET | test | apps/cli/tests/cutover.test.ts:1 (16 tests incl. red-run/mid-streak/target-mismatch/missing-baseline classes); `kk ledger cutover-check` exits 0 with measured streak+reasons (.works/test-artifacts/0212/cutover-check-ready.txt) |
| End-to-end dogfood produces an episode from a collect-filled store | MET | command | run 4a9b22f0 done, draft-only; store 56 items/280 labels; article+script+audio(qc.passed score=100 1020.9s)+cover+xhs under .works/kk-daily-ai-voice2/20261007/; both ledger.md files carry runs |
| Architecture docs record the DAG workflow decision | MET | command | docs/00_ADR.md:1171, docs/03_ARCHITECTURE.md:114, docs/04_DESIGN.md:1033, docs/05_FEATURES.md:95; retire follow-up 0222 + 0223/0224 filed via spur task create |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

PASS (self-review, SECUA-lite): diff matches R1–R4; both ledger summary bridges (publish/publish-classify) shape-consistent; wrap-docs edge is a true dataflow dependency declared topologically; profile gte-2 synced across yaml/test/design doc; no suppressions or skipped tests; gate 2193 pass / 0 fail (bun run gate).

| Priority | Finding | Status |
| --- | --- | --- |
| P1 | Stale DAG test asserted generate and wrap-docs start in the same wave — contradicts the 0212 race fix (generate now consumes wrap-docs output). Test hung when cover agent.run was enabled in the fixture. | Fixed in-task: test asserts generate >= wrap-docs start + 2s (apps/cli/tests/voice2-dag.test.ts) |
| P2 | Profile test pinned kk-item-quality gte 3, drifting from the shipped gte-2 profile; design doc section 4 pinned gte 3 too. | Fixed in-task: test + design doc synced to gte 2 (packages/kk-store/tests/profile.test.ts, docs/design/kk-collect-and-daily-voice2.md:98) |
| P3 | 64-hex source ids broke excluded-reference extraction (16-hex regex). | Fixed in-task: {16,64} bounds in daily-article-gen + daily-stages show-notes |
| P4 | Gemini TTS probe passes but real segment hits weekly-quota 429; engine kill leaves orphaned stage children. | Filed as follow-ups 0223, 0224 (out of scope here) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-08T18:42:53.040Z todo → wip (system)
- 2026-10-08T18:48:53.111Z wip → testing (system)
- 2026-10-08T18:49:12.777Z testing → done (system)

### Notes

2026-10-08 post-merge: the `sp/run-0212-e7d51f81` worktree holding the dogfood `.works/` evidence was removed after the merge to `main` (043f4813); the untracked run dirs, `ledger.md` copies, `kk.db` snapshots and `cutover-check*.txt`/`run-4a9b22f0-audio-qc.json`/`ledger-rows.txt` files under its `.works/` are no longer on disk (`.works` is not git-tracked). Surviving evidence: the inline values quoted in Review/Testing above, verdict `.spur/run/0212-verdict.json`, dogfood run of record `4a9b22f0` (reachable via `spur task run-link 0212`), and the repeatable fixtures `.works/test-artifacts/0212/cutover-fixtures.md` + `README.md` (regenerable with `bun test apps/cli/tests/cutover.test.ts`). First live merged-tip voice2 run (draft-only, 20261008): workflow run `38e53162`.

