---
schema_version: 1
name: Close the per-file coverage gaps the rail work left behind
status: done
template: issue
created_at: 2026-11-17T07:16:49.654Z
updated_at: "2026-11-17T17:50:32.735Z"
feature_id: A22

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0383. Close the per-file coverage gaps the rail work left behind

### Background

Captured from the creation title: "Close the per-file coverage gaps the rail work left behind".

### Requirements

- [x] R1. **threads-pub post rail** — `plugins/publishings/threads-pub/src/post-rail.ts` is at 12.50% funcs / 14.73% lines (body 146-353 uncovered). Add the fake-page suite its x sibling already has (`plugins/publishings/x-pub/tests/post-rail.test.ts`, 663 lines), covering the composer, session and receipt paths, so the file clears the 90% floor.
- [x] R2. **shipinhao audio flow** — `plugins/publishings/shipinhao-pub/src/audio-flow.ts` is at 86.67% funcs / 100% lines: one function is never called by its test. Cover it or delete it if it is dead.
- [x] R3. **Gate evidence** — `spur task gate --wbs <new>` (qualityGateCmd set) reports no coverage shortfall, so `spur task gate` for any unrelated task stops failing on these two rows (`scanCoverageShortfalls` flags every below-floor row in the log, not only changed files).

### Acceptance Criteria

```gherkin
Scenario: AC1 — threads-pub post rail clears the per-file floor (req: R1)
  ac_altitude: task-local
  ac_numbering: AC1
  Given the full `bun run test` coverage table
  Then `plugins/publishings/threads-pub/src/post-rail.ts` reports funcs >= 90% and lines >= 90%

Scenario: AC2 — shipinhao audio flow clears the per-file floor (req: R2)
  ac_altitude: task-local
  ac_numbering: AC2
  Given the full `bun run test` coverage table
  Then `plugins/publishings/shipinhao-pub/src/audio-flow.ts` reports funcs >= 90% and lines >= 90%

Scenario: AC3 — the suite exits 0 with no per-file shortfall (req: R3)
  ac_altitude: task-local
  ac_numbering: AC3
  When `bun run test` runs on the tree
  Then it exits 0 and no file in the coverage table is below 90% funcs or lines
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [ ] 1. threads-pub fake-page suite (R1)
- [ ] 2. audio-flow uncovered function (R2)
- [ ] 3. Full gate run with no coverage shortfall (R3)

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Both gaps were closed by the channel fixes that landed before this task was picked up, so no new code was needed here:

| Gap | Closed by | Coverage (full suite, 2026-11-17) |
| --- | --- | --- |
| `plugins/publishings/threads-pub/src/post-rail.ts` | `d49f8b9b` fix(threads-pub) plus `plugins/publishings/threads-pub/tests/post-rail.test.ts` fake-page suite | 92.86% funcs / 100% lines |
| `plugins/publishings/shipinhao-pub/src/audio-flow.ts` | `0d51973e` test(shipinhao-pub): cover the audio flow's uncovered branches | 93.33% funcs / 100% lines |

R3 is proven by the full `bun run test` exit code, not by the pass count (bun prints `0 fail` even when a file is under the floor).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/threads-pub/tests/post-rail.test.ts:1` fake-page suite; full `bun run test` 2026-11-17: `plugins/publishings/threads-pub/src/post-rail.ts` 92.86% funcs / 100% lines |
| R2 | MET | `plugins/publishings/shipinhao-pub/tests/audio-flow.test.ts:1` (commit 0d51973e); full `bun run test` 2026-11-17: `plugins/publishings/shipinhao-pub/src/audio-flow.ts` 93.33% funcs / 100% lines |
| R3 | MET | `bun run test` 2026-11-17: exit 0, 5490 pass / 0 fail across 314 files, no file below 90% funcs or lines |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `bun run test` coverage row `plugins/publishings/threads-pub/src/post-rail.ts` 92.86 / 100.00 |
| AC2 | MET | command | `bun run test` coverage row `plugins/publishings/shipinhao-pub/src/audio-flow.ts` 93.33 / 100.00 |
| AC3 | MET | command | `bun run test` exit 0; awk scan of the coverage table found no row under 90 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-17T17:50:17.560Z todo → wip (system)
- 2026-11-17T17:50:18.338Z wip → testing (system)
- 2026-11-17T17:50:32.622Z testing → done (system)

