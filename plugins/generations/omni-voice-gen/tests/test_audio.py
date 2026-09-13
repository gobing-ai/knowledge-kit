"""audio.py: WAV parse/concat with D8.1 gap placement + loudness-dip detector."""

import struct

import pytest

from omni_voice_gen.audio import concat_wavs, detect_loudness_dip, parse_wav


def wav_bytes(
    data: bytes,
    sample_rate: int = 1000,
    num_channels: int = 1,
    bits_per_sample: int = 16,
    audio_format: int = 1,
) -> bytes:
    block_align = num_channels * bits_per_sample // 8
    byte_rate = sample_rate * block_align
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        audio_format,
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        len(data),
    ) + data


def pcm(*values: int) -> bytes:
    return struct.pack(f"<{len(values)}h", *values)


def constant_wav(value: int, frames: int, sample_rate: int = 1000) -> bytes:
    return wav_bytes(pcm(*([value] * frames)), sample_rate=sample_rate)


def dip_wav(dip_index: int = 2, n_wins: int = 7, sample_rate: int = 1000) -> bytes:
    """One 1s window per entry; window `dip_index` collapses vs both neighbors."""
    frames = b""
    for i in range(n_wins):
        value = 1000 if i == dip_index else 10000
        frames += pcm(*([value] * sample_rate))
    return wav_bytes(frames, sample_rate=sample_rate)


# --- parse_wav ---


def test_parse_wav_roundtrip_fields() -> None:
    parsed = parse_wav(wav_bytes(pcm(1, 2, 3), sample_rate=24000, num_channels=2))
    assert parsed.audio_format == 1
    assert parsed.num_channels == 2
    assert parsed.sample_rate == 24000
    assert parsed.byte_rate == 24000 * 2 * 2
    assert parsed.block_align == 4
    assert parsed.bits_per_sample == 16
    assert parsed.data_bytes == pcm(1, 2, 3)


def test_parse_wav_buffer_too_short() -> None:
    with pytest.raises(ValueError, match="buffer too short"):
        parse_wav(b"RIFF")


def test_parse_wav_bad_riff_tag() -> None:
    bad = b"RIFX" + wav_bytes(b"")[4:]
    with pytest.raises(ValueError, match="expected RIFF/WAVE header, got RIFX/WAVE"):
        parse_wav(bad)


def test_parse_wav_bad_wave_tag() -> None:
    bad = bytearray(wav_bytes(b""))
    bad[8:12] = b"XXXX"
    with pytest.raises(ValueError, match="expected RIFF/WAVE header, got RIFF/XXXX"):
        parse_wav(bytes(bad))


def test_parse_wav_fmt_chunk_too_small() -> None:
    buf = struct.pack("<4sI4s4sI", b"RIFF", 4 + 8 + 8, b"WAVE", b"fmt ", 8) + b"\x00" * 24
    with pytest.raises(ValueError, match="Invalid WAV fmt chunk size"):
        parse_wav(buf)


def test_parse_wav_missing_fmt() -> None:
    buf = struct.pack("<4sI4s4sI", b"RIFF", 4 + 8 + 2, b"WAVE", b"data", 2) + b"\x00" * 26
    with pytest.raises(ValueError, match='missing "fmt " chunk'):
        parse_wav(buf)


def test_parse_wav_missing_data() -> None:
    fmt_only = struct.pack(
        "<4sI4s4sIHHIIHH",
        b"RIFF",
        4 + 8 + 16 + 8,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        1000,
        2000,
        2,
        16,
    ) + b"\x00" * 8  # pad past the 44-byte minimum with a zeroed trailing chunk
    with pytest.raises(ValueError, match='missing "data" chunk'):
        parse_wav(fmt_only)


def test_parse_wav_skips_unknown_and_odd_sized_chunks() -> None:
    junk = b"JUNK" + struct.pack("<I", 3) + b"abc" + b"\x00"  # odd size + pad byte
    base = wav_bytes(pcm(7, 8))
    with_junk = base[:12] + junk + base[12:]
    parsed = parse_wav(with_junk)
    assert parsed.sample_rate == 1000
    assert parsed.data_bytes == pcm(7, 8)


def test_parse_wav_data_before_fmt() -> None:
    base = wav_bytes(pcm(9))
    data_chunk = b"data" + struct.pack("<I", 2) + pcm(9)
    buf = base[:12] + data_chunk + base[12:36]  # fmt chunk is 24 bytes (8 header + 16 payload)
    parsed = parse_wav(buf)
    assert parsed.data_bytes == pcm(9)
    assert parsed.sample_rate == 1000


# --- concat_wavs ---


def test_concat_empty_returns_empty() -> None:
    assert concat_wavs([]) == b""


def test_concat_joins_data_and_writes_header() -> None:
    out = concat_wavs([wav_bytes(pcm(1, 2)), wav_bytes(pcm(3, 4))])
    parsed = parse_wav(out)
    assert parsed.data_bytes == pcm(1, 2, 3, 4)
    assert parsed.sample_rate == 1000
    assert struct.unpack_from("<I", out, 4)[0] == 36 + len(parsed.data_bytes)


def test_concat_inserts_gap_before_segment_i() -> None:
    # gaps_ms[i] is silence BEFORE segment i (D8.1): 500ms at rate 1000 -> 500 frames -> 1000 bytes.
    out = concat_wavs([wav_bytes(pcm(1, 2)), wav_bytes(pcm(3, 4))], gaps_ms=[0, 500])
    parsed = parse_wav(out)
    assert parsed.data_bytes == pcm(1, 2) + bytes(1000) + pcm(3, 4)


def test_concat_gap_slot_zero_means_no_gap_for_segment_one() -> None:
    # D8.1 regression: voice-gen's gapsMs[0]===0 special case shifted indices; here
    # gaps_ms=[500, 0] must NOT insert 500ms before segment 1.
    out = concat_wavs([wav_bytes(pcm(1, 2)), wav_bytes(pcm(3, 4))], gaps_ms=[500, 0])
    assert parse_wav(out).data_bytes == pcm(1, 2, 3, 4)


def test_concat_missing_gap_slots_default_to_zero() -> None:
    out = concat_wavs([wav_bytes(pcm(1)), wav_bytes(pcm(2)), wav_bytes(pcm(3))])
    assert parse_wav(out).data_bytes == pcm(1, 2, 3)


def test_concat_zero_byte_gap_skipped() -> None:
    # floor(1 * 0.5) == 0 frames of silence -> no gap piece
    out = concat_wavs([wav_bytes(pcm(1), sample_rate=1), wav_bytes(pcm(2), sample_rate=1)], gaps_ms=[0, 500])
    assert parse_wav(out).data_bytes == pcm(1, 2)


def test_concat_sample_rate_mismatch_raises() -> None:
    with pytest.raises(ValueError, match=r"sample rate mismatch: expected 1000 Hz, got 2000 Hz"):
        concat_wavs([wav_bytes(pcm(1)), wav_bytes(pcm(2), sample_rate=2000)])


def test_concat_format_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="WAV format mismatch between segment 0 and segment 1"):
        concat_wavs([wav_bytes(pcm(1)), wav_bytes(pcm(2), num_channels=2)])


# --- detect_loudness_dip ---


def test_dip_detected_with_timestamp() -> None:
    dip, dip_at = detect_loudness_dip(dip_wav(dip_index=2))
    assert dip is True
    assert dip_at == 2.5


def test_dip_steady_loudness_is_clean() -> None:
    assert detect_loudness_dip(constant_wav(10000, 7000)) == (False, None)


def test_dip_short_wav_is_clean() -> None:
    assert detect_loudness_dip(constant_wav(10000, 4000)) == (False, None)


def test_dip_under_seven_windows_is_clean() -> None:
    assert detect_loudness_dip(dip_wav(n_wins=6)) == (False, None)


def test_dip_non_16bit_is_clean() -> None:
    assert detect_loudness_dip(wav_bytes(b"\x80" * 8000, bits_per_sample=8)) == (False, None)


def test_dip_invalid_wav_is_clean() -> None:
    assert detect_loudness_dip(b"not a wav") == (False, None)


def test_dip_tiny_data_is_clean() -> None:
    assert detect_loudness_dip(wav_bytes(b"\x00")) == (False, None)
