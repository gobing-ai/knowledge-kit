---
schema_version: 1
name: Port all baoyu provider adapters into image-gen
status: done
template: feature-impl
created_at: 2026-09-11T16:54:52.610Z
updated_at: "2026-09-11T17:37:53.895Z"
feature_id: K

---

## 0115. Port all baoyu provider adapters into image-gen

### Background

The 12-row registry in `plugins/generations/image-gen/src/providers/types.ts` has only `seedream` as a wire-speaking adapter; the other 11 rows are `envOnlyProvider` shells whose generate() throws. `vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/*.ts` holds working TS adapters + tests for all 12 (same origin as the frozen registry facts) — port, do not re-develop.

### Requirements

- [x] R1. Replace each `envOnlyProvider` shell (agnes, azure, codex-cli, dashscope, google, jimeng, minimax, openai, openrouter, replicate, zai) with the corresponding baoyu adapter, adapted to the kk `ImageProvider`/`ImageRequest` interface and `ProviderOptions{fetch,env}` injection seam.
- [x] R2. Port each baoyu provider test as `<name>.test.ts` under `plugins/generations/image-gen/tests/`, mapped to the kk interface; keep every credential/model/base-URL env read consistent with `config.example.yaml` rows and `isAvailable()` semantics.
- [x] R3. Behavior: `google` and other AUTO_ORDER-head providers actually generate when their credentials are present; ref-image support must follow each spec's `refModels` list.
- [x] R4. Keep selection/invariants frozen: `AUTO_ORDER`, `NEVER_AUTO` ('codex-cli'), env precedence (real env wins over config block) unchanged.

### Acceptance Criteria
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

Ported all 11 remaining baoyu provider adapters as wire-speaking factories and rewired the registry.

- `plugins/generations/image-gen/src/providers/types.ts:12-23` — imports `create*` from each ported adapter file; every `PROVIDERS` row now binds a real `create`, replacing the `envOnlyProvider` shells; `AUTO_ORDER`/`NEVER_AUTO` and all ProviderSpec facts unchanged (frozen per task 0103).
- `plugins/generations/image-gen/src/providers/google.ts:1` (+ jimeng/minimax/openai/openrouter/dashscope/azure/agnes/jimeng/replicate/zai/codex-cli) — adapters ported from `vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/*.ts`; shape template `seedream.ts` (kk `ImageProvider` + `ProviderOptions{fetch,env}` seam preserved; mock-fetch tests via seam).
- `plugins/generations/image-gen/tests/providers/google.test.ts:1` (+ 10 sibling test files) — ported provider tests against mocked fetch; shared helpers moved to `plugins/generations/image-gen/src/providers/refs.ts:1`.
- `plugins/generations/image-gen/src/providers/zai.ts:68` — repaired corrupted `getRatioValue` left by the timed-out subagent run (stray `DEFAULT_MODEL` line removed).

Verification: `bun run lint` exit 0; `bun run test` 849 pass / 0 fail (plugin suite 191 pass); commit `ebd8c32`. Known pre-existing Bun 1.3.14 coverage exit-code quirk documented in `.spur/run/0115-verdict.json`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | commit ebd8c32; plugins/generations/image-gen/src/providers/{agnes,azure,codex-cli,dashscope,google,jimeng,minimax,openai,openrouter,replicate,zai}.ts + refs.ts; types.ts:12-23 imports create* factories; no remaining 'has no adapter yet' registry rows |
| R2 | MET | plugins/generations/image-gen/tests/providers/*.test.ts 11 files; plugin suite 191 pass; suite 849 pass / 0 fail; AUTO_ORDER/NEVER_AUTO unchanged in types.ts |
| R3 | MET | google multimodal + Imagen paths ported per baoyu source; helper tests cover URL/model/ref routing; follow-up: google.ts per-file func coverage 69.57%, aggregate 97.40/95.60 >= 90 bar |
| R4 | MET | bun run lint exit 0; bun run test 849 pass / 0 fail; pre-existing Bun 1.3.14 quirk documented (coverage exit 1 with 0 failures at clean HEAD) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | bun run lint | — |  |
| P4 | bun run test | — |  |
| P4 | git status | — |  |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-11T17:37:22.459Z backlog → todo (system)
- 2026-09-11T17:37:22.624Z todo → wip (system)
- 2026-09-11T17:37:51.310Z wip → testing (system)
- 2026-09-11T17:37:53.895Z testing → done (system)

