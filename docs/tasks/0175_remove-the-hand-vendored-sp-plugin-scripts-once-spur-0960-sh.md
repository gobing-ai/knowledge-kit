---
schema_version: 1
name: Remove the hand-vendored sp plugin scripts once spur 0960 ships
status: backlog
template: standard
created_at: 2026-09-26T17:13:29.261Z
updated_at: "2026-09-26T17:13:30.024Z"

---

## 0175. Remove the hand-vendored sp plugin scripts once spur 0960 ships

### Background

knowledge-kit carries a hand-vendored copy of the spur `sp` plugin under `plugins/sp/scripts/` (34 files) and `plugins/sp/lib/` (`env.ts`, `inline-run.generated.mjs`). It was copied five times by hand (commits `3e32e642`, `f1744081`, `11605024`, `f3d51034`, `e8b07e70`), from two different sources, with no version recorded. On 2026-09-25, against installed plugin 0.3.92, 7 plugin scripts were missing and 23 had drifted.

Spur's pipeline YAML probes `plugins/sp/scripts/` before the installed twin, so this stale copy **shadows** the installed plugin, and a single run mixes revisions. That is how a `/sp:dev-runall --feature D6` batch ended up with an `inline-run-setup.ts` that had no `--fingerprint`.

Upstream fix: **spur-new task 0960**. The project-first branch will run only inside the spur source repo (marker `config/plugin-scripts.json`, which knowledge-kit does not have). Every other project resolves only through `superskill script path sp <rel>`. At run start spur prints one warning naming an ignored vendored `plugins/sp/scripts/`, and that warning is this task's trigger. 0960 also adds the missing twin fallback to spur's shipped `feature-verification.yaml:56`, which currently runs `bun plugins/sp/scripts/feature-verification-steps.ts` unconditionally and is the likeliest reason vendoring started.

The vendoring was never needed. `superskill install sp` failed here with `Plugin 'sp' not found. Available: kk` only because `--marketplace` was omitted. The supported command is `superskill install sp --marketplace gobing-ai/spur` (add `--no-global` for a project-level install under `.agents/scripts/sp/`).

References that must be handled with the deletion (found with `rg 'plugins/sp/scripts'` on 2026-09-26):
- `.spur/workflows/feature-verification.yaml:56`: a project-local override of spur's workflow. It differs from the shipped one only in `verificationCmd` (`bun run spur-check` against `spur-check-feature`) and a missing `terminalReason: failed-check`. It calls the vendored script unconditionally.
- `plugins/sp/scripts/feature-dev-precheck.{ts,mjs}`: project-only and orphaned (referenced only by themselves).
- `.spur/rules/boundary/shipped-script-isolation.yaml` (:18, :24) and `.spur/rules/typescript/output-boundaries.yaml:9`: rule scopes and comments that name the vendored paths.
- `docs/00_ADR.md:767`: prose precedent citing spur-new's scripts. It is historical and stays.

### Requirements

- [ ] R1. Precondition: the installed spur CLI includes spur-new task 0960. Confirm it by running any task pipeline and checking that `.spur/run/<runId>-script-root.json` exists with `mode: "installed"` and that the vendored-dir warning is printed.
- [ ] R2. `superskill install sp --marketplace gobing-ai/spur` succeeds, and `superskill script path sp inline-run-setup.mjs --json` resolves.
- [ ] R3. `.spur/workflows/feature-verification.yaml` no longer references `plugins/sp/scripts/`. Either delete the override so spur's shipped workflow is used, or keep it only for `verificationCmd` and resolve the script through `superskill script path sp feature-verification-steps.mjs`, with a fail-closed branch.
- [ ] R4. `plugins/sp/` (scripts and lib) is deleted, including the orphaned `feature-dev-precheck.{ts,mjs}`.
- [ ] R5. Rule files whose scope or comments name the vendored paths are updated or retired, so no rule targets a path that no longer exists.
- [ ] R6. One task pipeline run, one wrapup run and one feature-verification run complete without the vendored-dir warning and with `script-root.json` `mode: "installed"`.

### Acceptance Criteria

- [ ] AC1 — The installed spur prints the vendored-dir warning before the change (req: R1)
- [ ] AC2 — The superskill install succeeds and the twin resolves (req: R2)
- [ ] AC3 — `rg 'plugins/sp/(scripts|lib)' --hidden -g '!.git' -g '!docs/00_ADR.md' -g '!docs/tasks/**'` returns nothing (req: R3, R4, R5)
- [ ] AC4 — Task, wrapup and feature-verification runs pass with no warning and record `mode: "installed"` (req: R6)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

- [ ] 1. Wait for spur-new 0960 to ship, upgrade spur, and confirm the warning appears (R1).
- [ ] 2. `superskill install sp --marketplace gobing-ai/spur`; verify `script path` resolves (R2).
- [ ] 3. Decide whether to delete or reduce `.spur/workflows/feature-verification.yaml` (R3). Deleting it is preferred if `spur-check-feature` suits this repo; otherwise keep only the `verificationCmd` difference.
- [ ] 4. `git rm -r plugins/sp` (R4); update the two rule files (R5).
- [ ] 5. Run the three pipelines and record `script-root.json` in Testing (R6).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
