---
name: kk bot session facts and authenticated exec
kind: design
status: accepted-design
feature_id: A23
created_at: 2026-10-16
updated_at: 2026-10-16
---

# Bot session facts and `kk bot exec`

Accepted design for A23, not a shipped surface. ADR-038 (amendment 2026-10-16) owns the decision;
the A22 satellite [`kk-noun-verb-bots.md`](kk-noun-verb-bots.md) still owns the bot lifecycle,
lease, transaction and adapter contracts this builds on. The request named `spur bot`; Spur has no
`bot` noun, so the target is the shipped `kk bot`.

## Login-time session facts

`kk bot list` stays browser-free and cookie-DB-free (A22 contract), so every new fact is captured
when a login is saved and persisted in `bot.json`. All three fields are **optional and additive**;
`schemaVersion` stays `1` and `parseBotMetadata` accepts their absence.

| Field | Written by | Value |
| --- | --- | --- |
| `lastLoginAt` | both login paths, at promotion | RFC 3339 UTC time of the successful save |
| `expiresAt` | both login paths | earliest `expires` among **persistent, httpOnly** cookies `context.cookies(defaultUrl)` returns; omitted when none qualify |
| `identity` | adapter path only | trimmed account label from the adapter verdict, ≤128 chars; omitted otherwise |

`expiresAt` is an estimate: httpOnly is the cheapest discriminator between auth and analytics
cookies, and sites with sliding or server-side expiry can disagree. It is historical evidence,
never a readiness claim — the same stance as `authenticationEvidence`.

**One computation seam.** A harness helper `captureSessionFacts(context, url)` returns
`{expiresAt?}` (cookie names/values never leave it); identity comes from `readIdentity`, not from
the helper. The generic `loginBot` path calls it
on its own context before closing. Upstream `loginWithProfile` closes its context internally and returns
`void`, so `runProfileCli` bot-mode login (`--url` given) uses the same package's `withProfilePage`
(headed, readiness predicate, callback before the guaranteed close) and calls the helper in that
callback; it adds `expiresAt` and an optional `identity` to the existing bot-mode verdict line
`{status:'verified', profileDir, defaultUrl, expiresAt?, identity?}`. The parent validates both
(ISO date; string, trimmed, capped, control characters stripped) and ignores invalid values instead
of failing the login. Identity comes from an optional
`ChannelBrowserConfig.readIdentity?(page) => Promise<string | null>`; channels opt in only where
their readiness routine already sees the account name. No extra browser launch is added anywhere.

A failed, cancelled or unconfirmed login writes nothing (existing transaction rule), so previous
facts survive.

## `kk bot list` columns

```text
<name>\tcached\t<defaultUrl|unknown>\t<identity|unknown>\t<lastLogin|unknown>\t<expires|unknown>
```

New columns are appended so positional parsers of the first three keep working. Dates print as
RFC 3339 UTC. A metadata-bearing profile without `lastLoginAt` falls back to the `bot.json` mtime
(metadata is only ever rewritten by a successful login); legacy and corrupt-metadata rows print
`unknown`. No `--json` in this feature.

## `kk bot exec <name> <url>`

One HTTP request with the bot's cached cookie session attached.

| Option | curl meaning kept |
| --- | --- |
| `-X, --request <method>` | method; default `GET`, or `POST` when `-d` is given |
| `-H, --header <'K: V'>` | repeatable request header |
| `-d, --data <data>` | literal body, or `@file` read raw (no newline stripping) |
| `-o, --output <file>` | write body to file instead of stdout |
| `-i, --include` | prefix `HTTP <status> <statusText>` and response headers (Playwright exposes no protocol version) |
| `-L, --location` | follow redirects (otherwise `maxRedirects: 0`, a 3xx is returned as-is) |
| `-f, --fail` | status ≥ 400 → exit 1, body suppressed |
| `-m, --max-time <s>` | whole-request timeout; without it Playwright's 30 s default applies |

Anything else is a Commander usage error (exit 2). No `-F`, `-b/-c`, `-u`, `-x`, `--retry`,
`-d @-`, `-k`, `--compressed`.

**Behaviour.** Validate name and URL (http/https, no userinfo; the query is kept, unlike `defaultUrl`)
first. The profile directory must exist (exec never creates one; `bot.json` is not required); a
missing profile fails with `kk bot login <url> --save <name>` guidance. Acquire the shared
per-profile lease (busy → refused immediately, exit 1). Launch the persistent profile **headless**
through `createKkBrowserLauncher` with the borrowed lease (same path as `openBot`), call
`context.request.fetch(url, {method, headers, data, maxRedirects, timeout, failOnStatusCode:false})`
— the APIRequestContext shares the persistent cookie jar, so the browser's own domain/path/secure
rules decide which cookies attach; nothing is copied out of the profile. Read the body as a
`Buffer`, close the context, release the lease, then write output. Cookies the server refreshes are
persisted by the browser as they would be in `bot open`.

**Normal case only.** Only cookies in the persistent profile are attached. Adapter special state
(WeChat MP `storage-state.json` reinjection), localStorage/sessionStorage tokens and bearer headers
are not emulated; the caller may pass an explicit `-H Authorization: …`. The full body is buffered
in memory (`ponytail:` ceiling — stream to `-o` if large downloads become a use case).

**Exit and output contract.** 0 for any HTTP response (incl. 4xx/5xx without `-f`); 1 for
transport failure, timeout, busy/missing profile, or `-f` with status ≥ 400; 2 for usage. Errors go
to stderr as `kk.bot.failed: <detail>` and never contain the request URL (it may carry tokens),
cookie values or bodies; Playwright errors (which embed the URL) are wrapped. Under `-i`, `Set-Cookie` header values print as `<redacted>`.

## Ownership

- `packages/publish-harness/src/bot.ts` — metadata fields + parser.
- `packages/publish-harness/src/browser.ts` — `captureSessionFacts`, verdict extension,
  `readIdentity` hook, `execBot`.
- `apps/cli/src/commands/bot.ts` — list columns, `exec` registrar/options/output.
- `apps/cli/tests/main.test.ts` — visible-tree drift test gains `bot exec`.
- `docs/04_DESIGN.md` §1.12 updated in the same commit as each surface change (T3).

## Verification

Offline only: isolated profile roots and a local HTTP server (set-cookie → exec echo), as A22's
login-save-open reuse test does. Never certify a live site from mocks; live dogfood is operator-run.

## Sources

Verified 2026-10-16: `apps/cli/src/commands/bot.ts`; `apps/cli/src/bot-adapter.ts`;
`packages/publish-harness/src/bot.ts` (`BotMetadata`, `parseBotMetadata`, `listBots`);
`packages/publish-harness/src/browser.ts` (`runProfileCli` verdict line, `loginBot`,
`runAdapterLogin`, `openBot`); Playwright 1.55.0 `types.d.ts` (`APIRequestContext.fetch`
`maxRedirects`, `BrowserContext.request`, `cookies`).
