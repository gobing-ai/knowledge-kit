---
schema_version: 1
name: "Add the itc-generating fat skill with distilled IT-writing references"
status: done
template: feature-impl
created_at: 2026-08-19T18:53:39.131Z
updated_at: "2026-08-19T19:29:50.127Z"
feature_id: F3
priority: P2
tags: ["kk", "skill", "itc-generating"]
---

## 0068. Add the itc-generating fat skill with distilled IT-writing references

### Background

Implements: R1 — Produce an approved IT technical draft from a topic or brief; R2 — Distill the four IT-writing studies as on-demand references; R3 — Delegate research and judging without enlarging topic; R4 — Install the skill through Superskill without new wrappers; R5 — Missing or unsafe inputs fail loud.

Feature F3 encodes the four works-dir STORM studies as one installable skill so end users apply that craft without re-running research. Operator approved Approach 1 (idea-eval + design-approval): skill only at `plugins/kk/skills/itc-generating`; no slash; no `kk` CLI verb. Satellite: `docs/design/itc-generating.md`.

Rubric: E6 D1 L1 C0 R0 = 8, but cohesion overrides — SKILL.md, four references, and the install dry-run share one directory and one review context (F2/0048 precedent). Kept as one task. HITL quiz auto-skipped (`--auto`).

Rejected split: separate tasks for references vs SKILL.md vs superskill validate — same file surface, triples ceremony for one diff.

### Requirements
- [x] R1. Add `plugins/kk/skills/itc-generating/SKILL.md` whose default `create` operation applies the distilled generic-craft method and delegates outline selection plus draft review to `topic`, writing the same topic artifact paths.
- [x] R2. Distill the four works-dir studies into one-level-deep `references/` (generic-craft, platform-english, platform-wechat, skill-authoring); SKILL.md points at them and does not vendor the full STORM reports.
- [x] R3. When `--research` or `--judge` is set, invoke `storm-research` and/or `judge`; do not add research, illustration, adaptation, or publish operations to `topic`.
- [x] R4. Pass Superskill validation and the repository-local `kk` marketplace install dry-run; add no itc slash command and no first-layer `kk` CLI noun.
- [x] R5. Fail loud with a specific recovery instruction for an empty topic, a missing prerequisite, or an existing initialization target; never overwrite without `--force`.
### Acceptance Criteria

```gherkin
Feature: kk ITC generating

  @core
  Scenario: R1 — Produce an approved IT technical draft from a topic or brief
    Given a topic or Markdown brief and a new target directory
    When the itc-generating create operation runs
    Then it applies the distilled generic-craft method
    And it delegates outline selection and draft review to the topic skill
    And it writes the same topic artifact paths

  @core
  Scenario: R2 — Distill the four IT-writing studies as on-demand references
    Given the repository kk marketplace plugin
    When the itc-generating skill is read
    Then SKILL.md points at four one-level-deep references
    And those reference files exist
    And the skill body does not vendor the full STORM reports

  @core
  Scenario: R3 — Delegate research and judging without enlarging topic
    Given an itc-generating run that needs evidence or a quality gate
    When research or judging is required
    Then it invokes storm-research and/or judge
    And it does not add research, illustration, adaptation, or publish operations to topic

  @core
  Scenario: R4 — Install the skill through Superskill without new wrappers
    Given the repository kk marketplace plugin
    When Superskill validates the skill and performs an install dry-run
    Then itc-generating is discovered as an installable skill
    And no target installation files are written by the dry-run
    And no itc slash command or first-layer kk CLI noun is added

  @edge
  Scenario: R5 — Missing or unsafe inputs fail loud
    Given an empty topic, a missing prerequisite artifact, or an existing initialization target
    When the corresponding itc-generating operation runs
    Then it stops with a specific recovery instruction
    And it does not overwrite existing content
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: one fat `itc-generating` skill (D1–D7 in `docs/design/itc-generating.md`). `create` loads `references/generic-craft.md` plus the selected `--playbook`, optionally runs `storm-research`, then `topic create` (same `brief.md` / `2-outline/` / `3-draft/` contract and gates), then optionally `judge` (`tech-accuracy`). Directory name matches `name:` so install id is `kk:itc-generating`.

Rejected: slash wrapper (bare forwarder; `topic` has none); new `kk` noun (ADR-011); folding method into `topic` (F2 scope + SKILL.md size budget); vendoring full `content.md`; a parallel 7-stage workspace.

Invariants: no `plugins/kk/commands/itc*`; `kk --help` still lists only `executor` and `plugin`; `topic` / `storm-research` / `judge` contracts unchanged; no generator `plugin.json`.

### Plan

1. Scaffold `plugins/kk/skills/itc-generating/SKILL.md` with purpose, when/not, invocation contract, `create` sequence, fail-loud table, and reference pointers.
2. Distill the four works-dir studies into `references/generic-craft.md`, `platform-english.md`, `platform-wechat.md`, `skill-authoring.md` (one level deep; no full-report paste).
3. Wire `--research` / `--judge` / `--playbook` as delegation, not reimplementation.
4. Run superskill validate + install dry-run; confirm no itc command file and no new `kk` noun.
5. Dogfood fail-loud rows (empty topic, existing target without `--force`) and a throwaway `create` that lands topic artifact paths.

### Solution
| File | Change | Why |
| --- | --- | --- |
| `plugins/kk/skills/itc-generating/SKILL.md:1-10` | New fat skill frontmatter: `name: itc-generating` (matches parent dir → install id `kk:itc-generating`) + routing description. | R1/R4: capability statement with negative triggers; name must match directory. |
| `plugins/kk/skills/itc-generating/SKILL.md:12-19` | Purpose: one `create` operation applying the distilled generic-craft method and orchestrating `topic` / `storm-research` / `judge`. | R1/R3/D6: skill owns method + orchestration, never reimplements the delegated skills. |
| `plugins/kk/skills/itc-generating/SKILL.md:32-52` | Invocation contract: `[create] <topic-or-brief> [--dir] [--brief] [--playbook generic\|english\|wechat] [--research] [--judge] [--outline] [--revise] [--force]`; `create` is the only operation. | R3/R5: `--research`/`--judge`/`--playbook` are delegation switches, not new operations. |
| `plugins/kk/skills/itc-generating/SKILL.md:66-71` | References pointer table: `references/generic-craft.md` (always), `platform-english.md`/`platform-wechat.md` (on `--playbook`), `skill-authoring.md` (editing this skill). Works-dir studies cited as provenance, not vendored. | R2/D4: one-level-deep references; progressive disclosure; no full-report paste. |
| `plugins/kk/skills/itc-generating/SKILL.md:73-84` | Artifact contract table reusing `topic`'s exact paths (`brief.md`, `2-outline/outline-option-{a,b,c}.md`, `2-outline/outline-approved.md`, `3-draft/draft-article.md`). | R1/D5: same topic artifact paths; no parallel workspace. |
| `plugins/kk/skills/itc-generating/SKILL.md:86-107` | `create` sequence: input check → target check → load method (generic-craft + playbook) → optional `storm-research` → delegate outline/draft gates to `topic` → apply method → optional `judge` (`tech-accuracy`) → print paths. | R1/R3/R5: delegation of outline selection + draft review to `topic`; research/judge as optional invocations. |
| `plugins/kk/skills/itc-generating/SKILL.md:109-124` | Fail-loud table: 6 rows, each a specific stop + recovery instruction. | R5: empty topic, missing `--brief` path, `--research` without topic/`--in`, missing prerequisite (delegated to `topic`), existing init target without `--force`, unknown operation. |
| `plugins/kk/skills/itc-generating/SKILL.md:126-133` | Invariants: only `create`; no research/illustration/adaptation/publish ops on `topic`; reuse topic paths; contracts unchanged; no `plugins/kk/commands/itc*`, no `kk` noun, no generator `plugin.json`. | R3/R4. |
| `plugins/kk/skills/itc-generating/SKILL.md:135-147` | Skill()/agent.run prompt template + operator pause at `topic`'s gates. | Invocation contract for downstream consumers. |
| `plugins/kk/skills/itc-generating/references/generic-craft.md:1-80` | Distilled five-discipline IT-writing method (structure/scope, reader advocate, team discipline, maintenance, tooling) + how to apply in `create`. | R2/D4: distilled from works dir `how-to-write-the-best-generic-it-technical-docum-0a71c5a7`; always loaded. |
| `plugins/kk/skills/itc-generating/references/platform-english.md:1-72` | English-platform playbook (X/Medium/Substack choice, launch, growth, voice, repurposing) + application note. | R2: `--playbook english`; distilled from works dir `how-to-write-it-technical-documents-for-english-a6a76477`. |
| `plugins/kk/skills/itc-generating/references/platform-wechat.md:1-60` | WeChat Official Account playbook (account types, hard limits, Markdown pipeline, mobile formatting, editorial standards) + application note. | R2: `--playbook wechat`; distilled from works dir `how-to-write-it-technical-documents-for-specific-d158f7c2`. |
| `plugins/kk/skills/itc-generating/references/skill-authoring.md:1-62` | Skill-authoring self-discipline (SKILL.md contract, progressive disclosure, instruction design, evaluation) + how this skill applies it. | R2/D4: distilled from works dir `how-to-write-the-best-technical-document-with-ex-2c52b35c`; why this skill stays lean. |

## R5 static verification (fail-loud rows — no runtime simulation; skill is a markdown agent skill)

Each R5 trigger maps to a concrete row in the fail-loud table `plugins/kk/skills/itc-generating/SKILL.md:109-124` with a specific recovery instruction and a no-overwrite guarantee:

| Trigger | Row | Behavior | Recovery instruction |
| --- | --- | --- | --- |
| Empty topic | `:116` | Stop; no files created | Provide a topic phrase or `--brief <path>` |
| Missing `--brief` path | `:117` | Stop; no files created | Check the path; supply a real Markdown brief |
| Missing prerequisite (outline before draft) | `:119` | Stop; nothing written | The recovery comes from `topic` — run the prerequisite step first (see `topic` fail-loud table) |
| Existing init target without `--force` | `:120` | Stop; no overwrite | Confirm with the operator and pass `--force`, or choose a new `--dir` |
| Unknown operation | `:121` | Stop; nothing written | Use `create` (the only operation) or call `topic` / `storm-research` / `judge` directly |

The no-overwrite-without-`--force` guard is stated twice: create step 2 (`:90-92`, "Never overwrite without `--force`") and the table row `:120`. The artifact-path contract is satisfied by delegation: `create` step 4 (`:96-101`) runs `topic create` against `--dir`, so `topic`'s own init→outline→draft gates and paths (`plugins/kk/skills/topic/SKILL.md`) produce `brief.md`, `2-outline/outline-option-{a,b,c}.md`, `2-outline/outline-approved.md`, and `3-draft/draft-article.md`. Per supervisor direction, R5 dogfood is recorded as this static/documented verification rather than a /tmp artifact simulation (a bash simulation with hand-written files would be circular evidence — it proves hand-written paths, not skill behavior).

**Dogfood note:** a throwaway `create` that lands topic artifact paths is delegated entirely to `topic` (which already owns the init→outline→draft paths and gates); this skill contributes the method and orchestration only, so the artifact-landing behavior is covered by `topic`'s own contract. No runtime simulation was performed.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/skills/itc-generating/SKILL.md:16-22` |
| R2 | MET | `plugins/kk/skills/itc-generating/SKILL.md:63-73` |
| R3 | MET | `plugins/kk/skills/itc-generating/SKILL.md:128-131` |
| R4 | MET | command: `superskill skill validate plugins/kk/skills/itc-generating --json` exit 0 `{"valid":true,"findings":[]}`; `superskill install kk --dry-run` exit 0 no target writes; `bun apps/cli/src/index.ts --help` Commands executor and plugin only |
| R5 | MET | `plugins/kk/skills/itc-generating/SKILL.md:112-124` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| [docs-only] R1 — Produce an approved IT technical draft from a topic or brief | MET | static-ref | `plugins/kk/skills/itc-generating/SKILL.md:16-22` |
| [docs-only] R2 — Distill the four IT-writing studies as on-demand references | MET | static-ref | `plugins/kk/skills/itc-generating/SKILL.md:63-73` |
| [docs-only] R3 — Delegate research and judging without enlarging topic | MET | static-ref | `plugins/kk/skills/itc-generating/SKILL.md:128-131` |
| R4 — Install the skill through Superskill without new wrappers | MET | command | `superskill skill validate plugins/kk/skills/itc-generating --json` exit 0 valid:true; `superskill install kk --dry-run` exit 0; `bun apps/cli/src/index.ts --help` executor + plugin only |
| [docs-only] R5 — Missing or unsafe inputs fail loud | MET | static-ref | `plugins/kk/skills/itc-generating/SKILL.md:112-124` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Design conformance** — chosen approach DONE, no deviations: one fat `itc-generating` skill with `create` operation (`plugins/kk/skills/itc-generating/SKILL.md:1-148`) and four distilled references (`plugins/kk/skills/itc-generating/references/generic-craft.md`, `platform-english.md`, `platform-wechat.md`, `skill-authoring.md`). Provenance preserved in works dirs without vendoring full STORM reports. Delegation to `topic`, `storm-research`, and `judge` preserves contracts without adding new CLI nouns or command files.

**SECUA Review** — no P1–P3 findings.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | Security | `plugins/kk/skills/itc-generating/SKILL.md:51` | Supplied topic briefs are read as data; the prompt template scopes briefs to outline/draft input and does not execute embedded directives. | Advisory recorded; no code change needed. |
| P4 | Usability | `plugins/kk/skills/itc-generating/SKILL.md:53` | Playbook selector defaults to `generic` with explicit options `generic|english|wechat`. | Documented and verified. |

**Architecture depth** — no deepening candidates. The skill is a self-contained capability module matching ADR-009 (`plugins/kk` capability home) and ADR-011 (first-layer nouns invariance). Progressive disclosure via one-level-deep references keeps SKILL.md lean and maintainable.

**Disposition:** PASS — no blocker or major findings; two P4 advisories recorded.
### References
- Feature **F3**: `docs/features/F3_itc-generating-skill.md`
- Design satellite: `docs/design/itc-generating.md`
- Brainstorm: `docs/plans/2026-08-19-itc-generating-skill-brainstorm.md`
- Skill: `plugins/kk/skills/itc-generating/SKILL.md`
- Delegates: `plugins/kk/skills/topic/SKILL.md`, `plugins/kk/skills/storm-research/SKILL.md`, `plugins/kk/skills/judge/SKILL.md`
### History
- 2026-08-19T19:14:53.289Z todo → wip (system)
- 2026-08-19T19:14:54.878Z wip → testing (system)
- 2026-08-19T19:15:34.012Z testing → done (system)
