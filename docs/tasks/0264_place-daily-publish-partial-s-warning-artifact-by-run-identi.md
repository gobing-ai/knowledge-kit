---
schema_version: 1
name: Place daily-publish-partial's warning artifact by run identity, not by process cwd
status: backlog
template: feature-impl
created_at: 2026-10-12T20:56:07.634Z
updated_at: "2026-10-12T20:56:43.859Z"
feature_id: G1

---

## 0264. Place daily-publish-partial's warning artifact by run identity, not by process cwd

### Background

`dailyPublishPartial` (`plugins/kk/scripts/kk-workflow-stages.ts:1327`) writes its advisory warning artifact to a **cwd-relative** path — `.spur/run/publish-partial-<runDate>.txt` at `:1337-1341` — while its sibling result path at `:1329` resolves under the stage's `workDir`. The artifact therefore lands wherever the process happened to run. Observed during the G14 batch (2026-10-12): a test invoking the stage with cwd=`apps/cli` created `apps/cli/.spur/run/publish-partial-20261007.txt`, an untracked directory that then sat in an unrelated task's change set and had to be deliberately excluded from its commit.

Nothing consumes the file programmatically — only the writer and the workflow states reference it — so the artifact is a human-facing note pointing at `kk executor fan-out --retry-from`; but an artifact whose location depends on the caller's cwd is not a usable run record, and it litters whatever tree the caller stood in.

### Requirements

- [ ] R1. Make the artifact's location independent of the process cwd — resolve it under the run's `workDir`, or resolve an explicit execution/project root — and state in the stage's comment which convention is authoritative. Do not leave the cwd-relative write in place.
- [ ] R2. Preserve the artifact's name, body and advisory semantics: the stage still warns on stderr, still exits 0, and the body still names `kk executor fan-out --retry-from`.
- [ ] R3. Add a regression test that invokes the stage with a cwd outside the repository and asserts the artifact lands at the declared location and that no `.spur/` directory is created in the process cwd.

### Acceptance Criteria

- [ ] AC1 — Invoking the stage with cwd set to a non-repository directory creates no `.spur/` in that cwd and writes the artifact at the declared location. (req: R1, R3)
- [ ] AC2 — The warning body is unchanged, including the `--retry-from` pointer, and the stage still exits 0. (req: R2)
- [ ] AC3 — The new test fails before the change and passes after it (falsification, no `.skip`, no relaxed assertion). (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

One convention must be chosen and recorded, because two are defensible and the next reader will otherwise re-open it: the `.spur/run/<name>` plane is execution-tree scratch (how the `sp` driver scripts use it), while `workDir` is the episode workspace holding `31-publish/…`.

- Under `workDir` (`join(workDir, '.spur', 'run', …)`) the evidence stays with the run it describes and is collected with the rest of the episode artifacts.
- Under an explicitly resolved execution root it stays in the repo-wide scratch plane, which is where an operator already looks for `sp` run artifacts.

Either satisfies R1; pick one, write the reason as a one-line comment beside the path, and keep the change surgical. Prefer reusing the existing `timed` / `sted` helpers so the artifact stays tracked by the stage's own bookkeeping rather than becoming an untracked side write.

### Plan

- [ ] R1: choose and document the location convention; change the `mkdir`/`writeFileSync` paths accordingly.
- [ ] R2: keep the message body verbatim; confirm the existing stage tests still pass.
- [ ] R3: add the non-repo-cwd regression test, show it failing pre-change, then run the targeted suite and the project gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
