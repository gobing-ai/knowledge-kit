---
schema_version: 1
name: Ship the kk-music workflow with explore, select, judge and master gates
status: backlog
template: feature-impl
created_at: 2026-11-18T22:16:17.053Z
updated_at: "2026-11-19T03:55:08.080Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 8
dependencies: ["0400", "0401", "0402", "0405"]
---

## 0403. Ship the kk-music workflow with explore, select, judge and master gates

### Background

Implements: R1 — workflow with one human gate; R2 — explore in the delivery model; R3 — measured gates before and after master; R4 — artifacts and run report; R5 — dry-run and resume.

Existing workflows (`plugins/kk/workflows/kk-solo-podcast.yaml`, `kk-daily-ai-voice.yaml`, `kk-article-generate.yaml`) are `spur` state machines whose states shell out to `kk` verbs, with `agent.run` for authoring/judging and `hitl` for operator gates. The engine executes one node at a time, so fan-out is a `kk` verb, not engine concurrency. Shell actions and prompts are bounded by **ADR-115**, spur's workflow-composition budget. It is not defined in `docs/00_ADR.md`; it ships with spur and is enforced by `spur workflow validate`, which errors when a shell action exceeds 10 logical commands (warns above 5) and flags long or unpinned `agent.run` prompts. Precedent: kk caps `agent.run` prompts at 1000 characters (`apps/cli/tests/voice2-dag.test.ts:709`) and moves composition into the stage runner `plugins/kk/scripts/kk-workflow-stages.ts`. So each state is one `kk music` verb or one short `agent.run`; logic belongs in verbs, not YAML.

Music differs from the article/podcast pipelines in one decisive way: the model is single-turn, so "iterate" means paying for another whole take. The workflow spends deliberately: a small set of differentiated takes in the **delivery model**, a human pick, then measurement, judgement and loudness normalization of that one take.

**Re-scoped 2026-11-18: no Clip-explore → Pro-promote.** Clip is a different model (`lyria-3-clip-preview` vs `lyria-3-pro-preview`), fixed at about 30 s, and it ignores duration language (`app/docs/guide/01-lyria-models.md:11-12,32`). It cannot exhibit arrangement, structure timestamps, duration adherence or lyrics past 0:30, which are the very properties a Pro direction is chosen for, and nothing documents that a Clip render predicts a Pro render of the same prompt. The economics do not rescue it either: N directions cost `0.04N + 0.08` with Clip-explore against `0.08N` with Pro-explore. That breaks even at N=2 (both $0.16) and saves $0.04 per direction beyond that, while Pro-explore's chosen take is already the deliverable and Clip-explore's promoted Pro take can diverge from what was picked. So `explore` uses the format's own model, and selection *is* promotion.

### Requirements

- [ ] R1. Ship `plugins/kk/workflows/kk-music.yaml` (state machine): `prepare → brief → explore → select → analyze → check → judge → master → finalize`, terminal `done`, failure `failed`. Vars: topic/brief file, theme, format, works dir (run dir `<works>/kk-music/<topic-slug>/`), `directions`, agent, delivery profile, `auto`, `accept_revision`, `force` + `force_reason`, and the dry-run flag.
- [ ] R2. Encode the spend shape. `explore` produces `directions` differentiated briefs (default 2, never above `takesCap`) and one take per brief in the **format's model** (Pro for song/jingle/underscore, Clip for clip/loop). `select` is the only human gate (HITL), and `auto` skips it only when exactly one take exists. `analyze` runs on the selected take only. Re-running `explore` into the same run directory pays only for briefs without an existing take (0400 dedupe); anything else requires `force` + `force_reason`.
- [ ] R3. Gate progress on measurement, not opinion. `check` (`kk music check`, 0405 take checks) must exit 0 before `judge`. `judge` uses `agent.run` on content-judge with the `music-quality` rubric, gated through the existing confidence-aware `jq` filter. `master` is reached only on `PASS`, or on `NEEDS_REVISION` with `accept_revision=true`. `master` (`kk music master`, including 0405's delivery check) must exit 0 before `finalize`.
- [ ] R4. Keep artifacts per state under the run directory (briefs, kk prompt text, takes + sidecars, analysis, `checks.json`, `judge-input.md`, verdict, normalized file) and emit a run report naming spend (summed from take sidecars), instance ids, verdict, delivery profile with measured LUFS/true peak, and the final artifact path.
- [ ] R5. Make the workflow runnable with no spend (`KK_MUSIC_DRY_RUN=1`), and resumable after a failure at any state without re-paying: paid states skip work whose take sidecar or cached analysis already exists.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The pipeline shape is inspectable (req: R1)
  Given the shipped workflow
  When it is validated and dry-run by the engine
  Then every state is reachable from prepare and only select requires operator input
  And every state's shell action is a single kk music verb or an agent.run
  And spur workflow validate reports no ADR-115 error and every agent.run prompt is at most 1000 characters

Scenario: AC2 — Money is spent in the delivery model, once per direction (req: R2)
  Given a song-format run with directions 2 and a confirmed selection
  When the workflow executes in dry-run with the adapter call log captured
  Then explore issues exactly two pro generate requests and no clip request
  And analyze is requested for the selected take only
  And re-running explore into the same run directory issues no generate request
  And auto mode with two takes still stops at select

Scenario: AC3 — No unmeasured take is judged and no failed file is finalized (req: R3)
  Given one take whose check fails, one whose verdict is FAIL, one NEEDS_REVISION, and one PASS whose mastered output fails the delivery check
  When each run proceeds
  Then the failing-check run stops before judge with the measured value in checks.json
  And the FAIL run stops before master
  And the NEEDS_REVISION run reaches master only with accept_revision=true
  And the delivery-check failure stops before finalize

Scenario: AC4 — Artifacts and the run report are complete (req: R4)
  Given a completed dry-run
  When the run directory and report are inspected
  Then briefs, kk prompt text, every take with its sidecar, analysis, checks.json, judge-input.md, verdict and normalized file are present
  And the report lists spend equal to the sidecar sum, instance ids, verdict, delivery profile with measured LUFS and true peak, and the final path

Scenario: AC5 — Dry-run is free and resume does not re-pay (req: R5)
  Given a dry-run, then a run interrupted after explore and resumed
  When each executes
  Then the dry-run performs no network call
  And the resumed run issues no generate request for takes already on disk
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **One human gate, deliberately.** Selection is the only judgement a machine cannot make cheaply (musical taste). Everything else (spend order, measurement, gating, normalization) is deterministic. That keeps the workflow unattended-capable while the operator stays the only one who picks which take becomes the deliverable.
- **Explore in the delivery model (closed 2026-11-18).** See Background. If a future evidence round shows Clip renders do predict Pro renders for some theme, re-open as a per-format `explore_model` override. Do not build that override now.
- **Iteration is a new run, not a loop.** A NEEDS_REVISION verdict's feedback feeds `music-authoring iterate`, which writes a new brief. Re-entering `explore` with it is a new digest and therefore a new paid take. There is no automatic regenerate loop, because each loop iteration is real money.
- **State ownership.** Authoring is `agent.run` on `music-authoring`, judging is `agent.run` on `content-judge` with `music-quality`, and everything else is a `kk music` verb. No prompt prose in the YAML.
- **Resume seam.** Take sidecars and cached analysis decide what already exists, and a resumed run continues from the first state whose artifact is missing. The 0207 ledger is not consulted (it is a post-run token report).
- **Dependency.** Blocked by 0400, 0401, 0402 and 0405.
- **Estimate.** 7h: 9 states, vars, gates, artifact naming, dry-run/resume paths, engine dry-run validation. One state fewer than the first draft (no `promote`).

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)

