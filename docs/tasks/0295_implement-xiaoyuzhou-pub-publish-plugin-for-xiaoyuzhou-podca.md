---
schema_version: 1
name: Implement xiaoyuzhou-pub publish plugin for Xiaoyuzhou podcast episodes and shownotes
status: done
template: feature-impl
created_at: 2026-10-15T05:55:14.222Z
updated_at: "2026-10-15T20:48:05.623Z"
feature_id: E98

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0295-verdict.json
---

## 0295. Implement xiaoyuzhou-pub publish plugin for Xiaoyuzhou podcast episodes and shownotes

### Background

Implement xiaoyuzhou-pub publish plugin for Xiaoyuzhou podcast episodes and shownotes is valid planned work in E98; the requested package/helper is not implemented in the current tree. Existing publish-harness browser/session/lease/upload/shadow helpers and current WeChat modes are the reuse baseline, not a blank scaffold. The historical review is not evidence of live platform capability.

**Refine corrections (2026-10-14)**

- Vendor was treated as a complete cover/draft implementation → xiaoyuzhou.js marks cover unsupported and stops after audio/title/description fill → implement requested cover/save as separate bounded verified steps, refusing unavailable controls.
- Title direct assignment was assumed committed → source notes missing input/change events → use native events and actual value/readback.
- Audio upload success was inferred from FileList → file selection does not prove server processing → wait for upload completion/media identity before save.
- Current browser prerequisite was missing → official podcaster unsupported page requires Chrome 147+ → use existing KK_BROWSER_CHANNEL=chrome with installed Chrome 155.0.8059.40 after compatibility check; no Playwright pin/runtime change.

Verified source: exact extension v0.1.55 recovered read-only from Google's extension update service, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425; relevant xiaoyuzhou.js:1–101. File hashes and durable inspected copies are in .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. The extension was not installed or executed. Browser candidate controls/private protocol are source observations only, not a verified authenticated live run. All local issues remain valid implementation outcomes; no issue dropped. At kickoff one main worktree/no wip task was observed, while 0287 kk-core and Board edits existed concurrently and must not be reverted. Bun 1.4.3, Playwright 1.55.0 and Biome 2.5.15 match pins; final corpus writes use latest bun-global Spur. Recheck ownership/environment drift at implementation step 0.

### Requirements

- [x] R1. Deliver discoverable xiaoyuzhou-pub podcast script plugin using audio Content and standard session/profile/Result contracts.
- [x] R2. Upload the local audio file and verify completion, populate/read back episode title and rendered shownotes without truncating or trusting file assignment.
- [x] R3. Apply a requested episode cover and save a verified episode draft; missing platform capability or persistence signal returns explicit failure instead of vendor unsupported fields being called successful.
- [x] R4. Provide profile readiness, fake mapping seams and real production audio/cover/editor/save fixtures; preserve browser compatibility prerequisites and no live publication.

### Acceptance Criteria

- [x] AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)

- [x] AC1 — R1 - xiaoyuzhou-pub uploads episode audio and shownotes (req: R1, R2, R3, R4)

```gherkin
Feature: Implement xiaoyuzhou-pub publish plugin for Xiaoyuzhou podcast episodes and shownotes

  Scenario: AC1 — R1 - xiaoyuzhou-pub uploads episode audio and shownotes (req: R1, R2, R3, R4)
    Given a compatible browser, authenticated Xiaoyuzhou session and audio Content payload selecting an exact show
    When `xiaoyuzhou-pub` executes operation `podcast`
    Then processed audio, requested cover and shownotes are verified on a persistent episode draft
    And absent required cover or save capability is an explicit failure

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

#### Q&A entry — 2026-10-15T06:14:55.826Z

Closed by inline ready refinement 2026-10-14: the Design freezes payload/operation/status boundaries, source-grounded or explicitly provisional controls, refusal/receipt handling, file ownership and test layer.  Provider/UI drift and operator-run live acceptance are delivery checks owned by this WBS, not invented current facts. Existing unsupported requested fields fail explicitly. No task cancellation/merge/link is authorized or needed.

### Design

Own plugin package; target/profile=xiaoyuzhou, operations=['podcast'], default podcast. Require Content.format=audio, metadata.audioPath or preferred metadata.mp3Path, existing regular readable MP3/M4A/WAV audio; Content.body is Markdown shownotes, title is episode title, metadata.coverPath optional existing image. Require explicit metadata.podcastId nonempty and verify selected show identity before upload; never use the first/default show. Draft only: public refuses before browser. metadata.duration is optional positive finite seconds, preserved as input provenance, not a measured upload duration. Local audio resource cap 500 MiB is a KK v1 bound, not a claimed platform limit; 600s processing timeout. Never base64/read complete audio into host/page memory or create an asset server.

Source candidates input#upload, input[name="title"], div[data-contents="true"] for Draft.js shownotes. Upload via Playwright setInputFiles; verify processing-ready/media record in the current episode form before title/HTML paste. Trigger proper native input/change and verify normalized text. Requested episode-cover control is a scoped semantic 上传封面/单集封面 file control; save is exact 保存草稿/保存. These cover/save selectors are provisional requirements beyond vendor fill; no pretend source provenance. Verify image preview identity and new persisted episode draft id/title/media/show before ok:true. Absent controls or unconfirmed autosave yield named ok:false, no publication fallback. No crop transformation requested here; remove the original generic Plan's invented cover-crop step.

Browser precondition: primary https://podcaster.xiaoyuzhoufm.com/unsupported-browser.html observed 2026-10-14 says desktop Chrome 147+. Repository Playwright 1.55.0 remains pinned; existing shared KK_BROWSER_CHANNEL=chrome selects installed Chrome (Info.plist observed 155.0.8059.40). Recheck version and actual launcher compatibility at implementation step 0; no promise a newer Chrome is automatically compatible. Missing support is an environment failure before upload. Tests exercise app controls against synthetic pages with production flow; they do not validate account ownership/current backend availability.

Follow ADR-007/009/012/016/022/027/029/032/038 and docs/design/publish-plugin-specification.md. Existing plugins expose Content → Result, not TargetOutcome (fan-out owns that aggregate). No new plugin kind, transport, runtime, dependency or generic automation framework. For new channels copy only the current package/tsconfig/CLI skeleton from weibo-pub or juejin-pub, importing shared packages by @gobing-ai names. Manifest operations is the auxiliary IO-form map, not a list of publishing verbs: omit it for ordinary Content → Result publishing types; dispatch a frozen local operation list using options.operation ?? content.metadata.operation ?? default before browser/profile creation. driver defaults to script and other values fail by name. Use check/profile-check.ts + browserSession {profileName:<channel>,homeUrl:<fixed non-secret entry>} for installed bot integration. Preserve --in/--out, valid ResultSchema output, stdout routing and exit semantics. API-only paths must not load Playwright eagerly.

Frozen common payload rules for new channels: Content.body is Markdown/text as the operation requires, title is a required nonempty string for article/podcast/video operations; metadata.publishStatus is absent|draft|public, default draft; metadata.coverPath is an optional existing local PNG/JPEG/WebP file; metadata.images is an optional array of existing local image paths; metadata.tags/categories are optional arrays of nonempty exact names. Reject wrong types, missing required assets, unsupported requested fields and unknown operations/status/driver before opening a browser; never silently truncate or invent media/fields. File IO uses the sanctioned FileSystem seam. Media paths resolve as current peer plugins do; require regular readable nonempty files and accepted extension/MIME, no automatic remote downloads or blob URL server. For audio/video use Playwright setInputFiles on the local path (streamed by the browser), never read entire media into JSON/base64. Existing uploadFile suffices for one file; page/locator.setInputFiles(paths) handles multiple. No dependency on 0287 content limits or 0288 hooks: channel validation is local and those are independent capabilities, avoiding out-of-set blockers and silent ownership changes.

Profile/readiness: reuse resolveChannelProfileDir, checkChannelSession, kkBrowserLauncher and runProfileCli including login/check/open behavior and current lease protection. The channel predicate must observe a site-owned composer/control and reject login redirects; page body mentioning 登录 is insufficient. Publish preflight uses headedFallback=false; interactive login remains operator-owned. Close the opened context in finally. Poll via waitUntil/expectOutcome, 30s per normal step and 600s media processing ceiling, no blind sleep or unbounded retry. A successful fill/file assignment is not a saved draft or publication. Snapshot baseline URLs/toasts/cards before submit; require a new operation-specific receipt or persisted item with matching title/body/media identity. Missing/ambiguous/stale/contradictory confirmation returns ok:false with bounded error and metadata.stage/evidence; never invent id/url or retry a possibly accepted create/publish. Only safe UI-field operations can be retried before submission. No mandatory source-derived numeric platform limit is asserted without a dated primary source; observed control constraints and explicit local resource caps are labeled as such.

Testing: FakeBrowserTransport verifies mapping/CLI only; it cannot establish real page behavior. The named local Chromium fixture runner must execute production selectors, scripts and flows, return observable field/event/action/receipt facts, and throw on missing browser prerequisites rather than skip. Extend each plugin's tests for payload refusal, profile missing/login redirects, default draft, explicit public, requested unsupported fields, upload processing/error/cancel/timeout, stale signals and cleanup. Isolate fake mode and fixture origins; zero live account writes or provider calls in CI. Package acceptance must discover and invoke the packed plugin and its check entry outside the checkout, since scripts/bundle-plugins.ts bundles product entry/check and prunes tests. Add only the relevant package regression, no publisher registry because discovery already scans collections.

Live UI candidate selectors are evidence dated 2026-10-14 from the recovered extension or current public application bundle; they are not proof a particular account is entitled or that current publishing succeeds. Implementation must run a read-only capability probe and fail clearly if a required candidate/control is absent. Real operator-run draft/live verification is a separate delivery check; fixture PASS alone must not be described as live platform support. Same-change docs/04_DESIGN.md for shipped surface; docs/05_FEATURES.md only on actual feature state change. Budget boundary preserves artifacts and resumes current contracts; requireDiff is implementation plus behavior tests and surface docs.

Dependencies/handoff: No prerequisites; no reliance on 0287/0288 or another new publisher. No dependent task in this selected set consumes its implementation. Changes remain scoped to named files. Estimate 12h/P2; no source implementation during refine.

Exact file ownership: plugins/publishings/xiaoyuzhou-pub/{package.json,tsconfig.json,plugin.json}, src/{index,flow,selectors,profile-check}.ts; tests/xiaoyuzhou-pub.test.ts, tests/xiaoyuzhou-pub-dom.test.ts and tests/fixtures/xiaoyuzhou-pub-dom-runner.ts. Installed entry/check assertion belongs in this plugin's test suite and existing apps/cli/tests/package.test.ts only if a packaging regression requires it. Shared library/registry source is outside ownership; reuse current exports. The plugin manifest's browserSession.profileName is the channel slug without -pub, not the package name. Existing CLI invocation is --in <Content JSON> --out <Result JSON>; no new top-level kk verb.

### Plan

- [x] Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
- [x] (R1,R4) Scaffold audio operation/profile contracts and validate show identity, local assets/status/types before browser; recheck installed Chrome and launcher compatibility.
- [x] (R2,R3) Implement source-backed upload/title/Draft.js flow and bounded scoped cover/save capability checks; verify completed media, exact show and persisted draft.
- [x] (R1–R4) Run real-page production fixtures for missing entitlement/show/cover/save, incomplete upload, controlled-title events, safe shownotes, stale receipts and browser refusal; run packed plugin/check acceptance.
- [x] Update docs/04_DESIGN.md with this shipped surface in the same change; align relevant feature notes/status only after real delivery.
- [x] Run project lint/tests/build/rules and task-pipeline review/traceable verify before done; fixture success is not a live account acceptance certificate.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/commands/plugin-check.test.ts:177` |
| `apps/cli/tests/commands/plugin-check.test.ts:191` |
| `apps/cli/tests/commands/plugin-check.test.ts:194` |
| `bunfig.toml:34` |
| `docs/04_DESIGN.md:1073` |
| `docs/04_DESIGN.md:1358` |
| `docs/04_DESIGN.md:26` |
| `packages/kk-core/tests/registry.test.ts:250` |
| `packages/kk-core/tests/registry.test.ts:625` |
| `scripts/bundle-plugins.test.ts:34` |
| `scripts/bundle-plugins.test.ts:43` |
| `plugins/publishings/xiaoyuzhou-pub/package.json:1` |
| `plugins/publishings/xiaoyuzhou-pub/plugin.json:1` |
| `plugins/publishings/xiaoyuzhou-pub/src/flow.ts:1` |
| `plugins/publishings/xiaoyuzhou-pub/src/index.ts:1` |
| `plugins/publishings/xiaoyuzhou-pub/src/profile-check.ts:1` |
| `plugins/publishings/xiaoyuzhou-pub/src/selectors.ts:1` |
| `plugins/publishings/xiaoyuzhou-pub/tests/fixtures/xiaoyuzhou-pub-dom-runner.ts:1` |
| `plugins/publishings/xiaoyuzhou-pub/tests/xiaoyuzhou-pub-dom.test.ts:1` |
| `plugins/publishings/xiaoyuzhou-pub/tests/xiaoyuzhou-pub.test.ts:1` |
| `plugins/publishings/xiaoyuzhou-pub/tsconfig.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/publishings/xiaoyuzhou-pub/plugin.json:3-10 (kind publish, entry/check dist, browserSession profileName xiaoyuzhou + https://podcaster.xiaoyuzhoufm.com/); src/index.ts:36-58 XYZF_OPERATIONS ['podcast'] + resolveOperation dispatch `options.operation ?? content.metadata.operation ?? 'podcast'` before any browser/profile work; src/index.ts:131-170 processPublishIO `--in/--out` + ResultSchema parse + main() exit semantics; only `import type { Page }` from playwright (src/flow.ts:48 — no eager load); packed entry/check resolve outside checkout (scripts/bundle-plugins.test.ts). |
| R2 | MET | src/flow.ts:544 setInputFiles local audio path (no base64/DataTransfer-in-page — hygiene-tested in tests/sspai-hygiene analog src-scan describe); src/flow.ts:549-566 processing-ready verification before proceed with typed 600s ceiling (XYZF_UPLOAD_TIMEOUT_MS, src/selectors.ts:93) — file assignment alone never succeeds; src/flow.ts:581-586 title native input/change fill + normalized readback, vendor bare `.value` assignment deliberately not reproduced (source flags it TODO(逆向存疑) at xiaoyuzhou.js:57-58); src/flow.ts:608-630 Draft.js `div[data-contents="true"]` sanitized text/html paste (markdownToHtml → plugin-local sanitizer stripping script/iframe/on*/javascript:/data: → pasteHtml) + readback. |
| R3 | MET | src/flow.ts:506-520 podcastId show-verify BEFORE upload (first/default show never used; dom leg asserts zero assignments on verify failure); src/flow.ts:647-692 requested cover with missing/unverified control = typed cover-attach failure — never the vendor's unsupported silent skip (xiaoyuzhou.js:17); src/selectors.ts:72-73 exact-visible 保存草稿/保存 with typed draft-save failure on absence (src/flow.ts:704-731, no manufactured draft); src/flow.ts:737-801 ok:true only on fresh id-bearing episode receipt (XYZF_RECEIPT_URL_RES) + persisted title/audio/shownotes(/cover) readback — toast/stale/ambiguous typed failures; src/flow.ts:357-370 publishStatus 'public'/unknown refused pre-browser (launches=0); src/flow.ts:490-501 unsupported-browser.html = environment failure before upload (official Chrome 147+ requirement, XYZF_UNSUPPORTED_URL_RE). |
| R4 | MET | tests/xiaoyuzhou-pub.test.ts (61): FakeBrowserTransport mapping/CLI only, full pre-browser refusal ladder incl. public refusal, 500 MiB local cap (sparse-file), sanitizer direct + captured-paste, preflight (login-redirect/missing profile/unsupported-browser), all stage failure branches, src-scan hygiene; tests/xiaoyuzhou-pub-dom.test.ts (9) + tests/fixtures/xiaoyuzhou-pub-dom-runner.ts: production selectors/scripts/flows in real headless Chromium (Playwright pin plugins/publishings/xiaoyuzhou-pub/package.json:13) via spawnSync, module entry behind `if (import.meta.main)` (runner:330), loud typed failure on missing Chromium (runner:49-55), route-intercepted real origin with catch-all abort (runner:260) = zero live writes; legs: happy draft, cover, audio-timeout, show-verify-fail, missing-save, stale-receipt, login, missing-browser guard, zero-network. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R1 - xiaoyuzhou-pub uploads episode audio and shownotes (req: R1, R2, R3, R4) | MET | test | tests/xiaoyuzhou-pub-dom.test.ts default-draft leg (audio assigned + processing-verified, title native events, shownotes pasted + read back, fresh episode receipt, save clicked, previewClicks===0) and cover leg (assigned + read back at save); absent required save capability is a typed draft-save failure (tests missing-save leg) and absent cover control a typed cover-attach failure — never claimed as success. |
| AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4) | MET | test | tests/xiaoyuzhou-pub.test.ts refusal/preflight/stage suites (public/unknown status, unknown operation, driver, format≠audio, empty title/body, missing podcastId, bad audio path/extension, 500 MiB cap, duration validation, images/tags/categories — all launches===0; stale/toast/ambiguous typed); dom failure legs assert facts.stage typed names; packed discovery/acceptance scripts/bundle-plugins.test.ts 24/0; readiness ladder isXiaoyuzhouAuthenticated (src/selectors.ts:105) rejects login redirects and the unsupported-browser page. |
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
- Source snapshot: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json; xiaoyuzhou.js:1–101; historical review docs/design/yijianfa-extension-review.md.
- Report: docs/plans/2026-10-14-publish-ready-refinement.md.
- Concurrency: one main worktree/no wip task at kickoff; concurrent 0287 and Board work preserved.
- Primary Playwright input/shadow contracts: https://playwright.dev/docs/input#upload-files and https://playwright.dev/docs/locators#locate-in-shadow-dom.
- Current browser gate: https://podcaster.xiaoyuzhoufm.com/unsupported-browser.html; local Chrome Info.plist version observed 155.0.8059.40.

### History

- 2026-10-15T06:14:57.004Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.
- 2026-10-15T19:14:41.826Z todo → wip (system)
- 2026-10-15T20:48:05.259Z wip → testing (system)
- 2026-10-15T20:48:05.619Z testing → done (system)

