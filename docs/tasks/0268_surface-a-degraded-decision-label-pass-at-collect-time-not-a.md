---
schema_version: 1
name: Surface a degraded decision-label pass at collect time, not as an empty pool later
status: wip
template: issue
created_at: 2026-10-12T21:58:38.445Z
updated_at: "2026-10-13T20:58:47.574Z"
feature_id: G8

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 1
---

## 0268. Surface a degraded decision-label pass at collect time, not as an empty pool later

### Background

`kk store label` records a degraded verdict as `{source: 'default', reason: 'no-backend', confidence: null}` and the pass still prints `verdict: PASS`, so a completely broken decision backend is indistinguishable from a healthy pass at the collect boundary. On 2026-10-12 the two launchd `kk-collect` ticks (04:00, 10:00) reported `PASS` with `fallback: 22/26` and `33/45` consults, because the launchd job environment has no `TYPESAFE_API_KEY`. Every `typesafe`-routed decision then landed on its fail-closed default (`kk-item-china-politics` = 3), the `ai-news` extract profile's `lte: 1` gate excluded the whole day, and the daily run closed as `no-content` ~90 minutes later with no link back to the label pass.

The credential half is fixed for kk-collect's rendered artifacts (the plist/crontab now bind `TYPESAFE_API_KEY`). This task is the observability half: the failure has to surface where it happens, not as an empty pool downstream.

**Refine corrections (2026-10-13).**

- The current tree already contains the requested observability change in `ba3a3600`: `labelNewIds`
  computes the fallback share, emits `degraded`, warns on stderr, and keeps `verdict: PASS`; the
  workflow comment and design inventory were updated in that same commit. This task is therefore
  implementation-complete in source and remains only a verification/certification record.
- The current targeted regression passes with the shipped code: `apps/cli/tests/store-label.test.ts`
  has the degraded backend, unchanged china-politics default, and healthy-pass cases. No new
  production edit is part of this refinement.
- The previous Solution text's pre-change recipe redirected a historical blob over a working-tree
  source file. That is removed below; comparison must use `git diff ba3a3600^ ba3a3600 -- <paths>` or
  an isolated worktree so verification cannot clobber an in-progress tree.

### Requirements

- [ ] R1. Make the label pass's degradation rate visible at collect time — at minimum a warning line carrying the fallback count and the consulted decisions, so `launchd.log`/the ledger shows a sick backend without opening the store.
- [ ] R2. Preserve the shipped warning-only policy: `consults > 0 && fallback / consults > 0.5` emits `degraded: true` and a count/share diagnostic while retaining `verdict: PASS`; the collect guard comment explains this choice.
- [ ] R3. Do not change the fail-closed default values themselves: a degraded china-politics label staying at 3 is the deliberate moderation rail — the gap is that nothing says the rail fired.
- [ ] R4. Cover the degraded pass with a test that asserts the escalation, and confirm a healthy pass is unaffected.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Majority fallback is visible at the collect boundary (req: R1, R2)
  Given a label pass whose decision consults all use fail-closed defaults
  When the real store-label command runs through the existing stub decision backend
  Then stdout includes degraded true and verdict PASS
  And stderr names the fallback count and consulted-decision denominator

Scenario: AC2 — Moderation defaults remain fail closed (req: R3)
  Given a degraded china-politics decision
  When its row is stored
  Then its value and score remain 3 and its source remains default

Scenario: AC3 — Healthy passes remain quiet and regressions distinguish the fix (req: R4)
  Given the healthy and degraded decision stubs in store-label.test.ts
  When the existing regression runs
  Then both pass paths retain their expected labels and only the degraded path warns
  And review of ba3a3600's parent-to-commit diff shows that removing the emitted field and warning would violate these assertions
```

Layer: `apps/cli/tests/store-label.test.ts:591`, which invokes the real CLI/store path and substitutes only the decision provider. Certification still requires the full store-label suite and project gate; the filtered test's coverage exit alone is not a failed assertion.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-13T20:57:47.606Z

- Closed 2026-10-13: the threshold is already decided and implemented: strict majority, warning-only, preserve PASS and all fail-closed defaults. No new escalation policy is to be designed.
- Closed: this task needs certification of existing source, not another implementation. Keep wip until actual pipeline verification/recording is complete.
- Closed: use task-local regression scenarios with requirement bindings; the G8 feature remains the existing owner.
- No upstream dependency or downstream API change. Scope is the source/tests/workflow/design evidence named in Solution; no credential or catalog changes.

### Design

The shipped implementation keeps the existing label output contract and adds one observability field.
For the `--new-ids` collect pass, `degraded` is true only when `consults > 0` and
`fallback / consults > 0.5`; the strict majority avoids escalating an isolated refused answer, while
the zero-consult case stays healthy. A degraded pass writes a greppable stderr warning containing
`fallback: N/M consults (P%)` and still emits `verdict: PASS`, because the pass has already written
useful labels and the workflow must preserve them for the next tick. The existing `source: default`
values, including the china-politics default `3`, remain unchanged. Replay output is outside the
collect boundary and keeps its existing replay counters.

### Plan

The production change is already present in `ba3a3600`; this task needs verification rather than a
second implementation.

1. Run the degraded-and-healthy regression in `apps/cli/tests/store-label.test.ts` and confirm the
   stderr warning, `degraded` field, unchanged china-politics value, and zero warning on the healthy
   pass.
2. Run the complete store-label suite and the project quality gate; record any unrelated gate failure
   under its owning task instead of changing this label contract.
3. Re-read the `kk-collect` `label → release` guard and the design inventory to confirm they document
   the warning-only threshold and still validate only the PASS/confidence fields.

### Root Cause

Before `ba3a3600`, `labelNewIds` already counted `source: default` rows in the JSON pass line, but it
gave the caller no distinction between a healthy pass and a pass where the decision backend answered
from its fail-closed catalog defaults. The `kk-collect` release guard consumed only `verdict` and the
confidence enum, so both passes continued through the workflow and the later empty extraction pool
was the first visible symptom. The fix belongs at this boundary: count the default rows against the
number of decision consults, expose the majority-fallback state, and leave the moderation defaults and
the PASS routing contract intact.

### Solution

**Current implementation (confirmed 2026-10-13; `ba3a3600`).** The required file map is
`apps/cli/src/commands/store.ts:1014`, `apps/cli/tests/store-label.test.ts:591`,
`plugins/kk/workflows/kk-collect.yaml:256`, and `docs/design/kk-collect-and-daily-voice2.md:138`.

- `apps/cli/src/commands/store.ts` defines `DEGRADED_FALLBACK_SHARE = 0.5`, computes the fallback
  share from the rows written by the `--new-ids` pass, emits the stderr diagnostic above a strict
  majority, and adds `degraded` to the verdict JSON.
- `apps/cli/tests/store-label.test.ts` supplies an all-`source: default`, `reason: no-backend`
  decision stub, asserts `fallback: 8/8`, the warning, and china-politics `3`, then runs a healthy
  stub and asserts `degraded: false` with no warning.
- `plugins/kk/workflows/kk-collect.yaml` records why the warning is not a transition gate, and
  `docs/design/kk-collect-and-daily-voice2.md` records the emitted field and warning boundary.

There is no pending production diff for this task. Pre-change discrimination is preserved by the
commit comparison `git diff ba3a3600^ ba3a3600 -- apps/cli/src/commands/store.ts apps/cli/tests/store-label.test.ts`
and by the regression's assertions; it must not overwrite a working-tree file.

### Testing

2026-10-13 targeted verification:

- `bun test apps/cli/tests/store-label.test.ts -t 'pass whose consults mostly fell back'` — 1 pass,
  0 fail, 13 assertions. Bun exits 1 on this single-file run because the repository's per-file
  coverage threshold is intentionally unmet by a filtered test; the test itself passed.
- Static trace confirms the warning is emitted by `labelNewIds`, the workflow guard still accepts the
  PASS/confidence line, and the catalog fallback rows are unchanged.

The full store-label suite and project gate remain certification work; no PASS claim is made here.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-12T23:46:19.745Z todo → wip (system)

