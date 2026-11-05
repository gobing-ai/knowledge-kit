---
schema_version: 1
name: Enforce operation-specific draft and live boundaries for matrix publishing
status: done
template: feature-impl
created_at: 2026-10-26T00:11:53.720Z
updated_at: "2026-11-05T05:10:41.701Z"
feature_id: G15
priority: P1
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 8

ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0330-verdict.json
---

## 0330. Enforce operation-specific draft and live boundaries for matrix publishing

### Background

Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

Owned audit findings: F03, C01. Priority reflects the highest owned severity; estimate 8 engineer-hours includes failure-first tests, docs and final checks.

- apps/cli/src/publish-matrix.ts:346 — matrix payload mode is expressed only as metadata.publishStatus.
- plugins/publishings/surfdash-pub/src/index.ts:129 — Surfdash reads metadata.published; plugins/publishings/podcast-pub/src/map.ts:115 reads metadata.status and defaults published.
- plugins/publishings/x-pub/src/index.ts:109 and plugins/publishings/threads-pub/src/index.ts:150 — short-post transports proceed to live HTTP without a draft refusal.
- plugins/publishings/weibo-pub/src/index.ts:299 — Weibo short posts already refuse drafts; preserve that behavior.

Environment/concurrency: Bun 1.4.3; pinned Biome via bun run lint/format; installed Spur observed at 0.4.20 (run latest bare CLI, do not pin). Existing uncommitted apps/cli/src/publish-matrix.ts and apps/cli/tests/publish-matrix.test.ts changes belong to concurrent work: inspect and preserve them, never revert. Only the main worktree and no wip tasks were observed during filing; recheck at implementation start. Multiple tasks touch workflow/stage/matrix files: obey dependencies and use isolated worktrees for concurrent execution. Production stage sources currently match checkout, but bundled CLI parity is unverified; tests must bind the checkout CLI and scripts through a local shim, never the installed live runner.

**Refine corrections (2026-10-25)**
- Findings were checked against the current tree, including concurrent matrix edits; none of this task's owned defects is already fixed. Preserve existing fixes rather than reopening them.
- Completed G15 work is historical, not proof of migration readiness. This task is new corrective implementation, not a completed verification.
- Operational constraints C01-C05 mean: explicit real/dummy/off inventory; manual live confirmation; opt-in auto_publish and prepared launchers; accepted zh-only locale parity; deterministic fixtures for wait/RSS. They are assigned as implementation/runbook work without authorizing production activation.

### Requirements

- [x] R1. Map matrix draft/live to each selected operation native fields: Surfdash metadata.published false/true, podcast metadata.status unpublished/published, and publishStatus draft/public for operations using that contract. Remove contradictory inherited mode fields.
- [x] R2. Refuse X and Threads short-post draft requests before credential lookup or HTTP dispatch; absent or unknown mode in matrix payloads fails closed. Preserve direct plugin legacy behavior outside an explicitly supplied draft request.
- [x] R3. Preset files remain off|dummy|draft only; live requires a matching launch token and existing send-confirm boundary. No skip_review, auto_publish or dummy flag may promote a real send.
- [x] R4. Dummy rows never construct a publishing transport. Unsupported draftless operations in a safe migration preset remain dummy/off unless explicitly launched live.
- [x] R5. Prove real mapping/transport behavior with intercepted HTTP and native mapping output for Surfdash, podcast, X, Threads, WeChat, XHS and Weibo; no live request occurs from draft or dummy input.

### Acceptance Criteria

- [x] AC1 — Draft and dummy launches never publish live on any selected operation (req: R1, R2, R3, R4, R5)

Given the current checkout and the isolated fixture conditions in Design, when the listed success/failure/replay cases run through the actual owned seam, then every R-item is observed through receipts, store state, artifact bytes and process/run status. Verification owner: this task's implementer; final cross-task rehearsal belongs to the rehearsal task. Concrete cases: Source metadata public but requested draft; Surfdash frontmatter draft true; podcast mapped status unpublished; X/Threads draft intercepted before HTTP; unknown mode; real explicit live under fake transport; global dummy no transport; dummy+live token refusal; unaffected kk-itc fixture.

### Q&A

Closed decisions (2026-10-25):
- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.
- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.
- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.
- Dependencies: none; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.
- Source audit findings owned here: F03, C01. Failure cases must precede production edits; evidence uses isolated local fixtures.

### Design

**Ownership:** apps/cli/src/publish-matrix.ts (payload-mode preparation); plugins/publishings/surfdash-pub/src/index.ts; plugins/publishings/podcast-pub/src/map.ts; plugins/publishings/x-pub/src/index.ts; plugins/publishings/threads-pub/src/index.ts; affected plugin tests and apps/cli/tests/publish-matrix.test.ts; docs/04_DESIGN.md. Own only this behavior; do not revert others' edits.

No new public CLI flags or preset enum values. Add operation-aware payload preparation at the matrix boundary using existing publisher contracts; platform-native interpretation stays in each plugin. Matrix-generated payloads always carry an explicit mode, even if a caller's source variant claims published/public. API-only draftless transports must reject an explicit draft themselves as defense in depth. Do not invent a remote draft endpoint. Use exactly status unpublished for podcast drafts and published for live, and published boolean for Surfdash; verify these local mapper contracts before edits. Do not move browser logic into the workflow. Handoff: delivery identity consumes truthful plan mode; scheduling owns the migration preset and launch examples. Preserve kk-itc direct plugin defaults unless explicitly supplied draft; run its shared publish E2E regression. Rejected: merely asserting plan.mode, marking fake API results as drafts, and granting implicit live consent to owned publishers.

**Dependencies:** none; runnable immediately. Dependency edges are persisted in frontmatter.

**Inbound handoff:** Current source contracts and audit reproductions; no upstream implementation prerequisite.

**Outbound handoff:** 0331 — Every real publish variant carries current platform-aware safety evidence; 0334 — Rendered migration schedules resolve the correct bundle and approval model.

**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.

**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.

**Non-goals:** Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

**Failure-first matrix:** Source metadata public but requested draft; Surfdash frontmatter draft true; podcast mapped status unpublished; X/Threads draft intercepted before HTTP; unknown mode; real explicit live under fake transport; global dummy no transport; dummy+live token refusal; unaffected kk-itc fixture.

Verification contract: enumerate failure cases and create behavior/E2E regression checks BEFORE changing production code; no post-hoc unit tests. Use bun:test, the real Spur DAG dispatcher, deterministic fixture generators/transports and intercepted HTTP; no provider/model calls, credentials, browser publication or live store access. Write observed evidence to .works/tmp/test-voice3-migration/0330/summary.json (and referenced logs/receipts), deriving the summary from assertions rather than hard-coded prose. Focused tests may exit 1 from per-file coverage; distinguish that from assertion failures. Final implementation gates: bun run lint, bun run test, bun run build, and project rule presets through bun run test-pre-check / bun run test-post-check; record actual exit codes. Update docs/04_DESIGN.md with changed surfaces in the same implementation change, following docs/99_PROJECT_CONSTITUTION.md and ADR-022/ADR-031. No implementation PASS is asserted by this planning task.

### Plan

- [x] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [x] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R5: Source metadata public but requested draft; Surfdash frontmatter draft true; podcast mapped status unpublished; X/Threads draft intercepted before HTTP; unknown mode; real explicit live under fake transport; global dummy no transport; dummy+live token refusal; unaffected kk-itc fixture.
- [x] Step 2 — Implement R1-R5 within the listed ownership and frozen design; keep upstream contracts and legacy voice2/kk-itc compatibility.
- [x] Step 3 — Run the focused real-dispatcher cases; inspect receipts and measured artifacts for failures, no-content and resume, not only process exit.
- [x] Step 4 — Update owning surface docs, run required project checks, review the diff against every R-item, and record exact verification evidence and remaining limitations through Spur.

### Solution

Change map (all paths checkout-relative):

- `apps/cli/src/publish-matrix.ts:354` — R3: mode keys are plan-owned; a preset target `options` entry carrying `publishStatus`/`published`/`status`/`skip_review`/`auto_publish` throws (plan exit 1, naming the target) instead of being overridden.
- `apps/cli/src/publish-matrix.ts:362` — R1: contradictory inherited mode keys (`publishStatus`, `published`, `status`) are deleted from the merged variant/options metadata before the plan writes its own fields, so a draft row cannot inherit a variant's live-looking frontmatter.
- `apps/cli/src/publish-matrix.ts:370` — R1: operation-native mode fields (`nativeMode`): `surfdash-pub` gets `metadata.published` false/true, `podcast-pub` gets `metadata.status` `unpublished`/`published` (its mapper's vocabulary); all other plugins keep `metadata.publishStatus` (`public`/`draft`) written last at `:380`.
- `plugins/publishings/x-pub/src/index.ts:110-116` — R2: `XPostApiTransport` refuses an explicit `publishStatus: draft` before the `TOKEN_ENVS` credential lookup and fails closed on any unknown value; absent keeps legacy direct-call live behavior.
- `plugins/publishings/threads-pub/src/index.ts:150-158` — R2: same draft refusal + unknown-mode fail-closed in `ThreadsPostApiTransport`, after `refuseUnsupportedOptions`, before credential lookup.
- `plugins/publishings/weibo-pub` — unchanged; its existing post refusal (`weibo post has no draft; set publishStatus: public`, tests/weibo-pub.test.ts:317) already satisfies R2 for weibo.
- `plugins/publishings/podcast-pub/src/map.ts` — unchanged; matrix now writes the exact `status` vocabulary it reads (`unpublished`/`published`, default published preserved for direct calls).
- `plugins/kk/publish-presets/daily-ai-voice.json:82-105` — R4: draftless short-post rows (`x-pub post`, `weibo-pub post`, `threads-pub post`, overseas-rss t3) flipped `draft` → `dummy`; live requires an explicit preset edit plus a `--live-channels` token. No new flags, enum values or preset modes.
- `apps/cli/tests/publish-matrix-0330.test.ts` — R1/R3/R4/R5 regression cases (payload native fields, options guard, dummy-no-dispatch, dummy+live refusal, real explicit live under fake transport, shipped preset regression, itc path untouched).
- `plugins/publishings/x-pub/tests/x-pub.test.ts` / `plugins/publishings/threads-pub/tests/threads-pub.test.ts` — R2: draft refusal before credentials (zero HTTP), unknown publishStatus fail-closed, `public` proceeds like the legacy absent mode.
- `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts` — R1: matrix `status` vocabulary maps truthfully; legacy absent-status default preserved.
- `docs/04_DESIGN.md:2113-2133` — publish-matrix-plan surface documented (same commit per T3).

Rejected alternatives honored: no new CLI flags or preset enum values; no remote draft endpoint; plan mode remains the only source of truth for receipts (`draft`|`live`, itc-publish.ts:545).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Native fields written at the matrix boundary (apps/cli/src/publish-matrix.ts:370): draft surfdash payload carries metadata.published=false despite a public source variant (apps/cli/tests/publish-matrix-0330.test.ts: R1 payload-mode test 1); contradictory inherited keys (published/status/publishStatus) removed and podcast rows mapped to metadata.status (test 2); explicit live row carries published=true + status=published (test 3); podcast mapper contract verified without edit (plugins/publishings/podcast-pub/tests/podcast-pub.test.ts: 62 pass, status unpublished/published/legacy-absent cases); publishStatus public/draft kept for every other operation (apps/cli/src/publish-matrix.ts:380) |
| R2 | MET | x-pub refuses an explicit draft BEFORE the credential lookup with zero HTTP (plugins/publishings/x-pub/src/index.ts:110-116; refusal test with throwing fetch spy) and fails closed on unknown publishStatus; threads-pub identical after refuseUnsupportedOptions (plugins/publishings/threads-pub/src/index.ts:150-158); absent keeps legacy live-only direct behavior (public-proceeds tests hit the real endpoint shape via intercepted fetch); weibo-pub preserved (plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:317) |
| R3 | MET | Preset target options carrying publishStatus/published/status/skip_review/auto_publish are refused at plan time, exit 1 naming the target (apps/cli/src/publish-matrix.ts:354-360; two refusal tests); presets stay off |
| R4 | MET | Global --dummy plan builds payloads but dispatches zero transports with truthful dummy receipts (send test, dummyReceipt contract); shipped migration preset draftless short-post rows (x post / weibo post / threads post, overseas-rss t3) are dummy and the preset still passes schema validation (apps/cli/tests/publish-matrix-0330.test.ts R4 test reading plugins/kk/publish-presets/daily-ai-voice.json:82-105); live promotion of a dummy target still refused (regression test) |
| R5 | MET | Real mapper/transport behavior proven with intercepted HTTP: surfdash published-boolean payload (R1 tests), podcast map (plugins/publishings/podcast-pub/tests/podcast-pub.test.ts 62 cases), x/threads refusal-before-HTTP + public-proceeds (fake fetch spies), weibo (plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:317 + browser-draft tests :400-410), xhs/wechatmp draft flows (plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:439,:2033,:2257; wechatmp cgi-draft eligibility docs/04_DESIGN.md:1495); no draft or dummy input reaches live dispatch (R4 no-dispatch test); itc plan path untouched (R5 untouched test asserting explicit-preset resolution unchanged) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Draft and dummy launches never publish live on any selected operation (req: R1, R2, R3, R4, R5) | MET | test | Every listed case covered by apps/cli/tests/publish-matrix-0330.test.ts (10 cases: source-public-variant-claims-published → draft payload; surfdash draft true; podcast status unpublished; x/threads draft intercepted before HTTP; unknown mode fail-closed; real explicit live under fake transport; global dummy no transport; dummy+live token refusal; shipped preset regression; kk-itc fixture untouched) plus plugins/publishings/x-pub/tests/x-pub.test.ts and plugins/publishings/threads-pub/tests/threads-pub.test.ts (6 cases) and plugins/publishings/podcast-pub/tests/podcast-pub.test.ts (3 new cases); failure-first ordering honored; consolidated evidence .works/tmp/test-voice3-migration/0330/summary.json |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS
Confidence: HIGH

Review performed inline against R1-R5/AC1 with failure-first ordering honored (5 matrix + 6 plugin refusal cases confirmed red before production edits). Findings and dispositions:

| Priority | Finding | Disposition | Location |
| --- | --- | --- | --- |
| P4 | podcast-pub legacy absent-status default stays `published` for direct plugin callers | By design — the task mandates preserving direct-plugin legacy behavior; the matrix always writes an explicit `status`, so the default is unreachable from planned rows | plugins/publishings/podcast-pub/src/map.ts:115 |
| P4 | `nativeMode` table is closed over surfdash-pub/podcast-pub; a future plugin with its own native mode field needs a table row | Accepted — intentional closed table keeps platform-native interpretation in plugins; publishStatus remains the universal fallback | apps/cli/src/publish-matrix.ts:370 |
| P4 | Draftless short-post refusal message says "plan dummy/off or launch live"; live additionally requires a preset edit plus a `--live-channels` token | Accepted — message is accurate at the plugin boundary; the preset edit requirement is documented at the matrix surface | plugins/publishings/x-pub/src/index.ts:113 |
| P4 | Gate receipt keyed by the full git tree: task-file section edits after a gate launch force a full re-check | Process note — complete all docs/tasks edits before launching the gate; recorded for 0331+ execution | .spur/memory/evidence/0330-verdict.json |

Residual risk: none blocking. Live engine rehearsal of the migrated voice3 publish path belongs to 0335 per AC1's scoping clause. All gates green with exact exit codes recorded in Testing.

### References

- Parent feature: G15, docs/features/G15_daily-ai-voice-v3-split-generate-and-publish-preset-driven-channel-matrix.md.
- Source audit: .spur/reports/voice3-migration-review-2026-10-25.md; all owned findings and current-code premises are embedded in Background so this task is self-contained.
- Authority: docs/00_ADR.md:957 (ADR-022), docs/00_ADR.md:1223 (ADR-031), docs/design/kk-daily-ai-voice3.md:227 (accepted operator decisions), docs/99_PROJECT_CONSTITUTION.md:160 (surface/status synchronization).
- Dependencies: none.
- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.
- Code/test targets and observable failure matrix: Design.

### History

- 2026-11-03T23:27:26.735Z todo → wip (system)
- 2026-11-03T23:47:50.615Z wip → testing (system)
- 2026-11-03T23:51:03.953Z testing → wip (system)
- 2026-11-03T23:54:06.876Z wip → testing (system)
- 2026-11-04T00:01:39.505Z testing → wip (system)
- 2026-11-04T00:04:34.846Z wip → testing (system)
- 2026-11-04T00:04:36.827Z testing → done (system)

