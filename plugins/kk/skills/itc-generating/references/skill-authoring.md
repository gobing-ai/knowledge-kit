# Skill-authoring self-discipline (why this skill stays lean)

Distilled from the STORM study "How to Write the Best Technical Documentation with Agent Skills"
(works dir `how-to-write-the-best-technical-document-with-ex-2c52b35c`, provenance only). This
reference is the meta-discipline for *this skill*: it exists so `itc-generating` stays a thin
method+orchestration layer instead of re-vendoring craft or reimplementing sibling skills.

## The SKILL.md contract (hard limits)

- **Frontmatter**: `name` ≤64 chars, lowercase letters/numbers/hyphens only, no XML tags or
  reserved words, and must exactly match the parent directory name. `description` is non-empty,
  ≤1,024 chars, no XML tags.
- **Body budget**: keep SKILL.md under ~500 lines / ~5,000 tokens — just the core instructions the
  agent needs every run; split the rest into `references/`.
- **Context economics**: only `name` + `description` are pre-loaded; the rest enters context only
  when needed. The description is the *only* routing signal — write it as a third-person capability
  statement with explicit negative triggers so near-miss tasks are excluded.
- **Folder grammar**: SKILL.md + `references/` + `scripts/` + `assets/`, kept **exactly one level
  deep** (`references/schema.md`, not `references/db/v1/schema.md`). Avoid nested reference chains —
  when references point at references, the agent previews instead of reading fully.

## Progressive disclosure (the load-on-demand rule)

- Keep the always-loaded core minimal; push detail into `references/` with **just-in-time
  pointers**: "Read `references/api-errors.md` if the API returns a non-200" beats "see
  references/ for details".
- Three patterns: high-level guide + references; domain-specific organization; conditional details
  (branch to a section only when a condition holds).
- Prefer **deterministic scripts** for fragile/repetitive operations (link checks, format
  validation) — not for judgment-heavy authoring. Design their failure modes deliberately.

## Instruction design

- **Degree of freedom**: prescriptive exact-sequence instructions for fragile operations; goal-plus-
  philosophy for judgment-heavy work (authoring). Vague skills fail — "handle errors appropriately"
  carries no information.
- **Defaults, not menus**: pick one default and a one-line escape hatch, rather than listing
  options and hoping the agent chooses well.
- **Add what the agent lacks; omit what it knows**: the filter is "would the agent get this wrong
  without this instruction?" If no, cut it.
- Highest-value blocks: gotchas sections (environment facts that defy assumptions), output-format
  templates, checklists and self-check loops.

## Evaluation and review (how to keep improving the skill)

- Four validation passes: discovery (description in isolation — does it route correctly?),
  logic (deterministic steps, no hallucinated gaps), adversarial edge-case QA ("try to break this
  skill"), architecture refinement (enforce progressive disclosure).
- **Execute-then-refine** beats endless pre-polish: run the skill on real tasks and iterate;
  read execution traces, not just outputs (instructions retried many times, instructions followed
  that don't apply, too many options without a default).
- Add a **self-reflection step**: after a run, examine the friction log and improve the skill so
  the next run does not struggle the same way.

## How this skill applies it

`itc-generating` is one-level-deep by construction: SKILL.md points at the four `references/*.md`
files below it and loads them on demand (generic-craft always; playbook only when `--playbook` is
not `generic`). It reuses `topic`'s artifact contract rather than inventing a parallel workspace
(D5), delegates research/judging to `storm-research`/`judge` rather than reimplementing them (D6),
and stays under the body budget because the four STORM reports live in the works dirs as
provenance — never vendored here (D4).
