---
schema_version: 1
name: kk news status reports bundle null for a news run whose bundle sits at the run root
status: done
template: issue
created_at: 2026-11-24T22:43:08.788Z
updated_at: "2026-11-25T17:20:39.354Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0435. kk news status reports bundle null for a news run whose bundle sits at the run root

### Background

During the 2026-11-24 dogfood `kk news status --work-dir .works/kk-news-generate/20261124` reported
`"bundle": null` for a run whose bundle was frozen and had already published from it:

```
{"workDir":"…/20261124","type":"news","generate":{"status":"no-content",…},"bundle":null,
 "windows":{"after-generate":{"status":"partial","published":1,"targets":6}}, …}
```

`apps/cli/src/commands/content.ts` reads the summary from a hard-coded path
`join(workDir, '4-publish', 'bundle.json')`, while `resolveBundlePath`
(`apps/cli/src/publish-matrix.ts`) prefers the run root because
`generate-bundle --stage freeze` writes a news bundle there (0382) and resolves every variant path
relative to that directory. The two disagree, so the status surface says a run has no bundle exactly
when the news freeze wrote one — an operator reading status to decide whether anything shipped is told
"nothing".

The same read therefore also cannot show `frozen`, `runId` or `variants` for a news run.

### Requirements

- [x] R1. `kk news status` must read the bundle through `resolveBundlePath` (run root first, `4-publish/` fallback) instead of the hard-coded `4-publish/bundle.json`.
- [x] R2. A news run whose root bundle is frozen must report `bundle.frozen`, `bundle.runId` and its variant count in `status`.
- [x] R3. An article run (bundle under `4-publish/`) keeps reporting exactly what it reports today.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a frozen news bundle is visible in status (req: R1, R2)
Given a run dir with a frozen `bundle.json` at its root and no `4-publish/bundle.json`
When `kk news status --work-dir <dir>` runs
Then `bundle.runId` is the frozen run id and `bundle.variants` is non-null

Scenario: AC2 — the article layout is unchanged (req: R3)
Given a run dir whose bundle lives at `4-publish/bundle.json`
Then status reports the same summary as before this change
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

One bundle-location rule for the status surface: read through `resolveBundlePath` (run root first,
`4-publish/` fallback) instead of the hard-coded `4-publish/bundle.json`. `resolveBundlePath` is
reused, not re-implemented, so status cannot drift from what the freeze wrote and what publish
plans from (0382). A bundle resolved at the run root is frozen by construction — only the news
freeze writes one there — so the root shape reports `frozen: true` plus an additive
`variantCount`; the `4-publish/` article shape keeps its exact pre-0435 summary
(`frozen`/`runId`/`variants`, no additions), which is R3's no-change contract.

| File | Lines | What / why |
| --- | --- | --- |
| `apps/cli/src/commands/content.ts` | 16 | Import `resolveBundlePath` from `../publish-matrix` — one precedence rule for every bundle reader (R1). |
| `apps/cli/src/commands/content.ts` | 364–369 | `variantCount(variants)` helper: object → key count, array → length, anything else → null (R2 "variant count"). |
| `apps/cli/src/commands/content.ts` | 387–405 | `statusPayload` reads the bundle at `resolveBundlePath(fs, workDir)`; `atRunRoot` marks the news freeze layout, whose summary reports `frozen: true` (unless the file states it) and the additive `variantCount`. The `4-publish/` branch is byte-identical to before (R1, R2, R3). |
| `apps/cli/tests/content-status-bundle-0435.test.ts` | 1–127 | AC1: frozen root bundle is reported (`frozen`, `runId`, non-null `variants`, `variantCount: 2`), and the root wins over a leftover `4-publish` copy. AC2: article layout reports exactly the pre-change summary (`frozen`/`runId`/`variants` only), including `frozen: null` when the file carries no boolean. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — status reads the bundle through `resolveBundlePath`, not a hard-coded `4-publish/bundle.json` | MET | `apps/cli/src/commands/content.ts:394` (`resolveBundlePath`, imported at `:16`); no hard-coded bundle read remains in the file (only the `4-publish` dir for window outcomes, `:407`); tests `apps/cli/tests/content-status-bundle-0435.test.ts:76-101` |
| R2 — a frozen root bundle reports `bundle.frozen`, `bundle.runId` and its variant count | MET | `apps/cli/src/commands/content.ts:396-405`; `variantCount` helper `:365-369`; tests `content-status-bundle-0435.test.ts:76-89` assert `frozen: true`, `runId: '20261124-gen-1'`, non-null `variants`, `variantCount: 2` |
| R3 — an article run (bundle under `4-publish/`) reports exactly what it reported today | MET | `apps/cli/src/commands/content.ts:401-404` (non-root branch byte-identical to base); tests `content-status-bundle-0435.test.ts:103-126`; regression suite `apps/cli/tests/content-status-progress.test.ts` (6 tests) and `apps/cli/tests/content-nouns.e2e.test.ts` (4 tests) pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a frozen news bundle at the run root is visible in status (`bundle.runId` frozen run id, `bundle.variants` non-null) | MET | test | `apps/cli/tests/content-status-bundle-0435.test.ts:76-89` (root layout) and `:91-101` (root wins over a leftover `4-publish` copy); `NODE_ENV=test bun test apps/cli/tests/content-status-bundle-0435.test.ts` → 4 pass / 0 fail; same test at base 9b45f160 → 2 fail (negative control) |
| AC2 — the article layout is unchanged | MET | test | `apps/cli/tests/content-status-bundle-0435.test.ts:103-126` (`toEqual` pins the exact pre-change summary, including `frozen: null`); `NODE_ENV=test bun test apps/cli/tests/content-status-progress.test.ts apps/cli/tests/content-nouns.e2e.test.ts` → 10 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0435

**Scope:** `apps/cli/src/commands/content.ts` working-tree diff + new `apps/cli/tests/content-status-bundle-0435.test.ts` (branch `sp/runall-feature-l3-4e48`, base 9b45f160)
**Dimensions:** functional, correctness, security, efficiency, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | `frozen: true` is derived from the resolved path (run root) instead of the bundle's own freeze mark (`contentType`). Every reachable root producer is the freeze itself — `publish-matrix-bundle` writes `join(workDir, 'bundle.json')` and prints "bundle frozen: N variant(s)", and the board already labels that same root artifact "Frozen bundle" produced by node `freeze` — so no reachable non-frozen root bundle exists. The label is still layout-derived: a legacy pre-cut-over root bundle, or a root bundle read in the window between the freeze's write and `stampContentType`, reports `frozen: true` without carrying the mark. Implemented as the task's documented tradeoff; the new test pins the contract. | `apps/cli/src/commands/content.ts:401` (`publish-matrix.ts:2582,2597`, `board/manifest.ts:605-610`, `content-generate.ts:412-417`) | ACCEPTED |
| 2 | P4 (advisory) | usability | The article layout keeps reporting `frozen: null` even though its `4-publish/bundle.json` *is* a freeze output, so the same word reads `true` for news and `null` for article. R3 explicitly forbids changing the article shape, so this is a stated tradeoff rather than a defect — a follow-up could stamp `contentType`-based `frozen` on both layouts behind a new AC. | `apps/cli/src/commands/content.ts:401-404` (`content-generate-article.ts:508`) | ACCEPTED |
| 3 | P4 (advisory) | architecture | `atRunRoot` re-derives `resolveBundlePath`'s branch decision by string equality (`bundlePath === join(workDir, 'bundle.json')`) instead of the helper returning which branch it took. Correct today (both sides build the path with `join(workDir, …)`), but R2's `frozen`/`variantCount` silently depend on publish-matrix's path spelling — a file tasks 0431/0432 are editing concurrently. The AC1 test is the guard: it fails if the spelling ever drifts. | `apps/cli/src/commands/content.ts:396` | ACCEPTED |
| 4 | P4 (advisory) | architecture | `resolveBundlePath`'s doc comment states the opposite of its own body and of what 0435 now relies on: it calls `4-publish/bundle.json` "where a run directory's frozen bundle lives … with the root-level `bundle.json` of a pre-cut-over run directory as the fallback" and "a directory with both files keeps using the frozen one", while the code prefers the root. Stale pre-0382 wording, outside 0435's diff; worth a one-line fix so the precedence rule 0435 points at is documented truthfully. | `apps/cli/src/publish-matrix.ts:154-162` (body at `:163-172`) | ACCEPTED |
| 5 | P4 (advisory) | test | `variantCount`'s `null` branch (missing/oddly-shaped `variants`) and its legacy array branch have no 0435 test; line 368 is the only new line left uncovered by the apps/cli fast tier (file coverage 95.45% function / 98.97% line, uncovered 295, 306, 368, 515). Nothing regresses, but the defensive branch is unfenced. | `apps/cli/src/commands/content.ts:365-369`; `apps/cli/tests/content-status-bundle-0435.test.ts:75-126` | ACCEPTED |

##### Hard checks (the five the task named)

| Check | Result | Evidence |
| --- | --- | --- |
| `resolveBundlePath` precedence matches what status reports, including BOTH and NEITHER file present | PASS | Status calls the helper itself (`content.ts:394`), so there is no second precedence rule to drift. BOTH: new test asserts the root `runId` wins over a leftover `4-publish` copy (`content-status-bundle-0435.test.ts:91-101`). NEITHER: the helper returns the non-existent `4-publish/bundle.json`, `readJson` yields null, `bundle` stays null — the pre-existing fresh-run assertion (`content-status-progress.test.ts:61-66`) still passes. |
| `frozen: true` from run-root layout is not a fabrication for a non-frozen bundle | PASS (with advisory #1) | Root `bundle.json` has exactly one writer, the freeze (`publish-matrix.ts:2458-2460, 2582, 2597`); the board maps the same root artifact to producer node `freeze` (`board/manifest.ts:605-610`); `writePoolGate`/`unfreezeRun` delete it when a run is refused or refreshed (`content-generate.ts:438, 1336`). No producer of a non-frozen root bundle exists in `src/`. |
| Additive fields (`variantCount`, `frozen`) break an existing consumer | NO BREAK | `variantCount` is added to the status summary object only, never to `bundle.json` (`BundleSchema` is `.strict()`, `publish-matrix.ts:74-90`); `progressPayload`/`gatePayload` never read the bundle (`status-progress.ts`); the board projects its own artifact copy (`board/manifest.ts:605-610`); 0378's "keeps every pre-existing key" test passes; the whole apps/cli fast tier (107 files, 1384 tests) is green. |
| Article layout literally unchanged (R3) | PASS | The non-root branch keeps the identical `frozen`/`runId`/`variants` expressions with no spread (`content.ts:401-404` vs the pre-change `ec589fd0`); asserted by `toEqual` at `content-status-bundle-0435.test.ts:112-116` and `:124`, and both AC2 tests also pass at base commit 9b45f160 — they are genuine no-change pins, not artefacts of the fix. |
| Test fails with the hard-coded path restored | YES | Detached worktree at 9b45f160 (`git worktree add --detach /tmp/kk-0435-base HEAD`, new test copied in, `node_modules` symlinked): `2 pass / 2 fail` — both AC1 cases fail (`expected … not.toBeNull()`, `expected '20261124-stale' to be '20261124-gen-1'`), both AC2 cases pass. Worktree removed afterwards. |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 — status reads the bundle through `resolveBundlePath`, not a hard-coded `4-publish/bundle.json` | MET | `apps/cli/src/commands/content.ts:394` (`resolveBundlePath`, imported at `:16`); no hard-coded bundle read remains in the file (only the `4-publish` dir for window outcomes, `:407`); tests `apps/cli/tests/content-status-bundle-0435.test.ts:76-101` |
| R2 — a frozen root bundle reports `bundle.frozen`, `bundle.runId` and its variant count | MET | `apps/cli/src/commands/content.ts:396-405`; `variantCount` helper `:365-369`; tests `content-status-bundle-0435.test.ts:76-89` assert `frozen: true`, `runId: '20261124-gen-1'`, non-null `variants`, `variantCount: 2` |
| R3 — an article run (bundle under `4-publish/`) reports exactly what it reported today | MET | `apps/cli/src/commands/content.ts:401-404` (non-root branch byte-identical to base); tests `content-status-bundle-0435.test.ts:103-126`; regression suite `apps/cli/tests/content-status-progress.test.ts` (6 tests) and `apps/cli/tests/content-nouns.e2e.test.ts` (4 tests) pass |

##### Acceptance Criteria

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — a frozen news bundle at the run root is visible in status (`bundle.runId` frozen run id, `bundle.variants` non-null) | MET | test + command | `apps/cli/tests/content-status-bundle-0435.test.ts:76-89` (root layout) and `:91-101` (root wins over a leftover `4-publish` copy); `NODE_ENV=test bun test apps/cli/tests/content-status-bundle-0435.test.ts` → 4 pass / 0 fail; same test at base 9b45f160 → 2 fail (negative control) |
| AC2 — the article layout is unchanged | MET | test + command | `apps/cli/tests/content-status-bundle-0435.test.ts:103-126` (`toEqual` pins the exact pre-change summary, including `frozen: null`); `NODE_ENV=test bun test apps/cli/tests/content-status-progress.test.ts apps/cli/tests/content-nouns.e2e.test.ts` → 10 pass / 0 fail |

##### Cross-task interaction (flagged, not reviewed)

`apps/cli/src/publish-matrix.ts` is simultaneously modified by tasks 0431/0432. Those changes touch `LINK_SOURCES`/`substituteLinkPlaceholders`/settlement `coverPatch` only — `git diff` on that file contains no hunk inside `resolveBundlePath` (`:163-172`), so 0435's dependency on its precedence is stable. `content.ts` imports `resolveBundlePath` at module scope; `publish-matrix.ts` imports nothing from `commands/`, so no cycle is introduced (`apps/cli` typecheck clean).

##### Commands run

`NODE_ENV=test bun test apps/cli/tests/content-status-bundle-0435.test.ts` → 4 pass / 0 fail; `NODE_ENV=test bun test <all 107 fast-tier apps/cli test files>` → 1384 pass / 0 fail, `commands/content.ts` 95.45% func / 98.97% line; `bun test apps/cli/tests/kk-news-generate.e2e.test.ts` → 4 pass; `tsc --noEmit` in `apps/cli` → clean; `biome check` on both changed files → clean.

Verdict: PASS

### References

- Status read: `apps/cli/src/commands/content.ts` (`join(workDir, '4-publish', 'bundle.json')`)
- Bundle resolution: `apps/cli/src/publish-matrix.ts` → `resolveBundlePath` (0382 comment)
- Observed: `.works/kk-news-generate/20261124/bundle.json` exists while `kk news status` printed `"bundle": null`

### History

- 2026-11-25T17:11:17.202Z todo → wip (system)
- 2026-11-25T17:20:37.459Z wip → testing (system)
- 2026-11-25T17:20:39.345Z testing → done (system)

