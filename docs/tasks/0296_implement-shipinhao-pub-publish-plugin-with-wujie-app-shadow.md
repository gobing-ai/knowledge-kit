---
schema_version: 1
name: Implement shipinhao-pub publish plugin with wujie-app shadowRoot traversal for short videos
status: todo
template: feature-impl
created_at: 2026-10-15T05:55:14.512Z
updated_at: "2026-10-15T06:21:58.840Z"
feature_id: E98

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 12
---

## 0296. Implement shipinhao-pub publish plugin with wujie-app shadowRoot traversal for short videos

### Background

Implement shipinhao-pub publish plugin with wujie-app shadowRoot traversal for short videos is valid planned work in E98; the requested package/helper is not implemented in the current tree. Existing publish-harness browser/session/lease/upload/shadow helpers and current WeChat modes are the reuse baseline, not a blank scaffold. The historical review is not evidence of live platform capability.

**Refine corrections (2026-10-14)**

- Shadow support was presented as entirely new shared work → browser.ts already exports findShadowControl/createShadowFinder and Playwright pierces open roots → keep site-root logic in this plugin and reuse helpers.
- Unready wujie root could fall back to document → vendor explicitly waits once wujie-app exists → freeze no wrong-root fallback and ambiguity refusal.
- Original declaration was unconditional → it is a factual operator assertion and source treats failures as logs → require metadata.original=true before checking, with committed-state readback; missing/false never checks it.
- Canvas/upload actions were equated with completed content → source distinguishes preview/state from final confirmation → verify cover commit and fresh saved/published item, preserving draft default.

Verified source: exact extension v0.1.55 recovered read-only from Google's extension update service, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425; relevant shipinhao.js:1–65,515–541,1461–1585. File hashes and durable inspected copies are in .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. The extension was not installed or executed. Browser candidate controls/private protocol are source observations only, not a verified authenticated live run. All local issues remain valid implementation outcomes; no issue dropped. At kickoff one main worktree/no wip task was observed, while 0287 kk-core and Board edits existed concurrently and must not be reverted. Bun 1.4.3, Playwright 1.55.0 and Biome 2.5.15 match pins; final corpus writes use latest bun-global Spur. Recheck ownership/environment drift at implementation step 0.

### Requirements

- [ ] R1. Deliver discoverable shipinhao-pub shortVideo script plugin with validated local video/cover/metadata and standard session/profile/Result contracts.
- [ ] R2. Traverse the active wujie-app open shadow root with bounded readiness; reuse existing shadow helpers for supported closed-root controls and refuse inaccessible/ambiguous roots.
- [ ] R3. Upload/process video, commit requested cover and explicit original-declaration choice with observable readback before draft/public submission; never declare originality by default.
- [ ] R4. Provide readiness/fake mapping and production shadow DOM/video/cover/declaration fixtures with default-draft or explicit-public rails and verified fresh completion.

### Acceptance Criteria

- [ ] AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)

- [ ] AC1 — R2 - shipinhao-pub traverses shadowRoot and uploads short video (req: R1, R2, R3, R4)

```gherkin
Feature: Implement shipinhao-pub publish plugin with wujie-app shadowRoot traversal for short videos

  Scenario: AC1 — R2 - shipinhao-pub traverses shadowRoot and uploads short video (req: R1, R2, R3, R4)
    Given an authenticated Channels session with `<wujie-app>` shadow DOM and explicit original and public requests
    When `shipinhao-pub` executes operation `shortVideo`
    Then video file is uploaded, cover cropped, original declaration checked, and publication state read back

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

#### Q&A entry — 2026-10-15T06:14:58.099Z

Closed by inline ready refinement 2026-10-14: the Design freezes payload/operation/status boundaries, source-grounded or explicitly provisional controls, refusal/receipt handling, file ownership and test layer.  Provider/UI drift and operator-run live acceptance are delivery checks owned by this WBS, not invented current facts. Existing unsupported requested fields fail explicitly. No task cancellation/merge/link is authorized or needed.

### Design

Own plugin package; target/profile=shipinhao, operations=['shortVideo'], default shortVideo. Require metadata.videoPath existing MP4/MOV regular file, title nonempty, Content.body description, metadata.coverPath optional, tags optional nonempty exact strings, metadata.original optional boolean. original=true explicitly authorizes the requested declaration UI sequence; false/absent leaves it unchecked and cannot be relabeled original. No automatic originality claim or source-style first-checkbox click. Validate MIME/extensions, 2 GiB KK v1 local resource cap, 600s media processing budget (not platform maximum).

Root policy: if wujie-app is present, wait at most 30s for its shadowRoot and a unique creator form; do not use document merely because the shadow is late. If no wujie-app exists, require a unique direct creator form before proceeding. Use Playwright open-shadow locators (avoid XPath); existing createShadowFinder/CDP helper may locate known closed-root semantic controls, but no guessed coordinates or global shared-framework rewrite. Tests execute both delayed/open root and unsupported/ambiguous root paths through actual production resolution.

Use active-form video file input setInputFiles and wait for processing-ready UI/media id. Cover upload opens the scoped cover dialog, uses its file input, confirms crop with labeled controls and verifies the committed cover card after dialog closure; canvas presence alone is insufficient. For original=true locate the semantic 声明原创 row, its associated checkbox and the declare-body-wrapper agreement/confirm controls; verify committed checked state and closed dialog, fail requested declaration on any missing/ambiguous evidence. Preserve exact description/topic readback after dialogs. Default draft selects only an observed 保存草稿 action and requires persisted draft id/record; if the account lacks draft capability refuse rather than publish. Public requires explicit metadata.publishStatus=public, one scoped 发表/发布 action and a new matching works/publication receipt. No scheduling/transcoding or automatic platform setup.

Follow ADR-007/009/012/016/022/027/029/032/038 and docs/design/publish-plugin-specification.md. Existing plugins expose Content → Result, not TargetOutcome (fan-out owns that aggregate). No new plugin kind, transport, runtime, dependency or generic automation framework. For new channels copy only the current package/tsconfig/CLI skeleton from weibo-pub or juejin-pub, importing shared packages by @gobing-ai names. Manifest operations is the auxiliary IO-form map, not a list of publishing verbs: omit it for ordinary Content → Result publishing types; dispatch a frozen local operation list using options.operation ?? content.metadata.operation ?? default before browser/profile creation. driver defaults to script and other values fail by name. Use check/profile-check.ts + browserSession {profileName:<channel>,homeUrl:<fixed non-secret entry>} for installed bot integration. Preserve --in/--out, valid ResultSchema output, stdout routing and exit semantics. API-only paths must not load Playwright eagerly.

Frozen common payload rules for new channels: Content.body is Markdown/text as the operation requires, title is a required nonempty string for article/podcast/video operations; metadata.publishStatus is absent|draft|public, default draft; metadata.coverPath is an optional existing local PNG/JPEG/WebP file; metadata.images is an optional array of existing local image paths; metadata.tags/categories are optional arrays of nonempty exact names. Reject wrong types, missing required assets, unsupported requested fields and unknown operations/status/driver before opening a browser; never silently truncate or invent media/fields. File IO uses the sanctioned FileSystem seam. Media paths resolve as current peer plugins do; require regular readable nonempty files and accepted extension/MIME, no automatic remote downloads or blob URL server. For audio/video use Playwright setInputFiles on the local path (streamed by the browser), never read entire media into JSON/base64. Existing uploadFile suffices for one file; page/locator.setInputFiles(paths) handles multiple. No dependency on 0287 content limits or 0288 hooks: channel validation is local and those are independent capabilities, avoiding out-of-set blockers and silent ownership changes.

Profile/readiness: reuse resolveChannelProfileDir, checkChannelSession, kkBrowserLauncher and runProfileCli including login/check/open behavior and current lease protection. The channel predicate must observe a site-owned composer/control and reject login redirects; page body mentioning 登录 is insufficient. Publish preflight uses headedFallback=false; interactive login remains operator-owned. Close the opened context in finally. Poll via waitUntil/expectOutcome, 30s per normal step and 600s media processing ceiling, no blind sleep or unbounded retry. A successful fill/file assignment is not a saved draft or publication. Snapshot baseline URLs/toasts/cards before submit; require a new operation-specific receipt or persisted item with matching title/body/media identity. Missing/ambiguous/stale/contradictory confirmation returns ok:false with bounded error and metadata.stage/evidence; never invent id/url or retry a possibly accepted create/publish. Only safe UI-field operations can be retried before submission. No mandatory source-derived numeric platform limit is asserted without a dated primary source; observed control constraints and explicit local resource caps are labeled as such.

Testing: FakeBrowserTransport verifies mapping/CLI only; it cannot establish real page behavior. The named local Chromium fixture runner must execute production selectors, scripts and flows, return observable field/event/action/receipt facts, and throw on missing browser prerequisites rather than skip. Extend each plugin's tests for payload refusal, profile missing/login redirects, default draft, explicit public, requested unsupported fields, upload processing/error/cancel/timeout, stale signals and cleanup. Isolate fake mode and fixture origins; zero live account writes or provider calls in CI. Package acceptance must discover and invoke the packed plugin and its check entry outside the checkout, since scripts/bundle-plugins.ts bundles product entry/check and prunes tests. Add only the relevant package regression, no publisher registry because discovery already scans collections.

Live UI candidate selectors are evidence dated 2026-10-14 from the recovered extension or current public application bundle; they are not proof a particular account is entitled or that current publishing succeeds. Implementation must run a read-only capability probe and fail clearly if a required candidate/control is absent. Real operator-run draft/live verification is a separate delivery check; fixture PASS alone must not be described as live platform support. Same-change docs/04_DESIGN.md for shipped surface; docs/05_FEATURES.md only on actual feature state change. Budget boundary preserves artifacts and resumes current contracts; requireDiff is implementation plus behavior tests and surface docs.

Dependencies/handoff: No prerequisites; no reliance on 0287/0288 or another new publisher. No dependent task in this selected set consumes its implementation. Changes remain scoped to named files. Estimate 12h/P2; no source implementation during refine.

Exact file ownership: plugins/publishings/shipinhao-pub/{package.json,tsconfig.json,plugin.json}, src/{index,flow,selectors,profile-check}.ts; tests/shipinhao-pub.test.ts, tests/shipinhao-pub-dom.test.ts and tests/fixtures/shipinhao-pub-dom-runner.ts. Installed entry/check assertion belongs in this plugin's test suite and existing apps/cli/tests/package.test.ts only if a packaging regression requires it. Shared library/registry source is outside ownership; reuse current exports. The plugin manifest's browserSession.profileName is the channel slug without -pub, not the package name. Existing CLI invocation is --in <Content JSON> --out <Result JSON>; no new top-level kk verb.

### Plan

- [ ] Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
- [ ] (R1,R4) Scaffold video operation/probe and strict metadata/file/status validation without shared-library changes.
- [ ] (R2) Implement bounded active-root selection using existing open-shadow/CDP helpers with delayed/unavailable/ambiguous fixtures.
- [ ] (R3) Implement processed-media, cover-dialog commit and explicit requested-original protocol with readback; handle default draft and explicit public separately.
- [ ] (R1–R4) Execute production shadow fixtures for wrong root, delayed root, original absent/false/true, canvas without commit, stale signals, timeout and cleanup; prove installed entry/check.
- [ ] Update docs/04_DESIGN.md with this shipped surface in the same change; align relevant feature notes/status only after real delivery.
- [ ] Run project lint/tests/build/rules and task-pipeline review/traceable verify before done; fixture success is not a live account acceptance certificate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature E98; docs/design/publish-plugin-specification.md; docs/00_ADR.md ADR-022/026/027/029/032/038.
- Existing seams: packages/kk-core/src/schemas.ts:16,36,48; packages/kk-core/src/manifest.ts:59; packages/publish-harness/src/index.ts:8; packages/publish-harness/src/browser.ts:169,325,436,553,610,737.
- WeChat callers: plugins/publishings/wechatmp-pub/src/flow.ts:245,1137; src/index.ts:254,310; src/modes.ts:144; tests/fixtures/wechatmp-dom-runner.ts.
- Source snapshot: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json; shipinhao.js:1–65,515–541,1461–1585; historical review docs/design/yijianfa-extension-review.md.
- Report: docs/plans/2026-10-14-publish-ready-refinement.md.
- Concurrency: one main worktree/no wip task at kickoff; concurrent 0287 and Board work preserved.
- Primary Playwright input/shadow contracts: https://playwright.dev/docs/input#upload-files and https://playwright.dev/docs/locators#locate-in-shadow-dom.

### History

- 2026-10-15T06:14:59.257Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.

