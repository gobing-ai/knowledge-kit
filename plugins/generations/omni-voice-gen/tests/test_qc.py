"""qc.py: repetition / fidelity / duration-range / aggregate audit (D7 thresholds)."""

import struct

import pytest

from omni_voice_gen.qc import (
    TRANSCRIPTION_FIDELITY_FLOOR,
    Transcriber,
    audit_voice_segments,
    compute_expected_duration_range,
    detect_repetitions,
    transcription_fidelity,
)
from omni_voice_gen.voicescript import VoiceScript, VoiceSegment


def test_transcriber_protocol_body_raises() -> None:
    # Executes the protocol's concrete body so the D2 function gate counts it (backend.py pattern).
    with pytest.raises(NotImplementedError):
        Transcriber.transcribe(object(), b"wav", "en")


def wav_bytes(data: bytes, sample_rate: int = 1000) -> bytes:
    block_align = 2
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sample_rate,
        sample_rate * block_align,
        block_align,
        16,
        b"data",
        len(data),
    ) + data


def pcm(*values: int) -> bytes:
    return struct.pack(f"<{len(values)}h", *values)


def dip_wav() -> bytes:
    frames = b""
    for i in range(7):
        value = 1000 if i == 2 else 10000
        frames += pcm(*([value] * 1000))
    return wav_bytes(frames)


CLEAN_WAV = wav_bytes(pcm(*([10000] * 7000)))


class StubBackend:
    def __init__(self, result: str = "", error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[tuple[bytes, str]] = []

    def transcribe(self, wav: bytes, language: str) -> str:
        self.calls.append((wav, language))
        if self.error is not None:
            raise self.error
        return self.result


def script_with(*segments: VoiceSegment, language: str | None = None) -> VoiceScript:
    return VoiceScript(segments=list(segments), language=language)


# --- detect_repetitions ---


def test_repetition_char_run() -> None:
    assert detect_repetitions("aaa") is True


def test_repetition_word_run() -> None:
    assert detect_repetitions("ababab") is True


def test_repetition_phrase_run() -> None:
    # lazy (.{4,30}?)\1{1,} needs an ADJACENT repeat (same as the JS regex)
    assert detect_repetitions("hello worldhello world") is True


def test_repetition_clean_text() -> None:
    assert detect_repetitions("你好世界，这是一段正常的文本。") is False


# --- transcription_fidelity ---


def test_fidelity_empty_inputs() -> None:
    assert transcription_fidelity("", "x") == 0.0
    assert transcription_fidelity("x", "") == 0.0


def test_fidelity_identical() -> None:
    assert transcription_fidelity("你好世界", "你好世界") == 1.0


def test_fidelity_partial_overlap() -> None:
    score = transcription_fidelity("你好世界今天天气不错", "你好世界明天天气很好")
    assert 0.0 < score < 1.0


def test_fidelity_long_text_uses_4grams() -> None:
    source = "a" * 30
    assert transcription_fidelity(source, "b" * 30) == 0.0


# --- compute_expected_duration_range ---


def test_duration_range_empty() -> None:
    assert compute_expected_duration_range("") == (0.0, 0.0)
    assert compute_expected_duration_range("   ") == (0.0, 0.0)


def test_duration_range_zh() -> None:
    min_sec, max_sec = compute_expected_duration_range("你好世界", "zh")
    # 4 cjk + 1 word -> 5 * 0.15 = 0.75 ; max = 3x
    assert min_sec == 0.75
    assert max_sec == 2.25


def test_duration_range_en() -> None:
    min_sec, max_sec = compute_expected_duration_range("hello world", "en")
    # 2 words * 4 + floor(11/4)=2 -> 10 * 0.06 = 0.6 ; max = 3x
    assert min_sec == 0.6
    assert max_sec == 1.8


def test_duration_range_other_language() -> None:
    min_sec, max_sec = compute_expected_duration_range("bonjour", "fr")
    # char_count 7, word_count 1 -> max(7, 2) = 7 * 0.08 = 0.56 ; max = 3x
    assert min_sec == 0.56
    assert max_sec == 1.68


# --- audit_voice_segments ---


def test_audit_clean_single_segment_passes() -> None:
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 1.0}])
    assert report.passed is True
    assert report.total_duration == 1.0
    assert report.overall_score == 100
    assert report.critical_issues == []
    audit = report.segment_audits[0]
    assert audit.segment_index == 0
    assert audit.expected_duration_range == (0.75, 2.25)
    assert audit.speech_rate_chars_per_sec == 4.0
    assert audit.repetition_detected is False
    assert audit.duration_anomaly is False


def test_audit_empty_script_passes_with_score_100() -> None:
    report = audit_voice_segments(script_with(), [], [])
    assert report.passed is True
    assert report.overall_score == 100
    assert report.segment_audits == []


# Dogfood 2026-09-18: a version string in the source text tripped the word-run regex and
# condemned a 70-minute render. The battery is transcription-only (voice-gen qc.ts parity)
# and an issue only when duration anomaly corroborates.
def test_audit_source_text_version_string_does_not_flag_repetition() -> None:
    script = script_with(VoiceSegment(text="版本1.1.1.发布", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 1.0}])
    audit = report.segment_audits[0]
    assert audit.repetition_detected is False
    assert all("repetition_detected" not in issue for issue in audit.issues)


def test_audit_transcription_repetition_without_duration_anomaly_is_recorded_not_failed() -> None:
    # Whisper phantom loop over trailing silence: repetition recorded, no issue, audit passes.
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    meta = {"duration": 1.0, "transcription": "你好世界ababab"}
    report = audit_voice_segments(script, [CLEAN_WAV], [meta])
    audit = report.segment_audits[0]
    assert audit.repetition_detected is True
    assert all("repetition_detected" not in issue for issue in audit.issues)
    assert report.passed is True


def test_audit_transcription_repetition_with_duration_anomaly_fails() -> None:
    # Real TTS loop: repetition + inflated duration -> corroborated issue (R5a keys on this).
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    meta = {"duration": 30.0, "transcription": "你好世界ababab"}
    report = audit_voice_segments(script, [CLEAN_WAV], [meta])
    audit = report.segment_audits[0]
    assert any("repetition_detected" in issue for issue in audit.issues)
    assert report.passed is False


def test_audit_backend_transcription_success_and_low_fidelity() -> None:
    backend = StubBackend(result="completely unrelated transcription")
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 1.0}], backend)
    audit = report.segment_audits[0]
    assert backend.calls == [(CLEAN_WAV, "zh")]
    assert audit.transcription == "completely unrelated transcription"
    assert audit.fidelity_score is not None and audit.fidelity_score < TRANSCRIPTION_FIDELITY_FLOOR
    assert any(issue.startswith("transcription_fidelity_low:") for issue in audit.issues)
    assert report.passed is False


def test_audit_backend_transcription_failure_is_soft() -> None:
    backend = StubBackend(error=RuntimeError("asr unavailable"))
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 1.0}], backend)
    audit = report.segment_audits[0]
    assert audit.transcription is None
    assert audit.fidelity_score is None
    assert audit.issues == ["transcription_failed: asr unavailable"]


def test_audit_meta_transcription_skips_backend() -> None:
    backend = StubBackend(result="unused")
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 1.0, "transcription": "你好世界"}], backend)
    assert backend.calls == []
    audit = report.segment_audits[0]
    assert audit.fidelity_score == 1.0
    assert audit.issues == []


def test_audit_empty_transcription_skips_fidelity() -> None:
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 1.0, "transcription": ""}])
    assert report.segment_audits[0].fidelity_score is None


def test_audit_source_repetition_without_transcription_not_flagged() -> None:
    # Transcription-only battery: no transcription -> nothing to flag, whatever the source says.
    script = script_with(VoiceSegment(text="aaaa", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 1.0}])
    audit = report.segment_audits[0]
    assert audit.repetition_detected is False
    assert audit.issues == []


def test_audit_duration_anomaly_flagged() -> None:
    script = script_with(VoiceSegment(text="你好", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 100.0}])
    audit = report.segment_audits[0]
    assert audit.duration_anomaly is True
    assert any(issue.startswith("duration_anomaly: expected") for issue in audit.issues)


def test_audit_duration_in_range_not_flagged() -> None:
    # Regression: an in-range duration must not flag even when it exceeds the old
    # fastest-speech floor (len(text)/15 + 15s) that the removed ceiling term used.
    text = "这段文字长度超过三十九个字符的阈值，用来验证正常语速不会被误报为时长异常。" * 3
    duration = len(text) * 0.25  # comfortably inside [0.15L, 0.45L], above the old floor
    script = script_with(VoiceSegment(text=text, language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": duration}])
    audit = report.segment_audits[0]
    assert audit.duration_anomaly is False
    assert not any(issue.startswith("duration_anomaly:") for issue in audit.issues)


def test_audit_loudness_dip_from_meta_verify_phase() -> None:
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 1.0, "loudness_dip": True}])
    assert "loudness_dip:unknown" in report.segment_audits[0].issues


def test_audit_loudness_dip_from_windowed_scan() -> None:
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    report = audit_voice_segments(script, [dip_wav()], [{"duration": 1.0}])
    assert "loudness_dip:2.5s" in report.segment_audits[0].issues


def test_audit_language_falls_back_to_script_default() -> None:
    backend = StubBackend(result="hello world, this is a test")
    script = script_with(VoiceSegment(text="hello world, this is a test"), language="en")
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 2.0}], backend)
    assert backend.calls[0][1] == "en"
    assert report.segment_audits[0].issues == []


def test_audit_non_string_segment_text_coerced() -> None:
    script = script_with(VoiceSegment(text=123, language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{"duration": 1.0}])
    assert report.segment_audits[0].text == "123"


def test_audit_zero_duration_zero_speech_rate() -> None:
    script = script_with(VoiceSegment(text="你好世界", language="zh"))
    report = audit_voice_segments(script, [CLEAN_WAV], [{}])
    audit = report.segment_audits[0]
    assert audit.duration == 0.0
    assert audit.speech_rate_chars_per_sec == 0.0


def test_audit_overall_score_rounds_partial_pass() -> None:
    script = script_with(
        VoiceSegment(text="你好世界", language="zh"),
        VoiceSegment(text="aaaa", language="zh"),
        VoiceSegment(text="天气不错", language="zh"),
    )
    metas = [{"duration": 1.0}, {"duration": 10.0}, {"duration": 1.0}]
    report = audit_voice_segments(script, [CLEAN_WAV, CLEAN_WAV, CLEAN_WAV], metas)
    assert report.overall_score == 67  # 2/3 pass, JS Math.round parity
    assert report.passed is False
