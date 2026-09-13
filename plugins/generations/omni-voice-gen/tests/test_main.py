"""CLI contract: argument errors, invalid input, empty-input notice without torch."""

import json
import sys
import types

from omni_voice_gen.__main__ import main
from omni_voice_gen.contract import Content


def test_missing_arguments_exit_1(capsys) -> None:
    assert main([]) == 1
    err = capsys.readouterr().err
    assert "omni-voice-gen failed: Missing required arguments: --in and --out" in err


def test_missing_out_alone_maps_to_same_message(capsys) -> None:
    assert main(["--in", "whatever"]) == 1
    assert "Missing required arguments: --in and --out" in capsys.readouterr().err


def test_unreadable_input_exit_1(capsys, tmp_path) -> None:
    rc = main(["--in", str(tmp_path / "gone.json"), "--out", str(tmp_path / "out.json")])
    assert rc == 1
    assert "cannot read input" in capsys.readouterr().err


def test_invalid_doc_list_exit_1(capsys, tmp_path) -> None:
    src = tmp_path / "in.json"
    src.write_text("not json", encoding="utf-8")
    rc = main(["--in", str(src), "--out", str(tmp_path / "out.json")])
    assert rc == 1
    assert "Invalid DocList input:" in capsys.readouterr().err


def test_empty_doc_list_writes_notice_without_torch(tmp_path) -> None:
    src = tmp_path / "in.json"
    src.write_text("[]", encoding="utf-8")
    out = tmp_path / "out.json"
    assert main(["--in", str(src), "--out", str(out)]) == 0
    parsed = json.loads(out.read_text(encoding="utf-8"))
    assert parsed["title"] == "Notice"
    assert parsed["body"] == "# Notice\nNo documents provided for generation."
    assert parsed["format"] == "markdown"
    assert parsed["references"] == []
    # AC: the empty path never imports the model stack.
    assert "torch" not in sys.modules
    assert "omnivoice" not in sys.modules


def test_nonempty_input_delegates_to_pipeline(monkeypatch, tmp_path) -> None:
    calls: list[list] = []

    def fake_run(docs):
        calls.append(docs)
        return Content(body=f"got {len(docs)}")

    monkeypatch.setitem(sys.modules, "omni_voice_gen.pipeline", types.SimpleNamespace(run=fake_run))
    src = tmp_path / "in.json"
    src.write_text(json.dumps([{"id": "d1", "body": "b"}]), encoding="utf-8")
    out = tmp_path / "out.json"
    assert main(["--in", str(src), "--out", str(out)]) == 0
    assert calls and calls[0][0].id == "d1"
    assert json.loads(out.read_text(encoding="utf-8"))["body"] == "got 1"
