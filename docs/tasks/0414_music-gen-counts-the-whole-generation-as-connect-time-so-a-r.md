---
schema_version: 1
name: music-gen counts the whole generation as connect time, so a real take reads as an unreachable instance
status: done
template: issue
created_at: 2026-11-20T18:04:18.073Z
updated_at: "2026-11-21T05:44:30.900Z"
feature_id: D8

done_forced: "false"
done_reason: unforced close
---

## 0414. music-gen counts the whole generation as connect time, so a real take reads as an unreachable instance

### Background

Captured from the creation title: "music-gen counts the whole generation as connect time, so a real take reads as an unreachable instance".

### Requirements

- [x] R1. The connect phase is decided by the connection/TTFB probe, not by waiting for the instance's full synchronous response, so a real 40 s take is never classified `connect` and never retried as unreachable.
- [x] R2. A regression test covers a slow body with a healthy connection: the send must be treated as dispatched (no retry, no 'nothing was billed' claim) and must surface the instance's own outcome.
- [x] R3. The 5 s default stays the connect bound for a genuinely dead host.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. [x] Reproduced the root cause in `InstanceClient.attempt()` (`plugins/generations/music-gen/src/adapter/instance.ts`): `POST /api/lyria/generate` answers only after the take, so `connectTimer` fired at 5 s inside `fetch()`.
2. [x] Split the phase: probe reachability via `GET /api/settings/status` (`STATUS_PATH`) under `connectTimeoutMs` before paid `POST`s, and run `POST` under `timeoutMs` alone.
3. [x] Pinned in `plugins/generations/music-gen/tests/adapter.test.ts` with fake fetches whose `POST` headers arrive after `connectTimeoutMs` (success and terminal 429 cases).

### Root Cause

`InstanceClient.attempt()` in `plugins/generations/music-gen/src/adapter/instance.ts:387` armed `connectTimer` (`connectTimeoutMs`, default 5 s) until `this.fetchImpl()` resolved response headers (`phase = 'body'`). Because `POST /api/lyria/generate` (and `POST /api/ai/analyze`) is synchronous and only sends HTTP headers after generation completes (~40 s), `connectTimer` fired at 5 s on healthy takes, classified them as `{ kind: 'connect' }`, retried up to 3 times, and reported `nothing was billed`.

### Solution

| File | Line | Change |
| --- | --- | --- |
| `plugins/generations/music-gen/src/adapter/instance.ts` | `41-42` | Export `STATUS_PATH = '/api/settings/status'` as the free reachability probe route. |
| `plugins/generations/music-gen/src/adapter/instance.ts` | `389-464` | Restrict `connectTimer` (`connectTimeoutMs`) in `attempt()` to `GET` requests (`enforceConnectTimer = method === 'GET'`); paid `POST`s run under `timeoutMs` alone. |
| `plugins/generations/music-gen/src/adapter/instance.ts` | `498-534` | In `send()`, when `method === 'POST'`, probe `GET /api/settings/status` under `connectTimeoutMs` (retrying up to `connectAttempts`) before dispatching the paid `POST`. |
| `plugins/generations/music-gen/tests/adapter.test.ts` | `221-334` | Update `stub.calls` assertions for the pre-POST `STATUS_PATH` probe and add 0414 regression tests for slow-header `POST`s (200 take and terminal 429) arriving after `connectTimeoutMs`. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/music-gen/src/adapter/instance.ts:41-42`, `plugins/generations/music-gen/src/adapter/instance.ts:389-410`, `plugins/generations/music-gen/src/adapter/instance.ts:505-516` (`GET /api/settings/status` probe under `connectTimeoutMs`; paid `POST` under `timeoutMs` alone) |
| R2 | MET | `plugins/generations/music-gen/tests/adapter.test.ts:288-334` (27 pass / 0 fail in `bun scripts/test-changed.ts plugins/generations/music-gen tests/adapter.test.ts`) |
| R3 | MET | `plugins/generations/music-gen/src/adapter/instance.ts:371` (`5_000` ms default), `plugins/generations/music-gen/tests/adapter.test.ts:266-286` (dead host / connect stall retries bounded to 3) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | N/A | n/a | Task 0414 declares no `AC` rows; requirements R1–R3 are directly verified above and by `bun scripts/test-changed.ts plugins/generations/music-gen tests/adapter.test.ts` (27 pass / 0 fail). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

- **Disposition:** PASS (0 P1–P3 findings).
- **SECUA & Architecture:** `InstanceClient.send()` (`plugins/generations/music-gen/src/adapter/instance.ts:505-516`) probes `GET /api/settings/status` under `connectTimeoutMs` before paid `POST`s, while `attempt()` (`plugins/generations/music-gen/src/adapter/instance.ts:392`) restricts `connectTimer` to `GET` requests so synchronous `POST`s run under `timeoutMs` alone.
- **Verification:** Light gate PASS (`format-lint:changed`, `rules:pre`, `rules:post`, `typecheck:apps/cli`, `typecheck:plugins/generations/music-gen`, `test:plugins/generations/music-gen` 27 pass / 0 fail; `instance.ts` 92.31% funcs / 99.68% lines).

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-21T05:41:32.823Z todo → wip (system)
- 2026-11-21T05:44:28.997Z wip → testing (system)
- 2026-11-21T05:44:30.893Z testing → done (system)

