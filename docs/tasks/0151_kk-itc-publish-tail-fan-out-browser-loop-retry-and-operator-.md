---
schema_version: 1
name: "kk-itc publish tail: fan-out, browser loop, retry and operator confirm"
status: todo
template: feature-impl
created_at: 2026-09-22T16:46:32.546Z
updated_at: "2026-09-22T16:51:22.877Z"
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

- [ ] R1. Add the vars `publish_targets` (""), `publish_live` (false), `source_locale` (en) and `browser_target` ("") to `kk-itc.yaml`. Add the states publish-entry, materialize, publish-plan, publish-gate, publish-confirm, publish-fanout, publish-retry, publish-agent and report. Wire the edges per the §3 table, including judge PASS and draft-review yes going to publish-entry when targets are set.
- [ ] R2. publish-confirm (a confirm action) lists every target and the draft or live mode. It is entered when `auto` is false or `publish_live` is true. Answering no routes to report with outcome `declined` and makes no publish call.
- [ ] R3. `kk stage itc-publish-fanout <work_dir> [--retry]`:
  - Writes each variant's `switches` into that variant file's `metadata`.
  - Spawns `kk executor fan-out --content <variant> --target … --out 4-publish/fanout-result.<variant>.json` once per group.
  - Treats target failures as data, not exit 1.
  - With `--retry`, passes `--retry-from` only for groups that have `ok:false` results. `.publish-retry-count` caps retries at 1.
- [ ] R4. `kk stage itc-publish-next <work_dir>` writes `4-publish/.next-browser`. publish-agent reads it into `browser_target` and runs `agent.run kk:publish ${browser_target}` on that target's variant, which writes `4-publish/result.<target>.json`. A failed agent step still writes an `ok:false` Result. The self-loop ends when no browser target is pending.
- [ ] R5. `itc-report` adds each target's ok, url or error and prints the exact `kk executor fan-out --retry-from …` command for failed fan-out targets. Any `ok:false` sets outcome `failed`.
- [ ] R6. `apps/cli/tests/kk-itc-publish-tail.test.ts` runs the tail stages from a seeded work dir with `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` for zenn-pub, qiita-pub and surfdash-pub. It asserts content.json, a draft-mode ok Result per target, and the report. A `spur workflow run --dry-run` walk with `auto` true and targets set reaches done.
- [ ] R7. Sync the `docs/04_DESIGN.md` vars, stages and artifacts in the same commit (T3).

### Acceptance Criteria

- [ ] AC1 — Interactive publish pauses for an operator answer before sending
- [ ] AC2 — Auto mode sends drafts unless publish_live was set at launch
- [ ] AC3 — API and file-cli targets publish through kk executor fan-out
- [ ] AC4 — Browser targets publish through kk:publish agent steps
- [ ] AC5 — Failed fan-out targets are re-sent once through --retry-from
- [ ] AC6 — itc-report summarizes the verdict, revisions and per-target outcomes
- [ ] AC7 — Fixture run of the publish tail reaches platform drafts on fake transports

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History
