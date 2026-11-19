---
schema_version: 1
name: Deliver traceable public corrections in the next eligible episode
status: done
template: feature-impl
created_at: 2026-11-18T04:49:21.264Z
updated_at: "2026-11-19T23:19:53.728Z"
feature_id: L3
priority: P1

estimate_hours: 5
dependencies: ["0388"]
done_forced: "false"
done_reason: unforced close
---

## 0396. Deliver traceable public corrections in the next eligible episode

### Background

0384 owns evidence-backed judgment records, and 0385/0386 own episode copy and show notes. The design calls for an acknowledgement, apology and correction, but the handoff needs a public delivery and recovery owner. podcast-pub supports explicit item update (plugins/publishings/podcast-pub/src/index.ts:756).

### Requirements

- [x] R1. Carry correction ID, prior-episode reference and evidence from the frozen judgment into approved public content and record where the correction was delivered (L3 R17).
- [x] R2. Surface an exact target-level recovery reason when correction delivery is manual, blocked or unsupported.

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

**Approach.** The frozen 0384 judgment snapshot is the single source: `plugins/publishings/podcast-pub/src/corrections.ts` reads it (`readFrozenCorrections`), carries each correction's stable id (`corr-<digest>`), the retired/prior-episode record and its evidence, and renders one `## 本期更正说明` block (acknowledgement + apology + corrected fact) that the plugin inserts directly under the episode title 0385 froze. No parallel transport: the block rides the episode's normal show-notes content and an already-published item is only ever touched through podcast-pub's existing explicit update path.

**Delivery record.** `planCorrectionDeliveries` classifies each correction against each target from the 0388 dispatch state (dispatched / pending / retry / blocked / deferred / off) plus explicit adapter capability facts, and `recordCorrectionDeliveries` persists the result to `31-publish/<date>_16_corrections-delivery.json`. A row is `delivered` only with proof: the podcast item is anchored by the item id and public URL the caller just produced, and any other target must name `deliveryEvidence` for its content — otherwise it is `blocked` with that exact reason rather than a claimed delivery. Manual, blocked, unsupported and authorization-off targets each carry their own verbatim reason and are never recorded as delivered; a replayed trigger never re-delivers (`skipped`).

**Wiring.** `daily-show-notes` now forwards the snapshot path as `PODCAST_PUB_CORRECTIONS` when the snapshot exists, so the block is produced by the real run; a run without a snapshot renders byte-identically, and an unreadable snapshot fails the render instead of silently dropping an owed correction.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Content half: `renderCorrectionsBlock` emits `## 本期更正说明` + `**更正 <corr-id>** · 上期节目 第261118期（2026-11-18）` + `原判断：「…」` + `更正为：…` + `依据：<url>（核验于 …）` (`plugins/publishings/podcast-pub/src/corrections.ts:177`), inserted under the frozen title by `insertCorrectionBlock` (`plugins/publishings/podcast-pub/src/index.ts:275`) and reaching the episode body through `metadata.showNotes` → `renderShowNotesHtml` (`plugins/publishings/podcast-pub/src/map.ts:123,183`). Stage passes the snapshot to both the show-notes and the publish dispatch (`plugins/kk/scripts/daily-stages.ts:5394`, `:2637`). Record half: `recordCorrectionDelivery` writes `{correctionId,target,state,reason,deliveredAt,itemId,url}` (`index.ts:691`) and returns `metadata.corrections = {correctionIds, delivered}` — probe output: `{"correctionIds":["corr-…"],"delivered":["podcast-pub"]}` with the ledger row carrying `itemId`/`url` (`index.ts:718-730`). |
| R2 | MET | `classifyCorrectionTarget` (`corrections.ts:286`) — order verified in source and by probe: prior delivery, `mode=off`, `manualStep`, `blocked`, `retry`, `deferred`, then capability, then `dispatched`. Probe on real sibling rows: `blocked` → `target "shipinhao-pub.audio" is blocked by unsatisfied dependencies surfdash-pub.post, podcast-pub.episode…`; blocked+QR → `requires the manual step "qr-scan"…`; deferred → `dispatches in its own, later window…`; adapter gap → `cannot carry an episode correction (…)`. Every non-delivered row is surfaced verbatim as `WARN podcast-pub: correction <id> not delivered to target "<t>" — <reason>` (`index.ts:737-742`) and stored with `deliveredAt: null`. Delivered is evidence-gated: dispatched non-self without `deliveryEvidence` → `blocked` (`corrections.ts:379-390`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R17 — 已播纠错随新版节目送达并可追溯 | MET | test | `plugins/publishings/podcast-pub/tests/corrections-0396.test.ts` + `plugins/publishings/podcast-pub/tests/correction-delivery-glue-0396.test.ts` — 17 pass / 0 fail / 113 assertions (from `plugins/publishings/podcast-pub`); the glue case asserts `metadata.corrections.delivered === ['podcast-pub']`, the ledger row `state=delivered` with `itemId`+`url`+non-null `deliveredAt`, and verbatim `manual`/`unsupported`/`blocked`/`pending` reasons with `deliveredAt: null` (`tests/correction-delivery-glue-0396.test.ts:161-205`); block placement under `# <title>` (`:296-316`). Stage seam: `apps/cli/tests/kk-workflow-stages.test.ts` -t "0396" — 3 pass / 0 fail. Cross-path probe on the real 0388 writer: self row excluded, states preserved, no delivered-without-evidence row. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T03:41:34.199Z todo → wip (system)
- 2026-11-19T07:30:04.888Z wip → testing (system)
- 2026-11-19T07:30:05.805Z testing → done (system)

