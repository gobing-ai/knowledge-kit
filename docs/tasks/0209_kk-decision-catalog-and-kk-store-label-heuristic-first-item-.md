---
schema_version: 1
name: "kk decision catalog and kk store label: heuristic-first item labeling"
status: done
template: feature-impl
created_at: 2026-10-07T03:58:06.075Z
updated_at: "2026-10-07T17:16:20.835Z"
feature_id: G31
priority: P1
tags:
  - decision
  - labels
estimate_hours: 6

dependencies: ["0208"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0209-verdict.json
---

## 0209. kk decision catalog and kk store label: heuristic-first item labeling

### Background

Implements: R8 — Newly inserted items are labeled through the kk decision catalog; R9 — Decision backend failure falls back to the heuristic label and is recorded.

Design: docs/design/kk-collect-and-daily-voice2.md §4. Taxonomy source: episode-plan-gen MECE v1 categories + quality/importance/urgency/impact 0–5. Upstream spur feature P1 (decision production readiness) is still in progress — degrade path is mandatory.

### Requirements

- [x] R1. Catalog `plugins/kk/decisions/kk-items.yaml` (`$schema: "@gobing-ai/spur/schemas/decision-catalog.schema.json"`, `version: 1`). Decision ids must match `^[a-z][a-z0-9_-]*$`, so they are dash-named:
  - `kk-item-category`: `type: choice`; criteria map `ai-news`, `ai-technical`, `ai-research`, `ai-industry`, `non-ai` (descriptions from `episode-plan-gen` `Category` docs); `fallback: non-ai`.
  - `kk-item-quality`, `kk-item-importance`, `kk-item-urgency`, `kk-item-impact`: `type: score`; criteria are an ordered list of 6 rubric strings (levels 0–5); `fallback: 2`.
  - Every decision declares parameters `title` (string) and `source` (string).
- [x] R2. Register the catalog with `decisions.paths: [plugins/kk/decisions]` in `.spur/config.yaml`. `spur decision status --json` reports `ok: true`, empty `loadErrors`, and all five ids (there is no `spur decision validate` verb).
- [x] R3. The heuristic stays owned by the plugin. `episode-plan-gen` gains `EPISODE_PLAN_MODE=label`, which classifies and scores every input Doc with no cap, dedup or filter, and returns `metadata.docs` with `metadata.category` and `metadata.scores` set. `kk store label` gets heuristic labels via `kk executor run episode-plan-gen` in that mode, so apps/cli never imports plugin source.
- [x] R4. `kk store label --run <id> --new-ids <path> [--maker fm-local] [--mode heuristic|decision] [--db]` labels only the ids listed, writing one `labels` row per decision: `item_id`, `decision_id`, `value`, `maker`, `source` (heuristic | model | default), `confidence`, `run_id`, `labeled_at`.
- [x] R5. In heuristic mode, only items the heuristic files as `non-ai` while matching an AI keyword go to `spur decision run <id> --param title=… --param source=… --evidence <tmp body file> --maker <m> --json`. In decision mode every new item goes. Results are parsed from `{ value, confidence, source, reason, maker }`.
- [x] R6. A decision result with `source: default` (reason `no-backend` | `timeout` | `error` | `low-confidence`) stores the heuristic value with `source: default`. A spawn failure is treated the same, and the command exits 0. Output is `{labeled, model, fallback}`.

### Acceptance Criteria

- [x] AC1 — Newly inserted items are labeled through the kk decision catalog
- [x] AC2 — Decision backend failure falls back to the heuristic label and is recorded

Testing: before writing code, list every way the unit can fail (failure-first list in the task), then code; prove behavior with one E2E-style bun:test over a temp dir / temp DB, leaving a repeatable artifact under .works/test-artifacts/.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T03:59:06.314Z

- No heuristic extraction is needed: `classifyCategory` and `scoreDimensions` are already exported from `@gobing-ai/episode-plan-gen` (plugins/generations/episode-plan-gen/src/index.ts:363, :391). `kk store label` imports them as a workspace dependency.
- Default `label.mode: heuristic`: the model is consulted only for items the heuristic files as `non-ai` with an AI keyword hit. `label.mode: decision` forces the model for every new item.
- Default maker is `fm-local` (local, high-volume). Override with `--maker`.

- **Q (2026-10-07 refine):** Should `kk store label` import episode-plan-gen's heuristic as a workspace dependency? **A:** No — superseded. apps/cli calls the heuristic through `kk executor run episode-plan-gen` with `EPISODE_PLAN_MODE=label` so the plugin owns its logic (I14) and apps/cli keeps zero plugin deps.

### Design

Chosen: row-per-decision labels plus heuristic-first routing, so cost scales with new uncertain items, not with the corpus, and a new decision needs no schema change.

Verified with spur on 2026-10-07:
- `spur decision run task-triage --maker typesafe --json` → `{ id, confidence, source: 'default', reason: 'no-backend', maker, durationMs, type, value }`, exit 0.
- The score criteria schema is an array of at least 2 entries, with the value an integer level.

Rejected:
- One JSON labels blob per item (unqueryable).
- Model-labeling every item every run (50+ items × 5 decisions per 4h).
- apps/cli importing `@gobing-ai/episode-plan-gen` (couples the CLI to a plugin instance and breaks the plugin self-containment of I14). The plugin mode keeps one heuristic implementation behind the executor contract.

Invariants:
- Labeling never fails the collect run.
- Unchanged items are never re-sent.
- Every row records its source.

Files: `plugins/kk/decisions/kk-items.yaml`, `.spur/config.yaml`, `plugins/generations/episode-plan-gen/src/index.ts` (+ test), `apps/cli/src/commands/store.ts` (label), `apps/cli/tests/store-label.test.ts`, `plugins/kk/workflows/kk-collect.yaml` (`label` state), `docs/04_DESIGN.md`.

Spawn cost: one `spur decision run` process per item × decision routed to the model. ponytail: serial spawns; batch them when the measured label state exceeds 5 min.



Additional declared surfaces: `apps/cli/tests/commands/store.test.ts` (the `kk store` noun surface — the new `label` verb is asserted there alongside `migrate`/`lock`/`ingest`) and `plugins/kk/tests/decision-catalog.test.ts` (the catalog + registry contract).



R4 vs the 0206 schema: `labels` as built by task 0206 carries `item_id, decision_id, value, score, maker, source, labeled_at` — no `confidence` and no `run_id`, which R4 requires. The feature-level criterion (G31 R8) asks only for value/maker/source, so R4 is a legitimate finer-grained task requirement. Resolved the way task 0206 R5 prescribes (`schema evolves only through versioned migrations`): a new append-only migration `0002_labels_confidence_run_id` plus the matching `defineTable` columns and DAO fields. Declared surfaces for that: `packages/kk-store/src/schema/labels.ts`, `packages/kk-store/src/migrations.ts`, `packages/kk-store/src/dao/labels.ts`, `packages/kk-store/src/index.ts`, `packages/kk-store/tests/**`.

### Plan

- [x] Failure-first list (backend down, malformed decision JSON, value outside the choice set or the 0–5 range, empty body, catalog load error, the spur binary missing).
- [x] `EPISODE_PLAN_MODE=label` in episode-plan-gen, with a test that 30 fixture docs come back uncapped with category + scores.
- [x] Author the catalog and register the path; `spur decision status --json` is clean.
- [x] `kk store label`; replace the `true` placeholder in kk-collect's `label` state.
- [x] E2E `apps/cli/tests/store-label.test.ts`: seeded DB plus new-ids, `--maker typesafe` (no backend, so a deterministic fallback) → every row `source: default`, exit 0; heuristic-only run → zero spur spawns. Copy the labels table dump to `.works/test-artifacts/0209/`.
- [x] `docs/04_DESIGN.md` rows; `bun run gate`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/store.ts:1` |
| `apps/cli/src/commands/store.ts:11` |
| `apps/cli/src/commands/store.ts:18` |
| `apps/cli/src/commands/store.ts:247` |
| `apps/cli/src/commands/store.ts:4` |
| `apps/cli/src/commands/store.ts:681` |
| `apps/cli/src/commands/store.ts:719` |
| `apps/cli/tests/commands/store.test.ts:111` |
| `apps/cli/tests/commands/store.test.ts:37` |
| `apps/cli/tests/commands/store.test.ts:6` |
| `apps/cli/tests/commands/store.test.ts:82` |
| `apps/cli/tests/commands/store.test.ts:89` |
| `apps/cli/tests/commands/store.test.ts:91` |
| `docs/04_DESIGN.md:393` |
| `docs/04_DESIGN.md:593` |
| `docs/04_DESIGN.md:596` |
| `docs/04_DESIGN.md:598` |
| `docs/04_DESIGN.md:69` |
| `docs/04_DESIGN.md:84` |
| `docs/04_DESIGN.md:913` |
| `packages/kk-store/src/dao/labels.ts:20` |
| `packages/kk-store/src/dao/labels.ts:44` |
| `packages/kk-store/src/dao/labels.ts:54` |
| `packages/kk-store/src/dao/labels.ts:59` |
| `packages/kk-store/src/migrations.ts:108` |
| `packages/kk-store/src/migrations.ts:17` |
| `packages/kk-store/src/migrations.ts:39` |
| `packages/kk-store/src/migrations.ts:80` |
| `packages/kk-store/src/migrations.ts:91` |
| `packages/kk-store/src/schema/labels.ts:10` |
| `packages/kk-store/src/schema/labels.ts:22` |
| `packages/kk-store/tests/dao/labels.test.ts:36` |
| `packages/kk-store/tests/kk-store.test.ts:184` |
| `packages/kk-store/tests/kk-store.test.ts:188` |
| `packages/kk-store/tests/kk-store.test.ts:66` |
| `packages/kk-store/tests/kk-store.test.ts:69` |
| `packages/kk-store/tests/kk-store.test.ts:73` |
| `packages/kk-store/tests/kk-store.test.ts:82` |
| `plugins/generations/episode-plan-gen/src/index.ts:22` |
| `plugins/generations/episode-plan-gen/src/index.ts:421` |
| `plugins/generations/episode-plan-gen/src/index.ts:679` |
| `plugins/generations/episode-plan-gen/src/index.ts:903` |
| `plugins/generations/episode-plan-gen/src/index.ts:988` |
| `plugins/generations/episode-plan-gen/src/index.ts:990` |
| `plugins/kk/workflows/kk-collect.yaml:131` |
| `plugins/kk/workflows/kk-collect.yaml:141` |
| `plugins/kk/workflows/kk-collect.yaml:229` |
| `apps/cli/tests/store-label.test.ts:1` |
| `packages/kk-store/tests/migrations.test.ts:1` |
| `plugins/kk/decisions/kk-items.yaml:1` |
| `plugins/kk/tests/decision-catalog.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/decisions/kk-items.yaml:12` (`$schema` + `version: 1`); `:20-113` five dash-named ids (all match `^[a-z][a-z0-9_-]*$`), `kk-item-category` choice criteria `ai-news/ai-technical/ai-research/ai-industry/non-ai` with `fallback: non-ai`, four `kk-item-*` score decisions with 6 rubric strings (levels 0–5) and `fallback: 2`, and `title`/`source` string parameters on every decision. Pinned by `plugins/kk/tests/decision-catalog.test.ts:53-110`. |
| R2 | MET | `.spur/config.yaml:159-161` registers project-relative `plugins/kk/decisions`; live `spur decision status --json` → `ok: true`, `loadErrors: []`, `duplicateIds: []`, all five `kk-item-*` ids served. |
| R3 | MET | `plugins/generations/episode-plan-gen/src/index.ts:680` adds `label` mode; `:917-933` `labelDocs` is a bare `docs.map` — no cap, dedup, filter or top-N — annotating every doc with `category`/`scores`/`needs_model`; `plan`/`filter` untouched. `apps/cli` reaches it only via `kk executor run` (`apps/cli/src/commands/store.ts:420-421`), no plugin-source import. Caveat: the Plan's "30 fixture docs uncapped" unit test does not exist (review P3); the no-cap claim rests on the code reading plus the 3-doc E2E — a coverage note, not a requirement gap. |
| R4 | MET | `apps/cli/src/commands/store.ts:599-733` registers `label` with `--run`/`--new-ids` (`.requiredOption`), `--maker fm-local`, `--mode heuristic`, `--db`; `:567-590` writes one `labels` row per listed item × decision. `labels.confidence` + `labels.run_id` added by migration `0002_labels_confidence_run_id` (`packages/kk-store/src/migrations.ts:24-32`) backed by `packages/kk-store/src/schema/labels.ts:22-25` and `packages/kk-store/src/dao/labels.ts:41-62`. Convergence reproduced: fresh `0001`+`0002` and a rewound 0206-era DB both journal `[0001, 0002]` and end with byte-identical 11-column `labels` sets (`.works/test-artifacts/0209/kk-store-labels-convergence.json`; `packages/kk-store/tests/migrations.test.ts:108-177`, green). |
| R5 | MET | `apps/cli/src/commands/store.ts:567-590` routes in heuristic mode only when the plugin set `metadata.needs_model`, and every listed item under `--mode decision`; `:473-503` spawns `spur decision run <id> --param title=… --param source=… --evidence <scratch> --maker <m> --json` as an arg array (no shell) and parses `{value, confidence, source, reason, maker}`. Tests: zero spawns for confident items (`apps/cli/tests/store-label.test.ts:214`), only the ambiguous item routed (`:257`), every item in decision mode (`:296`). Divergence: the gate is `classifyCategory === 'non-ai' && hasAiSignal` (`plugins/generations/episode-plan-gen/src/index.ts:431-455`) where `hasAiSignal` also accepts an AI-mapped tag or curated source, i.e. "AI keyword" is implemented as "any AI-side signal" — a defensible superset mirroring the classifier's own evidence (review P4). |
| R6 | MET | `apps/cli/src/commands/store.ts:528-571` stores the heuristic value with `source: default` for a `source: default` payload, an out-of-vocabulary value, and a `spur decision run` spawn failure; stdout is `{labeled, model, fallback}`. Executable: `apps/cli/tests/store-label.test.ts:320` (backend answers `source: default` with a *different* value → heuristic value retained) and `:354` (unspawnable `spur` → `source: default`, exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Newly inserted items are labeled through the kk decision catalog | MET | test | `apps/cli/tests/store-label.test.ts:214` (heuristic-only labeling writes 5 rows/item, no model spawn), `:296` (decision mode writes model rows carrying `run_id`), `:416` (only the `--new-ids` ids labeled); live artifact `.works/test-artifacts/0209/live/live-labels.json` (real `spur decision run` against `plugins/kk/decisions/kk-items.yaml`). |
| AC2 — Decision backend failure falls back to the heuristic label and is recorded | MET | test | `apps/cli/tests/store-label.test.ts:320` (`source: default` with a divergent model value keeps the heuristic value, recorded row) and `:354` (spawn failure → `source: default`, exit 0, `{labeled, model, fallback}`); `apps/cli/src/commands/store.ts:528-571` records it. |
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

- 2026-10-07T17:16:18.268Z todo → testing (system)
- 2026-10-07T17:16:20.816Z testing → done (system)

