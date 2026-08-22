---
schema_version: 1
name: "Ship aihot-ingest ingestion plugin"
status: done
template: feature-impl
created_at: 2026-08-22T04:15:59.468Z
updated_at: "2026-08-22T05:39:01.860Z"
feature_id: F6
---

## 0072. Ship aihot-ingest ingestion plugin

### Background
To support an automated daily AI news voice broadcast workflow, knowledge-kit requires an ingestion source that fetches curated AI news from `aihot.virxact.com`. This plugin delivers the ingestion stage (`source -> Doc[]`) conforming to ADR-007, ADR-009, and the Ingestion Plugin Specification.
### Requirements
- [x] R1. Plugin lives at `plugins/ingestions/aihot-ingest/` with `plugin.json` declaring `kind: ingestion` and entry `./src/index.ts`.
- [x] R2. Executor invocation accepts `--in <config.json>` and required `--out <docs.json>`; config supports `limit` (default 10), `cursor`, and `stateFile`; the direct entry exposes equivalent `--limit`, `--cursor`, and `--state-file` flags.
- [x] R3. Support snapshot `/api/v1/selected/snapshot` and incremental changes `/api/v1/selected/changes`, mapping `upsert` records and atomically persisting the returned cursor in `stateFile` after success.
- [x] R4. Map news items to `Doc[]` matching `DocListSchema` in `@gobing-ai/kk-core`, retaining Aihot attribution where present.
- [x] R5. Provide `AihotDeps` dependency injection with `fetch: FetchLike` for 100% offline unit testing with >=90% coverage and zero `globalThis.fetch` mutation.
### Acceptance Criteria
```gherkin
Feature: Daily AI news workflow and plugins

  @core
  Scenario: R1 — aihot-ingest plugin follows Ingestion Plugin Specification
    Given plugins/ingestions/aihot-ingest/plugin.json exists
    When the plugin manifest is parsed
    Then kind is ingestion and entry is ./src/index.ts
    And running aihot-ingest with executor-compatible --in and --out produces valid Doc[] JSON matching DocListSchema

  @core
  Scenario: R2 — aihot-ingest supports snapshot and incremental changes API
    Given an aihot client with injected fetch seam
    When aihot-ingest is called without cursor
    Then it queries the snapshot endpoint /api/v1/selected/snapshot
    And when called with cursor or state-file, it queries /api/v1/selected/changes and atomically updates the state file

  @edge
  Scenario: R6 — Empty news items handled gracefully
    Given an empty Doc[] input or zero news items returned from API
    When dailynews-gen or aihot-ingest runs
    Then aihot-ingest writes an empty Doc[] array
    And dailynews-gen outputs a short fallback notice VoiceScript without crashing

  @edge
  Scenario: R7 — Offline test coverage and boundaries
    Given unit tests for aihot-ingest, dailynews-gen, and kk-daily-ai-voice
    When bun test runs
    Then all tests pass with zero globalThis.fetch mutations and >=90% line and function coverage
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
- Structure:
  - `plugins/ingestions/aihot-ingest/package.json`
  - `plugins/ingestions/aihot-ingest/plugin.json`
  - `plugins/ingestions/aihot-ingest/src/client.ts`
  - `plugins/ingestions/aihot-ingest/src/mapper.ts`
  - `plugins/ingestions/aihot-ingest/src/index.ts`
  - `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts`
- Seam: `AihotDeps` interface with `fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>`.
- State file handling: atomic write of updated cursor JSON upon successful fetch.
### Plan
1. Scaffold `plugins/ingestions/aihot-ingest/` (`package.json`, `tsconfig.json`, `plugin.json`).
2. Implement `AihotClient` supporting snapshot and incremental changes.
3. Implement `processIngestionIO` mapping responses to `Doc[]` JSON.
4. Author unit tests covering snapshot, incremental changes, cursor persistence, network errors, empty results.
5. Add build/typecheck and run verification gate.
### Solution
- `plugins/ingestions/aihot-ingest/plugin.json:3`: `kind: ingestion` manifest.
- `plugins/ingestions/aihot-ingest/plugin.json:4`: `./src/index.ts` entry.
- `plugins/ingestions/aihot-ingest/src/client.ts:50`: `AihotChangeSchema` discriminated union.
- `plugins/ingestions/aihot-ingest/src/client.ts:97`: `AihotClient` implementation.
- `plugins/ingestions/aihot-ingest/src/client.ts:171`: `parseRecords` partial-record recovery.
- `plugins/ingestions/aihot-ingest/src/index.ts:26`: `IngestionInputSchema` config boundary.
- `plugins/ingestions/aihot-ingest/src/index.ts:38`: `processIngestionIO` orchestration.
- `plugins/ingestions/aihot-ingest/src/mapper.ts:12`: canonical-source ID fallback.
- `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:140`: malformed-record recovery test.
- `docs/design/aihot-ingest.md:25`: endpoints and sync surface.
- `docs/design/aihot-ingest.md:36`: partial-item failure behavior.
- `docs/04_DESIGN.md:344`: injectable client seam surface.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/ingestions/aihot-ingest/plugin.json:3` — ingestion manifest kind and adjacent source entry |
| R2 | MET | `plugins/ingestions/aihot-ingest/src/index.ts:95` — `main` CLI/config boundary |
| R3 | MET | `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:222` — state-file cursor update test |
| R4 | MET | `plugins/ingestions/aihot-ingest/src/mapper.ts:9` — `mapAihotItemToDoc` |
| R5 | MET | `plugins/ingestions/aihot-ingest/src/client.ts:80` — `AihotDeps` injected transport |
| AC-1 | MET | Feature-scenario alias for R1; executable evidence below |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — aihot-ingest plugin follows Ingestion Plugin Specification | MET | command | `bun run spur-check`: 460 tests pass, including registry, executor CLI, and malformed-record recovery coverage |
| R2 — aihot-ingest supports snapshot and incremental changes API | MET | test | Snapshot, official changes union, and persisted cursor tests at `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:171`, `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:198`, and `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:222` |
| R6 — Empty news items handled gracefully | MET | test | Empty ingestion at `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:244`; empty generator fallback at `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:78` |
| R7 — Offline test coverage and boundaries | MET | command | `bun run spur-check`: 460 tests pass; aggregate 99.38% functions / 98.26% lines; no `globalThis.fetch` mutation |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional, SECUA, and architecture review PASS after partial-record recovery fix |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Manifest at `plugins/ingestions/aihot-ingest/plugin.json:3`; malformed-record recovery at `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:140`; executor path at `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:269` |
| R2 | MET | Executor/config boundary at `plugins/ingestions/aihot-ingest/src/index.ts:95` |
| R3 | MET | Incremental cursor and atomic state behavior at `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:222` |
| R4 | MET | Doc mapping at `plugins/ingestions/aihot-ingest/src/mapper.ts:9` |
| R5 | MET | Injectable dependencies at `plugins/ingestions/aihot-ingest/src/client.ts:80`; `bun run spur-check` reports 100% functions/lines for all aihot-ingest source modules |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-22T04:17:53.248Z todo → wip (system)
- 2026-08-22T04:20:22.692Z wip → testing (system)
- 2026-08-22T04:20:22.993Z testing → done (system)
