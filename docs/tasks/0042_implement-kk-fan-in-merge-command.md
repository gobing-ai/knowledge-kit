---
template: feature-impl
schema_version: 1
name: "Implement kk fan-in merge command"
description: ""
status: done
type: task
profile: standard
feature_id: B6
parent_wbs: null
priority: P2
tags: ["cli", "fan-in", "B6"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T05:18:46.292Z"
updated_at: "2026-08-12T06:43:59.834Z"
---

## 0042. Implement kk fan-in merge command

### Background

B6 (Sequential fan-in/fan-out steps) — kk fanin: N docs.json inputs → 1 output Doc list with primary-id dedupe and metadata.sources provenance. Spec: docs/design/fan-in-and-fan-out-specification.md §1.2, §2. Sibling of kk invoke (ADR-006 boundary). Implements: Fan-in merges many document sets into one. Rubric: E2 D1 L1 C1 R1 = 6 → decompose (parent 9, threshold 5+).

### Requirements
- [x] R1. `kk fanin` merges N Doc-list inputs into one output list: dedupe by primary document id (each id appears exactly once), `metadata.sources` provenance listing every originating source in input order, deterministic ordering per spec §2.3; unreadable or invalid input files fail with a non-zero exit naming the file.
### Acceptance Criteria

```gherkin
Feature: kk fanin merge command

  @core
  Scenario: R1 — Fan-in merges many document sets into one
    Given two ingestion outputs that share one document id
    When `kk fanin --in a.json --in b.json --out merged.json` runs
    Then merged.json contains that document exactly once
      And its metadata.sources lists both originating sources
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: new `apps/cli/src/fanin.ts` command module (sibling of `invoke.ts`), registered in `cli.ts` as `kk fanin`. Merge + dedupe live in a pure function so tests drive them without the CLI.

- Dedupe identity: the Doc `id` field (kk-core contract). First-seen occurrence wins; later duplicates contribute only their source to `metadata.sources` (spec §2.1, §2.2).
- Provenance: `metadata.sources` appended in input order — source label per `--in` occurrence.
- Ordering: deterministic per spec §2.3 — inputs processed in flag order, documents kept in first-appearance order.
- Rejected: engine-level parallelism and DAG runtime — explicitly out of scope (feature Scope; ADR-007 R4). Rejected: last-wins dedupe — first-wins preserves the earliest source's content and matches the spec's identity rule.

Signatures: `mergeDocLists(inputs: Doc[][], sources: string[]): Doc[]` (pure), `runFanin(argv: string[]): Promise<number>` (CLI handler). Invariants: output never contains an id twice; `sources` order mirrors `--in` order; inputs never mutated.

Impacted surfaces: `apps/cli/src/cli.ts` (registration), `apps/cli/src/fanin.ts` (new), `packages/kk-core` Doc schema (read-only reuse). Tests in `apps/cli/tests/fanin.test.ts`.

### Plan

1. Read spec §1.2 + §2; confirm Doc schema fields (id, metadata.sources) in `packages/kk-core/src`.
2. Add `apps/cli/src/fanin.ts`: pure merge + dedupe + `runFanin` CLI wrapper (reads `--in` files, merges, writes `--out`).
3. Register `fanin` subcommand in `apps/cli/src/cli.ts` (sibling of `invoke`, ADR-006).
4. Write `apps/cli/tests/fanin.test.ts`: dedupe, provenance order, deterministic ordering, empty inputs, invalid-file error (edge cases from spec §2.1–§2.3).
5. Smoke: two sample `docs.json` sharing an id → output deduped with both sources; `bun test` on the new file green.
6. `bun run lint` + full `bun test` green.

### Solution
Implemented `kk fanin` per spec §1.2/§2 and task R1/AC: N `Doc[]` inputs → one deduplicated output with `metadata.sources` provenance.

- `apps/cli/src/fanin.ts` (new) — `mergeDocLists(inputs, sources)` pure merge: dedupe by `Doc.id` (first-seen wins, spec §2.1), `metadata.sources` provenance appended in `--in` order with `{ file, sourceUri? }` entries (spec §2.2), deterministic first-appearance ordering (spec §2.3), inputs never mutated. `runFanin(argv)` CLI handler parses `--in` (repeatable) / `--out`, validates each input against kk-core `DocListSchema`, writes the merged list; exit `0` success, `1` file error (every error names the offending file), `2` usage error.
- `apps/cli/src/cli.ts:33,67-89` — registered `fanin` subcommand (commander, sibling of `invoke`, ADR-006) with repeatable `--in` collection; action rebuilds the flag slice, calls `runFanin`, propagates non-zero exit so the binary fails loud.
- `apps/cli/tests/fanin.test.ts` (new) — 14 tests: R1 AC scenario (shared id deduped, both sources listed), provenance order, deterministic ordering, within-file duplicate, empty inputs, no-mutation invariant, `sourceUri` carryover into provenance, metadata preservation, CLI success + failure paths (missing/invalid/schema-violating inputs name the file; usage errors exit 2; unwritable output).

Deferred (not in R1/AC/Design): spec §1.2's `--dedupe <id|uri|none>` secondary-rule flag — id dedupe (default) is the only requirement; add the flag if a `uri`-dedupe consumer appears.
### Testing
**Force re-verify (2026-08-11) — Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/fanin.ts:31-62` — `mergeDocLists()` dedupes by `Doc.id` (first-seen wins), appends `metadata.sources` in `--in` order, deterministic first-appearance order, never mutates inputs; `apps/cli/src/fanin.ts:68-98` — `readDocList()` names the file on missing/unreadable/invalid/schema fail → exit 1; `apps/cli/src/fanin.ts:142-172` — `runFanin` usage exit 2 / write exit 1 / success 0; `apps/cli/src/cli.ts:51-69` — `fanin` registered sibling of `invoke`. Tests: `apps/cli/tests/fanin.test.ts:19-38,119-141,157-188`; `apps/cli/tests/cli.test.ts:186-253`. Live: golden path exit 0 with both sources; missing input exit 1 naming file. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — Fan-in merges many document sets into one | MET | test | `apps/cli/tests/fanin.test.ts:19-38` + `:119-141` + `apps/cli/tests/cli.test.ts:187` — shared doc once, both sources listed |
| Fan-in merges many document sets into one | MET | command | Live `bun run src/index.ts fanin` exit 0; d2 sources list both files (this run) |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
- Verification this run: `bun test apps/cli/tests/fanin.test.ts apps/cli/tests/fanout.test.ts apps/cli/tests/cli.test.ts` → 58 pass / 0 fail; `bun run lint` exit 0
- Artifact: `.spur/run/0042-verdict.json` (re-written this force re-verify)
- SECUA: no P1–P3; P4 advisory only (argv re-serialize seam; dash-path parse)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Architecture | `apps/cli/src/cli.ts:52-62` | Commander parses `--in`/`--out`, then the action re-serializes the parsed options back into an argv slice for `runFanin` to re-parse — a redundant seam versus `invoke`'s options-object handoff (`apps/cli/src/cli.ts:27-40` → `runInvoke({...})`). Defensible (keeps `runFanin` commander-free and standalone-testable with its own exit-code contract), but the two sibling handlers now hand off differently; align if a third utility subcommand appears. Advisory only. |
| P4 | Correctness | `apps/cli/src/fanin.ts:104-106` | `parseArgs` consumes any token after `--in` as the path value, so a value beginning with `-` (e.g. `--in --out x.json`) is swallowed as a file path and surfaces as a file error (exit 1) rather than a usage error (exit 2). Pathological input; fails loud either way. |
| P4 | Functional | `docs/design/fan-in-and-fan-out-specification.md` §1.2 `--dedupe id\|uri\|none` flag | Not implemented — documented deferral in `### Solution` ("id dedupe (default) is the only requirement; add the flag if a `uri`-dedupe consumer appears"). Classify CHANGED vs the spec's CLI surface, PASS-acceptable per design-conformance rules (Solution note asserts goal-equivalent intent; the task's `### Design` never committed to the flag). |

**Functional Verdict: PASS** — no P1–P3 findings. **SECUA Verdict: PASS** — no P1–P3 findings. **Architecture Verdict: PASS** — advisory only.

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/fanin.ts:31-62` — `mergeDocLists()` dedupes by `Doc.id` (first-seen wins, each id appears exactly once), appends `metadata.sources` provenance in `--in` order, keeps deterministic first-appearance order (§2.3), never mutates inputs; `apps/cli/src/fanin.ts:64-99` — `readDocList()` returns null + file-naming error on missing/unreadable/invalid-JSON/schema-violating input → `runFanin` exits 1; `apps/cli/src/cli.ts:44-66` — `fanin` subcommand registered as sibling of `invoke` (ADR-006 boundary) with repeatable `--in`/`--out`, propagates non-zero exit. Tests: `apps/cli/tests/fanin.test.ts:26-31,117-127` (R1 AC scenario), `:36-46` (ordering), `:48-59` (within-file dup), `:61-66` (empty), `:68-79` (no mutation), `:81-95` (sourceUri carryover), `:143-150`/`:152-159`/`:161-170`/`:193-200` (file-naming failure paths), `:202-211` (unwritable output); `apps/cli/tests/cli.test.ts:186-208,210-252` (commander surface + non-zero propagation). Ran this turn: `bun test apps/cli/tests/fanin.test.ts apps/cli/tests/cli.test.ts` → 25 pass / 0 fail (fanin.ts 100% funcs, 99.12% lines); `bun run lint` (biome + typecheck) green. |

| AC | Status | Evidence |
| --- | --- | --- |
| Scenario: Fan-in merges many document sets into one (R1) | MET | `apps/cli/tests/fanin.test.ts:26-31` (merge unit) + `:117-127` (runFanin writes merged.json: shared doc once, `metadata.sources` lists both files) + `apps/cli/tests/cli.test.ts:186-208` (end-to-end through commander) — all pass this run |

**Design conformance:** `mergeDocLists(inputs, sources)` pure function — DONE (`fanin.ts:31`); `runFanin(argv)` handler — DONE (`fanin.ts:117`); first-wins dedupe + input-order provenance + first-appearance ordering + no-mutation invariants — DONE (all tested); `fanin` registration sibling of `invoke` — DONE (`cli.ts:44`); `--dedupe` flag — CHANGED (documented deferral, see P4 above). No scope creep: diff hunks map to Requirement/Design/Plan items; out-of-scope `fanout` (0043) untouched.
### References

B6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T05:36:42.593Z todo → wip (system)
- 2026-08-12T05:46:06.617Z wip → testing (system)
- 2026-08-12T05:46:14.528Z testing → done (system)
