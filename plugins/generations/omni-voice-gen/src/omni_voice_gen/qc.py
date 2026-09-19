"""QC audit — Python port of voice-gen qc.ts (repetition / fidelity / duration-range /
aggregate). Loudness-dip detection lives in audio.py (spec §2 layout); thresholds identical (D7).

Delta from the TS source: transcription is supplied by a Backend (sync
`transcribe(wav, language) -> str`, may raise) instead of the async VoiceboxClient.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from .audio import detect_loudness_dip
from .voicescript import VoiceScript

# Thresholds — identical to voice-gen qc.ts (D7).
TRANSCRIPTION_FIDELITY_FLOOR = 0.15

MAX_DURATION_RATIO = 3.0
MAX_ABS_DIFF_SEC = 15.0
MAX_RATE_ZH = 15.0
MAX_RATE_EN = 30.0
MAX_RATE_OTHER = 25.0


RE_CHAR_RUN = re.compile(r"(.)\1{2,}", re.DOTALL)
RE_WORD_RUN = re.compile(r"(.{2,3}?)\1{2,}", re.DOTALL)
RE_PHRASE_RUN = re.compile(r"(.{4,30}?)\1{1,}", re.DOTALL)


class Transcriber(Protocol):
    # Concrete `raise` body, not `...`: coverage.py excludes it from measurement, keeping
    # the protocol out of the D2 per-file function gate (same pattern as backend.py).
    def transcribe(self, wav: bytes, language: str) -> str:
        raise NotImplementedError


@dataclass
class SegmentQualityAudit:
    segment_index: int
    text: str
    duration: float
    expected_duration_range: tuple[float, float]
    speech_rate_chars_per_sec: float
    transcription: str | None
    repetition_detected: bool
    duration_anomaly: bool
    fidelity_score: float | None
    issues: list[str] = field(default_factory=list)


@dataclass
class VoiceQualityReport:
    passed: bool
    total_duration: float
    overall_score: int
    segment_audits: list[SegmentQualityAudit]
    critical_issues: list[str]


def detect_repetitions(text: str) -> bool:
    """Repeated chars/short words/long phrases — port of voice-gen qc.ts regex battery."""
    return bool(RE_CHAR_RUN.search(text) or RE_WORD_RUN.search(text) or RE_PHRASE_RUN.search(text))


def _ngrams(text: str, n: int) -> set[str]:
    grams: set[str] = set()
    for i in range(len(text) - n + 1):
        grams.add(text[i : i + n])
    return grams


def transcription_fidelity(source: str, transcription: str) -> float:
    """Character 4-gram Jaccard (short texts fall back to 2-grams)."""
    if not source or not transcription:
        return 0.0
    if source == transcription:
        return 1.0
    n = 4 if len(source) >= 20 else 2
    source_grams = _ngrams(source, n)
    trans_grams = _ngrams(transcription, n)
    intersection = 0
    for gram in source_grams:
        if gram in trans_grams:
            intersection += 1
    union = len(source_grams) + len(trans_grams) - intersection
    return intersection / union if union else 0.0


def _split_words(clean: str) -> list[str]:
    return [w for w in re.split(r"[\s\[\],.!?;:，。！？；：]+", clean) if len(w) > 0]


def compute_expected_duration_range(text: str, language: str = "zh") -> tuple[float, float]:
    """Heuristic duration window (s) for a segment — port of voice-gen qc.ts."""
    clean = text.strip()
    if not clean:
        return 0.0, 0.0
    is_zh = language.startswith("zh")
    is_en = language.startswith("en")
    if is_zh:
        cjk_count = sum(1 for ch in clean if ord(ch) > 255)
        word_count = len(_split_words(clean))
        effective_chars = cjk_count + word_count
        min_sec = effective_chars * 0.15
        max_sec = min_sec * 3
    else:
        word_count = len(_split_words(clean))
        char_count = len(re.sub(r"\s+", "", clean))
        if is_en:
            effective_chars = word_count * 4 + math.floor(char_count / 4)
            min_sec = effective_chars * 0.06
            max_sec = min_sec * 3
        else:
            effective_chars = max(char_count, word_count * 2)
            min_sec = effective_chars * 0.08
            max_sec = min_sec * 3
    return round(min_sec, 2), round(max_sec, 2)


def audit_voice_segments(
    script: VoiceScript,
    segment_wavs: list[bytes],
    segment_metadata: list[dict[str, Any]],
    backend: Transcriber | None = None,
) -> VoiceQualityReport:
    """Aggregate QC over rendered segments. `backend.transcribe` may raise; failures only
    add an issue entry, never crash the audit (voice-gen parity)."""
    audits: list[SegmentQualityAudit] = []
    total_duration = 0.0
    critical_issues: list[str] = []

    for index, segment in enumerate(script.segments):
        wav = segment_wavs[index]
        meta = segment_metadata[index]
        text = segment.text if isinstance(segment.text, str) else str(segment.text or "")
        language = segment.language or script.language or "zh"
        duration = float(meta.get("duration") or 0.0)
        total_duration += duration

        min_sec, max_sec = compute_expected_duration_range(text, language)
        speech_rate = round((len(text) / duration) if duration > 0 else 0.0, 2)

        issues: list[str] = []

        # Transcription + fidelity (best-effort)
        transcription = meta.get("transcription")
        fidelity: float | None = None
        if transcription is None and backend is not None and language and wav and len(wav) > 0:
            try:
                transcription = backend.transcribe(wav, language)
            except Exception as err:  # noqa: BLE001 — transcription is best-effort; any backend failure only adds an issue (voice-gen parity)
                issues.append(f"transcription_failed: {err}")
        if transcription is not None and transcription != "":
            fidelity = transcription_fidelity(text, transcription)
            if fidelity < TRANSCRIPTION_FIDELITY_FLOOR:
                issues.append(f"transcription_fidelity_low:{fidelity:.2f}")

        # Duration anomaly
        ratio_anomaly = duration > MAX_DURATION_RATIO * max_sec if max_sec > 0 else False
        abs_anomaly = duration > max_sec + MAX_ABS_DIFF_SEC if max_sec > 0 else False
        max_rate = MAX_RATE_ZH if language.startswith("zh") else MAX_RATE_EN if language.startswith("en") else MAX_RATE_OTHER
        rate_anomaly = duration > 0 and (len(text) / duration) > max_rate
        # The former abs-ceiling term (duration > MAX_DURATION_<lang> + len(text)/<divisor>)
        # compared against a fastest-speech floor, so any segment over ~39 chars flagged even
        # when inside its expected range; genuinely overlong audio stays covered by ratio/abs/rate.
        duration_anomaly = ratio_anomaly or abs_anomaly or rate_anomaly
        if duration_anomaly:
            issues.append(
                f"duration_anomaly: expected {min_sec:.2f}s-{max_sec:.2f}s, got {duration:.2f}s"
            )

        # Repetition — transcription channel only, corroborated by duration anomaly (voice-gen
        # qc.ts parity): the battery is an ASR/TTS-artifact detector, not a source-text lint.
        # Source strings like version numbers ("1.1.1.") are legitimate copy and speak fine
        # (dogfood 2026-09-18: a version string in the source tripped the word-run regex and
        # condemned a 70-minute render that no regeneration could fix). A real TTS loop always
        # inflates duration; a Whisper phantom loop over trailing silence does not.
        repetition = detect_repetitions(transcription) if transcription is not None else False
        if repetition and duration_anomaly:
            # Bare token: pipeline.py's R5a gate matches issues by exact membership.
            issues.append("repetition_detected")

        # Loudness dip: reuse the verify-phase result when present; only run the windowed
        # scan when the verify phase did not (meta.loudness_dip absent).
        dip, dip_at = (
            (bool(meta["loudness_dip"]), None) if "loudness_dip" in meta else detect_loudness_dip(wav)
        )
        if dip:
            issues.append(f"loudness_dip:{f'{dip_at}s' if dip_at is not None else 'unknown'}")

        audits.append(
            SegmentQualityAudit(
                segment_index=index,
                text=text,
                duration=duration,
                expected_duration_range=(min_sec, max_sec),
                speech_rate_chars_per_sec=speech_rate,
                transcription=transcription,
                repetition_detected=repetition,
                duration_anomaly=duration_anomaly,
                fidelity_score=fidelity,
                issues=issues,
            )
        )
        critical_issues.extend(issues)

    passed_count = sum(1 for audit in audits if not audit.issues)
    overall_score = int((passed_count / len(audits)) * 100 + 0.5) if audits else 100
    all_passed = len(critical_issues) == 0

    return VoiceQualityReport(
        passed=all_passed,
        total_duration=round(total_duration, 2),
        overall_score=overall_score,
        segment_audits=audits,
        critical_issues=critical_issues,
    )
