---
schema_version: 1
name: Implement named bot list login logout and open lifecycle
status: todo
template: feature-impl
created_at: 2026-10-13T22:24:49.078Z
updated_at: "2026-10-13T22:43:25.672Z"
feature_id: A22
priority: P1
tags:
  - cli
  - browser-session
estimate_hours: 8

ac_altitude: task-local
ac_numbering: task-local
---

## 0276. Implement named bot list login logout and open lifecycle

### Background

Feature A22. Implements: R3 — Cached bot inventory is local and truthful; R4 — Interactive login retains a reusable named session; R5 — Logout removes only the selected inactive local profile; R6 — Open reuses the saved page and permits explicit reauthentication. Design authority: docs/design/kk-noun-verb-bots.md; ADR-037/038. Implement only this deliverable. Use Bun and existing workspace seams; no new runtime or package. Keep docs/04_DESIGN.md and affected authority/derived docs synchronized in the implementation change. Do not edit .github/workflows. Run bun run lint, bun run test, bun run build and affected Spur rules before implementation completion. Preserve partial evidence if the working budget is reached; do not widen scope or manufacture source edits.

**Refine corrections (2026-10-13)**
- Feature R4/R6 were assigned to generic lifecycle and required known-channel completion → channel integration is downstream → add feature R9 for generic save/open and assign R4/R6 to 0277.
- Lease ownership was unspecified across processes → check scripts run in separate processes and share launcher paths → freeze logical owner, scoped delegation and child-holder cleanup.
- In-place or staging mutation had no crash rule → two renames can interrupt → freeze journal phases, rollback and refusal of unresolved transactions.
- Current FileSystem lacks lstat, permission and exclusive-create primitives → direct fs would violate runtime policy → isolate only missing primitives with a narrow rule exception and reuse ordinary IO seams.
- Current CLI build has no Playwright external and harness lists it only as devDependency → installed CLI browser import would not be certified → freeze external build plus existing catalog runtime dependency and isolated package smoke.
- Open --login could return immediately after verification → upstream login closes the context → explicitly reauthenticate then open the saved page until closure.
- Cached inventory and mutation results had no output/exit contract → freeze text rows, BotError mapping and credential-redacted output.
- Unsafe generic root overrides and recursive copies could affect sibling/linked data → fixed bot root, no-follow validation and owned transaction paths are explicit.

Out of scope: implementing other A22 tasks, changing publishing operations, adding a plugin kind/runtime, credential export, server logout, arbitrary caller rewrites, or changes to .github/workflows. Authority: ADR-037/038 and docs/design/kk-noun-verb-bots.md. All changes use the project Bun/Biome conventions and CLI-gated corpus writes. Shared task checks now use Scenario AC with task requirement bindings; feature titles remain stable. No implementation success is claimed by this refinement.

### Requirements

- [ ] R1. Register bot list/login <url> --save <name>/logout <name>/open <name> [--login] under the current CLI factory with lazy browser loading, fixed default profile root and safe names/HTTP(S) URLs. Never let ambient channel/profile env redirect bot deletion.
- [ ] R2. Implement generic headed login with explicit affirmative TTY confirmation and a 180000ms wait, preserving the full supplied URL only for navigation. Refuse unknown-site login without interactive input. Store schemaVersion=1, defaultUrl (origin+pathname), optional pluginName and authenticationEvidence=operator-confirmed|site-verified in bot.json; only generic evidence is produced here.
- [ ] R3. Create/copy inactive profiles in an owned transaction directory, never follow copied symlinks, flush/close before promotion and atomically replace with rollback. A failed login or promotion preserves the existing final profile; a crash leaves a recovery journal/backup and blocks later mutation rather than deleting evidence.
- [ ] R4. Open existing generic profiles headed at their saved default URL until context closure; --login completes the same safe login transaction then reopens the saved page for interaction. Missing/corrupt metadata or profile returns actionable guidance, not an invented fresh session.
- [ ] R5. List only non-symlink profile directories as cached (including legacy unknown-metadata entries); absent root yields success. Logout removes only the selected inactive contained profile and its auxiliary state, returns success when absent, and makes no server-revocation claim.
- [ ] R6. Implement the frozen shared per-profile lease used by every kkBrowserLauncher session and bot mutation, including explicit parent-to-child delegation for 0277. Refuse busy/native-locked or unresolved recovery states; release only ownership belonging to this invocation after owned contexts/children stop.
- [ ] R7. Keep Playwright external to the CLI bundle and resolvable in its installed package: add publish-harness workspace dependency and the existing playwright catalog as a runtime dependency, add the existing ts-runtime catalog dependency to publish-harness for ordinary IO, update bun.lock, and add --external playwright to the CLI build. No browser binary is required for help/list/status.
- [ ] R8. Add filesystem/argv/lifecycle/failure tests, multi-process lease tests and a separate real local-HTTP Chromium session-reuse smoke. Synchronize surface docs and justified low-level boundary policy; tests/build and live-site evidence remain distinct.

### Acceptance Criteria

```gherkin
Feature: Implement named bot list login logout and open lifecycle

  Scenario: AC1 — R3 — Cached bot inventory is local and truthful (req: R1; R8)
    Given an absent or populated ~/.config/kk/browser-profiles directory
    When kk bot list runs
    Then it lists cached regular profile directories including legacy profiles without metadata
    And it returns an empty successful inventory when the root is absent
    And it never launches a browser or claims that a cached profile proves a current login
    And it excludes symlinks and unrelated files without printing credentials

  Scenario: AC2 — R5 — Logout removes only the selected inactive local profile (req: R5; R6; R8)
    Given a named cached bot and sibling profiles
    When kk bot logout NAME runs
    Then it removes that bot's metadata, browser profile and auxiliary authentication state
    And it preserves sibling profiles and refuses traversal, symlink escapes and active profile ownership
    And an absent bot is an idempotent success without creating a directory
    And the result describes local credential removal without claiming server-side session revocation

  Scenario: AC3 — R9 — Generic named sessions can be saved and reopened (req: R2; R3; R4; R6; R7; R8)
    Given an unknown HTTP site and a safe bot name
    When the operator confirms login and later opens that named bot
    Then a headed persistent browser navigates to the supplied login URL and retains reusable state
    And the saved default page reopens until the browser closes
    And authentication evidence remains operator-confirmed rather than site-verified
    And open with --login reauthenticates then opens the saved page for interaction
    And cancellation, contention and failed promotion preserve the previous saved profile
    And browser-free list and help work from the installed CLI without installed browser binaries

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T22:40:58.452Z

Generic sessions are operator-confirmed; site-verified evidence belongs to 0277 adapters. Parent logical leases survive child sessions through scoped delegation. Unknown-site --login saves then reopens; generic saved URL query/fragment is deliberately omitted. Stale leases/incomplete rollback are refused with recovery guidance instead of unsafe automatic deletion. Browser-free inspection still works without browser binaries.

### Design

Chosen shape: apps/cli/src/commands/bot.ts owns arguments, exit mapping and output through the current echo/MainOptions seams. Add packages/publish-harness/src/bot.ts for BotMetadata, BotError, listBots, loginBot, logoutBot and openBot; re-export via existing ./browser. BotError.code is usage|not-found|busy|unconfirmed|persistence|browser; CLI maps usage to exit 2, other failures to 1, success to 0. Text list output is one tab-separated name/cached/defaultUrl-or-unknown row; empty inventory emits no row and exits 0. Successful mutation emits only bot name and outcome, never input query/state/token values. No extra public flags.

Containment: name matches [A-Za-z0-9][A-Za-z0-9_-]{0,63}; reject symlink root/entry/ancestors, path escapes and userinfo/unsafe URLs before effects. Fixed root ~/.config/kk/browser-profiles; new directories 0700 and bot metadata/state files 0600. Preserve valid existing directory modes unless creating owned artifacts. Metadata is validated after JSON parsing; no new validation dependency. Generic defaultUrl strips query/fragment; known channel canonical home URLs are 0277-owned. A legacy bot without metadata is listed, but generic open requests login URL guidance.

Transactions live at ~/.config/kk/browser-transactions/<name>-<uuid> (outside listed profiles): stage/, backup/ and journal.json. Hold the final logical-profile lease across copy/login/close/promotion. Exclude Chromium Singleton* artifacts from copy; refuse other symlinks rather than follow them. Journal phase prepared|old-moved|new-moved records only safe local paths; old-moved failure restores backup, and any incomplete rollback remains intact with recovery guidance. Success removes only this invocation's transaction artifacts. Never reuse transaction directories by name alone. Do not claim resilience against non-cooperating same-user software; supported safety comes from the shared lease plus native singleton refusal.

Lease module: packages/publish-harness/src/profile-lease.ts, with acquireProfileLease(profileDir) returning ProfileLease (id, token, profileDir, release(), delegatedEnv(physicalProfileDir)). Store the lease at ~/.config/kk/browser-leases/<sha256(canonical logical path)>/ via exclusive owner-only mkdir, with owner.json and child holder records. Canonicalization resolves the existing parent for missing profiles. Existing marker/native SingletonLock/SingletonSocket means busy; do not kill browsers or automatically remove stale ownership. Recovery guidance names paths and asks the operator to confirm all recorded PIDs/native browser ownership are gone. release verifies token, ownership and absence of live child holders before deleting its marker.

For generic in-process operations, extend the current createKkBrowserLauncher factory with an optional second ownership argument {lease: ProfileLease, physicalProfileDir: string}; keep its existing first loader argument and returned upstream BrowserLauncher interface compatible. The parent passes this ownership for stage/final contexts, so its own held logical lease is borrowed instead of reacquired. Validate exact physical path/token and let the parent release after context closure; ordinary factory callers still own/release their lease. Share the private browser-launch implementation across owned, borrowed and delegated paths rather than duplicate it.

For 0277 only, delegatedEnv creates scoped child context via private KK_BOT_LEASE_PATH and KK_BOT_LEASE_TOKEN values. Owner record binds exact logical and physical (stage/final) paths; the child validates both plus the live owner token, records its PID holder, and drops only its holder on close. Parent retains/removes the lease. Default kkBrowserLauncher acquires/releases its own lease when no valid scoped delegation exists; it must never interpret arbitrary inherited env as an unrestricted bypass. Validation failure is busy/error, not a second acquisition. A parent crash leaves the lease/holders to refuse later mutation; a child does not release the parent lease. Tokens never appear in output/errors. Launcher closes on errors and attaches close ownership cleanup; do not release a lease while a context/child can still write.

Use ts-runtime FileSystem for ordinary text IO/path/copy/rename. Only exclusive mkdir, lstat/no-follow inspection, permissions and special-profile binary copy primitives absent from that seam belong in the exact private packages/publish-harness/src/bot-fs.ts adapter. Extend the existing runtime-boundaries rule with exact paths and a reason through the rule lifecycle; no broad suppression. BrowserLauncher request/interface remains upstream-compatible; dependencies are injected for deterministic tests, with no product test-root flag.

Ownership: bot command/registration, harness bot/lease modules, launcher cleanup, dependency/build/export changes and tests. No manifest descriptor or channel edits; 0277 consumes these frozen APIs and delegation protocol. Production requireDiff=true. Existing eight-hour estimate is a bounded implementation target, not permission to skip failure coverage.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

Verified source premises: packages/publish-harness/src/browser.ts:111; packages/publish-harness/src/browser.ts:239; packages/publish-harness/src/profile-dir.ts:12; packages/publish-harness/src/index.ts:231; apps/cli/package.json:48; packages/publish-harness/package.json:19; .spur/rules/strict/runtime-boundaries.yaml:162.

### Plan

- [ ] 1. Baseline: verify installed versions, current launcher callers, FileSystem limitations, package build/pack behavior and existing probe/worktree overlap. Rebuild before any packaged smoke evidence.
- [ ] 2. Implement safe-name/URL/metadata validation, private filesystem adapter and lease lifecycle first; cover real concurrent child acquisition and scoped delegation with separate Bun processes.
- [ ] 3. Implement transaction copy/promotion/rollback and generic bot CLI around the shared launcher, using TTY-confirmation and browser seams; never read or write real user profiles in tests.
- [ ] 4. Add packages/publish-harness/tests/bot.test.ts and profile-lease.test.ts plus apps/cli/tests/commands/bot.test.ts/main.test.ts for listing, invalid paths/URLs, metadata, cancellation, busy contexts, signals, copy/close/rename failures, orphan journals and sibling preservation.
- [ ] 5. Add a separate harness script/test using local HTTP+real Chromium to log in, save, close, reopen, re-login through staging and logout; browser installation is an explicit smoke precondition. Do not count fake-launcher tests as cookie portability evidence.
- [ ] 6. Add CLI --external playwright and runtime dependency/lock changes. Extend apps/cli/tests/package.test.ts or a focused package smoke to execute built CLI from an isolated installed layout with no checkout module resolution; verify help/list/status without browser binaries.
- [ ] 7. Sync docs/04_DESIGN.md, A22 satellite and narrowly justified runtime-boundaries policy, then run targeted checks and the required lint/test/build/constraint gates. Leave 0277 a documented delegation/metadata/error contract.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A22; ADR-037/038; docs/design/kk-noun-verb-bots.md.

Current-tree premises: packages/publish-harness/src/browser.ts:111; packages/publish-harness/src/browser.ts:239; packages/publish-harness/src/profile-dir.ts:12; packages/publish-harness/src/index.ts:231; apps/cli/package.json:48; packages/publish-harness/package.json:19; .spur/rules/strict/runtime-boundaries.yaml:162.

Dependency contracts: none.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

### History
