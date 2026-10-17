---
schema_version: 1
name: Verify the redesigned Collect module in the installed Spur Board against the real store
status: todo
template: feature-impl
created_at: 2026-10-17T05:04:06.960Z
updated_at: "2026-10-17T05:19:42.126Z"
feature_id: G81
priority: P2
tags:
  - board
  - e2e
  - verification
estimate_hours: 3

dependencies: ["0308"]
---

## 0309. Verify the redesigned Collect module in the installed Spur Board against the real store

### Background

Implements: R11 — Installed Board verification against the real store.

Operator ask (run 5f03d609-ece9-4f6f-9555-dba2a7b0cb2b): the redesigned Collect module must help the end user understand kk-collect results and progress; this proves it end to end on real data. Design: docs/design/collect-store-views.md §5.

**Refine corrections (2026-10-16)**
- "start the reader over a temp copy of `.works/kk.db`" → the reader opens `<projectPath>/.works/kk.db` of the throwaway project the harness builds (`apps/board/tests/installed-board.test.ts:102`), whose Spur runs are fixtures `r-a`, `r-b`, … (`:405-417`); a copy of the live store holds none of those run ids, so every row would be `null` → split the check: (a) repeatable test — seed the throwaway project's `.works/kk.db` through the real kk-store DAOs (`CollectRunsDao.start/finish`, items, labels, `SelectionsDao.insertMany`) with a row for `r-a` and none for `r-b`; (b) live check — the installed Board over this checkout's own project and real store, read-only.
- "never the live file" → (b) must read the live store to prove real data; safety comes from 0307's read-only open, proven by `sqlite_master` + row-count digests before/after in the artifact, not from copying.
- "record that none exists" → live `.spur/spur.db` already holds a failed kk-collect run (59 done / 1 failed / 3 running vs 47 `collect_runs`), so a no-store-row run exists; the artifact records which run id was checked.

### Requirements

- [ ] R1 — `apps/board/tests/installed-board.test.ts` gains a Collect store scenario: the throwaway project's `.works/kk.db` is seeded through the real kk-store DAOs with a `collect_runs` row, items, label rows and a selection for fixture run `r-a` and nothing for `r-b`; Chromium on the installed Board asserts Overview (banner state, `r-a` counts, `r-b` = `no store row`), Run detail funnel and label quality for `r-a`, Items paging + one filter, `?tab=results` → Run detail, and zero console errors.
- [ ] R2 — Same scenario with the store file removed shows the `board.store.missing` diagnostic in the store panels while Execution progress still renders; the file is not created by the request.
- [ ] R3 — `apps/board/scripts/verify-collect-live.ts` (run with `bun`) opens the installed Board over this checkout's real project, visits Overview, Run detail and Items for one run with a store row and one without, and writes `.works/.board/verify/<stamp>/` containing `report.json` (checked run ids, per-tab pass/fail, console errors) and per-tab screenshots, plus `sqlite_master` and per-table row-count digests of `.works/kk.db` taken before and after; it exits non-zero if the digests differ or any tab fails.

**Out of scope:** reader or UI changes (0307/0308) beyond fixes the check exposes; CI wiring for the live script (operator-run, needs the real store).

### Acceptance Criteria

- [ ] AC1 — Installed Board verification against the real store

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T05:19:40.632Z

- Q: Copy the live store or read it in place? → A: fixture-seeded store for the repeatable test; live store read in place for the operator check, guarded by before/after digests. Closed 2026-10-16 (refine).

### Design

- WHAT/WHY: prove end to end that the redesigned module shows real Collect results and progress without touching the store. WHERE: `apps/board/tests/installed-board.test.ts` (repeatable, fixture store), `apps/board/scripts/verify-collect-live.ts` (operator-run, real store), artifact `.works/.board/verify/<stamp>/`.
- Reuse: the installed-Board harness helpers (throwaway project, `capture`, Chromium launch) and the Playwright already in `apps/board` devDependencies; seeding uses kk-store's public DAOs, never raw SQL.
- Digest = sha256 over `SELECT type,name,sql FROM sqlite_master ORDER BY name` plus `count(*)` of `collect_runs`, `items`, `labels`, `selections`, read with a read-only connection (`sqlite3 -readonly` semantics). A collect tick landing mid-check changes counts → rerun; the script names that cause in its failure message.
- Rejected: copying the live store into the throwaway project (run ids never match fixtures); mocking the store (the point is real data).

### Plan

1. Add the failing Collect store scenario to `installed-board.test.ts` (seed helper via DAOs; missing-store case). (R1, R2)
2. Fix anything in 0307/0308 output the scenario exposes; make it pass.
3. Write `verify-collect-live.ts`; run it against this checkout; keep the artifact path. (R3)
4. Record test result and artifact path in Testing evidence; `bun run lint`, `bun run test`, `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
