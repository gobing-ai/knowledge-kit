---
schema_version: 1
name: Make the full project gate deterministic under machine load (three load-sensitive fixtures)
status: todo
template: issue
created_at: 2026-10-13T00:48:23.832Z
updated_at: "2026-10-13T00:48:36.705Z"

---

## 0270. Make the full project gate deterministic under machine load (three load-sensitive fixtures)

### Background

The project gate (`bun run spur-check`) is non-deterministic under sustained machine load: on 2026-10-12/13 a
`dev-runall --tasks 0255,0268 --worktree` batch ran the gate three times on an unchanged, healthy tree and got
FAIL every time, with 2-3 failing cases out of 2733 — none of them attributable to the batch's diff. The machine
was carrying 8-11 concurrent `bun test` / `bun run spur-check` processes from a sibling `spur-new` checkout and a
second knowledge-kit worktree (load average 6-31).

Three fixtures fail, all for the same class of reason — an environment-sensitive budget or race, not a logic
defect:

| Surface | Failure | Mechanism |
| --- | --- | --- |
| `apps/cli/tests/fanout.test.ts:1460` | `targets[1]` expected `status: 'published'`, received `failed` with `error: "… exceeded its 300ms budget"` (`durationMs` 351-511 ms) | `--target-timeout 300` (`:1444-1445`) is a hard budget on a spawned plugin subprocess; process startup alone exceeds it under load. Reproduced on a CLEAN `main` checkout (2 of 3 isolated runs fail; 51 pass / 1 fail), and again at load average 6.1 — so it is pre-existing on `main`, not introduced by that batch. |
| `apps/cli/tests/commands/stage.test.ts:129` | `error: EISDIR reading file: "node_modules/.bun/@gobing-ai+ts-utils@0.5.21/node_modules/@gobing-ai/ts-utils/dist/index.js"` | Intermittent module-resolution race; the path is a regular 327-byte file on disk before and after. Seen in 3 full-suite runs, never reproduced in ~8 isolated attempts. |
| `apps/board/tests/installed-board.test.ts:713` | `expect(await page.locator('a[href="/board/settings/workflows"]').count()).toBeGreaterThan(0)` received `0` after ~1058 ms | The module had not finished rendering when the locator was read; the surrounding test's 30 s budget is not the issue — the read is simply too early. Intermittent; new surface added by task 0255. |

Evidence: `.spur/run/0268-test-gate.log` (three FAIL runs), `.spur/run/0268-check-receipt.stale-fail-*.json`, and
the batch report `.spur/run/worktree-runall-0255-0268-de19-batch-report.md` in the invoking tree.

Because the gate flakes, an otherwise-complete task can be certified `failed` for reasons outside its diff: task
0268 reached `wip` with its own tests green (25 pass / 0 fail in `apps/cli/tests/store-label.test.ts`) and was
routed to `failed (retry-exhausted)` by the pipeline's bounded fix budget after two no-change diagnosis hops.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. (fanout) Reproduce `apps/cli/tests/fanout.test.ts:1460` under load and raise the fixture's `--target-timeout`
   so it measures budget ENFORCEMENT, not process startup latency. Keep the negative control: a plugin that
   genuinely exceeds its (now robust) budget must still be reported `failed`/terminated, and the assertion that
   the hanging target's error names its budget must survive.
2. (stage resolver) Reproduce `apps/cli/tests/commands/stage.test.ts:129` and identify the concurrent writer that
   makes `@gobing-ai/ts-utils/dist/index.js` unreadable; if the trigger is a shared `node_modules`/build rewrite
   performed by a packing test file, make that file's build hermetic (private output dir or a repo copy) rather
   than adding a retry. A retry or a try/catch around the resolver is NOT an acceptable repair.
3. (installed-board) Replace the read-after-render at `apps/board/tests/installed-board.test.ts:713` with a
   bounded wait on the link (or assert on the mounted module first); do not lengthen the per-test timeout to
   paper over it.
4. Confirm the repairs are load-tolerant: run the whole workspace suite at least twice with a deliberate
   background load, then run the full gate once.
5. Record the outcome and, if any repair crosses an owning task's surface, note it in that task's `## History`.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
