---
schema_version: 1
name: "kk ledger: per-workflow run ledger from spur action_runs"
status: done
template: feature-impl
created_at: 2026-10-07T03:58:06.074Z
updated_at: "2026-10-07T23:34:30.987Z"
feature_id: G71
priority: P1
tags:
  - ledger
  - observability
estimate_hours: 4

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0207-verdict.json
---

## 0207. kk ledger: per-workflow run ledger from spur action_runs

### Background

Implements: R1 — Each workflow run appends a summary row block to its ledger; R2 — Unreported token usage renders as unknown, never estimated.

Design: docs/design/kk-collect-and-daily-voice2.md §7. Evidence (run f2d6921f, `spur workflow trace <id> --json`):
- Action events carry `node`, `actionKind`, `status`, `durationMs`, `ok`, `error` and `cost`.
- Agent events carry `cost.exact.totals.{inputTokens,outputTokens,cacheReadTokens}`, even though `action_runs.result_json.usage.availability` is `unavailable` for the pi executor.

### Requirements

- [x] R1. `kk ledger append --workflow <name> --run <run-id> [--works-dir .works]` spawns `spur workflow trace <run-id> --json` and appends one run section to `<works-dir>/<workflow>/ledger.md`, creating the file with a `# <workflow> ledger` heading when absent.
- [x] R2. Section heading: `## <startedAt, UTC minute> · run <runId first 8> · <status> · <durationMs as XhYmZs> · tokens: <in>/<out> (+<n> unknown)`, plus an HTML comment `<!-- run:<full runId> -->` as the idempotency key.
- [x] R3. Per-step table `| Step | Status | Duration | Tokens in/out | Result |`. Rows come from `events[]` with `kind == "action"` grouped by `node` in first-seen order. Duration is the sum of `durationMs`. Status is `failed` if any action failed, else the last action's status.
- [x] R4. Tokens: a step with no `agent.run` action renders `—`. Agent steps sum `cost.exact.totals.inputTokens` / `outputTokens`. If any agent action has `cost.exact == null` (including when only `cost.estimated` exists), the step renders `unknown` and counts toward the header's unknown total. Values are never estimated.
- [x] R5. Result cell: first line of `<work_dir>/<node>.summary.txt` when the workflow passes `--work-dir` and the file exists; else the first failing action's `error`; else `ok`. Pipes are escaped and the cell is cut to 120 chars.
- [x] R6. `kk ledger sync --workflow <name>` lists `spur workflow trace --workflow <name> --json` (`.entries[]`, `status != running`) and appends a section for every runId without a `<!-- run:... -->` marker, oldest first. Running the same run id twice writes nothing.
- [x] R7. A run still `running`, an unknown run id, or a trace JSON missing `run`/`events` exits 1 with `kk.ledger.<reason>` and does not touch the file.

### Acceptance Criteria

- [x] AC1 — Each workflow run appends a summary row block to its ledger
- [x] AC2 — Unreported token usage renders as unknown, never estimated

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
- `apps/cli/src/cli.ts` and `apps/cli/tests/main.test.ts` (the `kk --help` visible-command assertion must name the new first-layer noun)
- `apps/cli/tests/ledger.test.ts` (renderer/E2E) and `apps/cli/tests/commands/ledger.test.ts` (command-noun surface — required by the repo rule `require-corresponding-test`, which mirrors every `apps/cli/src/commands/<noun>.ts` into `apps/cli/tests/commands/<noun>.test.ts`) + `apps/cli/tests/fixtures/trace-*.json`
- `docs/04_DESIGN.md`

Key signatures:
- `renderLedgerSection(trace: TraceJson, opts: { workDir?: string }): string`
- `ledgerHasRun(markdown: string, runId: string): boolean`
- the `spur` spawn reuses the existing `Bun.spawnSync` style of `apps/cli/src/invoke.ts`

Note: R6's "failed runs included" is the only path that records fail-fast DAG runs. Both workflows call `kk ledger sync` in their first node (tasks 0208/0211).

### Plan

- [x] Failure-first list (running run, unknown id, trace without events, agent step with `cost: null`, estimated-only cost, unwritable works dir, duplicate append, pipe in an error message).
- [x] Capture fixtures: trimmed `spur workflow trace f2d6921f… --json`, a synthetic failed run and an estimated-only agent event, under `apps/cli/tests/fixtures/`.
- [x] `ledger.ts` renderer + `commands/ledger.ts` append/sync; register.
- [x] E2E `apps/cli/tests/ledger.test.ts`: render fixtures (golden markdown), append twice → one section, sync over a stubbed trace list fills the gap, unknown counted. Write the produced `ledger.md` to `.works/test-artifacts/0207/`.
- [x] `docs/04_DESIGN.md` `kk ledger append|sync` rows; `bun run gate`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/cli.ts:24` |
| `apps/cli/src/cli.ts:3` |
| `apps/cli/tests/main.test.ts:52` |
| `apps/cli/tests/main.test.ts:60` |
| `apps/cli/tests/main.test.ts:65` |
| `docs/04_DESIGN.md:363` |
| `docs/04_DESIGN.md:66` |
| `docs/04_DESIGN.md:77` |
| `docs/04_DESIGN.md:82` |
| `apps/cli/src/commands/ledger.ts:1` |
| `apps/cli/src/ledger.ts:1` |
| `apps/cli/tests/commands/ledger.test.ts:1` |
| `apps/cli/tests/fixtures/trace-agent-done.json:1` |
| `apps/cli/tests/fixtures/trace-failed.json:1` |
| `apps/cli/tests/fixtures/trace-missing-events.json:1` |
| `apps/cli/tests/fixtures/trace-running.json:1` |
| `apps/cli/tests/fixtures/trace-token-modes.json:1` |
| `apps/cli/tests/ledger.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/ledger.ts:50` spawns the trace via an argv executor (no shell), `apps/cli/src/commands/ledger.ts:144` appends one section; `apps/cli/tests/ledger.test.ts:250`; live re-run against the installed spur wrote `.works/test-artifacts/0207/live-spur-sync/` (20 kk-daily-ai-voice + 15 task-pipeline sections) |
| R2 | MET | `apps/cli/src/ledger.ts:286` header + marker, `apps/cli/src/ledger.ts:170` duration format; golden `apps/cli/tests/ledger.test.ts:138`, boundaries `apps/cli/tests/ledger.test.ts:211` |
| R3 | MET | `apps/cli/src/ledger.ts:197` groups action events by node in first-seen order, `apps/cli/src/ledger.ts:245` sums duration and derives status; `apps/cli/tests/ledger.test.ts:138` |
| R4 | MET | `apps/cli/src/ledger.ts:250` marks a step unknown when any agent action lacks exact cost (estimated never read), `apps/cli/src/ledger.ts:271` renders an em dash for non-agent steps; `apps/cli/tests/ledger.test.ts:170`; live run fa1ea1ec renders 3 unknown agent steps and header `(+3 unknown)`, matching its raw trace (3 agent actions, exact and estimated both null) |
| R5 | MET | `apps/cli/src/ledger.ts:229` escapes pipes and cuts to 120, `apps/cli/src/ledger.ts:245` summary → failing error → ok; `apps/cli/tests/ledger.test.ts:192`, `apps/cli/tests/ledger.test.ts:284` |
| R6 | MET | `apps/cli/src/ledger.ts:320` skips running and marker-present runs, oldest first; `apps/cli/src/commands/ledger.ts:168`; `apps/cli/tests/ledger.test.ts:314`; live: second task-pipeline sync appended [] and kept 15 sections, the 5 running runs were skipped |
| R7 | MET | `apps/cli/src/commands/ledger.ts:66` maps not-found / spawn failure / running, `apps/cli/src/commands/ledger.ts:198` exits 1 via CommanderError; `apps/cli/tests/ledger.test.ts:350`, `apps/cli/tests/commands/ledger.test.ts:67`; live: a running run printed kk.ledger.run.running and an unknown id printed kk.ledger.trace.not-found, with no ledger directory created |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Each workflow run appends a summary row block to its ledger | MET | test | `apps/cli/tests/ledger.test.ts:250`, `apps/cli/tests/ledger.test.ts:314` — `bun test apps/cli/tests/ledger.test.ts apps/cli/tests/commands/ledger.test.ts` 14 pass / 0 fail this run; live sync against real traces under `.works/test-artifacts/0207/live-spur-sync/` |
| AC2 — Unreported token usage renders as unknown, never estimated | MET | test | `apps/cli/tests/ledger.test.ts:170` (absent, null-exact and estimated-only all render unknown); live run fa1ea1ec cross-checked against its raw trace |
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

- 2026-10-07T07:36:14.726Z todo → wip (system)
- 2026-10-07T07:46:50.200Z wip → testing (system)
- 2026-10-07T07:47:00.295Z testing → done (system)

