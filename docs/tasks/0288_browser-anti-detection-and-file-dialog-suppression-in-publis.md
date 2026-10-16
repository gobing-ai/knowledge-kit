---
schema_version: 1
name: Browser anti-detection and file dialog suppression in publish-harness
status: done
template: feature-impl
created_at: 2026-10-15T05:43:12.589Z
updated_at: "2026-10-15T08:20:04.356Z"
feature_id: E95

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 10
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0288-verdict.json
---

## 0288. Browser anti-detection and file dialog suppression in publish-harness

### Background

The shared browser subpath already exports persistent-profile sessions, lease handling, HTML/editor insertion, uploadFile and shadow helpers. It does not export injectBrowserAntiDetection or a queued-file click hook. This task adds opt-in page hooks only; it does not modify existing channel flows. E95 owns the requested capability; task 0287 owns content limits and segmentation independently and is not a prerequisite.

**Refine corrections (2026-10-14)**

- Creation-title background and one-line design → existing browser.ts already owns site-neutral session/upload helpers → freeze only opt-in hook additions and preserve launcher/profile/lease behavior.
- Native-like toString was said to pass integrity audits generally → an own toString property cannot make Function.prototype.toString.call native → verify only the declared direct fn.toString contract, remove the universal claim and preserve originals for unrelated calls.
- Pending files had no transfer mechanism → host file paths cannot be assigned to browser FileList → freeze a bounded queueBrowserFiles API with explicit serialized bytes and one-shot consumption.
- A generic unit suite was the only observability claim → mocked addInitScript cannot exercise page globals, XHR events or file inputs → require real Chromium synthetic-page fixtures through production helpers plus host-level unit checks.
- Source was cited as available under downloads/ → that directory and referenced platform scripts were not found in the repository, vendors, Downloads or project-tree filename search → treat the review as historical rationale only; this task's behavior is specified independently from E95 and Playwright APIs, without claiming a source port.

All four local requirements remain valid planned work. No issue is dropped. Kickoff showed one main worktree and no wip tasks; concurrent kk-core content-limit files and Board CSS/build edits are outside this task and must be preserved. Bun 1.4.3 and Playwright 1.55.0 are the repository pins; use the current bun-global Spur CLI, not the older PATH copy.

Source recovery during the same refine: Google's extension update service supplied exactly v0.1.55, archive SHA-256 8fec7ebac1a2d2ae4206cabd748712664b29eeebcfe5315970e14f0a639ba425. The reviewed MAIN-world scripts are now persisted under .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/. They confirm wrapper-local toString and a pending file queue, while KK deliberately restricts matching to explicit origins/path and bounds the queue. The earlier missing-path observation remains historical; no unresolved source question remains for this task.

### Requirements

- [x] R1. Export injectBrowserAntiDetection(page, options?) and its AntiDetectionOptions type through @gobing-ai/publish-harness/browser; defaults are inert, site-neutral, bounded and idempotent with unchanged existing launcher/lease/session behavior.
- [x] R2. For explicitly allowed origins only, intercept the exact /shield/webprofile path in fetch, XMLHttpRequest and sendBeacon when shieldProfile is enabled, returning the declared synthetic receipt and direct native-like wrapper toString; delegate all unrelated calls without changing their arguments or return/error semantics.
- [x] R3. Export queueBrowserFiles(page, files) for bounded one-shot pending browser File data; suppress input[type=file].click only when the enabled hook has a valid queued batch for that document/origin, assign files and dispatch input/change, otherwise preserve normal click behavior.
- [x] R4. Verify production helper installation and behavior through deterministic host tests and real Chromium synthetic-page fixtures in packages/publish-harness/tests/browser-anti-detection.test.ts with existing per-file coverage policy and no paid/platform calls.

### Acceptance Criteria

- [x] AC1 — R1 - MAIN-world anti-detection intercepts risk-control endpoints (req: R1, R2)
- [x] AC2 — R2 - File dialog suppression populates files without native modal (req: R3)
- [x] AC3 — Production browser hooks preserve unrelated behavior and stay opt-in (req: R1, R2, R3, R4)

```gherkin
Feature: Browser anti-detection and file dialog suppression in publish-harness

  Scenario: AC1 — R1 - MAIN-world anti-detection intercepts risk-control endpoints (req: R1, R2)
    Given an explicitly allow-listed synthetic browser origin initialized with the enabled production helper
    When its page uses fetch, XMLHttpRequest or sendBeacon for the exact shield path
    Then the fixture server observes no matching request and the declared synthetic receipt and lifecycle are observed
    And direct wrapper.toString returns the declared native-like string without claiming canonical native identity

  Scenario: AC2 — R2 - File dialog suppression populates files without native modal (req: R3)
    Given the enabled production chooser hook and a bounded valid file queue in the current allowed document
    When an existing or dynamically created file input is clicked
    Then its FileList matches the batch and input and change fire once without the original click
    And the batch is consumed once and absent or invalid queues preserve normal behavior or report validation failure

  Scenario: AC3 — Production browser hooks preserve unrelated behavior and stay opt-in (req: R1, R2, R3, R4)
    Given real Chromium local-page fixtures and the existing browser helper regressions
    When disabled flags, unrelated origins and paths, duplicate installation, malformed queues and navigation are exercised
    Then normal browser calls and existing launch and profile ownership behavior remain unchanged
    And production page-global behavior is exercised without mocking the injector or skipping missing browser prerequisites
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T06:06:18.798Z

Closed 2026-10-14: opt-in only, no channel rollout; site policy remains caller-owned (ADR-027). Existing uploadFile/shadow helpers are reused by consumers. Direct native-like toString is the complete testable contract; canonical native-function identity is not promised. The original extension source is unavailable, so no implementation fact depends on its unverified code. Owner 0288 freezes the bounded host-to-page file bridge and synthetic fixture tests. Content-limit work is owned by 0287; independent platform plugins are separate tasks.

#### Q&A entry — 2026-10-15T06:14:40.933Z

Source recovery closed: the exact v0.1.55 package was recovered read-only, version/digest recorded in source-manifest.json. Its scripts confirm the reference mechanism; no extension installation, native bridge or broad platform integrity guarantee is needed.

### Design

WHAT/WHY: add opt-in page hooks to the existing browser subpath. Existing uploadFile(page, selector, filePath, opts) remains the direct file-upload mechanism; this task supplies the requested interception capability for dynamic site-owned clicks without installing it on any current channel. No new package, browser transport, extension bridge, dependency, CLI flag or default launcher hook.

Frozen API: injectBrowserAntiDetection(page: Page, options?: AntiDetectionOptions): Promise<void>. AntiDetectionOptions is {allowedOrigins?: readonly string[], shieldProfile?: boolean, suppressFileChooser?: boolean}; omitted origin list or both flags false installs no hooks. Enabled flags require nonempty canonical http(s) origins, no credentials/path/query/hash. Apply immediately to the current allowed document with page.evaluate and register the same self-contained script using page.addInitScript before subsequent navigation. Use existing JSON-encoded script construction because the harness tsconfig has no DOM library. Idempotent per-document installation stores originals privately; repeated identical installation must not stack wrappers. Reject conflicting reconfiguration after installation rather than silently change an active page. Restrict frame execution to exact allowed origins; no global launcher opt-in and no origins embedded in the harness.

Frozen file API: BrowserPendingFile={name:string,mimeType:string,base64:string}; queueBrowserFiles(page: Page, files: readonly BrowserPendingFile[]): Promise<void>. Host validation rejects malformed base64/name/MIME and batches above 20 files/8 MiB decoded bytes before evaluating anything. Queue requires a matching current origin and installed chooser hook; replace an unused queue explicitly, never append silently. Decode into File objects in the current document. Queues are not embedded in init scripts, persisted or restored after navigation. Consume once only after successful FileList assignment; assignment failure preserves the queue and throws without swallowing the real error. A hooked createElement must preserve this, all arguments and other element types; attach to file inputs created after injection, with an input.prototype.click guard for existing inputs. Call original click when no queue, wrong type, wrong origin or disabled. The synthetic path dispatches bubbling input then change and does not invoke the original click. Enforce the input multiple constraint before consumption. This is bounded small-file support; direct Playwright setInputFiles handles larger attachments outside this hook.

Shield protocol: resolve fetch string/URL/Request and XHR.open relative to document.baseURI; exact origin plus pathname match, with query allowed. Preserve native receiver/arguments/abort behavior for pass-through calls. Enabled matching fetch returns a real Response with status 200, JSON content type and {code:0,success:true,msg:'ok',data:{st:<current milliseconds>}}. Matching sendBeacon returns true without network dispatch. Matching XHR is asynchronous: expose readyState=4/status=200/responseText and JSON response for responseType=json, dispatch readystatechange/load/loadend once; honor abort without a later load. Unsupported synchronous matching XHR is refused explicitly rather than fabricate incompatible events. Direct wrapper.toString() returns 'function () { [native code] }' through a wrapper-local own method; do not modify Function.prototype.toString or promise bypass of browser/platform integrity checks. These are declared synthetic receipts, never evidence of platform submission or account readiness.

WHERE/ownership: packages/publish-harness/src/browser-anti-detection.ts holds substantive implementation; browser.ts re-exports only; package.json already exports ./browser and needs no new subpath. Tests: packages/publish-harness/tests/browser-anti-detection.test.ts and tests/fixtures/browser-anti-detection-runner.ts; fixture runner uses the installed Playwright and throws on missing Chromium instead of skipping. No channel source changes and no dependency on 0287. Future consumers own site policy and opt-in in their own tasks; 0291–0297 can use existing uploadFile and require no dependency on this helper.

Verification: run synthetic local HTTP page fixtures with the real production injector, server request counters for matching/nonmatching paths/origins and Request objects, pass-through fetch/XHR/beacon and abort/error cases, wrapper direct versus canonical toString limits, existing/dynamic file inputs, multiple constraint, queue empty/reuse/navigation/oversize/failure and exact event counts. A mocked PublishTransport or addInitScript is insufficient. Existing browser launcher/profile tests must remain green; no profile credentials or real platform endpoints are involved. Fixture origin is explicitly allow-listed. Implementation step 0 checks Chromium availability and pinned Playwright; missing prerequisites are repaired before validation, never hidden by skips.

Budget: 10h, P2; preserve partial evidence at the boundary. requireDiff: shared helper, its export, behavior tests and same-change surface docs. No new runtime, native integrity guarantee, native messaging bridge, cookie export, CAPTCHA automation, channel rollout or generic interception framework.

### Plan

- [x] Step 0 (R1–R4): re-read E95 and cited browser helpers/ADR-027/038; verify Bun/Playwright/Chromium and current worktrees/task ownership; preserve concurrent unrelated work.
- [x] (R1,R2) Implement validated inert-by-default options, idempotent current/new-document installation and exact origin/path interception in browser-anti-detection.ts; export only the frozen helper/types from browser.ts.
- [x] (R3) Implement bounded serialized-file queue, one-shot consumption and input click delegation with normal behavior preserved for all ineligible paths.
- [x] (R2–R4) Execute production scripts in the named Chromium fixture runner; assert server counters, native Response/XHR lifecycle, direct toString limit, FileList/events, queue constraints/navigation and no wrapper stacking.
- [x] (R1–R4) Extend host tests for option/serialization limits and unchanged exports; run existing browser/profile/lease tests and update docs/04_DESIGN.md for the shipped opt-in surface in the same change.
- [x] Run project lint, test, build and rule gates; obtain task-pipeline review/verify PASS before done. No live publishing or modification of unrelated channels is part of this task.

### Solution

- New `packages/publish-harness/src/browser-anti-detection.ts:1`: `injectBrowserAntiDetection(page, options?)` + `AntiDetectionOptions` and `queueBrowserFiles(page, files)` + `BrowserPendingFile`, re-exported through `src/browser.ts` (`@gobing-ai/publish-harness/browser`).
- R1/R2: `injectBrowserAntiDetection` (`packages/publish-harness/src/browser-anti-detection.ts:184`): MAIN-world init script installs per-document under `window.__kkAntiDetection`; defaults inert; enabled flags require canonical nonempty http(s) `allowedOrigins`. With `shieldProfile`, only the exact `/shield/webprofile` path (query allowed) is intercepted across `fetch` (Request/URL/string resolved against `document.baseURI`), `XMLHttpRequest` (async lifecycle incl. abort; sync matching refused) and `navigator.sendBeacon` (returns true), answering the synthetic `{code:0,success:true,msg:'ok',data:{st}}` receipt with native-like `toString`; unrelated calls keep receiver/arguments/error semantics. Same-config reinstall is a signature-matched no-op (no wrapper stacking); conflicting options throw.
- R3: `queueBrowserFiles` (`packages/publish-harness/src/browser-anti-detection.ts:263`) host-validates batches (nonempty, ≤20 files, ≤8 MiB decoded, strict base64 round-trip, `type/subtype` MIME) before any `evaluate`; with `suppressFileChooser` the installer wraps `HTMLInputElement.prototype.click` native-like — only `input[type=file]` with a valid one-shot queued batch on an allowed-origin document is suppressed (DataTransfer assignment, `multiple` constraint enforced, bubbling `input` then `change`, queue consumed only after success); all ineligible clicks fall through natively.
- R4: `packages/publish-harness/tests/browser-anti-detection.test.ts:318` + `packages/publish-harness/tests/fixtures/browser-anti-detection-runner.ts:1` drive the production injector on real Chromium synthetic pages (21 tests): server-side counters, Response/XHR lifecycle, toString limit, FileList/event proof incl. filechooser suppression, queue bounds/one-shot/navigation reset, no wrapper stacking.
- Host tests `tests/browser-anti-detection.test.ts` (21 pass) cover option/serialization limits and unchanged exports; regression: browser/profile-lease/profile-dir suites 72 pass.
- docs/04_DESIGN.md: shipped opt-in surface rows added under `@gobing-ai/publish-harness/browser` in the same change.
- Focused checks: `bun run lint` clean (Biome + workspace typechecks), publish-harness `tsc --noEmit` exit 0. Full gate runs at the pipeline test stage.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/publish-harness/src/browser-anti-detection.ts:184` helper; `:24` inert defaults; `:96` idempotent signature; `packages/publish-harness/src/browser.ts:44` re-export |
| R2 | MET | `packages/publish-harness/src/browser-anti-detection.ts:87` exact origin+path; `:93` receipt; `:99`/`:107`/`:116` fetch/sendBeacon/XHR; `:76` native-like toString |
| R3 | MET | `packages/publish-harness/src/browser-anti-detection.ts:263` host validation; `:142` multiple-constraint + one-shot; bubbling input→change; chooserEvents=0 in tests |
| R4 | MET | `packages/publish-harness/tests/browser-anti-detection.test.ts:318` 21 pass incl. real-Chromium; `packages/publish-harness/tests/fixtures/browser-anti-detection-runner.ts:1` runner |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 - MAIN-world anti-detection intercepts risk-control endpoints | MET | test | `packages/publish-harness/tests/browser-anti-detection.test.ts:347` server counters + receipt/lifecycle/toString (task AC1 aliases feature scenario 1) |
| R2 - File dialog suppression populates files without native modal | MET | test | `packages/publish-harness/tests/browser-anti-detection.test.ts:528` FileList bytes, events once, chooserEvents=0 (task AC2 aliases feature scenario 2) |
| AC3 — Production browser hooks preserve unrelated behavior and stay opt-in (req: R1, R2, R3, R4) | MET | test | `packages/publish-harness/tests/browser-anti-detection.test.ts:364` opt-in/passthrough/no-stacking + 72 regression pass |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature E95; ADR-027/038 in docs/00_ADR.md; shared browser plumbing packages/publish-harness/src/browser.ts:169,553,610,701.
- Existing browser transport contract: packages/publish-harness/src/index.ts:8; package export: packages/publish-harness/package.json.
- Historical rationale: docs/design/yijianfa-extension-review.md. Exact v0.1.55 source recovered after the initial missing-path audit; durable MAIN-world scripts/hashes: .spur/memory/evidence/publish-ready-0288-0297-20261014-01/source-manifest.json. No vendor runtime import or claim of universal integrity-audit bypass.
- Primary API contracts checked 2026-10-14: https://playwright.dev/docs/api/class-page#page-add-init-script and https://playwright.dev/docs/input#upload-files.
- Batch report: docs/plans/2026-10-14-publish-ready-refinement.md; evidence .spur/memory/evidence/publish-ready-0288-0297-20261014-01.
- Concurrency: one main worktree, no wip task at kickoff; concurrent 0287 kk-core and Board edits preserved.

### History

- 2026-10-15T06:06:19.994Z backlog → todo (system)
- 2026-10-14 ready-depth inline refinement: validated seven-part checklist; see batch report for corrections and source evidence.
- 2026-10-15T08:19:15.070Z todo → wip (system)
- 2026-10-15T08:19:15.463Z wip → testing (system)
- 2026-10-15T08:20:04.350Z testing → done (system)

