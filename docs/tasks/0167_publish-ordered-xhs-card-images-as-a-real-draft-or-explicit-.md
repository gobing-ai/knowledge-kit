---
schema_version: 1
name: Publish ordered XHS card images as a real draft or explicit live post
status: todo
template: feature-impl
created_at: 2026-09-25T18:16:35.413Z
updated_at: "2026-09-25T18:30:34.008Z"
feature_id: E8
priority: P2
estimate_hours: 12

---

## 0167. Publish ordered XHS card images as a real draft or explicit live post

### Background

Feature E8 scenarios R4, R5, R6. `xhs-pub` currently returns a synthetic unpublished draft from `sessionReady` and never uploads images (`plugins/publishings/xhs-pub/src/index.ts`). This task makes the existing browser transport execute and report what the browser actually confirms. It is independently testable with a handcrafted Content fixture before the card authoring skill exists.

Rubric: parent E2 D2 L2 C1 R2 = 9 → decompose (live external side effect and two review surfaces); this publisher slice E2 D1 L1 C1 R1 = 6, cohesive in one plugin.

### Requirements

- [ ] R4. Before any browser action, validate `Content.metadata.images[]`: non-empty array of objects whose `.path` is absolute, exists, and ends in `png|jpg|jpeg|webp`. Attach every path in **one ordered** file-input call, then wait until the editor shows exactly N image thumbnails. Fill `Content.title` / `Content.body`, save the draft, and return `ok: true` with `metadata.publishStatus: 'draft'` only after the draft-saved confirmation is observed. Never synthesize `id`.
- [ ] R5. `Content.metadata.publishStatus: 'public'` is the only live switch. Submit, then return `ok: true` with `metadata.publishStatus: 'public'` only after an observed success state; set `url` / `id` only when read from the page.
- [ ] R6. Each of these returns `ok: false` with `error` naming the failed step: missing/relative/unsupported image path, empty `images`, unknown `publishStatus`, missing `playwright` or Chromium, login timeout, thumbnail count ≠ N, missing draft-saved confirmation, and missing publish confirmation. The first five fail before a browser opens. For an ambiguous state after the live submit click, `error` must say the submission state is unknown and ask the operator to check the creator note manager before retrying, because a retry could duplicate the post.
- [ ] (supports R4–R6) `xhs-pub` default driver becomes `script`. `driver: 'agent'` returns `ok: false` naming the unsupported driver. Delete `sessionReady` and the synthetic `draftId`/`draftResult`.
- [ ] Preserve `Content → Result`, `--in`/`--out`, `options.profileDir` / `XHS_PROFILE_DIR` / `KK_BROWSER_PROFILE_DIR` profile resolution, `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`, and draft-by-default (ADR-008, ADR-022, ADR-024).

### Acceptance Criteria

- [ ] AC1 — XHS publisher creates a draft with the ordered images (req: R4)
- [ ] AC2 — Explicit live request publishes the XHS post (req: R5)
- [ ] AC3 — Missing or failed images prevent a false publish result (req: R6)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/E8_xiaohongshu-image-card-authoring-and-publishing.md` (R4–R6)
- Design: `docs/design/xhs-image-cards.md`; ADR-024, ADR-022, ADR-008 (+ 2026-09-17 amendment)
- Code: `plugins/publishings/xhs-pub/src/index.ts`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`, `packages/publish-harness/src/index.ts` (`launchPersistentBrowser`, `trySelectors`, `resolveBrowserProfileDir`), `scripts/bundle-plugins.ts` (`external: ['playwright']`)
- Prior driver decision being overridden for xhs: `docs/design/remaining-wt-publish-harvest.md` D3/D4
- Consumer: task 0168 (`kk:xhs-images` writes the Content this plugin reads)

### History
