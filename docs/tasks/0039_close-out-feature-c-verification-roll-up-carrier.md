---
schema_version: 1
name: "Close out feature C verification (roll-up carrier)"
status: done
template: feature-impl
created_at: 2026-08-12T02:03:43.892Z
updated_at: "2026-08-12T04:09:20.697Z"
feature_id: C
---

## 0039. Close out feature C verification (roll-up carrier)

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- R1. Carry C's composition scenario verbatim ("Ingestion kind composes into the platform") in this task's AC so DD-09 L4 coverage is satisfied for feature C.
- R2. Record the composition evidence — B5 E2E vertical (task `0027`) + plugin contract tests — in the verdict artifact.
### Acceptance Criteria
```gherkin
Feature: Close out feature C verification

  @core
  Scenario: Ingestion kind composes into the platform
    Given an ingestion plugin discovered by the registry
    When knowledge-kit invoke runs it
    Then its DocList output feeds the generator step of a spur workflow
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
Decision: roll-up carrier per the 0028 pattern — carry the parent's uncovered composition scenario verbatim in this task's AC so DD-09 coverage is satisfied; evidence cites the already-verified artifacts (B5 E2E vertical, task 0027; plugin contract tests). No code changes; this task claims the roll-up, not the implementation. Rejected: re-scoping the parent AC to drop the composition scenario (weakens acceptance); hand-editing feature status (bypasses the guard).
### Plan
- [x] Trim AC to the parent composition scenario verbatim.
- [x] Verify composition evidence (E2E vertical 0027 + plugin contract tests) and record the verdict artifact.
- [x] Advance todo → wip → testing → done with the strict-core gate passing.
- [x] `spur feature sync C` — parent verifying → done with L4 clean.
### Solution
Roll-up carrier for feature C. Evidence map (composition proven; no code changes):
- `apps/cli/src/invoke.ts:35` — `kindContract(record.kind)` resolves the ingestion contract (output `DocListSchema`); `:65` validates input before spawn; `:137` validates output.
- `plugins/karakeep-local/src/index.ts:148-153` — ingestion entry main() fails loud on zero ingestible docs.
- `plugins/karakeep-local/tests/karakeep-local.test.ts:176-199` — contract test: all-rejected source exits non-zero.
- Task `0027` Solution/Testing — B5 E2E vertical: karakeep-local → generator → Surfdash over a `spur workflow` (fixture → content → `ok:true`); the ingestion DocList fed the generator step.
- `docs/tasks/0039_close-out-feature-c-verification-roll-up-carrier.md` — this carrier (AC trimmed to the composition scenario verbatim).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/tasks/0039 AC carries 'Ingestion kind composes into the platform' verbatim; spur feature check C shows the scenario covered (linked) |
| R2 | MET | Evidence recorded in this artifact and in the task Testing section: task 0027 E2E vertical (karakeep-local -> generator -> Surfdash, ok:true) + plugins/karakeep-local/tests/karakeep-local.test.ts:176-199 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Ingestion kind composes into the platform | MET | test | task 0027 E2E vertical (Karakeep-local -> generator -> Surfdash in one spur workflow run, terminal ok:true); plugins/karakeep-local/tests/karakeep-local.test.ts:176-199; apps/cli/src/invoke.ts:35,65,137 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P2 | `docs/features/C_ingestionplugin-karakeep-local.md` | Parent composition scenario had no linked-task coverage (L4 orphan) | Carrier carries the title verbatim; coverage satisfied — keep roll-up carriers for future parents (0028 pattern) |
### History
- 2026-08-12T04:04:30.574Z todo → wip (system)
- 2026-08-12T04:05:11.341Z wip → testing (system)
- 2026-08-12T04:07:48.174Z testing → done (system)
