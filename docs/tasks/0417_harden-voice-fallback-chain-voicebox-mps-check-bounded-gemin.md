---
schema_version: 1
name: "Harden voice fallback chain: Voicebox MPS check, bounded gemini-tts timeout/402 fail-fast, and workflow fallback order"
status: done
template: issue
created_at: 2026-11-21T03:56:34.773Z
updated_at: "2026-11-21T06:06:07.000Z"
feature_id: G13

tags: ["audio", "reliability", "workflow"]
ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0417. Harden voice fallback chain: Voicebox MPS check, bounded gemini-tts timeout/402 fail-fast, and workflow fallback order

### Background

During the 2026-11-20 daily news run, every fallback TTS driver after `voxcpm` failed slowly or ungracefully:
- `gemini-tts` hung for **23m 01s** before exiting 1 while the Gemini project answered HTTP 402 on every call.
- `omni-voice-gen` ran **32m 32s** (and **1h 20m** in an earlier run) before being SIGKILLed with **exit 137** (macOS Jetsam OOM from 2.5B TTS + Whisper ASR in 16 GB RAM).
- `voice-gen` (`Voicebox.app` at `127.0.0.1:17493`) is not in `plugins/kk/workflows/kk-news-generate.yaml`'s fallback chain at all (only manual escape), and silently ran on CPU (`backend_variant: "cpu"`, 5.6x RTF, 3.5 tok/s) when Metal allocation failed under memory pressure.

### Requirements

- [x] R1. `gemini-tts` enforces a bounded per-segment timeout and fails fast without retrying on non-retryable billing/auth 4xx errors (e.g., HTTP 402, 401, 403).
- [x] R2. `voice-gen` checks `Voicebox` `/health` on startup and logs a loud warning (or fails fast when configured) if `gpu_available` is true but `backend_variant` is `"cpu"`.
- [x] R3. Update `plugins/kk/workflows/kk-news-generate.yaml` fallback chain (and `docs/04_DESIGN.md` if surface changes) to include `voicebox` (`voice-gen`) appropriately and guard/deprioritize OOM-prone `omnivoice` on 16 GB hosts.
- [x] R4. Add unit/regression tests for `gemini-tts` 402 fail-fast + timeout and `voice-gen` CPU-fallback detection.

### Acceptance Criteria

```gherkin
Scenario: AC1 — gemini-tts fails fast on HTTP 402 and honors per-segment timeout (req: R1, R4)
  Given `gemini-tts` receives HTTP 402 (or a stalled connection exceeding the per-segment timeout)
  When a segment render is attempted
  Then `gemini-tts` exits nonzero immediately without multi-minute retry loops and surfaces the HTTP status/timeout reason

Scenario: AC2 — voice-gen detects silent CPU fallback on Voicebox (req: R2, R4)
  Given Voicebox `/health` returns `gpu_available: true` and `backend_variant: "cpu"`
  When `voice-gen` probes health before rendering
  Then `voice-gen` surfaces an explicit CPU-fallback warning/error so 5.6x RTF degradation is never silent

Scenario: AC3 — Workflow fallback chain includes voicebox and avoids silent OOM stalls (req: R3)
  Given primary `voxcpm` fails in `kk-news-generate.yaml`
  When the workflow advances through fallback engines
  Then fallback order routes cleanly without spending 23+ min on 402 retries or 80 min on Jetsam OOM before reaching a working local fallback
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- Keep error classification explicit in `gemini-tts`: HTTP 401/402/403 are terminal (zero retries); 429/5xx use bounded retries with a strict per-segment timeout.
- In `voice-gen`, parse `backend_variant` from `/health` alongside `status`; add an opt-in strict env flag (e.g., `VOICEBOX_REQUIRE_GPU=1`) or explicit warning.
- Coordinate workflow fallback order (`voxcpm -> voicebox -> gemini` or `voxcpm -> gemini (fast-fail) -> voicebox`) with operator preference; sync updated `plugins/kk/workflows/` to the installed package.

### Plan

1. [ ] Inspect `plugins/generations/gemini-tts/` retry/timeout logic; add fail-fast for HTTP 401/402/403 and bounded per-segment timeout.
2. [ ] Inspect `plugins/generations/voice-gen/` health probe; detect `gpu_available: true` + `backend_variant: "cpu"` and surface actionable diagnostic/guard.
3. [ ] Update `plugins/kk/workflows/kk-news-generate.yaml:365-394` fallback chain and sync installed workflows.
4. [ ] Add regression tests in `plugins/generations/gemini-tts/tests/` and `plugins/generations/voice-gen/tests/`.
5. [ ] Run `bun run gate` and `bun run tools:fresh`.

### Root Cause

1. `plugins/generations/gemini-tts`: unbounded retry/timeout loop on HTTP 402 / rate-limit errors causes 20+ min hangs instead of fast fail-over.
2. `plugins/generations/voice-gen`: does not inspect `backend_variant` from `Voicebox` `/health` (`gpu_available: true, backend_variant: "cpu"`), silently burning 50-60 min on CPU.
3. `plugins/kk/workflows/kk-news-generate.yaml:365-394`: fallback order is `voxcpm -> gemini -> omnivoice`; `voicebox` (`voice-gen`) is missing as a local fallback, while `omnivoice` reliably OOMs on 16 GB hosts.

### Solution

| File | What / why |
| --- | --- |
| `plugins/generations/gemini-tts/src/gemini-client.ts:16` | `TERMINAL_STATUSES` names 400/401/402/403/404 as non-retryable, so a depleted project's blanket HTTP 402 stops being retried (R1). |
| `plugins/generations/gemini-tts/src/gemini-client.ts:89` | `GEMINI_TTS_SEGMENT_TIMEOUT_MS` (default 180 s) is the one wall-clock ceiling for a segment; `post` clamps each attempt and its backoff to the remaining budget so the per-request timeout can no longer be multiplied by the attempt cap (R1). |
| `plugins/generations/gemini-tts/src/gemini-client.ts:138` | The terminal-status branch fails fast with the HTTP status and API message instead of sleeping through four tries (R1). |
| `plugins/generations/voice-gen/src/voicebox-client.ts:76` | `detectCpuFallback` reads the `/health` payload and flags `gpu_available: true` with a non-GPU `backend_variant` — the exact shape Voicebox answered on 2026-11-20 while rendering at ~5.6x RTF (R2). |
| `plugins/generations/voice-gen/src/voicebox-client.ts:133` | `health()` now inspects the payload it used to discard: a CPU fallback logs a loud warning, and `VOICEBOX_REQUIRE_GPU=1` makes it fatal. A non-JSON or partial body stays non-fatal (R2). |
| `plugins/kk/workflows/kk-news-generate.yaml:367` | New `voice-fallback-box` node puts the local Voicebox renderer (`--engine voicebox`) between `voxcpm` and the cloud engines; `voice-fallback` (gemini) and `voice-fallback2` (omnivoice) are re-pointed behind it, so a local engine is tried before paid calls and the OOM-prone one stays last (R3). |
| `apps/cli/tests/kk-news-generate-dag.test.ts:71` | DAG expectations carry the new node id, its `kk news generate-voice --engine voicebox` body, the 23-node count, and the re-pointed `dependsOn` chain (R3). |
| `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:270` | Regression: 401/402/403 fail with zero sleeps and one call, and a stalling endpoint is bounded by the segment budget instead of the attempt cap (R4). |
| `plugins/generations/voice-gen/tests/voicebox-health.test.ts:1` | Regression: `detectCpuFallback` matrix, the warning path, the `VOICEBOX_REQUIRE_GPU` hard failure, and the non-JSON/HTTP-error non-regressions (R4). |
| `docs/04_DESIGN.md:1626` | Surface doc: `VOICEBOX_REQUIRE_GPU` and `GEMINI_TTS_SEGMENT_TIMEOUT_MS` rows, plus the terminal-4xx rule on the gemini row (T3). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `gemini-tts` bounded per-segment timeout + no retry on non-retryable auth/billing 4xx | MET | `plugins/generations/gemini-tts/src/gemini-client.ts:16` (terminal 400/401/402/403/404), `:89` (segment budget), `:96-117` (deadline clamps every attempt and its backoff), `:138` (fail-fast branch); regression `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:262` (401/402/403: 1 call, 0 sleeps) and `:283` (20-attempt cap cut to ≤2 calls inside a 250 ms budget) |
| R2 — `voice-gen` inspects `/health` and reports a silent CPU fallback (warn, or fail when configured) | MET | `plugins/generations/voice-gen/src/voicebox-client.ts:76` (`detectCpuFallback`), `:84` (`requireGpu`), `:133-141` (warning / hard failure, non-JSON body stays non-fatal); regression `plugins/generations/voice-gen/tests/voicebox-health.test.ts:30-70` |
| R3 — `kk-news-generate` fallback chain includes voicebox and deprioritizes the OOM-prone engine | MET | `plugins/kk/workflows/kk-news-generate.yaml:367` (new `voice-fallback-box`, `--engine voicebox`), `:387-404` (gemini then omnivoice re-pointed behind it); regression `apps/cli/tests/kk-news-generate-dag.test.ts:71,167,253-262` (node inventory, engine body, `onError`, chain edges) |
| R4 — unit/regression coverage for the 402 fail-fast, the timeout, and the CPU-fallback detection | MET | `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:262,283`; `plugins/generations/voice-gen/tests/voicebox-health.test.ts:30`; full gate PASS (`spur task gate 0417 run`, 1 attempt, 60/60 pre rules, lcov complete) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — gemini-tts fails fast on HTTP 402 and honors per-segment timeout | MET | test | `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:262` (402/401/403 → one call, zero backoff sleeps, status + API message in the error), `:283` (stalling endpoint bounded by `GEMINI_TTS_SEGMENT_TIMEOUT_MS`, not by the attempt cap) |
| AC2 — voice-gen detects silent CPU fallback on Voicebox | MET | test | `plugins/generations/voice-gen/tests/voicebox-health.test.ts:44` (live 2026-11-20 payload → loud warning naming 5.6x RTF), `:52` (`VOICEBOX_REQUIRE_GPU=1` → hard failure), `:58` (MPS backend silent, non-JSON body tolerated) |
| AC3 — workflow fallback chain includes voicebox and avoids silent OOM stalls | MET | test | `apps/cli/tests/kk-news-generate-dag.test.ts:253` (voicebox attempt joins the chain with `onError: continue`), `:258-262` (order `voice → voicebox → gemini → omnivoice`, omnivoice last and loud, every fallback gated on the same missing-verdict condition) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: **PASS** (evidence: `.spur/memory/evidence/0417-verdict.json`)

| Lens | Result |
| --- | --- |
| Functional traceability | R1–R4 all MET — terminal-4xx fail-fast + segment budget (`gemini-client.ts:16,89,138`), CPU-fallback guard (`voicebox-client.ts:76,133`), voicebox in the DAG chain (`kk-news-generate.yaml:367`), regressions in both plugins plus the DAG test. |
| SECUA | No new input or credential surface; error paths keep status + API message; the budget clamps the backoff, so the worst case is bounded by one segment budget rather than attempts × timeout. |
| Architecture | The fallback rule sits in the client that owns the `/health` contract; engine order stays in the workflow DAG where retry policy already lives. |

Findings: **P3** — `requireGpu` reads `process.env` instead of an injected env (untestable without
mutating process env; matches the file's existing `resolveVoiceboxTimeoutMs` precedent, so left
as-is). **P4** — `TERMINAL_STATUSES` also classifies 400/404 as terminal; if a future endpoint makes
400 retryable, that classification must move rather than grow. No open P1–P3 blockers.

Residual risk: `AC3`'s "routes cleanly without 23+ min" is proven by the chain-order test plus
AC1's fail-fast regression, not by a live fail-over episode — the next real episode that loses
`voxcpm` is the end-to-end evidence.

### References

- `plugins/kk/workflows/kk-news-generate.yaml` (lines 365-394)
- `apps/cli/src/commands/content-generate.ts` (lines 65-72)
- `.works/dogfood-news-generate-run4.log` (exitCode 137 on `omnivoice`)
- `.works/kk-news-generate/ledger.md` (23m 01s `gemini` hang; 32m-80m `omnivoice` OOM)
- Related: task `0415`, task `0416`

### History

- 2026-11-21T04:14:31.478Z todo → wip (system)
- 2026-11-21T06:06:05.095Z wip → testing (system)
- 2026-11-21T06:06:06.993Z testing → done (system)

