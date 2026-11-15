---
schema_version: 1
name: Make the pre-spend floor ladder use the authored script's measure so a thin day widens instead of dying at TTS
status: wip
template: standard
created_at: 2026-11-15T21:08:47.145Z
updated_at: "2026-11-15T22:32:55.714Z"

ac_altitude: task-local
ac_numbering: task-local
---

## 0377. Make the pre-spend floor ladder use the authored script's measure so a thin day widens instead of dying at TTS

### Background

Observed on the production host 2026-11-15, run `kk-news-generate-20261115-1794773860762` (failed).

The pool ladder (`dailyExtract`, `plugins/kk/scripts/daily-stages.ts:399-466`) widens the window
`24h → 48h → 72h → 168h` only while the **pre-spend estimate** misses the episode floor. That estimate
(`estimateSpokenMinutes`, `daily-stages.ts:313`) is:

    seconds = 8 + rawDocChars * SPEAK_CHAR_EXPANSION / spokenCharRate
    SPEAK_CHAR_EXPANSION = 1.4

But the writer does not expand raw doc chars by 1.4 — it condenses them. Measured on today's run:

| Measure | Value |
| --- | --- |
| raw pool chars at extract (`4 items`) | 7,244 |
| pre-spend estimate (1.4x @ 5.2 cps) | **32.6 min — passes the 15 min floor** |
| authored spoken script | **2,053 chars** |
| post-authoring refusal (`daily-generate`) | **6.2 min @ 5.6 cps — refuses** |

Actual ratio: 2,053 / 7,244 = **0.28x**, not 1.4x — the pre-spend estimate is ~5x optimistic for
markdown-heavy ingest bodies. Consequences:

1. The ladder never widens, so a genuinely thin day is never filled from the backlog (exactly what the
   ladder exists for — its own comment says "a thin one is filled from the backlog instead of dropped").
2. The run pays a full authoring pass (curate → article → cover → script → safety, ~24 min and real
   tokens) and only then dies at the TTS gate, where no widening is possible.
3. `no-content` is recorded after that spend instead of before it, so a thin day looks like a failure
   rather than a verdict.

Live supply at 2026-11-15 13:07 after the failed run consumed its 4 items: `24h → 0`, `72h → 10 items /
14,803 raw chars`, `168h → 20 items / 27,704 raw chars`. At the measured 0.28x ratio those are ≈12 min
and ≈23 min of speech, so the 72h rung still misses the 15 min floor and 168h clears it — the ladder
had two more rungs to climb and could never reach them.

Task 0376 remains the owner of the scheduled-day observation; this task is the underlying defect.

### Requirements

- [ ] R1. Make the widen-or-refuse decision use the same measure the TTS gate uses, so a pool that cannot reach `episode_min_minutes` after authoring widens the window instead of failing post-spend — and a pool that can reach it is not widened.
- [ ] R2. Keep the widening bounded and idempotent: one bounded ladder with a documented ceiling, no unbounded re-authoring loop, and the frozen-pool guard (`plan already authored — keeping the frozen pool`) still honoured for legitimate reruns of the same day.
- [ ] R3. Record the decision in the run: which measure drove it, the ladder rung chosen, and the estimate at each rung, so `kk news status` and the run report can explain a `no-content` or a widened day without reading stage logs.
- [ ] R4. Add a regression test that fails on today's behaviour — a pool whose raw chars pass the pre-spend estimate but whose authored script lands below the floor must widen rather than refuse — and prove it fails before the fix.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A thin day widens instead of failing late (req: R1)
  Given a pool whose raw chars pass the pre-spend estimate but whose authored script lands below episode_min_minutes
  When generation runs the ladder
  Then it widens to the next rung and re-authors, or records no-content at the widest rung, without a post-TTS refusal

Scenario: AC2 — A sufficient day is not widened (req: R1)
  Given a pool whose authored script clears the floor
  When generation runs
  Then the configured window is used exactly once and no extra rung is climbed

Scenario: AC3 — Widening stays bounded and rerun-safe (req: R2)
  Given the documented ceiling and the frozen-pool guard
  When the ladder exhausts or a same-day rerun starts
  Then it stops at the ceiling, keeps the authored plan's pool byte-for-byte, and never loops

Scenario: AC4 — The decision is recorded (req: R3)
  Given any widen or refuse outcome
  When kk news status and the run report are read
  Then the driving measure, the chosen rung and the per-rung estimates are present

Scenario: AC5 — The regression is covered (req: R4)
  Given the new test for the measured mismatch
  When it runs against the pre-fix code
  Then it fails, and it passes only after the ladder uses the authored-script measure
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. Reproduce from today's numbers: assert the pre-spend estimate passes (32.6 min) while the authored
   script refuses (6.2 min) for the same pool.
2. Decide the seam: measure the authored script (the TTS gate's own measure) and feed that decision back
   into the ladder, keeping the frozen-pool guard and the 168h ceiling.
3. Write the failing regression test first (AC1 + AC5), then implement.
4. Verify with a real generation on this host: ladder widens, script clears the floor, bundle exists.
5. Record the decision in the run artifacts and assert it in the test (AC4).

### Solution

Three stacked defects, each found by running the real path and fixed in place:

1. **`apps/cli/plugins` ratio** — `plugins/kk/scripts/daily-stages.ts` `estimateSpokenMinutes` now takes
   an `expansion` argument. The widen decision and the pre-spend gate pass the new
   `SPEAK_CHAR_EXPANSION_FLOOR = 0.28` (worst measured spoken/raw ratio; earlier measurements 0.71 and
   1.38), while the post-TTS duration artifact keeps `SPEAK_CHAR_EXPANSION = 1.4` as the reported
   arithmetic — the same opposite-safe-direction argument `scriptFloorCharRate` already makes about the
   char rate. Commit `c6414ff3`.
2. **Stale refusal field** — `applyFloorGate` computed with the conservative ratio but stamped
   `expansion: 1.4` into its refusal artifact, so the artifact's minutes and ratio disagreed. It now
   records the ratio it used. Commit `56390fc8`.
3. **Pool cap vs QC attrition** — with the ladder finally widening, QC admitted ~0.32 of the raw pool
   chars, so a 20-item cap landed at 10.3 min whatever window the ladder reached. `plugins/kk/decisions/extract/ai-news.yaml`
   pins `limit: 40` (measured: 20 → 11.4 min, 32 → 13.2 min, 40 → PASS) and the machine config sets
   `workflows.kk-news-generate.plan_max_items: 40` + `window: 168h`. Commits `a024ed28`, and the cap-40
   follow-up.

Tests: `plugins/kk/tests/daily-extract-ladder.test.ts` (new; RED before fix 1, GREEN after) and
`apps/cli/tests/kk-workflow-stages.test.ts` (two floor fixtures moved onto the measured ratio rather
than relaxed). `bun run test` 5175 pass / 0 fail, `bun run lint` clean, `bun run build` exit 0.

Not yet done: R2's bounded re-authoring loop is still implicit (the ladder decides once, at extract);
the durable fix is to let the QC refusal feed a bounded widen instead of a fixed `window: 168h`.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-15T22:32:55.340Z backlog → todo (system)
- 2026-11-15T22:32:55.714Z todo → wip (system)

