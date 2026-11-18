---
schema_version: 1
name: Redesign Daily AI Voice Board around generation and publishing evidence
status: done
template: feature-impl
created_at: 2026-11-18T04:18:12.611Z
updated_at: "2026-11-18T09:56:40.463Z"
feature_id: L3

estimate_hours: 8
dependencies: ["0391"]
done_forced: "false"
done_reason: unforced close
---

## 0390. Redesign Daily AI Voice Board around generation and publishing evidence

### Background

The current contribution shows four legacy tabs and only falls back to voice2 history when the current family is empty (apps/board/src/daily-voice/index.tsx:109,161,788). Spur now publishes its native contribution kit. Implements L3 R11/R13 and consumes 0391's evidence contract.

### Requirements

- [x] R1. Show Summary, Generation and Publishing using the native Spur module UI kit, preserve the route and migrate existing links (L3 R11).
- [x] R2. Put generated artifacts and diagnostic evidence behind contextual drill-down, without arbitrary file links or exposing stale runs (L3 R13).
- [x] R3. Verify the packed contribution in Chromium across current and historical runs, loading/errors, themes and keyboard interaction.

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/board/src/contracts.ts:144` |
| `apps/board/src/daily-voice/index.tsx:1` |
| `apps/board/src/daily-voice/index.tsx:1034` |
| `apps/board/src/daily-voice/index.tsx:1099` |
| `apps/board/src/daily-voice/index.tsx:1106` |
| `apps/board/src/daily-voice/index.tsx:114` |
| `apps/board/src/daily-voice/index.tsx:12` |
| `apps/board/src/daily-voice/index.tsx:120` |
| `apps/board/src/daily-voice/index.tsx:1243` |
| `apps/board/src/daily-voice/index.tsx:1287` |
| `apps/board/src/daily-voice/index.tsx:1292` |
| `apps/board/src/daily-voice/index.tsx:1295` |
| `apps/board/src/daily-voice/index.tsx:1318` |
| `apps/board/src/daily-voice/index.tsx:1329` |
| `apps/board/src/daily-voice/index.tsx:15` |
| `apps/board/src/daily-voice/index.tsx:152` |
| `apps/board/src/daily-voice/index.tsx:154` |
| `apps/board/src/daily-voice/index.tsx:171` |
| `apps/board/src/daily-voice/index.tsx:182` |
| `apps/board/src/daily-voice/index.tsx:189` |
| `apps/board/src/daily-voice/index.tsx:201` |
| `apps/board/src/daily-voice/index.tsx:217` |
| `apps/board/src/daily-voice/index.tsx:255` |
| `apps/board/src/daily-voice/index.tsx:276` |
| `apps/board/src/daily-voice/index.tsx:29` |
| `apps/board/src/daily-voice/index.tsx:299` |
| `apps/board/src/daily-voice/index.tsx:307` |
| `apps/board/src/daily-voice/index.tsx:310` |
| `apps/board/src/daily-voice/index.tsx:317` |
| `apps/board/src/daily-voice/index.tsx:330` |
| `apps/board/src/daily-voice/index.tsx:357` |
| `apps/board/src/daily-voice/index.tsx:366` |
| `apps/board/src/daily-voice/index.tsx:39` |
| `apps/board/src/daily-voice/index.tsx:420` |
| `apps/board/src/daily-voice/index.tsx:454` |
| `apps/board/src/daily-voice/index.tsx:456` |
| `apps/board/src/daily-voice/index.tsx:459` |
| `apps/board/src/daily-voice/index.tsx:527` |
| `apps/board/src/daily-voice/index.tsx:537` |
| `apps/board/src/daily-voice/index.tsx:541` |
| `apps/board/src/daily-voice/index.tsx:553` |
| `apps/board/src/daily-voice/index.tsx:558` |
| `apps/board/src/daily-voice/index.tsx:56` |
| `apps/board/src/daily-voice/index.tsx:566` |
| `apps/board/src/daily-voice/index.tsx:570` |
| `apps/board/src/daily-voice/index.tsx:58` |
| `apps/board/src/daily-voice/index.tsx:69` |
| `apps/board/src/daily-voice/index.tsx:707` |
| `apps/board/src/daily-voice/index.tsx:72` |
| `apps/board/src/daily-voice/index.tsx:720` |
| `apps/board/src/daily-voice/index.tsx:727` |
| `apps/board/src/daily-voice/index.tsx:79` |
| `apps/board/src/daily-voice/index.tsx:83` |
| `apps/board/src/daily-voice/index.tsx:842` |
| `apps/board/src/daily-voice/index.tsx:847` |
| `apps/board/src/daily-voice/index.tsx:850` |
| `apps/board/src/daily-voice/index.tsx:854` |
| `apps/board/src/daily-voice/index.tsx:862` |
| `apps/board/src/daily-voice/index.tsx:89` |
| `apps/board/src/daily-voice/index.tsx:907` |
| `apps/board/src/daily-voice/index.tsx:929` |
| `apps/board/src/daily-voice/index.tsx:93` |
| `apps/board/src/daily-voice/index.tsx:947` |
| `apps/board/src/daily-voice/index.tsx:951` |
| `apps/board/src/daily-voice/view.ts:450` |
| `apps/board/src/daily-voice/view.ts:484` |
| `apps/board/src/shared/api.ts:128` |
| `apps/board/src/shared/api.ts:14` |
| `apps/board/src/shared/api.ts:800` |
| `apps/board/tests/daily-voice/view.test.ts:16` |
| `apps/board/tests/daily-voice/view.test.ts:21` |
| `apps/board/tests/daily-voice/view.test.ts:26` |
| `apps/board/tests/daily-voice/view.test.ts:29` |
| `apps/board/tests/daily-voice/view.test.ts:309` |
| `apps/board/tests/installed-board.test.ts:1019` |
| `apps/board/tests/installed-board.test.ts:1710` |
| `apps/board/tests/installed-board.test.ts:1764` |
| `apps/board/tests/installed-board.test.ts:1882` |
| `apps/board/tests/installed-board.test.ts:322` |
| `apps/board/tests/installed-board.test.ts:417` |
| `apps/board/tests/shared/api.test.ts:662` |
| `scripts/build-board.ts:52` |
| `scripts/tests/board-package.test.ts:103` |
| `scripts/tests/board-package.test.ts:157` |
| `scripts/tests/board-package.test.ts:222` |
| `scripts/tests/board-package.test.ts:99` |
| `apps/board/src/daily-voice/evidence.ts:1` |
| `apps/board/src/spur-board-ui.d.ts:1` |
| `apps/board/tests/daily-voice/evidence.test.ts:1` |
| `apps/cli/.works/kk.db:1` |
| `apps/cli/.works/kk.db-shm:1` |
| `apps/cli/.works/kk.db-wal:1` |
| `apps/cli/.works/test-artifacts/0212/README.md:1` |
| `apps/cli/.works/test-artifacts/0212/cutover-fixtures.md:1` |
| `apps/cli/.works/tmp/test-content-nouns/summary.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Summary/Generation/Publishing on the native Spur module UI kit, route preserved, existing links migrated | MET | `apps/board/src/daily-voice/index.tsx:440-455` composes `ModuleShell`/`ModuleHeader`/`ModuleTabs`/`Badge`/`EmptyState`/`Diagnostic`; kit facade kept external at `scripts/build-board.ts:58-63`; route unchanged; `results`/`progress`→Generation and `config`→Summary aliases at `apps/board/src/daily-voice/view.ts:455,464-474`; real Chromium: 3 tabs, no retired-layout banner, news panels and captured settings at `apps/board/tests/installed-board.test.ts:1901-1938` (passed in my run), migrated `?tab=config` keeps its content at `apps/board/tests/installed-board.test.ts:1710-1731` (passed) |
| R2 — generated artifacts and diagnostic evidence behind contextual drill-down, no arbitrary file links, no stale runs | MET | Artifact groups behind `<details>` at `apps/board/src/daily-voice/index.tsx:735-760`; captured settings behind `<details>` at `index.tsx:592-620`; publish evidence paths as `<code>` text at `index.tsx:797-806`; artifact views come only from reader-resolved `artifactViews(results, readerOrigin)` at `apps/board/src/daily-voice/evidence.ts:447-470`; stale launch surfaced at `evidence.ts:556-580`. Chromium: reader-route artifact link `apps/board/tests/installed-board.test.ts:1939-1963`, zero `a[href*="4-publish"]` / `a[href*=".json"]` links plus recorded words `no evidence recorded` / `receipt not recorded` / `partially sent` at `apps/board/tests/installed-board.test.ts:1964-1988` — all passed in my run |
| R3 — packed contribution verified in Chromium across current and historical runs, loading/errors, themes and keyboard interaction | MET | All axes execute against the packed+installed CLI in real Chromium and passed in my run: current run `apps/board/tests/installed-board.test.ts:1901-1963`; historical/retired day `:1710-1731` + retired-layout suite `:1058-1300`; keyboard `:1989-2015`; light/dark `:2016-2044`; loading + reader error `:2045-2085`. Repeatable command: `bun test apps/board/tests/installed-board.test.ts -t "news family"` → 6 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R11 — Daily AI Voice follows the native Board shell | MET | test | `apps/board/src/daily-voice/index.tsx:440-455` (kit shell/header/tabs/states from `@gobing-ai/spur/board/ui`); facade kept external at `scripts/build-board.ts:58-63`; real-Chromium mount with 3 `role="tab"` tabs, no retired-layout banner, recorded gate/outcome facts at `apps/board/tests/installed-board.test.ts:1901-1938` |
| R13 — Failed and incomplete runs expose diagnostic evidence | MET | test | First failed/uncertain target as the Summary issue and the uncaptured-attempt diagnostic at `apps/board/src/daily-voice/evidence.ts:556-580`, rendered at `apps/board/src/daily-voice/index.tsx:570-582`; unit pins for failed/uncertain and uncaptured paths at `apps/board/tests/daily-voice/evidence.test.ts:204-238,381-395`; browser pins for the incomplete publish path (`no evidence recorded`, `receipt not recorded`, `partially sent`, no link minted) at `apps/board/tests/installed-board.test.ts:1964-1988` and for a bounded reader error with no invented issue at `apps/board/tests/installed-board.test.ts:2045-2085` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- docs/design/daily-ai-news-editorial-delivery.md — Board layout and ownership.
- apps/board/src/daily-voice/index.tsx:109 — current view.
- scripts/build-board.ts:53 — external facade entries.
- Spur DESIGN.md — Product UI / Module Shell, docs/design/board-module-ui-kit.md — published UI kit.

### History

- 2026-11-18T04:23:14.687Z backlog → todo (system)
- 2026-11-18T08:18:19.513Z todo → wip (system)
- 2026-11-18T09:56:39.847Z wip → testing (system)
- 2026-11-18T09:56:40.459Z testing → done (system)

