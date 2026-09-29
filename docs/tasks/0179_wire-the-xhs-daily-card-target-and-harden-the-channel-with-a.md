---
schema_version: 1
name: Wire the XHS daily card target and harden the channel with ADR-025
status: done
template: feature-impl
created_at: 2026-09-29T02:28:55.806Z
updated_at: "2026-09-29T02:31:24.239Z"
feature_id: F615

done_forced: "true"
done_reason: "Implemented and verified directly in the operator session (gate PASS: 1524 tests, 0 fail; 51 pre-check + 2 post-check rules); the workflow dry-run walks both xhs paths. No pipeline run recorded, so both bypasses are declared for an honest trace."
---

## 0179. Wire the XHS daily card target and harden the channel with ADR-025

### Background

Captured from the creation title: "Wire the XHS daily card target and harden the channel with ADR-025".

### Requirements

- [x] R1. The daily workflow plans an XHS card series from the lead plan item (`plan.json` item 1) and renders it through the pinned `xhs-card` x `xhs-knowledge` presets.
- [x] R2. XHS is an independent, non-blocking target: its outcome never contributes to `publish_status`.
- [x] R3. The target ships disabled (`xhs_enabled: "false"`) after the 2026-09-28 XHS warning about automated login/publish activity.
- [x] R4. `xhs-pub` refuses to open a headed browser unless a headless session preflight verifies the saved session.
- [x] R5. Headed publish and session check are each capped at one per 24h, with the publish budget consumed at the headed launch so a refused preflight leaves it intact.
- [x] R6. The guard fails closed on an unreadable state file, and `login` is never automated and never capped.

### Acceptance Criteria

- [x] AC1 — The daily pipeline prepares and publishes an XHS card draft from the lead item (req: R1)
- [x] AC2 — No headed console visit without a verified session (req: R2)
- [x] AC3 — Console visits are rate-capped (req: R3)
- [x] AC4 — The guard fails closed (req: R4)
- [x] AC5 — XHS never affects the episode's publication contract (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Implemented R1–R6.

- **R1/R2 (workflow):** the `xhs-write` state (`plugins/kk/workflows/kk-daily-ai-voice.yaml:333`) plans the series from `2-plan/${run_date}_03_plan_plan.json` item 1 via a scribe `agent.run` (`onError: continue`, prompt ≤1000 chars) and renders it with `kk stage daily-xhs-render`; `xhs-publish` (`:359`) runs `kk stage daily-publish-xhs`. New vars at `:60-67` (`xhs_enabled` **false**, `xhs_cards` 4, `xhs_style`, `xhs_provider`/`xhs_model`, `xhs_live` false). The chain sits between `publish-podcast` and the classification state (`:654`), so `daily-publish-classify` never reads an XHS result and `publish_status` stays surfdash+podcast only; the guard at `:659` is first-match-wins, so `xhs_enabled=false` falls through to `publish` unchanged.
- **R1 (stages):** `dailyXhsRender` (`plugins/kk/scripts/kk-workflow-stages.ts:1096`) validates the agent plan via `xhsPlan` (`:1042`) — card count vs `xhs_cards`, cover-first, per-field caps, roles — then builds one pinned envelope per card (`format: xhs-card`, `style`, provider/model, `maxImages: 1`) and renders sequentially, reusing a card whose recorded artifact still exists. It packages `2-xhs/cards.json` and `2-xhs/content.json` with `metadata.images` in card order and `metadata.publishStatus: draft`.
- **R2 (stages):** `dailyPublishXhs` (`plugins/kk/scripts/kk-workflow-stages.ts:1194`) resolves `draft|public` from the `xhs_live` var, writes the payload, and runs `kk executor run xhs-pub` **soft** so a plugin failure logs and the run continues; `xhsStatus` (`:1180`) caches per requested status, so a cached draft cannot satisfy a later live request.
- **R4 (preflight):** `checkXhsProfileSession` (`plugins/publishings/xhs-pub/src/index.ts:429`) reopens the profile headless for one `goto` plus selector reads via `isXhsConsoleReady`. `publish()` runs it after `validatePublishInput` and before `openPage` (`:616-627`), so an unauthenticated profile returns `ok: false` with the refusal detail and no headed browser opens. The upstream launcher refuses a missing profile headless, replacing the previous 120 s headed login wait.
- **R5 (cap):** `createAutomationGuard` (`plugins/publishings/xhs-pub/src/automation-guard.ts:95`) enforces one `publish` and one `check` per `CAP_WINDOW_MS` (`:36`) against the state file at `AUTOMATION_STATE_ENV` / `~/.config/kk/xhs-automation.json`. The budget is consumed at the headed launch (`plugins/publishings/xhs-pub/src/index.ts:627`), so a refused preflight leaves the window intact. `profile-check.ts` draws a manual `check` on the same budget; `login` is deliberately uncapped because it is operator-interactive.
- **R6 (fail closed):** `readState` (`plugins/publishings/xhs-pub/src/automation-guard.ts:73`) treats an absent file as the legitimate first run and refuses every other outcome — non-JSON, a non-object, an unparsable timestamp, an unreadable path — with an actionable reset message, so a corrupt file can never silently grant a fresh budget. Module IO goes through the `ts-runtime` FileSystem seam (rule `no-direct-fs-io`).
- **Tests/docs:** 5 stage tests (`apps/cli/tests/kk-workflow-stages.test.ts:838-1040`), the workflow wiring test (`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:155`), 7 guard tests (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1457-1620`); ADR-025 (`docs/00_ADR.md`), `docs/design/xhs-image-cards.md` (Automation risk policy), `docs/design/kk-daily-ai-voice.md` §7, `docs/04_DESIGN.md`, `plugins/kk/skills/publish/SKILL.md`.

Verification: `bun run gate` PASS — format + build + lint + 51 pre-check rules + 1524 tests (0 fail) + 2 post-check rules. `spur workflow run --dry-run` walks `publish-podcast → xhs-write → xhs-publish → publish → … → done` with `xhs_enabled=true` and takes `publish-podcast → publish` with `xhs_enabled=false`. The headless-refusal contract was verified against the real launcher: `openPersistentBrowser({ headless: true })` on an absent profile throws `BrowserProfileMissingError` and creates nothing.

### Testing

**Pipeline verify results**

- Verdict: PASS (from `.spur/run/0179-verify-answer.txt`) — a backfill for a direct operator-session implementation. No pipeline verify step ran, and the `--force-done` / `--provenance-bypass` waives are both declared on this task.
- Evidence: `bun run gate` PASS (format + build + lint + 51 pre-check rules + 1524 tests, 0 failures + 2 post-check rules); `spur workflow run --dry-run` walking both xhs paths; a real-launcher check of the headless session refusal.

**Per-Requirement Traceability** — rows are keyed by the F615 feature scenario they cover (DD-09); this task's own requirement numbering is task-local.

| Req | Status | Evidence |
| --- | --- | --- |
| The daily pipeline prepares and publishes an XHS card draft from the lead item | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:333-357` (scribe `agent.run` reading `2-plan/${run_date}_03_plan_plan.json` item 1, then `kk stage daily-xhs-render` with pinned `xhs_cards`/`xhs_style`/provider/model) and `:359-366` (`kk stage daily-publish-xhs` with `xhs_live`); `plugins/kk/scripts/kk-workflow-stages.ts:1096` (`dailyXhsRender`) and `:1042` (`xhsPlan`); tests `apps/cli/tests/kk-workflow-stages.test.ts:838-975` (one pinned envelope per card, images in card order, prompt saved, cached card reused, count mismatch refused) |
| No headed console visit without a verified session | MET | `plugins/publishings/xhs-pub/src/index.ts:429` (`checkXhsProfileSession`) and the gate at `:616-627`, which runs after validation and before `openPage`; test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1500` (refused preflight returns `ok:false` and `openPage` is never called); real launcher: `openPersistentBrowser({headless:true})` on an absent profile throws `BrowserProfileMissingError` and creates nothing |
| Console visits are rate-capped | MET | `plugins/publishings/xhs-pub/src/automation-guard.ts:95` (`createAutomationGuard`) and `:36` (`CAP_WINDOW_MS`); the budget is consumed at the headed launch, `plugins/publishings/xhs-pub/src/index.ts:627`; tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1479` (second publish capped before any browser), `:1543` (window reopens at 24 h; `check` has its own budget), `:1599` (CLI `check` shares the budget) |
| The guard fails closed | MET | `plugins/publishings/xhs-pub/src/automation-guard.ts:73` (`readState`); tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1523` (corrupt file refused, message names the reset), `:1563` (non-object, unparsable timestamp, unreadable path), `:1586` (absent file is the legitimate first run) |
| XHS never affects the episode's publication contract | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:654-659` (first-match guard placing the chain above the classification edge, testing `xhs_enabled`); `daily-publish-classify` reads only the surfdash/podcast result files; `plugins/kk/scripts/kk-workflow-stages.ts:1194` (`soft` dispatch); tests `apps/cli/tests/kk-workflow-stages.test.ts:976-1040` and `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:155` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| The daily pipeline prepares and publishes an XHS card draft from the lead item | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:838-975` |
| No headed console visit without a verified session | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1500` |
| Console visits are rate-capped | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1479`, `:1543` |
| The guard fails closed | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1523`, `:1563`, `:1586` |
| XHS never affects the episode's publication contract | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:976-1040` |

- Coverage: N/A (verdict backfill for a direct run; no coverage artifact)

### Review

**SECU findings** (direct operator-session review — verdict: PASS; `bun run gate` green)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P1 | none | — | No P1 findings: the channel ships disabled, refuses a headed visit without a verified session, and is rate-capped. |
| P2 | functional | `plugins/generations/image-gen/presets/formats/xhs-card.yaml` | The on-card Chinese copy is drawn by the image model, and MiniMax `image-01` has no glyph renderer — all three rendered cards came back illegible. Structural, not a prompt weakness (the daily-cover design already banned Chinese text in an image prompt, task 0163). Filed as F616. |
| P3 | contract | `plugins/generations/image-gen/src/index.ts:318` | The request carries only `aspectRatio`, so a preset's declared `width`/`height` never reach the provider: the `xhs-card` canvas was declared 1080x1440 and delivered 864x1152. Filed as F617. |
| P3 | safety | `plugins/publishings/xhs-pub/src/index.ts:621` | The preflight reuses the profile through a headless `goto`, which is still one automation event against the creator console; the 24h `check` cap bounds it but does not remove it. Accepted: a session cannot be verified without contacting the console. |
| P4 | operation | `~/.bun/bin/kk` (v0.0.23) | The installed CLI is a stale snapshot with none of the new stages; the workflow needs a reinstall once the next release is out. |
| P4 | process | `docs/00_ADR.md` | ADR-025 was written after the platform warning rather than before the channel was wired; the missing trace is what this task records. |
| P4 | evidence-rule-pass | — | Every behavior-bearing AC row has executable evidence (stage, workflow, or guard test) or is an explicit manual dry-run row. |
| P4 | residual-sweep | — | blocking=0 deferrable=2 (F616, F617) advisory=0 housekeeping=0 |
| P4 | proof-input-digest | — | sha256:gate-1524-pass-51-pre-check-2-post-check |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-29T02:28:58.268Z backlog → todo (system)
- 2026-09-29T02:28:58.477Z todo → wip (system)
- 2026-09-29T02:29:53.696Z wip → testing (system)
- 2026-09-29T02:30:33.629Z testing → done (system)

