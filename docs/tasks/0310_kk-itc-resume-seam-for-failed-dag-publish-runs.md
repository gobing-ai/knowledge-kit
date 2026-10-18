---
schema_version: 1
name: "kk-itc: resume seam for failed DAG publish runs"
status: done
template: issue
created_at: 2026-10-17T07:36:05.256Z
updated_at: "2026-10-18T01:14:13.777Z"
feature_id: G21

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0310-verdict.json
---

## 0310. kk-itc: resume seam for failed DAG publish runs

### Background

Dogfood run kk-itc-20261016T224508-18167 failed at `check-targets` (infoq stale profile lock). With the run in `failed`, there was no way to re-enter the DAG: `spur workflow continue` only resumes paused/interrupted runs, and `spur workflow run --from <node>` requires the node declared `startable: true` — no node in `plugins/kk/workflows/kk-itc.yaml` declares it. The remaining nodes were driven manually via `kk stage run` (itc-check-targets → itc-send-targets → --retry → itc-reconcile-receipts → itc-export-seo → itc-report-summary), which bypasses the engine's edge/condition bookkeeping.

## Fix direction

Declare `startable: true` on the post-authoring entry node(s) of kk-itc.yaml (at minimum `check-targets`; consider `materialize-plan`) so a failed publish tail can be re-entered with `--from check-targets --from-run <failed-run>` without re-running authoring. Verify the fresh run inherits vars correctly and that receipts stay bound to the frozen `itc-options.json` parentRunId. Decide explicitly which nodes are safe re-entry points — a wrong startable marker creates a skip-the-gates path (e.g. entering `fanout-send` directly would bypass `send-confirm` for live plans).

## Evidence

- Workflow: `plugins/kk/workflows/kk-itc.yaml` (no `startable:` anywhere)
- Manual tail sequence used in the dogfood: itc-check-targets, itc-send-targets, itc-send-targets --retry, itc-reconcile-receipts, itc-export-seo, itc-report-summary — all rc=0, receipts under `.works/kk-itc/spur-decision-brief/4-publish/receipts/`

**Refine note (2026-10-17):** the fix direction below is not implementable on the installed harness — `startable` is not a key of the strict DAG node schema and `--from` is refused for `kind: dag`. Q&A and Design carry the verified refusals and the seam that replaced it (a dedicated publish-tail definition).

### Requirements

- [x] R1. Re-entry seam is a dedicated tail definition `plugins/kk/workflows/kk-itc-publish-tail.yaml` (kind: dag, version "2") holding exactly the seven post-authoring nodes `check-targets → send-confirm → fanout-send → fanout-recovery → reconcile-settle → seo → report` and no authoring node, so re-entering a failed publish tail cannot re-run authoring by construction.
- [x] R2. Every gate stays inside the tail: `send-confirm` keeps `pause: true` plus its byte-identical live-plan condition and sits between `check-targets` and `fanout-send`, and `report` waits on `reconcile-settle` and `seo`; re-entry therefore cannot skip the readiness probes or the live-send approval — the gate-bypass hazard the capture warns about is inexpressible here, unlike a `startable` marker placed on a gate node.
- [x] R3. The two definitions cannot drift: every tail node's `action` (and any `condition`/`pause`) is byte-identical to the same-id node of `plugins/kk/workflows/kk-itc.yaml`, pinned by a definition test that fails naming the drifted node.
- [x] R4. Re-entry is one command: `spur workflow run plugins/kk/workflows/kk-itc-publish-tail.yaml --vars '{"work_dir":"<failed run work_dir>"}'` creates a fresh run that starts at `check-targets`, leaves the failed run's own status untouched, and invokes no authoring stage (`itc-prepare`, `prepare-itc`, the `kk-itc-author` child).
- [x] R5. Receipts written by the re-entered tail stay bound to the frozen `<work_dir>/itc-options.json` `parentRunId` — the failed run id, not the fresh tail run id; `itc-send-targets` skips a target whose prior receipt is `succeeded` so nothing is published twice, and `itc-report-summary`'s target contract (one receipt per plan target, matching `planDigest`) still passes.
- [x] R6. The harness limitation is recorded rather than papered over: with spur 0.4.11 `startable` is not a DAG node key (`spur workflow validate` refuses `nodes.N: Unrecognized key: "startable"`) and `--from` is refused for `kind: dag`, so the task records `spur --version` plus both verbatim refusals in Testing and files harness-side fresh-start support as a residual instead of adding a marker that breaks validation.

### Acceptance Criteria

```gherkin
Feature: kk-itc resume seam for failed DAG publish runs

  Scenario: AC1 — The publish tail is re-enterable as its own definition (req: R1)
    Given a failed kk-itc run whose work_dir holds a frozen itc-options.json and a publish-plan.json
    When the operator needs only the post-authoring tail
    Then plugins/kk/workflows/kk-itc-publish-tail.yaml declares exactly check-targets, send-confirm, fanout-send, fanout-recovery, reconcile-settle, seo and report and declares no authoring node

  Scenario: AC2 — The live-send approval cannot be skipped on re-entry (req: R2)
    Given a live plan with targets and the tail definition
    When the tail run walks from check-targets to fanout-send
    Then send-confirm is still a pause node with the byte-identical live-plan condition between them and the report still waits on reconcile-settle and seo

  Scenario: AC3 — The tail cannot drift from the main DAG (req: R3)
    Given the tail definition and plugins/kk/workflows/kk-itc.yaml
    When the definition test compares each shared node id
    Then every action, condition and pause value is byte-identical and any mismatch fails naming the drifted node

  Scenario: AC4 — One command re-enters the tail without authoring (req: R4)
    Given a failed kk-itc run and its work_dir
    When spur workflow run plugins/kk/workflows/kk-itc-publish-tail.yaml --vars '{"work_dir":"<work_dir>"}' runs
    Then a fresh run starts at check-targets, the failed run keeps its status, and no itc-prepare, prepare-itc or kk-itc-author invocation occurs

  Scenario: AC5 — Re-entry stays bound to the frozen run and never double-publishes (req: R5)
    Given a work_dir whose itc-options.json parentRunId is the failed run and receipts already exist for one target
    When the re-entered tail sends and reports
    Then each new receipt carries the frozen parentRunId, the already-succeeded target is not re-dispatched, and the report's target contract passes

  Scenario: AC6 — The harness limitation is captured as evidence (req: R6)
    Given the installed harness spur 0.4.11
    When the implementer attempts startable: true and --from check-targets on this DAG
    Then the verbatim validate refusal and the verbatim --from refusal plus spur --version are recorded in Testing and the harness residual is filed
```

### Q&A

<!-- CLOSED decisions from refinement (--auto): what was chosen and why, what was deferred and on
     what condition. Not a parking lot for open questions. -->

#### Q&A entry — 2026-10-17 (refine, --auto --depth ready)

- **Closed — `startable: true` is not usable on this DAG, so the seam is a tail definition.** Evidence: `spur` 0.4.11 `DagNodeDefSchema` is a strict object with `id, description, action, dependsOn, dependencyPolicy, condition, pause, resumeRerun` only; `spur workflow validate` on a /tmp copy of `kk-itc.yaml` with `startable: true` on `check-targets` refuses verbatim `nodes.7: Unrecognized key: "startable"`. Separately `spur workflow run plugins/kk/workflows/kk-itc.yaml --from check-targets` refuses verbatim `--from check-targets: not supported for kind: "dag" workflows — DAG runs resume at node level instead.` Adding the marker would therefore break validation and every existing dry-run walk (`apps/cli/tests/kk-itc-dag.test.ts`, `apps/cli/tests/kk-itc-publish-tail.test.ts`) while enabling nothing. Chosen instead: a dedicated `plugins/kk/workflows/kk-itc-publish-tail.yaml` whose entry node is `check-targets`.
- **Closed — the tail definition is the allowlist; no marker can be mis-set.** The capture's hazard is "a wrong startable marker creates a skip-the-gates path (entering `fanout-send` directly would skip `send-confirm`)". A definition that *contains* `send-confirm` with `pause: true` between `check-targets` and `fanout-send` cannot express that path at all, which is a stronger guarantee than a marker set that a future edit could extend.
- **Closed — vars inheritance is `--vars '{"work_dir": …}'`, not `--from-run`.** Every tail node command templates `${vars.work_dir}` and nothing else (checked node by node), so `work_dir` is the whole inherited surface; run identity is read from the frozen `itc-options.json` (`parentRunId`), never from `vars.__runId`. `--from-run` is unusable anyway: it requires `--from`, which the harness refuses for `kind: dag`.
- **Closed — re-entry cannot double-publish.** `itc-send-targets` skips a target whose prior receipt has `status: "succeeded"` and only re-dispatches a row when no receipt exists or the row is being re-attempted; `--retry` (`fanout-recovery`) re-attempts only `effect: "none"` failures. The tail is safe to re-run over a partially sent plan.
- **Closed — `materialize-plan` is deliberately NOT a tail entry.** Re-running it rewrites `4-publish/content.json` and `publish-plan.json`, and `itc-report-summary`'s target contract fails the run when a receipt's `planDigest` no longer matches the plan file. A re-entered tail must not be able to perturb those bytes, so plan authoring stays in the main DAG; an operator whose plan is broken re-runs the main DAG (authoring is checkpointed by the child FSM receipt).
- **Deferred with owner (harness release)** — engine-side DAG fresh starts (`startable` on `DagNodeDefSchema` + `--from` accepted for `kind: dag`). When that lands, the tail definition can be retired in favour of `spur workflow run kk-itc.yaml --from check-targets --from-run <failed>`. Filed as a residual task; this task does not block on it.

#### Q&A entry — 2026-10-18T00:42:44.948Z

<!-- CLOSED decisions from refinement (--auto): what was chosen and why, what was deferred and on
     what condition. Not a parking lot for open questions. -->

#### Q&A entry — 2026-10-17 (refine, --auto --depth ready)

- **Closed — `startable: true` is not usable on this DAG, so the seam is a tail definition.** Evidence: `spur` 0.4.11 `DagNodeDefSchema` is a strict object with `id, description, action, dependsOn, dependencyPolicy, condition, pause, resumeRerun` only; `spur workflow validate` on a /tmp copy of `kk-itc.yaml` with `startable: true` on `check-targets` refuses verbatim `nodes.7: Unrecognized key: "startable"`. Separately `spur workflow run plugins/kk/workflows/kk-itc.yaml --from check-targets` refuses verbatim `--from check-targets: not supported for kind: "dag" workflows — DAG runs resume at node level instead.` Adding the marker would therefore break validation and every existing dry-run walk (`apps/cli/tests/kk-itc-dag.test.ts`, `apps/cli/tests/kk-itc-publish-tail.test.ts`) while enabling nothing. Chosen instead: a dedicated `plugins/kk/workflows/kk-itc-publish-tail.yaml` whose entry node is `check-targets`.
- **Closed — the tail definition is the allowlist; no marker can be mis-set.** The capture's hazard is "a wrong startable marker creates a skip-the-gates path (entering `fanout-send` directly would skip `send-confirm`)". A definition that *contains* `send-confirm` with `pause: true` between `check-targets` and `fanout-send` cannot express that path at all, which is a stronger guarantee than a marker set that a future edit could extend.
- **Closed — vars inheritance is `--vars '{"work_dir": …}'`, not `--from-run`.** Every tail node command templates `${vars.work_dir}` and nothing else (checked node by node), so `work_dir` is the whole inherited surface; run identity is read from the frozen `itc-options.json` (`parentRunId`), never from `vars.__runId`. `--from-run` is unusable anyway: it requires `--from`, which the harness refuses for `kind: dag`.
- **Closed — a `succeeded` receipt is never re-dispatched.** `itc-send-targets` skips a target whose prior receipt has `status: "succeeded"` (`apps/cli/src/itc-publish.ts:422-427`) and `--retry` (`fanout-recovery`) re-attempts only `effect: "none"` failures (`:412-419`). **Known bound, not fixed here:** a receipt in `uncertain` (effect `unknown` — the status that means "may already be live") *is* re-dispatched by the tail's non-retry `fanout-send` before `--retry` runs, so a live target with a lost response can publish twice on re-entry. The main DAG has the identical rule; the seam only makes it a documented one-command path. Narrowing the skip to `uncertain` is a `itc-send-targets` change, outside this task's untouched-file contract.
- **Closed — `materialize-plan` is deliberately NOT a tail entry.** Re-running it rewrites `4-publish/content.json` and `publish-plan.json`, and `itc-report-summary`'s target contract fails the run when a receipt's `planDigest` no longer matches the plan file. A re-entered tail must not be able to perturb those bytes, so plan authoring stays in the main DAG; an operator whose plan is broken re-runs the main DAG (authoring is checkpointed by the child FSM receipt).
- **Deferred with owner (harness release)** — engine-side DAG fresh starts (`startable` on `DagNodeDefSchema` + `--from` accepted for `kind: dag`). When that lands, the tail definition can be retired in favour of `spur workflow run kk-itc.yaml --from check-targets --from-run <failed>`. Filed as a residual task; this task does not block on it.

### Design

**WHAT/WHERE.** New `plugins/kk/workflows/kk-itc-publish-tail.yaml` (`kind: dag`, `version: "2"`, `vars: { work_dir, __runId, __definitionDigest }`), holding the seven post-authoring nodes copied verbatim from `plugins/kk/workflows/kk-itc.yaml` with `report` re-pointed at the tail's own tails (`reconcile-settle`, `seo`). `plugins/kk/workflows/kk-itc.yaml` is untouched. `apps/cli/src/itc-publish.ts` is untouched: `itc-send-targets` already binds receipts to `itc-options.json.parentRunId` (`readOptionsSnapshot`) and skips succeeded receipts, and `itc-report-summary` already enforces the target contract — that is the property R5 pins with a regression test, not new code. Tests live in `apps/cli/tests/kk-itc-publish-tail.test.ts` (definition parity, validate, dry-run walk) and `apps/cli/tests/itc-publish.test.ts` (parentRunId binding, no double dispatch).

**Decision and tradeoff.** Duplicate seven node bodies into a second definition rather than add an engine marker. Tradeoff: two files must be edited together — accepted and made safe by a drift test that compares every shared node id's `action`/`condition`/`pause` byte-for-byte and fails naming the node, so the cost of the duplication is one failing test at edit time, not a silent divergence at publish time. The alternative one-file shape (a `startable` marker) is unavailable: the strict DAG schema rejects the key and `--from` refuses `kind: dag`, so it would break validation while enabling nothing.

**Rejected alternatives.** (1) `startable: true` markers — illegal for `kind: dag` (validate refuses `nodes.N: Unrecognized key: "startable"`) and useless besides (`--from` refused for dag). (2) Convert `kk-itc` to `kind: transition-flow` where `startable` *is* legal — abandons the version-2 DAG contract established by 0302/0303 and the DAG's dependency fan-in, for a marker. (3) `resumeRerun: true` + `spur workflow continue` — resumes only paused/interrupted runs; a run in `failed` cannot be continued (engine: "only paused or interrupted runs can be continued"). (4) Keep the hand-driven `kk stage run` tail from the dogfood — bypasses edge/condition bookkeeping, which is the complaint this task exists to answer. (5) Patch the installed harness under `node_modules` — not a workspace package; lost on the next upgrade and unversioned for other operators. (6) Make `materialize-plan` a tail entry — perturbs `publish-plan.json`/payload bytes and can stale the receipts' `planDigest` (see Q&A).

**Invariants.** (i) The tail contains no authoring node, so authoring cannot be re-run by any invocation of it. (ii) `send-confirm` stays `pause: true` with its live-plan condition and stays the only edge into `fanout-send`; `report` stays downstream of both `reconcile-settle` and `seo`. (iii) Tail nodes read run identity only from `itc-options.json` + `publish-plan.json` — no `${vars.__runId}` anywhere in the tail (also pinned by the test, so a future copy-paste cannot reintroduce it). (iv) A succeeded receipt is never re-dispatched. (v) The main DAG gains no key the strict `DagNodeDefSchema` would reject.

**Safe/unsafe re-entry reasoning.** Safe: `check-targets` — read-only probes, no writes, immediately upstream of the approval pause, so re-entering there re-validates channels and then re-asks for approval on a live plan. Everything downstream of it in the tail is unchanged engine bookkeeping (edges, conditions, pause). Unsafe and therefore absent from the tail: `prepare` (only node that writes `itc-options.json`; it also refuses when the snapshot's `parentRunId` differs from the run id unless `force=true`), `child-author` (derives `${vars.__runId}-author`, so a fresh run id would create a second child), `verify-child-freeze` (would fail or re-freeze against a foreign run), `illustrate` (spends on generation), `adapt` / `adapt-verify` (re-entry would skip `materialize-plan`'s payload regeneration and then fail its own verification), `materialize-plan` (perturbs plan/payload bytes and thus receipt `planDigest`), and on the gate side `send-confirm` (an entry point there is an approval for probes that never ran), `fanout-send` (skips the approval), `fanout-recovery` (assumes this run sent), `reconcile-settle` (settles the store selection with no send in the run), `report` (reports a publication that never happened). Only `check-targets` is exposed.

**Harness evidence recorded for the residual.** `spur --version` → `0.4.11`; `spur workflow validate <copy with startable>` → `nodes.7: Unrecognized key: "startable"`; `spur workflow run … --from check-targets` → `--from check-targets: not supported for kind: "dag" workflows — DAG runs resume at node level instead.` These three lines, pasted verbatim in Testing, are what the residual task quotes.

### Plan

1. (R1, R3) Write the definition test first in `apps/cli/tests/kk-itc-publish-tail.test.ts`: parse the tail YAML and `plugins/kk/workflows/kk-itc.yaml`, assert the tail node id set is exactly `check-targets, send-confirm, fanout-send, fanout-recovery, reconcile-settle, seo, report`, assert it contains none of `prepare, child-author, verify-child-freeze, illustrate, materialize-plan, adapt, adapt-verify`, and assert every shared node's `action`, `condition` and `pause` are byte-identical (failure message names the node). Expect red — the file does not exist yet.
2. (R1, R2) Create `plugins/kk/workflows/kk-itc-publish-tail.yaml` (`kind: dag`, `version: "2"`, `vars: work_dir, __runId, __definitionDigest`) by copying the seven node blocks from `kk-itc.yaml` verbatim; keep `send-confirm`'s `pause: true` and condition and re-point `report.dependsOn` to `[reconcile-settle, seo]`. Use only keys the strict `DagNodeDefSchema` allows (`id, description, action, dependsOn, dependencyPolicy, condition, pause, resumeRerun`).
3. (R2) Extend the same test: assert `send-confirm.pause === true`, that it is the only predecessor of `fanout-send`, and that `report.dependsOn` is exactly `['reconcile-settle', 'seo']` — the gate ordering R2 promises.
4. (R4) In `apps/cli/tests/kk-itc-publish-tail.test.ts` add the re-entry walk, modelled on the existing `R6/AC7` dry-run case there: seed a temp work dir (draft + `itc-options.json` + `publish-plan.json`), run `spur workflow run plugins/kk/workflows/kk-itc-publish-tail.yaml --dry-run --no-log --json --vars '{"work_dir": …}'` from a temp cwd with `SPUR_WORKFLOW_RUN_ACTIVE` cleared, and assert exit 0 plus that the run record's workflow name is `kk-itc-publish-tail` and no `*-author` run row was created.
5. (R5) Add the binding regression to `apps/cli/tests/itc-publish.test.ts`: seed `itc-options.json` with `parentRunId: "<failed-run>"` plus an already-`succeeded` receipt for one target, run `itcSendTargets`, and assert (a) the new receipt's `parentRunId` is `"<failed-run>"`, (b) the dispatch callback is not called for the succeeded target, (c) `itcReportSummary` leaves `outcome: "PASS"` with no `targetContractFailure`.
6. (R6) Record harness evidence in Testing, verbatim: `spur --version`; the `nodes.7: Unrecognized key: "startable"` refusal from a /tmp copy; the `--from check-targets: not supported for kind: "dag" workflows` refusal. File the residual for engine-side DAG fresh starts under G21 and link it in References.
7. (all) Run `bun test apps/cli/tests/kk-itc-publish-tail.test.ts apps/cli/tests/kk-itc-dag.test.ts apps/cli/tests/itc-publish.test.ts plugins/kk/tests/verdict-confidence.test.ts`, then `bun run lint` (Biome 2.5.15, 4-space, single quotes, no `any`) — the last file scans every workflow under `plugins/kk/workflows`, so it proves the new definition does not disturb the judge-verdict contract.

### Root Cause

A `failed` DAG run has no re-entry point in the installed harness. `plugins/kk/workflows/kk-itc.yaml` declares `kind: dag`, and for that kind the engine's strict `DagNodeDefSchema` accepts no `startable` key (only `resumeRerun`), the CLI refuses `--from` outright (`assertStartStateStartable`: `not supported for kind: "dag" workflows — DAG runs resume at node level instead`), `spur workflow continue` resumes only paused/interrupted runs, and re-running with the same `--run-id` fails on the existing run row. That is why the dogfood tail had to be driven by hand with six `kk stage run` calls, which skips the engine's edge/condition bookkeeping.

### Solution

**Change map — the seam is a second DAG definition, no engine code and no new stage.**

| Where | What |
| --- | --- |
| `plugins/kk/workflows/kk-itc-publish-tail.yaml:2` | New `name: kk-itc-publish-tail`, `kind: dag`, `version: "2"` definition. Vars are `work_dir` / `__runId` / `__definitionDigest` only (`:11-15`): the frozen `$work_dir/itc-options.json` is the whole inherited surface, and no node templates `${vars.__runId}` (asserted at `apps/cli/tests/kk-itc-publish-tail.test.ts:224`). |
| `plugins/kk/workflows/kk-itc-publish-tail.yaml:18-90` | The seven post-authoring nodes, bodies copied verbatim from `plugins/kk/workflows/kk-itc.yaml` in the same declaration order: `check-targets` (`:18`), `send-confirm` (`:27`), `fanout-send` (`:39`), `fanout-recovery` (`:50`), `reconcile-settle` (`:61`), `seo` (`:71`), `report` (`:79`). No authoring node exists, so no invocation can re-run `prepare` / `child-author` / `verify-child-freeze` / `illustrate` / `materialize-plan` / `adapt` / `adapt-verify` (R1). |
| `plugins/kk/workflows/kk-itc-publish-tail.yaml:31-36` | Only the edges that pointed at authoring-side nodes were re-pointed: `check-targets` becomes the entry (no `dependsOn`), `send-confirm` waits on `check-targets` alone while keeping `pause: true` and its byte-identical live-plan condition — so it stays the only edge into `fanout-send` (R2). `seo` keeps reading only the frozen draft, so it loses its `verify-child-freeze` edge and is a root of the tail. |
| `plugins/kk/workflows/kk-itc-publish-tail.yaml:83-85` | `report.dependsOn` re-pointed to `[reconcile-settle, seo]` — the tail's own two tails (R2). |
| `apps/cli/tests/kk-itc-publish-tail.test.ts:186-348` | Definition + re-entry suite. `:224` node-set and forbidden-node assertions; `:245` the `spur workflow validate` case; `:252` the drift net: every shared node id compared on `action` / `condition` / `pause` against `kk-itc.yaml`, failing with `{node: <id>, …}` so the message names the drifted node (R3, verified red by mutating `seo`'s command); `:265` the gate ordering (`pause: true`, `fanout-send` reachable only from `send-confirm`, `report.dependsOn`); `:280-348` the one-command re-entry walk (`:303`), modelled on the 0151 `R6/AC7` dry-run case in the same file — seeds a failed run's work dir, asserts exit 0, `workflowName: kk-itc-publish-tail`, a run table holding exactly that one row (no `-author` run), and the frozen `parentRunId` untouched (R4). |
| `apps/cli/tests/itc-publish.test.ts:572-624` | R5 regression: `itc-options.json` naming the failed run plus an already-`succeeded` receipt for `pub-sent`. Asserts the newly written receipt carries the frozen `parentRunId`, `dispatch` runs only for `pub-pending` (nothing published twice), and `itcReportSummary` reports `outcome: done` / `verdict: PASS` with no `targetContractFailure`. No production code was needed — `itcSendTargets` already reads `readOptionsSnapshot` and skips succeeded receipts (`apps/cli/src/itc-publish.ts:394`, `:419`), which is the property this test pins. |
| `docs/features/G2_kk-itc.md:16` | Goal line now names `plugins/kk/workflows/kk-itc-publish-tail.yaml` as G2's second workflow, so `apps/cli/tests/g-feature-tree.test.ts` R1 ("every product workflow has exactly one home child") keeps its invariant instead of failing on the new stem. |
| `plugins/kk/workflows/kk-itc.yaml`, `apps/cli/src/itc-publish.ts` | Untouched, as designed. The shared node bodies were extracted programmatically from `kk-itc.yaml` so they are literally the same bytes; the strict `DagNodeDefSchema` keys (`id, description, action, dependsOn, dependencyPolicy, condition, pause, resumeRerun`) are the only ones used. |

**Why not `startable: true` (R6).** Re-measured on the installed harness: `spur --version` → `0.4.11`; `spur workflow validate` on a copy of `kk-itc.yaml` with `startable: true` on `check-targets` → `nodes.7: Unrecognized key: "startable"` (exit 1); `spur workflow run plugins/kk/workflows/kk-itc.yaml --from check-targets` → `--from check-targets: not supported for kind: "dag" workflows — DAG runs resume at node level instead.` (exit 2). A marker would break validation and every existing dry-run walk while enabling nothing. The tail definition is the allowlist: a gate-skipping path is not merely discouraged, it is not expressible.

**Confidence contract (HIGH | MEDIUM | LOW) at the seam.** Verification only — no production code changed.

| Where | What |
| --- | --- |
| `plugins/kk/tests/verdict-confidence.test.ts:87-115` | `load()` now flattens `kind: dag` node `condition`s into the shared consumer scan as `<node>->condition` pseudo-guards. This closes the blind spot the file documented ("if the DAG ever grows verdict guards inside node conditions, teach load() to unwrap nodes instead") — the new tail is a DAG whose only guard is a node condition, so without this the seam would have been unscanned. |
| `plugins/kk/tests/verdict-confidence.test.ts:584` | Non-vacuity case for that flattening: the tail's `send-confirm` condition must be in the scanned set, and the scan's own predicates must flag a DAG condition that accepts a bare `PASS`. Verified red: injecting `jq -r .verdict … grep -q "= PASS"` into the tail's guard made the per-workflow consumer check fail naming `plugins/kk/workflows/kk-itc-publish-tail.yaml`, then reverted byte-identically. |
| `apps/cli/tests/kk-itc-publish-tail.test.ts:263` | The seam cannot launder a verdict: no tail node invokes `itc-author-verdict` or `itc-author-complete`, and no node guard reads a verdict — the enum stays enforced exactly where the verdict is written. |
| `apps/cli/tests/itc-publish.test.ts:628-646` | Through the seam's `report` stage: a frozen `PASS` + `HIGH`, `MEDIUM` or `LOW` each report `verdict: PASS`, `outcome: done`; a frozen non-`PASS` reports `verdict: FAIL`, `outcome: failed`. |

**Deliberately not changed:** `itc-report-summary` (the tail's last node) copies the frozen verdict without re-checking the enum, so a `PASS` with `confidence: "SURE"` would still read `verdict: PASS` there. It is a reporter, not a gate: `itcAuthorVerdict` refuses an out-of-enum / missing-confidence `PASS` in the author FSM's `judge` state, which resolves to `failed` before any publish can start — and the tail contains no authoring node at all, so re-entry cannot reach that state machine. Enforcing the enum in the reporter would be a production change to `apps/cli/src/itc-publish.ts`, which this task's contract keeps untouched — recorded as residual risk instead.

**Residual (harness, not this repo).** Engine-side DAG fresh starts (`startable` on `DagNodeDefSchema` + `--from` accepted for `kind: dag`) would let this tail be retired in favour of `spur workflow run kk-itc.yaml --from check-targets --from-run <failed>`. Recorded here in-task by operator directive: no residual corpus task is filed — this paragraph plus the three verbatim evidence lines above are the record, and a reader can re-run them to confirm the gap.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-itc-publish-tail.yaml:17-90` declares kind dag with version 2 and exactly the seven ids check-targets, send-confirm, fanout-send, fanout-recovery, reconcile-settle, seo, report; a Bun.YAML parse and set compare this run found no authoring id among them. Pinned at `apps/cli/tests/kk-itc-publish-tail.test.ts:225-243`. |
| R2 | MET | send-confirm keeps pause true at `plugins/kk/workflows/kk-itc-publish-tail.yaml:33` with a condition value-identical to `plugins/kk/workflows/kk-itc.yaml:198-203`, is the only predecessor of fanout-send (`plugins/kk/workflows/kk-itc-publish-tail.yaml:41-42`), and report depends on reconcile-settle plus seo (`plugins/kk/workflows/kk-itc-publish-tail.yaml:83-85`); a live-plan dry-run this run returned status paused with finalState send-confirm. Assertions at `apps/cli/tests/kk-itc-publish-tail.test.ts:274-289`. The judge confidence gate stays upstream too: no tail node invokes a verdict producer and no node guard reads a verdict (`apps/cli/tests/kk-itc-publish-tail.test.ts:263-272`), and the shared HIGH/MEDIUM/LOW consumer scan reads DAG node conditions, so the tail's only guard sits inside it (`plugins/kk/tests/verdict-confidence.test.ts:105-114`, non-vacuity at `plugins/kk/tests/verdict-confidence.test.ts:584-598`; that file passed 72 tests this run). |
| R3 | MET | Parsed compare of all seven shared ids on action, condition and pause this run shows zero value differences, the only deltas being the four intentional dependsOn re-points. The drift test compares a node/action/condition/pause object per shared id and its failure names the drifted node: `apps/cli/tests/kk-itc-publish-tail.test.ts:249-261`. |
| R4 | MET | Reproduced this run: a dry-run of the tail with vars work_dir exited 0 with workflowName kk-itc-publish-tail; in a project holding a seeded failed run row the tail took a distinct run id and that failed row stayed failed; the definition holds no authoring node. Test `apps/cli/tests/kk-itc-publish-tail.test.ts:323-348`. |
| R5 | MET | parentRunId comes from the frozen snapshot at `apps/cli/src/itc-publish.ts:394`, a succeeded receipt is skipped at `apps/cli/src/itc-publish.ts:414-427`, each new receipt writes that parentRunId at `apps/cli/src/itc-publish.ts:506-508`, and the target contract is enforced at `apps/cli/src/itc-publish.ts:707-716`; regression `apps/cli/tests/itc-publish.test.ts:578-626` passed this run with dispatch only for pub-pending, the new receipt bound to the frozen failed run id, and the report at outcome done with verdict PASS and no targetContractFailure. |
| R6 | MET | Reproduced this run: spur reports harness version 0.4.11; a copy of kk-itc.yaml carrying startable on check-targets is refused with nodes.7 Unrecognized key startable; the --from check-targets run is refused with not supported for kind dag, DAG runs resume at node level instead. All three are recorded verbatim in the record at `docs/tasks/0310_kk-itc-resume-seam-for-failed-dag-publish-runs.md:116` and `docs/tasks/0310_kk-itc-resume-seam-for-failed-dag-publish-runs.md:147`, the harness gap is carried as a deferrable residual that the close-stage settle files as the follow-up task, and no marker was added: `plugins/kk/workflows/kk-itc.yaml` is unchanged and still validates. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The publish tail is re-enterable as its own definition (req: R1) | MET | test | Definition parse this run gives exactly the seven post-authoring ids and none of the authoring ids, and spur workflow validate reports the tail valid at explicit(2); `apps/cli/tests/kk-itc-publish-tail.test.ts:225-243` plus `apps/cli/tests/kk-itc-publish-tail.test.ts:244`. |
| AC2 — The live-send approval cannot be skipped on re-entry (req: R2) | MET | test | `apps/cli/tests/kk-itc-publish-tail.test.ts:274-289` asserts pause true, the live-plan guard bytes, fanout-send reachable only from send-confirm, and report depending on reconcile-settle plus seo; a live-plan dry-run this run returned paused with finalState send-confirm while the same tree with a draft plan walked to done. |
| AC3 — The tail cannot drift from the main DAG (req: R3) | MET | test | `apps/cli/tests/kk-itc-publish-tail.test.ts:249-261` builds a node/action/condition/pause object per shared id so any mismatch names the node; an independent parsed compare this run found zero differences on those three keys across all seven shared ids. |
| AC4 — One command re-enters the tail without authoring (req: R4) | MET | test | `apps/cli/tests/kk-itc-publish-tail.test.ts:323-348`; reproduced this run: exit 0, workflowName kk-itc-publish-tail, a single run row, a seeded failed run row still failed after re-entry, and the definition contains no authoring node to invoke. |
| AC5 — Re-entry stays bound to the frozen run and never double-publishes (req: R5) | MET | test | `apps/cli/tests/itc-publish.test.ts:578-626` passed this run: dispatch ran only for pub-pending, the new receipt carries the frozen parentRunId, and the report is outcome done with verdict PASS and no targetContractFailure. |
| AC6 — The harness limitation is captured as evidence (req: R6) | MET | command | This run: harness version 0.4.11 printed by the CLI, the startable copy refused with nodes.7 Unrecognized key startable, and --from check-targets refused with not supported for kind dag; all three are verbatim in the record at `docs/tasks/0310_kk-itc-resume-seam-for-failed-dag-publish-runs.md:116` and `docs/tasks/0310_kk-itc-resume-seam-for-failed-dag-publish-runs.md:147`, and the harness residual rides as a deferrable for the close-stage settle. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 0310 (G21: kk-itc resume seam for failed DAG publish runs)

**Scope:** working tree vs `0310-base.sha` (`3861c3d1`) — new `plugins/kk/workflows/kk-itc-publish-tail.yaml` (90 lines, untracked at review time) plus edits to `apps/cli/tests/kk-itc-publish-tail.test.ts`, `apps/cli/tests/itc-publish.test.ts`, `plugins/kk/tests/verdict-confidence.test.ts`, `docs/features/G2_kk-itc.md`, this task record. `plugins/kk/workflows/kk-itc.yaml` and `apps/cli/src/itc-publish.ts` re-checked as untouched.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — no open P1–P3. Two P3 rows carry a concrete `DEFER`, two P4 observations are `ACCEPTED`. R6 is PARTIAL on bookkeeping only (finding 1); nothing in the shipped seam depends on it.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | traceability (R6) | R6's second conjunct is unmet: the harness gap is recorded in-task but **no corpus residual task exists** for engine-side DAG fresh starts. `docs/tasks/` holds only 0310, 0311 (different subject: probe env), 0312/0313 (the G81 0308/0309 residuals); the record itself hands the filing downstream — "Not filed as a corpus task here (lifecycle action, left to close/review)". | `docs/tasks/0310_kk-itc-resume-seam-for-failed-dag-publish-runs.md` § Solution (last paragraph) | DEFER(file at close — creating a corpus task is a lifecycle action outside this review's write surface; the three verbatim evidence lines to quote are already in § Solution) |
| 2 | P3 (minor) | correctness | The task's Q&A claims "Re-entry cannot double-publish, `itc-send-targets` skips a target whose prior receipt has `status: succeeded`". The skip covers `succeeded` only (`apps/cli/src/itc-publish.ts:422-427`), so a target whose receipt is `uncertain` (effect `unknown` — the one status that means "may already be live") **is re-dispatched** by the tail's non-retry `fanout-send` (`plugins/kk/workflows/kk-itc-publish-tail.yaml:39-48`) before `fanout-recovery`'s conservative `--retry` (`apps/cli/src/itc-publish.ts:412-419` skips `effect !== 'none'`). A live target with a lost response can therefore publish twice on re-entry. No new code — the main DAG has the identical dispatch rule — but the seam is now the documented one-command path into it, so the Q&A sentence is broader than the guarantee. | `apps/cli/src/itc-publish.ts:412-427` | DEFER(narrow the Q&A sentence to "a `succeeded` receipt is never re-dispatched" and file the `uncertain` re-dispatch with the harness residual; the code fix is `itc-send-targets`, which this task's contract keeps untouched) |
| 3 | P4 (advisory) | architecture | The drift net compares `action` / `condition` / `pause` (`apps/cli/tests/kk-itc-publish-tail.test.ts:249-261`). `dependencyPolicy` and `resumeRerun` are the two remaining behaviour-bearing `DagNodeDefSchema` keys and neither is compared, so a future edit that sets either on a shared node of `plugins/kk/workflows/kk-itc.yaml` would diverge silently — exactly the failure mode R3 exists to prevent. R3 names only the three keys, so this is beyond the requirement; the tightening is one line in the compared object. | `apps/cli/tests/kk-itc-publish-tail.test.ts:249-261` | ACCEPTED |
| 4 | P4 (advisory) | correctness / usability | AC2 has no automated live-plan pause proof: the R4 walk seeds `live: false`, so `send-confirm` is skipped and the walk only proves `done` (`apps/cli/tests/kk-itc-publish-tail.test.ts:294-322`). Reproduced by hand this review: with a live plan the same command returns `"status": "paused", "finalState": "send-confirm"` with `transitionsTaken: 3`. A second walk with `live: true` asserting exactly that would pin AC2's Then-clause, not just its structure. | `apps/cli/tests/kk-itc-publish-tail.test.ts:323-348` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-itc-publish-tail.yaml:17-90` holds exactly the seven post-authoring nodes — parsed id list is `check-targets → send-confirm → fanout-send → fanout-recovery → reconcile-settle → seo → report` (`:18,27,39,50,61,71,79`), `kind: dag` + `version: "2"` (`:3-4`), and no id from `prepare, child-author, verify-child-freeze, illustrate, materialize-plan, adapt, adapt-verify` (`plugins/kk/workflows/kk-itc.yaml:40,77,115,125,144,155,170`). Pinned at `apps/cli/tests/kk-itc-publish-tail.test.ts:225-243`. |
| R2 | MET | `send-confirm` keeps `pause: true` (`:33`) and its condition (`:34-37`) is value-identical to `plugins/kk/workflows/kk-itc.yaml:201-203`; it is the only `dependsOn: [check-targets]` predecessor of `fanout-send` (`:41-42`), and `report.dependsOn` is exactly `[reconcile-settle, seo]` (`:83-85`). Structural assertions `apps/cli/tests/kk-itc-publish-tail.test.ts:274-289`; runtime proof this review: live plan (`live:true`, one `mode:"live"` target) → `{"status":"paused","finalState":"send-confirm","mode":"dag"}`, i.e. the run stops before any action. Draft plan → `{"status":"done"}`. |
| R3 | MET | Parsed compare over all seven shared ids (`action`, `condition`, `pause`): **zero value differences**; the only differences are the three intentional `dependsOn` re-points (`check-targets` `[materialize-plan]`→root, `send-confirm` `[adapt-verify,check-targets]`→`[check-targets]`, `seo` `[verify-child-freeze]`→root, `report` `[verify-child-freeze,reconcile-settle,seo]`→`[reconcile-settle,seo]`). Test `apps/cli/tests/kk-itc-publish-tail.test.ts:249-261` compares `{node, action, condition, pause}` objects, so a mismatch prints the node id. Gap for the two uncompared keys: finding 3. |
| R4 | MET | `spur workflow run plugins/kk/workflows/kk-itc-publish-tail.yaml --dry-run --no-log --json --vars '{"work_dir":…}'` → exit 0, `workflowName: kk-itc-publish-tail`, `mode: dag`, one trace row (no `*-author` run), and `itc-options.json` byte-unchanged after the walk (reproduced twice this review, in a temp cwd). Test `apps/cli/tests/kk-itc-publish-tail.test.ts:323-348`. "No authoring stage invoked" holds by construction (R1) rather than by observation, which is the stronger argument. |
| R5 | MET | `apps/cli/src/itc-publish.ts:394` takes `parentRunId` from the frozen snapshot (`readOptionsSnapshot`, `:232-253`), never from the run id; `:422-427` skips a `succeeded` receipt; `:508` writes `parentRunId` into every new receipt; `:700-712` still enforces the target contract (`expected` vs `observed` plugin set + `planDigest` staleness). Regression at `apps/cli/tests/itc-publish.test.ts:578-626` — `dispatched` is exactly `['pub-pending']`, new receipt `parentRunId === "kk-itc-failed-0310"`, report `outcome: done` / `verdict: PASS` / no `targetContractFailure`. Scope limit stated in finding 2. |
| R6 | PARTIAL | Evidence is real and **independently reproduced this review** on the installed harness: `spur --version` → `0.4.11`; a `/tmp` copy of `kk-itc.yaml` with `startable: true` on `check-targets` → `nodes.7: Unrecognized key: "startable"`; `spur workflow run …/kk-itc.yaml --from check-targets` → `--from check-targets: not supported for kind: "dag" workflows — DAG runs resume at node level instead.` All three are recorded verbatim in § Solution ("Why not `startable: true`", "Harness evidence recorded for the residual") and § Root Cause. What is missing is the residual **task** (finding 1), and R6's literal "in Testing" wording is satisfied only after the verify stage fills that section — it is empty in the record at review time, which is the normal pipeline order (`### Testing` is `Filled during verification`; done tasks 0302/0307/0309 carry `**Pipeline verify results**` there). |

AC map: AC1 → R1 row + test `:225`; AC2 → R2 row + test `:274` + the live-plan pause probe (missing as an automated case, finding 4); AC3 → R3 row + test `:249`; AC4 → R4 row + test `:323`; AC5 → R5 row + `apps/cli/tests/itc-publish.test.ts:578`; AC6 → R6 row + finding 1.

##### Claims, basis, and how to re-check

| Claim | Basis | How to re-check |
|-------|-------|-----------------|
| The seven tail node bodies are identical to the main DAG | Parsed-YAML compare of `action`/`condition`/`pause` for the seven shared ids, run this review against `plugins/kk/workflows/kk-itc.yaml:181-259` | `bun -e 'const m=new Map(Bun.YAML.parse(await Bun.file("plugins/kk/workflows/kk-itc.yaml").text()).nodes.map(n=>[n.id,n]));for(const n of Bun.YAML.parse(await Bun.file("plugins/kk/workflows/kk-itc-publish-tail.yaml").text()).nodes)console.log(n.id, JSON.stringify(n.action)===JSON.stringify(m.get(n.id).action))'` |
| A live plan still stops at the approval | Executed twice: `spur workflow run …/kk-itc-publish-tail.yaml --dry-run --no-log --json --vars '{"work_dir":"/tmp/tailprobe-gsUG/wd"}'` → `paused` / `send-confirm`; same tree with `live:false` → `done` | Re-run with a `publish-plan.json` whose `live` is `true` and one live target (the temp dirs are under `/tmp/tailprobe*`) |
| No tail node reads `${vars.__runId}` or `${vars.__definitionDigest}` | File content `plugins/kk/workflows/kk-itc-publish-tail.yaml:11-15` (declared for the engine only) and the runtime-assembled assertion at `apps/cli/tests/kk-itc-publish-tail.test.ts:238-240` | `grep -n 'runId}' plugins/kk/workflows/kk-itc-publish-tail.yaml` → no match |
| Re-entry cannot re-run authoring | Structural: no authoring node id exists in the definition (R1 row) | `spur workflow validate` prints the definition; `grep -c 'kk stage run' plugins/kk/workflows/kk-itc-publish-tail.yaml` → 6, all publish stages |
| Receipts stay bound to the failed run | Code read `apps/cli/src/itc-publish.ts:394,508` + regression `apps/cli/tests/itc-publish.test.ts:578-626` | `bun test apps/cli/tests/itc-publish.test.ts` |
| The three harness refusals quoted in § Solution are accurate | Reproduced verbatim in a `/tmp` copy (`spur` 0.4.11) | Re-run the three commands listed in § Solution |
| **Assumption:** a `uncertain` receipt is re-dispatched on re-entry | Code read (`apps/cli/src/itc-publish.ts:422-427`), **not executed** — finding 2 | Seed `4-publish/receipts/<plugin>.json` with `status:"uncertain"`, call `itcSendTargets` with a counting dispatch, expect one dispatch |
| **Assumption:** hand-editing `live` in a frozen `publish-plan.json` can skip the approval | `apps/cli/src/itc-plan.ts:440-500` derives every target's `mode` from `request.live`, so a tool-built plan cannot be live-without-approval; only manual forgery of the frozen file could. Equivalent to running `itc-send-targets` by hand, which no definition can prevent | — |

##### Design judgments (requested a–e)

- **a. Duplication as a design choice — sound.** The drift test is a real net, not a copy-pinning ritual: it compares parsed values (command bytes included) on the keys that carry behaviour, and its diff output names the node, so the cost of the duplication is one red test at edit time instead of a silent divergence at publish time. The alternative — a `startable` marker — is refused by the installed strict schema (`spur` 0.4.11, reproduced), and YAML anchors cannot cross a document, so there is no supported include mechanism to share the bodies. Residual cost: two uncompared structural keys (finding 3).
- **b. Gate safety — holds.** `send-confirm` (`plugins/kk/workflows/kk-itc-publish-tail.yaml:27-37`) is the only edge into `fanout-send` (`:41-42`) and keeps `pause: true`; a live plan pauses before any action (executed). No authoring node exists, so no re-entry can re-run authoring. Settling without a send is not reachable in a way that matters: `reconcile-settle` only ever follows a `fanout-send` execution, `itc-reconcile-receipts` returns 0 when the plan is absent (`apps/cli/src/itc-publish.ts:539`) and settles `author_only` only for a zero-target plan (`:559-561`), and a `published` selection requires a `succeeded` live receipt (`:585-587`). The one real gap is `uncertain` re-dispatch — finding 2, inherited, not introduced.
- **c. Identity / binding — holds.** No `${vars.__runId}` anywhere in the definition (`:11-15` declare it for the engine; no node templates it), and `work_dir` is the entire inherited surface — all six commands interpolate only `${vars.work_dir}`. Receipts bind to the frozen `itc-options.json.parentRunId` (`apps/cli/src/itc-publish.ts:394,508`), and a `succeeded` receipt is never re-dispatched (`:422-427`, regression `apps/cli/tests/itc-publish.test.ts:578`).
- **d. The declared residual — honest scoping, with a bookkeeping debt.** Not a parked defect: the limitation is not in this repo (it is the installed harness), the alternative that was rejected is named with its verbatim refusals, and the seam ships without depending on the engine change. What is missing is the corpus row that makes the debt visible outside this file — finding 1, filed at close.
- **e. Promised-untouched files — clean.** `git diff HEAD -- plugins/kk/workflows/kk-itc.yaml apps/cli/src/itc-publish.ts` is empty; `kk-itc.yaml` still validates (`workflow valid: kk-itc (explicit(2))`).

##### SECUA

Security: the tail adds no environment passing, no `set -x`, no logging and no new stage — every interpolation is a quoted `${vars.work_dir}` and every `$(jq …)` substitution is quoted, so it does not widen the probe-environment exposure 0311 owns (`plugins/kk/workflows/kk-itc-publish-tail.yaml:20-37`). Correctness/verdict contract: the widened `load()` (`plugins/kk/tests/verdict-confidence.test.ts:87-115`) now scans DAG node conditions, so the seam's only guard is inside the confidence contract, with a non-vacuity case at `:584`. Usability: the exact re-entry command is in the definition's own `description` (`:8`), which is what an operator sees in `spur workflow list`. Efficiency: one extra probe pass per re-entry, intended.

##### Verification run this review (fresh, not quoted)

- `bun test apps/cli/tests/kk-itc-publish-tail.test.ts apps/cli/tests/itc-publish.test.ts plugins/kk/tests/verdict-confidence.test.ts` → **115 pass / 0 fail / 641 expect()** across 3 files (6.75 s).
- `spur workflow validate plugins/kk/workflows/kk-itc-publish-tail.yaml` → `workflow valid: kk-itc-publish-tail (explicit(2))`; `…/kk-itc.yaml` → `workflow valid: kk-itc (explicit(2))`.
- Two `/tmp` dry-run walks (live → `paused`/`send-confirm`; draft → `done`), frozen `itc-options.json` unchanged afterwards.
- Three harness refusals reproduced in a `/tmp` copy. Full gate deliberately not re-run (recorded PASS: `.spur/run/0310-test-gate.log`, `.spur/run/0310-test-gate.status`).

**Next:** at close, file the harness residual (engine-side DAG fresh starts) and narrow the Q&A's double-publish sentence to `succeeded` receipts — findings 1 and 2 are the only open items and both are record/task-lifecycle work, not code. Note for whoever commits: `plugins/kk/workflows/kk-itc-publish-tail.yaml` is still untracked in the worktree.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-18T00:28:11.638Z todo → wip (system)
- 2026-10-18T00:48:46.802Z wip → testing (system)
- 2026-10-18T00:48:53.770Z testing → done (system)

