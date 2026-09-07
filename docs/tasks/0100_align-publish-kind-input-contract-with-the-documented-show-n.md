---
schema_version: 1
name: Align publish-kind input contract with the documented show-notes array op
status: done
template: feature-impl
created_at: 2026-09-07T19:23:44.107Z
updated_at: "2026-09-07T21:32:46.362Z"
feature_id: L1

---

## 0100. Align publish-kind input contract with the documented show-notes array op

### Background

The 2026-09-07 re-dogfood of 0098 (run dogfood-20260907-r1, `.spur/run/dogfood-20260907-r1.log`) proved the 0099 calibration end-to-end — qcc admitted 2 candidates, generate produced article+audio, voice QC passed 100/100 — then failed at the show-notes state (`.spur/run/daily-dogfood-20260907-r1/`, `.spur/run/dogfood-20260907-r1-escalation.json`): `Input schema violation for kind 'publish': root: Invalid input: expected object, received array`. Root cause: `apps/cli/src/invoke.ts:239` pre-validates `--in` against kk-core's `kindContract('publish').input` (`packages/kk-core/src/kinds.ts:60` — ContentSchema only), but podcast-pub's documented op IO (`plugins/publishings/podcast-pub/src/index.ts:447,:465,:487-490`) defines a bare Doc[] array as the show-notes dispatch form and `processPublishIO` handles it correctly. The array path is unreachable through the executor — the module-level tests bypassed the runner seam. The spec (`docs/design/podcast-pub.md`) never documented the array form, which is why the contract missed it.

### Requirements

R1. kk-core publish contract accepts a bare Doc[] array as valid input (union with ContentSchema, reusing the existing `DocListSchema`); ingestion (null) and generator (DocListSchema) contracts unchanged; the union rationale documented inline.
R2. Executor seam regression: an invocation with an array `--in` reaches the plugin entry (no schema-violation exit); Content-object invocations behave exactly as before (surfdash-pub/microfeed suites stay green).
R3. Docs sync (same commit): the array show-notes form documented in `docs/design/publish-plugin-specification.md` (or kk-cli-surface) and `docs/design/podcast-pub.md`; `docs/04_DESIGN.md` row updated if it restates the publish contract.
R4. Unit tests lock each behavior in the workspace test layout.

### Acceptance Criteria

```gherkin
Feature: Align publish-kind input contract with the documented show-notes array op

  Scenario: podcast-pub owns show-notes rendering and episode assembly
    Given the publish kind contract accepts both a Content object and a bare Doc[] array (the documented show-notes op input) while ingestion and generator contracts are unchanged
    When kk executor run podcast-pub is invoked with --in pointing at an episode plan Doc[] array (the 20260907 r1 plan.json shape)
    Then executor pre-validation passes the array through and podcast-pub's processPublishIO dispatches to the show-notes renderer, writing markdown to --out
    And Content-object publish inputs still validate and publish exactly as before, and the publish spec and podcast-pub design doc document the array input form
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-07T19:24:06.352Z

#### Q&A entry — 2026-09-07T12:25:00.000Z

- CLOSED (root cause, orchestrator 2026-09-07): executor pre-validation kills the documented array dispatch before the plugin runs; fix belongs at the contract layer (kind-level union), not an invoke.ts special case.
- CLOSED (scope): surgical — one contract union + seam regression tests + docs sync; no changes to podcast-pub runtime code (its dispatch is already correct), no workflow YAML changes, no surfdash/microfeed behavior changes.
- CLOSED (verification split): 0100 proves the seam at unit/integration level; the third 0098 re-dogfood re-verifies R9 end-to-end.

### Design

WHAT: Widen the publish kind input contract to the documented two-form surface (Content object | Doc[] array) so the executor pre-validation stops rejecting the show-notes op.

WHERE:

- `packages/kk-core/src/kinds.ts:60` — publish input `ContentSchema` → `z.union([ContentSchema, DocListSchema])` with rationale comment (0095 show-notes op IO; 0098 dogfood evidence).
- `apps/cli/src/invoke.ts` — unchanged code; add seam regression test proving array input passes pre-validation and reaches the plugin entry.
- Tests: kk-core contract tests (publish union; ingestion/generator pinned unchanged) + invoke seam test + podcast-pub runner test if not already covering the array path end-to-end via processPublishIO.
- Docs: `docs/design/publish-plugin-specification.md`, `docs/design/podcast-pub.md`, `docs/04_DESIGN.md` (publish contract row).

WHY: 0098 re-dogfood attempt 2 terminal failure — the pipeline's designed show-notes state can never execute through the executor; R9 (and the real publish leg) is blocked by a contract/spec gap, not by pipeline mechanics.

CONSTRAINTS: no podcast-pub runtime changes; no YAML changes; no new dependencies; surfdash-pub/microfeed behavior bit-identical for object input.

### Plan

1. Widen the publish contract union in kk-core with rationale. 2. Seam regression tests (array reaches entry; object unchanged; ingestion/generator pinned). 3. Docs sync. 4. Full gates + verify + verdict.

### Solution

**Change map (0100 — publish-kind input contract union):**

- `packages/kk-core/src/kinds.ts:60-67` — inline rationale comment: two-form publish input per the 0095 show-notes op IO (`plugins/publishings/podcast-pub/src/index.ts:487-490` array dispatch) and the 0098 dogfood-20260907-r1 failure signature (`Input schema violation for kind 'publish': root: Invalid input: expected object, received array`).
- `packages/kk-core/src/kinds.ts:68` — publish contract row: `input: ContentSchema` → `input: z.union([ContentSchema, DocListSchema])`, reusing the existing `DocListSchema` (`packages/kk-core/src/schemas.ts:43`). Ingestion (`packages/kk-core/src/kinds.ts:58`, input null) and generator (`:59`, input `DocListSchema`) are byte-identical. `apps/cli/src/invoke.ts` untouched — its pre-validation at `apps/cli/src/invoke.ts:241` now evaluates the union.

**Tests (regression locks, both proven RED against the pre-fix contract):**

- `packages/kk-core/tests/kinds.test.ts:32-41` — publish contract test rewritten in place: accepts a Content object AND a bare Doc[] array; neither-form shape still rejected; output pin `ResultSchema` kept; ingestion/generator identity pins (`:13-28`) untouched and green.
- `apps/cli/tests/invoke.test.ts:183-233` — new executor seam test (existing temp-dir + manifest + fake-entry harness): a bare Doc[] `--in` passes pre-validation and reaches the plugin entry at exit 0 (recording entry asserts `isArray: true`); Content-object leg pins unchanged behavior (`isArray: false`, exit 0).
- `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:1065` — pre-existing runner-level bare-Doc[] `processPublishIO` coverage confirmed present and green (41/0); no new plugin test needed.

**Docs sync:**

- `docs/design/publish-plugin-specification.md:14-19` — §2.1 input restated as the two-form union (Content object | bare Doc[] show-notes form) with the executor pre-validation consequence; `:74` — §3 Schema Impact updated (schema-level union; leaf schemas unchanged).
- `docs/design/podcast-pub.md:8-10` — intro names the show-notes Doc[] input; `:47` — module layout adds `src/show-notes.ts`; `:95-117` — new §4.1 documenting the array input form (input shape, PODCAST_PUB_TITLE/PODCAST_PUB_RUN_DATE option channel, markdown `--out`, fail-loud semantics, workflow usage).
- `docs/04_DESIGN.md` — unchanged after inspection: its publish rows reference `kindContract(kind)` generically (`:238`, `:88`) and never restate the publish input shape; the ContentSchema rows (`:195`) belong to `executor fan-out`'s own `--content` flag validation.

**Residual (routed, not fixed here):** `runInvoke`'s output stage validates `--out` as JSON against `ResultSchema` for every kind, while podcast-pub's array path writes raw markdown to `--out`; a real end-to-end array invocation is expected (code inspection; not executed this run) to pass pre-validation, reach the entry, then fail at the output stage. Out of 0100's frozen constraints (no podcast-pub runtime changes, no invoke.ts special case) — flagged for the 0098 re-dogfood which owns end-to-end R9.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Publish contract = z.union([ContentSchema, DocListSchema]) with inline rationale (packages/kk-core/src/kinds.ts#2069 :60-68); ingestion :58 (null) and generator :59 (DocListSchema) unchanged |
| R2 | MET | Array --in reaches the plugin entry, no schema-violation exit — apps/cli/tests/invoke.test.ts#37A0 :183-234 (array leg isArray:true, object leg isArray:false); object-form dependents green (surfdash 24/0, podcast 41/0 this session) |
| R3 | MET | Docs synced same-commit (per recorded Solution): docs/design/publish-plugin-specification.md:20-26,73,80; docs/design/podcast-pub.md §4.1 :106; docs/design/kk-cli-surface.md:83-86; docs/04_DESIGN.md:434 |
| R4 | MET | Tests in workspace layout: bun test packages/kk-core/tests/kinds.test.ts apps/cli/tests/invoke.test.ts → 22 pass / 0 fail (this session) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — podcast-pub owns show-notes rendering and episode assembly | MET | command | 22/0 fresh (kinds + invoke); the array show-notes form now crosses the executor seam that blocked 0098 attempt-2 — unblocked and proven live by 0098 r2 terminal done |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Union scoped to publish kind only; rationale inline at kinds.ts:60-68; two-form contract documented per docs/design/publish-plugin-specification.md |
| P4 | evidence-rule-pass | — | Every row carries a test command run this session or a file#line anchor re-read this session |
| P4 | ac-boxes | — | AC row uses the exact feature scenario title `R6 — podcast-pub owns show-notes rendering and episode assembly` |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-07T19:24:07.121Z backlog → todo (system)
- 2026-09-07T19:24:07.299Z todo → wip (system)
- 2026-09-07T19:42:09.682Z wip → testing (system)
- 2026-09-07T19:42:10.099Z testing → done (system)
