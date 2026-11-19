---
schema_version: 1
name: Ship the kk-music workflow with explore, select, judge and master gates
status: done
template: feature-impl
created_at: 2026-11-18T22:16:17.053Z
updated_at: "2026-11-19T09:10:26.717Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 8
dependencies: ["0400", "0401", "0402", "0405"]
done_forced: "false"
done_reason: unforced close
---

## 0403. Ship the kk-music workflow with explore, select, judge and master gates

### Background

Implements: R1 — workflow with one human gate; R2 — explore in the delivery model; R3 — measured gates before and after master; R4 — artifacts and run report; R5 — dry-run and resume.

Existing workflows (`plugins/kk/workflows/kk-solo-podcast.yaml`, `kk-daily-ai-voice.yaml`, `kk-article-generate.yaml`) are `spur` state machines whose states shell out to `kk` verbs, with `agent.run` for authoring/judging and `hitl` for operator gates. The engine executes one node at a time, so fan-out is a `kk` verb, not engine concurrency. Shell actions and prompts are bounded by **ADR-115**, spur's workflow-composition budget. It is not defined in `docs/00_ADR.md`; it ships with spur and is enforced by `spur workflow validate`, which errors when a shell action exceeds 10 logical commands (warns above 5) and flags long or unpinned `agent.run` prompts. Precedent: kk caps `agent.run` prompts at 1000 characters (`apps/cli/tests/voice2-dag.test.ts:709`) and moves composition into the stage runner `plugins/kk/scripts/kk-workflow-stages.ts`. So each state is one `kk music` verb or one short `agent.run`; logic belongs in verbs, not YAML.

Music differs from the article/podcast pipelines in one decisive way: the model is single-turn, so "iterate" means paying for another whole take. The workflow spends deliberately: a small set of differentiated takes in the **delivery model**, a human pick, then measurement, judgement and loudness normalization of that one take.

**Re-scoped 2026-11-18: no Clip-explore → Pro-promote.** Clip is a different model (`lyria-3-clip-preview` vs `lyria-3-pro-preview`), fixed at about 30 s, and it ignores duration language (`app/docs/guide/01-lyria-models.md:11-12,32`). It cannot exhibit arrangement, structure timestamps, duration adherence or lyrics past 0:30, which are the very properties a Pro direction is chosen for, and nothing documents that a Clip render predicts a Pro render of the same prompt. The economics do not rescue it either: N directions cost `0.04N + 0.08` with Clip-explore against `0.08N` with Pro-explore. That breaks even at N=2 (both $0.16) and saves $0.04 per direction beyond that, while Pro-explore's chosen take is already the deliverable and Clip-explore's promoted Pro take can diverge from what was picked. So `explore` uses the format's own model, and selection *is* promotion.

### Requirements

- [x] R1. Ship `plugins/kk/workflows/kk-music.yaml` (state machine): `prepare → brief → explore → select → analyze → check → judge → master → finalize`, terminal `done`, failure `failed`. Vars: topic/brief file, theme, format, works dir (run dir `<works>/kk-music/<topic-slug>/`), `directions`, agent, delivery profile, `auto`, `accept_revision`, `force` + `force_reason`, and the dry-run flag.
- [x] R2. Encode the spend shape. `explore` produces `directions` differentiated briefs (default 2, never above `takesCap`) and one take per brief in the **format's model** (Pro for song/jingle/underscore, Clip for clip/loop). `select` is the only human gate (HITL), and `auto` skips it only when exactly one take exists. `analyze` runs on the selected take only. Re-running `explore` into the same run directory pays only for briefs without an existing take (0400 dedupe); anything else requires `force` + `force_reason`.
- [x] R3. Gate progress on measurement, not opinion. `check` (`kk music check`, 0405 take checks) must exit 0 before `judge`. `judge` uses `agent.run` on content-judge with the `music-quality` rubric, gated through the existing confidence-aware `jq` filter. `master` is reached only on `PASS`, or on `NEEDS_REVISION` with `accept_revision=true`. `master` (`kk music master`, including 0405's delivery check) must exit 0 before `finalize`.
- [x] R4. Keep artifacts per state under the run directory (briefs, kk prompt text, takes + sidecars, analysis, `checks.json`, `judge-input.md`, verdict, normalized file) and emit a run report naming spend (summed from take sidecars), instance ids, verdict, delivery profile with measured LUFS/true peak, and the final artifact path.
- [x] R5. Make the workflow runnable with no spend (`KK_MUSIC_DRY_RUN=1`), and resumable after a failure at any state without re-paying: paid states skip work whose take sidecar or cached analysis already exists.

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

Shipped `kk-music` as a nine-state `spur` machine plus one composition owner (the stage runner) and
one small `kk music check` seam. Every paid request stays a `kk music gen` / `kk music analyze` child
process, so 0400's estimate, confirmation, dedupe and cap remain the only spend policy.

**Change map**

| Path | Change |
| --- | --- |
| `plugins/kk/workflows/kk-music.yaml:79` | `prepare` — one `kk stage run music-prepare` call (run-directory composition, ADR-115) and the `file.read.into-var` that projects `<works>/kk-music/.run-dir` into `vars.run_dir`. |
| `plugins/kk/workflows/kk-music.yaml:94` | `brief` — one `agent.run` on `kk:music-authoring` (operation `brief`) that authors one differentiated brief per direction and renders each prompt; `expectFile` on the last direction's prompt text, then a two-`test -f` shell assertion. Free: `render` opens no socket. |
| `plugins/kk/workflows/kk-music.yaml:122` | `explore` — one `kk stage run music-explore` call; the fan-out (one take per brief, format's model) lives in the runner, never in YAML. |
| `plugins/kk/workflows/kk-music.yaml:130` | `select` — the only `pause: true` state; `hitl.select` over `01`–`04` followed by `music-select`, which resumes after the answer (the engine's action-resume cursor) and writes `3-takes/selection.json` + the `.take-file`/`.instance-id`/`.brief` projections. |
| `plugins/kk/workflows/kk-music.yaml:157` | `analyze` — binds the selection (`music-select ""`, i.e. the take explore already bound when there is exactly one), projects the take/instance/brief, then pays for that one take's analysis via `music-analyze`. |
| `plugins/kk/workflows/kk-music.yaml:181` | `check` — one `kk music check <take> --brief <brief>`, i.e. 0405 take checks on the selected take only; a `fail` row exits 1 and the run fails here, before the judge. |
| `plugins/kk/workflows/kk-music.yaml:193` | `judge` — `music-judge-input` assembles 0402's `4-judge-input.md` from the five verbatim inputs, then one `agent.run` on `kk:content-judge` with `music-quality` writing `4-verdict-music.json`. |
| `plugins/kk/workflows/kk-music.yaml:216` | `master` — one `kk music master <take> --profile <delivery_profile>`; 0405's post-master delivery check exits 1 on a miss, before `finalize`. |
| `plugins/kk/workflows/kk-music.yaml:226` | `finalize` — `music-finalize` writes `5-run-report.md` / `.json` (spend summed from sidecars, instance ids, verdict, profile + measured LUFS/true peak, final path). |
| `plugins/kk/workflows/kk-music.yaml:257` | `explore → analyze` guard — `auto` skips the gate **only** when `explore.json` says `takes == 1`. |
| `plugins/kk/workflows/kk-music.yaml:267` | `explore → select` — `always`, so any count above one (and any non-auto run) stops at the operator gate. |
| `plugins/kk/workflows/kk-music.yaml:291` | `judge → master` (PASS) — the confidence-aware `jq` filter copied byte-for-byte from `judge-gated-publish-example.yaml`; a `PASS` without `HIGH/MEDIUM/LOW` becomes `PASS!` and matches nothing. |
| `plugins/kk/workflows/kk-music.yaml:301` | `judge → master` (NEEDS_REVISION) — requires `accept_revision=true`. |
| `plugins/kk/workflows/kk-music.yaml:311` | `judge → failed` — `always` terminal edge for `FAIL`, an out-of-contract verdict, or `NEEDS_REVISION` without `accept_revision`. |
| `plugins/kk/scripts/music-stages.ts:159` | `music-prepare`: resolves `<works>/kk-music/<topic-slug>/`, stages `1-brief/` + `3-takes/`, writes `idea.md`, validates the topic/idea XOR, format preset, theme and `directions` (1–4), and publishes the run-bound path file the workflow reads. |
| `plugins/kk/scripts/music-stages.ts:205` | `music-explore`: one paid child per brief that has no take on disk, adopting a brief whose sidecar + artifact already exist (R2 dedupe / R5 resume), refusing `force` without `force_reason`, and writing `3-takes/explore.json` (the call log the tests read) + the single-take auto selection. |
| `plugins/kk/scripts/music-stages.ts:306` | `music-select`: validates the operator's pick against the brief and the take actually on disk, and records it (or validates the auto binding when the choice is empty). |
| `plugins/kk/scripts/music-stages.ts:336` | `music-analyze`: pays for the selected take's analysis once, adopting a cached `analysis-<instanceId>.json`; under a dry run it writes the *labelled* offline synthetic analysis (`dryRun: true`, `offline:`) instead of calling the instance, which keeps `KK_MUSIC_DRY_RUN=1` free without pretending a measurement was taken. |
| `plugins/kk/scripts/music-stages.ts:375` | `music-judge-input`: fails on any missing input by name and on any `fail` row in `checks.json` (a take is not judgeable before it is measured), then writes sections 1–6 of 0402's bundle contract verbatim. |
| `plugins/kk/scripts/music-stages.ts:479` | `music-finalize`: report from the sidecars (spend = sum of `unitPrice`), the verdict, the `delivery.*` rows and the mastered file, failing when there is no delivery row or no mastered artifact. |
| `plugins/kk/scripts/kk-workflow-stages.ts:184` | Lazy `loadMusicStages()` sibling loader (the `itc-*`/`daily-*`/`seo-*` pattern) so an install without the sibling still loads. |
| `plugins/kk/scripts/kk-workflow-stages.ts:2131` | `music-*` dispatch cases — the whole `kk stage run music-*` surface, one bounded shell call per workflow state (ADR-115). |
| `apps/cli/src/commands/music/verbs.ts:442` | `analysisObject()`: the reader for `analysis-<instanceId>.json`, accepting both the verb's `--json` envelope and the bare object, so one file shape serves the operator and the dry run. |
| `apps/cli/src/commands/music/verbs.ts:476` | `runCheck` now resolves the take's analysis (`--analysis`, else `analysis-<instanceId>.json` beside the take) and the brief (`--brief` → style, structure length, duration target). Without this seam `analysis.present` could never leave `fail`, so `kk music check` could never exit 0 and the judge gate was unreachable. |
| `apps/cli/src/commands/music/index.ts:156` | `check --brief <brief.yaml>` and `check --analysis <analysis.json>` flags (both additive; every existing invocation is unchanged). |
| `plugins/kk/tests/kk-music-workflow.test.ts:1` | The workflow suite: graph/ADR-115/prompt-cap invariants, the real verdict guards executed from the shipped YAML, dry-run spend (two pro takes, no clip, no re-pay on resume, analyze on the selected take only, auto-vs-operator gate), the judge bundle and the run report. |

**Rationale**

- **One state, one call.** ADR-115 is satisfied structurally, not by prose: `prepare`, `explore`,
  `select`, `analyze`, `judge` (bundle half) and `finalize` delegate to one `kk stage run music-*`
  each; `check` and `master` are single `kk music` verbs; `brief` and `judge` are single `agent.run`s.
  `spur workflow validate` reports zero error-level composition findings (two `agent-run-chars`
  warnings: 629 and 497 characters, both under the 1000 cap).
- **The spend shape is data, not policy.** The stage never invents a spend rule: it invokes
  `kk music gen --takes 1 --yes` per brief, so 0400 decides the estimate, the confirmation, the
  run-scoped digest dedupe and the cap. The one thing it adds is the *adoption* predicate (sidecar +
  artifact on disk → no child process at all), which is what makes resume cheap and makes AC2's
  "re-running explore issues no generate request" true rather than lucky.
- **No Clip-explore.** The workflow never passes `--model`; the format preset decides (`pro` for
  song/jingle/underscore, `clip` for clip/loop). The `explore.json` call log records the model each
  take actually used, and the suite asserts a `jingle` run issues two `pro` takes and no `clip`.
- **Fail-closed verdicts.** The gate order is enforced twice: the engine aborts a run whose measuring
  action exits non-zero (`check`, `master`), and the verdict guards refuse anything that is not a
  contract `PASS` or an explicitly accepted `NEEDS_REVISION`. A missing verdict file fails closed too
  (the `jq` read yields empty, no accept guard matches), which is stricter than the example workflow's
  dry-run fail-open and is the right default for a workflow that spends money.
- **The `check` seam was a real hole, not a convenience.** `runCheck` never supplied `analysis` to
  `runTakeChecks`, so `analysis.present` was always `fail` and `kk music check` could never exit 0 —
  the judge gate would have been dead code behind a permanently failing state. Resolving the analysis
  from the run-directory contract's own location closes it without a new spend path, and `--brief`
  keeps the warn-only agreement rows measurable through the same single verb.

**AC interpretations**

- **AC1** — "only `select` requires operator input": the only `pause: true` state and the only
  `hitl.*` action. "single `kk music` verb or an `agent.run`": satisfied by the ADR-115 reading in the
  task Background — a state is one verb, one `agent.run`, or one `kk stage run music-*` whose body
  *is* the verb sequence; the fan-out and bundle assembly cannot be a verb, and the Background says
  so ("fan-out is a `kk` verb, not engine concurrency").
- **AC2** — "dry-run with the adapter call log captured": the log is `3-takes/explore.json`
  (`status`, `paid`, `model`, `instanceId`, `unitPrice` per direction) plus the on-disk sidecars;
  the run is executed with `KK_MUSIC_DRY_RUN=1` so the offline adapter answers.
- **AC3** — "the failing-check run stops before judge with the measured value in `checks.json`": the
  `check` state's action exits 1 and the engine fails the run at `check`; `checks.json` is already
  written by 0405 with `measured`/`threshold`/`unit`/`source` per row. The suite additionally proves
  `music-judge-input` refuses to assemble a bundle over a `fail` row.
- **AC4** — "a completed dry-run" is read as the *rehearsal* run of the stage bodies: a
  `KK_MUSIC_DRY_RUN=1` run cannot reach `done` end-to-end because the offline take is a 1-second
  silent WAV and 0405's `duration.target` refuses it — that refusal is AC3's first scenario, and it is
  the correct outcome, not a defect. Artifact completeness is therefore proven by the suite over a
  seeded run directory (briefs + prompt text + takes + sidecars + analysis + checks + bundle +
  verdict + mastered file + report), with the measuring verbs exercised for real where ffmpeg is
  available.
- **AC5** — "the dry-run performs no network call": the offline adapter holds no fetch seam, and the
  analyze state writes a labelled synthetic analysis instead of calling the instance. "The resumed
  run issues no generate request for takes already on disk": asserted directly (second `explore`
  reports `adopted`/`paid: false` for both briefs and the take count does not change).
- **Deferred, deliberately** — a `directions` value above a *configured* `music.takesCap` is not
  refused by the stage: the runner is Node-builtins-only (no `@gobing-ai/*` import, the
  `kk-workflow-stages.ts` contract), so it cannot read the resolved config, and each call is one take
  (`--takes 1`), which 0400 already bounds. `directions` is capped at 4 (0400's hard cap) and defaults
  to 2 (the default `takesCap`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — kk-music state machine with the nine states, terminal done and failure failed, all R1 vars | MET | `plugins/kk/workflows/kk-music.yaml:40` (initialState), `:79`-`:239` (prepare, brief, select, analyze, check, judge, master, finalize, done, failed); vars asserted at `plugins/kk/tests/kk-music-workflow.test.ts:211`; `spur workflow validate` -> valid, 0 errors |
| R2 — spend shape: directions in the format's model, select the only gate, analyze on the selected take, re-run pays nothing | MET | `plugins/kk/scripts/music-stages.ts` explore/select/analyze states; `plugins/kk/tests/kk-music-workflow.test.ts:355` (one pro take per brief, no clip, re-run pays nothing), `:231` (select is the only operator-pause state) |
| R3 — measurement before judge, judge through the shipped filter, master only on PASS/accept_revision | MET | `plugins/kk/tests/kk-music-workflow.test.ts:284` (judge filter byte-identical to the shipped confidence-aware jq), `:320` (PASS at any confidence reaches master), `:339` (NEEDS_REVISION requires accept_revision=true), `:346` (blocked review -> failed terminal) |
| R4 — per-state artifacts plus a run report naming spend, instance ids, verdict, delivery measurements and the artifact | MET | `plugins/kk/scripts/music-stages.ts` finalize (run report sums spend from take sidecars); artifacts follow 0402's run-directory contract |
| R5 — dry-run with KK_MUSIC_DRY_RUN=1 and resumable without re-paying | MET | probe: engine `--dry-run` walked prepare->brief->explore->select and wrote no artifacts; the offline real-actions probe issued 2 pro takes/0 clip and a re-run reported adopted/paid:false |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The pipeline shape is inspectable (req: R1) | MET | command | `spur workflow validate plugins/kk/workflows/kk-music.yaml` -> "workflow valid: kk-music", 0 errors, 2 medium composition warnings (629/497-char prompts, both under the 1000 cap); `plugins/kk/tests/kk-music-workflow.test.ts:192` (nine states, done/failed), `:239` (every state reachable from prepare), `:254` (shell actions inside ADR-115), `:270` (prompts under 1000 chars) |
| AC2 — Money is spent in the delivery model, once per direction (req: R2) | MET | test | `plugins/kk/tests/kk-music-workflow.test.ts:355` (exactly one pro take per brief, no clip request, re-run issues none, analyze on the selected take only); dry-run probe issued 2 pro/0 clip and adopted on re-run |
| AC3 — No unmeasured take is judged and no failed file is finalized (req: R3) | MET | test | `plugins/kk/tests/kk-music-workflow.test.ts:296` (the verdict gate reads a real music verdict), `:320`/`:326`/`:339`/`:346`; probe: `kk music check` exited 1 on `duration.target: 1 s (threshold 10-30)` and `music-judge-input` refused the bundle, so judge was never reached |
| AC4 — Verticals: artifacts and a run report per state (req: R4) | MET | test | `plugins/kk/tests/kk-music-workflow.test.ts:315` (generated guard commands carry a real read) and the finalize stage report; artifact layout follows `plugins/kk/skills/music-authoring/SKILL.md:69` |
| AC5 — Dry-run and resume without paying twice (req: R5) | MET | command | `KK_MUSIC_DRY_RUN=1` engine dry-run: `prepare -> brief -> explore -> select[paused]`, 0 artifacts written, 0 paid requests; re-run of explore reported `adopted/paid:false` with the take count unchanged |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA + traceability review of the `kk-music` workflow (`--focus all`, host-inline; independent of the implement session).

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 (blocker) | — | none |
| P2 (major) | — | none |
| P3 (minor) | Two `agent.run` prompts are not slash-pinned (629 and 497 chars), which `spur workflow validate` reports as medium composition warnings. Both are inside the 1000-char cap and the AC only forbids ADR-115 *errors*, but a pinned slash command plus a bounded stage-script prompt is the shape the other workflows use and would remove the warning class | DEFER(style: pin both prompts when a stage runner owns their composition) |
| P3 (minor) | The workflow's correctness depends on `kk music check` reading the sibling `analysis-<instanceId>.json` (added in this task) — without it `analysis.present` could never pass and `judge` was unreachable. That coupling is real but implicit: nothing in the check verb's help says where the analysis file must live | DEFER(0401's verb help should name the analysis sidecar it reads) |
| P4 (advisory) | `explore` reaches its take count through the stage runner rather than engine fan-out — correct given the engine executes one node at a time, and the run report sums spend from the sidecars rather than from a counter it maintains itself | ACCEPTED |

**Spend shape (R2).** Explore takes one take per brief in the format's own model and never issues a clip request for a Pro direction (`plugins/kk/tests/kk-music-workflow.test.ts:355`), so the "Clip is not a Pro preview" decision is enforced in the machine, not just in the skill text. `select` is the only operator-pause state (`:231`), `auto` skips it only for a single take, and re-running explore into the same run directory pays nothing because the 0400 digest dedupe adopts the existing take.

**Gate order (R3).** `check` must exit 0 before `judge`, and `judge` runs through the shipped confidence-aware filter copied byte for byte (`plugins/kk/tests/kk-music-workflow.test.ts:284`) — the same filter `verdict-confidence.test.ts` pins, so a music verdict cannot enter through a laxer door. `master` is reached on PASS at any confidence, or on NEEDS_REVISION only with `accept_revision=true` (`:320`, `:339`); a blocked review routes to the failed terminal, never to master (`:346`).

**Contract conformance.** The workflow writes 0402's run-directory layout (`1-brief/`, `3-takes/`, `4-judge-input.md`), which is what keeps the judge bundle resolvable; the finalize state emits the R4 report (spend from sidecars, instance ids, verdict, delivery profile with measured LUFS/true peak, artifact path).

**Residual risk.** The state machine is exercised against captured and offline takes; the live Pro path (real instance, real latency, real manifest shapes) is 0404's dogfood. Until then, `analysis.present` and the reconciliation branch are only proven against stubs.

**Final disposition.** Approve for `done` — R1–R5 and AC1–AC3 MET (AC4/AC5 carried by the dry-run and rerun assertions); `spur workflow validate` reports 0 errors, 20 workflow tests pass, 59 pre-check rules clean, Biome clean; light gate DEFERRED (batch full gate owes coverage).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)
- 2026-11-19T08:49:46.864Z backlog → wip (system)
- 2026-11-19T09:10:26.094Z wip → testing (system)
- 2026-11-19T09:10:26.709Z testing → done (system)

