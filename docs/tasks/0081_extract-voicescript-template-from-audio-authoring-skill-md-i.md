---
schema_version: 1
name: "Extract VoiceScript template from audio-authoring SKILL.md into templates/"
status: done
template: feature-impl
created_at: 2026-08-24T06:31:42.818Z
updated_at: "2026-08-25T23:29:21.339Z"
feature_id: F8
---

## 0081. Extract VoiceScript template from audio-authoring SKILL.md into templates/

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [x] R1. Create `plugins/kk/skills/audio-authoring/templates/voicescript.solo.yaml` — a valid-YAML solo skeleton with per-field constraint comments covering the full validator contract.
- [x] R2. `SKILL.md` VoiceScript contract section references the template instead of embedding the schema block; compact field-summary table retained; no-invented-fields guard kept in both files.
- [x] R3. Template field set matches `validate-voicescript.ts` exactly (no missing, no extras).

**Non-goals:** changing the contract itself; multi-speaker templates beyond commented guidance.
### Acceptance Criteria
```gherkin
Feature: VoiceScript template extraction

  Scenario: Template is a separate file
    When the audio-authoring skill directory is listed
    Then templates/voicescript.solo.yaml exists and parses as valid YAML

  Scenario: SKILL.md references the template
    When the VoiceScript contract section is read
    Then it points to templates/voicescript.solo.yaml
    And the old embedded schema block is absent
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
- `plugins/kk/skills/audio-authoring/templates/voicescript.solo.yaml:1` — NEW (R1): valid-YAML solo starter with constraint comments; full contract field set.
- `plugins/kk/skills/audio-authoring/SKILL.md:155` — R2: VoiceScript contract section now references the template; summary table retained; embedded schema block removed.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 (template file exists under templates/) | MET | `plugins/kk/skills/audio-authoring/templates/voicescript.solo.yaml` — valid-YAML solo skeleton with per-field constraint comments; `yamllint` clean |
| R2 (SKILL.md references, no longer embeds) | MET | `plugins/kk/skills/audio-authoring/SKILL.md` VoiceScript contract section — points to `templates/voicescript.solo.yaml`, keeps a compact field-summary table and the no-invented-fields guard; the old fenced schema block is removed |
| R3 (contract completeness preserved) | MET | Template carries every field of the validator contract: `language`, `default_engine`, `speakers` (commented, multi-speaker), `segments` with `text`/`instruct`/`gap_ms`/`engine`/`max_chunk_chars`/`crossfade_ms`/`speaker`; drift guard (`default_profile`, `title` banned) stated in both files |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Template is a separate file | MET | command | `test -f plugins/kk/skills/audio-authoring/templates/voicescript.solo.yaml` + `yamllint` clean |
| SKILL.md references the template | MET | command | `rg -c 'templates/voicescript.solo.yaml' plugins/kk/skills/audio-authoring/SKILL.md` → ≥1; old `default_engine?:` schema block absent |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | — |
| P2 | None | — | — |
| P3 | SKILL.md keeps a summary table duplicating the template's constraint comments | info | deliberate — skill stays self-describing if templates/ is skipped |
| P4 | None | — | — |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-24T06:58:55.748Z todo → wip (system)
- 2026-08-24T07:04:03.035Z wip → testing (system)
- 2026-08-24T07:05:23.404Z testing → done (system)
