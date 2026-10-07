---
schema_version: 1
name: "kk decision catalog and kk store label: heuristic-first item labeling"
status: todo
template: feature-impl
created_at: 2026-10-07T03:58:06.075Z
updated_at: "2026-10-07T05:06:45.073Z"
feature_id: G31
priority: P1
tags:
  - decision
  - labels
estimate_hours: 6

dependencies: ["0208"]
---

## 0209. kk decision catalog and kk store label: heuristic-first item labeling

### Background

Implements: R8 — Newly inserted items are labeled through the kk decision catalog; R9 — Decision backend failure falls back to the heuristic label and is recorded.

Design: docs/design/kk-collect-and-daily-voice2.md §4. Taxonomy source: episode-plan-gen MECE v1 categories + quality/importance/urgency/impact 0–5. Upstream spur feature P1 (decision production readiness) is still in progress — degrade path is mandatory.

### Requirements

- [ ] R1. Catalog `plugins/kk/decisions/kk-items.yaml` (`$schema: "@gobing-ai/spur/schemas/decision-catalog.schema.json"`, `version: 1`). Decision ids must match `^[a-z][a-z0-9_-]*$`, so they are dash-named:
  - `kk-item-category`: `type: choice`; criteria map `ai-news`, `ai-technical`, `ai-research`, `ai-industry`, `non-ai` (descriptions from `episode-plan-gen` `Category` docs); `fallback: non-ai`.
  - `kk-item-quality`, `kk-item-importance`, `kk-item-urgency`, `kk-item-impact`: `type: score`; criteria are an ordered list of 6 rubric strings (levels 0–5); `fallback: 2`.
  - Every decision declares parameters `title` (string) and `source` (string).
- [ ] R2. Register the catalog with `decisions.paths: [plugins/kk/decisions]` in `.spur/config.yaml`. `spur decision status --json` reports `ok: true`, empty `loadErrors`, and all five ids (there is no `spur decision validate` verb).
- [ ] R3. The heuristic stays owned by the plugin. `episode-plan-gen` gains `EPISODE_PLAN_MODE=label`, which classifies and scores every input Doc with no cap, dedup or filter, and returns `metadata.docs` with `metadata.category` and `metadata.scores` set. `kk store label` gets heuristic labels via `kk executor run episode-plan-gen` in that mode, so apps/cli never imports plugin source.
- [ ] R4. `kk store label --run <id> --new-ids <path> [--maker fm-local] [--mode heuristic|decision] [--db]` labels only the ids listed, writing one `labels` row per decision: `item_id`, `decision_id`, `value`, `maker`, `source` (heuristic | model | default), `confidence`, `run_id`, `labeled_at`.
- [ ] R5. In heuristic mode, only items the heuristic files as `non-ai` while matching an AI keyword go to `spur decision run <id> --param title=… --param source=… --evidence <tmp body file> --maker <m> --json`. In decision mode every new item goes. Results are parsed from `{ value, confidence, source, reason, maker }`.
- [ ] R6. A decision result with `source: default` (reason `no-backend` | `timeout` | `error` | `low-confidence`) stores the heuristic value with `source: default`. A spawn failure is treated the same, and the command exits 0. Output is `{labeled, model, fallback}`.

### Acceptance Criteria

- [ ] AC1 — Newly inserted items are labeled through the kk decision catalog
- [ ] AC2 — Decision backend failure falls back to the heuristic label and is recorded

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

### Plan

- [ ] Failure-first list (backend down, malformed decision JSON, value outside the choice set or the 0–5 range, empty body, catalog load error, the spur binary missing).
- [ ] `EPISODE_PLAN_MODE=label` in episode-plan-gen, with a test that 30 fixture docs come back uncapped with category + scores.
- [ ] Author the catalog and register the path; `spur decision status --json` is clean.
- [ ] `kk store label`; replace the `true` placeholder in kk-collect's `label` state.
- [ ] E2E `apps/cli/tests/store-label.test.ts`: seeded DB plus new-ids, `--maker typesafe` (no backend, so a deterministic fallback) → every row `source: default`, exit 0; heuristic-only run → zero spur spawns. Copy the labels table dump to `.works/test-artifacts/0209/`.
- [ ] `docs/04_DESIGN.md` rows; `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
