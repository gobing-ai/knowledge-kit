---
schema_version: 1
name: "omni-voice-gen: VoiceScript parse/merge/validate with warn-ignore"
status: done
template: feature-impl
created_at: 2026-09-13T05:54:10.542Z
updated_at: "2026-09-13T20:13:19.088Z"
feature_id: F611

ac_altitude: task-local
---

## 0122. omni-voice-gen: VoiceScript parse/merge/validate with warn-ignore

### Background

Captured from the creation title: "omni-voice-gen: VoiceScript parse/merge/validate with warn-ignore".

### Requirements

- [x] R1. `voicescript.py` ports `parseDocToVoiceScript` exactly: `{` → JSON (YAML fallback on JSON parse
    failure); `[` non-`[-` plain-text fast path; YAML mapping containing any voicescript key →
    VoiceScript; otherwise plain-text single segment with default_profile from env/doc metadata.
- [x] R2. `merge_voice_scripts` port: title/default resolution and duplicate-speaker-key error identical
    to voice-gen.
- [x] R3. `validate_voice_script` port with identical constants (TEXT_MAX 50000, INSTRUCT_MAX 500,
    chunk 100..5000 default 800, crossfade 0..500 default 50) and identical error semantics; the
    Voicebox engine/language allowlists are NOT ported (OmniVoice language set is a superset).
- [x] R4. `resolve_instruct` port: instruct+emotion merge rules identical.
- [x] R5. Warn-and-ignore (D5): `engine`, `personality`, `effects_chain`, `effect_preset` at any level are
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

#### Q&A

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

#### Design

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

#### Plan

1. VoiceScript dataclasses + constants.
2. parse/merge/validate + resolve_instruct port.
3. Warn-ignore collector.
4. tests mirroring voice-gen tests + warn-ignore cases (100% branch coverage of this module).

#### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

#### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

#### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

#### References

- Spec: docs/design/omni-voice-gen.md (D5)
- Source of truth: plugins/generations/voice-gen/src/voicescript.ts
- Blocked by: 0121 (scaffold)

#### History

- 2026-09-13T06:41:31.970Z backlog → todo (system)

- [x] (covers: Incompatible VoiceScript fields warn and are ignored) VoiceScript parse/merge/validate parity; incompatible fields warned and dropped

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

Implemented the voicescript.ts → voicescript.py port per the frozen Design names.

- `plugins/generations/omni-voice-gen/src/omni_voice_gen/voicescript.py`
  - Constants (voicescript.py:31-38): TEXT_MAX/INSTRUCT_MAX/chunk/crossfade identical to TS;
    `WARN_IGNORE_FIELDS` + `VOICESCRIPT_KEYS`.
  - Dataclasses `VoiceScript`/`VoiceSegment`/`VoiceSpeaker` — unknown YAML keys dropped via
    `_filter` (unknown fields never fail parse, per Q&A).
  - `parse_doc_to_voicescript` — branch order preserved: `{` → yaml.safe_load (JSON ⊂ YAML;
    failure/non-dict raise voice-gen's two "Invalid VoiceScript JSON structure" messages) →
    `[` non-`[-` tag fast path (unless body contains `segments:`/`speakers:`) → YAML mapping
    with any VOICESCRIPT_KEYS → plain-text single segment with default_profile env →
    doc.metadata.voiceProfile.
  - `merge_voice_scripts` — first-wins scalar defaults, env-profile override semantics,
    duplicate speaker key error, title fallback "Generated voice"; identical to TS.
  - `validate_voice_script(script, sink)` — same checks and message text as TS; engine/language
    allowlists NOT ported (language passes through); engine/personality/effects_chain/
    effect_preset collected into `WarnSink` at script/speaker/segment level; validate raises,
    never warns (single stderr emission is pipeline.py's job, 0125).
  - `resolve_instruct` — instruct/emotion merge rules identical.
- `plugins/generations/omni-voice-gen/tests/test_voicescript.py` — 53 tests: voice-gen corpus
  parity (JSON/YAML/plain/tag paths, merge, every validation limit) + warn-ignore collection.
  The JSON-root-non-object guard is unreachable via real YAML for `{`-prefixed bodies, so it is
  exercised with a monkeypatched parser (comment in test).

Deviation note: none from the frozen Design. TS error text kept verbatim where the TS produces
one; non-dict segments/speakers keep their "must be an object" errors.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | src/omni_voice_gen/voicescript.py parseDocToVoiceScript port; tests: test_parse_json_object, test_parse_json_failure_raises_voicegen_message, test_parse_bracket_tag_plain_text_fast_path, test_parse_dash_bracket_is_not_tag_fast_path, test_parse_bracket_with_yaml_structure_goes_to_yaml, test_parse_yaml_mapping_with_voicescript_key, test_parse_yaml_mapping_without_voicescript_key_is_plain_text, test_parse_plain_text_uses_env_default_profile, test_parse_plain_text_env_profile_beats_doc_metadata, test_parse_plain_text_falls_back_to_doc_metadata_profile |
| R2 | MET | merge_voice_scripts port; tests: test_merge_combines_defaults_speakers_segments, test_merge_duplicate_speaker_key_raises, test_merge_title_falls_back_to_generated_voice, test_merge_script_default_profile_overrides_env, test_merge_env_and_metadata_profile_fallback |
| R3 | MET | validate_voice_script port with identical constants; tests: test_validate_script_chunk_range, test_validate_script_crossfade_range, test_validate_accepts_boundary_values, test_validate_segment_text_cap, test_validate_segment_instruct_limit, test_validate_speaker_instruct_limit |
| R4 | MET | resolve_instruct port; tests: test_resolve_instruct_variants |
| R5 | MET | warn-and-ignore (D5): engine/personality/effects_chain/effect_preset collected at any level, ONE stderr warning per run, validation never fails; tests: test_warn_ignore_collects_all_levels_once, test_warn_sink_empty_emits_none; suite total 74 passed (21 scaffold + 53 voicescript) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Parse paths match voice-gen | MET | test | 13 parse-path tests (JSON/YAML/plain-text/tag fast paths, default_profile env>metadata precedence) in tests/test_voicescript.py |
| Scenario: Validation limits identical | MET | test | TEXT_MAX 50000 / INSTRUCT_MAX 500 / chunk 100..5000 / crossfade 0..500 boundary + range tests |
| Scenario: Warn-and-ignore fields | MET | test | test_warn_ignore_collects_all_levels_once asserts single warning naming every ignored field across nesting levels |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Spec: docs/design/omni-voice-gen.md (D5)
- Source of truth: plugins/generations/voice-gen/src/voicescript.ts
- Blocked by: 0121 (scaffold)

### History

- 2026-09-13T06:41:31.970Z backlog → todo (system)
- 2026-09-13T20:13:18.376Z todo → wip (system)
- 2026-09-13T20:13:18.731Z wip → testing (system)
- 2026-09-13T20:13:19.088Z testing → done (system)

