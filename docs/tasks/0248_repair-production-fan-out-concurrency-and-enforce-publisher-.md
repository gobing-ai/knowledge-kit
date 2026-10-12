---
schema_version: 1
name: Repair production fan-out concurrency and enforce publisher process deadlines
status: done
template: feature-impl
created_at: 2026-10-10T07:14:32.123Z
updated_at: "2026-10-12T02:23:33.756Z"
feature_id: B6

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0248-verdict.json
---

## 0248. Repair production fan-out concurrency and enforce publisher process deadlines

### Background

Review finding F1 (P1, correctness/efficiency), confirmed 2026-10-10. Production fan-out blocks the event loop in apps/cli/src/fanout.ts:431, despite the concurrent pool and timeout race at apps/cli/src/fanout.ts:135. Two real publisher fixtures each sleeping 250ms, with --target-timeout 50, returned exit 0 / two published outcomes after 591ms; their start/end stamps did not overlap. Evidence: .spur/run/review-repro.json in review run dev-review-packages-and-4-a71c. No existing non-terminal task owns this defect. The review separately fixed probe verdict mismatch in apps/cli/src/invoke.ts:241; preserve it. Feature B6 was reopened because dispatch, aggregation and retry remain its owned surface.

### Requirements

- [x] R1. Production pluginDispatch uses the existing spawnPluginEntryAsync seam in apps/cli/src/invoke.ts:371 so independent publishers overlap, while jobs, serial and serialTargets preserve their documented scheduling.
- [x] R2. Forward the per-target budget into the production spawn, terminate/reap its owned process tree on timeout, and await completion before reading or deleting its temporary output. A timed-out target fails with its name and budget; siblings still finish.
- [x] R3. Preserve ordered aggregation, failure exit codes, Result validation, metadata round-trip, retry skipping and temporary-file cleanup.
- [x] R4. Add offline real-process regression coverage in apps/cli/tests/fanout.test.ts and run bun run gate; no external publishers or credentials.

### Acceptance Criteria

- [x] AC1. Two real fixture publisher processes overlap with jobs=2; jobs=1, --serial and --serial-target fixtures do not overlap when their scheduling requires isolation. (req: R1)
- [x] AC2. A hanging fixture that spawns a child is terminated within its budget plus bounded reaping overhead, leaves no live owned descendant or late output, and yields one failed entry while a fast sibling succeeds. (req: R2)
- [x] AC3. Existing order, retry, metadata and invalid-Result cases remain green; temporary outputs are removed after success and failure; the project gate passes. (req: R3) (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Use the existing asynchronous spawn seam, matching collectSourceDocs in apps/cli/src/fanin.ts:284. Thread targetTimeoutMs from runFanout into pluginDispatch and pass it as timeoutMs; inspect timedOut and report a named timeout. Ensure the production timeout waits for subprocess termination/reaping before cleanup; do not let the generic Promise.race settle production dispatch before cleanup is safe. Keep the injected async-dispatch timeout behavior for existing callers, but avoid a competing race for owned subprocesses (apply the generic race only to injected dispatch if needed). Read Result only after the child completes. Keep cleanup in finally. Tests must invoke runFanout without deps.dispatch and generate local sleeping/hanging publisher fixtures, recording timestamps/markers rather than relying on total runtime alone. Reuse the invoke cancellation test pattern for descendant checks. Rejected: keeping spawnSync and changing pool size (cannot overlap or run timers), or Promise.race alone (leaves side effects running after a reported timeout). Targets: apps/cli/src/fanout.ts, apps/cli/tests/fanout.test.ts; apps/cli/src/invoke.ts and its tests only if the existing completion/reaping guarantee requires a bounded adjustment. Out of scope: workflow-engine concurrency, new flags, generic process framework, actual publishing. No new dependency or public schema. Existing ADR-007/019 execution boundaries govern; update owning surface docs only if documented behavior needs correction.

### Plan

- [x] 1. Reproduce with real-process fixtures and add failing overlap, scheduling and descendant-timeout assertions.
- [x] 2. Thread the budget to asynchronous production dispatch and keep validation/cleanup after owned process completion (R1/R2).
- [x] 3. Verify aggregate/retry/metadata compatibility and cleanup with the existing suite (R3).
- [x] 4. Run targeted tests, bun run gate, and record evidence (R4).

### Solution

Smallest complete change: `apps/cli/src/fanout.ts` (production dispatch + budget ownership) and `apps/cli/tests/fanout.test.ts` (real-process regression coverage). No other file changed — `apps/cli/src/invoke.ts` needed no adjustment: `spawnPluginEntryAsync` already terminates and reaps the whole owned tree on its own `timeoutMs` timer and resolves only after `proc.exited` + pipe drains, so awaiting it is the completion guarantee production needed (its existing 0110 I2/I2b tests cover the tree kill).

**R1 — production dispatch is asynchronous, so independent publishers overlap.**

- Production spawn now goes through the timeout-aware seam instead of the event-loop-blocking `spawnPluginEntry`; same `--in`/`--out`/cwd/env construction. `apps/cli/src/fanout.ts:441`
- The async seam import replaces the sync one. `apps/cli/src/fanout.ts:17`
- The default dispatch is built as the *production* dispatch, so `--jobs`, `--serial` and `--serial-target` scheduling still reaches `fanout()` unchanged (the pool, ordered aggregation and serial-target tail are untouched). `apps/cli/src/fanout.ts:563`
- The production dispatch closure threads the run's per-target budget into `pluginDispatch`. `apps/cli/src/fanout.ts:565`
- `pluginDispatch` takes that budget as its fourth parameter and documents why the seam owns it. `apps/cli/src/fanout.ts:426`

**R2 — the per-target budget is enforced inside the owned spawn, before cleanup.**

- The budget reaches the spawn as `timeoutMs`. `apps/cli/src/fanout.ts:448`
- `timedOut` is inspected rather than inferred from the exit code. `apps/cli/src/fanout.ts:450`
- A timed-out target fails naming the target and its budget (`target 'x' exceeded its <ms>ms budget`, the wording documented for `--target-timeout`). `apps/cli/src/fanout.ts:452`
- The fan-out's generic `Promise.race` now applies only to an *injected* dispatch, so it can never settle the production path while an owned subprocess is still dying — the spawn's own timer kills and reaps the tree first. `apps/cli/src/fanout.ts:573`
- The `Result` is read and the temporary output deleted only after the awaited spawn resolves; cleanup stays in the `finally`. `apps/cli/src/fanout.ts:464`

**R3 — aggregation, validation and cleanup contracts preserved** (no edits to those paths; pinned by the existing suite plus the new cases): ordered aggregation in the caller's `--target` order `apps/cli/src/fanout.ts:187`, per-target outcome reduction and rejection capture `apps/cli/src/fanout.ts:93`, the injected-dispatch budget race still used by existing callers `apps/cli/src/fanout.ts:135`, non-zero plugin exit and error wording `apps/cli/src/fanout.ts:454`, `ResultSchema` validation through the shared reader `apps/cli/src/fanout.ts:463`, retry/skipped/metadata carry-forward and retained prior failures `apps/cli/src/fanout.ts:527`-`apps/cli/src/fanout.ts:558`, ordered aggregate of carried + freshly dispatched entries `apps/cli/src/fanout.ts:580`.

**R4 — offline real-process regression coverage** (no `deps.dispatch`, no network, no credentials; local `bun` publisher fixtures that stamp a ledger and a late marker).

- Overlap fixture: stamps `start`/`end` around a real 250 ms sleep into `<pluginsRoot>/ledger.jsonl`. `apps/cli/tests/fanout.test.ts:115`
- Hanging fixture: forks a child that writes its marker 2 s later, then idles — only a tree-wide kill reaps it. `apps/cli/tests/fanout.test.ts:147`
- Ledger reader and the interval-intersection predicate the AC1 assertions use. `apps/cli/tests/fanout.test.ts:166`, `apps/cli/tests/fanout.test.ts:183`
- AC1 default `--jobs 2`: the two publisher windows intersect (observed overlap `true`, spans 251 ms/251 ms). `apps/cli/tests/fanout.test.ts:1204`
- AC1 isolation: `--jobs 1`, `--serial` and `--serial-target` each keep the two real publishers from overlapping (observed overlap `false`). `apps/cli/tests/fanout.test.ts:1238`
- AC2: a hanging publisher that spawned a child is cut off at its budget (observed exit 1, elapsed 319 ms for a 300 ms budget), yields exactly one failed entry naming the target and budget while the fast sibling is `published`, leaves no `kk-fanout-*.json` temp output behind, and its descendant writes no late marker inside a 2.6 s grace. `apps/cli/tests/fanout.test.ts:1280`

Rejected as required: keeping `spawnSync` and changing pool size, and `Promise.race` alone over an owned subprocess (both leave side effects running after the reported timeout).

**Repair (test-fix hop, 2026-10-11) — Finding 1 (P2): the scheduling and budget flags now leave the command layer.**

- `FanoutOptions` declares the four flag shapes Commander already registers, so the action can forward them (wiring only — no `runFanout`/`pluginDispatch` semantics changed). `apps/cli/src/commands/executor.ts:31`
- `runFanoutAction` appends the `--serial` flag to the argv slice handed to the runner. `apps/cli/src/commands/executor.ts:107`
- `runFanoutAction` appends the `--jobs` value (a raw string; `runFanout`'s parser still owns its validation). `apps/cli/src/commands/executor.ts:110`
- `runFanoutAction` appends every repeatable `--serial-target` name. `apps/cli/src/commands/executor.ts:113`
- `runFanoutAction` appends the `--target-timeout` budget, the value that reaches the production spawn through the seam this task wired. `apps/cli/src/commands/executor.ts:116`
- The seam that budget now reaches on the shipped verb, unchanged by this hop. `apps/cli/src/fanout.ts:448`
- CLI-level regression check proving all four flags arrive at `runFanout`: it captures the argv the action hands the runner and fails against the pre-repair action. `apps/cli/tests/commands/executor.test.ts:476`

**Repair (test-fix hop, 2026-10-11) — Finding 2 (P3): the fan-out boundary doc no longer says "in sequence".**

- The architecture boundary now states the fan-out dispatches concurrently (bounded by `--jobs`, `--serial-target` names held out and run alone afterwards) and that a `--target-timeout` overrun kills that publisher's owned process tree and is recorded `failed`. `docs/03_ARCHITECTURE.md:249`
- The `executor fan-out` surface states the same timeout semantics: the budget is enforced by the owning spawn, which kills and reaps the tree before the fan-out reads or discards that target's temporary output. `docs/04_DESIGN.md:317`

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Production dispatch awaits the async seam `apps/cli/src/fanout.ts:441` (import `apps/cli/src/fanout.ts:17`), and `--jobs` / `--serial` / `--serial-target` still flow into `fanout()` at `apps/cli/src/fanout.ts:563-578`. Executed this run: `bun test apps/cli/tests/fanout.test.ts apps/cli/tests/commands/executor.test.ts` = 67 pass / 0 fail, including the real-process overlap and isolation cases at `apps/cli/tests/fanout.test.ts:1204` and `apps/cli/tests/fanout.test.ts:1238`; my own shipped-verb probe over two real 250 ms publisher processes reports overlap true by default (both publisher windows start in the same millisecond, 251 ms spans each) and overlap false for `--jobs 1`, `--serial` and `--serial-target probe-b` (serialized, the second process starting 20-27 ms after the first ended). |
| R2 | MET | Budget reaches the owned spawn: `apps/cli/src/commands/executor.ts:116` -> `apps/cli/src/fanout.ts:565` -> `apps/cli/src/fanout.ts:448`; `timedOut` is inspected before `exitCode` at `apps/cli/src/fanout.ts:450-452`; the generic race is applied only to an injected dispatch (`apps/cli/src/fanout.ts:573` vs `apps/cli/src/fanout.ts:135`); the `Result` is read and the temporary output deleted after the awaited spawn resolves (`apps/cli/src/fanout.ts:463-466`, cleanup in the `finally`). Executed this run: `apps/cli/tests/fanout.test.ts:1280` passes; my own shipped-verb probe with two real 250 ms publishers and `--target-timeout 50` exits 1 with both entries failed as `target 'probe-a' exceeded its 50ms budget` and `target 'probe-b' exceeded its 50ms budget` (durationMs 67/81) and start-only ledger stamps, so both publisher trees were killed before their sleep ended while the exit code and the named budget reached the operator. |
| R3 | MET | The diff leaves the aggregation / validation / retry paths untouched: outcome reduction `apps/cli/src/fanout.ts:93`, injected-dispatch race `apps/cli/src/fanout.ts:135`, ordered aggregation `apps/cli/src/fanout.ts:187`, plugin-exit wording `apps/cli/src/fanout.ts:454`, ResultSchema read `apps/cli/src/fanout.ts:463`, retry carry-forward `apps/cli/src/fanout.ts:527-558`, carried-plus-fresh aggregate `apps/cli/src/fanout.ts:580`. Executed this run: order `apps/cli/tests/fanout.test.ts:198`, retry `apps/cli/tests/fanout.test.ts:373` and `apps/cli/tests/fanout.test.ts:538`, metadata `apps/cli/tests/fanout.test.ts:448`, invalid-Result `apps/cli/tests/fanout.test.ts:949` all pass; temporary outputs are deleted on success and on failure by the `finally` at `apps/cli/src/fanout.ts:464-466`. |
| R4 | MET | Offline real-process coverage with no `deps.dispatch`, no network and no credentials: sleeping-publisher fixture `apps/cli/tests/fanout.test.ts:115`, hanging-publisher-with-child fixture `apps/cli/tests/fanout.test.ts:147`, ledger reader `apps/cli/tests/fanout.test.ts:166`, interval-intersection predicate `apps/cli/tests/fanout.test.ts:183`, CLI-level forwarding check `apps/cli/tests/commands/executor.test.ts:476`; my own probe used only local plugin directories under a throwaway temp root. Executed this run: both files 67 pass / 0 fail; the project gate receipt on this tree is `.spur/run/0248-test-gate.status` = PASS with `.spur/run/0248-test-gate.log` = 2413 pass / 2 skip / 0 fail, 2415 tests across 130 files (the 2 skips are pre-existing capability gates, untouched here), and `.spur/run/0248-gate-recheck3.out` = GATE_EXIT=0. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1. Two real fixture publisher processes overlap with jobs=2; jobs=1, --serial and --serial-target fixtures do not overlap when their scheduling requires isolation. (req: R1) | MET | test | `apps/cli/tests/fanout.test.ts:1204` (default `--jobs 2`; two real 250 ms publisher processes whose ledger windows intersect) and `apps/cli/tests/fanout.test.ts:1238` (`--jobs 1`, `--serial` and `--serial-target` each report overlap false) pass this run inside `bun test apps/cli/tests/fanout.test.ts apps/cli/tests/commands/executor.test.ts` = 67 pass / 0 fail; my own shipped-verb probe reproduces the same split end to end on the shipped `kk executor fan-out` verb (overlap true by default; overlap false for `--jobs 1`, `--serial`, `--serial-target probe-b`). |
| AC2. A hanging fixture that spawns a child is terminated within its budget plus bounded reaping overhead, leaves no live owned descendant or late output, and yields one failed entry while a fast sibling succeeds. (req: R2) | MET | test | `apps/cli/tests/fanout.test.ts:1280` passes this run: the hanging publisher that forked a child is cut off at its 300 ms budget while the fast sibling is published, exactly one entry fails naming the target and the budget, the temp dir holds no token-scoped result file (`apps/cli/tests/fanout.test.ts:1325`), and the descendant marker is absent after a 2.6 s grace. My own shipped-verb probe reproduces it (exit 1, elapsed 452 ms for the 300 ms budget, `ps` shows no live descendant process, 0 leaked result files in the temp dir) and a control run of the same fixture at a 5000 ms budget does show the child's 2 s marker, so the absent marker under the short budget is the tree kill. |
| AC3. Existing order, retry, metadata and invalid-Result cases remain green; temporary outputs are removed after success and failure; the project gate passes. (req: R3) (req: R4) | MET | test | Existing order (`apps/cli/tests/fanout.test.ts:198`), retry (`apps/cli/tests/fanout.test.ts:373`, `apps/cli/tests/fanout.test.ts:538`), metadata (`apps/cli/tests/fanout.test.ts:448`) and invalid-Result (`apps/cli/tests/fanout.test.ts:949`) cases pass this run: `bun test apps/cli/tests/fanout.test.ts apps/cli/tests/commands/executor.test.ts` = 67 pass / 0 fail, 265 expect() calls. Temporary outputs are removed after success and after failure (in-test assertion `apps/cli/tests/fanout.test.ts:1325`; my probe's post-run count of `kk-fanout-*.json` in the temp dir is 0). The project gate passes on this tree per `.spur/run/0248-test-gate.status` = PASS (`.spur/run/0248-test-gate.log`: 2413 pass / 2 skip / 0 fail, 2415 tests across 130 files), and its proof digest matches at gate entry and now (`.spur/run/dev-run-0248-eaea19-proofDigest.txt` = `.spur/run/dev-run-0248-eaea19-proofDigestNow.txt`), with every changed file's mtime earlier than the gate log. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0248
**Scope:** `apps/cli/src/fanout.ts`, `apps/cli/tests/fanout.test.ts` vs `HEAD` (base `e6b9a23c`), read against `apps/cli/src/invoke.ts` (spawn seam), `apps/cli/src/commands/executor.ts` (the `kk` verb), `apps/cli/src/fanin.ts` (the pattern R1 cites) and the ADR/design docs.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — one open **P2** (Finding 1), so the run routes to the bounded repair hop rather than a clean gate.
**Verification basis:** read-only review (this session had no shell; nothing executed, nothing edited). Gate evidence cited, not re-run: `.spur/run/0248-test-gate.status` = `PASS`; `.spur/run/dev-run-0248-eaea19-proofDigest.txt` == `…proofDigestNow.txt` (`sha256:eec8862424224acfc084714b848eedf47411aff409891891a0467c3e33e73e0c`), so the certified tree is the reviewed tree.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness / architecture | The CLI accepts `--serial` / `--jobs` / `--serial-target` / `--target-timeout` and drops all four before `runFanout`, which this diff makes consequential: concurrency is now real, so the isolation guards are silently inert and R2's publisher deadline is unreachable from the shipped verb. | `apps/cli/src/commands/executor.ts:31-38`, `:92-106` (reached from `apps/cli/src/fanout.ts:563-578`) | RESOLVED (fixed in the repair hop; re-verified attempt 2) |
| 2 | P3 (minor) | architecture / docs | `docs/03_ARCHITECTURE.md:249` still states the fan-out dispatches N publishers "in sequence", contradicting the ADR-007 R4 amendment, `docs/04_DESIGN.md:275-278` and now the code. One line. | `docs/03_ARCHITECTURE.md:249` | RESOLVED (fixed in the repair hop; re-verified attempt 2) |
| 3 | P4 (advisory) | usability / correctness | The async seam spawns detached (`apps/cli/src/invoke.ts:387`), so production publishers are now their own process group: Ctrl-C no longer reaches them and the descendant sweep is fire-and-forget. Fan-in parity since 0110. | `apps/cli/src/invoke.ts:387`, `:334-337`, `:390-397` | ACCEPTED |

##### Finding 1 (P2) — the fan-out knobs never leave the command layer

**Evidence (static, unambiguous).** Commander declares all four flags (`apps/cli/src/commands/executor.ts:151-161`: `--serial`, `--jobs`, `--serial-target`, `--target-timeout`), but the action's option interface lists none of them (`:31-38`) and `runFanoutAction` rebuilds argv with only `--content`, `--out`, `--target`, `--retry-from`, `--plugins-root`, `--plugins-path` (`:92-106`) before calling `runFanout(argv)` (`:107`). `runFanout` is reached from exactly one place (`grep runFanout` → `executor.ts:3` import, `:107` call), so no other path forwards them either. `runFanout` reads those options at `apps/cli/src/fanout.ts:574-578` and the budget only reaches `pluginDispatch` through the closure at `:565` — never populated from the CLI.

**Why this diff makes it matter (not a pre-existing no-op).** Before this diff, production dispatch went through the blocking `spawnPluginEntry` (`Bun.spawnSync`), so the pool serialized on the event loop and every guard's *effect* held by accident — which is also why 0248's own Background repro saw `--target-timeout 50` yield exit 0 / two published outcomes. Now `apps/cli/src/fanout.ts:441` awaits the async seam and `:563-578` really overlaps, so:
- `kk executor fan-out --target-timeout N` never passes `timeoutMs` to `spawnPluginEntryAsync` (`fanout.ts:448`), so the R2 deadline and its tree kill never engage on the shipped verb — **R2 is delivered only at the `runFanout` seam**;
- `--jobs 1` / `--serial` / `--serial-target` are ignored while overlap is live. `--serial-target` is documented for a headed browser channel or a publisher sharing a checkout (`docs/04_DESIGN.md:290`, ADR-007 R4 amendment `docs/00_ADR.md:304-310`) — i.e. a single-writer resource, where concurrent start is a corruption risk, not a slowdown.

**Corroboration.** The implementer's own CLI probe (`worker_output.md` §d) reports `--jobs 1` overlap=true, `--serial` overlap=true, `--target-timeout 50` → exit 0 with both published, consistent with this reading. Class sweep: `run` and `fan-in` forward every flag they declare (`:113-120` vs `:6-12`; `:121-141` vs `:14-23`); fan-out is the only instance, so no siblings to report.

**Smallest fix.** Add `serial?: boolean; jobs?: string; serialTarget?: string[]; targetTimeout?: string;` to `FanoutOptions` and push `--serial`, `--jobs`, `--serial-target`, `--target-timeout` in `runFanoutAction`; add one CLI-level regression check in `apps/cli/tests/commands/executor.test.ts` following the existing `main([...])` pattern (the `--retry-from` case) so the flags are proven to arrive, not merely declared.

##### Finding 2 (P3) — derived arch doc still calls the fan-out sequential

`docs/03_ARCHITECTURE.md:249-250`: "**Fan-out (1→N):** dispatch `Content` to N publishers **in sequence**". The ADR amendment (`docs/00_ADR.md:289-310`) and `docs/04_DESIGN.md:275-278` already say concurrent; pre-diff the sentence was only *accidentally* accurate because `spawnSync` serialized production, and this diff is the seam change that doc owns ("Keep process lifecycle handling at the existing spawn seam", `docs/03_ARCHITECTURE.md:283-285`). Smallest fix: one line — dispatch concurrently, bounded by `--jobs`, with `--serial-target` names run alone after the batch. Optional same-edit parity: a one-line timeout-semantics sentence in `docs/04_DESIGN.md` §1.6 mirroring the fan-in paragraph at `:259-263` (the production budget kills the owned tree).

##### Finding 3 (P4, ACCEPTED) — detached-group side effects now cover production fan-out

`spawnPluginEntryAsync` spawns with `detached: process.platform !== 'win32'` (`apps/cli/src/invoke.ts:387`) so the timeout can group-kill (`killProcessTree`, `:334-337`), and `killProcessTree` is wired only to the `timeoutMs` timer (`:390-397`); there is no `process.on('SIGINT'/'SIGTERM')` anywhere in `apps/cli/src`. Pre-diff the sync child shared kk's foreground group and died with Ctrl-C; now an operator abort leaves in-flight publishers running, able to complete a publish after the abort, with their `kk-fanout-*.json` temp file uncleaned. Same terms as fan-in since 0110, so accepted here; a signal handler calling the (currently private) tree kill would close it, and that is its own decision. Related residual: the spawn resolves on `proc.exited` while the descendant sweep continues by design (`invoke.ts` comment "keeps running slightly past exit"), so a descendant that escapes the group (`setsid`) could rewrite the out path after cleanup — worst case a leaked `/tmp` file, never a wrong verdict, since a timed-out target is failed and its Result is not read.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/fanout.ts:17,441` production spawn goes through `spawnPluginEntryAsync`; `:563-578` production dispatch keeps `mode`/`jobs`/`serialTargets` plumbing into `fanout()`; real-process tests `apps/cli/tests/fanout.test.ts:1204` (overlap `true`, 250 ms fixtures) and `:1238` (jobs-1 / `--serial` / `--serial-target` each overlap `false`) |
| R2 | PARTIAL | Budget threaded `fanout.ts:426,448`, `timedOut` inspected `:450-452` (named `target 'x' exceeded its <ms>ms budget`), Result read + temp cleanup only after the awaited spawn `:463-465`, generic race disabled for owned subprocesses `:573,578`; test `fanout.test.ts:1280` (exit 1, 319 ms for a 300 ms budget, one `failed` + one `published`, no `kk-fanout-*.json` left, no late marker at +2.6 s). **PARTIAL because the flag is dropped by the CLI layer — Finding 1.** |
| R3 | MET | Diff touches no aggregation/validation/retry path (`fanout.ts:187,93,527-558,580` unchanged); `spawnPluginEntryAsync` uses the same cmd/env construction, so operator-config env, cwd and `KNOWLEDGE_KIT_PROJECT_ROOT` behaviour is unchanged; existing suite green in the certified gate |
| R4 | MET | Offline real-process fixtures only: `apps/cli/tests/fanout.test.ts:103,115,147,166,183`; no `deps.dispatch`, no network, no credentials; gate PASS |

##### Acceptance Criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | `fanout.test.ts:1204` real overlap under `--jobs 2`; `:1238` non-overlap for `--jobs 1`, `--serial`, `--serial-target` — timestamps from each publisher's own ledger, not wall clock |
| AC2 | MET | `fanout.test.ts:1280` — real hanging fixture that forks a child: terminated at budget, one failed entry naming target and budget, fast sibling `published`, no temp output, descendant marker absent after a 2.6 s grace |
| AC3 | MET | Certified gate `PASS` (2414 tests / 130 files, `0248-test-gate.status`); digest unchanged since gate entry; diff leaves order/retry/metadata/invalid-Result paths untouched |

##### Correct

- Seam choice and layering are right: the process owner (`invoke.ts`) enforces the budget and reaps the tree; the fan-out no longer races an owned subprocess (`fanout.ts:573`) while the injected-dispatch race is preserved for callers that own no process (`:135`, test `fanout.test.ts:1198`).
- Cleanup stays in `finally` after the awaited spawn (`fanout.ts:460-466`); the timeout wording matches the documented contract (`docs/04_DESIGN.md:291`) and the injected-path wording, so operators see one message shape.
- Tests are meaningful, not timing theatre: interval intersection from per-process stamps, a token-scoped tmpdir assertion, and a descendant deadline (2.6 s) that fails if only the direct child is killed.
- Readable, minimal diff: 41 changed lines in `fanout.ts`, no dead code, no new flags, no new dependency, `invoke.ts` untouched as the Solution claims.

**Next:** repair Finding 1 in `apps/cli/src/commands/executor.ts` (4 forwarded flags + one CLI-level check) and the one-line Finding 2 doc fix in the same hop; if the supervisor instead keeps 0248's frozen target set, file the forwarding as its own WBS and re-route this run's P2 then.

#### Review Report — 0248 · attempt 2 (2026-10-11, re-certification on the repair digest)
**Scope:** the bounded repair hop's delta on top of attempt 1 — `apps/cli/src/commands/executor.ts`, `apps/cli/tests/commands/executor.test.ts`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md` — read against the attempt-1-reviewed `apps/cli/src/fanout.ts` (untouched by the hop) and the spawn seam `apps/cli/src/invoke.ts`.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — Finding 1 (P2) and Finding 2 (P3) are verified fixed; one new **P3** (Finding 4) keeps the run on the bounded repair hop rather than a clean gate.
**Verification basis:** fresh and executed in this attempt on the certified tree. Gate evidence cited, not re-run (contract): `.spur/run/0248-test-gate.status` = `PASS`, digest `sha256:709370e360b8ddeb947622b4aaae3b7e072d0a2fe7c758fd586453f9d32134a3` identical at gate entry and review entry. Targeted checks only: both affected suites, one CLI-level falsification against base `e6b9a23c`, and a nine-variant end-to-end probe of the shipped verb against real 250 ms publisher processes under a throwaway root.

##### Repair judgment (attempt 1's findings)

- **Finding 1 (P2) → RESOLVED.** `FanoutOptions` now declares the four shapes Commander registers (`apps/cli/src/commands/executor.ts:31-34` vs `:169-179`) and `runFanoutAction` forwards each in exactly the shape `runFanout`'s parser reads (`apps/cli/src/fanout.ts:352` flag-only `--serial`, `:354` `--jobs <value>`, `:364` repeatable `--serial-target`, `:370` `--target-timeout <value>`): pushes at `executor.ts:107`, `:110`, `:113`, `:116`. Executed proof on the shipped verb with my own fixtures (ledger-stamped per-process intervals): default **OVERLAP=true** (start delta 1 ms, spans 251/252 ms); `--jobs 1` **false** (delta 268 ms); `--serial` **false** (268 ms); `--serial-target sleep-b` **false** (267 ms); `--target-timeout 50` **exit 1** with both entries failed as `target 'sleep-a' | 'sleep-b' exceeded its 50ms budget` (durationMs 67/81, no end stamp → the publisher trees were killed, not merely raced). The canonical `executor fan-out` verb behaves identically, so verb and alias share the repaired action. Parser ownership is intact: `--jobs abc` → exit 2, `fanout: --jobs requires a positive integer, got 'abc'` (the raw string crosses the seam; validation stays in `runFanout`).
- **The CLI-level check is a genuine regression check.** `apps/cli/tests/commands/executor.test.ts:476` passes on the certified tree (1 pass / 3 expect() calls; whole file 19 pass / 0 fail). Independently falsified: base tree `e6b9a23c` extracted to a throwaway dir, the current test file copied there and run → **0 pass / 1 fail**, captured argv `['--content', …, '--out', …, '--target', 'fake-pub', '--plugins-root', …]` with all four tokens absent, `Expected -1 / Received +10` — so the spy intercepts and the assertion discriminates the missing forwarders (not log formatting).
- **Finding 2 (P3) → RESOLVED.** `docs/03_ARCHITECTURE.md:249-253` now states concurrent dispatch bounded by `--jobs`, `--serial-target` names held out and run alone afterwards, and the `--target-timeout` tree kill recorded `failed` — accurate against `apps/cli/src/fanout.ts:150-188` (pool + serial-target tail) and `:441-455` (budget → kill/reap → read/delete). The added `docs/04_DESIGN.md:317-321` timeout paragraph is accurate: the budget is enforced by the owning spawn, not a fan-out-side race; the tree is killed and reaped before the temporary output is read or discarded; the target is recorded `failed` naming target and budget; siblings continue.
- **Finding 3 (P4) unchanged, still ACCEPTED.** `apps/cli/src/invoke.ts` is absent from the diff (`git status`), so the detached-group / no-signal-handler residual is exactly what attempt 1 accepted; a change here was out of scope for the hop.
- **No `runFanout`/`pluginDispatch` semantics were changed by the repair hop.** The delta is confined to the command layer, its test, and two doc paragraphs: `apps/cli/src/fanout.ts` keeps every attempt-1 line anchor (`:17`, `:426`, `:441`, `:448`, `:450-452`, `:463-465`, `:563-578`), and `apps/cli/src/commands/executor.ts` hashes to the hop's own recorded restore value `070f4e46…`. The R2-required split — production dispatch owns its budget inside the spawn (`fanout.ts:448`), the generic race kept only for an injected dispatch (`:573` vs `:135`) — is unchanged and still correct.
- **Fresh acceptance evidence.** `bun test apps/cli/tests/fanout.test.ts` → 48 pass / 0 fail (6.76 s), including the real-process AC1 overlap/isolation cases (`fanout.test.ts:1204`, `:1238`) and AC2's descendant-timeout case (`:1280`).

##### Findings (attempt 2, ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 4 | P3 (minor) | architecture / docs | The fan-out command index still says "in sequence" — the same class attempt 1 fixed in `docs/03_ARCHITECTURE.md:249`, and it contradicts §1.6's own behavior paragraph (`docs/04_DESIGN.md:301`), the ADR-007 R4 amendment and the code. One line. | `docs/04_DESIGN.md:93` | RESOLVED (fixed in the third repair hop, 2026-10-11; re-verified attempt 3) |
| 5 | P4 (advisory) | correctness / tests | The CLI-level check asserts `expect.arrayContaining([...])`, which is order- and adjacency-insensitive: it proves the tokens arrive, not that each value flag is immediately followed by its value — the property the parser depends on (`runFanout` reads `argv[++i]`, `apps/cli/src/fanout.ts:354-379`). Asserting the exact array, or round-tripping the captured argv, would close that gap. | `apps/cli/tests/commands/executor.test.ts:514-533` | ACCEPTED |

##### Functional Traceability (attempt 2)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Async seam `apps/cli/src/fanout.ts:17,441`; scheduling reaches `fanout()` `:563-578`; the repair makes the shipped verb honour it — probe: default overlap `true` (delta 1 ms) vs `--jobs 1` / `--serial` / `--serial-target` `false` (delta 267-268 ms); tests `apps/cli/tests/fanout.test.ts:1204`, `:1238` |
| R2 | MET | Budget reaches the spawn from the shipped verb: `executor.ts:116` → `fanout.ts:370,379` → closure `:565` → `:448`; probe `--target-timeout 50` → exit 1, both targets `exceeded its 50ms budget`, publishers killed before their end stamp; test `fanout.test.ts:1280` |
| R3 | MET | The repair touches no aggregation/validation/retry path; `bun test apps/cli/tests/fanout.test.ts` 48 pass / 0 fail on the certified tree; certified gate PASS |
| R4 | MET | The added CLI-level check is offline with real argv capture (`apps/cli/tests/commands/executor.test.ts:476`), falsified against base `e6b9a23c` (1 fail) |

##### Acceptance Criteria (attempt 2)

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | `fanout.test.ts:1204` / `:1238` green this attempt; the end-to-end probe confirms the same split on the shipped verb (overlap `true` by default, `false` for `--jobs 1`, `--serial` and `--serial-target`) |
| AC2 | MET | `fanout.test.ts:1280` green; probe `--target-timeout 50` cut both 250 ms publishers at their budget with the named error and exit 1 |
| AC3 | MET | Certified gate PASS (digest unchanged); fresh `bun test` on both affected files: 19 + 48 pass, 0 fail |

##### Correct

- The repair is wiring only, exactly as declared: option shapes mirroring Commander's registrations, four pushes whose token, arity and shape match `parseArgs`, no touched aggregation, no new flag, no new dependency, `invoke.ts` untouched.
- Trust boundary respected: `--jobs` / `--target-timeout` cross as raw strings and are validated only in `runFanout` (`fanout.ts:354-379`), so the command layer cannot smuggle an unvalidated budget past the parser (`--jobs abc` → exit 2).
- The test follows the file's existing pattern (`main([...])` plus `spyOn` restored in `finally`), asserts the captured argv rather than log text, and cleans its tmp fixture.
- Class sweep this attempt (the H1 lesson): `in sequence` / `sequentially` / `one at a time` across `docs/00`, `03`, `04`, `05` — `docs/03_ARCHITECTURE.md:119,447`, `docs/00_ADR.md:276,544`, `docs/05_FEATURES.md:56` and `docs/04_DESIGN.md:25` all describe the workflow-step ordering ADR-007 R4 still owns and remain correct; `docs/04_DESIGN.md:93` is the only remaining statement about the *dispatch* of N targets, hence Finding 4.

**Next:** one-line repair of `docs/04_DESIGN.md:93` ("in sequence" → concurrent dispatch bounded by `--jobs`, §1.6) in the bounded repair hop; Finding 5 is an accepted P4 and needs no change.


#### Review Report — 0248 · attempt 3 (2026-10-11, final re-certification on the hop-3 digest)
**Scope:** the final repair hop's delta — `docs/04_DESIGN.md:93` (one command-index cell) — plus the whole 7-file diff against base `e6b9a23c` (`apps/cli/src/fanout.ts`, `apps/cli/src/commands/executor.ts`, both test files, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`).
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — Finding 4 (P3) is verified fixed; one new P3 class-sweep residual (Finding 6) is dispositioned `DEFER`; no row is blocking.
**Verification basis:** fresh and executed in this attempt on the certified tree. Gate cited, not re-run (contract): `.spur/run/0248-test-gate.status` = `PASS`, log `.spur/run/0248-test-gate.log` = `2413 pass / 2 skip / 0 fail`, `Ran 2415 tests across 130 files`, `proof-digest: sha256:e7b9f0859e871d3748d16d978c384aeb04693433ad5b8f63f34d95ee5c38fbec`; that digest is identical in `dev-run-0248-eaea19-proofDigest.txt`, `…proofDigestNow.txt` and `0248-check-receipt.json.inputDigest`, so the certified tree is the reviewed tree. The 2 skips are pre-existing capability gates (`apps/cli/tests/kk-workflow-stages.test.ts` → `it.n(platform !== 'darwin')`, `plugins/generations/voice-gen/tests/voice-gen.test.ts` → `it.n(!Bun.which('ffmpeg'))`), untouched by this diff — not suppressions. Executed this attempt: both affected suites, a five-variant end-to-end probe of the shipped verb against real 250 ms publisher processes, and the residual scanner's own parse of this section.

##### Findings (attempt 3, ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 6 | P3 (minor) | architecture / docs | `docs/03_ARCHITECTURE.md:301` still reads "Retry repairs preserve the existing aggregate fields and sequential dispatch" inside the dated `Shipped (2026-09-10, task 0110)` subsection — the same class Finding 2 and Finding 4 fixed, missed by attempt 2's sweep pattern. Stale as a present-tense claim (today the retry path uses the concurrent pool at `apps/cli/src/fanout.ts:150-183`), held to minor by its dated framing; one phrase at wrap. | `docs/03_ARCHITECTURE.md:301` | DEFER(dated 0110 subsection; wording only, no contract or behavior effect; repair budget spent) |

##### Finding 4 (P3) — verified fixed

- `docs/04_DESIGN.md:93` now reads "Dispatch one `Content` to N publish targets concurrently, bounded by `--jobs`; `--serial-target` names are held out and run alone afterwards (§1.6)". Accurate against `apps/cli/src/fanout.ts:150-183`: the worker pool bounds in-flight starts by `--jobs` (`:182`), `serialTargets` are filtered out of the batch (`:170`) and run one at a time after `Promise.all` (`:183`).
- Executed corroboration on the shipped verb (probe `--serial-target sleep-b`): `sleep-a[9318-9569]`, `sleep-b[9590-9841]`, overlap `false` — the held-out name starts after the batch target's ledger `end` stamp, so "held out and run alone afterwards" is literal, not loose wording.
- Row well-formed: the `| Command | Description | Status |` table's row carries 3 cells (4 pipes, no escaped pipe, no multi-line cell), so the residual scan's `parseReviewFindings` cannot mis-split it; `(§1.6)` is retained and §1.6 says the same thing (`docs/04_DESIGN.md:275-278` concurrency, `:301-305` behavior, `:317-321` timeout semantics).

##### Finding 6 (new, P3, DEFER) — the class sweep's last instance: a dated sentence still says "sequential dispatch"

`docs/03_ARCHITECTURE.md:301` — "Retry repairs preserve the existing aggregate fields and sequential dispatch, and target eligibility is reconciled…", inside the section headed `Shipped (2026-09-10, task 0110)`. This is the same class as Finding 2 (`:249`) and Finding 4 (`docs/04_DESIGN.md:93`), and attempt 2's sweep pattern (`in sequence|sequentially|one at a time`) cannot match "sequential dispatch", which is how it survived that sweep. Read as a present-tense claim it is stale: the retry path dispatches through the same concurrent pool this task now reaches from the shipped verb (`apps/cli/src/fanout.ts:150-183`, `:563-578`). What holds it at P3 and not higher is its dated framing — the sentence states the invariant the 0110 retry repair set preserved ("the existing … dispatch"), and every normative statement is now correct: ADR-007 R4 amendment (`docs/00_ADR.md:289-310`), `docs/03_ARCHITECTURE.md:249-253`, `docs/04_DESIGN.md:93`, `:301-305`, `docs/design/fan-in-and-fan-out-specification.md:102`. Fix is one phrase at wrap. **DEFER(dated 0110 subsection; wording only, no contract or behavior effect; repair budget spent)**.

##### Functional Traceability (attempt 3)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Async seam `apps/cli/src/fanout.ts:17,441`; scheduling still reaches `fanout()` `:563-578`; executed probe on the shipped verb — default overlap `true` (spans 251/251 ms, start delta 0 ms), `--jobs 1` `false` (17 ms gap), `--serial` `false`, `--serial-target sleep-b` `false`; `apps/cli/tests/fanout.test.ts:1204`, `:1238` green this attempt |
| R2 | MET | Budget reaches the spawn from the shipped verb: `apps/cli/src/commands/executor.ts:116` → `apps/cli/src/fanout.ts:370,379` → closure `:565` → `:448`; probe `--target-timeout 50` → exit 1, both entries `failed` naming their target and `exceeded its 50ms budget`, durationMs 68/82, and no `end` stamp in either ledger (the trees were killed, not raced); `:450-452` inspects `timedOut`; the generic race is disabled for owned subprocesses `:573` and kept for injected dispatch `:135` |
| R3 | MET | Attempt-2 anchors re-read unchanged: `:187` ordered aggregation, `:93` outcome reduction, `:454` exit-code wording, `:463` `ResultSchema` reader, `:527-558` retry carry-forward, `:580` carried+dispatched aggregate; env/cwd parity re-verified from `apps/cli/src/invoke.ts:115`, `:122` reaching both `spawnPluginEntry` (`:269-275`) and `spawnPluginEntryAsync` (`:371`, `:441`); `bun test` on both affected files 67 pass / 0 fail; certified gate PASS |
| R4 | MET | Offline local `bun` fixtures only (`apps/cli/tests/fanout.test.ts:115,147,166,183`), no `deps.dispatch`, no network, no credentials; the added CLI-level check captures argv rather than log text (`apps/cli/tests/commands/executor.test.ts:476-536`) |

##### Acceptance Criteria (attempt 3)

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | `fanout.test.ts:1204` (real overlap, per-process ledger windows) and `:1238` (`--jobs 1`, `--serial`, `--serial-target` non-overlap) green this attempt; the shipped-verb probe reproduces the same split end to end |
| AC2 | MET | `fanout.test.ts:1280` green this attempt: hanging fixture with a forked child, exit 1, budget-bound settle, one `failed` entry naming target + budget, fast sibling `published`, no token-scoped `kk-fanout-*.json` left, descendant marker absent after a 2.6 s grace; probe's `--target-timeout 50` corroborates the deadline on the shipped verb |
| AC3 | MET | Certified gate PASS on this exact tree (2415 tests / 130 files, digest above); `bun test apps/cli/tests/fanout.test.ts apps/cli/tests/commands/executor.test.ts` → 67 pass / 0 fail, 265 `expect()` calls, 6.73 s; the diff touches no order/retry/metadata/invalid-`Result` path |

##### Whole-diff review (attempt 3)

- **Correctness.** Production dispatch awaits the spawn that owns the budget and reaps the tree (`apps/cli/src/fanout.ts:441-452` → `apps/cli/src/invoke.ts:371-407`): `timedOut` is checked before `exitCode`, so a budget overrun is reported as a named timeout rather than a stray exit code, and the `Result` read (`:463`) plus `finally` cleanup (`:464-465`) happen strictly after `await proc.exited` + pipe drains (`apps/cli/src/invoke.ts:401-403`). Command-layer forwarding matches the parser it feeds flag-for-flag (`apps/cli/src/commands/executor.ts:107-119` vs `apps/cli/src/fanout.ts:352-379`), with `--jobs` / `--target-timeout` crossing as raw strings so validation stays in `runFanout` (executed: `--jobs abc` → exit 2).
- **Minimality.** 18 added lines in the command layer, 41 in `fanout.ts`, no new flag, no new dependency, no new abstraction; `apps/cli/src/invoke.ts` is absent from the diff (`git status`), so Finding 3's residual is byte-identical to what attempt 1 accepted.
- **Regression risk.** `validateTargets` keeps its exact pre-diff guard (`productionDispatch` is defined as the old `deps.dispatch === undefined`), the injected-dispatch race is preserved (`:135`), and the only intentional behavior change for production is that a budget overrun now kills the tree instead of letting the blocking spawn finish (pre-diff the CLI never delivered the flag at all). No other caller of `pluginDispatch` exists (`grep pluginDispatch` → declaration `:422` + closure `:565`).
- **Finding 3 (P4) and Finding 5 (P4) unchanged, still ACCEPTED.** Both were out of scope for the hops and neither is created or worsened by them.

##### Executed vs read (honesty boundary)

- **Executed this attempt:** `bun test apps/cli/tests/fanout.test.ts apps/cli/tests/commands/executor.test.ts` (67 pass / 0 fail); the five-variant shipped-verb probe (`sh .spur/run/dev-run-0248-eaea19/cli-probe.sh`) with per-process ledger intervals; digest/task-file/column-count shell checks; the residual scanner's review-gate parse of this section (`blocking=0`).
- **Read-only (no execution):** the seam-parity claim (`pluginEntryCmd`/`pluginEntryEnv` shared by both spawns, `detached` only on the async path), `killProcessTree`'s descendants-then-entry ordering, the new tests' assertion quality, and doc/ADR wording accuracy. The full gate was not re-run (contract); its PASS rests on `.spur/run/0248-test-gate.log` + the three matching digests.

##### Correct

- The final hop did exactly what Finding 4 asked: one cell, in the doc whose section already described the same behavior, with the `(§1.6)` pointer intact and no collateral edit — `git diff docs/04_DESIGN.md` shows the cell plus the attempt-2 timeout paragraph only.
- The doc set now agrees with itself and with the code on all three claims that matter: concurrent dispatch bounded by `--jobs`, `--serial-target` held out, and `--target-timeout` failing a target by name without aborting siblings.

**Next:** none for this task's code or docs. Finding 6 is a one-phrase wording refresh to sweep at a wrap/doc-hygiene pass; Findings 3 and 5 stay ACCEPTED P4s.

### References

- apps/cli/src/fanout.ts:431 — blocking production spawn.
- apps/cli/src/invoke.ts:371 — existing async spawn seam.
- apps/cli/src/fanin.ts:284 — async caller pattern.
- docs/03_ARCHITECTURE.md:267 — execution boundary integrity.
- Review run dev-review-packages-and-4-a71c, .spur/run/review-repro.json.
- Feature B6; ADR-007 concurrency amendment and ADR-019.

### History

- 2026-10-10T07:15:49.444Z backlog → todo (system)
- 2026-10-12T00:34:43.406Z todo → wip (system)
- 2026-10-12T02:22:06.902Z wip → testing (system)
- 2026-10-12T02:23:33.741Z testing → done (system)

