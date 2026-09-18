---
schema_version: 1
name: Ship medium-pub as a file-cli token API channel
status: done
template: feature-impl
created_at: 2026-09-17T23:03:26.220Z
updated_at: "2026-09-17T23:49:39.218Z"
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

- [x] R1. plugins/publishings/medium-pub is kind publish, discoverable, and invocable via kk executor run.
- [x] R2. Valid Content plus MEDIUM_INTEGRATION_TOKEN publishes as file-cli and returns ok true with target medium and a post id or url.
- [x] R3. Absent a live-publish confirmation the Result describes draft or unlisted-unpublished state.
- [x] R4. Unset MEDIUM_INTEGRATION_TOKEN exits non-zero, Result.ok is false, and the error names the variable.
- [x] R5. Neither Result nor plugin.json contains the token value.
- [x] R6. Unit tests use FakeFileCliTransport and perform no live Medium I/O.

### Acceptance Criteria

- [x] AC1 — Medium publishes via the token API as file-cli
- [x] AC2 — New publishes default to draft unless live publish is confirmed
- [x] AC3 — Missing secrets fail loud without leaking tokens
- [x] AC4 — Unit tests for harvested channels run offline via harness fakes

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

| File | What | Why |
| --- | --- | --- |
| `plugins/publishings/medium-pub/src/index.ts:79` | `MediumApiTransport` GET /me + POST /users/{id}/posts | R2 file-cli token API |
| `plugins/publishings/medium-pub/src/index.ts:58` | `mapContentToMediumPost` draft default | R3 |
| `plugins/publishings/medium-pub/tests/medium-pub.test.ts` | FakeFileCli + mocked fetch; missing token names `MEDIUM_INTEGRATION_TOKEN` | R4–R6 |
| `plugins/publishings/medium-pub/plugin.json:2` | kind publish, no secret | R1 R5 |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/medium-pub/plugin.json:2` kind publish; `tests/medium-pub.test.ts` runInvoke |
| R2 | MET | `plugins/publishings/medium-pub/src/index.ts:79` MediumApiTransport mocked fetch returns id/url |
| R3 | MET | `plugins/publishings/medium-pub/src/index.ts:58` draft default; test live only via options.publishStatus |
| R4 | MET | `plugins/publishings/medium-pub/tests/medium-pub.test.ts` unset token → ok false names MEDIUM_INTEGRATION_TOKEN |
| R5 | MET | `plugins/publishings/medium-pub/plugin.json:1-6` no token; Result JSON must not contain token value |
| R6 | MET | `plugins/publishings/medium-pub/tests/medium-pub.test.ts` FakeFileCliTransport offline |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Medium publishes via the token API as file-cli | MET | test | `plugins/publishings/medium-pub/tests/medium-pub.test.ts` MediumApiTransport mocked fetch |
| AC2 — New publishes default to draft unless live publish is confirmed | MET | test | `plugins/publishings/medium-pub/tests/medium-pub.test.ts` mapContentToMediumPost defaults to draft |
| AC3 — Missing secrets fail loud without leaking tokens | MET | test | `plugins/publishings/medium-pub/tests/medium-pub.test.ts` missing token names variable |
| AC4 — Unit tests for harvested channels run offline via harness fakes | MET | test | `plugins/publishings/medium-pub/tests/medium-pub.test.ts` FakeFileCliTransport |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional verdict PASS |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/publishings/medium-pub/plugin.json:2` + `tests/medium-pub.test.ts` runInvoke |
| R2 | MET | `plugins/publishings/medium-pub/src/index.ts:79` MediumApiTransport |
| R3 | MET | `mapContentToMediumPost` default draft; test honors public only when confirmed |
| R4 | MET | missing-token test names MEDIUM_INTEGRATION_TOKEN |
| R5 | MET | Result JSON assert not toContain token; plugin.json has no token |
| R6 | MET | FakeFileCliTransport + spyOn fetch |

Disposition: approve.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T23:49:37.519Z todo → wip (system)
- 2026-09-17T23:49:38.930Z wip → testing (system)
- 2026-09-17T23:49:39.218Z testing → done (system)

