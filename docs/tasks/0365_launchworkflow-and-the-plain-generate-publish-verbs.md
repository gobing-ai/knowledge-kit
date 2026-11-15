---
schema_version: 1
name: launchWorkflow and the plain generate / publish verbs
status: done
template: feature-impl
created_at: 2026-11-13T18:13:39.602Z
updated_at: "2026-11-15T04:01:17.742Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0360", "0363", "0364"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0365-verdict.json
---

## 0365. launchWorkflow and the plain generate / publish verbs

### Background

Phase 2 of G61 (ADR-053 §3, §5). Frozen contract: `docs/design/content-pipeline-consolidation.md` §1.1 (`generate`, `publish`) and §3 (launch contract with the keep/drop line maps for `plugins/kk/scripts/daily-scheduled-run.ts`, `scripts/daily-ai-news.ts`, `plugins/kk/scripts/voice3-publish-window.ts`). Today launching is a 581-line Bun script outside the binary plus two more scripts in front of it; `kk-itc` is launched with bare `spur workflow run` and has no supervisor at all. This task ports the supervisor into the binary as one function and exposes it as the plain verbs `generate` and `publish`. The new workflows do not exist yet, so the verbs are proven against a stub workflow and, by config override, against today's workflows.

Out of scope: writing `kk-news-generate`/`kk-article-generate`/`kk-publish` (0366–0368), editing or deleting any script (0369), the scheduler.

### Requirements

- [x] R1. New `apps/cli/src/launch.ts` exports `launchWorkflow(opts): Promise<Receipt>` performing the six steps of design §3 in order. Every external effect goes through an injected `deps` object (`spawn`, `now`, `fs`, `lock`) so tests run without spur. The returned receipt has exactly the shape in design §3, including `executor` and `checkoutCommit`.
- [x] R2. Lock name `<workflow>-<run>` via the same code path as `kk lock acquire` (0360). Held → exit 6 and **no write** to `schedule-receipt.json`.
- [x] R3. Preflight ports `runPreflight` (`daily-scheduled-run.ts:157-212`): dirty harness paths (skipped by `--allow-dirty`), checkout-vs-install divergence, executor probe (`inline` probes role `scribe`). Failure → exit 5 and a receipt with `status: 'refused'` and `reason`. There is no `--skip-probe`.
- [x] R4. Exactly one `spur workflow run <workflow> --vars …` child per invocation. Vars: `work_dir`, `run_date` or `slug`, `run_id`, `agent` (only when `--agent` is given; an empty value is never passed), `skill_dir` (generate only; from `resolveContentType().skillDir`, a missing skill is a preflight refusal, exit 5; the receipt records `writerSkill: {dir, sha256}` — design §2.2), plus per-verb vars from design §5.
- [x] R5. Cleanup on exit, SIGINT, SIGTERM and timeout (`--timeout-ms`, default 13500000): `spur workflow cancel` if the run is still active, `kk store release`, `kk ledger sync`, lock release, final receipt — ported from `daily-scheduled-run.ts:294-423`. The lock is released on every path, including a throw inside cleanup.
- [x] R6. New `apps/cli/src/commands/content-launch.ts` adds `generate` and `publish` to the 0363 verb list with the flags of design §1.1. The workflow name comes from `content_types.<type>.workflow` for `generate` and is the literal `kk-publish` for `publish`. Until 0366 ships that file, tests supply a stub `kk-publish.yaml` through the existing `workflows_dir` config override — no new config key and no env switch.
- [x] R7. `publish` refuses with exit 5 when `<workDir>/4-publish/bundle.json` is missing or the generate receipt is `running`; with `--unattended`, a missing bundle plus an absent or `failed` receipt triggers exactly one `generate` and then continues (design §3.2). Window and CN-consent validation is ported from `voice3-publish-window.ts` and runs before the lock.
- [x] R8. `generate --publish` launches `publish --window after-generate` in the same process after the generate workflow exits 0, forwarding `--channels`/`--live-channels`; it is two sequential `launchWorkflow` calls, each with its own lock and receipt.
- [x] R9. `--dry-run` runs steps 1 and 3, prints the receipt with `status: 'refused'` or the planned argv under `dryRun`, takes no lock, writes nothing.
- [x] R10. `docs/04_DESIGN.md` §1.14 lists `generate` and `publish` as shipped with the exit-code table. Same commit.

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

`launchWorkflow` ports the 581-line supervisor into the binary as one function with an injected
`deps` object, and the two plain verbs are thin resolvers over it.

**Shape.** Steps 1–6 of design §3 live in `launchWorkflow` in that order, and every external effect
goes through one seam: `spawn` (`spur workflow run`, `spur workflow cancel`, the `git`/`diff` probes,
the executor probe), `now`, `fs`, `lock`, `signals`, plus `recycleRun`/`ledgerSync`/`installRoot` for
the three cleanup and divergence facts the legacy script obtained by spawning `kk` and
`command -v kk`. The four AC3 exit paths (green, failed, timeout, interrupted) therefore need no
engine, no store and no traffic: `launch.test.ts` drives them through the seams, the e2e suite drives
them through a stub `spur`.

**Port decisions, all recorded where they are made.**
- Timeout uses the executor's own deadline (`ProcessOptions.timeout`) instead of the hand-rolled
  watchdog of `plugins/kk/scripts/daily-scheduled-run.ts:424-482`; ts-runtime explicitly asks callers not to race a
  second watchdog; the port subscribes to `SIGINT`/`SIGTERM` and lets the executor own the
  kill escalation (`apps/cli/src/launch.ts:568`).
- The reservation-recovery heuristics of `:326-423` are replaced by the structural rule they
  approximate: only a launch that cannot have sent anything recycles selections. `generate` never
  sends, so it releases on a non-green exit; `kk-publish` sends, so its rows stay for
  `publish-settle` (design §5.3 node 8). Ordering and the four cleanup actions are unchanged.
- The divergence probe compares the launcher's own tree against the package root the *running entry
  script* belongs to (apps/cli/src/launch.ts:237) rather than `command -v kk`: a Bun runtime reorders `PATH` for
  its children, so the PATH answer is not reproducible, and the entry script is the runtime's own
  answer to the same question.
- `--dry-run` runs the preflight only and returns the step-4 receipt (status `running`) with the
  planned argv under `dryRun`, writing nothing and taking no lock (R9; AC2's "the non-dry run leaves
  a receipt" is the same statement). Design §3's parenthetical "`--dry-run` stops after step 4"
  conflicts with R9's "takes no lock"; R9 wins and the difference is this note.
- `publish` writes `4-publish/schedule-receipt.<window>.json`, not `schedule-receipt.json`: §4.3
  freezes one generation receipt per run directory, and a publish window must not overwrite the
  receipt R7 admits it on. `--yes` keeps its legacy meaning (consent to the single auto-`generate`)
  next to `--unattended`; `--retry` is forwarded as the additive `retry` var.
- A `--work-dir` publish of an archived run takes its run date from the bundle before resolving the
  run (`apps/cli/src/commands/content-launch.ts:475`), so old runs stay publishable (§4.3).

| File | Change |
| --- | --- |
| `apps/cli/src/launch.ts:460` | new: `launchWorkflow` — resolve, lock, preflight, receipt, one child, cleanup |
| `apps/cli/src/launch.ts:102` | new: the `LaunchDeps` seam (`spawn`, `now`, `fs`, `lock`, `signals`, cleanup, `installRoot`) |
| `apps/cli/src/launch.ts:53` | new: the receipt contract of design §3 plus `exitCode`, `writerSkill`, `dryRun` |
| `apps/cli/src/launch.ts:291` | new: `runPreflight` — dirty harness paths, checkout-vs-install divergence, traffic probe |
| `apps/cli/src/launch.ts:362` | new: `storeLockPort` — the `<workflow>-<run>` claim on the store DAO `kk lock acquire` uses |
| `apps/cli/src/launch.ts:533` | fix (review P2): the signal handler is installed for the whole run and released only after the terminal receipt |
| `apps/cli/src/commands/content-launch.ts:256` | new: `generate` — content-type workflow, vars, `--publish` chain |
| `apps/cli/src/commands/content-launch.ts:453` | new: `publish` — window/consent validation, (un)admission, one `kk-publish` launch |
| `apps/cli/src/commands/content-launch.ts:354` | new: `publishRun` — the two admission rules of §3.2 and the publish vars |
| `apps/cli/src/commands/content-launch.ts:387` | fix (review P2): the auto-`generate` leg inherits `--dry-run`, so R9 holds end to end |
| `apps/cli/src/launch.ts:76` | new: `PlannedLaunch` — the chained leg a publish dry run plans and reports under `dryRun.chained` |
| `apps/cli/src/commands/content-launch.ts:214` | new: `validateLiveTokens` — CN-consent/window validation ported from `voice3-publish-window.ts` |
| `apps/cli/src/commands/content-launch.ts:558` | new: `registerContentLaunchVerbs` + `registerContentLaunchCommand` (surface rule seam) |
| `apps/cli/src/commands/content.ts:447` | changed: `registerContentVerbs` appends `generate` and `publish` |
| `apps/cli/src/commands/content.ts:81` | changed: `expandHome` exported for the workflow-path override |
| `apps/cli/tests/launch.test.ts:1` | new: failure-mode list (15 named cases) then the seam-driven suite |
| `apps/cli/tests/content-launch.e2e.test.ts:153` | new: AC1–AC4 through `main()` with a stub `spur` and a temp project root |
| `apps/cli/tests/commands/content-launch.test.ts:54` | new: unit surface — run-date, CN-consent, workflow path, registration |
| `apps/cli/tests/fixtures/workflows/kk-publish.yaml:5-11` | new: stub `kk-publish` DAG reached through `workflows_dir` (R6) |
| `docs/04_DESIGN.md:1417-1419` | changed: §1.14 lists `generate`/`publish` as shipped with the exit-code table |

Not done, on purpose: no script edited or deleted (`daily-scheduled-run.ts`, `voice3-publish-window.ts`
stay for 0369); no real `kk-news-generate`/`kk-article-generate`/`kk-publish` YAML (0366–0368).
| `apps/cli/tests/main.test.ts:206` | changed: the canonical A22 leaf inventory gains `article generate`/`article publish`/`news generate`/`news publish` |
| `apps/cli/tests/commands/content.test.ts:12` | changed: the shared-noun verb list gains `generate` and `publish` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/launch.ts:460` — lock `:510` → preflight `:535` → running receipt `:552` → one child `:564` → cleanup `:598` → terminal receipt `:635`; seam `apps/cli/src/launch.ts:102`; receipt type carries `executor`/`checkoutCommit` at `apps/cli/src/launch.ts:53` |
| R2 | MET | `apps/cli/src/launch.ts:510` builds `<workflow>-<run>`, `apps/cli/src/launch.ts:511` claims it through the lock seam; a lost claim returns 6 with no write `apps/cli/src/launch.ts:512-516`; unit `apps/cli/tests/launch.test.ts:227`; byte-identical proof `apps/cli/tests/content-launch.e2e.test.ts:60` |
| R3 | MET | `apps/cli/src/launch.ts:291` ports `runPreflight`: dirty harness `:302-309` (skipped by `--allow-dirty`), divergence `:311-329`, probe with `inline`→`scribe` `:331-333`; refused receipt + exit 5 `apps/cli/src/launch.ts:539`; no `--skip-probe` in `apps/cli/src/commands/content-launch.ts:512-529` |
| R4 | MET | `apps/cli/src/launch.ts:340` one `spur workflow run` argv; agent var only when given `apps/cli/tests/launch.test.ts:395`; `skill_dir` `apps/cli/src/commands/content-launch.ts:279` + `writerSkill` `apps/cli/src/commands/content-launch.ts:293` generate-only; a missing skill exits 5 (`apps/cli/tests/launch.test.ts:331`, `apps/cli/tests/content-launch.e2e.test.ts:462`); per-verb vars `apps/cli/tests/content-launch.e2e.test.ts:275` |
| R5 | MET | four postures clean up `apps/cli/tests/content-launch.e2e.test.ts:103` and `apps/cli/tests/launch.test.ts:351`; the handler outlives cleanup and the lock is still freed `apps/cli/tests/launch.test.ts:534`; release at `apps/cli/src/launch.ts:646` |
| R6 | MET | `apps/cli/src/commands/content-launch.ts:558` registered from `apps/cli/src/commands/content.ts:451`; workflow `content_types.<type>.workflow` `:272`, literal `kk-publish` `:433`; existing `workflows_dir` override `:107`; stub `apps/cli/tests/fixtures/workflows/kk-publish.yaml:1` |
| R7 | MET | `apps/cli/src/commands/content-launch.ts:376` running receipt → refusal, `apps/cli/src/commands/content-launch.ts:424` missing bundle → 5, `apps/cli/src/commands/content-launch.ts:389-393` exactly one auto-generate (`apps/cli/tests/content-launch.e2e.test.ts:235`); validation `apps/cli/src/commands/content-launch.ts:386` runs before the publish lock (`apps/cli/src/commands/content-launch.ts:382`) |
| R8 | MET | `apps/cli/src/commands/content-launch.ts:306` chained `publishRun` for window `after-generate` (`apps/cli/src/commands/content-launch.ts:315`), two sequential launches with own locks/receipts — `apps/cli/tests/content-launch.e2e.test.ts:275` |
| R9 | MET | `apps/cli/src/launch.ts:499` dry run = preflight only, planned argv, no lock/write/child (`apps/cli/tests/launch.test.ts:660`, `apps/cli/tests/content-launch.e2e.test.ts:415`); the auto-generate leg inherits the posture `apps/cli/src/commands/content-launch.ts:408` and is reported under `dryRun.chained` `apps/cli/src/commands/content-launch.ts:475` (`apps/cli/tests/content-launch.e2e.test.ts:190`) |
| R10 | MET | `docs/04_DESIGN.md:1415` §1.14 lists `generate`/`publish` as shipped (0365), flags `:1429-1438`, exit codes `:1448`, same change set |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A launch is refused while another holds the lock (req: R1, R2) | MET | test | `apps/cli/tests/content-launch.e2e.test.ts:60` — exit 6, holder receipt byte-identical; `apps/cli/tests/launch.test.ts:226` |
| AC2 — A dead executor refuses the launch before any spend (req: R1, R3, R9) | MET | test | `apps/cli/tests/content-launch.e2e.test.ts:82` — both runs exit 5, no workflow child, refused receipt naming the probe |
| AC3 — Every exit path cleans up (req: R1, R4, R5) | MET | test | `apps/cli/tests/content-launch.e2e.test.ts:103` — green/failed/timeout/SIGTERM, one child each, lock free, `.works/tmp/test-launch/summary.json` |
| AC4 — Publish finds or refuses the bundle (req: R6, R7, R8) | MET | test | `apps/cli/tests/content-launch.e2e.test.ts:235` — exit 5 naming `4-publish/bundle.json`, then exactly one generate before `kk-publish.yaml` |
| AC5 — Gate (req: R10) | MET | command | `.spur/run/0365-check-receipt.json:1` status PASS tier full runId cd3f64cf…; `spur task gate 0365 status` → reuse true / ok for git tree fd8782f… |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0365

**Scope:** worktree change set on `sp/runall-g61-9beb` (base `312356fa`): 13 files, +2.9k — `apps/cli/src/launch.ts` (new), `apps/cli/src/commands/content-launch.ts` (new), `apps/cli/src/commands/content.ts`, three new test files, two updated surface inventories, three stub workflow fixtures, `docs/04_DESIGN.md` §1.14.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** MEDIUM

##### Second visit — the two remediated P2s, re-checked independently

The remediation hop's claims were re-derived here, not accepted: both were reproduced against code paths the suites do not share, with throwaway temp projects and stub seams outside the repo (nothing in the tree changed).

1. **`--dry-run` propagation (was finding 1).** On a temp project (stub `spur`, `failed` generate receipt, no bundle), `kk news publish --run-date 20260116 --window cn-peak --unattended --dry-run` now exits 0 with **0** `spur workflow run` children, the generate receipt byte-identical, no `4-publish/bundle.json`, no `4-publish/schedule-receipt.cn-peak.json`, and a receipt carrying `dryRun.chained[0] = kk-news-generate` plus its planned argv. The same temp project *without* `--dry-run` still launches for real (one `kk-news-generate` child, bundle and receipt written), so the posture is what decides, not the code path. Source: `apps/cli/src/commands/content-launch.ts:387` inherits the posture, `:394-400` plans instead of launching, `:404` refuses a null bundle only when not a dry run, `:449` reports the chain.
2. **Signal-handler lifetime (was finding 2).** With my own `LaunchDeps` stub firing `SIGTERM` from inside `store release` — an earlier cleanup step than the suite's `kk ledger sync` — the handler was still subscribed when the signal landed, cleanup continued through the ledger sync, the terminal `failed` receipt (exit 1) was written, and exactly one lock release followed, in the order `subscribe → spawn → cancel → recycle → ledger → unsubscribe → release`. Source: `apps/cli/src/launch.ts:533` keeps the handle in the launch-body scope, `:559` installs it before the child, `:639` releases it in the outer `finally`.
3. **Suites and gate.** `bun test apps/cli/tests/launch.test.ts apps/cli/tests/commands/content-launch.test.ts apps/cli/tests/content-launch.e2e.test.ts` → **41 pass, 0 fail**. `bunx biome check` over the six touched files → clean. `.spur/run/0365-check-receipt.json` is PASS at tier `full` for runId `cd3f64cf…`, and `spur task gate 0365 status` answers `{"reuse":true,"reason":"ok"}` for git tree `fd8782f…` — the receipt belongs to this tree, so AC5 is evidence against the current change set rather than a stale run.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | CLOSED — `publish`'s single auto-`generate` leg now inherits `--dry-run`: the leg is planned, not performed, the publish receipt reports it under `dryRun.chained[]`, and a dry run takes no lock, writes nothing and spawns no child (probe above) | `apps/cli/src/commands/content-launch.ts:387` | RESOLVED (remediation hop; re-verified this visit) |
| 2 | P2 (major) | correctness | CLOSED — the SIGINT/SIGTERM handler stays installed through cleanup, the terminal receipt and every step up to the lock release, so a signal mid-cleanup no longer strands `<workflow>-<run>` for its TTL behind a `running` receipt (probe above) | `apps/cli/src/launch.ts:559` | RESOLVED (remediation hop; re-verified this visit) |
| 3 | P3 (minor) | correctness | Still live and reproduced: window/CN-consent validation runs after the auto-`generate`, so `publish --unattended --live-channels <token>` with a consent mismatch pays for a full generation (one `kk-news-generate` child, bundle written, receipt rewritten to `done`) and only then exits 5. Not a contract break — R7 and design §3.3 require validation before the *publish* lock (step 2), and `validateLiveTokens` at `:409` does precede the publish launch at `:431` | `apps/cli/src/commands/content-launch.ts:409` | DEFER(spend-only ordering; contract satisfied — follow-up with 0366) |
| 4 | P3 (minor) | correctness | Still live: `spur workflow cancel` covers `runId` only; the ported block also cancelled `<runId>-safety`, the nested safety run design §5.1 nodes 12/19 create. Unreachable until the generation YAMLs land (0366–0368) | `apps/cli/src/launch.ts:602` | DEFER(0366 nested safety-run nodes) |
| 5 | P4 (advisory) | usability | The child is spawned buffered (`onOutput`/`runStreaming` unused) where the legacy used `stdio: 'inherit'`: no progress for up to 3 h 45 m, and the whole output is held up to execa's `maxBuffer`, whose overrun would surface as outcome `error` — a failed launch of a workflow that may have succeeded. Accepted: the buffered result is what names a failure in the receipt | `apps/cli/src/launch.ts:564` | ACCEPTED |
| 6 | P4 (advisory) | architecture | `storeRecycle` and `storeLockPort` re-implement the DAO bodies of `kk store release` and `kk lock acquire/release` instead of calling one deep port; the copies can drift the first time either action gains a guard | `apps/cli/src/launch.ts:389` | ACCEPTED |
| 7 | P4 (advisory) | architecture | The receipt carries `exitCode`, `writerSkill` and `dryRun` beyond design §3's literal shape. Each is required by R4 (writerSkill), R9 (dryRun) or the verb's exit mapping and each is recorded in the Solution and `docs/04_DESIGN.md` §1.14 — but the frozen contract itself was not amended, so §3 of the design and the shipped receipt disagree | `apps/cli/src/launch.ts:53` | ACCEPTED |
| 8 | P4 (advisory) | correctness | The bundle-day guard only fires when both dates normalise; a bundle whose `runDate` is missing or unparsable is admitted for any requested day, where the ported `voice3-publish-window.ts` rule refused an unknown date outright | `apps/cli/src/commands/content-launch.ts:414` | ACCEPTED |
| 9 | P4 (advisory) | usability | `generate` has no `--work-dir` and the selector split is noun-only (`--run-date` news, `--slug` article), so a dated article workspace can only generate today's run; design §1.1's generate row does not annotate the split the way the `new` row does | `apps/cli/src/commands/content-launch.ts:512` | ACCEPTED |
| 10 | P4 (advisory) | correctness | Residual window in the same class as the closed finding 2: `apps/cli/src/launch.ts:639` drops the SIGINT/SIGTERM handler immediately before the lock release at `apps/cli/src/launch.ts:640`, so a signal landing inside that single store round-trip reaches no handler. Bounded: the receipt is already terminal at that point (`apps/cli/src/launch.ts:635`), so the exposure is one lock row held for its TTL, not a `running` receipt that blocks `publish` | `apps/cli/src/launch.ts:639` | ACCEPTED |

No P1, no open P2, and no open P3 against the task's contract: findings 3 and 4 are known-minor items the frozen contract does not order or reach, and both are deferred with the reason in the cell.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/launch.ts:460` — `launchWorkflow` runs lock (`:510`) → preflight (`:535`) → `running` receipt (`:552`) → one child (`:564`) → cleanup (`:598-635`) → terminal receipt, in design §3's order; the seam is `LaunchDeps` (`:102`) and `content-launch.ts` never spawns; the receipt type (`:53`) carries `executor` and `checkoutCommit` (the three extra fields are finding 7) |
| R2 | MET | `apps/cli/src/launch.ts:510` composes `<workflow>-<run>` and `:362` claims it on the same `store.locks` DAO `kk lock acquire` uses (`apps/cli/src/commands/lock.ts:62`); a lost claim returns exit 6 with no write (`:512-519`), proven byte-identical in `apps/cli/tests/content-launch.e2e.test.ts:188` |
| R3 | MET | `apps/cli/src/launch.ts:291` ports `runPreflight`: dirty harness paths skipped by `allowDirty` (`:302-309`), checkout-vs-install `diff -rq` (`:311-329`), executor probe with `inline` → role `scribe` (`:331-333`); failure writes `status: 'refused'` + `reason` and returns 5 (`:539`, `:535`); no `--skip-probe` flag exists (`apps/cli/src/commands/content-launch.ts:512-529`) |
| R4 | MET | One child per launch: `apps/cli/src/launch.ts:340` (one `workflow run … --run-id --vars --quiet` argv); `work_dir`/identity/`run_id` and `agent` only when given (`apps/cli/tests/launch.test.ts:395`); `skill_dir` and `writerSkill: {dir, sha256}` generate-only (`apps/cli/src/commands/content-launch.ts:275`, `:289`), a missing skill exits 5 before the lock (`:168`); per-verb vars match design §5.1–§5.3 (`apps/cli/tests/content-launch.e2e.test.ts:634`) |
| R5 | MET | Four exit paths clean up — `apps/cli/tests/launch.test.ts:350`, `apps/cli/tests/content-launch.e2e.test.ts:231` (green/failed/timeout/SIGTERM: one child each, lock free, release+ledger ran, `executor`/`checkoutCommit` set, `.works/tmp/test-launch/summary.json` written) — and a signal during cleanup no longer escapes: the handler outlives cleanup through the receipt (`apps/cli/src/launch.ts:533`, `:559`, `:639`; `apps/cli/tests/launch.test.ts:527`; re-probed with a signal fired from `store release`) |
| R6 | MET | `apps/cli/src/commands/content-launch.ts:558` registers `generate`/`publish` for both nouns from `apps/cli/src/commands/content.ts:451`; the workflow is `content_types.<type>.workflow` for generate (`:272`) and the literal `kk-publish` for publish (`:433`); YAML resolution prefers the existing `workflows_dir` key (`:107`, no new key, no env switch) with the stub `apps/cli/tests/fixtures/workflows/kk-publish.yaml:1` |
| R7 | MET | `apps/cli/src/commands/content-launch.ts:354` `publishRun`: `running` receipt → exit 5 (`:360-364`), missing bundle → exit 5 naming the path (`:404`); `--unattended`/`--yes` with an absent-or-`failed` receipt runs exactly one `generate` then continues (`:365-401`, proven `apps/cli/tests/content-launch.e2e.test.ts:356`); window/CN-consent validation (`:214`, port of `plugins/kk/scripts/voice3-publish-window.ts:133-157`) runs at `:409`, before the publish lock taken at `:431` — its ordering versus the auto-generate is finding 3 |
| R8 | MET | `apps/cli/src/commands/content-launch.ts:296` returns the generate receipt alone unless the status is `done` and `--publish` was given; `:302` then calls `publishRun` for window `after-generate` forwarding `channels`/`liveChannels` — two sequential `launchWorkflow` calls, each with its own lock name and receipt (`4-publish/schedule-receipt.after-generate.json`), proven `apps/cli/tests/content-launch.e2e.test.ts:396` |
| R9 | MET | `generate --dry-run` is exact (`apps/cli/src/launch.ts:499`: preflight only, planned argv under `dryRun`, no lock, no write, no child — `apps/cli/tests/content-launch.e2e.test.ts:466`) and `publish --dry-run` is now clean end to end, including the auto-`generate` leg it would otherwise have spent (`apps/cli/src/commands/content-launch.ts:387`, `:449`; `apps/cli/tests/content-launch.e2e.test.ts:311`; re-probed as finding 1 above) |
| R10 | MET | `docs/04_DESIGN.md:1415` — §1.14 heading and prose list `generate`/`publish` as shipped (0365) with the flag blocks (`:1429-1438`) and the exit-code table (`:1448`); same change set as the code |

##### Surface-test updates (the two pre-existing tests the change touches)

Both are legitimate, not a workaround. `apps/cli/tests/main.test.ts:206` is the canonical A22 leaf inventory and `apps/cli/tests/commands/content.test.ts:12` the shared-noun verb list; R6 *is* the instruction to add `generate`/`publish` to that surface, so the inventories must move with it. The verb-count assertions still refuse a silent extra verb, and the rest of the tree (`--help` ordering, `publish-*` steps, hidden legacy routes) is untouched by the diff.

##### Residual risk

- Finding 3 costs a generation before a consent refusal; the operator-facing consequence is spend plus a `done` receipt and bundle, so a corrected retry works — no stranded state.
- The lock TTL is the launch deadline (`apps/cli/src/launch.ts:510`), so a launch that runs to its full timeout has no TTL margin to cover its own cleanup; finding 10 is the same window narrowed to the release call.
- The stub workflows are the only engine input exercised here: the three real YAMLs (0366–0368) are unproven against this supervisor, including the nested safety runs of design §5.1 nodes 12/19 (finding 4) and the `retry`/`live_channels` var names in §5.3.
- Finding 8 means a bundle without a usable `runDate` can be published for any requested day; the plan node's own run-date validation remains the guard.

**Next:** proceed to `done`; 0366 carries findings 3 and 4 as its own follow-up (auto-generate ordering, nested safety-run cancel).

### References

- Design: `docs/design/content-pipeline-consolidation.md` §1.1, §3, §4.3. Decision: ADR-053 §3, §5.
- Depends on: 0360 (lock, probe, receipt fields), 0363, 0364. Blocks: 0366, 0367.
- Parent feature: G61, scenarios "A dead executor stops the run before it costs anything", "A second launch for the same workflow and day is refused" (re-proved for the in-binary launcher).

### History

- 2026-11-14T08:26:16.188Z backlog → wip (system)
- 2026-11-14T10:21:33.898Z wip → testing (system)
- 2026-11-14T10:21:34.993Z testing → done (system)

