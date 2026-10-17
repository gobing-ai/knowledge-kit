---
schema_version: 1
name: Add kk bot exec for one authenticated curl-style request
status: todo
template: feature-impl
created_at: 2026-10-17T02:59:58.073Z
updated_at: "2026-10-17T03:18:36.405Z"
feature_id: A23
priority: P2
tags:
  - bot
  - cli
  - publish-harness

dependencies: ["0305"]
estimate_hours: 5
---

## 0306. Add kk bot exec for one authenticated curl-style request

### Background

Implements: R5 — Exec sends a request with the cached cookie session; R6 — Exec accepts a curl option subset; R7 — Exec stays within the normal cookie-session case.

Operator ask (run 3b6667b1-8505-4736-8402-a2e006ce6a20): a new bot command that reuses the cached credential to access a URL, with a simplified curl option subset, for normal scenarios only. Design: docs/design/kk-bot-session-facts-exec.md §kk bot exec.

**Refine corrections (2026-10-16)**

- "validates name/URL" was unspecified → `normalizeBotDefaultUrl` (packages/publish-harness/src/bot.ts:68-82) strips query/fragment, which would break exec targets → exec checks http(s) + no userinfo with the same rules but sends the URL as given (query kept, fragment dropped by URL semantics); `normalizeBotDefaultUrl` is not used.
- "`-i` prints `HTTP/<ver> <status>`" → Playwright 1.55.0 `APIResponse` exposes `status()`, `statusText()`, `headersArray()`, `body()` but no HTTP version → status line is `HTTP <status> <statusText>`.
- "`timeout` from `-m`" left the no-`-m` case open → `APIRequestContext.fetch` defaults to 30000 ms (playwright-core types.d.ts:17720-17724) → without `-m` the 30 s default applies (bounded lease hold), documented.
- "errors never include the URL" → Playwright fetch errors embed the request URL and a call log; `failBot` (apps/cli/src/commands/bot.ts:55-60) prints `error.message` verbatim → `execBot` wraps every fetch/launch failure in `BotError('browser', …)` with a URL-free detail (error code/class only).
- "body bytes to stdout" → `consoleOutput.write` (apps/cli/src/output.ts:20) is a line-oriented string writer → body/headers go through `process.stdout.write(Buffer)` with no added newline.
- "missing profile → login guidance" → a persistent launch on a missing dir would create a fresh empty profile → `execBot` checks `lstat(profileDir)` before the lease and throws `missingBotProfile(name, false)` (browser.ts:1198); no `bot.json` is required (legacy profiles may exec).

### Requirements

- [ ] R1 — `kk bot exec <name> <url>` registers as a visible leaf with options `-X/--request`, repeatable `-H/--header`, `-d/--data` (literal or `@file`), `-o/--output`, `-i/--include`, `-L/--location`, `-f/--fail`, `-m/--max-time <seconds>`; any other option or a malformed value (header without `:`, non-positive `-m`) is a usage error (exit 2).
- [ ] R2 — Harness `execBot(name, request, options)` validates the name and the URL (http/https, no userinfo; query kept), requires the profile directory to exist (else `missingBotProfile` login guidance, exit 1), acquires the shared lease (busy → refused, no wait), launches headless through `createKkBrowserLauncher` with the borrowed lease, calls `context.request.fetch` with `failOnStatusCode:false`, `maxRedirects` 0 unless `-L`, and `timeout` = `-m`×1000 or Playwright's 30 s default; reads the body, closes the context, then releases the lease.
- [ ] R3 — Method defaults to GET, or POST when `-d` is present; `@file` is read raw (unreadable file → exit 1); header lines split on the first colon and are trimmed.
- [ ] R4 — Output: body bytes to stdout via `process.stdout.write` or to the `-o` file; `-i` prefixes `HTTP <status> <statusText>` and one `Name: value` line per response header, then a blank line, with `Set-Cookie` values printed as `<redacted>`; exit 0 for any HTTP response, 1 for transport failure/timeout/busy/missing profile or `-f` with status ≥ 400 (body suppressed), 2 for usage.
- [ ] R5 — Errors print `kk.bot.failed: <detail>` and never include the request URL, cookie values or response bodies (Playwright errors are wrapped, not passed through); only profile cookies are attached (no storage-state reinjection, no storage tokens).
- [ ] R6 — Command-tree drift test (apps/cli/tests/main.test.ts visible-leaf list), `docs/04_DESIGN.md` §1.12 and the bot group description include `exec` in the same commit.

Out of scope: `-F`, `-b/-c`, `-u`, `-x`, `--retry`, `-d @-`, `-k`, `--compressed`, streaming, adapter special state, headed fallback for WAF-451 channels.

### Acceptance Criteria

- [ ] AC1 — Exec sends a request with the cached cookie session
- [ ] AC2 — Exec accepts a curl option subset
- [ ] AC3 — Exec stays within the normal cookie-session case

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T03:18:21.977Z

- Closed (2026-10-16): no `-m` → Playwright's 30 s request timeout (bounded lease hold) rather than curl's unlimited default.
- Closed: `-i` status line is `HTTP <status> <statusText>`; Playwright does not expose the protocol version.
- Closed: exec does not require `bot.json`; a profile directory is enough. It never creates a profile.
- Closed: unreadable `-d @file` is an operational failure (exit 1), not usage.

### Design

- Approach: headless persistent context + `BrowserContext.request` (shares the profile cookie jar), so browser cookie rules choose what attaches and nothing is exported from the profile. Launch pattern copies `openBot` (browser.ts:1101): lease → `createKkBrowserLauncher(undefined, {lease, physicalProfileDir: profileDir}, {leaseRoot, fileSystem})` → `launch({profileDir, headless: true})`.
- Rejected: exporting a Netscape cookie jar for real curl (credential leak to disk/argv); decrypting the Cookies DB directly (Keychain-bound, brittle); reinjecting adapter storage-state (outside the normal case); routing through the adapter child (exec is generic; adapters stay login/open only).
- Anti-patterns: do not use `normalizeBotDefaultUrl` (drops the query); do not pass Playwright error messages through (they carry the URL); do not write body via `consoleOutput.write` (adds newline, string-only); do not launch on a missing profile dir.
- Invariants: one request per invocation; lease held for the whole launch; URL/cookies never printed; full body buffered (`ponytail:` ceiling — stream to `-o` if large downloads matter).
- Frozen names: `execBot(name: string, request: BotExecRequest, options?: BotSessionOptions): Promise<BotExecResponse>`; `interface BotExecRequest { url: string; method: string; headers: Record<string, string>; data?: Buffer; followRedirects: boolean; timeoutMs?: number }`; `interface BotExecResponse { status: number; statusText: string; headers: Array<{ name: string; value: string }>; body: Buffer }`. Option parsing/output/exit mapping live in `apps/cli/src/commands/bot.ts` (`botExecAction`); `-f` maps to a `BotError('browser', 'HTTP <status>')` thrown by the CLI after the harness returns.
- Dependencies: assumes 0305 has landed its edits to browser.ts, commands/bot.ts and 04_DESIGN §1.12 (shared files, no API reliance). Leaves nothing for dependents.
- Files: packages/publish-harness/src/browser.ts (+ tests); apps/cli/src/commands/bot.ts (+ tests); apps/cli/tests/main.test.ts; docs/04_DESIGN.md.

### Plan

1. (R1–R5) Write the failure list first as tests: unsafe name, bad scheme, userinfo URL, missing profile dir, busy lease, timeout, transport error message has no URL, 4xx with/without `-f`, 3xx with/without `-L`, unknown option, header without colon, unreadable `@file`.
2. (R2, R5) Implement `execBot` in the harness reusing the `openBot` lease/launcher seams; wrap fetch/launch failures URL-free.
3. (R1, R3, R4) Register `bot exec` with Commander options; parse headers/data; write output via `process.stdout.write`/`-o`; `-i` header block with `Set-Cookie` redaction; `-f` exit mapping.
4. E2E against a local HTTP server: set a cookie into an isolated test profile, echo endpoint asserts cookie/method/headers/body attached; redirect and status endpoints; `-i` output shows `<redacted>`.
5. (R6) Update drift test visible-leaf list, 04_DESIGN §1.12; run `bun run lint`, `bun run test`, `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
