.PHONY: sync test coverage lint

sync:
	uv sync

test:
	uv run pytest -q

coverage:
	uv run pytest --cov=omni_voice_gen -q
	uv run python scripts/coverage_gate.py

lint:
	uv run ruff check src tests scripts
