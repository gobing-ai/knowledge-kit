---
schema_version: 1
name: Calibrate daily topic filters and report candidate losses
status: done
template: feature-impl
created_at: 2026-11-18T04:42:14.699Z
updated_at: "2026-11-18T12:43:50.315Z"
feature_id: L3
priority: P1

estimate_hours: 7
done_forced: "false"
done_reason: unforced close
---

## 0392. Calibrate daily topic filters and report candidate losses

### Background

Code floor is leadership/date only (plugins/kk/scripts/topic-boundary.json:1), but the Agent still excludes entire public-affairs classes (plugins/kk/skills/news-editorial/SKILL.md:46). Existing QC writes exclusion evidence only on hits. The normal report is behind the pool gate (apps/cli/src/commands/content-generate.ts:418).

### Requirements

- [x] R1. Inventory every selection filter and platform gate, including adult content, gambling, drugs, domestic politics and leadership. Reproduce overly broad matches using historical and contrast fixtures, including an AI-relevant public-policy story. Keep actual platform restrictions enforced.

### Acceptance Criteria

- [ ] R14 — 过滤规则按内容风险校准并在最终报告留证

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.953Z

**Ready decisions.** Own QC/curation rule calibration and the final report projection. Keep verified platform admission gates in place. Correct wide editorial category exclusions with tagged historical and counterexample samples. Keep one versioned per-attempt counts artifact and consume it on ordinary and no-content report paths. Document whether each counter is unique IDs or rule hits; leave missing stage evidence unknown. Hand the revised editorial policy to 0385.

**Source premise.** `plugins/kk/skills/news-editorial/SKILL.md:46` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Assert counts reconcile after retries, zero kept, multiple hits and skipped stages. Pair a relevant industry/public-policy item with a hard-rule hit.

### Design

Code owns versioned rule checks and deterministic counts. Agent owns context and attribution. Keep current confirmed hard constraints pending an explicit policy decision, and keep publication admission per channel. Reuse the QC artifact and news-report-gen. Record reconciled stage counts, unique exclusions, per-rule hits and decisions plus no-content diagnostics. Capture raw pre-filter counts before mutation. Bind evidence to attempt and fingerprints so retries do not erase results or inherit stale reasons.

### Plan

- [ ] Build replay fixtures for policy and editorial overlap, clear versus incidental matches, multiple hits, and zero survivors. Audit the shipped skill and legacy report cases against current invocations. Calibrate on labeled examples before changing narrow rules. Run generation and report for passing and empty cases, including cached reruns, and leave inspectable Markdown plus JSON evidence.

### Solution

One versioned rule surface, one counts ledger, one policy text — and an honest inventory.

**R1 — inventory (all four filter layers, named class by class).**
1. Deterministic selection rules: `plugins/kk/scripts/topic-boundary.json` (v2, unmodified) — only the
   `prc-leadership` keyword rule and the future-date `dateConflict` check run in code
   (`daily-stages.ts:207-240`), on a 200-char window. Nothing else is mechanical.
2. Editorial topic boundary (agent prose): `plugins/kk/skills/news-editorial/SKILL.md:46-55` — retuned by
   this task. It is a policy, and the writers never read that file: they read the prompt scalars of the
   daily workflows, which shipped the wide 0189 exclusion verbatim. Both are now one text (below).
3. Platform admission gates (content-safety): `plugins/kk/skills/content-safety/SKILL.md:33-40` category 2
   plus the per-channel files (`references/platforms/{xiaoyuzhou,wechatmp,xhs}.md` XY-02 / WX-01 / XH-06).
   Inventoried, **intentionally kept**: they are platform rules, not editorial preference.
4. **黄赌毒 (adult content / gambling / drugs) — the honest answer: nothing enforces it anywhere.** No rule
   in `topic-boundary.json`, no row in the content-safety category table, no mention in any
   `references/platforms/*.md`, and `grep -riE '黄赌毒|色情|赌博|毒品|porn|gambl|adult' plugins/kk/skills
   plugins/kk/scripts apps/cli/src` returned nothing. It is not a sub-case of category 2, so an
   adult/gambling/drug story whose subject is an AI product passes every rule in force. Per the R1 scope
   ("identify current enforcement location and originating policy") this task records the gap and ships
   **no** filter (no observed harmful miss; an unvetted keyword list would block AI stories that mention
   addiction treatment or betting-market models). The finding is now visible to the admission reviewer in
   `plugins/kk/skills/content-safety/SKILL.md` (the "Unpoliced class" note under the category table).

**The retuned boundary (one text, four surfaces).** Keep the hard line (`prc-leadership`, `dateConflict`
in code — never re-admit); keep excluding a story whose mainline IS the political actor, an armed conflict
or a non-AI event; **admit AI-subject public policy** (AI regulation, model liability/litigation, export
controls, procurement, standards and safety enforcement). `news-editorial/SKILL.md:46-55` is the source;
the same sentence now ships verbatim in `kk-daily-ai-voice.yaml` (article-write, script-write, xhs-write)
and its voice2 twins, in the English cover-brief prompts, and in
`news-editorial/references/style-contract.zh.md:12-15` (the contract `script-write` reads).
`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` pins it: each workflow must carry the sentence three
times, the retired blanket skip clause must be absent from both workflows and the contract, and SKILL.md +
contract must name the same admitted classes. Reverting the policy in one place now fails.

**R14 — evidence in the final report.** One artifact per run day,
`21-plan/topic-selection-attempts.json` (`version: 1`, `specVersion`, append-only `attempts[]`,
`reconciliation`), written on every QC invocation, appended on retries, never inferring a missing stage as
zero (`observed` | `unknown`). Both report paths consume it: the ordinary `## Topic selection` section and
the `no-content` reason line. The reconciliation identity is `preFilter = kept + uniqueExcluded + deduped`
(`topic-selection-attempts.ts:196-220`) — `kept` is post-dedup, so omitting the near-duplicate drops made
every dedup day publish a false MISMATCH. `noContentReason` now appends the counts note to **all four**
branches: post-synthesis duration refusal, script-gate refusal, pre-spend floor refusal, and the generic
fallback (`apps/cli/src/commands/daily.ts:546-588`) — the R14 motivating shape (4-item pool → 3 kept,
8.9 min vs a 15 min floor) is a duration refusal, and it was the one branch that carried no counts.

**Calibration evidence.** `plugins/kk/tests/fixtures/topic-selection-cases.json` (2 `historical` +
6 `counterexample` cases, including an AI-subject export-licensing story) replayed against the spec in
force by `plugins/kk/scripts/topic-selection-calibration.ts`; re-adding the old wide `policy-dispute` rule
turns the replay red. **Handed to 0385** (the board's editorial projection) — not implemented here.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — inventory every selection filter and platform gate (incl. adult content, gambling, drugs, domestic politics and leadership); reproduce overly broad matches with historical + contrast fixtures incl. an AI-relevant public-policy story; keep actual platform restrictions enforced | MET | All four layers named class by class: deterministic rules `plugins/kk/scripts/topic-boundary.json:6,28` (unmodified; only `prc-leadership` + `dateConflict`, enforced at `plugins/kk/scripts/daily-stages.ts:207-240`); editorial policy `plugins/kk/skills/news-editorial/SKILL.md:46-55` now shipped verbatim at the surfaces writers actually read (`plugins/kk/workflows/kk-daily-ai-voice.yaml:236,264,301,485`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:394,468,532,773`, `plugins/kk/skills/news-editorial/references/style-contract.zh.md:12-15`); platform gates inventoried and kept (`plugins/kk/skills/content-safety/SKILL.md:39` + `references/platforms/*.md`); 黄赌毒 recorded as unpoliced with no invented filter (`plugins/kk/skills/content-safety/SKILL.md:44-54`). Fixtures: 2 `historical` + 6 `counterexample` incl. the AI-police export-control story `plugins/kk/tests/fixtures/topic-selection-cases.json:41-55`, replayed by `plugins/kk/scripts/topic-selection-calibration.ts:76-104`; re-adding a wide `policy-dispute` rule turns the replay red `plugins/kk/tests/topic-selection-calibration.test.ts:67-79`; a one-surface prompt revert fails `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:979-1045` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R14 — 过滤规则按内容风险校准并在最终报告留证 | MET | test | Calibrated policy at every operative surface (rows above) with the "no bare 感觉不合适 reason" rule `plugins/kk/skills/news-editorial/SKILL.md:53-54`. Evidence artifact `21-plan/topic-selection-attempts.json` (versioned, append-only, `unknown` never 0) written on every QC invocation `plugins/kk/scripts/daily-stages.ts:248-270`; identity `preFilter = kept + uniqueExcluded + deduped` with null ⇒ unproven `plugins/kk/scripts/topic-selection-attempts.ts:213-227`; both report paths consume it — ordinary section `apps/cli/src/topic-attempts.ts:103-113` appended at `apps/cli/src/commands/daily.ts:745-748`, no-content note on all four branches `apps/cli/src/commands/daily.ts:553,576,581,588`. Fresh evidence: dedup day reconciles end to end `apps/cli/tests/kk-workflow-stages.test.ts:956-1003` (1 pass), dedup/mismatch/unproven unit cases `plugins/kk/tests/topic-selection-calibration.test.ts:182-233` (suite 27 pass / 0 fail), duration-refusal + script-gate notes `apps/cli/tests/commands/daily.test.ts:396-436` (suite 99 pass / 0 fail) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T10:26:12.985Z todo → wip (system)
- 2026-11-18T12:43:49.727Z wip → testing (system)
- 2026-11-18T12:43:50.311Z testing → done (system)

