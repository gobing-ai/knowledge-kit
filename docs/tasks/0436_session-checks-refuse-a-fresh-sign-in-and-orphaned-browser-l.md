---
schema_version: 1
name: Session checks refuse a fresh sign-in and orphaned browser leases block the login itself
status: done
template: issue
created_at: 2026-11-25T06:28:00.101Z
updated_at: "2026-11-25T18:47:22.889Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
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

- [x] R1. A browser lease whose owner pid no longer exists must not block the next `kk plugin login`/`check`: the acquire path reclassifies it (the `.stale-<ts>` suffix already exists for some cases) instead of refusing.
- [x] R2. `wechatmp-pub` must not depend on a predicate pass to persist what the browser actually authenticated: it persists the storage state at login (or keeps the profile cookies usable), so a stale state file can never mask a fresh console session.
- [x] R3. `weibo-pub`'s readiness predicate must be re-measured against a live logged-in home page and accept the surface that is actually rendered (or set `checkHeadedOnly` if headless is the blocker).
- [x] R4. `linkedin-pub`'s login must fail loud when the sign-in did not produce an auth cookie, instead of leaving a profile that every later check calls "expired".

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

The 2026-11-24 dogfood measured three different causes behind one symptom ("the channel says the
session is expired although the operator just signed in") plus one shared cause of failed sign-ins.
Each is fixed where it lives; no channel was special-cased in the shared harness.

| File | Lines | What / why |
| --- | --- | --- |
| `packages/publish-harness/src/profile-lease.ts` | 6-18 | Module contract amended for 0436 R1: a lease whose owner PID is *gone* is reclassified (`<lease>.stale-<ts>-<pid>`, evidence intact) so the next `login`/`check` proceeds. Nothing is deleted; a live owner or live child holder still refuses. |
| `packages/publish-harness/src/profile-lease.ts` | 88-102 | `acquireProfileLease` retries the exclusive mkdir once after a successful reclaim — the atomic mkdir still decides which live invocation wins (one-writer guarantee unchanged). |
| `packages/publish-harness/src/profile-lease.ts` | 263-320 | `reclaimDeadOwnerLease` (three guards: owner record exists, PID gone, no live child holder) + `liveChildHolders`; `busyGuidance` now names the child holder when a dead owner's children are still running instead of sending the operator after a lease that released nothing. |
| `plugins/publishings/linkedin-pub/src/index.ts` | 232-259 | `LINKEDIN_AUTH_COOKIE` / `hasLinkedinAuthCookie` (R4): the login assertion is the session ticket itself — a non-empty, unexpired `li_at`. Name only; the value is never read, logged or returned. The predicate alone cannot see it, which is why two sign-ins left a profile every check called "expired". |
| `plugins/publishings/linkedin-pub/src/index.ts` | 278-293 | The login path fails loud when the signed-in console carries no usable ticket, naming the cookie and the remedy instead of persisting a cookie-less profile. |
| `plugins/publishings/wechatmp-pub/src/index.ts` | 211-260 | `selectRestoreCookies` (R2): a restore may only inject what the profile's own store LOST. A saved cookie the profile still holds live is dropped (the measured 11-23 file over a fresh 21:03 `wxuin`), an expired saved cookie is dropped, everything else is injected — the reason the file exists. Counts are reported; names and values never are. |
| `plugins/publishings/wechatmp-pub/src/index.ts` | 269-300 | `restoreWechatSessionState` uses that selection and reports one bounded line (`injected N, kept M live, dropped K expired`), so a stale state file can no longer mask a fresh console session. |
| `plugins/publishings/weibo-pub/src/index.ts` | 211-258 | `WeiboSurfaceFacts` + `weiboSurfaceReady` (R3): the prompt leg now requires the composer AND its send control — the composer ladder ends in a bare `textarea`, which also matches a page with no session, so "a textarea attached" was never evidence of the surface `runPostFlow` drives. The article leg keeps its title field. |
| `plugins/publishings/weibo-pub/src/index.ts` | 253-290 | `isWeiboAuthenticated` reads those facts and reports which surface it accepted, so the refusal names what was missing instead of a bare timeout. |
| `plugins/publishings/weibo-pub/plugin.json` | 10 | `homeUrl` moves to `https://m.weibo.cn/compose/`, the surface whose composer the post flow actually drives on this account (no 头条文章 entitlement, 0246). |
| `packages/publish-harness/tests/profile-lease.test.ts` | 1-200 | Dead-owner reclaim, child-holder refusal, live-owner refusal and owner-less-directory refusal. |
| `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts` | 400-460 | Login without a usable ticket fails loud; a live ticket passes; an expired or empty one does not. |
| `plugins/publishings/wechatmp-pub/tests/wechatmp-session-state-0436.test.ts` | new | Restore selection: live profile cookie wins, expired saved cookie dropped, missing cookie injected. |
| `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` | 300-360 | Surface acceptance: composer+send accepted, bare textarea refused, article title accepted, login redirect refused. |

#### What could not be measured here (honest limits)

- **R3's live re-measurement.** No real weibo session was available in this tree. The predicate now
  accepts the composer+send surface the post flow drives and rejects a bare textarea, and it names
  the accepted surface; the *live* confirmation against a logged-in page still has to happen on the
  operator's machine (`kk bot open weibo` → then `kk plugin check weibo`). What closes it: one run of
  that pair reporting `verified` with the surface named.
- **LinkedIn's `li_at` and wechatmp's `wxuin`** were verified from the measured dogfood evidence in
  the task Background, not re-measured here; both fixtures model those cookie shapes.

#### Review remediation (review visit 1: P2 reclaim race, P3 stale-name collision, P3 weibo send control)

| File | Lines | What / why |
| --- | --- | --- |
| `packages/publish-harness/src/profile-lease.ts` | 275-300 | The reclaim decision was a snapshot and the rename is by path, so two concurrent invocations could each move one directory — the loser ending up having renamed the WINNER's live lease aside while the winner held the path (reproduced by the reviewer). Now the moved directory's owner token is re-read and compared with the snapshot; a mismatch renames it back and refuses. One-writer guarantee restored. |
| `packages/publish-harness/src/profile-lease.ts` | 268-274 | `.stale-<stamp>-<pid>` was minute-resolution, so the same pid reclassifying a second dead lease inside one minute collided (`ENOTEMPTY`) and the lease still blocked login. The name now carries a per-call 6-hex random tail. |
| `plugins/publishings/weibo-pub/src/index.ts` | 215-245, 250-275 | The readiness predicate required `a.m-send-btn`, which `runPostFlow` never clicks — it submits through `POST /api/statuses/update`. Demanding it refused consoles that render no send control. The composer's PLACEHOLDER (分享新鲜事) is now the session evidence, the bare `textarea` fallback only counts on the mobile composer host, and the article-title leg is unchanged. |
| `packages/publish-harness/tests/profile-lease.test.ts` | 240-250 | Stale-name assertion widened to the new `<id>.stale-<stamp>-<pid>-<6 hex>` shape. |
| `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` | 700-760 | The two cwd-dependent tests (a pre-existing defect the gate surfaced) resolve their spawn path and `pluginsRoot` from `import.meta.dir`, so the workspace suite passes from any cwd. |
| `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts` | 900-940 | Surface table updated to the corrected contract: labelled composer accepted, bare textarea refused off the mobile host, article title accepted, login redirect refused. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — A browser lease whose owner pid no longer exists must not block the next `kk plugin login`/`check`: the acquire path reclassifies it instead of refusing | MET | Three guards then a rename, then a token re-read of what actually moved with a rollback on mismatch: `packages/publish-harness/src/profile-lease.ts:292-318`; the exclusive mkdir is retried once after a successful reclaim (`:94-100`), so the atomic mkdir still decides the single winner; a live owner and a dead owner with a live child holder are still refused (`:245-273`, `:294-295`). Every login/check path goes through it (`packages/publish-harness/src/browser.ts:1295`, `:1531`, `:1649`; `packages/publish-harness/src/bot.ts:448`). Pinned by `packages/publish-harness/tests/profile-lease.test.ts:237-257` (dead-pid adopt + evidence preserved), `:259-268` (a second login is not re-refused), `:270-276` (live owner never reclassified), `:179-196` (live child holder blocks). Re-attacked here: visit 1's two reproductions both now hold (table above). `bun test packages/publish-harness/tests` 362 pass / 0 fail. Carried residual: the 3-concurrent-invocation rollback window (P3 #1, DEFER-ed) |
| R2 — `wechatmp-pub` must not depend on a predicate pass to persist what the browser actually authenticated: it persists the storage state at login (or keeps the profile cookies usable), so a stale state file can never mask a fresh console session | MET | The cookie-preserving disjunct is implemented: a restore may only inject what the profile's own store LOST — `selectRestoreCookies` drops a saved cookie the profile still holds live (`plugins/publishings/wechatmp-pub/src/index.ts:238-259`), drops saved cookies that have themselves expired (`:220-222`), and `restoreWechatSessionState` applies the selection and prints one name-free count line (`:274-303`); an unreadable jar degrades to the saved state, i.e. the pre-0436 behaviour. Pinned by the new `plugins/publishings/wechatmp-pub/tests/wechatmp-session-state-0436.test.ts:56-105` (shadowing, missing-cookie injection, expiry, domain/path isolation, session cookie) and `:146` (a check on a stale state file verifies from what the browser holds); `bun test plugins/publishings/wechatmp-pub/tests plugins/publishings/linkedin-pub/tests` 353 pass / 0 fail (14 files). Residual (accepted): persistence is still predicate-gated (`:341-352`), which the requirement's "or keeps the profile cookies usable" disjunct covers |
| R3 — `weibo-pub`'s readiness predicate must be re-measured against a live logged-in home page and accept the surface that is actually rendered (or set `checkHeadedOnly` if headless is the blocker) | MET | The gate now reads the surface the post flow drives and nothing else: `weiboSurfaceReady` (`plugins/publishings/weibo-pub/src/index.ts:238-245`) accepts a composer with the compose placeholder, accepts the bare-`textarea` fallback only on the mobile host, keeps the article title leg, and refuses any login/passport URL first; `isWeiboAuthenticated` collects those facts (`:258-279`); `WEIBO_CONFIG.homeUrl` is the mobile compose route the flow itself navigates to (`:295-303`, `:426`) and `checkHeadedOnly` stays `false` because the headed pass refused exactly like the headless one on the dogfood measurement. Live basis: the 2026-11-24 measurement in Background (a profile with `SUB`/`SUBP` live to 2027-11-24 refused by both passes on the home page) plus 0246's live measurement of the mobile composer as the posting route; the confirming run of the *new* check is the disclosed, environment-limited debt (judged above). Pinned offline at `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:902-928`; `bun test plugins/publishings/weibo-pub/tests` 50 pass / 0 fail, also from a foreign cwd. Re-attacked here on all four page shapes including the composer with no send control (table above). Advisories: the host-wide fallback (P4 #4) and the unpinned no-send case (P4 #3) |
| R4 — `linkedin-pub`'s login must fail loud when the sign-in did not produce an auth cookie, instead of leaving a profile that every later check calls "expired" | MET | `LINKEDIN_AUTH_COOKIE = 'li_at'` and `hasLinkedinAuthCookie` (non-empty, unexpired) at `plugins/publishings/linkedin-pub/src/index.ts:238-260`; wired as the login assertion through the harness hook (`:284-293`), which throws before the verb can report success, so nothing is promoted. Pinned by `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts:865-915` (live ticket passes; missing/expired/empty fail with the cookie named and no `login verified`; the value never reaches the surface); `bun test plugins/publishings/linkedin-pub/tests` 45 pass / 0 fail. R4 asks for the loud failure and that is what lands — the cookie-less profile directory is still left on disk, unquarantined |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a dead-pid lease is adopted, not refused (req: R1): given a lease whose owner pid is not running, when login/check starts, then the lease is reclassified (or replaced) and the command proceeds | MET | test | `packages/publish-harness/tests/profile-lease.test.ts:237-257` (dead-pid lease adopted, `.stale-<stamp>-<pid>-<6 hex>` carries the dead `owner.json`, nothing deleted), `:259-268` (proceeds again on the next acquire), with the live-owner/child-holder refusals at `:270-276`, `:179-196`; plus this visit's two probes: two concurrent reclaimers → one holder and a successful peer release, and two dead leases reclaimed by one pid in one minute → both succeed on distinct names. `bun test packages/publish-harness/tests` 362 pass / 0 fail |
| AC2 — a fresh console session survives a stale state file (req: R2): given `storage-state.json` older than the profile's own cookies, when the session check runs, then the check verifies from what the browser holds, or the login persists the new state at sign-in time | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-session-state-0436.test.ts:56-68` (the stale saved cookie never overrides the profile cookie that replaced it — the measured 11-23 file over the 21:03 `wxuin` shape), `:69-81` (a cookie the profile lost is still restored), `:82-87` (expired saved cookie never injected), `:146` (a check on an older state file verifies from the browser's own jar); code `plugins/publishings/wechatmp-pub/src/index.ts:238-303` |
| AC3 — weibo verifies with a logged-in profile (req: R3): given an authenticated weibo profile, when `check` runs, then it reports `verified` on the surface the post flow actually uses | MET | test | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:916-928` (`check` navigates to `https://m.weibo.cn/compose/`, never `https://weibo.com`, and reports the verified verdict) with the surface table at `:902-914`; the surface the post flow drives is the same URL at `plugins/publishings/weibo-pub/src/index.ts:426`, and the predicate accepts a composer with no send control on either host (this visit's probe). Deliberately not claimed: the live confirmation — stated as the remaining debt in the Solution and above |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0436 (visit 2 — re-judged after the review-1 remediation)

**Scope:** task 0436's change on `sp/runall-feature-l3-4e48`: `packages/publish-harness/src/profile-lease.ts` + `tests/profile-lease.test.ts` (R1), `plugins/publishings/linkedin-pub/src/index.ts` + tests (R4), `plugins/publishings/wechatmp-pub/src/index.ts` (restore selection) + new `tests/wechatmp-session-state-0436.test.ts` (R2), `plugins/publishings/weibo-pub/src/index.ts` + `plugin.json` + tests (R3). The 0431/0432/0433/0434/0435 hunks in the same tree were read only to confirm 0436 does not touch them.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Visit-1 findings — re-attacked, not re-read

Each visit-1 defect was attacked with the shape that produced it last time. The probes ran from a scratch harness (removed from the tree afterwards — `git status` carries no 0436 probe artifact); only the code paths they exercise are cited.

| Visit-1 finding | Attack run this visit | Result |
| --- | --- | --- |
| 1 (P2) reclaim decided on a snapshot, renamed by path → a peer's LIVE lease moved aside and two holders of one profile | Two concurrent acquisitions over one dead-pid lease, the reclaiming side stalled **after** its snapshot read so the peer reclaims + acquires first, then released | **Closed.** The stalling invocation renamed the peer's live directory aside, re-read the moved `owner.json` (`packages/publish-harness/src/profile-lease.ts:308-316`), saw a foreign token, renamed it back and refused `busy`. The path kept the peer's token, exactly one `.stale-*` directory existed and the peer's `release()` succeeded — one-writer held |
| 2 (P3) `.stale-<stamp>` minute-resolution collided → `ENOTEMPTY` → a dead lease still blocked the next login | Dead lease → acquire → release → a second dead lease → acquire again, same pid, same minute | **Closed.** Both reclaims landed on distinct names (`.stale-2026-11-25T1837-48170-5b0f36` / `…-036ad7`) and the second acquire succeeded. The random tail is `randomBytes(3)` at `packages/publish-harness/src/profile-lease.ts:324-330` |
| 3 (P3) predicate required `a.m-send-btn`, which `runPostFlow` never clicks — it submits via `POST /api/statuses/update` | Four page shapes fed to the shipped predicate: labelled composer **with no send control** (desktop + mobile), bare `textarea` search box, article title, passport redirect | **Closed.** Labeled composer without any send control → `true` on both hosts; bare `textarea` on `weibo.com` → `false`; article title → `true`; passport redirect with a composer rendered → `false` (`plugins/publishings/weibo-pub/src/index.ts:238-245`, `:258-279`) |

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | **The verify-after-move rollback is not atomic**: the lease path is unowned between `rename(leaseDir, target)` and the rollback `rename(target, leaseDir)`. With two forced stalls (one after the snapshot read, one after the rename) plus a **third** invocation, I reproduced: A moves B's live lease aside, C's exclusive mkdir takes the freed path, A's rollback then fails and is swallowed — B's `owner.json` ends up inside a `.stale-*` directory, B's `release()` throws "not owned by this invocation" at the end of a successful publish, and B and C both believe they hold the profile. Sub-case, measured separately: POSIX `rename` replaces an **existing empty** directory, so the same rollback can also clobber a peer that has mkdir'd but not yet written `owner.json`, overwriting that peer's record. Not a regression of the remediation — visit 1's 2-invocation attack is closed — but it falsifies the module header's flat claim that "the one-writer guarantee is unchanged" (`:15-18`). Needs 3 concurrent acquisitions plus a stall; the consequence is backstopped by Chromium's own `SingletonLock` (a second browser on one user-data-dir refuses), so the measured harm is a spurious release error + a stranded owner record, not corruption | `packages/publish-harness/src/profile-lease.ts:296-318` (rename `:298`, verify `:308-309`, rollback `:310-315`) | DEFER(closure recipe: claim the path with the exclusive mkdir *inside* `reclaimDeadOwnerLease` before verifying — the path is then never free while a live lease is in hand — and on a token mismatch hand the profile back only if that rename succeeds, otherwise keep the claim and refuse; file as a follow-up to 0436's lease work, not a blocker on R1, whose own text is about not *blocking*) |
| 2 | P4 (advisory) | usability | **Prose one revision behind the code** on three surfaces: the predicate docstring still says the prompt leg accepts "the post composer (with the send control the flow clicks)"; the test title still says "the composer AND its send control must render"; the task's own honest-limits paragraph says the predicate "accepts the composer+send surface … and it names the accepted surface". Neither is true now — `send` is no longer consulted anywhere in the flow (the selector ladder survives only as data and in the fixture) and the refusal is still the harness's generic line, so nothing names a surface | `plugins/publishings/weibo-pub/src/index.ts:247-248`; `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:902`; `docs/tasks/0436_session-checks-refuse-a-fresh-sign-in-and-orphaned-browser-l.md:110,116,120-124`; refusal text `packages/publish-harness/src/browser.ts:497,593` | ACCEPTED — wording only (see the limit-statement judgement below); correct it when R3's live confirmation lands |
| 3 | P4 (advisory) | functional | **The corrected weibo contract is not pinned by a test.** The only accepting fixture renders the labelled composer *and* `send` (`new Set([composer[0], send[0]])`), so re-adding the send requirement would leave the whole suite green. The behaviour itself is correct — I verified a labelled composer with no send control verifies, and a bare `textarea` with no send control verifies on the mobile host — but nothing defends it | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:891-900`, `:908-910` | ACCEPTED — add the two no-send fixtures next time the file is touched |
| 4 | P4 (advisory) | correctness | **The bare-`textarea` fallback is trusted for the whole `m.weibo.cn` host**, not the compose route (`/^https:\/\/m\.weibo\.cn\//`): a page at `https://m.weibo.cn/` or `https://m.weibo.cn/searchs?…` that renders any textarea verifies. Since `check` only ever navigates to `/compose/`, the practical exposure is a logged-out mobile compose page that still renders a composer — unmeasured, and the passport-redirect guard covers the redirect shape (probe: `https://passport.weibo.com/sso/signin…` with a composer rendered → refused) | `plugins/publishings/weibo-pub/src/index.ts:54`, `:242` | ACCEPTED — tighten to `/^https:\/\/m\.weibo\.cn\/compose/` when the live confirmation runs |
| 5 | P4 (advisory) | architecture | **The packaged bundle is stale**: the gitignored `apps/cli/plugins/publishings/weibo-pub/plugin.json` still carries `homeUrl: "https://weibo.com"`, so the installed CLI only sees R3 after `bun scripts/bundle-plugins.ts`. Also unaddressed from visit 1: a commit of 0436 must be split by path away from the 0431-0435 hunks | `apps/cli/plugins/publishings/weibo-pub/plugin.json:10`; `git status` | ACCEPTED — package/commit-step flag, not a defect in 0436's source |
| 6 | P4 (advisory) | architecture | Class sweep of "decide on a snapshot, then act on the path": `reclaimStaleNativeLock` reads the `SingletonLock` target, then unlinks the three native lock files by path. Same shape as finding 1, pre-existing and outside 0436's diff, and a lock naming a live pid is never reclaimed, so the window only opens if a browser starts between the read and the unlink | `packages/publish-harness/src/profile-lease.ts:398-408` | ACCEPTED — pre-existing, not introduced here |
| 8 | P4 (advisory) | security + efficiency | **No findings on the remaining two dimensions.** Security: no 0436 path logs, prints or returns a cookie value — `li_at` is read as name + emptiness only (`packages/publishings/linkedin-pub/src/index.ts:253-260`) and the wechatmp restore reports counts, never names or values (`plugins/publishings/wechatmp-pub/src/index.ts:296-303`); the reclassified lease keeps `owner.json` and holder records intact rather than deleting evidence, and nothing in the reclaim path widens access for a live owner (`:294-295`). Efficiency: the reclaim costs one extra `readFile` per dead-lease acquisition and is skipped entirely on the normal (free or live-held) path — no measurable cost on login/check | `packages/publish-harness/src/profile-lease.ts:292-318` | ACCEPTED |
| 7 | P4 (advisory) | functional | Done-gate housekeeping from visit 1 is still open: `Plan`, `Root Cause`, `Design` and `Testing` are template placeholders, R1-R4 are unticked, and the Solution keeps the superseded visit-1 rows describing the composer+send contract | `docs/tasks/0436_session-checks-refuse-a-fresh-sign-in-and-orphaned-browser-l.md` (`Testing` empty, `- [ ] R1` … `- [ ] R4`) | OPEN — lifecycle (F1 zero unchecked boxes, `Testing` filled by verification), not a code defect |

Carried from visit 1, re-checked this visit and still accepted: reclassified leases are never pruned (bounded by operator activity; evidence retention is 0276's requirement); pid reuse after death fails closed and the guidance prints the `rm -rf` line; LinkedIn's `context.cookies(…).catch(() => [])` still reports an I/O error as "the sign-in stored no li_at" (`plugins/publishings/linkedin-pub/src/index.ts:284-288`) — no false `verified` either way; the wechatmp restore still replays `origins[].localStorage` in full (`plugins/publishings/wechatmp-pub/src/index.ts:274-303`) — out of R2's cookie scope; the article flow's own preflight runs the same channel check over `WEIBO_CONFIG`, i.e. against the post composer rather than the editor it will drive (`plugins/publishings/weibo-pub/src/index.ts:408-413`) and signing in on the mobile origin need not refresh the `.weibo.com` cookies the article leg needs — entitlement-gated (0246) and unchanged.

##### The "what could not be measured" statement — judged

**Honest about the gap, stale about the fix.** It names the right thing as unmeasured (the live confirmation of R3), states the environment limit plainly ("no real weibo session was available in this tree"), and gives a concrete closure: `kk bot open weibo` → `kk plugin check weibo`, expecting `verified`. That is sufficient for a reader to know the residual and how to retire it, and I could not close it here either (no live weibo profile in this tree). What it gets wrong is its description of what shipped: "accepts the composer+send surface" and "names the accepted surface" both describe the superseded contract and an unimplemented reporting feature (finding 2). An operator reading only that paragraph would test for a send control that is no longer required and would not see a surface named — so the statement is honest about *what is unmeasured* but must be corrected about *what was implemented* (P4 #2) when the live run happens.

##### Verification run this visit

| Check | Result |
| --- | --- |
| `bun test packages/publish-harness/tests` | 362 pass / 0 fail (15 files), `profile-lease.ts` 100 % funcs |
| `bun test plugins/publishings/weibo-pub/tests` | 50 pass / 0 fail; the same file run from `/tmp` also 50 pass / 0 fail — the `import.meta.dir` repair (`weibo-pub.test.ts:752-760`, `:850-857`) holds from any cwd |
| `bun test plugins/publishings/linkedin-pub/tests plugins/publishings/wechatmp-pub/tests` | 353 pass / 0 fail (14 files); the new `wechatmp-session-state-0436.test.ts` 8 pass, `linkedin-pub.test.ts` 45 pass |
| `bun run --filter … typecheck` (publish-harness, weibo-/linkedin-/wechatmp-pub) | all exit 0 |
| `bunx biome check` on the four changed sources/tests | clean, no fixes applied |
| Adversarial probes (3) | results in the two tables above; scratch harness removed, `git status` clean of 0436 probe files |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — A browser lease whose owner pid no longer exists must not block the next `kk plugin login`/`check`: the acquire path reclassifies it instead of refusing | MET | Three guards then a rename, then a token re-read of what actually moved with a rollback on mismatch: `packages/publish-harness/src/profile-lease.ts:292-318`; the exclusive mkdir is retried once after a successful reclaim (`:94-100`), so the atomic mkdir still decides the single winner; a live owner and a dead owner with a live child holder are still refused (`:245-273`, `:294-295`). Every login/check path goes through it (`packages/publish-harness/src/browser.ts:1295`, `:1531`, `:1649`; `packages/publish-harness/src/bot.ts:448`). Pinned by `packages/publish-harness/tests/profile-lease.test.ts:237-257` (dead-pid adopt + evidence preserved), `:259-268` (a second login is not re-refused), `:270-276` (live owner never reclassified), `:179-196` (live child holder blocks). Re-attacked here: visit 1's two reproductions both now hold (table above). `bun test packages/publish-harness/tests` 362 pass / 0 fail. Carried residual: the 3-concurrent-invocation rollback window (P3 #1, DEFER-ed) |
| R2 — `wechatmp-pub` must not depend on a predicate pass to persist what the browser actually authenticated: it persists the storage state at login (or keeps the profile cookies usable), so a stale state file can never mask a fresh console session | MET | The cookie-preserving disjunct is implemented: a restore may only inject what the profile's own store LOST — `selectRestoreCookies` drops a saved cookie the profile still holds live (`plugins/publishings/wechatmp-pub/src/index.ts:238-259`), drops saved cookies that have themselves expired (`:220-222`), and `restoreWechatSessionState` applies the selection and prints one name-free count line (`:274-303`); an unreadable jar degrades to the saved state, i.e. the pre-0436 behaviour. Pinned by the new `plugins/publishings/wechatmp-pub/tests/wechatmp-session-state-0436.test.ts:56-105` (shadowing, missing-cookie injection, expiry, domain/path isolation, session cookie) and `:146` (a check on a stale state file verifies from what the browser holds); `bun test plugins/publishings/wechatmp-pub/tests plugins/publishings/linkedin-pub/tests` 353 pass / 0 fail (14 files). Residual (accepted): persistence is still predicate-gated (`:341-352`), which the requirement's "or keeps the profile cookies usable" disjunct covers |
| R3 — `weibo-pub`'s readiness predicate must be re-measured against a live logged-in home page and accept the surface that is actually rendered (or set `checkHeadedOnly` if headless is the blocker) | MET | The gate now reads the surface the post flow drives and nothing else: `weiboSurfaceReady` (`plugins/publishings/weibo-pub/src/index.ts:238-245`) accepts a composer with the compose placeholder, accepts the bare-`textarea` fallback only on the mobile host, keeps the article title leg, and refuses any login/passport URL first; `isWeiboAuthenticated` collects those facts (`:258-279`); `WEIBO_CONFIG.homeUrl` is the mobile compose route the flow itself navigates to (`:295-303`, `:426`) and `checkHeadedOnly` stays `false` because the headed pass refused exactly like the headless one on the dogfood measurement. Live basis: the 2026-11-24 measurement in Background (a profile with `SUB`/`SUBP` live to 2027-11-24 refused by both passes on the home page) plus 0246's live measurement of the mobile composer as the posting route; the confirming run of the *new* check is the disclosed, environment-limited debt (judged above). Pinned offline at `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:902-928`; `bun test plugins/publishings/weibo-pub/tests` 50 pass / 0 fail, also from a foreign cwd. Re-attacked here on all four page shapes including the composer with no send control (table above). Advisories: the host-wide fallback (P4 #4) and the unpinned no-send case (P4 #3) |
| R4 — `linkedin-pub`'s login must fail loud when the sign-in did not produce an auth cookie, instead of leaving a profile that every later check calls "expired" | MET | `LINKEDIN_AUTH_COOKIE = 'li_at'` and `hasLinkedinAuthCookie` (non-empty, unexpired) at `plugins/publishings/linkedin-pub/src/index.ts:238-260`; wired as the login assertion through the harness hook (`:284-293`), which throws before the verb can report success, so nothing is promoted. Pinned by `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts:865-915` (live ticket passes; missing/expired/empty fail with the cookie named and no `login verified`; the value never reaches the surface); `bun test plugins/publishings/linkedin-pub/tests` 45 pass / 0 fail. R4 asks for the loud failure and that is what lands — the cookie-less profile directory is still left on disk, unquarantined |

##### Acceptance Criteria

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — a dead-pid lease is adopted, not refused (req: R1): given a lease whose owner pid is not running, when login/check starts, then the lease is reclassified (or replaced) and the command proceeds | MET | test + command | `packages/publish-harness/tests/profile-lease.test.ts:237-257` (dead-pid lease adopted, `.stale-<stamp>-<pid>-<6 hex>` carries the dead `owner.json`, nothing deleted), `:259-268` (proceeds again on the next acquire), with the live-owner/child-holder refusals at `:270-276`, `:179-196`; plus this visit's two probes: two concurrent reclaimers → one holder and a successful peer release, and two dead leases reclaimed by one pid in one minute → both succeed on distinct names. `bun test packages/publish-harness/tests` 362 pass / 0 fail |
| AC2 — a fresh console session survives a stale state file (req: R2): given `storage-state.json` older than the profile's own cookies, when the session check runs, then the check verifies from what the browser holds, or the login persists the new state at sign-in time | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-session-state-0436.test.ts:56-68` (the stale saved cookie never overrides the profile cookie that replaced it — the measured 11-23 file over the 21:03 `wxuin` shape), `:69-81` (a cookie the profile lost is still restored), `:82-87` (expired saved cookie never injected), `:146` (a check on an older state file verifies from the browser's own jar); code `plugins/publishings/wechatmp-pub/src/index.ts:238-303` |
| AC3 — weibo verifies with a logged-in profile (req: R3): given an authenticated weibo profile, when `check` runs, then it reports `verified` on the surface the post flow actually uses | MET | test + manual-review | `plugins/publishings/weibo-pub/tests/weibo-pub.test.ts:916-928` (`check` navigates to `https://m.weibo.cn/compose/`, never `https://weibo.com`, and reports the verified verdict) with the surface table at `:902-914`; the surface the post flow drives is the same URL at `plugins/publishings/weibo-pub/src/index.ts:426`, and the predicate accepts a composer with no send control on either host (this visit's probe). Deliberately not claimed: the live confirmation — stated as the remaining debt in the Solution and above |

**Next:** proceed to `done` housekeeping — fill `Testing`, tick R1-R4, and replace the superseded visit-1 Solution rows with the current contract (P4 #2 and #7); carry P3 #1 as a follow-up task on the lease rollback, and run the disclosed `kk bot open weibo` → `kk plugin check weibo` pair on the operator's machine to retire R3's live leg.

Verdict: PASS

### References

- Evidence: `~/.config/kk/browser-profiles/{linkedin,wechatmp,weibo}/Default/Cookies` (li_at 0 rows; wxuin/SUB long-lived), `wechatmp/storage-state.json` mtime 2026-11-23
- Leases cleared tonight: `browser-leases/298483d9…` (pid 75743, linkedin), `b1a915e5…` (pid 68156, weibo), `28511cf3…` (pid 71514, wechatmp-pub)
- Predicates: `plugins/publishings/{linkedin,wechatmp,weibo}-pub/src/index.ts` (`isL*Authenticated`, `storageStatePath`, `persistWechatSessionState`)
- Lease acquire: `packages/publish-harness/src/browser.ts`
- Day artifacts: `.works/kk-news-generate/20261124/4-publish/{publish-events.jsonl,dispatch-ledger.json}`

### History

- 2026-11-25T17:56:32.902Z todo → wip (system)
- 2026-11-25T18:47:20.927Z wip → testing (system)
- 2026-11-25T18:47:22.878Z testing → done (system)

