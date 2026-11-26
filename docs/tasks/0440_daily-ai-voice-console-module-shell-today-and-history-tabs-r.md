---
schema_version: 1
name: Daily AI Voice console module shell, Today and History tabs, retire the old module
status: todo
template: feature-impl
created_at: 2026-11-26T00:29:45.934Z
updated_at: "2026-11-26T01:09:14.285Z"
feature_id: G83
priority: P1
tags:
  - board
  - daily-ai-voice
  - ui

dependencies: ["0439"]
estimate_hours: 8
---

## 0440. Daily AI Voice console module shell, Today and History tabs, retire the old module

### Background

Feature G83: the new day-centric module replaces apps/board/src/daily-voice/ on the same route id and drops the voice2-era code paths.

Implements: R1 — The new day-centric module replaces the old Daily AI Voice module; R3 — Today tab answers what happened and what needs the operator; R7 — History view shows recent day health and node duration trend; R8 — Every attention item and detail row offers a pre-filled redo recipe

Design: docs/design/daily-voice-ops-console.md §4–§5.

**Refine corrections (2026-11-25)** — premises audited against the current tree:

1. **Current module:** `apps/board/src/daily-voice/{index.tsx (1331 lines), view.ts (527), evidence.ts (596)}`. The route is `MODULE_PATH = '/board/modules/kk-daily-ai-voice2'` (`index.tsx:81`), so the new module keeps the `kk-daily-ai-voice2` module id. Only the layouts go.
2. **`kk-daily-ai-voice` (no "2") is not a code identifier.** It appears only in old capture filenames (`daily-ai-voice-<date>-*.json`). R2's retirement therefore covers `kk-daily-ai-voice2` code paths: the voice2 fallback layout in `index.tsx` (lines 74 and 183), the voice2 branch in `reader.ts:377,488`, `manifest.ts:15-109,197,710` and `commands/daily.ts:28,765`.
3. **Shared server helpers must survive.** `projectProgress`, `DailyProgress` and `dagProducerState` in `apps/cli/src/board/daily-voice.ts` are consumed by `news.ts`. Keep them, or move them into `news.ts`. Only the voice2-only exports (`projectDailyResults`, `projectFunnel`, `sanitizeFunnelArtifact`, `channelOutcomes`) are removal candidates, after a caller grep.
4. **`WorkflowFamily` keeps the `'kk-daily-ai-voice2'` key** (`manifest.ts:27,31`) as long as `kk-news-generate` maps to it. Remove a `WorkflowName` member only when no capture, manifest or reader path still reads it. Old capture records (`daily-ai-voice-*`) must keep loading or fail with an explicit reason, never crash.
5. **The supply-context panel** is G82's `supplyContextOf` (`view.ts:434`) plus the `supply` state in `index.tsx:189-193`. It is retired with the run-centric Summary view.

### Requirements

- [ ] R1. The module at the existing route id renders the Today, Generation, Publishing, History and Actions log tabs.
- [ ] R2. Retired kk-daily-ai-voice2 / kk-daily-ai-voice layouts, the WorkflowName members only they used and the voice2-bound supply-context panel are removed.
- [ ] R3. Today shows day picker, status banner, generation card, window strip, safety line and a severity-ordered attention list with copyable recipes; an empty list shows an explicit all-clear.
- [ ] R4. History shows per-day status and window outcomes plus a per-node duration trend; selecting a day opens it in Today.

### Acceptance Criteria

- [ ] AC1 — The new day-centric module replaces the old Daily AI Voice module
- [ ] AC2 — Today tab answers what happened and what needs the operator
- [ ] AC3 — History view shows recent day health and node duration trend
- [ ] AC4 — Every attention item and detail row offers a pre-filled redo recipe

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T01:08:55.072Z

- **Q: Keep the `kk-daily-ai-voice2` module id even though voice2 is retired?** A: Yes. It is the route id (`index.tsx:81`), and changing it breaks bookmarks (feature R1). Only the layouts are retired.
- **Q: What happens to old `daily-ai-voice-*` capture records?** A: They stay on disk. The new module never lists them, because it lists days, not runs. Any remaining reader path that loads them must fail explicitly, never crash.
- **Q: What is the History default range?** A: 14 days. The server caps the range at 31.

### Design

**Chosen.** A new module directory that reuses the per-run helpers from `view.ts` and `evidence.ts` that the detail tabs still need. Those helpers are moved, not rewritten. Deleting the run-centric shell is the point of the feature.

**Rejected.** Incrementally retrofitting the 1331-line run-centric `index.tsx`. It keeps the voice2 branches alive.

**Frozen:**
- Module path: `apps/board/src/daily-voice/` (rewritten in place). `MODULE_PATH = '/board/modules/kk-daily-ai-voice2'`, unchanged so bookmarks survive.
- Tabs, in this order: `today`, `generation`, `publishing`, `history`, `actions`. Labels: Today, Generation, Publishing, History, Actions log.
- The selected day lives in the URL hash (`#day=YYYYMMDD&tab=…`), so a History click deep-links into Today.
- Data comes only from `GET /api/days/<day>`, `GET /api/days?from&until` (the default History range is the last 14 days) and the existing per-run routes.
- Recipes render `Recipe.argv.join(' ')` with shell-quoting for display, and a copy button. They are never rebuilt client-side.

**Retirement list** (each item verified by grep before deleting):
- the voice2 fallback layout and results/config pair in `index.tsx`;
- `supplyContextOf` and the `supply` state (G82 panel);
- `projectDailyResults`, `projectFunnel`, `sanitizeFunnelArtifact` and `channelOutcomes` in `apps/cli/src/board/daily-voice.ts`, plus the reader branch at `reader.ts:488` that serves them.

**Keep:** `projectProgress`, `DailyProgress` and `dagProducerState`, all used by `news.ts`. Keep the `WorkflowFamily` key `kk-daily-ai-voice2`.

**Anti-patterns:**
- Client-side status math.
- Rendering `null` as 0.
- Keeping dead voice2 branches "for compatibility".
- A second fetch path that bypasses `/api/days`.

**Handoff.** 0441 fills the Generation and Publishing tab bodies. 0442 fills the Actions log tab and turns recipes into action buttons when the plane is enabled.

**Tests:**

| AC | Test file | Covers |
| --- | --- | --- |
| AC1 | `apps/board/tests/daily-voice/*.test.ts` (module renders five tabs; no voice2 symbols, via a grep assertion in the test) and `apps/board/tests/installed-board.test.ts` | the route id still resolves |
| AC2 | Today render | all-clear and attention fixtures |
| AC3 | History render | status strip, duration trend, click to Today |
| AC4 | recipe render | matches `DailyDigest` argv byte-for-byte |

### Plan

- Scaffold the new module and tab router on the existing id.
- Today tab over GET /api/days/<day>.
- History tab over GET /api/days?from&until.
- Delete the old module, voice2 layouts and dead contract members; fix imports.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/G83_daily-ai-voice-ops-console-day-centric-digest-debug-tabs-and-guarded-redo-tools.md`
- Design satellite: `docs/design/daily-voice-ops-console.md` (index row `docs/04_DESIGN.md:64`)
- Decision: `docs/00_ADR.md:1417` (ADR-035 amendment 2026-11-25)
- Brainstorm: `docs/plans/2026-11-25-daily-ai-voice-ops-console-brainstorm.md`
- Code anchors: `apps/cli/src/board/reader.ts:666-724`, `apps/cli/src/board/news.ts:40,58-160,254,469`, `apps/cli/src/board/daily-voice.ts:308`, `apps/cli/src/board/capture.ts` (`BOARD_RUNS_REL`), `apps/cli/src/commands/content-launch.ts:525`, `apps/board/src/contracts.ts:11,44,250`
- Follow-ups: G84 (in-board artifact editor), G85 (digest push notification)

### History
