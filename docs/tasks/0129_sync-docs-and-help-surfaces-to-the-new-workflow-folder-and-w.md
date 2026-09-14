---
schema_version: 1
name: Sync docs and help surfaces to the new workflow folder and workspace contract
status: todo
template: feature-impl
created_at: 2026-09-14T17:55:18.375Z
updated_at: "2026-09-14T17:59:45.664Z"
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

- [ ] R1. `docs/04_DESIGN.md` config table documents the workflows_dir fallback chain (config → bun global → npm global → package-root walk → checkout/compiled default), the resolution-order table gains the global-install rows, and the workflow table's per-profile work_dir column states `$works_dir/<workflow-name>/<run-id>` per profile with the flattened output paths (`3-draft-draft-article.md`, `1-briefing-briefing.md`, `3-script-voicescript.yaml`, `4-audio/*`).
- [ ] R2. `plugins/kk/config.example.yaml` gains a header comment mentioning the global-install fallback and per-workflow workspace defaulting (the file is currently two bare keys with no comment).
- [ ] R3. `docs/help/storm-topic-research-workflow.md` and `docs/help/solo-podcast-workflow.md` state the new default locations (`$works_dir/kk-storm-research/<topic-id>`, `$works_dir/kk-solo-podcast/<date>`), the corrected resolution chain, the `--dir` default, and the flattened paths.
- [ ] R4. The `.works` no-migration limitation is documented where workspace defaults are described.
- [ ] R5. After the sibling tasks land, `spur feature check P --strict --json` passes with zero findings.

### Acceptance Criteria

```gherkin
Scenario: Docs and content-asserting tests land in the same change
  Given the feature ships
  Then docs/04_DESIGN.md config table and workflow rows state the new resolution chain and per-workflow defaults
  And plugins/kk/config.example.yaml header documents the global-install fallback
  And docs/help/storm-topic-research-workflow.md and docs/help/solo-podcast-workflow.md state the new default locations
```

Task-local checks: the `.works` no-migration limitation is documented where workspace defaults are described; `spur feature check P --strict` exits 0 after this task lands.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: documentation edits only, in the same feature change as the behavior tasks. WHY: 04_DESIGN.md is the surface SSOT; its workflow table (docs/04_DESIGN.md rows ~586–588) and solo-podcast help currently name `$works_dir/<kebab>` and cwd-relative itc paths — both superseded by this feature; the config table must name the new chain so operators on global installs can debug resolution. Scope verified against the shipped diffs from the two sibling tasks (chain order, four namespace defaults, flattened paths). Invariants: no behavior files touched; docs match the implemented shell exactly — no aspirational wording. Skipped: rewriting docs for platforms beyond the four profiles; changelog (spur dev-wrap owns it).

### Plan

1. Update the config table, resolution-order table, and workflow rows in docs/04_DESIGN.md.
2. Add the fallback + defaulting note to the config.example.yaml header.
3. Update docs/help/storm-topic-research-workflow.md and docs/help/solo-podcast-workflow.md; add the no-migration note where defaults are described.
4. Run `spur feature check P --strict --json` and resolve any remaining finding.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
