---
schema_version: 1
name: Make the full spur-check suite deterministic under load (module-store race and timing flakes)
status: todo
template: standard
created_at: 2026-10-13T18:57:36.022Z
updated_at: "2026-10-13T20:56:37.704Z"

ac_altitude: task-local
ac_numbering: task-local
feature_id: B6
priority: P2
estimate_hours: 2
---

## 0274. Make the full spur-check suite deterministic under load (module-store race and timing flakes)

### Background

The remaining issue is load-sensitive **fanin test design**, not a demonstrated mutation of the module store. Current `apps/cli/tests/fanin.test.ts` checks concurrency against a 1500ms total elapsed ceiling, and the override case requires an unrelated fast subprocess to finish within a 1000ms global budget. Both depend on host startup/scheduling latency. The override test also lacks a non-overridden slow sibling, so its title's “without touching siblings” claim is not fully asserted.

**Refine corrections (2026-10-13)**

- “A writer mutates node_modules/.bun” → no writer was established; commit `741a0cb5` moved stage AC4 bundling into a child process after observing the dependency path remain a regular file → drop the writer hunt, locking and read-retry solutions.
- “Stage AC4 still uses in-process Bun.build” → current `stage.test.ts:188` builds in a fresh child → remove this completed repair from requirements.
- “Fanout concurrency needs hardening” → current fanout tests assert overlapping/disjoint process intervals → retain those tests unchanged as precedent.
- “Environment inheritance is a remaining defect” → installed-board `childEnv()` already removes the nested workflow guard → remove it from remaining scope.
- “Five green full runs prove determinism” → finite repetitions cannot establish that claim and the current Bun baseline changed to 1.4.3 → use behavior assertions plus the normal full gate, rather than a mandatory five-run ritual.
- “Pitfalls recording is missing” → `.spur/context/pitfalls.md:41` already has the entry, but repeats the unproved writer diagnosis → correct that entry instead of adding another.

Audit at `a5e05542`, Bun 1.4.3. Targeted command `bun test --dots --timeout 20000 apps/cli/tests/fanin.test.ts apps/cli/tests/commands/stage.test.ts`: 41 pass, 0 fail; exit 1 is partial-run coverage, not an assertion failure. Log: `/tmp/kk-refine-0274-tests.log`. Historical full-suite incidents remain reports; they do not prove a current Bun 1.4.3 module-store race.

Feature B6 owns the remaining fan-in behavior tests. AC altitude is task-local because these are regression/test-quality criteria, not new B6 ship scenarios.


Ready evidence: `spur task check 0274 --as todo --json` and `spur feature check B6 --json` pass with zero findings. A scratch `bun -e` assertion verified scoped `spyOn(invoke, "spawnPluginEntryAsync")` captures `timeoutMs` and restores on Bun 1.4.3. Requirements, design, plan, AC, decisions, dependencies and premises pass the ready audit; backlog promoted to todo. Implementation and full-gate verification remain future task work.

### Requirements

- [ ] R1. Fan-in concurrency regression verifies that all source dispatches begin before any held source completes, without a narrow total-wall-clock ceiling; declaration-order output and provenance remain asserted.
- [ ] R2. Timeout precedence regression observes the exact `timeoutMs` passed to `spawnPluginEntryAsync` for the overridden source and at least two non-overridden siblings; explicitly prove override > global > default and that an override cannot leak to siblings. Include a timed-out non-overridden sibling with surviving documents and correctly attributed `sourceErrors`.
- [ ] R3. Retain real subprocess integration coverage for successful ingestion and actual timeout termination. Remove redundant narrow startup-sensitive assertions from the policy tests; do not weaken the real timeout behavior or alter production budgets.
- [ ] R4. Correct the existing task-0274 pitfalls entry to distinguish the child-build workaround already shipped from the remaining timing-test hazards; record the actual repro/verification command and limitations.

Scope: `apps/cli/tests/fanin.test.ts` and the existing `.spur/context/pitfalls.md` entry. Existing stage/fanout/installed-board tests are validation inputs, not repair targets. No production/API changes, dependencies, suite-wide timeout increase, retries, skipped tests or module-store mutation/locking mechanism.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Fan-in dispatch overlaps without an elapsed-time ceiling (req: R1)
  Given two fixture ingestion sources whose spawn results are held by test-controlled promises
  When runFanin starts
  Then both spawn calls are observed before either result is released
  And releasing results in reverse order still writes declaration-order documents and provenance

Scenario: AC2 — Per-source override does not alter sibling budgets (req: R2)
  Given one overridden source and two siblings with a global timeout
  When runFanin dispatches them through a scoped spawn spy
  Then the overridden call receives its override and both siblings receive the global value
  And one simulated timed-out sibling contributes only its own sourceErrors entry
  And the overridden source and successful sibling remain in the merged documents

Scenario: AC3 — Default timeout and tightening precedence remain exact (req: R2)
  Given sources without a global timeout and one lower per-source override
  When runFanin dispatches them
  Then the ordinary source receives the existing 30-minute default
  And only the overridden source receives the lower budget

Scenario: AC4 — Real subprocess behavior remains covered (req: R3)
  Given the existing real-ingestion and stuck-source integration fixtures
  When the focused fan-in tests and normal full test command run
  Then real output ingestion and actual timeout termination pass
  And no test is skipped and no production timeout is changed

Scenario: AC5 — Flake guidance describes the current tree (req: R4)
  Given the existing task-0274 pitfalls entry
  When its guidance is updated
  Then it names the shipped child-build workaround and remaining timing-test hazards
  And it does not claim an unidentified filesystem writer is established
```

AC1–AC4: `apps/cli/tests/fanin.test.ts`, production `runFanin` with the spy installed only at the existing async spawn boundary for policy tests; retain real-spawn tests for the behavior mocked there. AC5: inspect the existing pitfalls entry. Full verification: `bun run lint`, `bun run test`, `bun run build`; a partial test run's coverage exit must be reported separately from assertion failures.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T20:53:59.132Z

- Closed 2026-10-13: B6 is the owner after removal of the already-fixed build and environment issues; task-local regression altitude and numbering are deliberate.
- Closed: use Bun's existing `spyOn` and controlled promises at `spawnPluginEntryAsync`, not a new production injection API. Assert timeout arguments directly; that test does not claim to verify process killing.
- Closed: real-process timeout/invocation tests retain responsibility for termination and artifact ingestion. A green isolated run does not prove a full-suite flake is eliminated.
- Closed: no mandatory multi-run benchmark campaign, unidentified-writer search, reader retry or extra lock remains in this task.

### Design

**What/why/where.** Correct fan-in policy tests at `apps/cli/tests/fanin.test.ts` so the assertions distinguish dispatch policy from OS latency. No new production API or dependency. `runFanin` imports `spawnPluginEntryAsync` from `apps/cli/src/invoke.ts`; `collectSourceDocs` passes `pluginName`, `outPath` and `timeoutMs` and still validates the produced output. Reuse this existing boundary.

1. Install a scoped `spyOn` on the invoke module's `spawnPluginEntryAsync` export only within policy cases. Use real temporary plugin manifests/entry placeholders and inputs so discovery and validation remain exercised. The fake captures each call and its budget, writes valid `Doc[]` to that call's `outPath` for successes, and returns the real `PluginEntrySpawnResult` shape. For a timeout return `{exitCode: 1, stdout: '', stderr: '', timedOut: true}`. Always restore the spy and temporary paths in `finally`; do not use persistent `mock.module` replacement that could poison other files.
2. For concurrency, return held promises from the fake and signal a promise when both calls have arrived. Start `runFanin` without awaiting it; await both arrivals, release the second result then the first, then await the run. Assert call count before release and output/provenance order after release. The normal per-test watchdog catches a serial-dispatch regression; no 1500ms speed assertion is needed. Clean up/release outstanding promises even on assertion failure.
3. For override precedence, capture the exact map `{pluginName: timeoutMs}`. Test a global budget with one larger override, one ordinary success and one ordinary timeout; then no global with a smaller override and one default source (30 * 60 * 1000). Assert expected budgets, surviving docs and sourceErrors plugin/message. This fails if the override is removed, ignored, applied globally or the default changes unintentionally.
4. Keep real process ingestion and stuck-source timeout cases. The existing `--source-timeout` stuck fixture remains the actual kill check; policy tests must not pretend a mocked timeout verifies termination. Remove the redundant real-sleep override case after replacing its policy assertions. Keep generous real timeout watchdogs bounded and read any new failure rather than silently raising suite defaults.
5. Amend the existing pitfalls entry in place; it already exists and is gitignored. Preserve useful repro commands and distinguish old Bun observations from the current baseline.

Anti-patterns: no production refactor to facilitate mocks, no global mock contamination, no retries or skipped assertions, no returning documents directly in place of output-file validation. No process concurrency changes. No new CLI/doc surface, so no numbered design-doc edit is required.

Dependencies: none. No upstream output contract changes or dependent work required. Other listed tasks target different modules; 0248 owns production fanout deadlines and must not be folded here. Only main worktree exists; 0268 was wip during audit and does not own fan-in tests. Versions: package/lock pins Bun 1.4.3, Biome 2.5.15; use project scripts.

### Plan

- [ ] 1. Confirm the existing async spawn import can be scoped with Bun `spyOn`; add the controlled-result test setup locally with unconditional restore/cleanup. (R1, R2)
- [ ] 2. Replace the narrow concurrency stopwatch assertion with held-results dispatch/order/provenance assertions. (R1)
- [ ] 3. Replace the startup-sensitive override case with exact per-source budget mapping, timeout attribution and default/tightening tests; retain genuine real-spawn kill/invocation cases. (R2, R3)
- [ ] 4. Correct the already-existing pitfalls entry and its unproved writer diagnosis. (R4)
- [ ] 5. Run focused fan-in tests; record assertions separately from partial-run coverage exit. Run `bun run lint`, `bun run test`, `bun run build` and scoped task/rule checks; retain all failure details and fix regressions in scope. Confirm only intentional changes. (R1–R4)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/B6_sequential-fan-in-fan-out-steps.md`.
- `apps/cli/src/fanin.ts:311` — async spawn boundary; `apps/cli/src/fanin.ts:384` — timeout precedence.
- `apps/cli/tests/fanin.test.ts:426` — remaining elapsed ceiling; `:566` — startup-sensitive override case.
- `apps/cli/tests/commands/stage.test.ts:188`; commit `741a0cb5` — shipped child-process build workaround.
- `apps/cli/tests/fanout.test.ts:1342` — behavior/interval concurrency precedent.
- `.spur/context/pitfalls.md:41` — existing entry to correct during implementation.
- Task 0248 owns production fanout repair; no dependency or scope transfer.

### History

- 2026-10-13T20:54:23.040Z backlog → todo (system)

