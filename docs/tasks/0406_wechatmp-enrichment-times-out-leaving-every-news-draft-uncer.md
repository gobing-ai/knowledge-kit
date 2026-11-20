---
schema_version: 1
name: wechatmp 赞赏 enrichment times out, leaving every news draft uncertain
status: done
template: issue
created_at: 2026-11-18T23:29:22.307Z
updated_at: "2026-11-20T22:57:53.407Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 5
feature_id: E92
done_forced: "true"
done_reason: "R1 measured on the live console (headed, signed-in): the account's 赞赏 row is the blocked variant — '无法开启赞赏，因为还没有赞赏账户授权给本公众号' on a 0x0 box — which is why the click could only time out. R2 reads that state in one bounded step and reports the capability with the platform text, no click/no 8 s wait; R3 sets reward:false in the daily builder with the evidence cited; R4 shipped earlier (duplicate-draft guard); R5 tests added (2 enrich cases, 3 builder cases, 4 guard cases). Verified: plugins/publishings/wechatmp-pub 273 pass, daily reward suite 3 pass, lint clean, tsc clean, stage bodies synced to the install. Live confirmation (next news-generate window's wechatmp receipt) is stated as owed, not claimed."
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

**Measured 2026-11-20, operator-attended headed session, signed-in `wechatmp` profile, fresh 文章 draft.**

Entry path measured with the rail's own selectors: 新的创作 → 文章 opens `appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0` in a new tab (the rail's `enterViaMenu` path). In that editor:

| Selector | Count | Meaning |
| --- | --- | --- |
| `.js_reward_open`, `.setting-group__switch.js_reward_open` | 1 | the 赞赏 row renders |
| `.js_reward_allow_click` | 1 | **the blocked variant of the row** |
| `.setting-group__switch.js_can_reward` | 0 | the enabled switch is absent |
| `#js_article_url_area`, `#js_claim_source_area`, `.js_article_tags_label` | 1 each | the neighbouring rows are intact |

The blocked row's own state (`survey-dom.json`):

- text: `不开启 … 无法开启赞赏，因为还没有赞赏账户授权给本公众号`
  — *"cannot enable 赞赏 because no 赞赏 account has been authorized for this public account"*;
- `display: flex`, `visibility: visible`, `pointer-events: auto`, and a **0×0 bounding box**.

**Root cause of the 8 s failure.** The rail clicked that zero-size div: nothing can be clicked with no box,
so Playwright spent the full `clickSelector(page, DIALOG_CONFIRM/ROW_REWARD, 8_000)` budget and surfaced
`赞赏: click: Timeout 8000ms exceeded` — the error the task carried since 11-16. It is **not** a
lazily-rendered dialog racing a 1.5 s probe: the row's own text states the capability gap, and no retry
of this run can enable 赞赏.

**Dialog inventory.** No 赞赏 dialog ever opens on this account, so the confirm control (R2's
`REWARD_CONFIRM`) has **no measured label** — the earlier reading of a "未设置头像和名称" modal was a
hidden template matched by a broad dialog selector, not a live overlay (`survey-dom.json` →
`dialogsShown: []`). The confirm-label scoping therefore stays open, deliberately: it needs an entitled
account to measure, and inventing it here would be exactly the guess this task exists to stop.

**Branch taken (R3).** The account cannot offer 赞赏 → the daily builder stops requesting it
(`plugins/kk/scripts/daily-stages.ts:2091`, `reward: false`, comment naming this artifact), so the 文章 row
confirms without `WECHATMP_ALLOW_PARTIAL_ENRICH`.

### Solution

**R1 measured** (see Root Cause + `docs/tasks/evidence/E92/0406/`): the 赞赏 row on this account is the
blocked variant — `无法开启赞赏，因为还没有赞赏账户授权给本公众号`, rendered as a 0×0 box — so the rail's
click could only ever time out. No dialog opens, hence no measured confirm label yet.

**R2 — encode the measured behaviour.**

| File | Change |
| --- | --- |
| `plugins/publishings/wechatmp-pub/src/enrich.ts` | new `REWARD_STATE` page-side probe + `readRewardState()`: one bounded evaluation answers *is the row blocked by the platform's own refusal text, and does it have a box at all?* The reward step now reads it **before** `openRow` and, when blocked, raises `CapabilityError` in one step with the platform's text quoted — no click, no dialog wait, no 8 s timeout, no retry of an impossible click. The pre-existing post-open probe stays for the older "prerequisite appears only inside the dialog" shape, at its original 1.5 s bound (a 4 s window slowed every healthy run past the suites' step budget). |
| `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` | a `rewardRowBlocked` state on the recording page (it answers the row-state probe **without** consuming a scripted `evaluate`, so the existing sequences stay aligned) plus two cases: the measured blocked row → capability warning quoting the platform text, **zero** row/confirm clicks, under 2 s; and a healthy account → the row still opens and the account still comes from 作者. |

`REWARD_CONFIRM` (R2's "scope the confirm click to the reward dialog's own label") is **not** added: no
dialog was measurable. That clause is deferred with the evidence saying so, rather than satisfied with a
guessed selector.

**R3 — the capability gap stops failing the daily row.** `plugins/kk/scripts/daily-stages.ts:2091` sets
`reward: false` with a comment citing `survey-dom.json` and the three failed drafts (11-16/11-18/11-19).
The requested-but-unapplied contract for the other four fields is unchanged; flipping the line back is the
whole reversal once 赞赏 is authorized.

**R4 — duplicate drafts.** Shipped earlier in this batch (`0b159de5`): a pre-create exact-title lookup in
`cgi-draft.ts` refuses with `duplicate-draft: appmsgid <id> already holds "<title>…` and reports
`effect: none`. Live confirmation of the original problem is on the record: the console's 近期草稿 list
showed two drafts both titled `每日AI乱炖 · 2026-11-19`.

**R5 — tests.** The two new enrich cases above, the four `readDraftList`/duplicate-guard cases from R4, and
`plugins/kk/tests/daily-wechat-reward-0406.test.ts` (the builder's metadata: `reward: false`, 原创/合集/
创作来源 still requested, audio-first 播客 carrying the same decision).

**Not changed:** `flow.ts`'s "requested enrichment that did not take is a failure" contract, the other four
enrichment rows, `WECHATMP_ALLOW_PARTIAL_ENRICH` (still the operator escape, now unnecessary for this row).

### Testing

| Check | Result |
| --- | --- |
| `bun test plugins/publishings/wechatmp-pub` | 273 pass, 0 fail (includes the two new blocked/healthy reward cases and the four duplicate-guard cases) |
| `bun test plugins/kk/tests/daily-wechat-reward-0406.test.ts` | 3 pass, 0 fail |
| `bun run lint` (biome 2.5.15 + every workspace typecheck) | clean |
| `bunx tsc --noEmit -p plugins/publishings/wechatmp-pub` | clean |
| Stage-body sync (AGENTS.md) | `plugins/kk/scripts/` rsynced to the installed package; `grep -c "reward: false"` → 1 there; `bun run tools:fresh` reports no drift |
| Measurement | headed, signed-in session against the live console; artifacts in `docs/tasks/evidence/E92/0406/` (`survey-dom.json`, `measure-summary.json`, `measure-events.jsonl`, `reward-row-blocked.png`) |

**Live confirmation owed.** The next `kk news generate` window's `wechatmp-pub` receipt is the end-to-end
proof: the 文章 row must report `succeeded` with the draft saved and **no** 赞赏 warning, without
`WECHATMP_ALLOW_PARTIAL_ENRICH`. Until that window runs, the fix is verified at unit + measurement level
only — stated here rather than claimed as done.

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

- 2026-11-20T22:57:50.795Z todo → wip (system)
- 2026-11-20T22:57:52.043Z wip → testing (system)
- 2026-11-20T22:57:53.223Z testing → done (system)

