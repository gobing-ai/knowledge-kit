---
schema_version: 1
name: Cover the voice2 dogfood stage contracts with regression tests
status: done
template: feature-impl
created_at: 2026-10-10T15:28:47.200Z
updated_at: "2026-10-10T16:28:31.212Z"
feature_id: G11

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0250-verdict.json
---

## 0250. Cover the voice2 dogfood stage contracts with regression tests

### Background

2026-10-10 voice2 dogfood changed `plugins/kk/scripts/daily-stages.ts` and then proved the path with run `dfcdba24-30c0-4c66-9525-0574f7050e48` (22.2 min voicebox episode). The operator asked for the end-to-end run, so these contracts have no regression tests. This task adds those tests. It does not re-implement the behavior.

Already in the working tree, checked 2026-10-10:

- `dailyPlan` treats a 5th argument of `true` as `deferPlanDocs` (`plugins/kk/scripts/daily-stages.ts:963`). It caches on `_03_plan_content.json` and returns before writing `_03_plan_plan.json` (`:977`). A second call logs `plan cached:` (`:966`). A four-argument call still writes `plan.json`. Voice2 passes `plan_translate_enabled` as that 5th argument (`plugins/kk/workflows/kk-daily-ai-voice2.yaml` plan node).
- `dailyQcContent` returns early from the executor when the candidates file exists (`:130-132`), then still runs `dedupPlanByTitle` (`:191`). A drop rewrites `metadata.docs` and logs `qc: dropped` on stderr (`:200`). `dropped.length === 0` returns without a write (`:192`).
- `fitVoicescriptToBudget` (`:1668`) aims at `Math.floor((maxMinutes * 60 - 8 - 120) * rate)` (`:1674`). `spokenCharRate` is 5.4 for `gemini` and 5.6 otherwise (`:1636`). An over-budget script is rewritten with `voicescriptToBlockYaml` (`:1605`, called at `:1711`). Run `08a98453` failed because `Bun.YAML.stringify` emitted a `{...}` document and `plugins/kk/scripts/validate-voicescript.ts:280` JSON-parses any trimmed file that starts with `{` (`Expected '}'`).
- `dailyShowNotes` unions script-plan `excluded[].id` into the filter (`:1825-1829`) before the article `未写入` scan. A non-empty drop writes `21-plan/<date>_03_plan_plan-shownotes.json` and passes that path to `podcast-pub` (`:1861-1866`). After that change, the 20261010 show notes list the six spoken stories and not the visa, police, or financing items.
- The duration node's description now says 15–25 minutes (`kk-daily-ai-voice2.yaml:515`), and `docs/design/kk-collect-and-daily-voice2.md` records the headroom, the block YAML, and the show-notes exclusion.

Voice1 command strings stay exact (`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:298` is the four-argument `daily-plan`; `:304` is the six-argument `daily-script`). Do not import `daily-stages.ts` into the test process. Both existing stage suites spawn `plugins/kk/scripts/kk-workflow-stages.ts`, which loads these functions.

No other task is `wip`, and `git worktree list` shows only this checkout on `main` (2026-10-10).

### Requirements

- [x] R1. A `daily-plan` call whose 5th argument is `true` does not create `21-plan/<date>_03_plan_plan.json`, and a second call caches on `_03_plan_content.json` and logs `plan cached:`. A four-argument call still writes `plan.json` as a non-empty JSON array.
- [x] R2. `daily-qc-content` drops a near-duplicate title from an already-written candidates file, rewrites that file, and names the dropped id on stderr. A second call whose candidates have no near-duplicate leaves the file bytes unchanged.
- [x] R3. `daily-script` with max minutes and `vdriver=voicebox`, given a fresh VoiceScript over `(maxMinutes*60-8-120)*5.6` characters, writes block YAML that does not start with `{`, passes the VoiceScript checker, and is at or under that budget. An under-budget script is not rewritten.
- [x] R4. `daily-show-notes` omits a plan doc whose id is listed in `24-script/<date>_08_script-write_plan.json` under `excluded`, even when the article body has no 未写入 note for that id, and passes the filtered sibling plan to `podcast-pub`. A missing script-plan file keeps the current note-only filter.

**Out of scope:** changing `daily-stages.ts`, either daily workflow YAML, or `voicescriptToBlockYaml`'s visibility. A live voicebox workflow is not the test.

### Acceptance Criteria

```gherkin
Scenario: AC1 — deferred plan does not write plan.json (req: R1)
- Given a pool file and a stub `kk` that writes `_03_plan_content.json` with a non-empty `metadata.docs`, when `daily-plan` runs with 5th arg `true`, then that content file exists and `plan.json` does not.
- Given that content file, when `daily-plan` runs again with 5th arg `true`, then stdout contains `plan cached:` and `plan.json` still does not exist.
- Given no `plan.json`, when `daily-plan` runs with four arguments, then `plan.json` is a non-empty JSON array.

Scenario: AC2 — cached candidates lose a near-duplicate title (req: R2)
- Given a candidates file whose later title is a near-duplicate of an earlier technical title, when `daily-qc-content` runs, then the duplicate id is absent from `metadata.docs` and stderr contains `qc: dropped` plus that id.
- Given candidates with distinct technical titles, when `daily-qc-content` runs twice, then the candidates bytes after the second run equal the bytes after the first.

Scenario: AC3 — over-budget script is block YAML under the budget (req: R3)
- Given a fresh voicescript whose spoken length exceeds `(25*60-8-120)*5.6`, when `daily-script` runs with max minutes `25` and vdriver `voicebox`, then the yaml does not start with `{`, the VoiceScript checker exits 0, and the spoken length is at or under that budget.
- Given a fresh voicescript under that budget, when `daily-script` runs with the same arguments, then the yaml bytes are unchanged.

Scenario: AC4 — show notes drop script-plan exclusions (req: R4)
- Given a plan of two docs and a script plan that excludes the second id, and an article body with no 未写入 note, when `daily-show-notes` runs, then `21-plan/<date>_03_plan_plan-shownotes.json` omits that id and `podcast-pub` is invoked with `--in` pointing at that sibling.
- Given the same plan and no script-plan file, when `daily-show-notes` runs, then both docs stay on the original plan path passed to `podcast-pub`.
```

### Q&A

#### Closed — tests only, behavior stays
The four contracts are already in `daily-stages.ts`. This task locks them with spawned stage tests. Production edits are out of scope unless a cited line does not match the contract, in which case the test stops (Plan step 4).

#### Closed — two existing suites, not one new file
QC byte-compare lives in `plugins/kk/tests/kk-workflow-stages.test.ts`. Script, show-notes, and the scriptable `kk` stub live in `apps/cli/tests/kk-workflow-stages.test.ts`. Each requirement is filed next to its harness.

### Design

Both stage suites spawn `plugins/kk/scripts/kk-workflow-stages.ts` (it `loadDailyStages()` into `daily-stages.ts`). Put each case next to the harness that already drives that stage. Do not export `voicescriptToBlockYaml`. No new API.

- R2 goes in `plugins/kk/tests/kk-workflow-stages.test.ts`, beside `rerun is idempotent: cached candidates, boundary no-op, audit and candidates untouched` (`:223`). That file's `runStage` and real-plugin `fakeKk` already drive `daily-qc-content`. The fixture titles stay technical so `applyTopicBoundary` excludes nothing; only the dedup rewrite is under test. The no-duplicate case relies on `daily-stages.ts:192`.
- R1, R3, and R4 go in `apps/cli/tests/kk-workflow-stages.test.ts`. That file already has the scriptable `fakeKk` (`:498`), `daily-script` cases (`:2448`), and `daily-show-notes` (`:2059`). There is no `daily-plan` case there today; add one with a stub `kk` that writes `_03_plan_content.json` (`metadata.docs` is a non-empty array). Do not use the plugins-suite `fakeKk` for R1: it execs the real `episode-plan-gen`.
- R3: the stub `kk executor run dailynews-gen` writes content JSON whose `body` is a block-YAML VoiceScript. Assert the on-disk yaml. One over-budget body, one under-budget body. The under-budget yaml bytes are compared before and after.
- R4: assert the sibling `21-plan/<date>_03_plan_plan-shownotes.json` omits the excluded id and that `podcast-pub --in` is that sibling. The new test records argv itself. Do not change `showNotesKk` (`:2040`), which the existing cases share. A missing script-plan file leaves both docs on the original plan path.

Rejected: another live voicebox workflow. It takes hours and does not run in CI.
Rejected: relaxing `validateScriptPlan`. The dogfood failure was a stale id after a late title dedup; R2 locks the cache-path dedup that prevents it.
Rejected: changing the voice1 workflow command strings. `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:298` and `:304` snapshot them.
Rejected: one new test file. The spawn harnesses already exist.

No other `wip` task and no second worktree touch these files (2026-10-10). 0251 owns the XHS overflow retry and does not share these tests.

### Plan

1. Add the R2 cases in `plugins/kk/tests/kk-workflow-stages.test.ts` next to the idempotent-rerun test. Reuse `runStage`, `qcDoc`, and `fakeKk`.
2. Add the R1, R3, and R4 cases in `apps/cli/tests/kk-workflow-stages.test.ts` next to the daily-script and daily-show-notes tests. Reuse `run` and a scriptable `fakeKk`. For R3, emit one over-budget yaml and one under-budget yaml, and compare the under-budget bytes before and after.
3. Run `bun test plugins/kk/tests/kk-workflow-stages.test.ts` and `bun test apps/cli/tests/kk-workflow-stages.test.ts`. Judge the pass/fail counts. A single-file run exits 1 on the aggregate coverage threshold while reporting `0 fail`; that exit is not a failure of this task.
4. Stop if a test shows the production lines cited in Background do not match the contract. Fix the test expectation only when the cited code is the contract. Do not widen the fitter or the dedup.

### Solution

Tests-only regression coverage of the four voice2 dogfood stage contracts (2026-10-10 run `dfcdba24`). No production file changed; every case spawns `plugins/kk/scripts/kk-workflow-stages.ts` with a stub `kk` on PATH, matching the harness each suite already uses.

Change map (one anchor per row):

| Anchor | Change |
| --- | --- |
| `plugins/kk/tests/kk-workflow-stages.test.ts:257` | New describe `daily-qc-content stage — cached-candidates title dedup (task 0250 R2/AC2)` beside the idempotent-rerun tests; reuses module-scope `runStage`, `qcDoc`, `fakeKk`, `qcStageArgs`. |
| `plugins/kk/tests/kk-workflow-stages.test.ts:277` | AC2 case 1: pre-written candidates carrying the real Gemini 3.8 Live near-duplicate pair (0.417 >= the 0.4 bigram threshold, both titles technical so the topic boundary is a no-op); asserts the later id is dropped from `metadata.docs` and stderr carries `qc: dropped` + the id — locks `daily-stages.ts:191,200`. |
| `plugins/kk/tests/kk-workflow-stages.test.ts:292` | AC2 case 2: distinct technical titles run twice; byte-compares the candidates file after run 1 vs run 2 — locks the `dropped.length === 0` no-write early return (`plugins/kk/scripts/daily-stages.ts:192`). |
| `apps/cli/tests/kk-workflow-stages.test.ts:2123` | New describe `task 0250 — daily-plan deferPlanDocs contract (voice2 dogfood R1/AC1)` after the 0133 show-notes tests; local `fakePlanKk` stub writes a Content envelope (non-empty `metadata.docs`) instead of exec'ing the real episode-plan-gen. |
| `apps/cli/tests/kk-workflow-stages.test.ts:2145` | AC1: 5th-arg `true` writes `_03_plan_content.json` but not `_03_plan_plan.json`; a rerun logs `plan cached:` and still no plan.json; a four-argument call writes plan.json as a non-empty array — locks `daily-stages.ts:963,966,977`. |
| `apps/cli/tests/kk-workflow-stages.test.ts:2176` | New describe `task 0250 — daily-show-notes script-plan exclusions (voice2 dogfood R4/AC4)`; local `fakeArgvKk` records argv itself (shared `showNotesKk` untouched per Design). |
| `apps/cli/tests/kk-workflow-stages.test.ts:2221` | AC4 case 1: script plan `excluded:[{id:'drop-1'}]` with no 未写入 note in the article body; asserts `21-plan/<date>_03_plan_plan-shownotes.json` omits the id and `podcast-pub --in` points at that sibling — locks `daily-stages.ts:1825-1829,1861-1866`. |
| `apps/cli/tests/kk-workflow-stages.test.ts:2236` | AC4 case 2: missing script-plan file keeps both docs on the original plan path and writes no sibling. |
| `apps/cli/tests/kk-workflow-stages.test.ts:2642` | New describe `task 0250 — daily-script episode-budget fitting (voice2 dogfood R3/AC3)` beside the 0139 R3 daily-script gate tests; reuses the `fakeKkEchoingBody` pattern and computes the budget as `floor((25*60-8-120)*5.6) = 7683` to mirror `daily-stages.ts:1674,1636`. |
| `apps/cli/tests/kk-workflow-stages.test.ts:2690` | AC3 case 1: an ~8410-char block-YAML VoiceScript (420 sentences cuttable at 。) is fitted; asserts the on-disk yaml does not start with `{` (the run-08a98453 failure mode), the shipped `validate-voicescript.ts` sidecar exits 0 on it, and spoken chars <= 7683 — locks `daily-stages.ts:1605,1711`. |
| `apps/cli/tests/kk-workflow-stages.test.ts:2718` | AC3 case 2: an under-budget script keeps its exact yaml bytes (fitter early-returns at `before <= maxChars`). |

Rationale: each requirement sits in the suite whose harness already drives that stage (Q&A "two existing suites, not one new file"). R2 needed the plugins suite's real-plugin `fakeKk`; R1/R3/R4 needed the apps/cli suite's scriptable stubs. No `daily-stages.ts`, workflow YAML, or validator edits — every cited production line matched the contract, so Plan step 4 never triggered.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/tests/kk-workflow-stages.test.ts:2145 spawns the stage via stub kk: 5th-arg `true` writes `20261010_03_plan_content.json` while `_03_plan_plan.json` stays absent (plugins/kk/scripts/daily-stages.ts:977 `if (deferDocs) return`), the rerun logs `plan cached:` (daily-stages.ts:966) with plan.json still absent, and the four-arg call writes plan.json parsed as a non-empty array. Contract lines read at daily-stages.ts:963/966/977 match. Suite run: 109 pass, 0 fail. |
| R2 | MET | plugins/kk/tests/kk-workflow-stages.test.ts:277 drops the near-duplicate `dup-1` from pre-written cached candidates, rewrites the file to `['keep-1']`, and stderr carries `qc: dropped` + the id (daily-stages.ts:191,200); plugins/kk/tests/kk-workflow-stages.test.ts:292 byte-compares the candidates file across two runs with distinct titles, locking the `dropped.length === 0` no-write return (daily-stages.ts:192). Cached path at daily-stages.ts:130-132 confirmed. Suite run: 55 pass, 0 fail. |
| R3 | MET | apps/cli/tests/kk-workflow-stages.test.ts:2690 feeds a ~8400-char block-YAML VoiceScript (over the in-test budget floor((25*60-8-120)*5.6)=7683 mirroring daily-stages.ts:1674,1636); the fitted yaml does not start with `{`, the shipped plugins/kk/scripts/validate-voicescript.ts sidecar exits 0 on it, and spoken chars <= 7683 (daily-stages.ts:1605,1711). apps/cli/tests/kk-workflow-stages.test.ts:2718 asserts an under-budget script keeps exact yaml bytes. Suite run: 109 pass, 0 fail. |
| R4 | MET | apps/cli/tests/kk-workflow-stages.test.ts:2221: script plan `excluded:[{id:'drop-1'}]` with no 未写入 note yields sibling `21-plan/20261010_03_plan_plan-shownotes.json` containing only `keep-1`, and recorded argv shows `podcast-pub --in` pointing at that sibling (daily-stages.ts:1825-1829,1861-1866). apps/cli/tests/kk-workflow-stages.test.ts:2236: missing script-plan file keeps both docs on the original plan path and writes no sibling. Suite run: 109 pass, 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — deferred plan does not write plan.json (req: R1) | MET | test | apps/cli/tests/kk-workflow-stages.test.ts:2145 asserts all three Given/When/Then legs: deferred run leaves content file present and plan.json absent; rerun stdout contains `plan cached:` with plan.json still absent; four-arg run yields a non-empty JSON array plan.json. Executed via `bun test apps/cli/tests/kk-workflow-stages.test.ts`: 109 pass, 0 fail (0 fail is the pass/fail verdict per the single-file exit-code rule). |
| AC2 — cached candidates lose a near-duplicate title (req: R2) | MET | test | plugins/kk/tests/kk-workflow-stages.test.ts:277: `metadata.docs` ids equal `['keep-1']` after the run and stderr contains `qc: dropped` plus `dup-1`. plugins/kk/tests/kk-workflow-stages.test.ts:292: candidates bytes after run 2 equal bytes after run 1 and stderr lacks `qc: dropped`. Executed via `bun test plugins/kk/tests/kk-workflow-stages.test.ts`: 55 pass, 0 fail. |
| AC3 — over-budget script is block YAML under the budget (req: R3) | MET | test | apps/cli/tests/kk-workflow-stages.test.ts:2690: stdout contains `script: fitted voicescript`, on-disk yaml trimStart does not start with `{`, `bun plugins/kk/scripts/validate-voicescript.ts --in <yaml>` exits 0, spoken chars <= 7683. apps/cli/tests/kk-workflow-stages.test.ts:2718: under-budget yaml bytes unchanged and no `script: fitted voicescript` log. Executed via `bun test apps/cli/tests/kk-workflow-stages.test.ts`: 109 pass, 0 fail. |
| AC4 — show notes drop script-plan exclusions (req: R4) | MET | test | apps/cli/tests/kk-workflow-stages.test.ts:2221: filtered sibling omits `drop-1` and recorded `podcast-pub` argv `--in` equals the `-shownotes.json` sibling path. apps/cli/tests/kk-workflow-stages.test.ts:2236: with no script-plan file, `--in` equals the original plan path, both docs remain, and no sibling exists. Executed via `bun test apps/cli/tests/kk-workflow-stages.test.ts`: 109 pass, 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of the uncommitted 0250 diff (tests-only; `apps/cli/tests/kk-workflow-stages.test.ts` +220, `plugins/kk/tests/kk-workflow-stages.test.ts` +51). Every cited production line was re-read against the test bodies, and both suites were executed.

#### Findings

| Priority | Finding | Evidence |
| --- | --- | --- |
| P4 (advisory) | `### Testing` section of the task file is still the placeholder and the R1–R4 checkboxes are unchecked; expected to be filled by the verify/wrap stages, not a review defect. | `docs/tasks/0250_cover-the-voice2-dogfood-stage-contracts-with-regression-tes.md` Testing / Requirements blocks |
| P4 (advisory) | `fakeArgvKk` overwrites `argv.json` on every `kk` call, so the `--in` assertion observes the LAST invocation. Today `dailyShowNotes` makes exactly one `kk` call (`podcast-pub`, `daily-stages.ts:1866`), so the assertion is exact; a future second call would correctly fail the test. No action needed. | `apps/cli/tests/kk-workflow-stages.test.ts:2179-2196`, `plugins/kk/scripts/daily-stages.ts:1866` |

No P1/P2/P3 findings.

#### Traceability (all verified against production source)

- **R1/AC1** — `apps/cli/tests/kk-workflow-stages.test.ts:2145`: 5th-arg `true` writes `_03_plan_content.json` and not `_03_plan_plan.json`; rerun logs `plan cached:`; four-arg call materializes a non-empty plan array. Locks `daily-stages.ts:963` (`deferDocs = deferPlanDocs === 'true'`), `:966` (`plan cached:`), `:977` (`if (deferDocs) return`). The local `fakePlanKk` stub (not the real episode-plan-gen) matches the Design constraint.
- **R2/AC2** — `plugins/kk/tests/kk-workflow-stages.test.ts:277,292`: pre-written cached candidates take the `:130-132` early return, then the real Gemini 3.8 Live pair (0.417 all-zh per the contract comment at `kk-workflow-stages.ts:902`, threshold 0.4) drops the later id with `qc: dropped` + id on stderr (`daily-stages.ts:191,200`); distinct titles leave the file byte-identical across two runs, locking the `dropped.length === 0` no-write return (`:192`). Both titles are technical, so `applyTopicBoundary` is a no-op (confirmed by the passing run).
- **R3/AC3** — `apps/cli/tests/kk-workflow-stages.test.ts:2690,2718`: budget computed in-test as `floor((25*60-8-120)*5.6) = 7683`, mirroring `daily-stages.ts:1674` + `spokenCharRate` `:1636`; the ~8408-char over-budget body is rewritten as block YAML (`:1605`, called `:1711`), asserted to not start with `{` (the run-`08a98453` failure mode — `validate-voicescript.ts:280` JSON-parses `{`-leading files), to pass the shipped checker sidecar at exit 0, and to land ≤ 7683 spoken chars. The under-budget body keeps exact bytes (fitter early-returns `after === before`).
- **R4/AC4** — `apps/cli/tests/kk-workflow-stages.test.ts:2221,2236`: script-plan `excluded:[{id:'drop-1'}]` with no 未写入 note in the article body yields a `21-plan/<date>_03_plan_plan-shownotes.json` sibling omitting the id, and `podcast-pub --in` points at that sibling (`daily-stages.ts:1825-1829`, `:1861-1866`); a missing script-plan file keeps both docs on the original plan path and writes no sibling. Shared `showNotesKk` untouched per Design; the new `fakeArgvKk` records argv itself.

#### SECUA

Assertions are behavioral (file existence/byte equality, stderr/stdout substrings, recorded argv, validator exit code) — none tautological. Deterministic: fixed stamp strings passed as `run_date` args (no wall clock), `mkdtempSync` isolation with `rmSync` cleanup, sequential `spawnSync` (no races), stub `kk` on PATH means no network; the R2 cached-candidates path never invokes `kk` at all. No secrets, no new dependencies, no security surface.

#### Architecture

Tests reuse the existing harnesses exactly per Design: module-scope `runStage`/`qcDoc`/`fakeKk`/`qcStageArgs` in the plugins suite; `run`/`withTempDir` plus file-local scriptable stubs in the apps/cli suite. No production file changed (`git diff --stat`: two test files + the task file only), no new API, `voicescriptToBlockYaml` stays unexported, voice1 command strings untouched. Solution-section anchors were spot-checked and every cited test-file line number matches the actual describe/it locations.

#### Test execution (read-only)

- `bun test plugins/kk/tests/kk-workflow-stages.test.ts` → 55 pass, 0 fail (includes both new AC2 cases).
- `bun test apps/cli/tests/kk-workflow-stages.test.ts` → 109 pass, 0 fail (includes all three new AC1/AC3/AC4 cases).

#### Residual risk

Low. The tests lock the contracts at the cited production lines; a future refactor that renames the `plan cached:` / `qc: dropped` / `script: fitted voicescript` log strings or the `-shownotes.json` sibling naming will fail these tests loudly, which is the intended behavior. Coverage of the four contracts is exactly at the AC altitude — deeper property-level fuzzing of the fitter or dedup remains out of scope by design.

#### Disposition

**PASS** — no open P1/P2/P3 findings. Requirements R1–R4 and AC1–AC4 are each exercised by a real spawned-stage test that asserts the cited production contract; scope stayed tests-only.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-10T15:36:30.117Z backlog → todo (system)
- 2026-10-10T16:09:10.962Z todo → wip (system)
- 2026-10-10T16:27:46.998Z wip → testing (system)
- 2026-10-10T16:28:31.208Z testing → done (system)

