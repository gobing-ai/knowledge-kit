---
kind: plan
tags: [brainstorm, seo, geo]
status: accepted
created_at: 2026-10-14
needs_design: true
run_id: smart-seo-20261014-01
---

# Smart SEO approaches

## Overview

Deliver an evidence-grounded SEO/GEO audit from a public homepage URL through the existing KK workflow and Spur decision infrastructure. The [vendor review](2026-10-14-smart-seo-vendor-review.md) covers the upstream snapshot and its adoption risks. This plan records design, not shipped behavior.

## Approaches

| Approach | Benefits | Cost and limitation | Confidence |
| --- | --- | --- | --- |
| Wrap vendor Python CLI and replace Jev calls | Fast superficial report parity | Introduces Python/native rendering setup, vendor runtime dependency, direct-provider coupling and unresolved security/evidence gaps; conflicts with current vendor policy | LOW fit, HIGH confidence in observed conflicts |
| Native KK stages + Spur decisions + one skill (recommended) | Reuses shipped packaging, orchestration and maker selection; deterministic fixtures; no new runtime or dependency | Requires careful bounded crawler and rule adaptation; v1 omits browser, paid-data and rich exports | HIGH fit; MEDIUM effort certainty |
| Agent-only SEO skill over browser/search tools | Very small initial implementation | Difficult repeatable coverage, provenance, bounded cost and comparisons; model can confuse facts with judgments | MEDIUM for ad hoc consultation, LOW for requested workflow |

## Recommendation

Choose native stages. Ship a bounded public-site audit and SEO/GEO action plan as one cohesive feature, with comprehensive vendor rule disposition. Default output is JSON plus Markdown. Optional PSI/CrUX evidence uses official endpoints; operator-provided query evidence can inform keyword recommendations without a new paid integration. Defer PDF/XLSX, browser execution, paid DataForSEO adapters, automated fixes, publication, schedules and Board UI until separately requested.

The first version supports technical/on-page/links/structured-data observation and page/site/pair semantic review, plus imported keyword relevance/mapping. It does not equate editorial quality or bot access with observed AI citations. Business context and desired indexing policy can be supplied; absent context produces review items rather than aggressive removal advice.

## Design Summary

`plugins/kk/workflows/kk-smart-seo.yaml` composes `kk stage run seo-*` actions and one host/agent narrative action. Deterministic stages own collection, rule evaluation, compact decision evidence, scoring and report validation. `plugins/kk/decisions/kk-seo-{site,page,pair,keyword}.yaml` supplies typed contracts consumed through argv-based `spur decision run`; defaults remain explicit unknowns and never acquire model provenance. `plugins/kk/skills/smart-seo/SKILL.md` owns audit operation, evidence review, local report narrative and SEO/GEO consultation, with references for method, sources and limits. A small sibling helper family travels with the existing stage runner. No vendor path is a runtime dependency and no product plugin kind is added.

New bounded network and artifact contracts cross multiple stages, so `needs_design=true`. Design must freeze robots/error handling, connection-level SSRF controls, evidence bounds, fallback semantics, artifact ownership, deterministic scoring and install-time catalog discovery before task creation.

## Self-review and automatic choice

No placeholders, contradictory scope, missing requested artifact or speculative new runtime. Requirement inventory is captured in the run evaluation. The operator's `--auto` accepts the recommended reshape and design when deterministic checks pass. This records the automatic choice; it does not claim implementation or live SEO accuracy.

## Next steps

Record the accepted design, validate feature scenarios, create dependency-ordered tasks and stop at handoff.
