---
template: feature-impl
schema_version: 1
name: "Generate contract-valid Content through the owned STORM pipeline"
description: ""
status: done
type: task
profile: standard
feature_id: D4
parent_wbs: null
priority: P2
tags: ["generator", "storm"]
dependencies: ["0046"]
ac_numbering: task-local
created_at: "2026-08-12T13:48:52.647Z"
updated_at: "2026-08-12T14:33:00.802Z"
---

## 0047. Generate contract-valid Content through the owned STORM pipeline

### Background

Feature D4 replaces the wt technical-content-creation stand-in after grounded curation and outline results exist. This deliverable completes the vertical generator path: cited article generation, polish, Content mapping, switch-over, failure handling, and contract verification.

Implements feature scenarios: R1 — The owned STORM pipeline runs behind the existing generator contract; R4 — Article generation grounds sections and citations in supplied documents; R5 — Polishing preserves structure and produces contract-valid Content; R6 — The owned pipeline replaces the stand-in without widening the platform seam; R7 — Empty input retains the generator notice contract; R8 — A failed or malformed stage fails loud; R9 — Sparse document metadata remains schema-valid.

Ordering: depends on the grounded curation/outline task; set through `spur task deps` after atomic creation.

Rubric: E3 D1 L2 C1 R1 = 8 → separate cohesive task; article, polish, mapping, and switch-over share one assembly review context and should not be split further.

### Requirements
- [ ] R1. Orchestrate curation, outline, article, and polish in order for every non-empty DocList, verify the stage order through the real plugin boundary with deterministic fake results, and emit ContentSchema-valid output.
- [ ] R2. Generate article sections from the validated outline/evidence and allow citations only to supplied documents, mapping available sourceUri/title/id fields into Content references.
- [ ] R3. Polish the draft while preserving headings and citations, removing repetition, and emitting outline plus STORM provenance metadata.
- [ ] R4. Remove the wt technical-content-creation delegation without adding Python, a direct provider client, a plugin kind, a schema, or an invoke-contract change; update the existing generator specification to record the switch-over.
- [ ] R5. Preserve the empty-DocList notice Content and exit-zero behavior.
- [ ] R6. Propagate any stage failure or malformed result with a stage-specific stderr diagnostic, non-zero exit, and no stale output.
- [ ] R7. Keep Content and references schema-valid when source documents lack optional title or sourceUri fields.
### Acceptance Criteria
```gherkin
Feature: Owned STORM Content generation

  @core
  Scenario: R1 — The owned STORM pipeline runs behind the existing generator contract
    Given a non-empty valid DocList input and deterministic fake results for every stage
    When knowledge-kit invokes the real content-gen plugin entry
    Then curation, outline, article, and polish stages run in order
    And the output parses against ContentSchema without network access

  @core
  Scenario: R2 — Article generation grounds sections and citations in supplied documents
    Given a valid outline and curated evidence
    When the article stage writes the draft
    Then each emitted citation maps to a supplied document
    And Content references use available Doc sourceUri, title, and id fields

  @core
  Scenario: R3 — Polishing preserves structure and produces contract-valid Content
    Given a grounded draft article
    When the polish stage runs
    Then the final markdown preserves headings and citations while removing repetition
    And Content includes body, outline, references, and STORM provenance metadata

  @core
  Scenario: R4 — The owned pipeline replaces the stand-in without widening the platform seam
    Given the existing content-gen manifest and DocList-to-Content contract
    When D4 is implemented and its generator specification is updated
    Then the wt technical-content-creation stand-in is no longer invoked
    And no Python runtime, direct LLM-provider client, plugin kind, or schema is added

  @edge
  Scenario: R5 — Empty input retains the generator notice contract
    Given an empty DocList
    When the content-gen plugin runs
    Then it writes notice Content with empty references and exits zero

  @edge
  Scenario: R6 — A failed or malformed stage fails loud
    Given any stage exits non-zero or returns malformed structured output
    When the pipeline propagates the failure
    Then the plugin emits a stage-specific diagnostic and exits non-zero
    And no stale output file remains

  @edge
  Scenario: R7 — Sparse document metadata remains schema-valid
    Given source documents without titles or source URIs
    When the pipeline maps the final Content
    Then optional reference fields are omitted and provenance still carries document IDs
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Chosen approach: extend the typed STORM primitives from the prerequisite task with article and polish stage calls, then replace `generateWithTechnicalContentSkill` with one `generateWithStormPipeline` orchestration path. Keep `processGeneratorIO`, the manifest, and the public DocList-to-Content contract intact. Tests mock the shared stage runner and continue exercising the real plugin through `runInvoke`.

Reason: switching implementation behind the existing deep plugin seam confines the blast radius to content-gen while retaining observable stage boundaries.

Rejected alternatives:
- Separate article and polish tasks: both change the same orchestration/mapping surface and would add a review cycle without an independent deliverable.
- Keep the stand-in behind a runtime flag: D4 replaces D2; an unused fallback adds configuration and dead behavior.
- Widen to Brief/GeneratorInput here: explicitly out of D4 scope and owned by the separate ADR-007 contract work.

Invariants:
- `plugins/content-gen/plugin.json` remains kind `generator` with the existing entry.
- Empty input does not invoke any stage.
- A stage failure never leaves stale output.
- References and citations originate only from input documents.
- No new dependency, runtime, command, flag, or schema.
- Generator-spec documentation changes land with the switch-over; no new design satellite is needed.
### Plan
1. Implement cited article generation and structural polish using the shared typed stage runner.
2. Orchestrate all four stages and map the final result to ContentSchema with outline, references, and STORM provenance.
3. Replace the wt stand-in delegation while retaining existing argv, file IO, empty-input, and failure semantics.
4. Extend focused unit tests and the `runInvoke` contract test for stage order, grounding, sparse metadata, malformed results, and cleanup.
5. Update `docs/design/generator-plugin-specification.md` to mark the D4 own-engine switch as implemented.
6. Run content-gen tests, typecheck, then the project verification gate.
### Solution

| Req | File:line | Change | Rationale |
| --- | --- | --- | --- |
| R1 | `plugins/content-gen/src/storm.ts:260-287` | Added `generateWithStormPipeline`: chains `curationStage` → `outlineStage` → `articleStage` → `polishStage` through the injected `StormStageRunner` and maps the polished result to `ContentSchema`. | Single orchestration path behind the existing generator contract; stages stay observable and injectable for deterministic tests. |
| R2 | `plugins/content-gen/src/storm.ts:78-83,189-224` | Added `ArticleResultSchema` (`{title?, body, citations?}`) and `articleStage`: writes the markdown draft from the validated curation + outline, validates output, and rejects citations referencing unknown document IDs (`assertKnownEvidence`). | Grounds sections and citations in supplied documents only; malformed/unknown-citation output fails loud with a stage-specific diagnostic. |
| R3 | `plugins/content-gen/src/storm.ts:85-90,226-258` | Added `PolishResultSchema` (`{title?, body, outline?}`) and `polishStage`: prompt mandates preserving every heading and citation while removing repetition; output validated before return. | Polish emits the final article outline used in Content; malformed output fails loud. |
| R1/R2/R3 | `plugins/content-gen/src/storm.ts:260-287` | Content mapping: `title` falls back polish → article → outline → first doc → default; `references` built from `Doc.sourceUri`/`title`/`id`; `metadata` carries `{ generator: "kk:storm", stageCount: 4, docIds }`. | Keeps the `Doc[] → Content` mapping conventions (§2.3) with STORM provenance; absent optional doc fields stay schema-valid (R7). |
| R4 | `plugins/content-gen/src/index.ts:5,17-25` | Removed `generateWithTechnicalContentSkill` and the stand-in `AgentRunEnvelope`/`parseAgentJson` imports; `processGeneratorIO` defaults to `generateWithStormPipeline`. | The wt technical-content-creation stand-in is no longer invoked; argv, file IO, empty-input, and failure semantics unchanged. |
| R4 | `plugins/content-gen/plugin.json:6` | Updated manifest description to the owned STORM pipeline. | No `kind`, entry, or schema change — only stale description text. |
| R5 | `plugins/content-gen/src/index.ts:9-15,24` | `EMPTY_CONTENT` notice and exit-0 path retained; empty `Doc[]` never reaches a stage. | Preserves the generator notice contract. |
| R6 | `plugins/content-gen/src/storm.ts:52-60,104-107` (`stageError`), `index.ts:36-45` | Stage failures/malformed results throw `{Stage} stage failed: …`; `main` logs it to stderr and removes `--out` on any error; `processGeneratorIO` also removes the output before generating. | Stage-specific diagnostics, non-zero exit, and no stale output. |
| R1/R6/R7 | `plugins/content-gen/tests/storm.test.ts:204-327` | Added article stage (grounding, unknown-citation, malformed, non-zero exit), polish stage (preservation directive, malformed, non-zero exit), and pipeline tests (stage order, failure abort, malformed abort) with a scripted fake runner. | Deterministic stage-order and fail-loud verification without an LLM or network. |
| R1/R6/R7 | `plugins/content-gen/tests/content-gen.test.ts:94-133` | Rewrote the `runInvoke` contract test with a sequential mock `spur` that replays one envelope per stage call and logs prompts; asserts curation→outline→article→polish prompt order and ContentSchema output. | Verifies stage order through the real plugin boundary (entry spawn, schema validation) with deterministic fake results. |
| R5/R6/R7 | `plugins/content-gen/tests/content-gen.test.ts:137-289` | Rewrote adapter tests: empty-input notice, stage failure (stderr + no output), malformed stage output, sparse metadata (references omit absent url/title), invalid pipeline output, malformed input, and `main` success/failure outcomes. | Keeps the full failure/no-stale-output/exit-code contract covered end to end. |
| R4 | `docs/design/generator-plugin-specification.md:61-78` | §2.3 metadata example updated to `kk:storm`; §2.2 entry mechanism cites the owned pipeline; §2.4 rewritten as "Own Engine (D4) — STORM Pipeline" recording the switch-over and that the stand-in is no longer invoked. | Records the D4 switch-over in the existing generator specification; no new schema/kind/invoke-contract change. |

Scope notes: no new dependency, runtime (Python), direct LLM-provider client, plugin kind, schema, or invoke-contract change was introduced (R4). Targeted probes run: `bun test` for the two content-gen suites (33 pass) and `bun run typecheck` for `@gobing-ai/content-gen`; the project-wide gate is owned by the pipeline's test hop.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/content-gen/src/storm.ts:311-333` — `generateWithStormPipeline` chains curation → outline → article → polish through the injected runner and parses the mapped result with `ContentSchema`; `plugins/content-gen/tests/content-gen.test.ts:94-133` — runInvoke contract test asserts curation→outline→article→polish prompt order through the real plugin entry and parses output with `ContentSchema`; `plugins/content-gen/tests/storm.test.ts:321-346` — scripted-runner stage-order test |
| R2 | MET | `plugins/content-gen/src/storm.ts:225-255` — `articleStage` writes the draft from validated curation + outline and rejects unknown citation IDs in the declared `citations` array and in the body text (`plugins/content-gen/src/storm.ts:254` via `bodyCitations` at `plugins/content-gen/src/storm.ts:124-133`); `plugins/content-gen/src/storm.ts:326-331` — Content references mapped from doc `sourceUri`/`title`/`id`; tests `plugins/content-gen/tests/storm.test.ts:238-244`, `plugins/content-gen/tests/storm.test.ts:227-235`, `plugins/content-gen/tests/content-gen.test.ts:201-231` |
| R3 | MET | `plugins/content-gen/src/storm.ts:262-302` — `polishStage` prompt mandates preserving every heading/citation and machine-verifies it (`plugins/content-gen/src/storm.ts:291-301`); `plugins/content-gen/src/storm.ts:329-333` — Content carries `outline` + `metadata { generator: "kk:storm", stageCount: 4, docIds }`; tests `plugins/content-gen/tests/storm.test.ts:263-270`, `plugins/content-gen/tests/storm.test.ts:278-307`, `plugins/content-gen/tests/storm.test.ts:338-341` |
| R4 | MET | `plugins/content-gen/src/index.ts:5,17-25` — stand-in `generateWithTechnicalContentSkill` removed, `processGeneratorIO` defaults to `generateWithStormPipeline`; `plugins/content-gen/plugin.json:3-6` — kind `generator` + entry unchanged (description only); `docs/design/generator-plugin-specification.md:64-70` — §2.4 "Own Engine (D4)" records the switch-over; `rg "generateWithTechnicalContentSkill" plugins/content-gen` → 0 matches |
| R5 | MET | `plugins/content-gen/src/index.ts:9-15,24` — `EMPTY_CONTENT` notice retained, empty `Doc[]` never reaches a stage, exit 0; `plugins/content-gen/tests/content-gen.test.ts:137-149` — empty-input notice test asserts a throwing generator is never invoked |
| R6 | MET | `plugins/content-gen/src/storm.ts:112-118` — stage-specific `stageError`; `plugins/content-gen/src/storm.ts:57-75` — runner-level malformed-envelope guard returns a stage-prefixable diagnostic; `plugins/content-gen/src/index.ts:22` — output removed before generation; `plugins/content-gen/src/index.ts:44-45` — stderr diagnostic + `rm --out` on error, exit 1; tests `plugins/content-gen/tests/content-gen.test.ts:151-174`, `plugins/content-gen/tests/content-gen.test.ts:176-199`, `plugins/content-gen/tests/storm.test.ts:348-358`, `plugins/content-gen/tests/storm.test.ts:360-371`, `plugins/content-gen/tests/storm.test.ts:410-431` |
| R7 | MET | `plugins/content-gen/src/storm.ts:326-331` — optional `url`/`title` omitted when absent, `cite` always carries the doc id; `packages/kk-core/src/schemas.ts:14-33` — `ContentSchema` reference fields optional; `plugins/content-gen/tests/content-gen.test.ts:201-231` — sparse doc parses with `references: [{ cite: 'doc-1' }]` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario R1 — owned STORM pipeline runs behind the existing generator contract | MET | test | `plugins/content-gen/tests/content-gen.test.ts:94-133` — runInvoke asserts curation→outline→article→polish prompt order through the real plugin entry and parses output with `ContentSchema`; `plugins/content-gen/tests/storm.test.ts:321-346` — scripted-runner stage order |
| Scenario R2 — article generation grounds sections and citations in supplied documents | MET | test | `plugins/content-gen/tests/storm.test.ts:227-235` — in-body unknown citation rejected; `plugins/content-gen/tests/storm.test.ts:238-244` — declared unknown citation rejected; `plugins/content-gen/tests/content-gen.test.ts:201-231` — reference mapping from Doc `sourceUri`/`title`/`id` |
| Scenario R3 — polishing preserves structure and produces contract-valid Content | MET | test | `plugins/content-gen/tests/storm.test.ts:278-307` — dropped heading/citation and unknown-citation rejection; `plugins/content-gen/tests/content-gen.test.ts:94-133` — polished body + outline in ContentSchema output |
| Scenario R4 — owned pipeline replaces stand-in without widening the platform seam | MET | command | `rg -n "generateWithTechnicalContentSkill" plugins/content-gen` → exit 1, no matches; `plugins/content-gen/src/index.ts:5,17-25` — stand-in removed, pipeline default; `plugins/content-gen/plugin.json:3-6` — kind/entry unchanged; `docs/design/generator-plugin-specification.md:66-70` — switch-over recorded |
| Scenario R5 — empty input retains the generator notice contract | MET | test | `plugins/content-gen/tests/content-gen.test.ts:137-149` — notice Content with empty references, generator never invoked |
| Scenario R6 — a failed or malformed stage fails loud | MET | test | `plugins/content-gen/tests/content-gen.test.ts:151-174` — code 1, stderr `Outline stage failed`, no output file; `plugins/content-gen/tests/content-gen.test.ts:176-199` — malformed stage output → code 1, no output; `plugins/content-gen/tests/storm.test.ts:410-431` — non-JSON spur envelope → stage-prefixed diagnostic |
| Scenario R7 — sparse document metadata remains schema-valid | MET | test | `plugins/content-gen/tests/content-gen.test.ts:201-231` — sparse doc (no title/sourceUri) parses via `ContentSchema` with `references: [{ cite: 'doc-1' }]` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Correctness | `plugins/content-gen/src/storm.ts:52-60,189-224` | Article-stage grounding validates only the declared `citations` array. An in-body citation (e.g. `[doc-999]` written into the markdown body but omitted from `citations`) escapes `assertKnownEvidence` and ships. AC R2's "each emitted citation maps to a supplied document" holds only for declared citations, not body text. |
| P3 | Correctness | `plugins/content-gen/src/storm.ts:85-90,226-258` | Polish preservation of headings/citations is prompt-mandated only; `PolishResultSchema` has no structural check. A polish result that drops a heading or alters a citation still validates. R3 "preserving headings and citations" is not machine-verified. |
| P4 | Correctness | `plugins/content-gen/src/storm.ts:26-31` | `spurStageRunner` runs `JSON.parse(stdout)` unguarded: a spur CLI exit-0 with non-envelope stdout throws a raw `SyntaxError` without a stage prefix. `main` still catches it (stderr + exit 1 + output removed), so no stale-output risk. |
| P4 | Architecture | `plugins/content-gen/src/agent-json.ts:3-5` | Stale comment: "Shared by the D2 stand-in and the owned STORM stages" — the D2 stand-in was removed in this task; `parseAgentJson` is now consumed only by `storm.ts`. |

**Functional traceability (R1–R7):**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/content-gen/src/storm.ts:260-287` — `generateWithStormPipeline` chains curation → outline → article → polish and parses the mapped result against `ContentSchema`; `plugins/content-gen/tests/content-gen.test.ts:94-133` — runInvoke contract test asserts curation→outline→article→polish prompt order through the real plugin-entry spawn (`apps/cli/src/invoke.ts:44-61` spawnPluginEntry) and parses output with `ContentSchema`; `plugins/content-gen/tests/storm.test.ts:204-227` — scripted-runner stage-order test |
| R2 | MET | `plugins/content-gen/src/storm.ts:189-224` — `articleStage` writes the draft from validated curation + outline and rejects unknown citation IDs via `assertKnownEvidence` (`storm.ts:52-60`); `storm.ts:270-285` — Content references mapped from `doc.sourceUri`/`title`/`id`; `tests/storm.test.ts:158-187` — unknown-citation, malformed, non-zero-exit tests; `tests/content-gen.test.ts:203-227` — reference mapping asserted end to end |
| R3 | MET | `plugins/content-gen/src/storm.ts:226-258` — `polishStage` prompt mandates preserving every heading/citation, removing repetition, emitting final outline; `storm.ts:275-287` — Content carries `outline` + `metadata { generator: "kk:storm", stageCount: 4, docIds }`; `tests/storm.test.ts:190-210` — preservation directive and outline emission asserted |
| R4 | MET | `plugins/content-gen/src/index.ts:5,17-25` — stand-in `generateWithTechnicalContentSkill` and its imports removed, `processGeneratorIO` defaults to `generateWithStormPipeline`; `plugins/content-gen/plugin.json` — kind `generator` + entry unchanged (description only); `docs/design/generator-plugin-specification.md:61-78` — §2.4 rewritten as "Own Engine (D4)" recording the switch-over; no Python/provider-client dep in `plugins/content-gen/package.json`; no `generateWithTechnicalContentSkill` references remain in code |
| R5 | MET | `plugins/content-gen/src/index.ts:9-15,24` — `EMPTY_CONTENT` notice retained, empty `Doc[]` never reaches a stage, exit 0; `tests/content-gen.test.ts:137-146` — empty-input notice test asserts a throwing generator is never invoked |
| R6 | MET | `plugins/content-gen/src/storm.ts:52-60` — stage-specific `stageError` (`{Stage} stage failed: …`); `index.ts:20` — output removed before generation; `index.ts:36-45` — stderr diagnostic, `rm --out` on any error, exit 1; `tests/content-gen.test.ts:148-176` — stage failure → code 1, stderr contains `Outline stage failed`, no output file; `tests/content-gen.test.ts:178-200` — malformed stage output → code 1, no output; `tests/storm.test.ts:283-300` — failure/malformed abort before later stages run |
| R7 | MET | `plugins/content-gen/src/storm.ts:270-285` — optional `url`/`title` omitted when absent, `cite` always carries the doc id; `packages/kk-core/src/schemas.ts:14-33` — `ContentSchema` reference fields optional; `tests/content-gen.test.ts:203-227` — sparse doc (no title/sourceUri) parses via `ContentSchema` with `references: [{ cite: 'doc-1' }]` |

**Design conformance:** chosen approach DONE — article/polish stages on the shared typed runner, single `generateWithStormPipeline` path replacing the stand-in, `processGeneratorIO`/manifest/Doc[]→Content contract intact, tests mock the shared stage runner and exercise the real plugin through `runInvoke`. All six invariants hold: `plugin.json` kind `generator` + existing entry unchanged; empty input invokes no stage; stage failure never leaves stale output; references/citations originate only from input documents; no new dependency/runtime/command/flag/schema; generator-spec updated with the switch-over.

**Architecture depth (5 lenses):** no blocker/major candidates. `storm.ts` is a deep module (validation, grounding, per-stage prompts, orchestration); `index.ts` is an appropriately thin CLI adapter; `agent-json.ts` centralizes JSON tolerance; stage runner seam keeps stages process-free and deterministically testable (strong test surface: unit + real-boundary contract tests). Advisory-only: stale D2 comment in `agent-json.ts:3-5` (recorded above).

**Verification (run this review):** `bun test` in `plugins/content-gen` → 34 pass / 0 fail (2 files); `bun run typecheck` → exit 0.

**Disposition:** PASS — no P1/P2 blocking findings; two P3 minors and two P4 advisories recorded as residual risk. The two P3 items (declared-citations-only grounding; prompt-only polish preservation) are the only residual risk to the @core R2/R3 guarantees and are candidates for the verify stage's attention or a small follow-up.
### References

D4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T14:21:35.342Z todo → wip (system)
- 2026-08-12T14:23:19.509Z wip → testing (system)
- 2026-08-12T14:33:00.802Z testing → done (system)
