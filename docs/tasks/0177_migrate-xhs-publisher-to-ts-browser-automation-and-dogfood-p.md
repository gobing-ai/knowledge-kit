---
schema_version: 1
name: Migrate XHS publisher to ts-browser-automation and dogfood profile reuse
status: done
template: feature-impl
created_at: 2026-09-27T04:10:35.333Z
updated_at: "2026-09-28T01:17:32.590Z"
feature_id: E9

ac_numbering: task-local
estimate_hours: 6
---

## 0177. Migrate XHS publisher to ts-browser-automation and dogfood profile reuse

### Background

E8 is done and its real XHS draft/live flow is validated. The current XHS image-post publisher launches Playwright through `@gobing-ai/publish-harness` (`plugins/publishings/xhs-pub/src/index.ts:303-326`), while the harness returns an `unknown` context from `launchPersistentBrowser` (`packages/publish-harness/src/index.ts:299-330`). The first consumer of `@gobing-ai/ts-browser-automation` should replace that launcher and prove the shared profile API against the existing XHS flow. This task begins after the upstream ts-libs package is built and available through a pinned published version or a local development link; the final manifest must use the normal `@gobing-ai/*` package dependency, not a sibling-repo relative import.

XHS is the correct dogfood target because it has an actual Playwright script driver and browser-observed outcomes. `x-pub` article, Substack, Juejin, and InfoQ retain `sessionReady` scaffolds; Medium uses an API. Their migrations are excluded until they have working browser flows.

### Requirements

- [x] R1. Replace XHS's use of `publish-harness.launchPersistentBrowser` with typed `@gobing-ai/ts-browser-automation` in the existing `makeDefaultOpenPage` seam. Preserve the injectable launcher and `OpenPage` test seam, `context.pages()[0] ?? context.newPage()`, context closure, and XHS-specific `wrapPlaywrightPage`/closed-shadow `createShadowProbe` logic. Remove the harness launcher after its callers are migrated; keep harness `trySelectors` and `resolveBrowserProfileDir` where still used.
- [x] R2. Preserve the current profile resolution exactly: `options.profileDir` wins over `XHS_PROFILE_DIR`, then `KK_BROWSER_PROFILE_DIR`, then `~/.config/kk/browser-profiles/xhs`; existing profile contents are reused in place. Keep headed login for an absent/expired session, `loginTimeoutMs`, and the existing actionable browser-install/login failure result. Do not copy profiles or credentials.
- [x] R3. Preserve all E8 publish semantics: input images are validated before browser launch; ordered `setInputFiles`; count/title/body evidence; draft by default; public only on explicit `publishStatus: 'public'`; no synthetic success, retry of public submit, or guessed URL/ID. Preserve the fake transport and `driver: 'agent'` failure behavior.
- [x] R4. Prove the upstream package against XHS with offline tests and a manual dogfood recipe: use its headed login helper with an XHS-owned readiness predicate, reuse the existing profile, recover from an expired session, and open that profile in a later headless read-only check. A headless site refusal is an explicit failed readiness result, never a false success. Automated tests must not contact XHS or use a real account; any live draft run requires the operator's account and records only nonsensitive result evidence. Do not run a live public post for this refactor.
- [x] R5. Add the new dependency following this repo's package/catalog conventions and update `docs/04_DESIGN.md`, `docs/design/xhs-image-cards.md`, and relevant publish instructions in the same implementation change. Explain the shared package boundary and profile setup without exposing secrets. Run the project gate and task/feature checks.

### Acceptance Criteria

- [x] AC1 — XHS publisher uses the shared browser package with the existing profile path (req: R1, R2)
- [x] AC2 — XHS draft and explicit public routing preserve browser-observed results (req: R3)
- [x] AC3 — Login and browser failures remain actionable without leaking profile material (req: R2, R4)
- [x] AC4 — A later headless read-only profile check reports verified session or explicit site refusal (req: R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-27T04:11:07.886Z

- Dependency ordering: upstream ts-libs task must finish before this task can be executed; this cross-repo dependency is recorded here because Spur task deps are local to one project.
- Package name: `@gobing-ai/ts-browser-automation`; keep `~/.config/kk/browser-profiles/xhs` as a knowledge-kit default, not an upstream library default.
- First dogfood: XHS image-post publisher (`xhs-pub`), not the `kk:xhs-images` card-generation skill.
- Headless scope: verify profile reuse with a read-only readiness check; keep XHS publish headed until a separate reliability decision has live evidence.
- Live operations: implementation may use an operator-controlled draft smoke; a public post is outside this refactor's verification scope.

### Design

Keep `XhsBrowserTransport` and its injected `OpenPage(profileDir)` contract. Change only `makeDefaultOpenPage`'s default launcher to the upstream typed `openPersistentBrowser({ profileDir, headless: false })`, retaining its current page selection, XHS page wrapper, `newCDPSession` probe, and `close` function. This is the narrow migration path and keeps existing fake-page coverage. The XHS-specific login gate and publish action stay in the plugin; the package does not know the creator console DOM or `Result` contract. In the publish harness, remove the old generic launcher and its direct launcher test after all callers have moved; retain its kk-specific profile resolver and selector helper, which are still used by other channels. The published package is external to the kk bundle if Playwright remains external; verify `scripts/bundle-plugins.ts` and runtime dependency resolution rather than assuming workspace dev dependencies ship.

For the new headless capability, test a read-only authenticated probe separately from the publish path. Do not flip XHS publishing to headless by default during this migration: headed remains the demonstrated login/recovery behavior and avoids changing live publish semantics. No profile export/import, cross-site auth guessing, or platform action DSL is added.

### Plan

1. Verify the upstream package build/import and published version or local link. Record the exact dependency version selected in knowledge-kit's manifest/catalog and lockfile; avoid a sibling-repo source import.
2. Change the XHS launch seam and package dependency, remove the old harness launcher/export and update its tests. Keep XHS page/CDP wrappers intact. Confirm all `launchPersistentBrowser` callers have been migrated before deletion.
3. Run focused offline tests for preserved profile precedence, headed launcher options, context close on failures, ordered upload, draft/public routing, and error messages. Add one read-only headless profile reuse test with a fake launcher and a documented local manual check; no actual account data in test artifacts.
4. Update the surface/design and publish instructions under the project constitution, then run `bun run lint`, `bun run test`, `bun run build`, `spur rule run`/`bun run gate`, and `spur task check <wbs> --json`. Review the final diff for intentional files only.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/publish-harness/src/index.ts:196` |
| `packages/publish-harness/src/index.ts:282` |
| `packages/publish-harness/tests/harness.test.ts:0` |
| `packages/publish-harness/tests/harness.test.ts:217` |
| `plugins/publishings/xhs-pub/src/index.ts:11` |
| `plugins/publishings/xhs-pub/src/index.ts:15` |
| `plugins/publishings/xhs-pub/src/index.ts:17` |
| `plugins/publishings/xhs-pub/src/index.ts:20` |
| `plugins/publishings/xhs-pub/src/index.ts:298` |
| `plugins/publishings/xhs-pub/src/index.ts:317` |
| `plugins/publishings/xhs-pub/src/index.ts:320` |
| `plugins/publishings/xhs-pub/src/index.ts:5` |
| `plugins/publishings/xhs-pub/src/index.ts:565` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1143` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:17` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:29` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:4` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:530` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:532` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:7` |
| `scripts/bundle-plugins.ts:74` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | file:line: plugins/publishings/xhs-pub/src/index.ts:11 (`openPersistentBrowser` import from `@gobing-ai/ts-browser-automation`), :311–312 (`defaultLauncher = openPersistentBrowser`), :319–342 (seam preserved: injectable launch :320, headed launch :325, actionable launch-failure message :326–330, `pages()[0] ?? newPage` :337, `createShadowProbe` :338, `wrapPlaywrightPage`+`ctx.close` :339); harness launcher removed — repo-wide grep: zero code refs to `launchPersistentBrowser`, only historical docs; kept `resolveBrowserProfileDir` packages/publish-harness/src/index.ts:231–240 and `trySelectors` :254; old harness test deleted packages/publish-harness/tests/launch.test.ts (diff −26); scripts/bundle-plugins.ts:74–77 peer note updated |
| R2 | MET | file:line: plugins/publishings/xhs-pub/src/index.ts:534–538 (options.profileDir → XHS_PROFILE_DIR → KK_BROWSER_PROFILE_DIR → `resolveBrowserProfileDir`), harness default `~/.config/kk/browser-profiles/<channel>` packages/publish-harness/src/index.ts:239 (no copy, no creation); login gate via shared `isXhsConsoleReady` index.ts:301–307, waitUntil with `loginTimeoutMs` :563–570; tested: xhs-pub.test.ts `xhs-pub profile precedence (preserved, 0177)` — 4 tests covering all precedence tiers incl. default channel profile |
| R3 | MET | file:line: validation before launch index.ts:539–547; `driver: 'agent'` hard-fail :529–533; ordered `setInputFiles` :603; thumbnail-count evidence :606–617; title fill :619–626; TipTap type-not-fill body :628–646; draft default, public only on explicit `publishStatus: 'public'` :542; draft success requires observed save (counter/timestamp), no synthetic success :655–668; fake transport untouched. Tested: pre-existing draft/public routing + live-confirmation suites retained in xhs-pub.test.ts (all passing in gate) |
| R4 | MET | file:line: profile-check.ts:40–70 (`checkProfileSession`: headless reopen, XHS-owned predicate, catch → explicit `refused`, never fabricated — upstream launcher never creates a profile headless), :76–90 (`loginProfile` headed via upstream `loginWithProfile`); shared readiness predicate index.ts:301–307. Tested: `xhs-pub headless profile-session check` (verified/refused/missing-profile/headed-login-recovery/login-timeout, all asserting context closed) + `xhs-pub profile-check CLI` (exit codes, JSON verdict on stdout, refusal detail on stderr, usage errors). Manual recipe: docs/design/xhs-image-cards.md + plugins/kk/skills/publish/SKILL.md:36–47. Automated tests use fake launchers only — no XHS contact, no account data |
| R5 | MET | file:line: plugins/publishings/xhs-pub/package.json:10 (`@gobing-ai/ts-browser-automation: catalog:` — normal `@gobing-ai/*` dep, no sibling import), root package.json:19 (catalog `^0.5.11`), bun.lock (`@gobing-ai/ts-browser-automation@0.5.11`, peer playwright ^1.55.0); docs/04_DESIGN.md updated (launcher moved/removal note), docs/design/xhs-image-cards.md updated (recipe + bundle note), SKILL.md:36–47 (profile setup, no secrets); scripts/bundle-plugins.ts:74–77. Recorded: .spur/run/0177-test-gate.log (full gate PASS at this digest) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | index.ts:311–312 binds upstream API; :320/:325 preserve seam + headed launch; :534–538 + harness :239 preserve profile path; tested: `default launcher routes through @gobing-ai/ts-browser-automation` (binding + `{profileDir, headless:false}` + close) and the 4 precedence tests — offline, no browser |
| AC2 | MET | test | Retained draft/public suites in xhs-pub.test.ts (incl. `xhs-pub live publish confirmation (0174 R5)`) assert browser-observed outcomes (thumbnail count, draft timestamp/counter, click coordinates); semantics code unchanged at index.ts:542, 603–668; recorded: 1502/1502 tests pass in gate log |
| AC3 | MET | test | `openPage failure (missing playwright)` test asserts upstream actionable wording (`npx playwright install chromium`); `loginProfile: expired session times out` asserts `LoginTimeoutError` with context closed; `refused: a missing profile headless never fabricates a session` asserts `BrowserProfileMissingError` surfaces dir name only — no cookies/credentials in any error path (grep: no secret material in messages) |
| AC4 | MET | test | profile-check.ts:40–70 returns `verified` only on observed authenticated console, else explicit `refused` + exit 1 (CLI tests assert both); upstream launcher cannot create a profile headless (test asserts refusal for missing profile); manual dogfood recipe recorded in docs/design/xhs-image-cards.md and SKILL.md:36–47; live headless check itself is the operator one-time validation (residual risk below) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | residual-sweep | — | blocking=0 deferrable=0 advisory=0 housekeeping=0 |

### References

- Upstream dependency: ts-libs task `0088`, feature `M`, `@gobing-ai/ts-browser-automation`. Complete and build it before this task; Spur cannot encode cross-repository `task deps`.
- Current code: `packages/publish-harness/src/index.ts:236-330`; `plugins/publishings/xhs-pub/src/index.ts:303-326,519-684`; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`; `scripts/bundle-plugins.ts`.
- Current contract: `docs/00_ADR.md` ADR-008/022/024; `docs/design/xhs-image-cards.md`; `docs/04_DESIGN.md`; `plugins/kk/skills/publish/SKILL.md`; E8 tasks 0167 and 0174.

### History

- 2026-09-27T04:12:20.244Z backlog → todo (system)
- 2026-09-28T01:16:48.420Z todo → wip (system)
- 2026-09-28T01:16:48.802Z wip → testing (system)
- 2026-09-28T01:17:32.590Z testing → done (system)

