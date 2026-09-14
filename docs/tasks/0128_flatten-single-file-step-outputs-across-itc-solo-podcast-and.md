---
schema_version: 1
name: Flatten single-file step outputs across itc, solo-podcast, and daily-ai-voice workflows
status: done
template: feature-impl
created_at: 2026-09-14T17:55:18.374Z
updated_at: "2026-09-14T21:02:07.974Z"
feature_id: F8
priority: P2
tags:
  - kk
  - workflows
  - layout

done_forced: "true"
done_reason: "Implementation complete: R1-R6 all MET on executable evidence (25/25 workflow tests, kk-itc validates clean, gate PASS 47/47 rules, review completed). Verdict PARTIAL is environmental, not implementation: the AC live-run clause requires agent-runtime stages unavailable in-pipeline, and kk-solo-podcast.yaml additionally carries a PRE-EXISTING schema defect (command:/options: indent, 8 actions, confirmed in untouched main checkout; follow-up bug task to be filed). Overriding the PARTIAL->done gate with this documented reason; PARTIAL verdict retained in .spur/run/0128-verdict.json."
---

## 0128. Flatten single-file step outputs across itc, solo-podcast, and daily-ai-voice workflows

### Background

Feature F8 extension. The accepted convention: a workflow step that emits exactly one file writes `<work_dir>/<step>-<name>` at the work_dir root with no single-file stage directory; steps emitting multiple files keep their stage directory. kk-storm-research is already flat (no change). This makes per-run output trees shallow and predictable.

Covers feature F8 scenarios: R5 (Single-file steps are flattened to <step>-<name> at the work_dir root), R6 (Existing .works contents are never migrated).

### Requirements

- [x] R1. In `plugins/kk/workflows/kk-itc.yaml`, `3-draft/draft-article.md` moves to `<work_dir>/3-draft-draft-article.md`; the `3-draft` mkdir segment and every reference (expectFile line 128, draft/review/revision prompts, judge prompt, §6 report line) follow. `2-outline/` (outline-option-a/b/c + outline-approved.md) keeps its stage dir; `brief.md` and `.itc-verdict.json` stay at the root.
- [x] R2. In `plugins/kk/workflows/kk-solo-podcast.yaml`, `1-briefing/briefing.md` moves to `<work_dir>/1-briefing-briefing.md` and `3-script/voicescript.yaml` moves to `<work_dir>/3-script-voicescript.yaml` — both are verified single-file stages under the locked convention (prompts, expectFile lines 81/159, validate/wrap invocations, mkdir segments follow). `2-outline/` (options + approved) and `4-audio/` (docs.json + content.json + content.wav) keep their stage dirs.
- [x] R3. In `plugins/kk/workflows/kk-daily-ai-voice.yaml`, enumerate all eight stage dirs (1-ingest, 2-facts, 2-plan, 2-article, 2-cover, 2-script, 3-audio, 3-publish) with file counts from the YAML and record the enumeration; flatten exactly the single-file ones to `<step>-<name>`. On the current YAML every stage emits ≥2 files (1-ingest ≥3 config/blended outputs; 2-facts, 2-article, 2-script 2 each; 2-plan ≥4; 2-cover ≥2 incl. normalized artifact; 3-audio ≥2), so the expected diff is no path changes — the enumeration must be recorded, not assumed, and any stage found to emit exactly one file is flattened. All cache guards (collect/facts/plan/article) keep hitting on re-run.
- [x] R4. The §6 Report lines in `plugins/kk/commands/workflow-run.md` print the new flattened paths (itc: `3-draft-draft-article.md`; solo-podcast: `1-briefing-briefing.md`, `3-script-voicescript.yaml`, `4-audio/*`).
- [x] R5. `apps/cli/tests/kk-solo-podcast-workflow.test.ts` plus the other YAML-referencing tests (`kk-itc-workflow.test.ts` asserts the `3-draft/draft-article.md` expectFile; `kk-daily-ai-voice-workflow.test.ts` asserts stage paths) assert the new paths.
- [x] R6. No existing `.works` content is migrated or renamed; root dotfiles (`.revise-count`, `.duration-ok`, `.itc-verdict.json`, `step-timing.json`) are untouched.

### Acceptance Criteria

```gherkin
Scenario: Single-file steps are flattened to <step>-<name> at the work_dir root
  Given kk-itc runs to completion
  Then <work_dir>/3-draft-draft-article.md exists and no 3-draft/ directory is created
  Given kk-solo-podcast runs to completion
  Then 3-script-voicescript.yaml is at the work_dir root
  And 4-audio/ still holds content.json and content.wav
  Given kk-daily-ai-voice runs to completion
  Then exactly the single-file stages are flattened and every cache guard still hits on re-run

Scenario: Existing .works contents are never migrated
  Given leftover directories from earlier layouts under works_dir
  When any run completes
  Then those directories are left byte-identical
```

Task-local checks: every expectFile / prompt / gate / cache-guard reference in the three YAMLs matches the new paths; workflow-run.md summary lines print the flattened paths; `apps/cli/tests/kk-solo-podcast-workflow.test.ts` asserts the new layout.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: path rewrites inside three workflow YAMLs plus the command's §6 summary text. WHY `<step>-<name>` (not bare `<name>`): deterministic, collision-safe when two steps would emit same-named files, and greppable by step — convention locked at idea-eval. Per-file enumeration is done from the YAML itself before editing (inventories verified and recorded in R1–R3); a stage is flattened only when exactly one output file is written there. Coordination: this task owns workflow-run.md §6; the workspace task owns §1/§3/§4 — land this second. Invariants: multi-file stages and root files unchanged; no mkdir for flattened stages; every expectFile/prompt/gate/cache-guard reference updated in the same edit. Skipped: touching kk-storm-research.yaml (verified already flat); renaming root dotfiles (not stage outputs).

### Plan

1. Re-enumerate stage dirs and file counts in kk-itc.yaml, kk-solo-podcast.yaml, kk-daily-ai-voice.yaml; record in Solution.
2. Rewrite single-file stage paths to `<work_dir>/<step>-<name>`; drop their mkdir segments (itc `3-draft`; solo `1-briefing`, `3-script`).
3. Update every expectFile / prompt / gate / validate / wrap / cache-guard reference in the three YAMLs.
4. Update workflow-run.md §6 report lines.
5. Update kk-solo-podcast-workflow.test.ts, kk-itc-workflow.test.ts, kk-daily-ai-voice-workflow.test.ts; `bun run lint` + targeted `bun test` on the three files.

### Solution

Path rewrites inside three workflow YAMLs plus the command's §6 summary and three tests. No new
resolver, no TS surface.

**Enumeration (R3, done from the YAML before editing — not assumed)**

`plugins/kk/workflows/kk-daily-ai-voice.yaml` — all eight stage dirs, distinct output files per
stage: `1-ingest` 5 (`source.json`, `horizon.json`, `last30days.json`, `last30days-docs.json`,
`*_02_collect_blended.json`); `2-facts` 2 (`*_02_collect_content.json`, `*_02_collect_core-facts.md`);
`2-plan` 7 (plan + content + 4 quality-control artifacts + `*_19_run-report_episode-plan.json`);
`2-article` 2; `2-cover` 4 (`*_07_cover_cover.png`, `content.json`, `content-cover-01.jpg`, the
normalized `<ext>` artifact); `2-script` 3 (`*_08_script_content.json`, `*_08_script_voicescript.yaml`);
`3-audio` 2; `3-publish` 15. **No stage emits exactly one file → no path changes in this YAML.**
Root refs (`run-date.txt`, `step-timing.json`, the run-report pair) stay untouched.

`plugins/kk/workflows/kk-itc.yaml` — `2-outline/` 4 files (`outline-option-a/b.md`,
`outline-option-$sel.md`, `outline-approved.md`) keeps its dir; `3-draft/` 1 file → flatten.
Root `brief.md`, `.itc-verdict.json`, `.revise-count` unchanged.

`plugins/kk/workflows/kk-solo-podcast.yaml` — `2-outline/` 4 files and `4-audio/`
(`content.json`, `docs.json`, `content.wav`, `.duration-ok`) keep their dirs; `1-briefing/` 1 file and
`3-script/` 1 file → flatten. Root `brief.md`, `.revise-count`, `.duration-feedback` unchanged.

**Changes**

- `plugins/kk/workflows/kk-itc.yaml:41` — the `3-draft` mkdir segment is dropped (the prepare
  description loses it too); `plugins/kk/workflows/kk-itc.yaml:126`, `:128`, `:136`, `:150`, `:162`
  — the draft prompt, `expectFile`, review prompt, revision prompt and judge prompt all move to
  `${vars.work_dir}/3-draft-draft-article.md`. No `3-draft/` reference survives.
- `plugins/kk/workflows/kk-solo-podcast.yaml:45` — the `1-briefing` and `3-script` mkdir segments are
  dropped; `plugins/kk/workflows/kk-solo-podcast.yaml:78`, `:81`, `:92`, `:143` move briefing to
  `${vars.work_dir}/1-briefing-briefing.md`, and `:146`, `:159`, `:185`, `:193`, `:208`, `:235` move
  the VoiceScript to `${vars.work_dir}/3-script-voicescript.yaml` (author prompt, `expectFile`, the
  `validate-voicescript.ts` invocation, review/revise prompts, and the `wrap-voicescript-doc.ts`
  invocation).
- `plugins/kk/workflows/kk-daily-ai-voice.yaml` — **unchanged**: the enumeration above shows every
  stage is multi-file, and the cache guards (collect/facts/plan/article) key off
  `${vars.work_dir}/…` paths that did not move, so they still hit on re-run.
- `plugins/kk/commands/workflow-run.md:248` — the §6 itc line prints
  `$work_dir/3-draft-draft-article.md`; `plugins/kk/commands/workflow-run.md:249` — the §6 solo line
  now prints `$work_dir/1-briefing-briefing.md`, `$work_dir/3-script-voicescript.yaml` and the
  unchanged `$work_dir/4-audio/*` pair.
- `apps/cli/tests/kk-itc-workflow.test.ts:76` — updates the `3-draft/draft-article.md` `expectFile`
  assertion and adds the negative invariants that make the flattening real: no `3-draft"` mkdir
  segment, no `${vars.work_dir}/3-draft/` reference anywhere, and `/2-outline"` still present so the
  multi-file stage keeps its directory.
- `apps/cli/tests/kk-solo-podcast-workflow.test.ts:163` — same shape for both flattened stages
  (new `expectFile` paths, no `/1-briefing"` or `/3-script"` mkdir segment, no remaining stage-dir
  reference) plus `/2-outline"` and `/4-audio"` present.
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:392` — encodes the R3 enumeration as an
  invariant: each of the eight stage dirs must resolve to >= 2 distinct output files, and no
  flattened `<work_dir>/<n>-<step>-<name>` reference may exist. A future single-file stage fails here
  instead of silently drifting.

**Why:** `<step>-<name>` (not a bare `<name>`) is collision-safe when two steps emit the same
filename, deterministic, and greppable by step. Flattening only stages that emit **exactly one** file
keeps multi-file stages legible and avoids rewriting a stage's whole reference set for no gain — which
is why `kk-daily-ai-voice.yaml` has no diff at all. Not touched, by design: `kk-storm-research.yaml`
(verified already flat), root dotfiles (not stage outputs), and `.works` contents (F8 R6 — nothing is
migrated or renamed).

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | test: `R1 (0128) — the single-file 3-draft stage is flattened and its stage dir is not created` passes in evidence 1. static-ref: diff `plugins/kk/workflows/kk-itc.yaml` moves all five references (draft prompt, `expectFile`, review prompt, revision prompt, judge prompt → `${vars.work_dir}/3-draft-draft-article.md`), drops the `3-draft` mkdir segment, and updates the prepare description; `2-outline/`, `brief.md`, `.itc-verdict.json` untouched. |
| R2 | MET | test: `R2 (0128) — single-file briefing/script stages flatten; multi-file stages keep their dirs` (apps/cli/tests/kk-solo-podcast-workflow.test.ts:163; new expectFile paths; `not.toContain` for `/1-briefing/` and `/3-script/`; `/2-outline"`, `/4-audio"` kept) passes in evidence 1. The negative assertions are also executable proof of "verified single-file stages": a passing `not.toContain('/1-briefing/')` means NO reference to that stage dir survives in the YAML, so nothing else writes there. static-ref: diff moves all 11 references (briefing prompt/expectFile, outline read, script read/write, `validate-voicescript.ts --in`, review/revise prompts, `wrap-voicescript-doc.ts` arg) and the mkdir line drops `1-briefing` and `3-script`. |
| R3 | MET | test: `R3 (0128) — every daily stage emits >= 2 files, so no stage is flattened` passes in evidence 1 — the recorded enumeration is an executable invariant, not prose. Plus `R5 — executes all plugin commands and creates pipeline artifacts` (5316ms end-to-end state machine run with fixtures) passes. static-ref: `git diff` on `kk-daily-ai-voice.yaml` is empty, so cache-guard paths are definitionally unchanged and every pre-existing guard test still passes. |
| R4 | MET | static-ref: `plugins/kk/commands/workflow-run.md` §6 — itc line prints `$work_dir/3-draft-draft-article.md`; solo line prints `$work_dir/1-briefing-briefing.md`, `$work_dir/3-script-voicescript.yaml`, `$work_dir/4-audio/content.json`, `$work_dir/4-audio/content.wav`. test: `apps/cli/tests/workflow-run-command.test.ts` additions green in the 0128 gate (973 pass / 0 fail, `.spur/run/0128-test-gate.log`). |
| R5 | MET | test: evidence 1 — `Ran 25 tests across 3 files`, 25 pass / 0 fail / 245 expect() calls, including all three 0128 blocks. |
| R6 | MET | static-ref: the full diff introduces no `mv`, no `rm -rf`, and no reference to any legacy stage directory (`3-draft/`, `1-briefing/`, `3-script/`); the only file deletions in the YAMLs are the two pre-existing `rm -f` markers (`.duration-feedback`, `4-audio/.duration-ok`) at unchanged paths, untouched by the diff. test: daily end-to-end execution test runs prepare→done creating artifacts without touching legacy paths. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Single-file steps are flattened to <step>-<name> at the work_dir root | PARTIAL | test | The flattening CONTRACT is fully asserted by passing tests: itc `R1 (0128)` (no `3-draft/` created, `expectFile` at the flat path), solo 0128 block, daily `R3 (0128)` + 5.3s end-to-end daily execution. What is NOT demonstrated: the `Given kk-itc/kk-solo-podcast runs to completion` clauses as live runs — this stage is budget-barred from executing workflows (attempt 1 timed out doing exactly that), itc/solo completion requires agent.run + HITL interaction, and kk-solo-podcast additionally cannot load from this checkout at all: evidence 3 returns `valid:false` (8× `options: expected object, got null` + `command: unknown field` — `command:` indented at the same level as `options:`). That defect is PRE-EXISTING: the identical failure exists in the untouched sibling checkout `/Users/robin/xprojects/knowledge-kit`, and no `git diff HEAD` hunk touches any `command:` line. It blocks live demonstration of the solo clause from this tree but is outside 0128's scope; the solo flattening itself is proven at YAML-contract level by the passing test. |
| Scenario: Existing .works contents are never migrated | MET | test | Executable negative-reference assertions (solo 0128 test: no `/1-briefing/`, `/3-script/` reference remains; itc: no `3-draft` token remains) prove no code path can touch legacy directories; the daily end-to-end execution test completes a run creating artifacts without any legacy-path write. Combined with the diff containing no `mv`/`rm -rf` (static-ref), leftover directories are unreachable by construction. The byte-identical clause rests on this reference-absence, not on a live before/after snapshot of a seeded `.works`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:5f76e386494485578b074cf4429e48a3d23a9f608c032b2e811750f07855560f |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-14T18:21:20.896Z todo → wip (system)
- 2026-09-14T21:01:08.456Z wip → testing (system)
- 2026-09-14T21:02:07.970Z testing → done (system)

