---
schema_version: 1
name: Harden daily XHS render against transient provider timeouts (vendor fallback opt-in)
status: backlog
template: feature-impl
created_at: 2026-10-07T22:09:47.119Z
updated_at: "2026-10-07T22:12:02.043Z"
feature_id: F61

---

## 0219. Harden daily XHS render against transient provider timeouts (vendor fallback opt-in)

### Background

During the 20261007 dogfood of `kk-daily-ai-voice`, the unattended `daily-xhs-render` stage failed on card-02 with a single transient provider error — `image-gen failed: The operation timed out.` (MiniMax image-01, ~5m37s total) — and exited 1, aborting the remaining cards and skipping the whole XHS channel (only recovered by hand-tailing the two kk stages after the run).

Root cause: `dailyXhsRender` (`plugins/kk/scripts/kk-workflow-stages.ts:1276`) takes no fallback argument and invokes `image-gen` in strict mode. In `plugins/generations/image-gen/src/index.ts:428`, `spec.fallback === undefined` propagates the first provider error unwrapped (D6 R1 strict fail-fast) — the vendor fallback chain (`generateWithFallback`) never engages. The daily cover stage already solved this opt-in: it accepts a `fallback` arg where `''` keeps strict (D6 0166 R7, `kk-workflow-stages.ts:1130-1137`), and the workflow passes it through a YAML var.

Card generation is also sequential: the card-02 throw prevented cards 03-04 from even being attempted.

### Requirements

- [ ] R1. `daily-xhs-render` accepts an optional trailing `fallback` arg with the same `''`-is-strict semantics as the cover stage (a provider name list enables the image-gen fallback chain).
- [ ] R2. A per-card provider failure that exhausts fallback does not abort later cards when feasible — the stage fails after attempting all cards, naming the failed card(s) in the error, so a partial series can still be packaged or the failure message pinpoints re-render scope (design call: whether to package partial or fail whole — pick and document).
- [ ] R3. Workflow `kk-daily-ai-voice.yaml` grows an `xhs_fallback` var (shipped default preserves today's strict behavior; recommend `"true"` or a vendor list in the shipped vars) and threads it into the render command (YAML line ~474).
- [ ] R4. Docs: the stage's arg row in `docs/04_DESIGN.md` and the workflow edge description updated in the same commit (T3).

### Acceptance Criteria

AC1. With a stub provider chain, a timed-out primary falls back per R1 and the card set renders — unit test in `plugins/kk/tests/kk-workflow-stages.test.ts`.
AC2. No `fallback` arg (or `''`) keeps today's strict single-provider behavior — existing tests unchanged and green.
AC3. `bun run lint` and both stage test suites (plugins/kk + apps/cli) pass.

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

`bun test plugins/kk/tests/kk-workflow-stages.test.ts` + `bun run lint`; end-to-end evidence: re-run `daily-xhs-render` against a work dir with a stub or re-rendered card plan, or accept the unit-level AC1/AC2 as the pipeline proof.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
