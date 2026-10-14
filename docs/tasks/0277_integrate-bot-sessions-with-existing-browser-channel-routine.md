---
schema_version: 1
name: Integrate bot sessions with existing browser channel routines
status: todo
template: feature-impl
created_at: 2026-10-13T22:24:49.081Z
updated_at: "2026-10-13T22:44:21.573Z"
feature_id: A22
priority: P1
tags:
  - cli
  - browser-session
estimate_hours: 8

dependencies: ["0276"]
ac_altitude: task-local
ac_numbering: task-local
---

## 0277. Integrate bot sessions with existing browser channel routines

### Background

Feature A22. Implements: R4 — Interactive login retains a reusable named session; R6 — Open reuses the saved page and permits explicit reauthentication; R7 — Shared browser behavior and plugin readiness remain compatible. Design authority: docs/design/kk-noun-verb-bots.md; ADR-037/038. Implement only this deliverable. Use Bun and existing workspace seams; no new runtime or package. Keep docs/04_DESIGN.md and affected authority/derived docs synchronized in the implementation change. Do not edit .github/workflows. Run bun run lint, bun run test, bun run build and affected Spur rules before implementation completion. Preserve partial evidence if the working budget is reached; do not widen scope or manufacture source edits.

**Refine corrections (2026-10-13)**
- All browser channels were assigned static homeUrl → Substack resolves an operator-configured publication → make homeUrl optional and freeze Substack matching/config/default rules.
- Podcast/Xiaoyuzhou association was unverified → podcast-pub uses MicrofeedClient and no Xiaoyuzhou publisher exists → classify API paths and retain generic Xiaoyuzhou login.
- Existing check spawn API accepted only check/login with no profile/url/env → direct reuse could not carry bot state → explicitly extend that shared argv-array seam and preserve its current callers.
- Parent final-profile lease plus child launcher could deadlock or release foreign ownership → consume 0276 scoped delegation/holders instead of independently reacquiring or deleting the parent lease.
- Generic URL sanitization dropped Juejin editor version and publication routing → retain only plugin-owned canonical defaults for known adapters; never save arbitrary supplied/auth query.
- Preserve XHS accounting did not define new open behavior → existing login is uncapped and check is counted → open is operator-interactive like login, with no fake check/publish event.
- Upstream login helper closes the browser → it cannot implement interactive open → add site-owned open routines that restore/navigate and wait until closure.

Out of scope: implementing other A22 tasks, changing publishing operations, adding a plugin kind/runtime, credential export, server logout, arbitrary caller rewrites, or changes to .github/workflows. Authority: ADR-037/038 and docs/design/kk-noun-verb-bots.md. All changes use the project Bun/Biome conventions and CLI-gated corpus writes. Shared task checks now use Scenario AC with task requirement bindings; feature titles remain stable. No implementation success is claimed by this refinement.

### Requirements

- [ ] R1. Add optional browserSession={profileName,homeUrl?} metadata to publish manifests and resolved records; require check, safe profileName and HTTP(S) homeUrl without userinfo when present. Preserve discovery union/conflict handling and static plugin status without browser loading.
- [ ] R2. Bind known adapter selection in order: saved pluginName; unique declared profileName matching bot name; unique exact homeUrl origin. Reject ambiguous/unavailable saved adapters rather than silently using generic restoration. For no match use generic operator-confirmation. Substack omits fixed homeUrl and is selected by declared substack name or saved pluginName.
- [ ] R3. Extend check-script protocol with open --profile DIR --url URL and login optional --url, plus inherited scoped lease env from 0276. Preserve legacy login/check argv, plugin env precedence, outputs and exit semantics; site login exit 0 requires its predicate and persisted/closed state. Plain open waits for context closure without asserting authentication; open --login uses login transaction then open.
- [ ] R4. Integrate all seven current check-enabled browser plugins through their existing routines; keep WeChat capture/restore and XHS check visit accounting. New XHS open is an operator-interactive uncapped session like login and must not fabricate a check or publish visit.
- [ ] R5. Keep plugin status/check/login contracts and API execution unchanged. Explicitly classify X post as API and X article as browser, podcast-pub as microfeed API, and Xiaoyuzhou as generic/no current connector. Do not add a Xiaoyuzhou publisher as part of this task.
- [ ] R6. Add manifest/registry, subprocess argv/env/status, adapter, storage-state and package isolation tests; support configured Substack/custom domains and Juejin canonical version query while redacting supplied URL queries. Sync changed schema/protocol/docs and expose no secrets.

### Acceptance Criteria

```gherkin
Feature: Integrate bot sessions with existing browser channel routines

  Scenario: AC1 — R4 — Interactive login retains a reusable named session (req: R1; R2; R3; R4; R5; R6)
    Given a valid HTTP or HTTPS URL and a safe bot name
    When kk bot login URL --save NAME runs and the operator completes authentication
    Then a headed browser explicitly navigates to that supplied URL through the shared launcher
    And a known channel uses its owned authentication and state persistence behavior
    And an unknown site requires explicit interactive confirmation and is labeled operator-confirmed
    And successful completion records a non-secret default URL and reusable authentication artifacts under that bot directory
    And cancellation, timeout or persistence failure never reports authentication success or destroys an existing saved session
    And invalid names, credential-bearing URLs, unsafe schemes and missing interactive input fail with actionable errors

  Scenario: AC2 — R6 — Open reuses the saved page and permits explicit reauthentication (req: R2; R3; R4; R6)
    Given a saved bot with a default URL and cached browser state
    When kk bot open NAME runs
    Then it opens that page headed with the same profile and remains available for operator interaction until browser closure
    And it preserves channel-specific authentication-state restoration
    And kk bot open NAME --login enters the interactive login path and updates the saved evidence on success
    And missing profiles or unknown legacy default URLs return actionable guidance without opening a fresh profile
    And browser errors, interruption and contention release owned resources without deleting another process's locks

  Scenario: AC3 — R7 — Shared browser behavior and plugin readiness remain compatible (req: R1; R3; R4; R5; R6)
    Given existing WeChat MP, XHS, X, other browser channels and podcast transports
    When named bots and plugin session commands operate on the same supported channel profile
    Then they reuse the existing launcher and documented profile resolution rules
    And plugin status remains static and plugin check retains its site-owned readiness contract
    And plugin login remains supported with its existing plugin-name arguments and options
    And WeChat MP storage-state capture and restoration survive session reuse
    And API-only or incompatible podcast paths remain explicitly classified without forced browser conversion

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T22:41:20.291Z

No fixed Substack home URL is invented. Descriptor homeUrl is optional; declared substack name/saved binding selects its adapter, and unknown custom-domain names remain generic. Known defaults come from plugin-owned config, preserving Juejin v=2 while refusing to save auth grants. XHS open is uncapped operator interaction like login. No Xiaoyuzhou adapter is claimed or added. Parent/child lease delegation is upstream-owned by 0276.

### Design

Depends on 0276: consume BotMetadata/BotError APIs, transaction stage/final paths and ProfileLease.delegatedEnv; do not replace its root/ownership algorithm. This task completes full feature R4/R6/R7 after generic lifecycle exists. Add browserSession only to kind publish with a check entry. The descriptor type is BrowserSessionDescriptor (profileName:string, homeUrl?:string); registry exposes it on PluginRecord. No new plugin entry/module import. Preserve homeUrl literal site constants for infoq/juejin/x/weibo/xhs/wechatmp; Substack has profileName=substack and no fixed homeUrl because its existing config derives publication URL from --publication or SUBSTACK_PUBLICATION_URL.

Selection order: metadata.pluginName (must resolve matching session capability) -> unique descriptor.profileName == requested bot name -> unique input-URL origin matching a literal descriptor.homeUrl. Saved plugin absence/invalid capability refuses rather than generic fallback, because special state could be lost. Duplicate identity/origin matches refuse. Unknown names/sites remain generic. For named bots the explicit stage/final --profile wins over plugin env; plugin login/check without bot args keep their existing resolver precedence.

Extend PluginProbeSpawnOptions and the existing argv builder/spawn seam in apps/cli/src/invoke.ts with the open mode, optional profileDir/url and scoped child env; keep all existing call sites unchanged. Use inherited stdio for interactive modes. Existing plugin login/check paths retain their current exit behavior. Bot commands map child usage failures to BotError usage/exit 2 and other nonzero or signaled outcomes to operational exit 1, naming the observed child outcome without leaking URL/env values; a child failure never becomes successful promotion. The parent holds 0276's logical lease; launcher validates delegated path/token and owns only its child holder. A child exit0 on URL login means plugin predicate passed, special state was persisted and the context closed successfully, so the parent may promote and record site-verified. Cancellation/crash refuses promotion. No plugin receives arbitrary shell source, and logs redact URL userinfo/query and private lease env.

For shared runProfileCli-based adapters add optional url in config/options without embedding site selectors. Default old login/check behavior is unchanged. Implement open using a context that navigates then remains until close; do not use loginWithProfile for open because it immediately closes after the predicate. Shared type/interface calls must stay compatible with installed ts-browser-automation 0.5.24. For WeChat factor the existing openWithState/openWechatLogin paths, preserve the settle interval and storage-state.json save/reinjection, and permit an initial navigation URL; do not duplicate storage logic in CLI. Plain open restores state and navigates, while an expired session can remain visible for manual interaction without a verified claim.

Substack: legacy --publication/SUBSTACK_PUBLICATION_URL resolution remains. In bot mode derive the publication root from the supplied URL origin, validate via resolvePublicationUrl, then navigate the supplied URL and use channelConfig for readiness. After successful login save a non-secret plugin-owned canonical editor URL, not an auth redirect. Generic custom bot names on an undeclared custom domain remain generic unless named substack or already bound by metadata; document this deliberate matching limit. Legacy metadata-free Substack profiles require login URL guidance rather than a fabricated publication default.

Default URLs: generic sessions save origin+pathname only. For known adapters, choose the declared/configured canonical home/editor URL after success, including only the plugin's fixed non-secret navigation query (Juejin v=2). Never persist the supplied URL query, OAuth callback fragments or token-bearing final page URL. A metadata-free fixed-profile bot can use the unique descriptor homeUrl. Descriptor config is trusted plugin code; validate/redact data boundaries regardless.

XHS login/open are explicitly operator-interactive and uncapped like today's login; check remains guard.allow/check + guard.record/check and publish retains its own policy. No browser conversion for X API posts or microfeed. No current Xiaoyuzhou browser connector exists in plugins/publishings; generic URL login is still supported. Concurrency note: earlier WeChat worktree may land session improvements, so re-read before factoring it.

Ownership: kk-core manifest/registry/exports+tests; bot adapter dispatch and invoke spawn extension; shared profile CLI; seven plugin manifests/profile-check/index session routines and tests; bundle/package fixtures and docs. Upstream 0276 API changes only when a demonstrated adapter need requires the smallest compatible extension, documented in task evidence. No bulk caller migration (0278). Production requireDiff=true; existing eight-hour estimate is bounded. Leave 0278 a per-channel behavior and supported/retained-path matrix.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

Verified source premises: packages/kk-core/src/manifest.ts:27; packages/kk-core/src/registry.ts:16; apps/cli/src/invoke.ts:151; plugins/publishings/substack-pub/src/profile-check.ts:66; plugins/publishings/substack-pub/src/index.ts:127; plugins/publishings/wechatmp-pub/src/index.ts:73; plugins/publishings/xhs-pub/src/profile-check.ts:57; plugins/publishings/podcast-pub/src/index.ts:58; scripts/bundle-plugins.ts:103.

### Plan

- [ ] 1. Re-read completed 0276 contracts, seven current check scripts and exact site/session functions; note concurrent WeChat changes before editing. Freeze expected old plugin check/login outputs and guards.
- [ ] 2. Add/validate BrowserSessionDescriptor to manifest/registry, define matching and legacy-default behavior, then add argv-array profile/url/delegation support to the existing invoke spawn builder.
- [ ] 3. Extend shared profile CLI and simple channel wrappers; implement Substack publication-scoped URL handling. Factor WeChat state-preserving open/login and XHS operator-interactive open separately, preserving current check/publish accounting.
- [ ] 4. Extend packages/kk-core/tests/manifest.test.ts/registry.test.ts, apps/cli/tests/invoke.test.ts and commands/plugin-check.test.ts plus bot tests for capability matching, ambiguity, missing adapters, explicit profile path and child exit/delegation behavior.
- [ ] 5. Extend each plugins/publishings/<channel>/tests/profile-check.test.ts (create where absent) and shared browser tests to observe URL navigation, predicate waits, context lifetime and state persistence. Verify WeChat write-before-close/restore-before-navigation, and XHS unchanged check counters; do not mock away the function carrying these behaviors.
- [ ] 6. Run local real-browser smoke through a fixture check script and transaction parent; run installed package smoke proving manifest/check bundling and metadata survive outside checkout. Sync descriptor/protocol docs and channel recipes, run required checks, and hand classification evidence to 0278.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A22; ADR-037/038; docs/design/kk-noun-verb-bots.md.

Current-tree premises: packages/kk-core/src/manifest.ts:27; packages/kk-core/src/registry.ts:16; apps/cli/src/invoke.ts:151; plugins/publishings/substack-pub/src/profile-check.ts:66; plugins/publishings/substack-pub/src/index.ts:127; plugins/publishings/wechatmp-pub/src/index.ts:73; plugins/publishings/xhs-pub/src/profile-check.ts:57; plugins/publishings/podcast-pub/src/index.ts:58; scripts/bundle-plugins.ts:103.

Dependency contracts: 0276.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

### History
