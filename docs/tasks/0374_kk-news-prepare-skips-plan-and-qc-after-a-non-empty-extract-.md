---
schema_version: 1
name: kk news prepare skips plan and QC after a non-empty extract, so every generation settles no-content
status: wip
template: standard
created_at: 2026-11-15T19:02:56.385Z
updated_at: "2026-11-15T19:13:47.685Z"
parent_wbs: "0373"

ac_altitude: task-local
ac_numbering: task-local
---

## 0374. kk news prepare skips plan and QC after a non-empty extract, so every generation settles no-content

### Background

Observed on the production Mac mini (`mac.lan`, macOS 27.0.1, arm64) on 2026-11-15 while bringing the
G61 `kk news` verbs up under the launchd scheduler.

`kk news prepare` extracts a non-empty pool, then never runs `daily-plan` or `daily-qc-content`, and
the pool gate writes `EMPTY`, so every generation settles `no-content`.

Reproduction (90 s, no side effects beyond a scratch workspace):

```
mkdir -p .works/tmp/prepare-probe/20261115
kk news prepare --work-dir "$PWD/.works/tmp/prepare-probe/20261115" --run-date 20261115
```

Output:

```
preflight: stage runner advertises every stage kk-news-generate.yaml + kk-publish.yaml + kk-daily-safety.yaml invokes
5 probe(s) recorded for preflight
{"count":4}
extract: 24h pool 4 item(s), estimated 37.3 min — clears the 15 min floor
{"pool":"empty","candidates":0,"selected":0,"sessions":{...}}
```

Evidence in the scratch workspace:

- `10-collect/pool.json` is written and holds 4 items (15881 bytes), so extraction succeeded.
- `step-timing.json` holds exactly one line, `{"step":"extract",...}` — `daily-plan` and
  `daily-qc-content` never ran, so the stage runner recorded no timing for them.
- `21-plan/` is absent, so `<workDir>/21-plan/<date>_04_quality-control-content_candidates.json` is
  missing, and `poolGate` therefore reports `candidates: 0` and writes `{"status":"EMPTY"}`.
- The same result at a relative and an absolute `--work-dir`, and from the workflow
  (`kk news generate --run-date 20261115 --agent pi-dsv4.1-flash-cc` → `status: no-content`,
  `exitCode: 0`, "the store pool was empty").

Suspected seam: `apps/cli/src/commands/content-generate.ts` — `STEP.plan()` and `STEP.qcContent()` are
guarded by `when: poolNonEmpty`, which reads `itemCount(readJsonFile(fs, <workDir>/10-collect/pool.json))`.
`itemCount` returns `value.length` for an array and `pool.json` parses to a 4-element array, so the
predicate should be true. Either `readJsonFile` misses a file the stage subprocess just wrote, or the
`when` is evaluated against a `ctx.workDir` that is not the path the stage wrote to.

Impact: no episode has been produced since 2026-11-14, and the daily job cannot settle `done` on any
day with content. This is the blocking defect behind task 0373 R4; a thin pool is NOT the cause here.

### Requirements

- [ ] R1. Make `kk news prepare` run `daily-plan` and `daily-qc-content` whenever `10-collect/pool.json` holds at least one item, so the pool gate reads real candidates instead of reporting EMPTY after a successful extract.
- [ ] R2. Keep the existing empty-pool contract intact: a genuinely empty extract must still short-circuit to `{"status":"EMPTY"}` with exit 0, and must not invoke plan or QC.
- [ ] R3. Add a regression test that fails on today's behaviour — a non-empty `10-collect/pool.json` must produce `21-plan/<date>_04_quality-control-content_candidates.json` and a `PASS` gate — and prove it fails before the fix.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A non-empty pool reaches the plan and QC stages (req: R1)
  Given a scratch work dir and a store holding at least one eligible item
  When kk news prepare runs
  Then daily-plan and daily-qc-content both execute, 21-plan candidates exist, and pool-gate.json says PASS

Scenario: AC2 — A genuinely empty pool still short-circuits (req: R2)
  Given a store with no eligible item for the window
  When kk news prepare runs
  Then no plan or QC stage executes and pool-gate.json says EMPTY with exit code 0

Scenario: AC3 — The regression is covered (req: R3)
  Given the new test for a non-empty pool
  When it runs against the pre-fix code
  Then it fails, and it passes only once plan and QC actually run
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. Reproduce with the scratch `kk news prepare` command in Background; confirm `10-collect/pool.json`
   holds items while `step-timing.json` lists only `extract`.
2. Trace `poolNonEmpty` → `readJsonFile` → `itemCount` in `apps/cli/src/commands/content-generate.ts`,
   and check whether the `when` sees the file the `daily-extract` subprocess wrote (`ctx.workDir`
   identity, fs handle, or evaluation order).
3. Write the failing regression test first, then fix the root cause in the shared predicate/runner.
4. Re-run the scratch prepare, then a real `kk news generate`, and confirm a PASS gate and a produced
   bundle on a day that has content.

### Solution

Root cause: `readJsonFile` is an object-shaped reader — `return isObject(parsed) ? parsed : null` — and
`dailyExtract` writes `10-collect/pool.json` as a **bare `Doc[]`** (`writeJsonText(poolPath, picked.docs)`).
Every `itemCount(await readJsonFile(...))` over the pool therefore counted 0 items, so
`STEP.plan()`/`STEP.qcContent()` (guarded by `when: poolNonEmpty`) never ran, `21-plan/…_candidates.json`
was never written, and `writePoolGate` reported `EMPTY` with `pooled === 0`. The suite missed it
because its stage double wrote the `{metadata:{docs}}` envelope instead of the array production writes.

Change map:

- `apps/cli/src/commands/content-generate.ts:404-405` — `writePoolGate` reads the pool and the
  candidates through `readJsonValue` (array-tolerant) so `pooled` and `items` count real files.
- `apps/cli/src/commands/content-generate.ts:748` — `poolNonEmpty` uses `readJsonValue`, which is the
  predicate that had to be true for plan/QC to run at all.
- `apps/cli/src/commands/content-generate.ts:765,864` — the same swap for the candidate-count guard and
  the `prepare` row summary, so `candidates` reports the real count.
- `apps/cli/src/commands/content-generate.ts:219` — documented WHY `readJsonFile` stays strict, so the
  next payload-shaped read does not repeat the mistake.
- `apps/cli/tests/content-generate.e2e.test.ts` — the stage double gains `KK_STUB_POOL_SHAPE=array`,
  and a new case prepares a fresh fixture with a bare `Doc[]` pool and asserts
  `pool: ok` / `candidates: 2` / gate `PASS`. It failed before the fix and passes after.

No behaviour change for a genuinely empty pool: `readJsonValue` returns `undefined` → `itemCount` 0 →
`EMPTY`, exit 0, plan and QC still skipped (the existing R3 case still passes unchanged).

### Testing

Run in the batch worktree `kk-runall-90de0e` (branch `sp/runall-0374-0373-90de0e`) on 2026-11-15.

| Check | Command | Result |
| --- | --- | --- |
| Red: new regression case fails pre-fix | `bun test apps/cli/tests/content-generate.e2e.test.ts` | PASS (red observed) — `reads the bare Doc[] pool.json that dailyExtract writes` failed on `expect(prepared.pool).toBe('ok')` |
| Green: same case after the fix | same | PASS — 7 pass, 0 fail, 87 expectations |
| Related news suites | `bun test apps/cli/tests/kk-news-generate.e2e.test.ts apps/cli/tests/kk-news-generate-dag.test.ts apps/cli/tests/daily-cache-recovery.test.ts` | PASS — 18 pass, 0 fail |
| Lint + typecheck | `bun run lint` | PASS — 816 files checked, no fixes |
| Build | `bun run build` | PASS — `index.js` 2.22 MB |
| Real production data, real store | `bun apps/cli/dist/index.js news prepare --work-dir .works/tmp/prepare-fix/20261115 --run-date 20261115` | PASS — `{"pool":"ok","candidates":4,"selected":4}` and `pool-gate.json {"status":"PASS"}`; `step-timing.json` now lists `extract`, `plan`, `quality-control-content` |

Production evidence, before vs after the fix on the same store and the same 24h window:

```
before: {"pool":"empty","candidates":0,"selected":0}   step-timing: extract only
after:  {"pool":"ok","candidates":4,"selected":4}      step-timing: extract, plan, quality-control-content
        floor gate: estimated 32.6 min from 7244 chars — above the 15 min floor
```

The empty-pool contract is unchanged: the pre-existing `closes an empty pool as exit 0 with pool empty
and an EMPTY gate (R3)` case still passes without modification.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-15T19:13:47.365Z backlog → todo (system)
- 2026-11-15T19:13:47.685Z todo → wip (system)

