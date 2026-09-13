"""mp3.py: VOICE_GEN_MP3 truthiness + ffmpeg transcode fail-loud contract."""

import stat
from pathlib import Path

import pytest

from omni_voice_gen.mp3 import is_mp3_requested, transcode_wav_to_mp3

# --- is_mp3_requested ---


def test_mp3_unset_and_empty_are_false() -> None:
    assert is_mp3_requested({}) is False
    assert is_mp3_requested({"VOICE_GEN_MP3": ""}) is False


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", "TRUE", " On "])
def test_mp3_truthy_values(value: str) -> None:
    assert is_mp3_requested({"VOICE_GEN_MP3": value}) is True


@pytest.mark.parametrize("value", ["0", "false", "no", "off", "2"])
def test_mp3_falsy_values(value: str) -> None:
    assert is_mp3_requested({"VOICE_GEN_MP3": value}) is False


def test_mp3_defaults_to_process_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_GEN_MP3", "yes")
    assert is_mp3_requested() is True
    monkeypatch.delenv("VOICE_GEN_MP3")
    assert is_mp3_requested() is False


# --- transcode_wav_to_mp3 ---


def make_ffmpeg(path: Path, body: str) -> str:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return str(path)


def test_transcode_missing_input_wav(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="WAV input not found"):
        transcode_wav_to_mp3(str(tmp_path / "nope.wav"), str(tmp_path / "out.mp3"))


def test_transcode_success_invokes_expected_flags(tmp_path: Path) -> None:
    wav = tmp_path / "in.wav"
    wav.write_bytes(b"RIFF")
    args_log = tmp_path / "args.txt"
    ffmpeg = make_ffmpeg(
        tmp_path / "ffmpeg",
        f'#!/bin/sh\nprintf \'%s\' "$*" > "{args_log}"\nfor last; do :; done\ntouch "$last"\n',
    )
    mp3 = tmp_path / "out.mp3"
    transcode_wav_to_mp3(str(wav), str(mp3), ffmpeg_bin=ffmpeg)
    assert mp3.exists()
    args = args_log.read_text(encoding="utf-8")
    assert f"-i {wav}" in args
    assert "-codec:a libmp3lame" in args
    assert "-qscale:a 2" in args
    assert "-hide_banner" in args


def test_transcode_nonzero_exit_fails_loud(tmp_path: Path) -> None:
    wav = tmp_path / "in.wav"
    wav.write_bytes(b"RIFF")
    ffmpeg = make_ffmpeg(tmp_path / "ffmpeg", "#!/bin/sh\necho 'lame error' >&2\nexit 3\n")
    with pytest.raises(RuntimeError, match=r"ffmpeg mp3 transcode failed \(exit 3\): lame error"):
        transcode_wav_to_mp3(str(wav), str(tmp_path / "out.mp3"), ffmpeg_bin=ffmpeg)


def test_transcode_no_output_file_fails(tmp_path: Path) -> None:
    wav = tmp_path / "in.wav"
    wav.write_bytes(b"RIFF")
    ffmpeg = make_ffmpeg(tmp_path / "ffmpeg", "#!/bin/sh\nexit 0\n")
    with pytest.raises(RuntimeError, match="produced no file"):
        transcode_wav_to_mp3(str(wav), str(tmp_path / "out.mp3"), ffmpeg_bin=ffmpeg)


def test_transcode_missing_ffmpeg_binary(tmp_path: Path) -> None:
    wav = tmp_path / "in.wav"
    wav.write_bytes(b"RIFF")
    with pytest.raises(RuntimeError, match="ffmpeg is required for MP3 output .* not found on PATH"):
        transcode_wav_to_mp3(str(wav), str(tmp_path / "out.mp3"), ffmpeg_bin=str(tmp_path / "no-such-ffmpeg"))
