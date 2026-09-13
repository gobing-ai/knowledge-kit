"""Backend seam (D6): one in-process OmniVoice load renders every segment.

This is the only torch/omnivoice-importing module, behind the Backend Protocol so every
other module and all tests run without a GPU/model. torch/omnivoice imports stay lazy inside
methods; FakeBackend replays canned data and never touches the model stack. WAV codec is
stdlib `wave` only (float32 [-1,1] -> int16 via np.clip; 24kHz mono both directions).
"""

from __future__ import annotations

import io
import os
import wave
from typing import Any, Protocol, TypedDict

import numpy as np

from .profiles import ProfileEntry

DEFAULT_MODEL = "k2-fsa/OmniVoice"
SAMPLE_RATE = 24000  # OmniVoice output rate; ASR transcribe is fixed at 24000 (task R4)


class SegmentSpec(TypedDict):
    text: str
    language: str
    profile: ProfileEntry
    instruct: str | None
    seed: int | None
    speed: float | None


class Backend(Protocol):
    # Concrete `raise` bodies (not `...`): coverage.py excludes ellipsis lines from
    # measurement, which would leave these permanently "uncovered" for the D2 gate.
    def load(self) -> None:
        raise NotImplementedError

    def generate(self, spec: SegmentSpec) -> tuple[bytes, float]:  # wav bytes, duration sec
        raise NotImplementedError

    def transcribe(self, wav: bytes, language: str) -> str:  # lazy whisper; may raise
        raise NotImplementedError


def _float_to_wav(audio: np.ndarray, sample_rate: int) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def _wav_to_float(wav: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(wav), "rb") as wf:
        frames = wf.readframes(wf.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


class FakeBackend:
    """Canned test backend: replays wavs/durations/transcriptions by call order."""

    def __init__(self, wavs: list[bytes], durations: list[float], transcriptions: dict[int, str]) -> None:
        self._wavs = wavs
        self._durations = durations
        self._transcriptions = transcriptions
        self.calls: list[SegmentSpec] = []
        self.loaded = False
        self._transcribe_count = 0

    def load(self) -> None:
        self.loaded = True

    def generate(self, spec: SegmentSpec) -> tuple[bytes, float]:
        self.calls.append(spec)
        idx = len(self.calls) - 1
        return self._wavs[idx], self._durations[idx]

    def transcribe(self, wav: bytes, language: str) -> str:
        text = self._transcriptions.get(self._transcribe_count, "")
        self._transcribe_count += 1
        return text


def _default_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class OmnivoiceBackend:
    """Real backend: single `OmniVoice.from_pretrained` per instance; ASR lazy (D6/D7)."""

    def __init__(self, model: str | None = None, device: str | None = None, speed: float | None = None) -> None:
        self._model_id = model or os.environ.get("OMNIVOICE_MODEL", DEFAULT_MODEL)
        self._device = device or os.environ.get("OMNIVOICE_DEVICE")
        self._speed = speed if speed is not None else float(os.environ.get("OMNIVOICE_SPEED", "1.0"))
        self._asr_model = os.environ.get("OMNIVOICE_ASR_MODEL")  # None -> omnivoice default whisper
        self._model: Any = None
        self._asr_loaded = False

    def load(self) -> None:
        if self._model is not None:
            return
        from omnivoice import OmniVoice

        self._model = OmniVoice.from_pretrained(self._model_id, device_map=self._device or _default_device())

    def generate(self, spec: SegmentSpec) -> tuple[bytes, float]:
        if self._model is None:
            raise RuntimeError("OmnivoiceBackend.load() must be called before generate()")
        profile = spec["profile"]
        kwargs: dict[str, Any] = {
            "text": spec["text"],
            "language": spec["language"],  # straight through — OmniVoice validates (task R5)
            "speed": spec["speed"] if spec["speed"] is not None else self._speed,
            "normalize_text": False,
        }
        if profile.kind == "clone":
            kwargs["ref_audio"] = profile.ref_audio
            kwargs["ref_text"] = profile.ref_text
        elif profile.kind == "prompt":
            from omnivoice import VoiceClonePrompt

            assert profile.prompt is not None  # guaranteed by registry validation
            kwargs["voice_clone_prompt"] = VoiceClonePrompt.load(profile.prompt)
        else:  # instruct — spec.instruct wins over the profile instruct
            kwargs["instruct"] = spec["instruct"] if spec["instruct"] is not None else profile.instruct
        if spec["seed"] is not None:
            import torch

            torch.manual_seed(spec["seed"])
        audios = self._model.generate(**kwargs)
        audio = audios[0]
        return _float_to_wav(audio, SAMPLE_RATE), len(audio) / SAMPLE_RATE

    def transcribe(self, wav: bytes, language: str) -> str:
        if self._model is None:
            raise RuntimeError("OmnivoiceBackend.load() must be called before transcribe()")
        if not self._asr_loaded:
            self._model.load_asr_model(model_name=self._asr_model)
            self._asr_loaded = True
        return str(self._model.transcribe((_wav_to_float(wav), SAMPLE_RATE)))
