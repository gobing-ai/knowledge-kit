"""VoxCPM inference worker for the kk `voxcpm-tts` generator plugin.

A private, invocation-scoped NDJSON worker the TypeScript adapter spawns through `uv run
--locked`. One model load per process; sequential integer-id health/render requests on stdin;
one JSON response per line on stdout. At startup fd 1 is pointed at stderr and the protocol
writes to the saved original fd, so library stdout stays clean at the fd level too — not just
the Python `sys.stdout` object (ADR-036 / docs/design/voxcpm-daily-voice-driver.md).

Backend: independently published ``voxcpm==2.0.3`` on Python 3.12. `vendors/` is reference-only —
every model/cache/profile/import path is canonicalized and refused if it routes into `vendors/`.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import struct
import sys
from pathlib import Path

LINE_MAX_BYTES = 1_048_576
_VENDOR_SEGMENT = "vendors"
_ENV_PATH_KEYS = (
    "PYTHONPATH",
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
        seen_ids.add(pid)
        seen_names.add(name)
        mode = entry.get("mode")
        if mode not in ("instruct", "reference", "continuation"):
            raise WorkerError(f"profile {pid!r} has unsupported mode {mode!r}")
        resolved = dict(entry)
        for key in ("reference_wav_path", "prompt_wav_path"):
            value = entry.get(key)
            if value is None:
                continue
            if not isinstance(value, str) or not value.strip():
                raise WorkerError(f"profile {pid!r} field {key} must be a nonempty string")
            path = value if os.path.isabs(value) else os.path.join(registry_dir, value)
            resolved[key] = assert_no_vendor(path, f"profile {pid!r} {key}")
        if mode == "instruct" and not str(entry.get("instruct", "")).strip():
            raise WorkerError(f"instruct profile {pid!r} needs a nonempty instruct")
        if mode == "reference" and not resolved.get("reference_wav_path"):
            raise WorkerError(f"reference profile {pid!r} needs reference_wav_path")
        if mode == "continuation" and not (resolved.get("prompt_wav_path") and entry.get("prompt_text")):
            raise WorkerError(f"continuation profile {pid!r} needs prompt_wav_path and prompt_text")
        profiles.append(resolved)
    return profiles


def load_registry(environ: dict[str, str]) -> list[dict]:
    path = environ.get("VOXCPM_PROFILES_PATH")
    if not path:
        raise WorkerError("VOXCPM_PROFILES_PATH is not set")
    assert_no_vendor(path, "VOXCPM_PROFILES_PATH")
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as err:
        raise WorkerError(f"profile registry not found: {path}") from err
    except json.JSONDecodeError as err:
        raise WorkerError(f"profile registry is not valid JSON: {err}") from err
    return parse_registry(raw, str(Path(path).parent))


def apply_instruct(text: str, instruct: str | None) -> str:
    """VoxCPM2 renders an instruction as a parenthesized text prefix; the spoken transcript is
    unchanged for downstream QC."""
    if instruct:
        return f"({instruct}){text}"
    return text


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
        raise WorkerError(f"refusing to write {channels}-channel audio; VoxCPM output must be mono")
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
    try:
        from huggingface_hub import scan_cache_dir  # type: ignore

        for repo in scan_cache_dir().repos:
            if repo.repo_id == model_id:
                return repo.repo_path.name
    except Exception:  # noqa: BLE001 - provenance is best-effort, never fatal
        return "unknown"
    return "unknown"


def load_backend(environ: dict[str, str]) -> dict:
    """Resolve the local snapshot, load the model once, and report provenance."""
    assert_env_paths_safe(environ)
    model_id = environ.get("VOXCPM_MODEL", "openbmb/VoxCPM2")
    device = environ.get("VOXCPM_DEVICE", "auto")
    if device not in ("auto", "cpu", "cuda", "mps"):
        raise WorkerError(f"unsupported VOXCPM_DEVICE {device!r} (allowed: auto, cpu, cuda, mps)")

    if device == "mps":
        with contextlib.redirect_stdout(sys.stderr):
            import torch  # type: ignore

        if not torch.backends.mps.is_available():
            raise WorkerError(
                "VOXCPM_DEVICE='mps' requested, but PyTorch MPS backend is unavailable (refusing CPU fallback)"
            )

    with contextlib.redirect_stdout(sys.stderr):
        import voxcpm  # type: ignore
        from huggingface_hub import snapshot_download  # type: ignore

    if os.path.isdir(model_id):
        local = assert_no_vendor(model_id, "VOXCPM_MODEL")
        revision = "unknown"
    else:
        with contextlib.redirect_stdout(sys.stderr):
            local = snapshot_download(repo_id=model_id)
        local = assert_no_vendor(local, "model snapshot")
        revision = _snapshot_revision(model_id, local)

    with contextlib.redirect_stdout(sys.stderr):
        model = voxcpm.VoxCPM.from_pretrained(
            local,
            load_denoiser=False,
            optimize=False,
            device=None if device == "auto" else device,
        )
    package_version = getattr(voxcpm, "__version__", "unknown")
    sample_rate = int(model.tts_model.sample_rate)
    if sample_rate <= 0:
        raise WorkerError(f"model reported a non-positive sample rate {sample_rate}")
    return {
        "model": model,
        "path": local,
        "revision": revision,
        "package": package_version,
        "sample_rate": sample_rate,
    }


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
    out_text = text
    if mode == "instruct":
        out_text = apply_instruct(text, profile.get("instruct"))
    elif mode == "reference":
        reference = assert_no_vendor(profile["reference_wav_path"], "reference_wav_path")
        profile = {**profile, "reference_wav_path": reference}
    elif mode == "continuation":
        prompt_wav = assert_no_vendor(profile["prompt_wav_path"], "prompt_wav_path")
        profile = {**profile, "prompt_wav_path": prompt_wav}
    else:
        raise WorkerError(f"unsupported profile mode {mode!r}")

    seed = request.get("seed")
    if seed is not None:
        import torch  # type: ignore

        torch.manual_seed(int(seed))

    import numpy as np  # type: ignore

    with contextlib.redirect_stdout(sys.stderr):
        if mode == "instruct":
            waveform = state["model"].generate(text=out_text)
        elif mode == "reference":
            waveform = state["model"].generate(text=out_text, reference_wav_path=profile["reference_wav_path"])
        else:
            waveform = state["model"].generate(
                text=out_text,
                prompt_wav_path=profile["prompt_wav_path"],
                prompt_text=profile["prompt_text"],
            )
    del np
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
    channel, and return the real protocol stream (the saved original fd 1). R4's "protocol
    stdout stays clean" must hold for fd-level writes, not only Python `sys.stdout`."""
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
        # The success path MUST answer too: the adapter resolves a request by its id, so a
        # silent success left every health/render waiting out its deadline (task 0258).
        _respond(stdout, request.get("id"), payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(protocol_stdout=isolate_protocol_stdout()))
