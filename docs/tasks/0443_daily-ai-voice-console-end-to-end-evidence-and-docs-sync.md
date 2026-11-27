---
schema_version: 1
name: Daily AI Voice console end-to-end evidence and docs sync
status: done
template: feature-impl
created_at: 2026-11-26T00:29:45.939Z
updated_at: "2026-11-27T19:46:48.579Z"
feature_id: G83
priority: P2
tags:
  - board
  - daily-ai-voice
  - e2e
  - docs

dependencies: ["0440", "0441", "0442"]
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
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

- [x] R1. A fixture works root with days 20261115–20261125, including:
  - a shipinhao `effect: none` failure;
  - an engine-fallback day;
  - a window whose plan exists with no launch receipt, which reads `unknown`.
- [x] R2. A browser E2E drives the module against a reader on the fixture. It commits renders of Today, Generation, Publishing and History, plus one previewed and confirmed `publish-window --dummy` action that uses a stub `kk` on PATH.
- [x] R3. `kk news digest` markdown/JSON parity with the Today DTO is asserted.
- [x] R4. `docs/04_DESIGN.md`, `docs/03_ARCHITECTURE.md`, `docs/05_FEATURES.md` and the satellite describe the shipped routes, verb, tabs and action envelope.

### Acceptance Criteria

- [x] AC1 — Surface docs and end-to-end evidence ship with the change

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

| File | Lines | What / why |
| --- | --- | --- |
| `apps/cli/src/board/reader.ts` | 705-736 | The day routes now carry `board.actions.enabled` into the digest (read once per reader process through `actionsEnabledFromConfig`). Without it the console rendered recipes-only even with the plane on, so the previewed-launch path was unreachable — the E2E's first run is what exposed it. |
| `apps/cli/src/commands/content.ts` | 527-534 | `kk news digest` resolves the same switch, so the verb's `--json` output is object-identical to `GET /api/days/<day>` (R3 parity) instead of diverging on `actions.enabled`. |
| `apps/board/tests/daily-voice-console.e2e.test.ts` | 1-560 | The repeatable acceptance (R2/R3): builds the fixture project (eleven days + a minimal `kk-news-generate` definition + real runs under the fixture's run ids), starts the Board and the reader on it with a stub `kk` first on PATH, drives the console in Chromium, asserts DOM before pixels, commits renders + `argv.log` + `digest.json`. Timeouts are per-test (a navigation does not fit bun's 5 s default); each visit gets a distinct URL so a hash-only jump cannot leave the previous tab mounted. |
| `apps/board/tests/fixtures/daily-voice-days/**` | 162 files | The frozen fixture (design §7): `.works/.board/runs/<runId>.json` capture records plus `kk-news-generate/<day>/` evidence for 20261115–20261125. Capture records carry `__PROJECT_ROOT__`/`__WORKS_ROOT__` placeholders because a record names an absolute workspace path; the test rewrites them on copy. Shapes covered: clean, engine-fallback, safety-revise, generation-failed (open step = resume node), plan-without-launch-receipt, pool refusal, provenance mismatch, running, unrun past window, dummy-only, and the 2026-11-25 shipinhao `effect: none` failure. |
| `apps/board/tests/artifacts/daily-voice-console/{today,generation,publishing,history,action}.png`, `argv.log`, `digest.json` | — | The committed evidence: five renders, the stub's recorded argv (asserted equal to the previewed recipe) and the parity digest. |
| `biome.json` | 21-22 | Fixture and artifact trees are data, not source: `step-timing.json` is JSONL, which the JSON parser rejects, and the committed renders are bytes. Excluding the two folders keeps the gate honest without renaming product-read files. |
| `docs/04_DESIGN.md` | 64, 426-441, 556-577 | Index row → shipped; the day routes document the `actions.enabled` carry and the parity it establishes; the console paragraph records the Actions tab's launch surface and the E2E's artifact paths. |
| `docs/03_ARCHITECTURE.md` | 707-731 | The seam, corrected from "design" to shipped and to what the code does: day-directory authoritative (kk-publish Spur runs are not joined), `no-launch-receipt` ⇒ `unknown`, one projection behind three consumers, the action plane's gate order, and the verification entry point. |
| `docs/05_FEATURES.md` | 115 | G83 `🔶 partial` → `✅ done` with 0439–0443 recorded. |
| `docs/design/daily-voice-ops-console.md` | 5, 253-272 | Satellite `status: design` → `shipped`; §7 records the built test, fixture and artifact paths plus the two things the run settled (fixture placeholders, the digest's `actions.enabled` carry). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — fixture works root, days 20261115–20261125, incl. shipinhao `effect: none` failure, an engine-fallback day, and a window whose plan has no launch receipt reading `unknown` | MET | `apps/board/tests/fixtures/daily-voice-days/kk-news-generate/` (11 days) + the `describe('the fixture works root (R1)')` assertions at `apps/board/tests/daily-voice-console.e2e.test.ts:481-507`; the `effect: none` day is `20261125` (`4-publish/receipts/video.shipinhao.json`), the fallback day `20261116` (`step-timing.json`), the unbound window `20261119` (`plan.cn-peak.json` with no `schedule-receipt.cn-peak.json`) asserted `unknown` / `no-launch-receipt` |
| R2 — browser E2E drives the module against a reader on the fixture; commits renders of Today, Generation, Publishing, History plus one previewed and confirmed `publish-window --dummy` action with a stub `kk` on PATH | MET | `apps/board/tests/daily-voice-console.e2e.test.ts:510-620` (DOM assertions then screenshots) and `:621-704` (preview argv equality, stub launch, `actions.jsonl` audit, refusal matrix); artifacts `apps/board/tests/artifacts/daily-voice-console/{today,generation,publishing,history,action}.png`, `argv.log`, `digest.json` |
| R3 — `kk news digest` markdown/JSON parity with the Today DTO asserted | MET | `apps/board/tests/daily-voice-console.e2e.test.ts:578-608`: `--json` output `toEqual` the reader's `DailyDigest`, markdown checked against the same figures; both surfaces now resolve `actions.enabled` identically (`apps/cli/src/board/reader.ts:713-735`, `apps/cli/src/commands/content.ts:527-534`) |
| R4 — `04`, `03`, `05` and the satellite describe the shipped routes, verb, tabs and action envelope | MET | `docs/04_DESIGN.md:64,426-441,556-586`, `docs/03_ARCHITECTURE.md:707-731`, `docs/05_FEATURES.md:115`, `docs/design/daily-voice-ops-console.md:5,172-186` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Surface docs and end-to-end evidence ship with the change | MET | test | the E2E above (12/12 pass, 59 expectations; the batch's light gate reported 6/6 checks PASS) together with the four doc edits cited in R4 |
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

- 2026-11-27T08:35:28.300Z todo → wip (system)
- 2026-11-27T08:47:32.179Z wip → testing (system)
- 2026-11-27T08:47:33.214Z testing → done (system)

