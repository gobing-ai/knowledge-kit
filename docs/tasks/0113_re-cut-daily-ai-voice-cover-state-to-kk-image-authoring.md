---
schema_version: 1
name: Re-cut daily-ai-voice cover state to kk image-authoring
status: todo
template: feature-impl
created_at: 2026-09-11T05:55:57.575Z
updated_at: "2026-09-11T05:56:27.473Z"
feature_id: N
priority: P2
tags:
  - kk
  - workflows
  - image

---

## 0113. Re-cut daily-ai-voice cover state to kk image-authoring

### Background

plugins/kk/workflows/kk-daily-ai-voice.yaml's cover state still invokes the retired wt-image-cover skill and a nonexistent 'news' style. Image work now lives in kk image-authoring (plugins/kk/skills/image-authoring) over the image-gen generator plugin (plugins/generations/image-gen).

### Requirements

- R1. The cover agent.run invokes Skill kk:image-authoring per its workflow contract: KK_NONINTERACTIVE=1 and KK_IMAGE_AUTO_CONFIRM=1 (spend approval rides the workflow's cover_enabled), --format cover, --content <generated article md>, --out ${work_dir}/2-cover/content.json.
- R2. A shell step normalizes the plugin artifact (<outDir>/content-cover-01.png) to the canonical ${work_dir}/2-cover/cover-<run_date>.png so publish-prep, the voice article cover reference and the absent-file guard keep working unchanged.
- R3. cover_enabled=false and the article-already-has-cover-ish preconditions skip exactly as today.
- R4. State names/sequence of the rest of the workflow are untouched.

### Acceptance Criteria

```gherkin
Scenario: R1 — cover state invokes kk image-authoring under the non-interactive contract
    Given the cover state's agent.run input in kk-daily-ai-voice.yaml with cover_enabled=true
    When the workflow reaches the cover state
    Then it sets KK_NONINTERACTIVE=1 and KK_IMAGE_AUTO_CONFIRM=1 and invokes Skill kk:image-authoring with --format cover, --content over the generated article markdown and --out at ${work_dir}/2-cover/content.json

  Scenario: R2 — canonical cover artifact reaches downstream states unchanged
    Given a successful cover generation
    When later states consume the artifact
    Then ${work_dir}/2-cover/cover-<run_date>.png exists and downstream references need no edits

  Scenario: R3 — cover_enabled=false skips all image spend
    Given cover_enabled=false
    When the workflow runs
    Then no cover generation is attempted and downstream behavior matches the current guard semantics

  Scenario: R4 — the rest of the workflow is untouched
    Given the diff of kk-daily-ai-voice.yaml
    When its states are compared with the pre-change file
    Then only the cover state and one normalization step differ
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Small seam swap: skill decides (derive title/subtitle/topics from the article = model work), plugin executes. Confirmation is the env pair mandated by the skill's Confirmation policy; the cap (maxImages) is the backstop. No engine or preset changes.

### Plan

1. Read the cover state + related vars in kk-daily-ai-voice.yaml. 2. Replace agent.run input with the kk skill invocation per the contract. 3. Add the rename/normalize shell step. 4. Validate workflow (spur workflow gates/dry-run) and lint the YAML.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
