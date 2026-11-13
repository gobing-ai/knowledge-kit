---
schema_version: 1
name: "Launch safety: single executor var, traffic probe first, single-flight lock, hard-fail writer"
status: done
template: feature-impl
created_at: 2026-11-13T17:31:13.660Z
updated_at: "2026-11-13T19:32:59.820Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P0
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0360-verdict.json
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

- [x] R1. `agent_retry` is deleted from the `vars:` block of `plugins/kk/workflows/kk-daily-ai-voice3.yaml` and `plugins/kk/workflows/kk-daily-safety.yaml`. After the change, `rg -n 'agent_retry' plugins/kk/workflows/kk-daily-ai-voice3.yaml plugins/kk/workflows/kk-daily-safety.yaml` prints nothing.
- [x] R2. The five retry nodes use the literal `agent: inline` and `role: reviewer`: voice3 `curate-fix` (L361) and `script-write-fix` (L447, role changes `scribe` → `reviewer`); safety `review-retry` (L91) and the two further nodes at L122 and L195. No other option of those nodes changes.
- [x] R3. Every primary `agent.run` node in the six in-scope workflows (`kk-daily-ai-voice3`, `kk-daily-safety`, `kk-daily-publish3`, `kk-itc`, `kk-itc-author`, `kk-itc-publish-tail`) keeps `agent: ${vars.agent}`, and every nested `spur workflow run` forwards `agent`: voice3 L578 and L837 drop the `agent_retry` key; voice3 L892 (nested `kk-daily-publish3`) adds `\"agent\":\"${vars.agent}\"`. The `kk-itc` → `kk-itc-author` launch already forwards it and is unchanged.
- [x] R4. `kk-daily-ai-voice3.yaml` and `kk-itc.yaml` gain a first node `executor-probe`: `kind: agent.run`, `role: scribe`, `agent: ${vars.agent}`, `timeoutMs: 120000`, `input: "Reply with exactly: OK"`, no `onError`. The current first node (`prepare` in both) lists it in `dependsOn`. Declared before `prepare` (nodes are in topological order).
- [x] R5. `plugins/kk/scripts/daily-scheduled-run.ts` `runPreflight()` always probes unless `--skip-probe`: the probe target is `values.agent`, or the role `scribe` when it is `inline`. A failed probe is a refusal reason. The `--retry-agent` option, its probe (L183-188), the `agent_retry` var (L62, L70) and the `retryAgent` receipt field (L203, L537, L567) are removed.
- [x] R6. `scripts/daily-ai-news.ts`: `PRODUCTION.agent` and `PRODUCTION.retryAgent` are removed; `generate` passes no `--agent` in the `--full` posture and `--agent planner` otherwise is replaced by passing nothing (role resolution happens in the workflow); the `--retry-agent` flag and its help text (L39, L44) are removed. An operator `--agent <name>` after `--` still reaches the wrapper. `plugins/kk/scripts/daily-triage-core.ts` drops `retryAgent` (L28, L302).
- [x] R7. Single-flight: before `runPreflight()`, the wrapper runs `kk lock acquire --name "<workflow>-<stamp>" --run "<runId>" --ttl "<timeoutMs>"`. On `{"skipped":"locked","holder":…}` it prints `daily-scheduled-run: <workflow> <stamp> already running (holder <holder>)` to stderr and exits `6` **without writing the receipt file**. The lock is released (`kk lock release --name … --run …`) on the preflight-refused exit, in the signal handler path, and before the final `process.exit`.
- [x] R8. Every receipt the wrapper writes carries `checkoutCommit` (output of `git -C <repo> rev-parse HEAD`, or `null` when git fails) and `executor` (`values.agent`).
- [x] R9. `docs/04_DESIGN.md` and `docs/design/kk-daily-ai-voice3.md` no longer document `agent_retry` / `--retry-agent`; they state the single `agent` var, the probe node and exit code 6. Same commit as the code.

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

Implementation of ADR-053 §5 across the six in-scope workflows and the two operator scripts.

#### Workflows — one executor var (R1, R2, R3)

| File | Change |
| --- | --- |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml` | `agent_retry` var + its 0238 comment deleted; `curate-fix` → `agent: inline`; `script-write-fix` → `role: reviewer` + `agent: inline`; both nested `kk-daily-safety` launches and the nested `kk-daily-publish3` launch now forward only `agent` (`--vars` JSON) |
| `plugins/kk/workflows/kk-daily-safety.yaml` | `agent_retry` var + comment deleted; `review-retry`, `judge-retry`, `revise-retry` → `agent: inline` (all three already `role: reviewer`) |
| `kk-daily-publish3` / `kk-itc` / `kk-itc-author` / `kk-itc-publish-tail` | unchanged: every `agent.run` already reads `${vars.agent}` |

A retry now resolves through its `role` (reviewer = capable-1, above the primary's rung) instead of a
second pinned var, so a dead operator pin keeps a live second attempt. `kk-daily-ai-voice2.yaml` is
untouched by design: it still forwards `agent_retry` to the safety machine, and spur tolerates an
undeclared var (verified 2026-11-13).

#### Workflows — traffic probe first (R4)

`executor-probe` is the new first node in `kk-daily-ai-voice3.yaml` and `kk-itc.yaml`
(`kind: agent.run`, `role: scribe`, `agent: ${vars.agent}`, `timeoutMs: 120000`,
`input: "Reply with exactly: OK"`, no `onError`), and `prepare` now `dependsOn: [executor-probe]` in
both. It is the sole root node, so no deterministic step — and no agent spend — precedes the proof
that the resolved executor answers.

#### `plugins/kk/scripts/daily-scheduled-run.ts` — R5, R7, R8

- **R5** — `--retry-agent` option, its probe, the `agent_retry` var in both workflow var maps, and
  the `retryAgent` receipt field are gone. `runPreflight()` always probes unless `--skip-probe`, and
  the probe target is `values.agent`, or the `scribe` role when that value is `inline`, so the
  default posture is proven rather than skipped. A failed probe is a refusal **reason**, not a
  warning.
- **R7** — `acquireLock()` runs `kk lock acquire --name <workflow>-<stamp> --run <runId> --ttl
  <timeoutMs>` before `runPreflight()`, after only the idempotent `mkdirSync`s. Not acquired (a held
  claim, a non-zero exit, or unparseable stdout — fail closed) prints
  `daily-scheduled-run: <workflow> <stamp> already running (holder <holder>)` to stderr and exits
  6 without writing the receipt, leaving the incumbent's bytes intact. `releaseLock()` runs on the
  preflight-refused exit, in the signal handler, and before the final `process.exit`.
- **R8** — `checkoutCommit()` (`git -C <repo> rev-parse HEAD`, `null` on failure) and
  `executor` (`values.agent`) are on every receipt the wrapper writes: preflight-refused, running,
  inspecting, and terminal.

#### `scripts/daily-ai-news.ts` + `plugins/kk/scripts/daily-triage-core.ts` — R6

`PRODUCTION.agent` / `PRODUCTION.retryAgent`, the `--agent`/`--retry-agent` argv pair (both postures)
and the `--retry-agent` usage text are gone: the entry forwards no executor at all, and the
workflow's `agent` var resolves the role at dispatch. An operator `--agent <name>` after `--` still
reaches the wrapper (forwarded args are appended last). `TriageReceipt.retryAgent` and its reader are
deleted.

#### Docs (R9, same commit)

`docs/04_DESIGN.md` §1.11 records the single executor selector, the single-flight lock with exit 6,
the always-on probe and the two new receipt fields; `docs/design/kk-daily-ai-voice3.md` §4 lists
`executor-probe` as the first node of phase 0 and §10 records the shipped one-var contract.

#### Tests

New `apps/cli/tests/launch-safety-dag.test.ts` (AC1 + AC2 root) parses all six workflows and asserts
the one-var rule, the nested `agent` forwarding, and the probe shape/root position;
`apps/cli/tests/kk-itc-dag.test.ts` gains the same root assertion for its own file;
`plugins/kk/tests/daily-scheduled-run.test.ts` gains AC2 (default `inline` probes `scribe`, no
workflow run) and AC3 (held lock → exit 6, byte-identical receipt) plus the lock-ordering and
receipt-field checks; `safety-reviewer-failure.test.ts`, `voice3-dag.test.ts`,
`safety-retry-preserves-artifacts.test.ts`, `voice3-migration.e2e.test.ts` and
`scripts/tests/daily-ai-news.test.ts` move to the one-var contract.

#### Change map (file:line)

- `plugins/kk/workflows/kk-daily-ai-voice3.yaml:119` — `executor-probe` first node; `:369` `curate-fix` and `:457` `script-write-fix` → `agent: inline`.
- `plugins/kk/workflows/kk-daily-safety.yaml:89`, `:120`, `:193` — the three retries → `agent: inline`.
- `plugins/kk/workflows/kk-itc.yaml:42` — `executor-probe` first node.
- `plugins/kk/scripts/daily-scheduled-run.ts:76` `checkoutCommit()`, `:92` `acquireLock()`, `:111` `releaseLock()`, `:119` the acquire gate (exit 6), `:235` the always-on probe target.
- `scripts/daily-ai-news.ts:28` `PRODUCTION` without the executor pair, `:258` the argv with no `--agent`.
- `docs/04_DESIGN.md:1095` — lock, exit 6, probe, receipt fields; `docs/design/kk-daily-ai-voice3.md:102`, `:264` — probe node and the sh

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `rg -n 'agent_retry' plugins/kk/workflows/kk-daily-ai-voice3.yaml plugins/kk/workflows/kk-daily-safety.yaml` → no matches; both files declare `agent: "inline"` only (`plugins/kk/workflows/kk-daily-ai-voice3.yaml:81`). |
| R2 | MET | Five retry nodes now `agent: inline` + `role: reviewer`: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:360` (`curate-fix`), `:446` (`script-write-fix`, role changed from `scribe`), `plugins/kk/workflows/kk-daily-safety.yaml:88`, `:119`, `:192`. |
| R3 | MET | Primaries keep `${vars.agent}`; every nested launch forwards it: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:587`, `:846`, `:901`; `temp/dag` assertion in `apps/cli/tests/launch-safety-dag.test.ts:95`. |
| R4 | MET | `executor-probe` is the sole root and `prepare` depends on it: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:119`, `plugins/kk/workflows/kk-itc.yaml:42`; asserted by `apps/cli/tests/launch-safety-dag.test.ts:110` and `apps/cli/tests/kk-itc-dag.test.ts:41`. |
| R5 | MET | `--retry-agent`, its probe, both `agent_retry` vars and the receipt field are gone; the probe always runs and targets `scribe` for the `inline` posture: `plugins/kk/scripts/daily-scheduled-run.ts:235`. |
| R6 | MET | `PRODUCTION` carries no executor and the argv appends no `--agent`: `scripts/daily-ai-news.ts:28`, `:258`; `TriageReceipt` no longer has `retryAgent` (`plugins/kk/scripts/daily-triage-core.ts:22`). An operator `--agent X` after `--` still wins (test "generate --full accepts explicit agent overrides"). |
| R7 | MET | `acquireLock()` / `releaseLock()` in `plugins/kk/scripts/daily-scheduled-run.ts:92` and `plugins/kk/scripts/daily-scheduled-run.ts:111`, wired at `plugins/kk/scripts/daily-scheduled-run.ts:119`; the held-lock refusal and its receipt-untouched guarantee are asserted by `plugins/kk/tests/daily-scheduled-run.test.ts:442`. |
| R8 | MET | `checkoutCommit` + `executor` on the preflight-refused, running, inspecting and terminal receipts: `plugins/kk/scripts/daily-scheduled-run.ts:251`, `:273`, `:547`, `:628`. |
| R9 | MET | `docs/04_DESIGN.md:1095` (single executor selector, lock, exit 6, probe, receipt fields) and `docs/design/kk-daily-ai-voice3.md:102`, `:264` (probe node, one-var contract); see F3 for the voice2 row. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — One executor variable drives every agent node (req: R1, R2, R3, R6, R9) | MET | test | `bun test apps/cli/tests/launch-safety-dag.test.ts` 5 pass / 0 fail; the AC's own `rg` over the five files prints nothing; `spur workflow validate` accepts voice3, kk-itc, kk-daily-publish3, kk-itc-author and kk-itc-publish-tail (kk-daily-safety fails `validate` on a decision-catalog lookup that fails identically at base `901a4fe1`). |
| AC2 — A dead executor stops the run before it costs anything (req: R4, R5) | MET | test | `plugins/kk/tests/daily-scheduled-run.test.ts:371` — stub `spur agent run` exits 1, default `--agent inline` → exit 5, `status: preflight-refused`, reason names `scribe`, no `workflow run` call; `executor-probe` root asserted in `apps/cli/tests/launch-safety-dag.test.ts:122`. |
| AC3 — A second launch for the same workflow and day is refused (req: R7, R8) | MET | test | `plugins/kk/tests/daily-scheduled-run.test.ts:442` — held lock named `A` → exit 6, stderr names `A`, receipt byte-identical, no launch, no release of a claim we never held. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed the 0360 diff against base `901a4fe1` (3 workflows, `daily-scheduled-run.ts`, `daily-triage-core.ts`, `scripts/daily-ai-news.ts`, 5 updated test files, 1 new DAG test, 2 docs) against R1–R9 and AC1–AC3. Full artifact: `.spur/run/b7ebf603-473a-4688-8151-3322be94aee8-review-cert.md`.

| Priority | ID | Finding | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| P4 | F1 | `acquireLock()` fails closed on every non-acquired outcome, but the message says "already running (holder unknown)" when the real cause is a missing or unparseable `kk`. The refusal itself is correct (exit 6, no receipt write); only the wording conflates "held" with "cannot check". | `plugins/kk/scripts/daily-scheduled-run.ts:92`, `plugins/kk/scripts/daily-scheduled-run.ts:119` | Accepted with a follow-up: split the two messages on the next touch of this file. Patching it inside this run would invalidate the full-tier PASS receipt the pipeline reuses (a 28-minute suite on this host). |
| P4 | F2 | §1.11's exit-code summary still lists "0/4/124/143", so exit 5 stays undocumented there and exit 6 is documented only in the new paragraph above it. | `docs/04_DESIGN.md:1095` | Accepted as pre-existing incompleteness; exit 5 predates this task. |
| P4 | F3 | R9 holds for the wrapper and voice3 surfaces, but `docs/04_DESIGN.md:2066` still names `agent_retry` inside the voice2 module row, because voice2 genuinely still declares it. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:87` | Interpretation recorded; the wording fix lands after the pipeline closes so the committed doc stops advertising the var. |

No open P1–P3 finding.

Strengths: the probe is the sole root node in both workflows, so no deterministic step runs before the executor proof; every retry resolves by role instead of a second variable, so a dead operator pin keeps a live second attempt; the lock is acquired before anything but the idempotent `mkdir` is written, and the held-lock path leaves the incumbent's receipt byte-identical.

Residual risk: the signal path releases the claim before the terminated child is reaped (R7 requires the release there), so a relaunch inside that sub-second window can share the work dir — the lock TTL bounds the inverse case. voice2's safety retries now resolve by role rather than its `claude` pin, accepted in the task Q&A because voice2 is not scheduled.

Verification: `spur task gate 0360 run` → `quality gate PASS (attempts: 1)`, receipt at git tree `50fb6767`; `bun run test-pre-check` → "All 58 rules passed"; `bunx biome check .` clean; `bun run typecheck` every workspace exit 0.

Confidence: HIGH
Verdict: PASS

### References

- Parent feature: G61 (`docs/features/G61_*.md`), scenarios 1–3.
- Decision: `docs/00_ADR.md` → ADR-053 §3, §5.
- Prior art: task 0238 R2 (retry siblings by role), task 0347 F1 (preflight probe), `plugins/kk/workflows/kk-collect.yaml` (lock pattern), `apps/cli/src/commands/lock.ts:56`.
- Follow-ups: 0361 (publish core), 0362 (design freeze; Phase 2 moves this wrapper into `kk news generate`).

### History

- 2026-11-13T17:40:54.085Z feature_id Q → G61 (system)
- 2026-11-13T18:13:25.845Z backlog → wip (system)
- 2026-11-13T19:32:01.014Z wip → testing (system)
- 2026-11-13T19:32:59.793Z testing → done (system)

