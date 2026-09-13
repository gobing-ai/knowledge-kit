---
schema_version: 1
name: "omni-voice-gen: VoiceScript parse/merge/validate with warn-ignore"
status: backlog
template: feature-impl
created_at: 2026-09-13T05:54:10.542Z
updated_at: "2026-09-13T06:27:07.249Z"
feature_id: F611

ac_altitude: task-local
---

## 0122. omni-voice-gen: VoiceScript parse/merge/validate with warn-ignore

### Background

Captured from the creation title: "omni-voice-gen: VoiceScript parse/merge/validate with warn-ignore".

### Requirements

- [ ] R1. `voicescript.py` ports `parseDocToVoiceScript` exactly: `{` → JSON (YAML fallback on JSON parse
    failure); `[` non-`[-` plain-text fast path; YAML mapping containing any voicescript key →
    VoiceScript; otherwise plain-text single segment with default_profile from env/doc metadata.
- [ ] R2. `merge_voice_scripts` port: title/default resolution and duplicate-speaker-key error identical
    to voice-gen.
- [ ] R3. `validate_voice_script` port with identical constants (TEXT_MAX 50000, INSTRUCT_MAX 500,
    chunk 100..5000 default 800, crossfade 0..500 default 50) and identical error semantics; the
    Voicebox engine/language allowlists are NOT ported (OmniVoice language set is a superset).
- [ ] R4. `resolve_instruct` port: instruct+emotion merge rules identical.
- [ ] R5. Warn-and-ignore (D5): `engine`, `personality`, `effects_chain`, `effect_preset` at any level are
    collected during validation and reported in ONE stderr warning per run naming every ignored
    field; validation never fails on them.

### Acceptance Criteria

```gherkin
Feature: VoiceScript parse/merge/validate parity

  Scenario: Parse paths match voice-gen
    Given the corpus of VoiceScript inputs exercised by voice-gen tests (JSON, YAML, plain text, tag-prefixed text)
    When omni-voice-gen parses them
    Then the resulting VoiceScript structures are equivalent (segment order, defaults, speakers)

  Scenario: Validation limits identical
    Given segments violating each limit (text > 50000, instruct > 500, chunk/crossfade out of range, unknown speaker)
    When validation runs
    Then it fails with the voice-gen error semantics for each

  Scenario: Warn-and-ignore fields
    Given a VoiceScript carrying engine, personality, effects_chain, and effect_preset
    When validation runs
    Then it passes and one stderr warning names all four ignored fields
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-13T06:26:34.367Z

- Q: Port the engine/language allowlists? A: no — engine is warn-ignored (D5) and OmniVoice's own
  _resolve_language validates a superset of languages; porting the 23-code list would reject valid
  OmniVoice languages.
- Q: JSON-then-YAML parse order from voice-gen? A: preserved semantically — yaml.safe_load covers
  both (JSON ⊂ YAML), branch order kept so error messages and the `[laugh]` fast path match.
- Q: Where do effects fields go? A: parsed into the dataclasses (so unknown YAML never fails) and
  reported via WarnSink; never forwarded to the backend.

### Design

WHAT/WHY: exact Python port of plugins/generations/voice-gen/src/voicescript.ts (502 lines, read
2026-09-12) — parse/merge/validate behavior must be indistinguishable from voice-gen for the same
VoiceScript corpus, or the drop-in promise breaks.

WHERE / frozen names (mirrors kept intentionally for port traceability):
- `src/omni_voice_gen/voicescript.py`: dataclasses `VoiceScript`, `VoiceSegment`, `VoiceSpeaker`;
  constants `VOICEBOX_TEXT_MAX=50_000`, `VOICEBOX_INSTRUCT_MAX=500`, `VOICEBOX_CHUNK_CHARS_MIN=100`,
  `MAX=5_000`, `DEFAULT=800`, `VOICEBOX_CROSSFADE_MS_MIN=0`, `MAX=500`, `DEFAULT=50`;
  `parse_doc_to_voicescript(doc: Doc, env_default_profile: str|None) -> VoiceScript`;
  `merge_voice_scripts(scripts, docs, env_default_profile) -> VoiceScript`;
  `validate_voice_script(script, sink: WarnSink) -> None` (raises ValueError with voice-gen message text);
  `resolve_instruct(instruct, emotion) -> str|None`; `WarnSink` collector class (`add(field, where)`,
  `emit_once() -> str|None`).
- Branch order (load-bearing): `{` → JSON via yaml.safe_load (JSON is valid YAML 1.2; error text
  keeps voice-gen semantics) → `[` non-`[-` plain-text fast path (unless body contains
  `segments:`/`speakers:`) → yaml.safe_load mapping with any VOICESCRIPT_KEYS → plain-text fallback
  single segment with default_profile from env then doc.metadata.voiceProfile.

Anti-patterns: do NOT port the Voicebox engine allowlist (VOICEBOX_ENGINES) or the 23-language
allowlist — engine/personality/effects_chain/effect_preset are collected into WarnSink (D5), and
language strings pass through unvalidated (OmniVoice _resolve_language validates against its 600+
LANG_IDS with a better error than we could write). Do NOT emit warnings from inside validate —
aggregation is pipeline.py's job (0125) so the warning appears exactly once per run.

Handoff: 0125 imports the five public names above + WarnSink; no other consumer.

### Plan

1. VoiceScript dataclasses + constants.
2. parse/merge/validate + resolve_instruct port.
3. Warn-ignore collector.
4. tests mirroring voice-gen tests + warn-ignore cases (100% branch coverage of this module).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Spec: docs/design/omni-voice-gen.md (D5)
- Source of truth: plugins/generations/voice-gen/src/voicescript.ts
- Blocked by: 0121 (scaffold)

### History
