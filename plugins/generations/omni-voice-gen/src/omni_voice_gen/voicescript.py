"""VoiceScript parse/merge/validate — Python port of voice-gen/src/voicescript.ts.

Deltas from the TS source (task 0122 Q&A):
- The Voicebox engine allowlist and the 23-language allowlist are NOT ported. `engine`,
  `personality`, `effects_chain`, `effect_preset` are collected into a WarnSink (D5) and
  language strings pass through unvalidated (OmniVoice's _resolve_language owns that check).
- Parsing is yaml.safe_load only (JSON ⊂ YAML 1.2); branch order and error text keep voice-gen
  semantics.
- Warnings are never emitted here — pipeline.py (0125) prints `sink.emit_once()` to stderr so
  the warning appears exactly once per run.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import yaml

from .contract import Doc

VOICEBOX_TEXT_MAX = 50_000
VOICEBOX_INSTRUCT_MAX = 500
VOICEBOX_CHUNK_CHARS_MIN = 100
VOICEBOX_CHUNK_CHARS_MAX = 5_000
VOICEBOX_CHUNK_CHARS_DEFAULT = 800
VOICEBOX_CROSSFADE_MS_MIN = 0
VOICEBOX_CROSSFADE_MS_MAX = 500
VOICEBOX_CROSSFADE_MS_DEFAULT = 50

WARN_IGNORE_FIELDS = ("engine", "personality", "effects_chain", "effect_preset")

VOICESCRIPT_KEYS = frozenset(
    {
        "segments",
        "speakers",
        "default_profile",
        "default_profile_id",
        "default_engine",
        "default_emotion",
        "default_effects_chain",
        "default_effect_preset",
    }
)


@dataclass
class VoiceSpeaker:
    profile: Any = None
    profile_id: Any = None
    name: Any = None
    role: Any = None
    engine: Any = None
    language: Any = None
    emotion: Any = None
    instruct: Any = None
    effects_chain: Any = None
    effect_preset: Any = None
    personality: Any = None


@dataclass
class VoiceSegment:
    text: Any = ""
    speaker: Any = None
    profile: Any = None
    profile_id: Any = None
    emotion: Any = None
    instruct: Any = None
    engine: Any = None
    language: Any = None
    gap_ms: Any = None
    max_chunk_chars: Any = None
    crossfade_ms: Any = None
    personality: Any = None
    seed: Any = None
    effects_chain: Any = None
    effect_preset: Any = None


@dataclass
class VoiceScript:
    segments: list[Any] = field(default_factory=list)
    title: Any = None
    language: Any = None
    default_engine: Any = None
    default_profile: Any = None
    default_profile_id: Any = None
    default_emotion: Any = None
    default_effects_chain: Any = None
    default_effect_preset: Any = None
    max_chunk_chars: Any = None
    crossfade_ms: Any = None
    speakers: dict[str, Any] = field(default_factory=dict)


class WarnSink:
    """Collects D5 warn-ignore fields during validation; emit_once() renders the one warning."""

    def __init__(self) -> None:
        self._seen: dict[str, set[str]] = {}

    def add(self, field: str, where: str) -> None:
        self._seen.setdefault(field, set()).add(where)

    def emit_once(self) -> str | None:
        if not self._seen:
            return None
        parts = [f"{name} (at {', '.join(sorted(wheres))})" for name, wheres in self._seen.items()]
        return f"omni-voice-gen: ignoring VoiceScript fields OmniVoice cannot honor: {'; '.join(parts)}"


def _filter(cls: type, value: dict[str, Any]) -> Any:
    """Build a dataclass from a mapping, dropping unknown keys (unknown YAML never fails)."""
    return cls(**{k: v for k, v in value.items() if k in cls.__dataclass_fields__})


def _plain_text_script(text: str, doc: Doc, env_default_profile: str | None) -> VoiceScript:
    profile = env_default_profile
    if profile is None and doc.metadata and isinstance(doc.metadata.get("voiceProfile"), str):
        profile = doc.metadata["voiceProfile"]
    return VoiceScript(segments=[VoiceSegment(text=text)], default_profile=profile)


def parse_doc_to_voicescript(doc: Doc, env_default_profile: str | None = None) -> VoiceScript:
    """Parse a Doc body into a VoiceScript; plain text falls back to a single-segment script."""
    trimmed = (doc.body or "").strip()

    if trimmed.startswith("{"):
        try:
            parsed = yaml.safe_load(trimmed)
        except yaml.YAMLError as exc:
            raise ValueError("Invalid VoiceScript JSON structure: failed to parse JSON object") from exc
        if not isinstance(parsed, dict):
            raise ValueError("Invalid VoiceScript JSON structure: root must be a JSON object")
        return _script_from_mapping(parsed)

    if (
        trimmed.startswith("[")
        and not trimmed.startswith("[-")
        and "segments:" not in trimmed
        and "speakers:" not in trimmed
    ):
        # Plain text starting with a paralinguistic tag e.g. [laugh] or [sigh]
        return _plain_text_script(trimmed, doc, env_default_profile)

    try:
        parsed = yaml.safe_load(trimmed)
    except yaml.YAMLError:
        parsed = None
    if isinstance(parsed, dict) and any(key in parsed for key in VOICESCRIPT_KEYS):
        return _script_from_mapping(parsed)

    return _plain_text_script(trimmed, doc, env_default_profile)


def _script_from_mapping(parsed: dict[str, Any]) -> VoiceScript:
    script = _filter(VoiceScript, parsed)
    speakers = parsed.get("speakers")
    if isinstance(speakers, dict):
        script.speakers = {k: _filter(VoiceSpeaker, v) if isinstance(v, dict) else v for k, v in speakers.items()}
    segments = parsed.get("segments")
    if isinstance(segments, list):
        script.segments = [_filter(VoiceSegment, s) if isinstance(s, dict) else s for s in segments]
    return script


def merge_voice_scripts(
    scripts: list[VoiceScript], docs: list[Doc], env_default_profile: str | None = None
) -> VoiceScript:
    """Merge Doc-level VoiceScripts into one; first-wins for scalar defaults."""
    if not scripts:
        return VoiceScript(segments=[])
    if len(scripts) == 1:
        return scripts[0]

    combined_speakers: dict[str, Any] = {}
    combined_segments: list[Any] = []

    title = None
    default_profile = env_default_profile
    default_profile_id = None
    default_engine = None
    default_emotion = None
    default_effects_chain = None
    default_effect_preset = None
    language = None
    max_chunk_chars = None
    crossfade_ms = None

    for i, script in enumerate(scripts):
        if script is None:
            continue
        doc = docs[i] if i < len(docs) else None

        if not title:
            title = script.title or (doc.title if doc else None)
        if script.default_profile and default_profile == env_default_profile:
            default_profile = script.default_profile
        if script.default_profile_id and not default_profile_id:
            default_profile_id = script.default_profile_id
        if not default_profile and doc and doc.metadata and isinstance(doc.metadata.get("voiceProfile"), str):
            default_profile = doc.metadata["voiceProfile"]
        if not default_engine and script.default_engine:
            default_engine = script.default_engine
        if not default_emotion and script.default_emotion:
            default_emotion = script.default_emotion
        if not default_effects_chain and script.default_effects_chain:
            default_effects_chain = script.default_effects_chain
        if not default_effect_preset and script.default_effect_preset:
            default_effect_preset = script.default_effect_preset
        if not language and script.language:
            language = script.language
        if max_chunk_chars is None and script.max_chunk_chars is not None:
            max_chunk_chars = script.max_chunk_chars
        if crossfade_ms is None and script.crossfade_ms is not None:
            crossfade_ms = script.crossfade_ms

        for key, speaker in (script.speakers or {}).items():
            if key in combined_speakers:
                raise ValueError(f'Duplicate speaker key across documents: "{key}"')
            combined_speakers[key] = speaker

        if isinstance(script.segments, list):
            combined_segments.extend(script.segments)

    result = VoiceScript(
        title=title or (docs[0].title if docs else None) or "Generated voice",
        segments=combined_segments,
    )
    if combined_speakers:
        result.speakers = combined_speakers
    if default_profile:
        result.default_profile = default_profile
    if default_profile_id:
        result.default_profile_id = default_profile_id
    if default_engine:
        result.default_engine = default_engine
    if default_emotion:
        result.default_emotion = default_emotion
    if default_effects_chain:
        result.default_effects_chain = default_effects_chain
    if default_effect_preset:
        result.default_effect_preset = default_effect_preset
    if language:
        result.language = language
    if max_chunk_chars is not None:
        result.max_chunk_chars = max_chunk_chars
    if crossfade_ms is not None:
        result.crossfade_ms = crossfade_ms
    return result


def _is_int(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and float(value).is_integer()


def _collect_ignored(obj: Any, where: str, sink: WarnSink) -> None:
    for name in WARN_IGNORE_FIELDS:
        if getattr(obj, name, None) is not None:
            sink.add(name, where)


def validate_voice_script(script: VoiceScript, sink: WarnSink) -> None:
    """Raise ValueError with voice-gen message text on any violation; collect D5 fields into sink."""
    if not isinstance(script, VoiceScript):
        # ValueError, not TypeError: every validation failure must carry voice-gen's error
        # semantics (TS throws Error; __main__ maps ValueError onto the single fail-loud exit).
        raise ValueError("VoiceScript must be an object")  # noqa: TRY004

    if not isinstance(script.segments, list) or len(script.segments) == 0:
        raise ValueError("VoiceScript must have a non-empty segments array")

    if script.max_chunk_chars is not None and (
        not _is_int(script.max_chunk_chars)
        or not VOICEBOX_CHUNK_CHARS_MIN <= script.max_chunk_chars <= VOICEBOX_CHUNK_CHARS_MAX
    ):
        raise ValueError(f"max_chunk_chars must be between {VOICEBOX_CHUNK_CHARS_MIN} and {VOICEBOX_CHUNK_CHARS_MAX}")

    if script.crossfade_ms is not None and (
        not _is_int(script.crossfade_ms)
        or not VOICEBOX_CROSSFADE_MS_MIN <= script.crossfade_ms <= VOICEBOX_CROSSFADE_MS_MAX
    ):
        raise ValueError(f"crossfade_ms must be between {VOICEBOX_CROSSFADE_MS_MIN} and {VOICEBOX_CROSSFADE_MS_MAX}")

    _collect_ignored(script, "script", sink)

    for name, speaker in (script.speakers or {}).items():
        where = f'speakers.{name}'
        if not isinstance(speaker, VoiceSpeaker):
            raise ValueError(f'Speaker "{name}" definition must be an object')  # noqa: TRY004
        if not speaker.profile and not speaker.profile_id:
            raise ValueError(f'Speaker "{name}" must have a profile or profile_id specified')
        if isinstance(speaker.instruct, str) and len(speaker.instruct) > VOICEBOX_INSTRUCT_MAX:
            raise ValueError(f'Speaker "{name}" instruct exceeds 500 characters ({len(speaker.instruct)} chars)')
        _collect_ignored(speaker, where, sink)

    for idx, segment in enumerate(script.segments):
        if not isinstance(segment, VoiceSegment):
            raise ValueError(f"Segment at index {idx} must be an object")  # noqa: TRY004

        if not isinstance(segment.text, str) or len(segment.text) == 0:
            raise ValueError(f"Segment at index {idx} text must not be empty")

        if len(segment.text) > VOICEBOX_TEXT_MAX:
            raise ValueError(
                f"Segment text exceeds the 50,000-character Voicebox /generate cap ({len(segment.text)} chars)"
            )

        if isinstance(segment.instruct, str) and len(segment.instruct) > VOICEBOX_INSTRUCT_MAX:
            raise ValueError(f"Segment instruct exceeds 500 characters ({len(segment.instruct)} chars)")

        if segment.speaker and segment.speaker not in (script.speakers or {}):
            raise ValueError(f'Unknown speaker: "{segment.speaker}"')

        if segment.max_chunk_chars is not None and (
            not _is_int(segment.max_chunk_chars)
            or not VOICEBOX_CHUNK_CHARS_MIN <= segment.max_chunk_chars <= VOICEBOX_CHUNK_CHARS_MAX
        ):
            raise ValueError(
                f"max_chunk_chars must be between {VOICEBOX_CHUNK_CHARS_MIN} and {VOICEBOX_CHUNK_CHARS_MAX}"
            )

        if segment.crossfade_ms is not None and (
            not _is_int(segment.crossfade_ms)
            or not VOICEBOX_CROSSFADE_MS_MIN <= segment.crossfade_ms <= VOICEBOX_CROSSFADE_MS_MAX
        ):
            raise ValueError(
                f"crossfade_ms must be between {VOICEBOX_CROSSFADE_MS_MIN} and {VOICEBOX_CROSSFADE_MS_MAX}"
            )

        if segment.gap_ms is not None and (
            isinstance(segment.gap_ms, bool) or not isinstance(segment.gap_ms, (int, float)) or segment.gap_ms < 0
        ):
            raise ValueError("gap_ms must be non-negative")

        if segment.seed is not None and (not _is_int(segment.seed) or segment.seed < 0):
            raise ValueError("seed must be a non-negative integer")

        _collect_ignored(segment, f"segments[{idx}]", sink)
