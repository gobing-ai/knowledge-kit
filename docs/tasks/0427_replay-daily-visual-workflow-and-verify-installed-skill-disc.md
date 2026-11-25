---
schema_version: 1
name: Replay daily visual workflow and verify installed skill discovery
status: done
template: feature-impl
created_at: 2026-11-23T01:20:51.117Z
updated_at: "2026-11-25T06:39:50.820Z"
feature_id: L4
priority: P2
tags:
  - daily-news
  - image-gen
estimate_hours: 4

dependencies: ["0424", "0425", "0426"]
done_forced: "false"
done_reason: unforced close
---

## 0427. Replay daily visual workflow and verify installed skill discovery

### Background

L4 R5 proves compatibility and delivery through checkout and installed workflow paths.

**Refine corrections (2026-11-22)**
- The existing DAG replay has a fake executor and a frozen bundle check. Extend that fixture and keep only renderer/transport stubs. A package-shaped directory alone cannot establish shipped skill resolution.
- The current installed CLI bundle may differ from checkout. Pack and extract a temporary candidate from the implementation checkout so evidence is independent of any global install or cron deployment.

Current-tree sources: apps/cli/tests/kk-news-generate.e2e.test.ts:445, scripts/bundle-plugins.ts:29, apps/cli/package.json, apps/cli/src/content-types.ts:153.

### Requirements

- [x] R1. Run the default and opt-in fixture paths through the real workflows and CLI using package-shipped skills. Demonstrate legacy scene/brief, cover fallback, cached-card behavior and zero inline calls by default.
- [x] R2. Capture repeatable fixture inputs and a machine-readable receipt with provider requests, outputs, variant hashes and replay command. Sync feature and surface docs for the shipped changes.

### Acceptance Criteria

- [x] AC1 — Default runs and legacy plans preserve existing behavior

AC1 exercises R1 and R2 against the packed default and opt-in replay receipts.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-23T01:21:30.182Z

**How do we verify the cutover?** Run an offline installed-style workflow replay and record the inputs, outputs and provider-call counts. Compare with a fixture using the previous brief format and cover fallback.

#### Q&A entry — 2026-11-23T02:49:23.182Z

**What counts as packaged evidence?** An extracted tarball and a replay from outside the checkout that resolves the shipped resources and records behavior. Real-provider visual quality and production rollout have separate evidence.

### Design

- Extend `apps/cli/tests/kk-news-generate.e2e.test.ts` and its existing fixture/receipt path for DAG/freeze behavior. Pair it with the tarball/launcher pattern in `apps/cli/tests/package.test.ts` and `apps/cli/tests/content-launch.e2e.test.ts`. Use a fresh temporary package and works directory outside the repo with source paths unavailable to the packaged CLI agent. Assert both loaded SKILL.md paths and the shared reference are in the extracted package. Record resolved paths and verify no vendor dependency.
- Compare a default run, cache replay, and explicit inline run. Assert cover dimensions and frozen Hook when present, outgoing image-gen pins, card order and attachment, zero inline calls when off, and exactly the 0426 approved WeChat variant and figure hashes when on. Record strict compatibility for old inputs. Keep the fake at provider/transport boundaries or assert the corresponding behavior through the real stage tests from 0424–0426. Do not claim visual taste or real account delivery from fake imagery. Do not run a live schedule, upload, install globally or publish during verification.
- Depend on 0424 for skill resolution and cover guidance, 0425 for card mode, and 0426 for inline receipts and variant schema. Do not reimplement their stages. Use `bun run gate` at completion and ensure the final required suite overwrites partial coverage.

### Plan

- [x] Build and pack with the repo's Bun prepack path. Extract to temporary fixtures and check both skills and their reference from an unrelated cwd.
- [x] Extend the existing E2E harness to run the default, cache, and opt-in cases using fixture data and fake providers. Preserve raw inputs, resulting paths, hashes, and call counts in the harness's JSON receipt.
- [x] Check legacy fixture behavior and final target variant/safety hash agreement. Record the reproducible command, sync design/feature notes, and run the full repo quality gate.

### Solution

Verification repair, 2026-11-24:

- `apps/cli/tests/kk-news-generate.e2e.test.ts:325` reuses the fixture with an extracted package root: the kk wrapper executes the shipped dist/index.js, the unrelated cwd has no project kk asset tree, decision/counting resources resolve inside the extracted package, and only installed external dependencies are reused. The package is freshly built through prepack.
- The packaged replay now probes actual CLI skill discovery: news status succeeds with the shipped writer skill and refuses with exit 5 when that skill is temporarily withheld; restoration is unconditional. It still checks both visual skills and their shared reference, default/cache/opt-in workflow wiring and outgoing provider pins. The previous source-import resolver check is removed.
- The replay retains its tarball, stage and agent doubles, and all three scenario output directories under .works/tmp/test-news-generate/0427-replay-*. The stable JSON receipt records entry/tarball hashes, source-to-retained output paths, input stories, provider requests, figures, variant hashes and the repeat command.
- Offline workflow stage fixtures are explicitly declared in the receipt and docs. Real stage semantics are proved separately by apps/cli/tests/kk-workflow-stages.test.ts (34 cover/card/inline checks plus 3 target-specific inline-variant checks) and plugins/kk/tests/daily-cover-normalize.test.ts (5 real normalization/compositor checks). No real-provider taste or account delivery is claimed.
- docs/04_DESIGN.md and docs/design/daily-news-visual-skills.md now describe those boundaries and retained evidence; L4 Notes record the re-audit contract.

Design conformance: packaged CLI isolation, negative skill discovery, scenario retention and real-stage companion proof match the approved design. The final check is goal-equivalent to bun run gate: run bun run build separately, then run the configured bun run spur-check-feature through spur feature verify. Lint verifies formatting instead of applying a repository-wide format write, preserving unrelated concurrent edits; build, typecheck, fast coverage, rules and the entire heavy suite remain required. Fresh verification passed: build; configured feature check with 5802 fast tests, 578 heavy tests, zero failures; enforced coverage and all pre/post rules. L4 strict completion check passed without findings, with all four linked tasks done. Task 0427 was already terminal, so --next is a no-op; no new lifecycle hop is claimed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/kk-news-generate.e2e.test.ts:325` and `apps/cli/tests/kk-news-generate.e2e.test.ts:677` now execute the extracted CLI from a cwd without project kk assets; `apps/cli/tests/kk-news-generate.e2e.test.ts:798` probes actual writer-skill discovery and exit-5 refusal when its shipped file is withheld. Corrected packaged replay: 1 pass, 0 fail, 67 assertions; provider/agent stage fixtures are explicit. Real stage semantics passed separately: `apps/cli/tests/kk-workflow-stages.test.ts:4308` cover pins/fallback, `apps/cli/tests/kk-workflow-stages.test.ts:2448` card cache, `apps/cli/tests/kk-workflow-stages.test.ts:5956` inline requests and `apps/cli/tests/kk-workflow-stages.test.ts:6200` exact WeChat-only variant/hash contracts; `plugins/kk/tests/daily-cover-normalize.test.ts:54` verifies real crop outputs. Focused receipts: knowledge-kit verification `.spur/run/0427-packaged-cli-green.log` line 1, `.spur/run/0427-real-visual-stages.log` line 1, `.spur/run/0427-real-inline-variants.log` line 1, `.spur/run/0427-real-cover-crops.log` line 1. |
| R2 | MET | `apps/cli/tests/kk-news-generate.e2e.test.ts:913` retains the input tarball, fixture stage/agent doubles and three scenario output trees; its JSON receipt captures inputs, provider calls, paths, entry/tarball/figure/variant hashes and replay command. `docs/04_DESIGN.md:2300`, `docs/design/daily-news-visual-skills.md:35` and `docs/features/L4_daily-ai-news-cover-and-illustration-skills.md:91` describe actual package execution and the real-stage companion proof. Verification scratch disclosure (task-owned local files): `.spur/run/0427-approval.status:1-1`, `.spur/run/0427-auto-repairs.json:1-17`, `.spur/run/0427-base.sha:1-1`, `.spur/run/0427-build.log:1-19`, `.spur/run/0427-check-receipt.json:1-39` (LOST: reaped with the run-scoped plane, ADR-131), `.spur/run/0427-diffstat.json:1-1`, `.spur/run/0427-failure-class.decision:1-15`, `.spur/run/0427-feature-command-refused.log:1-7`, `.spur/run/0427-feature-notes.md:1-1`, `.spur/run/0427-feature-receipt.json:1-18`, `.spur/run/0427-feature-verification.log:1-7`, `.spur/run/0427-full-feature.log:1-401`, `.spur/run/0427-gate-mode.txt:1-1`, `.spur/run/0427-gate-visit.txt:1-1`, `.spur/run/0427-gate.log:1-3`, `.spur/run/0427-history.md:1-1`, `.spur/run/0427-light-gate.log:1-62`, `.spur/run/0427-linked-tasks.json:1-121`, `.spur/run/0427-mode.txt:1-1`, `.spur/run/0427-package-boundary-red.log:1-23`, `.spur/run/0427-packaged-cli-green.log:1-10`, `.spur/run/0427-plan.md:1-3`, `.spur/run/0427-priority.txt:1-1`, `.spur/run/0427-real-cover-crops.log:1-13`, `.spur/run/0427-real-inline-variants.log:1-12`, `.spur/run/0427-real-visual-stages-default-timeout.log:1-64`, `.spur/run/0427-real-visual-stages.log:1-43`, `.spur/run/0427-replay-check.json:1-9`, `.spur/run/0427-replay-check.ts:1-33`, `.spur/run/0427-review-focus.txt:1-1`, `.spur/run/0427-review.md:1-24`, `.spur/run/0427-review.status:1-1`, `.spur/run/0427-session-context.md:1-9`, `.spur/run/0427-shippable-check.json:1-12`, `.spur/run/0427-solution.md:1-9`, `.spur/run/0427-task-check.json:1-16`, `.spur/run/0427-taskpath.txt:1-1`, `.spur/run/0427-test-gate.status:1-1`, `.spur/run/0427-typecheck.log:1-1`, `.spur/run/0427-verdict-derive.json:1-72`, `.spur/run/0427-verdict.json:1-72`, `.spur/run/0427-verify-answer.txt:1-37` (LOST: reaped with the run-scoped plane, ADR-131), `.spur/run/0427-verify-baseline.log:1-9`. Persistent replay receipt: knowledge-kit replay `.works/tmp/test-news-generate/0427-packaged-replay-receipt.json` line 1. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Corrected default/cache/inline packaged replay passed, including zero default inline calls, legacy cover fallback, cached card reuse, package-only skill resolution and pinned requests. Real cover/card/inline stages and exact target materialization passed 42 checks; `apps/cli/tests/kk-news-generate.e2e.test.ts:677`, `apps/cli/tests/kk-workflow-stages.test.ts:6200`, `plugins/kk/tests/daily-cover-normalize.test.ts:54`. Fresh build and full configured feature gate passed: 5802 fast + 578 heavy tests, 0 fail, enforced coverage, lint/typecheck and all rules; `.spur/run/0427-full-feature.log:388-400`, `.spur/run/0427-feature-receipt.json:16-18`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0427

**Scope:** tagged implementation commit 739bef06, its task-owned close-out documentation, and this re-audit's fixture/evidence fixes. Unrelated concurrent changes are excluded from review ownership.

**Dimensions:** functional, security, efficiency, correctness, usability, architecture.

**Verdict:** PASS — all four major findings repaired; no unresolved blocking findings.

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 (major) | correctness | The old packaged replay invoked a checkout-backed wrapper. The fixture now executes the extracted dist entry, has no project kk assets, and the actual CLI refuses a withheld shipped writer skill. | `apps/cli/tests/kk-news-generate.e2e.test.ts:325`, `apps/cli/tests/kk-news-generate.e2e.test.ts:798` | FIXED — package-boundary regression reproduced, corrected replay passed |
| 2 | P2 (major) | architecture | Stub-generated cover/cache/figure metadata cannot prove production stage semantics. The evidence now pairs the offline workflow with real cover/card/inline and target-variant checks, and documents the boundary. | `apps/cli/tests/kk-workflow-stages.test.ts:4308`, `apps/cli/tests/kk-workflow-stages.test.ts:6200`, `plugins/kk/tests/daily-cover-normalize.test.ts:54` | FIXED — 34 visual-stage, 3 inline-variant and 5 compositor/normalization checks passed |
| 3 | P2 (major) | usability | The old receipt referenced tarball and output paths deleted by cleanup. The replay now retains the tarball, fixture doubles and three scenario output trees, with hashes and path mappings in its receipt. | `apps/cli/tests/kk-news-generate.e2e.test.ts:913` | FIXED — retained outputs and copied tarball hashes are asserted |
| 4 | P2 (major) | correctness | The previous PASS cited a full gate with a failing test. Fresh build and configured feature verification passed with 5802 fast tests and 578 heavy tests, zero failures, enforced coverage and all pre/post rules. | `.spur/run/0427-full-feature.log:388` | FIXED — full gate PASS; strict L4 completion check has no findings |
| 5 | P4 (advisory) | security | The fixture reuses installed external dependencies and fake provider/agent boundaries. This proves package resource resolution and offline contracts, not a hermetic dependency installation, visual taste or real-account delivery. | `apps/cli/tests/kk-news-generate.e2e.test.ts:691` | ACCEPTED — explicit task/design verification boundary; no live operations |

##### Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Extracted CLI/default/cache/inline replay and actual missing-skill refusal; real stage pin/fallback/cache checks and exact WeChat variant/hash assertions. |
| R2 | MET | Retained package and output trees, machine-readable receipt with inputs/requests/hashes/repeat command, and synchronized surface/design/feature notes. |

Architecture review: one optional package-root argument reuses the existing fixture; legacy fixture callers keep their original path. Product CLI/workflow contracts and dependencies are unchanged. Build and all fast/heavy checks remain required; formatting is verified by lint to preserve unrelated concurrent edits.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-25T02:57:05.321Z todo → wip (system)
- 2026-11-25T03:04:09.235Z wip → testing (system)
- 2026-11-25T03:04:10.198Z testing → done (system)

- 2026-11-25T05:05:26.391Z — forced inline re-audit repaired package execution isolation and retained replay evidence; build and the full feature gate passed (5802 fast + 578 heavy tests, 0 fail); L4 strict shippable check passed. Already done: --next is a terminal no-op. No production/global installation or publishing.

