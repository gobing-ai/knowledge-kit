---
schema_version: 1
name: "Restructure kk-daily-ai-voice.yaml around the new seams"
status: todo
template: feature-impl
created_at: 2026-09-06T14:35:05.242Z
updated_at: "2026-09-06T18:03:50.203Z"
feature_id: L1
priority: P1
tags: ["workflow", "kk-daily-ai-voice", "feature-K"]
dependencies: ["0092", "0094", "0095", "0096"]
---

## 0097. Restructure kk-daily-ai-voice.yaml around the new seams

### Background

Feature L1 R2/R5/R8: collapse the 4 collect states into one, insert annotate → quality-control-content, thin the publish tail onto plugin operations, add done-no-content terminal + per-stage failure edges + publish-partial route. Depends on the four implementation tasks (fan-in, annotate, filter, both plugins).

### Requirements

R1. fetch/ingest-last30days/ingest-horizon/blend-facts → single `collect` state calling fan-in --source mode.
R2. plan state runs episode-plan-gen annotate+select; new `quality-control-content` state runs --mode filter with QC_* vars; empty candidates → `done-no-content` terminal (no content/audio/publish artifacts).
R3. show-notes state → podcast-pub show-notes operation; publish-prep slimmed to article+audio merge only; publish fan-out unchanged targets.
R4. translate-en/translate-ja → surfdash-pub scaffold-locale + thin agent.run translate; translate-sync → surfdash-pub sync; zero sd/publish-orchestrator/dirname shell in YAML.
R5. Every non-terminal state has an explicit failure edge with operator-readable description; publish partial (≥1 target ok) → publish-partial → done.
R6. `spur workflow validate` passes; r6 dogfood corpus replay produces the same 4-candidate plan.
R7. Caching contract preserved: existing artifact files still skip their states on re-run.

### Acceptance Criteria

- [ ] spur workflow validate exits 0
- [ ] 19 states; every non-terminal state has a failure edge
- [ ] r6 replay yields the same 4 candidates as commit fdf3905's gates
- [ ] empty-candidate fixture run terminates at done-no-content with zero downstream artifacts
- [ ] grep finds no 'sd translate', 'publish-orchestrator', or 6×dirname in the YAML

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
WHAT: Rewrite `plugins/kk/workflows/kk-daily-ai-voice.yaml` onto the new seams. YAML-only change consuming: fan-in `--source` mode (0092), episode-plan-gen annotate (0093) + `--mode filter` (0094), podcast-pub show-notes op (0095), surfdash-pub scaffold-locale/sync ops (0096).

WHY: ADR-019 D5 — orchestration legibility + failure routing that matches reality.

WHERE (frozen state inventory — 24 states; premise-corrected at refine: the design-review's "19" miscounted; the publish-partial mechanism below adds one):

prepare → collect → plan → quality-control-content → plan-translate → article → cover → script → review(HITL) → wrap-docs → generate → quality-control(audio) → show-notes → publish-prep → publish → publish-partial → translate-en → translate-en-agent → translate-ja → translate-ja-agent → translate-sync → done | done-no-content | failed

State changes:
1. **collect** (new) replaces fetch + ingest-last30days + ingest-horizon + blend-facts: one shell action calling `kk executor fan-in --source aihot-ingest:…/source.json --source last30days-ingest:…/last30days.json --source horizon-ingest:…/horizon.json --out …/1-ingest/blended.json` (+ core-facts-gen render stays as a second action here or drops — decide: keep as second action, it feeds nothing downstream-critical). `last30days_enabled=false` keeps writing `[]` input in prepare (existing behavior); fan-in --source tolerates an empty docs output.
2. **plan** unchanged (annotate rides inside episode-plan-gen from 0093).
3. **quality-control-content** (new): `kk executor run episode-plan-gen --mode filter --in …/2-plan/annotated.json …` — wait, simpler: filter reads the plan Content's metadata.docs. Freeze: plan writes content.json (annotated, post-gate selection unchanged) AND quality-control-content runs filter mode on the SAME blended input with QC_* vars, writing `2-plan/candidates.json` + `2-plan/candidates.rejected.json`. plan-translate then reads candidates.json instead of content.json. A `jq 'length == 0'` guard routes empty → `done-no-content` (new terminal).
4. **publish** shell: capture fan-out exit code WITHOUT propagating it; always inspect result.json; write `3-publish/publish-status.txt` = full | partial | none; exit 0 in all three. Transitions: full → translate-en; partial → **publish-partial** (new state: echoes warning naming failed targets, writes `.spur/run` marker, → done; result.json preserved for `--retry-from`); none → failed. This replaces r6's bare abort on partial failure.
5. **show-notes** → `kk executor run podcast-pub --in plan.json --out show-notes.md` with options.operation=show-notes (0095). No inline bun -e.
6. **publish-prep** slims to article+audio merge only (drop podcast-specific assembly once 0095 publish absorbs it).
7. **translate-en / translate-ja** states: surfdash-pub scaffold-locale (0096) replaces `sd translate` + dirname + cp; the existing translate-en-agent / translate-ja-agent stay (LLM hops on plugin-returned paths). **translate-sync** → surfdash-pub sync op.
8. Explicit failure edges: engine default (action exit≠0 → run failed) already covers hard failures — explicit `to: failed` transitions are added ONLY where a failure is *expected and routable* (publish none, QC-content empty→done-no-content). Do not add ceremonial failure edges that duplicate the engine default.

Vars added: qc_categories, qc_min_quality, qc_min_importance, qc_min_urgency, qc_min_impact (mapped to QC_* env in quality-control-content).

Anti-patterns: no new inline bun -e (the removed ones must not reappear); no `sd translate`/`publish-orchestrator`/dirname chains; no behavior change to review HITL; caching contract (test -f skip) preserved per state.

Handoff: 0098 dogfoods this YAML. Docs same commit: 03_ARCHITECTURE.md pipeline section + 04_DESIGN.md vars.
### Plan
1. Freeze the 24-state inventory in the Design; rewrite states + transitions in one pass.
2. collect state on fan-in --source; remove fetch/ingest-*/blend-facts states + their transitions; keep prepare's per-source input writers.
3. quality-control-content state + done-no-content terminal + empty-guard transition; point plan-translate at candidates.json.
4. publish state: exit-code capture + publish-status.txt marker; publish-partial state + transitions (full/partial/none).
5. show-notes → podcast-pub show-notes op; publish-prep slimmed.
6. translate-en/translate-ja → surfdash-pub scaffold-locale; translate-sync → surfdash-pub sync; agent translate states unchanged.
7. Add qc_* vars; `spur workflow validate` must exit 0 (advisories acceptable, errors not).
8. Replay r6 corpus with publish off: collect → quality-control-content must yield the same 4 candidates as fdf3905 gates; empty-corpus fixture must terminate done-no-content with zero downstream artifacts.
9. Grep gate: no 'sd translate', 'publish-orchestrator', or ≥3×dirname chain in the YAML.
10. Sync docs/03_ARCHITECTURE.md + docs/04_DESIGN.md; commit.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
