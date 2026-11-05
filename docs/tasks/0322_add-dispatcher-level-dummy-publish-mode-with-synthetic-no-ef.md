---
schema_version: 1
name: Add dispatcher-level dummy publish mode with synthetic no-effect receipts
status: done
template: feature-impl
created_at: 2026-10-22T18:41:31.549Z
updated_at: "2026-11-05T08:24:03.874Z"
feature_id: G15

dependencies: ["0321"]
priority: P1
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0322-verdict.json
---

## 0322. Add dispatcher-level dummy publish mode with synthetic no-effect receipts

### Background

No publish plugin has a dry-run mode, so the whole publish3 flow can only be rehearsed end-to-end if the send step fakes the dispatch. Design `docs/design/kk-daily-ai-voice3.md` §3 (`mode` semantics) and §8 rollout step 1.

**Refine corrections (2026-10-22)**

- The bypass point is the shared `sendRows` loop from 0321, before `dispatch` (`runFanout`). It is not `fanout.ts` `pluginDispatch` (:425): faking inside fan-out would still write fan-out aggregates and need a fake `Result`, which is more code for the same proof.
- The receipt shape `{ ok, effect, dummy }` in the old R1 maps onto the extended `ItcReceiptSchema`: `status: 'succeeded'`, `effect: 'none'`, `dummy: true`.
- Dummy rows are already excluded from readiness probes by 0321 R3, and exclusion from published counts belongs to the receipt classifier (0326). This task keeps only the send-side behaviour and its proof.

### Requirements

- [x] R1. In `publish-matrix-send`, a row with `mode: dummy`:
  - parses its resolved payload with kk-core `ContentSchema`; a parse failure is a failed receipt with error `invalid-payload` and `effect: none`.
  - writes receipt `{status:'succeeded', effect:'none', dummy:true, mode:'draft', url:'dummy://<targetId>', target, window, startedAt, finishedAt}` plus its events line.
  - never calls `dispatch`.
- [x] R2. Dummy receipts are idempotent: a rerun skips them like any succeeded receipt. A preset flip from `dummy` to `draft` sends the row on the next run, because a dummy receipt never blocks a real send: the skip rule treats `dummy: true` as not-yet-sent when the row is no longer dummy.
- [x] R3. The E2E test proves zero dispatches: the injected `dispatch` throws if called, and an all-dummy plan of the full daily-ai-voice matrix still finishes exit 0 with one receipt per row.
- Out of scope: classification and mark-published handling of dummy receipts (0326); fan-out changes.

### Acceptance Criteria

- [x] AC1 — Dummy mode exercises the full publish path without spawning plugins (req: R1, R3)
- [x] AC2 — A dummy receipt never blocks a later real send of the same target (req: R2)

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

| Change | What / why |
| --- | --- |
| `apps/cli/src/itc-publish.ts:415` | `SendRow.mode` widened to `draft | live | dummy`; a dummy row is a planned row that never reaches the dispatcher. |
| `apps/cli/src/itc-publish.ts:437` | `SendRowsOptions.dummyReceipt` — the one injectable seam the dummy branch needs; absent means a dummy row records `dummy-receipt-unavailable` rather than a failure to send. |
| `apps/cli/src/itc-publish.ts:501` | Skip rule: a succeeded receipt is skipped **unless** it is `dummy: true` and the row is no longer dummy, so a rehearsal never blocks a real send (R2). |
| `apps/cli/src/itc-publish.ts:559` | The dummy branch: after payload resolution and digesting, and before `runFanout`, so the rehearsal proves the payload path and spawns no process (R1, R3). |
| `apps/cli/src/publish-matrix.ts:430` | `writeDummyReceipt` parses the resolved payload as kk-core `Content`; invalid → `{status: 'failed', effect: 'none', dummy: true, error: 'invalid-payload'}`; valid → `{status: 'succeeded', effect: 'none', dummy: true, mode: 'draft', url: 'dummy://<id>', target, window, startedAt, finishedAt}`. |
| `apps/cli/src/publish-matrix.ts:588` | `sendPublishMatrix` passes the writer and maps the row mode straight through; the old `dummy-mode-not-implemented` shortcut is gone. |
| `apps/cli/tests/publish-matrix.test.ts:520` | New dummy-mode suite: an all-dummy matrix with a dispatch that throws if called (zero calls, four synthetic receipts, `dummy://` link resolution), idempotent rerun then a preset flip to `draft` that dispatches exactly once, and a corrupted payload yielding `invalid-payload` with no dispatch. |
| `docs/04_DESIGN.md:2043` | The surface note replaces the "dummy rows do not send yet" handoff with the shipped semantics (T3). |

**Verification:** `bun run lint` clean; `bun test apps/cli/tests/publish-matrix.test.ts apps/cli/tests/publish-matrix-stage.test.ts apps/cli/tests/itc-publish.test.ts` → 60 pass, 0 fail.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/itc-publish.ts:559` dummy branch before dispatch; `apps/cli/src/publish-matrix.ts:660` writeDummyReceipt (effect none, dummy://<id>); `apps/cli/tests/publish-matrix.test.ts:1110`, `apps/cli/tests/publish-matrix.test.ts:1259`; a dummy tier-0 url never reaches a draft/live row (`apps/cli/src/publish-matrix.ts:738`, `apps/cli/tests/publish-matrix.test.ts:1164`) |
| R2 | MET | `apps/cli/src/itc-publish.ts:501` dummy-only prior receipt does not block a real send; `apps/cli/tests/publish-matrix.test.ts:1212` |
| R3 | MET | `apps/cli/tests/publish-matrix.test.ts:1110` full matrix with a throwing dispatch: zero calls, one synthetic receipt per row |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Dummy mode exercises the full publish path without spawning plugins (req: R1, R3) | MET | test | `apps/cli/tests/publish-matrix.test.ts:1110`, `apps/cli/tests/publish-matrix.test.ts:1259`; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
| AC2 — A dummy receipt never blocks a later real send of the same target (req: R2) | MET | test | `apps/cli/tests/publish-matrix.test.ts:1212`; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: HIGH
Verdict: PASS

**Scope:** the dummy branch and its seam — `apps/cli/src/itc-publish.ts` (`SendRow`, `SendRowsOptions`, the skip rule, the dummy branch), `apps/cli/src/publish-matrix.ts` (`writeDummyReceipt`, the send wiring), the dummy-mode suite in `apps/cli/tests/publish-matrix.test.ts`, and the `docs/04_DESIGN.md` surface note.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | `writeDummyReceipt` validated the *raw* payload while its digest was computed over the *resolved* one, so a tier-≥1 dummy row could validate a payload it would not have sent. | Fixed — the writer reads `context.payloadPath` (`apps/cli/src/publish-matrix.ts:430`). |
| P4 | The dummy branch carried a twenty-line inline fallback receipt for a caller that never exists (every planning path passes the writer). | Fixed — an unconfigured writer now records the row as skipped with a named diagnostic instead of fabricating a receipt (`apps/cli/src/itc-publish.ts:559`). |

**SECUA / architecture**

- **Security** — the branch returns before `runFanout`, so a dummy row cannot spawn a process, open a browser or touch the network; the test's dispatch throws if it is ever reached (`apps/cli/tests/publish-matrix.test.ts:556`).
- **Efficiency** — one payload read per dummy row (the rehearsal's whole point is to prove that read + parse); no directory scans.
- **Correctness** — the receipt is a real `ItcReceipt` (`dummy: true`, `effect: none`), so downstream classifiers can exclude it by flag rather than by plugin name; the skip rule separates "already rehearsed" from "already published" (`apps/cli/src/itc-publish.ts:501`), which is the only behaviour change visible to a non-dummy run, and it is unreachable for itc rows because they never carry `mode: dummy`.
- **Usability** — an invalid payload reports `error: invalid-payload` on the receipt, which is exactly what the publish report renders.
- **Architecture** — the branch lives in the shared `sendRows` loop with the writer injected from the matrix module, so there is no import cycle and `fanout.ts` stays untouched (no fake `Result`, no stub plugin).

**Residual risk**

- Dummy receipts carry `mode: "draft"` by design (a rehearsal is a draft send); a future live rehearsal would need a distinct field rather than overloading `mode`.
- Classification of dummy receipts into publish status belongs to 0326; today a dummy receipt counts as `succeeded` for resend purposes and is excluded only by `dummy: true` at the consumer.
- The full gate failed once on `apps/board/tests/installed-board.test.ts:1038` (`on schedule` → `unknown`, the cadence fetch not yet answered under load) and passed on the immediate recheck; it is an unrelated board timing race, out of this task's scope, and green in isolation.

**Verification:** `bun run lint` clean; `bun test` on the matrix, stage and itc suites → 62 pass, 0 fail; `spur task gate 0322 recheck` → PASS (4078+ tests, 0 failures).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:49.912Z backlog → todo (system)
- 2026-10-22T20:42:17.618Z todo → wip (system)
- 2026-10-22T21:38:24.436Z wip → testing (system)
- 2026-10-22T21:38:27.070Z testing → done (system)

