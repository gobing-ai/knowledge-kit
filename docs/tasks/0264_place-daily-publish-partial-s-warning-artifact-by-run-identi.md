---
schema_version: 1
name: Place daily-publish-partial's warning artifact by run identity, not by process cwd
status: todo
template: feature-impl
created_at: 2026-10-12T20:56:07.634Z
updated_at: "2026-10-13T20:57:08.837Z"
feature_id: G1

priority: P2
ac_altitude: task-local
estimate_hours: 1
ac_numbering: task-local
---

## 0264. Place daily-publish-partial's warning artifact by run identity, not by process cwd

### Background

`dailyPublishPartial` (`plugins/kk/scripts/kk-workflow-stages.ts:1326`) writes its advisory warning artifact to a **cwd-relative** path — `.spur/run/publish-partial-<runDate>.txt` at `:1337-1342` — while its sibling result path at `:1328` resolves under the stage's `workDir`. The artifact therefore lands wherever the process happened to run. Observed during the G14 batch (2026-10-12): `apps/cli/tests/kk-workflow-stages.test.ts:2282-2302` spawns the stage runner with no `cwd` (the `run` helper at `:46-54` inherits the test process cwd, `apps/cli` under the workspace runner) and reads/deletes `.spur/run/publish-partial-20260101.txt` relative to that cwd — so the existing test both encodes the bug and is what littered `apps/cli/.spur/run/`.

Nothing parses the file — the writer, the workflow state (`.spur/workflows/kk-daily-ai-voice.yaml:532-538` and its packaged copy `plugins/kk/workflows/kk-daily-ai-voice.yaml:532-538`) and `kk daily publish-classify --fold-tail` (`apps/cli/src/commands/daily.ts:329`) only invoke the stage — so the artifact is a human-facing note pointing at `kk executor fan-out --retry-from`; but an artifact whose location depends on the caller's cwd is not a usable run record, and it litters whatever tree the caller stood in.

**Refine corrections (2026-10-12)**
- Line refs `:1327` / `:1329` / `:1337-1341` → verified `:1326` (function) / `:1328` (result path) / `:1337-1342` (mkdir + write) at bd537df5.
- "A test invoking the stage with cwd=`apps/cli`" (unnamed) → it is `kk-workflow-stages.test.ts:2282` ("daily-publish-partial names the failed targets and preserves the retry file"), which asserts the cwd-relative location → that test must be rewritten, not merely joined by a new one.
- "Prefer reusing the existing `timed` / `sted` helpers" → the stage already wraps both writes in `sted` inside `timed` (`:1330`, `:1337-1338`) → keep those wrappers; only the paths change.
- Unlisted second asserting test: `apps/cli/tests/commands/daily.test.ts:338` expects `join(dir, '.spur/run/publish-partial-20261007.txt')` with cwd = `dir` = `--work-dir` → it keeps passing under the workDir convention unchanged; its `inCwd` comment (`:47-51`) names this stage's cwd write and gets a one-line update.
- Sibling scan: no other `plugins/kk/scripts` or `apps/cli/src` code writes a cwd-relative `.spur/run/` path (`rg "['\"\`]\.spur/run"`), so the fix is local to this stage.

**Refine corrections (2026-10-13).**

- The issue is still present in the current tree: `dailyPublishPartial` computes its result under
  `workDir` but still calls `mkdirSync('.spur/run')` and `writeFileSync('.spur/run/...')` at
  `plugins/kk/scripts/kk-workflow-stages.ts:1351-1355`, so those writes resolve against the process
  cwd. `timed(workDir, ...)` records timing only; it does not change cwd.
- The production callers were re-traced: `plugins/kk/workflows/kk-daily-ai-voice.yaml:538` and
  `apps/cli/src/commands/daily.ts:329` pass the effective work directory, so the marker belongs
  beside that run. No workflow or command contract needs a new argument.
- The stage test at `apps/cli/tests/kk-workflow-stages.test.ts:2328-2348` still reads the marker from
  the repository cwd and therefore encodes the bug. The `daily.test.ts` fold-tail case runs with cwd
  equal to `workDir`, so it verifies the desired path only accidentally and cannot catch the split.

### Requirements

- [ ] R1. When `workDir` is non-empty, write the marker at `join(workDir, '.spur', 'run', `publish-partial-${runDate}.txt`)`, creating that directory through the existing `sted` wrapper; add one short why comment that the marker belongs to the run's `workDir`, not the process cwd, and preserve the current cwd-relative fallback only for an explicitly empty `workDir`.
- [ ] R2. Preserve the marker filename, one-line body, stderr warning, and zero exit status; the body must continue to name `kk executor fan-out --retry-from`.
- [ ] R3. Replace the stage regression so it runs with a temporary process cwd distinct from `workDir`, asserts the marker under `workDir/.spur/run`, and asserts that the temporary process cwd receives no `.spur` directory.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a supplied work directory owns the partial-publish marker (req: R1, R3)
  Given a partial result under `<workDir>/31-publish` and an empty temporary process cwd
  When `daily-publish-partial <workDir> <runDate>` runs
  Then `<workDir>/.spur/run/publish-partial-<runDate>.txt` exists and the process cwd has no `.spur` directory

Scenario: AC2 — partial-publish output remains compatible (req: R2)
  Given one published target and one failed target
  When the stage runs
  Then it exits 0, warns with `failed targets: <target>`, and writes the unchanged body including `--retry-from`

Scenario: AC3 — the regression distinguishes the two roots (req: R3)
  Given the current stage implementation before the path fix
  When the rewritten test runs with distinct cwd and `workDir`
  Then it fails because the marker is written under cwd, and it passes after the path fix without relaxed assertions
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T21:56:52.678Z

- **workDir vs an explicit execution root?** Closed: `workDir`. The stage receives only `<workDir> <runDate>`; an execution root would add a new argv contract across two workflow copies and `daily.ts` for an advisory note. Evidence stays with the episode. Revisit only if an operator tool needs one repo-wide index of partial-publish markers.
- **Empty `workDir`?** Closed: out of scope — the path degrades to cwd-relative exactly like the existing result path; every caller passes a `work_dir`.
- **New test or rewrite?** Closed: rewrite the existing test in place — it is the one that encodes and causes the bug; a parallel test would leave the littering assertion behind.

### Design

Use the run directory already supplied to the stage. In `dailyPublishPartial`, compute one
`const marker = join(workDir, '.spur', 'run', `publish-partial-${runDate}.txt`)`; pass `dirname(marker)`
to the existing `sted('mkdir', ...)` call and `marker` to the existing `sted('write', ...)` call. Keep
the `result` path, `timed(workDir, ...)`, warning text, marker body, and exit behavior unchanged.

Rewrite the existing stage test in place because it currently asserts the cwd-relative bug. Extend its
local `run` helper with one optional `cwd` argument and invoke it with a second temporary directory;
this avoids duplicating the runner setup and does not alter existing callers. Keep the daily command
fold-tail assertion and update only its comment: it runs with cwd equal to `workDir`, so it is a
compatibility check, not the root-separation regression. No YAML, CLI argument, environment variable,
or execution-root resolver is needed.

Out of scope: adding a stage argument or environment variable; changing either workflow YAML or
`daily.ts`; changing the marker body, warning, or exit status; and changing the existing behavior when
the caller explicitly supplies an empty `workDir`.

### Plan

1. Rewrite `apps/cli/tests/kk-workflow-stages.test.ts`'s existing partial-publish case first. Give it
   a separate temporary process cwd, run the stage through the helper's new optional cwd parameter,
   and assert the marker is absent from cwd and present under `workDir`; run the test against the
   unchanged stage to capture the red failure.
2. Change only `dailyPublishPartial`'s marker paths to the `workDir`-anchored `marker` variable and
   retain the `sted` and `timed` wrappers. Do not change the marker body, warning, result path, or
   workflow arguments.
3. Update the explanatory `inCwd` comment in `apps/cli/tests/commands/daily.test.ts`; rerun the stage
   regression and the fold-tail partial case.
4. Run `bun run lint`, the relevant test files, and then the project gate; inspect git status for an
   unintended `.spur/run` artifact before handoff.

### Solution

**Implementation map (fixed scope).** Anchors: `plugins/kk/scripts/kk-workflow-stages.ts:1351`,
`apps/cli/tests/kk-workflow-stages.test.ts:46`, `apps/cli/tests/kk-workflow-stages.test.ts:2328`,
and `apps/cli/tests/commands/daily.test.ts:87`.

- `plugins/kk/scripts/kk-workflow-stages.ts`: derive the marker path from the non-empty `workDir`,
  use `dirname(marker)` for directory creation, and use `marker` for the unchanged write body. The
  existing empty-argument fallback and all `timed`/`sted` diagnostics stay intact.
- `apps/cli/tests/kk-workflow-stages.test.ts`: add only an optional cwd to the test runner helper and
  rewrite the existing partial-publish test to separate process cwd from `workDir`; assert both the
  positive marker location and the absence of cwd litter.
- `apps/cli/tests/commands/daily.test.ts`: correct the comment that explains why `inCwd` remains in
  the fold-tail test. The test and production command surface otherwise stay unchanged.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T21:56:57.654Z backlog → todo (system)

