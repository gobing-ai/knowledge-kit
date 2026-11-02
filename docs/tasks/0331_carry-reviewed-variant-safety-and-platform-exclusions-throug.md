---
schema_version: 1
name: Carry reviewed variant safety and platform exclusions through the voice3 bundle
status: todo
template: feature-impl
created_at: 2026-10-26T00:11:53.722Z
updated_at: "2026-10-26T00:13:40.391Z"
feature_id: G15
priority: P1
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 12

dependencies: ["0329", "0330"]
ac_numbering: task-local
---

## 0331. Carry reviewed variant safety and platform exclusions through the voice3 bundle

### Background

Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

Owned audit findings: F04, F05. Priority reflects the highest owned severity; estimate 12 engineer-hours includes failure-first tests, docs and final checks.

- plugins/kk/scripts/daily-stages.ts:2090 — legacy preparation checks stamp status/digest; :2167 explicitly skips excluded WeChat delivery.
- plugins/kk/scripts/kk-workflow-stages.ts:1139 — safetyDigest covers only article Content and VoiceScript.
- plugins/kk/workflows/kk-daily-ai-voice3.yaml:760 — social text is authored after the original safety/review; cards-write at :697 is also later.
- apps/cli/src/publish-matrix.ts:30 — strict BundleSchema has no safety evidence, and composePlan/send currently do not enforce platform exclusions.

Environment/concurrency: Bun 1.4.3; pinned Biome via bun run lint/format; installed Spur observed at 0.4.20 (run latest bare CLI, do not pin). Existing uncommitted apps/cli/src/publish-matrix.ts and apps/cli/tests/publish-matrix.test.ts changes belong to concurrent work: inspect and preserve them, never revert. Only the main worktree and no wip tasks were observed during filing; recheck at implementation start. Multiple tasks touch workflow/stage/matrix files: obey dependencies and use isolated worktrees for concurrent execution. Production stage sources currently match checkout, but bundled CLI parity is unverified; tests must bind the checkout CLI and scripts through a local shim, never the installed live runner.

**Refine corrections (2026-10-25)**
- Findings were checked against the current tree, including concurrent matrix edits; none of this task's owned defects is already fixed. Preserve existing fixes rather than reopening them.
- Completed G15 work is historical, not proof of migration readiness. This task is new corrective implementation, not a completed verification.
- Operational constraints C01-C05 mean: explicit real/dummy/off inventory; manual live confirmation; opt-in auto_publish and prepared launchers; accepted zh-only locale parity; deterministic fixtures for wait/RSS. They are assigned as implementation/runbook work without authorizing production activation.

### Requirements

- [ ] R1. Retain existing draft/VoiceScript safety before TTS, then review every final real-publish variant, including social/card copy, before freezing. New channel text cannot inherit approval solely from article/script.
- [ ] R2. Add a separate final-variant safety scope to the existing nested safety machine with bounded revisions and distinct evidence paths; default draft scope keeps voice2 behavior unchanged.
- [ ] R3. Freeze additive bundle.safety evidence binding status, reviewed variant digests and excluded platform identities to the final bytes; missing, failed, stale or malformed evidence refuses any real plan/send.
- [ ] R4. Enforce current platform exclusions for every mapped operation, including WeChat audio/article and podcast destinations; dummy rehearsals remain no-dispatch and visibly unapproved. Reject unknown exclusion identifiers rather than silently ignoring them.
- [ ] R5. Revalidate evidence at send after live confirmation/resume; a payload or variant edited after review cannot dispatch. Deterministic URL substitution may change only declared link slots and retains provenance to reviewed source.
- [ ] R6. Prove missing/stale stamps, excluded targets, unchecked new social facts, bounded revise exhaustion and edits during a pause with offline engine/agent doubles. Do not weaken original safety assertions.

### Acceptance Criteria

- [ ] AC1 — Every real publish variant carries current platform-aware safety evidence (req: R1, R2, R3, R4, R5, R6)

Given the current checkout and the isolated fixture conditions in Design, when the listed success/failure/replay cases run through the actual owned seam, then every R-item is observed through receipts, store state, artifact bytes and process/run status. Verification owner: this task's implementer; final cross-task rehearsal belongs to the rehearsal task. Concrete cases: Original article pass but unsafe later social output; changed card copy; exclude WeChat covers both operations; podcast destination exclusion; missing/stale safety record; old bundle dummy allowed/real refused; edit while paused; URL-slot-only resolution accepted; unknown platform; revise budget exhausted; legacy safety fixture unchanged.

### Q&A

Closed decisions (2026-10-25):
- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.
- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.
- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.
- Dependencies: 0329, 0330; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.
- Source audit findings owned here: F04, F05. Failure cases must precede production edits; evidence uses isolated local fixtures.

### Design

**Ownership:** plugins/kk/workflows/kk-daily-ai-voice3.yaml; plugins/kk/workflows/kk-daily-safety.yaml; plugins/kk/scripts/daily-stages.ts; plugins/kk/scripts/kk-workflow-stages.ts; apps/cli/src/publish-matrix.ts (BundleSchema, freeze, safety admission); corresponding safety/workflow E2E fixtures; docs/04_DESIGN.md. Own only this behavior; do not revert others' edits.

Frozen additive contract: optional Bundle.safety object {status: pass|escalate|exclude, digest: string, excludedPlatforms: string[], variants: Record<string,string>} where variants maps bundle variant keys to their reviewed sha256; status block never freezes a real-capable bundle. Existing schemaVersion remains 1; old bundles remain readable for dummy rehearsal but real dispatch requires this evidence. Final scope evidence lives under <work_dir>/4-safety-variants/; nested kk-daily-safety gains safety_scope (drafts default, variants opt-in) and safety_manifest (empty default). Voice3 produces <work_dir>/4-safety-variants/manifest.json naming the final Content variants, invokes the nested safety machine with that manifest, then freezes only the reviewed bytes. Scope-specific paths must prevent overwriting the TTS draft stamp. Reuse the existing report/judge/revise rules and budgets, no new provider or safety bypass. The agent input must read manifest-listed final content, not only the plan. Map platform identities explicitly (wechatmp to wechatmp-pub; xiaoyuzhou/apple-podcasts to podcast-pub for the shared episode, plus corresponding plugin ids); unknown identifiers are actionable failures. Keep existing operator escalation semantics; do not auto-approve live sends. Handoff: delivery task validates source-to-resolved payload identity; outcome task records exclusions as nondelivered dispositions rather than success. Rejected: trusting new bundle hashes as safety approval, blanket exclusions metadata without enforcement, and expanding the legacy draft digest silently for voice2.

**Dependencies:** 0329, 0330. Dependency edges are persisted in frontmatter.

**Inbound handoff:** 0329 — Fresh voice3 runs select current items and freeze complete validated bundles; 0330 — Draft and dummy launches never publish live on any selected operation.

**Outbound handoff:** 0332 — Window sends bind receipts and RSS proof to one bundle revision.

**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.

**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.

**Non-goals:** Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

**Failure-first matrix:** Original article pass but unsafe later social output; changed card copy; exclude WeChat covers both operations; podcast destination exclusion; missing/stale safety record; old bundle dummy allowed/real refused; edit while paused; URL-slot-only resolution accepted; unknown platform; revise budget exhausted; legacy safety fixture unchanged.

Verification contract: enumerate failure cases and create behavior/E2E regression checks BEFORE changing production code; no post-hoc unit tests. Use bun:test, the real Spur DAG dispatcher, deterministic fixture generators/transports and intercepted HTTP; no provider/model calls, credentials, browser publication or live store access. Write observed evidence to .works/tmp/test-voice3-migration/0331/summary.json (and referenced logs/receipts), deriving the summary from assertions rather than hard-coded prose. Focused tests may exit 1 from per-file coverage; distinguish that from assertion failures. Final implementation gates: bun run lint, bun run test, bun run build, and project rule presets through bun run test-pre-check / bun run test-post-check; record actual exit codes. Update docs/04_DESIGN.md with changed surfaces in the same implementation change, following docs/99_PROJECT_CONSTITUTION.md and ADR-022/ADR-031. No implementation PASS is asserted by this planning task.

### Plan

- [ ] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [ ] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R6: Original article pass but unsafe later social output; changed card copy; exclude WeChat covers both operations; podcast destination exclusion; missing/stale safety record; old bundle dummy allowed/real refused; edit while paused; URL-slot-only resolution accepted; unknown platform; revise budget exhausted; legacy safety fixture unchanged.
- [ ] Step 2 — Implement R1-R6 within the listed ownership and frozen design; keep upstream contracts and legacy voice2/kk-itc compatibility.
- [ ] Step 3 — Run the focused real-dispatcher cases; inspect receipts and measured artifacts for failures, no-content and resume, not only process exit.
- [ ] Step 4 — Update owning surface docs, run required project checks, review the diff against every R-item, and record exact verification evidence and remaining limitations through Spur.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: G15, docs/features/G15_daily-ai-voice-v3-split-generate-and-publish-preset-driven-channel-matrix.md.
- Source audit: .spur/reports/voice3-migration-review-2026-10-25.md; all owned findings and current-code premises are embedded in Background so this task is self-contained.
- Authority: docs/00_ADR.md:957 (ADR-022), docs/00_ADR.md:1223 (ADR-031), docs/design/kk-daily-ai-voice3.md:227 (accepted operator decisions), docs/99_PROJECT_CONSTITUTION.md:160 (surface/status synchronization).
- Dependencies: 0329, 0330.
- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.
- Code/test targets and observable failure matrix: Design.

### History
