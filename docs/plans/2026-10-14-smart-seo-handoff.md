---
kind: plan
tags: [handoff, seo, geo]
status: ready
created_at: 2026-10-14
feature: G9
run_id: smart-seo-20261014-01
---

# Smart SEO planning handoff

Planning is complete; implementation has not started. [Design](../design/kk-smart-seo.md), [vendor review](2026-10-14-smart-seo-vendor-review.md) and [approach comparison](2026-10-14-smart-seo-brainstorm.md) record the chosen scope. ADR-039 is accepted design. G9 has 12 scenarios covering all eight input inventory items. The review accounts for all 52 vendor rules and records 18 findings, with four isolated reproductions; the upstream suite cannot import because bs4 is absent.

## Ready task set

| WBS | Deliverable | Depends on | Estimate |
| --- | --- | --- | --- |
| 0281 | Bounded public-site facts with robots/network controls | none | 12h |
| 0282 | Offline technical assessments and stable reports | 0281 | 10h |
| 0283 | Typed SEO catalogs and honest semantic outcomes | 0281, 0282 | 8h |
| 0284 | Optional lab/field and imported query evidence | 0281, 0282 | 6h |
| 0285 | Workflow and validated narrative/terminal behavior | 0282, 0283, 0284 | 8h |
| 0286 | One SEO skill and clean installed use | 0285 | 6h |

All six tasks passed deterministic task checks and the seven-part ready checklist; finalization verified their canonical planning digests and premise citations. Feature validation passes with expected unverified-scenario warnings until implementation produces real PASS evidence. The six slices total an estimated 50 hours, not a measured delivery forecast. The operator's `--auto` accepted the recommended reshape, design and batch without interactive pauses; the decomposition quiz was automatically skipped.

## Scope limits

JSON/Markdown first. Browser rendering, paid DataForSEO, PDF/XLSX, continuous rank tracking, Board/scheduler and any site/account mutation require separate intake. Semantic confidence is uncalibrated; served fallback and unknown evidence cannot become clean scores. Native DNS pinning, bounded XML/robots behavior and cancellation require the task-owned adversarial checks before live use.

## Recorded checks

- `bun run lint`: exit 0, including typechecking.
- `bun run test`: exit 0; 2,932 passed, 0 failed, 2 pre-existing Chromium compose tests skipped by the existing `NODE_ENV=test` policy. No tests were changed to obtain this result. This is not a no-skips certificate.
- `bun run build`: exit 0.
- `spur rule run --preset recommended-pre-check --json`: exit 0; 59 rules, no findings.
- Feature/inventory check and all six task checks: PASS for planning; feature implementation scenarios remain unverified as expected.
- Vendor AST reproductions: four confirmed behaviors; full vendor test import is blocked by missing bs4.
- `git diff --check`: clean. An unrelated `.spur/config.yaml` change enabling three Board modules was observed and preserved outside this planning scope.

The inline planning run closed `done` with 28 action rows and no missing nodes. Its usage summary is unavailable because no host transcript/session ID was supplied. No implementation or live SEO/GEO result is certified by these planning checks.

## Next command

```text
/sp:dev-runall --feature G9 --auto
```

Retained execution evidence: `.spur/memory/evidence/smart-seo-20261014-01/`; run record: `.spur/memory/runs/smart-seo-20261014-01.md`. No implementation tasks were executed by the idea pipeline.
