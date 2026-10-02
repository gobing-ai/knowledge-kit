---
schema_version: 1
name: Remove the hand-vendored sp plugin scripts once spur 0960 ships
status: todo
template: standard
created_at: 2026-09-26T17:13:29.261Z
updated_at: "2026-10-02T18:39:36.443Z"

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 4
---

## 0175. Remove the hand-vendored sp plugin scripts once spur 0960 ships

### Background

The cleanup is still necessary, but the upstream release wait is over. Installed `@gobing-ai/spur` is **0.3.97**; upstream task **spur-new/0960** is `done`. The released workflow and installed script-root entrypoint contain its consumer/source-repo isolation. This repository has no `config/plugin-scripts.json`. Running the installed `script-root.mjs` here records `mode: installed`, `source: global`, a resolved directory and `scriptSetDigest`, and emits the expected ignored-vendor warning.

Current inventory at knowledge-kit `c81118bf`: **41 tracked files** under `plugins/sp/`: **39 scripts and 2 library files**. The older 2026-09-25 measurements (7 absent / 23 drifted against plugin 0.3.92, and the five original copying commits) remain historical evidence, not today's inventory. The vendored `feature-dev-precheck.{ts,mjs}` has no external caller in `.spur`, `plugins`, `scripts` or `package.json`.

The remaining live bypass is `.spur/workflows/feature-verification.yaml:56`, which executes the vendored TypeScript script directly. Upgrading Spur does not replace a project workflow. This override must stay because its configured command is `bun run spur-check`; `package.json` has no `spur-check-feature`. Its `terminalReason: failed-check` is already present at line 77. Both rules named below still protect `plugins/kk`; their `plugins/sp` references are comments, not literal include scopes.

**Confirmed installation blocker (2026-10-02).** Superskill 0.3.35 resolves the three required staged twins with `stamp.upstreamVersion: 0.3.97`; `superskill script verify sp --json` reports `status: ok`. Nevertheless, `bun <resolved inline-run-setup.mjs> --fingerprint --task-file <0175 file> --spur-bin spur` exits 1: `runInlineRunFingerprint is not a function`. The entrypoint imports `../lib/inline-run.generated.mjs`, outside its stamped `sp/` directory. That shared library has SHA-256 `3b2b1e03aa2199c18d66391244c09bf480ffa229f7656ff41f405812a883ef62`, while the packaged 0.3.97 library has `7621082faf5cc9fa0257cf8b35522fc1662c28a63bee32833b9784bff51824e6`. The same fingerprint invocation against the packaged entrypoint succeeds. Superskill's mapper/stager copy the plugin's `scripts/` tree, not its sibling `lib/`; a successful path lookup or reinstall alone is therefore insufficient proof of a working installation. The supported installation path must supply coherent transitive runtime assets before deletion is allowed. This upstream install repair belongs to Spur/Superskill, not a new downstream copy mechanism.

**Runtime distinction.** `node <resolved feature-verification-steps.mjs> verify ...` fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` for `bun:`; the generated library requires Bun. In an isolated Git project, the **packaged 0.3.97** verifier invoked with **Bun**, a CLI-created fixture feature and a definition-configured `bun --version` command records PASS and the workflow reaches `status: done`, `finalState: done`. This does not prove the currently staged installation works. The old context note claiming an unavoidable receipt foreign-key failure did not reproduce on this packaged/Bun path.

Evidence is retained under `.spur/run/refine-0175-20261002/`; the successful isolated run is `clean-fixture/.spur/memory/runs/refine0175-receipt-clean.md`. No live task/feature pipeline was run, no install target was changed, and no migration source change was made during refinement.

**Refine corrections (2026-10-02)**

- "Wait for 0960 to ship" → installed CLI/package and staged entrypoints identify 0.3.97, and the run-start probe works → remove the release wait; retain an executable compatibility preflight.
- "34 scripts" → `git ls-files plugins/sp` lists 39 scripts plus 2 libraries → freeze the current 41-file deletion set, recheck it before deleting.
- "Shipped feature verification still calls the vendored script unconditionally" → released workflow resolves a script root and uses that root → the unresolved bypass is the local override only.
- "The local override lacks failed-check" → `.spur/workflows/feature-verification.yaml:77` already contains it → preserve it.
- "Delete or reduce the override; implementer decides" → this repo lacks the upstream default's package script → keep the override and `bun run spur-check`.
- "Resolve the verification twin per step" → released follow-up work pins later actions to the recorded root → consume the run's installed root, with a fail-closed branch.
- "A resolving twin or successful install proves readiness" → the staged fingerprint fails despite a green stamp check → require transitive runtime and fingerprint preflight; stop before deletion when it fails.
- "Use Node for every .mjs twin" → the feature verifier's library imports Bun modules → run that verifier with Bun; retain Node for standalone script-root.
- "Update or retire obsolete rule scopes" → the two rule files have general scopes that still cover kk scripts → update comments only; preserve enforcement.
- "The broad hidden-tree rg is a sufficient acceptance check" → ignored generated artifacts and context/history retain references → scan tracked operational files and separately supersede the stale context recipe.
- "Three complete live pipelines are the only verification" → that dispatches unrelated work and cannot isolate the migration → require installed startup replays plus a real isolated feature-verification pass, without claiming full task/wrapup completion.

### Requirements

- [ ] R1. Capture CLI/package version, Superskill version and staged path/stamp descriptors for `script-root.mjs`, `inline-run-setup.mjs` and `feature-verification-steps.mjs`. The before-deletion run-start probe must record installed mode, its actual source/directory and a nonempty digest, with exactly one ignored-vendor warning. Do not require a release upgrade when these compatibility checks already pass.
- [ ] R2. Before changing the workflow or deleting files, the supported staged installation must load its transitive runtime assets and successfully execute `bun <resolved inline-run-setup.mjs> --fingerprint --task-file <0175 file> --spur-bin spur`, emitting one `sha256:<64 hex>` digest. Verify stamps as additional evidence, not as a substitute. On the confirmed shared-library defect, stop this migration's mutations and report the upstream install blocker; no hand-copy, symlink, source-checkout import or source-repo-marker workaround.
- [ ] R3. Keep `.spur/workflows/feature-verification.yaml` and `verificationCmd: "bun run spur-check"`. Replace only its verification state's action list with an installed-only script-root bootstrap and a verifier action pinned to that run's installed root. Invoke `feature-verification-steps.mjs` with Bun. Missing, unresolved, malformed or failing runtime inputs must route to the existing `failed` terminal; preserve the PASS guard, `failureStates`, run/feature IDs, receipt contract and `terminalReason: failed-check`.
- [ ] R4. Delete the complete tracked `plugins/sp/` tree (41 files at refinement), including both `feature-dev-precheck` files and both libraries, only after R2 passes. Reconcile any changed inventory or concurrent edits before deletion. Retain `plugins/kk/`, all product plugins and unrelated changes.
- [ ] R5. Remove the vendored-path examples from comments in `.spur/rules/boundary/shipped-script-isolation.yaml` and `.spur/rules/typescript/output-boundaries.yaml`; preserve every evaluator, pattern, include, exclude, severity and preset membership. Supersede the 2026-09-25 vendoring recipe in `.spur/context/learnings.md` with the supported installation and runtime preflight. Historical task evidence and ADR-018's upstream precedent remain intact.
- [ ] R6. Leave one repeatable E2E check, `scripts/verify-sp-install.ts`. `bun scripts/verify-sp-install.ts --preflight` performs R1/R2 before mutation; its vendor-warning expectation follows the directory's actual presence, so it also remains usable after cleanup. `bun scripts/verify-sp-install.ts` repeats runtime checks and additionally checks deletion, retained rule semantics, tracked operational references and workflow semantics. In an isolated Git fixture, replay actual task/wrapup startup resolution actions without model stages or cleanup, exercise the actual installed inline setup, and run the migrated feature-verification definition with a CLI-created feature and a definition-configured `bun --version` command. Assert installed root identity, absence of vendor warnings after deletion, a bound PASS receipt and terminal success. Also assert fail-closed feature verification for unresolved roots and a missing verifier. Emit command results, stderr, root descriptors, run identity and receipt paths to `.spur/run/0175-verification/summary.json`; retain failed artifacts. The check exits nonzero on any unmet assertion.
- [ ] R7. Pass `bun run lint`, `bun run test`, `bun run build`, both project rule presets and workflow validation on the final migration. Record real requirement/AC evidence through the task verification/record harness. A failed install preflight or failed fixture must remain a failure; do not mark the implementation done from structural task checks alone.

Out of scope: product/API changes; new dependencies or toolchains; changing upstream script behavior or Superskill's staging design in this task; new vendor/sync/resolver abstractions; adding `spur-check-feature` merely to remove the override; live feature status changes; full model-driven task/wrapup runs; publishing, shared host-file copying or global reinstall without the applicable authorization.

### Acceptance Criteria

- [ ] AC1 — The installed consumer resolver identifies its installed root before deletion (req: R1)
  Given the current consumer tree has no source-repo marker and contains the vendored directory, when the actual resolved script-root entrypoint runs once, then the artifact records installed mode, the same source/directory as Superskill and a digest, and stderr contains exactly one ignored-vendor warning. Evidence: `scripts/verify-sp-install.ts` command replay and saved root artifact.
- [ ] AC2 — Transitive installation incompatibility blocks migration before any deletion (req: R2)
  Given the staged entrypoint set, when the actual installed inline fingerprint runs under Bun, then it emits a valid digest and exits 0 before migration can proceed; an incompatible/missing library produces a nonzero preflight and leaves workflow/vendor files unchanged. Evidence: real command outcome and before/after Git diff; no mocked library or resolver.
- [ ] AC3 — Local feature verification retains its command and uses the pinned installed verifier (req: R3)
  Given the migrated local definition, when its action list executes in the isolated fixture, then it bootstraps one root, invokes that root's verifier with Bun, records a bound PASS receipt and reaches done; an unresolved root or absent verifier reaches failed and cannot satisfy the PASS guard. The production definition still configures `bun run spur-check`. Evidence: validated definition, actual workflow run/trace, receipt and negative replay in `scripts/verify-sp-install.ts`.
- [ ] AC4 — The complete vendored tree is removed without weakening kk rules (req: R4, R5)
  Given a passing installation preflight and reconciled inventory, when cleanup is applied, then no tracked file or disk directory remains under `plugins/sp/`, no tracked operational caller/comment names `plugins/sp/(scripts|lib)`, both rule files keep their prior semantic configuration, and the stale context recipe is explicitly superseded. Evidence: Git/path scan, parsed rule comparison and context inspection in the E2E artifact.
- [ ] AC5 — Installed startup and feature-verification replays produce repeatable evidence (req: R6)
  Given the cleaned consumer tree and working installed runtime, when `bun scripts/verify-sp-install.ts` runs, then actual task/wrapup startup resolution and inline setup succeed without vendor warnings, the isolated feature workflow records PASS, failure replays remain fail-closed, and `.spur/run/0175-verification/summary.json` identifies every run and artifact. No full task/wrapup completion is inferred from startup replays.
- [ ] AC6 — The final migration passes project and harness gates (req: R7)
  Given the final intended diff, when lint, tests, build, project pre/post rule presets, workflow validation and task implementation verification run, then all required checks pass and the harness records their actual evidence; upstream/environmental failures cannot be silently waived.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-02T18:32:37.078Z

- **CLOSED — this session refines the task; implementation is the next step.** No vendor deletion, operational workflow edit or install-target mutation is part of this refinement.
- **CLOSED — retain the local override.** The repository owns `bun run spur-check`, and the feature lifecycle does not supply a replacement verification command. Deleting the definition would select an absent package script; adding an alias solely to delete it adds another coupling.
- **CLOSED — installed-only consumer actions, one pinned root.** Do not preserve the Spur source-repo branch in knowledge-kit and do not resolve a fresh script directory for the second action.
- **CLOSED — Bun for the verifier.** Its transitive generated library is Bun-backed. `.mjs` does not establish Node compatibility. Standalone script-root remains Node-runnable.
- **DEFERRED WITH OWNER — supported transitive-library installation repair.** Owner: Spur plugin distribution / Superskill shared-script staging. Evidence and owning source seams are in Background/References. The current install cannot pass inline fingerprint. R2 is a hard execution precondition; the implementer may prepare the E2E check but must not start workflow/deletion mutations or improvise a copying mechanism. Revisit after the owner ships a coherent supported installation; no version floor beyond observed runtime compatibility is invented.
- **CLOSED — rules stay.** Only the stale examples change; their kk protections remain necessary.
- **CLOSED — verification is bounded and isolated.** Startup replays cover script resolution and library loading; a real fixture feature workflow covers receipt/guard behavior. Full unrelated model pipelines and live feature transitions are outside this cleanup's acceptance.
- **CLOSED — no cross-project WBS in local dependencies.** `spur-new/0960` is already done and is an external contract, not knowledge-kit WBS 0960. The outstanding install precondition has a named upstream owner; do not encode an unrelated local numeric dependency. Missing `feature_id` remains the existing advisory rather than inventing an ownership feature.

### Design

**WHAT / WHY.** Remove the unversioned downstream copy and its sole remaining execution bypass. Reuse Superskill's locator and Spur's script-root identity; keep the repository's existing verification command and fail-closed workflow contract. **No new product API, dependency, installer, resolver or source-repo marker.** Runtime compatibility is checked before the destructive portion of the migration.

**Frozen file targets.** Edit `.spur/workflows/feature-verification.yaml` only at `states[id=verify].onEnter`; edit comments only in the two R5 rule files; delete `plugins/sp/`; add `scripts/verify-sp-install.ts`; retain/update the dated correction in tracked `.spur/context/learnings.md`. That context correction was already appended during refinement; do not duplicate it during implementation. Task sections receive implementation evidence through Spur. No product/numbered-doc surface changes are required; ADR-018 remains authoritative and historical upstream examples remain valid.

**Workflow algorithm (R3).** Preserve all existing vars, state IDs, transitions, guards, failure declarations and descriptions except any inaccurate action explanation. The two shell actions are:

1. Resolve `script-root.mjs` through `superskill script path sp script-root.mjs`, quote/check the returned file, and run it under Node with `--run-id "$__runId" --spur-bin "$spurBin"`. On locator/script failure, emit a named install diagnostic; end with `exit 0` so the verifier/guard fails closed.
2. Initialize `S=`. Read only `.spur/run/$__runId-script-root.json` with jq; accept `mode == "installed"`, a nonempty string `dir` and an existing `$dir/feature-verification-steps.mjs`. Run `bun "$S" verify --feature-id "$featureId" --run-id "$__runId" --spur-bin "$spurBin"`. Any bad artifact, absent script or nonzero verifier result writes a non-PASS line to `.spur/run/$__runId-feature-verification.status` after ensuring `.spur/run` exists. End `exit 0`; the unchanged PASS guard selects done only on actual PASS, otherwise the existing failed-check transition wins.

Do not `eval` a constructed command, re-probe Superskill for the verifier, accept `source-repo`/`unresolved`, use `--cmd` to disguise the selected definition's command, or replace a real receipt with a coarse status file. A successful script-root artifact establishes directory identity, not transitive-library validity or workflow completion. R2 checks the actual fingerprint capability before mutation, and R6 checks the actual verifier's library/receipt path.

**Installation boundary (R2).** Current global paths and stamps are observations, not hardcoded implementation paths. Resolve them afresh. `superskill install sp --marketplace gobing-ai/spur` is the supported installation surface; `--no-global --targets codex` selects project scope when an actual reinstall is separately authorized. Neither form currently proves/stages the needed sibling library. Do not retry the unchanged installer expecting it to repair the confirmed defect. Resume only once the owning distribution/staging fix makes the native preflight pass; never recreate `plugins/sp`, copy host libraries or point at the developer's Spur checkout.

**Repeatable verification (R6).** Use Bun and existing APIs/CLI tools only. The sole internal flag is `--preflight`; omission selects the final migration checks. Write the failure checks first. Keep fixtures beneath `.spur/run/0175-verification/`, with their own Git repository and `.gitignore` excluding `.spur/`; receipt proof capture must never stage the parent repository. Allocate fresh run IDs. Create fixture features through `spur feature create`, not direct corpus writes. Load the selected task/wrapup definitions from `spur workflow list --json`/their resolved shared paths, replay only their actual startup resolution actions and invoke the real installed inline setup/close. Do not dispatch `agent.run`, model stages, publishing, branch cleanup or live feature transitions. Copy the migrated feature definition into the fixture and configure its own `verificationCmd: "bun --version"`; run that actual workflow through the installed CLI and inspect its bound receipt and terminal status. This narrow fixture verifies integration, not the production project's entire gate. Preserve negative replay results and the artifact summary. Do not mock Superskill or the library in the positive installed-runtime path.

**Tracked-reference scope (R4/R5).** Scan tracked `.spur/workflows`, `.spur/rules`, `scripts`, `apps`, `packages`, `plugins/kk`, root manifests and active configuration using `git ls-files` plus rg. Search the literal `plugins/sp/(scripts|lib)` and any surviving `feature-dev-precheck` caller. Ignore historical task/plan/ADR references and ignored build/run output; inspect/supersede stale machine context separately. Keep rule semantic values byte-equivalent after comment removal. If inventory or a caller changes, inspect it before expanding deletion.

**Dependencies/concurrency.** Upstream 0960 is done; this task consumes its released resolver contract and leaves its source-repo dogfood behavior to Spur. The transitive install defect is an explicit external execution precondition owned upstream, not a local product change. At refinement, `git worktree list` showed only this main worktree, `spur task list --status wip --json` was empty, and Git was clean. Recheck before implementation; preserve any new concurrent work. Limit the fixture probe to one successful feature pass and two failure replays per attempt; save artifacts before stopping on an upstream blocker. No required product diff is invented while preflight fails.

### Plan

- [ ] 0. Recheck Git/worktrees, current `plugins/sp/` inventory and active callers. Write `scripts/verify-sp-install.ts` failure checks first and run it with `--preflight`. Capture versions/stamps, run installed script-root before deletion, verify script stamps, and execute the actual staged fingerprint under Bun. **Current outcome: R2 FAIL. Stop workflow/deletion changes until the upstream owner repairs supported transitive-library installation; retain the failing evidence.** (R1, R2, R6)
- [ ] 1. After the preflight genuinely passes, implement exactly the two installed-only actions in Design, preserving `bun run spur-check` and all workflow guards/terminal semantics. Run `spur workflow validate .spur/workflows/feature-verification.yaml --json`; exercise the fixture success and two fail-closed paths. (R3, R6)
- [ ] 2. Reconcile the 41-file baseline against concurrent changes, delete tracked `plugins/sp/`, and remove its empty disk directory without removing unrelated paths. Update only the two rule comment examples. Retain/update the dated superseding context entry added during refinement so another session cannot follow the old vendoring recipe. (R4, R5)
- [ ] 3. Run `bun scripts/verify-sp-install.ts` after cleanup. Check actual installed task/wrapup startup resolution, inline setup, the real isolated feature PASS receipt, no ignored-vendor warning, complete deletion, unchanged rule semantics and clean operational reference scan. Save `.spur/run/0175-verification/summary.json` and its linked traces/receipts; keep failed evidence and exit nonzero on failure. (R1–R6)
- [ ] 4. Run `bun run lint`, `bun run test`, `bun run build`, `spur rule run --preset recommended-pre-check --fail-on warning --json`, `spur rule run --preset recommended-post-check --fail-on warning --json`, and final workflow validation. Review the intended diff; leave runtime/install/fixture failures explicit. (R7)
- [ ] 5. Author Solution/Review through their harness owners, verify every R/AC with the saved executable evidence, and use `spur task record` for Testing. Complete task lifecycle gates only after a real implementation PASS. No done override, hook bypass or forced feature closure. (R7)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Upstream dependency (completed): `/Users/robin/xprojects/spur-new/docs/tasks5/0960_make-pipeline-script-resolution-revision-safe-across-the-pro.md`; `spur task show 0960 --json` in that project reports done and its recorded verify PASS. Later shipped root-pinning behavior is in the current release, not merely the original task proposal.
- Immutable released workflow: https://raw.githubusercontent.com/gobing-ai/spur/%40gobing-ai%2Fspur-v0.3.97/config/workflows/feature-verification.yaml (run-start root and pinned verifier at lines 58/62).
- Installed release evidence: `/Users/robin/node_modules/@gobing-ai/spur/package.json:3`; installed `config/workflows/{task-pipeline,wrapup-pipeline,feature-verification}.yaml`; staged descriptors from `superskill script path sp <rel> --json`, reporting 0.3.97/global on 2026-10-02.
- Current local bypass/required command/failure reason: `.spur/workflows/feature-verification.yaml:42`, `.spur/workflows/feature-verification.yaml:56`, `.spur/workflows/feature-verification.yaml:77`; `package.json:33` declares `spur-check`, with no `spur-check-feature` alias.
- Upstream install-repair owner/evidence: `/Users/robin/xprojects/superskill/packages/core/src/mapper.ts:290` copies `scripts/`; `/Users/robin/xprojects/superskill/apps/cli/src/commands/install.ts:1930` stages only that subtree and stamps it. The transitive `../lib` import is visible in `/Users/robin/.agents/scripts/sp/inline-run-setup.mjs:50` and `/Users/robin/.agents/scripts/sp/feature-verification-steps.mjs:30`. These are diagnostic references, not permission to edit another repository or host install targets.
- Compatibility probes: `bun <resolved inline-run-setup.mjs> --fingerprint --task-file <0175 file> --spur-bin spur` (current staged FAIL; packaged PASS); `node <resolved feature-verification-steps.mjs> verify --feature-id refine0175 --run-id refine-0175-load-probe` (Bun module loader error). Installation dry-run succeeded with `superskill install sp --marketplace gobing-ai/spur --dry-run`; no real reinstall was performed.
- Current root evidence: `.spur/run/refine-0175-20261002-before-script-root.json`; `mode: installed`, `source: global`, `dir: /Users/robin/.agents/scripts/sp`, digest `sha256:b24f0562ae2f3f7a9626463a99a77315212b75ed20c2ad303f64a47f54d64805`.
- Real packaged/Bun fixture PASS: `.spur/run/refine-0175-20261002/clean-fixture/.spur/memory/runs/refine0175-receipt-clean.md`, its `.state.json`, run root artifact, feature receipt and verification log. The first fixture attempt without its own Git root failed proof capture; it is retained as rejected evidence, not a product defect.
- Binding boundary: `docs/00_ADR.md:747` (ADR-018); rules `.spur/rules/boundary/shipped-script-isolation.yaml:18` and `.spur/rules/typescript/output-boundaries.yaml:9` need comment updates only.
- Drift prevention: `.spur/context/learnings.md:136` contains the obsolete copy/override recipe; line 159 contains historical receipt-FK observations. Refinement appended the dated `2026-10-02 — 0175 supersedes the old sp vendoring recipe` correction in that tracked file; retain history and never treat those notes as authorization. Its tracked status was verified with `git ls-files .spur/context` rather than assumed from generic project prose.
- Refinement/check evidence: `.spur/run/refine-0175-20261002/readiness.json` records the actual runtime failures, packaged-runtime success, checklist and check results. `git diff --check` flags a single blank line at EOF emitted by Spur's `MarkdownDocument.replaceSection` trailer (`packages/domain/src/planning/markdown-document.ts:487` upstream); CLI-only corpus writes were preserved rather than bypassed for formatting.
- Refinement concurrency snapshot: knowledge-kit main at `c81118bf`, one worktree, no wip tasks, clean starting Git status. No overlapping implementation was observed.
- Concurrent change observed later: `plugins/generations/image-gen/tests/presets.test.ts` was edited by another session. It is outside 0175 and was preserved; do not include it in this task's diff/evidence ownership.

**Implement-ready checklist (2026-10-02; specification readiness, not execution PASS)**

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | R1–R7 identify observable outcomes, exact file targets and explicit non-goals. |
| design | true | Two installed-only workflow actions, pinned root, Bun verifier, unchanged fail-closed receipt contract and frozen internal verification command. |
| plan | true | Ordered steps 0–5 map to R-items; the failing install precondition precedes workflow/deletion mutations. |
| ac | true | AC1–AC6 use parsed checkbox forms with req bindings and named executable evidence; numbering/altitude are task-local. |
| decisions | true | Override, runner, rule handling and bounded verification choices are closed; the upstream installation repair has a named owner and a concrete resume condition. |
| dependencies | true | External spur-new/0960 is done; no false cross-project numeric dependency was added; the remaining external install precondition is explicit. |
| premises | true | Release/root/locator/stamp/runtime/fingerprint/receipt probes and full tracked caller/inventory checks corrected 11 stale assumptions; concurrency was rechecked. |

**Execution preflight: FAIL.** A todo/spec-ready status does not authorize deletion while the actual staged fingerprint fails. Its upstream repair remains outstanding; there is no implementation verify PASS from this refinement.

### History

- 2026-10-02T18:34:55.347Z backlog → todo (system)
- 2026-10-02 — Refined against Spur 0.3.97 and upstream 0960: 11 corrections, seven specification-readiness checks passed; installed-runtime preflight remains FAIL on the unstaged/stale shared library. No migration implementation or verify PASS was claimed.

