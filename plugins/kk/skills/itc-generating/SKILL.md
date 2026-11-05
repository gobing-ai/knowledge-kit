---
name: itc-generating
description: >-
  Use the itc-generating skill to produce an approved IT technical draft from a
  topic or Markdown brief, applying the distilled generic IT-writing method and
  an optional platform playbook — "write an article about X applying the IT
  writing method", "generate an IT technical draft on X", "create a technical
  article for WeChat/English platforms". Orchestrates topic (outline + draft),
  optional storm-research, and optional content-judge without enlarging those skills.
requires: [cli:kk, local-fs]
---

# itc-generating — IT technical draft generation (method + orchestration)

## Purpose

Turn a topic or Markdown brief into an **approved IT technical draft** by applying the distilled
IT-writing craft and orchestrating the existing `kk` skills — `topic` (outline + draft), optional
`storm-research` (evidence), optional `content-judge` (technical-accuracy gate). One fat skill with one
operation, `create`, whose default is the distilled generic-craft method; it delegates outline
selection and draft review to `topic` and writes the **same topic artifact paths**. This skill owns
*which* method and *when* to research/judge — it never reimplements topic-core, research, or
evaluation (D6).

## When to use

- A user asks to write an IT technical article from a topic or brief and wants the distilled
  IT-writing method applied ("write an IT article about X", "produce a technical draft on X").
- A user wants a specific platform playbook applied to the draft (`--playbook english` / `wechat`).
- A user wants the same topic artifact contract but with the writing method and optional
  research/judging orchestrated around it.

Do **not** use this skill for: a single topic-core step without the method (call `topic` directly);
research alone (call `storm-research`); evaluating content alone (call `content-judge`); publishing,
platform adaptation, or image generation (all out of scope); anything requiring a runtime plugin
(`kk executor run`, `plugin.json`, `GeneratorInput → Content`).

## Invocation contract

`$ARGUMENTS` (or the Skill call args) parse as:

```
[create] <topic-or-brief> [--dir <target>] [--brief <path>]
         [--playbook generic|english|wechat]
         [--research] [--judge]
         [--outline <a|b|c>] [--revise <feedback>] [--force]
```

| Token | Meaning | Default |
| --- | --- | --- |
| `create` | the only operation; may be omitted | `create` |
| `<topic-or-brief>` | quoted topic phrase, or `--brief <path>` naming a Markdown brief file | required — empty fails loud |
| `--dir <target>` | workspace directory | `./<kebab-case(topic)>` (same default as `topic`) |
| `--playbook <p>` | which reference to load as the writing method | `generic` |
| `--research` | if the workspace has no evidence, run `storm-research` first | off |
| `--judge` | after an approved draft, run `content-judge` with the `tech-accuracy` rubric | off |
| `--outline <a\|b\|c>` | explicit outline selection (passed through to `topic`) | operator selects at the gate |
| `--revise <feedback>` | revision feedback for the draft review gate (passed through to `topic`) | none (approve path) |
| `--force` | explicit operator approval to replace an existing artifact (passed through to `topic`) | off — never overwrite without it |

Flags may appear in any order; the first bare positional token is the topic phrase. An unknown
operation (anything other than `create`) fails loud and lists `create` as the only valid operation.

## References (loaded on demand, R2)

| File | When to load |
| --- | --- |
| `references/generic-craft.md` | **always** on every `create` run — the five IT-writing disciplines |
| `references/platform-english.md` | `--playbook english` — X / Medium / Substack playbook |
| `references/platform-wechat.md` | `--playbook wechat` — WeChat Official Account playbook |
| `references/skill-authoring.md` | when reviewing or editing this skill — why it stays lean |

The four STORM studies remain in the works dirs (`~/.config/kk/works/`) as provenance; the skill
body and references do **not** vendor the full reports (D4).

## Artifact contract (reuses topic, D5)

All paths are relative to the workspace `--dir`. This skill does **not** invent a parallel
workspace — it delegates to `topic`, which writes exactly these paths:

| Artifact | Path | Written by |
| --- | --- | --- |
| Brief | `brief.md` | `topic` `init` |
| Outline options | `2-outline/outline-option-{a,b,c}.md` | `topic` `outline` |
| Approved outline | `2-outline/outline-approved.md` | `topic` `outline` (after selection gate) |
| Draft | `3-draft-draft-article.md` | `topic` `draft` (from approved outline, review gate) |

## create sequence

1. **Input check** (fail loud, R5): empty topic and no `--brief` → stop with recovery. A `--brief`
   path that does not exist → stop with recovery.
2. **Target check** (fail loud, R5): if `--dir` exists with a `brief.md` and no `--force` → stop
   with recovery ("initialization target already exists at `<dir>`; pass `--force` after explicit
   operator confirmation to replace, or choose a new `--dir`"). Never overwrite without `--force`.
3. **Load the method** — read `references/generic-craft.md` (always) plus the selected playbook if
   `--playbook` is not `generic` (R2). If `--research` and the workspace has no reusable evidence,
   invoke `storm-research` on the topic (XOR: a topic phrase or `--in <file>`); re-run research
   only when the query or sources must change — reuse existing `docs.json` otherwise.
4. **Delegate to `topic`** — run `topic create` against `--dir` with the same artifact contract and
   gates: outline options → explicit selection gate (`--outline <a|b|c>` or interactive) → approved
   outline → draft → review gate (approve or bounded `--revise`). This skill never reimplements
   those gates (R1, R3).
5. **Apply the method while drafting** — using the loaded references, apply the five disciplines
   (one goal per document, value proposition as scope firewall, explicit prerequisites and POLA,
   show-don't-tell with diagrams/examples, accessibility) plus the platform playbook's constraints
   (e.g. WeChat mobile formatting or English-platform framing). The draft is written by `topic`
   from the approved outline; the method shapes it.
6. **Optional judge gate** — if `--judge` and `3-draft-draft-article.md` is approved, invoke
   `content-judge` with the `tech-accuracy` rubric. A non-`PASS` verdict is reported to the operator; it
   does **not** auto-publish and does not auto-revise past `topic`'s 3-round bound.
7. **Print** the final artifact paths and stop.

## Fail-loud table (R5)

| Condition | Behavior | Recovery instruction |
| --- | --- | --- |
| Empty topic and no `--brief` | Stop; no files created | Provide a topic phrase or `--brief <path>` |
| `--brief` path does not exist | Stop; no files created | Check the path; supply a real Markdown brief |
| `--research` with neither topic nor `--in` | Stop; nothing written | Pass exactly one of the topic / `--in <file>` to `storm-research` |
| Missing prerequisite artifact (e.g. outline before draft) | Stop; nothing written | The recovery comes from `topic` — run the prerequisite step first (see `topic` fail-loud table) |
| Existing initialization target without `--force` | Stop; no overwrite | Confirm with the operator and pass `--force`, or choose a new `--dir` |
| Unknown operation | Stop; nothing written | Use `create` (the only operation) or call `topic` / `storm-research` / `content-judge` directly |

Every stop names the exact missing or existing path and the exact next command. Never silently
skip, never auto-replace, never delete.

## Invariants

- `create` is the **only** operation. Research, illustration, adaptation, and publish operations
  are **not** added to `topic` — this skill delegates to `storm-research` / `content-judge` (R3).
- Reuse `topic` artifact paths; never invent a parallel workspace (D5).
- `topic` / `storm-research` / `content-judge` contracts are unchanged (D6) — this skill only orchestrates.
- No `plugins/kk/commands/itc*.md`, no `kk` CLI noun/verb, no generator `plugin.json` (R4).
- Never overwrite an existing artifact without `--force`; bound draft revision at `topic`'s 3
  rounds.
- No live publish, no external side effects beyond the delegated research call, no image generation.

## Prompt template (Skill() / agent.run)

```
Skill(skill="itc-generating",
  args="<topic-or-brief> [--dir <target>] [--brief <path>] [--playbook generic|english|wechat] [--research] [--judge] [--outline <a|b|c>] [--revise <feedback>] [--force]")
```

When invoked, follow the `create` sequence above. Load the references the flags select, delegate
outline selection and draft review to `topic`, and pause for the operator at `topic`'s gates. On
any stop, output the fail-loud recovery line. The artifact paths under the workspace `--dir` are
the handoff.
