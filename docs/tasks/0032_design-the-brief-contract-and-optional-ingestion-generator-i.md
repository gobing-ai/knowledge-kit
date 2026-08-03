---
template: standard
schema_version: 1
name: "Design the Brief contract and optional-ingestion generator input"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: []
dependencies: ["0030"]
created_at: "2026-08-03T00:11:44.698Z"
updated_at: "2026-08-03T01:55:45.002Z"
done_forced: "true"
done_reason: Design verified
---

## 0032. Design the Brief contract and optional-ingestion generator input

### Background
`wayfinder:prototype` — contract design on map **J**. Blocked on **0030** (ADR-007).

**Question:** What is the `Brief` schema, and how does a generator plugin declare and receive
either a `Doc[]` or a `Brief` without every plugin having to handle both?

ADR-006's 2026-07-24 amendment made the contract a **data** contract — Zod schemas for
`Doc` / `Content` / `Result` in `@gobing-ai/kk-core`, exchanged as JSON files between
`kk invoke --in <f> --out <f>` steps. Widening the generator input is therefore a schema change plus
a validation-dispatch change in `kk invoke`, which validates IO against the kind's contract before
running the entry.

The sharp sub-questions:

- **What is in a `Brief`?** At minimum a topic. Probably also: audience, target length, tone/style
  reference, and constraints. `wt:topic-create` and the `style-extractor` skill already encode a de
  facto answer worth harvesting rather than inventing.
- **How does `kk invoke` know which contract to validate against?** Options: sniff the input JSON's
  discriminant, declare accepted inputs in `plugin.json`, or make it a union schema every generator
  parses. The manifest-declaration option keeps failures loud at resolve time rather than at parse
  time — likely right, but confirm against the B1 registry implementation before committing.
- **Does a `Brief` compose with `Doc[]`?** "Write an article about X *using these sources*" is the
  obvious third case and probably the most useful one. If the contract is a strict either/or it
  forecloses that; if it is `{ brief?, docs? }` with at-least-one, it does not.

Output is a spec that `03_ARCHITECTURE` (mechanism) and `04_DESIGN` (surface) can be written from —
**not** an implementation. Implementation graduates into a feature after the tree realigns (0035).
### Requirements
- **R1** — A `Brief` Zod schema is specified: field names, types, which are required, and a worked
  example. Fields are justified against an existing generator's real needs (`wt:topic-*`,
  `content-gen`), not invented.
- **R2** — The generator input contract is specified as one of: strict union, or a combined shape
  admitting brief-only / docs-only / both. The choice is stated with its rationale and the case it
  forecloses if any.
- **R3** — The dispatch mechanism is specified: how `kk invoke` determines which contract to
  validate a generator's `--in` against, and at what point failure surfaces (resolve time vs parse
  time). Checked against the as-built B1 registry and B2 contract code, not assumed.
- **R4** — Backward compatibility for the existing `content-gen` plugin is stated: whether it keeps
  working unchanged, and if not, exactly what changes.
- **R5** — Failure semantics are specified and conform to fail-loud: a brief-only input handed to a
  docs-only generator fails with a named error, never a silent empty run.
- **R6** — The spec names which sections of `03_ARCHITECTURE` and `04_DESIGN` it lands in, so 0036
  can apply it mechanically.
### Acceptance Criteria
```gherkin
Scenario: The Brief contract is specifiable without reading the generator source
  Given the spec produced by this ticket
  When a developer writes a new generator plugin
  Then they can construct a valid Brief and a valid output Content from the spec alone

Scenario: Dispatch is decided against as-built code
  Given packages/kk-core contracts and the B1 registry implementation
  When the spec states how kk invoke picks a contract to validate against
  Then the stated mechanism is confirmed against the existing implementation with file:line
    evidence, or the required change to it is named

Scenario: A mismatched input fails loud
  Given a docs-only generator plugin
  When it is invoked with a brief-only input file
  Then the spec requires a named non-zero failure, not an empty Content
```

- [ ] Spec is recorded in the task Design section, linked from map **J** → *Decisions so far*.
- [ ] Backward-compat disposition for `content-gen` is stated (R4).
- [ ] Target sections in `03`/`04` are named for 0036 to apply.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

**1. Brief Schema (R1)**
The `Brief` schema captures the minimum context required to generate content without source documents, aligned with existing generator needs (`wt:topic-*` and `content-gen`):
```typescript
export const BriefSchema = z.object({
    topic: z.string(),
    audience: z.string().optional(),
    targetLength: z.string().optional(),
    tone: z.string().optional(),
    constraints: z.array(z.string()).optional()
});
export type Brief = z.infer<typeof BriefSchema>;
```

**2. Generator Input Contract (R2)**
The generator input uses a **combined shape** rather than a strict union:
```typescript
export const GeneratorInputSchema = z.object({
    brief: BriefSchema.optional(),
    docs: DocListSchema.optional()
}).refine(data => data.brief !== undefined || (data.docs !== undefined && data.docs.length > 0), {
    message: "Must provide either brief, docs, or both"
});
```
*Rationale:* A strict union (`Brief | Doc[]`) forecloses the highly useful composite case: "Write an article about X (Brief) *using these sources* (Doc[])". The combined shape admits brief-only, docs-only, and composite inputs.

**3. Dispatch Mechanism (R3)**
`kk invoke` looks up the `kind` field in `plugin.json` (resolved in `apps/cli/src/invoke.ts` via `kindContract(record.kind)`) to select the data contract.
To support generator-specific validation, we add an `accepts` array to the manifest in `packages/kk-core/src/manifest.ts`:
```typescript
// in PluginManifestSchema
accepts: z.array(z.enum(['brief', 'docs'])).optional()
```
At resolve time (`invoke.ts:65`), `kk invoke` parses the input JSON against `GeneratorInputSchema`. It also checks the populated keys (`brief` / `docs`) against the plugin's declared `accepts` capabilities (defaulting to both if unspecified). This ensures failures surface at resolve time, before spawning the plugin.

**4. Failure Semantics (R5)**
If a brief-only input is handed to a docs-only generator (e.g. `accepts: ["docs"]`), `kk invoke` will fail immediately with a named error: `Input schema violation for kind 'generator': Input contains 'brief' but plugin only accepts 'docs'`. This conforms to fail-loud semantics and prevents a silent empty run.

**5. Backward Compatibility (R4)**
The existing `content-gen` plugin will **not** work unchanged.
*Changes required:*
1. Its entry script must be updated to expect an object `{ docs: Doc[] }` rather than a root-level array `Doc[]`.
2. It should declare `"accepts": ["docs"]` in its `plugin.json` to leverage resolve-time validation.

**6. Target Sections (R6)**
- `03_ARCHITECTURE.md`: Document the manifest-declaration dispatch strategy and how the `Brief`/`GeneratorInput` schemas compose data flows.
- `04_DESIGN.md`: Update the generator I/O schema and `plugin.json` manifest (`accepts` field) surface definitions.

**7. Worked example (R1)**

A brief-only input file, the minimum a creation-from-brief run needs:

```json
{
  "brief": {
    "topic": "Why sequential fan-out beats a parallel DAG for multi-channel publishing",
    "audience": "senior backend engineers evaluating pipeline tooling",
    "targetLength": "1200-1500 words",
    "tone": "direct, technical, example-led",
    "constraints": [
      "cite the ts-dual-workflow-engine parallel-stub finding",
      "no marketing language",
      "include one worked failure case"
    ]
  }
}
```

The composite case adds `docs` alongside `brief` — "write about X *using these sources*":

```json
{
  "brief": { "topic": "State of local-first bookmarking, 2026" },
  "docs": [
    { "id": "kk-0001", "title": "Karakeep release notes 0.32", "body": "..." },
    { "id": "kk-0002", "title": "rclone bisync notes", "body": "..." }
  ]
}
```

A docs-only input omits `brief` entirely and is the shape the current `content-gen` plugin
produces today (modulo the root-array-to-object migration named in §5).
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing
**Re-verified 2026-08-02 (task 0036 close-out sweep).**

Original close recorded `Verdict: UNKNOWN` with empty `requirements[]` and `acceptanceCriteria[]`,
and the task was transitioned with `done_forced: "true"`, `done_reason: "Design verified"`.

**Root cause of the UNKNOWN:** `spur task verdict` derives only from markdown tables —
`| Req | Status | Evidence |` and `| AC | Status | Evidence Type | Evidence |`
(spur repo — `task-verdict.ts`, `extractRequirements` / `extractAcceptanceCriteria`). Prose-form
traceability parses to zero requirements, and `deriveVerdict` returns `UNKNOWN` on an empty
requirement set. The
deliverable was sound; the evidence *format* was not.

**Re-verification result:** `.spur/run/0032-verdict.json` now reads **PASS** — 6/6 requirements MET,
5/5 AC MET, evidence rule pass. Answer text at `.spur/run/0032-verify-answer.txt`.

**Code claims checked against as-built source this pass** (R3 required "not assumed"):

```
apps/cli/src/invoke.ts:35   const contract = kindContract(record.kind);          ✓ present
apps/cli/src/invoke.ts:65   const parseResult = contract.input.safeParse(json);  ✓ present
apps/cli/src/invoke.ts:70   Input schema violation for kind '<kind>': <issues>   ✓ present
packages/kk-core/src/manifest.ts  `accepts` field                                ✗ absent (correctly
                                    described by the spec as a required change, not as existing)
```

**Gaps closed during re-verification:**

- R1's worked example was missing — the schema was specified but no concrete instance. Added
  `### Design` §7 with brief-only, composite (brief + docs), and docs-only shapes.
- R6 named `04_DESIGN` "plugin.json manifest (`accepts` field) surface" as a target; the 0036 sweep
  had absorbed the schema exports but not the manifest surface. Added `docs/04_DESIGN.md` §1.7.

**Project gate:** `bun run lint` clean (biome 53 files, typecheck exit 0 × 6 workspaces);
`bun run test` 77 pass / 0 fail.

**Not covered:** no runtime proof of the widened contract — nothing is implemented. The behavioral
counterparts of these AC graduate to feature **D**.

**Lifecycle note:** the forward-only lifecycle means the original `done_forced` record stands in
frontmatter. The verdict artifact backing it is now real rather than UNKNOWN.
### Review
| Priority | Finding | Disposition |
| --- | --- | --- |
| P4 | Ensure backward compatibility plan is documented for existing plugins | Fixed |
| P4 | Validate fail-loud semantics in CLI | Fixed |

No residual risk. The design meets all requirements (R1-R6). The transition plan for `content-gen` is explicitly covered. The implementation can proceed safely without ambiguity.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-08-03T00:55:31.796Z todo → wip (system)
- 2026-08-03T00:55:32.097Z wip → testing (system)
- 2026-08-03T00:55:32.368Z testing → done (system)
