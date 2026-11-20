---
schema_version: 1
name: Weibo article, X, Threads and LinkedIn publish rails still cannot confirm a daily post
status: todo
template: issue
created_at: 2026-11-19T22:00:52.977Z
updated_at: "2026-11-20T00:28:50.863Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 10
feature_id: L3
---

## 0410. Weibo article, X, Threads and LinkedIn publish rails still cannot confirm a daily post

### Background

Captured from the 2026-11-19 dogfood: four rails failed to confirm a daily post while the identifiers and the episode bundle were unchanged from earlier runs.

**Refine corrections (2026-11-19)**

- **Renumbered 0397 → 0410.** WBS 0397 is also held by the done D8 task `0397_define-the-music-brief…` (renumbered there by 109f8c86, then reused by this issue). Same fix as 0408.
- **All four rails are still in the new workflow** (`plugins/kk/publish-presets/daily-ai-voice.json`): `weibo-pub/article` tier 2 `cn-peak` live (69-76); `x-pub/post`, `threads-pub/post`, `linkedin-pub/post` tier 3 `overseas-rss` live (93-124). None is fixed: since 2026-11-16 the rails got only wait-scaling commits (cc955b67 x, d49f8b9b threads, c354c7d6 linkedin redesign, ef88293c weibo pic id), and the 11-19 failures postdate them.
- **Per-rail triage (each kept, independently deliverable):**
  - *weibo article.* Cover attach timed out (`src/index.ts:452`), then `下一步` produced no outcome (96-99, 496). The 头条文章 editor was never measured live, and the 2026-11-16 session noted "account lacks the entitlement" (`.spur/context/memory.md:308`). Entitlement is a precondition: if it is missing, this rail becomes a preset change (`mode: off`), not code.
  - *X.* `src/post-rail.ts:214-244`, `x post submit never enabled …`. The rail already tries to clear `[data-testid="mask"]` (219, 256), and the 11-16 recording places `/compose/post` as a page, not a dialog (`memory.md:310`). Still unobserved: why Post stays disabled after the mask handling, and the card attach.
  - *Threads.* `src/post-rail.ts:283`, `threads post text was not retained …`; the inline composer never expands (`memory.md:310`).
  - *LinkedIn.* `src/index.ts:443-452`, Post button never attached or clickable; the trigger click does not reliably open the 2026-11-16 redesign composer.
- **Credentials are no longer the blocker for X/Threads.** On 11-16 X/Threads were API-only and lacked tokens. Both now dispatch kk-bot-first through the signed-in browser profile (`X_POST_TRANSPORT=api` / `THREADS_POST_TRANSPORT=api` are escapes), so this task is browser-rail work only.
- **Missing source.** The 11-16 recordings cited in memory (`.spur/run/dogfood/2026-11-16-social/show-{x,threads}/`) are not on disk. New recordings are required, not optional.
- **Out of scope, flagged for the operator.** The four `overrides` (`daily-ai-voice.json:150-178`) that send the draftless social rows live carry `until: "2026-11-16 dogfood run"`. `until` is informational and not enforced, so they still apply. Whether they should stay is an ADR-022 decision for the operator, not this task.

### Requirements

Each rail is independent; deliver and verify per rail. Order: entitlement check, then X, Threads, LinkedIn.

- [ ] R1. — weibo article entitlement first. In an operator-attended headed session on the `article` profile, open the 头条文章 editor and record whether the account can publish 头条文章. **If not entitled:** set the preset row `weibo-pub/article` to `mode: "off"`, with the evidence path in the commit message, and stop (no rail code). **If entitled:** record the cover-attach and `下一步 → 发布` sequence and fix the rail from that recording, as in R2.
- [ ] R2. — X post rail confirms a post. Record one operator-attended headed post on the X profile (text + card image). From the recording, fix the editor focus/typing and the Post enablement and the media attach in `plugins/publishings/x-pub/src/post-rail.ts`. The receipt keeps the "baseline newest `/status/<id>` before, require a different id after" contract.
- [ ] R3. — Threads post rail confirms a post. Record the composer expansion and typing on threads.com. Fix the expand/type/readback path in `plugins/publishings/threads-pub/src/post-rail.ts` from the recording. The receipt proves the new thread exists (newest post id/permalink changes, or the readback finds the text).
- [ ] R4. — LinkedIn post rail confirms a post. Record the redesigned trigger → share surface → typing → Post. Fix trigger reliability and Post enablement in `plugins/publishings/linkedin-pub/src/index.ts` from the recording. The receipt proves the new post exists.
- [ ] R5. — Honest outcomes unchanged. A click that cannot be confirmed stays `effect: unknown` (never resent). A pre-submit failure stays `effect: none`. No rail may report success from a submit click alone.
- [ ] R6. — Regression tests per fixed rail. Each rail's fix lands with a fake-page test that reproduces the recorded failure (fails pre-fix) and the recorded success path.

**Non-goals:** changing the ADR-022 overrides (operator decision); the API transports; card/image variants that are `mode: off` (`threads-pub/post-images`, `shipinhao-pub/image`, `x-pub/article`); weibo `post` (working since ef88293c).

### Acceptance Criteria

```gherkin
Scenario: AC1 — weibo article entitlement is decided by evidence (req: R1)
  Given the headed session on the weibo article profile
  When the 头条文章 editor is opened
  Then Root Cause records entitled or not with screenshot paths, and either the preset row is mode off or the rail publishes one article with a confirmed receipt

Scenario: AC2 — X publishes and confirms (req: R2, R5)
  Given the rail fixed from the recorded session
  When one live X post runs from kk plugin publish on the operator's instruction
  Then the receipt is succeeded and confirmed with a status id different from the pre-post baseline

Scenario: AC3 — Threads publishes and confirms (req: R3, R5)
  Given the rail fixed from the recorded session
  When one live Threads post runs on the operator's instruction
  Then the receipt is succeeded and confirmed with the new post's id or permalink

Scenario: AC4 — LinkedIn publishes and confirms (req: R4, R5)
  Given the rail fixed from the recorded session
  When one live LinkedIn post runs on the operator's instruction
  Then the receipt is succeeded and confirmed with evidence of the new post

Scenario: AC5 — Unconfirmable clicks stay unknown (req: R5)
  Given a fake page where submit is clicked but no new post appears
  When each fixed rail runs
  Then it returns failure with effect unknown, and a failure before submit returns effect none

Scenario: AC6 — Each fix is pinned (req: R6)
  Given the per-rail fake-page tests reproducing the recorded failure
  When they run against the pre-fix code
  Then they fail, and they pass after the fix with bun run test at per-file coverage of 90% or more
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-20T00:23:08.895Z

- **Q: Split into four tasks? A (closed 2026-11-19):** no. All four share one prerequisite (an operator-attended headed recording session) and one mechanism, and they are small each. Delivery is per rail inside the task. A rail blocked on the operator does not block the others; report it as partial per rail.
- **Q: Who authorizes the live verification posts (AC2-AC4)? A (closed):** the operator, per post. These rails have no draft mode, so each verification is an irreversible public post (ADR-022). The implementer prepares and asks; it never posts on its own.
- **Q: Recording tool? A (closed):** the harness launcher, headed (`createKkBrowserLauncher`, `packages/publish-harness/src/browser.ts`) with the click/keystroke recorder used on 2026-11-16, writing `events.jsonl` + screenshots under `.spur/run/dogfood/<YYYY-MM-DD>-social/<rail>/`. Commit nothing from that directory that contains session cookies or tokens.
- **Q: Keep the expired overrides? A:** out of scope. Raised to the operator in this task's Background and the refine report.

### Design

**WHAT.** Measurement-first repair of four browser publish rails. Each rail's selectors and enablement conditions come from one recorded, operator-attended headed session. Receipts must prove that a new post exists.

**WHY.** Each rail was coded from partial observation. The 11-19 failures sit exactly at the unobserved steps: weibo article cover/下一步, X enablement, Threads composer expansion, LinkedIn trigger. Guessing again repeats the 11-16 → 11-19 cycle.

**WHERE (frozen).**

| Rail | Code | Failure site | Receipt proof |
| --- | --- | --- | --- |
| weibo article | `plugins/publishings/weibo-pub/src/index.ts` (96-99 selectors, 452 cover, 496/761 publish) or preset `daily-ai-voice.json:69-76` | cover attach, `下一步` | article URL/id after 发布 |
| X | `plugins/publishings/x-pub/src/post-rail.ts` (214-256) | Post never enabled | newest `/status/<id>` differs from baseline |
| Threads | `plugins/publishings/threads-pub/src/post-rail.ts` (~283) | text not retained | new post id/permalink or readback match |
| LinkedIn | `plugins/publishings/linkedin-pub/src/index.ts` (443-452) | Post never clickable | new activity URN/URL |

Recordings go under `.spur/run/dogfood/<YYYY-MM-DD>-social/<rail>/`, and Root Cause gets a per-rail summary (selector, enablement condition, timing).

**Anti-patterns.** No selector without a recording. No success from a click alone. No resend of an `effect: unknown` row. No live post without per-post operator approval. No widening of timeouts as a "fix".

### Plan

1. **Book the operator session(s).** One headed recording per rail. weibo-article entitlement goes first: it may remove the rail entirely.
2. **weibo article (R1).** Not entitled → preset `mode: "off"` and done. Entitled → record, write the failing fake-page test, fix, test.
3. **X (R2).** Record, then write a fake-page test reproducing "Post never enabled" (fails), fix `post-rail.ts`, pass.
4. **Threads (R3).** Same loop on the composer expansion/readback.
5. **LinkedIn (R4).** Same loop on trigger reliability and Post enablement.
6. **R5/R6.** Per rail, add the unknown-vs-none outcome tests.
7. **Gate.** `bun run lint`, `bun run test`, `bun run build`.
8. **Live verification (operator-approved, one post per rail).** `kk plugin publish` (or the matrix `--retry` for that row only) and record the receipts in Testing. A rail whose live check is not approved is reported as "fixed, live-unverified".

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Preset rows and overrides: `plugins/kk/publish-presets/daily-ai-voice.json:69-76,85-124,150-178`; ADR-022 `docs/00_ADR.md:964`.
- Rails: `plugins/publishings/{weibo,x,threads,linkedin}-pub/src/`; tests `…/tests/`.
- Harness launcher: `packages/publish-harness/src/browser.ts` (`createKkBrowserLauncher`).
- Session evidence: `.spur/context/memory.md:307-310,316`.
- Recent rail commits: cc955b67, d49f8b9b, c354c7d6, ef88293c, 50d69bb9, 442fcd81.
- Concurrency check before starting: `git worktree list`, `spur task list --status wip --json`.

### History
