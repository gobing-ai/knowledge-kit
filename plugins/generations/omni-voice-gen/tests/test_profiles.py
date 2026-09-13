"""Profile registry behavior: load, case-insensitive resolve, error surfaces, env override."""

import json
from pathlib import Path

import pytest

from omni_voice_gen.profiles import (
    ProfileEntry,
    ProfileRegistry,
    load_registry,
    resolve_profile,
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OMNIVOICE_PROFILE_REGISTRY", raising=False)


def _write_registry(tmp_path: Path, data: object) -> Path:
    path = tmp_path / "profiles.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_load_registry_resolves_all_kinds(tmp_path: Path) -> None:
    path = _write_registry(
        tmp_path,
        {
            "cloner": {"ref_audio": "a.wav", "ref_text": "t"},
            "saved": {"prompt": "p.pt"},
            "narrator": {"instruct": "calm"},
        },
    )
    registry = load_registry(path)
    assert isinstance(registry, ProfileRegistry) and registry.path == path
    assert registry["cloner"] == ProfileEntry(kind="clone", ref_audio="a.wav", ref_text="t")
    assert registry["saved"] == ProfileEntry(kind="prompt", prompt="p.pt")
    assert registry["narrator"] == ProfileEntry(kind="instruct", instruct="calm")


def test_load_registry_env_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = _write_registry(tmp_path, {"envprof": {"instruct": "from env"}})
    monkeypatch.setenv("OMNIVOICE_PROFILE_REGISTRY", str(path))
    assert load_registry()["envprof"].instruct == "from env"


def test_load_registry_default_sample_file_is_valid() -> None:
    registry = load_registry()
    assert {e.kind for e in registry.values()} == {"clone", "prompt", "instruct"}


def test_malformed_registry_json_fails_loud(tmp_path: Path) -> None:
    path = tmp_path / "profiles.json"
    path.write_text("{nope", encoding="utf-8")
    with pytest.raises(ValueError, match=f"Malformed profile registry JSON at {path}"):
        load_registry(path)


def test_non_object_registry_fails_loud(tmp_path: Path) -> None:
    path = _write_registry(tmp_path, ["not", "an", "object"])
    with pytest.raises(ValueError, match="must be a JSON object mapping profile names to entries"):
        load_registry(path)


def test_unreadable_registry_fails_loud(tmp_path: Path) -> None:
    missing = tmp_path / "missing.json"
    with pytest.raises(ValueError, match=f"cannot read profile registry at {missing}"):
        load_registry(missing)


def test_clone_entry_requires_both_ref_fields(tmp_path: Path) -> None:
    path = _write_registry(tmp_path, {"broken": {"ref_audio": "a.wav"}})
    with pytest.raises(ValueError, match='Profile "broken" is invalid: clone profiles require both'):
        load_registry(path)


def test_entry_rejects_mixed_empty_nonstr_and_nondict(tmp_path: Path) -> None:
    cases = [
        ({"mixed": {"ref_audio": "a", "ref_text": "t", "instruct": "x"}}, "exactly one of"),
        ({"empty": {}}, "exactly one of"),
        ({"nonstr": {"instruct": 42}}, "must be strings"),
        ({"nondict": "nope"}, "must be a JSON object"),
    ]
    for i, (data, reason) in enumerate(cases):
        path = _write_registry(tmp_path / str(i), data)
        with pytest.raises(ValueError, match=reason):
            load_registry(path)


def test_case_insensitive_duplicate_names_fail_loud(tmp_path: Path) -> None:
    path = _write_registry(tmp_path, {"Narrator": {"instruct": "a"}, "narrator": {"instruct": "b"}})
    with pytest.raises(ValueError, match="case-insensitive duplicate names"):
        load_registry(path)


def test_resolve_is_case_insensitive(tmp_path: Path) -> None:
    path = _write_registry(tmp_path, {"Narrator": {"instruct": "calm"}})
    registry = load_registry(path)
    for name in ("Narrator", "narrator", "NARRATOR"):
        assert resolve_profile(name, registry).kind == "instruct"


def test_resolve_unknown_names_profile_and_registry_path(tmp_path: Path) -> None:
    path = _write_registry(tmp_path, {"known": {"instruct": "x"}})
    with pytest.raises(ValueError, match=f'Unknown voice profile "ghost" in registry at {path}'):
        resolve_profile("ghost", load_registry(path))


def test_resolve_unknown_with_plain_dict_registry() -> None:
    with pytest.raises(ValueError, match='Unknown voice profile "ghost" in registry at'):
        resolve_profile("ghost", {})
