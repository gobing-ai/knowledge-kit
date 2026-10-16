# Smart SEO — method, rubric and score interpretation

The rubric is a **versioned internal checklist**, not a vendor grade and not a search-engine
verdict. Every claim below is what the artifacts record; nothing here measures indexing, ranking,
traffic, revenue, bot behavior or citation visibility.

## 1. Evidence classes — label them every time you report

| Class | Meaning | Recorded where |
| --- | --- | --- |
| **Measurement / observed fact** | A value the audit actually observed within its stated budget (HTTP status, title text, robots directive, response bytes, timings). | `crawl.json` page facts, `checks.json` row `evidenceRefs`, `audit.json` `/facts/*` |
| **Heuristic** | A bounded rule-of-thumb over observed facts. `heuristic: true` on the check row and on the derived action. Examples: page depth, thin content (visible word count), title length, heading skips, orphan/depth observations "among sampled pages". | `checks.json` / `audit.json` `heuristic` |
| **Unknown** | Not assessed or not assessable: malformed, unavailable, budget-exhausted, blocked, or outside the collected scope. Never rendered as a pass. | `checks.json` status `unknown`, `coverage.unknown`, `audit.json` `/limits/*` |
| **Model judgment** | An editorial output from a typed decision (`source: model`, with maker and confidence). Advisory, never a measurement. | `judgments.json`, `audit.json` `/judgments` |
| **Imported evidence** | A supplied visibility snapshot or PSI/CrUX measurement, with source, collection window and `measurementKind`. | `performance.json`, `visibility.json` |
| **Consultation** | Advice outside the collected evidence (specialist legal/hosting/i18n/analytics work). Say so explicitly and name the missing evidence. | nowhere — it must not enter the report as a finding |

Rule of thumb: a value is a **measurement** only if some artifact records it with a source; a
judgment, an inference or a threshold over content is a **heuristic** or **advisory** statement.

## 2. Checklist structure

52 deterministic rules across five categories — `technical` (22), `content` (16), `crawl` (8),
`security` (4), `geo` (2). Each rule keeps a stable identity, a severity, an effort band, a
`heuristic` flag, a primary `sourceUrl` and a `sourceCheckedAt` date, and one disposition from the
vendor review (`native`, `adapted`, `informational`, `deferred`).

Every eligible rule/subject pair yields exactly **one** row:

```json
{
  "ruleId": "title_missing",
  "subjectId": "<hashed subject identity>",
  "subjectUrl": "https://example.com/a",
  "status": "fail",
  "category": "content",
  "severity": "high",
  "evidenceRefs": ["https://example.com/a"],
  "sourceUrl": "https://developers.google.com/search/docs/appearing-in-search/...",
  "sourceCheckedAt": "2026-10-14",
  "heuristic": false,
  "reason": "Human-readable reason for this status"
}
```

`status` is `pass | fail | unknown | not-applicable`. **The absence of a row is an error, never a
pass.** `not-applicable` means the rule cannot apply to that subject (for example a site-level rule
against a page-level subject); it is excluded from both the score and the coverage denominator.

Intent-sensitive observations are not defects by themselves: a robots directive, an intentional
`noindex`, a canonical pointing elsewhere, a missing optional file or missing optional metadata all
require operator intent before they become a recommendation. Missing SEO files never turn into
indexing requirements in the narrative.

## 3. Scores

Category score = `round(100 * pass / (pass + fail))` over the **applicable assessed** rows of that
category, and `null` when that category has no assessed row:

| Field | Meaning |
| --- | --- |
| `scores.technical` / `content` / `crawl` / `security` | The checklist pass ratio in that category. `null` = undefined denominator, never 0. |
| `coverage.totalRules` | 52 (the checklist size). |
| `coverage.applicableRules` | Rows whose status is not `not-applicable`. |
| `coverage.assessed` | Rows with `pass` or `fail`. |
| `coverage.unknown` | Applicable rows left `unknown`. |
| `coverage.ratio` | `assessed / (assessed + unknown)` — how much of the applicable checklist was actually assessed. |

Interpretation rules:

- There is **no blended overall SEO/GEO grade** in this method version. Report the four category
  ratios with their coverage side by side; a ratio published without its coverage is misleading.
- `geo` rules are assessed and prioritized like any other row but produce no category score.
- Unknown and review values never count as successes, and a disabled or unavailable optional area
  is reported as such rather than folded into a pass.
- Never compare scores across two runs with different coverage, different `methodVersion`, or
  different options — record the denominators with the number.
- A high score means "few sampled rules failed", not "the site is healthy". A low score does not
  prove a traffic or ranking problem.

## 4. Action ordering and priorities

One action per failing rule, carrying the full affected-subject list (aggregation must not hide
unknown subjects). Stable ID `SEO-<ruleId>-<first12(sha256(subject identity))>` — sorting never
renumbers an ID, so IDs stay comparable across revisions.

Order: severity (`critical`, `high`, `medium`, `low`, `info`) → affected-page count descending →
effort band ascending → stable ID.

| Priority | Meaning |
| --- | --- |
| `P1` | Confirmed `critical` or `high` severity failures. |
| `P2` | Confirmed `medium` severity failures. |
| `P3` | Confirmed low-severity failures. |
| `review` | Uncertain items — kept out of fix-first lists until the operator confirms intent or supplies missing evidence. |

`effort` is a declared planning band (1–4), not a quote or an estimate in hours. Severity expresses
the rule's consequence, not its certainty; read it together with `heuristic` and with `coverage`.
Editorial (content/GEO) scores can justify a review suggestion, never confirm a technical fact.

## 5. Reading a check back to its evidence

1. Take the action's `ruleId`, `affectedSubjects` and stable ID.
2. Open `checks.json` and select the rows with that `ruleId`; read `status`, `reason`,
   `evidenceRefs`, `sourceUrl` and `sourceCheckedAt`.
3. Read the underlying page facts in `crawl.json` (or the referenced `evidence/pages/*.json`).
4. Read `audit.json` `/limits/*` and `coverage` before drawing any conclusion: a limit or a high
   `unknown` count bounds what the finding can mean.
5. If the primary source page has changed since `sourceCheckedAt`, refresh the source before
   relying on the rule's stated rationale (see `seo-geo-sources.md`).

## 6. What this method cannot conclude

- Whether a URL is indexed, ranking, receiving traffic or being cited by any AI answer engine.
- What a crawler actually did: the audit observes the site's **declared** policy
  (robots.txt, meta robots, sitemap) and its own requests — never another crawler's behavior.
- How a browser renders a JavaScript-dependent page: rendering is deferred, so a raw-HTML shell is
  suspicion only.
- Whether an editorial judgment is correct: adequacy of a value proposition, content depth or
  citability is an opinion with a maker and a confidence, not a fact.
- Performance causes or fixes: PSI lab metrics and CrUX field data, when supplied, describe
  observed timing, not the work needed to change it.
