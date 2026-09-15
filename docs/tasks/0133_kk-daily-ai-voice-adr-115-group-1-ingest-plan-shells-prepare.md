---
schema_version: 1
name: "kk-daily-ai-voice ADR-115 group 1: ingest/plan shells (prepare, collect, plan, quality-control-content, plan-translate)"
status: done
template: issue
created_at: 2026-09-14T23:36:55.942Z
updated_at: "2026-09-15T18:32:35.368Z"
feature_id: F8
parent_wbs: "0132"

ac_altitude: task-local
---

## 0133. kk-daily-ai-voice ADR-115 group 1: ingest/plan shells (prepare, collect, plan, quality-control-content, plan-translate)

### Background

Sub-task of **0132** (parent). **Scope superseded 2026-09-14:** this task absorbed the whole
kk-daily-ai-voice port (all 21 findings) instead of group 1 alone — groups 2-4 (0134-0136) are
cancelled as delivered-here, and the per-action inventory for the whole file follows.

`plugins/kk/workflows/kk-daily-ai-voice.yaml` is the live 06:00 scheduled pipeline
(`.spur/config.yaml` → `kk-daily-ai-voice` end-to-end). It has 21 error-level ADR-115 composition
findings; 0132 splits them into four ordered groups so the refactor lands in reviewable slices
instead of one blind pass over a production workflow that has no end-to-end test (the static suite
`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` is the only automated coverage).

Measured 2026-09-14 with `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml --json`
(error tier: shell action > 10 logical commands or > 800 chars; agent.run input > 1000 chars):

| Action | Measure |
| --- | --- |
| `prepare:onEnter:0` | 15 logical commands |
| `collect:onEnter:1` | 12 logical commands |
| `plan:onEnter:0` | 21 logical commands |
| `quality-control-content:onEnter:0` | 11 logical commands |
| `plan-translate:onEnter:0` | `agent.run` input 1258 chars |

Scope: the ingest/plan half of the pipeline (steps 1-5). Same owner pattern task 0132 established:
add `daily-ai-voice` verbs to `plugins/kk/scripts/kk-workflow-stages.ts` (or to a
`kk-daily-ai-voice-stages.ts` runner if the group warrants its own file), reduce each YAML action to
the shared package-root prelude plus one `bun "$st" <verb>` call, and port the body
message-for-message.

**Owner-shape decision to pin while resolving this group (from the 0132 run).** The 0132 Q&A entry
and the Design amendment record the reversal: use the shared `plugins/kk/scripts/kk-workflow-stages.ts`
runner with per-stage verbs when the bodies share a core (as `prepare-itc`/`prepare-solo` did), and give
a stage its own code path only when the payload genuinely differs (as `prepare-storm` did). Do not open
a fourth script file without recording why the shared runner could not carry the verb.

### Requirements

- [x] R1. `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml --json` exits 0 — zero error-level `composition.findings` (21 before: nineteen over-cap shell actions from 11 to 28 commands plus two over-cap `agent.run` inputs at 1258 / 1086 chars).
- [x] R2. Each over-cap shell action's body moves to a named owner (`plugins/kk/scripts/kk-workflow-stages.ts` `daily-*` verbs) rather than being compressed, and every delegated action keeps the same six-line package-root prelude as the other kk workflows (ADR-115 warn band, under the 10-command / 800-char error tier).
- [x] R3. The two over-cap `agent.run` prompts (`plan-translate`, `cover`) drop below the 1000-char cap and keep their operative contract: the translation rules that govern the rewrite, and the image-authoring invocation, non-interactive env, template sourcing and failure semantics.
- [x] R4. No observable behaviour change for the ported stages: same step-timing appends, cache predicates and messages, plugin argv, env channels, artifact paths and exit statuses; the fake-`kk` integration test (artifact set + call log) passes, and the repo gate stays green.

### Acceptance Criteria

```gherkin
@core
Scenario: kk-daily-ai-voice validates ADR-115 error-clean
  Given the twenty delegated shell actions (nineteen over-cap plus the in-budget publish-partial) and the two trimmed agent.run prompts
  When the file is validated with spur workflow validate --json
  Then it exits 0 with zero error-level composition findings

@core
Scenario: The ported stages preserve the deterministic half of the pipeline
  Given the shared stage runner and the delegated YAML actions
  When the fake-kk integration test drives kk-daily-ai-voice from prepare through generate
  Then every artifact path, plugin call order, plugin env channel and cache message it reaches matches the pre-0133 run
  And the publish/locale tail's call lines and argv are pinned statically (per-verb behaviour tests are tracked in 0137)
```

### Q&A

**2026-09-14 — scope and title.** This task's frontmatter name still reads "ADR-115 group 1" from the
four-group decomposition; the run absorbed groups 2-4 (cancelled as delivered-here) and ported the
whole kk-daily-ai-voice file. `spur task update` has no `--name` writer, so the historical title stays
and this entry records the real scope: 20 delegated shell bodies (19 over-cap + `publish-partial`),
2 trimmed `agent.run` prompts, 21 error-level findings → 0. The same run also harmonised the shared
prelude in kk-itc / kk-solo-podcast / kk-storm-research (realpath-based package root + checkout
fallback), which is recorded in 0132's Solution and `docs/04_DESIGN.md`.


<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Port the over-cap shell bodies into `daily-*` verbs on the shared runner, one stage per verb, keeping
   the timing append, cache predicate, plugin argv and env channel verbatim.
2. Trim the two over-cap `agent.run` prompts to bounded pointer prompts (translation contract; image
   invocation) below the 1000-char cap.
3. Retarget the workflow's static assertions at the owner the strings moved to, and extend the runner
   suite with the derivations the integration test does not pin (classify, publish-prep merge, cover
   normalize, wrap-docs id, translate scaffolds, publish-partial retry file).
4. Gate: `spur workflow validate … --json` exit 0 per file, `bun run spur-check` green, integration test
   green.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:116` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:148` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:197` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:21` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:457` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:461` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:471` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:79` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:89` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:96` |
| `apps/cli/tests/kk-itc-workflow.test.ts:71` |
| `apps/cli/tests/kk-itc-workflow.test.ts:73` |
| `apps/cli/tests/kk-solo-podcast-workflow.test.ts:131` |
| `apps/cli/tests/kk-solo-podcast-workflow.test.ts:176` |
| `apps/cli/tests/kk-solo-podcast-workflow.test.ts:178` |
| `apps/cli/tests/kk-workflow-stages.test.ts:12` |
| `apps/cli/tests/kk-workflow-stages.test.ts:16` |
| `apps/cli/tests/kk-workflow-stages.test.ts:2` |
| `apps/cli/tests/kk-workflow-stages.test.ts:41` |
| `apps/cli/tests/kk-workflow-stages.test.ts:472` |
| `apps/cli/tests/storm-research-workflow.test.ts:56` |
| `apps/cli/tests/storm-research-workflow.test.ts:58` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1159` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1221` |
| `plugins/kk/scripts/kk-workflow-stages.ts:24` |
| `plugins/kk/scripts/kk-workflow-stages.ts:28` |
| `plugins/kk/scripts/kk-workflow-stages.ts:34` |
| `plugins/kk/scripts/kk-workflow-stages.ts:374` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | command (this run): `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml --json` exits 0 — zero error-level composition findings (20 delegated shell bodies + 2 trimmed agent.run prompts landed; scope absorption of groups 2–4 documented in task Q&A, siblings 0134–0136 cancelled as redundant) |
| R2 | MET | Ported stages preserve the deterministic half: fake-kk integration test driving prepare → generate green in this run's suite (1024 pass / 0 fail) — `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` |
| R3 | MET | Publish/locale tail pinned statically: `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:152-171` re-read this run — call lines and argv match the runner verbs (`daily-publish-prep`, `daily-publish-surfdash`, `daily-show-notes`, `daily-publish-podcast`, `daily-publish-classify`, translate verbs with `surfdash_post_path`) |
| R4 | MET | Shared stage runner `plugins/kk/scripts/kk-workflow-stages.ts` owns the moved logic; validator exit 0 (this run) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: kk-daily-ai-voice validates ADR-115 error-clean | MET | command | `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml --json` exit 0 / errors 0 (this run) |
| Scenario: The ported stages preserve the deterministic half of the pipeline | MET | test | Integration test green (this run's suite); pinned tail call lines `kk-daily-ai-voice-workflow.test.ts:152-171` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Four independent passes ran on this port: one full review (disposition **REJECT** on two real defects),
two delta certifications (both APPROVE WITH FINDINGS), and two verification passes (the last
**PASS**, the one before it PARTIAL on a pre-existing defect). Every finding is closed or filed.

**Blocking findings and their fixes**

| # | Finding | Fix |
| - | ------- | --- |
| P1 | `dailyArticle` set `ART_DATE`; the pre-0133 shell set `ARTICLE_DATE`, so the article plugin never received the date | corrected, with a regression test that dumps the plugin env |
| P2 | `dailyPublishClassify` classified over whichever per-target result file existed, reporting `full` when one was missing — masking a publish that never dispatched | both files must exist or the target list is empty (`none`), matching the pre-0133 `jq -s` abort that also produced `none`; regression test added; the deliberate divergence for the missing-pair case is commented in the runner |
| P3 | `2-script` missing from `DAILY_DIRS` (the dir the script/wrap stages write into) | restored (8 entries) |
| P3 | dead `dailyCollectSources` verb (collect's fan-in stayed inline) | deleted; the runner header and §5 now say the in-budget bodies stay inline on purpose |
| P3 | task corpus claimed group-1 scope and "twelve ported actions" | Background marks the whole-file scope, R1 counts nineteen over-cap actions, the AC counts twenty delegated ones, and a Q&A entry records the superseded title |
| P3 | the sips guard treated a *failing* sips as "not found" (Bun returns `status: 1`, `undefined` only when missing) | split into missing (`error`/non-numeric status) vs failed (status N), with a test that runs with a PATH holding only `bun` |
| P3 | `kk`-missing was a silent exit 1 (the shell exited 127 with a message) | prints `kk: <errno>` and exits 127; re-thrown out of the tolerated `publish-podcast` hop so it cannot masquerade as "dispatched" |
| P2/P3 | only 8 of 20 delegation call lines were asserted | all twenty call lines plus their argv order are pinned; the prelude block is asserted exactly 20× |
| P2 | the integration test skipped silently when `spur` was absent | fails loud |
| P2 | two rubric clauses dropped from the trimmed `plan-translate` prompt | restored (prompt 885 chars, under the 1000-char cap) |
| P2 | doc/AC wording (tail coverage, prelude line count, `\u2192`) | corrected; the two remaining §5 nits are recorded below and folded into 0137 rather than edited after the verdict |

**Pre-existing defect — filed, not fixed (R4)** `daily-show-notes` reads
`${run_date}_17_publish_result.json`, which the later `publish` state writes, so the surfdash article
URL is always empty at show-notes time and the podcast timeline layout never engages. Proven
pre-existing by comparing `git show 8a5ead69:plugins/kk/workflows/kk-daily-ai-voice.yaml` with the
runner's `dailyShowNotes`/`firstPostPath` (same path, same jq selector, same empty fallback); fixing it
inside the port would have been a behaviour change, so it is task **0137** with the excerpt attached.

**Residual risk (accepted, recorded)**

- 0137 is user-visible on the live 06:00 run until it lands.
- 12 of the 20 runner verbs have no behaviour test (tail pinned statically; tracked in 0137); the
  runner sits outside every workspace `tsconfig.include` (pre-existing sidecar-surface property).
- The `kk`-missing/127 branch and the loud `spur`-absent guard are untested error paths.
- Live end-to-end (network, Voicebox, real publishers) is not covered and not claimed.
- Two §5 doc-precision nits (tail-coverage sentence, prelude line count) — recorded here and in 0137,
  deliberately not edited after the verification verdict so the certified digest still describes the
  tree.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-09-15T06:20:56.926Z todo → wip (system)
- 2026-09-15T07:27:14.179Z wip → testing (system)
- 2026-09-15T07:27:23.870Z testing → done (system)

