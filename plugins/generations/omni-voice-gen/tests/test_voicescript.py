"""VoiceScript parse/merge/validate parity with voice-gen + D5 warn-ignore."""

import pytest

from omni_voice_gen.contract import Doc
from omni_voice_gen.voicescript import (
    VOICEBOX_TEXT_MAX,
    VoiceScript,
    VoiceSegment,
    VoiceSpeaker,
    WarnSink,
    merge_voice_scripts,
    parse_doc_to_voicescript,
    validate_voice_script,
)


def doc(body: str, doc_id: str = "1", title: str = "", metadata: dict | None = None) -> Doc:
    return Doc(id=doc_id, body=body, title=title, metadata=metadata)


# --- parse ---


def test_parse_json_object() -> None:
    script = parse_doc_to_voicescript(doc('{"segments": [{"text": "hi"}], "default_profile": "Robin"}'))
    assert script.segments == [VoiceSegment(text="hi")]
    assert script.default_profile == "Robin"


def test_parse_json_failure_raises_voicegen_message() -> None:
    with pytest.raises(ValueError, match="failed to parse JSON object"):
        parse_doc_to_voicescript(doc("{ invalid json"))


def test_parse_json_root_non_object_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    # Unreachable via real YAML for '{'-prefixed bodies (every flow `{...}` is a mapping);
    # the guard is voice-gen parity, so stub the parser to exercise it.
    monkeypatch.setattr("omni_voice_gen.voicescript.yaml.safe_load", lambda _: [1, 2])
    with pytest.raises(ValueError, match="root must be a JSON object"):
        parse_doc_to_voicescript(doc("{1, 2}"))


def test_parse_bracket_tag_plain_text_fast_path() -> None:
    script = parse_doc_to_voicescript(doc("[laugh] hi"))
    assert script.segments == [VoiceSegment(text="[laugh] hi")]


def test_parse_dash_bracket_is_not_tag_fast_path() -> None:
    script = parse_doc_to_voicescript(doc("[-] hi"))
    assert script.segments == [VoiceSegment(text="[-] hi")]


def test_parse_bracket_with_yaml_structure_goes_to_yaml() -> None:
    body = "[laugh] intro\nsegments:\n  - text: hi"
    script = parse_doc_to_voicescript(doc(body))
    # not valid YAML either -> plain-text fallback keeps the whole body
    assert script.segments == [VoiceSegment(text=body)]


def test_parse_yaml_mapping_with_voicescript_key() -> None:
    body = "speakers:\n  alice: { profile: A }\nsegments:\n  - text: hello\n    speaker: alice\n"
    script = parse_doc_to_voicescript(doc(body))
    assert script.speakers["alice"] == VoiceSpeaker(profile="A")
    assert script.segments == [VoiceSegment(text="hello", speaker="alice")]


def test_parse_yaml_mapping_without_voicescript_key_is_plain_text() -> None:
    script = parse_doc_to_voicescript(doc("foo: bar"))
    assert script.segments == [VoiceSegment(text="foo: bar")]
    assert script.default_profile is None


def test_parse_plain_text_uses_env_default_profile() -> None:
    script = parse_doc_to_voicescript(doc("hello"), env_default_profile="Env")
    assert script.default_profile == "Env"


def test_parse_plain_text_env_profile_beats_doc_metadata() -> None:
    script = parse_doc_to_voicescript(doc("hello", metadata={"voiceProfile": "Meta"}), env_default_profile="Env")
    assert script.default_profile == "Env"


def test_parse_plain_text_falls_back_to_doc_metadata_profile() -> None:
    script = parse_doc_to_voicescript(doc("hello", metadata={"voiceProfile": "Meta"}))
    assert script.default_profile == "Meta"


def test_parse_ignores_non_string_metadata_profile() -> None:
    script = parse_doc_to_voicescript(doc("hello", metadata={"voiceProfile": 3}))
    assert script.default_profile is None


def test_parse_tolerates_unknown_keys_and_non_dict_entries() -> None:
    script = parse_doc_to_voicescript(doc('{"segments": ["raw", null], "speakers": {"a": 5}, "extra": 1}'))
    assert script.segments == ["raw", None]
    assert script.speakers == {"a": 5}
    assert not hasattr(script, "extra")


# --- merge ---


def test_merge_empty_is_empty_segments() -> None:
    assert merge_voice_scripts([], []) == VoiceScript(segments=[])


def test_merge_single_returns_script_unchanged() -> None:
    script = parse_doc_to_voicescript(doc("hi"))
    assert merge_voice_scripts([script], [doc("hi")]) is script


def test_merge_combines_defaults_speakers_segments() -> None:
    doc_a = doc(
        "default_profile: Robin\ndefault_engine: qwen\nlanguage: en\nmax_chunk_chars: 500\n"
        "crossfade_ms: 100\nspeakers:\n  alice: { profile: A }\nsegments:\n  - text: hello\n",
        title="Doc 1",
    )
    doc_b = doc("speakers:\n  bob: { profile: B }\nsegments:\n  - text: world\n", doc_id="2", title="Doc 2")
    merged = merge_voice_scripts([parse_doc_to_voicescript(d) for d in (doc_a, doc_b)], [doc_a, doc_b])
    assert merged.title == "Doc 1"
    assert merged.default_profile == "Robin"
    assert merged.default_engine == "qwen"
    assert merged.language == "en"
    assert merged.max_chunk_chars == 500
    assert merged.crossfade_ms == 100
    assert merged.speakers["alice"].profile == "A"
    assert merged.speakers["bob"].profile == "B"
    assert [s.text for s in merged.segments] == ["hello", "world"]


def test_merge_duplicate_speaker_key_raises() -> None:
    doc_a = doc("speakers:\n  alice: { profile: A }\nsegments:\n  - text: one\n")
    doc_b = doc("speakers:\n  alice: { profile: B }\nsegments:\n  - text: two\n", doc_id="2")
    with pytest.raises(ValueError, match='Duplicate speaker key across documents: "alice"'):
        merge_voice_scripts([parse_doc_to_voicescript(d) for d in (doc_a, doc_b)], [doc_a, doc_b])


def test_merge_title_falls_back_to_generated_voice() -> None:
    script_a = VoiceScript(segments=[VoiceSegment(text="a")])
    script_b = VoiceScript(segments=[VoiceSegment(text="b")])
    merged = merge_voice_scripts([script_a, script_b], [doc("a"), doc("b")])
    assert merged.title == "Generated voice"


def test_merge_script_default_profile_overrides_env() -> None:
    script_a = VoiceScript(segments=[VoiceSegment(text="a")], default_profile="Robin")
    script_b = VoiceScript(segments=[VoiceSegment(text="b")], default_profile="Other")
    merged = merge_voice_scripts([script_a, script_b], [doc("a"), doc("b")], env_default_profile="Env")
    assert merged.default_profile == "Robin"


def test_merge_env_and_metadata_profile_fallback() -> None:
    script_a = VoiceScript(segments=[VoiceSegment(text="a")])
    script_b = VoiceScript(segments=[VoiceSegment(text="b")])
    merged = merge_voice_scripts([script_a, script_b], [doc("a"), doc("b", metadata={"voiceProfile": "Meta"})])
    assert merged.default_profile == "Meta"
    merged_env = merge_voice_scripts([script_a, script_b], [doc("a"), doc("b")], env_default_profile="Env")
    assert merged_env.default_profile == "Env"


def test_merge_carries_first_effects_and_profile_id() -> None:
    chain = [{"type": "gain"}]
    script_a = VoiceScript(
        segments=[VoiceSegment(text="a")],
        default_profile_id="p1",
        default_emotion="calm",
        default_effects_chain=chain,
        default_effect_preset="radio",
    )
    script_b = VoiceScript(
        segments=[VoiceSegment(text="b")],
        default_profile_id="p2",
        default_emotion="sad",
        default_effects_chain=[{"type": "delay"}],
        default_effect_preset="robotic",
    )
    merged = merge_voice_scripts([script_a, script_b], [doc("a"), doc("b")])
    assert merged.default_profile_id == "p1"
    assert merged.default_emotion == "calm"
    assert merged.default_effects_chain == chain
    assert merged.default_effect_preset == "radio"


# --- validate ---


def valid_script() -> VoiceScript:
    return VoiceScript(segments=[VoiceSegment(text="hi")])


def test_validate_rejects_non_script() -> None:
    with pytest.raises(ValueError, match="VoiceScript must be an object"):
        validate_voice_script(None, WarnSink())  # type: ignore[arg-type]


def test_validate_rejects_empty_segments() -> None:
    with pytest.raises(ValueError, match="non-empty segments"):
        validate_voice_script(VoiceScript(), WarnSink())


@pytest.mark.parametrize("value", [10, 6000, 1.5, "800"])
def test_validate_script_chunk_range(value: object) -> None:
    script = valid_script()
    script.max_chunk_chars = value
    with pytest.raises(ValueError, match="max_chunk_chars must be between 100 and 5000"):
        validate_voice_script(script, WarnSink())


@pytest.mark.parametrize("value", [-1, 600, 1.5, "50"])
def test_validate_script_crossfade_range(value: object) -> None:
    script = valid_script()
    script.crossfade_ms = value
    with pytest.raises(ValueError, match="crossfade_ms must be between 0 and 500"):
        validate_voice_script(script, WarnSink())


def test_validate_accepts_boundary_values() -> None:
    script = valid_script()
    script.max_chunk_chars = 100
    script.crossfade_ms = 500
    validate_voice_script(script, WarnSink())


def test_validate_speaker_must_be_object() -> None:
    script = valid_script()
    script.speakers = {"a": None}
    with pytest.raises(ValueError, match='Speaker "a" definition must be an object'):
        validate_voice_script(script, WarnSink())


def test_validate_speaker_needs_profile_or_profile_id() -> None:
    script = valid_script()
    script.speakers = {"a": VoiceSpeaker(profile="")}
    with pytest.raises(ValueError, match='Speaker "a" must have a profile or profile_id'):
        validate_voice_script(script, WarnSink())


def test_validate_speaker_instruct_limit() -> None:
    script = valid_script()
    script.speakers = {"a": VoiceSpeaker(profile="p", instruct="x" * 501)}
    with pytest.raises(ValueError, match='Speaker "a" instruct exceeds 500 characters'):
        validate_voice_script(script, WarnSink())


def test_validate_segment_must_be_object() -> None:
    with pytest.raises(ValueError, match="Segment at index 0 must be an object"):
        validate_voice_script(VoiceScript(segments=[None]), WarnSink())


def test_validate_segment_text_not_empty() -> None:
    with pytest.raises(ValueError, match="Segment at index 0 text must not be empty"):
        validate_voice_script(VoiceScript(segments=[VoiceSegment(text="")]), WarnSink())


def test_validate_segment_text_cap() -> None:
    script = VoiceScript(segments=[VoiceSegment(text="x" * (VOICEBOX_TEXT_MAX + 1))])
    with pytest.raises(ValueError, match="50,000-character Voicebox /generate cap"):
        validate_voice_script(script, WarnSink())


def test_validate_segment_instruct_limit() -> None:
    script = VoiceScript(segments=[VoiceSegment(text="hi", instruct="x" * 501)])
    with pytest.raises(ValueError, match="Segment instruct exceeds 500 characters"):
        validate_voice_script(script, WarnSink())


def test_validate_unknown_speaker() -> None:
    script = VoiceScript(segments=[VoiceSegment(text="hi", speaker="missing")])
    with pytest.raises(ValueError, match='Unknown speaker: "missing"'):
        validate_voice_script(script, WarnSink())


def test_validate_known_speaker_passes() -> None:
    script = VoiceScript(
        speakers={"alice": VoiceSpeaker(profile="A")},
        segments=[VoiceSegment(text="hi", speaker="alice")],
    )
    validate_voice_script(script, WarnSink())


@pytest.mark.parametrize("field,value", [("max_chunk_chars", 50), ("crossfade_ms", 600)])
def test_validate_segment_chunk_and_crossfade(field: str, value: object) -> None:
    segment = VoiceSegment(text="hi", **{field: value})
    with pytest.raises(ValueError, match=f"{field} must be between"):
        validate_voice_script(VoiceScript(segments=[segment]), WarnSink())


@pytest.mark.parametrize("value", [-5, "10"])
def test_validate_segment_gap_non_negative(value: object) -> None:
    with pytest.raises(ValueError, match="gap_ms must be non-negative"):
        validate_voice_script(VoiceScript(segments=[VoiceSegment(text="hi", gap_ms=value)]), WarnSink())


def test_validate_segment_gap_zero_ok() -> None:
    validate_voice_script(VoiceScript(segments=[VoiceSegment(text="hi", gap_ms=0)]), WarnSink())


@pytest.mark.parametrize("value", [-1, 1.5, "3"])
def test_validate_segment_seed_integer(value: object) -> None:
    with pytest.raises(ValueError, match="seed must be a non-negative integer"):
        validate_voice_script(VoiceScript(segments=[VoiceSegment(text="hi", seed=value)]), WarnSink())


def test_validate_language_passes_through_unvalidated() -> None:
    script = valid_script()
    script.language = "xx"
    script.segments[0].language = "klingon"
    validate_voice_script(script, WarnSink())


# --- warn-ignore (D5) ---


def test_warn_ignore_collects_all_levels_once() -> None:
    script = VoiceScript(
        default_engine="qwen",
        default_effect_preset="radio",
        default_effects_chain=[{"type": "gain"}],
        speakers={"a": VoiceSpeaker(profile="p", personality=True, engine="tada")},
        segments=[
            VoiceSegment(text="one", engine="kokoro", effects_chain=[{"type": "delay"}]),
            VoiceSegment(text="two", effect_preset="robotic", personality=False),
        ],
    )
    sink = WarnSink()
    validate_voice_script(script, sink)  # passes — never fails on ignored fields
    warning = sink.emit_once()
    assert warning is not None
    for name in ("engine", "personality", "effects_chain", "effect_preset"):
        assert name in warning
    assert "segments[0]" in warning and "segments[1]" in warning
    assert "speakers.a" in warning
    assert sink.emit_once() == warning  # same single warning, stable


def test_warn_sink_empty_emits_none() -> None:
    assert WarnSink().emit_once() is None
    sink = WarnSink()
    validate_voice_script(valid_script(), sink)
    assert sink.emit_once() is None



