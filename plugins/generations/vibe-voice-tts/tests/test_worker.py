"""Private worker tests (pytest): pure helpers, device/mode routing, and NDJSON loop.

No model download: `worker.py` imports heavy dependencies lazily, and render/backend paths are
verified with deterministic fakes on Python 3.12.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
import worker  # noqa: E402


def test_vendor_blocked_flags_vendor_segments(tmp_path: Path) -> None:
    assert worker.vendor_blocked(str(tmp_path / "vendors" / "VibeVoice" / "x"))
    assert not worker.vendor_blocked(str(tmp_path / "safe" / "x"))
    with pytest.raises(worker.WorkerError):
        worker.assert_no_vendor(str(tmp_path / "vendors" / "m"), "model")


def test_env_path_keys_reject_vendor_segments() -> None:
    assert "XDG_CACHE_HOME" in worker._ENV_PATH_KEYS
    for key in ("PYTHONPATH", "XDG_CACHE_HOME", "HF_HOME", "UV_CACHE_DIR"):
        with pytest.raises(worker.WorkerError):
            worker.assert_env_paths_safe({key: "/tmp/vendors/cache"})


def test_parse_registry_accepts_all_modes_and_rejects_bad_shapes(tmp_path: Path) -> None:
    good = {
        "profiles": [
            {"id": "a", "name": "a", "mode": "instruct", "instruct": "calm"},
            {"id": "r", "name": "r", "mode": "reference", "reference_wav_path": "ref.wav"},
            {"id": "c", "name": "c", "mode": "cached_prompt", "prompt_pt_path": "p.pt"},
        ]
    }
    profiles = worker.parse_registry(good, str(tmp_path))
    assert profiles[0]["instruct"] == "calm"
    assert profiles[1]["reference_wav_path"] == str((tmp_path / "ref.wav").resolve())
    assert profiles[2]["prompt_pt_path"] == str((tmp_path / "p.pt").resolve())

    bad = [
        {"profiles": [{"id": "a", "name": "a", "mode": "instruct"}]},
        {"profiles": [{"id": "a", "name": "a", "mode": "reference"}]},
        {"profiles": [{"id": "a", "name": "a", "mode": "cached_prompt"}]},
        {"profiles": [{"id": "a", "name": "a", "mode": "reference", "reference_wav_path": "r.wav", "prompt_pt_path": "p.pt"}]},
        {"profiles": [{"id": "a", "name": "a", "mode": "instruct", "instruct": "x", "prompt": {"foo": 1}}]},
        {"profiles": [{"id": "a", "name": "b", "mode": "instruct", "instruct": "x"}, {"id": "a", "name": "c", "mode": "instruct", "instruct": "x"}]},
        {"profiles": [{"id": "a", "name": "a", "mode": "weird"}]},
        {"not_profiles": []},
    ]
    for registry in bad:
        with pytest.raises(worker.WorkerError):
            worker.parse_registry(registry, str(tmp_path))


def test_load_registry_reads_a_file(tmp_path: Path) -> None:
    path = tmp_path / "profiles.json"
    path.write_text(json.dumps({"profiles": [{"id": "a", "name": "a", "mode": "instruct", "instruct": "x"}]}))
    profiles = worker.load_registry({"VIBEVOICE_PROFILES_PATH": str(path)})
    assert profiles[0]["id"] == "a"
    with pytest.raises(worker.WorkerError):
        worker.load_registry({})


def test_format_speaker_script_normalizes_multiline_and_rejects_empty() -> None:
    assert worker.format_speaker_script("Hello\n  world’s  test\t!") == "Speaker 1: Hello world's test !"
    with pytest.raises(worker.WorkerError):
        worker.format_speaker_script("   \n\t ")


def test_resolve_device_validates_explicit_and_auto_targets() -> None:
    def fake_torch(cuda: bool, mps: bool) -> object:
        return types.SimpleNamespace(
            cuda=types.SimpleNamespace(is_available=lambda: cuda),
            backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: mps)),
        )

    assert worker.resolve_device("auto", fake_torch(False, False)) == "cpu"
    assert worker.resolve_device("auto", fake_torch(False, True)) == "mps"
    assert worker.resolve_device("auto", fake_torch(True, True)) == "cuda"
    assert worker.resolve_device("cpu", fake_torch(True, True)) == "cpu"
    assert worker.resolve_device("mps", fake_torch(False, True)) == "mps"

    with pytest.raises(worker.WorkerError, match="MPS backend is unavailable"):
        worker.resolve_device("mps", fake_torch(False, False))
    with pytest.raises(worker.WorkerError, match="CUDA backend is unavailable"):
        worker.resolve_device("cuda", fake_torch(False, True))
    with pytest.raises(worker.WorkerError, match="unsupported VIBEVOICE_DEVICE"):
        worker.resolve_device("tpu", fake_torch(False, False))


def test_write_pcm16_wav_header_and_mono_guard(tmp_path: Path) -> None:
    dest = tmp_path / "out.wav"
    worker.write_pcm16_wav(str(dest), b"\x00\x00" * 10, 24_000)
    raw = dest.read_bytes()
    assert raw[:4] == b"RIFF" and raw[8:12] == b"WAVE"
    assert raw[24:28] == (24_000).to_bytes(4, "little")
    assert len(raw) == 44 + 20
    with pytest.raises(worker.WorkerError):
        worker.write_pcm16_wav(str(dest), b"\x00\x00", 24_000, channels=2)
    with pytest.raises(worker.WorkerError):
        worker.write_pcm16_wav(str(dest), b"\x00\x00", 0)


def test_isolate_protocol_stdout_keeps_fd1_writes_off_the_ndjson_channel() -> None:
    python_dir = str(Path(__file__).resolve().parent.parent / "python")
    code = (
        f"import sys; sys.path.insert(0, {python_dir!r})\n"
        "import os, worker\n"
        "proto = worker.isolate_protocol_stdout()\n"
        "os.write(1, b'NATIVE-FD1-WRITE\\n')\n"
        "proto.write('{\"ok\": true}\\n'); proto.flush()\n"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, check=False)
    assert result.stdout == b'{"ok": true}\n'
    assert b"NATIVE-FD1-WRITE" in result.stderr


def test_render_supports_reference_cached_prompt_and_instruct_modes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict] = []

    class FakeModel:
        def set_ddpm_inference_steps(self, num_steps: int) -> None:
            calls.append({"ddpm_steps": num_steps})

        def generate(self, **kwargs) -> object:
            calls.append({"generate": kwargs})
            return types.SimpleNamespace(speech_outputs=[[0.25, -0.25, 0.5, -0.5]])

    class FakeProcessor:
        tokenizer = "tok"

        def __call__(self, **kwargs):
            calls.append({"processor_call": kwargs})
            return {"input_ids": [1, 2, 3]}

        def process_input_with_cached_prompt(self, **kwargs):
            calls.append({"process_cached": kwargs})
            return {"input_ids": [4, 5]}

    fake_torch = types.SimpleNamespace(
        manual_seed=lambda s: calls.append({"seed": s}),
        is_tensor=lambda v: False,
        load=lambda path, map_location, weights_only: (
            calls.append({"torch_load": (path, map_location, weights_only)}) or {"kv": [1]}
        ),
        serialization=types.SimpleNamespace(
            safe_globals=lambda classes: _NoopContext(),
        ),
    )

    class _NoopContext:
        def __enter__(self):
            return None

        def __exit__(self, *exc):
            return False

    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(
        sys.modules,
        "numpy",
        types.SimpleNamespace(
            asarray=lambda x, dtype=None: _FakeArray(x),
            all=lambda x: True,
            isfinite=lambda x: True,
            clip=lambda x, a, b: x,
        ),
    )

    ref_wav = tmp_path / "ref.wav"
    ref_wav.write_bytes(b"RIFF")
    pt_file = tmp_path / "voice.pt"
    pt_file.write_bytes(b"PT")

    # Replace to_pcm16 so the test runs without requiring numpy in the unit-test interpreter.
    monkeypatch.setattr(worker, "to_pcm16", lambda wf: b"\x00\x10" * len(list(wf)))

    state_std = {
        "model": FakeModel(),
        "processor": FakeProcessor(),
        "streaming": False,
        "device": "cpu",
        "path": "/models/VibeVoice-1.5B",
        "revision": "main",
        "package": "0.0.1",
        "sample_rate": 24_000,
    }
    dest_ref = tmp_path / "ref_out.wav"
    res_ref = worker._render(
        state_std,
        {
            "text": "Hello\nworld",
            "dest": str(dest_ref),
            "seed": 7,
            "profile": {"mode": "reference", "reference_wav_path": str(ref_wav), "cfg_scale": 1.6, "ddpm_steps": 12},
        },
    )
    assert res_ref["ok"] is True
    assert dest_ref.exists()
    assert {"seed": 7} in calls
    assert {"ddpm_steps": 12} in calls
    proc_call = next(c["processor_call"] for c in calls if "processor_call" in c)
    assert proc_call["text"] == ["Speaker 1: Hello world"]
    assert proc_call["voice_samples"] == [[str(ref_wav.resolve())]]

    dest_inst = tmp_path / "inst_out.wav"
    res_inst = worker._render(
        state_std,
        {"text": "Single segment", "dest": str(dest_inst), "profile": {"mode": "instruct", "instruct": "calm"}},
    )
    assert res_inst["ok"] is True

    state_stream = {**state_std, "streaming": True}
    dest_pt = tmp_path / "pt_out.wav"
    res_pt = worker._render(
        state_stream,
        {"text": "Streaming line", "dest": str(dest_pt), "profile": {"mode": "cached_prompt", "prompt_pt_path": str(pt_file)}},
    )
    assert res_pt["ok"] is True
    assert any(c.get("torch_load") == (str(pt_file.resolve()), "cpu", True) for c in calls)

    # Mode mismatch errors
    with pytest.raises(worker.WorkerError, match="streaming"):
        worker._render(
            state_std,
            {"text": "x", "dest": str(dest_pt), "profile": {"mode": "cached_prompt", "prompt_pt_path": str(pt_file)}},
        )
    with pytest.raises(worker.WorkerError, match="not found"):
        worker._render(
            state_std,
            {"text": "x", "dest": str(dest_ref), "profile": {"mode": "reference", "reference_wav_path": str(tmp_path / "missing.wav")}},
        )


def test_load_backend_fails_actionably_when_streaming_classes_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model_dir = tmp_path / "VibeVoice-Realtime-0.5B"
    model_dir.mkdir()
    (model_dir / "config.json").write_text(json.dumps({"model_type": "vibevoice_streaming"}))
    assert worker.is_streaming_checkpoint(str(model_dir), str(model_dir)) is True

    fake_torch = types.SimpleNamespace(
        float32="float32",
        bfloat16="bfloat16",
        cuda=types.SimpleNamespace(is_available=lambda: False),
        backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False)),
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "vibevoice", types.SimpleNamespace(__version__="0.0.1"))
    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(snapshot_download=lambda repo_id: str(model_dir)))

    with pytest.raises(worker.WorkerError, match="streaming inference classes"):
        worker.load_backend({"VIBEVOICE_MODEL": str(model_dir), "VIBEVOICE_DEVICE": "cpu"})


def test_main_handles_malformed_and_unsupported_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    stdin = io.StringIO("not json\n" + json.dumps({"id": 1, "op": "bogus"}) + "\n")
    stdout = io.StringIO()
    monkeypatch.setattr(sys, "stdin", stdin)
    monkeypatch.setattr(sys, "stdout", stdout)
    assert worker.main([], environ={}) == 0
    lines = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert lines[0]["ok"] is False and "malformed" in lines[0]["error"]
    assert lines[1]["id"] == 1 and lines[1]["ok"] is False


def test_render_requires_health_first() -> None:
    with pytest.raises(worker.WorkerError):
        worker._handle({}, os.environ.copy(), {"id": 1, "op": "render", "text": "x", "dest": "/tmp/x.wav"})


def _run_main(monkeypatch: pytest.MonkeyPatch, payloads: list[dict], handler) -> list[dict]:
    stdin = io.StringIO("".join(json.dumps(payload) + "\n" for payload in payloads))
    stdout = io.StringIO()
    monkeypatch.setattr(sys, "stdin", stdin)
    monkeypatch.setattr(sys, "stdout", stdout)
    monkeypatch.setattr(worker, "_handle", handler)
    assert worker.main([], environ={}) == 0
    return [json.loads(line) for line in stdout.getvalue().splitlines()]


def test_main_answers_health_render_and_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    model = {"path": "/cache/VibeVoice-1.5B", "revision": "abc", "package": "0.0.1"}

    def handler(state: dict, env: dict, request: dict) -> dict:
        del state, env
        if request["op"] == "health":
            return {"ok": True, "sample_rate": 24_000, "model": model}
        if request["op"] == "boom":
            raise worker.WorkerError("nope")
        return {"ok": True, "duration": 0.5, "wav_path": "/scratch/seg.wav"}

    lines = _run_main(
        monkeypatch,
        [{"id": 1, "op": "health"}, {"id": 2, "op": "boom"}, {"id": 3, "op": "render"}],
        handler,
    )
    assert lines[0] == {"id": 1, "ok": True, "sample_rate": 24_000, "model": model}
    assert lines[1] == {"id": 2, "ok": False, "error": "nope"}
    assert lines[2] == {"id": 3, "ok": True, "duration": 0.5, "wav_path": "/scratch/seg.wav"}


class _FakeArray:
    def __init__(self, data):
        self.data = data

    def reshape(self, *_):
        return self
