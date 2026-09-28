---
schema_version: 1
name: CLI resolves kk stage scripts from gitignored apps/cli/plugins — stale-bundle hazard
status: done
template: feature-impl
created_at: 2026-09-27T06:00:25.472Z
updated_at: "2026-09-28T22:39:45.255Z"
feature_id: F8

priority: P3
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 3
---

## 0178. CLI resolves kk stage scripts from gitignored apps/cli/plugins — stale-bundle hazard

### Background

Filed from E61 re-verify (2026-09-27), task 0176's packaged-script advisory.
The issue is still valid at HEAD `6e32c246`: `apps/cli/src/stage.ts:16-27` resolves
`plugins/kk/scripts/kk-workflow-stages.ts` relative to the real CLI entry's package first,
then relative to the module-derived checkout root. Both the source entry
(`apps/cli/src/index.ts`) and compiled entry (`apps/cli/dist/index.js`) therefore select
the gitignored `apps/cli/plugins/kk/scripts/kk-workflow-stages.ts` when it exists.
An edit to the checked-in runner or its same-directory helpers is invisible until that copy is refreshed.

Evidence collected 2026-09-27:

- Calling `resolveStagesScript()` with each real entry selected the staged path, not the checked-in path.
- A temporary checkout-shaped fixture supplied different runner bodies: source exited 17 and
  staged copy exited 18. Resolving and spawning the selected runner exited 18. The fixture was
  removed; neither repository runner was changed.
- `bun test apps/cli/tests/stage.test.ts apps/cli/tests/commands/stage.test.ts`: 12 pass,
  0 fail. The current tests do not cover a checkout containing both divergent candidates.
- The real source/staged runner SHA-256 values currently match. This closes the immediate
  stale artifact from 0176, but does not fix the resolver's preference.
- `scripts/bundle-plugins.ts` creates the package copy; `apps/cli/package.json`
  runs it in `build:bundle` / `prepack`. Ordinary `build` only builds the CLI.
  Manual rsync is a workaround, not the required packaging procedure.

**Refine corrections (2026-09-27)**

- "A fix only takes effect after manual rsync" → staging/prepack also refreshes it →
  repair checkout runtime selection without changing the release copy process.
- Unqualified stale-bundle capture → both current runner files are byte-identical →
  retain the task for the reproducible latent hazard, not a currently divergent artifact.
- "Live source or a hash check" → freeze source selection for a positively identified checkout →
  avoid per-run hashing, synchronization, and a new configuration surface.
- "Every workflow already uses kk stage" → daily voice and ITC tail use it, while several
  solo/ITC/storm actions still shell the script directly → bound this task to the CLI resolver
  and document those legacy paths accurately rather than promising to repair them here.

### Requirements

- [x] R1. When the real running CLI entry belongs to the module's identified knowledge-kit checkout, both src/index.ts and dist/index.js entries (including symlinked entries) execute the checked-in plugins/kk/scripts/kk-workflow-stages.ts even if apps/cli/plugins contains a divergent copy.
- [x] R2. An installed CLI continues to execute its own package-shipped runner, including when cwd is a knowledge-kit checkout or contains planted plugins; an unrelated ancestor plugins directory cannot become a checkout runner merely because CHECKOUT_ROOT points above the installed bundle.
- [x] R3. A recognized checkout with its source runner absent fails with the attempted source path and install/refresh guidance instead of silently running its staged copy. The module-anchored source fallback remains available for an absent/unresolvable entry only when the module has checkout identity; when no eligible runner exists, resolution fails loud.
- [x] R4. The resolver remains the single selection point for kk stage; positional/unknown-option forwarding, inherited stdio, runner-relative helper loading, exit-code passthrough, and spawn-failure errors retain their current behavior.
- [x] R5. Hermetic regression tests distinguish live and stale runners, exercise both source and compiled checkout entry modes plus a symlink, and prove an isolated compiled installed package still works with no checkout files.
- [x] R6. docs/04_DESIGN.md §1.8/§7 and the resolver/runner resolution comments describe checkout-source selection and installed-package behavior accurately in the implementation change.

Out of scope: product-plugin discovery in kk-core; workflow YAML selection; migration of legacy
direct `bun "$st"` workflow actions; stage business logic; changing explicit/env sidecar overrides;
automatic staging/building at runtime; hashes, watchers, new flags/env vars/dependencies; editing
generated `apps/cli/plugins` bytes or GitHub workflows.

### Acceptance Criteria

These are task-local regressions below F8's shipping scenarios; set both `ac_altitude`
and `ac_numbering` to `task-local`.

- [x] AC1 — Checkout source wins over a divergent staged runner (req: R1, R5)
  Given a temporary checkout with src/index.ts, dist/index.js, the source-module marker and
  different source/staged runner bodies, when each entry is resolved, then the canonical source
  path wins. Cover a symlink to the entry and a changed source body without restaging.
  Observe in apps/cli/tests/stage.test.ts or apps/cli/tests/commands/stage.test.ts.
- [x] AC2 — Installed package keeps its own runner from every cwd (req: R2, R5)
  Given an isolated package with a shipped runner and a simultaneously available foreign checkout,
  when its entry resolves from either a planted-script cwd or that checkout, then its own runner wins.
  A fixture lacking the checkout-module marker must ignore a nearby ancestor source candidate.
  Observe in apps/cli/tests/commands/stage.test.ts with explicit fixture roots and in the compiled smoke case.
- [x] AC3 — Missing checkout source cannot silently execute staged bytes (req: R3)
  Given a recognized checkout entry with a staged runner but no source runner, when it resolves,
  then it throws naming the source path and remediation. With an unresolvable entry, the genuine
  module-anchored checkout fallback still succeeds; with neither eligible runner, it fails loud.
  Observe in apps/cli/tests/stage.test.ts.
- [x] AC4 — Compiled CLI executes live checkout bytes and packaged install bytes (req: R1, R2, R4, R5)
  Given the production CLI bundled into a temporary checkout-shaped dist directory with runners
  exiting 17 (source) and 18 (staged), when bun <entry> stage fixture --future-flag executes from
  an unrelated cwd, then exit 17 proves the source was spawned; changing source to exit 19 changes
  the next invocation to 19 without restaging. Run the same bundle relocated into an isolated
  package without apps/cli/src/stage.ts, alongside its own runner exiting 18; it exits 18 even
  when launched inside the foreign checkout. Use the real CLI/resolver, not a mocked resolver.
  Observe in apps/cli/tests/commands/stage.test.ts.
- [x] AC5 — Stage invocation contracts remain intact (req: R4)
  Given a fixture runner checking its stage and unknown-option arguments, when runStage and
  the Commander stage action execute it, then arguments and exit codes pass through, stdio remains
  inherited and an unavailable executable raises the existing named spawn error.
  Observe via existing tests in apps/cli/tests/commands/stage.test.ts and apps/cli/tests/stage.test.ts.
- [x] AC6 — Documentation states the implemented resolution boundary (req: R6)
  Given the implementation diff, when docs/04_DESIGN.md §1.8/§7 and resolution comments are read,
  then they distinguish recognized checkout and installed-package modes, retain sidecar override
  precedence, and do not claim legacy direct shell calls are repaired.

### Q&A

- **Chosen:** prefer checked-in stage files only for a positively identified checkout entry.
  The real package-root match plus the module's checkout marker keep installed packages independent
  of whatever source tree the caller happens to be in.
- **Rejected:** unconditional source-first ordering. When imported from this checkout, it would
  override the fake installed packages in existing tests; in an installed bundle, a coincidental
  ancestor plugins tree could override distribution content.
- **Rejected:** runtime hashes or automatic resync/build. Source selection solves the checkout issue
  without per-stage I/O over files, mutating generated assets, or a hidden build step.
- **Missing source:** a recognized checkout fails loud; its staged copy is not an authorized fallback.
- **Legacy YAML:** direct bun-script resolution is outside this CLI task. Keep that behavior and
  describe it accurately; a future workflow-resolution task can migrate those actions if requested.
- **ADR:** this is a reversible local resolver correction; ADR-011's stage ownership and ADR-012's
  product-plugin distribution decisions remain intact. No new API or package boundary is introduced.
- **Delegation:** one implementer owns the resolver, its two existing test files, documentation and
  the runner's resolution comment. No unresolved design decision or prerequisite task remains.

### Design

**Decision:** fix `resolveStagesScript()` in place, selecting the live script for a recognized
checkout entry while retaining package-first behavior for an installed entry. No new API,
configuration, runtime dependency, or shared resolver abstraction.

Primary implementation targets:

- `apps/cli/src/stage.ts`: resolution policy and its docblock. Preserve
  `resolveStagesScript(argv1 = process.argv[1], checkoutRoot = CHECKOUT_ROOT): string`,
  `runStage(args, execPath, argv1)`, `STAGES_REL` and the module-derived `CHECKOUT_ROOT`.
- `apps/cli/tests/stage.test.ts`, `apps/cli/tests/commands/stage.test.ts`: regression cases.
  Reuse the existing temporary-directory/installed-package helpers where applicable.
- `docs/04_DESIGN.md` §1.8/§7: surface contract in the same implementation change.
- `plugins/kk/scripts/kk-workflow-stages.ts`: update only the stale resolution/header explanation;
  stage and sidecar business logic stays as it is.

**Frozen resolution algorithm**

1. Derive the source candidate as `join(checkoutRoot, STAGES_REL)`.
   Identify a module checkout by a regular source-module file at
   `join(checkoutRoot, 'apps/cli/src/stage.ts')` (the package files allow-list does not ship src).
   This marker must not depend on cwd, environment, or a .git directory; worktrees and symlinks work.
2. Resolve `argv1` through `realpathSync` as today. Keep its real package root
   (`dirname(dirname(realEntry))`) and package-script candidate.
   A checkout entry is recognized only when the checkout marker is present and the real package
   root equals `realpathSync(join(checkoutRoot, 'apps/cli'))`.
   Compare canonical paths so /var versus /private/var and symlinked checkout roots are equivalent.
   If realpath fails, leave the package candidate unavailable rather than crashing this probe.
3. For a recognized checkout entry, return the source candidate if it is a regular file.
   Otherwise throw naming that source candidate and retaining "install or refresh the kk package"
   guidance. Do not fall through to the stale staged runner.
4. For every other entry, return the existing package-script candidate when present as a regular
   file. A separately installed entry still wins even when this module is imported from a checkout.
5. If no package runner is available, allow the existing module-anchored source fallback only when
   the checkout marker exists and the source runner is a regular file. An installed bundle whose
   ../../../ happens to contain plugins, without that marker, must not load that tree.
6. Otherwise throw the existing not-found/remediation error. Keep realpath-probe handling narrow
   so the deliberate missing-checkout-source error is never swallowed.

Use existing fs/path APIs; if needed use `statSync(path, { throwIfNoEntry: false })?.isFile()`
with a narrowly handled filesystem probe. No helper exported for this check. File presence does
not establish freshness: precedence is exercised with different bytes and exit codes.

**Execution and helpers**

`registerStageCommand → runStage → resolveStagesScript → spawnSync` is the full affected call
chain. Leave spawn/Commander behavior intact. Selecting the source runner also moves its
`import.meta.dir`, lazy `./itc-stages.ts` import and default sibling sidecars to the checked-in
scripts directory. Explicit overrides and `KK_WORKFLOWS_DIR` continue to take precedence inside
that runner. No per-caller fixes or sidecar copy step are needed.

**Test and build observability**

For resolver tests, create all candidate files in temporary trees and inject checkoutRoot;
canonicalize temp paths before comparisons on macOS. Clean temporary trees and restore any
cwd/argv mutations in finally/afterEach. Replace the stale "apps/cli/plugins does not exist"
test comment: presence of that gitignored tree must not be a fixture precondition.

For the compiled case, bundle the real `apps/cli/src/index.ts` once using the existing Bun
build tooling into `<fixture>/apps/cli/dist/index.js`. Materialize the marker and tiny runner
files alongside it; no network calls, content generation, publishing or repository restaging.
Use `Bun.spawnSync` with captured output and assert exit 17/19 versus 18, plus argument checking.
Relocate those same compiled bytes into an isolated `<package>/dist/index.js` with only its
package runner to exercise the bundle's different `import.meta.dir`. This catches a source-only
fix or a compile-time checkout path baked into the bundle.

**Dependencies and concurrent work**

No new dependency WBS: tasks 0133/0157 already established the stage command and its
run-anywhere behavior; 0176 is completed provenance, not an execution blocker.
At refinement HEAD `6e32c246`, `spur task list --status wip --json` returned [],
and git worktree list showed one main worktree. Existing uncommitted changes are task 0177
and `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`; preserve them.
Do not broaden this task into xhs publishing, package discovery or YAML migration.

Before changing numbered documentation, read docs/99_PROJECT_CONSTITUTION.md and use the
doc-evolve process. Update the stage-specific wording only: §7's claim that every action already
uses kk stage is contradicted by the legacy solo/ITC/storm scripts and must not be repeated.

### Plan

1. [x] Re-read the current resolver, both stage test files and the runner header; check git status
   and current task/worktree ownership. Preserve task 0177/xhs edits. Reconfirm source/compiled entry
   selection without syncing apps/cli/plugins. (R1, R2)
2. [x] Add hermetic divergent-candidate tests first: checkout source/compiled/symlink identity,
   foreign installed package, planted cwd and ancestor plugins, missing recognized source,
   invalid entry fallback, and missing-everywhere error. Record that checkout-precedence tests
   fail against the old resolver. (R1, R2, R3, R5)
3. [x] Apply the frozen identity/precedence algorithm inside resolveStagesScript; retain the public
   signatures and runStage/Commander execution behavior. (R1, R2, R3, R4)
4. [x] Add the compiled real-CLI subprocess regression using one temporary Bun bundle:
   source 17 → edited source 19 without restaging, staged 18 ignored in checkout, relocated installed
   package returns 18 even from a foreign checkout. Verify stage/unknown-option forwarding.
   Clean fixtures and restore process state. (R1, R2, R4, R5)
5. [x] Read docs/99_PROJECT_CONSTITUTION.md, update docs/04_DESIGN.md §1.8/§7 and the
   resolver/runner comments, preserving accurate legacy YAML and sidecar-override wording. (R6)
6. [x] Run bun test apps/cli/tests/stage.test.ts apps/cli/tests/commands/stage.test.ts;
   then bun run lint, bun run test and bun run build. Run spur rule run
   --preset recommended-pre-check --json and spur task check 0178 --json.
   Fix failures without suppressions, skipped tests or force flags. (R1–R6)
7. [x] Record implementation, review and verification evidence through the normal Spur pipeline,
   obtain a real verify PASS, and inspect git diff/status for intentional changes before completion.
   Check in docs/04_DESIGN.md with the surface code; do not edit generated plugin copies. (R1–R6)

### Solution

Task 0178 implements entry-identity resolution at the existing stage seam:

- `apps/cli/src/stage.ts:44-70`: source-marker plus canonical package-root identity chooses
  checked-in checkout scripts; installed entries keep their own shipped runner. Missing recognized
  source fails with its path and install guidance; source fallback is marker-gated.
- `apps/cli/tests/stage.test.ts:93-137`: divergent source/staged fixtures, symlink identity,
  absent source, module fallback and markerless/unstattable roots.
- `apps/cli/tests/commands/stage.test.ts:158-210`: real compiled CLI proof, source 17 → 19 after
  editing without restaging, then isolated installed copy 18.
- `docs/04_DESIGN.md:319-325` and `docs/04_DESIGN.md:707`: stage-resolution surface and accurate
  legacy direct-shell boundary.
- `plugins/kk/scripts/kk-workflow-stages.ts:35-37`: checkout/installed header explanation.

#### Verification repairs (2026-09-28)

The compiled regression now checks exact stage and unknown-option arguments and launches the
installed bundle from both a planted-script cwd and the foreign checkout
(`apps/cli/tests/commands/stage.test.ts:162-202`).
All cwd-changing resolver fixtures now clean their temporary directories and the stale
staged-copy-absence comment is corrected (`apps/cli/tests/stage.test.ts:24-62`).
The false all-workflows-use-stage statement is corrected in §7.1 and doc metadata refreshed.
No runtime resolver, sidecar override, legacy workflow action or generated plugin copy changed
during re-verification.

#### Shippable-gate repair (2026-09-28)

The follow-up request expands validation to F8's feature completion gate.
`.spur/workflows/feature-verification.yaml:75-80` now declares `terminalReason: failed-check`
on its failure edge, which the installed harness requires. The existing vendored
`plugins/sp/lib/inline-run.generated.mjs` is regenerated through Spur's `bundleInlineRunLib`
builder so its workflow schema accepts that same contract. Its bytes match the authoritative
builder output (SHA-256 `25218b4adc86c57670d1ee0c0ca8042afaf82ab75a3a4da7974f9a143acbfe69`).
No receipt is hand-authored; the feature-verification workflow writes and registers its evidence.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/stage.ts:58-62` selects fromCheckout before staged bytes for recognized entries; `apps/cli/tests/stage.test.ts:93-102` covers source and symlink identity; `apps/cli/tests/commands/stage.test.ts:158-186` executes compiled source 17 then edited source 19 without restaging. `bun test apps/cli/tests/stage.test.ts apps/cli/tests/commands/stage.test.ts` exit 0, 20 pass. |
| R2 | MET | `apps/cli/src/stage.ts:65-70` preserves the installed package and marker-gates ancestor fallback; `apps/cli/tests/commands/stage.test.ts:188-202` executes the isolated compiled package from a planted-script cwd and a foreign checkout, exit 18 in both. Current full `bun run spur-check` exit 0, 1511 pass. |
| R3 | MET | `apps/cli/src/stage.ts:60-70` names missing checkout source and install guidance without using stale bytes; `apps/cli/tests/stage.test.ts:105-137` verifies missing source, unresolvable-entry fallback, markerless ancestry and failed filesystem probes. Current full `bun run spur-check` exit 0, 1511 pass. |
| R4 | MET | `apps/cli/src/stage.ts:74-80` retains inherited stdio, spawn error and exit status; `apps/cli/src/commands/stage.ts:13-18` forwards variadic/unknown arguments. `apps/cli/tests/commands/stage.test.ts:162-201` checks exact stage/flag arguments; `bun .spur/run/0178-golden-path.ts` exit 0 executes real src/dist CLI and confirms runner-relative style bytes. Verification scratch origin: `.spur/run/0178-golden-path.ts` lines 1-35 and `.spur/run/0178-golden-path.log` lines 1-3. |
| R5 | MET | `apps/cli/tests/commands/stage.test.ts:158-210` bundles the real CLI once and exercises source updates and isolated installed execution; `apps/cli/tests/stage.test.ts:24-28` restores cwd and cleans fixtures. Stage regression: 20 cases; current full `bun run spur-check`: 1511 pass, 0 fail, 5849 assertions. Resolver line/function coverage 100%. Verification scratch origin: `.spur/run/0178-before-fix-probe.ts` lines 1-34 and `.spur/run/0178-before-fix-probe.log` line 1 prove the original resolver exits 18 while the current resolver exits 17; `.spur/run/0178-lint.log` lines 1-224; `.spur/run/0178-tests.log` lines 1-105; `.spur/run/0178-build.log` lines 1-6; `.spur/run/0178-pre-rules.json` lines 1-6; `.spur/run/0178-post-rules.json` lines 1-6; `.spur/run/0178-test-gate.log` lines 1-337; `.spur/run/0178-check-receipt.json` lines 1-18. Full-tier receipt PASS matches the current input digest. |
| R6 | MET | `docs/04_DESIGN.md:319-325` and `docs/04_DESIGN.md:707` state checkout and installed behavior and legacy direct calls; `plugins/kk/scripts/kk-workflow-stages.ts:35-37` explains stage resolution. `bun .spur/run/0178-golden-path.ts` exit 0 checks the doc boundary and unchanged storm direct shell. Frontmatter version 2.38.0, updated 2026-09-28. Verification scratch origin: `.spur/run/0178-verify-answer.txt` lines 1-57; `.spur/run/0178-verdict.json` lines 1-157; `.spur/run/0178-residuals.json` lines 1-34; `.spur/run/0178-base.sha` line 1; `.spur/run/0178-feature-check.json` lines 1-12; `.spur/run/0178-feature-completion-check.json` lines 1-12; `.spur/run/0178-test-gate.status` line 1; `.spur/run/0178-test-fix-attempt` line 1; `.spur/run/0178-test-gate.findings` is empty (no finding lines). Residual scan covers all four lenses and reports blocking 0, deferrable 0, advisory 2, housekeeping 0. A pre-existing task Background staging file was archived from /tmp to verification scratch origin `.spur/run/0178-original-background-staging.md` lines 1-8; final F1 and F5 command counts both 0. F8 completion readiness PASS: the real final feature-verification workflow reached done and both receipt copies match. Completion scratch origin: `.spur/run/0178-harness-lib/inline-run.generated.mjs` lines 1-1489 and `.spur/run/0178-harness-lib/inline-run.generated.d.mts` lines 1-20 are authoritative generated builder output; `.spur/run/F8-feature-verification.json` lines 1-17; `.spur/run/F8-0178-shippable-final-20260928-feature-verification.json` lines 1-17; `.spur/run/F8-0178-shippable-final-20260928-feature-verification.log` lines 1-334; `.spur/run/F8-0178-shippable-final-20260928.md` lines 1-14; `.spur/run/dogfood/F8-0178-stage-dogfood-20260928.md` lines 1-85 and dogfood report origin `docs/dogfood/2026-09-28-F8-stage-resolution-dogfood.md` lines 1-85. `docs/dogfood/INDEX.md:7` preserves F8 attribution. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/stage.test.ts:93-102` source/symlink identity; `apps/cli/tests/commands/stage.test.ts:158-186` compiled runner exits 17 then 19 after a source-only edit. Current full `bun run spur-check` exit 0, 1511 pass. |
| AC2 | MET | test | `apps/cli/tests/commands/stage.test.ts:188-202` isolated installed bundle exits 18 from planted-script cwd and foreign checkout; `apps/cli/tests/stage.test.ts:124-129` ignores a markerless ancestor candidate. Current full `bun run spur-check` exit 0, 1511 pass. |
| AC3 | MET | test | `apps/cli/tests/stage.test.ts:105-137` asserts source-path remediation with staged bytes present, invalid-entry fallback, markerless/missing roots and filesystem errors. Current full `bun run spur-check` exit 0, 1511 pass. |
| AC4 | MET | test | `apps/cli/tests/commands/stage.test.ts:158-210` real CLI bundle selects source 17, source-only edit 19, relocated package 18 from both required cwd modes; fixture scripts also reject missing/incorrect stage or unknown-option arguments with exit 99. Current full `bun run spur-check` exit 0, 1511 pass. |
| AC5 | MET | test | `apps/cli/tests/stage.test.ts:66-76` and `apps/cli/tests/commands/stage.test.ts:79-119` exercise exit-code passthrough, spawn failures and Commander unknown-option handling; strengthened compiled fixture checks exact arguments. `bun .spur/run/0178-golden-path.ts` exit 0 verifies real CLI/sidecar execution. |
| AC6 | MET | command | `bun .spur/run/0178-golden-path.ts` exit 0: src/dist styleMatches true, documentation PASS and legacyCallsUnchanged true. Verified `docs/04_DESIGN.md:319-325`, `docs/04_DESIGN.md:707` and `plugins/kk/scripts/kk-workflow-stages.ts:35-37`; no generated plugin content changed. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Re-verification Review — 0178 (2026-09-28)

**Scope:** original implementation commit `e75d4674` plus the inline verification repairs to
the two stage test files and docs/04_DESIGN.md. Runtime resolver and command signatures are unchanged.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.
**Verdict:** PASS.

##### Findings and dispositions

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 (major) | correctness | `apps/cli/tests/commands/stage.test.ts:158-202` | Prior compiled test did not exercise installed execution from a foreign checkout and did not assert forwarded arguments. | FIXED — installed bundle now runs from both foreign checkout and planted-script cwd; all fixture runners validate stage and unknown-option arguments. |
| P2 (major) | usability | `docs/04_DESIGN.md:707` | Prior surface documentation claimed every workflow action used kk stage, contradicting legacy direct shells and R6. | FIXED — names daily voice/ITC tail and the unchanged legacy solo/ITC prepare/storm paths; doc metadata refreshed. |
| P2 (major) | correctness | Previous task Testing/Review | Prior Review R4–R6 described other requirements, and the AC6 Testing evidence was truncated by a pipe inside a command. | FIXED — this review maps the actual R1–R6 below; the new canonical verify answer and deterministic record replace Testing with complete evidence. |
| P4 (advisory) | usability | `apps/cli/src/stage.ts:17-22` | Filesystem probes classify inaccessible paths as absent; errors name the attempted runner with generic install guidance instead of errno details. | ACCEPTED — retains the specified probe policy and fail-loud behavior; no requirement asks for errno diagnostics. |
| P4 (advisory) | usability | `apps/cli/src/stage.ts:62` | Missing recognized source names the source path without mentioning the deliberately ignored staged candidate. | ACCEPTED — requirement R3 asks for the source path and remediation, which the test verifies. |

##### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/stage.ts:58-62` selects fromCheckout before staged bytes for recognized entries; `apps/cli/tests/stage.test.ts:93-102` covers source and symlink identity; `apps/cli/tests/commands/stage.test.ts:158-186` executes compiled source 17 then edited source 19 without restaging. `bun test apps/cli/tests/stage.test.ts apps/cli/tests/commands/stage.test.ts` exit 0, 20 pass. |
| R2 | MET | `apps/cli/src/stage.ts:65-70` preserves the installed package and marker-gates ancestor fallback; `apps/cli/tests/commands/stage.test.ts:188-202` executes the isolated compiled package from a planted-script cwd and a foreign checkout, exit 18 in both. Focused bun test exit 0. |
| R3 | MET | `apps/cli/src/stage.ts:60-70` names missing checkout source and install guidance without using stale bytes; `apps/cli/tests/stage.test.ts:105-137` verifies missing source, unresolvable-entry fallback, markerless ancestry and failed filesystem probes. Focused bun test exit 0. |
| R4 | MET | `apps/cli/src/stage.ts:74-80` retains inherited stdio, spawn error and exit status; `apps/cli/src/commands/stage.ts:13-18` forwards variadic/unknown arguments. `apps/cli/tests/commands/stage.test.ts:162-201` checks exact stage/flag arguments; `bun .spur/run/0178-golden-path.ts` exit 0 executes real src/dist CLI and confirms runner-relative style bytes. |
| R5 | MET | `apps/cli/tests/commands/stage.test.ts:158-210` bundles the real CLI once and exercises source updates and isolated installed execution; `apps/cli/tests/stage.test.ts:24-28` restores cwd and cleans fixtures. Focused tests: 20 pass, 0 fail, 29 assertions; full `bun run test`: 1511 pass, 0 fail, 5849 assertions. Resolver line/function coverage 100%. |
| R6 | MET | `docs/04_DESIGN.md:319-325` and `docs/04_DESIGN.md:707` state checkout and installed behavior and legacy direct calls; `plugins/kk/scripts/kk-workflow-stages.ts:35-37` explains stage resolution. `bun .spur/run/0178-golden-path.ts` exit 0 checks the doc boundary and unchanged storm direct shell. Frontmatter version 2.38.0, updated 2026-09-28. |

##### Architecture and security

The existing `resolveStagesScript → runStage` seam owns selection and execution.
No new API, dependency, package boundary, configuration, hash pass or runtime build step.
Canonical entry/package identity and module-root marker gate source preference; cwd never becomes
a resolver root. Argument vectors remain direct spawn arguments. Tests exercise the real compiled
CLI with temporary files, clean fixtures and restore cwd. No blocker or major finding remains.

**Fresh checks:** focused stage tests 20/20; lint exit 0; full tests 1511/1511; build exit 0;
pre-check rules 51/51 and post-check rules 2/2. The current full-tier receipt and residual fold
are recorded by the verification step.

**Next:** retain the already-terminal task status; the shippable follow-up below closes F8 completion evidence.

#### Shippable follow-up Review (2026-09-28)

**Authorized scope:** clear every remaining gate before the proposed commit.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 (major) | correctness | `.spur/workflows/feature-verification.yaml:75-80` | The existing project verifier cannot validate under the current harness because its failure edge lacks terminalReason. | FIXED — declares failed-check; workflow validate passes and its dry-run confirms the fail-closed path without evidence. |
| P2 (major) | architecture | plugins/sp/lib/inline-run.generated.mjs | The vendored inline runtime uses an older transition schema than the installed CLI, rejecting the required terminal metadata. | FIXED — regenerated from the authoritative Spur bundleInlineRunLib builder; bytes match builder output and the real feature-verification run reaches done with a registered PASS receipt. |
| P2 (major) | traceability | `docs/dogfood/INDEX.md:7` | F8's self-referential workflow gate has no durable dogfood attribution. | FIXED — actual source/compiled CLI and sidecar check PASS; protocol report validator PASS; tracked F8 index survives fresh clones via the ignore exception. |

The public resolver and command contracts stay the same. The regenerated harness artifact uses
the existing exported operations; no handwritten minified change or weakened gate. Failure
routing remains explicit and completion still requires matching workflow-written receipts.
The dogfood report records its one CLI observation live and separates earlier verifier repairs
as historical context; it does not attribute those repairs to its observe-only driver.
No blocker or major finding remains. Two original P4 diagnostics remain accepted as specified.

### References

- Parent: [F8 — Run-anywhere workflow and script resolution](../features/F8_run-anywhere-workflow-and-script-resolution.md).
- [Task 0176 — daily-intro collision](0176_daily-intro-merges-from-mp3path-so-the-concat-output-collide.md): Root Cause, Plan step 5 and Review P4 document the original staging hazard.
- Local 0176 advisory artifact: `.spur/run/0176-residuals.json` (verified present 2026-09-27).
- Resolver: `apps/cli/src/stage.ts:44-80`; command caller: `apps/cli/src/commands/stage.ts:9-21`.
- Regression locations: `apps/cli/tests/stage.test.ts`, `apps/cli/tests/commands/stage.test.ts`.
- Package copy owner: `scripts/bundle-plugins.ts`; build/prepack contract: `apps/cli/package.json`;
  generated-tree ignore: `.gitignore:161`.
- [ADR-011 amendment 2026-09-18 / ADR-012](../00_ADR.md), [execution boundary integrity](../03_ARCHITECTURE.md),
  [CLI stage surface §1.8 and workflow resolution §7](../04_DESIGN.md),
  [documentation process](../99_PROJECT_CONSTITUTION.md).
- Legacy direct shells checked: `plugins/kk/workflows/kk-solo-podcast.yaml`,
  `kk-itc.yaml` prepare and `kk-storm-research.yaml`; they do not call resolveStagesScript.
- No wip tasks or additional worktrees at refinement. Existing dirty paths belong to task 0177/xhs
  testing and are outside this task's ownership.

### History

- 2026-09-28T04:41:21.035Z backlog → todo (system)
- 2026-09-28T07:35:39.930Z todo → wip (system)
- 2026-09-28T17:04:00.393Z wip → testing (system)
- 2026-09-28T17:07:14.088Z testing → done (system)

### Notes

**Implement-ready audit (2026-09-27)**

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | R1–R6 name observable behavior and explicit non-goals. |
| design | true | Existing resolver/signatures retained; frozen checkout identity and ordered selection; code/test/doc paths fixed. |
| plan | true | Ordered steps map to requirements and require regression, compiled execution and repository gates. |
| ac | true | AC1–AC6 bind every R-item and identify runnable test layers; task-local F8 regressions. |
| decisions | true | Q&A closes source preference, installed behavior, missing source, hashes/resync, legacy YAML and ADR choices. |
| dependencies | true | Existing stage contracts are present; 0176 is done provenance; no prerequisite WBS or overlapping wip task. |
| premises | true | Real src/dist selections, divergent fixture exit 18, matching current hashes, 12 passing tests, package scripts and workflow call sites checked at HEAD 6e32c246. |

This audit certifies the specification for delegation. It is not an implementation or a product
verify PASS; Solution, Testing and Review remain for their implementation-pipeline owners.

#### Forced verification (2026-09-28)

Standalone inline `sp-dev-verify 0178 --auto --next --force --agent inline --focus all --fix all`:
R1–R6 and AC1–AC6 MET; task verdict PASS. Strengthened the real compiled CLI regression for
foreign-checkout execution and exact argument forwarding, cleaned cwd fixtures, corrected the
legacy-workflow documentation and replaced stale Solution/Review/Testing evidence through Spur.
Runtime selection remains the implemented entry-identity algorithm.

Fresh checks: focused tests 20 pass/0 fail/29 assertions; full tests 1511 pass/0 fail/5849
assertions; aggregate function coverage 98.55%, line coverage 98.30%, stage resolver 100% each;
lint/build exit 0; pre-check 51 rules and post-check 2 rules with no findings. The full-tier
`bun run spur-check` receipt is bound to the final specification and worktree digest
`sha256:1e134892a1ed5722b07729f3b847e6ea19e21010d33191b5a130ff300bec81ee`.
The deterministic Testing renderer's generic coverage N/A footer does not replace the measured
coverage recorded in R5 evidence.

The residual scan includes review findings, implementation diff markers, unchecked boxes and
staging residue: blocking 0, deferrable 0, advisory 2, housekeeping 0. Exact durable ignored
artifact paths and line ranges are disclosed in Testing R4–R6. Section-input staging files
were removed after landing. F1 unchecked-box command printed 0; F5 staging scan found no
`/tmp/0178-*` files.

Shippable: FAIL
Feature: F8
The ordinary feature check passes and all linked tasks are done/cancelled, but completion
check reports `L4.feature-receipt-missing`: `.spur/run/F8-feature-verification.json` is absent.
Recovery is a feature-scoped verification pass; this task-local pass does not create that receipt.
`task record` warns that the 12 R/AC rows match no feature scenario: AC1–AC6 are explicitly
task-local, so their existing keys are retained without assigning false feature-scenario credit.

`--next`: no-op because 0178 was already done; no terminal demotion, duplicate transition or
force-done override. Verification repairs remain uncommitted.

#### Shippable follow-up completed (2026-09-28)

The request to clear all remaining gates authorized the feature-scoped completion pass.
Task 0178 remains done with R1–R6 and AC1–AC6 MET. Shippable: PASS (F8).

The project verifier's failure edge now declares failed-check. Its vendored inline runtime is
regenerated from Spur's authoritative bundleInlineRunLib builder, eliminating schema skew;
no generated code was edited by hand. The source and compiled CLI dogfood passed with matching
runner-relative style bytes; its protocol report validator returned ok. The tracked
[dogfood index](../dogfood/INDEX.md) and its ignore exception preserve F8 attribution in a clone.

The final feature-verification run `F8-0178-shippable-final-20260928` reached done and registered
matching run-scoped/feature-latest PASS receipts. Its full check log records 1511 pass, 0 fail,
5849 assertions, clean lint/typechecks, 51 pre-check rules and 2 post-check rules. Build exit 0.
`spur feature check F8 --as done --json` now reports pass true, findings []. All linked tasks
are done/cancelled. The earlier missing-receipt and dogfood findings are resolved.

The final 0178 full-tier receipt uses the project-local inline driver's input digest
`sha256:e4b3fd65514ae89975c8c835682eb167331639f10772e0c640e14f27abd9bf29`.
Verification scratch paths and exact line ranges, including the generated builder output,
feature receipts, raw logs and dogfood artifacts, are disclosed in Testing R4–R6.
The task-local AC keys remain unchanged; no false feature-scenario credit is assigned.
Original P4 diagnostic observations remain accepted, with no requirement or shipping blocker.

`--next` remains a no-op because the task is already done. Changes are uncommitted for the
operator's next step; no GitHub workflow, generated apps/cli/plugins copy or product API changed.

