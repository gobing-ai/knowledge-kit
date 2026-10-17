---
schema_version: 1
name: Record bot session facts at login and show them in kk bot list
status: todo
template: feature-impl
created_at: 2026-10-17T02:59:58.070Z
updated_at: "2026-10-17T03:18:36.226Z"
feature_id: A23
priority: P2
tags:
  - bot
  - cli
  - publish-harness

estimate_hours: 6
---

## 0305. Record bot session facts at login and show them in kk bot list

### Background

Implements: R1 — Login records when the session was saved; R2 — Login records an estimated session expiry; R3 — Adapter-reported account identity is saved; R4 — Bot list shows identity, last login and expiry columns.

Operator ask (run 3b6667b1-8505-4736-8402-a2e006ce6a20): `kk bot list` should show last login date, expiry date and a user-identity column. The ask said `spur bot`; Spur has no bot noun, so this lands on `kk bot` (A22). Design: docs/design/kk-bot-session-facts-exec.md; ADR-038 amendment 2026-10-16.

**Refine corrections (2026-10-16)**

- "`runProfileCli` calls `captureSessionFacts` before its context closes" → `runProfileCli` (packages/publish-harness/src/browser.ts:500) calls upstream `loginWithProfile` (`@gobing-ai/ts-browser-automation` 0.5.28, `dist/operations.js:29-43`), which returns `Promise<void>` and closes its context in `finally`; the caller never sees the context → bot-mode login switches to the same package's `withProfilePage` (already imported, browser.ts:12, used at browser.ts:345), whose callback runs only after the readiness predicate passes and before the guaranteed close. Same single headed launch; no extra launch, no upstream change.
- "browser.ts never touches cookies" (module doc, browser.ts:59-62) → `captureSessionFacts` reads `context.cookies(url)` expiry only → the module doc is amended to say cookie expiry is read at login, names/values never leave the helper.
- "`listBots` mtime fallback" needed a stat seam → `bot.ts` already imports `lstat` from `./bot-fs` (bot.ts:4); reuse it on `bot.json`, no FileSystem interface change.

### Requirements

- [ ] R1 — `BotMetadata` gains optional `lastLoginAt`, `expiresAt`, `identity`; `parseBotMetadata` validates them when present (ISO 8601 strings that `Date.parse` accepts; identity non-empty string ≤128 chars, no control characters) and accepts their absence; `schemaVersion` stays 1. Invalid stored values are a `persistence` metadata error like any other corrupt field.
- [ ] R2 — A harness helper `captureSessionFacts(context, url)` returns `{expiresAt?}` = earliest `expires` (> 0) among httpOnly cookies from `context.cookies(url)`, as RFC 3339 UTC; session cookies (`expires === -1`) and non-httpOnly cookies are ignored; cookie names/values never leave it.
- [ ] R3 — Generic `loginBot` calls `captureSessionFacts` on its context after confirmation and writes `lastLoginAt` (now) and `expiresAt` into the staged `bot.json` before promotion; adapter `runAdapterLogin` writes `lastLoginAt` plus `expiresAt`/`identity` from the verdict line when valid (invalid values are dropped, not fatal).
- [ ] R4 — `runProfileCli` bot-mode login (`--url` given) runs through `withProfilePage({profileDir, headless:false, url, isAuthenticated, timeoutMs, launcher})`; its callback calls `captureSessionFacts(context, config.homeUrl)` and, when configured, `ChannelBrowserConfig.readIdentity?(page)`; the verdict line becomes `{status:'verified', profileDir, defaultUrl, expiresAt?, identity?}`. A `readIdentity` throw or null omits `identity` and never fails the login. Non-bot `login` (no `--url`) keeps `loginWithProfile` unchanged. Existing verdicts without the new keys keep parsing.
- [ ] R5 — `kk bot list` prints `name, cached, defaultUrl, identity, lastLogin, expires` tab-separated; missing values print `unknown`; metadata-bearing rows without `lastLoginAt` fall back to the `bot.json` mtime via `lstat`; still no browser launch and no cookie DB read.
- [ ] R6 — `docs/04_DESIGN.md` §1.12 list row and `runProfileCli` verdict description updated in the same commit.

Out of scope: any per-channel `readIdentity` implementation (hook only; channels opt in later), `kk bot list --json`, refreshing facts outside a login.

### Acceptance Criteria

- [ ] AC1 — Login records when the session was saved
- [ ] AC2 — Login records an estimated session expiry
- [ ] AC3 — Adapter-reported account identity is saved
- [ ] AC4 — Bot list shows identity, last login and expiry columns

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T03:17:34.345Z

- Closed (2026-10-16): adapter-child facts come from `withProfilePage` in bot mode instead of wrapping/monkey-patching the launcher's `context.close` — same launch, documented callback-before-close guarantee.
- Closed: no channel ships `readIdentity` in this task; identity column prints `unknown` until a channel opts in (owner: per-channel follow-up, not A23 scope).
- Closed: invalid stored fact values fail metadata parsing (strict, same as other fields); invalid verdict values are dropped at parse time so they are never stored.

### Design

- Approach: capture facts once at login (both paths) and persist them in `bot.json`; list only reads metadata — keeps the A22 browser/cookie-DB-free list contract.
- Adapter child seam: in `runProfileCli` bot mode replace `loginWithProfile` with `withProfilePage` (same package, already imported) so the callback can read cookies/page after the readiness predicate passes and before close. Non-bot `login` path stays on `loginWithProfile`.
- Rejected: reading the Chromium Cookies SQLite `expires_utc` from `bot list` (breaks the frozen contract, Keychain-encrypted); a second headless launch after `loginWithProfile` (extra launch, fails on WAF-451 headless channels); patching `context.close` on the launcher's returned context (hidden coupling to upstream internals).
- Anti-patterns: do not print or persist cookie names/values; do not write facts on refused/cancelled login; do not add `readIdentity` implementations to channel plugins here.
- Invariants: additive optional fields, schemaVersion 1; failed/cancelled login writes nothing; columns appended after the existing three; browser.ts module doc amended (expiry read only).
- Frozen names: `BotMetadata.lastLoginAt|expiresAt|identity`; `captureSessionFacts(context: BrowserContext, url: string): Promise<{ expiresAt?: string }>`; `ChannelBrowserConfig.readIdentity?: (page: Page) => Promise<string | null>`; verdict `{status, profileDir, defaultUrl, expiresAt?, identity?}`; `parseAdapterVerdict` returns `{defaultUrl, expiresAt?, identity?} | null`.
- Handoff to 0306: 0306 reuses `missingBotProfile`/lease/launcher seams only; it does not depend on the new metadata fields, but edits the same files (browser.ts, commands/bot.ts, 04_DESIGN §1.12) so it lands after this task.
- Files: packages/publish-harness/src/{bot,browser}.ts and their tests; apps/cli/src/commands/bot.ts and its tests; docs/04_DESIGN.md; docs/design/kk-bot-session-facts-exec.md (seam wording).

### Plan

1. (R1) Write failing parser cases first: legacy, all-three, partial, invalid date, overlong/control-char identity. Extend `BotMetadata`/`parseBotMetadata`.
2. (R2) Add `captureSessionFacts`; unit cases with a fake context: httpOnly persistent (earliest wins), session-only, non-httpOnly only → no `expiresAt`.
3. (R3) Generic `loginBot`: capture before commit; assert `lastLoginAt`/`expiresAt` in staged metadata and nothing on unconfirmed login.
4. (R4) `runProfileCli` bot mode → `withProfilePage`; verdict carries facts; `readIdentity` throw/null omits identity; non-bot login unchanged. Extend `parseAdapterVerdict`/`runAdapterLogin` (invalid values dropped).
5. (R5) `listBots` mtime fallback via `lstat`; CLI row format; CLI list tests for full/legacy/corrupt rows.
6. (R6) E2E: local HTTP server sets httpOnly persistent + session + non-httpOnly cookies; generic login with fake confirm in an isolated profile root; `kk bot list` shows the expected expiry. Update 04_DESIGN §1.12 and the design satellite; run `bun run lint`, `bun run test`, `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
