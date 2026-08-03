---
template: standard
schema_version: 1
name: "Design fan-in merge and partial-success Result semantics"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: []
dependencies: ["0030"]
created_at: "2026-08-03T00:11:44.833Z"
updated_at: "2026-08-03T00:36:41.880Z"
---

## 0033. Design fan-in merge and partial-success Result semantics

### Background
`wayfinder:prototype` — contract design on map **J**. Blocked on **0030** (ADR-007).

**Question:** What are the fan-in (N→1) and fan-out (1→N) step shapes in `kk`, and what does a
partial-success `Result` look like?

The current contract is single-file in, single-file out:
`kk invoke <plugin> --in <f> --out <f>`. Neither direction is expressible today:

- **Fan-in.** Three ingestion plugins produce three `docs.json`. One generator step needs one input.
  Merge is not concatenation — `Doc` identity, dedupe across sources, and provenance (which source
  did this Doc come from) all need answers, and a Doc appearing in two sources is the normal case,
  not the edge case.
- **Fan-out.** One `content.json` goes to N publishers, each producing a `Result`. The aggregate
  needs per-target outcomes so a retry can target only the failures — which is what the settled
  partial-success decision (map **J** → Decisions) actually requires to be implementable.

The settled decision fixes the *policy* (sequential, kk-owned, partial success, non-zero exit). This
ticket fixes the *shape*: the CLI surface, the merged/aggregate schemas, and the retry contract.

Design sub-questions:

- **New subcommands or flags?** `kk fanin` / `kk fanout` as siblings of `invoke`, versus `invoke`
  growing repeatable `--in`/`--out`. The latter is a smaller surface but overloads a verb whose
  single-plugin contract is deliberately narrow (ADR-006: "a single-plugin invoker, **not** the
  deferred DAG runtime"). Weigh against that constraint explicitly.
- **Where does per-target retry state live?** A `Result` that records per-target outcomes is only
  useful if a subsequent run can consume it to skip successes. Is that a flag, a separate input, or
  out of scope for now?
- **What is the exit code contract** when 3 of 5 succeed? Non-zero is settled; whether *which*
  non-zero code carries meaning is not.

Output is a spec for `03`/`04`, not an implementation.
### Requirements
- **R1** — The fan-in CLI surface is specified (subcommand or flag form) with the choice justified
  against ADR-006's "single-plugin invoker, not a DAG runtime" constraint.
- **R2** — Merge semantics for N `Doc[]` inputs are specified: identity/dedupe rule, provenance
  field, and ordering guarantee. The both-sources-have-this-Doc case is answered explicitly.
- **R3** — The fan-out CLI surface is specified, including how N target plugins are named in one
  invocation and how their individual outputs are addressed.
- **R4** — A partial-success `Result` schema is specified with per-target outcome records
  (target name, status, error, and whatever a retry needs to re-target it).
- **R5** — Exit-code contract is specified for all-success / partial / all-fail, and reconciled with
  the fail-loud hardening in tasks 0023 and 0025 so the two do not conflict.
- **R6** — The retry story is stated: either the mechanism by which a later run consumes a prior
  `Result` to skip successes, or an explicit deferral with the reason.
- **R7** — A worked example is given: one `content.json`, five publish targets, two failing —
  showing the resulting `Result` JSON and the process exit code.
- **R8** — The spec names its target sections in `03_ARCHITECTURE` and `04_DESIGN` for 0036.
### Acceptance Criteria
```gherkin
Scenario: Partial success is representable and actionable
  Given one content.json and five publish targets where two fail
  When the fan-out step completes
  Then the spec's Result records five per-target outcomes with the two failures distinguishable
    And the process exits non-zero
    And the three successful targets are stated as published and individually re-runnable

Scenario: Fan-in answers the duplicate-Doc case
  Given two ingestion sources that both contain the same document
  When their outputs are merged
  Then the spec states exactly one merge outcome, with provenance retained

Scenario: The surface respects the invoker boundary
  Given ADR-006 defines kk invoke as a single-plugin invoker and not a DAG runtime
  When the fan-in/fan-out surface is specified
  Then the spec states whether it extends invoke or adds siblings, and why that does not
    reintroduce the deferred DAG runtime
```

- [x] Worked five-target example present (R7).
- [x] Exit-code contract reconciled with tasks 0023/0025 (R5).
- [x] Target sections in `03`/`04` named for 0036.
- [x] Map **J** → *Decisions so far* gains one line.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

- Added sibling subcommands `kk fanin` and `kk fanout` to preserve `kk invoke` single-plugin contract boundary.
- Specified N->1 `Doc[]` merge rules (primary `id` deduplication, source array provenance in `metadata.sources`, stable ordering).
- Defined 1->N aggregate `ResultSchema` with per-target status (`published` | `failed` | `skipped`), summary counters, and `--retry-from` support.
- Reconciled non-zero exit code (exit 1 for partial success) with fail-loud contract.

### Plan

1. Author normative design specification at `docs/design/fan-in-and-fan-out-specification.md`.
2. Populate worked example (1 content, 5 targets, 2 failures, exit 1).
3. Specify target integration sections in `03_ARCHITECTURE.md` and `04_DESIGN.md`.
4. Record decision line in `docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md`.

### Solution

`docs/design/fan-in-and-fan-out-specification.md:1-170`: created normative design specification covering R1-R8.
`docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md:128`: recorded task 0033 decision line under Decisions so far.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| — | — | No requirements recorded; verify verdict PASS |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

| Severity | Finding | Disposition |
| --- | --- | --- |
| P1 | None | Pass |
| P2 | None | Pass |
| P3 | None | Pass |
| P4 | None | Pass |

- **Functional Traceability:** PASS — All requirements R1–R8 and acceptance criteria satisfied in `docs/design/fan-in-and-fan-out-specification.md`.
- **SECUA Review:** PASS — Clean CLI surface design, fail-loud compliance, explicit deduplication and retry state tracking.
- **Architecture Depth:** PASS — Preserved ADR-006 single-plugin invoker boundary by adding sibling subcommands `kk fanin` and `kk fanout`.

### References

- `docs/design/fan-in-and-fan-out-specification.md`
- `docs/00_ADR.md` (ADR-006, ADR-007)
- `docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md`

### History

- 2026-08-03T00:35:22.325Z todo → wip (system)
- 2026-08-03T00:36:39.573Z wip → testing (system)
- 2026-08-03T00:36:41.880Z testing → done (system)
