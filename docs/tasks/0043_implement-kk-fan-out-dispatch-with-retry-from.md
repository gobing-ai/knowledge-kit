---
template: feature-impl
schema_version: 1
name: "Implement kk fan-out dispatch with retry-from"
description: ""
status: done
type: task
profile: standard
feature_id: B6
parent_wbs: null
priority: P2
tags: ["cli", "fan-out", "B6"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T05:18:46.317Z"
updated_at: "2026-08-12T06:44:00.126Z"
---

## 0043. Implement kk fan-out dispatch with retry-from

### Background

B6 — kk fanout: 1 content.json → N publish targets, aggregate Result with per-target status, exit non-zero on partial failure; --retry-from result.json re-dispatches only prior failures. Spec: docs/design/fan-in-and-fan-out-specification.md §1.3, §3 (aggregate Result schema), §4 (exit-code contract), §5 (retry). Implements: Fan-out reports per-target outcomes; Retry targets only prior failures. Rejected split: separate retry-from task — same CLI file, same review gate, flag-level feature (child rubric would be 4, optional). Rubric: E3 D1 L1 C1 R1 = 7 → decompose (parent 9).

### Requirements
- [x] R1. `kk fanout` dispatches one content.json to N publish targets, writing an aggregate Result with one per-target entry and per-target status; failed targets marked failed; non-zero exit on partial failure, zero on full success.
- [x] R2. `kk fanout --retry-from result.json` reads a prior result and dispatches only the previously failed targets.
### Acceptance Criteria

```gherkin
Feature: kk fanout dispatch with retry-from

  @core
  Scenario: R1 — Fan-out reports per-target outcomes
    Given one content.json and five publish targets where two fail
    When `kk fanout --content content.json --target ... --out result.json` runs
    Then result.json records five per-target entries with two marked failed
      And the process exits non-zero

  @core
  Scenario: R2 — Retry targets only prior failures
    Given a result.json from a run with two failed targets
    When `kk fanout --retry-from result.json` runs
    Then only the two previously failed targets are dispatched
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: new `apps/cli/src/fanout.ts` command module (sibling of `invoke.ts`), registered in `cli.ts` as `kk fanout`. Dispatch iterates targets sequentially and aggregates per-target outcomes; target execution goes through the publish-harness transport abstraction (`@gobing-ai/publish-harness` fake transports) so tests exercise failures without real publishers.

- Result shape: aggregate Result per spec §3.1 — per-target entries with status, written to `--out`.
- Exit mapping per spec §4: any failed target ⇒ exit 1; all success ⇒ exit 0.
- `--retry-from`: parse prior result.json, filter to failed targets, re-dispatch only those (spec §5), write a fresh result with the retried set.
- Rejected: engine-level parallelism (deferred, ADR-007 R4) — dispatch is sequential by feature scope. Rejected: retrying all targets on failure — spec §5 says only prior failures.

Signatures: `fanout(content: Content, targets: Target[], dispatch: (t: Target) => Promise<ResultEntry>): Result` (pure-ish, transport injected), `selectRetryTargets(prior: Result): Target[]`, `runFanout(argv: string[]): Promise<number>`. Invariants: every target appears in the result exactly once per run; retry set is a subset of prior failures; exit code follows the §4 contract.

Impacted surfaces: `apps/cli/src/cli.ts` (registration), `apps/cli/src/fanout.ts` (new), `packages/publish-harness` transports (reuse), `packages/kk-core` Content/Result schemas (read-only reuse). Tests in `apps/cli/tests/fanout.test.ts`.

### Plan

1. Read spec §1.3, §3.1, §4, §5; confirm Content/Result schemas in `packages/kk-core` and transport API in `packages/publish-harness`.
2. Add `apps/cli/src/fanout.ts`: `selectRetryTargets` + dispatch loop + aggregate result writer + `runFanout` CLI wrapper (reads `--content`, `--target` list, writes `--out`).
3. Register `fanout` subcommand in `apps/cli/src/cli.ts` (sibling of `invoke`, ADR-006).
4. Write `apps/cli/tests/fanout.test.ts`: per-target outcomes, partial-failure exit code, retry-from filtering, all-pass exit zero, empty retry set (edge cases from spec §3–§5).
5. Smoke: fake transports — five targets, two failing → result with five entries, exit 1; `--retry-from` dispatches only the two.
6. `bun run lint` + full `bun test` green.

### Solution
## Changed (implement stage for 0043)

- `apps/cli/src/fanout.ts` (new) — `kk fanout` command module.
  - `fanout(content, targets, dispatch)` (fanout.ts:83) — sequential per-target dispatch
    aggregating one `TargetOutcome` per target (spec §3.1; shape at fanout.ts:21, fanout.ts:32);
    dispatch rejections and `ok:false` results are recorded as failed with the error; every
    target appears in the result exactly once per run.
  - `selectRetryTargets(prior)` (fanout.ts:134) — returns exactly the prior failed targets
    (spec §5); the retry set is always a subset of prior failures.
  - `runFanout(argv, deps?)` (fanout.ts:387) — CLI wrapper: parses
    `--content/--target/--out/--retry-from` (fanout.ts:256), validates ContentSchema
    (fanout.ts:139), writes the aggregate `Result` to `--out`. Exit codes per spec §4:
    0 all succeeded, 1 partial/total failure, 2 CLI/input error (malformed flags, invalid
    content, unresolvable publish plugin via fanout.ts:362). Default dispatch
    (fanout.ts:300-353) runs each target's publish plugin entry with the same `--in`/`--out`
    contract as `kk invoke`; `deps.dispatch` (fanout.ts:53) lets tests inject fake transports.
  - Retry (spec §5.1, fanout.ts:410-428): prior published/skipped targets are carried as
    `status: "skipped"` with their prior `url`/`id`; only prior failures (or
    still-unpublished `--target` names) are re-dispatched; a fresh aggregate is written.
- `apps/cli/src/cli.ts` — registered the `fanout` subcommand (cli.ts:78) as a sibling of
  `fanin` (ADR-006): repeatable `--target` collector (cli.ts:72), `--content`, `--out`,
  optional `--retry-from`; propagates non-zero exits (cli.ts:95).
- `apps/cli/tests/fanout.test.ts` (new) — 21 tests: per-target outcomes, partial-failure
  exit 1 + result shape, all-pass exit 0, dispatch-reject handling, retry-from dispatch
  subset (R2), skipped carry with url/id preservation, empty retry set, `--target`
  narrowing, usage/input-error exit 2, write failure, and real plugin-entry dispatch via a
  fake publish plugin (success, non-zero exit, wrong-kind rejection).
- `apps/cli/tests/cli.test.ts` — added `fanout` subcommand test (non-zero exit propagation).

Verification: `bun run typecheck` clean; `bun test` 59 pass / 0 fail (21 new fanout tests;
fanout.ts 91.6% lines / 95% funcs); end-to-end CLI smoke with a fake publish plugin:
`fanout` exit 0 with aggregate result, `--retry-from` carries published targets as skipped
and dispatches only prior failures.
### Testing
**Force re-verify (2026-08-11) — Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/fanout.ts:77-122` — sequential per-target dispatch, one `TargetOutcome` each, failures with error; `apps/cli/src/fanout.ts:58-70` — §3.1 aggregate; `apps/cli/src/fanout.ts:437-446` — write + exit 0/1; `apps/cli/src/cli.ts:77-103` — fanout + `--plugins-root`. Tests: `apps/cli/tests/fanout.test.ts:103-123,207-240,243-259`. Live partial: exit 1, summary {2,1,1,0}. |
| R2 | MET | `apps/cli/src/fanout.ts:128-130` — `selectRetryTargets` = prior failures only; `apps/cli/src/fanout.ts:408-427` — skipped carry + retry subset. Tests: `apps/cli/tests/fanout.test.ts:262-287,290-322,325-349`. Live: `--retry-from` re-dispatched only fail-pub, ok-pub skipped. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — Fan-out reports per-target outcomes | MET | test | `apps/cli/tests/fanout.test.ts:103-123` + `:207-240` — 5 targets, 2 failed, exit 1 |
| Scenario: R2 — Retry targets only prior failures | MET | test | `apps/cli/tests/fanout.test.ts:262-287` + `:290-322` + `:325-349` |
| Fan-out reports per-target outcomes | MET | command | Live CLI partial failure exit 1 with per-target entries (this run) |
| Retry targets only prior failures | MET | command | Live CLI `--retry-from` only re-dispatched prior failure (this run) |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
- Verification this run: `bun test` fanin/fanout/cli → 58 pass / 0 fail; `bun run lint` exit 0
- Artifact: `.spur/run/0043-verdict.json` (re-written this force re-verify)
- SECUA: no P1–P3 (prior P3s fixed: `--plugins-root` + write-failure exit 2); P4 minor only (tmp leak on non-zero plugin exit; N+1 discovery)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Usability | cli.ts:78-95, fanout.ts:387 | `kk fanout` CLI exposes no `--plugins-root`, unlike every sibling plugin-aware command (`invoke`, `plugins list`, `plugins doctor`); the runner hardcodes `./plugins` relative to CWD and the test-only `deps.pluginsRoot` cannot be set from the CLI. Verified: `kk fanout --plugins-root …` → commander "unknown option", exit 1. Add the option and thread it into `runFanout`. |
| P3 | Correctness | fanout.ts:420-427 | Output write failure returns exit 1, conflating a target-failure signal with an output I/O error under spec §4. `spur workflow` reads exit 1 as "some targets failed" when nothing was published and no result was written; the spec's exit-2 (CLI/Input Error) bucket fits a bad `--out` path better. Align or extend the exit-code contract. |
| P4 | Efficiency | fanout.ts:329, 332-344 | Temp-file leak: when a plugin writes its result file then exits non-zero, `pluginDispatch` throws at line 329 before the `rmSync(outTmp)` finally runs. Verified empirically — two `kk-fanout-*` files left in the OS tmpdir. Wrap spawn+parse in one try/finally. |
| P4 | Efficiency | fanout.ts:309, 349 | N+1 plugin discovery: `validateTargets` scans once, then `pluginDispatch` re-runs `discoverPlugins` per target. Hoist a single discovery into `runFanout` and pass it down. |
| P4 | Correctness | fanout.ts:165-241 | `readAggregateResult` validates shape but not consistency: `summary` counters vs `targets.length`, `ok` vs summary, and per-entry `ok` vs `status` are never cross-checked (e.g. `status:"published"` with `ok:false`, or `summary.total` ≠ targets length, pass). Self-generated results are consistent; only hand-edited priors misbehave. Low impact. |
| P4 | Architecture | fanout.ts:76-83 | `content` parameter is dead in `fanout()` (`void content;`) — the payload actually flows through the dispatch closure. Retained only to match the designed signature; drop it or pass content through dispatch explicitly. |
| P4 | Architecture | invoke.ts:90-99 vs fanout.ts:308-345 | Weak locality (C1): plugin-entry execution (resolve entry → spawn with `--in`/`--out` → parse `ResultSchema`) is duplicated between `invoke` and `fanout`'s default dispatch. Extract a shared `runPluginEntry` helper used by both. |

**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `fanout.ts:76-125` — sequential per-target dispatch, one entry per target, failures recorded with error; `fanout.ts:417-429` — aggregate written to `--out`, exit 0 all-success / 1 any failure; `fanout.test.ts:118-147` — 5 targets / 2 failed → exit 1, five entries; smoke: exit 0 all-success, exit 1 partial |
| R2 | MET | `fanout.ts:127-129` — `selectRetryTargets` returns exactly prior failures; `fanout.ts:165-241` — prior-result read+validate; `fanout.ts:390-418` — skipped carry with url/id, retry subset, fresh aggregate; `fanout.test.ts:186-215` — retry dispatches only `['qiita','devto']`; smoke: `--retry-from` derived failures and re-dispatched only the failed target |

**Acceptance Criteria**

| AC | Status | Evidence |
| --- | --- | --- |
| Scenario: R1 — Fan-out reports per-target outcomes (5 targets, 2 fail → 5 entries, 2 failed, non-zero exit) | MET | `fanout.test.ts:118-147` (exit 1, 5 targets, 2 failed) + CLI smoke exit 1 with aggregate result |
| Scenario: R2 — Retry targets only prior failures | MET | `fanout.test.ts:186-215` (called == qiita/devto only) + `fanout.test.ts:227-247` (explicit `--target` narrowing) + `fanout.test.ts:264-285` (empty retry set) + CLI smoke |

**Design conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Sequential dispatch DONE (fanout.ts:86); §3.1 result shape DONE; §4 exit mapping DONE except write-failure path → 1 (P3 finding, deviation not noted in Solution); §5 retry-from DONE; signatures DONE (`content` param dead, P4); rejected parallelism/retry-all respected; invariants hold |

**Verification (run this review, 2026-08-11)**

- `bun test tests/fanout.test.ts tests/cli.test.ts` → 40 pass / 0 fail (257ms)
- `bun run typecheck` (apps/cli) → exit 0
- CLI smoke with fake publish plugins: all-success exit 0 with aggregate result; 2-target partial failure exit 1 (one published, one failed); `--retry-from` without `--target` re-dispatched only the failed target, carried the published one as `skipped` with url/id preserved, exit reflected the new aggregate (1 when retry failed again)

**Disposition**

Functional Verdict: PASS — R1/R2 MET, both core AC scenarios MET, design conformance pass (one P3 exit-code deviation).

SECUA Verdict: PASS with findings — no P1/P2; two P3 (missing `--plugins-root` CLI option, write-failure exit code) and four P4 (temp-file leak, N+1 discovery, prior-result consistency, dead `content` param); one advisory architecture candidate (C1: duplicated plugin-entry execution). None block the approve gate.
### References

B6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T05:54:02.506Z todo → wip (system)
- 2026-08-12T06:07:42.658Z wip → testing (system)
- 2026-08-12T06:07:50.821Z testing → done (system)
