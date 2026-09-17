---
schema_version: 1
name: Ship juejin-pub and infoq-pub as browser-agent channels
status: todo
template: feature-impl
created_at: 2026-09-17T23:03:26.222Z
updated_at: "2026-09-17T23:05:00.091Z"
feature_id: E7
priority: P2
estimate_hours: 8

dependencies: ["0141"]
---

## 0145. Ship juejin-pub and infoq-pub as browser-agent channels

### Background

Implements: R9 — A leftover CMS channel publishes via the browser agent driver; R10 — Optional Playwright script path returns the same Result as the agent driver; R19 — Agent-browser login timeout fails loud.

First pair of leftover CMS plugins. Proves agent driver default plus optional script path and login-timeout fail-loud. Depends on harness session helpers.

Rejected split: one task per CMS plugin (same review context, same harness API; two packages is enough grain).

Rubric: E8 D1 L2 C1 R1 = 13 → decompose (two packages, shared harness).

### Requirements

- [ ] R1. juejin-pub and infoq-pub are kind publish, discoverable, and invocable via kk executor run.
- [ ] R2. Default browser driver is agent; Result parses against ResultSchema with the channel target.
- [ ] R3. When a script driver is also shipped, the same Content yields Results that share ok, target, and id-or-url.
- [ ] R4. Login wait expiry exits non-zero with a Result that names login timeout.
- [ ] R5. Unit tests use FakeBrowserTransport and perform no live publisher-site I/O.

### Acceptance Criteria

- [ ] AC1 — A leftover CMS channel publishes via the browser agent driver
- [ ] AC2 — Optional Playwright script path returns the same Result as the agent driver
- [ ] AC3 — Agent-browser login timeout fails loud
- [ ] AC4 — Unit tests for harvested channels run offline via harness fakes

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: two plugins, each implementing PublishTransport kind browser, driver agent, using harness launchPersistentBrowser / trySelectors / profile dir. Optional script driver behind the same publish() and Result. Login timeout from BrowserSessionOptions.loginTimeoutMs.

Rejected: embedding Playwright selectors only (wt brittleness); spawning an LLM from the plugin.

Invariants: plugin process has no LLM; FakeBrowserTransport tests; profile under ~/.config/kk/browser-profiles/<channel>.

Signatures:
- `class JuejinBrowserTransport implements PublishTransport`
- `class InfoqBrowserTransport implements PublishTransport`

### Plan

1. Scaffold juejin-pub and infoq-pub on the E2 invoke contract.
2. Implement agent-driver transports via harness session helpers; add optional script driver on one channel to prove Result parity.
3. Fail loud on login timeout; default unpublished/draft Result.
4. Offline FakeBrowserTransport tests for both plugins.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
