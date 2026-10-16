---
name: smart-seo
description: >-
  Run, review and interpret a read-only Smart SEO/GEO audit and turn its evidence into a prioritized
  action plan. Use when the user says "audit this site for SEO", "run a smart SEO audit", "review
  this saved audit", "explain these SEO findings", or "check GEO readiness". Read-only results: no
  site mutation, no ranking and no citation promises.
version: 0.1.0
---

# smart-seo — evidence-grounded SEO/GEO audits

One entry point for the whole audit lifecycle: intake → run → review evidence → interpret →
narrative → offline rescoring. There is no second command, subagent or plugin kind; this skill plus
`plugins/kk/workflows/kk-smart-seo.yaml` and the `kk stage run seo-*` stages are the entire surface.

## 0. The contract — state it before you report

- **Read-only.** The audit fetches public pages and writes artifacts under `.works/`; it never edits
  the site, submits URLs, changes accounts, publishes or schedules anything. Remediation is an
  operator action you may recommend, never perform.
- **No ranking, citation, traffic or revenue promise.** The audit cannot observe indexing, ranking,
  visits, revenue, bot behavior or answer-engine citations. Say "not measured" where that is true.
- **Label the evidence class** in every statement: observed **measurement**, **heuristic**,
  **unknown**, **model judgment / advisory**, or **consultation**. `references/method.md` §1.
- **Crawler purposes stay separate:** search-indexing, model-training and user-triggered fetchers
  have different policies and different consequences. `references/seo-geo-sources.md` §2.
- **`vendors/` is reference-only:** excluded from runtime and install resolution; never read or copy
  it into a shipped file, and never wrap the vendor Python.
- **Specialist advice is consultation.** Legal, hosting, server, analytics or i18n work outside the
  collected evidence is flagged as consultation with the missing evidence named — never presented
  as an audit finding.
- **No phantom metrics.** Every number in your answer comes from an artifact field, and you name it.

## 1. Route the request

| Input | Path |
| --- | --- |
| A public URL / domain | Full workflow run (§3→§4) with a written options file. |
| A saved audit directory (`audit.json` present) | Skip to review/interpret (§5→§6); rescore with §8 when the rubric or inputs changed. |
| A question about an existing report | Read `report.json` + `audit.json` + `checks.json`, answer from the fields (§5). |
| "Make the site rank / get cited" | Explain what the evidence does and does not support (§0, §6) and produce the action plan. |

Never invent a run id, work directory or artifact path. Resolve them from the run-bound file
`.spur/run/<runId>-seo-work-dir.txt`, and read the package root from the running executable
(`references/operations.md` §1) — never from a hard-coded checkout path.

## 2. Intake and the options file

Confirm with the operator: the exact URL, the intended audience locale, any business context worth
recording (≤ 2,000 characters — operator context, not website evidence), whether measured
performance evidence is desired (PSI/CrUX keys present), and whether an imported visibility
snapshot exists. Then write a strict JSON options file — fields, defaults, bounds and the imported
snapshot contract are in `references/operations.md` §3, §5. Pass the file **path** as data; never
template a user value into shell source, and refuse NUL input.

## 3. Register the decision catalogs (integrated runs)

The workflow's preflight passes `require_decisions=true`: the four SEO catalogs (22 decisions) must
be served, or preflight fails with the registration pointer. The supported setup is an **append** of
`<package-root>/plugins/kk/decisions` to the consumer project's `decisions.paths`, preserving every
existing entry and every maker setting. Verify with `spur decision list|show|status --json` — that
is configuration evidence, never model health. Exact steps and failure text:
`references/operations.md` §2. Collection-only stage use and the offline fixture mode need no
catalogs.

## 4. Run it, bounded

```bash
spur workflow run <package-root>/plugins/kk/workflows/kk-smart-seo.yaml \
  --vars '{"options_file":"/abs/path/options.json"}' --quiet
```

`preflight → collect → check → enrich → judge → score → narrative → report`, terminal
`done | partial | failed`. Leave `work_dir` empty so preflight allocates it and records the
run-bound path. Show progress from the workflow trace and the run record, not by guessing a
directory; report `partial` as successful delivery with named missing evidence, and `failed` as the
only failure state. Full command/artifact/progress detail: `references/operations.md` §6–§8.
For a run with no network access (fixture mode), the same workflow executes offline — say so
explicitly and never present fixture-derived numbers as a live site audit.

## 5. Review the evidence before reading any judgment

1. `report.json` — `status`, `narrativeStatus`, `scores`, `coverage`, `actions` (already ordered).
2. Start with `P1`, then `P2` actions. For each: severity, category, affected pages, `effort` band,
   and `heuristic` (true = rule-of-thumb over observed facts, false = directly observed).
3. Confirm each action against `checks.json`: `status`, `reason`, `evidenceRefs`, `sourceUrl`,
   `sourceCheckedAt`. A failing row with a `heuristic: true` flag is a hypothesis to verify, not a
   defect.
4. Read `audit.json` `/limits/*` and `coverage` (`assessed`, `unknown`, `ratio`, `hitLimit`). A
   limit or a large `unknown` count bounds every conclusion; orphan/depth/duplicate observations are
   "among sampled pages".
5. Treat policy-looking rows carefully: robots directives, intentional `noindex`, canonical-to-other
   and missing optional files (`robots_missing`, `sitemap_missing`, `not_in_sitemap`,
   `llms_txt_missing`) are **signals requiring operator intent**, not automatic defects.
6. When a row's `sourceCheckedAt` is old relative to the question, refresh the primary source first
   (`references/seo-geo-sources.md` §3) instead of asserting behavior from memory.

## 6. Interpret for the operator — per area

Explain each area from the recorded evidence and stop where the evidence stops. Rubric, scoring and
the full "cannot conclude" list live in `references/method.md` §3 and §6.

| Area | What the evidence supports | What it must not become |
| --- | --- | --- |
| **Technical** | Observed HTTP status/redirect chains, canonical and hreflang tags, indexability directives, headers, HTTPS/host variants, response size and timings. | Proof of indexing, rendering or crawl-budget impact. `js_dependent` is raw-HTML shell suspicion only — no browser rendering. |
| **On-page** | Title/meta/H1–H3/outline/link/anchor/image facts, structured-data syntax and type inventory, Open Graph presence. | A ranking explanation. Length thresholds are heuristics; structured data is data, and its presence is not an AI or rich-result eligibility requirement. |
| **Content / editorial** | Visible word counts (an editorial measure, language-limited), duplicate/thin-content observations, sampled text. | A quality verdict or an audience judgment. Model judgments (`source: model`) are advisory with a maker and a confidence. |
| **Local** | Declared locale/origin facts, contact and business-entity signals, `kk-seo-local-intent`. | Local-pack or maps presence claims — not measured. |
| **Ecommerce** | Product/category page-type and action classifications, duplicated titles/meta, canonical and redirect observations on product URLs. | Price, feed or merchant-center diagnostics — out of scope; name that as consultation. |
| **International** | hreflang observations, locale declarations, duplicate-content observations across host/path variants. | A statement that a market does or does not receive traffic. Machine-translation quality is consultation. |
| **GEO (generative engines)** | Editorial diagnostics — intent satisfaction, first-hand specificity, verifiable provenance, entity consistency, answer-first structure — plus imported citation/visibility snapshots when supplied. | Any citation, mention or inclusion promise. Blocking a training crawler is a policy choice, not a search defect. |

### Crawler policies, kept separate

Explain a robots observation by the crawler's **purpose**, never as one verdict, and report the
observed directive plus the path it applies to:

- **Search indexing** (`Googlebot`, `Bingbot`, `OAI-SearchBot`) — affects eligibility for search and
  search-grounded answer surfaces. A deliberate restriction is an operator decision, not a defect.
- **Model training** (`GPTBot`, `Google-Extended`, `ClaudeBot`, `CCBot`) — a data-policy choice.
  Blocking it is not a search defect; allowing it promises nothing.
- **User-triggered fetch** (`ChatGPT-User` and similar) — serves a user's explicit request; a block
  limits that session, not search eligibility.

A router robots group (the audit's own user agent) is likewise an operator policy. Never claim what
any crawler actually did: the audit observes the site's declared policy and its own requests only.

### When evidence is missing

Say which of the three it is — **not collected** (outside the bounded crawl), **collected but
unknown** (`status: unknown`), or **not applicable** (`not-applicable`) — and name the input that
would settle it (a larger budget, a supplied visibility snapshot, an operator answer about intent).
Consultation is the right label for work this method cannot evidence at all.

## 7. Write the narrative

Two different artifacts — keep them apart:

- **Validated narrative** (`narrative.json`): the §9 schema — allow-listed headings, fixed
  `fact | action | limit` templates and `evidenceRef` pointers into the materialized `audit.json`,
  bound to its sha256 and run id. Selecting and ordering recorded references is allowed; adding a
  measurement, diagnosis or prediction is not, and any invalid claim rejects the whole narrative
  (which then degrades to the labeled deterministic summary). Schema, worked example and rejection
  cases: `references/narrative.md`.
- **Advisory prose** (your answer): the explanation, prioritization and operator-facing advice.
  Label evidence classes, cite artifact fields, mark consultation, and describe what the report
  deliberately cannot say. The report accepts no free prose — `references/narrative.md` §4.

## 8. Offline rescoring

To re-score a saved audit without touching the network, the source run or its artifacts:

```bash
kk stage run seo-score <saved-work_dir> <new-revision_dir>   # revision dir must be absent/empty
kk stage run seo-report <new-revision_dir>
```

The revision copies the validated inputs beside a fresh `audit.json`, keeps the original `runId`
and adds a `revisionId`, so source artifacts stay immutable and two revisions are comparable as
durable directories. Never compare scores across runs with different coverage or `methodVersion`,
and never patch a saved artifact in place. Details: `references/operations.md` §9.

## 9. Failures and limits — report, never paper over

Unserved catalogs, invalid options, a populated `work_dir`, a refused network target
(local/reserved address), budget exhaustion, unavailable optional PSI/CrUX evidence, maker
fallback/low confidence, malformed predecessors, a rejected narrative and cancellation each have a
defined handling in `references/operations.md` §8. Three habits matter most: never present an
exhausted crawl as complete, never turn an unknown or a low-confidence judgment into a defect, and
never convert "not measured" into "passed".

## 10. References

| Reference | Owns |
| --- | --- |
| `references/operations.md` | Package-root resolution, catalog registration and failure text, options fields, imported snapshot, run/progress commands, per-artifact map, failure handling, offline rescoring. |
| `references/method.md` | Evidence classes, the 52-rule checklist structure, score/coverage formulas, action ordering and priorities, how to read a check back to its evidence, and the method's explicit limits. |
| `references/seo-geo-sources.md` | Primary source registry with checked-at dates and per-source limits, crawler-purpose separation, the source refresh procedure, GEO limits, and the `vendors/` reference-only rule. |
| `references/narrative.md` | The validated narrative schema, worked example, rejection matrix, and the boundary with advisory prose. |

Attribution for the adapted rubric, rule identities and upstream notice:
`plugins/kk/references/smart-seo-attribution.md`.
