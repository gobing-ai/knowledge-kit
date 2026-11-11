---
schema_version: 1
name: "xhs-pub: adopt vendor-proven patterns (outcome verification, counter limits, draft verify) and close composePodcast gap"
status: wip
template: standard
created_at: 2026-11-10T22:48:43.838Z
updated_at: "2026-11-11T02:27:39.174Z"

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/publishings/xhs-pub/src/errors.ts:1` |
| `plugins/publishings/xhs-pub/src/flow.ts:1026` |
| `plugins/publishings/xhs-pub/src/flow.ts:1039` |
| `plugins/publishings/xhs-pub/src/flow.ts:1053` |
| `plugins/publishings/xhs-pub/src/flow.ts:1059` |
| `plugins/publishings/xhs-pub/src/flow.ts:1082` |
| `plugins/publishings/xhs-pub/src/flow.ts:1095` |
| `plugins/publishings/xhs-pub/src/flow.ts:1102` |
| `plugins/publishings/xhs-pub/src/flow.ts:1112` |
| `plugins/publishings/xhs-pub/src/flow.ts:1131` |
| `plugins/publishings/xhs-pub/src/flow.ts:1136` |
| `plugins/publishings/xhs-pub/src/flow.ts:12` |
| `plugins/publishings/xhs-pub/src/flow.ts:1269` |
| `plugins/publishings/xhs-pub/src/flow.ts:1274` |
| `plugins/publishings/xhs-pub/src/flow.ts:251` |
| `plugins/publishings/xhs-pub/src/flow.ts:507` |
| `plugins/publishings/xhs-pub/src/flow.ts:511` |
| `plugins/publishings/xhs-pub/src/flow.ts:519` |
| `plugins/publishings/xhs-pub/src/flow.ts:524` |
| `plugins/publishings/xhs-pub/src/flow.ts:573` |
| `plugins/publishings/xhs-pub/src/flow.ts:811` |
| `plugins/publishings/xhs-pub/src/flow.ts:86` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:126` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:18` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:208` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:260` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:276` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2964` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:319` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:470` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Layered capture armed before both save (`plugins/publishings/xhs-pub/src/flow.ts:1027`) and publish (`plugins/publishings/xhs-pub/src/flow.ts:1096`); XHR+fetch+console patches with first-wins `window.__kkXhsArmed` (`plugins/publishings/xhs-pub/src/flow.ts:261`); content-signature classify (`plugins/publishings/xhs-pub/src/flow.ts:346`) maps −913x/禁止发笔记 → `AccountRiskControlError`, `HTTPBizError`+code → `PublishError` (`plugins/publishings/xhs-pub/src/flow.ts:364`); ok verdicts (note_id) surface via `captureMetadata` (`plugins/publishings/xhs-pub/src/flow.ts:379`) into Result metadata; save retry abandoned on captured refusal (`plugins/publishings/xhs-pub/src/flow.ts:1052`), publish click never retried (assertion inside the `waitUntil` predicate, `plugins/publishings/xhs-pub/src/flow.ts:1113`); sentinel-string evaluate contracts kept — the fake dispatches only on `kk-capture-*` markers, tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3009`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3018`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3027`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3035` |
| R2 | MET | Platform counters read as ground truth: title `div.title-container div.max_suffix` + leaf fallbacks (`plugins/publishings/xhs-pub/src/flow.ts:540`), body `length-error` first (`plugins/publishings/xhs-pub/src/flow.ts:549`); UTF-16-aware `counterUnits` (`plugins/publishings/xhs-pub/src/flow.ts:560`); typed `TitleTooLongError`/`ContentTooLongError` raised before any save click (`plugins/publishings/xhs-pub/src/flow.ts:580`, wired at `plugins/publishings/xhs-pub/src/flow.ts:508` title, `plugins/publishings/xhs-pub/src/flow.ts:530` body, `plugins/publishings/xhs-pub/src/flow.ts:872` podcast); unreadable/`kk-counter-none` counters stay silent so modes.ts client caps remain the gate; tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3043` (asserts zero `clickAt` calls — refusal precedes save), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3051`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3057` |
| R3 | MET | `verifyDraft` reopens via 草稿箱 → 编辑 (`plugins/publishings/xhs-pub/src/flow.ts:1162`, `plugins/publishings/xhs-pub/src/flow.ts:1193`), asserts slot count, all-`https:` srcs (`plugins/publishings/xhs-pub/src/flow.ts:1165`), title, body counter/textLen, 合集 membership (`plugins/publishings/xhs-pub/src/flow.ts:1246`); every violated assertion named in one `DraftVerifyError` (`plugins/publishings/xhs-pub/src/flow.ts:1198` and siblings); expectation per mode via `draftExpectation` (`plugins/publishings/xhs-pub/src/flow.ts:1144`); exits via `goto(PUBLISH_URL)` without re-saving (a 暂存离开 would shift the draft counter the next run baselines against); `draftVerified` metadata on Result; tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3062`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3069`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3075`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3081`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3087`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3093`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3099` |
| R4 | MET | `applyPodcastFields` (`plugins/publishings/xhs-pub/src/flow.ts:861`) fills title + counter-asserts, types the derived body, clicks 合集 chip + collection entry; `derivePodcastBody` (`plugins/publishings/xhs-pub/src/flow.ts:833`) derives intro + `·` headlines + closing within `XHS_NOTE_BODY_MAX` with a hard `.slice` cap; collection from `metadata.collection` else the show default (`plugins/publishings/xhs-pub/src/flow.ts:816`); tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3105` (title fill, ≤1000 typed body, chip click, `draftVerified.collection`), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3118` (custom collection wins), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3124`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3137`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3146` (pure derivation caps/drops/fallback) |
| R5 | MET | Constraint honored, no work: transport/launcher/profile/`invokeHostSave`/durable-src wait untouched by the diff; vendor's count-based upload wait explicitly not adopted (durable-src wait kept in flow, unmodified) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Draft-save −913x capture → `AccountRiskControlError` "not retryable" and biz-code capture → `PublishError` (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3009`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3018`); note_id success confirmed from the observed response in `metadata.serverCapture` {source, verdict ok, code, noteId} (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3027`); publish path refuses on captured refusal pre-URL-marker (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3035`); full gate `spur self exec check` PASS receipt `.spur/run/0350-check-receipt.json` (tier full, inputDigest 4f098088bfad11a77f9a3845) |
| AC2 | MET | test | Over-limit readable counter throws `TitleTooLongError` quoting `counter reads '23/20'` before any save click — zero `clickAt` calls asserted (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3043`); body variant `ContentTooLongError` at `1001/1000` (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3051`); unreadable counter text ignored, not fatal (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3057`) |
| AC3 | MET | test | Reopen failures are loud and named per assertion: slot mismatch "expected 2 thumbnails" (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3062`), non-https srcs (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3069`), title mismatch (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3075`), empty body (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3081`), missing 合集 (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3087`), missing draft-box entry (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3093`), missing 编辑 control (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3099`) — all `DraftVerifyError`; passing-shape path proven by the 5 draft-mode happy paths + podcast verify (`draftVerified` metadata, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3105`) |
| AC4 | MET | test | Podcast note carries non-empty title (fill recorded, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3105`), counter-verified ≤1000-unit body (R2 assert at `plugins/publishings/xhs-pub/src/flow.ts:872` runs after the typed body; the test asserts typed length ≤1000 at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3105`), collection selection recorded in `draftVerified.collection` (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3105` default, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:3118` custom) — no manual repair step in the flow |
| AC5 | MET | command | 143 pass / 0 fail plugin suite (`bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`, root cwd); full monorepo gate 4882 pass / 0 fail incl. legacy `thumbnail count:` prefix tests and `_onSave`/`shadow-host-method` contract tests (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:584`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:586`) — receipt PASS at tier full |
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

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-10T23:56:17.762Z backlog → todo (system)
- 2026-11-11T01:39:39.645Z todo → wip (system)

