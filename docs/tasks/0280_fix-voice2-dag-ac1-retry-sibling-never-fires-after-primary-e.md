---
schema_version: 1
name: "Fix voice2-dag AC1: retry sibling never fires after primary exit-0 without expectFile"
status: todo
template: issue
created_at: 2026-10-14T06:15:17.989Z
updated_at: "2026-10-14T17:28:45.998Z"

---

## 0280. Fix voice2-dag AC1: retry sibling never fires after primary exit-0 without expectFile

### Background

Found while running 0279's quality gate (run dev-runall-0274-0279-3d2a). `apps/cli/tests/voice2-dag.test.ts:844`
AC1 — a primary that exits 0 without its expectFile is recovered by the retry sibling — fails deterministically:
only the `pi` primary is invoked, the `claude` retry sibling never fires (retry raced/dropped at ~1.5–1.9s, well
inside the 180s budget).

Reproduction envelope:

- Fails at worktree HEAD with both tasks' diffs — 5/5 runs (full suite, isolation ×3, filtered ×2).
- Fails at the batch base commit `4eb197b9057427f7ac39e1e1b4d113efce491d20` in a fresh throwaway worktree
  (bun install + single-test run) — pre-existing, not introduced by 0274/0279.
- Contradiction: the identical tree ran the full suite green (2782 tests, 0 fail) at ~22:07 PDT the same
  evening. No code or `~/.config/kk` change in between; suspected time- or environment-dependent race in the
  agent.run recovery scheduling (0238 scope, feature F6 is done — re-parent as needed).
- 0238's AC2–AC4 and every other voice2 test still pass in isolation.

Scope note: filed by the dev-runall batch driver as an out-of-gate-scope follow-up; 0279's gate deviation is
recorded in this batch run's per-tree run record (ADR-131 disposable plane; regenerated per run)`.

**Update 2026-10-14 — root cause identified (A22 session review).** The failure is not a scheduling race and
nothing about it is unexplained. The retry sibling is dispatched as `agent: ${vars.agent_retry}` = `claude`,
and the globally configured executor profile `claude` was disabled by the quota guard at
`2026-10-14T06:30:05Z` (entry `agent.executors.claude.disabled` = `{owner: quota, reason:
"agent.quota.exhausted claude"}` in `~/.config/spur/config.yaml`; telemetry `~/.config/spur/agent-usage.json`
→ `claude: exhausted`, resets `2026-10-15T01:00:00Z`). `resolveExecutor` refuses a disabled executor
**before** any PATH lookup, so the retry node's dispatch dies ~1.5–1.9 s in — the exact interval observed —
and the run's own stdout names it verbatim:

    agent.run 'plan-translate-retry' (claude) dispatch failed: Executor 'claude' is disabled
    (agent.executors.claude.disabled) — enable it or select another executor

That single cause explains the whole envelope, including the observation recorded above as a contradiction:
the suite was green at ~22:07 PDT because the disable had not been applied yet; it went red at 23:30 PDT and
stayed red at every commit, including the batch base — the base-commit reproduction identified the *onset
time*, not a pre-existing code defect. Reproduced on a clean tree (task 0277's diff stashed) to separate the
environment from the change under test.

Two mitigations have landed: `apps/cli/tests/voice2-dag.test.ts` now stubs the retry as `codex` — a canonical
agent name with no executor profile, so no disable can pre-empt it (commit `114d24ad` on `main`) — and the
`claude` profile has since been re-enabled (`disabled: false`) although the vendor window stays exhausted
until 2026-10-15T01:00Z.

Still open for this task: whether the engine *should* treat `agent: <name>` as a bare binary even when the
same name exists as a disabled executor profile — the deprecation warning already promises bare binary names
"keep working during the transition", so the pre-PATH refusal is arguably a contract gap in that transition.
Decide that contract, and if the answer is "the test should not collide", this task reduces to the stub fix
already applied.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

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
