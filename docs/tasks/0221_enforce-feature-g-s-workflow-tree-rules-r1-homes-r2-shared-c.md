---
schema_version: 1
name: Enforce feature G's workflow-tree rules (R1 homes, R2 shared capabilities) with an executable check
status: done
template: feature-impl
created_at: 2026-10-07T23:59:24.656Z
updated_at: "2026-10-08T22:03:00.023Z"
feature_id: G

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0221-verdict.json
---

## 0221. Enforce feature G's workflow-tree rules (R1 homes, R2 shared capabilities) with an executable check

### Background

Found by task 0217's re-verify (2026-10-07): the feature-level shippable gate on parent `G` failed with `L4.uncovered-feature-scenario` for both of G's `@core` scenarios — no linked task covered R1 ("every product workflow has a child node") or R2 ("workflow-shared capabilities have their own child"). Read literally, both were also false: `kk-daily-ai-voice2.yaml` is homed by G1 (its Goal names it as the DAG successor), `kk-daily-safety.yaml` is voice2's nested state machine with no node, and the kk store (shared by kk-collect and voice2) lives under G3, whose Scope owns it.

Operator decision (2026-10-07): refine G's AC to match the deliberately planned tree rather than restructure it. G's Acceptance Criteria were amended via `spur feature update G --section "Acceptance Criteria"` (titles unchanged). This task makes the amended rules executable so the tree cannot drift from them silently.

### Requirements

- [x] R1. A test asserts, for every top-level non-example workflow under `plugins/kk/workflows/`, that exactly one direct child of G is its home (named after it, or its Goal names the workflow file); a nested sub-workflow (run by another workflow via `spur workflow run plugins/kk/workflows/<name>.yaml`) resolves to its runner's home.
- [x] R2. The same test derives the `kk` command families invoked by more than one product workflow (excluding the generic `executor`, `package` and per-workflow `stage` surfaces, listed in the test with the reason) and asserts each is claimed by exactly one direct child's Scope `In:` line; the claimer is not named after a workflow, or is the child of a workflow that invokes the family (the owner).
- [x] R3. Mutation probes: (a) remove `kk-daily-ai-voice2.yaml` from G1's Goal → R1 case red; (b) drop `ledger` from G7's Scope → R2 case red; restore → green. Outputs recorded in Testing.
- [x] R4. `bun test` on the new file, `bun run lint`, `bun run test-pre-check` pass; `spur feature check G` reports no uncovered or unverified scenario.

### Acceptance Criteria

```gherkin
Scenario: R1 — Every product workflow has a child node
  Given apps/cli/tests/g-feature-tree.test.ts
  When it runs against plugins/kk/workflows/ and docs/features/G*_*.md
  Then every top-level non-example workflow resolves to exactly one direct child of G, nested sub-workflows via their runner, and a workflow with zero or two homes fails it

Scenario: R2 — Workflow-shared capabilities have their own child
  Given apps/cli/tests/g-feature-tree.test.ts
  When it derives the kk command families invoked by more than one product workflow
  Then each infrastructure family is claimed by exactly one direct child's Scope, the claimer is a capability child or the owning workflow's child, and an unclaimed or doubly claimed family fails it
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT.** One new test file `apps/cli/tests/g-feature-tree.test.ts`; no production code, no corpus writes (feature files are read-only here).

**Failure-first list — what the test must catch (written before the code).**
1. A new product workflow YAML lands with no G child homing it.
2. Two direct children of G both home the same workflow (name match on one, Goal mention on another).
3. A nested sub-workflow's runner is removed/renamed so the nested file has no home.
4. A G child's Goal stops naming a versioned successor it homes (voice2 under G1).
5. A new `kk` command family becomes shared between workflows and nobody's Scope claims it.
6. A shared family is claimed by two children (e.g. both G3 and a new store child).
7. A shared family is claimed by a workflow child whose workflow does not invoke it (not the owner).
8. Parsing silently finds nothing (zero workflows / zero children / zero shared families) and passes vacuously.

**Algorithm.**
- Direct children: `docs/features/` files matching `/^G\d_/`; read frontmatter `name:`, the `## Goal` body, and the `- In:` line under `## Scope`.
- Workflows: `plugins/kk/workflows/*.yaml` minus `*-example.yaml`; nested = a stem that another workflow references as `plugins/kk/workflows/<stem>.yaml`.
- `homes(stem)` = set of children with `name === stem` or Goal containing `` `<stem>.yaml` `` or `/<stem>.yaml`; nested → `homes(runner)`. Assert size 1.
- Families: `/(?:^|[\s"'(;|&])kk ([a-z][a-z-]+)/gm` per workflow; shared = used by ≥2 workflows minus `{executor, package, stage}`. Assert non-empty, and per family exactly one claimer whose `In:` line matches `\b<family>\b`, and claimer is non-workflow or its workflow invokes the family.

**Anti-patterns.** No hard-coded child→workflow map (derive it); no `spur` subprocess (read files, as store-docs does — 0218); do not touch G's files from the test.

### Plan

1. Write `apps/cli/tests/g-feature-tree.test.ts` header with the failure-first list, then the two cases + non-vacuity guards (R1, R2).
2. `bun test` the file → green.
3. Mutation probes (a) and (b) per R3 against scratch copies restored afterwards; paste outputs.
4. `bun run lint`, `bun run test-pre-check`; verify; `spur feature check G` (R4).
5. Commit: `test(kk): enforce feature G workflow-tree rules (0221)`.

### Solution

- `docs/features/G_kk-workflows.md:29-41` — Acceptance Criteria amended via `spur feature update G --section` (operator decision 2026-10-07: refine AC to the planned tree). Titles unchanged; R1 now admits a versioned successor homed by Goal and nests sub-workflows with their runner; R2 excludes the generic `executor`/`package`/`stage` surfaces and lets an owner-filled capability (kk store → G3) stay with its owner.
- `apps/cli/tests/g-feature-tree.test.ts:1-114` (new)
    - `apps/cli/tests/g-feature-tree.test.ts:10-19` header: failure-first list (8 items) written before the code.
    - `apps/cli/tests/g-feature-tree.test.ts:65-92` — `homes()` derives each workflow's home from child `name` / Goal file mention; `runnerOf()` resolves nested sub-workflows (`kk-daily-safety` → voice2 → G1) (R1).
    - `apps/cli/tests/g-feature-tree.test.ts:94-113` — R2 case derives shared `kk` families from the workflow YAML (today: `store`, `ledger`), requires exactly one Scope `In:` claimer, and when the claimer is a workflow child, that its workflow invokes the family (G3/kk-collect owns `store`; G7 claims `ledger`) (R2).
    - Non-vacuity guards: children, workflows and shared families must be non-empty (failure-first #8).

Rationale: both rules are derived, not hard-coded, so a new workflow or a newly shared capability forces a deliberate tree decision. Files are read directly (no `spur` subprocess — load-flake lesson from 0218).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/g-feature-tree.test.ts:65-79` — runnerOf() nests a sub-workflow under the workflow that runs it, homes() matches child name or a Goal file mention; `apps/cli/tests/g-feature-tree.test.ts:86-92` asserts exactly one home per non-example workflow, with non-vacuity guards at :87-88. Re-run: 2 pass / 0 fail. |
| R2 | MET | `apps/cli/tests/g-feature-tree.test.ts:94-113` — shared families derived from the YAML, `NON_INFRA_FAMILIES` excluded with the reason at `apps/cli/tests/g-feature-tree.test.ts:25-30`, exactly one Scope In claimer at :102-103, owner check at :105-111, non-empty guard at :100. Live shared infra families: ledger (G7), store (G3, owner kk-collect invokes it). |
| R3 | MET | Probes re-run this pass on a scratch copy of docs/features + plugins/kk/workflows (corpus untouched): (a) voice2 file removed from G1 Goal → R1 case fails (1 pass / 1 fail); (b) ledger dropped from G7 Scope In → R2 case fails (1 pass / 1 fail); restored → 2 pass / 0 fail. |
| R4 | MET | `bun test apps/cli/tests/g-feature-tree.test.ts` 2/0; `bun run gate` exit 0 (2211 pass / 2 pre-existing Chromium E2E skips / 0 fail; lint and typecheck clean); `bun run test-pre-check` 51/51 rules; `spur feature check G` run below. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Every product workflow has a child node | MET | test | `apps/cli/tests/g-feature-tree.test.ts:86-92` green; probe (a) turns it red, and it goes green again on restore. |
| R2 — Workflow-shared capabilities have their own child | MET | test | `apps/cli/tests/g-feature-tree.test.ts:94-113` green; probe (b) turns it red, and it goes green again on restore. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Parent feature: `docs/features/G_kk-workflows.md` (AC amended at :23-41; rationale in Notes).
- Executable check: `apps/cli/tests/g-feature-tree.test.ts` (commit 739a3a4d).
- Children read by the check: `docs/features/G1_kk-daily-ai-voice.md`…`docs/features/G7_kk-workflow-run-ledger.md`; workflows under `plugins/kk/workflows/`.
- Sibling under G: task 0217 (store-docs AC4 assertion).

### History

- 2026-10-07T23:59:58.822Z backlog → todo (system)
- 2026-10-07T23:59:59.759Z todo → wip (system)
- 2026-10-08T00:09:45.302Z wip → testing (system)
- 2026-10-08T00:11:11.683Z testing → done (system)

