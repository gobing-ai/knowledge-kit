---
schema_version: 1
name: "Gap analysis: kk-daily-ai-voice vs ideal end-to-end daily pipeline"
status: todo
template: feature-impl
created_at: 2026-09-03T04:21:27.164Z
updated_at: "2026-09-03T04:40:21.715Z"
feature_id: F61
---

## 0088. Gap analysis: kk-daily-ai-voice vs ideal end-to-end daily pipeline

### Background

**Type:** `wayfinder:research` — resolve with evidence reading, no production code. Map: feature F61.

**Sharp question:** what exactly must change in `plugins/kk/workflows/kk-daily-ai-voice.yaml` (states, vars, guards) and in the plugin set to reach the operator's ideal 3-stage daily flow — collect (1.1 last30days, 1.2 Horizon) → blend facts (2.1) → article (2.2) + script (2.3) + cover (2.4) + voice (2.5) → publish (3.1 podcast w/ show notes, 3.2 surfdash (sole article platform for v1))?

**Evidence:** the workflow YAML; plugin manifests under `plugins/{ingestions,generations,publishings}/`; `docs/design/kk-daily-ai-voice.md`; `docs/design/fan-in-and-fan-out-specification.md`; feature F61 Notes (existing-pieces recon).

**Deliverable:** gap list + extension plan in `## Solution` — per ideal step a disposition (exists / extend / missing) and a recommended home for each missing capability.

### Requirements

- [ ] R1. Inventory current workflow states/vars/transitions against all 9 ideal steps (1.1–3.2) with a per-step disposition: exists / extend / missing.
- [ ] R2. Map existing plugins to each needed capability (ingest ×3 sources, facts-blend, article, script, cover, voice, publish targets), naming the plugin or `missing`.
- [ ] R3. For every `missing`, recommend its home — kk subcommand vs plugin vs workflow state — consistent with `docs/design/fan-in-and-fan-out-specification.md` (fan-in/out are kk subcommands, not engine states).

Non-goals: no code or YAML changes; no plugin scaffolds; no scheduling design (map fog); no second workflow file (decided on map F61).

### Acceptance Criteria

- [ ] All 9 ideal steps carry a disposition with file-level evidence.
- [ ] Every `missing` capability has a recommended home per R3.
- [ ] Answer recorded in `## Solution`; no production code written.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T04:40:21.502Z

- None open. Platform scope (surfdash-only) and workflow shape (extend, not fork) are locked on map F61.

### Design

**WHAT:** a disposition table over the ideal 9-step flow (1.1 last30days, 1.2 Horizon, 2.1 blend, 2.2 article, 2.3 script, 2.4 cover, 2.5 voice, 3.1 podcast publish, 3.2 surfdash publish), then a gap list with recommended homes, then an extension-plan sketch for `kk-daily-ai-voice.yaml`.

**WHY:** freezes the extension plan so 0090/0091 and later implement tasks never re-derive it.

**WHERE — frozen read set (verified present 2026-09-02):** `plugins/kk/workflows/kk-daily-ai-voice.yaml`; `docs/design/kk-daily-ai-voice.md`; `docs/design/fan-in-and-fan-out-specification.md`; every `plugins/{ingestions,generations,publishings}/*/plugin.json` (aihot-ingest, karakeep-local, web-search, content-gen, dailynews-gen, voice-gen, emdash-pub, podcast-pub, qiita-pub, surfdash-pub, zenn-pub); `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`.

**Deliverable contract — `## Solution` carries three named subsections:** `Disposition table` (9 rows) · `Gaps + recommended homes` · `Extension plan sketch` (proposed new state ids / vars for the YAML, marked as proposals).

**Anti-patterns:** no production code; no `kk` CLI changes; do not redesign the workflow engine; do not spec scheduling or the judge gate (map fog); no new plugin `kind`.

**Handoff:** 0090 consumes the blend-home recommendation; 0091 consumes the article-generator and publish dispositions. State both explicitly at the end of Solution.

### Plan

- [ ] 1. Read the frozen read set (Design §WHERE) — workflow YAML + design doc first. (R1)
- [ ] 2. Build the 9-row disposition table with file-level evidence per row. (R1)
- [ ] 3. Walk all 11 plugin manifests; fill the capability map, marking gaps `missing`. (R2)
- [ ] 4. Assign each gap a home per the fan-in/fan-out spec; draft the extension-plan sketch. (R3)
- [ ] 5. Write `## Solution` with the three contracted subsections + handoff lines. (R1–R3)

Verification intent: `spur task check 0088` clean; reviewer confirms each R has matching evidence in Solution and both handoff lines exist.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Map: `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`
- `plugins/kk/workflows/kk-daily-ai-voice.yaml` · `docs/design/kk-daily-ai-voice.md` · `docs/design/fan-in-and-fan-out-specification.md`
- Dependents: 0090 (blend home), 0091 (generator + publish dispositions)

### History
