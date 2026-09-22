---
schema_version: 1
name: Cover illustration and kk:article-adapt per-platform variants
status: todo
template: feature-impl
created_at: 2026-09-22T16:46:32.547Z
updated_at: "2026-09-22T16:51:23.267Z"
feature_id: F41
priority: P2
tags:
  - F41
  - kk-itc
estimate_hours: 6

dependencies: ["0151"]
---

## 0152. Cover illustration and kk:article-adapt per-platform variants

### Background

This slice adds the model-bearing steps of the tail:
- an optional cover and inline illustrations, through `kk:image-authoring`, where the var is the spend switch
- a new thin `kk:article-adapt` skill that writes one Content file per plan variant that needs adaptation

Implements:
- R7 — Cover generation runs only when cover_enabled is true
- R9 — article-adapt writes one Content variant per target profile

Design SSOT: `docs/design/kk-itc-end-to-end.md` §3 and §6. Ordering: after "kk-itc publish tail: fan-out, browser loop, retry and operator confirm", which adds publish-entry and publish-plan.

Rubric: E6 D1 L2 C1 R1 = 11 → a separate task: a distinct skill artifact with its own validation step.

### Requirements

- [ ] R1. Add the vars `cover_enabled` (false) and `inline_images` (false). An `illustrate` state sits between publish-entry and materialize. It runs `kk:image-authoring` with `KK_NONINTERACTIVE=1 KK_IMAGE_AUTO_CONFIRM=1` and writes `4-illustrations/cover.*` (plus `inline-*` when `inline_images` is true). When both vars are false, the state is not entered.
- [ ] R2. New skill `plugins/kk/skills/article-adapt/SKILL.md`, authored and checked with `superskill skill` (scaffold, validate, evaluate). For each `publish-plan.json` variant with `adapt:true`, it:
  - translates `title` and `body` to the variant locale
  - applies the variant `limits`
  - keeps code blocks, URLs and `references`
  - writes the variant file
  The skill holds no platform table.
- [ ] R3. An `adapt` state after publish-plan runs only when some variant has `adapt:true`. A follow-up shell step fails when a variant file is missing or lacks `title`/`body`.
- [ ] R4. Tests cover the illustrate and adapt edge guards (structural), plus a seeded adapted variant that parses against `ContentSchema` and flows through `itc-publish-fanout` stamping.

### Acceptance Criteria

- [ ] AC1 — Cover generation runs only when cover_enabled is true
- [ ] AC2 — article-adapt writes one Content variant per target profile

Task-local check: `superskill skill validate` passes for `article-adapt`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T16:50:44.534Z

- **Q: Where does the new skill live and how is it authored?** A (closed): in `plugins/kk/skills/article-adapt/`, installed as `kk:article-adapt` (capability names omit the `kk-` prefix). It is scaffolded, validated and evaluated through `superskill skill`, never hand-copied.
- **Q: Who owns per-platform limits?** A (closed): the plan (`TARGET_PROFILES` → plan `variants[*]`). The skill only transforms text to the given locale, format and limits, so the profiles have one source of truth.
- **Q: How does the cover run unattended?** A (closed): `kk:image-authoring` runs with `KK_NONINTERACTIVE=1` (`plugins/kk/skills/image-authoring/SKILL.md:211`) and auto-confirm (`:192`), and only when `cover_enabled` is true. With the default false, no image command runs and nothing is spent.
- **Q: What does `inline_images` do?** A (closed): it defaults to false. When true, illustrate also requests inline figures from `kk:image-authoring`, so spend stays opt-in.
- **Q: Do adapted files carry draft or live keys?** A (closed): no. `itc-publish-fanout` (0151) stamps the switches at send time (V3), and this task's test asserts stamping on a seeded variant.
- **Dependencies:** 0151 (tail states and switch stamping to wire adapt into).

### Design

Approach:
- Thin skill: the plan carries per-variant locale, format and limits, and the skill only transforms text.
- Illustrate reuses `kk:image-authoring` non-interactively.

Reason: a single source of truth for the profiles (in `TARGET_PROFILES`), and the draft switch is never LLM-owned (V3).

Rejected:
- Extending `itc-generating` with adaptation. It would bloat the authoring skill and mix the concerns.
- A generator plugin for adaptation. Adaptation is model work and belongs in skills (ADR-007 amdt).

Invariants:
- Adapted files never set draft or live keys; `itc-publish-fanout` stamps them.
- No image spend unless a var enables it.

### Plan

1. Scaffold `kk:article-adapt` via `superskill skill`, write the method, then validate and evaluate it.
2. Add the illustrate and adapt states, vars and edges to `kk-itc.yaml`, with structural asserts.
3. Add a seeded-variant test through stamping.
4. Sync `docs/04_DESIGN.md`, then run `bun run lint` and `bun run test`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History
