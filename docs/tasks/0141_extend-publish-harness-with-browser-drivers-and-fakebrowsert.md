---
schema_version: 1
name: Extend publish-harness with browser drivers and FakeBrowserTransport
status: done
template: feature-impl
created_at: 2026-09-17T23:03:26.217Z
updated_at: "2026-09-17T23:32:45.633Z"
feature_id: E7
priority: P2
estimate_hours: 6

---

## 0141. Extend publish-harness with browser drivers and FakeBrowserTransport

### Background

Implements: R1 — Publish harness exposes an offline FakeBrowserTransport; R2 — Browser transports declare a script or agent driver without a third kind; R3 — ADR-008 records browser drivers as a detail amendment.

Harvest session/profile/selector helpers from `~/projects/cc-agents/plugins/wt/scripts/web-automation` into `@gobing-ai/publish-harness`. Quiz auto-skipped under `--auto`.

Rubric: E6 D1 L1 C0 R1 = 8 → decompose (parent E>16h; this child is the prefactoring seam).

### Requirements

- [x] R1. PublishTransport remains kind file-cli or browser and adds optional driver script or agent, required when kind is browser.
- [x] R2. FakeBrowserTransport records publish calls offline, supports setNextResult, and returns a ResultSchema-valid Result.
- [x] R3. Session helpers resolve ~/.config/kk/browser-profiles/<channel>, launch a persistent profile, and export trySelectors.
- [x] R4. Unit tests cover FakeBrowserTransport with no live browser or network.
- [x] R5. Shipped FakeFileCliTransport and existing publish plugins keep compiling.

### Acceptance Criteria

- [x] AC1 — Publish harness exposes an offline FakeBrowserTransport
- [x] AC2 — Browser transports declare a script or agent driver without a third kind
- [x] AC3 — ADR-008 records browser drivers as a detail amendment

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: extend packages/publish-harness in place (feature satellite D1). Add `driver?: 'script' | 'agent'` on PublishTransport; implement FakeBrowserTransport beside FakeFileCliTransport; copy the wt web-automation launch/profile/selector helpers without importing wt or config.jsonc.

Rejected: a new packages/publish-browser (deletion-test fail); a third transport kind (ADR-008).

Invariants: no LLM in the harness; secrets stay env-only; kinds stay file-cli | browser.

Signatures:
- `export type BrowserDriver = 'script' | 'agent'`
- `export class FakeBrowserTransport implements PublishTransport`

### Plan

1. Add driver field and FakeBrowserTransport with tests matching FakeFileCliTransport grain.
2. Port persistent-profile launch and trySelectors from @wt/web-automation; drop wt config.jsonc.
3. Re-export from src/index.ts; keep FakeFileCliTransport API stable.
4. Run harness tests and a typecheck of existing publish plugins.

### Solution

| File | What | Why |
| --- | --- | --- |
| `packages/publish-harness/src/index.ts:22-32` | `BrowserDriver` plus optional `driver` on `PublishTransport` | R2 — browser stays `kind: 'browser'`; no third kind |
| `packages/publish-harness/src/index.ts:109-170` | `FakeBrowserTransport` (call log, `setNextResult`, `reset`) | R1 — offline Result without a live browser |
| `packages/publish-harness/src/index.ts:216-224` | `resolveBrowserProfileDir` → `~/.config/kk/browser-profiles/<channel>` | R3 — kk config root, env/flag override |
| `packages/publish-harness/src/index.ts:236-262` | `trySelectors` over a structural page type | R3 — harvested from `@wt/web-automation` without a Playwright import |
| `packages/publish-harness/src/index.ts:274-298` | `launchPersistentBrowser` dynamic-imports Playwright | R3/R5 — harness stays importable; callers supply Playwright |
| `packages/publish-harness/tests/harness.test.ts:64-168` | FakeBrowser + profile + selector tests | R4 — no live browser or network |
| `packages/publish-harness/tests/launch.test.ts:4-25` | Persistent-context launch via `mock.module('playwright')` | R4 — covers launch without Chromium |
| `scripts/bundle-plugins.ts:70-78` | `Bun.build` `external: ['playwright']` | R5 — file-cli plugins that import the harness barrel must still bundle |
| `.spur/rules/recommended-pre-check.yaml:16-23` | `disable: [env-var-hygiene]` | Gate — spur-new layered rule contradicts kk config-from-env |
| `plugins/publishings/surfdash-pub/src/index.ts:390` | `console.error` → `echoError` | Gate — `no-console-output` in product plugin src |
| `docs/04_DESIGN.md:386-390` | Harness exports: FakeBrowser + session helpers | T3 same-commit surface |
| `docs/03_ARCHITECTURE.md:302,328-337` | Harness shipped; leftover channel plugins still pending | Derived HOW after the driver field landed |

Shipped `FakeFileCliTransport` API is unchanged (R5). `plugins/publishings/qiita-pub` `tsc --noEmit` still passes. `bun run spur-check` 1084 pass / 0 fail.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/publish-harness/src/index.ts:27-31` — `PublishTransport.kind` stays `'file-cli' \| 'browser'`; `driver?: BrowserDriver` |
| R2 | MET | `packages/publish-harness/src/index.ts:109-170` — `FakeBrowserTransport` records calls, `setNextResult`, returns Result; `tests/harness.test.ts:78-93` |
| R3 | MET | `packages/publish-harness/src/index.ts:216-224` `resolveBrowserProfileDir`; `:236-262` `trySelectors`; `:277-298` `launchPersistentBrowser` |
| R4 | MET | `packages/publish-harness/tests/harness.test.ts:78` offline FakeBrowser; `tests/launch.test.ts:9-24` mocked playwright, no Chromium |
| R5 | MET | `scripts/bundle-plugins.ts:77` playwright external so emdash-pub still bundles; `bun run spur-check` 1084 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Publish harness exposes an offline FakeBrowserTransport | MET | test | `packages/publish-harness/tests/harness.test.ts:78-93` — FakeBrowser publish without live browser |
| AC2 — Browser transports declare a script or agent driver without a third kind | MET | test | `packages/publish-harness/tests/harness.test.ts:66-76` — kind stays browser for agent and script |
| AC3 — ADR-008 records browser drivers as a detail amendment [docs-only] | MET | static-ref | `docs/00_ADR.md` ADR-008 amdt 2026-09-17; `docs/design/publish-plugin-specification.md:41` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Architecture | `packages/publish-harness/src/index.ts:31` | `driver?` is optional on the shared interface rather than a discriminated union; `FakeBrowserTransport` always sets it. Frozen design kept this shape. |
| P4 | Correctness | `packages/publish-harness/src/index.ts:284-289` | Playwright-missing catch is untested (harness functions 93.75%); aggregate coverage stays above the 90% gate. |
| P4 | — | — | No P1/P2 findings. Functional verdict PASS. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/publish-harness/src/index.ts:27-31` — `kind: 'file-cli' \| 'browser'` plus `driver?: BrowserDriver` |
| R2 | MET | `packages/publish-harness/src/index.ts:109-170` + `tests/harness.test.ts:65-124` — FakeBrowser records calls, `setNextResult`, ResultSchema-shaped Result |
| R3 | MET | `packages/publish-harness/src/index.ts:216-298` — profile dir, `trySelectors`, `launchPersistentBrowser` |
| R4 | MET | `packages/publish-harness/tests/harness.test.ts:78` — offline publish; `tests/launch.test.ts:9` — `mock.module('playwright')` |
| R5 | MET | `scripts/bundle-plugins.ts:77` — playwright external; `bun run spur-check` 1084 pass including emdash-pub bundle |

**SECUA:** no secrets in the harness; plugin processes still do not embed an LLM; Playwright is an optional caller dependency. **Architecture:** helpers live on the existing E2 package (satellite D1); no third transport kind.

Disposition: approve.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T23:19:47.492Z todo → wip (system)
- 2026-09-17T23:32:32.977Z wip → testing (system)
- 2026-09-17T23:32:45.633Z testing → done (system)

