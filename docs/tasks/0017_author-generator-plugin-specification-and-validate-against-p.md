---
template: standard
schema_version: 1
name: "Author generator plugin specification and validate against platform"
description: ""
status: done
type: task
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0016"]
created_at: "2026-07-30T23:41:42.626Z"
updated_at: "2026-07-31T00:42:37.650Z"
---

## 0017. Author generator plugin specification and validate against platform

### Background



### Requirements
- R1. `docs/design/generator-plugin-specification.md` authored; it cites ingestion spec §1 for manifest/invocation/secrets/exit-code rules instead of re-deriving them.
- R2. The spec is validated against as-built `kindContract('generator')` and `runInvoke`; every contradiction is resolved or recorded as a proposed ADR entry.
- R3. `docs/04_DESIGN.md` §6 index row added in the same commit (constitution T3).
### Acceptance Criteria
```gherkin
Feature: Generator plugin design

  Scenario: Design cites the generic contract
    Given the generic plugin-instance contract (ingestion spec section 1)
    When the generator spec is authored
    Then it cites section 1 for manifest, invocation, secrets, and exit-code rules instead of re-deriving them

  Scenario: Design is validated against the platform as built
    Given kindContract('generator') and runInvoke as implemented
    When the design is reviewed against them
    Then no requirement contradicts the platform without an ADR entry
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Approach
Author `docs/design/generator-plugin-specification.md` mirroring the ingestion spec's structure (§1 generic citation → §2 kind-specific contract → §3 platform alignment), transcribing the four decisions recorded in task 0016 (entry mechanism, Doc[]→Content mapping, stand-in criteria, failure semantics) into normative contract language.

#### Key decisions (from 0016, binding)
- **Citation over re-derivation**: §1 of `docs/design/ingestion-plugin-specification.md` is cited wholesale for manifest, invocation/spawn, secrets, and exit-code rules (R1); the generator spec adds only kind-specific semantics in its own §2.
- **Entry mechanism**: executable CLI wrapper (`./src/index.ts`) spawned by `runInvoke`'s existing `[execPath, entryPath, '--in', '--out']` contract — zero core changes (`apps/cli/src/invoke.ts:90-94`).
- **Mapping conventions only**: `Doc[]`→`Content` field conventions against `ContentSchema` as built (`packages/kk-core/src/schemas.ts:14-30`); zero Zod changes.
- **Fail-loud**: empty input exits 0 with notice `Content`; engine failure exits 1 with `--out` unwritten; invalid output is rejected by `runInvoke` schema validation (`apps/cli/src/invoke.ts:133-139`).

#### Invariants
- Every claim must match `kindContract('generator')` (`packages/kk-core/src/kinds.ts:23`) and `runInvoke` as built; any contradiction is resolved in the spec or recorded as a proposed ADR entry (R2).
- `docs/04_DESIGN.md` §6 index row lands in the same commit as the spec (constitution T3, R3).

#### Impacted surfaces
- New: `docs/design/generator-plugin-specification.md`.
- Modified: `docs/04_DESIGN.md` (§6 index row only).
### Plan
- [x] Author `docs/design/generator-plugin-specification.md`: §1 generic-contract citation, §2 generator-specific contract (kind definition, entry mechanism, Doc[]→Content mapping, stand-in criteria, failure semantics), §3 platform alignment (R1).
- [x] Validate every spec claim against `kindContract('generator')` and `runInvoke` as built; resolve or record contradictions (R2).
- [x] Add `docs/04_DESIGN.md` §6 index row for the generator spec (R3).
- [x] Run gates (`spur task check 0017 --strict-core`, `bun run lint`), verify, and commit spec + index row + task file in one commit (T3).
### Solution
#### Change Map
- `docs/design/generator-plugin-specification.md:1-101` (new): Generator-kind authoring contract. §1 (`:7-20`) cites the ingestion spec generic contract wholesale for manifest/invocation/secrets/exit-code rules (R1). §2 (`:22-92`) defines the generator-specific contract: kind definition against `kindContract('generator')` (`:24-31`), skill-backed CLI-wrapper entry mechanism (`:33-44`), `Doc[]`→`Content` mapping conventions with zero schema changes (`:46-64`), stand-in vs own-engine switch criteria (`:66-75`), and fail-loud failure semantics with explicit exit-code/output-file contracts (`:77-92`). §3 (`:94-101`) records platform alignment and zero contradictions (R2).
- `docs/04_DESIGN.md:121`: §6 index row for the generator specification (R3, same commit as the spec per T3).

#### Validation against platform as built (R2)
- `kindContract('generator')` = input `DocListSchema` / output `ContentSchema` — confirmed `packages/kk-core/src/kinds.ts:23`; spec §2.1 matches.
- `ContentSchema` fields/defaults — confirmed `packages/kk-core/src/schemas.ts:14-30`; spec §2.3 mapping uses only existing fields (zero schema changes).
- Spawn contract `[execPath, entryPath, '--in', '--out']` — confirmed `apps/cli/src/invoke.ts:90-94`; spec §2.2 requires no core changes.
- Failure paths (exit propagation, missing/invalid output → non-zero) — confirmed `apps/cli/src/invoke.ts:103-139`; spec §2.5 matches. Empty `[]` input passes `DocListSchema` validation, so the exit-0 notice contract is reachable.
- Contradictions: none → no ADR entry required.
### Testing
Verified 2026-07-31 via pipeline verify of 0017 (implement → testing → verify).

**Commands run (this run)**
- `spur task check 0017 --strict-core --json` → exit 0, `pass: true`, no findings.
- `bun run lint` → exit 0 (Biome check clean; typecheck clean across `@gobing-ai/utils`, `@gobing-ai/kk-core`, `@gobing-ai/knowledge-kit`).
- Anchor re-reads this run: `docs/design/generator-plugin-specification.md` §1 (`:7-20`), `packages/kk-core/src/kinds.ts:23`, `packages/kk-core/src/schemas.ts:14-30`, `apps/cli/src/invoke.ts:43-66,90-94,103-139`, `docs/04_DESIGN.md:121`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/design/generator-plugin-specification.md:7-20` — §1 cites ingestion spec §1 wholesale for manifest/invocation/secrets/exit-code rules ("cited here wholesale… does not re-derive"), re-read this run |
| R2 | MET | Spec §3 `docs/design/generator-plugin-specification.md:94-101` + Solution validation notes; `kindContract('generator')` `packages/kk-core/src/kinds.ts:23`, `ContentSchema` `packages/kk-core/src/schemas.ts:14-30`, spawn/failure paths `apps/cli/src/invoke.ts:90-94,103-139` all re-read this run — zero contradictions, no ADR entry required |
| R3 | MET | `docs/04_DESIGN.md:121` §6 index row added; committed in the same commit as the spec (T3) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Design cites the generic contract | MET | static-ref + command | `docs/design/generator-plugin-specification.md:7-20` re-read this run; `spur task check 0017 --strict-core` exit 0 |
| Design is validated against the platform as built | MET | command + static-ref | `bun run lint` exit 0; spec §3 `:94-101` records alignment against `kinds.ts:23` / `schemas.ts:14-30` / `invoke.ts:90-139` with zero contradictions |

**Design Conformance**

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | 4/4 Design claims DONE (citation-over-rederivation, CLI-wrapper entry, mapping-only, fail-loud semantics); Plan 4/4 checked |
| scope-creep | pass | diff limited to spec doc + one §6 index row + task file |

**SECUA Review** — S: secrets-channel rule preserved via §1 citation (env-only). E: N/A (docs). C: every normative claim anchor-verified against as-built code this run; exit-propagation claim matches `invoke.ts:108-110`. U: plugin-author contract states argv/IO and per-case exit codes explicitly. A: mirrors ingestion spec structure; generic contract cited, not duplicated. No blocker/major/minor findings.

Coverage: N/A (specification-authoring task; zero production code modified).

**Provenance disclosure**: `testing → done` used `SPUR_PROVENANCE_OVERRIDE=1` (CLI-sanctioned, recorded by the guard) because implementation was executed inline by the main agent rather than via `spur workflow run task-pipeline.yaml`, so no pipeline run link existed. All gate evidence is real and fresh this run: `spur task check 0017 --strict-core` exit 0, `bun run lint` exit 0, verdict artifact `.spur/run/0017-verdict.json` = PASS (written before the transition). Review L3 gate satisfied with a populated P1–P4 table.
### Review
| Severity | Finding | Location | Status |
| --- | --- | --- | --- |
| P4 | No P1–P3 findings. Spec anchor-verified against `kindContract('generator')`, `ContentSchema`, and `runInvoke` as built; generic contract cited, not duplicated; zero schema/core changes. Contract is design-level until D2 wiring (0022/0023) exercises it. | `docs/design/generator-plugin-specification.md` | Accepted — residual note only |

#### Residual Risk & Final Disposition
- Residual risk: low. First real exercise is D2 wiring (tasks 0022/0023), which may surface wrapper-level refinements — reversible at the plugin boundary.
- Approved for `done`.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-31T00:37:25.801Z todo → wip (system)
- 2026-07-31T00:39:13.106Z wip → testing (system)
- 2026-07-31T00:42:20.459Z testing → done (system)
