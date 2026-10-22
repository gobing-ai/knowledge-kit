---
schema_version: 1
name: Add dispatcher-level dummy publish mode with synthetic no-effect receipts
status: todo
template: feature-impl
created_at: 2026-10-22T18:41:31.549Z
updated_at: "2026-10-22T19:09:49.912Z"
feature_id: G15

dependencies: ["0321"]
priority: P1
estimate_hours: 2
---

## 0322. Add dispatcher-level dummy publish mode with synthetic no-effect receipts

### Background

No publish plugin has a dry-run mode, so the whole publish3 flow can only be rehearsed end-to-end if the send step fakes the dispatch. Design `docs/design/kk-daily-ai-voice3.md` §3 (`mode` semantics) and §8 rollout step 1.

**Refine corrections (2026-10-22)**

- The bypass point is the shared `sendRows` loop from 0321, before `dispatch` (`runFanout`). It is not `fanout.ts` `pluginDispatch` (:425): faking inside fan-out would still write fan-out aggregates and need a fake `Result`, which is more code for the same proof.
- The receipt shape `{ ok, effect, dummy }` in the old R1 maps onto the extended `ItcReceiptSchema`: `status: 'succeeded'`, `effect: 'none'`, `dummy: true`.
- Dummy rows are already excluded from readiness probes by 0321 R3, and exclusion from published counts belongs to the receipt classifier (0326). This task keeps only the send-side behaviour and its proof.

### Requirements

- [ ] R1. In `publish-matrix-send`, a row with `mode: dummy`:
  - parses its resolved payload with kk-core `ContentSchema`; a parse failure is a failed receipt with error `invalid-payload` and `effect: none`.
  - writes receipt `{status:'succeeded', effect:'none', dummy:true, mode:'draft', url:'dummy://<targetId>', target, window, startedAt, finishedAt}` plus its events line.
  - never calls `dispatch`.
- [ ] R2. Dummy receipts are idempotent: a rerun skips them like any succeeded receipt. A preset flip from `dummy` to `draft` sends the row on the next run, because a dummy receipt never blocks a real send: the skip rule treats `dummy: true` as not-yet-sent when the row is no longer dummy.
- [ ] R3. The E2E test proves zero dispatches: the injected `dispatch` throws if called, and an all-dummy plan of the full daily-ai-voice matrix still finishes exit 0 with one receipt per row.
- Out of scope: classification and mark-published handling of dummy receipts (0326); fan-out changes.

### Acceptance Criteria

- [ ] AC1 — Dummy mode exercises the full publish path without spawning plugins (req: R1, R3)
- [ ] AC2 — A dummy receipt never blocks a later real send of the same target (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:08:56.297Z

- **Q: Fake at the spawn seam or before dispatch?** Closed: before dispatch, the smallest change that still proves no process or network.
- **Q: Global `--dummy` switch?** Closed: owned by 0321 (`publish-matrix-plan --dummy`), so dummy-ness is visible in the plan file and not hidden in send.

### Design

- Single branch in `sendRows` (0321): `if (row.mode === 'dummy') return writeDummyReceipt(row)` before resolving `dispatch`.
- Skip rule addition: an existing receipt counts as done only when `!(receipt.dummy === true && row.mode !== 'dummy')`.
- `writeDummyReceipt` lives in `apps/cli/src/publish-matrix.ts` next to the real receipt writer and reuses its digest and timestamps.
- itc rows never have `mode: dummy`, so the branch is unreachable for itc (R6 of 0321 holds).
- Anti-patterns:
  - no env flag;
  - no stub plugin directory;
  - no change in `fanout.ts` or `invoke.ts`;
  - no network or browser for dummy rows, including link resolution (placeholders resolve to `dummy://` urls when the tier-0 receipt is dummy).
- Handoff: 0326 reads `dummy` to exclude these rows from `published` counts.

### Plan

1. Write the failure list first: a dummy row calling dispatch, an invalid payload passing silently, a dummy receipt blocking a later real send, and a dummy tier-0 url breaking placeholder resolution. (R1–R3)
2. Add the dummy branch and skip-rule tweak in `sendRows` / `publish-matrix.ts`. (R1, R2)
3. Extend `apps/cli/tests/publish-matrix.test.ts`:
   - all-dummy plan → N receipts, throwing dispatch never hit (R3);
   - flip one row to `draft` → that row is dispatched once (R2);
   - invalid payload → failed receipt (R1).
4. Run `bun run lint && bun run test`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:49.912Z backlog → todo (system)

