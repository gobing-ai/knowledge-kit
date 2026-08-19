---
topic: ITC generating agent skill — harvest IT-writing studies into plugins/kk
date: 2026-08-19
needs_design: true
run_id: 0c1b659e-f7ea-4ca3-88a5-338a96258128
---

# Brainstorm: ITC generating skill

## Overview

Four live STORM studies already sit in `~/.config/kk/works/` and answer "how to write IT
technical documents":

| Works dir | Topic |
| --- | --- |
| `how-to-write-the-best-generic-it-technical-docum-0a71c5a7` | Generic IT docs — five disciplines (structure, reader, team, maintenance, tooling) |
| `how-to-write-it-technical-documents-for-english-a6a76477` | English platforms — X threads, Medium, Substack |
| `how-to-write-it-technical-documents-for-specific-d158f7c2` | Platform-specific, including WeChat Official Account |
| `how-to-write-the-best-technical-document-with-ex-2c52b35c` | Encoding editorial judgment as agent skills |

Those reports are operator-local research artifacts. End users cannot invoke them. The request
is to add **one** agent skill under `plugins/kk/skills/` so a user can apply that craft without
re-running the studies.

Existing `plugins/kk` surfaces already cover adjacent jobs and must stay distinct:

- `topic` (F2, done) — topic-core authoring: `init → outline → draft`. Explicitly out of
  scope: research, illustration, adaptation, publishing.
- `storm-research` (C4) — evidence gathering → grounded `content.md`. "Do not merge into
  `topic`."
- `judge` (F1) — quality verdicts (`PASS` / `FAIL` / `NEEDS_REVISION`).
- `/workflow-run` — thin command that owns STORM config / YAML install / topic-id / `spur
  workflow run`. Exists because that run procedure is deterministic shell, not craft.

The operator also asked whether a slash command or a `kk` CLI verb is required. Those are
planning decisions, not implementation defaults. PRD `docs/01_PRD.md` still lists remaining
WT families (image, adaptation, publishing) as future **F** children — this idea is **not**
that harvest.

## Approaches

### Approach 1: Fat methodology + orchestration skill, no wrappers ⭐ Recommended

**Description:** Add `plugins/kk/skills/itc-generating/` (directory name matches skill
`name`; `superskill install kk` ships `kk:itc-generating`). The SKILL.md is a lean
orchestrator: when to use, operations, fail-loud table, and pointers into `references/`.
The four studies are **distilled** (not copied wholesale) into progressive-disclosure
references — generic craft, English-platform playbook, WeChat/specific-platform playbook,
skill-authoring discipline. Runtime work is delegated: `storm-research` when evidence is
missing, `topic` for outline/draft gates, optional `judge` before the draft is treated as
done.

**Trade-offs:**
- **Pros:** one installable skill matches the request; `topic` stays small; study findings
  become on-demand context (name+description load first — matches the agent-skill study);
  no ADR-011 change; no bare-forwarder slash (ADR-016); no product-plugin / `kk executor
  run` surface for something that is agent craft.
- **Cons:** users must invoke a skill (or let the agent auto-route from the description),
  not a one-token `/itc`; platform playbooks are writing guidance, not live publish; the
  works-dir reports stay provenance, so the distill must be maintained if the studies are
  re-run.

**Implementation Notes:**
- Fix the requested path typo `itc-gnerating` → `itc-generating`. Skill `name` must match
  the parent directory (agent-skill study + superskill validate). Shipping the typo would
  freeze `kk:itc-gnerating`.
- Feature home: **F3** under **F** (kk plugin collection). Do not reopen F2.
- No `plugins/kk/commands/*`. No new `kk` noun or verb.
- No generator `plugin.json`, no `GeneratorInput → Content` change, no WT 7-stage harvest.
- Workspace: reuse `topic`'s file-backed artifacts (`brief.md`, `2-outline/`, `3-draft/`).
  Do not invent a second authoring layout.

**Confidence:** HIGH
**Sources:**
- Four works reports listed above | **Verified**: 2026-08-19
- `plugins/kk/skills/topic/SKILL.md`, `storm-research/SKILL.md`, `judge/SKILL.md` | **Verified**: 2026-08-19
- `docs/00_ADR.md` ADR-011; `docs/01_PRD.md` F / remaining WT families; F2 feature file | **Verified**: 2026-08-19

### Approach 2: Same skill + one thin slash command

**Description:** Approach 1 plus `plugins/kk/commands/itc.md` (or `itc-generate.md`) whose
body is "read the skill, pass `$ARGUMENTS` through."

**Trade-offs:**
- **Pros:** discoverable as `/itc` on Claude Code; matches the operator's "if needed" clause.
- **Cons:** `topic` shipped with **no** wrapper (F2 scope: "no wrappers"). `/workflow-run`
  exists only because it owns a deterministic run procedure (config create, YAML copy,
  `topicId()`, `spur workflow run`). A slash that only forwards to a skill is the
  bare-forwarder anti-pattern (ADR-016). Extra install/validate surface for zero new
  behavior.

**Implementation Notes:** Add the command only if the operator overrides Approach 1. If
added, it must own a real procedure (argument parse + workspace detect + fail-loud) — not
a one-line "read the skill."

**Confidence:** HIGH that it is feasible; LOW that it is necessary.

### Approach 3: Skill + new `kk` CLI verb (or extend `topic`)

**Description (3a):** Add a first-layer or executor-adjacent `kk` command that writes
documents. **(3b):** Fold the studies into `topic` instead of a new skill.

**Trade-offs:**
- **Pros:** 3a is scriptable without an agent; 3b avoids a new skill name.
- **Cons:** 3a contradicts ADR-011 (first-layer nouns are exactly `executor` and `plugin`)
  and the C4 invariant "no new `kk` first-layer noun." This work is editorial craft, not
  `kk executor run` of a product plugin. 3b blows F2's frozen scope (`topic` excludes
  research, adaptation, publishing) and the agent-skill study's 500-line / ~5k-token
  SKILL.md budget. `storm-research` already forbids merging research into `topic`.

**Confidence:** HIGH that both variants are the wrong owner.

## Recommendations

Ship **Approach 1**. The studies are a writing method; `topic` is already the authoring
machine; `storm-research` is already the evidence machine; `judge` is already the gate.
The missing piece is one fat skill that *loads the method* and *calls those skills*, not
a second authoring loop, a slash alias, or a CLI noun.

**When to pick Approach 2:** only if you want a Claude-Code-only `/itc` for discoverability
and accept a non-forwarder command that owns parse + workspace + fail-loud. Default is
no.

**When to pick Approach 3:** never without a new ADR. Reject 3b outright.

## Design Summary

| Decision | Choice | Why |
| --- | --- | --- |
| Directory / skill name | `plugins/kk/skills/itc-generating` (`name: itc-generating`) | Matches directory (skill-authoring study); install id `kk:itc-generating`; requested `itc-gnerating` is a typo |
| Feature home | **F3** under **F** | Collection parent for `plugins/kk`; F2 (`topic`) stays done and unenlarged |
| Surface | Skill only | Same as `topic`. Slash only when it owns a run procedure (`/workflow-run`). CLI blocked by ADR-011 |
| Role | Methodology + orchestration | Distill the four studies; delegate authoring to `topic`, research to `storm-research`, optional gate to `judge` |
| Authoring artifacts | Reuse `topic` paths | One workspace contract; no parallel `0-materials/`…`6-publish/` tree |
| Study harvest | Distill into `references/` (4 files, one level deep) | Progressive disclosure; do not vendor full `content.md`; works dirs remain provenance |
| Out of scope | Live publish, images, generator plugin, WT 7-stage harvest, new `kk` noun | PRD deferred F-children + ADR-011 + F2/C4 boundaries |
| Wrappers | None in this feature | Add a slash later only with a real procedure, as a follow-on F child |

`needs_design`: **true** — new capability module, cross-skill contract (`topic` /
`storm-research` / `judge`), surface (skill vs slash vs CLI), feature-tree placement,
reference harvest. Ties lean design.

## Next Steps

1. Operator approves or reshapes this evaluation (idea-eval taste gate).
2. Create feature **F3** from the enhanced idea; author AC against Approach 1.
3. System-design: satellite `docs/design/itc-generating.md` (skill contract, reference
   map, delegation rules, fail-loud table). No ADR unless surface is overridden to CLI.
4. Decompose into a small task batch (skill scaffold + references harvest + superskill
   validate/install dry-run + docs sync).

## Spec self-review

- No `TODO` / `TBD` / `???` placeholders.
- No contradiction with F2 (`topic` stays topic-core), C4 (`storm-research` stays
  research), ADR-011 (no new `kk` noun).
- Scope does not include WT illustration / adaptation / publish harvest.
- Directory spelling is an explicit, reversible planning choice.

---

**Generated by:** sp-brainstorm (idea-pipeline discovery, inline — omp `agent.run` skipped;
previous wrap runs hang on omp in this env, `.spur/context/learnings.md` 2026-08-02 E3)
**Research delegation:** current-session read of the four works reports + in-repo authority
docs. No `spur agent run`.
