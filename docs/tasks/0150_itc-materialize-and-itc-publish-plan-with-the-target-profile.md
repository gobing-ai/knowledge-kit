---
schema_version: 1
name: itc-materialize and itc-publish-plan with the target profile table
status: todo
template: feature-impl
created_at: 2026-09-22T16:46:32.546Z
updated_at: "2026-09-22T16:51:22.502Z"
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

- [ ] R1. `kk stage itc-materialize <work_dir> <publish_live>` writes `4-publish/content.json`:
  - `title` comes from the first H1, which is removed from `body`.
  - `outline` comes from `2-outline/outline-approved.md`.
  - `references[]` comes from `docs.json` when present.
  - `metadata.coverImage` comes from `4-illustrations/cover.*` when present.
  - tags, keywords and description come from the brief frontmatter when present.
  - `metadata.published` is always written as a boolean.
- [ ] R2. itc-materialize exits 1 with a message naming the artifact when the draft is missing, has no H1, or has an empty body.
- [ ] R3. The `TARGET_PROFILES` const implements the `docs/design/kk-itc-end-to-end.md` §5 table. Before its row lands, each row's draft/live key is checked against that plugin's `src/`, with `file:line` cited in Solution. This covers the browser plugins (juejin, infoq, substack, xhs) and the wechatmp live `operation`. A plugin whose draft switch cannot be confirmed is left out of the table.
- [ ] R4. `kk stage itc-publish-plan <work_dir> <targets> <source_locale> <publish_live>` writes `4-publish/publish-plan.json` `{live, sourceLocale, variants, fanout, browser}`:
  - Targets on the source-locale article profile share `content.json`, with `adapt:false`.
  - Every other profile gets one `content.<variant>.json` with `adapt:true`.
  - Each variant carries `switches`: the union of its targets' draft/live keys.
- [ ] R5. itc-publish-plan exits 1, naming the target, for:
  - an unknown target
  - `podcast-pub`
  - `x-pub` when `publish_live` is false
  - a target that needs a cover when none exists
- [ ] R6. Unit tests parse the materialized `content.json` with kk-core `ContentSchema`. Stage code stays node-builtin-only (ADR-018).

### Acceptance Criteria

- [ ] AC1 — itc-materialize writes ContentSchema JSON from the final draft
- [ ] AC2 — itc-publish-plan splits targets into fan-out groups and browser targets

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History
