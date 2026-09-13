"""WAV parse/concat with gaps + loudness-dip detector — Python port of voice-gen concat.ts
and the detectLoudnessDip half of qc.ts (spec layout: dip detection lives here, not qc.py).

D8.1 delta (bug fix, not a port): gaps_ms[i] is silence inserted BEFORE segment i. The
voice-gen `gapsMs[0] === 0 ? gapsMs[i] : gapsMs[i - 1]` special case is not replicated.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

# Dip thresholds — identical to voice-gen qc.ts (D7).
DIP_RATIO = 0.4
DIP_SILENCE_FLOOR = 0.008
DIP_ABS_CEILING = 0.06
DIP_NEIGHBOR_FLOOR = 0.02


@dataclass
class ParsedWav:
    audio_format: int
    num_channels: int
    sample_rate: int
    byte_rate: int
    block_align: int
    bits_per_sample: int
    data_bytes: bytes


def parse_wav(buffer: bytes) -> ParsedWav:
    """Parse a RIFF WAVE buffer into its format fields and raw audio data."""
    if len(buffer) < 44:
        raise ValueError("Invalid WAV buffer: buffer too short")

    riff_tag = buffer[0:4].decode("latin-1")
    wave_tag = buffer[8:12].decode("latin-1")
    if riff_tag != "RIFF" or wave_tag != "WAVE":
        raise ValueError(f"Invalid WAV buffer: expected RIFF/WAVE header, got {riff_tag}/{wave_tag}")

    offset = 12
    format_info: dict[str, int] | None = None
    data_bytes: bytes | None = None

    while offset + 8 <= len(buffer):
        chunk_id = buffer[offset : offset + 4].decode("latin-1")
        (chunk_size,) = struct.unpack_from("<I", buffer, offset + 4)
        chunk_data_offset = offset + 8

        if chunk_id == "fmt ":
            if chunk_size < 16:
                raise ValueError("Invalid WAV fmt chunk size")
            audio_format, num_channels, sample_rate, byte_rate, block_align, bits_per_sample = struct.unpack_from(
                "<HHIIHH", buffer, chunk_data_offset
            )
            format_info = {
                "audio_format": audio_format,
                "num_channels": num_channels,
                "sample_rate": sample_rate,
                "byte_rate": byte_rate,
                "block_align": block_align,
                "bits_per_sample": bits_per_sample,
            }
        elif chunk_id == "data":
            end = min(chunk_data_offset + chunk_size, len(buffer))
            data_bytes = buffer[chunk_data_offset:end]

        # Advance to next chunk (aligned to 2 bytes)
        offset = chunk_data_offset + chunk_size + (1 if chunk_size % 2 == 1 else 0)

    if format_info is None:
        raise ValueError('Invalid WAV: missing "fmt " chunk')
    if data_bytes is None:
        raise ValueError('Invalid WAV: missing "data" chunk')

    return ParsedWav(**format_info, data_bytes=data_bytes)


def concat_wavs(wav_buffers: list[bytes], gaps_ms: list[int] | None = None) -> bytes:
    """Concatenate WAV buffers in order; gaps_ms[i] is silence inserted before segment i (D8.1)."""
    if not wav_buffers:
        return b""

    gaps = gaps_ms or []
    parsed_wavs = [parse_wav(buf) for buf in wav_buffers]
    first = parsed_wavs[0]

    # Verify format compatibility
    for i in range(1, len(parsed_wavs)):
        current = parsed_wavs[i]
        if current.sample_rate != first.sample_rate:
            raise ValueError(
                f"WAV sample rate mismatch: expected {first.sample_rate} Hz, got {current.sample_rate} Hz"
            )
        if (
            current.audio_format != first.audio_format
            or current.num_channels != first.num_channels
            or current.bits_per_sample != first.bits_per_sample
        ):
            raise ValueError(
                f"WAV format mismatch between segment 0 and segment {i}: format {first.audio_format} vs "
                f"{current.audio_format}, channels {first.num_channels} vs {current.num_channels}, bits "
                f"{first.bits_per_sample} vs {current.bits_per_sample}"
            )

    # Compute total combined data length
    total_data_length = 0
    pieces: list[bytes] = []

    for i, wav in enumerate(parsed_wavs):
        if i > 0:
            gap = gaps[i] if i < len(gaps) else 0
            if gap > 0:
                num_gap_bytes = int(first.sample_rate * (gap / 1000)) * first.block_align
                if num_gap_bytes > 0:
                    pieces.append(bytes(num_gap_bytes))
                    total_data_length += num_gap_bytes
        pieces.append(wav.data_bytes)
        total_data_length += len(wav.data_bytes)

    # Build the consolidated WAV buffer
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + total_data_length,
        b"WAVE",
        b"fmt ",
        16,
        first.audio_format,
        first.num_channels,
        first.sample_rate,
        first.byte_rate,
        first.block_align,
        first.bits_per_sample,
        b"data",
        total_data_length,
    )
    return header + b"".join(pieces)


def detect_loudness_dip(wav: bytes) -> tuple[bool, float | None]:
    """Detect a 'collapsed-volume' window: center RMS dips vs both neighbors.

    Returns (dip, dip_at_sec). Any parse failure -> (False, None): a dip check must
    never crash the run (voice-gen parity).
    """
    try:
        parsed = parse_wav(wav)
        if parsed.bits_per_sample != 16 or parsed.num_channels < 1 or len(parsed.data_bytes) < 2:
            return False, None

        data = parsed.data_bytes
        total_frames = len(data) // parsed.block_align
        window_frames = parsed.sample_rate  # 1s windows
        if total_frames < window_frames * 5:
            return False, None
        n_wins = total_frames // window_frames
        if n_wins < 7:
            return False, None

        bytes_per_frame = parsed.block_align
        bytes_per_window = window_frames * bytes_per_frame

        def window_rms(win_idx: int) -> float:
            start = win_idx * bytes_per_window
            sum_sq = 0.0
            count = 0
            for off in range(start, start + bytes_per_window, bytes_per_frame):
                (sample,) = struct.unpack_from("<h", data, off)
                value = sample / 32768.0
                sum_sq += value * value
                count += 1
            return (sum_sq / count) ** 0.5 if count else 0.0

        rms = [window_rms(i) for i in range(n_wins)]
        for j in range(1, n_wins - 1):
            prev_rms = rms[j - 1]
            center = rms[j]
            next_rms = rms[j + 1]
            nbr = max(prev_rms, next_rms)
            if (
                center > DIP_SILENCE_FLOOR
                and center < DIP_ABS_CEILING
                and nbr > DIP_NEIGHBOR_FLOOR
                and center < nbr * DIP_RATIO
            ):
                return True, round(j + 0.5, 2)
        return False, None
    except Exception:  # noqa: BLE001 — a dip check must never crash the run (voice-gen parity)
        return False, None
