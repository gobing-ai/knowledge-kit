---
schema_version: 1
name: Bundle manifest-declared readiness probes for installed plugins
status: done
template: feature-impl
created_at: 2026-10-10T07:14:32.358Z
updated_at: "2026-10-10T16:37:06.756Z"
feature_id: E93

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0249-verdict.json
---

## 0249. Bundle manifest-declared readiness probes for installed plugins

### Background

Review finding F2 (P2, correctness/architecture), confirmed 2026-10-10. scripts/bundle-plugins.ts:85 rewrites only manifest.entry; check remains ./src/profile-check.ts. Staging actual x-pub outside the checkout and launching its declared check exits 1 with Cannot find module @gobing-ai/publish-harness/browser. Evidence .spur/run/review-repro.json in review run dev-review-packages-and-4-a71c. The distribution prunes node_modules and private workspaces are not published. Six browser manifests declare checks; none has a packaged-process regression. No existing non-terminal task owns this defect. The review separately fixed the exit/status parser in apps/cli/src/invoke.ts:241; preserve it. E93 was reopened for its installed readiness/login contract.

### Requirements

- [x] R1. Stage every declared TypeScript/JavaScript check as its own Bun bundle and rewrite staged manifest.check to that bundle; resolve dependencies from the source plugin. Leave source manifests untouched.
- [x] R2. Preserve executable non-JS entries/checks and existing entry bundling; a declared missing check or failed check build must fail staging with plugin/path context. Plugins without check remain unchanged.
- [x] R3. Add scripts/bundle-plugins.test.ts coverage for declared-check bundling and missing/broken checks plus an installed-shape subprocess probe outside repository module resolution. Keep node_modules excluded.
- [x] R4. Run bun run gate; no real browser/session/publish required.

### Acceptance Criteria

- [x] AC1. A staged real browser probe with workspace dependencies executes outside the checkout and produces its structured contract without module-resolution errors; the test uses a safe config/usage refusal before browser launch. (req: R1) (req: R3)
- [x] AC2. Staged manifests point to built check artifacts, source manifests retain their source check paths, and plugins with no check or executable non-JS paths retain their contract. (req: R1) (req: R2)
- [x] AC3. A missing or unbuildable declared check fails staging with plugin/path context; entry staging tests and the full project gate remain green. (req: R2) (req: R3) (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend the existing staging boundary in scripts/bundle-plugins.ts:52. Bundle declared JS/TS checks independently to dist/profile-check.js (distinct from dist/index.js), using the source directory to resolve private workspace imports and retaining the existing playwright external. Rewrite only the staged check field. Validate declared paths before builds and surface contextual failures. Preserve non-JS executable paths as copied assets; do not run them through Bun.build. Reuse the entry build logic locally where it avoids duplication; no second registry or publishing private workspaces. Tests in scripts/bundle-plugins.test.ts:52 should assert each staged declared check exists and execute a real probe safely from a temp directory beyond checkout ancestors (for example substack with SUBSTACK_PUBLICATION_URL unset, expecting error JSON/exit 2). Missing/broken source fixtures cover fail-loud behavior; ensure source manifests are byte-unchanged. Rejected: retaining raw TS and shipping workspace symlinks (broken outside checkout), or replacing browser probes with status-only checks (changes readiness semantics). Affected: scripts/bundle-plugins.ts, scripts/bundle-plugins.test.ts; optional test assertions in apps/cli/tests/commands/plugin-check.test.ts. Out of scope: channel selectors, new commands, publishing private packages, production browser dogfood. Restores ADR-012/032 distribution contracts; no ADR reversal or public manifest schema change.

### Plan

- [x] 1. Add failing staged-check, safe isolated-process and missing/broken check cases (R3).
- [x] 2. Bundle declared JS/TS probes at staging and preserve executable/non-check cases (R1/R2).
- [x] 3. Verify no source manifest mutation, no staged node_modules, and existing entry coverage (R2/R3).
- [x] 4. Run bun run gate and record the safe subprocess evidence (R4).

### Solution

Plan items 1-3 (R1, R2, R3) — declared readiness probes are now bundled at staging. Production first, then the tests that proved them.

Plan items 2 and 3 (R1, R2) — production staging. One shared helper replaces the entry-only path; the declared check is bundled to its own artifact and only the staged manifest is rewritten.

| file:line | change |
| --- | --- |
| scripts/bundle-plugins.ts:45 | `BUNDLEABLE` — declared paths Bun can bundle; anything else ships as a copied asset. |
| scripts/bundle-plugins.ts:57 | `bundleDeclared(pluginDir, sourceDir, pluginName, kind, declared)` replaces the entry-only bundle logic; reused for entry and check so there is no second build path. |
| scripts/bundle-plugins.ts:67 | A check bundles with `naming: 'profile-check.js'` to `./dist/profile-check.js`, distinct from the entry's `./dist/index.js`. |
| scripts/bundle-plugins.ts:71 | Resolves the declared source from the source plugin directory so `Bun.build` follows `@gobing-ai/*` workspace packages the staged tree no longer carries. |
| scripts/bundle-plugins.ts:74 | R2 fail-loud: a declared-but-missing source throws `bundling <plugin> failed: source <kind> missing: <path>`. |
| scripts/bundle-plugins.ts:76 | R2 preservation: a non-JS declared check (`./scripts/probe.sh`) returns unchanged and is never fed to `Bun.build`. |
| scripts/bundle-plugins.ts:95-108 | Keeps the entry build's `external: ['playwright']` and the Bun >=1.3 `AggregateError` catch. |
| scripts/bundle-plugins.ts:94 | R2 fail-loud: a build failure throws with plugin name and declared path context. |
| scripts/bundle-plugins.ts:101 | `bundleStagedEntry` now reads the staged manifest's optional `check` alongside `entry`. |
| scripts/bundle-plugins.ts:115 | The staged `entry` is rewritten through the shared helper (0110 I1 behaviour preserved). |
| scripts/bundle-plugins.ts:118 | R1: the staged `check` is bundled and rewritten only when declared; a plugin without one is untouched. |
| scripts/bundle-plugins.ts:124 | Doc comment records that checks are bundled too (0110 I1, 0249 R1). |

Green evidence (this worktree, after the change):

- `bun test scripts/bundle-plugins.test.ts` — 18 pass / 0 fail, 109 `expect()` calls; `scripts/bundle-plugins.ts` at 93.00% lines / 100.00% funcs. The 10 pre-existing entry-staging tests are unmodified and green.
- AC1 probe (parent-run, throwaway root outside the checkout): staging exits 0; all six manifests rewrite to `./dist/profile-check.js` while the six source manifests keep `./src/profile-check.ts`. From the staged `substack-pub` dir, `node` still reports `Cannot find module` for `@gobing-ai/publish-harness/browser` (so the cwd is genuinely outside repository module resolution), yet `bun ./dist/profile-check.js check` with `SUBSTACK_PUBLICATION_URL` unset prints the usage line and `{"status":"error","detail":"substack publication URL is required: set SUBSTACK_PUBLICATION_URL (or --publication <url>)"}`, exit 2, stderr empty. That is the ADR-032 structured verdict (trailing JSON `status`/`detail` line) produced by a usage refusal before any browser launch — not a readiness result, and not one of the `verified`/0 or `refused`/1 pairs the probe parser in `apps/cli/src/invoke.ts` consumes, which this task leaves untouched. This is the exact `Cannot find module` failure that opened F2, now closed.
- `git status --porcelain plugins/` clean after staging; no staged `node_modules`.

## Tests added (R3)

| file:line | change |
| --- | --- |
| scripts/bundle-plugins.test.ts:26 | `FIXTURE_CHECK` dependency-free declared-check body (in-process `Bun.build`, same reason as `FIXTURE_ENTRY`). |
| scripts/bundle-plugins.test.ts:28 | `FIXTURE_SHELL_CHECK` executable non-JS declared check: prints an ADR-032 JSON verdict and exits 2. |
| scripts/bundle-plugins.test.ts:31 | `REPO_ROOT` — the source manifests staging must never mutate. |
| scripts/bundle-plugins.test.ts:32 | `STAGING_SCRIPT` — spawned (not imported) so the real plugins' `@gobing-ai/*` workspace symlinks resolve (0111). |
| scripts/bundle-plugins.test.ts:35 | `CHECK_DECLARING_PLUGINS` — the six real manifests declaring `./src/profile-check.ts`. |
| scripts/bundle-plugins.test.ts:42 | `writePluginSource` now delegates to `writePluginFixture` (one fixture writer, no second convention). |
| scripts/bundle-plugins.test.ts:51 | `writePluginFixture(root, collection, name, {entry?, check?}, {entryBody?, checkBody?})`; `checkBody: null` declares a check path without creating the file (missing-source fixture); non-JS paths get mode 0755. |
| scripts/bundle-plugins.test.ts:82 | `captureRejection` awaits a rejected staging promise and returns its message; a resolved promise fails the test. |
| scripts/bundle-plugins.test.ts:94 | `lastJsonLine` reads the trailing ADR-032 verdict line a probe prints before its exit code. |
| scripts/bundle-plugins.test.ts:106 | `nodeModulesAncestors` — isolation precondition for the subprocess probe (no ancestor offers `node_modules`). |
| scripts/bundle-plugins.test.ts:292 | New suite `declared check staging (0249 — real staged tree)`; `beforeAll` stages the real `plugins/` tree into a temp target and snapshots the six source manifests. |
| scripts/bundle-plugins.test.ts:321 | Asserts every staged declared check is a `./dist/*.js` artifact that exists, and that no staged `node_modules` came back. |
| scripts/bundle-plugins.test.ts:338 | AC1 safe isolated probe: `bun <staged check> check` from a temp cwd beyond checkout ancestors with `SUBSTACK_PUBLICATION_URL`/`*_PROFILE_DIR` unset — asserts no `Cannot find module`, exit 2, and the `{"status":"error","detail":…SUBSTACK_PUBLICATION_URL}` verdict (no browser launch). |
| scripts/bundle-plugins.test.ts:368 | AC2: the six source manifests are byte-unchanged and keep `check: ./src/profile-check.ts`. |
| scripts/bundle-plugins.test.ts:378 | New suite `declared check staging (0249 — fixtures)` plus `stageFixtureTree` helper. |
| scripts/bundle-plugins.test.ts:393 | AC2: a declared check bundles to its own `./dist/*.js` (distinct from the entry bundle) and the source fixture manifest is untouched. |
| scripts/bundle-plugins.test.ts:420 | AC2: a plugin without a declared check stays unchanged — no `check` key, `dist/` holds only `index.js`. |
| scripts/bundle-plugins.test.ts:436 | AC2: an executable non-JS check (`./scripts/probe.sh`) survives staging byte- and mode-identical and still runs from a temp cwd. |
| scripts/bundle-plugins.test.ts:467 | AC3 fail-loud: a declared check whose source file is missing rejects with plugin name and check path context. |
| scripts/bundle-plugins.test.ts:492 | AC3 fail-loud: a declared check that cannot build rejects with plugin name and check path context. |

Red evidence (pre-fix, reproduced from this worktree):

- `infoq-pub staged check` — `Expected /^\.\/dist\/[^/]+\.js$/, Received "./src/profile-check.ts"`.
- staged probe spawn — `Cannot find module '@gobing-ai/publish-harness/browser' from '<temp>/…/substack-pub/src/profile-check.ts'` (exit 1).
- missing-check fixture and broken-check fixture — `expected staging to reject; Received: undefined`.

Review-lane repair hop (attempt 1): the two scoped P3 hardening findings from the independent review answer now recorded in `.spur/run/0249-test-gate.log`. Nothing else changed; every pre-existing assertion is intact.

| file:line | change |
| --- | --- |
| `scripts/bundle-plugins.ts:51` | P3-2 fix: `BUNDLEABLE` now covers every TypeScript/JavaScript module extension the runtime can load -- `.mts`/`.cts` added alongside `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs` -- and is case-insensitive, so a `./src/check.mts` or `./src/check.MJS` declaration bundles instead of silently shipping a raw source that dies on `Cannot find module` outside the checkout (R1 literal reading). Non-JS assets (`.sh`, `.py`, extensionless) are still copied verbatim. |
| `scripts/bundle-plugins.ts:87` | P3-1 fix: a non-bundleable declared path (entry or check) is now existence-checked against the STAGED plugin tree, not only the source tree -- the staged copy is what ships. |
| `scripts/bundle-plugins.ts:84-91` | P3-1 fail-loud: a declared path that never survived the copy (e.g. under the EXCLUDE-pruned `tests/`, `evals/`, `.venv/`) fails staging with plugin name, kind, declared path and staged path context, instead of exiting 0 with a manifest pointing at a dangling probe (`probe entry missing` at install time). |
| `scripts/bundle-plugins.test.ts:17` | Imports the now-exported `BUNDLEABLE` so the declared-path classification is asserted directly. |
| `scripts/bundle-plugins.test.ts:71` | Fixture body selection follows the production classification (adds `.mts`/`.cts`, case-insensitive) in `isModule`, so an `.mts` fixture writes a module body instead of an executable shell body. |
| `scripts/bundle-plugins.test.ts:467` | P3-1 regression: a plugin declaring `check: ./tests/probe.sh` (present in the source tree, pruned from the staged copy) rejects staging with plugin and path context, and the assertion that the staged `tests/` directory is absent keeps the case non-vacuous. |
| `scripts/bundle-plugins.test.ts:488-508` | P3-1 regression, entry side: a declared `./tests/probe.sh` entry present only in the source tree fails staging with plugin and path context (the entry is reachable through the same shared helper). |
| `scripts/bundle-plugins.test.ts:510` | P3-2 regression: a declared `./src/profile-check.mts` check bundles to `./dist/profile-check.js`, the artifact exists, carries no raw TypeScript annotation, and loads from a temp cwd with no `Cannot find module`. |
| `scripts/bundle-plugins.test.ts:598-624` | P3-2 regression at the predicate: every module extension (including `.mts`/`.cts`) and uppercase variants match, while `.sh`, `.py` and extensionless paths stay copied assets. |

Green evidence for this hop (this worktree):

- `bun test scripts/bundle-plugins.test.ts` -- 24 pass / 0 fail / 137 `expect()` calls (was 18/109; the 18 pre-existing tests are unmodified and still pass); `scripts/bundle-plugins.ts` at 100.00% funcs / 93.40% lines.
- Red evidence for the two new fixes (pre-fix code, new tests only): `fails loud when a declared non-JS check was pruned from the staged copy` -- `expected staging to reject; Received: undefined` (staging exited 0 with the dangling `./tests/probe.sh` manifest, the reviewer's DANGLING reproduction); same for the entry variant; `bundles a declared .mts check` -- `Expected "./dist/profile-check.js", Received "./src/profile-check.mts"`; classification -- `./src/check.mts` and `./src/check.MTS` both `Expected: true, Received: false`. 19 pass / 5 fail, i.e. no pre-existing assertion depends on the old behaviour.
- Affected consumers: `bun test scripts/publish-manifest.test.ts` 4 pass / 0 fail; `bun test apps/cli/tests/commands/plugin-check.test.ts` 12 pass / 0 fail; `bunx biome check scripts/bundle-plugins.ts scripts/bundle-plugins.test.ts` clean.
- Light-tier gate (`quality-gate.mjs light`): `format-lint:changed` PASS, `rules:pre` PASS (54 rules), `rules:post` FAIL on the `coverage-gate` rule alone. That rule is scoped to `apps/**/src/**` + `packages/**/src/**` (never `scripts/**`) and reads `.coverage/lcov.info`, which `bunfig.toml` forces every `bun test` run to rewrite -- the file on disk is the narrow `apps/cli` + `packages` report written by the prescribed narrow test runs, so every finding is in a file this task does not touch. The pipeline's full gate (`.spur/run/0249-test-gate.log`) ran the same preset over the full-suite report and reported `All 2 rules passed`. Regenerating full-suite coverage is the `test-recheck` hop's job, not this fix's.
- Deferred by instruction: the third P3 (an extensionless `#!/usr/bin/env bun` TypeScript declared path is always classified non-bundleable) is NOT fixed here.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `bun scripts/bundle-plugins.ts <tmp>/plugins <tmp>/.claude-plugin` exited 0 and rewrote all six declared checks to `./dist/profile-check.js` while leaving every `entry` at `./dist/index.js`; the six source manifests still read `"check": "./src/profile-check.ts"` and `git status --porcelain plugins/` is empty. The check is bundled from the source tree (`scripts/bundle-plugins.ts:71`), so the closure is inlined: the staged `dist/profile-check.js` is 1101283 bytes with zero `from "@gobing-ai/..."` specifiers while keeping 14 `playwright` external references (`scripts/bundle-plugins.ts:90`). `grep -l '"check"' plugins/*/*/plugin.json` returns exactly the six plugins, all `./src/profile-check.ts`, so every declared check in the tree is staged. |
| R2 | MET | Fixture runs through `bundlePlugins` (temp trees, repo untouched): a declared `./scripts/probe.sh` check staged to `{"entry":"./dist/index.js","check":"./scripts/probe.sh"}`, mode `-rwxr-xr-x` preserved, ran from `/tmp` printing `{"status":"error","detail":"fixture ran"}` exit 2, `dist/` holding only `index.js`. A plugin declaring no check staged to `{"name":"e-pub","entry":"./dist/index.js"}` with `dist/` = `index.js` only. Fail-loud reproduced directly: `bundling a-pub failed: source check missing: .../src/missing-check.ts`; `bundling b-pub failed: check ./src/bad-check.ts: Bundle failed`; `bundling c-pub failed: check ./tests/probe.sh was not staged at .../c-pub/tests/probe.sh -- the declared path did not survive the copied tree` (`scripts/bundle-plugins.ts:74`, `scripts/bundle-plugins.ts:94`, `scripts/bundle-plugins.ts:87`). Entry bundling preserved: every staged `./dist/index.js` exists, and `omni-voice-gen` keeps `./bin/omni-voice-gen` with mode `-rwxr-xr-x`. `find <staged>/plugins -name node_modules` returned nothing. |
| R3 | MET | `bun test scripts/bundle-plugins.test.ts` (run here, coverage redirected to /tmp so `.coverage/lcov.info` stayed byte-identical) → `24 pass`, `0 fail`, `137 expect() calls`, `scripts/bundle-plugins.ts` 100.00% funcs / 93.40% lines. The suite covers declared-check bundling over the real staged tree (`scripts/bundle-plugins.test.ts:292`), the isolated subprocess probe (`scripts/bundle-plugins.test.ts:338`), source-manifest byte-equality (`:368`), the no-check and executable non-JS preservation cases (`:420`, `:436`), missing-source and unbuildable fail-loud (`:467`, `:492`), plus the pruned-staged-path and `.mts` regressions. Isolation is real, not asserted: `scripts/bundle-plugins.test.ts:345` asserts no ancestor of the probe cwd carries `node_modules`, and the load-bearing assertion is `expect(output).not.toContain('Cannot find module')` at `:358`. Only six lines were deleted from the file (import lines plus the two `writePluginSource` body lines replaced by the delegated `writePluginFixture`); no assertion was removed. |
| R4 | MET | Gate artifact `.spur/run/0249-test-gate.status` = `PASS`; `.spur/run/0249-proofdigest.txt` = `sha256:935047e46784fbc623bca63bda76778e850bb58f9f3eedce2fa901f3593f2417`, matching the recorded run. `.spur/run/0249-test-gate.log` shows `bun run format` → `Checked 401 files ... No fixes applied.`, `bun run build` running `bun scripts/bundle-plugins.ts` and exiting 0, `biome check . && bun run typecheck` clean, `All 54 rules passed`, full suite `2395 pass / 2 skip / 0 fail / 11523 expect() calls`, and `All 2 rules passed` on the post-check. The gate's own staging output is present at `apps/cli/plugins/publishings/substack-pub/plugin.json` (`check=./dist/profile-check.js`, `dist/` holds `index.js` and `profile-check.js`). No real browser, session or publish was needed: every probe run in this verification exited on a config/readiness refusal. I did not re-run the full gate myself (host-wide lock, per constraint); the failure lines in `.spur/run/0249-light-gate.log` are the `coverage-gate` rule reading a narrow `.coverage/lcov.info` whose only entry is `scripts/bundle-plugins.ts`, and every flagged file is under `apps/**` or `packages/**` that this task does not touch. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1. A staged real browser probe with workspace dependencies executes outside the checkout and produces its structured contract without module-resolution errors; the test uses a safe config/usage refusal before browser launch. (req: R1) (req: R3) | MET | test | `bun test scripts/bundle-plugins.test.ts` → 24 pass / 0 fail, including `runs a staged browser probe outside the checkout and gets the ADR-032 usage refusal`. I repeated it by hand: staged the real tree to `/tmp/kk-0249-verify-stage-*`, ran `bun <staged>/publishings/substack-pub/dist/profile-check.js check` with `SUBSTACK_PUBLICATION_URL` unset from an isolated cwd whose ancestors hold no `node_modules` → exit 2, stderr 0 bytes, stdout `substack profile-check: substack publication URL is required: ...` plus `{"status":"error","detail":"substack publication URL is required: set SUBSTACK_PUBLICATION_URL (or --publication <url>)"}` (ADR-032 usage refusal, no browser launched). All six staged probes run from that same isolated cwd contain no `Cannot find module`. Negative control on the same tree and env: the raw staged `./src/profile-check.ts` under `bun` exits 1 with `error: Cannot find module '@gobing-ai/publish-harness/browser' from '.../substack-pub/src/profile-check.ts'`, and `node` on it exits 1 with `ERR_MODULE_NOT_FOUND` — the F2 defect is still reproducible without the bundle and gone with it. The other five probes exit 1 with the ADR-032 `{"status":"refused",...}` JSON because playwright is not installed locally, a pre-launch refusal. Anchor: scripts/bundle-plugins.test.ts:338 (in-suite probe) and scripts/bundle-plugins.ts:67 (bundle emits dist/profile-check.js). |
| AC2. Staged manifests point to built check artifacts, source manifests retain their source check paths, and plugins with no check or executable non-JS paths retain their contract. (req: R1) (req: R2) | MET | test | `bun test scripts/bundle-plugins.test.ts` → 24 pass / 0 fail across `rewrites every declared check to a built dist artifact that exists` (`scripts/bundle-plugins.test.ts:321`), `leaves the source manifests byte-unchanged` (`:368`), `leaves a plugin without a declared check unchanged` (`:420`) and `preserves an executable non-JS check as a copied asset` (`:436`). Confirmed by running staging myself: the six staged manifests read `./dist/profile-check.js` with both `dist/index.js` and `dist/profile-check.js` present on disk; the six repo manifests still read `./src/profile-check.ts` with `git status --porcelain plugins/` empty; the 21 check-less plugins staged with no `check` key; the fixture `./scripts/probe.sh` check kept its path and 0755 mode and still executed; `find <staged>/plugins -name node_modules` returned nothing. |
| AC3. A missing or unbuildable declared check fails staging with plugin/path context; entry staging tests and the full project gate remain green. (req: R2) (req: R3) (req: R4) | MET | command | Fail-loud reproduced by driving `bundlePlugins` over temp fixture trees: missing source → `bundling a-pub failed: source check missing: .../a-pub/src/missing-check.ts`; unbuildable → `bundling b-pub failed: check ./src/bad-check.ts: Bundle failed`; pruned non-JS → `bundling c-pub failed: check ./tests/probe.sh was not staged at .../c-pub/tests/probe.sh -- the declared path did not survive the copied tree`. Each names the plugin and the declared path. The same two cases plus the entry variant are asserted at `scripts/bundle-plugins.test.ts:467`, `:488`, `:510`, and all 10 pre-existing entry-staging tests pass in the 24-pass run. Gate: `.spur/run/0249-test-gate.status` = `PASS` at `.spur/run/0249-proofdigest.txt` `sha256:935047e46784fbc623bca63bda76778e850bb58f9f3eedce2fa901f3593f2417`, with `.spur/run/0249-test-gate.log` recording format clean, `bun scripts/bundle-plugins.ts` exiting 0 inside `bun run build`, typecheck clean, `All 54 rules passed`, `2395 pass / 0 fail`, `All 2 rules passed`. Per constraint I did not re-run the host-locked full gate; I re-ran the scoped suite and every staging and fail-loud command myself. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- scripts/bundle-plugins.ts:52 — entry-only staging implementation.
- scripts/bundle-plugins.ts:85 — entry rewrite excludes check.
- plugins/publishings/x-pub/plugin.json:5 — declared raw check path.
- plugins/publishings/x-pub/src/profile-check.ts:14 — private workspace import.
- scripts/bundle-plugins.test.ts:52 — installed staging test.
- Review run dev-review-packages-and-4-a71c, .spur/run/review-repro.json.
- Feature E93; ADR-012 and ADR-032.

### History

- 2026-10-10T07:15:49.618Z backlog → todo (system)
- 2026-10-10T16:36:26.780Z todo → wip (system)
- 2026-10-10T16:36:27.139Z wip → testing (system)
- 2026-10-10T16:37:06.752Z testing → done (system)

