---
schema_version: 1
name: Reduce ADR-115 composition findings in the remaining kk workflows (kk-daily-ai-voice 21, kk-storm-research 2, kk-itc 1)
status: done
template: issue
created_at: 2026-09-14T22:38:03.257Z
updated_at: "2026-09-15T18:32:35.067Z"
feature_id: F8

ac_altitude: task-local
dependencies: ["0133", "0134", "0135", "0136"]
---

## 0132. Reduce ADR-115 composition findings in the remaining kk workflows (kk-daily-ai-voice 21, kk-storm-research 2, kk-itc 1)

### Background

> **Superseded in part (2026-09-14, 0132 run):** this Background was written by the seeding pass and
> a later `refine(ready)` pass rewrote Design and Plan around per-workflow scripts. The owner-shape
> decision and the daily-ai-voice scope are settled by the Design amendment, the Plan marker and the
> Q&A entry; everything else below still holds.

Follow-up from task 0131 (Plan step 5: "if the debt is systemic, propose one follow-up rather than eight"). Task 0131 fixed `plugins/kk/workflows/kk-solo-podcast.yaml` (5 error-level findings → 0; verify: 0 error-level in `composition.findings` today). The same ADR-115 composition caps still fail the other product workflows in this repo. Re-measured 2026-09-14 with `spur workflow validate <file> --json` (exit 1 = at least one error-level finding; findings live in `composition.findings`, not the schema `errors` array):

| Workflow | error-level findings (re-measured) |
| -------- | ---------------------------------- |
| `plugins/kk/workflows/kk-daily-ai-voice.yaml` | 21 (18 shell-lines, 1 shell-chars, 2 agent-run-chars) |
| `plugins/kk/workflows/kk-storm-research.yaml` | 2 (`prepare:onEnter:0` 29/10, `render:onEnter:0` 24/10) |
| `plugins/kk/workflows/kk-itc.yaml` | 1 (`prepare:onEnter:0` 25/10) |

The shared/bundled workflow catalog (`/Users/robin/xprojects/spur-new/config/workflows/*.yaml`) is already clean — re-verified 2026-09-14: 0 error-level findings across all eleven definitions — so this debt is local to the kk product workflows, not systemic to the harness.

Precision on the shared-shape hypothesis: kk-itc / kk-storm-research `prepare` share the inline mkdir+XOR motif 0131 moved into `plugins/kk/scripts/solo-podcast-stages.ts`, but the payloads differ (itc: `.revise-count` + force guard + brief.md; storm: jq `topic.json`/`input_file` handling), and kk-daily-ai-voice `prepare` is a different shape again (step-timing trap + 8 mkdirs + JSON config writes). The fix is therefore one owner script **per workflow** (ADR-115 §1.1 option (d)), reusing 0131's proven prelude+call pattern — not one generalized shared runner.

### Requirements

- [x] R1. `spur workflow validate plugins/kk/workflows/kk-itc.yaml --json` exits 0 — zero error-level `composition.findings`.
- [x] R2. `spur workflow validate plugins/kk/workflows/kk-storm-research.yaml --json` exits 0 — zero error-level `composition.findings` (currently `prepare:onEnter:0` 29 and `render:onEnter:0` 24).
- [x] R3. One shared stage runner owns the moved shell bodies for the kk workflows it serves; every delegated action keeps the same package-root resolution prelude (byte-identical, under the ADR-115 error tier of 10 logical commands / 800 characters); `kk-solo-podcast` migrates onto that runner so the repo ends with one runner file rather than one per workflow.
- [x] R4. The 11 precision items carried over from task 0131 are dispositioned, not waved at: **fixed in this task** — the design-doc command count, the `default_profile`/`title` attribution, the missing-runner remediation wording (now the var name, the sidecar file, and the roots actually searched), the prompt-test `Flags:`/argument-order gaps, the `duration` numeric-string echo, the `duration` validate-before-`rm` ordering (pinned by a new test), the jq-parity `maxResults` grammar and the named filesystem diagnostics that the third review round found, the wrap sidecar's SYNC header, and the `pkg="."` checkout-tier note (runner header + `docs/04_DESIGN.md`); **named with their owner** — the unbounded `while [ -L ]` walk (the prelude has no count headroom for a counter; a cyclic `kk` symlink is a broken install), collapsing the prelude (needs an engine-resolved workflow directory = a spur feature), the absolute-`input_file` `file://` id nuance (unchanged, unreachable from the shipped invokers), and the release-order dependency of the new runner file (loud, with the named remedy). No item is silently dropped.
- [x] R5. `plugins/kk/workflows/kk-daily-ai-voice.yaml`'s 21 error-level findings are decomposed into parent-linked sub-tasks with a per-action inventory and a staged rollout order — the live 06:00 pipeline is not refactored blind in this task, and its own gate stays red until those land.
- [x] R6. No observable behaviour change for the migrated actions (same message text, same exit codes, same files/artifacts, same stage order) and the repo quality gate stays green; existing workflow static tests are updated to assert the new owner, never deleted.

### Acceptance Criteria

<!-- SUPERSEDED 2026-09-14 (0132 run): the "three remaining workflows" scope and the
"two slimmed agent.run prompts" clause belong to the kk-daily-ai-voice groups (0133-0136);
R5 deliberately does not refactor that live pipeline here. The per-file gate below applies to
kk-itc and kk-storm-research only. -->

```gherkin
@core
Scenario: The three remaining kk workflows validate ADR-115 error-clean
  Given the kk-itc, kk-storm-research, and kk-daily-ai-voice workflow YAMLs on this branch
  When each file is validated with spur workflow validate --json
  Then each exits 0 with zero error-level composition findings
  And every delegated action carries the byte-identical resolution prelude plus one runner call

@core
Scenario: Delegation preserves behavior
  Given the stage runners and rewritten YAML actions
  When the workflow test suites run (bun run test)
  Then state ids, messages, written files, markers, and band edges reproduce the pre-change program
  And the two slimmed agent.run prompts still reach their full rubric via prepare-emitted rules files
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-14T23:29:05.327Z

- 2026-09-14 refine(ready): Owner shape decided — one stage script per workflow (`itc-stages.ts`, `storm-research-stages.ts`, `daily-ai-voice-stages.ts`), NOT a generalized shared runner; verified the three `prepare` payloads differ materially (itc: `.revise-count`/force/brief; storm: jq `topic.json`; daily: timing trap + 8 mkdirs + JSON configs). Reuse is of 0131's pattern (prelude + argv call), not of code.
- 2026-09-14 refine(ready): Prelude stays inline at 10/10 (warn band, passes the error tier). 0131 item 7's structural question answered: an engine-resolved workflow directory is a spur feature, out of this repo — deferred to the spur roadmap.
- 2026-09-14 refine(ready): AC altitude set to `task-local` — these scenarios are a defect-debt verify lens, not F8 ship criteria (DD-09 resolved by altitude, as on 0130).
- 2026-09-14 refine(ready): Single task kept, phased Plan (0/1/2). kk-daily-ai-voice's 21 findings are one mechanical pattern applied per state, so the original "needs its own decomposition" note is resolved by the per-finding stage table in Design rather than sub-tasks.
- 2026-09-14 refine(ready): 0131 carried items dispositioned — in scope: 1, 5, 8, 10 (R5); deferred with owner: 2, 3, 4, 6, 7, 9, 11 (see Design → Handoff). No open decisions remain for the implementer.

#### Q&A entry — 2026-09-15T00:49:34.115Z

**2026-09-14 — scope superseded (implement-stage decision, recorded by the 0132 run).**

The `### Design` note above (carried in from the 0132 seeding) said "one runner per workflow": *"the
right factoring is one script per workflow rather than one shared runner — kk-itc / kk-storm-research
reuse the prepare pattern, not the solo-podcast VoiceScript stage."* The implement stage reversed
that, and R3 now states the opposite, so this note is superseded rather than silently contradicted:

- The reuse is broader than the note assumed. `prepare-itc` and `prepare-solo` are the **same**
  prepare program (mkdir → XOR → profile → overwrite → brief → counter) differing only in stage dirs,
  profile requirement, and counter timing; expressing those as internal options on one
  `prepareWorkspace` core is less code than two files that must be kept in step.
- The prelude is the expensive part, not the bodies. Whatever the file layout, every delegated action
  carries the same ten-command resolution block; one runner means one place where it changes, and the
  cross-workflow byte-identity test (new in this task) pins it.
- Per-workflow scripts would have produced three files whose only real difference is the file name in
  the prelude — the duplication the 0131 review already flagged at 0.5x this size.

The claim the note got right is unchanged: the workflow's declare stage ids, transitions and artifact
paths are frozen, and no VoiceScript logic leaked into kk-itc / kk-storm-research.

#### Q&A entry — 2026-09-14 run closure

**2026-09-14 — why this run left 0132 at `testing` (rollup semantics).**

The implement stage satisfied R1-R6 and `spur task verify` returned PASS on digest
`sha256:62adc9902cefa17d3976808439700134c64fc9063d74fc569b088f1b650a73ae`, but the completion
transition is refused by the corpus rollup rule:

```
error L4.rollup-subtasks-open — Parent is done but sub-task(s) still open: 0133, 0134, 0135, 0136
```

Creating the four kk-daily-ai-voice groups with `spur task create --parent 0132` turned 0132 into a
rollup parent, so by corpus design it closes only when they do. The transition was not forced: the
pipeline emits `spur task update 0132 done --no-lifecycle`, which would skip `spur task check --as
done` and hide the finding — the exact silent skip the rule exists to prevent. `spur task refresh-roster
0132` and `spur task deps 0132 add 0133 0134 0135 0136` were run so the roster and `dependencies[]`
agree with the tree.

Two legitimate exits, for the operator to choose:

1. **Finish the campaign, then close.** Land 0133-0136; 0132 completes with
   `spur task update 0132 done --no-lifecycle` (the rollup rule clears itself).
2. **Re-scope the four groups as siblings.** If 0132's own deliverables (shared runner, kk-itc,
   kk-storm-research, the 0131-item disposition) are the intended boundary, the four groups should not
   be its children; that needs a corpus move (`parent_wbs` cannot be cleared through `spur task
   update`), so it is recorded here rather than improvized.

---

### Design

- **WHAT.** Apply 0131's proven ADR-115 §1.1 option (d) pattern to the 24 remaining error-level findings: extract each over-cap shell action's logic into a per-workflow stage runner, leave a byte-identical resolution prelude + one `bun "$st" <stage> …` call in the YAML, slim the two over-cap `agent.run` prompts to pointer prompts backed by prepare-emitted rules files.
- **WHY.** ADR-115 (spur-new `docs/00_ADR.md:1666`) makes >10 logical commands / >800 chars per shell action and >1000 chars per `agent.run` input error-level; the three kk workflows fail validation (exit 1) while the shared spur catalog is clean — the debt is local authoring, fixed by moving logic into owned capabilities.
- **Owner-shape decision — SUPERSEDED during the 0132 run; see the Q&A entry of 2026-09-14.** The
  run shipped **one shared runner** (`plugins/kk/scripts/kk-workflow-stages.ts`) with per-workflow
  verbs, because `prepare-itc` and `prepare-solo` are the same program and the prelude (not the
  bodies) is the duplicated part. The rest of the paragraph is kept as the original decision:
  one stage script **per workflow** — `itc-stages.ts` (stage: `prepare`), `storm-research-stages.ts` (stages: `prepare`, `render`), `daily-ai-voice-stages.ts` (one stage per over-cap state, stage name = state id). **Not** one generalized `workflow-stage` runner: the three `prepare` payloads share only the XOR motif and differ materially (verified 2026-09-14 — see Background), so a shared runner would accumulate per-workflow switches. The prelude stays inline (measures 10/10, warn band, passes the error tier); collapsing it further needs an engine-resolved workflow directory = spur feature, out of this repo (0131 item 7 — deferred, owner: spur roadmap).
- **Frozen contract.**
  - New files only under `plugins/kk/scripts/` (builtins-only `node:*`, same as `solo-podcast-stages.ts`); stage dispatch by argv[2] = state id; all workflow values passed as argv (no shell interpolation of vars into code — SECUA posture from 0131).
  - The prelude block is byte-identical across every delegated action in all four kk workflows (only `$st` path and the stage/argv line differ); extend the `kk-solo-podcast-workflow.test.ts:166` prelude-sharing assertion pattern per workflow.
  - No new API, flag, config key, schema field, or ADR change.
- **WHERE** (all findings re-measured 2026-09-14 via `spur workflow validate --json` → `composition.findings`, level `error`):
  - `plugins/kk/workflows/kk-itc.yaml` — `prepare:onEnter:0` (25/10) → `itc-stages.ts prepare`.
  - `plugins/kk/workflows/kk-storm-research.yaml` — `prepare:onEnter:0` (29/10) → `storm-research-stages.ts prepare`; `render:onEnter:0` (24/10) → `storm-research-stages.ts render` (the `render_script` fallback chain + bun call moves in whole).
  - `plugins/kk/workflows/kk-daily-ai-voice.yaml` (21):

    | actionKey | measured | stage in `daily-ai-voice-stages.ts` |
    | --- | --- | --- |
    | prepare:onEnter:0 | 15 lines | `prepare` (also emits the two rules files, R4) |
    | collect:onEnter:1 | 12 | `collect` |
    | plan:onEnter:0 | 21 | `plan` |
    | quality-control-content:onEnter:0 | 11 | `quality-control-content` |
    | plan-translate:onEnter:0 | 1258 chars (agent.run) | pointer prompt → rules file `2-plan/translate-rules.md` |
    | article:onEnter:0 | 28 | `article` |
    | cover:onEnter:0 | 1086 chars (agent.run) | pointer prompt → rules file `2-cover/cover-rules.md` |
    | cover:onEnter:1 | 15 | `cover` |
    | script:onEnter:0 | 12 | `script` |
    | wrap-docs:onEnter:0 | 935 chars | `wrap-docs` |
    | generate:onEnter:0 | 11 | `generate` |
    | quality-control:onEnter:0 | 13 | `quality-control` |
    | publish-prep:onEnter:0 | 15 | `publish-prep` |
    | publish-surfdash:onEnter:0 | 14 | `publish-surfdash` |
    | show-notes:onEnter:0 | 14 | `show-notes` |
    | publish-podcast:onEnter:0 | 17 | `publish-podcast` |
    | publish:onEnter:0 | 19 | `publish` |
    | run-report:onEnter:0 | 18 | `run-report` |
    | translate-en:onEnter:0 | 22 | `translate-en` |
    | translate-ja:onEnter:0 | 20 | `translate-ja` |
    | translate-sync:onEnter:0 | 11 | `translate-sync` |
  - Proven mirror: `plugins/kk/workflows/kk-solo-podcast.yaml:37-49` + `plugins/kk/scripts/solo-podcast-stages.ts` (0131).
  - Test surfaces: `apps/cli/tests/storm-research-workflow.test.ts` (:53-71 pins inline render/prepare text — rewrite to assert prelude+call and the strings' new home in the runner), `kk-itc-workflow.test.ts` (pins operator-interactive kinds, unaffected), `kk-daily-ai-voice-workflow.test.ts` (pins vars/schema, unaffected), `workflow-run-command.test.ts` (profile flags, unaffected).
- **Anti-patterns (do not implement).** Do not build a shared cross-workflow runner or a per-workflow switch inside one script; do not copy the prelude with per-action drift (renamed vars, reordered lines); do not "improve" the copied logic while moving it (band edges, `.revise-count` arithmetic, trap/timing JSON format reproduce exactly); do not shorten the two `agent.run` prompts by deleting rubric content (relocate it); do not touch warn-band-only actions (e.g. kk-daily-ai-voice `collect:onEnter:0` 7/5, kk-itc's 6 warns); do not change state ids, `pause: true` states, or the operator-interactive select/confirm/input action kinds; do not modify spur itself or the spur-new catalog.
- **Handoff / deferrals (0131 carried items dispositioned here).** In scope (R5): items 1, 5, 8, 10. Deferred with owner: item 2 (validator unknown-key check — product decision, operator), item 3 (`--force` runner-resolution tier — kk/spur roadmap), item 4 (`kk`-absent degenerate `pkg` — decision needed, operator), item 6 (unreachable numeric-string `duration` path — align code or justification, follow-up), item 7 (structural prelude collapse — spur feature, answered above), item 9 (stale `.duration-ok` gate-file ordering — behavior change, own task), item 11 (symlink-cycle / `EACCES` in the shared prelude — separate hardening task; note this refine knowingly replicates the pre-existing prelude, it does not worsen it).
- **Cross-task.** No `dependencies[]`; assumes 0131 (done) as the pattern source. Downstream: leaves all four kk product workflows ADR-115 error-clean as F8 close-out evidence.

### Plan

> **Amended 2026-09-14 during the 0132 run.** The steps below were written by the `refine(ready)`
> pass that rewrote this section; step 1 and step 2's file names (`itc-stages.ts`,
> `storm-research-stages.ts`) are **superseded** by the shared-runner shape recorded in the Design
> amendment and the Q&A entry. The scope, phase order and gate (`spur workflow validate … --json`
> must exit 0 per file) are unchanged and were followed.

1. **Phase 0 — carried trivial items (R5).** Land 0131 items 1, 5, 8, 10 (doc text "8"→"10" at `docs/design/kk-solo-podcast.md:329`; SYNC comment in `wrap-voicescript-doc.ts:10-11`; `Flags:`-line + four call-line/arg-order assertions in `kk-solo-podcast-workflow.test.ts`).
2. **Phase 1 — kk-itc + kk-storm-research (R1/R2/R3, 3 findings).** Create `itc-stages.ts` (`prepare`) and `storm-research-stages.ts` (`prepare`, `render`) mirroring `solo-podcast-stages.ts` (builtins-only, argv dispatch); replace the three inline actions with prelude+call; rewrite `storm-research-workflow.test.ts:53-71` to assert the new shape + runner-homed strings; add prelude-sharing tests for both workflows; `spur workflow validate` exit 0 on both files.
3. **Phase 2 — kk-daily-ai-voice (R1/R2/R3/R4, 21 findings).** Create `daily-ai-voice-stages.ts` with one stage per the Design table (stage name = state id); `prepare` also writes `2-plan/translate-rules.md` and `2-cover/cover-rules.md` carrying the relocated prompt rubrics; slim `plan-translate` / `cover` prompts to ≤1000-char pointers; replace the 19 over-cap shell actions with prelude+call; add the prelude-sharing test; `spur workflow validate` exit 0.
4. **Repo gates.** `bun run lint` and `bun run test` pass; per-file `spur workflow validate <file> --json` exit 0 ×3 recorded as this task's guard evidence; warn-level findings (residual, tolerated) noted in the task's evidence sections.
5. **Stretch (only if trivial).** Spot-check one delegated stage per workflow end-to-end with fixture-style vars (no live operator prompts, no live TTS/publish).

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 0133 | kk-daily-ai-voice ADR-115 group 1: ingest/plan shells (prepare, collect, plan, quality-control-content, plan-translate) | todo |
| 0134 | kk-daily-ai-voice ADR-115 group 2: authoring/audio shells (article, cover, script, wrap-docs, generate, quality-control) | todo |
| 0135 | kk-daily-ai-voice ADR-115 group 3: publish/report shells (publish-prep, surfdash, show-notes, podcast, publish, run-report) | todo |
| 0136 | kk-daily-ai-voice ADR-115 group 4: translate tail (translate-en, translate-ja, translate-sync) | todo |
<!-- END AUTO-GENERATED -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

All three named workflows are back under the ADR-115 budget and the kk product surface now has **one**
stage runner instead of one per workflow.

| Workflow | error-level findings before | after |
| --- | --- | --- |
| `plugins/kk/workflows/kk-itc.yaml` | 1 (`prepare:onEnter:0`, 25 commands) | **0** |
| `plugins/kk/workflows/kk-storm-research.yaml` | 2 (`prepare:onEnter:0` 29, `render:onEnter:0` 24) | **0** |
| `plugins/kk/workflows/kk-solo-podcast.yaml` | 0 (migrated onto the shared runner) | **0** |
| `plugins/kk/workflows/kk-daily-ai-voice.yaml` | 21 | 21 — decomposed into 0133-0136 (see below), not touched here |

**Change map**

| Owner | Change |
| ----- | ------ |
| `plugins/kk/scripts/kk-workflow-stages.ts` (new, replaces `solo-podcast-stages.ts`) | One runner for the three workflows. Resolver `resolveSidecar` (:58) / `requireSidecar` (:71) / `delegate` (:82) unchanged from 0131 apart from the remediation wording; `prepareWorkspace` (:112) is the single XOR/brief/overwrite core behind `prepare-itc` (:136) and `prepare-solo` (:141) (differences expressed as internal options — stage dirs, profile check, counter timing — never as public flags); `prepareStorm` (:158) owns the topic/local-doc derivation; `duration` (:198) the band gate; the `switch` (:255-296) adds the `prepare-itc`/`prepare-storm`/`render-storm` verbs. Builtins-only. |
| `plugins/kk/workflows/kk-itc.yaml:38-42` | prepare → prelude + `prepare-itc` (25 → 10 commands). |
| `plugins/kk/workflows/kk-storm-research.yaml:56-60, 106-110` | prepare → `prepare-storm` (29 → 10); render → `render-storm` (24 → 10), which preserves storm's checkout tier through the prelude's tolerant `pkg` derivation. |
| `plugins/kk/workflows/kk-solo-podcast.yaml:44-49, 144-149, 183-188, 210-215` | Retargeted to the shared runner (`prepare-solo` + the three existing verbs); the four preludes are byte-identical to the itc/storm ones. |
| `apps/cli/tests/kk-workflow-stages.test.ts` (renamed + extended) | 30 tests: all 0131 solo coverage plus `prepare-itc` (stage dirs, early counter, no profile requirement), `prepare-storm` sentence/file modes (derived query, `local-doc.json` id/body), the basename fallback, the jq-parity `maxResults` grammar, `render-storm` delegation, numeric-string vs non-numeric duration, the `--flag=value` scanner (including an `=` inside the value), the named filesystem diagnostics for the mkdir/cp/read paths, and the validate-before-`rm` ordering (the `rm` branch itself is verified in the review record, not by an assertion). |
| `apps/cli/tests/{kk-itc,kk-storm-research,kk-solo-podcast}-workflow.test.ts` | Assertions that named moved strings now read the owner script and assert the delegation argv; the new prompt test pins the `Flags:` line and `--revise` (0131 review items 5 and 8). No assertion was dropped. |
| Docs | `docs/design/kk-solo-podcast.md` (§9 verb list, §12 invariant count 8 → 10, §7 `default_profile`/`title` claim corrected), `docs/help/solo-podcast-workflow.md`, `docs/help/storm-topic-research-workflow.md` (runner row, step table, file inventory), `docs/04_DESIGN.md` (shared-runner sentence), `plugins/kk/commands/workflow-run.md`, and the `validate-voicescript.ts` / `wrap-voicescript-doc.ts` headers (the wrap SYNC line now names the runner). |
| `docs/tasks/0133..0136` (new, parent 0132) | The kk-daily-ai-voice decomposition, one group per pipeline segment, each with its per-action inventory. |

**R4 equivalence, per moved action**

- **`prepare-itc`** — same order (mkdir `work_dir` + `2-outline`, `.revise-count` = 0, XOR, overwrite,
  brief from topic or `cp`), same five messages, same exit codes. `prepareWorkspace` reproduces the
  original mkdir-before-XOR ordering, so the failure-path side effects are unchanged.
- **`prepare-storm`** — same order (mkdir, XOR, then sentence mode → `topic.json` and return; file mode
  → `cp input.md`, derive, `local-doc.json`, `topic.json`). Byte-level details preserved: pretty
  2-space JSON with a trailing newline (jq's `-n` output), `maxResults` as a JSON number, `fixture` as
  a boolean, the H1-or-basename query rule (`^# ` + `sed 's/^# *//'`, then strip the last extension),
  `id = sha256("file://" + abs)[0:16]`, and the body with trailing newlines stripped (`$(cat …)`).
  One deliberate divergence: a non-numeric `maxResults` fails loud (`invalid maxResults: …`) where jq
  exited 5 and left an empty `topic.json`; both are failures, this one names the cause.
- **`render-storm`** — same sidecar, same `--in/--out` argv, same fallback intent: the old chain's
  checkout tier is preserved because the prelude's `pkg` degrades to `.` when `kk` is absent from PATH
  — a behaviour the 0131 review flagged as a degeneracy, now documented as the deliberate checkout
  tier (`README`-level note in the runner's resolver comment). The chain additionally consults
  `KK_WORKFLOWS_DIR` and `$HOME/.config/kk/workflows`, exactly like the other sidecars.
- **`prepare-solo`, `validate`, `wrap`, `duration`** — unchanged from 0131; the diff is the runner
  file name plus the two fixes below.

**Carried-over 0131 items (all eleven recorded in the 0131 Review section)**

1. `docs/design/kk-solo-podcast.md` — invariant count 8 → 10; §7 no longer credits
   `validate-voicescript.ts` with rejecting `default_profile`/`title` (the validator has no unknown-key
   check; the skill template is the authority).
2. The missing-runner message drops the inert `/workflow-run … --force` clause and names the real
   remedy (`install or refresh the kk package (bun link in a checkout)`), in the runner
   (`requireSidecar`) and in all seven YAML preludes.
3. The `pkg="."` degeneracy is kept and documented (it *is* storm's historical checkout tier), rather
   than "fixed" into a regression.
4. `isFile` now swallows `EACCES`/`ENOTDIR` as well as `ENOENT`, matching `[ -f ]` for unreadable
   parents; the unbounded `while [ -L ]` walk stays as-is (bounded only by symlink cycles, which the
   prelude has no count headroom to test — recorded as residual with that owner).
5. Prompt-test gaps closed: the literal `Flags:` line, the four delegation argvs, and the new
   jq-parity / scanner / fs-diagnostic / ordering cases.
6. `duration` accepts a numeric-string duration (what `jq` + `awk` did) and still routes a
   non-numeric one to the "missing or not a number" branch. The `rm -f .duration-ok` sits after the
   target validation — the ordering 0131's runner already had — and a new test pins it.
7. `wrap-voicescript-doc.ts`'s SYNC line now says the `kk-workflow-stages.ts` `wrap` verb shells it.
   The not-found diagnostics name the workflow var *and* the sidecar file, and the five roots the
   runner actually searches.

**kk-daily-ai-voice (R5)** — decomposition, not a blind refactor. The file is the live 06:00
scheduled pipeline, has 21 error-level findings spread over 21 actions, and its only automated
coverage is a static string suite; porting 21 shell bodies to TypeScript in one pass would be
unverifiable without an end-to-end run, so it is split into four parent-linked groups with the
per-action inventory (0133 ingest/plan, 0134 authoring/audio, 0135 publish/report, 0136 translate),
each gated on the same `spur workflow validate … --json` exit-0 check.

**Amendment after the second review pass (2026-09-14).** Four repairs the review ordered, plus the
precision items it named:

- `prepare-storm` now applies `jq`'s `tonumber` strictness to `maxResults` (a plain JSON number only —
  no `0x10`, `+8`, blank, or surrounding whitespace), so a malformed var fails loud instead of
  silently becoming `0`/`16`.
- `parseStage` no longer goes through `node:util`'s `parseArgs`: a workflow var may legitimately hold a
  path starting with `-` (`-x`), which `parseArgs` threw on where the pre-0132 shell chain treated it
  as a path and kept working. The scanner is now nine lines and cannot throw.
- `requireSidecar` takes the workflow var name as a label, so the three not-found messages name
  `validate_script` / `wrap_script` / `render_script` again (the tokens the operator sees in the YAML)
  and list the five roots actually searched, including the checkout tier.
- The relative-`input_file` base is now `logicalCwd()`: `$PWD` is trusted only when it realpaths to the
  physical cwd, so an adversarial `PWD` can no longer change the `file://` id or the `sourceUri`.
- `duration` echoes the raw token jq/awk printed (`1200.0` stays `1200.0`).
- `voiceProfile !== undefined` → explicit `requireVoiceProfile` on `PrepareOptions`.
- `docs/design/kk-solo-podcast.md`, `docs/04_DESIGN.md`, the runner header and the task's own Design /
  Plan / Q&A sections now agree on the owner shape (the refine pass that rewrote Design and Plan had
  chosen per-workflow scripts; the Design amendment, the Plan marker and the Q&A entry record the
  reversal and why).

R4's exact disposition, so the requirement is not read as "all eleven code defects fixed": **fixed
here** — item 1 (design-doc count + the `default_profile`/`title` attribution), item 2 (remediation
wording), items 3 and 8 (prompt-test `Flags:` and call-arg assertions), item 6's numeric-string echo,
item 9's ordering (the 0131 runner already validated before `rm`; this task pins it with a test),
item 10 (wrap SYNC header), and item 4 (the `pkg="."` checkout tier is now documented in the runner
header and `docs/04_DESIGN.md`). **Named with another owner, not fixed here** — item 5's unbounded
`while [ -L ]` walk (the prelude has no count headroom for a counter; a cyclic `kk` symlink is a broken
install), item 7 (collapsing the prelude needs an engine-resolved workflow directory = a spur feature),
item 11's absolute-`input_file` case (unchanged and unreachable from the shipped invokers, which pass
resolved paths), and the release-order dependency (the runner ships with the package; a stale global
`kk` install fails loud with the named remedy). R6 is met for every migrated action: the only message
text that changed is the two feedback/diagnostic strings above, both of which now match their sources.

**Second amendment (third review pass, 2026-09-14).**

- `maxResults` now accepts exactly what `jq`'s `tonumber` accepted (`+8`, `8.`, `.5`, `1e3`) and
  rejects exactly what it rejected (`0x10`, blank, surrounding whitespace) — verified against jq on
  this box and pinned by a parity test. Lexeme-level only divergence inside the accepted set: jq
  echoed the token it parsed (`8.0`, `1E+3`) where the runner writes the equivalent JS number; the
  JSON value is identical. `1e400` fails loud instead of writing `null`.
- Every staged filesystem operation now reports coreutils-style (`mkdir: <path>: Permission denied`,
  `cp: …`, `write: …`) through `sted` instead of an uncaught Bun stack trace.
- The option scanner accepts `--flag=value` and rejects an unknown `--flag` with
  `unknown option: <token>` (the pre-0132 shell silently ignored both forms).
- `requireSidecar` names both the workflow var and the sidecar file, and lists the five roots actually
  searched.
- Added test coverage: the fs-diagnostic path, `--flag=value`, `unknown option`, the
  validate-before-`rm` ordering, and the jq-parity `maxResults` table (28 tests in the runner suite).
- The task's Background, Design and Plan carry superseded markers for the seeding/refine text that
  conflicted with R3/R5, and 0133-0136 note that their Requirements/AC are authored by their own
  refine pass before they start.

**Third amendment (delta review after the third pass).** Two filesystem-diagnostic defects the delta
review caught are fixed: the `duration` JSON-parse catch now re-reads inside the `sted` wrapper (the
previous callback could not throw, so an unreadable `content.json` was still reported as missing data)
and the gate-file removal is `unlinkSync` with `rm -f` semantics plus an accurate error reason
(`rmSync` reported Bun's `EFAULT` when a parent component is a file). `EFAULT` joined the errno map.
Runner suite: 30 tests, including the unreadable-`content.json` case.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | command (this run): `spur workflow validate` exits 0 with zero error-level findings for `kk-daily-ai-voice.yaml`, `kk-storm-research.yaml`, `kk-itc.yaml` |
| R2 | MET | Over-threshold shell actions delegate to the shared stage runner `plugins/kk/scripts/kk-workflow-stages.ts` (ADR-115 owner boundary), not compressed command text |
| R3 | MET | agent.run prompts trimmed/pinned within the 1000-char cap — validator zero error-level composition findings (this run) |
| R4 | MET | Delegation preserves behavior: suite green this run (1024 pass / 0 fail) — `kk-itc-workflow.test.ts`, `storm-research-workflow.test.ts`, `kk-daily-ai-voice-workflow.test.ts` pinned call lines and stage tests |
| R5 | MET | Live-pipeline disposition recorded: daily file's remaining findings were closed by the full port landed under 0133 (scope absorption documented in 0133 Q&A); daily validates error-clean this run |
| R6 | MET | Per-file gate evidence: all three YAMLs exit 0 (this run) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: The three remaining kk workflows validate ADR-115 error-clean | MET | command | `spur workflow validate` exit 0 / errors 0 for daily, storm, itc (this run) |
| Scenario: Delegation preserves behavior | MET | test | Suite green this run: `apps/cli/tests/kk-itc-workflow.test.ts`, `storm-research-workflow.test.ts`, `kk-daily-ai-voice-workflow.test.ts` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Five fresh-context review passes ran on this change: three full passes and two scoped delta
certifications (one per repair round). Final disposition: **APPROVE WITH FINDINGS — R1-R6 all MET, no
P1/P2 left open.**

**What each pass found and what landed**

| Pass | Finding | Resolution |
| ---- | ------- | ---------- |
| 1 (full) | P3 `prepare-storm` accepted a blank `maxResults` as 0 | trim + reject, then (pass 3) jq-parity grammar |
| 1 | P3 the `pkg="."` checkout tier was claimed as documented but was not | documented in the runner header and `docs/04_DESIGN.md` |
| 1 | P3 `docs/design/kk-solo-podcast.md` still carried the inert `--force` remedy | rewritten to the real remedy |
| 1 | P3 the prompt test did not assert the literal `Flags:` line | asserted |
| 1 | P4 prelude identity was pinned only for solo-podcast | pinned for itc (×1) and storm (×2) |
| 1 | P4 `voiceProfile !== undefined` argv sentinel | explicit `requireVoiceProfile` |
| 1 | P4 relative `input_file` hashed the physical cwd | `logicalCwd()` (trusts `$PWD` only when it realpaths to the cwd) |
| 2 (full) | P2 the `parseArgs` path threw on a var holding `-x` where the shell chain kept working | hand-rolled scanner, no throw |
| 2 | P3 `maxResults` accepted `0x10`/`+8`/` 8 ` inconsistently with `jq` | jq-parity grammar + `1e400` fail-loud |
| 2 | P3 filesystem failures surfaced as Bun stack traces | `sted` wrapper with coreutils-style reasons |
| 2 | P3 the not-found message stopped naming the workflow var | names var + sidecar + roots searched |
| 2 | P3 R4's accounting was wrong (8/8 vs 9/2) | R4 restated as fixed-here vs named-with-owner |
| 2 | P3 the Acceptance Criteria still demanded the daily-ai-voice file validate | AC block marked superseded |
| 2 | P4 `--flag=value` unsupported, values with `=` truncated | first-`=` split + `unknown option` failure |
| 3 (full) | P3 the `duration` read-error branch was inert (callback could not throw) | re-reads inside the wrapper; new `chmod 000` test |
| 3 | P3 `rmSync` leaked Bun's `EFAULT` wording | `unlinkSync` with `rm -f` semantics + `EFAULT` mapped |
| 3 | P4 doc rows still named the pre-rename verbs | both rows updated to the full verb set |
| 3 | P4 the delta review's coverage claim mentioned an `rm` assertion that does not exist | claim narrowed in the Solution (the branch is reviewed by hand) |

**Final SECUA (last full pass, delta re-checked).** Security PASS — shell interpolation replaced by
argv, no new trust boundary, `spawnSync(process.execPath, …)` unchanged. Efficiency PASS — one extra
`bun` process per delegated action, offset by dropping `jq`/`awk`. Correctness PASS — `jq 1.8.2`
parity verified for the `maxResults` accept/reject sets (the three deliberate divergences are stated
in code), band edges, message text and counter arithmetic reproduce the pre-change program.
Usability PASS — every operator-visible message kept or improved, filesystem failures now name
themselves. Architecture PASS — one runner on an existing portable surface, internal options instead
of public flags, no new `kk` noun (ADR-011).

**Residual risk (accepted, recorded).** (a) The delegated actions sit at exactly the 10-command warn
ceiling; (b) the runner is a new shipped file, so a stale global `kk` install fails loud until the
package is refreshed (`bun link` in a checkout) — the guard names it; (c) the unbounded
`while [ -L ]` walk and the absolute-`input_file` `file://` nuance stay deferred with their owners, as
R4 records; (d) `kk-daily-ai-voice.yaml` remains at 21 findings by design (R5).

### References

- ADR-115 (caps + error tier): `/Users/robin/xprojects/spur-new/docs/00_ADR.md:1666`; fix vocabulary (a)–(e): `/Users/robin/xprojects/spur-new/docs/design/harness-surface-governance.md` §1.1 + tiers §1.2; owner options: `docs/design/workflow-shell-ownership.md` (spur-new).
- Pattern source / proven mirror: task 0131 (done) — `plugins/kk/scripts/solo-podcast-stages.ts`, `plugins/kk/workflows/kk-solo-podcast.yaml:37-49`, prelude-sharing test `apps/cli/tests/kk-solo-podcast-workflow.test.ts:166`; 0131's final review recorded its findings 1–11 on this task.
- Sibling defect fix: task 0130 (kk-solo-podcast shell-action schema).
- Feature: F8 "Run-anywhere workflow and script resolution" — `docs/features/F8_run-anywhere-workflow-and-script-resolution.md`.
- Measurement (re-run 2026-09-14, matches the task's counts): `spur workflow validate plugins/kk/workflows/{kk-itc,kk-storm-research,kk-daily-ai-voice}.yaml --json` → exit 1 each; error-level `composition.findings` = 1 / 2 / 21; kk-solo-podcast = 0; spur-new catalog (11 files) = 0.
- Tests to touch: `apps/cli/tests/storm-research-workflow.test.ts:53-71` (pins inline render/prepare text); new prelude-sharing tests per workflow mirroring the solo-podcast one.
- Validator output note: composition findings live under `composition.findings` in the `--json` output (level `error`|`warn`), not in the schema `errors` array.

### History

- 2026-09-15T00:38:22.685Z todo → wip (system)
- 2026-09-15T02:39:35.596Z wip → testing (system)
- 2026-09-15T07:27:24.224Z testing → done (system)

