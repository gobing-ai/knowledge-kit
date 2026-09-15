---
schema_version: 1
name: "Extract VoiceScript template from audio-authoring SKILL.md into templates/"
status: done
template: feature-impl
created_at: 2026-08-24T06:31:42.818Z
updated_at: "2026-09-15T18:32:56.991Z"
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
| R1 | MET | `plugins/kk/skills/audio-authoring/templates/voicescript.solo.yaml` — exists (ls this run) and parses as valid YAML (parse this run: top-level keys `language`,`segments`; remaining contract fields carried as comments) |
| R2 | MET | `plugins/kk/skills/audio-authoring/SKILL.md:156` — VoiceScript contract section points to `templates/voicescript.solo.yaml`; compact field-summary table retained; no-invented-fields guard present (no `default_profile`, no required `title`); old embedded schema block absent |
| R3 | MET | Template carries every validator field as authored/commented entries — `templates/voicescript.solo.yaml:7` (default_engine), :10 (speakers), :19 (gap_ms), :20 (instruct), :23 (max_chunk_chars), :24 (crossfade_ms), :25 (speaker); validator contract `plugins/kk/scripts/validate-voicescript.ts:66-88` (re-read this run) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Template is a separate file | MET | command | `ls plugins/kk/skills/audio-authoring/templates/` → `voicescript.solo.yaml`; YAML parse OK (this run) |
| Scenario: SKILL.md references the template | MET | command | `rg -n "templates/voicescript" plugins/kk/skills/audio-authoring/SKILL.md` → :156 (exit 0, this run); `sed -n '150,175p'` section read — embedded schema block absent |
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
