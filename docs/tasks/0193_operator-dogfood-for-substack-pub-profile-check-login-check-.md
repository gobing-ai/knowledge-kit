---
schema_version: 1
name: "Operator dogfood for substack-pub: profile-check login -> check -> one draft run; re-measure editor URL/body paste/draft signal"
status: todo
template: issue
created_at: 2026-10-05T13:41:38.676Z
updated_at: "2026-10-07T17:59:28.378Z"
feature_id: E91

dependencies: ["0214"]
---

## 0193. Operator dogfood for substack-pub: profile-check login -> check -> one draft run; re-measure editor URL/body paste/draft signal

### Background

`substack-pub` (E7, task 0146) shipped with constants copied from the wt script (`substack-playwright.ts:84-136`) that have never been checked against a live authenticated Substack editor. The code names this task as the place to check them (`plugins/publishings/substack-pub/src/index.ts:36-40`, `src/profile-check.ts:16-17`). This is the same operator-dogfood loop 0191 (infoq) and 0192 (juejin) ran: profile session, live re-measure, one draft-only run, then fix and pin any drift.

Safety: `SELECTORS.send` is `Send to everyone now`, which emails every subscriber (E91-D5). This task runs only the `draft` branch; the `public` branch and the `continue`/`send` controls must never be activated.

Operator prerequisites (blocking): (1) a headed `profile-check.ts login` on `~/.config/kk/browser-profiles/substack` (Substack email-link login); (2) a publication URL with no subscribers or a dedicated test publication, set via `SUBSTACK_PUBLICATION_URL` or `--publication`.

### Requirements

- [ ] R1. Dogfood the substack profile session on the operator profile (`~/.config/kk/browser-profiles/substack`) with the operator's publication URL: `profile-check.ts login --publication <url>` resolves verified, then `profile-check.ts check --publication <url>` reports `verified`; record both outcomes, including whether the headless `check` passes or Substack needs headed.
- [ ] R2. Re-measure the live authenticated editor contract against the plugin constants and record the drift for each item: `editorUrl()` (`<base>/publish/post/new`), `SELECTORS.title`/`subtitle`/`body` (ProseMirror), whether the HTML body paste works, the autosave draft signal `DRAFT_URL_RE` (`/publish/post/<id>`), and `LOGIN_URL_RE`. Observe `SELECTORS.continue`/`send` for presence only; never click them.
- [ ] R3. Run exactly one draft-only publish (no `publishStatus`, or `draft`) through the real `SubstackBrowserTransport` via the plugin CLI, with the draft signal observed (draft id from `/publish/post/<id>`). No continue/send/publish control is activated at any point.
- [ ] R4. Correct every stale constant found in R2 in `plugins/publishings/substack-pub/src/index.ts` and pin it in `plugins/publishings/substack-pub/tests/substack-pub.test.ts`. Update the code comments that cite 0193 to say the values are measured, with the date.

### Acceptance Criteria

```gherkin
`ac_altitude: task-local`
`ac_numbering: task-local`

Scenario: AC1 — profile session dogfood on the operator profile
Given the operator profile `~/.config/kk/browser-profiles/substack` and a publication URL
When `bun plugins/publishings/substack-pub/src/profile-check.ts login --publication <url>` then `… check --publication <url>` run against it
Then login exits 0 with a verified session and check exits 0 reporting `status: "verified"` (req: R1)

Scenario: AC2 — measured drift corrected and recorded
Given a live headed walk of the publication: editor → title/subtitle/body → autosave
When each measured value (editor URL, title/subtitle/body selectors, body paste, draft URL signal, login URL pattern) is compared with the plugin constants
Then every stale constant is corrected in `plugins/publishings/substack-pub/src/index.ts` and pinned in the plugin tests, and the measured values are recorded in this task's Plan/Solution (req: R2, R4)

Scenario: AC3 — one draft-only run through the real transport
Given the corrected plugin source and the verified operator profile
When `bun plugins/publishings/substack-pub/src/index.ts --in <content> --out <result>` runs once with draft-only content
Then the result JSON reports `ok: true` with a draft id taken from `/publish/post/<id>`, and no continue/send/publish control is activated at any point (req: R3)
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-07T17:07:33.395Z

Pre-run measurements, 2026-10-07 (probe scripts `.spur/run/discovery/probe-substack-0193.ts` and `cookies-substack-0193.ts`):
- Publication URL is `https://robinmin.substack.com`. The dashboard URL `…/publish/home` is rejected by `resolvePublicationUrl`; use the root.
- After the operator's `profile-check.ts login` reported success, `check` still returns `refused` (both the headless pass and the headed fallback).
- Drift, editor URL: `editorUrl()` returns `<base>/publish/post/new`, which now lands on `<base>/new` showing "Page not found". Yesterday's working walk (`walk-substack4.ts:10`) used `<base>/publish/post`.
- Drift, body selector: the walk clicked `div.tiptap.ProseMirror`. The plugin uses `.ProseMirror[contenteditable="true"]`, which is unverified.
- Session: after login, the profile holds only `.substack.com substack.lli` and no `substack.sid` session cookie. Headless `/publish/post` redirects to `substack.com/sign-in?…for_pub=robinmin` ("This page is private"). Hypothesis (unverified): the session cookie is either not persisted past browser close or never set for the publication.

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
- `plugins/publishings/substack-pub/src/index.ts` (SELECTORS, DRAFT_URL_RE, LOGIN_URL_RE, editorUrl)
- `plugins/publishings/substack-pub/src/profile-check.ts`
- E91-D5 (live controls only reachable from the `public` branch)

### History
