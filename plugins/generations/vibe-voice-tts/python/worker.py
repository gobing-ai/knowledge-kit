"""VibeVoice inference worker for the kk `vibe-voice-tts` generator plugin.

A private, invocation-scoped NDJSON worker the TypeScript adapter spawns through `uv run
--locked`. One model load per process; sequential integer-id health/render requests on stdin;
one JSON response per line on stdout. At startup fd 1 is pointed at stderr and the protocol
writes to the saved original fd, so library stdout stays clean at the fd level too — not just
the Python `sys.stdout` object (ADR-055 / docs/design/vibe-voice-driver.md).

Backend: independently published ``vibevoice==0.0.1`` on Python 3.12. `vendors/` is reference-only
— every model/cache/profile/import path is canonicalized and refused if it routes into `vendors/`.
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import re
import struct
import sys
from pathlib import Path

LINE_MAX_BYTES = 1_048_576
DEFAULT_MODEL = "microsoft/VibeVoice-1.5B"
DEFAULT_SAMPLE_RATE = 24_000
DEFAULT_CFG_SCALE = 1.5
DEFAULT_DDPM_STEPS = 10
DEFAULT_STREAMING_DDPM_STEPS = 5
_VENDOR_SEGMENT = "vendors"
_ENV_PATH_KEYS = (
    "PYTHONPATH",
    "PYTHONHOME",
    "VIRTUAL_ENV",
    "UV_PROJECT_ENVIRONMENT",
    "UV_CACHE_DIR",
    "HF_HOME",
    "HF_HUB_CACHE",
    "XDG_CACHE_HOME",
    "TRANSFORMERS_CACHE",
    "HF_DATASETS_CACHE",
)


class WorkerError(Exception):
    """An actionable worker failure surfaced to the adapter as `{ok:false, error}`."""


def _canonical(path: str) -> str:
    return str(Path(path).expanduser().resolve())


def vendor_blocked(path: str) -> bool:
    """True when the canonical path (or any symlink target) contains a `vendors` segment."""
    resolved = Path(path).expanduser()
    try:
        resolved = resolved.resolve()
    except OSError:
        resolved = resolved.absolute()
    if _VENDOR_SEGMENT in resolved.parts:
        return True
    if resolved.exists():
        real = Path(os.path.realpath(resolved))
        if _VENDOR_SEGMENT in real.parts:
            return True
    return False


def assert_no_vendor(path: str, label: str) -> str:
    if vendor_blocked(path):
        raise WorkerError(f"{label} must not reference vendors/ (reference-only): {path}")
    return _canonical(path)


def assert_env_paths_safe(environ: dict[str, str]) -> None:
    for key in _ENV_PATH_KEYS:
        raw = environ.get(key)
        if not raw:
            continue
        for part in raw.split(os.pathsep):
            if part:
                assert_no_vendor(part, key)


def parse_registry(raw: object, registry_dir: str) -> list[dict]:
    if not isinstance(raw, dict) or not isinstance(raw.get("profiles"), list):
        raise WorkerError('profile registry must be an object with a "profiles" array')
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    profiles: list[dict] = []
    for index, entry in enumerate(raw["profiles"]):
        if not isinstance(entry, dict):
            raise WorkerError(f"profile entry {index} is not an object")
        pid = str(entry.get("id", "")).strip()
        name = str(entry.get("name", "")).strip()
        if not pid or not name:
            raise WorkerError(f"profile entry {index} needs nonempty id and name")
        if pid in seen_ids or name in seen_names:
            raise WorkerError(f"duplicate profile id/name {pid!r}")
        if "prompt" in entry or "serialized_prompt" in entry:
            raise WorkerError(f"profile {pid!r} carries a serialized OmniVoice prompt")
        seen_ids.add(pid)
        seen_names.add(name)
        mode = entry.get("mode")
        if mode not in ("instruct", "reference", "cached_prompt"):
            raise WorkerError(f"profile {pid!r} has unsupported mode {mode!r}")
        resolved = dict(entry)
        for key in ("reference_wav_path", "prompt_pt_path"):
            value = entry.get(key)
            if value is None:
                continue
            if not isinstance(value, str) or not value.strip():
                raise WorkerError(f"profile {pid!r} field {key} must be a nonempty string")
            path = value if os.path.isabs(value) else os.path.join(registry_dir, value)
            resolved[key] = assert_no_vendor(path, f"profile {pid!r} {key}")
        mixed = (
            [resolved.get("reference_wav_path"), resolved.get("prompt_pt_path")]
            if mode == "instruct"
            else [resolved.get("prompt_pt_path")]
            if mode == "reference"
            else [resolved.get("reference_wav_path")]
        )
        if any(value is not None for value in mixed):
            raise WorkerError(f"profile {pid!r} mixes mode {mode!r} with fields from another mode")
        if mode == "instruct" and not str(entry.get("instruct", "")).strip():
            raise WorkerError(f"instruct profile {pid!r} needs a nonempty instruct")
        if mode == "reference" and not resolved.get("reference_wav_path"):
            raise WorkerError(f"reference profile {pid!r} needs reference_wav_path")
        if mode == "cached_prompt" and not resolved.get("prompt_pt_path"):
            raise WorkerError(f"cached_prompt profile {pid!r} needs prompt_pt_path")
        profiles.append(resolved)
    return profiles


def load_registry(environ: dict[str, str]) -> list[dict]:
    path = environ.get("VIBEVOICE_PROFILES_PATH")
    if not path:
        raise WorkerError("VIBEVOICE_PROFILES_PATH is not set")
    assert_no_vendor(path, "VIBEVOICE_PROFILES_PATH")
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as err:
        raise WorkerError(f"profile registry not found: {path}") from err
    except json.JSONDecodeError as err:
        raise WorkerError(f"profile registry is not valid JSON: {err}") from err
    return parse_registry(raw, str(Path(path).parent))


def format_speaker_script(text: str) -> str:
    """Normalize arbitrary VoiceScript segment text into a single-line VibeVoice `Speaker 1:` line."""
    normalized = text.replace("\u2019", "'")
    collapsed = re.sub(r"\s+", " ", normalized).strip()
    if not collapsed:
        raise WorkerError("render text must be a nonempty string")
    return f"Speaker 1: {collapsed}"


def resolve_device(requested: str, torch_mod: object) -> str:
    if requested not in ("auto", "cpu", "cuda", "mps"):
        raise WorkerError(f"unsupported VIBEVOICE_DEVICE {requested!r} (allowed: auto, cpu, cuda, mps)")
    cuda_mod = getattr(torch_mod, "cuda", None)
    cuda_ok = bool(cuda_mod and cuda_mod.is_available())
    backends_mod = getattr(torch_mod, "backends", None)
    mps_mod = getattr(backends_mod, "mps", None)
    mps_ok = bool(mps_mod and mps_mod.is_available())
    if requested == "cuda":
        if not cuda_ok:
            raise WorkerError("VIBEVOICE_DEVICE='cuda' requested, but PyTorch CUDA backend is unavailable (refusing CPU fallback)")
        return "cuda"
    if requested == "mps":
        if not mps_ok:
            raise WorkerError("VIBEVOICE_DEVICE='mps' requested, but PyTorch MPS backend is unavailable (refusing CPU fallback)")
        return "mps"
    if requested == "cpu":
        return "cpu"
    if cuda_ok:
        return "cuda"
    if mps_ok:
        return "mps"
    return "cpu"


def is_streaming_checkpoint(model_id: str, local_dir: str) -> bool:
    config_path = Path(local_dir) / "config.json"
    if config_path.is_file():
        try:
            cfg = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(cfg, dict):
                model_type = str(cfg.get("model_type", "")).lower()
                archs = " ".join(str(a).lower() for a in cfg.get("architectures", []))
                if "streaming" in model_type or "streaming" in archs:
                    return True
        except (OSError, json.JSONDecodeError):
            pass
    lower_id = model_id.lower()
    return "realtime" in lower_id or "streaming" in lower_id


def extract_waveform(outputs: object) -> object:
    speech_outputs = getattr(outputs, "speech_outputs", None)
    if not speech_outputs or speech_outputs[0] is None:
        raise WorkerError("model returned no audio output")
    sample = speech_outputs[0]
    detach = getattr(sample, "detach", None)
    if callable(detach):
        sample = detach().cpu().float().numpy()
    return sample


def to_pcm16(waveform: object) -> bytes:
    import numpy as np  # imported lazily so helper tests need no torch/numpy

    array = np.asarray(waveform, dtype="float32").reshape(-1)
    if array.size == 0:
        raise WorkerError("model returned an empty waveform")
    if not np.all(np.isfinite(array)):
        raise WorkerError("model returned a non-finite waveform")
    clipped = np.clip(array, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def write_pcm16_wav(path: str, pcm: bytes, sample_rate: int, channels: int = 1) -> None:
    if channels != 1:
        raise WorkerError(f"refusing to write {channels}-channel audio; VibeVoice output must be mono")
    if not isinstance(sample_rate, int) or sample_rate <= 0:
        raise WorkerError(f"invalid sample rate {sample_rate}")
    block_align = channels * 2
    byte_rate = sample_rate * block_align
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, 16)
    header += b"data" + struct.pack("<I", len(pcm))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(header)
        handle.write(pcm)


def _snapshot_revision(model_id: str, local_dir: str) -> str:
    del local_dir
    try:
        from huggingface_hub import scan_cache_dir  # type: ignore

        for repo in scan_cache_dir().repos:
            if repo.repo_id == model_id:
                return repo.repo_path.name
    except Exception:  # noqa: BLE001 - provenance is best-effort, never fatal
        return "unknown"
    return "unknown"


def _load_cached_prompt(prompt_pt_path: str, device: str, torch_mod: object) -> object:
    safe_classes: list[object] = []
    try:
        from transformers.modeling_outputs import BaseModelOutputWithPast  # type: ignore

        safe_classes.append(BaseModelOutputWithPast)
    except Exception:  # noqa: BLE001
        pass
    try:
        from transformers.cache_utils import DynamicCache  # type: ignore

        safe_classes.append(DynamicCache)
    except Exception:  # noqa: BLE001
        pass

    serialization = getattr(torch_mod, "serialization", None)
    safe_globals = getattr(serialization, "safe_globals", None)
    if callable(safe_globals) and safe_classes:
        with safe_globals(safe_classes):
            return torch_mod.load(prompt_pt_path, map_location=device, weights_only=True)
    return torch_mod.load(prompt_pt_path, map_location=device, weights_only=True)


def load_backend(environ: dict[str, str]) -> dict:
    """Resolve the local snapshot, load the processor & model once, and report provenance."""
    assert_env_paths_safe(environ)
    model_id = environ.get("VIBEVOICE_MODEL", DEFAULT_MODEL)
    requested_device = environ.get("VIBEVOICE_DEVICE", "auto")

    with contextlib.redirect_stdout(sys.stderr):
        import torch  # type: ignore

    device = resolve_device(requested_device, torch)

    with contextlib.redirect_stdout(sys.stderr):
        import vibevoice  # type: ignore
        from huggingface_hub import snapshot_download  # type: ignore

    if os.path.isdir(model_id):
        local = assert_no_vendor(model_id, "VIBEVOICE_MODEL")
        revision = "unknown"
    else:
        assert_no_vendor(model_id, "VIBEVOICE_MODEL")
        with contextlib.redirect_stdout(sys.stderr):
            local = snapshot_download(repo_id=model_id)
        local = assert_no_vendor(local, "model snapshot")
        revision = _snapshot_revision(model_id, local)

    streaming = is_streaming_checkpoint(model_id, local)
    if streaming:
        try:
            with contextlib.redirect_stdout(sys.stderr):
                from vibevoice.modular.modeling_vibevoice_streaming_inference import (  # type: ignore
                    VibeVoiceStreamingForConditionalGenerationInference,
                )
                from vibevoice.processor.vibevoice_streaming_processor import (  # type: ignore
                    VibeVoiceStreamingProcessor,
                )
        except ImportError as err:
            raise WorkerError(
                f"streaming checkpoint {model_id!r} requires streaming inference classes "
                "(VibeVoiceStreamingProcessor / VibeVoiceStreamingForConditionalGenerationInference), "
                f"which are unavailable in installed vibevoice: {err}"
            ) from err
        processor_cls = VibeVoiceStreamingProcessor
        model_cls = VibeVoiceStreamingForConditionalGenerationInference
    else:
        with contextlib.redirect_stdout(sys.stderr):
            from vibevoice.modular.modeling_vibevoice_inference import (  # type: ignore
                VibeVoiceForConditionalGenerationInference,
            )
            from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor  # type: ignore

        processor_cls = VibeVoiceProcessor
        model_cls = VibeVoiceForConditionalGenerationInference

    if device == "cuda":
        load_dtype = torch.bfloat16
        attn_impl = "flash_attention_2"
        device_map: str | None = "cuda"
    else:
        load_dtype = torch.float32
        attn_impl = "sdpa"
        device_map = None if device == "mps" else "cpu"

    with contextlib.redirect_stdout(sys.stderr):
        processor = processor_cls.from_pretrained(local)
        try:
            model = model_cls.from_pretrained(
                local,
                torch_dtype=load_dtype,
                attn_implementation=attn_impl,
                device_map=device_map,
            )
            if device == "mps":
                model.to("mps")
        except Exception:  # noqa: BLE001 - match VibeVoice fallback when flash_attention_2 is absent on CUDA
            if attn_impl != "flash_attention_2":
                raise
            model = model_cls.from_pretrained(
                local,
                torch_dtype=load_dtype,
                attn_implementation="sdpa",
                device_map=device_map,
            )
        model.eval()

    package_version = getattr(vibevoice, "__version__", "unknown")
    audio_processor = getattr(processor, "audio_processor", None)
    sample_rate = int(getattr(audio_processor, "sampling_rate", DEFAULT_SAMPLE_RATE))
    if sample_rate <= 0:
        raise WorkerError(f"processor reported a non-positive sample rate {sample_rate}")
    return {
        "model": model,
        "processor": processor,
        "streaming": streaming,
        "device": device,
        "path": local,
        "revision": revision,
        "package": package_version,
        "sample_rate": sample_rate,
    }


def _move_tensors_to_device(inputs: dict, device: str, torch_mod: object) -> dict:
    moved = dict(inputs)
    is_tensor = getattr(torch_mod, "is_tensor", None)
    for key, value in moved.items():
        if callable(is_tensor) and is_tensor(value) and hasattr(value, "to"):
            moved[key] = value.to(device)
    return moved


def _render(state: dict, request: dict) -> dict:
    text = request.get("text")
    if not isinstance(text, str) or not text.strip():
        raise WorkerError("render text must be a nonempty string")
    dest = request.get("dest")
    if not isinstance(dest, str) or not os.path.isabs(dest):
        raise WorkerError("render destination must be an absolute path")
    assert_no_vendor(dest, "render destination")

    profile = request.get("profile") or {}
    mode = profile.get("mode")
    if mode not in ("instruct", "reference", "cached_prompt"):
        raise WorkerError(f"unsupported profile mode {mode!r}")

    streaming = bool(state.get("streaming", False))
    if mode == "cached_prompt" and not streaming:
        raise WorkerError("cached_prompt profile requires a streaming VibeVoice checkpoint (e.g. VibeVoice-Realtime-0.5B)")
    if mode in ("reference", "instruct") and streaming:
        raise WorkerError(f"{mode} profile requires a non-streaming VibeVoice checkpoint (e.g. microsoft/VibeVoice-1.5B)")

    cfg_scale = float(profile.get("cfg_scale", DEFAULT_CFG_SCALE))
    default_steps = DEFAULT_STREAMING_DDPM_STEPS if mode == "cached_prompt" else DEFAULT_DDPM_STEPS
    ddpm_steps = int(profile.get("ddpm_steps", default_steps))

    with contextlib.redirect_stdout(sys.stderr):
        import torch  # type: ignore

    seed = request.get("seed")
    if seed is not None:
        torch.manual_seed(int(seed))

    model = state["model"]
    processor = state["processor"]
    device = state.get("device", "cpu")

    if hasattr(model, "set_ddpm_inference_steps"):
        model.set_ddpm_inference_steps(num_steps=ddpm_steps)

    extra_generate_kwargs: dict = {}
    if mode == "reference":
        ref_path = profile.get("reference_wav_path")
        if not isinstance(ref_path, str) or not ref_path.strip():
            raise WorkerError("reference profile requires reference_wav_path")
        ref_wav = assert_no_vendor(ref_path, "reference_wav_path")
        if not os.path.isfile(ref_wav):
            raise WorkerError(f"reference audio file not found: {ref_wav}")
        script = format_speaker_script(text)
        raw_inputs = processor(
            text=[script],
            voice_samples=[[ref_wav]],
            padding=True,
            return_tensors="pt",
            return_attention_mask=True,
        )
    elif mode == "cached_prompt":
        pt_path_raw = profile.get("prompt_pt_path")
        if not isinstance(pt_path_raw, str) or not pt_path_raw.strip():
            raise WorkerError("cached_prompt profile requires prompt_pt_path")
        pt_path = assert_no_vendor(pt_path_raw, "prompt_pt_path")
        if not os.path.isfile(pt_path):
            raise WorkerError(f"cached prompt .pt file not found: {pt_path}")
        clean_text = text.replace("\u2019", "'").strip()
        cached_prompt = _load_cached_prompt(pt_path, device, torch)
        raw_inputs = processor.process_input_with_cached_prompt(
            text=clean_text,
            cached_prompt=cached_prompt,
            padding=True,
            return_tensors="pt",
            return_attention_mask=True,
        )
        extra_generate_kwargs["all_prefilled_outputs"] = copy.deepcopy(cached_prompt)
    else:
        script = format_speaker_script(text)
        raw_inputs = processor(
            text=[script],
            voice_samples=None,
            padding=True,
            return_tensors="pt",
            return_attention_mask=True,
        )

    inputs = _move_tensors_to_device(dict(raw_inputs), device, torch)
    with contextlib.redirect_stdout(sys.stderr):
        outputs = model.generate(
            **inputs,
            max_new_tokens=None,
            cfg_scale=cfg_scale,
            tokenizer=processor.tokenizer,
            generation_config={"do_sample": False},
            **extra_generate_kwargs,
        )

    waveform = extract_waveform(outputs)
    pcm = to_pcm16(waveform)
    sample_rate = state["sample_rate"]
    write_pcm16_wav(dest, pcm, sample_rate)
    duration = len(pcm) / 2 / sample_rate
    return {
        "ok": True,
        "duration": duration,
        "wav_path": dest,
        "sample_rate": sample_rate,
        "model": {"path": state["path"], "revision": state["revision"], "package": state["package"]},
    }


def _respond(stdout: io.TextIOBase, request_id: object, payload: dict) -> None:
    message = {"id": request_id, **payload}
    stdout.write(json.dumps(message) + "\n")
    stdout.flush()


def _handle(state: dict, environ: dict[str, str], request: dict) -> dict:
    op = request.get("op")
    if op == "health":
        backend = state.get("backend")
        if backend is None:
            load_registry(environ)
            backend = load_backend(environ)
            state["backend"] = backend
        return {
            "ok": True,
            "sample_rate": backend["sample_rate"],
            "model": {
                "path": backend["path"],
                "revision": backend["revision"],
                "package": backend["package"],
            },
        }
    if op == "render":
        backend = state.get("backend")
        if backend is None:
            raise WorkerError("render before health; the model is not loaded")
        return _render(backend, request)
    raise WorkerError(f"unsupported op {op!r}")


def isolate_protocol_stdout() -> io.TextIOBase:
    """Point fd 1 at stderr so a native library writing to fd 1 cannot corrupt the NDJSON
    channel, and return the real protocol stream (the saved original fd 1)."""
    saved = os.dup(1)
    os.dup2(2, 1)
    return os.fdopen(saved, "w", encoding="utf-8", newline="\n")


def main(
    argv: list[str] | None = None,
    environ: dict[str, str] | None = None,
    protocol_stdout: io.TextIOBase | None = None,
) -> int:
    del argv
    env = environ if environ is not None else dict(os.environ)
    stdout = protocol_stdout if protocol_stdout is not None else sys.stdout
    state: dict = {}
    for raw in sys.stdin:
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        if len(line.encode("utf-8")) > LINE_MAX_BYTES:
            _respond(stdout, None, {"ok": False, "error": "request frame exceeds 1 MiB"})
            return 1
        try:
            request = json.loads(line)
            if not isinstance(request, dict) or not isinstance(request.get("id"), int):
                raise WorkerError("request must carry an integer id")
        except (json.JSONDecodeError, WorkerError) as err:
            _respond(stdout, None, {"ok": False, "error": f"malformed request: {err}"})
            continue
        try:
            payload = _handle(state, env, request)
        except WorkerError as err:
            _respond(stdout, request.get("id"), {"ok": False, "error": str(err)})
            continue
        except Exception as err:  # noqa: BLE001 - surface any backend failure actionably
            _respond(stdout, request.get("id"), {"ok": False, "error": f"{type(err).__name__}: {err}"})
            continue
        _respond(stdout, request.get("id"), payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(protocol_stdout=isolate_protocol_stdout()))
