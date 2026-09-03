---
schema_version: 1
name: "Core-facts blend contract + template prototype"
status: todo
template: feature-impl
created_at: 2026-09-03T04:21:27.498Z
updated_at: "2026-09-03T04:32:19.576Z"
feature_id: F61
dependencies: ["0088", "0089"]
---

## 0090. Core-facts blend contract + template prototype

### Background

**Type:** `wayfinder:prototype` — rough, cheap, concrete artifact to react to. Map: feature K. Blocked by 0088 + 0089 (needs the gap plan and the source output shapes).

**Sharp question:** what is the core-facts markdown contract (template-driven, per the operator's standing preference) and the blend mechanism that merges aihot + last30days + Horizon `Doc[]` into one dated facts file — a kk fan-in subcommand or a generator plugin?

**Deliverable:** a facts template file + a working rough blend demonstrated on ≥2 source inputs + contract notes in `## Solution`.

### Requirements

- [ ] R1. Core-facts markdown template defined — sections, dedup rule, per-item source attribution.
- [ ] R2. Blend mechanism chosen per `docs/design/fan-in-and-fan-out-specification.md` and demonstrated on ≥2 source inputs.
- [ ] R3. Verified that downstream consumers (article 2.2, script 2.3, cover 2.4, voice 2.5) can each render from the facts file alone.

### Acceptance Criteria

- [ ] Template + rough blend exist, run, and are committed or attached as task artifacts.
- [ ] Contract recorded in `## Solution` with the fan-in mechanism decision.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Prototype-grade only: template file + minimal blend script/plugin skeleton. Hardening graduates to implement tasks after this ticket resolves.

### Plan

- [ ] Draft the facts template from the 0088 gap plan + 0089 source shapes.
- [ ] Implement the rough blend (kk fan-in subcommand or generator plugin — decide from evidence).
- [ ] Run on ≥2 real-ish inputs; check R3 renderability.
- [ ] Write `## Solution`; append gist line to map K Decisions so far; graduate fog.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
