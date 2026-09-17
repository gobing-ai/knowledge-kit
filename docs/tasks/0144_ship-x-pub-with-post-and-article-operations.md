---
schema_version: 1
name: Ship x-pub with post and article operations
status: todo
template: feature-impl
created_at: 2026-09-17T23:03:26.221Z
updated_at: "2026-09-17T23:04:59.948Z"
feature_id: E7
priority: P2
estimate_hours: 8

dependencies: ["0141"]
---

## 0144. Ship x-pub with post and article operations

### Background

Implements: R7 — x-pub post operation uses the official X API; R8 — x-pub article operation uses a browser transport on the same plugin; R18 — x-pub post without developer tokens fails loud.

One plugin, two operations. post is file-cli and must not fall back to a browser. article is browser/agent on the same package.

Depends on harness FakeBrowserTransport for article tests.

Rubric: E8 D1 L1 C1 R2 = 13 → decompose (ToS-sensitive post path; same plugin as article).

### Requirements

- [ ] R1. plugins/publishings/x-pub is a single kind-publish plugin with operations post and article; no second X plugin exists.
- [ ] R2. post calls POST /2/tweets as file-cli and returns ok true with a post id.
- [ ] R3. post with X credentials unset exits non-zero, names the missing env vars, and does not drive the X website.
- [ ] R4. article uses kind browser (driver agent by default) and writes a ResultSchema-valid Result.
- [ ] R5. Unit tests use FakeFileCliTransport for post and FakeBrowserTransport for article; no live x.com I/O.

### Acceptance Criteria

- [ ] AC1 — x-pub post operation uses the official X API
- [ ] AC2 — x-pub article operation uses a browser transport on the same plugin
- [ ] AC3 — x-pub post without developer tokens fails loud
- [ ] AC4 — Unit tests for harvested channels run offline via harness fakes

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: one plugin x-pub. post = OAuth user-context POST /2/tweets (file-cli). article = browser driver agent using harness session helpers; optional script driver later. Env: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET.

Rejected: two plugins; browser posting for tweets (X Automation Rules); embedding an LLM in the plugin.

Invariants: post never uses a browser; article never requires a second package; draft/preview default for article.

Signatures:
- `class XPostApiTransport implements PublishTransport` (kind: 'file-cli')
- `class XArticleBrowserTransport implements PublishTransport` (kind: 'browser', driver: 'agent')

### Plan

1. Scaffold x-pub plugin.json with operations post and article.
2. Implement post via official API with fail-loud missing tokens and no browser fallback.
3. Implement article via FakeBrowserTransport-tested browser/agent transport on the same plugin.
4. Offline tests for both operations; assert plugins/publishings has no second X package.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
