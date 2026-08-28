---
topic: Consolidate vendor eli5 + show-me into plugins/kk explain-things skill and /tell-me command
date: 2026-08-26
needs_design: false
---

# Brainstorm: explain-things skill + tell-me command

## Overview

Two well-known vendor skills already live in this repo as provenance, not as an installable
kk capability:

| Path | What it is | Shape |
| --- | --- | --- |
| `vendors/misc/eli5/SKILL.md` | Explain like a 5-year-old | 10-line skill: HTML artifact, big pictures, few words; topic is `$ARGUMENTS` |
| `vendors/misc/show-me/SKILL.md` | Visual understanding of the current topic | ~130-line view catalog: pseudocode, call tree, component tree, file tree, Mermaid, diff, copyable block, last-resort focused HTML |

`superskill install kk` does **not** ship them. The operator asked for **one** consolidated
agent skill at `plugins/kk/skills/explain-things` plus a thin slash wrapper at
`plugins/kk/commands/tell-me.md`, and invited a better consolidation than a paste-merge.

Existing `plugins/kk` surfaces that must stay distinct:

- `topic` / `itc-generating` / `storm-research` — author or research content, not explain it.
- `content-judge` — evaluate content against a rubric.
- `/workflow-run` — owns a deterministic run procedure (config, YAML resolution, workspace,
  `spur workflow run`). It is not a model for a conversational explainer.

`plugins/kk/README.md` already names `commands/` as **thin slash-command wrappers** of fat
skills. F3 (`itc-generating`) shipped skill-only because a slash would have been a
bare-forwarder with no extra behavior; this request *is* the slash, so the command must stay
thin and the skill must own the craft.

Parent: **F** (kk plugin collection). Next free child is **F9** (F1–F8 exist; DD-14 cap is 9
children — this fills the last slot under F).

## Approaches

### Approach 1: Unified smallest-view skill + one thin `/tell-me` ⭐ Recommended

**Description:** Distill both vendors into one procedure, not two modes glued together.
Default: skip the preamble, pick the **smallest view** that makes the key point clear
(show-me), keep prose brief, place each visual next to the short text it supports. The ELI5
register (big-picture analogy, few words, optional HTML infographic) is an **escape hatch**,
not the default — triggered when the user says "like I'm 5", `/eli5`, or `--eli5`. Empty
`$ARGUMENTS` uses the current conversation topic; if that is also empty, fail loud. HTML is
last-resort (concept too dense for Mermaid/trees), never the always-on path — eli5's
always-HTML is wrong for TUI coding agents. `/tell-me` is a thin wrapper: frontmatter +
argument-hint + "use the explain-things skill" + pass `$ARGUMENTS`. No subagent, no extra
`/eli5`/`/show-me` aliases (the skill `description` is the routing signal), no `kk` CLI noun.

**Trade-offs:**
- **Pros:** one installable capability (`kk:explain-things`); one human-facing slash
  (`/tell-me`); view catalog stays one home (`references/views.md`); TUI-first; matches
  README thin-wrapper contract; vendor files stay provenance (not vendored wholesale);
  description triggers cover "eli5", "show me", "explain", "tell me", "how does X work".
- **Cons:** ELI5-always-HTML fans lose the picture-first default; two names (skill
  `explain-things` vs command `tell-me`) must be documented so agents do not invent a
  `/explain-things` command; F9 fills F's last child slot.

**Implementation Notes:**
- Feature home: **F9** under **F**. Do not reopen F2/F3.
- Skill `name` must match the directory (`explain-things` → install id `kk:explain-things`).
- Command `name: tell-me` (user-facing); body delegates to the skill; it does not restate
  the view catalog.
- Distill show-me's view list into `references/views.md` (one level deep). SKILL.md stays
  lean: when to use, procedure, register default + ELI5 hatch, fail-loud, pointer to views.
- No `plugins/kk/agents/` wrapper (README: do not re-add persona wrappers).
- No first-layer `kk` noun (ADR-011).
- Authoring: `superskill skill scaffold` / `superskill command scaffold` then hand-fill
  from the distilled procedure — do not copy vendor files verbatim.
- Validation: `superskill skill validate` + `superskill command validate` +
  `superskill install kk --dry-run`.
- Docs: same-commit `docs/04_DESIGN.md` surface note if the command is listed as a kk
  capability; `plugins/kk/README.md` capability list.

**Confidence:** HIGH
**Sources:**
- `vendors/misc/eli5/SKILL.md`, `vendors/misc/show-me/SKILL.md` | **Verified**: 2026-08-26
- `plugins/kk/README.md`, `plugins/kk/commands/workflow-run.md`, F3 brainstorm | **Verified**: 2026-08-26
- `docs/00_ADR.md` ADR-009 / ADR-011; `docs/features/F_kk-plugin-collection.md` | **Verified**: 2026-08-26
- `plugins/kk/skills/itc-generating/references/skill-authoring.md` (SKILL.md budget, name=dir) | **Verified**: 2026-08-26

### Approach 2: Layered always-on (analogy + visual + mechanism)

**Description:** Same paths and thin `/tell-me`, but every answer is a fixed three-beat
template: (1) one-sentence analogy, (2) one visual from the view catalog, (3) the mechanism
in ≤5 bullets. ELI5 is just beat (1) turned up. HTML still last-resort.

**Trade-offs:**
- **Pros:** consistent output shape; harder for the agent to dump a wall of prose; good
  teaching default for "how does X work".
- **Cons:** overkill when the user only needs a call tree or a diff ("just show me");
  fights show-me's "smallest view" / "do not overwhelm" invariant; more instruction the
  agent will ignore on a one-line question.

**Implementation Notes:** Freeze the three-beat template in SKILL.md as the default, with
one escape hatch: if the user asks only for a diagram, skip beats 1 and 3. Slightly more
prescriptive than Approach 1.

**Confidence:** HIGH that it is feasible; MEDIUM that it is the right default (it will
annoy "just show me the tree" uses).

### Approach 3: Mode-split skill + alias commands

**Description:** Fat skill with named operations `explain` (default) | `eli5` | `show`.
`/tell-me` selects the mode (`--eli5` / `--show`). Also ship `/eli5` and `/show-me` as
alias commands that pin the operation. Closer to a literal merge of the two vendors.

**Trade-offs:**
- **Pros:** familiar vendor names stay as slashes; explicit mode for workflows that want
  picture-first every time.
- **Cons:** three commands for one capability; aliases are bare-forwarders; SKILL.md
  grows a mode table the agent must parse; F3 already rejected extra wrappers without a
  distinct procedure; operator asked for **one** command.

**Implementation Notes:** Only pick this if discoverability of `/eli5` and `/show-me` is
a hard requirement. Prefer encoding those strings in the skill `description` instead.

**Confidence:** HIGH that it is feasible; LOW that the extra commands earn their keep.

## Recommendations

Ship **Approach 1**. The vendors are two *registers* of the same job (make the current
topic graspable) — not two products. Show-me already has the better default (smallest
view, TUI-friendly). Eli5's value is the picture-first register when the reader is lost,
not "always write HTML and open it."

**When to pick Approach 2:** if you want every `/tell-me` to feel like a mini-lesson.
Accept that "just the sequence diagram" gets three beats unless the hatch is used.

**When to pick Approach 3:** only if `/eli5` and `/show-me` must exist as named slashes
for muscle memory. Default is no — put those phrases in the skill description.

**Rejected without a new ADR:** a `kk` CLI verb; a generator `plugin.json`; folding this
into `topic` or `content-judge`; a persona subagent under `plugins/kk/agents/`.

## Design Summary

| Decision | Choice | Why |
| --- | --- | --- |
| Directory / skill name | `plugins/kk/skills/explain-things` (`name: explain-things`) | Operator path; name matches directory; install id `kk:explain-things` |
| Command | `plugins/kk/commands/tell-me.md` (`name: tell-me`) | Operator path; human-facing slash; thin wrapper, skill owns craft |
| Feature home | **F9** under **F** | Collection parent for `plugins/kk`; F1–F8 taken; last DD-14 slot under F |
| Procedure | Smallest view + brief prose; ELI5 register on request | Distills both vendors; TUI-first; HTML last-resort |
| View catalog | `references/views.md` (one level deep) | Progressive disclosure; do not vendor show-me wholesale into SKILL.md |
| Empty topic | Current conversation topic; else fail loud | show-me's "current topic" + eli5's `$ARGUMENTS` |
| Subagent | None | README: no persona wrapper without a distinct run procedure |
| CLI | None | ADR-011 — first-layer nouns remain `executor` + `plugin` |
| Vendor files | Provenance only | Do not copy `vendors/misc/*` into the skill tree |
| Out of scope | Live HTML app, image generation, new `kk` noun, extra `/eli5` `/show-me` commands, workflow YAML | Conversational skill, not a pipeline step |

`needs_design`: **false** — single existing collection (`plugins/kk`), existing fat-skill
+ thin-command pattern, no schema/DTO/transport/new package, no cross-skill contract.
Task `### Design` still ships (idea-pipeline design package default-on). A feature
satellite is not required.

## Next Steps

1. Operator approves or reshapes this evaluation (idea-eval taste gate).
2. Create feature **F9** from the enhanced idea; author AC against Approach 1.
3. Skip `system-design` (`needs_design: false`). Decompose into a small task batch
   (skill + views reference + command + superskill validate/install dry-run + README /
   DESIGN surface note).
4. Implement via `/sp:dev-runall --feature F9` (or `/sp:dev-run` on the first WBS).

## Spec self-review

- No `TODO` / `TBD` / `???` placeholders.
- No contradiction with F2 (`topic` stays authoring), F1 (`content-judge` stays verdicts),
  ADR-011 (no new `kk` noun), ADR-009 (capability lives under `plugins/kk`).
- Command is requested by the operator — not a drive-by wrapper.
- F9 filling F's last child slot is an explicit, reversible planning choice (a later
  grouping feature would be a `/sp:dev-feature-change`, not this work).

---

**Generated by:** sp-brainstorm (idea-pipeline discovery, inline — omp `agent.run` skipped;
host session is grok, operator present; `--auto` without `--approve-taste` so idea-eval
still pauses)
**Research delegation:** current-session read of vendor skills, `plugins/kk` layout, F-tree,
ADR-009/011, skill-authoring reference. No `spur agent run`.
