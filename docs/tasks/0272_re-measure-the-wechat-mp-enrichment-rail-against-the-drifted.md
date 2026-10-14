---
schema_version: 1
name: Re-measure the WeChat MP enrichment rail against the drifted console
status: done
template: issue
created_at: 2026-10-13T03:22:54.165Z
updated_at: "2026-10-14T00:04:12.533Z"
feature_id: G11

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0272-verdict.json
---

## 0272. Re-measure the WeChat MP enrichment rail against the drifted console

### Background

The WeChat MP enrichment rail was measured against the live editor on 2026-10-12. The retained headless measurement report is `.spur/run/wechat-drift-task/bg.md:13-23`; it records the draft id, observed/candidate row and control selectors, account text, absent layout control, moved audio entry, moved cover picker, and the draft-save outcome. It does not contain a complete declaration/agreement or upload-form DOM capture, so those are explicit measurement deliverables before selector constants are frozen. The daily draft still saves, but several enrichment actions use selectors or entry points from an older console build. The owning seams are `plugins/publishings/wechatmp-pub/src/enrich.ts`, `plugins/publishings/wechatmp-pub/src/flow.ts`, and the `metadata.wechatmp` construction in `plugins/kk/scripts/daily-stages.ts`.

The report records two separate live outcomes: the original row remained 未声明 after its dialog attempt, and the reward row reported no authorised 赞赏账户. It does not establish that the account message caused the original result or capture the declaration/agreement controls, so the repair must measure those controls and report each observed state independently. Committed value/identity read-back and real-DOM regression coverage are the residual owned by task 0260 after this selector repair.

Current-tree audit (2026-10-13): dialog cleanup was added in `flow.ts`, so a failed cover/audio modal is now best-effort dismissed before save. The settings selectors, audio entry path, cover library path, layout absence behavior, unavailable URL capability warning, and audio-before-cover ordering still need the concrete changes below. Existing offline tests use the old fake DOM and must not be treated as committed-state proof; task 0260 owns the real DOM/value verification after this task.

**Refine corrections (2026-10-13)**

- Keep the live selector drift, account prerequisite, missing layout control, cover/audio dependency, and non-blocking save findings; the headless report records them at `.spur/run/wechat-drift-task/bg.md:13-23`, and they remain present in the current source.
- Drop the forced re-run hang and deleted-result-file claim from the implementation scope. The evidence has no reproducible current-code cause, while the normal stage run and plugin check complete; this task should not invent a timeout or cache repair around it.
- Keep the existing `originalUrl` metadata contract and plugin consumer for builds/callers that expose the field. On this build, adapt the absent-row path to one explicit unavailable-capability warning and do not map the unrelated `链接` row or emit a generic click timeout. No evidence proves the product field is retired globally.

The task is the measured WeChat enrichment/cover/audio selector and daily-adapter repair. An authenticated browser/profile is required to complete the missing control map; if the profile is busy or browser bridge is unavailable, execution remains blocked and no synthetic selector is accepted. Task 0260 consumes this work for committed identity/value probes and real-DOM regression coverage; this task does not claim that evidence. It does not change the publish contract, account provisioning, or the safety workflow.

### Requirements

- [x] R1. Each retained enrichment step validates the observed/candidate selector map in `.spur/run/wechat-drift-task/bg.md:13-23` against the target editor, performs its action, and returns an explicit capability or action outcome; task 0260 performs the committed DOM value/identity read-back after this selector repair.
- [x] R2. Original declaration selects the measured declaration and agreement controls before confirming. If the dialog or row does not commit, the rail reports an original warning; it does not infer a reward dependency from that outcome or present a closed dialog as success.
- [x] R3. Reward detects the no-authorised-account message and reports the operator action once without retrying it as a selector failure. Only an explicit current DOM message such as 声明原创后才可开启 may suppress a dependent reward attempt; the account message alone does not change original handling.
- [x] R4. The existing `metadata.wechatmp.originalUrl` request and plugin consumer remain available for callers/builds that expose 原文链接. When this build has no 原文链接 row, the plugin emits one explicit unavailable-capability warning and never maps the unrelated live `链接` row or retries a generic click timeout.
- [x] R5. Layout probes for the current 一键排版 control. When the build has no such control, the step skips without a warning; when the control exists, it selects 匹配目标格式 and reports an application failure if the option or confirmation is missing.
- [x] R6. Cover uses the measured panel and library dropdown selectors. A library cover is attempted only after the requested audio material is present; if that dependency is unavailable, the rail emits a specific warning and never silently selects an arbitrary existing library image.
- [x] R7. Audio opens the toolbar dropdown before selecting `.tpl_dropdown_menu_item.js_insertaudio`, retains same-title dedupe, and completes the measured upload sequence (audio, cover, title, agreement, save, insert, read-back).
- [x] R8. Every enrichment failure remains fail-soft: leaked dialogs are dismissed, the draft save is attempted, and the publish result keeps its existing success/error contract.
- [x] R9. The implementation records a selector/control map for the declaration/agreement, reward, URL capability, audio upload, cover picker and layout controls, with evidence paths and any live mismatch. Selector fixtures cover supported and unsupported account outcomes, absent layout, originalUrl capability absence, and modal cleanup. Task 0260 supplies the real-Chromium committed-state/value regression and live draft read-back after this task's map is applied; queued booleans are not evidence of committed state.

### Acceptance Criteria

```gherkin
Scenario: AC1 — the measured original controls are driven and outcome is surfaced (req: R1, R2, R9)
  Given the authenticated target editor exposes declaration and agreement controls captured by the measurement deliverable
  When the original row is processed
  Then the measured controls are used, a non-committed row is reported as an original warning, and task 0260 can read the committed state in its real-DOM follow-up

Scenario: AC2 — an account prerequisite is actionable and bounded (req: R2, R3, R9)
  Given the console reports that no 赞赏账户 is authorised
  When original/reward enrichment runs
  Then the reward result names the account-authorisation action, does not claim reward success from a closed dialog, and does not retry the same unavailable state; original retains its own observed outcome

Scenario: AC3 — an unavailable URL capability is explicit (req: R4, R9)
  Given a surfdash result contains a URL
  When the daily WeChat metadata is built
  Then `metadata.wechatmp.originalUrl` remains available to the plugin contract, an editor with no 原文链接 row yields one unavailable-capability warning, and the live `链接` setting is not changed

Scenario: AC4 — a build without layout support is quiet (req: R5)
  Given neither the 一键排版 control nor its target option exists
  When an article is composed
  Then the layout step skips without an enrichment warning and the draft continues to save

Scenario: AC5 — audio and library cover use their measured dependency (req: R6, R7)
  Given the audio toolbar dropdown and measured upload/library controls exist
  When an article requests a library cover
  Then audio is deduplicated or uploaded and inserted before the cover picker attempts the library path; if audio cannot be inserted, no arbitrary library item is selected and the warning identifies the dependency

Scenario: AC6 — all retained failures remain fail-soft (req: R8, R9)
  Given every enrichment action fails or leaves a modal open
  When the article flow finishes
  Then dialogs are dismissed, the draft save is attempted, and the result reports warnings without turning the enrichment failure into a publish-stage failure

Scenario: AC7 — the selector handoff has retained measurement evidence (req: R1, R9)
  Given `.spur/run/wechat-drift-task/bg.md:13-23` records the headless draft id and observed/candidate selector map
  When the missing declaration/agreement and upload-form controls are measured before task 0260's identity/value follow-up
  Then every changed row/control has an evidence path and candidate status, and no queued fake return value is accepted as committed-state proof
```

### Q&A

#### Closed decision — account prerequisite
The console's no-authorised-赞赏账户 message is an operator prerequisite for reward. The rail should surface it once and stop retrying that unavailable reward state; the message does not prove why the original row failed, so original keeps an independent outcome.

#### Closed decision — absent URL row
The live `链接` row is a different feature, so it is not a replacement for 原文链接. Keep the shared `originalUrl` request/consumer contract and emit an explicit unavailable-capability warning on this build; do not retire the field globally without a product decision.

#### Closed decision — audio/cover order
The library cover is the audio material's cover. Run audio before the library cover picker and refuse an arbitrary library fallback when audio did not become available. Body cover remains an explicit alternative.

#### Closed decision — live evidence boundary
`.spur/run/wechat-drift-task/bg.md:13-23` is the retained headless measurement report that supplies the observed/candidate selector map and draft id. It does not replace task 0260's real-DOM committed-state/value proof; declaration/agreement and upload-form internals remain measurement deliverables. The historical forced-rerun hang is unverified and is excluded rather than converted into a speculative timeout fix.

### Design

Update the measured selector tables and flow seams only. Treat `.spur/run/wechat-drift-task/bg.md:13-23` as the retained headless candidate report: validate each candidate against the target build, measure the missing declaration/agreement and upload-form controls, then freeze the resulting map in code with evidence paths in fixture comments. Task 0260 then owns real-Chromium committed identity/value probes and DOM regressions; this task's recording fakes prove call ordering and warning plumbing only.

1. In `enrich.ts`, validate and then replace the stale original/reward row candidates with the `js_original_apply.js_edit_ori`, `js_reward_open`/`js_reward_allow_click` shapes reported by the headless walk. Measure/freeze the declaration and agreement controls before selecting them, detect the account-prerequisite text, and return an explicit original/reward outcome. Suppress a dependent reward attempt only when the current DOM explicitly says `声明原创后才可开启`; do not infer that dependency from the missing-account message. Preserve collection and claim-source behavior. Keep the `originalUrl` branch as a capability request, but make an absent row return one explicit unsupported-build warning rather than a generic timeout.
2. In `daily-stages.ts`, preserve the existing `originalUrl` metadata production until a product decision retires the field; do not map the unrelated `链接` row. The daily adapter's selector/state repair is limited to passing the existing contract and actionable capability result.
3. In `flow.ts`, make layout absence a quiet no-op. Add the candidate cover panel/dropdown selectors and keep the existing warning-and-dismiss behavior. Make `enrichArticleDraft` expose whether requested audio is ready, call it before a library cover, and have `setCover` refuse an unready library dependency with a specific warning. The body source remains explicit and does not depend on audio.
4. Measure the audio toolbar's `.jsInsertIcon.audio` menu and `.tpl_dropdown_menu_item.js_insertaudio` entry and then freeze the validated map; keep the existing dedupe/upload/insert/read-back logic and scoped file inputs. Measure the upload form's file inputs, agreement and save controls before relying on them. Keep `closeOpenDialogs`/`dismissOpenDialog` on every failure path before save.
5. Update orchestration fixtures in `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` for the candidate selectors and add cases for account prerequisite, independent original/reward outcomes, explicit URL capability warning, absent layout, audio-before-library-cover, dependency refusal, and modal cleanup. Do not call queued return values committed-state proof; task 0260's real-DOM suite and attended draft run supply identity/value evidence.

Do not change the publish result schema, account state, unrelated `链接` setting, or daily workflow error policy.

### Plan

1. Reconcile the candidate selector/control map in `.spur/run/wechat-drift-task/bg.md:13-23` with the current editor build; capture the missing declaration/agreement and upload-form DOM controls and retain the evidence paths. Then locate each selector/entry-point use in `enrich.ts`, `flow.ts`, `daily-stages.ts`, and the existing plugin tests.
2. Implement original/reward prerequisite handling with independent outcomes and an explicit unavailable-build warning for the absent URL row; preserve the `originalUrl` metadata contract and update collection/claim-source tests only where the new row shape requires it.
3. Implement quiet layout absence, measured cover picker candidates, and the explicit audio-before-library-cover dependency. Ensure every failure closes its modal before the save path.
4. Implement the two-step audio toolbar entry and retain the upload agreement/save/insert verification.
5. Update and extend the offline orchestration tests for supported selectors, account-blocked reward, independent original outcome, unavailable URL capability, absent layout, cover/audio dependency, and fail-soft save. Run `bun test plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` and the relevant daily-stage test; do not treat queued booleans as DOM proof.
6. Hand the validated selector map and fixtures to task 0260, which runs the real Chromium DOM/value regression and attended draft read-back after the repair. Record the candidate map, measurement artifacts and any live mismatch against `.spur/run/wechat-drift-task/bg.md`.
7. Run the scoped Spur task/feature checks and review the diff. Do not broaden this task to the unverified forced-rerun hang.

### Root Cause

The failures have two verified causes and one account outcome. The editor build drifted from the selector table and moved audio/cover controls behind new menus; the retained headless report records observed candidates and the absent URL/layout controls, while declaration/agreement and upload-form details remain to be captured. The account reports no authorised 赞赏账户, which blocks reward on that account; it does not prove why the original row remained uncommitted. A later modal-cleanup change addressed one consequence (save being covered), but it did not repair stale entry points or distinguish capability outcomes from selector failures. The forced-rerun hang is not isolated and is excluded from the root cause.

### Solution

No implementation is claimed yet. The implementable solution is:

- `.spur/run/wechat-drift-task/bg.md:13-23` supplies the retained headless observed/candidate selector map and draft-save outcome; it is the measurement input, while task 0260 owns the subsequent real-DOM/value proof.
- `plugins/publishings/wechatmp-pub/src/enrich.ts:26-185`: validated original/reward row selectors, newly measured declaration/agreement controls, independent prerequisite outcomes, explicit unsupported-build warning for an absent URL row, and post-confirm handoff for 0260's value probes; keep the `originalUrl` contract.
- `plugins/kk/scripts/daily-stages.ts:1512-1527`: preserve the existing `metadata.wechatmp.originalUrl` request until a product decision retires it; do not map the unrelated `链接` row.
- `plugins/publishings/wechatmp-pub/src/flow.ts:578-716,1214-1245`: quiet layout absence; measured cover selectors and explicit audio readiness; audio toolbar menu entry before the existing upload/dedupe flow; modal cleanup retained on all warning paths.
- `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1099-1237`: selector/orchestration fixtures and regression assertions for supported fields, independent account/original outcomes, URL capability warning, absent layout, audio/cover dependency, and fail-soft save. Real DOM/value evidence remains task 0260's handoff.

The solution deliberately leaves account provisioning, committed identity/value probes, the unrelated `链接` setting, and the unverified forced-rerun hang outside this task. The task is spec-ready with a named measurement deliverable; task 0260 must consume the validated map, distinguish account-blocked warnings from unsupported selector failures, and read the saved draft back before the channel repair is considered live-verified.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Measured candidate maps per retained row — `plugins/publishings/wechatmp-pub/src/enrich.ts:26-43`; probe-then-act before any click (`plugins/publishings/wechatmp-pub/src/enrich.ts:134,149,196`); explicit outcome per step (`plugins/publishings/wechatmp-pub/src/enrich.ts:159,198`). |
| R2 | MET | 原创 drives the measured declaration radio + agreement checkbox — `plugins/publishings/wechatmp-pub/src/enrich.ts:57-59,134`; non-commit stays an original warning (`plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1184`). |
| R3 | MET | 赏-blocked dialog → one named operator action, no retry — `plugins/publishings/wechatmp-pub/src/enrich.ts:150-159`; `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1250-1264` asserts exactly one warning. |
| R4 | MET | `metadata.wechatmp.originalUrl` intact; missing 原文链接 row → one explicit warning, `链接` row never opened — `plugins/publishings/wechatmp-pub/src/enrich.ts:196-201`; `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1266-1283`. |
| R5 | MET | Absent 一键排版 control skips silently — `plugins/publishings/wechatmp-pub/src/flow.ts:581` returns null; `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1285-1291` asserts empty enrichWarnings. |
| R6 | MET | Library cover deferred behind the audio material — `plugins/publishings/wechatmp-pub/src/flow.ts:700-714,735-739`; ordering test `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1293-1319`. |
| R7 | MET | Toolbar dropdown → `li.js_insertaudio` before the dialog — `plugins/publishings/wechatmp-pub/src/flow.ts:199-202,1243-1245`; same-title dedupe + measured upload sequence retained. |
| R8 | MET | Fail-soft contract unchanged; modal-recovery + warning-contract tests green in the full gate (2777 pass / 2 skip / 0 fail). |
| R9 | MET | Selector map + evidence paths — `.spur/run/wechat-drift-task/measure-20261013/` (captures + `12-original-dialog-map.json` + `22-audio-modal-map.json`) vs `.spur/run/wechat-drift-task/bg.md:13-23`; fixtures cover 赏-blocked, URL-row-missing, layout-absent, modal cleanup; committed-state read-back stays with 0260. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — measured original controls driven, outcome surfaced (req: R1, R2, R9) | MET | test + static-ref | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1184`; `plugins/publishings/wechatmp-pub/src/enrich.ts:57-59,134` |
| AC2 — account prerequisite actionable and bounded (req: R2, R3, R9) | MET | test + static-ref | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1250-1264`; `plugins/publishings/wechatmp-pub/src/enrich.ts:150-159` |
| AC3 — unavailable URL capability explicit (req: R4, R9) | MET | test + static-ref | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1266-1283`; `plugins/publishings/wechatmp-pub/src/enrich.ts:196-201` |
| AC4 — build without layout support is quiet (req: R5) | MET | test + static-ref | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1285-1291`; `plugins/publishings/wechatmp-pub/src/flow.ts:581` |
| AC5 — audio before library cover, dependency honoured (req: R6, R7) | MET | test + static-ref | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1293-1319`; `plugins/publishings/wechatmp-pub/src/flow.ts:700-714,735-739` |
| AC6 — retained failures stay fail-soft (req: R8, R9) | MET | test | modal-recovery + warning-contract tests green in the full gate run |
| AC7 — selector handoff has retained measurement evidence (req: R1, R9) | MET | command + static-ref | `measure-20261013/12-original-dialog-map.json`, `22-audio-modal-map.json`, `99-editor-final.html` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

#### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

Evidence and ownership:

- `.spur/run/wechat-drift-task/bg.md:13-23` — retained **headless measurement report** for draft `appmsgid=100000963`; records observed/candidate row/control selectors, account messages, absent layout/URL controls, moved audio/cover entry points, and `ok: true` draft-save result. It does not prove committed values or include the complete declaration/upload-form internals.
- `.spur/run/wechat-drift-task/req.md:1-9` and `ac.md:1-5` — original drift campaign requirements and acceptance targets; used as source context, not as committed-state proof.
- `docs/design/wechatmp-ui-discovery.md:1-23,5.2-5.3` — historical 2026-10-06 discovery baseline for the editor, draft signal, cover/layout and audio behavior; later drift is recorded in the retained headless report.
- `.spur/run/discovery/wechatmp-probe-editor-文章.json:171-186` — retained DOM probe showing the earlier editor's original switch controls; useful for comparison, not a substitute for the 2026-10-12 walk.
- `.spur/run/refine-0260/live/20261013-audit.md:3-11` — 0260's live-readiness audit; no new attended walk was possible, so 0260 owns the real-DOM committed identity/value follow-up after this selector repair.
- External execution prerequisite — an authenticated WeChat profile and browser bridge must be free; the measurement deliverable is the validated selector/control map (including declaration/agreement and upload-form controls), handed from 0272 to 0260 with evidence paths and observed committed values.

### History

- 2026-10-14T00:00:10.582Z todo → testing (system)
- 2026-10-14T00:04:12.517Z testing → done (system)

