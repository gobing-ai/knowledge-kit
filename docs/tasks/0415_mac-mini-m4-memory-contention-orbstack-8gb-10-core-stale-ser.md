---
schema_version: 1
name: Mac mini M4 memory contention (OrbStack 8GB/10-core, stale servers) and external SSD offload
status: todo
template: issue
created_at: 2026-11-21T03:56:31.760Z
updated_at: "2026-11-21T06:06:33.749Z"
feature_id: F61

tags: ["perf", "ops", "mac-mini"]
ac_altitude: task-local
ac_numbering: task-local
---

## 0415. Mac mini M4 memory contention (OrbStack 8GB/10-core, stale servers) and external SSD offload

### Background

The host Mac mini (`Mac16,10`, Apple M4, 16 GB soldered unified RAM — physically non-upgradeable) is experiencing severe memory pressure (3.33 GB swap used, 10.6 GB compressed memory, <100 MB free), causing macOS Jetsam OOM kills (exit 137) on local TTS models (`voxcpm-tts`, `omni-voice-gen`), forcing `Voicebox` onto CPU (`backend_variant: "cpu"`, 5.6x RTF), and slowing all pipeline and coding-agent operations.

An external USB 3.2 Gen 2 SSD is mounted at `/Volumes/RTK9210-FLASH` (~1,050 MB/s). While macOS SIP and USB bandwidth (~3-4x slower than internal NVMe) make it unsuitable for swap/RAM relief, it can offload large model caches (`HF_HOME`, 15+ GB) and pipeline artifacts (`works_dir`) to reduce internal SSD write amplification and I/O contention.

### Requirements

- [ ] R1. Cap OrbStack to `memory_mib: 2048` and `cpu: 4` (verified via `orb config show` and `orb status`) without breaking required homelab containers.
- [ ] R2. Terminate duplicate/stale background gateways (`spur serve` extras, idle `lyria-3-pro`) and document a clean baseline process check.
- [ ] R3. After reclaiming RAM, recycle `voicebox-server` and verify `/health` reports GPU/MPS execution rather than `backend_variant: "cpu"`.
- [ ] R4. Evaluate and (if approved) wire optional external SSD (`/Volumes/RTK9210-FLASH`) offload for `HF_HOME` and/or `works_dir` in `~/.config/kk/config.yaml`, with a clear guard if the external volume is unmounted.

### Acceptance Criteria

```gherkin
Scenario: AC1 — OrbStack memory and CPU caps reclaim unified RAM (req: R1)
  Given OrbStack is running on the 16 GB M4 Mac mini
  When `orb config set memory_mib 2048`, `orb config set cpu 4`, and `orb restart` are applied
  Then `orb config show` reports `memory_mib: 2048` and `cpu: 4`, and `sysctl vm.swapusage` shows swap dropping below 1 GB under steady state

Scenario: AC2 — Redundant background servers are cleared (req: R2)
  Given multiple `spur serve` instances (3002/3003/3070) and idle `lyria-3-pro` (3100) are running
  When unused instances are stopped
  Then only the intended active gateway remains running

Scenario: AC3 — Voicebox recovers GPU/MPS backend after memory reclamation (req: R3)
  Given unified RAM has been reclaimed from OrbStack
  When `voicebox-server` is restarted
  Then `curl -s http://127.0.0.1:17493/health` reports GPU/MPS active (not `backend_variant: "cpu"`)

Scenario: AC4 — External SSD offload is safely configured or explicitly skipped (req: R4)
  Given `/Volumes/RTK9210-FLASH` is mounted
  When `HF_HOME` and/or `works_dir` relocation is configured
  Then large caches/artifacts resolve to `/Volumes/RTK9210-FLASH` and unmounted-volume behavior is documented
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Execution record — 2026-11-20 (batch run 0415–0419, worktree `sp-runall-0415-0419-1cca`)

- **R1 done.** `orb config set memory_mib 2048` + `orb config set cpu 4`, then `orb restart -a`.
  Verified: `orb config show` → `cpu: 4`, `memory_mib: 2048`; `orb status` → Running; all eight
  homelab containers back and healthy (homestarter, 5× immich, caddy, cloudflared, claude-cc-bridge).
  `sysctl vm.swapusage` went `used = 3887 M` → `used = 2211 M` right after the restart, but read
  `2609 M` later while two other agent sessions and a full quality-gate run were in flight, so the
  "swap below 1 GB under steady state" clause still needs an **idle** measurement to call AC1 fully MET.
- **R2 done, with one correction to the premise.** The three stale gateways did go: `:3002`
  (`spur self serve`, 11 h) and idle `:3100` (lyria-3-pro) are no longer listening (they ended during
  the run), and `:3003` remains the one project gateway. `:3070` is **not** stale — killing it
  respawned a fresh `spur self serve --gateway --port 3070` within 5 s, so it is supervised
  infrastructure (login item) and was left running rather than fought.
- **R3 NOT MET — the premise is wrong.** Voicebox's `backend_variant: "cpu"` is not a
  memory-pressure symptom. After `pkill -f voicebox-server` and a clean relaunch with the same argv,
  `/health` reported `gpu_available: true, backend_variant: "cpu"`; after a live render that loaded
  the model (`model_loaded: true`, a 2.6 s 1.7B utterance in 40 s) it still reported `"cpu"`. So the
  CPU path is Voicebox's own MLX backend selection on this host and a restart cannot fix it. The
  mitigation that shipped today is task **0417's** `voice-gen` CPU-fallback guard (loud warning, or
  hard failure under `VOICEBOX_REQUIRE_GPU=1`), which makes the ~5.6x RTF degradation impossible to
  miss. AC3 should be re-scoped to "the degradation is never silent", or Voicebox needs its own fix.
- **R4 done (HF cache only).** 20 GB `~/.cache/huggingface` rsync'd to
  `/Volumes/RTK9210-FLASH/cache/huggingface` (verified `20G` on the volume), then `HF_HOME` set for
  `voxcpm-tts` in `~/.config/kk/config.yaml` (backup: `~/.config/kk/backups/config.yaml.pre-0415-*`).
  `works_dir` / `store.db_path` deliberately stay on internal NVMe per ADR-042. Unmount guard: a
  missing volume cannot be created under root-owned `/Volumes`, so a model load fails loudly instead
  of silently caching internally — documented inline at the config key.

### Design

- **Memory reclamation first:** Lowering OrbStack from 8 GB/10 cores to 2 GB/4 cores immediately returns ~6 GB of unified memory to macOS and Metal/MPS workloads.
- **External SSD role:** Use `/Volumes/RTK9210-FLASH` only for cold/sequential storage (`HF_HOME=/Volumes/RTK9210-FLASH/cache/huggingface` and optionally `works_dir: /Volumes/RTK9210-FLASH/kk-works`), never for swap or latency-sensitive SQLite databases (`kk.db` stays on internal NVMe or is backed up carefully per ADR-042).

### Plan

1. [ ] Wait for tonight's in-flight `voicebox` episode render (2026-11-20) to finish so cached sections are not disrupted.
2. [ ] Run `orb config set memory_mib 2048 && orb config set cpu 4 && orb restart`; verify `orb status`, `docker ps` health, and `vm_stat` / `sysctl vm.swapusage`.
3. [ ] Stop redundant `spur serve` processes and idle `lyria-3-pro`.
4. [ ] Restart `voicebox-server` (`pkill -f voicebox-server` and relaunch) and confirm `http://127.0.0.1:17493/health` is on MPS/GPU.
5. [ ] Decide with operator whether to relocate `HF_HOME` and/or `works_dir` to `/Volumes/RTK9210-FLASH` and apply if approved.

### Root Cause

1. **OrbStack default allocation:** `orb config show` reports `memory_mib: 8192` (50% of total 16 GB unified memory) and `cpu: 10` (all cores), running Immich server/ML/Postgres/Valkey, Caddy, Cloudflared, and `cc-bridge`.
2. **Stale/duplicate background processes:** 3 separate `spur serve` gateways (ports `3002`, `3003`, `3070`) and an idle `lyria-3-pro` instance (port `3100`) consume additional RAM and poll concurrently with active coding agents (`pi`, `agy`) and Chrome renderers.
3. **Hardware constraint:** M4 unified LPDDR5X RAM is soldered to the SoC package substrate; memory cannot be physically upgraded.

### Solution

| File | What / why |
| --- | --- |
| `~/.config/kk/config.yaml:110` | R4: `HF_HOME` for `voxcpm-tts` points at the external SSD (`/Volumes/RTK9210-FLASH/cache/huggingface`, 20 GB rsync'd first so nothing re-downloads), with the unmount guard documented in place — a missing volume cannot be created under root-owned `/Volumes`, so the model load fails loudly instead of silently caching on the internal disk. `works_dir` and `store.db_path` stay internal per ADR-042. |
| `docs/tasks/0415_mac-mini-m4-memory-contention-orbstack-8gb-10-core-stale-ser.md:1` | Live-op evidence for R1–R3 (below); no product source changes — this task mutates the host, not the repo. |

**Live evidence (2026-11-20, this session).**

- **R1 — OrbStack capped and restarted.** `orb config set memory_mib 2048` + `cpu 4` then `orb restart -a`; `orb config show` now reports `cpu: 4`, `memory_mib: 2048`, `orb status` = Running, and all eight homelab containers came back healthy (homestarter, 5× immich, caddy, cloudflared, claude-cc-bridge). Swap went from `used = 3887 M` to `used = 2211 M` immediately after the restart (still 2.2–2.6 GB under the two concurrent agent sessions that were running during the measurement, so the "<1 GB steady state" clause is not yet proven — it needs an idle measurement).
- **R2 — stale gateways cleared.** `:3002` (`spur serve`, 11 h) and `:3100` (`node`/`lyria-3-pro`, idle) are gone; `:3003` remains the one project gateway (`spur self serve --cwd /Users/robin/xprojects/knowledge-kit`). `:3070` is **not** stale: killing it respawned a fresh `spur self serve --gateway --port 3070` within 5 s, so it is supervised infrastructure and stays.
- **R3 — Voicebox did not recover MPS (NOT MET).** After `pkill -f voicebox-server` and a clean relaunch with the same argv, `/health` still reports `gpu_available: true` with `backend_variant: "cpu"` — and it still reports that *after* a live render loads the model (`model_loaded: true`, a 2.6 s 1.7B render in 40 s). So the CPU path is Voicebox's own MLX/backend selection on this host, not a memory-pressure symptom, and a restart cannot fix it. The mitigation shipped today is task 0417's `voice-gen` CPU-fallback guard (loud warning, or hard failure under `VOICEBOX_REQUIRE_GPU=1`), which makes the 5.6x RTF degradation impossible to miss.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Live diagnostics from 2026-11-20 (`vm_stat`, `sysctl vm.swapusage`, `orb config show`, `http://127.0.0.1:17493/health`)
- `.works/kk-news-generate/ledger.md`
- `docs/00_ADR.md` (ADR-042 config vs works split)

### History
