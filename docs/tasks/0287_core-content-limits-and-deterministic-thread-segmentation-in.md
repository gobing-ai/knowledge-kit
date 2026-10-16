---
schema_version: 1
name: Core content limits and deterministic thread segmentation in kk-core
status: testing
template: feature-impl
created_at: 2026-10-15T05:43:08.391Z
updated_at: "2026-10-16T05:24:30.649Z"
feature_id: E95

ac_altitude: task-local
ac_numbering: task-local
---

## 0287. Core content limits and deterministic thread segmentation in kk-core

### Background

Captured from the creation title: "Core content limits and deterministic thread segmentation in kk-core".

### Requirements

- [x] R1. Export typed PlatformContentLimits schema and unit counters (utf16, unicode code points, CJK-weighted, Twitter 23-char URL weighting) from `@gobing-ai/kk-core`.
- [x] R2. Implement deterministic, URL-preserving thread segmentation engine in `@gobing-ai/kk-core` strictly enforcing the invariant `segments.join("") === originalText`.
- [x] R3. Deliver unit tests in `packages/kk-core/tests/` covering all failure modes and clearing coverage threshold.

### Acceptance Criteria

- [x] AC1 — R3 - Content limits engine enforces character and URL weighting (req: R1)
- [x] AC2 — R4 - Thread segmentation preserves invariants without data loss (req: R2)

```gherkin
Feature: Core content limits and deterministic thread segmentation in kk-core

  Scenario: AC1 — R3 - Content limits engine enforces character and URL weighting (req: R1)
    Given text content evaluated under PlatformContentLimits
    When calculating limits for X, Threads, or Xiaohongshu
    Then character counts correctly apply Unicode code points, CJK weights, and fixed 23-char URL lengths

  Scenario: AC2 — R4 - Thread segmentation preserves invariants without data loss (req: R2)
    Given an input body exceeding single-post platform limits
    When splitThreadContent decomposes the text into a thread sequence
    Then URLs are never split across post boundaries
    And the concatenated post sequence strictly equals the original input text
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Add `packages/kk-core/src/content-limits.ts` and `packages/kk-core/src/thread-segmentation.ts`, exported from `packages/kk-core/src/index.ts`.
- `content-limits.ts`: Definitive table of platform limits, supporting `utf16_code_units`, `unicode_code_points`, `weighted`, `xiaohongshu_title_weighted`. Provides `countContentUnits` and `validateContentLimits`.
- `thread-segmentation.ts`: Pure algorithmic splitter with priority break offsets (paragraphs -> sentences -> punctuation -> spaces). Protects URL ranges and checks reconstructed text equivalence.

### Plan

1. Write unit tests in `packages/kk-core/tests/content-limits.test.ts` asserting all failure modes first.
2. Implement `packages/kk-core/src/content-limits.ts` with typed counter functions.
3. Implement `packages/kk-core/src/thread-segmentation.ts` with invariant verification.
4. Export from `packages/kk-core/src/index.ts`.
5. Run lint, typecheck, and unit test suite to verify 100% pass.

### Solution

- `packages/kk-core/src/content-limits.ts:102`: export const `PLATFORM_CONTENT_LIMITS`: PlatformLimitsConfig
- `packages/kk-core/src/thread-segmentation.ts:60`: Implements `splitThreadContent` preserving URLs and verifying `segments.join("") === rawText`.
- `packages/kk-core/src/index.ts:55`: Exported all new content limits and thread segmentation types.
- `packages/kk-core/tests/content-limits.test.ts:1`: Added unit tests asserting counting, limits, and thread segmentation invariants.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Typed limits schema `packages/kk-core/src/content-limits.ts:93` (`PlatformLimitsConfig`, `ContentCountUnit`) with frozen shipped table `packages/kk-core/src/content-limits.ts:105` (`schemaVersion: 5`; X = 280 `weighted` and Threads = 500 `unicode_code_points` at `packages/kk-core/src/content-limits.ts:161-162`, Xiaohongshu title = 20 `xiaohongshu_title_weighted` at `packages/kk-core/src/content-limits.ts:140`). Unified counter `countContentUnits` at `packages/kk-core/src/content-limits.ts:69` dispatches all four units, and the fixed 23-character URL weight is applied in `countXWeightedCharacters` at `packages/kk-core/src/content-limits.ts:41`. All are re-exported from the package entry `packages/kk-core/src/index.ts:5-16`. Exercised by `packages/kk-core/tests/content-limits.test.ts:6` (utf16), `:14` (code points), `:22` (weighted/URL), `:35` (XHS title). |
| R2 | MET | Deterministic splitter `splitThreadContent` at `packages/kk-core/src/thread-segmentation.ts:64`; the invariant is enforced by construction and asserted at `packages/kk-core/src/thread-segmentation.ts:154` (`segments.join('') === rawText`) and returned as `reconstructed` at `packages/kk-core/src/thread-segmentation.ts:159`. URLs are protected via `collectUrlRanges` at `packages/kk-core/src/thread-segmentation.ts:46` and the `isInsideRange` break-offset filter at `packages/kk-core/src/thread-segmentation.ts:112` and `:138`. Exercised by `packages/kk-core/tests/content-limits.test.ts:150` (full URL survives inside one segment) and `packages/kk-core/tests/thread-segmentation.test.ts:72` (no mid-URL cut when forced to hard splitting). |
| R3 | MET | Unit tests delivered at `packages/kk-core/tests/content-limits.test.ts:1` and `packages/kk-core/tests/thread-segmentation.test.ts:1` covering unit counting, limit violations, empty/null input, paragraph/sentence/newline/space break priority, URL protection, astral (surrogate-pair) boundaries and over-limit hard splits. `bun test packages/kk-core/tests` → 115 pass / 0 fail / 352 expect() calls, exit 0. Per-file coverage clears the 90% floor: `content-limits.ts` 100.00% funcs / 100.00% lines, `thread-segmentation.ts` 100.00% funcs / 100.00% lines (lowest file in the run: `manifest.ts` 98.56% lines). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 - Content limits engine enforces character and URL weighting | MET | test | `packages/kk-core/tests/content-limits.test.ts:6` utf16 code units, `:14` Unicode code points, `:22` Twitter/X weighted counting with the 23-char URL rule, `:35` Xiaohongshu weighted title, `:64` Threads 500-code-point body violation, `:78` Xiaohongshu 20-unit title violation, `:110` frozen limits dictionary. `bun test packages/kk-core/tests` exit 0. |
| R4 - Thread segmentation preserves invariants without data loss | MET | test | `packages/kk-core/tests/thread-segmentation.test.ts:29` paragraph breaks + exact reconstruction, `:63` URL kept intact, `:72` no mid-URL break under forced binary-search splitting, `:85` astral characters split on code-point boundaries, `:95` unbreakable text split at hard limits with no over-limit segment; `packages/kk-core/tests/content-limits.test.ts:150` full URL present in one segment and `:163` invariant on punctuation-free text. Exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

- Implementation strictly satisfies ADR-007 contracts.
- No external runtime dependencies added.
- Invariant `segments.join("") === originalText` verified across paragraph, sentence, and arbitrary length boundaries.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-15T05:48:47.724Z backlog → todo (system)
- 2026-10-15T05:48:48.077Z todo → wip (system)
- 2026-10-15T05:54:44.063Z wip → testing (system)

