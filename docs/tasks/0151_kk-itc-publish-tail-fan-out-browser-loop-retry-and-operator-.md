---
schema_version: 1
name: "kk-itc publish tail: fan-out, browser loop, retry and operator confirm"
status: done
template: feature-impl
created_at: 2026-09-22T16:46:32.546Z
updated_at: "2026-09-23T04:59:22.956Z"
feature_id: F41
priority: P2
tags:
  - F41
  - kk-itc
estimate_hours: 10

dependencies: ["0149", "0150"]
---

## 0151. kk-itc publish tail: fan-out, browser loop, retry and operator confirm

### Background

This slice wires the publish tail into kk-itc. A publish can be sent only when the run has non-empty `publish_targets`:
- API and file-cli targets go through `kk executor fan-out`, with one retry via `--retry-from`.
- Browser targets go through a bounded `agent.run kk:publish` loop.
- The run pauses for an operator answer before any send, unless it is auto and draft-only.
- `itc-report` reports the result for each target.

Implements:
- R11 — Interactive publish pauses for an operator answer before sending
- R12 — Auto mode sends drafts unless publish_live was set at launch
- R13 — API and file-cli targets publish through kk executor fan-out
- R14 — Browser targets publish through kk:publish agent steps
- R15 — Failed fan-out targets are re-sent once through --retry-from
- R16 — itc-report summarizes the verdict, revisions and per-target outcomes
- R18 — Fixture run of the publish tail reaches platform drafts on fake transports

Design SSOT: `docs/design/kk-itc-end-to-end.md` §3, §4 and §6. Ordering: after "kk-itc auto mode, judge revise loop and run report" and "itc-materialize and itc-publish-plan with the target profile table".

Rubric: E10 D1 L2 C1 R2 = 16 → split into its own task (forced: R is high, because this slice holds the external send).

### Requirements

- [x] R1. Add the vars `publish_targets` (""), `publish_live` (false), `source_locale` (en) and `browser_target` ("") to `kk-itc.yaml`. Add the states publish-entry, materialize, publish-plan, publish-gate, publish-confirm, publish-fanout, publish-retry, publish-agent and report. Wire the edges per the §3 table, including judge PASS and draft-review yes going to publish-entry when targets are set.
- [x] R2. publish-confirm (a confirm action) lists every target and the draft or live mode. It is entered when `auto` is false or `publish_live` is true. Answering no routes to report with outcome `declined` and makes no publish call.
- [x] R3. `kk stage itc-publish-fanout <work_dir> [--retry]`:
  - Writes each variant's `switches` into that variant file's `metadata`.
  - Spawns `kk executor fan-out --content <variant> --target … --out 4-publish/fanout-result.<variant>.json` once per group.
  - Treats target failures as data, not exit 1.
  - With `--retry`, passes `--retry-from` only for groups that have `ok:false` results. `.publish-retry-count` caps retries at 1.
- [x] R4. `kk stage itc-publish-next <work_dir>` writes `4-publish/.next-browser`. publish-agent reads it into `browser_target` and runs `agent.run kk:publish ${browser_target}` on that target's variant, which writes `4-publish/result.<target>.json`. A failed agent step still writes an `ok:false` Result. The self-loop ends when no browser target is pending.
- [x] R5. `itc-report` adds each target's ok, url or error and prints the exact `kk executor fan-out --retry-from …` command for failed fan-out targets. Any `ok:false` sets outcome `failed`.
- [x] R6. `apps/cli/tests/kk-itc-publish-tail.test.ts` runs the tail stages from a seeded work dir with `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` for zenn-pub, qiita-pub and surfdash-pub. It asserts content.json, a draft-mode ok Result per target, and the report. A `spur workflow run --dry-run` walk with `auto` true and targets set reaches done.
- [x] R7. Sync the `docs/04_DESIGN.md` vars, stages and artifacts in the same commit (T3).

### Acceptance Criteria

- [x] AC1 — Interactive publish pauses for an operator answer before sending
- [x] AC2 — Auto mode sends drafts unless publish_live was set at launch
- [x] AC3 — API and file-cli targets publish through kk executor fan-out
- [x] AC4 — Browser targets publish through kk:publish agent steps
- [x] AC5 — Failed fan-out targets are re-sent once through --retry-from
- [x] AC6 — itc-report summarizes the verdict, revisions and per-target outcomes
- [x] AC7 — Fixture run of the publish tail reaches platform drafts on fake transports

Task-local check: no test performs a real network publish.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T16:50:43.828Z

- **Q: When does the run pause at publish-confirm?** A (closed): when `auto != true` or `publish_live == true` (design §3, publish-gate row; ADR-022). It skips the pause only when auto is set and the run publishes drafts.
- **Q: How are failed fan-out targets retried?** A (closed): once, through `kk executor fan-out --retry-from <prior aggregate>` (`apps/cli/src/fanout.ts:306`; argv parsed at `:271`). Retries are capped at 1 (V5).
- **Q: How do browser targets loop?** A (closed): `itc-publish-next` keeps a file cursor over the plan's browser list, and `publish-agent` self-loops one `agent.run` of `kk:publish` per target. The loop is bounded by the list length. The engine is sequential and has no foreach (ADR-019).
- **Q: Where is the draft switch applied?** A (closed): `itc-publish-fanout` stamps `variants[*].switches` from the plan into each variant file's metadata right before the send (V3). Adapted files never carry the switch themselves.
- **Q: What are the stage exit codes?** A (closed):
  - A per-target failure does not crash the stage: it exits 0 with `ok:false` for that target in the aggregate.
  - A nonzero exit is reserved for plan or I/O errors.
- **Q: What harness runs the tail integration test?** A (closed):
  - The real stage runner plus `kk executor fan-out` with `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`, following the pattern at `apps/cli/tests/fanout.test.ts:953-980`.
  - All three targets honor the fake env: `zenn-pub/src/index.ts:237`, `qiita-pub/src/index.ts:183` and `surfdash-pub/src/index.ts:533`.
  - The dry-run walk reuses the pattern at `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:431-438`.
- **Premises (verified):** `file-read-into-var` exists as a spur action kind (spur `packages/app/src/workflow/actions/file-read-into-var.ts:5`), for reading the cursor and plan fields into vars.
- **Dependencies:** 0149 (`itc-stages.ts`, `itc-report`) and 0150 (`itc-materialize`, `itc-publish-plan`, `TARGET_PROFILES`).

### Design

Approach:
- YAML only routes.
- `itc-publish-fanout` and `itc-publish-next` own the sequencing, reusing `kk executor fan-out` and its `--retry-from`.
- Browser targets loop over `agent.run` with a file cursor, because the engine is sequential and has no foreach (ADR-019).

Reason: this reuses the shipped fan-out and `kk:publish` without a new sequencer. It also keeps the switch stamp right next to the send (V3).

Rejected:
- One `agent.run` that publishes all browser targets. It would give no per-target Result or bound.
- A new `kk publish` noun, which is barred by R19 and the `kk:publish` skill contract.

Invariants:
- V3: switches are stamped at send time.
- V4: a live run always pauses at publish-confirm.
- V5: retry ≤ 1, and the browser loop is bounded by the plan.
- Target failures never crash the stage.

### Plan

1. Implement `itc-publish-fanout`, `itc-publish-next` and the per-target `itc-report` extension, with unit tests.
2. Add the tail vars, states and edges to `kk-itc.yaml`, plus structural asserts.
3. Write the tail integration test on fake transports, and the dry-run walk.
4. Sync `docs/04_DESIGN.md`, then run `bun run lint`, `bun run test` and `bun run build`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-itc-workflow.test.ts:106` |
| `apps/cli/tests/kk-itc-workflow.test.ts:2` |
| `plugins/kk/scripts/kk-workflow-stages.ts:15` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1673` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1705` |
| `plugins/kk/scripts/kk-workflow-stages.ts:26` |
| `plugins/kk/scripts/kk-workflow-stages.ts:74` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-itc.yaml:189,218,242,245,260,268,278,318` (publish-entry, publish-plan, publish-gate, publish-confirm, publish-fanout, publish-retry, publish-agent, report); structural test `apps/cli/tests/kk-itc-workflow.test.ts:20` (frozen machine walkable) |
| R2 | MET | `plugins/kk/workflows/kk-itc.yaml:34-39` (publish_targets/publish_live/source_locale/browser_target, publish_live default false); test `apps/cli/tests/kk-itc-workflow.test.ts:133` |
| R3 | MET | `plugins/kk/workflows/kk-itc.yaml:245-258` (publish-confirm hitl.confirm prompt + declined marker write), `:623`/`:691` (declined → report without any publish call); HITL action test `apps/cli/tests/kk-itc-workflow.test.ts:38` |
| R4 | MET | `plugins/kk/scripts/itc-stages.ts:472` (itcPublishFanout); test `apps/cli/tests/itc-stages.test.ts:746` (stamps switches, routing markers) |
| R5 | MET | `plugins/kk/scripts/itc-stages.ts:368` + `:223` (source-locale rules in plan); test `apps/cli/tests/itc-stages.test.ts:608` |
| R6 | MET | `plugins/kk/scripts/itc-stages.ts:15-19` (report contract: per-target ok/url/error, ok:false rows, retry command); test `apps/cli/tests/itc-stages.test.ts:650` (report publish section) and `:746` (fan-out failure kept as data) |
| R7 | MET | `plugins/kk/workflows/kk-itc.yaml:278` (publish-agent loop) + `plugins/kk/scripts/itc-stages.ts:526` (itcPublishNext cursor); test `apps/cli/tests/itc-stages.test.ts:832` (cursor walks browser targets, empties when done) |
| R8 | MET | `plugins/kk/scripts/itc-stages.ts:174` (--retry-from re-send of ok:false rows), `plugins/kk/workflows/kk-itc.yaml:275-276` (.publish-retry-count cap + --retry); test `apps/cli/tests/itc-stages.test.ts:746` |
| R9 | MET | command `bun run gate` 2026-09-22 exit 0 (1231 pass / 0 fail) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/kk/workflows/kk-itc.yaml:245-253` (publish-confirm pauses with hitl.confirm listing targets + draft/live mode); HITL confirm action test `apps/cli/tests/kk-itc-workflow.test.ts:38` |
| AC2 | MET | test | `plugins/kk/workflows/kk-itc.yaml:623` (declined → report without any publish call) + `:691` (outcome declined terminal); dry-run walk test `apps/cli/tests/kk-itc-publish-tail.test.ts:140` reaches done with no send |
| AC3 | MET | test | `apps/cli/tests/itc-stages.test.ts:746` (itc-publish-fanout drives kk fan-out per group, stamps switches, writes routing markers) |
| AC4 | MET | test | `apps/cli/tests/itc-stages.test.ts:746` (exit-1 seed kept as data) + `:650` (report carries per-target ok/url/error rows, failed outcome) |
| AC5 | MET | test | `apps/cli/tests/itc-stages.test.ts:832` (itc-publish-next cursor empties when done) |
| AC6 | MET | test | `apps/cli/tests/itc-stages.test.ts:650` (report reads publish-plan.json and result files, carries per-target rows) |
| AC7 | MET | test | `apps/cli/tests/kk-itc-publish-tail.test.ts:63` (seeded tail on KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake: zenn/qiita/surfdash draft ok, report done) |
| AC-11 | MET | test | alias of AC1: `plugins/kk/workflows/kk-itc.yaml:245-253`; test `apps/cli/tests/kk-itc-workflow.test.ts:38` |
| AC-12 | MET | test | alias of AC2: `plugins/kk/workflows/kk-itc.yaml:623,691`; test `apps/cli/tests/kk-itc-publish-tail.test.ts:140` |
| AC-13 | MET | test | alias of AC3: `apps/cli/tests/itc-stages.test.ts:746` |
| AC-14 | MET | test | alias of AC4: `apps/cli/tests/itc-stages.test.ts:746,650` |
| AC-15 | MET | test | alias of R8: `plugins/kk/scripts/itc-stages.ts:174`; test `apps/cli/tests/itc-stages.test.ts:746` |
| AC-16 | MET | test | alias of AC6: `apps/cli/tests/itc-stages.test.ts:650` |
| AC-18 | MET | test | alias of AC7: `apps/cli/tests/kk-itc-publish-tail.test.ts:63` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0151 round 2 (sp-dev-review --auto, working-tree diff vs HEAD, post test-fix)

**Scope:** uncommitted diff (12 files: kk-itc.yaml, kk-workflow-stages.ts, itc-stages.ts, itc-stages.test.ts, kk-itc-workflow.test.ts, kk-itc-publish-tail.test.ts, docs) vs task spec Requirements R1-R7 / AC1-AC7
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** APPROVED (0 blocker / 0 major / 1 minor / 3 advisory) — all three round-1 majors verified fixed. Fresh evidence: `bun test kk-itc-publish-tail itc-stages kk-itc-workflow` = 54 pass / 0 fail (9.28s; itc-stages.ts 97.37% line / 92.16% branch); `bun run lint` exit 0; `bun run build` exit 0

##### Fix verification (round 1 → round 2)

| Round-1 finding | Fix | Verified |
|---|---|---|
| R6/AC7 unmet: no fake-transport integration test, no targets-set dry-run walk | `apps/cli/tests/kk-itc-publish-tail.test.ts:62-117` — real stage runner + real `kk executor fan-out` on `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` for zenn-pub/qiita-pub/surfdash-pub; asserts `4-publish/content.json`, draft-mode ok Result per target (V3 stamps `metadata.published:false` on content.json and the ja variant), report targets/outcome/retryCommands; `:130-165` dry-run walk with `auto:true` AND `publish_targets` set reaches `done` | test passes fresh; walk exits 0 |
| R7 unmet: 04_DESIGN.md not synced | `docs/04_DESIGN.md:633` — full publish-tail paragraph: 4 launch vars, all four new `itc-*` stages, plan-time adapt rejection, `4-publish/` + `5-report/` artifacts, V3/V4/V5 semantics, declined routing | vars/stages/artifacts grep hits present |
| major: adapt:true variant hole → fanout dies exit 1 mid-tail | Plan-time rejection (root cause): `plugins/kk/scripts/itc-stages.ts:424-435` — fails by name *before* `publish-plan.json` is written, with the remediation path ("restrict publish_targets to the source locale"); regression test `kk-itc-publish-tail.test.ts:119-128` asserts exit 1, stderr names `content.ja-article.json` + "adaptation", and no plan file is created | regression test passes fresh |

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | architecture | Carried from round 1: 0151-specific structural asserts on kk-itc.yaml guards (publish-gate, publish-confirm decline path, retry cap, agent-loop bound) are still absent; accepted for this round because the dry-run walk exercises the same guards end-to-end — add `guardOf` asserts when next touching this file | `apps/cli/tests/kk-itc-workflow.test.ts:107-287` |
| 2 | P4 (advisory) | correctness | `loadItcStages` catch-all reports any import failure as "not found" — consider rethrowing non-module-resolution errors | `plugins/kk/scripts/kk-workflow-stages.ts:79-87` |
| 3 | P4 (advisory) | architecture | `PublishPlan.variants[*].adapt/limits` computed but consumed only by the plan-time rejection until the adapt slice lands — deliberate deferral, revisit then | `plugins/kk/scripts/itc-stages.ts:359,401` |
| 4 | P4 (advisory) | security | Launch-var shell interpolation into guard/stage commands — pre-existing operator-trust pattern, no new exposure class | `plugins/kk/workflows/kk-itc.yaml:187-262` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | vars `kk-itc.yaml:32-37`; 9 states `:187-262`; judge PASS → publish-entry `:471`; draft-review yes → publish-entry `:417` |
| R2 | MET | gate `:530-543`; confirm lists targets+mode `:209-221`; decline marker → report; outcome `declined`, no send `itc-stages.ts:150-170` |
| R3 | MET | V3 stamping `itc-stages.ts:451-455`; one spawn per group `:456-470`; exit 1 = data (aggregate rows + `.fanout-failed`); `--retry` only failed groups `aggregateHasFailures :440-446`; cap `.publish-retry-count < 1` `kk-itc.yaml:565-570` |
| R4 | MET | cursor writer `itc-stages.ts:512-540`; publish-agent binds cursor, runs kk:publish, `expectFile` result.<target>.json `kk-itc.yaml:243-260`; self-loop ends on empty cursor `:578-609` |
| R5 | MET | per-target ok/url/error + exact retry command `itc-stages.ts:169-175`; any ok:false → outcome failed `:176-180` |
| R6 | MET | fix-verification row 1 — named file exists, fake transports, draft ok Results, report asserts, targets-set dry-run walk |
| R7 | MET | fix-verification row 2 — `docs/04_DESIGN.md:633` |

AC1-AC7 MET (AC7 now evidenced by `kk-itc-publish-tail.test.ts` on the fake transport + dry-run walk). Task-local check: no test performs a real network publish — fake transport and dry-run only; holds.

##### Architecture

Unchanged from round 1 and still sound: `itc-stages.ts` is a deep node-builtins-only module (97.37% line / 92.16% branch on the targeted run), lazily imported by the runner with a loud failure path; flat marker files (`.fanout-failed`, `.next-browser`, `.publish-declined`) match the `.revise-count` convention and keep YAML guards to one predicate; retry cap and browser-loop bound live in deterministic code/guards (V5 holds). The plan-time adapt rejection deepens the seam: the tail can no longer enter the send path in a state the later adapt slice hasn't produced.

**Next:** approved — proceed to record/verdict in the pipeline (implementer's lane); advisories carry to the adapt slice.

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History

- 2026-09-22T21:06:40.968Z todo → wip (system)
- 2026-09-22T21:51:40.841Z wip → testing (system)
- 2026-09-22T22:03:22.170Z testing → done (system)

