---
schema_version: 1
name: Carry reviewed variant safety and platform exclusions through the voice3 bundle
status: done
template: feature-impl
created_at: 2026-10-26T00:11:53.722Z
updated_at: "2026-11-05T08:24:16.796Z"
feature_id: G15
priority: P1
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 12

dependencies: ["0329", "0330"]
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0331-verdict.json
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

- [x] R1. Retain existing draft/VoiceScript safety before TTS, then review every final real-publish variant, including social/card copy, before freezing. New channel text cannot inherit approval solely from article/script.
- [x] R2. Add a separate final-variant safety scope to the existing nested safety machine with bounded revisions and distinct evidence paths; default draft scope keeps voice2 behavior unchanged.
- [x] R3. Freeze additive bundle.safety evidence binding status, reviewed variant digests and excluded platform identities to the final bytes; missing, failed, stale or malformed evidence refuses any real plan/send.
- [x] R4. Enforce current platform exclusions for every mapped operation, including WeChat audio/article and podcast destinations; dummy rehearsals remain no-dispatch and visibly unapproved. Reject unknown exclusion identifiers rather than silently ignoring them.
- [x] R5. Revalidate evidence at send after live confirmation/resume; a payload or variant edited after review cannot dispatch. Deterministic URL substitution may change only declared link slots and retains provenance to reviewed source.
- [x] R6. Prove missing/stale stamps, excluded targets, unchecked new social facts, bounded revise exhaustion and edits during a pause with offline engine/agent doubles. Do not weaken original safety assertions.

### Acceptance Criteria

- [x] AC1 — Every real publish variant carries current platform-aware safety evidence (req: R1, R2, R3, R4, R5, R6)

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

- [x] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [x] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R6: Original article pass but unsafe later social output; changed card copy; exclude WeChat covers both operations; podcast destination exclusion; missing/stale safety record; old bundle dummy allowed/real refused; edit while paused; URL-slot-only resolution accepted; unknown platform; revise budget exhausted; legacy safety fixture unchanged.
- [x] Step 2 — Implement R1-R6 within the listed ownership and frozen design; keep upstream contracts and legacy voice2/kk-itc compatibility.
- [x] Step 3 — Run the focused real-dispatcher cases; inspect receipts and measured artifacts for failures, no-content and resume, not only process exit.
- [x] Step 4 — Update owning surface docs, run required project checks, review the diff against every R-item, and record exact verification evidence and remaining limitations through Spur.

### Solution

Failure-first: both new suites (`apps/cli/tests/publish-matrix-0331.test.ts`, `plugins/kk/tests/safety-variants-scope.test.ts`) were authored red before production edits.

Matrix side:
- apps/cli/src/publish-matrix.ts:36 `BundleSafetySchema` (strict; `block` unrepresentable — a blocked verdict fails the parse and refuses the freeze as malformed evidence); apps/cli/src/publish-matrix.ts:84 `PublishPlanRowSchema` gains additive `variantPath`/`variantDigest`.
- apps/cli/src/publish-matrix.ts:316 `PLATFORM_EXCLUSIONS` (content-safety platform names → preset plugin ids); apps/cli/src/publish-matrix.ts:328 exclusion resolution drops rows before mode/payload work; apps/cli/src/publish-matrix.ts:338 unknown identifier fails the plan.
- apps/cli/src/publish-matrix.ts:423 plan evidence gate: with `bundle.safety` present every non-dummy row's variant key must be listed and still hash to its reviewed sha256; no evidence → only pre-0331 behavior (old bundles plan for dummy, real rows still refuse without evidence).
- apps/cli/src/publish-matrix.ts:900 send revalidation: pending non-dummy rows rehash payload (`payloadDigest`) and source variant (`variantDigest`) before any dispatch (R5 edit-while-paused).
- apps/cli/src/publish-matrix.ts:1408 freeze admission reads `<workDir>/4-safety-variants/safety.json` verbatim (malformed → rc 1; absent → freeze continues).

kk side:
- plugins/kk/scripts/daily-stages.ts:3480 `SAFETY_VARIANTS_DIR='4-safety-variants'` + scope machinery (`isDraftsScope`/`scopeDirOf`/`scopeArtifact`/`scopeCounter`/`readScopeCounter`/`SafetyManifest`/`readManifest`/`scopeDigest`/`scopeContent`); one trailing `scopeDir` arg threads `dailySafetyPrep/Gate/Verdict/Revise`; `24-script` (default) keeps every drafts path byte-identical.
- plugins/kk/scripts/daily-stages.ts:3560 new `daily-safety-manifest` stage registers sorted `30-variants/*.content.json` into `4-safety-variants/manifest.json` (key = filename `_`→`:`); prep writes request `{digest, platforms, mode:'detect-only', scope, content:[{key,path,sha256}]}` and resets the scoped budget; prep's stale sweep also removes the unprefixed `safety.json` in the variants scope.
- Gate: quarantine stays drafts-only (variants scope never quarantines — bundle is regenerated, not hand-repaired); plugins/kk/scripts/daily-stages.ts:3444 verdict recomputes CURRENT per-variant sha256 at the last instant and refuses on stamp mismatch without writing evidence; evidence `safety.json` `{status, digest, excludedPlatforms, variants}` only on admission (plugins/kk/scripts/daily-stages.ts:3458).
- plugins/kk/scripts/safety-artifact-check.ts:45 scope-aware `safetyPath`; plugins/kk/scripts/safety-artifact-check.ts:176 variants `draftDigest` mirrors `scopeDigest`; argv keeps `publish-valid`'s historical `unattended` in slot 4 (scope = slot 5) and takes scope as slot 4 for the other kinds; dispatch case plugins/kk/scripts/kk-workflow-stages.ts:1721.

Workflow wiring: `plugins/kk/workflows/kk-daily-safety.yaml` gains `safety_scope_dir: "24-script"` threaded through every stage command, guard, prompt and expectFile pin; `plugins/kk/workflows/kk-daily-ai-voice3.yaml` adds `safety-variants` (:848, dependsOn `[bundle-variants, safety-variants, pool-gate]`, gated on the pool PASS token, nested run carries `safety_scope_dir=4-safety-variants`) and `bundle-freeze` waits on it.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | safety-variants node reviews every final Content variant (article, dailynews, social, cards, cover) before bundle-freeze: plugins/kk/workflows/kk-daily-ai-voice3.yaml:848 (dependsOn bundle-variants/pool-gate, :868 daily-safety-manifest registers sorted 30-variants/*.content.json, :871 nested run carries safety_scope_dir=4-safety-variants); manifest stage plugins/kk/scripts/daily-stages.ts:3560; DAG pin plugins/kk/tests/safety-variants-scope.test.ts:147 (safety-variants node runs before bundle-freeze, :161 dependsOn pin; regression suites voice3-dag 20 pass / voice2-dag 48 pass); plan refuses a real row whose variant is not covered by bundle.safety.variants (apps/cli/src/publish-matrix.ts:423) |
| R2 | MET | One scope arg re-roots the machine: plugins/kk/scripts/daily-stages.ts:3480 SAFETY_VARIANTS_DIR + scope machinery (isDraftsScope :3482, scopeDirOf :3487, scopeArtifact :3491, scoped budget :3496-3515, scopeDigest :3528, scopeContent :3546); dailySafetyPrep/Gate/Verdict/Revise take the trailing scopeDir (prep :3592); drafts default 24-script keeps pre-0331 behavior byte-identical (plugins/kk/tests/safety-variants-scope.test.ts:288 drafts-default case; plugins/kk/tests/safety-reviewer-failure.test.ts 16 pass on the default path); safety_scope_dir var threaded through stages/guards/prompts (plugins/kk/workflows/kk-daily-safety.yaml:53, >=25 refs) |
| R3 | MET | Evidence binds reviewed bytes to the frozen bundle: verdict recomputes CURRENT per-variant sha256 at the last instant and refuses on mismatch without writing evidence (plugins/kk/scripts/daily-stages.ts:3444 verdict-refused; :3435 missing registered file; :3458 safety.json only on admission; :3411/:3413 non-admitted outcomes); freeze admission attaches valid evidence verbatim and refuses malformed/block (apps/cli/src/publish-matrix.ts:1405-1420; block unrepresentable in BundleSafetySchema :36-40 — parse refusal IS the block gate); reviewed-digest mismatch refuses the plan (:429); evidence gate tests (apps/cli/tests/publish-matrix-0331.test.ts:220,:246,:289,:482,:507; plugins/kk/tests/safety-variants-scope.test.ts:203,:232) |
| R4 | MET | PLATFORM_EXCLUSIONS drops excluded rows before mode/payload work (apps/cli/src/publish-matrix.ts:316-341): xiaoyuzhou/apple-podcasts→podcast-pub, wechatmp→wechatmp-pub (apps/cli/tests/publish-matrix-0331.test.ts:155,:187); unknown identifier fails the plan (:130) |
| R5 | MET | Send revalidation rehashes payloadDigest and variantDigest of every pending non-dummy row before dispatch (apps/cli/src/publish-matrix.ts:898-931; tests :346 payload edited at pause, :379 variant edited at freeze, :419 URL-slot-only substitution still dispatches); dummy rows stay rehearsals (0330 behavior, unchanged fixtures publish-matrix.test.ts 34 pass, publish-matrix-0330.test.ts 10 pass) |
| R6 | MET | Failure matrix realized as tests, written red-first: missing/malformed evidence, unknown exclusion platform, edited variant at plan AND send, excluded targets dropped, legacy no-evidence bundle plans dummy but refuses real (apps/cli/tests/publish-matrix-0331.test.ts 13 cases); edit-after-review verdict refusal, block-never-quarantines-drafts, scoped budget reset/exhaustion, drafts default (plugins/kk/tests/safety-variants-scope.test.ts 9 cases, 59 expects, full out-of-process stage chains); original 0330/legacy assertions preserved (voice2-dag 48 pass incl. updated publish-valid argv pin; voice3-dag 20 pass) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Every real publish variant carries current platform-aware safety evidence (req: R1, R2, R3, R4, R5, R6) | MET | test | Every listed case covered by apps/cli/tests/publish-matrix-0331.test.ts (13 cases: exclusion map known/unknown/dual-drop; live row refused without evidence while dummy plans; social and cards variants edited after review refused at plan; legacy bundle compat; payload and variant rehash refusals at send; URL-slot resolution dispatches; freeze refuses block evidence, attaches valid evidence) plus plugins/kk/tests/safety-variants-scope.test.ts (9 out-of-process stage cases: scope default/pins, manifest registration, scoped prep request + budget reset, admitted verdict binds CURRENT bytes, byte-edit refusal with refuse token and no evidence, block never quarantines drafts, revise re-validation + scoped counter, drafts default unchanged) and DAG pins plugins/kk/tests/safety-variants-scope.test.ts:147,:161 (voice3 wiring), :117 (kk-daily-safety scope default), with regression DAG suites apps/cli/tests/voice3-dag.test.ts (20 pass) / apps/cli/tests/voice2-dag.test.ts (48 pass); failure-first ordering honored; consolidated evidence .works/tmp/test-voice3-migration/0331/summary.json; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | `runCheck` test helper double-included the command (`spawnSync('bun', ['bun', …])`) — child saw multiple entry points | fixed during implementation; suites green |
| P3 | prep's stale-evidence sweep looked for the runDate-prefixed `safety.json` only; evidence is the one unprefixed artifact | fixed; sweep now also removes the unprefixed variants evidence |
| P4 | a `status === 'block'` branch after `BundleSafetySchema` parsing was unreachable by design (`block` unrepresentable) | dead code removed; replaced with a comment pointing at the parse refusal |

Residual risk: `docs/04_DESIGN.md` documents `PLATFORM_EXCLUSIONS` as code-owned; adding a new plugin requires updating the map (unknown identifiers fail loudly, so the gap is visible, not silent). Real live-dispatch behavior is unchanged by this task (0330 handoff contract); cross-window rehearsal belongs to 0332.

Confidence: HIGH

Verdict: PASS — all R-items observed through the failure-first suites and the manual probes; voice2/kk-itc behavior preserved (drafts default byte-identical).

### References

- Parent feature: G15, docs/features/G15_daily-ai-voice-v3-split-generate-and-publish-preset-driven-channel-matrix.md.
- Source audit: .spur/reports/voice3-migration-review-2026-10-25.md; all owned findings and current-code premises are embedded in Background so this task is self-contained.
- Authority: docs/00_ADR.md:957 (ADR-022), docs/00_ADR.md:1223 (ADR-031), docs/design/kk-daily-ai-voice3.md:227 (accepted operator decisions), docs/99_PROJECT_CONSTITUTION.md:160 (surface/status synchronization).
- Dependencies: 0329, 0330.
- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.
- Code/test targets and observable failure matrix: Design.

### History

- 2026-11-04T01:39:55.702Z todo → wip (system)
- 2026-11-04T02:52:46.043Z wip → testing (system)
- 2026-11-04T02:54:38.371Z testing → wip (system)
- 2026-11-04T02:55:45.439Z wip → testing (system)
- 2026-11-04T03:06:59.142Z testing → wip (system)
- 2026-11-04T03:09:04.815Z wip → testing (system)
- 2026-11-04T03:09:06.999Z testing → done (system)

