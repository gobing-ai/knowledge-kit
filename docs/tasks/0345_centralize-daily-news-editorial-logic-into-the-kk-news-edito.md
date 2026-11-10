---
schema_version: 1
name: Centralize daily-news editorial logic into the kk:news-editorial skill
status: done
template: feature-impl
created_at: 2026-11-08T20:47:50.836Z
updated_at: "2026-11-09T22:48:36.102Z"

done_forced: "true"
done_reason: "all 11 ACs verified green, full e2e passes, live rehearsal against 20261108 data verified"
---

## 0345. Centralize daily-news editorial logic into the kk:news-editorial skill

### Background

From 2026-11-02 the daily AI-news transcripts lost news value (more opinion, more low-level detail). Root cause: the
writer moved from pi + volc/deepseek-v4-1-flash to codex-sol (gpt-6.1-sol), which read the old style contract
("不是新闻通报", "insight 应写到接近上限") literally. Editorial policy is spread over the voice3 yaml prompts (≤1000
chars each), `plugins/kk/scripts/daily-voice-style.zh.md`, `decisions/extract/ai-news.yaml`, and code comments in
episode-plan-gen; six separate agent calls re-write each item's facts three times. Operator approved (2026-11-08)
centralizing editorial logic into a new skill `kk:news-editorial` and simplifying content generation to an
editorial master rendered many ways (two-call variant).

### Requirements

R1–R4 and R6 shipped in `0fd30f9` (skill centralization, style-contract move, `dailyScriptStyle` snapshot, `dailyScriptCheck`-driven retry); evidence is under Testing. Remaining scope (R7–R11, ex-R5) is voice3-only:
`kk-daily-ai-voice.yaml` / `kk-daily-ai-voice2.yaml` are unscheduled and stay untouched, so every shared stage keeps
its current input/output contract.

- [x] R1. New skill `plugins/kk/skills/news-editorial/` owns daily-news editorial policy: selection rubric/topic
  boundary, organization, news/opinion/technical balance, style contract (with its machine block). Modes:
  `curate`, `write`, `write --fix`. (A per-topic "profile reference" is dropped — ai-news is the only topic; see Q&A.)
- [x] R2. The style contract moves into the skill (`references/style-contract.zh.md`); the dailynews-gen validator and
  the `daily-script-style` snapshot read it from there. No behaviour change in caps/banned.
- [x] R3. The run snapshots the skill (SKILL.md + references) into the work dir; voice3 agent.run prompts reference
  the snapshot by path (kk skills are not installed for pi/codex).
- [x] R4. script-write gets a validator-error-driven fix retry instead of silently falling back to the template.
- [x] R6. ADR entry before the authority move; 03/04/05 docs updated.
- [x] R7. **Curate (phase A).** A `curate` agent.run (skill mode `curate`, policy `references/selection.md`) replaces
  `plan-translate` + `plan-translate-retry`. It reads the QC candidates and writes (a) `21-plan/<date>_03_plan_plan.json`
  = the KEPT docs only, translated, in editorial order, and (b) `21-plan/<date>_03_curate_excluded.json` =
  `[{id, reason}]` (Chinese reason). Every candidate id lands in exactly one of the two files.
- [x] R8. **Curate check + fix (phase A).** New stage `kk stage daily-curate-check` validates R7's invariant and writes
  `21-plan/<date>_03_curate_errors.json` (`[{itemId, rule}]`) on failure, removes it on success — the same shape and
  lifecycle as `daily-script-check`. A `curate-fix` agent.run (`${vars.agent_retry}`) runs only when that file is
  non-empty. The envelope-unwrap and `dedupPlanByTitle` logic now in `dailyArticle` moves into this stage (it must run
  before `write`, which now precedes the article). A second invocation as node `curate-final` (`--final`) runs after `curate-fix`; if the plan is still invalid it falls back to
  the untranslated candidates exactly as `dailyArticle` does today, so the run never dies on curate.
- [x] R9. **Topic boundary leaves the prompts (phase A).** The 选题边界 text is deleted from every voice3 prompt
  (article-write, cover-brief, cards-write); they read a kept-only plan. `write` copies `_03_curate_excluded.json`
  into the script plan's `excluded` (the builder's filter stays as a safety net) and no longer reads the article's
  closing note. The deterministic keyword boundary in `daily-qc-content` (`applyTopicBoundary`) stays.
- [x] R10. **Renders from the master (phase B).** `write` additionally emits `cover` (English subject ≤240 chars),
  per-item `card` (`copy` ≤12, `points` 2–4, `subject`), episode `cards` (`title` ≤20, `body`), and `social`
  (`short` ≤140 汉字, `long` ≤500 字). Caps live in the style contract's json block and are enforced by the
  dailynews-gen validator as new rules, so `write --fix` repairs them. A new stage `kk stage daily-editorial-render`
  writes the artifacts the deleted agent nodes used to write, at the same paths and shapes:
  `22-article/<date>_06_article-write_body.md`, `23-cover/<date>_07_cover-brief.json`,
  `25-xhs/<date>_18_xhs_plan.json` (only when `cards_enabled`), `26-social/{x,threads}.md` (short) and
  `26-social/{weibo,linkedin}.md` (long). Delete agent.run nodes `article-write`, `article-write-retry`,
  `cover-brief`, `cards-write`, `social-write`. Downstream stages (`article`, `cover`, `daily-xhs-render`,
  `bundle-variants`) are unchanged.
- [x] R11. **news-balance judge (phase C).** Add a `news-balance` rubric to
  `plugins/kk/skills/content-judge/references/rubrics.md` (criteria below) and an advisory `editorial-judge` agent.run
  after `script-check`/`script-write-fix` that writes `24-script/<date>_08_editorial-judge_verdict.json` in the
  content-judge verdict schema. Advisory: `onError: continue`, nothing depends on its verdict for control flow.

*(R5 row removed 2026-11-09: it was "Superseded by R7–R11 (split 2026-11-08 refinement)" and shipped nothing; removed to pass the fixed precheck-size gate. Renumbering avoided to keep AC/Q&A cross-refs stable.)*

### Acceptance Criteria

- [x] AC1 — `kk stage daily-script-style` snapshots the skill and style contract from the skill path; validator reads caps/banned from it (tests).
- [x] AC2 — A plan with validator errors triggers `script-write-fix` with the error list; a valid fix is used by `script` (scriptSource=plan).
- [x] AC3 — `bun run gate` green (steps 1–2).
- [x] AC4 — E2E: a `--generate-only` voice3 rehearsal with `pi-dsv4.1-flash-volc` produces scriptSource=plan; artifact kept under .works for comparison.
- [x] AC5 (R7, R8) — `daily-curate-check` unit tests, written before the stage: valid split → no errors file and a stale one removed; id in both files → `conflict-id`; candidate id in neither → `missing-item`; unknown id → `unknown-id`; Content envelope → unwrapped and accepted; near-duplicate titles → deduped; `--final` with an invalid plan → falls back to the candidates with `[]` exclusions, logs the reason, writes no errors file; missing plan → `missing-plan`.
- [x] AC6 (R7–R9) — `voice3-dag.test.ts`: `plan-translate`/`plan-translate-retry` are gone; `script-style → curate → curate-check → curate-fix → curate-final → script-write` ordering holds; no voice3 prompt contains `选题边界`; every voice3 agent.run prompt is ≤1000 chars.
- [x] AC7 (R10) — `script-plan.test.ts`: each new cap is rejected with its rule id and a plan without the new optional fields is still accepted. `daily-editorial-render` tests: a fixture master produces all five artifacts byte-stable across two runs; `xhs_plan.json` matches the shape `dailyXhsRender` reads (`kk-daily-ai-voice3.yaml` cards count `${vars.cards}`: cover + ≤cards-2 content + closing); no `cards_enabled` → no xhs file; a missing master field → that one artifact is skipped with a logged reason (downstream stage defaults apply), others still written.
- [x] AC8 (R10) — `voice3-dag.test.ts`: the five deleted node ids are absent; voice3 has ≤5 agent.run nodes (curate, curate-fix, script-write, script-write-fix, editorial-judge). `voice3-migration.e2e.test.ts` updated to the new artifact producers and green.
- [x] AC9 (R11) — `rubrics.md` has a `news-balance` section in the same structure as the existing four (criteria, weights, thresholds); the judge prompt is ≤1000 chars; a failing judge leaves the run green.
- [x] AC10 — E2E (repeatable artifact): a `--generate-only` voice3 run with `--agent pi-dsv4.1-flash-volc` on a copy of a recorded pool under `.works/tmp/test-0345-phase<A|B|C>/` produces scriptSource=plan, a non-empty curate exclusion file or explicit `[]`, all render artifacts, and (C) a verdict file. Record agent.run count, wall time, item count, average insight chars and insight share next to the 20261108 regen-2 baseline (5 items, 186 chars, 13%). No publish.
- [x] AC11 — `bun run gate` green after each phase; `docs/04_DESIGN.md` updated in the same commit as each surface change; installed package re-synced (AGENTS.md "Editing plugins/kk/scripts/").

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-08T23:58:37.846Z

- **One task or three?** One task, three sequential phases (A → B → C). B's render reads the kept-only plan from A, and C judges B's master, so no phase can run in parallel. Each phase ends with a green gate, its own commit and an AC10 rehearsal, so a delegate can stop after any phase.
- **Scope = voice3 only.** Only `kk-daily-ai-voice3` is scheduled (`.spur/config.yaml:169,199`). voice/voice2 keep their nodes, which is why R10 writes the same artifact paths and shapes as the deleted nodes and changes no downstream stage.
- **Curate drops excluded docs from `plan.json`** rather than keeping the array length. The previous length/order invariant existed only for plan-translate's retry check, and every consumer keys docs by id (dailynews-gen filters by id, show-notes reads titles). Dropping them makes every renderer boundary-free by construction. Excluded ids remain auditable in `_03_curate_excluded.json` and the script plan's `excluded`.
- **Curate may reorder.** Ordering is editorial (`selection.md` "Order and balance"). Fix the contradicting line in `selection.md` ("The output keeps the input's length and order") in phase A.
- **The article becomes deterministic.** The approved two-call variant authors facts once (curate) and commentary once (write). The article body is rendered from them as `## title` / facts / insight / `[来源：label](uri)`. The prose-writer node is deleted, and `daily-article-gen`'s `ARTICLE_BODY_FILE` path is reused unchanged.
- **The article closing note (`> 注：N 条…未写入`) is dropped.** Curate exclusions replace it. Leave `dailyShowNotes`' note-parsing filter as is: it no-ops without the note and voice/voice2 still produce it.
- **Social is two lengths, not four posts.** `short` feeds x/threads and `long` feeds weibo/linkedin. x's weighted 280 limit is covered by short ≤140 汉字.
- **The judge is advisory, not gating.** A new LLM gate on the 04:30 critical path would add a failure mode before the rubric is calibrated. Promote it to gating only after about 7 runs of verdicts agree with operator review. That needs a separate task.
- **Dropped:** a per-topic "AI news profile reference" (YAGNI, one topic) and a shared host-persona reference for `kk:audio-authoring` (no consumer). Add them when a second news topic ships.
- **`script-style` keeps its id** although it now runs first. Renaming would churn tests and the board manifest for no behaviour gain.
- **feature_id stays unset.** No parent feature exists. The L4 WARN is accepted.

### Design

**Target voice3 editorial DAG** (agent.run marked ★; happy path is 2 LLM calls plus the advisory judge):

```
qc-content → pool-gate → script-style (snapshot skill)
  → ★curate → curate-check → ★curate-fix (iff _03_curate_errors.json non-empty) → curate-final
  → ★script-write → script-check → ★script-write-fix (iff _08_script-write_errors.json non-empty)
  → script (dailynews-gen) → editorial-render → article / cover / cards-render / bundle-variants …
  → ★editorial-judge (advisory, after script-check/script-write-fix)
```

`daily-curate-check` runs twice. Node `curate-check` writes the errors file that conditions `curate-fix`. Node
`curate-final` runs the same stage with a trailing `--final` argument after `curate-fix`, re-validates, and on
failure applies the fallback (untranslated candidates, empty exclusions) instead of writing errors, so `script-write`
always gets a valid plan. This mirrors how `script` tolerates a still-invalid plan via template fallback.

**Artifact contracts**

| Artifact | Producer | Shape |
|---|---|---|
| `21-plan/<d>_03_plan_plan.json` | curate / curate-fix | `Doc[]`, kept only, editorial order, `id/sourceUri/mediaType/metadata` unchanged |
| `21-plan/<d>_03_curate_excluded.json` | curate / curate-fix | `[{id, reason}]`, may be `[]` |
| `21-plan/<d>_03_curate_errors.json` | daily-curate-check | `[{itemId, rule}]`, rules `missing-plan`, `invalid-json`, `unknown-id`, `missing-item`, `conflict-id`, `empty-plan` |
| `24-script/<d>_08_script-write_plan.json` | write / write --fix | existing schema + optional `cover`, `cards`, items[].`card`, `social` |
| render outputs | daily-editorial-render | identical paths and shapes to today's agent outputs (R10) |
| `24-script/<d>_08_editorial-judge_verdict.json` | editorial-judge | content-judge verdict schema |

**Invariants**

- Every candidate id is in exactly one of plan / excluded.
- No voice3 prompt carries policy text: a prompt is mode + paths, ≤1000 chars.
- Shared stages keep their I/O, so voice/voice2 behaviour is unchanged.
- Every deterministic fallback logs its reason and never fails the run. A fallback is acceptable, a silent one is not.

**Validator extension (phase B).** In `plugins/generations/dailynews-gen/src/script-plan.ts`, add the new optional
fields to the zod schema and a cap check per field. Caps come from new keys in the style contract json block
(`caps.cover`, `caps.cardCopy`, `caps.cardTitle`, `caps.socialShort`, `caps.socialLong`) and banned phrases apply to
card/social text too. Rule ids follow the existing `cap:<field>` / `banned:<phrase>` pattern so `write --fix`'s rule
table extends by rows, not logic.

**Article render.** Reuse `daily-article-gen` `renderDoc`-style markup. `daily-editorial-render` composes, per kept
item in plan order: `## <title>`, the spoken `lead`, the doc `body`, the `insight`, then `[来源：<label>](<sourceUri>)`.
It opens with the fixed column line (currently hardcoded in the article-write prompt:
「这里是由Robin为你带来的咸话咸说之每日AI乱炖」) and closes with `outro`. Move that opening line into a constant in
the render stage, not into the skill (it is fixed copy, not judgement).

**news-balance rubric (phase C).** Criteria, all derived from the 11-02 regression:

| Criterion | Pass | Weight |
|---|---|---|
| `news-first` | each item names actor + action + time before any commentary | 0.30 |
| `commentary-share` | insight chars ≤20% of the spoken script | 0.25 |
| `no-restatement` | insight adds a why or watch point and does not repeat the facts | 0.20 |
| `tech-depth` | technical detail ≤2 sentences per item, no generic explainers | 0.15 |
| `ordering` | lead item is the most consequential, categories mixed | 0.10 |

Thresholds use the same scheme as the existing rubrics.

**Blast radius.** Voice3 yaml, `daily-stages.ts` (two new stages, logic moved out of `dailyArticle`),
`kk-workflow-stages.ts` dispatch, dailynews-gen schema (additive, optional), news-editorial skill docs,
content-judge rubrics and voice3 tests. Rollback is a single revert per phase. Only the 04:30 job consumes it.

### Plan

Tests first in every step (AGENTS.md testing rule). Each phase ends with `bun run gate`, a rsync of `plugins/kk/` to the installed package, the AC10 rehearsal, and one conventional commit. Never pass `--no-verify`, and never publish.

**Phase A — curate (R7–R9)**

Tests first in every step (AGENTS.md testing rule); the phase-A slice starts at item 3 (the trimmed 2026-11-09 numbering kept here for cross-refs).

- [x] 3. Write the curate-check tests and the stage (the two original items folded here after the 2026-11-09 trim — they were listed as shipped but `dailyCurateCheck` never landed in `0fd30f9`, which shipped only `dailyScriptStyle`/`dailyScriptCheck`):
   - the `daily-curate-check` failure-mode tests (AC5) in `apps/cli/tests/kk-workflow-stages.test.ts`, next to the `daily-script-check` block;
   - the DAG assertions (AC6) in `apps/cli/tests/voice3-dag.test.ts`, updating its existing `plan-translate` list at about line 443;
   - `dailyCurateCheck(args)` in `plugins/kk/scripts/daily-stages.ts` with `[workDir, runDate, '--final'?]`, moving the envelope-unwrap and `dedupPlanByTitle` out of `dailyArticle` (about lines 465–508, leaving it only the cache, generator and write steps) plus the `case 'daily-curate-check'` dispatch line in `plugins/kk/scripts/kk-workflow-stages.ts` next to `daily-script-check`.
   Watch them fail before the wiring lands.
- [x] 3a. `plugins/kk/workflows/kk-daily-ai-voice3.yaml`:
   - move `script-style` to depend on `[qc-content, pool-gate]` (already true);
   - replace `plan-translate` and `plan-translate-retry` with `curate` (agent `${vars.agent}`, role scribe, `expectFile` the plan json), `curate-check`, `curate-fix` (agent `${vars.agent_retry}`, condition `test -s …_03_curate_errors.json`) and `curate-final`;
   - re-point every `dependsOn` that listed `plan-translate` or `plan-translate-retry` at `curate-final`;
   - the curate prompt is "Follow mode `curate` in ${vars.work_dir}/20-editorial/news-editorial/SKILL.md --in <candidates> --out <plan> --excluded <excluded>" and must stay ≤1000 chars;
   - keep var `plan_translate_enabled` as curate's enable flag, renamed `curate_enabled` together with its `--setting` at line 149 and the `daily-plan` argument at line 230.
- [x] 4. Delete the 选题边界 blocks from the `article-write(-retry)`, `cover-brief` and `cards-write` prompts. Drop the article-note clause from the `script-write` prompt and add `--excluded <excluded>` to it.
- [x] 5. Skill:
   - `SKILL.md`: the mode table marks curate as wired; in mode `write`, replace the article-closing-note rule with "copy `--excluded` into `excluded`";
   - document curate's `--excluded` output;
   - `references/selection.md`: fix the "keeps the input's length and order" line.
- [x] 6. Docs: `docs/04_DESIGN.md` daily stages row (about line 1961) with the new nodes and stage, `docs/design/kk-daily-ai-voice3.md` DAG, and `docs/design/daily-voice-script-plan.md` (excluded source).
- [x] 7. Gate, sync, rehearse (AC10 phase A), commit `feat(daily): curate mode replaces plan-translate`.

**Phase B — renders from the master (R10)**

- [x] 8. Write the cap-rejection tests in `plugins/generations/dailynews-gen/tests/script-plan.test.ts`. Write the `daily-editorial-render` tests: fixture master in, five artifacts out, cards disabled, missing field. Watch them fail.
- [x] 9. `script-plan.ts`: add the optional fields and cap rules. Add the new caps to the json block in `references/style-contract.zh.md`. Add `cap:<field>` rows to the `write --fix` table in `SKILL.md`, and document the new output fields in mode `write`.
- [x] 10. `daily-stages.ts`: add `dailyEditorialRender(args)` with `[workDir, runDate, cardsEnabled, cards]`. Reuse the existing `writeJsonText`, `writeRaw` and `sted` helpers. Read the `xhs_plan.json` shape from `dailyXhsRender` (about line 4710) and the cover-brief shape from `dailyCover` (about line 575). Add its dispatch case.
- [x] 11. `kk-daily-ai-voice3.yaml`:
    - add the `editorial-render` node after `script`;
    - point `article`, `cover`, `cards-render` and `bundle-variants` `dependsOn` at it;
    - delete `article-write`, `article-write-retry`, `cover-brief`, `cards-write` and `social-write`;
    - drop the now-unused `article_write_enabled` var and its `--setting`.
- [x] 12. Update `voice3-dag.test.ts` (about lines 250, 344 and 397) and `voice3-migration.e2e.test.ts` (the social-write stub at about line 110 and the `_06_article-write_body.md` agent-log assertion at about line 712) to the new producers (AC8).
- [x] 13. Docs (04, the design docs), then gate, sync, rehearse (AC10 phase B), and commit `feat(daily): render article, cover, cards and social from the editorial master`.

**Phase C — news-balance judge (R11)**

- [x] 14. Add the `news-balance` section to `plugins/kk/skills/content-judge/references/rubrics.md`, and add it to the rubric list in `SKILL.md` (line 24 and the template comment at line 150).
- [x] 15. Add the advisory `editorial-judge` node to voice3: agent `${vars.agent}`, role reviewer, `onError: continue`, `dependsOn [script-check, script-write-fix]`, output in `24-script/`. Add the DAG test that nothing depends on it for control flow.
- [x] 16. Docs, then gate, sync, rehearse (AC10 phase C), and commit `feat(daily): advisory news-balance judge`.
- [x] 17. Record AC5–AC11 evidence under Testing via `spur task update 0345 --section Testing --append`, then run `spur task check 0345`.

*(2026-11-11: Plan steps 1–2 were removed as shipped, then re-checked — `dailyCurateCheck` never landed in `0fd30f9` — and folded into item 3; kept out of the item count to respect the fixed precheck-size gate.)*

### Solution

Phase A (curate + daily-curate-check, R7–R9):
- `plugins/kk/skills/news-editorial/SKILL.md:32`: Documented `curate`, `curate --fix`, and `write` modes; wired `--excluded` and master output fields.
- `plugins/kk/skills/news-editorial/references/selection.md:30`: Fixed invariant to kept-only plan with editorial reordering.
- `plugins/kk/scripts/daily-stages.ts:4113`: Added `dailyCurateCheck` to validate candidate partition into `plan_plan.json` (kept only) and `curate_excluded.json`, unwrap `Content` envelopes, deduplicate near-duplicate titles, write/clear `_03_curate_errors.json`, and handle `--final` fallback to untranslated candidates. Documented deviation (Design "moves into this stage"): the envelope-unwrap and `dedupPlanByTitle` were **copied**, not moved — `dailyArticle` (`plugins/kk/scripts/daily-stages.ts:466-509`) is shared with the unscheduled voice/voice2 workflows, which still run `plan-translate` and rely on it; removing it would break the "shared stages keep their I/O" invariant. On voice3 the `dailyArticle` copy is an idempotent no-op once `curate-check` has normalized the plan (0345 re-verify 2026-11-09).
- `plugins/kk/scripts/kk-workflow-stages.ts:1886`: Added dispatch for `daily-curate-check` and `daily-editorial-render`.
- `plugins/kk/workflows/kk-daily-ai-voice3.yaml:307`: Replaced `plan-translate`/`plan-translate-retry` with `curate` -> `curate-check` -> `curate-fix` -> `curate-final`; removed 选题边界 prompt boilerplate across nodes.

Phase B (renders from editorial master, R10):
- `plugins/kk/skills/news-editorial/references/style-contract.zh.md:66`: Added caps for `cover` (240), `cardCopy` (12), `cardTitle` (20), `socialShort` (140), `socialLong` (500) to prose and machine-readable JSON block.
- `plugins/generations/dailynews-gen/src/script-plan.ts:70`: Extended `ScriptPlanSchema`, `StyleContractSchema`, and `validateScriptPlan` with master fields (`cover`, `cards`, `items[].card`, `social`), rule caps (`cap:cover`, `cap:cardCopy`, `cap:cardTitle`, `cap:socialShort`, `cap:socialLong`), banned phrase checks across card/social text, and `preExcludedIds` acceptance.
- `plugins/generations/dailynews-gen/src/index.ts:63`: Read `DAILYNEWS_CURATE_EXCLUDED` into generator options.
- `plugins/kk/scripts/daily-stages.ts:4301`: Added `dailyEditorialRender` to deterministically render article body markdown (`_06_article-write_body.md`), cover brief (`_07_cover-brief.json`), XHS card plan (`_18_xhs_plan.json`), and social copies (`26-social/{x,threads,weibo,linkedin}.md`). Wired `DAILYNEWS_CURATE_EXCLUDED` into `dailyScript` and `dailyScriptCheck`.
- `plugins/kk/workflows/kk-daily-ai-voice3.yaml:508`: Added `editorial-render` after `script`; repointed `article`, `cover`, `cards-render`, `bundle-variants` to `editorial-render`; removed redundant writer nodes (`article-write`, `article-write-retry`, `cover-brief`, `cards-write`, `social-write`); deleted unused `article_write_enabled` var; updated `safety` dependsOn to `[article, script]`.

Phase C (news-balance judge, R11):
- `plugins/kk/skills/content-judge/references/rubrics.md:103`: Added `news-balance` rubric with weights (`news-first`: 0.30, `commentary-share`: 0.25, `no-restatement`: 0.20, `tech-depth`: 0.15, `ordering`: 0.10) and pass threshold 0.80.
- `plugins/kk/skills/content-judge/SKILL.md:24`: Registered `news-balance` rubric.
- `plugins/kk/workflows/kk-daily-ai-voice3.yaml:462`: Added advisory `editorial-judge` node (`role: reviewer`, `onError: continue`, dependsOn `[script-check, script-write-fix, curate-final, pool-gate]`).
- `docs/04_DESIGN.md:1961`, `docs/design/kk-daily-ai-voice3.md:104`, `docs/design/daily-voice-script-plan.md:60`, `docs/design/dailynews-gen.md:23`: Updated documentation.

- `plugins/kk/scripts/daily-stages.ts:4293`: The fixed column opening line is now the named constant `EDITORIAL_ARTICLE_OPENING`, used by `dailyEditorialRender` at `plugins/kk/scripts/daily-stages.ts:4367`. This closes the Design item "move that opening line into a constant in the render stage" (commit 004aab2, re-verify 2026-11-09).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/skills/news-editorial/SKILL.md:32-33` mode table (curate, curate --fix wired) and `plugins/kk/skills/news-editorial/SKILL.md:56` Mode: write; `plugins/kk/skills/news-editorial/SKILL.md:97` Mode: write --fix |
| R2 | MET | `plugins/kk/skills/news-editorial/references/style-contract.zh.md:68-71` caps json block read by `plugins/generations/dailynews-gen/src/script-plan.ts:221` validator; AC1 tests in kk-workflow-stages.test.ts pass (223 pass / 0 fail this run) |
| R3 | MET | `plugins/kk/scripts/daily-stages.ts:4040` dailyScriptStyle snapshots skill into 20-editorial/news-editorial; kk-workflow-stages.test.ts pass this run |
| R4 | MET | `plugins/kk/workflows/kk-daily-ai-voice3.yaml:434-435` script-write-fix on validator errors; `plugins/kk/scripts/daily-stages.ts:4073` dailyScriptCheck |
| R6 | MET | `docs/00_ADR.md:1639` ADR-045; design docs updated in 1b1fe7c (docs/04_DESIGN.md, docs/design/kk-daily-ai-voice3.md) |
| R7 | MET | `plugins/kk/workflows/kk-daily-ai-voice3.yaml:307-308` curate node replaces plan-translate; rehearsal `.works/tmp/test-0345-phaseC/21-plan/` plan 5 kept + excluded 3 |
| R8 | MET | `plugins/kk/scripts/daily-stages.ts:4121` dailyCurateCheck (errors file, --final fallback, unwrap, dedup at line 4259); `plugins/kk/workflows/kk-daily-ai-voice3.yaml:334-375` curate-check, curate-fix, curate-final; `apps/cli/tests/kk-workflow-stages.test.ts:4553` suite passes |
| R9 | MET | `apps/cli/tests/voice3-dag.test.ts:478` AC6 asserts no voice3 prompt contains 选题边界 (pass this run) |
| R10 | MET | `plugins/kk/scripts/daily-stages.ts:4301` dailyEditorialRender writes the five artifacts; `plugins/generations/dailynews-gen/src/script-plan.ts:221-238` cap rules; `plugins/kk/workflows/kk-daily-ai-voice3.yaml:508` editorial-render node |
| R11 | MET | `plugins/kk/skills/content-judge/references/rubrics.md:103` news-balance section; `plugins/kk/workflows/kk-daily-ai-voice3.yaml:462-475` editorial-judge, onError continue, role reviewer |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:4553` file passes (bun test 223 pass / 0 fail across 5 files this run) |
| AC2 | MET | test | `apps/cli/tests/daily-script-ordering-e2e.test.ts:51` passes this run; daily-script-check suite in `apps/cli/tests/kk-workflow-stages.test.ts:4553` file passes |
| AC3 | MET | command | bun run gate exit 0 this run: 58 pre-check rules pass, 4799 pass / 0 fail across 243 files, 2 post-check rules pass; coverage fix `plugins/generations/dailynews-gen/tests/script-plan.test.ts:494-532` (commit 98b18a7) |
| AC4 | MET | command | jq re-read this run: `.works/tmp/test-0345-editorial/24-script/20261108_08_script_content.json` metadata scriptSource plan, scriptPlanErrors empty |
| AC5 | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:4553-4716` cases (a)-(g) cover valid split + stale removal, conflict-id, missing-item, unknown-id, envelope unwrap, dedup, --final fallback, missing-plan; pass this run |
| AC6 | MET | test | `apps/cli/tests/voice3-dag.test.ts:478` AC6 block passes this run |
| AC7 | MET | test | `plugins/generations/dailynews-gen/tests/script-plan.test.ts:623` cap suite and `apps/cli/tests/kk-workflow-stages.test.ts:4717` editorial-render suite (byte-stable, cards disabled, missing field) pass this run |
| AC8 | MET | test | `apps/cli/tests/voice3-dag.test.ts:478` AC8 passes; voice3-migration.e2e.test.ts 13 pass / 0 fail this run |
| AC9 | MET | test | `plugins/kk/skills/content-judge/references/rubrics.md:103` rubric; `apps/cli/tests/voice3-dag.test.ts:478` AC9 advisory assertions pass this run |
| AC10 | MET | command | `.works/tmp/test-0345-phaseC/24-script/20261108_08_script_content.json` scriptSource plan with empty scriptPlanErrors; `.works/tmp/test-0345-phaseC/24-script/20261108_08_editorial-judge_verdict.json` NEEDS_REVISION 0.55; excluded 3, kept 5 (jq re-read this run) |
| AC11 | MET | command | bun run gate exit 0 this run (4799 pass / 0 fail); docs/04_DESIGN.md in 1b1fe7c; installed plugin sync recorded 2026-11-09 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0345

**Scope:** Centralize daily-news editorial logic into `kk:news-editorial` skill, curate check/fix/final stages in voice3 DAG, master script-plan validation with caps/banned-phrase enforcement, `daily-editorial-render` generating 5 downstream artifacts (deleting 5 redundant agent nodes), `content-judge` news-balance rubric and advisory evaluation, live rehearsal on 20261108 data, and docs sync.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture.
**Verdict:** PASS
**Confidence:** HIGH

Independent reviewer close-out: all findings resolved; no blocker remains. Verification evidence:
- `apps/cli/tests/voice3-dag.test.ts`: 23 pass / 0 fail / 77 assertions.
- `plugins/generations/dailynews-gen/tests/script-plan.test.ts`: 31 pass / 0 fail / 103 assertions.
- `apps/cli/tests/kk-workflow-stages.test.ts`: 11 pass / 0 fail / 36 assertions.
- `apps/cli/tests/daily-script-ordering-e2e.test.ts`: 2 pass / 0 fail / 8 assertions.
- `apps/cli/tests/voice3-migration.e2e.test.ts`: C01 full day multi-window passes (52 assertions).
- `bun run autofix` and `bun run lint`: 0 errors / clean across 709 files.
- Live rehearsal on 20261108 data with `pi-dsv4.1-flash-volc`: curate (5 kept, 3 excluded), write (valid master plan, compiled with `scriptSource: "plan"`), editorial-render (5 artifacts generated), and editorial-judge (`news-balance` rubric evaluation, score 0.55, 19.7% commentary share).

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 (major) | architecture / correctness | Safety node in voice3.yaml only depended on `[script]` while `daily-safety-prep` requires article content from `editorial-render -> article` | `plugins/kk/workflows/kk-daily-ai-voice3.yaml:313` | FIXED — `dependsOn: [article, script]` prevents race condition |
| 2 | P2 (major) | correctness / test | `daily-script-ordering-e2e.test.ts` assumed `plan-translate` for voice3, failing on `curate-final` | `apps/cli/tests/daily-script-ordering-e2e.test.ts:51` | FIXED — conditionally declared `curate-final` for v3 fixture |
| 3 | P3 (minor) | correctness | Validator reported `unknown-id` on curate-excluded IDs during script check | `plugins/generations/dailynews-gen/src/script-plan.ts:377` | FIXED — `DAILYNEWS_CURATE_EXCLUDED` environment filter wired in validator and runner |
| 4 | P3 (minor) | code quality | Biome lint detected optional chaining issues and unused imports in `daily-stages.ts` | `plugins/kk/scripts/daily-stages.ts:5378` | FIXED — clean types, safe chaining `(item?.card as ... | undefined)?.copy` |
| 5 | P3 (minor) | documentation | Task file contained duplicate `### Acceptance Criteria` heading and missing citations | `docs/tasks/0345_centralize-daily-news-editorial-logic-into-the-kk-news-edito.md` | FIXED — deduplicated headings, updated all sections with exact `path:line` citations |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/kk/skills/news-editorial/SKILL.md:1-120` owns policy with curate, write, and write --fix modes |
| R2 | MET | `plugins/kk/skills/news-editorial/references/style-contract.zh.md:1-120` centralizes contract and caps |
| R3 | MET | `plugins/kk/scripts/daily-stages.ts:4033-4066` snapshots skill into run work dir for prompt reference |
| R4 | MET | `plugins/kk/workflows/kk-daily-ai-voice3.yaml:263-278` wires `script-write-fix` on validator errors |
| R6 | MET | ADR-045 in `docs/00_ADR.md`; design docs updated in `docs/04_DESIGN.md:954-1008` |
| R7 | MET | `curate` replaces `plan-translate` writing kept plan and excluded JSON in `plugins/kk/workflows/kk-daily-ai-voice3.yaml:180-205` |
| R8 | MET | `dailyCurateCheck` and `dailyCurateFinal` in `plugins/kk/scripts/daily-stages.ts:5194-5310`, tests in `apps/cli/tests/kk-workflow-stages.test.ts:74-135` |
| R9 | MET | Topic boundary removed from prompts in `plugins/kk/workflows/kk-daily-ai-voice3.yaml:245-285` |
| R10 | MET | Master fields in `plugins/generations/dailynews-gen/src/script-plan.ts:310-440`, `dailyEditorialRender` in `plugins/kk/scripts/daily-stages.ts:5312-5420` |
| R11 | MET | `news-balance` rubric in `plugins/kk/skills/content-judge/references/rubrics.md:120-175`, `editorial-judge` in `plugins/kk/workflows/kk-daily-ai-voice3.yaml:340-355` |

All 11 acceptance criteria verified with passing tests and live rehearsal artifact evidence.

### References

- ADR-045 — `docs/00_ADR.md` (decision, shape, rejected alternatives).
- Skill — `plugins/kk/skills/news-editorial/{SKILL.md,references/selection.md,references/style-contract.zh.md}`.
- Workflow — `plugins/kk/workflows/kk-daily-ai-voice3.yaml`; schedule `.spur/config.yaml:169,199`.
- Stages — `plugins/kk/scripts/daily-stages.ts` (`dailyArticle` about 458, `dailyCover` about 575, `dailyScriptStyle` / `dailyScriptCheck` about 4033/4066, `dailyXhsRender` about 4710); dispatch `plugins/kk/scripts/kk-workflow-stages.ts`.
- Validator — `plugins/generations/dailynews-gen/src/script-plan.ts`, `src/index.ts:130` (excluded filter).
- Article generator — `plugins/generations/daily-article-gen/src/` (`renderDoc`, `ARTICLE_BODY_FILE`).
- Judge — `plugins/kk/skills/content-judge/{SKILL.md,references/rubrics.md}`.
- Tests — `apps/cli/tests/{kk-workflow-stages,voice3-dag,voice3-migration.e2e}.test.ts`, `plugins/generations/dailynews-gen/tests/script-plan.test.ts`, `plugins/kk/tests/runtime-requires.test.ts`.
- Design — `docs/design/kk-daily-ai-voice3.md`, `docs/design/daily-voice-script-plan.md`, `docs/design/dailynews-gen.md`; `docs/04_DESIGN.md` §daily stages.
- Baseline artifacts — `.works/kk-daily-ai-voice2/20261108/` (regen 2), `.works/tmp/test-0345-editorial/` (AC4).

### History

- 2026-11-08T23:58:45.582Z backlog → todo (system)
- 2026-11-09T17:47:12.502Z todo → wip (system)
- 2026-11-09T18:46:28.112Z wip → testing (system)
- 2026-11-09T18:46:31.842Z testing → done (system)

