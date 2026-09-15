---
schema_version: 1
name: Sync docs and help surfaces to the new workflow folder and workspace contract
status: done
template: feature-impl
created_at: 2026-09-14T17:55:18.375Z
updated_at: "2026-09-15T18:32:34.156Z"
feature_id: F8
priority: P2
tags:
  - kk
  - docs
  - design-sync

---

## 0129. Sync docs and help surfaces to the new workflow folder and workspace contract

### Background

Feature F8 extension (R7): surface changes keep `docs/04_DESIGN.md` in the same change (T3 rule). The config table, per-profile default rows, `plugins/kk/config.example.yaml`, and `docs/help/*.md` must state the new resolution chain and per-workflow workspace defaults, or the docs drift from the shipped behavior delivered by 0127 and 0128.

Covers feature F8 scenario: R7 (Docs and content-asserting tests land in the same change).

### Requirements

- [x] R1. `docs/04_DESIGN.md` config table documents the workflows_dir fallback chain (config → bun global → npm global → package-root walk → checkout/compiled default), the resolution-order table gains the global-install rows, and the workflow table's per-profile work_dir column states `$works_dir/<workflow-name>/<run-id>` per profile with the flattened output paths (`3-draft-draft-article.md`, `1-briefing-briefing.md`, `3-script-voicescript.yaml`, `4-audio/*`).
- [x] R2. `plugins/kk/config.example.yaml` gains a header comment mentioning the global-install fallback and per-workflow workspace defaulting (the file is currently two bare keys with no comment).
- [x] R3. `docs/help/storm-topic-research-workflow.md` and `docs/help/solo-podcast-workflow.md` state the new default locations (`$works_dir/kk-storm-research/<topic-id>`, `$works_dir/kk-solo-podcast/<date>`), the corrected resolution chain, the `--dir` default, and the flattened paths.
- [x] R4. The `.works` no-migration limitation is documented where workspace defaults are described.
- [x] R5. After the sibling tasks land, `spur feature check P --strict --json` passes with zero findings.
- [x] R6. Skill artifact contracts match the shipped layout (review drift from 0127/0128): `plugins/kk/skills/audio-authoring/` SKILL.md + references name `1-briefing-briefing.md` and `3-script-voicescript.yaml`; `plugins/kk/skills/topic/` and `plugins/kk/skills/itc-generating/` SKILL.md + references name `3-draft-draft-article.md` (no `3-draft/` dir); `plugins/kk/skills/storm-research/SKILL.md` workflow paths match the shipped kk-storm-research.yaml states.
- [x] R7. `docs/design/kk-solo-podcast.md` and `docs/design/itc-generating.md` no longer name the removed stage directories (`1-briefing/`, `3-script/`, `3-draft/`) as artifact locations.
- [x] R8. `plugins/kk/commands/workflow-run.md` frontmatter `description` mentions the global-install `workflows_dir` fallback (review drift from 0127).
- [x] R9. Content-asserting test hardening (review drift from 0127/0128): the workflow-run §3 resolution-order assertion covers BOTH the `bun` global loop and the `npm` global loop (not just the first); the daily-ai-voice `R3 (0128)` flattened-name regex matches the `<n>-<step>-<name>` shape actually produced (current `[a-z]` char class after the hyphen misses a `${`-led name).

### Acceptance Criteria

```gherkin
Scenario: Docs and content-asserting tests land in the same change
  Given the feature ships
  Then docs/04_DESIGN.md config table and workflow rows state the new resolution chain and per-workflow defaults
  And plugins/kk/config.example.yaml header documents the global-install fallback
  And docs/help/storm-topic-research-workflow.md and docs/help/solo-podcast-workflow.md state the new default locations
  And the audio-authoring, topic, itc-generating, and storm-research skill contracts name the shipped artifact paths
  And docs/design/kk-solo-podcast.md and docs/design/itc-generating.md name no removed stage directory
  And the workflow-run command description mentions the global-install fallback
  And the workflow-run and daily-ai-voice tests pin both resolution loops and the flattened name shape
```

Task-local checks: the `.works` no-migration limitation is documented where workspace defaults are described; `spur feature check P --strict` exits 0 after this task lands; no old stage-directory artifact reference remains in any surface named by R1–R8.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: documentation edits plus two scoped test-assertion tightenings, in the same feature change as the behavior tasks. WHY: 04_DESIGN.md is the surface SSOT; its workflow table (docs/04_DESIGN.md rows ~586–588) and solo-podcast help currently name `$works_dir/<kebab>` and cwd-relative itc paths — both superseded by this feature; the config table must name the new chain so operators on global installs can debug resolution. Review drift from the 0127/0128 rounds (skill artifact tables, docs/design pages, workflow-run frontmatter, two test assertions) is absorbed here because feature scenario R7 owns "docs and content-asserting tests in the same change". Scope verified against the shipped diffs from the two sibling tasks (chain order, four namespace defaults, flattened paths). Invariants: no production behavior files touched; docs match the implemented shell exactly — no aspirational wording; test edits limited to the two R9 findings. Skipped: rewriting docs for platforms beyond the four profiles; changelog (spur dev-wrap owns it).

### Plan

1. Update the config table, resolution-order table, and workflow rows in docs/04_DESIGN.md.
2. Add the fallback + defaulting note to the config.example.yaml header.
3. Update docs/help/storm-topic-research-workflow.md and docs/help/solo-podcast-workflow.md; add the no-migration note where defaults are described.
4. Update the four skill artifact surfaces (audio-authoring, topic, itc-generating, storm-research) and the two docs/design pages to the shipped layout.
5. Update the workflow-run command frontmatter description (global-install fallback).
6. Tighten the two test assertions (both §3 loops in workflow-run-command.test.ts; flattened-name regex in kk-daily-ai-voice-workflow.test.ts).
7. Run `spur feature check P --strict --json` and resolve any remaining finding.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:389` |
| `apps/cli/tests/kk-itc-workflow.test.ts:59` |
| `apps/cli/tests/kk-itc-workflow.test.ts:73` |
| `apps/cli/tests/kk-solo-podcast-workflow.test.ts:160` |
| `apps/cli/tests/kk-solo-podcast-workflow.test.ts:74` |
| `apps/cli/tests/kk-solo-podcast-workflow.test.ts:76` |
| `apps/cli/tests/workflow-run-command.test.ts:142` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/04_DESIGN.md:309` — config-table `workflows_dir` row states the full chain (override → `KK_WORKFLOWS_SOURCE` → bun global → npm global → package root → checkout); resolution-order table :562-573 with guarded global rows (:564,:565); per-profile work_dir defaults + flattened paths |
| R2 | MET | `plugins/kk/config.example.yaml:1-8` — header comment documents the global-install fallback, per-workflow workspace defaulting, and `.works` no-migration (re-read this run) |
| R3 | MET | `docs/help/storm-topic-research-workflow.md` and `docs/help/solo-podcast-workflow.md` state `$works_dir/kk-storm-research/<topic-id>` / `$works_dir/kk-solo-podcast/<date>` (rg this run) |
| R4 | MET | `.works` no-migration documented in `plugins/kk/config.example.yaml` header and `docs/help/solo-podcast-workflow.md` |
| R5 | MET | Documented deviation: feature P was cancelled 2026-09-14 and its scope re-homed to F8 (feature Notes); the equivalent gate — `spur feature check F8` — runs as this batch's Step 13 shippable check (verdict recorded there) |
| R6 | MET | Skill contracts name shipped flat paths: `plugins/kk/skills/audio-authoring/SKILL.md` (1-briefing-briefing.md, 3-script-voicescript.yaml), `plugins/kk/skills/topic/SKILL.md` + `plugins/kk/skills/itc-generating/SKILL.md` + references (3-draft-draft-article.md); `plugins/kk/skills/storm-research/SKILL.md` carries no workflow stage paths — nothing to drift |
| R7 | MET | rg this run: zero hits for `1-briefing/`, `3-script/`, `3-draft/` in `docs/design/kk-solo-podcast.md` and `docs/design/itc-generating.md` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Docs and content-asserting tests land in the same change | MET | command | All surfaces above re-verified this run; `plugins/kk/commands/workflow-run.md:5-6,:16-17` description mentions the global-install fallback; content-asserting tests green in this run's suite (1024 pass / 0 fail): `workflow-run-command.test.ts` (resolution loops), `kk-daily-ai-voice-workflow.test.ts` (flattened shapes) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-14T21:05:02.976Z todo → wip (system)
- 2026-09-14T21:54:48.973Z wip → testing (system)
- 2026-09-14T21:55:10.283Z testing → done (system)

