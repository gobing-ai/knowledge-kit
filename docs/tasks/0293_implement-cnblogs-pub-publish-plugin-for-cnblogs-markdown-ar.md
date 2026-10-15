---
schema_version: 1
name: Implement cnblogs-pub publish plugin for Cnblogs markdown articles and categories
status: done
template: feature-impl
created_at: 2026-10-15T05:55:13.572Z
updated_at: "2026-10-15T17:54:55.130Z"
feature_id: E97

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0293-verdict.json
---

## 0293. Implement cnblogs-pub publish plugin for Cnblogs markdown articles and categories

### Background

Implement cnblogs-pub publish plugin for Cnblogs markdown articles and categories is valid planned work in E97; the requested package/helper is not implemented in the current tree. Existing publish-harness browser/session/lease/upload/shadow helpers and current WeChat modes are the reuse baseline, not a blank scaffold. The historical review is not evidence of live platform capability.

**Refine corrections (2026-10-14)**

- Vendor was treated as complete category/save flow → cnblogs.js only fills title/body/summary and uploads images → add explicit category and persisted-save verification instead of assuming fill proves draft.
- Operation dispatch and profile integration were absent → ordinary publish uses shared Content → Result plus browserSession/check → freeze local article and installed acceptance.
- Generic editor automation could silently lose Markdown → source identifies input#post-title and textarea#md-editor → use native value/events and exact body readback.
- Draft/public errors and requested-field handling were unspecified → freeze exact choices/fresh receipts with missing required controls refusing before submit.

Verified source: exact extension v0.1.55 recovered read-only from Google's extension update service, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425; relevant cnblogs.js:1–42. File hashes and durable inspected copies are in .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. The extension was not installed or executed. Browser candidate controls/private protocol are source observations only, not a verified authenticated live run. All local issues remain valid implementation outcomes; no issue dropped. At kickoff one main worktree/no wip task was observed, while 0287 kk-core and Board edits existed concurrently and must not be reverted. Bun 1.4.3, Playwright 1.55.0 and Biome 2.5.15 match pins; final corpus writes use latest bun-global Spur. Recheck ownership/environment drift at implementation step 0.

### Requirements

- [x] R1. Deliver discoverable cnblogs-pub with local article dispatch and standard Content → Result/profile contracts.
- [x] R2. Populate title/Markdown and optional exact categories with committed-state readback, preserving body data.
- [x] R3. Save a verified draft by default and publish only on explicit public with fresh operation-specific postcondition.
- [x] R4. Provide read-only profile readiness, fake mapping tests and actual production DOM fixtures for refusal, upload/category state, save/publish and cleanup.

### Acceptance Criteria

- [x] AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4)

- [x] AC1 — R3 - cnblogs-pub creates article draft with category (req: R1, R2, R3, R4)

```gherkin
Feature: Implement cnblogs-pub publish plugin for Cnblogs markdown articles and categories

  Scenario: AC1 — R3 - cnblogs-pub creates article draft with category (req: R1, R2, R3, R4)
    Given an authenticated Cnblogs session and an article payload
    When `cnblogs-pub` executes operation `article`
    Then title, Markdown body, and categories are saved with observed completion signal

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

#### Q&A entry — 2026-10-15T06:14:51.412Z

Closed by inline ready refinement 2026-10-14: the Design freezes payload/operation/status boundaries, source-grounded or explicitly provisional controls, refusal/receipt handling, file ownership and test layer.  Provider/UI drift and operator-run live acceptance are delivery checks owned by this WBS, not invented current facts. Existing unsupported requested fields fail explicitly. No task cancellation/merge/link is authorized or needed.

### Design

Own plugin package, local operations=['article'], default article, target/profile=cnblogs. Source candidates input#post-title, textarea#md-editor, optional textarea#summary; body remains Markdown, title and native textarea values read back. metadata.categories are exact existing account category names; match label-associated checkboxes within the category panel and verify checked state. Do not create categories or silently select first matches. No cover upload requirement in this task; requested cover/tags not implemented by the flow must be rejected as unsupported rather than claimed applied.

Candidate draft/public controls are exact visible 保存草稿/存为草稿 and 发布/发布博文 within the article form, with bounded resolution and no broad primary-button fallback. Source has no proven save/category protocol; these semantic candidates are declared provisional and fail closed if absent. Success requires new draft/post URL/id plus saved title/body/category state or a changed matching record, never assignment or toast from before submission. Do not blindly port vendor upload.cnblogs.com XSRF endpoint; remote/body asset migration is outside this task, and unsupported local Markdown images are rejected before submit rather than leak file paths or promise uploads. Existing HTTPS image references remain literal Markdown. Read-only live capability verification is an implementation environment check, not evidence claimed by this refinement.

Follow ADR-007/009/012/016/022/027/029/032/038 and docs/design/publish-plugin-specification.md. Existing plugins expose Content → Result, not TargetOutcome (fan-out owns that aggregate). No new plugin kind, transport, runtime, dependency or generic automation framework. For new channels copy only the current package/tsconfig/CLI skeleton from weibo-pub or juejin-pub, importing shared packages by @gobing-ai names. Manifest operations is the auxiliary IO-form map, not a list of publishing verbs: omit it for ordinary Content → Result publishing types; dispatch a frozen local operation list using options.operation ?? content.metadata.operation ?? default before browser/profile creation. driver defaults to script and other values fail by name. Use check/profile-check.ts + browserSession {profileName:<channel>,homeUrl:<fixed non-secret entry>} for installed bot integration. Preserve --in/--out, valid ResultSchema output, stdout routing and exit semantics. API-only paths must not load Playwright eagerly.

Frozen common payload rules for new channels: Content.body is Markdown/text as the operation requires, title is a required nonempty string for article/podcast/video operations; metadata.publishStatus is absent|draft|public, default draft; metadata.coverPath is an optional existing local PNG/JPEG/WebP file; metadata.images is an optional array of existing local image paths; metadata.tags/categories are optional arrays of nonempty exact names. Reject wrong types, missing required assets, unsupported requested fields and unknown operations/status/driver before opening a browser; never silently truncate or invent media/fields. File IO uses the sanctioned FileSystem seam. Media paths resolve as current peer plugins do; require regular readable nonempty files and accepted extension/MIME, no automatic remote downloads or blob URL server. For audio/video use Playwright setInputFiles on the local path (streamed by the browser), never read entire media into JSON/base64. Existing uploadFile suffices for one file; page/locator.setInputFiles(paths) handles multiple. No dependency on 0287 content limits or 0288 hooks: channel validation is local and those are independent capabilities, avoiding out-of-set blockers and silent ownership changes.

Profile/readiness: reuse resolveChannelProfileDir, checkChannelSession, kkBrowserLauncher and runProfileCli including login/check/open behavior and current lease protection. The channel predicate must observe a site-owned composer/control and reject login redirects; page body mentioning 登录 is insufficient. Publish preflight uses headedFallback=false; interactive login remains operator-owned. Close the opened context in finally. Poll via waitUntil/expectOutcome, 30s per normal step and 600s media processing ceiling, no blind sleep or unbounded retry. A successful fill/file assignment is not a saved draft or publication. Snapshot baseline URLs/toasts/cards before submit; require a new operation-specific receipt or persisted item with matching title/body/media identity. Missing/ambiguous/stale/contradictory confirmation returns ok:false with bounded error and metadata.stage/evidence; never invent id/url or retry a possibly accepted create/publish. Only safe UI-field operations can be retried before submission. No mandatory source-derived numeric platform limit is asserted without a dated primary source; observed control constraints and explicit local resource caps are labeled as such.

Testing: FakeBrowserTransport verifies mapping/CLI only; it cannot establish real page behavior. The named local Chromium fixture runner must execute production selectors, scripts and flows, return observable field/event/action/receipt facts, and throw on missing browser prerequisites rather than skip. Extend each plugin's tests for payload refusal, profile missing/login redirects, default draft, explicit public, requested unsupported fields, upload processing/error/cancel/timeout, stale signals and cleanup. Isolate fake mode and fixture origins; zero live account writes or provider calls in CI. Package acceptance must discover and invoke the packed plugin and its check entry outside the checkout, since scripts/bundle-plugins.ts bundles product entry/check and prunes tests. Add only the relevant package regression, no publisher registry because discovery already scans collections.

Live UI candidate selectors are evidence dated 2026-10-14 from the recovered extension or current public application bundle; they are not proof a particular account is entitled or that current publishing succeeds. Implementation must run a read-only capability probe and fail clearly if a required candidate/control is absent. Real operator-run draft/live verification is a separate delivery check; fixture PASS alone must not be described as live platform support. Same-change docs/04_DESIGN.md for shipped surface; docs/05_FEATURES.md only on actual feature state change. Budget boundary preserves artifacts and resumes current contracts; requireDiff is implementation plus behavior tests and surface docs.

Dependencies/handoff: No prerequisites; no reliance on 0287/0288 or another new publisher. No dependent task in this selected set consumes its implementation. Changes remain scoped to named files. Estimate 8h/P2; no source implementation during refine.

Exact file ownership: plugins/publishings/cnblogs-pub/{package.json,tsconfig.json,plugin.json}, src/{index,flow,selectors,profile-check}.ts; tests/cnblogs-pub.test.ts, tests/cnblogs-pub-dom.test.ts and tests/fixtures/cnblogs-pub-dom-runner.ts. Installed entry/check assertion belongs in this plugin's test suite and existing apps/cli/tests/package.test.ts only if a packaging regression requires it. Shared library/registry source is outside ownership; reuse current exports. The plugin manifest's browserSession.profileName is the channel slug without -pub, not the package name. Existing CLI invocation is --in <Content JSON> --out <Result JSON>; no new top-level kk verb.

### Plan

- [x] Step 0: recheck source hashes, existing peer callers/contracts, pinned tools/browser compatibility, current worktrees/wip ownership and predecessor readiness; preserve unrelated edits.
- [x] (R1,R4) Scaffold standard plugin/check/session and strict Markdown payload/refusal rules.
- [x] (R2,R3) Implement source title/body controls, scoped exact category choices and bounded semantic save/public controls with post-submit identity readback.
- [x] (R1–R4) Run real production DOM fixtures for missing/ambiguous categories, unchanged Markdown, unsupported fields, stale/failed draft/public signals, profile refusal and installed entry/check behavior.
- [x] Update docs/04_DESIGN.md with this shipped surface in the same change; align relevant feature notes/status only after real delivery.
- [x] Run project lint/tests/build/rules and task-pipeline review/traceable verify before done; fixture success is not a live account acceptance certificate.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/commands/plugin-check.test.ts:177` |
| `apps/cli/tests/commands/plugin-check.test.ts:180` |
| `apps/cli/tests/commands/plugin-check.test.ts:192` |
| `bunfig.toml:26` |
| `docs/04_DESIGN.md:1073` |
| `docs/04_DESIGN.md:1338` |
| `docs/04_DESIGN.md:26` |
| `packages/kk-core/tests/registry.test.ts:218` |
| `packages/kk-core/tests/registry.test.ts:591` |
| `scripts/bundle-plugins.test.ts:34` |
| `scripts/bundle-plugins.test.ts:36` |
| `plugins/publishings/cnblogs-pub/package.json:1` |
| `plugins/publishings/cnblogs-pub/plugin.json:1` |
| `plugins/publishings/cnblogs-pub/src/flow.ts:1` |
| `plugins/publishings/cnblogs-pub/src/index.ts:1` |
| `plugins/publishings/cnblogs-pub/src/profile-check.ts:1` |
| `plugins/publishings/cnblogs-pub/src/selectors.ts:1` |
| `plugins/publishings/cnblogs-pub/tests/cnblogs-pub-dom.test.ts:1` |
| `plugins/publishings/cnblogs-pub/tests/cnblogs-pub.test.ts:1` |
| `plugins/publishings/cnblogs-pub/tests/fixtures/cnblogs-pub-dom-runner.ts:1` |
| `plugins/publishings/cnblogs-pub/tsconfig.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugin.json kind/entry/check/browserSession profileName 'cnblogs' (plugins/publishings/cnblogs-pub/plugin.json:3-10); article-only dispatch `resolveOperation` (src/index.ts:33,43-47); Content→Result `processPublishIO` --in/--out (src/index.ts:107-137) |
| R2 | MET | grounded fills input#post-title / textarea#md-editor / textarea#summary (src/selectors.ts:43-47); readback flow (src/flow.ts:395-451); digest committed only when present (src/flow.ts:452-490); exact categories committed + checked-state verified (src/flow.ts:510-560) |
| R3 | MET | absent publishStatus defaults to draft, public only explicit (src/flow.ts:240-247); fresh id-bearing receipt + persisted title/body/category readback, stale/toast never success (src/flow.ts:612-642) |
| R4 | MET | operator profile CLI via shared runProfileCli + CNBLOGS_PROFILE_DIR tier (src/profile-check.ts:16-18); fake mapping tests separate from real-Chromium dom fixture (tests/cnblogs-pub.test.ts; tests/fixtures/cnblogs-pub-dom-runner.ts import.meta.main:200; bunfig.toml:26,29); suite 45 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R3 - cnblogs-pub creates article draft with category (req: R1, R2, R3, R4) | MET | test | Real-Chromium dom fixture draft-happy leg: fresh postId-bearing edit URL receipt + page-observed title/body/summary/checked category (tests/cnblogs-pub-dom.test.ts, 7 dom tests incl. ambiguous-receipt/missing-draft/missing-category typed refusals); fake happy draft+public legs (tests/cnblogs-pub.test.ts); category-commit verify + persisted readback static trace (src/flow.ts:510-560,616-642). Rerun 45 pass / 0 fail. |
| AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4) | MET | test | Typed stage-bearing refusals on every path incl. both review-fixed sites (src/flow.ts:366-380 editor-readiness; src/flow.ts:573-588 save() resolution); zero-launch pre-browser refusals (driver/status/title/unsupported fields/categories/local images/preflight, src/flow.ts:232-338); packed entry/check (scripts/bundle-plugins.test.ts:34-46); plugin-check ten channels (apps/cli/tests/commands/plugin-check.test.ts:180); registry inventories (packages/kk-core/tests/registry.test.ts:218,591); docs/04_DESIGN.md:1338-1346 section factual with corrected citations. Rerun host focused 67 pass / 0 fail; full gate .spur/run/0293-gate.log exit 0 (3183 pass). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0293 (cnblogs-pub)
**Scope:** plugins/publishings/cnblogs-pub/** (untracked, 10 files) + host integration (scripts/bundle-plugins.test.ts, apps/cli/tests/commands/plugin-check.test.ts, packages/kk-core/tests/registry.test.ts, docs/04_DESIGN.md, bunfig.toml, bun.lock)
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** FAIL

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | `resolveSelector` throws on never-attached controls (publish-harness/src/browser.ts:817-838 "Throws naming label"), and two of its four call sites have no try/catch: the editor-readiness probe and the `save()` control resolution. The throw bypasses `stageFail`, lands in `publish()`'s catch and returns a stage-less `fail()` Result — contradicting the typed-stage contract (docs/04_DESIGN.md:1345 promises stage `editor-readiness`/`draft-save` probing; every other failure path is stage-typed). The dom fixture's `missing-draft` scenario hits this exact path and asserts error text only, silently omitting the `stage` assertion its sibling `draft-ambiguous` makes. Fix: wrap flow.ts:367 and flow.ts:567 in try/catch → `stageFail(…, 'editor-readiness'/'draft-save', metadata)`; add a `groundedMissing` flow-path fake test and a `stage` assertion to the missing-draft dom test. | `plugins/publishings/cnblogs-pub/src/flow.ts:367`, `plugins/publishings/cnblogs-pub/src/flow.ts:567` | OPEN |
| 2 | P3 (minor) | traceability | Grounding citation wrong in shipped docs: "(cnblogs.js:26-36 register map + 24-31 fill)" — the evidence is fill cnblogs.js:20-32 (title 22/25, editor 23/26, summary 30-31) and register map cnblogs.js:35-37; line 24 is `replaceMarkdownImages`, the line this task deliberately does NOT port. Fix: correct the ranges (all in-src citations in src/verify clean against the evidence). | `docs/04_DESIGN.md:1343` | OPEN |
| 3 | P4 (advisory) | grounding | `CNBLOGS_HOME_URL` is labeled "Grounded: cnblogs.js:1 … (www.cnblogs.com)" but line 1 grounds the platform identity only — no domain appears in the source (only upload.cnblogs.com at :10), violating the file's own pinned-vs-provisional rule. Unused constant; no behavior impact (the check opens the explicitly-Provisional `CNBLOGS_EDIT_URL`). Fix: relabel as identity-grounded/domain-conventional. | `plugins/publishings/cnblogs-pub/src/selectors.ts:17` | ACCEPTED |
| 4 | P4 (advisory) | correctness | `countNonHttpsImageRefs` covers inline `![…](src)` only; reference-style images (`![a][r]` + `[r]: ./x.png`) pass the pre-submit gate. No upload/leak/claim occurs either way (refs stay literal Markdown), so the security property holds. Fix if desired: extend the scan to reference definitions. | `plugins/publishings/cnblogs-pub/src/flow.ts:131-142` | ACCEPTED |
| 5 | P4 (advisory) | residual risk | Public-leg confirmation re-reads persisted editor state after the click; if the live site redirects to the `/p/<id>.html` post page on successful publish, the editor controls are gone → `titleOk:false` → a genuine publish is reported as a stale-state failure (fail-closed, never a false success — but a manual retry could double-publish). The fixture models same-page anchors/pushState only. Re-check at operator-run live acceptance; consider a redirect scenario or persisted-state skip for post-URL receipts. | `plugins/publishings/cnblogs-pub/src/flow.ts:592-620` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Discovery: packages/kk-core/tests/registry.test.ts:218,589 (`cnblogs-pub` in both inventories); operation dispatch frozen to `['article']` with options→metadata→default precedence before any transport (src/index.ts:46-66); Content→Result via ContentSchema/ResultSchema with `--in/--out` and exit semantics (src/index.ts:139-166, 197-215); manifest `browserSession {profileName:'cnblogs', homeUrl:www.cnblogs.com}` (plugin.json) |
| R2 | MET | Grounded title/body/summary selectors (src/selectors.ts:53-60 ≡ cnblogs.js:22/23/25/26/30); native value fill via Playwright `fill` + strict `.value` readback (src/flow.ts:387-410, 418-441); digest fills `textarea#summary` only when requested (src/flow.ts:447-476; absence of the control refuses rather than silently dropping a requested digest — fail-closed reading of "optional", consistent with the never-silently rule) |
| R3 | MET | Absent/`draft` → exact-visible 保存草稿\|存为草稿 only; `public` → 发布博文\|发布 only; both fail closed, no primary-button fallback (src/selectors.ts:69-79, src/flow.ts:479-496); success only a FRESH id-bearing receipt (baseline captured before click, src/flow.ts:592) plus re-read persisted title/body/category state (src/flow.ts:96-130, 592-620); toasts never read; stale-state is a typed failure (tested); categories matched by label-associated checkbox exact text with checked-state verification, never created/first-matched (src/flow.ts:74-90, 520-551) |
| R4 | MET | Shared `runProfileCli` login/check/open with CNBLOGS_PROFILE_DIR tier (src/profile-check.ts:16-18; docs/04_DESIGN.md profile-tier row updated); fake mapping tests separate from real DOM (tests/cnblogs-pub.test.ts vs tests/cnblogs-pub-dom.test.ts + real-Chromium runner, import.meta.main-gated, bunfig coverage ignore mirrors csdn); packed entry/check asserted (scripts/bundle-plugins.test.ts:35-46, 322-349); ten-channel probe (plugin-check.test.ts) and registry inventory updated; zero-launch refusals verified per test (`fake.requests` length 0) |

AC1 MET (draft-with-category fixture: fresh postId edit URL + page-observed title/body/summary/checked category). AC2 MET except the finding-1 stage gap on two missing-control paths.

##### Verification evidence (fresh, this review)

- `bun test plugins/publishings/cnblogs-pub` → 44 pass / 0 fail (includes real-Chromium draft/public/missing-draft/ambiguous scenarios and the missing-browser loud-fail guard).
- `bun test scripts/bundle-plugins.test.ts apps/cli/tests/commands/plugin-check.test.ts packages/kk-core/tests/registry.test.ts` → 67 pass / 0 fail.
- Gate log .spur/run/0293-gate.log: 3183 pass / 2 skip / 0 fail, cnblogs-pub typecheck exit 0, post-check rules all passed (pre-check `verdict-artifact-asserts-confidence-level` fired INFO-level only and did not block).
- Every cnblogs.js citation in src/ checked against the evidence file: fill 20-32, register map 35-37, upload endpoint 4-19, image pass :24, article-only :21 — all accurate; the only mis-citation is docs/04_DESIGN.md:1343 (finding 2).

**Next:** Fix finding 1 (two try/catch → stageFail + two test assertions), correct finding 2's doc ranges, re-run the plugin suite; findings 3-5 are accepted advisories (5 re-checked at live acceptance).

### References

- Parent feature E97; docs/design/publish-plugin-specification.md; docs/00_ADR.md ADR-022/026/027/029/032/038.
- Existing seams: packages/kk-core/src/schemas.ts:16,36,48; packages/kk-core/src/manifest.ts:59; packages/publish-harness/src/index.ts:8; packages/publish-harness/src/browser.ts:169,325,436,553,610,737.
- WeChat callers: plugins/publishings/wechatmp-pub/src/flow.ts:245,1137; src/index.ts:254,310; src/modes.ts:144; tests/fixtures/wechatmp-dom-runner.ts.
- Source snapshot: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json; cnblogs.js:1–42; historical review docs/design/yijianfa-extension-review.md.
- Report: docs/plans/2026-10-14-publish-ready-refinement.md.
- Concurrency: one main worktree/no wip task at kickoff; concurrent 0287 and Board work preserved.
- Primary Playwright input/shadow contracts: https://playwright.dev/docs/input#upload-files and https://playwright.dev/docs/locators#locate-in-shadow-dom.

### History

- 2026-10-15T06:14:52.550Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.
- 2026-10-15T16:43:19.027Z todo → wip (system)
- 2026-10-15T17:54:52.974Z wip → testing (system)
- 2026-10-15T17:54:55.104Z testing → done (system)

