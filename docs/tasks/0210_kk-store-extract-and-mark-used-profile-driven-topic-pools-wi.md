---
schema_version: 1
name: "kk store extract and mark-used: profile-driven topic pools with cross-day dedup"
status: todo
template: feature-impl
created_at: 2026-10-07T03:58:06.076Z
updated_at: "2026-10-07T05:06:31.883Z"
feature_id: G31
priority: P1
tags:
  - kk-store
  - extraction
estimate_hours: 4

dependencies: ["0209"]
---

## 0210. kk store extract and mark-used: profile-driven topic pools with cross-day dedup

### Background

Implements: R10 — AI-news extraction selects the episode pool from labels; R11 — A second topic is extractable without re-collecting; R12 — Items aired in an episode never re-enter a later pool; R13 — Architecture docs record the store decision.

Design: docs/design/kk-collect-and-daily-voice2.md §3–§4. ADR-030 and the 03/04 store entries were drafted at planning time with status "accepted design". This task, as the last G31 task, flips them to shipped.

### Requirements

- [ ] R1. Profiles under `plugins/kk/decisions/extract/<topic>.yaml`, shape `{ topic, where: { <decision-id>: { in: [...] } | { gte|lte: n } }, order: ["<decision-id>|first_seen_at asc|desc", ...], limit }`. Ship `ai-news.yaml` per design §4, with dash ids. Unknown keys or decision ids fail with exit 1 `kk.store.profile.invalid`.
- [ ] R2. `kk store extract --topic <t> [--window 24h] [--limit n] [--exclude-used <workflow>] --out <path> [--db]` compiles the profile into one `ItemsDao.selectByProfile(spec)` query: a `labels` self-join per `where` key, `first_seen_at >= now - window`, `NOT EXISTS episode_usage` when excluding. It writes `Doc[]` in the fan-in `blended.json` shape (`id`, `title`, `body`, `mediaType`, `sourceUri`, and `metadata` with the stored fields plus `labels: { <decision-id>: value }`), so episode-plan-gen consumes it unchanged.
- [ ] R3. An empty result writes `[]`, prints `{"count":0}` and exits 0. The caller conditions on `count`.
- [ ] R4. `kk store mark-used --workflow <w> --run <id> --in <Doc[].json>` inserts `episode_usage(item_id, workflow, run_id, used_at)` and ignores duplicates.
- [ ] R5. Fixture profile `apps/cli/tests/fixtures/extract/ai-research.yaml` returns the expected research items from the same seeded DB with no code change.
- [ ] R6. extract opens the store only. It spawns nothing, so there is no ingestion or labeling.
- [ ] R7. Docs: ADR-030 status goes from accepted design to shipped; the 03 "Persistent store" paragraph drops "not yet built"; 04 lists `kk store migrate|lock|ingest|label|extract|mark-used` and `kk schedule render`; 05 marks G31 done.

### Acceptance Criteria

- [ ] AC1 — AI-news extraction selects the episode pool from labels
- [ ] AC2 — A second topic is extractable without re-collecting
- [ ] AC3 — Items aired in an episode never re-enter a later pool
- [ ] AC4 — Architecture docs record the store decision

Testing: before writing code, list every way the unit can fail (failure-first list in the task), then code; prove behavior with one E2E-style bun:test over a temp dir / temp DB, leaving a repeatable artifact under .works/test-artifacts/.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T03:59:06.511Z

- Profile format is YAML (`where` / `order` / `limit`), compiled to one DAO query. Topic-level decisions at read time are rejected because they make the daily path nondeterministic.
- Default window is 24 h and default limit is the current episode cap. Both can be overridden per call.

### Design

Chosen: profile YAML compiled to a single parameterized query in a kk-store DAO, so new topics are data and SQL stays inside the boundary (`raw-sql-only-in-kk-store`, task 0206).
Rejected: decision-per-extraction at read time (latency and nondeterminism in the daily path); hardcoded ai-news SQL (blocks R11).

Invariants:
- Deterministic for a fixed DB, window and now. Tests inject `now`.
- No SQL outside `packages/kk-store`.
- Usage rows are unique on `(item_id, workflow)`.

Files: `packages/kk-store/src/dao/items.ts` (`selectByProfile`), `packages/kk-store/src/profile.ts` (`parseProfile`, `compileProfile`), `plugins/kk/decisions/extract/ai-news.yaml`, `apps/cli/src/commands/store.ts` (extract, mark-used), `apps/cli/tests/store-extract.test.ts`, `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`.

Key signatures:
- `parseProfile(yaml: string): ExtractProfile`
- `compileProfile(p: ExtractProfile, opts: { windowMs: number; now: number; excludeWorkflow?: string; limit?: number }): ProfileQuery`
- `ItemsDao.selectByProfile(q: ProfileQuery): Promise<StoredDoc[]>`

### Plan

- [ ] Failure-first list (unknown topic, invalid profile key, decision id not in the catalog, empty window, all items used, an item missing a label for a `where` key (excluded), limit 0).
- [ ] `profile.ts` + `ai-news.yaml` + the research fixture.
- [ ] `selectByProfile`; extract + mark-used verbs.
- [ ] E2E `apps/cli/tests/store-extract.test.ts` over a seeded temp DB: the ai-news pool, the research pool, mark-used then re-extract excludes, an empty window gives `count` 0. Copy the pool JSONs to `.works/test-artifacts/0210/`.
- [ ] Doc flip (ADR-030, 03, 04, 05) via sp:doc-evolve; `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
