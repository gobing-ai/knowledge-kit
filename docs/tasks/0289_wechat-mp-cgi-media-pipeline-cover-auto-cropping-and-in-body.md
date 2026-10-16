---
schema_version: 1
name: "WeChat MP CGI media pipeline: cover auto-cropping and in-body image CDN migration"
status: done
template: feature-impl
created_at: 2026-10-15T05:55:12.423Z
updated_at: "2026-10-16T07:29:12.146Z"
feature_id: E96

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0289-verdict.json
---

## 0289. WeChat MP CGI media pipeline: cover auto-cropping and in-body image CDN migration

### Background

WeChat MP CGI media pipeline: cover auto-cropping and in-body image CDN migration is valid planned work in E96; the requested package/helper is not implemented in the current tree. Existing publish-harness browser/session/lease/upload/shadow helpers and current WeChat modes are the reuse baseline, not a blank scaffold. The historical review is not evidence of live platform capability.

**Refine corrections (2026-10-14)**

- A one-line CGI design omitted payload/session contracts → source filetransfer requires token/ticket/user_name and returns content/cdn_url → freeze request/response validators and a provided-session API.
- Vendor crop_list uses unrelated hard-coded pixels → actual dimensions must determine crop coordinates → calculate normalized and absolute centered crops; reject invalid dimensions/receipts.
- uploadimg2cdn was implied to handle all local URLs → WeChat fetches public image URLs, not host-local files → define explicit local file mapping and bounded multipart bridge, no localhost asset server.
- Universal external-link prohibition and silent failed-image retention were inherited → these are vendor conventions, not verified policy or successful migration → normalize only requested external links and fail required-image migration.
- Generic tests/integration ownership were insufficient → 0290 consumes media and owns runMode dispatch → freeze helper-only ownership, real page-side request tests and add 0290→0289 dependency.

Verified source: exact extension v0.1.55 recovered read-only from Google's extension update service, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425; relevant weixin.js:39–200,230–289. File hashes and durable inspected copies are in .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. The extension was not installed or executed. Browser candidate controls/private protocol are source observations only, not a verified authenticated live run. All local issues remain valid implementation outcomes; no issue dropped. At kickoff one main worktree/no wip task was observed, while 0287 kk-core and Board edits existed concurrently and must not be reverted. Bun 1.4.3, Playwright 1.55.0 and Biome 2.5.15 match pins; final corpus writes use latest bun-global Spur. Recheck ownership/environment drift at implementation step 0.

### Requirements

- [x] R1. Implement the article cover filetransfer scene=8 upload and validated same-origin session inputs in wechatmp-pub/src/cgi.ts, preserving existing mode validation and unrelated DOM flows.
- [x] R2. Compute centered 2.35:1 and 1:1 crop coordinates from actual image dimensions and validate both crop_multi receipts with stable file IDs/URLs; do not use vendor hard-coded pixel coordinates.
- [x] R3. Migrate bounded article body images to validated WeChat CDN URLs, distinguishing already-CDN, public HTTP(S) transfer and explicitly provided local file mappings; a failed required image blocks draft creation.
- [x] R4. Normalize external article anchors to spans while preserving nested text/markup; parse HTML as a document, refuse dangerous schemes, never evaluate content or claim a universal WeChat policy.
- [x] R5. Exercise production request construction, multipart fields, image/crop parsing and DOM transformations with unit and real-browser fixture tests; provide a typed prepared-media handoff to 0290.

### Acceptance Criteria

- [x] AC3 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4, R5)

- [x] AC1 — R2 - Dual-aspect cover upload and auto-crop (req: R1, R2, R5)
- [x] AC2 — R3 - Body image migration and link sanitization (req: R3, R4, R5)

```gherkin
Feature: WeChat MP CGI media pipeline: cover auto-cropping and in-body image CDN migration

  Scenario: AC1 — R2 - Dual-aspect cover upload and auto-crop (req: R1, R2, R5)
    Given an article with a cover image
    When the cover is processed
    Then it is uploaded to `/cgi-bin/filetransfer`
    And cropped to 2.35:1 and 1:1 dimensions via `/cgi-bin/cropimage`

  Scenario: AC2 — R3 - Body image migration and link sanitization (req: R3, R4, R5)
    Given article HTML containing external images and hyperlinks
    When content preparation executes
    Then external images are uploaded via `/cgi-bin/uploadimg2cdn` and replaced with WeChat CDN URLs
    And external `<a>` hyperlinks are converted to `<span>` tags

  Scenario: AC3 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4, R5)
    Given the production implementation, isolated profile probes and its named real-browser fixture runner
    When invalid payloads, unsupported requested fields, missing controls, stale or malformed receipts and timeout paths are exercised
    Then failures preserve draft and operation boundaries and never claim unobserved completion
    And mapping fake tests remain separate from actual page behavior and packed entry and check resolution

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T06:14:42.094Z

Closed by inline ready refinement 2026-10-14: the Design freezes payload/operation/status boundaries, source-grounded or explicitly provisional controls, refusal/receipt handling, file ownership and test layer.  Provider/UI drift and operator-run live acceptance are delivery checks owned by this WBS, not invented current facts. Existing unsupported requested fields fail explicitly. No task cancellation/merge/link is authorized or needed.

### Design

Own src/cgi.ts, src/cgi-media.ts, tests/wechatmp-cgi-media.test.ts and tests/fixtures/wechatmp-cgi-runner.ts; page.ts changes only if a minimal typed evaluation bridge is needed. Preserve runMode integration for 0290; this task is independently testable with a provided session. Frozen types: WechatCgiSession={token:string,ticket:string,userName:string,uin?:string}; WechatUploadedImage={fileId:string,url:string,width:number,height:number}; WechatArticleMedia={html:string,cover:{wide:WechatUploadedImage,square:WechatUploadedImage},images:WechatUploadedImage[]}. prepareArticleMedia(page:WechatPage, session:WechatCgiSession, input:{html:string,coverPath:string,localImages:Record<string,string>}):Promise<WechatArticleMedia> validates the whole result or throws a bounded named error. 0290 owns extracting a session and converting the result to Result; 0289 never imports a future extractor.

All credentialed calls execute inside an authenticated https://mp.weixin.qq.com page; assert that exact origin before evaluation and before dispatch. page.evaluate accepts an expression string today; encode data with JSON.stringify into a self-contained script, never interpolate raw HTML/tokens into code or eval operator text. Session/response secrets must not leave the browser except for the minimal typed outcome. Local files are read via FileSystem after validation and transferred as base64 image payloads only, max 10 MiB/file, 20 MiB aggregate, 30 distinct body sources; validated bytes/MIME preserve real filename/extension. Reject unknown local paths, file:/blob:/data: input URLs without explicit localImages mappings; resolve relative URLs against a supplied verified article origin or refuse them. Reuse already-CDN only for exact mmbiz.qpic.cn HTTPS host (not suffix matching). Public remote sources must be public HTTP(S) without credentials/local-IP literals; no arbitrary host-side fetch. Deduplicate exact sources and record all affected img nodes.

Freeze form fields from recovered source: filetransfer query action=upload_material,f=json,scene=8,writetype=doublewrite,groupid=1,ticket_id=userName,ticket,svr_time,token,lang=zh_CN,seq,t; multipart type,id,name,lastModifiedDate,size,file. Require HTTP success, base_resp.ret absent or zero plus err_msg=ok, a nonempty numeric content file ID and allowed HTTPS CDN URL. cropimage?action=crop_multi multipart imgurl,size_count=2,size0/1_x1/y1/x2/y2,token,lang,f,ajax. Require exactly two result entries with cdnurl/file_id matching expected order. uploadimg2cdn query lang/token/t and multipart imgurl,t=ajax-editor-upload-img,token,lang,f=json,ajax=1; require errcode=0,file_id,url. Bound every response to 2 MiB, 30s/request and 180s preparation deadline; no automatic upload retry. Page-side AbortController and redirect refusal prevent credentials following another origin. Use DOMParser in the browser for img/a transformations; reject script/event attributes and dangerous URL schemes. No regex-only HTML replacement. Credentials and signed/query URLs are never persisted in Result/logs.

Tests observe FormData and actual production page transformations through mocked endpoint routes within synthetic authenticated-origin fixtures. Assert foreign-origin refusal, exact field keys, local mapping/dedup/body partial failure, URLs/retcodes, dimensions/crops and preserved nested markup. No fake transport substituting for the CGI helper. This is private, versioned compatibility behavior based on extension v0.1.55, not an official WeChat API guarantee.

Follow ADR-007/009/012/016/022/027/029/032/038 and docs/design/publish-plugin-specification.md. Existing plugins expose Content → Result, not TargetOutcome (fan-out owns that aggregate). No new plugin kind, transport, runtime, dependency or generic automation framework. For new channels copy only the current package/tsconfig/CLI skeleton from weibo-pub or juejin-pub, importing shared packages by @gobing-ai names. Manifest operations is the auxiliary IO-form map, not a list of publishing verbs: omit it for ordinary Content → Result publishing types; dispatch a frozen local operation list using options.operation ?? content.metadata.operation ?? default before browser/profile creation. driver defaults to script and other values fail by name. Use check/profile-check.ts + browserSession {profileName:<channel>,homeUrl:<fixed non-secret entry>} for installed bot integration. Preserve --in/--out, valid ResultSchema output, stdout routing and exit semantics. API-only paths must not load Playwright eagerly.

Frozen common payload rules for new channels: Content.body is Markdown/text as the operation requires, title is a required nonempty string for article/podcast/video operations; metadata.publishStatus is absent|draft|public, default draft; metadata.coverPath is an optional existing local PNG/JPEG/WebP file; metadata.images is an optional array of existing local image paths; metadata.tags/categories are optional arrays of nonempty exact names. Reject wrong types, missing required assets, unsupported requested fields and unknown operations/status/driver before opening a browser; never silently truncate or invent media/fields. File IO uses the sanctioned FileSystem seam. Media paths resolve as current peer plugins do; require regular readable nonempty files and accepted extension/MIME, no automatic remote downloads or blob URL server. For audio/video use Playwright setInputFiles on the local path (streamed by the browser), never read entire media into JSON/base64. Existing uploadFile suffices for one file; page/locator.setInputFiles(paths) handles multiple. No dependency on 0287 content limits or 0288 hooks: channel validation is local and those are independent capabilities, avoiding out-of-set blockers and silent ownership changes.

Profile/readiness: reuse resolveChannelProfileDir, checkChannelSession, kkBrowserLauncher and runProfileCli including login/check/open behavior and current lease protection. The channel predicate must observe a site-owned composer/control and reject login redirects; page body mentioning 登录 is insufficient. Publish preflight uses headedFallback=false; interactive login remains operator-owned. Close the opened context in finally. Poll via waitUntil/expectOutcome, 30s per normal step and 600s media processing ceiling, no blind sleep or unbounded retry. A successful fill/file assignment is not a saved draft or publication. Snapshot baseline URLs/toasts/cards before submit; require a new operation-specific receipt or persisted item with matching title/body/media identity. Missing/ambiguous/stale/contradictory confirmation returns ok:false with bounded error and metadata.stage/evidence; never invent id/url or retry a possibly accepted create/publish. Only safe UI-field operations can be retried before submission. No mandatory source-derived numeric platform limit is asserted without a dated primary source; observed control constraints and explicit local resource caps are labeled as such.

Testing: FakeBrowserTransport verifies mapping/CLI only; it cannot establish real page behavior. The named local Chromium fixture runner must execute production selectors, scripts and flows, return observable field/event/action/receipt facts, and throw on missing browser prerequisites rather than skip. Extend each plugin's tests for payload refusal, profile missing/login redirects, default draft, explicit public, requested unsupported fields, upload processing/error/cancel/timeout, stale signals and cleanup. Isolate fake mode and fixture origins; zero live account writes or provider calls in CI. Package acceptance must discover and invoke the packed plugin and its check entry outside the checkout, since scripts/bundle-plugins.ts bundles product entry/check and prunes tests. Add only the relevant package regression, no publisher registry because discovery already scans collections.

Live UI candidate selectors are evidence dated 2026-10-14 from the recovered extension or current public application bundle; they are not proof a particular account is entitled or that current publishing succeeds. Implementation must run a read-only capability probe and fail clearly if a required candidate/control is absent. Real operator-run draft/live verification is a separate delivery check; fixture PASS alone must not be described as live platform support. Same-change docs/04_DESIGN.md for shipped surface; docs/05_FEATURES.md only on actual feature state change. Budget boundary preserves artifacts and resumes current contracts; requireDiff is implementation plus behavior tests and surface docs.

Dependencies/handoff: No prerequisites. 0290 consumes these helpers and owns session extraction/create/flow dispatch. Changes remain scoped to named files. Estimate 12h/P2; no source implementation during refine.

### Plan

- [x] Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
- [x] (R1,R2) Freeze session/media validators, bounded image-byte bridge and typed CGI request construction from the recorded source; compute and test actual centered crop geometry.
- [x] (R3,R4) Implement page-side DOMParser transformation, image-source classification/dedup, response validation and all-or-error output; preserve caller HTML and unrelated flows on failure.
- [x] (R1–R5) Run wechatmp-cgi-media.test.ts and real-page CGI fixture runner against route-controlled receipts; exercise credential origin, malformed/oversize/timeouts and prevent downstream create after failed preparation.
- [x] (R5) Hand 0290 the exact media types/functions; retain all current wechatmp DOM/mode/profile tests and document limits.
- [x] Update docs/04_DESIGN.md with this shipped surface in the same change; align relevant feature notes/status only after real delivery.

### Solution

- R1+R2 cover pipeline: `plugins/publishings/wechatmp-pub/src/cgi.ts:31` `WechatCgiError` (bounded reasons: wrong-origin, http-status, response-too-large, bad-receipt, network-error); `plugins/publishings/wechatmp-pub/src/cgi.ts:51` `WechatCgiSession`; `:58` `WechatUploadedImage`; `:100` `centerCropRect` (pure centered 2.35:1/1:1 geometry from actual dims); `:138`/`:152` byte validators (PNG/JPEG/WebP, ≤10 MiB, real ext/MIME); `:406` `uploadCoverImage` (frozen filetransfer scene=8 query+multipart); `:437` `cropCoverMulti` (crop_multi with size0/1 boxes); `:468` `uploadAndCropCover` (upload→crop→order-validated receipt pair). Origin gate asserts exact `https://mp.weixin.qq.com` before any dispatch; 2 MiB response cap, 30 s AbortController timeout, no retry.
- R3+R4 body media: `plugins/publishings/wechatmp-pub/src/cgi-media.ts:25` `WechatMediaError`; `:42`/`:48` frozen input/result types; `:144` DOMParser-in-page transform (anchor→span with nested markup preserved, on*/javascript:/data:/vbscript: attributes dropped, exact-src dedupe); classification — exact-host `mmbiz.qpic.cn` HTTPS passthrough, public HTTP(S) via frozen `uploadimg2cdn` contract (`:255` receipt validation `errcode=0+file_id+url`, `:283` request), `localImages` base64 bridge (≤10 MiB/file, 20 MiB aggregate, ≤30 sources); `:331` `prepareArticleMedia` all-or-error (`WechatArticleMedia={html,cover:{wide,square},images}`), 180 s deadline, caller HTML preserved on throw.
- R5 tests: `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts` (26 tests / 132 expects: origin refusal, exact field keys, mapping/dedup/partial-failure, receipt validation, crop math, anchor normalization, dangerous-scheme rejection, bounds); `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts` (real-Chromium runner, 20 s hard launch/nav timeouts, throws on missing browser — never skips). Coverage: cgi.ts 100% lines/funcs, cgi-media.ts 94.4% lines/99.5% funcs (≥90% gate). plugin suite 126 pass / 0 fail.
- Surface: `docs/04_DESIGN.md` wechatmp-pub export table gains the CGI media rows (same commit). 0290 handoff: consume `WechatCgiSession`/`WechatArticleMedia`/`prepareArticleMedia`; session extraction and Result conversion stay 0290's.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Frozen filetransfer scene=8 query `plugins/publishings/wechatmp-pub/src/cgi.ts:379-384`; same-origin gate `plugins/publishings/wechatmp-pub/src/cgi.ts:406`; `uploadCoverImage` `plugins/publishings/wechatmp-pub/src/cgi.ts:411`; receipt validation `plugins/publishings/wechatmp-pub/src/cgi.ts:303-319`. Tested by `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:172` and `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:187`; `bun run test` 3750 pass / 0 fail (2026-10-16). |
| R2 | MET | `centerCropRect` from actual dimensions `plugins/publishings/wechatmp-pub/src/cgi.ts:105`; `uploadAndCropCover` computes wide 2.35:1 + square 1:1 from the upload receipt dims `plugins/publishings/wechatmp-pub/src/cgi.ts:473-481`; crop_multi receipt requires exactly two ordered entries `plugins/publishings/wechatmp-pub/src/cgi.ts:333`. Tested `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:105`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:259`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:280`. |
| R3 | MET | `prepareArticleMedia` `plugins/publishings/wechatmp-pub/src/cgi-media.ts:331` bounds sources `plugins/publishings/wechatmp-pub/src/cgi-media.ts:342`, passes exact-host CDN through `plugins/publishings/wechatmp-pub/src/cgi-media.ts:355`, uploads mapped local files `plugins/publishings/wechatmp-pub/src/cgi-media.ts:356-367`; uploadimg2cdn receipt `plugins/publishings/wechatmp-pub/src/cgi-media.ts:255`. Failed required image blocks with no mutated HTML: `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:664`; migration paths `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:394`. |
| R4 | MET | In-page DOMParser `plugins/publishings/wechatmp-pub/src/cgi-media.ts:146`; dangerous schemes refused `plugins/publishings/wechatmp-pub/src/cgi-media.ts:147-149` and `on*` attrs dropped `plugins/publishings/wechatmp-pub/src/cgi-media.ts:154`; anchors → spans preserving children `plugins/publishings/wechatmp-pub/src/cgi-media.ts:157-160`. Real-Chromium DOM normalization `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:524`. |
| R5 | MET | Typed handoff `WechatArticleMedia` `plugins/publishings/wechatmp-pub/src/cgi-media.ts:48`; real-Chromium fixture suite `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:508` with runner `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts:94` and missing-browser failure `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:752`; surface rows `docs/04_DESIGN.md:1260-1261`. Coverage: `plugins/publishings/wechatmp-pub/src/cgi.ts` 100.00% / 100.00%, `plugins/publishings/wechatmp-pub/src/cgi-media.ts` 94.44% funcs / 99.51% lines. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 - Dual-aspect cover upload and auto-crop | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:259` both crop rects in the frozen crop_multi shape; `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:105` actual-dims crop math; `bun run test` exit 0. |
| R3 - Body image migration and link sanitization | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:524` real-Chromium endpoints, DOM normalization, dedup, replacements; `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:664` failure blocks; `bun run test` exit 0. |
| AC3 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4, R5) | MET | command | `bun run test` 3750 pass / 0 fail exit 0 and `bun run lint` exit 0 on 2026-10-16; refusal paths `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:745` (non-mp origin) and `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts:709` (response bound). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Parent feature E96; docs/design/publish-plugin-specification.md; docs/00_ADR.md ADR-022/026/027/029/032/038.
- Existing seams: packages/kk-core/src/schemas.ts:16,36,48; packages/kk-core/src/manifest.ts:59; packages/publish-harness/src/index.ts:8; packages/publish-harness/src/browser.ts:169,325,436,553,610,737.
- WeChat callers: plugins/publishings/wechatmp-pub/src/flow.ts:245,1137; src/index.ts:254,310; src/modes.ts:144; tests/fixtures/wechatmp-dom-runner.ts.
- Source snapshot: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json; weixin.js:39–200,230–289; historical review docs/design/yijianfa-extension-review.md.
- Report: docs/plans/2026-10-14-publish-ready-refinement.md.
- Concurrency: one main worktree/no wip task at kickoff; concurrent 0287 and Board work preserved.
- Primary Playwright input/shadow contracts: https://playwright.dev/docs/input#upload-files and https://playwright.dev/docs/locators#locate-in-shadow-dom.

### History

- 2026-10-15T06:14:43.272Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.
- 2026-10-15T10:08:41.024Z todo → wip (system)
- 2026-10-15T10:08:41.386Z wip → testing (system)
- 2026-10-15T10:08:41.768Z testing → done (system)

