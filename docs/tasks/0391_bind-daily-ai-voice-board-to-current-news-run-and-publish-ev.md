---
schema_version: 1
name: Bind Daily AI Voice Board to current news run and publish evidence
status: done
template: feature-impl
created_at: 2026-11-18T04:22:19.984Z
updated_at: "2026-11-18T07:10:08.222Z"
feature_id: L3

estimate_hours: 8
done_forced: "false"
done_reason: unforced close
---

## 0391. Bind Daily AI Voice Board to current news run and publish evidence

### Background

The current native contribution lists kk-news-generate but its reader uses voice2 artifact selectors. The modern launcher does not call the legacy Board capture, and status already has a neutral generation projection from task 0378. Evidence: apps/cli/src/board/manifest.ts:484, apps/cli/src/launch.ts:553, apps/cli/src/commands/content.ts:336, apps/cli/src/board/reader.ts:463.

### Requirements

- [x] R1. Bind current launch attempts to the existing read-only Board evidence routes while preserving verified voice2 history (L3 R12).
- [x] R2. Project generation engine and episode states, current artifact references and per-target publish outcomes from the selected attempt/date. Distinguish missing, superseded and invalid evidence.
- [x] R3. Return bounded diagnostics or precise evidence references without trusting browser-supplied paths or reading unchecked receipts.

### Acceptance Criteria

- [ ] R12 — Current generation and publishing evidence is inspectable

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.753Z

**Ready decisions.** Capture generation attempt ownership inside the existing launch lock following the legacy capture authorization model. Extend current evidence additively rather than breaking existing Board consumers. Match publication by episode, bundle and plan identity; map final artifact ownership from producer events, including fallbacks. Offer 0390 DTO fixtures with null and explicit statuses. Treat new cap, path and receipt inputs as untrusted; never expose raw logs or credentials.

**Source premise.** `apps/cli/src/board/reader.ts:463` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay attempt replacement, foreign/symlink artifacts, late receipts and old voice2 routes. Check the fixture contract before handing to 0390.

### Design

Own CLI launch, capture and reader/DTO only. Under the generation lock, use existing capture trust and markers before the successful invocation mutates its workspace. Keep dry-run and refused starts effect-free. Current artifacts use a fixed map and recorded producer successes including fallbacks. Reuse the 0378 status projection and identify publish rows with bundle/plan/receipt provenance. Expose a typed additive summary containing generation stage and gate fields, attempt and date, publishing groups, artifact IDs and bounded issue references. Preserve historical readers; for uncaptured attempts expose only authorized Spur state and explain missing artifacts. Do not authorize arbitrary paths, surface raw logs, or add write endpoints. See docs/design/daily-ai-news-editorial-delivery.md.

### Plan

- [ ] Add repeatable launch/reader fixtures for in-flight, no-content, normal, missing capture, failed and superseded runs.
- [ ] Bind current launch to captured evidence using launcher ownership and existing reader safeguards. Add the current producer/artifact mapping.
- [ ] Reuse structured status and publish plan/outcome data. Include stable target IDs, attempt/window, live/draft/dummy/skipped/failed/uncertain/missing status and exact safe diagnostics or evidence references.
- [ ] Verify corrupt receipts, same-date regeneration, fallback voice, concurrent owner change, outside symlink, legacy caller compatibility and bounds. Document the DTO with examples for 0390.

### Solution

## Solution — change map (implement step)

Binding point (Q&A: capture under the existing launch lock, legacy capture authorization model):

1. `apps/cli/src/launch.ts` — `launchWorkflow` calls the shared `captureRun` seam after the lock is
   held and preflight passes, before the `running` receipt and the child spawn (dry-run and refused
   starts stay effect-free; `kk-publish` is not a Board workflow and is never captured). Settings
   snapshot = launch vars ∩ the workflow's allowlist (`skip_review` for news). Stamp = the resolved
   run. Unsafe capture identity → skip with a receipt note; a refused revocation / workspace-shape
   throw refuses the launch (exit 5) before any workspace mutation. New optional `capture` dep seam
   on `LaunchDeps`: production binds the real `captureRun` with `trustedWorksRoot: worksDir` (same
   posture as `kk daily prepare`); the launch-test harness overrides it with a hermetic no-op like
   every other dep, so legacy launch tests stay untouched and pollution-free.

2. `apps/cli/src/board/manifest.ts` — additive `NEWS_GENERATE_ARTIFACTS` (fixed map keyed to the
   `kk-news-generate` DAG node ids; patterns are the shared daily stage bodies) and optional
   `producerFallbackNodes` on `ArtifactSpec` so voice/fallback and curate/fix chains authorize the
   same fixed file from whichever node passed. `artifactsFor('kk-news-generate')` returns the news
   map; voice2 history keeps `DAILY_VOICE_ARTIFACTS`; funnel sanitization extends to the news ids.

3. NEW `apps/cli/src/board/news.ts` — the news projection (`projectNewsResults`): the 0378 status
   building blocks (`progressPayload`, `gatePayload`) reused verbatim; bounded launch-attempt fields
   from `schedule-receipt.json`; engine-chain attempts from the DAG action rows; per-window publish
   groups over the fixed `PublishWindowSchema` vocabulary from `4-publish/plan.<window>.json`,
   `receipts/<id>.json` and `outcome.<window>.json`, each row bound by date + bundle/parent identity
   + plan digest, with bounded diagnostics and no unchecked receipt ever surfaced; artifact issues
   referenced by id + availability, never by client paths. All recorded files parse through
   `parseJsonOrNull` so malformed JSON becomes a `*-invalid` diagnostic, never a throw.

4. `apps/cli/src/board/collect.ts` + `apps/cli/src/board/reader.ts` — the containment/bounded-read
   core of `observe` extracted as `observeRelative` and shared with the news projection; reader
   dispatches `kk-news-generate` results to the news projection; additive read-only route
   `GET /api/workflows/<w>/runs/<id>/evidence` (same loopback/origin/authorization guards):
   captured runs answer the full projection; uncaptured attempts answer only authorized Spur state
   plus an explicit uncaptured diagnostic. Existing `results`/`config`/`artifacts` routes and codes
   are unchanged (voice2 history preserved).

5. NEW `docs/design/board-evidence-dto.md` (beside the declared design file) — the typed DTO with
   JSON examples per scenario for 0390 (normal, in-flight, no-content, failed, missing capture,
   superseded, mixed publish windows).

Tests: NEW `apps/cli/tests/board/news.test.ts` (projection scenarios incl. fallback engine, same-date
regeneration, corrupt receipts, provenance mismatch), extended `apps/cli/tests/board/reader.test.ts`
(evidence route captured/uncaptured, news ids, legacy voice2 results regression), extended
`apps/cli/tests/launch.test.ts` (capture ordering under the lock, effect-free dry-run/refusals,
capture refusal before child, publish skip, settings snapshot), and the 0369 allowlist test updated
to the 0391 manifest contract (news owns its artifact map; the settings allowlist still follows the
voice2 family).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/launch.ts:640-655` — capture binds under the held lock after preflight, before the running receipt and child; refusal exits 5 before any mutation; `kk-publish` never captured (`launch.test.ts:815`, `:949`); read-only routes preserved and voice2 history regression-tested (`apps/cli/src/board/reader.ts:807`, `apps/cli/tests/board/reader.test.ts:955`) |
| R2 | MET | `apps/cli/src/board/news.ts:469` — generation stage (gate/launch/engines/progress from DAG rows incl. fallback chains, `news.test.ts:443`) + per-window publish groups bound by date + bundle/parent identity + plan digest with `missing`/`superseded`/`uncertain`-vs-`invalid` distinctions (`news.test.ts:223`, `:276`, `:325`, `:349-360`); artifacts via `NEWS_GENERATE_ARTIFACTS` (`apps/cli/src/board/manifest.ts:415`) |
| R3 | MET | `apps/cli/src/board/news.ts:43` + `:317` — receipt ids are safe tokens only, never plan-derived paths; bounded diagnostics (16 cap, 240-char text cap) referencing fixed workspace-relative evidence; containment via `apps/cli/src/board/collect.ts:267`; a stale/malformed launch receipt is reported, never treated as this attempt's state (`news.test.ts:406`, `:417`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R12 — Current generation and publishing evidence is inspectable | MET | test | `GET /api/workflows/<w>/runs/<id>/evidence` envelope (`apps/cli/src/board/reader.ts:524-583`, route `:807`): captured runs serve capture metadata + authorized run state + full news projection, uncaptured attempts serve Spur state + `board.evidence.uncaptured`, malformed capture record → 422 (`apps/cli/tests/board/reader.test.ts:896-953`); DTO contract with per-scenario examples for 0390 (`docs/design/board-evidence-dto.md`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- docs/design/daily-ai-news-editorial-delivery.md — current Board evidence design.
- apps/cli/src/board/reader.ts:463 — the authorized projection.
- apps/cli/src/board/manifest.ts:484 — per-workflow artifact selection.
- apps/cli/src/commands/content.ts:336 — existing status.
- docs/tasks/evidence/0369/20261117/index.md — recorded mixed publish results.

### History

- 2026-11-18T04:23:14.442Z backlog → todo (system)
- 2026-11-18T05:56:40.281Z todo → wip (system)
- 2026-11-18T07:10:07.396Z wip → testing (system)
- 2026-11-18T07:10:08.217Z testing → done (system)

