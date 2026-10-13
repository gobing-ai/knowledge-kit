---
schema_version: 1
name: Make a failed safety reviewer reach the gate instead of aborting the nested run
status: done
template: issue
created_at: 2026-10-12T23:05:01.855Z
updated_at: "2026-10-13T19:19:32.480Z"
feature_id: G11

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0270-verdict.json
---

## 0270. Make a failed safety reviewer reach the gate instead of aborting the nested run

### Background

The voice2 daily DAG's `safety` node (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:484`) shells out the nested content-safety state machine (`spur workflow run plugins/kk/workflows/kk-daily-safety.yaml`, `kk-daily-ai-voice2.yaml:502`). Inside that machine, the `review` state runs the kk:content-safety reviewer via `agent.run` with `expectFile ${vars.work_dir}/24-script/${vars.run_date}_09_safety-review_report.json` and NO `onError` (`plugins/kk/workflows/kk-daily-safety.yaml:51-61`), and the `judge` state's independent re-check runs with `expectFile …_09_safety-judge_verdict.json`, also without `onError` (`kk-daily-safety.yaml:67-77`).

Engine semantics (installed `@gobing-ai/ts-dual-workflow-engine` 0.5.24, `src/state-machine.ts:143-145`): an onEnter action that fails under the default `'fail'` policy halts the loop — `enter.outcome === 'fail'` → `lifecycle.fail(current.id, …)`. So a failed reviewer — an executor error, or the 0238-style stochastic no-op that exits 0 without writing its expected file — fails the nested run AT the `review` (or `judge`) state. The `review → judge` transition never evaluates, and `kk stage daily-safety-gate` (`plugins/kk/scripts/daily-stages.ts:1701`, dispatched at `kk-daily-safety.yaml:79-84`) never runs: the gate that owns classification is skipped by the very failure it exists to classify.

The gate is already built to classify exactly these shapes fail-closed: a missing report reads as `malformed` → `block` "content-safety report missing or malformed" (`daily-stages.ts:1778-1780`), and a missing verdict reads as out-of-contract → `block` naming `verdict missing` and `verdict confidence missing (no confidence contract: need HIGH/MEDIUM/LOW)` (`daily-stages.ts:1745-1760`, reason built at `:1785-1800`) — both pinned by `plugins/kk/tests/kk-workflow-stages.test.ts:411-436` ("missing verdict" / "missing report" → block, no stamp). The workflow's own description promises "this run exits non-zero only on a block or an integrity failure" (`kk-daily-safety.yaml:10-13`) — a reviewer abort violates that contract: the run exits non-zero on an agent error, with no classification.

What the operator loses today: the nested run dies with an engine-level failure at phase `review`/`judge` carrying the raw agent error, instead of ending in the designed `block` failure state via the unconditional `judge → block` edge with `terminalReason: failed-check` (`kk-daily-safety.yaml:135-141`). No `24-script/<date>_09_safety-judge_status.txt`, no stamp, and no `.quarantine-<date>-judge-block` draft quarantine (`daily-stages.ts:1840-1855`) — the block-only quarantine that stops a same-day retry replaying on poisoned cached drafts (20261002 dogfood). In the run trace the abort is indistinguishable from an infrastructure crash, and the reason never names what the gate would have said. The parent outcome is the same either way and stays correct: the DAG is fail-fast and the `safety` node carries no `onError` (`kk-daily-ai-voice2.yaml:484-506`), so a non-zero nested exit — abort or classified block alike — fails the daily run, which is the intended "non-zero = never publish". What differs is classification, artifacts, and recovery. The `revise` state already demonstrates the fix's shape: its agent.edit carries `onError: continue` with "A failed edit must not kill the run … the loop converges on re-review either way" (`kk-daily-safety.yaml:91-94`); the two reviewer steps were simply never given the same policy.

### Requirements

- [x] R1. When the safety sub-workflow's content-safety reviewer fails to produce its report — an executor error, or a run that exits without writing the expected report file — the nested safety run still advances to the judge state and its gate runs; it does not abort at the review state.
- [x] R2. When the safety sub-workflow's judge re-check fails to produce its verdict (same failure shapes), the nested run still reaches and runs the safety gate; it does not abort at the judge state.
- [x] R3. A reviewer failure is classified fail-closed by the gate exactly like a malformed artifact: the nested run ends in the `block` failure state ("never publish"), never in `clean`, and never routes to `revise` against an absent report or verdict.
- [x] R4. Genuine safety refusals keep refusing: an explicit FAIL or budget-exhausted NEEDS_REVISION, a PII block, an out-of-contract verdict, and a PASS whose confidence is missing or outside HIGH|MEDIUM|LOW (G11 R9) still block; nothing in this change may turn any refusal into a pass, an exclude, or an escalate.
- [x] R5. What the operator sees distinguishes a gate refusal from a crash: a reviewer-failure run ends with the gate's `block` status written to `24-script/<date>_09_safety-judge_status.txt`, no publish stamp, the reason line naming the missing artifact on the gate's stderr, and the drafts quarantined — the same surface every other integrity block produces.
- [x] R6. The parent daily DAG's contract is unchanged: a non-zero exit from the safety sub-workflow still fails the daily run at the safety node (never publish), and a passing gate still publishes as today.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a failed content-safety reviewer reaches the gate instead of aborting the nested run (req: R1)
  Given the nested kk-daily-safety state machine as authored in plugins/kk/workflows/kk-daily-safety.yaml, whose review state's agent.run expects ${vars.work_dir}/24-script/${vars.run_date}_09_safety-review_report.json
  When the reviewer fails to write that report (executor error, or an exit without the file)
  Then the review state's agent.run carries an onError continue policy so the state machine leaves review on its unconditional review → judge edge and the judge state's daily-safety-gate stage runs — verified by asserting the policy on the parsed workflow YAML (regression: fails before the change, the policy is absent today)

Scenario: AC2 — a failed judge re-check reaches the gate the same way (req: R2)
  Given the same state machine, whose judge state's agent.run expects ${vars.work_dir}/24-script/${vars.run_date}_09_safety-judge_verdict.json
  When the judge re-check fails to write that verdict
  Then the judge state's agent.run also carries an onError continue policy, so the gate stage that follows it in the same onEnter sequence still runs and classifies — verified on the parsed workflow YAML (regression: fails before the change)

Scenario: AC3 — the gate classifies a reviewer failure fail-closed, on the same surface as any integrity block (req: R3; R5)
  Given a prepared safety work dir whose request digest matches the drafts, with no safety-review_report.json on disk
  When kk stage daily-safety-gate runs
  Then it exits 0, writes safety-judge_status.txt = block, writes no safety-judge_stamp.json, prints its reason line naming the missing report, and quarantines the drafts — and the workflow's unconditional judge → block edge (terminalReason failed-check) then ends the nested run as a classified failure, never clean

Scenario: AC4 — a missing judge verdict blocks out-of-contract, never a pass (req: R3; R4)
  Given a prepared safety work dir with a valid all-OK report but no safety-judge_verdict.json
  When kk stage daily-safety-gate runs
  Then it writes block, names the missing verdict and the missing HIGH|MEDIUM|LOW confidence in its reason, and the judge → clean accept guard (confidence-aware jq read) does not match — a PASS-shaped refusal path stays refused, per G11 R9

Scenario: AC5 — no refusal is weakened: existing block rows and routing stay green (req: R4)
  Given the stage suite's existing fail-closed rows (missing verdict, missing report, FAIL verdict, PASS without confidence, out-of-enum confidence, BLOCK decision, unparsable verdict → block, no stamp)
  When the suite runs after the workflow change
  Then every row still blocks and the pass/escalate/exclude routes are unchanged — the change adds no fail-open

Scenario: AC6 — the parent daily run still treats a non-zero safety exit as never publish (req: R6)
  Given plugins/kk/workflows/kk-daily-ai-voice2.yaml's safety node after the change
  When the nested machine ends in block (classified) or fails any other way
  Then the safety node still carries no onError, so the fail-fast DAG fails the daily run at safety exactly as before, and a nested clean exit still lets the run proceed to operator review

Scenario: AC7 — the accept edge verifies the confidence enum on the real guard string (req: R4)
  Given the real judge → clean guard string executed out of plugins/kk/workflows/kk-daily-safety.yaml with a verdict fixture and a gate stamp on disk (the executeGuard pattern from verdict-confidence.test.ts, which today only byte-scans this guard)
  When the verdict is a PASS carrying confidence HIGH, MEDIUM, or LOW
  Then the guard matches clean — and a PASS whose confidence is missing, out-of-enum (SURE), lowercase (high), non-string (1), or empty string never matches: its refusal prints kk-daily-safety.judge.confidence-refused naming the offending shape, the first edge leaving judge is the unconditional judge → block, and the NEEDS_REVISION + exclude-stamp admission still reads through the same filter — every level is verified, no shape deadlocks or passes (G11 R9)
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-13T18:38:17.435Z

- D1 (closed) 2026-10-13 — The defect is the missing error policy on the two reviewer `agent.run` steps, not the gate: the gate already classifies a missing report (`malformed` → block) and a missing verdict (out-of-contract → block) fail-closed (`daily-stages.ts:1778-1800`), pinned by `kk-workflow-stages.test.ts:411-436`. The task therefore touches only `kk-daily-safety.yaml`; no stage-code change.
- D2 (closed) 2026-10-13 — Fix shape is `onError: continue` on both reviewer steps (the `revise` state's own pattern, `kk-daily-safety.yaml:91-94`), not a 0238-style `-retry` sibling: the 0238 siblings exist because the DAG has no classifier after a producer; here the gate IS the classifier and already refuses the absent artifact, so a second agent attempt would only delay the block and double agent spend.
- D3 (closed) 2026-10-13 — Both reviewer steps get the policy, not just `review`: a failed judge re-check aborts at `judge` today with the same loss (the gate shell in the same onEnter sequence never runs) — one root cause, one seam.
- D4 (closed) 2026-10-13 — Parent DAG untouched: the `safety` node stays fail-fast and "non-zero = never publish" is the intended contract; this task changes HOW the nested run fails (classified `block` with status/stamp-absence/quarantine artifacts) not WHETHER the daily run fails. Making the parent continue would fail open at the DAG level.
- D5 (closed) 2026-10-13 — The regression test is a workflow-YAML structural test in the `verdict-confidence.test.ts` pattern (parse the real YAML, assert authored policies, plus one stage-drive for the classification surface), because the bug is an authored-policy gap no runtime suite observes; slow end-to-end nested-run execution is not needed to prove it.
- D6 (closed) 2026-10-13 — The `# No onError: …` comment above the review agent.run (`kk-daily-safety.yaml:50`) is updated as part of the fix: it encodes the misconception ("the gate blocks on a missing file") that this task disproves — with no onError the gate never runs.

- D7 (closed) 2026-10-13 — Supervisor-directed verification addition (AC7/Plan step 2): the safety machine's `judge → clean` guard is fixture-executed with the full confidence matrix (HIGH/MEDIUM/LOW accepted; missing/SURE/high/1/"" refused by name, first passing edge `judge → block`), because `verdict-confidence.test.ts` covers itc/example/kk-collect guards with fixtures but only byte-scans `SAFETY_MACHINE`'s guard (it appears solely in producer/consumer scans) — the enum's accept-edge half was verified nowhere at this seam. No R-item added: R4 already states the rule; this is its missing test evidence.

### Design

Seam: `plugins/kk/workflows/kk-daily-safety.yaml` only — add `onError: continue` to the two reviewer `agent.run` actions: `review` (`kk-daily-safety.yaml:51`, expectFile `:61`) and `judge` (`:67`, expectFile `:77`), each with a one-line why-comment: a failed reviewer must reach the gate, which blocks fail-closed on the missing artifact. This mirrors the `revise` state's own pattern (`:91-94`). No stage code, no parent workflow, no prompt text changes.

Failure-classification rule: a reviewer failure is any agent.run outcome that leaves its `expectFile` absent — executor error or a 0238-style no-op exit. The gate already owns the classification for both shapes (missing report → `malformed` block, `daily-stages.ts:1778-1780`; missing verdict → out-of-contract block naming the missing verdict and confidence, `daily-stages.ts:1745-1760` + `:1785-1800`), pinned by `plugins/kk/tests/kk-workflow-stages.test.ts:411-436`. The change only stops the engine's default `'fail'` policy (`ts-dual-workflow-engine` `src/state-machine.ts:143-145`) from halting the loop before the gate runs.

Stays fail-closed: the `review` state's prep shell and the `judge` state's gate shell keep the default fail policy (deterministic stages; the gate exits 0 in all five outcomes by design and writes the status file); `expectFile` pins are untouched on both steps, so a no-op reviewer is still an error at the action level — merely a survivable one that the gate then refuses; the `judge → clean` confidence-aware accept guard and the unconditional `judge → block` catch-all are untouched.

Out of scope: the parent DAG (`kk-daily-ai-voice2.yaml:484-506` safety node stays fail-fast — a non-zero nested exit failing the daily run IS the never-publish contract); `daily-stages.ts` (no stage change); any change to verdict/report confidence contracts (G11 R9 is pinned, not reopened).

Tradeoffs rejected: (1) a 0238-style `-retry` sibling per reviewer — the gate is the classifier here and already refuses the absent artifact; a second agent attempt only delays the block and doubles agent spend; (2) teaching the gate to tolerate errors — it already exits 0 in every classification; (3) `onError: continue` on the parent safety node — that would fail open at the DAG level, letting publish proceed past safety.

### Plan

1. [x] Regression tests first: create `plugins/kk/tests/safety-reviewer-failure.test.ts` modeled on `verdict-confidence.test.ts`'s load/parse pattern (Bun.YAML.parse the REAL `plugins/kk/workflows/kk-daily-safety.yaml`, never copy its strings). Assert: (a) the `review` state's agent.run and the `judge` state's agent.run each declare `onError: continue` AND keep `expectFile` pinned on `…_09_safety-review_report.json` / `…_09_safety-judge_verdict.json` (AC1/AC2 — both assertions fail pre-change: the policy is absent); (b) the `judge → clean` guard still contains the confidence-aware `jq` read and `judge → block` is still unconditional (AC4 guard half); (c) the parent `kk-daily-ai-voice2.yaml` `safety` node's shell action carries no `onError` (AC6). Run `bun test plugins/kk/tests/safety-reviewer-failure.test.ts` — judge by pass/fail counts, not exit code (a lone file can exit 1 on the per-file coverage threshold, AGENTS.md).
2. [x] Confidence-level verification on the real accept guard (AC7): in the same file, execute the real `judge → clean` guard string with the `executeGuard`/`firstPassing` helpers' semantics from `verdict-confidence.test.ts` (scenario vars = the machine's own `vars` + a fixture work_dir/run_date; verdict fixture at `${vars.work_dir}/24-script/${vars.run_date}_09_safety-judge_verdict.json`, gate stamp at `…_09_safety-judge_stamp.json`). Matrix: PASS+HIGH / PASS+MEDIUM / PASS+LOW with a pass stamp → guard matches; PASS with missing / SURE / high / 1 / "" confidence → guard refuses with `kk-daily-safety.judge.confidence-refused` naming the offending shape on stderr, and `firstPassing(judge)` is `judge → block` (declaration-order evaluation; the revise edge needs safety_status=revise); NEEDS_REVISION + an exclude stamp → matches through the same confidence-aware filter. This closes the execution gap: `verdict-confidence.test.ts` only byte-scans this guard today (SAFETY_MACHINE appears solely in producer/consumer scans), while itc/example/kk-collect guards are fixture-executed. The gate-stage half of the enum is already pinned — `bun test plugins/kk/tests/kk-workflow-stages.test.ts` keeps green the enum-violation rows (PASS without confidence, unrecognized/lowercase/non-string/empty-string → block, `kk-workflow-stages.test.ts:419-423`) and the MEDIUM/LOW pass rows (`:424-427`).
3. [x] Stage-side fail-closed pin (AC3/AC4 evidence, no code change expected): in the same file, drive `kk stage daily-safety-gate` on two prepared temp dirs (pattern: `setup()` + `runStage()` from `kk-workflow-stages.test.ts:380-390`) — no report → status `block`, no stamp, reason line names the missing report, drafts moved into `.quarantine-<stamp>-judge-block`; no verdict (valid report) → status `block`, reason names `verdict missing` and the HIGH|MEDIUM|LOW confidence. Confirm the existing rows already pin the rest: `bun test plugins/kk/tests/kk-workflow-stages.test.ts` (the `missing verdict`/`missing report` → block-no-stamp rows at :411-436 and the quarantine row at :546 must stay green — AC5).
4. [x] The fix: edit `plugins/kk/workflows/kk-daily-safety.yaml` only — add `onError: continue` with a one-line why-comment to the `review` agent.run (`:51`) and the `judge` agent.run (`:67`), and update the stale `# No onError: …` comment that sits directly above the review agent.run (`:50`, Q&A D6) so it states the new policy intent. No other edits.
5. [x] Evidence: `bun test plugins/kk/tests/safety-reviewer-failure.test.ts` all green; `bun test plugins/kk/tests/kk-workflow-stages.test.ts` green; `bun test plugins/kk/tests/verdict-confidence.test.ts` green (the workflow scan half reads the edited YAML — its producer checks must still pass); `bun run lint` clean.
6. [x] Scope check: `git status --porcelain` shows only `plugins/kk/workflows/kk-daily-safety.yaml`, `plugins/kk/tests/safety-reviewer-failure.test.ts`, and this task file. Leave commit to the pipeline.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

- `plugins/kk/workflows/kk-daily-safety.yaml:51-54` — the review agent.run gains `onError: continue` with a why-comment; the stale `# No onError: …` comment above it (D6) is replaced by the new policy statement. A failed or no-op reviewer now leaves review on the unconditional review → judge edge instead of halting the loop, so the gate that classifies the missing report actually runs.
- `plugins/kk/workflows/kk-daily-safety.yaml:71-73` — the judge agent.run gains the same `onError: continue` policy (D3: one root cause, one seam), so a failed re-check no longer aborts at judge and the gate shell in the same onEnter sequence still classifies the missing verdict.
- `plugins/kk/tests/safety-reviewer-failure.test.ts:1-325` — new regression suite, written first (pre-change capture: 2 fail / 15 pass — both failures are the missing onError policies, `Expected: "continue" / Received: undefined`). Asserts on the parsed real YAML: AC1/AC2 both reviewer steps declare `onError: continue` and keep their expectFile pins, the deterministic shells keep the default fail policy, AC4 the judge → clean guard stays confidence-aware with judge → block unconditional (failed-check) in declaration order, AC6 the parent DAG safety node carries no onError and shells the nested machine. Executes the real judge → clean guard with the AC7 matrix (HIGH/MEDIUM/LOW and NEEDS_REVISION+exclude admitted; missing / SURE / lowercase / non-string 1 / empty-string / no-stamp refused by name, firstPassing(judge) = judge → block). Drives the real stage runner out of process on temp dirs for AC3/AC4: missing report → block, no stamp, reason names the report, drafts quarantined; missing verdict → block naming `verdict missing` and the HIGH/MEDIUM/LOW enum.

Engine-level public-surface probe (throwaway roots, no-op reviewer stub + real stage runner): pre-fix the run dies at review (`agent.run (pi) exited 0 but expected file is absent … review-partial.md`) with no gate artifacts; post-fix both no-op reviewers are survived, the gate writes `safety: status=block (content-safety report missing or malformed)`, the status file reads block, the drafts land in `.quarantine-<date>-judge-block`, and the run ends `failed: kk-daily-safety -> block — failed-check` (engine exit 1 — non-zero stays never publish).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-daily-safety.yaml:54` — review `agent.run` declares `onError: continue` (re-read this turn); test `plugins/kk/tests/safety-reviewer-failure.test.ts:102` asserts the policy on the parsed YAML and the `review -> judge` edge is unconditional |
| R2 | MET | `plugins/kk/workflows/kk-daily-safety.yaml:73` — judge `agent.run` declares `onError: continue`; test `plugins/kk/tests/safety-reviewer-failure.test.ts:117` |
| R3 | MET | missing report -> `malformed` block branch at `plugins/kk/scripts/daily-stages.ts:1779` (fires when `decisions.length === 0`, `:1751-1752`); missing verdict -> out-of-contract branch `plugins/kk/scripts/daily-stages.ts:1785-1795` naming `verdict missing` + the confidence enum; unconditional `judge -> block` edge `terminalReason: failed-check` at `plugins/kk/workflows/kk-daily-safety.yaml:158-165`. AC3/AC4 drive the real runner to status `block`, no stamp, quarantine |
| R4 | MET | no guard/stage logic changed (git diff = two `onError: continue` hunks only); 13 fail-closed rows green at `plugins/kk/tests/kk-workflow-stages.test.ts:410-430`; AC7 executes the real `judge -> clean` guard matrix at `plugins/kk/tests/safety-reviewer-failure.test.ts:167-274` |
| R5 | MET | `plugins/kk/scripts/daily-stages.ts:1835` writes the stamp only for pass/escalate/exclude, `:1837-1849` quarantines drafts on a block, `:1851` writes the status file; AC3/AC4 assert `status=block`, no stamp, reason line, quarantine |
| R6 | MET | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:484-505` — safety node action is `kind: shell` with no `onError`, shells `spur workflow run ...kk-daily-safety.yaml` at `:502`; test `plugins/kk/tests/safety-reviewer-failure.test.ts:152` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a failed content-safety reviewer reaches the gate instead of aborting the nested run (req: R1) | MET | test | `plugins/kk/tests/safety-reviewer-failure.test.ts:102` — asserts the review step's `onError === 'continue'` and its `expectFile` pin on the parsed real YAML; policy present at `plugins/kk/workflows/kk-daily-safety.yaml:54` |
| AC2 — a failed judge re-check reaches the gate the same way (req: R2) | MET | test | `plugins/kk/tests/safety-reviewer-failure.test.ts:117` — asserts the judge step's `onError === 'continue'` with its own `expectFile` pin; policy present at `plugins/kk/workflows/kk-daily-safety.yaml:73` |
| AC3 — the gate classifies a reviewer failure fail-closed, on the same surface as any integrity block (req: R3; R5) | MET | test | `plugins/kk/tests/safety-reviewer-failure.test.ts:303` — drives the real `daily-safety-gate` runner out of process; no report -> status `block`, no stamp, stdout names `content-safety report missing or malformed` (`plugins/kk/scripts/daily-stages.ts:1779`), drafts moved to `.quarantine-<date>-judge-block` |
| AC4 — a missing judge verdict blocks out-of-contract, never a pass (req: R3; R4) | MET | test | `plugins/kk/tests/safety-reviewer-failure.test.ts:316` — drives the runner; no verdict -> status `block`, stdout names `verdict missing` and `HIGH/MEDIUM/LOW` (`plugins/kk/scripts/daily-stages.ts:1785-1795`); `:140` pins the confidence-aware `judge -> clean` guard and unconditional block |
| AC5 — no refusal is weakened: existing block rows and routing stay green (req: R4) | MET | test | `plugins/kk/tests/kk-workflow-stages.test.ts:410-430` — 13 fail-closed rows (missing verdict/report, FAIL, PASS-without-confidence, out-of-enum/lowercase/non-string/empty-string confidence, BLOCK, unparsable) all -> block, no stamp; 55/55 green this run |
| AC6 — the parent daily run still treats a non-zero safety exit as never publish (req: R6) | MET | test | `plugins/kk/tests/safety-reviewer-failure.test.ts:152` — asserts the parent safety node's `onError` is undefined and it shells the nested machine; `plugins/kk/workflows/kk-daily-ai-voice2.yaml:484-505` |
| AC7 — the accept edge verifies the confidence enum on the real guard string (req: R4) | MET | test | `plugins/kk/tests/safety-reviewer-failure.test.ts:167-274` — executes the real `judge -> clean` guard string (parsed from `plugins/kk/workflows/kk-daily-safety.yaml:148`) over the full matrix: HIGH/MEDIUM/LOW admitted, missing/SURE/lowercase/non-string/empty-string + no-stamp refused by name (`kk-daily-safety.judge.confidence-refused`), `firstPassing(judge)` = `judge -> block` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0270

**Scope:** `plugins/kk/workflows/kk-daily-safety.yaml` (2 hunks — `onError: continue` on the `review` and `judge` `agent.run` steps plus why-comments) + new `plugins/kk/tests/safety-reviewer-failure.test.ts` (17 tests) + `docs/tasks/0270_make-a-failed-safety-reviewer-reach-the-gate-instead-of-abor.md`. Full-gate evidence verified, not re-run: `.spur/run/0270-test-gate.log` `bun run spur-check` exit 0, 2771 pass / 0 fail / 2 skip at proof-digest `sha256:3bd7119e…` (matches `.spur/run/0270-proofdigest.txt`).

**Dimensions:** functional, security, efficiency, correctness, usability, architecture

**Verdict:** PASS

**Confidence:** HIGH

**Why this level:** every requirement row is MET with repo-root-relative `path:line` evidence, the single finding carries a disposition, and the fail-closed chain was re-executed this run — 17/17 new tests, 55/55 stage rows (incl. the `kk-workflow-stages.test.ts:411-427` refusal/enum rows), 61/61 verdict-confidence rows green, plus a revert experiment that reproduced the pre-change 2-fail/15-pass capture and was fully reverted (`git status` shows only the three expected changes).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | security | No P1–P3 findings. Fail-closed change reviewed across all six dimensions: a failed/malformed/missing reviewer artifact now reaches the gate (both reviewer `agent.run` steps carry `onError: continue`) and the gate still blocks fail-closed — missing report → `malformed` block, missing verdict → out-of-contract block — with the confidence-aware `judge → clean` guard and the unconditional `judge → block` (`failed-check`) untouched. AC1–AC7 traceable and green; no existing refusal weakened. | `plugins/kk/workflows/kk-daily-safety.yaml:54` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-daily-safety.yaml:54` — review `agent.run` `onError: continue`; AC1 test `plugins/kk/tests/safety-reviewer-failure.test.ts:102` |
| R2 | MET | `plugins/kk/workflows/kk-daily-safety.yaml:73` — judge `agent.run` `onError: continue`; AC2 test `plugins/kk/tests/safety-reviewer-failure.test.ts:117` |
| R3 | MET | `plugins/kk/scripts/daily-stages.ts:1779` (missing report → `malformed` block) and `:1785-1800` (out-of-contract block); AC3/AC4 drive the real runner to `block`, no stamp, quarantine |
| R4 | MET | no guard/stage logic changed; `plugins/kk/tests/kk-workflow-stages.test.ts:411-427` (13 refusal rows + MEDIUM/LOW pass rows) green; AC7 executes the real `judge → clean` guard matrix `plugins/kk/tests/safety-reviewer-failure.test.ts:253-274` |
| R5 | MET | `plugins/kk/scripts/daily-stages.ts:1842-1855` (block writes status, no stamp, quarantines drafts); AC3/AC4 assert the exact surface |
| R6 | MET | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:484-506` safety node carries no `onError`; AC6 test `plugins/kk/tests/safety-reviewer-failure.test.ts:152` |

**Next:** no remediation required; record transcribes this review and the pipeline proceeds to verify.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-13T18:57:12.456Z todo → wip (system)
- 2026-10-13T19:19:20.091Z wip → testing (system)
- 2026-10-13T19:19:32.473Z testing → done (system)

