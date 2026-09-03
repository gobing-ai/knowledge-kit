---
schema_version: 1
name: "Wrap last30days + Horizon as Doc[] ingestion sources"
status: todo
template: feature-impl
created_at: 2026-09-03T04:21:27.333Z
updated_at: "2026-09-03T04:24:44.859Z"
feature_id: K
---

## 0089. Wrap last30days + Horizon as Doc[] ingestion sources

### Background

**Type:** `wayfinder:research` — resolve with evidence reading + `--help`-level probing, no full crawls. Map: feature K.

**Sharp question:** how do the `last30days` skill and Horizon (`(cd ~/tools/Horizon && uv run horizon)`) each become `Doc[]` inputs to the pipeline — what is the thinnest adapter per source (ingestion plugin vs workflow shell step), and what are their invocation contracts and output shapes?

**Evidence:** `~/.agents/skills/last30days/` (SKILL.md, scripts); `~/tools/Horizon` (pyproject, docs/, profiles/); `docs/design/ingestion-plugin-specification.md`.

**Deliverable:** per-source adapter recommendation (plugin vs shell step) + invocation/output-shape notes in `## Solution`.

### Requirements

- [ ] R1. last30days invocation contract + output shape documented; adapter recommended.
- [ ] R2. Horizon invocation contract (profiles/config) + output shape documented; adapter recommended.
- [ ] R3. Both adapters terminate in `Doc[]` per `docs/design/ingestion-plugin-specification.md`, or a justified shell-step alternative is recorded.

### Acceptance Criteria

- [ ] Both sources have a documented, evidence-backed path to `Doc[]`.
- [ ] Recommendation names plugin vs shell step for each source, with rationale.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

n/a — research ticket. Output is evidence + recommendation in `## Solution`.

### Plan

- [ ] Read last30days SKILL.md + scripts; probe its CLI/doctor at help level.
- [ ] Read Horizon pyproject/docs/profiles; probe `uv run horizon --help` (no full crawl).
- [ ] Compare against ingestion-plugin-specification; choose adapter per source.
- [ ] Write `## Solution`; append gist line to map K Decisions so far.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
