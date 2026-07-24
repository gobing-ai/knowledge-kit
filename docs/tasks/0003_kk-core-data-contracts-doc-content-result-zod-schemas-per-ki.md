---
template: feature-impl
schema_version: 1
name: "kk-core data contracts: Doc, Content, Result Zod schemas + per-kind contract"
description: ""
status: todo
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: ["kk", "platform", "contracts"]
dependencies: []
created_at: "2026-07-24T17:36:27.406Z"
updated_at: "2026-07-24T21:54:19.863Z"
---

## 0003. kk-core data contracts: Doc, Content, Result Zod schemas + per-kind contract

### Background

Foundational SDK for the kk plugin platform (feature B). Build FIRST — B1 (registry) and B3 (kk invoke) both depend on these schemas and the kind enum. New `packages/kk-core` workspace (@gobing-ai/kk-core) per ADR-001. The contract is a DATA contract exchanged as files/JSON (ADR-006 amendment 2026-07-24), not in-process TS classes. Covers B2 scenarios R1-R4. Rubric: E2 D1 L1 C0 R1 = 5 -> task (one module, one deliverable, load-bearing).

### Requirements
- [ ] R1. Export Zod schemas for Doc, Content, and Result from `@gobing-ai/kk-core`; well-formed payloads parse to typed values.
- [ ] R2. Malformed payloads (missing a required field) fail parsing with a field-level error naming the offending field.
- [ ] R3. Provide per-kind contract resolution: ingestion → output `Doc[]`; generator → input `Doc[]` / output `Content`; publish → input `Content` / output `Result`.
- [ ] R4. Export inferred TypeScript types (`Doc`, `Content`, `Result`) so consumers need not redefine the shapes.
### Acceptance Criteria
```gherkin
Feature: Typed lifecycle contracts

  @core
  Scenario: R1 — Doc, Content, and Result schemas validate well-formed payloads
    Given the @gobing-ai/kk-core package exports Zod schemas for Doc, Content, and Result
    When a well-formed payload for each type is parsed
    Then parsing succeeds and returns a typed value

  @core
  Scenario: R2 — Schemas reject a malformed payload with a field-level error
    Given the Doc, Content, and Result Zod schemas
    When a payload missing a required field is parsed
    Then parsing fails with an error naming the offending field

  @core
  Scenario: R3 — Each plugin kind declares its input and output contract
    Given the three plugin kinds ingestion, generator, and publish
    When the contract for a kind is resolved
    Then ingestion declares output Doc list, generator declares input Doc list and output Content, and publish declares input Content and output Result

  @edge
  Scenario: R4 — Inferred TypeScript types are exported for consumers
    Given the kk-core package
    When a consumer imports the inferred Doc, Content, and Result types
    Then the types are available without redefining the shapes
```
### Q&A
**Mode:** `--auto` (no interactive Q&A). Synthesized from task Background/Requirements, feature B2 AC, ADR-006 amendment 2026-07-24, and task 0001 generator contract notes.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package name | `@gobing-ai/kk-core` under `packages/kk-core` | ADR-006 amendment + task Background |
| Contract style | Zod data schemas, not TS class methods | ADR-006 amendment (skill-first / file-JSON exchange) |
| Field richness | Minimal required + `metadata` escape hatch | Unblocks B1/B3 without baking Karakeep/Surfdash DTOs into core |
| Ingestion input | `null` at contract layer | Source path is invoke/registry concern (0005/0004), not Doc payload |
| Zod dependency | Direct on `zod` | Keep contracts package pure; align version with monorepo practice |
| AC source | Feature B2 scenarios R1–R4 copied with stable titles | Traceability edge; do not rename scenarios after link |
### Design
**Approach.** Add workspace package `packages/kk-core` (`@gobing-ai/kk-core`) as the pure data-contract SDK for the kk plugin platform (ADR-006 amendment 2026-07-24). Schemas are Zod (v4, same pin family as `packages/utils`); types are `z.infer<>` exports. No runtime plugin classes, no I/O, no discovery — those land in B1 (`0004`) and B3 (`0005`).

**Package layout**

- `packages/kk-core/package.json` — name `@gobing-ai/kk-core`, `exports["."]` → `./src/index.ts`, dependency `zod` (direct; keep kk-core free of logger/CLI coupling)
- `packages/kk-core/tsconfig.json` — extends `tooling/typescript/base.json`
- `packages/kk-core/src/schemas.ts` (or split files) — `DocSchema`, `ContentSchema`, `ResultSchema` + array helpers
- `packages/kk-core/src/kinds.ts` — `PluginKind` + `kindContract(kind)` resolution table
- `packages/kk-core/src/index.ts` — public barrel (schemas, types, kind API only)
- `packages/kk-core/tests/*.test.ts` — bun:test; happy path + missing-field path per schema; kind table assertions

**Minimal field shapes (v1 — stable enough for B1/B3 file/JSON exchange)**

| Type | Required | Optional | Notes |
|------|----------|----------|-------|
| `Doc` | `id` (string), `body` (string) | `title`, `sourceUri`, `mediaType`, `metadata` (record) | One ingested document unit; `body` is the primary text/markdown payload |
| `Content` | `body` (string) | `title`, `format` (default `"markdown"`), `outline`, `references` (array of `{ url?, title?, cite? }`), `metadata` | Generator article/output; mirrors task 0001 contract implication |
| `Result` | `ok` (boolean), `target` (string) | `url`, `id`, `message`, `error` (string when `ok=false`), `metadata` | Publish outcome; fail-loud path uses `ok: false` + `error` (B3 invoke will exit non-zero on schema/run failure) |

**Per-kind contract API**

```ts
type PluginKind = 'ingestion' | 'generator' | 'publish';

// Resolved shape (schemas, not class methods):
// ingestion → { input: null, output: z.array(DocSchema) }
// generator → { input: z.array(DocSchema), output: ContentSchema }
// publish   → { input: ContentSchema, output: ResultSchema }

function kindContract(kind: PluginKind): KindContract
```

Unknown kind → throw (or Zod-discriminated parse of kind string) so B3 can fail loud.

**Invariants**

1. Contract is **data** (JSON/files), not in-process TS classes with lifecycle methods.
2. Public surface is schemas + inferred types + `PluginKind` / `kindContract` only — no filesystem, no process spawn.
3. Parse errors must surface the offending path/field (Zod issue path); do not swallow into generic messages.
4. Workspace import path is always `@gobing-ai/kk-core` (ADR-001 boundary).

**Tradeoffs**

- **Minimal fields vs rich domain models:** v1 stays thin so Karakeep/Surfdash adapters (C/E) can extend via `metadata` without breaking the core. Rejected: modeling full Karakeep bookmark graphs or Surfdash post DTOs inside kk-core.
- **Direct `zod` dep vs re-export from `@gobing-ai/utils`:** prefer direct `zod` so contracts stay usable without logger/utils. Consumers may still import `z` from either package; version must stay aligned with root pin practice.
- **`input: null` for ingestion:** source path is an invoke-time flag (`kk invoke …`), not part of the Doc/Content/Result exchange; registry/invoke own that (B1/B3).

**Impacted surfaces**

- New: `packages/kk-core/**`
- Consumers (not this task): `0004` registry, `0005` `kk invoke` validation, later plugins C/D/E
- Docs (same-commit if surface lands in CLI later): none for this package-only task beyond optional `03` table row when implement updates architecture

**Out of scope**

- `plugin.json` / filesystem discovery (B1 / `0004`)
- `kk invoke` CLI subcommand and spur workflow template (B3 / `0005`)
- Concrete plugin implementations (C, D, E)
### Plan
- [ ] Scaffold `packages/kk-core` workspace (`package.json` name `@gobing-ai/kk-core`, `tsconfig`, `src/`, `tests/`) so Bun workspaces pick it up under `packages/*`
- [ ] Implement `DocSchema`, `ContentSchema`, `ResultSchema` with the v1 required/optional fields from Design; export `z.infer` types `Doc`, `Content`, `Result`
- [ ] Implement `PluginKind` + `kindContract(kind)` table (ingestion / generator / publish I/O as designed); reject unknown kind
- [ ] Barrel-export public API from `src/index.ts` only
- [ ] Unit tests: well-formed parse success for each schema; missing-required-field failures assert path/field; kind-contract resolution for all three kinds + unknown-kind error
- [ ] Run `bun run lint` and `bun run test` (package + monorepo); confirm workspace resolves `@gobing-ai/kk-core`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

B2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
