---
template: standard
schema_version: 1
name: "Wire and dry-run the E2E vertical workflow"
description: ""
status: done
type: task
profile: standard
feature_id: B5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0015", "0023", "0025"]
created_at: "2026-07-30T23:48:59.810Z"
updated_at: "2026-08-02T23:19:05.254Z"
---

## 0026. Wire and dry-run the E2E vertical workflow

### Background



### Requirements
- R1. Workflow vars in the vertical run are set to `karakeep-local` / `content-gen` / `surfdash-pub` with a real fixture source folder.
- R2. The workflow validates (`spur workflow validate`) and a staged dry-run confirms each step's IO contract chaining (docs.json → content.json → result.json).
- R3. The fixture Karakeep item and work dir live under a gitignored scratch path.
### Acceptance Criteria
```gherkin
Feature: End-to-end pipeline acceptance

  Scenario: R2 — Acceptance is platform composition, not a new plugin kind
    Given the platform composes plugins via spur workflow
    When the vertical is defined
    Then it is expressed as a workflow over B3 invoke + C2/D2/E3
    And no fourth plugin kind is introduced
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

Configured `.spur/workflows/kk-ingest-generate-publish.yaml` to chain `karakeep-local` (ingest) -> `content-gen` (generator) -> `surfdash-pub` (publish) using `knowledge-kit invoke`.

### Plan

- [x] Validate workflow definition with `spur workflow validate`
- [x] Test workflow dry-run transition sequence
- [x] Verify fixture path isolation under `.tmp` / `scratch`

### Solution

- Validated `.spur/workflows/kk-ingest-generate-publish.yaml:1` using `spur workflow validate`.
- Executed `spur workflow run .spur/workflows/kk-ingest-generate-publish.yaml:1 --dry-run` to confirm state transition sequence: `ingest` -> `generate` -> `publish` -> `done`.
- Verified IO chaining paths (docs.json -> content.json -> result.json) using `scratch/e2e/source` and `scratch/e2e/work`.

### Testing
- Verdict: **PASS** (re-verified under `--force`; all commands re-run fresh this turn)
- Commands run (fresh evidence):
  - `spur workflow validate .spur/workflows/kk-ingest-generate-publish.yaml` → "workflow valid: kk-ingest-generate-publish", exit 0.
  - `spur workflow run … --dry-run --vars '{"source":"./scratch/e2e/source","work_dir":"./scratch/e2e/work","plugins_root":"./plugins"}'` → plan `ingest → generate → publish → done`; dry-run walks to `failed` by construction (actions don't execute, so `action-ok` guards take the failure edge — expected runner semantics, not a chain defect).
  - Full run (under 0027 evidence) proves the real IO chain: `docs.json` (fixture doc) → `content.json` (generated Content) → `result.json` (`ok: true`).
  - `git check-ignore -v scratch/e2e/source/item-1.json scratch/e2e/work/result.json` → exit 0, matched by `scratch/` rule.
  - `bun run spur-check` → lint + typecheck + 76 tests + coverage gate all pass.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | `.spur/workflows/kk-ingest-generate-publish.yaml:12-16` — vars `ingestion_plugin: karakeep-local`, `generator_plugin: content-gen`, `publish_plugin: surfdash-pub`; real fixture `scratch/e2e/source/item-1.json` (repaired this run to carry the contract-required `body` field — see fix note) |
| R2 | MET | `spur workflow validate` exit 0 (above); dry-run plan confirms step order `ingest → generate → publish` which is the IO chain: each step's `--in` is the previous step's `--out` (`.spur/workflows/kk-ingest-generate-publish.yaml:25,32,39` — `docs.json → content.json → result.json`); real chain execution evidenced under 0027 |
| R3 | MET | `git check-ignore` exit 0 for both fixture and work dir; `git status` never shows scratch artifacts. Hardened this run: `scratch/` was ignored only via the user's **global** gitignore, which repo tooling (Biome `check .`) does not honor — the acceptance run's own artifacts then failed `bun run lint`. Fixed: `/scratch/` added to the repo `.gitignore` (Biome `vcs.useIgnoreFile: true` respects it); full gate green |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| Scenario: R2 — Acceptance is platform composition, not a new plugin kind | MET | static | `.spur/workflows/kk-ingest-generate-publish.yaml:19-44` — vertical is three `shell` states invoking existing plugins via `knowledge-kit invoke` (B3 seam); kinds remain ingestion/generator/publish (`plugins/*/plugin.json`); no fourth kind introduced |

**Design Conformance**

| Check | Status | Evidence |
|---|---|---|
| design-conformance | pass | Vertical defined as a state-machine workflow over the invoke seam; no new plugin code authored by this task |

**SECUA Review (focus: all)**

- No blocker / major findings. Workflow is declarative YAML over the existing invoke seam; no secrets; scratch paths are local and gitignored.
- Advisory (P3, surfaced while re-running): `plugins/karakeep-local/src/index.ts:149` writes `--out` without `mkdir -p` of the parent (ENOENT when `work/` is absent — surfdash-pub creates the dir, karakeep-local doesn't). Workaround: pre-create the work dir. Follow-up candidate.

**Fix pass (`--fix all`)**: repaired `scratch/e2e/source/item-1.json` (gitignored scratch fixture) — added the contract-required `body` field (`plugins/karakeep-local/src/index.ts:105` skips JSON entries lacking string `body`, which had silently produced `docs.json: []`). Added `/scratch/` to the repo `.gitignore` (was global-only; Biome linted the scratch artifacts and failed the gate).
### Review

| Severity | Finding | Resolution |
| --- | --- | --- |
| P4 | Ensure scratch directories for test runs are isolated and gitignored | Confirmed scratch/ is gitignored |

- Clean implementation using established plugin CLI invocation patterns.
- No new plugin kind introduced; composed strictly via workflow engine.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-08-02T22:29:05.070Z todo → wip (system)
- 2026-08-02T22:29:22.244Z wip → testing (system)
- 2026-08-02T22:29:23.507Z testing → done (system)
