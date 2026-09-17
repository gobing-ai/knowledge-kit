---
schema_version: 1
name: Ship substack-pub and xhs-pub as browser-agent channels
status: todo
template: feature-impl
created_at: 2026-09-17T23:03:26.222Z
updated_at: "2026-09-17T23:05:00.235Z"
feature_id: E7
priority: P2
estimate_hours: 8

dependencies: ["0141"]
---

## 0146. Ship substack-pub and xhs-pub as browser-agent channels

### Background

Implements leftover CMS pair two: substack-pub and xhs-pub, completing the leftover-channel set for R4 (discoverable plugins) together with already-landed medium/wechat/x/juejin/infoq.

Same harness contract as juejin/infoq. Can run in parallel with that pair after the harness lands.

Rubric: E8 D1 L2 C1 R1 = 13 → decompose (two more packages; not combined into juejin/infoq to keep PRs reviewable).

### Requirements

- [ ] R1. substack-pub and xhs-pub are kind publish, discoverable, and invocable via kk executor run.
- [ ] R2. Default browser driver is agent; Result parses against ResultSchema with the channel target.
- [ ] R3. Missing session or login timeout exits non-zero with ok false.
- [ ] R4. Unit tests use FakeBrowserTransport and perform no live publisher-site I/O.
- [ ] R5. qiita-pub, zenn-pub, and surfdash-pub are not modified.

### Acceptance Criteria

- [ ] AC1 — Harvested leftover channels are discoverable publish plugins
- [ ] AC2 — A leftover CMS channel publishes via the browser agent driver
- [ ] AC3 — Unit tests for harvested channels run offline via harness fakes

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: same browser/agent pattern as juejin-pub/infoq-pub. Substack has no official write API; XHS has no official public write API. Profile dirs under ~/.config/kk/browser-profiles/substack and .../xhs.

Rejected: unofficial internal JSON APIs as file-cli (ToS and breakage); merging all four CMS plugins into one PR.

Invariants: no LLM in the plugin; no edits to shipped E3–E6 publishers.

Signatures:
- `class SubstackBrowserTransport implements PublishTransport`
- `class XhsBrowserTransport implements PublishTransport`

### Plan

1. Scaffold substack-pub and xhs-pub.
2. Implement agent-driver transports on the harness session helpers.
3. Offline FakeBrowserTransport tests; assert shipped qiita/zenn/surfdash packages are untouched.
4. Confirm registry lists all seven leftover plugins once prior channel tasks have landed.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
