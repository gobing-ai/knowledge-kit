---
schema_version: 1
name: Make the full spur-check suite deterministic under load (module-store race and timing flakes)
status: backlog
template: standard
created_at: 2026-10-13T18:57:36.022Z
updated_at: "2026-10-13T18:58:01.617Z"

---

## 0274. Make the full spur-check suite deterministic under load (module-store race and timing flakes)

### Background

The full `bun run spur-check` suite fails intermittently on load, and the failing set changes between
identical runs. Measured on 2026-10-13 while verifying G14 (all runs: `bun test --dots --timeout 20000
--path-ignore-patterns 'vendors/**' apps`, same tree, no source change between them):

| Run | Result | Failing tests |
| --- | --- | --- |
| `bun run spur-check` (pipeline, before the two fixes below) | 2 fail | `decision-catalog.test.ts` decisions.paths (real, fixed in `e0aec4c9`), `installed-board.test.ts` setup under the nested-run guard (real, fixed in `e0aec4c9`) |
| `bun run spur-check` (after the fixes) | 1 fail | `stage.test.ts` AC4 — `EISDIR reading file: node_modules/.bun/@gobing-ai+ts-utils@0.5.24/…/ts-utils/dist/index.js` |
| `bun test apps` | 1 fail | same AC4 EISDIR |
| `bun test apps` (stage.test.ts reverted to HEAD) | **3 fail** | same AC4 EISDIR **plus** `fanin.test.ts` `--source-timeout-override extends ONE source past the global leash…` and one more |
| `bun test apps/cli/tests` | 0 fail (766) | — |
| `bun test apps/cli/tests/commands/stage.test.ts` | 0 fail (9) | — |
| final `feature-verification.yaml` gate | 0 fail (2743) | — |

Three independent suspects, one coherent class (host-load sensitivity):

1. **Module-store read race (the recurring one).** `apps/cli/tests/commands/stage.test.ts` AC4 bundles
   the real CLI entry with `Bun.build`, so resolution walks the shared `node_modules/.bun` store.
   Under the full suite a writer mutates that path and the reader gets `EISDIR` on
   `…/@gobing-ai+ts-utils@0.5.24/…/ts-utils/dist/index.js`. The file exists (327 B) outside the run.
   Already tried and NOT sufficient: taking the shared cross-process build lock
   (`/tmp/kk-board-shared-build.lock`, the one `installed-board.test.ts` and
   `scripts/tests/board-package.test.ts` use around `bun pm pack`) around the build, and a bounded
   retry on `EISDIR` (the retry never fired — the error is not thrown by `Bun.build` itself, it
   surfaces as a test-scope loader/coverage read). Both experiments were reverted rather than landed.
   The writer is still unidentified; the prime suspect remains an unlocked `bun pm pack`/`bun run
   build` from a sibling test file touching the workspace trees.
2. **Timing assertions under load.** `apps/cli/tests/fanin.test.ts` `--source-timeout-override …`
   (2680 ms) and `apps/cli/tests/fanout.test.ts` concurrency budgets both failed once under a full
   gate run and passed in isolation. Main already hardened the fanout pair (`fefd9808`); the fanin
   override case looks like the same class and has not been hardened.
3. **Environment inheritance (fixed).** `apps/board/tests/installed-board.test.ts` spawned its
   fixture CLI with `{...process.env}`, so a pipeline-run suite handed it
   `SPUR_WORKFLOW_RUN_ACTIVE=1` and every nested `spur workflow run` was refused (the whole file died
   in `setup()`). `childEnv()` now drops the run guard for its children.

**Why this matters:** any task or feature whose gate runs the full suite can fail for reasons
unrelated to its change, and the failure set differs run to run — which makes a red gate
uninformative and a green one partly luck. `feature-verification.yaml` for G14 needed two attempts
for exactly this reason.

**Repro:** `bun test --dots --timeout 20000 --path-ignore-patterns 'vendors/**' apps` (repeat; expect
the AC4 `EISDIR` most runs), versus `bun test apps/cli/tests` (green) — the trigger needs the board
tests running concurrently.

### Requirements

- [ ] R1. `bun test apps` (and the full `apps packages plugins scripts` set the gate runs) passes repeatedly on one unchanged tree — at least three consecutive green runs — with the board tests running concurrently with the CLI tests, which is the condition that reproduces the AC4 failure today.
- [ ] R2. Identify the writer that mutates `node_modules/.bun/**` during the suite (or prove none exists and the read itself is at fault), and remove the race at its source rather than retrying the reader; record which test file/step owns the write.
- [ ] R3. Harden the load-sensitive timing assertions the same way main already hardened the fanout pair (`fefd9808`) — at minimum `apps/cli/tests/fanin.test.ts` `--source-timeout-override extends ONE source past the global leash without touching siblings` — so a busy host cannot fail them.
- [ ] R4. Record the residual flake class in `.spur/context/pitfalls.md` with the repro command, so a red gate on an unrelated change is diagnosed in one read instead of re-investigated.

### Acceptance Criteria

- [ ] AC1 — Three consecutive `bun test apps` runs are green on one unchanged tree. (req: R1)
- [ ] AC2 — The AC4 `EISDIR reading file: …/@gobing-ai+ts-utils@<v>/…/dist/index.js` failure no longer reproduces in 5 consecutive full-set runs, and the fix names the writer (a test file/step, or an explicit statement that no writer exists and the reader is at fault). (req: R1, R2)
- [ ] AC3 — The fanin `--source-timeout-override` case passes under a full-set run (not only in isolation), with the assertion still proving the override extends exactly one source. (req: R3)
- [ ] AC4 — `.spur/context/pitfalls.md` carries the repro and the class description. (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT.** Remove the load-sensitivity from the full-suite gate. No production code changes: the
flakes are all in test infrastructure.

**WHY.** A red gate must mean the change is wrong. Today the same tree yields 0, 1 or 3 failures
depending on scheduling (evidence in Background), so a red gate costs an investigation and a green
one carries luck. G14's feature-verification needed two attempts for this reason.

**WHERE.** `apps/cli/tests/commands/stage.test.ts` (AC4 bundling reads the shared module store),
`apps/cli/tests/fanin.test.ts` (`--source-timeout-override` timing), and whichever test file owns the
write into `node_modules/.bun/**` — to be identified, not guessed.

**Already tried and rejected (do not repeat without new evidence).** Wrapping the AC4 `Bun.build` in
the shared cross-process lock `/tmp/kk-board-shared-build.lock`, and a bounded retry on `EISDIR`.
Neither changed the outcome: the failure persists, and the retry never fired because the `EISDIR` is
not thrown by `Bun.build` itself but surfaces as a test-scope loader/coverage read. Both experiments
were reverted; the diff is not in the tree.

**Approach.** Find the writer first (a watcher over the `ts-utils` path during a full run, correlated
with the file start order; or run the board and CLI sets together and bisect by directory), then
either order the writer against the reader with the existing shared lock — if it IS a
`bun pm pack`/`bun run build` path — or stop the reader from touching the shared store at all.
Retrying the reader is explicitly not the fix.

**Anti-patterns.** Do not relax the AC4 assertions, do not skip the case, do not add a global test
timeout bump to hide the timing flakes, and do not land a mechanism that cannot be shown to change
the outcome (both rejected experiments above looked plausible and were inert).

**Budget.** ~2 h, `mutationPolicy: tests`.

### Plan

- [ ] R2: reproduce with a watcher on `node_modules/.bun/@gobing-ai+ts-utils@*/…/dist/index.js` during `bun test apps`, and name the writer (or prove there is none).
- [ ] R1/R2: apply the fix at the writer (shared lock) or by removing the reader's dependence on the shared store; re-run the full set 5×.
- [ ] R3: harden the fanin `--source-timeout-override` case the way `fefd9808` hardened fanout (assert the property, not the host's jitter), then confirm it under a full-set run.
- [ ] R1: three consecutive green `bun test apps` runs on one unchanged tree; record the runs in `## Testing`.
- [ ] R4: write the repro + class into `.spur/context/pitfalls.md`; close out.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
