---
schema_version: 1
name: Implement named bot list login logout and open lifecycle
status: done
template: feature-impl
created_at: 2026-10-13T22:24:49.078Z
updated_at: "2026-10-14T05:09:40.746Z"
feature_id: A22
priority: P1
tags:
  - cli
  - browser-session
estimate_hours: 8

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0276-verdict.json
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

- [x] R1. Register bot list/login <url> --save <name>/logout <name>/open <name> [--login] under the current CLI factory with lazy browser loading, fixed default profile root and safe names/HTTP(S) URLs. Never let ambient channel/profile env redirect bot deletion.
- [x] R2. Implement generic headed login with explicit affirmative TTY confirmation and a 180000ms wait, preserving the full supplied URL only for navigation. Refuse unknown-site login without interactive input. Store schemaVersion=1, defaultUrl (origin+pathname), optional pluginName and authenticationEvidence=operator-confirmed|site-verified in bot.json; only generic evidence is produced here.
- [x] R3. Create/copy inactive profiles in an owned transaction directory, never follow copied symlinks, flush/close before promotion and atomically replace with rollback. A failed login or promotion preserves the existing final profile; a crash leaves a recovery journal/backup and blocks later mutation rather than deleting evidence.
- [x] R4. Open existing generic profiles headed at their saved default URL until context closure; --login completes the same safe login transaction then reopens the saved page for interaction. Missing/corrupt metadata or profile returns actionable guidance, not an invented fresh session.
- [x] R5. List only non-symlink profile directories as cached (including legacy unknown-metadata entries); absent root yields success. Logout removes only the selected inactive contained profile and its auxiliary state, returns success when absent, and makes no server-revocation claim.
- [x] R6. Implement the frozen shared per-profile lease used by every kkBrowserLauncher session and bot mutation, including explicit parent-to-child delegation for 0277. Refuse busy/native-locked or unresolved recovery states; release only ownership belonging to this invocation after owned contexts/children stop.
- [x] R7. Keep Playwright external to the CLI bundle and resolvable in its installed package: add publish-harness workspace dependency and the existing playwright catalog as a runtime dependency, add the existing ts-runtime catalog dependency to publish-harness for ordinary IO, update bun.lock, and add --external playwright to the CLI build. No browser binary is required for help/list/status.
- [x] R8. Add filesystem/argv/lifecycle/failure tests, multi-process lease tests and a separate real local-HTTP Chromium session-reuse smoke. Synchronize surface docs and justified low-level boundary policy; tests/build and live-site evidence remain distinct.

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

- [x] 1. Baseline: verify installed versions, current launcher callers, FileSystem limitations, package build/pack behavior and existing probe/worktree overlap. Rebuild before any packaged smoke evidence.
- [x] 2. Implement safe-name/URL/metadata validation, private filesystem adapter and lease lifecycle first; cover real concurrent child acquisition and scoped delegation with separate Bun processes.
- [x] 3. Implement transaction copy/promotion/rollback and generic bot CLI around the shared launcher, using TTY-confirmation and browser seams; never read or write real user profiles in tests.
- [x] 4. Add packages/publish-harness/tests/bot.test.ts and profile-lease.test.ts plus apps/cli/tests/commands/bot.test.ts/main.test.ts for listing, invalid paths/URLs, metadata, cancellation, busy contexts, signals, copy/close/rename failures, orphan journals and sibling preservation.
- [x] 5. Add a separate harness script/test using local HTTP+real Chromium to log in, save, close, reopen, re-login through staging and logout; browser installation is an explicit smoke precondition. Do not count fake-launcher tests as cookie portability evidence.
- [x] 6. Add CLI --external playwright and runtime dependency/lock changes. Extend apps/cli/tests/package.test.ts or a focused package smoke to execute built CLI from an isolated installed layout with no checkout module resolution; verify help/list/status without browser binaries.
- [x] 7. Sync docs/04_DESIGN.md, A22 satellite and narrowly justified runtime-boundaries policy, then run targeted checks and the required lint/test/build/constraint gates. Leave 0277 a documented delegation/metadata/error contract.

### Solution

Task 0276 ships the generic named-bot lifecycle (A22 R4–R7) in four chunks. Change map:

**Harness foundations (chunk 1)**

- `packages/publish-harness/src/bot-fs.ts:25` — private no-follow/exclusive/owner-only fs primitives (`lstat`/`realpath`/`mkdirExclusive` 0700/`copyProfileEntry`/`rmdir`); the only file allowed raw node:fs, per rule allowlist `.spur/rules/strict/runtime-boundaries.yaml:171`.
- `packages/publish-harness/src/profile-lease.ts:17` — `browser-leases` lease root; exclusive shared per-profile lease (acquire at `:74`), with parent/child-scoped delegation; stale/foreign ownership is refused with recovery guidance, never silently removed.
- `packages/publish-harness/src/bot.ts:19` — fixed default profile root const `browser-profiles`; `:52` safe-name rule `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`; `:69` URL normalization (http/https only, embedded credentials refused, fragments stripped); `:103` `bot.json` metadata parse (schemaVersion/defaultUrl/optional pluginName/authenticationEvidence).

**Inventory, logout, staged transactions (chunk 2)**

- `packages/publish-harness/src/bot.ts:233` — `listBots`: direct non-symlink profile dirs only; legacy dirs surface `unknown`; absent root is an empty success.
- `packages/publish-harness/src/bot.ts:301` — `logoutBot`: deletes only the owned, inactive, contained profile; absent bot is idempotent success; symlinked profiles refused, never followed.
- `packages/publish-harness/src/bot-transaction.ts:76` — `beginBotTransaction`: staging under `~/.config/kk/browser-transactions/<name>-<uuid>/stage` (`:21`), copy excludes Chromium singleton artifacts and refuses symlinks; promotion is a same-filesystem rename with a restorable backup and crash-safe journal.

**Browser sessions, launcher ownership, CLI (chunk 3)**

- `packages/publish-harness/src/browser.ts:823` / `:894` — `loginBot`/`openBot` run over the staged transaction while holding the shared lease; `open` never invents a session for a missing/legacy/corrupt profile; `open --login` completes the transaction and then reopens the saved page.
- `packages/publish-harness/src/browser.ts:167` — `createKkBrowserLauncher` gains explicit ownership modes (borrowed/delegated/self-acquired) so bot operations reuse the already-held logical lease instead of reacquiring; `:42` re-exports the bot surface from `./browser`.
- `apps/cli/src/commands/bot.ts:110` — `kk bot list|login|logout|open` registrar; `:30` lazy harness import keeps `--help`/`list` browser-free; `:55` frozen exit contract (`BotError` `usage`→2, otherwise→1) with `kk.bot.failed: <detail>` on stderr; `:68` tab-separated `name/cached/defaultUrl|unknown` list rows.
- `apps/cli/src/cli.ts:29` — the `bot` noun registers visibly; `apps/cli/src/main.ts:56` keeps 0275's stage normalization intact alongside the new group.

**Packaging closure (chunk 4, R7)**

- `packages/publish-harness/package.json:17` and `:19` — `@gobing-ai/ts-runtime` and `playwright` declared as explicit catalog runtime dependencies; `bun.lock` delta is exactly these edges.
- `apps/cli/package.json:42` — build passes `--external playwright`, so the browser engine is never bundled into the CLI; installed-layout smoke ran `--help`, `bot list` and `plugin status` without any browser binary.

**Evidence**

- Suites: `packages/publish-harness/tests/{bot,bot-transaction,bot-session,profile-lease}.test.ts`, `apps/cli/tests/commands/bot.test.ts`, `apps/cli/tests/main.test.ts` — 138 pass / 0 fail at chunk-3 close; harness + CLI `tsc --noEmit` clean; biome clean on all chunk paths.
- Installed-package smoke: built CLI (`--external playwright`), packed and extracted outside the checkout; surface probes incl. symlinked-profile refusal (exit 2) and idempotent logout `removed`→`absent`.
- Real-browser smoke: `.spur/run/0276-bot-session-smoke.ts` — local HTTP site, real headed Chromium: login/save → reopen (cookie portability) → re-login through staging → reopen → close → logout; 6/6 PASS.
- Docs: `docs/04_DESIGN.md` §1.12, `docs/design/kk-cli-surface.md`, `docs/design/kk-noun-verb-bots.md` shipped-so-far updated; 0277 channel integration and 0278 caller migration remain explicitly unshipped.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/bot.ts` registers list/login/logout/open with lazy browser loading; fixed root wins over ambient env; registrar at (`apps/cli/src/commands/bot.ts:110`); `listBots` (`packages/publish-harness/src/bot.ts:233-247`). Probes: help browser-free; absent-root list exit 0 empty; `logout ../../etc` exit 2 with name-pattern refusal. |
| R2 | MET | Headed login requires affirmative TTY confirmation + 180000ms wait (bot-session tests). `parseBotMetadata` (`packages/publish-harness/src/bot.ts:103`) validated live: schemaVersion=1, defaultUrl origin+pathname, authenticationEvidence operator-confirmed\|site-verified; only operator-confirmed produced by this implementation. |
| R3 | MET | Staged transaction with rollback (`bot-transaction.ts:21,76`), lstat-guarded symlink-free copies (`bot-fs.ts`), atomic promotion preserving prior profile; crash journal/backup blocks later mutation (bot-transaction.test.ts); smoke PASS 3 re-login via staging. |
| R4 | MET | openBot reopens saved URL until context closure; --login re-authenticates then reopens (smoke PASS 4 cookie portability, PASS 5 close preserves profile). Corrupt metadata → actionable per-entry `metadataError`, never an invented fresh session (`packages/publish-harness/src/bot.ts:214`, metadataError). |
| R5 | MET | Inventory lists only non-symlink dirs incl. legacy (live seeded probe: alpha-legacy unknown URL, beta-with-meta URL), absent root empty exit 0; logout removes only selected inactive contained profile, idempotent when absent, no server-revocation claim; credentials never in list output. |
| R6 | MET | Shared lease with explicit parent-to-child delegation (`profile-lease.ts:17,20,73`, KK_BOT_LEASE_TOKEN); multi-process race + busy/native-lock refusal tests; launcher ownership tri-mode (`browser.ts:162,818,889`). P3 residue-message deferral to 0277. |
| R7 | MET | playwright + ts-runtime catalog deps in publish-harness, playwright runtime dep in CLI, --external playwright build, bun.lock edges; publish-manifest mirror 4 private workspaces; packed installed-layout smoke browser-free help/list/status. |
| R8 | MET | bot-fs/bot/bot-transaction/profile-lease/session/CLI tests (gate: all files >=90/90); real local-HTTP Chromium smoke re-executed 6/6 SMOKE-OK at verify; docs synced (04_DESIGN §1.12, kk-cli-surface, kk-noun-verb-bots shipped-so-far); runtime-boundaries.yaml bot-fs entry. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R3 — Cached bot inventory is local and truthful (req: R1; R8) | MET |  | `packages/publish-harness/tests/bot-fs.test.ts` (6 real-FS tests, 100/100 coverage) + live seeded-root/absent-root probes this verify; no browser launch, no credential output. |
| AC2 — R5 — Logout removes only the selected inactive local profile (req: R5; R6; R8) | MET |  | CLI + harness bot tests (sibling preservation, traversal/symlink/active refusals, idempotent absent, local-only wording) + smoke PASS 6; traversal probe exit 2. |
| AC3 — R9 — Generic named sessions can be saved and reopened (req: R2; R3; R4; R6; R7; R8) | MET |  | Real-browser smoke re-executed at verify: 6/6 PASS (login/save, reopen cookie portability ×2, --login staging, close preservation, logout); transaction-preservation tests; packed installed-layout browser-free probes. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0276
**Scope:** working-tree diff vs HEAD, task 0276 files only: new `packages/publish-harness/src/{bot-fs,profile-lease,bot,bot-transaction}.ts` plus `browser.ts` (bot sessions, launcher ownership, re-exports); new `apps/cli/src/commands/bot.ts` + `cli.ts` registration; `packages/publish-harness/package.json`, `apps/cli/package.json`, `bun.lock`; tests `packages/publish-harness/tests/{bot,bot-fs,bot-transaction,bot-session,profile-lease,browser}.test.ts`, `apps/cli/tests/commands/bot.test.ts`, `apps/cli/tests/main.test.ts` (0276 hunks), `apps/cli/tests/commands/stage.test.ts` (external-playwright hunk only), `scripts/publish-manifest.test.ts`; `.spur/rules/strict/runtime-boundaries.yaml`; docs `04_DESIGN.md` §1.12, `kk-cli-surface.md`, `kk-noun-verb-bots.md`. 0275's already-reviewed changes (stage/lock/store, main-normalization hunks, `docs/features/INDEX.md`, 0275 task docs) excluded per scope; the A22 feature-file diff is pipeline status bookkeeping, not implementation.
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | A crashed delegated child leaves its `holder-<pid>.json` behind; the parent's clean `release()` deletes only `owner.json` and silently ignores the `rmdir` result (`bot-fs.ts:55` `rmdir` returns `false` on ENOTEMPTY), so the lease dir survives and every later `acquireProfileLease` refuses (`profile-lease.ts:235`) with "no owner record — a previous run may have crashed mid-acquire". That mis-describes the cause (child crash after a completed acquire/release, not a crashed acquire) and doesn't name the holder file; recovery (confirm no browser, remove the dir) is nonetheless correct, and no production delegation exists before 0277. | `packages/publish-harness/src/profile-lease.ts:202-216,235` | DEFER (0277 owns the delegation protocol; refusal-with-guidance is the design intent — only the message accuracy/residue is off) |
| 2 | P3 (minor) | correctness | `logoutBot` (`bot.ts:301`) never consults leftover transaction state: after a crash between `old-moved` and `new-moved` the final profile is absent (data safe in the transaction `backup/`), so `kk bot logout <name>` reports idempotent `absent` success while the credentials survive in `~/.config/kk/browser-transactions/<name>-<uuid>/backup`. Login is correctly refused in that state; logout could surface the same leftover guidance before the operator removes the dir by hand. No data loss in the logout path itself. | `packages/publish-harness/src/bot.ts:301-305` | DEFER (0277 owns mutation integration) |
| 3 | P4 (advisory) | architecture | Import cycle `bot.ts` ↔ `profile-lease.ts` (`acquireProfileLease` vs `BotError`) — safe today only because both bindings are used inside function bodies (84 targeted tests re-run green + full gate PASS); a future module-evaluation-time use on either side would fail with a TDZ error. A leaf error module would cut it. | `packages/publish-harness/src/bot.ts:5` | ACCEPTED (0277 extends this surface) |
| 4 | P4 (advisory) | correctness | `copyProfileEntry` treats every non-symlink non-directory entry as a regular file, so a FIFO planted in a profile would block the staging copy indefinitely (`copyFileSync` opens it for reading). Same-user non-cooperating software is explicitly out of scope (design §Transactions) and Chromium profiles carry no FIFOs. | `packages/publish-harness/src/bot-fs.ts:82-93` | ACCEPTED |
| 5 | P4 (advisory) | usability | `loginBot` opens the headed browser and navigates before the confirmation seam runs, so a non-TTY invocation gets its `unconfirmed` refusal only after a browser-window attempt (which then fails again without a display). Nothing is ever saved and the refusal is tested; checking `process.stdin.isTTY` before launch would avoid the pointless window. | `packages/publish-harness/src/browser.ts:823-860,999` | ACCEPTED |
| 6 | P4 (advisory) | traceability | The installed-layout claim (built CLI runs `--help`/`bot list`/`plugin status` browser-free with no checkout resolution) is evidenced by a recorded manual packed-smoke, not a repeatable test; the regression guard is indirect — `package.test.ts` runs the real prepack build, which fails if playwright re-enters the graph (same rationale as the fixture build's `external: ['playwright']`). | `apps/cli/tests/commands/stage.test.ts:269` | ACCEPTED |
| 7 | P4 (advisory) | — | Wrap summary — no P1–P2 findings. Reviewed the 0276 set end-to-end: containment (safe names, http(s)-only + userinfo-refusing URL normalization, symlink/traversal refusal, ambient-`KK_BROWSER_PROFILE_DIR` deletion neutrality tested at `packages/publish-harness/tests/bot.test.ts:315`), credential hygiene (query/fragment never persisted, supplied URL never echoed — `<login-url>` redaction verified), staged transaction incl. injected-failure rollback and orphan-journal refusal, lease acquire/contention/native-lock/delegation incl. a real two-bun-process race, launcher ownership tri-mode sharing one private launch path, CLI exit/output contract, packaging closure (prod + fixture `--external playwright`, bun.lock delta exactly the declared edges), docs/rule sync. 84 targeted tests re-run green this review (46 harness + 26 session/CLI + 12 main tree-shape); quality receipt `.spur/run/0276-check-receipt.json` PASS (runId 342950cf…); real-browser smoke 6/6 attested with the script verified at `.spur/run/0276-bot-session-smoke.ts`. | `packages/publish-harness/src/browser.ts:823-955` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — bot list/login/logout/open registered, lazy browser load, fixed root, safe names/URLs, no ambient redirect of deletion | MET | `apps/cli/src/cli.ts:29`; `apps/cli/src/commands/bot.ts:110` (group, exactly list/login/logout/open, only `--save`/`--login`; pinned `apps/cli/tests/commands/bot.test.ts:62`); lazy import `apps/cli/src/commands/bot.ts:30` (help never loads the harness — `bot.test.ts:283`); fixed root `packages/publish-harness/src/bot.ts:19`; validators `bot.ts:52-99,169-198`; ambient-env neutrality `packages/publish-harness/tests/bot.test.ts:315`. |
| R2 — 180000 ms affirmative TTY confirmation; full URL only for navigation; frozen bot.json schema | MET | `browser.ts:768` (`180_000`); `loginBot` `browser.ts:823-892` (navigates the trimmed supplied URL `:828`, persists only origin+pathname); `confirmBotLogin` `browser.ts:999` (non-TTY refusal); `normalizeBotDefaultUrl`/`parseBotMetadata` `bot.ts:69-141`; tests `bot-session.test.ts:153` (full-URL navigation, redaction, 0700/0600 modes, no SEKRET in metadata), `:273` (TTY affirm), `:209` (cancel saves nothing). |
| R3 — owned staged transaction, no-follow copy, flush-then-promote, atomic rename + rollback, crash evidence preserved | MET | `bot-transaction.ts:76-133` (fresh `<name>-<uuid>`, leftover refusal `:80,195`); promote `:135-158` (old→backup `:142`, stage→final `:152`); rollback `:113-133` (restore-or-preserve, `evidenceIntact`); no-follow/singleton-skip copy `bot-fs.ts:82` + `bot-transaction.ts:161-172`; ordering test `bot-transaction.test.ts:126` (close before promote); rollback/intact-journal tests `:113,154,177`. |
| R4 — open headed at saved URL until closure; --login re-logins then reopens; actionable guidance, never a fresh session | MET | `openBot` `browser.ts:894-955` (`--login` `:901-905`, close-promise attached before navigate `:917`); `missingBotProfile` guidance `browser.ts:957-966`; tests `bot-session.test.ts:366` (reopen-until-close, lease held/open), `:386` (--login two launches), `:410` (missing/legacy/corrupt refusals, profile untouched). |
| R5 — list non-symlink dirs incl. legacy `unknown`, absent root success; logout only the selected inactive contained profile, idempotent, no server claim | MET | `listBots` `bot.ts:233-299` (root/entry symlink refusal `:240-256`, per-entry metadataError); `logoutBot` `bot.ts:301-325` (lease-guarded `:307`, no-revocation message `:322`); tests `bot.test.ts:236-333` (symlink/file exclusion, legacy listed, corrupt metadata listed not aborted, sibling preservation, busy on active lease `:300`, idempotent absent). |
| R6 — shared per-profile lease for every kkBrowserLauncher session and bot mutation; scoped delegation; busy/native/unresolved refusal; owned release only | MET | `acquireProfileLease` `profile-lease.ts:74` (exclusive mkdir `:106-110`, native-lock refusal `:316-330`), `enterDelegatedLease` `:125-165` (token+physical binding), `verifyLeaseHeld` `:167`, release verification `:202-216`; launcher tri-mode `browser.ts:167-206` + `claimLaunchOwnership` `:252-287` (borrowed never releases `:266-269`, env honored only with a matching owner record), close-attached release `:290-298`; tests `profile-lease.test.ts:94` (two-process race), `browser.test.ts:907,911-999` (borrowed/delegated/init-failure/release-failure). |
| R7 — playwright external to the CLI bundle and resolvable in the installed package; deps/lock/--external closure; browser-free help/list/status | MET | `apps/cli/package.json:42` (`--external playwright`), `:45-53` (publish-harness workspace dep + playwright catalog runtime dep); `packages/publish-harness/package.json:17-19` (ts-runtime + playwright moved to runtime deps); `bun.lock:31-88` delta exactly those edges; fixture build parity `apps/cli/tests/commands/stage.test.ts:269`; playwright imports in ts-browser-automation are type-only/lazy, so the lazy CLI chain holds; installed packed-smoke recorded in the task Solution (finding 6). |
| R8 — fs/argv/lifecycle/failure tests, multi-process lease tests, separate real-browser smoke, docs + boundary-rule sync | MET | New suites: `bot.test.ts` (332 ln), `bot-fs.test.ts`, `bot-transaction.test.ts`, `bot-session.test.ts` (451 ln), `profile-lease.test.ts`, CLI `bot.test.ts` + `main.test.ts` tree-shape; multi-process `profile-lease.test.ts:94` + `tests/fixtures/lease-acquire-probe.ts`; real local-HTTP + headed-Chromium smoke `.spur/run/0276-bot-session-smoke.ts` (6/6 attested); docs `docs/04_DESIGN.md:947` (§1.12) + `:110` (surface row), `docs/design/kk-cli-surface.md:87-113`, `docs/design/kk-noun-verb-bots.md:12-21`; exact-path rule entry `.spur/rules/strict/runtime-boundaries.yaml:166-171`. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — R3 — Cached bot inventory is local and truthful (req: R1; R8) | MET | test | `packages/publish-harness/tests/bot.test.ts:236-260` (legacy listed `unknown`, symlinks/stray files excluded, every row `cached`), `:263` (absent root = empty success, nothing created), `:285` (corrupt metadata listed with per-entry error, no abort); CLI rows `apps/cli/tests/commands/bot.test.ts:186-207` (tab-separated, empty inventory prints nothing, exit 0). No browser launch anywhere in the list path (lazy-import source test `apps/cli/tests/commands/bot.test.ts:291`). |
| AC2 — R5 — Logout removes only the selected inactive local profile (req: R5; R6; R8) | MET | test | `bot.test.ts:270-298` (sibling preserved, traversal/`a/b`/symlink refused untouched, idempotent absent creates nothing, busy on active lease), `:315` (ambient env cannot redirect deletion); message claims local removal only (`bot.ts:322`, asserted no-revocation at `bot.test.ts:278`). |
| AC3 — R9 — Generic named sessions can be saved and reopened (req: R2; R3; R4; R6; R7; R8) | MET | test + attested smoke | Save/reopen/cancel/contention/promotion-failure: `bot-session.test.ts:153,209,298-364` + `bot-transaction.test.ts:113-186`; `open --login` reauthenticates then reopens: `bot-session.test.ts:386`; evidence stays `operator-confirmed`: `bot.test.ts:126-176` + `bot-session.test.ts:187`; browser-free list/help from the built CLI: `--external playwright` in prod + fixture builds, manual packed-smoke recorded (finding 6); real cookie portability: attested 6/6 run of `.spur/run/0276-bot-session-smoke.ts` (kept distinct from tests per R8). |

**Next:** none blocking — 0 P1/P2. P3 #1/#2 deferred to 0277 (which owns the delegation protocol and mutation integration); P4 #3-#7 accepted. HIGH confidence is earned by: every requirement row MET with code+test evidence, all findings dispositioned, 84 fresh targeted test executions green this review, and the quality receipt artifact verified on disk (PASS, runId 342950cf-2ee3-4a23-be26-18a1f5c015e1); the two attested-not-rerun items (13-min full gate, real-browser smoke) are upstream pipeline inputs whose artifacts exist and match the recorded run.

### References

Feature A22; ADR-037/038; docs/design/kk-noun-verb-bots.md.

Current-tree premises: packages/publish-harness/src/browser.ts:111; packages/publish-harness/src/browser.ts:239; packages/publish-harness/src/profile-dir.ts:12; packages/publish-harness/src/index.ts:231; apps/cli/package.json:48; packages/publish-harness/package.json:19; .spur/rules/strict/runtime-boundaries.yaml:162.

Dependency contracts: none.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

### History

- 2026-10-14T05:05:07.241Z todo → wip (system)
- 2026-10-14T05:08:52.194Z wip → testing (system)
- 2026-10-14T05:09:40.732Z testing → done (system)

