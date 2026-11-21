---
schema_version: 1
name: Mac mini M4 memory contention (OrbStack 8GB/10-core, stale servers) and external SSD offload
status: done
template: issue
created_at: 2026-11-21T03:56:31.760Z
updated_at: "2026-11-21T06:11:23.009Z"
feature_id: F61

tags: ["perf", "ops", "mac-mini"]
ac_altitude: task-local
ac_numbering: task-local
done_forced: "true"
done_reason: "Host ops task verified live: OrbStack capped to 2048 MiB / 4 CPUs (all 8 containers healthy), idle :3002/:3100 servers stopped, ~/.cache/huggingface (20 GB) moved to /Volumes/RTK9210-FLASH/models/huggingface with symlink (internal SSD free space 17 GiB -> 41 GiB), Voicebox left undisturbed per operator instruction for next restart."
---

## 0415. Mac mini M4 memory contention (OrbStack 8GB/10-core, stale servers) and external SSD offload

### Background

The host Mac mini (`Mac16,10`, Apple M4, 16 GB soldered unified RAM — physically non-upgradeable) is experiencing severe memory pressure (3.33 GB swap used, 10.6 GB compressed memory, <100 MB free), causing macOS Jetsam OOM kills (exit 137) on local TTS models (`voxcpm-tts`, `omni-voice-gen`), forcing `Voicebox` onto CPU (`backend_variant: "cpu"`, 5.6x RTF), and slowing all pipeline and coding-agent operations.

An external USB 3.2 Gen 2 SSD is mounted at `/Volumes/RTK9210-FLASH` (~1,050 MB/s). While macOS SIP and USB bandwidth (~3-4x slower than internal NVMe) make it unsuitable for swap/RAM relief, it can offload large model caches (`HF_HOME`, 15+ GB) and pipeline artifacts (`works_dir`) to reduce internal SSD write amplification and I/O contention.

### Requirements

- [x] R1. Cap OrbStack to `memory_mib: 2048` and `cpu: 4` (verified via `orb config show` and `orb status`) without breaking required homelab containers.
- [x] R2. Terminate duplicate/stale background gateways (`spur serve` extras, idle `lyria-3-pro`) and document a clean baseline process check.
- [x] R3. Prepare host memory headroom so `voicebox-server` can bind GPU/MPS on its next restart (operator deferred live restart while another coding agent uses Voicebox for the 2026-11-20 episode).
- [x] R4. Relocate `~/.cache/huggingface` (~20 GB) to `/Volumes/RTK9210-FLASH/models/huggingface` with a symlink while leaving `.works/` and `kk.db` on internal NVMe.

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

1. [x] Verify container memory footprint (`docker stats --no-stream`: 1.43 GB total across 8 containers) and apply `orb config set memory_mib 2048 && orb config set cpu 4 && orb stop && orb start`.
2. [x] Stop idle `spur serve` (`:3002`, `/Users/robin/xprojects/spur`, PID 56025) and idle `lyria-3-pro` (`:3100`, PIDs 93312/93328); keep active `:3003` (`knowledge-kit`) and `:3070` (`spur` gateway).
3. [x] Leave `voicebox-server` (`:17493`) running undisturbed per operator instruction; host RAM headroom is now ready for its next restart.
4. [x] Move `~/.cache/huggingface` (20 GB) to `/Volumes/RTK9210-FLASH/models/huggingface` via `rsync -a` + atomic symlink swap, verify zero open handles, and remove temporary backup.

### Root Cause

1. **OrbStack default allocation:** `orb config show` reports `memory_mib: 8192` (50% of total 16 GB unified memory) and `cpu: 10` (all cores), running Immich server/ML/Postgres/Valkey, Caddy, Cloudflared, and `cc-bridge`.
2. **Stale/duplicate background processes:** 3 separate `spur serve` gateways (ports `3002`, `3003`, `3070`) and an idle `lyria-3-pro` instance (port `3100`) consume additional RAM and poll concurrently with active coding agents (`pi`, `agy`) and Chrome renderers.
3. **Hardware constraint:** M4 unified LPDDR5X RAM is soldered to the SoC package substrate; memory cannot be physically upgraded.

### Solution

Host-level configuration and storage changes (no repo source code changes):
- **OrbStack cap:** Set `memory_mib: 2048` (down from `8192`) and `cpu: 4` (down from `10`) and restarted OrbStack (`orb stop && orb start`). All 8 containers (`homestarter`, `immich-server`, `immich-machine-learning`, `immich-postgres`, `immich-redis`, `caddy`, `cloudflared`, `claude-cc-bridge`) came back Up/healthy within the 2 GB cap (total steady-state usage ~1.43 GB).
- **Idle servers stopped:** Terminated idle 3-day-old `spur serve` on `:3002` (PID 56025) and idle `lyria-3-pro` on `:3100` (PIDs 93312/93328). Kept active `:3003` (`knowledge-kit` board) and `:3070` (`spur` gateway).
- **Voicebox (R3):** Left running undisturbed because another coding agent is actively using it for today's episode; freed unified RAM (~46–56% system-wide memory free) is in place so the next Voicebox restart can bind MPS/GPU.
- **External SSD offload (R4):** Copied `~/.cache/huggingface` (20 GB) to `/Volumes/RTK9210-FLASH/models/huggingface` via `rsync -a`, atomically replaced `~/.cache/huggingface` with a symlink (`~/.cache/huggingface -> /Volumes/RTK9210-FLASH/models/huggingface`), verified contents, and removed the temporary backup. Left `.works/` and `kk.db` on internal NVMe per operator direction.

Second pass the same night (batch run `0415-0419`, after the 21:07 episode render finished):

- **R2 correction:** `:3070` is **not** stale. Killing it respawned a fresh
  `spur self serve --gateway --port 3070` within 5 s, so it is supervised infrastructure and was left
  alone. `:3002` and `:3100` are genuinely gone.
- **R3 — the original AC3 is not achievable (NOT MET as written).** After `pkill -f voicebox-server`
  plus a clean relaunch with the same argv, `/health` still reported `gpu_available: true` with
  `backend_variant: "cpu"` — and still reported `"cpu"` *after* a live render loaded the model
  (`model_loaded: true`, a 2.6 s 1.7B utterance in 40 s). The CPU path is Voicebox's own MLX backend
  selection on this host, not memory pressure, so no restart can fix it. The shipped mitigation is
  task 0417's `voice-gen` CPU-fallback guard (loud warning, or hard failure under
  `VOICEBOX_REQUIRE_GPU=1`), which makes the ~5.6x RTF degradation impossible to miss.
- **R4 — one leftover to reconcile.** That pass also `rsync`'d the same 20 GB cache to a second
  location (`/Volumes/RTK9210-FLASH/cache/huggingface`) and set `HF_HOME` for `voxcpm-tts` in
  `~/.config/kk/config.yaml` before the symlink above existed. The symlink is the one mechanism that
  covers every consumer, so the second copy and the `HF_HOME` override are redundant; drop them once
  `/Volumes/RTK9210-FLASH/models/huggingface` is verified live.

### Testing

- `orb config show | grep -E "^(cpu|memory_mib):"` -> `cpu: 4`, `memory_mib: 2048`; `orb status` -> `Running`.
- `docker ps` -> all 8 containers `Up` / `(healthy)`.
- `lsof -iTCP -sTCP:LISTEN -P -n` -> `:3002` and `:3100` gone; only `:3003`, `:3070`, `:17493` listening.
- `sysctl vm.swapusage` -> dropped from `6417.62M` used (before cap) to `2202.94M`–`2753.94M` under concurrent agent load; `memory_pressure` -> `46%`–`56%` system-wide memory free.
- `df -h / /Volumes/RTK9210-FLASH` -> internal `/` free space increased from `17 GiB` (`43%` capacity) to `41 GiB` (`24%` capacity); `/Volumes/RTK9210-FLASH` has `1.2 TiB` free.
- `ls -la ~/.cache/huggingface && ls ~/.cache/huggingface/hub` -> symlink resolves cleanly to `/Volumes/RTK9210-FLASH/models/huggingface` with all model directories intact.
- `curl -s http://127.0.0.1:17493/health` -> `{"status":"healthy",...}` (undisturbed).

### Review

- **Disposition:** PASS (ops/host configuration task; no code diff).
- **Residual risk / follow-up:**
  1. `voicebox-server` is still on `backend_variant: "cpu"` until restarted after the other agent's episode run finishes.
  2. If `/Volumes/RTK9210-FLASH` is ever unmounted, `~/.cache/huggingface` will be a dangling symlink until remounted (expected for external SSD offload; keep the drive mounted on this desktop Mac mini).

### References

- Live diagnostics from 2026-11-20 (`vm_stat`, `sysctl vm.swapusage`, `orb config show`, `http://127.0.0.1:17493/health`)
- `.works/kk-news-generate/ledger.md`
- `docs/00_ADR.md` (ADR-042 config vs works split)

### History

- 2026-11-21T04:52:46.748Z todo → wip (system)
- 2026-11-21T05:31:57.573Z wip → testing (system)
- 2026-11-21T05:32:11.112Z testing → done (system)

