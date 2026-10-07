---
schema_version: 1
name: De-flake the kk-itc dry-run task-check assertions under concurrent load
status: todo
template: feature-impl
created_at: 2026-10-07T20:52:27.448Z
updated_at: "2026-10-07T21:18:23.422Z"
feature_id: G2

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 1
---

## 0218. De-flake the kk-itc dry-run task-check assertions under concurrent load

### Background

Hit 2026-10-07 during G71's feature-verification pass on `main` (knowledge-kit), which recorded a FAIL receipt that was not a real regression.

The repo-wide gate reported:

```
(fail) kk-itc auto mode + revise loop + report (0149) > task check — the dry-run walk with auto=true reaches done [35104.36ms]
  ^ this test timed out after 30000ms.
```

A **timeout**, not an assertion failure: 35.1s against a 30s per-test limit. Two contextual signals say it is load-sensitive rather than broken — the whole gate took 363s in that run versus ~130s on the same tree inside an isolated worktree, and `main` was being edited concurrently at the time (several files dirty, an unrelated in-flight change to `packages/publish-harness` and two publish plugins). Re-running the same pass later produced the identical shape. The same test file has sibling cases that walk the same dry-run pipeline (`0149`, `0151`, `0152`), so whichever one is slowest will be the one that trips.

Impact: a feature's verification receipt records FAIL for an environmental flake. `feature check --strict --as done` then refuses a feature that is actually green, and the receipt must be re-produced on a quiet tree. This is the kind of red that trains people to ignore the gate.

**Refine corrections (2026-10-07)**

- "R2: prefer asserting the reached terminal state over a wall-clock budget" → all three walk cases already assert `exitCode 0`, `status: done`, `finalState: done`; the only wall clock is the bun per-test timeout (`30_000`). There is no budget assertion to replace. Resolution: R2 re-targeted at the cost driver (below).
- "sibling cases in the same file (0149, 0151, 0152)" → `kk-itc-workflow.test.ts` holds two walk cases (0149 at `:275`, 0152 at `:369`); the 0151 walk lives in `apps/cli/tests/kk-itc-publish-tail.test.ts:141`. All three spawn `spur workflow run plugins/kk/workflows/kk-itc.yaml --dry-run --json` with a 30s timeout.
- Root cause measured in refine (R1 is now partially pre-answered; the implementer re-measures to confirm on their machine). Same walk as the 0149 case, `/usr/bin/time -p`, 10-core macOS:

  | Run | Wall |
  | --- | --- |
  | idle, default (writes run record) | 3.1–5.1s (user+sys ≈ 3.1s) |
  | idle, `--no-log` | 0.6s |
  | 8 concurrent, default | 21–24s each |
  | 8 concurrent, `--no-log` | 12–14s each |
  | 8 concurrent `spur workflow list` (CLI startup baseline) | ~2s each |

  The default walk writes a two-file run record to `.spur/memory/runs/<RUNID>.md` + `.state.json` (`spur workflow run --help`, `--no-log`); that write is ~80% of the idle cost and is where concurrent spur runs contend — 8 walks are 5× slower than one, while 8 CLI startups are not. The tests never read the record. **Side effect:** every gate run leaves records behind — 932 files (466 runs) matching `kk-itc-(dryrun|tail)` were in `.spur/memory/runs` at refine time (gitignored via `.git/info/exclude`).
- Hypothesis, not confirmed: the residual 12–14s under 8-way load with `--no-log` is contention inside spur itself (e.g. `.spur/spur.db` WAL). Confirming repro: run the 8-way `--no-log` loop with `SPUR`-side tracing (`--trace-file`). Out of scope here — it is spur's, not kk's.

### Requirements

- [ ] R1. Re-measure and record in Testing the wall time of one kk-itc dry-run walk, idle and under 8-way concurrent spur load, with and without `--no-log` (the refine table is the baseline; the task's numbers must come from the implementer's own run).
- [ ] R2. All three kk-itc dry-run walk spawns pass `--no-log`: `apps/cli/tests/kk-itc-workflow.test.ts` (0149 and 0152 cases) and `apps/cli/tests/kk-itc-publish-tail.test.ts` (0151 case). Assertions on `exitCode`, `status`, `finalState` and `transitionsTaken` are unchanged.
- [ ] R3. Each of the three cases keeps its `30_000` timeout and carries a one-line comment naming the measured cost (idle and 8-way loaded) so a slow run can be told from a hung one. The timeout is not raised.
- [ ] R4. Under the reproduced load (8 concurrent default-logging walks looping in the background), the three walk cases pass; and `bun run test` passes on the final tree.
- [ ] R5. A full test run no longer adds `kk-itc-dryrun-*` / `kk-itc-tail-*` files to `.spur/memory/runs`.

**Out of scope:** deleting the existing orphaned run records (operator-local, gitignored state — report the count, let the operator prune); spur-side contention with `--no-log` (upstream); other test files that spawn `spur workflow run` without `--dry-run`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The walk cost is measured, not guessed (req: R1)
  Given the kk-itc dry-run walk command used by the 0149 case
  When it is timed idle and with 8 concurrent walks, with and without --no-log
  Then the Testing section records all four wall times and the --no-log reduction

Scenario: AC2 — The three walk cases skip the run record and still prove the walk reaches done (req: R2, R5)
  Given the 0149, 0151 and 0152 walk cases
  When bun test apps/cli/tests/kk-itc-workflow.test.ts apps/cli/tests/kk-itc-publish-tail.test.ts runs
  Then each spawn includes --no-log, each asserts status and finalState done, and no new kk-itc-dryrun-* or kk-itc-tail-* file appears in .spur/memory/runs

Scenario: AC3 — The timeout stays 30s and documents its headroom (req: R3)
  Given the three walk cases
  When their source is read
  Then each keeps 30_000 and a comment states the measured idle and 8-way loaded cost

Scenario: AC4 — The walks pass under the load that exposed the flake (req: R4)
  Given 8 background loops of default-logging kk-itc dry-run walks
  When the two test files run concurrently with that load, and then bun run test runs on the final tree
  Then both exit 0
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T21:18:13.153Z

- **Q: Raise the timeout or cut the cost?** Closed (refine 2026-10-07): cut the cost. `--no-log` removes the dominant, contended step (measured 5–8× idle, ~2× under 8-way load) and leaves 30s with ≥2× headroom over the worst measured loaded run (14s). Raising the timeout alone would keep the 932-file leak and let a genuinely hung walk sit longer.
- **Q: Does `--no-log` weaken what the cases prove?** Closed: no. They assert the CLI's JSON summary (`status`, `finalState`, `transitionsTaken`), which `--no-log` does not change (verified: summary identical, `transitionsTaken: 8`). Nothing reads `.spur/memory/runs`.
- **Q: Prune the existing orphaned records?** Closed: no — operator-local gitignored state; report the count only.

### Design

**WHAT.** Add `--no-log` to the three kk-itc dry-run `spur workflow run` spawns and document the measured cost next to each `30_000`. No new API, no helper extraction (three call sites in two files; a shared helper is not worth the cross-file coupling).

**WHERE.**
- `apps/cli/tests/kk-itc-workflow.test.ts` — arg arrays of `task check — the dry-run walk with auto=true reaches done` (~`:277-289`) and `task check — a dry-run walk with cover/inline on and targets set still reaches done` (~`:371-383`).
- `apps/cli/tests/kk-itc-publish-tail.test.ts` — `R6/AC7 — a spur workflow run --dry-run walk …` (~`:143-155`).

**Edit shape (each site).** Insert `'--no-log',` immediately after `'--dry-run',`. Above the `}, 30_000);` (or the spawn), one comment, e.g.:
`// --no-log: the run-record write is ~80% of the walk and contends under concurrent spur use; nothing here reads it. Measured: ~0.6s idle, ≤14s with 8 concurrent walks — 30s is headroom, not a budget.`
Replace the numbers with the implementer's R1 measurements.

**Load reproduction (R4), frozen:**
```bash
W=$(mktemp -d); for i in $(seq 8); do ( while :; do spur workflow run plugins/kk/workflows/kk-itc.yaml --run-id load-$i-$RANDOM --dry-run --json --vars "{\"work_dir\":\"$W/$i\",\"auto\":\"true\",\"judge\":\"true\",\"unslop\":\"true\"}" >/dev/null 2>&1; done ) & done
bun test apps/cli/tests/kk-itc-workflow.test.ts apps/cli/tests/kk-itc-publish-tail.test.ts
kill $(jobs -p); rm -f .spur/memory/runs/load-*
```
The load loops deliberately keep logging on (that is the concurrent-use condition); clean up only their own `load-*` records.

**Anti-patterns.** Do not raise the timeout. Do not drop or loosen any `expect`. Do not add `--quiet`/`--silent` (the summary JSON on stdout is the assertion surface). Do not delete pre-existing records in `.spur/memory/runs`.

**Environment precondition.** `spur` is not pinned in `.prototools`; confirm `spur workflow run --help` lists `--no-log` before editing.

**Concurrency.** No `wip` tasks; single worktree. Unrelated dirty files on `main` do not overlap the two test files.

### Plan

0. Precondition: `spur workflow run --help | grep -- --no-log`.
1. R1: time the 0149 walk idle ×3 and 8-way concurrent, with/without `--no-log` (commands in Design); record in Testing. Clean up only the probe's own records.
2. R2/R3: add `'--no-log'` + the cost comment at the three sites.
3. `bun test apps/cli/tests/kk-itc-workflow.test.ts apps/cli/tests/kk-itc-publish-tail.test.ts`; before/after `ls .spur/memory/runs | grep -cE 'kk-itc-(dryrun|tail)'` unchanged (R5).
4. R4: run the frozen load reproduction; record pass + durations.
5. `bun run lint`, `bun run test`.
6. Commit only the two test files: `test(kk-itc): skip run records in dry-run walk checks to de-flake under load (task 0218)`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature `G2` (kk-itc); walk cases from tasks `0149`, `0151`, `0152`; exposed during G71 feature verification (2026-10-07).
- `spur workflow run --help` (`--no-log`, `--dry-run`); `.spur/memory/runs/`.
- Sibling: task `0217` (no file overlap).

### History

- 2026-10-07T21:18:23.422Z backlog → todo (system)

