---
schema_version: 1
name: Cover the voice2 dogfood stage contracts with regression tests
status: todo
template: feature-impl
created_at: 2026-10-10T15:28:47.200Z
updated_at: "2026-10-10T15:36:30.117Z"
feature_id: G11

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
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

- [ ] R1. A `daily-plan` call whose 5th argument is `true` does not create `21-plan/<date>_03_plan_plan.json`, and a second call caches on `_03_plan_content.json` and logs `plan cached:`. A four-argument call still writes `plan.json` as a non-empty JSON array.
- [ ] R2. `daily-qc-content` drops a near-duplicate title from an already-written candidates file, rewrites that file, and names the dropped id on stderr. A second call whose candidates have no near-duplicate leaves the file bytes unchanged.
- [ ] R3. `daily-script` with max minutes and `vdriver=voicebox`, given a fresh VoiceScript over `(maxMinutes*60-8-120)*5.6` characters, writes block YAML that does not start with `{`, passes the VoiceScript checker, and is at or under that budget. An under-budget script is not rewritten.
- [ ] R4. `daily-show-notes` omits a plan doc whose id is listed in `24-script/<date>_08_script-write_plan.json` under `excluded`, even when the article body has no 未写入 note for that id, and passes the filtered sibling plan to `podcast-pub`. A missing script-plan file keeps the current note-only filter.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-10T15:36:30.117Z backlog → todo (system)

