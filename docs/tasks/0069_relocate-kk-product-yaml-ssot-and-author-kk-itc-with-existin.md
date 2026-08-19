---
schema_version: 1
name: "Relocate kk product YAML SSOT and author kk-itc with existing HITL"
status: done
template: feature-impl
created_at: 2026-08-19T22:02:04.882Z
updated_at: "2026-08-19T22:32:12.849Z"
feature_id: F4
priority: P2
---

## 0069. Relocate kk product YAML SSOT and author kk-itc with existing HITL

### Background
Implements F4: product workflow YAML lives only under `plugins/kk/workflows/`, and a `kk-itc` state machine authors an IT technical draft using Spur's existing HITL plus real `agent.run` (`input`, not a fictional `skill:` field).

Operator 2026-08-19: delete `judge-*` (done); rename `judge` → `content-judge` (done); use Spur `hitl.*` for topic-core pauses; ship `kk-itc`; make `plugins/kk/workflows/` the only kk YAML home.

**Verified 2026-08-19 (this refine), not assumed:**

- Spur HITL kinds in `/Users/robin/xprojects/spur-new/packages/app/src/workflow/actions/`: `hitl.confirm`, `hitl.input`, `hitl.select`. `hitl.select` takes `prompt` + non-empty `options: string[]` and `setVars`s `__hitlAnswer`. No fourth kind exists; none is added.
- `agent.run` options are `input`, `agent`, `role`, `expectFile`, `answerFile`, `timeoutMs`, … (`agent-run.ts:55-74`). There is **no** `skill` or `prompt` option. Extra keys validate (`additionalProperties: true`) but are ignored. `.spur/workflows/judge-gated-publish-example.yaml` currently uses `skill:` + `prompt:` — documentary fiction; the move must rewrite those to `input:`.
- Inventory: `plugins/kk/workflows/` has only `kk-storm-research.yaml`. `.spur/workflows/` has that file **byte-identical** (`cmp` IDENTICAL) plus `kk-ingest-generate-publish.yaml` and `judge-gated-publish-example.yaml` (no plugin copies). Other `.spur/workflows/*` are Spur lifecycle YAML and stay.
- `/workflow-run` is still a storm runner: default name `kk-storm-research`, 0056 `topicId` works dir, seven-var `--vars`, report `content.md`. First token can be a name, but there is no itc profile and the copy loop still has three roots (`workflow-run.md:69-84`).
- `docs/04_DESIGN.md` has **no** copy-rule table today. Adding it is T3 of this task, not a silent 0056 rewrite (0056 Solution stays historical).
- `topic` artifact contract (`brief.md`, `2-outline/`, `3-draft/`) is the authoring workspace. Storm `~/.config/kk/works/<topic-id>/` is a different layout. `kk-itc` must not hash a 0056 topic-id for `work_dir`.
### Requirements
- [x] R1. After this task, `plugins/kk/workflows/` contains exactly these product files: `kk-storm-research.yaml`, `kk-ingest-generate-publish.yaml`, `judge-gated-publish-example.yaml`, `kk-itc.yaml`. `.spur/workflows/` contains no `kk-*.yaml` and no `judge-gated-publish-example.yaml`. Storm's `.spur` copy is deleted after `cmp` against the plugin file (already IDENTICAL). Ingest and judge-gated are **moved** (they have no plugin copy today). `judge-gated-publish-example.yaml` `agent.run` uses `input:` (and loads `content-judge`); it does not keep `skill:` / `prompt:`.
- [x] R2. Install copy rule is two roots, first hit: `$KK_WORKFLOWS_SOURCE/$NAME.yaml` then `plugins/kk/workflows/$NAME.yaml`. Dest `$workflows_dir/$NAME.yaml`. Missing dest → copy; dest + `--force` → replace; dest + identical → no-op; dest + different bytes → warn, leave, continue. Source missing from both roots → exit 1, stderr lists those two roots only. Live updates in the same commit: `plugins/kk/commands/workflow-run.md`, `plugins/kk/skills/storm-research/SKILL.md` fail-loud row, `docs/help/storm-topic-research-workflow.md` SSOT row, `docs/04_DESIGN.md` (new copy-rule surface), `docs/00_ADR.md` dated **ADR-009** amendment (product YAML home), `docs/03_ARCHITECTURE.md` if it still names `.spur` as repo SSOT, `plugins/kk/README.md` `workflows/` row. Do **not** rewrite the 0056 Solution. Tests: `workflow-run-command.test.ts` (two roots, no `.spur/workflows` in the search loop), `storm-research-workflow.test.ts` (`ssotPath` = plugin file; assert `.spur/workflows/kk-storm-research.yaml` is absent), `workflow-template.test.ts` (`templatePath` = `plugins/kk/workflows/kk-ingest-generate-publish.yaml`).
- [x] R3. Author `plugins/kk/workflows/kk-itc.yaml` as the frozen state machine in Design (states, vars, HITL kinds, `agent.run` `input` + `expectFile`, shell `cp` for the selected outline, revise bound 3 via `.spur/run/${__runId}-itc-revise-count`). Writer default `itc-generating`; `writer: "topic"` allowed. Artifact paths are the topic contract under `work_dir`. No new Spur `hitl.*` kind. No change to `plugins/kk/skills/topic/SKILL.md`.
- [x] R4. `/workflow-run` supports two run profiles after the copy-install: default / `kk-storm-research` (unchanged 0056 works + seven-var set + `content.md` report) and `kk-itc` (authoring `work_dir`, itc var set, report `brief.md` / `2-outline/outline-approved.md` / `3-draft/draft-article.md`). No new `kk` first-layer noun. No new slash command. No new dedicated HITL skill. `--fixture` with `kk-itc` exits 1.
- [x] R5. Fail loud, no dest overwrite without `--force`: XOR `topic` / `input_file` (both or neither); missing `--in` file; empty derived kebab `work_dir`; dest YAML byte-mismatch without `--force` (warn + leave, same as today); `kk-itc` prepare refuses an existing `brief.md` when `force` is not `"true"`. Every stop names the path and the recovery.
### Acceptance Criteria
```gherkin
Feature: kk product workflows home and IT-content pipeline

  @core
  Scenario: R1 — Product YAML lives only under plugins/kk/workflows
    Given a knowledge-kit product workflow YAML (kk-storm-research, kk-ingest-generate-publish, judge-gated-publish-example, kk-itc)
    When the repository is inspected
    Then the file exists under plugins/kk/workflows/
    And no kk-*.yaml or judge-gated-publish-example.yaml remains under .spur/workflows/

  @core
  Scenario: R2 — Install copy rule searches two roots
    Given /workflow-run needs to install a product workflow YAML
    When it resolves the source
    Then it searches KK_WORKFLOWS_SOURCE then plugins/kk/workflows
    And it does not search .spur/workflows as an install root

  @core
  Scenario: R3 — kk-itc uses existing Spur HITL for topic-core gates
    Given a topic or Markdown brief
    When kk-itc runs
    Then outline selection is hitl.select over a|b|c
    And draft review is hitl.confirm with optional hitl.input revision (bound 3)
    And writing is agent.run against topic or itc-generating
    And no new hitl.* kind is added to Spur

  @core
  Scenario: R4 — Optional quality gate uses content-judge
    Given a kk-itc run with the judge gate enabled
    When the draft is approved
    Then an agent.run step targets content-judge
    And a shell/jq guard reads the verdict file

  @edge
  Scenario: R5 — Missing or unsafe inputs fail loud
    Given both topic and input_file set, or neither, or an existing dest YAML with different bytes
    When the workflow or /workflow-run is invoked
    Then it stops with a named recovery
    And it does not overwrite without --force
```
### Q&A
- **Q: Does Spur HITL replace `topic`'s pauses?** A: Yes for the workflow. `hitl.select` picks `a|b|c`. `hitl.confirm` is approve/reject. `hitl.input` is revision text. Bound-3 is a counter file + transitions. No new `hitl.*` kind.
- **Q: How does `agent.run` load a kk skill?** A: `input:` tells the agent to load the SKILL.md path and run the operation. `expectFile` names the artifact. Do **not** use `skill:` or `prompt:` — Spur ignores them (`agent-run.ts` reads `input`).
- **Q: Delete or rename `topic`?** A: Neither. `topic` stays the standalone writer. HITL ownership is `kk-itc.yaml`.
- **Q: `work_dir` — storm works or topic workspace?** A: Topic authoring workspace. Default `./<kebab(topic-or-derived)>`. Invoker computes it. YAML never runs 0056 `topicId`.
- **Q: `/workflow-run` vs a new command?** A: Same slash, two profiles (`kk-storm-research` default, `kk-itc`). No new slash, no `kk` noun.
- **Q: Nested `spur workflow run` for research?** A: No. Optional `research: "true"` is one `agent.run` whose `input` loads `storm-research` SKILL.md. Storm artifacts stay in the 0056 works dir.
- **Q: Which ADR?** A: Dated **ADR-009** amendment (product YAML lives under `plugins/kk/workflows/`; `.spur/workflows/` is Spur-lifecycle). 0056 Solution is historical — cite, do not rewrite. `04_DESIGN.md` gets the live copy-rule table (T3).
- **Q: Keep `.spur` as copy-rule root 3?** A: No.
- **Q: `agents/README.md`?** A: Do not add it. Notes live in `plugins/kk/README.md`.
### Design
**WHAT.** One product-YAML home + one IT-content state machine + a two-profile `/workflow-run`.

**WHY.** `.spur/workflows/` mixing Spur pipelines with kk product YAML forced dual-write and a three-root copy rule. Operator 2026-08-19: kk YAML SSOT is `plugins/kk/workflows/`. Topic-core pauses belong on Spur HITL, not a new skill or `hitl.*` kind.

**WHERE (primary files).**

| Path | Role |
| --- | --- |
| `plugins/kk/workflows/kk-itc.yaml` | **new** state machine |
| `plugins/kk/workflows/kk-storm-research.yaml` | stays; becomes the only storm copy |
| `plugins/kk/workflows/kk-ingest-generate-publish.yaml` | **move** from `.spur/workflows/` (no plugin copy today) |
| `plugins/kk/workflows/judge-gated-publish-example.yaml` | **move** + rewrite `agent.run` to `input:` |
| `.spur/workflows/kk-storm-research.yaml` | **delete** after `cmp` |
| `.spur/workflows/kk-ingest-generate-publish.yaml` | **delete** after move |
| `.spur/workflows/judge-gated-publish-example.yaml` | **delete** after move |
| `plugins/kk/commands/workflow-run.md` | two-root copy + `kk-itc` profile |
| `plugins/kk/skills/storm-research/SKILL.md` | fail-loud / roots text |
| `apps/cli/tests/workflow-run-command.test.ts` | two-root + itc flags |
| `apps/cli/tests/storm-research-workflow.test.ts` | `ssotPath` = plugin file |
| `apps/cli/tests/workflow-template.test.ts` | plugin ingest path |
| `apps/cli/tests/kk-itc-workflow.test.ts` | **new** static YAML invariants |
| `docs/00_ADR.md` | ADR-009 dated amendment |
| `docs/04_DESIGN.md` | copy-rule + `/workflow-run` profiles (T3) |
| `docs/help/storm-topic-research-workflow.md` | SSOT row |
| `docs/03_ARCHITECTURE.md` | only if it still names `.spur` as storm SSOT |
| `plugins/kk/README.md` | `workflows/` row |

Leave unchanged: `plugins/kk/skills/topic/SKILL.md`, itc-generating contract, Spur source, 0056/0059 Solution text, lifecycle YAML under `.spur/workflows/`.

**Copy rule (live surfaces only; 0056 Solution is historical).** Order: (1) `$KK_WORKFLOWS_SOURCE/$NAME.yaml` (2) `plugins/kk/workflows/$NAME.yaml`. Dest: `$workflows_dir/$NAME.yaml`. Behavior unchanged except root 3 is gone. Stderr on miss: `no source workflow for $NAME (searched KK_WORKFLOWS_SOURCE, plugins/kk/workflows)`.

**`/workflow-run` profiles.** Parse stays: first token is `NAME` if `^[a-z0-9][a-z0-9-]*$` and not `--in`; else `NAME=kk-storm-research`.

- **`kk-storm-research` (default)** — unchanged: 0056 `topicId`, `$works_dir/<id>`, vars `topic,input_file,maxResults,fixture,work_dir,plugins_path,render_script`, report `content.md` + `content.json`.
- **`kk-itc`** — authoring, not works:

```
/workflow-run kk-itc <topic|--in file> [--dir <path>] [--playbook generic|english|wechat]
             [--research] [--judge] [--outline a|b|c] [--writer itc-generating|topic] [--force]
```

| Flag / token | Var | Default |
| --- | --- | --- |
| `<topic>` / `--in` | `topic` / `input_file` | XOR required |
| `--dir` | `work_dir` | `./<kebab>` (below) |
| `--playbook` | `playbook` | `generic` |
| `--research` | `research` | `"false"` |
| `--judge` | `judge` | `"false"` |
| `--outline` | `outline` | `""` (HITL select) |
| `--writer` | `writer` | `itc-generating` |
| `--force` | `force` | `"false"` (dest YAML **and** existing `brief.md`) |

`--fixture` + `kk-itc` → exit 1 (`fixture is storm-only`). Other `NAME` after a successful copy → exit 1 listing `kk-storm-research`, `kk-itc`.

**kebab(`raw`)** (invoker, not YAML): lower-case; `[^a-z0-9]+` → `-`; trim dashes; no length cap; no sha256. Empty → exit 1. `raw` = topic string, or file-mode first ATX H1 else basename without extension.

`kk-itc` `--vars` (all strings): `topic`, `input_file`, `work_dir`, `writer`, `playbook`, `research`, `judge`, `outline`, `force`, `rubric` (`tech-accuracy`), `verdictFile` (YAML default `.spur/run/${vars.__runId}-itc-verdict.json`), `agent` (`""`).

Report: `$work_dir/brief.md`, `$work_dir/2-outline/outline-approved.md`, `$work_dir/3-draft/draft-article.md`. If `judge=true`, also the verdict path.

**`kk-itc.yaml` machine.**

```
name: kk-itc
kind: state-machine
$schema: "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"   # quoted
initialState: prepare
terminalStates: [done, failed]
```

States (ids frozen): `prepare` → (`research` if `research=true`) → `outline-write` → (`outline-select` if `outline` empty else skip) → `outline-commit` → `draft-write` → `draft-review` → (`draft-revise` → `draft-write`)*≤3 → (`judge` if approved and `judge=true`) → `done` | `failed`.

Vars (defaults): `topic: ""`, `input_file: ""`, `work_dir: ""`, `writer: "itc-generating"`, `playbook: "generic"`, `research: "false"`, `judge: "false"`, `outline: ""`, `force: "false"`, `rubric: "tech-accuracy"`, `verdictFile: ".spur/run/${vars.__runId}-itc-verdict.json"`, `agent: ""`, `__hitlAnswer: ""`, `__hitlInput: ""`.

- **prepare** (`shell`): `mkdir -p` `work_dir`, `2-outline`, `3-draft`. XOR `topic`/`input_file` (same stderr as storm). If `brief.md` exists and `force` ≠ `true` → exit 1. Else write `brief.md` (topic line, or `cp` of `input_file`). `work_dir` empty → exit 1.
- **research** (`agent.run`): `input` loads `plugins/kk/skills/storm-research/SKILL.md` for the XOR topic/`--in`. No `expectFile` (artifacts live in 0056 works). Failure fails the machine.
- **outline-write** (`agent.run`): `input` loads `plugins/kk/skills/${vars.writer}/SKILL.md`, runs **outline only** (not `create`) against `--dir ${vars.work_dir}` with `--playbook` when writer is `itc-generating`. Write `2-outline/outline-option-{a,b}.md` required, `c` optional; **do not wait** for operator select. `expectFile: ${vars.work_dir}/2-outline/outline-option-a.md`. Follow-up `shell` fails if `outline-option-b.md` is missing.
- **outline-select** (`hitl.select`, `pause: true`): `prompt` names the three paths; `options: [a, b, c]`; `var: __hitlAnswer`. Cancel → `ok:false` → failed at the state.
- **outline-commit** (`shell`): `sel="${vars.outline:-${vars.__hitlAnswer}}"`; `src="${vars.work_dir}/2-outline/outline-option-${sel}.md"`; missing `src` → exit 1; `cp` verbatim to `2-outline/outline-approved.md`.
- **draft-write** (`agent.run`): `input` loads the writer SKILL, **draft only** from `outline-approved.md`; include `${vars.__hitlInput}` when set (revise). `itc-generating` applies playbook. `expectFile: ${vars.work_dir}/3-draft/draft-article.md`.
- **draft-review** (`hitl.confirm`, `pause: true`): approve the draft path; `var: __hitlAnswer` (`yes`/`no`/`cancel`).
- **draft-revise** (`hitl.input`, `pause: true`): increment `.spur/run/${vars.__runId:-itc}-itc-revise-count` then collect `__hitlInput`. Enter only when answer is `no` and count `< 3`; else `no` → `failed`.
- **judge** (`agent.run`): `input` loads `plugins/kk/skills/content-judge/SKILL.md`, rubric `${vars.rubric}`, content `${vars.work_dir}/3-draft/draft-article.md`, write `${vars.verdictFile}`. `expectFile: ${vars.verdictFile}`.

**Guards (dry-run walkable).** `action-ok` is forbidden on success edges (dry-run `EMPTY_OUTCOME` denies it — C3/C4). Use `shell` on vars (evaluated in dry-run) and `always` only after HITL when the next state is unconditional.

| from | to | guard |
| --- | --- | --- |
| prepare | research | `test "${vars.research}" = "true"` |
| prepare | outline-write | `test "${vars.research}" != "true"` |
| research | outline-write | `always` |
| outline-write | outline-select | `test -z "${vars.outline}"` |
| outline-write | outline-commit | `test -n "${vars.outline}"` |
| outline-select | outline-commit | `always` |
| outline-commit | draft-write | `always` |
| draft-write | draft-review | `always` |
| draft-review | judge | `{ test -z "${vars.__hitlAnswer}" \|\| test "${vars.__hitlAnswer}" = "yes"; } && test "${vars.judge}" = "true"` |
| draft-review | done | `{ test -z "${vars.__hitlAnswer}" \|\| test "${vars.__hitlAnswer}" = "yes"; } && test "${vars.judge}" != "true"` |
| draft-review | draft-revise | `test "${vars.__hitlAnswer}" = "no" && test "$(cat .spur/run/${vars.__runId:-itc}-itc-revise-count 2>/dev/null \|\| echo 0)" -lt 3` |
| draft-review | failed | `test "${vars.__hitlAnswer}" = "no" && test "$(cat .spur/run/${vars.__runId:-itc}-itc-revise-count 2>/dev/null \|\| echo 0)" -ge 3` |
| draft-revise | draft-write | `always` |
| judge | done | `v="$(jq -r .verdict ${vars.verdictFile} 2>/dev/null)"; test -z "$v" -o "$v" = PASS` |
| judge | failed | `v="$(jq -r .verdict ${vars.verdictFile} 2>/dev/null)"; test -n "$v" -a "$v" != PASS` |

Empty `__hitlAnswer` is the dry-run approve path (actions skipped). Real `hitl.confirm` cancel is `ok:false` (no transition). Default `onError=fail` stops at a failed action; do not add extra unguarded `failed` edges for that. Where a `shell` success guard might deny, the last outbound must be unguarded `failed` so the machine cannot stall.

**`agent.run` shape (every writing / judge / research step).**

```yaml
- kind: agent.run
  options:
    agent: ${vars.agent}
    input: |
      Load <repo-relative SKILL.md path>.
      <operation + flags + expect artifact>.
    expectFile: <artifact>
```

No `skill:`, no `prompt:`.

**Tests (static).** `kk-itc-workflow.test.ts`: state ids contain the frozen list; `hitl.select` options include `a`,`b`,`c`; file contains `kind: hitl.confirm` and `kind: hitl.input`; no `skill:`; has `expectFile`; no `kind: action-ok`; `$schema` quoted. `workflow-run-command.test.ts`: copy loop lists only the two roots; command text contains `kk-itc`, `--playbook`, `--research`, `--judge`; storm seven-var `--vars` still present on the storm profile. `storm-research-workflow.test.ts`: read only the plugin path; assert `.spur/workflows/kk-storm-research.yaml` is absent. `workflow-template.test.ts`: plugin ingest path; existing R12 assertions unchanged.

**Verify commands (implement).**

```
spur workflow validate plugins/kk/workflows/kk-itc.yaml --json
spur workflow run plugins/kk/workflows/kk-itc.yaml --dry-run --run-id refine-itc \
  --vars '{"topic":"IT draft on vector indexes","work_dir":"./scratch/itc-dry"}' --json
# expect status done, finalState done
spur workflow validate plugins/kk/workflows/*.yaml
```

**Anti-patterns (do not).** New Spur `hitl.*` kind; dedicated HITL skill; `plugins/kk/agents/README.md`; `skill:` / `prompt:` on `agent.run`; nested `spur workflow run` from `kk-itc` into storm; 0056 `topicId` / `~/.config/kk/works` as `kk-itc` `work_dir`; `action-ok` success edges; dual-write back to `.spur/workflows/`; new `kk` noun or `/itc` slash; rewriting 0056/0037/F1 historical AC or Solution; changing `topic` SKILL.md HITL text (standalone still pauses; the workflow does not call `create`); merging storm works files into `2-outline/` / `3-draft/`.

**Handoffs.** No `dependencies[]`. Downstream: none. Assume `content-judge` and `topic` / `itc-generating` SKILL.md already on disk.
### Plan
1. **R1 move/delete.** `cmp` storm copies; `git mv` ingest + judge-gated into `plugins/kk/workflows/`; delete `.spur/workflows/kk-storm-research.yaml`; rewrite judge-gated `agent.run` to `input:` + `content-judge`. Confirm `ls .spur/workflows` has no `kk-*` / `judge-gated-publish-example.yaml`.
2. **R2 copy rule + docs.** Edit `workflow-run.md` search loop (two roots). ADR-009 amendment + `docs/04_DESIGN.md` copy-rule table + help SSOT row + storm-research fail-loud row + `plugins/kk/README.md` `workflows/` row. Point the three existing tests at the new SSOT/roots.
3. **R3 YAML.** Author `kk-itc.yaml` exactly as Design (ids, vars, HITL, `input`/`expectFile`, guards, revise counter). `spur workflow validate` all four plugin YAML files.
4. **R4 profile.** Add the `kk-itc` branch to `workflow-run.md` (flags, kebab `work_dir`, itc `--vars`, topic-artifact report). `--fixture` + `kk-itc` exits 1. Keep the storm branch byte-compatible with the existing seven-var test.
5. **R3/R5 tests.** Add `apps/cli/tests/kk-itc-workflow.test.ts` (static invariants). Extend `workflow-run-command.test.ts` for two-root + itc tokens. Dry-run `kk-itc` with `topic` + `work_dir` → `status: done`.
6. **R5 fail-loud.** Confirm prepare XOR and existing-`brief.md` without `force` in the YAML; confirm dest-mismatch warning still in `/workflow-run`.
7. **Docs sync (same commit, T3/T4).** `03` only if `.spur` is still named as storm SSOT; `05` F4 notes if the tree line is stale. `bun run autofix` and `bun test` on the four test files.
### Solution
| File | Change | Why |
| --- | --- | --- |
| `plugins/kk/workflows/kk-itc.yaml:1-286` | New frozen state machine workflow with prepare, research, outline-write, outline-select, outline-commit, draft-write, draft-review, draft-revise, judge, done/failed terminals. | R3: IT content pipeline using Spur HITL actions and agent.run with input/role. |
| `plugins/kk/workflows/judge-gated-publish-example.yaml:37-45` | Moved from `.spur/workflows/` and updated `agent.run` to `input:` + `role: reviewer` loading `content-judge`. | R1: Relocate product YAML SSOT and remove fictional `skill:`/`prompt:` options. |
| `apps/cli/tests/workflow-template.test.ts:12` | Updated template path from `.spur/workflows/` to `plugins/kk/workflows/kk-ingest-generate-publish.yaml`. | R1: Assert single product YAML home under `plugins/kk/workflows/`. |
| `.spur/workflows/kk-storm-research.yaml` | Removed duplicate file after verifying byte-identical to `plugins/kk/workflows/kk-storm-research.yaml`. | R1: Eliminate dual-write and duplicate product YAML in .spur. |
| `plugins/kk/commands/workflow-run.md:1-135` | Updated search loop to two roots (`KK_WORKFLOWS_SOURCE`, `plugins/kk/workflows`) and added `kk-itc` profile support. | R2/R4: Two-root copy rule and two-profile execution. |
| `plugins/kk/skills/storm-research/SKILL.md:1-140` | Updated storm-research skill fail-loud table to cite the two search roots. | R2: Align skill documentation with two-root copy rule. |
| `docs/help/storm-topic-research-workflow.md:25,83-125,240-270` | Updated SSOT path to `plugins/kk/workflows/kk-storm-research.yaml` and test commands. | R2: Align user help documentation. |
| `plugins/kk/README.md:13` | Added `workflows/` row to the capability table. | R2: Document product workflow YAML SSOT home. |
| `docs/00_ADR.md:391-398` | Added dated amendment to ADR-009 for product workflow YAML home and two-root copy rule. | R2: Authoritative architecture decision record amendment. |
| `docs/04_DESIGN.md:346-378` | Added Section 7 documenting the two-root copy rule and `/workflow-run` profile surface. | R2: Surface design documentation in same commit (T3). |
| `apps/cli/tests/workflow-run-command.test.ts:90-117` | Updated tests for two roots and added `kk-itc` profile assertions. | R2/R4: Static invariant verification. |
| `apps/cli/tests/storm-research-workflow.test.ts:1-30` | Updated SSOT path to plugin workflows and verified absence of `.spur` copy. | R1/R2: Enforce absence of duplicate workflow in `.spur`. |
| `apps/cli/tests/kk-itc-workflow.test.ts:1-73` | New test asserting frozen state machine states, HITL kinds, agent.run input/role, and expectFile. | R3/R5: Static invariant tests for kk-itc workflow. |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-itc.yaml:3` |
| R2 | MET | `plugins/kk/commands/workflow-run.md:74` |
| R3 | MET | `plugins/kk/workflows/kk-itc.yaml:93` |
| R4 | MET | `plugins/kk/workflows/kk-itc.yaml:165` |
| R5 | MET | `plugins/kk/workflows/kk-itc.yaml:44` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Product YAML lives only under plugins/kk/workflows | MET | test | `apps/cli/tests/storm-research-workflow.test.ts:24` |
| Scenario: R2 — Install copy rule searches two roots | MET | test | `apps/cli/tests/workflow-run-command.test.ts:92` |
| Scenario: R3 — kk-itc uses existing Spur HITL for topic-core gates | MET | test | `apps/cli/tests/kk-itc-workflow.test.ts:37` |
| Scenario: R4 — Optional quality gate uses content-judge | MET | test | `apps/cli/tests/kk-itc-workflow.test.ts:59` |
| Scenario: R5 — Missing or unsafe inputs fail loud | MET | test | `apps/cli/tests/kk-itc-workflow.test.ts:67` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Design conformance** — chosen approach DONE, no deviations: product workflow YAML SSOT relocated exclusively to `plugins/kk/workflows/` (`kk-storm-research.yaml`, `kk-ingest-generate-publish.yaml`, `judge-gated-publish-example.yaml`, `kk-itc.yaml`). `.spur/workflows/` contains only Spur lifecycle workflows. `kk-itc.yaml` state machine authored with Spur HITL actions (`select`, `confirm`, `input`) and real `agent.run` options (`input`, `role`, `expectFile`). `/workflow-run` two-root copy rule and two profiles (`kk-storm-research`, `kk-itc`) implemented and tested.

**SECUA Review** — no P1–P3 findings.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | Correctness | `plugins/kk/workflows/kk-itc.yaml:140-145` | Revise loop counter file `.spur/run/$run_id-itc-revise-count` enforces strict 3-round upper bound on operator revisions before terminating to `failed`. | Verified by transition guards and dry-run walkability. |
| P4 | Usability | `plugins/kk/commands/workflow-run.md:120-135` | Separate report formats for storm-research (`content.md` + `content.json`) vs kk-itc (`brief.md`, `outline-approved.md`, `draft-article.md`, and optional verdict). | Documented and verified in command spec and tests. |

**Architecture depth** — no deepening candidates. Eliminating dual-write between `.spur/workflows` and `plugins/kk/workflows` simplifies the copy rule to two roots and clarifies that `.spur/workflows` is reserved exclusively for Spur harness lifecycle execution.

**Disposition:** PASS — no blocker or major findings; two P4 advisories recorded.
### References
- Feature AC titles (must stay aligned): `docs/features/F4_it-content-workflow-and-product-yaml-home.md`
- Spur `agent.run` contract: `/Users/robin/xprojects/spur-new/packages/app/src/workflow/actions/agent-run.ts` (`input`, `expectFile`; no `skill`)
- Spur HITL: `/Users/robin/xprojects/spur-new/packages/app/src/workflow/actions/hitl-{select,confirm,input}.ts`
- Live copy rule (two roots): `plugins/kk/commands/workflow-run.md`
- Historical copy rule (do not rewrite): `docs/tasks/0056_specify-the-kk-config-works-workspace-and-workflow-install-c.md` Block 5
- Product YAML home: `plugins/kk/workflows/{kk-storm-research,kk-ingest-generate-publish,judge-gated-publish-example,kk-itc}.yaml`
- Writers / judge: `plugins/kk/skills/{topic,itc-generating,content-judge,storm-research}/SKILL.md`
- ADR home: `docs/00_ADR.md` ADR-009 amendment 2026-08-19
### History
- 2026-08-19T22:21:04.371Z todo → wip (system)
- 2026-08-19T22:21:04.666Z wip → testing (system)
- 2026-08-19T22:21:06.692Z testing → done (system)
