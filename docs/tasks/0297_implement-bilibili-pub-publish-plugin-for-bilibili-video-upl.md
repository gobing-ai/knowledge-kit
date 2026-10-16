---
schema_version: 1
name: Implement bilibili-pub publish plugin for Bilibili video uploads and dynamic posts
status: done
template: feature-impl
created_at: 2026-10-15T05:55:14.813Z
updated_at: "2026-10-16T01:52:14.919Z"
feature_id: E98

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 14
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0297-verdict.json
---

## 0297. Implement bilibili-pub publish plugin for Bilibili video uploads and dynamic posts

### Background

Implement bilibili-pub publish plugin for Bilibili video uploads and dynamic posts is valid planned work in E98; the requested package/helper is not implemented in the current tree. Existing publish-harness browser/session/lease/upload/shadow helpers and current WeChat modes are the reuse baseline, not a blank scaffold. The historical review is not evidence of live platform capability.

**Refine corrections (2026-10-14)**

- Manifest operations list conflated publishing verbs and auxiliary IO forms → use local BILIBILI_OPERATIONS with Content → Result, one shared channel/profile.
- Video and dynamic shared a generic success scenario → source has separate controls and final publish often unknown → split production fixture lenses and require strong per-operation receipts.
- Dynamic draft/live behavior was undefined → no evidenced draft flow exists → dynamic requires public explicitly before browser; video default draft never silently submits.
- Partition/cover/tag bounds and upload completion were unspecified → freeze exact requested choices/readback, reject overflow, use native file inputs and retain no source-side original-creation assumption.

Verified source: exact extension v0.1.55 recovered read-only from Google's extension update service, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425; relevant bilibili.js:158–287,293–556; bilibili-main.js:33–90. File hashes and durable inspected copies are in .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. The extension was not installed or executed. Browser candidate controls/private protocol are source observations only, not a verified authenticated live run. All local issues remain valid implementation outcomes; no issue dropped. At kickoff one main worktree/no wip task was observed, while 0287 kk-core and Board edits existed concurrently and must not be reverted. Bun 1.4.3, Playwright 1.55.0 and Biome 2.5.15 match pins; final corpus writes use latest bun-global Spur. Recheck ownership/environment drift at implementation step 0.

### Requirements

- [x] R1. Deliver one discoverable bilibili-pub channel plugin with local shortVideo and dynamic operation dispatch, shared session/profile and separate flow/selectors/postconditions per operation.
- [x] R2. Upload/process video, commit exact requested partition/title/tags/cover and verify a saved draft or submitted-video receipt according to draft/default or explicit public status.
- [x] R3. Populate text/images in the dynamic composer and publish only with explicit public, verifying a fresh matching post receipt rather than button click.
- [x] R4. Provide profile readiness, fake mapping and separate real production fixtures for both flows, invalid inputs, field readback, ambiguity/timeout and installed package operation selection.

### Acceptance Criteria

- [x] AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)

- [x] AC1 — R3 - bilibili-pub handles video and dynamic publishing (req: R1, R2, R3, R4)

```gherkin
Feature: Implement bilibili-pub publish plugin for Bilibili video uploads and dynamic posts

  Scenario: AC1 — R3 - bilibili-pub handles video and dynamic publishing (req: R1, R2, R3, R4)
    Given an authenticated Bilibili creator session and explicit public request
    When `bilibili-pub` executes operation `shortVideo` or `dynamic`
    Then video submission or dynamic publication has its own fresh verified receipt
    And video pending review is distinct from public availability

  Scenario: AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)
    Given the production implementation, isolated profile probes and its named real-browser fixture runner
    When invalid payloads, unsupported requested fields, missing controls, stale or malformed receipts and timeout paths are exercised
    Then failures preserve draft and operation boundaries and never claim unobserved completion
    And mapping fake tests remain separate from actual page behavior and packed entry and check resolution

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T06:15:00.359Z

Closed by inline ready refinement 2026-10-14: the Design freezes payload/operation/status boundaries, source-grounded or explicitly provisional controls, refusal/receipt handling, file ownership and test layer.  Provider/UI drift and operator-run live acceptance are delivery checks owned by this WBS, not invented current facts. Existing unsupported requested fields fail explicitly. No task cancellation/merge/link is authorized or needed.

### Design

Own plugin package only; target/profile=bilibili, BILIBILI_OPERATIONS=['shortVideo','dynamic'], default shortVideo. Both creator domains belong to this channel and share one profile; fixed profile-check home is https://member.bilibili.com/, dynamic entry is https://t.bilibili.com/. Probe operation-specific entitlements/readiness before editing. Neither operation is a second plugin or new transport. shortVideo requires title, metadata.videoPath local MP4/MOV, explicit metadata.partition nonempty exact visible category name, optional tags/cover. Resource cap 2 GiB and 600s processing are KK bounds; source UI limits title 80 characters/tags 10 are dated observed candidates and reject excess, never truncate. Dynamic requires nonempty Content.body text or images (max9 KK conservative v1 cap), optional title unsupported unless actual flow implements its optional title explicitly; no partition/video/cover/category/audio fields accepted. metadata.publishStatus absent/draft refuses dynamic pre-browser; public only. Video defaults draft with explicit persisted-save receipt, public means submission for platform review, not a promise of immediate availability.

Source video candidates: active upload form input[type=file] for video; input[maxlength="80"][type="text"] title, description editor scoped to video form, input[placeholder="按回车键Enter创建标签"], div.tag-pre-wrp > div.label-item-v2-container, cover div.cover-main and modal div.bcc-upload-wrapper > input[type=file][accept="image/png, image/jpeg"], scoped partition choice and span.submit-add public control. Do not auto-select source first radio/original choice. Require partition text/checked state, exact tags/title/body and processed video/media identity before one submission. Cover preview may be CSS background-image; compare the active cover slot after crop confirm, never unrelated recommended image.

Dynamic candidates: div[placeholder="有什么想和大家分享的？"][contenteditable="true"], its .bili-dyn-publishing scope, image upload input and preview .bili-pics-uploader__item/.bili-dyn-publishing__image-item, button.bili-dyn-publishing__action__launch. Reuse setInputFiles, resolving hidden/dynamic inputs natively; no dependency on vendor MAIN script or 0288 and no megabyte file postMessage bridge. Require text and image preview readback before send. Capture baseline posts/toasts before submit; new matching post URL/id or strong fresh receipt is needed. For video accepted submission receipt may carry aid/bvid/status=pending-review in Result.metadata; absence is ok:false ambiguous, not fabricated public URL. Never retry ambiguous submission or conflate submitted/review/published states. Default video draft with missing save control must fail explicitly rather than call span.submit-add. Separate fixture scenarios per operation and both status paths.

Follow ADR-007/009/012/016/022/027/029/032/038 and docs/design/publish-plugin-specification.md. Existing plugins expose Content → Result, not TargetOutcome (fan-out owns that aggregate). No new plugin kind, transport, runtime, dependency or generic automation framework. For new channels copy only the current package/tsconfig/CLI skeleton from weibo-pub or juejin-pub, importing shared packages by @gobing-ai names. Manifest operations is the auxiliary IO-form map, not a list of publishing verbs: omit it for ordinary Content → Result publishing types; dispatch a frozen local operation list using options.operation ?? content.metadata.operation ?? default before browser/profile creation. driver defaults to script and other values fail by name. Use check/profile-check.ts + browserSession {profileName:<channel>,homeUrl:<fixed non-secret entry>} for installed bot integration. Preserve --in/--out, valid ResultSchema output, stdout routing and exit semantics. API-only paths must not load Playwright eagerly.

Frozen common payload rules for new channels: Content.body is Markdown/text as the operation requires, title is a required nonempty string for article/podcast/video operations; metadata.publishStatus is absent|draft|public, default draft; metadata.coverPath is an optional existing local PNG/JPEG/WebP file; metadata.images is an optional array of existing local image paths; metadata.tags/categories are optional arrays of nonempty exact names. Reject wrong types, missing required assets, unsupported requested fields and unknown operations/status/driver before opening a browser; never silently truncate or invent media/fields. File IO uses the sanctioned FileSystem seam. Media paths resolve as current peer plugins do; require regular readable nonempty files and accepted extension/MIME, no automatic remote downloads or blob URL server. For audio/video use Playwright setInputFiles on the local path (streamed by the browser), never read entire media into JSON/base64. Existing uploadFile suffices for one file; page/locator.setInputFiles(paths) handles multiple. No dependency on 0287 content limits or 0288 hooks: channel validation is local and those are independent capabilities, avoiding out-of-set blockers and silent ownership changes.

Profile/readiness: reuse resolveChannelProfileDir, checkChannelSession, kkBrowserLauncher and runProfileCli including login/check/open behavior and current lease protection. The channel predicate must observe a site-owned composer/control and reject login redirects; page body mentioning 登录 is insufficient. Publish preflight uses headedFallback=false; interactive login remains operator-owned. Close the opened context in finally. Poll via waitUntil/expectOutcome, 30s per normal step and 600s media processing ceiling, no blind sleep or unbounded retry. A successful fill/file assignment is not a saved draft or publication. Snapshot baseline URLs/toasts/cards before submit; require a new operation-specific receipt or persisted item with matching title/body/media identity. Missing/ambiguous/stale/contradictory confirmation returns ok:false with bounded error and metadata.stage/evidence; never invent id/url or retry a possibly accepted create/publish. Only safe UI-field operations can be retried before submission. No mandatory source-derived numeric platform limit is asserted without a dated primary source; observed control constraints and explicit local resource caps are labeled as such.

Testing: FakeBrowserTransport verifies mapping/CLI only; it cannot establish real page behavior. The named local Chromium fixture runner must execute production selectors, scripts and flows, return observable field/event/action/receipt facts, and throw on missing browser prerequisites rather than skip. Extend each plugin's tests for payload refusal, profile missing/login redirects, default draft, explicit public, requested unsupported fields, upload processing/error/cancel/timeout, stale signals and cleanup. Isolate fake mode and fixture origins; zero live account writes or provider calls in CI. Package acceptance must discover and invoke the packed plugin and its check entry outside the checkout, since scripts/bundle-plugins.ts bundles product entry/check and prunes tests. Add only the relevant package regression, no publisher registry because discovery already scans collections.

Live UI candidate selectors are evidence dated 2026-10-14 from the recovered extension or current public application bundle; they are not proof a particular account is entitled or that current publishing succeeds. Implementation must run a read-only capability probe and fail clearly if a required candidate/control is absent. Real operator-run draft/live verification is a separate delivery check; fixture PASS alone must not be described as live platform support. Same-change docs/04_DESIGN.md for shipped surface; docs/05_FEATURES.md only on actual feature state change. Budget boundary preserves artifacts and resumes current contracts; requireDiff is implementation plus behavior tests and surface docs.

Dependencies/handoff: No prerequisites; no reliance on 0287/0288 or another new publisher. No dependent task in this selected set consumes its implementation. Changes remain scoped to named files. Estimate 14h/P2; no source implementation during refine.

Exact file ownership: plugins/publishings/bilibili-pub/{package.json,tsconfig.json,plugin.json}, src/{index,flow,selectors,profile-check}.ts; tests/bilibili-pub.test.ts, tests/bilibili-pub-dom.test.ts and tests/fixtures/bilibili-pub-dom-runner.ts. Installed entry/check assertion belongs in this plugin's test suite and existing apps/cli/tests/package.test.ts only if a packaging regression requires it. Shared library/registry source is outside ownership; reuse current exports. The plugin manifest's browserSession.profileName is the channel slug without -pub, not the package name. Existing CLI invocation is --in <Content JSON> --out <Result JSON>; no new top-level kk verb.

### Plan

- [x] Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
- [x] (R1,R4) Scaffold one channel/manifest/probe, freeze local operation dispatch and separate payload validation/status rails before browser.
- [x] (R2) Implement source-grounded processed-video/partition/tags/cover flows and distinct persisted-draft versus submitted-review receipt parsing.
- [x] (R3) Implement dynamic composer/native image input and one explicit-public submission with matching fresh identity signal.
- [x] (R1–R4) Run two production fixture families covering unknown operation/driver, wrong payload, unready media, no draft capability, wrong partition, cover background, stale receipts and review-versus-public state; run installed dispatch/check acceptance.
- [x] Update docs/04_DESIGN.md with this shipped surface in the same change; align relevant feature notes/status only after real delivery.
- [x] Run project lint/tests/build/rules and task-pipeline review/traceable verify before done; fixture success is not a live account acceptance certificate.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/commands/plugin-check.test.ts:177` |
| `apps/cli/tests/commands/plugin-check.test.ts:180` |
| `apps/cli/tests/commands/plugin-check.test.ts:196` |
| `bunfig.toml:42` |
| `docs/04_DESIGN.md:1073` |
| `docs/04_DESIGN.md:1379` |
| `docs/04_DESIGN.md:26` |
| `packages/kk-core/tests/registry.test.ts:218` |
| `packages/kk-core/tests/registry.test.ts:595` |
| `scripts/bundle-plugins.test.ts:34` |
| `scripts/bundle-plugins.test.ts:36` |
| `plugins/publishings/bilibili-pub/package.json:1` |
| `plugins/publishings/bilibili-pub/plugin.json:1` |
| `plugins/publishings/bilibili-pub/src/flow.ts:1` |
| `plugins/publishings/bilibili-pub/src/index.ts:1` |
| `plugins/publishings/bilibili-pub/src/profile-check.ts:1` |
| `plugins/publishings/bilibili-pub/src/selectors.ts:1` |
| `plugins/publishings/bilibili-pub/tests/bilibili-pub-dom.test.ts:1` |
| `plugins/publishings/bilibili-pub/tests/bilibili-pub.test.ts:1` |
| `plugins/publishings/bilibili-pub/tests/fixtures/bilibili-pub-dom-runner.ts:1` |
| `plugins/publishings/bilibili-pub/tsconfig.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/publishings/bilibili-pub/plugin.json:1-12 (kind publish, entry/check dist, browserSession profileName bilibili + https://member.bilibili.com/); src/index.ts SHP-analog `BILIBILI_OPERATIONS = ['shortVideo', 'dynamic']` with dispatch `options.operation ?? metadata.operation ?? 'shortVideo'` before any browser/profile work; one shared channel/profile and separate flow modules per operation in src/flow.ts (runShortVideoFlow / runDynamicFlow) with operation-specific selectors in src/selectors.ts (BILI_VIDEO_SELECTORS / BILI_DYNAMIC_SELECTORS); Content → Result only, `--in`/`--out` + ResultSchema.parse + main() exit semantics (src/index.ts); no new kind/transport/dependency (deps: @gobing-ai/kk-core, @gobing-ai/publish-harness, playwright — plugins/publishings/bilibili-pub/package.json); packed entry/check resolve outside the checkout (scripts/bundle-plugins.test.ts, 24/0). |
| R2 | MET | src/flow.ts video-upload stage: `setInputFiles(videoPath)` on the local MP4/MOV path (no base64/DataTransfer in-page; hygiene-tested), 2 GiB local cap and extension/MIME checks in the pre-browser resolver, media-processing wait for the post-upload editing form (600 s ceiling = BILI_UPLOAD_TIMEOUT_MS; file assignment alone never succeeds); title filled natively with readback and >80 characters rejected, never truncated (typed refusal, zero launches); description filled and read back; tags ≤10 rejected above the limit and committed with Enter key events then read back; optional cover committed through the grounded dialog ladder (`div.cover-main` → modal input → `完成` → slot-preview changed evidence) with a typed failure when the control or the preview change is missing; partition selection is declared **Provisional** (the recovered adapter exposes no partition UI control — only the API field `form.append("category","daily")`, bilibili.js:571) and a missing chooser is a typed refusal. Draft is the default and now requires a **fresh id-bearing draft receipt URL** (`page.url() !== baselineUrl` and matching `BILI_RECEIPT_URL_RES`) — a toast or an unchanged URL is a typed `draft-receipt` failure, never `ok: true`. Explicit `'public'` clicks the grounded `span.submit-add` and requires a fresh receipt carrying `status: 'pending-review'`; a public URL is never fabricated (typed `publish-receipt` failure otherwise). |
| R3 | MET | src/flow.ts dynamic flow: text pasted into the grounded contenteditable editor and read back, images attached through `setInputFiles` with preview-count readback (≤9 images; the vendor's MAIN-world message bridge, bilibili-main.js:54-81, is deliberately NOT reproduced); `metadata.publishStatus` must be explicitly `'public'` — absent and `'draft'` are refused before any browser opens (no evidenced draft flow on the platform); confirmation snapshots a **pre-click baseline** (current URL + receipt-shaped anchor hrefs + success-toast visibility) and accepts only a signal absent from it (fresh receipt URL / newly visible toast / a link not present before the click), so a pre-existing feed card can never confirm a submit; the vendor's own "clicked 投稿, completion unknown" state (bilibili.js:552) is never treated as success. |
| R4 | MET | src/selectors.ts `isBilibiliAuthenticated` observes site-owned composer/creator controls and rejects passport/account login redirects; src/profile-check.ts wires the shared `runProfileCli(BILI_CONFIG)` behind `import.meta.main`; plugins/publishings/bilibili-pub/tests/bilibili-pub.test.ts keeps FakeBrowserTransport mapping/CLI coverage strictly separate from page behaviour (68 tests: surface/manifest, pre-browser refusal ladder, sanitizer chain, payload/IO + main() exit codes, session preflight, fake-page flow stages, source hygiene, environment restoration); plugins/publishings/bilibili-pub/tests/bilibili-pub-dom.test.ts (10 legs) + tests/fixtures/bilibili-pub-dom-runner.ts run real headless Chromium (Playwright pin `plugins/publishings/bilibili-pub/package.json:15`) through a spawned subprocess on the real origins with a catch-all route abort (zero live writes), guarded by `if (import.meta.main)` and failing loudly with a recovery hint when Chromium is absent (never skipping); legs cover shortVideo draft/public/cover-failure/missing-partition, dynamic public/missing-content/draft-refusal, stale receipt, missing browser and zero-network; installed entry/check acceptance is asserted through scripts/bundle-plugins.test.ts. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R3 - bilibili-pub handles video and dynamic publishing (req: R1, R2, R3, R4) | MET | test | plugins/publishings/bilibili-pub/tests/bilibili-pub-dom.test.ts shortVideo draft leg (video assigned + processing form verified, title/description/partition/tags/cover filled and read back, fresh draft receipt URL asserted) and public leg (投稿 clicked → fresh receipt with `status: 'pending-review'`); dynamic leg (text pasted + images attached with preview readback, launch clicked, fresh link absent from the pre-click baseline); separate typed failure per operation (missing partition, cover not committed, dynamic missing content, dynamic draft refusal, stale receipt). |
| AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4) | MET | test | plugins/publishings/bilibili-pub/tests/bilibili-pub.test.ts refusal/preflight/stage suites (unknown operation, driver≠script, format≠video, title >80, tags >10, missing/invalid videoPath, 2 GiB cap, dynamic without explicit public, dynamic >9 images, empty dynamic content — all with zero launches asserted; stale/toast/ambiguous typed failures with `metadata.stage`); fresh regression legs for the two review P2 findings (draft receipt missing → typed `draft-receipt`; pre-existing dynamic card → typed `publish-receipt`); packed discovery/acceptance scripts/bundle-plugins.test.ts 24/0; `kk plugin status --json` fourteen-channel probe list (apps/cli/tests/commands/plugin-check.test.ts). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Parent feature E98; docs/design/publish-plugin-specification.md; docs/00_ADR.md ADR-022/026/027/029/032/038.
- Existing seams: packages/kk-core/src/schemas.ts:16,36,48; packages/kk-core/src/manifest.ts:59; packages/publish-harness/src/index.ts:8; packages/publish-harness/src/browser.ts:169,325,436,553,610,737.
- WeChat callers: plugins/publishings/wechatmp-pub/src/flow.ts:245,1137; src/index.ts:254,310; src/modes.ts:144; tests/fixtures/wechatmp-dom-runner.ts.
- Source snapshot: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json; bilibili.js:158–287,293–556; bilibili-main.js:33–90; historical review docs/design/yijianfa-extension-review.md.
- Report: docs/plans/2026-10-14-publish-ready-refinement.md.
- Concurrency: one main worktree/no wip task at kickoff; concurrent 0287 and Board work preserved.
- Primary Playwright input/shadow contracts: https://playwright.dev/docs/input#upload-files and https://playwright.dev/docs/locators#locate-in-shadow-dom.

### History

- 2026-10-15T06:15:01.538Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.
- 2026-10-16T00:04:43.245Z todo → wip (system)
- 2026-10-16T01:51:56.057Z wip → testing (system)
- 2026-10-16T01:52:14.913Z testing → done (system)

