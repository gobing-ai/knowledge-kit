---
schema_version: 1
name: "Core-facts blend contract + template prototype"
status: todo
template: feature-impl
created_at: 2026-09-03T04:21:27.498Z
updated_at: "2026-09-03T04:40:45.846Z"
feature_id: F61
dependencies: ["0088", "0089"]
---

## 0090. Core-facts blend contract + template prototype

### Background

**Type:** `wayfinder:prototype` — rough, cheap, concrete artifact to react to. Map: feature F61. Blocked by 0088 + 0089 (needs the gap plan and the source output shapes).

**Sharp question:** what is the core-facts markdown contract (template-driven, per the operator's standing preference) and the blend mechanism that merges aihot + last30days + Horizon `Doc[]` into one dated facts file — a kk fan-in subcommand or a generator plugin?

**Deliverable:** a facts template file + a working rough blend demonstrated on ≥2 source inputs + contract notes in `## Solution`.

### Requirements

- [ ] R1. Core-facts markdown template defined — sections, dedup rule, per-item source attribution.
- [ ] R2. Blend mechanism chosen per `docs/design/fan-in-and-fan-out-specification.md` and demonstrated on ≥2 source inputs.
- [ ] R3. Verified that downstream consumers (article 2.2, script 2.3, cover 2.4, voice 2.5) can each render from the facts file alone.

Non-goals: no production plugin or kk-core schema change; no article/script/cover template design (downstream); no scheduling.

### Acceptance Criteria

- [ ] Template + rough blend exist, run, and are committed or attached as task artifacts.
- [ ] Contract recorded in `## Solution` with the fan-in mechanism decision.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T04:40:23.667Z

- Deferred to resolution time (owner: resolving session): if 0088's blend-home recommendation conflicts with the fan-in/fan-out spec, escalate to the operator before prototyping.

### Design

**WHAT:** (a) a core-facts markdown template (frontmatter date + source roster; sections for headline items with per-item source attribution; dedup rule), and (b) a rough blend prototype merging ≥2 source `Doc[]` inputs into one dated facts file.

**WHY:** every stage-2 consumer renders from this one artifact — a wrong contract here costs four downstream reworks.

**Assumes from deps:** 0088's recommended blend home (kk fan-in subcommand vs generator plugin) and 0089's per-source output shapes. If either answer contradicts this ticket's premise, surface it on map F61 — do not silently re-own the upstream contract.

**WHERE:** prototype scratch under `.spur/run/f61-blend/` (gitignored); the template draft and the mechanism decision are recorded verbatim in `## Solution` (hardening graduates to implement tasks afterward). Read set: `docs/design/fan-in-and-fan-out-specification.md`, 0088/0091-adjacent design docs, dep Solutions.

**Frozen names (proposal-grade):** facts file `2-facts/core-facts.md`; template placeholder syntax follows the repo's existing template conventions found during 0088.

**Anti-patterns:** no new package; no kk-core contract change; no LLM-call wiring in the prototype (mechanical merge only — LLM blending is a later implement decision); do not design cover/article/script templates.

**Handoff:** implement tasks graduated from this ticket consume the template + mechanism decision verbatim from Solution.

### Plan

- [ ] 1. Claim after 0088 + 0089 are done; read their Solutions first. (deps)
- [ ] 2. Draft the facts template (sections, dedup rule, attribution). (R1)
- [ ] 3. Pick the blend mechanism per the fan-in/fan-out spec + 0088's recommendation. (R2)
- [ ] 4. Build the rough blend in `.spur/run/f61-blend/`; run it on ≥2 source inputs. (R2)
- [ ] 5. Walk the four downstream consumers against the facts file; note anything unrenderable. (R3)
- [ ] 6. Write `## Solution` (template + mechanism decision); graduate cleared fog on map F61. (R1–R3)

Verification intent: `spur task check 0090` clean; prototype runs and its output demonstrates R2; R3 walk notes are in Solution.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Map: `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`
- `docs/design/fan-in-and-fan-out-specification.md`
- Depends on: 0088 (blend home), 0089 (source output shapes)

### History
