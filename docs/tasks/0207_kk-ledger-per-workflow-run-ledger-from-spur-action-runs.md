---
schema_version: 1
name: "kk ledger: per-workflow run ledger from spur action_runs"
status: todo
template: feature-impl
created_at: 2026-10-07T03:58:06.074Z
updated_at: "2026-10-07T05:06:29.576Z"
feature_id: G71
priority: P1
tags:
  - ledger
  - observability
estimate_hours: 4

---

## 0207. kk ledger: per-workflow run ledger from spur action_runs

### Background

Implements: R1 — Each workflow run appends a summary row block to its ledger; R2 — Unreported token usage renders as unknown, never estimated.

Design: docs/design/kk-collect-and-daily-voice2.md §7. Evidence (run f2d6921f, `spur workflow trace <id> --json`):
- Action events carry `node`, `actionKind`, `status`, `durationMs`, `ok`, `error` and `cost`.
- Agent events carry `cost.exact.totals.{inputTokens,outputTokens,cacheReadTokens}`, even though `action_runs.result_json.usage.availability` is `unavailable` for the pi executor.

### Requirements

- [ ] R1. `kk ledger append --workflow <name> --run <run-id> [--works-dir .works]` spawns `spur workflow trace <run-id> --json` and appends one run section to `<works-dir>/<workflow>/ledger.md`, creating the file with a `# <workflow> ledger` heading when absent.
- [ ] R2. Section heading: `## <startedAt, UTC minute> · run <runId first 8> · <status> · <durationMs as XhYmZs> · tokens: <in>/<out> (+<n> unknown)`, plus an HTML comment `<!-- run:<full runId> -->` as the idempotency key.
- [ ] R3. Per-step table `| Step | Status | Duration | Tokens in/out | Result |`. Rows come from `events[]` with `kind == "action"` grouped by `node` in first-seen order. Duration is the sum of `durationMs`. Status is `failed` if any action failed, else the last action's status.
- [ ] R4. Tokens: a step with no `agent.run` action renders `—`. Agent steps sum `cost.exact.totals.inputTokens` / `outputTokens`. If any agent action has `cost.exact == null` (including when only `cost.estimated` exists), the step renders `unknown` and counts toward the header's unknown total. Values are never estimated.
- [ ] R5. Result cell: first line of `<work_dir>/<node>.summary.txt` when the workflow passes `--work-dir` and the file exists; else the first failing action's `error`; else `ok`. Pipes are escaped and the cell is cut to 120 chars.
- [ ] R6. `kk ledger sync --workflow <name>` lists `spur workflow trace --workflow <name> --json` (`.entries[]`, `status != running`) and appends a section for every runId without a `<!-- run:... -->` marker, oldest first. Running the same run id twice writes nothing.
- [ ] R7. A run still `running`, an unknown run id, or a trace JSON missing `run`/`events` exits 1 with `kk.ledger.<reason>` and does not touch the file.

### Acceptance Criteria

- [ ] AC1 — Each workflow run appends a summary row block to its ledger
- [ ] AC2 — Unreported token usage renders as unknown, never estimated

Testing: before writing code, list every way the unit can fail (failure-first list in the task), then code; prove behavior with one E2E-style bun:test over a temp dir / temp DB, leaving a repeatable artifact under .works/test-artifacts/.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T03:59:05.928Z

- Timing source: `spur workflow trace --json` (action_runs `duration_ms`), not kk `step-timing.json`. That way it works for every workflow.
- Tokens: render `unknown` when usage availability is not `available`. Estimating is rejected because it misleads.
- Failed DAG runs never reach the final node. `kk ledger sync` at the next run's start covers them, so no exit hook is needed.

### Design

Chosen: render from spur's own trace JSON instead of kk timing files, so every workflow, including future ones, gets a ledger with authoritative timing. Shape verified 2026-10-07 on f2d6921f:
- `{ run: { runId, workflowName, status, startedAt, completedAt, durationMs, outcome }, events: [{ kind: 'action'|'phase'|'transition', ... }] }`.
- The list form is `{ entries: [...], total }`.

Rejected:
- parsing `step-timing.json` (voice-only, wall-clock);
- reading `.spur/spur.db` directly (spur schema is not kk's contract);
- estimating tokens from text length (misleading).

Invariants:
- The file is append-only, with one section per run id (the marker comment).
- sync never rewrites existing sections.
- The renderer is pure; only the command spawns spur and writes.

Files:
- `apps/cli/src/ledger.ts` (pure `renderLedgerSection`, `parseTrace` with a zod-free type guard)
- `apps/cli/src/commands/ledger.ts` (`registerLedgerCommand`)
- `apps/cli/src/cli.ts`
- `apps/cli/tests/ledger.test.ts` + `apps/cli/tests/fixtures/trace-*.json`
- `docs/04_DESIGN.md`

Key signatures:
- `renderLedgerSection(trace: TraceJson, opts: { workDir?: string }): string`
- `ledgerHasRun(markdown: string, runId: string): boolean`
- the `spur` spawn reuses the existing `Bun.spawnSync` style of `apps/cli/src/invoke.ts`

Note: R6's "failed runs included" is the only path that records fail-fast DAG runs. Both workflows call `kk ledger sync` in their first node (tasks 0208/0211).

### Plan

- [ ] Failure-first list (running run, unknown id, trace without events, agent step with `cost: null`, estimated-only cost, unwritable works dir, duplicate append, pipe in an error message).
- [ ] Capture fixtures: trimmed `spur workflow trace f2d6921f… --json`, a synthetic failed run and an estimated-only agent event, under `apps/cli/tests/fixtures/`.
- [ ] `ledger.ts` renderer + `commands/ledger.ts` append/sync; register.
- [ ] E2E `apps/cli/tests/ledger.test.ts`: render fixtures (golden markdown), append twice → one section, sync over a stubbed trace list fills the gap, unknown counted. Write the produced `ledger.md` to `.works/test-artifacts/0207/`.
- [ ] `docs/04_DESIGN.md` `kk ledger append|sync` rows; `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
