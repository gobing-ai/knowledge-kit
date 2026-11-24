---
schema_version: 1
name: Replay daily visual workflow and verify installed skill discovery
status: todo
template: feature-impl
created_at: 2026-11-23T01:20:51.117Z
updated_at: "2026-11-23T02:49:23.183Z"
feature_id: L4
priority: P2
tags:
  - daily-news
  - image-gen
estimate_hours: 4

dependencies: ["0424", "0425", "0426"]
---

## 0427. Replay daily visual workflow and verify installed skill discovery

### Background

L4 R5 proves compatibility and delivery through checkout and installed workflow paths.

**Refine corrections (2026-11-22)**
- The existing DAG replay has a fake executor and a frozen bundle check. Extend that fixture and keep only renderer/transport stubs. A package-shaped directory alone cannot establish shipped skill resolution.
- The current installed CLI bundle may differ from checkout. Pack and extract a temporary candidate from the implementation checkout so evidence is independent of any global install or cron deployment.

Current-tree sources: apps/cli/tests/kk-news-generate.e2e.test.ts:445, scripts/bundle-plugins.ts:29, apps/cli/package.json, apps/cli/src/content-types.ts:153.

### Requirements

- [ ] R1. Run the default and opt-in fixture paths through the real workflows and CLI using package-shipped skills. Demonstrate legacy scene/brief, cover fallback, cached-card behavior and zero inline calls by default.
- [ ] R2. Capture repeatable fixture inputs and a machine-readable receipt with provider requests, outputs, variant hashes and replay command. Sync feature and surface docs for the shipped changes.

### Acceptance Criteria

- [ ] AC1 — Default runs and legacy plans preserve existing behavior

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

- [ ] Build and pack with the repo's Bun prepack path. Extract to temporary fixtures and check both skills and their reference from an unrelated cwd.
- [ ] Extend the existing E2E harness to run the default, cache, and opt-in cases using fixture data and fake providers. Preserve raw inputs, resulting paths, hashes, and call counts in the harness's JSON receipt.
- [ ] Check legacy fixture behavior and final target variant/safety hash agreement. Record the reproducible command, sync design/feature notes, and run the full repo quality gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
