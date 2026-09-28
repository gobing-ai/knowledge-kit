---
schema_version: 1
name: CLI resolves kk stage scripts from gitignored apps/cli/plugins — stale-bundle hazard
status: todo
template: feature-impl
created_at: 2026-09-27T06:00:25.472Z
updated_at: "2026-09-28T04:41:21.035Z"
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

- [ ] R1. When the real running CLI entry belongs to the module's identified knowledge-kit checkout, both src/index.ts and dist/index.js entries (including symlinked entries) execute the checked-in plugins/kk/scripts/kk-workflow-stages.ts even if apps/cli/plugins contains a divergent copy.
- [ ] R2. An installed CLI continues to execute its own package-shipped runner, including when cwd is a knowledge-kit checkout or contains planted plugins; an unrelated ancestor plugins directory cannot become a checkout runner merely because CHECKOUT_ROOT points above the installed bundle.
- [ ] R3. A recognized checkout with its source runner absent fails with the attempted source path and install/refresh guidance instead of silently running its staged copy. The module-anchored source fallback remains available for an absent/unresolvable entry only when the module has checkout identity; when no eligible runner exists, resolution fails loud.
- [ ] R4. The resolver remains the single selection point for kk stage; positional/unknown-option forwarding, inherited stdio, runner-relative helper loading, exit-code passthrough, and spawn-failure errors retain their current behavior.
- [ ] R5. Hermetic regression tests distinguish live and stale runners, exercise both source and compiled checkout entry modes plus a symlink, and prove an isolated compiled installed package still works with no checkout files.
- [ ] R6. docs/04_DESIGN.md §1.8/§7 and the resolver/runner resolution comments describe checkout-source selection and installed-package behavior accurately in the implementation change.

Out of scope: product-plugin discovery in kk-core; workflow YAML selection; migration of legacy
direct `bun "$st"` workflow actions; stage business logic; changing explicit/env sidecar overrides;
automatic staging/building at runtime; hashes, watchers, new flags/env vars/dependencies; editing
generated `apps/cli/plugins` bytes or GitHub workflows.

### Acceptance Criteria

These are task-local regressions below F8's shipping scenarios; set both `ac_altitude`
and `ac_numbering` to `task-local`.

- [ ] AC1 — Checkout source wins over a divergent staged runner (req: R1, R5)
  Given a temporary checkout with src/index.ts, dist/index.js, the source-module marker and
  different source/staged runner bodies, when each entry is resolved, then the canonical source
  path wins. Cover a symlink to the entry and a changed source body without restaging.
  Observe in apps/cli/tests/stage.test.ts or apps/cli/tests/commands/stage.test.ts.
- [ ] AC2 — Installed package keeps its own runner from every cwd (req: R2, R5)
  Given an isolated package with a shipped runner and a simultaneously available foreign checkout,
  when its entry resolves from either a planted-script cwd or that checkout, then its own runner wins.
  A fixture lacking the checkout-module marker must ignore a nearby ancestor source candidate.
  Observe in apps/cli/tests/commands/stage.test.ts with explicit fixture roots and in the compiled smoke case.
- [ ] AC3 — Missing checkout source cannot silently execute staged bytes (req: R3)
  Given a recognized checkout entry with a staged runner but no source runner, when it resolves,
  then it throws naming the source path and remediation. With an unresolvable entry, the genuine
  module-anchored checkout fallback still succeeds; with neither eligible runner, it fails loud.
  Observe in apps/cli/tests/stage.test.ts.
- [ ] AC4 — Compiled CLI executes live checkout bytes and packaged install bytes (req: R1, R2, R4, R5)
  Given the production CLI bundled into a temporary checkout-shaped dist directory with runners
  exiting 17 (source) and 18 (staged), when bun <entry> stage fixture --future-flag executes from
  an unrelated cwd, then exit 17 proves the source was spawned; changing source to exit 19 changes
  the next invocation to 19 without restaging. Run the same bundle relocated into an isolated
  package without apps/cli/src/stage.ts, alongside its own runner exiting 18; it exits 18 even
  when launched inside the foreign checkout. Use the real CLI/resolver, not a mocked resolver.
  Observe in apps/cli/tests/commands/stage.test.ts.
- [ ] AC5 — Stage invocation contracts remain intact (req: R4)
  Given a fixture runner checking its stage and unknown-option arguments, when runStage and
  the Commander stage action execute it, then arguments and exit codes pass through, stdio remains
  inherited and an unavailable executable raises the existing named spawn error.
  Observe via existing tests in apps/cli/tests/commands/stage.test.ts and apps/cli/tests/stage.test.ts.
- [ ] AC6 — Documentation states the implemented resolution boundary (req: R6)
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

1. [ ] Re-read the current resolver, both stage test files and the runner header; check git status
   and current task/worktree ownership. Preserve task 0177/xhs edits. Reconfirm source/compiled entry
   selection without syncing apps/cli/plugins. (R1, R2)
2. [ ] Add hermetic divergent-candidate tests first: checkout source/compiled/symlink identity,
   foreign installed package, planted cwd and ancestor plugins, missing recognized source,
   invalid entry fallback, and missing-everywhere error. Record that checkout-precedence tests
   fail against the old resolver. (R1, R2, R3, R5)
3. [ ] Apply the frozen identity/precedence algorithm inside resolveStagesScript; retain the public
   signatures and runStage/Commander execution behavior. (R1, R2, R3, R4)
4. [ ] Add the compiled real-CLI subprocess regression using one temporary Bun bundle:
   source 17 → edited source 19 without restaging, staged 18 ignored in checkout, relocated installed
   package returns 18 even from a foreign checkout. Verify stage/unknown-option forwarding.
   Clean fixtures and restore process state. (R1, R2, R4, R5)
5. [ ] Read docs/99_PROJECT_CONSTITUTION.md, update docs/04_DESIGN.md §1.8/§7 and the
   resolver/runner comments, preserving accurate legacy YAML and sidecar-override wording. (R6)
6. [ ] Run bun test apps/cli/tests/stage.test.ts apps/cli/tests/commands/stage.test.ts;
   then bun run lint, bun run test and bun run build. Run spur rule run
   --preset recommended-pre-check --json and spur task check 0178 --json.
   Fix failures without suppressions, skipped tests or force flags. (R1–R6)
7. [ ] Record implementation, review and verification evidence through the normal Spur pipeline,
   obtain a real verify PASS, and inspect git diff/status for intentional changes before completion.
   Check in docs/04_DESIGN.md with the surface code; do not edit generated plugin copies. (R1–R6)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent: [F8 — Run-anywhere workflow and script resolution](../features/F8_run-anywhere-workflow-and-script-resolution.md).
- [Task 0176 — daily-intro collision](0176_daily-intro-merges-from-mp3path-so-the-concat-output-collide.md): Root Cause, Plan step 5 and Review P4 document the original staging hazard.
- Local 0176 advisory artifact: `.spur/run/0176-residuals.json` (verified present 2026-09-27).
- Resolver: `apps/cli/src/stage.ts:8-40`; command caller: `apps/cli/src/commands/stage.ts:9-24`.
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

