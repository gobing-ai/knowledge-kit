---
schema_version: 1
name: Session checks refuse a fresh sign-in and orphaned browser leases block the login itself
status: todo
template: issue
created_at: 2026-11-25T06:28:00.101Z
updated_at: "2026-11-25T06:28:10.128Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
---

## 0436. Session checks refuse a fresh sign-in and orphaned browser leases block the login itself

### Background

2026-11-24 daily dogfood, measured. Three publish channels could not verify a session that the operator
had just signed in on:

**LinkedIn** — the profile holds no LinkedIn auth cookie at all:
```
sqlite3 ~/.config/kk/browser-profiles/linkedin/Default/Cookies \
  "select count(*) from cookies where name='li_at'"   -> 0
```
(two separate operator sign-in attempts, `browser-profiles/linkedin` mtime 14:42 and 21:02). `li_at` is
the cookie `isLinkedinAuthenticated` depends on indirectly via the feed page, so every check refuses
with "session has likely expired".

**wechatmp** — the gate is `browser-profiles/wechatmp/storage-state.json`, still dated 2026-11-23 17:33
after a sign-in at 21:03. The profile itself has a fresh `wxuin` cookie (expires 2027-12-25), so the
window did authenticate; `persistWechatSessionState` runs only from the login's `onAuthenticated` hook,
which is gated on the readiness predicate — the predicate rejected the loaded console, so nothing was
persisted and the next `check` re-injected the stale Nov-23 state. Removing the file only produces the
plugin's "run login once" refusal, so there is no fallback to the profile's own cookies.

**weibo** — the profile holds long-lived `SUB`/`SUBP` cookies (expires 2027-11-24), yet both the
headless and the headed check refuse the same way:
```
bun plugins/publishings/weibo-pub/src/profile-check.ts check --headed
-> {"status":"refused", … "headed weibo readiness refused: Authentication was not confirmed within 18000ms"}
```
`isWeiboAuthenticated` accepts the home composer textarea or the 头条文章 editor title; this account has
no 头条文章 entitlement (0246), so the gate rests entirely on the composer selector against
`https://weibo.com` — the selector evidently no longer matches what a logged-in home page renders.

Compounding it: **orphaned browser leases blocked two of the operator's sign-in attempts.** A lease is
written per profile and names an owner pid; a killed login/browser leaves it behind and the next
`login`/`check` refuses with "browser lease … held by pid N" for a pid that no longer exists. Measured
here: leases from pids 75743 (linkedin, 22:41Z) and 68156 (weibo, 02:57Z) were dead, and three more
(`wechatmp`, `xhs`, and a duplicate `wechatmp`) had been dead for days.

### Requirements

- [ ] R1. A browser lease whose owner pid no longer exists must not block the next `kk plugin login`/`check`: the acquire path reclassifies it (the `.stale-<ts>` suffix already exists for some cases) instead of refusing.
- [ ] R2. `wechatmp-pub` must not depend on a predicate pass to persist what the browser actually authenticated: it persists the storage state at login (or keeps the profile cookies usable), so a stale state file can never mask a fresh console session.
- [ ] R3. `weibo-pub`'s readiness predicate must be re-measured against a live logged-in home page and accept the surface that is actually rendered (or set `checkHeadedOnly` if headless is the blocker).
- [ ] R4. `linkedin-pub`'s login must fail loud when the sign-in did not produce an auth cookie, instead of leaving a profile that every later check calls "expired".

### Acceptance Criteria

```gherkin
Scenario: AC1 — a dead-pid lease is adopted, not refused (req: R1)
Given a lease file whose owner pid is not running
When `kk plugin login <channel>` or `kk plugin check <channel>` starts
Then the lease is reclassified (or replaced) and the command proceeds

Scenario: AC2 — a fresh console session survives a stale state file (req: R2)
Given `storage-state.json` older than the profile's own cookies
When the session check runs
Then the check verifies from what the browser holds, or the login persists the new state at sign-in time

Scenario: AC3 — weibo verifies with a logged-in profile (req: R3)
Given an authenticated weibo profile
When `check` runs
Then it reports `verified` on the surface the post flow actually uses
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

- Evidence: `~/.config/kk/browser-profiles/{linkedin,wechatmp,weibo}/Default/Cookies` (li_at 0 rows; wxuin/SUB long-lived), `wechatmp/storage-state.json` mtime 2026-11-23
- Leases cleared tonight: `browser-leases/298483d9…` (pid 75743, linkedin), `b1a915e5…` (pid 68156, weibo), `28511cf3…` (pid 71514, wechatmp-pub)
- Predicates: `plugins/publishings/{linkedin,wechatmp,weibo}-pub/src/index.ts` (`isL*Authenticated`, `storageStatePath`, `persistWechatSessionState`)
- Lease acquire: `packages/publish-harness/src/browser.ts`
- Day artifacts: `.works/kk-news-generate/20261124/4-publish/{publish-events.jsonl,dispatch-ledger.json}`

### History
