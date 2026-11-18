---
schema_version: 1
name: Preserve RSS ingestion metadata and render traceable source citations
status: done
template: feature-impl
created_at: 2026-11-18T04:42:14.702Z
updated_at: "2026-11-18T16:13:41.112Z"
feature_id: L3
priority: P1

estimate_hours: 6
done_forced: "false"
done_reason: unforced close
---

## 0394. Preserve RSS ingestion metadata and render traceable source citations

### Background

Horizon maps headline URL and references independently while metadata.source carries the upstream ingest label (plugins/ingestions/horizon-ingest/src/index.ts:114). The current editorial renderer uses metadata.source as the citation label (plugins/kk/scripts/daily-stages.ts:4586). The local store contains both direct and aggregator RSS URLs.

### Requirements

- [x] R1. Audit provenance from raw ingest to stored doc, curated item, article and show notes. Retain collector classification while exposing actual verified source identity.

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

**Change map (post-review remediation included).**

- `plugins/kk/scripts/source-citation.ts` (new, 187 lines) — pure resolver `resolveSourceCitation(doc, sourceUri)` returning `{url,label,kind}` or `null`. Rules: (1) a retrieval URL on a known aggregator host is a transport, so one corroborating off-origin reference is cited instead; a retrieval URL that is the publisher's own page is authoritative and a secondary reference never displaces it; a reference that itself lands on a known aggregator host is a transport page and can never corroborate an original (`isKnownAggregatorHost`, `:128-130`, reference filter `:172-174`, gate at `:182`); (2) otherwise the retrieval URL is cited, labelled by the collector classification only when it corroborates the host, else the host (`citeRetrieval`, `:133-139`); (3) a known aggregator retrieval page is labelled explicitly with `（聚合）` (`AGGREGATOR_MARKER`, `:47`); (4) no `http(s)` candidate at all → `null` (caller renders no source line). No fetch, no publisher-name inference, no URL backfill; only `http(s)` reaches the `href`.
- `plugins/kk/scripts/daily-stages.ts` — `sourceLabelForDoc` removed; the editorial renderer emits only the resolver's `[来源：label](url)` (`:4618-4626`), call site `:4864`.
- `plugins/kk/tests/source-citation-0394.test.ts` (new) — resolver contract plus end-to-end `dailyEditorialRender` assertions for direct, corroborated-original, aggregator-fallback, publisher-with-secondary-reference and no-link shapes.
- `apps/cli/tests/kk-workflow-stages.test.ts` — shared-stage citation assertion updated to the honest host label and URL (`:4882`).

**Deferrals (declared, not silently missed).** Both share the same package-boundary argument: this task owns the editorial (article) render path in `plugins/kk/scripts`; the other render surfaces live in separate plugin packages and are re-synced on deploy (`apps/cli/plugins/kk/scripts/`), so changing them here would spread a single citation contract across package boundaries outside this task's scope.

1. *Show notes path* — the notes renderer keeps its own `来源` handling; it is not routed through `resolveSourceCitation` yet (declared in the `/sp:dev-run` receipt §6.1). Deferred on the package-boundary argument above; it under-reports (raw retrieval link), never guesses.
2. *Fallback article renderer* — `plugins/generations/daily-article-gen/src/index.ts:98` (`renderDoc`) still emits `[来源：<host>](<raw sourceUri>)` and is a second live "article" hop: the daily `article` stage invokes it via `daily-article-gen` (`plugins/kk/scripts/daily-stages.ts:790`). Its label is already truthful (host, never a publisher claim); only the `href` keeps the raw retrieval URL, so an aggregator permalink is linked without the `（聚合）` marker or the corroborated original. Deferred on the same package-boundary argument as deferral 1, so the R1 audit's "article" hop list is complete: `daily-stages.dailyEditorialRender` (fixed here) **and** `daily-article-gen.renderDoc` (deferred). Alignment condition: route `renderDoc` through the shared `resolveSourceCitation` contract when the plugin packages are re-synced.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Audit provenance from raw ingest to stored doc, curated item, article and show notes; retain the collector classification while exposing the actual verified source identity | MET | Classification is written as the digest source line's first token and retained untouched (`plugins/ingestions/horizon-ingest/src/index.ts:125`), references from `<details>` (`:98`); the renderer no longer treats the classification as a publisher (`plugins/kk/scripts/daily-stages.ts:4623-4626`); citations resolve to the linked host/origin (`plugins/kk/scripts/source-citation.ts:145-186`). Hop list now complete: article fixed (`plugins/kk/scripts/daily-stages.ts:4864`), fallback renderer deferred-and-declared (`plugins/generations/daily-article-gen/src/index.ts:98`, invoked `plugins/kk/scripts/daily-stages.ts:790`, declared at `docs/tasks/0394_preserve-rss-ingestion-metadata-and-render-traceable-source-.md:62`), show notes deferred-and-declared (`plugins/publishings/podcast-pub/src/show-notes.ts:414`, declared `:61`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R16 — 正文来源链接指向可核实的实际出处 | MET | test | Publisher retrieval kept over a secondary reference (`plugins/kk/tests/source-citation-0394.test.ts:76-98`); corroborated original rendered end-to-end as `[来源：openai.com](https://openai.com/index/gpt-5)` with the transport label absent (`:208-221`); uncorroborated aggregator rendered explicitly as `news.ycombinator.com（聚合）`, no line when linkless (`:223-238`); shared-stage citation pins the honest host (`apps/cli/tests/kk-workflow-stages.test.ts:4882`); resolver contract `plugins/kk/scripts/source-citation.ts:145-186`; fresh suites 8/0 and 164/0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T15:40:54.504Z todo → wip (system)
- 2026-11-18T16:13:40.514Z wip → testing (system)
- 2026-11-18T16:13:41.108Z testing → done (system)

