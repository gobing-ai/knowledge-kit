---
schema_version: 1
name: Author the music-authoring skill and the music quality rubric
status: backlog
template: feature-impl
created_at: 2026-11-18T22:16:16.524Z
updated_at: "2026-11-19T03:55:07.862Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 10
dependencies: ["0401", "0405"]
---

## 0402. Author the music-authoring skill and the music quality rubric

### Background

Implements: R1 — authoring skill; R2 — truth constraints in the skill; R3 — music rubric inside content-judge; R4 — unchanged verdict contract; R5 — judge input bundle.

Quality gating in this platform is delivered as agent skills + `agent.run`, never as a plugin kind (ADR-007 amendment; `plugins/kk/skills/content-judge/SKILL.md`). The existing `audio-authoring` skill owns *spoken* audio (`VoiceScript`), and `content-judge` owns rubric-based evaluation with one shared verdict contract (`content-judge/SKILL.md:26-49`) that every workflow gate reads through a confidence-aware `jq` filter (`plugins/kk/workflows/judge-gated-publish-example.yaml:76`), pinned by `plugins/kk/tests/verdict-confidence.test.ts`. Music needs an authoring voice of its own plus a music rubric. It does not need a third judge or a second verdict shape.

Re-scoped 2026-11-18: deterministic checks moved to 0405 (code, `checks.json`), which runs as a workflow state *before* the judge. The judge therefore never sees a take with a failing or unmeasured check. "No PASS on unmeasured criteria" is enforced by state order, not by trusting the LLM to obey a rubric line.

### Requirements

- [ ] R1. Author `plugins/kk/skills/music-authoring/SKILL.md` with four operations: `brief` (idea → technical direction + structure + avoid-list as a MusicBrief YAML), `lyric` (sections under tags, language, prosody), `iterate` (timestamp/section directives for the next take, written as a new brief), and `review` (assemble the judge input, R5). Each operation has explicit operator gates and safe resume on an existing run directory.
- [ ] R2. Encode the model's real constraints in the skill so an agent cannot promise something the model cannot do: the prompt is the only control surface; duration is a target that may be missed either way; Clip is fixed at about 30 s and is a different model from Pro, so it is not a preview of a Pro take; there is no `negative_prompt` parameter (exclusions are prompt text); every take is a new paid request; and section "edits" are full re-generations against an immutable artifact.
- [ ] R3. Add `plugins/kk/skills/content-judge/references/music-quality-rubric.md` (rubric id `music-quality`) and a row in the content-judge rubric table (`SKILL.md:134`). Craft dimensions: brief adherence (genre/instrumentation/vocal character vs technical direction), arrangement vs declared structure, lyric intelligibility and language, hook/memorability, and production artefacts. The single must-pass criterion is `checks.clean`: `checks.json` exists for the take and contains no `fail`. Measured facts (duration, silence, BPM, key) are cited from `checks.json` and never re-scored from the prompt or by ear.
- [ ] R4. Emit the **existing** content-judge verdict contract unchanged: `rubric: "music-quality"`, `confidence` required, findings' `criterion` ids from the rubric, and `content_ref` = the take path. Do not add a `music-verdict.json`, a new top-level field or a new finding field. `plugins/kk/tests/verdict-confidence.test.ts` stays green without edits.
- [ ] R5. Define the judge input bundle written by `review`: `judge-input.md` in the run directory containing the brief, the kk prompt text, lyrics, instance analysis, and `checks.json` verbatim. The `agent.run` prompt passes that one path, so the judge reads measurements instead of re-deriving them.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)

