---
schema_version: 1
name: "Harden voice fallback chain: Voicebox MPS check, bounded gemini-tts timeout/402 fail-fast, and workflow fallback order"
status: todo
template: issue
created_at: 2026-11-21T03:56:34.773Z
updated_at: "2026-11-21T03:58:27.945Z"
feature_id: G13

tags: ["audio", "reliability", "workflow"]
ac_altitude: task-local
ac_numbering: task-local
---

## 0417. Harden voice fallback chain: Voicebox MPS check, bounded gemini-tts timeout/402 fail-fast, and workflow fallback order

### Background

During the 2026-11-20 daily news run, every fallback TTS driver after `voxcpm` failed slowly or ungracefully:
- `gemini-tts` hung for **23m 01s** before exiting 1 while the Gemini project answered HTTP 402 on every call.
- `omni-voice-gen` ran **32m 32s** (and **1h 20m** in an earlier run) before being SIGKILLed with **exit 137** (macOS Jetsam OOM from 2.5B TTS + Whisper ASR in 16 GB RAM).
- `voice-gen` (`Voicebox.app` at `127.0.0.1:17493`) is not in `plugins/kk/workflows/kk-news-generate.yaml`'s fallback chain at all (only manual escape), and silently ran on CPU (`backend_variant: "cpu"`, 5.6x RTF, 3.5 tok/s) when Metal allocation failed under memory pressure.

### Requirements

- [ ] R1. `gemini-tts` enforces a bounded per-segment timeout and fails fast without retrying on non-retryable billing/auth 4xx errors (e.g., HTTP 402, 401, 403).
- [ ] R2. `voice-gen` checks `Voicebox` `/health` on startup and logs a loud warning (or fails fast when configured) if `gpu_available` is true but `backend_variant` is `"cpu"`.
- [ ] R3. Update `plugins/kk/workflows/kk-news-generate.yaml` fallback chain (and `docs/04_DESIGN.md` if surface changes) to include `voicebox` (`voice-gen`) appropriately and guard/deprioritize OOM-prone `omnivoice` on 16 GB hosts.
- [ ] R4. Add unit/regression tests for `gemini-tts` 402 fail-fast + timeout and `voice-gen` CPU-fallback detection.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/kk/workflows/kk-news-generate.yaml` (lines 365-394)
- `apps/cli/src/commands/content-generate.ts` (lines 65-72)
- `.works/dogfood-news-generate-run4.log` (exitCode 137 on `omnivoice`)
- `.works/kk-news-generate/ledger.md` (23m 01s `gemini` hang; 32m-80m `omnivoice` OOM)
- Related: task `0415`, task `0416`

### History
