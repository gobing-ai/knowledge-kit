---
schema_version: 1
name: "omni-voice-gen: plugin scaffold + kk contract layer"
status: done
template: feature-impl
created_at: 2026-09-13T05:54:10.265Z
updated_at: "2026-09-13T19:53:48.648Z"
feature_id: F611

ac_altitude: task-local
---

## 0121. omni-voice-gen: plugin scaffold + kk contract layer

### Background

Captured from the creation title: "omni-voice-gen: plugin scaffold + kk contract layer".

### Requirements

- [x] R1. Plugin directory `plugins/generations/omni-voice-gen/` with `plugin.json`
    (`name: omni-voice-gen`, `kind: generator`, `entry: ./bin/omni-voice-gen`, `version: 1.0.0`);
    `kk plugin list` discovers it with no `package.json` present.
- [x] R2. Executable `bin/omni-voice-gen` (shebang, chmod +x) that execs
    `uv run --project <plugin-dir> python -m omni_voice_gen "$@"`; CLI accepts `--in`/`--out`;
    missing either → exit 1 with `omni-voice-gen failed: Missing required arguments: --in and --out`
    on stderr (voice-gen parity).
- [x] R3. `pyproject.toml` (uv project, dist name `omni-voice-gen`, module `omni_voice_gen`): runtime deps
    `omnivoice` (PyPI), `pyyaml`, `pydantic`; dev deps `pytest`, `pytest-cov`, `coverage`, `ruff`.
    `Makefile` targets: `sync`, `test`, `coverage`, `lint`.
- [x] R4. `contract.py` pydantic models mirroring `@gobing-ai/kk-core` shapes exactly
    (packages/kk-core/src/schemas.ts): Doc requires ONLY `id` + `body` (title/sourceUri/mediaType/
    metadata optional, metadata = dict[str, Any]); Content requires `body` (title optional,
    format default "markdown", outline optional, references optional list of {url?,title?,cite?},
    metadata optional). Invalid or unparseable input → exit 1 with `Invalid DocList input: <reason>`.
    Empty `Doc[]` → notice Content (title "Notice", body "# Notice\nNo documents provided for
    generation.", format "markdown", references []), exit 0, no model load.
- [x] R5. Coverage gate `make coverage`: per-file line AND function coverage >= 90% enforced by
    `scripts/coverage_gate.py` over `coverage` JSON output (see Design for the function-coverage
    definition — coverage.py has no native function metric).
- [x] R6. No file in the plugin references or reads `vendors/OmniVoice` (reference-only per operator).

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

#### Q&A

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

#### Design

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

#### Plan

1. Scaffold directory, plugin.json, pyproject.toml, Makefile, bin/omni-voice-gen (chmod +x).
2. contract.py models + notice-Content constant.
3. __main__.py argparse + exit-code mapping + lazy-import guard.
4. tests: discovery fixture, CLI arg errors, invalid input, empty-input notice (no torch import).
5. `kk plugin list` smoke; make coverage green.

#### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

#### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

#### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

#### References

- Feature: docs/features/F611_omnivoice-voice-generator-plugin-omni-voice-gen.md
- Spec: docs/design/omni-voice-gen.md (D1–D3, §2 layout)
- Contract source: packages/kk-core/src (Doc/Content schemas), plugins/generations/voice-gen/src/index.ts
- Executor spawn seam: apps/cli/src/invoke.ts (pluginEntryCmd)

#### History

- 2026-09-13T06:41:33.771Z backlog → todo (system)

- [x] (covers: Drop-in CLI surface; Empty input and MP3 parity) Executor-spawned --in/--out entry with notice Content on empty Doc[]

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

**Scope found:** the Python plugin scaffold half of this task already landed in f2bb761
(plugin.json, bin/omni-voice-gen, contract.py, __main__.py, tests, coverage gate). The remaining
slice — the kk-core `omniVoiceGenContentSchema` — was missing and is delivered here.

**Change map:**

- `packages/kk-core/src/schemas.ts:49` — new `omniVoiceGenContentSchema` (ContentSchema extended
  with `format: z.literal('audio')` and generator-pinned `metadata`: `generator:
  'kk:omni-voice-gen'` literal, `audioPath`, `duration`, `segments[]` per
  docs/design/omni-voice-gen.md §4, optional `mp3Path`/`qc`; loose objects so QC/segment detail
  may grow) + inferred `OmniVoiceGenContent` type at `packages/kk-core/src/schemas.ts:79`.
- `packages/kk-core/src/index.ts:44` — export schema + type.
- `packages/kk-core/tests/schemas.test.ts:38` — accepts a valid omni audio Content; rejects
  `metadata.generator !== 'kk:omni-voice-gen'` (`:55`); rejects non-audio format / missing
  audioPath (`:73`).
- `packages/kk-core/tests/registry.test.ts:209` and `:528` — added `omni-voice-gen` to the two
  shipped-plugin expectation lists (pre-existing failure from f2bb761's scaffold; fixed at the
  shared expectation, root cause not symptom).
- `docs/04_DESIGN.md:359` — kk-core surface row now lists `omniVoiceGenContentSchema` (T3
  same-commit).

**Verification:** `bun test` in packages/kk-core — 62 pass / 0 fail (incl. 2 previously red
registry tests); root `bun run lint` — clean (biome + typecheck).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/generations/omni-voice-gen/ contains plugin.json, bin/omni-voice-gen (mode 755), pyproject.toml, Makefile, src/omni_voice_gen/{__init__,__main__,contract}.py, scripts/coverage_gate.py, tests/, .python-version (commit f2bb761) |
| R2 | MET | Live: ./bin/omni-voice-gen (no args) → stderr "Missing required arguments: --in and --out", exit 1; empty [] input → exit 0, out = Notice Content "# Notice\nNo documents provided for generation." matching contract.py NOTICE_CONTENT (re-verified live at record time) |
| R3 | MET | `kk plugin list` → "omni-voice-gen (v1.0.0): ./bin/omni-voice-gen [healthy]" under generators (re-verified live) |
| R4 | MET | contract.py Doc {id, body, title?, sourceUri?, mediaType?, metadata?} and Content {body, title?, format="markdown", outline?, references?, metadata?} mirror packages/kk-core/src/schemas.ts field-for-field; violations raise ValueError funneled to the single "Invalid DocList input:" exit path; parity tests in tests/test_contract.py |
| R5 | MET | `make test` → 21 passed; `make coverage` → 97% line, "coverage_gate: PASS (line and function coverage >= 90% per file)"; `make lint` → ruff clean (re-ran make test at record time: 21 passed) |
| R6 | MET | No vendors/ directory; tests/test_plugin_manifest.py::test_no_file_references_vendors_omnivoice guards the no-vendoring constraint |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-03 contract mirror + parity test | MET | test | tests/test_contract.py (within 21 passing) |
| AC-04 coverage gate 90/90 | MET | test | scripts/coverage_gate.py enforces per-file line+function >= 90%; run reports 97% line, PASS |
| AC-05 make test green | MET | test | 21 passed in 0.58s |
| AC-06 kk-core omniVoiceGenContentSchema | MET | test | packages/kk-core/src/schemas.ts exports omniVoiceGenContentSchema (format "audio", generator kk:omni-voice-gen, audioPath/duration/segments, mp3Path?, qc?) matching docs/design/omni-voice-gen.md; `cd packages/kk-core && bun test` → 62 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P1 | ac-row-dropped | — | 2 AC row(s) could not be parsed and were omitted from the verdict: AC-01 kk plugin list discovers generator (unrecognised evidence type "live"); AC-02 CLI error/stub behavior (unrecognised evidence type "live"). Accepted evidence types: test, command, static-ref (aliases: static, doc, docs, documentation), manual-review, llm-judge, n/a. Accepted statuses: MET, PARTIAL, UNMET, N/A. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: docs/features/F611_omnivoice-voice-generator-plugin-omni-voice-gen.md
- Spec: docs/design/omni-voice-gen.md (D1–D3, §2 layout)
- Contract source: packages/kk-core/src (Doc/Content schemas), plugins/generations/voice-gen/src/index.ts
- Executor spawn seam: apps/cli/src/invoke.ts (pluginEntryCmd)

### History

- 2026-09-13T06:41:33.771Z backlog → todo (system)

- [x] (covers: Drop-in CLI surface; Empty input and MP3 parity) Executor-spawned --in/--out entry with notice Content on empty Doc[]
- 2026-09-13T19:53:48.648Z testing → done (system)

### Notes

- Docs sync (T3): surface changes keep `docs/04_DESIGN.md` updated in the same commit as the new `plugins/generations/omni-voice-gen/` generator.

