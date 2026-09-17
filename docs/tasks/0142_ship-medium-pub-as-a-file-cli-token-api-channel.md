---
schema_version: 1
name: Ship medium-pub as a file-cli token API channel
status: todo
template: feature-impl
created_at: 2026-09-17T23:03:26.220Z
updated_at: "2026-09-17T23:04:59.602Z"
feature_id: E7
priority: P2
estimate_hours: 5

dependencies: ["0141"]
---

## 0142. Ship medium-pub as a file-cli token API channel

### Background

Implements: R5 — Medium publishes via the token API as file-cli; R11 — New publishes default to draft unless live publish is confirmed; R12 — Missing secrets fail loud without leaking tokens; R16 — Unit tests for harvested channels run offline via harness fakes.

First leftover channel on the existing file-cli path (qiita-pub grain). Depends on the harness only for FakeFileCliTransport.

Rubric: E5 D1 L1 C0 R1 = 7 → decompose (distinct plugin package).

### Requirements

- [ ] R1. plugins/publishings/medium-pub is kind publish, discoverable, and invocable via kk executor run.
- [ ] R2. Valid Content plus MEDIUM_INTEGRATION_TOKEN publishes as file-cli and returns ok true with target medium and a post id or url.
- [ ] R3. Absent a live-publish confirmation the Result describes draft or unlisted-unpublished state.
- [ ] R4. Unset MEDIUM_INTEGRATION_TOKEN exits non-zero, Result.ok is false, and the error names the variable.
- [ ] R5. Neither Result nor plugin.json contains the token value.
- [ ] R6. Unit tests use FakeFileCliTransport and perform no live Medium I/O.

### Acceptance Criteria

- [ ] AC1 — Medium publishes via the token API as file-cli
- [ ] AC2 — New publishes default to draft unless live publish is confirmed
- [ ] AC3 — Missing secrets fail loud without leaking tokens
- [ ] AC4 — Unit tests for harvested channels run offline via harness fakes

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: qiita-pub-shaped plugin: map Content to Medium create envelope, fetch POST https://api.medium.com/v1/users/{userId}/posts with Bearer token. Default publishStatus draft.

Rejected: browser automation (wt Medium is already API); storing the token in config.jsonc.

Invariants: env-only secret; fail-loud Result; FakeFileCliTransport tests.

Signatures:
- `class MediumApiTransport implements PublishTransport` (kind: 'file-cli')
- `function mapContentToMediumPost(content: Content): MediumPostBody`

### Plan

1. Scaffold plugin.json, package.json, src/index.ts on the qiita-pub grain.
2. Implement mapper + MediumApiTransport with draft default and fail-loud missing token.
3. Offline tests via FakeFileCliTransport plus mocked fetch for the live mapper.
4. Confirm registry discovery and kk executor run --in/--out contract.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
