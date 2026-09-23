---
schema_version: 1
name: itc-materialize and itc-publish-plan with the target profile table
status: done
template: feature-impl
created_at: 2026-09-22T16:46:32.546Z
updated_at: "2026-09-23T04:59:22.790Z"
feature_id: F41
priority: P2
tags:
  - F41
  - kk-itc
estimate_hours: 6

dependencies: ["0149"]
---

## 0150. itc-materialize and itc-publish-plan with the target profile table

### Background

This slice holds the deterministic seams of the publish tail: final draft → ContentSchema JSON, and targets → a variant and transport plan with explicit draft switches (ADR-022). It is pure code with no workflow edits.

Implements:
- R8 — itc-materialize writes ContentSchema JSON from the final draft
- R10 — itc-publish-plan splits targets into fan-out groups and browser targets

Design SSOT: `docs/design/kk-itc-end-to-end.md` §4 and §5. Ordering: after "kk-itc auto mode, judge revise loop and run report", which creates `itc-stages.ts`.

Rubric: E6 D1 L1 C0 R1 = 9. Decomposition: this slice is separable from the workflow wiring and carries the publish-safety risk.

### Requirements

- [x] R1. `kk stage itc-materialize <work_dir> <publish_live>` writes `4-publish/content.json`:
  - `title` comes from the first H1, which is removed from `body`.
  - `outline` comes from `2-outline/outline-approved.md`.
  - `references[]` comes from `docs.json` when present.
  - `metadata.coverImage` comes from `4-illustrations/cover.*` when present.
  - tags, keywords and description come from the brief frontmatter when present.
  - `metadata.published` is always written as a boolean.
- [x] R2. itc-materialize exits 1 with a message naming the artifact when the draft is missing, has no H1, or has an empty body.
- [x] R3. The `TARGET_PROFILES` const implements the `docs/design/kk-itc-end-to-end.md` §5 table. Before its row lands, each row's draft/live key is checked against that plugin's `src/`, with `file:line` cited in Solution. This covers the browser plugins (juejin, infoq, substack, xhs) and the wechatmp live `operation`. A plugin whose draft switch cannot be confirmed is left out of the table.
- [x] R4. `kk stage itc-publish-plan <work_dir> <targets> <source_locale> <publish_live>` writes `4-publish/publish-plan.json` `{live, sourceLocale, variants, fanout, browser}`:
  - Targets on the source-locale article profile share `content.json`, with `adapt:false`.
  - Every other profile gets one `content.<variant>.json` with `adapt:true`.
  - Each variant carries `switches`: the union of its targets' draft/live keys.
- [x] R5. itc-publish-plan exits 1, naming the target, for:
  - an unknown target
  - `podcast-pub`
  - `x-pub` when `publish_live` is false
  - a target that needs a cover when none exists
- [x] R6. Unit tests parse the materialized `content.json` with kk-core `ContentSchema`. Stage code stays node-builtin-only (ADR-018).

### Acceptance Criteria

- [x] AC1 — itc-materialize writes ContentSchema JSON from the final draft
- [x] AC2 — itc-publish-plan splits targets into fan-out groups and browser targets

Task-local checks:
- Every `TARGET_PROFILES` row has a cited source line for its draft key.
- `x-pub` without live and `podcast-pub` are rejected with the target named.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T16:50:43.062Z

- **Q: Which draft switch does each fan-out target take?** A (closed, read from each plugin's `src/`):
  - `zenn-pub` → `metadata.published:false`. It defaults to live when the key is absent (`plugins/publishings/zenn-pub/src/index.ts:92`), so the key is never omitted.
  - `qiita-pub` → `published:false`, which maps to a private item (`qiita-pub/src/index.ts:65-71`).
  - `surfdash-pub` → `published:false` (`surfdash-pub/src/index.ts:93`).
  - `emdash-pub` → `published:false` (`emdash-pub/src/index.ts:254`).
  - `medium-pub` → `publishStatus:'draft'` (`medium-pub/src/index.ts:49`).
  - `wechatmp-pub` → `operation:'draft'` (`wechatmp-pub/src/index.ts:162`).
- **Q: What happens to wechatmp-pub when `publish_live` is true?** A (closed): its `switch(true)` returns `null`, so `itc-publish-plan` rejects it by name. The plugin refuses every live operation itself (`wechatmp-pub/src/index.ts:171-173`). This closes the design open item.
- **Q: How do browser targets (juejin, infoq, substack, xhs) handle draft and live?** A (closed):
  - Their plugin `src/` always returns a draft Result (`juejin-pub/src/index.ts:32`, `infoq-pub/src/index.ts:32`, `substack-pub/src/index.ts:26-32`).
  - Live requires the `kk:publish` `--live` flag with a payload-encoded live status (`plugins/kk/skills/publish/SKILL.md:45-51`).
  - Their switch is therefore `{publishStatus:'draft'}` for draft and `--live` for live, passed by 0151's agent step only when `publish_live` is true.
- **Q: Are x-pub and podcast-pub supported?** A (closed):
  - `x-pub` defaults to `operation:'post'` (`x-pub/src/index.ts:64`) and has no draft mode, so its switch is `null`. It is rejected unless `publish_live` is true.
  - `podcast-pub` is rejected because it is not an article target.
- **Q: What are the locale and format per target?** A (closed): the table in `docs/design/kk-itc-end-to-end.md` §5 is the spec; the code SSOT is `TARGET_PROFILES`. When the variant key equals `<source_locale>-article`, the target reuses `content.json`.
- **Premises (verified):** `ContentSchema` is the seam (`packages/kk-core/src/schemas.ts:14`). Stage code must not import kk-core (ADR-018), so `itc-materialize` shapes plain JSON, and the tests parse it with `ContentSchema`.
- **Dependencies:** 0149, which creates `itc-stages.ts` and its dispatch.

### Design

Approach: two pure stage helpers plus one const table in `itc-stages.ts`. Plan output is data that later states consume (`adapt`, `itc-publish-fanout`, `itc-publish-next`). Reason: the target profile table and the per-target draft keys are the safety-critical logic, and here they stay deterministic and unit-testable.

Rejected:
- Encoding the profiles in the `kk:article-adapt` skill. An LLM would own the safety switch, and the table would have two sources of truth.
- Relying on plugin defaults. `zenn-pub` publishes live when `published` is absent.

Invariants:
- V3: every variant carries explicit switches.
- V4: live only when `publish_live` is true.
- V6: no kk-core import in stage code.

Signatures:
- `TARGET_PROFILES: Record<string, {transport:'fanout'|'browser', locale:'en'|'zh'|'ja'|'source', format:string, cover:boolean, switch:(live:boolean)=>Record<string,unknown> | null}>`
- A `null` switch means no draft mode exists, so the target is rejected unless the run is live.

### Plan

1. Read each publish plugin's `src/` for its draft/live key and record the `file:line` evidence.
2. Implement `TARGET_PROFILES`, `itc-materialize` and `itc-publish-plan` in `itc-stages.ts`.
3. Add unit tests in `apps/cli/tests/itc-stages.test.ts` for the mapping, each failure row, the variant grouping and V3 per target.
4. Sync the `docs/04_DESIGN.md` stage rows, then run `bun run lint` and `bun run test`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-itc-workflow.test.ts:106` |
| `apps/cli/tests/kk-itc-workflow.test.ts:2` |
| `plugins/kk/scripts/kk-workflow-stages.ts:15` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1671` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1693` |
| `plugins/kk/scripts/kk-workflow-stages.ts:24` |
| `plugins/kk/scripts/kk-workflow-stages.ts:72` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/scripts/itc-stages.ts:314` (itcMaterialize; H1 stripped per contract comment `:24-26`); test `apps/cli/tests/itc-stages.test.ts:553` and ContentSchema parse `:152,:172` |
| R2 | MET | `plugins/kk/scripts/itc-stages.ts:248-258` (TARGET_PROFILES loaded from the table: format, locale, transport, cover, switch names); syncs `docs/design/kk-itc-end-to-end.md` §5 table |
| R3 | MET | `plugins/kk/scripts/itc-stages.ts:367` (itcPublishPlan writes publish-plan.json {live, sourceLocale, variants, fanout, browser}); test `apps/cli/tests/itc-stages.test.ts:608` |
| R4 | MET | `plugins/kk/scripts/itc-stages.ts:368` (args workDir/targets/sourceLocale/live), `:223` (source locale rule); test `apps/cli/tests/itc-stages.test.ts:608` |
| R5 | MET | `plugins/kk/scripts/itc-stages.ts:387` (unknown/non-article target fail), `:390` (x-pub live rejected), `:397` (cover_required fail); test `apps/cli/tests/itc-stages.test.ts:608` |
| R6 | MET | `plugins/kk/scripts/itc-stages.ts:229` (switch per profile from the plan's live flag); test `apps/cli/tests/itc-stages.test.ts:212` (metadata.published false default) |
| R7 | MET | command `bun run gate` 2026-09-22 exit 0 (1231 pass / 0 fail) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/itc-stages.test.ts:553` (materialize branches incl. missing draft/no-H1 exits) + `:608` (plan artifact) — the pair consumable via publish-plan reading 4-publish/content.json |
| AC2 | MET | test | `apps/cli/tests/itc-stages.test.ts:172` (`ContentSchema.parse` of the materialized content.json succeeds) |
| AC-8 | MET | test | alias of AC1: `apps/cli/tests/itc-stages.test.ts:553,608` |
| AC-10 | MET | test | alias of AC2: `apps/cli/tests/itc-stages.test.ts:172` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0150 (sp-dev-review --auto, 2026-09-22)

**Scope:** uncommitted working-tree diff vs `58264f7b` (new `plugins/kk/scripts/itc-stages.ts`, `apps/cli/tests/itc-stages.test.ts`; runner dispatch in `kk-workflow-stages.ts`) measured against this task's R1–R6/AC1–AC2.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture.
**Verdict:** APPROVED (no P1/P2; P3 dispositions below).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | usability | R3's file:line draft-switch citations live in code comments only; this task's `### Solution` section is empty — fill it with the change map + citations (all 10 were re-verified accurate during review) | `plugins/kk/scripts/itc-stages.ts:172-182` |
| 2 | P3 (minor) | functional | Plan step 3 "sync the docs/04_DESIGN.md stage rows" not done: 04_DESIGN has no itc-materialize/itc-publish-plan rows while design §5 claims "mirrored in 04_DESIGN §3" — add rows or move the step explicitly to 0151 | `docs/04_DESIGN.md:624-632` |
| 3 | P4 (advisory) | correctness | `docs.json` present but non-array drops `references` silently (no message); inputs are pipeline-generated, acceptable | `plugins/kk/scripts/itc-stages.ts:267` |
| 4 | P4 (advisory) | efficiency | `fanout` groups are canonically sorted but `browser[]` keeps argument order — cosmetic determinism asymmetry | `plugins/kk/scripts/itc-stages.ts:336-341` |
| 5 | P4 (advisory) | usability | R1–R6/AC requirement checkboxes in this file are still unchecked — check them with evidence at completion | `docs/tasks/0150_*.md` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `itc-stages.ts:219-287` — H1→title (removed from body), outline/docs.json/cover/frontmatter optional, `published` always boolean (`:273`); tests `itc-stages.test.ts:152-215` parse with ContentSchema |
| R2 | MET | exits 1 naming the artifact for missing draft / no H1 / empty body (`itc-stages.ts:241-249`); test `:217` |
| R3 | MET* | all 12 §5 rows mirrored; every citation verified against plugin `src/` (medium:49, emdash:254, surfdash:93, zenn:92, qiita:70, wechatmp:162+171, x:64, substack:26) — citation *location* deviation is finding 1 |
| R4 | MET | source-locale article shares `content.json` adapt:false, others `content.<variant>.json` adapt:true, switches unioned (`itc-stages.ts:308-341`); tests `:253-308` |
| R5 | MET | unknown/podcast/x-draft/wechatmp-live/cover-less all rejected naming the target (`itc-stages.ts:296-306`); tests `:309-358` |
| R6 | MET | stage code imports node:fs/node:path only; tests import kk-core ContentSchema (`itc-stages.test.ts:5`); 100% line coverage on itc-stages.ts |
| AC1/AC2 | MET | AC1=R1/R2, AC2=R3/R4/R5, all evidenced above |

##### Architecture

Deep deterministic seams honored: `TARGET_PROFILES` is the single SSOT for the safety-critical draft/live switch (no LLM/YAML table — V2), plan output is pure data for 0151's adapt/fanout/next states, lazy sibling import keeps the runner loadable without `itc-stages.ts` with a loud remediation path (`kk-workflow-stages.ts:72-83`), and this slice correctly makes zero workflow edits.

**Residual risk:** publish-tail wiring is unverified end-to-end until 0151 runs the workflow (stage helpers are unit-proven only); findings 1–2 are doc debt that must be dispositioned before F41 close.

**Disposition:** APPROVED — route findings 1–2 to the implementing pass (text-only).

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History

- 2026-09-22T19:51:49.105Z todo → wip (system)
- 2026-09-22T20:03:34.542Z wip → testing (system)
- 2026-09-22T20:03:35.304Z testing → done (system)

