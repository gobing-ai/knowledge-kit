---
schema_version: 1
name: Publish ordered XHS card images as a real draft or explicit live post
status: done
template: feature-impl
created_at: 2026-09-25T18:16:35.413Z
updated_at: "2026-09-26T16:08:24.953Z"
feature_id: E8
priority: P2
estimate_hours: 12

---

## 0167. Publish ordered XHS card images as a real draft or explicit live post

### Background

Feature E8 scenarios R4, R5, R6. `xhs-pub` currently returns a synthetic unpublished draft from `sessionReady` and never uploads images (`plugins/publishings/xhs-pub/src/index.ts`). This task makes the existing browser transport execute and report what the browser actually confirms. It is independently testable with a handcrafted Content fixture before the card authoring skill exists.

Rubric: parent E2 D2 L2 C1 R2 = 9 → decompose (live external side effect and two review surfaces); this publisher slice E2 D1 L1 C1 R1 = 6, cohesive in one plugin.

### Requirements

- [x] R1. (supports R4–R6) `xhs-pub` default driver becomes `script`. `driver: 'agent'` returns `ok: false` naming the unsupported driver. Delete `sessionReady` and the synthetic `draftId`/`draftResult`.
- [x] R2. Preserve `Content → Result`, `--in`/`--out`, `options.profileDir` / `XHS_PROFILE_DIR` / `KK_BROWSER_PROFILE_DIR` profile resolution, `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`, and draft-by-default (ADR-008, ADR-022, ADR-024).

### Acceptance Criteria

- [x] AC1 — XHS publisher creates a draft with the ordered images (req: R4)
- [x] AC2 — Explicit live request publishes the XHS post (req: R5)
- [x] AC3 — Missing or failed images prevent a false publish result (req: R6)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T18:30:32.886Z

- **Driver: `script`, not `agent` (closed 2026-09-25).** E7 (design D4) made `agent` the default for CMS editors. For XHS image posts, `agent` has no evidence channel: the plugin cannot observe what an agent did in the page, so the only `ok: true` it could produce is the synthetic `sessionReady` result that E8 exists to remove. Attaching ordered files is deterministic with Playwright's `setInputFiles`. This overrides E7 D4 for `xhs` only and is recorded in ADR-024. Other CMS plugins are unchanged.
- **Playwright dependency: no `package.json` change (closed).** `launchPersistentBrowser` dynamically imports `playwright`. In the workspace, it resolves through `publish-harness`'s devDependency (`playwright@1.55.0`). `scripts/bundle-plugins.ts` keeps `playwright` external. An installed kk therefore needs `playwright` plus Chromium (`bunx playwright install chromium`). A missing package or browser becomes `Result.ok: false` with that hint (R6). Adding it as a hard dependency of the shipped package is deferred until a second script-driver plugin exists.
- **Headed launch (closed).** Use `headless: false`, the harness default, so the operator can finish a first login in the window within `loginTimeoutMs` (default 120 s).
- **Order evidence (closed).** Pixel-level order checks are infeasible. Order is guaranteed by passing the paths in one ordered `setInputFiles` call, which offline tests assert on the fake page. Count is guaranteed by the observed thumbnail count. The feature AC R4 is worded to match.
- **No platform draft ID (closed).** XHS web drafts may live in the browser profile's draft box, not on the server (LOW confidence; confirm during implementation). The draft `Result` omits `id`/`url` unless the page exposes one, and `message` names the profile dir.
- **Platform limits (deferred to implementation).** Upload URL, selectors, max image count, and title/body length are read from the live UI during implementation and recorded in the design doc. They are not frozen here, per `docs/design/xhs-image-cards.md` § Checks and limits.

### Design

Approach: replace `XhsBrowserTransport`'s `sessionReady` stub with a script driver in `plugins/publishings/xhs-pub/src/index.ts`. Keep the change in one file unless it grows past readability.

- **Seam.** The transport takes an injectable `openPage(profileDir) => Promise<{ page: XhsPage; close(): Promise<void> }>`. `XhsPage` is a structural subset of the Playwright `Page` that the flow uses, in the same style as the harness's `SelectorPage`. The default `openPage` calls `launchPersistentBrowser({ profileDir, headless: false })` and uses `context.pages()[0] ?? context.newPage()`. Tests inject a fake page that records calls and scripts UI states. Reuse the harness `trySelectors` for selector fallbacks.
- **Pre-browser validation** (pure function, fails before `openPage`): `images` shape/abs path/existence/extension, and `publishStatus ∈ {undefined, 'draft', 'public'}`, where `undefined` means `draft`.
- **Flow:** open the creator publish page → if a login page is shown, wait up to `loginTimeoutMs` for the editor, else fail with `login timeout` → select the image-post tab → `setInputFiles(paths)` in one call → wait for N thumbnails → fill title and body → `draft`: click save-draft and wait for its confirmation; `public`: click publish and wait for its success state → build `Result` from observed values only. Close the browser context in `finally`.
- **Result:** `{ ok, target: 'xhs', url?, id?, message, metadata: { driver: 'script', publishStatus, profileDir, imageCount } }`.

Rejected: a new publish plugin; `agent` driver for image posts (no evidence channel — Q&A); a `Result` built from a login flag; adding `playwright` to the shipped dependency tree.

Invariant: no browser opens for invalid input; no live side effect without `publishStatus: 'public'`; no `ok: true` without an observed confirmation. Design detail: `docs/design/xhs-image-cards.md`.

### Plan

1. Pre-browser validation plus tests: missing file, relative path, bad extension, empty `images`, and unknown `publishStatus` each return `ok: false` with `openPage` never called.
2. Script flow behind the `openPage` seam, with fake-page tests: paths reach `setInputFiles` in payload order in one call; draft confirmed → `ok: true, publishStatus: 'draft'`, no `id`; public confirmed → `ok: true` with the observed `url`; login timeout, thumbnail mismatch, missing draft confirmation, and ambiguous public submit → `ok: false` naming the step (the public case includes the duplicate-risk warning); missing playwright → `ok: false` with the install hint. The browser closes on every path.
3. Default driver (R4–R6 support) `script`; `agent` → `ok: false`; remove `sessionReady`, `draftId`, and `draftResult`, and rewrite the tests that used them. Keep the fake env-var path.
4. Read the live UI (upload URL, selectors, limits, draft-box semantics) and record the facts in `docs/design/xhs-image-cards.md` § Checks and limits.
5. Doc sync in the same commit (T3): `docs/04_DESIGN.md` leftover-CMS paragraph (xhs default `script`, `publishStatus`); `plugins/kk/skills/publish/SKILL.md` channel row `xhs | xhs-pub | browser / script | kk executor run xhs-pub`, removing xhs from the agent-default rows.
6. `bun run gate`. Manual dogfood (operator-owned): one authenticated draft with two images from a fixture Content, with the evidence (Result JSON + screenshot) recorded in Testing, or stated as untested.

### Solution

Rewrote the XHS publisher as a script-driver Playwright transport with a structural page seam.

| Change (`file:line`) |
|----------------------|
| `plugins/publishings/xhs-pub/src/index.ts:40` — `XhsPage`/`XhsLocator` structural seam (set-level `count()` + `first()`), `wrapPlaywrightPage` adapter at `:110`, `defaultOpenPage` launchPersistentContext at `:135` |
| `plugins/publishings/xhs-pub/src/index.ts:73` — `validatePublishInput` pure pre-browser validation (absolute/existing/png\|jpg\|jpeg\|webp paths, publishStatus) |
| `plugins/publishings/xhs-pub/src/index.ts:180` — `XhsBrowserTransport` script flow: one ordered `setInputFiles` (`:243`), set-level N-thumbnail wait (`:246-255`), title/body fill, draft/public confirmation gates (`:273-302`), `act()` step-named failure wrapper, `close()` in `finally` |
| `plugins/publishings/xhs-pub/src/index.ts:305` — `getPublishTransport` default driver `'script'`; agent driver fails fast (`:200`); fake env preserved |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:34` — 21-test suite: validation matrix failing before `openPage` (spy), fake-page flow (ordered upload, thumbnail mismatch, login timeout, missing confirmations, duplicate-risk wording), CLI surface, adapter delegation |
| `docs/04_DESIGN.md:496` + `plugins/kk/skills/publish/SKILL.md:31` — T3 same-commit doc sync (script default, setInputFiles, live-UI selectors explicitly untested pending dogfood) |

Review loop: initial BLOCK (P0 set-count semantics, P1 unnamed failures + discarded selectors, P1 doc sync) fixed in `7c7d51c`; delta re-review OK; P2 hardening (single-query `findSelector` loop, plugin description) followed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R4 — XHS publisher creates a draft with the ordered images | MET | Offline MET: src/index.ts:580 single ordered setInputFiles(fileSelector, paths); :582-593 set-level wait + exact-N thumbnail check; :620-650 draft-confirm gate -> ok:true Result with no id (:637-649); tests tests/xhs-pub.test.ts:392-419 assert captured.calls === 1 and uploaded === [img0,img1,img2], :278-301 asserts ok:true, no id, imageCount 2. UNVERIFIED for a real session: bun test plugins/publishings/xhs-pub/tests -> 43 pass / 0 fail, all through the injected fake page; SELECTORS (src/index.ts:27-38) are constants never exercised against live creator UI (docs/04_DESIGN.md:500). LIVE VERIFIED 2026-09-25 with the fixed driver (task 0174): the driver created a real draft for the 4 ordered cards and the console confirmed it — .spur/run/xhs-live-preflight/result.draft8.json (ok:true, driver script, publishStatus draft, imageCount 4, draftControl 暂存离开, draftAttempts 1, draftCountBefore 18 -> draftCountAfter 19). Earlier live attempt failed at the editor gate; root cause and fix in task 0174. |
| R5 — Explicit live request publishes the XHS post | MET | LIVE VERIFIED 2026-09-26 (operator-approved live post, then removed): `bun apps/cli/src/index.ts executor run xhs-pub --in content.public.json` → ok:true, message "xhs post published", url https://creator.xiaohongshu.com/publish/success…, imageCount 4, publishControl 发布 (.spur/run/xhs-live-preflight/result.public3.json). The post was then observed in the note manager as 审核中微服务拆分三原则 and deleted through the manager (verified absent: published notes matching the title = 0). Draft stays the default; `public` is required to reach the submit path (src/index.ts:526, :654-684); tests tests/xhs-pub.test.ts:421-435. |
| R6 — Missing or failed images prevent a false publish result | MET | Pre-browser validation src/index.ts:122-152 (non-empty, absolute, exists, png/jpg/jpeg/webp) returns ok:false before openPage — test :267-275 asserts closed length 0 with spy; thumbnail mismatch -> ok:false naming step :582-593, test :449-464 (expected 2); missing draft confirmation -> ok:false :632-636, test :466-482; ambiguous public submit -> ok:false + duplicate-post warning :667-671, test :501-517; no ok:true path without an observed confirmation; sessionReady/draftId/draftResult removed. |
| Req 0167-1 — default driver script; agent fails ok:false naming the driver; sessionReady + synthetic draft removed | MET | src/index.ts:513-517 (driver !== 'script', early unsupported driver ... requires the script driver); getPublishTransport default 'script' :695-700; tests :223-227, :229-235. |
| Req 0167-2 — preserve Content->Result, --in/--out, profile resolution, fake env, draft-by-default | MET | processPublishIO :708-730 (ContentSchema parse, --out written, non-zero on ok:false); profile override chain :518-522; KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake :696; tests :745-824 (CLI + runInvoke) pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — XHS publisher creates a draft with the ordered images (R4) | MET | command | bun test plugins/publishings/xhs-pub/tests -> 43 pass/0 fail: tests/xhs-pub.test.ts:278-301 (draft ok, no id, imageCount 2), :392-419 (one ordered setInputFiles call) — confirmed by the live draft run result.draft8.json (ok:true, 18 -> 19) |
| AC2 — Explicit live request publishes the XHS post (R5) | MET | command | result.public3.json (ok:true, console success page, post observed then deleted); tests/xhs-pub.test.ts:421-435 |
| AC3 — Missing or failed images prevent a false publish result (R6) | MET | test | tests/xhs-pub.test.ts:222-275 (validation matrix, openPage never called), :449-517 (thumbnail/draft-confirm/submit failures all ok:false) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: `docs/features/E8_xiaohongshu-image-card-authoring-and-publishing.md` (R4–R6)
- Design: `docs/design/xhs-image-cards.md`; ADR-024, ADR-022, ADR-008 (+ 2026-09-17 amendment)
- Code: `plugins/publishings/xhs-pub/src/index.ts`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`, `packages/publish-harness/src/index.ts` (`launchPersistentBrowser`, `trySelectors`, `resolveBrowserProfileDir`), `scripts/bundle-plugins.ts` (`external: ['playwright']`)
- Prior driver decision being overridden for xhs: `docs/design/remaining-wt-publish-harvest.md` D3/D4
- Consumer: task 0168 (`kk:xhs-images` writes the Content this plugin reads)

### History

- 2026-09-25T22:53:37.447Z todo → wip (system)
- 2026-09-25T23:20:39.834Z wip → done (system)

