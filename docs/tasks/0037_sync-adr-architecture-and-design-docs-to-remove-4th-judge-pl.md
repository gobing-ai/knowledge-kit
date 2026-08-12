---
template: feature-impl
schema_version: 1
name: "LLM-as-judge agent skills and workflow integration"
description: "End-to-end delivery of LLM-as-judge via agent skills, workflow integration via agent.run, thin wrappers, and architecture doc sync"
status: todo
type: task
profile: standard
feature_id: B7
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-03T06:36:52.680Z"
updated_at: "2026-08-03T06:39:35.000Z"
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

### Testing

### Review

### References

B7

### History
