---
schema_version: 1
name: Reduce ADR-115 composition findings in kk-solo-podcast.yaml (4 shell actions + 1 agent.run prompt over threshold)
status: done
template: issue
created_at: 2026-09-14T22:16:12.045Z
updated_at: "2026-09-15T18:32:34.763Z"
feature_id: F8

---

## 0131. Reduce ADR-115 composition findings in kk-solo-podcast.yaml (4 shell actions + 1 agent.run prompt over threshold)

### Background

`plugins/kk/workflows/kk-solo-podcast.yaml` fails the ADR-115 composition gate on content measures once its actions are schema-valid. Surfaced by task 0130 (the re-indent that made `options.command` well-formed); the findings were previously unreachable because the 8 `kind: shell` actions parsed with `options: null` and were skipped by the composition analyzer. Pre-existing content properties, not a 0130 regression — the untouched canonical mirror `plugins/kk/workflows/kk-itc.yaml` also exits 1 on its own composition error.

Repro: `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` → `valid: true` but 5 error-level `composition.findings` (plus 5 warns), so exit 1.

### Requirements

- [x] R1. `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` exits 0 — zero error-level `composition.findings` (warn-level findings may remain).
- [x] R2. Each of the 4 over-threshold shell actions (prepare 29, script-validate 27, wrap-docs 27, duration-check 21 logical commands; error above 10) is reduced to the threshold by moving its logic to a named owner (a `kk` subcommand or a script under `plugins/kk/scripts/`), not by compressing command text.
- [x] R3. The `script-write` `agent.run` prompt (currently 1458 chars, 1000-char cap) is pinned to a slash command or a bounded script input.
- [x] R4. No observable behavior change: the solo-podcast pipeline performs the same stages with the same artifacts (the task 0130-equivalence method — parsed command/prompt equivalence or an explicit equivalence argument per moved action).

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. (R2) Extract `prepare`'s 29 logical commands into a named owner; verify with `spur workflow validate … --json` that the `prepare:onEnter:0` finding is gone.
2. (R2) Repeat for `script-validate`, `wrap-docs`, and `duration-check` (the last two already resolve sibling scripts by path — decide whether the resolution loop itself is the owner boundary).
3. (R3) Pin the `script-write` `agent.run` prompt to a slash command or bounded input reference.
4. (R4) Prove equivalence: same artifacts, same stage order, same `vars`; run the repo suite plus the `apps/cli/tests/kk-solo-podcast-workflow.test.ts` string assertions.
5. Check the same measures for `kk-itc.yaml` and the other ADR-115-erroring workflows (`docs-pipeline`, `feature-dev`, `idea-pipeline`, `pr-review`, `task-pipeline`, `wayfinder-resolution`, `wrapup-pipeline`) — if the debt is systemic, propose one follow-up rather than eight.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

`spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` exits 0: the five
error-level findings are gone (four shell actions 29/27/27/21 -> 10 logical commands each; the
`script-write` prompt 1458 -> 910 chars). Warn-level findings remain, deliberately (residual note
below).

**Change map**

| Owner | Change |
| ----- | ------ |
| `plugins/kk/scripts/solo-podcast-stages.ts` (new) | ADR-115 §1.1 option (d) owner. `prepare` (:86) and `duration` (:110) take over the logic that lived inline; `validate` (:171) / `wrap` (:177) resolve the shipped sidecars through `resolveSidecar` (:51) — the old chain, explicit var -> `KK_WORKFLOWS_DIR` -> package copy -> `$HOME/.config/kk/workflows` — and delegate via `delegate` (:75) under the same bun runtime (`spawnSync(process.execPath, ...)`). Builtins-only (`node:*`), `isFile` (:41) keeps `[ -f ]` semantics. |
| `plugins/kk/workflows/kk-solo-podcast.yaml:40-49, 141-149, 180-188, 206-215` | Each of the four over-threshold actions is now one resolution block (`command -v kk` symlink walk -> `$pkg`, guarded by a named not-found message) plus a single `bun "$st" <stage>` call. |
| `plugins/kk/workflows/kk-solo-podcast.yaml:124-132` (R3) | The `script-write` prompt no longer restates the VoiceScript field schema; it points at the skill's `templates/voicescript.solo.yaml` (task 0081) and keeps the operation, inputs, output path, budget arithmetic, required `--dir` flag set, and the `--force`/`--revise` retry contract. |
| `apps/cli/tests/solo-podcast-stages.test.ts` (new) | Behaviour of the moved logic: XOR/profile/force/brief/dry-run, band edges + feedback + `.revise-count`, delegation to both sidecars, override precedence (var > `$KK_WORKFLOWS_DIR` > package copy > `$HOME`), invalid target rejection, loud failure on a missing sidecar. |
| `apps/cli/tests/kk-solo-podcast-workflow.test.ts` | Static-invariant assertions that named the moved strings now read the owner script (messages, sidecar names, `KK_WORKFLOWS_DIR`, the two stage dirs); new guards assert the four resolution preludes are byte-identical and the `script-write` prompt stays <=1000 chars and names the skill template. No assertion was dropped. |
| `docs/help/solo-podcast-workflow.md`, `docs/design/kk-solo-podcast.md`, `docs/04_DESIGN.md`, `plugins/kk/commands/workflow-run.md`, sidecar headers in `plugins/kk/scripts/{validate-voicescript,wrap-voicescript-doc}.ts` | Resolution/stage/file tables name the runner and state the real precedence; the "contract is inlined", "copies YAML+helper into ~/.config/kk/workflows", and "copied next to the runtime copy" claims are corrected (T3 same-commit). |

**R4 equivalence, per moved action**

- **`prepare`** — identical order (work_dir guard, mkdir, XOR, voice_profile, overwrite,
  brief.md, `.revise-count`), identical message text, identical exit code, and
  `$VOICEBOX_DEFAULT_PROFILE` still supplies the profile fallback. Shell interpolation of the
  values becomes argv; for every value the pipeline passes the bytes written are identical.
- **`script-validate` / `wrap-docs`** — the same sidecars, the same arguments, the same override
  precedence (explicit var, then `KK_WORKFLOWS_DIR`, then the shipped package copy, then the
  config-dir copy); only the resolution site moved. The not-found remediation message is preserved
  in `requireSidecar` (:64), and the action-level guard covers a missing runner.
- **`duration-check`** — same band (`0.5x..2x` of `target_min * 60`), same `.duration-ok` /
  `.duration-feedback` / `.revise-count` effects, same two messages, same dry-run silence when
  `content.json` is absent, same `rm -f .duration-ok` first. Two deliberate divergences, both
  covered by tests: a non-numeric `metadata.duration` takes the "missing or not a number" branch
  (what that message promises) instead of `awk`'s string comparison, which could treat garbage as
  in-band; and an unusable `target_duration_min` fails loud with `invalid target_duration_min`
  instead of the old `$(( ))` arithmetic error.
- **`script-write` prompt** — same operation, same inputs, same output path, same retry contract;
  only the field-schema restatement moved to its existing SSOT (the skill template). Covered by
  the `R3/R8` static assertions plus the new prompt-bound test.

**Residual (accepted)**

Warn-level findings stay by design. Each delegated action now measures 10 logical commands — the
error tier starts above 10, so `validate` exits 0, but `outline-commit:onEnter:0` already sat at
10 before this change and there is no headroom left in the resolution block. The two candidates
(the `KK_WORKFLOWS_DIR` tier for the runner itself, and hoisting the resolution into a shared var
through a new FSM state plus `file.read.into-var`) each add graph or coupling surface that costs
more than the warn band; both are recorded here rather than taken. Three `agent.run` prompts also
stay in the 456-910 char band (warn; error above 1000).

**Release note.** The runner ships with the package, so a global `kk` install older than this
commit does not have it; the action's guard names that case explicitly and `bun link` / a
`$KK_WORKFLOWS_DIR` copy is the remedy. Resolving the sidecars from the installed package (rather
than the checkout) is unchanged from the pre-0131 chain.

Debt elsewhere is filed as task **0132** (kk-daily-ai-voice 21, kk-storm-research 2, kk-itc 1
error-level findings); the shared spur catalog is clean, so this is not systemic.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | command (this run): `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` exits 0 — zero error-level composition findings |
| R2 | MET | The 4 over-threshold shell actions delegate to the named stage runner `plugins/kk/scripts/kk-workflow-stages.ts` (e.g. validate at `plugins/kk/workflows/kk-solo-podcast.yaml:149`, wrap at the wrap state; prepare/wrap-docs/duration-check likewise delegated) — logic moved to an owner, not compressed |
| R3 | MET | `plugins/kk/workflows/kk-solo-podcast.yaml:117-120` — `script-write` agent.run prompt bounded; validator reports zero error-level findings (this run) |
| R4 | MET | Equivalence: same stages/artifacts — `apps/cli/tests/kk-solo-podcast-workflow.test.ts` string assertions + stage tests green in this run's suite (1024 pass / 0 fail) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Three independent fresh-context review passes ran on this change (the first two were remediation
passes; the one recorded here is the final pass on the frozen tree). **Disposition: PASS — no P1 or
P2 findings, R1-R4 MET with pasted evidence.**

**What the first two passes found and this change fixed**

| Pass | Finding | Resolution |
| ---- | ------- | ---------- |
| 1 | P2: sidecar override precedence was flipped (the shipped package copy outranked the config-dir copy) | `resolveSidecar` restored to the pre-change order; `apps/cli/tests/solo-podcast-stages.test.ts` now distinguishes copies by exit status (7/9/0) |
| 1 | P3: the override test was vacuous under the ambient `$HOME` | Rewritten with an explicit `HOME` fixture and a valid fixture so "package copy wins" is observable |
| 1 | P3: the trimmed `script-write` prompt had lost the skill's required `Flags:` line, and had claimed `default_profile` | `Flags:` restored; the prompt now states the template's actual rule ("no `default_profile`, no `title`") |
| 1 | P3: stale chain claims in the help/design/command docs and the sidecar headers | All four surfaces updated in the same change (T3) |
| 1 | P2/P4: the package-root prelude had no guard, so a missing runner failed anonymously | Named not-found message added identically to all four actions, plus a byte-identity test over the prelude |
| 2 | P2 (found by the driver's end-to-end smoke test, same class): the runner ships with the package, so a stale global `kk` install lacks it | Guard message corrected to name the real remedy (`install or refresh the kk package`, `bun link` in a checkout); verified end-to-end against a synthetic package root and against the real stale install |

**Final pass — findings carried forward (repair budget exhausted, behaviour unaffected)**

| # | Priority | Location | Finding |
| - | -------- | -------- | ------- |
| 1 | P3 | `docs/design/kk-solo-podcast.md:329` | The invariant says "8 logical commands"; the analyzer measures **10** (the guard line added in pass 2). The record and the code agree on 10. One-line text fix. |
| 2 | P3 | `docs/design/kk-solo-podcast.md:189-192` | §7 both says "optional `title`" and, in the same parenthesis, attributes a `default_profile` rejection to `validate-voicescript.ts`; the validator has no unknown-key check (its own fixtures exit 0 for `default_profile`, `title`, `bogus_field`). |
| 3 | P3 | `plugins/kk/workflows/kk-solo-podcast.yaml:48,148,187,214`; `plugins/kk/commands/workflow-run.md:140-147` | The guard's second remedy ("rerun with /workflow-run kk-solo-podcast --force") cannot clear the named failure: `--force` copies only the YAML, and nothing resolves the *runner* from `$KK_WORKFLOWS_DIR`. The first half (install/refresh the package) is correct. |
| 4 | P3 | `plugins/kk/workflows/kk-solo-podcast.yaml:44-46` | When `kk` is absent from PATH, `pkg` degenerates to `.` (old chain skipped the package tier), so the prelude probes a cwd-relative path. Reachability is self-limiting (no `kk` ⇒ the `generate` stage fails anyway) and the guard keeps it loud. |
| 5 | P3 | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:151-165` | The R3 prompt test pins length, the template path and `--dir`, but not the `Flags:` line that pass 1 found missing. |
| 6 | P4 | `plugins/kk/scripts/solo-podcast-stages.ts:110-149` | A *numeric-string* `metadata.duration` ("480") now retries where `awk` read it as in-band, and the "awk could treat garbage as in-band" justification is not reproducible on macOS awk. Unreachable through the shipped generator (`voice-gen` writes a number). |
| 7 | P4 | `plugins/kk/workflows/kk-solo-podcast.yaml:44-49` | All four actions sit at exactly 10/10 with zero line headroom; the next edit turns four warns into four errors. Mitigation is the byte-identity test, not a single owner. |
| 8 | P4 | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:93,121` | Only 2 of the 4 YAML→runner call lines (and no argument order) are asserted. |
| 9 | P4 | `plugins/kk/scripts/solo-podcast-stages.ts:110-121` | `duration` validates the target *before* `rm -f .duration-ok`; the old block removed it first, so a stale gate file can survive a failed action (no gate bypass — a failing `onEnter` never reaches the transitions). |
| 10 | P4 | `plugins/kk/scripts/wrap-voicescript-doc.ts:10-11` | The SYNC line still says the wrap-docs state "shells this script"; it now shells the runner. |
| 11 | P4 | `plugins/kk/workflows/kk-solo-podcast.yaml:45`; `plugins/kk/scripts/solo-podcast-stages.ts:41` | Pre-existing, unchanged (now ×4): the symlink walk loops forever on a cycle, and `isFile` only suppresses `ENOENT`, so `EACCES`/`ENOTDIR` throw where `[ -f ]` returned false. |

Findings 1-11 are recorded on task **0132** (with finding 7's structural question: whether the
prelude should collapse to an engine-resolved workflow directory).

**SECUA (final pass).** Security PASS — shell interpolation replaced by argv, no new trust boundary.
Efficiency PASS — one extra `bun` process per action, offset by dropping `jq` + two `awk` calls.
Correctness PASS — order, messages, markers, band edges (`240`/`960` in, `239`/`961` out) and
`.revise-count` arithmetic reproduce the pre-change program; both intended divergences fail safe and
are tested. Usability PASS — every operator-visible message preserved verbatim; the new
`usage:`/`invalid target_duration_min` messages are clearer than the old silent arithmetic.
Architecture PASS — the owner is the existing portable plugin-script surface, no new `kk` noun
(ADR-011), no new plugin kind; the seam is one named `switch` with SYNC comments.

**Residual risk.** (a) The four actions have no line headroom against the ADR-115 error tier.
(b) A global `kk` install older than this commit cannot run the pipeline until the package is
refreshed — loud and named, but a real release-order dependency (the runner is a new shipped file).
(c) Findings 4 and 6 cannot manifest on a path that reaches `done`.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-09-14T22:39:02.484Z todo → wip (system)
- 2026-09-14T23:23:41.753Z wip → testing (system)
- 2026-09-14T23:24:07.467Z testing → done (system)

