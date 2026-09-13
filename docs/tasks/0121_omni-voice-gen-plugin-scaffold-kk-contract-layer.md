---
schema_version: 1
name: "omni-voice-gen: plugin scaffold + kk contract layer"
status: todo
template: feature-impl
created_at: 2026-09-13T05:54:10.265Z
updated_at: "2026-09-13T06:41:33.771Z"
feature_id: F611

ac_altitude: task-local
---

## 0121. omni-voice-gen: plugin scaffold + kk contract layer

### Background

Captured from the creation title: "omni-voice-gen: plugin scaffold + kk contract layer".

### Requirements

- [ ] R1. Plugin directory `plugins/generations/omni-voice-gen/` with `plugin.json`
    (`name: omni-voice-gen`, `kind: generator`, `entry: ./bin/omni-voice-gen`, `version: 1.0.0`);
    `kk plugin list` discovers it with no `package.json` present.
- [ ] R2. Executable `bin/omni-voice-gen` (shebang, chmod +x) that execs
    `uv run --project <plugin-dir> python -m omni_voice_gen "$@"`; CLI accepts `--in`/`--out`;
    missing either → exit 1 with `omni-voice-gen failed: Missing required arguments: --in and --out`
    on stderr (voice-gen parity).
- [ ] R3. `pyproject.toml` (uv project, dist name `omni-voice-gen`, module `omni_voice_gen`): runtime deps
    `omnivoice` (PyPI), `pyyaml`, `pydantic`; dev deps `pytest`, `pytest-cov`, `coverage`, `ruff`.
    `Makefile` targets: `sync`, `test`, `coverage`, `lint`.
- [ ] R4. `contract.py` pydantic models mirroring `@gobing-ai/kk-core` shapes exactly
    (packages/kk-core/src/schemas.ts): Doc requires ONLY `id` + `body` (title/sourceUri/mediaType/
    metadata optional, metadata = dict[str, Any]); Content requires `body` (title optional,
    format default "markdown", outline optional, references optional list of {url?,title?,cite?},
    metadata optional). Invalid or unparseable input → exit 1 with `Invalid DocList input: <reason>`.
    Empty `Doc[]` → notice Content (title "Notice", body "# Notice\nNo documents provided for
    generation.", format "markdown", references []), exit 0, no model load.
- [ ] R5. Coverage gate `make coverage`: per-file line AND function coverage >= 90% enforced by
    `scripts/coverage_gate.py` over `coverage` JSON output (see Design for the function-coverage
    definition — coverage.py has no native function metric).
- [ ] R6. No file in the plugin references or reads `vendors/OmniVoice` (reference-only per operator).

Out of scope: VoiceScript parsing (0122), backend (0123), audio/QC (0124), pipeline (0125),
workflow/docs (0126).

### Acceptance Criteria

```gherkin
Feature: omni-voice-gen scaffold and contract

  Scenario: Discovery without package.json
    Given plugins/generations/omni-voice-gen contains only plugin.json as its manifest
    When "kk plugin list" runs
    Then omni-voice-gen appears as a generator plugin with entry ./bin/omni-voice-gen

  Scenario: CLI argument contract
    When bin/omni-voice-gen runs without --in or --out
    Then exit code is 1 and stderr names the missing arguments

  Scenario: Empty input notice
    Given an empty Doc[] JSON input
    When the plugin runs
    Then it writes the notice Content, exits 0, and never imports torch/omnivoice
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-13T06:26:33.872Z

- Q: How is "function coverage >= 90%" measured in Python (a Bun-style metric)? A:
  scripts/coverage_gate.py (coverage.py data + ast def-line analysis) — frozen in Design/R5.
- Q: Entry form — console_script or wrapper? A: bash wrapper via `uv run --project`; the executor
  spawns the entry path directly, and a wrapper keeps the venv resolution inside uv (verified
  invoke.ts spawns non-.ts/.js entries as plain executables).
- Q: Which Doc fields are mandatory? A: only id + body (verified packages/kk-core/src/schemas.ts
  2026-09-12); earlier draft said title/sourceUri were required — corrected in R4.

### Design

WHAT/WHY: thinnest possible executable seam + contract layer every later task imports. The kk
executor spawns non-.ts/.js entries directly (apps/cli/src/invoke.ts pluginEntryCmd — verified
2026-09-12), so the bash wrapper is the entire integration surface.

WHERE / frozen names:
- `plugins/generations/omni-voice-gen/{plugin.json,pyproject.toml,Makefile,bin/omni-voice-gen,
  scripts/coverage_gate.py,src/omni_voice_gen/{__init__.py,__main__.py,contract.py},tests/}`
- `bin/omni-voice-gen`: `exec uv run --project "$(cd "$(dirname "$0")/.." && pwd)" python -m omni_voice_gen "$@"`
- contract.py: `Doc`, `Content` (pydantic BaseModel), `NOTICE_CONTENT`, `parse_doc_list(raw: str)
  -> list[Doc]`, `content_to_json(content: Content) -> str` (2-space indent, matching voice-gen output).
- `__main__.py`: argparse `--in`/`--out`; delegates to `pipeline.run` (0125) lazily imported so the
  empty-input path never touches torch. Exit codes: 0 success, 1 any failure with
  `omni-voice-gen failed: <msg>` on stderr (voice-gen main() parity).
- Function coverage (R5): `scripts/coverage_gate.py` loads `.coverage` via the coverage.py API,
  parses each source file with `ast`, and counts a function as covered when its `def` line executed
  AND >= 1 body line executed; per file: covered/total >= 0.90 for functions and covered lines >=
  0.90 (from coverage's own per-file percent), else exit 1 listing offenders. `make coverage` =
  `uv run pytest --cov=omni_voice_gen` then `uv run python scripts/coverage_gate.py`.

Anti-patterns (do NOT implement): no package.json/node shim; no click/typer dependency (argparse is
enough); no importing omnivoice/torch anywhere except backend.py (0123); no global config module —
env reads happen in the modules that own them (mp3.py, pipeline.py, backend.py).

Handoff: contract.py + entry + coverage gate are consumed unchanged by 0122–0125.

### Plan

1. Scaffold directory, plugin.json, pyproject.toml, Makefile, bin/omni-voice-gen (chmod +x).
2. contract.py models + notice-Content constant.
3. __main__.py argparse + exit-code mapping + lazy-import guard.
4. tests: discovery fixture, CLI arg errors, invalid input, empty-input notice (no torch import).
5. `kk plugin list` smoke; make coverage green.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: docs/features/F611_omnivoice-voice-generator-plugin-omni-voice-gen.md
- Spec: docs/design/omni-voice-gen.md (D1–D3, §2 layout)
- Contract source: packages/kk-core/src (Doc/Content schemas), plugins/generations/voice-gen/src/index.ts
- Executor spawn seam: apps/cli/src/invoke.ts (pluginEntryCmd)

### History

- 2026-09-13T06:41:33.771Z backlog → todo (system)

