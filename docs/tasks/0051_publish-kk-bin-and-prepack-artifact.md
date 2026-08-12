---
template: feature-impl
schema_version: 1
name: "Publish kk bin and prepack artifact"
description: ""
status: todo
type: task
profile: standard
feature_id: A2
parent_wbs: null
priority: P1
tags: ["cli", "npm"]
dependencies: ["0049"]
ac_numbering: task-local
created_at: "2026-08-12T17:19:19.259Z"
updated_at: "2026-08-12T17:20:27.819Z"
---

## 0051. Publish kk bin and prepack artifact

### Background

The code can already say `kk`, but npm still exposes `knowledge-kit` → dist/index.js with no prepack. This deliverable makes `@gobing-ai/knowledge-kit` pack-ready: bin.kk, knowledge-kit alias, prepack build, and the T3 04/AGENTS prefix change.

Implements feature scenarios: R8 — npm bin exposes kk and a knowledge-kit alias; R9 — prepack stages the dist artifact that bin.kk names; R10 — [doc-only] Surface docs and ADR name the kk binary.

Ordering: depends on the program-globals task so help/version already say kk. Can run in parallel with the command-module split.

Rubric: E2 D1 L1 C0 R0 = 4 → own task because pack metadata and 04 T3 are a distinct review surface from the command-tree move. Rejected folding into task 1: bin/prepack is independently demoable via npm pack.

Out of scope: npm Trusted Publisher, GitHub OIDC, .github/workflows/, bun --compile natives.

### Requirements
- [ ] R1. apps/cli/package.json `bin.kk` and `bin.knowledge-kit` both point at `./dist/index.js`; package name stays `@gobing-ai/knowledge-kit`.
- [ ] R2. `prepack` runs the existing bun build so `dist/index.js` exists before npm pack validates bins.
- [ ] R3. docs/04_DESIGN.md §1 documents `kk` as the binary in the same commit, and AGENTS.md product-binary wording matches; ADR-010 already records the package-name invariant.
### Acceptance Criteria
```gherkin
Feature: kk npm bin and prepack

  @core
  Scenario: R1 — npm bin exposes kk and a knowledge-kit alias
    Given apps/cli/package.json
    When the package metadata is read
    Then bin.kk points at the built dist entry
      And bin.knowledge-kit points at the same artifact
      And the package name remains @gobing-ai/knowledge-kit

  @core
  Scenario: R2 — prepack stages the dist artifact that bin.kk names
    Given a clean apps/cli tree without dist/index.js
    When `bun run --filter @gobing-ai/knowledge-kit prepack` (or the documented pack path) runs
    Then dist/index.js exists
      And npm pack can see the kk bin file

  @core
  Scenario: R3 — [doc-only] Surface docs and ADR name the kk binary
    Given the binary is named kk
    When the implementing commit lands
    Then docs/04_DESIGN.md section 1 documents `kk` as the binary in that commit
      And a dated ADR entry records that the package name is unchanged and the operator binary is kk
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Chosen approach: dual bin keys on the same dist/index.js artifact; add `"prepack": "bun run build"` next to the existing build script. Rewrite 04 §1 examples from `knowledge-kit` to `kk` in that commit. Do not add release.yml or Trusted Publisher config.

Reason: npm ≥ 11 checks bin existence before lifecycle scripts (spur lesson); dual bin keeps old scripts working.

Rejected alternatives:
- Only rename bin to kk with no alias: breaks existing knowledge-kit invocations in the same release.
- bun --compile native binaries this feature: out of A2 scope.
- Author .github/workflows for Trusted Publisher: operator-owned, later.

Invariants:
- Package name unchanged.
- No new GitHub workflow files.
- 04 §1 command table flags stay as shipped; only the binary prefix changes.
### Plan
1. Set bin.kk and bin.knowledge-kit to ./dist/index.js; add prepack.
2. Add a test or pack smoke that prepack creates dist/index.js and package.json names both bins.
3. Update docs/04_DESIGN.md §1 to `kk` in the same commit.
4. Update AGENTS.md binary wording.
5. Run apps/cli tests and typecheck.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

A2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
