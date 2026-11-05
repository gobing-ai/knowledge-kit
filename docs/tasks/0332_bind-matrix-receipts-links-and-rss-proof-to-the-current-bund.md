---
schema_version: 1
name: Bind matrix receipts, links and RSS proof to the current bundle revision
status: done
template: feature-impl
created_at: 2026-10-26T00:11:53.723Z
updated_at: "2026-11-05T05:10:41.298Z"
feature_id: G15
priority: P1
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 10

dependencies: ["0331"]
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0332-verdict.json
---

## 0332. Bind matrix receipts, links and RSS proof to the current bundle revision

### Background

Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

Owned audit findings: F11, F12, F13, F17, F19. Priority reflects the highest owned severity; estimate 10 engineer-hours includes failure-first tests, docs and final checks.

- apps/cli/src/itc-publish.ts:499 — successful receipts skip by filename without run, mode or payload identity checks; the offline probe reused an old draft for a different live send.
- apps/cli/src/publish-matrix.ts:729 — readLinkMap scans current-window plan rows only; :933 matches feed dates literally; :977 reads a guid absent from the normal receipt writer.
- plugins/kk/workflows/kk-daily-publish3.yaml:138 — missing run_date is first rejected after send; test hit at apps/cli/tests/kk-daily-publish3.test.ts:314 proves another date can unlock the bundle.
- plugins/kk/workflows/kk-daily-ai-voice3.yaml:781 checks only x.md; builder skips absent social files but composePlan at apps/cli/src/publish-matrix.ts:329 aborts the full window.

Environment/concurrency: Bun 1.4.3; pinned Biome via bun run lint/format; installed Spur observed at 0.4.20 (run latest bare CLI, do not pin). Existing uncommitted apps/cli/src/publish-matrix.ts and apps/cli/tests/publish-matrix.test.ts changes belong to concurrent work: inspect and preserve them, never revert. Only the main worktree and no wip tasks were observed during filing; recheck at implementation start. Multiple tasks touch workflow/stage/matrix files: obey dependencies and use isolated worktrees for concurrent execution. Production stage sources currently match checkout, but bundled CLI parity is unverified; tests must bind the checkout CLI and scripts through a local shim, never the installed live runner.

**Refine corrections (2026-10-25)**
- Findings were checked against the current tree, including concurrent matrix edits; none of this task's owned defects is already fixed. Preserve existing fixes rather than reopening them.
- Completed G15 work is historical, not proof of migration readiness. This task is new corrective implementation, not a completed verification.
- Operational constraints C01-C05 mean: explicit real/dummy/off inventory; manual live confirmation; opt-in auto_publish and prepared launchers; accepted zh-only locale parity; deterministic fixtures for wait/RSS. They are assigned as implementation/runbook work without authorizing production activation.

### Requirements

- [x] R1. Validate work_dir, valid window, bundle identity and run_date before side effects; omitted run_date derives from bundle, provided compact/ISO dates must normalize to the same valid calendar day.
- [x] R2. Reuse a successful receipt only for the same parent bundle revision, target/operation, requested mode and delivered payload; preserve unchanged-row idempotence if only unrelated plan rows changed. Dummy-to-real dispatches once; draft-to-live must not be silently satisfied.
- [x] R3. Fail a stale/different real receipt closed with an actionable reconciliation error, without overwrite/resend. Never automatically resend an unknown-effect live receipt, including malformed or unreadable evidence that may hide a live attempt.
- [x] R4. Resolve article/podcast links using current-bundle tier-0 receipts across all windows, excluding dummy/draft URLs from real public links. Resolve article links before podcast notes dispatch and retain reviewed payload provenance.
- [x] R5. Persist a stable podcast episode guid in the receipt from the plugin result and bind RSS hit/miss to bundle date and episode identity. Wrong dates, wrong episodes, timeout/HTTP failure and malformed XML do not authorize overseas sends.
- [x] R6. Missing required variants refuse planning; missing optional variants yield explicit per-target failed effect-none receipts without cancelling unrelated targets. Failed dummy payload preparation remains dummy in all outcome accounting.
- [x] R7. Exercise unchanged replay, draft promotion, dummy promotion, changed content/parent, corrupt receipts, cross-window links, date normalization/mismatch, feed errors and optional missing variants through the shared send path and ITC regression fixtures.

### Acceptance Criteria

- [x] AC1 — Window sends bind receipts and RSS proof to one bundle revision (req: R1, R2, R3, R4, R5, R6, R7)

Given the current checkout and the isolated fixture conditions in Design, when the listed success/failure/replay cases run through the actual owned seam, then every R-item is observed through receipts, store state, artifact bytes and process/run status. Verification owner: this task's implementer; final cross-task rehearsal belongs to the rehearsal task. Concrete cases: Old successful draft versus live request; same row but unrelated plan change; different parent/date/payload; corrupted prior live receipt; dummy then real; after-generate links consumed by cn/overseas; podcast notes use article URL; compact date hit ISO feed; wrong-date bundle; guid proof; fetch timeout/503; missing optional Weibo with X valid; failed dummy prepare; kk-itc unaffected.

### Q&A

Closed decisions (2026-10-25):
- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.
- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.
- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.
- Dependencies: 0331; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.
- Source audit findings owned here: F11, F12, F13, F17, F19. Failure cases must precede production edits; evidence uses isolated local fixtures.

### Design

**Ownership:** apps/cli/src/publish-matrix.ts (plan/send/link/RSS identity); apps/cli/src/itc-publish.ts (shared receipt guards); plugins/kk/workflows/kk-daily-publish3.yaml (early validation); plugins/publishings/podcast-pub/src/index.ts (identity metadata only if needed); matrix/ITC/window E2E tests; docs/04_DESIGN.md. Own only this behavior; do not revert others' edits.

No new top-level commands. Keep current target ids and receipt locations for ITC compatibility. Add optional receipt guid/source identity fields as needed to ItcReceiptSchema, and enforce existing parentRunId, target, mode and payloadDigest plus bundle variant identity before a skip. A whole-plan digest alone is insufficient: row-local identity must survive adding an unrelated target. Safe default for an existing successful draft promoted to live is an explicit reconciliation-required failure, never silent skip or duplicate creation; remote update/promotion APIs are out of scope. Receipts with unknown live effect remain operator-reconciled. Plan must validate dates from Bundle.runDate before any payload write; re-freezing a different revision cannot silently inherit successes. Read all relevant owned receipts, verify source identity, and resolve only the two declared URL placeholders; no global content rewriting. RSS takes canonical ISO date, guid when present, and same-date title fallback only for the current bundle; no arbitrary caller-date authorization. On optional omission keep a planned identity and write failed/effect:none evidence with an actionable missing-variant error; classification continues. Dummy status derives from plan intent even on prepare failure. Handoff: outcome task consumes these receipts and normal retry eligibility; scheduling task relies on date derivation and canonical bundle validation. Rejected: deleting old receipts to resend, making retry resend unknown effects, sharing dummy:// links with real channels, and swallowing missing variants.

**Dependencies:** 0331. Dependency edges are persisted in frontmatter.

**Inbound handoff:** 0331 — Every real publish variant carries current platform-aware safety evidence.

**Outbound handoff:** 0333 — Receipt outcomes drive safe retries settlement and mixed dummy tails; 0334 — Rendered migration schedules resolve the correct bundle and approval model.

**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.

**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.

**Non-goals:** Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

**Failure-first matrix:** Old successful draft versus live request; same row but unrelated plan change; different parent/date/payload; corrupted prior live receipt; dummy then real; after-generate links consumed by cn/overseas; podcast notes use article URL; compact date hit ISO feed; wrong-date bundle; guid proof; fetch timeout/503; missing optional Weibo with X valid; failed dummy prepare; kk-itc unaffected.

Verification contract: enumerate failure cases and create behavior/E2E regression checks BEFORE changing production code; no post-hoc unit tests. Use bun:test, the real Spur DAG dispatcher, deterministic fixture generators/transports and intercepted HTTP; no provider/model calls, credentials, browser publication or live store access. Write observed evidence to .works/tmp/test-voice3-migration/0332/summary.json (and referenced logs/receipts), deriving the summary from assertions rather than hard-coded prose. Focused tests may exit 1 from per-file coverage; distinguish that from assertion failures. Final implementation gates: bun run lint, bun run test, bun run build, and project rule presets through bun run test-pre-check / bun run test-post-check; record actual exit codes. Update docs/04_DESIGN.md with changed surfaces in the same implementation change, following docs/99_PROJECT_CONSTITUTION.md and ADR-022/ADR-031. No implementation PASS is asserted by this planning task.

### Plan

- [x] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [x] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R7: Old successful draft versus live request; same row but unrelated plan change; different parent/date/payload; corrupted prior live receipt; dummy then real; after-generate links consumed by cn/overseas; podcast notes use article URL; compact date hit ISO feed; wrong-date bundle; guid proof; fetch timeout/503; missing optional Weibo with X valid; failed dummy prepare; kk-itc unaffected.
- [x] Step 2 — Implement R1-R7 within the listed ownership and frozen design; keep upstream contracts and legacy voice2/kk-itc compatibility.
- [x] Step 3 — Run the focused real-dispatcher cases; inspect receipts and measured artifacts for failures, no-content and resume, not only process exit.
- [x] Step 4 — Update owning surface docs, run required project checks, review the diff against every R-item, and record exact verification evidence and remaining limitations through Spur.

### Solution

Change map (0332 R1–R7):
- `apps/cli/src/publish-matrix.ts:269` `normalizeRunDate` — compact/ISO date normalization used by every stage (R1).
- `apps/cli/src/publish-matrix.ts:295` `runPublishMatrixValidate` — work_dir/window/bundle/run_date validated before any side effect; canonical `4-publish/run-date.txt` written here (R1); routed in `apps/cli/src/publish-matrix-stage.ts:27` and wired as the first `kk-daily-publish3` node (`plugins/kk/workflows/kk-daily-publish3.yaml:112`).
- `apps/cli/src/publish-matrix.ts:364` `composePlan` returns `{plan, omitted}`; bundle runDate must normalize (R1) and missing variants split into required-refusal vs omitted-target (`:458`, `:497`) (R6).
- `apps/cli/src/publish-matrix.ts:1087` `sendPublishMatrix` — receipt identity decided over the payload this pass would deliver (`preparePayload` before policy); mismatch yields `reconciliation required for: <keys>` throw (`:1234`) — fail-closed, no overwrite/resend (R2/R3). Omitted targets get failed effect-none receipts with the plan digest of the written plan bytes (R6).
- `apps/cli/src/itc-publish.ts:477` `sendRows` — shared path: payload digest computed before the receipt policy (`:505`); identity = parentRunId + mode + payloadDigest (R2); unreadable live receipt → reconciliation, draft → safe re-attempt (R3, `:539`); dummy→real dispatches once (R2); legacy receipts without mode/payloadDigest keep 0310 identity (compat).
- `apps/cli/src/itc-publish.ts:717` receipt persists the plugin result `guid` (R5); `ItcReceiptSchema.guid` optional (`:52`).
- `apps/cli/src/publish-matrix.ts:1031` `readLinkMap` scans ALL plans sharing parentRunId across windows; tiers dummy→all/live→live/else real; draft/dummy URLs never enter real links (R4).
- `apps/cli/src/publish-matrix.ts:1309` `matchRssGate` — guid authoritative both directions, title-date fallback only for guid-less receipts (R5); `:1329` `runPublishMatrixRssGate` binds the gate day to the bundle's own plan day and refuses a disagreeing `--date` (R1/R5).
- `apps/cli/src/publish-matrix.ts:828` `runPublishMatrixClassify` — run_date optional + mismatch refuse; compact stamp legacy bridge names; whole-receipts-dir scan keeps failed dummy accounting dummy (R6).
- `apps/cli/tests/publish-matrix-0332.test.ts` — 20 failure-first cases covering R1–R7 (see Testing).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | test: apps/cli/tests/publish-matrix-0332.test.ts:723 (compact/ISO accepted, derived from bundle, garbage refused), :825 (validate-before-send, after-send guard dropped); static-ref: apps/cli/src/publish-matrix.ts:269 (normalizeRunDate), :295 (runPublishMatrixValidate writes 4-publish/run-date.txt), :386 (plan refuses non-normalizable bundle runDate); static-ref: plugins/kk/workflows/kk-daily-publish3.yaml:112 (validate is the first node) |
| R2 | MET | test: apps/cli/tests/publish-matrix-0332.test.ts:215 (unchanged replay re-dispatches nothing), :237 (different bundle revision fails closed), :280 (different payload digest fails closed), :322 (draft→live is reconciliation, not resend), :357 (dummy→real dispatches exactly once); static-ref: apps/cli/src/itc-publish.ts:505 (payload digest before policy), :523 (identity = parentRunId + mode + payloadDigest) |
| R3 | MET | test: apps/cli/tests/publish-matrix-0332.test.ts:394 (unreadable live receipt never auto-resends), :423 (draft unreadable → safe re-attempt); static-ref: apps/cli/src/itc-publish.ts:539 (reconciliation on unreadable + live), apps/cli/src/publish-matrix.ts:1234 (`receipt reconciliation required for:` throw); command: bun test apps/cli/tests/itc-publish.test.ts 43/0 (0314 uncertain no-resend, 0310 re-entry preserved) |
| R4 | MET | test: apps/cli/tests/publish-matrix-0332.test.ts:450 (after-generate tier-0 link consumed by cn-peak podcast), :477 (foreign-bundle tier-0 link rejected), :521 (draft URLs excluded from real links, dummy rows may use them); static-ref: apps/cli/src/publish-matrix.ts:1031 (readLinkMap scans all parentRunId plans, tiers dummy→all/live→live/else real) |
| R5 | MET | test: apps/cli/tests/publish-matrix-0332.test.ts:588 (guid persisted from plugin result), :613 (known guid absent → miss even with same-date title), :640 (title-date fallback only for guid-less legacy receipts), :664 (gate date disagreeing with bundle refuses); static-ref: apps/cli/src/itc-publish.ts:717 (receipt guid persistence), apps/cli/src/publish-matrix.ts:1309 (matchRssGate guid-authoritative), :1329 (gate binds day to bundle plan day) |
| R6 | MET | test: apps/cli/tests/publish-matrix-0332.test.ts:744 (missing optional variant → failed effect-none receipt, unrelated targets still plan), :774 (missing required variant refuses planning), :789 (failed dummy prepare stays dummy in accounting); static-ref: apps/cli/src/publish-matrix.ts:497 (required refusal vs omitted), :828 (classify scans whole receipts dir; plan-mode-aware dummy/none accounting) |
| R7 | MET | test: apps/cli/tests/publish-matrix-0332.test.ts (20 cases over replay/promotion/corrupt/link/date/feed/omission); command: bun test apps/cli/tests/kk-daily-publish3.test.ts 6/0 (e2e miss→incident rss-lag, hit→disjoint plan on bundle day); command: bun test apps/cli/tests/itc-publish.test.ts 43/0 (kk-itc unchanged incl. 0310 legacy re-entry); command: bun run test 4502 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Window sends bind receipts and RSS proof to one bundle revision (req: R1, R2, R3, R4, R5, R6, R7) | MET | test | apps/cli/tests/publish-matrix-0332.test.ts:215,237,280,322,357,394,423,450,477,521,588,613,640,664,685,723,744,774,789,825 cover the declared concrete cases (draft-vs-live, unrelated plan change, changed parent/payload, corrupt live receipt, dummy→real, cross-window links, compact-vs-ISO date, wrong-date bundle, guid proof, fetch failure, missing optional variant, failed dummy prepare, kk-itc regression) through the real seam |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P4 | Legacy receipts without mode/payloadDigest reuse on parentRunId+planDigest alone (apps/cli/src/itc-publish.ts:551) — a pre-0332 edited payload under the same parent could skip | accepted-limitation: 0310 re-entry contract requires it; new receipts (0330+) always carry both identity fields |
| P4 | RSS gate title-date fallback remains for guid-less receipts (apps/cli/src/publish-matrix.ts:1309) — a re-published same-day title could double-hit | accepted-limitation: matches task text (`same-date title fallback only for the current bundle`); guid path is authoritative once receipts persist guid (0332 onward) |

Residual risk: review-lane remediation rekeyed the AC evidence row to the feature scenario title (`R15 — Window sends bind receipts and RSS proof to one bundle revision`) so `spur task verdict` resolves it; no code touched. Full traceability table lives in the review answer (.spur/memory/evidence/0332-verdict.json).

Confidence: HIGH

Verdict: PASS

### References

- Parent feature: G15, docs/features/G15_daily-ai-voice-v3-split-generate-and-publish-preset-driven-channel-matrix.md.
- Source audit: .spur/reports/voice3-migration-review-2026-10-25.md; all owned findings and current-code premises are embedded in Background so this task is self-contained.
- Authority: docs/00_ADR.md:957 (ADR-022), docs/00_ADR.md:1223 (ADR-031), docs/design/kk-daily-ai-voice3.md:227 (accepted operator decisions), docs/99_PROJECT_CONSTITUTION.md:160 (surface/status synchronization).
- Dependencies: 0331.
- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.
- Code/test targets and observable failure matrix: Design.

### History

- 2026-11-04T04:30:33.975Z todo → wip (system)
- 2026-11-04T05:08:25.401Z wip → testing (system)
- 2026-11-04T05:08:27.399Z testing → done (system)

