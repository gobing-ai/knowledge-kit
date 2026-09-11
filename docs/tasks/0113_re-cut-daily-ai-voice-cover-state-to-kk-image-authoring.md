---
schema_version: 1
name: Re-cut daily-ai-voice cover state to kk image-authoring
status: done
template: feature-impl
created_at: 2026-09-11T05:55:57.575Z
updated_at: "2026-09-11T05:59:21.580Z"
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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:87` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/kk/workflows/kk-daily-ai-voice.yaml cover state: agent.run input sets KK_NONINTERACTIVE=1 + KK_IMAGE_AUTO_CONFIRM=1, kk:image-authoring generate, --format cover, --content article-${run_date}.md, --out 2-cover dir; expectFile content-cover-01.png |
| R2 | MET | cover state onEnter adds shell mv 2-cover/content-cover-01.png -> cover-${runtime_date}.png (canonical name); downstream publish-prep/cover-guard untouched (rg cover-<date> consumers unchanged) |
| R3 | MET | cover_enabled var and the enabled/missing guard transitions (test ! -f cover-<date>.png) unchanged; skip semantics preserved |
| R4 | MET | spur workflow validate passes (0 errors; advisories pre-existing pattern); diff touches only the cover state + description header |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 | MET | code+test | apps/cli/tests/kk-daily-ai-voice-workflow.test.ts new R1/R2 (N) assertions pass |
| R2 | MET | test | mv normalization assertion passes; 'cover-${run_date}.png' consumers untouched |
| R3 | MET | code | guard/vars unchanged in diff |
| R4 | MET | test | upstream workflow test suite passes unchanged |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | bun run lint | — | exit 0 (biome 2.5.5 + typecheck) |
| P4 | bun run test | — | 755 tests, 0 fail |
| P4 | spur workflow validate kk-daily-ai-voice.yaml | — | no errors |
| P4 | focused bun test kk-daily-ai-voice-workflow | — | 6 pass incl. new R1/R2 (N) regression |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-11T05:59:12.774Z todo → wip (system)
- 2026-09-11T05:59:21.281Z wip → testing (system)
- 2026-09-11T05:59:21.580Z testing → done (system)

