---
schema_version: 1
name: Ship substack-pub and xhs-pub as browser-agent channels
status: done
template: feature-impl
created_at: 2026-09-17T23:03:26.222Z
updated_at: "2026-09-17T23:49:46.548Z"
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

- [x] R1. substack-pub and xhs-pub are kind publish, discoverable, and invocable via kk executor run.
- [x] R2. Default browser driver is agent; Result parses against ResultSchema with the channel target.
- [x] R3. Missing session or login timeout exits non-zero with ok false.
- [x] R4. Unit tests use FakeBrowserTransport and perform no live publisher-site I/O.
- [x] R5. qiita-pub, zenn-pub, and surfdash-pub are not modified.

### Acceptance Criteria

- [x] AC1 — Harvested leftover channels are discoverable publish plugins
- [x] AC2 — A leftover CMS channel publishes via the browser agent driver
- [x] AC3 — Unit tests for harvested channels run offline via harness fakes

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

| File | What | Why |
| --- | --- | --- |
| `plugins/publishings/substack-pub/src/index.ts:36` | `SubstackBrowserTransport` | R1 R2 |
| `plugins/publishings/xhs-pub/src/index.ts:36` | `XhsBrowserTransport` | R1 R2 |
| `plugins/publishings/substack-pub/tests/substack-pub.test.ts` | login timeout + FakeBrowser + runInvoke | R3 R4 |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/substack-pub/plugin.json:2` and `xhs-pub/plugin.json:2`; runInvoke tests |
| R2 | MET | `plugins/publishings/substack-pub/src/index.ts:36` default driver agent |
| R3 | MET | `plugins/publishings/substack-pub/tests/substack-pub.test.ts` login timeout |
| R4 | MET | `plugins/publishings/substack-pub/tests/substack-pub.test.ts` FakeBrowserTransport |
| R5 | MET | `plugins/publishings/qiita-pub/src/index.ts:1` and `zenn-pub/src/index.ts:1` unchanged by 0146 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Harvested leftover channels are discoverable publish plugins | MET | test | `packages/kk-core/tests/registry.test.ts` shipped tree includes substack-pub and xhs-pub |
| AC2 — A leftover CMS channel publishes via the browser agent driver | MET | test | `plugins/publishings/substack-pub/tests/substack-pub.test.ts` default driver agent |
| AC3 — Unit tests for harvested channels run offline via harness fakes | MET | test | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` FakeBrowserTransport |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional verdict PASS |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | substack-pub + xhs-pub runInvoke |
| R2 | MET | default agent driver |
| R3 | MET | login timeout ok false |
| R4 | MET | FakeBrowserTransport |
| R5 | MET | qiita/zenn sources untouched by this task (surfdash echoError was 0141 gate fix) |

Disposition: approve.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T23:49:44.866Z todo → wip (system)
- 2026-09-17T23:49:46.254Z wip → testing (system)
- 2026-09-17T23:49:46.548Z testing → done (system)

