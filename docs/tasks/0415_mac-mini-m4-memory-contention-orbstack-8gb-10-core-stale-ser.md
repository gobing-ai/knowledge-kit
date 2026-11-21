---
schema_version: 1
name: Mac mini M4 memory contention (OrbStack 8GB/10-core, stale servers) and external SSD offload
status: todo
template: issue
created_at: 2026-11-21T03:56:31.760Z
updated_at: "2026-11-21T03:58:08.156Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Live diagnostics from 2026-11-20 (`vm_stat`, `sysctl vm.swapusage`, `orb config show`, `http://127.0.0.1:17493/health`)
- `.works/kk-news-generate/ledger.md`
- `docs/00_ADR.md` (ADR-042 config vs works split)

### History
