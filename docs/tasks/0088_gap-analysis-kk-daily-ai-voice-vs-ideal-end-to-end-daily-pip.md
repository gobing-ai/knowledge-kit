---
schema_version: 1
name: "Gap analysis: kk-daily-ai-voice vs ideal end-to-end daily pipeline"
status: todo
template: feature-impl
created_at: 2026-09-03T04:21:27.164Z
updated_at: "2026-09-03T04:24:44.659Z"
feature_id: K
---

## 0088. Gap analysis: kk-daily-ai-voice vs ideal end-to-end daily pipeline

### Background

**Type:** `wayfinder:research` — resolve with evidence reading, no production code. Map: feature K.

**Sharp question:** what exactly must change in `plugins/kk/workflows/kk-daily-ai-voice.yaml` (states, vars, guards) and in the plugin set to reach the operator's ideal 3-stage daily flow — collect (1.1 last30days, 1.2 Horizon) → blend facts (2.1) → article (2.2) + script (2.3) + cover (2.4) + voice (2.5) → publish (3.1 podcast w/ show notes, 3.2 surfdash + article platforms)?

**Evidence:** the workflow YAML; plugin manifests under `plugins/{ingestions,generations,publishings}/`; `docs/design/kk-daily-ai-voice.md`; `docs/design/fan-in-and-fan-out-specification.md`; feature K Notes (existing-pieces recon).

**Deliverable:** gap list + extension plan in `## Solution` — per ideal step a disposition (exists / extend / missing) and a recommended home for each missing capability.

### Requirements

- [ ] R1. Inventory current workflow states/vars/transitions against all 9 ideal steps (1.1–3.2) with a per-step disposition: exists / extend / missing.
- [ ] R2. Map existing plugins to each needed capability (ingest ×3 sources, facts-blend, article, script, cover, voice, publish targets), naming the plugin or `missing`.
- [ ] R3. For every `missing`, recommend its home — kk subcommand vs plugin vs workflow state — consistent with `docs/design/fan-in-and-fan-out-specification.md` (fan-in/out are kk subcommands, not engine states).

### Acceptance Criteria

- [ ] All 9 ideal steps carry a disposition with file-level evidence.
- [ ] Every `missing` capability has a recommended home per R3.
- [ ] Answer recorded in `## Solution`; no production code written.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

n/a — research ticket. Output is evidence + recommendation in `## Solution`.

### Plan

- [ ] Read `kk-daily-ai-voice.yaml` + `docs/design/kk-daily-ai-voice.md`.
- [ ] Read every plugin manifest under the three kind collections.
- [ ] Build the 9-step disposition table; name gaps and recommended homes.
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
