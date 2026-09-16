"""processGeneratorIO port (voice-gen index.ts): Doc[] -> rendered WAV (+MP3) -> audio Content.

Deltas from voice-gen (task 0125 design):
- One in-process Backend (D6) replaces HTTP generate/poll, so voice-gen's nested network + verify
  loops collapse to one verify loop with a single inline retry on backend exceptions.
- Retries resample (seed=None) instead of a random seed + halved max_chunk_chars: an explicit seed
  pins attempt 0 only, and OmniVoice chunks by duration, not characters.
- generationId is uuid4 hex[:16] per accepted render (there is no server history id).
- metadata.duration and qc.totalDuration share one basis: segment durations plus the gaps
  concat_wavs actually inserts (D8.2).
"""

from __future__ import annotations

import os
import sys
import uuid
from collections.abc import Callable
from dataclasses import fields, is_dataclass
from pathlib import Path
from time import monotonic
from typing import Any

import yaml

from .audio import concat_wavs, detect_loudness_dip
from .backend import Backend, OmnivoiceBackend, SegmentSpec
from .contract import NOTICE_CONTENT, Content, Doc, content_to_json, parse_doc_list
from .mp3 import is_mp3_requested, transcode_wav_to_mp3
from .profiles import load_registry, resolve_profile
from .qc import (
    TRANSCRIPTION_FIDELITY_FLOOR,
    audit_voice_segments,
    transcription_fidelity,
)
from .voicescript import (
    VoiceScript,
    VoiceSegment,
    WarnSink,
    merge_voice_scripts,
    parse_doc_to_voicescript,
    validate_voice_script,
)

GENERATOR = "kk:omni-voice-gen"
MAX_VERIFY_RETRIES = 2  # verify attempts 0..2 (voice-gen parity)


def _log(msg: str) -> None:
    print(f"omni-voice-gen: {msg}", file=sys.stderr)


# Emotions already warned about this run (one line per distinct value, not per segment).
_ignored_emotions: set[str] = set()


def _delete(*paths: str) -> None:
    for path in paths:
        Path(path).unlink(missing_ok=True)


def _first(*values: Any) -> Any:
    """JS `??` chain: the first value that is not None."""
    return next((value for value in values if value is not None), None)


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


def _plain(value: Any, camel: bool = False) -> Any:
    """Dataclass tree -> YAML/JSON-safe tree with None dropped (JS undefined parity).

    `camel` renames dataclass field names only (QC report keys), never user dict keys.
    """
    if is_dataclass(value):
        return {
            (_camel(f.name) if camel else f.name): _plain(v, camel)
            for f in fields(value)
            if (v := getattr(value, f.name)) is not None
        }
    if isinstance(value, dict):
        return {key: _plain(v, camel) for key, v in value.items() if v is not None}
    if isinstance(value, (list, tuple)):
        return [_plain(v, camel) for v in value]
    return value


def resolve_profile_target(
    segment: VoiceSegment, speaker: Any, script: VoiceScript, env_default: str | None, docs: list[Doc]
) -> str:
    """D4 resolution order (frozen); none set -> error listing every knob."""
    doc_profile = (docs[0].metadata or {}).get("voiceProfile")
    target = _first(
        segment.profile_id,
        segment.profile,
        getattr(speaker, "profile_id", None),
        getattr(speaker, "profile", None),
        script.default_profile_id,
        script.default_profile,
        env_default,
        doc_profile if isinstance(doc_profile, str) else None,
    )
    if not target:
        raise ValueError(
            "No voice profile specified for segment (set profile, profile_id, speaker profile, default_profile, "
            "default_profile_id, VOICEBOX_DEFAULT_PROFILE, or doc metadata.voiceProfile)"
        )
    return str(target)


def _max_run_ms() -> int:
    raw = os.environ.get("VOICE_GEN_MAX_RUN_MS")
    try:
        return int(raw) if raw else 0
    except ValueError as exc:
        raise ValueError(f"VOICE_GEN_MAX_RUN_MS must be an integer millisecond budget, got {raw!r}") from exc


def _generate(backend: Backend, spec: SegmentSpec) -> tuple[bytes, float]:
    try:
        return backend.generate(spec)
    except Exception as exc:  # noqa: BLE001 — one inline retry for transient failures (voice-gen network-attempt parity); a second failure propagates
        _log(f"segment render failed ({exc}); retrying once")
        return backend.generate(spec)


def _transcribe(backend: Backend, wav: bytes, language: str) -> str | None:
    try:
        return backend.transcribe(wav, language)
    except Exception:  # noqa: BLE001 — ASR unavailable: keep audio, the QC audit is the backstop (voice-gen parity)
        return None


def _render_verified(backend: Backend, spec: SegmentSpec) -> tuple[bytes, float, int, str | None, bool]:
    """Spec §5 verify-retry -> (wav, duration, verify_retries, transcription, loudness_dip)."""
    for attempt in range(MAX_VERIFY_RETRIES + 1):
        final = attempt == MAX_VERIFY_RETRIES  # the final attempt is always accepted
        if attempt:
            _log(f"regenerating segment (verify retry {attempt}/{MAX_VERIFY_RETRIES}, resampled)")
        # Explicit seed pins attempt 0 only; retries resample (diffusion decoding is stochastic).
        wav, duration = _generate(backend, spec if attempt == 0 else {**spec, "seed": None})
        transcription = _transcribe(backend, wav, spec["language"])
        if transcription is not None and not final:
            fidelity = transcription_fidelity(spec["text"], transcription)
            if fidelity < TRANSCRIPTION_FIDELITY_FLOOR:
                _log(
                    f"transcription fidelity {fidelity:.2f} below {TRANSCRIPTION_FIDELITY_FLOOR} "
                    f'(looped/garbage audio): "{transcription[:80]}..."'
                )
                continue
        dip, dip_at = detect_loudness_dip(wav)
        if dip and not final:
            _log(f"loudness dip detected at {dip_at}s — regenerating segment")
            continue
        return wav, duration, attempt, transcription, dip
    raise AssertionError("unreachable: the final verify attempt always returns")  # pragma: no cover


def _render(
    docs: list[Doc], audio_path: str, mp3_path: str, backend: Backend, transcoder: Callable[[str, str], None]
) -> Content:
    env_default = os.environ.get("VOICEBOX_DEFAULT_PROFILE")
    script = merge_voice_scripts([parse_doc_to_voicescript(doc, env_default) for doc in docs], docs, env_default)
    sink = WarnSink()
    validate_voice_script(script, sink)
    if warning := sink.emit_once():
        print(warning, file=sys.stderr)
    # Env + registry failures surface before the (slow) model load.
    max_run_ms = _max_run_ms()
    registry = load_registry()

    backend.load()
    started = monotonic()
    total = len(script.segments)
    _log(f"{total} segments queued for render")

    wavs: list[bytes] = []
    gaps: list[int] = []
    segments_meta: list[dict[str, Any]] = []
    audit_meta: list[dict[str, Any]] = []
    total_duration = 0.0
    for index, segment in enumerate(script.segments):
        if max_run_ms > 0 and (monotonic() - started) * 1000 > max_run_ms:
            raise RuntimeError(
                f"render budget {max_run_ms}ms exceeded after {index}/{total} segments — "
                "raise VOICE_GEN_MAX_RUN_MS if the render is legitimately long"
            )
        segment_started = monotonic()
        speaker = (script.speakers or {}).get(segment.speaker) if segment.speaker else None
        profile = resolve_profile_target(segment, speaker, script, env_default, docs)
        emotion = _first(segment.emotion, getattr(speaker, "emotion", None), script.default_emotion)
        # OmniVoice instruct accepts a fixed vocabulary (accent/age/pitch) with no emotion items,
        # so voicegen-era free-text emotion is unrepresentable: drop it loudly and let the
        # resolved profile's instruct carry the voice. An explicit segment/speaker instruct is
        # operator-authored whitelist text and passes through untouched.
        segment_instruct = _first(segment.instruct, getattr(speaker, "instruct", None))
        if segment_instruct is None and emotion is not None:
            key = emotion.strip().lower()
            if key not in _ignored_emotions:
                _ignored_emotions.add(key)
                _log(
                    f"ignoring emotion {emotion!r}: OmniVoice instruct vocabulary has no emotion items — "
                    "voice comes from the resolved profile"
                )
        spec: SegmentSpec = {
            "text": segment.text,
            "language": _first(segment.language, getattr(speaker, "language", None), script.language, "en"),
            "profile": resolve_profile(profile, registry),
            "instruct": segment_instruct,
            "seed": None if segment.seed is None else int(segment.seed),
            "speed": None,
        }
        wav, duration, retries, transcription, dip = _render_verified(backend, spec)

        gap_ms = segment.gap_ms or 0
        wavs.append(wav)
        gaps.append(gap_ms)
        # D8.2: concat_wavs inserts gaps_ms[i] before segment i only for i > 0 — count exactly that silence.
        total_duration += duration + (gap_ms / 1000 if index else 0)
        segments_meta.append(
            _plain(
                {
                    "generationId": uuid.uuid4().hex[:16],
                    "profile": profile,
                    "speaker": segment.speaker,
                    "emotion": emotion,
                    "duration": duration,
                    "verifyRetries": retries,
                    "transcription": transcription,
                    "loudnessDip": dip,
                }
            )
        )
        audit_meta.append({"duration": duration, "transcription": transcription, "loudness_dip": dip})
        retry_note = f" ({retries} verify {'retry' if retries == 1 else 'retries'})" if retries else ""
        _log(f"segment {index + 1}/{total} done in {monotonic() - segment_started:.1f}s{retry_note}")

    Path(audio_path).write_bytes(concat_wavs(wavs, gaps))
    report = audit_voice_segments(script, wavs, audit_meta, backend)
    report.total_duration = round(total_duration, 2)  # D8.2: same basis as metadata.duration
    metadata: dict[str, Any] = {
        "generator": GENERATOR,
        "audioPath": audio_path,
        "duration": total_duration,
        "segments": segments_meta,
        "qc": _plain(report, camel=True),
    }
    if os.environ.get("VOICE_GEN_FAIL_ON_QC") == "true" and not report.passed:
        raise RuntimeError(
            f"Voice Quality Control failed ({report.overall_score}/100):\n" + "\n".join(report.critical_issues)
        )
    if is_mp3_requested():
        transcoder(audio_path, mp3_path)
        metadata["mp3Path"] = mp3_path

    return Content(
        title=script.title or docs[0].title or "Generated voice",
        body=yaml.safe_dump(_plain(script), sort_keys=False, allow_unicode=True),
        format="audio",
        references=[],
        metadata=metadata,
    )


def run(
    in_path: str,
    out_path: str,
    backend: Backend | None = None,
    transcoder: Callable[[str, str], None] | None = None,
) -> None:
    """Doc[] JSON at in_path -> Content JSON at out_path + sibling <stem>.wav (and .mp3).

    Delete-then-render: stale --out/WAV/MP3 are removed at start AND on any failure, and --out is
    written once, after Content validation (voice-gen processGeneratorIO parity).
    """
    out_dir = os.path.dirname(os.path.abspath(out_path))
    stem = Path(out_path).stem
    audio_path = os.path.join(out_dir, f"{stem}.wav")
    mp3_path = os.path.join(out_dir, f"{stem}.mp3")
    _delete(out_path, audio_path, mp3_path)

    try:
        raw = Path(in_path).read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"cannot read input {in_path}: {exc.strerror or exc}") from exc
    try:
        docs = parse_doc_list(raw)
    except ValueError as exc:
        raise ValueError(f"Invalid DocList input: {exc}") from exc

    os.makedirs(out_dir, exist_ok=True)
    if not docs:
        Path(out_path).write_text(content_to_json(NOTICE_CONTENT), encoding="utf-8")
        return

    try:
        content = _render(
            docs, audio_path, mp3_path, backend or OmnivoiceBackend(), transcoder or transcode_wav_to_mp3
        )
        Path(out_path).write_text(content_to_json(content), encoding="utf-8")
    except BaseException:
        _delete(out_path, audio_path, mp3_path)
        raise

    # R5a (task 0139): repetition is the one QC issue the verify loop cannot fix and the one that
    # damages credibility on air, so it fails the run — but only AFTER content.json is on disk, and
    # outside the delete-on-failure try above, so the operator can inspect the audit that condemned
    # it. The audio and MP3 stay too: this is a review stop, not a corrupt-artifact cleanup. Recovery
    # is HITL YAML inspection plus a re-run; Q&A item 3 ships this with no override knob.
    repeated = [
        audit.get("segmentIndex")
        for audit in content.metadata.get("qc", {}).get("segmentAudits", [])
        if "repetition_detected" in audit.get("issues", [])
    ]
    if repeated:
        indexes = ", ".join(str(index) for index in repeated)
        raise RuntimeError(
            f"segment(s) {indexes} carry repetition_detected — content.json written for inspection"
        )
