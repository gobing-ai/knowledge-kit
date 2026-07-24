---
template: feature-impl
schema_version: 1
name: "Study vendors/storm source and select the Phase-1 stand-in generator skill"
description: ""
status: done
type: task
profile: standard
feature_id: D1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-23T17:57:43.988Z"
updated_at: "2026-07-23T22:31:51.160Z"
---

## 0001. Study vendors/storm source and select the Phase-1 stand-in generator skill

### Background
Feature **D** (ContentGeneratorPlugin) is reuse-first for Phase 1: wire an existing agent skill as the generator rather than building STORM now (own STORM is deferred to feature **H**). This gate grounds the `ContentGeneratorPlugin` contract (**B2**) in how STORM actually works and picks the best existing stand-in skill for **D2**.

LOW-confidence assumption to verify: STORM = research → outline → article loop (`vendors/storm` not yet read).
### Requirements
R1. Read `vendors/storm` source and map its real pipeline stages, inputs, and outputs (confirm or correct the research→outline→article assumption).
R2. Derive the `ContentGeneratorPlugin` contract shape STORM implies (`generate(Doc[]) → Content`): required inputs, emitted artifacts, config knobs. Feeds B2.
R3. Evaluate candidate stand-in skills against that shape — at minimum `wt:info-research`, `wt:technical-content-creation` / `wt:topic-*`, and `vendors/baoyu-skills`.
R4. Recommend exactly one stand-in for D2, with rationale and the gaps it cannot cover (which become scope for the real STORM in feature H).
### Acceptance Criteria
```gherkin
Feature: STORM study and Phase-1 generator selection

  Scenario: Findings recorded and stand-in chosen
    Given the vendors/storm source has been read
    When its pipeline is mapped to the ContentGeneratorPlugin contract
    Then a findings summary and a single recommended stand-in skill (with rationale and gaps) are recorded in this task
    And feature D2 can proceed against the recommendation
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
## STORM pipeline (source-verified, `vendors/storm`, 2026-07-23)

`STORMWikiRunner(Engine)` runs **4 modules in order** (abstract `run_*` in `interface.py`; impls in `storm_wiki/engine.py`):

1. **Knowledge Curation** → `StormInformationTable`. Persona/perspective generation (`StormPersonaGenerator`) → multi-perspective conversational question-asking (`max_perspective`, `max_conv_turn`), each turn issuing search queries through a **pluggable retrieval module** (`Retriever` wrapping a dspy `rm`); collects `Information`. Dumps `conversation_log.json`.
2. **Outline Generation** → `StormArticle`. `generate_outline(topic, information_table)`: a direct draft outline, refined against the curated conversations. Dumps `storm_gen_outline.txt`.
3. **Article Generation** → `StormArticle`. `generate_article(topic, information_table, article_with_outline)`: fills the outline section-by-section grounded in the table. Dumps `storm_gen_article.txt` + `url_to_info.json` (per-section refs).
4. **Article Polishing** → `StormArticle`. `polish_article(..., remove_duplicate)`: adds a lead/summary, optional de-dupe.

**Inputs:** `STORMWikiRunnerArguments`, `STORMWikiLMConfigs` (5 role LMs via **litellm**), a dspy **`rm`**. **Outputs:** article markdown + `url_to_info.json` refs.

**External deps (port cost, feature H):** Python + **DSPy** + **litellm** + a retrieval backend (`YouRM/BingSearch/SerperRM/Tavily/...`). None TS-native — a faithful STORM port is a real build, not a wrapper.

## Contract implications (feature B2)

`ContentGeneratorPlugin.generate(input) → Content`: input ≈ `{ topic, docs: Doc[] (corpus), config }`; output ≈ `{ markdown, references, outline? }`. STORM's `Retriever(rm)` is the integration seam: a **`KarakeepLocalRM`** (dspy retrieval over the rclone-synced folder) makes STORM research *our* corpus, not the open web — scope for feature **H**.
### Plan
<!-- Ordered research checklist. -->

- [ ] Read `vendors/storm` — entry points, pipeline modules, prompts
- [ ] Diagram the actual stages (research/curation → outline → synthesis); confirm or correct
- [ ] Derive `ContentGeneratorPlugin` contract implications for B2
- [ ] Evaluate candidate stand-in skills against the contract
- [ ] Record findings + single recommendation; note gaps for feature H
### Solution
## Decision — Phase-1 stand-in generator (R4)

**Recommend `wt:technical-content-creation` (stages 0–3), fronted by `wt:info-research` / `wt:super-researcher`.** Wire it as the `ContentGeneratorPlugin` in feature **D2**.

| STORM stage | wt stand-in (installed) |
|---|---|
| (retrieval corpus) | Stage 0 Materials — `materials-extracted.md` ← **Karakeep-local Docs feed here** |
| Knowledge Curation | Stage 1 Research — `info-research --file … → research-brief.md` (via `wt:super-researcher`) |
| Outline Generation | Stage 2 Outline — `topic-outline` (2–3 options) |
| Article Generation + Polish | Stage 3 Draft — `topic-draft` (full styled article) |
| — out of generator scope | Stages 4–6 Illustration / Adapt / Publish → adapt+publish = PublishPlugin (Surfdash) |

**Why:** produces tech articles (the Phase-1 output) from **source materials as input** (`--file`), matching Karakeep-local → generator; installed + runnable now; stage-for-stage mirror of STORM so real STORM drops in at the same generator boundary (feature H).

**Gaps vs real STORM → feature H scope:** no persona-driven multi-perspective question-asking; no iterative retrieval loop over a pluggable `rm` (→ the `KarakeepLocalRM` seam); no structured per-section citation grounding (`url_to_info`).

**Confidence:** HIGH on STORM (source-read) and the wt stage mapping (SKILL.md read). Final wiring confirmed when D2 runs.
### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review
| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 (blocker) | None — research ticket; no production code changed | N/A |
| P2 (major) | None | N/A |
| P3 (minor) | Real STORM is Python + DSPy + litellm + a retrieval backend; a faithful TS port is non-trivial | Deferred to feature **H**; captured in Design/Solution |
| P4 (nit) | Final stand-in wiring (`wt:technical-content-creation`) unverified until D2 implements it | Tracked as **D2**; recommendation is reversible at the generator boundary |

**Residual risk:** Low — the Phase-1 stand-in is reuse-only and swappable; real-STORM gaps are feature H scope.
**Disposition:** Research question (D1) answered with HIGH confidence (source-read). Approved to close; **D2 unblocked**.
### References
- `vendors/storm` — source under study
- Features: D1 (this gate) · D (generator) · B2 (contracts) · H (real STORM)
- Candidate stand-ins: `wt:info-research`, `wt:technical-content-creation`, `wt:topic-*`, `vendors/baoyu-skills`
### History
- 2026-07-23T22:26:28.455Z todo → wip (system)
- 2026-07-23T22:31:51.160Z wip → done (system)
