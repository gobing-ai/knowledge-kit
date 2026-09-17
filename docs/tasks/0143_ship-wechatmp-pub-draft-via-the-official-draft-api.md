---
schema_version: 1
name: Ship wechatmp-pub draft via the official draft API
status: todo
template: feature-impl
created_at: 2026-09-17T23:03:26.221Z
updated_at: "2026-09-17T23:04:59.802Z"
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

- [ ] R1. wechatmp-pub is kind publish with a draft operation that calls official draft/add as file-cli.
- [ ] R2. Valid Content plus WECHAT_APP_ID and WECHAT_APP_SECRET returns ok true with a draft media_id.
- [ ] R3. A live-publish request on an account that cannot call freepublish/submit fails loud or pauses for operator confirmation.
- [ ] R4. Missing AppID or AppSecret exits non-zero and names the variable; secrets never appear in Result or plugin.json.
- [ ] R5. Unit tests use FakeFileCliTransport and perform no live mp.weixin.qq.com I/O.

### Acceptance Criteria

- [ ] AC1 — WeChat draft operation uses official draft/add as file-cli
- [ ] AC2 — Uncertified WeChat accounts cannot API-publish live and route to operator confirmation
- [ ] AC3 — Missing secrets fail loud without leaking tokens
- [ ] AC4 — Unit tests for harvested channels run offline via harness fakes

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
