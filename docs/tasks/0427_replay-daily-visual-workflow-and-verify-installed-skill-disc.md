---
schema_version: 1
name: Replay daily visual workflow and verify installed skill discovery
status: done
template: feature-impl
created_at: 2026-11-23T01:20:51.117Z
updated_at: "2026-11-25T03:04:10.203Z"
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

- [ ] Build and pack with the repo's Bun prepack path. Extract to temporary fixtures and check both skills and their reference from an unrelated cwd.
- [ ] Extend the existing E2E harness to run the default, cache, and opt-in cases using fixture data and fake providers. Preserve raw inputs, resulting paths, hashes, and call counts in the harness's JSON receipt.
- [ ] Check legacy fixture behavior and final target variant/safety hash agreement. Record the reproducible command, sync design/feature notes, and run the full repo quality gate.

### Solution

| File | Lines | What / Why |
| --- | --- | --- |
| `apps/cli/tests/kk-news-generate.e2e.test.ts` | L24-L40, L69-L315, L662-L930 | Added packaged replay suite (`0427`): packs `@gobing-ai/knowledge-kit` via `bun pm pack`, extracts to an isolated temp directory outside the repo, verifies installed discovery of `daily-news-cover/SKILL.md`, `daily-news-illustrations/SKILL.md`, and `news-editorial/references/daily-visual-composition.md` with zero `vendors/` dependency, replays default (`inline_illustrations=false`, legacy cover fallback, 0 inline calls), cache-replay (pre-seeded `card-1.png` skipped, legacy cover brief honored), and inline opt-in (`inline_illustrations=true`, 2 inline figures materialized only in WeChat `article` variant with verified SHA-256 hashes), and writes `.works/tmp/test-news-generate/0427-packaged-replay-receipt.json`. |
| `docs/04_DESIGN.md` | L2299 | Synced L4 surface table with the `0427` packaged replay and installed skill discovery verification contract. |
| `docs/features/L4_daily-ai-news-cover-and-illustration-skills.md` | L80-L87 | Refreshed feature `L4` task roster via `spur feature refresh --feature L4`. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/kk-news-generate.e2e.test.ts:662-930` packs `@gobing-ai/knowledge-kit` via `bun pm pack`, extracts it outside the repo, verifies installed discovery of `daily-news-cover/SKILL.md`, `daily-news-illustrations/SKILL.md`, and `news-editorial/references/daily-visual-composition.md` (`insideExtractedPackage: true`, `vendorDependencyFree: true`), and replays default (`inline_illustrations=false`, `inlineCallCount: 0`, cover fallback `1344x576`/`1200x630`), cache-replay (cached `card-1.png` skipped, legacy cover brief honored), and inline opt-in (`inline_illustrations=true`, 2 figures materialized only in WeChat `article` variant). |
| R2 | MET | `apps/cli/tests/kk-news-generate.e2e.test.ts:865-928` writes `.works/tmp/test-news-generate/0427-packaged-replay-receipt.json` capturing fixture inputs, resolved skill paths/hashes, provider requests/call counts, cover receipts, figure/variant SHA-256 hashes, safety status, and exact replay command; `docs/04_DESIGN.md:2299` and `docs/features/L4_daily-ai-news-cover-and-illustration-skills.md` synced. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/kk-news-generate.e2e.test.ts:662-930` passed (including `test-changed.ts apps/cli tests/kk-news-generate.e2e.test.ts` PASS + isolated `-t "0427"` PASS); `.works/tmp/test-news-generate/0427-packaged-replay-receipt.json` proves default (`inlineCallCount: 0`, cover fallback), cache replay (`renderedCards: ["card-2"]`, legacy brief), and inline opt-in (`inlineCallCount: 2`, WeChat-only `inlineFigures` SHA-256 match, `safetyStatus: "pass"`); `bun run gate` passed format, build, lint, 60/60 pre-check, 5801/5802 fast tests (the 1 failure `apps/cli/tests/commands/daily.test.ts:80` was a parallel `.works/` snapshot race outside scope and passed 26/26 in isolation), 98.68% fn / 98.40% ln coverage, and 3/3 `recommended-post-check`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

- **Verdict:** PASS (0 P1, 0 P2, 0 P3; 1 P4 advisory note).
- **Traceability:** R1–R2 and AC1 MET via `apps/cli/tests/kk-news-generate.e2e.test.ts:662-930`, `.works/tmp/test-news-generate/0427-packaged-replay-receipt.json`, `docs/04_DESIGN.md:2299`, `docs/features/L4_daily-ai-news-cover-and-illustration-skills.md`, `bun run gate` (format, build, lint, 60/60 pre-check, 5801/5802 fast tests + 26/26 isolated pass on parallel `.works/` flake `daily.test.ts:80`, 98.68% fn / 98.40% ln coverage, 3/3 `recommended-post-check`).
- **Residual risk / P4 note:** `apps/cli/tests/commands/daily.test.ts:80` exhibited a pre-existing parallel `.works/` snapshot race under `--parallel=8` and passed 26/26 in isolation.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-25T02:57:05.321Z todo → wip (system)
- 2026-11-25T03:04:09.235Z wip → testing (system)
- 2026-11-25T03:04:10.198Z testing → done (system)

