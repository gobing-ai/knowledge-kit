---
schema_version: 1
name: Bind Daily AI Voice Board to current news run and publish evidence
status: todo
template: feature-impl
created_at: 2026-11-18T04:22:19.984Z
updated_at: "2026-11-18T04:50:04.754Z"
feature_id: L3

estimate_hours: 8
---

## 0391. Bind Daily AI Voice Board to current news run and publish evidence

### Background

The current native contribution lists kk-news-generate but its reader uses voice2 artifact selectors. The modern launcher does not call the legacy Board capture, and status already has a neutral generation projection from task 0378. Evidence: apps/cli/src/board/manifest.ts:484, apps/cli/src/launch.ts:553, apps/cli/src/commands/content.ts:336, apps/cli/src/board/reader.ts:463.

### Requirements

- [ ] R1. Bind current launch attempts to the existing read-only Board evidence routes while preserving verified voice2 history (L3 R12).
- [ ] R2. Project generation engine and episode states, current artifact references and per-target publish outcomes from the selected attempt/date. Distinguish missing, superseded and invalid evidence.
- [ ] R3. Return bounded diagnostics or precise evidence references without trusting browser-supplied paths or reading unchecked receipts.

### Acceptance Criteria

- [ ] R12 — Current generation and publishing evidence is inspectable

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.753Z

**Ready decisions.** Capture generation attempt ownership inside the existing launch lock following the legacy capture authorization model. Extend current evidence additively rather than breaking existing Board consumers. Match publication by episode, bundle and plan identity; map final artifact ownership from producer events, including fallbacks. Offer 0390 DTO fixtures with null and explicit statuses. Treat new cap, path and receipt inputs as untrusted; never expose raw logs or credentials.

**Source premise.** `apps/cli/src/board/reader.ts:463` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay attempt replacement, foreign/symlink artifacts, late receipts and old voice2 routes. Check the fixture contract before handing to 0390.

### Design

Own CLI launch, capture and reader/DTO only. Under the generation lock, use existing capture trust and markers before the successful invocation mutates its workspace. Keep dry-run and refused starts effect-free. Current artifacts use a fixed map and recorded producer successes including fallbacks. Reuse the 0378 status projection and identify publish rows with bundle/plan/receipt provenance. Expose a typed additive summary containing generation stage and gate fields, attempt and date, publishing groups, artifact IDs and bounded issue references. Preserve historical readers; for uncaptured attempts expose only authorized Spur state and explain missing artifacts. Do not authorize arbitrary paths, surface raw logs, or add write endpoints. See docs/design/daily-ai-news-editorial-delivery.md.

### Plan

- [ ] Add repeatable launch/reader fixtures for in-flight, no-content, normal, missing capture, failed and superseded runs.
- [ ] Bind current launch to captured evidence using launcher ownership and existing reader safeguards. Add the current producer/artifact mapping.
- [ ] Reuse structured status and publish plan/outcome data. Include stable target IDs, attempt/window, live/draft/dummy/skipped/failed/uncertain/missing status and exact safe diagnostics or evidence references.
- [ ] Verify corrupt receipts, same-date regeneration, fallback voice, concurrent owner change, outside symlink, legacy caller compatibility and bounds. Document the DTO with examples for 0390.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- docs/design/daily-ai-news-editorial-delivery.md — current Board evidence design.
- apps/cli/src/board/reader.ts:463 — the authorized projection.
- apps/cli/src/board/manifest.ts:484 — per-workflow artifact selection.
- apps/cli/src/commands/content.ts:336 — existing status.
- docs/tasks/evidence/0369/20261117/index.md — recorded mixed publish results.

### History

- 2026-11-18T04:23:14.442Z backlog → todo (system)

