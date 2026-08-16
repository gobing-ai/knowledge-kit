---
topic: STORM research workflow improvements — reference caching, markitdown normalization, report digestion
date: 2026-08-15
needs_design: true
run_id: 9a2bf7fb-4eab-4905-9868-16491733bac3
---

# Brainstorm: STORM Research Workflow Improvements

## Overview

The `kk-storm-research` workflow (prepare → ingest → generate → render, 0059) turns a topic into
a grounded `content.md` report. Three improvement signals, observed on the live works dir
`~/.config/kk/works/how-to-write-it-technical-documents-for-specific-d158f7c2`:

1. **Evidence bodies carry boilerplate.** `docs.json` Doc bodies contain cookie-consent junk
   ("Manage Consent … FunctionalFunctional …") straight from Firecrawl search markdown
   (`plugins/ingestions/web-search/src/index.ts` calls `/v2/search` with
   `scrapeOptions.formats: ["markdown"]`). No durable per-reference copy exists on disk.
2. **No per-reference cache.** Re-running ingest re-fetches everything; evidence is only the
   opaque `docs.json` blob — nothing a reader or a later pass can audit file-by-file.
3. **Report can degenerate toward an index.** The sample report does digest (8 synthesized
   sections), but the render sidecar appends a full `## Outline` replay plus a bare `## References`
   URL list; digestion quality is prompt variance, not contract.

Goal: cache normalized full-content per reference, convert originals via the existing external
`markitdown` tool (0.1.4, verified at `~/.local/bin/markitdown`), and make "digest, don't list"
the report contract.

## Approaches

### Approach 1: Extend the web-search plugin — fetch → markitdown → cache (`references/`) ⭐

**Description:** After the search returns `Doc[]` (id = `sha256(sourceUri)` 16-hex), the plugin
fetches each source's full content via Firecrawl `/v2/scrape` (same `FIRECRAWL_API_KEY`), pipes it
through the `markitdown` binary, writes `works/<topic-id>/references/<doc-id>.md`, and uses the
normalized text as the Doc body in `docs.json`. Per-URL failures are non-fatal (skip + warn).

**Trade-offs:**
- **Pros:** one owner (the ingestion plugin) — every ingestion→generation pipeline benefits; durable
  cache = audit trail for better-report (d) and re-run reuse (better-report c: no re-fetch when
  sources unchanged); normalized bodies strip the observed consent-banner junk → smaller, cleaner
  generation context (token savings); no new workflow states.
- **Cons:** plugin gains network + external-binary surface (ingest slower; needs skip-log discipline);
  `markitdown` becomes a runtime dependency (0.1.4 present, must be availability-checked); adds a
  `references/` directory to the frozen 0056 works layout → requires amending that contract;
  per-URL scrape adds Firecrawl cost/rate usage.

**Implementation Notes:** scrape per URL with `formats: ["markdown"]`, fall back to search-snippet
body on scrape failure; `references/` written under `${work_dir}`; docs.json contract unchanged
(Doc[] shape stays the same, body just gets better). 0056 amendment: add one row to the works-layout
table. markitdown invoked as external binary (it is one today), not a new dependency.

**Confidence:** HIGH — every component verified in this repo or on PATH today (search-returns-markdown:
plugin source + live docs.json; markitdown 0.1.4: `which`; layout freeze: storm-research SKILL.md).
`/v2/scrape` specifics: MEDIUM (same documented Firecrawl API family, not yet observed from this repo).

### Approach 2: New `fetch-refs` workflow state (orchestration-owned script)

**Description:** Keep the plugin pure search; add a state between ingest and generate in
`kk-storm-research.yaml` running a new `plugins/kk/scripts/fetch-refs.ts` that reads `docs.json`,
scrapes, markitdown-normalizes, writes `references/`, and rewrites bodies.

**Trade-offs:**
- **Pros:** pipeline shape visible in the workflow YAML (kk owns steps, spur owns orchestration);
  plugin stays single-purpose; the fetch step can be parametrized/skipped per run.
- **Cons:** a second component now knows the Doc[] contract (drift risk with the plugin); same
  Firecrawl + markitdown wiring, relocated; same 0056 layout change; more moving parts for zero
  behavior gain over A1.

**Confidence:** HIGH feasible; MEDIUM that it is the better owner — it splits one contract across
two components.

### Approach 3: Generator-side lazy fetch + digestion-prompt upgrade (no cache dir)

**Description:** `content-gen` fetches full text only when a Doc body is thin, at generation time;
upgrade its prompt to mandate synthesis over listing; render drops/reduces the Outline tail.

**Trade-offs:**
- **Pros:** smallest diff; no layout amendment, no markitdown dependency, no cache plumbing.
- **Cons:** no durable evidence cache (re-fetches every run — strictly worse than today's docs.json
  reuse); network inside generation → slow, non-deterministic runs; thin-body heuristic is fragile;
  leaves the observed boilerplate junk in bodies.

**Confidence:** HIGH feasible; LOW–MEDIUM value.

## Recommendations

**Adopt Approach 1, paired with a report-craft upgrade as one reshape.** The three sub-ideas are a
single coherent change: evidence hygiene (scrape + markitdown + `references/` cache, plugin-owned)
and report craft (content-gen prompt mandates conclusions; storm-research better-report gains
"the report digests — references are evidence, not the deliverable"; render keeps a compact
references list resolved to cached files). Approach 2 relocates A1's work without adding value;
Approach 3 skips the durable cache and the noise fix. `needs_design: true` — the change crosses
ingestion plugin, generator, render script, the frozen works layout, and introduces an external
binary dependency.

## Design Summary

Add a per-reference evidence cache to the STORM works layout. After `web-search` returns `Doc[]`,
the plugin fetches each source's full content via Firecrawl `/v2/scrape` (reusing
`FIRECRAWL_API_KEY`), normalizes it with the installed `markitdown` binary (0.1.4), writes
`works/<topic-id>/references/<doc-id>.md`, and uses the normalized text as the Doc body in
`docs.json` (Doc[] contract unchanged). Per-URL failures are non-fatal: skip, warn, keep the
search-snippet body. In parallel, tighten report craft: `content-gen` prompt mandates synthesis
over listing, storm-research better-report gains a "digest, don't index" practice, and the render
tail is a compact references list resolved to cached files. Amend the frozen 0056 works layout to
add the `references/` directory; availability-check `markitdown` at ingest time (fail loud only
when the pipeline requires it). No new `kk` noun, no new workflow states, no new dependency beyond
the already-installed binary.

## Next Steps

- Amend 0056 works layout (ADR entry) for `references/`.
- A1: extend `plugins/ingestions/web-search/src/index.ts` (scrape → markitdown → cache → body).
- Craft: content-gen prompt + storm-research R1 practice + render tail cleanup.
- Verify: fixture mode with a scrape-failure case; live run on one topic; citations resolve to
  `references/` files (better-report d).
