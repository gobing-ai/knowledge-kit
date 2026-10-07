---
schema_version: 1
name: "kk store extract and mark-used: profile-driven topic pools with cross-day dedup"
status: done
template: feature-impl
created_at: 2026-10-07T03:58:06.076Z
updated_at: "2026-10-07T23:24:02.169Z"
feature_id: G31
priority: P1
tags:
  - kk-store
  - extraction
estimate_hours: 4

dependencies: ["0209"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0210-verdict.json
---

## 0210. kk store extract and mark-used: profile-driven topic pools with cross-day dedup

### Background

Implements: R10 — AI-news extraction selects the episode pool from labels; R11 — A second topic is extractable without re-collecting; R12 — Items aired in an episode never re-enter a later pool; R13 — Architecture docs record the store decision.

Design: docs/design/kk-collect-and-daily-voice2.md §3–§4. ADR-030 and the 03/04 store entries were drafted at planning time with status "accepted design". This task, as the last G31 task, flips them to shipped.

### Requirements

- [x] R1. Profiles under `plugins/kk/decisions/extract/<topic>.yaml`, shape `{ topic, where: { <decision-id>: { in: [...] } | { gte|lte: n } }, order: ["<decision-id>|first_seen_at asc|desc", ...], limit }`. Ship `ai-news.yaml` per design §4, with dash ids. Unknown keys or decision ids fail with exit 1 `kk.store.profile.invalid`.
- [x] R2. `kk store extract --topic <t> [--window 24h] [--limit n] [--exclude-used <workflow>] --out <path> [--db]` compiles the profile into one `ItemsDao.selectByProfile(spec)` query: a `labels` self-join per `where` key, `first_seen_at >= now - window`, `NOT EXISTS episode_usage` when excluding. It writes `Doc[]` in the fan-in `blended.json` shape (`id`, `title`, `body`, `mediaType`, `sourceUri`, and `metadata` with the stored fields plus `labels: { <decision-id>: value }`), so episode-plan-gen consumes it unchanged.
- [x] R3. An empty result writes `[]`, prints `{"count":0}` and exits 0. The caller conditions on `count`.
- [x] R4. `kk store mark-used --workflow <w> --run <id> --in <Doc[].json>` inserts `episode_usage(item_id, workflow, run_id, used_at)` and ignores duplicates.
- [x] R5. Fixture profile `apps/cli/tests/fixtures/extract/ai-research.yaml` returns the expected research items from the same seeded DB with no code change.
- [x] R6. extract opens the store only. It spawns nothing, so there is no ingestion or labeling.
- [x] R7. Docs: ADR-030 status goes from accepted design to shipped; the 03 "Persistent store" paragraph drops "not yet built"; 04 lists `kk store migrate|lock|ingest|label|extract|mark-used` and `kk schedule render`; 05 records G31’s REAL status — 0206/0208/0209/0210 done with 0213 outstanding, so G31 is NOT recorded done (AMENDED 2026-10-07 in run 5171461a: the original read "05 marks G31 done", which predates task 0213 — the task carrying G31 scenario R14 — and is unsatisfiable while 0213 is `backlog`; a premature done would be a false status and would contradict `spur feature check G31 --strict --as done`).

### Acceptance Criteria

- [x] AC1 — AI-news extraction selects the episode pool from labels
- [x] AC2 — A second topic is extractable without re-collecting
- [x] AC3 — Items aired in an episode never re-enter a later pool
- [x] AC4 — Architecture docs record the store decision

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



Additional declared surfaces: `apps/cli/tests/commands/store.test.ts` and `packages/kk-store/tests/**` — the store noun test must assert the two new verbs alongside `migrate`/`lock`/`ingest`/`label`, and the new profile query needs its own store tests. Note R7 predates task 0213: `docs/05_FEATURES.md` must record G31’s REAL state, and G31 cannot be marked done while 0213 (R14, added after this task was written) is outstanding.



The executable AC4 evidence lives in `apps/cli/tests/store-docs.test.ts`: the pipeline refuses to carry a MET acceptance criterion on a static reference alone, so the four documentation claims are asserted as a test rather than cited.

### Plan

- [x] Failure-first list (unknown topic, invalid profile key, decision id not in the catalog, empty window, all items used, an item missing a label for a `where` key (excluded), limit 0).
- [x] `profile.ts` + `ai-news.yaml` + the research fixture.
- [x] `selectByProfile`; extract + mark-used verbs.
- [x] E2E `apps/cli/tests/store-extract.test.ts` over a seeded temp DB: the ai-news pool, the research pool, mark-used then re-extract excludes, an empty window gives `count` 0. Copy the pool JSONs to `.works/test-artifacts/0210/`.
- [x] Doc flip (ADR-030, 03, 04, 05) via sp:doc-evolve; `bun run gate`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/store.ts:1` |
| `apps/cli/src/commands/store.ts:196` |
| `apps/cli/src/commands/store.ts:200` |
| `apps/cli/src/commands/store.ts:249` |
| `apps/cli/src/commands/store.ts:3` |
| `apps/cli/src/commands/store.ts:40` |
| `apps/cli/src/commands/store.ts:706` |
| `apps/cli/src/commands/store.ts:859` |
| `apps/cli/src/commands/store.ts:912` |
| `apps/cli/tests/commands/store.test.ts:38` |
| `apps/cli/tests/commands/store.test.ts:42` |
| `apps/cli/tests/commands/store.test.ts:68` |
| `docs/00_ADR.md:1157` |
| `docs/03_ARCHITECTURE.md:122` |
| `docs/04_DESIGN.md:359` |
| `docs/04_DESIGN.md:422` |
| `docs/04_DESIGN.md:70` |
| `docs/04_DESIGN.md:88` |
| `docs/05_FEATURES.md:97` |
| `packages/kk-store/src/dao/items.ts:11` |
| `packages/kk-store/src/dao/items.ts:226` |
| `packages/kk-store/src/dao/items.ts:5` |
| `packages/kk-store/src/index.ts:23` |
| `packages/kk-store/src/index.ts:27` |
| `packages/kk-store/tests/dao/items.test.ts:111` |
| `packages/kk-store/tests/dao/items.test.ts:3` |
| `apps/cli/tests/fixtures/extract/ai-research.yaml:1` |
| `apps/cli/tests/store-docs.test.ts:1` |
| `apps/cli/tests/store-extract.test.ts:1` |
| `packages/kk-store/src/profile.ts:1` |
| `packages/kk-store/tests/profile.test.ts:1` |
| `plugins/kk/decisions/extract/ai-news.yaml:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-store/src/profile.ts:93` ProfileInvalidError raised by profile parsing at `packages/kk-store/src/profile.ts:110`; `packages/kk-store/tests/profile.test.ts:30`, `packages/kk-store/tests/profile.test.ts:68` |
| R2 | MET | `packages/kk-store/src/dao/items.ts:236` selectByProfile with the workflow-scoped exclusion at `packages/kk-store/src/dao/items.ts:285`; `packages/kk-store/tests/dao/items.test.ts:128` |
| R3 | MET | `apps/cli/src/commands/store.ts:811` extractAction prints count at `apps/cli/src/commands/store.ts:833`; `apps/cli/tests/store-extract.test.ts:227` (empty pool) |
| R4 | MET | `apps/cli/src/commands/store.ts:850` markUsedAction; `apps/cli/tests/store-extract.test.ts:335` |
| R5 | MET | `apps/cli/tests/store-extract.test.ts:258` second topic profile over the same store, no code change |
| R6 | MET | `apps/cli/src/commands/store.ts:811` reads profile, opens store, selects, writes out; invalid profile maps to its code at `apps/cli/src/commands/store.ts:838`; `apps/cli/tests/store-extract.test.ts:194` |
| R7 | MET | ADR-030 at `docs/00_ADR.md:1159` (shipped), `docs/03_ARCHITECTURE.md:122` (shipped), `docs/04_DESIGN.md:90`. Fix pass: `docs/05_FEATURES.md:98` recorded G31 as active/NOT done with 0213 backlog although G31 and 0213 are done; row corrected and `apps/cli/tests/store-docs.test.ts:70` now binds the 05 status cell to the feature file status (falsified: reverting the row to active fails the test) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — AI-news extraction selects the episode pool from labels | MET | test | `apps/cli/tests/store-extract.test.ts:159` |
| AC2 — A second topic is extractable without re-collecting | MET | test | `apps/cli/tests/store-extract.test.ts:258` |
| AC3 — Items aired in an episode never re-enter a later pool | MET | test | `apps/cli/tests/store-extract.test.ts:335`, `packages/kk-store/tests/dao/items.test.ts:180` |
| AC4 — Architecture docs record the store decision | MET | test | `apps/cli/tests/store-docs.test.ts:39`, `apps/cli/tests/store-docs.test.ts:48`, `apps/cli/tests/store-docs.test.ts:54`, `apps/cli/tests/store-docs.test.ts:70` — 5 pass / 0 fail this run |
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

- 2026-10-07T17:58:07.449Z todo → testing (system)
- 2026-10-07T17:58:10.150Z testing → done (system)

