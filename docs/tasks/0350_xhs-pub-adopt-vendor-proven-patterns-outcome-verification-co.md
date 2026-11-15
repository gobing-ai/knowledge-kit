---
schema_version: 1
name: "xhs-pub: adopt vendor-proven patterns (outcome verification, counter limits, draft verify) and close composePodcast gap"
status: done
template: standard
created_at: 2026-11-10T22:48:43.838Z
updated_at: "2026-11-13T20:29:25.702Z"

done_forced: "false"
done_reason: unforced close
---

## 0350. xhs-pub: adopt vendor-proven patterns (outcome verification, counter limits, draft verify) and close composePodcast gap

### Background

The 2026-11-09/10 dogfood cycle surfaced four xhs-pub gaps: (1) save success was judged by
client-side counters, not server responses; (2) title/body limits were pre-counted instead of
read from XHS's own counters (podcast editor `0/1000`); (3) broken drafts persisted silently —
nothing re-verified a draft after save; (4) `composePodcast` never types title/body/合集,
so every daily podcast draft needed a manual repair pass.

Robin supplied an external reference implementation at `vendors/xiaohongshu-skills`
(Python + CDP + extension bridge). Study shows convergent discoveries (same closed-shadow
`<xhs-publish-btn>` host, dispatchEvent trigger) that validate our approach, plus clearly
better patterns worth porting into our architecture. Our direction is unchanged: kk plugin
transport, flow.ts stages, durable-src waits, ADR-022 launch-only. This task ports the vendor's
stronger verification/limit patterns into that direction and closes the podcast compose gap.

### Requirements

- [x] R1. Save/publish outcome verification: replace counter/stamp-only confirmation with server-response capture — inject layered response observation (XHR + fetch + console + DOM toast, content-signature matching for note_id / HTTPBizError / -913x risk codes), map codes to typed errors (PublishError, AccountRiskControlError), keep sentinel-string evaluate contracts (kk-* sentinels) so fakes cannot false-positive.
- [x] R2. Platform-counter-based limit validation: read XHS's own counters as ground truth — title `div.title-container div.max_suffix` (UTF-16-aware cap 20: 2 half-width chars = 1) and body length error/counter elements (podcast editor 0/1000) — raise typed TitleTooLongError / ContentTooLongError before any save, instead of pre-counting client-side.
- [x] R3. verifyDraft post-save stage: reopen the saved draft and assert observable persistence — expected slot count, all img srcs durable (`https:` scheme; never naturalWidth), title/body length, 合集 badge — egress-independent; loud typed failure naming the violated assertion.
- [x] R4. composePodcast completeness: type title, mechanically derive podcast-note body ≤1000 chars (intro + `·` headlines + closing, counter-verified via R2), and select 合集 (咸话咸说之每日AI乱炖) — no manual repair pass needed for daily podcast drafts.
- [x] R5. Architecture preservation (constraint, not work): keep Playwright + kkBrowserLauncher + persistent profile transport, closed-shadow host-method save (`invokeHostSave` first, click fallback), and durable-src thumbnail wait — vendor's Python/CDP/extension-bridge transport is reference only; its count-based upload wait is explicitly NOT adopted (weaker than the 2026-11-10 fix).

### Acceptance Criteria

- [x] AC1 — a draft save whose server response carries a business error code (incl. -913x risk control) fails with the mapped typed error, and a note_id-bearing success is confirmed from the observed response, not client-side counters only `(req: R1)`
- [x] AC2 — a title/body exceeding the platform counter limit is rejected before save with a typed error quoting the counter text observed in the DOM `(req: R2)`
- [x] AC3 — verifyDraft reopens a just-saved draft and fails loudly when any slot lacks a durable `https:` src or expected metadata is absent; it passes against the repaired 2026-11-09 drafts' shape (7 durable slots / podcast title+body+合集) `(req: R3)`
- [x] AC4 — composePodcast output carries non-empty title, a counter-verified ≤1000-char body, and the collection selection, so a generated podcast draft needs no manual repair `(req: R4)`
- [x] AC5 — regression suite covers the new paths; existing `thumbnail count:` error prefix and host-save (`_onSave` / `shadow-host-method`) contracts stay green `(req: R1, R2, R3, R4)`

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Vendor reference map — `vendors/xiaohongshu-skills` (Python + CDP + extension bridge).
Keep our direction (kk plugin, Playwright transport, flow.ts stages, spur workflow orchestration,
ADR-022 launch-only). Adopt patterns; reject transports.

- **Adopt — publish outcome capture (R1).** `scripts/xhs/publish.py` `click_publish_button` (~:117–260): XHS wraps publish/save in `<xhs-publish-btn>` closed shadow DOM and fires a `publish` CustomEvent on the host — the same host we invoke `_onSave` on (convergent discovery, validates `invokeHostSave`). Their outcome verification is strictly stronger than ours: inject layered response observation — (1) XHR `loadend` hook, (2) fetch wrapper, (3) console.error hook, (4) DOM toast observer — matching on response body content signatures (`"note_id"` success, `HTTPBizError`, `-913x` risk codes, 禁止发笔记) rather than URL patterns (XHS nests its own interceptors; URL patterns are unreliable). First-wins capture into a single window var; poll after dispatch. Port to flow.ts save/publish steps: dispatch host method → poll captured outcome → typed error or `{ok, noteId, code}` receipt. Keep sentinel-string evaluate contracts so the test fake cannot false-positive (`XhsLocator.evaluate` is expression-string only, page.ts:74).
- **Adopt — platform counters as ground truth (R2).** `scripts/xhs/selectors.py` publish-page block + `_check_title_max_length` (:616) / `_check_content_max_length`: read `div.title-container div.max_suffix` ("5/20") and the body `length-error` element after typing instead of pre-counting client-side. Title cap is UTF-16-aware 20 units (2 half-width chars = 1; documented in `skills/xhs-publish/SKILL.md`). This directly serves composePodcast (podcast editor counter `0/1000`): type the derived body, then read the counter — the platform, not our arithmetic, decides pass/fail.
- **Adopt — verifyDraft (R3) — ours, informed by theirs.** Their verify is response-capture-only; a draft pipeline needs reopen-and-assert persistence (the 2026-11-09 incident shipped drafts that "saved" client-side but carried broken states). Post-save: 草稿箱 → draft → 编辑 → assert slots, durable srcs, title/body, 合集; fail loud with the violated assertion. Egress-independent by design (src scheme; naturalWidth is geo-broken — see pitfalls 2026-11-10).
- **Keep (already ≥ vendor) — do NOT regress.** Durable-src thumbnail wait (their `_wait_for_upload_complete` :477 is count-based `IMAGE_PREVIEW` count ≥ expected — exactly the bug class we fixed on 2026-11-10). Host-method save first with coordinate-click fallback. Playwright + persistent profile + kk bot session lifecycle (their extension WebSocket bridge / direct-CDP dual transport is an alternative, not an upgrade).
- **Reference only — different threat model.** `scripts/xhs/human.py` (humanized delays/scroll), `risk_analyzer.py` + `extension/netlogger.js` (NetLog risk-control forensics, `-9136` = 账号风控). Useful evidence if a daily run ever trips risk control; not adopted now (one run/day, low frequency). Long-article mode, scheduled publish, visibility, original declaration, tags input (`_input_tags` Quill `#`-trigger flow, :639), video publish, explore/interact — catalogued as future capability surface; out of scope for this task.
- **Wiring.** Script side: flow.ts (`plugins/publishings/xhs-pub/src/flow.ts`) — capture layers, typed errors, counter checks, verifyDraft, composePodcast body/title/合集; tests extend the existing FakeState / fake-evaluate harness (sentinel handlers). Workflow side: daily-publish3 / voice3 xhs tier gains verifyDraft after send (post-save reopen) so broken drafts fail the tier instead of surfacing in the console days later. Skill side: `kk-publish` note update — draft → verify → launch sequence mirrors the vendor's fill → confirm → publish two-step, which is the same gate as ADR-022.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Fix pass (verifyall --fix all, 2026-11-11) closed the toast layer, the quoted collection probe, and the body-counter scan that also walked the title container.

- R1 DOM toast layer: the page script observes short toast nodes and records the first match for 违反, 违规, 禁止发笔记, 审核未通过, 账号异常, or 无法发布. `plugins/publishings/xhs-pub/src/flow.ts:316`
- R2/R3 body probes scan only `div.edit-container *`. The title container is excluded so its N/20 leaf cannot satisfy a missing body counter. `plugins/publishings/xhs-pub/src/flow.ts:577` and `plugins/publishings/xhs-pub/src/flow.ts:1196`
- R3 collection probe: the 合集 name is embedded with JSON.stringify so a quote cannot break the evaluated page script. `plugins/publishings/xhs-pub/src/flow.ts:1205`
- Skill note: `plugins/kk/skills/publish/SKILL.md:34` states a draft is ok only after the reopen check.

Workflow deviation, goal-equivalent to the Design wiring claim: daily-publish3 and voice3 have no xhs node. The xhs tiers that exist, `plugins/kk/workflows/kk-daily-ai-voice.yaml:503` and `plugins/kk/workflows/kk-daily-ai-voice2.yaml:813`, shell `kk stage daily-publish-xhs`, which runs `kk executor run xhs-pub` at `plugins/kk/scripts/daily-stages.ts:3129`. runMode calls verifyDraft before a draft Result is ok (`plugins/publishings/xhs-pub/src/flow.ts:1306`). That reopen is the tier's post-save check, so no extra workflow node was added.

| Change (`file:line`) |
| --- |
| `plugins/publishings/xhs-pub/src/errors.ts:11` |
| `plugins/publishings/xhs-pub/src/flow.ts:262` |
| `plugins/publishings/xhs-pub/src/flow.ts:316` |
| `plugins/publishings/xhs-pub/src/flow.ts:366` |
| `plugins/publishings/xhs-pub/src/flow.ts:577` |
| `plugins/publishings/xhs-pub/src/flow.ts:605` |
| `plugins/publishings/xhs-pub/src/flow.ts:858` |
| `plugins/publishings/xhs-pub/src/flow.ts:886` |
| `plugins/publishings/xhs-pub/src/flow.ts:1196` |
| `plugins/publishings/xhs-pub/src/flow.ts:1205` |
| `plugins/publishings/xhs-pub/src/flow.ts:1220` |
| `plugins/publishings/xhs-pub/src/flow.ts:1306` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3041` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3148` |
| `plugins/kk/skills/publish/SKILL.md:34` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Capture is armed before save at plugins/publishings/xhs-pub/src/flow.ts:1052 and before publish at plugins/publishings/xhs-pub/src/flow.ts:1121. The page script at plugins/publishings/xhs-pub/src/flow.ts:262 records XHR loadend, fetch, console, and a DOM toast observer at plugins/publishings/xhs-pub/src/flow.ts:316 (element nodes, trimmed length 1-300, keywords 违反/违规/禁止发笔记/审核未通过/账号异常/无法发布). classifyOutcome at plugins/publishings/xhs-pub/src/flow.ts:377 treats a -913x code or RISK_SIGNATURE at plugins/publishings/xhs-pub/src/flow.ts:366 as risk before a note_id ok. assertCapturedOutcome throws AccountRiskControlError at plugins/publishings/xhs-pub/src/flow.ts:392 or PublishError at plugins/publishings/xhs-pub/src/flow.ts:397. Classes: plugins/publishings/xhs-pub/src/errors.ts:11 and plugins/publishings/xhs-pub/src/errors.ts:20. Tests plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3015, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3024, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3033, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3041, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3050, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3126. |
| R2 | MET | Title probe reads div.title-container div.max_suffix at plugins/publishings/xhs-pub/src/flow.ts:566. Body probe reads div.edit-container div.length-error first at plugins/publishings/xhs-pub/src/flow.ts:575, then scans only div.edit-container * at plugins/publishings/xhs-pub/src/flow.ts:577. counterUnits parses the N/M current value at plugins/publishings/xhs-pub/src/flow.ts:585. assertPlatformCounter at plugins/publishings/xhs-pub/src/flow.ts:605 throws TitleTooLongError or ContentTooLongError quoting the counter text. Wired after the title fill at plugins/publishings/xhs-pub/src/flow.ts:532, after the body type at plugins/publishings/xhs-pub/src/flow.ts:554, and on the podcast title at plugins/publishings/xhs-pub/src/flow.ts:897. Classes plugins/publishings/xhs-pub/src/errors.ts:27 and plugins/publishings/xhs-pub/src/errors.ts:34. Tests plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3134 (TitleTooLongError, counter reads, zero clickAt), plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3142 (ContentTooLongError on 1001/1000), plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3148 (title N/20 does not satisfy a missing body counter), plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3201 (unreadable counter is not fatal). |
| R3 | MET | verifyDraft at plugins/publishings/xhs-pub/src/flow.ts:1220 clicks 草稿箱 at plugins/publishings/xhs-pub/src/flow.ts:1228 and 编辑 at plugins/publishings/xhs-pub/src/flow.ts:1235. Slot expectation is input.images.length at plugins/publishings/xhs-pub/src/flow.ts:1173; a mismatch is named at plugins/publishings/xhs-pub/src/flow.ts:1241; a non-https src is named at plugins/publishings/xhs-pub/src/flow.ts:1251. The reopen body probe scans only div.edit-container * at plugins/publishings/xhs-pub/src/flow.ts:1196. collectionProbeExpr embeds the 合集 name with JSON.stringify at plugins/publishings/xhs-pub/src/flow.ts:1205. Any violated assertion throws DraftVerifyError at plugins/publishings/xhs-pub/src/flow.ts:1282 (class plugins/publishings/xhs-pub/src/errors.ts:41). runMode invokes that reopen before a draft Result is ok at plugins/publishings/xhs-pub/src/flow.ts:1306. Tests plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3206, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3213, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3219, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3225, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3231, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3237, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3243, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3117, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3184, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3249. |
| R4 | MET | applyPodcastFields at plugins/publishings/xhs-pub/src/flow.ts:886 fills the title, counter-checks it at plugins/publishings/xhs-pub/src/flow.ts:897, types the derived body, and clicks the 合集. derivePodcastBody at plugins/publishings/xhs-pub/src/flow.ts:858 keeps intro, bullet headlines, and closing, with a hard slice at plugins/publishings/xhs-pub/src/flow.ts:877. Default collection is 咸话咸说之每日AI乱炖 at plugins/publishings/xhs-pub/src/flow.ts:92. Tests plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3249 (non-empty title, typed length at most 1000, default 合集), plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3262, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3268, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3281, plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3290. |
| R5 | MET | invokeHostSave at plugins/publishings/xhs-pub/src/flow.ts:229 is the first save path at plugins/publishings/xhs-pub/src/flow.ts:1057 and records shadow-host-method at plugins/publishings/xhs-pub/src/flow.ts:1060. confirmThumbnails at plugins/publishings/xhs-pub/src/flow.ts:631 fails with the thumbnail count prefix and names a local blob/data src at plugins/publishings/xhs-pub/src/flow.ts:653. The same run kept both contracts green: plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:590 (draftControl _onSave:_onSave at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:601 and draftClick shadow-host-method at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:603) and plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:752 (error contains thumbnail count at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:764). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | -913x capture aborts as AccountRiskControlError and not retryable at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3015; biz code aborts as PublishError at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3024; note_id success is metadata.serverCapture verdict ok at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3033; a toast-only phrase aborts as AccountRiskControlError at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3041; the inject script records a short DOM toast at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3050; publish refuses before the URL marker at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3126. |
| AC2 | MET | test | Over-limit title counter throws TitleTooLongError quoting counter reads and records zero clickAt calls at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3134. Body counter 1001/1000 throws ContentTooLongError at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3142. A title counter of 5/20 does not satisfy a missing body counter at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3148. |
| AC3 | MET | test | Reopen failures name the assertion: slot mismatch expected 2 thumbnails at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3206, non-https src at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3213, title at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3219, empty body at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3225, missing 合集 at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3231, missing 草稿箱 at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3237, missing 编辑 at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3243. A quoted collection name stays inside the probe at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3117. The reopen body probe ignores a title counter at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3184. The podcast happy path records title, body, and 合集 at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3249. Slot expectation is the saved image count at plugins/publishings/xhs-pub/src/flow.ts:1173. |
| AC4 | MET | test | Podcast note carries a non-empty title, a typed body of length at most 1000, and 咸话咸说之每日AI乱炖 at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3249. A metadata collection wins at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3262. Derivation caps at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3268. |
| AC5 | MET | command | bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts on 2026-11-11T04:05:34Z reported 148 pass / 0 fail / 545 expect() calls. Process exit 1 with 0 fail; bunfig.toml:10 sets coverageThreshold to 0.9 lines and 0.9 functions, and that run's loaded graph is All files 48.46% funcs / 53.95% lines. Plugin files in that run are above the threshold: plugins/publishings/xhs-pub/src/flow.ts 93.10% funcs / 96.11% lines and plugins/publishings/xhs-pub/src/errors.ts 100% funcs and lines. Host-save and thumbnail-count contracts passed at plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:590 and plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:752. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed on branch `sp/run-0350-943e` (commits `12dcead`, `820c0ad` vs base `main@967ffc9`); full artifact: `.spur/run/fc9e752d-2098-4072-ad69-dda15615e9fe-review-cert.md`, captured verdict `.spur/run/0350-verdict.json`.

| Req | Status | Evidence |
| --- | ------ | -------- |
| R1 | MET | Layered capture armed before save/publish (`plugins/publishings/xhs-pub/src/flow.ts:1027`, `plugins/publishings/xhs-pub/src/flow.ts:1096`); classify maps −913x → `AccountRiskControlError`, biz → `PublishError`, note_id → metadata (`plugins/publishings/xhs-pub/src/flow.ts:346`); fake-dispatch sentinel tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3009`–`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3035` |
| R2 | MET | Platform counters as ground truth + UTF-16 units (`plugins/publishings/xhs-pub/src/flow.ts:540`, `plugins/publishings/xhs-pub/src/flow.ts:560`); typed throws before save (`plugins/publishings/xhs-pub/src/flow.ts:580`); zero-save-click refusal test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3043` |
| R3 | MET | 草稿箱→编辑 reopen with slot/https-src/title/body/合集 asserts (`plugins/publishings/xhs-pub/src/flow.ts:1193`), loud per-assertion `DraftVerifyError`; seven named-failure tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3062`–`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3099` |
| R4 | MET | Podcast title counter-assert + derived ≤1000-unit body + 合集 selection (`plugins/publishings/xhs-pub/src/flow.ts:861`, `plugins/publishings/xhs-pub/src/flow.ts:833`); tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3105`–`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3146` |
| R5 | MET | Transport/launcher/shadow-save/durable-src wait untouched by the diff (constraint honored, no work) |

| AC | Status | Evidence Type | Evidence |
| --- | ------ | ------------- | -------- |
| AC1 | MET | test | capture → typed errors + serverCapture metadata (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3009`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3027`); gate PASS receipt `.spur/run/0350-check-receipt.json` |
| AC2 | MET | test | counter-quoted typed rejection before save (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3043`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3051`) |
| AC3 | MET | test | named reopen failures + passing 2026-11-09 shape (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3062`–`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3099`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3105`) |
| AC4 | MET | test | non-empty title, counter-verified body, collection in `draftVerified` (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3105`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3118`) |
| AC5 | MET | command | plugin suite 143/143; full gate 4882 pass / 0 fail incl. legacy `thumbnail count:` + `_onSave`/`shadow-host-method` contract tests (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:584`) |

Findings: none at P1–P3. One P4 note (non-blocking): post-verify the flow re-navigates to `PUBLISH_URL` so a re-verify never re-saves (`plugins/publishings/xhs-pub/src/flow.ts:1200`) — deliberate.

Checks: `bunx tsc --noEmit` OK; `bun run lint` OK; plugin suite 143/143; full gate `spur self exec check` PASS (4882 tests, 253 files) with tree-hash receipt reuse confirmed.

Confidence: HIGH

Verdict: PASS

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | plugins/publishings/xhs-pub/src/flow.ts:1200 | After verifyDraft the flow re-navigates to PUBLISH_URL and the runMode caller closes the page — a deliberate single extra navigation so a re-verify never re-saves (a 暂存离开 would shift the draft counter the next run baselines against) | resolved — deliberate, documented in the code comment |

Re-verify note (2026-11-11, after the body-counter fix): the deliberate post-verify navigation cited above at plugins/publishings/xhs-pub/src/flow.ts:1200 is plugins/publishings/xhs-pub/src/flow.ts:1280. Both body probes scan only the edit container at plugins/publishings/xhs-pub/src/flow.ts:577 and plugins/publishings/xhs-pub/src/flow.ts:1196. Current requirement anchors are in Testing.

**Evidence correction (2026-11-13):** The historical run-scoped pointers `.spur/run/fc9e752d-2098-4072-ad69-dda15615e9fe-review-cert.md` and `.spur/run/0350-check-receipt.json` were LOST when their disposable pipeline worktree was removed. The durable verdict is recorded at `.spur/memory/evidence/0350-verdict.json`.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-10T23:56:17.762Z backlog → todo (system)
- 2026-11-11T01:39:39.645Z todo → wip (system)
- 2026-11-11T02:47:45.352Z wip → testing (system)
- 2026-11-11T02:47:45.371Z testing → done (system)

