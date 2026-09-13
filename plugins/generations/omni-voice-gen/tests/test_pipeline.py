"""pipeline.run: delete-then-render IO, D4 profile order, verify-retry, render budget, Content/QC assembly."""

from __future__ import annotations

import json
import os
import struct
from pathlib import Path

import pytest
import yaml

from omni_voice_gen import pipeline
from omni_voice_gen.__main__ import main
from omni_voice_gen.backend import FakeBackend, SegmentSpec
from omni_voice_gen.contract import Content, Doc
from omni_voice_gen.voicescript import VoiceScript, VoiceSegment, VoiceSpeaker

HELLO = "Hello there, welcome to the show."
BYE = "Thanks for listening, see you tomorrow."
GARBLED = "zq xv"  # shares no 4-gram with HELLO -> fidelity 0.00


def wav_bytes(data: bytes, sample_rate: int = 1000) -> bytes:
    return (
        struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",
            36 + len(data),
            b"WAVE",
            b"fmt ",
            16,
            1,
            1,
            sample_rate,
            sample_rate * 2,
            2,
            16,
            b"data",
            len(data),
        )
        + data
    )


def pcm(value: int, frames: int) -> bytes:
    return struct.pack(f"<{frames}h", *([value] * frames))


CLEAN_A = wav_bytes(pcm(1000, 10))
CLEAN_B = wav_bytes(pcm(2000, 10))
GARBAGE = wav_bytes(pcm(3000, 10))
# Seven 1s windows at 1000 Hz; window 2 collapses vs both neighbours -> dip at 2.5s.
DIP = wav_bytes(b"".join(pcm(1000 if i == 2 else 10000, 1000) for i in range(7)))


class FlakyBackend(FakeBackend):
    """Raises on the first `failures` generate calls, then replays canned data."""

    def __init__(self, failures: int, wavs: list[bytes], durations: list[float], transcriptions: dict[int, str]):
        super().__init__(wavs, durations, transcriptions)
        self.failures = failures

    def generate(self, spec: SegmentSpec) -> tuple[bytes, float]:
        if self.failures:
            self.failures -= 1
            raise RuntimeError("CUDA out of memory")
        return super().generate(spec)


class DeafBackend(FakeBackend):
    def transcribe(self, wav: bytes, language: str) -> str:
        raise RuntimeError("whisper unavailable")


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for var in ("VOICEBOX_DEFAULT_PROFILE", "VOICE_GEN_MP3", "VOICE_GEN_MAX_RUN_MS", "VOICE_GEN_FAIL_ON_QC"):
        monkeypatch.delenv(var, raising=False)
    registry = tmp_path / "profiles.json"
    registry.write_text(json.dumps({"host": {"instruct": "bright host"}, "narrator": {"instruct": "calm narrator"}}))
    monkeypatch.setenv("OMNIVOICE_PROFILE_REGISTRY", str(registry))


def write_docs(tmp_path: Path, *segments: dict, **script: object) -> str:
    body = yaml.safe_dump({"language": "en", "segments": list(segments), **script})
    path = tmp_path / "docs.json"
    path.write_text(json.dumps([{"id": "d1", "body": body}]), encoding="utf-8")
    return str(path)


def read_meta(out: Path) -> dict:
    return json.loads(out.read_text(encoding="utf-8"))["metadata"]


def test_two_segment_render_writes_validated_content_wav_and_spec_metadata(tmp_path: Path, capsys) -> None:
    out = tmp_path / "out" / "episode.json"
    out.parent.mkdir()
    stale_mp3 = out.with_suffix(".mp3")
    stale_mp3.write_bytes(b"stale")
    backend = FakeBackend([CLEAN_A, CLEAN_B], [2.0, 2.5], {0: HELLO, 1: BYE})
    docs = write_docs(
        tmp_path,
        {"text": HELLO, "speaker": "host", "emotion": "happy"},
        {"text": BYE, "profile": "narrator", "gap_ms": 500, "engine": "qwen"},
        title="Episode 1",
        speakers={"host": {"profile": "host"}},
    )

    pipeline.run(docs, str(out), backend=backend)

    content = Content.model_validate_json(out.read_text(encoding="utf-8"))
    assert (content.title, content.format, content.references) == ("Episode 1", "audio", [])
    meta = content.metadata
    assert set(meta) == {"generator", "audioPath", "duration", "segments", "qc"}  # MP3 off -> no mp3Path
    assert meta["generator"] == "kk:omni-voice-gen"
    assert meta["audioPath"] == os.path.abspath(out.with_suffix(".wav"))
    assert meta["duration"] == pytest.approx(5.0)  # 2.0 + 2.5 + 0.5s gap before segment 2
    ids = [segment.pop("generationId") for segment in meta["segments"]]
    assert all(len(gid) == 16 and int(gid, 16) >= 0 for gid in ids) and ids[0] != ids[1]
    assert meta["segments"] == [
        {
            "profile": "host",
            "speaker": "host",
            "emotion": "happy",
            "duration": 2.0,
            "verifyRetries": 0,
            "transcription": HELLO,
            "loudnessDip": False,
        },
        {"profile": "narrator", "duration": 2.5, "verifyRetries": 0, "transcription": BYE, "loudnessDip": False},
    ]
    qc = meta["qc"]
    assert (qc["passed"], qc["overallScore"], qc["totalDuration"], qc["criticalIssues"]) == (True, 100, 5.0, [])
    assert [audit["segmentIndex"] for audit in qc["segmentAudits"]] == [0, 1]

    # Sibling WAV: both segments with 500ms of silence (1000Hz x 2 bytes/frame) between them.
    assert out.with_suffix(".wav").read_bytes()[44:] == CLEAN_A[44:] + bytes(1000) + CLEAN_B[44:]
    assert not stale_mp3.exists()
    assert backend.loaded
    assert (backend.calls[0]["instruct"], backend.calls[0]["language"]) == ("Speak in a happy tone.", "en")
    assert (backend.calls[1]["profile"].instruct, backend.calls[1]["instruct"]) == ("calm narrator", None)
    assert yaml.safe_load(content.body)["segments"][1] == {"text": BYE, "profile": "narrator", "gap_ms": 500, "engine": "qwen"}

    captured = capsys.readouterr()
    assert captured.out == ""  # stdout stays machine-clean
    assert captured.err.count("ignoring VoiceScript fields") == 1
    assert "2 segments queued" in captured.err and "segment 2/2 done" in captured.err


def test_low_fidelity_attempts_regenerate_and_keep_clean_attempt_2(tmp_path: Path, capsys) -> None:
    out = tmp_path / "episode.json"
    backend = FakeBackend([GARBAGE, GARBAGE, CLEAN_A], [2.0, 2.0, 2.0], {0: GARBLED, 1: GARBLED, 2: HELLO})

    pipeline.run(write_docs(tmp_path, {"text": HELLO, "profile": "host", "seed": 7}), str(out), backend=backend)

    segment = read_meta(out)["segments"][0]
    assert (segment["verifyRetries"], segment["transcription"]) == (2, HELLO)
    assert out.with_suffix(".wav").read_bytes()[44:] == CLEAN_A[44:]
    assert [call["seed"] for call in backend.calls] == [7, None, None]  # explicit seed pins attempt 0 only
    err = capsys.readouterr().err
    assert "transcription fidelity 0.00 below 0.15" in err and "segment 1/1 done" in err and "(2 verify retries)" in err


def test_low_fidelity_on_every_attempt_keeps_final_audio_and_flags_qc(tmp_path: Path) -> None:
    out = tmp_path / "episode.json"
    backend = FakeBackend([GARBAGE] * 3, [2.0] * 3, dict.fromkeys(range(3), GARBLED))

    pipeline.run(write_docs(tmp_path, {"text": HELLO, "profile": "host"}), str(out), backend=backend)

    meta = read_meta(out)
    assert (meta["segments"][0]["verifyRetries"], meta["segments"][0]["transcription"]) == (2, GARBLED)
    assert meta["qc"]["passed"] is False
    assert any(issue.startswith("transcription_fidelity_low") for issue in meta["qc"]["criticalIssues"])


def test_surviving_loudness_dip_is_recorded_not_failed(tmp_path: Path, capsys) -> None:
    out = tmp_path / "episode.json"
    backend = FakeBackend([DIP] * 3, [2.0] * 3, dict.fromkeys(range(3), HELLO))

    pipeline.run(write_docs(tmp_path, {"text": HELLO, "profile": "host"}), str(out), backend=backend)

    meta = read_meta(out)
    assert (meta["segments"][0]["loudnessDip"], meta["segments"][0]["verifyRetries"]) == (True, 2)
    assert "loudness_dip:unknown" in meta["qc"]["criticalIssues"]
    assert "loudness dip detected at 2.5s" in capsys.readouterr().err


def test_asr_unavailable_keeps_audio_without_transcription(tmp_path: Path) -> None:
    out = tmp_path / "episode.json"
    backend = DeafBackend([CLEAN_A], [2.0], {})

    pipeline.run(write_docs(tmp_path, {"text": HELLO, "profile": "host"}), str(out), backend=backend)

    segment = read_meta(out)["segments"][0]
    assert segment["verifyRetries"] == 0 and "transcription" not in segment
    assert len(backend.calls) == 1


def test_render_exception_is_retried_once_inline(tmp_path: Path, capsys) -> None:
    out = tmp_path / "episode.json"
    backend = FlakyBackend(1, [CLEAN_A], [2.0], {0: HELLO})

    pipeline.run(write_docs(tmp_path, {"text": HELLO, "profile": "host"}), str(out), backend=backend)

    assert read_meta(out)["segments"][0]["verifyRetries"] == 0
    assert "segment render failed (CUDA out of memory); retrying once" in capsys.readouterr().err


def test_render_failing_every_attempt_fails_run_with_no_output(tmp_path: Path) -> None:
    out = tmp_path / "episode.json"
    out.write_text("stale", encoding="utf-8")
    out.with_suffix(".wav").write_bytes(b"stale")
    backend = FlakyBackend(2, [CLEAN_A], [2.0], {0: HELLO})

    with pytest.raises(RuntimeError, match="CUDA out of memory"):
        pipeline.run(write_docs(tmp_path, {"text": HELLO, "profile": "host"}), str(out), backend=backend)

    assert not out.exists() and not out.with_suffix(".wav").exists()


def test_render_budget_exceeded_fails_before_next_segment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [0.0]
    monkeypatch.setattr(pipeline, "monotonic", lambda: clock[0])
    monkeypatch.setenv("VOICE_GEN_MAX_RUN_MS", "1000")

    class SlowBackend(FakeBackend):
        def generate(self, spec: SegmentSpec) -> tuple[bytes, float]:
            clock[0] += 2.0
            return super().generate(spec)

    backend = SlowBackend([CLEAN_A, CLEAN_B], [2.0, 2.5], {0: HELLO, 1: BYE})
    out = tmp_path / "episode.json"
    docs = write_docs(tmp_path, {"text": HELLO, "profile": "host"}, {"text": BYE, "profile": "host"})

    with pytest.raises(RuntimeError, match=r"render budget 1000ms exceeded after 1/2 segments"):
        pipeline.run(docs, str(out), backend=backend)

    assert len(backend.calls) == 1
    assert not out.exists()


def test_invalid_render_budget_fails_before_model_load(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_GEN_MAX_RUN_MS", "soon")
    backend = FakeBackend([CLEAN_A], [2.0], {0: HELLO})

    with pytest.raises(ValueError, match="VOICE_GEN_MAX_RUN_MS must be an integer millisecond budget, got 'soon'"):
        pipeline.run(write_docs(tmp_path, {"text": HELLO, "profile": "host"}), str(tmp_path / "e.json"), backend=backend)

    assert not backend.loaded


def test_fail_on_qc_exits_1_naming_score_and_issues_without_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    monkeypatch.setenv("VOICE_GEN_FAIL_ON_QC", "true")
    backend = FakeBackend([GARBAGE] * 3, [2.0] * 3, dict.fromkeys(range(3), GARBLED))
    monkeypatch.setattr(pipeline, "OmnivoiceBackend", lambda: backend)  # main() builds the default backend
    out = tmp_path / "episode.json"

    rc = main(["--in", write_docs(tmp_path, {"text": HELLO, "profile": "host"}), "--out", str(out)])

    assert rc == 1
    err = capsys.readouterr().err
    assert "omni-voice-gen failed: Voice Quality Control failed (0/100):" in err
    assert "transcription_fidelity_low:0.00" in err
    assert not out.exists() and not out.with_suffix(".wav").exists()  # WAV was written, then cleaned up


def test_mp3_requested_transcodes_sibling_and_records_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_GEN_MP3", "true")
    seen: list[tuple[str, str]] = []

    def transcoder(wav: str, mp3: str) -> None:
        seen.append((wav, mp3))
        Path(mp3).write_bytes(b"ID3")

    out = tmp_path / "episode.json"
    pipeline.run(
        write_docs(tmp_path, {"text": HELLO, "profile": "host"}),
        str(out),
        backend=FakeBackend([CLEAN_A], [2.0], {0: HELLO}),
        transcoder=transcoder,
    )

    mp3 = os.path.abspath(out.with_suffix(".mp3"))
    assert seen == [(os.path.abspath(out.with_suffix(".wav")), mp3)]
    assert read_meta(out)["mp3Path"] == mp3


def test_empty_doc_list_writes_notice_and_clears_stale_audio(tmp_path: Path) -> None:
    src = tmp_path / "in.json"
    src.write_text("[]", encoding="utf-8")
    out = tmp_path / "episode.json"
    out.with_suffix(".wav").write_bytes(b"stale")
    backend = FakeBackend([], [], {})

    pipeline.run(str(src), str(out), backend=backend)

    assert json.loads(out.read_text(encoding="utf-8"))["title"] == "Notice"
    assert not out.with_suffix(".wav").exists() and not backend.loaded


def test_profile_target_follows_frozen_d4_order() -> None:
    segment = VoiceSegment(text="t", profile_id="seg-id", profile="seg")
    speaker = VoiceSpeaker(profile_id="spk-id", profile="spk")
    script = VoiceScript(default_profile_id="def-id", default_profile="def")
    docs = [Doc(id="d", body="b", metadata={"voiceProfile": "doc"})]
    order = [
        (segment, "profile_id", "seg-id"),
        (segment, "profile", "seg"),
        (speaker, "profile_id", "spk-id"),
        (speaker, "profile", "spk"),
        (script, "default_profile_id", "def-id"),
        (script, "default_profile", "def"),
    ]
    for owner, attr, expected in order:
        assert pipeline.resolve_profile_target(segment, speaker, script, "env", docs) == expected
        setattr(owner, attr, None)
    assert pipeline.resolve_profile_target(segment, speaker, script, "env", docs) == "env"
    assert pipeline.resolve_profile_target(segment, speaker, script, None, docs) == "doc"
    with pytest.raises(ValueError, match="VOICEBOX_DEFAULT_PROFILE, or doc metadata.voiceProfile"):
        pipeline.resolve_profile_target(segment, None, script, None, [Doc(id="d", body="b")])
