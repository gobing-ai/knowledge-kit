---
schema_version: 1
name: "Ship dailynews-gen generator plugin"
status: done
template: feature-impl
created_at: 2026-08-22T04:16:01.462Z
updated_at: "2026-08-22T05:38:47.613Z"
feature_id: F6
---

## 0073. Ship dailynews-gen generator plugin

### Background
To convert ingested daily AI news documents (`Doc[]`) into spoken broadcast audio, knowledge-kit needs a generator plugin that structures raw article summaries into a natural spoken broadcast VoiceScript YAML. This plugin implements the generator contract (`Doc[] -> Content`) per ADR-007, ADR-009, and the Generator Plugin Specification.
### Requirements
- [x] R1. Plugin lives at `plugins/generations/dailynews-gen/` with `plugin.json` declaring `kind: generator` and entry `./src/index.ts`.
- [x] R2. Executor accepts required `--in <Doc[].json>` and `--out <Content.json>`; language/title/profile use inherited environment configuration, with equivalent direct-entry flags and `zh` as the language default.
- [x] R3. Transform input `Doc[]` into validated broadcast VoiceScript YAML carried by markdown `Content`, with intro, story segments with `gap_ms` pauses, and outro.
- [x] R4. Handle empty or zero `Doc[]` inputs cleanly by generating a fallback notice VoiceScript without throwing.
- [x] R5. Unit tests in `tests/dailynews-gen.test.ts` achieving >=90% line and function coverage.
### Acceptance Criteria
```gherkin
Feature: Daily AI news workflow and plugins

  @core
  Scenario: R3 — dailynews-gen plugin follows Generator Plugin Specification
    Given plugins/generations/dailynews-gen/plugin.json exists
    When the plugin manifest is parsed
    Then kind is generator and entry is ./src/index.ts
    And running dailynews-gen with --in Doc[] and --out Content produces Content matching ContentSchema

  @core
  Scenario: R4 — dailynews-gen transforms Doc[] into structured broadcast VoiceScript
    Given a non-empty Doc[] JSON input
    When dailynews-gen processes the documents
    Then the output Content has format markdown containing VoiceScript YAML
    And the body contains valid VoiceScript YAML with intro, news story segments, gap_ms timings, and outro

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
  - `plugins/generations/dailynews-gen/package.json`
  - `plugins/generations/dailynews-gen/plugin.json`
  - `plugins/generations/dailynews-gen/src/script-builder.ts`
  - `plugins/generations/dailynews-gen/src/index.ts`
  - `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts`
- Script Layout:
  - Intro segment: greets listener with topic count
  - Item segments: story index, headline, summary body with 500ms pause
  - Outro segment: sign-off
- Output: markdown `Content` whose body is validated VoiceScript YAML and whose metadata includes story count and voice profile. `voice-gen` owns the later audio `Content`.
### Plan
1. Scaffold `plugins/generations/dailynews-gen/` (`package.json`, `tsconfig.json`, `plugin.json`).
2. Implement `buildNewsVoiceScript` in `src/script-builder.ts`.
3. Implement `processGeneratorIO` in `src/index.ts`.
4. Author unit tests covering standard generation, custom language/voice profile options, empty docs, invalid input JSON.
5. Add build/typecheck and run verification gate.
### Solution
- `plugins/generations/dailynews-gen/plugin.json:3`: `kind: generator` manifest.
- `plugins/generations/dailynews-gen/plugin.json:4`: `./src/index.ts` entry.
- `plugins/generations/dailynews-gen/src/script-builder.ts:4`: `VoiceScriptSchema` runtime contract.
- `plugins/generations/dailynews-gen/src/script-builder.ts:38`: `buildNewsVoiceScript` implementation.
- `plugins/generations/dailynews-gen/src/index.ts:15`: `processGeneratorIO` implementation.
- `plugins/generations/dailynews-gen/src/index.ts:67`: `main` executor/direct option boundary.
- `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:42`: structured Chinese VoiceScript test.
- `docs/design/dailynews-gen.md:25`: VoiceScript structure surface.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/dailynews-gen/plugin.json:3` — generator manifest kind and adjacent source entry |
| R2 | MET | `plugins/generations/dailynews-gen/src/index.ts:67` — `main` executor/environment boundary |
| R3 | MET | `plugins/generations/dailynews-gen/src/script-builder.ts:38` — `buildNewsVoiceScript` |
| R4 | MET | `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:78` — empty Doc fallback test |
| R5 | MET | `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:42` — structured VoiceScript test suite |
| AC-3 | MET | Feature-scenario alias for R3; executable evidence below |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — dailynews-gen plugin follows Generator Plugin Specification | MET | test | `ContentSchema` output test at `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:88` |
| R4 — dailynews-gen transforms Doc[] into structured broadcast VoiceScript | MET | test | Chinese/English structure tests at `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:42` and `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:62`; runtime YAML/schema assertion at `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:88` |
| R6 — Empty news items handled gracefully | MET | test | Empty ingestion at `plugins/ingestions/aihot-ingest/tests/aihot-ingest.test.ts:244`; empty generator fallback at `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:78` |
| R7 — Offline test coverage and boundaries | MET | command | `bun run spur-check`: 460 tests pass; aggregate 99.38% functions / 98.26% lines; both plugin modules exceed 90/90 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; deterministic VoiceScript generation is the completed design, with no deferred F6 work |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Generator manifest at `plugins/generations/dailynews-gen/plugin.json:3` |
| R2 | MET | Executor/environment boundary at `plugins/generations/dailynews-gen/src/index.ts:67` |
| R3 | MET | Validated Content and VoiceScript output at `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:88` |
| R4 | MET | Empty-input fallback at `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:78` |
| R5 | MET | `bun run spur-check` reports 100% functions and at least 93.83% lines for dailynews-gen source modules |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-22T04:20:25.023Z todo → wip (system)
- 2026-08-22T04:21:12.179Z wip → testing (system)
- 2026-08-22T04:21:12.482Z testing → done (system)
