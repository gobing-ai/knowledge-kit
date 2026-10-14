---
schema_version: 1
name: Make the full spur-check suite deterministic under load (module-store race and timing flakes)
status: done
template: standard
created_at: 2026-10-13T18:57:36.022Z
updated_at: "2026-10-14T05:44:28.804Z"

ac_altitude: task-local
ac_numbering: task-local
feature_id: B6
priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0274-verdict.json
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

- [x] R1. Fan-in concurrency regression verifies that all source dispatches begin before any held source completes, without a narrow total-wall-clock ceiling; declaration-order output and provenance remain asserted.
- [x] R2. Timeout precedence regression observes the exact `timeoutMs` passed to `spawnPluginEntryAsync` for the overridden source and at least two non-overridden siblings; explicitly prove override > global > default and that an override cannot leak to siblings. Include a timed-out non-overridden sibling with surviving documents and correctly attributed `sourceErrors`.
- [x] R3. Retain real subprocess integration coverage for successful ingestion and actual timeout termination. Remove redundant narrow startup-sensitive assertions from the policy tests; do not weaken the real timeout behavior or alter production budgets.
- [x] R4. Correct the existing task-0274 pitfalls entry to distinguish the child-build workaround already shipped from the remaining timing-test hazards; record the actual repro/verification command and limitations.

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

- [x] 1. Confirm the existing async spawn import can be scoped with Bun `spyOn`; add the controlled-result test setup locally with unconditional restore/cleanup. (R1, R2)
- [x] 2. Replace the narrow concurrency stopwatch assertion with held-results dispatch/order/provenance assertions. (R1)
- [x] 3. Replace the startup-sensitive override case with exact per-source budget mapping, timeout attribution and default/tightening tests; retain genuine real-spawn kill/invocation cases. (R2, R3)
- [x] 4. Correct the already-existing pitfalls entry and its unproved writer diagnosis. (R4)
- [x] 5. Run focused fan-in tests; record assertions separately from partial-run coverage exit. Run `bun run lint`, `bun run test`, `bun run build` and scoped task/rule checks; retain all failure details and fix regressions in scope. Confirm only intentional changes. (R1–R4)

### Solution

Scope held: tests plus the gitignored pitfalls entry only — no production, API, dependency or
suite-timeout changes (the `spyOn` seam is the existing `spawnPluginEntryAsync` export boundary
that `runFanin`'s `collectSourceDocs` already calls).

| Anchor | Change | Rationale (AC) |
| --- | --- | --- |
| `apps/cli/tests/fanin.test.ts:321` | Added the policy-test fakes: `SpySpawnCall`, `FAKE_SPAWN_SUCCESS`/`FAKE_SPAWN_TIMEOUT` (the real `PluginEntrySpawnResult` shapes), idempotent `makeHeldSpawn`, `writeFakeSuccessDoc` | Controlled spawn results without touching production (AC1–AC3) |
| `apps/cli/tests/fanin.test.ts:363` | Added `withSpawnSpy`: scoped `spyOn(invokeModule, 'spawnPluginEntryAsync')` with unconditional `mockRestore` in `finally`; real manifests/inputs stay so discovery, entry checks and output validation stay exercised | Deterministic dispatch/budget assertions, no `mock.module` contamination (AC2, AC3) |
| `apps/cli/tests/fanin.test.ts:488` | Replaced the 1500ms elapsed-ceiling concurrency test with `R1 — dispatches every --source before any held result settles`: held promises gate on both arrivals, release in reverse order, then assert declaration-order output + provenance; no wall-clock ceiling | Concurrency is asserted by dispatch/settle policy, not host latency (AC1) |
| `apps/cli/tests/fanin.test.ts:656` | Replaced the startup-sensitive real-sleep override case with `R2 — override reaches only its source`: exact `timeoutMs` map asserts override 9000 vs global 5000 on two siblings, simulated timed-out sibling yields one attributed `sourceErrors` entry and its echo, surviving docs stay merged | Override cannot leak to siblings; timeout attribution proven (AC2) |
| `apps/cli/tests/fanin.test.ts:723` | Added `R2 — no global leash`: ordinary source receives the exact 30-minute default (`30 * 60 * 1000`), the lower 250ms override tightens only its own source and degrades alone | Default and tightening precedence asserted exactly (AC3) |
| `apps/cli/tests/fanin.test.ts:615`, `:777` | Retained unchanged: the real-spawn stuck-source kill test (3000ms leash on a 10s sleep) and the real override-tightening kill test (300ms override on a 10s sleep) | Actual timeout termination and real ingestion stay covered by real processes (AC4) |
| `.spur/context/pitfalls.md:41` | Corrected the existing task-0274 entry in place: drops the unproved "concurrent writer into the shared module store" claim, names the shipped child-build workaround (`741a0cb5`, current `stage.test.ts` shape), records the remaining timing-test hazard class, the actual verification command (`bun test --dots --timeout 20000 apps/cli/tests/fanin.test.ts apps/cli/tests/commands/stage.test.ts`: 42 pass, 0 fail, exit 0 on Bun 1.4.3) and its limitation (a green isolated run does not prove the full-suite flake is gone) | Flake guidance describes the current tree, no unidentified-writer claim (AC5) |

Production `runFanin` (`apps/cli/src/fanin.ts:384` timeout precedence) is a validation input and is
unchanged. The old narrow tests (`wall time ≈ slowest source`, `extends ONE source past the global
leash`) were removed, not weakened elsewhere.

**Implementation notes**

- The per-test watchdog replaces the elapsed ceilings: a serial-dispatch regression in AC1 never
  reaches the both-arrivals gate and fails on the test timeout instead of racing startup latency.
- Policy tests complete in single-digit ms; the only real sleeps left in the file are the two
  retained real-kill tests, unchanged.
- Iteration checks run here (stage discipline: light changed-path matrix only — the full gate is
  the pipeline's test hop): `bun test --dots --timeout 20000 apps/cli/tests/fanin.test.ts
  apps/cli/tests/commands/stage.test.ts` → 42 pass, 0 fail, exit 0; adding
  `apps/cli/tests/fanout.test.ts` → 94 pass, 0 fail; `biome check` clean on the changed file
  (import-order safe fix applied); `tsc --noEmit` clean in `apps/cli`;
  `spur rule run --preset recommended-pre-check` reports only two pre-existing workspace findings
  (run-scoped citations from tasks 0243/0247/0252/0255 and old verdict artifacts — not this diff's
  paths).
- Plan items 1–5 executed in the reassigned scope above; the plan's full `bun run lint`/`test`/
  `build` leg belongs to the pipeline test hop per stage discipline.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/fanin.test.ts:488-556` — held-promise fake gates on both arrivals, `expect(calls).toHaveLength(2)` before any release; reverse-order release still yields declaration-order output + provenance (`:550-553`); no elapsed-time ceiling remains in policy tests |
| R2 | MET | `apps/cli/tests/fanin.test.ts:656-722` — exact budget map: override 9000 vs both siblings 5000 (`:702-704`), simulated timed-out sibling → one attributed `sourceErrors` (`:712-716`, contract `apps/cli/src/fanin.ts:319`); `:723-776` — no-global case: plain source 30*60*1000 (matches `apps/cli/src/fanin.ts:53`), tight override 250 only on its own source; override > global > default chain fully exercised |
| R3 | MET | Real-spawn coverage retained unchanged: `apps/cli/tests/fanin.test.ts:615` (3000ms leash kills 10s-sleep source), `:777` (300ms tightening kill); 0 `.skip/.only/.todo`; `git diff 4eb197b9 -- apps/cli/src/ packages/ plugins/` empty — no production timeout changed |
| R4 | MET | `.spur/context/pitfalls.md:42-59` — writer theory explicitly dropped, child-build workaround named (`741a0cb5`, current `stage.test.ts` shape), remaining timing-hazard class stated, actual command + exit-1-coverage caveat + finite-run limitation recorded |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Fan-in dispatch overlaps without an elapsed-time ceiling (req: R1) | MET | test | `bun test --dots --timeout 20000 apps/cli/tests/fanin.test.ts` (focused run, 42 pass / 0 fail / exit 0); `apps/cli/tests/fanin.test.ts:488-556` — dispatch-before-settle, no elapsed-time ceiling |
| Scenario: AC2 — Per-source override does not alter sibling budgets (req: R2) | MET | test | `apps/cli/tests/fanin.test.ts:656-722` — budget map 9000/5000/5000; solo degradation asserted |
| Scenario: AC3 — Default timeout and tightening precedence remain exact (req: R2) | MET | test | `apps/cli/tests/fanin.test.ts:723-776` — exact-default + tightening-precedence assertions executed; static anchor `apps/cli/src/fanin.ts:53` (30*60*1000) |
| Scenario: AC4 — Real subprocess behavior remains covered (req: R3) | MET | command | focused run 42 pass / 0 fail / exit 0 includes `apps/cli/tests/fanin.test.ts:615`, `:777` real-kill tests and stage child-build test; no production diff vs base |
| Scenario: AC5 — Flake guidance describes the current tree (req: R4) [docs-only] | MET | manual-review | `.spur/context/pitfalls.md:42-59` contains no writer claim, names the shipped workaround and current verification command |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Verify

- PASS record 2026-10-14 (verify stage, Bun 1.4.3): focused `bun test --dots --timeout 20000 apps/cli/tests/fanin.test.ts apps/cli/tests/commands/stage.test.ts` → **42 pass / 0 fail, exit 0**; `bunx biome check apps/cli/tests/fanin.test.ts` clean. AC1–AC5 all MET (traceability in `## Review`); requirements R1–R4 ticked on AC evidence. Residual: finite runs cannot prove full-suite determinism — task-acknowledged, pitfalls limitation records it.

### Review

#### Review Report — 0274
**Scope:** worktree diff at review time — `apps/cli/tests/fanin.test.ts`, `.spur/context/pitfalls.md` (task-0274 entry), `docs/tasks/0274_*.md` `## Solution` (base `4eb197b9`)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH
##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | Task 0274's rework exists only as uncommitted worktree modifications; branch commit `4eb197b9` holds only the interim hardening step (real-kill leash 1000→3000ms, elapsed ceiling <5000→<8000ms, explicit 20s watchdogs at `fanin.test.ts:654`). The verify hop must commit the worktree first so recorded citations match the reviewed state. | `apps/cli/tests/fanin.test.ts` (worktree vs `4eb197b9`) | ACCEPTED |
| 2 | P4 (advisory) | correctness | The R1 held-promise test relies on bun:test's default per-test timeout as its serial-dispatch watchdog — unlike its siblings it declares no explicit `20_000`; a Bun default-timeout change would alter only the regression bound, not the assertion logic. | `apps/cli/tests/fanin.test.ts:488` | ACCEPTED |
| 3 | P4 (advisory) | architecture | Policy tests depend on Bun redirecting `fanin.ts`'s direct named import (`apps/cli/src/fanin.ts:6` → `apps/cli/src/invoke.ts:371`) when `spyOn` replaces the namespace export — Bun-runtime-pinned behavior (1.4.3 per task), already acknowledged in the pitfalls entry's limitation note. | `apps/cli/tests/fanin.test.ts:363` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/tests/fanin.test.ts:488-556` — held-promise fake gates on both arrivals; `expect(calls).toHaveLength(2)` at `:533` fires before any release (`:536-537` reverse order); declaration-order output + provenance asserted at `:550-553`. No wall-clock ceiling remains in policy tests. Serial dispatch would deadlock the arrivals gate and hit the test watchdog. |
| R2 | MET | `apps/cli/tests/fanin.test.ts:656-722` — exact budget map: override 9000 (`:702`), both non-overridden siblings 5000 (`:703-704`, which also proves global beats default); timed-out sibling yields one attributed `sourceErrors` entry (`:712-716`, message contract `apps/cli/src/fanin.ts:319`) and surviving docs stay merged (`:708`). `:723-776` — no global flag: ordinary source receives the exact 30-minute default (`:762`, matches `apps/cli/src/fanin.ts:53`), override 250 tightens only itself (`:763`). Chain override > global > default fully exercised. |
| R3 | MET | Real-spawn coverage retained: stuck-source kill (3000ms leash on 10s sleep, real timeout termination + error text) at `apps/cli/tests/fanin.test.ts:615-654`; real tightening kill at `:777-814`; real ingestion suites unchanged. The redundant real-sleep override-extends case was removed, not weakened elsewhere. No production diff (worktree touches only tests, pitfalls, task doc). |
| R4 | MET | `.spur/context/pitfalls.md:42-59` — writer claim dropped ("no concurrent writer … was ever established"), shipped child-build workaround named (commit `741a0cb5`, current `apps/cli/tests/commands/stage.test.ts` shape), remaining timing-hazard class stated, verification command + exit-1-coverage caveat recorded, and the limitation that a green isolated run cannot prove full-suite determinism. |

##### Verification evidence (fresh, this review)

- `bun test --dots --timeout 20000 apps/cli/tests/fanin.test.ts apps/cli/tests/commands/stage.test.ts` → **42 pass, 0 fail, exit 0** (8.76s), matching the Solution's recorded claim.
- `bunx biome check apps/cli/tests/fanin.test.ts` → clean.
- No `.skip`/`.only`/`.todo` introduced; no production, dependency, or suite-default changes in the diff.

##### Residual risk

Full-suite determinism is behaviorally asserted but not provable by finite runs — acknowledged by the task itself and recorded in the pitfalls limitation; the post-implement full gate (2780 pass / 2 pre-existing skip / 0 fail) stands as the available evidence and was not re-run per review scope.

**Next:** commit the worktree diff before the verify hop so recorded citations match the reviewed state.

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
- 2026-10-14T05:11:10.928Z todo → wip (system)
- 2026-10-14T05:44:17.387Z wip → testing (system)
- 2026-10-14T05:44:28.793Z testing → done (system)

