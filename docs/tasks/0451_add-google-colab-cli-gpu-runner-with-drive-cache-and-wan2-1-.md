---
schema_version: 1
name: Add google-colab-cli GPU runner with Drive cache and Wan2.1 I2V provider
status: todo
template: feature-impl
created_at: 2026-11-26T19:50:42.669Z
updated_at: "2026-11-26T23:19:09.716Z"
feature_id: D9
priority: P2
tags:
  - M2
  - colab
  - wan21
  - video-gen
estimate_hours: 8

dependencies: ["0448", "0449"]
---

## 0451. Add google-colab-cli GPU runner with Drive cache and Wan2.1 I2V provider

### Background

Milestone 2 Colab GPU integration for Feature D9 (ADR-060, docs/design/short-form-video-promotion.md §4-5). Adds an isolated google-colab-cli batch runner with Google Drive weight caching, unconditional teardown, and rolling CCU budget tracking, then plugs Wan2.1 I2V 3-5s motion loops into video-gen's editorial mode with automatic fallback to local Ken-Burns.

Implements: R5 — Editorial mode falls back to local Ken-Burns when Colab Wan2.1 I2V fails or exceeds budget; R6 — Colab GPU runner executes headless jobs with Google Drive weight caching and teardown guards; R7 — Editorial mode composites Colab Wan2.1 I2V motion loops inside the shared Remotion shell.

**Refine corrections (2026-11-26)** — `/sp:dev-refine --all --feature D9 --auto --depth ready`
- The CLI surface is partly unverified. `google-colab-cli` is real: the official PyPI package, `uv tool install google-colab-cli` (https://github.com/googlecolab/google-colab-cli, https://pypi.org/project/google-colab-cli/, https://developers.googleblog.com/en/introducing-the-google-colab-cli/). Confirmed verbs: `colab run [--gpu GPU] [--high-mem] [--keep] [--timeout] SCRIPT`, which releases the VM on completion unless `--keep`; and `colab new [-s NAME] [--gpu]`. The default `--timeout` is **30s**. The design's `upload`/`download`/`stop -s` verbs are **not verified**. → Plan step 0 is a spike that records `colab --help` / `colab run --help` and freezes the argv against that output. Prefer `colab run` (auto-release) with an explicit `--timeout`; teardown in `finally` is still required for the `new`/`--keep` path.
- The CLI is **not installed** on this machine (`command -v colab` is empty, 2026-11-26) → step-0 precondition: install + authenticate. Tests use a fake `colab` stub on PATH, so the fast tier never needs the real CLI.
- GPU default is wrong for the model. Wan2.1 I2V ships only as 14B checkpoints (`Wan-AI/Wan2.1-I2V-14B-480P`, `-720P`, and the `-Diffusers` variants, HF Hub 2026-11-26). There is no 1.3B I2V, and 14B does not fit a 16 GB T4. → The `wan21-i2v` default is `A100` with the 480P-Diffusers checkpoint. `L4` is allowed with CPU offload. `T4` is refused for this provider before launch. The design's "T4 default" applies only to 0452's MuseTalk.
- Headless Drive mount is unverified. `google.colab.drive.mount()` normally needs interactive auth, and it is unknown whether CLI-launched runtimes inherit Drive credentials. → Spike step 0 checks it. If Drive is unavailable, the fallback cache is an HF Hub `HF_HOME` on the VM (cold download per run). That is recorded as a CCU cost warning, not a failure.
- Budget check: about 3 clips × ~8 min on an A100 (7 CCU/hr) ≈ 2.8 CCU/day ≈ 84 CCU/month, under the 180 cap. The ledger guard stays as designed.

### Requirements

- [ ] R1. `plugins/generations/video-gen/src/colab-runner.ts` exports `runColabJob(job: ColabJob, deps): Promise<ColabJobResult>`. It spawns `colab` (the argv is frozen from the step-0 spike) with `--gpu <T4|L4|A100>`, an explicit `--timeout` equal to `job.timeoutMs` (default 600 000), and a session name `kk-video-<runDate>-<jobType>`. For any session it created with `--keep`/`new`, it runs teardown in `finally`. A local wall-clock kill at `timeoutMs + 60s` also triggers teardown.
- [ ] R2. Each job receives `KK_COLAB_CACHE_DIR` (default `/content/drive/MyDrive/kk-video-cache`). The worker exports `HF_HOME=$KK_COLAB_CACHE_DIR/hf` when that dir is writable, otherwise the VM-local default, and it reports `cache: 'drive'|'local'` in its JSON result.
- [ ] R3. `src/ccu-ledger.ts` appends `{timestamp, gpu, durationSec, estimatedCcu, jobType, status}` to `<works_dir>/colab-ccu-ledger.jsonl` (burn rates T4 2, L4 3, A100 7 CCU/hr). It refuses before launch when `rolling30d + projected > maxMonthlyCcu` (default 180, configurable via the request's `colab.maxMonthlyCcu`).
- [ ] R4. `python/colab_wan21_i2v.py` (the remote worker) produces 3–5s 9:16 clips from the cover/card images. The `wan21Provider` VisualProvider returns `{kind:'clips'}`, and `EditorialReel` composites the clips with `<OffthreadVideo>` inside the same safe-zone shell. `wan21-i2v` refuses `T4`.
- [ ] R5. In editorial mode with `provider: 'wan21-i2v'`, any Colab spawn error, nonzero exit, timeout, missing output, or budget refusal falls back to `localKenBurns`. Content then carries `renderProvider: 'local-ken-burns'`, `fallbackUsed: true` and a `warnings[]` entry naming the cause, and the process exits 0.
- [ ] R6. Daily wiring: the 0449 workflow var `video` gains `editorial-wan`, which maps to `provider: 'wan21-i2v'` in the video request.

**Out of scope:** MuseTalk/EchoMimicV2 (0452); a paid Colab tier switch; a multi-job parallel session; billing API queries (the ledger is an estimate).

### Acceptance Criteria

- [ ] AC1 — Editorial mode falls back to local Ken-Burns when Colab Wan2.1 I2V fails or exceeds budget (req: R3, R5)
  - Observed by `tests/colab-fallback.test.ts`: a fake `colab` stub exits 1 / hangs / produces no output, or the ledger is pre-filled to 179 CCU. Each case yields exit 0, `fallbackUsed: true`, a named warning and `renderProvider: 'local-ken-burns'`. In the budget case the stub records **zero** invocations.
- [ ] AC2 — Colab GPU runner executes headless jobs with Google Drive weight caching and teardown guards (req: R1, R2, R3)
  - Observed by `tests/colab-runner.test.ts`: the recorded argv contains `--gpu A100` and `--timeout`, the env carries `KK_COLAB_CACHE_DIR`, teardown runs after success, failure and the local timeout kill, and a ledger line is appended with the correct `estimatedCcu`.
- [ ] AC3 — Editorial mode composites Colab Wan2.1 I2V motion loops inside the shared Remotion shell (req: R4, R6)
  - Observed by a heavy-tier `tests/render-wan-e2e.test.ts`: a fixture of 2 pre-rendered 3s 9:16 clips (no Colab) is rendered through `EditorialReel` `{kind:'clips'}`, and ffprobe asserts 1080×1920 h264+aac. A real Colab run is a manual, operator-approved check recorded in Testing.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T23:18:09.657Z

- **Run, or new + exec?** Closed: `colab run` with auto-release is preferred, because it has the smallest teardown surface. Use `new`/`--keep` only if the spike shows `run` cannot return output files. Record the chosen path in Solution together with the `--help` excerpt.
- **How do inputs and outputs move?** Closed, pending the spike: use the CLI's own file-transfer verbs if they exist. Otherwise, if headless Drive works, use Drive under `$KK_COLAB_CACHE_DIR/jobs/<id>/`. If neither works, stop and escalate through `.spur/run/0451-question.md`. Do not invent a transfer.
- **Default GPU?** Closed: `A100` for wan21-i2v (14B only). `L4` is allowed. `T4` is refused.
- **A real Colab run in CI/tests?** Closed: never. The fast tier uses a fake stub. One manual run (with operator go-ahead, because it spends CCU) is recorded in Testing.
- **New Python deps?** Closed: diffusers/torch install on the **remote** VM inside the worker script. The local `pyproject.toml` is unchanged.

### Design

**Frozen names.** `colab-runner.ts`: `interface ColabJob { jobType: 'wan21-i2v'|'musetalk'|'echomimic-v2'; gpu: 'T4'|'L4'|'A100'; script: string; inputs: string[]; timeoutMs: number; env: Record<string,string> }`, `ColabJobResult { ok; outputs: string[]; durationSec; cache: 'drive'|'local'; error? }`, `runColabJob(job, { runProcess, ledger, now })`. `ccu-ledger.ts`: `CCU_PER_HOUR = { T4: 2, L4: 3, A100: 7 }`, `readRolling30d(path, now)`, `appendLedger(path, entry)`, `assertBudget(…)`. Provider: `wan21Provider` in `visual-provider.ts`. Request extension on 0448's `VideoGenRequestSchema`: `provider?: 'local-ken-burns'|'wan21-i2v'` and `colab?: { gpu?, timeoutMs?, maxMonthlyCcu?, cacheDir? }`.
- The `colab` binary path comes from `KK_COLAB_BIN ?? 'colab'`. Tests point it at a stub script.
- The ledger path is `<works_dir>/colab-ccu-ledger.jsonl`. `works_dir` is resolved the way the daily stages already resolve it. It is not a config-dir file (ADR-042: disposable vs mission-critical; the ledger is an estimate, so losing it is acceptable).

**Anti-patterns.** Do not leave a session alive on any path. Do not rely on the CLI's 30s default timeout. Do not shell out through `sh -c` (use an argv array). Do not let a fallback exit nonzero. Do not use T4 for 14B. Do not install colab-cli into the plugin's uv project (it is an operator tool, installed with `uv tool install`).

**Handoff.** 0452 reuses `runColabJob` and the ledger unchanged and adds jobTypes `musetalk`/`echomimic-v2` (timeout 15 min for EchoMimicV2).

### Plan

0. **Spike (precondition, ≤1h):** `uv tool install google-colab-cli`, then authenticate (the operator does this interactively with `! colab …`). Capture the `colab --help` / `colab run --help` / `colab new --help` output to Solution. Run one trivial `colab run --gpu T4 --timeout 120` on a script that writes to `/content/drive/MyDrive` to test headless Drive. Freeze the argv and the transfer path. If no transfer path exists, escalate (Q&A).
1. R3: write the ledger tests first (rolling window, cap, CCU math), then `ccu-ledger.ts`.
2. R1/R2: write the stub-`colab` tests (argv, env, teardown on success/failure/timeout), then `colab-runner.ts`.
3. R5: write the fallback tests, then the provider wiring in `src/index.ts`.
4. R4: write `colab_wan21_i2v.py` and the `{kind:'clips'}` branch in `EditorialReel`, plus the heavy fixture render test, registered in `HEAVY_TEST_PATTERNS`.
5. R6: add the `editorial-wan` var mapping in the 0449 video-request stage, plus its test, then sync (bundle-plugins, tools:fresh, rsync).
6. Gate: `bun run lint`, `bun run test`, `bun run test:heavy` (the render tests), `bun run build`. Then one operator-approved real Colab run, with the ledger line and the clip ffprobe recorded in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/00_ADR.md` ADR-060; `docs/design/short-form-video-promotion.md`; feature `docs/features/D9_short-form-vertical-video-generation-and-three-channel-podcast-promotion.md`
- https://github.com/googlecolab/google-colab-cli
- https://pypi.org/project/google-colab-cli/
- https://developers.googleblog.com/en/introducing-the-google-colab-cli/
- https://hf.co/Wan-AI/Wan2.1-I2V-14B-480P-Diffusers

### History
