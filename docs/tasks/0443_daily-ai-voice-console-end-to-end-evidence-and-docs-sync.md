---
schema_version: 1
name: Daily AI Voice console end-to-end evidence and docs sync
status: todo
template: feature-impl
created_at: 2026-11-26T00:29:45.939Z
updated_at: "2026-11-26T01:09:21.230Z"
feature_id: G83
priority: P2
tags:
  - board
  - daily-ai-voice
  - e2e
  - docs

dependencies: ["0440", "0441", "0442"]
estimate_hours: 6
---

## 0443. Daily AI Voice console end-to-end evidence and docs sync

### Background

Feature G83: one repeatable E2E over fixture days proves the console, digest and action plane together, and the derived docs catch up.

Implements: R13 — Surface docs and end-to-end evidence ship with the change

Design: docs/design/daily-voice-ops-console.md §7.

**Refine corrections (2026-11-25)** — premises audited against the current tree:

1. **R1 "unbound publish run" is restated as "window launched without a receipt".** Publish evidence is file-based (0439 correction 1), so the realistic gap is a `4-publish/plan.<window>.json` with no `schedule-receipt.<window>.json`. It must read `unknown` (`no-launch-receipt`), not success.
2. **Browser harness:** Playwright `1.55.0` (root `package.json:21`; `apps/board/package.json` `catalog:`). `apps/board/tests/installed-board.test.ts` already drives a real Chromium against the installed Board. Reuse its launch and teardown pattern; do not add a new harness.
3. `docs/05_FEATURES.md` exists. `docs/04_DESIGN.md:64` holds the design-index row for the satellite.

### Requirements

- [ ] R1. A fixture works root with days 20261115–20261125, including:
  - a shipinhao `effect: none` failure;
  - an engine-fallback day;
  - a window whose plan exists with no launch receipt, which reads `unknown`.
- [ ] R2. A browser E2E drives the module against a reader on the fixture. It commits renders of Today, Generation, Publishing and History, plus one previewed and confirmed `publish-window --dummy` action that uses a stub `kk` on PATH.
- [ ] R3. `kk news digest` markdown/JSON parity with the Today DTO is asserted.
- [ ] R4. `docs/04_DESIGN.md`, `docs/03_ARCHITECTURE.md`, `docs/05_FEATURES.md` and the satellite describe the shipped routes, verb, tabs and action envelope.

### Acceptance Criteria

- [ ] AC1 — Surface docs and end-to-end evidence ship with the change

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T01:09:03.468Z

- **Q: Isn't the "unbound publish run" fixture impossible under file-based windows?** A: Yes. It is replaced by "plan without launch receipt", which exercises the same R12 truthfulness rule.
- **Q: Where does the E2E config live?** A: In a temp config file passed via the env, so the test never writes `~/.config/kk`.

### Design

**Chosen.** One fixture-backed browser E2E with a committed artifact. E2E is the project's preferred evidence over unit tests, and the fixture makes it repeatable without live channels.

**Rejected.** Running against the operator's live `.works`. It is non-repeatable and could touch real publish state.

**Frozen:**
- Fixture: `apps/board/tests/fixtures/daily-voice-days/kk-news-generate/<day>/`. It holds minimal `schedule-receipt*.json`, `step-timing.json`, `4-publish/*` and safety files, plus `.board/runs/*.json` capture records.
- Test: `apps/board/tests/daily-voice-console.e2e.test.ts`, on Playwright `1.55.0` following the `installed-board.test.ts` launch and teardown.
- The stub `kk` is a script on a temp `PATH` that appends its argv to a file and prints `{"runId":"stub-1"}`.
- Artifacts:
  - `apps/board/tests/artifacts/daily-voice-console/{today,generation,publishing,history,action}.png`
  - `argv.log` (the recorded stub argv, asserted equal to the previewed `Recipe.argv`)
  - `digest.json`
- Board config: actions enabled through a temp `KK_CONFIG` path. The operator's `~/.config/kk` is never touched.

**Anti-patterns:**
- A live publish.
- A real `kk` on PATH during the action step.
- Screenshots as the only assertion. DOM assertions come first; screenshots are the artifact.

**Docs sync:**
- `04` §1: `kk news digest`, `/api/days*`, `/api/actions/*`, `board.actions.enabled`.
- `03`: the reader write seam, the action plane and the file-based window premise.
- `05`: G83 status.
- Satellite status: `design` → `shipped`.

**Tests:**

| AC | Covers |
| --- | --- |
| AC1 | the E2E above, plus a parity assertion between the `kk news digest --json` output and `GET /api/days/<day>` |

### Plan

- Build the fixture days.
- Write the E2E and capture renders.
- Parity assertion for the digest.
- Docs sync and satellite status → shipped.

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
