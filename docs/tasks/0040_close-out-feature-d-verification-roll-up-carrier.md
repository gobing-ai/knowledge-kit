---
schema_version: 1
name: "Close out feature D verification (roll-up carrier)"
status: done
template: feature-impl
created_at: 2026-08-12T02:03:44.028Z
updated_at: "2026-08-12T04:09:20.828Z"
feature_id: D
---

## 0040. Close out feature D verification (roll-up carrier)

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- R1. Carry D's composition scenario verbatim ("Generator kind composes into the platform") in this task's AC so DD-09 L4 coverage is satisfied for feature D.
- R2. Record the composition evidence — B5 E2E vertical (task `0027`) + plugin contract tests — in the verdict artifact.
### Acceptance Criteria
```gherkin
Feature: Close out feature D verification

  @core
  Scenario: Generator kind composes into the platform
    Given a generator plugin discovered by the registry
    When knowledge-kit invoke runs it with a DocList or Brief input
    Then its Content output feeds the publish step of a spur workflow
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
Decision: roll-up carrier per the 0028 pattern — carry the parent's uncovered composition scenario verbatim in this task's AC so DD-09 coverage is satisfied; evidence cites the already-verified artifacts (B5 E2E vertical, task 0027; plugin contract tests). No code changes; this task claims the roll-up, not the implementation. Rejected: re-scoping the parent AC to drop the composition scenario (weakens acceptance); hand-editing feature status (bypasses the guard).
### Plan
- [x] Trim AC to the parent composition scenario verbatim.
- [x] Verify composition evidence (E2E vertical 0027 + plugin contract tests) and record the verdict artifact.
- [x] Advance todo → wip → testing → done with the strict-core gate passing.
- [x] `spur feature sync D` — parent verifying → done with L4 clean.
### Solution
Roll-up carrier for feature D. Evidence map (composition proven; no code changes):
- `apps/cli/src/invoke.ts:35` — `kindContract('generator')` resolves input `DocListSchema` / output `ContentSchema`; fail-loud input validation at `:65`.
- `plugins/content-gen/src/index.ts:90-91` — entry parses validated `DocListSchema` input and writes validated `ContentSchema` output.
- Task `0027` Solution/Testing — B5 E2E vertical: the generator step produced contract-valid `Content` from the ingested `Doc[]` inside the `spur workflow`.
- `docs/tasks/0040_close-out-feature-d-verification-roll-up-carrier.md` — this carrier (AC trimmed to the composition scenario verbatim).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/tasks/0040 AC carries 'Generator kind composes into the platform' verbatim; spur feature check D shows the scenario covered (linked) |
| R2 | MET | Evidence recorded in this artifact and the task Testing section: task 0027 E2E vertical + plugins/content-gen/tests/ contract suite |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Generator kind composes into the platform | MET | test | task 0027 E2E vertical (generator produced contract-valid Content from ingested Doc[] inside the spur workflow); plugins/content-gen/src/index.ts:90-91; apps/cli/src/invoke.ts:35,65 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P2 | `docs/features/D_contentgeneratorplugin.md` | Parent composition scenario had no linked-task coverage (L4 orphan) | Carrier carries the title verbatim; coverage satisfied — keep roll-up carriers for future parents (0028 pattern) |
### History
- 2026-08-12T04:04:30.946Z todo → wip (system)
- 2026-08-12T04:05:11.845Z wip → testing (system)
- 2026-08-12T04:08:36.750Z testing → done (system)
