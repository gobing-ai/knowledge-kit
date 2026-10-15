---
schema_version: 1
name: Implement jike-pub publish plugin for Jike dynamic posts and topic tagging
status: done
template: feature-impl
created_at: 2026-10-15T05:55:12.989Z
updated_at: "2026-10-15T14:31:02.862Z"
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
| R1 | MET | plugin.json:1-12 (kind publish, entry ./src/index.ts, check ./src/profile-check.ts, browserSession profileName jike, homeUrl web.okjike.com); `kk plugin status --json` healthy:true; registry.test.ts:228,599; op/driver dispatch index.ts:152,172,757-772 |
| R2 | MET | Live-only gate index.ts:293-300 (publishStatus must be exactly 'public', refuse pre-browser per ADR-022); composer fill + text readback index.ts:347-348,463-482; exact-chip-or-refuse topic commit index.ts:486-522 (no first-item fallback, jike.js:219-225); fresh-signal-only confirmation index.ts:447-461 (success toast or new /originalPost/ |
| R3 | MET | Cap-9 refuse-not-slice index.ts:223-226 (jike.js:246/329-331); caller-order uploads via harness setInputFiles index.ts:530-538; 正在上传 wait + preview predicate index.ts:585-609 (jike.js:277-291); absent file input = typed refusal, never text-only submit |
| R4 | MET | profile-check.ts:20 runProfileCli (ADR-032 operator login); fake-transport seam index.ts:719-721; subprocess real-Chromium fixture fixtures/jike-composer-runner.ts (abort-all traffic, loud missing-browser hint); 7 typed stages tested; jike suite 39 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R1 - jike-pub publishes dynamic post with topic tags (req: R1, R2, R3, R4) | MET | test | Full flow verified: fake-transport mapping tests + real-Chromium production-flow leg passed (ok:true with url/id, 2 launches, synthetic composer on real origin, all other traffic aborted); live-only gate + exact topic chip + image flow per R2/R3 evidence — `bun test plugins/publishings/jike-pub/tests/jike-pub.test.ts` 39 pass / 0 fail (exit 0); operator-run live acceptance is the task's separate delivery check by design |
| AC2 — Payload, readiness, failure and installed behavior remain observable (req: R1, R2, R3, R4) | MET | test | Zero-launch refusal tests (launcher.requests empty for publishStatus/body/topic/image violations); stale/malformed receipt tests; CHECK_DECLARING_PLUGINS + jike-pub staged check→dist assertions (`bun test scripts/bundle-plugins.test.ts` 24 pass / 0 fail); eight-channel probe registry (`bun test apps/cli/tests/commands/plugin-check.test.ts` 12 pass / 0 fail); full gate exit 0 (.spur/run/0291-gate2.log, 3082 pass / 0 fail / 2 skip) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0291
**Scope:** git diff 0f234f2d → worktree (plugins/publishings/jike-pub/**, apps/cli/tests/commands/plugin-check.test.ts, packages/kk-core/tests/registry.test.ts, bunfig.toml, bun.lock) vs ground truth .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/jike.js:46-99,204-291,300-385
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** FAIL
##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | functional | AC2's "packed entry and check resolution" clause is uncovered for this plugin: `jike-pub` is absent from `CHECK_DECLARING_PLUGINS`, so the staged check→`dist` rewrite assertion, the manifest-unchanged guard (`check === './src/profile-check.ts'`) and the outside-checkout probe never run for it; the plugin's own suite has no packed entry/check assertion either, though the Design assigns it there ("Installed entry/check assertion belongs in this plugin's test suite"). `apps/cli/tests/package.test.ts` covers bundling generically (dynamic readdir), but the check-entry acceptance is the listed seven only. Fix mirrors the weibo 0245 precedent: add `'jike-pub'` (or assert the packed check in `tests/jike-pub.test.ts`). | `scripts/bundle-plugins.test.ts:35-43` (list), `:319-360` (assertions) | OPEN |
| 2 | P2 (major) | functional | Same-change `docs/04_DESIGN.md` shipped-surface section is missing — plan step 5 and the Design make it part of the required diff ("requireDiff is implementation plus behavior tests and surface docs"), and every peer publish plugin carries one (e.g. `### @gobing-ai/wechatmp-pub`). `grep -c jike docs/04_DESIGN.md` = 0; the diff touches only the task doc, tests, bunfig and bun.lock. | `docs/04_DESIGN.md` (no jike-pub section; peers at docs/04_DESIGN.md:1243) | OPEN |
| 3 | P3 (minor) | correctness | Send selector is page-wide `button:has-text("发送")` + `.first()`, while the Design pins "send button text 发送 inside the same form"; on the live feed the first DOM 发送 match need not be the composer's (the source's page-wide scan, jike.js:368-370, is the grounding, but the design text chose the tighter scope). Scoping to `COMPOSER_FORM_SCOPE` closes it. | `plugins/publishings/jike-pub/src/index.ts:80` | OPEN |
| 4 | P3 (minor) | usability | Stale suite title: the `describe` block still says "seven browser channels declare probes (0216, AC1)" while its test now asserts eight; only the inner `it()` was renamed. | `apps/cli/tests/commands/plugin-check.test.ts:177` vs `:190` | OPEN |
| 5 | P4 (advisory) | correctness | The committed topic chip is verified only at commit time (exact text match, then click, `src/index.ts:485-520`); there is no pre-send re-read, so a chip the UI drops during the later image-upload step would ship without the topic while the body-text confirmation still matches. The refine's exact-match-or-refuse rule (the stated AC) is fully implemented; a persistence re-read would deepen it. | `plugins/publishings/jike-pub/src/index.ts:485-520` | ACCEPTED |
| 6 | P4 (advisory) | usability | Stale chunk-planning header ("Chunk B adds topic chips and image uploads at the named seams; Chunk C owns the tests") describes this change's own work as future work. | `plugins/publishings/jike-pub/src/index.ts:8-9` | ACCEPTED |

**Scope-statement correction (not a code defect):** the run description claimed `.spur/rules/strict/http-boundaries.yaml` gained jike fetch-exemption entries; the yaml hunks inside the 0f234f2d range are the wechatmp CGI entries from 0289/0290 (commits d46b2ca6, d1ff02b3). `grep -rn "fetch(\|XMLHttpRequest" plugins/publishings/jike-pub/` finds nothing, so jike-pub correctly needs no exemption — the description, not the code, was off.
##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | plugin.json entry/check/profileName (`plugins/publishings/jike-pub/plugin.json:4-9`, profileName `jike` per design); discovery `packages/kk-core/tests/registry.test.ts:225,596`; pre-browser operation/driver dispatch `plugins/publishings/jike-pub/src/index.ts:145-199`; `--in/--out` CLI `src/index.ts:733-784`; profile CLI on shared `runProfileCli` `src/profile-check.ts:19-21` |
| R2 | MET | fill + readback `src/index.ts:318-324,424-443`; exact-chip-or-refuse is the strict-only port of jike.js:219-225 (first-item/structural fallbacks deliberately absent) `src/index.ts:485-520,633-648`; live-only refusal (ADR-022) `src/index.ts:236-248`; confirmation only from fresh strong signals `src/index.ts:414-470` (weak editor-cleared/composer-closed signals from jike.js:81-85 not ported) |
| R3 | MET | cap-9 refusal not slice `src/index.ts:161-224`; caller-order upload `src/index.ts:520-539` with settle (正在上传, jike.js:277-286) + preview landing predicate (jike.js:46-52,287-291) `src/index.ts:540-556`; absent file input or unconfirmed preview refuses before submit — no text-only fallback `src/index.ts:527-556` |
| R4 | PARTIAL | readiness CLI `src/profile-check.ts:19-21` + shared predicate `src/index.ts:144-151`; fake/mapping layer separated from page behavior (39 offline tests, zero-launch refusal assertions, `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` `src/index.ts:683-688`); real-Chromium synthetic-origin fixture with abort-all routing `tests/fixtures/jike-composer-runner.ts:60-70` and loud missing-browser failure `tests/fixtures/jike-composer-runner.ts:24-31`; fresh run 39 pass / 0 fail — but the packed entry/check clause of AC2 is unmet (finding 1) |

AC1 MET (observable contract; live acceptance is operator-owned, out of scope). AC2 PARTIAL (finding 1).

**Selector grounding (ground truth jike.js, verified line-by-line):** composer `form div[contenteditable="true"]` (:307), form media scope (:335 `editor.closest("form")`), topic input (:207), strict exact-match in `div[name="topic"] div[tabindex="0"]` (:219-225), failure/success toast regexes (:65-66), toast containers (:61-63), post-link shapes (:46-48), media-evidence predicate (:46-52), upload settle (:277-286), 5s/250ms preview wait (:288-291), cap 9 (:246,329-331), send text 发送 + disabled wait (:368-373), no-title-field refusal text (:312-315). All `file:line` claims in the source comments check out.

**SECUA:** no secrets/tokens/DOM dumps in Results — bounded 300-char single-line errors with the recovery command leading (`src/index.ts:76-84`); page scripts inject values only via `JSON.stringify` (no injection); preflight `headedFallback: false` (ADR-025) with the CLI's `checkHeadedOnly` not forwarded (`src/index.ts:169-179`); stale-signal baselines (toasts + post links) before submit; contexts closed by the shared `withProfilePage`/`checkChannelSession` seams used by all eight channels. Architecture follows the weibo-pub structural precedent nearly 1:1 (identical package.json shape, `processPublishIO` fail/write/throw contract), typed stages (`composer` → `text-readback` → `topic-commit` → `image-upload` → `send-enabled` → `confirmation`/`failure-toast`), fake seam before any browser.

**Fresh verification evidence:** `bun test plugins/publishings/jike-pub/tests/` → 39 pass / 0 fail, 170 expect calls, 10.68s, jike-pub src 100%/100% lines/branches in the scoped run; `bun run typecheck` (plugin dir) exit 0; `bunx biome check plugins/publishings/jike-pub apps/cli/tests/commands/plugin-check.test.ts packages/kk-core/tests/registry.test.ts` clean.

**Assumptions/gaps a reader should re-check:** (1) live web.okjike.com DOM is unchanged since the 2026-10-14 evidence — all selectors beyond jike.js are marked provisional in-code, and the composer-reachable-from-home assumption is explicit (`src/index.ts:47-56`); (2) findings 1-2 are diff-level completions (a 7→8 list entry + one doc section), no code-behavior risk found in the plugin itself.

**Next:** close findings 1-2 (add `jike-pub` to `CHECK_DECLARING_PLUGINS` or the in-suite packed assertion; add the `docs/04_DESIGN.md` shipped-surface section), then re-run review → expect PASS; findings 3-4 are one-line same-cycle fixes.

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

