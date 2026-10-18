---
schema_version: 1
name: Record bot session facts at login and show them in kk bot list
status: done
template: feature-impl
created_at: 2026-10-17T02:59:58.070Z
updated_at: "2026-10-18T18:02:16.551Z"
feature_id: A23
priority: P2
tags:
  - bot
  - cli
  - publish-harness

estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0305-verdict.json
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

- [x] R1 — `BotMetadata` gains optional `lastLoginAt`, `expiresAt`, `identity`; `parseBotMetadata` validates them when present (ISO 8601 strings that `Date.parse` accepts; identity non-empty string ≤128 chars, no control characters) and accepts their absence; `schemaVersion` stays 1. Invalid stored values are a `persistence` metadata error like any other corrupt field.
- [x] R2 — A harness helper `captureSessionFacts(context, url)` returns `{expiresAt?}` = earliest `expires` (> 0) among httpOnly cookies from `context.cookies(url)`, as RFC 3339 UTC; session cookies (`expires === -1`) and non-httpOnly cookies are ignored; cookie names/values never leave it.
- [x] R3 — Generic `loginBot` calls `captureSessionFacts` on its context after confirmation and writes `lastLoginAt` (now) and `expiresAt` into the staged `bot.json` before promotion; adapter `runAdapterLogin` writes `lastLoginAt` plus `expiresAt`/`identity` from the verdict line when valid (invalid values are dropped, not fatal).
- [x] R4 — `runProfileCli` bot-mode login (`--url` given) runs through `withProfilePage({profileDir, headless:false, url, isAuthenticated, timeoutMs, launcher})`; its callback calls `captureSessionFacts(context, config.homeUrl)` and, when configured, `ChannelBrowserConfig.readIdentity?(page)`; the verdict line becomes `{status:'verified', profileDir, defaultUrl, expiresAt?, identity?}`. A `readIdentity` throw or null omits `identity` and never fails the login. Non-bot `login` (no `--url`) keeps `loginWithProfile` unchanged. Existing verdicts without the new keys keep parsing.
- [x] R5 — `kk bot list` prints `name, cached, defaultUrl, identity, lastLogin, expires` tab-separated; missing values print `unknown`; metadata-bearing rows without `lastLoginAt` fall back to the `bot.json` mtime via `lstat`; still no browser launch and no cookie DB read.
- [x] R6 — `docs/04_DESIGN.md` §1.12 list row and `runProfileCli` verdict description updated in the same commit.

Out of scope: any per-channel `readIdentity` implementation (hook only; channels opt in later), `kk bot list --json`, refreshing facts outside a login.

### Acceptance Criteria

- [x] AC1 — Login records when the session was saved
- [x] AC2 — Login records an estimated session expiry
- [x] AC3 — Adapter-reported account identity is saved
- [x] AC4 — Bot list shows identity, last login and expiry columns

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

Both login paths capture the facts once, at promotion, and persist them in `bot.json`; `bot list` only
reads metadata, so the A22 browser-free/cookie-DB-free list contract holds. All three fields are
optional and additive, so `schemaVersion` stays 1 and existing metadata keeps parsing.

| Change | Where | Why |
| --- | --- | --- |
| `BotMetadata` gains optional `lastLoginAt`/`expiresAt`/`identity` | packages/publish-harness/src/bot.ts:37 | R1 additive fields; legacy records keep parsing |
| `isSessionFactDate` (ISO 8601 + `Date.parse`) / `isSessionFactIdentity` (non-empty, ≤128, no control chars) / lenient normalizers | packages/publish-harness/src/bot.ts:55 | R1 strict stored shape; R3/Q&A: invalid verdict values are dropped, never stored |
| `parseBotMetadata` validates the three facts when present, `persistence` error naming the field | packages/publish-harness/src/bot.ts:201 | R1: a corrupt stored value fails like any other corrupt field |
| `BotInventoryEntry` gains `lastLoginAt`/`expiresAt`/`identity` (nullable) | packages/publish-harness/src/bot.ts:305 | R5 list needs the facts without re-reading metadata |
| `listBots` fills the facts; `bot.json` mtime (`lstat`) stands in for a missing `lastLoginAt` | packages/publish-harness/src/bot.ts:367 | R5: metadata is only rewritten by a successful login, so mtime is the save time |
| `metadataMtime` reads the mtime through the existing no-follow `lstat` | packages/publish-harness/src/bot.ts:443 | R5 seam without a FileSystem interface change |
| `PathStat` exposes `mtimeMs` | packages/publish-harness/src/bot-fs.ts:22 | the mtime fallback needs it; containment facts unchanged |
| `ChannelBrowserConfig.readIdentity?(page)` hook | packages/publish-harness/src/browser.ts:86 | R4/Q&A: hook only, no channel implements it in this task |
| `captureSessionFacts(context, url)` — earliest `expires > 0` among httpOnly cookies, RFC 3339 UTC; names/values never leave | packages/publish-harness/src/browser.ts:900 | R2 (AC2) |
| `readIdentityOrUndefined` — throw/null/scrubbed-empty omits identity | packages/publish-harness/src/browser.ts:916 | R4: identity trouble never fails a verified login |
| bot-mode `login` runs through `withProfilePage` (callback after the readiness predicate, before the guaranteed close) and emits `{status, profileDir, defaultUrl, expiresAt?, identity?}`; non-bot login keeps `loginWithProfile` | packages/publish-harness/src/browser.ts:530 | R4/Q&A: same single headed launch, no upstream change |
| generic `loginBot` captures facts on its confirmed context before promotion and writes `lastLoginAt` + `expiresAt` | packages/publish-harness/src/browser.ts:1055 | R3 (AC1/AC2); a refused/cancelled login still writes nothing |
| `parseAdapterVerdict` returns `{defaultUrl, expiresAt?, identity?}`, sanitizing and dropping unusable facts | packages/publish-harness/src/browser.ts:1152 | R3/R4: strict parse of the line, lenient verdict (Q&A) |
| adapter `runAdapterLogin` persists `lastLoginAt` + verdict `expiresAt`/`identity` | packages/publish-harness/src/browser.ts:1140 | R3 (AC3) |
| `kk bot list` prints `name, cached, defaultUrl, identity, lastLogin, expires`, `unknown` when absent | apps/cli/src/commands/bot.ts:78 | R5 (AC4): columns appended after the A22 three |
| `list` description names the fact columns | apps/cli/src/commands/bot.ts:155 | R5 help surface |
| §1.12 list row/verdict/metadata contract updated | docs/04_DESIGN.md:112 | R6: shipped surface text follows the code |
| §1.12 `bot` section (row shape, login facts, `withProfilePage` seam) | docs/04_DESIGN.md:977 | R6 |
| design satellite: `captureSessionFacts` returns `{expiresAt?}` only | docs/design/kk-bot-session-facts-exec.md:33 | seam wording matches the frozen signature |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Optional `lastLoginAt`/`expiresAt`/`identity` with ISO 8601 + identity guards at `packages/publish-harness/src/bot.ts:37-44` (re-read this run); schemaVersion stays 1. |
| R2 | MET | `captureSessionFacts` keeps earliest persistent httpOnly cookie expiry, ignores session/non-httpOnly cookies at `packages/publish-harness/src/browser.ts:900` (re-read this run). |
| R3 | MET | Generic login captures before promotion; adapter path writes save time + sanitized verdict facts (`packages/publish-harness/src/browser.ts:1055-1066`, `packages/publish-harness/src/browser.ts:1124-1141`). |
| R4 | MET | Bot mode runs through `withProfilePage` and emits the fact-bearing verdict (`packages/publish-harness/src/browser.ts:515-566`); legacy verdicts without the new keys still parse. |
| R5 | MET | Six tab-separated columns with `unknown` fallbacks at `apps/cli/src/commands/bot.ts:73-84` (re-read this run); mtime fallback via lstat. |
| R6 | MET | `docs/04_DESIGN.md:1023-1025` (list columns), `docs/04_DESIGN.md:1094-1096` (metadata contract), `docs/04_DESIGN.md:1268`/`docs/04_DESIGN.md:1274` (harness API rows) — re-read this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Login records when the session was saved | MET | test | 152 pass / 0 fail (bun test, this run: bot.test.ts + browser.test.ts + bot-session.test.ts + commands/bot.test.ts); generic stamp `packages/publish-harness/src/browser.ts:1061`. |
| AC2 — Login records an estimated session expiry | MET | test | Same fresh run; expiry capture `packages/publish-harness/src/browser.ts:900-913`. |
| AC3 — Adapter-reported account identity is saved | MET | test | Same fresh run; identity hook + sanitizing + persistence (`packages/publish-harness/src/browser.ts:86`, `packages/publish-harness/src/browser.ts:1136-1141`). |
| AC4 — Bot list shows identity, last login and expiry columns | MET | test | Same fresh run; spawned-CLI list test `apps/cli/tests/commands/bot.test.ts:670-720`, row format `apps/cli/src/commands/bot.ts:73-84`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 0305 (feature A23)
**Scope:** `git diff HEAD` on `sp/runall-a23-083b` — 11 files, +799/−49 (harness src 3, CLI src 1, tests 4, docs 3); no untracked files.
**Dimensions:** functional traceability (R1–R6, AC1–AC4), SECUA (security, efficiency, correctness, usability), architecture.
**Fresh evidence run by this review:** `bun test packages/publish-harness/tests/{bot,bot-session,browser}.test.ts apps/cli/tests/commands/bot.test.ts` → 135 pass / 0 fail / 535 expect() calls across 4 files; `tsc --noEmit` in `packages/publish-harness` and `apps/cli` → both clean; live `kk bot list` from `apps/cli/src/index.ts` against an isolated `HOME` (pasted in R5 below). The full quality gate was green on this tree before the review and was **not** re-run: `.spur/run/0305-check-receipt.json`, `bun run spur-check` → PASS, digest `sha256:f92e97bd5075e2733af3710bed1f1e8a5e49e52e9803e7320ad973a2a9bc663c`.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | functional coverage | Two channel adapters emit their own bot-mode verdict and do not carry the new keys, so `kk bot login` for those bots records `lastLoginAt` only and `kk bot list` prints `unknown` for expiry/identity until the channel opts in. Out of R4 scope (R4 names `runProfileCli`); the parent parser already accepts the keys, so the remaining work lives inside each plugin. | `plugins/publishings/wechatmp-pub/src/profile-check.ts:76-79`; `plugins/publishings/xhs-pub/src/profile-check.ts:158-165`; consumer `packages/publish-harness/src/browser.ts:1189-1196` | ACCEPTED |
| 2 | P4 (advisory) | usability | `readIdentity` rejection is swallowed with no diagnostic, so a channel hook that always throws is invisible — the column silently stays `unknown`. Deliberate per R4 (identity trouble must never fail a verified login); a one-line stderr note would make the hook debuggable. | `packages/publish-harness/src/browser.ts:916-926` | ACCEPTED |
| 3 | P4 (advisory) | docs | The A22 satellite still lists the minimal `bot.json` as `schemaVersion/defaultUrl/pluginName/authenticationEvidence` without the now-optional facts. R6 only mandated `docs/04_DESIGN.md` §1.12 (updated); this satellite is the stale copy. | `docs/design/kk-noun-verb-bots.md:67` vs `docs/04_DESIGN.md:1032` | ACCEPTED |
| 4 | P4 (advisory) | architecture | `browser.ts` is now ~1,450 lines and holds lifecycle, profile-CLI, editor helpers, session-fact capture and verdict parsing; 0306 adds `execBot` to the same file. No refactor warranted for 0305 (the new helper itself is narrow and deep) — a signal to split lifecycle concerns on the next pass rather than stack a third. | `packages/publish-harness/src/browser.ts:900-926` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — optional `lastLoginAt`/`expiresAt`/`identity`, validated when present, absence accepted, `schemaVersion` 1, corrupt value = `persistence` error | MET | `packages/publish-harness/src/bot.ts:37-44` (fields), `:55-66` (date/identity guards: ISO shape + `Date.parse`, ≤128, `\p{Cc}`), `:199-220` (parser rejects each field by name with `BotError('persistence')`); tests `packages/publish-harness/tests/bot.test.ts:116-215` (legacy, all-three, partial, invalid date, empty/overlong/control-char identity, 128 inclusive) |
| R2 — `captureSessionFacts(context, url)` = earliest `expires > 0` among httpOnly cookies, RFC 3339 UTC, session and non-httpOnly ignored, names/values never leave | MET | `packages/publish-harness/src/browser.ts:900-913` (`!cookie.httpOnly \|\| cookie.expires <= 0` skipped, `toISOString()` = RFC 3339 UTC, jar errors → `{}`); tests `packages/publish-harness/tests/browser.test.ts:255-305` (earliest wins, `-1`/`0`/non-httpOnly → `{}`, unreadable jar → `{}`) |
| R3 — generic `loginBot` captures after confirmation and writes `lastLoginAt`/`expiresAt` into staged `bot.json`; adapter path writes `lastLoginAt` + valid verdict facts, invalid dropped | MET | `packages/publish-harness/src/browser.ts:1055-1063` (capture after `confirm`, before `transaction.commit`), `:1124-1141` (adapter verdict → metadata), `:1165-1198` (`parseAdapterVerdict` sanitizes and drops); tests `packages/publish-harness/tests/bot-session.test.ts:236-262` (expiry recorded, no cookie name/value on disk), `:263-282` (refused login writes nothing and never reads the jar), `:606-629` (identity+expiry stored, ESC stripped), `:630-651` (invalid dropped, login still verifies) |
| R4 — `--url` login runs through `withProfilePage({profileDir, headless:false, url, isAuthenticated, timeoutMs, launcher})`, callback calls `captureSessionFacts(context, config.homeUrl)` + optional `readIdentity`, verdict gains `expiresAt?`/`identity?`, identity throw/null omits and never fails, non-bot login unchanged, legacy verdicts parse | MET | `packages/publish-harness/src/browser.ts:530-566` (bot-mode seam + verdict), `:509-528` (non-bot `loginWithProfile` path), `:86` (`readIdentity?` hook), `:916-926` (throw/null → omit); tests `packages/publish-harness/tests/browser.test.ts:394-427` (one headed launch, facts in verdict, no `SEKRET` on stdout), `:429-459` (null and throwing hook both omit identity, exit 0), `:461-478` (non-bot: no verdict line, no cookie read); `packages/publish-harness/tests/bot-session.test.ts:653-672` (legacy 0277 verdict still parses). Callback value + guaranteed close are upstream guarantees: `@gobing-ai/ts-browser-automation@0.5.28` `node_modules/.bun/@gobing-ai+ts-browser-automation@0.5.28+12771b8d41c51331/node_modules/@gobing-ai/ts-browser-automation/dist/operations.js` line 66-69 |
| R5 — `kk bot list` prints `name, cached, defaultUrl, identity, lastLogin, expires`, `unknown` when absent, `bot.json` mtime fallback via `lstat`, still no browser launch / cookie-DB read | MET | `packages/publish-harness/src/bot.ts:367-369` (facts + mtime fallback), `:443-448` (`metadataMtime` via no-follow `lstat`), `packages/publish-harness/src/bot-fs.ts:22` (`mtimeMs` on `PathStat`), `apps/cli/src/commands/bot.ts:73-84` (six columns, appended after the A22 three), `:155` (help string); tests `packages/publish-harness/tests/bot.test.ts:353-388`, `apps/cli/tests/commands/bot.test.ts:375-424`. Live, this review: `full⇥cached⇥https://x.example.com/home⇥alice⇥2026-10-17T02:00:00.000Z⇥2026-11-16T02:00:00.000Z`, `legacy⇥cached⇥unknown⇥unknown⇥unknown⇥unknown`, and a back-dated `bot.json` without `lastLoginAt` printed exactly its mtime (`2026-10-15T16:00:00.000Z`, matching `date -r`); corrupt-JSON / control-char-identity / `expiresAt: "tomorrow"` rows printed `unknown` and exited 0 |
| R6 — `docs/04_DESIGN.md` §1.12 list row + `runProfileCli` verdict description updated in the same change | MET | `docs/04_DESIGN.md:112` (inventory row), `:977` (§1.12 heading), `:987-1000` (column contract + facts bullet), `:1008-1014` (both login paths + `withProfilePage` seam), `:1032` (metadata contract); satellite `docs/design/kk-bot-session-facts-exec.md:33-35` (helper returns `{expiresAt?}` only); ADR amendment `docs/00_ADR.md:1425-1427` |
| AC1 — Login records when the session was saved | MET | `packages/publish-harness/src/browser.ts:1061` and `:1137`; asserted `Date.now() - Date.parse(lastLoginAt) < 60_000` and ISO round-trip in `packages/publish-harness/tests/bot-session.test.ts:203-208` and `:606-620` |
| AC2 — Login records an estimated session expiry | MET | `packages/publish-harness/src/browser.ts:900-913` → `packages/publish-harness/src/bot.ts:367`; adapter path via `packages/publish-harness/src/browser.ts:1189-1196`; tests `packages/publish-harness/tests/bot-session.test.ts:236-262`, `:630-651`. Documented as an estimate, never a readiness claim (`docs/04_DESIGN.md:998-1003`). Channel plugins that print their own verdict do not report it yet — finding 1 |
| AC3 — Adapter-reported account identity is saved | MET | `packages/publish-harness/src/browser.ts:86` (hook), `:530-566` (bot-mode callback → verdict), `:1116-1141` (adapter login persists identity), `packages/publish-harness/src/bot.ts:74-82` (trim/strip/cap before storage); tests `packages/publish-harness/tests/browser.test.ts:394-427`, `packages/publish-harness/tests/bot-session.test.ts:606-629`. Closed Q&A: no channel ships `readIdentity`, so the column prints `unknown` until one opts in — seam-level AC, not a per-channel delivery |
| AC4 — Bot list shows identity, last login and expiry columns | MET | `apps/cli/src/commands/bot.ts:73-84`; tests `apps/cli/tests/commands/bot.test.ts:231-254` (unit row format), `:375-424` (full/partial/legacy/corrupt e2e rows); live `kk bot list` run pasted under R5 |

##### SECUA

- **Security.** `captureSessionFacts` returns a date string and nothing else — no cookie name or value can leave it (`packages/publish-harness/src/browser.ts:900-913`), and both the metadata file and stdout are asserted cookie-free (`packages/publish-harness/tests/bot-session.test.ts:255-260`, `packages/publish-harness/tests/browser.test.ts:421-426`). `identity` is site-controlled text that reaches a terminal: `normalizeSessionIdentity` strips `\p{Cc}` (so no ESC/newline/tab column break), trims and caps at 128 before storage (`packages/publish-harness/src/bot.ts:74-82`), and the stored-shape guard rejects any control character on read (`:60-66`) — verified live, a stored `ali\u001bce` row degrades to `unknown` instead of emitting the escape. Metadata stays owner-only 0600 (`packages/publish-harness/src/browser.ts:1348-1351`). The bot-mode seam reuses the same package helper with the same single headed launch (`packages/publish-harness/tests/browser.test.ts:414-417` asserts one request), so no new attack surface or extra browser process. `readIdentity` failures are swallowed rather than printed, so site error text never reaches the operator's terminal.
- **Efficiency.** One `context.cookies(url)` call per successful login and at most one extra `lstat` per metadata-bearing pre-0305 profile in `listBots` (`packages/publish-harness/src/bot.ts:367`, `:443`); `lastLoginAt ?? …` short-circuits the stat entirely for 0305+ records. No browser launch, no cookie-DB read, no extra dependency.
- **Correctness.** Capture happens strictly after confirmation and before `transaction.commit` (`packages/publish-harness/src/browser.ts:1055-1066`), so a refused/cancelled login writes nothing and previous facts survive (test `packages/publish-harness/tests/bot-session.test.ts:263-282`). Stored strictness vs verdict leniency is the closed Q&A decision and is tested on both sides (`packages/publish-harness/tests/bot.test.ts:157-215`). `withProfilePage` returns the callback value and closes in `finally`, so the verdict is still printed after the close and a `readIdentity`/jar failure cannot turn a verified login into a failure.
- **Usability.** All three fact columns fall back to `unknown`; help text names them (`apps/cli/src/commands/bot.ts:155`); dates print as RFC 3339 UTC so they sort lexicographically; `bot.json` remains parseable by pre-0305 readers because every field is additive.

##### Architecture

`captureSessionFacts` is a genuinely deep helper: one narrow input pair (`BrowserContext`, url), one optional output, no ambient state, testable with a four-line fake context — the tests do exactly that, no launcher needed (`packages/publish-harness/tests/browser.test.ts:255-305`). The bot-mode seam got *deeper* by deletion-of-risk: reusing the package's `withProfilePage` instead of monkey-patching `context.close` or firing a second headless launch removes the coupling both rejected alternatives would have created. Identity stays a hook (`readIdentity?`) rather than a per-channel implementation, so no channel is coupled to this feature and the metadata shape is validated in one place (`bot.ts`) while the verdict sanitizers are shared by both login paths. The one structural warning is finding 4: `browser.ts` keeps accreting lifecycle concerns and 0306 will add `execBot` to the same file — no refactor now, but the next feature in this area should split rather than stack.

##### Confidence — derived, not asserted (advisory; no gate reads it — F511/task 1207)

The level is a consequence of the verification column, not a separate claim: each row states what was actually executed vs. only read, so a reader can re-check the derivation and reach the same grade.

| Dimension | How it was verified | Resulting confidence |
|---|---|---|
| R1 — metadata guards + parser | Read the fields/guards/parser (`packages/publish-harness/src/bot.ts:37-44`, `:55-66`, `:199-220`); executed all 6 parser tests incl. every rejection branch (`packages/publish-harness/tests/bot.test.ts:116-215`) | HIGH — executed |
| R2 — `captureSessionFacts` | Read the helper (`packages/publish-harness/src/browser.ts:900-913`); executed its 3 unit cases plus both consumers (`packages/publish-harness/tests/browser.test.ts:255-305`, `packages/publish-harness/tests/bot-session.test.ts:236-262`) | HIGH — executed |
| R3 — both login write paths | Read placement (capture after `confirm`, before `transaction.commit` — `packages/publish-harness/src/browser.ts:1043-1066`, `:1124-1141`); executed generic + adapter + refusal-writes-nothing cases (`packages/publish-harness/tests/bot-session.test.ts:236-282`, `:606-672`) | HIGH — executed |
| R4 — bot-mode `withProfilePage` seam | Read the call site (`packages/publish-harness/src/browser.ts:530-566`) and upstream `@gobing-ai/ts-browser-automation@0.5.28` `dist/operations.js` line 51-70 (callback return value, guaranteed `finally` close); executed 3 `runProfileCli` cases asserting one launch, fact-bearing verdict, throw/null hook, legacy verdict (`packages/publish-harness/tests/browser.test.ts:394-478`, `packages/publish-harness/tests/bot-session.test.ts:653-672`) | MEDIUM — fake launcher only, no real Chromium launch |
| R5 — list columns + mtime fallback | Executed live `kk bot list` over three profile shapes (stored facts, back-dated `bot.json` matching `date -r`, corrupt metadata) plus two test files (`packages/publish-harness/tests/bot.test.ts:353-388`, `apps/cli/tests/commands/bot.test.ts:231-254`, `:375-424`) | HIGH — executed end-to-end |
| R6 — docs follow the shipped surface | Read all four §1.12 sites plus satellite and ADR amendment against the code (`docs/04_DESIGN.md:112`, `:977`, `:987-1014`, `:1032`; `docs/design/kk-bot-session-facts-exec.md:33-35`; `docs/00_ADR.md:1425-1427`); the one stale copy is finding 3 | HIGH — read + diffed, no execution needed |
| AC2 on a live site | Not executed: no live browser login was run in this review | LOW — estimate unverified against real cookies |
| AC3 on a real bot | Not executed: no in-tree channel ships `readIdentity` | LOW — seam only; column prints `unknown` today |
| Type/compile surface of the change | Executed `tsc --noEmit` in both touched packages | HIGH — executed |

**Overall: HIGH** for everything the diff can assert offline (R1, R2, R3, R5, R6, AC1, AC4 — executed), **MEDIUM** for the bot-mode browser seam (proven against a fake launcher and the package's own source, not a real launch), **LOW** for live-site `expiresAt` accuracy and for identity on any real channel. Capped by two facts: no live-browser run, and two channel plugins emitting their own verdicts without the new keys (finding 1).

##### Residual risk

- **No live-browser verification.** `expiresAt` is proven against fake cookie jars plus the offline flows only. Real sites' sliding or server-side expiry, and auth cookies scoped to a path other than `homeUrl`/`defaultUrl` (`context.cookies(url)` filters by path), can make the estimate optimistic or absent. This is by design ("an estimate, never a readiness claim") and is documented, but it is unverified against a live login.
- **No in-tree `identity` producer.** AC3 is satisfied at the seam; every real bot prints `unknown` in the identity column until a channel ships `readIdentity` or extends its own verdict (finding 1, owner: per-channel follow-up).
- **mtime fallback is a proxy.** Verified live for a plain `bot.json`; the "only a successful login rewrites metadata" invariant holds for in-tree transactions (rollback renames the backup back, preserving mtime; promotion writes a fresh file), but a profile copied by hand outside `kk` would report the copy time.
- Gate receipt digest `sha256:f92e97bd…663c` was produced before this review and not re-run; the review re-ran the four affected test files plus both package typechecks instead.

**Next:** proceed to verify/approve; carry the per-channel `readIdentity` + verdict-fact follow-up (finding 1) as A23 follow-up scope, not 0305.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T03:57:55.320Z todo → wip (system)
- 2026-10-17T04:26:15.477Z wip → testing (system)
- 2026-10-17T04:26:27.163Z testing → done (system)

