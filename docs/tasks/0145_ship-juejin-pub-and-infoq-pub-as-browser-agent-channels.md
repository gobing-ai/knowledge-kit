---
schema_version: 1
name: Ship juejin-pub and infoq-pub as browser-agent channels
status: done
template: feature-impl
created_at: 2026-09-17T23:03:26.222Z
updated_at: "2026-09-17T23:49:44.726Z"
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

- [x] R1. juejin-pub and infoq-pub are kind publish, discoverable, and invocable via kk executor run.
- [x] R2. Default browser driver is agent; Result parses against ResultSchema with the channel target.
- [x] R3. When a script driver is also shipped, the same Content yields Results that share ok, target, and id-or-url.
- [x] R4. Login wait expiry exits non-zero with a Result that names login timeout.
- [x] R5. Unit tests use FakeBrowserTransport and perform no live publisher-site I/O.

### Acceptance Criteria

- [x] AC1 — A leftover CMS channel publishes via the browser agent driver
- [x] AC2 — Optional Playwright script path returns the same Result as the agent driver
- [x] AC3 — Agent-browser login timeout fails loud
- [x] AC4 — Unit tests for harvested channels run offline via harness fakes

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

| File | What | Why |
| --- | --- | --- |
| `plugins/publishings/juejin-pub/src/index.ts:36` | `JuejinBrowserTransport` default agent | R1 R2 |
| `plugins/publishings/infoq-pub/src/index.ts:36` | `InfoqBrowserTransport` | R1 |
| `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts` | script/agent Result parity; login timeout; FakeBrowser | R3 R4 R5 |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/juejin-pub/plugin.json:2` and `infoq-pub/plugin.json:2`; runInvoke tests |
| R2 | MET | `plugins/publishings/juejin-pub/src/index.ts:36` default driver agent |
| R3 | MET | `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts` script and agent share ok/target/id |
| R4 | MET | `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts` login timeout |
| R5 | MET | `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts` FakeBrowserTransport |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A leftover CMS channel publishes via the browser agent driver | MET | test | `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts` default driver agent |
| AC2 — Optional Playwright script path returns the same Result as the agent driver | MET | test | `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts` script/agent parity |
| AC3 — Agent-browser login timeout fails loud | MET | test | `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts` login timeout |
| AC4 — Unit tests for harvested channels run offline via harness fakes | MET | test | `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts` FakeBrowserTransport |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional verdict PASS |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | juejin-pub + infoq-pub runInvoke |
| R2 | MET | default driver agent; ResultSchema target |
| R3 | MET | script and agent share ok/target/id |
| R4 | MET | login timeout Result |
| R5 | MET | FakeBrowserTransport |

Disposition: approve.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T23:49:43.004Z todo → wip (system)
- 2026-09-17T23:49:44.430Z wip → testing (system)
- 2026-09-17T23:49:44.726Z testing → done (system)

