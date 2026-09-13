---
schema_version: 1
name: "omni-voice-gen: workflow voice_generator var + docs sync"
status: todo
template: feature-impl
created_at: 2026-09-13T05:54:11.384Z
updated_at: "2026-09-13T06:41:25.793Z"
feature_id: F611

ac_altitude: task-local
---

## 0126. omni-voice-gen: workflow voice_generator var + docs sync

### Background

Captured from the creation title: "omni-voice-gen: workflow voice_generator var + docs sync".

### Requirements

- [ ] R1. `plugins/kk/workflows/kk-daily-ai-voice.yaml`: new var `voice_generator: "voice-gen"`; the
    `generate` state runs `kk executor run ${vars.voice_generator} --in ... --out ...` — no other
    YAML change; `spur workflow validate` passes.
- [ ] R2. `docs/04_DESIGN.md` gains the omni-voice-gen surface entry in the same commit as the workflow
    change (T3); `docs/design/omni-voice-gen.md` status flipped from proposed to shipped.
- [ ] R3. Plugin README: `make sync` setup, profile registry authoring guide (how to create a robin-news
    equivalent entry from a 3–10s reference clip), OMNIVOICE_* env table, first-run HF download note
    (model size/device), make targets.
- [ ] R4. Committed `profiles.json` contains documented placeholder entries only (no secrets, no operator
    private audio paths).

### Acceptance Criteria

```gherkin
Feature: Workflow swap and docs

  Scenario: Backend swap via var only
    Given kk-daily-ai-voice with voice_generator=omni-voice-gen
    When the generate state executes
    Then omni-voice-gen is invoked through the same kk executor run seam and the audio Content lands at 3-audio/content.json
    And with voice_generator=voice-gen the workflow behaves exactly as before

  Scenario: Docs consistency
    When the workflow var ships
    Then docs/04_DESIGN.md documents the omni-voice-gen surface in the same commit
    And the plugin README lets a fresh operator reach a first successful render without reading source
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-13T06:26:36.360Z

- Q: Default for voice_generator? A: "voice-gen" — current production behavior unchanged; swap is
  operator opt-in per run (-v voice_generator=omni-voice-gen or config).
- Q: Also add the var to kk-solo-podcast.yaml? A: no — out of F611 scope; solo-podcast uses
  voice-gen directly and can adopt the same pattern later (one line noted in README).

### Design

WHAT/WHY: minimal workflow touch + house-rule docs. The generate state command becomes
`kk executor run ${vars.voice_generator} --in ... --out ...`; everything else in that state (cache
guard on metadata.qc.passed, VOICE_GEN_MP3 env, error semantics) is plugin-name-agnostic already —
verified against the current YAML 2026-09-12.

WHERE / frozen names:
- `plugins/kk/workflows/kk-daily-ai-voice.yaml`: var `voice_generator: "voice-gen"` added next to
  `voice_profile`; generate-state command word swap only. Validate with `spur workflow validate`.
- `docs/04_DESIGN.md`: omni-voice-gen surface entry (plugin, env vars, metadata shape) in the SAME
  commit (T3 rule); `docs/design/omni-voice-gen.md` status → shipped.
- `plugins/generations/omni-voice-gen/README.md`: runbook — `make sync`, profile registry authoring
  (3–10s ref clip → clone entry, or `create_voice_clone_prompt` → .pt prompt entry, or instruct
  entry), OMNIVOICE_* table, first-run HF download note (multi-GB model + whisper ASR on first
  transcribe), make targets.
- `profiles.json` committed with 3 documented PLACEHOLDER entries (one per kind, obviously fake
  paths under ./examples/) — operators copy-edit; never commit real private audio paths.

Anti-patterns: do NOT rename the plugin in the workflow default (voice-gen stays default — swap is
opt-in); do NOT duplicate the env table into 04_DESIGN.md (link docs/design/omni-voice-gen.md);
no workflow guard/transition changes.

Handoff: closes F611 — after smoke, feature moves toward verifying.

### Plan

1. Add voice_generator var + generate-state change; spur workflow validate.
2. 04_DESIGN.md entry + design doc status flip (same commit).
3. Plugin README + sample profiles.json.
4. Manual smoke: kk executor run omni-voice-gen on a real voicescript Doc[] from a recent daily run.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Workflow: plugins/kk/workflows/kk-daily-ai-voice.yaml (generate state)
- Spec: docs/design/omni-voice-gen.md
- Blocked by: 0125

### History

- 2026-09-13T06:41:25.793Z backlog → todo (system)

