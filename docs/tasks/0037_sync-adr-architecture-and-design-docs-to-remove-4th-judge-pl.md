---
template: feature-impl
schema_version: 1
name: "LLM-as-judge agent skills and workflow integration"
description: "End-to-end delivery of LLM-as-judge via agent skills, workflow integration via agent.run, thin wrappers, and architecture doc sync"
status: done
type: task
profile: standard
feature_id: B7
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-03T06:36:52.680Z"
updated_at: "2026-08-08T00:19:59.086Z"
---

## 0037. LLM-as-judge agent skills and workflow integration

### Background

Feature B7 is repositioned from "Judge plugin kind" (a 4th platform plugin kind) to an agent-skill-centric model ("LLM-as-judge agent skills & workflow integration"). This consolidated task delivers the complete end-to-end scope: updating architecture/design docs to align with the 3-kind platform taxonomy, developing the core fat skill (`kk-judge`) for LLM evaluation and verdict emission, creating thin wrappers (slash commands/subagents) for specialized personas, and integrating `agent.run` steps with shell/jq verdict guards into Spur workflows.

### Requirements

R1. Sync `docs/00_ADR.md` (ADR-007 amendment), `docs/01_PRD.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, and `docs/05_FEATURES.md` to remove `kind: judge` and document the skill-first `agent.run` model.
R2. Develop core fat skill (`plugins/kk/skills/kk-judge`) containing evaluation rubrics, prompt templates, and structured verdict emission (`PASS`/`FAIL`/`NEEDS_REVISION`).
R3. Create thin slash command or subagent wrappers for specialized judge personas (tech-accuracy, brand-tone, compliance) delegating to the fat skill.
R4. Configure spur workflow steps to execute LLM-as-judge skills via `agent.run` and demonstrate shell/jq verdict guards.

### Acceptance Criteria

```gherkin
Feature: LLM-as-judge agent skills and workflow integration

  Scenario: Evaluation logic is centralized in a core fat skill
    Given a core LLM-as-judge agent skill
    When an evaluation request is executed with target content and rubric
    Then the skill executes the evaluation against the rubric
      And emits a structured verdict containing result (PASS/FAIL/NEEDS_REVISION) and reasoning summary

  Scenario: Spur workflow executes LLM-as-judge via agent.run
    Given a spur workflow with an LLM evaluation gate before publish
    When the workflow step executes `type: agent.run` targeting the judge skill
    Then the agent evaluates the content and writes the verdict file
      And the subsequent shell guard evaluates the verdict file to allow or block transition

  Scenario: Thin wrappers expose specialized judge subagents or slash commands
    Given thin slash commands or subagents (e.g. tech-accuracy, compliance, brand-tone)
    When invoked by a user or workflow
    Then they delegate core evaluation execution to the underlying fat judge skill
```

### Q&A

### Design

**Chosen Approach:**
1. **Doc Sync (ADR-007 Rollback/Update):**
   - Revert the 2026-08-02 amendment in `docs/00_ADR.md` that declared `judge` as a 4th plugin kind (`Content → Verdict`). Restate the 3-kind plugin taxonomy (`ingestion`, `generator`, `publish`).
   - Sync `docs/01_PRD.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, and `docs/05_FEATURES.md` to remove `kind: judge`, `kk invoke <judge-plugin>`, and `kk plugins list --kind judge`.
   - Update `packages/kk-core/src/types/kinds.ts` / `manifest.ts` if `judge` was declared in runtime constants (or keep `VerdictSchema` as a standalone utility schema in `kk-core` if needed).

2. **Core Fat Skill (`kk-judge`):**
   - Create `plugins/kk/skills/kk-judge/SKILL.md` as the Fat Skill SSOT.
   - Centralize prompt templates, evaluation rubrics (technical accuracy, brand tone, compliance), and structured verdict output formatting (`verdict: PASS | FAIL | NEEDS_REVISION`, reasoning, design feedback).
   - Output target format: JSON verdict file written to a designated output path (e.g. `.spur/run/verdict-<step>.json`).

3. **Thin Wrappers:**
   - Define subagent / slash command wrappers (e.g. `kk-judge-tech`, `kk-judge-tone`) in `plugins/kk/agents/` or command specs that set the default persona/rubric and forward execution to `kk-judge`.

4. **Spur Workflow Integration (`agent.run` + Shell Guard):**
   - Demonstrate `agent.run` in Spur workflows referencing the judge skill/agent.
   - Add standard shell/`jq` guards to inspect `.verdict` in the emitted verdict file:
     ```yaml
     - name: check-verdict
       type: shell
       run: |
         verdict=$(jq -r '.verdict' .spur/run/verdict.json)
         if [ "$verdict" != "PASS" ]; then
           echo "LLM Judge failed with verdict: $verdict"
           exit 1
         fi
     ```

**Key Tradeoffs:**
- *Pro:* Decreases platform surface area (3 kinds vs 4). Zero engine changes required in Spur. Highly flexible prompt/rubric iteration without recompiling/manifest changes.
- *Con:* Verdict schema validation shifts from `kk invoke` contract check to skill-internal output formatting. Mitigated by `VerdictSchema` validation inside the skill execution step.

**Impacted Surfaces:**
- `docs/00_ADR.md`, `docs/01_PRD.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`
- `packages/kk-core/src/` (kinds/schemas alignment)
- `plugins/kk/skills/kk-judge/SKILL.md` (new fat skill)
- `plugins/kk/agents/` (thin subagent wrappers)
- `.spur/workflows/` (example workflow updates)

### Plan

1. **Phase 1: Architecture & Documentation Sync**
   - [ ] Amend `docs/00_ADR.md` (ADR-007): remove `judge` as a 4th plugin kind; record decision to use `agent.run` + fat skills.
   - [ ] Update `docs/01_PRD.md` and `docs/03_ARCHITECTURE.md`: restore 3-kind taxonomy (`ingestion`, `generator`, `publish`).
   - [ ] Update `docs/04_DESIGN.md` and `docs/05_FEATURES.md`: update CLI/manifest surface documentation and feature B7 status.
   - [ ] Verify `packages/kk-core/src/types/kinds.ts`: ensure `PLUGIN_KINDS` array contains only `'ingestion'`, `'generator'`, `'publish'`.

2. **Phase 2: Core Fat Skill (`kk-judge`) Implementation**
   - [ ] Scaffold `plugins/kk/skills/kk-judge/SKILL.md` with YAML frontmatter, evaluation rubrics, prompt templates, and verdict output contracts.
   - [ ] Implement verdict JSON output format supporting `PASS`, `FAIL`, `NEEDS_REVISION`, reasoning summary, and feedback notes.

3. **Phase 3: Thin Wrappers (Slash Commands / Subagents)**
   - [ ] Author thin subagent manifest(s) in `plugins/kk/agents/` (e.g. tech accuracy, compliance) delegating to `kk-judge`.

4. **Phase 4: Workflow Integration & Verification**
   - [ ] Update sample workflow files (e.g. `docs/design/judge-gated-publish-example.yaml`) to show `type: agent.run` targeting `kk-judge` followed by a shell/`jq` verdict guard.
   - [ ] Run `bun run check` / `spur feature check B7` to verify quality gates and requirement traceability.

### Solution
**Doc sync (R1) — 3-kind taxonomy restored.** ADR-007 amdt 2026-08-07
(`docs/00_ADR.md:216`) supersedes the 2026-08-02 `judge`-as-4th-kind amendment; `01_PRD.md`,
`03_ARCHITECTURE.md` (v2.1.0), `04_DESIGN.md` (v2.1.0), `05_FEATURES.md` (v2.4.0),
`02_ROADMAP.md` (v3.1.0), `AGENTS.md`, feature B, feature J, and
`docs/plans/feature-tree-restructure-map-j.md` all now describe three plugin kinds with
LLM-as-judge delivered as agent skills + `agent.run`. Runtime confirmed already correct:
`packages/kk-core/src/kinds.ts:5` — `PLUGIN_KINDS = ['ingestion', 'generator', 'publish']`;
`VerdictSchema` was aspirational in the design doc and never existed in `schemas.ts`/`index.ts`,
so no code removal was needed.

**Core fat skill (R2).** Verdict output contract at `plugins/kk/skills/kk-judge/SKILL.md:25` (`PASS`/`FAIL`/`NEEDS_REVISION` + `score` + `findings[]` + `feedback[]`); 6-step evaluation procedure, evidence discipline, and prompt template in the same file.
`references/rubrics.md` defines four rubrics (`general`, `tech-accuracy`, `brand-tone`,
`compliance`) with criterion weights, must-pass flags, score thresholds, and per-rubric notes.
`references/workflow-integration.md` documents the `agent.run` step shape, the shell/`jq` guard,
and the bounded NEEDS_REVISION retry topology.

**Thin wrappers (R3) — `plugins/kk/agents/`.** `kk-judge-tech.md`, `kk-judge-tone.md`,
`kk-judge-compliance.md` each fix one rubric and delegate evaluation to the fat skill; no
evaluation logic is duplicated.

**Workflow integration (R4) — `.spur/workflows/judge-gated-publish-example.yaml:37`.** The judge
state's `onEnter` is `kind: agent.run` targeting `kk-judge` (`:39`), followed by a 3-way
shell/`jq` verdict guard: `PASS → publish`, `NEEDS_REVISION → generate` (bounded by
`maxRetries`), `FAIL (or retries exhausted) → failed`. `spur workflow validate` PASS;
`spur workflow run --dry-run` confirms PASS routes to `done` and a seeded FAIL routes to
`failed` (exit 1) — fail-closed verified.

**Engine note.** Spur's default host registers only `note`, `shell`, `event.emit` action kinds
(in `@gobing-ai/spur`, `createDefaultWorkflowEngineHost`); `agent.run` is schema-valid (open
`string`) and is registered by the `kk` workflow host via `host.registerAction`. The example
workflow is illustrative; under `spur workflow run --dry-run` the `onEnter` actions are skipped,
so the seeded verdict file drives the guard evaluation.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | ADR-007 amendment 2026-08-07 (docs/00_ADR.md:216-241) supersedes the 2026-08-02 fourth-kind amendment; plugin taxonomy reverts to three kinds. `PLUGIN_KINDS` in packages/kk-core/src/kinds.ts:5 = `['ingestion','generator','publish']` — no `judge`. docs/01_PRD.md, docs/03_ARCHITECTURE.md (line 79: "LLM-as-judge is not a plugin kind"), docs/04_DESIGN.md, docs/05_FEATURES.md (line 23: repositioned to agent skills) all synced; grep for stale `kind: judge` / `fourth` returns only the correct "is not a kind" documentation. |
| R2 | MET | `plugins/kk/skills/kk-judge/SKILL.md` is the fat skill SSOT: 7-step evaluation procedure, 4 built-in rubrics (general/tech-accuracy/brand-tone/compliance), prompt template, and verdict JSON output contract emitting `verdict: PASS \ |
| R3 | MET | Three thin wrappers in `plugins/kk/agents/`: `kk-judge-tech.md` (tech-accuracy rubric), `kk-judge-tone.md` (brand-tone), `kk-judge-compliance.md` (compliance). Each fixes the rubric and forwards to the fat skill without duplicating evaluation logic. |
| R4 | MET | `.spur/workflows/judge-gated-publish-example.yaml` demonstrates `type: agent.run` with `skill: kk-judge` (judge state, lines 37-44) writing the verdict file, followed by shell/jq verdict guards on transitions: judge→publish on PASS (line 73), judge→generate on NEEDS_REVISION with bounded retry (line 85), judge→failed on FAIL (line 94). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Evaluation logic is centralized in a core fat skill | MET | command | `ls plugins/kk/skills/kk-judge/SKILL.md` exists; `grep -c 'verdict.*PASS.*FAIL.*NEEDS_REVISION' plugins/kk/skills/kk-judge/SKILL.md` confirms the structured verdict contract is present in the fat skill. The skill's 7-step procedure + 4 rubrics + prompt template make it the evaluation SSOT. |
| Spur workflow executes LLM-as-judge via agent.run | MET | command | `spur workflow validate .spur/workflows/judge-gated-publish-example.yaml` passes; `grep -n 'kind: agent.run' .spur/workflows/judge-gated-publish-example.yaml` finds the judge step (line 37); `grep -n 'jq -r .verdict'` finds the shell guard (lines 73,85,94) gating publish on PASS. |
| Thin wrappers expose specialized judge subagents or slash commands | MET | command | `ls plugins/kk/agents/kk-judge-*.md` returns the three wrappers (tech, tone, compliance); `grep -l 'kk-judge' plugins/kk/agents/kk-judge-*.md` confirms each delegates to the fat skill. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | bun run lint | — | biome check 53 files, no fixes applied; typecheck exit 0 across all 6 workspaces. |
| P4 | bun run test | — | 81 pass, 0 fail, 200 expect() calls across 14 files. Coverage 99.49% functions / 98.02% lines (>= 90% target). |
| P4 | spur task check 0037 | — | PASS (no missing sections; one L4 advisory warning on Plan gate language). |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

B7

### History
- 2026-08-08T00:13:51.094Z todo → wip (system)
- 2026-08-08T00:19:44.917Z wip → testing (system)
- 2026-08-08T00:19:59.086Z testing → done (system)
