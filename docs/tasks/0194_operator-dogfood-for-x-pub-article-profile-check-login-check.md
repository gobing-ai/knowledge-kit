---
schema_version: 1
name: "Operator dogfood for x-pub-article: profile-check login -> check -> one draft run; re-measure compose-articles URL/selectors/edit-URL pattern, with and without a cover"
status: todo
template: issue
created_at: 2026-10-05T13:41:38.888Z
updated_at: "2026-10-07T16:25:56.667Z"
feature_id: E91

---

## 0194. Operator dogfood for x-pub-article: profile-check login -> check -> one draft run; re-measure compose-articles URL/selectors/edit-URL pattern, with and without a cover

### Background

The X Articles mode of `x-pub` (`operation: 'article'`, `XArticleBrowserTransport`) shipped with constants copied from the wt script (`x-article-playwright.ts:143-187`) that have never been checked against a live authenticated X Articles composer. The code names this task as the place to check them (`plugins/publishings/x-pub/src/index.ts:171-174`). This is the same operator-dogfood loop 0191/0192 ran, plus a cover-upload variant.

Safety: `ARTICLE_SELECTORS.publish` publishes the article publicly. This task runs only the `draft` branch and must never activate publish, and must never touch any tweet-composer control.

Operator prerequisites (blocking): (1) an X account that can create Articles, which as far as known means X Premium (not verified); if the account cannot, close this task as blocked and record why; (2) a headed `profile-check.ts login` on `~/.config/kk/browser-profiles/x`; (3) one local `.png/.jpg/.webp` cover file at an absolute path.

### Requirements

- [ ] R1. Dogfood the x article profile session on the operator profile (`~/.config/kk/browser-profiles/x`): `profile-check.ts login` resolves verified, then `profile-check.ts check` reports `verified`; record both outcomes, including whether the headless `check` passes or X needs headed. If the account has no Articles access, record that and stop.
- [ ] R2. Re-measure the live composer contract against the plugin constants and record the drift for each item: `X_ARTICLES_URL` (`/compose/articles`), `ARTICLE_SELECTORS.write`/`title`/`body`/`addPhotos`/`fileInput`, whether the body paste works, the draft signal `ARTICLE_EDIT_RE` (`/compose/articles/edit/<id>`), `LIVE_URL_ID_RE`, and `LOGIN_URL_RE`. Observe `ARTICLE_SELECTORS.publish` for presence only; never click it.
- [ ] R3. Run exactly two draft-only article runs through the real `XArticleBrowserTransport` via the plugin CLI (`operation: 'article'`), one without a cover and one with `coverPath`, each with an observed draft id from the edit URL. No publish control is activated at any point.
- [ ] R4. Correct every stale constant found in R2 in `plugins/publishings/x-pub/src/index.ts` and pin it in `plugins/publishings/x-pub/tests/x-pub.test.ts`. Update the code comments that cite 0194 to say the values are measured, with the date.

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

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Template: task 0191 (infoq-pub dogfood), 0192 (juejin-pub dogfood)
- `plugins/publishings/x-pub/src/index.ts` (X_ARTICLES_URL, ARTICLE_SELECTORS, ARTICLE_EDIT_RE, LIVE_URL_ID_RE, LOGIN_URL_RE, cover resolution)
- `plugins/publishings/x-pub/src/profile-check.ts`

### History
