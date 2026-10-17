---
schema_version: 1
id: "A23"
name: "kk bot session facts and authenticated exec"
status: backlog
priority: P2
tags: []
created_at: "2026-10-17T02:56:36.650Z"
updated_at: "2026-10-17T02:57:09.706Z"
---

# A23: kk bot session facts and authenticated exec

## Goal

Make saved `kk bot` sessions legible and reusable: `kk bot list` reports when each session was last saved, when it is estimated to expire, and which account it belongs to (when known), and a new `kk bot exec` sends one curl-style HTTP request with the bot's cached cookie session attached — for the normal cookie-session case only.

## Scope

**In scope**

- `bot.json` gains optional, additive login-time facts: `lastLoginAt`, `expiresAt` (estimated from persistent httpOnly cookies applicable to the default URL at save time), `identity` (adapter-reported). `schemaVersion` stays 1; legacy profiles keep working.
- `kk bot list` appends three tab-separated columns after the existing three: identity, last login, expiry (`unknown` when not recorded; last login falls back to the `bot.json` mtime). Still browser-free and cookie-DB-free.
- The bot-mode adapter verdict line accepts an optional `identity` string; channels emit it only where their readiness routine already observes the account cheaply.
- `kk bot exec <name> <url>` with a curl subset: `-X/--request`, repeatable `-H/--header`, `-d/--data` (literal or `@file`), `-o/--output`, `-i/--include`, `-L/--location`, `-f/--fail`, `-m/--max-time`. Headless launch of the named profile under the shared per-profile lease; request via the persistent context's request API so profile cookies attach by normal cookie rules. Body to stdout (or file); exit 0 on any HTTP response, 1 on transport failure or `-f` with status ≥ 400, 2 on usage.
- Secret hygiene: never print cookie values, request URLs in errors, or `Set-Cookie` values (redacted under `-i`).
- Design doc, `docs/04_DESIGN.md`, ADR inventory amendment and command-tree tests updated for the new leaf.

**Out of scope**

- Live session probing / readiness checks from `bot list`.
- Plugin special state in `exec` (WeChat MP `storage-state.json` reinjection), localStorage/sessionStorage or bearer tokens, multipart/form uploads (`-F`), cookie jars (`-b/-c`), proxies, retries, stdin data, parallel requests, streaming large bodies.
- `--json` output for `bot list`.
- Any change to `spur` (it has no `bot` noun).

## Acceptance Criteria

```gherkin
Feature: kk bot session facts and authenticated exec

  @core
  Scenario: R1 — Login records when the session was saved
    # covers: I1, I8
    Given a safe bot name and a valid http or https URL
    When kk bot login URL --save NAME completes through the generic or adapter path
    Then bot.json records lastLoginAt as an RFC 3339 UTC timestamp of the successful save
    And schemaVersion stays 1 and a bot.json without the new optional fields still parses
    And a failed, cancelled or unconfirmed login leaves the previous lastLoginAt unchanged

  @core
  Scenario: R2 — Login records an estimated session expiry
    # covers: I2
    Given a successful login whose profile holds cookies applicable to the saved default URL
    When the session is saved
    Then bot.json records expiresAt as the earliest expiry among persistent httpOnly cookies applicable to that URL
    And expiresAt is omitted when only session cookies or no httpOnly cookies apply
    And no cookie name or value is written to bot.json, stdout or stderr

  @core
  Scenario: R3 — Adapter-reported account identity is saved
    # covers: I3
    Given a known channel adapter whose login verdict line carries an optional identity string
    When the adapter login exits 0 with that verdict
    Then bot.json records the identity trimmed and capped at 128 characters
    And a verdict without identity, or a generic operator-confirmed login, saves no identity
    And an existing verdict without the identity field keeps working unchanged

  @core
  Scenario: R4 — Bot list shows identity, last login and expiry columns
    # covers: I1, I2, I3, I8
    Given cached profiles with full metadata, partial metadata, legacy no-metadata and corrupt metadata
    When kk bot list runs
    Then each row prints name, cached, default URL, identity, last login and expiry tab-separated in that order
    And a missing value prints unknown while a metadata-bearing profile without lastLoginAt falls back to the bot.json modification time
    And the listing still launches no browser and reads no cookie database

  @core
  Scenario: R5 — Exec sends a request with the cached cookie session
    # covers: I4, I6, I8
    Given a cached bot whose profile holds a cookie for a local test server origin
    When kk bot exec NAME URL runs against that server
    Then the profile opens headless under the shared per-profile lease and the request carries the profile cookie
    And the response body is written to stdout byte for byte and the command exits 0
    And a missing bot, an unsafe name or a non-http URL fails with an actionable error and exit 1 or 2

  @core
  Scenario: R6 — Exec accepts a curl option subset
    # covers: I5
    Given a cached bot and a local test server that echoes method, headers and body
    When kk bot exec runs with -X, repeated -H, -d literal or -d @file, -o, -i, -L, -f and -m
    Then the method, headers and body reach the server as curl would send them and -d without -X implies POST
    And -o writes the body to the file, -i prefixes the status line and response headers, and -L follows redirects that are otherwise returned as-is
    And -f turns a status of 400 or above into exit 1 and -m bounds the whole request
    And any option outside the subset is a usage error with exit 2

  @core
  Scenario: R7 — Exec stays within the normal cookie-session case
    # covers: I7
    Given a bot that is busy, adapter-bound with special session state, or a request needing unsupported features
    When kk bot exec runs
    Then a busy profile is refused without waiting and an adapter special state is not reinjected
    And help and the design document state that only cookies in the persistent profile are attached
    And error messages never echo the request URL, cookie values or Set-Cookie values, which are redacted under -i
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0305 | Record bot session facts at login and show them in kk bot list | todo |
| 0306 | Add kk bot exec for one authenticated curl-style request | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
