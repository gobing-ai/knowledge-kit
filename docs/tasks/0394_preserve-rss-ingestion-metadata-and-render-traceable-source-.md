---
schema_version: 1
name: Preserve RSS ingestion metadata and render traceable source citations
status: todo
template: feature-impl
created_at: 2026-11-18T04:42:14.702Z
updated_at: "2026-11-18T04:50:05.369Z"
feature_id: L3
priority: P1

estimate_hours: 6
---

## 0394. Preserve RSS ingestion metadata and render traceable source citations

### Background

Horizon maps headline URL and references independently while metadata.source carries the upstream ingest label (plugins/ingestions/horizon-ingest/src/index.ts:114). The current editorial renderer uses metadata.source as the citation label (plugins/kk/scripts/daily-stages.ts:4586). The local store contains both direct and aggregator RSS URLs.

### Requirements

- [ ] R1. Audit provenance from raw ingest to stored doc, curated item, article and show notes. Retain collector classification while exposing actual verified source identity.

### Acceptance Criteria

- [ ] R16 — 正文来源链接指向可核实的实际出处

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:05.369Z

**Ready decisions.** Preserve retrieval identity and existing source taxonomy; expose only corroborated original attribution. Code validates final link candidates and uses an explicit aggregator fallback; editorial verification can add evidence. Store/source changes remain additive and no historical identity backfill. Publish one provenance contract for 0385/0386 and keep fallback article rendering aligned.

**Source premise.** `plugins/ingestions/horizon-ingest/src/index.ts:114` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay direct, encoded aggregator, verified reference, conflicting references, malformed links and older stored docs; compare exact labels/URLs and unchanged story identity.

### Design

Reuse existing Doc provenance and URL normalization. Separate the retrieval URL and transport label from an optional verified publisher plus article URL. Prefer an evidenced item permalink or corroborated item-specific reference. When an aggregator is the only verifiable source, label it explicitly. No guessed publishers, arbitrary redirect fetches or URL identity backfills. If resolution needs a fetch, use the existing trusted fetch boundary with bounded timeout and redirect/path validation, or leave unresolved. Keep rendering deterministic and share citation rules across normal, fallback and notes paths.

### Plan

- [ ] Capture representative direct, aggregator, ambiguous multiple-reference and legacy items. Check actual link destinations and labels through normal article/notes generation. Assert invalid or unverifiable links produce a clearly labeled fallback and transport statistics and story IDs remain stable. Record unresolved and resolved counts without requiring a live publisher.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
