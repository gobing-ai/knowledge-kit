---
schema_version: 1
name: News generate step verbs and the kk-news-generate workflow
status: done
template: feature-impl
created_at: 2026-11-13T18:13:40.143Z
updated_at: "2026-11-14T19:12:20.397Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0365", "0366"]
done_forced: "false"
done_reason: unforced close
---

## 0367. News generate step verbs and the kk-news-generate workflow

### Background

Phase 3 of G61 (ADR-053 §5, §6, §7). Frozen contract: `docs/design/content-pipeline-consolidation.md` §1.3 (generate step verbs), §5.1 (the 20 nodes of `kk-news-generate` and the fate of all 42 nodes of `kk-daily-ai-voice3.yaml`), §6 (which stage each verb calls). Measured on 2026-10-08: TTS 141 min, card render 46 min, cover 23 s, every other deterministic node ≤ 10 s — 22 nodes are padding around three long steps and six agent calls. This task adds the news generate step verbs as compositions of the existing stage bodies and writes the 20-node workflow.

Out of scope: moving stage bodies out of `plugins/kk/scripts/daily-stages.ts`; `kk-daily-safety.yaml`; deleting voice3 or changing the scheduler (0369); article verbs (0368).

### Requirements

- [x] R1. New `apps/cli/src/commands/content-generate.ts` adds to the 0363 verb list: `prepare`, `generate-render`, `generate-voice`, `generate-cards`, `report` (news only) and `generate-check`, `generate-bundle` (both nouns; this task implements the news steps `curate`, `script` and both bundle stages). Flags, exit codes, stdout and files exactly as design §1.3.
- [x] R2. Each verb runs the stages listed for it in design §6, in today's voice3 order, through the existing stage runner (`apps/cli/src/stage.ts`) in one process, stopping at the first failing stage and reporting its name on stderr. No stage body is copied or edited. `prepare` does not run `daily-script-style`: a new run has no `20-editorial/` directory and no `_08_script-write_style.md` copy.
- [x] R3. `prepare` returns exit 0 with `pool: 'empty'` when the pool gate is empty and writes `pool-gate.json` `{status: 'PASS' | 'EMPTY'}` in the work dir (replacing the `.spur/run/<runId>-pool-gate.status` token). Session-check warnings are reported in stdout and never fail the verb.
- [x] R4. `generate-check --step curate|script` exits 0 with `verdict: pass` or `verdict: fix`; a fix verdict writes the errors file that the following fix node conditions on (same file names as today, so the node condition is a file test). Exit 1 only when the step input is missing or unreadable. `--final` exits 0 with `verdict: pass` or `fallback` and applies today's fallback (untranslated candidates for `curate`; template script for `script`, F613/0345).
- [x] R5. `generate-voice --engine <e>` runs TTS with exactly one engine, then intro, audit (advisory), duration (gate), quality report/verdict and show notes. It does not fall back internally — the workflow owns the engine chain so a 141-minute step is a visible retry boundary.
- [x] R6. `generate-bundle --stage variants` = publish-prep + bundle-variants + safety-manifest; `--stage freeze` = `runPublishMatrixBundle` with `contentType: 'news'`. A second `--stage freeze` on a frozen bundle exits 1 without rewriting it.
- [x] R7. New `plugins/kk/workflows/kk-news-generate.yaml`: DAG with exactly the 20 nodes of design §5.1 in topological order; vars `work_dir`, `run_date`, `run_id`, `agent` (default `inline`), `skill_dir`, `skip_review`, `preset`; agent prompts cite `${vars.skill_dir}/SKILL.md` and nothing under `20-editorial/` (design §2.2); first node `executor-probe` identical to 0360's; agent nodes use `agent: ${vars.agent}`, fix/judge nodes `role: reviewer`; every node after `prepare` conditions on `pool-gate.json` status `PASS`; no publish node. Non-agent, non-pause, non-nested node commands are one `kk news <verb> …` call each (node `freeze` is two: `generate-bundle --stage freeze && kk news report`). No `kk stage`, `jq`, `file.read.into-var`.
- [x] R8. New `apps/cli/tests/kk-news-generate-dag.test.ts` asserts node ids/order, the single `agent` var, the probe as the only node without `dependsOn`, the pool-gate condition on every later node, and the absence of `kk stage` in commands.
- [x] R9. Offline equivalence: reuse the voice3 offline rehearsal harness (`apps/cli/tests/voice3-migration.e2e.test.ts` — read it, do not edit it) to run `kk-news-generate` with stubbed agent, TTS and card rendering; the frozen `bundle.json` has the same variant keys and safety status as voice3's on the same fixture. `kk news generate` (0365) launches `kk-news-generate` via `content_types.news.workflow` — no code change expected; assert it in the e2e.
- [x] R10. `docs/04_DESIGN.md` §1.14 lists the verbs and workflow as shipped. Same commit.

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

The seven step verbs are one table and one runner, and the generate workflow is the same stage
sequence expressed as a DAG — no stage body is copied, and nothing under `plugins/kk/scripts/` or
the voice3/safety workflows changed (AC4's `git diff --stat` stays empty).

**Shape.** `GENERATE_ROWS` is the design §1.3/§6 table verbatim: each row is
`{verb, stages: [{name, args(ctx), when?, advisory?}], summary(ctx)}`, where `name` is either a
`daily-*` stage the shared runner already owns or one of the CLI's own steps (`kk store select`, the
pool gate, a `kk content publish-*` call). One runner walks the row in voice3's order, stops at the
first failing stage and names it on stderr; `when` carries voice3's node conditions and `advisory`
carries its `onError: continue`. `prepare` deliberately omits `daily-script-style` (a new run has no
`20-editorial/`), and the pool verdict lands in `pool-gate.json` inside the run directory instead of
a `.spur/run/` token, so an empty pool exits 0 with `pool: 'empty'` and writes nothing else.

**Gating.** The workflow's twenty nodes each condition on `pool-gate.json`, so a thin day skips the
whole content subtree and still closes `done`; the executor probe is the only entry node, one
`agent` var drives every agent node, and no node body contains `kk stage`, `jq ` or `file.read`.

| File | Change |
| --- | --- |
| `apps/cli/src/commands/content-generate.ts:736` | new: `GENERATE_ROWS` — the seven verbs as table rows |
| `apps/cli/src/commands/content-generate.ts:1147` | new: the noun gate (`prepare`/`generate-render`/`generate-voice`/`generate-cards`/`report` are news-only) |
| `apps/cli/src/commands/content-generate.ts:660` | new: the `STEP` factories, with `when: poolNonEmpty` / `candidatesNonEmpty` carrying voice3's conditions |
| `apps/cli/src/commands/content-generate.ts:1082` | new: the check/freeze branch decisions (`generate-check`, `generate-bundle --stage freeze`) |
| `apps/cli/src/commands/content.ts:450` | changed: `registerContentVerbs` appends the seven step verbs |
| `apps/cli/tests/fixtures/workflows/kk-news-generate.yaml:47` | new: `executor-probe` — one real prompt before any spend |
| `apps/cli/tests/fixtures/workflows/kk-news-generate.yaml:58` | new: `prepare` — the one verb that composes voice3's ten composition nodes |
| `apps/cli/tests/fixtures/workflows/kk-news-generate.yaml:74` | new: `curate` — the first gated content node, `onError: continue` |
| `apps/cli/tests/fixtures/workflows/kk-news-generate.yaml:393` | new: `freeze` — the bundle the launcher's receipt reads |
| `apps/cli/tests/kk-news-generate-dag.test.ts:47` | new: AC1 — twenty node ids, forward-only deps, one executor var, no padding |
| `apps/cli/tests/content-generate.e2e.test.ts:1` | new: AC2 — the nine design invocations, empty pool, double freeze |
| `apps/cli/tests/kk-news-generate.e2e.test.ts:473` | new: AC3 — the frozen bundle matches the voice3 rehearsal, empty pool closes `done` |
| `apps/cli/tests/main.test.ts:206` | changed: the canonical A22 leaf inventory gains the seven step verbs |
| `apps/cli/tests/commands/content.test.ts:12` | changed: the shared-noun verb list gains the seven step verbs |
| `docs/04_DESIGN.md:1417` | changed: §1.14 lists the step verbs as shipped with the exit codes |
| `apps/cli/src/commands/daily.ts:600` | changed: `kk daily run-report` stays a thin printer over the new report verb |

**One test-only correction (R7).** The empty-pool case counts agent dispatches; the roster check's
`--version` / `--list-models` capability probe is not a content dispatch, so the assertion filters
those and still requires exactly one real dispatch — the executor probe.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Seven step-verb rows in one table (`apps/cli/src/commands/content-generate.ts:799-929`); five news-only and the two shared verbs (`apps/cli/src/commands/content-generate.ts:1216`); `kk article` refuses the steps until 0368 (`apps/cli/src/commands/content-generate.ts:1139`). Design §1.3 stdout shape, named-flags-only and exit 0/1/2 asserted end to end (`apps/cli/tests/content-generate.e2e.test.ts:323-473`: prepare, both `--step` checks, render, voice, cards, variants, freeze, second freeze, report — 6 pass this round). |
| R2 | MET | One runner walks a row, stops at the first failing stage and names it on stderr (`apps/cli/src/commands/content-generate.ts:936-951`); `prepare` runs preflight, session check, extract, plan, qc-content, store select and the pool gate, and never `daily-script-style` (`apps/cli/src/commands/content-generate.ts:801-804`). No stage body copied or edited: `git diff --stat -- plugins/kk/scripts plugins/kk/workflows/kk-daily-ai-voice3.yaml plugins/kk/workflows/kk-daily-safety.yaml` is empty. First-failure assertion (`apps/cli/tests/content-generate.e2e.test.ts:492-506`). |
| R3 | MET | `writePoolGate` writes `<workDir>/pool-gate.json` `{status}` inside the run and never exits non-zero (`apps/cli/src/commands/content-generate.ts:383-412`); empty-pool e2e asserts exit 0, `pool: 'empty'` and gate `{status:'EMPTY'}` (`apps/cli/tests/content-generate.e2e.test.ts:475-490`); session-check warnings are reported in stdout and never fail the verb (`apps/cli/src/commands/content-generate.ts:696` plus the summary at `:824`, asserted `apps/cli/tests/content-generate.e2e.test.ts:349-355`). |
| R4 | MET | `--step curate`/`script` return 0 with `pass` or `fix` and name the errors file the fix node conditions on (`apps/cli/src/commands/content-generate.ts:826-847`); exit 1 only for a missing or unreadable step input (`apps/cli/src/commands/content-generate.ts:1030-1041`, asserted `apps/cli/tests/content-generate.e2e.test.ts:548-557`); `--final` now reads the per-step errors file computed in `buildContext` (`apps/cli/src/commands/content-generate.ts:1150-1156`, `:840`) — reproduced this visit: a present `24-script/<date>_08_script-write_errors.json` yields `{"step":"script","verdict":"fallback"}`, a curate errors file alone yields `pass`, and a curate errors file yields `{"step":"curate","verdict":"fallback"}`. |
| R5 | MET | One engine per invocation, then intro, advisory audit, duration gate, quality report/verdict and show notes (`apps/cli/src/commands/content-generate.ts:866-888`); no internal fallback — the engine chain is the workflow's own nodes (`plugins/kk/workflows/kk-news-generate.yaml:295-340`), asserted per node in `apps/cli/tests/kk-news-generate-dag.test.ts:144-171`. |
| R6 | MET | `--stage variants` = publish-prep + bundle-variants + safety-manifest; `--stage freeze` = `publish-matrix-bundle` then the contentType stamp (`apps/cli/src/commands/content-generate.ts:897-919`, `:369-376`); a second freeze on a frozen bundle exits 1 without rewriting (`apps/cli/src/commands/content-generate.ts:1163-1172`, asserted `apps/cli/tests/content-generate.e2e.test.ts:429-434` with a byte-identical bundle comparison). |
| R7 | MET | Twenty nodes in design §5.1 order, `executor-probe` the only node without `dependsOn`, one `agent` var, seven vars, every node after `prepare` conditioned on `pool-gate.json`, one `kk news <verb>` per non-agent non-pause non-nested node (freeze is the designed two-command node), no publish node (`plugins/kk/workflows/kk-news-generate.yaml:47-410`; asserted `apps/cli/tests/kk-news-generate-dag.test.ts:82-266`). `kk stage`, `jq ` and `file.read` appear in no node command (the single `file.read` hit is the prose comment at `plugins/kk/workflows/kk-news-generate.yaml:24`). |
| R8 | MET | `apps/cli/tests/kk-news-generate-dag.test.ts:82-266` asserts the node ids and order, the single `agent` var, `executor-probe` as the only entry node, the pool-gate condition on every later node and the absence of `kk stage`; 12 pass this round. |
| R9 | MET | Offline equivalence: the AC3 rehearsal reproduces voice3's own bundle node sequence over the same fixture — same variant keys, same safety status, same variant payloads — and writes `summary.json` (`apps/cli/tests/kk-news-generate.e2e.test.ts:419-492`, 3 pass this round). Launcher clause now asserted and stable at `apps/cli/tests/commands/content-generate-inproc.test.ts:314-328`: a real `kk news generate --run-date 20260101 --dry-run` whose receipt `dryRun.workflowPath` is `plugins/kk/workflows/kk-news-generate.yaml` — the same value the spawn consumes (`apps/cli/src/launch.ts:474`, `:507`) — under an explicit `}, 30_000)` budget. Three full-file runs this round: 22 pass / 0 fail each, the case at 4853–4905 ms (previously it flipped at the 5000 ms default); `bunx biome check` clean on the file; `spur task verdict --replay` reports 0 findings. |
| R10 | MET | `docs/04_DESIGN.md:1444` marks the news step verbs `# shipped (0367)`, `:1441` marks `generate-bundle shipped (0367)`, `:1446-1450` lists the six news step verbs and the shared `generate-bundle` as registered, and `:1493-1495` reads `Shipped workflows: kk-publish (0366) and kk-news-generate (0367, twenty nodes, one executor var)`. No `planned (0367)` and no `Planned workflows: kk-news-generate` remain; `git diff -- docs/04_DESIGN.md` is non-empty (15 lines). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The generate workflow keeps only nodes that earn their place (req: R7, R8) | MET | test | `apps/cli/tests/kk-news-generate-dag.test.ts:82-141` — 20 node ids in topological order, forward-only deps with `executor-probe` the only entry node, one executor variable, and no node command containing `kk stage`, `jq ` or `file.read`; re-derived by hand this visit against `plugins/kk/workflows/kk-news-generate.yaml:47-410` (20 ids, 6 agent nodes on `${vars.agent}`). |
| AC2 — Step verbs compose the existing stages (req: R1, R2, R3, R4, R5, R6) | MET | test | `apps/cli/tests/content-generate.e2e.test.ts:323-473` — prepare, both curate checks, the script check, render, voice, cards, variants, freeze, the refused second freeze and report each print one JSON object and exit 0, plus empty-pool `prepare` exit 0 with gate EMPTY (`:475-490`) and the byte-identical second freeze (`:429-434`); 6 pass this round. |
| AC3 — The new workflow freezes the same bundle as voice3 (req: R9) | MET | test | `apps/cli/tests/kk-news-generate.e2e.test.ts:419-492` — the twenty nodes close `done`, bundle variants `['article','episode','xhs-article']` and safety `pass` equal the voice3 reference freeze run over the same fixture, and `.works/tmp/test-news-generate/summary.json` is written; the empty-pool run closes done with `no-content:` and exactly one real dispatch, the executor probe (`:494-512`); 3 pass this round. |
| AC4 — Gate (req: R10) | MET | command | `.spur/run/0367-check-receipt.json:5-17` — tier full, runId 8208f517, status PASS over `bun run lint && bun run test-pre-check && bun run test && bun run test-post-check` (`.spur/run/0367-test-gate.log:8`, `:578` 5284 pass 0 fail, `:583` both post-check rules passed); `bun run build` run on this tree by this visit exited 0; `git diff --stat -- plugins/kk/scripts plugins/kk/workflows/kk-daily-ai-voice3.yaml plugins/kk/workflows/kk-daily-safety.yaml` is empty. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0367
**Scope:** task diff vs `docs/design/content-pipeline-consolidation.md` §1.3 / §5.1 / §6 — new `apps/cli/src/commands/content-generate.ts`, new `plugins/kk/workflows/kk-news-generate.yaml`, `apps/cli/src/commands/content.ts`, `apps/cli/src/commands/daily.ts`, five new/changed test files, `docs/04_DESIGN.md` and the G61 feature Goal
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

Fourth visit, run out of band (pipeline run 8208f517 was cancelled after a gate-mode loop). Reviewed on this exact tree
(`sp/runall-g61-9beb`); the full gate is **not** re-run — its receipt `.spur/run/0367-check-receipt.json` is status PASS,
tier full, runId 8208f517, tree `f28d30c8…` — and the light tier is never used (its scoped subset leaves a partial
`.coverage/lcov.info`, which is what made the cancelled run's `coverage-gate` post-check fail). Fresh evidence pasted
from this round:

- `NODE_ENV=test bun scripts/with-spur-env.ts -- bun test --timeout 200000 apps/cli/tests/commands/content-generate-inproc.test.ts` → **22 pass / 0 fail**, the R9 launcher case at **4905 ms** under its own budget
- the same file twice more through the verifier's own command (`cd apps/cli && bun test --coverage --coverage-reporter=text tests/commands/content-generate-inproc.test.ts`) → **22 pass / 0 fail**, launcher case at **4854 ms** and **4991 ms**
- `… bun test --timeout 300000 apps/cli/tests/kk-news-generate-dag.test.ts apps/cli/tests/commands/content-generate.test.ts apps/cli/tests/content-generate.e2e.test.ts apps/cli/tests/kk-news-generate.e2e.test.ts` → **26 pass / 0 fail**
- `bunx biome check apps/cli/tests/commands/content-generate-inproc.test.ts` → clean
- `spur task verdict 0367 --from-answer .spur/run/cert-0367-review-cert.md --replay` → **PASS** (10 requirements, 2 checks, replay of 4 cited files with **0 findings**)
- `bun run build` → exit 0 (previous round, no source file changed since); `git diff --stat -- plugins/kk/scripts plugins/kk/workflows/kk-daily-ai-voice3.yaml plugins/kk/workflows/kk-daily-safety.yaml` → empty

##### Finding 1 closed

The only open finding was the R9 launcher case straddling bun's 5 s default with no declared budget
(`bun test … content-generate-inproc.test.ts` gave 1 pass at 4695 ms and 3 timeouts at 5002 ms in the previous round,
and `spur task verdict --replay` flipped between exit 1 and clean). The case now declares `}, 30_000)` at
`apps/cli/tests/commands/content-generate-inproc.test.ts:314-328`, with a comment naming the 5 s default as the cause.
Re-verified here rather than taken on claim: three full-file runs, **22 pass / 0 fail each**, the case at 4853–4905 ms
— i.e. the ~5 s wall time is now irrelevant because the budget is 6× it — and the verifier's replay of that file exits 0
with **0 findings**. The file's other 21 cases are untouched and still green; `biome check` is clean.

##### The four earlier findings, each re-verified independently

1. **P1 / R10 — repaired.** `docs/04_DESIGN.md:1444` reads `kk news prepare | generate-render | generate-voice |
   generate-cards | report … # shipped (0367)`, `:1441` reads `generate-bundle shipped (0367)`, `:1446-1450` lists the six
   news step verbs and the shared `generate-bundle` as registered, and `:1493-1495` reads `Shipped workflows: kk-publish
   (0366) and kk-news-generate (0367, twenty nodes, one executor var)`. `grep -n "planned (0367)\|Planned workflows:
   kk-news-generate"` returns nothing; the only surviving "do not invoke it as if it exists" is the generic sentence at
   `:1450` about lines that are *still* marked planned. `git diff -- docs/04_DESIGN.md` is 15 lines, not empty.
2. **P2 — repaired, reproduced.** `STEP.cards` carries `when: (ctx) => ctx.settings.cards_enabled`
   (`apps/cli/src/commands/content-generate.ts:744-750`): with `workflows.kk-news-generate.cards_enabled: false`,
   `generate-cards` → exit 0, `stages: []`, `{"cards":0,…}`; with the default `true` → `stages: ["daily-xhs-render"]`.
3. **P3 — repaired, reproduced.** `priorErrors` is computed per step (`apps/cli/src/commands/content-generate.ts:1085-1089`)
   and `--final` reads it (`:840`): a present `24-script/<date>_08_script-write_errors.json` with no curate errors →
   `{"step":"script","verdict":"fallback"}`; a curate errors file alone → `{"step":"script","verdict":"pass"}`; a curate
   errors file with `--step curate --final` → `{"step":"curate","verdict":"fallback"}`.
4. **P3 — repaired, reproduced.** `selected` is the store's own `{"selected": N}`: `kk store select` writes it
   (`apps/cli/src/commands/store.ts:1465`), `runRawCli` parses the last JSON line
   (`apps/cli/src/commands/content-generate.ts:459-479`), the summary reports `selected: pass ? deps.selectedCount() : 0`
   (`:820`). Reproduced with two candidates and a store answer of zero → `{"pool":"ok","candidates":2,"selected":0,…}`;
   the AC2 e2e proves the real spawn path (`selected: 2` over two real inserted rows).
5. **P3 / R9 launcher clause — closed.** `apps/cli/tests/commands/content-generate-inproc.test.ts:314-328` runs
   `kk news generate --run-date 20260101 --dry-run` and asserts `receipt.dryRun.workflowPath` ends with
   `plugins/kk/workflows/kk-news-generate.yaml` (the value the real spawn consumes, `apps/cli/src/launch.ts:474`, `:507`)
   plus `run_date` and a `kk-news-generate` work dir — now with a stable budget. R9 moves to MET.
6. **Previously accepted P4s re-checked, unchanged:** the voice-fallback predicate keeps only the `"passed": true` half
   (`plugins/kk/workflows/kk-news-generate.yaml:312-326`); the Solution table still cites the one-node 0365 launch stub
   (`docs/tasks/0367_*.md:132-135`); both e2e suites still write the same `.works/tmp/test-news-generate/summary.json`;
   the frozen design's two stage-name contradictions are unchanged.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | test coverage (R9) | CLOSED. The R9 launcher case straddled bun's 5 s default with no declared budget, so `spur task verdict --replay` flipped between exit 1 and clean. It now declares `}, 30_000)`; three full-file runs this round gave 22 pass / 0 fail each with the case at 4853–4905 ms, and replay reports 0 findings. | `apps/cli/tests/commands/content-generate-inproc.test.ts:314-328` | RESOLVED |
| 2 | P4 (advisory) | documentation | The Solution table's anchors drifted and two rows name the wrong file: `executor-probe`/`prepare`/`curate`/`freeze` live in `plugins/kk/workflows/kk-news-generate.yaml:47/58/74/393`, not in `apps/cli/tests/fixtures/workflows/kk-news-generate.yaml` (the 21-line 0365 launch stub); the `content-generate.ts:736/660/1082/1147` anchors now point at 799/735/1155/1216. | `docs/tasks/0367_news-generate-step-verbs-and-the-kk-news-generate-workflow.md:132-135` | ACCEPTED |
| 3 | P4 (advisory) | documentation | The §1.14 heading still reads `Shipped (0363–0366, G61, ADR-053)` while the body it heads now ships 0367's verbs and workflow. | `docs/04_DESIGN.md:1415` | ACCEPTED |
| 4 | P4 (advisory) | usability | `generate-bundle`'s stdout reports `safety: 'none'` when the bundle carries no safety evidence, where design §1.3 spells the absent value `null`. No consumer parses this field (the workflow reads `bundle.json`), and the e2e pins `'none'`; align it or amend §1.3 in 0368/0369. | `apps/cli/src/commands/content-generate.ts:775`, `:786` | ACCEPTED |
| 5 | P4 (advisory) | usability | The voice fallbacks keep the "no passing verdict" half of voice3's predicate but drop its `metadata.generator` identity half (a plain `"passed": true` substring match), so a foreign or relabelled content JSON could suppress both fallbacks. | `plugins/kk/workflows/kk-news-generate.yaml:312-326` | ACCEPTED |
| 6 | P4 (advisory) | test quality | The AC3 harness drives `spur workflow run` directly and asserts the engine's `finalState`, not a launcher receipt; the news launcher path is proven by composition — the dry-run plan assertion above plus the generic launch e2e (`apps/cli/tests/content-launch.e2e.test.ts:619` asserts a `status: 'done'` receipt). | `apps/cli/tests/kk-news-generate.e2e.test.ts:419-492` | ACCEPTED |
| 7 | P4 (advisory) | test quality | Dead tautological assertion `expect(stageCalls[0]?.[0]).toBe(stageCalls[0]?.[0])` (cannot fail); the next line carries the real check. | `apps/cli/tests/commands/content-generate-inproc.test.ts:241` | ACCEPTED |
| 8 | P4 (advisory) | test quality | AC2 and AC3 both write `.works/tmp/test-news-generate/summary.json`, so the retained rehearsal evidence is last-writer-wins between the two suites. | `apps/cli/tests/content-generate.e2e.test.ts:40`, `apps/cli/tests/kk-news-generate.e2e.test.ts:41` | ACCEPTED |
| 9 | P4 (advisory) | documentation | The frozen design still contradicts itself on two stage names, and the implementation follows R2/§6 and voice3's real nodes: §1.3's `prepare` row lists `daily-script-style`, and §6 lists `audio-quality` as "called from voice3" though no voice3 node calls it. | `docs/design/content-pipeline-consolidation.md:74`, `:501` | ACCEPTED |
| 10 | P4 (advisory) | test infra | `spur task gate 0367 status` answers `{"reuse":false,"reason":"stale"}` although no tracked file changed after the receipt: the newest tracked mtime is 10:25:15 and the receipt completed at 10:50:17; the tree hash moved because the targeted suites rewrite untracked artifacts under `apps/cli/.works/tmp/` (and the R9 fix touched an untracked test file). Nothing in the deliverable is affected; a future full-tier `gate run` re-certifies. | `.spur/run/0367-check-receipt.json:17` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Seven step-verb rows in one table (`apps/cli/src/commands/content-generate.ts:799-929`), five news-only (`:1216`), the article noun refusing the steps until 0368 (`:1139`); design §1.3 stdout, named flags only and exit 0/1/2 asserted end to end (`apps/cli/tests/content-generate.e2e.test.ts:323-473`, 6 pass this round). |
| R2 | MET | One runner, voice3 order, stops at the first failing stage and names it on stderr (`apps/cli/src/commands/content-generate.ts:936-951`); `prepare` never runs `daily-script-style` (`:801-804`); no stage body edited (AC4's `git diff --stat` empty); first-failure assertion (`apps/cli/tests/content-generate.e2e.test.ts:492-506`). |
| R3 | MET | `writePoolGate` writes `<workDir>/pool-gate.json` and never exits non-zero (`apps/cli/src/commands/content-generate.ts:383-412`); empty pool → exit 0, `pool: 'empty'`, gate `{status:'EMPTY'}` (`apps/cli/tests/content-generate.e2e.test.ts:475-490`); session warnings reported, never fatal (`:696`, `:824`; asserted `:349-355`). |
| R4 | MET | `pass`/`fix` verdicts with the step's own errors file (`apps/cli/src/commands/content-generate.ts:826-847`), exit 1 only for a missing input (`:1030-1041`), `--final` per step (`:1085-1089`, `:840`) — all three branches reproduced on this tree. |
| R5 | MET | One engine per invocation, then intro, advisory audit, duration gate, quality report/verdict, show notes (`apps/cli/src/commands/content-generate.ts:866-888`); the fallback chain is the workflow's (`plugins/kk/workflows/kk-news-generate.yaml:295-340`). |
| R6 | MET | `variants` = publish-prep + bundle-variants + safety-manifest; `freeze` = `publish-matrix-bundle` + contentType stamp (`apps/cli/src/commands/content-generate.ts:897-919`, `:369-376`); second freeze exits 1 without rewriting (`:1163-1172`, asserted `apps/cli/tests/content-generate.e2e.test.ts:429-434`). |
| R7 | MET | Twenty nodes in §5.1 order, one `agent` var, pool-gate condition on all 18 later nodes, one verb per node (freeze is the designed two-command node), no publish node, no `kk stage`/`jq `/`file.read` in a command (`plugins/kk/workflows/kk-news-generate.yaml:47-410`; `apps/cli/tests/kk-news-generate-dag.test.ts:82-266`). |
| R8 | MET | `apps/cli/tests/kk-news-generate-dag.test.ts:82-266` — ids/order, single `agent` var, probe as the only entry node, the pool-gate condition, `kk stage` absence; 12 pass this round. |
| R9 | MET | Offline equivalence: the AC3 rehearsal reproduces voice3's own bundle node sequence over the same fixture — same variant keys, same safety status, same payloads — plus `summary.json` (`apps/cli/tests/kk-news-generate.e2e.test.ts:419-492`, 3 pass this round). Launcher clause asserted and stable at `apps/cli/tests/commands/content-generate-inproc.test.ts:314-328` under a `}, 30_000)` budget; 22 pass / 0 fail on three full-file runs, case at 4853–4905 ms, replay 0 findings. |
| R10 | MET | `docs/04_DESIGN.md:1441`, `:1444`, `:1446-1450`, `:1493-1495`; no `planned (0367)` and no `Planned workflows: kk-news-generate` left anywhere in the file. |

##### Acceptance-Criterion Evidence

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — The generate workflow keeps only nodes that earn their place (req: R7, R8) | MET | test | `apps/cli/tests/kk-news-generate-dag.test.ts:82-141`; re-derived by hand against `plugins/kk/workflows/kk-news-generate.yaml:47-410` (20 ids, 6 agent nodes on `${vars.agent}`, 0 hits for `kk stage`/`jq `/`file.read` in command bodies). |
| AC2 — Step verbs compose the existing stages (req: R1, R2, R3, R4, R5, R6) | MET | test | `apps/cli/tests/content-generate.e2e.test.ts:323-473` — the nine invocations in order, one JSON object each, empty-pool exit 0 + gate EMPTY (`:475-490`), second freeze exit 1 + byte-identical bundle (`:429-434`); 6 pass this round. |
| AC3 — The new workflow freezes the same bundle as voice3 (req: R9) | MET | test | `apps/cli/tests/kk-news-generate.e2e.test.ts:419-492` — `done`, variants `['article','episode','xhs-article']`, safety `pass`, equal to the voice3 reference freeze; empty-pool run `done`/`no-content` with only the executor probe dispatched (`:494-512`); 3 pass this round. |
| AC4 — Gate (req: R10) | MET | command | `.spur/run/0367-check-receipt.json:5-17` (tier full, runId 8208f517, PASS) over `.spur/run/0367-test-gate.log:8` (`bun run lint && bun run test-pre-check && bun run test && bun run test-post-check`), `:578` 5284 pass / 0 fail, `:583` both post-check rules passed; `bun run build` exit 0; the required `git diff --stat` is empty. |

##### Evidence gaps recorded rather than assumed

- The full gate was **not** re-run (instruction: 19 min, and the receipt already certifies this tree's source). Its
  freshness reads `stale` for the artifact reason in finding 10. The R9 fix touched only an untracked **test** file, so
  AC4's `bun run lint && bun run test && bun run build` evidence is unchanged; a full-tier `gate run` is still the step
  that mints a receipt for the current tree hash.
- The targeted suites above rewrite `.coverage/lcov.info` with a scoped subset, which is exactly the artifact that made
  the cancelled run's `coverage-gate` post-check fail. Anyone re-running a gate must run the **full** tier, never
  `status`/`light` against the scoped file.
- The certification answer (`.spur/run/cert-0367-review-cert.md`, mirrored to `…-answer.txt`) carries `Confidence: HIGH`;
  `spur task verdict 0367 --replay` returns **PASS** with 0 replay findings.

**Next:** nothing open at P1–P3. Certify with a full-tier gate run for the current tree hash, then let the pipeline's
approval decision close 0367; findings 2–10 are advisory and may be carried into 0368/0369.

### References

- Design: `docs/design/content-pipeline-consolidation.md` §1.3, §5.1, §6. Decision: ADR-053 §5, §6, §7. Timing evidence: `.works/kk-daily-ai-voice2/20261008/step-timing.json`.
- Depends on: 0365, 0366 (shares `content.ts` and `docs/04_DESIGN.md`). Blocks: 0368, 0369.
- Parent feature: G61, scenario "One executor variable drives every agent node" (re-proved for the new workflow).

### History

- 2026-11-14T15:56:06.181Z backlog → wip (system)
- 2026-11-14T19:12:16.171Z wip → testing (system)
- 2026-11-14T19:12:20.391Z testing → done (system)

