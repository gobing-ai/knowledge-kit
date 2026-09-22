---
title: kk-itc end-to-end — rough idea → research → article → multi-platform publish (HITL + --auto)
date: 2026-09-21
needs_design: true
idea_run: idea-1010ee67
---

# Brainstorm: IT-content article workflow, idea to multi-platform publish

**Date:** 2026-09-21

## Overview

The operator wants one workflow that starts from a rough IT-content idea, researches it online,
authors the article, and publishes it to several platforms. It must run with HITL gates or with
`--auto`. Information collection is out of scope; it is a separate workflow.

Discovery against the tree shows most of the chain already ships. The missing part is how the
pieces connect, not the pieces themselves:

| Stage | Already shipped | Evidence |
| --- | --- | --- |
| Idea → brief | `kk stage prepare-itc` | `plugins/kk/workflows/kk-itc.yaml` state `prepare` |
| Online research | `kk:storm-research` (live/fixture, `docs.json` evidence) | kk-itc state `research` (opt-in, `research=false` default) |
| Outline options + select | `kk:itc-generating` → `hitl.select` a/b/c | kk-itc `outline-write` / `outline-select` |
| Draft + review/revise | `kk:itc-generating` draft, `hitl.confirm`, `hitl.input` ≤3 rounds | kk-itc `draft-write` / `draft-review` / `draft-revise` |
| Quality gate | `kk:content-judge` (PASS / NEEDS_REVISION / FAIL, rubric `tech-accuracy`) | kk-itc `judge` (opt-in) |
| De-slop | `kk:taste-unslop` | skill only; not wired to kk-itc |
| Cover / illustration | `kk:image-authoring` + `image-gen` generator | wired in `kk-daily-ai-voice` (`cover_enabled` spend gate), not kk-itc |
| Content handoff | `ContentSchema` (`packages/kk-core/src/schemas.ts:14`) | no stage turns the kk-itc draft into Content JSON |
| Publish | 12 `kind: publish` plugins; `kk executor fan-out --content --target… --out --retry-from` | API/file-cli: emdash, medium, qiita, wechatmp, surfdash, zenn, x (post), podcast. Browser/agent: juejin, infoq, substack, xhs, x (article) |
| Live safety | `kk:publish` default draft; live needs confirmation or a payload-encoded live status under `KK_NONINTERACTIVE=1` | `plugins/kk/skills/publish/SKILL.md` § Confirmation |

The gaps in `kk-itc` today:

1. **No `--auto` path.** `outline-select` and `draft-review` always pause.
2. **No judge-driven revise loop.** A FAIL goes straight to `failed`, and NEEDS_REVISION is not
   routed back to revision.
3. **No de-slop or fact-check wiring.** Research evidence (`docs.json`) is not passed to the judge.
4. **No cover or illustration.**
5. **No per-platform adaptation.** Nothing handles locale (en/zh/ja) or channel format (title/tag
   limits, short-form XHS/X).
6. **No Content materialization.** There is no draft → `ContentSchema` JSON step.
7. **No publish tail.** Nothing covers pre-publish confirmation, fan-out, browser channels,
   retries or the run report.

The prior harvest brainstorm already routed this work to "a later F4 child composing existing kk
skills/workflows" (`docs/plans/2026-09-17-wt-remaining-harvest-brainstorm.md` § Design Summary).
This run is that follow-on. PRD `docs/01_PRD.md:86` defers the WT image, research, adaptation and
publishing families to future F children. This feature brings them into scope as composition, not
as new generator plugins.

## Decision tree (resolved from the tree, not from taste)

### Root: new workflow vs extend kk-itc
- **Resolved:** extend `kk-itc` with an opt-in tail that runs after authoring.
- **Rationale:** spur has no sub-workflow action kind. The available kinds are `shell`, `agent.run`,
  `hitl.*`, `note` and `run.artifact`; `workflow.*` are trace kinds only. Two chained workflows
  would therefore mean two runs, two HITL surfaces, and chaining written as prose in a slash
  command. A greenfield copy would duplicate kk-itc's 264 lines of authoring states and drift from
  them.

### Branch: where deterministic logic lives
- **Resolved:** in `kk stage itc-*` helpers inside the shared `kk-workflow-stages.ts` runner. The
  helpers cover materialize, publish-plan, publish-classify and report. The YAML only orchestrates.
- **Rationale:** this follows ADR "kk owns steps; spur owns orchestration" and the existing
  `daily-*` stage pattern. The helpers can be unit-tested; YAML prompts cannot. The `kk` CLI gains
  no new first-layer noun, and the publish skill explicitly forbids a `kk publish` command.
- **Depends on:** Root.

### Branch: what `--auto` means
- **Resolved:** `auto=true` replaces human taste with the model's judgment and the judge gate.
  - The outline is AI-picked from the writer's recommendation, with its rationale recorded.
  - Draft review is skipped. The judge becomes mandatory (`tech-accuracy`, with evidence when
    research ran).
  - NEEDS_REVISION loops through an agent revise step up to `max_revisions` times. FAIL or an
    exhausted budget ends in `failed` with the report written.
- **Rationale:** this mirrors `kk-daily-ai-voice` `skip_review`, and the HITL states stay intact
  for the default path.

### Branch: live publishing under `--auto`
- **Resolved:** the default result is always a **draft** on each platform. Live publish needs
  `publish_live=true` passed explicitly at launch; that encodes the approval into the vars. Without
  `auto`, a `hitl.confirm` shows the targets and the draft/live mode before anything is sent.
- **Rationale:** publishing is external and hard to reverse. This matches the `kk:publish`
  confirmation rule and the project's authorization policy.

### Branch: publish transport split
- **Resolved:**
  - API and file-cli channels go through `kk executor fan-out`, one call per content variant.
  - Browser channels go through `agent.run kk:publish <channel>`, one call per channel, using the
    existing browser profiles.
  - Failed targets retry through `--retry-from`.
- **Rationale:** this is the pattern proven in `leftover-publish-fanout-example.yaml`. Fan-out
  concurrency lives in kk (ADR-019), not in the engine.

### Branch: platform adaptation
- **Resolved:** add a new skill `kk:article-adapt`. It produces per-target Content variants by
  locale (en/zh/ja) and channel format (title/tag limits, short-form for XHS/X-post, frontmatter).
  A deterministic target profile table maps each target to a locale and format, and targets that
  share a profile share a variant.
- **Rationale:** the `topic` and `itc-generating` skills explicitly exclude adaptation.
  `kk-daily-ai-voice` translation is inline prompt text; it has no reusable skill.

## Approaches

### Approach 1 — Extend `kk-itc` with an opt-in end-to-end tail (recommended)

The authoring half gains the `auto` path, the judge revise loop, de-slop, and research evidence
passed to the judge. After the judge passes, a tail runs only when `publish_targets` is non-empty:
`illustrate?` → `adapt?` → `materialize` → `publish-confirm` (HITL, or skipped under auto for
drafts) → `publish-fanout` → `publish-agent` → `publish-retry?` → `report`. With the defaults,
current kk-itc behaviour is byte-identical. `/workflow-run` gains a profile that binds research on,
the judge on, `auto` and the targets.

- **Pros:**
  - One run, one log and one HITL surface.
  - Every step reuses a shipped skill or plugin.
  - Deterministic logic lives in tested `kk stage` helpers.
  - Backward compatible.
- **Cons:**
  - kk-itc grows to roughly 500–550 lines of YAML.
  - The F4 workflow contract widens, so the itc-generating doc and ADR need an amendment.
- **Confidence:** HIGH. Every seam used exists today: the fan-out verb, the Content schema, the
  image-authoring spend-gate pattern, the publish skill and the fake transports for tests.

### Approach 2 — Split: authoring workflow + generic `kk-article-publish` workflow

kk-itc stops at a materialized `content.json`. A new generic workflow takes Content → illustrate →
adapt → publish → report and is reusable by any generator. The two are chained by `/workflow-run`,
or run by the operator one after the other.

- **Pros:**
  - Publish is reusable by `content-gen` and `daily-article-gen`.
  - Each YAML stays small.
- **Cons:**
  - There is no sub-workflow primitive, so "end-to-end" becomes two runs, two traces and an
    operator hop.
  - `--auto` must be threaded through both runs.
  - The generic reuse has no second consumer yet; `kk-daily-ai-voice` has its own publish chain.
- **Confidence:** MEDIUM. It is technically sound, but its value depends on demand that does not
  exist yet.

### Approach 3 — Greenfield `kk-itc-e2e` workflow

This is a new YAML that copies kk-itc's authoring states and appends the publish tail.

- **Pros:** zero risk to existing kk-itc runs.
- **Cons:** two copies of the authoring states will drift, and it creates a second entry for the
  same job.
- **Confidence:** LOW.

## Recommendations

Take **Approach 1**. Keep the `materialize` stage a clean seam: it writes `4-publish/content.json`,
validated by `ContentSchema`. If a second consumer appears, Approach 2 becomes a cheap extraction:
move the tail into its own YAML.

Changes to the ask before feature-create:

| Operator ask | Fine-tune |
| --- | --- |
| "build up our new workflow" | Extend `kk-itc`; no new workflow. It already owns idea → draft. |
| "involve all current infrastructures" | storm-research, itc-generating, taste-unslop, content-judge, image-authoring, publish plugins + fan-out, `/workflow-run`. No new generator plugin. |
| "HITL and `--auto`" | HITL is the default. `auto` swaps taste gates for the judge. Live publish is never implied by `auto`. |
| "add skills, slash commands, CLI commands" | One new skill (`kk:article-adapt`). New `kk stage itc-*` helpers, but no new `kk` noun. A `/workflow-run` profile, but no new slash command. |
| "more smoothly and more reliable" | Fixture-mode e2e test on fake transports, publish retry through `--retry-from`, fail-loud per-target Results, and a run report. |
| Information collection | Deferred to the separate information-collection workflow. |

## Design Summary

The F4 child **F41** extends `plugins/kk/workflows/kk-itc.yaml` into an end-to-end IT-content
pipeline. It runs rough idea → STORM research → outline → draft → de-slop → judge (with a revise
loop) → optional cover/illustrations → per-platform adaptation → Content JSON → multi-platform
publish → run report.

- **Default behaviour is unchanged.** Every new state is gated by a var:
  - `auto` controls the taste gates.
  - `unslop` controls the de-slop pass.
  - `cover_enabled` is the image spend approval.
  - `publish_targets` turns the whole tail on or off.
  - `publish_live` controls draft vs live.
  - `max_revisions` caps the judge revise loop.
- **Deterministic logic** lives in new `kk stage` helpers in `kk-workflow-stages.ts`:
  - `itc-materialize`: draft plus evidence → `ContentSchema` JSON.
  - `itc-publish-plan`: targets → transport class plus variant groups from a static target
    profile table.
  - `itc-publish-classify`: aggregates the per-target Results.
  - `itc-report`: writes the run report.
- **Model-bearing steps** reuse the shipped skills through `agent.run`, plus one new skill,
  `kk:article-adapt`, for locale and format variants.
- **Publish** has two paths:
  - API and file-cli targets go through `kk executor fan-out`.
  - Browser targets go through `agent.run kk:publish`.
  - Drafts are the default. Live requires an explicit `publish_live=true`. The HITL confirm runs
    unless `auto` is on and the mode is draft.
- **Entry** is `/workflow-run kk-itc` with a new end-to-end profile.
- **Docs** need an ADR amendment recording the widened kk-itc contract and the draft-default,
  auto-never-live rule, plus updates to `docs/design/itc-generating.md` (or a kk-itc satellite),
  `04_DESIGN` (surface), `01_PRD:86` (the deferral row) and `05_FEATURES`.
- **Reliability** comes from:
  - a fixture-mode test that runs from research through fake publish transports
  - `--retry-from` for failed targets
  - `Result` outputs that fail loudly

## Next Steps

1. The operator approves this evaluation (idea-eval taste gate).
2. Create feature F41 (child of F4) with the reshaped Goal, Scope and AC.
3. System design:
   - an ADR amendment
   - the kk-itc satellite design (state graph, vars, artifact layout `4-illustrations/`,
     `4-publish/`, `5-report/`)
   - the target profile table
4. Decompose in this order:
   - the auto path and revise loop
   - de-slop and evidence wiring
   - the materialize stage
   - the publish plan, fan-out and agent path
   - illustration
   - the adapt skill
   - the report and the `/workflow-run` profile
   - the e2e fixture test
   - docs

## Spec self-review

- Placeholders: none. Line counts are estimates, labelled `~`.
- Contradictions: none. "No new workflow" and "no new slash command" hold; the new surface is one
  skill, the stage helpers and one profile.
- Scope creep: information collection is excluded. The generic publish workflow (Approach 2) is not
  built. No new generator plugin.
- Ambiguity left for design: exact outline auto-pick mechanics (writer-emitted recommendation vs
  judge scoring) and the precise target profile table contents. Both are system-design decisions,
  not decompose guesses.

---

**Generated by:** sp:brainstorm (idea-pipeline discovery, inline, run `idea-1010ee67`)
**Research delegation:** repo evidence only (workflows, skills, publish plugins, kk-core schemas,
ADR-019, PRD, prior brainstorm 2026-09-17); no external claims made.
