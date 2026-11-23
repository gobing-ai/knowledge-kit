---
schema_version: 1
name: Centralize daily news cover composition
status: done
template: feature-impl
created_at: 2026-11-23T01:20:51.113Z
updated_at: "2026-11-23T05:21:51.512Z"
feature_id: L4
priority: P2
tags:
  - daily-news
  - image-gen
estimate_hours: 5

done_forced: "false"
done_reason: unforced close
---

## 0424. Centralize daily news cover composition

### Background

L4 R1 and R2 centralize the scene authored for the existing text-free podcast cover and social crop. The cover plugin request is built by `dailyCover`, and `coverNormalizeBody` owns both outputs when there is a headline.

**Refine corrections (2026-11-22)**
- “Resolved plugin path” left legacy and custom writer behavior unspecified. The launcher already resolves an installed package root independently of the writer skill. Freeze one visual skill root for the canonical run and provide an explicit legacy override.
- The cover normalizer emits the OG image only when a headline exists. The positive replay uses a frozen Hook, and the legacy/missing-brief replay records the existing fallback without requiring a fabricated headline.

Current-tree sources: plugins/kk/skills/news-editorial/SKILL.md:92, plugins/kk/scripts/daily-stages.ts:942, plugins/kk/scripts/kk-workflow-stages.ts:1049, apps/cli/src/content-types.ts:153.

### Requirements

- [x] R1. Ship `kk:daily-news-cover` and one shared, distribution-safe composition reference with original product-led, comparison, and metaphor examples. Examples name a sourced focal subject, spatial relationship and protected crop zone.
- [x] R2. Scheduled master-plan write/repair and legacy daily cover prompts use that skill to author one text-free scene. Manual authoring emits the legacy-compatible subject brief and passes it to existing render entry points. Preserve existing headline, pins, path, cache and fallback behavior.

### Acceptance Criteria

- [x] AC1 — Vendor composition patterns have daily news references
- [x] AC2 — The selected lead drives the podcast and social cover

AC1 exercises R1 on the shipped references. AC2 exercises R2 on the current and legacy run paths.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-23T01:21:30.190Z

**Which cover text is authoritative?** Use the existing editorial Hook and frozen identity. The cover skill owns the scene and loads original composition examples from installed references.

#### Q&A entry — 2026-11-23T02:49:14.519Z

**Where does a scheduled agent resolve the visual skill?** Use the built-in package skill root supplied by the launch. Direct workflow callers can pass the same root, with a checkout-relative default. The news writer's path remains independent.

### Design

- Create `plugins/kk/skills/daily-news-cover/SKILL.md` and shared `plugins/kk/skills/news-editorial/references/daily-visual-composition.md`. Choose product-led when a sourced product form is recognizable, comparison only for a sourced A/B fact, otherwise a concrete object metaphor. Protect the center crop and headline/logo zones already owned by `cover-compositor.ts`. Keep scene English and ≤240 characters, with no generated lettering, logos or identifiable people. Use separately supplied reference assets only if the existing render entry takes them.
- In `apps/cli/src/commands/content-launch.ts`, initialize news-only `visual_skill_root` from `resolvePackageRoot(fs)/plugins/kk/skills`. Declare it in `kk-news-generate.yaml` with a checkout-relative default `plugins/kk/skills` for direct workflow calls. Pass the resolved cover SKILL.md path as a brief pointer in `script-write` and `script-fix`. The built-in `news-editorial` prompts keep ownership of `cover.headline`, `sourceIds`, validator repair scope and old string input. Custom writer lookup stays independent. Add the same default/override to tracked voice and voice2 workflows for their legacy cover prompts, keeping each workflow's existing JSON path and guard.
- Keep `{subject}` as the manual/legacy brief shape, with `headline` supplied only by settled editorial input when available. Reuse the existing mock runner for standalone verification. Preserve the legacy workflows’ existing final-cover file guards. The canonical generate-render stage only gates on cover_enabled and this task adds no cache there. Keep the `daily-news-podcast-cover` × `quasi-news-podcast` input envelope, MiniMax/image-01 as today’s default, configured overrides and existing 1344×576 PNG / 1200×630 JPG paths. Generic image authoring and renderer changes are outside this task. Deliver `visual_skill_root` and the shared composition reference to 0425 and 0426.

### Plan

- [ ] Extend the packaged-path assertions in `apps/cli/tests/content-launch.e2e.test.ts` and use the mock cover/normalize tests in `plugins/kk/tests/daily-cover-{mock,normalize}.test.ts` for the scene, headline and dimensions replay.
- [ ] Add the skill and examples, wire the canonical/legacy prompt pointers, and retain all existing input/output keys.
- [ ] Replay valid and absent/legacy briefs against fake image-gen inputs, assert pinned envelope and frozen headline, then inspect both output dimensions in the existing macOS compositor fixture. Update `docs/04_DESIGN.md` for the workflow surface.

### Solution

**Change map**

- `plugins/kk/skills/daily-news-cover/SKILL.md:1` — new skill (modes `scene` for the news plan, `brief` for the legacy `{"subject":…}` file). It owns scene selection/wording only; `cover.headline`/`sourceIds`, the format/style/provider/model pins, the paths, the cache and the fallback stay with their existing owners.
- `plugins/kk/skills/news-editorial/references/daily-visual-composition.md:1` — the shared, distribution-safe composition reference: canvas facts from `cover-compositor.ts`, the ten patterns, eight original worked examples (each naming a sourced focal subject, a placement and the crop-safe region), the refusal list.
- `apps/cli/src/commands/content-launch.ts:290` — resolve the package root once, and set the news-only `visual_skill_root` var at `:295` (`<package>/plugins/kk/skills`) so a scheduled run reads the shipped skills in place; the same root feeds `harnessRoot` at `:329`. Article runs get no such var, and `skill_dir` (custom writer) is untouched.
- `plugins/kk/workflows/kk-news-generate.yaml:38` — declare `visual_skill_root: "plugins/kk/skills"` (checkout-relative default for a direct `spur workflow run`); the `script-write` prompt (`:174`) and `script-fix` prompt (`:217`) point at the cover skill and the shared reference while keeping the frozen `skill_dir` line, the plan paths and every existing guard.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:54` / `:268` and `kk-daily-ai-voice2.yaml:52` / `:472` — same var and the same `brief`-mode pointer for the legacy cover prompts; the scene constraints they used to restate (≤240 chars, no text/logos) now live in the skill, so each prompt got shorter while the output path, `expectFile`, `onError: continue` and the lead-selection rule are unchanged.
- `docs/04_DESIGN.md:2292` — the cover-stage row now names the skill, the shared reference, the var and its two resolutions.

**Tests (written before the code)**

- `plugins/kk/tests/daily-visual-composition.test.ts:1` — AC1 structural contract: ten patterns, three families, eight examples each carrying Source/Focal subject/Placement/Crop-safe plus a ≤240-char, digit-free scene; the canvas facts and the refusal list; the skill's two modes and its ownership boundary.
- `apps/cli/tests/content-launch.e2e.test.ts:82` — AC2 launcher seam: a news launch passes the absolute `<package>/plugins/kk/skills`, an article launch passes none.
- `apps/cli/tests/kk-news-generate-dag.test.ts:113` — the declared var set grows to eight with the checkout-relative default, and both plan-authoring prompts cite the cover skill.
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:143` / `apps/cli/tests/voice2-dag.test.ts:716` — both legacy cover prompts cite the skill and stay under the ADR-115 1000-char cap; the voice1 frozen-behaviour allowlist gains the one new var default (0424 R2), with no state, command, edge or condition change.

**Preserved behaviour.** Headline, pins, cover paths, cache and fallback are untouched: `dailyCover` still builds the same envelope from `{subject}`, `coverNormalizeBody` still composites only when a headline exists, and the canonical generate-render stage still gates on `cover_enabled` alone.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — ship `kk:daily-news-cover` + one shared, distribution-safe composition reference with original product-led, comparison and metaphor examples naming a sourced focal subject, spatial relationship and protected crop zone | MET | `plugins/kk/skills/daily-news-cover/SKILL.md:1` (modes `scene`/`brief`, ownership boundary, rejections) · `plugins/kk/skills/news-editorial/references/daily-visual-composition.md:1` (ten patterns at `:59`, families at `:33`, eight worked examples at `:89` each carrying Source/Focal subject/Placement/Crop-safe, refusals at `:139`) · `plugins/kk/tests/daily-visual-composition.test.ts:29` (10 pattern rows), `:38` (8 examples, scene ≤240 chars and digit-free), `:55` (canvas facts + refusals), `:65` (skill modes) — 4 pass / 0 fail |
| R2 — scheduled master-plan write/repair and legacy daily cover prompts use that skill to author one text-free scene; manual authoring emits the legacy-compatible subject brief into the existing render entry points; preserve headline, pins, path, cache and fallback behaviour | MET | `apps/cli/src/commands/content-launch.ts:291` (package root resolved once) and `:295` (news-only `visual_skill_root`) · `plugins/kk/workflows/kk-news-generate.yaml:38` (declared default) + `:174`/`:217` (scene pointer in `script-write`/`script-fix`, frozen `skill_dir` line kept) · `plugins/kk/workflows/kk-daily-ai-voice.yaml:54`/`:268` and `kk-daily-ai-voice2.yaml:52`/`:472` (brief-mode pointer) · preservation: `plugins/kk/scripts/daily-stages.ts:942` (`dailyCover` envelope, `{subject}` shape) and `plugins/kk/scripts/kk-workflow-stages.ts:1049` (`coverNormalizeBody`, headline-gated) are byte-identical; `apps/cli/tests/content-launch.e2e.test.ts:82` (news gets the absolute root, article gets none), `apps/cli/tests/kk-news-generate-dag.test.ts:113`/`:219` (eight vars, both prompts cite the skill), `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:143`, `apps/cli/tests/voice2-dag.test.ts:716` (prompts cite the skill, ≤1000 chars) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Vendor composition patterns have daily news references | MET | test | `plugins/kk/tests/daily-visual-composition.test.ts:29` — ten patterns, three families; `:38` — eight examples each with a sourced focal subject, a placement and a crop-safe region |
| AC2 — The selected lead drives the podcast and social cover | MET | test | `apps/cli/tests/content-launch.e2e.test.ts:82` — the launcher passes the resolved skill root to the news workflow only; `apps/cli/tests/kk-news-generate-dag.test.ts:219` and `apps/cli/tests/voice2-dag.test.ts:716` — every cover-authoring prompt (plan and legacy) resolves the skill in place, while `plugins/kk/scripts/daily-stages.ts:942` still builds the pinned `daily-news-podcast-cover` × `quasi-news-podcast` envelope from the single `subject` var and `kk-workflow-stages.ts:1049` still composites only when a headline exists |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review depth: **all** (SECUA + architecture depth + functional traceability), run over the task's
uncommitted worktree change set (11 modified + 3 new files).

**Functional traceability** — R1 MET (skill + shared reference + 10 patterns / 8 examples, pinned by
`plugins/kk/tests/daily-visual-composition.test.ts`), R2 MET (launcher resolves `visual_skill_root`
for news only; the news plan and both legacy cover prompts cite the skill in place; `dailyCover` and
`coverNormalizeBody` are byte-identical, so headline, pins, paths, cache and fallback are unchanged).
AC1 and AC2 both MET — evidence tables in `.spur/run/runall-L4-0ad4-0424-review-cert.md`.

**SECUA** — no new input surface (a package-resolved path interpolated as a workflow var); explicit
rejection list for the scene; read-only assets; prompts got shorter (772–885 chars, under the ADR-115
error tier); no UI.

**Architecture** — the seam is right: the scene contract is data read in place from the package, not a
fourth prompt copy, and the two resolutions (launcher absolute / workflow checkout-relative) reuse the
existing `resolvePackageRoot` and workflow-var boundary.

**Findings** — P4 (advisory): `daily-news-cover` owns only the scene, so a different composition
family means editing the reference rather than the skill. Accepted — 0425 reuses the same reference and
per-family skills would duplicate the protected-zone geometry. No open P1/P2/P3.

**Residual risk (outside this change)** — `scripts/test-changed.ts` isolates changed-scope coverage
with `--coverage-dir`, but on bun 1.4.3 a scoped `bun test --coverage` still rewrites the repo-wide
`.coverage/lcov.info`, so the light gate's `rules:post` coverage check depends on a complete corpus at
gate start. Pre-existing and documented in that script's header; this task's gate evidence was taken
with a complete corpus from a full `bun run test` (6361 pass / 0 fail).

**Disposition** — PASS.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-23T03:44:28.610Z todo → wip (system)
- 2026-11-23T05:21:50.234Z wip → testing (system)
- 2026-11-23T05:21:51.504Z testing → done (system)

