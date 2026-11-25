---
schema_version: 1
name: LinkedIn post rail cannot open the composer from a signed-in profile
status: todo
template: issue
created_at: 2026-11-25T06:53:01.883Z
updated_at: "2026-11-25T06:53:04.586Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
---

## 0437. LinkedIn post rail cannot open the composer from a signed-in profile

### Background

2026-11-24 dogfood, the last blocker on the LinkedIn promo row. With a freshly signed-in profile the
publish preflight now verifies (after the headed-preflight and 90 s budget fixes), and the send gets all
the way to the composer step, where it fails:

```
{"status":"uncertain","effect":"unknown",
 "error":"linkedin composer did not open after the share box, twice (selector drift) — run: bun plugins/publishings/linkedin-pub/src/profile-check.ts login"}
```

`.works/kk-news-generate/20261124/4-publish/receipts/linkedin-pub.post.json` (attemptId `retry-1`).

This is the same "trigger click does not reliably open the composer" note from 2026-11-16, never fixed:
the 2026-11-16 redesign left the share trigger as a classless div whose text is `Start a post`, the share
surface is NOT a `[role="dialog"]`, and the editor is a tiptap/ProseMirror `div[role="textbox"]` that
needs real key events. `runPostFlow` clicks the trigger, waits for the composer, retries once, then fails
with this message — so either the click misses the actual trigger element, or the composer appears in a
container the rail does not look in.

Fixing it needs one focused headed session with the same recording method used for the 2026-11-16 social
rails (`kkBrowserLauncher` headed + click/keystroke recorder + screenshots); the operator can sign in, and
each failed attempt clears `li_at`, so the recon must run inside one session.

### Requirements

- [ ] R1. With an authenticated profile, clicking the feed's share trigger must open the composer and the post must complete: `linkedin-pub.post` reaches `succeeded/confirmed`.
- [ ] R2. The composer wait must name the surface it looked for and what it actually found (element counts/URL) instead of a generic "did not open", so the next drift is diagnosable without a live session.
- [ ] R3. A test pins the composer-open step against the measured DOM shape (recorded fixture), so a selector change fails the suite rather than the daily run.

### Acceptance Criteria

```gherkin
Scenario: AC1 — the promo post completes from an authenticated profile (req: R1)
Given a signed-in LinkedIn profile
When `kk news publish-send` dispatches the `linkedin-pub.post` row
Then the receipt is `succeeded/confirmed` with a fresh post link

Scenario: AC2 — a composer that never opens explains itself (req: R2)
Given a share trigger that opens nothing
Then the refusal names the trigger selector, the composer candidates and their observed counts
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

- Receipt: `.works/kk-news-generate/20261124/4-publish/receipts/linkedin-pub.post.json` (`attemptId: retry-1`)
- Flow: `plugins/publishings/linkedin-pub/src/index.ts` → `runPostFlow` (share-trigger click, composer wait, one retry)
- Prior measurement: `.spur/context/memory.md` 2026-11-16 LinkedIn redesign entry; task `0431` (session checks)
- Same class of defect fixed for the other rails with a recorded headed recon (`docs/design/weibo-ui-discovery.md` pattern)

### History
