---
schema_version: 1
name: Cover illustration and kk:article-adapt per-platform variants
status: done
template: feature-impl
created_at: 2026-09-22T16:46:32.547Z
updated_at: "2026-09-23T04:59:23.130Z"
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

- [x] R1. Add the vars `cover_enabled` (false) and `inline_images` (false). An `illustrate` state sits between publish-entry and materialize. It runs `kk:image-authoring` with `KK_NONINTERACTIVE=1 KK_IMAGE_AUTO_CONFIRM=1` and writes `4-illustrations/cover.*` (plus `inline-*` when `inline_images` is true). When both vars are false, the state is not entered.
- [x] R2. New skill `plugins/kk/skills/article-adapt/SKILL.md`, authored and checked with `superskill skill` (scaffold, validate, evaluate). For each `publish-plan.json` variant with `adapt:true`, it:
  - translates `title` and `body` to the variant locale
  - applies the variant `limits`
  - keeps code blocks, URLs and `references`
  - writes the variant file
  The skill holds no platform table.
- [x] R3. An `adapt` state after publish-plan runs only when some variant has `adapt:true`. A follow-up shell step fails when a variant file is missing or lacks `title`/`body`.
- [x] R4. Tests cover the illustrate and adapt edge guards (structural), plus a seeded adapted variant that parses against `ContentSchema` and flows through `itc-publish-fanout` stamping.

### Acceptance Criteria

- [x] AC1 — Cover generation runs only when cover_enabled is true
- [x] AC2 — article-adapt writes one Content variant per target profile

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-itc-workflow.test.ts:106` |
| `apps/cli/tests/kk-itc-workflow.test.ts:2` |
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
| R1 | MET | `plugins/kk/workflows/kk-itc.yaml:37-38` (cover_enabled/inline_images default false); test `apps/cli/tests/kk-itc-workflow.test.ts:133` (new vars default off) |
| R2 | MET | `plugins/kk/skills/article-adapt/SKILL.md` present; command `superskill skill validate plugins/kk/skills/article-adapt/SKILL.md --json` 2026-09-22 → valid:true, 0 errors |
| R3 | MET | `plugins/kk/workflows/kk-itc.yaml:226-240` (adapt state + itc-adapt-verify); `plugins/kk/scripts/itc-stages.ts:430` (itcAdaptVerify); test `apps/cli/tests/itc-stages.test.ts:867` |
| R4 | MET | `plugins/kk/workflows/kk-itc.yaml:548-556` (publish-entry→illustrate guard), `:564` (illustrate→materialize), `:577` (adapt after publish-plan); workflow walk test `apps/cli/tests/kk-itc-publish-tail.test.ts:140` |
| R5 | MET | `plugins/kk/scripts/itc-stages.ts:314` (itcMaterialize; cover into metadata.coverImage per `:24-26` contract); test `apps/cli/tests/itc-stages.test.ts:152` |
| R6 | MET | `plugins/kk/workflows/kk-itc.yaml:554` (edge guard: cover_enabled OR inline_images) + `:207-208` (cover presence shell check); test `apps/cli/tests/kk-itc-workflow.test.ts:139` (default vars keep path unchanged) |
| R7 | MET | `plugins/kk/workflows/kk-itc.yaml:37-38` (spend approvals are vars); binding test `apps/cli/tests/workflow-run-command.test.ts:237` (spend approvals stay false unless passed) |
| R8 | MET | test `apps/cli/tests/kk-itc-publish-tail.test.ts:140` (spur workflow run --dry-run with auto=true + targets reaches done) |
| R9 | MET | `plugins/kk/workflows/kk-itc.yaml:235` (one adapted Content per adapt:true variant; limits applied; code/URLs/references unchanged); test `apps/cli/tests/itc-stages.test.ts:867` (verify branches) |
| R10 | MET | command `bun run gate` 2026-09-22 exit 0 (1231 pass / 0 fail) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/kk/workflows/kk-itc.yaml:554` (illustrate only when a spend var is on) + `:207` (cover_enabled=true with no cover fails); guard test `apps/cli/tests/kk-itc-workflow.test.ts:139` |
| AC2 | MET | test | `apps/cli/tests/itc-stages.test.ts:867` (itc-adapt-verify branches: missing/empty variant fails by name); adapt guard `plugins/kk/workflows/kk-itc.yaml:577` (only when plan has adapt:true) |
| AC3 | MET | test | `plugins/kk/workflows/kk-itc.yaml:236` (adapt never sets metadata.published/publishStatus/operation — fan-out stamps at send time); fanout stamping test `apps/cli/tests/itc-stages.test.ts:746` + `:212` (metadata.published false) |
| AC4 | MET | test | `apps/cli/tests/kk-itc-publish-tail.test.ts:140` (dry-run walk reaches done) |
| AC-7 | MET | test | alias of AC1: `plugins/kk/workflows/kk-itc.yaml:554,207`; test `apps/cli/tests/kk-itc-workflow.test.ts:139` |
| AC-9 | MET | test | alias of AC2/AC4: `apps/cli/tests/itc-stages.test.ts:867`; `apps/cli/tests/kk-itc-publish-tail.test.ts:140` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Reviewed:** working-tree diff vs HEAD (10 modified + 4 new files) against R1-R4/AC1-AC2. Verdict: **PASS (approved)**.

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | usability | Task-file hygiene: the `### Solution` and `### Testing` sections still hold their template placeholders — the implement/verify steps recorded no change map or test evidence in the task file (the evidence lives in the diff and tests) | `docs/tasks/0152_cover-illustration-and-kk-article-adapt-per-platform-variant.md` (Solution/Testing) |
| 2 | P4 (advisory) | security | `superskill skill evaluate` passes (grade B) with one anti-hallucination advisory ("add verify-with-source language"); for a translation skill the source is the in-context `content.json` already covered by the faithfulness invariant — accept | `plugins/kk/skills/article-adapt/SKILL.md` |
| 3 | P4 (advisory) | correctness | Spend-guard asymmetry: `cover_enabled=true` has a post-check that a cover artifact exists; `inline_images=true` has no analogous check, so silently skipped inline figures would go unnoticed (design §6 mandates only the cover check) | `plugins/kk/workflows/kk-itc.yaml:206-208` |
| 4 | P4 (advisory) | architecture | 0151's Review fix-verification row still cites the plan-time rejection (`itc-stages.ts:424-435`) that this task relocated into `itc-adapt-verify`; point-in-time review text — current behavior is documented in `docs/04_DESIGN.md` (0152 paragraph) and `kk-itc-publish-tail.test.ts:126` | `docs/tasks/0151_kk-itc-publish-tail-fan-out-browser-loop-retry-and-operator-.md` |

#### Functional traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1/AC1 | MET | vars default `"false"` (`kk-itc.yaml:37-38`); illustrate entered only when a spend var is on (`:549-555`), else-edge straight to materialize (`:556-562`); `KK_NONINTERACTIVE=1 KK_IMAGE_AUTO_CONFIRM=1` + `4-illustrations/cover.*` (`:192-208`); cover post-check; tests `kk-itc-workflow.test.ts:308-332` and the 14-transition dry-run walk (`:353-390`) |
| R2/AC2 | MET | `plugins/kk/skills/article-adapt/SKILL.md` — per `adapt:true` variant: translate title/body to the variant locale, apply plan `limits`, keep code/URLs/`references`, write `<entry.file>`; no platform table; `superskill skill validate --strict` → Valid, `evaluate` → PASS (B) |
| R3 | MET | `publish-plan → adapt` guarded on the jq `adapt:true` count (`kk-itc.yaml:577-584`), else-edge always (`:585-590`); follow-up `kk stage itc-adapt-verify` (`:240-241`) fails by name on missing files or empty title/body (`itc-stages.ts:429-453`) |
| R4 | MET | structural asserts for both guards (`kk-itc-workflow.test.ts:289-351`); seeded `ja-article` variant parses `ContentSchema` before and after fanout stamping (`kk-itc-publish-tail.test.ts:76-80,113-116`); `itc-adapt-verify` branch tests (`itc-stages.test.ts:861-929`) |

#### Relocation check (scope note — 0151 AC3/AC7)

The 0151 plan-time unadapted-variant rejection is gone from `itcPublishPlan` (now writes `adapt:true` variants and the plan, `itc-stages.ts:367-426`) and re-landed as the adapt state's follow-up verify (`itc-adapt-verify`, `itc-stages.ts:429-453`), which fails pre-gate by name before fan-out can run; fan-out keeps its own `existsSync` guard (`itc-stages.ts:483`). 0151 AC3 intent intact (fan-out group spawn/retry unchanged; `itc-publish-fanout` tests pass); AC7 intent intact — the fake-transport fixture still reaches draft ok Results with the variant seeded (`kk-itc-publish-tail.test.ts:63-137`), and the new regression test pins the failure at verify, not mid-tail (`:126-139`).

#### Fresh verification evidence

- `superskill skill validate plugins/kk/skills/article-adapt/SKILL.md --strict` → `Valid`
- `superskill skill evaluate …` → PASS, grade B
- `bun test` (3 kk-itc files) → 59 pass / 0 fail; `itc-stages.ts` 100% line, 92.76% branch
- `bun run lint` → exit 0 · `bun run test` → 1225 pass / 0 fail

**Residual risk:** the adapt/illustrate `agent.run` steps are model work and are not executed in CI — translation/figure quality is untestable there; the guard rails (`itc-adapt-verify`, switch stamping, cover post-check) bound the failure modes.

**Next:** approved — proceed to record/verdict in the pipeline (implementer's lane); P3 is implement-step task hygiene, P4s are accept/defer.

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History

- 2026-09-22T22:30:31.622Z todo → wip (system)
- 2026-09-22T22:49:38.479Z wip → testing (system)
- 2026-09-22T22:49:39.743Z testing → done (system)

