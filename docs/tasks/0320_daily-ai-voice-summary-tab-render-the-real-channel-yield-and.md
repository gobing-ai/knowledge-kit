---
schema_version: 1
name: "Daily AI Voice Summary tab: render the real channel yield and the episode funnel"
status: todo
template: feature-impl
created_at: 2026-10-22T17:52:36.780Z
updated_at: "2026-10-22T18:48:11.513Z"
feature_id: G82

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 12
dependencies: ["0319"]
---

## 0320. Daily AI Voice Summary tab: render the real channel yield and the episode funnel

### Background

Daily AI Voice Summary currently renders dailySummaryFacts from artifact-backed RunResults (apps/board/src/daily-voice/index.tsx and view.ts) without an input funnel or store supply panels. It already defaults to the loopback reader, unlike Collect's native-origin default. ADR-035 and workflow-board-modules.md §9 explicitly keep Daily artifacts-only; implementation must amend that authority before adding read-only store supply context.

Current historical artifacts confirm: 20261022/10-collect/pool.json has 4 docs, annotated.json has 4, exclusions.json records one policy-dispute/lawsuit exclusion and 3 kept IDs, plan.json has 3, duration-refusal.json records measuredMinutes=8.9, estimatedMinutes=14.4, minMinutes=15, keptCount=3. candidates.json metadata.docs is now empty because refusal clears it: it is not the earlier QC survivor count. The 20261021 pool currently has 3 docs while annotated.json has 7 and plan.json has 6; audio metadata.duration is 1075.296167 seconds. Those files must not be silently forced into a coherent 3→6 funnel. Capture/owner/producer checks, not the date directory alone, establish run provenance.

dailyExtract writes 10-collect/pool.json, logs its 24h/48h/72h attempts to stderr and removes temporary attempts (plugins/kk/scripts/daily-stages.ts). It does not persist an exact extraction cutoff/effective-window manifest. A selected run date or a moving stats --days query cannot establish which ticks fed an episode. Store supply is contextual; actual consumption comes from authorized run artifacts.

**Refine corrections (2026-10-22)**
- Voice2 pool claimed as 10-ingest/*_02_collect_blended.json → dailyExtract writes 10-collect/pool.json → read the voice2 manifest path.
- Historical 24h window equated to stats --days 2 → stats uses now and no historical end bound; ladder bounds are not durable → use captured configured-window context anchored to run start, label effective window unknown, and query exact bounds for that stated context.
- Tick counts described as inputs that fed an episode → collect_runs records ingestion provenance, not selection membership → display supply context separately from the artifact funnel.
- candidates.docs length treated as post-QC kept → refusal clears that file → use earlier evidence/refusal.keptCount and label its stage; never reconstruct QC/dedup by subtraction.
- Historical 20261021 artifacts assumed internally consistent → pool=3 but annotation=7/plan=6 → preserve independently authorized evidence and expose mismatch instead of invented transitions.
- Store access assumed already authorized → ADR-035 permits Collect only → make the dated Daily aggregate-only amendment the first implementation step and update derived docs.
- Missing plugin key called a dead source → invocation outcome is not stored → reuse 0319 recorded-contribution semantics and last-positive evidence.
- All kept-file removals described as only script/duration/empty pool → daily.ts also reads a QC floor refusal → add explicit qc-floor precedence and unknown handling.
- Plan, metadata and shared seam dependency absent → freeze the implementation contract and 0319 dependency, P2 and 12h estimate below.
- Three task-local AC titles did not cover their existing G82 scenario titles → align the plugin/gate/docs titles without changing feature scenario identities.

### Requirements

- [ ] R1. Summary renders the shared day×source matrix for supply context [run.startedAt - captured window duration, run.startedAt). Show exact bounds and reader time zone; label it configured context, not the effective extraction window or items consumed. If run time/window capture is missing or invalid, show unknown and do not query guessed bounds. Historical ladder effective window remains unknown without durable evidence; no global range pill controls this panel.
- [ ] R2. Show 0319's plugin contribution/tick table and last-positive timestamps for the same context. Zero means no recorded contribution, not a successful empty invocation or dead source. Keep store supply and episode consumption visibly distinct.
- [ ] R3. Add an authorized artifact-backed funnel with pool count, QC annotation/rejection evidence, topic-boundary kept/excluded counts and rule/matched text, post-dedup count when recorded, planned count, estimated minutes, measured minutes and captured min/max duration bounds. Every field carries its evidence artifact ID and stage; missing or inconsistent stages remain unknown/flagged, never silently inferred.
- [ ] R4. A no-content run names an evidenced refusing gate: episode-duration, script, qc-floor, empty-pool, qc-empty or unknown, with recorded numbers and safe artifact links when available. Preserve the existing run outcome rather than turning engine done into published success.
- [ ] R5. Missing, malformed, too-large, foreign-owned, unverified-producer or inconsistent artifacts never become fabricated zero counts. Gate-cleared candidates are not reported as QC kept=0. Missing/unavailable store affects only supply context; unavailable artifacts affect only their funnel fields. No ratio over a zero denominator.
- [ ] R6. Keep existing status/outcome/channel, execution progress and config views. Reuse 0319's read-only aggregate and presentational tables; preserve reader containment, marker ownership, producer success and size limits. No arbitrary directory reads, store writes, production reruns, workflow edits or new runtime artifacts/dependencies.
- [ ] R7. Before implementation widens Daily access, add a dated ADR-035 amendment limited to consuming Collect's aggregate counts, then update docs/03_ARCHITECTURE.md, docs/04_DESIGN.md and workflow-board-modules.md in the implementation change. Extend installed-package Chromium acceptance first; retain repeatable evidence and safely authorized observations of 20261021/22 under docs/report/0320-daily-summary.md.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The channel matrix is scoped to the episode's collection window (req: R1)
  Given a run with recorded startedAt and captured window=24h
  When installed-package Chromium opens its Summary
  Then the supply context displays exact [startedAt-24h, startedAt) bounds and matches direct bounded SQL
  And it states configured context and effective extraction window unknown
  And missing window/time capture produces unknown without a guessed query

Scenario: AC2 — A dead ingestion plugin is visible, not silent (req: R2)
  Given valid ticks with no horizon-ingest contribution key in the configured context
  When Summary renders the plugin table
  Then horizon-ingest shows 0 recorded contributions, the tick count and last-positive timestamp or unknown
  And it makes no claim that the plugin ran, failed or supplied those episode items

Scenario: AC3 — The funnel matches the run's own artifacts (req: R3)
  Given an owned fixture matching the 20261022 records and a second fixture with pool=3, annotation=7 and plan=6
  When Chromium renders each run
  Then the first shows pool 4, topic kept 3, policy-dispute/lawsuit exclusion, plan 3 and refusal measurements 8.9/14.4/minimum 15
  And the maximum is 25 only when that run captured it
  And the second retains stage evidence and reports the mismatch without inventing dedup counts

Scenario: AC4 — A no-content run names the gate that closed it (req: R4)
  Given owned fixtures for measured, script and QC-floor refusal, empty pool, QC empty and missing evidence
  When each Summary renders
  Then it names the respective evidenced gate and measurements, or unknown when unproven
  And only authorized artifact links render and cleared candidates never imply original pool empty

Scenario: AC5 — Unknowns are explicit (req: R5)
  Given absent, malformed, too-large, foreign-owned or unsuccessful-producer artifacts and unavailable store
  When Summary renders
  Then affected fields are unknown with bounded diagnostics and the other data source still renders
  And no stale artifact, fabricated zero or zero-denominator ratio appears

Scenario: AC6 — The shipped panels do not regress (req: R6)
  Given an installed publishing fixture and an owned no-content fixture
  When Chromium switches between runs while a prior response is delayed
  Then existing status/outcome/channels/progress/config remain correct for the selected run
  And no request writes the store, reads arbitrary paths or replaces the selected run with stale data

Scenario: AC7 — Surface docs and verification ship with the change (req: R7)
  Given the authority amendment and passing installed-package acceptance
  When implementation is reviewed
  Then ADR-035, architecture, surface and module docs describe the bounded Daily exception
  And docs/report/0320-daily-summary.md records fixture results and timestamped 20261021/22 observations or explicit provenance-unavailable fields
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T18:47:23.498Z

Closed 2026-10-22: choose 0319's loopback server aggregate plus the existing artifact results projection. Native browser item paging is rejected for unbounded transport; embedding raw run JSON in the UI is rejected because it bypasses sanitization and ownership controls.

Closed: supply is configured-window context anchored at recorded run start. Exact effective extraction cutoff/ladder history is not persisted; it stays unknown. Captured defaults are acceptable evidence; current workflow defaults are not historical evidence. Adding extraction telemetry is deferred to a separately scoped task, not required here.

Closed: 0319 owns and freezes reusable DAO/transport/tables; 0320 depends on it. Feature ownership G82 remains unchanged. 0320 owns the dated ADR exception before introducing Daily aggregate consumption; IT Content remains artifacts-only.

Closed: conflicting historical artifacts show an evidence mismatch, not an invented reconciled funnel. Historical live observations do not waive capture/marker/producer checks or require rerunning/publishing an episode.

### Design

**Ownership and dependency.** Depends on 0319's CollectChannelYield, BoardClient.storeChannels, StoreChannelsQuery and shared/channel-yield.tsx. This task adds no second DAO or store endpoint. Extend apps/cli/src/board/{manifest,reader,daily-voice}.ts, apps/board/src/contracts.ts and daily-voice/{view,index}.tsx, using the shared client. First implement the dated ADR-035 amendment authorizing Daily to consume only the read-only aggregate counts; retain artifacts-only rules for other Daily data and all IT Content data. No behavior is changed during this refinement.

**Frozen projection.** Add DailyEpisodeFunnel under the existing RunResults.summary.funnel bag (schemaVersion stays 1, additive optional field for older readers). Shape: {poolCount:number|null, annotatedCount:number|null, qcRejectedCount:number|null, topicKeptCount:number|null, dedupKeptCount:number|null, plannedCount:number|null, estimatedMinutes:number|null, measuredMinutes:number|null, minMinutes:number|null, maxMinutes:number|null, gate:'episode-duration'|'script'|'qc-floor'|'empty-pool'|'qc-empty'|'unknown'|null, exclusions:[{rule:string,matched:string}], evidence:Record<string,string>, diagnostics:BoardDiagnostic[]}. Evidence values are fixed manifest artifact IDs, never caller paths. Supply context is separately derived from captured config.window and run startedAt in the module, using the shared half-open aggregate query. No current config/default guessing; no window => unknown. The presentational tables share code but module-specific loading/error state stays independent.

**Artifact manifest and authorization.** Add opaque IDs episode-pool (10-collect/pool.json, extract), episode-annotated (21-plan/{stamp}_04_quality-control-content_annotated.json, qc-content), episode-qc-rejections (21-plan/{stamp}_04_quality-control-content_candidates.rejected.json, qc-content), episode-exclusions (21-plan/{stamp}_04_quality-control-content_exclusions.json, qc-content), episode-candidates (21-plan/{stamp}_04_quality-control-content_candidates.json, qc-content), episode-plan (21-plan/{stamp}_03_plan_plan.json, plan), episode-floor-refusal (21-plan/{stamp}_04_quality-control-content_floor-refusal.json, qc-content), episode-duration-refusal (30-audio/{stamp}_11_generate_content_duration-refusal.json, duration; accept measuredMinutes shape only), episode-script-refusal (same relative file, generate; accept stage=script shape only), episode-duration (30-audio/{stamp}_11_generate_content_duration.json, duration). Reuse audio-record. These producer IDs match the current workflow. Reuse existing producerEvidence checks; retry siblings remain distinct. For script refusals from generate-fallback or generate-fallback2 add episode-script-refusal-fallback and episode-script-refusal-fallback2 entries for that same fixed path with their respective producerNode; accept stage=script only, and require a successful authorized matching node. Never accept files based only on a failed or skipped producer. Reader observes these only through authorize/markerState/observe, retains size/containment/post-read checks and rechecks ownership before serializing. Project counts/reasons only; no new raw body payload in summary. For any new downloadable JSON ID use a sanitized count/reason projection, omitting document bodies and arbitrary metadata, under the same artifact security gates. Preserve existing artifact IDs/behavior.

**Evidence precedence and units.** poolCount comes only from the authorized pool array; annotatedCount only from annotation array; qcRejectedCount from rejected[] after shape validation; topicKeptCount from exclusions.kept[]; reasons from exclusions.excluded[]. Limit reasons to 100 rows and each rule/matched string to 200 characters, with a truncation diagnostic. Candidate metadata.docs length may supply dedupKeptCount only if no authorized downstream floor/duration refusal cleared it; after refusal it is unknown. Refusal keptCount is evidence for the refusing stage only, not substituted into every earlier stage. plannedCount comes from plan array. Array counts are nonnegative integers; numeric fields must be finite and nonnegative. Convert audio-record metadata.duration seconds to minutes once, rounded to one decimal for display. Refusal/verdict measuredMinutes wins over that fallback. estimatedMinutes comes only from refusal/verdict evidence. min/max come from refusal/verdict then captured settings, independently; missing max stays unknown.

For an existing no-content outcome: measured refusal with validated measuredMinutes/minMinutes takes precedence, then stage=script refusal, then QC-floor refusal; then authorized original pool length 0 gives empty-pool; a nonempty original pool and explicitly empty pre-refusal candidate evidence gives qc-empty only when no refusal is present. Otherwise gate=unknown. A non-no-content run has gate=null unless evidence is contradictory, in which case diagnose rather than rewrite the outcome. Older measured refusals need no stage field. Multiple contradictory artifacts, annotation/pool population mismatch or invalid counts produce bounded diagnostics; retain independent values with their stage labels and do not fabricate arithmetic transitions. Dedup losses cannot be inferred from topic-kept minus plan length because planning also filters/caps/translates.

**Security, compatibility and scope.** Do not open arbitrary work_dir from browser input, parse unrestricted logs, bypass producer failure to recover a refusal, or change workflow runtime to create new evidence. Missing legacy captures/failed producers can make even locally present historical artifacts unavailable: that is an accepted explicit unknown. Preserve the separate data-source failures and stale-run request guards. No production publish, task merge, host-install sync or UI redesign.

**Concurrency/preconditions.** Audit baseline main acfc90b has pre-existing edits in daily-stages.ts, daily.ts, the workflow, tests and design docs; preserve and re-audit them before implementation. Only main worktree exists and no WIP task was listed. Bun/Biome match pins. Reuse verified bun-global Spur 0.4.20; tools:fresh reported duplicate/shadow installations in subprocess PATH. Parent feature G82 and task-local AC ownership are retained.

### Plan

- [ ] Step 0 (R1–R7): confirm 0319's shared contract is implemented and verified; preserve the dirty baseline and re-read changed daily runtime plus manifest/producer seams. Read docs/99_PROJECT_CONSTITUTION.md; add the dated aggregate-only ADR-035 Daily exception before code, then align derived docs.
- [ ] Step 1 (R1–R7): extend apps/board/tests/installed-board.test.ts first with real captured workspaces, reader/store, owned producer attempts and Chromium. Cover measured/script/QC-floor/empty/unknown gates, cleared candidates, inconsistent stages, missing capture/store and run-switch races. Record assertions/screenshots/network evidence under docs/report/0320-daily-summary.md. If isolation is necessary, enumerate failure cases and write apps/cli/tests/board/{daily-voice,reader,manifest}.test.ts checks before production code; do not mock the projection carrying the assertion.
- [ ] Step 2 (R3–R6): extend the fixed manifest and sanitized reader observation/projection; preserve containment, ownership and producer checks. Add typed optional funnel fields and evidence IDs without changing existing API meanings.
- [ ] Step 3 (R1,R2,R5): derive configured-context bounds from recorded run start and captured window; fetch 0319 aggregate independently, reuse its table primitives and show explicit effective-window unknown and last-positive contribution semantics.
- [ ] Step 4 (R3–R6): render stage counts, reasons, gate/minutes and safe evidence links; preserve independently recorded contradictory values with a diagnostic, isolate unknowns and prevent stale-run responses.
- [ ] Step 5 (R7): update architecture/surface/module docs, run installed-package Chromium acceptance and observe historical 20261021/22 only through allowed evidence access. Record unavailable captures honestly; use owned representative fixtures for reproducible numeric acceptance, never mutate historical production artifacts to make a test pass.
- [ ] Step 6 (R1–R7): run bun run lint, bun run test, bun run build and applicable spur rule gates; task/feature checks and owned diff review; retain repeatable report. Implementation verification remains pending after this refine.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Parent feature: G82 (Daily AI Voice module Summary: real channel yield and episode funnel), child of G8.

Prior art in this checkout:
- Module surface: `apps/board/src/daily-voice/index.tsx` (`SummaryPanel`, `dailySummaryFacts`), `apps/board/src/daily-voice/view.ts`.
- Store aggregates: `CollectViewDao.channelYield` (`packages/kk-store/src/dao/collect-view.ts`), `kk store stats` (`apps/cli/src/commands/store.ts`), task 0319 (the Collect-side tables — share the presentational primitives, not the fetch).
- Run artifacts: `plugins/kk/scripts/daily-stages.ts` (floor gate, script gate, duration gate + refusal/verdict artifacts), `apps/cli/src/commands/daily.ts` (`noContentReason`).
- Evidence runs: `.works/kk-daily-ai-voice2/20261022/` (no-content, 8.9 min vs 15), `20261021/` (17.9 min, published), `.works/kk.db`.
- Related tasks: 0266 (duration refusal closes as no-content), 2026-10-22 fixes (floor-gate ordering, script gate).

### History

- 2026-10-22T17:54:08.478Z backlog → todo (system)

