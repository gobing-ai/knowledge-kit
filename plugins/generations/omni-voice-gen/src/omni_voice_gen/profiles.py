"""Profile registry (D4): profile name -> clone / saved-prompt / instruct entry.

Registry source: OMNIVOICE_PROFILE_REGISTRY env, else <plugin>/profiles.json. Resolution is
case-insensitive by name; unknown names fail loud naming the profile and the registry path.
The D4 fallback chain (segment -> speaker -> script default -> VOICEBOX_DEFAULT_PROFILE -> doc
metadata voiceProfile) and plain-text clone-path handling belong to the pipeline (0125); this
module owns only load + resolve.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

REGISTRY_ENV_VAR = "OMNIVOICE_PROFILE_REGISTRY"
DEFAULT_REGISTRY_PATH = Path(__file__).resolve().parents[2] / "profiles.json"

ProfileKind = Literal["clone", "prompt", "instruct"]


@dataclass
class ProfileEntry:
    """One registry entry; exactly one field family is set (enforced at load time)."""

    kind: ProfileKind
    ref_audio: str | None = None
    ref_text: str | None = None
    prompt: str | None = None
    instruct: str | None = None


class ProfileRegistry(dict[str, ProfileEntry]):
    """Registry map carrying its source path so resolution errors can name it (task R1)."""

    def __init__(self, entries: dict[str, ProfileEntry], path: Path) -> None:
        super().__init__(entries)
        self.path = path


def _parse_entry(name: str, spec: object) -> ProfileEntry:
    def invalid(reason: str) -> ValueError:
        return ValueError(f'Profile "{name}" is invalid: {reason}')

    if not isinstance(spec, dict):
        raise invalid("entry must be a JSON object")
    ref_audio, ref_text = spec.get("ref_audio"), spec.get("ref_text")
    prompt, instruct = spec.get("prompt"), spec.get("instruct")
    families = sum([ref_audio is not None or ref_text is not None, prompt is not None, instruct is not None])
    if families != 1:
        raise invalid("exactly one of {ref_audio + ref_text, prompt, instruct} must be set")
    for value in (ref_audio, ref_text, prompt, instruct):
        if value is not None and not isinstance(value, str):
            raise invalid("entry values must be strings")
    if ref_audio is not None or ref_text is not None:
        if ref_audio is None or ref_text is None:
            raise invalid("clone profiles require both ref_audio and ref_text")
        return ProfileEntry(kind="clone", ref_audio=ref_audio, ref_text=ref_text)
    if prompt is not None:
        return ProfileEntry(kind="prompt", prompt=prompt)
    return ProfileEntry(kind="instruct", instruct=instruct)


def load_registry(path: Path | None = None) -> ProfileRegistry:
    """Load the registry JSON; fail loud on unreadable, malformed, or ambiguous content."""
    if path is None:
        env = os.environ.get(REGISTRY_ENV_VAR)
        path = Path(env) if env else DEFAULT_REGISTRY_PATH
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"cannot read profile registry at {path}: {exc.strerror or exc}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed profile registry JSON at {path}: {exc}") from exc
    if not isinstance(data, dict):
        # ValueError, not TypeError: every registry failure must funnel into the single
        # fail-loud exit path (same contract as contract.py parse errors).
        raise ValueError(  # noqa: TRY004
            f"profile registry at {path} must be a JSON object mapping profile names to entries"
        )
    entries = {name: _parse_entry(name, spec) for name, spec in data.items()}
    # Resolve relative asset paths against the registry's directory so backend passes
    # absolute paths to the engine regardless of process CWD.
    base = path.resolve().parent
    for entry in entries.values():
        if entry.ref_audio and not Path(entry.ref_audio).is_absolute():
            entry.ref_audio = str((base / entry.ref_audio).resolve())
        if entry.prompt and not Path(entry.prompt).is_absolute():
            entry.prompt = str((base / entry.prompt).resolve())
    lowered = [key.lower() for key in entries]
    if len(set(lowered)) != len(lowered):
        dupes = sorted({key for key in entries if lowered.count(key.lower()) > 1})
        raise ValueError(f"profile registry at {path} has case-insensitive duplicate names: {', '.join(dupes)}")
    return ProfileRegistry(entries, path)


def resolve_profile(name: str, registry: dict[str, ProfileEntry]) -> ProfileEntry:
    """Resolve by case-insensitive name; unknown -> ValueError naming profile + registry path."""
    lowered = name.lower()
    for key, entry in registry.items():
        if key.lower() == lowered:
            return entry
    path = getattr(registry, "path", "<in-memory registry>")
    raise ValueError(f'Unknown voice profile "{name}" in registry at {path}')
