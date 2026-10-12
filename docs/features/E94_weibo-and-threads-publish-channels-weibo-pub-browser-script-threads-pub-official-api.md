---
schema_version: 1
id: "E94"
name: "Weibo and Threads publish channels (weibo-pub browser script, threads-pub official API)"
status: active
priority: P2
tags: []
created_at: "2026-10-09T23:15:23.509Z"
updated_at: "2026-10-12T07:26:29.459Z"
---

# E94: Weibo and Threads publish channels (weibo-pub browser script, threads-pub official API)

## Goal

Publish kk `Content` to Weibo and Threads as two new `kind: publish` plugins — `weibo-pub` and `threads-pub` — built on the same infrastructure and rails as `x-pub`: official API where a usable one exists (Threads), a draft-by-default, session-preflighted Playwright script flow where it does not (Weibo), observed-outcome success, and env-only secrets.

## Scope

**In scope**

- `plugins/publishings/threads-pub`: operation `post` over the official Threads publishing API (`/{threads-user-id}/threads` TEXT container → `/threads_publish`), `file-cli` transport, env `THREADS_ACCESS_TOKEN` + `THREADS_USER_ID`, 500-character cap, no browser fallback; fake transport under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`.
- `plugins/publishings/weibo-pub`: operations `post` (weibo.com composer) and `article` (头条文章 editor, draft via 保存草稿) over `@gobing-ai/publish-harness/browser` + `@gobing-ai/ts-browser-automation`, `driver: 'script'` (`agent` fails fast), site-owned selector table, headless session preflight, `profile-check.ts login|check`, `WEIBO_PROFILE_DIR` tier, `publishStatus` draft/public rail, success only from an observed signal.
- Unknown operation refused by name before any transport or browser resolves (x-pub `resolveOperation` pattern).
- Registration on existing channel surfaces: plugin registry test, `kk plugin check` channel list (weibo-pub via manifest `check`), `kk:publish` skill table + env table, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, design satellite.
- Offline tests via fake transports / fake pages; operator live dogfood of Weibo selectors recorded as evidence.

**Out of scope**

- Threads image/video/carousel posts (needs a public `image_url` host) and Threads token refresh automation.
- Any Threads browser path, and any Weibo `statuses/share` API path.
- New shared harness code beyond what `@gobing-ai/publish-harness/browser` already exports, and new dependencies.
- Wiring the channels into daily/itc product workflows (separate feature).
- ADR-025-style rate cap for the new channels (E91-D7: port when a site warns).

## Acceptance Criteria

```gherkin
Feature: Weibo and Threads publish channels (weibo-pub browser script, threads-pub official API)

  @core
  Scenario: R1 — threads-pub posts text through the official Threads publishing API
    # covers: I2, I3, I4
    Given THREADS_ACCESS_TOKEN and THREADS_USER_ID are set and a Content with a body or title
    When kk executor run threads-pub runs with operation post or no operation
    Then the plugin creates a TEXT media container and publishes it with the returned creation_id
    And the Result is ok true with target threads and the published media id, with a permalink when the best-effort lookup succeeds
    And text longer than 500 Unicode code points is refused before any network call without truncation

  @core
  Scenario: R2 — threads-pub refuses without credentials or text and never opens a browser
    # covers: I2, I4
    Given THREADS_ACCESS_TOKEN or THREADS_USER_ID is missing, or the Content has neither body nor title
    When threads-pub runs
    Then the Result is ok false naming the missing variables or the missing text
    And no network request is made and no browser is launched

  @core
  Scenario: R3 — threads-pub reports Threads API failures without leaking the token
    # covers: I2, I4
    Given the container or publish request returns a non-2xx status, times out, or lacks an id
    When threads-pub runs
    Then the Result is ok false naming the failing step and HTTP status when a response exists, or stating that no HTTP response was received
    And the access token never appears in the Result, stderr or the --out file

  @core
  Scenario: R4 — weibo-pub saves a post or article draft by default from an observed signal
    # covers: I1, I3, I4, I6
    Given a verified Weibo browser profile with the 头条文章 entitlement and a Content without publishStatus public
    When weibo-pub runs with operation article
    Then the 头条文章 editor is filled with the title and the markdown rendered as HTML and saved with 保存草稿
    And the Result is ok true with publishStatus draft only after the draft signal is observed
    And an account without the 头条文章 entitlement is refused instead of silently publishing, because no editor or draft control is reachable (measured 2026-10-12, docs/design/weibo-ui-discovery.md)
    And a post run without publishStatus public is refused before any browser opens because the Weibo composer has no draft

  @core
  Scenario: R5 — weibo-pub publishes live only when publishStatus is public
    # covers: I1, I4, I6
    Given a verified Weibo browser profile and a Content with metadata.publishStatus public
    When weibo-pub runs with operation post or article
    Then the publish control is clicked and the Result is ok true only after the live signal is observed
    And an unobserved outcome within the step deadline is ok false naming the step, never a success

  @core
  Scenario: R6 — weibo-pub refuses an unauthenticated session before any headed browser opens
    # covers: I1, I3, I4
    Given the Weibo profile is absent or its session has expired
    When weibo-pub runs any operation
    Then the headless session preflight refuses and the Result is ok false naming the profile-check login command
    And the Result never contains a cookie, token, page HTML or stack trace

  @core
  Scenario: R7 — weibo-pub ships a profile-check login and check entry
    # covers: I1, I3, I4, I5
    Given plugins/publishings/weibo-pub/plugin.json declares check
    When the operator runs profile-check.ts login, check, or kk plugin check weibo-pub
    Then login opens a headed Weibo sign-in and check verifies the saved session read-only
    And the profile dir resolves --profile over WEIBO_PROFILE_DIR over KK_BROWSER_PROFILE_DIR over the default channel dir
    And exit codes are 0 verified, 1 refused and 2 usage

  @core
  Scenario: R8 — both plugins refuse an unknown operation or driver by name before any transport
    # covers: I3, I4
    Given a Content whose options.operation or metadata.operation is not declared by the plugin, or a weibo-pub driver other than script
    When threads-pub or weibo-pub runs
    Then the Result is ok false naming the value and the supported set
    And no transport, network call or browser is started

  @core
  Scenario: R9 — both plugins run offline under the fake publish transport
    # covers: I3, I5
    Given KNOWLEDGE_KIT_PUBLISH_TRANSPORT is fake
    When threads-pub or weibo-pub runs through kk executor run
    Then the fake file-cli or browser transport returns a schema-valid Result
    And the plugin test suites pass without network or a browser

  @core
  Scenario: R10 — the new channels are listed wherever publish channels are enumerated
    # covers: I5
    Given the plugin registry, the kk plugin check channel list, the kk:publish skill and docs 03 and 04
    When they are inspected after the change
    Then threads-pub and weibo-pub appear with their transport, operations and env variables
    And kk plugin status discovers both plugins as kind publish

  @edge
  Scenario: R11 — deferred Threads media and browser paths are refused explicitly
    # covers: I7, I8
    Given a threads-pub Content carrying images or a browser driver option
    When threads-pub runs
    Then the Result is ok false naming the unsupported images or driver option and stating that threads-pub posts text only
    And no browser is launched for Threads
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0243 | threads-pub — Threads text post via the official two-step publishing API | testing |
| 0244 | weibo-pub — Weibo post and 头条文章 article script browser transport with profile-check | todo |
| 0245 | Register threads and weibo wherever publish channels are enumerated | todo |
| 0246 | weibo-pub live operator dogfood — pin composer and article editor selectors | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-12T05:52:40.049Z backlog → active (system)

