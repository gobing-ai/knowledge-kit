---
kind: plan
feature: G21
operation: refineall
depth: ready
status: refined
created_at: 2026-10-15
---

# G21 ready-depth refinement

Membership frozen at kickoff: 0298, 0299, 0300, 0301, 0302, 0303. Execution surface: inline, auto, no worktree. All tasks started todo. This is a task-contract audit; no product implementation is authorized by this operation.

## Preparation evidence

- Quick readiness runnable for all six tasks; dependency order 0298 → 0299 → 0300 → 0301 → 0302 → 0303; no out-of-set dependencies.
- Strict feature preflight has 18 expected scenario-unverified findings and zero aborting findings; no structural repairs.
- Bun 1.4.3; selected bare Spur 0.4.4 and Superskill 0.3.37 are point-in-time evidence, not version pins.
- Main tree wip task query empty. Separate runall-0288-0297 worktree has unmerged Shipinhao publisher/lockfile/task0296 changes; do not consume or revert them.
- Existing operator design changes were preserved. No model subprocess, subagent, workflow execution or live publication is used for this refinement.

## Result

Batch verdict: **clean**. Six tasks refined at ready depth; 31 corrections; all remain todo. Priority and estimates preserved (52h total). All 18 R-items remain valid, with requirements and AC bodies unchanged. No dropped issue, cancellation, merge, status promotion or implementation. Added 0299 → 0298 for the native dispatcher; frozen membership and order are unchanged.

| Task | Outcome | Corrections | Dropped issues | Status | Failed checklist IDs |
| --- | --- | ---: | --- | --- | --- |
| 0298 | refined | 5 | none | todo → todo | none |
| 0299 | refined | 5 | none | todo → todo | none |
| 0300 | refined | 4 | none | todo → todo | none |
| 0301 | refined | 4 | none | todo → todo | none |
| 0302 | refined | 6 | none | todo → todo | none |
| 0303 | refined | 7 | none | todo → todo | none |

## 0298 — Plan ITC publication from discovered plugin capabilities

Issue triage: R1 valid. No issue-specific requirement or scenario was removed. False design assumptions were corrected below; work owned by another task is an explicit handoff.

| Checklist ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | Observable discovered capabilities; no generic Content narrowing or new transport. |
| design | yes | Strict profile schemas, buildItcPublishPlan, async command-only runItcStage; complete plugin mode maps; installed manifests preserved. |
| plan | yes | R1 steps cover schema/discovery, native dispatch, manifest migration and real planner tests. |
| ac | yes | AC1 retained verbatim; actual manifest parser/planner and native/legacy stage tests observe it. |
| decisions | yes | No invented format enum; no config dependency on future 0303; sync daily callers preserved. |
| dependencies | yes | Leaves native dispatcher and versioned explicit request/plan to 0299/0300/0302/0303. |
| premises | yes | Read ContentSchema, manifest/discovery, every runStage caller, Qiita private precedence, WeChat operation modes; named actual behavioral tests. |

Corrections:

- Existing Content format enum → ContentSchema.format is a string defaulting to markdown → remove the invented enum restriction; validate nonempty profile formats without narrowing generic Content.
- Unspecified native stage seam → runStage is synchronous and daily.ts calls it synchronously → add an async ITC handler in the stage command action and keep runStage/daily callers synchronous.
- Generic draft metadata is sufficient → Qiita private overrides published and WeChat operations are 文章/贴图/视频/播客 → freeze complete plugin-owned mode bindings from current implementations.
- Configuration snapshot assumed before 0303 → no ITC resolver exists upstream → planner accepts explicit validated request data; 0303 later supplies config-derived values.
- TARGET_PROFILES was treated as a public contract → current tests import it but runtime entry is the stage → replace representation tests while retaining behavioral and legacy stage coverage.

Current-tree anchors: `packages/kk-core/src/schemas.ts:17`, `packages/kk-core/src/manifest.ts:55`, `packages/kk-core/src/registry.ts:11`, `apps/cli/src/stage.ts:81`, `apps/cli/src/commands/stage.ts:47`, `plugins/kk/scripts/itc-stages.ts:266`, `plugins/publishings/qiita-pub/src/index.ts:68`, `plugins/publishings/wechatmp-pub/src/modes.ts:27`.

Planning digest (Spur computePlanningDigest): `19bacd7c0ba2b0c7c7b7a584126c25480e4f6e66c93b1f3acef96feb7bab186c`.

## 0299 — Select evidence-backed ITC topics from the collection store

Issue triage: R1 valid, R2 valid. No issue-specific requirement or scenario was removed. False design assumptions were corrected below; work owned by another task is an explicit handoff.

| Checklist ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | R1 evidence-backed intake and R2 safe empty/refused intake remain valid; ingestion remains optional. |
| design | yes | Frozen candidate slots, Doc[] pool, selected subset, run-bound store settlement and --request stages in itc-topic.ts. |
| plan | yes | R1/R2 steps cover extraction, validation, selection, settlement and temporary SQLite tests. |
| ac | yes | AC1/AC2 retained verbatim; actual extract/select/release paths and subset assertions observe outcomes. |
| decisions | yes | Explicit selected slot until 0301; DAG owns optional collect child; no new global exclusive claim. |
| dependencies | yes | Added 0298 prerequisite for native dispatcher; supplies topic/selection packets to 0300/0301/0302/0303. |
| premises | yes | Read actual empty extract behavior, profile grammar, selection uniqueness/idempotence and release/mark-published ownership; model/child only stubbed at boundary. |

Corrections:

- A selected topic implied a fresh exclusive claim → extract returns a snapshot and select is idempotent per run, not a global atomic cross-workflow claim → preserve that contract and avoid claiming stronger exclusivity.
- Release on every failure → remote side effects can be uncertain and published rows must remain excluded → freeze settlement precedence and retain selected rows on unknown effects.
- Topic selection/workspace interfaces were unspecified → add bounded candidate/selection artifacts and explicit intake-directory inputs; defer default workspace allocation to 0303.
- Collection refresh completion was vague → use the resolved kk-collect definition and terminal child identity; no independent ingestion or async-launch-as-success shortcut.
- Native ITC dispatcher assumed without a prerequisite → it is introduced by 0298 → add the missing 0298 dependency before implementation.

Current-tree anchors: `apps/cli/src/commands/store.ts:1277`, `apps/cli/src/commands/store.ts:1373`, `apps/cli/src/commands/store.ts:1462`, `packages/kk-store/src/profile.ts:43`, `plugins/kk/workflows/kk-collect.yaml:1`, `plugins/kk/commands/workflow-run.md:189`.

Planning digest (Spur computePlanningDigest): `d3cb7d807118b362d8d652b9a59ef442fdfe90db1e6627c19cad649c4a100b05`.

## 0300 — Resolve topic channel presets with explicit target overrides

Issue triage: R1 valid. No issue-specific requirement or scenario was removed. False design assumptions were corrected below; work owned by another task is an explicit handoff.

| Checklist ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | Inspectable frozen preset selection and explicit override outcome preserved; no remote preset registry. |
| design | yes | Actual ExtractProfile/PROFILE_KEYS extension; strict project/package asset lookup; frozen precedence and duplicate identity behavior. |
| plan | yes | R1 steps cover parser, asset lookup, resolution/provenance and actual resolver tests. |
| ac | yes | AC1 retained verbatim; project override, malformed override, duplicate/mode/media and installed resolver tests observe it. |
| decisions | yes | Explicit targets replace preset targets; conflicting same-plugin profiles refuse; SQL compilation unchanged. |
| dependencies | yes | Consumes 0298 capabilities and 0299 profile; supplies target identity/origin to 0301/0302/0303 without importing future config. |
| premises | yes | Read profile parser/compile seam and packaged asset resolution; existing extraction grammar does not accept publishPreset yet. |

Corrections:

- topic-profile parser named generically → parseProfile and ExtractProfile live in packages/kk-store/src/profile.ts and reject unknown keys → explicitly extend that parser/type while leaving compileProfile SQL unchanged.
- Preset precedence omitted workflow-config defaults → final config stage supplies a resolved explicit preset with provenance → freeze one precedence algorithm without importing 0303 prematurely.
- Target identity/duplicates were vague → executor keys by plugin name → allow one profile per plugin, collapse exact duplicates and reject conflicting profile selectors.
- Installed/project lookup unspecified → distinguish project root from workspace and use package assets → freeze exact search paths and no-fallback-on-malformed override behavior.

Current-tree anchors: `packages/kk-store/src/profile.ts:43`, `packages/kk-store/src/profile.ts:56`, `packages/kk-store/src/profile.ts:174`, `apps/cli/src/commands/store.ts:1236`, `plugins/kk/scripts/itc-stages.ts:385`, `scripts/bundle-plugins.ts:118`.

Planning digest (Spur computePlanningDigest): `76699f106d99d6ecfb617b5e3077a31f937e357ed9ceacb01cd85c8a9534b78f`.

## 0301 — Persist bounded ITC semantic decisions and safe fallbacks

Issue triage: R1 valid, R2 valid. No issue-specific requirement or scenario was removed. False design assumptions were corrected below; work owned by another task is an explicit handoff.

| Checklist ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | R1 bounded decisions and R2 same-child continuation preserved; choices cannot enable publication or spend. |
| design | yes | Frozen itc-decision requests/evidence bound, catalog choices, kk-itc-author FSM IDs and author-run/completion receipts. |
| plan | yes | R1/R2 steps cover catalog/default persistence, child extraction, receipt validation and real child behavior tests. |
| ac | yes | AC1/AC2 retained verbatim; actual decision adapter/validators plus author child tests observe degradation and repeated pause. |
| decisions | yes | Manual no-judge receipt supported; model default does not masquerade as recommendation; orchestration ownership closed. |
| dependencies | yes | Consumes 0299/0300 selection; 0302 owns root barrier/cancel; 0303 owns entry continuation and Board projection. |
| premises | yes | Read decision evidence limit/exit and persistence semantics; child topology probe is supporting evidence, not cancellation proof. |

Corrections:

- Decision outputs treated as trustworthy recommendation files → catalog run may exit 0 on a default/error outcome and bounds evidence to 2000 chars → validate raw result, source and bound candidates and write files explicitly.
- Child workflow name/receipt unspecified → freeze kk-itc-author.yaml, parent-derived run identity and completion envelope → same child is continued through every pause.
- Parent graph ownership overlapped 0302 → 0301 owns child FSM and decision stages, 0302 owns parent barrier/cancellation → freeze the handoff without transferring the parent graph.
- Earlier marker probe implied broader readiness → the probe verifies pause order only → require real CLI fixture tests for child content receipts, judgment and cancellation integration.

Current-tree anchors: `plugins/kk/scripts/itc-stages.ts:94`, `plugins/kk/workflows/kk-itc.yaml:90`, `plugins/kk/decisions/kk-items.yaml:18`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:493`, `apps/cli/src/board/itc.ts:200`.

Planning digest (Spur computePlanningDigest): `677dcb2d4554746a8243b66e45dc39d73369fa8bc86467589d2bf041b4abf367`.

## 0302 — Dispatch ITC targets with isolated payloads and recoverable receipts

Issue triage: R1 valid, R2 valid, R3 valid, R4 valid, R5 valid, R6 valid, R7 valid. No issue-specific requirement or scenario was removed. False design assumptions were corrected below; work owned by another task is an explicit handoff.

| Checklist ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | All seven R-items remain valid; typed SEO handoff has no G9 runtime execution dependency. |
| design | yes | Frozen DAG joins, per-target plan/payload/receipt, explicit safe retry subset, raw Result metadata evidence and SEO URL eligibility. |
| plan | yes | Ordered R1–R7 steps cover probe, payload/dispatch, receipts/recovery, reconciliation, DAG topology/cancellation and SEO packets. |
| ac | yes | AC1–AC7 retained verbatim; actual executor fixture plugins and isolated real Spur tests observe behavior; models alone stubbed. |
| decisions | yes | Successful draft invocation is not live proof; unknown effects refuse replay; G9 owns provider analysis/audits. |
| dependencies | yes | Consumes 0298 plan, 0300 selectors and 0301 child receipts; calls 0299 settlement; leaves explicit-input root for 0303 config integration. |
| premises | yes | Read fanout.dispatchOne/selected retry behavior, Result.target labels and composed Zenn URLs; require failed-metadata round-trip and real cancellation tests. |

Corrections:

- Aggregate status published implied live publication → fan-out uses published for any successful Result, including drafts → bind mode separately and never infer a live page from status alone.
- Result.target equaled plugin selector → plugins use channel names while aggregates use requested plugin names → reconcile plugin identities from aggregate/receipt, preserving inner channel identity separately.
- Safe failures could already be retried from all prior failure rows → selectRetryTargets selects every failed row and drops uncertainty distinctions → classify conservatively and pass only the explicit safe subset to --retry-from.
- Uncertain/effect metadata survived failures → dispatchOne currently drops failed Result.metadata → preserve validated failure metadata at that shared seam if structured delivery evidence is used; test the real carry-forward path.
- Shared variant metadata and browser cursor were sufficient → target-specific bindings and global serialization are required → emit isolated payload groups and replace the cursor with executor dispatch.
- SEO URL handoff could trust any successful URL → Zenn can compose a URL and draft saves also return URLs → export only explicitly verified public URL evidence; otherwise mark not-assessed.

Current-tree anchors: `plugins/kk/scripts/itc-stages.ts:130`, `plugins/kk/scripts/itc-stages.ts:425`, `apps/cli/src/fanout.ts:94`, `apps/cli/src/fanout.ts:193`, `apps/cli/src/commands/bot.ts:71`, `packages/kk-core/src/schemas.ts:43`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:493`.

Planning digest (Spur computePlanningDigest): `39c4a9febc8fbfa0b79c91e6c92d2ab41dcc94f94df38dd08e1fded3e94e4be7`.

## 0303 — Keep ITC entry and Board contracts compatible across the refactor

Issue triage: R1 valid, R2 valid, R3 valid, R4 valid, R5 valid. No issue-specific requirement or scenario was removed. False design assumptions were corrected below; work owned by another task is an explicit handoff.

| Checklist ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | All five R-items remain valid; legacy authoring/artifacts preserved with ITC-only strict config and layout. |
| design | yes | Frozen itc-config/prepare, two-phase options/workspace allocation, argv/auto precedence, lock/force/resume semantics and authorized Board child reads. |
| plan | yes | Ordered R1–R5 steps cover config/options, allocation/ownership, entry assembly, Board and installed consumer behavior. |
| ac | yes | AC1–AC5 retained verbatim; actual config/argv/native prepare, Board evidence and packaged-consumer tests observe behavior. |
| decisions | yes | Missing ITC config read-only defaults; explicit flags and launch-auto policy frozen; ambient Board root may revoke previews. |
| dependencies | yes | Consumes every upstream native/helper/child/DAG contract; owns final entry/Board/config integration without backward dependencies. |
| premises | yes | Read config-path resolver versus CLI metadata-only config.ts, daily fallback, workflow entry behavior, Board progress/action producers and settings whitelist; preserve unrelated workflow semantics. |

Corrections:

- A canonical strict config resolver already existed → config.ts is only CLI version metadata and daily resolver falls back silently → add an ITC-specific strict resolver reusing config path/home conventions without changing other workflows.
- Missing config behavior was consistent → workflow-run documents create-on-first-run while the new design uses read-only defaults → freeze ITC missing-config behavior and update only its profile/affected tests.
- Config defaults should override --auto even at lower priority → --auto is an explicit launch policy → explicit per-option flags win, then auto defaults, then env/config/compiled values for those implied options.
- Board could keep reading only the parent FSM progress → ITC root becomes a DAG and revision visits live in the child → authorize child identity/digest before reading progress; unknown evidence stays null.
- Force/resume policy was underspecified → existing prepare resets counters and can reuse artifacts → validate first, acquire workspace ownership, preserve send receipts and require fresh run identity for force.
- Installed entry/argv tests were only source-text pins → command currently emits shell/JSON snippets → test real native option and workspace resolution with literal metacharacters and packaged paths.
- Frozen workspace root equaled current Board authority → ambient trusted-root changes can revoke preview authorization → keep original resume path without broadening Board trust; show unavailable previews.

Current-tree anchors: `apps/cli/src/invoke.ts:52`, `apps/cli/src/commands/daily.ts:105`, `plugins/kk/commands/workflow-run.md:189`, `plugins/kk/scripts/kk-workflow-stages.ts:732`, `apps/cli/src/board/itc.ts:200`, `apps/cli/src/board/reader.ts:355`, `apps/cli/src/board/manifest.ts:67`, `apps/cli/src/commands/stage.ts:40`.

Planning digest (Spur computePlanningDigest): `1ef6cb940d10e03e2ac29b150494f7adcd2a670ed887390b453222db0bb91194`.

## Cross-task proposals

- Retain six tasks: shared files are complementary ownership seams, not duplicate root causes.
- Keep 0298 dispatcher/types first and 0299 intake before 0300 presets; expose explicit input contracts until 0303 config integration.
- Sequence 0301 child receipts before 0302 parent DAG, then 0303 entry/Board integration. All tasks already belong to G21; no merge, cancellation or relink proposed.

## Verification and limits

All six projected `spur task check <wbs> --as todo --json` checks pass after writes. Every section/dependency mutation used Spur CLI and had a pre-write projected check. Requirements and AC bodies were compared byte-for-byte after trimming section boundaries; priority, estimate and feature ownership were checked unchanged. All seven ready checklist rows above are the inline audit, not a production verification verdict.

Final feature inventory/rule/whitespace results are recorded below. Feature implementation scenarios are expected to remain unverified. Full lint, build and product tests were not run for this task-contract-only refinement. Product code, published assets and remote side effects are unchanged; cancellation/crash and packaged integration tests are requirements for implementation, not claimed results from this audit.

Machine evidence is under `.spur/run/g21-refineall-d756b6e6-c18d-4219-aad4-6b6e1b451dd6/`: frozen membership, before/after task captures, pre-write checks, CLI write events, final checks and batch-report.json. These scratch artifacts are local/gitignored; this report and the task contracts retain the durable decisions. Previous ready snapshots have old planning digests and must not authorize execution after this refinement.

Final checks:

- Six task projected checks: PASS; no missing sections or findings.
- Feature inventory: PASS; 18 linked scenarios. Its 18 `L4.scenario-unverified` warnings are expected before implementation and are not a feature verification PASS.
- Recommended pre-check: 59 rules, zero errors. One pre-existing `require-corresponding-test` warning for `packages/kk-core/src/thread-segmentation.ts` remains outside G21.
- `git diff --check`: PASS. Only the six task contracts, shared ITC design and this report changed; no commits or external side effects.
