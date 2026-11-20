---
schema_version: 1
name: wechatmp 赞赏 enrichment times out, leaving every news draft uncertain
status: todo
template: issue
created_at: 2026-11-18T23:29:22.307Z
updated_at: "2026-11-20T00:28:50.033Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 5
feature_id: E92
---

## 0406. wechatmp 赞赏 enrichment times out, leaving every news draft uncertain

### Background

Captured from the creation title: "wechatmp 赞赏 enrichment times out, leaving every news draft uncertain".

**Refine corrections (2026-11-19)**

- **Still valid on the new workflow.** The `wechatmp-pub / 文章 / article` row (`plugins/kk/publish-presets/daily-ai-voice.json:50-60`, tier 2, mode `draft`) is a live part of `kk news publish`. The failure reproduced on 11-16, 11-18 and 11-19. Each time the draft was saved only with the operator escape `WECHATMP_ALLOW_PARTIAL_ENRICH=1` (`.spur/context/memory.md:307,316`). No commit to `plugins/publishings/wechatmp-pub` since 2026-11-17 touches the 赞赏 path (`git log --since=2026-11-17`).
- **Failure mechanics, re-traced.** `enrichArticle` (`src/enrich.ts:258-300`) clicks the 赞赏 row (`ROW_REWARD`, 39-45), probes **1.5 s** for a capability-blocked dialog (`前往开通` / `无法开启`, 266-270), optionally fills the account, then clicks the generic `DIALOG_CONFIRM` (`= CONFIRM`, 30, 49) with an 8 s timeout (290). The receipt error `赞赏: click: Timeout 8000ms exceeded` is that confirm click. The 2026-11-16 session diagnosed the 1.5 s probe as racing a lazily rendered dialog (`memory.md:307`). If the account lacks a 赞赏账户, the blocked dialog has no 确认/确定 button, so the probe miss turns a capability refusal into an 8 s timeout. That hypothesis is **unverified**: the timing fix was reverted (file owned by another agent), and "dialog never opened" or "confirm label changed" remain possible.
- **A correct capability classification still fails the row today.** A `CapabilityError` is reported once as a warning (`enrich.ts:194-200` step contract; header 21). Every warning reaches `enrichWarnings`, and `flow.ts:2631-2636` (bec762a2, 2026-11-15) turns any warning into `ok:false` unless `WECHATMP_ALLOW_PARTIAL_ENRICH=1`. If the account truly cannot reward, the only clean fix is to stop requesting it. The daily pipeline sets `reward: true` unconditionally at `plugins/kk/scripts/daily-stages.ts:2079`.
- **Duplicate drafts confirmed, cause narrowed.** 4 drafts on 11-18 and 3 on 11-19 ("3 drafts now exist in the console", `memory.md:316`). The matrix never resends a live row with an unknown effect (`apps/cli/src/publish-matrix.ts:1511-1530`), but this row fails as `ok:false` with a saved draft, so each operator or `--retry` re-run creates a new draft. The CGI create (`src/cgi-draft.ts:429-551`) has no pre-create lookup, although the same file already reads the draft list for its readback (505-545).
- **Evidence paths.** `.works/kk-news-generate/20261118/4-publish/receipts/wechatmp-pub.文章.json` is not on disk. The quoted error comes from the original report and the session log.

**Refine corrections (2026-11-19, second pass)**

- **The account had 赞赏 on 2026-10-21.** 0318's live acceptance (commit 61263694; Testing R4 in `docs/tasks/0318_*`) observed reward checked and "the active 赞赏 account row after original declaration". The R3 "account lacks 赞赏" branch is therefore unlikely. The expected R1 outcome is "entitled, confirm-dialog drift since the v2 editor (30202fcd)". R3 stays conditional and is still decided only by R1's evidence: entitlement can lapse.
- **This task inherits the live residual of cancelled task 0260** (E92), the old-workflow wechatmp enrichment repair. Linked to E92, the same owner as 0260/0318.

### Requirements

- [ ] R1. — Measure the 赞赏 surface before changing selectors. Run one operator-attended headed session on the signed-in profile (`kk bot open` / the recorded-event harness used 2026-11-16, events + screenshots under `.spur/run/dogfood/<date>-wechatmp-reward/`). Click the 赞赏 row on a fresh 文章 draft and record: (a) whether a dialog or popover opens and after how long; (b) whether it shows the account field or the 开通 prerequisite; (c) the exact confirm control (label + selector). The findings go in Root Cause with the artifact paths.
- [ ] R2. — Encode the measured behavior. Update `ROW_REWARD`, the capability probe and the reward-dialog confirm in `src/enrich.ts` from R1 evidence only. The probe waits on the dialog's **mounted** state, not a fixed 1.5 s. A blocked account yields `CapabilityError` within one step (no 8 s confirm wait). The confirm click is scoped to the reward dialog's own label, as `ORIGINAL_CONFIRM` / `CLAIM_CONFIRM` already are.
- [ ] R3. — A capability-blocked account must not fail the daily row. If R1 shows the account lacks a 赞赏账户, the daily pipeline stops requesting `reward` (`daily-stages.ts:2079` → `reward: false`, with a comment citing the R1 evidence), so the row confirms without `WECHATMP_ALLOW_PARTIAL_ENRICH`. A requested-but-unapplied field still fails the row (the 2026-11-15 contract stays).
- [ ] R4. — No duplicate draft per run. Before creating, the 文章 draft path looks up the draft list for an item with the same title. If one exists, it returns `ok:false`, `effect: none`, error `duplicate-draft: appmsgid <id> already holds "<title>" — delete it or finish it in the console`, and creates nothing.
- [ ] R5. — Regression tests. Fixture/fake-page tests cover a slow-mounting blocked dialog → capability within the bound, a measured confirm label → reward committed, the duplicate-title refusal before create, and the daily metadata carrying `reward: false` once R3 applies.

**Non-goals:** opening a 赞赏账户 (operator/platform action); changing other enrichment rows (原创, 合集, 原文链接, 创作来源); the 播客 row (mode `off`); reusing/editing an existing draft (refusal only, see Q&A).

### Acceptance Criteria

```gherkin
Scenario: AC1 — The reward surface is measured, not guessed (req: R1)
  Given the operator-attended headed session on a fresh 文章 draft
  When the 赞赏 row is clicked
  Then Root Cause records dialog-vs-popover, mount latency, account-field-vs-开通 state and the confirm selector, with events.jsonl and screenshot paths

Scenario: AC2 — A blocked account is classified fast (req: R2)
  Given a fake page whose reward dialog mounts after 3 s showing 前往开通
  When enrichArticle runs with reward requested
  Then it reports the capability refusal without an 8 s confirm timeout

Scenario: AC3 — An enabled account commits reward (req: R2)
  Given a fake page with the measured dialog and confirm label
  When enrichArticle runs
  Then the reward committed state reads true and no 赞赏 warning is emitted

Scenario: AC4 — The daily row confirms when reward is not offered (req: R3)
  Given R1 showed the account cannot offer 赞赏 and the daily builder sets reward false
  When the article variant metadata is built and the 文章 row runs
  Then no 赞赏 step runs, and the 文章 row result is ok without WECHATMP_ALLOW_PARTIAL_ENRICH

Scenario: AC5 — A second run does not create another draft (req: R4)
  Given the draft list already holds an item titled like the payload
  When the 文章 draft operation runs
  Then it returns ok false with effect none naming that appmsgid, and the create POST is never sent

Scenario: AC6 — The suite pins the fixes (req: R5)
  Given the new wechatmp-pub tests
  When they run against the pre-fix code
  Then AC2 and AC5 fail, and all pass after the fix with bun run test at per-file coverage of 90% or more
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-20T00:23:06.756Z

- **Q: Reuse the existing draft instead of refusing? A (closed 2026-11-19):** refuse. The flow is written for a fresh draft ("Runs on a FRESH draft only", `enrich.ts:140`). Editing a half-enriched draft would need state-aware toggles that do not exist. A refusal with the appmsgid is honest and has no side effect.
- **Q: Where does the reward opt-out live? A (closed):** in the daily builder itself (`daily-stages.ts:2079`, where `collection` is also fixed). It is a measured account fact that changes rarely, so it needs no config key. A preset-row `options.reward` would not work: the matrix merges `options` shallowly at the **top** of metadata (`apps/cli/src/publish-matrix.ts:742-746`), while the plugin reads `metadata.wechatmp.*` (`src/flow.ts:1315`). Not an env flag on the plugin either: it must keep failing on a requested-but-unapplied field. If 赞赏 is opened later, flip the line back.
- **Q: Can R2 proceed without R1? A (closed):** no. Selectors come only from measured evidence (drift tasks 0260/0272/0318 precedent). R1 needs the operator at a headed browser; the implementer schedules it and stops at R1 if no session is available.

### Design

**WHAT.** Measure, then fix the 赞赏 step's probe and confirm. Give a reward-incapable account a clean opt-out. Refuse duplicate drafts.

**WHY.** The 2026-11-15 "unapplied enrichment fails the row" contract is right, but a mis-timed probe makes a capability gap look like a timeout. The only workaround (`WECHATMP_ALLOW_PARTIAL_ENRICH=1`) hides real failures on the other four fields. Each failed run also leaves another draft behind.

**WHERE (frozen).**

| Piece | Location |
| --- | --- |
| Measurement artifacts | `.spur/run/dogfood/<YYYY-MM-DD>-wechatmp-reward/` (events.jsonl, screenshots); summary in Root Cause |
| Probe + confirm | `plugins/publishings/wechatmp-pub/src/enrich.ts:258-300`. New constant `REWARD_CONFIRM` (measured label, dialog-scoped) replaces `DIALOG_CONFIRM` at 290 only. The probe waits for the dialog container's mount, then inspects its content. |
| Reward opt-out (only if R1 shows no 赞赏账户) | `plugins/kk/scripts/daily-stages.ts:2079`: `reward: false` with a comment citing the R1 artifact path and date. |
| Duplicate guard | `src/cgi-draft.ts`: extract the draft-list request already used by the readback (505-545) into a helper and call it before the create POST. Wire it on the 文章 draft path only. |
| Tests | `plugins/publishings/wechatmp-pub/tests/` (enrich + cgi-draft fakes); daily-stages test for the opt-out |

**Anti-patterns.** No guessed selectors. No longer blanket timeouts in place of a mount wait. Do not downgrade requested-field failures to warnings. Do not touch the 原创 dialog's own `js_reward_switch` (`enrich.ts:37-38`).

### Plan

1. **R1 (operator-attended).** Schedule the headed session; record the artifacts and fill Root Cause. If the account lacks 赞赏, mark R3 required. If no session is available, stop here and report blocked on R1.
2. **R5 tests first.** Add the fake-page cases (slow blocked dialog, measured confirm), the duplicate-title case and the opt-out case. Confirm they fail on the current code.
3. **R2.** Change the probe and `REWARD_CONFIRM` in `enrich.ts`.
4. **R4.** Extract the draft-list helper in `cgi-draft.ts` and add the pre-create guard.
5. **R3 (conditional on R1).** Set `reward: false` at `daily-stages.ts:2079` with the evidence comment, and update the daily-stages test expecting `reward: true`.
6. **Gate.** `bun run lint`, `bun run test`, `bun run build`. Rsync `plugins/kk/scripts/` to the installed package, then `bun run tools:fresh` (AGENTS.md § stage bodies).
7. **Live check (operator).** The next after-generate window produces one draft with `succeeded/confirmed`, without `WECHATMP_ALLOW_PARTIAL_ENRICH`. Delete the stale 11-18/11-19 duplicate drafts in the console.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/publishings/wechatmp-pub/src/enrich.ts:21,29-60,140-200,258-300`; `src/flow.ts:2615-2640`; `src/cgi-draft.ts:423-551`.
- Pipeline metadata: `plugins/kk/scripts/daily-stages.ts:2079`; preset `plugins/kk/publish-presets/daily-ai-voice.json:50-60`.
- Matrix resend rules: `apps/cli/src/publish-matrix.ts:1511-1530`.
- Observation for the implementer (not in scope, unverified end to end): the preset row's `options.collection` (`daily-ai-voice.json:57`) lands at top-level `metadata.collection`, which the plugin does not read; the effective collection comes from `daily-stages.ts:2081`. Confirm before relying on preset options for wechatmp.
- Prior drift tasks: 0260, 0272, 0318 (measured-selector precedent); commit bec762a2 (enrichment-fails-row).
- Session evidence: `.spur/context/memory.md:307,316`.
- Concurrency check before starting: `git worktree list`, `spur task list --status wip --json`.

- Predecessors: 0260 (cancelled 2026-11-19, superseded), 0318 (done; 2026-10-21 live acceptance incl. 赞赏), 0272 (done). Owner feature: E92.

### History
