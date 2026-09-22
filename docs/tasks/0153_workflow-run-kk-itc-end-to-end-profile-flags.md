---
schema_version: 1
name: /workflow-run kk-itc end-to-end profile flags
status: todo
template: feature-impl
created_at: 2026-09-22T16:46:32.548Z
updated_at: "2026-09-22T16:51:23.580Z"
feature_id: F41
priority: P2
tags:
  - F41
  - kk-itc
estimate_hours: 3

dependencies: ["0151", "0152"]
---

## 0153. /workflow-run kk-itc end-to-end profile flags

### Background

This slice binds the new kk-itc vars in the `/workflow-run` kk-itc profile, so that one command runs rough idea → research → judge-checked draft → platform drafts.

Implements:
- R17 — workflow-run binds an end-to-end kk-itc profile

Design SSOT: `docs/design/kk-itc-end-to-end.md` §7. Ordering: after "kk-itc publish tail: fan-out, browser loop, retry and operator confirm" and "Cover illustration and kk:article-adapt per-platform variants", which introduce the vars it binds.

Rubric: E3 D1 L1 C0 R0 = 5. One command surface plus its test.

### Requirements

- [ ] R1. The kk-itc profile in `plugins/kk/commands/workflow-run.md` gains these flags:
  - `--auto`
  - `--unslop true|false`
  - `--cover true|false`
  - `--inline-images true|false`
  - `--targets a,b`
  - `--live`
  - `--max-revisions N`
  - `--source-locale en|zh|ja`
- [ ] R2. `--auto` binds `research`, `judge` and `unslop` to true unless the operator passed them. `--live` is never implied. `--playbook wechat` without `--source-locale` binds `zh`.
- [ ] R3. `apps/cli/tests/workflow-run-command.test.ts` covers the binding, including `publish_live` false by default under `--auto`.
- [ ] R4. Sync the `docs/04_DESIGN.md` §7 surface in the same commit (T3).

### Acceptance Criteria

- [ ] AC1 — workflow-run binds an end-to-end kk-itc profile

Task-local check: `--auto` alone leaves `publish_live` false.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T16:50:45.231Z

- **Q: Which flags bind which vars?** A (closed, from design §7):
  - `--auto` → `auto`, `research`, `judge` and `unslop` true.
  - `--targets a,b` → `publish_targets`.
  - `--live` → `publish_live` true, only when passed explicitly (ADR-022).
  - `--cover` → `cover_enabled`, and `--inline-images` → `inline_images`.
  - `--unslop` and `--max-revisions` → their vars.
  - `--source-locale` binds `source_locale`; without it, `--playbook wechat` implies `zh`.
- **Q: Is there a new command or a new profile?** A (closed): neither. This extends the existing kk-itc profile in `plugins/kk/commands/workflow-run.md` (flags at `:36`, fixture note at `:39`, profile section at `:181`). R19 bars new commands.
- **Premises (verified):** the binding tests live in `apps/cli/tests/workflow-run-command.test.ts`.
- **Dependencies:** 0151 and 0152, which define the vars this profile binds.

### Design

Approach: extend the existing kk-itc profile table and binding rules in `workflow-run.md`. Reason: `/workflow-run` is the shipped entry, and R19 bars a new slash command.

Rejected: a dedicated `/itc-publish` command, which is barred by scope and R19.

Invariant: `--live` binds `publish_live` only when passed explicitly (ADR-022).

### Plan

1. Extend the kk-itc profile flags and binding rules.
2. Extend `workflow-run-command.test.ts`.
3. Sync `docs/04_DESIGN.md` §7, then run `bun run lint` and `bun run test`.

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
