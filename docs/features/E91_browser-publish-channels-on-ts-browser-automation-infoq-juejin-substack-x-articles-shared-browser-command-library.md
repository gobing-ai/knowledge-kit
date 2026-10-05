---
schema_version: 1
id: "E91"
name: "Browser publish channels on ts-browser-automation (InfoQ, Juejin, Substack, X articles) + shared browser command library"
status: active
priority: P2
tags: []
created_at: "2026-09-30T03:54:58.376Z"
updated_at: "2026-10-05T05:36:59.583Z"
---

# E91: Browser publish channels on ts-browser-automation (InfoQ, Juejin, Substack, X articles) + shared browser command library

## Goal

Turn the stub browser publish channels (InfoQ, Juejin, Substack, and X long-form articles) into real, draft-first publishers built on `@gobing-ai/ts-browser-automation`, backed by a shared browser command library in `@gobing-ai/publish-harness` so every browser channel — including the already-migrated XHS and WeChat MP plugins — shares one session, polling, editor-input, and observed-outcome toolkit. API and CLI channels whose official transports already work stay on them.

## Scope

**In scope**

- Per-plugin verdict recorded in the feature: refactor infoq-pub, juejin-pub, substack-pub, and x-pub article mode; keep medium-pub (integration-token REST), qiita-pub (API v2), zenn-pub (zenn-cli + git sync), and x-pub post mode (API v2 OAuth1) on their current transports, with the reason for each.
- A shared browser command library in `@gobing-ai/publish-harness` (browser sub-module): channel profile-dir resolution with env precedence, a `login|check` profile CLI factory, poll/wait helpers, rich-HTML paste for ProseMirror / X article editors, CodeMirror markdown fill, cover upload via file input, and an observed-outcome helper that never reports unseen success.
- Real Playwright flows via `withProfilePage` / `loginWithProfile` for InfoQ (xie.infoq.cn), Juejin (juejin.cn), Substack, and X articles (x.com/compose/articles): draft by default, explicit publish opt-in, per-channel `profile-check login|check` CLI.
- Behavior-preserving migration of xhs-pub and wechatmp-pub profile-check / poll / paste plumbing onto the shared library.
- Offline tests via injected launchers/fake pages; `docs/04_DESIGN.md` surface updates in the same change.

**Out of scope**

- Browser transports for medium-pub, qiita-pub, zenn-pub, or x-pub post mode (Medium browser fallback deferred until the token path stops working).
- Moving site-specific selectors or flows into the shared library or upstream into ts-libs `ts-browser-automation` (possible later promotion).
- New runtime dependencies beyond packages already in the workspace; credential or password storage; headless-by-default publishing.
- Making live public posts during planning or CI; live dogfood runs are operator-driven drafts.

## Acceptance Criteria

```gherkin
Feature: Browser publish channels on ts-browser-automation

  @core
  Scenario: R1 — Each listed publisher carries a recorded transport verdict with its reason
    # covers: I1, I2, I3
    Given the publishers infoq, juejin, medium, qiita, substack, x, zenn, xhs and wechatmp
    When a maintainer reads the publish surface section of docs/04_DESIGN.md
    Then each publisher lists its transport as browser, API or CLI with a one-line reason
    And medium, qiita, zenn and x post mode state why they stay off the browser path

  @core
  Scenario: R2 — Shared browser library resolves channel profiles and exposes a login and check CLI
    # covers: I4, I5, I6
    Given a channel name, a login URL and a site-owned readiness predicate
    When a plugin builds its profile CLI from the publish-harness browser module
    Then "login" opens a headed browser through loginWithProfile on the resolved profile directory
    And "check" verifies the saved session headlessly and exits 0 when verified or 1 when refused
    And the profile directory follows --profile, then <CHANNEL>_PROFILE_DIR, then KK_BROWSER_PROFILE_DIR, then the default

  @core
  Scenario: R3 — Shared editor helpers insert article bodies into rich and markdown editors
    # covers: I5
    Given a fake page exposing a ProseMirror, a Draft.js style or a CodeMirror editor
    When a plugin calls the paste-HTML or fill-markdown helper with an article body
    Then the editor receives the body through a synthetic paste or the CodeMirror document API
    And the helper returns an error when the editor selector never appears within the timeout

  @core
  Scenario: R4 — Publish results report success only after the browser shows the outcome
    # covers: I4, I5
    Given a publish flow waiting on a site success signal such as a toast or a URL change
    When the signal is not observed before the deadline
    Then the plugin writes a failed Result naming the missing signal and never a success Result

  @core
  Scenario: R5 — InfoQ publisher saves an article draft through a persistent browser profile
    # covers: I1, I4, I6
    Given an authenticated InfoQ profile and a Content with title and markdown body
    When infoq-pub runs with default options
    Then it opens xie.infoq.cn through withProfilePage, fills title and body, and saves a draft
    And the Result carries publishStatus draft with the observed draft URL or id

  @core
  Scenario: R6 — Juejin publisher saves an article draft through a persistent browser profile
    # covers: I1, I4, I6
    Given an authenticated Juejin profile and a Content with title and markdown body
    When juejin-pub runs with default options
    Then it opens the juejin.cn editor through withProfilePage, fills the CodeMirror body, and saves a draft
    And the Result carries publishStatus draft with the observed draft URL or id

  @core
  Scenario: R7 — Substack publisher saves a post draft through a persistent browser profile
    # covers: I1, I4, I6
    Given an authenticated Substack profile, a publication URL and a Content with title and body
    When substack-pub runs with default options
    Then it opens the Substack editor through withProfilePage, pastes the rendered HTML body, and saves a draft
    And the Result carries publishStatus draft with the observed draft URL

  @core
  Scenario: R8 — X article mode saves a long-form draft while post mode keeps the official API
    # covers: I1, I2, I4, I6
    Given an authenticated X profile and a Content routed to the article operation
    When x-pub runs the article operation
    Then it opens x.com/compose/articles through withProfilePage, fills title and body, and saves a draft
    And the post operation still calls the API v2 tweets endpoint without opening a browser

  @core
  Scenario: R9 — Live publishing happens only on explicit request
    # covers: I4
    Given any browser publisher in this feature
    When content.metadata.publishStatus is absent or "draft"
    Then the flow stops at a saved draft and never clicks the site publish control

  @core
  Scenario: R10 — XHS and WeChat MP reuse the shared library without behavior change
    # covers: I3, I5, I6
    Given the existing xhs-pub and wechatmp-pub test suites
    When their profile CLI, polling and paste plumbing move onto the publish-harness browser module
    Then every existing test passes unchanged and their profile directories stay the same

  @edge
  Scenario: R11 — Expired or missing sessions report a login instruction instead of a stack trace
    # covers: I4
    Given a channel profile directory that is absent or whose session has expired
    When a browser publisher runs headlessly
    Then it fails with a message naming the profile-check login command for that channel
    And no cookie, token or profile file content appears in the Result or logs

  @edge
  Scenario: R12 — Medium browser fallback stays deferred until the token path stops working
    # covers: I7
    Given medium-pub publishes through MEDIUM_INTEGRATION_TOKEN
    When the Medium token API keeps accepting posts
    Then no Medium browser transport is added and the deferral is recorded in docs/04_DESIGN.md
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0183 | Shared browser command library in publish-harness with per-channel transport verdict | testing |
| 0184 | Migrate xhs-pub and wechatmp-pub plumbing onto the shared browser module | todo |
| 0185 | InfoQ publisher saves drafts via ts-browser-automation | todo |
| 0186 | Juejin publisher saves drafts via ts-browser-automation | todo |
| 0187 | Substack publisher saves drafts via ts-browser-automation | todo |
| 0188 | X article operation saves drafts via ts-browser-automation | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-30T04:13:51.021Z moved Q → E91 (system)
- 2026-10-05T05:36:59.583Z backlog → active (system)

