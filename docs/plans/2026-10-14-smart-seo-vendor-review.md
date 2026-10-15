---
kind: plan
tags: [review, seo, geo]
status: complete
created_at: 2026-10-14
run_id: smart-seo-20261014-01
---

# jev-seo review for Smart SEO

Reviewed snapshot: `vendors/jev-seo`, upstream commit `55a184a3b0d09565a4c84268f725a47784e62528`, version 0.1.1. Vendor working tree was clean. This is an advisory SECUA/architecture review of the entire vendor source, not a certification of its live services. No vendor files were changed.

## Coverage and execution evidence

The vendor Git inventory contains 77 files. Reviewed all Python modules (crawler, parser, rule engine, typed judgments, DataForSEO, PSI, scorer, CLI, environment lookup, report view model, charts, PDF, XLSX, Markdown, entrypoints), the complete test module, HTML/CSS templates, skill, four methodology references, README, contributor/security/changelog documents, manifests, launcher, license, env-template variable names, and CI configuration. Report examples were inspected as illustrative outputs, not trusted as test data. Font/image/PDF/XLSX binaries were inventoried; no pixel-perfect or spreadsheet-recalculation claim is made. Git metadata is excluded.

`python3 -m unittest discover -s vendors/jev-seo/tests -v` exited 1 before tests ran: `ModuleNotFoundError: No module named 'bs4'`. No dependencies were installed and no paid/live audit was dispatched. Four dependency-free AST reproductions passed: all 52 absent findings are called passes; choice confidence 12 is accepted; contradictory score/probability data is decisive; slash-distinct resources collapse. Reproduction script is retained with the run evidence. These checks isolate original function bodies and do not exercise the crawler or report stack.

## Findings

| ID | Severity | Evidence | Consequence and design response |
| --- | --- | --- | --- |
| V01 | P1 | `vendors/jev-seo/jevseo/crawl.py:186` (`Renderer.render`, `page.goto`) | Chromium bypasses Fetcher's private-network guard. Redirects, subresources and page JavaScript can access destinations the HTTP guard rejects. Do not port rendering in v1; report raw-HTML limitations. Any later renderer needs network-level enforcement across all browser requests. Static finding; no exploit executed. |
| V02 | P1 | `vendors/jev-seo/jevseo/crawl.py:73` | Host safety is cached; requests resolves DNS again when connecting. DNS rebinding is not prevented by validation of a prior answer. Use public-address validation plus connection-pinned DNS, redirect validation, no ambient proxy/cookies/auth, and actual-peer checks. This is a static exposure analysis, not a demonstrated exploit. |
| V03 | P1 | `vendors/jev-seo/jevseo/crawl.py:88`, `:153`, `:158` | HTML/XML response bodies and gzip expansion have no byte cap; sitemap index queue can grow before limits apply. Add streamed wire/decoded limits, queue limits and a whole-stage deadline. Reject unsupported compressed sitemap inputs in v1. |
| V04 | P2 | `vendors/jev-seo/jevseo/crawl.py:283`, `:296`, `:327`, `:394` | Homepage is fetched before robots; Crawl-delay is shortened to 5s; timer starts after several probes and excludes link checks. A declared ten-minute budget is not an end-to-end bound. Fetch robots first, respect full delay or stop when deadline cannot accommodate it, share one deadline/request quota across every probe. |
| V05 | P2 | `vendors/jev-seo/jevseo/crawl.py:112` | robots HTTP failure and genuinely absent file become the same empty policy. Bot access is tested only at `/`, then reported broadly. Distinguish absent/blocked/unavailable; evaluate path-specific policies and keep crawler purpose separate from access. |
| V06 | P2 | `vendors/jev-seo/jevseo/parse.py:17` | `/a/` and `/a` merge before observing server behavior. Distinct resources/redirects can disappear. Preserve pathname, query and trailing slash; remove fragments only; record redirect/canonical relationships as facts. Reproduced. |
| V07 | P2 | `vendors/jev-seo/jevseo/checks.py:394`, `vendors/jev-seo/jevseo/score.py:248` | A rule without a finding is called passed, even with no eligible evidence. A category starts at 100. Partial crawl and failed probes can look clean. Persist applicability and `pass/fail/unknown/not-applicable`; empty assessment has null scores. Reproduced. |
| V08 | P2 | `vendors/jev-seo/jevseo/checks.py:150`, `:204` | `indexable` treats canonical-to-other as non-indexable and only substring-tests generic robots/noindex. Network errors can become broken-link findings. Report observed eligibility signals, not verified index status; parse robots directives, keep network-unknown separate from HTTP failure. |
| V09 | P2 | `vendors/jev-seo/jevseo/jev.py:402` | Confidence/probability shape, range, totals and score consistency are not fully validated. Low-certainty values also enter aggregate scoring. Trust the served Spur contract only after runtime validation; preserve source/reason/confidence and exclude fallback/review answers from semantic scores. Invalid confidence and contradictory payloads reproduced. |
| V10 | P2 | `vendors/jev-seo/jevseo/jev.py:340`, `:357`, `vendors/jev-seo/jevseo/dfs.py:57` | Pre-dispatch cost uses stale fixed prices/token estimates; retries and responses exceeding estimates can defeat the claimed hard monetary cap. Do not copy price constants or claim exact cost caps without provider guarantees. V1 uses bounded decision call counts and operator-selected makers; paid DataForSEO is deferred. |
| V11 | P2 | `vendors/jev-seo/jevseo/report/__init__.py:64`, `:336` | Numeric membership anywhere in the audit is not claim provenance; small integers are exempt and unknown numbers merely warn after exports. Use structured claim references to specific JSON facts, validate before materializing a final report, and fall back to deterministic prose. |
| V12 | P2 | `vendors/jev-seo/jevseo/report/xlsx.py:41`, `:210` | Crawled titles/keywords are written as untrusted cell values; leading `=` can become an Excel formula. Deferred exports must force untrusted text cells and validate hyperlinks. No workbook payload was executed. |
| V13 | P2 | `vendors/jev-seo/jevseo/cli.py:112`, `:222`, `vendors/jev-seo/jevseo/score.py:361` | Mutable audit JSON is written directly; rescore renumbers ordinal action IDs, invalidating narratives/tracker references. Use atomic validated stage artifacts and stable rule+subject identity; recompute offline into new output revisions. |
| V14 | P2 | `vendors/jev-seo/jevseo/cli.py:76` | Reused DFS validates only domain, not market/language/data version/age. V1 imported evidence must carry origin, locale, collection time and hash; incompatible evidence is rejected. |
| V15 | P2 | `vendors/jev-seo/jevseo/checks.py:113`, `vendors/jev-seo/jevseo/psi.py:48` | FAQ rich-result guidance is outdated and field data relies entirely on PSI's announced removal path. Refresh supported-feature rules from current sources; PSI is lab-only authority and CrUX owns field data. |
| V16 | P3 | `vendors/jev-seo/jevseo/report/md.py:172`, `vendors/jev-seo/jevseo/templates/report.html.j2:249` | Report method says Score uses top confidence, while code uses side probability. Method docs and XLSX limits also lag full mode. One versioned method artifact should drive all output descriptions. |
| V17 | P3 | `vendors/jev-seo/jevseo/report/__init__.py:308`, `vendors/jev-seo/jevseo/report/charts.py:307` | Page-table indexability omits canonical logic used elsewhere; chart absent categories become zero. Keep one evidence model and null propagation across outputs. |
| V18 | P3 | `vendors/jev-seo/jevseo/env.py:18`, `vendors/jev-seo/bin/jevseo:3`, `vendors/jev-seo/pyproject.toml:11` | Author-specific key lookup, GNU `readlink -f`, unpinned Python stack and native PDF libraries complicate clean installs. Keep vendor reference-only; use existing KK stage/packaging contracts and environment-owned credentials. |

## Architecture assessment and reuse

The strongest reusable design is the division of labor: observed evidence → deterministic findings → narrow semantic judgments → ranked actions → one shared report model. `page_questions` avoids asking about absent title/meta/H1, homepage type is deterministic, overlap candidates are bounded, missing semantic data is explicit, and rule objects carry source and heuristic flags. Preserve these principles rather than the provider client or Python dependency graph.

`crawl.py` combines transport policy, robots, XML, browser lifecycle, discovery, probes and link checking. Porting it wholesale would retain shared-state and timing problems. `score.py` is reasonably isolated but conflates observations with judgments and reports a blended number with no empirical ranking interpretation. Keep a transparent prioritization rubric and separate coverage; no predictive score. `report/__init__.py` centrally projects all formats, but mutates action rows and depends on charts even for Markdown. Build JSON/Markdown directly in v1. The single 471-line test file exercises happy-path parsing, scores, rendering, several regressions and small budget cases; it lacks adversarial DNS/browser tests, malformed probabilities, all-empty evidence, redirect/robots/deadline boundaries, filesystem atomicity and installed KK execution.

Vendor MIT license permits adaptation with retained attribution; fonts have separate SIL OFL licenses. V1 copies no fonts or report binaries. Any translated source/rubric text retains the upstream notice in `plugins/kk/references/smart-seo-attribution.md`.

## Current SEO/GEO sources (verified 2026-10-14)

| Source | Design consequence | Confidence |
| --- | --- | --- |
| [Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) | Focus on original, useful content and technical access. Special AI files, rigid chunking and schema are not Google AI eligibility requirements. No citation/ranking promise. | HIGH, official |
| [Google AI features](https://developers.google.com/search/docs/appearance/ai-features) | Snippet eligibility and indexing matter; crawl observations alone cannot verify inclusion. This page still describes combined Web reporting; newer guide describes a generative-AI report. Do not freeze an account/report availability claim. | HIGH on eligibility; reporting detail requires account verification |
| [Google common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | Google-Extended controls separate uses and does not control Google Search inclusion. | HIGH, official |
| [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots) | OAI-SearchBot is for search, GPTBot for training; ChatGPT-User is user-triggered and has different robots semantics. Blocking training is not a search defect. | HIGH, official |
| [Google Search updates](https://developers.google.com/search/updates) | FAQ rich results stopped appearing May 7, 2026. Remove the vendor government/health eligibility advice. | HIGH, official |
| [PSI API notice](https://developers.google.com/speed/docs/insights/v5/get-started) | Google plans to remove CrUX from PSI; use a separate field-data contract. This is an announced change, not evidence that removal has completed. | HIGH, official |
| [Web Vitals](https://web.dev/articles/vitals) | LCP, INP and CLS require field p75 evidence for a CWV pass. Lab TBT cannot substitute for INP. | HIGH, official |

GEO additions are editorial diagnostics with explicit uncertainty: intent satisfaction, firsthand specificity, verifiable provenance, entity consistency and self-contained facts. They do not measure answer-engine citations. Locale-specific query/citation samples and Search Console/analytics exports, when supplied, retain source, time, platform and denominator. No synthetic visibility percentage is generated from a quality score.

## Decision

Recommend a native Bun/TypeScript audit workflow with small YAML decision catalogs and one fat `smart-seo` skill. Preserve reference-only vendors (ADR-036), `kk` step ownership and `spur` orchestration (ADR-007/011/037). Scope supports technical audit, semantic/editorial recommendations and an evidence-grounded SEO/GEO action plan. Site mutation, search submissions, paid provider adapters, browser rendering, continuous rank tracking and PDF/XLSX parity are deferred. See the companion brainstorm and `docs/design/kk-smart-seo.md` for the frozen implementation contract.

## Exhaustive deterministic rule disposition

Each of the 52 IDs below is accounted for. Native means behavior is retained with explicit assessment/evidence states; adapted changes semantics; informational never deducts a score; deferred emits unknown/not-assessed rather than a silent pass. All heuristics remain labeled.

| Vendor rule | Disposition | Native handling |
| --- | --- | --- |
| `robots_missing` | informational | Missing robots.txt is not an indexing defect. |
| `robots_blocks_site` | adapted | Per-path bot policy; deliberate restriction needs operator context. |
| `sitemap_missing` | informational | Sitemap is useful discovery, not universal indexing eligibility. |
| `sitemap_errors` | adapted | Only supported XML subset; transport/parser failure is unknown. |
| `sitemap_bad_urls` | adapted | Assess observed URLs only; canonical hints differ from noindex. |
| `not_in_sitemap` | informational | Observed coverage signal, not required membership. |
| `http_errors` | adapted | Confirmed HTTP failure differs from network unknown. |
| `broken_internal_links` | adapted | Bounded GET facts; no unknown-as-broken. |
| `redirect_chains` | native | Retain observed check with explicit applicability and evidence. |
| `links_to_redirects` | native | Retain observed check with explicit applicability and evidence. |
| `noindex` | adapted | Intent-sensitive robots directive observation, not automatic defect. |
| `canonical_missing` | informational | Self-canonical is a convention, not universal requirement. |
| `canonical_elsewhere` | adapted | Canonical hint; no proof of non-indexing. |
| `canonical_broken` | adapted | Only observed scoped targets; otherwise unknown. |
| `soft_404` | adapted | 200 junk URL is suspicion; compare content evidence before confirming. |
| `host_temporary_redirect` | native | Retain observed check with explicit applicability and evidence. |
| `host_variant` | adapted | Observed host relationship; avoid blanket duplicate diagnosis. |
| `no_https` | adapted | Unknown HTTP probe is not confirmed insecure service. |
| `deep_pages` | native | Retain bounded observed check; label editorial heuristic. |
| `orphan_pages` | adapted | No inlinks among sampled pages; not global orphan proof. |
| `js_dependent` | informational | Raw HTML shell suspicion; browser rendering deferred. |
| `title_missing` | native | Retain observed check with explicit applicability and evidence. |
| `title_duplicate` | native | Retain observed check with explicit applicability and evidence. |
| `title_length` | native | Retain bounded observed check; label editorial heuristic. |
| `multiple_titles` | native | Retain observed check with explicit applicability and evidence. |
| `meta_missing` | native | Retain observed check with explicit applicability and evidence. |
| `meta_duplicate` | native | Retain observed check with explicit applicability and evidence. |
| `h1_missing` | native | Retain bounded observed check; label editorial heuristic. |
| `h1_multiple` | native | Retain bounded observed check; label editorial heuristic. |
| `heading_skips` | native | Retain bounded observed check; label editorial heuristic. |
| `lang_missing` | native | Retain observed check with explicit applicability and evidence. |
| `viewport_missing` | native | Retain observed check with explicit applicability and evidence. |
| `thin_content` | native | Retain bounded observed check; label editorial heuristic. |
| `duplicate_content` | native | Retain observed check with explicit applicability and evidence. |
| `images_alt` | native | Retain observed check with explicit applicability and evidence. |
| `images_dimensions` | native | Retain observed check with explicit applicability and evidence. |
| `no_structured_data` | informational | Presence is not general AI eligibility. |
| `jsonld_errors` | native | Retain observed check with explicit applicability and evidence. |
| `schema_required` | deferred | Rich-result property validation needs maintained per-type specifications; unknown in v1. |
| `faq_rich_result_limited` | adapted | Replace retired government/health exception with dated retirement information. |
| `og_missing` | native | Retain observed check with explicit applicability and evidence. |
| `hreflang_issues` | adapted | Self/observed reciprocal references; unknown uncrawled targets. |
| `ai_bots_blocked` | informational | Per-path search/training/user-triggered purpose matrix; no blanket failure. |
| `llms_txt_missing` | informational | Optional proposal; no Google Search score effect. |
| `hsts_missing` | informational | Security hardening observation, not SEO eligibility. |
| `security_headers` | informational | Security hardening observation, not ranking factor. |
| `mixed_content` | native | Retain observed check with explicit applicability and evidence. |
| `favicon_missing` | informational | Search appearance suggestion. |
| `slow_ttfb` | adapted | One crawl observation, not field p75. |
| `heavy_html` | native | Retain bounded observed check; label editorial heuristic. |
| `generic_anchors` | native | Retain observed check with explicit applicability and evidence. |
| `broken_external_links` | deferred | No external fetches in v1; not-assessed. |
