---
schema_version: 1
name: Fix the VoxCPM worker success-path response and cover it with a regression test
status: todo
template: issue
created_at: 2026-10-12T23:09:53.539Z
updated_at: "2026-10-12T23:10:46.433Z"
feature_id: G14

---

## 0269. Fix the VoxCPM worker success-path response and cover it with a regression test

### Background

Task 0258's Step-0 backend diagnosis (2026-10-12, worktree `spur/runall-0258-0263-ae89`, base `8a31367f`) found the shipped VoxCPM worker cannot answer a successful request. `plugins/generations/voxcpm-tts/python/worker.py:322` (`main`) calls `_respond` **only** on the error paths — the oversized-frame guard (`:329`), the malformed-request branch (`:336`), `WorkerError` (`:341`) and the generic `except Exception` (`:343`). A valid `{"id":1,"op":"health"}` or `render` request therefore produces no NDJSON line, and `src/voxcpm-client.ts`'s `pending` map never resolves.

Measured consequences (0258 evidence, `.spur/run/0258-voxcpm-comparison/` and `docs/plans/2026-10-12-voxcpm-audio-comparison.md` §3):

- Traced worker run: `_handle(op=health)` returns `['ok','sample_rate','model']`, `main` then returns 0, and **0 bytes** appear on the protocol channel.
- Real entry: `bun apps/cli/src/index.ts executor run voxcpm-tts --in <docs.json> --out <content.json> --plugins-root <root>` → exit 1 after 61 s with `voxcpm-tts worker startup timed out after 60000ms` (`VOICEBOX_TIMEOUT_MS=60000`). At the default 600 000 ms bound the same invocation hangs for 10 minutes and produces no output file.
- The backend itself is fine: `voxcpm==2.0.3` + torch `2.14.1` load `openbmb/VoxCPM2` (snapshot `32279effe8c19989596f05d353d1447f51d9e915`) on MPS in 17–28 s, `sample_rate=48000`.

Why it escaped: `plugins/generations/voxcpm-tts/tests/test_worker.py` exercises only the error paths (`test_main_handles_malformed_and_unsupported_requests` sends `op: bogus`); no test asserts a successful response from `main`, and the TypeScript tests use a fake worker. The defect ships at HEAD `08689ca5` (task 0256's G14 landing) and blocks G14 scenario R8's matched comparison.

Related: 0258 (evidence, blocked by this), 0256/0257 (owner of the worker).

### Requirements

- [ ] R1. `plugins/generations/voxcpm-tts/python/worker.py`'s `main()` emits exactly one NDJSON success response per accepted request — echoing the request id and carrying that operation's payload (`{ok: true, sample_rate, model}` for `health`, the render result for `render`) — while every existing error, framing and malformed-request path stays byte-identical.
- [ ] R2. `tests/test_worker.py` covers the success path with a fake backend (`health` success shape and `render` success shape through `main()`), with no model download and no network, and the existing 18 cases stay green.
- [ ] R3. The vendor-exclusion, 1 MiB framing, terminal-failure and process-cleanup contracts are unchanged; no new public env knob, flag or profile field is introduced.

### Acceptance Criteria

- [ ] AC1 — A valid `health` request produces exactly one success line (id echoed, `ok: true`, positive `sample_rate`, model provenance) through `main()` with a fake backend. (req: R1, R2)
- [ ] AC2 — A valid `render` request produces its success line through `main()` once `health` has loaded the fake backend. (req: R1, R2)
- [ ] AC3 — The error/framing paths are unchanged: malformed JSON, an unsupported op, a non-integer id and the 1 MiB frame cap still respond as before and the existing test file stays green. (req: R1, R3)
- [ ] AC4 — One bounded live probe of the real entry (`VOICEBOX_TIMEOUT_MS=60000 bun apps/cli/src/index.ts executor run voxcpm-tts --in <docs.json> --out <content.json> --plugins-root <root>`) no longer dies at startup; the observed exit code and output are recorded (hardware-gated — a later inference failure is recorded as a separate finding, not as this fix's failure). (req: R1, R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**WHAT.** Add the missing success-path response in `plugins/generations/voxcpm-tts/python/worker.py`'s `main()` request loop, plus pytest coverage for it in `tests/test_worker.py`.

**WHY.** Without it every valid request is silent, so the adapter's `pending` map never resolves and the invocation dies on its deadline (10-minute hang at the default `VOICEBOX_TIMEOUT_MS`, or an immediate startup timeout at a short bound). G14's comparison (0258/R8) cannot run until this lands.

**WHERE.** `plugins/generations/voxcpm-tts/python/worker.py` — in `main()`, after the existing `try: payload = _handle(state, env, request)` / `except WorkerError` / `except Exception` block, respond with the returned payload: `_respond(stdout, request.get("id"), payload)`. The two `except` branches, the framing guard, the malformed-request branch and `_respond` itself stay untouched. Tests in `plugins/generations/voxcpm-tts/tests/test_worker.py` (monkeypatch `worker._handle` to return a fixed payload — no model, no network).

**Anti-patterns.** Do not restructure the loop, change `_respond`'s shape, add env knobs or profile fields, weaken any error path, or edit `src/voxcpm-client.ts` (it already maps responses by id correctly). Do not "fix" it in the TS layer by synthesizing a response.

**Evidence required.** `uv run --project plugins/generations/voxcpm-tts --locked --group dev pytest plugins/generations/voxcpm-tts/tests/test_worker.py` green including the new cases; the plugin's TypeScript suite (`bun test plugins/generations/voxcpm-tts/tests`) green; then the bounded live probe of AC4 with its observed output recorded.

**Budget.** One implementation pass + the two test runs + one bounded live probe. This is a ~3-line source change with its regression test.

### Plan

- [ ] R1: add the success-path `_respond(stdout, request.get("id"), payload)` after `_handle` returns in `main()`; leave both `except` branches and the framing/malformed guards unchanged.
- [ ] R2: add the two pytest cases (health success shape, render success shape) using a monkeypatched `_handle`; confirm the existing 18 cases still pass.
- [ ] R3: run `uv run --project plugins/generations/voxcpm-tts --locked --group dev pytest plugins/generations/voxcpm-tts/tests/test_worker.py` and `bun test plugins/generations/voxcpm-tts/tests`; both green.
- [ ] AC4: run the bounded live probe (`VOICEBOX_TIMEOUT_MS=60000`, `VOICE_GEN_MP3=true`) and record the observed exit code and output; stop after one diagnosed failure.
- [ ] Close out: re-run the 0258 comparison budget only if the probe renders (0258 owns the comparison evidence and the report).

### Root Cause

Verified by 0258's Step-0 diagnosis: `main()` (`plugins/generations/voxcpm-tts/python/worker.py:322`) has no success-path `_respond`. `_handle` returns the correct payload (`health` → `['ok','sample_rate','model']`, confirmed by tracing), the loop then reaches `return 0`, and the protocol channel stays empty — so `src/voxcpm-client.ts`'s `pending` entry for that id is never resolved and the caller waits out its deadline. The error branches (`:329`, `:336`, `:341`, `:343`) are the only `_respond` call sites, which is why every failure test passed while the plugin could not render anything at all.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
