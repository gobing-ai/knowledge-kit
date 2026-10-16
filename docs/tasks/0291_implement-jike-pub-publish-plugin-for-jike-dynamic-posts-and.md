---
schema_version: 1
name: Implement jike-pub publish plugin for Jike dynamic posts and topic tagging
status: done
template: feature-impl
created_at: 2026-10-15T05:55:12.989Z
updated_at: "2026-10-16T07:32:02.226Z"
feature_id: E97

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0291-verdict.json
---

## 0291. Implement jike-pub publish plugin for Jike dynamic posts and topic tagging

### Background

Implement jike-pub publish plugin for Jike dynamic posts and topic tagging is valid planned work in E97; the requested package/helper is not implemented in the current tree. Existing publish-harness browser/session/lease/upload/shadow helpers and current WeChat modes are the reuse baseline, not a blank scaffold. The historical review is not evidence of live platform capability.

**Refine corrections (2026-10-14)**

- Manifest publishing operation was treated as an IO override → operations field is for auxiliary IO shapes → keep post in local dispatch and Content → Result manifest.
- uploadFilesToInput was assumed shared → harness exports uploadFile/setInputFiles, vendor helper is private MultiSync → reuse current native file helpers.
- Topic autocomplete fallback could choose first unrelated item → source has an exact-match guard → require exact committed requested chip or refuse submit.
- No draft/public or freshness policy existed → ADR-022 and weibo live-only post precedent apply → absent/draft refuses before browser, public requires a fresh matching receipt.

Verified source: exact extension v0.1.55 recovered read-only from Google's extension update service, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425; relevant jike.js:59–99,204–250,300–385. File hashes and durable inspected copies are in .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. The extension was not installed or executed. Browser candidate controls/private protocol are source observations only, not a verified authenticated live run. All local issues remain valid implementation outcomes; no issue dropped. At kickoff one main worktree/no wip task was observed, while 0287 kk-core and Board edits existed concurrently and must not be reverted. Bun 1.4.3, Playwright 1.55.0 and Biome 2.5.15 match pins; final corpus writes use latest bun-global Spur. Recheck ownership/environment drift at implementation step 0.

### Requirements

- [x] R1. Deliver one discoverable installed jike-pub Content → Result script plugin with local post operation dispatch and browserSession/profile-check integration.
- [x] R2. Populate text and requested exact topic chips in the current Jike composer, verifying committed topic identity and text readback; publication requires explicit publishStatus=public.
- [x] R3. Upload and verify requested local image attachments in caller order with no unsupported drag-drop fallback or silent omission.
- [x] R4. Implement non-mutating readiness/profile CLI, mapping/fake seams and actual production DOM-flow fixtures with failure/refusal/confirmation coverage.

### Acceptance Criteria

- [x] AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)

- [x] AC1 — R1 - jike-pub publishes dynamic post with topic tags (req: R1, R2, R3, R4)

```gherkin
Feature: Implement jike-pub publish plugin for Jike dynamic posts and topic tagging

  Scenario: AC1 — R1 - jike-pub publishes dynamic post with topic tags (req: R1, R2, R3, R4)
    Given an authenticated Jike session, an explicit public request and a dynamic text/image payload
    When `jike-pub` executes operation `post`
    Then the text and images are populated, topic tags are committed, and publication confirmation is observed

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

#### Q&A entry — 2026-10-15T06:14:46.975Z

Closed by inline ready refinement 2026-10-14: the Design freezes payload/operation/status boundaries, source-grounded or explicitly provisional controls, refusal/receipt handling, file ownership and test layer.  Provider/UI drift and operator-run live acceptance are delivery checks owned by this WBS, not invented current facts. Existing unsupported requested fields fail explicitly. No task cancellation/merge/link is authorized or needed.

### Design

Own this plugin package only: package.json, tsconfig.json, plugin.json, src/{index,flow,selectors,profile-check}.ts and tests/{jike-pub,jike-dom}.test.ts plus fixture runner. Target/profile=jike; local operations=['post'], default post. Jike post has no evidenced persistent draft flow; absent/draft refuses before browser, with instructions to request public explicitly. Body is nonempty text; metadata.tags are literal hashtag strings already present/appended explicitly in caller body, not imaginary topic chips. metadata.topic is the optional exact Jike circle/topic name; reject nonstring/empty. At most 9 images is a source-observed adapter cap, reject excess (do not slice); title/categories/cover/audio/video requests are unsupported for this operation.

Source-grounded candidates: composer 'form div[contenteditable="true"]', topic input/menu from source selectTopic, container 'div[name="topic"] div[tabindex="0"]', send button text 发送 inside the same form. Use exact topic text, no first-item fallback or token/localStorage account harvesting. Playwright native setInputFiles on the composer-scoped image input; if absent, explicit uploadUnsupported failure rather than invent the vendor clipboard bridge. Verify editor text, image preview count/identity and committed circle before one send. Snapshot /originalPost/ or /post/ links and strong toast baselines; success is a new matching post URL/card or fresh scoped success receipt, not editor clearing alone. No network API token extraction or account-topic synchronization is required.

Follow ADR-007/009/012/016/022/027/029/032/038 and docs/design/publish-plugin-specification.md. Existing plugins expose Content → Result, not TargetOutcome (fan-out owns that aggregate). No new plugin kind, transport, runtime, dependency or generic automation framework. For new channels copy only the current package/tsconfig/CLI skeleton from weibo-pub or juejin-pub, importing shared packages by @gobing-ai names. Manifest operations is the auxiliary IO-form map, not a list of publishing verbs: omit it for ordinary Content → Result publishing types; dispatch a frozen local operation list using options.operation ?? content.metadata.operation ?? default before browser/profile creation. driver defaults to script and other values fail by name. Use check/profile-check.ts + browserSession {profileName:<channel>,homeUrl:<fixed non-secret entry>} for installed bot integration. Preserve --in/--out, valid ResultSchema output, stdout routing and exit semantics. API-only paths must not load Playwright eagerly.

Frozen common payload rules for new channels: Content.body is Markdown/text as the operation requires, title is a required nonempty string for article/podcast/video operations; metadata.publishStatus is absent|draft|public, default draft; metadata.coverPath is an optional existing local PNG/JPEG/WebP file; metadata.images is an optional array of existing local image paths; metadata.tags/categories are optional arrays of nonempty exact names. Reject wrong types, missing required assets, unsupported requested fields and unknown operations/status/driver before opening a browser; never silently truncate or invent media/fields. File IO uses the sanctioned FileSystem seam. Media paths resolve as current peer plugins do; require regular readable nonempty files and accepted extension/MIME, no automatic remote downloads or blob URL server. For audio/video use Playwright setInputFiles on the local path (streamed by the browser), never read entire media into JSON/base64. Existing uploadFile suffices for one file; page/locator.setInputFiles(paths) handles multiple. No dependency on 0287 content limits or 0288 hooks: channel validation is local and those are independent capabilities, avoiding out-of-set blockers and silent ownership changes.

Profile/readiness: reuse resolveChannelProfileDir, checkChannelSession, kkBrowserLauncher and runProfileCli including login/check/open behavior and current lease protection. The channel predicate must observe a site-owned composer/control and reject login redirects; page body mentioning 登录 is insufficient. Publish preflight uses headedFallback=false; interactive login remains operator-owned. Close the opened context in finally. Poll via waitUntil/expectOutcome, 30s per normal step and 600s media processing ceiling, no blind sleep or unbounded retry. A successful fill/file assignment is not a saved draft or publication. Snapshot baseline URLs/toasts/cards before submit; require a new operation-specific receipt or persisted item with matching title/body/media identity. Missing/ambiguous/stale/contradictory confirmation returns ok:false with bounded error and metadata.stage/evidence; never invent id/url or retry a possibly accepted create/publish. Only safe UI-field operations can be retried before submission. No mandatory source-derived numeric platform limit is asserted without a dated primary source; observed control constraints and explicit local resource caps are labeled as such.

Testing: FakeBrowserTransport verifies mapping/CLI only; it cannot establish real page behavior. The named local Chromium fixture runner must execute production selectors, scripts and flows, return observable field/event/action/receipt facts, and throw on missing browser prerequisites rather than skip. Extend each plugin's tests for payload refusal, profile missing/login redirects, default draft, explicit public, requested unsupported fields, upload processing/error/cancel/timeout, stale signals and cleanup. Isolate fake mode and fixture origins; zero live account writes or provider calls in CI. Package acceptance must discover and invoke the packed plugin and its check entry outside the checkout, since scripts/bundle-plugins.ts bundles product entry/check and prunes tests. Add only the relevant package regression, no publisher registry because discovery already scans collections.

Live UI candidate selectors are evidence dated 2026-10-14 from the recovered extension or current public application bundle; they are not proof a particular account is entitled or that current publishing succeeds. Implementation must run a read-only capability probe and fail clearly if a required candidate/control is absent. Real operator-run draft/live verification is a separate delivery check; fixture PASS alone must not be described as live platform support. Same-change docs/04_DESIGN.md for shipped surface; docs/05_FEATURES.md only on actual feature state change. Budget boundary preserves artifacts and resumes current contracts; requireDiff is implementation plus behavior tests and surface docs.

Dependencies/handoff: No prerequisites; no reliance on 0287/0288 or another new publisher. No dependent task in this selected set consumes its implementation. Changes remain scoped to named files. Estimate 8h/P2; no source implementation during refine.

Exact file ownership: plugins/publishings/jike-pub/{package.json,tsconfig.json,plugin.json}, src/{index,flow,selectors,profile-check}.ts; tests/jike-pub.test.ts, tests/jike-pub-dom.test.ts and tests/fixtures/jike-pub-dom-runner.ts. Installed entry/check assertion belongs in this plugin's test suite and existing apps/cli/tests/package.test.ts only if a packaging regression requires it. Shared library/registry source is outside ownership; reuse current exports. The plugin manifest's browserSession.profileName is the channel slug without -pub, not the package name. Existing CLI invocation is --in <Content JSON> --out <Result JSON>; no new top-level kk verb.

### Plan

- [x] Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
- [x] (R1,R4) Scaffold the existing plugin/check/session contract and pre-browser operation/status/payload validation; confirm package discovery.
- [x] (R2,R3) Implement source-grounded composer/topic/upload selectors, strict readback and baseline capture; fail on unavailable required controls.
- [x] (R2–R4) Run production Jike synthetic DOM fixtures for exact topic mismatch, previews, fresh versus stale success and live-only rail, then mapping/profile/installed invocation checks.
- [x] Update docs/04_DESIGN.md with this shipped surface in the same change; align relevant feature notes/status only after real delivery.
- [x] Run project lint/tests/build/rules and task-pipeline review/traceable verify before done; fixture success is not a live account acceptance certificate.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/commands/plugin-check.test.ts:177` |
| `apps/cli/tests/commands/plugin-check.test.ts:179` |
| `bunfig.toml:18` |
| `docs/04_DESIGN.md:1073` |
| `docs/04_DESIGN.md:1317` |
| `docs/04_DESIGN.md:26` |
| `packages/kk-core/tests/registry.test.ts:228` |
| `packages/kk-core/tests/registry.test.ts:599` |
| `scripts/bundle-plugins.test.ts:34` |
| `scripts/bundle-plugins.test.ts:37` |
| `plugins/publishings/jike-pub/package.json:1` |
| `plugins/publishings/jike-pub/plugin.json:1` |
| `plugins/publishings/jike-pub/src/index.ts:1` |
| `plugins/publishings/jike-pub/src/profile-check.ts:1` |
| `plugins/publishings/jike-pub/tests/fixtures/jike-composer-runner.ts:1` |
| `plugins/publishings/jike-pub/tests/jike-pub.test.ts:1` |
| `plugins/publishings/jike-pub/tsconfig.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Manifest declares kind publish, entry, check and the jike browserSession `plugins/publishings/jike-pub/plugin.json:3-10`; `resolveOperation` `plugins/publishings/jike-pub/src/index.ts:152`; `getPublishTransport` `plugins/publishings/jike-pub/src/index.ts:716`. Tested `plugins/publishings/jike-pub/tests/jike-pub.test.ts:254`; check registry includes jike-pub `apps/cli/tests/commands/plugin-check.test.ts:191` and `scripts/bundle-plugins.test.ts:40`. |
| R2 | MET | publishStatus live-only gate `plugins/publishings/jike-pub/src/index.ts:294-301`; composer fill `plugins/publishings/jike-pub/src/index.ts:392` with text readback `plugins/publishings/jike-pub/src/index.ts:396-397`; exact topic chip commit `plugins/publishings/jike-pub/src/index.ts:399-403` matched by exact text `plugins/publishings/jike-pub/src/index.ts:503`; fresh-signal confirmation baseline `plugins/publishings/jike-pub/src/index.ts:589` and success toast `plugins/publishings/jike-pub/src/index.ts:596` against `POST_LINK_SELECTOR` `plugins/publishings/jike-pub/src/index.ts:91`. Tested `plugins/publishings/jike-pub/tests/jike-pub.test.ts:291`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:512`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:541`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:552`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:662`. |
| R3 | MET | Cap of 9 `MAX_IMAGES` `plugins/publishings/jike-pub/src/index.ts:93` refuses rather than slices `plugins/publishings/jike-pub/src/index.ts:223`; caller-order upload through one `setInputFiles` `plugins/publishings/jike-pub/src/index.ts:537`; 正在上传 settle `plugins/publishings/jike-pub/src/index.ts:542` and progress predicate `plugins/publishings/jike-pub/src/index.ts:663`. Tested `plugins/publishings/jike-pub/tests/jike-pub.test.ts:337`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:572`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:585`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:595`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:607`. |
| R4 | MET | Profile CLI `runProfileCli` `plugins/publishings/jike-pub/src/profile-check.ts:20`; fake seam `plugins/publishings/jike-pub/src/index.ts:720`. Tested `plugins/publishings/jike-pub/tests/jike-pub.test.ts:280`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:425`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:679`, `plugins/publishings/jike-pub/tests/jike-pub.test.ts:768` (missing Chromium fails loud), `plugins/publishings/jike-pub/tests/jike-pub.test.ts:781` (real-Chromium production flow); `bun run test` 3750 pass / 0 fail exit 0 (2026-10-16). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R1 - jike-pub publishes dynamic post with topic tags (req: R1, R2, R3, R4) | MET | test | `plugins/publishings/jike-pub/tests/jike-pub.test.ts:552` exact circle chip commits and posts; `plugins/publishings/jike-pub/tests/jike-pub.test.ts:484` public text post reports the fresh receipt; `plugins/publishings/jike-pub/tests/jike-pub.test.ts:781` real-Chromium production flow; `bun run test` exit 0. |
| AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4) | MET | command | `bun run test` 3750 pass / 0 fail and `bun run lint` exit 0 on 2026-10-16; zero-launch refusals `plugins/publishings/jike-pub/tests/jike-pub.test.ts:291` and `plugins/publishings/jike-pub/tests/jike-pub.test.ts:337`; installed check registry `scripts/bundle-plugins.test.ts:40`; surface row `docs/04_DESIGN.md:1331`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review** (re-verify 2026-10-16, `/sp:dev-verifyall --force --fix all`; verdict: PASS)

- The first review (FAIL: two P2 and two P3 findings) was closed in the same cycle. Each fix was re-read against current lines:
  - P2 `jike-pub` in `CHECK_DECLARING_PLUGINS`: fixed at `scripts/bundle-plugins.test.ts:40`.
  - P2 missing surface section: fixed at `docs/04_DESIGN.md:1327`.
  - P3 page-wide 发送 selector: now form-scoped at `plugins/publishings/jike-pub/src/index.ts:81`.
  - P3 stale suite title: fixed at `apps/cli/tests/commands/plugin-check.test.ts:177`.
- The P4 stale chunk-planning header is gone; the module header at `plugins/publishings/jike-pub/src/index.ts:2` no longer describes future chunks.

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | Correctness | `plugins/publishings/jike-pub/src/index.ts:399` | The topic chip is verified only at commit time, with no pre-send re-read after image upload. Accepted advisory. |
| P4 | Security | `plugins/publishings/jike-pub/src/index.ts:294` | Live-only publishStatus gate refuses before any browser opens. Errors are bounded and carry no secrets. No finding. |

### References

- Parent feature E97; docs/design/publish-plugin-specification.md; docs/00_ADR.md ADR-022/026/027/029/032/038.
- Existing seams: packages/kk-core/src/schemas.ts:16,36,48; packages/kk-core/src/manifest.ts:59; packages/publish-harness/src/index.ts:8; packages/publish-harness/src/browser.ts:169,325,436,553,610,737.
- WeChat callers: plugins/publishings/wechatmp-pub/src/flow.ts:245,1137; src/index.ts:254,310; src/modes.ts:144; tests/fixtures/wechatmp-dom-runner.ts.
- Source snapshot: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json; jike.js:59–99,204–250,300–385; historical review docs/design/yijianfa-extension-review.md.
- Report: docs/plans/2026-10-14-publish-ready-refinement.md.
- Concurrency: one main worktree/no wip task at kickoff; concurrent 0287 and Board work preserved.
- Primary Playwright input/shadow contracts: https://playwright.dev/docs/input#upload-files and https://playwright.dev/docs/locators#locate-in-shadow-dom.

### History

- 2026-10-15T06:14:48.098Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.
- 2026-10-15T12:33:08.070Z todo → wip (system)
- 2026-10-15T14:31:02.397Z wip → testing (system)
- 2026-10-15T14:31:02.856Z testing → done (system)

