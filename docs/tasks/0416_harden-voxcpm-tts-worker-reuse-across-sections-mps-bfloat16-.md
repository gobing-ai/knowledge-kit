---
schema_version: 1
name: "Harden voxcpm-tts: worker reuse across sections, MPS bfloat16 dtype, fail-fast CPU guard, and stderr diagnostics"
status: todo
template: issue
created_at: 2026-11-21T03:56:33.286Z
updated_at: "2026-11-21T06:07:51.725Z"
feature_id: G13

tags: ["voxcpm", "audio", "perf", "reliability"]
ac_altitude: task-local
ac_numbering: task-local
---

## 0416. Harden voxcpm-tts: worker reuse across sections, MPS bfloat16 dtype, fail-fast CPU guard, and stderr diagnostics

### Background

`voxcpm` (`plugins/generations/voxcpm-tts`) is the primary TTS driver in `plugins/kk/workflows/kk-news-generate.yaml:365`, carrying the 2026-11-18 (9/9 sections, ~120 min) and 2026-11-19 (10/10 sections, ~142 min) episodes. On 2026-11-20, it became unusable: auto device selection fell back to CPU (~19x realtime, ~6 h for a 20-min episode), its worker crashed mid-section with a generic `worker closed stdout`, and earlier runs hit OOM (exit 137).

Hardening `voxcpm-tts` is required before restoring it as the daily primary driver.

### Requirements

- [ ] R1. Eliminate per-section model reloads across an episode render so the ~2.5B VoxCPM model loads once per episode (via persistent worker/socket daemon OR multi-section batch invocation from `daily-stages.ts`).
- [ ] R2. Validate `VOXCPM_MPS_DTYPE="bfloat16"` on Apple M4 hardware (memory footprint, numerical/audio quality, RTF) and wire it into the default macOS/config setup if audio quality passes.
- [ ] R3. Pin `VOXCPM_DEVICE="mps"` (or fail fast on macOS when MPS is requested/expected) instead of silently falling back to ~19x realtime CPU.
- [ ] R4. Capture and surface worker `stderr` (Python traceback / Metal OOM error) in `plugins/generations/voxcpm-tts/src/voxcpm-client.ts` instead of generic `worker closed stdout`.
- [ ] R5. Sync updated `plugins/kk/scripts/` and built `dist/index.js` to the installed global `@gobing-ai/knowledge-kit` package (per `AGENTS.md`) and verify with an episode-scale benchmark targeting <= 2-3x RTF total wall time without OOM.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Single model load across multi-section episode (req: R1)
  Given an episode with >= 2 uncached sections rendered via `voxcpm-tts`
  When `daily-stages` renders the episode sections
  Then the VoxCPM model is loaded exactly once for the batch/episode and subsequent sections incur zero cold-load delay

Scenario: AC2 — bfloat16 on M4 reduces memory without audio regression (req: R2)
  Given `VOXCPM_DEVICE="mps"` and `VOXCPM_MPS_DTYPE="bfloat16"` on the M4 Mac mini (after OrbStack 2 GB cap)
  When a multi-segment probe and full-episode render run
  Then peak worker memory stays within budget (~5-6 GB, no exit 137 OOM) and output audio passes QC/listening verification

Scenario: AC3 — Fail-fast on MPS unavailability (req: R3)
  Given `VOXCPM_DEVICE="mps"` is configured and MPS cannot be initialized
  When `voxcpm-tts` starts rendering
  Then the worker exits nonzero immediately with a clear MPS error instead of falling back to CPU

Scenario: AC4 — Actionable stderr on worker crash (req: R4)
  Given the Python worker crashes or is killed mid-render
  When `voxcpm-client.ts` handles the closed stdout pipe
  Then the thrown error includes the captured tail of worker `stderr` and exit code/signal

Scenario: AC5 — Gate and installed package sync pass (req: R5)
  Given all code and config changes are complete
  When `bun run gate` and installed-package sync (`bun run tools:fresh`) run
  Then all tests, lint, build, and freshness checks pass
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Execution record — 2026-11-20 (batch run 0415–0419)

Nothing in this task's source was changed in this session; the root causes were confirmed against
the code and the live host so refine starts from evidence, not from the task's assumptions:

- **R1 confirmed, and it is a real refactor.** `plugins/kk/scripts/daily-stages.ts:1686-1700`
  synthesizes sections in a `for` loop, one `kk executor run <driver>` subprocess per section, and
  `plugins/generations/voxcpm-tts/src/index.ts:32` spawns a fresh `uv` worker and kills it in
  `finally` — so the ~2.5 B model reloads per section. Option A (batch invocation) needs a
  multi-Doc input contract in `voxcpm-tts` (`processGeneratorIO` currently maps one `--in`/`--out`
  pair) plus the per-section sidecar/cache keys and the one-retry-per-section policy
  (`daily-stages.ts:1700-1730`) re-expressed for a batch. That is a design change to two units, not
  a local edit.
- **R2/R5 cannot be certified tonight.** Both need the model on MPS and a full-episode benchmark
  (the 2026-11-18/19 episodes measured ~120/142 min). Tasks 0415's memory reclamation landed, so
  the machine now has room, but a 2 h paid render is not something an unattended batch should start
  without the operator watching the quality.
- **The operator already applied a manual workaround** that this task must not silently contradict:
  `~/.config/kk/config.yaml` pins `VOXCPM_DEVICE: "mps"` and raises `VOICEBOX_TIMEOUT_MS` to
  1 200 000 for `voxcpm-tts` (2026-11-20 comment: `auto` resolved to CPU at ~19x realtime, an
  explicit `mps` rendered 6.7 s in 202 s including the ~3 min model load). R3's fail-fast should be
  built on top of that pin, not replace it.
- **R4 is the cheapest real win and is unblocked:** `voxcpm-client.ts:377` throws
  `worker closed stdout before settling all requests` from the stdout pump without the
  `stderrTail`/exit-code/signal that the `exit` handler at `:373` already carries — the exact
  diagnostic gap that made today's mid-section crash opaque.

### Design

Two options for R1 (choose during refinement/implementation):
- **Option A (Batch invocation in `daily-stages.ts`):** Pass all uncached sections into a single `kk executor run voxcpm-tts` multi-doc invocation (or a dedicated batch mode), keeping the worker lifetime bounded to the single command with zero orphan-daemon risk.
- **Option B (Persistent Unix-socket daemon):** Spawn a background `voxcpm` worker on `/tmp/voxcpm.sock` with an idle TTL so repeated `kk executor run voxcpm-tts` calls reuse the loaded model.

Option A is simpler and avoids daemon lifecycle/stale-socket bugs while preserving per-section sidecar caching if sections flush incrementally.

### Plan

1. [ ] Prerequisite: complete task `0415` (OrbStack 2 GB cap) so unified memory is available for MPS testing.
2. [ ] Run a controlled M4 probe with `VOXCPM_DEVICE="mps"` + `VOXCPM_MPS_DTYPE="bfloat16"` measuring load time, RSS/MPS memory, RTF, and audio fidelity.
3. [ ] Update `plugins/generations/voxcpm-tts/src/voxcpm-client.ts` to buffer/surface `stderr` tail + exit signal on worker death, and enforce fail-fast when MPS is unavailable.
4. [ ] Implement single-load worker reuse across sections (batch invocation in `daily-stages.ts` + `voxcpm-tts/src/index.ts`, or persistent worker) with regression tests covering >= 2 sections.
5. [ ] Update `~/.config/kk/config.yaml` (`VOXCPM_MPS_DTYPE: "bfloat16"`, `VOXCPM_DEVICE: "mps"`) and sync `plugins/kk/scripts/` + `dist/index.js` to the global `kk` install.
6. [ ] Run `bun run gate` and benchmark a full-episode render, recording wall time in `Testing`.

### Root Cause

1. **10x redundant cold model loads (25-30 min wasted per episode):** `plugins/kk/scripts/daily-stages.ts:1700` invokes `kk executor run voxcpm-tts` once per section in a sequential loop, while `plugins/generations/voxcpm-tts/src/index.ts:25-35` spawns a fresh Python worker via `uv` and unconditionally kills it in `finally` (`await handle.close()`). Each load takes ~2.5-3 min.
2. **`float32` memory explosion on MPS (~10 GB RAM):** `voxcpm/model/utils.py:145-165` (`pick_runtime_dtype`) forces `float32` on MPS when `configured_dtype` is a low-precision dtype unless `VOXCPM_MPS_DTYPE` is overridden. On a 16 GB Mac mini, ~10 GB in PyTorch MPS buffers triggers OOM/Jetsam kills.
3. **Silent CPU fallback & opaque crash diagnostics:** `device: auto` silently drops to 19x CPU instead of failing fast when MPS is unavailable; `voxcpm-client.ts` reports generic `worker closed stdout` without surfacing the underlying Python traceback / Metal allocation error from `stderr`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/generations/voxcpm-tts/src/index.ts` (lines 25-35)
- `plugins/generations/voxcpm-tts/src/voxcpm-client.ts`
- `plugins/kk/scripts/daily-stages.ts` (lines 1643, 1700, 1819)
- `plugins/kk/workflows/kk-news-generate.yaml` (line 365)
- `~/.config/kk/config.yaml` (lines 104-111)
- Related: task `0415` (memory reclamation), task `0417` (fallback chain)

### History
