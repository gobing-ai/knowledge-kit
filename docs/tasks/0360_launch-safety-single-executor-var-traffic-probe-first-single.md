---
schema_version: 1
name: "Launch safety: single executor var, traffic probe first, single-flight lock, hard-fail writer"
status: backlog
template: feature-impl
created_at: 2026-11-13T17:31:13.660Z
updated_at: "2026-11-13T17:47:41.469Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P0
---

## 0360. Launch safety: single executor var, traffic probe first, single-flight lock, hard-fail writer

### Background

Phase 0 of feature G61 (ADR-053 decisions 3 and 5). Three launch defects, all observed in the 2026-11 review:

- **Two executor vars.** `kk-daily-ai-voice3.yaml` declares `agent` (L81) and `agent_retry` (L86);
  `kk-daily-safety.yaml` declares `agent` (L45) and `agent_retry: "claude"` (L49) — an executor that is
  disabled on the production machine. `scripts/daily-ai-news.ts:32-36` pins a second pair
  (`pi-deepseek` / `agy-gemini`) on top. A pinned name that loses quota fails the whole run (11-11, 11-12).
  voice3's nested `kk-daily-publish3` launch (L892) forwards no `agent` at all.
- **The traffic probe skips the default.** `plugins/kk/scripts/daily-scheduled-run.ts:181` probes only when
  `--agent` is not `inline`, so the default posture is never proven before the run spends its window.
  `kk-itc.yaml` is launched with bare `spur workflow run` and has no probe.
- **No single-flight guard.** Two launches for the same day share
  `<works>/kk-daily-ai-voice2/<YYYYMMDD>/` and the second overwrites `schedule-receipt.json` of the first
  (a `preflight-refused` receipt is written to the same path, L208).

Engine facts verified by experiment on 2026-11-13 (spur latest): an empty-string value for a declared var is
rejected (`--vars leaves declared vars unset: agent`, exit 1), so `inline` is the "unset" sentinel; an
undeclared key in `--vars` is tolerated (exit 0); `spur agent run --agent` accepts a role name, an executor
name, `auto` or `inline`.

Out of scope here: any new `kk` verb (Phase 2), any node removal (Phase 3), `kk-daily-ai-voice.yaml` and
`kk-daily-ai-voice2.yaml` (do not edit), and the template fallback after a failed script writer (F613,
0345 R9/R10 — a deliberate product decision that stays).

### Requirements

- [ ] R1. `agent_retry` is deleted from the `vars:` block of `plugins/kk/workflows/kk-daily-ai-voice3.yaml` and `plugins/kk/workflows/kk-daily-safety.yaml`. After the change, `rg -n 'agent_retry' plugins/kk/workflows/kk-daily-ai-voice3.yaml plugins/kk/workflows/kk-daily-safety.yaml` prints nothing.
- [ ] R2. The five retry nodes use the literal `agent: inline` and `role: reviewer`: voice3 `curate-fix` (L361) and `script-write-fix` (L447, role changes `scribe` → `reviewer`); safety `review-retry` (L91) and the two further nodes at L122 and L195. No other option of those nodes changes.
- [ ] R3. Every primary `agent.run` node in the six in-scope workflows (`kk-daily-ai-voice3`, `kk-daily-safety`, `kk-daily-publish3`, `kk-itc`, `kk-itc-author`, `kk-itc-publish-tail`) keeps `agent: ${vars.agent}`, and every nested `spur workflow run` forwards `agent`: voice3 L578 and L837 drop the `agent_retry` key; voice3 L892 (nested `kk-daily-publish3`) adds `\"agent\":\"${vars.agent}\"`. The `kk-itc` → `kk-itc-author` launch already forwards it and is unchanged.
- [ ] R4. `kk-daily-ai-voice3.yaml` and `kk-itc.yaml` gain a first node `executor-probe`: `kind: agent.run`, `role: scribe`, `agent: ${vars.agent}`, `timeoutMs: 120000`, `input: "Reply with exactly: OK"`, no `onError`. The current first node (`prepare` in both) lists it in `dependsOn`. Declared before `prepare` (nodes are in topological order).
- [ ] R5. `plugins/kk/scripts/daily-scheduled-run.ts` `runPreflight()` always probes unless `--skip-probe`: the probe target is `values.agent`, or the role `scribe` when it is `inline`. A failed probe is a refusal reason. The `--retry-agent` option, its probe (L183-188), the `agent_retry` var (L62, L70) and the `retryAgent` receipt field (L203, L537, L567) are removed.
- [ ] R6. `scripts/daily-ai-news.ts`: `PRODUCTION.agent` and `PRODUCTION.retryAgent` are removed; `generate` passes no `--agent` in the `--full` posture and `--agent planner` otherwise is replaced by passing nothing (role resolution happens in the workflow); the `--retry-agent` flag and its help text (L39, L44) are removed. An operator `--agent <name>` after `--` still reaches the wrapper. `plugins/kk/scripts/daily-triage-core.ts` drops `retryAgent` (L28, L302).
- [ ] R7. Single-flight: before `runPreflight()`, the wrapper runs `kk lock acquire --name "<workflow>-<stamp>" --run "<runId>" --ttl "<timeoutMs>"`. On `{"skipped":"locked","holder":…}` it prints `daily-scheduled-run: <workflow> <stamp> already running (holder <holder>)` to stderr and exits `6` **without writing the receipt file**. The lock is released (`kk lock release --name … --run …`) on the preflight-refused exit, in the signal handler path, and before the final `process.exit`.
- [ ] R8. Every receipt the wrapper writes carries `checkoutCommit` (output of `git -C <repo> rev-parse HEAD`, or `null` when git fails) and `executor` (`values.agent`).
- [ ] R9. `docs/04_DESIGN.md` and `docs/design/kk-daily-ai-voice3.md` no longer document `agent_retry` / `--retry-agent`; they state the single `agent` var, the probe node and exit code 6. Same commit as the code.

### Acceptance Criteria

```gherkin
Scenario: AC1 — One executor variable drives every agent node (req: R1, R2, R3, R6, R9)
  Given the six in-scope workflow files
  When `rg -n 'agent_retry|retry-agent|retryAgent' plugins/kk/workflows/kk-daily-ai-voice3.yaml plugins/kk/workflows/kk-daily-safety.yaml plugins/kk/scripts/daily-scheduled-run.ts plugins/kk/scripts/daily-triage-core.ts scripts/daily-ai-news.ts` runs
  Then it prints nothing
  And a DAG test asserts every `agent.run` node's `agent` is either `${vars.agent}` or the literal `inline` with `role: reviewer`
  And a DAG test asserts every nested `spur workflow run` in voice3 forwards `agent`
  And `spur workflow validate` accepts all six files

Scenario: AC2 — A dead executor stops the run before it costs anything (req: R4, R5)
  Given `spur` on PATH is a stub whose `agent run` exits 1
  When `bun plugins/kk/scripts/daily-scheduled-run.ts --workflow kk-daily-ai-voice3 --generate-only` runs with the default `--agent inline`
  Then it exits 5 with `status: "preflight-refused"`, a reason naming `scribe`, and the stub records no `workflow run` call
  And the voice3 and kk-itc DAG tests assert `executor-probe` is the only node without `dependsOn`

Scenario: AC3 — A second launch for the same workflow and day is refused (req: R7, R8)
  Given the lock `kk-daily-ai-voice3-<stamp>` is held by run `A` and `schedule-receipt.json` exists
  When the wrapper is launched again for the same workflow and day
  Then it exits 6, stderr names holder `A`, and `schedule-receipt.json` is byte-identical
  And after a normal or refused run `kk lock acquire` for the same name succeeds again
  And every written receipt has `checkoutCommit` and `executor`
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T17:47:37.243Z

- **Why `inline` and not an empty default?** Spur rejects an empty value for a declared var (verified 2026-11-13). `inline` resolves the node's `role` through the ladder in `~/.config/spur/config.yaml`.
- **How does a retry differ from the primary without a second var?** By role: retries are `role: reviewer` + literal `agent: inline`, which resolves above `scribe`. When the operator pins `agent`, primaries use the pin and retries still resolve by role, so a dead pin has a live fallback.
- **Probe in the wrapper and as a node — why both?** ADR-053 §5 makes the node the rule (it covers bare `spur workflow run`, the only way `kk-itc` is launched). The wrapper probe is kept because it refuses before a run row and a work dir exist. Cost: one extra one-line prompt.
- **Does voice2 break?** No. `kk-daily-ai-voice2.yaml` is not edited; it still passes `agent_retry` to `kk-daily-safety`, and an undeclared var is tolerated. Its safety retries then resolve by role instead of its pin — accepted, voice2 is not scheduled.
- **Publish-window launches (`daily-ai-news.ts publish`) take no lock here.** They do not go through the wrapper; the lock moves with the launch into `kk news publish` in Phase 2.
- **The template fallback after a failed `script-write` stays** (F613, 0345 R9/R10). The earlier "hard-fail writer" idea is dropped.
- **Stale scheduler job lines** (the 11-11 cause) are an operator decision about which machine owns the schedule; this task only records `checkoutCommit` so a receipt shows which checkout ran.

### Design

Files touched (nothing else):

| File | Change |
| --- | --- |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml` | drop `agent_retry` var + comment (L82-86); L361/L447 → `agent: inline`; L447 node role → `reviewer`; L578/L837 drop `agent_retry` key; L892 add `agent`; new first node `executor-probe`; `prepare.dependsOn: [executor-probe]` |
| `plugins/kk/workflows/kk-daily-safety.yaml` | drop `agent_retry` var + comment (L46-49); L91/L122/L195 → `agent: inline` |
| `plugins/kk/workflows/kk-itc.yaml` | new first node `executor-probe`; `prepare.dependsOn: [executor-probe]` |
| `plugins/kk/scripts/daily-scheduled-run.ts` | R5, R7, R8 |
| `plugins/kk/scripts/daily-triage-core.ts` | drop `retryAgent` |
| `scripts/daily-ai-news.ts` | R6 |
| `docs/04_DESIGN.md`, `docs/design/kk-daily-ai-voice3.md` | R9 |

Probe node (identical in both workflows):

```yaml
  - id: executor-probe
    description: "One real prompt to the resolved executor; a dead executor fails the run here (ADR-053 §5)"
    action:
      kind: agent.run
      options:
        role: scribe
        agent: ${vars.agent}
        timeoutMs: 120000
        input: "Reply with exactly: OK"
```

Wrapper lock (reuses `kk lock`, same stdout contract as `kk-collect.yaml`; exit 0 both ways, so parse stdout):

```ts
const lockName = `${values.workflow}-${stamp}`;
const lock = JSON.parse(spawnSync('kk', ['lock', 'acquire', '--name', lockName, '--run', runId, '--ttl', String(timeoutMs)], { encoding: 'utf-8' }).stdout || '{}');
if (lock.acquired !== true) { console.error(`daily-scheduled-run: ${values.workflow} ${stamp} already running (holder ${lock.holder ?? 'unknown'})`); process.exit(6); }
```

Invariants: the lock is acquired before anything is written under the work dir except the idempotent
`mkdirSync`; a `kk lock acquire` that fails to run or prints unparseable output is treated as not acquired
(fail closed); exit codes 2 and 5 keep their meaning, 6 is new.

After editing `plugins/kk/scripts/` and `plugins/kk/workflows/`, the installed package must be synced before
any scheduled run sees the change (`AGENTS.md` → "Editing `plugins/kk/scripts/`"); the implementer does NOT
run that sync or touch `.spur/config.yaml` — the operator does.

### Plan

1. Read `apps/cli/tests/voice3-dag.test.ts`, `plugins/kk/tests/daily-scheduled-run.test.ts`, `plugins/kk/tests/safety-reviewer-failure.test.ts`, `plugins/kk/tests/safety-retry-preserves-artifacts.test.ts`, `scripts/tests/daily-ai-news.test.ts`, `apps/cli/tests/voice3-migration.e2e.test.ts`, `apps/cli/tests/kk-itc-dag.test.ts` — every `agent_retry` / `retry-agent` reference in them.
2. Tests first (they must fail before step 3): change those assertions to the new contract and add AC1 (DAG rule over all six files), AC2 (stub `spur`, default `inline` refused; `executor-probe` is the sole root node) and AC3 (held lock → exit 6, receipt untouched; lock released afterwards; `checkoutCommit` present). Do not touch `apps/cli/tests/voice2-dag.test.ts`.
3. Edit the three workflow files per the Design table; run `spur workflow validate` on each.
4. Edit `daily-scheduled-run.ts` (R5, R7, R8), `daily-triage-core.ts`, `scripts/daily-ai-news.ts` (R6).
5. Update `docs/04_DESIGN.md` and `docs/design/kk-daily-ai-voice3.md` (R9).
6. `bun run lint && bun run test && bun run build`; run the three AC `rg` / test commands and paste their output into Testing.
7. Stop. No commit to `.spur/config.yaml`, no install sync, no live run.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: G61 (`docs/features/G61_*.md`), scenarios 1–3.
- Decision: `docs/00_ADR.md` → ADR-053 §3, §5.
- Prior art: task 0238 R2 (retry siblings by role), task 0347 F1 (preflight probe), `plugins/kk/workflows/kk-collect.yaml` (lock pattern), `apps/cli/src/commands/lock.ts:56`.
- Follow-ups: 0361 (publish core), 0362 (design freeze; Phase 2 moves this wrapper into `kk news generate`).

### History

- 2026-11-13T17:40:54.085Z feature_id Q → G61 (system)

