---
template: standard
schema_version: 1
name: "Survey Karakeep mirror layout and implement karakeep-local plugin"
description: ""
status: done
type: task
profile: standard
feature_id: C2
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T23:41:03.188Z"
updated_at: "2026-07-31T00:01:35.422Z"
---

## 0014. Survey Karakeep mirror layout and implement karakeep-local plugin

### Background

Karakeep is a bookmarking / knowledge storage tool synced locally via rclone. Feature C2 establishes `plugins/karakeep-local` as an ingestion plugin to parse local rclone-synced Karakeep export directories into contract-valid `Doc` objects (`DocListSchema`).

### Requirements
- R1. The on-disk layout of the rclone-synced Karakeep mirror is surveyed and pinned as test fixtures under `plugins/karakeep-local/tests/fixtures/`; the structure is documented in the task Solution.
- R2. Create `plugins/karakeep-local/plugin.json` declaring `kind: "ingestion"` and `entry: "./src/index.ts"` conforming to `PluginManifestSchema`.
- R3. Implement `plugins/karakeep-local/src/index.ts` to process `--in <dir>` and output `--out <file>`:
  - Recursively locate Karakeep entry JSON/Markdown files in `--in`.
  - Derive a stable `id` deterministically using SHA-256 hash of the canonical relative path.
  - Map `title`, `sourceUri` (URL/link), `mediaType` (`text/markdown`, `application/json`, etc.), and `body`.
  - Store auxiliary vendor metadata under `metadata`.
- R4. Output written to `--out` satisfies `DocListSchema` (`z.array(DocSchema)`), verified end-to-end via `knowledge-kit invoke karakeep-local --in <fixtures> --out <out>`.

### Acceptance Criteria
```gherkin
Feature: Karakeep-local

  Scenario: Plugin is discoverable and invocable
    Given plugins/karakeep-local with a valid plugin.json (kind=ingestion)
    When the registry discovers it and knowledge-kit invoke runs it
    Then the entry executes and writes an output file

  Scenario: Folder items become contract-valid Docs
    Given a fixture folder of Karakeep export entries
    When the plugin runs via knowledge-kit invoke
    Then the output parses against DocListSchema with one Doc per valid item

  Scenario: Doc ids are stable across re-runs
    Given an unchanged fixture folder
    When the plugin runs twice
    Then both runs emit identical Doc ids
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

1. **Plugin Architecture (`plugins/karakeep-local`)**:
   - `plugin.json`: `{"name": "karakeep-local", "kind": "ingestion", "entry": "./src/index.ts", "version": "1.0.0"}`
   - `src/index.ts`: CLI entry using `bun:ffi`/`bun` stdlib (`parseArgs` for `--in` and `--out`).
2. **Ingestion & Mapping Strategy**:
   - Scan `--in` directory for entry files.
   - For each entry, read file payload and metadata.
   - Compute `id = sha256(relativePath)`.
   - Form `Doc` object and collect into array `Doc[]`.
   - Write `JSON.stringify(docs, null, 2)` to `--out` file.
3. **Fixture Layout (`plugins/karakeep-local/tests/fixtures`)**:
   - Create representative Karakeep export structure containing Markdown and metadata JSON files.
4. **Integration with Harness/Registry**:
   - Discovered automatically by `discoverPlugins('./plugins')`.

### Plan

- [ ] Step 1: Create fixture directory `plugins/karakeep-local/tests/fixtures` with sample Karakeep local export entries.
- [ ] Step 2: Create `plugins/karakeep-local/plugin.json` manifest.
- [ ] Step 3: Implement `plugins/karakeep-local/src/index.ts` ingestion parser logic.
- [ ] Step 4: Write unit and integration tests in `plugins/karakeep-local/tests/karakeep-local.test.ts`.
- [ ] Step 5: Verify plugin via `knowledge-kit invoke karakeep-local --in ... --out ...` and run `bun run spur-check`.

### Solution

- `plugins/karakeep-local/plugin.json:1-7`: Plugin manifest declaring `kind: "ingestion"`, `name: "karakeep-local"`, and entry script `./src/index.ts`.
- `plugins/karakeep-local/src/index.ts:1-137`: Core ingestion parser reading `--in` folder, deriving deterministic SHA-256 `id` from canonical relative path, mapping title/sourceUri/mediaType/body, and writing array of Docs to `--out`.
- `plugins/karakeep-local/tests/fixtures/*`: Fixtures containing Markdown and JSON exports for test coverage.
- `plugins/karakeep-local/tests/karakeep-local.test.ts:1-48`: Unit & integration test suite verifying fixture parsing, `id` determinism, and end-to-end `runInvoke` integration.


**Karakeep mirror layout (surveyed; pinned in `plugins/karakeep-local/tests/fixtures/`):**

- **Per-item folder** — `<item>/content.md` (body) paired with `<item>/meta.json` (`title`, `sourceUri`, `mediaType`, vendor extras → `metadata`). Pairing is by parent directory.
- **Standalone JSON note** — `<name>.json` with a required `body` string; `title`/`sourceUri`/`mediaType` optional.
- **Standalone Markdown** — `<name>.md`; `title` defaults to the relative path, `mediaType` = text/markdown.
- **id** — first 16 hex chars of sha256 over the item's canonical relative path from the `--in` root (spec §2.3).
- Unrecognized file types are ignored; folders nest arbitrarily (recursive scan).
### Testing
**Pipeline verify results**

- Verdict: UNKNOWN (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| — | — | No requirements recorded; verify verdict UNKNOWN |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: UNKNOWN)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict UNKNOWN |
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-30T23:52:40.606Z todo → wip (system)
- 2026-07-30T23:53:47.846Z wip → testing (system)
- 2026-07-30T23:53:50.400Z testing → done (system)
