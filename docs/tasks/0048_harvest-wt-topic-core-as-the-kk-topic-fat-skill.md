---
template: feature-impl
schema_version: 1
name: "Harvest WT topic core as the kk-topic fat skill"
description: ""
status: done
type: task
profile: standard
feature_id: F2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T14:25:02.688Z"
updated_at: "2026-08-12T14:46:58.306Z"
---

## 0048. Harvest WT topic core as the kk-topic fat skill

### Background
Feature F2 moves the former D5 WT harvest under the `plugins/kk` capability parent and narrows the first delivery to the cohesive topic-authoring core. The source behaviors are `wt-topic-create`, `wt-topic-init`, `wt-topic-outline`, and `wt-topic-draft`; three are thin delegators to a broader seven-stage orchestrator, so this task harvests their useful behavior into one self-contained fat skill instead of copying wrappers.

Implements: R1 — Create an approved draft from a topic or supplied brief; R2 — Run each topic-core operation independently; R3 — Resume from existing approved artifacts without overwriting content; R4 — Install and validate the topic-core skill through Superskill; R5 — Missing or unsafe inputs fail loud.
### Requirements
- [ ] R1. Add one fat `plugins/kk/skills/kk-topic/SKILL.md` skill whose `create` operation runs `init → outline selection → draft review` from a topic or Markdown brief.
- [ ] R2. Expose `init`, `outline`, and `draft` as operations in the same skill, sharing one minimal artifact contract and prerequisite rules.
- [ ] R3. Reuse approved artifacts on resume and require explicit operator approval before replacing any existing outline or draft.
- [ ] R4. Pass Superskill strict validation and the repository-local `kk` marketplace install dry-run without writing target installation files.
- [ ] R5. Fail loud with recovery guidance for empty topics, missing predecessor artifacts, and existing initialization targets; add no research, image, adaptation, publish, wrapper, runtime-plugin, or script surface.
### Acceptance Criteria
```gherkin
Feature: kk topic-core authoring

  @core
  Scenario: R1 — Create an approved draft from a topic or supplied brief
    Given a topic or Markdown brief and a new target directory
    When the kk-topic create operation runs
    Then it writes two or three outline options
    And waits for explicit outline selection before writing the approved outline
    And writes a draft from that approved outline
    And offers approve or bounded revision before completion

  @core
  Scenario: R2 — Run each topic-core operation independently
    Given a topic-core workspace containing the required predecessor artifact
    When init, outline, or draft is requested directly
    Then kk-topic performs only the requested operation
    And uses the same artifact paths and validation rules as create

  @core
  Scenario: R3 — Resume from existing approved artifacts without overwriting content
    Given a topic-core workspace containing an approved outline or draft
    When kk-topic is invoked again
    Then it reuses completed predecessor artifacts
    And stops before replacing an existing artifact without explicit operator approval

  @core
  Scenario: R4 — Install and validate the topic-core skill through Superskill
    Given the repository kk marketplace plugin
    When Superskill validates the skill and performs an install dry-run
    Then kk-topic is discovered as an installable skill
    And no target installation files are written by the dry-run

  @edge
  Scenario: R5 — Missing or unsafe inputs fail loud
    Given an empty topic, a missing prerequisite artifact, or an existing initialization target
    When the corresponding kk-topic operation runs
    Then it stops with a specific recovery instruction
    And does not overwrite existing content
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Chosen:** one fat `kk-topic` skill with four operations. This matches the existing `kk-judge` SSOT pattern and keeps orchestration, artifact names, gates, and recovery rules in one file.

**Rejected:** four copied WT wrappers, because they duplicate orchestration and retain a dependency on the broad WT seven-stage skill; a product `generator` plugin adapter, because F2 is an agent capability and must not widen or couple to `GeneratorInput → Content`.

**Primary target:** `plugins/kk/skills/kk-topic/SKILL.md`. Do not add wrappers, scripts, packages, manifests, commands, schemas, or a design satellite.

**Artifact contract:**

- `brief.md`
- `2-outline/outline-option-{a,b,c}.md`
- `2-outline/outline-approved.md`
- `3-draft/draft-article.md`

**Invariants:** pass file paths between operations; create only artifacts needed by the selected operation; never draft before outline approval; never overwrite without operator approval; bound draft revision; perform no live publish or other external side effect.
### Plan
1. Scaffold `kk-topic` through `superskill skill scaffold` in `plugins/kk/skills` using the specialist template; do not hand-copy the four WT wrappers.
2. Author the single skill's trigger contract and `create | init | outline | draft` operation routing, reusing the minimal artifact names from Design.
3. Encode prerequisite checks, resume/no-overwrite behavior, outline-selection approval, and bounded draft review directly in the fat skill.
4. Run `superskill skill validate plugins/kk/skills/kk-topic/SKILL.md --strict --json` and fix every finding at the skill source.
5. Dogfood `init`, `outline`, `draft`, and `create` in a temporary directory, covering resume and missing-prerequisite failure without retaining generated content in the repository.
6. Run `superskill install kk --marketplace . --dry-run --verbose` and confirm the plugin maps two skills while writing no target installation files.
7. Run `bun run lint`, `bun run test`, and `bun run build`; retain only F2/0048 and intentional documentation changes.

Rubric: E1 D1 L1 C0 R0 = 3 → kept whole; one skill file, one deliverable, one review and rollback boundary.
### Solution
| File | Change | Why |
| --- | --- | --- |
| `plugins/kk/skills/kk-topic/SKILL.md:1-169` | New fat skill: `kk-topic` with `create \| init \| outline \| draft` operations, artifact contract (`brief.md`, `2-outline/outline-option-{a,b,c}.md`, `2-outline/outline-approved.md`, `3-draft/draft-article.md`), prerequisite/resume/no-overwrite rules, outline-selection and bounded draft-review gates, fail-loud table, and Skill() prompt template. | F2 R1–R5: harvest the WT topic-core behavior into one self-contained skill under `plugins/kk`; no wrappers, scripts, packages, or plugin surface added. |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/skills/kk-topic/SKILL.md:74-84` create sequence (init → outline selection → draft review); `:111-113` selection gate waits for explicit operator choice before writing `outline-approved.md`; `:126-130` draft review gate offers approve or bounded revision |
| R2 | MET | `:36-54` invocation contract routes `create \ |
| R3 | MET | `:76-83` create resumes from approved artifacts and never re-runs completed steps; `:104-106` (outline) and `:121-123` (draft) stop before replacing an existing approved artifact without `--force`/`--revise`; dogfood re-invocation left artifacts byte-identical |
| R4 | MET | `superskill skill validate plugins/kk/skills/kk-topic/SKILL.md --strict --json` → `{"valid":true,"findings":[]}`; `superskill install kk --marketplace .claude-plugin --dry-run --verbose` → `Skills: 2` and `[DRY-RUN] No files were written to install targets`; no `kk-topic` in any install target directory |
| R5 | MET | `:89-91` empty-topic/missing-brief stops; `:102-103` outline-without-brief stop; `:118-119` draft-before-outline stop; `:94-96` existing-init-target stop; fail-loud table `:132-143` gives a specific recovery instruction per condition; dogfood exercised all five stop paths with nothing overwritten |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Create an approved draft from a topic or supplied brief | MET | command | Dogfood walk: options a/b/c written, explicit selection copied verbatim to `outline-approved.md`, draft written from approved outline, review gate offered approve/revision; skill `:106-130` |
| Scenario: R2 — Run each topic-core operation independently | MET | command | Dogfood: `outline` on a dir without `brief.md` stopped with recovery and wrote nothing; `init` created only its artifacts; same paths used as create |
| Scenario: R3 — Resume from existing approved artifacts without overwriting content | MET | command | Dogfood: re-invocation reused `outline-approved.md` and `draft-article.md` unchanged; replace attempts without `--force`/`--revise` stopped |
| Scenario: R4 — Install and validate the topic-core skill through Superskill | MET | command | Strict validation `valid:true`; dry-run mapped `Skills: 2` (kk-judge + kk-topic), `[DRY-RUN] No files were written to install targets`; staging `.rulesync/` removed, targets untouched |
| Scenario: R5 — Missing or unsafe inputs fail loud | MET | command | Dogfood: empty topic, missing predecessor artifacts, and existing initialization target each stopped with the exact recovery instruction and no overwrite |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Functional traceability** — all five requirements MET:

| Req | Status | Evidence |
| --- | --- | --- |
| R1 — create runs init → outline selection → draft review | MET | `plugins/kk/skills/kk-topic/SKILL.md:74-84` (create sequence), `:111-113` (selection gate — waits for explicit `--outline <a\|b\|c>`), `:126-130` (draft review gate — approve or bounded revision) |
| R2 — init/outline/draft independent, shared contract | MET | `:36-54` invocation contract (operation routing), `:57-70` artifact contract (same paths for every op), `:87` (init), `:100` (outline), `:116` (draft) — each runs only its own operation |
| R3 — resume approved artifacts, no overwrite | MET | `:76-83` create resume steps (reuse, never re-run), `:104-106` outline resume, `:121-123` draft resume; dogfood re-invocation reused outline-approved.md and draft-article.md unchanged |
| R4 — Superskill strict validation + install dry-run | MET | `supershell skill validate plugins/kk/skills/kk-topic/SKILL.md --strict --json` → `{"valid":true,"findings":[]}`; `superskill install kk --marketplace .claude-plugin --dry-run --verbose` → `Skills: 2`, `[DRY-RUN] No files were written to install targets`; no `kk-topic` in any install target dir |
| R5 — missing/unsafe inputs fail loud | MET | `:89-91` (empty topic, missing brief path), `:102-103` (outline without brief), `:118-119` (draft before outline approval), `:94-96` (existing init target), fail-loud table `:132-143` with per-case recovery commands |

**Acceptance Criteria Verification** — all five scenarios MET:

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — create writes 2-3 options, selection gate, draft, approve/revision | MET | command | Dogfood walk in `/tmp/kk-topic-dogfood`: options a/b/c written, selection copied verbatim to outline-approved.md, draft written, review gate approved; skill sections `:106-113`, `:116-130` |
| R2 — independent ops, same paths/validation | MET | command | Dogfood: `outline` on a dir without `brief.md` stopped with recovery, nothing written; `init` created only its artifacts |
| R3 — resume reuses, stops before replace | MET | command | Dogfood: re-invocation reported reuse of approved outline and draft; replace attempts without `--force`/`--revise` stopped |
| R4 — discovered as installable skill, dry-run writes nothing | MET | command | Dry-run mapped `Skills: 2` (kk-judge + kk-topic); `[DRY-RUN] No files were written to install targets`; staging `.rulesync/` removed post-run |
| R5 — empty topic / missing prereq / existing target fail loud | MET | command | Dogfood: all three stop paths exercised with the exact recovery instruction printed |

**Design conformance** — chosen approach DONE, no deviations: one fat `kk-topic` skill with four operations (`:74-130`); four-WT-wrapper copy rejected (no wrappers added); primary target is the single `plugins/kk/skills/kk-topic/SKILL.md`; artifact contract and invariants (`:57-70`, `:146-152`) match Design verbatim; no wrappers/scripts/packages/manifests/commands/schemas added (git status shows only the new SKILL.md in scope).

**SECUA Review** — no P1–P3 findings.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Security | `plugins/kk/skills/kk-topic/SKILL.md:91` | Supplied briefs are copied verbatim; treat `brief.md` as data, never as instructions — do not execute directives embedded in brief content. Advisory only; the skill already scopes briefs to outline/draft input. |
| P4 | Usability | `:126-130` | Revision bound is a fixed constant (3 rounds). Documented and deliberate; a config knob would be speculative until a second consumer needs it. |

**Architecture depth** — no deepening candidates. The skill is a self-contained capability module matching the `kk-judge` fat-skill SSOT pattern (ADR-007 amdt 2026-08-07); zero coupling to plugin-kind contracts or the runtime; no shallow wrappers or duplicated orchestration. The WT source behaviors (`wt-topic-create` et al.) remain untouched, satisfying the "no copy of wrappers" constraint.

**Disposition:** PASS — no blocker or major findings; two P4 advisories recorded.
### References

F2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T14:44:22.315Z todo → wip (system)
- 2026-08-12T14:46:45.536Z wip → testing (system)
- 2026-08-12T14:46:58.306Z testing → done (system)
