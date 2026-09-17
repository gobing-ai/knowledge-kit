---
schema_version: 1
name: Ship wechatmp-pub draft via the official draft API
status: done
template: feature-impl
created_at: 2026-09-17T23:03:26.221Z
updated_at: "2026-09-17T23:49:41.037Z"
feature_id: E7
priority: P2
estimate_hours: 6

dependencies: ["0141"]
---

## 0143. Ship wechatmp-pub draft via the official draft API

### Background

Implements: R6 — WeChat draft operation uses official draft/add as file-cli; R17 — Uncertified WeChat accounts cannot API-publish live and route to operator confirmation.

file-cli draft is the default operation. Live publish for uncertified accounts is not success.

Rubric: E6 D1 L1 C0 R1 = 8 → decompose (distinct API + HTML mapping).

### Requirements

- [x] R1. wechatmp-pub is kind publish with a draft operation that calls official draft/add as file-cli.
- [x] R2. Valid Content plus WECHAT_APP_ID and WECHAT_APP_SECRET returns ok true with a draft media_id.
- [x] R3. A live-publish request on an account that cannot call freepublish/submit fails loud or pauses for operator confirmation.
- [x] R4. Missing AppID or AppSecret exits non-zero and names the variable; secrets never appear in Result or plugin.json.
- [x] R5. Unit tests use FakeFileCliTransport and perform no live mp.weixin.qq.com I/O.

### Acceptance Criteria

- [x] AC1 — WeChat draft operation uses official draft/add as file-cli
- [x] AC2 — Uncertified WeChat accounts cannot API-publish live and route to operator confirmation
- [x] AC3 — Missing secrets fail loud without leaking tokens
- [x] AC4 — Unit tests for harvested channels run offline via harness fakes

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: file-cli transport: stable_token → media/uploadimg / material/add_material → POST /cgi-bin/draft/add. Default operation is draft. Map markdown to WeChat HTML inside the plugin (harvest md-to-wechat.ts logic, TypeScript only).

Rejected: Playwright-only WeChat (wt default); live freepublish/submit as default.

Invariants: draft default; env WECHAT_APP_ID / WECHAT_APP_SECRET; no LLM in the plugin.

Signatures:
- `class WechatDraftApiTransport implements PublishTransport` (kind: 'file-cli')
- `function mapContentToWechatDraft(content: Content): WechatDraftArticles`

### Plan

1. Scaffold wechatmp-pub with operations.draft as the default.
2. Implement token, cover upload, draft/add, and markdown-to-WeChat HTML mapping.
3. Fail loud on missing creds and on live-publish when the account cannot publish via API.
4. Offline FakeFileCliTransport tests plus mocked fetch for the mapper.

### Solution

| File | What | Why |
| --- | --- | --- |
| `plugins/publishings/wechatmp-pub/src/index.ts:166` | `WechatDraftApiTransport` token + draft/add | R1 R2 |
| `plugins/publishings/wechatmp-pub/src/index.ts:42` | `markdownToWechatHtml` harvested mapper | Design |
| `plugins/publishings/wechatmp-pub/src/index.ts:171` | live/freepublish fails loud for operator confirmation | R3 |
| `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` | FakeFileCli + mocked fetch; missing AppID | R4 R5 |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/wechatmp-pub/src/index.ts:166` WechatDraftApiTransport kind file-cli draft/add |
| R2 | MET | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` mocked fetch media_id |
| R3 | MET | `plugins/publishings/wechatmp-pub/src/index.ts:171` live/freepublish fail-loud operator confirmation |
| R4 | MET | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` missing AppID names WECHAT_APP_ID |
| R5 | MET | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` FakeFileCliTransport |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — WeChat draft operation uses official draft/add as file-cli | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` draft/add mocked fetch |
| AC2 — Uncertified WeChat accounts cannot API-publish live and route to operator confirmation | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` live publish fails loud |
| AC3 — Missing secrets fail loud without leaking tokens | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` missing AppID |
| AC4 — Unit tests for harvested channels run offline via harness fakes | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` FakeFileCliTransport |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional verdict PASS |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | WechatDraftApiTransport file-cli draft/add |
| R2 | MET | mocked fetch returns media_id |
| R3 | MET | live operation fail names certification-gated / operator |
| R4 | MET | missing WECHAT_APP_ID; Result does not leak secret |
| R5 | MET | FakeFileCliTransport offline |

Disposition: approve.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T23:49:39.362Z todo → wip (system)
- 2026-09-17T23:49:40.748Z wip → testing (system)
- 2026-09-17T23:49:41.037Z testing → done (system)

