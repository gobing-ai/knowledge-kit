---
schema_version: 1
name: Implement csdn-pub publish plugin for CSDN markdown articles and covers
status: done
template: feature-impl
created_at: 2026-10-15T05:55:13.278Z
updated_at: "2026-10-16T07:38:23.366Z"
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

1. [x] Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
2. [x] (R1, R4) Scaffold contract/probe and record current primary bundle hash/selector candidates; validate operation/payload/status before browser.
3. [x] (R2, R3) Implement native editor input/paste, scoped modal tags/categories/cover and exact persisted-state readback, respecting the draft-only submission boundary.
4. [x] (R1–R4) Execute production DOM fixtures for cledit text, cover/tag/category failure, draft modal behavior, stale toasts and explicit public; verify no vendor signed API/keys are used and run packed entry/check acceptance.
5. [x] Update `docs/04_DESIGN.md` with this shipped surface in the same change; align relevant feature notes/status only after real delivery.
6. [x] Run project lint/tests/build/rules and task-pipeline review/traceable verify before done; fixture success is not a live account acceptance certificate.

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
| R1 | MET | Manifest kind publish, entry, check and csdn browserSession `plugins/publishings/csdn-pub/plugin.json:3-10`; `CSDN_OPERATIONS` `plugins/publishings/csdn-pub/src/index.ts:76`; `resolveOperation` `plugins/publishings/csdn-pub/src/index.ts:223`; `processPublishIO` `plugins/publishings/csdn-pub/src/index.ts:1116`. Tested `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:478`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:916`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:940`; installed check list `scripts/bundle-plugins.test.ts:38`; probe list `apps/cli/tests/commands/plugin-check.test.ts:182`. |
| R2 | MET | `CsdnBrowserTransport` `plugins/publishings/csdn-pub/src/index.ts:342` refuses dropped fields at `title-readback` `plugins/publishings/csdn-pub/src/index.ts:529`, `body-readback` `plugins/publishings/csdn-pub/src/index.ts:555` and `tag-commit` `plugins/publishings/csdn-pub/src/index.ts:588`. Tested `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:605`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:625`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:647` (lookalike tag never substitutes), `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:658`. |
| R3 | MET | Category stage `category-select` `plugins/publishings/csdn-pub/src/index.ts:595` and cover stage `cover-upload` `plugins/publishings/csdn-pub/src/index.ts:602`; vendor signing material not ported `plugins/publishings/csdn-pub/src/index.ts:16`. Tested `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:668`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:679`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:785`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:800`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:828`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:1036` (zero vendor credentials in src). |
| R4 | MET | Absent/draft publishStatus maps to the draft leg `plugins/publishings/csdn-pub/src/index.ts:379` through `DRAFT_SAVE_SELECTORS` `plugins/publishings/csdn-pub/src/index.ts:179`; fresh confirmation stage `plugins/publishings/csdn-pub/src/index.ts:642`. Tested `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:700`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:715`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:740`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:862` (stale receipt never confirms), `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:994`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:1007`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:1022` (real-Chromium draft leg); profile CLI `plugins/publishings/csdn-pub/src/profile-check.ts` via `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:515`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R2 - csdn-pub publishes Markdown article with cover (req: R1, R2, R3, R4) | MET | test | `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:828` settled cover with fresh preview publishes; `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:1007` real-Chromium public flow; `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:1022` real-Chromium draft leg; `bun run test` 3750 pass / 0 fail exit 0 (2026-10-16). |
| AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4) | MET | command | `bun run test` exit 0 and `bun run lint` exit 0 on 2026-10-16; zero-launch refusals `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:398`, `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:446`; readiness `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:526`; installed check `scripts/bundle-plugins.test.ts:38`; surface section `docs/04_DESIGN.md:1337`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review** (re-verify 2026-10-16, `/sp:dev-verifyall --force --fix all`; verdict: PASS)

- The first review (FAIL: P2 missing draft leg, P3 csdn.js citation drift) was closed by the task 0292 review fix. Re-read against current lines:
  - P2 draft leg: absent or `draft` publishStatus now takes the draft leg (`plugins/publishings/csdn-pub/src/index.ts:379`) through the pinned top-level 保存草稿 control `DRAFT_SAVE_SELECTORS` (`plugins/publishings/csdn-pub/src/index.ts:179`). Tested at `plugins/publishings/csdn-pub/tests/csdn-pub.test.ts:700`, `:715`, `:724` and `:740`.
  - P3 citation drift: the citations now read saveArticle csdn.js:183-248 (`plugins/publishings/csdn-pub/src/index.ts:10`), signing material csdn.js:32-41 (`plugins/publishings/csdn-pub/src/index.ts:16`), and toast lines csdn.js:242/245 (`plugins/publishings/csdn-pub/src/index.ts:180`, `:182`).

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | Architecture | `plugins/publishings/csdn-pub/src/index.ts:179` | Draft and public legs use separate pinned controls; un-pinned selectors are marked Provisional and fail loud. Accepted advisory. |
| P4 | Security | `plugins/publishings/csdn-pub/src/index.ts:16` | Vendor signing material and the OBS direct upload are not ported. No finding. |

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

