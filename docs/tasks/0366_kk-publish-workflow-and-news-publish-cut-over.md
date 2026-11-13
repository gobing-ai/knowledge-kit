---
schema_version: 1
name: kk-publish workflow and news publish cut-over
status: backlog
template: feature-impl
created_at: 2026-11-13T18:13:39.870Z
updated_at: "2026-11-13T18:18:15.348Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0364", "0365"]
---

## 0366. kk-publish workflow and news publish cut-over

### Background

Phase 3 of G61 (ADR-053 §1, §7). Frozen contract: `docs/design/content-pipeline-consolidation.md` §5.3 (the nine nodes of `kk-publish` and the fate of all 18 nodes of `kk-daily-publish3.yaml`). Today `plugins/kk/workflows/kk-daily-publish3.yaml` has 18 nodes, nine of which are sub-second `jq`/`printf`/stage padding, and it is the only way to publish a news bundle. This task writes `kk-publish.yaml` on top of the 0364 step verbs, proves it against a news bundle and a hand-built article bundle in dummy mode, and proves single-channel re-send.

Out of scope: deleting `kk-daily-publish3.yaml` or changing the scheduler (0369); article generation writing a bundle (0368); any live send.

### Requirements

- [ ] R1. New `plugins/kk/workflows/kk-publish.yaml`: DAG with exactly the nine nodes of design §5.3 — `plan`, `check`, `send-confirm`, `send`, `send-retry`, `diagnose`, `repair`, `settle`, `report` — declared in topological order. Vars: `work_dir`, `run_date`, `window`, `preset`, `channels`, `live_channels`, `live_confirm`, `dummy`, `agent` (default `inline`). No var has an empty default that the engine would reject; optional flags are assembled inside the node command from non-empty vars.
- [ ] R2. Every non-agent, non-pause node's command is one `kk ${vars.noun} publish-<step> --work-dir … --window …` call — no `jq`, `printf`, `kk stage run`, or multi-command shell. `noun` is a var (`news` | `article`, default `news`) set by the launching verb.
- [ ] R3. Conditions and error policy as design §5.3: `send-confirm` only when `live_confirm=true` and the plan has live rows; `send` continues on failure; `send-retry` only when `send` left failed rows; `diagnose` (agent, role `scribe`, `agent: ${vars.agent}`) and `repair` only on an RSS-gate miss for window `overseas-rss`; `settle` exit 1 fails the run; `report` runs after `settle` regardless of its result.
- [ ] R4. `kk news publish` and `kk article publish` (0365) launch `kk-publish` by default and pass `noun`.
- [ ] R5. Re-send: `publish --channels <id> --retry` against a settled work dir dispatches only that row, writes its receipt into the same `4-publish/receipts/`, and the new `plan.<window>.json` lists every other row in `excluded[]` with reason `not in --channels list`.
- [ ] R6. New `apps/cli/tests/kk-publish-dag.test.ts` asserts the node set, order, vars and that no node command matches `/kk stage run|jq |printf /`.
- [ ] R7. Equivalence: for the news fixture bundle and each window (`after-generate`, `cn-peak`, `overseas-rss`) in dummy mode, the set of files under `4-publish/` and the parsed `outcome.<window>.json` equal what `kk-daily-publish3.yaml` produces on the same inputs (timestamps and run ids normalised).
- [ ] R8. `docs/04_DESIGN.md` §1.14 lists `kk-publish` as shipped; `docs/design/kk-daily-ai-voice3.md` gains a one-line pointer that publish3 is superseded pending 0369. Same commit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Both content types publish through one workflow (req: R1, R2, R3, R4, R6)
  Given a frozen news bundle and a frozen article bundle
  When each is published in dummy mode through `kk-publish.yaml` via `kk news publish --dummy` and `kk article publish --dummy`
  Then both produce receipts of the same schema in their own work dirs
  And both runs executed the same node ids and kk-publish-dag.test.ts passes

Scenario: AC2 — One channel is re-sent without regenerating (req: R5)
  Given a settled article bundle with one failed channel
  When `kk article publish --channels <that channel> --retry --dummy` runs
  Then only that row is dispatched, in the same work dir, and the plan records the override
  And no file outside 4-publish/ and 5-report/ has a newer mtime than before the command

Scenario: AC3 — The nine-node workflow matches the eighteen-node one (req: R7)
  Given the news fixture bundle
  When each of the three windows is published in dummy mode through kk-daily-publish3.yaml and through kk-publish.yaml
  Then the file sets and normalised outcomes are equal per window
  And the test writes .works/tmp/test-kk-publish/summary.json with both file lists per window

Scenario: AC4 — Gate (req: R8)
  Given the change is applied
  When `bun run lint && bun run test && bun run build` run
  Then all exit 0
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T18:17:31.981Z

- **Why is the article bundle hand-built here?** Article generation does not write a bundle until 0368. A fixture built with `kk article new --from` plus a minimal `bundle.json` proves the publish half now; 0368 proves the generated one.
- **What does "the RSS-gate miss" read?** `publish-plan` stdout `gate.rss` is also persisted in `4-publish/rss-gate.json`; the node condition reads the file, as publish3 does today.
- **Is anything sent live in this task?** No. Every test and manual check uses `--dummy`. The first live run is the operator's, in 0369.
- **Editing a workflow needs authorization** (project safety rule): creating `kk-publish.yaml` is this task's stated scope; `kk-daily-publish3.yaml` is not edited.
- **Tests first.** The DAG test and the three e2e scenarios exist and fail before the YAML is written.

### Design

Owned files:

| File | Change |
| --- | --- |
| `plugins/kk/workflows/kk-publish.yaml` | new |
| `apps/cli/src/commands/content-launch.ts` | default publish workflow → `kk-publish`, pass `noun` (shared with 0365 — dependency) |
| `apps/cli/tests/kk-publish-dag.test.ts`, `apps/cli/tests/kk-publish.e2e.test.ts`, `apps/cli/tests/fixtures/article-bundle/` | new |
| `docs/04_DESIGN.md`, `docs/design/kk-daily-ai-voice3.md` | R8 |

Engine facts to respect: nodes in topological order; a node is skipped only when all its dependencies are skipped; no `finally` (cleanup is the launcher's); `pause: true` for `send-confirm`.

### Plan

1. Write `kk-publish-dag.test.ts` and `kk-publish.e2e.test.ts` (AC1–AC3) with the fixtures; confirm they fail.
2. Write `kk-publish.yaml` node by node from design §5.3.
3. Switch the default in `content-launch.ts` (R4).
4. Run the e2e file; then the existing `kk-daily-publish3.test.ts` unchanged.
5. Sync the workflow into the installed package only if the operator asks; note in Testing that the scheduled jobs still use publish3.
6. Docs; `bun run lint && bun run test && bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/content-pipeline-consolidation.md` §5.3, §6. Decision: ADR-053 §1, §7; ADR-043.
- Depends on: 0364, 0365. Blocks: 0367, 0368, 0369.
- Parent feature: G61, scenarios "Both content types publish through one workflow", "One channel is re-sent without regenerating".

### History
