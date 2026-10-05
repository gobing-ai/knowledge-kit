# Rubrics — judge evaluation criteria

Loaded by the judge skill at evaluation time. Each rubric defines criteria, weights,
must-pass flags, and the score thresholds that map to verdicts.

## Scoring model

- Each criterion has a `weight` (0.0–1.0). The rubric's weights sum to 1.0.
- A criterion's contribution = `weight` if `pass`, `weight × 0.5` if `warn`, `0` if `fail`.
- `score` = sum of contributions. Range 0.0–1.0.
- **Verdict decision** (applied after must-pass check):
  - Any must-pass criterion `fail` → `FAIL` (overrides score).
  - `score >= pass_threshold` and no must-pass fail → `PASS`.
  - `score < pass_threshold` (and no must-pass fail) → `NEEDS_REVISION`.

## general

Default quality gate. Use when no domain rubric is specified.

| Criterion | Weight | Must-pass |
|-----------|--------|-----------|
| `coherence` — logical flow, no contradictions between sections | 0.25 | yes |
| `completeness` — addresses every point in the Brief's scope | 0.25 | yes |
| `source-fidelity` — claims traceable to provided Docs/Brief; no fabrication | 0.30 | yes |
| `readability` — clear prose, structure aids comprehension | 0.20 | no |

Thresholds: `pass_threshold = 0.75`

## tech-accuracy

For technical content where factual correctness and code validity are load-bearing.

| Criterion | Weight | Must-pass |
|-----------|--------|-----------|
| `factual-correctness` — every technical claim verifiable against sources | 0.35 | yes |
| `no-fabricated-citations` — references exist and resolve | 0.25 | yes |
| `code-correctness` — code samples compile/run and match described behavior | 0.20 | yes |
| `terminology-consistency` — terms used consistently and correctly | 0.10 | no |
| `completeness` — covers the topic depth implied by the Brief | 0.10 | no |

Thresholds: `pass_threshold = 0.80`

### Evaluation notes (tech-accuracy)

- `factual-correctness`: if a claim cannot be verified against the provided Docs/Brief, mark it
  `warn` (unverified) unless the Brief is the only source — then the Brief is the authority and
  divergence is a `fail`.
- `code-correctness`: do not execute code. Static-reason about compilation, types, and
  described behavior. A sample that contradicts its own explanation is a `fail`.
- `no-fabricated-citations`: every cited source must appear in the input Docs. An invented DOI,
  URL, or author is an immediate `fail`.

## brand-tone

For content where published voice must match a brand standard.

| Criterion | Weight | Must-pass |
|-----------|--------|-----------|
| `tone-consistency` — voice matches the brand tone profile across sections | 0.30 | yes |
| `banned-phrase-compliance` — no occurrence of brand's banned phrases | 0.25 | yes |
| `audience-fit` — complexity and register match the target audience | 0.25 | no |
| `formatting-adherence` — headings, lists, and emphasis per style guide | 0.20 | no |

Thresholds: `pass_threshold = 0.70`

### Evaluation notes (brand-tone)

- The banned-phrase list and tone profile are supplied by the wrapper/prompt (the wrapper
  carries the brand config). If none is supplied, mark `banned-phrase-compliance` as `warn`
  with detail "no brand config provided" and score it at half weight rather than failing.
- `tone-consistency` is judged relative to the provided profile; inconsistency across sections
  (e.g., formal intro → casual body) is the most common `fail` mode.

## compliance

For content subject to legal/regulatory/safety rules.

| Criterion | Weight | Must-pass |
|-----------|--------|-----------|
| `no-prohibited-claims` — no claims disallowed by jurisdiction/policy | 0.40 | yes |
| `disclosure-presence` — required disclosures (financial, health, affiliation) present | 0.25 | yes |
| `jurisdictional-rules` — content conforms to the specified region's rules | 0.20 | yes |
| `data-handling` — no PII / sensitive data leaked from inputs | 0.15 | no |

Thresholds: `pass_threshold = 0.85`

### Evaluation notes (compliance)

- `no-prohibited-claims` is strict: a single prohibited claim is an immediate `FAIL`, regardless
  of overall score. Examples: unverified health/financial advice, guarantees of outcome,
- `jurisdictional-rules`: the wrapper supplies the jurisdiction (e.g., `US-SEC`, `EU-GDPR`,
  `CN-CAC`, or the platform reference files a distribution gate names). If none is supplied, mark
  `warn` and note "no jurisdiction specified" — do not guess a jurisdiction and fail against a
  guessed rule.
  Grade `fail` only against rule text verified for that jurisdiction. A rule the wrapper or its
  process marks `evidenceGap` (unverified text, a stale `Last verified` date, or an editorial
  stance rather than platform/governing text) is `warn` + escalate: unverifiable rule text cannot
  be a must-pass failure, because no revision can clear it (20261005 — the daily gate blocked
  every run on the evidence-gapped CN 资质口径 stance until this was fixed).
- `data-handling`: scan for PII that may have been carried through from input Docs (emails,
  phone numbers, national IDs). Leakage is a `fail`.

## Adding a custom rubric

1. Add a section to this file with a unique heading and a criteria table matching the schema
   above (criterion, weight, must-pass).
2. Set `pass_threshold`.
3. Reference the new rubric id from a thin wrapper's `rubric` field or an `agent.run` prompt.

Weights must sum to 1.0; validation is the skill's responsibility at load time — if they do not
sum to 1.0, normalize them and emit a `warn` finding noting the normalization.
