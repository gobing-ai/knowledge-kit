---
schema_version: 1
name: /workflow-run kk-itc end-to-end profile flags
status: done
template: feature-impl
created_at: 2026-09-22T16:46:32.548Z
updated_at: "2026-09-22T23:06:24.107Z"
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

- [x] R1. The kk-itc profile in `plugins/kk/commands/workflow-run.md` gains these flags:
  - `--auto`
  - `--unslop true|false`
  - `--cover true|false`
  - `--inline-images true|false`
  - `--targets a,b`
  - `--live`
  - `--max-revisions N`
  - `--source-locale en|zh|ja`
- [x] R2. `--auto` binds `research`, `judge` and `unslop` to true unless the operator passed them. `--live` is never implied. `--playbook wechat` without `--source-locale` binds `zh`.
- [x] R3. `apps/cli/tests/workflow-run-command.test.ts` covers the binding, including `publish_live` false by default under `--auto`.
- [x] R4. Sync the `docs/04_DESIGN.md` §7 surface in the same commit (T3).

### Acceptance Criteria

- [x] AC1 — workflow-run binds an end-to-end kk-itc profile

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-itc-workflow.test.ts:106` |
| `apps/cli/tests/kk-itc-workflow.test.ts:2` |
| `apps/cli/tests/workflow-run-command.test.ts:196` |
| `plugins/kk/scripts/kk-workflow-stages.ts:15` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1673` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1710` |
| `plugins/kk/scripts/kk-workflow-stages.ts:26` |
| `plugins/kk/scripts/kk-workflow-stages.ts:74` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/kk/commands/workflow-run.md:39-41 (all eight flags: --auto, --unslop true |
| R2 | MET | plugins/kk/commands/workflow-run.md:193-198 (auto defaults research/judge/unslop unless passed; --live never implied, ADR-022; wechat without --source-locale implies zh, explicit wins) and :241-243 (JSON binds auto/unslop/max_revisions/cover_enabled/inline_images/publish_targets/publish_live/source_locale); tests apps/cli/tests/workflow-run-command.test.ts:217-256 (test+command: 20 pass / 0 fail) |
| R3 | MET | apps/cli/tests/workflow-run-command.test.ts:202-260 — six static-invariant tests incl. task-local check (--auto alone leaves publish_live false, :223-229); fresh run: NODE_ENV=test bun test apps/cli/tests/workflow-run-command.test.ts → 20 pass, 0 fail, 111 expect() calls (test+command) |
| R4 | MET | docs/04_DESIGN.md:614-622 (§7.2 surface gains the eight flags) and :639 (0153 binding paragraph, ADR-022-consistent) (static-ref) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | workflow-run binds an end-to-end kk-itc profile: plugins/kk/commands/workflow-run.md:39-41,193-198,241-243; covered by apps/cli/tests/workflow-run-command.test.ts:206-260 (fresh: 20 pass / 0 fail). Task-local check (--auto alone leaves publish_live false) asserted at :223-229 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0153 (/sp:dev-review 0153 --auto, 2026-09-22)

**Scope:** uncommitted working-tree diff vs HEAD, measured against this task spec (Requirements R1–R4, AC1).
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.
**Verdict:** PASS (pipeline: APPROVED). Fresh evidence: `NODE_ENV=test bun test` on the four touched test files → **79 pass / 0 fail, 573 expect() calls**; `bun run lint` → biome "Checked 304 files", typecheck exit 0.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | `--max-revisions <N>` does not state that N must be a non-negative integer; a non-numeric value makes the `test -lt "${vars.max_revisions}"` guards error-and-evaluate-false (run routes to report/failed — bounded, no hang) | `plugins/kk/commands/workflow-run.md:38`, `plugins/kk/workflows/kk-itc.yaml:520-528` |
| 2 | P4 (advisory) | usability | Resolve-list annotation `MAX_REVISIONS` (`2`) reads as a resolved value next to `true|false` flags; cosmetic — flag default is unambiguous at :38 | `plugins/kk/commands/workflow-run.md:54` |

No P1–P3 findings. Both advisories are non-blocking; disposition: recorded, no fix required for this slice.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | all eight flags documented `plugins/kk/commands/workflow-run.md:38-39`; asserted by `apps/cli/tests/workflow-run-command.test.ts:206-215` |
| R2 | MET | binding rules `plugins/kk/commands/workflow-run.md:193-198` (auto defaults research/judge/unslop unless passed; `--live` never implied, ADR-022; wechat→zh, explicit `--source-locale` wins); JSON binds all new vars `:241`; tests `workflow-run-command.test.ts:217-255` |
| R3 | MET | `apps/cli/tests/workflow-run-command.test.ts:202-260` — six static tests incl. AC task-local check (`--auto` alone leaves `publish_live` false, `:227-228`); 79/79 pass fresh |
| R4 | MET | `docs/04_DESIGN.md:616-643` — §7 surface gains the eight flags plus a 0153 binding paragraph consistent with ADR-022 |
| AC1 | MET | workflow-run binds an end-to-end kk-itc profile; task-local check passes |

**Cross-slice consistency (0149–0152 vars):** the command JSON binds (`workflow-run.md:241`) match `plugins/kk/workflows/kk-itc.yaml:23-39` var names exactly — `auto`, `unslop`, `max_revisions`, `cover_enabled`, `inline_images`, `publish_targets`, `publish_live`, `source_locale` — and defaults agree (`max_revisions` 2, `source_locale` en, spend vars false, targets empty). `--live`/`publish_live` honors ADR-022 end to end: workflow gate `kk-itc.yaml:605` (`auto≠true ∨ publish_live=true` pauses) matches the flag rule and design §7 (`docs/design/kk-itc-end-to-end.md:24,40`).

**Architecture:** profile stays a thin static command surface — one parse rule, one resolve list, one JSON bind line; binding rules stated once and tested as text invariants (existing 0060 convention). New deterministic logic stayed out of the markdown (it lives in `itc-stages.ts` behind lazy sibling import, `kk-workflow-stages.ts:74-88`). No new abstraction, no shallow pass-through added by this slice.

**Residual risk:** the command is procedural markdown executed by an agent, so bindings are convention + static tests, not runtime-enforced; acceptable per the established command pattern (R19 bars a new command).

**Next:** none — proceed (advisories can ride with any later touch of the file).

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History

- 2026-09-22T22:58:28.879Z todo → wip (system)
- 2026-09-22T23:06:22.921Z wip → testing (system)
- 2026-09-22T23:06:24.107Z testing → done (system)

