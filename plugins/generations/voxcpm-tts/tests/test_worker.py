"""Private worker tests (pytest): pure registry/validation/prefix helpers and the NDJSON loop.

No model download, no torch: `worker.py` imports its heavy backend lazily, so these run anywhere
Python 3.12 is available.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
import worker  # noqa: E402


def test_vendor_blocked_flags_vendor_segments(tmp_path: Path) -> None:
    assert worker.vendor_blocked(str(tmp_path / "vendors" / "VoxCPM" / "x"))
    assert not worker.vendor_blocked(str(tmp_path / "safe" / "x"))
    with pytest.raises(worker.WorkerError):
        worker.assert_no_vendor(str(tmp_path / "vendors" / "m"), "model")


def test_parse_registry_accepts_instruct_and_rejects_bad_shapes(tmp_path: Path) -> None:
    good = {"profiles": [{"id": "a", "name": "a", "mode": "instruct", "instruct": "calm"}]}
    profiles = worker.parse_registry(good, str(tmp_path))
    assert profiles[0]["instruct"] == "calm"

    bad = [
        {"profiles": [{"id": "a", "name": "a", "mode": "instruct"}]},
        {"profiles": [{"id": "a", "name": "a", "mode": "reference"}]},
        {"profiles": [{"id": "a", "name": "a", "mode": "continuation", "prompt_wav_path": "p.wav"}]},
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
    profiles = worker.load_registry({"VOXCPM_PROFILES_PATH": str(path)})
    assert profiles[0]["id"] == "a"
    with pytest.raises(worker.WorkerError):
        worker.load_registry({})


def test_apply_instruct_prefixes_parenthesized_text() -> None:
    assert worker.apply_instruct("你好", "calm") == "(calm)你好"
    assert worker.apply_instruct("你好", None) == "你好"


def test_write_pcm16_wav_header_and_mono_guard(tmp_path: Path) -> None:
    dest = tmp_path / "out.wav"
    worker.write_pcm16_wav(str(dest), b"\x00\x00" * 10, 48_000)
    raw = dest.read_bytes()
    assert raw[:4] == b"RIFF" and raw[8:12] == b"WAVE"
    assert raw[24:28] == (48_000).to_bytes(4, "little")
    assert len(raw) == 44 + 20
    with pytest.raises(worker.WorkerError):
        worker.write_pcm16_wav(str(dest), b"\x00\x00", 48_000, channels=2)
    with pytest.raises(worker.WorkerError):
        worker.write_pcm16_wav(str(dest), b"\x00\x00", 0)


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


def test_env_path_keys_include_xdg_cache_home() -> None:
    assert "XDG_CACHE_HOME" in worker._ENV_PATH_KEYS
    with pytest.raises(worker.WorkerError):
        worker.assert_env_paths_safe({"XDG_CACHE_HOME": "/tmp/vendors/hf-cache"})


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
    assert result.stdout == b'{"ok": true}\n'  # protocol channel only
    assert b"NATIVE-FD1-WRITE" in result.stderr  # a native fd-1 write lands on stderr
