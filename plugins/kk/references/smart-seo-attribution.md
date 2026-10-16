# Smart SEO Attribution & Upstream Review Notice

## Upstream Project and License

Knowledge Kit Smart SEO (`kk-smart-seo`) adapts and grounds the methodology and rules from the upstream `jev-seo` project.

- **Upstream Project:** `jev-seo` (version 0.1.1)
- **Upstream Commit Snapshot:** `55a184a3b0d09565a4c84268f725a47784e62528`
- **Upstream Author:** Agrici Daniel
- **License:** MIT License

```text
MIT License

Copyright (c) 2026 Agrici Daniel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Architectural & SECUA Audit Linkage

The upstream vendor snapshot was fully reviewed in `docs/plans/2026-10-14-smart-seo-vendor-review.md`.

Key architectural and security adaptations include:
1. **Network Trust Boundary (V01, V02):** Replaced unpinned ambient requests with connection-pinned public HTTP(S) transport, DNS resolution validation against private/reserved/multicast ranges, peer address verification, and scoped redirect validation. No browser or Chromium runtime path is imported.
2. **Resource Boundaries (V03, V04):** Streamed response limit of 2 MiB per response, 40 MiB crawl total, shared request quotas (default 200, max 500) and shared deadline (default 600s, max 1800s).
3. **Robots & Sitemap Integrity (V04, V05, V06):** Robots.txt fetched first and respects full `Crawl-delay` or marks budget exhaustion; distinguishes absent (404/410), blocked (401/403), and unavailable (429/5xx). Strictly bounded non-expanding XML subset reader rejecting DOCTYPE/entities/compression.
4. **Distinct URL & Identity Preservation (V06):** Preserves pathname, query parameters, and trailing slashes (`/a` and `/a/` remain distinct resources); fragments stripped.
5. **Clean Runtime Seam:** Knowledge Kit Smart SEO is implemented as native TypeScript stages on Bun 1.4.3 (`plugins/kk/scripts/seo-*.ts`), importing no vendor Python files or bundled font assets.

## Rule Dispositions (52 Rules)

All 52 deterministic rules from the vendor snapshot have explicit dispositions:
- **Native (24 rules):** `redirect_chains`, `links_to_redirects`, `host_temporary_redirect`, `deep_pages`, `title_missing`, `title_duplicate`, `title_length`, `multiple_titles`, `meta_missing`, `meta_duplicate`, `h1_missing`, `h1_multiple`, `heading_skips`, `lang_missing`, `viewport_missing`, `thin_content`, `duplicate_content`, `images_alt`, `images_dimensions`, `jsonld_errors`, `og_missing`, `mixed_content`, `heavy_html`, `generic_anchors`.
- **Adapted (15 rules):** `robots_blocks_site`, `sitemap_errors`, `sitemap_bad_urls`, `http_errors`, `broken_internal_links`, `noindex`, `canonical_elsewhere`, `canonical_broken`, `soft_404`, `host_variant`, `no_https`, `orphan_pages`, `faq_rich_result_limited`, `hreflang_issues`, `slow_ttfb`.
- **Informational (11 rules):** `robots_missing`, `sitemap_missing`, `not_in_sitemap`, `canonical_missing`, `js_dependent`, `no_structured_data`, `ai_bots_blocked`, `llms_txt_missing`, `hsts_missing`, `security_headers`, `favicon_missing`.
- **Deferred (2 rules):** `schema_required`, `broken_external_links`.

## Adapted Rubric & Source Attribution (task 0286)

The `smart-seo` skill and its references restate **KK-authored** adaptations of the upstream
methodology. They are not copies of vendor prose, and the following must stay explicit whenever the
rubric is described or reused:

1. **Decision catalogs** (`plugins/kk/decisions/kk-seo-{site,page,pair,keyword}.yaml`, 22 decisions)
adapt the vendor's decision *descriptions and vocabularies* (business model, page type, search
intent, page action, 0–3 editorial scores, noul questions). KK additions: an `unclear` choice in
every choice vocabulary, `keep-or-improve|rewrite|review-consolidation|unclear` instead of
automatic removal, `defaults.minConfidence: 0` so a served low-confidence observation is recorded
rather than silently replaced, and 0–3 score levels with an explicit `uncertain → review` band in
the consumer. The vendor's weighted overall grade and relative 100-point impact scale are
**rejected** — this method publishes per-category pass ratios with their coverage denominators and
no blended SEO/GEO grade.
2. **Rule identities** (`plugins/kk/scripts/seo-rules.ts` `VENDOR_RULES`) retain the 52 upstream
rule ids for traceability, each carrying `disposition` (`native|adapted|informational|deferred`),
KK-chosen `severity`, an `effort` band 1–4, a `heuristic` flag and the primary source with the date
it was checked. Neither severity nor effort is the vendor's.
3. **Source registry**: rule rows cite the primary source itself — RFC 9309 for robots matching,
Google Search Central (canonicalization, robots meta, sitemaps, AI optimization, common crawlers),
OpenAI's crawler documentation, web.dev Web Vitals. The dated registry, the per-source limits and
the refresh procedure are `plugins/kk/skills/smart-seo/references/seo-geo-sources.md`; the rubric,
scoring and action-priority interpretation is
`plugins/kk/skills/smart-seo/references/method.md`; the strict report-narrative contract is
`plugins/kk/skills/smart-seo/references/narrative.md`.
4. **Narrative rendering** uses KK-owned fixed templates over the audit artifact. Agents select and
order recorded references and cannot introduce prose, measurements, diagnoses or predictions.
5. **Vendor code, Python paths, browser/rendering stacks and bundled font assets are not shipped**;
the audit is native Bun/TypeScript over the existing stage runner (ADR-018) and `vendors/` stays
excluded from runtime and install resolution (ADR-036).
