"""Pydantic contract mirroring @gobing-ai/kk-core Doc/Content (packages/kk-core/src/schemas.ts).

Doc requires only `id` + `body`; Content requires `body` with `format` defaulting to
"markdown". Unknown fields are ignored (zod-strip parity). Every violation surfaces as
ValueError so __main__ maps it onto the single fail-loud exit path.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ValidationError


class Reference(BaseModel):
    """Optional citation entry inside Content.references."""

    url: str | None = None
    title: str | None = None
    cite: str | None = None


class Doc(BaseModel):
    """One ingested document; `body` is the primary text/markdown payload."""

    id: str
    body: str
    title: str | None = None
    sourceUri: str | None = None
    mediaType: str | None = None
    metadata: dict[str, Any] | None = None


class Content(BaseModel):
    """Generator output validated by the kk executor's ContentSchema."""

    body: str
    title: str | None = None
    format: str = "markdown"
    outline: str | None = None
    references: list[Reference] | None = None
    metadata: dict[str, Any] | None = None


NOTICE_CONTENT = Content(
    title="Notice",
    body="# Notice\nNo documents provided for generation.",
    format="markdown",
    references=[],
)


def parse_doc_list(raw: str) -> list[Doc]:
    """Parse a Doc[] JSON string; raise ValueError carrying the reason on any violation."""
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"input is not valid JSON: {exc.msg} at line {exc.lineno} column {exc.colno}") from exc
    if not isinstance(value, list):
        # ValueError, not TypeError: every parse failure must funnel into the single
        # `Invalid DocList input:` exit path (task R4 contract).
        raise ValueError(  # noqa: TRY004
            f"input must be a JSON array of Doc objects, got {type(value).__name__}"
        )
    try:
        return [Doc.model_validate(item) for item in value]
    except ValidationError as exc:
        first = exc.errors()[0]
        loc = ".".join(str(part) for part in first.get("loc", ())) or "root"
        raise ValueError(f"Doc validation failed at [{loc}]: {first['msg']}") from exc


def content_to_json(content: Content) -> str:
    """2-space-indent JSON with nulls dropped — voice-gen JSON.stringify output parity."""
    return json.dumps(content.model_dump(exclude_none=True), ensure_ascii=False, indent=2)
