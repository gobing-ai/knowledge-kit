"""Contract behavior: kk-core parity, parse errors, notice content, JSON shape."""

import json

import pytest

from omni_voice_gen.contract import (
    NOTICE_CONTENT,
    Content,
    Doc,
    Reference,
    content_to_json,
    parse_doc_list,
)


def test_doc_requires_only_id_and_body() -> None:
    doc = Doc(id="d1", body="hello")
    assert doc.title is None
    assert doc.sourceUri is None
    assert doc.mediaType is None
    assert doc.metadata is None


def test_doc_rejects_missing_body() -> None:
    with pytest.raises(ValueError):  # pydantic ValidationError subclasses ValueError
        Doc(id="d1")


def test_doc_ignores_unknown_fields() -> None:
    doc = Doc.model_validate({"id": "d1", "body": "b", "extra": {"x": 1}})
    assert doc.id == "d1"


def test_content_format_defaults_to_markdown() -> None:
    assert Content(body="b").format == "markdown"


def test_content_reference_fields_are_all_optional() -> None:
    assert Content(body="b", references=[{}]).references == [Reference()]


def test_notice_content_shape() -> None:
    assert NOTICE_CONTENT.title == "Notice"
    assert NOTICE_CONTENT.body == "# Notice\nNo documents provided for generation."
    assert NOTICE_CONTENT.format == "markdown"
    assert NOTICE_CONTENT.references == []


def test_parse_doc_list_roundtrip() -> None:
    raw = json.dumps([{"id": "d1", "body": "b", "metadata": {"k": None}}])
    docs = parse_doc_list(raw)
    assert [d.id for d in docs] == ["d1"]
    assert docs[0].metadata == {"k": None}


def test_parse_doc_list_rejects_invalid_json() -> None:
    with pytest.raises(ValueError, match="not valid JSON"):
        parse_doc_list("{nope")


def test_parse_doc_list_rejects_non_array() -> None:
    with pytest.raises(ValueError, match="JSON array"):
        parse_doc_list(json.dumps({"id": "d1"}))


def test_parse_doc_list_rejects_invalid_doc() -> None:
    with pytest.raises(ValueError, match="Doc validation failed"):
        parse_doc_list(json.dumps([{"id": "d1"}]))  # body missing


def test_content_to_json_two_space_indent_without_nulls() -> None:
    text = content_to_json(Content(body="hi", references=[]))
    assert '\n  "body"' in text
    assert json.loads(text) == {"body": "hi", "format": "markdown", "references": []}
