---
schema_version: 1
name: Retry a transient image-gen failure instead of losing the whole XHS card series
status: done
template: issue
created_at: 2026-10-12T23:05:01.141Z
updated_at: "2026-10-13T21:57:26.785Z"
feature_id: G11

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0269-verdict.json
---

## 0269. Retry a transient image-gen failure instead of losing the whole XHS card series

### Background

The 2026-10-12 voice2 run lost its Xiaohongshu card series after an image-gen failure that did not contain the composer's safe-area overflow sentence. The owning seam is `daily-xhs-render` in `plugins/kk/scripts/daily-stages.ts`: the stage captures the child result, distinguishes a rewritable `points[n]` overflow from another failure, and decides whether to spend another card render.

Current-tree audit (2026-10-13): `daily-stages.ts` now retries a failure with no recognized overflow exactly once using the unchanged `card-<index>.in.json` envelope. `apps/cli/tests/kk-workflow-stages.test.ts` has one recovery case and one persistent-failure case that assert the per-card call count, byte-identical envelopes on the same-envelope retry, successful packaging, and the existing resume path. The retry is deliberately stage-owned; `plugins/generations/image-gen/src/index.ts` retains provider fallback/strict behavior and has no same-provider retry loop.

**Refine corrections (2026-10-13)**

- 0273 claimed that `plugins/generations/image-gen/src/index.ts` still had a per-provider retry budget whose counter was not assertion-pinned. Commit `142c4397` removed that plugin-side retry in favor of the stage-level implementation, so the claimed `retries = 0` residual and its strict-mode budget variant are no longer current defects. 0273 is cancelled for that reason.
- 0273's valid intent — keep the retry budget observable and bounded — belongs to this task's stage contract. The current recovery and persistent-failure tests provide part of that evidence; the requirements below also freeze per-card reset and mixed-budget coverage so a future refactor cannot silently remove the bound.

Scope is the stage-level XHS card retry and its regression tests. Provider classification, provider fallback order, and a new image-gen API are outside this task.

### Requirements

- [x] R1. When image-gen fails for an XHS card without a recognized `points[n]` safe-area overflow and the shared `XHS_OVERFLOW_ATTEMPTS` loop still has budget, `daily-xhs-render` retries that same card once with the unchanged input envelope before stopping.
- [x] R2. The same-envelope retry is per card and bounded by the shared `XHS_OVERFLOW_ATTEMPTS` retry budget: overflow rewrites and the non-overflow retry consume the same loop budget, a successful retry lets the series continue, and no retry occurs after the shared cap is exhausted.
- [x] R3. The existing overflow rewrite behavior remains separate: recognized in-range `points[n]` overflows still use the bounded shortening/drop path, and non-`points[n]` or malformed overflow messages are treated as non-overflow failures.
- [x] R4. Regression tests observe the child invocation seam and assert the retry count, unchanged envelope for the non-overflow retry, successful package output, and persistent-failure stop behavior.
- [x] R5. The retry guard is initialized per card: when two different cards each fail once without an overflow marker, each card receives exactly one unchanged-envelope retry and both cards are packaged.
- [x] R6. A mixed overflow/non-overflow sequence obeys the same shared cap and precedence: recognized point rewrites retain their existing behavior, and a later non-overflow failure receives a same-envelope retry only while a loop attempt remains.

Out of scope: provider-level retries in `plugins/generations/image-gen`, provider error classification changes, new workflow flags, and live Xiaohongshu publishing.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a non-overflow card failure recovers with one unchanged-envelope retry (req: R1, R2, R4)
  Given the image-gen child fails the first card invocation with `provider timeout` and succeeds on the second
  When `daily-xhs-render` runs
  Then the first card input is invoked twice, the two captured input envelopes are byte-identical, and the XHS package is written

Scenario: AC2 — a persistent non-overflow failure is bounded and resumable (req: R2, R4)
  Given every invocation for one card fails without a recognized overflow message
  When `daily-xhs-render` runs
  Then that card is invoked exactly twice, the stage exits with the child failure status, emits the existing resume message, and does not write the completed card package

Scenario: AC3 — overflow handling keeps its existing bounded rewrite contract (req: R3, R6)
  Given the child reports an in-range `points[n]` safe-area overflow
  When `daily-xhs-render` retries the card
  Then it rewrites only the named point values according to the existing shortening rules and does not classify the failure as the same-envelope provider retry

Scenario: AC4 — the same-envelope budget resets for each card (req: R2, R4, R5)
  Given two XHS cards each fail once without a recognized overflow message and then succeed
  When `daily-xhs-render` runs
  Then each card is invoked exactly twice, each card's two envelopes are byte-identical, and both cards are packaged

Scenario: AC5 — mixed overflow and provider failure share the loop cap (req: R2, R3, R6)
  Given one card first reports a rewritable `points[n]` overflow and then reports a non-overflow provider failure
  When the remaining `XHS_OVERFLOW_ATTEMPTS` budget is one or more
  Then the stage performs the existing point rewrite and at most one unchanged-envelope retry within the shared cap
  And when the cap is exhausted it stops through the existing resume path without an additional same-envelope call
```

### Q&A

#### Closed decision — retry ownership
The stage owns the retry because it can read the child stderr and knows whether the card envelope was rewritten. `kk()` remains inherited-stdio for other callers; the XHS loop uses its existing capture seam.

#### Closed decision — no provider classification
The observed failure included vendor-fallback wording that is not a reliable transient/permanent classifier. Any failure without a recognized overflow marker receives one bounded same-envelope retry while the shared loop budget remains; a permanent failure costs one extra card render and then stops.

#### Closed decision — 0273 residual disposition
The old plugin-level retry residual was audited against HEAD and removed from scope after `142c4397` reverted that implementation. The valid bounded-retry assertion is merged here through R2/R4/R5/R6; no plugin-side retry code or test is to be added.

### Design

Keep the fix in `plugins/kk/scripts/daily-stages.ts` at the existing `dailyXhsRender` image-gen loop. Reuse `kkCaptured`, `xhsOverflowPoints`, `reduceOverflowingPoints`, `XHS_OVERFLOW_ATTEMPTS`, and the existing `card-<index>.in.json` envelope. Add no public flag or image-gen provider API.

For each card, run the existing first child call. While it is non-zero and the existing loop budget remains, parse stderr with `xhsOverflowPoints`:

1. A valid in-range `points[n]` result follows the existing rewrite path, writes the same envelope shape with shortened points, and calls image-gen again.
2. `null` (no marker, a non-`points[n]` field, or an out-of-range index) uses a per-card `transientRetryUsed` guard. The first such failure invokes image-gen again without rewriting the envelope; the next such failure exits through the existing resume path.

The shared `XHS_OVERFLOW_ATTEMPTS` loop bound remains the hard spend limit for both overflow rewrites and the same-envelope retry. A `null` parse result may retry only when the current loop iteration has budget; if the cap was consumed by earlier rewrites, the stage exits through the existing resume path. Do not classify provider errors, move the retry into `plugins/generations/image-gen`, or rewrite headline/non-`points[n]` fields. Do not add a third same-envelope attempt. Tests belong beside the current XHS stage cases in `apps/cli/tests/kk-workflow-stages.test.ts`; snapshot every child input before the fake mutates the in-place envelope, make the fake fail once per input path to prove the guard resets inside the per-card loop, and add a mixed overflow/non-overflow sequence to prove the shared cap precedence.

### Plan

1. Re-read `dailyXhsRender`, `kkCaptured`, `xhsOverflowPoints`, and the current XHS fake to confirm the stage-level retry and loop bound still match this design.
2. Keep or add the recovery test for one non-overflow failure followed by success; assert two calls for the same card, byte-identical envelopes, and `cards.json`/`content.json` output.
3. Keep or add the persistent-failure test; assert exactly two calls, the child status and resume line, and no completed package.
4. Add a two-card flaky case whose fake fails once per input path; assert each card has exactly two calls, unchanged retry envelopes, and both cards are packaged, proving `transientRetryUsed` is per card.
5. Add a mixed sequence with overflow rewrites followed by a non-overflow failure; assert the same shared `XHS_OVERFLOW_ATTEMPTS` cap prevents an extra same-envelope call after exhaustion.
6. Run the focused stage test. If the implementation is already unchanged and the recovery/bound cases pass, make no production edit; this task is ready for implementation/verification handoff.

### Root Cause

Before the fix, `dailyXhsRender` stopped on every child failure unless stderr named a safe-area overflow. The observed provider flake therefore stopped the series even though rerunning the saved envelope succeeded. The stage's inherited-stdio child runner also meant the decision had to be made at the capture seam, not inside the image-gen provider contract. The current root cause is closed by the one guarded same-envelope retry in `plugins/kk/scripts/daily-stages.ts`; the 0273 plugin-level counter finding does not apply after `142c4397`.

### Solution

The current production change remains at the stage layer (`plugins/kk/scripts/daily-stages.ts:2559-2590`):

- `plugins/kk/scripts/daily-stages.ts` uses `xhsOverflowPoints` to preserve the existing overflow rewrites, and for a `null` result retries the same envelope once behind `transientRetryUsed`; a second non-overflow failure falls through to the existing resume failure.
- `apps/cli/tests/kk-workflow-stages.test.ts:1806-1842` asserts recovery, byte-identical envelopes, persistent-failure call bound, resume output, and package absence/presence as appropriate. Add the per-card two-flake case from R5 beside these tests; it must falsify any guard moved outside the card loop.

This is the corrected disposition of 0273: its obsolete plugin-level solution is dropped, while its valid bounded-observability concern is frozen in R2/R4/R5/R6 and AC2/AC4/AC5 here.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:1806-1847` recovery + persistent-failure cases assert one unchanged-envelope retry and the bounded stop; suite result this run: 4 pass / 0 fail |
| R2 | MET | `plugins/kk/scripts/daily-stages.ts:2424` shared `XHS_OVERFLOW_ATTEMPTS = 3`; per-card `transientRetryUsed` guard re-read at `plugins/kk/scripts/daily-stages.ts:2568-2576` |
| R3 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:1886-1929` — rewrite branch separate: shortened `points[1]`, preserved `points[0]`, retry reuses rewritten envelope byte-for-byte |
| R4 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:1849-1884` — child-invocation seam observed via argv record + per-call input snapshots; exact call counts asserted |
| R5 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:1849-1884` — both cards flake once, 2 invocations each, per-card snapshot byte-identity, cards + content packaged |
| R6 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:1886-1929` (3 calls: rewrite + provider-failure retry) and `:1931-1995` (cap exhaustion: exactly 4 calls, sentinel denies 5th, resume path, no content) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — a non-overflow card failure recovers with one unchanged-envelope retry (req: R1, R2, R4) | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:1806-1847` |
| Scenario: AC2 — a persistent non-overflow failure is bounded and resumable (req: R2, R4) | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:1806-1847` |
| Scenario: AC3 — overflow handling keeps its existing bounded rewrite contract (req: R3, R6) | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:1886-1929` |
| Scenario: AC4 — the same-envelope budget resets for each card (req: R2, R4, R5) | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:1849-1884` (falsifier: guard-hoist mutation red, reverted) |
| Scenario: AC5 — mixed overflow and provider failure share the loop cap (req: R2, R3, R6) | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:1886-1929` + `:1931-1995` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**2026-10-13 review (run b8059a06, dev-runall-0269-0270-0272-43ce, profile=auto)**

Confidence: HIGH

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | architecture | `apps/cli/tests/kk-workflow-stages.test.ts:1849-1995` | The three new 0269 cases repeat the fake-kk script scaffolding; consistent with the file's existing per-case house pattern — no action. |

Functional traceability (requirements → evidence, re-read this run):

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:1806-1847` — pre-existing recovery + persistent-failure cases assert one unchanged-envelope retry and the bounded stop (4/4 suite pass this run: 4 pass, 0 fail, 25 expect) |
| R2 | MET | `plugins/kk/scripts/daily-stages.ts:2424` — shared `XHS_OVERFLOW_ATTEMPTS = 3`; per-card `transientRetryUsed` guard ~2568-2576 (audit + falsifier: hoisting the guard outside the card loop turned the R5 case red, then reverted byte-identical) |
| R3 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:1886-1929` — overflow rewrite branch kept separate: `readPoints(.2)` differs from `.1`, `points[0]` preserved, provider retry reuses the rewritten envelope byte-for-byte |
| R4 | MET | tests observe the child invocation seam (`fakeKk` shim records argv, snapshots `--in` per call): retry counts asserted with exact `toHaveLength` bounds; package output + resume-path stop asserted |
| R5 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:1849-1884` — both cards flake once; per-card 2 invocations; per-card snapshot byte-identity; `cards.json` + `content.json` packaged |
| R6 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:1886-1929` (mixed: 3 calls, "retrying the same envelope once") and `:1931-1995` (exhaustion: 4 truncatable points, cap 3 ⇒ exactly 4 calls, sentinel denies a 5th, status 1 + resume message, no `content.json`) |

SECUA review of the diff (tests-only, +157/−2): Security — no secrets, no untrusted input handling added. Efficiency/Usability — no production surface change. Correctness — call-count sentinels are exact (`toHaveLength(3)` / `(4)`); snapshot suffix strips `.in.json` before naming per-card captures. Architecture — tests observe the established child-process seam; no new modules or coupling. No open P1–P3 findings.

Verdict basis: full quality gate PASS at digest `sha256:2c53bc5cbab0b3db462d3243524b14fc10f929f0edd3e542ac1abc1a4dfe18d3` (proof bracket held at review entry); AC1–AC5 map to the four 0269 tests, all passing this run.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-13T21:32:35.195Z todo → wip (system)
- 2026-10-13T21:56:52.706Z wip → testing (system)
- 2026-10-13T21:57:26.685Z testing → done (system)

### Notes

**2026-10-13 inline-full run (dev-runall-0269-0270-0272-43ce)**

- Implemented host-inline. Audit + falsifier confirmed the production seam in `plugins/kk/scripts/daily-stages.ts` already satisfies AC1–AC4 (`XHS_OVERFLOW_ATTEMPTS = 3`, per-card `transientRetryUsed`, shared loop cap).
- Delta = three regression tests in `apps/cli/tests/kk-workflow-stages.test.ts`: (R5) per-card same-envelope retry budget, both cards flake once and recover — falsifies a guard hoisted outside the card loop; (R6a) mixed sequence points-overflow rewrite then provider failure inside the one shared cap, per-snapshot envelope byte-identity; (R6b) cap exhaustion by rewrites stops through the resume path with no extra call (sentinel denies a fifth invocation).
- Production file untouched; `git diff --stat` = tests only (+135).

