---
schema_version: 1
name: "Wrap last30days + Horizon as Doc[] ingestion sources"
status: todo
template: feature-impl
created_at: 2026-09-03T04:21:27.333Z
updated_at: "2026-09-03T04:40:45.627Z"
feature_id: F61
---

## 0089. Wrap last30days + Horizon as Doc[] ingestion sources

### Background

**Type:** `wayfinder:research` — resolve with evidence reading + `--help`-level probing, no full crawls. Map: feature F61.

**Sharp question:** how do the `last30days` skill and Horizon (`(cd ~/tools/Horizon && uv run horizon)`) each become `Doc[]` inputs to the pipeline — what is the thinnest adapter per source (ingestion plugin vs workflow shell step), and what are their invocation contracts and output shapes?

**Evidence:** `~/.agents/skills/last30days/` (SKILL.md, scripts); `~/tools/Horizon` (pyproject, docs/, profiles/); `docs/design/ingestion-plugin-specification.md`.

**Deliverable:** per-source adapter recommendation (plugin vs shell step) + invocation/output-shape notes in `## Solution`.

### Requirements

- [ ] R1. last30days invocation contract + output shape documented; adapter recommended.
- [ ] R2. Horizon invocation contract (profiles/config) + output shape documented; adapter recommended.
- [ ] R3. Both adapters terminate in `Doc[]` per `docs/design/ingestion-plugin-specification.md`, or a justified shell-step alternative is recorded.

Non-goals: no live 30-day pulls or full Horizon crawls; no plugin code written; dedup/merge semantics belong to 0090, not here.

### Acceptance Criteria

- [ ] Both sources have a documented, evidence-backed path to `Doc[]`.
- [ ] Recommendation names plugin vs shell step for each source, with rationale.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T04:40:22.648Z

- None open. Both source paths verified present on disk 2026-09-02 (`~/.agents/skills/last30days`, `~/tools/Horizon`).

### Design

**WHAT:** a two-source adapter brief — per source: invocation contract, output shape, recommended adapter (ingestion plugin vs workflow shell step), rationale.

**WHY:** the blend contract (0090) and the workflow extension both need to know whether last30days/Horizon arrive as plugins (`kk executor run <name>`) or as shell steps producing JSON.

**WHERE — frozen read set (verified present 2026-09-02):** `~/.agents/skills/last30days/SKILL.md` + its `scripts/`; `~/tools/Horizon/{pyproject.toml, docs/, profiles/}`; `docs/design/ingestion-plugin-specification.md`; the `Doc` contract in `packages/kk-core/src/`.

**Probe budget:** `--help` / doctor-level invocations only; no full crawls, no network fan-out, no API-key spend.

**Deliverable contract — `## Solution` carries two named subsections:** `last30days` and `Horizon`, each with invocation / output shape / adapter choice / rationale.

**Anti-patterns:** do not scaffold `last30days-ingest` or `horizon-ingest` (that is implement work graduated after this ticket); do not design dedup (0090); do not broaden the source roster beyond these two (map fog).

**Handoff:** 0090 consumes both output shapes; 0088's capability map gains the two source rows from this brief.

### Plan

- [ ] 1. Read `last30days` SKILL.md + scripts; probe help/doctor only. (R1)
- [ ] 2. Read Horizon pyproject/docs/profiles; probe `uv run horizon --help`. (R2)
- [ ] 3. Read the ingestion-plugin spec + `Doc` contract in kk-core. (R3)
- [ ] 4. Choose adapter per source (plugin vs shell step) with rationale. (R1–R3)
- [ ] 5. Write `## Solution` per the deliverable contract + handoff lines. (R1–R3)

Verification intent: `spur task check 0089` clean; reviewer confirms both sources have an invocation contract, an output shape, and a `Doc[]` path (or justified alternative).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Map: `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`
- `docs/design/ingestion-plugin-specification.md` · `packages/kk-core` Doc contract
- Dependents: 0090 (blend consumes both output shapes)

### History
