---
schema_version: 1
name: Ship x-pub with post and article operations
status: done
template: feature-impl
created_at: 2026-09-17T23:03:26.221Z
updated_at: "2026-09-17T23:49:42.862Z"
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

- [x] R1. plugins/publishings/x-pub is a single kind-publish plugin with operations post and article; no second X plugin exists.
- [x] R2. post calls POST /2/tweets as file-cli and returns ok true with a post id.
- [x] R3. post with X credentials unset exits non-zero, names the missing env vars, and does not drive the X website.
- [x] R4. article uses kind browser (driver agent by default) and writes a ResultSchema-valid Result.
- [x] R5. Unit tests use FakeFileCliTransport for post and FakeBrowserTransport for article; no live x.com I/O.

### Acceptance Criteria

- [x] AC1 — x-pub post operation uses the official X API
- [x] AC2 — x-pub article operation uses a browser transport on the same plugin
- [x] AC3 — x-pub post without developer tokens fails loud
- [x] AC4 — Unit tests for harvested channels run offline via harness fakes

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

| File | What | Why |
| --- | --- | --- |
| `plugins/publishings/x-pub/src/index.ts:68` | `XPostApiTransport` OAuth 1.0a POST /2/tweets | R2 |
| `plugins/publishings/x-pub/src/index.ts:126` | `XArticleBrowserTransport` browser/agent | R4 |
| `plugins/publishings/x-pub/tests/x-pub.test.ts` | FakeFileCli + FakeBrowser; no second X package | R1 R3 R5 |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/x-pub/plugin.json:2` one plugin; `tests/x-pub.test.ts` no second X package |
| R2 | MET | `plugins/publishings/x-pub/src/index.ts:68` XPostApiTransport POST /2/tweets |
| R3 | MET | `plugins/publishings/x-pub/tests/x-pub.test.ts` unset tokens fail, no browser fallback |
| R4 | MET | `plugins/publishings/x-pub/src/index.ts:126` XArticleBrowserTransport kind browser driver agent |
| R5 | MET | `plugins/publishings/x-pub/tests/x-pub.test.ts` FakeFileCliTransport + FakeBrowserTransport |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — x-pub post operation uses the official X API | MET | test | `plugins/publishings/x-pub/tests/x-pub.test.ts` POST /2/tweets mocked fetch |
| AC2 — x-pub article operation uses a browser transport on the same plugin | MET | test | `plugins/publishings/x-pub/tests/x-pub.test.ts` XArticleBrowserTransport |
| AC3 — x-pub post without developer tokens fails loud | MET | test | `plugins/publishings/x-pub/tests/x-pub.test.ts` missing tokens |
| AC4 — Unit tests for harvested channels run offline via harness fakes | MET | test | `plugins/publishings/x-pub/tests/x-pub.test.ts` FakeFileCli + FakeBrowser |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Architecture | `plugins/publishings/x-pub/plugin.json` | Manifest operations stay Content→Result (`options.operation`); schema only allows doc-list/markdown auxiliaries. |
| P4 | — | — | No P1–P3 findings; functional verdict PASS |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | single x-pub package; test no second X plugin |
| R2 | MET | XPostApiTransport mocked POST /2/tweets |
| R3 | MET | missing tokens fail; no browser fallback message |
| R4 | MET | XArticleBrowserTransport kind browser driver agent |
| R5 | MET | FakeFileCli + FakeBrowser |

Disposition: approve.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T23:49:41.180Z todo → wip (system)
- 2026-09-17T23:49:42.574Z wip → testing (system)
- 2026-09-17T23:49:42.862Z testing → done (system)

