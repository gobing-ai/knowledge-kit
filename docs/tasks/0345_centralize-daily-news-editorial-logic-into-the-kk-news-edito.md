---
schema_version: 1
name: Centralize daily-news editorial logic into the kk:news-editorial skill
status: backlog
template: feature-impl
created_at: 2026-11-08T20:47:50.836Z
updated_at: "2026-11-08T21:40:41.588Z"

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

- [ ] R1. New skill `plugins/kk/skills/news-editorial/` owns daily-news editorial policy: selection rubric/topic
  boundary, organization, news/opinion/technical balance, style contract (with its machine block). Modes:
  `curate`, `write`, `write --fix`. AI news is a profile reference.
- [ ] R2. The style contract moves into the skill (`references/style-contract.zh.md`); the dailynews-gen validator and
  the `daily-script-style` snapshot read it from there. No behaviour change in caps/banned.
- [ ] R3. The run snapshots the skill (SKILL.md + references) into the work dir; voice3 agent.run prompts reference
  the snapshot by path (kk skills are not installed for pi/codex).
- [ ] R4. script-write gets a validator-error-driven fix retry instead of silently falling back to the template.
- [ ] R5. (later step): `curate` replaces plan-translate + prompt-level topic boundary; article/cards/social/cover render
  from the editorial master; `news-balance` rubric lands in content-judge.
- [ ] R6. ADR entry before the authority move; 03/04/05 docs updated.

### Acceptance Criteria

- [ ] AC1 — `kk stage daily-script-style` snapshots the skill and style contract from the skill path; validator reads caps/banned from it (tests).
- [ ] AC2 — A plan with validator errors triggers `script-write-fix` with the error list; a valid fix is used by `script` (scriptSource=plan).
- [ ] AC3 — `bun run gate` green.
- [ ] AC4 — E2E: a `--generate-only` voice3 rehearsal with `pi-dsv4.1-flash-volc` produces scriptSource=plan; artifact kept under .works for comparison.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

#### 2026-11-08 — steps 1–2 (R1–R4, R6)

- AC1 PASS: `bun test apps/cli/tests/kk-workflow-stages.test.ts -t "script-write stage wiring|daily-script-check"` → 8 pass / 0 fail. The snapshot covers `20-editorial/news-editorial/{SKILL.md,references/style-contract.zh.md}`, and `DAILYNEWS_STYLE_FILE` is set to the skill path.
- AC2 (unit) PASS: daily-script-check tests cover a missing plan (errors file written), a rejected plan (errors equal the validator's scriptPlanErrors and no trial build is left behind), an accepted plan (stale errors file removed) and a missing stamp (exit 1). The workflow wires script-write → script-check → script-write-fix (condition `test -s _errors.json`) → script. `spur workflow validate` passes, and `kk-daily-ai-voice-workflow.test.ts` gives 21 pass (prompts ≤1000 chars).
- dailynews-gen `script-plan.test.ts`: 28 pass. `runtime-requires.test.ts`: 4 pass (the new skill declares `[cli:kk, local-fs]`; snapshot now 19 entities, 8/5/1/5).
- AC3 PASS: `bun run gate` exits 0 with 4692 pass / 0 fail, and `spur rule run` post-check passes 2/2 rules.
- Content evidence (regen 2 of 20261108, pi + volc deepseek-v4-1-flash, generate-only): scriptSource=plan, 5 items / 3 excluded, average insight 186 chars, insight share of script 13%. The gpt-6.1-sol episodes 11-05 and 11-07 had average insights of 355 and 320 chars and shares of 24% and 19%.
- AC4 PENDING: an end-to-end rehearsal on the new wiring needs plugins/kk synced to the installed package, after regen 2 finishes.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
