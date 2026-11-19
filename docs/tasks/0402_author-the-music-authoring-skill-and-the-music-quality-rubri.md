---
schema_version: 1
name: Author the music-authoring skill and the music quality rubric
status: done
template: feature-impl
created_at: 2026-11-18T22:16:16.524Z
updated_at: "2026-11-19T08:31:11.931Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 10
dependencies: ["0401", "0405"]
done_forced: "false"
done_reason: unforced close
---

## 0402. Author the music-authoring skill and the music quality rubric

### Background

Implements: R1 — authoring skill; R2 — truth constraints in the skill; R3 — music rubric inside content-judge; R4 — unchanged verdict contract; R5 — judge input bundle.

Quality gating in this platform is delivered as agent skills + `agent.run`, never as a plugin kind (ADR-007 amendment; `plugins/kk/skills/content-judge/SKILL.md`). The existing `audio-authoring` skill owns *spoken* audio (`VoiceScript`), and `content-judge` owns rubric-based evaluation with one shared verdict contract (`content-judge/SKILL.md:26-49`) that every workflow gate reads through a confidence-aware `jq` filter (`plugins/kk/workflows/judge-gated-publish-example.yaml:76`), pinned by `plugins/kk/tests/verdict-confidence.test.ts`. Music needs an authoring voice of its own plus a music rubric. It does not need a third judge or a second verdict shape.

Re-scoped 2026-11-18: deterministic checks moved to 0405 (code, `checks.json`), which runs as a workflow state *before* the judge. The judge therefore never sees a take with a failing or unmeasured check. "No PASS on unmeasured criteria" is enforced by state order, not by trusting the LLM to obey a rubric line.

### Requirements

- [x] R1. Author `plugins/kk/skills/music-authoring/SKILL.md` with four operations: `brief` (idea → technical direction + structure + avoid-list as a MusicBrief YAML), `lyric` (sections under tags, language, prosody), `iterate` (timestamp/section directives for the next take, written as a new brief), and `review` (assemble the judge input, R5). Each operation has explicit operator gates and safe resume on an existing run directory.
- [x] R2. Encode the model's real constraints in the skill so an agent cannot promise something the model cannot do: the prompt is the only control surface; duration is a target that may be missed either way; Clip is fixed at about 30 s and is a different model from Pro, so it is not a preview of a Pro take; there is no `negative_prompt` parameter (exclusions are prompt text); every take is a new paid request; and section "edits" are full re-generations against an immutable artifact.
- [x] R3. Add `plugins/kk/skills/content-judge/references/music-quality-rubric.md` (rubric id `music-quality`) and a row in the content-judge rubric table (`SKILL.md:134`). Craft dimensions: brief adherence (genre/instrumentation/vocal character vs technical direction), arrangement vs declared structure, lyric intelligibility and language, hook/memorability, and production artefacts. The single must-pass criterion is `checks.clean`: `checks.json` exists for the take and contains no `fail`. Measured facts (duration, silence, BPM, key) are cited from `checks.json` and never re-scored from the prompt or by ear.
- [x] R4. Emit the **existing** content-judge verdict contract unchanged: `rubric: "music-quality"`, `confidence` required, findings' `criterion` ids from the rubric, and `content_ref` = the take path. Do not add a `music-verdict.json`, a new top-level field or a new finding field. `plugins/kk/tests/verdict-confidence.test.ts` stays green without edits.
- [x] R5. Define the judge input bundle written by `review`: `judge-input.md` in the run directory containing the brief, the kk prompt text, lyrics, instance analysis, and `checks.json` verbatim. The `agent.run` prompt passes that one path, so the judge reads measurements instead of re-deriving them.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The skill covers the authoring loop (req: R1)
  Given the music-authoring skill
  When brief, lyric, iterate and review are exercised on a sample idea in dry-run
  Then each operation produces its documented artifact under the run directory
  And brief and iterate output validate against the 0397 MusicBrief schema via kk music render
  And each names its operator gate and how it resumes an interrupted run

Scenario: AC2 — The skill states the model's real limits (req: R2)
  Given the skill text
  When it is read against the instance documentation
  Then it forbids promising exact duration, native negative prompts, in-place editing, or Clip as a Pro preview
  And it states that every take is a paid, immutable, new request

Scenario: AC3 — The rubric defers measurement to checks.json (req: R3)
  Given a judge input whose checks.json contains a fail
  When the music-quality rubric is applied
  Then checks.clean is fail and the verdict is FAIL
  And a finding that cites a duration or BPM value quotes it from checks.json with its source

Scenario: AC4 — The verdict contract is unchanged (req: R4)
  Given a music-quality verdict fixture
  When the existing confidence-aware jq gate and verdict-confidence.test.ts read it
  Then a PASS with HIGH confidence routes as PASS and a PASS without confidence routes as PASS!
  And git diff shows no change to the verdict contract block in content-judge/SKILL.md

Scenario: AC5 — The judge reads one bundle (req: R5)
  Given a completed analyze and check for the selected take
  When review runs
  Then judge-input.md contains the brief, kk prompt text, lyrics, analysis and checks.json verbatim
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Two skills, one rubric, zero schema change (closed 2026-11-18).** Authoring stays in `music-authoring`, and evaluation stays in `content-judge` with one new rubric file. The first draft's `music-verdict.json` (per-check measured values, thresholds, craft scores) was a fork: it was a second file with a second shape, and it omitted `confidence`, so every existing gate would have read its PASS as `PASS!`. The numbers already have a home (0405 `checks.json`); the verdict only has to cite them.
- **Measure, then judge, by state order.** The workflow runs `kk music check` and stops on non-zero before `judge`. The rubric's `checks.clean` must-pass is defence in depth, not the primary gate.
- **BPM/key mismatch is a `warn` input, not a verdict.** The instance analysis is a model estimate, so a mismatch can push the craft score toward NEEDS_REVISION but cannot FAIL a take on its own.
- **Anti-hallucination.** Every finding that cites a number quotes its unit and the tool that produced it from `checks.json` (`ffprobe`, `ffmpeg loudnorm`, `POST /api/ai/analyze`). No criterion may be scored from the prompt text alone.
- **Dependency.** Blocked by 0401 (verbs produce the artifacts) and 0405 (`checks.json` shape). The rubric draft may start once 0405's check record shape is frozen.
- **Estimate.** 7h: skill (4 operations) + rubric + rubric-table row + judge-input bundle + fixtures. Reduced from 10h because the deterministic checks moved to 0405.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

#### Change map

| Change | File:line | Why |
| --- | --- | --- |
| New skill, four operations (`brief`/`lyric`/`iterate`/`review`), each with an explicit `**Gate**` and `**Resume**` rule | `plugins/kk/skills/music-authoring/SKILL.md:124`, `:149`, `:171`, `:200` | R1. Each operation is one numbered procedure ending in a human gate; resume is per operation plus the cross-cutting rules at `:257`. Body is 18.8 KB (budget 20 000), detail pushed to `references/`. |
| Run-directory artifact contract (idea, `1-brief/brief-<nn>.yaml`, `.prompt.txt`, `.render.txt`, `2-lyrics.md`, `3-takes/**`, `4-judge-input.md`, `4-verdict-music.json`) + the exact `kk music` command lines | `SKILL.md:69`-`:101` | R1/R5. The layout is the one 0403's run directory uses (`<works>/kk-music/<topic-slug>/`), so a state machine and an operator resume the same files; the commands are the rendered form the probe exercised. |
| `## The instance's real limits` — six-row constraint table with stable ids | `SKILL.md:103`-`:120` | R2. `prompt-is-the-only-control-surface`, `duration-is-a-target` (±20% or ±10 s, with the `PRO_DURATION_TOLERANCE_*` source), `clip-is-not-a-pro-preview`, `no-negative-prompt`, `every-take-is-a-new-paid-request`, `no-in-place-edit`. Each row states the lie, the truth and what to do instead, so an agent cannot promise what the model cannot do. |
| Judge-bundle summary table (six section ids) + `review`'s assemble/dispatch/gate/resume steps | `SKILL.md:231`-`:243`, `:200`-`:229` | R5. One path, five verbatim inputs; the judge dispatch is `Skill(skill="kk:content-judge")` with `rubric: music-quality`, `content_ref` = the take and `4-verdict-music.json` as the output. |
| `music-quality` rubric: six criteria, weights summing to 1.0, `checks.clean` the only must-pass (0.20), `pass_threshold = 0.75` | `plugins/kk/skills/content-judge/references/music-quality-rubric.md:11`-`:29` | R3. Craft dimensions are deliberately **not** must-pass — a craft judgement made without hearing the take cannot be a blocking violation — so a BPM/key/section disagreement can only pull the score toward `NEEDS_REVISION`. |
| Measurement discipline: measured facts quoted from `checks.json` with `unit` + `source`, never re-derived from the prompt, never scored by ear; a `warn` row never becomes a `fail` | `music-quality-rubric.md:31`-`:49` | R3/AC3 anti-hallucination. Names the four `source` values (`ffprobe <v>`, `ffmpeg <v> silencedetect`, `ffmpeg <v>`, `lyria instance analysis`) and marks the analysis-derived rows as estimates. |
| Per-criterion guidance bound to rows (`duration.target`, `silence.*`, `analysis.bpm|key|sections`, `delivery.*`), including the instrumental / model-authored-lyrics cases | `music-quality-rubric.md:51`-`:109` | R3. Every criterion is graded only from what the bundle can attest; unattestable elements are `warn`, never `pass`. |
| Verdict mapping + the emitted contract key-set (unchanged fields) | `music-quality-rubric.md:111`-`:146` | R4. `rubric: "music-quality"`, `confidence` required, `findings[].criterion` from the rubric, `content_ref` = the take path; no new top-level or finding field, no `music-verdict.json`. |
| Rubric table row + six-rubric count + rubric lists + resource link | `plugins/kk/skills/content-judge/SKILL.md:143`, `:131`, `:25`, `:103`, `:154`, `:179` | R3. The verdict contract block (`:26`-`:49`) is untouched — AC4's `git diff` half. |
| Pointer section in the rubric index, plus the "own file" exception in the authoring rule | `plugins/kk/skills/content-judge/references/rubrics.md:117`-`:128`, `:139` | R3. `rubrics.md` stays the index; the music rubric's measurement rules ship beside it rather than as an inline table. |
| `4-judge-input.md` bundle contract: six section ids, the verbatim/no-hand-edit rules, a template and the assembly commands | `plugins/kk/skills/music-authoring/references/judge-input.md:10`, `:32`, `:81`, `:102` | R5. Normative source for the file `review` writes and for 0403's `judge` state; section ids are machine-checked by the new test. |
| New test: operations + gates + resume, the six constraint ids, the byte budget, the real `render`/`check` flow, the verb anti-drift scan, the rubric's weights/must-pass/citation rules, the bundle ids, and the verdict key-set equality | `plugins/kk/tests/music-authoring.test.ts:1` | R1-R5. Two behavioural halves spawn the real CLI; the rest are structural scans of the three skill files against the CLI's own verb list, so documentation drift fails the suite. |
| Frozen runtime-requires inventory: 21 entities (17 skills, 4 commands), group `cli:kk,cli:spur,local-fs` 9 → 10 | `plugins/kk/tests/runtime-requires.test.ts:166`, `:181`, `:190` | The new skill invokes `kk music` directly and inherits `cli:spur` through its `kk:content-judge` dispatch, so the derived closure and the frozen table move by one. `requires: [cli:kk, cli:spur, local-fs]` is what the test derives (AC1 passes unmodified). |

#### Rationale

- **Two skills, one rubric, zero schema change.** Authoring lives in `music-authoring`; evaluation stays
  in `content-judge` with one new reference file. The `review` operation assembles a bundle and hands it
  over — it never writes a verdict itself, so no consumer needs a second shape (`verdict-confidence.test.ts`
  is green unedited).
- **The rubric's only must-pass is a measurement.** `checks.clean` reads `<take>.checks.json`. Everything
  else is craft, and craft cannot be must-pass when the judge cannot hear the take: a must-pass craft
  criterion would be unanswerable, which the repo's evidence discipline already forbids.
- **Measure, then judge, by state order.** 0405's `kk music check` runs before the judge and exits
  non-zero on any `fail`; `checks.clean` is defence in depth, not the primary gate.
- **Paths are the workflow's paths.** The run-directory layout was chosen to be the `kk-music` run
  directory (0403) so the skill and the workflow can never disagree about where a brief, a take or
  `checks.json` lives.

#### AC interpretations

- **AC1** — "validates against the 0397 MusicBrief schema via `kk music render`" is proven by executing
  the real verb on the documented brief (new test, and the probe transcript): exit 0, and the rendered
  prompt carries the resolved style, the merged `Avoid:` list and the timestamped structure.
  `lyric`/`iterate` resume rules are prose contracts, checked structurally (each operation carries a
  `**Gate**` and a `**Resume**`/`**Prerequisite**` line).
- **AC2** — read as a prohibition set on the skill text, so the test asserts the six constraint ids are
  present exactly once, that Clip is called a **different model** fixed at ~30 s, that a take is
  "paid, non-idempotent" and "immutable", that "full re-generation" is the edit path, and that
  `negative_prompt:` never appears as a parameter.
- **AC3** — "a judge input whose `checks.json` contains a fail → `checks.clean` is fail → verdict FAIL" is
  a rubric rule, so it is verified as the rule (must-pass + the FAIL mapping + the citation rule) rather
  than by running an LLM. The measured-value citation requirement is verified as the rule that a finding
  quotes `measured`/`threshold`/`unit`/`source` from the row, and the row shape itself is verified against
  a real `kk music check` output.
- **AC4** — "the verdict contract is unchanged": the new test parses the ```json block in
  `content-judge/SKILL.md` and the ```json block in the rubric, and asserts identical top-level key sets
  and identical finding key sets. `verdict-confidence.test.ts` passes without edits (no workflow, no
  guard, no producer changed), and the contract block at `content-judge/SKILL.md:26-49` was not touched.
- **AC5** — "judge-input.md contains the brief, kk prompt text, lyrics, analysis and checks.json verbatim":
  the six section ids, the verbatim/no-hand-edit rules, the template and the assembly commands are in
  `references/judge-input.md`, and the ids are asserted present in both the SKILL table and the reference
  headings. Live end-to-end assembly needs the instance analysis (`kk music analyze`, paid, or 0403's
  `analyze` state) — see Testing for the probe boundary.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — music-authoring skill with brief/lyric/iterate/review, explicit gates, safe resume | MET | `plugins/kk/skills/music-authoring/SKILL.md:122` (operations, each ending in a Gate and a Resume step), `:69` (run-directory contract), `:257` (resume rules); `plugins/kk/tests/music-authoring.test.ts` (37 tests) |
| R2 — the model's real constraints encoded so no promise exceeds it | MET | `plugins/kk/skills/music-authoring/SKILL.md:103` (six constraint ids with what-is-true and do-instead, each citing the code or doc that makes it true) |
| R3 — music-quality rubric inside content-judge, must-pass checks.clean, measured facts cited | MET | `plugins/kk/skills/content-judge/references/music-quality-rubric.md:14` (criteria table, `checks.clean` the only must-pass), `:32` (measurement discipline); row added to the content-judge rubric table |
| R4 — existing verdict contract unchanged | MET | the rubric scores into the shared contract (`rubric: "music-quality"`, required `confidence`, findings' `criterion` ids, `content_ref` = take path); `plugins/kk/tests/verdict-confidence.test.ts` green unedited (53 pass) and no `music-verdict.json` exists |
| R5 — judge input bundle written by review | MET | `plugins/kk/skills/music-authoring/references/judge-input.md` (six-section bundle contract), `plugins/kk/skills/music-authoring/SKILL.md:231` (one path handed to the judge) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The skill covers the authoring loop (req: R1) | MET | test | `plugins/kk/tests/music-authoring.test.ts` -> 37 pass (four operations, their artifacts, the run-directory contract, the resume rules); probe: `kk music render` validates a brief the documented operation produces and `kk music check` re-checks a take offline |
| AC2 — The skill states the model's real limits (req: R2) | MET | test | `plugins/kk/tests/music-authoring.test.ts` asserts every constraint id and its do-instead; text at `plugins/kk/skills/music-authoring/SKILL.md:103` forbids promising exact duration, negative prompts, in-place editing or Clip as a Pro preview |
| AC3 — The rubric defers measurement to checks.json (req: R3) | MET | command | `sed -n '14,18p;32,36p' plugins/kk/skills/content-judge/references/music-quality-rubric.md` -> `checks.clean` row ("exists for the take and contains no row with result: fail", weight 0.20, must-pass yes) and the measurement-discipline rule ("Measured facts come from checks.json, cited, never re-derived ... quotes the value with its unit and its source") |
| AC4 — The verdict contract is unchanged (req: R4) | MET | test | `bun test plugins/kk/tests/verdict-confidence.test.ts` -> 53 pass / 0 fail against the unedited file; `git status --porcelain` shows no `music-verdict` artifact |
| AC5 — The judge bundle is one path (req: R5) | MET | command | `sed -n '231,238p' plugins/kk/skills/music-authoring/SKILL.md` -> "The judge bundle: five verbatim inputs, one provenance block, one path passed to the judge" with the section/source table; contract detail in `plugins/kk/skills/music-authoring/references/judge-input.md` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA + traceability review of the music-authoring skill and the `music-quality` rubric (`--focus all`, host-inline; independent of the implement session).

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 (blocker) | — | none |
| P2 (major) | — | none |
| P3 (minor) | The skill fixes the run-directory contract (`1-brief/`, `2-lyrics.md`, `3-takes/`, `4-judge-input.md`) that 0403's workflow must write and read. Nothing enforces that agreement yet: if 0403 chooses a different layout, `review` assembles a bundle over an absent path and the judge reads nothing. The contract is explicit in the skill, so the risk is a wiring mismatch found at dogfood, not a silent wrong verdict | DEFER(0403 must conform to this layout; 0404 dogfood is where a mismatch surfaces) |
| P4 (advisory) | `SKILL.md` is 19.5 KB against the 20 KB body budget, with procedure detail already pushed into `references/judge-input.md`. One more section breaches the budget, so a future edit has to move content out first | ACCEPTED |
| P4 (advisory) | `checks.clean` is the only must-pass criterion and carries one fifth of the weight, so a clean but unmemorable take can pass at `pass_threshold = 0.75`. That is deliberate: a craft judgement made without hearing the take cannot be a blocking violation, and the measured facts are already gated by 0405's checks | ACCEPTED |

**Contract integrity (R4).** No `music-verdict.json` and no new verdict field: the rubric rides the existing content-judge contract (`rubric: "music-quality"`, required `confidence`, findings' `criterion` ids from the rubric, `content_ref` = the take path). `plugins/kk/tests/verdict-confidence.test.ts` stayed green without edits (53 pass), which is the proof that the shared gate still parses a music verdict.

**Measurement discipline.** The rubric forbids re-deriving a measured fact: duration, silence, BPM, key, section count and delivery loudness must be quoted from a `checks.json` row with its `unit` and `source`, or not cited at all — and `checks.clean` fails when the file is missing, so an unmeasured take cannot be judged. That is the same "no PASS on unmeasured criteria" rule the task scoped to 0405, enforced here by state order rather than by trusting the model to obey a line.

**Model-truth constraints (R2).** The limits table states each constraint with what to do instead: prompt-only control surface, duration as a target with the code-cited ±20%/±10 s tolerance, Clip as a different model (never a Pro preview), no `negative_prompt`, every take paid and non-idempotent, and no in-place edit (a section edit is a full re-generation against an immutable artifact). Each row cites the code or doc that makes it true, so the skill cannot drift from the implementation without a visible edit.

**Final disposition.** Approve for `done` — R1–R5 and AC1–AC5 MET; 37 skill tests + 53 verdict-contract tests pass, 59 pre-check rules clean, Biome clean; light gate DEFERRED (batch full gate owes coverage).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)
- 2026-11-19T08:29:55.227Z backlog → wip (system)
- 2026-11-19T08:31:11.174Z wip → testing (system)
- 2026-11-19T08:31:11.924Z testing → done (system)

