---
schema_version: 1
name: Implement sspai-pub publish plugin for SSPAI Matrix column submissions
status: done
template: feature-impl
created_at: 2026-10-15T05:55:13.924Z
updated_at: "2026-10-16T07:34:21.180Z"
feature_id: E97

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0294-verdict.json
---

## 0294. Implement sspai-pub publish plugin for SSPAI Matrix column submissions

### Background

Implement sspai-pub publish plugin for SSPAI Matrix column submissions is valid planned work in E97; the requested package/helper is not implemented in the current tree. Existing publish-harness browser/session/lease/upload/shadow helpers and current WeChat modes are the reuse baseline, not a blank scaffold. The historical review is not evidence of live platform capability.

**Refine corrections (2026-10-14)**

- SSPAI adapter was said to save/submit drafts → source explicitly stops at preview and lacks save confirmation → implement a real observed draft save or fail, never call preview a draft.
- Markdown paste was implied native → source pastes text/html into contenteditable → freeze safe Markdown rendering/paste/readback using existing helpers.
- Global first file/editor selectors could target unrelated controls → scope candidate controls to the active article editor and verify requested cover.
- Public behavior and installed contracts were absent → freeze draft-only delivery, public refusal and standard profile/check/discovery gates.

Verified source: exact extension v0.1.55 recovered read-only from Google's extension update service, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425; relevant sspai.js:1–88. File hashes and durable inspected copies are in .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. The extension was not installed or executed. Browser candidate controls/private protocol are source observations only, not a verified authenticated live run. All local issues remain valid implementation outcomes; no issue dropped. At kickoff one main worktree/no wip task was observed, while 0287 kk-core and Board edits existed concurrently and must not be reverted. Bun 1.4.3, Playwright 1.55.0 and Biome 2.5.15 match pins; final corpus writes use latest bun-global Spur. Recheck ownership/environment drift at implementation step 0.

### Requirements

- [x] R1. Deliver discoverable sspai-pub article script plugin and standard session/profile/Result contracts.
- [x] R2. Render Markdown to safe article HTML, populate/read back title/body and verify requested header cover through the SSPAI editor.
- [x] R3. Report draft success only after a persistent saved draft receipt/readback; preview or editor fill alone remains failure/needs inspection, never a saved draft.
- [x] R4. Provide profile/readiness and mapping/fake tests plus real production DOM fixtures covering default draft, unsupported public, save/preview distinction and failures.

### Acceptance Criteria

- [x] AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)

- [x] AC1 — R4 - sspai-pub populates Matrix submission draft (req: R1, R2, R3, R4)

```gherkin
Feature: Implement sspai-pub publish plugin for SSPAI Matrix column submissions

  Scenario: AC1 — R4 - sspai-pub populates Matrix submission draft (req: R1, R2, R3, R4)
    Given an authenticated SSPAI session and an article payload
    When `sspai-pub` executes operation `article`
    Then the editor content and requested header cover are verified and a persistent saved draft is observed
    And a preview or fill-only receipt cannot establish draft success

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

#### Q&A entry — 2026-10-15T06:14:53.633Z

Closed by inline ready refinement 2026-10-14: the Design freezes payload/operation/status boundaries, source-grounded or explicitly provisional controls, refusal/receipt handling, file ownership and test layer.  Provider/UI drift and operator-run live acceptance are delivery checks owned by this WBS, not invented current facts. Existing unsupported requested fields fail explicitly. No task cancellation/merge/link is authorized or needed.

### Design

Own plugin package; target/profile=sspai, operations=['article'], default article; fixed home https://sspai.com/ and site-owned article editor navigation. Source candidates textarea[placeholder="请输入标题..."] and editor-scoped div[contenteditable="true"], header-cover file input inside that same editor. Use existing markdownToHtml/pasteHtml but sanitize raw HTML/unsafe links/scripts/event attributes before insertion; preserve normal code/list markup and readback title/body. No new Markdown/DOM dependency. Cover missing is optional; requested cover absent/unverified is failure, never source-style safe skip.

This slice saves drafts only. metadata.publishStatus=public refuses before browser because final publication/submission is not evidenced and not requested by its AC. Exact scoped 保存/保存草稿 control is a provisional bounded candidate; require a new persisted draft id/link or changed matching draft record and title/body/cover readback. Source a.editor-extra-button-preview is only preview and must never satisfy save success. The official archived SSPAI editor guide documents draft saving historically but does not establish current account UI; cite its age and require a current read-only capability check during implementation. Missing current save controls yields named failure, not a manufactured draft. No Matrix column membership changes or automatic editorial submission.

Follow ADR-007/009/012/016/022/027/029/032/038 and docs/design/publish-plugin-specification.md. Existing plugins expose Content → Result, not TargetOutcome (fan-out owns that aggregate). No new plugin kind, transport, runtime, dependency or generic automation framework. For new channels copy only the current package/tsconfig/CLI skeleton from weibo-pub or juejin-pub, importing shared packages by @gobing-ai names. Manifest operations is the auxiliary IO-form map, not a list of publishing verbs: omit it for ordinary Content → Result publishing types; dispatch a frozen local operation list using options.operation ?? content.metadata.operation ?? default before browser/profile creation. driver defaults to script and other values fail by name. Use check/profile-check.ts + browserSession {profileName:<channel>,homeUrl:<fixed non-secret entry>} for installed bot integration. Preserve --in/--out, valid ResultSchema output, stdout routing and exit semantics. API-only paths must not load Playwright eagerly.

Frozen common payload rules for new channels: Content.body is Markdown/text as the operation requires, title is a required nonempty string for article/podcast/video operations; metadata.publishStatus is absent|draft|public, default draft; metadata.coverPath is an optional existing local PNG/JPEG/WebP file; metadata.images is an optional array of existing local image paths; metadata.tags/categories are optional arrays of nonempty exact names. Reject wrong types, missing required assets, unsupported requested fields and unknown operations/status/driver before opening a browser; never silently truncate or invent media/fields. File IO uses the sanctioned FileSystem seam. Media paths resolve as current peer plugins do; require regular readable nonempty files and accepted extension/MIME, no automatic remote downloads or blob URL server. For audio/video use Playwright setInputFiles on the local path (streamed by the browser), never read entire media into JSON/base64. Existing uploadFile suffices for one file; page/locator.setInputFiles(paths) handles multiple. No dependency on 0287 content limits or 0288 hooks: channel validation is local and those are independent capabilities, avoiding out-of-set blockers and silent ownership changes.

Profile/readiness: reuse resolveChannelProfileDir, checkChannelSession, kkBrowserLauncher and runProfileCli including login/check/open behavior and current lease protection. The channel predicate must observe a site-owned composer/control and reject login redirects; page body mentioning 登录 is insufficient. Publish preflight uses headedFallback=false; interactive login remains operator-owned. Close the opened context in finally. Poll via waitUntil/expectOutcome, 30s per normal step and 600s media processing ceiling, no blind sleep or unbounded retry. A successful fill/file assignment is not a saved draft or publication. Snapshot baseline URLs/toasts/cards before submit; require a new operation-specific receipt or persisted item with matching title/body/media identity. Missing/ambiguous/stale/contradictory confirmation returns ok:false with bounded error and metadata.stage/evidence; never invent id/url or retry a possibly accepted create/publish. Only safe UI-field operations can be retried before submission. No mandatory source-derived numeric platform limit is asserted without a dated primary source; observed control constraints and explicit local resource caps are labeled as such.

Testing: FakeBrowserTransport verifies mapping/CLI only; it cannot establish real page behavior. The named local Chromium fixture runner must execute production selectors, scripts and flows, return observable field/event/action/receipt facts, and throw on missing browser prerequisites rather than skip. Extend each plugin's tests for payload refusal, profile missing/login redirects, default draft, explicit public, requested unsupported fields, upload processing/error/cancel/timeout, stale signals and cleanup. Isolate fake mode and fixture origins; zero live account writes or provider calls in CI. Package acceptance must discover and invoke the packed plugin and its check entry outside the checkout, since scripts/bundle-plugins.ts bundles product entry/check and prunes tests. Add only the relevant package regression, no publisher registry because discovery already scans collections.

Live UI candidate selectors are evidence dated 2026-10-14 from the recovered extension or current public application bundle; they are not proof a particular account is entitled or that current publishing succeeds. Implementation must run a read-only capability probe and fail clearly if a required candidate/control is absent. Real operator-run draft/live verification is a separate delivery check; fixture PASS alone must not be described as live platform support. Same-change docs/04_DESIGN.md for shipped surface; docs/05_FEATURES.md only on actual feature state change. Budget boundary preserves artifacts and resumes current contracts; requireDiff is implementation plus behavior tests and surface docs.

Dependencies/handoff: No prerequisites; no reliance on 0287/0288 or another new publisher. No dependent task in this selected set consumes its implementation. Changes remain scoped to named files. Estimate 8h/P2; no source implementation during refine.

Exact file ownership: plugins/publishings/sspai-pub/{package.json,tsconfig.json,plugin.json}, src/{index,flow,selectors,profile-check}.ts; tests/sspai-pub.test.ts, tests/sspai-pub-dom.test.ts and tests/fixtures/sspai-pub-dom-runner.ts. Installed entry/check assertion belongs in this plugin's test suite and existing apps/cli/tests/package.test.ts only if a packaging regression requires it. Shared library/registry source is outside ownership; reuse current exports. The plugin manifest's browserSession.profileName is the channel slug without -pub, not the package name. Existing CLI invocation is --in <Content JSON> --out <Result JSON>; no new top-level kk verb.

### Plan

- [x] Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
- [x] (R1,R4) Scaffold article/probe/Result contract and draft-only pre-browser rail.
- [x] (R2) Implement safe HTML paste, scoped title/cover and readback with named required-control errors.
- [x] (R3,R4) Implement observed save receipt handling; execute production fixtures separating fill/preview/save, stale drafts, cover failure and public refusal; run installed discovery/check acceptance.
- [x] Update docs/04_DESIGN.md with this shipped surface in the same change; align relevant feature notes/status only after real delivery.
- [x] Run project lint/tests/build/rules and task-pipeline review/traceable verify before done; fixture success is not a live account acceptance certificate.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/commands/plugin-check.test.ts:177` |
| `apps/cli/tests/commands/plugin-check.test.ts:184` |
| `apps/cli/tests/commands/plugin-check.test.ts:193` |
| `bunfig.toml:30` |
| `docs/04_DESIGN.md:1073` |
| `docs/04_DESIGN.md:1348` |
| `docs/04_DESIGN.md:26` |
| `packages/kk-core/tests/registry.test.ts:239` |
| `packages/kk-core/tests/registry.test.ts:613` |
| `scripts/bundle-plugins.test.ts:34` |
| `scripts/bundle-plugins.test.ts:41` |
| `plugins/publishings/sspai-pub/package.json:1` |
| `plugins/publishings/sspai-pub/plugin.json:1` |
| `plugins/publishings/sspai-pub/src/flow.ts:1` |
| `plugins/publishings/sspai-pub/src/index.ts:1` |
| `plugins/publishings/sspai-pub/src/profile-check.ts:1` |
| `plugins/publishings/sspai-pub/src/selectors.ts:1` |
| `plugins/publishings/sspai-pub/tests/fixtures/sspai-pub-dom-runner.ts:1` |
| `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:1` |
| `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:1` |
| `plugins/publishings/sspai-pub/tsconfig.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Manifest kind publish, entry, check and sspai browserSession `plugins/publishings/sspai-pub/plugin.json:3-10`; `SSPAI_OPERATIONS` `plugins/publishings/sspai-pub/src/index.ts:31`; `resolveOperation` `plugins/publishings/sspai-pub/src/index.ts:41`; `processPublishIO` `plugins/publishings/sspai-pub/src/index.ts:105`. Tested `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:337`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:354`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:538`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:598`; installed check list `scripts/bundle-plugins.test.ts:43`. |
| R2 | MET | `sanitizeArticleHtml` `plugins/publishings/sspai-pub/src/flow.ts:120`; `SspaiBrowserTransport` `plugins/publishings/sspai-pub/src/flow.ts:237` refuses at `title-readback` `plugins/publishings/sspai-pub/src/flow.ts:426` and `cover-attach` `plugins/publishings/sspai-pub/src/flow.ts:469`. Tested `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:493`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:907` (unquoted javascript:/data: stripped), `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:518`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:742`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:783`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:804`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:816`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:828`. |
| R3 | MET | Draft success only from `draft-receipt` `plugins/publishings/sspai-pub/src/flow.ts:578` and `confirmedBy: 'draft-receipt'` `plugins/publishings/sspai-pub/src/flow.ts:599`; save failures typed `draft-save` `plugins/publishings/sspai-pub/src/flow.ts:523`; receipt shapes `SSPAI_RECEIPT_URL_RES` `plugins/publishings/sspai-pub/src/selectors.ts:89`. Tested `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:706`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:838` (preview never clicked), `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:877`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:889` (toast never confirms), `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:897`. |
| R4 | MET | Public refuses pre-browser in the draft-only slice, tested `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:395`; readiness `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:378`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:652`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:663`; real-Chromium fixtures `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:45`, `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:53`, `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:68`, `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:78`, `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:87`, `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:97`, `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:107`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R4 - sspai-pub populates Matrix submission draft (req: R1, R2, R3, R4) | MET | test | `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:53` real-Chromium default draft with fresh draft-id URL and preview never clicked; `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:68` cover leg; `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:706`; `bun run test` 3750 pass / 0 fail exit 0 (2026-10-16). |
| AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4) | MET | command | `bun run test` exit 0 and `bun run lint` exit 0 on 2026-10-16; zero-launch refusals `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:395`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:407`, `plugins/publishings/sspai-pub/tests/sspai-pub.test.ts:449`; `plugins/publishings/sspai-pub/tests/sspai-pub-dom.test.ts:97` stale receipt fails closed; installed check `scripts/bundle-plugins.test.ts:43`; surface section `docs/04_DESIGN.md:1358`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Parent feature E97; docs/design/publish-plugin-specification.md; docs/00_ADR.md ADR-022/026/027/029/032/038.
- Existing seams: packages/kk-core/src/schemas.ts:16,36,48; packages/kk-core/src/manifest.ts:59; packages/publish-harness/src/index.ts:8; packages/publish-harness/src/browser.ts:169,325,436,553,610,737.
- WeChat callers: plugins/publishings/wechatmp-pub/src/flow.ts:245,1137; src/index.ts:254,310; src/modes.ts:144; tests/fixtures/wechatmp-dom-runner.ts.
- Source snapshot: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json; sspai.js:1–88; historical review docs/design/yijianfa-extension-review.md.
- Report: docs/plans/2026-10-14-publish-ready-refinement.md.
- Concurrency: one main worktree/no wip task at kickoff; concurrent 0287 and Board work preserved.
- Primary Playwright input/shadow contracts: https://playwright.dev/docs/input#upload-files and https://playwright.dev/docs/locators#locate-in-shadow-dom.
- Historical official SSPAI guide (archived, current controls unverified): https://sspai.com/post/37790.

### History

- 2026-10-15T06:14:54.748Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.
- 2026-10-15T17:55:11.190Z todo → wip (system)
- 2026-10-15T19:12:03.315Z wip → testing (system)
- 2026-10-15T19:12:03.671Z testing → done (system)

