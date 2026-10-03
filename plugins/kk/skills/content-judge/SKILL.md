---
name: content-judge
description: This skill should be used when an LLM evaluation gate is needed in a knowledge-kit pipeline — "judge this content", "evaluate against rubric", "quality gate before publish", "check technical accuracy", "review brand tone", "compliance check", or when a spur workflow step of type `agent.run` targets the content-judge skill to emit a PASS/FAIL/NEEDS_REVISION verdict. Centralizes evaluation rubrics, prompt templates, and structured verdict emission for generated Content.
version: 0.1.0
---

# content-judge — LLM-as-judge evaluation skill

## Purpose

Evaluate generated `Content` against a rubric and emit a structured **verdict** that a spur
workflow gate can consume. This is the fat skill — the single source of truth for evaluation
logic, prompt templates, and verdict formatting. The `agent.run` prompt (or `--judge` flag on
`itc-generating`) selects the rubric; there are no persona subagents.

LLM-as-judge is **not** a knowledge-kit plugin kind (ADR-007 amdt 2026-08-07). It runs as an
`agent.run` step in a spur workflow; the verdict is a skill output, not a plugin-kind contract.

## When to use

- A spur workflow needs a quality gate between `generate` and `publish`.
- A user asks to "judge", "evaluate", "quality-check", or "gate" generated content.
- A workflow or skill names a rubric (`tech-accuracy` / `brand-tone` / `compliance` / `general`).

## Verdict output contract

Every evaluation writes a JSON verdict file. The default path is
`.spur/run/verdict-<step>.json` (the workflow step sets the exact path via the prompt).

```json
{
  "verdict": "PASS | FAIL | NEEDS_REVISION",
  "confidence": "HIGH | MEDIUM | LOW",
  "rubric": "<rubric-id>",
  "score": 0.0,
  "summary": "<one-paragraph reasoning summary>",
  "findings": [
    {
      "criterion": "<criterion id from rubric>",
      "status": "pass | fail | warn",
      "detail": "<evidence-grounded explanation>"
    }
  ],
  "feedback": ["<actionable revision note>", "<actionable revision note>"],
  "content_ref": "<path or id of evaluated Content>",
  "evaluated_at": "<ISO-8601>"
}
```

### Verdict semantics

| Verdict | Meaning | Gate action |
|---------|---------|-------------|
| `PASS` | Content meets all must-pass criteria | Allow transition to publish |
| `FAIL` | Content violates a must-pass criterion (safety, accuracy, compliance) | Block; surface findings; do not publish |
| `NEEDS_REVISION` | Content is salvageable but below bar on quality criteria | Block; feedback drives a bounded regenerate-retry loop |

`PASS` is the only verdict that unblocks publish. The shell guard treats `FAIL` and
`NEEDS_REVISION` identically (exit 1); the distinction is for the feedback loop, not the gate.

### Confidence level

Every verdict carries a `confidence` level — `HIGH`, `MEDIUM`, or `LOW` — self-assessed by the
judge from evidence coverage:

- `HIGH` — every criterion grounded in directly verified evidence (sources opened, claims
  cross-checked); no unverified rule text or assumption entered the reasoning.
- `MEDIUM` — verdict grounded but with known evidence gaps (e.g. unverified platform rule text,
  single-source claims), none strong enough to flip the verdict.
- `LOW` — verdict rests on assumptions or unverified evidence that could plausibly flip it.

The `daily-safety-gate` requires the field on the safety verdict (missing or a value outside the
enum → block). The level itself does not change routing — escalation stays owned by the review's
`RISK` decisions and `escalate` flag; treat `LOW` as a signal to demand human review before
publishing.

## Evaluation procedure

1. **Read the Content** from the path given in the evaluation request (the `content.json` written
   by the preceding `kk executor run <generator>` step).
2. **Select the rubric** — named in the request (`tech-accuracy`, `brand-tone`,
   `compliance`, `general`). Default: `general`.
3. **Evaluate each criterion** in the rubric. For each, produce a `pass` / `fail` / `warn` status
   backed by a specific, quotable evidence reference (quote, section, claim).
4. **Score** — weighted aggregate per the rubric's scoring rules. `score` is 0.0–1.0.
5. **Decide the verdict** using the rubric's thresholds (see `references/rubrics.md`):
   - Any `must-pass` criterion `fail` → `FAIL`.
   - No must-pass failure but score < revision threshold → `NEEDS_REVISION`.
   - Otherwise → `PASS`.
6. **Emit the verdict** as JSON to the output path. Always write the file — even on `FAIL`, the
   findings are the deliverable.
7. **Print the verdict path** to stdout so the workflow's shell guard can locate it.

### Evidence discipline

- Quote the content being evaluated; do not paraphrase when a quote is shorter than a sentence.
- Cite the specific criterion violated. "Inaccurate" is not a finding; "Claim X in §2 is
  contradicted by source Y" is.
- Never fabricate sources. If a claim cannot be verified against the provided docs/brief, mark it
  `warn` (unverified), not `fail`, unless the rubric classifies unverified claims as must-pass.

## Rubrics

Four built-in rubrics. Full definitions, weights, and thresholds live in
`references/rubrics.md`. The skill body intentionally stays lean — load the reference when
evaluating.

| Rubric | Use when | Key must-pass criteria |
|--------|----------|------------------------|
| `general` | Default quality gate | coherence, completeness, source-fidelity, readability |
| `tech-accuracy` | Technical content | factual correctness vs. sources, no fabricated citations, code correctness |
| `brand-tone` | Published voice | tone consistency, banned-phrase compliance, audience fit |
| `compliance` | Sensitive content | no prohibited claims, disclosure presence, jurisdictional rules |

## Prompt template

Use this template when the skill is invoked by an `agent.run` step. The workflow fills the
`{{...}}` placeholders.

```
You are an LLM-as-judge evaluating generated content for the knowledge-kit pipeline.

Content to evaluate: {{content_path}}
Rubric: {{rubric}}              # general | tech-accuracy | brand-tone | compliance
Output verdict to: {{verdict_path}}

Load the rubric definition from plugins/kk/skills/content-judge/references/rubrics.md (section: {{rubric}}).
Evaluate the content against every criterion in that rubric.
For each criterion, quote the specific passage and assign pass | fail | warn.
Decide the verdict: any must-pass fail → FAIL; else score < threshold → NEEDS_REVISION; else PASS.
Write the verdict JSON to {{verdict_path}} using the contract in SKILL.md.
Print the verdict path to stdout as the last line.
```

## Workflow integration

See `references/workflow-integration.md` for the `agent.run` step shape and the shell/`jq` guard
that reads the verdict. The example workflow is at
`plugins/kk/workflows/judge-gated-publish-example.yaml`.

## Rubric selection

The `agent.run` prompt (or the calling skill) sets `{{rubric}}`. To add a persona, add a rubric
section in `references/rubrics.md` and name it from the prompt — do not add a subagent wrapper.

## Additional resources

- **`references/rubrics.md`** — full rubric definitions, criterion weights, and verdict thresholds
- **`references/workflow-integration.md`** — `agent.run` step shape, shell/`jq` guard, retry topology
