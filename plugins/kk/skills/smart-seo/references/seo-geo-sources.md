# Smart SEO — sources, crawler policy and GEO limits

Every rule row carries the primary `sourceUrl` and the `sourceCheckedAt` date that justified it, and
the report header prints the method version's checked-at date. This reference is the refresh
procedure and the per-source limits — not a license to restate a source as a measurement.

## 1. Primary sources (checked 2026-10-14)

| Source | What it owns | Limit / unknown |
| --- | --- | --- |
| [Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) | Original, useful content plus technical access are what matter for Google AI surfaces. Special AI files, rigid chunking and schema are not eligibility requirements. | It promises no citation, ranking or inclusion. |
| [Google AI features](https://developers.google.com/search/docs/appearance/ai-features) | Snippet eligibility and indexing are prerequisites; crawl observations cannot verify inclusion. | Reporting surface is described inconsistently across Google pages and depends on the account; never freeze an availability claim. |
| [Google common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `Google-Extended` controls separate uses and does not control Search inclusion. | Robots groups express the site owner's **declared** policy only. |
| [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots) | `OAI-SearchBot` is for search, `GPTBot` for training, `ChatGPT-User` is user-triggered with different semantics. | Blocking training is not a search defect; no OpenAI behavior is observable from the audit. |
| [Google Search updates](https://developers.google.com/search/updates) | Dated change log; FAQ rich results stopped appearing 2026-05-07. | Any removal date must be re-read from this page, not from memory. |
| [PSI API notice](https://developers.google.com/speed/docs/insights/v5/get-started) | PSI setup and the announced CrUX removal from PSI. | The removal is announced, not completed — do not report it as done. |
| [Web Vitals](https://web.dev/articles/vitals) | Field p75 LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 defines a Core Web Vitals pass. | Lab TBT cannot substitute for INP; a missing field sample is `unknown`, never zero. |

Supporting rule-level sources (RFC 9309 for robots matching, Google canonicalization and robots-meta
docs, sitemap docs) are recorded per row in `plugins/kk/scripts/seo-rules.ts` (`sourceUrl`).

## 2. Crawler policy — keep the three purposes separate

The audit reads the site's declared crawler policy and the audit's own requests. It cannot observe
what any other crawler did. When you explain crawler findings, name the purpose explicitly:

| Purpose | Typical user agents (as documented by their owners) | What a block means |
| --- | --- | --- |
| **Search / answer-surface indexing** | `Googlebot`, `Bingbot`, `OAI-SearchBot` | Affects eligibility for search and AI answer surfaces that use a search index. Operator intent required: a deliberate restriction is a decision, not a defect. |
| **Model training corpus** | `GPTBot`, `Google-Extended`, `ClaudeBot`, `CCBot` | A policy choice about training data. Blocking training is **not** a search defect, and allowing it is not a ranking or citation strategy. |
| **User-triggered fetch** | `ChatGPT-User` and similar on-demand fetchers | Different robots semantics: the fetch serves a user's explicit request. A block limits that user's session, not search eligibility. |

Rules the audit uses here: `robots_blocks_site` (adapted, critical), `ai_bots_blocked` and
`llms_txt_missing` (informational), `js_dependent` (informational). Report the observed directive,
the path it applies to and the operator-intent caveat — never "AI crawlers cannot see your site".

Also state what the audit itself did: its own crawl honors robots.txt, the declared `Crawl-delay`
and one shared page/request/byte/deadline budget, and it sends no credentials or cookies.

## 3. Source refresh procedure

Do this before changing a rule, re-publishing a rubric statement, or answering a question whose
answer depends on current engine behavior:

1. Open the rule's `sourceUrl` from the failing row (or the table above) and re-read the relevant
   section. Do not refresh from a summary, a vendor README or a search-result snippet.
2. Record today's date as the new `sourceCheckedAt` for that rule and update `sourceUrl` if the
   owner moved the page. Never silently keep an old checked-at date.
3. If the source contradicts the rule's current rationale, treat that as a **rule defect**: the
   rationale, disposition and severity all change together, and the change is a method-version
   change — not an in-run edit of a saved audit.
4. If two sources disagree, keep the more conservative reading, report the uncertainty, and say
   which pages disagree. Vendor self-reported model agreement is not human calibration.
5. Never re-state an announced-but-incomplete change as shipped (for example the PSI/CrUX notice).

Audits stay reproducible: a saved `audit.json` keeps the `sourceCheckedAt` it was produced with,
and offline rescoring reuses the saved check rows rather than re-reading live sources.

## 4. GEO (generative-engine) diagnostics and their limits

GEO work in this method is **editorial diagnostics with explicit uncertainty**: intent
satisfaction, first-hand specificity, verifiable provenance, entity consistency and self-contained
answer-first facts. They are model judgments (`source: model`) with a maker and confidence, or
heuristic content checks — never measurements of an answer engine's behavior. The two `geo`
category rules and the page-level semantic decisions feed the action list exactly like other rows.

What this means in practice:

- Never state or imply that a change will produce citations, mentions, rankings or traffic.
- No synthetic visibility percentage is generated from a quality score. A visibility number exists
  only when the operator supplied an imported snapshot (§5 of `operations.md`), and it is reported
  with its source, window, platform and denominator.
- Locale-specific query and citation samples are dated snapshots, not live data. A missing
  platform, denominator or sample count makes the row unusable — drop it rather than guess.
- "Answer-first" (heading fit, self-contained answer, next step) is an editorial rubric applied to
  the observed page text. It is not a snippet or citation predictor.
- Where the evidence does not exist (a specific engine's answer for a specific query, an actual
  citation rate, a training-corpus inclusion), say that it is unknown and name what would be needed
  to know it. Live provider integration, rank tracking and Search Console OAuth are out of scope in
  this version.

## 5. Vendors and third-party code

`vendors/` is reference-only: it is excluded from runtime and install resolution, and nothing may
be read or copied out of it into a shipped file. The audit is native Bun/TypeScript — no Python
path, no browser/rendering runtime, no bundled font assets. Vendor rule identities are retained for
traceability, but their behavior reflects the dispositions in `plugins/kk/references/smart-seo-attribution.md`
(shipped beside this skill), not the vendor's weighted grades or relative impact scale. The full vendor
review lives in the source repository at `docs/plans/2026-10-14-smart-seo-vendor-review.md`; it is
design-time context and is not installed, so never resolve a runtime path through it.
