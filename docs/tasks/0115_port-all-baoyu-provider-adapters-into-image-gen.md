---
schema_version: 1
name: Port all baoyu provider adapters into image-gen
status: backlog
template: feature-impl
created_at: 2026-09-11T16:54:52.610Z
updated_at: "2026-09-11T16:55:08.219Z"
feature_id: K

---

## 0115. Port all baoyu provider adapters into image-gen

### Background

The 12-row registry in `plugins/generations/image-gen/src/providers/types.ts` has only `seedream` as a wire-speaking adapter; the other 11 rows are `envOnlyProvider` shells whose generate() throws. `vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/*.ts` holds working TS adapters + tests for all 12 (same origin as the frozen registry facts) — port, do not re-develop.

### Requirements

- R1. Replace each `envOnlyProvider` shell (agnes, azure, codex-cli, dashscope, google, jimeng, minimax, openai, openrouter, replicate, zai) with the corresponding baoyu adapter, adapted to the kk `ImageProvider`/`ImageRequest` interface and `ProviderOptions{fetch,env}` injection seam.
- R2. Port each baoyu provider test as `<name>.test.ts` under `plugins/generations/image-gen/tests/`, mapped to the kk interface; keep every credential/model/base-URL env read consistent with `config.example.yaml` rows and `isAvailable()` semantics.
- R3. Behavior: `google` and other AUTO_ORDER-head providers actually generate when their credentials are present; ref-image support must follow each spec's `refModels` list.
- R4. Keep selection/invariants frozen: `AUTO_ORDER`, `NEVER_AUTO` ('codex-cli'), env precedence (real env wins over config block) unchanged.

#### Acceptance Criteria
```gherkin
Scenario: R1 — every registry row has a wire-speaking adapter
    Given the provider registry is loaded
    When generate() is called on each provider with mocked fetch per its baoyu test
    Then no provider throws "has no adapter yet"

  Scenario: R2 — registry facts stay in sync with baoyu sources
    Given an adapter is ported from its baoyu source
    When its facts (env criteria, models) are compared
    Then they match the corresponding config.example.yaml row verbatim

  Scenario: R3/R4 — selection behaves unchanged
    Given credentials for multiple providers
    When selectProvider runs
    Then AUTO_ORDER/NEVER_AUTO semantics and refModels routing match the pre-port behavior
```

### Acceptance Criteria

```gherkin
Scenario: R1 - every registry row has a wire-speaking adapter
    Given the provider registry is loaded
    When generate is called on each provider with mocked fetch per its baoyu test
    Then no provider throws "has no adapter yet"

  Scenario: R2 - registry facts stay in sync with baoyu sources
    Given an adapter is ported from its baoyu source
    When its facts are compared (env criteria, default model, refModels)
    Then they match the corresponding config.example.yaml row and the baoyu ProviderSpec

  Scenario: R3 - google generates with mocked fetch
    Given GOOGLE_API_KEY is set and fetch is mocked to the baoyu-recorded Gemini response
    When a generation runs
    Then image bytes are emitted and parsed per the baoyu adapter contract

  Scenario: R4 - selection semantics unchanged
    Given credentials for multiple providers
    When selectProvider runs
    Then AUTO_ORDER and NEVER_AUTO behavior match the pre-port tests
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T16:54:56.312Z

1. Read baoyu types.ts diff vs kk's. 2. Port/google first (unblocks N/0114). 3. Port remaining in AUTO_ORDER slices. 4. Rewrite R4 selection tests. 5. bun run lint + test.

#### Q&A entry — 2026-09-11T16:55:08.218Z

- Decided: port all 12 baoyu adapters in ONE task (0115); google first (AUTO_ORDER head — unblocks feature N/0114 cover run on Google quota, no Ark dependency).
- Decided: view selection/AUTO_ORDER/NEVER_AUTO as frozen; adapters change generate/isAvailable wiring only.
- Deferred: wt HuggingFace backend → task 0116 (wt-only parity).

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
