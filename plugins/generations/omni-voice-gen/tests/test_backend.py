"""Backend seam behavior: FakeBackend replay, OmnivoiceBackend call mapping via fakes.

No model load, no network — and no real torch/omnivoice imports: both are stubbed into
sys.modules (backend.py imports them lazily at call time), which keeps the model stack out
of the test process (test_main asserts the notice path never sees it).
"""

import sys
import types
import wave
from io import BytesIO
from typing import Any

import numpy as np
import pytest

from omni_voice_gen.backend import (
    SAMPLE_RATE,
    Backend,
    FakeBackend,
    OmnivoiceBackend,
    SegmentSpec,
    _default_device,
    _float_to_wav,
)
from omni_voice_gen.profiles import ProfileEntry


def _wav_params(wav: bytes) -> tuple[int, int, int, int]:
    with wave.open(BytesIO(wav), "rb") as wf:
        return wf.getnchannels(), wf.getsampwidth(), wf.getframerate(), wf.getnframes()


def _spec(profile: ProfileEntry, **overrides: Any) -> SegmentSpec:
    spec: SegmentSpec = {
        "text": "hello world",
        "language": "en",
        "profile": profile,
        "instruct": None,
        "seed": None,
        "speed": None,
    }
    spec.update(overrides)  # type: ignore[typeddict-item]
    return spec


class _FakeModel:
    """Stands in for OmniVoice: records calls, returns a fixed 0.1s waveform."""

    def __init__(self) -> None:
        self.generate_calls: list[dict[str, Any]] = []
        self.asr_loads: list[str | None] = []
        self.transcribe_calls: list[Any] = []

    def generate(self, **kwargs: Any) -> list[np.ndarray]:
        self.generate_calls.append(kwargs)
        return [np.zeros(int(0.1 * SAMPLE_RATE), dtype=np.float32)]

    def load_asr_model(self, model_name: str | None = None, device: str | None = None) -> None:
        self.asr_loads.append(model_name)

    def transcribe(self, audio: Any) -> str:
        self.transcribe_calls.append(audio)
        return "hello world"


class _Fakes(types.SimpleNamespace):
    model: _FakeModel
    loads: list[tuple[str, dict[str, Any]]]
    prompt_loads: list[str]
    seed_calls: list[int]
    torch: types.ModuleType


@pytest.fixture
def fakes(monkeypatch: pytest.MonkeyPatch) -> _Fakes:
    model = _FakeModel()
    loads: list[tuple[str, dict[str, Any]]] = []
    prompt_loads: list[str] = []
    seed_calls: list[int] = []

    omnivoice = types.ModuleType("omnivoice")
    omnivoice.OmniVoice = types.SimpleNamespace(  # type: ignore[attr-defined]
        from_pretrained=lambda model_id, **kwargs: loads.append((model_id, kwargs)) or model
    )
    omnivoice.VoiceClonePrompt = types.SimpleNamespace(  # type: ignore[attr-defined]
        load=lambda path: prompt_loads.append(path) or "PROMPT_OBJ"
    )

    torch = types.ModuleType("torch")
    torch.manual_seed = lambda seed: seed_calls.append(seed)  # type: ignore[attr-defined]
    torch.cuda = types.SimpleNamespace(is_available=lambda: False)  # type: ignore[attr-defined]
    torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "omnivoice", omnivoice)
    monkeypatch.setitem(sys.modules, "torch", torch)
    return _Fakes(model=model, loads=loads, prompt_loads=prompt_loads, seed_calls=seed_calls, torch=torch)


def test_protocol_default_bodies_raise() -> None:
    # The Backend Protocol declares the seam only; its default bodies are inert.
    with pytest.raises(NotImplementedError):
        Backend.load(object())
    with pytest.raises(NotImplementedError):
        Backend.generate(object(), _spec(ProfileEntry(kind="instruct", instruct="x")))
    with pytest.raises(NotImplementedError):
        Backend.transcribe(object(), b"wav", "en")


def test_fake_backend_replays_canned_data_by_call_order() -> None:
    wavs = [_float_to_wav(np.zeros(240, dtype=np.float32), SAMPLE_RATE), b"second"]
    backend = FakeBackend(wavs, [0.01, 0.02], {1: "second transcription"})
    backend.load()
    assert backend.loaded
    spec = _spec(ProfileEntry(kind="instruct", instruct="x"))
    assert backend.generate(spec) == (wavs[0], 0.01)
    assert backend.generate(spec) == (b"second", 0.02)
    assert backend.calls == [spec, spec]
    assert backend.transcribe(wavs[0], "en") == ""  # missing index defaults to ""
    assert backend.transcribe(wavs[1], "en") == "second transcription"


def test_load_from_pretrained_once_across_ten_segments(monkeypatch: pytest.MonkeyPatch, fakes: _Fakes) -> None:
    monkeypatch.setenv("OMNIVOICE_MODEL", "local/omni")
    monkeypatch.setenv("OMNIVOICE_DEVICE", "cpu")
    backend = OmnivoiceBackend()
    backend.load()
    backend.load()
    spec = _spec(ProfileEntry(kind="instruct", instruct="x"))
    for _ in range(10):
        backend.generate(spec)
    assert fakes.loads == [("local/omni", {"device_map": "cpu"})]
    assert len(fakes.model.generate_calls) == 10


def test_explicit_args_beat_env(monkeypatch: pytest.MonkeyPatch, fakes: _Fakes) -> None:
    monkeypatch.setenv("OMNIVOICE_MODEL", "env/model")
    backend = OmnivoiceBackend(model="arg/model", device="cuda", speed=1.3)
    backend.load()
    assert fakes.loads[0] == ("arg/model", {"device_map": "cuda"})
    assert backend._speed == 1.3


def test_default_device_precedence(fakes: _Fakes) -> None:
    fakes.torch.cuda.is_available = lambda: True
    assert _default_device() == "cuda"
    fakes.torch.cuda.is_available = lambda: False
    fakes.torch.backends.mps.is_available = lambda: True
    assert _default_device() == "mps"
    fakes.torch.backends.mps.is_available = lambda: False
    assert _default_device() == "cpu"


def test_generate_requires_load() -> None:
    with pytest.raises(RuntimeError, match="load\\(\\)"):
        OmnivoiceBackend().generate(_spec(ProfileEntry(kind="instruct", instruct="x")))
    with pytest.raises(RuntimeError, match="load\\(\\)"):
        OmnivoiceBackend().transcribe(b"wav", "en")


def test_clone_profile_maps_ref_audio_and_ref_text(fakes: _Fakes) -> None:
    backend = OmnivoiceBackend(device="cpu")
    backend.load()
    profile = ProfileEntry(kind="clone", ref_audio="a.wav", ref_text="transcript")
    wav, duration = backend.generate(_spec(profile, speed=1.2, language="zh"))
    (call,) = fakes.model.generate_calls
    assert call == {
        "text": "hello world",
        "language": "zh",  # straight through, no pre-validation (task R5)
        "speed": 1.2,
        "normalize_text": False,
        "ref_audio": "a.wav",
        "ref_text": "transcript",
    }
    assert duration == pytest.approx(0.1)
    assert _wav_params(wav) == (1, 2, SAMPLE_RATE, int(0.1 * SAMPLE_RATE))  # 24kHz 16-bit mono


def test_prompt_profile_loads_voice_clone_prompt(fakes: _Fakes) -> None:
    backend = OmnivoiceBackend(device="cpu")
    backend.load()
    backend.generate(_spec(ProfileEntry(kind="prompt", prompt="p.pt")))
    (call,) = fakes.model.generate_calls
    assert fakes.prompt_loads == ["p.pt"]
    assert call["voice_clone_prompt"] == "PROMPT_OBJ"
    assert "ref_audio" not in call and "instruct" not in call


def test_instruct_profile_prefers_spec_instruct_then_profile(fakes: _Fakes) -> None:
    backend = OmnivoiceBackend(device="cpu")
    backend.load()
    profile = ProfileEntry(kind="instruct", instruct="profile voice")
    backend.generate(_spec(profile, instruct="segment voice"))
    backend.generate(_spec(profile))
    first, second = fakes.model.generate_calls
    assert first["instruct"] == "segment voice"
    assert second["instruct"] == "profile voice"


def test_speed_defaults_to_env(monkeypatch: pytest.MonkeyPatch, fakes: _Fakes) -> None:
    monkeypatch.setenv("OMNIVOICE_SPEED", "0.9")
    backend = OmnivoiceBackend(device="cpu")
    backend.load()
    backend.generate(_spec(ProfileEntry(kind="instruct", instruct="x")))
    assert fakes.model.generate_calls[0]["speed"] == 0.9


def test_seed_pins_manual_seed(fakes: _Fakes) -> None:
    backend = OmnivoiceBackend(device="cpu")
    backend.load()
    backend.generate(_spec(ProfileEntry(kind="instruct", instruct="x"), seed=42))
    backend.generate(_spec(ProfileEntry(kind="instruct", instruct="x")))
    assert fakes.seed_calls == [42]


def test_transcribe_loads_asr_once_and_passes_24k_tuple(fakes: _Fakes) -> None:
    backend = OmnivoiceBackend(device="cpu")
    backend.load()
    wav, _ = backend.generate(_spec(ProfileEntry(kind="instruct", instruct="x")))
    assert backend.transcribe(wav, "en") == "hello world"
    assert backend.transcribe(wav, "en") == "hello world"
    assert fakes.model.asr_loads == [None]  # no OMNIVOICE_ASR_MODEL -> omnivoice default
    waveform, rate = fakes.model.transcribe_calls[0]
    assert rate == SAMPLE_RATE
    assert isinstance(waveform, np.ndarray) and waveform.dtype == np.float32 and waveform.ndim == 1


def test_transcribe_asr_model_env_override(monkeypatch: pytest.MonkeyPatch, fakes: _Fakes) -> None:
    monkeypatch.setenv("OMNIVOICE_ASR_MODEL", "local/whisper")
    backend = OmnivoiceBackend(device="cpu")
    backend.load()
    wav, _ = backend.generate(_spec(ProfileEntry(kind="instruct", instruct="x")))
    backend.transcribe(wav, "en")
    assert fakes.model.asr_loads == ["local/whisper"]
