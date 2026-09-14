---
schema_version: 1
name: Reduce ADR-115 composition findings in the remaining kk workflows (kk-daily-ai-voice 21, kk-storm-research 2, kk-itc 1)
status: todo
template: issue
created_at: 2026-09-14T22:38:03.257Z
updated_at: "2026-09-14T23:23:31.785Z"
feature_id: F8

---

## 0132. Reduce ADR-115 composition findings in the remaining kk workflows (kk-daily-ai-voice 21, kk-storm-research 2, kk-itc 1)

### Background

Follow-up from task 0131 (Plan step 5: "if the debt is systemic, propose one follow-up rather than
eight").

Task 0131 fixed `plugins/kk/workflows/kk-solo-podcast.yaml` (5 error-level findings -> 0). The same
ADR-115 composition measures still fail the other product workflows in this repo. Measured
2026-09-14 with `spur workflow validate <file> --json` (exit 1 = at least one error-level finding):

| Workflow | error-level findings |
| -------- | -------------------- |
| `plugins/kk/workflows/kk-daily-ai-voice.yaml` | 21 |
| `plugins/kk/workflows/kk-storm-research.yaml` | 2 (`prepare:onEnter:0`, `render:onEnter:0`) |
| `plugins/kk/workflows/kk-itc.yaml` | 1 (`prepare:onEnter:0`) |

The shared/bundled workflow catalog (`/Users/robin/xprojects/spur-new/config/workflows/*.yaml`) is
already clean — 0 error-level findings across all eleven definitions — so this debt is local to the
kk product workflows, not systemic to the harness.

The kk-itc / kk-storm-research `prepare` actions look like the same inline-mkdir/XOR block that
0131 moved into `plugins/kk/scripts/solo-podcast-stages.ts`; the fix there is a decision on whether
to share one stage runner across the three workflows or to give each its own owner script, plus the
same fix vocabulary (ADR-115 §1.1 (a)-(d)) for kk-daily-ai-voice's 21 actions.

### Requirements

<!-- R-numbered expectations for the fix. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Decide the owner shape for the three remaining `prepare` actions before writing anything: if
   `kk-itc` / `kk-storm-research` / `kk-daily-ai-voice` still carry the same inline mkdir+XOR+brief
   block, either generalise `plugins/kk/scripts/solo-podcast-stages.ts` into one shared
   `workflow-stage` runner or give each workflow its own script — do not copy the 10-command
   resolution prelude four more times.
2. Fix `kk-itc` and `kk-storm-research` first (1 + 2 error-level findings each, same shape as 0131).
3. Then `kk-daily-ai-voice` (21 error-level findings) via the ADR-115 §1.1 vocabulary; it is large
   enough to need its own decomposition into sub-tasks.
4. Keep `spur workflow validate <file> --json` exit 0 as the per-file gate, and add the same
   byte-identical-prelude test 0131 introduced (it is what keeps a 10-command block from drifting
   to 11 when a resolution line changes).

#### Carried over from task 0131 (recorded by its final review; behaviour-neutral, repair budget spent)

1. `docs/design/kk-solo-podcast.md:329` — the invariant says "8 logical commands"; the analyzer
   measures 10. One-line text fix.
2. `docs/design/kk-solo-podcast.md:189-192` — §7 both says "optional `title`" and attributes a
   `default_profile` rejection to `validate-voicescript.ts`; the validator has no unknown-key check
   (its fixtures exit 0 for `default_profile`, `title`, `bogus_field`). Correct the claim or add the
   check deliberately.
3. `plugins/kk/workflows/kk-solo-podcast.yaml:48,148,187,214` and
   `plugins/kk/commands/workflow-run.md:140-147` — the guard's second remedy ("rerun with
   /workflow-run kk-solo-podcast --force") cannot clear the named failure: `--force` copies only the
   YAML, and nothing resolves the *runner* from `$KK_WORKFLOWS_DIR`. Drop that clause or implement
   the tier.
4. `plugins/kk/workflows/kk-solo-podcast.yaml:44-46` — with `kk` absent from PATH, `pkg` degenerates
   to `.` where the older chain skipped the package tier entirely.
5. `apps/cli/tests/kk-solo-podcast-workflow.test.ts:151-165` — the R3 prompt test pins length, the
   template path and `--dir`, but not the `Flags:` line whose loss the first review caught.
6. `plugins/kk/scripts/solo-podcast-stages.ts:110-149` — a numeric-string `metadata.duration`
   ("480") now retries where `awk` read it in-band; unreachable through the shipped generator. Align
   the code or the `## Solution` justification.
7. Structural: all four delegated actions sit at exactly 10/10 logical commands with no headroom.
   Decide whether the prelude collapses into one `pkg`-resolution line plus per-stage calls, an
   engine-resolved workflow directory (would need a spur feature), or a shared loop-local var —
   and whether the warn ceiling itself should be renegotiated. Relates to the same question in item 1.
8. `apps/cli/tests/kk-solo-podcast-workflow.test.ts:93,121` — only 2 of the 4 YAML→runner call lines
   (and no argument order) are asserted.
9. `plugins/kk/scripts/solo-podcast-stages.ts:110-121` — `duration` validates the target before
   `rm -f .duration-ok`, so a stale gate file survives a failed action (no gate bypass).
10. `plugins/kk/scripts/wrap-voicescript-doc.ts:10-11` — the SYNC line still says the wrap-docs state
    "shells this script"; it now shells the runner.
11. Pre-existing, unchanged (now ×4): the `command -v kk` symlink walk loops forever on a cycle, and
    `isFile` suppresses only `ENOENT`, so `EACCES`/`ENOTDIR` throw where `[ -f ]` returned false.

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
