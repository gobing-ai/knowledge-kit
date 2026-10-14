---
schema_version: 1
name: Integrate bot sessions with existing browser channel routines
status: done
template: feature-impl
created_at: 2026-10-13T22:24:49.081Z
updated_at: "2026-10-14T07:55:57.171Z"
feature_id: A22
priority: P1
tags:
  - cli
  - browser-session
estimate_hours: 8

dependencies: ["0276"]
ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0277-verdict.json
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

- [x] R1. Add optional browserSession={profileName,homeUrl?} metadata to publish manifests and resolved records; require check, safe profileName and HTTP(S) homeUrl without userinfo when present. Preserve discovery union/conflict handling and static plugin status without browser loading.
- [x] R2. Bind known adapter selection in order: saved pluginName; unique declared profileName matching bot name; unique exact homeUrl origin. Reject ambiguous/unavailable saved adapters rather than silently using generic restoration. For no match use generic operator-confirmation. Substack omits fixed homeUrl and is selected by declared substack name or saved pluginName.
- [x] R3. Extend check-script protocol with open --profile DIR --url URL and login optional --url, plus inherited scoped lease env from 0276. Preserve legacy login/check argv, plugin env precedence, outputs and exit semantics; site login exit 0 requires its predicate and persisted/closed state. Plain open waits for context closure without asserting authentication; open --login uses login transaction then open.
- [x] R4. Integrate all seven current check-enabled browser plugins through their existing routines; keep WeChat capture/restore and XHS check visit accounting. New XHS open is an operator-interactive uncapped session like login and must not fabricate a check or publish visit.
- [x] R5. Keep plugin status/check/login contracts and API execution unchanged. Explicitly classify X post as API and X article as browser, podcast-pub as microfeed API, and Xiaoyuzhou as generic/no current connector. Do not add a Xiaoyuzhou publisher as part of this task.
- [x] R6. Add manifest/registry, subprocess argv/env/status, adapter, storage-state and package isolation tests; support configured Substack/custom domains and Juejin canonical version query while redacting supplied URL queries. Sync changed schema/protocol/docs and expose no secrets.

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

- [x] 1. Re-read completed 0276 contracts, seven current check scripts and exact site/session functions; note concurrent WeChat changes before editing. Freeze expected old plugin check/login outputs and guards.
- [x] 2. Add/validate BrowserSessionDescriptor to manifest/registry, define matching and legacy-default behavior, then add argv-array profile/url/delegation support to the existing invoke spawn builder.
- [x] 3. Extend shared profile CLI and simple channel wrappers; implement Substack publication-scoped URL handling. Factor WeChat state-preserving open/login and XHS operator-interactive open separately, preserving current check/publish accounting.
- [x] 4. Extend packages/kk-core/tests/manifest.test.ts/registry.test.ts, apps/cli/tests/invoke.test.ts and commands/plugin-check.test.ts plus bot tests for capability matching, ambiguity, missing adapters, explicit profile path and child exit/delegation behavior.
- [x] 5. Extend each plugins/publishings/<channel>/tests/profile-check.test.ts (create where absent) and shared browser tests to observe URL navigation, predicate waits, context lifetime and state persistence. Verify WeChat write-before-close/restore-before-navigation, and XHS unchanged check counters; do not mock away the function carrying these behaviors.
- [x] 6. Run local real-browser smoke through a fixture check script and transaction parent; run installed package smoke proving manifest/check bundling and metadata survive outside checkout. Sync descriptor/protocol docs and channel recipes, run required checks, and hand classification evidence to 0278.

### Solution

Task 0277 binds named bot sessions to the seven check-enabled browser channels (A22 R1–R6) in five code chunks plus a verification chunk. Change map:

**Manifest + registry (chunk 1, R1)**

- `packages/kk-core/src/manifest.ts:23` — `BrowserSessionDescriptorSchema`: strict `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` profileName, optional http(s) `homeUrl` rejected when it carries userinfo or a fragment, and `superRefine` requiring `kind: publish` plus a `check` entry so a descriptor without a session routine cannot validate; `:26` optional `browserSession` field.
- `packages/kk-core/src/registry.ts:26` — `PluginRecord.browserSession`; `:407` propagation through discovery. A malformed descriptor drops the plugin with a diagnostic, leaving the multi-root union and shadowing rules untouched, and `plugin status` still never loads browser code.

**Check-script protocol (chunk 2, R3)**

- `apps/cli/src/invoke.ts:151` — probe subcommand widened to `'check' | 'login' | 'open'`; `:158` `--url` session target; `:234` `spawnPluginSession()` inherits stdin/stderr, pipes stdout for the verdict channel, and maps a spawn throw to exit 2.
- `packages/publish-harness/src/browser.ts:69` — `runProfileCli` gains `open` (requires explicit `--profile` + `--url`, else exit 2) and `login --url`; `:386` `openChannelSession` refuses a missing profile, launches headed, waits for context close and asserts no authentication. Legacy `login`/`check` argv, plugin-env precedence, outputs and exit semantics are unchanged, and the scoped lease env from 0276 is inherited rather than re-acquired.
- `packages/publish-harness/src/browser.ts:845` — `BotAdapterRunRequest`; `:861` `BotAdapterSession`; `:944` `runAdapterLogin` (exit 2 → usage, nonzero → browser failure, parsed verdict → `site-verified` metadata and commit without an operator prompt); `:1034` `parseAdapterVerdict` (http(s), credential-free, fragment dropped); `:1182` `readBotSavedMetadata`.

**Adapter selection (chunk 3, R2)**

- `apps/cli/src/bot-adapter.ts:27` — `selectBotAdapter` resolves in the declared order: saved `pluginName` (unavailable → refusal, never silent generic), unique declared `profileName` matching the bot name, then unique `homeUrl` origin. Ambiguity is a refusal; no match falls back to generic operator-confirmation. Substack declares no fixed `homeUrl` and so binds by declared name or saved `pluginName` only; `:123` `bindAdapterSession`.
- `packages/publish-harness/src/bot.ts:91` — `isStoredDefaultUrl`: a stored default URL keeps its query only when a `pluginName` justifies it (Juejin's canonical `?v=2`), so an operator-supplied query is never mistaken for a channel grant.
- `apps/cli/src/commands/bot.ts:80` — `botLoginAction`; `:104` `botOpenAction` (saved binding when metadata carries one, legacy fixed profile via descriptor `homeUrl`, publication-scoped legacy guided to login); `:138` `registerBotCommand`.

**Plugin integration (chunk 4, R4)**

- Seven manifests carry descriptors: `plugins/publishings/{infoq,juejin,substack,weibo,x,xhs,wechatmp}-pub/plugin.json` (discovery reports zero diagnostics).
- `plugins/publishings/substack-pub/src/profile-check.ts:36` — `botSessionUrl`; `:46` `urlOrigin` derive the publication from the bot-supplied `--url` origin, so a custom domain reopens the session it was saved under.
- `plugins/publishings/wechatmp-pub/src/index.ts:133` — `openWechatSession` restores captured storage state, lands on the console and waits for one close; `plugins/publishings/wechatmp-pub/src/profile-check.ts:47` routes the `open` verb and refuses when no stored state exists.
- `plugins/publishings/xhs-pub/src/profile-check.ts:84` — `openXhsSession` is a headed operator-interactive visit that records no automation guard, fabricates no check and no publish visit.

**Classification (chunk 5, R5)**

No code change: X post stays API and X article browser, podcast-pub stays a microfeed API transport (no descriptor), Xiaoyuzhou has no connector and no publisher is added, and generic URL login remains the operator-confirmed path. The R5/AC3 contract tests pass unmodified.

**Tests + carry-over fixes (chunk 6/7, R6)**

- `packages/kk-core/tests/manifest.test.ts` (+5) and `registry.test.ts` (+3); `packages/publish-harness/tests/bot-session.test.ts:469+` (+4: plugin-fixed query retention, child-failure mapping, open lease release, generic-query refusal), `bot.test.ts` (+2 logout-leftover), `profile-lease.test.ts:106+` (+2 dead-child residue guidance), `browser.test.ts` runProfileCli open / login --url; `apps/cli/tests/bot-adapter.test.ts` (7), `apps/cli/tests/invoke.test.ts:928+` (3 subprocess), `apps/cli/tests/commands/bot.test.ts` (14); plugin suites xhs (+3), wechatmp (+3), substack (+3).
- `packages/publish-harness/src/profile-lease.ts:86` — `busyGuidance`/`holderResidue` messages name a dead child's residue instead of a live holder (0276 review P3).
- `packages/publish-harness/src/bot-transaction.ts:200` — `findLeftoverTransaction`; `packages/publish-harness/src/bot.ts:300` `logoutBot` reports the persistence refusal and deletes nothing when a profile is absent but a leftover transaction exists (0276 review P3).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `BrowserSessionDescriptorSchema` (`packages/kk-core/src/manifest.ts:23`) is strict: profileName `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, optional homeUrl refined to http(s) with no userinfo/fragment, and a `superRefine` requiring `kind: publish` plus a `check` entry. `PluginRecord.browserSession` is propagated during discovery (`packages/kk-core/src/registry.ts:26,407`) with a malformed descriptor dropped to a diagnostic, leaving the multi-root union and shadowing contract intact. `plugin status` reads only name/entry/check/desc (`apps/cli/src/commands/plugin.ts`) and never imports browser code. Evidence: `bun test packages/kk-core/tests/{manifest,registry}.test.ts` (40 pass). |
| R2 | MET | `selectBotAdapter` (`apps/cli/src/bot-adapter.ts:27-143`) resolves saved pluginName (unavailable/non-session refuses, never a silent generic fallback), then a unique declared profileName equal to the bot name, then a unique literal homeUrl origin; ambiguity is a refusal and no match stays generic operator-confirmed. Substack declares no homeUrl, so it binds only by declared name or saved pluginName (a custom-domain URL never selects it). `bindAdapterSession` (`apps/cli/src/bot-adapter.ts:123`) then drives the plugin child. Evidence: `bun test apps/cli/tests/bot-adapter.test.ts` (7 pass) incl. the Substack-never-matches-by-URL row. |
| R3 | MET | `spawnPluginSession` (`apps/cli/src/invoke.ts:234`) inherits stdin/stderr, pipes stdout as the verdict channel, forwards `--profile`/`--url` only for bot sessions, and maps a spawn throw to exit 2; `pluginEntryEnv` layers the 0276 scoped lease env over `process.env`. `runProfileCli` (`packages/publish-harness/src/browser.ts`) adds `open` (requires explicit `--profile` + `--url`, else exit 2) and `login --url`, emitting the bot-mode `{status:'verified', profileDir, defaultUrl}` verdict line on success. The two custom login verbs (wechatmp `plugins/publishings/wechatmp-pub/src/profile-check.ts:77`, xhs `plugins/publishings/xhs-pub/src/profile-check.ts:163`) emit the same last-line verdict in bot mode only, defaulting to their plugin-owned canonical URL (`CONSOLE_URL`, `PUBLISH_URL`); operator mode and the legacy check argv/exit semantics are byte-identical. `runAdapterLogin` (`:944`) maps exit 2 to usage and other nonzero to browser failure, persists `site-verified` evidence plus the verdict's canonical defaultUrl without a prompt, and `parseAdapterVerdict` (`:1034`) enforces http(s) and credential-free. Probe: `bun plugins/publishings/xhs-pub/src/profile-check.ts open` → exit 2 with the usage line and an `error` verdict. |
| R4 | MET | All seven check-enabled publish plugins declare `browserSession` and route the `open` verb: infoq, juejin, substack, wechatmp, weibo, x, xhs (`plugins/publishings/*/plugin.json`, discovery reports zero diagnostics). WeChat storage-state capture survives the new path (`openWechatLogin` writes `storage-state.json`, `openWechatSession` re-injects it, `plugins/publishings/wechatmp-pub/src/index.ts:133`) and XHS `open` records no automation-guard visit, fabricating neither a check nor a publish visit (`plugins/publishings/xhs-pub/src/profile-check.ts:84`). The verdict gap that broke adapter login for wechatmp/xhs was found in review (P1) and fixed, with 4 new failure-sensitive tests (wechatmp 10 pass, xhs 117 pass). |
| R5 | MET | Tree-verified classification, not report-trusted: X `post` remains API v2 (`TWEETS_URL`) while `article` is the browser transport; `podcast-pub/plugin.json` declares no `browserSession` and publishes through `MicrofeedClient`; no Xiaoyuzhou plugin or publisher exists in `plugins/publishings/`; generic URL login remains the operator-confirmed path. No plugin status/check/login contract changed (the 0216/R5/AC3 contract tests pass unmodified). |
| R6 | MET | Coverage breadth added and green: manifest/registry validation, subprocess argv/env/status (`apps/cli/tests/invoke.test.ts`), adapter selection/ambiguity (`apps/cli/tests/bot-adapter.test.ts`), storage-state capture/restore (`plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts`), package isolation (registry shadowing), configured Substack custom domains and Juejin `?v=2` retention, and query redaction (the supplied URL never reaches `bot.json`). Re-run this verify: `bun test` over the 26 kk-core/publish-harness/CLI/plugin files touched by 0277 → 794 pass / 0 fail. Docs synced: `docs/04_DESIGN.md` §1.12 (channel binding + bot-mode verdict contract), all seven channel recipe spellings now `login\|check\|open … [--url <url>]`, and the shared `runProfileCli` API row (`docs/04_DESIGN.md:1165`); no stale `login\|check` spelling remains outside closed task records. No secret is persisted or printed: the lease token stays in the owner-only `owner.json` and the child env, and the operator's URL is never echoed into failures or metadata. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R4 — Interactive login retains a reusable named session (req: R1; R2; R3; R4; R5; R6) | MET |  | A bound channel runs the plugin's own login inside the leased staging profile and persists only the plugin-owned canonical defaultUrl from the child's last-line verdict (`packages/publish-harness/src/browser.ts:944-1045`), producing `site-verified` evidence; an unmatched site stays generic and operator-confirmed (`apps/cli/src/bot-adapter.ts:27`). Evidence: bot-session adapter tests (plugin-fixed query retention, child-failure mapping), the new wechatmp/xhs bot-mode verdict tests, and invoke argv/env subprocess tests — all green in the 794-test re-run. |
| AC2 — R6 — Open reuses the saved page and permits explicit reauthentication (req: R2; R3; R4; R6) | MET |  | `openBot` reopens the saved defaultUrl headed and stays until the context closes; `--login` completes the login/save transaction then reopens; a missing or unknown legacy profile returns guidance without inventing a fresh profile (`packages/publish-harness/src/browser.ts`, openBot + `isStoredDefaultUrl` at `packages/publish-harness/src/bot.ts:91`); `openChannelSession` waits for context closure and asserts no authentication. Evidence: `packages/publish-harness/tests/bot-session.test.ts` (open lease release, open-in-bot-mode rows), `apps/cli/tests/commands/bot.test.ts` (14 pass), plus the `bot open --help` probe showing `--login` without any browser launch. |
| AC3 — R7 — Shared browser behavior and plugin readiness remain compatible (req: R1; R3; R4; R5; R6) | MET |  | Named bots and plugin session commands share the one launcher and documented profile-resolution rules; plugin status stays static and plugin check keeps its site-owned readiness contract (the 0216 probe tests pass unmodified); WeChat storage-state capture/restore survives session reuse; API-only paths stay classified. Evidence: `bun test` over the seven plugin suites plus `browser.test.ts` (60 pass) — 794 pass / 0 fail in the verify re-run — and the full gate PASS bound to this tree. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0277
**Scope:** Focused RE-REVIEW of the fix for the P1 raised in the prior review (this file @ 00:29). Delta = 5 files only, confirmed by mtime (every other modified file has mtime ≤ 2026-10-13 23:58:34, before the review): `plugins/publishings/wechatmp-pub/src/profile-check.ts`, `plugins/publishings/xhs-pub/src/profile-check.ts`, `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`, `docs/04_DESIGN.md`. `.spur/run/` is gitignored; the working tree diff vs HEAD is unchanged in scope from the prior review apart from those five files.
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P1 (blocker) | correctness | **RESOLVED.** Both previously-broken adapters now emit the bot-mode login verdict. wechatmp `login` echoes `{status:'verified', profileDir, defaultUrl: CONSOLE_URL}` and xhs `login` echoes `{status:'verified', profileDir, defaultUrl: PUBLISH_URL}` as the LAST stdout line when `--url` is supplied (bot mode), immediately after the human `… login verified: <dir>` line. Verified end-to-end, not just at the emit site: `bindAdapterSession.run` → `spawnPluginSession` → `pluginProbeCmd` appends `--profile <stageDir> --url <url>` (apps/cli/src/invoke.ts:169-178) → the plugin `main` emits the line (wechatmp :77, xhs :163) → `runAdapterLogin` reads `parseAdapterVerdict(child.stdout)` (browser.ts:1034) → `parseAdapterVerdict` (browser.ts:1061-1084) accepts it: `status === 'verified'`, `defaultUrl` is a string, parses as a URL, `http(s)`, no username/password. The persisted value is the plugin-owned constant — `CONSOLE_URL = 'https://mp.weixin.qq.com/'` (wechatmp modes.ts:23), `PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish'` (xhs modes.ts:26) — never `sessionUrl`, so the operator's supplied URL and any query it carried can never become the persisted `defaultUrl`. The prior "exited 0 but returned no usable defaultUrl verdict" failure path is closed for both channels. | `plugins/publishings/wechatmp-pub/src/profile-check.ts:72-79`; `plugins/publishings/xhs-pub/src/profile-check.ts:158-165` vs `packages/publish-harness/src/browser.ts:1005-1084` | RESOLVED |
| 2 | P3 (minor) | docs | **RESOLVED.** §1.12 re-titled `bot — shipped (A22; tasks 0276, 0277)` (:947); the `kk bot login` comment corrected to "a matched channel adapter saves site-verified evidence without a prompt, otherwise operator confirmation (0277)" (:958-959); a new "Channel binding (0277)" bullet describes the descriptor/selection order and "persists only the verdict's canonical, plugin-owned `defaultUrl` — never the operator's URL, its query included" (:979-984) — which matches the code (the emit uses `CONSOLE_URL`/`PUBLISH_URL` constants, not `sessionUrl`). All seven session-plugin recipes now spell `login|check|open … [--url <url>]` (wechatmp :1256, weibo :1307, xhs :1313, infoq :1323, juejin :1325, substack :1327, x :1329); zero remaining `login|check` (without `open`) recipe spellings. | `docs/04_DESIGN.md:947-984`, `:1256`, `:1307/:1313/:1323/:1325/:1327/:1329` | RESOLVED |
| 3 | P4 (advisory) | docs | **NEW.** The publish-harness API reference row for the shared `runProfileCli` still spells the CLI as `login\|check [--profile <dir>] [--timeout <ms>] [--headed]` — omitting the now-shipped `open` verb and `--url` flag that the code (browser.ts:422-448) and every channel recipe document. This is the shared-function summary table, not one of the seven session-plugin recipes, so it was outside finding 2's cited scope; it is a residual doc drift only, no code defect. | `docs/04_DESIGN.md:1165` | OPEN |

##### Requirement verdicts (with evidence)

- **R1 — MET (unchanged).** `BrowserSessionDescriptorSchema` / `consumeManifest` / discovery are in `packages/kk-core/src/{manifest,registry}.ts`, whose mtimes (23:34:14) predate the fix — byte-identical to the prior PASS. Nothing in the delta touches manifest/registry.
- **R2 — MET (unchanged).** `selectBotAdapter` (apps/cli/src/bot-adapter.ts, mtime 23:10:07) is unchanged from the prior PASS; `bindAdapterSession.run` (:128-139) is the seam the fix relies on and was already present.
- **R3 — MET (was PARTIAL).** The protocol plumbing (`spawnPluginSession` pipes stdout, `runAdapterLogin`/`parseAdapterVerdict`) was already correct; the prior gap was that wechatmp/xhs `login` never emitted the verdict line. That gap is now closed (finding 1 RESOLVED), so "site login exit 0 → persist canonical defaultUrl" holds for all seven channels. `open` is unaffected.
- **R4 — MET (was PARTIAL).** All seven manifests carry `browserSession` and all seven `check` scripts route `open`; wechatmp storage-state capture/restore and xhs no-guard-record `open` are preserved. The prior gap (wechatmp/xhs adapter *login* broken) is closed by finding 1.
- **R5 — MET (unchanged).** No `xiaoyuzhou` plugin added; `podcast-pub` has no `browserSession`; `x-pub` `post` stays API v2. None of these files are in the delta.
- **R6 — MET (gap now covered).** The previously-uncovered path (wechatmp/xhs bot-mode `login` verdict) is now covered by four new tests: `wechatmp-profile-check.test.ts` "login in bot mode emits the canonical defaultUrl verdict as the LAST stdout line" + "login without --url keeps the operator-mode output (no verdict line)"; `xhs-pub.test.ts` "login in bot mode emits the canonical defaultUrl verdict as the LAST stdout line (0277 R3)" + "login without --url keeps the operator-mode output (no verdict line, 0277 R3)". Both bot-mode tests genuinely fail without the fix: they `JSON.parse` the LAST stdout line, which without the fix is the non-JSON human line `… login verified: <dir>` (JSON.parse throws → test fails). Both assert the operator URL's query never appears in the output. Targeted runs: `bun test plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts` → 10 pass, 0 fail; `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` → 117 pass, 0 fail.
- **Operator-mode invariance (item 3).** `login` without `--url` leaves `sessionUrl === undefined`, so both plugins emit only the single human line and return 0 — byte-for-byte the pre-fix output (the added `--url` parse option is inert on that path). `kk plugin check` runs the `check` subcommand via `spawnPluginProbe`, which never forwards `--url` (invoke.ts:171-175); the `check` branch in both files is untouched, so its last-line JSON verdict is unchanged. `kk plugin login` runs `login` via `spawnPluginLogin` (inherited stdio, exit-code-only) and `LoginOptions` has no `--url`, so it is always operator mode.
- **Carried 0276 P3 fixes — MET (unchanged).** `profile-lease.ts` / `bot-transaction.ts` / `bot.ts` mtimes predate the fix; no change.
- **Out-of-scope swap — intent preserved (unchanged).** `voice2-dag.test.ts` (mtime 23:58:34) predates the fix.

##### Residual risk

- Live headed-browser behavior (QR scan, storage-state settle, WAF 451, XHS console readiness) remains proven by fakes/launcher stubs only — no real-site dogfood in this review (consistent with the task's note that live dogfood is operator-driven).
- The `runProfileCli` API-reference row (finding 3) is still stale — one-line doc follow-up, non-blocking.
- wechatmp/xhs `--url` on `login` acts as the bot-mode signal, not a navigation override (navigation stays plugin-fixed to `CONSOLE_URL`/`PUBLISH_URL`) — the accepted channel-owned behavior noted in the prior review; the persisted URL is always the plugin-owned constant, so this is harmless.

##### Blocking count
`blocking: 0`

### References

Feature A22; ADR-037/038; docs/design/kk-noun-verb-bots.md.

Current-tree premises: packages/kk-core/src/manifest.ts:27; packages/kk-core/src/registry.ts:16; apps/cli/src/invoke.ts:151; plugins/publishings/substack-pub/src/profile-check.ts:66; plugins/publishings/substack-pub/src/index.ts:127; plugins/publishings/wechatmp-pub/src/index.ts:73; plugins/publishings/xhs-pub/src/profile-check.ts:57; plugins/publishings/podcast-pub/src/index.ts:58; scripts/bundle-plugins.ts:103.

Dependency contracts: 0276.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

### History

- 2026-10-14T07:55:05.544Z todo → wip (system)
- 2026-10-14T07:55:05.946Z wip → testing (system)
- 2026-10-14T07:55:57.165Z testing → done (system)

