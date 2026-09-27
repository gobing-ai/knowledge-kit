---
schema_version: 1
name: Migrate XHS publisher to ts-browser-automation and dogfood profile reuse
status: todo
template: feature-impl
created_at: 2026-09-27T04:10:35.333Z
updated_at: "2026-09-27T04:12:20.244Z"
feature_id: E9

ac_numbering: task-local
estimate_hours: 6
---

## 0177. Migrate XHS publisher to ts-browser-automation and dogfood profile reuse

### Background

E8 is done and its real XHS draft/live flow is validated. The current XHS image-post publisher launches Playwright through `@gobing-ai/publish-harness` (`plugins/publishings/xhs-pub/src/index.ts:303-326`), while the harness returns an `unknown` context from `launchPersistentBrowser` (`packages/publish-harness/src/index.ts:299-330`). The first consumer of `@gobing-ai/ts-browser-automation` should replace that launcher and prove the shared profile API against the existing XHS flow. This task begins after the upstream ts-libs package is built and available through a pinned published version or a local development link; the final manifest must use the normal `@gobing-ai/*` package dependency, not a sibling-repo relative import.

XHS is the correct dogfood target because it has an actual Playwright script driver and browser-observed outcomes. `x-pub` article, Substack, Juejin, and InfoQ retain `sessionReady` scaffolds; Medium uses an API. Their migrations are excluded until they have working browser flows.

### Requirements

- [ ] R1. Replace XHS's use of `publish-harness.launchPersistentBrowser` with typed `@gobing-ai/ts-browser-automation` in the existing `makeDefaultOpenPage` seam. Preserve the injectable launcher and `OpenPage` test seam, `context.pages()[0] ?? context.newPage()`, context closure, and XHS-specific `wrapPlaywrightPage`/closed-shadow `createShadowProbe` logic. Remove the harness launcher after its callers are migrated; keep harness `trySelectors` and `resolveBrowserProfileDir` where still used.
- [ ] R2. Preserve the current profile resolution exactly: `options.profileDir` wins over `XHS_PROFILE_DIR`, then `KK_BROWSER_PROFILE_DIR`, then `~/.config/kk/browser-profiles/xhs`; existing profile contents are reused in place. Keep headed login for an absent/expired session, `loginTimeoutMs`, and the existing actionable browser-install/login failure result. Do not copy profiles or credentials.
- [ ] R3. Preserve all E8 publish semantics: input images are validated before browser launch; ordered `setInputFiles`; count/title/body evidence; draft by default; public only on explicit `publishStatus: 'public'`; no synthetic success, retry of public submit, or guessed URL/ID. Preserve the fake transport and `driver: 'agent'` failure behavior.
- [ ] R4. Prove the upstream package against XHS with offline tests and a manual dogfood recipe: use its headed login helper with an XHS-owned readiness predicate, reuse the existing profile, recover from an expired session, and open that profile in a later headless read-only check. A headless site refusal is an explicit failed readiness result, never a false success. Automated tests must not contact XHS or use a real account; any live draft run requires the operator's account and records only nonsensitive result evidence. Do not run a live public post for this refactor.
- [ ] R5. Add the new dependency following this repo's package/catalog conventions and update `docs/04_DESIGN.md`, `docs/design/xhs-image-cards.md`, and relevant publish instructions in the same implementation change. Explain the shared package boundary and profile setup without exposing secrets. Run the project gate and task/feature checks.

### Acceptance Criteria

- [ ] AC1 — XHS publisher uses the shared browser package with the existing profile path (req: R1, R2)
- [ ] AC2 — XHS draft and explicit public routing preserve browser-observed results (req: R3)
- [ ] AC3 — Login and browser failures remain actionable without leaking profile material (req: R2, R4)
- [ ] AC4 — A later headless read-only profile check reports verified session or explicit site refusal (req: R4, R5)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Upstream dependency: ts-libs task `0088`, feature `M`, `@gobing-ai/ts-browser-automation`. Complete and build it before this task; Spur cannot encode cross-repository `task deps`.
- Current code: `packages/publish-harness/src/index.ts:236-330`; `plugins/publishings/xhs-pub/src/index.ts:303-326,519-684`; `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`; `scripts/bundle-plugins.ts`.
- Current contract: `docs/00_ADR.md` ADR-008/022/024; `docs/design/xhs-image-cards.md`; `docs/04_DESIGN.md`; `plugins/kk/skills/publish/SKILL.md`; E8 tasks 0167 and 0174.

### History

- 2026-09-27T04:12:20.244Z backlog → todo (system)

