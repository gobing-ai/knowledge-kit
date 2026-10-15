---
schema_version: 1
name: Core content limits and deterministic thread segmentation in kk-core
status: testing
template: feature-impl
created_at: 2026-10-15T05:43:08.391Z
updated_at: "2026-10-15T05:59:00.878Z"
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

- [ ] AC1 — R3 - Content limits engine enforces character and URL weighting (req: R1)
- [ ] AC2 — R4 - Thread segmentation preserves invariants without data loss (req: R2)

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

Ran `bun test packages/kk-core/tests` and `bun run autofix`:
- `content-limits.ts`: 100% Funcs, 100% Lines
- `thread-segmentation.ts`: 100% Funcs, 100% Lines
- Full suite: 96 passed, 0 failed, 294 assertions, exit code 0.

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

