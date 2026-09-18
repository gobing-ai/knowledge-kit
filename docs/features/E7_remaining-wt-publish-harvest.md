---
schema_version: 1
id: "E7"
name: "Remaining wt-publish harvest"
status: done
priority: P2
tags: []
created_at: "2026-09-17T22:45:42.508Z"
updated_at: "2026-09-18T03:16:45.216Z"
---

# E7: Remaining wt-publish harvest

## Goal

Harvest the leftover wt publish channels as knowledge-kit `kind: publish` plugins on the existing publish harness, with a shared browser/session layer and a transport policy that prefers official APIs, uses agent-driven browser when pages drift, and keeps Playwright as an optional fast path behind the same Result.

## Scope

- In:
  - Shared foundation on `@gobing-ai/publish-harness`: harvest `@wt/web-automation` (session/profile, selectors, Playwright launch), add `FakeBrowserTransport`, and a `browser` driver field (`script` | `agent`) under the existing `browser` kind (no third transport kind)
  - ADR-008 detail amendment recording browser drivers (not a new kind)
  - Remaining leftover channels as `plugins/publishings/<name>-pub` instances on the E2 contract: `medium-pub`, `wechatmp-pub`, `x-pub`, `juejin-pub`, `substack-pub`, `infoq-pub`, `xhs-pub`
  - Transport policy per channel: official API/CLI (`file-cli`) when documented and ToS-clean; otherwise `browser` with agent driver as the compatible default and optional Playwright script as a fast path; same `Result` contract
  - `x-pub` operations `post` (official X API) and `article` (browser/agent); not two plugins
  - `wechatmp-pub` operation `draft` via official `draft/add` (`file-cli`); console/browser operations only where the API cannot serve the account type
  - Default publish status is draft; live publish is HITL
  - Env-only secrets; fail-loud Result and exit codes per the publish spec
  - Offline unit tests via harness fakes (no live network in CI)
  - Thin `plugins/kk` operator skills (login/preview/confirm) that invoke `kk executor run` / `kk fanout`
  - Docs: design satellite, `04_DESIGN.md` index, `05_FEATURES.md` status
- Out:
  - `technical-content-creation` as a generator plugin or as a child of this feature (follow-on F41 under F4)
  - Re-harvesting Qiita, Zenn, or Surfdash/Surfing
  - Reviving cancelled G or reopening done E4
  - A third `PublishTransport` kind
  - Two X plugins
  - Porting TCC Python scripts
  - Retiring `lead-research-assistant`, `markitdown-browser`, leftover `/wt:topic-*` and `/wt:info-*` commands
  - New `kk` first-layer nouns (ADR-011)
  - Live publish as the default; CI hitting real publisher sites
  - Changing shipped `qiita-pub` / `zenn-pub` / `surfdash-pub` / `emdash-pub` / `podcast-pub` contracts

## Acceptance Criteria

```gherkin
Feature: Remaining wt-publish harvest

  @core
  Scenario: R1 — Publish harness exposes an offline FakeBrowserTransport
    Given @gobing-ai/publish-harness
    When a unit test publishes through FakeBrowserTransport
    Then the call is recorded with no live browser or network
    And the returned Result parses against ResultSchema

  @core
  Scenario: R2 — Browser transports declare a script or agent driver without a third kind
    Given a harvested publish plugin whose transport kind is browser
    When its transport is constructed
    Then kind remains browser
    And it declares driver script or agent
    And PublishTransport does not grow a third kind

  @core
  Scenario: R3 — ADR-008 records browser drivers as a detail amendment
    Given ADR-008 currently names file-cli and browser kinds
    When the harvest design is recorded
    Then docs/00_ADR.md gains a dated ADR-008 amendment for script and agent drivers
    And the amendment does not introduce a third transport kind

  @core
  Scenario: R4 — Harvested leftover channels are discoverable publish plugins
    Given plugins/publishings contains medium-pub, wechatmp-pub, x-pub, juejin-pub, substack-pub, infoq-pub, and xhs-pub
    When the registry discovers them
    Then each has kind publish and is invocable via kk executor run
    And none of qiita-pub, zenn-pub, or surfdash-pub is replaced

  @core
  Scenario: R5 — Medium publishes via the token API as file-cli
    Given a valid Content input and MEDIUM_INTEGRATION_TOKEN
    When medium-pub publishes
    Then the transport kind is file-cli
    And the Result is ok true with target medium and a post URL or id

  @core
  Scenario: R6 — WeChat draft operation uses official draft/add as file-cli
    Given a valid Content input and WeChat AppID plus AppSecret
    When wechatmp-pub runs the draft operation
    Then it calls the official draft/add API as file-cli
    And the Result is ok true with a draft media_id

  @core
  Scenario: R7 — x-pub post operation uses the official X API
    Given a valid post payload and X user access tokens
    When x-pub runs the post operation
    Then it calls POST /2/tweets as file-cli
    And it does not drive the X website with a browser

  @core
  Scenario: R8 — x-pub article operation uses a browser transport on the same plugin
    Given a long-form Content input for X Articles
    When x-pub runs the article operation
    Then the transport kind is browser
    And no second X plugin exists under plugins/publishings

  @core
  Scenario: R9 — A leftover CMS channel publishes via the browser agent driver
    Given a valid Content input for juejin-pub, substack-pub, infoq-pub, or xhs-pub
    When that plugin publishes
    Then the default browser driver is agent
    And the Result parses against ResultSchema with the channel target

  @core
  Scenario: R10 — Optional Playwright script path returns the same Result as the agent driver
    Given a leftover CMS channel that also ships a script driver
    When the same Content is published through script and through agent
    Then both Results share ok, target, and id-or-url fields under ResultSchema

  @core
  Scenario: R11 — New publishes default to draft unless live publish is confirmed
    Given Content without an explicit live-publish confirmation
    When a harvested plugin publishes
    Then the Result describes a draft or equivalent unpublished state
    And live publish requires an operator confirmation

  @core
  Scenario: R12 — Missing secrets fail loud without leaking tokens
    Given a required env secret is unset
    When the plugin runs
    Then it exits non-zero
    And the Result has ok false and names the missing variable
    And neither Result nor plugin.json contains the secret value

  @core
  Scenario: R13 — Transport failure produces a fail-loud Result
    Given a harvested channel whose transport rejects the request
    When publish runs
    Then it exits non-zero
    And the Result has ok false with an error

  @core
  Scenario: R14 — Harvested channels compose with kk fanout
    Given two or more leftover harvested channels
    When kk fanout dispatches Content to them
    Then each channel contributes its own per-target entry to the aggregate Result

  @core
  Scenario: R15 — Thin kk operator skills invoke executor or fanout without owning transport
    Given a plugins/kk publish skill for a leftover channel
    When the operator confirms a draft publish
    Then the skill shells kk executor run or kk fanout
    And the plugin process owns the transport

  @core
  Scenario: R16 — Unit tests for harvested channels run offline via harness fakes
    Given a leftover harvested channel
    When its unit tests run
    Then they use FakeFileCliTransport or FakeBrowserTransport
    And they perform no live publisher-site I/O

  @edge
  Scenario: R17 — Uncertified WeChat accounts cannot API-publish live and route to operator confirmation
    Given a WeChat account that cannot call freepublish/submit
    When wechatmp-pub is asked to live-publish
    Then it fails loud or pauses for operator confirmation rather than reporting success

  @edge
  Scenario: R18 — x-pub post without developer tokens fails loud
    Given X API credentials are unset
    When x-pub runs the post operation
    Then it exits non-zero and names the missing env vars
    And it does not fall back to browser automation for posts

  @edge
  Scenario: R19 — Agent-browser login timeout fails loud
    Given a browser-agent channel whose session is not logged in
    When the login wait expires
    Then the plugin exits non-zero with a Result that names login timeout
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0141 | Extend publish-harness with browser drivers and FakeBrowserTransport | done |
| 0142 | Ship medium-pub as a file-cli token API channel | done |
| 0143 | Ship wechatmp-pub draft via the official draft API | done |
| 0144 | Ship x-pub with post and article operations | done |
| 0145 | Ship juejin-pub and infoq-pub as browser-agent channels | done |
| 0146 | Ship substack-pub and xhs-pub as browser-agent channels | done |
| 0147 | Add thin kk publish skills and fan-out composition | done |
<!-- END AUTO-GENERATED -->

## Notes

- 2026-09-17 verifyall: 7/7 tasks PASS (0141–0147). Gates: `bun run test` 1142 pass/0 fail, `bun run lint` clean, `spur feature check E7` PASS. One flake observed on first full-suite run (`0110 I2` invoke timeout tree-kill, timing-sensitive, non-E7) — passes isolated and on re-run; watch during future runs. E7 shipped in commits 89a08cf3 + 470ce94c; TCC remainder deferred to F41.

## History

- 2026-09-17T23:52:10.607Z backlog → active (system)
- 2026-09-17T23:52:10.763Z active → verifying (system)
- 2026-09-18T03:16:45.216Z verifying → done (system)

