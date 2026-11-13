---
schema_version: 1
name: launchWorkflow and the plain generate / publish verbs
status: backlog
template: feature-impl
created_at: 2026-11-13T18:13:39.602Z
updated_at: "2026-11-13T18:42:36.830Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0360", "0363", "0364"]
---

## 0365. launchWorkflow and the plain generate / publish verbs

### Background

Phase 2 of G61 (ADR-053 §3, §5). Frozen contract: `docs/design/content-pipeline-consolidation.md` §1.1 (`generate`, `publish`) and §3 (launch contract with the keep/drop line maps for `plugins/kk/scripts/daily-scheduled-run.ts`, `scripts/daily-ai-news.ts`, `plugins/kk/scripts/voice3-publish-window.ts`). Today launching is a 581-line Bun script outside the binary plus two more scripts in front of it; `kk-itc` is launched with bare `spur workflow run` and has no supervisor at all. This task ports the supervisor into the binary as one function and exposes it as the plain verbs `generate` and `publish`. The new workflows do not exist yet, so the verbs are proven against a stub workflow and, by config override, against today's workflows.

Out of scope: writing `kk-news-generate`/`kk-article-generate`/`kk-publish` (0366–0368), editing or deleting any script (0369), the scheduler.

### Requirements

- [ ] R1. New `apps/cli/src/launch.ts` exports `launchWorkflow(opts): Promise<Receipt>` performing the six steps of design §3 in order. Every external effect goes through an injected `deps` object (`spawn`, `now`, `fs`, `lock`) so tests run without spur. The returned receipt has exactly the shape in design §3, including `executor` and `checkoutCommit`.
- [ ] R2. Lock name `<workflow>-<run>` via the same code path as `kk lock acquire` (0360). Held → exit 6 and **no write** to `schedule-receipt.json`.
- [ ] R3. Preflight ports `runPreflight` (`daily-scheduled-run.ts:157-212`): dirty harness paths (skipped by `--allow-dirty`), checkout-vs-install divergence, executor probe (`inline` probes role `scribe`). Failure → exit 5 and a receipt with `status: 'refused'` and `reason`. There is no `--skip-probe`.
- [ ] R4. Exactly one `spur workflow run <workflow> --vars …` child per invocation. Vars: `work_dir`, `run_date` or `slug`, `run_id`, `agent` (only when `--agent` is given; an empty value is never passed), `skill_dir` (generate only; from `resolveContentType().skillDir`, a missing skill is a preflight refusal, exit 5; the receipt records `writerSkill: {dir, sha256}` — design §2.2), plus per-verb vars from design §5.
- [ ] R5. Cleanup on exit, SIGINT, SIGTERM and timeout (`--timeout-ms`, default 13500000): `spur workflow cancel` if the run is still active, `kk store release`, `kk ledger sync`, lock release, final receipt — ported from `daily-scheduled-run.ts:294-423`. The lock is released on every path, including a throw inside cleanup.
- [ ] R6. New `apps/cli/src/commands/content-launch.ts` adds `generate` and `publish` to the 0363 verb list with the flags of design §1.1. The workflow name comes from `content_types.<type>.workflow` for `generate` and is the literal `kk-publish` for `publish`. Until 0366 ships that file, tests supply a stub `kk-publish.yaml` through the existing `workflows_dir` config override — no new config key and no env switch.
- [ ] R7. `publish` refuses with exit 5 when `<workDir>/4-publish/bundle.json` is missing or the generate receipt is `running`; with `--unattended`, a missing bundle plus an absent or `failed` receipt triggers exactly one `generate` and then continues (design §3.2). Window and CN-consent validation is ported from `voice3-publish-window.ts` and runs before the lock.
- [ ] R8. `generate --publish` launches `publish --window after-generate` in the same process after the generate workflow exits 0, forwarding `--channels`/`--live-channels`; it is two sequential `launchWorkflow` calls, each with its own lock and receipt.
- [ ] R9. `--dry-run` runs steps 1 and 3, prints the receipt with `status: 'refused'` or the planned argv under `dryRun`, takes no lock, writes nothing.
- [ ] R10. `docs/04_DESIGN.md` §1.14 lists `generate` and `publish` as shipped with the exit-code table. Same commit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A launch is refused while another holds the lock (req: R1, R2)
  Given a running launch for workflow W and run 20260101 with a receipt of status running
  When a second `kk news generate --run-date 20260101` starts
  Then it exits 6 and schedule-receipt.json is byte-identical to before

Scenario: AC2 — A dead executor refuses the launch before any spend (req: R1, R3, R9)
  Given an executor whose probe fails
  When `kk news generate` runs, and again with --dry-run
  Then both exit 5, no spur workflow process is spawned, and the non-dry run leaves a receipt with status refused and a reason naming the executor

Scenario: AC3 — Every exit path cleans up (req: R1, R4, R5)
  Given a stub workflow that (a) exits 0, (b) exits 1, (c) sleeps past --timeout-ms, (d) is interrupted by SIGTERM
  When `kk article generate --slug demo` runs against each
  Then exactly one workflow child was spawned per case, the lock is free afterwards in all four, release and ledger sync ran, and the receipt status is done, failed, timeout, failed respectively with executor and checkoutCommit set
  And the test writes .works/tmp/test-launch/summary.json

Scenario: AC4 — Publish finds or refuses the bundle (req: R6, R7, R8)
  Given a work dir with no bundle
  When `kk news publish --window cn-peak` runs, then again with --unattended and a failed generate receipt
  Then the first exits 5 naming 4-publish/bundle.json and the second launches generate exactly once before the publish workflow

Scenario: AC5 — Gate (req: R10)
  Given the change is applied
  When `bun run lint && bun run test && bun run build` run
  Then all exit 0
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T18:17:30.237Z

- **Why inject `deps`?** The four exit paths in AC3 cannot be exercised against the real engine in a unit gate; injection is the smallest seam that makes them testable. It is one object, not an interface hierarchy.
- **Does this change `daily-scheduled-run.ts`?** No. It keeps running the schedule until 0369. Both supervisors coexist; they take the same lock name so they exclude each other.
- **Is the interactive "offer to generate" prompt kept?** No (design §3.2). The operator runs `generate`.
- **Failure modes first.** Before writing `launch.ts`, list every way it can fail in the test file as named cases (lock held, probe dead, dirty tree, spawn ENOENT, non-zero exit, timeout, SIGINT, SIGTERM, cleanup throw, receipt unwritable) — then implement.

### Design

Owned files:

| File | Change |
| --- | --- |
| `apps/cli/src/launch.ts` | new |
| `apps/cli/src/commands/content-launch.ts` | new |
| `apps/cli/src/commands/content.ts` | append two entries (shared — dependency on 0363, 0364) |
| `apps/cli/tests/launch.test.ts`, `apps/cli/tests/content-launch.e2e.test.ts`, `apps/cli/tests/fixtures/workflows/stub-*.yaml` | new |
| `docs/04_DESIGN.md` | R10 |

Port, do not redesign: the line map in design §3.1 says which blocks of `daily-scheduled-run.ts` survive. Keep its ordering of cleanup calls and its refusal reasons verbatim so receipts stay comparable across the cut-over.

### Plan

1. Write the failure-mode list and the AC1–AC4 tests; confirm they fail.
2. `launch.ts`: resolve → lock → preflight → receipt → spawn → cleanup.
3. `content-launch.ts`: `generate`, `publish`, `--publish`, `--unattended`, `--dry-run`.
4. Manual check on this machine: `kk news generate --dry-run` and `kk news publish --window cn-peak --dry-run` print a receipt and spawn nothing. Paste both into Testing.
5. Docs; `bun run lint && bun run test && bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/content-pipeline-consolidation.md` §1.1, §3, §4.3. Decision: ADR-053 §3, §5.
- Depends on: 0360 (lock, probe, receipt fields), 0363, 0364. Blocks: 0366, 0367.
- Parent feature: G61, scenarios "A dead executor stops the run before it costs anything", "A second launch for the same workflow and day is refused" (re-proved for the in-binary launcher).

### History
