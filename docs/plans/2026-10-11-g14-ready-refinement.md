# G14 ready-depth refinement — 2026-10-11

Invocation: `$sp-dev-refineall --feature G14 --auto --depth ready`.
Result: **clean — all three tasks refined; all seven readiness items pass for each task**.
Membership frozen once: 0256, 0257, 0258. No exclusions/failures. Dependency order: 0256 → 0257 → 0258.
All were already todo; priority/estimates and statuses are unchanged. Specification readiness does
not waive execution dependencies: only 0256 can start now.

| Task | Result | Corrections | Status | Failed checklist IDs |
| --- | --- | --- | --- | --- |
| 0256 | refined | 5 | todo → todo | none |
| 0257 | refined | 6 | todo → todo | none |
| 0258 | refined | 5 | todo → todo | none |

## Material corrections

- Pin the published VoxCPM 2.0.3 release and Python 3.12. Its API differs from the reference checkout:
  seed belongs in PyTorch state, instruction in the documented text prefix; playback speed stays shared.
  Installed import/model compatibility is a step-0 execution precondition, not tested live here.
- Reuse already-exported voice-gen types/helpers. Freeze profile/controls/path validation and worker framing.
- Daily rendering uses synchronous invocation. The plugin owns bounded worker teardown and normal-signal
  cleanup; async executor tests alone cannot prove that contract.
- Freeze requested-driver cache checks before Gemini probing and actual-fallback checks afterward.
  Reconstruct joined Content/provenance/QC and prevent stale MP3/intro metadata.
- During refinement another session added ensurePublishMp3 and tests. Task 0257 now reuses that helper
  while clearing stale MP3 paths on fresh joins. Other code/test/YAML changes remain owned by that session.
- Freeze comparison fixture texts, four short/four full renders, actual-generator checks and report-only
  recommendations. Missing inference yields partial evidence; missing playback yields pending listening
  and an inconclusive quality conclusion. No default/calibration source change belongs to the evidence task.

The `vendors/` reference-only boundary remains explicit in every task and the design. No vendor files
were changed; no product code/dependency/assets may access them.

## Readiness checklist

### 0256

| ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | R1–R5 name Content/assets/validation/lifecycle/test outcomes and non-goals. |
| design | yes | Design freezes plugin paths, worker framing, 2.0.3/Python 3.12, profiles, controls, deadlines and cleanup. |
| plan | yes | Ordered R-linked steps start with locked import/API preflight, then implementation and observable tests/gates. |
| ac | yes | Four feature-matching ACs bind R1–R5 and name entry/worker/distribution/sync-executor test layers. |
| decisions | yes | Q&A closes backend, control and lifecycle choices; live hardware/quality explicitly owned by 0258. |
| dependencies | yes | No prerequisite; stable Content/native rate/provenance handoff to 0257/0258 is explicit. |
| premises | yes | Current exports/callers/worker source and published wheel inspected; source signatures distinguished from untested runtime. Concurrency refreshed. |

### 0257

| ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | R1–R4 cover routing/cache/join/MP3/native-rate tests, unchanged defaults and no publication. |
| design | yes | Design freezes requested-cache/probe/fallback order, section provenance, reconstructed Content/QC and fresh MP3 using concurrent helper. |
| plan | yes | Ordered R-linked alias/cache/join/intro/test/docs/gate steps, with no live production run. |
| ac | yes | Three feature-matching ACs bind all R-items; stage shims observe routing, real ffmpeg fixtures observe artifacts. |
| decisions | yes | Q&A closes cache/join/helper ownership; evidence/calibration recommendation owned by 0258. |
| dependencies | yes | 0256 is declared prerequisite; exact Content identity/native-rate handoff consumed; 0258 consumes render-stage contracts. |
| premises | yes | Whole/section callers, cached/joined metadata, intro and publish-prep inspected; concurrent ensurePublishMp3 diff re-audited and reused. |

### 0258

| ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | R1–R4 name matched renders, actual provenance/measurement/listening/report outcomes and report-only scope. |
| design | yes | Design freezes fixture texts/settings, four short plus four full renders, isolated paths/argv, budgets and fallback handling. |
| plan | yes | Ordered R-linked environment/snapshot/short/full/listen/report checks; failure and pending-listening semantics explicit. |
| ac | yes | Feature comparison AC binds all R-items; real Content/ffprobe/hash/listener artifacts observe evidence, never fake audio. |
| decisions | yes | Q&A closes sample/cost/ownership decisions; adoption/calibration deferred to operator after evidence. |
| dependencies | yes | Declared 0257 dependency transitively includes 0256; consumes completed backend/workflow verification without re-owning production code. |
| premises | yes | Stage argument/source-path/script grouping and retry settings checked; no installed runtime/hardware/listening claims; concurrency recorded. |

## Verification and handoff

- `spur task check <wbs> --as todo --json`: passed for all three tasks. 0257/0258 retain expected
  `L4.prerequisite-not-done` warnings for 0256/0257 respectively.
- `spur feature check G14 --json`: passed with eight expected `L4.scenario-unverified` warnings;
  these tasks have not been implemented or verified. Feature status remains backlog.
- `spur rule run --preset recommended-pre-check --json`: 55 rules, no findings, no fixes.
- `git diff --check`: clean for refinement paths. This invocation changes only the three task specs,
  the design satellite and this report; concurrent product/test/workflow edits are preserved.

CLI-gated writes were used for every task section. Machine-readable checklist/check results and audit
sources are under `.spur/run/refine-g14-20261011/` (local, untracked); correction records and the frozen
contracts are durable in the task files. No previous idea-run digest or attestation was fabricated.
The published wheel was hash-verified and read without executing its code; primary release sources
are linked in task 0256 and the design satellite.

Next operation: `$sp-dev-runall --feature G14 --auto`, following 0256 → 0257 → 0258. No execution
was chained from this refinement.

Not run: implementation, fresh application lint/build/test suite, package installation, model loading,
listening or publication. Planning/corpus/rule checks were sufficient for these documentation changes;
live backend compatibility, hardware cost and audio quality remain execution risks, not readiness claims.
