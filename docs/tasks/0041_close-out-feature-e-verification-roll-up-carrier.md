---
schema_version: 1
name: "Close out feature E verification (roll-up carrier)"
status: done
template: feature-impl
created_at: 2026-08-12T02:03:44.155Z
updated_at: "2026-08-12T04:09:20.947Z"
feature_id: E
---

## 0041. Close out feature E verification (roll-up carrier)

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- R1. Carry E's composition scenario verbatim ("Publish kind composes into the platform") in this task's AC so DD-09 L4 coverage is satisfied for feature E.
- R2. Record the composition evidence — B5 E2E vertical (task `0027`) + publish contract tests — in the verdict artifact.
### Acceptance Criteria
```gherkin
Feature: Close out feature E verification

  @core
  Scenario: Publish kind composes into the platform
    Given a publish plugin discovered by the registry
    When knowledge-kit invoke runs it with a Content input
    Then its Result output terminates a spur workflow run fail-loud
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
Decision: roll-up carrier per the 0028 pattern — carry the parent's uncovered composition scenario verbatim in this task's AC so DD-09 coverage is satisfied; evidence cites the already-verified artifacts (B5 E2E vertical, task 0027; plugin contract tests). No code changes; this task claims the roll-up, not the implementation. Rejected: re-scoping the parent AC to drop the composition scenario (weakens acceptance); hand-editing feature status (bypasses the guard).
### Plan
- [x] Trim AC to the parent composition scenario verbatim.
- [x] Verify composition evidence (E2E vertical 0027 + plugin contract tests) and record the verdict artifact.
- [x] Advance todo → wip → testing → done with the strict-core gate passing.
- [x] `spur feature sync E` — parent verifying → done with L4 clean.
### Solution
Roll-up carrier for feature E. Evidence map (composition proven; no code changes):
- `apps/cli/src/invoke.ts:35` — `kindContract('publish')` resolves input `ContentSchema` / output `ResultSchema`; non-zero entry exit fails loud.
- `plugins/surfdash-pub/src/index.ts:152-162` — `processPublishIO` parses `ContentSchema` input and validates `ResultSchema` output.
- `packages/publish-harness/src/index.ts:16-20` — `PublishTransport` abstraction; fake transports back the publish contract tests.
- Task `0027` Solution/Testing — B5 E2E vertical: the publish step terminated the workflow run with `ok:true`.
- `docs/tasks/0041_close-out-feature-e-verification-roll-up-carrier.md` — this carrier (AC trimmed to the composition scenario verbatim).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/tasks/0041 AC carries 'Publish kind composes into the platform' verbatim; spur feature check E shows the scenario covered (linked) |
| R2 | MET | Evidence recorded in this artifact and the task Testing section: task 0027 E2E vertical + plugins/surfdash-pub/tests/ over packages/publish-harness fake transports |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Publish kind composes into the platform | MET | test | task 0027 E2E vertical (publish step terminated the workflow with ok:true); plugins/surfdash-pub/src/index.ts:152-162; packages/publish-harness/src/index.ts:16-20 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P2 | `docs/features/E_publishplugin-surfdash.md` | Parent composition scenario had no linked-task coverage (L4 orphan) | Carrier carries the title verbatim; coverage satisfied — keep roll-up carriers for future parents (0028 pattern) |
### History
- 2026-08-12T04:04:31.288Z todo → wip (system)
- 2026-08-12T04:05:12.345Z wip → testing (system)
- 2026-08-12T04:08:37.777Z testing → done (system)
