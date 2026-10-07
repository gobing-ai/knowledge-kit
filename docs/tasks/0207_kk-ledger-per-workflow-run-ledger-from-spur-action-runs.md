---
schema_version: 1
name: "kk ledger: per-workflow run ledger from spur action_runs"
status: done
template: feature-impl
created_at: 2026-10-07T03:58:06.074Z
updated_at: "2026-10-07T07:47:00.302Z"
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
| R1 | MET | `apps/cli/src/commands/ledger.ts:50` spawns `spur workflow trace <run-id> --json` through the `NodeSyncProcessExecutor` argv seam; `apps/cli/src/commands/ledger.ts:144` renders + appends one section and defaults `--works-dir` to `.works`. `bun test apps/cli/tests/ledger.test.ts` → `apps/cli/tests/ledger.test.ts:250` asserts exactly one `# task-pipeline ledger` heading, one `<!-- run:… -->` marker and byte-identical content on a repeat run; real-spur artifact `.works/test-artifacts/0207/live/task-pipeline/ledger.md`. |
| R2 | MET | `apps/cli/src/ledger.ts:286` (header) + `apps/cli/src/ledger.ts:170` (`XhYmZs`). Golden asserted in `apps/cli/tests/ledger.test.ts:138`: `## 2026-10-07T07:00Z · run b419ba8d · done · 14m04s · tokens: 0/0 (+3 unknown)` with marker `<!-- run:b419ba8d-71cf-4a28-93f1-d064d2c712d0 -->` on the next line (`:144`); `startedAt` is converted to UTC then sliced to the minute (`apps/cli/src/ledger.ts:220`). |
| R3 | MET | `apps/cli/src/ledger.ts:197` (`stepGroups`: `kind == "action"`, grouped by `node` in first-seen order) and `apps/cli/src/ledger.ts:245` (`stepRow`: summed `durationMs`, `failed` if any action failed else the last action's status). Golden over `apps/cli/tests/fixtures/trace-agent-done.json` in `apps/cli/tests/ledger.test.ts:148` returns 8 rows in first-seen order including ` |
| R4 | MET | `apps/cli/src/ledger.ts:250` (`cost?.exact == null` ⇒ whole step unknown, `cost.estimated` never read) + `apps/cli/src/ledger.ts:271` (`—` when no `agent.run`). `apps/cli/tests/ledger.test.ts:170` over `apps/cli/tests/fixtures/trace-token-modes.json` asserts exactly `tokens: 2000/400 (+2 unknown)`, two-action exact sum `2000/400`, `translate`/`summarize` → `unknown`, `collect` → `—`, and `expect(section).not.toContain('999')`. |
| R5 | MET | `apps/cli/src/ledger.ts:229` (`resultCell`: first line, `\|` escaped, sliced to 120) and `apps/cli/src/ledger.ts:245` (summary → first failing `error` → `ok`). `apps/cli/tests/ledger.test.ts:192` asserts the escaped cell is exactly 120 chars, contains no `\n`, and that a supplied summary wins; `apps/cli/tests/ledger.test.ts:284` produces ` |
| R6 | MET | `apps/cli/src/ledger.ts:320` (`selectMissingRuns`: skips `running`, skips marker-present ids, sorts by `startedAt` — ISO strings sort oldest-first) + `apps/cli/src/commands/ledger.ts:168` (`syncAction`, one write per invocation). `apps/cli/tests/ledger.test.ts:314` asserts `appended == [agent-done, failed]` (oldest first), `live-run` absent, and a second sync reports `"appended":[]` with unchanged file bytes; live real-spur run `.works/test-artifacts/0207/live/sync.json` appended 1 historical run into an existing ledger without adding a heading. |
| R7 | MET | `apps/cli/src/commands/ledger.ts:66` (non-zero spawn ⇒ `trace.not-found` when spur's stderr says "not found", else `trace.spawn-failed`; `status === 'running'` ⇒ `run.running`) and `apps/cli/src/commands/ledger.ts:198` (`failLoud` → `consoleOutput.error` + `CommanderError(1)`, no `process.exit`). `apps/cli/tests/ledger.test.ts:350` drives running / unknown id / missing-`events` / missing binary, each `code === 1` with no ledger file on disk; `.works/test-artifacts/0207/ledger-failure-reasons.txt` records the four reasons with `ledger created: false`. Re-confirmed the real classifier myself: `spur workflow trace does-not-exist-xyz --json` → exit 1, stderr `Run not found: does-not-exist-xyz`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Each workflow run appends a summary row block to its ledger | MET | test | `apps/cli/tests/ledger.test.ts:250` (one heading, one section per run, repeat append is a no-op) and `apps/cli/tests/ledger.test.ts:314` (sync appends one block per unrecorded finished run); corroborated by the real-spur artifact `.works/test-artifacts/0207/live/task-pipeline/ledger.md` (two run sections under one `# task-pipeline ledger` heading). |
| AC2 — Unreported token usage renders as unknown, never estimated | MET | test | `apps/cli/tests/ledger.test.ts:170` over `apps/cli/tests/fixtures/trace-token-modes.json`: `cost` absent, `cost.exact: null`, and `estimated`-only all render `unknown` and increment the header's `(+2 unknown)`; the estimated figures `999/111` are asserted absent from the rendered section, and `apps/cli/src/ledger.ts:250` never reads `cost.estimated`. On the recorded real run `apps/cli/tests/fixtures/trace-agent-done.json` all three agent steps render `unknown` (`(+3 unknown)`), matching the project DB's `{exact: null, estimated: null}` state. |
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

