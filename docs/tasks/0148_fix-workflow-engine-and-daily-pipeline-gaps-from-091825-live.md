---
schema_version: 1
name: Fix workflow engine and daily-pipeline gaps from 091825 live dogfood
status: todo
template: issue
created_at: 2026-09-19T16:17:19.193Z
updated_at: "2026-09-19T16:46:46.850Z"

feature_id: F61
---

## 0148. Fix workflow engine and daily-pipeline gaps from 091825 live dogfood

### Background

Live dogfood `dogfood-daily-091825` (Sep 19 episode) reached `done` after three failed attempts (091822/091823/091824); fixes `cc219c8e` (标签) and `11c2f8b3` (qc repetition) shipped. Findings filed in `.spur/context/learnings.md` (2026-09-19 section). This task owns the remaining engine/product gaps; direct fixes were not applicable (all are engine-level or need design). Engine items (a)–(g) are spur CLI upstream candidates; pipeline items are kk-owned.

**Findings** (evidence in session + `learnings.md` 2026-09-19):
1. `spur workflow run --run-id <terminal>` silently no-ops; terminal runs not continue-able — the workaround is a fresh id (091822–091824 all `failed`).
2. Killing a foreground `workflow continue` orphans the run as `running`; repair is exact row restore (`status='paused', pid=NULL`) on 091823.
3. Bare `workflow continue` (no `--answer`) on non-TTY marks a paused run `failed` (091823).
4. Fresh run-id re-runs agent stages (plan/article/QC) eagerly even when shell stages cache-hit → generation mixing on resume (091825 re-ran Sep 18-cached stages).
5. `workflow continue` has no `--async` flag; the workaround is nohup-detach.
6. Shell action stdout/stderr not persisted — 70-min generate failures surfaced as opaque exit 1 with zero evidence (091822/091824). Biggest observability gap.
7. `workflow continue` sits 10+ min silent after the operator answers; the run `.spur/run/<id>.log` file is not updated by the continued session — `workflow trace --json` is the only liveness source (approve 01:10 → first transition visible ~01:20).
8. patch-surfdash runs before translate (trace: `…publish → patch-surfdash → run-report → translate → done`), so the workflow leaves en/ja posts uncommitted — manual wrap-up commit needed every day (surfdash `be102f0` on 091825; convention message `content: translate daily AI news <date> (en, ja)`).
9. `loudness_dip:unknown` ×10 (segs 0,1,3,7,8,9,10,11,14,22 of 25), non-failing, survives verify regen; severity has no classification; generate artifacts persist no regen counters (`qc` metadata: passed/totalDuration/overallScore/segmentAudits/criticalIssues only). Also seen on earlier dogfoods — recurrence, not one-off.
10. qc.py ported QC logic diverged from canonical `voice-gen/src/qc.ts` undetected for weeks; only live dogfood caught it (`11c2f8b3`).

### Requirements

**Scope split (frozen at refine):** R1–R6 are spur-CLI engine gaps; the spur engine is not in this repo (binary `/Users/robin/.bun/bin/spur`, source `/Users/robin/xprojects/spur`). They are delivered as an upstream handoff, not in-repo code. R7–R9 are kk-owned in-repo work.

**Upstream handoff (spur repo):**
- [ ] R1. `workflow run` with an existing terminal run-id fails loud (or requires `--force`), instead of silently no-op'ing.
- [ ] R2. `workflow continue` interrupted mid-attach leaves the run in its pre-continue state (`paused`), not `running` with a dead pid.
- [ ] R3. `workflow continue` without an answer source on non-TTY refuses with guidance instead of failing the run.
- [ ] R4. `workflow continue --async` for detached resume.
- [ ] R5 (highest value): every shell action's stdout/stderr persisted under the run directory (e.g. `.spur/run/<id>/<state>-<seq>.log`), referenced from trace events.
- [ ] R6. continued sessions append to the run log (or trace events carry the liveness contract); document `trace --json` as the liveness source if the log stays frozen.

**Pipeline (kk-owned, in-repo):**
- [ ] R7. `kk-daily-ai-voice.yaml` full-publish chain reordered to `publish → translate → patch-surfdash → run-report → done`, so patch-surfdash's existing per-locale loop patches and commits zh/en/ja in one commit. Partial/none paths unchanged.
- [ ] R8. omni-voice-gen QC artifacts carry dip position and verify counters: `loudness_dip:<sec>s` (position from the verify phase) instead of `loudness_dip:unknown`, and per-segment `verifyRetries` in `qc.segmentAudits`.
- [ ] R9. shared golden-fixture parity tests pin the repetition battery contract (transcription-only detection + duration corroboration, bare `repetition_detected` token) across omni-voice-gen qc.py and voice-gen qc.ts; mutating either side fails its suite.

### Acceptance Criteria

- [ ] A1 (R1–R6): a task exists in `/Users/robin/xprojects/spur` carrying findings (a)–(g) with reproductions and per-finding acceptance criteria; its WBS is recorded in this task's Q&A section.
- [ ] A2 (R7): `spur workflow validate` passes on the reordered YAML; `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` asserts the publish→translate→patch-surfdash→run-report chain order and the partial→run-report→done path.
- [ ] A3 (R7, evidence deferred to next live dogfood run): after a full daily run, `git status` in the surfdash checkout is clean — en/ja posts committed with cross-links by patch-surfdash, no manual commit step.
- [ ] A4 (R8): the next daily run's `*_generate_content.json` shows non-`unknown` dip positions on verify-detected dips and a `verifyRetries` count per segment audit; unit tests cover both.
- [ ] A5 (R9): `qc-parity-vectors.json` is consumed by both `omni-voice-gen/tests/test_qc.py` and a new `voice-gen/tests/qc-parity.test.ts`; flipping the corroboration rule in qc.py fails the py suite, flipping it in qc.ts fails the TS suite.
- [ ] A6: `bun run gate` green; all existing suites (188+ tests) green with no skips.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-19T16:27:28.622Z

- 2026-09-19 (refine --auto --depth ready): Scope split frozen — WP1 (YAML resume-skip) here; WP2 (engine R1–R6) handed to spur-new's corpus because engine source/tests/gates live there (0.3.88 vs installed 0.3.86). 0148 closes on WP1 verified + WP2 task created, not on engine fixes shipping.
- (d) deliberately fixed YAML-side (skip edges), not engine-side agent.run caching: engine caching is a cross-cutting feature; the YAML edges solve the observed mixing with the same existence semantics the shell stages already use.
- Continue-from-failed stays out of scope: fresh run-id remains the retry contract until snapshot-based resume is designed in spur-new.

#### Q&A entry — 2026-09-19T16:45:03.497Z

#### Q&A entry — 2026-09-19 (refine synthesis, --auto --depth ready)

- **Q: Implement R1–R6 in this repo?** A: No — spur engine source is `/Users/robin/xprojects/spur`; this repo holds only the `sp` dev-surface plugin. Deliverable is an upstream handoff task; A1 makes it verifiable.
- **Q: R7 — extend translate-sync with git commit, or reorder states?** A: Reorder. patch-surfdash already loops zh/en/ja and already commits+pushes `content/posts/articles`; adding a second git site in translate-sync would duplicate commit logic. Reordering also gains en/ja cross-link patching for free.
- **Q: Any hidden dependency making translate-last intentional?** A: None found — translate reads publish result (`_16_publish_zh-post-path.txt`); patch reads cover + podcast result. Neither consumes the other's outputs.
- **Q: R8 — also fix the TS canonical reuse gap (qc.ts:14)?** A: Not in scope; voice-gen is not the live daily path (omni-voice-gen is). Recorded as sibling note in Design.
- **Q: Publish-exit edges after reorder?** A: All three guarded explicitly (full|partial|none), no always edge from publish — avoids relying on engine transition-precedence semantics.

### Design

## Scope split

- **R1–R6 — upstream handoff.** The spur engine source lives in `/Users/robin/xprojects/spur` (this repo only holds the `sp` dev-surface plugin). Deliverable: one task created there via its own `spur task create`, body carrying findings (a)–(g) from Background with reproductions and the R1–R6 acceptance criteria verbatim. Record the upstream WBS in 0148's Q&A. No code changes in this repo.
- **R7–R9 — in-repo.** Three independent code changes below.

## R7 — workflow state reorder (plugins/kk/workflows/kk-daily-ai-voice.yaml)

Current full chain: `publish → patch-surfdash → run-report → translate → done`. `dailyPatchSurfdash` (plugins/kk/scripts/kk-workflow-stages.ts:1295) already loops locales zh/en/ja, skips locale posts absent on disk, and commits `content/posts/articles` (all locales) with push — but en/ja posts don't exist until translate-sync, which runs later. Root cause is sequencing, not missing code.

Frozen change (transitions only; states unchanged):
- `publish → translate` (guard: shell `test "${vars.publish_status}" = "full"`) — replaces the always `publish → patch-surfdash` edge.
- `translate → patch-surfdash` (always) — new.
- `patch-surfdash → run-report` (always) — unchanged.
- Remove `run-report → translate` and `translate → done`; add `run-report → done` (guard: `publish_status = "full"`) alongside the existing partial edge.
- Guards from `publish` are now exhaustive (full|partial|none) with no always edge — engine transition-precedence does not need to be relied on.

Side effect (desired): patch-surfdash now also patches cover image + podcast cross-link into en/ja posts (loop already locale-aware) and commits them — surfdash checkout is clean after the run; the manual `content: translate … (en, ja)` commit step disappears.

Tests: extend `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` — assert transition chain publish→translate→patch-surfdash→run-report→done for full, and publish→publish-partial→run-report→done for partial. Doc sync: check `docs/04_DESIGN.md` for a documented state order; update in the same commit if present (T3).

## R8 — dip position + verify counters (omni-voice-gen)

Root cause of `loudness_dip:unknown`: qc.py:188-192 reuses the verify phase's boolean `meta["loudness_dip"]` with `dip_at=None`; `_render_verified` (pipeline.py:137) knows `dip_at` but drops it. `verifyRetries` is already computed and stored in `segments_meta` (pipeline.py ~232) but never reaches `qc.segmentAudits`.

Frozen changes:
- `pipeline.py`: `_render_verified` returns `dip_at` (append to its tuple); segment loop passes `"dip_at": dip_at` and `"verify_retries": retries` into `audit_meta`.
- `qc.py` (`audit_voice_segments`): reuse `meta["dip_at"]` when present so the token is `loudness_dip:<sec>s`; `unknown` remains only for the meta-absent re-scan path where the detector itself returns no position. Surface `verifyRetries` on each `SegmentAudit` so it lands in `metadata.qc.segmentAudits`.
- Tests: `omni-voice-gen/tests/test_pipeline.py` (dip_at + retries propagate into audit meta), `omni-voice-gen/tests/test_qc.py` (token renders position when dip_at present; `unknown` only on the re-scan-with-no-position path).
- Out of scope (sibling note): TS canonical `voice-gen/src/qc.ts:14` has the same reuse-gap (`loudnessDip?: boolean`, no position on reuse). Do not change TS here; noted for a follow-up if voice-gen becomes a live path again.

## R9 — shared-fixture parity tests

Contract under test (from 11c2f8b3, canonical voice-gen qc.ts): repetition is detected on the **transcription** only (never source text); the bare issue token `repetition_detected` is emitted only when repetition is corroborated by a duration anomaly; R5a-style gates do exact list-membership on that token.

Frozen change: one shared fixture `plugins/generations/omni-voice-gen/tests/fixtures/qc-parity-vectors.json`, consumed by both suites:
- vectors: (1) clean → no issues; (2) source-text-only repetition (`"1.1.1. "`-style) with in-range duration → no flag (the 091824 dogfood case); (3) transcription repetition + in-range duration → no bare token; (4) transcription repetition + duration anomaly → token exactly `repetition_detected`.
- py: extend `omni-voice-gen/tests/test_qc.py` to iterate vectors through the audit battery (single-segment path).
- TS: new `plugins/generations/voice-gen/tests/qc-parity.test.ts` iterating the same vectors through `auditVoiceSegments` (voice-gen/tests/qc.test.ts:46 pattern with mock client).

### Plan

1. **Upstream handoff (R1–R6):** in `/Users/robin/xprojects/spur`, `spur task create` one task carrying findings (a)–(g) reproductions + R1–R6 ACs; record the upstream WBS in 0148 Q&A. (A1)
2. **R8 code+tests:** pipeline.py `_render_verified` dip_at propagation; qc.py token fix + `verifyRetries` on SegmentAudit; extend test_pipeline.py + test_qc.py. Run omni-voice-gen suite. (A4)
3. **R9 fixtures+tests:** write `qc-parity-vectors.json`; py consumer in test_qc.py; new voice-gen/tests/qc-parity.test.ts; mutation-check both sides once (flip rule, see red, revert). (A5)
4. **R7 YAML + tests:** reorder transitions per Design; extend kk-daily-ai-voice-workflow.test.ts chain assertions; `spur workflow validate`; same-commit `docs/04_DESIGN.md` sync if the state order is documented there. (A2)
5. **Gate:** `bun run gate`; omni pytest suite; note A3 evidence defers to the next live dogfood run — record that run's surfdash `git status` in this task's Testing section. (A3, A6)

### Root Cause

1. **R1–R6 (upstream):** spur engine gaps — no persisted shell-action output, no async continue, no terminal-id guard, pause/continue state handling corruptible from non-TTY/killed attaches. Root causes live in the spur engine (`/Users/robin/xprojects/spur`), out of this repo.
2. **R7:** `kk-daily-ai-voice.yaml` runs translate after patch-surfdash; patch's commit (`git add content/posts/articles`) therefore never sees en/ja posts, leaving a manual wrap-up commit every day.
3. **R8:** omni-voice-gen's verify phase detects `dip_at` but `_render_verified` discards it; qc.py's reuse path emits `loudness_dip:unknown`. `verifyRetries` computed but not surfaced into the QC artifact.
4. **R9:** omni qc.py was ported from voice-gen qc.ts without a parity test; the transcription-only + duration-corroboration semantics silently diverged (fixed live in 11c2f8b3, unpinned).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `.spur/context/learnings.md` § 2026-09-19 — dogfood items (a)–(g) (primary evidence)
- `.spur/run/dogfood-daily-091825.log` — live run, paused at review/hitl.confirm
- `plugins/kk/workflows/kk-daily-ai-voice.yaml` — pipeline under WP1
- spur-new `apps/cli/src/commands/workflow.ts` (:99 async launcher, :474 run --async, :707 run-id validation, :972 continue verb, :1026 confirm gate) and `packages/app/src/services/workflow-service.ts` (:670 run, :1074 continuePaused, ~:864 finalizeStale)
- engine `@gobing-ai/ts-dual-workflow-engine@0.4.69` — `host.ts` (stdout/stderr on bus), `persistence.ts` (redaction/drop), `apps/cli/src/workflow/hitl/default-responder.ts` (non-TTY deny default)
- Task 0130 (kk-solo-podcast.yaml schema defect) — related, out of scope

### History
