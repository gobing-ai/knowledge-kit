# Generator Plugin Specification

This specification defines the authoring contract for Knowledge-Kit `generator`-kind plugins. It
transcribes the decisions recorded in task 0016 (feature D3) into normative language and is
validated against the platform as built.

## 1. Generic Plugin-Instance Authoring Contract

The generic plugin-instance contract — manifest (§1.1), invocation & entry spawn (§1.2),
extra-config & secrets channels (§1.3), and exit code & validation (§1.4) — is defined by
[Ingestion Plugin Specification §1](./ingestion-plugin-specification.md#1-generic-plugin-instance-authoring-contract)
and is **cited here wholesale**. Generator plugins MUST conform to it; this document does not
re-derive those rules. In particular:

- The manifest conforms to `PluginManifestSchema` with `kind: "generator"` (generic §1.1).
- Entries are spawned by `runInvoke` as `[process.execPath, entryPath, '--in', absInPath, '--out', absOutPath]`
  with full `process.env` inheritance (generic §1.2).
- Secrets are passed exclusively via environment variables, never via `plugin.json` or disk (generic §1.3).
- Exit code `0` REQUIRES a JSON file at `--out` satisfying the kind's output schema; any non-zero
  exit REQUIRES diagnostics on `stderr` (generic §1.4).

## 2. Generator-Specific Contract

### 2.1 Kind Definition

- `kind`: `"generator"`
- `input`: `DocListSchema` (`z.array(DocSchema)`) — `runInvoke` parses and validates the `--in` JSON
  against `DocListSchema` before spawning the entry.
- `output`: `ContentSchema`

As built: `kindContract('generator')` in `packages/kk-core/src/kinds.ts:23`.

### 2.2 Entry Mechanism (Skill-Backed)

The generator entry is an **executable CLI wrapper** inside the plugin directory — no changes to
`@gobing-ai/knowledge-kit` core are required or permitted:

- `plugin.json` declares `{ "kind": "generator", "entry": "./src/index.ts" }` (or a `.js` /
  executable entry; see generic §1.2 for the spawn rule per entry type).
- The wrapper reads the `Doc[]` JSON array from `--in`, formats stage-0 material inputs, invokes
  the backing engine (Phase 1: the stand-in agent skill, §2.4) via a helper script or CLI, parses
  the resulting article markdown, constructs a `Content` object per §2.3, and writes it as JSON to
  `--out`.
- The wrapper owns argv parsing (`--in` / `--out`) and the failure semantics of §2.5.

### 2.3 `Doc[]` → `Content` Mapping Conventions

Target output schema: `ContentSchema` (`{ body, title?, format?, outline?, references?, metadata? }`),
as built in `packages/kk-core/src/schemas.ts:14-30`. These conventions require **zero schema
changes**:

- **`body`**: Aggregated/generated markdown article content. Required — the only schema-mandatory
  field.
- **`title`**: Extracted article title, or the primary input doc's title; defaults to
  `"Generated Knowledge Kit Synthesis"` when neither exists.
- **`format`**: Defaults to `"markdown"` (the `ContentSchema` default); wrappers SHOULD NOT emit
  any other value in Phase 1.
- **`outline`**: Formatted markdown outline string, taken from the stage-2 outline (or the engine's
  own outline output).
- **`references`**: Array of `{ url, title, cite }` constructed from `Doc.sourceUri` → `url`,
  `Doc.title` → `title`, and `Doc.id` / `Doc.metadata` → `cite`. All three sub-fields are optional
  in the schema; emit what the input docs provide.
- **`metadata`**: Generator provenance and vendor-specific data, e.g.
  `{ generator: "wt:technical-content-creation", stageCount: 4, docIds: string[] }`.

### 2.4 Stand-in vs Own-Engine Selection Criteria

- **Phase 1 stand-in**: `wt:technical-content-creation` (stages 0–3: material intake → research
  brief → outline → draft), per the D1 research decision (task 0001), fronted by
  `wt:info-research` / `wt:super-researcher`.
- **Switch to the own engine (D4 — STORM) when either condition holds**:
  - Persona-driven multi-perspective curation or a DSPy-based iterative retrieval loop over the
    internal corpus (`KarakeepLocalRM`) is required.
  - Exact per-section citation grounding (`url_to_info`) is required beyond top-level source
    mapping.

### 2.5 Failure & Diagnostics Semantics

Fail-loud per ADR-006 and generic §1.4; each case has an explicit exit-code and output-file
contract:

- **Empty `DocList` input (`[]`)**: The wrapper writes a valid `Content` object with an explanatory
  notice body (e.g. `# Notice\nNo documents provided for generation.`) and empty `references`,
  then exits `0`. (An empty array passes `runInvoke`'s input validation; the notice body satisfies
  `ContentSchema`, so the exit-0 contract of §1.4 holds.)
- **Engine / skill execution failure**: The wrapper emits diagnostic details to `stderr` and exits
  `1`. The `--out` file is NOT written (or is deleted if incomplete). `runInvoke` propagates the
  non-zero exit code and relays the `stderr` diagnostics.
- **Invalid output**: If the `--out` JSON fails `ContentSchema` validation, `runInvoke` logs the
  schema issues to `stderr` and exits non-zero (as built, `apps/cli/src/invoke.ts:133-139`).
  Wrappers SHOULD validate their own output against `ContentSchema` before writing to catch this
  class of failure with better diagnostics.

## 3. Platform Alignment & Verification

- **Platform compliance**: Validated against `kindContract('generator')`
  (`packages/kk-core/src/kinds.ts:23`), `ContentSchema` / `DocListSchema`
  (`packages/kk-core/src/schemas.ts:14-30`), and `runInvoke`
  (`apps/cli/src/invoke.ts:90-94` spawn contract, `:103-139` failure paths).
- **Schema impact**: Zero Zod schema changes; zero `runInvoke` modifications.
- **Contradictions**: None found during validation — no ADR entry required.
