---
schema_version: 1
name: Migrate XHS publisher to ts-browser-automation and dogfood profile reuse
status: done
template: feature-impl
created_at: 2026-09-27T04:10:35.333Z
updated_at: "2026-11-15T04:57:23.281Z"
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
- [x] AC4 — A later read-only profile check reports a verified session or an explicit refusal (req: R4, R5)

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

The XHS publisher now opens its existing persistent profile through `@gobing-ai/ts-browser-automation@0.5.11`. The injectable launcher function and `OpenPage` contract remain; the production default retains the upstream type (`plugins/publishings/xhs-pub/src/index.ts:311`). Page selection, the XHS wrapper, closed-shadow CDP probe, and context cleanup are preserved (`plugins/publishings/xhs-pub/src/index.ts:318-343`). The force re-audit repaired cleanup when page creation throws; its regression test asserts exactly one close (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:883-894`).

The harness retains profile resolution and selector probing; its generic browser launcher and launcher test were removed after the sole consumer migrated (`packages/publish-harness/src/index.ts:231-282`). Profile precedence and the headed login deadline remain in the XHS plugin. Image validation, ordered upload, browser-observed draft/public results, and single-attempt public submission remain unchanged.

The source-checkout profile CLI uses upstream headed login and scoped headless reuse with the same XHS-owned readiness predicate (`plugins/publishings/xhs-pub/src/profile-check.ts:55-96`). Offline tests use injected launchers; the manual recipe covers same-profile login/recovery followed by read-only checking (`docs/design/xhs-image-cards.md:15-27`). Live account dogfood is operator-controlled and was not performed by this re-audit; no live public post is part of this task.

The dependency uses the workspace catalog (`plugins/publishings/xhs-pub/package.json:10`, `package.json:19`, `bun.lock:439`). Product entry bundling inlines the shared browser library while keeping Playwright external (`scripts/bundle-plugins.ts:74-77`). Surface documentation describes the actual function seam separately from the profile helpers' `BrowserLauncher` object (`docs/04_DESIGN.md:501`); publish instructions describe profile setup (`plugins/kk/skills/publish/SKILL.md:36-48`).

The re-audit regenerates Testing from fresh executable evidence with AC identifiers matching E9's four scenario titles, repairing the previous linked-but-unverified feature satisfaction. The final gate exposed a minute-boundary flake in the fake page: it now retains the saved timestamp, and a scripted clock regression proves an old stamp cannot confirm a new save (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:75-77`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1088-1106`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/xhs-pub/src/index.ts:184` `defaultLauncher = kkBrowserLauncher.launch`; seam `plugins/publishings/xhs-pub/src/index.ts:191` `makeDefaultOpenPage`, `plugins/publishings/xhs-pub/src/index.ts:210` `ctx.pages()[0] ?? (await ctx.newPage())`, `plugins/publishings/xhs-pub/src/index.ts:212` `wrapPlaywrightPage` + `ctx.close()`; the launcher is built on `@gobing-ai/ts-browser-automation` (`packages/publish-harness/src/browser.ts:13`, `packages/publish-harness/src/browser.ts:253`). `rg launchPersistentBrowser` over src is empty. CHANGED since the original record: the typed `openPersistentBrowser` call was replaced by the harness `kkBrowserLauncher` (task 0214), same upstream package; test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2056`. |
| R2 | MET | `plugins/publishings/xhs-pub/src/index.ts:318` `resolveChannelProfileDir(CHANNEL, override)`; tiers override → `<CHANNEL>_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` at `packages/publish-harness/src/browser.ts:397`; tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1997`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2015`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2031`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2045`. Install hint `plugins/publishings/xhs-pub/src/index.ts:199`; `loginTimeoutMs` now clamps the readiness gate (`plugins/publishings/xhs-pub/src/index.ts:279`). CHANGED by ADR-025 amendment 2026-11-13 (task 0370): a dead session is refused naming `kk bot login xhs` (`plugins/publishings/xhs-pub/src/index.ts:393`) instead of waiting in a headed login; headed login stays in `kk bot login xhs` (`plugins/publishings/xhs-pub/src/profile-check.ts:75`). |
| R3 | MET | validation before launch `plugins/publishings/xhs-pub/src/index.ts:306` (test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:887`); ordered `setInputFiles` test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:898`; draft default / explicit public `plugins/publishings/xhs-pub/src/index.ts:399` (test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1103`); agent driver refusal `plugins/publishings/xhs-pub/src/index.ts:293` (test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:849`); fake transport `plugins/publishings/xhs-pub/src/index.ts:425` (test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1558`). |
| R4 | MET | offline tests only (`bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` → 170 pass / 0 fail (this run)); XHS-owned readiness predicate in the shared login path `plugins/publishings/xhs-pub/src/profile-check.ts:75`; expired-session recovery = refusal naming the login command `plugins/publishings/xhs-pub/src/index.ts:393` (test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:740`); dogfood recipe `docs/design/xhs-image-cards.md:15`. CHANGED by ADR-025 amendment (`docs/00_ADR.md:1105`): the later read-only check is offline by default (`plugins/publishings/xhs-pub/src/profile-check.ts:129`, test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:671`) and `check --headed` runs the real probe (`plugins/publishings/xhs-pub/src/profile-check.ts:104`, test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2287`); no headless XHS visit remains, so a headless refusal can no longer be reported as success. |
| R5 | MET | catalog `package.json:20`, consumer `plugins/publishings/xhs-pub/package.json:10`; `docs/04_DESIGN.md:1968`; `docs/design/xhs-image-cards.md:15`; `plugins/kk/skills/publish/SKILL.md:39` (check comment and paragraph corrected this run to the offline behaviour, line 47). Gate: `spur --no-logo feature verify E9` (lint + rule checks + full test suite) → PASS, exit 0, 2026-11-14: 5341 pass / 0 fail across 303 files; log `.spur/run/run_a3d0d834-9156-4182-9aa8-1b3acfdb6700-feature-verification.log` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — XHS publisher uses the shared browser package with the existing profile path (req: R1, R2) | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2056` (default launcher is `kkBrowserLauncher.launch`, headed), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1997`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2015`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2031`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2045` (profile precedence); `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` → 170 pass / 0 fail (this run) |
| AC2 — XHS draft and explicit public routing preserve browser-observed results (req: R3) | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:898` (draft, ordered single `setInputFiles`, no id), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1103` (explicit public reports the observed url), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:887` (invalid images fail before openPage) |
| AC3 — Login and browser failures remain actionable without leaking profile material (req: R2, R4) | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1119` (timeout names the profile dir), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1201` (missing playwright fails loud), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:740` (dead console refuses and closes) |
| AC4 — A later read-only profile check reports a verified session or an explicit refusal (req: R4, R5) | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:671` (offline check: no launch, no budget), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2287` (`check --headed` probes headed only), `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2306` (spent budget → JSON refusal, no browser) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Upstream dependency: ts-libs task `0088`, feature `M`, `@gobing-ai/ts-browser-automation`. Complete and build it before this task; Spur cannot encode cross-repository `task deps`.
- Current code: `packages/publish-harness/src/index.ts:236-330`; `plugins/publishings/xhs-pub/src/index.ts:303-326,519-684`; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`; `scripts/bundle-plugins.ts`.
- Current contract: `docs/00_ADR.md` ADR-008/022/024; `docs/design/xhs-image-cards.md`; `docs/04_DESIGN.md`; `plugins/kk/skills/publish/SKILL.md`; E8 tasks 0167 and 0174.

### History

- 2026-09-27T04:12:20.244Z backlog → todo (system)
- 2026-09-28T01:16:48.420Z todo → wip (system)
- 2026-09-28T01:16:48.802Z wip → testing (system)
- 2026-09-28T01:17:32.590Z testing → done (system)

