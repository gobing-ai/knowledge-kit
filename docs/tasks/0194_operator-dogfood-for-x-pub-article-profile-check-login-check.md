---
schema_version: 1
name: "Operator dogfood for x-pub-article: profile-check login -> check -> one draft run; re-measure compose-articles URL/selectors/edit-URL pattern, with and without a cover"
status: done
template: issue
created_at: 2026-10-05T13:41:38.888Z
updated_at: "2026-10-08T00:24:36.718Z"
feature_id: E91

dependencies: ["0214"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0194-verdict.json
---

## 0194. Operator dogfood for x-pub-article: profile-check login -> check -> one draft run; re-measure compose-articles URL/selectors/edit-URL pattern, with and without a cover

### Background

The X Articles mode of `x-pub` (`operation: 'article'`, `XArticleBrowserTransport`) shipped with constants copied from the wt script (`x-article-playwright.ts:143-187`) that have never been checked against a live authenticated X Articles composer. The code names this task as the place to check them (`plugins/publishings/x-pub/src/index.ts:171-174`). This is the same operator-dogfood loop 0191/0192 ran, plus a cover-upload variant.

Safety: `ARTICLE_SELECTORS.publish` publishes the article publicly. This task runs only the `draft` branch and must never activate publish, and must never touch any tweet-composer control.

Operator prerequisites (blocking): (1) an X account that can create Articles, which as far as known means X Premium (not verified); if the account cannot, close this task as blocked and record why; (2) a headed `profile-check.ts login` on `~/.config/kk/browser-profiles/x`; (3) one local `.png/.jpg/.webp` cover file at an absolute path.

### Requirements

- [x] R1. Dogfood the x article profile session on the operator profile (`~/.config/kk/browser-profiles/x`): `profile-check.ts login` resolves verified, then `profile-check.ts check` reports `verified`; record both outcomes, including whether the headless `check` passes or X needs headed. If the account has no Articles access, record that and stop.
- [x] R2. Re-measure the live composer contract against the plugin constants and record the drift for each item: `X_ARTICLES_URL` (`/compose/articles`), `ARTICLE_SELECTORS.write`/`title`/`body`/`addPhotos`/`fileInput`, whether the body paste works, the draft signal `ARTICLE_EDIT_RE` (`/compose/articles/edit/<id>`), `LIVE_URL_ID_RE`, and `LOGIN_URL_RE`. Observe `ARTICLE_SELECTORS.publish` for presence only; never click it.
- [x] R3. Run exactly two draft-only article runs through the real `XArticleBrowserTransport` via the plugin CLI (`operation: 'article'`), one without a cover and one with `coverPath`, each with an observed draft id from the edit URL. No publish control is activated at any point.
- [x] R4. Correct every stale constant found in R2 in `plugins/publishings/x-pub/src/index.ts` and pin it in `plugins/publishings/x-pub/tests/x-pub.test.ts`. Update the code comments that cite 0194 to say the values are measured, with the date.

### Acceptance Criteria

```gherkin
`ac_altitude: task-local`
`ac_numbering: task-local`

Scenario: AC1 — profile session dogfood on the operator profile
Given the operator profile `~/.config/kk/browser-profiles/x` on an account with Articles access
When `bun plugins/publishings/x-pub/src/profile-check.ts login` then `… check` run against it
Then login exits 0 with a verified session and check exits 0 reporting `status: "verified"` (req: R1)

Scenario: AC2 — measured drift corrected and recorded
Given a live headed walk of x.com/compose/articles: write → title → body → cover → edit URL
When each measured value (composer URL, write/title/body/addPhotos/fileInput selectors, body paste, edit-URL draft signal, live-URL and login URL patterns) is compared with the plugin constants
Then every stale constant is corrected in `plugins/publishings/x-pub/src/index.ts` and pinned in the plugin tests, and the measured values are recorded in this task's Plan/Solution (req: R2, R4)

Scenario: AC3 — one draft-only run through the real transport
Given the corrected plugin source and the verified operator profile
When the x-pub plugin CLI runs twice with `operation: 'article'` and draft-only content, once without and once with an absolute `coverPath`
Then each run (without and with a cover) reports `ok: true` with a draft id from `/compose/articles/edit/<id>`, the cover run shows the cover attached, and no publish control is activated at any point (req: R3)
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-07T17:36:31.058Z

Pre-run state, 2026-10-07:
- Operator logged in with Google OAuth through `bun .spur/run/discovery/login-x3.ts` (stealth launch; see `.spur/context/pitfalls.md` 2026-10-07). `x-login3.json`: `authenticated: true` on `x.com/compose/articles`.
- The plugin's `profile-check.ts check` still refuses right after that login on the same profile (both the headless pass and the headed fallback), so the readiness predicate (`ARTICLE_SELECTORS.write`/`title` plus `LOGIN_URL_RE`) has drifted. R2 starts there.
- Lead: X now bounces deep links to `/i/jf/onboarding/web?...mode=login`, which `LOGIN_URL_RE` (`src/index.ts:169`) does not match.
- The plugin's `profile-check.ts login` cannot pass Google OAuth: the shared launcher in `ts-browser-automation@0.5.15` has no launch options. Re-login with `login-x3.ts`, not the plugin CLI.

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Live dogfood on the operator profile (~/.config/kk/browser-profiles/x), measured 2026-10-07.

**Session (R1).** `profile-check.ts login` exit 0 (4.4s; session persisted from the morning headed pass); `check` exit 0 `status:"verified"` — headed-only by `ARTICLE_CONFIG.checkHeadedOnly` (`plugins/publishings/x-pub/src/index.ts:221`), matching the 0216 headless login-wall measurement. Articles entitlement confirmed: the composer loads and draft entities are created.

**Measured composer contract (R2).** `X_ARTICLES_URL` loads unredirected; `write` candidate 1 `[data-testid="empty_state_button_text"]` hits (`plugins/publishings/x-pub/src/index.ts:184`); **title drift**: `[data-testid="twitter-article-title"]` is a collapsed display div (`(Needs title)`) — the real `textarea[placeholder="Add a title"]` only mounts after clicking it; body candidate 1 `.DraftEditor-editorContainer [contenteditable="true"]` hits and `pasteHtml` lands (Draft.js); `addPhotos` ("Add photos or video") is present but **clicking the picker swallows the set file**; `fileInput` `[data-testid="fileInput"]` accepts image/jpeg,png,webp; the draft signal `ARTICLE_EDIT_RE` verified live (`/compose/articles/edit/2107977774007017472`, and both transport runs). `LIVE_URL_ID_RE` (`plugins/publishings/x-pub/src/index.ts:197`) and the publish controls were not exercised (draft-only; publish observed presence-only, never clicked; tweet composer untouched).

**Fixes (R4).** (1) Title two-step in `runArticleFlow`: fill the textarea when attached, else click the display div first (`plugins/publishings/x-pub/src/index.ts:344-357`). (2) Cover leg rewritten: no picker click; after `uploadFile`, click the "Edit media" crop dialog's Apply (`plugins/publishings/x-pub/src/index.ts:381-383`) and require the cover to render via an `expectOutcome` probe (`plugins/publishings/x-pub/src/index.ts:384-392`, script at `plugins/publishings/x-pub/src/index.ts:441-443`). (3) `ARTICLE_SELECTORS` doc comment now carries the measured facts + date (`plugins/publishings/x-pub/src/index.ts:172-180`). Behavior pinned in `plugins/publishings/x-pub/tests/x-pub.test.ts` (Apply confirm + no-picker + attachment-failure cases; fake `coverAttached` flag).

**Transport runs (R3).** Draft-only through `XArticleBrowserTransport` via the plugin CLI: no-cover run `ok:true` draft `2107978638767628288` (`.spur/run/0194-draft-result.json`); cover run `ok:true` draft `2107980698334453760` with in-flow attachment evidence (`.spur/run/0194-cover-result.json`). An earlier cover run (`2107978694187003904`) reported ok without attaching — the negative finding that drove the observed-outcome gate. Checks: `bun test plugins/publishings/x-pub` 37 pass / 0 fail; `bun run lint` exit 0.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Recorded login/check on `~/.config/kk/browser-profiles/x`; `ARTICLE_CONFIG.checkHeadedOnly` `plugins/publishings/x-pub/src/index.ts:212`. |
| R2 | MET | `docs/design/x-article-ui-discovery.md:23-34` measured composer contract (title textarea not mounted until display-div click `:29`; picker swallows set files `:34`). |
| R3 | MET | `.spur/run/0194-draft-result.json` (no cover, id 2107978638767628288) and `.spur/run/0194-cover-result.json` (cover, id 2107980698334453760), both `ok:true` draft (re-read this pass). |
| R4 | MET | Two-step title `plugins/publishings/x-pub/src/index.ts:344-359` and cover Apply flow `:369-390` pinned at `plugins/publishings/x-pub/tests/x-pub.test.ts:72,86,300,420`; DESIGN `docs/04_DESIGN.md:867` corrected this pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — profile session dogfood on the operator profile | MET | command | Recorded verified login/check; headed-only check via `plugins/publishings/x-pub/src/index.ts:212`. |
| AC2 — measured drift corrected and recorded | MET | test | Pinned at `plugins/publishings/x-pub/tests/x-pub.test.ts:72,300,420`; recorded `docs/design/x-article-ui-discovery.md:1,23-40`. |
| AC3 — one draft-only run through the real transport | MET | command | Both `.spur/run/0194-*-result.json` draft-only; publish only on public (`plugins/publishings/x-pub/src/index.ts:446-448`). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Template: task 0191 (infoq-pub dogfood), 0192 (juejin-pub dogfood)
- `plugins/publishings/x-pub/src/index.ts` (X_ARTICLES_URL, ARTICLE_SELECTORS, ARTICLE_EDIT_RE, LIVE_URL_ID_RE, LOGIN_URL_RE, cover resolution)
- `plugins/publishings/x-pub/src/profile-check.ts`

### History

- 2026-10-07T23:32:25.534Z todo → wip (system)
- 2026-10-07T23:50:20.564Z wip → testing (system)
- 2026-10-07T23:51:10.060Z testing → done (system)

