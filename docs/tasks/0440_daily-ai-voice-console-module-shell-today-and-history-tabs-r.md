---
schema_version: 1
name: Daily AI Voice console module shell, Today and History tabs, retire the old module
status: done
template: feature-impl
created_at: 2026-11-26T00:29:45.934Z
updated_at: "2026-11-26T04:21:25.367Z"
feature_id: G83
priority: P1
tags:
  - board
  - daily-ai-voice
  - ui

dependencies: ["0439"]
estimate_hours: 8
done_forced: "false"
done_reason: unforced close
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

- [x] R1. The module at the existing route id renders the Today, Generation, Publishing, History and Actions log tabs.
- [x] R2. Retired kk-daily-ai-voice2 / kk-daily-ai-voice layouts, the WorkflowName members only they used and the voice2-bound supply-context panel are removed.
- [x] R3. Today shows day picker, status banner, generation card, window strip, safety line and a severity-ordered attention list with copyable recipes; an empty list shows an explicit all-clear.
- [x] R4. History shows per-day status and window outcomes plus a per-node duration trend; selecting a day opens it in Today.

### Acceptance Criteria

- [x] AC1 — The new day-centric module replaces the old Daily AI Voice module
- [x] AC2 — Today tab answers what happened and what needs the operator
- [x] AC3 — History view shows recent day health and node duration trend
- [x] AC4 — Every attention item and detail row offers a pre-filled redo recipe

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

| File | Lines | What / why |
| --- | --- | --- |
| `apps/board/src/daily-voice/index.tsx` | 1-660 (rewritten) | The day-centric console at the unchanged route id. Hash-driven `{day, tab}` state, two reads (`client.day`, `client.days`), five tabs in the frozen order, Today/Generation/Publishing/History/Actions-log panels, recipe copy buttons, `kk-board-daily-voice` host identity class. The run-centric Summary layout, the voice2 fallback panels, `LegacyProgressPanel` and the G82 supply-context panel are gone. |
| `apps/board/src/daily-voice/day-view.ts` | 1-420 (new) | The pure view model: tab identity and labels, `parseConsoleHash`/`consoleHash` with validation, Today facts (unknown = `unknown (<reason>)`, never 0), window strip rows, attention rows in the projection's order, History rows, per-node duration trend with `null` gaps, `recipeText`/`quoteArg`, `historyRange` (14-day default, reader-capped 31). |
| `apps/board/src/daily-voice/view.ts` | deleted (527 lines) | Retired: the voice2 view model (`funnelView`, `supplyContextOf`, `pickDailyFamily`, `retiredLayoutNotice`, `DAILY_VIEWS`, the browser confidence-vocabulary copy). Feature R2 retires these layouts; nothing else imported them. |
| `apps/board/src/daily-voice/evidence.ts` | 26-30, 595 | Kept for 0441's per-run drill-down; the retired `DAILY_WORKFLOW` re-export now declares the news workflow id locally instead of importing it from the deleted `view.ts`. |
| `apps/board/src/shared/api.ts` | 121-130, 800-812 | `BoardClient.day(day)` and `BoardClient.days(from, until)` over the two G83 routes — the console's only read path, so there is no second fetch that could bypass `/api/days`. |
| `apps/board/tests/daily-voice/day-view.test.ts` | 1-330 (new) | AC1-AC4: the five-tab strip, a grep assertion that no retired voice2 symbol survives in the module sources, Today's unknown/all-clear cases, window rows, History rows and the duration-trend gaps, hash round-trip and validation, and byte-identical recipe rendering with POSIX quoting. |
| `apps/board/tests/daily-voice/view.test.ts`, `apps/board/tests/daily-voice/family.test.ts` | deleted | They tested only the retired view model; their surviving concern (day family selection) no longer exists because the console lists days. |
| `apps/board/tests/installed-board.test.ts` | 925-940, 1353-1380, tail | The tab-count contract now expects the five kit tabs; the `judge confidence vocabulary` case keeps its reader-projection round-trip and drops its retired-Summary UI half; the `Daily episode funnel and supply context` and `Daily AI Voice news family` Chromium cases are retired with the layouts they asserted, replaced by a pointer comment naming 0441 (per-run drill-down) and 0443 (console E2E) as their successors. |
| `plugins/kk/tests/verdict-confidence.test.ts` | 671-700 | The board confidence-vocabulary lockstep drops the deleted `daily-voice/view.ts`: the console consumes an already-validated digest, so only the reader projection (`manifest.ts`) and the ITC view still hold the enum copy. |
| `docs/04_DESIGN.md` | 536-556 | T3 surface: the five tabs, the two routes, the hash contract, the retired layouts and what deliberately stays (per-run projections, the `WorkflowName` member, old capture records still resolving). |

Deliberate limits, recorded rather than hidden:

- **Generation/Publishing render the digest's own depth.** The tabs ship now with attempts, step durations and the window × target matrix; the per-run drill-down (fallback chain, artifacts with availability reasons, bounded diagnostics, provenance checks) is 0441's scope and the panels say so in place rather than pretending completeness.
- **The Actions log tab is recipes-only** with an explicit disabled-plane diagnostic; the guarded `POST /api/actions/<kind>` plane is 0442.
- **Coverage gaps accepted here and named for their successors:** the retired Chromium cases covered the G82 funnel panel and the run-centric news views. The funnel's data path is still covered at the CLI level (`apps/cli/tests/board/*`, `apps/cli/tests/read-stage.test.ts`-class suites) and `projectFunnel`/`sanitizeFunnelArtifact` still serve `GET …/artifacts/<id>`; the *panel* is gone with the layout the feature chose to replace. If the operator wants the funnel back it belongs in a new tab slot, not in the retired Summary view.
- **No new rendering dependency.** Tables and badges come from the host kit; the copy button uses `navigator.clipboard` with no fallback UI when the clipboard is unavailable.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 The module at the existing route id renders Today, Generation, Publishing, History and Actions log tabs | MET | `apps/board/src/daily-voice/index.tsx:34` (`MODULE_PATH` unchanged), `:56-70` (`CONSOLE_TABS` strip), `:604-616` (tab panel switch); `apps/board/tests/daily-voice/day-view.test.ts:80` (five tabs, frozen order + labels); `apps/board/tests/installed-board.test.ts:932` (installed Chromium: 5 `role="tab"` on the module route) |
| R2 Retired voice2 layouts, the members only they used, and the voice2-bound supply-context panel are removed | MET | `apps/board/src/daily-voice/view.ts` deleted (527 lines); `apps/board/tests/daily-voice/{view,family}.test.ts` deleted; `apps/board/tests/daily-voice/day-view.test.ts:96` greps the module sources for `supplyContextOf`/`RETIRED_DAILY_WORKFLOWS`/`funnelView`/`LegacyProgressPanel` → none; `apps/board/src/daily-voice/evidence.ts:29` declares the news workflow id locally instead of importing the deleted module |
| R3 Today shows day picker, status banner, generation card, window strip, safety line and a severity-ordered attention list with copyable recipes; an empty list shows an explicit all-clear | MET | `apps/board/src/daily-voice/index.tsx:120-260` (`TodayPanel`), `:130-176` (`StatusBanner` + `AttentionList`), `:180-190` (`RecipeLine` copy button); `apps/board/src/daily-voice/day-view.ts:172-320` (`generationFacts`/`windowRows`/`attentionRows`, unknown = `unknown (<reason>)`); `apps/board/tests/daily-voice/day-view.test.ts:110-215` |
| R4 History shows per-day status and window outcomes plus a per-node duration trend; selecting a day opens it in Today | MET | `apps/board/src/daily-voice/index.tsx:400-490` (`HistoryPanel`, day button → `setDay`), `:520-530` (hash sync); `apps/board/src/daily-voice/day-view.ts:340-400` (`historyRows`, `durationTrend` with `null` gaps); `apps/board/tests/daily-voice/day-view.test.ts:220-270` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 The new day-centric module replaces the old Daily AI Voice module | MET | test | `apps/board/tests/daily-voice/day-view.test.ts:80,96`; `bun test apps/board/tests` → 185 pass / 0 fail, including the installed Chromium route test at `apps/board/tests/installed-board.test.ts:925` |
| AC2 Today tab answers what happened and what needs the operator | MET | test | `apps/board/tests/daily-voice/day-view.test.ts:110-215` (recorded figures, unknown-with-reason, all-clear, attention order, window strip) |
| AC3 History view shows recent day health and node duration trend | MET | test | `apps/board/tests/daily-voice/day-view.test.ts:220-262` (rows, tones, totals, trend gaps, bounded range) |
| AC4 Every attention item and detail row offers a pre-filled redo recipe | MET | test | `apps/board/src/daily-voice/day-view.ts:310` (rows carry `Recipe[]` unchanged from the projection), `:330-345` (`recipeText`/`quoteArg`); `apps/board/tests/daily-voice/day-view.test.ts:280-300` (byte-identical to the resolved argv) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: `docs/features/G83_daily-ai-voice-ops-console-day-centric-digest-debug-tabs-and-guarded-redo-tools.md`
- Design satellite: `docs/design/daily-voice-ops-console.md` (index row `docs/04_DESIGN.md:64`)
- Decision: `docs/00_ADR.md:1417` (ADR-035 amendment 2026-11-25)
- Brainstorm: `docs/plans/2026-11-25-daily-ai-voice-ops-console-brainstorm.md`
- Code anchors: `apps/cli/src/board/reader.ts:666-724`, `apps/cli/src/board/news.ts:40,58-160,254,469`, `apps/cli/src/board/daily-voice.ts:308`, `apps/cli/src/board/capture.ts` (`BOARD_RUNS_REL`), `apps/cli/src/commands/content-launch.ts:525`, `apps/board/src/contracts.ts:11,44,250`
- Follow-ups: G84 (in-board artifact editor), G85 (digest push notification)

### History

- 2026-11-26T04:19:35.554Z todo → wip (system)
- 2026-11-26T04:21:23.286Z wip → testing (system)
- 2026-11-26T04:21:25.357Z testing → done (system)

