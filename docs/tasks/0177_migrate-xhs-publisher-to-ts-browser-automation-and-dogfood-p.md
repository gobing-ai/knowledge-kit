---
schema_version: 1
name: Migrate XHS publisher to ts-browser-automation and dogfood profile reuse
status: done
template: feature-impl
created_at: 2026-09-27T04:10:35.333Z
updated_at: "2026-09-28T04:01:20.415Z"
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

The XHS publisher now opens its existing persistent profile through `@gobing-ai/ts-browser-automation@0.5.11`. The injectable launcher function and `OpenPage` contract remain; the production default retains the upstream type (`plugins/publishings/xhs-pub/src/index.ts:311`). Page selection, the XHS wrapper, closed-shadow CDP probe, and context cleanup are preserved (`plugins/publishings/xhs-pub/src/index.ts:318-343`). The force re-audit repaired cleanup when page creation throws; its regression test asserts exactly one close (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:880-890`).

The harness retains profile resolution and selector probing; its generic browser launcher and launcher test were removed after the sole consumer migrated (`packages/publish-harness/src/index.ts:231-282`). Profile precedence and the headed login deadline remain in the XHS plugin. Image validation, ordered upload, browser-observed draft/public results, and single-attempt public submission remain unchanged.

The source-checkout profile CLI uses upstream headed login and scoped headless reuse with the same XHS-owned readiness predicate (`plugins/publishings/xhs-pub/src/profile-check.ts:55-96`). Offline tests use injected launchers; the manual recipe covers same-profile login/recovery followed by read-only checking (`docs/design/xhs-image-cards.md:15-27`). Live account dogfood is operator-controlled and was not performed by this re-audit; no live public post is part of this task.

The dependency uses the workspace catalog (`plugins/publishings/xhs-pub/package.json:10`, `package.json:19`, `bun.lock:439`). Product entry bundling inlines the shared browser library while keeping Playwright external (`scripts/bundle-plugins.ts:74-77`). Surface documentation describes the actual function seam separately from the profile helpers' `BrowserLauncher` object (`docs/04_DESIGN.md:501`); publish instructions describe profile setup (`plugins/kk/skills/publish/SKILL.md:36-48`).

The re-audit regenerates Testing from fresh executable evidence with AC identifiers matching E9's four scenario titles, repairing the previous linked-but-unverified feature satisfaction.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/xhs-pub/src/index.ts:311` binds the typed upstream default; `plugins/publishings/xhs-pub/src/index.ts:318-343` preserves injectable launch, existing/new page selection, XHS wrapper, CDP probe and close. `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:880-890` now proves closure on page creation failure. `packages/publish-harness/src/index.ts:231-282` retains profile and selector helpers. Repository source search finds no remaining harness launcher callers. `bun run gate` exit 0, including the existing opener and new cleanup regression tests. |
| R2 | MET | `plugins/publishings/xhs-pub/src/index.ts:538-542` preserves options, XHS env, shared env and channel default precedence; `packages/publish-harness/src/index.ts:231-240` resolves without copying profiles. `plugins/publishings/xhs-pub/src/index.ts:564-573` retains headed login readiness and loginTimeoutMs. `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1158-1219` covers all precedence tiers. `bun run gate` exit 0, including profile, expired-login and actionable launch-failure tests. |
| R3 | MET | `plugins/publishings/xhs-pub/src/index.ts:532-552` validates images before launch, refuses agent driver, defaults to draft and accepts public only explicitly. `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:310-343` covers ordered upload, body typing and CDP submit; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1051-1089` rejects unobserved draft saves; `plugins/publishings/xhs-pub/src/index.ts:686-716` preserves browser-observed public results, context closure and fake transport. `bun run gate` exit 0, including single-click public-submission tests. |
| R4 | MET | `plugins/publishings/xhs-pub/src/profile-check.ts:55-96` delegates headed login and headless scoped checking to upstream helpers with the XHS-owned predicate. `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1273-1321` covers verified/refused/missing/expired sessions and closure with fake launchers; `bun run gate` exit 0. The actual CLI missing-profile check returned JSON refused and exit 1 without creating the profile. Manual same-profile login/recovery and headless recipe: `docs/design/xhs-image-cards.md:15-27`. Live account dogfood was not run; no public post was made. |
| R5 | MET | `plugins/publishings/xhs-pub/package.json:10`, `package.json:19`, `bun.lock:439` use catalog dependency 0.5.11; no sibling-repo source import. `scripts/bundle-plugins.ts:74-77` keeps Playwright external while bundling the upstream package. `docs/04_DESIGN.md:443`, `docs/04_DESIGN.md:501`, `docs/design/xhs-image-cards.md:15-27`, `plugins/kk/skills/publish/SKILL.md:36-48` cover boundary and profile setup. `bun run gate` exit 0; `bun run build:bundle` from apps/cli exit 0; isolated bundled-entry fake smoke exit 0; `spur task check 0177 --strict-core --json` exit 0 with no findings. Coverage: functions 98.55%, lines 98.30% aggregate. Fix-pass artifacts: .spur/run/0177-verify-answer.txt lines 1-42 (fresh traceability); .spur/run/0177-verdict.json lines 1-110 (CLI derivation and residual fold); .spur/run/0177-reverify-solution.md lines 1-9; .spur/run/0177-reverify-bundle-smoke.ts lines 1-18; .spur/run/0177-test-gate.log lines 1-540; .spur/run/0177-check-receipt.json lines 1-18. The stale .spur/run/0177-current-run.env was archived unread to /private/tmp/knowledge-kit-0177-run-env.DdzbzW; .spur/run/0177-reverify-env-archive.txt line 1 records the archive path. E9 scenario-keyed Testing and generated task roster are current; spur feature check E9 and spur task check 0177 --strict-core both pass with no findings. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — XHS publisher uses the shared browser package with the existing profile path | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1222-1238` proves upstream default identity, headed launch and closure; profile precedence tests at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1158-1219`. `bun run gate` exit 0 (1503 pass, 0 fail). |
| Scenario: R2 — XHS draft and explicit public routing preserve browser-observed results | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:310-343` covers ordered upload/body/CDP; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1051-1089` verifies draft deltas; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1123-1154` and the following public test cover URL confirmation and one submit attempt. `bun run gate` exit 0 (1503 pass, 0 fail). |
| Scenario: R3 — Login and browser failures remain actionable without leaking profile material | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:529-538` exercises missing-browser errors; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:880-890` closes on page-creation failure; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1314-1321` covers expired-session LoginTimeoutError and closure. `bun run gate` exit 0. Messages contain readiness/install guidance; no credentials are exported. |
| Scenario: R4 — A later headless read-only profile check reports verified session or explicit site refusal | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1273-1321` tests upstream headed login then headless verified/refused branches with injected launchers; profile CLI tests start at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1324`. `bun run gate` exit 0. `bun plugins/publishings/xhs-pub/src/profile-check.ts check --profile .spur/run/0177-reverify-absent-profile --timeout 0` exit 1, JSON status refused; no profile was created. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | DONE: narrow upstream default migration, injected OpenPage retained, page/CDP wrappers kept, obsolete harness launcher removed, profile helpers separated from headed publishing, dependency bundled with Playwright external. Source-checkout helper scope is explicit in the Solution and surface docs. |
| P4 | scope-creep | — | All changed tracked files map to R1/R4/R5, task evidence or the generated feature-roster refresh; no other channel migration or publishing action added. |
| P4 | full-quality-gate | — | `bun run gate` exit 0; lint/typecheck/build plus pre/post rules; 1503 tests passed, 0 failed. Evidence: reverify `.spur/run/0177-test-gate.log` lines 1-540. Full-tier receipt reused at the same input digest. |
| P4 | coverage | — | Coverage: functions 98.55%, lines 98.30% aggregate; both exceed 90%. Evidence: reverify `.spur/run/0177-test-gate.log` line 440. |
| P4 | cli-golden-path-present | — | Actual missing-profile CLI returned JSON refused with exit 1; tested refusal is the expected behavior. Evidence: reverify `.spur/run/0177-reverify-cli.log` line 1 and `.spur/run/0177-reverify-cli.stderr` line 1. |
| P4 | package-runtime | — | `bun run build:bundle` from apps/cli exit 0; `bun .spur/run/0177-reverify-bundle-smoke.ts` exit 0 verifies copied bundle alone under /private/tmp, without repository node_modules, using the fake transport. Evidence: reverify `.spur/run/0177-reverify-bundle-smoke.log` line 1. |
| P4 | artifact-disclosure | — | Fix pass wrote `.spur/run/0177-verify-answer.txt` lines 1-42 and derived `.spur/run/0177-verdict.json`; Solution source `.spur/run/0177-reverify-solution.md` lines 1-9; isolated smoke `.spur/run/0177-reverify-bundle-smoke.ts` lines 1-18; gate log/receipt under `.spur/run/0177-*`. Archived the forbidden stale `.spur/run/0177-current-run.env` without reading contents to /private/tmp/knowledge-kit-0177-run-env.DdzbzW; archive path recorded in `.spur/run/0177-reverify-env-archive.txt` line 1. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | residual-sweep | — | blocking=0 deferrable=0 advisory=10 housekeeping=0 |

### References

- Upstream dependency: ts-libs task `0088`, feature `M`, `@gobing-ai/ts-browser-automation`. Complete and build it before this task; Spur cannot encode cross-repository `task deps`.
- Current code: `packages/publish-harness/src/index.ts:236-330`; `plugins/publishings/xhs-pub/src/index.ts:303-326,519-684`; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`; `scripts/bundle-plugins.ts`.
- Current contract: `docs/00_ADR.md` ADR-008/022/024; `docs/design/xhs-image-cards.md`; `docs/04_DESIGN.md`; `plugins/kk/skills/publish/SKILL.md`; E8 tasks 0167 and 0174.

### History

- 2026-09-27T04:12:20.244Z backlog → todo (system)
- 2026-09-28T01:16:48.420Z todo → wip (system)
- 2026-09-28T01:16:48.802Z wip → testing (system)
- 2026-09-28T01:17:32.590Z testing → done (system)

