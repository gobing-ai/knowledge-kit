---
template: feature-impl
schema_version: 1
name: "Live ingest caches normalized full content per reference"
description: ""
status: todo
type: task
profile: standard
feature_id: C5
parent_wbs: null
priority: P2
tags: ["storm-research", "evidence-cache", "web-search"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T03:35:23.255Z"
updated_at: "2026-08-16T03:35:23.257Z"
---

## 0062. Live ingest caches normalized full content per reference

### Background

Implements: C5 R1 — Live ingest scrapes and normalizes full content into a per-reference cache; R2 — Doc bodies use the normalized full content while docs.json stays contract-valid; R3 — A per-URL scrape failure is non-fatal with snippet fallback; R4 — Re-running ingest reuses the cached normalized body; R5 — Live ingest fails loud when markitdown is unavailable; R9 — Fixture mode performs no scrape and needs no key or markitdown; R10 — Live ingest with FIRECRAWL_API_KEY unset fails loud before scraping; R11 — A scrape returning unusable content falls back to the snippet body.

Extends the web-search ingestion plugin live path (design D1–D6, ADR-013): after searchFirecrawl returns Doc[], fetch each source via Firecrawl /v2/scrape with formats: ["markdown"], normalize the HTML with the markitdown binary on PATH, write works/<topic-id>/references/<doc-id>.md (doc id = sha256(sourceUri) 16-hex), and use the normalized text as the Doc body — the Doc[] shape stays unchanged. Cache reuse is file-existence only (no TTL, no query bookkeeping). Scrape and markitdown stay injectable (extend SearchDeps) so unit tests never hit the network or the real binary.

First task in the C5 batch — runs in parallel with the report-craft task; the SKILL.md doc task lands last.
Rubric: E3 D1 L1 C0 R1 = 6 → task (score 5+; cohesive single-file surface — a scrape/cache split from the fail-loud rows would contend over the same file and was rejected).

### Requirements
- [ ] R1. Fetch each source's full content via Firecrawl /v2/scrape with formats: ["markdown"] using FIRECRAWL_API_KEY, in live mode only.
- [ ] R2. Normalize fetched HTML with the markitdown binary and write works/<topic-id>/references/<doc-id>.md (doc id = sha256(sourceUri) 16-hex), creating the references/ dir under the --out work dir.
- [ ] R3. Reuse references/<doc-id>.md when it exists — no new /v2/scrape call for that source.
- [ ] R4. Use the normalized full content as each Doc body in docs.json; keep the Doc[] shape parseable by DocListSchema.
- [ ] R5. On per-URL scrape failure or empty/unparsable content: warn naming the URL, keep the search-snippet body, exit 0, still write docs.json.
- [ ] R6. Fail loud in live mode when markitdown is not on PATH: exit 1, stderr names markitdown, no docs.json.
- [ ] R7. Fail loud in live mode when FIRECRAWL_API_KEY is unset: exit 1, stderr names the key, no docs.json.
- [ ] R8. Fixture mode performs no scrape, no key check, and no markitdown invocation — canned docs unchanged.
- [ ] R9. Extend SearchDeps with injectable scrape + markitdown runners and unit-test R1–R8 without network or the real binary.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

C5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
