---
schema_version: 1
name: Stop the test suite from composing workspaces under the operator's home
status: done
template: issue
created_at: 2026-10-12T21:45:47.258Z
updated_at: "2026-10-13T17:45:44.043Z"
feature_id: G11

ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0267-verdict.json
---

## 0267. Stop the test suite from composing workspaces under the operator's home

### Background

`apps/cli/src/commands/daily.ts` `prepareAction` composes `options.workDir || join(options.worksDir ?? resolveWorksDir(), options.workflow, dirDate)`, and `resolveWorksDir()` falls back to the compiled default `~/.config/kk/works` when neither `KK_WORKS_DIR` nor a config `works_dir` is present.

Observed on 2026-10-12 at 11:35 local, during a test run of the suite: an empty `~/.config/kk/works/kk-daily-ai-voice2/` directory appeared in the operator's home. It is the workflow child of that fallback, created by a test that exercises the daily prepare path without pinning `KK_WORKS_DIR`/`KK_CONFIG` to a temp dir. Nothing in the repo recreates the *date* child, so the artifact is a bare workflow directory — harmless in size, but it means tests write outside their sandbox into operator state, and any future prepare that gets one step further would compose a real run workspace there.

### Requirements

- [x] R1. Find the test(s) that reach `prepareAction`/`resolveWorksDir` without pinning the works root, and isolate them (`KK_WORKS_DIR` or `KK_CONFIG` pointed at a temp dir, or an explicit `--work-dir`).
- [x] R2. Leave the production fallback chain unchanged — `KK_WORKS_DIR` > config `works_dir` > `~/.config/kk/works` is the documented contract; the defect is the test, not the resolver.
- [x] R3. Add a regression assertion that the suite creates nothing under the operator's home (a test that fails when the isolation is removed).
- [x] R4. Remove the stray `~/.config/kk/works/kk-daily-ai-voice2` directory on this machine once the source is fixed, and state in the task's Testing section how it was verified absent again after a full suite run.

### Acceptance Criteria

- [x] AC1 — A full `bun run test` leaves no new path under `$HOME/.config/kk/works`. (req: R1, R3)
- [x] AC2 — The regression assertion fails when the isolation is removed and passes with it. (req: R3)
- [x] AC3 — The production precedence chain is unchanged. (req: R2)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. [x] Reproduce: `rmdir ~/.config/kk/works/kk-daily-ai-voice2`, run the suspect tests, show the path reappearing (failed-evidence for R3/AC2).
2. [x] Census every suite reach of `prepareAction`/`resolveWorksDir` (in-process `main()` calls, spawned stage runners, board capture) and confirm which are unpinned.
3. [x] Isolate the two unpinned tests in `apps/cli/tests/commands/daily.test.ts`: read-only `resolveWorksDir()` assertions + `--work-dir`-pinned command runs.
4. [x] Add the R3 file-level before/after snapshot guard on `~/.config/kk/works` (entries + mtimes).
5. [x] Run the guard with the isolation removed (fails, exit 1, names `kk-daily-ai-voice2`) and with it (passes); keep both outputs.
6. [x] `bun run lint` (biome + typecheck) + the narrow test file; leave the full gate to the pipeline.
7. [x] Remove the stray dir and confirm it stays absent after every run (R4).

### Root Cause

The polluter is the corrupt-config fallback test in `apps/cli/tests/commands/daily.test.ts:541` (pre-fix body): it deleted `KK_WORKS_DIR`, pointed `KK_CONFIG` at an unparseable YAML, ran the real `kk daily prepare --workflow kk-daily-ai-voice2` and asserted the composed workDir against `join(homedir(), '.config/kk/works/kk-daily-ai-voice2/20261007')` — deliberately composing under the operator's home to pin the compiled-default fallback of `resolveWorksDir` (`apps/cli/src/commands/daily.ts:110`). Its finally block removed only the date child, leaving the bare workflow directory `~/.config/kk/works/kk-daily-ai-voice2` behind after every suite run. Reproduced 2026-10-13 10:17: rmdir the stray, run that single test, the bare dir reappears with the run's mtime; `bun test` reports 1 pass — the test was green while polluting.

The sibling `~`/`$HOME` expansion test in the same describe (`apps/cli/tests/commands/daily.test.ts:502`, pre-fix) also composed `~/works-from-config/kk-daily-ai-voice2/…` and `~/works-home-prefix/…` in the real home; it cleaned both fully, but its works root was equally unpinned.

`apps/cli/tests/daily-generate-sections.test.ts` (0237/0257/0266 blocks) is exonerated: two full runs of the file left `~/.config/kk/works/kk-daily-ai-voice2` absent — the `daily-episode-duration` stage delegates to `plugins/kk/scripts/daily-stages.ts`, which never reaches works-root resolution. The production resolver is not defective: `KK_WORKS_DIR` > config `works_dir` > `~/.config/kk/works` behaved exactly as documented (probe-verified 2026-10-13, see Solution).

### Solution

Change map (R1/R3 — test-only fix; the production fallback chain is untouched, R2/AC3: the whole diff is this one test file):

- `apps/cli/tests/commands/daily.test.ts:23-38` — imports: `beforeAll`, `readdirSync`/`statSync`, and the exported `resolveWorksDir` so the fallback chain can be asserted read-only (the resolver only reads env/config — no writes).
- `apps/cli/tests/commands/daily.test.ts:57-80` — 0267 R3 regression guard: file-level `beforeAll`/`afterAll` snapshot of `$HOME/.config/kk/works` (entry names + mtimes); asserts no entry is created or touched across this file's tests. This file owns the suite's only unpinned reaches of the composing command, so a test that forgets its pin fails here with the entry named.
- `apps/cli/tests/commands/daily.test.ts:502-540` — the `~`/`$HOME` expansion test: expansion now asserted via read-only `resolveWorksDir()` (both `~/works-from-config` and `$HOME/works-home-prefix` forms), and the end-to-end command run is pinned with `--work-dir <temp>` (0267 R1's sanctioned isolation). No more composing `~/works-from-config`/`~/works-home-prefix` in the operator's home; the in-finally `rmSync` of real-home dirs is gone with them.
- `apps/cli/tests/commands/daily.test.ts:541-575` — the corrupt-config fallback test (the polluter): the compiled-default fallback is asserted via read-only `resolveWorksDir()` === `join(homedir(), '.config/kk/works')`, and the run is pinned with `--work-dir <temp>`, keeping the 0242 R6 cwd isolation for the store fallback. The old body composed `~/.config/kk/works/kk-daily-ai-voice2/<date>` in the real home and cleaned only the date child, leaving the bare workflow directory after every run.

Why this shape: Bun's `homedir()` captures the initial process env — an in-process `process.env.HOME` mutation does NOT redirect it (verified: `bun -e` with in-process HOME set still returns the real home), so HOME-pinning cannot isolate the in-process `run()` harness. Asserting the read-only resolver plus a `--work-dir`-pinned run preserves both contracts (fallback chain string; "a corrupt config never fails a run") with zero home writes.

Evidence (all run 2026-10-13 in this tree):

- Reproduce (polluter confirmed): after `rmdir ~/.config/kk/works/kk-daily-ai-voice2`, `bun test apps/cli/tests/commands/daily.test.ts --test-name-pattern "falls through to the compiled default"` → 1 pass 0 fail, and `~/.config/kk/works/kk-daily-ai-voice2` reappears (bare workflow dir).
- AC2 failing side (isolation removed, guard kept): same run → the guard's afterAll fails with `polluted: [{ name: "kk-daily-ai-voice2", ... }]`, `1 pass / 1 fail`, exit 1; stray dir present again. Passing side (isolation present): full file `bun test apps/cli/tests/commands/daily.test.ts` → 21 pass / 0 fail (exit 1 is the per-file coverage threshold, failures 0), `~/.config/kk/works` still contains only `kk-itc`.
- `apps/cli/tests/daily-generate-sections.test.ts` is NOT a polluter: two full runs of the file (24 tests incl. the 0266 block) left the path absent. The 0266 mtime correlation in the batch evidence was a coincidence of run order — the `daily-episode-duration` stage never resolves a works root.
- `bun run lint` → clean (biome format fixed 1 file — this one; all workspace typechecks exit 0).
- Public-surface probes (throwaway root /tmp/0267-probe-NJWJ, `bun apps/cli/src/index.ts daily prepare --workflow kk-daily-ai-voice2 --run-date 2026-10-13`): (1) `KK_WORKS_DIR=<tmp>/works` → `{"workDir":"…/works/kk-daily-ai-voice2/20261013",…}` exit 0; (2) `KK_CONFIG=<tmp>/kk.yaml` with `works_dir: <tmp>/works-from-config` → workDir under `…/works-from-config/kk-daily-ai-voice2/20261013` exit 0; (3) both set → env wins (workDir under `…/works/…`). Operator home unchanged after all three.
- R4: the stray dir was empty and removed with `rmdir` (10:17 and again 10:24 after the AC2 demo); it stayed absent after every subsequent run listed above. The full-suite confirmation (`bun run test` leaves nothing new under `$HOME/.config/kk/works`) belongs to the pipeline gate; the batch driver's before/after listing captures it.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Both unpinned tests isolated: `~`/`$HOME` expansion now asserted read-only via `resolveWorksDir` (`apps/cli/tests/commands/daily.test.ts:514,516`) and both command runs pinned with `--work-dir` (`apps/cli/tests/commands/daily.test.ts:527,568`). Census re-checked this turn: every other `daily prepare` reach pins `KK_WORKS_DIR`/config `works_dir`/`--work-dir` to a temp dir (`apps/cli/tests/store-selections.test.ts:759`, `apps/cli/tests/board/itc.test.ts:509`, `apps/cli/tests/board/daily-voice.test.ts:615`). |
| R2 | MET | Production resolver untouched: `git diff` touches only `apps/cli/tests/commands/daily.test.ts` and the task doc (zero production files); `resolveWorksDir` still reads `KK_WORKS_DIR` → config `works_dir` → `~/.config/kk/works` at `apps/cli/src/commands/daily.ts:110-123` (re-read this turn). |
| R3 | MET | File-level guard `apps/cli/tests/commands/daily.test.ts:65-82` snapshots `~/.config/kk/works` (names + mtimes) beforeAll/afterAll and asserts no entry created or touched. Green side re-run this turn: `bun test apps/cli/tests/commands/daily.test.ts` → 21 pass / 0 fail, `$HOME/.config/kk/works` left as only `kk-itc`. Red side (isolation removed) recorded in the authored Review, not re-run this turn: removing the `--work-dir` pin makes the guard's afterAll fail naming `kk-daily-ai-voice2` (1 pass / 1 fail). |
| R4 | MET | Stray `~/.config/kk/works/kk-daily-ai-voice2` absent (live recursive listing this turn: only `kk-itc` and its children); removal + post-run absence recorded in the task Solution §R4. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A full `bun run test` leaves no new path under `$HOME/.config/kk/works`. (req: R1, R3) | MET | command | Full gate `bun run lint && bun run test-pre-check && bun run test && bun run test-post-check` exit 0 — 2749 pass / 0 fail (proof-digest sha256:becb0e7f…, log `.spur/run/0267-test-gate.log`). Works-dir before/after snapshots (`.spur/run/0267-worksdir-before.txt` / `.spur/run/0267-worksdir-after.txt`) byte-identical, re-diffed this turn; live `$HOME/.config/kk/works` holds only `kk-itc`, no `kk-daily-ai-voice2`. |
| AC2 — The regression assertion fails when the isolation is removed and passes with it. (req: R3) | MET | test | Guard `apps/cli/tests/commands/daily.test.ts:65-82`. Green side re-run this turn: `bun test apps/cli/tests/commands/daily.test.ts` → 21 pass / 0 fail, works dir unchanged (only `kk-itc`). Red side recorded in the authored Review, not re-run this turn (observe-only): removing the `--work-dir` pin makes the guard's afterAll fail naming `kk-daily-ai-voice2`, 1 pass / 1 fail. |
| AC3 — The production precedence chain is unchanged. (req: R2) | MET | command | `git diff -- apps/cli/src/commands/daily.ts` → empty (exit 0); `git status --porcelain` lists no `daily.ts` change (only the test file + task doc). `resolveWorksDir` still reads `KK_WORKS_DIR` → config `works_dir` → `~/.config/kk/works` at `apps/cli/src/commands/daily.ts:110-123` (re-read this turn). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0267
**Scope:** `git diff` — `apps/cli/tests/commands/daily.test.ts` (file-level R3 guard + read-only `resolveWorksDir()` assertions + `--work-dir` pins; 93 changed lines) and the task doc; zero production files touched.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH
**Why this level:** all four requirement rows are MET with evidence re-derived in this tree on 2026-10-13 — the green side (full file 21 pass / 0 fail, guard passes, workspace left as only `kk-itc`) and the red side (removed the `--work-dir` pin, the test still passes but the guard fails naming `kk-daily-ai-voice2`, 1 pass / 1 fail) were both re-run here; the production diff is test-only and every finding carries a disposition.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The R3 guard snapshots only the compiled-default root `~/.config/kk/works` (entry names + mtimes) and is file-scoped to `daily.test.ts`. The `~`/`$HOME`-expanded config roots the second fixed test formerly composed (`~/works-from-config`, `~/works-home-prefix`) sit directly under `$HOME`, outside its watch, and a future unpinned `daily prepare` added to a sibling file (voice2-dag, store-selections, board/daily-voice) would also not trip this guard. Non-blocking: the current census shows every other `daily prepare` reach pins `KK_WORKS_DIR`/`--work-dir`, and AC1's full-suite before/after net (pipeline gate) is the suite-wide backstop. | apps/cli/tests/commands/daily.test.ts:65-82 | ACCEPTED |
| 2 | P4 (advisory) | reliability | The guard diffs `mtimeMs` on the live `~/.config/kk/works` path, so a concurrent operator `kk` run touching the existing `kk-itc` entry mid-suite fails the guard spuriously. Acknowledged in the guard's comment ("the price of watching the live path"); no test in this file or its siblings writes that root, and the green-side run here is clean. | apps/cli/tests/commands/daily.test.ts:66-82 | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Both unpinned tests isolated. Expansion now asserted read-only via `resolveWorksDir()` and composition pinned with `--work-dir` — apps/cli/tests/commands/daily.test.ts:514,516 (expansion), :527-528 and :568-569 (pins). No other suite reach of `daily prepare` is unpinned (census below). |
| R2 | MET | Production fallback chain untouched — `git diff` touches only the test file + task doc; the resolver still reads `KK_WORKS_DIR` → config `works_dir` → `~/.config/kk/works` at apps/cli/src/commands/daily.ts:111-123. |
| R3 | MET | Guard fails when isolation is removed (re-verified here 2026-10-13: removed the `--work-dir` pin, the corrupt-config test stays green but the guard's afterAll fails naming `kk-daily-ai-voice2`, 1 pass / 1 fail) and passes with it (full file 21 pass / 0 fail, `~/.config/kk/works` left as only `kk-itc`) — apps/cli/tests/commands/daily.test.ts:65-82. |
| R4 | MET | Stray `~/.config/kk/works/kk-daily-ai-voice2` is absent (current listing: only `kk-itc`); removal plus "stays absent after every run" is recorded in the task Solution. The full-suite confirmation is AC1's job and is deferred to the verify gate's before/after net. |

**Next:** proceed to verify — AC1 (`bun run test` leaves nothing new under `$HOME/.config/kk/works`) is the verify gate's confirmation.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-13T17:28:07.150Z todo → wip (system)
- 2026-10-13T17:45:41.709Z wip → testing (system)
- 2026-10-13T17:45:44.036Z testing → done (system)

