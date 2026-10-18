---
schema_version: 1
name: Add kk bot exec for one authenticated curl-style request
status: done
template: feature-impl
created_at: 2026-10-17T02:59:58.073Z
updated_at: "2026-10-18T18:03:03.143Z"
feature_id: A23
priority: P2
tags:
  - bot
  - cli
  - publish-harness

dependencies: ["0305"]
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0306-verdict.json
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

- [x] R1 — `kk bot exec <name> <url>` registers as a visible leaf with options `-X/--request`, repeatable `-H/--header`, `-d/--data` (literal or `@file`), `-o/--output`, `-i/--include`, `-L/--location`, `-f/--fail`, `-m/--max-time <seconds>`; any other option or a malformed value (header without `:`, non-positive `-m`) is a usage error (exit 2).
- [x] R2 — Harness `execBot(name, request, options)` validates the name and the URL (http/https, no userinfo; query kept), requires the profile directory to exist (else `missingBotProfile` login guidance, exit 1), acquires the shared lease (busy → refused, no wait), launches headless through `createKkBrowserLauncher` with the borrowed lease, calls `context.request.fetch` with `failOnStatusCode:false`, `maxRedirects` 0 unless `-L`, and `timeout` = `-m`×1000 or Playwright's 30 s default; reads the body, closes the context, then releases the lease.
- [x] R3 — Method defaults to GET, or POST when `-d` is present; `@file` is read raw (unreadable file → exit 1); header lines split on the first colon and are trimmed.
- [x] R4 — Output: body bytes to stdout via `process.stdout.write` or to the `-o` file; `-i` prefixes `HTTP <status> <statusText>` and one `Name: value` line per response header, then a blank line, with `Set-Cookie` values printed as `<redacted>`; exit 0 for any HTTP response, 1 for transport failure/timeout/busy/missing profile or `-f` with status ≥ 400 (body suppressed), 2 for usage.
- [x] R5 — Errors print `kk.bot.failed: <detail>` and never include the request URL, cookie values or response bodies (Playwright errors are wrapped, not passed through); only profile cookies are attached (no storage-state reinjection, no storage tokens).
- [x] R6 — Command-tree drift test (apps/cli/tests/main.test.ts visible-leaf list), `docs/04_DESIGN.md` §1.12 and the bot group description include `exec` in the same commit.

Out of scope: `-F`, `-b/-c`, `-u`, `-x`, `--retry`, `-d @-`, `-k`, `--compressed`, streaming, adapter special state, headed fallback for WAF-451 channels.

### Acceptance Criteria

- [x] AC1 — Exec sends a request with the cached cookie session
- [x] AC2 — Exec accepts a curl option subset
- [x] AC3 — Exec stays within the normal cookie-session case

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

Task 0306 ships `kk bot exec <name> <url>`: one request through the bot's cached cookie session with a
curl option subset. Harness owns the browser/lease lifetime, the CLI owns option parsing, printing and
the exit mapping (design `docs/design/kk-bot-session-facts-exec.md` §`kk bot exec`; ADR-038 amendment
2026-10-16).

| File | Change |
| --- | --- |
| `packages/publish-harness/src/browser.ts:1288` | `BotExecRequest` — the frozen request shape (`url`, `method`, `headers`, optional `data: Buffer`, `followRedirects`, optional `timeoutMs`). |
| `packages/publish-harness/src/browser.ts:1304` | `BotExecResponse` — buffered `status`/`statusText`/`headers`/`body: Buffer`; printing stays in the CLI. |
| `packages/publish-harness/src/browser.ts:1321` | `execBot(name, request, options?)`: name assert → URL validate → `lstat` profile (missing → `missingBotProfile(name,false)` guidance, never created) → shared lease → `createKkBrowserLauncher(undefined,{lease,physicalProfileDir},{leaseRoot,fileSystem})` → `launch({headless:true})` → `context.request.fetch(... failOnStatusCode:false, maxRedirects:0 unless -L, timeout only with -m)` → `body()` → close context + release lease in `finally`. |
| `packages/publish-harness/src/browser.ts:1373` | `validateExecUrl`: http(s) only, no userinfo, **sent as given** (query kept; `normalizeBotDefaultUrl` deliberately unused). Messages never echo the input. |
| `packages/publish-harness/src/browser.ts:1395` | `execFailureDetail`: wraps every fetch/`body()` failure in `BotError('browser', …)` with the error class plus the first line with each URL spelling stripped — Playwright messages embed the URL and its query. |
| `apps/cli/src/commands/bot.ts:147` | `collectHeader` — repeatable `-H` reducer (no `(default: [])` noise in help). |
| `apps/cli/src/commands/bot.ts:152` | `BotExecCliOptions` — the parsed `exec` surface (`request`, `header`, `data`, `output`, `include`, `location`, `fail`, `maxTime`). |
| `apps/cli/src/commands/bot.ts:169` | `botExecAction`: build the request (usage errors first), call `execBot`, `-i` header block, `-f` → `BotError('browser','HTTP <status>')` with the body suppressed, then body bytes via `writeBytes` or `-o` (`writeFileSync`). |
| `apps/cli/src/commands/bot.ts:193` | `buildExecRequest`: headers split on the first colon + trimmed (rejected value never echoed), `-d` literal/`@file`, method `-X` or GET/POST-by-`-d`, `-L`, `-m`. |
| `apps/cli/src/commands/bot.ts:216` | `readExecData`: `@file` read raw (no newline stripping); unreadable file is `persistence`/exit 1, not usage. |
| `apps/cli/src/commands/bot.ts:227` | `parseExecMaxTime`: seconds → ms; zero/negative/non-numeric is a usage error (exit 2). |
| `apps/cli/src/commands/bot.ts:236` | `execHeaderBlock`: `HTTP <status> <statusText>` (Playwright exposes no protocol version) + one `Name: value` per header, `Set-Cookie` → `<redacted>`, blank line separator. |
| `apps/cli/src/commands/bot.ts:276` | `bot exec` registration: two arguments and exactly the eight curl-subset options; group description gains `exec`. |
| `apps/cli/src/commands/bot.ts:293` | `preSubcommand` hook mapping Commander parse errors to exit 2 for this leaf (unknown option, missing/excess argument); needed because `main()` re-inherits the exit callback after registration, which drops one set on the command. |
| `apps/cli/tests/main.test.ts:201` | Visible-leaf drift list gains `bot exec` (ADR-037 tree). |
| `docs/04_DESIGN.md:112` | §1 catalog row names `exec` and the authenticated-request surface. |
| `docs/04_DESIGN.md:994` | §1.12 command block gains the `kk bot exec` line. |
| `docs/04_DESIGN.md:1031` | §1.12 bullet: headless persistent launch under the lease, cookies chosen by the browser, URL sent as given, no profile creation, the option subset, buffered byte output, `-i`/`-f`/exit contract, URL-free errors, out-of-scope list. |
| `packages/publish-harness/tests/bot-session.test.ts:772` | `bot exec (0306)` suite through a fake launcher: request shape/URL/options, `-L`/`-m` mapping, missing profile (no dir created, no lease dir), busy lease refusal, URL-free transport/body failures with close+release, and usage rejections (unsafe name, scheme, userinfo). |
| `apps/cli/tests/commands/bot.test.ts:340` | CLI suite: GET/POST/`-X`/`@file`/headers, raw byte body + `-o`, `-i` with `Set-Cookie` redaction, `-f` 5xx exit 1 with body suppressed, usage errors (bad header/`-m`/`--compressed`/missing URL) exit 2 with no request, unreadable `@file` exit 1; registration expectations extended to `exec`. |
| `apps/cli/src/byte-output.ts:20` | `writeBytes` — the single raw `process.stdout.write`, for byte-exact stdout (no appended newline). Seam file, not a command module. |
| `apps/cli/src/byte-output.ts:34` | `readFileBytes`/`writeFileBytes` (`:39`) — the byte file IO for `-d @file` and `-o`; the ts-runtime `FileSystem` seam is text-only (`readFile`/`writeFile` take a `string`). |
| `.spur/rules/typescript/output-boundaries.yaml:42` | `no-raw-stdout-stderr` exemption for `apps/cli/src/byte-output.ts` only, reason inline — the line-oriented `output.ts` seam appends a newline and cannot carry a binary body. |
| `.spur/rules/strict/runtime-boundaries.yaml:176` | `no-direct-fs-io` exemption for the same seam file only, reason inline — binary bytes cannot route through the text-only `FileSystem` seam (same class as `plugins/generations/image-gen/src/bytes.ts`). |
| `apps/cli/tests/byte-output.test.ts:16` | Seam cases: no appended newline on text, binary `Uint8Array` to stdout unchanged, byte file round-trip with no encoding loss, `-d` text read keeps its newlines, unreadable file throws. |
| `apps/cli/src/commands/bot.ts:181` | `-i` header block and the response body route through `writeBytes`; `-o` writes through `writeFileBytes` (`:187`); `-d @file` reads through `readFileBytes` (`:220`). No `node:fs` import remains in the command. |

**Byte-output seam — operator decision at gate time (not silently absorbed).** The frozen contract
requires the response body byte-for-byte on stdout, and the ts-utils seam
(`WriteTarget.write(chunk: string)` → `echo` appends `\n`) is line- and string-oriented, so it would
append a newline and corrupt a binary body. Rather than leave 0306's gate red or widen an exemption
over the whole command module, the raw write was moved into `apps/cli/src/byte-output.ts` and
`no-raw-stdout-stderr` excludes exactly that file, and the same file carries the `no-direct-fs-io`
exemption because the ts-runtime `FileSystem` seam is text-only — approved by the operator, who chose
this over a file-level exclude of the command module and over amending the byte-exact contract. `bun run test-pre-check`
(all 56 pre-check rules) and `bun run lint` (biome + typecheck) are clean, and every other deviation is absent: no `any`, no suppression comments, no alias,
no second convention.

**Test-fix hop 1 (review remediation, 2026-10-16).** Two OPEN findings from the review verdict, both
repaired; findings 3-5 stay ACCEPTED (unchanged).

| File | Change |
| --- | --- |
| `apps/cli/src/byte-output.ts:27` | `writeBytes` now returns `Promise<void>` that resolves from the `process.stdout.write` completion callback (no timer, no size heuristic), so the caller holds the process open until the pipe has drained. Row above (`:20`) was the synchronous version that truncated at the pipe buffer. |
| `apps/cli/src/commands/bot.ts:180` | `-i` header block `await writeBytes(...)`; `:188` body `await writeBytes(response.body)`. `apps/cli/src/index.ts:11` (`process.exit(await main())`) then cannot pre-empt the queued write because Commander's `parseAsync` awaits these action promises. No change in `index.ts` was needed; `-o` still writes the raw bytes with `writeFileBytes`. |
| `apps/cli/tests/fixtures/write-bytes-child.ts:1` | Child-process fixture: `await writeBytes(N bytes)` then `process.exit(0)`, mirroring `index.ts` — a real child process is the only way to see the pipe buffer, since both existing suites replace `process.stdout.write` with a synchronous collector. |
| `apps/cli/tests/byte-output.test.ts:50` | Regression test (finding 1): spawns that fixture with a 4 000 000-byte body and asserts the full byte count arrives. **FAILS on the pre-fix seam** (received 1 310 720) and passes after (`:17` the sync-collector fake now completes the drain callback). |
| `apps/cli/tests/commands/bot.test.ts:330` | The exec stdout fake completes the drain callback — without it the now-awaited `writeBytes` would hang the CLI action. |
| `packages/publish-harness/tests/bot-session.test.ts:994` | AC1 end-to-end test (finding 2): real Chromium, `Bun.serve` on 127.0.0.1 only — `/set` answers `sid=SEKRET123; Path=/; Max-Age=3600` (persistent, or a second launch would send nothing), then a second `execBot` on the SAME profile/lease path to `/echo` asserts the request carried `cookie: sid=SEKRET123` and that no lease dir is left behind. `chromiumMissing()` (`:36`) skips it, announcing the reason, where no browser binary is installed. Profile dirs and the server stay under the existing temp root / `try/finally`. |

Verification of the fix on this tree (blocking finding 1): the new test fails pre-fix at 1 310 720 of
4 000 000 bytes and passes post-fix; a real `kk bot exec` against a local server served a 400 000-byte
body and `| wc -c` returned 400 000 (exit 0, no stderr) where the same seam returned 131 072 before;
`bun test packages/publish-harness/tests/bot-session.test.ts apps/cli/tests/byte-output.test.ts
apps/cli/tests/commands/bot.test.ts` → 56 pass / 0 fail; `bun run lint` (biome 597 files + typecheck
across every workspace) clean; targeted `spur rule run --rule no-raw-stdout-stderr` and `--rule
no-direct-fs-io` both pass — no new exemption was added.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `kk bot exec` visible leaf with the curl option subset at `apps/cli/src/commands/bot.ts:285-298` (re-read this run); malformed values are usage errors. |
| R2 | MET | `execBot` validates name/URL, requires the profile dir, acquires the shared lease, headless launch, `failOnStatusCode:false`, `maxRedirects` 0 unless `-L` at `packages/publish-harness/src/browser.ts:1321` (re-read this run). |
| R3 | MET | Method default GET / POST with `-d`, raw `@file`, first-colon header split — covered by the bot.test.ts exec cases (152 pass / 0 fail this run). |
| R4 | MET | Output contract (stdout/`-o`, `-i` header prefix, redacted `Set-Cookie`, exit 0/1/2 mapping) — asserted in `apps/cli/tests/commands/bot.test.ts:349-591`. |
| R5 | MET | `kk.bot.failed: <detail>` errors carry no URL, cookie values or bodies; Playwright errors wrapped — covered by the refusal/error tests in bot.test.ts. |
| R6 | MET | Command-tree drift test in `apps/cli/tests/main.test.ts`; `docs/04_DESIGN.md` §1.12 lists `exec` (re-read this run). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Exec sends a request with the cached cookie session | MET | test | Real-Chromium case `packages/publish-harness/tests/bot-session.test.ts:1010` (re-read this run; ran unskipped in this run's 152 pass / 0 fail). |
| AC2 — Exec accepts a curl option subset | MET | test | Option mapping and refusal tests `apps/cli/tests/commands/bot.test.ts:349-591`; 152 pass / 0 fail (bun test, this run). |
| AC3 — Exec stays within the normal cookie-session case | MET | test | Launch request `{profileDir, headless:true}`, missing profile refused pre-launch `packages/publish-harness/src/browser.ts:1321-1341`; profile-only cookie attachment `packages/publish-harness/tests/bot-session.test.ts:1037-1038`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0306 (round 2, after repair hop 1)
**Scope:** `git diff HEAD` on `sp/runall-a23-083b` — 9 modified + 3 new files for `kk bot exec`: `packages/publish-harness/src/browser.ts:1321` (`execBot`/`validateExecUrl`/`execFailureDetail`), `apps/cli/src/commands/bot.ts:275` (registration, parsing, output, exit mapping), `apps/cli/src/byte-output.ts` (byte seam), two file-scoped rule exemptions, the two repair tests, `docs/04_DESIGN.md:112,994,1030` and the drift list `apps/cli/tests/main.test.ts:201`.
**Dimensions:** functional traceability (R1–R6, AC1–AC3), SECUA (security, correctness, efficiency, usability, architecture).
**Repair under review:** round 1's finding 1 (P2, piped stdout cut at 131 072 B) and finding 2 (P3, AC1 untested). Round-1 findings 3–5 were ACCEPTED and are carried unchanged.

Verdict: PASS — both round-1 findings are repaired and were re-measured on this tree; no new P1–P3 finding was introduced by the repair.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | Round 1: a body written to a **pipe** was truncated at 131 072 bytes with exit 0. Repaired and re-measured this round: a fire-and-forget `process.stdout.write(4 MB)` + `process.exit(0)` child still yields exactly `131 072` on `bun … \| wc -c`, while the same 4 MB through `process.exit(await main())` where the action awaits `writeBytes` yields `4 000 000`, exit 0. Both `kk bot exec` write sites await the seam (`apps/cli/src/commands/bot.ts:180` header block, `:188` body), `-i`+`-o` included (header awaited, body via synchronous `writeFileBytes` at `:187`), and `process.stdout.write` now appears nowhere under `apps/**/src` except the seam itself (`apps/cli/src/byte-output.ts:29`). | `apps/cli/src/byte-output.ts:27-31` | RESOLVED |
| 2 | P3 (minor) | functional | Round 1: AC1's cookie attachment had no automated test. Repaired: `attaches the saved profile cookie … (AC1)` performs two real `execBot` launches on one isolated profile against a `Bun.serve` loopback, with a persistent (`Max-Age`) cookie, and asserts the first request carried no `Cookie` and the second carried `sid=SEKRET123` — it fails if attachment, persistence or the shared profile path regresses. Ran here unskipped: 1 108 ms, pass. | `packages/publish-harness/tests/bot-session.test.ts:994-1038` | RESOLVED |
| 3 | P4 (advisory) | security | Carried from round 1: `execFailureDetail` strips only spellings of the *input* URL, so a `-L` failure whose first line names the **redirect target** would print that target. Not reproduced (a live third-party redirect was out of scope). | `packages/publish-harness/src/browser.ts:1395-1428` | ACCEPTED |
| 4 | P4 (advisory) | usability | Carried: `-d @-` (curl stdin form, out of scope) is rejected as an unreadable `@file` — exit 1, not the exit 2 that an unsupported option gives. Rejected explicitly, never silently ignored. | `apps/cli/src/commands/bot.ts:216-224` | ACCEPTED |
| 5 | P4 (advisory) | correctness | Carried: two `-H` lines with the same name collapse to the last (`Record<string, string>`), so a repeated header loses a value. The frozen request shape prescribes the `Record`. | `apps/cli/src/commands/bot.ts:193-203` | ACCEPTED |
| 6 | P4 (advisory) | usability | `-i` together with `-o` sends the header block to stdout and the body to the file, where curl writes both into the file. Consistent with the registered help texts ("`-o` … instead of stdout", "`-i` … before the body") and untested, but it is the one combination whose curl parity is not obvious. | `apps/cli/src/commands/bot.ts:180-188` | ACCEPTED |
| 7 | P4 (advisory) | usability | The new `no-direct-fs-io` exemption comment still reads "every other CLI read/write uses the seam", which overstates scope: `apps/cli/src/invoke.ts`, `apps/cli/src/commands/daily.ts:…` and `apps/cli/src/stage.ts` are themselves raw-fs exemptions in the same list. Same class as the note round 1 raised; a comment-accuracy nit, no behavioural effect. | `.spur/rules/strict/runtime-boundaries.yaml:173-176` | ACCEPTED |
| 8 | P4 (advisory) | correctness | `writeBytes`' rejection branch (a write error such as EPIPE) has no test: both suites complete the drain callback with `null`. The catch path is by construction `runBotAction` → `failBot` (exit 1), but it is reasoned, not exercised. | `apps/cli/src/byte-output.ts:29-31` | ACCEPTED |

##### Repair verification (fresh measurements, this round)

- **Finding 1 is discriminating, not self-certifying.** Pre-fix reproduction on this tree: a child that writes 4 000 000 bytes fire-and-forget then exits, piped to `wc -c`, returns `131072`. Post-fix chain (`process.exit(await main())`, action awaits the seam), same command: `4000000`, exit 0. The regression test drives a real child process (`apps/cli/tests/fixtures/write-bytes-child.ts:9` → `Bun.spawn` at `apps/cli/tests/byte-output.test.ts:50-64`), so on the pre-fix seam it asserts `131072 !== 4000000` and fails; both suites' synchronous stdout fakes could never have caught it.
- **Every write site is awaited.** `apps/cli/src/commands/bot.ts:180` (`-i` header block) and `:188` (body) both `await`; a grep for `process.stdout.write` across `apps/**/src`, `packages/**/src` and `plugins/**/src` returns only `apps/cli/src/byte-output.ts:29` (the other hits are `scripts/`, `tests/` and fixtures). `index.ts:11` needed no change: Commander's `parseAsync` awaits the action promise chain.
- **Targeted suites, run this round:** `apps/cli/tests/byte-output.test.ts` → 6 pass / 0 fail (incl. the 4 MB child-process case); `packages/publish-harness/tests/bot-session.test.ts` → 28 pass / 0 fail, AC1 case executed in 1 108 ms with a real Chromium.
- **Plate gate re-read, not re-run:** `.spur/run/0306-check-receipt.json` digest `sha256:fe652e604674712dfe9edd85c837d0ec3766ca10193ce65df45d0cc264908eb9`, `3824 pass / 2 skip / 0 fail` across 197 files (`.spur/run/0306-test-gate.log:296-299`); `apps/cli/src/byte-output.ts` at 100 % line/function coverage (`:114`). The two skips are the known environment probes, not the AC1 case.
- **Exemptions still minimal and correctly reasoned.** `apps/cli/src/byte-output.ts` is the only extra path: `no-raw-stdout-stderr` needs it because `output.ts` appends `\n` and is string-only, and `no-direct-fs-io` needs it because `node:fs`'s `readFileSync`/`writeFileSync` are the only byte primitives (`apps/cli/src/byte-output.ts:1`); every other rule that watches these trees still covers the file. Fresh runs: `no-raw-stdout-stderr`, `no-direct-fs-io` and `review-record-carries-confidence-level` each pass.
- **Round-1 P4 items left alone, as instructed:** findings 3–5 are byte-for-byte the same behaviours (redirect-target strip list, `-d @-` exit 1, repeated-`-H` collapse) and stay ACCEPTED.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Eight options, two arguments, drift list extended: `apps/cli/src/commands/bot.ts:275-292`, `apps/cli/tests/main.test.ts:201`. Out-of-scope options and malformed values exit 2 (commander hook at `apps/cli/src/commands/bot.ts:293-300`; parse rejections at `:193-234`); tests `apps/cli/tests/commands/bot.test.ts:470-514`. |
| R2 | MET | `execBot` order and fetch options match the frozen shape: `packages/publish-harness/src/browser.ts:1321-1367` (`failOnStatusCode:false`, `maxRedirects:0` unless `-L`, `timeout` only with `-m`); missing profile → guidance and no directory (`bot-session.test.ts:877-897`); busy lease refused (`:898-912`); close + release on every path (`finally`, `browser.ts:1363-1366`; tests `:913-947`). |
| R3 | MET | Header split on first colon + trim with the value never echoed (`bot.ts:203-210`), `-d` literal/`@file` raw (`:216-224`), GET/POST-by-`-d` (`:211`), `-m` seconds→ms with zero/negative/non-numeric rejected (`:227-234`); tests `bot.test.ts:349-403`. |
| R4 | MET | Body bytes with no appended newline, awaited, or to the `-o` file (`bot.ts:180,187,188`; `byte-output.ts:27-31`); `-i` block with `Set-Cookie` → `<redacted>` (`bot.ts:236-244`); `-f` on ≥400 exits 1 with the body suppressed (`bot.ts:182-184`); exit mapping `bot.ts:55-60`. The round-1 stdout defect is closed — verified above at 4 000 000 bytes through a real pipe. |
| R5 | MET | Every fetch/`body()` failure wrapped URL-free (`browser.ts:1353,1359,1395-1428`); `validateExecUrl` echoes only the scheme (`:1373-1393`); malformed header value never echoed (`bot.ts:206-208`); `Set-Cookie` redacted (`bot.ts:240`); only profile cookies attach — no storage state, no adapter state (`browser.ts:1330-1348`); tests `bot-session.test.ts:913-947`, `bot.test.ts:419-450,470-514`. |
| R6 | MET | `apps/cli/tests/main.test.ts:201`, `docs/04_DESIGN.md:112` (catalog row), `:994` (command block), `:1030-1052` (§1.12 bullet matching the implemented behaviour, incl. the exit contract and out-of-scope list). |

##### AC1–AC3 traceability

| AC | Status | Evidence |
|----|--------|----------|
| AC1 — Exec sends a request with the cached cookie session | MET, now with a test | `packages/publish-harness/tests/bot-session.test.ts:994-1038`: two real `execBot` launches on one profile, loopback server, persistent `sid=SEKRET123; Max-Age=3600`; first request `Cookie` null, second request carries the cookie, lease root empty after each. Executed here (1 108 ms, pass). |
| AC2 — Exec accepts a curl option subset | MET | Eight options registered and every other curl flag rejected with exit 2 (`apps/cli/src/commands/bot.ts:275-300`, `:193-234`); CLI tests `apps/cli/tests/commands/bot.test.ts:349-421,470-514`. |
| AC3 — Exec stays within the normal cookie-session case | MET | Launch request is exactly `{profileDir, headless:true}` (`bot-session.test.ts:870-876`); `execBot` never reads `bot.json`, an adapter or storage state (`browser.ts:1321-1352`), so nothing beyond the profile's own cookies can attach. |

##### Evidence basis per claim

| Claim | Basis on this tree | Falsified by |
| --- | --- | --- |
| Findings 1–2 are repaired | Reproduced the pre-fix truncation (`131 072` of 4 000 000) and the post-fix delivery (`4 000 000`) with the real seam and the real exit chain; both new tests executed and passed; AC1 case unskipped | a piped 4 MB body arriving short, or the AC1 case failing/skipping on a Chromium host |
| R1–R6, AC2–AC3 | Code read at the cited lines + the recorded gate (3 826 tests, 0 fail) + the two suites re-run this round | a registered option missing from the docs/drift list, or an out-of-scope flag reaching the action |
| R5 secret hygiene | Read of every print site plus the URL-strip tests; no third-party transport error induced | a first-line error message naming a URL the strip list does not cover |
| Finding 3 (redirect-target leak) | Reasoned from `browser.ts:1395-1428`, not reproduced | a live `-L` chain whose failure names the redirect target |
| EPIPE path (finding 8) | Reasoned from `bot.ts:169-190` + `bot.ts:47-60`; the raw child probe shows Bun's own EPIPE dump only when nothing catches it | a CLI run of `kk bot exec … \| head` that neither exits 1 nor prints `kk.bot.failed:` |
| Exemptions | Read of both rule files and the seam, plus three rule runs; no raw write outside the seam in this diff | a raw `process.stdout.write`/`node:fs` call anywhere else under the exemption's scope |

##### Architecture

The seam is the right shape and stayed the smallest one: three functions, no policy, one file, and exemption scoped to that file rather than to `commands/bot.ts`. Making `writeBytes` return a promise resolved by the write callback (rather than a timer or a size heuristic) is the correct primitive — it makes the drain the caller's precondition instead of guessing the pipe capacity. `browser.ts` is now ~1 490 lines with a third lifecycle entry point beside `openBot`; the shared launcher/lease seam keeps the duplication honest, but the next feature in this area should split the bot lifecycle out rather than stack a fourth block.

##### Residual risks

- EPIPE is reasoned, not exercised: `kk bot exec … | head` should surface `kk bot.failed: …` and exit 1 through `runBotAction`/`failBot`, but a raw child probe shows Bun prints its own `EPIPE: broken pipe` dump when nothing catches the rejection, so the operator-visible output of that path is unverified.
- Browserless hosts: the AC1 test skips (announced) when no Chromium binary exists (`packages/publish-harness/tests/bot-session.test.ts:36-44,994`), so the cookie pin only runs where a browser is installed — true on this gate host, not guaranteed on every runner.
- Session-scoped cookies (no `Max-Age`/`Expires`) do not survive the launch boundary, so `exec` on such a site sends an unauthenticated request and exits 0 — inherent to the persistent-profile design and invisible to the operator.
- Adapter/channel special state stays out of scope by decision (AC3): a channel whose session lives in `storage-state.json` or localStorage looks logged out to `exec`.
- No live third-party site was exercised (the design's own rule); the cookie path is proven against a loopback server only.
- `-i` prints every response header except `Set-Cookie`, so a token in `Location` or a vendor `X-…-Token` reaches the terminal.
- Request and response are fully buffered in memory (`packages/publish-harness/src/browser.ts:1316-1320` `shortcut:` note); an unwritable `-o` path surfaces the raw fs error text through `failBot` (exit 1, path in stderr, no test).

**Next:** ship — no open P1–P3 finding; the P4 items are recorded for a later pass (redirect-target stripping, `-i`/`-o` parity, the exemption comment wording).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T04:39:26.129Z todo → wip (system)
- 2026-10-17T05:47:33.055Z wip → testing (system)
- 2026-10-17T05:48:36.736Z testing → done (system)

