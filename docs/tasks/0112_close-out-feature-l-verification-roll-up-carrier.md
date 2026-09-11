---
schema_version: 1
name: Close out feature L verification (roll-up carrier)
status: done
template: feature-impl
created_at: 2026-09-11T04:50:09.613Z
updated_at: "2026-09-11T05:18:24.263Z"
feature_id: L

---

## 0112. Close out feature L verification (roll-up carrier)

### Background

Feature L is an umbrella feature; its AC previously held only the feature-file
template placeholder, so `spur feature check L` failed shippable with
`L4.uncovered-feature-scenario` ("Basic acceptance" not covered by any linked
task). Real ship AC existed implicitly through 0110 (bundled staged plugins run
without repository node_modules) and 0111 (staging prunes node_modules/.git),
but no linked task carried the scenarios verbatim for DD-09 coverage.

Follows the 0028/0039-0041 roll-up-carrier pattern: carry the parent scenarios
verbatim in this task's AC so DD-09 L4 coverage is satisfied; evidence cites the
already-verified artifacts. No code changes.

### Requirements

- [x] R1. Carry feature L's ship scenarios verbatim in this task's AC so DD-09 L4
  coverage is satisfied for both:
  "Shipped package runs bundled plugins without repository node_modules" and
  "Packaging stages no checkout-bound or VCS content".
- [x] R2. Record the composition evidence — 0110 verification + 0111 verification
  (fresh 12 pass / lint exit 0) — in the verdict artifact.

### Acceptance Criteria

```gherkin
Feature: Close out feature L verification

  @core
  Scenario: Shipped package runs bundled plugins without repository node_modules
    Given the published @gobing-ai/knowledge-kit package with staged product plugins
    When an installed plugin entry runs outside this monorepo
    Then the bundled dist/index.js executes its full closure without resolving any @gobing-ai/* workspace package

  @core
  Scenario: Packaging stages no checkout-bound or VCS content
    Given a product plugin source containing node_modules workspace symlinks and .git metadata
    When prepack staging copies the plugin tree
    Then no node_modules or .git directory appears under any staged product plugin collection
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T04:50:38.598Z

Scenario AC ids resolve to the linked (task-local) verifications, so no new
behavior is claimed; evidence is typed `test` because 0111 re-verified fresh
this session and 0110's bundled-plugin E2E remained green.

### Design

Roll-up carrier per the 0040 pattern — carry feature L's uncovered scenarios
verbatim in this task's AC so DD-09 coverage is satisfied. Evidence cites the
already-verified artifacts (0110 packaging E2E of bundled staged plugins; 0111
re-verification: 10+2 tests pass, lint exit 0). No code changes; this task
claims the roll-up, not the implementation. Rejected: re-scoping L's AC back to
the template placeholder (leaves shippable FAIL); hand-editing feature status
(bypasses the guard).

### Plan

- [x] Trim AC to feature L's scenarios verbatim.
- [x] Verify packaging evidence (0110 + fresh 0111 re-verification) and record the verdict artifact.
- [x] Advance backlog → wip → testing → done with the strict-core gate passing.
- [x] `spur feature sync` — parent status with L4 clean.

### Solution

Roll-up carrier for feature L. Evidence map (packaging proven; no code changes):
- `scripts/bundle-plugins.ts:38` — EXCLUDE prunes `node_modules`/`.git` at staging.
- `scripts/bundle-plugins.ts:51-78` — `bundleStagedEntry(pluginDir, sourceDir)` bundles from the source plugin entry.
- `scripts/bundle-plugins.test.ts:31-57` — prune + staging-run regression (fresh: 10 pass / 0 fail).
- `apps/cli/tests/package.test.ts:20-36` — prepack exit 0, no staged product-plugin node_modules (fresh: 2 pass / 0 fail).
- Task 0110 Testing — published-package E2E: installed plugin entries run their bundled dist/index.js closure without repository node_modules.
- `docs/tasks/0112_close-out-feature-l-verification-roll-up-carrier.md` — this carrier (AC carries feature L's scenarios verbatim).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | carrier AC carries feature L scenarios verbatim (re-read); spur feature check L pass=True findings=0, both covered |
| R2 | MET | fresh run: bundle-plugins tests 10/0, package.test 2/0, lint exit 0; 0110 E2E re-read |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Shipped package runs bundled plugins without repository node_modules | MET | test | 0110 published-package E2E; scripts/bundle-plugins.ts:51-78 source-entry bundling (re-read) |
| Scenario: Packaging stages no checkout-bound or VCS content | MET | test | scripts/bundle-plugins.test.ts:31-33 + :53-57; apps/cli/tests/package.test.ts:22,26-36; fresh 12 pass, lint 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | 0112 (done): PASS |
| P4 | evidence-rule-pass | — | both scenario AC rows carry executable test evidence |
| P4 | design-conformance | — | carried scenarios verbatim; roll-up carrier executed as designed |
| P4 | no-code-changes | — | 0112 diff is task/feature artifacts only |

### References

Task 0110 (0110 I1) — published-package E2E and bundle closure.
Task 0111 — packaging prune regression re-verified fresh (12 pass, lint 0).
Pattern: docs/tasks/0040 (feature D roll-up carrier), DD-09 coverage.

### History

- 2026-09-11T04:50:52.410Z backlog → todo (system)
- 2026-09-11T04:50:52.586Z todo → wip (system)
- 2026-09-11T04:51:00.880Z wip → testing (system)
- 2026-09-11T04:51:15.213Z testing → done (system)

