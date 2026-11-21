---
schema_version: 1
name: "Optimize daily-xhs-render cards stage: reuse browser instance and parallelize card rendering"
status: todo
template: issue
created_at: 2026-11-21T03:56:36.426Z
updated_at: "2026-11-21T03:58:34.977Z"
feature_id: F61

tags: ["perf", "cards", "deferred"]
ac_altitude: task-local
ac_numbering: task-local
---

## 0418. Optimize daily-xhs-render cards stage: reuse browser instance and parallelize card rendering

### Background

In `.works/kk-news-generate/ledger.md`, the `cards` stage (`daily-xhs-render`) takes **27 to 46 minutes** per daily run, making it the second largest wall-clock bottleneck after audio generation. Operator explicitly chose to **defer** this optimization (P3) behind memory reclamation (`0415`) and audio hardening (`0416`, `0417`).

### Requirements

- [ ] R1. Reuse a single Playwright browser instance (opening/closing lightweight pages/contexts) across all cards in a `daily-xhs-render` run instead of spawning Chromium per card.
- [ ] R2. Parallelize card image generation and rendering with bounded concurrency (configurable, default 2-3 to stay safe on 16 GB RAM).
- [ ] R3. Preserve identical card output artifacts, filenames, sidecars, and visual legibility (F616).
- [ ] R4. Reduce `cards` stage wall time from 27-46 min to target <= 8-12 min, verified on a real run.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Browser reuse across cards (req: R1, R3)
  Given a run with 4-6 XHS cards to render
  When `daily-xhs-render` executes
  Then Chromium is launched at most once for the stage and all card PNGs/sidecars match the existing output contract

Scenario: AC2 — Bounded concurrency reduces wall time without OOM (req: R2, R4)
  Given bounded concurrency (2-3) on the 16 GB M4 Mac mini
  When `daily-xhs-render` completes a full card set
  Then stage wall time is <= 12 min with zero browser/OOM errors
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- Hoist browser launch/teardown outside the per-card loop with `try / finally` cleanup.
- Use a small bounded worker pool (concurrency 2-3) for card image API calls + page screenshots.
- Evaluate whether pure deterministic HTML/CSS typesetting can optionally use a lighter renderer if Chromium remains heavy, without regressing CJK typography.

### Plan

1. [ ] Profile `daily-xhs-render` (`plugins/kk/scripts/daily-stages.ts:6253`) to split time between image API wait vs Chromium launch/render.
2. [ ] Refactor browser lifecycle to launch once per stage and reuse across pages.
3. [ ] Add bounded concurrency (default 2-3) with clean error aggregation and resource cleanup.
4. [ ] Add/update unit tests, run `bun run gate`, sync `plugins/kk/scripts/`, and benchmark on a daily run.

### Root Cause

`plugins/kk/scripts/daily-stages.ts:6253` renders 4-6 XHS cards strictly sequentially. For each card, it issues an image generation API call and then spawns a fresh headless Chromium/Playwright browser process to render HTML/CSS and capture a screenshot. Under memory pressure, launching headless Chromium 4-6 times serially adds heavy CPU/disk/memory overhead.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/kk/scripts/daily-stages.ts` (line 6253)
- `.works/kk-news-generate/ledger.md` (27-46 min `cards` timings)
- Deferred per operator decision on 2026-11-20 ("defer the fixing with #3")

### History
