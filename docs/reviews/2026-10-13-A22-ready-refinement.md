# A22 ready-depth refinement

Date: 2026-10-13. Command: `/sp-dev-refineall --feature A22 --auto --agent inline --depth ready`.

**Batch verdict: clean.** Four tasks refined in frozen dependency order; 25 correction records. All seven implement-ready checklist items pass per task. No task execution or production source changes.

| Task | Outcome | Corrections | Status | Failed checklist IDs | Dependencies |
| --- | --- | --- | --- | --- | --- |
| [0275](../tasks/0275_normalize-kk-stage-and-lock-commands-with-compatible-aliases.md) | refined | 6 | todo → todo | None | None |
| [0276](../tasks/0276_implement-named-bot-list-login-logout-and-open-lifecycle.md) | refined | 8 | todo → todo | None | None |
| [0277](../tasks/0277_integrate-bot-sessions-with-existing-browser-channel-routine.md) | refined | 7 | todo → todo | None | 0276 |
| [0278](../tasks/0278_review-and-migrate-compatible-cli-and-browser-session-caller.md) | refined | 4 | todo → todo | None | 0275, 0276, 0277 |

## Main corrections

- Reserve canonical stage run from the verified current dispatcher, normalize legacy argv in main, and keep visible groups action-free.
- Separate generic lifecycle acceptance into feature R9; channel integration owns full R4/R6. R1–R8 titles remain unchanged.
- Freeze safe transaction/promotion recovery, parent/child lease ownership, scoped child env, output/error contracts and a narrow filesystem-boundary adapter.
- Make descriptor homeUrl optional for publication-scoped Substack; preserve known canonical editor navigation such as Juejin v=2 without saving supplied authentication queries.
- Correct transport assumptions: podcast-pub uses microfeed API; X post is API and X article is browser; no Xiaoyuzhou browser publisher exists. Generic URL login remains available.
- Declare Playwright as an external CLI runtime dependency and ts-runtime as a direct harness IO dependency; require isolated package and real local-HTTP Chromium smoke evidence.
- Keep long-lived publish contexts, custom profile paths and historical evidence out of compulsory CLI migration.

## Checklist evidence

### 0275

| Check | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | 5 observable numbered outcomes; explicit non-goals, current owner seams and exit/data behavior. |
| design | PASS | Frozen names, primary files, algorithms, dependency handoff and rejected alternatives in task Design and A22 satellite. |
| plan | PASS | 5 ordered steps map to requirements and name test layers/files, package smoke and documentation obligations. |
| ac | PASS | Gherkin task scenarios carry (req: ...) bindings; ac_numbering=task-local; feature titles preserved and deterministic as-todo check passes. |
| decisions | PASS | Dated Q&A closes parser, metadata/ownership, publication and migration scope choices; ADR-037/038 links retained. |
| dependencies | PASS | Frozen edges []; upstream outputs and downstream ownership stated; no out-of-set dependency. |
| premises | PASS | Current code read: apps/cli/src/main.ts:28; apps/cli/src/commands/stage.ts:9; apps/cli/src/commands/store.ts:1605; apps/cli/src/cli.ts:19; apps/cli/tests/main.test.ts:52; apps/cli/tests/commands/store.test.ts:38. Bun/Playwright/browser-automation versions and lockfile verified; worktree overlap and baseline limitations recorded. |

Planning digest: 616690f8dcfb163a81855f6c59e72e04fc4d87791a5dbed786cd945925193949.

### 0276

| Check | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | 8 observable numbered outcomes; explicit non-goals, current owner seams and exit/data behavior. |
| design | PASS | Frozen names, primary files, algorithms, dependency handoff and rejected alternatives in task Design and A22 satellite. |
| plan | PASS | 7 ordered steps map to requirements and name test layers/files, package smoke and documentation obligations. |
| ac | PASS | Gherkin task scenarios carry (req: ...) bindings; ac_numbering=task-local; feature titles preserved and deterministic as-todo check passes. |
| decisions | PASS | Dated Q&A closes parser, metadata/ownership, publication and migration scope choices; ADR-037/038 links retained. |
| dependencies | PASS | Frozen edges []; upstream outputs and downstream ownership stated; no out-of-set dependency. |
| premises | PASS | Current code read: packages/publish-harness/src/browser.ts:111; packages/publish-harness/src/browser.ts:239; packages/publish-harness/src/profile-dir.ts:12; packages/publish-harness/src/index.ts:231; apps/cli/package.json:48; packages/publish-harness/package.json:19; .spur/rules/strict/runtime-boundaries.yaml:162. Bun/Playwright/browser-automation versions and lockfile verified; worktree overlap and baseline limitations recorded. |

Planning digest: 7414ccacf65de217734d8f25299ef5af9b03c7ffa03f40a0b822b2a634922f9e.

### 0277

| Check | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | 6 observable numbered outcomes; explicit non-goals, current owner seams and exit/data behavior. |
| design | PASS | Frozen names, primary files, algorithms, dependency handoff and rejected alternatives in task Design and A22 satellite. |
| plan | PASS | 6 ordered steps map to requirements and name test layers/files, package smoke and documentation obligations. |
| ac | PASS | Gherkin task scenarios carry (req: ...) bindings; ac_numbering=task-local; feature titles preserved and deterministic as-todo check passes. |
| decisions | PASS | Dated Q&A closes parser, metadata/ownership, publication and migration scope choices; ADR-037/038 links retained. |
| dependencies | PASS | Frozen edges ["0276"]; upstream outputs and downstream ownership stated; no out-of-set dependency. |
| premises | PASS | Current code read: packages/kk-core/src/manifest.ts:27; packages/kk-core/src/registry.ts:16; apps/cli/src/invoke.ts:151; plugins/publishings/substack-pub/src/profile-check.ts:66; plugins/publishings/substack-pub/src/index.ts:127; plugins/publishings/wechatmp-pub/src/index.ts:73; plugins/publishings/xhs-pub/src/profile-check.ts:57; plugins/publishings/podcast-pub/src/index.ts:58; scripts/bundle-plugins.ts:103. Bun/Playwright/browser-automation versions and lockfile verified; worktree overlap and baseline limitations recorded. |

Planning digest: 307279a9d6c3fb2a348fe0d3012600eab8419198e903930572c32aa9915a2397.

### 0278

| Check | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | 5 observable numbered outcomes; explicit non-goals, current owner seams and exit/data behavior. |
| design | PASS | Frozen names, primary files, algorithms, dependency handoff and rejected alternatives in task Design and A22 satellite. |
| plan | PASS | 5 ordered steps map to requirements and name test layers/files, package smoke and documentation obligations. |
| ac | PASS | Gherkin task scenarios carry (req: ...) bindings; ac_numbering=task-local; feature titles preserved and deterministic as-todo check passes. |
| decisions | PASS | Dated Q&A closes parser, metadata/ownership, publication and migration scope choices; ADR-037/038 links retained. |
| dependencies | PASS | Frozen edges ["0275","0276","0277"]; upstream outputs and downstream ownership stated; no out-of-set dependency. |
| premises | PASS | Current code read: apps/cli/src/stage.ts:13; plugins/kk/workflows/kk-collect.yaml:79; plugins/publishings/wechatmp-pub/src/index.ts:73; plugins/publishings/podcast-pub/src/index.ts:58; AGENTS.md:26. Bun/Playwright/browser-automation versions and lockfile verified; worktree overlap and baseline limitations recorded. |

Planning digest: debce1ae0dec3ecbb1df6117b28f0435acb7e4c30cda7372c9f87c1515f2986b.

## Readiness and validation

`spur task check <wbs> --as todo --json` passes for 0275–0278. The 0277/0278 prerequisite-not-done warnings are execution ordering constraints, not missing specification. Only 0275/0276 can execute immediately; 0277 follows 0276 and 0278 follows all implementation tasks. Feature check passes with nine linked-but-unverified scenario warnings expected before implementation.

The strict feature kickoff check was classified through Spur: only expected scenario-unverified findings, no aborting findings. Frozen membership contains exactly 0275–0278; no exclusions or out-of-set dependencies. No L3-only SKIP was used.

Pinned environment was checked: Bun 1.4.3, Playwright 1.55.0, ts-browser-automation 0.5.24. The separate earlier channel worktree and unrelated probe files are noted in each task. Current main-tree WIP query returned no tasks.

Repository source tests/build/live authentication were not run for this specification-only refinement. Existing unrelated WeChat probe formatting/import failures remain a recorded lint baseline limitation; their files were not changed. Production validation belongs to the implementation tasks.

Spur recommended-pre-check: exit 0, 59 evaluated rules, no findings. Git diff whitespace check: PASS.

Design: [canonical surface and session contracts](../design/kk-noun-verb-bots.md).

## Next command

`/sp-dev-runall --feature A22 --auto --agent inline`
