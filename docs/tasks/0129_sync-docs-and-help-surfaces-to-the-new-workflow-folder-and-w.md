---
schema_version: 1
name: Sync docs and help surfaces to the new workflow folder and workspace contract
status: done
template: feature-impl
created_at: 2026-09-14T17:55:18.375Z
updated_at: "2026-09-14T21:55:10.283Z"
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
| R1 | MET | . docs/04_DESIGN.md:309 config-table workflows_dir row states the full chain (user override → KK_WORKFLOWS_SOURCE → bun global → npm global → kk package root → repo checkout). :560–565 resolution-order table has 6 rows including bun global (:564) and npm global (:565) guarded probes. :587–590 workflow table gives per-profile work_dir defaults ($works_dir/kk-itc/<kebab>, $works_dir/kk-solo-podcast/<date>, $works_dir/kk-storm-research/<topic-id>) with flattened report artifacts (3-draft-draft-article.md :589, 1-briefing-briefing.md + 3-script-voicescript.yaml + 4-audio/content.{json,wav} :590). :592 states the per-profile default and --dir override. |
| R2 | MET | . plugins/kk/config.example.yaml:1–4 header comment documents per-workflow workspace defaulting (<works_dir>/<workflow-name>/<run-id>, --dir override, .works-era trees not migrated) and the workflows_dir global-install fallback (KK_WORKFLOWS_SOURCE → bun/npm global → package root → repo checkout). |
| R3 | MET | . Storm: docs/help/storm-topic-research-workflow.md:52–53 (in-place resolution chain incl. bun/npm global, "nothing is copied" semantics), :170 ($works_dir/kk-storm-research/<id>), :173 + :186 (--dir override). Solo: docs/help/solo-podcast-workflow.md:17 + :41 + :66–67 (chain incl. bun/npm global), :68 ($works_dir/kk-solo-podcast/<date>), :81 (--dir row), :148/:152 (flattened 1-briefing-briefing.md / 3-script-voicescript.yaml). Storm has no single-file steps (already flat) so no flattened paths apply. |
| R4 | MET | . .works no-migration documented at every workspace-defaults surface: solo help :68, storm help :172–173, 04_DESIGN.md:592, config.example.yaml:2–3. |
| R5 | MET | (amended). `spur feature check P --strict --json` → exit 0, pass:true, findings: [] (re-executed at amendment time). P's Acceptance Criteria block is empty and Notes carries the superseded-by-F8 tombstone (docs/features/P_workflow-folder-fallback-and-per-workflow-workspace-defaults.md:40–43), so the orphan-scenarios error can no longer fire. Status "cancelled" is accurate; scenarios and tasks 0127–0129 live under F8. |
| R6 | MET | . audio-authoring/SKILL.md:68,71 (artifact table: 1-briefing-briefing.md, 3-script-voicescript.yaml), :103,112 (flow text). topic/SKILL.md:67,69,82,97,120,123 (3-draft-draft-article.md, no 3-draft/). itc-generating/SKILL.md:85,107 + references platform-wechat.md:59, platform-english.md:72, generic-craft.md:77. storm-research/SKILL.md:71,98 ($works_dir/kk-storm-research/<topic-id>, matching shipped states). |
| R7 | MET | (negative check). grep for `3-draft/`, `1-briefing/`, `3-script/` across audio-authoring, topic, itc-generating, storm-research skills and docs/design/kk-solo-podcast.md, docs/design/itc-generating.md: zero hits (sole textual occurrence is topic/SKILL.md's explicit "no `3-draft/` dir" statement). File trees in kk-solo-podcast.md now say "resolved in place" / "sidecar fallback chain". |
| R8 | MET | . plugins/kk/commands/workflow-run.md:5–6 frontmatter description: "Resolves the workflow YAML from the user override, KK_WORKFLOWS_SOURCE, bun/npm global installs, the kk package root, or a repo checkout". |
| R9 | MET | . workflow-run-command.test.ts:146–152 candidateLoops() collects BOTH §3 loop lines; :152 test asserts the 5-entry chain order for every loop (both §3 loops). kk-daily-ai-voice-workflow.test.ts:404–406 regex widened to [0-9]-[^/\s]+-[^/\s]*\.[A-Za-z] (matches ${...}-led flattened names, still excludes 4-audio/ style stage dirs via [^/\s]). Executable: bun test across the 4 files → 39 pass / 0 fail / 332 expects; `spur workflow validate plugins/kk/workflows/kk-itc.yaml --json` → exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-14T21:05:02.976Z todo → wip (system)
- 2026-09-14T21:54:48.973Z wip → testing (system)
- 2026-09-14T21:55:10.283Z testing → done (system)

