---
schema_version: 1
name: Deliver traceable public corrections in the next eligible episode
status: todo
template: feature-impl
created_at: 2026-11-18T04:49:21.264Z
updated_at: "2026-11-18T04:50:06.160Z"
feature_id: L3
priority: P1

estimate_hours: 5
dependencies: ["0388"]
---

## 0396. Deliver traceable public corrections in the next eligible episode

### Background

0384 owns evidence-backed judgment records, and 0385/0386 own episode copy and show notes. The design calls for an acknowledgement, apology and correction, but the handoff needs a public delivery and recovery owner. podcast-pub supports explicit item update (plugins/publishings/podcast-pub/src/index.ts:756).

### Requirements

- [ ] R1. Carry correction ID, prior-episode reference and evidence from the frozen judgment into approved public content and record where the correction was delivered (L3 R17).
- [ ] R2. Surface an exact target-level recovery reason when correction delivery is manual, blocked or unsupported.

### Acceptance Criteria

- [ ] R17 — 已播纠错随新版节目送达并可追溯

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:05.764Z

**Ready decisions.** Consume 0388 target receipts and the upstream frozen correction ID from 0384/0385/0386. Attach the correction to the next eligible episode through normal adjudication, with an unsent/draft/confirmed target state. Use existing update only for prior published items with explicit identity and authorization; manual correction remains actionable when an adapter cannot update. Keep 0388 as the sole generic dispatch owner.

**Source premise.** `plugins/publishings/podcast-pub/src/index.ts:756` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Verify published versus draft versus uncertain receipts by correction ID, prior item identity and current date. Detect double sends on retry and expose explicit manual recovery to 0389.

### Design

Default delivery is the next relevant, eligible episode: the correction is spoken, appears in the article and notes with the prior episode and evidence where available, and travels with existing admitted episode targets. Ensure every correction is linked to the superseded judgment and its own immutable ID and receipt identity. Reuse frozen episode artifacts and existing publishing receipts. A per-target checklist covers earlier already-published items. Use verified same-item update only where an existing adapter permits it and explicit authorization is present. An unsupported edit or manually gated target yields a pending operator step. No automatic delete, republish or edit of prior episodes.

### Plan

- [ ] Seed a prior published judgment and a rejected or uncertain replacement, then a supported correction with a verified original episode link.
- [ ] Carry the correction ID into the next episode outputs and reuse its plan/receipt linkage to classify target delivery.
- [ ] Rehearse an already-sent correction, failed target, draft target and an unsupported prior-item edit. Record stable identities and explicit manual recovery.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
