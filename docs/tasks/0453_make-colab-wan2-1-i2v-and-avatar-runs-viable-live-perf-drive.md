---
schema_version: 1
name: Make Colab Wan2.1 I2V and avatar runs viable live (perf, Drive cache, live MuseTalk proof)
status: backlog
template: feature-impl
created_at: 2026-11-28T02:45:19.738Z
updated_at: "2026-11-28T02:45:19.932Z"
feature_id: D9

---

## 0453. Make Colab Wan2.1 I2V and avatar runs viable live (perf, Drive cache, live MuseTalk proof)

### Background

Captured from the creation title: "Make Colab Wan2.1 I2V and avatar runs viable live (perf, Drive cache, live MuseTalk proof)".

### Requirements

- [ ] R1. A 3-still wan21-i2v job on an A100 completes within the configured daily deadline. Candidate fixes: drop `enable_model_cpu_offload()` on A100, fewer steps/clips, a persistent weight cache. Measure CU per run and record it in the ledger. (0451 live run 2026-11-27 timed out at 45 min, ~6 CU.)
- [ ] R2. Weight caching works headless. Either find a consent-free Drive path, or replace it with a non-interactive persistent cache (e.g. HF snapshot on a pre-authorized volume). `colab drivemount` currently needs a per-VM browser OAuth consent and opens a page on the operator desktop during cron runs.
- [ ] R3. Remote worker failures are diagnosable: keep full worker stderr/stdout (not 300 chars) in run evidence. `colab exec` exits 0 on worker SystemExit.
- [ ] R4. One live MuseTalk (and optionally EchoMimicV2) presenter run with an operator-consented portrait produces a composited avatar video (0452 R1/R2 live proof, skipped 2026-11-27 with no portrait available).

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
