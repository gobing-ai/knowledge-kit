---
schema_version: 1
name: Tighten the store-docs AC4 assertion so a G31 status flip actually fails it
status: backlog
template: feature-impl
created_at: 2026-10-07T20:52:26.659Z
updated_at: "2026-10-07T20:53:23.769Z"
feature_id: G

---

## 0217. Tighten the store-docs AC4 assertion so a G31 status flip actually fails it

### Background

Found by task 0213's third review pass (2026-10-07) and carried rather than re-looped, since it is a P3 on a test that already passed — recorded here so it is not lost.

`apps/cli/tests/store-docs.test.ts` is the executable evidence for AC4 ("architecture docs record the store decision", task 0210 R7). Its fourth case asserts that `docs/05_FEATURES.md`'s G31 row does not claim `done` while task 0213 is outstanding:

```ts
const statusCell = (row?.split('|')[3] ?? '').trim().toLowerCase();
expect(statusCell).not.toBe('done');
```

The comparison is against the bare string `done`, but `05_FEATURES.md` spells a completed row `✅ done` (see its other rows). So flipping G31's status cell to `✅ done` would still pass this assertion — the check does not bind on the very condition it exists to catch. The review confirmed it with a mutation probe.

The other three cases bind fully (ADR-030's shipped status, 03's Persistent-store paragraph, 04's verb list), and the same case still asserts the row mentions `0213` and `backlog`, so AC4's substance is covered — this is a weakened assertion, not a false one.

**Provenance:** this is a follow-up to **task 0213 / feature G31**, which are both `done` — the
assertion defect was found by 0213's third review pass and carried rather than re-looped (it is a P3
on a test that already passes). It is filed under the parent `G` because G31 is terminal and a live
task cannot stay linked to a finished feature; reopening a legitimately-completed feature to hold a
test tidy-up would misstate G31's status. No G31 behaviour is reopened by this task.

### Requirements

- [ ] R1. The 05 status assertion fails for any spelling of a completed row, not just the bare token — `expect(statusCell).not.toMatch(/done/)` (or an explicit allowlist of the non-done spellings).
- [ ] R2. Prove it with a mutation: temporarily flip the G31 row to `✅ done` and show the test goes red, then restore. Record the probe output as the evidence.
- [ ] R3. Re-run `bun test apps/cli/tests/store-docs.test.ts` and `bun run test-pre-check` clean afterwards.
- [ ] R4. Note in the test header why the assertion is written that way (the file already carries a failure-first list), so the next editor does not relax it back to a token comparison.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
