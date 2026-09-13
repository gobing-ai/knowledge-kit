"""Discovery contract: manifest fields, executable wrapper entry, vendor isolation (R1/R2/R6)."""

import json
import os
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]


def test_manifest_fields_match_frozen_names() -> None:
    manifest = json.loads((PLUGIN_DIR / "plugin.json").read_text(encoding="utf-8"))
    assert manifest == {
        "name": "omni-voice-gen",
        "kind": "generator",
        "entry": "./bin/omni-voice-gen",
        "version": "1.0.0",
    }


def test_no_package_json_manifest() -> None:
    # R1: discovery must work with plugin.json as the only manifest.
    assert not (PLUGIN_DIR / "package.json").exists()


def test_entry_is_executable_uv_wrapper() -> None:
    entry = PLUGIN_DIR / "bin" / "omni-voice-gen"
    assert entry.exists()
    assert os.access(entry, os.X_OK)
    text = entry.read_text(encoding="utf-8")
    assert text.startswith("#!")
    assert "uv run --project" in text
    assert "python -m omni_voice_gen" in text


def test_no_file_references_vendors_omnivoice() -> None:
    for path in PLUGIN_DIR.rglob("*"):
        if not path.is_file() or ".venv" in path.parts or "__pycache__" in path.parts:
            continue
        # Split so this file does not contain the forbidden literal itself.
        needle = "vendors/" + "OmniVoice"
        assert needle not in path.read_text(encoding="utf-8", errors="replace"), path
