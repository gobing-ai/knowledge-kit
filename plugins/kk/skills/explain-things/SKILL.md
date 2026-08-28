---
name: explain-things
description: >-
  Explain a topic, mechanism, or change with the smallest useful view — pseudocode,
  call tree, component tree, file tree, Mermaid, diff, copyable block, or a focused
  HTML artifact as a last resort. Use when the user says "explain", "tell me",
  "how does X work", "ELI5", "like I'm 5", or "show me". Normal explanations are
  concise inline views; the ELI5 register is opt-in. This is not for content authoring,
  research, judging, publishing, or package/code review workflows.
---

# explain-things

Explain the topic with the smallest useful view and only the prose needed to read it.
Skip the preamble.

## 1. Resolve the topic

`$ARGUMENTS` carries an optional standalone `--eli5` modifier; strip it if present, and the
remaining text is the explicit topic.

- Explicit topic present → use it.
- No explicit topic → use the current conversation topic.
- Neither → stop before creating any artifact and say exactly:

  > Provide a topic, for example `/tell-me <topic>`, or ask again while a topic is active.

## 2. Choose the register

- **Normal** (default): concise supporting prose beside one smallest useful inline view.
- **ELI5**: picture-first, few words — use only when `--eli5` was passed or the user explicitly
  asks for ELI5 / "like I'm 5". Lead with a familiar analogy; define unavoidable jargon.
  ELI5 changes vocabulary and presentation, not the view catalog, and never forces HTML.

## 3. Pick the smallest view

Read `references/views.md` for the full decision catalog plus syntax examples. The default
mapping:

| Question shape | Smallest default view |
| --- | --- |
| Decision logic or algorithm | Pseudocode |
| In-process call order | Call tree |
| Multiple actors, timing, or data flow | Mermaid sequence/flow diagram |
| UI composition, state, or ownership | Component tree |
| File/module responsibility | Shallow file tree |
| Change to an existing known shape | Focused `diff` block |
| Mostly new, copyable target | Complete code/config block |
| Dense spatial layout/comparison inline forms cannot express | One focused HTML artifact |

Honor an explicitly requested format when feasible. Add a second view only when it answers a
distinct missing question.

## 4. Render

Place the view directly beside only the prose it needs. If inline text, trees, code, diffs, and
Mermaid cannot make the point, write one focused HTML file (match the product's look, real labels,
desktop + mobile), then open it and report its path.
