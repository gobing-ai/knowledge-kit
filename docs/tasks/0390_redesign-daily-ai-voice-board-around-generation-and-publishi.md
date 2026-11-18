---
schema_version: 1
name: Redesign Daily AI Voice Board around generation and publishing evidence
status: todo
template: feature-impl
created_at: 2026-11-18T04:18:12.611Z
updated_at: "2026-11-18T04:50:04.555Z"
feature_id: L3

estimate_hours: 8
dependencies: ["0391"]
---

## 0390. Redesign Daily AI Voice Board around generation and publishing evidence

### Background

The current contribution shows four legacy tabs and only falls back to voice2 history when the current family is empty (apps/board/src/daily-voice/index.tsx:109,161,788). Spur now publishes its native contribution kit. Implements L3 R11/R13 and consumes 0391's evidence contract.

### Requirements

- [ ] R1. Show Summary, Generation and Publishing using the native Spur module UI kit, preserve the route and migrate existing links (L3 R11).
- [ ] R2. Put generated artifacts and diagnostic evidence behind contextual drill-down, without arbitrary file links or exposing stale runs (L3 R13).
- [ ] R3. Verify the packed contribution in Chromium across current and historical runs, loading/errors, themes and keyboard interaction.

### Acceptance Criteria

- [ ] R11 — Daily AI Voice follows the native Board shell
- [ ] R13 — Failed and incomplete runs expose diagnostic evidence

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.554Z

**Ready decisions.** Consume the 0391 versioned reader fixtures and diagnostics. Reuse the Spur public shell and installed bundle route. One controlled selection owns the three views. Retain old tab aliases. Separate missing, running, failed and superseded; late responses never replace a newer run selection. UI-only scope and read-only Board.

**Source premise.** `apps/board/src/daily-voice/index.tsx:109` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Use apps/board/tests/installed-board.test.ts with a packed CLI and Chromium. Verify selected-run changes, old URLs, themes, keyboard and precise failure drill-down.

### Design

Use ModuleShell, ModuleHeader, ModuleTabs and host states per Spur DESIGN.md and docs/design/board-module-ui-kit.md. Consume the host import-map facade and base-path helpers. Retain a single run selection across all views. Summary folds in existing G82 diagnostics. Use the 0391 DTO for stage and target detail. See docs/design/daily-ai-news-editorial-delivery.md, Spur Board redesign. Keep obsolete URLs working by alias migration; avoid a custom shell or a publication control.

### Plan

- [ ] Read the installed manifest, kit declarations, native shell rules and current browser fixtures.
- [ ] Extend the installed-package Chromium fixture first for current generation, failed or no-content, mixed publish and legacy URLs.
- [ ] Migrate the native contribution and wire selection, rows, collapsible artifacts and safe evidence. Preserve history across workflow families and discard in-flight responses for another run.
- [ ] Verify keyboard navigation, light/dark, narrow layout, expired reader, broken/missing evidence and old links. Retain screenshots and a repeatable browser command in task evidence. Update the Board doc.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- docs/design/daily-ai-news-editorial-delivery.md — Board layout and ownership.
- apps/board/src/daily-voice/index.tsx:109 — current view.
- scripts/build-board.ts:53 — external facade entries.
- Spur DESIGN.md — Product UI / Module Shell, docs/design/board-module-ui-kit.md — published UI kit.

### History

- 2026-11-18T04:23:14.687Z backlog → todo (system)

