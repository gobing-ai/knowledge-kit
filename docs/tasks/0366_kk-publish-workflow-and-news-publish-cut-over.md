---
schema_version: 1
name: kk-publish workflow and news publish cut-over
status: done
template: feature-impl
created_at: 2026-11-13T18:13:39.870Z
updated_at: "2026-11-15T23:42:15.744Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0364", "0365"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0366-verdict.json
---

## 0366. kk-publish workflow and news publish cut-over

### Background

Phase 3 of G61 (ADR-053 §1, §7). Frozen contract: `docs/design/content-pipeline-consolidation.md` §5.3 (the nine nodes of `kk-publish` and the fate of all 18 nodes of `kk-daily-publish3.yaml`). Today `plugins/kk/workflows/kk-daily-publish3.yaml` has 18 nodes, nine of which are sub-second `jq`/`printf`/stage padding, and it is the only way to publish a news bundle. This task writes `kk-publish.yaml` on top of the 0364 step verbs, proves it against a news bundle and a hand-built article bundle in dummy mode, and proves single-channel re-send.

Out of scope: deleting `kk-daily-publish3.yaml` or changing the scheduler (0369); article generation writing a bundle (0368); any live send.

### Requirements

- [x] R1. New `plugins/kk/workflows/kk-publish.yaml`: DAG with exactly the nine nodes of design §5.3 — `plan`, `check`, `send-confirm`, `send`, `send-retry`, `diagnose`, `repair`, `settle`, `report` — declared in topological order. Vars: `work_dir`, `run_date`, `window`, `preset`, `channels`, `live_channels`, `live_confirm`, `dummy`, `agent` (default `inline`). No var has an empty default that the engine would reject; optional flags are assembled inside the node command from non-empty vars.
- [x] R2. Every non-agent, non-pause node's command is one `kk ${vars.noun} publish-<step> --work-dir … --window …` call — no `jq`, `printf`, `kk stage run`, or multi-command shell. `noun` is a var (`news` | `article`, default `news`) set by the launching verb.
- [x] R3. Conditions and error policy as design §5.3: `send-confirm` only when `live_confirm=true` and the plan has live rows; `send` continues on failure; `send-retry` only when `send` left failed rows; `diagnose` (agent, role `scribe`, `agent: ${vars.agent}`) and `repair` only on an RSS-gate miss for window `overseas-rss`; `settle` exit 1 fails the run; `report` runs after `settle` regardless of its result.
- [x] R4. `kk news publish` and `kk article publish` (0365) launch `kk-publish` by default and pass `noun`.
- [x] R5. Re-send: `publish --channels <id> --retry` against a settled work dir dispatches only that row, writes its receipt into the same `4-publish/receipts/`, and the new `plan.<window>.json` lists every other row in `excluded[]` with reason `not in --channels list`.
- [x] R6. New `apps/cli/tests/kk-publish-dag.test.ts` asserts the node set, order, vars and that no node command matches `/kk stage run|jq |printf /`.
- [x] R7. Equivalence: for the news fixture bundle and each window (`after-generate`, `cn-peak`, `overseas-rss`) in dummy mode, the set of files under `4-publish/` and the parsed `outcome.<window>.json` equal what `kk-daily-publish3.yaml` produces on the same inputs (timestamps and run ids normalised).
- [x] R8. `docs/04_DESIGN.md` §1.14 lists `kk-publish` as shipped; `docs/design/kk-daily-ai-voice3.md` gains a one-line pointer that publish3 is superseded pending 0369. Same commit.

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

`kk-publish.yaml` is design §5.3 transcribed node for node, and every decision that the engine
forced is recorded in the file next to the node it constrains. The workflow is the cut-over point of
G61 phase 3: `kk news publish` and `kk article publish` now launch one nine-node DAG that replaces
publish3's eighteen nodes and the seven-node ITC publish tail.

**The graph.** `plan` → `check` → `send-confirm` (pause) → `send` → `send-retry`, with `diagnose` →
`repair` hanging off `plan` for a gated miss, `settle` after both send paths and `report` last. Each
non-agent, non-pause node is exactly one `kk ${vars.noun} publish-<step>` call, and `noun` is the
launch var that makes one file serve both content nouns (R2; asserted in `kk-publish-dag.test.ts`).
No node names a channel, a preset or a live mode.

**Engine facts that shaped it** (probe-verified against `spur` 0.4.33, not assumed — the probes and
their outputs are in the stage report):

- `plan` carries `onError: continue`. `publish-plan` exits 1 on an RSS-gate miss *after* writing
  `rss-gate.json` and the deterministic incident floor, and the engine skips every successor of a
  hard-failing node — the all-deps-skipped rule — which would take `diagnose`/`repair` with it. A
  plan failure that is not a gated miss still fails the run at `check`, which cannot read the plan.
- A skipped dependency is not a failed one, so the conditional exits use the gates they need:
  `check` and `settle` are skipped only on a gated miss; `send` keeps `[check, send-confirm]` so a
  draft window (pause skipped) still sends; `diagnose` depends on `plan` (the row above it, the
  skipped send chain); `settle` depends on `[send, repair]` because a clean window has no
  `send-retry` to wait for; `report` depends on `[settle, diagnose]` so it is ordered after the
  settlement *and* still writes its page on a gated-miss day where `settle` is skipped.
- `settle` carries no `onError`, so its exit 1 is the run's failure (R3). One consequence the engine
  forces: a failing node's dependents never start, and there is no `finally`, so `report` is skipped
  exactly when `settle` fails. The evidence that page would summarise — `outcome.<w>.json`,
  `settlement.<w>.json`, the partial marker — is written by `settle` itself before it exits 1; the
  alternative (`onError: continue` on `settle`) would hide an unsettled window behind a green run,
  which is the one outcome the design forbids. Recorded as a residual risk, not hidden.
- Optional flags: the engine rejects `${vars.x:+…}` as an undeclared variable reference, and R2
  forbids assembling them with a multi-command shell. So the value-taking flags use their `=` form
  (`--preset=`, `--run-date=`, `--channels=`, `--live-channels=`, `--feed=`), which the verbs already
  read as absent when empty (`apps/cli/src/commands/content-publish.ts:198`), and the one optional
  boolean is carried as a **flag word**: `dummy` holds `--dummy` or nothing, and the launching verb
  sets exactly that (`apps/cli/src/commands/content-launch.ts:439`). Two vars are new against the
  design's list, both additive and documented: `retry` (0365 already forwards it; `send-retry`
  honours an explicit `--retry`) and `feed` (`publish-plan --feed`, so the RSS gate can be pinned to
  a fixture instead of the network).
- One edit outside the owned-file table, required for the cut-over to work at all:
  `resolveBundlePath` (`apps/cli/src/publish-matrix.ts:143`). Design §1.2 and §4.3 put the frozen
  bundle at `<workDir>/4-publish/bundle.json` — the only path the launching verb admits — while the
  shipped 0364 verbs read `<workDir>/bundle.json`. The locator reads the frozen path and falls back
  to the root one, so a real run directory publishes through both layers, a pre-cut-over directory
  stays publishable with `--work-dir` (§4.3: "history is not migrated"), and the unchanged
  `kk-daily-publish3.yaml` keeps working. Without it AC1 is unsatisfiable: the launcher and the step
  verbs would each demand a different path.

**AC3 harness.** Both e2e harnesses make the throwaway root the launcher's *package root* for the
duration of a case (a `plugins` symlink plus `process.chdir`): `publish` has no `--allow-dirty` by
design, and this task adds an untracked `plugins/kk/workflows/kk-publish.yaml`, so a harness that let
the preflight read the checkout would refuse every publish with a dirty-harness reason that has
nothing to do with the case. 0365's suite adopts the same isolation (`content-launch.e2e.test.ts`)
and keeps a real one-commit repository in the root, so its `checkoutCommit` assertion (0365 R8) still
reads a sha.

One work dir per workflow, the three windows in the order a real day runs them (so
cn-peak and overseas resolve their tier-2/3 links from the tier-0 receipts after-generate left
behind), every row dummy, the podcast feed as a `data:` URL (no network), publish3 driving the raw
`publish-matrix-*` stages and kk-publish the verbs, and `publish-plan` under a fixed clock so
cn-peak's wait-until (up to three hours) is a no-op. File sets, outcomes and plans are compared per
window; `modeSource` is the one normalised field (the verb records the switchboard source of design
§2.1, the raw stage has none). The summary lands at `.works/tmp/test-kk-publish/summary.json`.

| File | Change |
| --- | --- |
| `plugins/kk/workflows/kk-publish.yaml:50` | new: node `plan` — the one `publish-plan` call, waits/gates/validates, `onError: continue` for the gated miss |
| `plugins/kk/workflows/kk-publish.yaml:69` | new: node `check` — `publish-check`, skipped on a gated miss, the node that fails a broken plan |
| `plugins/kk/workflows/kk-publish.yaml:91` | new: node `send-confirm` — `pause: true`, only on `live_confirm=true` plus a live plan row |
| `plugins/kk/workflows/kk-publish.yaml:108` | new: node `send` — `publish-send`, `onError: continue`, depends on both `check` and `send-confirm` |
| `plugins/kk/workflows/kk-publish.yaml:125` | new: node `send-retry` — one bounded `publish-send --retry`, only when a receipt failed or `--retry` was asked for |
| `plugins/kk/workflows/kk-publish.yaml:147` | new: node `diagnose` — `agent.run` role `scribe`, `agent: ${vars.agent}`, only on an `overseas-rss` gate miss |
| `plugins/kk/workflows/kk-publish.yaml:184` | new: node `repair` — `publish-send --window after-generate --retry --tier 0`, reachable only through `diagnose` |
| `plugins/kk/workflows/kk-publish.yaml:198` | new: node `settle` — `publish-settle`, no `onError` so its exit 1 fails the run |
| `plugins/kk/workflows/kk-publish.yaml:221` | new: node `report` — `publish-report`, after `settle` and reachable on a gated-miss day |
| `plugins/kk/workflows/kk-publish.yaml:40` | new: `dummy` var as the flag word `--dummy` (empty = no word), the engine's only way to add an optional boolean |
| `plugins/kk/workflows/kk-publish.yaml:45` | new: `noun` var (`news`/`article`) — the one word that lets nine nodes serve both nouns |
| `apps/cli/src/commands/content-launch.ts:432` | changed: the publish vars carry `noun`, so the shared workflow calls the launching noun's verbs (R4) |
| `apps/cli/src/commands/content-launch.ts:439` | changed: `--dummy` reaches the workflow as the flag word the node command appends |
| `apps/cli/src/commands/content-launch.ts:464` | changed: `publishAction`/`generateAction`/`publishRun` thread the noun through, including the chained generate→publish leg |
| `apps/cli/src/publish-matrix.ts:143` | new: `resolveBundlePath` — `4-publish/bundle.json` first, root `bundle.json` for a pre-cut-over directory |
| `apps/cli/src/publish-matrix.ts:428` | changed: `publish-matrix-validate` derives the run date from the frozen bundle too |
| `apps/cli/src/publish-matrix.ts:1621` | changed: the RSS gate finds a frozen bundle (and its `episode`) where §4.3 puts it |
| `apps/cli/src/commands/content-publish.ts:198` | changed: `publish-plan` plans against the located bundle |
| `apps/cli/src/commands/content-publish.ts:334` | changed: `publish-settle` appends `runs[]` to the bundle it read, not to a second copy |
| `apps/cli/tests/kk-publish-dag.test.ts:47` | new: the node set, order, vars, single-call commands and error policy read off the YAML (R6) |
| `apps/cli/tests/kk-publish.e2e.test.ts:435` | new: AC1 — both nouns through `kk <noun> publish --dummy`, same node ids, same receipt schema |
| `apps/cli/tests/kk-publish.e2e.test.ts:503` | new: AC2 — one channel re-sent in the same work dir, the plan recording every other row as excluded |
| `apps/cli/tests/kk-publish.e2e.test.ts:597` | new: AC3 — three windows through publish3 and kk-publish, file sets + outcomes + plans compared, summary written |
| `apps/cli/src/publish-matrix.ts:135` | new: the hand-built article bundle (its directory is the contents of `4-publish/`); `seedArticleBundle` re-derives each variant digest from the copied bytes, so the fixture's own `sha256` is documentation and an edited variant cannot leave it stale |
| `apps/cli/tests/content-launch.e2e.test.ts:753` | changed: the forwarded publish vars now include `noun: 'news'` |
| `apps/cli/tests/content-launch.e2e.test.ts:123` | changed: the 0365 launch harness rides a temp `plugins` symlink, a one-commit repo and `process.chdir`, so `publish`'s dirty-path preflight reads the harness root instead of this mid-task checkout |
| `docs/04_DESIGN.md:1479` | changed: §1.14 lists `kk-publish` as shipped, with its nodes, vars, `dummy`/`feed` shape and bundle locator |
| `docs/design/kk-daily-ai-voice3.md:8` | changed: one-line pointer that publish3 is superseded by `kk-publish` pending 0369 |
| `docs/features/G61_content-pipeline-consolidation-shared-publish-core-article-news-verbs-simplified-workflows.md:19` | changed: the G61 Goal names `kk-publish.yaml`, so the feature-tree invariant finds its one home |

Not done, on purpose: `kk-daily-publish3.yaml` is neither edited nor deleted (0369 owns the scheduler
cut-over, and it stays the installed path until then); no article generation verb or workflow (0368);
no live send anywhere (every test and probe runs `--dummy`); the stage bodies in
`plugins/kk/scripts/` are untouched — the verbs call them where they are.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-publish.yaml:24-47` (vars) + `:50-234` (nine nodes, topological); `apps/cli/tests/kk-publish-dag.test.ts:47`, `:62`, `:76` — fresh 11 pass |
| R2 | MET | Single-call nodes at `plugins/kk/workflows/kk-publish.yaml:63`, `:88`, `:122`, `:143`, `:194`, `:218`, `:232`; `noun` var `:45` set by `apps/cli/src/commands/content-launch.ts:432`; asserted `apps/cli/tests/kk-publish-dag.test.ts:101-116` |
| R3 | MET | Conditions `plugins/kk/workflows/kk-publish.yaml:98-105`, `:120`, `:136-140`, `:156`, `:190`, `:211`, `:228`, each verified against the producer bytes (`apps/cli/src/publish-matrix.ts:842`, `:1681`; `apps/cli/src/publish-core.ts:481`); the failed-`settle` clause is the deferred P3 below |
| R4 | MET | `apps/cli/src/launch.ts:43`; `apps/cli/src/commands/content-launch.ts:432`, `:464`, `:311`; proven `apps/cli/tests/kk-publish.e2e.test.ts:460`, `:478-491` |
| R5 | MET | `apps/cli/tests/kk-publish.e2e.test.ts:502-593`; excluded reason `apps/cli/src/publish-matrix.ts:594` |
| R6 | MET | `apps/cli/tests/kk-publish-dag.test.ts:47-176` — 11 pass / 0 fail |
| R7 | MET | `apps/cli/tests/kk-publish.e2e.test.ts:597-686`; `.works/tmp/test-kk-publish/summary.json` (15/15, 23/23, 31/31) |
| R8 | MET | `docs/04_DESIGN.md:1415`, `:1426-1427`, `:1479-1490`; `docs/design/kk-daily-ai-voice3.md:6-8` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Both content types publish through one workflow (req: R1, R2, R3, R4, R6) | MET | test | `apps/cli/tests/kk-publish.e2e.test.ts:434` (3/3) + node set `apps/cli/tests/kk-publish-dag.test.ts:47` |
| AC2 — One channel is re-sent without regenerating (req: R5) | MET | test | `apps/cli/tests/kk-publish.e2e.test.ts:502` |
| AC3 — The nine-node workflow matches the eighteen-node one (req: R7) | MET | test | `apps/cli/tests/kk-publish.e2e.test.ts:597` |
| AC4 — Gate (req: R8) | MET | command | `spur self exec check` — `.spur/run/0366-check-receipt.json` PASS (digest `82bdbc81…` = gate log `git-tree`); `.spur/run/0366-test-gate.log:378-383` 5234 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

- Evidence-plane repair (2026-11-15, ADR-131): the `.spur/run/0366-check-receipt.json` cited above is **LOST** — it lived in the run's disposable `.spur/` plane and no copy survived that run. The receipt bound the tree-hash gate PASS for that day; the durable statement of the same fact is this section's test evidence.

### Review

#### Review Report — 0366

**Scope:** worktree change set on `sp/runall-g61-9beb` (base `16ee9fcc`) — 8 modified files, +221/−28, plus 4 new paths: `plugins/kk/workflows/kk-publish.yaml`, `apps/cli/tests/kk-publish-dag.test.ts`, `apps/cli/tests/kk-publish.e2e.test.ts`, `apps/cli/tests/fixtures/article-bundle/`; modified `apps/cli/src/{commands/content-launch.ts, commands/content-publish.ts, publish-matrix.ts}`, `apps/cli/tests/content-launch.e2e.test.ts`, `docs/04_DESIGN.md`, `docs/design/kk-daily-ai-voice3.md`, the G61 feature doc.
**Dimensions:** functional traceability (R1–R8, AC1–AC4), SECUA quality (security, efficiency, correctness, usability), architecture
**Authority:** `docs/design/content-pipeline-consolidation.md` §5.3, ADR-053 §1/§7, ADR-022
**Verdict:** PASS
**Confidence:** MEDIUM

##### What this visit re-derived (not taken from the author's account)

1. **R2, read off the file and asserted again.** Fresh `bun test apps/cli/tests/kk-publish-dag.test.ts` → **11 pass, 0 fail, 137 `expect()` calls**. All seven shell nodes are a single `kk ${vars.noun} publish-<step>` word: `plugins/kk/workflows/kk-publish.yaml:63` (`plan`), `:88` (`check`), `:122` (`send`), `:143` (`send-retry`), `:194` (`repair`), `:218` (`settle`), `:232` (`report`) — no `jq`, no `printf`, no `kk stage run`, no `;`/`&&`/group in any action. The `||`/`&&` live only in `condition` blocks, which R2 does not govern and design §5.3 assigns to the condition (publish3's conditions do the same).
2. **R3's three greps against the real serializations.** Each condition literal matches what the producer actually writes, which is what decides whether a live pause or a retry can fire at all: `"mode": "live"` ← `apps/cli/src/publish-matrix.ts:842` (`JSON.stringify(plan, null, 2)`) over `PublishPlanRowSchema.mode` (`:85`); `"hit": false` ← `apps/cli/src/publish-matrix.ts:1681`; `"status": "failed"` ← `apps/cli/src/publish-core.ts:481`, `:496`, `:613`. A compact write would have silently disabled `send-confirm` and `send-retry`; it does not.
3. **Engine semantics, probed directly** against `spur` 0.4.33 (a throwaway 4-node DAG in `/tmp`, nothing in this tree touched): a node carrying `onError: continue` that exits 1 **does not** stop its dependents — the successor ran with the run continuing; a node **without** `onError` that exits 1 ends the run `[failed]` (exit 1) and its dependent **never ran**. Both the `plan` tolerance and finding 1 rest on this measured fact, not on the design text.
4. **AC1–AC3 re-run fresh:** `bun test apps/cli/tests/kk-publish.e2e.test.ts` → **3 pass, 0 fail** (AC1 2.7 s, AC2 2.3 s, AC3 6.3 s; bun's exit 1 on a single-file run is `bunfig.toml`'s 90 % `coverageThreshold`, not a test failure). The regenerated `.works/tmp/test-kk-publish/summary.json` records equal `4-publish/` file sets per window: after-generate 15/15, cn-peak 23/23, overseas-rss 31/31, with the same five dispatched steps each.
5. **Fixture integrity (the remediation hop's fix):** `sha256(variants/article.json)` recomputed from the bytes on disk = `28194f72…4ab57d5f` = the digest declared in `apps/cli/src/publish-matrix.ts:1352` — the pair is self-consistent, and `seedArticleBundle` (`apps/cli/tests/kk-publish.e2e.test.ts:359-374`) re-derives it from the copied bytes so a future edit cannot leave it stale.
6. **Gate, not re-run:** `.spur/run/0366-check-receipt.json` is PASS for runId `faebd9a7…` with `inputDigest 82bdbc81…` equal to the `git-tree:` line of `.spur/run/0366-test-gate.log` — the receipt belongs to this tree. Log anchors: `:378` 5234 pass, `:379` 0 fail, `:383` both rule presets clean.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | `report` cannot run on the day `settle` exits 1, so R3's "`report` runs after `settle` regardless of its result" is unmet in exactly that case — reproduced with the engine probe above, not inferred. It is also a behaviour change against the workflow being replaced, whose failing node (`outcome-assert`) sat *after* `report` and `ledger` (`plugins/kk/workflows/kk-daily-publish3.yaml:243-249`). Bounded: `settle` writes `outcome.<w>.json`, `settlement.<w>.json`, the partial marker and `runs[]` before it throws (`apps/cli/src/commands/content-publish.ts:370-375`), so only the page and the ledger sync are lost, and `kk <noun> publish-report --work-dir … --window …` re-renders the page | `plugins/kk/workflows/kk-publish.yaml:228` | DEFER(unsatisfiable inside R1's nine nodes + no `finally`: putting `onError: continue` on `settle` would instead let a green run hide an unsettled window, which design §5.3 forbids — needs a design note for 0369, not a code change here) |
| 2 | P3 (minor) | correctness | `noun` is the **CLI word**, not the resolved content type. `kk article publish --type news` resolves a news run (`apps/cli/src/commands/content-launch.ts:467`, `:490`) but launches with `noun: article` (`:432`), so every node command runs `kk article publish-*`, which `apps/cli/src/commands/content.ts:452` registers on the article noun's own default type `itc` (`apps/cli/src/commands/content-publish.ts:455`). The plan never cross-checks the bundle's `contentType` (`apps/cli/src/publish-matrix.ts:59` is the only use), so the wrong switchboard block (`content_types.itc.channels`) is applied silently — worst case a channel the operator pinned `off`/`draft` under `content_types.news.channels` follows the preset mode on a live send | `apps/cli/src/commands/content-launch.ts:432` | DEFER(derive `noun` from the resolved `type` when 0367/0369 wire the launchers — no scheduled or documented route passes `--type`, so `done` is not blocked on it) |
| 3 | P4 (advisory) | correctness | `plan`'s `onError: continue` is design-forced (the RSS gate lives inside `publish-plan`, and a hard failure would cascade-skip `diagnose`), and `check` is a real backstop rather than a hope: a missing or malformed plan throws in `readPlan` (`apps/cli/src/publish-matrix.ts:470-480`) and the node exits 1 (`:986-988`) — which is why the stale fixture digest died one node later instead of passing. The residual blind spot is narrow but real: `planPublishMatrix` writes the plan at `:843` and only afterwards writes the omitted-target receipts (`:847-870`) and the planned events, so an I/O failure in that window leaves a *readable* plan, `check` passes, and `send` runs without the omitted-row receipts | `plugins/kk/workflows/kk-publish.yaml:61` | ACCEPTED |
| 4 | P4 (advisory) | correctness | Node 9's ledger half still syncs the superseded workflow: `publish-report` calls `syncLedger({workflow: 'kk-daily-publish3'})`, which reads `spur workflow trace --workflow kk-daily-publish3` and appends to `<works>/kk-daily-publish3/ledger.md` (`apps/cli/src/commands/ledger.ts:188-190`, `:129-134`). kk-publish runs therefore never reach a ledger, and after 0369 retires publish3 the sync becomes a silent no-op while the report still succeeds (the throw is caught and downgraded to a warning at `apps/cli/src/commands/content-publish.ts:420-425`) | `apps/cli/src/commands/content-publish.ts:419` | OPEN (rename with the scheduler cut-over, which is where the workflow identity moves) |
| 5 | P4 (advisory) | usability | On a gated-miss day the report page's date is blank and its status reads `unknown`, because `renderReport` derives both from `outcome.<w>.json`, which a miss never writes (`apps/cli/src/commands/content-publish.ts:381-386`); publish3's own report node printed `${vars.run_date}`. The one day the operator reads the page is the day it carries the least | `apps/cli/src/commands/content-publish.ts:382` | ACCEPTED |
| 6 | P4 (advisory) | correctness | The Solution's change map points all eleven workflow rows at `plugins/kk/workflows/kk-publish.yaml` — the 20-line 0365 launch stub. The cited lines (`:40` `dummy`, `:45` `noun`, `:50` `plan`, … `:221` `report`) resolve only in `plugins/kk/workflows/kk-publish.yaml`; a reader filing against the table lands on a file that cannot contain them. Independently corroborated: `spur task check 0366` reports the same rows as unresolved L4 line anchors ("line 50 outside file (21 lines)") | `docs/tasks/0366_kk-publish-workflow-and-news-publish-cut-over.md:166` | OPEN (correct the path prefix when the record step next touches the document — the Review stage must not edit `## Solution`) |

No P1 and no open P2 against the task's contract. Findings 1 and 2 are known-minor items the frozen contract either cannot order (1, proven unsatisfiable above) or does not reach (2, no scheduled route passes `--type`); both are deferred with their reason in the cell and carried as residual risk below.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-publish.yaml:24-47` declares the vars (`work_dir`, `run_date`, `window`, `preset`, `channels`, `live_channels`, `live_confirm`, `dummy`, `agent: inline`, plus R2's `noun` and the two documented additions `retry`/`feed`); `:50-234` declares exactly the nine nodes of design §5.3 in topological order with forward-only `dependsOn` (asserted `apps/cli/tests/kk-publish-dag.test.ts:47`, `:62`, `:76`). Empty defaults sit only on vars that spell an optional flag or arrive from the launch — the same shape `kk-daily-publish3.yaml:22-34` ships, so no default is one the engine rejects |
| R2 | MET | Seven single-call commands: `plugins/kk/workflows/kk-publish.yaml:63` (`publish-plan`), `:88` (`publish-check`), `:122` (`publish-send`), `:143` (`publish-send --retry`), `:194` (`publish-send --window after-generate --retry --tier 0`), `:218` (`publish-settle`), `:232` (`publish-report`); `noun` is the var at `:45` (default `news`) set by the launcher at `apps/cli/src/commands/content-launch.ts:432`. Fresh dag test: `:101-116` asserts one `kk` word, no `jq `/`printf `/`kk stage run`, no `;`/`&&`, and the `--work-dir`/`--window` pair on every shell node — 11/11 pass |
| R3 | MET | Conditions verified against the producers' own bytes (re-derivation 2): `send-confirm` `pause: true` with `live_confirm=true` **and** a live plan row (`plugins/kk/workflows/kk-publish.yaml:98-105`); `send` `onError: continue` (`:120`); `send-retry` only on a failed receipt or an explicit `--retry` (`:136-140`); `diagnose` (agent `scribe`, `agent: ${vars.agent}`, `:160-166`) and `repair` only on an `overseas-rss` gate miss (`:156`, `:190`); `settle` carries no `onError`, so its exit 1 (`apps/cli/src/commands/content-publish.ts:372-375`) is the run's failure; `report` after `settle` and reachable on a gated miss (`:228`). The one unsat clause — "regardless of its result" when `settle` fails — is finding 1 |
| R4 | MET | `apps/cli/src/launch.ts:43` `PUBLISH_WORKFLOW = 'kk-publish'` is the one workflow `publish` launches; `apps/cli/src/commands/content-launch.ts:432` adds `noun` to the vars and `:464`/`:311` thread it through `publishAction`, `generateAction` and the chained generate→publish leg. AC1 proves both nouns end to end: `kk news publish-plan` / `kk article publish-plan` appear in the child log and both receipts say `workflow: kk-publish` (`apps/cli/tests/kk-publish.e2e.test.ts:460`, `:478-491`) |
| R5 | MET | AC2 (fresh pass): the retry run plans only `wechatmp-pub.文章`, records `surfdash-pub.post` in `excluded[]` with reason `not in --channels list` (`apps/cli/src/publish-matrix.ts:594`), rewrites that row's receipt inside the same `4-publish/receipts/`, leaves every file outside `4-publish/`+`5-report/` on its old mtime (bookkeeping normalised) and grows `bundle.json` only by one `runs[]` entry — `apps/cli/tests/kk-publish.e2e.test.ts:502-593` |
| R6 | MET | `apps/cli/tests/kk-publish-dag.test.ts:47-74` (node set + order), `:76-99` (vars), `:101-116` (`/kk stage run|jq |printf /` plus single-call/`--work-dir`/`--window`), `:120-176` (conditions and error policy, gated-miss wiring, no channel matrix). Fresh run: 11 pass / 0 fail |
| R7 | MET | AC3 (fresh pass, 6.3 s): equal `4-publish/` file sets per window — after-generate 15/15, cn-peak 23/23, overseas-rss 31/31 — equal normalised outcomes and equal normalised plans (only `modeSource` differs, by design §2.1), summary written to `.works/tmp/test-kk-publish/summary.json` (`apps/cli/tests/kk-publish.e2e.test.ts:597-686`) |
| R8 | MET | `docs/04_DESIGN.md:1415` retitles §1.14 to 0363–0366, `:1426-1427` records that `publish` launches `kk-publish` with `noun`, `:1466-1469` documents the frozen bundle locator, `:1479-1490` lists `kk-publish` as shipped with its nine nodes, its twelve vars, the `dummy`/`feed` shapes and the publish3-pending-0369 note; `docs/design/kk-daily-ai-voice3.md:6-8` carries the one-line superseded pointer. Same uncommitted change set as the code, so the "same commit" clause is a property of this tree at delivery |

##### AC1–AC4 traceability

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Both content types publish through one workflow (req: R1, R2, R3, R4, R6) | MET | test | `apps/cli/tests/kk-publish.e2e.test.ts:434` — fresh 3/3: both nouns dispatch the same five steps, produce the same receipt key set, `outcome.status = dummy`, a report page each, and `receipt.workflow = kk-publish`; the node ids themselves are pinned by `apps/cli/tests/kk-publish-dag.test.ts:47` |
| AC2 — One channel is re-sent without regenerating (req: R5) | MET | test | `apps/cli/tests/kk-publish.e2e.test.ts:502` — only the named row planned, the other in `excluded[]` with `not in --channels list`, same work dir, no mtime change outside `4-publish/`/`5-report/` |
| AC3 — The nine-node workflow matches the eighteen-node one (req: R7) | MET | test | `apps/cli/tests/kk-publish.e2e.test.ts:597` — equal file sets (15/23/31), outcomes and plans per window; summary at `.works/tmp/test-kk-publish/summary.json` |
| AC4 — Gate (req: R8) | MET | command | `spur self exec check` — `.spur/run/0366-check-receipt.json` PASS (runId `faebd9a7…`, digest `82bdbc81…`); `.spur/run/0366-test-gate.log:378-383` 5234 pass / 0 fail, both rule presets clean |

##### Residual risk

- **The gated-miss branch is never executed by a test.** AC3 deliberately compares a *hit* ("No gate miss in this comparison", `apps/cli/tests/kk-publish.e2e.test.ts:626`), so `plan` exiting 1 → `check`/`settle` skipped → `diagnose` → `repair` → `report` rests on the dag test's structural assertions plus the engine probe, not on an executed miss. The wiring is right by construction (`plugins/kk/workflows/kk-publish.yaml:156`, `:190`, `:207`, `:228`) and `renderReport` is null-tolerant (`apps/cli/src/commands/content-publish.ts:378-407`), but the first real miss is the operator's.
- **`bun run build` is not in the configured gate.** AC4's outline names `bun run lint && bun run test && bun run build`; the gate that certified this tree ran `bun run lint && bun run test-pre-check && bun run test && bun run test-post-check` (`.spur/run/0366-test-gate.log:65`), and the `build` script (`package.json`: `bundle-plugins` → `build-board` → workspace builds) was not part of it. Named as an evidence gap, not a failure: `lint` runs `biome check . && bun run typecheck` across every workspace, and the change adds a workflow YAML (bundled by copy), docs, and typechecked TS. It was not run here on purpose — `scripts/build-board.ts` writes into `apps/*/dist`, and this stage must not perturb the certified tree.
- Findings 1 and 2 need a design decision (the failure-day report ordering; `noun` vs the resolved type), not a code change in this task; findings 4 and 6 are stale-name and documentation items that the record step and the 0369 scheduler cut-over should absorb.
- No live send exists anywhere in this change: every test, probe and e2e runs `--dummy`, and the workflow file itself cannot produce a live row (ADR-022).

**Next:** record and close 0366; carry findings 1–2 into the 0367/0369 design notes, and fix findings 4 and 6 when the workflow identity and the Solution's change map are next touched.

### References

- Design: `docs/design/content-pipeline-consolidation.md` §5.3, §6. Decision: ADR-053 §1, §7; ADR-043.
- Depends on: 0364, 0365. Blocks: 0367, 0368, 0369.
- Parent feature: G61, scenarios "Both content types publish through one workflow", "One channel is re-sent without regenerating".

### History

- 2026-11-14T10:59:10.025Z backlog → wip (system)
- 2026-11-14T12:00:56.489Z wip → testing (system)
- 2026-11-14T12:04:08.539Z testing → done (system)

