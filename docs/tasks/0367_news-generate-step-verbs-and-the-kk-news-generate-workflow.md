---
schema_version: 1
name: News generate step verbs and the kk-news-generate workflow
status: backlog
template: feature-impl
created_at: 2026-11-13T18:13:40.143Z
updated_at: "2026-11-13T18:42:37.037Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0365", "0366"]
---

## 0367. News generate step verbs and the kk-news-generate workflow

### Background

Phase 3 of G61 (ADR-053 §5, §6, §7). Frozen contract: `docs/design/content-pipeline-consolidation.md` §1.3 (generate step verbs), §5.1 (the 20 nodes of `kk-news-generate` and the fate of all 42 nodes of `kk-daily-ai-voice3.yaml`), §6 (which stage each verb calls). Measured on 2026-10-08: TTS 141 min, card render 46 min, cover 23 s, every other deterministic node ≤ 10 s — 22 nodes are padding around three long steps and six agent calls. This task adds the news generate step verbs as compositions of the existing stage bodies and writes the 20-node workflow.

Out of scope: moving stage bodies out of `plugins/kk/scripts/daily-stages.ts`; `kk-daily-safety.yaml`; deleting voice3 or changing the scheduler (0369); article verbs (0368).

### Requirements

- [ ] R1. New `apps/cli/src/commands/content-generate.ts` adds to the 0363 verb list: `prepare`, `generate-render`, `generate-voice`, `generate-cards`, `report` (news only) and `generate-check`, `generate-bundle` (both nouns; this task implements the news steps `curate`, `script` and both bundle stages). Flags, exit codes, stdout and files exactly as design §1.3.
- [ ] R2. Each verb runs the stages listed for it in design §6, in today's voice3 order, through the existing stage runner (`apps/cli/src/stage.ts`) in one process, stopping at the first failing stage and reporting its name on stderr. No stage body is copied or edited. `prepare` does not run `daily-script-style`: a new run has no `20-editorial/` directory and no `_08_script-write_style.md` copy.
- [ ] R3. `prepare` returns exit 0 with `pool: 'empty'` when the pool gate is empty and writes `pool-gate.json` `{status: 'PASS' | 'EMPTY'}` in the work dir (replacing the `.spur/run/<runId>-pool-gate.status` token). Session-check warnings are reported in stdout and never fail the verb.
- [ ] R4. `generate-check --step curate|script` exits 0 with `verdict: pass` or `verdict: fix`; a fix verdict writes the errors file that the following fix node conditions on (same file names as today, so the node condition is a file test). Exit 1 only when the step input is missing or unreadable. `--final` exits 0 with `verdict: pass` or `fallback` and applies today's fallback (untranslated candidates for `curate`; template script for `script`, F613/0345).
- [ ] R5. `generate-voice --engine <e>` runs TTS with exactly one engine, then intro, audit (advisory), duration (gate), quality report/verdict and show notes. It does not fall back internally — the workflow owns the engine chain so a 141-minute step is a visible retry boundary.
- [ ] R6. `generate-bundle --stage variants` = publish-prep + bundle-variants + safety-manifest; `--stage freeze` = `runPublishMatrixBundle` with `contentType: 'news'`. A second `--stage freeze` on a frozen bundle exits 1 without rewriting it.
- [ ] R7. New `plugins/kk/workflows/kk-news-generate.yaml`: DAG with exactly the 20 nodes of design §5.1 in topological order; vars `work_dir`, `run_date`, `run_id`, `agent` (default `inline`), `skill_dir`, `skip_review`, `preset`; agent prompts cite `${vars.skill_dir}/SKILL.md` and nothing under `20-editorial/` (design §2.2); first node `executor-probe` identical to 0360's; agent nodes use `agent: ${vars.agent}`, fix/judge nodes `role: reviewer`; every node after `prepare` conditions on `pool-gate.json` status `PASS`; no publish node. Non-agent, non-pause, non-nested node commands are one `kk news <verb> …` call each (node `freeze` is two: `generate-bundle --stage freeze && kk news report`). No `kk stage`, `jq`, `file.read.into-var`.
- [ ] R8. New `apps/cli/tests/kk-news-generate-dag.test.ts` asserts node ids/order, the single `agent` var, the probe as the only node without `dependsOn`, the pool-gate condition on every later node, and the absence of `kk stage` in commands.
- [ ] R9. Offline equivalence: reuse the voice3 offline rehearsal harness (`apps/cli/tests/voice3-migration.e2e.test.ts` — read it, do not edit it) to run `kk-news-generate` with stubbed agent, TTS and card rendering; the frozen `bundle.json` has the same variant keys and safety status as voice3's on the same fixture. `kk news generate` (0365) launches `kk-news-generate` via `content_types.news.workflow` — no code change expected; assert it in the e2e.
- [ ] R10. `docs/04_DESIGN.md` §1.14 lists the verbs and workflow as shipped. Same commit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The generate workflow keeps only nodes that earn their place (req: R7, R8)
  Given kk-news-generate.yaml
  When kk-news-generate-dag.test.ts runs
  Then it has 20 nodes, one executor variable, executor-probe first, and no node command contains "kk stage", "jq " or "file.read"

Scenario: AC2 — Step verbs compose the existing stages (req: R1, R2, R3, R4, R5, R6)
  Given the offline fixture work dir under .works/tmp/test-news-generate
  When prepare, generate-check --step curate, generate-check --step curate --final, generate-render, generate-voice --engine <stub>, generate-cards, generate-bundle --stage variants, generate-bundle --stage freeze, report run in order
  Then each prints one JSON object with the fields of design §1.3 and exits with the documented code
  And an empty-pool fixture makes prepare exit 0 with pool empty and pool-gate.json status EMPTY
  And a second generate-bundle --stage freeze exits 1 and bundle.json is byte-identical

Scenario: AC3 — The new workflow freezes the same bundle as voice3 (req: R9)
  Given the offline rehearsal fixture
  When `kk news generate --run-date <fixture>` runs with stubbed agent, TTS and cards
  Then the receipt status is done and bundle.json has the same variant keys and safety status as the voice3 rehearsal bundle
  And an empty-pool run ends done with status no-content and no agent node executed
  And the test writes .works/tmp/test-news-generate/summary.json

Scenario: AC4 — Gate (req: R10)
  Given the change is applied
  When `bun run lint && bun run test && bun run build` run
  Then all exit 0 and `git diff --stat -- plugins/kk/scripts plugins/kk/workflows/kk-daily-ai-voice3.yaml plugins/kk/workflows/kk-daily-safety.yaml` is empty
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T18:17:33.832Z

- **Why not move the stage bodies into `apps/cli`?** Design §7 / open point 3: they are product logic, 5,397 lines, and moving them changes release coupling (script stages are read as source; `apps/cli` is build output). Out of G61.
- **`kk stage` resolves from the installed package — does that bite here?** Yes: the verbs run stage bodies from wherever the stage runner resolves them. Behaviour is unchanged from today; note it in Testing and do not "fix" resolution in this task.
- **Why does the workflow, not the verb, own the TTS fallback chain?** Each engine attempt is the longest step in the run; a resume must restart at the failed engine, not at engine one.
- **Does `wrap-docs` moving before `review` change output?** It only reads rendered files (design §5.1). AC3's bundle equality is the proof; if it differs, keep the old position as a 21st node and report it.
- **Tests first.** DAG test, verb e2e and rehearsal exist and fail before the YAML or verbs are written.

#### Q&A entry — 2026-11-13T18:32:58.542Z

- **Which directory and workflow name does a news run use?** `<works>/kk-news-generate/<YYYYMMDD>` (design §4.3, operator decision 2026-11-13). Ledger and store rows for new runs carry workflow `kk-news-generate`; history under `kk-daily-ai-voice2` is not migrated. The phase directories inside a run (`10-ingest` … `31-publish`) keep their names — the stage bodies own them and are not edited.

### Design

Owned files:

| File | Change |
| --- | --- |
| `apps/cli/src/commands/content-generate.ts` | new |
| `apps/cli/src/commands/content.ts` | append seven entries (shared — dependency chain 0363 → 0364 → 0365 → 0366) |
| `plugins/kk/workflows/kk-news-generate.yaml` | new |
| `apps/cli/tests/kk-news-generate-dag.test.ts`, `apps/cli/tests/content-generate.e2e.test.ts`, `apps/cli/tests/kk-news-generate.e2e.test.ts` | new |
| `docs/04_DESIGN.md` | R10 |

A verb is a table row: `{verb, stages: [{name, args(workDir, flags)}], summary(workDir)}`. One runner executes any row. Do not write one function per verb.

### Plan

1. Write the three test files; confirm they fail.
2. The stage-sequence runner and the seven verb rows (R1–R6).
3. `kk-news-generate.yaml` from design §5.1 (R7).
4. Offline rehearsal (R9).
5. Docs; `bun run lint && bun run test && bun run build`.
6. Do not sync into the installed package and do not touch the schedule — that is 0369.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/content-pipeline-consolidation.md` §1.3, §5.1, §6. Decision: ADR-053 §5, §6, §7. Timing evidence: `.works/kk-daily-ai-voice2/20261008/step-timing.json`.
- Depends on: 0365, 0366 (shares `content.ts` and `docs/04_DESIGN.md`). Blocks: 0368, 0369.
- Parent feature: G61, scenario "One executor variable drives every agent node" (re-proved for the new workflow).

### History
