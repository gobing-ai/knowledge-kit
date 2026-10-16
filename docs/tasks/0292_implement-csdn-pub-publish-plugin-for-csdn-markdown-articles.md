---
schema_version: 1
name: Implement csdn-pub publish plugin for CSDN markdown articles and covers
status: done
template: feature-impl
created_at: 2026-10-15T05:55:13.278Z
updated_at: "2026-10-15T16:42:39.567Z"
feature_id: E97

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0292-verdict.json
---

## 0292. Implement csdn-pub publish plugin for CSDN markdown articles and covers

### Background

Implement csdn-pub publish plugin for CSDN markdown articles and covers is valid planned work in E97; the requested package/helper is not implemented in the current tree. Existing publish-harness browser/session/lease/upload/shadow helpers and current WeChat modes are the reuse baseline, not a blank scaffold. The historical review is not evidence of live platform capability.

**Refine corrections (2026-10-14)**

- Vendor was cited as a Markdown DOM implementation → recovered csdn.js uses a signed API and fixed tags/status=2 of uncertain meaning → use the current public editor bundle as DOM evidence, do not port that API.
- Draft status was assumed from vendor redirect → source explicitly cannot establish status=2 semantics → freeze DOM save control which invokes draft intent, plus fresh persisted readback.
- Cover/category/tag mapping and test layer were unspecified → current editor exposes scoped publish-modal controls → freeze exact requested-field validation and real DOM-flow fixtures.
- Only a manifest/coverage scaffold was planned → installed browser session, refusal, cleanup and Result semantics are required → include full discovery/probe/pack acceptance.

Verified source: exact extension v0.1.55 recovered read-only from Google's extension update service, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425; relevant csdn.js:1–18,185–245; current CSDN public app.chunk.3e8e17a6.js byte offsets 394016,411827,433474,498621,690000. File hashes and durable inspected copies are in .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. The extension was not installed or executed. Browser candidate controls/private protocol are source observations only, not a verified authenticated live run. All local issues remain valid implementation outcomes; no issue dropped. At kickoff one main worktree/no wip task was observed, while 0287 kk-core and Board edits existed concurrently and must not be reverted. Bun 1.4.3, Playwright 1.55.0 and Biome 2.5.15 match pins; final corpus writes use latest bun-global Spur. Recheck ownership/environment drift at implementation step 0.

### Requirements

- [x] R1. Deliver a discoverable installed csdn-pub script plugin with article operation dispatch and Content → Result/probe contracts.
- [x] R2. Populate and read back title, Markdown body and requested tags in the actual Markdown editor using its DOM controls.
- [x] R3. Upload/verify requested cover and exact category choices without silent fallback or copying vendor signing credentials.
- [x] R4. Verify draft/default versus explicit public behavior using fresh persisted receipts; provide profile CLI, mapping/fake tests and real production DOM fixtures.

### Acceptance Criteria

- [x] AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)

- [x] AC1 — R2 - csdn-pub publishes Markdown article with cover (req: R1, R2, R3, R4)

```gherkin
Feature: Implement csdn-pub publish plugin for CSDN markdown articles and covers

  Scenario: AC1 — R2 - csdn-pub publishes Markdown article with cover (req: R1, R2, R3, R4)
    Given an authenticated CSDN session and an article payload
    When `csdn-pub` executes operation `article`
    Then the Markdown editor is populated, cover uploaded, and draft/public status verified

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

#### Q&A entry — 2026-10-15T06:14:49.209Z

Closed by inline ready refinement 2026-10-14: the Design freezes payload/operation/status boundaries, source-grounded or explicitly provisional controls, refusal/receipt handling, file ownership and test layer.  Provider/UI drift and operator-run live acceptance are delivery checks owned by this WBS, not invented current facts. Existing unsupported requested fields fail explicitly. No task cancellation/merge/link is authorized or needed.

### Design

Own plugin package files as in common contract; target/profile=csdn, local operations=['article'], default article; body Markdown. Public editor HTML fetched 2026-10-14 from https://editor.csdn.net/md/ points to current app bundle https://csdnimg.cn/release/md/static/js/app.chunk.3e8e17a6.js; hashes/byte offsets are in batch source-manifest. These are primary first-party source observations, not an authenticated live save. Title candidate input.article-bar__title--input[placeholder*="文章标题"], activate .article-bar__title-display first; Markdown candidate pre.editor__inner.markdown-highlighting uses cledit-managed text (not CodeMirror). Use real keyboard/paste events, not DOM innerHTML assignment; verify normalized editor text and title property.

Draft control button.button-save[data-title="保存草稿"] dispatches the observed editor draft action. Cover/tags/categories live in .modal__publish-article; enter through the scoped 发布文章 UI only to populate modal fields, never click its final public submit on draft runs. Match exact labels 文章标签/分类专栏/封面 inside that modal, use real file input and verify previews/chips. At most three categories is the observed bundle UI limit; reject excess. Preserve requested tags without the vendor fixed 经验分享 tag. After modal field preparation choose only a draft-labeled action, or close modal and use the top-level draft save if state persists; require readback of requested cover/categories/tags after save. If that cannot be observed, ok:false with named unsupported/verification error; never call the uncertain signed saveArticle API as a fallback.

Default draft uses the observed save action and a new draft id/URL or changed draft record with exact title/body; public uses explicit metadata.publishStatus=public, final scoped publish control and a fresh published URL/status readback. Reject stale toasts/idless ambiguous responses. No direct use of vendor embedded HMAC keys/OBS protocol, private status integer assumptions or cookie export. Fixture tests must execute current cledit-style input/paste handling, modal chips/previews and save/readback state, not just FakeBrowserTransport.

Follow ADR-007/009/012/016/022/027/029/032/038 and docs/design/publish-plugin-specification.md. Existing plugins expose Content → Result, not TargetOutcome (fan-out owns that aggregate). No new plugin kind, transport, runtime, dependency or generic automation framework. For new channels copy only the current package/tsconfig/CLI skeleton from weibo-pub or juejin-pub, importing shared packages by @gobing-ai names. Manifest operations is the auxiliary IO-form map, not a list of publishing verbs: omit it for ordinary Content → Result publishing types; dispatch a frozen local operation list using options.operation ?? content.metadata.operation ?? default before browser/profile creation. driver defaults to script and other values fail by name. Use check/profile-check.ts + browserSession {profileName:<channel>,homeUrl:<fixed non-secret entry>} for installed bot integration. Preserve --in/--out, valid ResultSchema output, stdout routing and exit semantics. API-only paths must not load Playwright eagerly.

Frozen common payload rules for new channels: Content.body is Markdown/text as the operation requires, title is a required nonempty string for article/podcast/video operations; metadata.publishStatus is absent|draft|public, default draft; metadata.coverPath is an optional existing local PNG/JPEG/WebP file; metadata.images is an optional array of existing local image paths; metadata.tags/categories are optional arrays of nonempty exact names. Reject wrong types, missing required assets, unsupported requested fields and unknown operations/status/driver before opening a browser; never silently truncate or invent media/fields. File IO uses the sanctioned FileSystem seam. Media paths resolve as current peer plugins do; require regular readable nonempty files and accepted extension/MIME, no automatic remote downloads or blob URL server. For audio/video use Playwright setInputFiles on the local path (streamed by the browser), never read entire media into JSON/base64. Existing uploadFile suffices for one file; page/locator.setInputFiles(paths) handles multiple. No dependency on 0287 content limits or 0288 hooks: channel validation is local and those are independent capabilities, avoiding out-of-set blockers and silent ownership changes.

Profile/readiness: reuse resolveChannelProfileDir, checkChannelSession, kkBrowserLauncher and runProfileCli including login/check/open behavior and current lease protection. The channel predicate must observe a site-owned composer/control and reject login redirects; page body mentioning 登录 is insufficient. Publish preflight uses headedFallback=false; interactive login remains operator-owned. Close the opened context in finally. Poll via waitUntil/expectOutcome, 30s per normal step and 600s media processing ceiling, no blind sleep or unbounded retry. A successful fill/file assignment is not a saved draft or publication. Snapshot baseline URLs/toasts/cards before submit; require a new operation-specific receipt or persisted item with matching title/body/media identity. Missing/ambiguous/stale/contradictory confirmation returns ok:false with bounded error and metadata.stage/evidence; never invent id/url or retry a possibly accepted create/publish. Only safe UI-field operations can be retried before submission. No mandatory source-derived numeric platform limit is asserted without a dated primary source; observed control constraints and explicit local resource caps are labeled as such.

Testing: FakeBrowserTransport verifies mapping/CLI only; it cannot establish real page behavior. The named local Chromium fixture runner must execute production selectors, scripts and flows, return observable field/event/action/receipt facts, and throw on missing browser prerequisites rather than skip. Extend each plugin's tests for payload refusal, profile missing/login redirects, default draft, explicit public, requested unsupported fields, upload processing/error/cancel/timeout, stale signals and cleanup. Isolate fake mode and fixture origins; zero live account writes or provider calls in CI. Package acceptance must discover and invoke the packed plugin and its check entry outside the checkout, since scripts/bundle-plugins.ts bundles product entry/check and prunes tests. Add only the relevant package regression, no publisher registry because discovery already scans collections.

Live UI candidate selectors are evidence dated 2026-10-14 from the recovered extension or current public application bundle; they are not proof a particular account is entitled or that current publishing succeeds. Implementation must run a read-only capability probe and fail clearly if a required candidate/control is absent. Real operator-run draft/live verification is a separate delivery check; fixture PASS alone must not be described as live platform support. Same-change docs/04_DESIGN.md for shipped surface; docs/05_FEATURES.md only on actual feature state change. Budget boundary preserves artifacts and resumes current contracts; requireDiff is implementation plus behavior tests and surface docs.

Dependencies/handoff: No prerequisites; no reliance on 0287/0288 or another new publisher. No dependent task in this selected set consumes its implementation. Changes remain scoped to named files. Estimate 12h/P2; no source implementation during refine.

Exact file ownership: plugins/publishings/csdn-pub/{package.json,tsconfig.json,plugin.json}, src/{index,flow,selectors,profile-check}.ts; tests/csdn-pub.test.ts, tests/csdn-pub-dom.test.ts and tests/fixtures/csdn-pub-dom-runner.ts. Installed entry/check assertion belongs in this plugin's test suite and existing apps/cli/tests/package.test.ts only if a packaging regression requires it. Shared library/registry source is outside ownership; reuse current exports. The plugin manifest's browserSession.profileName is the channel slug without -pub, not the package name. Existing CLI invocation is --in <Content JSON> --out <Result JSON>; no new top-level kk verb.

### Plan

Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
(R1,R4) Scaffold contract/probe and record current primary bundle hash/selector candidates; validate operation/payload/status before browser.
(R2,R3) Implement native editor input/paste, scoped modal tags/categories/cover and exact persisted-state readback, respecting the draft-only submission boundary.
(R1–R4) Execute production DOM fixtures for cledit text, cover/tag/category failure, draft modal behavior, stale toasts and explicit public; verify no vendor signed API/keys are used and run packed entry/check acceptance.
Update docs/04_DESIGN.md with this shipped surface in the same change; align relevant feature notes/status only after real delivery.
Run project lint/tests/build/rules and task-pipeline review/traceable verify before done; fixture success is not a live account acceptance certificate.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/commands/plugin-check.test.ts:177` |
| `apps/cli/tests/commands/plugin-check.test.ts:180` |
| `apps/cli/tests/commands/plugin-check.test.ts:191` |
| `bunfig.toml:22` |
| `docs/04_DESIGN.md:1073` |
| `docs/04_DESIGN.md:1327` |
| `docs/04_DESIGN.md:26` |
| `packages/kk-core/tests/registry.test.ts:220` |
| `packages/kk-core/tests/registry.test.ts:592` |
| `scripts/bundle-plugins.test.ts:34` |
| `scripts/bundle-plugins.test.ts:36` |
| `plugins/publishings/csdn-pub/package.json:1` |
| `plugins/publishings/csdn-pub/plugin.json:1` |
| `plugins/publishings/csdn-pub/src/index.ts:1` |
| `plugins/publishings/csdn-pub/src/profile-check.ts:1` |
| `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:1` |
| `plugins/publishings/csdn-pub/tests/fixtures/csdn-composer-runner.ts:1` |
| `plugins/publishings/csdn-pub/tsconfig.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Discoverable plugin (plugin.json kind publish, entry/check, browserSession csdn); src/index.ts:223,243 pre-browser op/driver dispatch; Content→Result main() (src/index.ts:1116-1154); registry lists + nine-channel probe + packed check (registry.test 31/0, bundle-plugins 24/0, plugin-check 12/0) |
| R2 | MET | src/index.ts:511-533 title display-activator + strict readback; :535-559 cledit `pre` real input events; :698-738 exact tag chips, 经验分享 never substituted (tests:1047-1052) |
| R3 | MET | src/index.ts:793-831 modal-scoped cover file input + 上传中 settle + fresh preview; :739-792 exact category option + persisted readback + 3-cap; zero x-ca-*/OBS/HMAC ported (src-scan tests:1042-1052) |
| R4 | MET | src/index.ts:370-379 absent→draft default; :171-179/:877-925 保存草稿 top-level action (saveArticle never called); :166-172/:928-938 fresh id-bearing receipt only, typed draft-save/draft-enabled/failure-toast failures (tests 699-783); draft runs never click public submit (tests:701-733); profile-check.ts:21-23; real-Chromium fixture draft-happy green (tests:1022) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R2 - csdn-pub publishes Markdown article with cover (req: R1, R2, R3, R4) | MET | test | bun test plugins/publishings/csdn-pub 57/0 (draft happy, modal-prep never-clicks-publish, stale/idless refusals); .spur/run/0292-verify-evidence.md R1-R4 rows; re-review PASS bbe359d6 (all findings RESOLVED) |
| AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4) | MET | test | Zero-launch refusals (tests:398,:503); typed bounded stages; packed entry/check resolution; nine-channel probe 12/0; .spur/run/0292-gate2.log exit 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0292 (csdn-pub)
**Scope:** plugins/publishings/csdn-pub/** (working tree) + host integration (scripts/bundle-plugins.test.ts, apps/cli/tests/commands/plugin-check.test.ts, packages/kk-core/tests/registry.test.ts, docs/04_DESIGN.md, bunfig.toml), diff base 0f234f2d
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Evidence base:** `csdn.js:N` = knowledge-kit `.spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/csdn.js`
**Verdict: FAIL**

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | functional | R4/Design draft/default leg replaced by an unrecorded blanket refusal. The task doc freezes `publishStatus` absent\|draft\|public with **default draft**, pins the editor draft control `button.button-save[data-title="保存草稿"]` ("freeze DOM save control which invokes draft intent, plus fresh persisted readback"), and AC1 requires "draft/public status verified"; the shipped flow refuses absent/draft before any browser, no draft selector exists anywhere in src (grep 保存草稿/button-save: zero hits), and the task Solution section is empty — no recorded decision. The in-code/docs justification ("draft semantics cannot be established", "the evidence carries no draft flow") is true only of the API adapter the Design superseded for DOM behavior, and ADR-022 licenses no-draft rejection only for targets with no draft mode — CSDN's is evidenced. The refusal is fail-safe, fully tested, and matches the pipeline review frame ("live-only ADR-022") and the 0291 precedent (where no draft control was evidenced — not the case here). Fix: either implement the draft leg per Design (draft selector + draft-labeled action + persisted readback + fresh receipt), or record the live-only decision in the task Q&A/Solution and correct R4/AC1 wording plus docs/04_DESIGN.md:1330 | plugins/publishings/csdn-pub/src/index.ts:357 | OPEN |
| 2 | P3 (minor) | correctness | csdn.js line-citation drift, 5 instances (class swept): src/index.ts:11 cites saveArticle as csdn.js:193-245 (actual 183-248); src/index.ts:16 cites the signing credentials as csdn.js:19-27, 28 (actual 32-41 — IMAGE_SIGN 32-35, ARTICLE_SIGN 37-40, OBS URL 41; lines 19-28 are module scaffold, so a reader lands on the wrong block); SUCCESS_TOAST_RE comment (src/index.ts:163) cites csdn.js:241 (actual success log 242); FAILURE_TOAST_RE comment (src/index.ts:165) cites csdn.js:244 (actual failure log 245); docs/04_DESIGN.md:1335 cites csdn.js:241-244 (actual 241-245). Every other citation verified line-by-line exact: csdn.js:1, 13-14, 17-18, 202, 204-205, 206, 207, 223, 249, 257, 339, 340. Fix is mechanical | plugins/publishings/csdn-pub/src/index.ts:11 | OPEN |
| 3 | P4 (advisory) | architecture | Deep-module health is good: launcher/stepTimeoutMs injection makes the transport fully testable offline (47/47 with zero launches); the kk-csdn-* evaluate-script markers are the fake-test seam (established 0291 peer pattern); failures are stage-typed with bounded evidence; 20 Provisional markings on un-pinned selectors, all failing loud. Wording nit: docs/04_DESIGN.md:1332 calls the csdn.js windows the selectors' "bundle evidence" — selectors are grounded in the 2026-10-14 editor bundle (src docstrings cite both sources correctly); the wording can ride finding 2's docs edit | plugins/publishings/csdn-pub/src/index.ts:81 | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | plugin.json:3-5,8-10 (kind/entry/check/profileName `csdn`); operation+driver refused before any transport at src/index.ts:1027-1037; Content→Result via ResultSchema at src/index.ts:170-195; discovery/pack asserted by registry.test.ts:220,592, bundle CHECK_DECLARING_PLUGINS incl. csdn-pub, plugin-check nine-channel test (lines 177-191) — all green fresh |
| R2 | MET (public runs) | grounded title display→input fill with strict normalized readback (src/index.ts:480-508); cledit `pre` body with real input events + normalized readback (src/index.ts:510-533); exact tag chips with no fuzzy/first-item fallback (src/index.ts:664); 经验分享 never substituted — src-scan test proves every occurrence sits in refusal prose |
| R3 | MET | cover via setInputFiles seam + 上传中 settle + fresh modal media-count preview (src/index.ts:759); exact category option click + persisted value readback, empty-category fallback refused (src/index.ts:705, cites csdn.js:207); zero vendor signing material — grep x-ca/caKey/hmac/OBS/saveArticle across src+manifests: only refusal prose at src/index.ts:11 |
| R4 | PARTIAL | fresh persisted receipts only — stale toast/URL baselines never confirm, editor-clearing never a signal, failure toast fails fast (confirmation tests green); profile CLI over shared runProfileCli (src/profile-check.ts); real-Chromium fixture import.meta.main-gated with missing-browser fail-loud + recovery hint. Draft/default leg NOT met — finding 1 |
| AC1 | PARTIAL | public leg verified end-to-end offline + real-Chromium fixture (article-happy); "draft/public status verified" covers only the refusal half — finding 1 |
| AC2 | MET | zero-launch refusals tested (fake.requests length 0 assertions); nine-channel probe incl. csdn-pub; CHECK_DECLARING_PLUGINS covers csdn-pub; bunfig ignores csdn-composer-runner.ts (subprocess-only, import.meta.main-gated — justified); docs/04_DESIGN.md:1327-1335 stages (editor-readiness/title-readback/body-readback/publish-open/tag-commit/category-select/cover-upload) and profile tiers all match src |

**Verification (fresh, this review):** bun test plugins/publishings/csdn-pub → 47 pass / 0 fail; scripts/bundle-plugins.test.ts → 24/0; apps/cli/tests/commands/plugin-check.test.ts → 12/0; packages/kk-core/tests/registry.test.ts → 31/0; csdn-pub tsc --noEmit → exit 0; .spur/run/0292-gate.log → 3129 pass / 0 fail (2 skip, 169 files, 417.88s).

**Next:** disposition finding 1 (record the live-only decision in the task trail or implement the draft leg), fix finding 2's citations in the same pass, then re-run this review on the updated diff.

### References

- Parent feature E97; docs/design/publish-plugin-specification.md; docs/00_ADR.md ADR-022/026/027/029/032/038.
- Existing seams: packages/kk-core/src/schemas.ts:16,36,48; packages/kk-core/src/manifest.ts:59; packages/publish-harness/src/index.ts:8; packages/publish-harness/src/browser.ts:169,325,436,553,610,737.
- WeChat callers: plugins/publishings/wechatmp-pub/src/flow.ts:245,1137; src/index.ts:254,310; src/modes.ts:144; tests/fixtures/wechatmp-dom-runner.ts.
- Source snapshot: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json; csdn.js:1–18,185–245; current CSDN public app.chunk.3e8e17a6.js byte offsets 394016,411827,433474,498621,690000; historical review docs/design/yijianfa-extension-review.md.
- Report: docs/plans/2026-10-14-publish-ready-refinement.md.
- Concurrency: one main worktree/no wip task at kickoff; concurrent 0287 and Board work preserved.
- Primary Playwright input/shadow contracts: https://playwright.dev/docs/input#upload-files and https://playwright.dev/docs/locators#locate-in-shadow-dom.
- CSDN primary HTML/bundle: https://editor.csdn.net/md/ and https://csdnimg.cn/release/md/static/js/app.chunk.3e8e17a6.js.

### History

- 2026-10-15T06:14:50.348Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.
- 2026-10-15T14:33:39.463Z todo → wip (system)
- 2026-10-15T16:42:39.197Z wip → testing (system)
- 2026-10-15T16:42:39.562Z testing → done (system)

