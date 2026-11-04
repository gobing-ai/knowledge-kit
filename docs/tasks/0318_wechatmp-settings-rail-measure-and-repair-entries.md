---
schema_version: 1
name: "wechatmp 文章 settings rail: measure and repair 原创/创作来源/原文链接 entries"
status: done
template: issue
created_at: 2026-10-22T03:08:10.155Z
updated_at: "2026-11-04T06:27:25.652Z"

priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 0318. wechatmp 文章 settings rail: measure and repair 原创/创作来源/原文链接 entries

### Background

Historical incident: the October 19–21 daily drafts reported uncommitted 原创/创作来源 and a missing 原文链接 field. Task 0318 subsequently repaired the settings rail and was closed with recorded verify PASS. It is already `done`; the checked R/AC items below describe delivered acceptance, not a new implementation assignment.

Current source of truth: `plugins/publishings/wechatmp-pub/src/enrich.ts`, its production Chromium fixtures in `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts`, and the dated repair entry in `docs/design/wechatmp-ui-discovery.md`. Historical live screenshots, probe JSON and verify receipts were lost in the October 22 cleanup, as recorded in References. Current source/fixture inspection cannot recreate that live evidence or the pre-fix red run.

**Refine corrections (2026-11-03)**

- Entry-only diagnosis → the original switch also has hidden undeclared/declared twins → require the switch whose parent belongs to the visible row branch.
- Original icon opener and assumed default radio → shipped content-info/title opener and explicit 文字原创 label selection → freeze the implemented controls and preserve an already checked agreement.
- 原文链接 still unmeasured → discovery documents the row expander and separate URL popover → replace speculative measurement work with the implemented field/anchor/readback contract.
- 赞赏 awaiting a future daily run → production reward step and Chromium sequence already exist → retain completed acceptance and remove the implementation handoff.
- Ambiguous fixture path and AC-to-plan mapping → full plugin paths and R1–R5 mappings → specify observable revalidation checks.
- Old live receipts treated as available proof → References explicitly marks them LOST → distinguish historical acceptance from current reproducible offline evidence.
- Open repair handoff → all five issues are already-fixed in a done task → preserve completed R/AC history, status, priority P2 and historical estimate 4h; do not cancel, reopen or delegate duplicate work.
- Missing feature link → E92 is a relevant umbrella by its Scope, not an assigned parent → report the orphan warning without changing feature_id or any feature lifecycle.

Root Cause, Solution, Testing, Review and older References below remain historical implementation/verification records; their old future-tense wording and line numbers are not a new work queue.

### Requirements

- [x] R1. 原创: open the row's measured content-info/title entry, explicitly select 文字原创, click the hidden agreement's label only when unchecked, commit with 确定, and after close read the checked switch in the visible row branch under #js_original. A failed readback produces a named warning; an already committed setting is not reopened.
- [x] R2. 创作来源: open #js_claim_source_area .allow_click_opr, select the exact requested nested radio text, commit with 确认, and verify both the enabled checkbox and exact normalized .js_claim_source_selected text. An unavailable stance is a named skip with cleanup.
- [x] R3. 原文链接: open #js_article_url_area .js_article_url_allow_click, fill the visible URL popover's input.js_url[name="source_url"], commit its 确定 anchor, wait for popover closure, then verify the row checkbox and exact requested URL. Exact existing values skip entry; refused commits or moved fields warn and release the popover.
- [x] R4. 赞赏: after 原创 commits, use the reward row and its own committed checkbox probe to verify enabled reward, or name the platform capability refusal. Preserve already committed reward and fill an empty author-account field only when requested.
- [x] R5. Regression: plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts drives production enrichArticle through wrapPlaywrightPage and tests/fixtures/wechatmp-dom-runner.ts in real isolated Chromium. Cover hidden twin switches, hidden/prechecked agreement, exact/unavailable claim, delayed/refused/moved URL field, committed skips and reward readback. Historical pre-fix failures remain recorded in Testing; their deleted logs are not fresh evidence.

All five items are already-fixed, retained as completed acceptance history. No remaining implementation is delegated by this refinement. Out of scope: audio/cover, collection behavior, payment, workflow/news recovery, other publishing channels, live editor mutation and publishing. No new API, dependency, schema or configuration.

### Acceptance Criteria

- [x] AC1 — 原创 commits and re-reads as checked (req: R1)
  Given a requested original declaration and hidden twin row templates, when production enrichment runs in the real-Chromium fixture, then it selects 文字原创, satisfies only an unchecked agreement through its label, commits with 确定 and reads the checked switch in the visible row branch after close. A prechecked agreement remains checked.
- [x] AC2 — 创作来源 commits with its own confirm (req: R2)
  Given claimSource 个人观点，仅供参考, when the fixture rail runs, then the exact nested radio text is selected and committed with 确认, and the row checkbox and normalized text match after close. An unavailable stance warns once and leaves no dialog.
- [x] AC3 — 原文链接 entry is measured, then committed (req: R3)
  Given originalUrl and the documented row expander/popover shape, when the fixture rail runs, then the URL is filled, its 确定 anchor commits, the popover disappears and the row checkbox/value match exactly. Delayed commit succeeds; refusal or missing field warns and closes the popover; an exact committed URL is not reopened.
- [x] AC4 — a committed 原创 unblocks 赞赏 (req: R4)
  Given original and reward requests in the fixture, when original commits, then reward commits and its own checkbox reads checked. An already committed row is not toggled, and inability to commit produces a named warning rather than success.
- [x] AC5 — the fixture regression fails on the pre-fix entries (req: R5)
  Given plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-dom-runner.ts and the production rail, when the existing 0318 and AC4 tests run, then their assertions observe real Chromium control actions, committed state and overlay cleanup. Historical pre-fix failures were recorded in Testing; their deleted receipts are unavailable for a fresh red-baseline claim. This audit revalidates only the current passing implementation.

All scenarios use plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts. Checked status is retained historical acceptance; this documentation audit does not record a new live verification verdict.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-04T06:26:46.742Z

Closed decisions (2026-11-03): the explicit inline ready audit applies to an already done task. All R1–R5 are already-fixed, so retain completed acceptance history and status; the backlog/todo cancellation rule does not apply. No implementation handoff, metadata estimate change, feature assignment or live editor mutation is authorized by this refine. E92 is contextual only. Historical live/red-baseline receipt loss is acknowledged, not reconstructed from offline fixtures. No open design decision remains for this scope.

### Design

WHAT / WHY — Preserve the delivered settings-rail contract: measured entries, distinct confirmation vocabulary and committed values after close prevent false success and duplicate toggles. This is a completed-task audit; no new API or product change is proposed.

WHERE — `plugins/publishings/wechatmp-pub/src/enrich.ts` exports `enrichArticle(page: WechatPage, meta: Record<string, unknown>): Promise<string[]>`. The production caller is `enrichArticleDraft` in `src/flow.ts`; it merges enrichment warnings into the draft flow. Fixtures execute the same implementation through `wrapPlaywrightPage`, rather than mocking the controls under test.

Frozen implemented names and order:

1. Only requested metadata fields activate steps. Each step reads the committed state first; matching state skips interaction. Original precedes reward; URL and claim use their own controls and readback.
2. `ROW_ORIGINAL`: `#js_original .setting-group__content-info` / `.setting-group__title`. Select `label:has(.js_original_type_radio):has-text("文字原创")`; click `label.original_agreement` only with an unchecked checkbox; `ORIGINAL_CONFIRM` is visible-dialog 确定. `COMMITTED.original` finds the row switch whose parent has client rectangles, excluding hidden twin branches.
3. `ROW_REWARD` retains the implemented row fallback list. `COMMITTED.reward` reads the reward setting's checkbox, not the original switch. Capability refusals are named, not treated as success.
4. `ROW_URL`: `#js_article_url_area .js_article_url_allow_click`; `URL_POPOVER`: `.popover_inner:has(.popover-article-setting__content):visible`; `URL_INPUT`: its `input.js_url[name="source_url"]`; `URL_CONFIRM`/`URL_CANCEL`: its `a.jsPopoverBt` anchors with exact 确定/取消 text. Wait for hidden before reading the row's `.js_url_checkbox` and `.article_url_setting`.
5. `ROW_CLAIM`: `#js_claim_source_area .allow_click_opr`; select the exact nested requested radio text; `CLAIM_CONFIRM`: visible-dialog 确认. `CLAIM_COMMITTED` requires enabled checkbox plus requested normalized text.
6. Reuse `step`'s one bounded retry with cleanup and committed-state reread; capability failures warn once. Residual overlays/readback failures remain named diagnostics. Do not substitute speculative selectors, hidden input check(), unscoped first-match probes or click-only success.

Dependencies: no new prerequisite task or metadata dependency. 0260/0272 are historical context, not unfinished prerequisites for this delivered repair. E92's channel UI fidelity Scope is relevant context; 0318 has no feature_id and this audit does not assign one. All five issue findings are already-fixed; any newly reproduced defect needs its own scoped follow-up.

Environment/concurrency: audit uses checkout source and isolated Chromium, not the globally installed kk bundle or an authenticated editor. The G15 worktree and pre-existing main-tree edits remain outside this audit. No installed runner synchronization or live acceptance is required for this documentation-only correction; historical live acceptance is not rerun.

### Plan

Completed-scope revalidation, not an implementation queue:

1. [x] R1/R2: inspect measured original/claim entries, distinct confirm labels, visible-branch original readback and exact claim readback in src/enrich.ts; trace src/flow.ts caller.
2. [x] R3: compare URL expander/popover/anchor/readback with the dated 0318 repair in docs/design/wechatmp-ui-discovery.md; remove the obsolete unmeasured-entry premise.
3. [x] R4: inspect original-before-reward ordering and the reward-specific checkbox/account readback; preserve already-committed skips and named refusals.
4. R1–R5: run existing real-Chromium tests in plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts matching `0318:|AC4:`. Persist the outcome in the dated readiness report; distinguish fixture proof from deleted historical live/red-baseline evidence. Do not alter tests to force a pass.
5. Run `spur task check 0318 --as todo --json` and review the task-only diff. Keep status done, existing metadata and checked acceptance history. Record the orphan feature warning without assigning a parent.

No production implementation, new tests, full repository gate, live browser action or publication is part of this refine. If the focused checks expose a regression, report it with evidence rather than silently handing off the old repair as new work.

### Root Cause

Committed on 2026-10-21 (fix `45ba558`): the rail's committed-value probe for 原创 was an unscoped
`document.querySelector('#js_original, .js_ori_setting_checkbox')` (`enrich.ts`, `COMMITTED.original`),
and the open 原创 dialog carries the same `.js_ori_setting_checkbox` class on its own template input.
`document.querySelector` returns the FIRST match in document order, so once any dialog had rendered the
probe read the dialog's state, not the row's — the measured fresh page read `checked: false` there, the
"already committed → never reopen" guard never fired, and the daily draft re-entered the dialog while
the post-read asked the same wrong question (hence `原创声明未生效，请手动设置` on drafts whose rail had
already clicked 确定). Scoped to `#js_original input.weui-desktop-switch__input`, verified against the
live editor (probe 6 evidence `.spur/memory/evidence/20261021-wechatmp/wechatmp-probe6-20261021.json`).

Same class on the dialog-entry rows (no production change, evidence in the same probe): `claim.openedBy`
= `#js_claim_source_area .frm_checkbox_label` resolved but produced **no dialog** (the live entry is
`.allow_click_opr`); the 原创 row's dialog opens from the row's own content-info, not the old
`.js_edit_ori` rail. `ROW_CLAIM`/`ROW_ORIGINAL`/`ROW_URL` keep their measured descendants until the
repair lands — the rail's `openRow` retries once and sweeps, which is why today's run warned instead of
hanging.

### Solution

Settings rail repaired and accepted against a fresh live editor; final repository gates are recorded in Testing.

- `plugins/publishings/wechatmp-pub/src/enrich.ts:27` uses the measured 原创 row-content/title entries, the hidden agreement label only when unchecked, and its own 确定 control. `plugins/publishings/wechatmp-pub/src/enrich.ts:95` fixes the remaining first-match trap: BOTH undeclared/declared branches keep hidden switch inputs, so the committed probe selects the input whose switch parent is in the visible row branch. It stays scoped below the row and never reads a dialog template.
- `plugins/publishings/wechatmp-pub/src/enrich.ts:364` uses the measured 创作来源 expander, matches exact nested text within a radio label, commits with its own 确认, and names/sweeps unavailable stances once.
- `plugins/publishings/wechatmp-pub/src/enrich.ts:55` models the measured 原文链接 popover outside the dialog tree: row-specific expander, source_url field, and 确定/取消 anchors. `plugins/publishings/wechatmp-pub/src/enrich.ts:329` waits for asynchronous validation to close the popover before verifying the row's checked checkbox and exact URL label; it preserves already committed URLs and cleans refused/moved-field popovers.
- `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:50` covers delayed/refused URL commit, missing field and committed URL skip. `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:79` covers checked agreement preservation, both original row templates, original/reward/claim commits and unavailable stance. Existing fake-console fixtures follow the measured selectors and row readback.
- `docs/design/wechatmp-ui-discovery.md:81` records the measurement before URL production changes and the passing live acceptance; `docs/04_DESIGN.md:1401` corrects the dialog/popover confirm contract.
- Live production-rail acceptance and idempotent replay observed original/reward checked, requested claim text + checkbox, requested URL + checkbox, zero warnings and zero overlays. Artifacts: `.spur/memory/evidence/20261021-wechatmp/0318-live-acceptance.json`, `.spur/run/0318-live-acceptance.png`; repeatable driver `.spur/run/0318-acceptance.ts`. No draft was saved or published, and today's saved article was untouched.

Design conformance: all five intended outcomes implemented. Two measurement-driven refinements preserve the design's goals: the scoped 原创 probe additionally filters the visible branch, and 原文链接 uses its actual popover rather than a dialog. Claim labels match their nested text span. No API, schema, package or dependency change.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/wechatmp-pub/src/enrich.ts:95` reads the original switch in the visible row branch; `plugins/publishings/wechatmp-pub/src/enrich.ts:27` uses the measured original entry; `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:79` proves hidden/pre-checked agreement handling. Live production rail and replay observed original checked with no warnings. |
| R2 | MET | `plugins/publishings/wechatmp-pub/src/enrich.ts:364` opens the claim expander, chooses the requested nested radio text and confirms with 确认; `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:96` proves an unavailable stance is named once. Live production rail observed claim enabled with exact 个人观点，仅供参考 text. |
| R3 | MET | `docs/design/wechatmp-ui-discovery.md:88` records the URL popover measurement before repair; `plugins/publishings/wechatmp-pub/src/enrich.ts:329` waits for asynchronous popover close and verifies row URL/checkbox; `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:50` proves delayed commit and post-close readback. Live production rail observed the exact requested URL and checked row. |
| R4 | MET | `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:87` proves the original/reward sequence. Live production rail and replay observed reward checked, and the inspected screenshot shows the active 赞赏 account row after original declaration. |
| R5 | MET | `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:50` and `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:87` execute production expressions in Chromium against measured popover/twin-row/nested-radio shapes. Initial entries: 0 pass/2 fail; URL baseline: 2 pass/2 fail; twin-row baseline: 0 pass/1 fail; delayed URL baseline: 0 pass/1 fail. Final focused regression: 7 pass/0 fail, repeated successfully during recovery. Full-suite measured coverage: enrich.ts functions 96.77%, lines 99.16%. Proof artifacts recorded at the time: .spur/run/0318-verify-answer.txt lines 1–56 (entire answer), .spur/run/0318-verdict.json lines 1–161 (entire derived/folded verdict), .spur/run/0318-resume-regression.log and .spur/run/0318-resume-acceptance.log — all LOST with the 2026-10-22 run-plane cleanup (see References). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — 原创 commits and re-reads as checked (req: R1) | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:79` and `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:87`; focused Chromium run passed. Live fresh editor and replay observed original checked, using the visible row branch rather than the stale first template. |
| AC2 — 创作来源 commits with its own confirm (req: R2) | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:87`; focused Chromium run passed with the dialog's 确认. Live fresh editor and replay observed exact requested stance and checked claim. |
| AC3 — 原文链接 entry is measured, then committed (req: R3) | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:50` through moved-field failure at `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:72`; all four URL scenarios passed. Live requested URL matched after asynchronous popover close and on replay. |
| AC4 — a committed 原创 unblocks 赞赏 (req: R4) | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:87`; Chromium observed original/reward both checked. Live fresh editor and replay also observed reward checked; inspected screenshot shows active account row. |
| AC5 — the fixture regression fails on the pre-fix entries (req: R5) | MET | command | Focused Chromium baseline failed before entry/visible-branch/popover timing repairs; final focused regression command passed 7 tests with 0 failures. The tracked scenarios begin at `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:50`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

Final state: **done / verify PASS / task release readiness PASS**. All R1–R5 and AC1–AC5 are proven and checked. Final residual counts: blocking=0, deferrable=0, advisory=0, housekeeping=0. Readiness receipt: `.spur/run/0318-shippable.json`.

Recovery was explicitly authorized by the operator's request to complete all remaining work before committing. The previous PARTIAL was a recorder ID mismatch: `prefixId` expects AC/R at the start of the verdict ID, but the answer carried `Scenario: AC1 …`. The answer now uses exact scenario titles beginning `AC1`–`AC5`; the proven AC boxes were reconciled through `spur task update`. Source inspected: Evidence: @gobing-ai/spur `spur.js` line 100635 (installed recorder's prefix matcher). No product source/test changes were necessary during recovery. Ordinary verdict, record, residual and done gates passed; no force-done/provenance bypass was used.

Verification receipts:

- Fresh recovery run: seven Chromium regressions passed; live production rail and idempotent replay passed original/reward/claim/URL checks, zero warnings and zero overlays. No draft saved or published.
- Fresh lint/typechecks, build, 58 pre-check rules and two post-check rules passed (exit 0).
- The full suite on the unchanged source passed: 4050 pass, three pre-existing skips, zero failures, 20088 assertions across 205 files. Measured enrich.ts coverage: functions 96.77%, lines 99.16%. Full-suite logs are retained; no extra full-suite run was needed for metadata-only reconciliation.

Local artifacts — LOST. The 2026-10-22 run-plane cleanup removed this task's `.spur/run/` receipts
and the `20261021-wechatmp/` evidence directory (ADR-131 makes those planes disposable per tree). The
pointer set is listed so the record stays auditable; no claim above rests on it — the durable proof is
the source and test citations in Testing.

- LOST (2026-10-22) `.spur/run/0318-verify-answer.txt` lines 1–56 and `.spur/run/0318-verdict.json` lines 1–161: authored answer and final CLI-derived/folded PASS verdict.
- LOST (2026-10-22) `.spur/run/0318-residuals.json`: final zero-item residual sweep; it superseded the earlier residual report.
- LOST (2026-10-22) `.spur/run/0318-acceptance.ts` lines 1–46 (repeatable live driver) and `.spur/run/0318-live-acceptance.png` (inspected screenshot).
- LOST (2026-10-22) `.spur/memory/evidence/20261021-wechatmp/0318-url-measure.json` lines 1–335 and `.spur/memory/evidence/20261021-wechatmp/0318-live-acceptance.json` lines 1–26: measured controls and passing live state/replay. The same directory held the `wechatmp-probe{,2,3,4,5,6}-20261021.json` measurements cited in Background, Design and Root Cause.
- LOST (2026-10-22) `.spur/run/0318-resume-regression.log`, `.spur/run/0318-resume-acceptance.log`, `.spur/run/0318-resume-lint.log`, `.spur/run/0318-resume-build.log`, `.spur/run/0318-resume-pre-check.log`, `.spur/run/0318-resume-post-check.log`: fresh recovery receipts.
- LOST (2026-10-22) `.spur/run/0318-test-final.log` (full-suite receipt on unchanged source) and `.spur/run/0318-shippable.json` (readiness receipt). The red baseline logs named in the answer are gone with them.

The recorder emits its default Coverage N/A sentence for verdict transcription; the actual measured coverage is recorded in R5's Testing evidence, and the artifact ranges were carried by the now-LOST receipts listed above.

Task shipping readiness: PASS. Feature-level Shippable: N/A (0318 has no linked feature). This does not certify the broader E92 umbrella, whose separate task 0260 remains blocked. Product repair is now present in commit 6126369, observed during recovery; this agent did not create that commit. Only the final task-record updates remain uncommitted for the next step.

### History

- 2026-10-22T04:21:52.240Z todo → wip (system)
- 2026-10-22T04:49:09.768Z wip → testing (system)
- 2026-10-22T04:58:26.615Z testing → done (system)

- Operator-authorized recovery completed: corrected verdict AC identifiers and reconciled all proven AC checkboxes through Spur. Fresh seven-scenario Chromium regression and live acceptance/replay PASS; lint/build/pre/post rules PASS. Re-derived and recorded verify PASS, residual sweep zero items, ordinary lifecycle transition to done. Task release readiness PASS; feature-level gate N/A because task is unlinked. No commit, publish, deployment or gate bypass.

