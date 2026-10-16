---
schema_version: 1
name: WeChat MP CGI draft creation and token extraction flow refactor
status: done
template: feature-impl
created_at: 2026-10-15T05:55:12.718Z
updated_at: "2026-10-16T07:30:40.413Z"
feature_id: E96

ac_altitude: task-local
ac_numbering: task-local
dependencies: ["0289"]
priority: P2
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0290-verdict.json
---

## 0290. WeChat MP CGI draft creation and token extraction flow refactor

### Background

WeChat MP CGI draft creation and token extraction flow refactor is valid planned work in E96; the requested package/helper is not implemented in the current tree. Existing publish-harness browser/session/lease/upload/shadow helpers and current WeChat modes are the reuse baseline, not a blank scaffold. The historical review is not evidence of live platform capability.

**Refine corrections (2026-10-14)**

- TargetOutcome was named as plugin output → runMode and transport return shared Result → use Result.id/url/metadata; fan-out alone constructs TargetOutcome.
- Entire runMode replacement would remove four modes and verified advanced settings → existing article/audio/enrichment contracts remain active → CGI is eligible plain-article draft dispatch, preserving all other DOM routes.
- token/ticket/uin alone were said sufficient → filetransfer ticket_id is user_name → extract required user_name, keep optional uin transient and freeze missing-session refusal.
- No prerequisite was recorded for prepared cover/body images → media implementation is 0289 → add explicit dependency and consume its typed helper without re-owning upload/crop.
- Unverified <3s speed and create receipt alone implied success → no benchmark or persisted UI check exists → remove timing promise, require validated appMsgId and readback, and forbid ambiguous create retry.

Verified source: exact extension v0.1.55 recovered read-only from Google's extension update service, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425; relevant weixin.js:39–76,340–464,585–605. File hashes and durable inspected copies are in .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. The extension was not installed or executed. Browser candidate controls/private protocol are source observations only, not a verified authenticated live run. All local issues remain valid implementation outcomes; no issue dropped. At kickoff one main worktree/no wip task was observed, while 0287 kk-core and Board edits existed concurrently and must not be reverted. Bun 1.4.3, Playwright 1.55.0 and Biome 2.5.15 match pins; final corpus writes use latest bun-global Spur. Recheck ownership/environment drift at implementation step 0.

### Requirements

- [x] R1. Extract and validate transient token/ticket/user_name/uin session data inside the authenticated WeChat page with URL-token precedence and bounded known script fields; missing required values refuse CGI without leaking secrets.
- [x] R2. Route eligible plain 文章 draft runs through same-origin operate_appmsg using 0289 prepared media and validated request/receipt fields; preserve existing DOM flows for advanced article metadata, other modes and public operations.
- [x] R3. Return ResultSchema with verified draft id and a secret-free canonical edit URL, metadata.operation/publishStatus and receipt evidence; no TargetOutcome type or fabricated publication status.
- [x] R4. Preserve existing CLI, operation selection, mode validation, profile preflight, fake transport seams and all valid committed-state/audio/settings behavior; ambiguous create timeout does not retry or fall back to duplicate creation.

### Acceptance Criteria

- [x] AC3 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)

- [x] AC1 — R1 - Session token extraction from page context (req: R1, R4)
- [x] AC2 — R4 - Draft creation via operate_appmsg (req: R2, R3, R4)

```gherkin
Feature: WeChat MP CGI draft creation and token extraction flow refactor

  Scenario: AC1 — R1 - Session token extraction from page context (req: R1, R4)
    Given an authenticated mp.weixin.qq.com browser context
    When an eligible plain article draft initializes
    Then token, ticket and user_name are validated in-page, with optional uin and no secret output

  Scenario: AC2 — R4 - Draft creation via operate_appmsg (req: R2, R3, R4)
    Given an eligible plain article draft with prepared title, cover, and sanitized HTML
    When calling `/cgi-bin/operate_appmsg`
    Then a new appmsg draft is created and the valid draft id is returned through Result.id with a secret-free edit URL

  Scenario: AC3 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)
    Given the production implementation, isolated profile probes and its named real-browser fixture runner
    When invalid payloads, unsupported requested fields, missing controls, stale or malformed receipts and timeout paths are exercised
    Then failures preserve draft and operation boundaries and never claim unobserved completion
    And mapping fake tests remain separate from actual page behavior and packed entry and check resolution

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T06:14:44.599Z

Closed by inline ready refinement 2026-10-14: the Design freezes payload/operation/status boundaries, source-grounded or explicitly provisional controls, refusal/receipt handling, file ownership and test layer. Owner 0290 must apply the specified ADR-026 amendment before implementation; its content and preservation scope are frozen, not an unanswered architecture decision. Provider/UI drift and operator-run live acceptance are delivery checks owned by this WBS, not invented current facts. Existing unsupported requested fields fail explicitly. No task cancellation/merge/link is authorized or needed.

### Design

Depends on 0289 WechatCgiSession/WechatArticleMedia/prepareArticleMedia and its validators. Own src/cgi-draft.ts, flow.ts runMode dispatch and index.ts only for integration; retain page wrapper/CLI seams and existing modes.ts. Tests: tests/wechatmp-cgi-draft.test.ts plus existing wechatmp-pub.test.ts, wechatmp-dom.test.ts and default-launcher/profile regressions. Add extractWechatCgiSession(page):Promise<WechatCgiSession> and createWechatArticleDraft(page,session,content,media):Promise<{appMsgId:string,editPath:string}>; no public API outside plugin.

Eligibility is deterministic before any upload/create: operation=文章, publishStatus=draft, required cover validated, and only plain title/body/digest/author metadata. Any audio block, layout/settings/original/reward/source/collection metadata or unsupported field stays on current DOM path so no requested feature is discarded. Use an explicit allowed metadata set and exclude generic routing/provenance metadata from content-feature checks. Preserve all non-article modes and public DOM behavior; CGI creates drafts only, never mass-send. Extract current URL token first, then only known inline field assignments for token/ticket/user_name/uin from a max 2 MiB DOM/script snapshot; do not eval scripts or export snapshots. uin is optional because draft source uses token and media upload requires ticket/user_name. Missing required fields refuse the eligible CGI route before mutation with a bounded session error; no automatic cookie export or unsafe fallback after any request.

Build operate_appmsg?t=ajax-response&sub=create&type=77&token=<session>&lang=zh_CN. Multipart baseline fields are frozen from source createArticleDraft lines 385–447: token/lang/f/ajax/random/AppMsgId='',count=1,data_seq=0,operate_from=Chrome,isnew=0; title0,author0,digest0,auto_gen_digest0=0,content0,sourceurl0=''; cover cdn_url0/cdn_235_1_url0/cdn_1_1_url0/cdn_url_back0 and dimension-derived crop_list0; share_page_type0=0,share_imageinfo0={list:[]},categories_list0=[],compose_info0={list:''}; remaining vendor scalar feature fields retain its explicit inactive defaults in a checked-in request fixture and builder test, never arbitrary account or operator overrides. Do not silently clamp title/digest: current modes.ts validation owns limits. Use 0289 crop identities/actual coordinates, not vendor hard-coded 1178px values. Credentials/requests stay in browser; same origin, redirects refused, 30s/request, 120s total draft stage, 2 MiB response limit.

Require HTTP success, no nonzero base_resp.ret, and a nonempty safe numeric appMsgId. Read back the editor/draft record for that id and requested title before ok:true. Public Result.url is https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&isNew=0&type=77&appmsgid=<id> without token; session-aware browser navigation can add a transient token internally. Unknown/malformed/auth/rate errors and timeout return ok:false, metadata.stage/ambiguousSubmission as applicable; never retry create, regenerate or auto-switch to DOM after dispatch. Do not claim draft as published.

Authority precondition owned by 0290: before implementation, amend ADR-026 in a dated entry to permit this authenticated-browser same-origin CGI subpath while retaining draft/session/manual-live guarantees, then synchronize 03/04 under constitution. The refinement freezes that exact amendment; it does not change current shipped execution. This is not a new token-API transport and introduces no AppID/secret dependency. Validate against the recovered private protocol and retained DOM behavior, not a latency claim.

Follow ADR-007/009/012/016/022/027/029/032/038 and docs/design/publish-plugin-specification.md. Existing plugins expose Content → Result, not TargetOutcome (fan-out owns that aggregate). No new plugin kind, transport, runtime, dependency or generic automation framework. For new channels copy only the current package/tsconfig/CLI skeleton from weibo-pub or juejin-pub, importing shared packages by @gobing-ai names. Manifest operations is the auxiliary IO-form map, not a list of publishing verbs: omit it for ordinary Content → Result publishing types; dispatch a frozen local operation list using options.operation ?? content.metadata.operation ?? default before browser/profile creation. driver defaults to script and other values fail by name. Use check/profile-check.ts + browserSession {profileName:<channel>,homeUrl:<fixed non-secret entry>} for installed bot integration. Preserve --in/--out, valid ResultSchema output, stdout routing and exit semantics. API-only paths must not load Playwright eagerly.

Frozen common payload rules for new channels: Content.body is Markdown/text as the operation requires, title is a required nonempty string for article/podcast/video operations; metadata.publishStatus is absent|draft|public, default draft; metadata.coverPath is an optional existing local PNG/JPEG/WebP file; metadata.images is an optional array of existing local image paths; metadata.tags/categories are optional arrays of nonempty exact names. Reject wrong types, missing required assets, unsupported requested fields and unknown operations/status/driver before opening a browser; never silently truncate or invent media/fields. File IO uses the sanctioned FileSystem seam. Media paths resolve as current peer plugins do; require regular readable nonempty files and accepted extension/MIME, no automatic remote downloads or blob URL server. For audio/video use Playwright setInputFiles on the local path (streamed by the browser), never read entire media into JSON/base64. Existing uploadFile suffices for one file; page/locator.setInputFiles(paths) handles multiple. No dependency on 0287 content limits or 0288 hooks: channel validation is local and those are independent capabilities, avoiding out-of-set blockers and silent ownership changes.

Profile/readiness: reuse resolveChannelProfileDir, checkChannelSession, kkBrowserLauncher and runProfileCli including login/check/open behavior and current lease protection. The channel predicate must observe a site-owned composer/control and reject login redirects; page body mentioning 登录 is insufficient. Publish preflight uses headedFallback=false; interactive login remains operator-owned. Close the opened context in finally. Poll via waitUntil/expectOutcome, 30s per normal step and 600s media processing ceiling, no blind sleep or unbounded retry. A successful fill/file assignment is not a saved draft or publication. Snapshot baseline URLs/toasts/cards before submit; require a new operation-specific receipt or persisted item with matching title/body/media identity. Missing/ambiguous/stale/contradictory confirmation returns ok:false with bounded error and metadata.stage/evidence; never invent id/url or retry a possibly accepted create/publish. Only safe UI-field operations can be retried before submission. No mandatory source-derived numeric platform limit is asserted without a dated primary source; observed control constraints and explicit local resource caps are labeled as such.

Testing: FakeBrowserTransport verifies mapping/CLI only; it cannot establish real page behavior. The named local Chromium fixture runner must execute production selectors, scripts and flows, return observable field/event/action/receipt facts, and throw on missing browser prerequisites rather than skip. Extend each plugin's tests for payload refusal, profile missing/login redirects, default draft, explicit public, requested unsupported fields, upload processing/error/cancel/timeout, stale signals and cleanup. Isolate fake mode and fixture origins; zero live account writes or provider calls in CI. Package acceptance must discover and invoke the packed plugin and its check entry outside the checkout, since scripts/bundle-plugins.ts bundles product entry/check and prunes tests. Add only the relevant package regression, no publisher registry because discovery already scans collections.

Live UI candidate selectors are evidence dated 2026-10-14 from the recovered extension or current public application bundle; they are not proof a particular account is entitled or that current publishing succeeds. Implementation must run a read-only capability probe and fail clearly if a required candidate/control is absent. Real operator-run draft/live verification is a separate delivery check; fixture PASS alone must not be described as live platform support. Same-change docs/04_DESIGN.md for shipped surface; docs/05_FEATURES.md only on actual feature state change. Budget boundary preserves artifacts and resumes current contracts; requireDiff is implementation plus behavior tests and surface docs.

Dependencies/handoff: 0289 provides shared session/media types and preparation; 0290 owns session extraction, create and runMode integration. Changes remain scoped to named files. Estimate 12h/P2; no source implementation during refine.

### Plan

- [x] Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
- [x] (R1,R4) Verify predecessor 0289 and write the specified dated ADR-026 amendment before source divergence; inspect current advanced metadata/mode callers and freeze eligibility plus preservation tests.
- [x] (R1,R2) Implement transient session extraction, deterministic eligibility and strict builder/receipt validators from the recorded source field fixture.
- [x] (R2,R3) Integrate prepareArticleMedia, one create request and id/title readback into runMode; map to shared Result with redacted URL and ambiguity failures.
- [x] (R1–R4) Execute production CGI scripts/builders through real-page route fixtures, then all existing WeChat mode/audio/settings/lease/CLI tests; cover malformed/auth/timeout/unknown receipts, no duplicate fallback, and public/non-article preservation.
- [x] Update docs/04_DESIGN.md with this shipped surface in the same change; align relevant feature notes/status only after real delivery.
- [x] Run project lint/tests/build/rules and task-pipeline review/traceable verify before done; fixture success is not a live account acceptance certificate.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/00_ADR.md:1100` |
| `docs/03_ARCHITECTURE.md:64` |
| `docs/04_DESIGN.md:1251` |
| `docs/04_DESIGN.md:1255` |
| `plugins/publishings/wechatmp-pub/src/cgi.ts:484` |
| `plugins/publishings/wechatmp-pub/src/cgi.ts:75` |
| `plugins/publishings/wechatmp-pub/src/flow.ts:1141` |
| `plugins/publishings/wechatmp-pub/src/flow.ts:1237` |
| `plugins/publishings/wechatmp-pub/src/flow.ts:6` |
| `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts:111` |
| `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts:151` |
| `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts:173` |
| `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts:18` |
| `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts:21` |
| `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts:212` |
| `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts:39` |
| `plugins/publishings/wechatmp-pub/tests/fixtures/wechatmp-cgi-runner.ts:81` |
| `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:1` |
| `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `extractWechatCgiSession` `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:234` takes the URL token first `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:174-175`, scans a bounded snapshot `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:176` capped by `MAX_SNAPSHOT_CHARS` `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:26`, keeps uin optional `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:193-194`, refuses by field name only `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:232`. Tested `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:269`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:318`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:345`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:373`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:388`. |
| R2 | MET | 文章 + draft gate routes to `runCgiDraft` `plugins/publishings/wechatmp-pub/src/flow.ts:1238-1239`; `runCgiDraft` `plugins/publishings/wechatmp-pub/src/flow.ts:1148` calls `createWechatArticleDraft` `plugins/publishings/wechatmp-pub/src/flow.ts:1197`; payload builder `buildCreateArticlePayload` `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:287`; eligibility gate `assertEligibleCgiDraft` `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:135`. Tested `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:231` (operate_appmsg create url), `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:624` (CGI branch, no DOM editor), `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:681` (advanced metadata keeps DOM), `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:725` (public skips CGI). |
| R3 | MET | `createWechatArticleDraft` `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:417` reads back via list_ex `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:479` and returns a token-free `editPath` `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:538`; Result id is the verified appMsgId `plugins/publishings/wechatmp-pub/src/flow.ts:1202` and url is origin + editPath `plugins/publishings/wechatmp-pub/src/flow.ts:1204`. `rg TargetOutcome` over cgi-draft.ts, flow.ts and wechatmp-pub tests returns 0 hits. Tested `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:416`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:476`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:486`. |
| R4 | MET | Ambiguous create maps to `ambiguousSubmission` `plugins/publishings/wechatmp-pub/src/cgi-draft.ts:407` with no retry, tested `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:459`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:496`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:508`, `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:654`; public status keeps the DOM path `plugins/publishings/wechatmp-pub/src/flow.ts:1249`; `bun run test` 3750 pass / 0 fail exit 0 (2026-10-16) covers the legacy DOM suites. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R1 - Session token extraction from page context (req: R1, R4) | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:269` URL token wins over inline token; `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:284` inline fallback with optional uin; `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:329` 2 MiB bound with field-name-only refusal; `bun run test` exit 0. |
| AC2 — R4 - Draft creation via operate_appmsg (req: R2, R3, R4) | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:624` eligible draft created once with secret-free url; `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:696` no-coverPath draft takes the first body image as cover; `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:476` readback title mismatch refuses; `bun run test` exit 0. |
| AC3 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4) | MET | command | `bun run test` 3750 pass / 0 fail and `bun run lint` exit 0 on 2026-10-16; `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:654` ambiguous create reports ok:false without retry or DOM fallback; `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts:667` media-preparation failure reports its stage with no create dispatch. |
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
- Source snapshot: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json; weixin.js:39–76,340–464,585–605; historical review docs/design/yijianfa-extension-review.md.
- Report: docs/plans/2026-10-14-publish-ready-refinement.md.
- Concurrency: one main worktree/no wip task at kickoff; concurrent 0287 and Board work preserved.
- Primary Playwright input/shadow contracts: https://playwright.dev/docs/input#upload-files and https://playwright.dev/docs/locators#locate-in-shadow-dom.

### History

- 2026-10-15T06:14:45.781Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.
- 2026-10-15T12:30:00.394Z todo → wip (system)
- 2026-10-15T12:30:20.419Z wip → testing (system)
- 2026-10-15T12:30:52.735Z testing → done (system)

