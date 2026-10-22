---
schema_version: 1
name: "wechatmp 文章 settings rail: measure and repair 原创/创作来源/原文链接 entries"
status: done
template: issue
created_at: 2026-10-22T03:08:10.155Z
updated_at: "2026-10-22T05:01:08.613Z"

priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 0318. wechatmp 文章 settings rail: measure and repair 原创/创作来源/原文链接 entries

### Background

The 2026-10-21 daily draft (`appmsgid=100001043`) shipped with three settings rows unset, and the same
was true on 10-19/10-20: `原创声明未生效`, `创作来源未生效`, `原文链接: no URL field in the 原文链接
dialog`. Because 原创 is unchecked the platform also disables 赞赏 and 付费 ("声明原创后才可开启"), so the
draft loses its reward block on top of the three rows.

The committed-state probes are fine: `#js_original`, `.js_ori_setting_checkbox`,
`#js_reward_setting_area`, `#js_claim_source_area`, `.js_claim_source_selected`, `#author`,
`textarea#title` all still exist in the live editor (measured 2026-10-21, evidence
`.spur/memory/evidence/20261021-wechatmp/wechatmp-probe{,2,3,4}-20261021.json`). What changed is the
ENTRY path into each dialog and the dialog's own control set:

- 原创: entry is `#js_original i.read-more__icon__more-inactive`; the dialog now carries
  `声明类型 (文字原创 | 无需声明)`, `作者 0/8`, `白名单`, `快捷转载`, and a required
  `我已阅读并同意《微信公众平台原创声明及相关功能使用协议》` checkbox whose real `input[type=checkbox]`
  is HIDDEN behind a styled label; commit with `确定`.
- 创作来源: entry is `#js_claim_source_area .allow_click_opr`; the dialog's 声明类型 radios are
  `内容由AI生成` / `素材来源官方媒体/网络新闻` / `内容剧情演绎，仅供娱乐` / `个人观点，仅供参考` (the
  daily stage's stance) / `健康医疗分享，仅供参考` / `投资观点，仅供参考` / `无需声明`, committed with
  **`确认`** (the 原创 dialog uses `确定` — the two differ).
- 原文链接: `#js_article_url_area input.frm_checkbox.js_url_checkbox` is visible in the DOM but
  Playwright `check()` times out on it, and clicking `.allow_click_opr` ("未添加") in an empty editor
  does nothing — the field's real entry is still unmeasured.

The audio-material and cover-input selectors were already repaired on 2026-10-21
(`flow.ts` `AUDIO_UPLOAD_INPUT` / `AUDIO_COVER_INPUT`: the form's inputs carry `accept=''` and
`image/bmp, image/png, …` respectively); this task covers the settings rail only.

### Requirements

- [x] R1. 原创 commits: open the row from its measured entry (`#js_original
  .setting-group__content-info`), satisfy the agreement control (label click; the real input is
  hidden), keep the default-checked 文字原创 radio, click `确定`, and verify
  `#js_original input.weui-desktop-switch__input` checked AFTER the dialog closes. A row whose switch
  is still unchecked is the named warning this task exists to remove.
- [x] R2. 创作来源 commits: open the row from `.allow_click_opr`, select the requested stance from the
  声明类型 radios (`个人观点，仅供参考` is present), click **`确认`** (the 创作来源 dialog's label, not
  原创's `确定`), and verify `.js_claim_source_selected` carries the requested text. A stance the
  platform does not offer is a named skip.
- [x] R3. 原文链接 commits: measure the row's real entry first (label click vs `allow_click_opr`,
  then where the URL field appears), set the URL, and verify the committed readback equals the
  requested value. The unmeasured entry is named in the evidence doc before the rail changes.
- [x] R4. 赞赏 unblocks: with the 原创 committed probe scoped to the row (fixed 2026-10-21,
  `45ba558`), the 赞赏 row is no longer disabled by a false uncommitted read ("声明原创后才可开启"); the
  remaining work is to confirm the existing 赞赏 step reaches its own switch and verifies it on the next
  daily draft, or name why the platform kept it disabled.
- [x] R5. fixture-DOM regression: the measured shapes run against synthetic DOM in
  `tests/fixtures/wechatmp-dom-runner.ts` (real Chromium), so the offline suite fails on the pre-fix
  entries and passes after.

Out of scope: the audio-material and cover-input selectors (repaired 2026-10-21, `6868ac0`); the
inert 一键排版 control (behaviour unchanged, message corrected in the same commit); the content-safety
loop and item-count seam (handled elsewhere); any live publish — every acceptance draft is draft-only.

### Acceptance Criteria

```gherkin
- [x] AC1 — 原创 commits and re-reads as checked (req: R1)
  Scenario: AC1 — 原创 commits and re-reads as checked (req: R1)
  Given a fresh 文章 draft and the operator's 原创 request, when the rail runs, then the dialog is
  entered from `#js_original .setting-group__content-info`, the agreement label is clicked, and after
  the dialog closes the row's `#js_original input.weui-desktop-switch__input` reads checked.
- [x] AC2 — 创作来源 commits with its own confirm (req: R2)
  Scenario: AC2 — 创作来源 commits with its own confirm (req: R2)
  Given a fresh draft and `claimSource: "个人观点，仅供参考"`, when the rail runs, then the 声明类型
  radio `个人观点，仅供参考` is selected, the dialog is committed with `确认`, and after close
  `.js_claim_source_selected` reads the same text.
- [x] AC3 — 原文链接 entry is measured, then committed (req: R3)
  Scenario: AC3 — 原文链接 entry is measured, then committed (req: R3)
  Given a fresh draft and `originalUrl`, when the rail runs, then the measured entry opens the field,
  the URL is filled, and the committed readback equals the requested URL; a build whose entry moved
  names the failure instead of claiming success.
- [x] AC4 — a committed 原创 unblocks 赞赏 (req: R4)
  Scenario: AC4 — a committed 原创 unblocks 赞赏 (req: R4)
  Given a fresh draft, when 原创 commits, then the 赞赏 row is no longer "声明原创后才可开启" and the
  赞赏 step reaches its switch or names why the platform kept it disabled.
- [x] AC5 — the fixture regression fails on the pre-fix entries (req: R5)
  Scenario: AC5 — the fixture regression fails on the pre-fix entries (req: R5)
  Given `tests/fixtures/wechatmp-dom-runner.ts`, when `bun test plugins/publishings/wechatmp-pub/tests/`
  runs, then the rail's committed-skip and dialog steps exercise the measured shapes and pass.
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

WHAT — the settings rail stops reading a dialog's template and enters each row from its measured
control, with the committed-value contract kept (0260/0272) and the dialog vocabulary pinned by name.

WHY — the 2026-10-21 draft re-opened a dialog whose committed probe read the dialog itself, so a
row the rail had just clicked 确定 on still read as uncommitted; 创作来源 and 原文链接 warn every day
because the rail enters those rows from controls that no longer open their dialogs; 赞赏 is disabled
as a side effect of the false uncommitted read. Unmeasured selector surgery produced exactly these
warnings (0272), so every entry this design lands is named from the live measurement, not inferred.

WHERE — `plugins/publishings/wechatmp-pub/src/enrich.ts` (the rail: row entries, dialog actions,
committed probes) and `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-dom-runner.ts`
(the synthetic DOM). Evidence: `.spur/memory/evidence/20261021-wechatmp/wechatmp-probe{,2,3,4,5,6}-20261021.json`.

Frozen names (all measured live 2026-10-21):

- 原创 entry — the row's visible `#js_original .setting-group__content-info` / `.setting-group__title`
  (measured opener of the dialog), never the old `.js_edit_ori`; the dialog's radio is the
  `label:has(.js_original_type_radio):has-text("文字原创")` (default-checked in this build), the
  agreement is `label.original_agreement` whose real `input[type=checkbox]` is HIDDEN behind a styled
  label (click the label, never `.check()` the hidden input), commit `确定`.
- 原创 committed probe — `#js_original input.weui-desktop-switch__input` (the row's own switch),
  never the unscoped `#js_original, .js_ori_setting_checkbox` union (committed 45ba558).
- 创作来源 entry — `#js_claim_source_area .allow_click_opr` (the label `#js_claim_source_area
  .frm_checkbox_label` resolved but opened nothing); the 声明类型 radios include
  `个人观点，仅供参考`; commit this dialog with **`确认`**, never the 原创 dialog's `确定`.
- 原文链接 entry — still UNMEASURED (the row's `input.frm_checkbox.js_url_checkbox` times out on
  Playwright `check()`; `.allow_click_opr` opened nothing in an empty editor): measure the label
  click and read where the URL field appears before touching the rail. Outcome is a warning when the
  readback does not match the requested URL, never a silent success.
- 赞赏 — unchanged except that the original probe fix removes its disable precondition; its own
  `COMMITTED.reward` / `ROW_REWARD` stay as-is until a live pass proves otherwise.

Anti-patterns: no re-opening an already committed row (the committed probe answers first); no
`document.querySelector` against a class that the dialog also carries; no `input.check()` on a hidden
input (drive its label); no hard-coded dialog vocabulary — the confirm label and the stance radios are
read from the opened dialog, and an absent stance is a named skip; no production change to 原文链接
without the measured entry.

HANDOFF — the repair lands in this task; the next daily run (or an explicit re-draft) is the
acceptance pass, and the attended walk (`probe6` shape) is the evidence AC1 records.

### Plan

1. Verify against the live editor (already measured 2026-10-21; re-run the probe6 shape if the build
   moved): 原创 dialog from `#js_original .setting-group__content-info`, radio +
   `label.original_agreement` label click + `确定`; 创作来源 from `.allow_click_opr` + `确认`; the
   原文链接 entry measurement (label click, then where the URL field appears).
2. Land the rail changes in `enrich.ts`: `ROW_ORIGINAL` → the measured row-content entries;
   `ROW_CLAIM` → `#js_claim_source_area .allow_click_opr`; the 创作来源 dialog confirms with `确认`
   (separate `CLAIM_CONFIRM` from the 原创 `确定`); `ROW_URL` only after the entry is measured;
   原创 agreement driven by its label; keep the committed probe scoped (`45ba558`).
3. Extend `tests/fixtures/wechatmp-dom-runner.ts` to the measured shapes (row content opener, hidden
   agreement input behind `label.original_agreement`, the 创作来源 `确认` dialog, the 原文链接 entry),
   so the offline regression runs the production expressions against synthetic DOM and fails on the
   pre-fix entries.
4. `bun test plugins/publishings/wechatmp-pub/tests/` green; `bun run lint` clean.
5. Verification: one attended E2E draft (draft-only, no 发表) shows 原创/创作来源/原文链接 committed
   and re-read after the dialogs close, and the run's warnings carry no `未生效` for those rows
   (AC1); the fixture regression is the AC2 evidence; the discovery doc carries the measured shapes
   (AC3).

Ordered: measurement first (原文链接 entry), rail second, fixture third, gates fourth, the attended
E2E last. The next daily run is the acceptance pass, so nothing here re-drafts today's article.

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
| R5 | MET | `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:50` and `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts:87` execute production expressions in Chromium against measured popover/twin-row/nested-radio shapes. Initial entries: 0 pass/2 fail; URL baseline: 2 pass/2 fail; twin-row baseline: 0 pass/1 fail; delayed URL baseline: 0 pass/1 fail. Final focused regression: 7 pass/0 fail, repeated successfully during recovery. Full-suite measured coverage: enrich.ts functions 96.77%, lines 99.16%. Proof artifacts: .spur/run/0318-verify-answer.txt lines 1–56 (entire answer), .spur/run/0318-verdict.json lines 1–161 (entire derived/folded verdict), .spur/run/0318-resume-regression.log and .spur/run/0318-resume-acceptance.log. |

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

Local artifacts retained for audit:

- `.spur/run/0318-verify-answer.txt` lines 1–56 and `.spur/run/0318-verdict.json` lines 1–161: authored answer and final CLI-derived/folded PASS verdict.
- `.spur/run/0318-residuals.json`: final zero-item residual sweep. The earlier residual report describes the resolved attempt and is superseded by this final sweep.
- `.spur/run/0318-acceptance.ts` lines 1–46: repeatable live driver; `.spur/run/0318-live-acceptance.png`: inspected screenshot.
- `.spur/memory/evidence/20261021-wechatmp/0318-url-measure.json` lines 1–335 and `.spur/memory/evidence/20261021-wechatmp/0318-live-acceptance.json` lines 1–26: measured controls and passing live state/replay.
- `.spur/run/0318-resume-regression.log`, `.spur/run/0318-resume-acceptance.log`, `.spur/run/0318-resume-lint.log`, `.spur/run/0318-resume-build.log`, `.spur/run/0318-resume-pre-check.log`, `.spur/run/0318-resume-post-check.log`: fresh recovery receipts.
- `.spur/run/0318-test-final.log`: full-suite receipt on unchanged source. Expected failing baselines are retained in the red logs named in the answer.

The recorder emits its default Coverage N/A sentence for verdict transcription; actual measured coverage and artifact ranges are recorded in R5's Testing evidence and the receipts above.

Task shipping readiness: PASS. Feature-level Shippable: N/A (0318 has no linked feature). This does not certify the broader E92 umbrella, whose separate task 0260 remains blocked. Product repair is now present in commit 6126369, observed during recovery; this agent did not create that commit. Only the final task-record updates remain uncommitted for the next step.

### History

- 2026-10-22T04:21:52.240Z todo → wip (system)
- 2026-10-22T04:49:09.768Z wip → testing (system)
- 2026-10-22T04:58:26.615Z testing → done (system)

- Operator-authorized recovery completed: corrected verdict AC identifiers and reconciled all proven AC checkboxes through Spur. Fresh seven-scenario Chromium regression and live acceptance/replay PASS; lint/build/pre/post rules PASS. Re-derived and recorded verify PASS, residual sweep zero items, ordinary lifecycle transition to done. Task release readiness PASS; feature-level gate N/A because task is unlinked. No commit, publish, deployment or gate bypass.

