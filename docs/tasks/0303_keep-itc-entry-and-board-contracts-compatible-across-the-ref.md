---
schema_version: 1
name: Keep ITC entry and Board contracts compatible across the refactor
status: done
template: feature-impl
created_at: 2026-10-15T21:59:21.907Z
updated_at: "2026-10-18T06:29:17.328Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 10

dependencies: ["0298", "0299", "0300", "0301", "0302"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0303-verdict.json
---

## 0303. Keep ITC entry and Board contracts compatible across the refactor

### Background

The command documents ASCII ITC workspace slugs and config precedence, while current resolveWorksDir silently falls back on malformed config and ITC Board producer/revision readers assume a single FSM. Freeze ITC-specific configuration and migrate the reader to verified parent/child evidence.

Implements feature G21 scenarios: R1 — Existing authoring inputs keep their observable behavior; R12 — Entry surfaces and artifacts remain consistent.
Also implements G21 R14 — ITC workspace follows configured topic and optional date.
Also implements G21 R15 — Invalid ITC configuration stops before mutation.
Also implements G21 R18 — Resume retains the original effective configuration.

Current-tree premises: apps/cli/src/invoke.ts:52; apps/cli/src/commands/daily.ts:105; plugins/kk/commands/workflow-run.md:189; plugins/kk/scripts/kk-workflow-stages.ts:732; apps/cli/src/board/itc.ts:200; apps/cli/src/board/reader.ts:355; apps/cli/src/board/manifest.ts:67; apps/cli/src/commands/stage.ts:40. These claims were checked against source, not inferred from old status or scratch reports.

Every mapped issue remains valid; no requirement/scenario is dropped or renumbered. Config/workspace code is owned by 0303, child authoring by 0301, root DAG/publication by 0302, capabilities by 0298, topic/store intake by 0299 and presets by 0300.

Concurrency: main-tree wip task query was empty at kickoff. Worktree knowledge-kit-runall-0288-0297-6c4167 has unmerged shipinhao-pub, bun.lock and task0296 changes. No confirmed same-file source overlap is present, but do not enumerate its unpublished plugin or consume its lockfile; recheck source ownership before execution.



**Refine corrections (2026-10-15)**
- A canonical strict config resolver already existed → config.ts is only CLI version metadata and daily resolver falls back silently → add an ITC-specific strict resolver reusing config path/home conventions without changing other workflows.
- Missing config behavior was consistent → workflow-run documents create-on-first-run while the new design uses read-only defaults → freeze ITC missing-config behavior and update only its profile/affected tests.
- Config defaults should override --auto even at lower priority → --auto is an explicit launch policy → explicit per-option flags win, then auto defaults, then env/config/compiled values for those implied options.
- Board could keep reading only the parent FSM progress → ITC root becomes a DAG and revision visits live in the child → authorize child identity/digest before reading progress; unknown evidence stays null.
- Force/resume policy was underspecified → existing prepare resets counters and can reuse artifacts → validate first, acquire workspace ownership, preserve send receipts and require fresh run identity for force.
- Installed entry/argv tests were only source-text pins → command currently emits shell/JSON snippets → test real native option and workspace resolution with literal metacharacters and packaged paths.

- Frozen workspace root equaled current Board authority → ambient trusted-root changes can revoke preview authorization → keep original resume path without broadening Board trust; show unavailable previews.

### Requirements

- [x] R1. Existing authoring inputs keep their observable behavior; it produces the existing draft and Board artifact paths without collection, image spending or publication.
- [x] R2. Entry surfaces and artifacts remain consistent; values remain data, existing aliases and artifacts stay usable, and command documentation describes the implemented surface.
- [x] R3. ITC workspace follows configured topic and optional date; the default path is .works/kk-itc/reliable-workflows and an explicit valid date adds YYYYMMDD while a full directory override wins.
- [x] R4. Invalid ITC configuration stops before mutation; it reports the key or file error without writing workspaces or exposing secret values.
- [x] R5. Resume retains the original effective configuration; it uses the original resolved values and digests or refuses mismatched evidence without silently changing directories or publication intent.

### Acceptance Criteria

```gherkin
Feature: Keep ITC entry and Board contracts compatible across the refactor

  Scenario: AC1 — Existing authoring inputs keep their observable behavior (req: R1)
    Given an existing direct topic or input file with default publication settings
    When kk-itc runs
    Then it produces the existing draft and Board artifact paths without collection, image spending or publication

  Scenario: AC2 — Entry surfaces and artifacts remain consistent (req: R2)
    Given the installed workflow runner, CLI stage entry and Board ITC reader
    When compatibility checks exercise new options and paths containing shell metacharacters
    Then values remain data, existing aliases and artifacts stay usable, and command documentation describes the implemented surface
  Scenario: AC3 — ITC workspace follows configured topic and optional date (req: R3)
    Given works_dir configured as .works and an ITC topic named reliable-workflows
    When workspace allocation runs
    Then the default path is .works/kk-itc/reliable-workflows and an explicit valid date adds YYYYMMDD while a full directory override wins

  Scenario: AC4 — Invalid ITC configuration stops before mutation (req: R4)
    Given an existing config with malformed YAML, an unreadable file or a wrong-typed ITC setting
    When ITC configuration resolves
    Then it reports the key or file error without writing workspaces or exposing secret values

  Scenario: AC5 — Resume retains the original effective configuration (req: R5)
    Given a persisted run with frozen workspace, date, locale, preset and mode whose ambient config later changes
    When the workflow resumes
    Then it uses the original resolved values and digests or refuses mismatched evidence without silently changing directories or publication intent

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T22:49:54.903Z

- Closed: ITC missing config uses read-only defaults; other workflow create-on-first-run behavior is untouched. Explicit --auto outranks config defaults for implied options, while explicit per-option flags win. New allocation/config behavior is assembled in 0303, after all explicit-input helpers work.
- Closed: no live accounts or paid generation are needed for acceptance; provider/model calls use deterministic fixtures.
- Deferred with owner: G9 owns actual SEO draft analysis and public-URL audit execution; G21 exports typed handoffs only.

### Design

WHAT/WHERE: add apps/cli/src/itc-config.ts with resolveItcOptions(input:ItcLaunchInput,context):Promise<ItcEffectiveOptions> and resolveItcWorkspace(options,topic):ItcWorkspace; expose native stage itc-prepare --request <launch.json> through 0298's dispatcher. Keep existing prepare-itc positional spelling as a compatibility path for valid existing callers. Update only KK ITC entry/config, its native stage and associated Board consumers; do not silently change daily/storm/podcast defaults or their existing resolver. Earlier 0298–0302 helpers take explicit inputs and already function without this resolver; this task composes them into the standard entry.

Config path is KK_CONFIG or resolveKkConfigPath(); missing file uses compiled defaults and ITC does not create/rewrite it. Existing malformed/unreadable/wrong-typed declared fields fail before mkdir/counter writes. Preserve unrelated config keys; validate workflows.kk-itc strictly. Declared fields are writer,itc-generating|topic; playbook,generic|english|wechat; source_locale,en|zh|ja; research/judge/unslop/auto booleans; max_revisions integer 0..10; topic_profile and publish_preset optional safe slugs; workspace:{dated:boolean}; seo:{mode:'off'|'handoff'}. Existing global defaults maxResults/fixture stay unrelated and are not remapped to ITC. Root works_dir/workflows_dir remain existing top-level paths. No live/spend default is added to config.

Precedence: explicit per-option launch flag > --auto implied defaults (research/judge/unslop=true only when not explicitly supplied) > existing declared env overrides > workflows.kk-itc > applicable global defaults > compiled defaults. When auto=true comes only from config, explicitly configured per-option research/judge/unslop values win; the auto policy fills only omitted config values. Explicit per-option launch flags always win. --playbook wechat implies zh only if no explicit source locale; freeze the effective result. Only KK_CONFIG/KK_WORKS_DIR and existing workflow/package resolution envs are read; no invented per-setting env namespace. Input source remains exactly one of topic,input_file,from_collect. Added ITC flags are --from-collect <slug>, --refresh-collect, --topic-profile <slug>, --publish-preset <slug>, --run-date YYYYMMDD and --seo off|handoff; keep all current flags/aliases. Distinguish absence from an explicit false/empty value.

Two-phase allocation is explicit: resolveItcOptions validates and freezes defaults before collected-topic ideation; status=intake has workDir:null and no topicName. resolveItcWorkspace finalizes the validated selected topic, producing status=prepared with an absolute workDir before workspace initialization. Resume of intake uses its frozen defaults and the same candidate identity; it never rereads changed config. The prepared ItcEffectiveOptions JSON is versioned, contains only declared non-secret values, parentRunId, launchProjectRoot, absolute worksRoot/workDir, topicName/displayTitle, frozen launch instant/timezone/date, optionsDigest and the planned child/selection references. Config relative works_dir resolves against config-directory; an explicit relative --dir resolves against launch cwd. Expand only ~/$HOME prefixes, never shell code. Default path is worksRoot/kk-itc/topicName, with YYYYMMDD when workspace.dated or explicit --run-date requests it. Validate the real calendar date; resume reads its saved options snapshot and does not re-resolve ambient config. Existing ASCII slug algorithm stays stable; normalize Unicode NFC, lowercase and collapse non-letter/number separators for added non-English names; reject empty, . or .., separators/control/NUL input that would escape the root. No random path suffix or new global config root.

Prepare validates source/config/options and paths before any mutation, then uses the existing kk lock acquire/release seam keyed by SHA-256 of canonical workDir and parentRunId. Persist ownership; concurrent different run IDs refuse. Refuse nonempty workspace on a fresh run unless --force. Force is a fresh parent/child identity and resets only run-owned authoring staging after preserving prior evidence; if send receipts exist, require explicit reconciliation/fresh separate directory rather than deleting or reusing them. Resume requires the same owner/options/digests. Release on known terminal completion; abrupt termination leaves a recoverable owner/lease identity. Keep Board capture under the current authoritative configured trusted root and preserve marker/digest checks. A resumed snapshot never expands Board trust: if ambient config moved that root, the run may retain its original directory while Board previews correctly become unavailable until trust is restored explicitly.

BOARD HANDOFF: root DAG producers use action rows from existing /api/runs/<id>; author artifacts and revision visits use /api/runs/<childId>/progress only after author-run.json and child completion/capture evidence bind parent ID, workspace and executed child definition digest. Never read an arbitrary file-provided child ID, synthesize parent state visits or trust mutable counter files. Missing/mismatched child evidence yields unavailable previews and null revision counts, not zero. Keep historical FSM captures readable and add fields without changing existing public filenames/outcome enums. Update manifest.ts settings whitelist for new options, reader.ts producer authority, itc.ts projection, and apps/board/src/itc UI only as needed to display existing types honestly.

TEST OBSERVABILITY: apps/cli/tests/itc-config.test.ts (new) and workflow-run-command.test.ts prove R2–R5 with actual option/config/path helpers, temporary home/config/project trees, Unicode/metacharacters, precedence/auto overrides, malformed config no-write, occupied workspace, force receipts and midnight/ambient-config resume. apps/cli/tests/board/itc.test.ts and reader.test.ts prove R1/R2 historical FSM plus DAG/child counts and identity refusal using recorded trace fixtures. apps/cli/tests/kk-itc-installed.test.ts (new) packs/runs the actual stage entry in an isolated consumer without ancestor workspace modules, uses fixture child/transport outputs and checks config root, preset assets and aliases. Update only ITC source pins whose former behavior changed; retain other workflow tests. Synchronize docs/00–05, design satellites and relevant AGENTS facts as each implemented surface ships, never mark planned behavior shipped during refine.

Use ADR-040 as amended and docs/design/kk-itc-refactor.md. Native application handlers may import @gobing-ai/*; shipped plugins/kk/scripts remain builtin-only (ADR-018). No new package, dependency, engine, plugin kind, live login, crawler or image spending. Source edits and behavior tests belong to implementation, not this refine. Keep task metadata priority/estimate values unchanged. Test model/network boundaries with fixtures; never mock the parser, dispatcher or receipt validation being asserted. Step 0: verify pinned Bun and selected Spur path, installed assets and frozen upstream interfaces. Do not rely on a sibling worktree's unmerged files.

Execution budget: existing estimate 10h; one task pipeline with bounded repairs. Preserve partial work and task-run diagnostics on failure; meaningful code/test diff required when implementing. G21 dependencies remain the frozen WBS edges; this ready audit does not authorize implementation or merging tasks.

### Plan

1. (R2, R3, R4, R5) Implement typed strict ITC config/argv resolver and immutable effective-options snapshot with explicit auto policy.
2. (R3, R4, R5) Validate source/path/date before writes, compose the standard workspace and protect ownership/receipts on force/resume.
3. (R1, R2) Bind DAG parent and author child producer evidence in Board while retaining historical FSM rendering.
4. (R1–R5) Exercise actual config/argv/native stage plus packaged-consumer and Board fixtures; synchronize ITC-specific docs/settings.
5. Run changed-scope checks during iteration; use the implementation pipeline for full lint/test/build/rules, independent review and requirement verification. Preserve diagnostics and update owned surface docs.

### Solution

- `apps/cli/src/itc-config.ts:214`: `readItcConfigBlock` strictly validates `workflows.kk-itc` — a missing file is an empty block, while malformed YAML, an unknown declared key or a wrong-typed value throws `ItcConfigInvalidError` naming the key or file and never the value.
- `apps/cli/src/itc-config.ts:422`: `resolveItcOptions` freezes the versioned effective options with the declared precedence (explicit per-option flag > `--auto` implied default > declared env override > `workflows.kk-itc` > compiled default), distinguishes absent from explicit `false`, implies `zh` for `--playbook wechat` only without an explicit locale, and reports a collected-topic source as `status: 'intake'` with `workDir: null`.
- `apps/cli/src/itc-config.ts:582`: `resolveItcWorkspace` composes `<worksRoot>/kk-itc/<slug>` with `YYYYMMDD` appended when dated, honours a full `--dir` override, and only expands a leading `~`.
- `apps/cli/src/itc-config.ts:168`: `slugifyTopicName` normalizes NFC, lowercases and collapses separators for non-English names while rejecting path separators, control characters and `.`/`..` so a name can never escape the composed leaf.
- `apps/cli/src/itc-config.ts:375`: `parseRunDate` accepts only a real calendar `YYYYMMDD`.
- `apps/cli/src/itc-config.ts:197`: `digestItcOptions` hashes canonical recursively-key-sorted JSON so the frozen snapshot digest never depends on insertion order.
- `apps/cli/src/itc-stage.ts:61`: routed the native `itc-prepare` stage through the ITC dispatcher; it validates before any mkdir and verifies an existing snapshot (`verifyItcOptionsSnapshot`, `apps/cli/src/itc-config.ts:640`) so a changed ambient config refuses the resume instead of silently moving the workspace.
- `apps/cli/src/board/itc.ts:234`: `authorizeItcChild` accepts child evidence only when `author-run.json` binds the parent run id, the expected `<parentRunId>-author` child id and the executed definition digest; a file-provided child id alone is never trusted.
- `apps/cli/src/board/itc.ts:264`: `revisionUsageFromChild` reads the authorized child's recorded visits and falls back to the parent's own `states[]` projection for historical single-FSM captures; missing or mismatched evidence yields null counts and a `board.itc.child-unverified` diagnostic, never zero.
- `apps/cli/src/board/manifest.ts:73`: extended the kk-itc setting allowlist (`writer`/`playbook`/`publish_preset`/`topic_profile`/`publish_targets`/`seo`) so a run's effective configuration stays inspectable.
- `apps/cli/tests/itc-config.test.ts:47`: proves R4 (missing/malformed/wrong-typed config, key-not-value error text, unrelated keys preserved), R3 (default/dated/override/relative-works-dir paths and slug safety), R5 (auto precedence, absent-vs-false, resume refusal on changed config) and R2 (the `itc-prepare` stage writes the frozen snapshot under the configured works root).
- `apps/cli/tests/board/itc.test.ts:548`: proves child authorization, the child-versus-parent revision counts and the historical single-capture read at unit level.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Existing direct-topic and input-file paths produce the same draft/Board artifacts without collection, image spend or publication — `apps/cli/tests/kk-itc-workflow.test.ts` (60 pass / 0 fail across kk-itc-workflow + itc-config + itc-stage this run). |
| R2 | MET | Entry surfaces and artifacts stay consistent, shell metacharacters stay data — `apps/cli/tests/kk-itc-dag.test.ts:286` direct launch freezes via itc-prepare (23 pass / 0 fail with itc-decision this run); entry doc `plugins/kk/commands/workflow-run.md:191`. |
| R3 | MET | Default `.works/kk-itc/<topic>`, explicit valid date adds YYYYMMDD, full override wins — `apps/cli/tests/itc-config.test.ts:113`. |
| R4 | MET | Malformed YAML/unreadable/wrong-typed config reports the key/file error without writing workspaces — `apps/cli/tests/itc-config.test.ts:61` ("No config file was created"). |
| R5 | MET | Resume uses the original frozen values/digests and refuses mismatched evidence — `apps/cli/tests/itc-config.test.ts:237`, `apps/cli/tests/itc-config.test.ts:299`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Existing authoring inputs keep their observable behavior | MET | test | `apps/cli/tests/kk-itc-workflow.test.ts` 60 pass / 0 fail (bun test, this run, 3 files). |
| R12 — Entry surfaces and artifacts remain consistent | MET | test | `apps/cli/tests/kk-itc-dag.test.ts:286`, `apps/cli/tests/kk-itc-dag.test.ts:310`, `apps/cli/tests/kk-itc-dag.test.ts:322` (23 pass / 0 fail this run). |
| R14 — ITC workspace follows configured topic and optional date | MET | test | `apps/cli/tests/itc-config.test.ts:113`, `apps/cli/tests/itc-config.test.ts:122`, `apps/cli/tests/itc-config.test.ts:143`. |
| R15 — Invalid ITC configuration stops before mutation | MET | test | `apps/cli/tests/itc-config.test.ts:61`, `apps/cli/tests/itc-config.test.ts:71`, `apps/cli/tests/itc-config.test.ts:327`. |
| R18 — Resume retains the original effective configuration | MET | test | `apps/cli/tests/itc-config.test.ts:237`, `apps/cli/tests/itc-config.test.ts:299`, `apps/cli/tests/kk-itc-dag.test.ts:301`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0303
**Scope:** Keep ITC entry and Board contracts compatible across the refactor
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 | correctness | `resolveItcOptions` freezes `parentRunId` from the launch input; 0302's `itcSendTargets` still hard-codes `itc-parent` in receipts and the settlement call. The two must be threaded together before a real DAG run can reconcile a selection for the right run. | `apps/cli/src/itc-config.ts:422` | RESOLVED — closed by cfb2e0cf: receipts read `parentRunId` from the frozen options snapshot (`apps/cli/src/itc-publish.ts:397`, `apps/cli/src/itc-publish.ts:527`); the DAG passes the real run id (`plugins/kk/workflows/kk-itc.yaml:53`); no `itc-parent` literal remains. |
| 2 | P2 | correctness | The Board HTTP route does not yet fetch `/api/runs/<childId>/progress`, so `projectItcResults`' `child` input is unused in production and revision counts fall back to nulls for every DAG run. The authorization gate is correct; the wiring is not shipped. | `apps/cli/src/board/reader.ts:355` | RESOLVED — re-verified 2026-10-17 (0303 re-audit): the reader fetches the progress projection (`apps/cli/src/board/reader.ts:385`) and derives producer state from recorded `actionKey`s (`apps/cli/src/board/reader.ts:149`). |
| 3 | P3 (advisory) | usability | `itc-prepare` prints the frozen options JSON on stdout; a large snapshot is noisy for an operator. Acceptable — the stage's consumer is a workflow step, not a human. | `apps/cli/src/itc-stage.ts:61` | RESOLVED — wontfix by design: the stage's consumer is a workflow step, not a human; the frozen snapshot on stdout is the machine handoff. |
| 4 | P4 | efficiency | `readItcConfigBlock` parses the config file twice (block + `works_dir`). Two reads of one small file per launch; not worth a shared parse. | `apps/cli/src/itc-config.ts:214` | ACCEPTED |

### References

- Feature G21 and docs/design/kk-itc-refactor.md (ADR-040 amendment).
- Source premises: apps/cli/src/invoke.ts:52; apps/cli/src/commands/daily.ts:105; plugins/kk/commands/workflow-run.md:189; plugins/kk/scripts/kk-workflow-stages.ts:732; apps/cli/src/board/itc.ts:200; apps/cli/src/board/reader.ts:355; apps/cli/src/board/manifest.ts:67; apps/cli/src/commands/stage.ts:40.
- Batch audit: docs/plans/2026-10-15-g21-refineall-ready.md.

### History

- 2026-10-16T01:30:28.749Z todo → wip (system)
- 2026-10-16T01:30:29.337Z wip → testing (system)
- 2026-10-16T01:30:29.988Z testing → done (system)

